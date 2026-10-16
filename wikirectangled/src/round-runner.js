// round-runner.js - One round-lifecycle orchestrator per game instance.
//
// A RoundRunner owns the full life of a single Game: build the article+grid,
// hand the new state to clients, accept guesses, persist progress, and roll
// the round at completion or timeout. Public game, streamer rooms, and (later)
// solo sessions all instantiate one of these — the only differences are:
//   - `broadcast(event, payload)` — where to send round-start/state/end events
//   - `mode` and `roomHandle` — recorded on each row so DB queries can split them
//   - `autoLoop` — public + streamer rooms restart automatically; solo doesn't
//
// Keeping all of this in one place means new game modes only need to choose
// their broadcast strategy and lifecycle settings — they don't re-implement
// the round logic.

const { Game, computeRankAward } = require('./game');
const { buildArticleRound, isKnownRankable, isKnownUnrankable } = require('./article');
const { buildGrid, pickDims } = require('./grid');
const { findAllWords, findWordPath } = require('./solver');
const db = require('./database');
const durability = require('./action-durability');
const crypto = require('node:crypto');
const elo = require('./elo');
const wordlist = require('./wordlist');
const path = require('path');
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
const { rankBatch, rankTop, FALLBACK_TOTAL_RANKED } = require('./searchle-client');
const { buildSemanticTrie } = require('./semantic-trie');
const relay = require('./relay-client');
const { orderByRankTier } = require('./rank-target-tiering');

const HOLD_AFTER_WIN_MS_DEFAULT = 7_000;
const ROUND_TIMEOUT_MS_DEFAULT = 0; // 0 = no timeout

async function buildRoundOnce({
  targetCount = 5,
  maxTotalLetters = 72,
  rows = null,
  cols = null,
  roundBuilder = null,
} = {}) {
  const trie = wordlist.getTrie();
  if (!trie || trie.wordCount < 1000) {
    throw new Error(`Trie too small (${trie ? trie.wordCount : 0} words). Word Bank or local dictionary failed to load.`);
  }
  const builder = roundBuilder || buildArticleRound;
  const round = await builder(trie, { count: targetCount, maxTotalLetters, maxAttempts: 600 });
  if (!round) throw new Error('Could not pick a viable round');

  const targetSlugs = round.targets.map((t) => t.word);
  const titleAsTargets = round.titleWords.filter((w) => w.length >= 4 && w.length <= 9);
  const allToPlace = Array.from(new Set(titleAsTargets));

  const totalLetters = allToPlace.reduce((s, w) => s + w.length, 0);
  const dims = (rows && cols) ? { rows, cols } : pickDims(totalLetters);

  const topic = await buildSemanticTrie({
    titleWords: round.titleWords,
    baseTrie: trie,
    rankTop,
    frequencyMap: wordlist.getFrequencyMap(),
  });
  if (topic.fellBack) {
    console.log(`[Round] semantic trie undersized (${topic.size} semantic words) for "${round.title}"`);
  }
  const built = buildGrid(allToPlace, trie, {
    rows: dims.rows,
    cols: dims.cols,
    minWordLength: 3,
    scoringTrie: topic.trie,
  });

  // Validate first title word against Searchle as initial rankTarget (Phase 1
  // ranks against title words). Words are tried in TIER ORDER (common-noun
  // context-builders first; proper nouns / polysemous words deferred) so the
  // opening rank target gives players the richest semantic neighborhood
  // possible — see src/rank-target-tiering.js for the full system.
  const pickOrder = orderByRankTier(round.titleWords, round.titleWordsRaw || []);
  let rankTarget = null;
  let totalRankedWords = 0;
  // Use persisted known-good title words immediately; only probe words we
  // haven't seen before. This avoids hammering Searchle with the same title
  // words on every round build.
  for (const w of pickOrder) {
    if (!w || isKnownUnrankable(w)) continue;
    if (isKnownRankable(w)) {
      rankTarget = w;
      break;
    }
  }
  if (!rankTarget) {
    const unknownTitleWords = pickOrder.filter((w) => w && !isKnownRankable(w) && !isKnownUnrankable(w));
    const titleProbes = await Promise.all(
      unknownTitleWords.map((w) => rankBatch(w, []).then((data) => ({ w, ok: true, data })).catch((e) => ({ w, ok: false, err: e })))
    );
    for (const { w, ok, data, err } of titleProbes) {
      if (ok) {
        rankTarget = w;
        totalRankedWords = data.totalRankedWords || 0;
        break;
      }
      console.log(`[Round] title word "${w}" not rankable by Searchle: ${err && err.message}`);
    }
  }
  // Fallback: try round body targets if no title word is rankable
  if (!rankTarget) {
    const targetProbes = await Promise.all(
      round.targets
        .filter((t) => t && t.word)
        .map((t) => rankBatch(t.word, []).then((data) => ({ word: t.word, ok: true, data })).catch(() => ({ word: t.word, ok: false })))
    );
    for (const { word, ok, data } of targetProbes) {
      if (ok) {
        rankTarget = word;
        totalRankedWords = data.totalRankedWords || 0;
        break;
      }
    }
  }
  if (!rankTarget) {
    throw new Error('No title or target word is rankable by Searchle');
  }
  // Fetch total ranked vocabulary for the chosen target. Use a fallback so
  // a slow Searchle response doesn't kill the round; closeness bars may be
  // slightly off but the game remains playable.
  try {
    const probe = await rankBatch(rankTarget, []);
    totalRankedWords = probe.totalRankedWords || 0;
  } catch (e) {
    console.log(`[Round] rankTarget probe failed for "${rankTarget}": ${e.message}`);
    totalRankedWords = FALLBACK_TOTAL_RANKED;
  }

  return {
    grid: built.grid,
    rows: built.rows,
    cols: built.cols,
    allWords: built.allWords,
    targetPaths: built.targetPaths,
    targets: round.targets,
    articleTitle: round.title,
    articleKey: round.key,
    articlePlaintext: round.plaintext,
    titleWords: round.titleWords,
    titleWordsRaw: round.titleWordsRaw || [],
    totalRankedWords,
    rankTarget,
    topicTrie: topic.trie,
    semanticWordCount: topic.size,
    semanticTrieSource: topic.source,
  };
}

async function buildRoundResilient(opts) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await buildRoundOnce(opts);
    } catch (e) {
      console.log(`[Round] build attempt ${attempt + 1}/6 failed: ${e.message}`);
    }
  }
  throw new Error('All round-build attempts failed');
}

const DEFAULT_ROUND_BUILD_OPTS = {
  maxTotalLetters: 72,
  rows: null,
  cols: null,
};

class RoundRunner {
  constructor(opts = {}) {
    const {
      label = 'public',
      mode = 'public',
      roomHandle = null,
      broadcast,
      autoLoop = true,
      holdAfterWinMs = HOLD_AFTER_WIN_MS_DEFAULT,
      roundTimeoutMs = ROUND_TIMEOUT_MS_DEFAULT,
      targetCount = 5,
      enableElo = true,
      roundBuildOpts = {},
      roundBuilder = null,
    } = opts;
    this.label = label;
    this.mode = mode;
    this.roomHandle = roomHandle;
    this.broadcast = typeof broadcast === 'function' ? broadcast : () => {};
    this.autoLoop = autoLoop;
    this.holdAfterWinMs = holdAfterWinMs;
    this.roundTimeoutMs = roundTimeoutMs;
    this.targetCount = targetCount;
    this.enableElo = enableElo;
    this.roundBuildOpts = { ...DEFAULT_ROUND_BUILD_OPTS, ...roundBuildOpts };
    this.roundBuilder = roundBuilder || buildArticleRound;
    this.gameLabel = opts.gameLabel || null;
    this.gameName = opts.gameName || null;

    this.game = null;
    this._actionScope = 'round:' + crypto.randomUUID();
    this.nextRoundPromise = null;
    this.nextRoundTimer = null;
    this.roundTimeoutTimer = null;
    this.endedAt = 0;
    this.lastActivityAt = 0;

    this._stateBroadcastTimer = null;
    this._persistTimer = null;
    this._advanceRankTargetPromise = null;
    this._advanceRankTargetGame = null;
  }

  // Coalesce full-state broadcasts so a burst of guesses doesn't emit a huge
  // payload for every single one. Still sends immediately on round-start/end.
  _scheduleStateBroadcast() {
    if (this._stateBroadcastTimer) return;
    this._stateBroadcastTimer = setTimeout(() => {
      this._stateBroadcastTimer = null;
      if (this.game) this.broadcast('state', this.publicState());
    }, 200);
  }

  _persistStateSoon() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistState();
    }, 5000);
  }

  preloadNextRound() {
    if (this.nextRoundPromise) return this.nextRoundPromise;
    this.nextRoundPromise = buildRoundResilient({ targetCount: this.targetCount, roundBuilder: this.roundBuilder, ...this.roundBuildOpts }).catch((e) => {
      console.log(`[${this.label}] preload failed: ${e.message}`);
      this.nextRoundPromise = null;
      throw e;
    });
    return this.nextRoundPromise;
  }

  async startRound() {
    let payload;
    try {
      payload = await (this.nextRoundPromise || this.preloadNextRound());
    } catch (e) {
      if (this.autoLoop) {
        console.log(`[${this.label}] startRound failed; retrying in 10s`);
        setTimeout(() => this.startRound(), 10_000);
      }
      return;
    }
    this.nextRoundPromise = null;

    const previousGame = this.game;
    const previousEndedAt = this.endedAt;
    this.endedAt = 0;
    this.game = new Game();
    this.game.initialize({ ...payload, frequencyMap: wordlist.getFrequencyMap(), mode: this.mode });
    const newGame = this.game;
    try { durability.accept(() => {
    newGame.roundId = db.insertRound({
      articleTitle: payload.articleTitle,
      articleKey: payload.articleKey,
      articlePlaintext: payload.articlePlaintext || '',
      rows: payload.rows,
      cols: payload.cols,
      grid: payload.grid,
      targets: payload.targets,
      titleWords: payload.titleWords,
      totalGridWords: payload.allWords.size,
      roomHandle: this.roomHandle,
      mode: this.mode,
    });
    db.updateRoundState(newGame.roundId, JSON.stringify(newGame.snapshot()));
    }); } catch (error) { this.game = previousGame; this.endedAt = previousEndedAt; throw error; }
    this.lastActivityAt = Date.now();

    console.log(`[${this.label}] Opened round #${this.game.roundId}: "${payload.articleTitle}" (${payload.targets.length} targets, ${payload.rows}x${payload.cols} grid, ${payload.allWords.size} discoverable words)`);

    this.broadcast('round-start', this.publicState());

    if (this.roundTimeoutTimer) clearTimeout(this.roundTimeoutTimer);
    if (this.roundTimeoutMs > 0) {
      this.roundTimeoutTimer = setTimeout(() => {
        console.log(`[${this.label}] timeout — forcing round end`);
        this.endRound("timeout");
    });
    }

    if (this.autoLoop) this.preloadNextRound();
  }

  endRound(reason) {
    if (!this.game) return;
    if (this.endedAt) return; // already ended this round — guard against re-entry
    if (this.roundTimeoutTimer) { clearTimeout(this.roundTimeoutTimer); this.roundTimeoutTimer = null; }
    if (this._stateBroadcastTimer) { clearTimeout(this._stateBroadcastTimer); this._stateBroadcastTimer = null; }
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    const finishedGame = this.game;
    console.log(`[${this.label}] Ended (${reason}): "${finishedGame.articleTitle}"`);

    if (finishedGame.roundId) {
      const winner = finishedGame.getTopPlayers()[0];
      const winSession = winner ? { platform: winner.platform, platformUserId: winner.platformUserId?.startsWith(winner.platform + ':') ? winner.platformUserId.slice(winner.platform.length + 1) : winner.platformUserId, displayName: winner.displayName } : null;
      const winIntent = reason === 'complete' ? durability.intention(finishedGame, 'win', winSession, 1000, 'win', {guessCount:finishedGame.foundWords.size,word:finishedGame.articleTitle||'',score:winner?.score||0}) : null;
      const finalParticipants = finishedGame.getTopPlayers().map((p) => ({
        identityKey: p.platformUserId,
        displayName: p.displayName,
        profileImage: p.profileImage,
        platform: p.platform,
        score: p.score,
        xp: p.xp,
        wordCount: p.wordCount,
        targetCount: p.targetCount,
        titleWordCount: p.titleWordCount,
      }));
      durability.accept(() => {
        db.updateRoundState(finishedGame.roundId, JSON.stringify(finishedGame.snapshot()));
        db.endRound(finishedGame.roundId, reason === 'complete' ? 'complete' : reason, finalParticipants);
      }, [winIntent]);

      if (this.enableElo && elo.isEnabled()) {
        const detail = db.getRoundDetail(finishedGame.roundId) || {};
        const findsForElo = (detail.foundWords || []).map((f) => ({
          identityKey: f.identity_key, foundAt: f.found_at, word: f.word,
        }));
        const normalized = (detail.participants || []).map((p) => ({
          identityKey: p.identity_key,
          displayName: p.display_name,
          profileImage: p.profile_image,
          platform: p.platform,
          score: p.score, xp: p.xp,
          wordCount: p.word_count, targetCount: p.target_count, titleWordCount: p.title_word_count,
          finalRank: p.final_rank,
        }));
        elo.reportRound({
          roundId: finishedGame.roundId,
          articleTitle: finishedGame.articleTitle,
          startedAt: finishedGame.startTime,
          participants: normalized,
          foundWords: findsForElo,
        }).catch((e) => console.log(`[ELO] reportRound threw: ${e.message}`));
      }
    }

    this.broadcast('round-end', {
      reason,
      state: this.publicState(),
      reveal: {
        titleWords: finishedGame.titleWords,
        targets: [...finishedGame.targetByWord.values()],
      },
    });

    // game-win payload powers session-win-card (in-page) + chat-relay's
    // /win-overlay?streamer=<handle> (OBS browser source). Emit on every
    // round end where we have a winner.
    if (reason === 'complete') {
      try {
        const topPlayers = finishedGame.getTopPlayers().slice(0, 10).map((p) => ({
          displayName: p.displayName,
          profilePic: p.profileImage || null,
          platform: p.platform || 'web',
          platformUserId: p.platformUserId,
          isFanClub: !!p.isFanClub,
          points: p.score || 0,
        }));
        const winner = topPlayers[0] || null;
        if (winner) {
          const winPayload = {
            game: this.gameLabel || (this.mode === 'wikiword' ? 'wikiword' : 'wikirectangled'),
            gameName: this.gameName || (this.mode === 'wikiword' ? 'WikiWord' : 'WiKirecTangled'),
            word: finishedGame.articleTitle || '',
            winner: { displayName: winner.displayName, profilePic: winner.profilePic, platform: winner.platform, platformUserId: winner.platformUserId, isFanClub: !!winner.isFanClub, points: winner.points || 0 },
            guessCount: finishedGame.foundWords ? finishedGame.foundWords.size : 0,
            isDaily: false,
            topPlayers,
            streamerHandle: this.roomHandle || null,
          };
          this.broadcast('game-win', winPayload);
          if (this.roomHandle && (this.mode === 'streamer' || this.mode === 'wikiword-4x4')) {
            try { relay.emit('game-win', winPayload); } catch (e) {}
          }


        }
      } catch (e) {
        console.log(`[${this.label}] game-win emit failed: ${e.message}`);
      }
    }

    this.endedAt = Date.now();

    if (this.autoLoop) {
      if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
      this.nextRoundTimer = setTimeout(() => {
        this.nextRoundTimer = null;
        this.startRound();
      }, this.holdAfterWinMs);
    }
  }

  // Snapshot mutable game state to the rounds row. Cheap (sql.js in-memory,
  // debounced disk flush) so we just call it after every state-changing
  // guess + after rankTarget advancement.
  _persistState() {
    if (!this.game || !this.game.roundId) return;
    durability.accept(() => db.updateRoundState(this.game.roundId, JSON.stringify(this.game.snapshot())));
  }

  // Resume an active round from the DB. `row` is one entry from
  // db.getActiveRounds() — it has parsed grid/targets/titleWords + the
  // optional state blob. The runner takes ownership of this round and
  // broadcasts a fresh round-start so reconnecting clients see live state.
  async resumeRound(row) {
    if (!row || !row.id) throw new Error('resumeRound: bad row');
    const trie = wordlist.getTrie();
    if (!trie || trie.wordCount < 1000) throw new Error('resumeRound: trie not ready');
    const topic = row.state?.objectives?.allWords ? { trie: null, size: row.state.objectives.allWords.length } : await buildSemanticTrie({
      titleWords: row.titleWords || [],
      baseTrie: trie,
      rankTop,
      frequencyMap: wordlist.getFrequencyMap(),
    });
    if (topic.fellBack) {
      console.log(`[${this.label}] semantic trie undersized (${topic.size} semantic words) while resuming "${row.article_title}"`);
    }
    const allWords = row.state?.objectives?.allWords ? new Map(row.state.objectives.allWords) : findAllWords(row.grid, row.rows, row.cols, trie, 3);

    // Rebuild targetPaths for title + target words. Without this, proper-noun
    // titles (not in the trie, so absent from allWords) lose their start-cell
    // outlines in the title-only stage.
    const targetPaths = {};
    const _seedWords = [
      ...((row.titleWords || []).filter(Boolean)),
      ...((row.targets || []).map((t) => t && t.word).filter(Boolean)),
    ];
    for (const w of _seedWords) {
      if (!w || targetPaths[w]) continue;
      // Prefer the trie-found path if available (allWords); fall back to direct search.
      const fromAll = allWords && allWords.get(w);
      if (Array.isArray(fromAll) && fromAll.length) { targetPaths[w] = fromAll; continue; }
      const p = findWordPath(row.grid, row.rows, row.cols, w);
      if (p && p.length) targetPaths[w] = p;
    }

    const payload = {
      grid: row.grid,
      rows: row.rows,
      cols: row.cols,
      allWords,
      targetPaths,
      targets: row.targets || [],
      articleTitle: row.article_title,
      articleKey: row.article_key,
      articlePlaintext: row.article_plaintext || row.state?.articlePlaintext || '',
      titleWords: row.titleWords || [],
      totalRankedWords: (row.state && row.state.totalRankedWords) || 0,
      rankTarget: (row.state && row.state.rankTarget) || null,
      frequencyMap: wordlist.getFrequencyMap(),
      topicTrie: topic.trie,
    };

    this.endedAt = 0;
    this.game = new Game();
    this.game.initialize({ ...payload, mode: this.mode });
    this.game.roundId = row.id;
    if (row.state) this.game.restoreSnapshot(row.state);

    const reconciled = this.game.reconcileFoundWordIndexes();
    if (reconciled && reconciled.changed) {
      console.log(`[${this.label}] Reconciled resumed round #${this.game.roundId} tiers: common ${reconciled.foundCommon}/${this.game.commonWords.size}, rare ${reconciled.foundRare}/${this.game.rareWords.size}, ultra ${reconciled.foundUltra}/${this.game.ultraRareWords.size}`);
      this._persistStateSoon();
    }
    if (!this.game.isComplete() && this.game.isRankTargetResolved && this.game.isRankTargetResolved()) {
      const staleTarget = this.game.rankTarget;
      console.log(`[${this.label}] Resumed rankTarget "${staleTarget}" was already found; advancing`);
      const next = await this.advanceRankTarget();
      if (!next && this.game && this.game.rankTarget === staleTarget) {
        this.game.rankTarget = null;
        this.game.rankedGuesses = new Map();
        this.game.rankRewardsTaken = new Set();
        this.game.bestNonTop10Rank = Infinity;
        this._persistStateSoon();
      }
    }
    if (this.game.isComplete()) {
      console.log(`[${this.label}] Resumed round #${this.game.roundId} already meets completion target`);
      this.endRound('complete');
      return;
    }
    this.lastActivityAt = Date.now();

    console.log(`[${this.label}] Resumed round #${this.game.roundId}: "${row.article_title}" (${this.game.foundWords.size}/${allWords.size} words found, ${this.game.playerScores.size} players)`);

    this.broadcast('round-start', this.publicState());

    if (this.roundTimeoutTimer) clearTimeout(this.roundTimeoutTimer);
    if (this.roundTimeoutMs > 0) {
      this.roundTimeoutTimer = setTimeout(() => {
        console.log(`[${this.label}] timeout — forcing round end`);
        this.endRound("timeout");
      }, this.roundTimeoutMs);
    }
    if (this.autoLoop) this.preloadNextRound();
  }

  // Apply a guess from the given session. Returns the result (or null if no
  // active round). All DB recording + broadcasting happens here so the calling
  // socket handler / chat bridge stays thin.
  processGuess(input) {
    const generation = this.game?.roundId;
    return durability.serialize(this._actionScope, async () => {
      const original = this.game;
      if (!original || original.roundId !== generation || this.endedAt || this.restoring || input.authorize && !(await input.authorize())) return null;
      const staged = Object.create(this);
      staged.game = durability.cloneGame(original);
      staged._projections = []; staged._rewardIntentions = []; staged._effects = [];
      const broadcasts = []; let completed = false;
      staged.broadcast = (event, payload) => broadcasts.push([event,payload]);
      staged._scheduleStateBroadcast = () => staged.broadcast('state', staged.publicState());
      staged._persistStateSoon = () => {};
      staged._persistState = () => {};
      staged.endRound = () => { completed = true; };
      const result = await staged._processGuessOnce(input);
      if (!result || input.authorize && !(await input.authorize()) || this.game !== original || this.endedAt || this.restoring) return null;
      durability.accept(() => {
        for (const project of staged._projections) project();
        for (const [identityKey, stats] of staged.game.playerScores) db.upsertParticipant(staged.game.roundId, {identityKey,...stats});
        db.updateRoundState(staged.game.roundId, JSON.stringify(staged.game.snapshot()));
      }, staged._rewardIntentions);
      this.game = staged.game; this.lastActivityAt = staged.lastActivityAt;
      for (const [event,payload] of broadcasts) this.broadcast(event,payload);
      if (completed) this.endRound('complete');
      for (const effect of staged._effects) { try { Promise.resolve(effect()).catch(()=>{}); } catch (_) {} }
      return result;
    });
  }

  async _processGuessOnce({ session, word, preResolvedRank = null }) {
    if (!this.game || !word || !session) return null;
    this.lastActivityAt = Date.now();

    const username = session.displayName || `Guest-${session.sessionId.slice(0, 4)}`;
    const norm = String(word || '').trim().toLowerCase();

    // --- Searchle ranking ---
    // Resolve semantic rank BEFORE mutating game state so guess() is fully sync.
    const rankTarget = this.game.rankTarget;
    let rankInfo = preResolvedRank && preResolvedRank.target === rankTarget ? preResolvedRank : null;
    if (!rankInfo && norm && this.game.rankTarget) {
      try {
        const data = await rankBatch(this.game.rankTarget, [norm]);
        const rank = data.ranks && typeof data.ranks[norm] === 'number' ? data.ranks[norm] : null;
        const canonical = data.canonicals && data.canonicals[norm] ? data.canonicals[norm] : norm;
        rankInfo = { rank, canonical };
      } catch (e) {
        console.log(`[Round] Searchle rank failed for "${norm}": ${e.message}`);
        rankInfo = { rank: null, canonical: norm };
      }
    }

    const result = this.game.guess(word, session.platform, session.identityKey, username, username, session.profileImage || null, rankInfo, !!session.isFanClub);

    // Slot-based rank scoring: reward when a guess lands in the displayed
    // top-5 list (positions 1-5 of guesses sorted by their Searchle rank).
    // Same canonical paid only once per rankTarget round.
    if (result && rankInfo && typeof rankInfo.rank === 'number') {
      const myCanonical = (rankInfo.canonical || norm);
      const seenCan = new Set();
      const sorted = [...this.game.rankedGuesses.entries()]
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
      const position = sorted.findIndex((g) => g.canonical === myCanonical) + 1; // 1-based
      const wordPaid = this.game.rankRewardsTaken.has(myCanonical);
      const award = computeRankAward(position, rankInfo.rank, wordPaid);
      if (award.points > 0) {
        if (award.rankClaimed) this.game.rankRewardsTaken.add(myCanonical);
        // Add to player's running score (upsert: seed entry if this is their first scoring action,
        // otherwise pure semantic guessers never accrue score because game.guess() only seeds on grid/title hits)
        const prev = this.game.playerScores.get(session.identityKey) || {
          score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0,
          displayName: username, profileImage: session.profileImage || null, platform: session.platform || null,
          isFanClub: !!session.isFanClub,
        };
        prev.score = (prev.score || 0) + award.points;
        prev.xp = (prev.xp || 0) + Math.round(award.points / 10);
        prev.displayName = username || prev.displayName;
        prev.profileImage = session.profileImage || prev.profileImage;
        prev.platform = session.platform || prev.platform;
        if (session.isFanClub && !prev.isFanClub) prev.isFanClub = true;
        this.game.playerScores.set(session.identityKey, prev);
        // Surface in the result so the client can show it
        if (typeof result === 'object') {
          result.rankPoints = award.points;
          result.points = (result.points || 0) + award.points;
          if (result.breakdown) result.breakdown.rank = award.points;
        }
      }
    }

    this.broadcast('guess-result', {
      ...result,
      by: {
        identityKey: session.identityKey,
        displayName: username,
        profileImage: session.profileImage || null,
        platform: session.platform,
        platformUserId: session.platformUserId,
      },
    });

    // Advance rankTarget if the just-found target was the current rankTarget.
    let rankTargetAdvanced = false;
    if ((result.result === 'correct' || result.result === 'already_found') && this.game && !this.game.isComplete() && this.game.rankTarget) {
      const candidates = [];
      if (result.word) candidates.push(result.word);
      if (rankInfo && rankInfo.canonical) candidates.push(rankInfo.canonical);
      const rankTargetFound = candidates.includes(this.game.rankTarget)
        || (this.game.isRankTargetResolved && this.game.isRankTargetResolved());
      const allTitlesRevealed = this.game.titleWords
        && this.game.revealedTitleWords.size >= this.game.titleWords.length;
      const rankTargetIsTitle = this.game.titleWordSet && this.game.titleWordSet.has(this.game.rankTarget);
      const phase2JustEntered = allTitlesRevealed && rankTargetIsTitle;
      if (rankTargetFound || phase2JustEntered) {
        const next = await this.advanceRankTarget();
        rankTargetAdvanced = !!next;
      }
    }

    // Broadcast state for every guess that changes the ranked list, but
    // coalesce rapid guesses into a single payload.
    if (rankTargetAdvanced) {
      this.broadcast('state', this.publicState());
    } else if (result.result !== 'too_short' && result.result !== 'already_found') {
      this._scheduleStateBroadcast();
    }

    if (result.result === 'correct' && this.game.roundId) {
      this._projections.push(() => db.recordFind(this.game.roundId, {
        identityKey: session.identityKey,
        word: result.word,
        points: result.points,
        isTarget: result.isTarget,
        isTitleWord: result.isTitleWord,
        targetPosition: result.target ? result.target.position : null,
        foundAt: Date.now(),
      }));
      const playerStats = this.game.playerScores.get(session.identityKey);
      if (playerStats) {
        this._projections.push(() => db.upsertParticipant(this.game.roundId, {
          identityKey: session.identityKey,
          displayName: playerStats.displayName,
          profileImage: playerStats.profileImage,
          platform: playerStats.platform,
          score: playerStats.score,
          xp: playerStats.xp,
          wordCount: playerStats.wordCount,
          targetCount: playerStats.targetCount,
          titleWordCount: playerStats.titleWordCount,
        }));
      }
      if (this.game.isComplete()) this.endRound('complete');

      // Feed the player's library + coin balance via chat-relay's gameShared.
      // Per-tier coin amounts mirror rectangled: 3-letter 50 / common 100 /
      // rare 250 / ultra 500. Title-word reveal gets a bigger 750 (matches the
      // "headline reward" framing).
      try {
        // Mirror eRecTangled scoring: per-tier base + letter-rarity + length bonuses.
        // Tier base values inverted by design (common pays the most among non-title finds).
        const breakdown = result.breakdown || {};
        let _baseCoin;
        if (result.isTitleWord) _baseCoin = 750;        // article-title special — preserve
        else if (breakdown.tierName === 'three')   _baseCoin = 100;
        else if (breakdown.tierName === 'common')  _baseCoin = 1500;
        else if (breakdown.tierName === 'rare')    _baseCoin = 500;
        else if (breakdown.tierName === 'ultra')   _baseCoin = 1000;
        else _baseCoin = 100;                            // hidden / unknown tier — fallback
        const _letterBonus = (gameShared.getLetterRarityBonus(result.word) || {}).bonus || 0;
        const _lengthBonus = gameShared.getWordLengthBonus(result.word) || 0;
        let coins = _baseCoin + _letterBonus + _lengthBonus;
        this._rewardIntentions.push(durability.intention(this.game, 'word:' + result.word, session, coins, result.isTitleWord ? 'title' : 'word', {word:result.word,tier:breakdown.tierName||null}));
        this._effects.push(() => gameShared.reportLibraryWord(
          session.platform || 'web',
          session.platformUserId,
          result.word,
          'wikirectangled',
          username,
          session.displayName || username,
          null
        ));
      } catch (e) {
        // Coin/library failures shouldn't block gameplay.
      }

      // Sassie: emit game-event so the AI commentary monitor + event-overlay
      // can react. Mirrors WikiSearchle's pattern (wikisearchle/server.js).
      // chat-relay's sassie-forwarder filters by livestream platform, so web
      // players are silently skipped — this still fires for tiktok/youtube/twitch
      // chat guesses routed through processGuessFromChat.
      try {
        const sassieUser = {
          displayName: session.displayName || username,
          platform: session.platform || 'web',
          platformUserId: session.platformUserId || null,
          uid: session.platformUserId || null,
          odid: (session.platform === 'discord') ? session.platformUserId : null,
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
          // hidden-tier dictionary word (no Zipf data) — treat like ultra
          evName = 'ultra_rare_word_found'; pri = 'high'; flags = { isHidden: true };
        }
        if (evName) {
          this._effects.push(() => relay.emit('game-event', {
            game: 'wikirectangled',
            eventName: evName,
            data: {
              user: sassieUser,
              streamerHandle: this.roomHandle || null,
              roomMode: this.mode || 'public',
              guess: result.word,
              word: result.word,
              score: result.points || 0,
              rank: (rankInfo && typeof rankInfo.rank === 'number') ? rankInfo.rank : undefined,
              ...flags,
            },
            priority: pri,
          }));
        }
      } catch (e) { /* sassie emit failures shouldn't block gameplay */ }
    }

    // Persist mutable game state for crash-resume. Cheap; called per-guess.
    this._persistState();

    return result;
  }

  async advanceRankTarget() {
    const game = this.game;
    if (!game) return null;

    // Several guesses can resolve the current target while the next candidate
    // is still being probed. Share that transition so it only resets rank state
    // and announces the new target once for this round.
    if (this._advanceRankTargetPromise && this._advanceRankTargetGame === game) {
      return this._advanceRankTargetPromise;
    }

    const pending = this._advanceRankTargetOnce(game);
    this._advanceRankTargetPromise = pending;
    this._advanceRankTargetGame = game;
    try {
      return await pending;
    } finally {
      if (this._advanceRankTargetPromise === pending) {
        this._advanceRankTargetPromise = null;
        this._advanceRankTargetGame = null;
      }
    }
  }

  async _advanceRankTargetOnce(game) {
    if (!game.excludedRankTargets) game.excludedRankTargets = new Set();

    // Phase 1: try next unrevealed title word in TIER ORDER (common-noun
    // context-builders first, proper nouns / polysemous words deferred to the
    // end of the rotation). See src/rank-target-tiering.js for the system.
    // Falls back to article-title order if titleWordsRaw isn't available
    // (e.g. rounds restored from pre-tiering DB rows).
    if (game.titleWords && game.titleWords.length > 0
        && game.revealedTitleWords.size < game.titleWords.length) {
      const pickOrder = orderByRankTier(game.titleWords, game.titleWordsRaw || []);
      const candidates = pickOrder.filter((w) => w && w !== game.rankTarget
        && !game.revealedTitleWords.has(w)
        && !game.excludedRankTargets.has(w)
        && !isKnownUnrankable(w));
      // Immediate known-good wins.
      for (const w of candidates) {
        if (isKnownRankable(w)) {
          game.rankTarget = w;
          game.rankedGuesses = new Map();
          game.rankRewardsTaken = new Set();
          game.bestNonTop10Rank = Infinity;
          console.log(`[${this.label}] rankTarget advanced to title word "${w}"`);
          this._persistStateSoon();
          return w;
        }
      }
      // Probe the rest in parallel.
      const unknownCandidates = candidates.filter((w) => !isKnownRankable(w));
      const probes = await Promise.all(
        unknownCandidates.map((w) => rankBatch(w, []).then((data) => ({ w, ok: true, data })).catch(() => ({ w, ok: false })))
      );
      if (this.game !== game) return null;
      const successByWord = new Map(probes.filter((p) => p.ok).map((p) => [p.w, p.data]));
      for (const w of unknownCandidates) {
        const data = successByWord.get(w);
        if (!data) {
          game.excludedRankTargets.add(w);
          continue;
        }
        game.rankTarget = w;
        game.totalRankedWords = data.totalRankedWords || 0;
        game.rankedGuesses = new Map();
        game.rankRewardsTaken = new Set();
        game.bestNonTop10Rank = Infinity;
        console.log(`[${this.label}] rankTarget advanced to title word "${w}"`);
        this._persistStateSoon();
        return w;
      }
      // No unrevealed title word rankable — fall through to phase 2
    }

    // Phase 2: cascade titles → ultras → rares → commons (rarest available)
    const freq = game.frequencyMap || new Map();
    const tiers = [
      { name: "common", map: game.commonWords,   found: game.foundCommon },
      { name: "rare",   map: game.rareWords,     found: game.foundRare },
      { name: "ultra",  map: game.ultraRareWords, found: game.foundUltra },
    ];
    for (const tier of tiers) {
      if (!tier.map || tier.map.size === 0) continue;
      const unfound = [...tier.map.keys()]
        .filter((w) => (!tier.found || !tier.found.has(w)) && (!game.foundWords || !game.foundWords.has(w)))
        .sort((a, b) => {
          const fa = freq.get(a);
          const fb = freq.get(b);
          const va = typeof fa === 'number' ? fa : 99;
          const vb = typeof fb === 'number' ? fb : 99;
          return va - vb || a.localeCompare(b);
        });
      const candidates = unfound.filter((w) => w && w !== game.rankTarget && !game.excludedRankTargets.has(w));
      const probes = await Promise.all(
        candidates.map((w) => rankBatch(w, []).then((data) => ({ w, ok: true, data })).catch(() => ({ w, ok: false })))
      );
      if (this.game !== game) return null;
      const successByWord = new Map(probes.filter((p) => p.ok).map((p) => [p.w, p.data]));
      for (const w of candidates) {
        const data = successByWord.get(w);
        if (!data) {
          game.excludedRankTargets.add(w);
          continue;
        }
        game.rankTarget = w;
        game.totalRankedWords = data.totalRankedWords || 0;
        game.rankedGuesses = new Map();
        game.rankRewardsTaken = new Set();
        game.bestNonTop10Rank = Infinity;
        console.log(`[${this.label}] rankTarget advanced to ${tier.name} "${w}"`);
        this._persistStateSoon();
        return w;
      }
    }
    return null;
  }

  async processBatch({ session, words, authorize = null }) {
    if (!this.game || !session || !Array.isArray(words) || words.length === 0) return null;
    const seen = new Set();
    const norms = [];
    for (const w of words) {
      const n = String(w || '').trim().toLowerCase();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      norms.push(n);
      if (norms.length >= 50) break;
    }
    if (!norms.length) return null;

    const original = this.game;
    const target = original.rankTarget;
    const preMap = new Map();
    if (this.game.rankTarget) {
      try {
        const data = await rankBatch(target, norms);
        for (const n of norms) {
          const rank = data.ranks && typeof data.ranks[n] === 'number' ? data.ranks[n] : null;
          const canonical = data.canonicals && data.canonicals[n] ? data.canonicals[n] : n;
          preMap.set(n, { rank, canonical, target });
        }
      } catch (e) {
        console.log(`[Round] batch Searchle rank failed: ${e.message}`);
        for (const n of norms) preMap.set(n, { rank: null, canonical: n });
      }
    }

    const results = [];
    for (let i = 0; i < norms.length; i++) {
      const norm = norms[i];
      if (this.game.roundId !== original.roundId || this.endedAt) break;
      const r = await this.processGuess({ session, word: norm, preResolvedRank: preMap.get(norm) || null, authorize });
      results.push(r);
      if (!this.game) break;
      if (i < norms.length - 1) await new Promise((res) => setTimeout(res, 20));
    }
    return results;
  }

  publicState() {
    if (!this.game) return null;
    const s = this.game.getState();
    s.mode = this.mode;
    s.roomHandle = this.roomHandle;
    return s;
  }

  // Stop the runner cleanly — used when shutting down a streamer room or
  // server. Cancels timers but does NOT roll the active round to a finalized
  // status (caller decides whether to endRound first).
  shutdown() {
    if (this.roundTimeoutTimer) clearTimeout(this.roundTimeoutTimer);
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.roundTimeoutTimer = null;
    this.nextRoundTimer = null;
    this.nextRoundPromise = null;
  }
}

module.exports = { RoundRunner };
