// server.js - Express + Socket.IO + game hosting for eRecTangled

try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const path = require('path');

const db = require('./src/database');
const wordlist = require('./src/wordlist');
const sessionManager = require('./src/session-manager');
const boardPool = require('./src/board-pool');
const { Game } = require('./src/game');

const PORT = process.env.PORT || 3023;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';

// Whitelist of streamer handles allowed to spawn private sessions.
// Refreshed from chat-relay every 5 min so newly-whitelisted streamers
// get their /<handle> URL working without a restart. Empty set = deny
// all (fail-closed) on boot until first refresh succeeds.
let _validStreamerHandles = new Set();
// Which key this server reads out of the relay's per-streamer `gridSizes`
// map. Declared above _refreshStreamerHandles() because that runs
// immediately on require, and a const referenced from a function called
// before its declaration would hit the temporal dead zone.
const GRID_SIZE_KEY = 'erectangled';
// Per-streamer settings: { disablePlayerPage: bool, blockedSet: Set<"platform:id">,
// grid: { rows, cols } | null }
let _streamerSettings = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data && data.handles)) {
      _validStreamerHandles = new Set(data.handles.map(h => String(h).toLowerCase()));
    }
    if (Array.isArray(data && data.settings)) {
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
        // Board size for this streamer's private session. The relay sends it
        // already resolved to { preset, rows, cols } so the preset table
        // lives in one place; anything malformed falls back to the default
        // via _sessionSettingsFor below.
        const gs = s.gridSizes && s.gridSizes[GRID_SIZE_KEY];
        const grid = (gs && Number.isFinite(Number(gs.rows)) && Number.isFinite(Number(gs.cols)))
          ? { rows: Math.round(Number(gs.rows)), cols: Math.round(Number(gs.cols)) }
          : null;
        m.set(h, { disablePlayerPage: !!s.disablePlayerPage, blockedSet: bset, grid });
      }
      _streamerSettings = m;
    }
  } catch (_) { /* keep stale set on transient errors */ }
}
_refreshStreamerHandles();
setInterval(_refreshStreamerHandles, 5 * 60 * 1000).unref();
// Helpers used by URL routes + chat handlers.
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
// Settings handed to sessionManager when a board is generated. Clamped here
// rather than trusting the relay: a rows/cols outside these bounds either
// can't hold enough words to complete, or blows past the pool's build budget
// and stalls the public game while it retries.
const SESSION_MIN_ROWS = 4, SESSION_MAX_ROWS = 12;
const SESSION_MIN_COLS = 4, SESSION_MAX_COLS = 9;
function _sessionSettingsFor(handle) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  if (!s || !s.grid) return {};
  return {
    rows: Math.min(SESSION_MAX_ROWS, Math.max(SESSION_MIN_ROWS, s.grid.rows)),
    cols: Math.min(SESSION_MAX_COLS, Math.max(SESSION_MIN_COLS, s.grid.cols)),
  };
}

const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

const sassie = require('./sassie');
sassie.init();

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live', 'https://erectangled.com', 'https://www.erectangled.com'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const BLOCKED_PUBLIC_PATH_RE = /(^|\/)(?:\.[^/]+|[^/]+(?:\.bak(?:[-._][^/]*)?|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i;
function blockSensitivePublicPaths(req, res, next) {
  const requestPath = req.path || '/';
  if (/^\/\.well-known(?:\/|$)/i.test(requestPath)) return next();
  if (BLOCKED_PUBLIC_PATH_RE.test(requestPath)) return res.status(404).send('Not found');
  next();
}

app.use(blockSensitivePublicPaths);
app.use(express.json());
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

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
    console.error('[Erectangled] whoami failed:', e.message);
  }
  return null;
}

function getGameStateForHandle(handle) {
  const h = String(handle || '').toLowerCase().trim();
  if (h && h !== 'public') {
    const sess = sessionManager.getSession(h);
    if (sess && sess.game) return sess.game;
  }
  return game || null;
}

function generateHintForHandle(handle) {
  const g = getGameStateForHandle(handle);
  if (!g || !g.commonWords || g.commonWords.size === 0) return null;

  // Prefer revealing an unfound common word.
  const unfound = [...g.commonWords.keys()].filter(w => !g.foundCommon.has(w));
  if (unfound.length > 0) {
    const word = unfound[Math.floor(Math.random() * unfound.length)];
    return { word };
  }

  // All common words found: reveal a random letter/position from a common word.
  const words = [...g.commonWords.keys()];
  const word = words[Math.floor(Math.random() * words.length)];
  if (!word || word.length === 0) return null;
  const position = Math.floor(Math.random() * word.length);
  return { letter: word[position], position };
}

function getIdentityKey(platform, platformUserId, displayName) {
  if (!platformUserId) return null;
  if (platform === 'web' && /^\d{17,20}$/.test(String(platformUserId))) {
    return `discord:${platformUserId}`;
  }
  if (platform && platformUserId) return `${platform}:${platformUserId}`;
  return `nick:${String(displayName || '').toLowerCase()}`;
}

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public WEB multiplayer guessing requires Donor Class / TikTok Super Fan.
// The daily/weekly solo (/api/sp/*), streamer sessions (handleSessionChat),
// relay chat and the /stream chat-bridge (non-'web' platform) stay free.
// The check itself now lives in chat-relay's game-shared.js so every game
// gates identically (2026-07-31). It replaces a local snowflake-shape test
// that read any non-Discord id (gh_/google_/tt_) as logged-out and blocked it
// even when that account's subscription was linked to a Discord one.
async function passesPremiumWebGate(platformUserId, socket, context = 'mp') {
  return gameShared.passesPremiumWebGate(platformUserId, socket, context);
}

async function authorizeBrowserGuess(socket, data, context = 'mp') {
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        typeof data.word !== 'string' || !data.word.trim() || data.word.length > 64 ||
        (data.platformUserId != null && (typeof data.platformUserId !== 'string' || data.platformUserId.length > 128))) {
        socket.emit('guess-error', { error: 'Invalid guess' }); return null;
    }
    // A browser platform label is not a trusted chat transport. Real chat
    // reaches handleChat/handleSessionChat through the registered Relay client.
    if (!(await passesPremiumWebGate([data.platformUserId, data.linkedDiscord], socket, context))) return null;
    const identity = await gameShared.verifySocketIdentity(socket);
    if (!identity) { socket.emit('guess-error', { error: 'Verified account required' }); return null; }
    let profilePic = null;
    if (typeof data.profilePic === 'string' && data.profilePic.length <= 2048) {
        try { const url = new URL(data.profilePic); if (['https:', 'http:'].includes(url.protocol)) profilePic = url.href; } catch {}
    }
    return { word: data.word.trim(), platform: 'web', platformUserId: String(identity),
        displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 100) : 'Anonymous', profilePic };
}


async function reportRoundToWordTycoon(game) {
  if (!game) return;
  // Bots and guests play in private streamer sessions but must never earn a
  // rating - filter before ranking so rankOutOf reflects real players only.
  const topPlayers = (game.getTopPlayers ? game.getTopPlayers() : [])
    .filter(p => gameShared.isStatsEligible(p.platform, p.platformUserId));
  if (topPlayers.length < 2) return;

  // Compute hits and first-hit times from foundWords
  const hitsByPlayer = new Map();
  const firstHitByPlayer = new Map();
  if (game.foundWords) {
    for (const [word, data] of game.foundWords.entries()) {
      const key = getIdentityKey(data.platform, data.platformUserId, data.displayName);
      if (!key) continue;
      hitsByPlayer.set(key, (hitsByPlayer.get(key) || 0) + 1);
      const ts = new Date(data.timestamp).getTime();
      if (!firstHitByPlayer.has(key) || ts < firstHitByPlayer.get(key)) {
        firstHitByPlayer.set(key, ts);
      }
    }
  }

  const startTimeMs = game.startTime ? new Date(game.startTime).getTime() : Date.now();
  const participants = topPlayers.map((p, idx) => {
    const identityKey = getIdentityKey(p.platform, p.platformUserId, p.displayName);
    const firstHitMs = firstHitByPlayer.has(identityKey) ? (firstHitByPlayer.get(identityKey) - startTimeMs) : null;
    return {
      identityKey: identityKey || `nick:${String(p.displayName || '').toLowerCase()}`,
      points: p.score || 0,
      rank: idx + 1,
      rankOutOf: topPlayers.length,
      guesses: 0,
      hits: hitsByPlayer.get(identityKey) || 0,
      firstHitMs,
      wonRound: idx === 0,
      foundTarget: false,
      articleTitle: game.puzzleName || game.puzzleId || '?',
    };
  });

  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'erectangled', participants }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[Erectangled] ELO report failed: ${res.status} ${text}`);
    }
  } catch (e) {
    console.log(`[Erectangled] ELO report error: ${e.message}`);
  }
}

let game = null;
let sseClients = new Set();
let lastSpotifyState = null;
let relaySocket = null;
let newGameTimer = null;
let gameCompleted = false;
let lastMpGameSettings = { rows: 9, cols: 7, minWordLength: 3 };
let boardPresentationState = null;

// Jackpot configuration (configurable via /api/jackpot/settings)
let jackpotSettings = {
    enabled: true,
    dailyEnabled: false,
    base: 100,
    perGuess: 10,   // per word found
    perSecond: 3,
    max: 3000
};
let jackpotBroadcastTimer = null;
let gameStartTime = Date.now();

// Weekly puzzle state
let weeklyWord = null;
let weeklyPlayed = false;
let isWeekly = false;

// Daily puzzle state (MP mode)
let dailyWord = null;       // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(__dirname, 'data', 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate());    // has today's daily been played?
let isDaily = false;        // is current game the daily?

// SP daily/weekly caches (generated grids, shared across all SP users)
let spDailyCache = null;    // { date, grid, rows, cols, name, theme }
let spDailyGame  = null;    // Template Game instance for SP daily (DO NOT mutate — clone per session)
let spWeeklyCache = null;   // { weekStart, grid, rows, cols, name, theme, commonCount, rareCount, hiddenCount }
let spWeeklyGame  = null;   // Template Game instance for SP weekly (DO NOT mutate — clone per session)

// Per-session SP game instances — each user gets their own Game so guesses don't corrupt others.
// Key: `${mode}:${sid}` e.g. "daily:abc123", "weekly:abc123", "random:abc123", "archive:abc123"
const spSessionJournal = require('./src/sp-session-journal').createSpSessionJournal({ directory: path.join(__dirname, 'data', 'sp-sessions') });
const spSessionOwners = new WeakMap();
const spSessions = new Map();
const SP_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours of inactivity
const SP_MAX_SESSIONS = 500;

function pruneSpSessions(now = Date.now()) {
    for (const [key, entry] of spSessions) {
        if (now - entry.lastAccess >= SP_SESSION_TTL) spSessions.delete(key);
    }
    // Map order tracks access/set recency, including equal clock timestamps.
    while (spSessions.size > SP_MAX_SESSIONS) spSessions.delete(spSessions.keys().next().value);
}

function getSpSession(sid, mode) {
    if (!sid) return null;
    const key = `${mode}:${sid}`, entry = spSessions.get(key), now = Date.now();
    if (!entry) {
        const context = (mode === 'daily' || mode === 'weekly') ? spProofContext(mode) : null;
        if ((mode === 'daily' || mode === 'weekly') && !context) return null;
        const saved = spSessionJournal.get(sid, mode, context);
        if (!saved) return null;
        const restored = new Game();
        restored.restoreFrom(saved, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
        if (context) certifySpGame(restored, mode);
        spSessionOwners.set(restored, { sid, mode });
        spSessions.set(key, { game: restored, lastAccess: now }); pruneSpSessions();
        return restored;
    }
    if (now - entry.lastAccess >= SP_SESSION_TTL) { spSessions.delete(key); return null; }
    const context = (mode === 'daily' || mode === 'weekly') ? spProofContext(mode) : null;
    if (context && JSON.stringify(spVerifiedGames.get(entry.game)) !== JSON.stringify(context)) { spSessions.delete(key); return null; }
    spSessionJournal.touch(sid, mode);
    entry.lastAccess = now;
    spSessions.delete(key); spSessions.set(key, entry);
    return entry.game;
}

function setSpSession(sid, mode, game) {
    if (!sid) return;
    const key = `${mode}:${sid}`;
    if (typeof game.saveState === 'function') {
        const context = (mode === 'daily' || mode === 'weekly') ? spProofContext(mode) : null;
        spSessionJournal.save(sid, mode, game.saveState({ exact: true }), context);
        spSessionOwners.set(game, { sid, mode });
    }
    spSessions.delete(key); spSessions.set(key, { game, lastAccess: Date.now() });
    pruneSpSessions();
}

const spSessionSweep = setInterval(pruneSpSessions, 5 * 60 * 1000);
if (spSessionSweep.unref) spSessionSweep.unref();

// Save MP game state including daily/weekly flags that Game.saveState() doesn't track
const mpActions = require(path.join(RELAY_DIR, 'src', 'multiplayer-game-actions')).createMultiplayerGameActions({
    directory: path.join(__dirname, 'data', 'mp-actions'), gameId: 'erectangled', Game, wordlist, sdk: gameShared,
    onError: error => console.error('[MPRecovery] ' + error.message),
    resolveCompletion: (activeGame, meta) => {
        const rawAmount = meta.scope === 'public' ? calculateJackpot() : sessionManager.calculateSessionJackpot(meta.handle, jackpotSettings);
        const amount = Math.round(rawAmount * (meta.scope === 'public' ? currentFrenzy.multiplier : 1));
        return { amount, rawAmount, winner: jackpotSettings.enabled ? (activeGame.getTopPlayers()[0] || null) : null,
            event: meta.isDaily ? 'mp-daily-win' : meta.isWeekly ? 'mp-weekly-win' : 'win', ...(meta.period ? { period: meta.period } : {}) };
    }
});
function mpMetadata(activeGame, scope = 'public', handle = null) {
    const previous = mpActions.recordFor(activeGame)?.meta;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(activeGame.startTime));
    const daily = scope === 'public' && isDaily, weekly = scope === 'public' && isWeekly;
    let period = previous?.period;
    if ((daily || weekly) && !period) {
        if (daily) period = dailyWord?.date || date;
        else { const monday = new Date(date + 'T12:00:00Z'), day = monday.getUTCDay(); monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1)); period = weeklyWord?.weekStart || monday.toISOString().slice(0, 10); }
    }
    return { scope, handle, isDaily: daily, isWeekly: weekly, ...(daily || weekly ? { period } : {}), complete: !!activeGame.getState().isComplete,
        dailyPlayed, dailyPlayedDate: dailyRounds.lastDate(), dailyEnabled: jackpotSettings.dailyEnabled, startTime: activeGame.startTime };
}
function guessMpDurably(activeGame, ...args) {
    try {
        const record = mpActions.recordFor(activeGame), scope = record?.scope || 'public';
        return mpActions.guess(activeGame, scope, mpMetadata(activeGame, scope, record?.meta.handle), ...args);
    } catch (error) { console.error('[MPRecovery] ' + error.message); return { result: 'storage_unavailable', error: 'Progress storage unavailable; please retry' }; }
}
sessionManager.setDurabilityHooks({
    restore: session => {
        const saved = mpActions.load('session:' + session.handle); if (!saved) return null;
        if (saved.record.meta.ended) return { game: null, startTime: 0, isComplete: false };
        return { game: saved.game, startTime: saved.record.meta.startTime, isComplete: saved.record.meta.complete };
    },
    saveNew: session => mpActions.save(session.game, 'session:' + session.handle, mpMetadata(session.game, 'session:' + session.handle, session.handle)),
    end: session => { const record = mpActions.journal.current('session:' + session.handle); if (record) mpActions.journal.commit(record.scope, record.roundId, record.state, { ...record.meta, ended: true }); }
});
function saveCurrentGameState({ mirrorOnly = false } = {}) {
    if (!game) return;
    const durable = mirrorOnly ? mpActions.recordFor(game) : mpActions.save(game, 'public', mpMetadata(game));
    if (!durable) throw Error('Missing authoritative multiplayer snapshot');
    const state = { ...durable.state };
    state._isWeekly = isWeekly;
    state._isDaily = isDaily;
    state._dailyPlayed = dailyPlayed;
    state._dailyPlayedDate = dailyRounds.lastDate();
    state._dailyEnabled = jackpotSettings.dailyEnabled;
    try { db.saveGameState(state); } catch (error) { console.error('[MPRecovery] Secondary snapshot unavailable: ' + error.message); }
}

function isCurrentMpGameComplete(gameInstance) {
    if (!gameInstance || typeof gameInstance.getState !== 'function') return true;
    try {
        return !!gameInstance.getState().isComplete;
    } catch {
        return false;
    }
}

function getFallbackBoardPresentation() {
    if (!game || typeof game.getState !== 'function') return null;
    try {
        const state = game.getState();
        return {
            game: 'erectangled',
            rows: state.rows || 0,
            cols: state.cols || 0,
            activeCells: [...(state.activeCells || [])],
            revealedCells: [...(state.revealedCells || [])],
            currentRing: state.currentRing || 0,
            totalRings: state.totalRings || 0,
            rotation: 0,
            layout: null,
            cellRects: null,
            updatedAt: new Date().toISOString(),
            version: 0,
            source: 'fallback-game-state'
        };
    } catch {
        return null;
    }
}

const spStateProof = require('./src/sp-state-proof').createSpStateProof(process.env.SP_STATE_SECRET, 'erectangled');
const spVerifiedGames = new WeakMap();
function spProofContext(mode) {
    const cache = mode === 'daily' ? spDailyCache : spWeeklyCache;
    const template = mode === 'daily' ? spDailyGame : spWeeklyGame;
    if (!cache || !template) return null;
    return { mode, period: mode === 'daily' ? (cache.date || cache.dailyDate) : cache.weekStart,
        generation: cache.puzzleGenerationId || spStateProof.generation(template.grid) };
}
function certifySpGame(gameInstance, mode) {
    const context = spProofContext(mode);
    if (context) {
        gameInstance.puzzleGenerationId = context.generation;
        spVerifiedGames.set(gameInstance, context);
    }
    return gameInstance;
}
function verifySpCompletion(body, mode) {
    const context = spProofContext(mode);
    if (!context || !spStateProof.verify(body.state, context)) return false;
    return body.state.rewardComplete === true;
}

// Clone a template Game into a fresh per-session instance (same grid, no found words)
function cloneSpGame(templateGame) {
    const g = new Game();
    g.initializeFromPuzzle({
        grid: templateGame.grid.map(row => row.slice()),
        id: templateGame.puzzleId,
        name: templateGame.puzzleName,
        theme: templateGame.puzzleTheme,
        minWordLength: templateGame.minWordLength
    }, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
    g.puzzleGenerationId = templateGame.puzzleGenerationId || null;
    if (templateGame === spDailyGame) certifySpGame(g, 'daily');
    else if (templateGame === spWeeklyGame) certifySpGame(g, 'weekly');
    return g;
}

function advancePastInitialRing(activeGame) {
    while (activeGame.ringPhase === 'initial' && activeGame.currentRing < activeGame.rings.length - 1) {
        activeGame._advanceRing();
    }
}

function guessSpDurably(activeGame, ...args) {
    const owner = spSessionOwners.get(activeGame);
    if (!owner) throw new Error('Solo session must be registered before guessing');
    const before = JSON.parse(JSON.stringify(activeGame.saveState({ exact: true })));
    const context = spVerifiedGames.get(activeGame) || null;
    try {
        const result = activeGame.guess(...args);
        if (result.result === 'correct') spSessionJournal.save(owner.sid, owner.mode, activeGame.saveState({ exact: true }), context);
        return result;
    } catch (error) {
        activeGame.restoreFrom(before, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
        if (context) certifySpGame(activeGame, owner.mode);
        throw error;
    }
}

function normalizeMpGameSettings(settings = {}) {
    if (settings.usePool === true && !settings.random && !settings.rows && !settings.cols) {
        return { usePool: true };
    }

    return {
        rows: settings.rows || 9,
        cols: settings.cols || 7,
        minWordLength: settings.minWordLength || 3,
        random: !!settings.random
    };
}
let playedPuzzleIds = new Set();  // track played pool puzzle IDs this session
const playedPuzzlesPath = path.join(__dirname, 'data', 'played-puzzles.json');
const spDailyStatePath = path.join(__dirname, 'data', 'sp-daily-state.json');
const spWeeklyStatePath = path.join(__dirname, 'data', 'sp-weekly-state.json');

// Frenzy state
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let connectedPlayers = 0;
let currentDisplaySettings = { showFoundWords: true, lightMode: false, letterScale: 0.5, numberScale: 0.3 };

async function fetchWeeklyWord() {
    try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/weekly/erectangled?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const data = await res.json();
        if (weeklyWord && weeklyWord.weekStart !== data.weekStart) weeklyPlayed = false;
        weeklyWord = data;
    } catch (e) {
        console.warn('[eRecTangled] Weekly word fetch failed:', e.message);
    }
}

async function fetchDailyWord() {
    try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/erectangled?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const data = await res.json();
        // Reset dailyPlayed if date changed
        if (dailyWord && dailyWord.date !== data.date) {
            dailyPlayed = dailyRounds.has(data.date);
        }
        dailyWord = data;
        console.log(`[eRecTangled] Daily word fetched for ${data.date} (${data.word.length} letters)`);
    } catch (e) {
        console.warn('[eRecTangled] Daily word fetch failed:', e.message);
    }
}

function loadPlayedPuzzleIds() {
    try {
        if (fs.existsSync(playedPuzzlesPath)) {
            const data = JSON.parse(fs.readFileSync(playedPuzzlesPath, 'utf-8'));
            // Keep only the most recent 500 entries to prevent unbounded growth
            const capped = data
                .filter(id => id !== null && id !== undefined && id !== '' && id !== 'null' && id !== 'undefined')
                .slice(-500);
            playedPuzzleIds = new Set(capped);
            console.log(`[Puzzles] Loaded ${playedPuzzleIds.size} played puzzle IDs${data.length > 500 ? ` (capped from ${data.length})` : ''}`);
        }
    } catch (e) {
        console.warn('[Puzzles] Failed to load played puzzles:', e.message);
    }
}

function atomicWriteSync(filePath, data) {
    const tmp = filePath + '.tmp';
    let fd;
    try {
        fd = fs.openSync(tmp, 'w', 0o600);
        fs.writeFileSync(fd, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(tmp, filePath);
        if (process.platform !== 'win32') { fd = fs.openSync(path.dirname(filePath), 'r'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; }
    } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function savePlayedPuzzleIds() {
    try {
        const dir = path.dirname(playedPuzzlesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        atomicWriteSync(playedPuzzlesPath, [...playedPuzzleIds]);
    } catch (e) {
        console.warn('[Puzzles] Failed to save played puzzles:', e.message);
    }
}

function loadJsonFromDisk(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        console.warn(`[Disk] Failed to load ${path.basename(filePath)}:`, e.message);
        return fallback;
    }
}

function saveJsonToDisk(filePath, data, label) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        atomicWriteSync(filePath, data);
    } catch (e) {
        console.warn(`[Disk] Failed to save ${label || path.basename(filePath)}:`, e.message);
    }
}

function getCurrentWeekStartUtc() {
    const d = new Date(gameShared.getEdmontonDate() + 'T12:00:00Z');
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
}

function buildPersistedSpState(gameInstance, meta = {}) {
    if (!gameInstance || typeof gameInstance.saveState !== 'function') return null;
    const state = gameInstance.saveState();
    if (meta.mode) state.mode = meta.mode;
    if (meta.date) state.dailyDate = meta.date;
    if (meta.weekStart) state.weekStart = meta.weekStart;
    if (meta.archiveId) state.archiveId = meta.archiveId;
    const context = spVerifiedGames.get(gameInstance);
    if (context) {
        state.puzzleGenerationId = context.generation;
        state.rewardComplete = gameInstance.commonWords.size > 0
            && [...gameInstance.commonWords.keys()].every(word => gameInstance.foundCommon.has(word))
            && gameInstance.currentRing === gameInstance.rings.length - 1;
    }
    return context ? spStateProof.sign(state, context) : state;
}

function buildSpResponse(gameInstance, meta = {}) {
    if (!gameInstance) return null;
    return {
        ...(meta.mode ? { mode: meta.mode } : {}),
        ...(meta.date ? { date: meta.date } : {}),
        ...(meta.weekStart ? { weekStart: meta.weekStart } : {}),
        ...(meta.id ? { id: meta.id } : {}),
        grid: gameInstance.grid,
        rows: gameInstance.rows,
        cols: gameInstance.cols,
        commonCount: gameInstance.commonWords.size,
        rareCount: gameInstance.rareWords.size,
        hiddenCount: gameInstance.hiddenWords.size,
        letterStats: gameInstance.getLetterStats(),
        revealedCells: [...gameInstance.revealedCells],
        currentRing: gameInstance.currentRing,
        totalRings: gameInstance.rings.length,
        rings: gameInstance.rings,
        activeCells: [...gameInstance.getActiveCells()],
        finalRingRefreshedCells: [...gameInstance.finalRingRefreshedCells],
        ringCommonTotal: gameInstance._getRingCommonTotal(),
        ringCommonFound: gameInstance._getRingCommonFound(),
        ringPhase: gameInstance.ringPhase,
        // Per-word cell paths so the client can locally recompute cellStarts/
        // cellUsage after each guess without needing the server to push a
        // fresh letterStats on every guess response.
        commonWordPaths: Object.fromEntries(gameInstance.commonWords),
        // Bumped every time the puzzle is regenerated so clients can
        // detect stale localStorage progress (same date, different grid).
        puzzleGenerationId: gameInstance.puzzleGenerationId || meta.puzzleGenerationId || null,
        name: meta.name || gameInstance.puzzleName || null,
        theme: meta.theme || gameInstance.puzzleTheme || null,
        sessionState: buildPersistedSpState(gameInstance, meta)
    };
}

function savePersistedSpDaily(gameInstance, date) {
    atomicWriteSync(spDailyStatePath, { date, puzzleGenerationId: gameInstance.puzzleGenerationId || null,
        state: gameInstance.saveState({ exact: true }) });
}

function loadPersistedSpDaily() {
    const record = loadJsonFromDisk(spDailyStatePath, null);
    if (!record || typeof record !== 'object' || !record.date || !record.state) return null;
    return record;
}

function restorePersistedSpDaily(record) {
    if (!record?.state || !record?.date) return false;
    try {
        const restored = new Game();
        restored.restoreFrom(record.state, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
        // Carry the persisted generation id over so existing client
        // localStorage progress matches and isn't wiped after a restart.
        if (record.puzzleGenerationId) restored.puzzleGenerationId = record.puzzleGenerationId;
        publishCanonicalSp('daily', record.date, restored);
        return true;
    } catch (e) {
        console.warn('[SP] Failed to restore persisted daily state:', e.message);
        return false;
    }
}

function archivePersistedSpDaily(record) {
    if (!record?.state || !record?.date) return;
    archiveSpDailyToPool({
        date: record.date,
        grid: record.state.grid,
        rows: record.state.rows,
        cols: record.state.cols
    });
}

function getTrackablePuzzleId(puzzle, fallbackIndex) {
    if (puzzle && puzzle.id !== null && puzzle.id !== undefined && puzzle.id !== '') {
        return String(puzzle.id);
    }
    if (typeof fallbackIndex === 'number') {
        return `pool-${fallbackIndex}`;
    }
    return null;
}

// Prefixes protected from pool cap eviction
const PROTECTED_PREFIXES = ['daily-', 'weekly-', 'sp-daily-', 'sp-weekly-'];
function isProtectedPuzzle(p) {
    const id = String(p.id);
    return PROTECTED_PREFIXES.some(pfx => id.startsWith(pfx));
}

function capPuzzlePool() {
    while (puzzles.length > 200) {
        const expendableIdx = puzzles.findIndex(p => !isProtectedPuzzle(p));
        if (expendableIdx >= 0) {
            puzzles.splice(expendableIdx, 1);
        } else {
            puzzles.shift();  // drop oldest protected as last resort
        }
    }
}

function savePuzzlePoolToDisk() {
    try {
        atomicWriteSync(puzzlesPath, puzzles);
    } catch (e) {
        console.warn('[Puzzles] Failed to save puzzles.json:', e.message);
    }
}

function savePuzzleToPool(gameObj) {
    const today = gameShared.getEdmontonDate(); // Edmonton timezone — matches word bank
    const puzzleId = 'daily-' + today;
    if (puzzles.some(p => p.id === puzzleId)) {
        console.log(`[Puzzles] Daily puzzle ${puzzleId} already in pool`);
        return;
    }
    puzzles.push({
        id: puzzleId, name: 'MP Daily - ' + today, theme: 'Daily',
        grid: gameObj.grid, rows: gameObj.rows, cols: gameObj.cols, date: today
    });
    capPuzzlePool();
    savePuzzlePoolToDisk();
    console.log(`[Puzzles] Saved daily puzzle ${puzzleId} to pool (${puzzles.length} total)`);
}

// Archive expired SP daily/weekly to the pool so players can replay them
function archiveSpDailyToPool(cache) {
    if (!cache || !cache.grid || !cache.date) return;
    const puzzleId = 'sp-daily-' + cache.date;
    if (puzzles.some(p => p.id === puzzleId)) return;
    puzzles.push({
        id: puzzleId, name: 'Daily - ' + cache.date, theme: 'Daily',
        grid: cache.grid, rows: cache.rows, cols: cache.cols, date: cache.date
    });
    capPuzzlePool();
    savePuzzlePoolToDisk();
    console.log(`[Puzzles] Archived SP daily ${puzzleId} to pool (${puzzles.length} total)`);
}

function archiveSpWeeklyToPool(cache) {
    if (!cache || !cache.grid || !cache.weekStart) return;
    const puzzleId = 'sp-weekly-' + cache.weekStart;
    if (puzzles.some(p => p.id === puzzleId)) return;
    puzzles.push({
        id: puzzleId, name: 'Weekly - ' + cache.weekStart, theme: 'Weekly',
        grid: cache.grid, rows: cache.rows, cols: cache.cols, date: cache.weekStart
    });
    capPuzzlePool();
    savePuzzlePoolToDisk();
    console.log(`[Puzzles] Archived SP weekly ${puzzleId} to pool (${puzzles.length} total)`);
}

// Pre-made puzzles
const puzzlesPath = path.join(__dirname, 'data', 'puzzles.json');
let puzzles = [];
let currentPuzzleIndex = 0;

// ─── Static Files ───────────────────────────────────────────────────────────

// Serve socket.io client bundle from this server so HTTPS pages don't hit localhost:3000
const socketIOClientPath = path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js');
app.get('/socket.io/socket.io.js', (req, res) => res.sendFile(socketIOClientPath));

// Serve public/ files at root (SP/MP pages served as /sp.html, /mp.html via Chat Relay game proxy)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/stream', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mp.html')));

// Streamer-private session URL: erectangled.com/<handle> serves the MP play
// page. Frontend reads location.pathname → passes auth.session on the
// Socket.IO handshake.
const SESSION_RESERVED_HANDLES = new Set([
  'stream', 'overlay', 'admin', 'admin.html', 'api', 'js', 'css', 'public',
  'index.html', 'mp.html', 'sp.html', 'live2d-overlay.html',
  'favicon.ico', 'sw.js', 'robots.txt', 'manifest.json', 'sitemap.xml',
  'live2d', 'data', 'img', 'assets', 'about', 'solo',
]);
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  if (_isPagePlayDisabled(handle) && req.query.disabled !== '1') {
    const _self = req.query.streamer_self === '1' ? '&streamer_self=1' : '';
    // Preserve ?obs=1 across this redirect. The stream-view game widget loads
    // this page as /<handle>?obs=1, and rebuilding the query from scratch here
    // silently dropped it — so for any streamer with disablePlayerPage ON:
    //   1. obs-mode was never stamped  → the page stayed opaque navy in the
    //      overlay (the whole see-through path was dead), and
    //   2. session-disable-gate.js never hit its `obs === '1'` early-return
    //      → the "Join the live stream" gate covered the streamer's own embed,
    //      which is exactly what chat-relay's `&obs=1` was added to prevent.
    const _obs = req.query.obs !== undefined ? '&obs=1' : '';
    return res.redirect(302, '/' + encodeURIComponent(handle) + '?disabled=1' + _self + _obs);
  }
  res.sendFile(path.join(__dirname, 'public', 'mp.html'));
});

// REMOVED: express.static(__dirname) — exposed server.js, package.json, node_modules, .bak files
// All active HTML/CSS/JS is already in public/ (served by the static mount above)

// ─── SSE Control API (kept for admin panel compatibility) ───────────────────

app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no'
    });
    res.write(':\n\n');
    sseClients.add(res);
    // Send last known Spotify state immediately so overlay doesn't wait
    if (lastSpotifyState) {
        res.write(`event: spotify-now-playing\ndata: ${JSON.stringify(lastSpotifyState)}\n\n`);
    }
    req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try { client.write(msg); } catch { sseClients.delete(client); }
    }
}

// Legacy context hook retained for compatibility; Sassie ignores this provider pattern.
setInterval(() => {
    if (!game) return;
    const s = game.getState();
    const top = (s.topPlayers || [])[0];
    const topStr = top ? `Leader: ${top.displayName} (${top.score}pts)` : 'No players yet';
    sassie.sendContext(`erecTangled: ${s.foundCommonCount}/${s.commonCount} common words, Ring ${s.currentRing}/${s.totalRings}, ${topStr}, ${(s.topPlayers || []).length} players`);
}, 60000);

// SSE heartbeat every 15s — keeps nginx proxy alive and prunes dead connections
setInterval(() => {
    for (const client of sseClients) {
        try { client.write(':\n\n'); } catch { sseClients.delete(client); }
    }
}, 15000);

app.post('/api/command', requireAdmin, (req, res) => {
    const command = req.body;
    if (command.type === 'new-game') {
        lastMpGameSettings = normalizeMpGameSettings(command.data || {});
        db.saveMpSettings(lastMpGameSettings);
        // A manual MP new-game request should take priority over any pending daily.
        jackpotSettings.dailyEnabled = false;
        dailyRounds.reset(gameShared.getEdmontonDate());
        dailyPlayed = false;
        startNewGame(lastMpGameSettings);
    }
    if (command.type === 'display') {
        // Only store display-relevant keys — game settings (rows, cols, etc.) must not leak into displaySettings
        const d = command.data || {};
        currentDisplaySettings = {
            showFoundWords: d.showFoundWords !== undefined ? !!d.showFoundWords : currentDisplaySettings.showFoundWords,
            lightMode: !!d.lightMode,
            letterScale: d.letterScale !== undefined ? d.letterScale : currentDisplaySettings.letterScale,
            numberScale: d.numberScale !== undefined ? d.numberScale : currentDisplaySettings.numberScale
        };
    }
    broadcastSSE(command.type, command.data || {});
    res.json({ ok: true });
});

// ─── API Endpoints ──────────────────────────────────────────────────────────

// SP dictionary endpoint - returns all words for single-player mode
app.get('/api/sp/dictionary', (req, res) => {
    const words = wordlist.getAllWords();
    res.json(words);
});

// SP targets endpoint - returns array of all target words
app.get('/api/sp/targets', (req, res) => {
    res.json(wordlist.getTargetWords());
});

// SP frequency endpoint - returns { word: zipfScore } for all words
app.get('/api/sp/frequency', (req, res) => {
    const freqMap = wordlist.getFrequencyMap();
    const obj = {};
    for (const [word, score] of freqMap) obj[word] = score;
    res.json(obj);
});

// One builder per period; durable templates become visible only after saving.
const spCanonicalLoads = new Map();
function spCanonicalPeriod(mode) {
    return mode === 'daily' ? gameShared.getEdmontonDate() : getCurrentWeekStartUtc();
}
function publishCanonicalSp(mode, period, template) {
    const context = { mode, period, generation: template.puzzleGenerationId };
    spVerifiedGames.set(template, context);
    const response = buildSpResponse(template, mode === 'daily'
        ? { mode, date: period, name: 'Single Player Daily - ' + period, theme: 'Daily' }
        : { mode, weekStart: period, name: 'Weekly Challenge', theme: 'Weekly' });
    if (mode === 'daily') { spDailyGame = template; spDailyCache = response; }
    else { spWeeklyGame = template; spWeeklyCache = response; }
    return response;
}
async function loadCanonicalSp(mode) {
    const period = spCanonicalPeriod(mode);
    const cached = mode === 'daily' ? spDailyCache : spWeeklyCache;
    if (cached && (mode === 'daily' ? cached.date : cached.weekStart) === period) return cached;
    const key = mode + ':' + period;
    if (spCanonicalLoads.has(key)) return spCanonicalLoads.get(key);
    const loading = (async () => {
        const persisted = mode === 'daily' ? loadPersistedSpDaily() : loadJsonFromDisk(spWeeklyStatePath, null);
        if (persisted && (mode === 'daily' ? persisted.date : persisted.weekStart) === period &&
            persisted.state && persisted.puzzleGenerationId) {
            const restored = new Game();
            restored.restoreFrom(persisted.state, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
            restored.puzzleGenerationId = persisted.puzzleGenerationId;
            return publishCanonicalSp(mode, period, restored);
        }
        if (cached) {
            if (mode === 'daily') archiveSpDailyToPool(cached); else archiveSpWeeklyToPool(cached);
        } else if (persisted?.state) {
            if (mode === 'daily') archivePersistedSpDaily(persisted);
            else archiveSpWeeklyToPool({ ...persisted.state, weekStart: persisted.weekStart });
        }
        if (mode === 'daily') await fetchDailyWord(); else await fetchWeeklyWord();
        if (spCanonicalPeriod(mode) !== period) throw Object.assign(new Error('Period changed; retry'), { status: 409 });
        const anchor = mode === 'daily' ? dailyWord : weeklyWord;
        if (!anchor?.word) throw Object.assign(new Error('Puzzle unavailable'), { status: 404 });
        const template = new Game();
        template.initializeAroundWord(anchor.word, mode === 'daily' ? 6 : 9, mode === 'daily' ? 4 : 7,
            wordlist.getTrie(), wordlist.getTargetSet(), { minCommon: mode === 'daily' ? 18 : 30,
                maxCommon: mode === 'daily' ? 32 : 60, frequencyMap: wordlist.getFrequencyMap() });
        advancePastInitialRing(template);
        template.puzzleGenerationId = 'gen-' + Date.now();
        if (mode === 'daily') savePersistedSpDaily(template, period);
        else atomicWriteSync(spWeeklyStatePath, { weekStart: period, puzzleGenerationId: template.puzzleGenerationId,
            state: template.saveState({ exact: true }) });
        if (spCanonicalPeriod(mode) !== period) throw Object.assign(new Error('Period changed; retry'), { status: 409 });
        return publishCanonicalSp(mode, period, template);
    })();
    spCanonicalLoads.set(key, loading);
    try { return await loading; } finally { if (spCanonicalLoads.get(key) === loading) spCanonicalLoads.delete(key); }
}
app.get('/api/sp/daily', async (req, res) => {
    try { res.json(await loadCanonicalSp('daily')); }
    catch (error) { res.status(error.status || 503).json({ error: 'Daily puzzle could not be loaded. Please retry.' }); }
});

// The same stable completion ID is used by the legacy Relay path. Central
// normalized payloads agree, so an interrupted pre-upgrade claim cannot pay twice.
const { stableCompletionEvent } = require(path.join(RELAY_DIR, 'src', 'reward-outbox.js'));
async function deliverSpCompletion(userId, mode, period) {
    const game = 'erectangled', gameId = 'erectangled-sp';
    const eventId = stableCompletionEvent(mode, gameId, userId, period);
    const reserved = gameShared.reservePlayerReward('discord', String(userId), String(userId), String(userId),
        1, game, mode === 'daily' ? 'daily-win' : 'weekly-win', { eventId, rewardPeriod: period });
    if (!reserved) throw new Error('Persistent completion recipient required');
    // Reservation is synchronous and durable; the SDK retries and reconciles
    // after timeout, disconnect, restart or Edmonton rollover.
    const reward = await gameShared.deliverPlayerReward(eventId);
    const record = gameShared.getPlayerRewardDelivery(eventId);
    if (!record || ['check', 'rejected'].includes(record.state)) throw new Error('Completion delivery requires review');
    return { ok: true, rewardEventId: eventId, reward: reward || null, rewardPending: record.state !== 'delivered',
        ...(record.state !== 'delivered' ? { warning: 'Completion saved; reward delivery is pending.' } : {}) };
}

app.post('/api/sp/daily/complete', async (req, res) => {
    const verifiedUserId = await resolveUserFromCookie(req);
    if (!verifiedUserId) return res.status(401).json({ ok: false, error: 'auth_required' });
    // Identity comes from the verified remember cookie, never the request body.
    // Server-to-server forwarding to Chat Relay uses ADMIN_SECRET.
    if (!spDailyCache) {
        const persistedDaily = loadPersistedSpDaily();
        if (!persistedDaily || !restorePersistedSpDaily(persistedDaily)) {
            return res.json({ ok: false });
        }
    }
    const date = String(req.body?.date || spDailyCache.date || spDailyCache.dailyDate || '');
    const expectedDate = spDailyCache.date || spDailyCache.dailyDate || null;
    if (!date || !expectedDate || expectedDate !== date) {
        return res.json({ ok: false, error: 'Invalid daily date' });
    }

    if (date !== gameShared.getEdmontonDate() || !verifySpCompletion(req.body || {}, 'daily'))
        return res.status(409).json({ ok: false, error: 'Verified daily solve required' });
    archiveSpDailyToPool(spDailyCache);

    try {
        return res.json(await deliverSpCompletion(verifiedUserId, 'daily', date));
    } catch {
        return res.status(503).json({ ok: false, error: 'Completion could not be acknowledged. Please retry.' });
    }
});

app.post('/api/sp/restore', (req, res) => {
    try {
        const { sid, mode, state } = req.body || {};
        if (typeof sid !== 'string' || !sid || sid.length > 256 || !['daily', 'weekly', 'random', 'archive'].includes(mode) ||
            !state || typeof state !== 'object' || Array.isArray(state) || JSON.stringify(state).length > 128 * 1024) {
            return res.status(400).json({ ok: false, error: 'Missing sid, mode, or state' });
        }

        if (mode === 'daily') {
            const today = gameShared.getEdmontonDate(); // Edmonton timezone — matches word bank
            if (state.dailyDate !== today) {
                return res.status(400).json({ ok: false, error: 'Stale daily state' });
            }
        }

        if (mode === 'weekly') {
            const weekStart = getCurrentWeekStartUtc();
            if (state.weekStart !== weekStart) {
                return res.status(400).json({ ok: false, error: 'Stale weekly state' });
            }
        }

        let restored;
        if (mode === 'daily' || mode === 'weekly') {
            const template = mode === 'daily' ? spDailyGame : spWeeklyGame;
            const context = spProofContext(mode);
            if (!template || !context) return res.status(409).json({ ok: false, error: 'Load the current puzzle first' });
            const durable = spSessionJournal.get(sid, mode, context);
            if (durable) {
                restored = new Game();
                restored.restoreFrom(durable, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
                certifySpGame(restored, mode);
            } else if (state.rewardProofVersion === 2) {
                if (!spStateProof.verify(state, context)) return res.status(409).json({ ok: false, error: 'Invalid or stale saved progress' });
                restored = new Game();
                restored.restoreFrom(state, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
                certifySpGame(restored, mode);
            } else {
                // Legacy/shared-key saves: replay canonical words, never trust their certificate/grid/ring flags.
                if (state.puzzleGenerationId && state.puzzleGenerationId !== context.generation)
                    return res.status(409).json({ ok: false, error: 'Stale puzzle generation' });
                if (!Array.isArray(state.foundWords) || state.foundWords.length > 5000)
                    return res.status(400).json({ ok: false, error: 'Invalid saved progress' });
                restored = cloneSpGame(template);
                advancePastInitialRing(restored);
                let pending = state.foundWords.map(entry => typeof entry === 'string' ? entry : entry?.word)
                    .filter(word => typeof word === 'string' && word.length <= 30);
                while (pending.length) {
                    const remaining = pending.filter(word => {
                        const result = restored.guess(word.trim().toLowerCase(), 'web', 'sp-user', 'Player', 'Player', null);
                        return !['correct', 'already_found'].includes(result.result);
                    });
                    if (remaining.length === pending.length) break;
                    pending = remaining;
                }
            }
        } else {
            const durable = spSessionJournal.get(sid, mode, null);
            restored = new Game();
            restored.restoreFrom(durable || state, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: !!durable });
        }
        setSpSession(sid, mode, restored);

        const meta = { mode };
        if (mode === 'daily') {
            meta.date = state.dailyDate;
            meta.name = 'Single Player Daily - ' + state.dailyDate;
            meta.theme = 'Daily';
        } else if (mode === 'weekly') {
            meta.weekStart = state.weekStart;
            meta.name = restored.puzzleName || 'Weekly Challenge';
            meta.theme = 'Weekly';
        } else if (mode === 'archive') {
            meta.id = state.archiveId || restored.puzzleId || null;
            meta.archiveId = state.archiveId || restored.puzzleId || null;
            meta.name = restored.puzzleName || 'Archive Puzzle';
            meta.theme = restored.puzzleTheme || 'Archive';
        } else {
            meta.name = restored.puzzleName || 'Random';
            meta.theme = restored.puzzleTheme || 'Random';
        }

        res.json({ ok: true, ...buildSpResponse(restored, meta) });
    } catch (e) {
        console.error('[SP] Restore error:', e.message);
        res.status(500).json({ ok: false, error: 'Restore failed' });
    }
});

// SP Weekly puzzle uses the same durable canonical loader.
app.get('/api/sp/weekly', async (req, res) => {
    try { res.json(await loadCanonicalSp('weekly')); }
    catch (error) { res.status(error.status || 503).json({ error: 'Weekly puzzle could not be loaded. Please retry.' }); }
});

// Generic SP guess — validates against per-session SP game instance
app.post('/api/sp/guess', (req, res) => {
    try {
        const { word, sid, mode } = req.body || {};
        if (typeof sid !== 'string' || !sid || sid.length > 256 || !['daily', 'weekly', 'random', 'archive'].includes(mode) ||
            typeof word !== 'string' || word.length > 30) return res.status(400).json({ result: 'wrong', error: 'Invalid guess' });

        // Get or create per-session game instance
        let activeGame = getSpSession(sid, mode);
        if (!activeGame) {
            // Clone from the appropriate template
            let template = null;
            if (mode === 'daily') template = spDailyGame;
            else if (mode === 'weekly') template = spWeeklyGame;
            // Random/archive boards are per-player and live nowhere but
            // spSessions, which is in memory — a restart, the 4h TTL or the
            // 500-session cap drops them. Returning a plain 'wrong' made
            // every word on the player's own grid look incorrect and left
            // the round permanently unfinishable. Ask the client to
            // re-register the board it still holds instead.
            if (!template) return res.json({ result: 'session_expired', word: word || '' });
            activeGame = cloneSpGame(template);
            setSpSession(sid, mode, activeGame);
        }

        if (!word) return res.json({ result: 'wrong', word: '' });
        const normalized = word.trim().toLowerCase();
        if (!normalized || normalized.length < 3) return res.json({ result: 'wrong', word: normalized });
        // Use full guess() method for ring advancement
        const result = guessSpDurably(activeGame, normalized, 'web', 'sp-user', 'Player', 'Player', null);
        const responseMeta = { mode };
        if (mode === 'daily') {
            responseMeta.date = spDailyCache?.date || null;
            responseMeta.name = spDailyCache?.name || activeGame.puzzleName || null;
            responseMeta.theme = 'Daily';
        } else if (mode === 'weekly') {
            responseMeta.weekStart = spWeeklyCache?.weekStart || getCurrentWeekStartUtc();
            responseMeta.name = spWeeklyCache?.name || activeGame.puzzleName || null;
            responseMeta.theme = 'Weekly';
        } else if (mode === 'archive') {
            responseMeta.id = activeGame.puzzleId || null;
            responseMeta.archiveId = activeGame.puzzleId || null;
            responseMeta.name = activeGame.puzzleName || null;
            responseMeta.theme = activeGame.puzzleTheme || 'Archive';
        } else {
            responseMeta.name = activeGame.puzzleName || 'Random';
            responseMeta.theme = activeGame.puzzleTheme || 'Random';
        }
        if (result.result === 'correct') {
            res.json({
                result: 'correct',
                word: result.word,
                cells: result.cells,
                isRare: result.isRare,
                isHidden: result.isHidden,
                isThreeLetter: result.isThreeLetter,
                ringAdvanced: result.ringAdvanced || false,
                newRevealedCells: result.newRevealedCells || [],
                refreshedLetters: result.refreshedLetters || {},
                isFinalRing: result.isFinalRing || false,
                currentRing: result.currentRing,
                totalRings: result.totalRings,
                ringPhase: result.ringPhase,
                revealedCells: [...activeGame.revealedCells],
                activeCells: [...activeGame.getActiveCells()],
                finalRingRefreshedCells: [...activeGame.finalRingRefreshedCells],
                ringCommonTotal: result.ringCommonTotal,
                ringCommonFound: result.ringCommonFound,
                foundCommonCount: activeGame.foundCommon.size,
                commonCount: activeGame.commonWords.size,
                sessionState: buildPersistedSpState(activeGame, responseMeta)
            });
        } else if (result.result === 'already_found') {
            res.json({ result: 'already_found', word: normalized, ...buildSpResponse(activeGame, responseMeta) });
        } else {
            res.json({ result: result.result || 'wrong', word: normalized });
        }
    } catch (e) {
        console.error('[SP] Guess could not be persisted');
        res.status(503).json({ result: 'retry', message: 'Progress could not be saved. Please try again.' });
    }
});

// Legacy weekly guess — deprecated, kept for backward compat. Routes through main SP guess logic.
app.post('/api/sp/weekly/guess', (req, res) => {
    try {
        const { word, sid } = req.body || {};
        const mode = 'weekly';
        if (typeof sid !== 'string' || !sid || sid.length > 256 || typeof word !== 'string' || word.length > 30)
            return res.status(400).json({ result: 'wrong', error: 'Invalid guess' });
        let activeGame = getSpSession(sid, mode);
        if (!activeGame) {
            if (!spWeeklyGame) return res.json({ result: 'wrong', word: word || '' });
            activeGame = cloneSpGame(spWeeklyGame);
            setSpSession(sid, mode, activeGame);
        }
        if (!word) return res.json({ result: 'wrong', word: '' });
        const normalized = word.trim().toLowerCase();
        if (!normalized || normalized.length < 3) return res.json({ result: 'wrong', word: normalized });
        const result = guessSpDurably(activeGame, normalized, 'web', 'sp-user', 'Player', 'Player', null);
        if (result.result === 'correct') {
            res.json({
                result: 'correct', word: result.word, cells: result.cells,
                isRare: result.isRare, isHidden: result.isHidden, isThreeLetter: result.isThreeLetter,
                ringAdvanced: result.ringAdvanced || false, newRevealedCells: result.newRevealedCells || [],
                refreshedLetters: result.refreshedLetters || {},
                isFinalRing: result.isFinalRing || false,
                revealedCells: [...activeGame.revealedCells], activeCells: [...activeGame.getActiveCells()],
                finalRingRefreshedCells: [...activeGame.finalRingRefreshedCells],
                ringCommonTotal: result.ringCommonTotal,
                ringCommonFound: result.ringCommonFound,
                currentRing: result.currentRing, totalRings: result.totalRings,
                ringPhase: result.ringPhase,
                sessionState: buildPersistedSpState(activeGame, {
                    mode: 'weekly',
                    weekStart: spWeeklyCache?.weekStart || getCurrentWeekStartUtc(),
                    name: spWeeklyCache?.name || activeGame.puzzleName || 'Weekly Challenge',
                    theme: 'Weekly'
                })
            });
        } else {
            res.json({ result: result.result || 'wrong', word: normalized });
        }
    } catch (e) {
        console.error('[SP] Weekly guess could not be persisted');
        res.status(503).json({ result: 'retry', message: 'Progress could not be saved. Please try again.' });
    }
});

app.post('/api/sp/weekly/complete', async (req, res) => {
    const userId = await resolveUserFromCookie(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'auth_required' });
    const weekStart = req.body?.weekStart;
    if (weekStart !== getCurrentWeekStartUtc() || !spWeeklyCache || spWeeklyCache.weekStart !== weekStart || !verifySpCompletion(req.body || {}, 'weekly'))
        return res.status(409).json({ ok: false, error: 'Verified weekly solve required' });
    archiveSpWeeklyToPool(spWeeklyCache);
    try {
        return res.json(await deliverSpCompletion(userId, 'weekly', weekStart));
    } catch {
        return res.status(503).json({ ok: false, error: 'Completion could not be acknowledged. Please retry.' });
    }
});

// ─── SP Random Puzzle (custom grid size) ──────────────────────────────────────
app.get('/api/sp/random', (req, res) => {
    try {
        const rows = Math.min(12, Math.max(5, parseInt(req.query.rows) || 9));
        const cols = Math.min(9, Math.max(4, parseInt(req.query.cols) || 7));
        const targets = wordlist.getTargetSet();
        const targetArr = Array.from(targets);
        const word = targetArr[Math.floor(Math.random() * targetArr.length)];
        const g = new Game();
        const minCommon = Math.max(5, Math.floor(rows * cols * 0.2));
        const maxCommon = Math.floor(rows * cols * 0.6);
        g.initializeAroundWord(word, rows, cols, wordlist.getTrie(), targets, { minCommon, maxCommon, frequencyMap: wordlist.getFrequencyMap() });
        // Auto-advance past Ring 0
        advancePastInitialRing(g);
        // Store per-session if sid provided
        const sid = req.query.sid;
        if (sid) setSpSession(sid, 'random', g);
        res.json(buildSpResponse(g, {
            mode: 'random',
            name: 'Random ' + rows + '×' + cols,
            theme: 'Random'
        }));
    } catch (e) {
        console.error('[SP] Random puzzle error:', e.message);
        res.status(500).json({ error: 'Failed to generate puzzle' });
    }
});

// ─── SP Archive (browse past puzzles) ─────────────────────────────────────────
app.get('/api/sp/archive', (req, res) => {
    const archived = puzzles.filter(p => p.id && (typeof p.id === 'string') && (p.id.startsWith('sp-daily-') || p.id.startsWith('sp-weekly-')));
    const list = archived.map(p => ({
        id: p.id,
        name: p.name || p.id,
        rows: p.rows || p.grid?.length || 0,
        cols: p.cols || p.grid?.[0]?.length || 0,
        type: p.id.includes('daily') ? 'daily' : 'weekly',
        date: p.date || p.id.replace(/^sp-(daily|weekly)-/, '')
    })).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ ok: true, puzzles: list });
});

app.get('/api/sp/archive/:id', (req, res) => {
    const puzzle = puzzles.find(p => p.id === req.params.id);
    if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });
    // Build a Game instance for guess validation (per-session)
    try {
        const sid = req.query.sid;
        if (sid) {
            const g = new Game();
            g.initializeFromPuzzle(puzzle, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
            setSpSession(sid, 'archive', g);
        }
    } catch (e) { console.error('[SP] Archive game build error:', e.message); }
    try {
        const g = new Game();
        g.initializeFromPuzzle(puzzle, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
        res.json(buildSpResponse(g, {
            mode: 'archive',
            id: puzzle.id,
            archiveId: puzzle.id,
            name: puzzle.name || g.puzzleName || 'Archive Puzzle',
            theme: puzzle.theme || g.puzzleTheme || 'Archive'
        }));
    } catch (e) {
        console.error('[SP] Archive response build error:', e.message);
        res.json(puzzle);
    }
});

// Puzzles list endpoint - returns puzzle metadata (no grids)
app.get('/api/puzzles', (req, res) => {
    res.json(puzzles.map(p => ({ id: p.id, name: p.name, theme: p.theme, rows: p.rows || p.grid?.length || 4, cols: p.cols || p.grid?.[0]?.length || 4, date: p.date || null })));
});

// Single puzzle endpoint - returns full puzzle with grid
app.get('/api/puzzles/:id', (req, res) => {
    // Support both numeric IDs (pool puzzles) and string IDs (sp-daily-*, sp-weekly-*, etc.)
    const rawId = req.params.id;
    const numId = parseInt(rawId);
    const puzzle = puzzles.find(p => p.id === rawId || p.id === numId);
    if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });
    res.json(puzzle);
});

// Current game state. Optional ?session=<handle> returns the
// per-streamer private session state instead of the public game,
// powering OBS overlays opened at /overlay/<handle>.
app.get('/api/game/state', (req, res) => {
    const sessionHandle = typeof req.query.session === 'string' ? req.query.session.toLowerCase().trim() : '';
    if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
        const sess = sessionManager.getSession(sessionHandle);
        const state = sessionManager.buildSessionState(sess, jackpotSettings);
        if (!state) return res.json({ error: 'No active session' });
        return res.json({ ...state, displaySettings: currentDisplaySettings });
    }
    if (!game) return res.json({ error: 'No active game' });
    res.json({ ...game.getState(), jackpot: calculateJackpot(), jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy, playerCount: connectedPlayers, displaySettings: currentDisplaySettings });
});

// ─── Monthly hint integration (Donor / Super Fan perk) ───────────────────────
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`, {
      headers: { 'x-api-key': process.env.GAME_API_SECRET },
    });
    if (!r.ok) return res.json({ ok: true, remaining: 0 });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Erectangled] hints/remaining failed:', e.message);
    res.json({ ok: true, remaining: 0 });
  }
});

app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: false, reason: 'not_authenticated', remaining: 0 });

  const handle = String((req.body && req.body.handle) || 'public').toLowerCase().trim();
  const hint = generateHintForHandle(handle);
  if (!hint) return res.json({ ok: false, reason: 'no_hint_available', remaining: 0 });

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.GAME_API_SECRET,
      },
      body: JSON.stringify({ discordId, game: 'erectangled' }),
    });
    if (!r.ok) return res.json({ ok: false, reason: 'spend_failed', remaining: 0 });
    const data = await r.json();
    if (!data.ok) return res.json({ ok: false, reason: data.reason || 'spend_failed', remaining: data.remaining });
    return res.json({ ok: true, remaining: data.remaining, hint });
  } catch (e) {
    console.error('[Erectangled] hints/use failed:', e.message);
    return res.json({ ok: false, reason: 'spend_failed', remaining: 0 });
  }
});

// Streamer-scoped OBS overlay: erectangled.com/overlay/<handle> redirects
// to /overlay.html?session=<handle>. overlay.js reads ?session= and scopes
// its state polls to the streamer's private session. Redirect (not a
// path-based render) avoids breaking the relative script/asset paths in
// overlay.html.
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
    const handle = req.path.split('/').pop().toLowerCase();
    if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/overlay.html');
    res.redirect(302, `/overlay.html?session=${encodeURIComponent(handle)}`);
});

app.get('/api/board-presentation', (_req, res) => {
    res.json(boardPresentationState || getFallbackBoardPresentation() || {
        game: 'erectangled',
        rows: 0,
        cols: 0,
        activeCells: [],
        revealedCells: [],
        currentRing: 0,
        totalRings: 0,
        rotation: 0,
        layout: null,
        cellRects: null,
        updatedAt: null,
        version: 0,
        source: 'empty'
    });
});

app.post('/api/board-presentation', (req, res) => {
    const body = req.body || {};
    const fallback = getFallbackBoardPresentation() || {};
    const nextVersion = (boardPresentationState?.version || 0) + 1;
    boardPresentationState = {
        game: 'erectangled',
        rows: Number.isFinite(body.rows) ? body.rows : (fallback.rows || 0),
        cols: Number.isFinite(body.cols) ? body.cols : (fallback.cols || 0),
        activeCells: Array.isArray(body.activeCells) ? body.activeCells : (fallback.activeCells || []),
        revealedCells: Array.isArray(body.revealedCells) ? body.revealedCells : (fallback.revealedCells || []),
        currentRing: Number.isFinite(body.currentRing) ? body.currentRing : (fallback.currentRing || 0),
        totalRings: Number.isFinite(body.totalRings) ? body.totalRings : (fallback.totalRings || 0),
        rotation: Number.isFinite(body.rotation) ? body.rotation : 0,
        layout: body.layout && typeof body.layout === 'object' ? body.layout : null,
        cellRects: Array.isArray(body.cellRects) ? body.cellRects : null,
        updatedAt: new Date().toISOString(),
        version: nextVersion,
        source: typeof body.source === 'string' && body.source ? body.source : 'overlay'
    };
    res.json({ ok: true, version: nextVersion });
});

// Game history
app.get('/api/game/history', (req, res) => {
    const history = db.getRecentHistory(100);
    res.json(history);
});

// ─── Cosmetics Proxy (for client-side OBS overlay) ──────────────────────────

app.get('/api/cosmetics/:platform/:userId', async (req, res) => {
    try {
        let { platform, userId } = req.params;
        // Web portal users authenticate via Discord — resolve cosmetics under discord platform
        if (platform === 'web') platform = 'discord';
        const cosmetics = await gameShared.getPlayerCosmetics(platform, userId);
        res.json({ equipped: cosmetics || {} });
    } catch (e) {
        res.json({ equipped: {} });
    }
});

// ─── ELO Leaderboard (from Word Tycoon — canonical source) ───────────────────
app.get('/api/elo/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
        const wtRes = await fetch(`${WORD_EMPIRES_URL}/api/elo/erectangled/leaderboard?limit=${limit}&minRounds=5`, {
            headers: { 'x-api-key': process.env.GAME_API_SECRET }
        });
        if (!wtRes.ok) throw new Error('WT ' + wtRes.status);
        const data = await wtRes.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ ok: false, error: e.message });
    }
});

// ─── Jackpot API ─────────────────────────────────────────────────────────────

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
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') jackpotSettings.enabled = b.enabled;
    if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
    if (typeof b.base === 'number' && b.base >= 0) jackpotSettings.base = b.base;
    if (typeof b.perGuess === 'number' && b.perGuess >= 0) jackpotSettings.perGuess = b.perGuess;
    if (typeof b.perSecond === 'number' && b.perSecond >= 0) jackpotSettings.perSecond = b.perSecond;
    if (typeof b.max === 'number' && b.max >= 0) jackpotSettings.max = b.max;
    console.log('[eRecTangled] Jackpot settings updated:', jackpotSettings);
    res.json({ ok: true, ...jackpotSettings, current: calculateJackpot() });
});

// Overlay can POST here to trigger Sassie reactions (no auth needed — local overlay only)
const WRAP_MESSAGES = {
  start:  'Sassie just started zooming around the screen — she looks confused!',
  medium: 'Sassie is going faster and faster, looping around the screen — she can NOT stop!!',
  fast:   'SASSIE IS COMPLETELY OUT OF CONTROL, SPINNING AROUND THE SCREEN AT INSANE SPEED!!!',
  max:    'AAAAHHHHH SASSIE IS A TOTAL BLUR SHE IS GOING SO IMPOSSIBLY FAST I CANNOT EVEN SEE HER ANYMORE HELP'
};
app.post('/api/overlay-event', (req, res) => {
    const { type } = req.body || {};
    const msg = WRAP_MESSAGES[type];
    if (msg) {
        sassie.triggerReaction(msg);
        console.log(`[Overlay] Sassie triggered: ${type}`);
    }
    res.json({ ok: true });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
    gameStartTime = Date.now();
    console.log('[eRecTangled] Jackpot timer reset');
    res.json({ ok: true, current: calculateJackpot() });
});

app.post('/api/game/start-daily', requireAdmin, async (req, res) => {
    try {
        await fetchDailyWord();
        if (!dailyWord || !dailyWord.word) {
            return res.status(400).json({ error: 'No daily word available' });
        }
        // Force daily to be picked on next startNewGame
        dailyRounds.reset(gameShared.getEdmontonDate());
        dailyPlayed = false;
        jackpotSettings.dailyEnabled = true;
        // Cancel any pending auto-restart
        if (newGameTimer) {
            clearTimeout(newGameTimer);
            newGameTimer = null;
        }
        startNewGame({});
        console.log(`[eRecTangled] Admin triggered daily game: "${dailyWord.word}"`);
        res.json({ ok: true, word: dailyWord.word });
    } catch (e) {
        console.error('[eRecTangled] Start daily failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── Socket.IO Server ──────────────────────────────────────────────────────

// Persistent redirect targets per streamer-handle. Chat-relay sets
// these via /api/session/redirect when the streamer switches away;
// any viewer who later loads /?session=<handle> gets the redirect
// modal at socket-connect time. Cleared via /api/session/clear-
// redirect when the streamer returns to this game.
const _streamerRedirectTargets = new Map();

io.on('connection', async (socket) => {
    // Streamer-private session viewer: auth.session=<handle> arrives via the
    // /<handle> URL. Lazy-create the session game so viewers see a board on
    // first connect; same-origin connection, no proxy.
    const sessionHandleRaw = socket.handshake?.auth?.session;
    const sessionHandle = typeof sessionHandleRaw === 'string'
        ? sessionHandleRaw.toLowerCase().trim() : null;
    if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
        // Persistent redirect: if chat-relay told us the streamer
        // moved, send the modal to this socket and skip session-build
        // so we don't recreate a private round in a non-current game.
        const _redirTarget = _streamerRedirectTargets.get(sessionHandle);
        if (_redirTarget) {
            socket.emit('session-redirect', { handle: sessionHandle, ..._redirTarget });
            return;
        }
        socket._isSession = true;
        socket._sessionHandle = sessionHandle;
        socket.join(_sessionRoom(sessionHandle));
        try {
            const session = await sessionManager.getOrCreateSession({
                handle: sessionHandle,
                sessionId: null,
                wordlist,
                settings: _sessionSettingsFor(sessionHandle),
            });
            socket.emit('game-state', sessionManager.buildSessionState(session, jackpotSettings));
        } catch (err) {
            console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
            socket.emit('game-state', { error: 'Session unavailable', isSession: true });
        }
        // Session viewers can submit guesses from the page input. Synthesize
        // a chat-relay-style message and route through handleSessionChat so
        // reward / leaderboard / broadcast logic stays consistent with TikTok-
        // chat-driven guesses. Pass the socket as _responseSocket so the page
        // gets a 'guess-result' event for immediate input feedback.
        socket.on('guess', async (data) => {
            const admitted = await authorizeBrowserGuess(socket, data, 'session');
            if (!admitted) return;
            const { word } = admitted;
            // Premium gate (2026-07-31): page play in a streamer room is
            // Donor-only too. TikTok/Discord chat play-along is unaffected —
            // those guesses arrive via handleSessionChat from the relay client,
            // never through this socket.

            handleSessionChat({
                streamerHandle: sessionHandle,
                message: word,
                platform: admitted.platform,
                user: {
                    displayName: admitted.displayName,
                    username: admitted.displayName,
                    userId: admitted.platformUserId,
                    profilePic: admitted.profilePic,
                },
                _responseSocket: socket,
            }).catch(() => {});
        });
        socket.on('disconnect', () => {});
        return;
    }

    // Public-game socket — join 'public' room so public broadcasts can be
    // scoped to public clients only, not leaking into session-room sockets.
    socket.join('public');
    // Don't count OBS browser sources / admin dashboards toward connectedPlayers.
    socket._isObsSocket = /OBS/i.test(socket.handshake?.headers?.['user-agent'] || '');
    if (!socket._isObsSocket) connectedPlayers++;
    // Send current game state on connect
    if (game) {
        socket.emit('game-state', { ...game.getState(), jackpot: calculateJackpot(), jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy });
    }

    // Admin auth via socket
    socket.on('admin-auth', (key) => {
        if (key === ADMIN_SECRET) socket.isAdmin = true;
    });

    socket.on('guess', async (data) => {
        if (!game) return socket.emit('guess-error', { error: 'No active game' });

        const admitted = await authorizeBrowserGuess(socket, data);
        if (!admitted) return;
        const { word, platform, platformUserId, displayName, profilePic } = admitted;
        gameShared.reportSocketIP(socket, platform || 'web', platformUserId, 'erectangled');
        retireStaleRound();
        const result = guessMpDurably(game,
            word,
            platform || 'web',
            platformUserId || socket.id,
            displayName || 'Anonymous',
            displayName || 'Anonymous',
            profilePic,
            false,
            // Web players: perks resolved by the premium gate above.
            socket._wtPerks || {}
        );

        if (result.result === 'storage_unavailable') return socket.emit('guess-error', { error: result.error });

        // Emit result to the guessing player
        socket.emit('guess-result', result);

        if (result.result === 'correct') {
            // Broadcast updated state to ALL connected clients
            const updatedStateWS = { ...game.getState(), jackpot: calculateJackpot(), jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy };
            io.to('public').emit('game-state', updatedStateWS);
            broadcastSSE('game-state', updatedStateWS);

            // Broadcast word-found for OBS overlay animations
            const wordFoundData = {
                word: result.word,
                cells: result.cells,
                isRare: result.isRare,
                isHidden: result.isHidden,
                isThreeLetter: result.isThreeLetter,
                letterRarityBonus: result.letterRarityBonus || 0,
                letterRarityTierCounts: result.letterRarityTierCounts || null,
                wordLengthBonus: result.wordLengthBonus || 0,
                displayName: displayName || 'Anonymous',
                profilePic: profilePic || null,
                platform: platform || 'web',
                platformUserId: platformUserId || null,
                isFanClub: !!(socket._wtPerks && socket._wtPerks.isFanClub),
                isSuperfan: !!(socket._wtPerks && socket._wtPerks.isSuperfan),
                isDonor: !!(socket._wtPerks && socket._wtPerks.isDonor),
                // Ring advancement info
                ringAdvanced: result.ringAdvanced || false,
                newRevealedCells: result.newRevealedCells || [],
                currentRing: result.currentRing,
                totalRings: result.totalRings,
                ringPhase: result.ringPhase,
                refreshedLetters: result.refreshedLetters || {},
                isFinalRing: result.isFinalRing || false,
                ringCommonTotal: result.ringCommonTotal,
                ringCommonFound: result.ringCommonFound
            };
            io.to('public').emit('word-found', wordFoundData);
            broadcastSSE('word-found', wordFoundData);
            // The accepted state is already durable; update only its SQLite mirror.
            saveCurrentGameState({ mirrorOnly: true });

            // Send coin reward (matches point tiers) + letter rarity bonus
            const baseCoin = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const coinAmount = baseCoin + (result.letterRarityBonus || 0) + (result.wordLengthBonus || 0);
            sendCoinReward(platform || 'web', platformUserId || socket.id, displayName || 'Anonymous', coinAmount, 'word', { word });
            reportLibraryWord(platform || 'web', platformUserId || socket.id, word, 'erectangled', socket, displayName);

            // Check completion
            if (result.isComplete) {
                handleGameComplete();
            }
        }
    });

    socket.on('disconnect', () => {
        if (!socket._isObsSocket) connectedPlayers--;
    });
});

// ─── Jackpot System ──────────────────────────────────────────────────────────

function calculateJackpot() {
    if (gameCompleted) { const completed = mpActions.recordFor(game)?.completion; if (completed) return completed.rawAmount; }
    if (!jackpotSettings.enabled) return jackpotSettings.base;
    const wordCount = game ? game.foundCommon.size : 0;
    const guessBonus = wordCount * jackpotSettings.perGuess;
    const elapsed = (Date.now() - gameStartTime) / 1000;
    const timeBonus = Math.floor(elapsed) * jackpotSettings.perSecond;
    return Math.min(jackpotSettings.base + guessBonus + timeBonus, jackpotSettings.max);
}

function startJackpotBroadcast() {
    stopJackpotBroadcast();
    jackpotBroadcastTimer = setInterval(() => {
        io.to('public').emit('jackpot-update', { jackpot: calculateJackpot() });
    }, 1000);
}

function stopJackpotBroadcast() {
    if (jackpotBroadcastTimer) {
        clearInterval(jackpotBroadcastTimer);
        jackpotBroadcastTimer = null;
    }
}

// ─── Game Management ────────────────────────────────────────────────────────

function startNewGame(settings) {
    const previous = { game, gameCompleted, isDaily, isWeekly, dailyPlayed, dailyEnabled: jackpotSettings.dailyEnabled, gameStartTime };
    try {
    if (newGameTimer) {
        clearTimeout(newGameTimer);
        newGameTimer = null;
    }

    gameCompleted = false;

    game = new Game();
    isDaily = false;
    isWeekly = false;

    // Priority 1: Daily puzzle (if dailyEnabled and not yet played today)
    if (jackpotSettings.dailyEnabled && !dailyPlayed && dailyWord && dailyWord.date === gameShared.getEdmontonDate()) {
        game.initializeAroundWord(dailyWord.word, 9, 7, wordlist.getTrie(), wordlist.getTargetSet(), { minCommon: 40, maxCommon: 80, frequencyMap: wordlist.getFrequencyMap() });
        advancePastInitialRing(game);
        isDaily = true;
        dailyPlayed = true;
        jackpotSettings.dailyEnabled = false;
        console.log(`[Game] Daily puzzle: 9x7 built around "${dailyWord.word}"`);
    }
    // Priority 2: Unplayed puzzle from pool only when explicitly requested.
    // Normal MP should prefer fresh random boards by default.
    else if (settings.usePool === true && puzzles.length > 0 && !settings.random && !settings.rows && !settings.cols) {
        // Only use MP-sized grids (9x7+) — skip small SP dailies (6x4)
        const mpPuzzles = puzzles.filter(p => (p.rows || 0) >= 9 && (p.cols || 0) >= 7);
        const pool = mpPuzzles.length > 0 ? mpPuzzles : puzzles;
        // Find the next unplayed puzzle
        let found = false;
        for (let i = 0; i < pool.length; i++) {
            const idx = (currentPuzzleIndex + i) % pool.length;
            const puzzle = pool[idx];
            const pid = getTrackablePuzzleId(puzzle, idx);
            if (!pid || !playedPuzzleIds.has(pid)) {
                currentPuzzleIndex = (idx + 1) % pool.length;
                game.initializeFromPuzzle({ ...puzzle, id: pid || puzzle.id }, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
                found = true;
                break;
            }
        }
        if (!found) {
            // All puzzles played — reset tracking and start over
            playedPuzzleIds.clear();
            savePlayedPuzzleIds();
            const puzzle = pool[currentPuzzleIndex % pool.length];
            currentPuzzleIndex = (currentPuzzleIndex + 1) % pool.length;
            const fallbackIdx = (currentPuzzleIndex - 1 + pool.length) % pool.length;
            const pid = getTrackablePuzzleId(puzzle, fallbackIdx);
            game.initializeFromPuzzle({ ...puzzle, id: pid || puzzle.id }, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
        }
    } else {
        // Random game — custom size or fallback (default 9 rows x 7 cols)
        const effectiveSettings = (settings && Object.keys(settings).length > 0) ? settings : lastMpGameSettings;
        const rows = effectiveSettings.rows || 9;
        const cols = effectiveSettings.cols || 7;
        const minWordLength = effectiveSettings.minWordLength || 3;
        // Pre-generated during the previous round when possible, so the new
        // board is handed over instantly instead of freezing the server ~5s.
        game = boardPool.takeOrBuild(wordlist, rows, cols, minWordLength);
    }

    gameStartTime = Date.now();
    game.startTime = gameStartTime;
    saveCurrentGameState();
    if (isDaily) dailyRounds.consume(dailyWord.date);

    gameStartTime = Date.now();
    startJackpotBroadcast();

    const newGameState = { ...game.getState(), jackpot: calculateJackpot(), jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy };
    io.to('public').emit('new-game', newGameState);
    broadcastSSE('new-game', newGameState);
    sassie.sendContext(`New erecTangled game started! ${game.rows}x${game.cols} grid, ${game.commonWords.size} common words to find, ${game.rings.length} rings to unlock.${isDaily ? ' This is the DAILY puzzle!' : ''}`);
    console.log(`[Game] New game: ${game.rows}x${game.cols}, ${game.commonWords.size} common + ${game.rareWords.size} rare + ${game.threeLetterWords.size} three-letter words${game.puzzleName ? ` (puzzle: ${game.puzzleName})` : ''}${isDaily ? ' [DAILY]' : ''}`);

    } catch (error) {
        let durable = false; try { durable = !!mpActions.recordFor(game); } catch {}
        if (!durable) { game = previous.game; gameCompleted = previous.gameCompleted; isDaily = previous.isDaily; isWeekly = previous.isWeekly; dailyPlayed = previous.dailyPlayed; jackpotSettings.dailyEnabled = previous.dailyEnabled; gameStartTime = previous.gameStartTime; }
        throw error;
    }
}

// ─── Stale round retirement ─────────────────────────────────────────────────
// A public round only ends when its LAST required word is found, and the board
// is only played while the game is on stream. Rounds were running 14-45h and
// piling up 100+ found words, so anything ordinary a viewer typed came back
// "already found" while the leftovers had already defeated everyone who tried.
//
// Retire on resume rather than on a timer: the check runs when a guess arrives,
// so an abandoned board is replaced the moment play picks up again and nothing
// churns boards while nobody is watching.
const STALE_ROUND_MS = 12 * 60 * 60 * 1000;

// Newest of the round's start and its most recent find.
function lastRoundProgressAt() {
    if (!game) return 0;
    let latest = game.startTime ? new Date(game.startTime).getTime() : 0;
    if (!Number.isFinite(latest)) latest = 0;
    if (game.foundWords) {
        for (const info of game.foundWords.values()) {
            const t = Number(info && info.timestamp) || 0;
            if (t > latest) latest = t;
        }
    }
    return latest;
}

// Call before handling a public guess. Returns true if the board was replaced —
// the caller carries on and the guess is judged against the fresh grid, which
// the client has already been told about via 'new-game'.
function retireStaleRound() {
    if (!game || isDaily) return false;   // daily boards are admin-owned
    if (gameCompleted) return false;      // the completion flow owns that restart
    const last = lastRoundProgressAt();
    if (!last || Date.now() - last < STALE_ROUND_MS) return false;
    console.log(`[Game] Round idle ${((Date.now() - last) / 3600000).toFixed(1)}h at ${game.foundCommon.size}/${game.commonWords.size} — retiring it for a fresh board`);
    startNewGame({});
    return true;
}

function handleGameComplete() {
    if (gameCompleted) return;
    gameCompleted = true;
    const shouldAutoRestart = !isDaily;

    try {
        // --- Jackpot payout ---
        const rawJackpot = calculateJackpot();
        const jackpotAmount = mpActions.recordFor(game)?.completion?.amount ?? Math.round(rawJackpot * currentFrenzy.multiplier);
        const topPlayers = game.getTopPlayers();
        let jackpotWinner = null;

        if (jackpotSettings.enabled && topPlayers.length > 0 && jackpotAmount > 0) {
            jackpotWinner = topPlayers[0];
            sendCoinReward(
                jackpotWinner.platform,
                jackpotWinner.platformUserId,
                jackpotWinner.displayName,
                jackpotAmount,
                isDaily ? 'mp-daily-win' : 'win',
                { guessCount: jackpotWinner.score }
            );
            console.log(`[Game] Jackpot of ${jackpotAmount} coins${currentFrenzy.multiplier > 1 ? ` (${currentFrenzy.multiplier}x frenzy)` : ''} awarded to ${jackpotWinner.displayName}`);

            // Emit daily-win to Chat Relay if this was the daily puzzle
            if (isDaily && relaySocket && relaySocket.connected) {
                relaySocket.emit('daily-win', {
                    game: 'erectangled',
                    winner: jackpotWinner.displayName,
                    platform: jackpotWinner.platform,
                    platformUserId: jackpotWinner.platformUserId,
                    amount: jackpotAmount
                });
            }
            io.to('public').emit('jackpot-won', {
                winner: jackpotWinner.displayName,
                amount: jackpotAmount,
                platform: jackpotWinner.platform,
                platformUserId: jackpotWinner.platformUserId,
                isDaily
            });
        }
        stopJackpotBroadcast();
        // --- End jackpot payout ---

        // Save daily puzzle to pool for SP replay
        if (isDaily) {
            savePuzzleToPool(game);
        }

        // Track played puzzle ID
        if (game.puzzleId !== null && game.puzzleId !== undefined && game.puzzleId !== '' && game.puzzleId !== 'null') {
            playedPuzzleIds.add(String(game.puzzleId));
            savePlayedPuzzleIds();
        }

        console.log('[Game] All common words found! Starting the next round now...');

        // Sassie game complete reaction
        const winner = topPlayers[0];
        if (winner) {
            sassie.triggerReaction(`${winner.displayName} wins erecTangled with ${winner.score} points! ${jackpotAmount > 0 ? `Jackpot: ${jackpotAmount.toLocaleString()} coins!` : ''}`);
        }

        // Save completed game to history
        db.saveGameHistory({
            grid: game.grid,
            rows: game.rows,
            cols: game.cols,
            totalWords: game.allWords.size,
            wordsFound: game.foundWords.size,
            participants: game.getParticipants(),
            startedAt: game.startTime,
            endedAt: Date.now(),
            puzzleId: game.puzzleId
        });

        const finalState = game.getState();
        const gameOverPayload = {
            countdown: 0, // no wait — the win card is shown over the new round
            stats: { ...finalState, jackpot: jackpotAmount, jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy },
            jackpotWinner: jackpotWinner ? { displayName: jackpotWinner.displayName, amount: jackpotAmount, platform: jackpotWinner.platform } : null
        };
        io.to('public').emit('game-over', gameOverPayload);
        if (relaySocket && relaySocket.connected && jackpotWinner) {
            relaySocket.emit('game-win', {
                game: 'erectangled', gameName: 'erecTangled',
                word: null,
                winner: {
                    displayName: jackpotWinner.displayName,
                    profilePic: jackpotWinner.profilePic || null,
                    platform: jackpotWinner.platform,
                    platformUserId: jackpotWinner.platformUserId || null,
                    linkedDiscord: jackpotWinner.linkedDiscord || null,
                    cosmetics: jackpotWinner.cosmetics || null,
                },
                jackpot: jackpotAmount,
                guessCount: jackpotWinner.score || 0,
                isDaily,
                rows: finalState.rows,
                cols: finalState.cols,
                percentage: finalState.percentage,
                puzzleName: finalState.puzzleName,
                puzzleTheme: finalState.puzzleTheme,
                commonCount: finalState.commonCount,
                rareCount: finalState.rareCount,
                hiddenCount: finalState.hiddenCount,
                threeLetterCount: finalState.threeLetterCount,
                foundCommonCount: finalState.foundCommonCount,
                foundRareCount: finalState.foundRareCount,
                foundHiddenCount: finalState.foundHiddenCount,
                foundThreeLetterCount: finalState.foundThreeLetterCount,
                playerCount: Array.isArray(finalState.topPlayers) ? finalState.topPlayers.length : undefined,
                leaderName: jackpotWinner.displayName,
                leaderScore: jackpotWinner.score || 0
            });
        }
        broadcastSSE('game-over', gameOverPayload);
        try { reportRoundToWordTycoon(game); } catch (e) { console.log(`[Erectangled] report to WT failed: ${e.message}`); }
    } catch (err) {
        console.error('[Game] Completion flow error:', err.message);
    }

    // Start the next round immediately — the win card is displayed over it.
    // Runs last so every payload above is built from the finished game, and
    // reward/relay/history failures can't stop the game from moving on.
    if (shouldAutoRestart) {
        try {
            startNewGame(lastMpGameSettings);
        } catch (err) {
            console.error('[Game] Auto-restart failed:', err.message);
        }
    }

    if (isDaily) {
        console.log('[Game] Daily game completed — waiting for admin to start next game');
    }
}

async function sendCoinReward(platform, userId, displayName, coins, event = 'word', extras = {}, activeGame = game) {
    return mpActions.sendLegacyReward(platform, userId, displayName, coins || 100, event, extras, activeGame);
}

function reportLibraryWord(platform, userId, word, gameName, socket, username) {
    gameShared.reportLibraryWord(platform, userId, word, gameName || 'erectangled', username || userId, username || userId, socket);
}

// ─── Streamer-private session chat path ─────────────────────────────────────
function _sessionRoom(handle) { return `erectangled:session:${String(handle || '').toLowerCase()}`; }

async function handleSessionChat(msg) {
    const handle = String(msg.streamerHandle || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
    // Per-streamer blocklist: silently drop chat from blocked viewers.
    {
      const _u = msg.user || {};
      const _platform = String(msg.platform || _u.platform || '').toLowerCase();
      const _pid = String(_u.id || _u.userId || _u.uniqueId || '');
      if (_platform && _pid && _isStreamerBlocking(handle, _platform, _pid)) return;
    }

    const raw = (msg.message || '').trim();
    if (!raw || raw.startsWith('/') || raw.startsWith('!') || raw.startsWith('@')) return;
    // Batch guessing — process every space-separated token as its own guess.
    // Cap at 20 to stop chat-flood abuse (typical batch is 1-5 words).
    const BATCH_CAP = 20;
    const words = raw.split(/\s+/).slice(0, BATCH_CAP)
        .map(t => t.replace(/[./]|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, ''))
        .filter(w => w);
    if (!words.length) return;

    const user = msg.user || {};
    const username = user.displayName || user.username || user.nickname || 'anonymous';
    const profileImage = user.profilePic || user.profilePictureUrl || user.profileImageUrl || user.avatarUrl || user.avatar || user.image || null;
    const rawPlatformUserId = user.userId || user.id || user.uniqueId || username;
    const linkedDiscord = msg.linkedDiscord || null;
    const platformUserId = linkedDiscord || rawPlatformUserId;
    const effectivePlatform = linkedDiscord ? 'web' : (msg.platform || 'unknown');

    let session;
    try {
        session = await sessionManager.getOrCreateSession({ handle, sessionId: msg.streamSession || null, wordlist, settings: _sessionSettingsFor(handle) });
    } catch (err) {
        console.warn(`[Session] "${handle}" create failed:`, err.message);
        return;
    }
    if (!session || !session.game) return;

    const room = _sessionRoom(handle);
    const _chatBadges = Array.isArray(user.badges) ? user.badges : [];
    const _isFanClubChat = _chatBadges.indexOf('fan-club') !== -1;
    const _chatPerks = {
        isFanClub: _isFanClubChat,
        isSuperfan: _chatBadges.indexOf('superfan') !== -1,
        isDonor: _chatBadges.indexOf('donor') !== -1
    };
    for (const word of words) {  // batch-guess loop
    const result = guessMpDurably(session.game, word, effectivePlatform, platformUserId, username, username, profileImage, _isFanClubChat, _chatPerks);
    if (result.result === 'storage_unavailable') { msg._responseSocket?.emit('guess-error', { error: result.error }); return; }
    // Echo immediate feedback to the submitting socket so on-page input shows
    // correct/incorrect/already_found state without waiting for room-wide
    // broadcasts. msg._responseSocket is set when the guess came in via the
    // session-page socket (rather than a TikTok-chat relay event).
    if (msg._responseSocket) {
        try { msg._responseSocket.emit('guess-result', result); } catch (_) {}
    }
    // Any successful or rejected guess mutates session.game state (foundWords,
    // playerScores, recentGuessTags, etc.) — persist after every guess so a
    // PM2 restart doesn't lose the streamer's round.
    sessionManager.scheduleSave();

    if (result.result === 'correct') {
        const updatedState = sessionManager.buildSessionState(session, jackpotSettings);
        io.to(room).emit('game-state', updatedState);
        io.to(room).emit('word-found', {
            word: result.word,
            cells: result.cells,
            isRare: result.isRare,
            isHidden: result.isHidden,
            isThreeLetter: result.isThreeLetter,
            letterRarityBonus: result.letterRarityBonus || 0,
            wordLengthBonus: result.wordLengthBonus || 0,
            displayName: username || 'Anonymous',
            profilePic: profileImage || null,
            platform: effectivePlatform,
            platformUserId: platformUserId || null,
            isFanClub: _isFanClubChat,
            isSuperfan: _chatPerks.isSuperfan,
            isDonor: _chatPerks.isDonor,
            ringAdvanced: result.ringAdvanced || false,
            newRevealedCells: result.newRevealedCells || [],
            currentRing: result.currentRing,
            totalRings: result.totalRings,
            ringPhase: result.ringPhase,
            refreshedLetters: result.refreshedLetters || {},
            isFinalRing: result.isFinalRing || false,
            ringCommonTotal: result.ringCommonTotal,
            ringCommonFound: result.ringCommonFound,
        });

        {
            const baseCoin = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const coinAmount = baseCoin + (result.letterRarityBonus || 0) + (result.wordLengthBonus || 0);
            sendCoinReward(effectivePlatform, platformUserId, username, coinAmount, 'word', { word }, session.game);
            reportLibraryWord(effectivePlatform, platformUserId, word, 'erectangled', null, username);
        }

        if (result.isComplete) {
            handleSessionGameComplete(session);
        }
    } else if (result.result === 'incorrect' || result.result === 'already_found') {
        io.to(room).emit('chat-guess', { word: result.word, result: result.result });
    }
    }  // end batch-guess loop
}

function handleSessionGameComplete(session) {
    if (!session || !session.game || session.isComplete) return;
    session.isComplete = true;
    const room = _sessionRoom(session.handle);

    // Stream rounds count toward /goat ELO + rounds played, same as public.
    reportRoundToWordTycoon(session.game).catch(e => console.log('[ErecTangled] session ELO report failed: ' + e.message));

    try {
        const jackpotAmount = mpActions.recordFor(session.game)?.completion?.amount ?? sessionManager.calculateSessionJackpot(session.handle, jackpotSettings);
        const topPlayers = session.game.getTopPlayers ? session.game.getTopPlayers() : [];
        let jackpotWinner = null;

        if (jackpotSettings.enabled && topPlayers.length > 0 && jackpotAmount > 0) {
            jackpotWinner = topPlayers[0];
            sendCoinReward(jackpotWinner.platform, jackpotWinner.platformUserId, jackpotWinner.displayName, jackpotAmount, 'win', { guessCount: jackpotWinner.score }, session.game);
            console.log(`[Session] "${session.handle}" jackpot ${jackpotAmount} → ${jackpotWinner.displayName}`);
            io.to(room).emit('jackpot-won', {
                winner: jackpotWinner.displayName,
                amount: jackpotAmount,
                platform: jackpotWinner.platform,
                platformUserId: jackpotWinner.platformUserId,
                isDaily: false,
            });
        }

        const finalState = session.game.getState();
        io.to(room).emit('game-over', {
            countdown: 0, // no wait — the win card is shown over the new round
            stats: { ...finalState, jackpot: jackpotAmount, jackpotEnabled: jackpotSettings.enabled, isDaily: false, frenzy: { multiplier: 1, activeTappers: 0 } },
            jackpotWinner: jackpotWinner ? { displayName: jackpotWinner.displayName, amount: jackpotAmount, platform: jackpotWinner.platform } : null,
        });

        // Per-streamer overlay: chat-relay routes wins with streamerHandle to
        // the streamer-win:<handle> room only.
        if (jackpotWinner) {
            const top10 = topPlayers.slice(0, 10).map((p) => ({
                displayName: p.displayName,
                profilePic: p.profileImage || p.profilePic || null,
                platform: p.platform,
                platformUserId: p.platformUserId,
                linkedDiscord: p.linkedDiscord || null,
                points: p.score || 0,
                cosmetics: p.cosmetics || null,
            }));
            const _winPayload = {
                game: 'erectangled', gameName: 'erecTangled',
                word: null,
                winner: {
                    displayName: jackpotWinner.displayName,
                    profilePic: jackpotWinner.profilePic || null,
                    platform: jackpotWinner.platform,
                    platformUserId: jackpotWinner.platformUserId || null,
                    linkedDiscord: jackpotWinner.linkedDiscord || null,
                    cosmetics: jackpotWinner.cosmetics || null,
                },
                jackpot: jackpotAmount,
                guessCount: jackpotWinner.score || 0,
                isDaily: false,
                topPlayers: top10,
                streamerHandle: session.handle,
            };
            io.to(room).emit('game-win', _winPayload);
            if (relaySocket && relaySocket.connected) {
                relaySocket.emit('game-win', _winPayload);
            }
        }

        // Auto-restart with a fresh grid immediately — the win card is shown
        // over the new round rather than gating it behind a countdown.
        try {
            // Re-reads the streamer's board size every round, so a size change
            // from the dashboard lands here without ending the current round.
            sessionManager.restartSession(session, wordlist, _sessionSettingsFor(session.handle));
            io.to(room).emit('new-game', sessionManager.buildSessionState(session, jackpotSettings));
            console.log(`[Session] "${session.handle}" auto-restarted: ${session.game.rows}x${session.game.cols}`);
        } catch (err) {
            console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
        }
    } catch (err) {
        console.error(`[Session] "${session.handle}" completion error:`, err.message);
    }
}

// ─── Chat Relay Connection ──────────────────────────────────────────────────

function connectToChatRelay() {
    console.log(`[ChatRelay] Connecting to ${CHAT_RELAY_URL}...`);
    relaySocket = gameShared.createRelayClient({
        id: 'erectangled',
        name: 'eRecTangled',
        port: PORT,
        apiSecret: ADMIN_SECRET,
        relayUrl: CHAT_RELAY_URL,
        reconnectionDelay: 3000
    }, {
        onChat: (msg) => {
        if (!msg || !msg.message) return;

        // Streamer-private session: route to per-streamer game state instead
        // of the public game. chat-relay tags chat events with streamerHandle
        // when they originate from a streamer with sessions enabled.
        if (msg.streamerHandle) {
            handleSessionChat(msg);
            return;
        }
        if (!game) return;

        const raw = msg.message.trim();
        // Skip commands, empty messages, and @-mentions (join notifications / replies)
        if (!raw || raw.startsWith('/') || raw.startsWith('!') || raw.startsWith('@')) return;
        // Batch guessing — process every space-separated token as its own guess.
        const BATCH_CAP = 20;
        const words = raw.split(/\s+/).slice(0, BATCH_CAP)
            .map(t => t.replace(/[./]|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, ''))
            .filter(w => w);
        if (!words.length) return;

        const user = msg.user || {};
        const username = user.displayName || user.username || user.nickname || 'anonymous';
        const profileImage = user.profilePic || user.profilePictureUrl || user.profileImageUrl || user.avatarUrl || user.avatar || user.image || null;
        const rawPlatformUserId = user.userId || user.id || user.uniqueId || username;

        // If the user has a linked Discord account, use that as the canonical identity.
        // This prevents duplicate playerScores entries when the same person plays via
        // mp.html (Discord ID, platform: "web") AND types in TikTok/YouTube chat.
        const linkedDiscord = msg.linkedDiscord || null;
        const platformUserId = linkedDiscord || rawPlatformUserId;
        const effectivePlatform = linkedDiscord ? 'web' : (msg.platform || 'unknown');

        const _chatBadges = Array.isArray(user.badges) ? user.badges : [];
        const _isFanClubChat = _chatBadges.indexOf('fan-club') !== -1;
        const _chatPerks = {
            isFanClub: _isFanClubChat,
            isSuperfan: _chatBadges.indexOf('superfan') !== -1,
            isDonor: _chatBadges.indexOf('donor') !== -1
        };
        // Once for the whole message, not per word — a batch must not be split
        // across two different boards.
        retireStaleRound();
        for (const word of words) {  // batch-guess loop
        const result = guessMpDurably(game, word, effectivePlatform, platformUserId, username, username, profileImage, _isFanClubChat, _chatPerks);

        if (result.result === 'correct') {
            // Broadcast updated state to all Socket.IO clients
            const updatedState = { ...game.getState(), jackpot: calculateJackpot(), jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy };
            io.to('public').emit('game-state', updatedState);
            broadcastSSE('game-state', updatedState);

            // Broadcast word-found for OBS overlay animations
            const wordFoundDataRelay = {
                word: result.word,
                cells: result.cells,
                isRare: result.isRare,
                isHidden: result.isHidden,
                isThreeLetter: result.isThreeLetter,
                letterRarityBonus: result.letterRarityBonus || 0,
                wordLengthBonus: result.wordLengthBonus || 0,
                displayName: username || 'Anonymous',
                profilePic: profileImage || null,
                platform: effectivePlatform,
                platformUserId: platformUserId || null,
                isFanClub: _isFanClubChat,
                isSuperfan: _chatPerks.isSuperfan,
                isDonor: _chatPerks.isDonor,
                // Ring advancement info
                ringAdvanced: result.ringAdvanced || false,
                newRevealedCells: result.newRevealedCells || [],
                currentRing: result.currentRing,
                totalRings: result.totalRings,
                ringPhase: result.ringPhase,
                refreshedLetters: result.refreshedLetters || {},
                isFinalRing: result.isFinalRing || false,
                ringCommonTotal: result.ringCommonTotal,
                ringCommonFound: result.ringCommonFound
            };
            io.to('public').emit('word-found', wordFoundDataRelay);
            broadcastSSE('word-found', wordFoundDataRelay);
            // The accepted state is already durable; update only its SQLite mirror.
            saveCurrentGameState({ mirrorOnly: true });

            // Send coin reward (matches point tiers) + letter rarity bonus
            const baseCoin2 = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const coinAmount = baseCoin2 + (result.letterRarityBonus || 0) + (result.wordLengthBonus || 0);
            sendCoinReward(effectivePlatform, platformUserId, username, coinAmount, 'word', { word });
            reportLibraryWord(effectivePlatform, platformUserId, word, 'erectangled', null, username);

            // Check completion
            if (result.isComplete) {
                handleGameComplete();
            }
        } else if (result.result === 'incorrect' || result.result === 'already_found') {
            io.to('public').emit('chat-guess', { word: result.word, result: result.result });
            broadcastSSE('chat-guess', { word: result.word, result: result.result });
        }
        }  // end batch-guess loop
        },
        onFrenzyUpdate: (data) => {
        if (data && typeof data.multiplier === 'number') {
            currentFrenzy = { multiplier: data.multiplier, activeTappers: data.activeTappers || 0 };
            io.to('public').emit('frenzy-update', currentFrenzy);
            broadcastSSE('frenzy-update', currentFrenzy);
        }
        },
        onCosmeticsUpdated: (data) => {
        if (data && data.platform && data.platformUserId) {
            gameShared.invalidateCosmetics(data.platform, data.platformUserId, data.equipped);
            // Forward to connected overlay clients so they invalidate client-side cache
            io.emit('cosmetics-updated', {
                platform: data.platform,
                platformUserId: data.platformUserId,
                equipped: data.equipped
            });
        }
        },
        onActivateDaily: async () => {
        console.log('[eRecTangled] activate-daily received from Chat Relay');
        await fetchDailyWord();
        dailyRounds.reset(gameShared.getEdmontonDate());
        dailyPlayed = false;
        jackpotSettings.dailyEnabled = true;
        if (!game || newGameTimer || isCurrentMpGameComplete(game)) {
            if (newGameTimer) { clearTimeout(newGameTimer); newGameTimer = null; }
            startNewGame(lastMpGameSettings);
        } else {
            console.log('[eRecTangled] Game in progress — daily will start after current game ends');
        }
        }
    });

    let lastSpotifyTrack = null;
    relaySocket.on('spotify-now-playing', (data) => {
        lastSpotifyState = data;
        broadcastSSE('spotify-now-playing', data);
        // Notify Sassie when a new track starts playing
        if (data.isPlaying && data.track && data.track !== lastSpotifyTrack) {
            lastSpotifyTrack = data.track;
            const mins = Math.floor((data.duration || 0) / 60000);
            const secs = String(Math.floor(((data.duration || 0) % 60000) / 1000)).padStart(2, '0');
            const tempoStr = data.tempo ? `, ${data.tempo} BPM` : '';
            sassie.sendContext(`Now playing: "${data.track}" by ${data.artist} (${mins}:${secs}${tempoStr})`);
        }
        if (!data.isPlaying) lastSpotifyTrack = null;
    });
}

// ─── Startup ────────────────────────────────────────────────────────────────

async function startup() {
    console.log('========================================');
    console.log('  eRecTangled - Starting Up');
    console.log('========================================');

    await db.init();
    console.log('[DB] Database initialized');

    await wordlist.init();
    console.log(`[WordList] ${wordlist.getWordCount()} words loaded`);

    // Load pre-made puzzles
    if (fs.existsSync(puzzlesPath)) {
        try {
            puzzles = JSON.parse(fs.readFileSync(puzzlesPath, 'utf-8'));
            console.log(`[Puzzles] Loaded ${puzzles.length} puzzles`);
        } catch (err) {
            console.log(`[Puzzles] Failed to load puzzles.json: ${err.message}`);
            puzzles = [];
        }
    } else {
        console.log('[Puzzles] No puzzles.json found — using random grids');
    }

    // Load played puzzle tracking before picking the startup MP board.
    loadPlayedPuzzleIds();

    // Restore persisted MP settings (custom grid sizes survive restarts)
    const savedMpSettings = db.loadMpSettings();
    if (savedMpSettings) {
        lastMpGameSettings = savedMpSettings;
        console.log(`[Game] Restored MP settings: ${lastMpGameSettings.rows}x${lastMpGameSettings.cols}`);
    }

    // Try to restore the in-progress game from the database
    const durableMp = mpActions.load('public');
    const savedState = durableMp ? { ...durableMp.record.state, _isDaily: durableMp.record.meta.isDaily, _isWeekly: durableMp.record.meta.isWeekly, _dailyPlayed: durableMp.record.meta.dailyPlayed, _dailyPlayedDate: durableMp.record.meta.dailyPlayedDate, _dailyEnabled: durableMp.record.meta.dailyEnabled } : db.loadGameState();
    let restored = false;
    if (savedState && savedState.grid && savedState.rows && savedState.cols) {
        try {
            game = new Game();
            game.restoreFrom(savedState, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: !!durableMp });
            if (durableMp) mpActions.adopt(game, durableMp.record);
            isDaily = !!savedState._isDaily;
            isWeekly = !!savedState._isWeekly;
            dailyPlayed = dailyRounds.migrateLegacy({ played: !!savedState._dailyPlayed, date: savedState._dailyPlayedDate, startedAt: game.startTime });
            jackpotSettings.dailyEnabled = !!savedState._dailyEnabled;
            gameStartTime = game.startTime || Date.now();
            startJackpotBroadcast();
            restored = true;
            const fc = game.foundCommon ? game.foundCommon.size : 0;
            const tc = game.commonWords ? game.commonWords.size : 0;
            console.log(`[Game] Restored in-progress game: ${game.rows}x${game.cols}, ${fc}/${tc} common found${isDaily ? ' [DAILY]' : ''}`);
        } catch (err) {
            console.error('[Game] Failed to restore saved state, starting fresh:', err.message);
            restored = false;
        }
    }

    if (!restored) {
        isDaily = false;
        jackpotSettings.dailyEnabled = false;
        game = new Game();
        startNewGame(lastMpGameSettings);
    } else if (isCurrentMpGameComplete(game)) {
        if (isDaily || isWeekly) gameCompleted = true;
        else { isDaily = false; jackpotSettings.dailyEnabled = false; startNewGame(lastMpGameSettings); }
    }

    if (!mpActions.recordFor(game)) saveCurrentGameState();
    mpActions.recover();

    // Start jackpot broadcast from the new game's start time
    gameStartTime = game.startTime || Date.now();
    startJackpotBroadcast();

    // Warm the board pool for the default MP size (sessions use the same 9x7),
    // so the first round to end after boot restarts instantly too.
    boardPool.prime(wordlist, lastMpGameSettings.rows || 9, lastMpGameSettings.cols || 7, lastMpGameSettings.minWordLength || 3);

    // Fetch weekly + daily words
    await fetchWeeklyWord();
    await fetchDailyWord();
    setInterval(fetchWeeklyWord, 60 * 60 * 1000); // Refresh hourly
    setInterval(fetchDailyWord, 60 * 60 * 1000);  // Refresh hourly


// Admin: force-end a streamer session round (called by chat-relay on
// /api/streamer/disconnect so the streamer's round doesn't linger in
// memory after they hit Disconnect on the dashboard). Idle sweep would
// also reap it after 4h, but this gives immediate cleanup.
app.post('/api/session/end', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = sessionManager.endSession(handle);
  res.json({ ok: true, had });
});

// Admin: set one streamer's cached board size NOW instead of waiting up to
// 5 minutes for the next /api/streamer-handles poll. The relay calls this the
// instant a streamer saves a size, so both "Restart now" and the next
// round-end auto-restart use the size they just picked — without it, the
// dashboard looks broken: you pick a size, hit Restart now, and get a board
// built from the previous value still sitting in this cache.
//
// The next poll overwrites _streamerSettings wholesale, which is fine: it
// re-reads the same saved value back from the relay.
app.post('/api/session/grid-size', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const rows = Number(req.body && req.body.rows);
  const cols = Number(req.body && req.body.cols);
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return res.status(400).json({ ok: false, error: 'Invalid rows/cols' });
  const cur = _streamerSettings.get(handle) || { disablePlayerPage: false, blockedSet: new Set(), grid: null };
  cur.grid = { rows: Math.round(rows), cols: Math.round(cols) };
  _streamerSettings.set(handle, cur);
  const applied = _sessionSettingsFor(handle);
  console.log(`[Session] "${handle}" board size pushed: ${applied.rows}x${applied.cols}`);
  res.json({ ok: true, rows: applied.rows, cols: applied.cols });
});

// Admin: deal a fresh board for a streamer's live session at their CURRENT
// configured size, without ending the session. Backs the dashboard's
// "Restart now" button next to the board-size picker — a size change
// normally waits for the next natural round end, and this skips that wait.
// Returns restarted:false (still ok:true) when there's no live session; the
// next one is built at the new size regardless.
app.post('/api/session/restart', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const session = sessionManager.getSession(handle);
  if (!session) return res.json({ ok: true, restarted: false });
  try {
    sessionManager.restartSession(session, wordlist, _sessionSettingsFor(handle));
    io.to(_sessionRoom(handle)).emit('new-game', sessionManager.buildSessionState(session, jackpotSettings));
    console.log(`[Session] "${handle}" restarted on request: ${session.game.rows}x${session.game.cols}`);
    return res.json({ ok: true, restarted: true, rows: session.game.rows, cols: session.game.cols });
  } catch (err) {
    console.error(`[Session] "${handle}" restart failed:`, err.message);
    return res.status(500).json({ ok: false, error: 'restart failed' });
  }
});

// Admin: tell the streamer's session viewers that the streamer
// moved to a different game. Emits a `session-redirect` socket
// event into the session room so any open <handle> tab can show
// a 'follow the streamer' modal. Does NOT end the session — the
// streamer might switch back, in which case the existing round
// resumes. Called by chat-relay's /api/streamer/game on switch.
app.post('/api/session/redirect', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(handle, { targetUrl, targetGameName, targetGameId });
  io.to(_sessionRoom(handle)).emit('session-redirect', {
    handle, targetUrl, targetGameName, targetGameId,
  });
  res.json({ ok: true });
});

// Admin: streamer is now active in THIS game — clear any stale
// redirect target so viewers landing on /?session=<handle> aren't
// bounced to wherever the streamer USED to be. Called by chat-
// relay's /api/streamer/game switch handler on the new active game.
app.post('/api/session/clear-redirect', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

    server.listen(PORT, () => {
        console.log(`[Server] eRecTangled running on port ${PORT}`);
        console.log(`[Server] OBS overlay: http://localhost:${PORT}/`);
        console.log(`[Server] SP page: http://localhost:${PORT}/public/sp.html`);
        console.log(`[Server] SSE endpoint: http://localhost:${PORT}/api/events`);
        console.log(`[Server] Command endpoint: POST http://localhost:${PORT}/api/command`);
        console.log(`[Server] Jackpot: ${jackpotSettings.enabled ? 'enabled' : 'disabled'} (base: ${jackpotSettings.base}, max: ${jackpotSettings.max})`);
        console.log('========================================');
        connectToChatRelay();
    });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[eRecTangled] Shutting down...');

    // Save game state
    if (game) {
        saveCurrentGameState();
        console.log('[eRecTangled] Game state saved');
    }

    // Clean up timers and connections
    stopJackpotBroadcast();
    if (newGameTimer) {
        clearTimeout(newGameTimer);
        newGameTimer = null;
    }
    if (relaySocket) relaySocket.disconnect();

    // Close SSE clients
    for (const client of sseClients) {
        client.end();
    }
    sseClients.clear();

    // Close server
    server.close();
    console.log('[eRecTangled] Shutdown complete');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (keeping alive):', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (keeping alive):', reason);
});

startup().catch(err => {
    console.error('[eRecTangled] Startup failed:', err);
    process.exit(1);
});
