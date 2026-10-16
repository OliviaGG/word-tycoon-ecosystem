try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const words = require('./words');
const sessionManager = require('./src/session-manager');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const PORT = process.env.PORT || 3003;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public WEB multiplayer guessing requires Donor Class / TikTok Super Fan.
// Solo/daily flows, streamer sessions and relay chat (tiktok/discord/bots)
// use different code paths and never touch this gate.
// The check itself lives in chat-relay's game-shared.js (2026-07-31) so every
// game gates identically — public rooms AND streamer player pages. It replaces
// a local snowflake-shape test that read any non-Discord id (gh_/google_/tt_)
// as logged-out and hard-blocked it, even when that account's subscription was
// linked to a Discord one.
async function passesPremiumWebGate(candidateIds, socket, context = 'mp') {
  return gameShared.passesPremiumWebGate(candidateIds, socket, context);
}

// ─── Streamer whitelist + redirect targets (declared above any closure) ──
let _validStreamerHandles = new Set();
let _streamerSettings = new Map();
const _streamerRedirectTargets = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.handles)) {
      _validStreamerHandles = new Set(data.handles.map(h => String(h).toLowerCase()));
    }
    if (data && Array.isArray(data.settings)) {
      const m = new Map();
      for (const s of data.settings) {
        const h = String((s && s.handle) || '').toLowerCase();
        if (!h) continue;
        const bset = new Set();
        if (Array.isArray(s.blockedPlayers)) {
          for (const b of s.blockedPlayers) {
            const p = String((b && b.platform) || '').toLowerCase();
            const id = String((b && b.id) || '');
            if (p && id) bset.add(p + ':' + id);
          }
        }
        m.set(h, { disablePlayerPage: !!s.disablePlayerPage, blockedSet: bset });
      }
      _streamerSettings = m;
    }
  } catch (_) {}
}
setTimeout(_refreshStreamerHandles, 2000);
setInterval(_refreshStreamerHandles, 5 * 60 * 1000).unref();
function _isPagePlayDisabled(handle) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  return !!(s && s.disablePlayerPage);
}
function _isStreamerBlocking(handle, platform, platformUserId) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  if (!s || !s.blockedSet || !s.blockedSet.size) return false;
  const p = String(platform || '').toLowerCase();
  const id = String(platformUserId || '');
  if (!p || !id) return false;
  return s.blockedSet.has(p + ':' + id);
}
function _sessionRoom(handle) { return `wordle:session:${String(handle || '').toLowerCase()}`; }
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });
const AUTO_RESTART_DELAY = 10000;

// Admin auth middleware
const ADMIN_SECRET = process.env.GAME_API_SECRET;
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key === ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify its signed portal session or remember cookie. Returns null for guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;)\s*(?:wt_remember|connect\.sid)=[^;]+/.test(cookie)) return null;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.GAME_API_SECRET,
        'x-forwarded-cookie': cookie,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.user) {
      return data.user.anchorId || data.user.id || null;
    }
  } catch (e) {
    console.error('[Wordle] whoami failed:', e.message);
  }
  return null;
}

// --- Data persistence ---
const DATA_DIR = path.join(__dirname, 'data');
const WINNERS_FILE = path.join(DATA_DIR, 'winners.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const HISTORY_BACKUP_PATH = path.join(DATA_DIR, 'history-backup.json');
const PLAYED_WORDS_PATH = path.join(DATA_DIR, 'played-words.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}
// ── ELO reporting ─────────────────────────────────────────────────
// Report a finished round's participants to Word Tycoon for ELO / rounds-played.
//
// `state` defaults to the public round, but private streamer sessions pass their
// own session state so stream rounds count toward /goat exactly like public ones
// (2026-07-21). Bots and guests are filtered out - they play in sessions but must
// never earn a rating.
async function reportRoundToWordTycoon(state = gameState) {
  const guesses = state.guesses || [];
  const winner = state.winner;
  if (!winner) return;

  // Deduplicate participants by identity
  const playerMap = new Map();
  for (const g of guesses) {
    const identityKey = g.linkedDiscord
      ? `discord:${g.linkedDiscord}`
      : `${g.platform || 'web'}:${g.platformUserId || 'unknown'}`;
    if (!gameShared.isStatsEligible(identityKey)) continue;
    if (!playerMap.has(identityKey)) {
      playerMap.set(identityKey, {
        identityKey,
        displayName: g.displayName || g.player || 'Player',
        guesses: 0,
        hits: 0,
      });
    }
    const p = playerMap.get(identityKey);
    p.guesses++;
    const word = String(g.word || '').toLowerCase();
    const target = String(state.word || '').toLowerCase();
    if (word === target) p.hits++;
  }

  const winnerKey = winner.linkedDiscord
    ? `discord:${winner.linkedDiscord}`
    : `${winner.platform || 'web'}:${winner.platformUserId || 'unknown'}`;

  const participants = Array.from(playerMap.values()).map((p, idx) => {
    const isWinner = p.identityKey === winnerKey;
    return {
      identityKey: p.identityKey,
      points: isWinner ? 100 : 0,
      rank: isWinner ? 1 : 2,
      rankOutOf: playerMap.size,
      guesses: p.guesses,
      hits: p.hits,
      firstHitMs: null,
      wonRound: isWinner,
      foundTarget: isWinner,
      articleTitle: state.word || '?',
    };
  });

  if (participants.length < 2) return;
  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'wordle', participants }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[Wordle] ELO report failed: ${res.status} ${text}`);
    }
  } catch (e) {
    console.log(`[Wordle] ELO report error: ${e.message}`);
  }
}

// --- Word lists (loaded from shared word bank, words.js as fallback) ---
let targetsByLength = {};
let dictionaryByLength = {};
let dictionarySets = {};

function rebuildDictionarySets() {
  dictionarySets = {};
  for (const len in dictionaryByLength) {
    dictionarySets[len] = new Set(dictionaryByLength[len]);
  }
  // Ensure all target words are valid guesses (targets must always be guessable)
  for (const len in targetsByLength) {
    if (!dictionarySets[len]) dictionarySets[len] = new Set();
    for (const w of targetsByLength[len]) {
      dictionarySets[len].add(w);
    }
  }
}

// ─── Per-streamer word length (Chat Relay "Word Length" dashboard card) ───
// The streamer picks 4-8 or "random" at /streamer; private sessions read it
// here. Clamped to the lengths this game actually stocks targets for, so an
// 8 with an empty 8-letter bank still yields a playable round.
const SESSION_WORD_LENGTHS = [4, 5, 6, 7, 8];
const DEFAULT_SESSION_WORD_LENGTH = 5;
const _WORD_LEN_TTL_MS = 60 * 1000;
const _wordLenCache = new Map(); // handle -> { value, fetchedAt }

async function _fetchStreamerWordLength(handle) {
  const key = String(handle || '').toLowerCase();
  if (!key) return '5';
  const cached = _wordLenCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < _WORD_LEN_TTL_MS) return cached.value;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-public/by-handle/${encodeURIComponent(key)}/difficulty`);
    if (!res.ok) {
      _wordLenCache.set(key, { value: '5', fetchedAt: Date.now() });
      return '5';
    }
    const data = await res.json();
    const value = (data && typeof data.wordLength === 'string') ? data.wordLength : '5';
    _wordLenCache.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch (_) {
    // Network glitch — keep the last known good rather than snapping back to 5.
    return (cached && cached.value) || '5';
  }
}

function _stockedSessionLengths() {
  return SESSION_WORD_LENGTHS.filter((n) => {
    const pool = targetsByLength[String(n)];
    return Array.isArray(pool) && pool.length > 0;
  });
}

// Resolves the streamer's preference to one concrete length for one round.
// 'random' re-rolls on every call, so each new round gets a fresh length.
async function getSessionWordLength(handle) {
  const avail = _stockedSessionLengths();
  if (!avail.length) return DEFAULT_SESSION_WORD_LENGTH;
  const pref = await _fetchStreamerWordLength(handle);
  if (pref === 'random') return avail[Math.floor(Math.random() * avail.length)];
  const want = parseInt(pref, 10) || DEFAULT_SESSION_WORD_LENGTH;
  if (avail.includes(want)) return want;
  // Nearest stocked length wins; ties go shorter (avail is ascending).
  return avail.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), avail[0]);
}

// Word source for private sessions. Prefers the shared word bank (hundreds
// to thousands of targets per length) over the builtin list, which only
// carries 2 eight-letter words and would repeat itself every round.
const sessionWords = {
  getRandomWord(len) {
    const pool = targetsByLength[String(len)] || [];
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    return words.getRandomWord(len);
  },
};

// Try to load from shared word bank (Chat Relay)
let wordBankLoaded = false;
let wordBankRetryTimer = null;

async function loadFromWordBank() {
  try {
    const [targetsRes, statsRes] = await Promise.all([
      fetch(`${CHAT_RELAY_URL}/api/word-bank/targets`),
      fetch(`${CHAT_RELAY_URL}/api/word-bank/stats`)
    ]);

    if (!targetsRes.ok || !statsRes.ok) {
      throw new Error(`HTTP ${targetsRes.status}/${statsRes.status}`);
    }

    const newTargets = await targetsRes.json();
    const stats = await statsRes.json();

    // Fetch dictionary for each available length
    const newDict = {};
    for (const len of (stats.lengths || [])) {
      try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/dictionary/${len}`);
        if (res.ok) {
          newDict[String(len)] = await res.json();
        }
      } catch (e) {
        console.warn(`[Wordle] Failed to fetch dictionary for length ${len}`);
      }
    }

    if (Object.keys(newTargets).length > 0) {
      targetsByLength = newTargets;
      console.log(`[Wordle] Loaded ${stats.totalTargets || '?'} targets from word bank`);
    }
    if (Object.keys(newDict).length > 0) {
      dictionaryByLength = newDict;
      rebuildDictionarySets();
      console.log(`[Wordle] Loaded ${stats.totalDictionary || '?'} dictionary words from word bank`);
    }
    wordBankLoaded = true;
    if (wordBankRetryTimer) {
      clearInterval(wordBankRetryTimer);
      wordBankRetryTimer = null;
      console.log(`[Wordle] Word bank retry succeeded — now using full word bank`);
    }
  } catch (err) {
    console.log(`[Wordle] Word bank unavailable (${err.message}), using local words.js`);
    // Fall back to built-in words.js
    if (!wordBankLoaded) {
      const builtinWords = words.WORDS || {};
      if (Object.keys(builtinWords).length > 0) {
        for (const len in builtinWords) {
          targetsByLength[String(len)] = builtinWords[len];
          dictionaryByLength[String(len)] = builtinWords[len];
        }
        rebuildDictionarySets();
        console.log(`[Wordle] Loaded ${Object.values(builtinWords).flat().length} words from built-in words.js`);
      }
    }
    // Schedule retries if not already retrying
    if (!wordBankRetryTimer) {
      wordBankRetryTimer = setInterval(() => {
        console.log(`[Wordle] Retrying word bank connection...`);
        loadFromWordBank();
      }, 15000); // retry every 15 seconds
    }
  }
}

// --- Winners (legacy format) ---
function loadWinners() {
  try {
    if (fs.existsSync(WINNERS_FILE)) {
      return JSON.parse(fs.readFileSync(WINNERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading winners:', err.message);
  }
  return {};
}

function saveWinners() {
  try {
    atomicWriteSync(WINNERS_FILE, winners);
  } catch (err) {
    console.error('Error saving winners:', err.message);
  }
}

let winners = loadWinners();

// --- History (array format, like Betweenly) ---
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
      if (fs.existsSync(HISTORY_BACKUP_PATH)) {
        console.warn('[Wordle] Primary history empty, restoring from backup');
        const backup = JSON.parse(fs.readFileSync(HISTORY_BACKUP_PATH, 'utf-8'));
        if (Array.isArray(backup) && backup.length > 0) {
          fs.writeFileSync(HISTORY_PATH, JSON.stringify(backup, null, 2));
          return backup;
        }
      }
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    try {
      if (fs.existsSync(HISTORY_BACKUP_PATH)) {
        console.warn('[Wordle] Primary history corrupt, restoring from backup');
        const backup = JSON.parse(fs.readFileSync(HISTORY_BACKUP_PATH, 'utf-8'));
        if (Array.isArray(backup)) {
          fs.writeFileSync(HISTORY_PATH, JSON.stringify(backup, null, 2));
          return backup;
        }
      }
    } catch (backupErr) {
      console.error('[Wordle] Backup also failed:', backupErr.message);
    }
  }
  return [];
}

function saveHistory() {
  try {
    atomicWriteSync(HISTORY_PATH, history);
    atomicWriteSync(HISTORY_BACKUP_PATH, history);
  } catch (e) {
    console.log('[Wordle] Could not save history:', e.message);
  }
}

let history = loadHistory();

// --- Played words tracking ---
function loadPlayedWords() {
  try {
    if (fs.existsSync(PLAYED_WORDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(PLAYED_WORDS_PATH, 'utf-8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) {
    console.log('[Wordle] Could not load played words:', e.message);
  }
  return {};
}

function savePlayedWords() {
  try {
    atomicWriteSync(PLAYED_WORDS_PATH, playedWords);
  } catch (e) {
    console.log('[Wordle] Could not save played words:', e.message);
  }
}

let playedWords = loadPlayedWords();

// --- Settings ---
let settings = {
  wordLength: 5
};

// --- Game state ---
let gameState = {
  word: '',
  wordLength: 5,
  guesses: [],
  gameOver: false,
  winner: null,
};

let lastWinner = null;
let lastWinnerTotalWins = 0;
let newGameTimeout = null;
let displayCount = 0;
let connectedPlayers = 0;
let relayConnected = false;

// Private hints use an explicit room and its persisted round opening time.
function getHintRound(handle) {
  if (handle === 'public') return { state: gameState, startTime: gameState.startTime || null };
  const session = sessionManager.getSession(handle);
  if (!session?.gameState || !session.gameStartTime) return null;
  return { state: session.gameState, startTime: new Date(session.gameStartTime).toISOString() };
}

// --- Daily Word ---
let dailyWord = null;    // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(__dirname, 'data', 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate()); // true once the daily round has started today

async function fetchDailyWord(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const len = settings.wordLength || 5;
      const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/wordle?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data = await res.json();
      // Check if it's a new day → reset dailyPlayed
      if (dailyWord && dailyWord.date !== data.date) {
        dailyPlayed = dailyRounds.has(data.date);
        console.log(`[Wordle] New daily word available for ${data.date}`);
      }
      dailyWord = data;
      return;
    } catch (e) {
      console.warn(`[Wordle] Daily word fetch failed (attempt ${attempt}/${retries}):`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// --- Frenzy ---
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };

// Jackpot configuration (configurable via /api/jackpot/settings)
let jackpotSettings = {
  enabled: true,
  dailyEnabled: false,
  base: 100,
  perGuess: 25,
  perSecond: 5,
  max: 5000
};
let jackpotBroadcastTimer = null;
let gameStartTime = Date.now();
const mpActions = require(path.join(RELAY_DIR, 'src', 'plain-game-actions')).createPlainGameActions({
  directory: path.join(DATA_DIR, 'mp-actions'), gameId: 'wordle', sdk: gameShared,
  onError: error => console.error('[MPRecovery] ' + error.message)
});
function mpMetadata(state, scope = 'public', session = null) {
  const prior = mpActions.recordFor(state)?.meta;
  return { scope, complete: !!state.gameOver, startTime: session?.gameStartTime || gameStartTime,
    ...(state.isDaily ? { period: prior?.period || state.rewardPeriod || dailyWord?.date || gameShared.getEdmontonDate() } : {}),
    ...(session ? { handle: session.handle, noRewards: !!session.noRewards } : { dailyPlayed,
      publicData: { winners, history, lastWinner, lastWinnerTotalWins, playedWords, settings, jackpotSettings } }) };
}
function commitPublicGuess(amount = null, rawAmount = null) {
  const meta = mpMetadata(gameState), intentions = []; let completion;
  if (gameState.gameOver) {
    const winner = gameState.winner, event = gameState.isDaily ? 'mp-daily-win' : 'win';
    completion = { amount, rawAmount, winner, event, ...(meta.period ? { period: meta.period } : {}) };
    const intention = mpActions.reward('win', winner.platform, winner.platformUserId, winner.username, winner.displayName, amount, event,
      { guessCount: gameState.guesses.filter(g => !g._reserved).length, word: gameState.word, ...(meta.period ? { rewardPeriod: meta.period } : {}) });
    if (intention) intentions.push(intention);
    // Store the intended legacy statistics with the winning action. A crash
    // before either secondary JSON mirror is written restores this same result.
    const nextWinners = JSON.parse(JSON.stringify(winners)), key = getWinnerKey(winner);
    nextWinners[key] = { ...(nextWinners[key] || { username: winner.username, platform: winner.platform, wins: 0 }),
      displayName: winner.displayName, profilePic: winner.profilePic, linkedDiscord: winner.linkedDiscord, wins: (nextWinners[key]?.wins || 0) + 1 };
    const entry = { word: gameState.word, wordLength: gameState.wordLength,
      winner: { displayName: winner.displayName, platform: winner.platform, platformUserId: winner.platformUserId, profilePic: winner.profilePic, linkedDiscord: winner.linkedDiscord },
      guessCount: gameState.guesses.filter(g => !g._reserved).length, jackpot: amount, timestamp: new Date().toISOString() };
    meta.publicData = { ...meta.publicData, winners: nextWinners, history: [entry, ...history], lastWinner: winner, lastWinnerTotalWins: nextWinners[key].wins };
  }
  try { return mpActions.accept(gameState, meta, intentions, completion); }
  catch (error) { console.error('[MPRecovery] ' + error.message); return null; }
}
function restorePublicData(meta) {
  const data = meta?.publicData; if (!data) return;
  winners = data.winners; history = data.history; lastWinner = data.lastWinner; lastWinnerTotalWins = data.lastWinnerTotalWins;
  playedWords = data.playedWords; settings = data.settings; jackpotSettings = data.jackpotSettings;
}
function saveNewPublicRound() {
  gameState.rewardPeriod = gameState.isDaily ? dailyWord?.date || gameShared.getEdmontonDate() : undefined;
  mpActions.save(gameState, 'public', mpMetadata(gameState));
  if (gameState.isDaily) dailyRounds.consume(gameState.rewardPeriod);
}
sessionManager.setDurabilityHooks({
  restore(session) {
    const saved = mpActions.load('session:' + session.handle); if (!saved) return null;
    if (saved.record.meta.ended) return { gameState: null, gameStartTime: 0, isComplete: false };
    return { gameState: saved.state, gameStartTime: saved.record.meta.startTime, isComplete: !!saved.state.gameOver, noRewards: !!saved.record.meta.noRewards };
  },
  saveNew: session => mpActions.save(session.gameState, 'session:' + session.handle, mpMetadata(session.gameState, 'session:' + session.handle, session)),
  end(session) { const record = mpActions.journal.current('session:' + session.handle); if (record) mpActions.journal.commit(record.scope, record.roundId, record.state, { ...record.meta, ended: true }); }
});

function calculateJackpot() {
  const completed = gameState.gameOver ? mpActions.recordFor(gameState)?.completion : null;
  if (completed) return completed.rawAmount;
  if (!jackpotSettings.enabled) return 0;
  const guessBonus = gameState.guesses.filter(g => !g._reserved).length * jackpotSettings.perGuess;
  const elapsed = Math.max(0, (Date.now() - gameStartTime) / 1000);
  const timeBonus = Math.floor(elapsed) * jackpotSettings.perSecond;
  const total = jackpotSettings.base + guessBonus + timeBonus;
  return jackpotSettings.max > 0 ? Math.min(total, jackpotSettings.max) : total;
}

function startJackpotBroadcast() {
  stopJackpotBroadcast();
  jackpotBroadcastTimer = setInterval(() => {
    if (!gameState.gameOver) {
      io.to('public').emit('jackpot-update', { jackpot: calculateJackpot() });
    }
  }, 1000);
}

function stopJackpotBroadcast() {
  if (jackpotBroadcastTimer) {
    clearInterval(jackpotBroadcastTimer);
    jackpotBroadcastTimer = null;
  }
}

function countUserWins(hist, userId, linkedDiscord) {
  // With canonical identity, new entries always use linkedDiscord as platformUserId.
  // Cross-matching kept for backward compat with pre-canonicalization history entries.
  let count = 0;
  for (const w of hist) {
    const wId = w.winner ? (w.winner.platformUserId || w.winner.id) : null;
    const wLd = w.winner ? (w.winner.linkedDiscord || null) : null;
    if (wId === userId) { count++; continue; }
    if (linkedDiscord && wLd === linkedDiscord) { count++; continue; }
    if (linkedDiscord && wId === linkedDiscord) { count++; continue; }
  }
  return count;
}

function getWinnerKey(winner) {
  if (!winner) return null;
  if (winner.identityKey) return winner.identityKey;
  if (winner.linkedDiscord) return `discord:${winner.linkedDiscord}`;
  const platform = winner.platform || 'web';
  const userKey = winner.username || winner.platformUserId || winner.id || winner.displayName;
  return userKey ? `${platform}:${userKey}` : null;
}

function startNewGame() {
  const previous = { gameState, gameStartTime, dailyPlayed, playedWords: JSON.parse(JSON.stringify(playedWords)) };
  try {
  if (newGameTimeout) {
    clearTimeout(newGameTimeout);
    newGameTimeout = null;
  }

  const len = settings.wordLength;
  const pool = targetsByLength[len] || [];

  if (pool.length === 0) {
    // Fallback to built-in words.js
    const word = words.getRandomWord();
    gameState = {
      word: word.toUpperCase(),
      wordLength: word.length,
      guesses: [],
      gameOver: false,
      winner: null,
      isDaily: false,
      startTime: new Date().toISOString()
    };
    gameStartTime = Date.now();
    saveNewPublicRound();
    io.to('public').emit('new-game', { wordLength: gameState.wordLength, isDaily: false, startTime: gameState.startTime });
    startJackpotBroadcast();
    console.log(`[Wordle] New game (fallback)! (${gameState.wordLength} letters)`);
    return;
  }

  let secret;
  let isDaily = false;

  // Use daily word for the first round of the day (Edmonton timezone — matches word bank)
  const today = gameShared.getEdmontonDate();
  if (!dailyPlayed && dailyWord && dailyWord.date === today && dailyWord.length === len && jackpotSettings.dailyEnabled) {
    secret = dailyWord.word;
    isDaily = true;
    dailyPlayed = true;
    console.log(`[Wordle] DAILY round (${secret.length} letters)`);
  } else {
    // Filter out played words
    const played = new Set(playedWords[len] || []);
    let available = pool.filter(w => !played.has(w));

    if (available.length === 0) {
      console.log(`[Wordle] All ${len}-letter targets played (${played.size})! Resetting pool.`);
      playedWords[len] = [];
      available = pool;
    }

    secret = available[Math.floor(Math.random() * available.length)];
  }

  // Track as played
  if (!playedWords[len]) playedWords[len] = [];
  playedWords[len].push(secret);
  savePlayedWords();

  gameState = {
    word: secret.toUpperCase(),
    wordLength: len,
    guesses: [],
    gameOver: false,
    winner: null,
    isDaily: isDaily,
    startTime: new Date().toISOString()
  };

  gameStartTime = Date.now();

  saveNewPublicRound();
  io.to('public').emit('new-game', {
    wordLength: gameState.wordLength,
    isDaily: gameState.isDaily,
    startTime: gameState.startTime,
  });

  startJackpotBroadcast();
  console.log(`[Wordle] New game! (${gameState.wordLength} letters)${isDaily ? ' [DAILY]' : ''}`);
  } catch (error) {
    let committed = false;
    try { committed = !!mpActions.recordFor(gameState); } catch {}
    if (!committed) {
      gameState = previous.gameState; gameStartTime = previous.gameStartTime; dailyPlayed = previous.dailyPlayed; playedWords = previous.playedWords;
    }
    throw error;
  }
}

function checkGuess(guess, target) {
  const result = [];
  const guessArr = guess.split('');
  const targetArr = target.split('');
  const used = new Array(target.length).fill(false);

  // Pass 1: exact matches (correct/green)
  for (let i = 0; i < guessArr.length; i++) {
    if (guessArr[i] === targetArr[i]) {
      result[i] = 'correct';
      used[i] = true;
    } else {
      result[i] = 'absent';
    }
  }

  // Pass 2: present letters (yellow)
  for (let i = 0; i < guessArr.length; i++) {
    if (result[i] === 'correct') continue;
    for (let j = 0; j < targetArr.length; j++) {
      if (!used[j] && guessArr[i] === targetArr[j]) {
        result[i] = 'present';
        used[j] = true;
        break;
      }
    }
  }

  return result;
}

async function processGuess(username, displayName, profilePic, platform, message, userId, linkedDiscord, socket) {
  if (gameState.gameOver || typeof message !== 'string') return;
  if (gameState.isDaily && mpActions.recordFor(gameState)?.meta.period !== gameShared.getEdmontonDate()) {
    startNewGame(); socket?.emit('guess-error', { error: 'The daily round changed. Please try again.' }); return;
  }
  const activeGame = gameState;
  if (!mpActions.recordFor(activeGame)) mpActions.save(activeGame, 'public', mpMetadata(activeGame));

  const guess = message.trim();
  const upperGuess = guess.toUpperCase();
  const lowerGuess = guess.toLowerCase();

  if (upperGuess.length !== gameState.wordLength) return;
  if (!/^[A-Z]+$/.test(upperGuess)) return;

  // Validate against dictionary set (word bank) or fallback to words.js
  const dictSet = dictionarySets[gameState.wordLength];
  if (dictSet) {
    if (!dictSet.has(lowerGuess)) return;
  } else if (!words.isValidWord(lowerGuess)) {
    return;
  }

  if (gameState.guesses.some(g => g.word === upperGuess)) return;

  // Reserve this word immediately to prevent duplicate processing across async gap
  // (another processGuess call could pass the duplicate check during the await below)
  const reserveEntry = { word: upperGuess, _reserved: true };
  gameState.guesses.push(reserveEntry);

  // Canonical identity: if linked Discord exists, use it as the canonical user ID
  // (same pattern as erecTangled — prevents split identity across platforms)
  const canonicalUserId = linkedDiscord || userId || username;
  const canonicalPlatform = linkedDiscord ? 'web' : platform;

  const playerCosmetics = await gameShared.getPlayerCosmetics(canonicalPlatform, canonicalUserId);

  // Replace the reservation with the real guess data
  if (socket && !(await gameShared.passesPremiumWebGate([canonicalUserId], socket))) {
    const index = activeGame.guesses.indexOf(reserveEntry); if (index !== -1) activeGame.guesses.splice(index, 1); return;
  }
  const reserveIdx = activeGame.guesses.indexOf(reserveEntry);
  if (activeGame !== gameState || activeGame.gameOver) {
    if (reserveIdx !== -1) activeGame.guesses.splice(reserveIdx, 1); return;
  }
  if (reserveIdx === -1) return; // game was reset during await
  gameState.guesses.splice(reserveIdx, 1);

  const result = checkGuess(upperGuess, gameState.word);
  const guessData = {
    player: username,
    displayName: displayName || username,
    profilePic: profilePic || null,
    platform: canonicalPlatform,
    platformUserId: canonicalUserId,
    linkedDiscord: linkedDiscord || null,
    word: upperGuess,
    result,
    cosmetics: playerCosmetics,
  };

  gameState.guesses.push(guessData);

  const isCorrect = result.every(r => r === 'correct');

  if (isCorrect) {
    gameState.gameOver = true;
    const baseJackpot = calculateJackpot();
    const jackpotAmount = Math.floor(baseJackpot * (currentFrenzy.multiplier || 1.0));
    gameState.winner = {
      username,
      displayName: displayName || username,
      profilePic: profilePic || null,
      platform: canonicalPlatform,
      platformUserId: canonicalUserId,
      linkedDiscord: linkedDiscord || null,
      cosmetics: playerCosmetics,
      identityKey: `${canonicalPlatform}:${canonicalUserId}`,
    };

    const accepted = commitPublicGuess(jackpotAmount, baseJackpot);
    if (!accepted) { socket?.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); return; }
    gameShared.reportLibraryWord(canonicalPlatform, canonicalUserId, upperGuess, 'wordle', username, displayName, socket);

    restorePublicData(accepted.meta);
    const key = getWinnerKey(gameState.winner);
    saveWinners(); saveHistory();
    stopJackpotBroadcast();

    io.to('public').emit('guess', guessData);
    io.to('public').emit('game-over', {
      winner: gameState.winner,
      totalWins: winners[key].wins,
      word: gameState.word,
      guessCount: gameState.guesses.filter(g => !g._reserved).length,
      jackpot: jackpotAmount,
      isDaily: gameState.isDaily || false,
    });
    if (chatRelay && chatRelay.connected) {
      chatRelay.emit('game-win', {
        game: 'wordle', gameName: 'Wordle',
        word: gameState.word,
        winner: gameState.winner,
        jackpot: jackpotAmount,
        guessCount: gameState.guesses.filter(g => !g._reserved).length,
        totalWins: winners[key].wins,
        isDaily: gameState.isDaily || false,
      });
    }

    const frenzyNote = currentFrenzy.multiplier > 1 ? ` (FRENZY ${currentFrenzy.multiplier}x)` : '';
    console.log(`[Wordle] ${displayName} won! Total wins: ${winners[key].wins}${jackpotSettings.enabled ? ` Jackpot: ${jackpotAmount}${frenzyNote}` : ''}${gameState.isDaily ? ' [DAILY]' : ''}`);
    if (jackpotSettings.enabled) {
      const rewardEvent = gameState.isDaily ? 'mp-daily-win' : 'win';
      mpActions.sendLegacyReward(gameState, canonicalPlatform, canonicalUserId, username, displayName || username, jackpotAmount, rewardEvent, { guessCount: gameState.guesses.filter(g => !g._reserved).length, word: gameState.word });
      reportRoundToWordTycoon().catch(e => console.log("[Wordle] ELO report failed: " + e.message));
    }

    newGameTimeout = setTimeout(() => {
      startNewGame();
    }, AUTO_RESTART_DELAY);

  } else {
    if (!commitPublicGuess()) { socket?.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); return; }
    gameShared.reportLibraryWord(canonicalPlatform, canonicalUserId, upperGuess, 'wordle', username, displayName, socket);
    io.to('public').emit('guess', guessData);
  }
}

// --- API Routes ---

// SP word list endpoint — client-side game fetches targets + dictionary per length
app.get('/api/sp/words/:length', (req, res) => {
  const len = req.params.length;
  const targets = targetsByLength[len] || [];
  const dictionary = dictionaryByLength[len] || [];
  if (targets.length === 0) {
    return res.status(404).json({ error: 'No words for length ' + len });
  }
  res.json({ targets, dictionary });
});

// History endpoint for portal stats
app.get('/api/history', (req, res) => {
  res.json(history);
});

// Public state (no secret exposed)
app.get('/api/state', (req, res) => {
  res.json({
    wordLength: gameState.wordLength,
    guesses: gameState.guesses.filter(g => !g._reserved).length,
    gameOver: gameState.gameOver,
    hasWinner: !!gameState.winner,
    jackpot: calculateJackpot(),
    startTime: gameState.startTime,
    word: gameState.gameOver ? gameState.word : null,
    completedJackpot: gameState.gameOver ? (mpActions.recordFor(gameState)?.completion?.amount ?? calculateJackpot()) : null,
    jackpotEnabled: jackpotSettings.enabled,
    startTime: gameState.startTime || null,
    winner: gameState.winner ? { displayName: gameState.winner.displayName, profilePic: gameState.winner.profilePic } : null,
    isDaily: gameState.isDaily || false,
    frenzy: currentFrenzy,
    playerCount: connectedPlayers,
  });
});

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Wordle] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Verified-account purchase/replay; the allowance and selected letter live together.
app.post('/api/hints/use', require('./src/paid-hints').createTransactionalHintHandler({
  resolveUser: resolveUserFromCookie,
  getRound: getHintRound,
  secret: process.env.HINT_ROUND_ID_SECRET,
  async relay(endpoint, body) {
    const response = await fetch(`${CHAT_RELAY_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Hint service unavailable');
    return response.json();
  },
}));

// Jackpot settings API
app.get('/api/jackpot/settings', (req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    dailyEnabled: jackpotSettings.dailyEnabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: calculateJackpot(),
  });
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
  const previous = { ...jackpotSettings };
  const b = req.body || {};
  if (typeof b.enabled === 'boolean') jackpotSettings.enabled = b.enabled;
  if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
  if (Number.isFinite(b.base) && b.base >= 0 && b.base <= 1000000) jackpotSettings.base = b.base;
  if (Number.isFinite(b.perGuess) && b.perGuess >= 0 && b.perGuess <= 1000000) jackpotSettings.perGuess = b.perGuess;
  if (Number.isFinite(b.perSecond) && b.perSecond >= 0 && b.perSecond <= 1000000) jackpotSettings.perSecond = b.perSecond;
  if (Number.isFinite(b.max) && b.max >= 0 && b.max <= 1000000) jackpotSettings.max = b.max;
  try { mpActions.save(gameState, 'public', mpMetadata(gameState)); }
  catch (error) { jackpotSettings = previous; return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  console.log(`[Wordle] Jackpot settings updated:`, jackpotSettings);
  res.json({ ok: true, ...jackpotSettings, current: calculateJackpot() });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
  const previous = gameStartTime;
  gameStartTime = Date.now();
  try { mpActions.save(gameState, 'public', mpMetadata(gameState)); }
  catch (error) { gameStartTime = previous; return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  console.log('[Wordle] Jackpot timer reset');
  res.json({ ok: true, current: calculateJackpot() });
});

app.get('/api/sp/daily', async (req, res) => {
  try {
    const len = parseInt(req.query.length) || 5;
    const r = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/wordle-sp?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(404).json({ error: 'unavailable' });
    const data = await r.json();
    res.json({ word: data.word, date: data.date, length: data.length });
  } catch (e) { console.error('[Wordle] Daily endpoint error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/sp/daily/complete', (req, res) => {
    res.json({ ok: true });
});

app.get('/test-guess', requireAdmin, (req, res) => {
  const word = req.query.word || '';
  const user = req.query.user || 'TestPlayer';
  const pic = req.query.pic || null;
  processGuess(user.toLowerCase(), user, pic, 'test', word);
  res.json({ ok: true, word: word, guesses: gameState.guesses.filter(g => !g._reserved).length });
});

// ─── Session URL routes (must precede express.static) ──────────────────
const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'overlay.html',
  'index.html', 'mp.html', 'sp.html',
  'favicon.ico', 'robots.txt', 'manifest.webmanifest', 'sw.js',
  'public', 'js', 'css', 'socket.io',
  'style.css', 'game.js', 'mp-init.js', 'sp-engine.js',
  'coin-reward.js', 'win-effects.js', 'public-shared.css', 'wordle-play.css',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/')[2].toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  if (_isPagePlayDisabled(handle) && req.query.disabled !== '1') {
    return res.redirect(302, '/' + encodeURIComponent(handle) + '?disabled=1');
  }
  res.sendFile(path.join(__dirname, 'public', 'mp.html'));
});

// Admin session endpoints
app.post('/api/session/end', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = sessionManager.endSession(handle);
  res.json({ ok: true, had });
});
app.post('/api/session/redirect', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(handle, { targetUrl, targetGameName, targetGameId });
  io.to(_sessionRoom(handle)).emit('session-redirect', { handle, targetUrl, targetGameName, targetGameId });
  res.json({ ok: true });
});
app.post('/api/session/clear-redirect', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

// --- Serve static files ---
app.use(express.static(path.join(__dirname, 'public')));

// ─── Session-mode helpers ────────────────────────────────────────────
function _calcSessionPot(s, settings) {
  const j = settings || jackpotSettings;
  if (!s || !s.gameState) return j.enabled ? j.base : 0;
  const completed = s.gameState.gameOver ? mpActions.recordFor(s.gameState)?.completion : null;
  if (completed) return completed.rawAmount;
  if (!j.enabled) return 0;
  const guessBonus = s.gameState.guesses.filter(g => !g._reserved).length * j.perGuess;
  const elapsed = Math.max(0, (Date.now() - s.gameStartTime) / 1000);
  const total = j.base + guessBonus + Math.floor(elapsed) * j.perSecond;
  return j.max > 0 ? Math.min(total, j.max) : total;
}

async function _processSessionGuess(session, word, playerInfo, responseSocket) {
  if (!session || !session.gameState || session.gameState.gameOver) return null;
  const g = session.gameState;
  const upperGuess = String(word || '').toUpperCase();
  const lowerGuess = String(word || '').toLowerCase();
  if (upperGuess.length !== g.wordLength) return null;
  if (!/^[A-Z]+$/.test(upperGuess)) return null;
  const dictSet = dictionarySets[g.wordLength];
  if (dictSet && !dictSet.has(lowerGuess)) return null;
  if (!dictSet && !words.isValidWord(lowerGuess)) return null;
  if (g.guesses.some(x => x.word === upperGuess)) return null;

  const canonicalUserId = playerInfo.linkedDiscord || playerInfo.platformUserId || playerInfo.username;
  const canonicalPlatform = playerInfo.linkedDiscord ? 'web' : playerInfo.platform;
  if (!mpActions.recordFor(g)) mpActions.save(g, 'session:' + session.handle, mpMetadata(g, 'session:' + session.handle, session));
  const playerCosmetics = await gameShared.getPlayerCosmetics(canonicalPlatform, canonicalUserId);
  if (responseSocket && !(await gameShared.passesPremiumWebGate([canonicalUserId], responseSocket, 'session'))) return null;
  // All checks repeat after enrichment: two concurrent calls must not both
  // accept the same word/win, or mutate a replaced/retired private round.
  if (session.gameState !== g || g.gameOver || g.guesses.some(x => x.word === upperGuess) ||
      sessionManager.getSession(session.handle) !== session) return null;

  const result = checkGuess(upperGuess, g.word);
  const guessData = {
    player: playerInfo.username,
    displayName: playerInfo.displayName || playerInfo.username,
    profilePic: playerInfo.profilePic || null,
    platform: canonicalPlatform,
    platformUserId: canonicalUserId,
    linkedDiscord: playerInfo.linkedDiscord || null,
    word: upperGuess,
    result,
    cosmetics: playerCosmetics,
  };
  g.guesses.push(guessData);
  const room = _sessionRoom(session.handle);
  const isCorrect = result.every(r => r === 'correct');

  if (isCorrect) {
    g.gameOver = true;
    g.winner = {
      username: playerInfo.username,
      displayName: playerInfo.displayName || playerInfo.username,
      profilePic: playerInfo.profilePic || null,
      platform: canonicalPlatform,
      platformUserId: canonicalUserId,
      linkedDiscord: playerInfo.linkedDiscord || null,
      cosmetics: playerCosmetics,
    };
    const finalPot = jackpotSettings.enabled ? _calcSessionPot(session, jackpotSettings) : 0;
    const intention = !session.noRewards ? mpActions.reward('win', canonicalPlatform, canonicalUserId, playerInfo.username, playerInfo.displayName, finalPot, 'win', { guessCount: g.guesses.length, word: g.word }) : null;
    try { mpActions.accept(g, mpMetadata(g, 'session:' + session.handle, session), intention ? [intention] : [], { amount: finalPot, rawAmount: finalPot, winner: g.winner, event: 'win' }); }
    catch (error) { console.error('[MPRecovery] ' + error.message); responseSocket?.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); return null; }
    session.isComplete = true;
    if (!session.noRewards) gameShared.reportLibraryWord(canonicalPlatform, canonicalUserId, upperGuess, 'wordle', playerInfo.username, playerInfo.displayName, responseSocket);
    sessionManager.scheduleSave();
    io.to(room).emit('guess', guessData);
    io.to(room).emit('game-over', {
      winner: g.winner,
      totalWins: 0,
      word: g.word,
      guessCount: g.guesses.length,
      jackpot: finalPot,
      isDaily: false,
    });
    const _winPayload = {
      game: 'wordle', gameName: 'Wordle',
      word: g.word,
      winner: g.winner,
      jackpot: finalPot,
      guessCount: g.guesses.length,
      totalWins: 0,
      isDaily: false,
      streamerHandle: session.handle,
    };
    io.to(room).emit('game-win', _winPayload);
    if (chatRelay && chatRelay.connected) {
      chatRelay.emit('game-win', _winPayload);
    }
    if (jackpotSettings.enabled) {
      if (!session.noRewards) mpActions.sendLegacyReward(g, canonicalPlatform, canonicalUserId, playerInfo.username, playerInfo.displayName || playerInfo.username, finalPot, 'win', { guessCount: g.guesses.length, word: g.word });
    }
    // Stream rounds count toward /goat ELO + rounds played, same as public.
    if (!session.noRewards) reportRoundToWordTycoon(g).catch(e => console.log('[Wordle] session ELO report failed: ' + e.message));
    sessionManager.scheduleSave();
    session.autoRestartTimer = setTimeout(() => {
      // Re-resolve the length each round so a dashboard change (or 'random')
      // takes effect on the very next round without ending the session.
      (async () => {
        try {
          const nextLen = await getSessionWordLength(session.handle);
          if (sessionManager.restartSession(session, sessionWords, { wordLength: nextLen })) {
            io.to(room).emit('new-game', {
              wordLength: session.gameState.wordLength,
              startTime: new Date(session.gameStartTime).toISOString(),
              isDaily: false,
            });
            console.log(`[Session] "${session.handle}" auto-restarted (${session.gameState.wordLength} letters)`);
          }
        } catch (err) {
          console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
        }
      })();
    }, AUTO_RESTART_DELAY);
  } else {
    try { mpActions.accept(g, mpMetadata(g, 'session:' + session.handle, session)); }
    catch (error) { console.error('[MPRecovery] ' + error.message); responseSocket?.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); return null; }
    if (!session.noRewards) gameShared.reportLibraryWord(canonicalPlatform, canonicalUserId, upperGuess, 'wordle', playerInfo.username, playerInfo.displayName, responseSocket);
    sessionManager.scheduleSave();
    io.to(room).emit('guess', guessData);
  }
  return { ok: true };
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  if (!_validStreamerHandles.has(handle)) return;
  const platform = String(msg.platform || 'unknown');
  const userObj = msg.user || {};
  const platformUserId = String(userObj.id || userObj.userId || '');
  if (platform && platformUserId && _isStreamerBlocking(handle, platform, platformUserId)) return;

  const text = (msg.message || '').trim();
  if (!text) return;
  const guess = text.replace(/[^a-zA-Z]/g, '');
  if (!guess) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({
      handle, sessionId: msg.streamSession || null, words: sessionWords,
      settings: { wordLength: await getSessionWordLength(handle) },
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.gameState) return;
  await _processSessionGuess(session, guess, {
    username: userObj.username || 'anonymous',
    displayName: userObj.customNick || userObj.displayName || userObj.username || 'anonymous',
    profilePic: userObj.profilePic || null,
    platform,
    platformUserId,
    linkedDiscord: msg.linkedDiscord || null,
  }, null);
}

function validBrowserGuess(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string' || !data.word || data.word.length > 64) return false;
  for (const [field, maximum] of [['displayName', 80], ['platformUserId', 128], ['linkedDiscord', 128], ['profilePic', 2048]]) {
    if (data[field] != null && (typeof data[field] !== 'string' || data[field].length > maximum)) return false;
  }
  return true;
}

// --- Socket.IO (Display & Web player connections) ---
io.on('connection', async (socket) => {
  // Streamer-private session viewer/overlay branch
  const sessionHandleRaw = socket.handshake?.auth?.session;
  const sessionHandle = typeof sessionHandleRaw === 'string'
    ? sessionHandleRaw.toLowerCase().trim() : null;
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    if (!_validStreamerHandles.has(sessionHandle)) {
      socket.emit('game-state', { error: 'Unknown streamer', isSession: true });
      return;
    }
    const _redir = _streamerRedirectTargets.get(sessionHandle);
    if (_redir) {
      socket.emit('session-redirect', { handle: sessionHandle, ..._redir });
      return;
    }
    socket._isSession = true;
    socket._sessionHandle = sessionHandle;
    socket.join(_sessionRoom(sessionHandle));
    try {
      const session = await sessionManager.getOrCreateSession({ handle: sessionHandle, words: sessionWords, settings: { wordLength: await getSessionWordLength(sessionHandle) } });
      if (session) {
        socket.emit('game-state', sessionManager.buildSessionState(session, jackpotSettings, _calcSessionPot));
      } else {
        socket.emit('game-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    socket.on('guess', async (data) => {
      const session = sessionManager.getSession(sessionHandle);
      if (!session) return;
      if (!validBrowserGuess(data)) return;
      const { word } = data;
      // Premium gate (2026-07-31): page play in a streamer room is Donor-only
      // too. TikTok/Discord chat play-along is unaffected — those guesses come
      // through the relay chat client, never this socket.
      if (!(await passesPremiumWebGate([data.linkedDiscord, data.platformUserId], socket, 'session'))) return;
      gameShared.reportSocketIP(socket, data.platform || 'web', data.platformUserId, 'wordle');
      // Perk badges for this web player, resolved by the premium gate above.
      await _processSessionGuess(session, word, {
        ...(socket._wtPerks || {}),
        username: (data.displayName || 'Player').toLowerCase(),
        displayName: data.displayName || 'Player',
        profilePic: data.profilePic || null,
        platform: 'web',
        platformUserId: socket._wtVerifiedAnchorId || socket._wtVerifiedIdentity,
        linkedDiscord: null,
      }, socket);
    });
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  displayCount++;
  connectedPlayers++;
  // Connection logged only at debug level to reduce noise

  socket.emit('game-state', {
    wordLength: gameState.wordLength,
    guesses: gameState.guesses.filter(g => !g._reserved),
    gameOver: gameState.gameOver,
    winner: gameState.winner,
    winnerTotalWins: gameState.winner
      ? (winners[getWinnerKey(gameState.winner)]?.wins || 0)
      : 0,
    lastWinner,
    lastWinnerTotalWins,
    jackpot: calculateJackpot(),
    startTime: gameState.startTime,
    word: gameState.gameOver ? gameState.word : null,
    completedJackpot: gameState.gameOver ? (mpActions.recordFor(gameState)?.completion?.amount ?? calculateJackpot()) : null,
    winHistory: history.slice(0, 10),
    isDaily: gameState.isDaily || false,
    frenzy: currentFrenzy,
  });

  // Admin auth via socket
  socket.on('admin-auth', (key) => {
    if (key === ADMIN_SECRET) socket.isAdmin = true;
  });

  // Web player guess (from mp-init.js)
  socket.on('guess', async (data) => {
    if (!validBrowserGuess(data)) return;
    const { word } = data;

    const user = {
      displayName: data.displayName || 'Player',
      platform: data.platform || 'web',
      platformUserId: data.platformUserId || null,
      linkedDiscord: data.linkedDiscord || null,
      profilePic: data.profilePic || null,
    };
    // Premium gate: only public web sockets reach this handler.
    if (!(await passesPremiumWebGate([user.linkedDiscord, user.platformUserId], socket))) return;
    // Attribute browser writes to the verified account, regardless of payload platform.
    user.platform = 'web'; user.platformUserId = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentity; user.linkedDiscord = null;
    Object.assign(user, socket._wtPerks || {});
    gameShared.reportSocketIP(socket, user.platform, user.platformUserId, 'wordle');

    // Validate against dictionary (server-side for MP)
    const upperGuess = word.toUpperCase();
    const lowerGuess = word.toLowerCase();

    if (upperGuess.length !== gameState.wordLength) {
      socket.emit('guess-error', { error: `Word must be ${gameState.wordLength} letters` });
      return;
    }
    if (!/^[A-Z]+$/.test(upperGuess)) {
      socket.emit('guess-error', { error: 'Only letters allowed' });
      return;
    }

    const dictSet = dictionarySets[gameState.wordLength];
    if (dictSet && !dictSet.has(lowerGuess)) {
      socket.emit('guess-error', { error: 'Not a valid word' });
      return;
    } else if (!dictSet && !words.isValidWord(lowerGuess)) {
      socket.emit('guess-error', { error: 'Not a valid word' });
      return;
    }

    if (gameState.guesses.some(g => g.word === upperGuess)) {
      socket.emit('guess-error', { error: 'Already guessed' });
      return;
    }

    processGuess(
      user.displayName.toLowerCase(),
      user.displayName,
      user.profilePic,
      user.platform,
      word,
      user.platformUserId,
      user.linkedDiscord,
      socket
    );
  });

  socket.on('disconnect', () => {
    displayCount--;
    connectedPlayers--;
    // Disconnect logged only at debug level to reduce noise
  });
});

// --- Connect to Chat Relay ---
let chatRelay = null;

function connectToChatRelay() {
  console.log(`[Wordle] Connecting to Chat Relay at ${CHAT_RELAY_URL}...`);

  chatRelay = gameShared.createRelayClient({
    id: 'wordle',
    name: 'Wordle',
    port: PORT,
    apiSecret: ADMIN_SECRET,
    relayUrl: CHAT_RELAY_URL
  }, {
    onConnect: () => {
      relayConnected = true;
    },
    onDisconnect: () => {
      relayConnected = false;
    },
    onConnectError: () => {
      relayConnected = false;
    },
    onCosmeticsUpdated: ({ platform, platformUserId, equipped }) => {
    gameShared.invalidateCosmetics(platform, platformUserId, equipped);

    let changed = false;

    for (const guess of gameState.guesses) {
      if (guess.platform === platform && guess.platformUserId === platformUserId) {
        guess.cosmetics = equipped;
        changed = true;
      }
    }

    if (gameState.winner && gameState.winner.platform === platform && gameState.winner.platformUserId === platformUserId) {
      gameState.winner.cosmetics = equipped;
      changed = true;
    }

    if (lastWinner && lastWinner.platform === platform && lastWinner.platformUserId === platformUserId) {
      lastWinner.cosmetics = equipped;
      changed = true;
    }

    if (changed) {
      io.to('public').emit('game-state', {
        wordLength: gameState.wordLength,
        guesses: gameState.guesses.filter(g => !g._reserved),
        gameOver: gameState.gameOver,
        winner: gameState.winner,
        winnerTotalWins: gameState.winner
          ? (winners[getWinnerKey(gameState.winner)]?.wins || 0)
          : 0,
        lastWinner,
        lastWinnerTotalWins,
        jackpot: calculateJackpot(),
        startTime: gameState.startTime,
        word: gameState.gameOver ? gameState.word : null,
        completedJackpot: gameState.gameOver ? (mpActions.recordFor(gameState)?.completion?.amount ?? calculateJackpot()) : null,
    startTime: gameState.startTime,
    word: gameState.gameOver ? gameState.word : null,
    completedJackpot: gameState.gameOver ? (mpActions.recordFor(gameState)?.completion?.amount ?? calculateJackpot()) : null,
        isDaily: gameState.isDaily || false,
        frenzy: currentFrenzy,
      });
    }
    },
    onFrenzyUpdate: (data) => {
    if (data && typeof data.multiplier === 'number') {
      currentFrenzy = data;
      io.to('public').emit('frenzy-update', data);
    }
    },
    onChat: (data) => {
    if (!data || !data.user || !data.message) return;

    // Streamer-private session: route to per-streamer state if tagged.
    if (data.streamerHandle) {
      handleSessionChat(data).catch(() => {});
      return;
    }

    const { user, message, platform } = data;
    const text = message.trim();

    if (!text || text.includes(' ')) return;

    // Strip non-letter characters
    const cleaned = text.replace(/[^a-zA-Z]/g, '');
    if (!cleaned) return;

    processGuess(
      user.username,
      user.customNick || user.displayName || user.username,
      user.profilePic,
      platform || 'unknown',
      cleaned,
      user.id,
      data.linkedDiscord
    );
    }
  });
}

// --- Start ---
async function start() {
  const recovered = mpActions.load('public');
  if (recovered) {
    gameState = recovered.state; gameStartTime = recovered.record.meta.startTime; restorePublicData(recovered.record.meta);
    if (gameState.isDaily && recovered.record.meta.period === gameShared.getEdmontonDate()) dailyRounds.consume(recovered.record.meta.period);
    dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate());
  }
  await loadFromWordBank();

  // Fetch daily word (non-fatal if Chat Relay not ready yet)
  await fetchDailyWord();
  setInterval(fetchDailyWord, 3600000); // refresh hourly

  server.listen(PORT, () => {
    console.log(`[Wordle] Server running at http://localhost:${PORT}`);
    if (recovered && (!gameState.isDaily || recovered.record.meta.period === gameShared.getEdmontonDate())) {
      mpActions.recover();
      if (gameState.gameOver) newGameTimeout = setTimeout(startNewGame, AUTO_RESTART_DELAY);
      else startJackpotBroadcast();
    } else startNewGame();
    connectToChatRelay();
  });
}

start().catch(err => {
  console.error('[Wordle] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Wordle] Shutting down...');
  if (newGameTimeout) clearTimeout(newGameTimeout);
  stopJackpotBroadcast();
  saveWinners();
  saveHistory();
  console.log('[Wordle] Data saved');
  if (chatRelay) chatRelay.disconnect();
  server.close();
  console.log('[Wordle] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
