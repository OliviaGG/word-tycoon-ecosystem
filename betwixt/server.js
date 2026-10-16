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

const PORT = process.env.PORT || 3017;
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
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'game-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const HISTORY_BACKUP_PATH = path.join(DATA_DIR, 'history-backup.json');
const PLAYED_WORDS_PATH = path.join(DATA_DIR, 'played-words.json');

// Load word lists by length (local fallback, overwritten by word bank on startup)
let wordsByLength = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'words-by-length.json'), 'utf-8'));
let targetsByLength = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'targets-by-length.json'), 'utf-8'));

// Build lookup sets per length
let wordSets = {};
function rebuildWordSets() {
  wordSets = {};
  for (const len in wordsByLength) {
    wordSets[len] = new Set(wordsByLength[len]);
  }
}
rebuildWordSets();

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

// Try to load from shared word bank (Chat Relay)
async function loadFromWordBank() {
  try {
    const [targetsRes, dictRes] = await Promise.all([
      fetch(`${CHAT_RELAY_URL}/api/word-bank/targets`),
      // Dictionary is large, fetch per-length that we need
      fetch(`${CHAT_RELAY_URL}/api/word-bank/stats`)
    ]);

    if (!targetsRes.ok || !dictRes.ok) {
      throw new Error(`HTTP ${targetsRes.status}/${dictRes.status}`);
    }

    const newTargets = await targetsRes.json();
    const stats = await dictRes.json();

    // Fetch dictionary for each available length
    const newDict = {};
    for (const len of (stats.lengths || [])) {
      try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/dictionary/${len}`);
        if (res.ok) {
          newDict[String(len)] = await res.json();
        }
      } catch (e) {
        console.warn(`[Betwixt] Failed to fetch dictionary for length ${len}`);
      }
    }

    // Only replace if we got valid data
    if (Object.keys(newTargets).length > 0) {
      targetsByLength = newTargets;
      console.log(`[Betwixt] Loaded ${stats.totalTargets || '?'} targets from word bank`);
    }
    if (Object.keys(newDict).length > 0) {
      wordsByLength = newDict;
      rebuildWordSets();
      console.log(`[Betwixt] Loaded ${stats.totalDictionary || '?'} dictionary words from word bank`);
    }
  } catch (err) {
    console.log(`[Betwixt] Word bank unavailable (${err.message}), using local word files`);
  }
}

const app = express();
const BLOCKED_PUBLIC_PATH_RE = /(^|\/)(?:\.[^/]+|[^/]+(?:\.bak(?:[-._][^/]*)?|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i;
function blockSensitivePublicPaths(req, res, next) {
  const requestPath = req.path || '/';
  if (/^\/\.well-known(?:\/|$)/i.test(requestPath)) return next();
  if (BLOCKED_PUBLIC_PATH_RE.test(requestPath)) return res.status(404).send('Not found');
  next();
}

app.use(blockSensitivePublicPaths);
app.use(express.json());

// Play page route (before static middleware so /play works without .html)
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

// ─── Streamer whitelist + redirect targets (declared above any closure) ──
const sessionManager = require('./src/session-manager');
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
function _sessionRoom(handle) { return `betwixt:session:${String(handle || '').toLowerCase()}`; }

// Session URL routes (BEFORE static so they take precedence)
const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'overlay.html',
  'index.html', 'mp.html', 'sp.html', 'play', 'play.html',
  'favicon.ico', 'robots.txt', 'manifest.webmanifest', 'sw.js',
  'public', 'js', 'css', 'socket.io',
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

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

// Crash-safe file write (write-to-temp-then-rename)
function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// Report a finished round's participants to Word Tycoon for ELO / rounds-played.
//
// `state` defaults to the public round, but private streamer sessions pass their
// own session state so stream rounds count toward /goat exactly like public ones
// (2026-07-21). Bots and guests are filtered out - they play in sessions but must
// never earn a rating.
async function reportRoundToWordTycoon(state = game) {
  try {
    if (!state || !state.guesses || state.guesses.length === 0) return;

    const seen = new Map();
    for (const g of state.guesses) {
      if (!g.user) continue;
      const u = g.user;
      const key = u.linkedDiscord ? `discord:${u.linkedDiscord}` : `${u.platform || 'web'}:${u.platformUserId || u.id || 'unknown'}`;
      if (!gameShared.isStatsEligible(key)) continue;
      if (!seen.has(key)) {
        seen.set(key, { user: u, guesses: 0, hits: 0 });
      }
      const entry = seen.get(key);
      entry.guesses++;
      if (g.isCorrect) entry.hits = 1;
    }

    const winnerKey = state.winner ? (
      state.winner.linkedDiscord ? `discord:${state.winner.linkedDiscord}` : `${state.winner.platform || 'web'}:${state.winner.platformUserId || state.winner.id || 'unknown'}`
    ) : null;

    const participants = [];
    const rankOutOf = seen.size;
    for (const [key, entry] of seen) {
      const isWinner = key === winnerKey;
      participants.push({
        identity: key,
        points: isWinner ? 100 : 0,
        rank: isWinner ? 1 : 2,
        rankOutOf,
        wonRound: isWinner,
        foundTarget: isWinner,
        guesses: entry.guesses,
        hits: entry.hits,
        firstHitMs: null,
        articleTitle: state.secret || '?'
      });
    }

    if (participants.length < 2) return;

    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'betwixt', participants })
    });
    if (!res.ok) {
      console.error(`[Betwixt] ELO report failed/error: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[Betwixt] ELO report failed/error: ${err.message}`);
  }
}

// ---------- Settings ----------

const AUTO_RESTART_DELAY = 10000; // ms before auto-starting a new game after a win

let settings = {
  wordLength: 5,
  randomWordLength: false,
  useFullDictionary: false
};

let autoRestartTimer = null;
let relaySocket = null;

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

function calculateJackpot() {
  if (!game) return 0;
  const completed = game.isWon ? mpActions.recordFor(game)?.completion : null;
  if (completed) return completed.rawAmount;
  if (!jackpotSettings.enabled) return 0;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(game.startTime).getTime()) / 1000));
  const raw = jackpotSettings.base + game.guesses.length * jackpotSettings.perGuess + elapsed * jackpotSettings.perSecond;
  return jackpotSettings.max > 0 ? Math.min(raw, jackpotSettings.max) : raw;
}
function publicPot() {
  const completed = game?.isWon ? mpActions.recordFor(game)?.completion : null;
  return completed ? completed.amount : Math.floor(calculateJackpot() * (currentFrenzy.multiplier || 1));
}

function startJackpotBroadcast() {
  stopJackpotBroadcast();
  jackpotBroadcastTimer = setInterval(() => {
    if (game && !game.isWon) {
      io.to('public').emit('jackpot-update', { jackpot: publicPot() });
    }
    for (const info of sessionManager.listSessions()) {
      const room = _sessionRoom(info.handle), session = sessionManager.getSession(info.handle);
      if (session?.game && !session.game.isWon && io.sockets?.adapter?.rooms?.has(room)) io.to(room).emit('jackpot-update', { jackpot: _calcSessionPot(session) });
    }
  }, 1000);
  jackpotBroadcastTimer.unref?.();
}

function stopJackpotBroadcast() {
  if (jackpotBroadcastTimer) {
    clearInterval(jackpotBroadcastTimer);
    jackpotBroadcastTimer = null;
  }
}

// ---------- Game State ----------

let game = null;
let history = loadHistory();
let playedWords = loadPlayedWords();
let relayConnected = false;
let displayCount = 0;
let connectedPlayers = 0;

// --- Daily Word ---
let dailyWord = null;    // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(__dirname, 'data', 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate()); // true once the daily round has started today
const mpActions = require(path.join(RELAY_DIR, 'src', 'plain-game-actions')).createPlainGameActions({
  directory: path.join(__dirname, 'data', 'mp-actions'), gameId: 'betwixt', sdk: gameShared,
  onError: error => console.error('[MPRecovery] ' + error.message)
});
function mpMetadata(state, session = null) {
  const prior = mpActions.recordFor(state)?.meta;
  return { complete: !!state.isWon, startTime: session?.gameStartTime ?? state.startTime,
    ...(state.isDaily ? { period: prior?.period || state.dailyDate || gameShared.getEdmontonDate() } : {}),
    ...(session ? { handle: session.handle, noRewards: !!session.noRewards } : { dailyPlayed, jackpotSettings, settings, history, playedWords }) };
}
function commitGuess(state, session = null, amount = null, rawAmount = null) {
  const meta = mpMetadata(state, session), intentions = []; let completion;
  if (state.isWon) {
    const winner = state.winner, event = state.isDaily ? 'mp-daily-win' : 'win';
    completion = { amount, rawAmount, winner, event, ...(meta.period ? { period: meta.period } : {}) };
    const intention = !session?.noRewards ? mpActions.reward('win', winner.platform, winner.platformUserId || winner.id,
      winner.username || winner.displayName, winner.displayName, amount, event,
      { guessCount: state.guesses.length, word: state.secret, ...(meta.period ? { rewardPeriod: meta.period } : {}) }) : null;
    if (intention) intentions.push(intention);
  }
  try { return mpActions.accept(state, meta, intentions, completion); }
  catch (error) { console.error('[MPRecovery] ' + error.message); return null; }
}
sessionManager.setDurabilityHooks({
  restore(session) {
    const saved = mpActions.load('session:' + session.handle); if (!saved) return null;
    if (saved.record.meta.ended) return { game: null, gameStartTime: 0, isComplete: false };
    return { game: saved.state, gameStartTime: saved.record.meta.startTime, isComplete: !!saved.state.isWon, noRewards: !!saved.record.meta.noRewards };
  },
  saveNew: session => mpActions.save(session.game, 'session:' + session.handle, mpMetadata(session.game, session)),
  end(session) { const record = mpActions.journal.current('session:' + session.handle); if (record) mpActions.journal.commit(record.scope, record.roundId, record.state, { ...record.meta, ended: true }); }
});
function browserUser(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string' || !data.word || data.word.length > 64) return null;
  for (const [field, limit] of [['displayName',80],['platformUserId',128],['linkedDiscord',128],['profilePic',2048]]) {
    if (data[field] != null && (typeof data[field] !== 'string' || data[field].length > limit)) return null;
  }
  return { displayName: data.displayName || 'Player', username: data.displayName || 'Player',
    platform: 'web', platformUserId: data.platformUserId || null, linkedDiscord: data.linkedDiscord || null, profilePic: data.profilePic || null };
}


async function fetchDailyWord(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const len = settings.wordLength || 5;
      const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/betwixt?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data = await res.json();
      // Check if it's a new day -> reset dailyPlayed
      if (dailyWord && dailyWord.date !== data.date) {
        dailyPlayed = dailyRounds.has(data.date);
        console.log(`[Betwixt] New daily word available for ${data.date}`);
      }
      dailyWord = data;
      return;
    } catch (e) {
      console.warn(`[Betwixt] Daily word fetch failed (attempt ${attempt}/${retries}):`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// --- Frenzy ---
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
      // Primary empty/corrupt — try backup
      if (fs.existsSync(HISTORY_BACKUP_PATH)) {
        console.warn('[Betwixt] Primary history empty, restoring from backup');
        const backup = JSON.parse(fs.readFileSync(HISTORY_BACKUP_PATH, 'utf-8'));
        if (Array.isArray(backup) && backup.length > 0) {
          fs.writeFileSync(HISTORY_PATH, JSON.stringify(backup, null, 2));
          return backup;
        }
      }
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    // Primary failed — try backup
    try {
      if (fs.existsSync(HISTORY_BACKUP_PATH)) {
        console.warn('[Betwixt] Primary history corrupt, restoring from backup');
        const backup = JSON.parse(fs.readFileSync(HISTORY_BACKUP_PATH, 'utf-8'));
        if (Array.isArray(backup)) {
          fs.writeFileSync(HISTORY_PATH, JSON.stringify(backup, null, 2));
          return backup;
        }
      }
    } catch (backupErr) {
      console.error('[Betwixt] Backup also failed:', backupErr.message);
    }
    console.log('[Betwixt] Could not load history:', e.message);
  }
  return [];
}

function saveHistory() {
  try {
    atomicWriteSync(HISTORY_PATH, history);
    atomicWriteSync(HISTORY_BACKUP_PATH, history);
  } catch (e) {
    console.log('[Betwixt] Could not save history:', e.message);
  }
}

function loadPlayedWords() {
  try {
    if (fs.existsSync(PLAYED_WORDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(PLAYED_WORDS_PATH, 'utf-8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) {
    console.log('[Betwixt] Could not load played words:', e.message);
  }
  return {};
}

function savePlayedWords() {
  try {
    atomicWriteSync(PLAYED_WORDS_PATH, playedWords);
  } catch (e) {
    console.log('[Betwixt] Could not save played words:', e.message);
  }
}

function getPlayedWordsStats() {
  const stats = {};
  for (const len in targetsByLength) {
    const totalTargets = targetsByLength[len].length;
    const totalDict = (wordsByLength[len] || []).length;
    const played = (playedWords[len] || []).length;
    const pool = settings.useFullDictionary ? totalDict : totalTargets;
    stats[len] = { played, pool, remaining: Math.max(0, pool - played) };
  }
  return stats;
}

function countUserWins(hist, userId, linkedDiscord) {
  let count = 0;
  for (const w of hist) {
    const wId = w.winner ? (w.winner.platformUserId || w.winner.id) : null;
    const wLd = w.winner ? (w.winner.linkedDiscord || null) : null;
    if (wId === userId) { count++; continue; }
    if (linkedDiscord && wLd && wLd === linkedDiscord) { count++; continue; }
    if (linkedDiscord && wId === linkedDiscord) { count++; continue; }
    if (wLd && wLd === userId) { count++; continue; }
  }
  return count;
}

function saveGameState() {
  if (game) mpActions.save(game, 'public', mpMetadata(game));
  try {
    atomicWriteSync(STATE_PATH, { game, settings });
  } catch (e) {
    console.log('[Betwixt] Could not save state:', e.message);
  }
}

function loadGameState() {
  const saved = mpActions.load('public');
  if (saved) {
    game = saved.state;
    settings = saved.record.meta.settings || settings;
    jackpotSettings = saved.record.meta.jackpotSettings || jackpotSettings;
    history = saved.record.meta.history || history;
    playedWords = saved.record.meta.playedWords || playedWords;
    if (game.isDaily && saved.record.meta.period === gameShared.getEdmontonDate()) dailyRounds.consume(saved.record.meta.period);
    dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate());
    saveHistory(); savePlayedWords(); mpActions.recover();
    return true;
  }
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      if (data.settings) settings = { ...settings, ...data.settings };
      if (data.game && !data.game.isWon) {
        game = data.game;
        dailyPlayed = dailyRounds.migrateLegacy({ played: !!game.isDaily, date: game.dailyDate, startedAt: game.hintStartTime || game.startTime });
        if (!game.hintStartTime) game.hintStartTime = game.startTime;
        mpActions.save(game, 'public', mpMetadata(game));
        if (!game.confirmedLetters) game.confirmedLetters = new Array(game.wordLength).fill(null);
        updateConfirmedLetters();
        console.log(`[Betwixt] Resumed game (${game.secret.length} letters) | Bounds: ${game.currentLower} - ${game.currentUpper} | ${game.guesses.length} guesses`);
        refreshCosmeticsForGuesses().catch(error => console.error('[Cosmetics] ' + error.message));
        return true;
      }
    }
  } catch (e) {
    console.log('[Betwixt] Could not load state:', e.message);
    if (game) throw e;
  }
  return false;
}

async function refreshCosmeticsForGuesses() {
  if (!game || !game.guesses || game.guesses.length === 0) return;
  const capturedGame = game;
  const players = new Map();
  for (const g of game.guesses) {
    if (!g.user) continue;
    const uid = g.user.id || g.user.username || g.user.displayName;
    if (!uid) continue;
    const key = `${g.user.platform || 'chat'}:${uid}`;
    if (!players.has(key)) players.set(key, { platform: g.user.platform || 'chat', userId: uid });
  }
  const results = new Map();
  for (const [key, p] of players) {
    results.set(key, await gameShared.getPlayerCosmetics(p.platform, p.userId));
  }
  if (game !== capturedGame) return;
  let updated = 0;
  for (const g of game.guesses) {
    if (!g.user) continue;
    const uid = g.user.id || g.user.username || g.user.displayName;
    const key = `${g.user.platform || 'chat'}:${uid}`;
    const cos = results.get(key);
    if (cos && Object.keys(cos).length > 0) {
      g.user.cosmetics = cos;
      updated++;
    }
  }
  if (updated > 0) {
    console.log(`[Cosmetics] Updated ${updated} guesses with cosmetics`);
    saveGameState();
  }
}

function newGame(wordLength) {
  const previous = { game, dailyPlayed, settings: { ...settings }, playedWords: JSON.parse(JSON.stringify(playedWords)) };
  try {
  let len = wordLength || settings.wordLength;
  if (!Number.isInteger(len) || len < 2 || len > 13) return null;

  // Random word length mode: pick a random length from available targets
  if (settings.randomWordLength && !wordLength) {
    const availableLens = Object.keys(targetsByLength)
      .map(Number)
      .filter(l => {
        const pool = settings.useFullDictionary ? (wordsByLength[l] || []) : (targetsByLength[l] || []);
        return pool.length > 0;
      });
    if (availableLens.length > 0) {
      len = availableLens[Math.floor(Math.random() * availableLens.length)];
    }
  }

  settings.wordLength = len;

  let secret;
  let isDaily = false;

  // Use daily word for the first round of the day (Edmonton timezone — matches word bank)
  const today = gameShared.getEdmontonDate();
  if (!dailyPlayed && dailyWord && dailyWord.date === today && dailyWord.length === len && jackpotSettings.dailyEnabled) {
    secret = dailyWord.word;
    isDaily = true;
    dailyPlayed = true;
    console.log(`[Betwixt] DAILY round (${secret.length} letters)`);
  } else {
    // Choose target pool based on dictionary setting
    const pool = settings.useFullDictionary ? (wordsByLength[len] || []) : (targetsByLength[len] || []);
    if (pool.length === 0) {
      console.log(`[Betwixt] No target words for length ${len}`);
      settings = previous.settings; return null;
    }

    // Filter out already-played words
    const played = new Set(playedWords[len] || []);
    let available = pool.filter(w => !played.has(w));

    // If all words for this length have been played, reset
    if (available.length === 0) {
      console.log(`[Betwixt] All ${len}-letter targets played (${played.size})! Resetting pool.`);
      playedWords[len] = [];
      available = pool;
    }

    secret = available[Math.floor(Math.random() * available.length)];
  }

  // Track this word as played
  if (!playedWords[len]) playedWords[len] = [];
  playedWords[len].push(secret);

  // No real boundaries — full alphabet range. Any valid word is accepted.
  const lowerEdge = 'a'.repeat(len);
  const upperEdge = 'z'.repeat(len) + 'z';

  game = {
    secret,
    wordLength: len,
    originalLower: lowerEdge,
    originalUpper: upperEdge,
    currentLower: lowerEdge,
    currentUpper: upperEdge,
    displayLower: null,
    displayUpper: null,
    guesses: [],
    isWon: false,
    isDaily,
    dailyDate: isDaily ? dailyWord.date : null,
    winner: null,
    lowerBoundaryUser: null,
    upperBoundaryUser: null,
    confirmedLetters: new Array(len).fill(null),
    startTime: new Date().toISOString()
  };

  game.hintStartTime = game.startTime;
  saveGameState();
  if (game.isDaily) dailyRounds.consume(game.dailyDate);
  savePlayedWords();
  console.log(`[Betwixt] New game started (${len} letters)${isDaily ? ' [DAILY]' : ''}`);
  startJackpotBroadcast();
  return getPublicState();
  } catch (error) {
    let committed = false; try { committed = !!mpActions.recordFor(game); } catch {}
    if (!committed) { game = previous.game; dailyPlayed = previous.dailyPlayed; settings = previous.settings; playedWords = previous.playedWords; }
    throw error;
  }
}

// Closeness calculation (same algorithm as SP engine)
function wordToScore(word, len) {
  let score = 0;
  for (let i = 0; i < len; i++) {
    const ch = (word.charCodeAt(i) || 97) - 97;
    score += ch / Math.pow(26, i + 1);
  }
  return score;
}

function closeness(boundaryWord, secret, len) {
  const bScore = wordToScore(boundaryWord.toLowerCase(), len);
  const sScore = wordToScore(secret.toLowerCase(), len);
  const distance = Math.abs(bScore - sScore);
  const scaled = distance * 100;
  const rounded = Math.round(scaled * 10) / 10;
  return Math.max(0.1, rounded);
}

function getPublicState() {
  if (!game) return null;
  const mask = 'x'.repeat(game.wordLength);
  return {
    wordLength: game.wordLength,
    currentLower: game.displayLower || mask,
    currentUpper: game.displayUpper || mask,
    guesses: game.guesses,
    isWon: game.isWon,
    winner: game.winner,
    guessCount: game.guesses.length,
    lowerBoundaryUser: game.lowerBoundaryUser,
    upperBoundaryUser: game.upperBoundaryUser,
    confirmedLetters: game.confirmedLetters || [],
    startTime: game.startTime,
    hintStartTime: game.hintStartTime || game.startTime,
    jackpot: publicPot(),
    jackpotAwarded: game.jackpotAwarded,
    winHistory: history.slice(0, 10),
    isDaily: game.isDaily || false,
    frenzy: currentFrenzy,
    playerCount: connectedPlayers,
    lowerCloseness: game.displayLower ? closeness(game.displayLower, game.secret, game.wordLength) : null,
    upperCloseness: game.displayUpper ? closeness(game.displayUpper, game.secret, game.wordLength) : null,
  };
}

function getAdminState() {
  if (!game) return null;
  return {
    ...getPublicState(),
    secret: game.secret,
    realLower: game.currentLower,
    realUpper: game.currentUpper
  };
}

function updateConfirmedLetters() {
  if (!game || !game.confirmedLetters) return;
  // Need both boundaries to be real guessed words
  if (!game.displayLower || !game.displayUpper) return;
  const secret = game.secret;
  const lower = game.currentLower;
  const upper = game.currentUpper;
  if (lower.length !== game.wordLength || upper.length !== game.wordLength) return;

  for (let i = 0; i < game.wordLength; i++) {
    if (game.confirmedLetters[i]) continue; // already confirmed, persists
    if (lower[i] === upper[i] && lower[i] === secret[i]) {
      game.confirmedLetters[i] = secret[i].toUpperCase();
    }
  }
}

function processGuess(word, user, socket) {
  if (!game || game.isWon) return { error: 'No active game' };

  if (typeof word !== 'string' || word.length > 64) return { error: 'Invalid guess' };
  if (game.isDaily && (mpActions.recordFor(game)?.meta.period || game.dailyDate) !== gameShared.getEdmontonDate()) {
    const state = newGame(); if (state) io.to('public').emit('new-game', state);
    return { error: 'The daily round changed. Please try again.' };
  }
  word = word.toLowerCase().trim();
  const len = game.wordLength;

  if (word.length !== len) return { error: `Word must be ${len} letters` };
  if (!/^[a-z]+$/.test(word)) return { error: 'Only letters allowed' };

  const wordSet = wordSets[len];
  if (!wordSet || !wordSet.has(word)) return { error: 'Not a valid word' };

  if (word <= game.currentLower || word >= game.currentUpper) {
    const mask = 'X'.repeat(len);
    const showLower = game.displayLower ? game.displayLower.toUpperCase() : mask;
    const showUpper = game.displayUpper ? game.displayUpper.toUpperCase() : mask;
    return { error: `Word must be between "${showLower}" and "${showUpper}"` };
  }

  if (game.guesses.some(g => g.word === word)) {
    return { error: 'Already guessed' };
  }

  try { if (!mpActions.recordFor(game)) mpActions.save(game, 'public', mpMetadata(game)); }
  catch { return { error: 'Progress storage unavailable; please retry' }; }
  const previousHistory = [...history];
  const isCorrect = word === game.secret;
  let direction = null;

  if (!isCorrect) {
    if (word < game.secret) {
      direction = 'before';
      if (word > game.currentLower) {
        game.currentLower = word;
        game.displayLower = word;
        game.lowerBoundaryUser = user;
      }
    } else {
      direction = 'after';
      if (word < game.currentUpper) {
        game.currentUpper = word;
        game.displayUpper = word;
        game.upperBoundaryUser = user;
      }
    }
    updateConfirmedLetters();
  }

  const guess = {
    word,
    direction,
    isCorrect,
    user: user || { displayName: 'Player', platform: 'web' },
    timestamp: new Date().toISOString()
  };

  game.guesses.push(guess);


  if (isCorrect) {
    const baseJackpot = calculateJackpot();
    game.isWon = true;
    game.winner = guess.user;
    const jackpotAmount = Math.floor(baseJackpot * (currentFrenzy.multiplier || 1.0));
    game.jackpotAwarded = jackpotAmount;

    history.unshift({
      word: game.secret,
      wordLength: game.wordLength,
      winner: {
        displayName: game.winner.displayName,
        platform: game.winner.platform,
        platformUserId: game.winner.platformUserId || game.winner.id,
        profilePic: game.winner.profilePic,
        linkedDiscord: game.winner.linkedDiscord || null,
      },
      guessCount: game.guesses.length,
      jackpot: jackpotAmount,
      isDaily: game.isDaily || false,
      timestamp: new Date().toISOString()
    });
    if (!commitGuess(game, null, jackpotAmount, baseJackpot)) { history = previousHistory; return { error: 'Progress storage unavailable; please retry' }; }
    saveHistory();

    const frenzyNote = currentFrenzy.multiplier > 1 ? ` (FRENZY ${currentFrenzy.multiplier}x)` : '';
    console.log(`[Betwixt] ${game.winner.displayName} won in ${game.guesses.length} guesses! Jackpot: ${jackpotAmount}${frenzyNote}${game.isDaily ? ' [DAILY]' : ''}`);

    // Pay out jackpot via Word Tycoon
    if (jackpotSettings.enabled) {
      const w = guess.user;
      const rewardEvent = game.isDaily ? 'mp-daily-win' : 'win';
      mpActions.sendLegacyReward(game,
        w.platform,
        w.platformUserId || w.id,
        w.username || w.displayName,
        w.displayName,
        jackpotAmount,
        rewardEvent,
        { guessCount: game.guesses.length, word: game.secret }
      );
    }
    reportRoundToWordTycoon().catch(e => console.log("[Betwixt] ELO report failed: " + e.message));
  } else if (!commitGuess(game)) return { error: 'Progress storage unavailable; please retry' };
  if (user && user.platformUserId) gameShared.reportLibraryWord(user.platform, user.platformUserId, word, 'betwixt', user.username, user.displayName, socket);
  // The authoritative state already committed; legacy JSON is a secondary mirror.
  try { atomicWriteSync(STATE_PATH, { game, settings }); } catch (error) { console.error('[LegacyState] ' + error.message); }
  return { guess, state: getPublicState() };
}

// ---------- Admin Auth ----------
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
    console.error('[Betwixt] whoami failed:', e.message);
  }
  return null;
}

// --- Hint helpers ---
function getHintRound(handle) {
  const state = handle === 'public' ? game : sessionManager.getSession(handle)?.game;
  if (!state) return null;
  return { state: { ...state, word: state.secret, gameOver: state.isWon }, startTime: state.hintStartTime || state.startTime };
}


// ---------- API Routes ----------

app.get('/api/state', requireAdmin, (req, res) => {
  if (!game) newGame();
  res.json(getAdminState());
});

app.get('/api/public-state', (req, res) => {
  if (!game) newGame();
  res.json(getPublicState());
});

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
  const before = { ...jackpotSettings };
  const b = req.body || {};
  if (typeof b.enabled === 'boolean') jackpotSettings.enabled = b.enabled;
  if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
  if (Number.isFinite(b.base) && b.base >= 0) jackpotSettings.base = Math.min(b.base, 50000);
  if (Number.isFinite(b.perGuess) && b.perGuess >= 0) jackpotSettings.perGuess = Math.min(b.perGuess, 500);
  if (Number.isFinite(b.perSecond) && b.perSecond >= 0) jackpotSettings.perSecond = Math.min(b.perSecond, 100);
  if (Number.isFinite(b.max) && b.max >= 0) jackpotSettings.max = Math.min(b.max, 10000000);
  try { saveGameState(); } catch { jackpotSettings = before; return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  console.log(`[Betwixt] Jackpot settings updated:`, jackpotSettings);
  res.json({ ok: true, ...jackpotSettings, current: calculateJackpot() });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
  if (!game || game.isWon) return res.status(409).json({ ok: false, error: 'No active game' });
  const before = game.startTime; game.startTime = new Date().toISOString();
  try { saveGameState(); } catch { game.startTime = before; return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  console.log('[Betwixt] Jackpot timer reset');
  res.json({ ok: true, current: calculateJackpot() });
});

app.get('/api/sp/daily', async (req, res) => {
  try {
    const len = parseInt(req.query.length) || 5;
    const r = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/betwixt-sp?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(404).json({ error: 'unavailable' });
    const data = await r.json();
    res.json({ word: data.word, date: data.date, length: data.length });
  } catch (e) { console.error('[Betwixt] Daily endpoint error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// --- Session proxy (forwards to Chat Relay so client can check Word Tycoon login) ---
app.get('/api/me/session', async (req, res) => {
  try {
    const upstream = await fetch(`${CHAT_RELAY_URL}/api/me/session`, {
      headers: { cookie: req.headers.cookie || '' }
    });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.json({ ok: false });
  }
});

app.post('/api/sp/daily/complete', (req, res) => {
    res.json({ ok: true });
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
    console.error('[Betwixt] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one target letter.
app.post('/api/hints/use', require('./src/paid-hints').createTransactionalHintHandler({
  resolveUser: resolveUserFromCookie, getRound: getHintRound, secret: process.env.HINT_ROUND_ID_SECRET,
  gameId: 'betwixt',
  candidateBuilder: require('./src/paid-hints').candidatesForBetwixt,
  async relay(endpoint, body) {
    const response = await fetch(`${CHAT_RELAY_URL}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Hint service unavailable');
    return response.json();
  },
}));

app.post('/api/new-game', requireAdmin, (req, res) => {
  const wordLength = req.body?.wordLength || null;
  const state = newGame(wordLength);
  if (!state) return res.status(400).json({ error: 'No words available for that length' });
  io.to('public').emit('new-game', state);
  res.json(getAdminState());
});

app.get('/api/reveal', requireAdmin, (req, res) => {
  if (!game) return res.json({ secret: null });
  res.json({ secret: game.secret });
});

app.post('/api/test-guess', requireAdmin, (req, res) => {
  const { word, displayName } = req.body || {};
  if (!word) return res.status(400).json({ error: 'Word required' });
  const user = { displayName: displayName || 'Admin', platform: 'admin' };
  const result = processGuess(word, user);
  if (result.error) return res.status(400).json(result);

  io.to('public').emit('new-guess', result.guess);
  io.to('public').emit('game-state', result.state);
  if (result.guess.isCorrect) {
    const userId = result.guess.user.platformUserId || result.guess.user.id;
    const ld = result.guess.user.linkedDiscord || null;
    io.to('public').emit('game-won', {
      word: result.guess.word,
      guessCount: result.state.guessCount,
      winner: result.guess.user,
      totalWins: userId ? countUserWins(history, userId, ld) : 0,
      jackpot: game.jackpotAwarded || 0,
      isDaily: game.isDaily || false,
    });
    scheduleAutoRestart();
  }
  res.json(result);
});

app.get('/api/settings', (req, res) => {
  const available = {};
  for (const len in targetsByLength) {
    if (targetsByLength[len].length > 0) {
      available[len] = { targets: targetsByLength[len].length, words: (wordsByLength[len] || []).length };
    }
  }
  res.json({ settings, available, playedWordsStats: getPlayedWordsStats() });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const before = { settings: { ...settings }, playedWords };
  const { wordLength, randomWordLength, useFullDictionary } = req.body || {};
  if (wordLength !== undefined && (!Number.isInteger(Number(wordLength)) || Number(wordLength) < 2 || Number(wordLength) > 13)) return res.status(400).json({ error: 'Invalid word length' });
  if (randomWordLength !== undefined && typeof randomWordLength !== 'boolean' || useFullDictionary !== undefined && typeof useFullDictionary !== 'boolean') return res.status(400).json({ error: 'Invalid setting' });
  if (wordLength !== undefined) settings.wordLength = parseInt(wordLength);
  if (randomWordLength !== undefined) settings.randomWordLength = !!randomWordLength;
  if (useFullDictionary !== undefined) {
    const changed = settings.useFullDictionary !== !!useFullDictionary;
    settings.useFullDictionary = !!useFullDictionary;
    // Reset played words tracking when switching dictionary mode
    if (changed) {
      playedWords = {};
      console.log(`[Betwixt] Dictionary mode changed to ${settings.useFullDictionary ? 'full' : 'curated'}, played words reset`);
    }
  }
  try { saveGameState(); } catch { settings = before.settings; playedWords = before.playedWords; return res.status(503).json({ error: 'Progress storage unavailable; please retry' }); }
  savePlayedWords();
  res.json({ settings, playedWordsStats: getPlayedWordsStats() });
});

app.post('/api/reset-played-words', requireAdmin, (req, res) => {
  const { wordLength: len } = req.body || {};
  if (len !== undefined && (!Number.isInteger(len) || len < 2 || len > 13)) return res.status(400).json({ error: 'Invalid word length' });
  const before = playedWords; playedWords = JSON.parse(JSON.stringify(playedWords));
  if (len) {
    playedWords[len] = [];
  } else {
    playedWords = {};
  }
  try { saveGameState(); } catch { playedWords = before; return res.status(503).json({ error: 'Progress storage unavailable; please retry' }); }
  savePlayedWords();
  console.log(`[Betwixt] Played words reset${len ? ` for length ${len}` : ' (all)'}`);
  res.json({ ok: true, playedWordsStats: getPlayedWordsStats() });
});

app.get('/api/history', (req, res) => {
  res.json(history);
});

// SP word list endpoint — client-side game fetches targets + dictionary per length
app.get('/api/sp/words/:length', (req, res) => {
  const len = req.params.length;
  const targets = targetsByLength[len] || [];
  const dictionary = wordsByLength[len] || [];
  if (targets.length === 0) {
    return res.status(404).json({ error: 'No words for length ' + len });
  }
  res.json({ targets, dictionary });
});

app.get('/api/stats', (req, res) => {
  const leaderboard = {};
  for (const h of history) {
    const ld = h.winner?.linkedDiscord || null;
    const uid = h.winner?.platformUserId || h.winner?.id || h.winner?.displayName || 'Unknown';
    // Group by linkedDiscord when available so cross-platform users merge
    const key = ld || uid;
    const name = h.winner?.displayName || 'Unknown';
    if (!leaderboard[key]) leaderboard[key] = { name, wins: 0, platform: h.winner?.platform };
    leaderboard[key].wins++;
  }
  const sorted = Object.values(leaderboard)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 20);

  res.json({
    gamesPlayed: history.length,
    leaderboard: sorted,
    recentGames: history.slice(0, 10)
  });
});

// ─── Session-mode helpers ────────────────────────────────────────────
function _calcSessionPot(s) {
  if (!s || !s.game) return 0;
  const completed = s.game.isWon ? mpActions.recordFor(s.game)?.completion : null;
  if (completed) return completed.amount;
  if (!jackpotSettings.enabled) return 0;
  const guessBonus = s.game.guesses.length * jackpotSettings.perGuess;
  const elapsed = Math.max(0, (Date.now() - s.gameStartTime) / 1000);
  const timeBonus = Math.floor(elapsed) * jackpotSettings.perSecond;
  const raw = jackpotSettings.base + guessBonus + timeBonus;
  return jackpotSettings.max > 0 ? Math.min(raw, jackpotSettings.max) : raw;
}

function _updateSessionConfirmedLetters(g) {
  if (!g || !g.confirmedLetters || !g.displayLower || !g.displayUpper) return;
  const lower = g.currentLower;
  const upper = g.currentUpper;
  if (lower.length !== g.wordLength || upper.length !== g.wordLength) return;
  for (let i = 0; i < g.wordLength; i++) {
    if (g.confirmedLetters[i]) continue;
    if (lower[i] === upper[i] && lower[i] === g.secret[i]) {
      g.confirmedLetters[i] = g.secret[i].toUpperCase();
    }
  }
}

async function _processSessionGuess(session, word, user, responseSocket) {
  if (!session || !session.game) return { error: 'No active session' };
  const g = session.game;
  if (g.isWon) return { error: 'No active game' };
  if (typeof word !== 'string' || word.length > 64) return { error: 'Invalid guess' };
  word = word.toLowerCase().trim();
  const len = g.wordLength;
  if (word.length !== len) return { error: `Word must be ${len} letters` };
  if (!/^[a-z]+$/.test(word)) return { error: 'Only letters allowed' };
  const wordSet = wordSets[len];
  if (!wordSet || !wordSet.has(word)) return { error: 'Not a valid word' };
  if (word <= g.currentLower || word >= g.currentUpper) {
    return { error: 'Word out of range' };
  }
  if (g.guesses.some(x => x.word === word)) return { error: 'Already guessed' };

  try { if (!mpActions.recordFor(g)) mpActions.save(g, 'session:' + session.handle, mpMetadata(g, session)); }
  catch { return { error: 'Progress storage unavailable; please retry' }; }
  const isCorrect = word === g.secret;
  let direction = null;
  if (!isCorrect) {
    if (word < g.secret) {
      direction = 'before';
      if (word > g.currentLower) {
        g.currentLower = word; g.displayLower = word; g.lowerBoundaryUser = user;
      }
    } else {
      direction = 'after';
      if (word < g.currentUpper) {
        g.currentUpper = word; g.displayUpper = word; g.upperBoundaryUser = user;
      }
    }
    _updateSessionConfirmedLetters(g);
  }
  const guess = {
    word, direction, isCorrect,
    user: user || { displayName: 'Player', platform: 'web' },
    timestamp: new Date().toISOString(),
  };
  g.guesses.push(guess);


  const room = _sessionRoom(session.handle);
  if (isCorrect) {
    const finalPot = Math.floor(_calcSessionPot(session));
    g.isWon = true; g.winner = user; g.jackpotAwarded = finalPot;
    if (!commitGuess(g, session, finalPot, finalPot)) return { error: 'Progress storage unavailable; please retry' };
    session.isComplete = true;
    if (!session.noRewards && user?.platformUserId) gameShared.reportLibraryWord(user.platform, user.platformUserId, word, 'betwixt', user.username, user.displayName);
    io.to(room).emit('new-guess', guess);
    io.to(room).emit('game-state', sessionManager.buildSessionState(session, _calcSessionPot, jackpotSettings.enabled));
    io.to(room).emit('game-won', {
      word: g.secret, guessCount: g.guesses.length, winner: user,
      totalWins: 0, jackpot: finalPot, isDaily: false,
    });
    const _winPayload = {
      game: 'betwixt', gameName: 'Betwixt',
      word: g.secret,
      winner: user,
      jackpot: finalPot,
      guessCount: g.guesses.length,
      totalWins: 0,
      isDaily: false,
      streamerHandle: session.handle,
    };
    io.to(room).emit('game-win', _winPayload);
    if (relaySocket && relaySocket.connected) {
      relaySocket.emit('game-win', _winPayload);
    }
    if (jackpotSettings.enabled && !session.noRewards) {
      mpActions.sendLegacyReward(g,
        user.platform, user.platformUserId || user.id,
        user.username || user.displayName, user.displayName,
        finalPot, 'win',
        { guessCount: g.guesses.length, word: g.secret },
      );
    }
    // Stream rounds count toward /goat ELO + rounds played, same as public.
    if (!session.noRewards) reportRoundToWordTycoon(g).catch(e => console.log('[Betwixt] session ELO report failed: ' + e.message));
    sessionManager.scheduleSave();
    session.autoRestartTimer = setTimeout(() => {
      // Re-resolve the length each round so a dashboard change (or 'random')
      // takes effect on the very next round without ending the session.
      (async () => {
      try {
        const nextLen = await getSessionWordLength(session.handle);
        if (sessionManager.restartSession(session, { wordLength: nextLen, targetsByLength, wordsByLength })) {
          io.to(room).emit('new-game', sessionManager.buildSessionState(session, _calcSessionPot, jackpotSettings.enabled));
          console.log(`[Session] "${session.handle}" auto-restarted (${session.game.wordLength} letters)`);
        }
      } catch (err) {
        console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
      }
      })();
    }, 10000);
  } else {
    if (!commitGuess(g, session)) return { error: 'Progress storage unavailable; please retry' };
    if (!session.noRewards && user?.platformUserId) gameShared.reportLibraryWord(user.platform, user.platformUserId, word, 'betwixt', user.username, user.displayName);
    sessionManager.scheduleSave();
    io.to(room).emit('new-guess', guess);
    io.to(room).emit('game-state', sessionManager.buildSessionState(session, _calcSessionPot, jackpotSettings.enabled));
  }
  if (responseSocket) {
    try { responseSocket.emit('guess-result', { ok: true, guess }); } catch (_) {}
  }
  return { ok: true, guess };
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  if (!_validStreamerHandles.has(handle)) return;
  const platform = String(msg.platform || 'unknown');
  const userObj = msg.user || {};
  const platformUserId = String(userObj.id || userObj.userId || '');
  if (platform && platformUserId && _isStreamerBlocking(handle, platform, platformUserId)) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({
      handle, sessionId: msg.streamSession || null,
      opts: { wordLength: await getSessionWordLength(handle), targetsByLength, wordsByLength },
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.game) return;

  const text = (msg.message || '').trim().toLowerCase();
  if (!text || text.includes(' ')) return;
  const cleaned = text.replace(/[^a-z]/g, '');
  if (!cleaned || cleaned.length !== session.game.wordLength) return;

  const user = {
    displayName: userObj.customNick || userObj.displayName || userObj.username || 'Player',
    username: userObj.username || 'player',
    platform,
    platformUserId,
    profilePic: userObj.profilePic || null,
    linkedDiscord: msg.linkedDiscord || null,
    isFanClub: Array.isArray(userObj.badges) && userObj.badges.indexOf('fan-club') !== -1,
  };
  await _processSessionGuess(session, cleaned, user, null);
}

// Admin session endpoints
app.post('/api/session/end', (req, res) => {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = sessionManager.endSession(handle);
  res.json({ ok: true, had });
});
app.post('/api/session/redirect', (req, res) => {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
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
app.post('/api/session/clear-redirect', (req, res) => {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

// ---------- Socket.IO (Display & Admin clients) ----------

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
      const session = await sessionManager.getOrCreateSession({
        handle: sessionHandle,
        opts: { wordLength: await getSessionWordLength(sessionHandle), targetsByLength, wordsByLength },
      });
      if (session) {
        socket.emit('game-state', sessionManager.buildSessionState(session, _calcSessionPot, jackpotSettings.enabled));
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
      const user = browserUser(data); if (!user) return;
      const word = data.word, capturedGame = session.game;
      // Premium gate (2026-07-31): page play in a streamer room is Donor-only
      // too. TikTok/Discord chat play-along is unaffected — those guesses come
      // through the relay chat client, never this socket.
      if (!(await passesPremiumWebGate([user.linkedDiscord, user.platformUserId], socket, 'session'))) return;
      if (sessionManager.getSession(sessionHandle) !== session || session.game !== capturedGame) return;
      user.platformUserId = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId; user.linkedDiscord = null;
      Object.assign(user, socket._wtPerks || {});
      gameShared.reportSocketIP(socket, 'web', user.platformUserId, 'betwixt');
      const result = await _processSessionGuess(session, word, user, socket);
      if (result?.error) socket.emit('guess-error', { error: result.error });
    });
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  displayCount++;
  connectedPlayers++;
  // Connection count tracked silently to reduce log noise
  broadcastStatus();

  // Admin auth via socket
  socket.on('admin-auth', (key) => {
    if (key === ADMIN_SECRET) socket.isAdmin = true;
  });

  if (!game) newGame();
  const pubState = getPublicState();
  pubState.winHistory = history.slice(0, 50);
  socket.emit('game-state', pubState);

  socket.on('guess', async (data) => {
    const user = browserUser(data); if (!user) return;
    const word = data.word, capturedGame = game;
    if (!(await passesPremiumWebGate([user.linkedDiscord, user.platformUserId], socket))) return;
    if (game !== capturedGame) return;
    user.platformUserId = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId; user.linkedDiscord = null;
    Object.assign(user, socket._wtPerks || {});
    gameShared.reportSocketIP(socket, 'web', user.platformUserId, 'betwixt');
    const result = processGuess(word, user, socket);

    if (result.error) {
      socket.emit('guess-error', { error: result.error });
    } else {
      socket.emit('guess-result', { ok: true, guess: result.guess });
      io.to('public').emit('new-guess', result.guess);
      io.to('public').emit('game-state', result.state);
      if (result.guess.isCorrect) {
        const userId = result.guess.user.platformUserId || result.guess.user.id;
        const ld = result.guess.user.linkedDiscord || null;
        io.to('public').emit('game-won', {
          word: result.guess.word,
          guessCount: result.state.guessCount,
          winner: result.guess.user,
          totalWins: userId ? countUserWins(history, userId, ld) : 0,
          jackpot: game.jackpotAwarded || 0,
          isDaily: game.isDaily || false,
        });
        if (relaySocket && relaySocket.connected) {
          relaySocket.emit('game-win', {
            game: 'betwixt', gameName: 'Betwixt',
            word: result.guess.word,
            winner: result.guess.user,
            jackpot: game.jackpotAwarded || 0,
            guessCount: result.state.guessCount,
            totalWins: userId ? countUserWins(history, userId, ld) : 0,
            isDaily: game.isDaily || false,
          });
        }
        scheduleAutoRestart();
      }
    }
  });

  socket.on('new-game', (data) => {
    if (!socket.isAdmin) return;
    try {
    if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
    const wordLength = data?.wordLength || settings.wordLength;
    const state = newGame(wordLength);
    if (state) io.to('public').emit('new-game', state);
    } catch { socket.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); }
  });

  socket.on('change-word-length', (data) => {
    if (!socket.isAdmin) return;
    const len = data?.wordLength;
    if (!Number.isInteger(len) || len < 2 || len > 13) return;
    try {
    if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
    const state = newGame(len);
    if (state) io.to('public').emit('new-game', state);
    } catch { socket.emit('guess-error', { error: 'Progress storage unavailable; please retry' }); }
  });

  socket.on('disconnect', () => {
    displayCount--;
    connectedPlayers--;
    // Disconnect count tracked silently to reduce log noise
    broadcastStatus();
  });
});

function broadcastStatus() {
  io.to('public').emit('status', { displays: displayCount, relayConnected });
}

function scheduleAutoRestart() {
  if (autoRestartTimer) clearTimeout(autoRestartTimer);
  autoRestartTimer = setTimeout(() => {
    autoRestartTimer = null;
    try {
      const state = newGame();
      if (state) {
        console.log('[Betwixt] Auto-restarting game');
        io.to('public').emit('new-game', state);
      }
    } catch { console.error('[MPRecovery] Auto-restart storage failed; prior round retained'); }
  }, AUTO_RESTART_DELAY);
}

// ---------- Chat Relay Connection ----------

function connectToChatRelay() {
  console.log(`[Betwixt] Connecting to Chat Relay at ${CHAT_RELAY_URL}...`);

  relaySocket = gameShared.createRelayClient({
    id: 'betwixt',
    name: 'Betwixt',
    port: PORT,
    apiSecret: ADMIN_SECRET,
    relayUrl: CHAT_RELAY_URL,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  }, {
    onConnect: () => {
      relayConnected = true;
      broadcastStatus();
    },
    onDisconnect: () => {
      relayConnected = false;
      broadcastStatus();
    },
    onConnectError: () => {
      relayConnected = false;
      broadcastStatus();
    },
    onChat: async (msg) => {
    if (!msg || !msg.message) return;
    // Streamer-private session: route to per-streamer state if tagged.
    if (msg.streamerHandle) {
      handleSessionChat(msg).catch(() => {});
      return;
    }
    if (!game || game.isWon) return;

    const word = msg.message.toLowerCase().trim().replace(/[^a-z]/g, '');
    const len = game.wordLength;

    if (word.length !== len || !/^[a-z]+$/.test(word)) return;

    const capturedGame = game;
    const userId = msg.user?.id || msg.user?.username || msg.user?.displayName;
    const playerCosmetics = await gameShared.getPlayerCosmetics(msg.platform || 'chat', userId);

    const user = {
      id: userId,
      displayName: msg.user?.displayName || msg.user?.username || 'Chatter',
      username: msg.user?.username || null,
      profilePic: msg.user?.profilePic || null,
      platform: msg.platform || 'chat',
      platformUserId: msg.platformUserId || userId,
      customColor: msg.user?.customColor || null,
      cosmetics: playerCosmetics,
      linkedDiscord: msg.linkedDiscord || null,
      isFanClub: Array.isArray(msg.user?.badges) && msg.user.badges.indexOf('fan-club') !== -1,
    };

    if (game !== capturedGame) return;
    const result = processGuess(word, user);

    if (!result.error && result.guess) {
      io.to('public').emit('new-guess', result.guess);
      io.to('public').emit('game-state', result.state);

      // Forward Sassie game events (gated per-event in the Sassie monitor)
      if (relaySocket && relaySocket.connected) {
        const sassieUser = {
          id: user.platformUserId || user.id,
          displayName: user.displayName,
          platform: user.platform,
          profilePic: user.profilePic,
        };
        const emitGameEvent = (eventName, extra, priority) => {
          relaySocket.emit('game-event', {
            game: 'betwixt',
            eventName,
            data: { user: sassieUser, guessCount: result.state.guessCount, ...(extra || {}) },
            priority: priority || 'normal',
          });
        };
        if (!game.seenPlayers) game.seenPlayers = new Set();
        const nickKey = (sassieUser.displayName || '').toLowerCase();
        if (nickKey && !game.seenPlayers.has(nickKey)) {
          game.seenPlayers.add(nickKey);
          emitGameEvent('first_time_player', {}, 'low');
        }
        if (!result.guess.isCorrect) {
          emitGameEvent('wrong_guess', { guess: word, direction: result.guess.direction }, 'low');
        }
      }

      if (result.guess.isCorrect) {
        const winUserId = user.platformUserId || user.id;
        const winLd = user.linkedDiscord || null;
        io.to('public').emit('game-won', {
          word: result.guess.word,
          guessCount: result.state.guessCount,
          winner: result.guess.user,
          totalWins: winUserId ? countUserWins(history, winUserId, winLd) : 0,
          jackpot: game.jackpotAwarded || 0,
          isDaily: game.isDaily || false,
        });
        if (relaySocket && relaySocket.connected) {
          relaySocket.emit('game-win', {
            game: 'betwixt', gameName: 'Betwixt',
            word: result.guess.word,
            winner: result.guess.user,
            jackpot: game.jackpotAwarded || 0,
            guessCount: result.state.guessCount,
            totalWins: winUserId ? countUserWins(history, winUserId, winLd) : 0,
            isDaily: game.isDaily || false,
          });
        }
        scheduleAutoRestart();
      }
    }
    },
    onFrenzyUpdate: (data) => {
    if (data && typeof data.multiplier === 'number') {
      currentFrenzy = data;
      io.to('public').emit('frenzy-update', data);
    }
    },
    onCosmeticsUpdated: ({ platform, platformUserId, equipped }) => {
    gameShared.invalidateCosmetics(platform, platformUserId, equipped);
    if (!game) return;
    let changed = false;

    // Update guesses array entries matching this player
    for (const g of game.guesses) {
      if (!g.user) continue;
      if (g.user.platform === platform && (g.user.platformUserId === platformUserId || g.user.id === platformUserId)) {
        g.user.cosmetics = equipped;
        changed = true;
      }
    }

    // Update winner if matching
    if (game.winner && game.winner.platform === platform && (game.winner.platformUserId === platformUserId || game.winner.id === platformUserId)) {
      game.winner.cosmetics = equipped;
      changed = true;
    }

    if (changed) {
      saveGameState();
      io.to('public').emit('game-state', getPublicState());
    }
    }
  });
}

// ---------- Start Server ----------

async function start() {
  const resumed = loadGameState();
  // Try to load words from shared word bank
  await loadFromWordBank();

  // Fetch daily word (non-fatal if Chat Relay not ready yet)
  await fetchDailyWord();
  setInterval(fetchDailyWord, 3600000); // refresh hourly

  // Try to resume saved game
  if (!resumed) {
    newGame();
  } else {
    if (game.isDaily && (mpActions.recordFor(game)?.meta.period || game.dailyDate) !== gameShared.getEdmontonDate()) newGame();
    else if (game.isWon) scheduleAutoRestart();
    startJackpotBroadcast();
  }

  server.listen(PORT, () => {
    console.log(`[Betwixt] Server running on http://localhost:${PORT}`);
    connectToChatRelay();
  });
}

start().catch(err => {
  console.error('[Betwixt] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Betwixt] Shutting down...');
  if (autoRestartTimer) clearTimeout(autoRestartTimer);
  stopJackpotBroadcast();
  saveGameState();
  saveHistory();
  console.log('[Betwixt] Game state saved');
  if (relaySocket) relaySocket.disconnect();
  server.close();
  console.log('[Betwixt] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
