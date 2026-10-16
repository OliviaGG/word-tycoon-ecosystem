try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const db = require('./src/database');
const game = require('./src/game');
const wordlist = require('./src/wordlist');
const sessionManager = require('./src/session-manager');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const BLOCKED_PUBLIC_PATH_RE = /(^|\/)(?:\.[^/]+|[^/]+(?:\.bak(?:[-._][^/]*)?|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i;
function blockSensitivePublicPaths(req, res, next) {
  const requestPath = req.path || '/';
  if (/^\/\.well-known(?:\/|$)/i.test(requestPath)) return next();
  if (BLOCKED_PUBLIC_PATH_RE.test(requestPath)) return res.status(404).send('Not found');
  next();
}

app.use(blockSensitivePublicPaths);

// Port config file for persistence
const PORT_FILE = path.join(__dirname, 'data', 'port.json');
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
function _sessionRoom(handle) { return `pixeletters:session:${String(handle || '').toLowerCase()}`; }

// ─── Per-streamer word length (Chat Relay "Word Length" dashboard card) ───
// The streamer picks 4-8 or "random" at /streamer; private sessions read it
// here instead of the global admin word_length setting. Clamped to the
// lengths the word list actually stocks.
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
  return SESSION_WORD_LENGTHS.filter(n => (wordlist.getTargets(n) || []).length > 0);
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

const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
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
    console.error('[PixeLetters] whoami failed:', e.message);
  }
  return null;
}

// --- Hint helpers ---
function getHintRound(handle) {
  const state = handle === 'public' ? game.getCurrentGame() : sessionManager.getSession(handle)?.currentGame;
  if (!state || !state.startedAt) return null;
  return { state: { ...state, gameOver: state.status !== 'active' }, startTime: state.startedAt };
}


let chatClient = null;
let connectedPlayers = 0;

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

// --- Daily Word ---
let dailyWord = null;    // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(__dirname, 'data', 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate()); // true once the daily round has started today

async function fetchDailyWord() {
  try {
    const settings = db.getAllSettings();
    const len = parseInt(settings.word_length) || 5;
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/pixeletters?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    // Check if it's a new day -> reset dailyPlayed
    if (dailyWord && dailyWord.date !== data.date) {
      dailyPlayed = dailyRounds.has(data.date);
      console.log(`[PixeLetters] New daily word available for ${data.date}`);
    }
    dailyWord = data;
  } catch (e) {
    console.warn('[PixeLetters] Daily word fetch failed:', e.message);
  }
}

// --- Frenzy ---
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };

const mpRecovery = require('./src/mp-recovery').createPixelettersRecovery({
  createActions: require(path.join(RELAY_DIR, 'src', 'plain-game-actions')).createPlainGameActions,
  directory: path.join(__dirname, 'data', 'mp-actions'), sdk: gameShared, db,
  getJackpot: () => jackpotSettings, setJackpot: value => { jackpotSettings = value; },
  getFrenzy: () => currentFrenzy, getDailyPlayed: () => dailyPlayed,
  consumeDaily(date) { dailyRounds.consume(date); if (date === gameShared.getEdmontonDate()) dailyPlayed = true; },
  onRollover: () => game.forceNewGame(), onError: error => console.error('[MPRecovery] ' + error.message)
});
game.setDurabilityHooks({ restore: mpRecovery.restorePublic, saveNew: mpRecovery.newPublic,
  ensure: mpRecovery.ensure, accept: mpRecovery.accept, isAccepted: mpRecovery.isAccepted });
sessionManager.setDurabilityHooks(mpRecovery.sessionHooks());
function savePublicMetadata() {
  const state = game.getCurrentGame(); if (!state) throw Error('Game unavailable');
  mpRecovery.actions.save(state, 'public', mpRecovery.metadata(state));
}
function browserUser(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string' || !data.word || data.word.length > 64) return null;
  for (const [field,limit] of [['username',80],['displayName',80],['platformUserId',128],['linkedDiscord',128],['profilePic',2048]])
    if (data[field] != null && (typeof data[field] !== 'string' || data[field].length > limit)) return null;
  return { word:data.word, platform:'web', platformUserId:data.platformUserId || null, linkedDiscord:data.linkedDiscord || null, profilePic:data.profilePic || null, username:data.username || data.displayName || 'Player', displayName:data.displayName || data.username || 'Player' };
}

// --- Jackpot System ---

function calculateJackpot() {
  const state = game.getCurrentGame(), completion = state && mpRecovery.actions.recordFor(state)?.completion;
  return completion ? completion.rawAmount : mpRecovery.rawPot(state);
}
function publicPot() { return mpRecovery.pot(game.getCurrentGame()); }

function startJackpotBroadcast() {
  stopJackpotBroadcast();
  jackpotBroadcastTimer = setInterval(() => {
    const currentGame = game.getCurrentGame();
    if (currentGame && currentGame.status === 'active') {
      io.to('public').emit('jackpot-update', { jackpot: publicPot() });
    }
    for (const info of sessionManager.listSessions()) {
      const room = _sessionRoom(info.handle), session = sessionManager.getSession(info.handle);
      if (session?.currentGame?.status === 'active' && io.sockets?.adapter?.rooms?.has(room))
        io.to(room).emit('jackpot-update', { jackpot: _calcSessionPot(session) });
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

// `roundGame` lets private streamer sessions report their own round; public
// rounds leave it null and fall back to the live public game (2026-07-21).
async function reportRoundToWordTycoon(winnerData, roundGame = null) {
  try {
    const currentGame = roundGame || game.getCurrentGame();
    if (!currentGame || !currentGame.guesses || currentGame.guesses.length === 0) return;

    const word = currentGame.word || '?';
    const seen = new Set();
    const participants = [];

    const winnerIdentity = winnerData && winnerData.linkedDiscord
      ? `discord:${winnerData.linkedDiscord}`
      : `${winnerData?.platform || 'discord'}:${winnerData?.platformUserId || winnerData?.user?.id || 'unknown'}`;

    for (const guess of currentGame.guesses) {
      const identity = guess.linkedDiscord
        ? `discord:${guess.linkedDiscord}`
        : `${guess.platform || 'discord'}:${guess.platformUserId || 'unknown'}`;

      if (seen.has(identity)) continue;
      if (!gameShared.isStatsEligible(identity)) continue;
      seen.add(identity);

      const isWinner = identity === winnerIdentity;

      const guessCount = currentGame.guesses.filter(g => {
        const gIdentity = g.linkedDiscord
          ? `discord:${g.linkedDiscord}`
          : `${g.platform || 'discord'}:${g.platformUserId || 'unknown'}`;
        return gIdentity === identity;
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
        articleTitle: word
      });
    }

    if (participants.length < 2) return;

    for (const p of participants) {
      p.rankOutOf = participants.length;
    }

    await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.GAME_API_SECRET
      },
      body: JSON.stringify({ game: 'pixeletters', participants })
    });
  } catch (err) {
    console.error('[PixeLetters] ELO report failed/error:', err.message || err);
  }
}

// ─── Session URL routes (must precede express.static) ──────────────────
app.use(express.json());
const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'overlay.html',
  'index.html', 'mp.html', 'sp.html',
  'favicon.ico', 'robots.txt', 'manifest.webmanifest', 'sw.js',
  'public', 'js', 'css', 'socket.io',
]);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "mp.html")));
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/')[2].toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/overlay.html');
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- API Endpoints ---

app.get('/api/game', (req, res) => {
  res.json({ ...game.getPublicGameState(), playerCount: connectedPlayers });
});

app.get('/api/leaderboard', (req, res) => {
  res.json(db.getLeaderboard(20));
});

app.get('/api/history', (req, res) => {
  res.json(db.getRecentHistory(20));
});

app.get('/api/stats', (req, res) => {
  res.json(db.getAllUserStats());
});

app.get('/api/settings', (req, res) => {
  res.json(db.getAllSettings());
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { key, value } = req.body || {}, text = String(value);
  const valid = key === 'game_mode' ? ['standard','plus','pro'].includes(value) :
    key === 'require_slash' ? ['0','1'].includes(text) :
    ['word_length','max_guesses','auto_restart_delay'].includes(key) && /^(0|[1-9][0-9]{0,2})$/.test(text) &&
      (key === 'word_length' ? Number(text)>=4 && Number(text)<=7 : key === 'max_guesses' ? Number(text)<=99 : Number(text)>=3 && Number(text)<=120);
  if (!valid) return res.status(400).json({ error:'Invalid setting' });
  const before = db.getSetting(key);
  try { db.setSetting(key,text); savePublicMetadata(); res.json({ok:true}); }
  catch { try { db.setSetting(key,before); } catch {} res.status(503).json({error:'Storage unavailable; please retry'}); }
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
    console.error('[PixeLetters] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one target letter.
app.post('/api/hints/use', require('./src/paid-hints').createTransactionalHintHandler({
  resolveUser: resolveUserFromCookie, getRound: getHintRound, secret: process.env.HINT_ROUND_ID_SECRET,
  gameId: 'pixeletters',
  async relay(endpoint, body) {
    const response = await fetch(`${CHAT_RELAY_URL}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Hint service unavailable');
    return response.json();
  },
}));

app.post('/api/game/new', requireAdmin, (req, res) => {
  const { wordLength } = req.body;
  if (wordLength != null && (!Number.isInteger(wordLength) || wordLength < 4 || wordLength > 7)) return res.status(400).json({error:'Invalid word length'});
  try { game.forceNewGame(wordLength); res.json({ok:true}); } catch { res.status(503).json({error:'Storage unavailable; please retry'}); }
});

app.post('/api/game/skip', requireAdmin, (req, res) => {
  if (!game.skipGame()) return res.status(503).json({error:'Round unavailable or storage failed'});
  res.json({ok:true});
});

app.post('/api/game/guess', requireAdmin, (req, res) => {
  const { word, platform, platformUserId, username, displayName } = req.body;
  const result = game.processGuess(word, platform || 'admin', platformUserId || 'admin', username || 'Admin', displayName);
  res.json(result);
});

// SP word list endpoint
app.get('/api/sp/words/:length', (req, res) => {
  const len = parseInt(req.params.length);
  const targets = wordlist.getTargets(len);
  const dictionary = wordlist.getDictionary(len);
  if (!targets || targets.length === 0) {
    return res.status(404).json({ error: 'No words for length ' + len });
  }
  res.json({ targets, dictionary: dictionary || targets });
});

// Game history endpoint (portal-compatible format)
app.get('/api/game/history', (req, res) => {
  const history = db.getRecentHistory(100);
  // Map to portal-compatible format
  const mapped = history
    .filter(g => g.status === 'won')
    .map(g => {
      const lastGuess = g.guesses[g.guesses.length - 1];
      return {
        word: g.word,
        guessCount: g.guesses.length,
        winner: {
          platformUserId: g.winner_user_id,
          displayName: lastGuess?.displayName || g.winner_username,
          linkedDiscord: lastGuess?.linkedDiscord || null,
          username: g.winner_username,
          platform: g.winner_platform
        },
        timestamp: g.ended_at
      };
    });
  res.json(mapped);
});

// --- Jackpot API ---

app.get('/api/jackpot/settings', (req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    dailyEnabled: jackpotSettings.dailyEnabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: publicPot(),
  });
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
  const b = req.body || {}, keys = ['enabled','dailyEnabled','base','perGuess','perSecond','max'];
  if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(key => !keys.includes(key)) ||
    Object.entries(b).some(([key,value]) => ['enabled','dailyEnabled'].includes(key) ? typeof value !== 'boolean' :
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000))
    return res.status(400).json({error:'Invalid jackpot settings'});
  const before = jackpotSettings;
  try { jackpotSettings = {...before,...b}; savePublicMetadata(); }
  catch { jackpotSettings = before; return res.status(503).json({error:'Storage unavailable; please retry'}); }
  res.json({ok:true,...jackpotSettings,current:publicPot()});
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
  const state = game.getCurrentGame();
  if (!state || state.status !== 'active') return res.status(409).json({error:'No active round'});
  const before = state.potStartedAt;
  try { state.potStartedAt = Date.now(); savePublicMetadata(); }
  catch { state.potStartedAt = before; return res.status(503).json({error:'Storage unavailable; please retry'}); }
  res.json({ok:true,current:publicPot()});
});

// ─── Session-mode helpers ────────────────────────────────────────────
let _relaySocketRef = null; // set inside connectToChatRelay so session-win can emit

function _calcSessionPot(s) { return mpRecovery.pot(s?.currentGame, s); }

async function _processSessionGuessAndBroadcast(session, word, platform, platformUserId, username, displayName, profilePic, linkedDiscord, responseSocket, perks) {
  const mode = db.getSetting('game_mode') || 'standard';
  const result = sessionManager.processSessionGuess(session, word, {
    username, displayName, platform, platformUserId, profilePic, linkedDiscord,
  }, mode);
  if (result.error) {
    if (responseSocket) try { responseSocket.emit('guess-error', { error: result.error }); } catch (_) {}
    return result;
  }
  if (!session.noRewards) gameShared.reportLibraryWord(platform, platformUserId, word, 'pixeletters', username, displayName);
  const room = _sessionRoom(session.handle);
  io.to(room).emit('game-state', sessionManager.buildSessionState(session, { mode, jackpotEnabled: jackpotSettings.enabled }, _calcSessionPot));

  const acceptedGame = session.currentGame;
  if (result.won) {
    const finalPot = _calcSessionPot(session);
    const playerCosmetics = await gameShared.getPlayerCosmetics(platform, platformUserId);
    if (sessionManager.getSession(session.handle) !== session || session.currentGame !== acceptedGame) return result;
    io.to(room).emit('winner-cosmetics', { cosmetics: playerCosmetics });
    const _winPayload = {
      game: 'pixeletters', gameName: 'PixeLetters',
      word: session.currentGame.word,
      winner: {
        displayName: displayName || username,
        profilePic: profilePic || null,
        platform: platform || 'tiktok',
        cosmetics: playerCosmetics || null,
      },
      jackpot: finalPot,
      guessCount: session.currentGame.guesses.length,
      isDaily: false,
      streamerHandle: session.handle,
    };
    io.to(room).emit('game-win', _winPayload);
    if (_relaySocketRef && _relaySocketRef.connected) {
      _relaySocketRef.emit('game-win', _winPayload);
    }
    // Stream rounds count toward /goat ELO + rounds played, same as public.
    if (!session.noRewards) reportRoundToWordTycoon({ platform, platformUserId }, acceptedGame)
      .catch(e => console.log('[PixeLetters] session ELO report failed: ' + e.message));
    sessionManager.scheduleSave();
    // Auto-restart with a fresh word
    const restartDelay = parseInt(db.getSetting('auto_restart_delay') || '10') * 1000;
    io.to(room).emit('game-ending', {
      restartIn: restartDelay / 1000,
      word: session.currentGame.word,
      status: session.currentGame.status,
    });
    session.autoRestartTimer = setTimeout(() => {
      // Re-resolve the length each round so a dashboard change (or 'random')
      // takes effect on the very next round without ending the session.
      (async () => {
        try {
          const settings = db.getAllSettings();
          const len = await getSessionWordLength(session.handle);
          const maxGuesses = isNaN(parseInt(settings.max_guesses)) ? 5 : parseInt(settings.max_guesses);
          if (sessionManager.restartSession(session, { wordLength: len, maxGuesses })) {
            io.to(room).emit('game-state', sessionManager.buildSessionState(session, { mode, jackpotEnabled: jackpotSettings.enabled }, _calcSessionPot));
            console.log(`[Session] "${session.handle}" auto-restarted`);
          }
        } catch (err) {
          console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
        }
      })();
    }, restartDelay);
  } else if (result.gameOver) {
    // Lost — auto-restart same handle, fresh word
    sessionManager.scheduleSave();
    const restartDelay = parseInt(db.getSetting('auto_restart_delay') || '10') * 1000;
    io.to(room).emit('game-ending', {
      restartIn: restartDelay / 1000,
      word: session.currentGame.word,
      status: session.currentGame.status,
    });
    session.autoRestartTimer = setTimeout(() => {
      (async () => {
        try {
          const settings = db.getAllSettings();
          const len = await getSessionWordLength(session.handle);
          const maxGuesses = isNaN(parseInt(settings.max_guesses)) ? 5 : parseInt(settings.max_guesses);
          if (sessionManager.restartSession(session, { wordLength: len, maxGuesses })) {
            io.to(room).emit('game-state', sessionManager.buildSessionState(session, { mode, jackpotEnabled: jackpotSettings.enabled }, _calcSessionPot));
          }
        } catch (err) {
          console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
        }
      })();
    }, restartDelay);
  }
  return result;
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  if (!_validStreamerHandles.has(handle)) return;
  if (msg.user && msg.platform && _isStreamerBlocking(handle, msg.platform, msg.user.id || msg.user.username)) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({
      handle,
      sessionId: msg.streamSession || null,
      settings: await (async function () {
        const s = db.getAllSettings();
        return { wordLength: await getSessionWordLength(handle), maxGuesses: isNaN(parseInt(s.max_guesses)) ? 5 : parseInt(s.max_guesses) };
      })(),
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.currentGame) return;

  const text = (msg.message || '').trim();
  const wordLen = session.currentGame.wordLength;
  const requireSlash = db.getSetting('require_slash') === '1';
  let guessWord = null;
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith('!guess ') || lowerText.startsWith('!g ')) {
    guessWord = text.split(' ')[1];
  } else if (lowerText.startsWith('/guess ') || lowerText.startsWith('/g ')) {
    guessWord = text.split(' ')[1];
  } else {
    const cleaned = text.replace(/[^a-zA-Z]/g, '');
    const hasPrefix = /^[./]/.test(text);
    if (cleaned && /^[a-zA-Z]+$/.test(cleaned) && cleaned.length === wordLen) {
      if (hasPrefix || !requireSlash) guessWord = cleaned;
    }
  }
  if (guessWord) guessWord = guessWord.replace(/[^a-zA-Z]/g, '');
  if (!guessWord) return;
  await _processSessionGuessAndBroadcast(
    session,
    guessWord,
    msg.platform,
    msg.user.id || msg.user.username,
    msg.user.username,
    msg.user.displayName || msg.user.username,
    msg.user.profilePic || null,
    msg.linkedDiscord || null,
    null,
  );
}

// --- Socket.IO connections ---

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
      const settings = db.getAllSettings();
      const session = await sessionManager.getOrCreateSession({
        handle: sessionHandle,
        settings: { wordLength: await getSessionWordLength(sessionHandle), maxGuesses: isNaN(parseInt(settings.max_guesses)) ? 5 : parseInt(settings.max_guesses) },
      });
      if (session) {
        const mode = settings.game_mode || 'standard';
        socket.emit('game-state', sessionManager.buildSessionState(session, { mode, jackpotEnabled: jackpotSettings.enabled }, _calcSessionPot));
      } else {
        socket.emit('game-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    socket.on('guess', async (data) => {
      data = browserUser(data);
      if (!data) return socket.emit('guess-error',{error:'Invalid guess frame'});
      const session = sessionManager.getSession(sessionHandle);
      if (!session) return;
      // Premium gate (2026-07-31): page play in a streamer room is Donor-only
      // too. TikTok/Discord chat play-along is unaffected — those guesses come
      // through the relay chat client, never this socket.
      const acceptedGame = session.currentGame;
      if (!(await passesPremiumWebGate([data.linkedDiscord, data.platformUserId], socket, 'session'))) return;
      if (sessionManager.getSession(sessionHandle) !== session || session.currentGame !== acceptedGame) return socket.emit('guess-error',{error:'Round changed; please retry'});
      data.platformUserId = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId;
      data.linkedDiscord = null; data.profilePic = null;
      gameShared.reportSocketIP(socket, data.platform || 'discord', data.platformUserId, 'pixeletters');
      const result = await _processSessionGuessAndBroadcast(
        session,
        data.word,
        data.platform || 'discord',
        data.platformUserId || 'web',
        data.username || 'WebPlayer',
        data.displayName || data.username || 'WebPlayer',
        data.profilePic || null,
        data.linkedDiscord || null,
        socket,
      );
      socket.emit('guess-result',result);
    });
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  connectedPlayers++;
  // Send current game state
  socket.emit('game-state', game.getPublicGameState());
  socket.emit('leaderboard', db.getLeaderboard(10));

  // Admin auth via socket
  socket.on('admin-auth', (key) => {
    if (key === ADMIN_SECRET) socket.isAdmin = true;
  });

  // Web player guess handler (MP mode)
  socket.on('guess', async (data) => {
    data = browserUser(data);
    if (!data) return socket.emit('guess-error',{error:'Invalid guess frame'});
    const acceptedGame = game.getCurrentGame();
    // Premium gate: only public web sockets reach this handler.
    if (!(await passesPremiumWebGate([data.linkedDiscord, data.platformUserId], socket))) return;
    if (game.getCurrentGame() !== acceptedGame) return socket.emit('guess-error',{error:'Round changed; please retry'});
    data.platformUserId = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentityId;
    data.linkedDiscord = null; data.profilePic = null;
    gameShared.reportSocketIP(socket, data.platform || 'discord', data.platformUserId, 'pixeletters');
    const result = game.processGuess(
      data.word,
      data.platform || 'discord',
      data.platformUserId || 'web',
      data.username || 'WebPlayer',
      data.displayName || data.username || 'WebPlayer',
      data.profilePic || null,
      data.linkedDiscord || null,
      false,
      socket._wtPerks || {}
    );
    socket.emit('guess-result',result);
    if (result.error) {
      socket.emit('guess-error', { error: result.error });
    } else {
      gameShared.reportLibraryWord(data.platform || 'discord', data.platformUserId || 'web', data.word, 'pixeletters', data.username, data.displayName, socket);
      io.to('public').emit('game-state', game.getPublicGameState());
      io.to('public').emit('leaderboard', db.getLeaderboard(10));
      if (result.won) {
        await notifyPublicWin(acceptedGame,data,chatClient);
      }
    }
  });

  socket.on('disconnect', () => {
    connectedPlayers--;
  });
});

async function notifyPublicWin(state, user, relaySocket, flags = {}) {
  const amount = mpRecovery.pot(state);
  const cosmetics = await gameShared.getPlayerCosmetics(user.platform,user.platformUserId);
  if (game.getCurrentGame() !== state) return;
  io.to('public').emit('winner-cosmetics',{cosmetics});
  reportRoundToWordTycoon(user,state).catch(error => console.log('[PixeLetters] ELO report failed: ' + error.message));
  const payload = { game:'pixeletters',gameName:'PixeLetters',word:state.word,
    winner:{displayName:user.displayName || user.username,profilePic:user.profilePic || null,platform:user.platform,cosmetics:cosmetics || null,...flags},
    jackpot:amount,guessCount:state.guesses.length,isDaily:!!state.isDaily };
  io.to('public').emit('game-win',payload);
  if (relaySocket?.connected) {
    if (state.isDaily) relaySocket.emit('daily-win',{game:'pixeletters',winner:user.displayName || user.username,platform:user.platform});
    relaySocket.emit('game-win',payload);
  }
}

// --- Chat Relay Integration ---

function connectToChatRelay(port) {
  console.log(`[ChatRelay] Connecting to ${CHAT_RELAY_URL}...`);

  const relaySocket = gameShared.createRelayClient({
    id: 'pixeletters',
    name: 'PixeLetters',
    port,
    apiSecret: ADMIN_SECRET,
    relayUrl: CHAT_RELAY_URL,
    reconnectionDelay: 3000
  }, {
    onConnect: () => {
      io.to('public').emit('relay-status', { connected: true });
    },
    onDisconnect: () => {
      io.to('public').emit('relay-status', { connected: false });
    },
    onChat: async (msg) => {
    if (!msg.message || msg.isSystem) return;

    // Streamer-private session: route to per-streamer state if tagged.
    if (msg.streamerHandle) {
      handleSessionChat(msg).catch(() => {});
      return;
    }

    const text = msg.message.trim();
    const currentState = game.getPublicGameState();
    if (!currentState || currentState.status !== 'active') return;

    const wordLen = currentState.wordLength;
    const requireSlash = db.getSetting('require_slash') === '1';

    let guessWord = null;

    // Always accept !guess / !g / /guess / /g prefix
    const lowerText = text.toLowerCase();
    if (lowerText.startsWith('!guess ') || lowerText.startsWith('!g ')) {
      guessWord = text.split(' ')[1];
    } else if (lowerText.startsWith('/guess ') || lowerText.startsWith('/g ')) {
      guessWord = text.split(' ')[1];
    } else {
      // Strip non-letter characters (periods, slashes, emojis, etc.)
      // e.g. ".think" → "think", "t/hi../n.k" → "think", "🎉" → ignored
      const cleaned = text.replace(/[^a-zA-Z]/g, '');
      const hasPrefix = /^[./]/.test(text);
      if (cleaned && /^[a-zA-Z]+$/.test(cleaned) && cleaned.length === wordLen) {
        if (hasPrefix || !requireSlash) {
          guessWord = cleaned;
        }
      }
    }

    // Clean any remaining non-letter characters from prefix-extracted words
    if (guessWord) {
      guessWord = guessWord.replace(/[^a-zA-Z]/g, '');
    }

    if (guessWord) {
      const _fc = Array.isArray(msg.user.badges) && msg.user.badges.indexOf('fan-club') !== -1;
      const _sf = Array.isArray(msg.user.badges) && msg.user.badges.indexOf('superfan') !== -1;
      const result = game.processGuess(
        guessWord,
        msg.platform,
        msg.user.id,
        msg.user.username,
        msg.user.displayName || msg.user.username,
        msg.user.profilePic || null,
        msg.linkedDiscord || null,
        _fc
      );

      if (result.error) {
        console.log(`[Game] Invalid guess "${guessWord}" from ${msg.user.username}: ${result.error}`);
      } else {
        gameShared.reportLibraryWord(msg.platform, msg.user.id || msg.user.username, guessWord, 'pixeletters', msg.user.username, msg.user.displayName);
        console.log(`[Game] ${msg.user.username} guessed "${guessWord}" ${result.gameOver ? (result.won ? '- WINNER!' : '- Game Over') : ''}`);
        if (result.won) {
          const acceptedGame = game.getCurrentGame();
          await notifyPublicWin(acceptedGame,{platform:msg.platform,platformUserId:msg.user.id || msg.user.username,
            username:msg.user.username,displayName:msg.user.displayName || msg.user.username,profilePic:msg.user.profilePic},
            relaySocket,{isFanClub:_fc,isSuperfan:_sf});
        }
      }
    }
    },
    onCosmeticsUpdated: ({ platform, platformUserId, equipped }) => {
    gameShared.invalidateCosmetics(platform, platformUserId, equipped);

    const currentGame = game.getCurrentGame();
    if (!currentGame) return;

    // If current winner's cosmetics changed, re-broadcast winner-cosmetics
    const lastGuess = currentGame.guesses[currentGame.guesses.length - 1];
    if (currentGame.status === 'won' && lastGuess &&
        lastGuess.platform === platform && lastGuess.platformUserId === platformUserId) {
      io.to('public').emit('winner-cosmetics', { cosmetics: equipped });
    }
    },
    onFrenzyUpdate: (data) => {
    if (data && typeof data.multiplier === 'number') {
      currentFrenzy = data;
      io.to('public').emit('frenzy-update', data);
    }
    },
    onActivateDaily: async () => {
    console.log('[PixeLetters] activate-daily received from Chat Relay');
    await fetchDailyWord();
    dailyRounds.reset(gameShared.getEdmontonDate());
    dailyPlayed = false;
    jackpotSettings.dailyEnabled = true;
    const currentGame = game.getCurrentGame();
    if (!currentGame || currentGame.status !== 'active') {
      console.log('[PixeLetters] Starting daily game immediately');
      game.forceNewGame();
    } else {
      console.log('[PixeLetters] Game in progress — daily will start after current game ends');
    }
    }
  });

  _relaySocketRef = relaySocket;
  return relaySocket;
}

// --- Port Management ---

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close();
      resolve(true);
    });
    srv.listen(port, '0.0.0.0');
  });
}

async function findPort() {
  // Respect PORT env var (set by Chat Relay app manager)
  if (process.env.PORT) {
    const envPort = parseInt(process.env.PORT);
    if (await isPortAvailable(envPort)) return envPort;
  }

  // Try saved port first
  let savedPort = null;
  try {
    if (fs.existsSync(PORT_FILE)) {
      const data = JSON.parse(fs.readFileSync(PORT_FILE, 'utf-8'));
      savedPort = data.port;
    }
  } catch (e) {}

  // Also check DB setting
  const dbPort = db.getSetting('port');
  const preferredPort = savedPort || (dbPort ? parseInt(dbPort) : 3100);

  if (await isPortAvailable(preferredPort)) {
    return preferredPort;
  }

  // Scan for available port starting from preferred
  for (let p = preferredPort + 1; p < preferredPort + 100; p++) {
    if (await isPortAvailable(p)) {
      return p;
    }
  }

  throw new Error('No available port found');
}

function savePort(port) {
  fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true });
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port }));
  db.setSetting('port', String(port));
}

// --- Start ---

async function start() {
  console.log('========================================');
  console.log('     PixeLetters - Starting Up');
  console.log('========================================');

  await db.initialize();
  mpRecovery.restorePublic(); // Restore accepted configuration before selecting/fetching words.
  await wordlist.init();

  const port = await findPort();

  // Fetch daily word (non-fatal if Chat Relay not ready yet)
  await fetchDailyWord();
  setInterval(fetchDailyWord, 3600000); // refresh hourly


  // Wire up daily word injection before each new game
  game.setBeforeNewGame((wordLength) => {
    const settings = db.getAllSettings();
    const len = wordLength || parseInt(settings.word_length) || 5;
    const today = gameShared.getEdmontonDate(); // Edmonton timezone — matches word bank
    if (!dailyPlayed && dailyWord && dailyWord.date === today && dailyWord.length === len && jackpotSettings.dailyEnabled) {
      console.log(`[PixeLetters] DAILY round (${dailyWord.word.length} letters)`);
      return { word: dailyWord.word.toUpperCase(), isDaily: true, dailyDate: today };
    }
    return null;
  });

  // Wire up jackpot lifecycle hooks
  game.setOnNewGame(() => {
    gameStartTime = Date.now();
    startJackpotBroadcast();
  });
  game.setStateAugmenter(() => ({
    jackpot: publicPot(),
    jackpotAwarded: game.getCurrentGame()?.jackpotAwarded,
    jackpotEnabled: jackpotSettings.enabled,
    startTime: game.getCurrentGame()?.startedAt || new Date(gameStartTime).toISOString(),
    frenzy: currentFrenzy,
    playerCount: connectedPlayers
  }));
  game.initialize(io);
  const restoredGame = game.getCurrentGame();
  dailyPlayed = dailyRounds.migrateLegacy({ played: !!restoredGame?.isDaily, date: restoredGame?.dailyDate, startedAt: restoredGame?.startedAt });
  const openingTime = Date.parse(restoredGame?.startedAt);
  if (Number.isFinite(openingTime)) gameStartTime = openingTime;
  startJackpotBroadcast();

  server.listen(port, '0.0.0.0', () => {
    savePort(port);
    console.log(`[Server] PixeLetters running on port ${port}`);
    console.log(`[Server] OBS Overlay: http://localhost:${port}/overlay.html`);
    console.log(`[Server] Admin Panel: http://localhost:${port}/admin.html`);
    console.log('========================================');
  });

  // Connect to Chat Relay
  chatClient = connectToChatRelay(port);
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[PixeLetters] Shutting down...');
  stopJackpotBroadcast();
  mpRecovery.stop();
  db.save();
  console.log('[PixeLetters] Database saved');
  if (chatClient) chatClient.disconnect();
  server.close();
  console.log('[PixeLetters] Shutdown complete');
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
