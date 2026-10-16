// ===== Game Manager =====
// Game state, win detection, persistence, shuffle bag, and win history.

const path = require('path');
const fs = require('fs');
const rankingEngine = require('./ranking-engine');
const { toSingular, toAmerican, resolveRank } = require('./guess-processor');
const spManager = require('./sp-manager');
const { loadCuratedTargets, mergeTargets } = require('./curated-targets');
const { requireRelayOrShared, resolveRelayOrShared } = require('./shared-resolver');
const GAME_WORD_POLICY_ID = process.env.GAME_WORD_POLICY_ID || 'searchle';

// Dual-meaning proper-noun filter — words that exist as common nouns/verbs
// but are also famous proper nouns (people / places / brands / characters).
// Keeps the target pool unambiguous so players don't get e.g. "phoenix" the
// city or "ford" the car company as a target. Auto-applied during
// loadTargetWords() — wikirec/wikisearchle don't use this filter.
const SEARCHLE_DUAL_MEANING_BLOCK = new Set([
  'apple','arctic','aurora','china','earl','ford','frank','grace','hazel','heather',
  'hunter','jack','lily','mark','marvel','mason','oracle','origin','peach','phoenix',
  'potter','rocky','sonic','steam','subway','target','texas','turkey','violet','willow','zoom',
  'calif','twain', // Calif. the abbreviation / Mark Twain
  'goth','statin','tech', // word-bank targets excluded from Searchle by request (2026-07-16)
]);

let gameWordPolicy = { isWordBlockedForGame: () => false };
try {
  gameWordPolicy = requireRelayOrShared('src/game-word-policy.js');
} catch (error) {
  console.warn('[GameManager] Word policy unavailable:', error.message);
}

let _io = null; // stored reference for preloadNextGame to emit events

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const SAVE_PATH = path.join(DATA_DIR, 'game-state.json');
const PENDING_GAME_PATH = path.join(DATA_DIR, 'pending-game.json');
const PLAYED_WORDS_PATH = path.join(DATA_DIR, 'played-words.json');
const TARGETS_PATH = path.join(DATA_DIR, 'target-words.json');
const EASY_TARGETS_PATH = process.env.SEARCHLE_EASY_TARGETS || resolveRelayOrShared('data/word-bank/searchle-easy-targets.json');
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const CHAT_RELAY_PUBLIC_URL = process.env.CHAT_RELAY_PUBLIC_URL || 'https://wordtycoon.live';

/**
 * Rewrite relative Chat Relay avatar URLs to absolute URLs.
 * TikTok avatars are proxied through Chat Relay at /api/avatar/<platform>/<userId>.
 * Game servers receive these as relative paths, but clients need absolute URLs.
 */
function fixAvatarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/avatar/')) {
    const base = CHAT_RELAY_PUBLIC_URL.endsWith('/') ? CHAT_RELAY_PUBLIC_URL.slice(0, -1) : CHAT_RELAY_PUBLIC_URL;
    return base + url;
  }
  return url;
}

function fixGuessAvatars(guess) {
  if (!guess) return;
  if (guess.user && guess.user.profilePic) {
    guess.user.profilePic = fixAvatarUrl(guess.user.profilePic);
  }
  if (guess.lastBumper && guess.lastBumper.profilePic) {
    guess.lastBumper.profilePic = fixAvatarUrl(guess.lastBumper.profilePic);
  }
}

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// Target words — loaded async from word bank API (fallback to local file)
let targetWords = [];
let publicTargetWords = [];
let publicTargetWordSet = new Set();

function _loadEasyTargetSet() {
  try {
    const raw = JSON.parse(fs.readFileSync(EASY_TARGETS_PATH, 'utf-8'));
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      [...raw, ...loadCuratedTargets()]
        .map((word) => String(word || '').toLowerCase().trim())
        .filter((word) => word.length >= 4 && /^[a-z]+$/.test(word))
    );
  } catch (err) {
    console.warn(`[Boot] Searchle easy target list unavailable (${EASY_TARGETS_PATH}): ${err.message}`);
    return new Set();
  }
}

function refreshPublicTargetWords() {
  const easyTargets = _loadEasyTargetSet();
  publicTargetWords = easyTargets.size > 0
    ? targetWords.filter((word) => easyTargets.has(word))
    : [];

  if (publicTargetWords.length === 0) {
    publicTargetWords = targetWords.slice();
    console.warn(`[Boot] Public Searchle easy pool empty; using full target pool (${publicTargetWords.length} words)`);
  } else {
    console.log(`[Boot] ${publicTargetWords.length} easy target words available for public Searchle games`);
  }

  publicTargetWordSet = new Set(publicTargetWords);
}

function getPublicTargetPool() {
  return publicTargetWords.length > 0 ? publicTargetWords : targetWords;
}

function isPublicTargetWord(word) {
  const normalized = String(word || '').toLowerCase().trim();
  return publicTargetWordSet.size > 0 ? publicTargetWordSet.has(normalized) : targetWords.includes(normalized);
}

async function loadTargetWords() {
  // Try word bank API first (same source as all other games)
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/targets`, {redirect:'error',signal:AbortSignal.timeout(5000)});
    if (res.ok) {
      const data = await res.json();
      // API returns { "3": [...], "4": [...], ... } — flatten to single array
      const allWords = [];
      if (typeof data === 'object' && !Array.isArray(data)) {
        for (const len of Object.keys(data)) {
          const arr = data[len];
          if (Array.isArray(arr)) {
            for (const w of arr) {
              const lw = w.toLowerCase().trim();
              if (lw.length >= 4 && /^[a-z]+$/.test(lw) && !gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'target', lw) && !SEARCHLE_DUAL_MEANING_BLOCK.has(lw)) {
                allWords.push(lw);
              }
            }
          }
        }
      } else if (Array.isArray(data)) {
        for (const w of data) {
          const lw = w.toLowerCase().trim();
          if (lw.length >= 4 && /^[a-z]+$/.test(lw) && !gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'target', lw) && !SEARCHLE_DUAL_MEANING_BLOCK.has(lw)) {
            allWords.push(lw);
          }
        }
      }
      if (allWords.length > 0) {
        targetWords = mergeTargets(allWords, loadCuratedTargets(), word =>
          !gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'target', word) && !SEARCHLE_DUAL_MEANING_BLOCK.has(word));
        console.log(`[Boot] ${targetWords.length} target words loaded from word bank API`);
        return;
      }
    }
  } catch (err) {
    console.log(`[Boot] Word bank API unavailable: ${err.message}`);
  }

  // Fallback to local file
  try {
    targetWords = mergeTargets(JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8')), loadCuratedTargets())
      .map((word) => String(word || '').toLowerCase().trim())
      .filter((word) => word.length >= 4 && /^[a-z]+$/.test(word) && !gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'target', word) && !SEARCHLE_DUAL_MEANING_BLOCK.has(word));
    console.log(`[Boot] ${targetWords.length} target words loaded from local file (fallback)`);
  } catch (err) {
    console.error(`[Boot] FATAL: Could not load target words: ${err.message}`);
    targetWords = [];
  }
}

// ---------------------------------------------------------------------------
// Scoring Tables (point-based MP rewards, replaces single-winner pot)
// ---------------------------------------------------------------------------
// First-finder bonus by rank — paid once per game per word, to whichever
// player first guesses that word. Target (rank 1) ends the game; ranks 2-10
// are the high-value "podium pulls". Below rank 10, players earn proximity
// points (smaller, but still rewarded for any close-rank guess).
const RANK_REWARDS = {
  1: 100000,
  2: 90000,
  3: 80000,
  4: 70000,
  5: 60000,
  6: 50000,
  7: 40000,
  8: 30000,
  9: 20000,
  10: 10000,
};
const TARGET_REWARD = RANK_REWARDS[1];

// Flat per-rank baseline — every guess in the rank 11-10000 band earns
// at least this much, just for being close. Climb bonus (below) does
// the heavy lifting for "you actually helped find the target faster".
function proximityPoints(rank) {
  if (!Number.isFinite(rank)) return 0;
  if (rank <= 50) return 100;
  if (rank <= 200) return 60;
  if (rank <= 1000) return 30;
  if (rank <= 5000) return 15;
  if (rank <= 10000) return 5;
  return 0;
}

// Climb bonus — fires only when a guess sets a new best non-top-10 rank.
// Scales linearly with how much of the gap to the previous best was
// closed: halving the rank earns ~half of MAX_CLIMB_BONUS, tiny
// improvements earn tiny bonuses, no improvement earns 0.
//
// First-guess case: when no non-top-10 rank has been claimed yet,
// currentBest comes in as Infinity. We cap it at 10001 so the formula
// behaves the same as if best had just been one rank outside the
// scoring band.
const MAX_CLIMB_BONUS = 5000;

function climbBonus(currentBest, newRank) {
  if (!Number.isFinite(newRank) || newRank < 11 || newRank > 10000) return 0;
  const oldBest = (Number.isFinite(currentBest) && currentBest <= 10001) ? currentBest : 10001;
  if (newRank >= oldBest) return 0;
  const fractionClosed = 1 - (newRank / oldBest);
  return Math.floor(MAX_CLIMB_BONUS * fractionClosed);
}

// awardForGuess returns the XP to add for this guess. Top-10 first finder
// gets the big tier reward; words ranked 11-10000 get proximity baseline
// plus a climb bonus when they improve the current best non-top-10 rank.
// Words ranked > 10000 (or non-finite) earn 0.
function computeRankAward(rank, alreadyTaken, currentBestNonTop10) {
  if (rank >= 1 && rank <= 10) {
    if (!alreadyTaken) return RANK_REWARDS[rank];
    // Slot taken — fall through to proximity tier so the player still gets
    // SOMETHING for guessing a high-quality word.
    return proximityPoints(rank);
  }
  return proximityPoints(rank) + climbBonus(currentBestNonTop10, rank);
}

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------
let game = {
  targetWord: null,
  rankings: null,
  totalRankedWords: 0,
  guesses: [],
  guessedWords: new Set(),
  startTime: null,
  isWon: false,
  winner: null,
  // Per-player accumulated XP for THIS round only. identityKey -> entry.
  // Cleared on every new game in _resetRoundScoring().
  playerScores: new Map(),
  // Set of words that have already paid out a top-10 first-finder bonus
  // (so re-guesses of e.g. the 3rd-closest word don't double-pay 80k).
  paidTopWords: new Set(),
  // Lowest rank seen so far in the 11-10000 band. Drives climb bonuses —
  // a new guess that beats this earns a proportional reward (see
  // climbBonus). Infinity = no non-top-10 guess has landed yet.
  bestNonTop10Rank: Infinity,
};

let lastWinner = {
  user: null,
  word: null,
  guessCount: 0
};

// ---------------------------------------------------------------------------
// Jackpot Toggle (persisted separately — survives new games)
// ---------------------------------------------------------------------------
const SETTINGS_PATH = path.join(DATA_DIR, 'searchle-settings.json');
let jackpotEnabled = true;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      if (typeof data.jackpotEnabled === 'boolean') jackpotEnabled = data.jackpotEnabled;
    }
  } catch {}
}

function saveSettings() {
  try {
    atomicWriteSync(SETTINGS_PATH, { jackpotEnabled });
  } catch (err) {
    console.error('[Settings] Failed to save:', err.message);
  }
}

loadSettings();
console.log(`[Boot] Jackpot ${jackpotEnabled ? 'enabled' : 'disabled'}`);

// ---------------------------------------------------------------------------
// Played Words (shuffle bag)
// ---------------------------------------------------------------------------
function loadPlayedWords() {
  try {
    if (!fs.existsSync(PLAYED_WORDS_PATH)) return new Set();
    const data = JSON.parse(fs.readFileSync(PLAYED_WORDS_PATH, 'utf-8'));
    if (Array.isArray(data)) {
      return new Set(
        data
          .filter((word) => typeof word === 'string')
          .map((word) => word.toLowerCase().trim())
          .filter(Boolean)
      );
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function savePlayedWords() {
  try {
    atomicWriteSync(PLAYED_WORDS_PATH, [...playedWords]);
  } catch (err) {
    console.error('[PlayedWords] Failed to save:', err.message);
  }
}

let playedWords = loadPlayedWords();
// Note: targetWords.length shown after loadTargetWords() completes

// Won words — never repeat in MP (built from win history on boot)
const wonWords = new Set();

// Words excluded from random picking (e.g., SP weekly words — set by server.js)
const excludedWords = new Set();

function setExcludedWords(words) {
  excludedWords.clear();
  for (const w of words) {
    if (w) excludedWords.add(w.toLowerCase());
  }
  if (excludedWords.size > 0) {
    console.log(`[Game] Excluded words updated: ${[...excludedWords].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Win Tracking — Word Tycoon is the single source of truth.
// In-memory state: recent games (for stats drawer) + wonWords (for word exclusion).
// Win counts come from _wtWinCounts (fetched from GOAT API every 5 min).
// ---------------------------------------------------------------------------
let _recentGames = [];       // last 20 MP games: [{ word, guessCount, durationSeconds, displayName, platform, timestamp }]
let _totalMPGames = 0;       // total MP games ever played (from WT)
let _totalMPGuesses = 0;     // sum of all guess counts (for avg calculation)

// Record a win in local memory (no disk I/O — WT DB is the canonical store)
function recordWinLocally(user, word, guessCount, timestamp, durationSeconds) {
  _recentGames.push({
    word,
    guessCount,
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : null,
    displayName: user.displayName || user.username || 'Unknown',
    platform: user.platform || 'unknown',
    timestamp
  });
  if (_recentGames.length > 20) _recentGames.shift();
  _totalMPGames++;
  _totalMPGuesses += (guessCount || 0);

  // Immediate badge update: increment winCounts for this user
  const userId = user.platformUserId || user.id;
  const ld = user.linkedDiscord || null;
  if (ld && _wtWinCounts[ld] != null) {
    _wtWinCounts[ld]++;
  } else if (userId && _wtWinCounts[userId] != null) {
    _wtWinCounts[userId]++;
  } else if (ld) {
    _wtWinCounts[ld] = 1;
  } else if (userId) {
    _wtWinCounts[userId] = 1;
  }

  const leaderboardKey = ld || userId || user.displayName || user.username || 'Unknown';
  const existing = _wtLeaderboard.find(entry => entry.key === leaderboardKey);
  if (existing) {
    existing.wins += 1;
    if (user.displayName) existing.name = user.displayName;
    if (user.profilePic) existing.profilePic = user.profilePic;
  } else {
    _wtLeaderboard.push({
      key: leaderboardKey,
      name: user.displayName || user.username || 'Unknown',
      wins: 1,
      profilePic: user.profilePic || null
    });
  }
  _wtLeaderboard.sort((a, b) => (b.wins || 0) - (a.wins || 0));
}

// Fetch unique won words from Word Tycoon (for MP word exclusion set)
async function fetchWonWords(wordEmpiresUrl, apiKey) {
  try {
    const res = await fetch(`${wordEmpiresUrl}/api/admin/game-won-words?game=searchle`, {
      headers: { 'x-api-key': apiKey, 'x-admin-key': process.env.ADMIN_API_SECRET || apiKey },
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.words)) {
      for (const w of data.words) wonWords.add(w.toLowerCase());
      console.log(`[Boot] ${wonWords.size} unique won words from Word Tycoon (permanently excluded from MP)`);
    }
  } catch (err) {
    console.log('[WonWords] Could not fetch from Word Tycoon:', err.message);
  }
}

// Fetch recent games + stats from Word Tycoon (for stats drawer on boot)
async function fetchRecentGames(wordEmpiresUrl, apiKey) {
  try {
    const res = await fetch(`${wordEmpiresUrl}/api/admin/game-recent?game=searchle&limit=20`, {
      headers: { 'x-api-key': apiKey, 'x-admin-key': process.env.ADMIN_API_SECRET || apiKey },
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      const merged = new Map();
      for (const entry of [...(data.recent || []), ..._recentGames]) merged.set(String(entry.word || '').toLowerCase(), entry);
      _recentGames = [...merged.values()].sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-20);
      _totalMPGames = Math.max(_totalMPGames, data.totalGames || 0);
      _totalMPGuesses = Math.max(_totalMPGuesses, (data.totalGames > 0 && data.avgGuesses) ? data.totalGames * data.avgGuesses : 0);
      console.log(`[Boot] ${_totalMPGames} total games, ${_recentGames.length} recent games from Word Tycoon`);
    }
  } catch (err) {
    console.log('[RecentGames] Could not fetch from Word Tycoon:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Game Persistence (debounced — batches rapid saves into one disk write)
// ---------------------------------------------------------------------------
let _saveTimer = null;
let _saving = false;
const SAVE_DEBOUNCE_MS = 500;
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
let recovery=null;
function setRecovery(value){recovery=value;}
let consumedPendingGame = null;
function snapshotMetadata(){return {consumedPendingGame,lastWinner,playedWords:[...playedWords],wonWords:[...wonWords],recentGames:_recentGames,totalMPGames:_totalMPGames,totalMPGuesses:_totalMPGuesses,winCounts:_wtWinCounts,leaderboard:_wtLeaderboard,jackpotEnabled};}
function restoreMetadata(value){consumedPendingGame=value.consumedPendingGame||null;lastWinner=value.lastWinner;playedWords=new Set(value.playedWords);wonWords.clear();for(const word of value.wonWords)wonWords.add(word);_recentGames=value.recentGames;_totalMPGames=value.totalMPGames;_totalMPGuesses=value.totalMPGuesses;_wtWinCounts=value.winCounts;_wtLeaderboard=value.leaderboard;jackpotEnabled=value.jackpotEnabled;}

function _buildSaveData() {
  return {
    targetWord: game.targetWord,
    totalRankedWords: game.totalRankedWords,
    guesses: game.guesses,
    guessedWords: [...game.guessedWords],
    startTime: game.startTime,
    isWon: game.isWon,
    winner: game.winner,
    lastWinner,
    playerScores:[...game.playerScores],
    paidTopWords:[...game.paidTopWords],
    bestNonTop10Rank:Number.isFinite(game.bestNonTop10Rank)?game.bestNonTop10Rank:null,
    hintLettersRevealed:game.hintLettersRevealed||0,
    algorithmModels: rankingEngine.getActiveModelNames()
  };
}

// Async save — write to tmp file then rename for atomicity
function _doSaveAsync() {
  if (_saving) return; // skip if a write is already in flight
  _saving = true;
  const json = JSON.stringify(_buildSaveData());
  fs.writeFile(SAVE_TMP_PATH, json, (err) => {
    if (err) {
      console.error('[Save] Failed to write tmp:', err.message);
      _saving = false;
      return;
    }
    fs.rename(SAVE_TMP_PATH, SAVE_PATH, (err2) => {
      if (err2) console.error('[Save] Failed to rename:', err2.message);
      _saving = false;
    });
  });
}

// Sync save — for shutdown/critical paths where process may exit immediately
function _doSaveSync() {
  try {
    fs.writeFileSync(SAVE_TMP_PATH, JSON.stringify(_buildSaveData()));
    fs.renameSync(SAVE_TMP_PATH, SAVE_PATH);
  } catch (err) {
    console.error('[Save] Failed to save game state:', err.message);
  }
}

// Debounced save — batches rapid calls (guesses, bumps, cosmetics) into one write
function saveGame() {
  if(recovery?.isRunning())return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _doSaveAsync();
  }, SAVE_DEBOUNCE_MS);
}

// Immediate save — for critical paths (win, new game)
function saveGameImmediate() {
  if(recovery?.isRunning())return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _doSaveAsync();
}

// Sync save — only for shutdown (process about to exit)
function saveGameSync() {
  if(recovery?.isRunning())return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _doSaveSync();
}

// ---------------------------------------------------------------------------
// Pending Game (save current game aside so a forced game can run first)
// ---------------------------------------------------------------------------
function savePendingGame() {
  if (!game.targetWord || game.isWon) return false;
  try {
    atomicWriteSync(PENDING_GAME_PATH, _buildSaveData());
    console.log(`[Save] Pending game saved (${game.guesses.length} guesses, word hidden)`);
    return true;
  } catch (err) {
    console.error('[Save] Failed to save pending game:', err.message);
    return false;
  }
}

function hasPendingGame() {
  return fs.existsSync(PENDING_GAME_PATH);
}

async function loadPendingGame(config, cosmeticsCache, io, mode = null) {
  if (!fs.existsSync(PENDING_GAME_PATH)) return false;
  const bytes = fs.readFileSync(PENDING_GAME_PATH, 'utf8');
  const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if (digest === consumedPendingGame) return false;
  const data = JSON.parse(bytes);
  if (!data.targetWord || !rankingEngine.isValidTarget(data.targetWord) ||
      !isPublicTargetWord(data.targetWord) || data.isWon) return false;
  const previous = game, owner = recovery?.current(previous);
  const rankings = await rankingEngine.computeRankings(data.targetWord, config);
  if (game !== previous || owner && recovery.current(previous)?.roundId !== owner.roundId) {
    throw Error('Searchle round changed while preparing pending game');
  }
  const candidate = {
    targetWord: data.targetWord, rankings, totalRankedWords: rankings.size,
    guesses: data.guesses || [], guessedWords: new Set(data.guessedWords || []),
    startTime: data.startTime, isWon: false, winner: null,
    playerScores: new Map(data.playerScores || []), paidTopWords: new Set(data.paidTopWords || []),
    bestNonTop10Rank: data.bestNonTop10Rank ?? Infinity,
    hintLettersRevealed: data.hintLettersRevealed || 0,
  };
  const metadata = snapshotMetadata();
  try {
    // Replay only legacy files that lacked scoring. No external rewards occur.
    game = candidate;
    if (!Array.isArray(data.playerScores)) {
      for (const guess of candidate.guesses) {
        if (guess.user && !guess.user.isSystem && guess.user.platform !== 'system') awardForGuess(guess.rank, guess.user);
      }
    }
    if (data.lastWinner) lastWinner = data.lastWinner;
    consumedPendingGame = digest;
    if (recovery) recovery.start(candidate, 'public', undefined, false, mode);
  } catch (error) {
    game = previous; restoreMetadata(metadata); throw error;
  }
  // The authoritative consumed digest also prevents replay if unlink fails.
  try { fs.unlinkSync(PENDING_GAME_PATH); } catch { console.warn('[Save] Accepted pending file cleanup deferred'); }
  saveGameImmediate();
  refreshCosmeticsForGuesses(cosmeticsCache, io).catch(() => {});
  return true;
}

async function loadGame(config, cosmeticsCache, io) {
  try {
    const owned=recovery?.load('public');
    if(!owned&&!fs.existsSync(SAVE_PATH))return false;
    const data=owned?require('./round-recovery').decode(owned.state):JSON.parse(fs.readFileSync(SAVE_PATH,'utf8'));

    if (!data.targetWord || !rankingEngine.isValidTarget(data.targetWord)) throw Error('Saved Searchle target needs recovery');
    if (!owned && !isPublicTargetWord(data.targetWord)) {
      console.log('[Save] Retaining accepted game from the previous public pool');
    }


    console.log(`[Save] Restoring game with target (${data.targetWord.length} letters)...`);
    const t0 = Date.now();
    const rankings = await rankingEngine.computeRankings(data.targetWord, config);
    console.log(`[Save] Rankings recomputed in ${Date.now() - t0}ms (${rankings.size.toLocaleString()} words)`);

    const guesses = data.guesses || [];

    const currentModels = rankingEngine.getActiveModelNames().sort().join(',');
    const savedModels = (data.algorithmModels || []).sort().join(',');
    if (currentModels !== savedModels) {
      console.log(`[Save] Algorithm changed (was: ${savedModels || 'legacy'}, now: ${currentModels}), re-ranking ${guesses.length} guesses...`);
    }
    // Stored accepted ranks also own legacy scoring; model changes must not
    // reinterpret an already accepted find or its first-finder slot.

    game = {
      targetWord: data.targetWord,
      rankings,
      totalRankedWords: Number.isSafeInteger(data.totalRankedWords) && data.totalRankedWords > 0 ? data.totalRankedWords : rankings.size,
      guesses,
      guessedWords: new Set(data.guessedWords || []),
      startTime: data.startTime,
      isWon: !!data.isWon,
      winner: data.winner || null,
      // Accepted scoring ownership survives recovery.
      playerScores: new Map(data.playerScores||[]),
      paidTopWords: new Set(data.paidTopWords||[]),
      bestNonTop10Rank: data.bestNonTop10Rank ?? Infinity,
    };

    if(owned)recovery.adopt(game,owned);
    else if(!Array.isArray(data.playerScores)){for(const guess of guesses){if(guess.user&&!guess.user.isSystem&&guess.user.platform!=='system')awardForGuess(guess.rank,guess.user);}}

    if (data.lastWinner) {
      lastWinner = data.lastWinner;
    }

    // Fix relative avatar URLs from old Chat Relay data
    for (const g of game.guesses) {
      fixGuessAvatars(g);
    }
    _avatarFixCursor = game.guesses.length;
    if (lastWinner && lastWinner.user) {
      lastWinner.user.profilePic = fixAvatarUrl(lastWinner.user.profilePic);
    }

    console.log(`[Save] Restored game with ${game.guesses.length} guesses`);

    // Re-fetch cosmetics for all unique players
    refreshCosmeticsForGuesses(cosmeticsCache, io);

    return true;
  } catch (err) {
    throw new Error('Searchle storage needs recovery',{cause:err});
  }
}

async function refreshCosmeticsForGuesses(cosmeticsCache, io) {
  const target = game, owner = recovery?.current(target);
  const players = new Map();
  for (const g of game.guesses) {
    const uid = g.user.id || g.user.username || g.user.displayName;
    if (!uid) continue;
    const key = `${g.user.platform}:${uid}`;
    if (!players.has(key)) players.set(key, { platform: g.user.platform, userId: uid });
  }
  // Also include lastWinner so their cosmetics refresh on reconnect
  if (lastWinner && lastWinner.user) {
    const lwUid = lastWinner.user.id || lastWinner.user.username || lastWinner.user.displayName;
    if (lwUid) {
      const key = `${lastWinner.user.platform}:${lwUid}`;
      if (!players.has(key)) players.set(key, { platform: lastWinner.user.platform, userId: lwUid });
    }
  }
  console.log(`[Cosmetics] Refreshing cosmetics for ${players.size} unique players...`);
  const results = new Map();
  for (const [key, p] of players) {
    results.set(key, await cosmeticsCache.getPlayerCosmetics(p.platform, p.userId));
  }
  if (game !== target || owner && recovery.current(target)?.roundId !== owner.roundId) return;
  let updated = 0;
  for (const g of game.guesses) {
    const uid = g.user.id || g.user.username || g.user.displayName;
    const key = `${g.user.platform}:${uid}`;
    const cos = results.get(key);
    if (cos && Object.keys(cos).length > 0) {
      g.user.cosmetics = cos;
      updated++;
    }
  }
  // Also update lastWinner cosmetics
  if (lastWinner && lastWinner.user) {
    const lwUid = lastWinner.user.id || lastWinner.user.username || lastWinner.user.displayName;
    const key = `${lastWinner.user.platform}:${lwUid}`;
    const cos = results.get(key);
    if (cos && Object.keys(cos).length > 0) {
      lastWinner.user.cosmetics = cos;
      updated++;
      console.log(`[Cosmetics] Updated lastWinner (${lastWinner.user.displayName}) cosmetics: ${Object.keys(cos).join(', ')}`);
    }
  }
  if (updated > 0) {
    console.log(`[Cosmetics] Updated ${updated} entries with cosmetics`);
    saveGame();
    io.to('public').emit('game-state', getGameState());
  } else {
    console.log('[Cosmetics] No cosmetics found for any players');
  }
}

// ---------------------------------------------------------------------------
// Jackpot / Target Reward
// ---------------------------------------------------------------------------
// Point-based MP scoring (RANK_REWARDS above) replaces the old time/guess
// pot growth. The "pot" surfaced via this function is the flat target-find
// reward (rank 1 = 100k). Per-player end-of-game payouts come from
// playerScores accumulated XP, not this single value.
function calculatePot() {
  if (!jackpotEnabled) return 0;
  return TARGET_REWARD;
}

// ---------------------------------------------------------------------------
// New Game — Preload + Activate
// ---------------------------------------------------------------------------

// Preloaded next game data (rankings computed in background during win delay)
let _preloaded = null; // { targetWord, rankings, totalRankedWords, startTime }

// Optional hook fired after a new round opens. Used by server.js to relay
// round-start info (target word + startTime) to Chat Relay for companion games.
let _onRoundStart = null;
function setOnRoundStart(cb) { _onRoundStart = cb; }

function _pickTargetWord(config) {
  const pickPool = getPublicTargetPool().filter(word => rankingEngine.isValidTarget(word));
  if (!pickPool.length) throw Error('No rankable Searchle target words available');
  let pool = pickPool.filter(w => !playedWords.has(w) && !excludedWords.has(w) && !wonWords.has(w));
  if (pool.length === 0) {
    // All remaining words have been played or won — reset shuffle bag
    // (wonWords stay excluded so won words still won't repeat)
    console.log(`[Game] All words played this cycle — resetting shuffle bag`);
    playedWords.clear();
    savePlayedWords();
    pool = pickPool.filter(w => !excludedWords.has(w) && !wonWords.has(w));
    if (pool.length === 0) {
      // Every target word has been won — start fresh (rare: requires 4000+ unique wins)
      console.log(`[Game] All ${pickPool.length} public target words have been won — allowing replays`);
      wonWords.clear();
      pool = pickPool.filter(w => !excludedWords.has(w));
      if (pool.length === 0) throw Error('No eligible Searchle target words available');
    }
  }

  const targetWord = pool[Math.floor(Math.random() * pool.length)];

  playedWords.add(targetWord);
  savePlayedWords();
  return targetWord;
}

let preloadSequence = 0;
// Start computing rankings for the next game immediately (call on win).
// Does NOT switch game state — old game stays active during win delay.
function preloadNextGame(config) {
  const sequence = ++preloadSequence;
  const targetWord = _pickTargetWord(config);
  const startTime = new Date().toISOString();
  console.log(`[Game] Preloading next game: "${targetWord}" (${playedWords.size}/${getPublicTargetPool().length} played this cycle)`);

  const t0 = Date.now();
  const promise = rankingEngine.computeRankings(targetWord, config).then(rankings => {
    console.log(`[Game] Preload rankings computed in ${Date.now() - t0}ms`);
    if (sequence !== preloadSequence) return;
    _preloaded = { targetWord, rankings, totalRankedWords: rankings.size, startTime: null };
    // Save to SP pool so single-player mode benefits from multiplayer games
    const poolResult = spManager.saveToPool(targetWord, rankings);
    if (poolResult && _io) _io.to('public').emit('sp-pool-word-added', poolResult);
  }).catch(() => { if (sequence === preloadSequence) _preloaded = null; console.warn('[Game] Next-round preload deferred'); });
  _preloaded = promise; // store promise until resolved
}

// Activate the new game — uses preloaded data if available, otherwise computes fresh.
async function startNewGame(config, io, mode = null) {
  _io=io;const previous=game,owner=previous.targetWord?recovery?.current(previous):null;
  if(_preloaded&&typeof _preloaded.then==='function')await _preloaded;
  let candidate;
  if(_preloaded?.targetWord){candidate={..._preloaded};}
  else{const targetWord=_pickTargetWord(config),rankings=await rankingEngine.computeRankings(targetWord,config);candidate={targetWord,rankings,totalRankedWords:rankings.size,startTime:new Date().toISOString()};}
  if(game!==previous||owner&&recovery.current(previous)?.roundId!==owner.roundId)throw Error('Searchle round changed while preparing replacement');
  Object.assign(candidate,{guesses:[],guessedWords:new Set(),isWon:false,winner:null,playerScores:new Map(),paidTopWords:new Set(),bestNonTop10Rank:Infinity});
  candidate.startTime ||= new Date().toISOString();
  if(recovery)recovery.start(candidate,'public',undefined,false,mode);
  game=candidate;preloadSequence++;_preloaded=null;_avatarFixCursor=0;saveGameImmediate();
  const poolResult=spManager.saveToPool(candidate.targetWord,candidate.rankings);if(poolResult)io.to('public').emit('sp-pool-word-added',poolResult);
  io.to('public').emit('new-game',{startTime:game.startTime,totalRankedWords:game.totalRankedWords});
  if(_onRoundStart)_onRoundStart({targetWord:game.targetWord,startTime:game.startTime});
}

// ---------------------------------------------------------------------------
// New Game (follower mode — use specific word from primary)
// ---------------------------------------------------------------------------
async function startGameWithWord(targetWord, config, io, startTime, mode = null) {
  // Never replay a word that was already won in MP
  if (wonWords.has(targetWord.toLowerCase())) {
    console.warn(`[Game] Word "${targetWord}" already won — rejecting to prevent replay`);
    return false;
  }

  if (!rankingEngine.isValidTarget(targetWord)) {
    console.error(`[Sync] Target word "${targetWord}" not in any model vocabulary — cannot follow`);
    return false;
  }

  // Don't restart if we're already playing this word
  if (game.targetWord === targetWord && !game.isWon) {
    console.log(`[Sync] Already playing "${targetWord}" — ignoring duplicate`);
    return true;
  }

  console.log(`[Sync] Following primary — starting game with "${targetWord}"`);

  preloadSequence++;
  // Discard any preloaded game — we're overriding with this specific word
  _preloaded = null;

  // Mark as played so _pickTargetWord won't randomly pick it again
  if (!playedWords.has(targetWord)) {
    playedWords.add(targetWord);
    savePlayedWords();
  }

  const previous=game,owner=previous.targetWord?recovery?.current(previous):null;
  const rankings=await rankingEngine.computeRankings(targetWord,config);
  if(game!==previous||owner&&recovery.current(previous)?.roundId!==owner.roundId)throw Error('Searchle round changed while preparing replacement');
  const candidate={targetWord,rankings,totalRankedWords:rankings.size,guesses:[],guessedWords:new Set(),startTime:startTime||new Date().toISOString(),isWon:false,winner:null,playerScores:new Map(),paidTopWords:new Set(),bestNonTop10Rank:Infinity};
  if(recovery)recovery.start(candidate,'public',undefined,false,mode);game=candidate;

  saveGameImmediate();

  io.to('public').emit('new-game', {
    startTime: game.startTime,
    totalRankedWords: game.totalRankedWords,
  });

  if (_onRoundStart) _onRoundStart({ targetWord: game.targetWord, startTime: game.startTime });

  return true;
}

// Force a win on the follower (safety net when primary reports win before follower processes it)
function forceWin(targetWord) {
  if (game.targetWord !== targetWord) return false;
  if (game.isWon) return true; // already won
  if (recovery) {
    const at = Date.now();
    recovery.run(game, () => { game.isWon = true; }, {
      completion: () => ({ at, nextRoundAt: at + 8000, payouts: [], legacy: true }),
    });
  } else game.isWon = true;
  saveGameImmediate();
  return true;
}

// ---------------------------------------------------------------------------
// Canonical Win Counts (from Word Tycoon — source of truth for GOAT/Hall of Fame)
// ---------------------------------------------------------------------------
let _wtWinCounts = {};        // { discordId: searchleWinCount }
let _wtLeaderboard = [];      // [{ name, wins, profilePic }] sorted desc
let _wtEloLeaderboard = [];   // [{ identityKey, elo, roundsCounted, nickname }] from WT ELO

async function fetchWinCounts(wordEmpiresUrl, apiKey) {
  try {
    const res = await fetch(`${wordEmpiresUrl}/api/goat?page=1&limit=500&sort=searchle`, {
      headers: { 'x-api-key': apiKey, 'x-admin-key': process.env.ADMIN_API_SECRET || apiKey },
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.players)) return;

    const counts = {};
    const leaderboard = [];
    for (const p of data.players) {
      const wins = (p.gameWins && p.gameWins.searchle) || 0;
      if (wins === 0) continue;
      // Key by discordUserId (linked accounts) — this is what the client looks up via linkedDiscord
      if (p.discordUserId) counts[p.discordUserId] = wins;
      // Solo/unlinked players need their actual platform user ID, not the internal DB row id.
      if (p.platformUserId) counts[p.platformUserId] = wins;
      // Keep numeric DB id as a legacy fallback for older clients/debugging.
      if (p.id) counts[p.id] = wins;
      leaderboard.push({
        key: p.discordUserId || p.platformUserId || p.id || p.displayName,
        name: p.displayName,
        wins,
        profilePic: p.profilePic || null
      });
    }

    // Also build platformUserId → wins lookup from linked-groups data
    // so the client can match by platformUserId even when linkedDiscord isn't on the message
    try {
      const lgRes = await fetch(`${wordEmpiresUrl}/api/admin/accounts/linked-groups`, {
        headers: { 'x-api-key': apiKey, 'x-admin-key': process.env.ADMIN_API_SECRET || apiKey },
      redirect:'error',signal:AbortSignal.timeout(5000)
      });
      if (lgRes.ok) {
        const lgData = await lgRes.json();
        const groups = lgData.groups || lgData;
        if (Array.isArray(groups)) {
          let mapped = 0;
          for (const group of groups) {
            const did = group.discordUserId;
            if (!did || !counts[did]) continue;
            const wins = counts[did];
            for (const p of group.platforms || []) {
              if (p.platformUserId && !counts[p.platformUserId]) {
                counts[p.platformUserId] = wins;
                mapped++;
              }
            }
          }
          if (mapped > 0) console.log(`[WinCounts] Mapped ${mapped} platform userIds from linked-groups`);
        }
      }
    } catch (lgErr) {
      // Non-fatal — linked-groups lookup is optional
    }

    _wtWinCounts = counts;
    _wtLeaderboard = leaderboard;
    console.log(`[WinCounts] Synced ${leaderboard.length} players from Word Tycoon`);
  } catch (err) {
    console.log('[WinCounts] Could not fetch from Word Tycoon:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ELO Leaderboard (from Word Tycoon — source of truth for ratings)
// ---------------------------------------------------------------------------
async function fetchEloLeaderboard(wordEmpiresUrl, apiKey) {
  try {
    const res = await fetch(`${wordEmpiresUrl}/api/elo/searchle/leaderboard?limit=100&minRounds=5`, {
      headers: { 'x-api-key': apiKey, 'x-admin-key': process.env.ADMIN_API_SECRET || apiKey },
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.players || !Array.isArray(data.players)) return;

    _wtEloLeaderboard = data.players.map((p, idx) => ({
      rank: idx + 1,
      identityKey: p.identityKey || p.key || '',
      elo: p.elo || p.rating || 1200,
      roundsCounted: p.roundsCounted || p.rounds || 0,
      nickname: p.displayName || p.nickname || p.name || 'Unknown'
    }));
    console.log(`[ELO] Synced ${_wtEloLeaderboard.length} rated players from Word Tycoon`);
  } catch (err) {
    console.log('[ELO] Could not fetch from Word Tycoon:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Game State Helpers
// ---------------------------------------------------------------------------
let _avatarFixCursor = 0;
function getGameState() {
  // Fix relative avatar URLs before broadcasting to clients. The fix is
  // idempotent and mutates the guess object, so we only need to process
  // guesses added since the last broadcast.
  for (let i = _avatarFixCursor; i < game.guesses.length; i++) {
    fixGuessAvatars(game.guesses[i]);
  }
  _avatarFixCursor = game.guesses.length;
  if (lastWinner && lastWinner.user) {
    lastWinner.user.profilePic = fixAvatarUrl(lastWinner.user.profilePic);
  }
  return {
    targetWord: game.isWon ? game.targetWord : null,
    guesses: game.guesses,
    totalRankedWords: game.totalRankedWords,
    startTime: game.startTime,
    isWon: game.isWon,
    winner: game.winner,
    lastWinner,
    winHistory: _recentGames,
    recentGames: _recentGames,
    totalMPGames: _totalMPGames,
    avgGuesses: _totalMPGames > 0 ? Math.round(_totalMPGuesses / _totalMPGames) : 0,
    winCounts: _wtWinCounts,
    searchleLeaderboard: _wtLeaderboard,
    eloLeaderboard: _wtEloLeaderboard,
    jackpotEnabled
  };
}

function getGame() {
  return game;
}

// ---------------------------------------------------------------------------
// Per-Round Scoring (point-based MP)
// ---------------------------------------------------------------------------

// Reset scoring state — called by every new-game path so XP doesn't carry over.
function _resetRoundScoring() {
  game.playerScores = new Map();
  game.paidTopWords = new Set();
  game.bestNonTop10Rank = Infinity;
}

// Build the canonical identity key for an MP user. Mirrors the same shape
// chat-relay uses for ELO so the same key resolves across systems.
function _identityKeyFor(user) {
  if (!user) return null;
  if (user.linkedDiscord) return 'discord:' + user.linkedDiscord;
  const puid = user.platformUserId || user.id;
  if (user.platform && puid) return user.platform + ':' + puid;
  return null;
}

// Award XP for a single new guess. Returns { pts, total } where pts is the
// XP added by THIS guess and total is the player's running game XP.
// pts === 0 means the word was outside the scoring range (or a re-guess of
// a non-top-10 word that was already counted via paidTopWords).
function awardForGuess(rank, user) {
  const key = _identityKeyFor(user);
  if (!key) return { pts: 0, total: 0 };
  // Defensive init — covers paths that bypass _resetRoundScoring (e.g. a
  // very old saved game restored before this code shipped).
  if (!game.playerScores || typeof game.playerScores.values !== 'function') {
    game.playerScores = new Map();
  }
  if (!game.paidTopWords || typeof game.paidTopWords.has !== 'function') {
    game.paidTopWords = new Set();
  }
  if (typeof game.bestNonTop10Rank !== 'number') {
    game.bestNonTop10Rank = Infinity;
  }

  const isTopSlot = rank >= 1 && rank <= 10;
  const slotTaken = isTopSlot ? game.paidTopWords.has(rank) : false;
  const currentBest = game.bestNonTop10Rank;
  const pts = computeRankAward(rank, slotTaken, currentBest);
  if (pts <= 0) {
    const existing = game.playerScores.get(key);
    return { pts: 0, total: existing ? existing.xp : 0 };
  }

  if (isTopSlot && !slotTaken) {
    game.paidTopWords.add(rank);
  }
  // Update the climb baseline AFTER award is computed (so this guess's
  // bonus is calculated against the previous best, not against itself).
  if (rank >= 11 && rank <= 10000 && rank < currentBest) {
    game.bestNonTop10Rank = rank;
  }

  let entry = game.playerScores.get(key);
  if (!entry) {
    entry = {
      identityKey: key,
      displayName: user.displayName || user.username || 'Player',
      profilePic: user.profilePic || null,
      platform: user.platform || null,
      platformUserId: user.platformUserId || user.id || null,
      linkedDiscord: user.linkedDiscord || null,
      cosmetics: user.cosmetics || null,
      xp: 0,
    };
    game.playerScores.set(key, entry);
  } else {
    // Refresh display fields from latest guess so cosmetics changes propagate.
    if (user.displayName) entry.displayName = user.displayName;
    if (user.profilePic) entry.profilePic = user.profilePic;
    if (user.cosmetics) entry.cosmetics = user.cosmetics;
  }
  entry.xp += pts;
  return { pts, total: entry.xp };
}

// Top N players by accumulated game XP. Used both for the live podium
// broadcast and the end-of-game payout iteration.
function getPodium(limit = 7) {
  if (!game.playerScores || typeof game.playerScores.values !== 'function') return [];
  const all = [...game.playerScores.values()];
  all.sort((a, b) => b.xp - a.xp);
  return all.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    identityKey: e.identityKey,
    displayName: e.displayName,
    profilePic: e.profilePic,
    platform: e.platform,
    platformUserId: e.platformUserId,
    linkedDiscord: e.linkedDiscord,
    cosmetics: e.cosmetics || null,
    xp: e.xp,
  }));
}

// Every player who earned XP this round (used for end-of-game payout).
function getAllScoringPlayers() {
  if (!game.playerScores || typeof game.playerScores.values !== 'function') return [];
  return [...game.playerScores.values()];
}

// setWinner — records the round end. With point-based scoring the
// "winner" is no longer necessarily the target finder; pass winnerUser
// explicitly to record someone other than guess.user as the winner.
// Defaults to guess.user for backwards compatibility (single-finder
// games, or callers that haven't been updated).
function setWinner(guess, word, winnerUser, targetFinder, podiumSnapshot) {
  const winner = winnerUser || guess.user;
  game.isWon = true;
  game.winner = winner;
  const guessCount = game.guesses.length;
  const durationSeconds = game.startTime
    ? Math.max(0, Math.round((Date.now() - new Date(game.startTime).getTime()) / 1000))
    : null;
  // Store target finder + final podium snapshot so the new header can
  // recreate its 4-slot row (XP winner / target / 2nd / 3rd) on a fresh
  // page load instead of waiting for the next round to end.
  lastWinner = {
    user: winner,
    word,
    guessCount,
    durationSeconds,
    targetFinder: targetFinder || guess.user || null,
    podium: Array.isArray(podiumSnapshot) ? podiumSnapshot : getPodium(7),
  };
  wonWords.add(word.toLowerCase());
  saveGameImmediate();
  recordWinLocally(winner, word, guessCount, new Date().toISOString(), durationSeconds);
  return { guessCount, durationSeconds, pot: calculatePot() };
}

async function reRankGuesses(config) {
  const original = game, owner = recovery?.current(original);
  if (!original.targetWord || original.isWon) return;
  const rankings = await rankingEngine.computeRankings(original.targetWord, config);
  if (game !== original || original.isWon || owner && recovery.current(original)?.roundId !== owner.roundId) return;
  // Accepted ranks and XP remain fixed. Only subsequent guesses use the new model.
  if (recovery) recovery.run(original, () => { original.totalRankedWords = rankings.size; });
  else original.totalRankedWords = rankings.size;
  original.rankings = rankings;
  saveGameImmediate();
}

function updateLastWinnerCosmetics(platform, platformUserId, equipped) {
  if (!lastWinner || !lastWinner.user) return false;
  const u = lastWinner.user;
  if (u.platform === platform && (u.platformUserId || u.id) === platformUserId) {
    u.cosmetics = equipped || {};
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Filter target words — remove words that guess normalization would transform.
// Must be called AFTER rankingEngine.init() so the vocab set is available.
// ---------------------------------------------------------------------------
function filterTargetWords() {
  const before = targetWords.length;
  const removed = [];
  targetWords = targetWords.filter(w => {
    if (gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'target', w)) {
      removed.push(`${w} → blocked`);
      return false;
    }
    const normalized = toAmerican(toSingular(w));
    if (normalized !== w) {
      removed.push(`${w} → ${normalized}`);
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    console.log(`[Boot] Removed ${removed.length} unguessable target words`);
  }
  console.log(`[Boot] ${targetWords.length} target words available (${before - targetWords.length} filtered)`);
  refreshPublicTargetWords();
}

// Used by session-manager to draw a target without polluting public shuffle bag
function getTargetWordPool() {
  return targetWords;
}

module.exports = {
  setRecovery, snapshotMetadata, restoreMetadata,
  loadTargetWords,
  preloadNextGame,
  startNewGame,
  startGameWithWord,
  forceWin,
  loadGame,
  saveGame,
  saveGameImmediate,
  saveGameSync,
  savePendingGame,
  hasPendingGame,
  loadPendingGame,
  savePlayedWords,
  getGameState,
  getGame,
  setWinner,
  calculatePot,
  awardForGuess,
  getPodium,
  getAllScoringPlayers,
  reRankGuesses,
  RANK_REWARDS,
  TARGET_REWARD,
  getLastWinner: () => lastWinner,
  updateLastWinnerCosmetics,
  filterTargetWords,
  setExcludedWords,
  setOnRoundStart,
  isJackpotEnabled: () => jackpotEnabled,
  setJackpotEnabled: (enabled) => {
    if (recovery?.current(game) && !recovery.isRunning()) recovery.run(game, () => { jackpotEnabled = enabled; });
    else jackpotEnabled = enabled;
    saveSettings();
  },
  fetchWinCounts,
  fetchEloLeaderboard,
  fetchWonWords,
  fetchRecentGames,
  getTargetWordPool,
  getPublicTargetPool,
};
