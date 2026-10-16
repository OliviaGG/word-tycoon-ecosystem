// ===== Shared Game Utilities =====
// Used by all game servers in the Word Tycoon ecosystem.
// Centralizes: reward calls, library word reporting, cosmetics caching.
//
// Usage in game servers:
//   const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
//   const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
//   gameShared.init({ wordEmpiresUrl, apiSecret, io });
//

const { io: ioClient } = require('socket.io-client');

const DEFAULT_WORD_EMPIRES_URL = 'http://localhost:3020';
const DEFAULT_CHAT_RELAY_URL = 'http://localhost:3000';

let _config = {
  wordEmpiresUrl: DEFAULT_WORD_EMPIRES_URL,
  apiSecret: null, // set via init() before use
  io: null  // Socket.IO server instance — set via init()
};

const REWARD_TIMEOUT_MS = 8000;

/**
 * Initialize the shared module.
 * @param {Object} opts
 * @param {string} opts.wordEmpiresUrl - Word Tycoon API base URL
 * @param {string} opts.apiSecret - API key for Word Tycoon endpoints
 * @param {Object} opts.io - Socket.IO server instance (for emitting coin-reward events)
 */
function isGuestId(userId) {
  if (!userId) return true;
  const id = String(userId).toLowerCase();
  return id.startsWith('web_guest_') ||
         id.startsWith('guest_') ||
         id.startsWith('wsguest_') ||
         id.startsWith('guest-') ||
         id.startsWith('anon_');
}

/**
 * Should this player's round participation count toward Word Tycoon stats
 * (ELO, rounds played, suspicion)?
 *
 * Filters the two kinds of non-real players that reach a game's round-end:
 *   - bot players (chat-relay's src/bot-players.js simulated stream viewers)
 *   - guests (unauthenticated web/session players with no WT account)
 *
 * Accepts either (platform, userId) or a single "platform:userId" identity
 * key, because games build participant lists both ways.
 *
 * Added 2026-07-21 with the stream-stats-to-GOAT work: private streamer
 * sessions now report ELO like public rounds, and bots play in those
 * sessions — without this filter they would earn real ratings.
 */
function isStatsEligible(platform, userId) {
  let p = platform;
  let id = userId;
  if (userId === undefined && typeof platform === 'string' && platform.includes(':')) {
    const i = platform.indexOf(':');
    p = platform.slice(0, i);
    id = platform.slice(i + 1);
  }
  if (String(p || '').toLowerCase() === 'bot') return false;
  if (!id || String(id).toLowerCase() === 'unknown') return false;
  if (isGuestId(id)) return false;
  return true;
}

function init(opts = {}) {
  if (opts.wordEmpiresUrl) _config.wordEmpiresUrl = opts.wordEmpiresUrl;
  if (opts.apiSecret) _config.apiSecret = opts.apiSecret;
  if (opts.io) _config.io = opts.io;
}

// ── Reward ──────────────────────────────────────────────────────────────────

/**
 * Award coins to a player via Word Tycoon's /api/reward endpoint.
 * Retries up to 3 times with exponential backoff (2s, 4s, 6s).
 * On success, emits 'coin-reward' to all connected Socket.IO clients.
 *
 * @param {string} platform - 'tiktok', 'youtube', 'discord'
 * @param {string} userId - platform user ID
 * @param {string} username - player username
 * @param {string} displayName - player display name
 * @param {number} coins - base coin amount to award
 * @param {string} gameName - game identifier (e.g. 'betweenly', 'wordle')
 * @param {string} event - reward event type (e.g. 'jackpot-win', 'daily-win', 'word')
 * @param {Object} extras - additional fields (guessCount, word, etc.)
 * @returns {Object|null} - response from Word Tycoon or null on failure
 */
async function rewardPlayer(platform, userId, username, displayName, coins, gameName, event, extras = {}) {
  // Bot players (src/bot-players.js simulated viewers) never earn WT
  // rewards — they exist only on in-round surfaces.
  if (String(platform || '').toLowerCase() === 'bot') {
    return { ok: true, bot: true, skipped: true, coinsAwarded: 0, newBalance: 0 };
  }
  // Guest players get session-only rewards (no DB persistence)
  if (isGuestId(userId)) {
    if (_config.io) {
      _config.io.emit('coin-reward', {
        player: displayName,
        coinsAwarded: coins,
        newBalance: 0
      });
    }
    return { ok: true, guest: true, coinsAwarded: coins, newBalance: 0 };
  }
  const MAX_RETRIES = 3;
  const payload = { platform, userId, username, displayName, coins, game: gameName, event, ...extras };
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(REWARD_TIMEOUT_MS)
        : undefined;
      const res = await fetch(`${_config.wordEmpiresUrl}/api/reward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': _config.apiSecret
        },
        body: JSON.stringify(payload),
        signal
      });
      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        const err = new Error(`reward API returned non-JSON (${res.status})`);
        err.retryable = true;
        throw err;
      }
      if (!res.ok) {
        const message = data && (data.error || data.message)
          ? `${data.error || data.message}`
          : `HTTP ${res.status}`;
        const err = new Error(message);
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      if (!data || data.ok === false) {
        const message = data && (data.error || data.message)
          ? `${data.error || data.message}`
          : 'reward API returned ok=false';
        const err = new Error(message);
        err.retryable = false;
        throw err;
      }
      if (data.ok && _config.io) {
        _config.io.emit('coin-reward', {
          player: displayName,
          coinsAwarded: data.coinsAwarded || coins,
          newBalance: data.newBalance || 0
        });

        // Emit post-game progress summary (if backend included one)
        if (data.progressSummary) {
          _config.io.emit('progress-summary', {
            player: displayName,
            game: gameName,
            summary: data.progressSummary
          });
        }

        // Emit cosmetic reward events for celebration animations
        if (data.dailyLootBox && data.dailyLootBox.length > 0) {
          _config.io.emit('cosmetic-reward', {
            player: displayName, type: 'daily-cosmetic',
            items: data.dailyLootBox, game: gameName
          });
        }
        if (data.lootBox) {
          _config.io.emit('cosmetic-reward', {
            player: displayName, type: 'daily-all-lootbox',
            items: data.lootBox, game: gameName
          });
        }
        if (data.weeklyCosmetic && data.weeklyCosmetic.length > 0) {
          _config.io.emit('cosmetic-reward', {
            player: displayName, type: 'weekly-lootbox',
            items: data.weeklyCosmetic, game: gameName
          });
        }
        if (data.weeklyAllGamesBox && data.weeklyAllGamesBox.length > 0) {
          _config.io.emit('cosmetic-reward', {
            player: displayName, type: 'weekly-all-lootbox',
            items: data.weeklyAllGamesBox, game: gameName
          });
        }
      }
      return data;
    } catch (e) {
      const retryable = e && e.retryable !== false;
      if (attempt < MAX_RETRIES) {
        if (!retryable) {
          console.error(`[Reward] Permanent failure for ${displayName} (${gameName}):`, e.message);
          return null;
        }
        const delay = attempt * 2000;
        console.warn(`[Reward] Attempt ${attempt}/${MAX_RETRIES} failed for ${displayName} (${gameName}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[Reward] All ${MAX_RETRIES} attempts failed for ${displayName} (${gameName}):`, e.message);
        return null;
      }
    }
  }
}

// ── Library Word Reporting ──────────────────────────────────────────────────

/**
 * Report a word found by a player to Word Tycoon's library.
 * If the word is new to the player's library, emits 'library-word-new' via Socket.IO.
 *
 * @param {string} platform
 * @param {string} userId
 * @param {string} word
 * @param {string} game - game identifier
 */
async function reportLibraryWord(platform, userId, word, game, username, displayName, socket) {
  if (!word || !userId) return;
  if (String(platform || '').toLowerCase() === 'bot') return; // simulated viewers earn no library credit
  if (isGuestId(userId)) return;
  const payload = { platform, userId, word: word.toLowerCase(), game };
  if (username) payload.username = username;
  if (displayName) payload.displayName = displayName;
  try {
    const res = await fetch(`${_config.wordEmpiresUrl}/api/library/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': _config.apiSecret
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok && data.isNew) {
      const evt = { word: word.toLowerCase(), userId, displayName: displayName || null };
      // Emit to specific player's socket (with self flag for client filtering)
      if (socket && typeof socket.emit === 'function') {
        socket.emit('library-word-new', { ...evt, self: true });
      }
      // Broadcast for OBS overlays
      if (_config.io) {
        _config.io.emit('library-word-new', evt);
      }
    }
  } catch {}
}

// ── Cosmetics Cache ─────────────────────────────────────────────────────────

const _cosmeticsCache = new Map();
const COSMETICS_TTL = 60000; // 1 minute

/**
 * Fetch a player's equipped cosmetics from Word Tycoon.
 * Cached for 60 seconds. Returns empty object on failure.
 */
async function getPlayerCosmetics(platform, userId) {
  if (!platform || !userId) return {};
  if (isGuestId(userId)) return {};
  const key = `${platform}:${userId}`;
  const cached = _cosmeticsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const res = await fetch(`${_config.wordEmpiresUrl}/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}`);
    const data = res.ok ? (await res.json()).equipped || {} : {};
    _cosmeticsCache.set(key, { data, expiresAt: Date.now() + COSMETICS_TTL });
    // Evict expired entries if cache grows too large
    if (_cosmeticsCache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of _cosmeticsCache) { if (v.expiresAt < now) _cosmeticsCache.delete(k); }
    }
    return data;
  } catch {
    return cached ? cached.data : {};
  }
}

/**
 * Invalidate or update a player's cosmetics cache entry.
 * Called when 'cosmetics-updated' event is received from Chat Relay.
 */
function invalidateCosmetics(platform, platformUserId, equipped) {
  const key = `${platform}:${platformUserId}`;
  if (equipped) {
    _cosmeticsCache.set(key, { data: equipped, expiresAt: Date.now() + COSMETICS_TTL });
  } else {
    _cosmeticsCache.delete(key);
  }
}

// ── Relay Client Factory ────────────────────────────────────────────────────

/**
 * Create a standard Socket.IO Chat Relay client for game servers.
 *
 * @param {Object} config
 * @param {string} config.id
 * @param {string} config.name
 * @param {number|string} config.port
 * @param {string} [config.relayUrl]
 * @param {string} [config.apiSecret]
 * @param {boolean} [config.reconnection]
 * @param {number} [config.reconnectionDelay]
 * @param {number} [config.reconnectionDelayMax]
 * @param {number} [config.reconnectionAttempts]
 * @param {number} [config.timeout]
 * @param {(url: string, options: Object) => Object} [config.clientFactory] - test hook
 * @param {Object} [handlers]
 * @param {(data: Object) => void} [handlers.onChat]
 * @param {(data: Object) => void} [handlers.onCosmeticsUpdated]
 * @param {(data: Object) => void} [handlers.onFrenzyUpdate]
 * @param {() => void} [handlers.onActivateDaily]
 * @param {(data: Object) => void} [handlers.onRevealHint]
 * @param {(data: Object) => void} [handlers.onEngagement]
 * @param {(socket: Object, ack?: any) => void} [handlers.onConnect]
 * @param {(reason?: string) => void} [handlers.onDisconnect]
 * @param {(error: Error) => void} [handlers.onConnectError]
 * @returns {Object}
 */
function createRelayClient(config = {}, handlers = {}) {
  const {
    id,
    name,
    port,
    relayUrl = process.env.CHAT_RELAY_URL || DEFAULT_CHAT_RELAY_URL,
    apiSecret = process.env.GAME_API_SECRET,
    reconnection = true,
    reconnectionDelay = 2000,
    reconnectionDelayMax,
    reconnectionAttempts = Infinity,
    timeout,
    clientFactory = ioClient
  } = config;

  const options = {
    reconnection,
    reconnectionDelay,
    reconnectionAttempts
  };

  if (typeof reconnectionDelayMax === 'number') options.reconnectionDelayMax = reconnectionDelayMax;
  if (typeof timeout === 'number') options.timeout = timeout;

  const socket = clientFactory(relayUrl, options);
  let didLogConnectError = false;

  socket.on('connect', () => {
    didLogConnectError = false;
    console.log(`[${name}] Connected to Chat Relay`);
    socket.emit('app-register', { id, name, port, apiKey: apiSecret }, (ack) => {
      if (ack?.success) console.log(`[${name}] Registered with Chat Relay`);
      if (typeof handlers.onConnect === 'function') handlers.onConnect(socket, ack);
    });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[${name}] Disconnected from Chat Relay`);
    if (typeof handlers.onDisconnect === 'function') handlers.onDisconnect(reason);
  });

  socket.on('connect_error', (err) => {
    if (!didLogConnectError) {
      console.log(`[${name}] Chat Relay connection error (will retry):`, err.message);
      didLogConnectError = true;
    }
    if (typeof handlers.onConnectError === 'function') handlers.onConnectError(err);
  });

  if (typeof handlers.onChat === 'function') {
    socket.on('chat-message', (data) => {
      if (data && data.isJoin) return;
      handlers.onChat(data);
    });
  }
  if (typeof handlers.onCosmeticsUpdated === 'function') {
    socket.on('cosmetics-updated', (data) => handlers.onCosmeticsUpdated(data));
  }
  if (typeof handlers.onFrenzyUpdate === 'function') {
    socket.on('frenzy-update', (data) => handlers.onFrenzyUpdate(data));
  }
  if (typeof handlers.onActivateDaily === 'function') {
    socket.on('activate-daily', () => handlers.onActivateDaily());
  }
  if (typeof handlers.onRevealHint === 'function') {
    // Like-for-Hint: chat-relay broadcasts this when a streamer's likeHint
    // widget crosses its threshold. Payload: { streamerHandle, count, test }.
    // Games reveal a hint only if they own a live session for that handle.
    socket.on('reveal-hint', (data) => handlers.onRevealHint(data));
  }
  if (typeof handlers.onEngagement === 'function') {
    socket.on('engagement', (data) => handlers.onEngagement(data));
  }

  return socket;
}

// ── Edmonton Date Helper ────────────────────────────────────────────────────
// All daily/weekly systems use America/Edmonton timezone to align with Word Tycoon.
const _edmontonDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.DAILY_TIMEZONE || 'America/Edmonton',
  year: 'numeric', month: '2-digit', day: '2-digit'
});
function getEdmontonDate() {
  return _edmontonDateFmt.format(new Date()); // YYYY-MM-DD
}

// ── IP Logging ──────────────────────────────────────────────────────────────

// In-memory dedup: "platform:userId:ip" → expiry timestamp
const _ipReportCache = new Map();
const IP_REPORT_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Extract the real client IP from a Socket.IO socket's handshake headers.
 * Priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For > socket address.
 */
function getClientIP(socket) {
  const h = socket?.handshake?.headers;
  if (!h) return null;
  const cfIP = h['cf-connecting-ip'];
  if (cfIP) return cfIP.trim();
  const realIP = h['x-real-ip'];
  if (realIP) return realIP.trim();
  const xff = h['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return socket.handshake?.address || null;
}

/**
 * Report a player's IP to Word Tycoon for storage. Fire-and-forget with dedup.
 */
async function reportPlayerIP(platform, platformUserId, ip, game) {
  if (!platform || !platformUserId || !ip) return;
  const key = `${platform}:${platformUserId}:${ip}`;
  const now = Date.now();
  if (_ipReportCache.has(key) && _ipReportCache.get(key) > now) return;
  _ipReportCache.set(key, now + IP_REPORT_TTL);
  // Evict expired entries periodically
  if (_ipReportCache.size > 2000) {
    for (const [k, exp] of _ipReportCache) { if (exp < now) _ipReportCache.delete(k); }
  }
  try {
    await fetch(`${_config.wordEmpiresUrl}/api/report-ip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': _config.apiSecret
      },
      body: JSON.stringify({ platform, platformUserId, ip, game })
    });
  } catch {}
}

/**
 * Convenience: extract IP from a socket and report it for a known player.
 * Skips localhost/loopback IPs (relay or server-to-server connections).
 */
function reportSocketIP(socket, platform, platformUserId, game) {
  if (!socket || !platformUserId) return;
  const ip = getClientIP(socket);
  if (!ip) return;
  // Skip loopback — these are relay/server connections, not real users
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return;
  reportPlayerIP(platform, platformUserId, ip, game);
}

// ── Exports ─────────────────────────────────────────────────────────────────


// ─── Word-find scoring helpers (shared across rectangled / sproutle / wikirectangled) ────
// Ported from /opt/sproutle/src/game.js — kept here so all word-find games can
// call the same per-letter and per-length bonus tables. Tweaks land in one place.

const _WORD_LENGTH_BONUS_TABLE = { 4: 75, 5: 150, 6: 300, 7: 500, 8: 800, 9: 1200, 10: 1750, 11: 2500 };
const _WORD_LENGTH_BONUS_MAX = 3500;
function getWordLengthBonus(word) {
  const len = (word || '').length;
  if (len <= 3) return 0;
  if (len >= 12) return _WORD_LENGTH_BONUS_MAX;
  return _WORD_LENGTH_BONUS_TABLE[len] || 0;
}

const _LETTER_RARITY = {
  e: 0, t: 0, a: 0, o: 0, i: 0, n: 0, s: 0, h: 0, r: 0,
  d: 15, l: 15,
  c: 30, u: 30, m: 30, w: 30, f: 30,
  g: 60, y: 60, p: 60,
  b: 105, v: 105, k: 105,
  j: 180, x: 180,
  q: 300, z: 300,
};
const _LETTER_TIER_NAMES = {
  0: 'common', 15: 'uncommon', 30: 'rare', 60: 'epic',
  105: 'legendary', 180: 'mythic', 300: 'unique',
};
function getLetterRarityBonus(word) {
  let bonus = 0;
  const tierCounts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, unique: 0 };
  for (const ch of String(word || '').toLowerCase()) {
    const b = _LETTER_RARITY[ch];
    if (b === undefined) continue;
    bonus += b;
    tierCounts[_LETTER_TIER_NAMES[b]]++;
  }
  return { bonus, tierCounts };
}

// ─── Premium web-play gate (shared, 2026-07-31) ──────────────────────────
// Single implementation of the Donor-Class / Super-Fan check every game runs
// before accepting a WEBSITE guess — public rooms AND streamer session pages.
//
// History: each game grew its own copy when public MP was gated (2026-07-17).
// Most of those copies decide "logged in" by DISCORD SNOWFLAKE SHAPE
// (/^\d{17,20}$/) and hard-block anything else, which silently walls out
// GitHub / Google / TikTok logins whose subscription hangs off a LINKED
// account. That was survivable in public rooms; streamer session pages are
// full of exactly those viewers, so this version hands whatever id the client
// holds to the relay and lets computePremiumById resolve the linked group
// (relay server.js — resolveAnyLinkedDiscord / isLinkedTiktokSuperfan).
//
// Semantics (deliberate):
//   - anonymous guests are refused WITHOUT a lookup (they can never be premium)
//   - a relay hiccup FAILS OPEN — a relay outage must never wall the games
//   - only WEB sockets reach this; TikTok/Discord chat play-along enters via
//     createRelayClient's chat-message path and is never gated.
const PREMIUM_WEB_TTL_MS = 60 * 1000;
const _premiumWebCache = new Map(); // id -> { at, premium }

/**
 * True when an id belongs to an unauthenticated web player. Superset of the
 * per-game copies — those only knew web_guest_/guest_/'anon', so a wsguest_
 * or anon_ id skipped the guest short-circuit and burned a relay lookup.
 */
function isAnonWebId(id) {
  const s = String(id || '').toLowerCase();
  if (!s || s === 'anon' || s === 'guest' || s === 'unknown') return true;
  return s.startsWith('web_guest_') || s.startsWith('guest_') ||
         s.startsWith('wsguest_') || s.startsWith('guest-') ||
         s.startsWith('anon_') || s.startsWith('bot_');
}

// ── Verified socket identity ────────────────────────────────────────────────
// Resolved once per socket and memoised on it. `undefined` = not looked up yet,
// `null` = looked up and this socket carries no proof of identity.
// Enforcement is ON by default. It is read inside each GAME process, not the
// relay, so keying it to an env var would mean setting it in 16 separate PM2
// environments; defaulting to on keeps this one shared file the single control.
// To roll back: set WEB_IDENTITY_ENFORCE=0 in a game's env, or flip this line.
const IDENTITY_ENFORCE = process.env.WEB_IDENTITY_ENFORCE !== '0';

function _socketCookieHeader(socket) {
  return (socket && socket.handshake && socket.handshake.headers &&
          socket.handshake.headers.cookie) || '';
}

/**
 * The identity this socket can PROVE, or null.
 *
 * The proof is the wt_remember cookie the relay set at login: an HMAC over the
 * user id signed with SESSION_SECRET, which only the relay can produce. The game
 * server forwards the header and the relay hands back the id it verifies. A
 * client that fabricates data.user.id cannot fabricate this.
 *
 * Returns null on any relay/network failure — callers decide what that means;
 * see passesPremiumWebGate, which deliberately does not harden on a hiccup.
 */
async function verifySocketIdentity(socket) {
  if (!socket) return null;
  if (socket._wtVerifiedIdentity !== undefined) return socket._wtVerifiedIdentity;

  const cookie = _socketCookieHeader(socket);
  if (!cookie) { socket._wtVerifiedIdentity = null; return null; }

  const relayUrl = process.env.CHAT_RELAY_URL || DEFAULT_CHAT_RELAY_URL;
  try {
    const r = await fetch(`${relayUrl}/api/internal/whoami`, {
      headers: {
        'x-api-key': _config.apiSecret,
        // Deliberately NOT the Cookie header: this is a server-to-server call and
        // the relay must not treat these as its own request cookies.
        'x-forwarded-cookie': cookie
      }
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    const id = data && data.user && data.user.id ? String(data.user.id) : null;
    socket._wtVerifiedIdentity = id;
    // Aliases this identity may legitimately present in a game payload.
    socket._wtVerifiedAliases = new Set(
      [id, data && data.user && data.user.anchorId].filter(Boolean).map((v) => String(v).toLowerCase())
    );
    return id;
  } catch (e) {
    // Do not cache a failure — the next guess gets a fresh attempt.
    return null;
  }
}

/**
 * The id a web action should be attributed to: the verified one when we have it,
 * otherwise the best client-asserted candidate.
 *
 * Games should use this for reward/XP attribution instead of data.user.id, so a
 * player cannot bank their score into someone else's account.
 *
 * @returns {Promise<{id: string, verified: boolean, claimed: string}>}
 */
async function resolveWebIdentity(candidateIds, socket) {
  const list = Array.isArray(candidateIds) ? candidateIds : [candidateIds];
  let claimed = '';
  for (const c of list) {
    const s = String(c || '').trim();
    if (s && !isAnonWebId(s)) { claimed = s; break; }
  }
  const verified = await verifySocketIdentity(socket);
  if (verified) {
    const aliases = socket._wtVerifiedAliases || new Set([String(verified).toLowerCase()]);
    // A linked player's payload names their WT anchor while the cookie proves
    // the gh_/go_/tt_ side. Both are the same person, so both are accepted.
    const claimIsSamePerson = !claimed || aliases.has(String(claimed).toLowerCase());
    if (!claimIsSamePerson) {
      console.warn(`[Identity] impersonation blocked: socket proves ${verified} (aliases ${[...aliases].join('/')}), payload claimed ${claimed}`);
    }
    return { id: verified, verified: true, claimed, claimIsSamePerson };
  }
  return { id: claimed, verified: false, claimed, claimIsSamePerson: true };
}

async function isPremiumWebUser(accountId) {
  const id = String(accountId || '');
  if (isAnonWebId(id) || id.length > 64) return false;
  const hit = _premiumWebCache.get(id);
  if (hit && Date.now() - hit.at < PREMIUM_WEB_TTL_MS) return hit.premium;
  const relayUrl = process.env.CHAT_RELAY_URL || DEFAULT_CHAT_RELAY_URL;
  try {
    const r = await fetch(`${relayUrl}/api/public/entitlement?discordId=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    const premium = !!(data && data.premium);
    if (_premiumWebCache.size > 5000) _premiumWebCache.clear();
    _premiumWebCache.set(id, { at: Date.now(), premium });
    return premium;
  } catch (e) {
    return true; // fail open — never lock the games on a relay hiccup
  }
}

// Perk badges for a WEB player. The relay stamps superfan/fan-club badges onto
// chat identities itself, but those are keyed by TikTok handle — a player
// signed in on the site with Discord/GitHub/Google has no such key, so games
// saw no perks for them at all.
//
// Fails CLOSED (no badges) rather than open: a relay hiccup should drop a
// decoration, never invent one. Contrast isPremiumWebUser above, which fails
// open because the cost there is locking a paying player out of a game.
const NO_PERKS = Object.freeze({ superfan: false, donor: false, fanClub: false });
const _perksWebCache = new Map(); // accountId -> { at, perks }
const PERKS_WEB_TTL_MS = 60000;

async function getWebPlayerPerks(accountId) {
  const id = String(accountId || '');
  if (!id || isAnonWebId(id) || isGuestId(id) || id.length > 64) return NO_PERKS;
  const hit = _perksWebCache.get(id);
  if (hit && Date.now() - hit.at < PERKS_WEB_TTL_MS) return hit.perks;
  const relayUrl = process.env.CHAT_RELAY_URL || DEFAULT_CHAT_RELAY_URL;
  try {
    const r = await fetch(`${relayUrl}/api/public/perks?discordId=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    const perks = {
      superfan: !!(data && data.superfan),
      donor: !!(data && data.donor),
      fanClub: !!(data && data.fanClub),
    };
    if (_perksWebCache.size > 5000) _perksWebCache.clear();
    _perksWebCache.set(id, { at: Date.now(), perks });
    return perks;
  } catch (e) {
    // Serve a stale entry ahead of nothing — a player's badges shouldn't blink
    // out for a minute because one request timed out.
    return hit ? hit.perks : NO_PERKS;
  }
}

/**
 * Gate a web guess. Pass every identity the client handed you, best first
 * (linkedDiscord, platformUserId, id) — the first non-guest one is used.
 *
 * @param {string|string[]} candidateIds
 * @param {Object} socket - emitted 'premium-required' on refusal
 * @param {string} [context] - 'mp' (public room) | 'session' (streamer page)
 * @returns {Promise<boolean>} true when the guess may proceed
 */
async function passesPremiumWebGate(candidateIds, socket, context = 'mp') {
  const { id, verified, claimed, claimIsSamePerson } = await resolveWebIdentity(candidateIds, socket);

  // Refuse outright when the socket proves one person and the payload names
  // another. This is what makes reward/XP/ELO attribution correct in every game
  // without touching any of them: the only payload that gets past this point is
  // one that names the real player, so whatever the game does downstream with
  // its own id variables is already the right account.
  if (verified && !claimIsSamePerson) {
    try { socket.emit('premium-required', { loggedIn: true, context, reason: 'identity_mismatch' }); } catch (e) {}
    return false;
  }

  // A verified identity always wins — including when it is LESS privileged than
  // the claim. That is the whole point: entitlement follows the person holding
  // the cookie, not the string in the payload.
  let gateId = verified ? id : '';

  if (!verified) {
    // No proof. Enforcing means an unprovable claim buys nothing; observing
    // means we behave exactly as before and just record it, so the enforcement
    // switch can be flipped on evidence rather than hope. The population at
    // risk is real: a game iframed on another origin loses the cookie to
    // third-party cookie blocking even though the player is legitimately
    // signed in.
    if (claimed) {
      console.warn(`[Identity] unverified claim ${claimed} (context ${context}, enforce=${IDENTITY_ENFORCE ? 'on' : 'off'})`);
    }
    if (!IDENTITY_ENFORCE) gateId = claimed;
  }

  if (gateId && await isPremiumWebUser(gateId)) {
    // Stash the player's perk badges on the socket. Every game wraps this
    // function with its own signature (arrays of ids, a bare id, a user
    // object, socket-only), so there is no shared argument to hang them off —
    // but every one of them has the socket. Games spread socket._wtPerks into
    // whatever user object they build; games that don't render badges simply
    // ignore it.
    //
    // Keyed off the VERIFIED id only. Stamping perks for an unproven claim
    // would let anyone wear a Super Fan heart by editing their payload, which
    // is exactly the attack resolveWebIdentity exists to stop.
    socket._wtPerks = verified ? _perksToFlags(await getWebPlayerPerks(gateId)) : _perksToFlags(NO_PERKS);
    return true;
  }
  try { socket.emit('premium-required', { loggedIn: !!gateId, context }); } catch (e) {}
  return false;
}

// Games name these flags isFanClub / isSuperfan (the shape chat identities
// already arrive in), so translate once here rather than in each game.
function _perksToFlags(perks) {
  return {
    isSuperfan: !!perks.superfan,
    isDonor: !!perks.donor,
    isFanClub: !!perks.fanClub,
  };
}

module.exports = {
  init,
  isGuestId,
  isStatsEligible,
  isAnonWebId,
  isPremiumWebUser,
  getWebPlayerPerks,
  passesPremiumWebGate,
  verifySocketIdentity,
  resolveWebIdentity,
  rewardPlayer,
  reportLibraryWord,
  getPlayerCosmetics,
  invalidateCosmetics,
  createRelayClient,
  getEdmontonDate,
  getClientIP,
  reportPlayerIP,
  reportSocketIP,
  getLetterRarityBonus,
  getWordLengthBonus,
};
