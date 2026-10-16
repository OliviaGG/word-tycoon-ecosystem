'use strict';
// ─── Colour 500 ───────────────────────────────────────────────────────────
// Classic Mastermind played with colours, driven by TikTok chat.
//
// A secret code of coloured slots is drawn each round. Everyone — TikTok
// chat and the web page alike — guesses against ONE shared board, and every
// guess plus its peg feedback is visible to all. Feedback is aggregate and
// unordered (N exact, N right-colour-wrong-slot), never positional. First
// player to crack the code takes the jackpot.
//
// Chat input: 🟥🟩🟦🟨 typed WITHOUT spaces, or a prefixed letter code
// (/RGBY). Spaces matter — see the batch-guess note in AGENTS.md.
//
// Structure mirrors Word 5000 (C:\Word500(2.0)\server.js) so the two stay
// maintainable side by side: same relay client, same jackpot curve, same
// reward call, same admin-key convention.

try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }

if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const mm = require('./src/mastermind');
const config = require('./src/config');
const solo = require('./src/solo');
const sessions = require('./src/sessions');
const { createColourRecovery } = require('./src/mp-recovery');

// ─── Constants (declared above every closure that reads them) ─────────────
const PORT = process.env.PORT || 3033;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const ADMIN_SECRET = process.env.GAME_API_SECRET;
const GAME_ID = 'colour500';
const GAME_NAME = 'Color 500';
const relayOrigin = new URL(CHAT_RELAY_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(relayOrigin.hostname) || relayOrigin.protocol !== 'http:' || relayOrigin.port !== '3000' || relayOrigin.username || relayOrigin.password) throw Error('Invalid local Relay origin');
const relayFetch = (url, options = {}) => { const target = new URL(url); if (target.origin !== relayOrigin.origin) throw Error('Invalid Relay destination'); return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) }); };

const RELAY_DIR = process.env.CHAT_RELAY_DIR
  || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
const { createPlainGameActions } = require(path.join(RELAY_DIR, 'src', 'plain-game-actions.js'));

// Overridable so the integration test can run against a scratch directory
// instead of polluting real win history.
const DATA_DIR = process.env.COLOUR500_DATA_DIR || path.join(__dirname, 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'win-history.json');
const MAX_HISTORY = 5000;
const MAX_BOARD_GUESSES = 200; // cap the board so a long round can't grow without bound

// ─── Streamer whitelist + redirect targets ────────────────────────────────
// Declared HERE, above every route and socket closure that reads them — this
// codebase has been bitten before by const/let used inside handlers that were
// registered above the declaration (module TDZ).
//
// Fail-closed: an empty Set on cold boot means every /<handle> URL redirects
// to the public game until the first refresh lands (typically <100ms). That
// is deliberate — it stops randoms lazily creating junk sessions.
let _validStreamerHandles = new Set();
let _handlesLoaded = false;
const _streamerRedirectTargets = new Map(); // handle -> { targetUrl, targetGameName, targetGameId }

const HANDLE_REFRESH_MS = 5 * 60 * 1000;
const HANDLE_RETRY_MS = 10 * 1000;

async function _refreshStreamerHandles() {
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
    if (!res.ok) return false;
    const data = await res.json();
    if (data && Array.isArray(data.handles)) {
      _validStreamerHandles = new Set(data.handles.map(h => String(h).toLowerCase()));
      return true;
    }
  } catch (_) { /* keep the stale set on transient errors */ }
  return false;
}

/**
 * Keep the whitelist fresh, retrying FAST until the first success.
 *
 * This matters: PM2 commonly restarts this game and Chat Relay together, and
 * the game wins the race. With a 5-minute-only refresh the first fetch fails
 * and every /<handle> session URL then 302s to the public game for five
 * minutes — a streamer's viewers would land on the wrong board mid-stream.
 */
function _scheduleHandleRefresh(delayMs) {
  const t = setTimeout(async () => {
    const ok = await _refreshStreamerHandles();
    if (ok && !_handlesLoaded) {
      _handlesLoaded = true;
      console.log(`[Colour500] Streamer whitelist loaded (${_validStreamerHandles.size} handles)`);
    }
    _scheduleHandleRefresh(_handlesLoaded ? HANDLE_REFRESH_MS : HANDLE_RETRY_MS);
  }, delayMs);
  if (t.unref) t.unref();
}

function _isValidStreamer(handle) {
  return _validStreamerHandles.has(String(handle || '').toLowerCase());
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: ADMIN_SECRET, io });

// Block dotfiles and editor leftovers from the static tree (ecosystem convention).
const BLOCKED_PUBLIC_PATH_RE = /(^|\/)(?:\.[^/]+|[^/]+(?:\.bak(?:[-._][^/]*)?|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i;
app.use((req, res, next) => {
  const p = req.path || '/';
  if (/^\/\.well-known(?:\/|$)/i.test(p)) return next();
  if (BLOCKED_PUBLIC_PATH_RE.test(p)) return res.status(404).send('Not found');
  next();
});
app.use(express.json({ limit: '32kb' }));

// ─── State ────────────────────────────────────────────────────────────────
let cfg = config.load();
solo.init(DATA_DIR);
solo.configureRewards(gameShared, require(path.join(RELAY_DIR, 'src', 'reward-outbox.js')).stableCompletionEvent);
sessions.init(DATA_DIR);

let gameState = {
  code: [],            // the secret — never leaves the server until the round ends
  codeLength: cfg.codeLength,
  paletteSize: cfg.paletteSize,
  guesses: [],
  gameOver: false,
  winner: null,
};

let gameStartTime = Date.now();
let newGameTimeout = null;
let totalRoundsPlayed = 0;
let lastWinner = null;
let connectedPlayers = 0;
let history = readLegacyHistory();
let historyReceipts = [];
const recovery = createColourRecovery({ createActions: createPlainGameActions,
  directory: path.join(DATA_DIR, 'mp-actions'), sdk: gameShared, mm,
  getConfig: () => cfg, setConfig: value => { cfg = config.setAccepted(value); },
  getPublicMeta: () => ({ history, historyReceipts, totalRoundsPlayed, lastWinner }),
  setPublicMeta: value => { history = value.history || []; historyReceipts = value.historyReceipts || [];
    totalRoundsPlayed = value.totalRoundsPlayed || 0; lastWinner = value.lastWinner || null; },
  mirrorHistory: rows => atomicWriteSync(HISTORY_PATH, rows),
  onError: () => console.error('[Colour500] Accepted action handoff requires retry'),
});
sessions.configureRecovery(recovery.sessionHooks());
const sessionTimers = new Map();

// ─── Persistence ──────────────────────────────────────────────────────────

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function readLegacyHistory() {
  try {
    const value = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (!Array.isArray(value) || value.length > MAX_HISTORY) throw Error('Invalid win history');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function loadWinHistory() { return history; }

/** How many rounds this player has won, for the win banner. */
function getWinCount(platformUserId) {
  if (!platformUserId) return 0;
  const key = String(platformUserId);
  return loadWinHistory().filter(w => String(w.platformUserId) === key).length;
}

// ─── Jackpot ──────────────────────────────────────────────────────────────
// Identical curve to Word 5000: linear in the early zone, then super-linear,
// capped. Keeping the shape shared means payouts feel the same across games.

function calculatePot() { return recovery.pot(gameState); }

// ─── Round lifecycle ──────────────────────────────────────────────────────

function startNewGame() {
  const next = { code: mm.generateCode(cfg.codeLength, cfg.paletteSize, cfg.allowDuplicates),
    codeLength: cfg.codeLength, paletteSize: cfg.paletteSize, guesses: [], gameOver: false,
    winner: null, startedAt: Date.now(), allowDuplicates: cfg.allowDuplicates };
  recovery.newPublic(next);
  if (newGameTimeout) clearTimeout(newGameTimeout);
  newGameTimeout = null;
  gameState = next; gameStartTime = next.startedAt;
  io.to('public').emit('game-state', getPublicState());
}
function schedulePublicRound(state) {
  if (newGameTimeout) clearTimeout(newGameTimeout);
  const delay = Math.max(0, (state.wonAt || Date.now()) + cfg.newGameDelayMs - Date.now());
  newGameTimeout = setTimeout(() => {
    if (gameState !== state || !state.gameOver) return;
    try { startNewGame(); } catch (_) { schedulePublicRetry(state); }
  }, delay);
  newGameTimeout.unref?.();
}
function schedulePublicRetry(state) {
  newGameTimeout = setTimeout(() => {
    if (gameState !== state) return;
    try { startNewGame(); } catch (_) { schedulePublicRetry(state); }
  }, 5000); newGameTimeout.unref?.();
}

/** Everything the browser is allowed to know mid-round. Never includes the code. */
function getPublicState() {
  return {
    gameId: GAME_ID,
    gameName: GAME_NAME,
    codeLength: gameState.codeLength,
    paletteSize: gameState.paletteSize,
    palette: mm.getPalette(gameState.paletteSize),
    allowDuplicates: gameState.allowDuplicates ?? cfg.allowDuplicates,
    requireLetterPrefix: cfg.requireLetterPrefix,
    guesses: gameState.guesses,
    gameOver: gameState.gameOver,
    winner: gameState.winner,
    // The code is revealed only once the round is over.
    code: gameState.gameOver ? gameState.code : null,
    pot: calculatePot(),
    jackpotEnabled: cfg.jackpot.enabled,
    roundStartedAt: gameStartTime,
    totalRoundsPlayed,
    lastWinner,
    connectedPlayers,
  };
}

// ─── Monthly hint generation ──────────────────────────────────────────────
// Reveal one colour fact about the current secret: either a colour that IS
// present or a colour that is NOT present. In a Mastermind game this is a
// strong but fair hint — it narrows the palette without giving away a slot.

function generateHintForColour500() {
  const state = gameState;
  if (state.gameOver || !state.code.length) return null;

  const palette = mm.getPalette(state.paletteSize);
  const codeSet = new Set(state.code);
  const present = Array.from(codeSet);
  const absent = [];
  for (let i = 0; i < state.paletteSize; i++) {
    if (!codeSet.has(i)) absent.push(i);
  }

  // Prefer revealing a colour that is in the code.
  if (present.length) {
    const idx = present[Math.floor(Math.random() * present.length)];
    return {
      type: 'present',
      colorIndex: idx,
      colorName: palette[idx].name,
      colorLetter: palette[idx].letter,
      colorHex: palette[idx].hex,
      message: `${palette[idx].name} is in the code`,
    };
  }
  if (absent.length) {
    const idx = absent[Math.floor(Math.random() * absent.length)];
    return {
      type: 'absent',
      colorIndex: idx,
      colorName: palette[idx].name,
      colorLetter: palette[idx].letter,
      colorHex: palette[idx].hex,
      message: `${palette[idx].name} is not in the code`,
    };
  }
  return null;
}

// ─── Guess processing ─────────────────────────────────────────────────────

/**
 * Score one guess and, if it cracks the code, end the round.
 *
 * Silently ignores anything that isn't a well-formed guess — chat is full of
 * ordinary conversation and none of it should produce feedback or noise.
 */
async function processGuess(username, displayName, profilePic, platform, message,
                            userId, linkedDiscord, socket, isFanClub, isSuperfan) {
  return processOwnedGuess(null, username, displayName, profilePic, platform, message,
    userId, linkedDiscord, socket, isFanClub, isSuperfan);
}
function calculateSessionPot(session) { return recovery.pot(session.gameState, session); }
function sessionState(session) {
  return sessions.publicState(session, cfg, calculateSessionPot(session));
}
async function processSessionGuess(session, username, displayName, profilePic, platform,
                                   message, userId, linkedDiscord, isFanClub, isSuperfan, socket = null) {
  return processOwnedGuess(session, username, displayName, profilePic, platform, message,
    userId, linkedDiscord, socket, isFanClub, isSuperfan);
}
async function processOwnedGuess(session, username, displayName, profilePic, platform, message,
                                 userId, linkedDiscord, socket, isFanClub, isSuperfan) {
  const g = session ? session.gameState : gameState;
  if (!g || g.gameOver) return { ok: false, reason: 'round-over' };
  recovery.ensure(g, session);
  const parsed = mm.parseGuess(message, { codeLength: g.codeLength, paletteSize: g.paletteSize,
    requireLetterPrefix: cfg.requireLetterPrefix });
  if (!parsed.ok) return { ok: false, reason: 'invalid-guess' };
  const key = mm.codeKey(parsed.code);
  if (g.guesses.some(row => row.key === key)) return { ok: false, reason: 'duplicate' };
  if (g.guesses.length >= MAX_BOARD_GUESSES) return { ok: false, reason: 'board-full' };
  const cosmetics = await gameShared.getPlayerCosmetics(platform, userId || username);
  if (session ? sessions.get(session.handle) !== session || session.gameState !== g : gameState !== g)
    return { ok: false, reason: 'round-changed' };
  if (g.gameOver || g.guesses.length >= MAX_BOARD_GUESSES || g.guesses.some(row => row.key === key))
    return { ok: false, reason: g.gameOver ? 'round-over' : 'duplicate-or-full' };
  const { exact, misplaced } = mm.scoreGuess(parsed.code, g.code);
  const perks = socket?._wtPerks || {};
  const guessData = { key, code: parsed.code, symbols: mm.formatCode(parsed.code),
    letters: mm.formatLetters(parsed.code), exact, misplaced, absent: g.codeLength - exact - misplaced,
    pegs: mm.formatScore(exact, misplaced), via: parsed.via, displayName: displayName || username,
    profilePic: profilePic || null, platform, platformUserId: userId || username, cosmetics,
    isFanClub: !!isFanClub || !!perks.isFanClub, isSuperfan: !!isSuperfan || !!perks.isSuperfan,
    isDonor: !!perks.isDonor, at: Date.now() };
  const before = JSON.parse(JSON.stringify(g));
  try {
    g.guesses.push(guessData);
    if (exact === g.codeLength) {
      g.gameOver = true;
      g.winner = { displayName: guessData.displayName, profilePic: guessData.profilePic, platform,
        platformUserId: guessData.platformUserId, linkedDiscord: linkedDiscord || null, cosmetics,
        isFanClub: guessData.isFanClub, isSuperfan: guessData.isSuperfan, isDonor: guessData.isDonor };
    }
    recovery.accept(g, session);
  } catch (error) {
    for (const name of Object.keys(g)) delete g[name]; Object.assign(g, before); throw error;
  }
  if (session) sessions.scheduleSave();
  const room = session ? sessions.roomFor(session.handle) : 'public';
  io.to(room).emit('guess', guessData);
  if (!g.gameOver) return { ok: true, row: guessData };
  const pot = recovery.pot(g, session), totalWins = session?.noRewards ? 0 : getWinCount(guessData.platformUserId);
  io.to(room).emit('game-over', { winner: g.winner, code: g.code, symbols: mm.formatCode(g.code),
    letters: mm.formatLetters(g.code), guessCount: g.guesses.length, totalWins, pot });
  const win = { game: GAME_ID, gameName: GAME_NAME, word: mm.formatCode(g.code), winner: g.winner,
    jackpot: pot, guessCount: g.guesses.length, totalWins, ...(session ? { streamerHandle: session.handle } : {}) };
  if (session) io.to(room).emit('game-win', win);
  if (chatRelay?.connected) chatRelay.emit('game-win', win);
  if (session) scheduleSessionRound(session); else schedulePublicRound(g);
  return { ok: true, row: guessData, gameOver: true, pot };
}
function scheduleSessionRound(session, retry = false) {
  const state = session.gameState, prior = sessionTimers.get(session.handle);
  if (prior?.state === state && !retry) return;
  if (prior) clearTimeout(prior.timer);
  const delay = retry ? 5000 : Math.max(0, (state.wonAt || Date.now()) + cfg.newGameDelayMs - Date.now());
  const timer = setTimeout(() => {
    sessionTimers.delete(session.handle);
    if (sessions.get(session.handle) !== session || session.gameState !== state || !state.gameOver) return;
    try { sessions.startNextRound(session, cfg); io.to(sessions.roomFor(session.handle)).emit('game-state', sessionState(session)); }
    catch (_) { scheduleSessionRound(session, true); }
  }, delay); timer.unref?.(); sessionTimers.set(session.handle, { state, timer });
}

/** Route a streamer-tagged chat message into that streamer's own round. */
async function handleSessionChat(data) {
  const handle = String(data.streamerHandle || '').toLowerCase();
  if (!sessions.isValidHandle(handle) || !_isValidStreamer(handle)) return;

  const session = sessions.getOrCreate(handle, cfg);
  if (session.gameState.gameOver) scheduleSessionRound(session);
  const isFanClub = Array.isArray(data.user.badges)
    && data.user.badges.indexOf('fan-club') !== -1;
  const isSuperfan = Array.isArray(data.user.badges)
    && data.user.badges.indexOf('superfan') !== -1;

  await processSessionGuess(
    session,
    data.user.username,
    data.user.customNick || data.user.displayName || data.user.username,
    data.user.profilePic,
    data.platform || 'unknown',
    data.message,
    data.user.id,
    data.linkedDiscord || null,
    isFanClub,
    isSuperfan
  );
}

// ─── HTTP API ─────────────────────────────────────────────────────────────

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
    console.error('[Colour500] whoami failed:', e.message);
  }
  return null;
}

// Public state — polled by chat-relay's app registry and the dashboard.
app.get('/api/state', (req, res) => res.json(getPublicState()));

// Admin state additionally reveals the live secret.
app.get('/api/admin-state', requireAdmin, (req, res) => {
  res.json({
    ...getPublicState(),
    code: gameState.code,
    secretLetters: mm.formatLetters(gameState.code),
    secretSymbols: mm.formatCode(gameState.code),
    config: cfg,
  });
});

// Board shape and pacing. Reads are public (the page needs the palette);
// writes require the admin key. Changes apply to the NEXT round unless
// ?applyNow=1 is passed, which restarts the round immediately.
app.get('/api/config', (req, res) => res.json(config.get()));

app.post('/api/config', requireAdmin, (req, res) => {
  const applyNow = req.query.applyNow === '1' || req.body?.applyNow === true;
  let updated;
  try { updated = config.prepare(req.body || {}); }
  catch (_) { return res.status(400).json({ ok: false, error: 'invalid-config' }); }
  const prior = cfg, shapeChanged = updated.codeLength !== gameState.codeLength
    || updated.paletteSize !== gameState.paletteSize || updated.allowDuplicates !== gameState.allowDuplicates;
  cfg = updated;
  try { if (applyNow) startNewGame(); else recovery.savePublicMetadata(gameState); }
  catch (_) { cfg = prior; return res.status(503).json({ ok: false, error: 'storage-unavailable' }); }
  config.setAccepted(updated); config.save();
  res.json({ ok: true, config: updated, appliedNow: applyNow, pendingUntilNextRound: !applyNow && shapeChanged });
});
app.post('/api/new-game', requireAdmin, (req, res) => {
  try { startNewGame(); res.json({ ok: true, state: getPublicState() }); }
  catch (_) { res.status(503).json({ ok: false, error: 'storage-unavailable' }); }
});

app.get('/api/stats', (req, res) => {
  const history = loadWinHistory();
  res.json({
    totalRoundsPlayed,
    historyCount: history.length,
    recent: history.slice(-25).reverse(),
    lastWinner,
  });
});

// ─── Monthly hints (fleet-wide Word Tycoon hint system) ─────────────────────

app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Colour500] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one colour fact about the current code.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const hint = generateHintForColour500();
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'colour500', label: 'Colour500 web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[Colour500] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

// Session identity for the web page. Chat Relay owns auth, so forward the
// caller's cookies upstream and relay the answer back verbatim.
app.get('/api/me/session', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/me/session`, {
      headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    // The relay refreshes its 30-day remember cookie on this call. Without
    // forwarding Set-Cookie the refresh is swallowed here and the visitor
    // eventually drops back to guest.
    const setCookie = typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
    if (setCookie.length) res.setHeader('Set-Cookie', setCookie);
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(200).json({ ok: false, user: null });
  }
});

// ─── Solo mode ────────────────────────────────────────────────────────────
// Daily puzzle + unlimited practice. The secret lives on the server (see
// src/solo.js) and only appears in a response once the round is over.
//
// The daily reward is granted by THIS server after it has verified the solve
// itself, rather than by the browser claiming a win — Chat Relay resolves the
// player's account from the cookies we forward, so a guest simply gets
// "Not logged in" back and earns nothing, which is correct.

const SP_GAME_ID = 'colour500-sp';

/** Pull the caller's solo token, or null if it's missing/malformed. */
function soloToken(req) {
  const raw = req.headers['x-solo-token'] || (req.body && req.body.token) || req.query.token;
  return solo.isValidToken(raw) ? String(raw) : null;
}

function forwardCookies(req) {
  return req.headers.cookie ? { cookie: req.headers.cookie } : {};
}

/** Has this (signed-in) player already done today's daily on another device? */
async function fetchDailyStatus(req, dateStr) {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-daily/status/${SP_GAME_ID}`, {
      headers: forwardCookies(req),
    });
    const data = await upstream.json().catch(() => null);
    if (data && data.ok && Array.isArray(data.completedDates)) {
      return data.completedDates.includes(dateStr);
    }
  } catch (_) { /* guests and outages both fall back to local-only */ }
  return false;
}

app.get('/api/solo/state', async (req, res) => {
  const token = soloToken(req);
  if (!token) return res.status(400).json({ ok: false, error: 'Missing or invalid solo token' });

  const mode = req.query.mode === 'practice' ? 'practice' : 'daily';
  const today = gameShared.getEdmontonDate();
  try {
    const userId = await resolveUserFromCookie(req);
    if (today !== gameShared.getEdmontonDate()) return res.status(409).json({ ok: false, error: 'round-changed' });
    const owner = userId && gameShared.isStatsEligible('discord', userId) ? String(userId) : null;
    const game = solo.getGame(token, mode, today, owner);
    const record = game.rewardEventId ? gameShared.getPlayerRewardDelivery(game.rewardEventId) : null;
    const payload = { ok: true, today, ...solo.publicState(game), ...(game.rewardEventId ? {
      reward: { ok: true, rewardEventId: game.rewardEventId, rewardPending: record?.state !== 'delivered' }
    } : {}) };
    if (mode === 'daily') payload.dailyCompletedElsewhere = await fetchDailyStatus(req, today);
    res.json(payload);
  } catch (_) { res.status(503).json({ ok: false, error: 'storage-unavailable' }); }
});

app.post('/api/solo/guess', async (req, res) => {
  const token = soloToken(req);
  if (!token || typeof req.body?.guess !== 'string' || req.body.guess.length > 96)
    return res.status(400).json({ ok: false, error: 'Invalid solo input' });
  const mode = req.body.mode === 'practice' ? 'practice' : 'daily', today = gameShared.getEdmontonDate();
  try {
    const userId = await resolveUserFromCookie(req);
    if (today !== gameShared.getEdmontonDate()) return res.status(409).json({ ok: false, error: 'round-changed' });
    const owner = userId && gameShared.isStatsEligible('discord', userId) ? String(userId) : null;
    const game = solo.getGame(token, mode, today, owner);
    const result = solo.submitGuess(game, req.body.guess, owner);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
    const record = game.rewardEventId ? gameShared.getPlayerRewardDelivery(game.rewardEventId) : null;
    const reward = game.rewardEventId ? { ok: true, rewardEventId: game.rewardEventId,
      rewardPending: record?.state !== 'delivered' } : null;
    res.json({ ok: true, row: result.row, reward, ...solo.publicState(game) });
  } catch (_) { res.status(503).json({ ok: false, error: 'storage-unavailable' }); }
});
app.post('/api/solo/new', (req, res) => {
  const token = soloToken(req);
  if (!token) return res.status(400).json({ ok: false, error: 'Missing or invalid solo token' });
  try { res.json({ ok: true, ...solo.publicState(solo.newPractice(token, gameShared.getEdmontonDate())) }); }
  catch (_) { res.status(503).json({ ok: false, error: 'storage-unavailable' }); }
});

// ─── Session admin (called by Chat Relay on game switch / stream end) ─────

app.get('/api/session/state/:handle', requireAdmin, (req, res) => {
  const s = sessions.get(req.params.handle);
  if (!s) return res.json({ ok: false, error: 'No session' });
  res.json({ ok: true, ...sessionState(s), code: s.gameState.code });
});

// Read-only view of a session's secret for internal consumers — mirrors the
// GET /api/session/target contract Searchle and Word 5000 expose, so Chat
// Relay's bot-players module can treat every game alike. The board (each
// guess plus its peg score) is included because a Mastermind bot cannot make
// a sensible guess without the feedback history; `targetCode` is the letter
// form (RGBY) so a consumer can compare rounds as a plain string.
// Returns a null target when the session doesn't exist yet.
app.get('/api/session/target', requireAdmin, (req, res) => {
  const handle = String((req.query && req.query.handle) || '').toLowerCase().trim();
  if (!sessions.isValidHandle(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const s = sessions.get(handle);
  const g = s && s.gameState;
  if (!g) return res.json({ ok: true, handle, targetCode: null, isWon: false });
  res.json({
    ok: true,
    handle,
    targetCode: mm.formatLetters(g.code),
    code: g.code,
    isWon: !!g.gameOver,
    codeLength: g.codeLength,
    paletteSize: g.paletteSize,
    boardFull: g.guesses.length >= sessions.MAX_BOARD_GUESSES,
    guesses: g.guesses.map((x) => ({ code: x.code, exact: x.exact, misplaced: x.misplaced })),
  });
});

app.post('/api/session/end', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase();
  const ended = sessions.end(handle);
  io.to(sessions.roomFor(handle)).emit('session-ended', { handle });
  res.json({ ok: true, ended });
});

// The streamer switched to a different game — send this round's viewers there.
app.post('/api/session/redirect', requireAdmin, (req, res) => {
  const b = req.body || {};
  const handle = String(b.handle || '').toLowerCase();
  if (!sessions.isValidHandle(handle)) return res.status(400).json({ ok: false });
  const target = {
    targetUrl: String(b.targetUrl || ''),
    targetGameName: String(b.targetGameName || ''),
    targetGameId: String(b.targetGameId || ''),
  };
  // Stored as well as emitted, so refreshers and late arrivals see the modal.
  _streamerRedirectTargets.set(handle, target);
  io.to(sessions.roomFor(handle)).emit('session-redirect', { handle, ...target });
  res.json({ ok: true });
});

app.post('/api/session/clear-redirect', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase();
  _streamerRedirectTargets.delete(handle);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/solo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'solo.html')));

// ─── Session URLs ─────────────────────────────────────────────────────────
// /overlay/<handle> is the OBS view (board only); /<handle> is the player
// page. Both fail closed to the public game for unknown handles, so nobody
// can lazily create junk sessions by inventing a URL.

app.get(/^\/overlay\/([a-z0-9_-]{1,32})$/, (req, res) => {
  const handle = String(req.params[0] || '').toLowerCase();
  if (!_isValidStreamer(handle)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get(/^\/([a-z0-9_-]{1,32})$/, (req, res, next) => {
  const handle = String(req.params[0] || '').toLowerCase();
  // Never shadow a real file or a known route.
  if (handle === 'solo' || handle === 'overlay' || handle === 'favicon.ico') return next();
  if (!_isValidStreamer(handle)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.IO — web players ──────────────────────────────────────────────
function validBrowserFrame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.guess !== 'string'
      || !data.guess || data.guess.length > 96 || !data.user || typeof data.user !== 'object' || Array.isArray(data.user)) return false;
  const user = data.user;
  return typeof user.id === 'string' && user.id.length > 0 && user.id.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(user.id)
    && (user.platformUserId === undefined || typeof user.platformUserId === 'string' && user.platformUserId.length <= 128)
    && (user.username === undefined || typeof user.username === 'string' && user.username.length <= 80)
    && (user.displayName === undefined || typeof user.displayName === 'string' && user.displayName.length <= 80);
}
io.on('connection', (socket) => {
  const raw = socket.handshake?.auth?.session;
  const handle = typeof raw === 'string' ? raw.toLowerCase().trim() : null;
  let session = null;
  if (handle && sessions.isValidHandle(handle)) {
    if (!_isValidStreamer(handle)) { socket.emit('game-state', { error: 'Unknown streamer', isSession: true }); return; }
    const redirect = _streamerRedirectTargets.get(handle);
    if (redirect) { socket.emit('session-redirect', { handle, ...redirect }); return; }
    try { session = sessions.getOrCreate(handle, cfg); }
    catch (_) { socket.emit('guess-result', { ok: false, reason: 'storage-unavailable' }); return; }
    socket._sessionHandle = handle; socket.join(sessions.roomFor(handle));
    socket.emit('game-state', sessionState(session));
    if (session.gameState.gameOver) scheduleSessionRound(session);
  } else { socket.join('public'); connectedPlayers++; socket.emit('game-state', getPublicState()); }
  socket.on('play-guess', async (data) => {
    if (!validBrowserFrame(data)) { socket.emit('guess-result', { ok: false, reason: 'invalid-frame' }); return; }
    const capturedSession = session ? sessions.get(handle) : null;
    const captured = session ? capturedSession?.gameState : gameState;
    try {
      if (!(await gameShared.passesPremiumWebGate([data.user.id, data.user.platformUserId], socket, session ? 'session' : 'mp'))) {
        socket.emit('guess-result', { ok: false, reason: 'premium-required' }); return;
      }
      if (!captured || (session ? capturedSession !== session || sessions.get(handle) !== session || session.gameState !== captured : gameState !== captured)) {
        socket.emit('guess-result', { ok: false, reason: 'round-changed' }); return;
      }
      const recipient = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId;
      if (typeof recipient !== 'string' || !recipient) { socket.emit('guess-result', { ok: false, reason: 'auth-required' }); return; }
      gameShared.reportSocketIP(socket, 'web', recipient, GAME_ID);
      const args = [data.user.username || recipient, data.user.displayName || data.user.username || 'Player',
        null, 'web', data.guess, recipient, null];
      const result = session ? await processSessionGuess(session, ...args, false, false, socket)
        : await processGuess(...args, socket, false, false);
      socket.emit('guess-result', result);
    } catch (_) { socket.emit('guess-result', { ok: false, reason: 'storage-unavailable' }); }
  });
  socket.on('disconnect', () => { if (!session) connectedPlayers = Math.max(0, connectedPlayers - 1); });
});
setInterval(() => {
  if (!gameState.gameOver) io.to('public').emit('pot-update', { pot: calculatePot() });
  for (const session of sessions.all()) if (!session.gameState.gameOver)
    io.to(sessions.roomFor(session.handle)).emit('pot-update', { pot: calculateSessionPot(session) });
}, 5000).unref();

// ─── Chat Relay ───────────────────────────────────────────────────────────

const chatRelay = gameShared.createRelayClient({
  id: GAME_ID,
  name: GAME_NAME,
  port: PORT,
  apiSecret: ADMIN_SECRET,
  relayUrl: CHAT_RELAY_URL,
}, {
  onChat: (data) => {
    if (!data || !data.user || typeof data.message !== 'string') return;
    // Streamer-tagged chat plays that streamer's OWN private round; it must
    // never reach the public board.
    if (data.streamerHandle) {
      handleSessionChat(data).catch(() => {});
      return;
    }

    const isFanClub = Array.isArray(data.user.badges)
      && data.user.badges.indexOf('fan-club') !== -1;

    processGuess(
      data.user.username,
      data.user.customNick || data.user.displayName || data.user.username,
      data.user.profilePic,
      data.platform || 'unknown',
      data.message,
      data.user.id,
      data.linkedDiscord || null,
      null,
      isFanClub
    ).catch(() => console.error('[Colour500] Guess not accepted'));
  },
});

// ─── Startup / shutdown ───────────────────────────────────────────────────

const restoredPublic = recovery.restorePublic();
if (restoredPublic) { gameState = restoredPublic.state; gameStartTime = gameState.startedAt; if (gameState.gameOver) schedulePublicRound(gameState); }
else startNewGame();
server.listen(PORT, () => {
  console.log(`[Colour500] ${GAME_NAME} running at http://localhost:${PORT}`);
  // Whitelist drives every /<handle> URL, so load it immediately and keep it
  // fresh. Until the first fetch lands the game fails closed (see above).
  _scheduleHandleRefresh(0);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Colour500] Shutting down...');
  if (newGameTimeout) clearTimeout(newGameTimeout);
  for (const entry of sessionTimers.values()) clearTimeout(entry.timer);
  recovery.stop(); solo.stop();
  try { chatRelay.disconnect(); } catch (_) {}
  server.close();
  console.log('[Colour500] Shutdown complete');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
