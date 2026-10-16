// server.js - WiKirecTangled. Express + Socket.IO + round lifecycle.
//
// One game at a time. When a round ends (all targets + title words revealed)
// we hold the result on screen for ~25 seconds, then build and broadcast the
// next round. Article-fetching happens in the background while a round plays
// so handoff between rounds is instant.

// Load .env before anything else reads process.env. PM2 doesn't auto-load
// .env files, so without this PORT and GAME_API_SECRET wouldn't take effect
// in production. Optional: dev machines without a .env still boot.
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }

const express = require('express');
const http = require('http');
const path = require('path');
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
const { Server } = require('socket.io');

const wordlist = require('./src/wordlist');
const db = require('./src/database');
const sessionManager = require('./src/session-manager');
const elo = require('./src/elo');
const relay = require('./src/relay-client');
const { RoundRunner } = require('./src/round-runner');
const { buildQuoteRound, buildCompactQuoteRound } = require('./src/quotes');
const roomManager = require('./src/room-manager');
const soloManager = require('./src/solo-manager');
const { publicRoundSummaries } = require('./src/public-round-metadata');
const webIdentity = require('./src/web-identity').createWebIdentity({ sdk: gameShared, sessions: sessionManager });
const dailyPuzzle = require('./src/daily-puzzle');

const PORT = parseInt(process.env.PORT || '3017', 10);

// Production origins. Add a host here once we deploy elsewhere. Localhost
// stays for dev. CORS_EXTRA_ORIGINS env var can append comma-separated extras
// (handy for staging) without a code change.
const ALLOWED_ORIGINS = new Set([
  'https://wikirectangled.com',
  'https://www.wikirectangled.com',
  'https://wikiword.live',
  'https://www.wikiword.live',
  'https://wordtycoon.live',
  'https://www.wordtycoon.live',
  'http://localhost:3017',
  'http://127.0.0.1:3017',
]);
for (const o of String(process.env.CORS_EXTRA_ORIGINS || '').split(',')) {
  const trimmed = o.trim();
  if (trimmed) ALLOWED_ORIGINS.add(trimmed);
}
function corsCheck(origin, cb) {
  // No origin = same-origin / curl / server-to-server — always allow.
  if (!origin) return cb(null, true);
  if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
  return cb(new Error(`CORS rejected: ${origin}`));
}

const app = express();
// Behind nginx: trust the first proxy hop so req.ip + secure cookies work.
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsCheck } });
gameShared.init({ wordEmpiresUrl: process.env.WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

// Per-handle redirect targets set by chat-relay when the streamer switches
// active game away from WiKirec. Viewers attaching with auth.session=<handle>
// after that point get a session-redirect modal instead of joining a stale
// room. Cleared via /api/session/clear-redirect when streamer returns.
const _streamerRedirectTargets = new Map();
const _ADMIN_SECRET = process.env.GAME_API_SECRET;
function _requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.headers['x-admin-key'] || req.query.adminKey;
  if (key === _ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

app.use(express.json());
// Root domain switch: wikiword.live serves the WikiWord page directly.
app.use((req, res, next) => {
  if (req.path === '/' && /^(www\.)?wikiword\.live$/i.test(req.hostname)) {
    return res.sendFile(path.join(__dirname, 'public', 'wikiword.html'));
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// The public-game runner. Streamer rooms get their own runners via room-manager.
let publicRunner = null;
// Separate WikiWord runner: smaller board, no podium, independent public game.
let wikiwordRunner = null;
// WikiWord 4x4 runner: single target word on a 4x4 grid, compact layout.
let wikiword4x4Runner = null;

// ---- Round / room broadcasts ------------------------------------------------
//
// Public game broadcasts to the default Socket.IO room. Streamer rooms broadcast
// to `streamer:<handle>` so /streamer/<handle> viewers subscribe via a separate
// channel. The RoundRunner constructor is told which to use.

function publicBroadcast(event, payload) {
  io.to("public").emit(event, payload);
}

function publicState() {
  return publicRunner ? publicRunner.publicState() : null;
}

function wikiwordBroadcast(event, payload) {
  io.to("wikiword").emit(event, payload);
}

function wikiwordState() {
  return wikiwordRunner ? wikiwordRunner.publicState() : null;
}

function wikiword4x4Broadcast(event, payload) {
  io.to("wikiword-4x4").emit(event, payload);
}

function wikiword4x4State() {
  return wikiword4x4Runner ? wikiword4x4Runner.publicState() : null;
}

// Helper: pick the runner that owns a web socket's game mode.
function runnerFor(socket) {
  if (socket.data.gameMode === 'wikiword-4x4') {
    if (socket.data.streamerHandle) {
      const room = roomManager.getRoom(socket.data.streamerHandle, 'wikiword-4x4');
      return room ? room.runner : wikiword4x4Runner;
    }
    return wikiword4x4Runner;
  }
  if (socket.data.gameMode === 'wikiword') return wikiwordRunner;
  if (socket.data.streamerHandle) {
    const room = roomManager.getRoom(socket.data.streamerHandle);
    return room ? room.runner : publicRunner;
  }
  return publicRunner;
}

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public web MULTIPLAYER guessing requires Donor Class / TikTok Super Fan.
// The daily + practice solo stays free, streamer-session play stays free,
// and chat-platform guesses (relay chat + bots) arrive via
// processGuessFromChat — none of those touch this gate.
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';

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
    console.error('[WikiRectangled] whoami failed:', e.message);
  }
  return null;
}

// Returns true when the web guess may proceed; otherwise emits
// premium-required to the socket and returns false. The check itself lives in
// chat-relay's game-shared.js (2026-07-31) so every game gates identically —
// it replaces a local test that only accepted platform === 'discord' and so
// hard-blocked gh_/google_/tt_ logins whose subscription is on a linked
// account.
async function passesPremiumWebGate(socket, context = 'mp') {
  // Daily 3 offers one anonymous WikiWord 4x4 target as a free acquisition
  // preview. The identify handler deliberately strips account identity, so
  // this bypass cannot earn Word Tycoon coins, library entries, or account stats.
  if (socket.data.daily3Preview && socket.data.gameMode === 'wikiword-4x4') return true;
  const s = socket.data.session || {};
  // An ANONYMOUS web session gets a random sessionId as its platformUserId
  // (session-manager.resolveWebSession) with platform 'web'. That id looks
  // like a real account id to the shared gate, which would burn a relay
  // lookup and — worse — report loggedIn:true, hiding the wall's Sign-in
  // button from someone who has not signed in. Only forward the id when the
  // session carries a real auth platform.
  const id = s.platform && s.platform !== 'web' ? s.platformUserId : null;
  if (!(await gameShared.passesPremiumWebGate([id], socket, context))) return false;
  if (socket.data.session !== s || !(await webIdentity.authorize(socket))) return false;
  // Perk badges ride the session down to round-runner, which already
  // reads session.isFanClub when calling game.guess().
  Object.assign(s, socket._wtPerks || {});
  return true;
}

// Web socket guesses target either the public or the WikiWord runner.
async function processGuessFromWeb({ session, word, authorize }) {
  if (!publicRunner) return null;
  sessionManager.touch(session.sessionId);
  return publicRunner.processGuess({ session, word, authorize });
}

async function processBatchFromWeb({ session, words, authorize }) {
  if (!publicRunner) return null;
  sessionManager.touch(session.sessionId);
  return publicRunner.processBatch({ session, words, authorize });
}

async function processGuessFromWikiwordWeb({ session, word, authorize }) {
  if (!wikiwordRunner) return null;
  sessionManager.touch(session.sessionId);
  return wikiwordRunner.processGuess({ session, word, authorize });
}

async function processBatchFromWikiwordWeb({ session, words, authorize }) {
  if (!wikiwordRunner) return null;
  sessionManager.touch(session.sessionId);
  return wikiwordRunner.processBatch({ session, words, authorize });
}

async function processGuessFromWikiword4x4Web({ session, word, streamerHandle, authorize }) {
  if (streamerHandle) {
    const room = roomManager.getRoom(streamerHandle, 'wikiword-4x4') || await roomManager.getOrCreateRoom(streamerHandle, 'wikiword-4x4');
    if (!room) return null;
    sessionManager.touch(session.sessionId);
    return room.runner.processGuess({ session, word, authorize });
  }
  if (!wikiword4x4Runner) return null;
  sessionManager.touch(session.sessionId);
  return wikiword4x4Runner.processGuess({ session, word, authorize });
}

async function processBatchFromWikiword4x4Web({ session, words, streamerHandle, authorize }) {
  if (streamerHandle) {
    const room = roomManager.getRoom(streamerHandle, 'wikiword-4x4') || await roomManager.getOrCreateRoom(streamerHandle, 'wikiword-4x4');
    if (!room) return null;
    sessionManager.touch(session.sessionId);
    return room.runner.processBatch({ session, words, authorize });
  }
  if (!wikiword4x4Runner) return null;
  sessionManager.touch(session.sessionId);
  return wikiword4x4Runner.processBatch({ session, words, authorize });
}

// Chat-relay messages may carry a `streamerHandle` — if so, route to that
// streamer's private room (creating it on first hit). A resolved `gameId`
// (e.g. 'wikirectangled-wikiword') can override that routing and send the guess to
// a special public runner instead. Otherwise fall through to the public game.
async function processGuessFromChat({ session, words, word, streamerHandle, gameId }) {
  // Accept either `words` (batch) or legacy `word` (single).
  const list = Array.isArray(words) && words.length ? words : (word ? [word] : []);
  if (!list.length) return null;
  if ((gameId === 'wikirectangled-wikiword' || gameId === 'wikiword') && wikiwordRunner) {
    sessionManager.touch(session.sessionId);
    return wikiwordRunner.processBatch({ session, words: list });
  }
  if (gameId === 'wikiword-4x4' && streamerHandle) {
    const room = await roomManager.getOrCreateRoom(streamerHandle, 'wikiword-4x4');
    if (!room) return null;
    sessionManager.touch(session.sessionId);
    return room.runner.processBatch({ session, words: list });
  }
  if (gameId === 'wikiword-4x4' && wikiword4x4Runner) {
    sessionManager.touch(session.sessionId);
    return wikiword4x4Runner.processBatch({ session, words: list });
  }
  if (streamerHandle) {
    const room = await roomManager.getOrCreateRoom(streamerHandle);
    if (!room) return null;
    sessionManager.touch(session.sessionId);
    return room.runner.processBatch({ session, words: list });
  }
  if (!publicRunner) return null;
  sessionManager.touch(session.sessionId);
  return publicRunner.processBatch({ session, words: list });
}

// ---- Socket.IO wiring --------------------------------------------------------

io.on('connection', async (socket) => {
  socket.data.session = null;
  const handshakeAuth = (socket.handshake && socket.handshake.auth) || {};
  socket.data.daily3Preview = handshakeAuth.mode === 'wikiword-4x4' && handshakeAuth.daily3 === true;

  // Streamer-private session viewer attach via handshake — matches the
  // RecTangled / WikiSearchle family convention. The client passes
  //   io({ auth: { session: '<handle>' } })
  // when the user lands on `https://wikirectangled.com/<handle>`. The server
  // lazy-creates the room (so a viewer can land before any chat arrives),
  // joins the per-room broadcast channel, and emits initial state.
  const sessionHandleRaw = socket.handshake && socket.handshake.auth && socket.handshake.auth.session;
  const sessionHandle = typeof sessionHandleRaw === 'string'
    ? sessionHandleRaw.toLowerCase().trim() : null;
  const handshakeMode = socket.handshake && socket.handshake.auth && socket.handshake.auth.mode;
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    const streamerMode = handshakeMode === 'wikiword-4x4' ? 'wikiword-4x4' : 'streamer';
    socket.data.streamerHandle = sessionHandle;
    socket.data.gameMode = streamerMode;
    // Persistent redirect: streamer moved to another game — send modal.
    const _redir = _streamerRedirectTargets.get(sessionHandle);
    if (_redir) {
      socket.emit('session-redirect', { handle: sessionHandle, ..._redir });
    }
    socket.join(`streamer:${sessionHandle}`);
    try {
      const room = await roomManager.getOrCreateRoom(sessionHandle, streamerMode);
      socket.emit('streamer-state', {
        handle: sessionHandle,
        state: room && room.runner ? room.runner.publicState() : null,
      });
    } catch (e) {
      console.log(`[Socket] session attach failed for "${sessionHandle}": ${e.message}`);
      socket.emit('streamer-state', { handle: sessionHandle, state: null });
    }
    // Streamer-viewer sockets attach to their room channel only and skip the
    // public hello broadcast.
  } else {
    const mode = socket.handshake && socket.handshake.auth && socket.handshake.auth.mode;
    if (mode === 'wikiword-4x4') {
      socket.data.gameMode = 'wikiword-4x4';
      socket.join("wikiword-4x4");
      socket.emit("hello", { state: wikiword4x4State() });
    } else if (mode === 'wikiword') {
      socket.data.gameMode = 'wikiword';
      socket.join("wikiword");
      socket.emit("hello", { state: wikiwordState() });
    } else {
      socket.data.gameMode = 'public';
      socket.join("public");
      socket.emit("hello", { state: publicState() });
    }
  }

  socket.on('identify', async (msg) => {
    // The preview is always a guest session, even in a signed-in browser.
    let session;
    try { session = await webIdentity.resolve(socket, msg || {}); }
    catch (_) { socket.emit('identity-required', { reason: 'identity_unavailable' }); return; }
    if (!session) return;
    socket.emit('identified', {
      sessionId: session.sessionId,
      identityKey: session.identityKey,
      displayName: session.displayName,
      profileImage: session.profileImage,
    });
  });

  socket.on('update-profile', (msg) => {
    if (!socket.data.session) return;
    sessionManager.updateProfile(socket.data.session, msg || {});
  });

  socket.on('guess', async (msg) => {
    if (!socket.data.session) {
      await webIdentity.resolve(socket, {});
      if (!socket.data.session) return;
    }
    if (msg && msg.displayName) {
      sessionManager.updateProfile(socket.data.session, { displayName: msg.displayName });
    }
    const owner = socket.data.session;
    const authorize = async () => socket.data.session === owner && await webIdentity.authorize(socket);
    // Route to streamer room if the socket attached via auth.session handshake;
    // otherwise into the public or WikiWord game based on the socket's mode.
    try {
      if (socket.data.streamerHandle) {
        // Premium gate (2026-07-31): page play in a streamer room is
        // Donor-only too. Chat play-along is unaffected — TikTok/Discord
        // guesses enter via processGuessFromChat, never through this socket.
        const roomMode = socket.data.gameMode === 'wikiword-4x4' ? 'wikiword-4x4' : 'streamer';
        if (!(await passesPremiumWebGate(socket, roomMode === 'wikiword-4x4' ? 'wikiword-4x4' : 'session'))) return;
        const room = roomManager.getRoom(socket.data.streamerHandle, roomMode);
        if (room && room.runner) {
          sessionManager.touch(socket.data.session.sessionId);
          await room.runner.processGuess({ session: owner, word: msg && msg.word, authorize });
        }
      } else if (socket.data.gameMode === 'wikiword-4x4') {
        if (!(await passesPremiumWebGate(socket, 'wikiword-4x4'))) return;
        await processGuessFromWikiword4x4Web({ session: owner, word: msg && msg.word, authorize });
      } else if (socket.data.gameMode === 'wikiword') {
        if (!(await passesPremiumWebGate(socket, 'wikiword'))) return;
        await processGuessFromWikiwordWeb({ session: owner, word: msg && msg.word, authorize });
      } else {
        if (!(await passesPremiumWebGate(socket))) return;
        await processGuessFromWeb({ session: owner, word: msg && msg.word, authorize });
      }
    } catch (e) {
      console.log(`[Socket] guess handler error: ${e.message}`);
    }
  });

  socket.on('batch-guess', async (msg) => {
    if (!socket.data.session) {
      await webIdentity.resolve(socket, {});
      if (!socket.data.session) return;
    }
    if (msg && msg.displayName) {
      sessionManager.updateProfile(socket.data.session, { displayName: msg.displayName });
    }
    const owner = socket.data.session;
    const authorize = async () => socket.data.session === owner && await webIdentity.authorize(socket);
    const words = Array.isArray(msg && msg.words) ? msg.words : [];
    if (!words.length) return;
    try {
      if (socket.data.streamerHandle) {
        const roomMode = socket.data.gameMode === 'wikiword-4x4' ? 'wikiword-4x4' : 'streamer';
        if (!(await passesPremiumWebGate(socket, roomMode === 'wikiword-4x4' ? 'wikiword-4x4' : 'session'))) return;
        const room = roomManager.getRoom(socket.data.streamerHandle, roomMode);
        if (room && room.runner) {
          sessionManager.touch(socket.data.session.sessionId);
          await room.runner.processBatch({ session: owner, words, authorize });
        }
      } else if (socket.data.gameMode === 'wikiword-4x4') {
        if (!(await passesPremiumWebGate(socket, 'wikiword-4x4'))) return;
        await processBatchFromWikiword4x4Web({ session: owner, words, authorize });
      } else if (socket.data.gameMode === 'wikiword') {
        if (!(await passesPremiumWebGate(socket, 'wikiword'))) return;
        await processBatchFromWikiwordWeb({ session: owner, words, authorize });
      } else {
        if (!(await passesPremiumWebGate(socket))) return;
        await processBatchFromWeb({ session: owner, words, authorize });
      }
    } catch (e) {
      console.log(`[Socket] batch-guess handler error: ${e.message}`);
    }
  });

  socket.on('request-state', () => {
    const runner = runnerFor(socket);
    socket.emit('state', runner ? runner.publicState() : null);
  });

  // Subscribe to a streamer room's broadcasts so the /streamer/<handle> viewer
  // page sees live state. Read-only — viewers can't submit guesses through the
  // streamer channel (only chat from that platform can).
  socket.on('watch-streamer', (msg) => {
    const handle = String((msg && msg.handle) || '').toLowerCase().trim();
    if (!handle) return;
    socket.join(`streamer:${handle}`);
    const room = roomManager.getRoom(handle);
    socket.emit('streamer-state', {
      handle,
      state: room && room.runner ? room.runner.publicState() : null,
    });
  });

  socket.on('unwatch-streamer', (msg) => {
    const handle = String((msg && msg.handle) || '').toLowerCase().trim();
    if (handle) socket.leave(`streamer:${handle}`);
  });

  // Skip the current round-end countdown — used by the "Skip to next round"
  // button. Anyone may trigger; if a vote-to-skip is wanted later, gate here.
  socket.on('skip-round', () => {
    const runner = runnerFor(socket);
    if (runner && runner.nextRoundTimer) {
      clearTimeout(runner.nextRoundTimer);
      runner.nextRoundTimer = null;
      runner.startRound();
    }
  });

  // ---- Solo (per-player daily / practice) -----------------------------------

  socket.on('start-solo', async (msg, ack) => {
    if (!socket.data.session) await webIdentity.resolve(socket, {});
    if (!(await webIdentity.authorize(socket))) { if (typeof ack === 'function') ack({ ok: false, error: 'identity_required' }); return; }
    const owner = socket.data.session;
    const mode = (msg && msg.mode) === 'daily' ? 'daily' : 'practice';
    try {
      const s = await soloManager.startSolo({ session: owner, mode });
      if (socket.data.session !== owner || !(await webIdentity.authorize(socket))) { if (typeof ack === 'function') ack({ ok: false, error: 'identity_changed' }); return; }
      socket.data.solo = { mode, identityKey: s.identityKey, runId: s.runId };
      const state = soloManager.publicSoloState(s);
      socket.emit('solo-state', state);
      if (s.completed) socket.emit('solo-end', { reason: 'complete', recovered: true });
      if (typeof ack === 'function') ack({ ok: true, runId: s.runId, completed: !!s.completed });
    } catch (e) {
      console.log(`[Solo] start failed: ${e.message}`);
      if (typeof ack === 'function') ack({ ok: false, error: 'start_unavailable' });
    }
  });

  socket.on('solo-guess', async (msg, ack) => {
    const reply = (ok, error) => { if (typeof ack === 'function') ack({ ok, ...(error ? { error } : {}) }); };
    const ctx = socket.data.solo;
    if (!ctx || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'identity_required'); return; }
    const word = msg && msg.word;
    if (!word || String(word).length > 128) { reply(false, 'invalid_word'); return; }
    try {
      const result = await soloManager.processSoloGuess({ identityKey: ctx.identityKey, mode: ctx.mode, runId: ctx.runId, actionId: msg.actionId || null, word, authorize: () => webIdentity.authorize(socket, ctx) });
      if (!result || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'session_changed'); return; }
      const finalState = result.finalState;
      delete result.finalState;
      socket.emit('solo-result', result);
      const s = soloManager.getSolo(ctx.identityKey, ctx.mode);
      if (s && !s.completed) {
        socket.emit('solo-state', soloManager.publicSoloState(s));
      } else {
        // Game completed — solo session is gone after finalize, send the final
        // state (captured pre-finalize) + a complete marker for the wrap-up.
        if (finalState) socket.emit('solo-state', finalState);
        socket.emit('solo-end', { reason: 'complete', pbBumped: !!result.pbBumped });
      }
      reply(true);
    } catch (e) {
      socket.emit('solo-action-error', { error: 'save_failed' });
      reply(false, 'save_failed');
      console.log(`[Socket] solo-guess handler error: ${e.message}`);
    }
  });

  socket.on('solo-batch-guess', async (msg, ack) => {
    const reply = (ok, error) => { if (typeof ack === 'function') ack({ ok, ...(error ? { error } : {}) }); };
    const ctx = socket.data.solo;
    if (!ctx || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'identity_required'); return; }
    const words = Array.isArray(msg && msg.words) ? msg.words : [];
    if (!words.length) return;
    try {
      const { norms, rankMap } = await soloManager.preResolveBatchRanks({ identityKey: ctx.identityKey, mode: ctx.mode, words });
      for (let i = 0; i < norms.length; i++) {
        const norm = norms[i];
        const result = await soloManager.processSoloGuess({ identityKey: ctx.identityKey, mode: ctx.mode, runId: ctx.runId, actionId: msg.actionId ? msg.actionId + ':' + i : null, word: norm, preResolvedRank: rankMap.get(norm) || null, authorize: () => webIdentity.authorize(socket, ctx) });
        if (!result || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'session_changed'); return; }
        const finalState = result.finalState;
        delete result.finalState;
        socket.emit('solo-result', result);
        const s2 = soloManager.getSolo(ctx.identityKey, ctx.mode);
        if (s2 && !s2.completed) {
          socket.emit('solo-state', soloManager.publicSoloState(s2));
        } else {
          if (finalState) socket.emit('solo-state', finalState);
          socket.emit('solo-end', { reason: 'complete', pbBumped: !!result.pbBumped });
          break;
        }
        if (i < norms.length - 1) await new Promise((r) => setTimeout(r, 80));
      }
      reply(true);
    } catch (e) {
      socket.emit('solo-action-error', { error: 'save_failed' });
      reply(false, 'save_failed');
      console.log(`[Socket] solo-batch-guess handler error: ${e.message}`);
    }
  });

  socket.on('leave-solo', async (_msg, ack) => {
    const reply = (ok, error) => { if (typeof ack === 'function') ack({ok,...(error?{error}:{})}); };
    const ctx = socket.data.solo;
    if (!ctx || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'identity_required'); return; }
    try {
      await soloManager.endSolo(ctx.identityKey, ctx.mode, 'left', ctx.runId);
      if (socket.data.solo !== ctx || !(await webIdentity.authorize(socket, ctx))) { reply(false, 'session_changed'); return; }
      socket.data.solo = null; reply(true);
    } catch (_) { reply(false, 'save_failed'); }
  });

});

// ---- HTTP routes -------------------------------------------------------------

app.get('/api/state', (_req, res) => {
  res.json(publicState());
});

app.get('/api/health', (_req, res) => {
  const g = publicRunner && publicRunner.game;
  let pool = null;
  try { pool = require('./src/article').getPoolStats(); } catch (e) { /* article module may not be ready */ }
  res.json({
    ok: true,
    durability: db.rewardIntentionSummary(),
    hasGame: !!g,
    wordCount: wordlist.getWordCount(),
    article: g ? g.getState().articleTitle : null,
    roundId: g ? g.roundId : null,
    streamerRooms: roomManager.listRooms().length,
    pool,
  });
});

// Per-platform cosmetics proxy — clients fetch a finder's equipped cosmetics
// (word_color, word_glow, etc.) so the grid flash can reflect them. Matches
// the family pattern (rectangled, erectangled, etc.).
app.get('/api/cosmetics/:platform/:userId', async (req, res) => {
  try {
    let { platform, userId } = req.params;
    if (platform === 'web') platform = 'discord';
    const cosmetics = await gameShared.getPlayerCosmetics(platform, userId);
    res.json({ equipped: cosmetics || {} });
  } catch (e) {
    res.json({ equipped: {} });
  }
});

app.get('/api/rooms', (_req, res) => {
  res.json(roomManager.listRooms());
});

app.get('/api/rooms/:handle', (req, res) => {
  const room = roomManager.getRoom(req.params.handle);
  if (!room) return res.status(404).json({ error: 'no such room' });
  res.json({
    handle: room.handle,
    createdAt: room.createdAt,
    state: room.runner.publicState(),
  });
});

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
  res.json(db.getLeaderboard(limit));
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || '25', 10));
  res.json(publicRoundSummaries(db.getRecentRounds(limit)));
});

app.get('/api/round/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const detail = db.getRoundDetail(id);
  if (!detail) return res.status(404).json({ error: 'not found' });
  if (detail.round.status === 'active') return res.status(409).json({ error: 'active_round_hidden' });
  res.json(detail);
});

app.get('/api/stats', (_req, res) => {
  res.json(db.getStats());
});

app.get('/api/elo-status', (_req, res) => {
  res.json(elo.getStatus());
});

app.post('/api/session/redirect', _requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(handle, { targetUrl, targetGameName, targetGameId });
  io.to(`streamer:${handle}`).emit('session-redirect', { handle, targetUrl, targetGameName, targetGameId });
  res.json({ ok: true });
});

app.post('/api/session/clear-redirect', _requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

// Admin: force-end a streamer room. Next chat-message recreates it with
// a fresh round (retries semantic build if needed).
app.post('/api/session/end-room', _requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const mode = String((req.body && req.body.gameId) || '').toLowerCase() === 'wikiword-4x4' ? 'wikiword-4x4' : 'streamer';
  const ended = roomManager.endRoom(handle, mode, 'admin-skip');
  res.json({ ok: true, ended });
});

app.get('/api/relay-status', (_req, res) => {
  res.json(relay.getStats());
});

// /streamer/:handle/wikiword-4x4 serves the WikiWord 4×4 viewer for a streamer's room.
app.get('/streamer/:handle/wikiword-4x4', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wikiword-4x4.html'));
});

// /streamer/:handle serves the read-only viewer page for a streamer's room.
// Static streamer.html does the actual rendering — this route only exists to
// give nice URLs (the page reads the handle from window.location.pathname).
app.get('/streamer/:handle', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'streamer.html'));
});

// OBS browser-source overlay — same room as the streamer page, OBS-styled.
app.get('/overlay/:handle', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// /solo serves the daily + practice solo page.
app.get('/solo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'solo.html'));
});

// /wikiword serves the smaller-board WikiWord page.
app.get('/wikiword', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wikiword.html'));
});
// /wikiword-4x4 serves the compact 4x4 single-target variant.
app.get('/wikiword-4x4', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wikiword-4x4.html'));
});
// /wikiword-4x4/:handle serves the streamer-specific WikiWord 4×4 room.
app.get('/wikiword-4x4/:handle', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wikiword-4x4.html'));
});
// /mini redirects to the new /wikiword path.
app.get('/mini', (_req, res) => {
  res.redirect('/wikiword');
});

// Bare-handle streamer URL — matches RecTangled / WikiSearchle convention:
//   https://wikirectangled.com/<handle>  →  streamer.html
// Reserved set excludes anything already routed (api routes, /solo, /streamer,
// static asset folders, common bot-scanned paths). Adjust as new top-level
// routes appear.
const SESSION_RESERVED_HANDLES = new Set([
  'api', 'css', 'js', 'img', 'public',
  'solo', 'streamer', 'overlay', 'admin', 'wikiword', 'wikiword-4x4', 'mini',
  'index.html', 'streamer.html', 'solo.html', 'wikiword.html', 'wikiword-4x4.html', 'mini.html',
  'favicon.ico', 'robots.txt', 'sitemap.xml',
  'manifest.json', 'manifest.webmanifest', 'sw.js',
  'socket.io',
]);
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1);
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  res.sendFile(path.join(__dirname, 'public', 'streamer.html'));
});

// ── Monthly hint allowance ──────────────────────────────────────────────────
// Guests see 0 hints; authenticated players see their fleet-wide monthly pool.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[WikiRectangled] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend one monthly hint and reveal a useful word on the current board.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const mode = String((req.body && req.body.mode) || '').toLowerCase().trim();
  let hintRunner = null;
  if (mode === 'wikiword-4x4') hintRunner = wikiword4x4Runner;
  else if (mode === 'wikiword') hintRunner = wikiwordRunner;
  const hint = generateHint(handle || null, hintRunner);
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'wikirectangled', label: 'WiKirecTangled web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[WikiRectangled] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

function generateHint(handle, runner) {
  if (!runner) {
    runner = handle ? roomManager.getRoom(handle) : publicRunner;
  }
  if (!runner || !runner.game) return null;
  const g = runner.game;
  if (g.isComplete()) return null;

  // Prefer unrevealed title words — they unlock the article headline.
  if (g.titleWords && g.titleWords.length) {
    for (const w of g.titleWords) {
      if (!g.revealedTitleWords.has(w)) {
        const cells = g.allWords.get(w) || (g.targetPaths && g.targetPaths[w]) || [];
        if (cells && cells.length) {
          return { type: 'word', word: w, cells: [...cells], category: 'title' };
        }
      }
    }
  }

  // Then unfound article-body targets.
  if (g.targetByWord && g.targetByWord.size) {
    for (const [w] of g.targetByWord) {
      if (!g.foundTargets.has(w)) {
        const cells = g.allWords.get(w) || [];
        if (cells && cells.length) {
          return { type: 'word', word: w, cells: [...cells], category: 'target' };
        }
      }
    }
  }

  // Then a random unfound grid word, biased toward rarer tiers.
  const pools = [
    { map: g.ultraRareWords, found: g.foundUltra, category: 'ultra' },
    { map: g.rareWords, found: g.foundRare, category: 'rare' },
    { map: g.commonWords, found: g.foundCommon, category: 'common' },
    { map: g.hiddenWords, found: g.foundWords, category: 'hidden' },
    { map: g.threeLetterWords, found: g.foundWords, category: 'three' },
  ];
  for (const pool of pools) {
    if (!pool.map || !pool.map.size) continue;
    const candidates = [...pool.map.keys()].filter((w) => {
      if (pool.found && pool.found.has(w)) return false;
      if (g.foundWords && g.foundWords.has(w)) return false;
      return true;
    });
    if (candidates.length) {
      const w = candidates[Math.floor(Math.random() * candidates.length)];
      const cells = g.allWords.get(w) || [];
      if (cells && cells.length) {
        return { type: 'word', word: w, cells: [...cells], category: pool.category };
      }
    }
  }

  return null;
}

app.get('/api/daily', async (_req, res) => {
  try {
    const p = await dailyPuzzle.getOrBuildPuzzle();
    res.json({
      puzzleDate: p.puzzleDate, articleTitle: null,
      rows: p.rows, cols: p.cols, totalGridWords: p.totalGridWords,
      targetCount: p.targets.length, titleWordCount: p.titleWords.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/daily/leaderboard', async (req, res) => {
  const date = req.query.date || dailyPuzzle.getTodayDate();
  res.json({ date, leaderboard: db.getDailyLeaderboard(date, 50) });
});

app.get('/api/solo/sessions', _requireAdmin, (_req, res) => {
  res.json(soloManager.listSessions());
});

// ---- Boot --------------------------------------------------------------------

(async () => {
  console.log('[Boot] Initializing database...');
  await db.init();
  console.log('[Boot] Loading word list...');
  await wordlist.init();
  if (wordlist.getWordCount() < 1000) {
    console.error(`[Boot] Word list has only ${wordlist.getWordCount()} words. Cannot run.`);
    console.error('[Boot] Either run Chat Relay (provides the Word Bank API) or place a dictionary at data/dictionary.txt');
    process.exit(1);
  }
  console.log('[Boot] Building first round...');
  publicRunner = new RoundRunner({
    label: 'public',
    mode: 'public',
    broadcast: publicBroadcast,
    autoLoop: true,
  });
  wikiwordRunner = new RoundRunner({
    label: 'wikiword',
    mode: 'wikiword',
    broadcast: wikiwordBroadcast,
    autoLoop: true,
    enableElo: false,
    roundBuilder: buildQuoteRound,
    roundBuildOpts: {
      targetCount: 6,
      maxTotalLetters: 35,
      rows: 5,
      cols: 7,
    },
    gameLabel: 'wikiword',
    gameName: 'WikiWord',
  });
  wikiword4x4Runner = new RoundRunner({
    label: 'wikiword-4x4',
    mode: 'wikiword-4x4',
    broadcast: wikiword4x4Broadcast,
    autoLoop: true,
    enableElo: false,
    roundBuilder: buildCompactQuoteRound,
    roundBuildOpts: {
      targetCount: 1,
      maxTotalLetters: 16,
      rows: 4,
      cols: 4,
    },
    gameLabel: 'wikiword-4x4',
    gameName: 'WikiWord 4x4',
  });
  roomManager.init({ io });
  soloManager.init();
  require('./src/action-durability').start();

  // Resume active rounds + solo runs from the DB before starting a fresh
  // public round. Crash-recovery: any round/run that had status='active' at
  // shutdown is re-hydrated in memory with all its found words, scores, and
  // ranked-guess history intact.
  const pendingRunners = new Set();
  try {
    const activeRounds = db.getActiveRounds();
    let resumedPublic = false;
    for (const row of activeRounds) {
      try {
        if (['streamer', 'wikiword-4x4'].includes(row.mode) && row.room_handle) {
          await roomManager.resumeRoomFromRound(row);
        } else if (row.mode === 'wikiword' || row.mode === 'wikiword-4x4') {
          const runner = row.mode === 'wikiword' ? wikiwordRunner : wikiword4x4Runner;
          if (!runner.game) await runner.resumeRound(row);
        } else if (!resumedPublic) {
          await publicRunner.resumeRound(row);
          resumedPublic = true;
        } else {
          // Multiple non-streamer active rounds shouldn't exist, but if they
          // do, abandon the extras.
          db.abandonRound(row.id, 'abandoned-duplicate');
        }
      } catch (e) {
        console.log(`[Resume] round #${row.id} deferred: ${e.message}`);
        const runner = row.mode === 'wikiword' ? wikiwordRunner : row.mode === 'wikiword-4x4' ? wikiword4x4Runner : publicRunner;
        pendingRunners.add(runner); runner.restoring = true;
        const restore = async () => {
          try { await runner.resumeRound(row); runner.restoring = false; pendingRunners.delete(runner); }
          catch (_) { const timer = setTimeout(restore, 10000); timer.unref?.(); }
        };
        const timer = setTimeout(restore, 10000); timer.unref?.();
      }
    }
    const resumedSolo = await soloManager.resumeActiveSoloRuns();
    console.log(`[Boot] Resume: ${resumedPublic ? 1 : 0} public + ${activeRounds.filter(r => r.mode === 'streamer').length} streamer round(s), ${resumedSolo} solo run(s)`);
  } catch (e) {
    console.log(`[Boot] Resume failed: ${e.message}`);
  }

  if (!publicRunner.game && !pendingRunners.has(publicRunner)) {
    await publicRunner.startRound();
  }
  if (!wikiwordRunner.game && !pendingRunners.has(wikiwordRunner)) {
    await wikiwordRunner.startRound();
  }
  if (!wikiword4x4Runner.game && !pendingRunners.has(wikiword4x4Runner)) {
    await wikiword4x4Runner.startRound();
  }

  server.listen(PORT, () => {
    console.log(`[Boot] WiKirecTangled listening on http://localhost:${PORT}`);
  });

  // Start the Chat Relay bridge after the HTTP listener is up — chat-message
  // events shouldn't arrive before processGuess can serve them. Chat messages
  // tagged with a streamerHandle route to that streamer's private room; bare
  // chat messages route to the public game.
  if (process.env.DISABLE_CHAT_RELAY === '1') {
    console.log('[Boot] Chat Relay bridge disabled via DISABLE_CHAT_RELAY=1');
  } else {
    relay.start({ port: PORT, processGuess: processGuessFromChat, io, gameShared });
  }
})();
