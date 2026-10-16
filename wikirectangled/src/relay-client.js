// relay-client.js - Bridge to Chat Relay so chat messages submit guesses.
//
// Chat Relay is a separate service (default http://localhost:3000) that
// aggregates Discord/Twitch/YouTube/TikTok/Kick chat into one socket.io
// stream. Each `chat-message` event carries the platform-resolved user
// identity, which we feed straight into session-manager.resolveChatSession().
//
// Bridge protocol:
//   1. Connect to CHAT_RELAY_URL via socket.io-client
//   2. On connect, emit 'app-register' with { id, name, port, apiKey }
//      so Chat Relay knows we're listening + can route per-game policies
//   3. Listen for 'chat-message' → tokenize → submit guess
//   4. On disconnect, socket.io-client auto-reconnects
//
// If Chat Relay isn't running this module logs the error and keeps trying in
// the background — no crash.

const ioClient = require('socket.io-client');
const sessionManager = require('./session-manager');

const RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const APP_ID = 'wikirectangled';
const APP_NAME = 'WiKirecTangled';
const API_SECRET = process.env.GAME_API_SECRET || null;

// Chat-platform "engagement" notifications (joins, follows, gifts, etc.) often
// come through as one-word messages. This list is intentionally empty so that
// common words like "shared" can still be guessed when they appear as title or
// target words.
const ENGAGEMENT_WORDS = new Set([]);

// Strip emoji / punctuation / digits from a chat message and pull the first
// remaining alphabetic token. Mirrors RecTangled's chat tokenizer so guesses
// like "rote!", "h.e.l.l", "🔥 rote" all resolve to "rote".
function extractGuessWords(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('/') || trimmed.startsWith('!') || trimmed.startsWith('@')) return [];
  const out = [];
  const seen = new Set();
  for (const tok of trimmed.split(/\s+/)) {
    const cleaned = tok.replace(/[^\p{L}]/gu, '');
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (ENGAGEMENT_WORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(cleaned);
    if (out.length >= 50) break;
  }
  return out;
}

let socket = null;
let connectErrorLogged = false;
let stats = {
  connected: false,
  registered: false,
  messagesSeen: 0,
  guessesProcessed: 0,
  lastMessageAt: 0,
  lastError: null,
};

// `processGuess` is injected by server.js — that's the function that owns the
// game.guess call + DB record + socket broadcast. Keeping the dependency one-way
// (relay-client doesn't know about Game) makes this module testable in isolation.
function start({ port, processGuess, io, gameShared }) {
  if (socket) return socket;
  if (typeof processGuess !== 'function') throw new Error('relay-client.start: processGuess required');

  console.log(`[Relay] Connecting to ${RELAY_URL}...`);
  socket = ioClient(RELAY_URL, {
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    stats.connected = true;
    connectErrorLogged = false;
    console.log('[Relay] Connected');
    socket.emit('app-register', {
      id: APP_ID,
      name: APP_NAME,
      port,
      apiKey: API_SECRET,
    }, (ack) => {
      stats.registered = !!(ack && ack.success);
      console.log(`[Relay] Registered: ${stats.registered ? 'OK' : 'failed'} ${ack ? JSON.stringify(ack) : ''}`);
    });
  });

  socket.on('disconnect', (reason) => {
    stats.connected = false;
    stats.registered = false;
    console.log(`[Relay] Disconnected (${reason})`);
  });

  socket.on('connect_error', (err) => {
    stats.lastError = err.message;
    if (!connectErrorLogged) {
      console.log(`[Relay] connect error (will retry): ${err.message}`);
      connectErrorLogged = true;
    }
  });

  socket.on('chat-message', (msg) => {
    if (!msg || !msg.message) return;
    stats.messagesSeen += 1;
    stats.lastMessageAt = Date.now();

    const words = extractGuessWords(msg.message);
    if (!words.length) return;

    const user = msg.user || {};
    const platform = msg.platform || 'unknown';
    const platformUserId = user.userId || user.id || user.uniqueId || user.username || user.displayName;
    if (!platformUserId) return;
    const displayName = user.displayName || user.username || user.nickname || String(platformUserId);
    const profileImage = user.profilePic || user.profilePictureUrl || user.profileImageUrl
      || user.avatarUrl || user.avatar || user.image || null;

    const isFanClub = Array.isArray(user.badges) && user.badges.indexOf('fan-club') !== -1;
    let session;
    try {
      session = sessionManager.resolveChatSession({
        platform, platformUserId, displayName, profileImage,
        linkedDiscord: msg.linkedDiscord || null,
        isFanClub,
      });
    } catch (e) {
      console.log(`[Relay] resolveChatSession failed: ${e.message}`);
      return;
    }
    // Chat Relay tags messages from streamer-bound chat connections (TikTok/etc.)
    // with `streamerHandle`. Pass it through so the server can route to the
    // correct private room. `gameId` is the resolved active/widget game (e.g.
    // 'wikirectangled-wikiword') and may override the streamer room target.
    const streamerHandle = msg.streamerHandle || null;
    const gameId = msg.gameId || null;
    Promise.resolve(processGuess({ session, words, streamerHandle, gameId }))
      .catch((e) => console.log(`[Relay] processGuess threw: ${e.message}`));
    stats.guessesProcessed += 1;
  });

  // ── cosmetics-updated forward ──────────────────────────────────────────
  // Chat Relay broadcasts a `cosmetics-updated` event when a Word Tycoon
  // user equips/unequips a cosmetic. Without this forward, our own clients
  // would only learn about the change via the 60-second cosmeticsCache TTL.
  // We invalidate the in-process gameShared cache and re-broadcast on our
  // own io so all connected browsers can drop their stale entry too.
  socket.on('cosmetics-updated', (data) => {
    if (!data || !data.platform || !data.platformUserId) return;
    try {
      if (gameShared && typeof gameShared.invalidateCosmetics === 'function') {
        gameShared.invalidateCosmetics(data.platform, data.platformUserId, data.equipped);
      }
    } catch (e) { /* swallow — broadcast even if cache invalidation fails */ }
    if (io && typeof io.emit === 'function') io.emit('cosmetics-updated', data);
  });

  return socket;
}

function stop() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  stats.connected = false;
  stats.registered = false;
}

function getStats() {
  return { ...stats, relayUrl: RELAY_URL };
}

function emit(event, payload) {
  if (!socket || !socket.connected) return false;
  try { socket.emit(event, payload); return true; } catch (e) { return false; }
}

module.exports = { start, stop, getStats, extractGuessWords, emit };
