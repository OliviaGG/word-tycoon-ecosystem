try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json({ limit: '64kb' }));
const server = http.createServer(app);

const PORT = process.env.PORT || 3018;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const relayFetch = require('./src/relay-request').createRelayRequest({ baseUrl: CHAT_RELAY_URL });
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

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
    console.error('[Word1000] whoami failed:', e.message);
  }
  return null;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Stats endpoint (SP stats are client-side in localStorage, this is a no-op)
app.get('/api/stats', (_req, res) => {
  res.json({ note: 'Stats are stored locally in your browser.' });
});

// SP Daily word endpoint — proxy to Chat Relay word bank
app.get('/api/sp/daily', async (req, res) => {
  const rawLength = req.query.length ?? '5';
  if (typeof rawLength !== 'string' || !/^(?:[4-9]|10)$/.test(rawLength)) return res.status(400).json({ error: 'Invalid word length' });
  const length = Number(rawLength);
  try {
    const resp = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/word500-sp?length=${length}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('Word bank returned ' + resp.status);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('[Word500SP] Daily word fetch failed:', err.message);
    res.status(503).json({ error: 'Daily word unavailable' });
  }
});

app.post('/api/sp/daily/complete', (req, res) => {
    res.json({ ok: true });
});

const { createDailyHintHandler } = require('./src/daily-hints');

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Word1000] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Durable daily-only hints. The browser's practice target is never sent here.
app.post('/api/hints/use', createDailyHintHandler({
  resolveUser: resolveUserFromCookie,
  secret: process.env.HINT_ROUND_ID_SECRET,
  fetchDaily: async length => {
    const response = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/word500-sp?length=${length}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('Daily word unavailable');
    return response.json();
  },
  relay: async (route, body) => {
    const response = await relayFetch(CHAT_RELAY_URL + route, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error('Hint transaction unavailable');
    return response.json();
  },
}));

// Start server
server.listen(PORT, () => {
  console.log(`[Word5000 Solo] Running at http://localhost:${PORT}`);
});

// Connect to Chat Relay for app registration only
const chatRelay = gameShared.createRelayClient({
  id: 'word1000',
  name: 'Word5000 Solo',
  port: PORT,
  relayUrl: CHAT_RELAY_URL
});

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Word500SP] Shutting down...');
  chatRelay.disconnect();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
