// solo-manager.js - Per-player solo games (daily + practice).
//
// Each solo "session" wraps a Game instance for one identityKey. State is
// in-memory (lost on server restart) but the run summary persists to the
// `solo_runs` table on every guess + on completion / abandonment, so daily
// personal-best and play history survive restarts.
//
// Two modes:
//   - 'daily':    same article+grid as everyone else playing today (shared puzzle)
//   - 'practice': fresh random article+grid per session
//
// Activity touches `lastActivityAt`; the idle sweep ends abandoned sessions
// after IDLE_END_MS so memory stays bounded.

const { Game, computeRankAward } = require('./game');
const db = require('./database');
const durability = require('./action-durability');
const wordlist = require('./wordlist');
const dailyPuzzle = require('./daily-puzzle');
const { buildArticleRound } = require('./article');
const { buildGrid, pickDims } = require('./grid');
const { buildSemanticTrie } = require('./semantic-trie');
const { rankTop } = require('./searchle-client');
const { rankBatch } = require('./searchle-client');

const IDLE_END_MS = 20 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

// key: `${mode}:${identityKey}` so a player can have one daily AND one practice
// run going at the same time without them clobbering each other.
const sessions = new Map();
let sweepTimer = null;

function init() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(sweepIdle, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

function keyOf(mode, identityKey) {
  return `${mode}:${identityKey}`;
}

async function buildPracticePayload() {
  const trie = wordlist.getTrie();
  if (!trie || trie.wordCount < 1000) throw new Error('solo: trie not ready');

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const article = await buildArticleRound(trie, { count: 5 });
      if (!article) throw new Error('no viable article');
      const targetSlugs = article.targets.map((t) => t.word);
      const titleAsTargets = article.titleWords.filter((w) => w.length >= 4 && w.length <= 9 && trie.has(w));
      const allToPlace = Array.from(new Set([...targetSlugs, ...titleAsTargets]));
      const totalLetters = allToPlace.reduce((s, w) => s + w.length, 0);
      const dims = pickDims(totalLetters);
      const _topic = await buildSemanticTrie({ titleWords: article.titleWords, baseTrie: trie, rankTop, frequencyMap: wordlist.getFrequencyMap() });
      if (_topic.fellBack) console.log(`[Solo] semantic trie undersized (${_topic.size} semantic words) for "${article.title}"`);
      const built = buildGrid(allToPlace, trie, {
        rows: dims.rows,
        cols: dims.cols,
        minWordLength: 3,
        scoringTrie: _topic.trie,
      });

      let totalRankedWords = 0;
      let rankTarget = null;
      for (const t of article.targets) {
        if (!t || !t.word) continue;
        try {
          const probe = await rankBatch(t.word, []);
          rankTarget = t.word;
          totalRankedWords = probe.totalRankedWords || 0;
          break;
        } catch (e) {
          console.log(`[Solo] target word "${t.word}" not rankable by Searchle: ${e.message}`);
        }
      }
      if (!rankTarget || !totalRankedWords) {
        throw new Error('No target word is rankable by Searchle');
      }

      return {
        grid: built.grid, rows: built.rows, cols: built.cols,
        allWords: built.allWords, targetPaths: built.targetPaths,
        targets: article.targets,
        articleTitle: article.title,
        articleKey: article.key,
        articlePlaintext: article.plaintext,
        titleWords: article.titleWords,
        totalRankedWords,
        rankTarget,
        topicTrie: _topic.trie,
      };
    } catch (e) {
      console.log(`[Solo] practice build attempt ${attempt + 1}/6 failed: ${e.message}`);
    }
  }
  throw new Error('Could not build practice puzzle');
}

// Convert a daily-puzzle DB row into the same shape a fresh Game.initialize
// expects. The cached grid lacks `allWords` (we never persist 1k+ map entries),
// so we re-run the solver to rebuild it.
const { findAllWords, findWordPath } = require('./solver');
async function rebuildSemanticAllWords({ grid, rows, cols, titleWords, label }) {
  const trie = wordlist.getTrie();
  const topic = await buildSemanticTrie({
    titleWords: titleWords || [],
    baseTrie: trie,
    rankTop,
    frequencyMap: wordlist.getFrequencyMap(),
  });
  if (topic.fellBack) {
    console.log(`[Solo] semantic trie undersized (${topic.size} semantic words) for ${label || 'cached puzzle'}`);
  }
  return {
    allWords: findAllWords(grid, rows, cols, trie, 3),
    topicTrie: topic.trie,
  };
}

async function dailyPayload(puzzle) {
  const rebuilt = await rebuildSemanticAllWords({
    grid: puzzle.grid,
    rows: puzzle.rows,
    cols: puzzle.cols,
    titleWords: puzzle.titleWords,
    label: `"${puzzle.articleTitle}"`,
  });
  return {
    grid: puzzle.grid,
    rows: puzzle.rows,
    cols: puzzle.cols,
    allWords: rebuilt.allWords,
    topicTrie: rebuilt.topicTrie,
    targets: puzzle.targets,
    articleTitle: puzzle.articleTitle,
    articleKey: puzzle.articleKey,
    articlePlaintext: puzzle.articlePlaintext,
    titleWords: puzzle.titleWords,
    totalRankedWords: puzzle.totalRankedWords || 0,
    rankTarget: puzzle.rankTarget || (puzzle.targets && puzzle.targets[0] && puzzle.targets[0].word) || null,
  };
}

function _persistSoloState(s) {
  if (!s || !s.runId || !s.game) throw Error('missing_solo_run');
  durability.accept(() => db.updateSoloRunState(s.runId, JSON.stringify(s.game.snapshot())));
}

async function restoreSoloRun(r) {
      // Practice runs always carry their own payload_json. Daily runs we can
      // also fall back to the daily_puzzles row by puzzle_date.
      let payload = r.payload;
      if (!payload && r.mode === 'daily' && r.puzzle_date) {
        const puzzle = db.getDailyPuzzle(r.puzzle_date);
        if (puzzle) {
          payload = {
            articleTitle: puzzle.article_title,
            articleKey: puzzle.article_key,
            articlePlaintext: puzzle.article_plaintext || '',
            rows: puzzle.rows,
            cols: puzzle.cols,
            grid: puzzle.grid,
            targets: puzzle.targets,
            titleWords: puzzle.titleWords,
            totalRankedWords: puzzle.total_ranked_words || 0,
            rankTarget: puzzle.rank_target || null,
          };
        }
      }
      if (!payload) {
        console.log(`[Solo] resume #${r.id}: no payload — abandoning`);
        db.abandonSoloRun(r.id);
        return null;
      }
      const rebuilt = r.state?.objectives?.allWords ? { allWords: new Map(r.state.objectives.allWords), topicTrie: null } : await rebuildSemanticAllWords({
        grid: payload.grid,
        rows: payload.rows,
        cols: payload.cols,
        titleWords: payload.titleWords,
        label: `"${payload.articleTitle}"`,
      });
      const allWords = rebuilt.allWords;
      // Rebuild targetPaths: titles + targets, prefer allWords hits, fall back to
      // a targeted grid search for proper nouns not in the trie.
      const targetPaths = {};
      const seedWords = [
        ...((payload.titleWords || []).filter(Boolean)),
        ...((payload.targets || []).map((t) => t && t.word).filter(Boolean)),
      ];
      for (const w of seedWords) {
        if (!w || targetPaths[w]) continue;
        const fromAll = allWords && allWords.get(w);
        if (Array.isArray(fromAll) && fromAll.length) { targetPaths[w] = fromAll; continue; }
        const p = findWordPath(payload.grid, payload.rows, payload.cols, w);
        if (p && p.length) targetPaths[w] = p;
      }
      const game = new Game();
      game.initialize({
        ...payload,
        allWords,
        targetPaths,
        topicTrie: rebuilt.topicTrie,
        frequencyMap: wordlist.getFrequencyMap(),
      });
      if (r.state) game.restoreSnapshot(r.state);
      const reconciled = game.reconcileFoundWordIndexes();
      const sess = {
        key: keyOf(r.mode, r.identity_key),
        mode: r.mode,
        runId: r.id,
        puzzleDate: r.puzzle_date || null,
        identityKey: r.identity_key,
        displayName: null,
        profileImage: null,
        platform: r.identity_key.split(':')[0],
        completed: r.status === 'complete',
        game,
        startedAt: r.started_at || Date.now(),
        lastActivityAt: Date.now(),
      };
      let repairedRankTarget = false;
      if (r.status !== 'complete' && game.isRankTargetResolved && game.isRankTargetResolved()) {
        const staleTarget = game.rankTarget;
        console.log(`[Solo] resumed rankTarget "${staleTarget}" was already found; advancing`);
        const next = await advanceSoloRankTarget(sess);
        repairedRankTarget = true;
        if (!next && game.rankTarget === staleTarget) {
          game.rankTarget = null;
          game.rankedGuesses = new Map();
          game.rankRewardsTaken = new Set();
          game.bestNonTop10Rank = Infinity;
        }
      }
      if ((reconciled && reconciled.changed) || repairedRankTarget) _persistSoloState(sess);
  return sess;
}
async function resumeActiveSoloRuns() {
  const trie=wordlist.getTrie();
  if(!trie || trie.wordCount<1000) { console.log('[Solo] resume deferred: trie not ready'); return 0; }
  let resumed=0;
  for(const row of db.getActiveSoloRuns()) {
    try { const restored=await restoreSoloRun(row); if(restored){sessions.set(restored.key,restored);resumed++;} }
    catch(error){ console.error('[Solo] resume deferred:',error.message); }
  }
  return resumed;
}

// Start (or resume) a solo session. If one already exists for the same
// (mode, identityKey) it's returned — players who reconnect mid-game pick up
// where they left off.
function startSolo(input) { return durability.serialize(keyOf(input.mode || 'practice', input.session?.identityKey), () => startSoloOnce(input)); }
async function startSoloOnce({ session, mode = 'practice' }) {
  if (!session || !session.identityKey) throw new Error('startSolo: session required');
  if (mode !== 'daily' && mode !== 'practice') throw new Error(`startSolo: unknown mode "${mode}"`);

  const key = keyOf(mode, session.identityKey);
  const today = mode === 'daily' ? dailyPuzzle.getTodayDate() : null;
  let existing = sessions.get(key);
  if (existing && mode === 'daily' && existing.puzzleDate !== today) { finalizeSolo(existing, 'rollover'); existing = null; }
  if (!existing) {
    const row = db.getSoloRunForOwner(session.identityKey, mode, today);
    if (row) { existing = await restoreSoloRun(row); if (!existing) throw Error('solo_resume_unavailable'); sessions.set(key, existing); }
  }
  if (existing) {
    existing.displayName = session.displayName; existing.profileImage = session.profileImage; existing.platform = session.platform;
    existing.lastActivityAt = Date.now();
    return existing;
  }

  let payload;
  let puzzleDate = null;
  if (mode === 'daily') {
    const puzzle = await dailyPuzzle.getOrBuildPuzzle();
    payload = await dailyPayload(puzzle);
    puzzleDate = puzzle.puzzleDate;
  } else {
    payload = await buildPracticePayload();
  }

  const game = new Game();
  game.initialize({ ...payload, frequencyMap: wordlist.getFrequencyMap() });
  // Mid-run player score — the Game class is multiplayer-shaped so we still
  // need a key to bucket scores under. Using the identityKey is correct.
  // (game.guess() will create the player row on first correct find.)

  let runId;
  durability.accept(() => {
  runId = db.startSoloRun({
    identityKey: session.identityKey,
    mode,
    puzzleDate,
    articleTitle: payload.articleTitle,
    totalTargets: payload.targets.length,
    totalTitleWords: payload.titleWords.length,
  });

  // Snapshot the article+grid payload so a crashed solo run can resume cold.
  // (allWords is rebuilt via solver.findAllWords on resume — not stored.)
    db.setSoloRunPayload(runId, JSON.stringify({
      articleTitle: payload.articleTitle,
      articleKey: payload.articleKey,
      articlePlaintext: payload.articlePlaintext || '',
      rows: payload.rows,
      cols: payload.cols,
      grid: payload.grid,
      targets: payload.targets,
      titleWords: payload.titleWords,
      totalRankedWords: payload.totalRankedWords || 0,
      rankTarget: payload.rankTarget || null,
    }));
    db.updateSoloRunState(runId, JSON.stringify(game.snapshot()));
  });

  const soloSession = {
    key,
    mode,
    runId,
    puzzleDate,
    identityKey: session.identityKey,
    displayName: session.displayName,
    profileImage: session.profileImage,
    platform: session.platform,
    game,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  sessions.set(key, soloSession);
  console.log(`[Solo] started ${mode} run #${runId} for ${session.identityKey} → "${payload.articleTitle}"`);
  return soloSession;
}

function getSolo(identityKey, mode) {
  return sessions.get(keyOf(mode, identityKey)) || null;
}

async function advanceSoloRankTarget(s) {
  if (!s || !s.game) return null;
  if (!s.game.excludedRankTargets) s.game.excludedRankTargets = new Set();

  // Phase 1: next unrevealed title word
  if (s.game.titleWords && s.game.titleWords.length > 0
      && s.game.revealedTitleWords.size < s.game.titleWords.length) {
    for (const w of s.game.titleWords) {
      if (!w || w === s.game.rankTarget) continue;
      if (s.game.revealedTitleWords.has(w)) continue;
      if (s.game.excludedRankTargets.has(w)) continue;
      try {
        const data = await rankBatch(w, []);
        s.game.rankTarget = w;
        s.game.totalRankedWords = data.totalRankedWords || 0;
        s.game.rankedGuesses = new Map();
        s.game.rankRewardsTaken = new Set();
        s.game.bestNonTop10Rank = Infinity;
        console.log(`[Solo] rankTarget advanced to title word "${w}"`);
        return w;
      } catch (e) {
        s.game.excludedRankTargets.add(w);
      }
    }
  }

  // Phase 2: cascade titles → ultras → rares → commons (rarest available)
  const freq = s.game.frequencyMap || new Map();
  const tiers = [
    { name: "common", map: s.game.commonWords,   found: s.game.foundCommon },
    { name: "rare",   map: s.game.rareWords,     found: s.game.foundRare },
    { name: "ultra",  map: s.game.ultraRareWords, found: s.game.foundUltra },
  ];
  for (const tier of tiers) {
    if (!tier.map || tier.map.size === 0) continue;
    const unfound = [...tier.map.keys()]
      .filter((w) => (!tier.found || !tier.found.has(w)) && (!s.game.foundWords || !s.game.foundWords.has(w)))
      .sort((a, b) => {
        const fa = freq.get(a);
        const fb = freq.get(b);
        const va = typeof fa === 'number' ? fa : 99;
        const vb = typeof fb === 'number' ? fb : 99;
        return va - vb || a.localeCompare(b);
      });
    for (const w of unfound) {
      if (!w || w === s.game.rankTarget) continue;
      if (s.game.excludedRankTargets.has(w)) continue;
      try {
        const data = await rankBatch(w, []);
        s.game.rankTarget = w;
        s.game.totalRankedWords = data.totalRankedWords || 0;
        s.game.rankedGuesses = new Map();
        s.game.rankRewardsTaken = new Set();
        s.game.bestNonTop10Rank = Infinity;
        console.log(`[Solo] rankTarget advanced to ${tier.name} "${w}"`);
        return w;
      } catch (e) {
        s.game.excludedRankTargets.add(w);
      }
    }
  }
  return null;
}

function processSoloGuess(input) { return durability.serialize(keyOf(input.mode, input.identityKey), () => processSoloGuessOnce(input)); }
async function processSoloGuessOnce({ identityKey, mode, word, preResolvedRank = null, authorize = null, runId = null, actionId = null }) {
  const original = sessions.get(keyOf(mode, identityKey));
  if (!original || runId && original.runId !== runId) return null;
  const receiptScope = 'solo:' + original.runId + ':' + identityKey;
  const fingerprint = String(word || '').trim().toLowerCase();
  const receipt = db.getActionReceipt(receiptScope, actionId, fingerprint);
  if (receipt) return { ...receipt, replayed: true };
  if (original.completed) return { result: 'already_found', word, completed: true, finalState: publicSoloState(original) };
  const s = { ...original, game: durability.cloneGame(original.game) };
  if (!s || !s.game || !word) return null;
  s.lastActivityAt = Date.now();

  const username = s.displayName || `Guest`;
  const norm = String(word || '').trim().toLowerCase();

  const rankTarget = s.game.rankTarget;
  // --- Searchle ranking ---
  // Resolve semantic rank BEFORE mutating game state so guess() is fully sync.
  let rankInfo = preResolvedRank && preResolvedRank.target === s.game.rankTarget ? preResolvedRank : null;
  if (!rankInfo && norm && s.game.rankTarget) {
    try {
      const data = await rankBatch(rankTarget, [norm]);
      const rank = data.ranks && typeof data.ranks[norm] === 'number' ? data.ranks[norm] : null;
      const canonical = data.canonicals && data.canonicals[norm] ? data.canonicals[norm] : norm;
      rankInfo = { rank, canonical };
    } catch (e) {
      console.log(`[Solo] Searchle rank failed for "${norm}": ${e.message}`);
      rankInfo = { rank: null, canonical: norm };
    }
  }

  if (authorize && !(await authorize())) return null;
  if (sessions.get(s.key) !== original || original.game.rankTarget !== rankTarget || s.game.rankTarget !== rankTarget) return null;
  const result = s.game.guess(word, s.platform || 'web', identityKey, username, username, s.profileImage || null, rankInfo);

  // Slot-based rank scoring: reward when a guess lands in the displayed
  // top-5 list (positions 1-5 of guesses sorted by Searchle rank).
  if (result && rankInfo && typeof rankInfo.rank === 'number') {
    const myCanonical = (rankInfo.canonical || norm);
    const seenCan = new Set();
    const sorted = [...s.game.rankedGuesses.entries()]
      .map(([w, d]) => ({
        canonical: d.canonical || w,
        rank: (typeof d.rank === 'number') ? d.rank : Infinity,
      }))
      .filter((g) => {
        if (seenCan.has(g.canonical)) return false;
        seenCan.add(g.canonical);
        return true;
      })
      .sort((a, b) => a.rank - b.rank);
    const position = sorted.findIndex((g) => g.canonical === myCanonical) + 1;
    const wordPaid = s.game.rankRewardsTaken.has(myCanonical);
    const award = computeRankAward(position, rankInfo.rank, wordPaid);
    if (award.points > 0) {
      if (award.rankClaimed) s.game.rankRewardsTaken.add(myCanonical);
      if (award.newBest) s.game.bestNonTop10Rank = rankInfo.rank;
      const prev = s.game.playerScores.get(identityKey) || {
        score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0,
        displayName: username, profileImage: s.profileImage || null, platform: s.platform || 'web',
      };
      prev.score = (prev.score || 0) + award.points;
      prev.xp = (prev.xp || 0) + Math.round(award.points / 10);
      prev.displayName = username || prev.displayName;
      prev.profileImage = s.profileImage || prev.profileImage;
      prev.platform = s.platform || prev.platform || 'web';
      s.game.playerScores.set(identityKey, prev);
      if (typeof result === 'object') {
        result.rankPoints = award.points;
        result.points = (result.points || 0) + award.points;
        if (result.breakdown) result.breakdown.rank = award.points;
      }
    }
  }

  async function maybeAdvanceResolvedRankTarget() {
    if (s.game && !s.game.isComplete() && s.game.rankTarget) {
      const candidates = [];
      if (result.word) candidates.push(result.word);
      if (rankInfo && rankInfo.canonical) candidates.push(rankInfo.canonical);
      const rankTargetFound = candidates.includes(s.game.rankTarget)
        || (s.game.isRankTargetResolved && s.game.isRankTargetResolved());
      const allTitlesRevealed = s.game.titleWords
        && s.game.revealedTitleWords.size >= s.game.titleWords.length;
      const rankTargetIsTitle = s.game.titleWordSet && s.game.titleWordSet.has(s.game.rankTarget);
      const phase2JustEntered = allTitlesRevealed && rankTargetIsTitle;
      if (rankTargetFound || phase2JustEntered) {
        return !!(await advanceSoloRankTarget(s));
      }
    }
    return false;
  }

  if (result.result === 'already_found') await maybeAdvanceResolvedRankTarget();

  if (result.result === 'correct') await maybeAdvanceResolvedRankTarget();
  if (authorize && !(await authorize())) return null;
  if (sessions.get(s.key) !== original) return null;
  const stats = s.game.playerScores.get(identityKey) || { score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0 };
  const completed = s.game.isComplete();
  let pbBumped = false;
  s.completed = completed;
  if (completed) { result.finalState = publicSoloState(s); result.completed = true; }
  durability.accept(() => {
    db.updateSoloRun(s.runId, stats);
    db.updateSoloRunState(s.runId, JSON.stringify(s.game.snapshot()));
    if (completed) {
      db.endSoloRun(s.runId, 'complete', stats);
      if (s.mode === 'daily' && s.puzzleDate) pbBumped = db.maybeUpdateDailyPB(s.identityKey, s.puzzleDate, stats);
    }
    result.pbBumped = pbBumped;
    db.saveActionReceipt(receiptScope, actionId, fingerprint, result);
  });
  original.game = s.game; original.lastActivityAt = s.lastActivityAt; original.completed = completed;
  if (completed) { result.finalState = publicSoloState(original); result.pbBumped = pbBumped; result.completed = true; }
  if (result.result === 'correct') {
    // Sassie: emit game-event (same shape as round-runner). Solo runs from
    // web-only sessions, so most events get filtered out by sassie's
    // livestream-platform gate — fires for cross-platform sessions only.
    try {
      const relay = require('./relay-client');
      const sassieUser = {
        displayName: s.displayName || username,
        platform: s.platform || 'web',
        platformUserId: identityKey ? identityKey.split(':').pop() : null,
        uid: identityKey ? identityKey.split(':').pop() : null,
        odid: (s.platform === 'discord') ? (identityKey ? identityKey.split(':').pop() : null) : null,
      };
      const tn = (result.breakdown && result.breakdown.tierName) || null;
      let evName = null, pri = 'normal', flags = {};
      if (result.isTitleWord) {
        evName = 'hidden_word'; pri = 'high'; flags = { isHidden: true };
      } else if (tn === 'common') {
        evName = 'common_word_found';
      } else if (tn === 'rare') {
        evName = 'rare_word_found'; pri = 'high'; flags = { isRare: true };
      } else if (tn === 'ultra') {
        evName = 'ultra_rare_word_found'; pri = 'high'; flags = { isHidden: true };
      } else if (tn === 'three') {
        evName = 'three_letter_found'; pri = 'low'; flags = { isThreeLetter: true };
      } else {
        evName = 'ultra_rare_word_found'; pri = 'high'; flags = { isHidden: true };
      }
      if (evName) {
        relay.emit('game-event', {
          game: 'wikirectangled',
          eventName: evName,
          data: {
            user: sassieUser,
            streamerHandle: null,
            roomMode: 'solo',
            guess: result.word,
            word: result.word,
            score: result.points || 0,
            rank: (rankInfo && typeof rankInfo.rank === 'number') ? rankInfo.rank : undefined,
            ...flags,
          },
          priority: pri,
        });
      }
    } catch (e) { /* sassie emit failures shouldn't block gameplay */ }
  }
  return result;
}

function publicSoloState(s) {
  if (!s || !s.game) return null;
  const state = s.game.getState();
  state.mode = `solo-${s.mode}`;
  state.runId = s.runId;
  state.puzzleDate = s.puzzleDate;
  state.completed = !!s.completed;
  state.puzzleGenerationId = 'wiki-solo-' + s.runId;
  // For solo, the player IS the only player — surface their personal stats.
  const stats = s.game.playerScores.get(s.identityKey) || { score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0 };
  state.personal = stats;
  return state;
}

function finalizeSolo(s, status) {
  if (!s) return null;
  const stats = s.game ? (s.game.playerScores.get(s.identityKey) || { score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0 }) : { score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0 };
  let pbBumped = false;
  if (!s.completed) durability.accept(() => {
    db.updateSoloRunState(s.runId, JSON.stringify(s.game.snapshot()));
    db.endSoloRun(s.runId, status, stats);
    if (s.mode === 'daily' && s.puzzleDate) pbBumped = db.maybeUpdateDailyPB(s.identityKey, s.puzzleDate, stats);
  });
  console.log(`[Solo] ended ${s.mode} run #${s.runId} for ${s.identityKey} (${status}) score=${stats.score}${pbBumped ? ' +PB' : ''}`);
  sessions.delete(s.key);
  return { status, stats, pbBumped };
}

function endSolo(identityKey, mode, reason = 'left', runId = null) { return durability.serialize(keyOf(mode, identityKey), () => endSoloOnce(identityKey, mode, reason, runId)); }
function endSoloOnce(identityKey, mode, reason = 'left', runId = null) {
  const s = sessions.get(keyOf(mode, identityKey));
  if (!s || runId && s.runId !== runId) return null;
  return finalizeSolo(s, reason);
}

function sweepIdle() {
  const cutoff = Date.now() - IDLE_END_MS;
  for (const s of [...sessions.values()]) {
    if (s.lastActivityAt < cutoff) {
      endSolo(s.identityKey, s.mode, 'abandoned', s.runId).catch(error => console.error('[Solo] idle save failed:', error.message));
    }
  }
}

function listSessions() {
  return [...sessions.values()].map((s) => ({
    identityKey: s.identityKey, mode: s.mode, runId: s.runId,
    articleTitle: s.game ? s.game.articleTitle : null,
    score: s.game ? (s.game.playerScores.get(s.identityKey) || { score: 0 }).score : 0,
    startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
  }));
}

async function preResolveBatchRanks({ identityKey, mode, words }) {
  const s = sessions.get(keyOf(mode, identityKey));
  const map = new Map();
  if (!s || !s.game || !Array.isArray(words)) return { norms: [], rankMap: map };
  const seen = new Set();
  const norms = [];
  for (const w of words) {
    const n = String(w || '').trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    norms.push(n);
    if (norms.length >= 50) break;
  }
  if (!norms.length || !s.game.rankTarget) return { norms, rankMap: map };
  try {
    const target = s.game.rankTarget;
    const data = await rankBatch(target, norms);
    for (const n of norms) {
      const rank = data.ranks && typeof data.ranks[n] === 'number' ? data.ranks[n] : null;
      const canonical = data.canonicals && data.canonicals[n] ? data.canonicals[n] : n;
      map.set(n, { rank, canonical, target });
    }
  } catch (e) {
    console.log(`[Solo] batch Searchle rank failed: ${e.message}`);
    for (const n of norms) map.set(n, { rank: null, canonical: n });
  }
  return { norms, rankMap: map };
}

module.exports = { init, startSolo, getSolo, processSoloGuess, publicSoloState, endSolo, listSessions , preResolveBatchRanks, resumeActiveSoloRuns };
