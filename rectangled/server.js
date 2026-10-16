try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
// server.js - Express + Socket.IO + game hosting for RecTangled

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

const PORT = process.env.PORT || 3016;
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
const GRID_SIZE_KEY = 'rectangled';
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
const GAME_WORD_POLICY_ID = process.env.GAME_WORD_POLICY_ID || 'rectangled';
const WORD_BANK_GAME_ID = process.env.WORD_BANK_GAME_ID || GAME_WORD_POLICY_ID;
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
const gameWordPolicy = require(path.join(RELAY_DIR, 'src', 'game-word-policy.js'));

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live', 'https://rectangled.live', 'https://www.rectangled.live'];
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
    const r = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.GAME_API_SECRET,
        'x-forwarded-cookie': cookie,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.ok && data.user) {
      return data.user.anchorId || data.user.id || null;
    }
  } catch (e) {
    console.error('[RecTangled] whoami failed:', e.message);
  }
  return null;
}

function getIdentityKey(platform, platformUserId, displayName) {
  if (!platformUserId) return null;
  if (platform === 'web' && /^\d{17,20}$/.test(String(platformUserId))) {
    return `discord:${platformUserId}`;
  }
  if (platform && platformUserId) return `${platform}:${platformUserId}`;
  return `nick:${String(displayName || '').toLowerCase()}`;
}

// ── Premium web-play gate (2026-07-19; streamer rooms + shared impl 2026-07-31) ──
// WEB guessing requires Donor Class / TikTok Super Fan in the public room AND
// on a streamer's player page. The daily/weekly solo (/api/sp/*), relay chat
// and the /stream chat-bridge (non-'web' platform) stay free.
//
// The check itself now lives in chat-relay's game-shared.js so every game
// gates identically. It replaces a local snowflake-shape test that read any
// non-Discord id (gh_/google_/tt_) as logged-out and hard-blocked it even when
// that account's subscription was linked to a Discord one — survivable in the
// public room, but streamer pages are full of exactly those viewers.
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
      body: JSON.stringify({ game: 'rectangled', participants }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[Rectangled] ELO report failed: ${res.status} ${text}`);
    }
  } catch (e) {
    console.log(`[Rectangled] ELO report error: ${e.message}`);
  }
}

let game = null;
let sseClients = new Set();
let relaySocket = null;
let newGameTimer = null;
let gameCompleted = false;

// Jackpot configuration (configurable via /api/jackpot/settings)
let jackpotSettings = {
    enabled: true,
    dailyEnabled: false,
    base: 200,
    perGuess: 15,   // per word found
    perSecond: 5,
    max: 100000
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
let spDailyGame  = null;    // Template Game instance for SP daily — cloned per session
let spWeeklyCache = null;   // { weekStart, grid, rows, cols, name, theme, commonCount, rareCount, hiddenCount }
let spWeeklyGame  = null;   // Template Game instance for SP weekly — cloned per session
let playedPuzzleIds = new Set();  // track played pool puzzle IDs this session
const playedPuzzlesPath = path.join(__dirname, 'data', 'played-puzzles.json');

// ─── Per-session SP game instances ───────────────────────────────────────────
// Each user gets their own Game instance keyed by ${mode}:${sid} so one user's
// guesses don't corrupt another user's state. Previously rectangled used a
// single global `spCurrentGame`, which meant loading a new puzzle (random,
// archive, weekly) from browser A would reroute browser B's guesses to the
// newly loaded grid, rejecting valid words.
const spSessionJournal = require('./src/sp-session-journal').createSpSessionJournal({ directory: path.join(__dirname, 'data', 'sp-sessions') });
const spPuzzleJournal = require('./src/sp-session-journal').createSpSessionJournal({ directory: path.join(__dirname, 'data', 'sp-templates'), ttl: 14 * 24 * 60 * 60 * 1000, max: 2 });
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
    const context = spContext(mode);
    if (!entry) {
        if ((mode === 'daily' || mode === 'weekly') && !context) return null;
        const saved = spSessionJournal.get(sid, mode, context); if (!saved) return null;
        const restored = new Game();
        restored.restoreFrom(saved, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
        spSessionOwners.set(restored, { sid, mode, context });
        spSessions.set(key, { game: restored, lastAccess: now }); pruneSpSessions(); return restored;
    }
    const owner = spSessionOwners.get(entry.game);
    if (context && owner && JSON.stringify(owner.context) !== JSON.stringify(context)) { spSessions.delete(key); return null; }
    if (now - entry.lastAccess >= SP_SESSION_TTL) { spSessions.delete(key); return null; }
    spSessionJournal.touch(sid, mode);
    entry.lastAccess = now;
    spSessions.delete(key); spSessions.set(key, entry);
    return entry.game;
}

function setSpSession(sid, mode, game) {
    if (!sid) return;
    const key = `${mode}:${sid}`;
    if (typeof game.saveState === 'function') {
        const context = spContext(mode);
        spSessionJournal.save(sid, mode, game.saveState({ exact: true }), context);
        spSessionOwners.set(game, { sid, mode, context });
    }
    spSessions.delete(key); spSessions.set(key, { game, lastAccess: Date.now() });
    pruneSpSessions();
}

const spSessionSweep = setInterval(pruneSpSessions, 5 * 60 * 1000);
if (spSessionSweep.unref) spSessionSweep.unref();

// Clone a template Game into a fresh per-session instance (same grid, no
// found words). Used by daily/weekly to give each player an independent
// instance while sharing the generated puzzle.
function cloneSpGame(templateGame) {
    if (!templateGame) return null;
    const g = new Game();
    g.initializeFromPuzzle({
        grid: templateGame.grid.map(row => row.slice()),
        id: templateGame.puzzleId,
        name: templateGame.puzzleName,
        theme: templateGame.puzzleTheme,
        minWordLength: templateGame.minWordLength
    }, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
    g.puzzleGenerationId = templateGame.puzzleGenerationId || null;
    return g;
}

function spContext(mode) {
    const cache = mode === 'daily' ? spDailyCache : mode === 'weekly' ? spWeeklyCache : null;
    return cache ? { mode, period: mode === 'daily' ? cache.date : cache.weekStart, generation: cache.puzzleGenerationId } : null;
}
function restoreCanonicalSp(mode, period) {
    const context = spPuzzleJournal.context('canonical-template', mode);
    const stored = context && spPuzzleJournal.get('canonical-template', mode, context);
    if (!stored) return false;
    if (context.period !== period) {
        if (mode === 'daily') archiveSpDailyToPool(stored.cache); else archiveSpWeeklyToPool(stored.cache);
        return false;
    }
    const restored = new Game();
    restored.restoreFrom(stored.state, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true });
    restored.puzzleGenerationId = stored.cache.puzzleGenerationId;
    if (mode === 'daily') { spDailyGame = restored; spDailyCache = stored.cache; }
    else { spWeeklyGame = restored; spWeeklyCache = stored.cache; }
    return true;
}
function saveCanonicalSp(mode, period, game, cache) {
    game.puzzleGenerationId = cache.puzzleGenerationId;
    spPuzzleJournal.save('canonical-template', mode, { state: game.saveState({ exact: true }), cache }, { period });
}
const spCanonicalLoads = new Map();
async function loadCanonicalSp(mode, period, build) {
    const current = mode === 'daily' ? spDailyCache : spWeeklyCache;
    if (current && (mode === 'daily' ? current.date : current.weekStart) === period) return;
    if (restoreCanonicalSp(mode, period)) return;
    const key = mode + ':' + period;
    if (spCanonicalLoads.has(key)) return spCanonicalLoads.get(key);
    const pending = (async () => {
        const { game, cache } = await build();
        if (period !== (mode === 'daily' ? gameShared.getEdmontonDate() : getSpWeekStart())) throw new Error('Puzzle period changed while loading');
        // Publish only after durable storage. Failed saves remain retryable.
        saveCanonicalSp(mode, period, game, cache);
        if (mode === 'daily') { spDailyGame = game; spDailyCache = cache; }
        else { spWeeklyGame = game; spWeeklyCache = cache; }
    })();
    spCanonicalLoads.set(key, pending);
    try { await pending; } finally { if (spCanonicalLoads.get(key) === pending) spCanonicalLoads.delete(key); }
}
function guessSpDurably(activeGame, ...args) {
    const owner = spSessionOwners.get(activeGame);
    const before = JSON.parse(JSON.stringify(activeGame.saveState({ exact: true })));
    try {
        const result = activeGame.guess(...args);
        if (owner && result.result === 'correct') spSessionJournal.save(owner.sid, owner.mode, activeGame.saveState({ exact: true }), owner.context);
        return result;
    } catch (error) {
        activeGame.restoreFrom(before, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true }); throw error;
    }
}
function buildSpSessionResponse(game) {
    return { isComplete: game.commonWords.size > 0 && [...game.commonWords.keys()].every(word => game.foundCommon.has(word)), grid: game.grid, rows: game.rows, cols: game.cols, commonCount: game.commonWords.size,
        foundCommonCount: game.foundCommon.size, letterStats: game.getLetterStats(), activeCells: [...game.getActiveCells()],
        commonWordPaths: Object.fromEntries(game.commonWords), puzzleGenerationId: game.puzzleGenerationId || null,
        sessionState: game.saveState() };
}
function getSpWeekStart() {
    const date = new Date(gameShared.getEdmontonDate() + 'T12:00:00Z');
    const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
    return date.toISOString().slice(0, 10);
}

// Frenzy state
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let connectedPlayers = 0;
let currentDisplaySettings = { letterScale: 0.5, numberScale: 0.3 };
let boardPresentationState = null;

function isCurrentMpGameComplete(gameInstance) {
    if (!gameInstance || typeof gameInstance.getState !== 'function') return true;
    try {
        return !!gameInstance.getState().isComplete;
    } catch {
        return false;
    }
}

// --- Hint helpers ---
function getGameStateForHandle(handle) {
  if (!handle || handle === 'public') return game;
  const session = sessionManager.getSession(handle);
  return session?.game || game;
}

function generateHintForHandle(handle) {
  const targetGame = getGameStateForHandle(handle);
  if (!targetGame || typeof targetGame.getState !== 'function') return null;
  const state = targetGame.getState();
  if (state.isComplete) return null;

  // Reveal one common word that has not yet been found.
  const common = targetGame.commonWords;
  const found = targetGame.foundCommon;
  if (!common || !common.size) return null;

  const available = [];
  for (const word of common.keys()) {
    if (!found || !found.has(word)) available.push(word);
  }
  if (!available.length) return null;

  const word = available[Math.floor(Math.random() * available.length)];
  return { word: word.toUpperCase() };
}

function getFallbackBoardPresentation() {
    if (!game || typeof game.getState !== 'function') return null;
    try {
        const state = game.getState();
        return {
            game: 'rectangled',
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

const mpActions = require(path.join(RELAY_DIR, 'src', 'multiplayer-game-actions')).createMultiplayerGameActions({
    directory: path.join(__dirname, 'data', 'mp-actions'), gameId: 'rectangled', Game, wordlist, sdk: gameShared,
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

async function fetchWeeklyWord() {
    try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/weekly/${WORD_BANK_GAME_ID}?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const data = await res.json();
        if (weeklyWord && weeklyWord.weekStart !== data.weekStart) weeklyPlayed = false;
        weeklyWord = data;
    } catch (e) {
        console.warn('[RecTangled] Weekly word fetch failed:', e.message);
    }
}

async function fetchDailyWord() {
    try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/${WORD_BANK_GAME_ID}?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const data = await res.json();
        // Reset dailyPlayed if date changed
        if (dailyWord && dailyWord.date !== data.date) {
            dailyPlayed = dailyRounds.has(data.date);
        }
        dailyWord = data;
        console.log(`[RecTangled] Daily word fetched for ${data.date} (${data.word.length} letters)`);
    } catch (e) {
        console.warn('[RecTangled] Daily word fetch failed:', e.message);
    }
}

function loadPlayedPuzzleIds() {
    try {
        if (fs.existsSync(playedPuzzlesPath)) {
            const data = JSON.parse(fs.readFileSync(playedPuzzlesPath, 'utf-8'));
            // Keep only the most recent 500 entries to prevent unbounded growth
            const capped = data.slice(-500);
            playedPuzzleIds = new Set(capped);
            console.log(`[Puzzles] Loaded ${playedPuzzleIds.size} played puzzle IDs${data.length > 500 ? ` (capped from ${data.length})` : ''}`);
        }
    } catch (e) {
        console.warn('[Puzzles] Failed to load played puzzles:', e.message);
    }
}

function atomicWriteSync(filePath, data) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
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

// Serve specific root-level OBS overlay files (index.html + its deps)
// REMOVED: express.static(__dirname) — exposed server.js, package.json, node_modules, .bak files
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.get('/data/dictionary.txt', (req, res) => res.sendFile(path.join(__dirname, 'data', 'dictionary.txt')));
app.get('/coin-reward.js', (req, res) => res.sendFile(path.join(__dirname, 'coin-reward.js')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/overlay/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/logo-overlay.html', (req, res) => res.sendFile(path.join(__dirname, 'logo-overlay.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/stream', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

// Streamer-private session URL: rectangled.live/<handle> serves the mobile
// play page. Frontend reads location.pathname → passes auth.session on the
// Socket.IO handshake.
const SESSION_RESERVED_HANDLES = new Set([
  'stream', 'overlay', 'admin', 'admin.html', 'api', 'js', 'css', 'public',
  'index.html', 'mobile.html', 'mobile-sp.html', 'logo-overlay.html',
  'favicon.ico', 'robots.txt', 'manifest.json', 'sitemap.xml',
]);
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  // Only whitelisted streamer handles get a private session URL.
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  // Disable-player-page: redirect once to /<handle>?disabled=1 so the
  // frontend (mobile.html) reads the flag from URLSearchParams. The
  // ?disabled=1 path stays inside this regex; the query check breaks the loop.
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
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// ─── SSE Control API (kept for admin panel compatibility) ───────────────────

app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.write(':\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try { client.write(msg); } catch { sseClients.delete(client); }
    }
}

// Prune dead SSE connections every 5 minutes
setInterval(() => {
    for (const client of sseClients) {
        try { client.write(':\n\n'); } catch { sseClients.delete(client); }
    }
}, 5 * 60 * 1000);

app.post('/api/command', requireAdmin, (req, res) => {
    const command = req.body;
    if (command.type === 'new-game') {
        startNewGame(command.data || {});
    }
    if (command.type === 'display') {
        currentDisplaySettings = command.data || {};
    }
    broadcastSSE(command.type, command.data || {});
    res.json({ ok: true });
});

// ─── API Endpoints ──────────────────────────────────────────────────────────

// CORS for /api/sp/* — allows Devvit WebView and other browser clients to fetch puzzle data
app.use('/api/sp', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

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

// SP Daily puzzle — generated grid, cached per day
app.get('/api/sp/daily', async (req, res) => {
    try {
        const today = gameShared.getEdmontonDate(); // Edmonton timezone — matches word bank
        if (req.query.sid != null && (typeof req.query.sid !== 'string' || req.query.sid.length > 256)) return res.status(400).json({ error: 'Invalid solo session' });
        const sid = String(req.query.sid || '').trim() || null;

        await loadCanonicalSp('daily', today, async () => {
            if (spDailyCache && spDailyCache.date && spDailyCache.date !== today) {
                archiveSpDailyToPool(spDailyCache);
            }
            await fetchDailyWord();
            if (!dailyWord || !dailyWord.word) {
                throw new Error('No daily word available');
            }
            const g = new Game();
            // 5x4 grids organically produce ~12-25 common words; the new
            // range matches that distribution and the closest-to-range
            // fallback in initializeAroundWord catches the rest.
            g.initializeAroundWord(dailyWord.word, 5, 4, wordlist.getTrie(), wordlist.getTargetSet(), { minCommon: 12, maxCommon: 22, frequencyMap: wordlist.getFrequencyMap() });
            g.puzzleName = 'Single Player Daily - ' + today;
            g.puzzleTheme = 'Daily';
            g.puzzleId = 'sp-daily-' + today;
            // puzzleGenerationId changes every time the daily is regenerated
            // so clients can detect stale localStorage progress from a
            // previous generation of the same date (e.g. after a regen).
            const puzzleGenerationId = 'gen-' + Date.now();
            const cache = {
                mode: 'daily',
                date: today,
                grid: g.grid,
                rows: g.rows,
                cols: g.cols,
                commonCount: g.commonWords.size,
                rareCount: g.rareWords.size,
                hiddenCount: g.hiddenWords.size,
                letterStats: g.getLetterStats(),
                commonWordPaths: Object.fromEntries(g.commonWords),
                puzzleGenerationId,
                name: g.puzzleName,
                theme: g.puzzleTheme
            };
            return { game: g, cache };
        });

        // Create or fetch the caller's per-session instance cloned from the template.
        if (sid) {
            let session = getSpSession(sid, 'daily');
            if (!session) {
                session = cloneSpGame(spDailyGame);
                if (session) setSpSession(sid, 'daily', session);
            }
        }

        const active = sid && getSpSession(sid, 'daily');
        res.json(active ? { ...spDailyCache, ...buildSpSessionResponse(active) } : spDailyCache);
    } catch (e) {
        console.error('[SP] Daily endpoint error:', e.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// The same stable completion ID is used by the legacy Relay path. Central
// normalized payloads agree, so an interrupted pre-upgrade claim cannot pay twice.
const { stableCompletionEvent } = require(path.join(RELAY_DIR, 'src', 'reward-outbox.js'));
async function deliverSpCompletion(userId, mode, period) {
    const game = 'rectangled', gameId = 'rectangled-sp';
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

// Completion replays submitted words on the canonical puzzle, never a restored grid.
function verifySpSolve(body, mode) {
    const cache = mode === 'daily' ? spDailyCache : spWeeklyCache;
    const template = mode === 'daily' ? spDailyGame : spWeeklyGame;
    if (!cache || !template || body.puzzleGenerationId !== cache.puzzleGenerationId) return false;
    if (!Array.isArray(body.foundWords) || body.foundWords.length > 5000) return false;
    const replay = cloneSpGame(template);
    for (const word of body.foundWords) {
        if (typeof word !== 'string' || word.length > 30) return false;
        replay.guess(word.trim().toLowerCase(), 'sp', 'verify', 'Player', 'Player', null);
    }
    return replay.commonWords.size > 0 && [...replay.commonWords.keys()].every(word => replay.foundCommon.has(word));
}

app.post('/api/sp/daily/complete', async (req, res) => {
    const verifiedUserId = await resolveUserFromCookie(req);
    if (!verifiedUserId) return res.status(401).json({ ok: false, error: 'auth_required' });
    if (!spDailyCache) return res.json({ ok: false });
    const date = String(req.body?.date || spDailyCache.date || '');
    if (!date || spDailyCache.date !== date) {
        return res.json({ ok: false, error: 'Invalid daily date' });
    }

    if (date !== gameShared.getEdmontonDate() || !verifySpSolve(req.body || {}, 'daily'))
        return res.status(409).json({ ok: false, error: 'Verified daily solve required' });
    archiveSpDailyToPool(spDailyCache);

    try {
        return res.json(await deliverSpCompletion(verifiedUserId, 'daily', date));
    } catch {
        return res.status(503).json({ ok: false, error: 'Completion could not be acknowledged. Please retry.' });
    }
});

// SP Weekly puzzle — generated grid with 70-120 common words, cached per week
app.get('/api/sp/weekly', async (req, res) => {
    try {
        const weekStart = getSpWeekStart();
        if (req.query.sid != null && (typeof req.query.sid !== 'string' || req.query.sid.length > 256)) return res.status(400).json({ error: 'Invalid solo session' });
        const sid = String(req.query.sid || '').trim() || null;

        await loadCanonicalSp('weekly', weekStart, async () => {
            if (spWeeklyCache && spWeeklyCache.weekStart && spWeeklyCache.weekStart !== weekStart) {
                archiveSpWeeklyToPool(spWeeklyCache);
            }
            await fetchWeeklyWord();
            if (!weeklyWord || !weeklyWord.word) {
                throw new Error('No weekly word available');
            }
            const g = new Game();
            g.initializeAroundWord(weeklyWord.word, 9, 7, wordlist.getTrie(), wordlist.getTargetSet(), { minCommon: 30, maxCommon: 60, frequencyMap: wordlist.getFrequencyMap() });
            g.puzzleName = 'Weekly Challenge';
            g.puzzleTheme = 'Weekly';
            g.puzzleId = 'sp-weekly-' + weekStart;
            const puzzleGenerationId = 'gen-' + Date.now();
            const cache = {
                mode: 'weekly',
                weekStart,
                grid: g.grid,
                rows: g.rows,
                cols: g.cols,
                name: g.puzzleName,
                theme: g.puzzleTheme,
                commonCount: g.commonWords.size,
                rareCount:   g.rareWords.size,
                hiddenCount: g.hiddenWords.size,
                letterStats: g.getLetterStats(),
                commonWordPaths: Object.fromEntries(g.commonWords),
                puzzleGenerationId,
            };
            return { game: g, cache };
        });

        // Per-session instance cloned from the weekly template
        if (sid) {
            let session = getSpSession(sid, 'weekly');
            if (!session) {
                session = cloneSpGame(spWeeklyGame);
                if (session) setSpSession(sid, 'weekly', session);
            }
        }

        const active = sid && getSpSession(sid, 'weekly');
        res.json(active ? { ...spWeeklyCache, ...buildSpSessionResponse(active) } : spWeeklyCache);
    } catch (e) {
        console.error('[SP] Weekly endpoint error:', e.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Generic SP guess — works for daily, weekly, random, archive.
// Each player has their own per-session Game instance keyed by sid+mode,
// so guesses correctly track found words without corrupting other players.
function handleSpGuess(req, res) {
    try {
        const { word, sid, mode } = req.body || {};
        if (typeof word !== 'string' || word.length > 30 || (sid != null && (typeof sid !== 'string' || sid.length > 256)))
            return res.status(400).json({ result: 'wrong', error: 'Invalid guess' });
        if (mode != null && (typeof mode !== 'string' || !(['daily', 'weekly', 'random', 'archive'].includes(mode) || /^archive:[a-zA-Z0-9_-]{1,128}$/.test(mode)))) return res.status(400).json({ result: 'wrong', error: 'Invalid solo mode' });
        if (!word) return res.json({ result: 'wrong', word: '' });
        const normalized = String(word).trim().toLowerCase();
        if (!normalized || normalized.length < 3) return res.json({ result: 'wrong', word: normalized });
        if (gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'guess', word) ||
            gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'guess', normalized)) {
            return res.json({ result: 'blocked', word: normalized });
        }

        // Look up this player's per-session game for the mode they declared.
        let activeGame = null;
        let effectiveMode = mode || null;
        if (sid) {
            if (effectiveMode) activeGame = getSpSession(sid, effectiveMode);
            if (!activeGame && !effectiveMode) {
                // Only legacy clients omit the mode. Scan whatever session
                // this sid owns. Archive sessions have a compound mode key
                // like "archive:<puzzleId>", so match on ":" + sid.
                //
                // This deliberately does NOT run when a mode WAS declared:
                // substituting another mode's board would validate the
                // player's guesses against a puzzle they aren't looking at.
                for (const k of spSessions.keys()) {
                    if (k.endsWith(':' + sid)) {
                        const candidateMode = k.slice(0, k.lastIndexOf(':' + sid));
                        const candidate = getSpSession(sid, candidateMode);
                        if (!candidate) continue;
                        activeGame = candidate;
                        effectiveMode = candidateMode;
                        break;
                    }
                }
            }
        }
        if (!activeGame) {
            // Rebuild from a template. Only the SHARED daily/weekly puzzles
            // can be reconstructed here — random and archive boards are
            // per-player and live nowhere but spSessions.
            let template = null;
            if (effectiveMode === 'daily' || !effectiveMode) template = spDailyGame;
            else if (effectiveMode === 'weekly') template = spWeeklyGame;
            if (template) {
                if (sid) {
                    activeGame = cloneSpGame(template);
                    if (activeGame) setSpSession(sid, effectiveMode || 'daily', activeGame);
                } else {
                    // Legacy sid-less client: validate against the shared
                    // puzzle directly, with no per-session found tracking —
                    // which is all those clients ever got.
                    activeGame = cloneSpGame(template);
                }
            }
        }
        if (!activeGame) {
            // A random or archive session that's gone: spSessions is in
            // memory, so a restart, the 4h TTL or the 500-session cap drops
            // boards only the player still has.
            //
            // This used to fall back to `spDailyGame || spWeeklyGame`, which
            // checked the player's guesses against a puzzle that wasn't on
            // their screen — every word on their own grid came back wrong,
            // and any word that happened to exist on both boards could come
            // back in a different category, permanently wedging the client's
            // common-word count so the round could never complete.
            // Tell the client to re-register the board it still holds.
            return res.json({ result: 'session_expired', word: normalized });
        }

        // Run the proper Game.guess() path so foundCommon/foundRare/etc.
        // are tracked per session. This enables correct letterStats updates
        // and lets the server detect already-found words.
        const result = guessSpDurably(activeGame,
            normalized,
            'sp',                          // platform
            sid || 'sp-anon',              // platformUserId
            'Player', 'Player', null       // username, displayName, profileImage
        );

        if (result.result === 'correct') {
            return res.json({
                result: 'correct',
                word: result.word,
                cells: result.cells,
                isRare: result.isRare,
                isHidden: result.isHidden,
                isThreeLetter: result.isThreeLetter,
                // Fresh stats so the client's cell-number hints can update
                // even without the commonWordPaths client fallback.
                letterStats: activeGame.getLetterStats(),
                foundCommonCount: activeGame.foundCommon.size,
                commonCount: activeGame.commonWords.size,
                isComplete: !!result.isComplete
            });
        }
        if (result.result === 'already_found') {
            return res.json({ result: 'already_found', word: result.word, ...buildSpSessionResponse(activeGame) });
        }
        return res.json({ result: 'wrong', word: normalized });
    } catch (e) {
        console.error('[SP] Guess could not be persisted');
        res.status(503).json({ result: 'retry', message: 'Progress could not be saved. Please try again.' });
    }
}
// Re-register a solo board the client already holds.
//
// spSessions is in-memory, so a restart / the 4h TTL / the 500-session cap
// silently drops random and archive boards that exist nowhere else. The
// client still has the grid it was handed at load time, so it can hand it
// straight back and carry on rather than losing the puzzle. Solo is
// single-player and self-scored, and the client is already given every
// required word via commonWordPaths, so accepting a client-supplied grid
// here gives away nothing it didn't already have.
app.post('/api/sp/restore', (req, res) => {
    try {
        const { sid, mode, grid, minWordLength, name, theme, puzzleId, foundWords, puzzleGenerationId } = req.body || {};
        if (typeof sid !== 'string' || !sid || sid.length > 256 || typeof mode !== 'string' ||
            !(['daily', 'weekly', 'random', 'archive'].includes(mode) || /^archive:[a-zA-Z0-9_-]{1,128}$/.test(mode)))
            return res.status(400).json({ error: 'Invalid solo session' });
        const context = spContext(mode);
        if ((mode === 'daily' || mode === 'weekly') && !context) return res.status(409).json({ error: 'Load the current puzzle first' });
        if (context && puzzleGenerationId && puzzleGenerationId !== context.generation) return res.status(409).json({ error: 'Stale puzzle generation' });
        if (foundWords != null && (!Array.isArray(foundWords) || foundWords.length > 5000 || foundWords.some(word => typeof word !== 'string' || word.length > 30)))
            return res.status(400).json({ error: 'Invalid saved words' });
        let g = getSpSession(sid, mode);
        if (!g && context) g = cloneSpGame(mode === 'daily' ? spDailyGame : spWeeklyGame);
        if (!g) {
            if (!Array.isArray(grid) || grid.length < 2 || grid.length > 30 || !Array.isArray(grid[0]) || grid[0].length < 2 || grid[0].length > 30 ||
                grid.some(row => !Array.isArray(row) || row.length !== grid[0].length || row.some(letter => typeof letter !== 'string' || !/^[a-z]$/i.test(letter))))
                return res.status(400).json({ error: 'Invalid saved grid' });
            g = new Game(); g.initializeFromPuzzle({ grid, id: puzzleId || null, name: name || 'Restored', theme: theme || null,
                minWordLength: Math.min(15, Math.max(3, Number(minWordLength) || 3)) }, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
        }
        // Merge only words the server validates, preserving newer journaled progress.
        const before = JSON.parse(JSON.stringify(g.saveState({ exact: true })));
        try {
            for (const word of foundWords || []) g.guess(word.trim().toLowerCase(), 'sp', sid, 'Player', 'Player', null);
            setSpSession(sid, mode, g);
        } catch (error) { g.restoreFrom(before, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: true }); throw error; }
        res.json({ ok: true, ...buildSpSessionResponse(g) });
    } catch { res.status(503).json({ error: 'Progress could not be saved. Please try again.' }); }
});

app.post('/api/sp/guess', handleSpGuess);
// Legacy weekly guess endpoint — routes through the same handler. Clients
// should now always send mode:'weekly' for weekly guesses.
app.post('/api/sp/weekly/guess', handleSpGuess);

app.post('/api/sp/weekly/complete', async (req, res) => {
    const userId = await resolveUserFromCookie(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'auth_required' });
    const weekStart = req.body?.weekStart;
    if (weekStart !== getSpWeekStart() || !spWeeklyCache || spWeeklyCache.weekStart !== weekStart || !verifySpSolve(req.body || {}, 'weekly'))
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
        const sid = String(req.query.sid || '').trim() || null;
        const targets = wordlist.getTargetSet();
        const targetArr = Array.from(targets);
        const word = targetArr[Math.floor(Math.random() * targetArr.length)];
        const g = new Game();
        const minCommon = Math.max(5, Math.floor(rows * cols * 0.2));
        const maxCommon = Math.floor(rows * cols * 0.6);
        g.initializeAroundWord(word, rows, cols, wordlist.getTrie(), targets, { minCommon, maxCommon, frequencyMap: wordlist.getFrequencyMap() });
        g.puzzleName = 'Random ' + rows + '×' + cols;
        g.puzzleTheme = 'Random';
        // Stash the generated game as this user's random session. If the
        // caller didn't provide a sid, we still return the puzzle but the
        // subsequent guess path will rebuild the session from templates.
        if (sid) setSpSession(sid, 'random', g);
        res.json({
            mode: 'random',
            grid: g.grid,
            rows: g.rows,
            cols: g.cols,
            commonCount: g.commonWords.size,
            rareCount: g.rareWords.size,
            hiddenCount: g.hiddenWords.size,
            letterStats: g.getLetterStats(),
            commonWordPaths: Object.fromEntries(g.commonWords),
            name: g.puzzleName,
            theme: g.puzzleTheme
        });
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
    const sid = String(req.query.sid || '').trim() || null;
    let response = { ...puzzle, mode: 'archive' };
    // Build a Game instance for guess validation
    try {
        const g = new Game();
        g.grid = puzzle.grid;
        g.rows = puzzle.rows || puzzle.grid.length;
        g.cols = puzzle.cols || puzzle.grid[0].length;
        g.solve(wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
        g.puzzleId = puzzle.id;
        g.puzzleName = puzzle.name || 'Archive Puzzle';
        g.puzzleTheme = puzzle.theme || 'Archive';
        // Stash as this user's archive session — identified by sid+id so
        // browsing different archives on the same sid gives each its own
        // independent found-word state.
        if (sid) setSpSession(sid, 'archive:' + puzzle.id, g);
        response = {
            ...response,
            rows: g.rows,
            cols: g.cols,
            commonCount: g.commonWords.size,
            rareCount: g.rareWords.size,
            hiddenCount: g.hiddenWords.size,
            letterStats: g.getLetterStats(),
            commonWordPaths: Object.fromEntries(g.commonWords),
            name: g.puzzleName,
            theme: g.puzzleTheme
        };
    } catch (e) { console.error('[SP] Archive game build error:', e.message); }
    res.json(response);
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

// Current game state. Optional ?session=<handle> returns the per-streamer
// private session state instead of the public game, powering OBS overlays
// opened at /overlay/<handle>.
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

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) {
    console.log('[RecTangled Hints] remaining: no authenticated user');
    return res.json({ ok: true, remaining: 0 });
  }
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`, {
      headers: { 'x-api-key': process.env.GAME_API_SECRET },
    });
    if (!r.ok) {
      console.error('[RecTangled Hints] remaining: relay returned HTTP', r.status);
      return res.json({ ok: true, remaining: 0 });
    }
    const data = await r.json();
    console.log('[RecTangled Hints] remaining for', discordId.slice(0, 8), ':', data);
    res.json(data);
  } catch (e) {
    console.error('[RecTangled Hints] remaining failed:', e.message);
    res.json({ ok: true, remaining: 0 });
  }
});

// Spend a monthly hint and reveal one unfound common word.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) {
    console.log('[RecTangled Hints] use: no authenticated user');
    return res.json({ ok: false, reason: 'not_authenticated', remaining: 0 });
  }

  const handle = String((req.body && req.body.handle) || 'public').toLowerCase().trim();
  console.log('[RecTangled Hints] use: user', discordId.slice(0, 8), 'handle', handle);
  const hint = generateHintForHandle(handle);
  if (!hint) {
    console.log('[RecTangled Hints] use: no hint available for handle', handle);
    return res.json({ ok: false, reason: 'no_hint_available', remaining: 0 });
  }

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.GAME_API_SECRET,
      },
      body: JSON.stringify({ discordId, game: 'rectangled', label: 'RecTangled web hint' }),
    });
    if (!r.ok) {
      console.error('[RecTangled Hints] use: relay returned HTTP', r.status);
      return res.json({ ok: false, reason: 'spend_failed', remaining: 0 });
    }
    const spendData = await r.json();
    console.log('[RecTangled Hints] use spend response:', spendData);
    if (!spendData.ok) return res.json({ ok: false, reason: spendData.reason || 'spend_failed', remaining: spendData.remaining });
    res.json({ ok: true, remaining: spendData.remaining, hint });
  } catch (e) {
    console.error('[RecTangled Hints] use failed:', e.message);
    res.json({ ok: false, reason: 'spend_failed', remaining: 0 });
  }
});

// Streamer-scoped OBS overlay: rectangled.live/overlay/<handle> redirects
// to /overlay?session=<handle>. The /overlay path triggers isObsOverlay=true
// in index.html (otherwise the page renders as the public player page).
// main.js detects ?session= and bridges session-room socket events onto its
// existing SSE handler structure.
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
    const handle = req.path.split('/').pop();
    res.redirect(302, `/overlay?session=${encodeURIComponent(handle)}`);
});

app.get('/api/board-presentation', (_req, res) => {
    res.json(boardPresentationState || getFallbackBoardPresentation() || {
        game: 'rectangled',
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
        game: 'rectangled',
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
        const cosmetics = await gameShared.getPlayerCosmetics(req.params.platform, req.params.userId);
        res.json({ equipped: cosmetics || {} });
    } catch (e) {
        res.json({ equipped: {} });
    }
});

// ─── ELO Leaderboard (from Word Tycoon — canonical source) ───────────────────
app.get('/api/elo/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
        const wtRes = await fetch(`${WORD_EMPIRES_URL}/api/elo/rectangled/leaderboard?limit=${limit}&minRounds=5`, {
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
    console.log('[RecTangled] Jackpot settings updated:', jackpotSettings);
    res.json({ ok: true, ...jackpotSettings, current: calculateJackpot() });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
    gameStartTime = Date.now();
    console.log('[RecTangled] Jackpot timer reset');
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
        console.log(`[RecTangled] Admin triggered daily game: "${dailyWord.word}"`);
        res.json({ ok: true, word: dailyWord.word });
    } catch (e) {
        console.error('[RecTangled] Start daily failed:', e.message);
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
    // /play/<handle> redirect → /game/rectangled/?session=<handle>. The client
    // forwards the slug on the handshake; we lazy-create the session game here
    // (or attach to an existing one) so viewers always see a board immediately.
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

    // Public socket — join 'public' room so public broadcasts can be scoped
    // to public clients only, not leaking into session-room sockets.
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
        gameShared.reportSocketIP(socket, platform || 'web', platformUserId, 'rectangled');
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
                isDonor: !!(socket._wtPerks && socket._wtPerks.isDonor)
            };
            io.to('public').emit('word-found', wordFoundData);
            broadcastSSE('word-found', wordFoundData);

            // The accepted state is already durable; update only its SQLite mirror.
            saveCurrentGameState({ mirrorOnly: true });

            // Per-word reward — flat tier scale (common 100 / rare 250 / hidden 500, 3-letter 50)
            const _baseCoin = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const _letterBonus = (gameShared.getLetterRarityBonus(word) || {}).bonus || 0;
            const _lengthBonus = gameShared.getWordLengthBonus(word) || 0;
            const coinAmount = _baseCoin + _letterBonus + _lengthBonus;
            sendCoinReward(platform || 'web', platformUserId || socket.id, displayName || 'Anonymous', coinAmount, 'word', { word });
            reportLibraryWord(platform || 'web', platformUserId || socket.id, word, 'rectangled', socket, displayName);

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
        isDaily = true;
        dailyPlayed = true;
        jackpotSettings.dailyEnabled = false;
        console.log(`[Game] Daily puzzle: 9x7 built around "${dailyWord.word}"`);
    }
    // Priority 2: Unplayed puzzle from pool only when explicitly requested.
    else if (settings.usePool === true && puzzles.length > 0 && !settings.random && !settings.rows && !settings.cols) {
        // Find the next unplayed puzzle
        let found = false;
        for (let i = 0; i < puzzles.length; i++) {
            const idx = (currentPuzzleIndex + i) % puzzles.length;
            const puzzle = puzzles[idx];
            const pid = puzzle.id !== undefined ? puzzle.id : idx;
            if (!playedPuzzleIds.has(String(pid))) {
                currentPuzzleIndex = (idx + 1) % puzzles.length;
                game.initializeFromPuzzle(puzzle, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
                found = true;
                break;
            }
        }
        if (!found) {
            // All puzzles played — reset tracking and start over
            playedPuzzleIds.clear();
            savePlayedPuzzleIds();
            const puzzle = puzzles[currentPuzzleIndex];
            currentPuzzleIndex = (currentPuzzleIndex + 1) % puzzles.length;
            game.initializeFromPuzzle(puzzle, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap());
        }
    } else {
        // Random game — custom size or fallback (default 8 rows x 6 cols)
        const rows = settings.rows || 8;
        const cols = settings.cols || 6;
        const minWordLength = settings.minWordLength || 3;
        // Pre-generated during the previous round when possible, so the new
        // board is handed over instantly instead of freezing the server ~2.4s.
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

            if (isDaily && relaySocket && relaySocket.connected) {
                relaySocket.emit('daily-win', {
                    game: 'rectangled',
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

        if (isDaily) {
            savePuzzleToPool(game);
        }

        if (game.puzzleId !== undefined) {
            playedPuzzleIds.add(String(game.puzzleId));
            savePlayedPuzzleIds();
        }

        console.log(`[Game] All common words found! ${shouldAutoRestart ? 'Starting the next round now...' : 'Admin mode — waiting.'}`);

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

        const gameOverPayload = {
            countdown: 0, // no wait — the win card is shown over the new round
            stats: { ...game.getState(), jackpot: jackpotAmount, jackpotEnabled: jackpotSettings.enabled, isDaily, frenzy: currentFrenzy },
            jackpotWinner: jackpotWinner ? { displayName: jackpotWinner.displayName, amount: jackpotAmount, platform: jackpotWinner.platform } : null
        };
        io.to('public').emit('game-over', gameOverPayload);
        if (relaySocket && relaySocket.connected && jackpotWinner) {
            relaySocket.emit('game-win', {
                game: 'rectangled', gameName: 'RecTangled',
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
                isDaily,
            });
        }
        broadcastSSE('game-over', gameOverPayload);
        try { reportRoundToWordTycoon(game); } catch (e) { console.log(`[Rectangled] report to WT failed: ${e.message}`); }
    } catch (err) {
        console.error('[Game] Completion flow error:', err.message);
    }

    // Start the next round immediately — the win card is displayed over it.
    // Runs last so every payload above is built from the finished game, and
    // reward/relay/history failures can't stop the game from moving on.
    if (shouldAutoRestart) {
        try {
            startNewGame({});
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

// ─── Streamer-private session chat path ─────────────────────────────────────
function _sessionRoom(handle) { return `rectangled:session:${String(handle || '').toLowerCase()}`; }

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
        .map(t => t.replace(/[^\p{L}]/gu, ''))
        .filter(w => w);
    if (!words.length) return;

    const user = msg.user || {};
    const username = user.displayName || user.username || user.nickname || 'anonymous';
    const profileImage = user.profilePic || user.profilePictureUrl || user.profileImageUrl || user.avatarUrl || user.avatar || user.image || null;
    const platformUserId = user.userId || user.id || user.uniqueId || username;

    let session;
    try {
        session = await sessionManager.getOrCreateSession({
            handle,
            sessionId: msg.streamSession || null,
            wordlist,
            settings: _sessionSettingsFor(handle),
        });
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
    const result = guessMpDurably(session.game, word, msg.platform || 'unknown', platformUserId, username, username, profileImage, _isFanClubChat, _chatPerks);
    if (result.result === 'storage_unavailable') { msg._responseSocket?.emit('guess-error', { error: result.error }); return; }
    // Echo immediate feedback to the submitting socket so on-page input shows
    // correct/incorrect/already_found state without waiting for room-wide
    // broadcasts. msg._responseSocket is set when the guess came in via the
    // session-page socket (rather than a TikTok-chat relay event).
    if (msg._responseSocket) {
        try { msg._responseSocket.emit('guess-result', result); } catch (_) {}
    }
    // Any guess mutates session.game state — persist after every guess so a
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
            displayName: username || 'Anonymous',
            profilePic: profileImage || null,
            platform: msg.platform || 'unknown',
            platformUserId: platformUserId || null,
            letterRarityBonus: result.letterRarityBonus || 0,
            wordLengthBonus: result.wordLengthBonus || 0,
            isFanClub: _isFanClubChat,
            isSuperfan: _chatPerks.isSuperfan,
            isDonor: _chatPerks.isDonor,
        });

        // Same per-word reward tier as the public game.
        {
            const _baseCoin = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const _letterBonus = (gameShared.getLetterRarityBonus(word) || {}).bonus || 0;
            const _lengthBonus = gameShared.getWordLengthBonus(word) || 0;
            const coinAmount = _baseCoin + _letterBonus + _lengthBonus;
            sendCoinReward(msg.platform || 'unknown', platformUserId, username, coinAmount, 'word', { word }, session.game);
            reportLibraryWord(msg.platform || 'unknown', platformUserId, word, 'rectangled', null, username);
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
    reportRoundToWordTycoon(session.game).catch(e => console.log('[Rectangled] session ELO report failed: ' + e.message));

    try {
        const jackpotAmount = mpActions.recordFor(session.game)?.completion?.amount ?? sessionManager.calculateSessionJackpot(session.handle, jackpotSettings);
        const topPlayers = session.game.getTopPlayers();
        let jackpotWinner = null;

        if (jackpotSettings.enabled && topPlayers.length > 0 && jackpotAmount > 0) {
            jackpotWinner = topPlayers[0];
            sendCoinReward(
                jackpotWinner.platform,
                jackpotWinner.platformUserId,
                jackpotWinner.displayName,
                jackpotAmount,
                'win',
                { guessCount: jackpotWinner.score }, session.game
            );
            console.log(`[Session] "${session.handle}" jackpot ${jackpotAmount} → ${jackpotWinner.displayName}`);
            io.to(room).emit('jackpot-won', {
                winner: jackpotWinner.displayName,
                amount: jackpotAmount,
                platform: jackpotWinner.platform,
                platformUserId: jackpotWinner.platformUserId,
                isDaily: false,
            });
        }

        const gameOverPayload = {
            countdown: 0, // no wait — the win card is shown over the new round
            stats: { ...session.game.getState(), jackpot: jackpotAmount, jackpotEnabled: jackpotSettings.enabled, isDaily: false, frenzy: { multiplier: 1, activeTappers: 0 } },
            jackpotWinner: jackpotWinner ? { displayName: jackpotWinner.displayName, amount: jackpotAmount, platform: jackpotWinner.platform } : null,
        };
        io.to(room).emit('game-over', gameOverPayload);

        // Per-streamer overlay (OBS) + in-page win card on player view.
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
                game: 'rectangled', gameName: 'RecTangled',
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
                isDaily: false,
                topPlayers: top10,
                streamerHandle: session.handle,
            };
            io.to(room).emit('game-win', _winPayload);
            if (relaySocket && relaySocket.connected) {
                relaySocket.emit('game-win', _winPayload);
            }
        }

        // Auto-restart with a fresh grid immediately so chat keeps playing —
        // the win card is shown over the new round instead of gating it.
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

function reportLibraryWord(platform, userId, word, gameName, socket, username) {
    gameShared.reportLibraryWord(platform, userId, word, gameName || 'rectangled', username || userId, username || userId, socket);
}

// ─── Chat Relay Connection ──────────────────────────────────────────────────

function connectToChatRelay() {
    console.log(`[ChatRelay] Connecting to ${CHAT_RELAY_URL}...`);
    relaySocket = gameShared.createRelayClient({
        id: 'rectangled',
        name: 'RecTangled',
        port: PORT,
        apiSecret: ADMIN_SECRET,
        relayUrl: CHAT_RELAY_URL,
        reconnectionDelay: 3000
    }, {
        onChat: (msg) => {
        if (!msg || !msg.message) return;

        // Streamer-private session: route to per-streamer game state instead
        // of the public game. chat-relay tags chat events with streamerHandle
        // when they originate from a TikTok connection bound to a streamer
        // session (see /api/streamer/connect in chat-relay).
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
            .map(t => t.replace(/[^\p{L}]/gu, ''))
            .filter(w => w);
        if (!words.length) return;

        const user = msg.user || {};
        const username = user.displayName || user.username || user.nickname || 'anonymous';
        const profileImage = user.profilePic || user.profilePictureUrl || user.profileImageUrl || user.avatarUrl || user.avatar || user.image || null;
        const platformUserId = user.userId || user.id || user.uniqueId || username;

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
        const result = guessMpDurably(game, word, msg.platform || 'unknown', platformUserId, username, username, profileImage, _isFanClubChat, _chatPerks);

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
                platform: msg.platform || 'unknown',
                platformUserId: platformUserId || null,
                isFanClub: _isFanClubChat,
                isSuperfan: _chatPerks.isSuperfan,
                isDonor: _chatPerks.isDonor
            };
            io.to('public').emit('word-found', wordFoundDataRelay);
            broadcastSSE('word-found', wordFoundDataRelay);

            // The accepted state is already durable; update only its SQLite mirror.
            saveCurrentGameState({ mirrorOnly: true });

            // Per-word reward — flat tier scale (common 100 / rare 250 / hidden 500, 3-letter 50)
            const _baseCoin = result.isThreeLetter ? 100 : (result.isHidden ? 1000 : (result.isRare ? 500 : 1500));
            const _letterBonus = (gameShared.getLetterRarityBonus(word) || {}).bonus || 0;
            const _lengthBonus = gameShared.getWordLengthBonus(word) || 0;
            const coinAmount = _baseCoin + _letterBonus + _lengthBonus;
            sendCoinReward(msg.platform || 'unknown', platformUserId, username, coinAmount, 'word', { word });
            reportLibraryWord(msg.platform || 'unknown', platformUserId, word, 'rectangled', null, username);

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
        console.log('[RecTangled] activate-daily received from Chat Relay');
        await fetchDailyWord();
        dailyRounds.reset(gameShared.getEdmontonDate());
        dailyPlayed = false;
        jackpotSettings.dailyEnabled = true;
        if (!game || newGameTimer || isCurrentMpGameComplete(game)) {
            if (newGameTimer) { clearTimeout(newGameTimer); newGameTimer = null; }
            startNewGame({});
        } else {
            console.log('[RecTangled] Game in progress — daily will start after current game ends');
        }
        }
    });
}

// ─── Startup ────────────────────────────────────────────────────────────────

async function startup() {
    console.log('========================================');
    console.log('  RecTangled - Starting Up');
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

    // Restore or create game
    const durableMp = mpActions.load('public');
    const savedState = durableMp ? { ...durableMp.record.state, _isDaily: durableMp.record.meta.isDaily, _isWeekly: durableMp.record.meta.isWeekly, _dailyPlayed: durableMp.record.meta.dailyPlayed, _dailyPlayedDate: durableMp.record.meta.dailyPlayedDate, _dailyEnabled: durableMp.record.meta.dailyEnabled } : db.loadGameState();
    game = new Game();

    if (savedState) {
        game.restoreFrom(savedState, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: !!durableMp });
            if (durableMp) mpActions.adopt(game, durableMp.record);
        isDaily = !!savedState._isDaily;
            isWeekly = !!savedState._isWeekly;
        dailyPlayed = dailyRounds.migrateLegacy({ played: !!savedState._dailyPlayed, date: savedState._dailyPlayedDate, startedAt: game.startTime });
        jackpotSettings.dailyEnabled = !!savedState._dailyEnabled;
        if (isCurrentMpGameComplete(game)) {
            if (isDaily || isWeekly) gameCompleted = true;
            else { isDaily = false; jackpotSettings.dailyEnabled = false; startNewGame({}); }
        } else {
            console.log(`[Game] Restored: ${game.rows}x${game.cols}, ${game.foundWords.size}/${game.allWords.size} found (${game.commonWords.size} common, ${game.rareWords.size} rare, ${game.threeLetterWords.size} three-letter)${isDaily ? ' [DAILY]' : ''}`);
        }
    } else {
        game.initialize(8, 6, 3, wordlist.getTrie(), wordlist.getTargetSet(), { frequencyMap: wordlist.getFrequencyMap() });
        saveCurrentGameState();
        console.log(`[Game] New game: ${game.rows}x${game.cols}, ${game.commonWords.size} common + ${game.rareWords.size} rare words`);
    }

    if (!mpActions.recordFor(game)) saveCurrentGameState();
    mpActions.recover();

    // Start jackpot broadcast (use game's start time if restored)
    gameStartTime = game.startTime || Date.now();
    startJackpotBroadcast();

    // Warm the board pool for the default MP size (sessions use the same 8x6),
    // so the first round to end after boot restarts instantly too.
    boardPool.prime(wordlist, 8, 6, 3);

    // Load played puzzle tracking
    loadPlayedPuzzleIds();

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
        console.log(`[Server] RecTangled running on port ${PORT}`);
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
    console.log('\n[RecTangled] Shutting down...');

    // Save game state
    if (game) {
        saveCurrentGameState();
        console.log('[RecTangled] Game state saved');
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
    console.log('[RecTangled] Shutdown complete');
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
    console.error('[RecTangled] Startup failed:', err);
    process.exit(1);
});
