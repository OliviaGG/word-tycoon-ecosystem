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
const server = http.createServer(app);
const io = new Server(server);

const BLOCKED_PUBLIC_PATH_RE = /(^|\/)(?:\.[^/]+|[^/]+(?:\.bak(?:[-._][^/]*)?|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i;
function blockSensitivePublicPaths(req, res, next) {
  const requestPath = req.path || '/';
  if (/^\/\.well-known(?:\/|$)/i.test(requestPath)) return next();
  if (BLOCKED_PUBLIC_PATH_RE.test(requestPath)) return res.status(404).send('Not found');
  next();
}

app.use(blockSensitivePublicPaths);

const PORT = process.env.PORT || 3006;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const relayOrigin = new URL(CHAT_RELAY_URL);
if (!['localhost','127.0.0.1','[::1]'].includes(relayOrigin.hostname) || relayOrigin.protocol !== 'http:' || relayOrigin.port !== '3000' || relayOrigin.username || relayOrigin.password) throw Error('Invalid local Relay origin');
const relayFetch = (url, options = {}) => { if (new URL(url).origin !== relayOrigin.origin) throw Error('Invalid Relay destination'); return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) }); };

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public web MULTIPLAYER guessing requires Donor Class / TikTok Super Fan.
// Streamer-session sockets (auth.session branch) and relay chat (onChat)
// use different code paths and stay free; the word1000 solo daily is a
// separate service and untouched.

// Returns true when the web guess may proceed; otherwise emits
// premium-required to the socket and returns false. The check itself lives in
// chat-relay's game-shared.js (2026-07-31) so every game gates identically —
// it replaces a local snowflake-shape test that read any non-Discord id
// (gh_/google_/tt_) as logged-out and blocked it even when that account's
// subscription was linked to a Discord one.
async function passesPremiumWebGate(user, socket, context = 'mp') {
  return gameShared.passesPremiumWebGate([user.id, user.platformUserId], socket, context);
}

// ─── Streamer whitelist + redirect targets (declared above any closure that references them) ──
let _validStreamerHandles = new Set();
let _streamerSettings = new Map();
const _streamerRedirectTargets = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
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
  } catch (_) { /* keep stale set on transient errors */ }
}
_refreshStreamerHandles();
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
function _sessionRoom(handle) { return `word500:session:${String(handle || '').toLowerCase()}`; }

// ─── Per-streamer word length (Chat Relay "Word Length" dashboard card) ───
// The streamer picks 4-8 or "random" at /streamer; private sessions read it
// here. Clamped to the lengths the word bank actually stocks targets for.
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
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/streamer-public/by-handle/${encodeURIComponent(key)}/difficulty`);
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
  return SESSION_WORD_LENGTHS.filter(n => words.getTargets(n).length > 0);
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

const NEW_GAME_DELAY = 5000;
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

// --- Game state ---
let gameState = {
  word: '',
  guesses: [],
  gameOver: false,
  winner: null,
  letterStates: {},
  wordLength: 5,
};

let lastWinner = null;
let newGameTimeout = null;
let connectedDisplays = 0;
let connectedPlayers = 0;
let totalGamesPlayed = 0;
let requireSlashPrefix = false;

// --- Hint helpers ---
function getGameStateForHandle(handle) {
  if (!handle || handle === 'public') return gameState;
  const session = sessionManager.getSession(handle);
  return session?.gameState || gameState;
}

function generateHintForHandle(handle) {
  const state = getGameStateForHandle(handle);
  const word = String(state.word || '').toUpperCase();
  if (!word || state.gameOver) return null;

  // Prefer positions that have not yet been correctly guessed.
  const correctlyGuessed = new Set();
  const guesses = state.guesses || [];
  for (const guess of guesses) {
    const gw = String(guess.word || '').toUpperCase();
    if (gw.length !== word.length) continue;
    for (let i = 0; i < word.length; i++) {
      if (gw[i] === word[i]) correctlyGuessed.add(i);
    }
  }

  const available = [];
  for (let i = 0; i < word.length; i++) {
    if (!correctlyGuessed.has(i)) available.push(i);
  }
  const pool = available.length ? available : [...Array(word.length).keys()];
  const position = pool[Math.floor(Math.random() * pool.length)];
  return {
    letter: word[position],
    position,
    wordLength: word.length,
  };
}
let jackpotSettings = {
  enabled: true,
  dailyEnabled: false,
  base: 300,
  perGuess: 10,
  perSecond: 1.67,  // approximately 1000/600
  max: 10000
};
let gameStartTime = Date.now();

// Crash-safe file write (write-to-temp-then-rename)
function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// Report a finished round's participants to Word Tycoon for ELO / rounds-played.
//
// `state` defaults to the public `gameState` but private streamer sessions pass
// their own `session.gameState`, so stream rounds count toward /goat exactly
// like public ones (2026-07-21). Bots and guests are filtered out — they play
// in sessions but must never earn a rating.
async function reportRoundToWordTycoon(state = gameState) {
  try {
    if (!state || !Array.isArray(state.guesses)) return;
    const seen = new Set();
    const participants = [];
    const winnerIdentity = state.winner
      ? (state.winner.linkedDiscord
          ? `discord:${state.winner.linkedDiscord}`
          : `${state.winner.platform}:${state.winner.platformUserId || 'unknown'}`)
      : null;

    for (const guess of state.guesses) {
      const identity = guess.linkedDiscord
        ? `discord:${guess.linkedDiscord}`
        : `${guess.platform}:${guess.platformUserId || 'unknown'}`;
      if (seen.has(identity)) continue;
      if (!gameShared.isStatsEligible(identity)) continue;
      seen.add(identity);

      const isWinner = identity === winnerIdentity;
      const guessCount = state.guesses.filter(g => {
        const gId = g.linkedDiscord
          ? `discord:${g.linkedDiscord}`
          : `${g.platform}:${g.platformUserId || 'unknown'}`;
        return gId === identity;
      }).length;

      participants.push({
        identity,
        points: isWinner ? 100 : 0,
        rank: isWinner ? 1 : 2,
        wonRound: isWinner,
        foundTarget: isWinner,
        rankOutOf: 0,
        guesses: guessCount,
        hits: isWinner ? 1 : 0,
        firstHitMs: null,
        articleTitle: state.word || '?',
      });
    }

    if (participants.length < 2) return;
    for (const p of participants) p.rankOutOf = participants.length;

    await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'word500', participants }),
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[Word500] ELO report failed/error:', err.message || err);
  }
}

// --- Played Words Tracking ---
const DATA_DIR = process.env.WORD500_DATA_DIR || path.join(__dirname, 'data');
let recovery = null;
const WIN_HISTORY_PATH = path.join(DATA_DIR, 'win-history.json');
const WIN_HISTORY_BACKUP_PATH = path.join(DATA_DIR, 'win-history-backup.json');
const PLAYED_WORDS_PATH = path.join(DATA_DIR, 'played-words.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let playedWords = {};  // { "5": ["apple","brain",...], ... }

function loadPlayedWords() {
  try {
    if (fs.existsSync(PLAYED_WORDS_PATH)) {
      playedWords = JSON.parse(fs.readFileSync(PLAYED_WORDS_PATH, 'utf-8'));
      if (!playedWords || typeof playedWords !== 'object' || Array.isArray(playedWords) || Object.values(playedWords).some(list => !Array.isArray(list) || list.length > 100000)) throw Error('Invalid played-word pool');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function savePlayedWords() {
  try {
    atomicWriteSync(PLAYED_WORDS_PATH, playedWords);
  } catch (err) {
    console.error('[PlayedWords] Failed to save:', err.message);
  }
}

// --- Win History (file-persisted with backup redundancy) ---
function readLegacyWinHistory() {
  for (const filename of [WIN_HISTORY_PATH, WIN_HISTORY_BACKUP_PATH]) {
    try { const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (Array.isArray(value) && value.length <= 50000 && (value.length || filename === WIN_HISTORY_BACKUP_PATH || !fs.existsSync(WIN_HISTORY_BACKUP_PATH))) return value;
    } catch (error) { if (error.code === 'ENOENT') continue; }
  }
  if (fs.existsSync(WIN_HISTORY_PATH) || fs.existsSync(WIN_HISTORY_BACKUP_PATH)) throw Error('No valid legacy win history');
  return [];
}
let history = readLegacyWinHistory(), historyReceipts = [];
function loadWinHistory() { return history; }
function initializeRecovery() {
  const { createPlainGameActions } = require(path.join(RELAY_DIR, 'src/plain-game-actions'));
  const { createWordRecovery } = require('./src/mp-recovery');
  recovery = createWordRecovery({ createActions: createPlainGameActions, directory: path.join(DATA_DIR, 'mp-actions'), sdk: gameShared,
    getSettings: () => jackpotSettings,
    getPublicMeta: () => ({ history, historyReceipts, totalGamesPlayed, lastWinner, jackpotSettings,
      requireSlashPrefix, playedWords, dailyPlayed, dailyDate: gameShared.getEdmontonDate() }),
    setPublicMeta: value => {
      jackpotSettings = validateJackpot(value.jackpotSettings); requireSlashPrefix = !!value.requireSlashPrefix;
      history = value.history; historyReceipts = value.historyReceipts; totalGamesPlayed = value.totalGamesPlayed || 0;
      lastWinner = value.lastWinner || null; playedWords = value.playedWords || {};
      dailyPlayed = value.dailyDate === gameShared.getEdmontonDate() ? !!value.dailyPlayed : dailyRounds.has(gameShared.getEdmontonDate());
    },
    mirrorHistory: rows => { atomicWriteSync(WIN_HISTORY_PATH, rows); atomicWriteSync(WIN_HISTORY_BACKUP_PATH, rows); },
    onError: () => console.error('[Word500] Accepted action delivery requires retry'),
  });
  sessionManager.configureRecovery(recovery.sessionHooks());
}
function validateJackpot(input, base = jackpotSettings) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid jackpot settings');
  const next = { ...base }, limits = { base: 50000, perGuess: 500, perSecond: 100, max: 10000000 };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'enabled' || key === 'dailyEnabled') { if (typeof value !== 'boolean') throw Error('Invalid jackpot flag'); }
    else if (!(key in limits) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > limits[key]) throw Error('Invalid jackpot value');
    next[key] = value;
  }
  return next;
}

function countUserWins(history, userId, linkedDiscord) {
  let count = 0;
  for (const w of history) {
    const wId = (w.winner && (w.winner.platformUserId || w.winner.userId)) || null;
    const wLd = (w.winner && w.winner.linkedDiscord) || null;
    if (wId === userId) { count++; continue; }
    if (linkedDiscord && wLd && wLd === linkedDiscord) { count++; continue; }
    if (linkedDiscord && wId === linkedDiscord) { count++; continue; }
    if (wLd && wLd === userId) { count++; continue; }
  }
  return count;
}

function getWinCount(platformUserId, linkedDiscord) {
  const history = loadWinHistory();
  return countUserWins(history, platformUserId, linkedDiscord);
}

// --- Daily Word ---
let dailyWord = null;    // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(DATA_DIR, 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate()); // true once the daily round has started today

async function fetchDailyWord(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const len = gameState.wordLength || 5;
      const res = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/word500?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data = await res.json();
      // Check if it's a new day → reset dailyPlayed
      if (dailyWord && dailyWord.date !== data.date) {
        dailyPlayed = dailyRounds.has(data.date);
        console.log(`[Word500] New daily word available for ${data.date}`);
      }
      dailyWord = data;
      return;
    } catch (e) {
      console.warn(`[Word500] Daily word fetch failed (attempt ${attempt}/${retries}):`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

function parseWordLength(value, fallback = 5) {
  const len = parseInt(value, 10);
  if (!Number.isFinite(len) || len < 3 || len > 12) return fallback;
  return len;
}

async function proxyRelayJson(pathAndQuery, res, label) {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}${pathAndQuery}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error(`[WordBank] ${label} proxy failed:`, err.message);
    res.status(502).json({ error: 'Word bank unavailable' });
  }
}

// Hub proxy support: the Word Tycoon `/game/word500` wrapper rewrites
// root-relative word-bank requests into this app.
app.get('/api/sp/daily', async (req, res) => {
  const len = parseWordLength(req.query.length, 5);
  await proxyRelayJson(`/api/word-bank/daily/word500-sp?length=${encodeURIComponent(len)}`, res, 'daily');
});

app.get('/api/word-bank/dictionary/:length', async (req, res) => {
  const len = parseWordLength(req.params.length, 5);
  await proxyRelayJson(`/api/word-bank/dictionary/${encodeURIComponent(len)}`, res, 'dictionary');
});

app.get('/api/word-bank/targets', async (_req, res) => {
  await proxyRelayJson('/api/word-bank/targets', res, 'targets');
});

app.get('/api/word-bank/targets/:length', async (req, res) => {
  const len = parseWordLength(req.params.length, 5);
  await proxyRelayJson(`/api/word-bank/targets/${encodeURIComponent(len)}`, res, 'targets:length');
});

// --- Frenzy ---
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };

// --- New Game ---
function startNewGame(wordLength) {
  const len = wordLength || 5;
  if (!Number.isInteger(len) || len < 4 || len > 8) throw Error('Invalid word length');
  const today = gameShared.getEdmontonDate(), isDaily = !dailyPlayed && dailyWord?.date === today && dailyWord.length === len && jackpotSettings.dailyEnabled;
  let word = isDaily ? dailyWord.word : words.getRandomTarget(len, playedWords[String(len)] || []);
  const pool = JSON.parse(JSON.stringify(playedWords));
  if (!word && !isDaily) { pool[String(len)] = []; word = words.getRandomTarget(len, []); }
  if (!word) throw Error('No targets available');
  (pool[String(len)] ||= []).push(word.toLowerCase());
  const opening = Date.now(), next = { word: word.toUpperCase(), guesses: [], gameOver: false, winner: null,
    letterStates: {}, wordLength: len, isDaily, dailyDate: isDaily ? today : null, startedAt: opening, potStartedAt: opening };
  const previousPool = playedWords, previousDaily = dailyPlayed;
  playedWords = pool; dailyPlayed = previousDaily || isDaily;
  try { recovery.startPublic(next); } catch (error) { playedWords = previousPool; dailyPlayed = previousDaily; throw error; }
  if (newGameTimeout) clearTimeout(newGameTimeout); newGameTimeout = null;
  gameState = next; gameStartTime = opening;
  if (isDaily) try { dailyRounds.consume(today); } catch (_) { console.error('[Word500] Daily consumption mirror requires recovery'); }
  savePlayedWords();
  io.to('public').emit('new-game', { gameStartTime, jackpotEnabled: jackpotSettings.enabled, wordLength: len, isDaily });
}
function calculatePot() { return recovery ? recovery.pot(gameState) : 0; }
function _calcSessionPot(session) { return session?.gameState && recovery ? recovery.pot(session.gameState) : 0; }
function scoreGuess(guess, target) {
  const used = Array(target.length).fill(false), states = Array(target.length).fill(null); let correct = 0, present = 0;
  for (let i = 0; i < target.length; i++) if (guess[i] === target[i]) { states[i] = 'correct'; used[i] = true; correct++; }
  for (let i = 0; i < target.length; i++) if (!states[i]) {
    const match = [...target].findIndex((letter, j) => !used[j] && letter === guess[i]);
    if (match >= 0) { used[match] = true; states[i] = 'present'; present++; } else states[i] = 'absent';
  }
  return { correct, present, absent: target.length - correct - present };
}
function scheduleOwnedRound(state, session = null, retry = false) {
  const delay = retry ? 5000 : Math.max(0, (state.wonAt || Date.now()) + NEW_GAME_DELAY - Date.now());
  const timer = setTimeout(async () => {
    if (session ? sessionManager.getSession(session.handle) !== session || session.gameState !== state : gameState !== state) return;
    try {
      if (session) {
        const length = await getSessionWordLength(session.handle);
        if (sessionManager.getSession(session.handle) !== session || session.gameState !== state) return;
        if (!sessionManager.restartSession(session, words, { wordLength: length })) throw Error('No private targets');
        sessionManager.scheduleSave();
        io.to(_sessionRoom(session.handle)).emit('new-game', { gameStartTime: session.gameStartTime,
          jackpotEnabled: jackpotSettings.enabled, wordLength: session.gameState.wordLength, isDaily: false });
      } else startNewGame();
    } catch (_) { scheduleOwnedRound(state, session, true); }
  }, delay); timer.unref?.();
  if (session) { if (session.autoRestartTimer) clearTimeout(session.autoRestartTimer); session.autoRestartTimer = timer; }
  else { if (newGameTimeout) clearTimeout(newGameTimeout); newGameTimeout = timer; }
}
async function processGuess(...args) { return processOwnedGuess(null, ...args); }
async function processSessionGuess(session, ...args) { return processOwnedGuess(session, ...args); }
async function processOwnedGuess(session, username, displayName, profilePic, platform, message, userId, linkedDiscord, socket, isFanClub, isSuperfan) {
  const state = session ? session.gameState : gameState;
  if (!state || state.gameOver) return { ok: false, reason: 'round-complete' };
  if (typeof message !== 'string' || !message || message.length > 96) return { ok: false, reason: 'invalid-guess' };
  const guess = message.trim().replace(/[^a-zA-Z]/g, '').toUpperCase(), len = state.wordLength;
  if (guess.length !== len || !words.isValidGuess(guess.toLowerCase())) return { ok: false, reason: 'invalid-word' };
  if (state.guesses.some(row => row.word === guess)) return { ok: false, reason: 'already-guessed' };
  if (state.guesses.length >= 200) return { ok: false, reason: 'board-full' };
  recovery.ensure(state, session);
  const cosmetics = await gameShared.getPlayerCosmetics(platform, userId || username);
  if (session ? sessionManager.getSession(session.handle) !== session || session.gameState !== state : gameState !== state) return { ok: false, reason: 'round-changed' };
  if (state.gameOver || state.guesses.some(row => row.word === guess)) return { ok: false, reason: 'already-guessed' };
  if (state.guesses.length >= 200) return { ok: false, reason: 'board-full' };
  const before = JSON.parse(JSON.stringify(state)), perks = socket?._wtPerks || {}, score = scoreGuess(guess, state.word), allAbsent = !score.correct && !score.present;
  for (const letter of guess) if (!state.letterStates[letter]) state.letterStates[letter] = 'used';
  if (allAbsent) for (const letter of guess) if (state.letterStates[letter] !== 'inword') state.letterStates[letter] = 'absent';
  const row = { word: guess, ...score, allAbsent, displayStates: [...guess].map(() => allAbsent ? 'absent' : 'neutral'),
    displayName: displayName || username, profilePic: profilePic || null, platform, platformUserId: userId || username,
    linkedDiscord: linkedDiscord || null, cosmetics, isFanClub: !!isFanClub || !!perks.isFanClub,
    isSuperfan: !!isSuperfan || !!perks.isSuperfan, isDonor: !!perks.isDonor, letterStates: { ...state.letterStates } };
  state.guesses.push(row);
  if (score.correct === len) { state.gameOver = true; state.winner = { displayName: row.displayName, profilePic: row.profilePic,
    platform, platformUserId: row.platformUserId, linkedDiscord: row.linkedDiscord, cosmetics,
    isFanClub: row.isFanClub, isSuperfan: row.isSuperfan, isDonor: row.isDonor }; }
  let accepted;
  try { accepted = recovery.accept(state, session, currentFrenzy.multiplier ?? 1); }
  catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, before); throw error; }
  if (!session?.noRewards) try { Promise.resolve(gameShared.reportLibraryWord(platform, row.platformUserId, guess, 'word500', username, displayName, socket)).catch(() => {}); } catch (_) {}
  const room = session ? _sessionRoom(session.handle) : 'public'; io.to(room).emit('guess', row);
  if (state.gameOver) {
    if (session) { session.isComplete = true; sessionManager.scheduleSave(); }
    const payload = { winner: state.winner, word: state.word, guessCount: state.guesses.length,
      totalWins: state.totalWins || 0, pot: accepted.completion.amount, isDaily: !!state.isDaily };
    io.to(room).emit('game-over', payload);
    const notification = { ...payload, game: 'word500', gameName: 'Word5000', jackpot: payload.pot, ...(session ? { streamerHandle: session.handle } : {}) };
    io.to(room).emit('game-win', notification);
    if (chatRelay?.connected) { chatRelay.emit('game-win', notification); if (state.isDaily) chatRelay.emit('daily-win', { game: 'word500', winner: row.displayName, platform }); }
    if (!session?.noRewards && (session || jackpotSettings.enabled)) reportRoundToWordTycoon(state).catch(() => {});
    scheduleOwnedRound(state, session);
  } else if (session) sessionManager.scheduleSave();
  return { ok: true };
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  const user = msg.user || {};
  const platform = String(msg.platform || user.platform || 'unknown');
  const platformUserId = String(user.id || user.userId || user.uniqueId || '');
  if (platform && platformUserId && _isStreamerBlocking(handle, platform, platformUserId)) return;

  const text = (msg.message || '').trim();
  if (!text) return;
  let raw;
  if (requireSlashPrefix) {
    if (!text.startsWith('/') && !text.startsWith('.')) return;
    raw = text.slice(1);
  } else {
    raw = text;
  }
  const guess = raw.replace(/[^a-zA-Z]/g, '');
  if (!guess) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({
      handle, sessionId: msg.streamSession || null, words,
      settings: { wordLength: await getSessionWordLength(handle) },
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.gameState) return;
  const _fcSess = Array.isArray(user.badges) && user.badges.indexOf('fan-club') !== -1;
  await processSessionGuess(
    session,
    user.username || 'anonymous',
    user.customNick || user.displayName || user.username || 'anonymous',
    user.profilePic || user.profilePictureUrl || null,
    platform,
    guess,
    platformUserId,
    msg.linkedDiscord || null,
    msg._responseSocket || null,
    _fcSess,
  );
}

// --- Helper: get public state (no secret word) ---
const SOCKET_GUESS_LIMIT = 24;
const SOCKET_WIN_HISTORY_LIMIT = 200;

function buildPublicState(options = {}) {
  const guessLimit = options.guessLimit || null;
  const winHistoryLimit = options.winHistoryLimit || null;
  const guesses = guessLimit ? gameState.guesses.slice(-guessLimit) : gameState.guesses;
  const winHistory = loadWinHistory();

  return {
    guesses,
    guessCount: gameState.guesses.length,
    gameOver: gameState.gameOver,
    winner: gameState.winner ? {
      displayName: gameState.winner.displayName,
      platform: gameState.winner.platform,
      profilePic: gameState.winner.profilePic,
      cosmetics: gameState.winner.cosmetics,
    } : null,
    letterStates: gameState.letterStates,
    lastWinner,
    gameStartTime,
    roundStartedAt: gameState.startedAt,
    startTime: new Date(gameStartTime).toISOString(),
    jackpot: calculatePot(),
    jackpotAwarded: gameState.jackpotAwarded,
    word: gameState.gameOver ? gameState.word : null,
    totalWins: gameState.totalWins,
    jackpotEnabled: jackpotSettings.enabled,
    wordLength: gameState.wordLength || 5,
    winHistory: winHistoryLimit ? winHistory.slice(-winHistoryLimit) : winHistory,
    isDaily: gameState.isDaily || false,
    frenzy: currentFrenzy,
    playerCount: connectedPlayers,
  };
}

function getPublicState() {
  return buildPublicState();
}

function getSocketPublicState() {
  return buildPublicState({
    guessLimit: SOCKET_GUESS_LIMIT,
    winHistoryLimit: SOCKET_WIN_HISTORY_LIMIT,
  });
}

// --- Helper: get admin state (includes secret word) ---
function getAdminState() {
  return {
    ...getPublicState(),
    word: gameState.word,
    connectedDisplays,
    chatRelayConnected: chatRelay?.connected || false,
    requireSlashPrefix,
    wordStats: words.getStats(),
  };
}

// --- Admin endpoints ---
app.use(express.json({ limit: '32kb' }));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Public state: does NOT include the secret word
app.get('/api/state', (req, res) => {
  res.json(getPublicState());
});

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Word500] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one target letter.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const hint = generateHintForHandle(handle);
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'word500', label: 'Word500 web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[Word500] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

// Admin auth middleware
const ADMIN_SECRET = process.env.GAME_API_SECRET;
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.headers['x-admin-key'] || req.query.adminKey;
  if (key === ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify its signed portal session or remember cookie. Returns null for guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;)\s*(?:wt_remember|connect\.sid)=[^;]+/.test(cookie)) return null;
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
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
    console.error('[Word500] whoami failed:', e.message);
  }
  return null;
}

// Admin state: includes the secret word (admin only)
app.get('/api/admin-state', requireAdmin, (req, res) => {
  res.json(getAdminState());
});

app.get('/api/stats', (req, res) => {
  const history = loadWinHistory();
  const wins = {};
  for (const h of history) {
    const key = h.winner?.platformUserId || h.winner?.displayName || 'Unknown';
    const name = h.winner?.displayName || 'Unknown';
    if (!wins[key]) wins[key] = { name, wins: 0 };
    wins[key].wins++;
  }
  const leaderboard = Object.values(wins)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 20);

  res.json({ totalGamesPlayed, recentGames: history.slice(-50).reverse(), leaderboard });
});

app.get('/api/game/history', (_req, res) => {
  res.json(loadWinHistory());
});

// New game: does NOT return the secret word (admin only)
app.post('/api/new-game', requireAdmin, (req, res) => {
  try { startNewGame(req.body?.wordLength); res.json({ ok: true, wordLength: gameState.wordLength }); }
  catch (error) { res.status(/Invalid word length|No targets/.test(error.message) ? 400 : 503).json({ ok: false, error: 'New round could not be accepted' }); }
});
function persistSettings(change) {
  const before = { jackpotSettings, requireSlashPrefix, gameStartTime, potStartedAt: gameState.potStartedAt };
  try { change(); recovery.saveMetadata(gameState); }
  catch (error) { jackpotSettings = before.jackpotSettings; requireSlashPrefix = before.requireSlashPrefix;
    gameStartTime = before.gameStartTime; gameState.potStartedAt = before.potStartedAt; throw error; }
}
function resetPot(req, res) {
  if (gameState.gameOver) return res.status(409).json({ ok: false, error: 'Completed payout is frozen' });
  try { persistSettings(() => { gameStartTime = Date.now(); gameState.potStartedAt = gameStartTime; });
    io.to('public').emit('game-state', getSocketPublicState()); res.json({ ok: true, gameStartTime, current: calculatePot() }); }
  catch (_) { res.status(503).json({ ok: false, error: 'Jackpot opening could not be saved' }); }
}

app.get('/api/jackpot', (req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: calculatePot(),
  });
});

app.post('/api/jackpot', requireAdmin, (req, res) => {
  const enabled = req.body?.enabled;
  if (enabled !== undefined && typeof enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'Invalid enabled flag' });
  try { persistSettings(() => { jackpotSettings = { ...jackpotSettings, enabled: enabled ?? !jackpotSettings.enabled }; });
    io.to('public').emit('game-state', getSocketPublicState()); res.json({ ok: true, enabled: jackpotSettings.enabled }); }
  catch (_) { res.status(503).json({ ok: false, error: 'Jackpot setting could not be saved' }); }
});
app.post('/api/reset-jackpot', requireAdmin, resetPot);

// --- Standardized jackpot settings endpoints ---
app.get('/api/jackpot/settings', (req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    dailyEnabled: jackpotSettings.dailyEnabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: calculatePot(),
  });
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
  let next;
  try { next = validateJackpot(req.body || {}); } catch (_) { return res.status(400).json({ ok: false, error: 'Invalid jackpot settings' }); }
  try { persistSettings(() => { jackpotSettings = next; }); res.json({ ok: true, ...jackpotSettings, current: calculatePot() }); }
  catch (_) { res.status(503).json({ ok: false, error: 'Jackpot settings could not be saved' }); }
});
app.post('/api/jackpot/reset', requireAdmin, resetPot);
app.post('/api/toggle-slash-prefix', requireAdmin, (req, res) => {
  try { persistSettings(() => { requireSlashPrefix = !requireSlashPrefix; }); res.json({ ok: true, requireSlashPrefix }); }
  catch (_) { res.status(503).json({ ok: false, error: 'Chat setting could not be saved' }); }
});
app.post('/api/test-guess', requireAdmin, async (req, res) => {
  if (typeof req.body?.word !== 'string' || req.body.word.length > 96 || req.body.user !== undefined && (typeof req.body.user !== 'string' || req.body.user.length > 80)) return res.status(400).json({ ok: false, error: 'Invalid test guess' });
  try { const user = req.body.user || 'Admin', result = await processGuess(user.toLowerCase(), user, null, 'admin', req.body.word);
    res.json({ ...result, guesses: gameState.guesses.length }); }
  catch (_) { res.status(503).json({ ok: false, error: 'Test guess could not be saved' }); }
});

// Played words stats
app.get('/api/played-words', (req, res) => {
  const stats = {};
  const lengths = words.getWordLengths();
  for (const len of lengths) {
    const pool = words.getTargets(len);
    const played = (playedWords[String(len)] || []).length;
    stats[len] = { pool: pool.length, played, remaining: pool.length - played };
  }
  res.json(stats);
});

app.post('/api/reset-played-words', requireAdmin, (req, res) => {
  const len = req.body?.wordLength;
  if (len) {
    playedWords[String(len)] = [];
  } else {
    playedWords = {};
  }
  savePlayedWords();
  console.log(`[Admin] Played words reset${len ? ` for length ${len}` : ' (all)'}`);
  res.json({ ok: true });
});

// --- Routes (unified next/ shell) ─────────────────────────────────────────
//   /                          → solo (new shell)
//   /online                    → multiplayer (new shell)
//   /solo                      → legacy URL, 301 to /
//   /overlay/<handle>          → OBS overlay (new shell)
//   /<handle> (non-reserved)   → streamer-private session (new shell, MP)
// Hostname `live.word5000.com` is detected client-side and switches mode=mp;
// it shares the same `/` handler so no extra server route is needed.
const NEXT_SHELL = path.join(__dirname, 'public', 'next', 'index.html');

app.get('/',       (req, res) => res.sendFile(NEXT_SHELL));
app.get('/online', (req, res) => res.sendFile(NEXT_SHELL));
app.get('/solo',   (req, res) => res.redirect(301, '/'));

// Word5000x5 is the crossing-word solo variant. Keep the slash so its relative
// assets and word-bank requests work on the domain and through game proxies.
app.get(/^\/(?:x5|word5000x5)$/, (_req, res) => res.redirect(302, 'x5/'));
app.get('/word5000x5/', (_req, res) => res.redirect(302, '../x5/'));

const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'play', 'online', 'solo', 'next',
  'auth', 'portal', 'login', 'x5', 'word5000x5',
  'index.html', 'mp.html', 'sp.html', 'play.html',
  'favicon.ico', 'robots.txt', 'manifest.json', 'sitemap.xml',
  'manifest.webmanifest', 'sw.js',
  'socket.io', 'apple-touch-icon.png', 'apple-touch-icon-v3.png',
  'style.css', 'game.js', 'audio-manager.js', 'theme-manager.js',
  'three-manager.js', 'three-effects.js', 'perf-monitor.js',
  'win-effects.js', 'enhanced-animations.js', 'coin-reward.js',
  'pwa-install.js', 'offline.html',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/')[2].toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  res.sendFile(NEXT_SHELL);
});
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  if (_isPagePlayDisabled(handle) && req.query.disabled !== '1') {
    const _self = req.query.streamer_self === '1' ? '&streamer_self=1' : '';
    return res.redirect(302, '/' + encodeURIComponent(handle) + '?disabled=1' + _self);
  }
  res.sendFile(NEXT_SHELL);
});

// Admin session endpoints
// Read the current secret word + board constraints for a handle's private
// session. Mirrors Searchle's GET /api/session/target contract (targetWord /
// isWon) so internal consumers (chat-relay bot-players, streamer dashboard)
// can treat both games alike; the extra fields (wordLength, letterStates,
// guessedWords) let a consumer make guesses that respect the visible board.
// Read-only: returns null targetWord when the session doesn't exist yet.
app.get('/api/session/target', requireAdmin, (req, res) => {
  const handle = String((req.query && req.query.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const s = sessionManager.getSession(handle);
  const g = s && s.gameState;
  if (!g) return res.json({ ok: true, handle, targetWord: null, isWon: false });
  res.json({
    ok: true,
    handle,
    targetWord: g.word || null,
    isWon: !!g.gameOver,
    wordLength: g.wordLength || 5,
    letterStates: g.letterStates || {},
    guessedWords: (g.guesses || []).map((x) => x.word),
  });
});
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

function validBrowserFrame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string' || !data.word || data.word.length > 96
      || !data.user || typeof data.user !== 'object' || Array.isArray(data.user)) return false;
  const user = data.user;
  return typeof user.id === 'string' && !!user.id && user.id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(user.id)
    && (user.platformUserId === undefined || typeof user.platformUserId === 'string' && user.platformUserId.length <= 128)
    && (user.username === undefined || typeof user.username === 'string' && user.username.length <= 80)
    && (user.displayName === undefined || typeof user.displayName === 'string' && user.displayName.length <= 80);
}
async function handleBrowserGuess(socket, data, handle = null) {
  if (!validBrowserFrame(data)) { socket.emit('guess-result', { ok: false, reason: 'invalid-frame' }); return; }
  const session = handle ? sessionManager.getSession(handle) : null, state = handle ? session?.gameState : gameState;
  try {
    if (!state || !(await passesPremiumWebGate(data.user, socket, handle ? 'session' : 'mp'))) { socket.emit('guess-result', { ok: false, reason: 'premium-required' }); return; }
    if (handle ? sessionManager.getSession(handle) !== session || session.gameState !== state : gameState !== state) { socket.emit('guess-result', { ok: false, reason: 'round-changed' }); return; }
    const recipient = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId;
    if (typeof recipient !== 'string' || !recipient) { socket.emit('guess-result', { ok: false, reason: 'auth-required' }); return; }
    if (handle && (_isPagePlayDisabled(handle) || _isStreamerBlocking(handle, 'web', recipient))) { socket.emit('guess-result', { ok: false, reason: 'room-unavailable' }); return; }
    gameShared.reportSocketIP(socket, 'web', recipient, 'word500');
    const result = await processOwnedGuess(session, data.user.username || recipient, data.user.displayName || data.user.username || 'Player', null,
      'web', data.word, recipient, null, socket);
    socket.emit('guess-result', result);
  } catch (_) { socket.emit('guess-result', { ok: false, reason: 'storage-unavailable' }); }
}

// --- Game display connections ---
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
      const session = await sessionManager.getOrCreateSession({ handle: sessionHandle, words, settings: { wordLength: await getSessionWordLength(sessionHandle) } });
      if (session) {
        socket.emit('game-state', sessionManager.buildSessionState(session, jackpotSettings, _calcSessionPot));
        if (session.gameState.gameOver) scheduleOwnedRound(session.gameState, session);
      } else {
        socket.emit('game-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    socket.on('play-guess', data => handleBrowserGuess(socket, data, sessionHandle));
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  connectedDisplays++;
  connectedPlayers++;
  socket.emit('game-state', getSocketPublicState());

  socket.on('play-guess', data => handleBrowserGuess(socket, data));
  socket.on('disconnect', () => {
    connectedDisplays--;
    connectedPlayers--;
  });
});

// --- Connect to Chat Relay ---
const chatRelay = gameShared.createRelayClient({
  id: 'word500',
  name: 'Word5000',
  port: PORT,
  apiSecret: ADMIN_SECRET,
  relayUrl: CHAT_RELAY_URL
}, {
  onFrenzyUpdate: (data) => {
  if (data && Number.isFinite(data.multiplier) && data.multiplier >= 1 && data.multiplier <= 100) {
    currentFrenzy = data;
    io.to('public').emit('frenzy-update', data);
  }
  },

  onActivateDaily: async () => {
    await fetchDailyWord();
    const previousSettings = jackpotSettings, previousDaily = dailyPlayed;
    try {
      dailyPlayed = false; jackpotSettings = { ...jackpotSettings, dailyEnabled: true };
      recovery.saveMetadata(gameState);
    } catch (_) { jackpotSettings = previousSettings; dailyPlayed = previousDaily; console.error('[Word500] Daily activation could not be saved'); return; }
    try { dailyRounds.reset(gameShared.getEdmontonDate()); } catch (_) { console.error('[Word500] Daily activation mirror requires recovery'); }
    if (gameState.gameOver || !gameState.word) try { startNewGame(); } catch (_) { if (gameState.gameOver) scheduleOwnedRound(gameState, null, true); }
  },

  onCosmeticsUpdated: ({ platform, platformUserId, equipped }) => {
  gameShared.invalidateCosmetics(platform, platformUserId, equipped);
  let changed = false;
  for (const g of gameState.guesses) {
    if (g.platform === platform && g.platformUserId === platformUserId) {
      g.cosmetics = equipped;
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
    io.to('public').emit('game-state', getSocketPublicState());
  }
  // Sessions: update any cached cosmetics on session guesses/winners and
  // re-broadcast that session's state if anything changed.
  for (const s of sessionManager.listSessions()) {
    const sess = sessionManager.getSession(s.handle);
    if (!sess || !sess.gameState) continue;
    let sChanged = false;
    for (const g of sess.gameState.guesses || []) {
      if (g.platform === platform && g.platformUserId === platformUserId) {
        g.cosmetics = equipped;
        sChanged = true;
      }
    }
    if (sess.gameState.winner && sess.gameState.winner.platform === platform && sess.gameState.winner.platformUserId === platformUserId) {
      sess.gameState.winner.cosmetics = equipped;
      sChanged = true;
    }
    if (sChanged) {
      io.to(_sessionRoom(s.handle)).emit('game-state', sessionManager.buildSessionState(sess, jackpotSettings, _calcSessionPot));
    }
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
  if (!text) return;

  let raw;
  if (requireSlashPrefix) {
    if (!text.startsWith('/') && !text.startsWith('.')) return;
    raw = text.slice(1);
  } else {
    raw = text;
  }

  const guess = raw.replace(/[^a-zA-Z]/g, '');
  if (!guess) return;

  const _fc = Array.isArray(user.badges) && user.badges.indexOf('fan-club') !== -1;
  const _sf = Array.isArray(user.badges) && user.badges.indexOf('superfan') !== -1;
  processGuess(
    user.username,
    user.customNick || user.displayName || user.username,
    user.profilePic,
    platform || 'unknown',
    guess,
    user.id,
    data.linkedDiscord || null,
    null,
    _fc,
    _sf
  ).catch(() => console.error('[Word500] Guess not accepted'));
  }
});

// --- Start ---
async function start() {
  // Load played words from disk
  loadPlayedWords();

  // Initialize word data from word bank
  await words.init();

  // Fetch daily word (non-fatal if Chat Relay not ready yet)
  await fetchDailyWord();
  setInterval(fetchDailyWord, 3600000); // refresh hourly

  initializeRecovery();
  const saved = recovery.restorePublic();
  if (saved) { gameState = saved.state; gameStartTime = gameState.potStartedAt; if (gameState.isDaily && gameState.dailyDate === gameShared.getEdmontonDate()) try { dailyRounds.consume(gameState.dailyDate); } catch (_) { console.error('[Word500] Daily consumption mirror requires recovery'); } if (gameState.gameOver) scheduleOwnedRound(gameState); }
  else startNewGame();
  for (const summary of sessionManager.listSessions()) { const session = sessionManager.getSession(summary.handle); if (session.gameState.gameOver) scheduleOwnedRound(session.gameState, session); }

  // Start HTTP server
  server.listen(PORT, () => {
    console.log(`Word5000 running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('[Word500] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Word500] Shutting down...');
  if (newGameTimeout) clearTimeout(newGameTimeout);
  recovery?.stop();
  for (const summary of sessionManager.listSessions()) { const session = sessionManager.getSession(summary.handle); if (session.autoRestartTimer) clearTimeout(session.autoRestartTimer); }
  chatRelay.disconnect();
  server.close();
  console.log('[Word500] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
