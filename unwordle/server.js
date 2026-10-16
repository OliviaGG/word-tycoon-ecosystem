try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
// ===== UnWordle Server =====
// Reverse Wordle — SP-only game. Serves static files and connects to Chat Relay.
// Players are given the answer + color patterns and must fill in the missing words.

const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const path = require('path');

const app = express();
app.use(express.json({ limit: '64kb' }));

const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const PORT = process.env.PORT || 3021;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const relayFetch = require('./src/relay-request').createRelayRequest({ baseUrl: CHAT_RELAY_URL });
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');

// In-memory game state for the current SP daily word
let gameState = { word: '', wordLength: 5 };

// Use game-shared for library word reporting
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify the wt_remember cookie. Returns null for unauthenticated guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('wt_remember')) return null;
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
    console.error('[UnWordle] whoami failed:', e.message);
  }
  return null;
}

// --- Jackpot / Settings (SP-only, minimal for admin panel) ---
const JACKPOT_FILE = path.join(__dirname, 'data', 'jackpot.json');

let jackpotSettings = {
  enabled: false,
  dailyEnabled: true,
  base: 0,
  perGuess: 0,
  perSecond: 0,
  max: 0,
  current: 0
};

// Load persisted settings
try {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  if (fs.existsSync(JACKPOT_FILE)) {
    jackpotSettings = { ...jackpotSettings, ...JSON.parse(fs.readFileSync(JACKPOT_FILE, 'utf8')) };
  }
} catch (e) { console.log('[UnWordle] No saved jackpot settings, using defaults'); }

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function saveJackpotSettings() {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    atomicWriteSync(JACKPOT_FILE, jackpotSettings);
  } catch (e) { console.error('[UnWordle] Error saving jackpot settings:', e.message); }
}

// Admin auth middleware
const ADMIN_SECRET = process.env.GAME_API_SECRET;
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.headers['x-admin-key'] || req.query.adminKey;
  if (key === ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

app.get('/api/jackpot/settings', (req, res) => {
  res.json({ ok: true, ...jackpotSettings });
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (typeof b.enabled === 'boolean') jackpotSettings.enabled = b.enabled;
  if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
  if (typeof b.base === 'number' && b.base >= 0) jackpotSettings.base = b.base;
  if (typeof b.perGuess === 'number' && b.perGuess >= 0) jackpotSettings.perGuess = b.perGuess;
  if (typeof b.perSecond === 'number' && b.perSecond >= 0) jackpotSettings.perSecond = b.perSecond;
  if (typeof b.max === 'number' && b.max >= 0) jackpotSettings.max = b.max;
  saveJackpotSettings();
  console.log('[UnWordle] Jackpot settings updated:', jackpotSettings);
  res.json({ ok: true, ...jackpotSettings });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
  jackpotSettings.current = jackpotSettings.base;
  saveJackpotSettings();
  res.json({ ok: true, ...jackpotSettings });
});

// --- SP settings endpoint (for client to check dailyEnabled) ---
app.get('/api/sp/settings', (req, res) => {
  res.json({ dailyEnabled: jackpotSettings.dailyEnabled });
});

// --- Word bank proxy (forwards to Chat Relay so SP client can fetch words) ---
app.get('/api/word-bank/*', async (req, res) => {
  try {
    const resource = req.params[0];
    if (!/^(?:(?:targets|dictionary)(?:\/(?:[3-9]|1[0-2]))?|stats|lengths)$/.test(resource) || Object.keys(req.query).length) return res.status(400).json({ ok: false, error: 'Invalid word-bank resource' });
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/${resource}`);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream error' });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Word bank unavailable' });
  }
});

// --- Session proxy (for library word reporting) ---
app.get('/api/me/session', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/me/session`, {
      headers: { cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' });
  }
});

// --- Daily word proxy (deterministic daily word from word bank) ---
app.get('/api/sp/daily', async (req, res) => {
  try {
    const rawLength = req.query.length ?? '5';
    if (typeof rawLength !== 'string' || !/^[4-8]$/.test(rawLength)) return res.status(400).json({ error: 'Invalid word length' });
    const len = Number(rawLength);
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/unwordle-sp?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(r.status >= 500 ? 503 : r.status).json({ error: 'Daily word unavailable' });
    const data = await r.json();
    if (data && data.word) {
      gameState.word = String(data.word).toUpperCase();
      gameState.wordLength = data.length || len;
    }
    res.json({ word: data.word, date: data.date, length: data.length });
  } catch (e) { console.error('[UnWordle] Daily endpoint error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/sp/daily/complete', (req, res) => {
    res.json({ ok: true });
});

// This thin shell owns only UnWordle progress/completions.
app.use(['/api/sp-daily/status/:gameId', '/api/sp-daily/complete/:gameId', '/api/sp-state/:gameId'], (req, res, next) => {
  if (req.params.gameId !== 'unwordle-sp') return res.status(400).json({ ok: false, error: 'Invalid gameId' });
  res.set('Cache-Control', 'no-store'); next();
});

// --- Daily completion status proxy ---
app.get('/api/sp-daily/status/:gameId', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-daily/status/${req.params.gameId}`, {
      headers: { cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' }); }
});

// --- Daily completion proxy ---
app.post('/api/sp-daily/complete/:gameId', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-daily/complete/${req.params.gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' }); }
});

// --- SP game state proxy (for daily in-progress state sync) ---
app.get('/api/sp-state/:gameId', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-state/${req.params.gameId}`, {
      headers: { cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' }); }
});

app.post('/api/sp-state/:gameId', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-state/${req.params.gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' }); }
});

app.delete('/api/sp-state/:gameId', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/sp-state/${req.params.gameId}`, {
      method: 'DELETE',
      headers: { cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' }
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' }); }
});

// --- Library word proxy ---
app.post('/api/library/word', async (req, res) => {
  try {
    const upstream = await relayFetch(`${CHAT_RELAY_URL}/api/library/word`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.cookie || '', 'x-solo-session-context': typeof req.headers['x-solo-session-context'] === 'string' && req.headers['x-solo-session-context'].length <= 1024 ? req.headers['x-solo-session-context'] : '' },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Relay unavailable; retry this request.' });
  }
});

// --- Serve static files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Socket.IO (minimal — no MP needed) ---
io.on('connection', (socket) => {
  // No account or socket identifiers in routine diagnostics.
  socket.on('disconnect', () => {
    // Minimal SP-only socket transport.
  });
});

// --- Connect to Chat Relay ---
let chatRelay = null;

function connectToChatRelay() {
  console.log(`[UnWordle] Connecting to Chat Relay at ${CHAT_RELAY_URL}...`);

  chatRelay = ioClient(CHAT_RELAY_URL, {
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });

  chatRelay.on('connect', () => {
    console.log('[UnWordle] Connected to Chat Relay');
    chatRelay.emit('app-register', { id: 'unwordle', name: 'UnWordle', port: PORT, apiKey: ADMIN_SECRET }, (ack) => {
      if (ack?.success) console.log('[UnWordle] Registered with Chat Relay');
    });
  });

  chatRelay.on('disconnect', () => {
    console.log('[UnWordle] Disconnected from Chat Relay');
  });

  chatRelay.on('connect_error', (err) => {
    console.log('[UnWordle] Chat Relay connection error (will retry):', err.message);
  });
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`[UnWordle] Server running at http://localhost:${PORT}`);
  connectToChatRelay();
});

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[UnWordle] Shutting down...');
  if (chatRelay) chatRelay.disconnect();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
