// ===== Searchle 3.0 Server =====
// Three.js upgrade — server logic unchanged, serves Vite build output.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.play-billing') });
if (!process.env.GAME_API_SECRET) throw new Error('Game service credential unavailable');

const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
// Companion rank access is read-only and does not grant Searchle service authority.
const canCompanionRank = require('./companion-rank-auth').createCompanionRankAuth({ selfKey: process.env.GAME_API_SECRET });

const config = require('./config');
const rankingEngine = require('./ranking-engine');
const gameManager = require('./game-manager');
const numberGameManager = require('./number-game-manager');
const guessProcessor = require('./guess-processor');
const { toSingular, toAmerican, isBlockedGuess } = require('./guess-processor');
const cosmeticsCache = require('./cosmetics-cache');
const relayClient = require('./relay-client');
const syncServer = require('./sync-server');
const sessionManager = require('./session-manager');
const numberSessionManager = require('./number-session-manager');
const { PlayBilling } = require('./play-billing');
const { createPremiumWebGate } = require('./web-premium-gate');

const playBilling = new PlayBilling();
playBilling.startBackgroundTasks();

// Per-streamer session room name. Sockets that connect with auth.session
// join this room; session-room emits scope event broadcasts to that
// streamer's audience only (vs the public game's broadcasts which use
// io.to('public')).
function _normalizeSearchleVariant(rawVariant) {
  const value = String(rawVariant || '').toLowerCase();
  return (value === 'numbers' || value === 'number' || value === 'searchle-numbers')
    ? 'numbers'
    : 'searchle';
}

function _searchleVariantFromGameId(rawGameId) {
  const value = String(rawGameId || '').toLowerCase();
  if (!value) return null;
  if (value === 'searchle-numbers' || value === 'numbers' || value === 'number') return 'numbers';
  if (value === 'searchle' || value === 'searchle-grid') return 'searchle';
  return null;
}

function _resolveSearchleSessionVariant(rawGameId, rawVariant) {
  return _searchleVariantFromGameId(rawGameId) || _normalizeSearchleVariant(rawVariant);
}

function _sessionRoom(handle, variant = 'searchle') {
  return `searchle:session:${_normalizeSearchleVariant(variant)}:${String(handle || '').toLowerCase()}`;
}

function _sessionRedirectKey(handle, variant = 'searchle') {
  return `${_normalizeSearchleVariant(variant)}:${String(handle || '').toLowerCase()}`;
}

function _searchleVariantsFromMessage(msg) {
  const variants = [];
  const pushVariant = (rawGameId) => {
    const variant = _searchleVariantFromGameId(rawGameId);
    if (variant && !variants.includes(variant)) variants.push(variant);
  };

  if (Array.isArray(msg?.streamerGameIds)) {
    for (const rawGameId of msg.streamerGameIds) pushVariant(rawGameId);
  }
  if (!variants.length && msg?.variant) pushVariant(msg.variant);
  if (!variants.length && msg?.streamerGameId) pushVariant(msg.streamerGameId);
  if (!variants.length && msg?.gameId) pushVariant(msg.gameId);
  if (!variants.length && msg?.streamerHandle) {
    variants.push(_normalizeSearchleVariant(msg?._sessionVariant || msg?.variant));
  }
  return variants;
}
const NUMBERS_PUBLIC_ROOM = 'numbers:public';

const sassie = require('./sassie');
sassie.init();

const { requireRelayOrShared } = require('./shared-resolver');
const gameShared = requireRelayOrShared('src/game-shared.js');
const syncClient = require('./sync-client');
const spManager = require('./sp-manager');
const spNamespace = require('./sp-namespace');
const languageProfiles = require('./language-profiles');

const BOT_RANKINGS_CACHE_LIMIT = 64;
const discordBotRankingsCache = new Map();

async function getDiscordBotRankings(targetWord) {
  const key = String(targetWord || '').trim().toLowerCase();
  if (!key) return new Map();

  if (discordBotRankingsCache.has(key)) {
    const existing = discordBotRankingsCache.get(key);
    discordBotRankingsCache.delete(key);
    discordBotRankingsCache.set(key, existing);
    return existing.promise;
  }

  const entry = {
    promise: rankingEngine.computeRankings(key, config),
    createdAt: Date.now()
  };
  discordBotRankingsCache.set(key, entry);

  while (discordBotRankingsCache.size > BOT_RANKINGS_CACHE_LIMIT) {
    const oldestKey = discordBotRankingsCache.keys().next().value;
    discordBotRankingsCache.delete(oldestKey);
  }

  return entry.promise;
}

// Companion ranking cache — backs POST /api/rank used by WikiSearchle to
// score guesses against an arbitrary target word without disturbing
// Searchle's own active game state. Per-target LRU cache.
const COMPANION_RANK_CACHE_LIMIT = 128;
const companionRankCache = new Map();

// Stats for /api/rank/stats. The companionRankCache.* counters are
// incremented inside getCompanionRankings, so cache events are captured
// even on calls that don't go through the /api/rank handler.
const apiRankStats = {
  startedAt: Date.now(),
  requests: 0,
  unauthorized: 0,
  badInput: 0,
  errors: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheEvictions: 0,
  totalWordsScored: 0,
  totalRanksReturned: 0,
  // Last N latencies in ms (computeRankings duration, full handler duration).
  // Circular: write to (count % SIZE), read up to min(count, SIZE).
  _latencyComputeMs: new Float32Array(500),
  _latencyHandlerMs: new Float32Array(500),
  _latencyCount: 0,
  // Per-target counter, capped to TOP_TARGETS_LIMIT distinct keys to bound
  // memory if companion games go wild. Eviction happens by drop-the-coldest.
  _targetCounts: new Map(),
};
const STATS_LATENCY_SIZE = 500;
const STATS_TOP_TARGETS_LIMIT = 200;

function recordTargetHit(target) {
  const cur = apiRankStats._targetCounts.get(target) || 0;
  apiRankStats._targetCounts.set(target, cur + 1);
  if (apiRankStats._targetCounts.size > STATS_TOP_TARGETS_LIMIT) {
    // Drop the entry with the lowest count (cold). With 200 entries this
    // is a few-microsecond linear scan and only happens when we've added
    // more than 200 distinct targets total.
    let coldKey = null;
    let coldCount = Infinity;
    for (const [k, v] of apiRankStats._targetCounts) {
      if (v < coldCount) { coldCount = v; coldKey = k; }
    }
    if (coldKey !== null && coldKey !== target) {
      apiRankStats._targetCounts.delete(coldKey);
    }
  }
}

function recordLatency(computeMs, handlerMs) {
  const slot = apiRankStats._latencyCount % STATS_LATENCY_SIZE;
  apiRankStats._latencyComputeMs[slot] = computeMs;
  apiRankStats._latencyHandlerMs[slot] = handlerMs;
  apiRankStats._latencyCount++;
}

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const idx = Math.min(samples.length - 1, Math.floor(samples.length * p));
  return samples[idx];
}

function getApiRankStats() {
  const filled = Math.min(apiRankStats._latencyCount, STATS_LATENCY_SIZE);
  const computeArr = Array.from(apiRankStats._latencyComputeMs.slice(0, filled)).sort((a, b) => a - b);
  const handlerArr = Array.from(apiRankStats._latencyHandlerMs.slice(0, filled)).sort((a, b) => a - b);

  const topTargets = [...apiRankStats._targetCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([target, count]) => ({ target, count }));

  const cacheTotal = apiRankStats.cacheHits + apiRankStats.cacheMisses;

  return {
    uptimeSec: Math.round((Date.now() - apiRankStats.startedAt) / 1000),
    requests: apiRankStats.requests,
    unauthorized: apiRankStats.unauthorized,
    badInput: apiRankStats.badInput,
    errors: apiRankStats.errors,
    cache: {
      size: companionRankCache.size,
      limit: COMPANION_RANK_CACHE_LIMIT,
      hits: apiRankStats.cacheHits,
      misses: apiRankStats.cacheMisses,
      evictions: apiRankStats.cacheEvictions,
      hitRate: cacheTotal > 0 ? Number((apiRankStats.cacheHits / cacheTotal).toFixed(3)) : null,
    },
    words: {
      totalScored: apiRankStats.totalWordsScored,
      totalRanksReturned: apiRankStats.totalRanksReturned,
      hitRate: apiRankStats.totalWordsScored > 0
        ? Number((apiRankStats.totalRanksReturned / apiRankStats.totalWordsScored).toFixed(3))
        : null,
    },
    latencyMs: {
      samples: filled,
      // Compute = time spent inside computeRankings (≈0 on cache hit, ~750ms
      // cold). Handler = total /api/rank handler time including JSON parse,
      // morphology fallbacks, response shaping.
      compute: filled > 0 ? {
        p50: Number(percentile(computeArr, 0.5).toFixed(2)),
        p95: Number(percentile(computeArr, 0.95).toFixed(2)),
        p99: Number(percentile(computeArr, 0.99).toFixed(2)),
        max: Number(computeArr[computeArr.length - 1].toFixed(2)),
      } : null,
      handler: filled > 0 ? {
        p50: Number(percentile(handlerArr, 0.5).toFixed(2)),
        p95: Number(percentile(handlerArr, 0.95).toFixed(2)),
        p99: Number(percentile(handlerArr, 0.99).toFixed(2)),
        max: Number(handlerArr[handlerArr.length - 1].toFixed(2)),
      } : null,
    },
    topTargets,
  };
}

async function getCompanionRankings(targetWord) {
  const key = String(targetWord || '').trim().toLowerCase();
  if (!key) return new Map();
  if (companionRankCache.has(key)) {
    const existing = companionRankCache.get(key);
    companionRankCache.delete(key);
    companionRankCache.set(key, existing);
    apiRankStats.cacheHits++;
    return existing.promise;
  }
  apiRankStats.cacheMisses++;
  const entry = { promise: rankingEngine.computeRankings(key, config) };
  companionRankCache.set(key, entry);
  while (companionRankCache.size > COMPANION_RANK_CACHE_LIMIT) {
    const oldestKey = companionRankCache.keys().next().value;
    companionRankCache.delete(oldestKey);
    apiRankStats.cacheEvictions++;
  }
  return entry.promise;
}

function normalizeDiscordBotGuess(rawGuess) {
  const raw = String(rawGuess || '').trim().toLowerCase();
  if (!raw || raw.includes(' ') || raw.includes('\t')) {
    return { normalizedGuess: null, reason: 'invalid_format' };
  }
  if (isBlockedGuess(raw)) {
    return { normalizedGuess: null, reason: 'blocked' };
  }
  const lettersOnly = raw.replace(/[^a-z]/g, '');
  if (!lettersOnly || !config.guessPattern.test(lettersOnly)) {
    return { normalizedGuess: null, reason: 'invalid_format' };
  }
  const normalizedGuess = toAmerican(toSingular(lettersOnly));
  if (isBlockedGuess(normalizedGuess)) {
    return { normalizedGuess: null, reason: 'blocked' };
  }
  return { normalizedGuess, reason: null };
}

function requireInternalApiKey(req, res, next) {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] === apiSecret || req.headers['x-relay-auth'] === apiSecret) {
    return next();
  }
  return res.status(401).json({ ok: false, message: 'Unauthorized' });
}

// ---------------------------------------------------------------------------
// Standardized Jackpot Settings (synced with gameManager's jackpotEnabled)
// ---------------------------------------------------------------------------
let jackpotSettings = {
  enabled: true,  // will be synced from gameManager
  dailyEnabled: true,
  base: 3000,     // minimum pot (floor) — actual formula uses nonlinear scaling above this
  perGuess: 10,   // linear rate up to 1000 guesses, then exponent 1.5
  perSecond: 17,  // linear rate up to 600s (~10min), then exponent 1.5
  max: 0          // no cap — pot grows with nonlinear scaling
};

function calculateSearchleJackpot() {
  // Delegate to gameManager's real calculatePot() which uses nonlinear scaling
  return gameManager.calculatePot();
}

const PORT = process.env.PORT || config.port;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || config.chatRelayUrl;

// ── Premium web-play gate (2026-07-17) ──────────────────────────────
// Public-room website play (classic MP + numbers) requires Donor Class or
// TikTok Super Fan; anonymous web guests are rejected outright. Streamer
// SESSION sockets are exempt (live-show play-along stays free) — their
// test-guess handlers are registered in the session branch and never reach
// this gate. Chat-relay platform messages (tiktok/discord chat) also bypass:
// they arrive via relayClient.onChatMessage, not test-guess.
// The check itself lives in chat-relay's game-shared.js (2026-07-31) so every
// game gates identically and one edit changes the rule everywhere.
const isAnonWebId = (id) => gameShared.isAnonWebId(id);

// Gate for web guesses — public room and streamer player page alike. Returns
// true when the guess may proceed; otherwise emits premium-required and
// returns false.
const passesPremiumWebGate = createPremiumWebGate({
  gameShared, playBilling, resolveAccount: resolveUserFromCookie,
});

// Whitelist of streamer handles allowed to spawn private sessions.
// Refreshed from chat-relay every 5 min so newly-whitelisted streamers
// get their /<handle> URL working without a restart. Empty set = deny
// all (fail-closed) on boot until first refresh succeeds.
let _validStreamerHandles = new Set();
// Per-streamer settings: { disablePlayerPage: bool, blockedSet: Set<"platform:id"> }
let _streamerSettings = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-handles`, {redirect:'error',signal:AbortSignal.timeout(5000)});
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
        m.set(h, { disablePlayerPage: !!s.disablePlayerPage, blockedSet: bset });
      }
      _streamerSettings = m;
    }
  } catch (_) { /* keep stale set on transient errors */ }
}
_refreshStreamerHandles();
setInterval(_refreshStreamerHandles, 5 * 60 * 1000).unref();

// Per-handle Searchle prefs cache. Streamers set these on the chat-relay
// dashboard (/api/streamer/difficulty). We cache the result for 60s so
// session creation stays fast and changes propagate without spamming relay.
const _difficultyCache = new Map(); // handle -> { value, language, fetchedAt }
const _DIFFICULTY_TTL_MS = 60 * 1000;
async function _getStreamerSearchlePrefs(handle) {
  const key = String(handle || '').toLowerCase();
  if (!key) return { wordFrequency: 'normal', language: 'en' };
  const cached = _difficultyCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < _DIFFICULTY_TTL_MS) {
    return { wordFrequency: cached.value, language: cached.language || 'en' };
  }
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-public/by-handle/${encodeURIComponent(key)}/difficulty`, {redirect:'error',signal:AbortSignal.timeout(5000)});
    if (!res.ok) {
      _difficultyCache.set(key, { value: 'normal', language: 'en', fetchedAt: Date.now() });
      return { wordFrequency: 'normal', language: 'en' };
    }
    const data = await res.json();
    const value = (data && typeof data.wordFrequency === 'string') ? data.wordFrequency : 'normal';
    const language = languageProfiles.normalizeLanguageId(data && data.searchleLanguage);
    _difficultyCache.set(key, { value, language, fetchedAt: Date.now() });
    return { wordFrequency: value, language };
  } catch (_) {
    // Network glitch — keep last known good if we have one, else 'normal'.
    return { wordFrequency: cached?.value || 'normal', language: cached?.language || 'en' };
  }
}
async function _getStreamerDifficulty(handle) {
  return (await _getStreamerSearchlePrefs(handle)).wordFrequency;
}
async function _getStreamerLanguage(handle) {
  return (await _getStreamerSearchlePrefs(handle)).language;
}
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

const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || config.wordEmpiresUrl;
const SYNC_SECRET = process.env.SYNC_SECRET || null;
const SYNC_PRIMARY_URL = process.env.SYNC_PRIMARY_URL || null;
const IS_FOLLOWER = !!SYNC_PRIMARY_URL;

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify its signed portal session or remember cookie. Returns null for guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;)\s*(?:wt_remember|connect\.sid)=[^;]+/.test(cookie)) return null;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      redirect: 'error', signal: AbortSignal.timeout(5000),
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
    console.error('[Searchle] whoami failed:', e.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Daily Word + Frenzy State
// ---------------------------------------------------------------------------
let dailyWord = null;
let dailyPlayed = false;
let isDaily = false;
let _startDaily = false;  // set true by activate-daily, consumed by startNextGame
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let connectedPlayers = 0;
let searchRecovery=null,numberRecovery=null,roundDailyPeriod=null,roundAdvancer=null,numberAdvancer=null;
const {createSearchRecovery}=require('./round-recovery');
const {acceptSearchGuess}=require('./accept-search-guess');
function getRecoveryMetadata(target){if(target.handle)return{handle:target.handle};return{...gameManager.snapshotMetadata(),classicSessionsMigrated:true,isDaily,dailyPlayed,startDaily:_startDaily,roundDailyPeriod,jackpotSettings};}
function setRecoveryMetadata(target,value){if(target.handle)return;gameManager.restoreMetadata(value);isDaily=value.isDaily===true;dailyPlayed=value.dailyPlayed===true;_startDaily=value.startDaily===true;roundDailyPeriod=value.roundDailyPeriod||null;if(value.jackpotSettings)jackpotSettings=value.jackpotSettings;}


const { createRoundAdvancer } = require('./round-advancer');
function ownedRoundIsCurrent(target, numbers = false) {
  const manager = numbers ? numberGameManager : gameManager;
  const sessions = numbers ? numberSessionManager : sessionManager;
  return target.handle ? sessions.getSession(target.handle) === target : manager.getGame() === target;
}
function initializeRoundAdvancers() {
  roundAdvancer = createRoundAdvancer({
    current: target => searchRecovery.current(target),
    isCurrent: target => ownedRoundIsCurrent(target),
    onError: () => console.warn('[Recovery] Searchle next round deferred'),
    advance: async (target, record) => {
      if (target.handle) {
        const prefs = await _getStreamerSearchlePrefs(target.handle);
        if (!ownedRoundIsCurrent(target) || searchRecovery.current(target)?.roundId !== record.roundId) return;
        await sessionManager.startNextSessionRound(target, config, gameManager.getTargetWordPool(), prefs.wordFrequency, prefs.language);
        io.to(_sessionRoom(target.handle)).emit('game-state', sessionManager.buildSessionState(target));
      } else if (!IS_FOLLOWER) {
        await startNextGame(config, io);
        const next = gameManager.getGame();
        syncServer.broadcastNewGame(next.targetWord, next.startTime);
        io.to('public').emit('game-state', getFullGameState());
      }
    },
  });
  numberAdvancer = createRoundAdvancer({
    current: target => numberRecovery.current(target),
    isCurrent: target => ownedRoundIsCurrent(target, true),
    onError: () => console.warn('[Recovery] Number Searchle next round deferred'),
    advance: target => {
      if (target.handle) {
        numberSessionManager.startNextSessionRound(target);
        io.to(_sessionRoom(target.handle, 'numbers')).emit('game-state', numberSessionManager.buildSessionState(target));
      } else {
        startNextNumberGame(io);
        io.to(NUMBERS_PUBLIC_ROOM).emit('game-state', getNumberFullGameState());
      }
    },
  });
}

async function fetchDailyWord() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/searchle?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    if (dailyWord && dailyWord.date !== data.date) dailyPlayed = false;
    dailyWord = data;
    console.log(`[Searchle] Daily word fetched for ${data.date}`);
  } catch (e) {
    console.warn('[Searchle] Daily word fetch failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Daily-Aware Game Start Helper
// ---------------------------------------------------------------------------
function getFullGameState() {
  const accepted = searchRecovery?.current(gameManager.getGame())?.completion;
  return {
    ...gameManager.getGameState(),
    isDaily,
    frenzy: accepted && !accepted.legacy ? { multiplier: accepted.multiplier, activeTappers: 0 } : currentFrenzy,
    podium: accepted?.podium || gameManager.getPodium(7),
    completion: accepted || null,
    ...(accepted && !accepted.legacy ? { pot: accepted.winnerPayout } : {}),
  };
}

function getNumberFullGameState() {
  return {
    ...numberGameManager.getGameState(),
    isDaily: false,
    frenzy: null,
    podium: numberGameManager.getPodium(7),
  };
}

// Broadcast the live podium (top-7 players by accumulated game XP).
// Called whenever a guess produces a non-zero XP delta; cheap enough to
// fire on every scoring guess (small JSON, top-7 only).
function broadcastPodium() {
  io.to('public').emit('podium-update', {
    podium: gameManager.getPodium(7),
  });
}

function broadcastNumberPodium() {
  io.to(NUMBERS_PUBLIC_ROOM).emit('podium-update', {
    podium: numberGameManager.getPodium(7),
  });
}

async function startNextGame(config, io) {
  const old = gameManager.getGame(), before = old.targetWord ? searchRecovery?.current(old) : null;
  try {
    if (_startDaily && !dailyPlayed && dailyWord?.word && jackpotSettings.dailyEnabled) {
      const mode = { startDaily: false, dailyPlayed: true, isDaily: true, roundDailyPeriod: dailyWord.date };
      if (await gameManager.startGameWithWord(dailyWord.word, config, io, undefined, mode)) return;
    }
    const mode = { isDaily: false, roundDailyPeriod: null };
    if (gameManager.hasPendingGame() && await gameManager.loadPendingGame(config, cosmeticsCache, io, mode)) return;
    await gameManager.startNewGame(config, io, mode);
  } catch (error) {
    if (before) setRecoveryMetadata(old, require('./round-recovery').decode(before.meta));
    throw error;
  }
}

function startNextNumberGame(io) {
  const nextGame = numberGameManager.startNewGame();
  io.to(NUMBERS_PUBLIC_ROOM).emit('new-game', {
    startTime: nextGame.startTime,
    totalRankedWords: numberGameManager.getGameState().totalRankedWords,
  });
}

// ---------------------------------------------------------------------------
// Initialize Ranking Engine (loads all embedding models)
// ---------------------------------------------------------------------------
rankingEngine.init({
  modelsDir: path.join(__dirname, '..', config.modelsDir),
  vocabPath: path.join(__dirname, '..', config.vocabPath),
  activeModels: config.activeModels,
  modelWeights: config.modelWeights,
  languageProfiles: config.languageProfiles,
  rrfK: config.rrfK,
  // Frequency gate: resolve any relative paths against the project root
  // (the parent of /server) so config.js stays portable.
  gate: config.gate ? {
    enabled: config.gate.enabled,
    rankedPoolMinZipf: config.gate.rankedPoolMinZipf,
    frequencyPath: config.gate.frequencyPath,
    keepAlwaysCoveragePath: config.gate.keepAlwaysCoveragePath,
    keepAlwaysTargetsPath: config.gate.keepAlwaysTargetsPath
      && path.isAbsolute(config.gate.keepAlwaysTargetsPath)
        ? config.gate.keepAlwaysTargetsPath
        : path.join(__dirname, '..', config.gate.keepAlwaysTargetsPath || 'data/target-words.json'),
    keepAlwaysBankDictPath: config.gate.keepAlwaysBankDictPath,
    disabledModels: config.gate.disabledModels,
  } : undefined,
});

// Load the shared Word Bank dictionary so guess-processor can tell real
// English words (outside the gated rank pool) apart from typos/nonsense.
require('./bank-dict').load();

// Note: target words loaded async in server.listen() before game starts
// filterTargetWords() also called there after loadTargetWords() completes

// ---------------------------------------------------------------------------
// Express + Socket.IO Setup
// ---------------------------------------------------------------------------
let runtimeReady = false;
const app = express();
app.use((req, res, next) => {
  if (!runtimeReady && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(503).json({ ok: false, error: 'Game recovery in progress. Please retry.' });
  next();
});
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live', 'https://searchle.live', 'https://www.searchle.live', 'https://grid.searchle.live', 'https://subtextle.com', 'https://www.subtextle.com', 'https://grid.subtextle.com'];
function isAllowedSocketOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  // Discord Activities are proxied through a client-id-specific subdomain.
  if (/^https:\/\/[A-Za-z0-9-]+\.discordsays\.com$/.test(origin)) return true;
  return false;
}
const io = new Server(server, { cors: { origin: (o, cb) => isAllowedSocketOrigin(o) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const clientDir = process.env.NODE_ENV === 'development'
  ? path.join(__dirname, '..', 'client')
  : path.join(__dirname, '..', 'dist');
const betaClientDir = process.env.NODE_ENV === 'development'
  ? path.join(__dirname, '..', 'client-v4')
  : path.join(__dirname, '..', 'dist-v4');

// The v4 interface is intentionally isolated from the current game. Keeping it
// under /beta means the existing /, /online, /solo, and OBS surfaces continue
// to use the production client while the new no-3D interface is evaluated.
app.get(/^\/beta$/, (req, res) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  res.redirect(302, `/beta/${query}`);
});
app.use('/beta', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}, express.static(betaClientDir, {
  index: 'index.html',
  etag: true,
  maxAge: 0,
}));

// Intercept root before express.static — static would otherwise serve
// dist/index.html for any GET / and the query string / hostname would
// be ignored. We serve dist/alt.html (the chip-grid page) for either:
//   - ?mode=grid query param  (streamer widget mode selector)
//   - hostname starting with 'grid.'  (grid.subtextle.com convenience URL)
// sendStreamPage is a hoisted `function` declared later in this file;
// the reference resolves at request time.
app.get('/', (req, res, next) => {
  const wantsGrid = (req.query && req.query.mode === 'grid')
    || (req.hostname && req.hostname.startsWith('grid.'));
  if (wantsGrid) return sendStreamPage(req, res);
  next();
});
app.use(express.static(clientDir));
// Digital Asset Links for the Android TWA (Play Store app). express.static
// ignores dot-directories, so /.well-known needs an explicit route.
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.type('application/json');
  // dotfiles:'allow' — sendFile's default 'ignore' 404s any .well-known segment
  res.sendFile(path.join(clientDir, '.well-known', 'assetlinks.json'), { dotfiles: 'allow' });
});
app.use('/sp-pool', compression(), express.static(
  path.join(__dirname, '..', 'data', 'sp-pool'),
  { maxAge: '7d', immutable: true }
));
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });
app.use(express.json());

app.post('/api/play-billing/handoff', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const accountId = await resolveUserFromCookie(req);
  if (!accountId) {
    return res.status(401).json({ ok: false, error: 'Sign in before subscribing.' });
  }
  let handoffId;
  try { handoffId = playBilling.createHandoff(accountId); }
  catch { return res.status(503).json({ ok: false, error: 'Purchase sessions temporarily unavailable. Please retry.' }); }
  return res.json({
    ok: true,
    productId: playBilling.productId,
    launchUrl: `subtextle://billing?handoff=${encodeURIComponent(handoffId)}`,
  });
});

app.post('/api/play-billing/verify', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await playBilling.verifyAndGrant({
      handoffId: req.body && req.body.handoffId,
      purchaseToken: req.body && req.body.purchaseToken,
      productId: req.body && req.body.productId,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('[PlayBilling] purchase verification temporarily unavailable');
    return res.status(503).json({ ok: false, error: 'Google Play verification is temporarily unavailable.' });
  }
});

app.get('/api/play-billing/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const accountId = await resolveUserFromCookie(req);
  if (!accountId) return res.json({ ok: true, loggedIn: false, active: false });
  const active = await playBilling.hasActiveEntitlement(accountId);
  return res.json({ ok: true, loggedIn: true, active, productId: playBilling.productId });
});

app.get('/review-access/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!playBilling.isReviewerToken(req.params.token)) return res.status(404).send('Not found');
  res.cookie('subtextle_review', playBilling.reviewerCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return res.redirect(302, '/online?review=1');
});

// Sync jackpotSettings.enabled from gameManager's persisted state
jackpotSettings.enabled = gameManager.isJackpotEnabled();

// Initialize sync server (primary mode only — has SYNC_SECRET but no SYNC_PRIMARY_URL)
if (SYNC_SECRET && !IS_FOLLOWER) {
  syncServer.init(io, gameManager);
}

// Initialize single player namespace
spManager.ensureDir();
spNamespace.init(io, {
  chatRelayUrl: CHAT_RELAY_URL,
  cosmeticsCache,
  onWeeklyChange: (word) => {
    // Prevent MP from randomly picking the current SP weekly word
    const excluded = word ? [word] : [];
    gameManager.setExcludedWords(excluded);
  },
});

// Library word reporting uses gameShared (same as all other games)

// ---------------------------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------------------------
app.get('/api/debug/sockets', (req, res) => {
  const sockets = [];
  io.of('/').sockets.forEach((socket) => {
    sockets.push({
      id: socket.id,
      ip: gameShared.getClientIP(socket) || 'unknown',
      userAgent: socket.handshake.headers['user-agent'],
    });
  });
  res.json({ count: sockets.length, sockets });
});

// POST /api/rank — companion-game rank scoring (consumed by WikiSearchle).
// Authenticates via x-api-key, ranks each guess word against `target` using
// Searchle's embedding model, returns ranks + canonical (singular/American)
// forms so companion games can promote morphological variants to title hits.
app.post('/api/rank', express.json(), async (req, res) => {
  const handlerT0 = Date.now();
  if (!canCompanionRank(req)) {
    apiRankStats.unauthorized++;
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const target = String(req.body?.target || '').trim().toLowerCase();
  const wordsIn = Array.isArray(req.body?.words) ? req.body.words : [];
  if (!target || !rankingEngine.isValidTarget(target)) {
    apiRankStats.badInput++;
    return res.status(400).json({ ok: false, error: 'Invalid or unknown target' });
  }
  apiRankStats.requests++;
  recordTargetHit(target);
  try {
    const computeT0 = Date.now();
    const rankings = await getCompanionRankings(target);
    const computeMs = Date.now() - computeT0;
    const totalRankedWords = rankings.size;
    const ranks = {};
    const canonicals = {};
    for (const w of wordsIn) {
      const key = String(w || '').trim().toLowerCase();
      if (!key) continue;
      let rank = rankings.get(key);
      let canonical = key;
      if (typeof rank !== 'number') {
        const am = toAmerican(key);
        if (am !== key) {
          const r2 = rankings.get(am);
          if (typeof r2 === 'number') { rank = r2; canonical = am; }
        }
        if (typeof rank !== 'number') {
          const base = am !== key ? am : key;
          const sg = toSingular(base);
          if (sg !== key && sg !== am) {
            const r3 = rankings.get(sg);
            if (typeof r3 === 'number') { rank = r3; canonical = sg; }
          }
        }
      }
      if (typeof rank === 'number') {
        ranks[key] = rank;
        canonicals[key] = canonical;
      }
    }
    apiRankStats.totalWordsScored += wordsIn.length;
    apiRankStats.totalRanksReturned += Object.keys(ranks).length;
    recordLatency(computeMs, Date.now() - handlerT0);
    res.json({ ok: true, target, totalRankedWords, ranks, canonicals });
  } catch (e) {
    apiRankStats.errors++;
    res.status(500).json({ ok: false, error: `Ranking failed: ${e.message}` });
  }
});

// POST /api/rank/top — "give me the N closest words to this target". Used
// by WikiRecTangled/Searchle's semantic-trie builder to seed the per-round
// topic word pool from the article's title words. Without this, the
// semantic builder falls back to the base trie, which defeats the topic
// restriction and inflates tier counts (commons/rares/ultras balloon).
app.post('/api/rank/top', express.json(), async (req, res) => {
  const handlerT0 = Date.now();
  if (!canCompanionRank(req)) {
    apiRankStats.unauthorized++;
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const target = String(req.body?.target || '').trim().toLowerCase();
  const n = Math.max(1, Math.min(5000, Number(req.body?.n) || 500));
  if (!target || !rankingEngine.isValidTarget(target)) {
    apiRankStats.badInput++;
    return res.status(400).json({ ok: false, error: 'Invalid or unknown target' });
  }
  apiRankStats.requests++;
  recordTargetHit(target);
  try {
    const computeT0 = Date.now();
    const rankings = await getCompanionRankings(target);
    const computeMs = Date.now() - computeT0;
    const totalRankedWords = rankings.size;
    // rankings is a Map<word, rank> with rank=1 being closest. Sort by
    // rank ascending and take the top N words. ~200k-entry sort is fast
    // enough (~30-80ms) for the per-round one-shot builder call.
    // Consumer (wikirectangled/searchle-client.js → semantic-trie.js)
    // expects {word, rank} objects, not plain strings. Drop the word
    // shape and rank gets dropped from r.word lookup.
    const topRanked = [...rankings.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, n)
      .map(([word, rank]) => ({ word, rank }));
    apiRankStats.totalRanksReturned += topRanked.length;
    recordLatency(computeMs, Date.now() - handlerT0);
    res.json({ ok: true, target, n: topRanked.length, totalRankedWords, topRanked });
  } catch (e) {
    apiRankStats.errors++;
    res.status(500).json({ ok: false, error: `Rank/top failed: ${e.message}` });
  }
});

// POST /api/similarity — batch pairwise cosine similarity (consumed by
// Chat Relay's Synapse game). Unlike /api/rank this never ranks against the
// whole vocab: each pair is one dot product per model, so even the max
// batch is sub-millisecond. Words are canonicalized the same way /api/rank
// falls back (American spelling, then singular) so "colours" still scores.
// Body: { pairs: [["window","glass"], ...] }  (max 2500 pairs)
// Reply: { ok, results: [{ a, b, canonicalA, canonicalB, score, perModel }
//          — score is null and unknown lists the words no model knows] }
app.post('/api/similarity', requireInternalApiKey, express.json({ limit: '256kb' }), (req, res) => {
  const pairsIn = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
  if (pairsIn.length === 0 || pairsIn.length > 2500) {
    return res.status(400).json({ ok: false, error: 'pairs must be a non-empty array of at most 2500 [a,b] pairs' });
  }
  try {
    // Resolve each unique word once: raw form, else American spelling,
    // else singular — first form with a vector in any active model wins.
    const canonicalCache = new Map();
    const resolveWord = (raw) => {
      const key = String(raw || '').trim().toLowerCase();
      if (!key) return null;
      if (canonicalCache.has(key)) return canonicalCache.get(key);
      let canonical = null;
      if (rankingEngine.hasVector(key)) {
        canonical = key;
      } else {
        const am = toAmerican(key);
        if (am !== key && rankingEngine.hasVector(am)) {
          canonical = am;
        } else {
          const sg = toSingular(am !== key ? am : key);
          if (sg !== key && rankingEngine.hasVector(sg)) canonical = sg;
        }
      }
      canonicalCache.set(key, canonical);
      return canonical;
    };

    const results = pairsIn.map((pair) => {
      const a = String((Array.isArray(pair) ? pair[0] : '') || '').trim().toLowerCase();
      const b = String((Array.isArray(pair) ? pair[1] : '') || '').trim().toLowerCase();
      const canonicalA = resolveWord(a);
      const canonicalB = resolveWord(b);
      if (!canonicalA || !canonicalB) {
        const unknown = [];
        if (!canonicalA) unknown.push(a);
        if (!canonicalB) unknown.push(b);
        return { a, b, score: null, unknown };
      }
      const sim = rankingEngine.pairwiseSimilarity(canonicalA, canonicalB);
      if (!sim) return { a, b, score: null, unknown: [] };
      return { a, b, canonicalA, canonicalB, score: sim.score, perModel: sim.perModel };
    });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Similarity failed: ${e.message}` });
  }
});

// Operational stats for the companion rank API. Lightweight in-memory:
// counters since process start + last 500 latency samples (sorted on read
// for percentiles) + top 25 most-requested targets. Used to monitor cache
// hit rate, rank-compute p95, and whether a particular game is hammering
// a small set of targets vs. spraying.
app.get('/api/rank/stats', (_req, res) => {
  res.json(getApiRankStats());
});

app.get('/api/health', (_req, res) => {
  if (!runtimeReady) return res.status(503).json({ ok: false, service: 'searchle-mobile', recovering: true });
  const gameState = getFullGameState();
  const modelRuntime = typeof rankingEngine.getRuntimeInfo === 'function'
    ? rankingEngine.getRuntimeInfo()
    : null;
  const cosmeticsStats = typeof cosmeticsCache.getStats === 'function'
    ? cosmeticsCache.getStats()
    : null;
  const mem = process.memoryUsage();

  res.json({
    ok: true,
    service: 'searchle-mobile',
    role: IS_FOLLOWER ? 'follower' : 'primary',
    uptimeSec: Math.round(process.uptime()),
    connectedPlayers,
    sync: {
      follower: IS_FOLLOWER,
      hasSyncSecret: !!SYNC_SECRET,
      hasPrimaryUrl: !!SYNC_PRIMARY_URL
    },
    memoryMB: {
      rss: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heapUsed: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotal: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      external: Number((mem.external / (1024 * 1024)).toFixed(2)),
      arrayBuffers: Number((mem.arrayBuffers / (1024 * 1024)).toFixed(2))
    },
    game: {
      hasTargetWord: !!gameState.targetWord,
      targetWordLength: gameManager.getGame()?.targetWord?.length || null,
      guessCount: Array.isArray(gameState.guesses) ? gameState.guesses.length : 0,
      totalRankedWords: gameState.totalRankedWords || 0,
      isWon: !!gameState.isWon,
      startTime: gameState.startTime || null,
      frenzyMultiplier: gameState.frenzy?.multiplier || 1,
      jackpotEnabled: !!gameState.jackpotEnabled,
      totalMPGames: gameState.totalMPGames || 0,
      avgGuesses: gameState.avgGuesses || 0,
      recentGameCount: Array.isArray(gameState.recentGames) ? gameState.recentGames.length : 0
    },
    models: modelRuntime,
    cosmeticsCache: cosmeticsStats
  });
});

app.post('/api/game/new', async (_req, res) => {
  try {
  const apiSecret = process.env.GAME_API_SECRET;
  if (_req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  if (IS_FOLLOWER) {
    return res.status(400).json({ error: 'Cannot force new game on follower instance' });
  }
  await startNextGame(config, io);
  const game = gameManager.getGame();
  syncServer.broadcastNewGame(game.targetWord, game.startTime);
  res.json({ ok: true, startTime: game.startTime });
  } catch { res.status(503).json({ ok: false, error: 'replacement_unavailable' }); }
});

app.post('/api/game/force-word', async (req, res) => {
  try {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] !== apiSecret) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  if (IS_FOLLOWER) return res.status(400).json({ error: 'Cannot force word on follower instance' });
  const { word, saveCurrent } = req.body;
  if (!word || typeof word !== 'string') return res.status(400).json({ ok: false, message: 'word required' });
  if (saveCurrent) gameManager.savePendingGame();
  const success = await gameManager.startGameWithWord(word.trim().toLowerCase(), config, io);
  if (!success) return res.status(422).json({ ok: false, message: 'Word rejected (already won or not in vocabulary)' });
  const g = gameManager.getGame();
  syncServer.broadcastNewGame(g.targetWord, g.startTime);
  io.to('public').emit('game-state', getFullGameState());
  res.json({ ok: true, word: g.targetWord, savedPrevious: !!saveCurrent });
  } catch { res.status(503).json({ ok: false, error: 'replacement_unavailable' }); }
});

app.get('/api/game/jackpot', (_req, res) => {
  res.json({ ok: true, jackpotEnabled: gameManager.isJackpotEnabled() });
});

app.post('/api/game/jackpot', (req, res) => {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] !== apiSecret) return res.status(401).json({ error: 'Unauthorized' });
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
  gameManager.setJackpotEnabled(enabled);
  console.log(`[Admin] Jackpot ${enabled ? 'enabled' : 'disabled'}`);
  io.to('public').emit('game-state', getFullGameState());
  res.json({ ok: true, jackpotEnabled: enabled });
});

app.post('/api/game/reset-jackpot', (req, res) => {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] !== apiSecret) return res.status(401).json({ error: 'Unauthorized' });
  const game = gameManager.getGame();
  if (game.isWon) return res.status(409).json({ ok: false, error: 'round_complete' });
  searchRecovery.run(game, () => { game.startTime = new Date().toISOString(); });
  gameManager.saveGame();
  console.log('[Admin] Jackpot reset');
  io.to('public').emit('game-state', getFullGameState());
  res.json({ ok: true, startTime: game.startTime });
});

// ---------------------------------------------------------------------------
// Standardized Jackpot API (cross-game compatible)
// ---------------------------------------------------------------------------
app.get('/api/jackpot/settings', (_req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    dailyEnabled: jackpotSettings.dailyEnabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: calculateSearchleJackpot(),
  });
});

app.post('/api/jackpot/settings', (req, res) => {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  const b = req.body || {};
  searchRecovery.run(gameManager.getGame(), () => {
  if (typeof b.enabled === 'boolean') {
    jackpotSettings.enabled = b.enabled;
    // Also update game manager's jackpot toggle
    if (gameManager && gameManager.setJackpotEnabled) {
      gameManager.setJackpotEnabled(b.enabled);
    }
  }
  if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
  if (typeof b.base === 'number') jackpotSettings.base = Math.min(Math.max(b.base, 0), 50000);
  if (typeof b.perGuess === 'number') jackpotSettings.perGuess = Math.min(Math.max(b.perGuess, 0), 500);
  if (typeof b.perSecond === 'number') jackpotSettings.perSecond = Math.min(Math.max(b.perSecond, 0), 100);
  if (typeof b.max === 'number' && b.max >= 100) jackpotSettings.max = Math.min(b.max, 10000000);
  });
  console.log('[Searchle] Jackpot settings updated:', jackpotSettings);
  res.json({ ok: true, ...jackpotSettings, current: calculateSearchleJackpot() });
});

app.post('/api/jackpot/reset', (req, res) => {
  const apiSecret = process.env.GAME_API_SECRET;
  if (req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  // Reset game start time if accessible
  const game = gameManager.getGame ? gameManager.getGame() : null;
  if (game?.isWon) return res.status(409).json({ ok: false, error: 'round_complete' });
  if (game) searchRecovery.run(game, () => { game.startTime = new Date().toISOString(); });
  console.log('[Searchle] Jackpot timer reset');
  res.json({ ok: true, current: calculateSearchleJackpot() });
});

app.get('/play', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'play.html'));
});
app.get('/mp.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'play.html'));
});
// /stream — streaming overlay variant that shows the promo row.
// Accepts /stream, /stream/, and /stream/index.html so OBS browser sources
// can use whichever URL shape they prefer. The explicit /stream/index.html
// form matches the legacy /index.html?obs convention for streamers who
// want a drop-in replacement URL.
function sendStreamPage(req, res) {
  // alt-mode chip-grid page (dist/alt.html) instead of the default index
  // gets served when either:
  //   - ?mode=grid query param is set (gameEmbed widget → Mode dropdown → Grid)
  //   - hostname starts with 'grid.' (grid.subtextle.com convenience URL)
  //   - ?variant=numbers or ?game=numbers is set (Number Search streamer view)
  // Asset paths in alt.html are already absolute (Vite base:'/'), so the
  // rewrite block below is a no-op for alt — kept inline so the function
  // shape stays identical between both branches.
  const wantsGrid = !!(req && (
    (req.query && req.query.mode === 'grid')
    || (req.hostname && req.hostname.startsWith('grid.'))
  ));
  const wantsNumbers = !!(req && req.query && (
    req.query.variant === 'numbers'
    || req.query.variant === 'number'
    || req.query.game === 'numbers'
    || req.query.game === 'number'
  ));
  const fileName = (wantsGrid || wantsNumbers) ? 'alt.html' : 'index.html';
  const mpPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'client', fileName)
    : path.join(__dirname, '..', 'dist', fileName);
  // Read and rewrite relative asset paths to absolute so they resolve
  // correctly when the page is served at /stream/* instead of /.
  const fs = require('fs');
  let html = fs.readFileSync(mpPath, 'utf8');
  html = html.replace(/src="\.\/assets\//g, 'src="/assets/')
             .replace(/href="\.\/assets\//g, 'href="/assets/')
             .replace(/src="\.\/socket\.io\//g, 'src="/socket.io/');
  // The entry HTML must always be revalidated. Every asset here is
  // cache-busted with a ?bN query string that lives INSIDE this file, so a
  // cached copy of it pins the client to old CSS/JS forever — OBS browser
  // sources in particular held a stale alt.html across several deploys.
  // no-cache means revalidate, not do-not-store: the ETag above still makes
  // the common case a cheap 304.
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
}
app.get('/stream', sendStreamPage);
app.get('/stream/', sendStreamPage);
app.get('/stream/index.html', sendStreamPage);
// Note: the `/` + ?mode=grid interceptor lives earlier in this file,
// just before app.use(express.static(...)), because static middleware
// would otherwise grab the root request first.

function sendNumberSearchPage(_req, res) {
  const pagePath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'client', 'alt.html')
    : path.join(__dirname, '..', 'dist', 'alt.html');
  res.sendFile(pagePath);
}
app.get('/numbers', sendNumberSearchPage);
app.get('/numbers/', sendNumberSearchPage);
app.get(/^\/numbers\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/').pop().toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/numbers');
  const qIdx = req.url.indexOf('?');
  const extraQs = qIdx >= 0 ? '&' + req.url.slice(qIdx + 1) : '';
  res.redirect(302, `/stream?session=${encodeURIComponent(handle)}&variant=numbers${extraQs}`);
});
app.get(/^\/numbers\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/').pop().toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/numbers');
  const _disabled = _isPagePlayDisabled(handle) ? '&disabled=1' : '';
  const qIdx = req.url.indexOf('?');
  const extraQs = qIdx >= 0 ? '&' + req.url.slice(qIdx + 1) : '';
  res.redirect(302, `/numbers?session=${encodeURIComponent(handle)}${_disabled}${extraQs}`);
});

// ─── Streamer-private session URLs ─────────────────────────────────────────
// /<handle>           → /?session=<handle>           (player view)
// /overlay/<handle>   → /stream?session=<handle>     (OBS browser source)
// Single-segment regex; reserved names fall through to the matching route
// or static handler. Frontend reads ?session= and passes auth.session on
// the socket so the server joins this socket to the streamer's room.
const SESSION_RESERVED_HANDLES = new Set([
  'api', 'admin', 'admin.html', 'beta', 'sp', 'sp.html', 'solo', 'online', 'play',
  'home', 'home.html',
  'mp.html', 'stream', 'overlay', 'v', 'assets', 'img', 'data', 'sp-pool',
  'numbers',
  'index.html', 'manifest.webmanifest', 'sw.js', 'robots.txt', 'sitemap.xml',
  'favicon.ico', 'favicon-32.png', 'favicon-32-v3.png', 'app-icon.png',
  'apple-touch-icon.png', 'apple-touch-icon-v3.png', 'icon-192.png',
  'icon-192-v3.png', 'icon-512.png', 'icon-512-v3.png', 'icon-1024.png',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/').pop().toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  // Preserve query string on the redirect — the parent overlay passes
  // obs=1, bgPrimary, bgSecondary, etc. and dropping them here means the
  // /stream page renders as a generic public game (no obs-mode, no
  // color-matched body bg, no glass on ranked cards).
  const qIdx = req.url.indexOf('?');
  const extraQs = qIdx >= 0 ? '&' + req.url.slice(qIdx + 1) : '';
  res.redirect(302, `/stream?session=${encodeURIComponent(handle)}${extraQs}`);
});
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  const _disabled = _isPagePlayDisabled(handle) ? '&disabled=1' : '';
  // Preserve the full query string through the redirect — the OBS overlay
  // passes obs=1, rows=N (grid row cap), mode=grid, bg color params, etc.
  // and dropping them here means the root route renders as a generic
  // public game without obs-mode, grid mode, or row cap.
  const qIdx = req.url.indexOf('?');
  const extraQs = qIdx >= 0 ? '&' + req.url.slice(qIdx + 1) : '';
  res.redirect(302, `/?session=${encodeURIComponent(handle)}${_disabled}${extraQs}`);
});

function sendSinglePlayerPage(_req, res) {
  const spPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', 'client', 'sp.html')
    : path.join(__dirname, '..', 'dist', 'sp.html');
  res.sendFile(spPath);
}

// Subtextle home page (subtextle.com root — nginx maps `/` here for that
// host). Static menu: daily + weekly cards, solo/online, sign-in, Donor,
// and the Donor-gated archive.
app.get('/home', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'home.html'));
});

// Single Player mode
app.get('/sp', sendSinglePlayerPage);
app.get('/sp.html', sendSinglePlayerPage);
app.get('/solo', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/sp' + query);
});
app.get('/solo/', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/sp' + query);
});
app.get('/online', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/' + query);
});
app.get('/online/', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/' + query);
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'admin.html'));
});

// Variant overlay routes
app.get('/v/toast', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'v', 'toast.html'));
});

app.get('/api/game/state', (req, res) => {
  // Optional ?session=<handle> returns the per-streamer private session
  // state instead of the public game (used by polling overlays / players
  // landing on /<handle>).
  const sessionHandle = typeof req.query.session === 'string' ? req.query.session.toLowerCase().trim() : '';
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    const sess = sessionManager.getSession(sessionHandle);
    const state = sessionManager.buildSessionState(sess);
    if (!state) return res.json({ error: 'No active session' });
    return res.json(state);
  }
  // Use getGameState() so REST response matches Socket.IO game-state event
  // (includes lastWinner, recentGames, jackpotEnabled)
  const state = gameManager.getGameState();
  // Strip full guesses array for REST — just send count (dashboard only needs count)
  res.json({
    guesses: state.guesses,
    totalRankedWords: state.totalRankedWords,
    startTime: state.startTime,
    isWon: state.isWon,
    winner: state.winner,
    targetWord: state.targetWord,
    guessCount: state.guesses ? state.guesses.length : 0,
    lastWinner: state.lastWinner,
    recentGames: state.recentGames,
    totalMPGames: state.totalMPGames,
    avgGuesses: state.avgGuesses,
    jackpotEnabled: state.jackpotEnabled,
    jackpot: calculateSearchleJackpot(),
    isDaily,
    frenzy: currentFrenzy,
    playerCount: connectedPlayers,
    winCounts: state.winCounts,
    searchleLeaderboard: state.searchleLeaderboard
  });
});

app.get('/api/game/reveal', (_req, res) => {
  const apiSecret = process.env.GAME_API_SECRET;
  if (_req.headers['x-api-key'] !== apiSecret) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  res.json({ targetWord: gameManager.getGame().targetWord });
});

// ---------------------------------------------------------------------------
// Fleet-wide monthly hint system
// ---------------------------------------------------------------------------
function _getGuessedWords(state) {
  const guesses = state?.guesses || [];
  const words = new Set();
  for (const g of guesses) {
    const w = String(g?.word || '').toLowerCase();
    if (w) words.add(w);
  }
  return words;
}

const HINT_AVATAR_URL = 'https://wordtycoon.live/portal/img/logo.png';
const TOP_WORD_HINT_RANK = 10;

function _getSearchleHintState(handle) {
  const sessionHandle = String(handle || '').toLowerCase().trim();
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    const session = sessionManager.getSession(sessionHandle);
    if (!session || session.isWon || !session.targetWord || !session.rankings) return null;
    return { isSession: true, session, target: session.targetWord, rankings: session.rankings, guessed: session.guessedWords };
  }
  const game = gameManager.getGame();
  if (!game || game.isWon || !game.targetWord || !game.rankings) return null;
  return { isSession: false, game, target: game.targetWord, rankings: game.rankings, guessed: game.guessedWords };
}

// Peek at what a hint would reveal without mutating state.
function _generateSearchleHint(handle) {
  const state = _getSearchleHintState(handle);
  if (!state) return null;
  const { target, rankings, guessed } = state;

  // Prefer the weakest top-10 word first (matches revealSessionHint).
  let bestWord = null;
  let bestRank = -Infinity;
  for (const [word, rank] of rankings) {
    if (typeof rank !== 'number' || rank <= 1 || rank > TOP_WORD_HINT_RANK) continue;
    if (rank <= bestRank) continue;
    if (guessed && guessed.has(word)) continue;
    bestWord = word;
    bestRank = rank;
    if (rank === TOP_WORD_HINT_RANK) break;
  }
  if (bestWord) return { type: 'word', word: bestWord, rank: bestRank };

  // Fallback: one target letter (weakest-first position).
  const upper = target.toUpperCase();
  const already = Number((state.isSession ? state.session.hintLettersRevealed : state.game.hintLettersRevealed) || 0);
  const maxReveal = Math.max(0, upper.length - 1);
  if (already >= maxReveal) return null;
  const position = already;
  return {
    type: 'letter',
    letter: upper[position],
    position,
    wordLength: upper.length,
  };
}

// Actually reveal the hint and broadcast it like a stream /hint does.
function _revealSearchleHint(handle) {
  const state = _getSearchleHintState(handle);
  if (!state) return null;

  if (state.isSession) {
    const result = revealSessionHint({ streamerHandle: handle, label: 'Searchle web hint' });
    if (!result || !result.ok) return null;
    if (result.mode === 'word') return { mode: 'word', word: result.word, rank: result.rank };
    return { mode: 'letters', masked: result.masked };
  }

  // Public game reveal.
  const { game } = state;
  let bestWord = null;
  let bestRank = -Infinity;
  for (const [word, rank] of game.rankings) {
    if (typeof rank !== 'number' || rank <= 1 || rank > TOP_WORD_HINT_RANK) continue;
    if (rank <= bestRank) continue;
    if (game.guessedWords.has(word)) continue;
    bestWord = word;
    bestRank = rank;
    if (rank === TOP_WORD_HINT_RANK) break;
  }

  if (bestWord) {
    game.guessedWords.add(bestWord);
    const guess = {
      word: bestWord,
      rank: bestRank,
      user: {
        id: null,
        platformUserId: 'web-hint',
        displayName: '💡 Hint',
        username: null,
        profilePic: HINT_AVATAR_URL,
        platform: 'system',
        customColor: '#c084fc',
        cosmetics: {},
        linkedDiscord: null,
        isFanClub: false, isSuperfan: false, isDonor: false,
        isHint: true,
      },
      isHint: true,
      timestamp: new Date().toISOString(),
    };
    game.guesses.push(guess);
    gameManager.saveGame();
    io.to('public').emit('new-guess', {
      ...guess,
      totalRankedWords: game.totalRankedWords,
      xpAward: 0,
      xpTotal: 0,
    });
    return { mode: 'word', word: bestWord, rank: bestRank };
  }

  const target = String(game.targetWord || '');
  const maxReveal = Math.max(0, target.length - 1);
  const already = Number(game.hintLettersRevealed) || 0;
  if (already >= maxReveal) return null;
  const revealed = already + 1;
  game.hintLettersRevealed = revealed;
  gameManager.saveGame();
  const masked = [...target].map((ch, i) => (i < revealed ? ch.toUpperCase() : '_')).join(' ');
  return { mode: 'letters', masked, revealed, length: target.length };
}

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Searchle] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal a useful Searchle clue.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const peek = _generateSearchleHint(handle);
  if (!peek) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'searchle', label: 'Searchle web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);

    const hint = _revealSearchleHint(handle);
    if (!hint) {
      // Spend succeeded but state shifted; report success with no visible reveal.
      return res.json({ ok: true, ...spendData, hint: null });
    }
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[Searchle] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

app.post('/api/discord-bot/searchle/evaluate', requireInternalApiKey, async (req, res) => {
  try {
    const targetWord = String(req.body?.targetWord || '').trim().toLowerCase();
    const guessCheck = normalizeDiscordBotGuess(req.body?.guess || '');
    const normalizedGuess = guessCheck.normalizedGuess;

    if (!targetWord || !rankingEngine.isValidTarget(targetWord)) {
      return res.status(400).json({ ok: false, message: 'Invalid targetWord' });
    }

    if (!normalizedGuess) {
      return res.json({ ok: true, valid: false, reason: guessCheck.reason || 'invalid_format' });
    }

    const vocabSet = rankingEngine.getAllVocabSet();
    if (!vocabSet.has(normalizedGuess)) {
      return res.json({
        ok: true,
        valid: false,
        normalizedGuess,
        reason: 'not_in_vocabulary'
      });
    }

    const rankings = await getDiscordBotRankings(targetWord);
    const rank = guessProcessor.resolveRank(normalizedGuess, rankings);

    return res.json({
      ok: true,
      valid: true,
      normalizedGuess,
      rank,
      isWin: rank === config.winRank,
      targetWordLength: targetWord.length
    });
  } catch (error) {
    console.error('[Discord Bot] Searchle evaluate failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Evaluation failed' });
  }
});


app.get('/api/game/history', (_req, res) => {
  const state = gameManager.getGameState();
  res.json({
    recentGames: state.recentGames,
    totalMPGames: state.totalMPGames,
    avgGuesses: state.avgGuesses,
  });
});

// SP (single player) endpoints
app.get('/api/sp/history', (req, res) => {
  const history = spManager.loadWinHistory();
  // Support ?userId= filter to avoid sending all history to clients
  if (req.query.userId) {
    res.json(history.filter(w => w.userId === req.query.userId));
  } else {
    res.json(history);
  }
});

app.get('/api/sp/weekly', (_req, res) => {
  const info = spNamespace.getWeeklyInfo();
  if (!info.word) return res.status(404).json({ error: 'No weekly word available' });
  res.json({
    available: true,
    weekStart: info.weekStart,
    weeklyNumber: info.weeklyNumber,
    length: info.length,
  });
});

app.post('/api/sp/weekly/complete', (req, res) => {
    res.json({ ok: true });
});

// Daily puzzle — same word for everyone that day, free for everyone.
// Returns ids and metadata only; the answer word never leaves the server.
app.get('/api/sp/daily', (_req, res) => {
  const date = spManager.getDailyDateString();
  const dailyNumber = spManager.getDailyNumber(date);
  if (!dailyNumber) return res.status(404).json({ error: 'No daily available' });

  const weekly = spNamespace.getWeeklyInfo();
  const pick = spManager.getDailyPoolFile(date, weekly.word || null);
  if (!pick) return res.status(404).json({ error: 'No daily word available' });

  const meta = spManager.getGameMetaByWord(pick.word);
  if (!meta) return res.status(404).json({ error: 'No daily word available' });

  res.json({
    available: true,
    date,
    dailyNumber,
    gameId: meta.gameId,
    length: pick.word.length,
  });
});

// Archive of past dailies + weeklies for the Subtextle home page.
// Ids only — no answer words. Playing an archived game is Donor-gated by the
// solo premium wall (only ?mode=weekly and ?mode=daily are free), so this
// listing is safe to serve publicly.
app.get('/api/sp/archive', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 120);
  const weekly = spNamespace.getWeeklyInfo();
  const today = spManager.getDailyDateString();
  res.json({
    dailies: spManager.listDailyArchive(limit, today, weekly.word || null),
    weeklies: spManager.listWeeklyArchive(limit, weekly.word || null),
  });
});

// Model info endpoints
app.get('/api/models', (_req, res) => {
  res.json(rankingEngine.getModelsInfo(path.join(__dirname, '..', config.modelsDir)));
});

// Frequency-gate inspection. Returns whether gating is on, the Zipf
// threshold used, the keep-always set size, and per-model kept/total
// counts. Useful for tuning the cutoff and for verifying after a
// model swap that the gate rebuilt correctly.
app.get('/api/gate/stats', (_req, res) => {
  res.json(rankingEngine.getGateInfo());
});

app.post('/api/models/active', async (req, res) => {
  if (config.allowRuntimeModelSwitch === false) {
    const modelsInfo = rankingEngine.getModelsInfo(path.join(__dirname, '..', config.modelsDir));
    return res.status(403).json({
      error: 'Runtime model switching is disabled. Update server/config.js and restart Searchle to change embedding models.',
      ...modelsInfo,
    });
  }

  const { activeModels: requestedModels } = req.body;
  if (!Array.isArray(requestedModels) || requestedModels.length === 0) {
    return res.status(400).json({ error: 'Must provide at least one model name' });
  }

  const oldNames = rankingEngine.getActiveModelNames().sort().join(',');

  if (!rankingEngine.setActiveModels(requestedModels)) {
    return res.status(400).json({ error: 'None of the requested models are loaded' });
  }

  const newNames = rankingEngine.getActiveModelNames().sort().join(',');
  if (oldNames === newNames) {
    const modelsInfo = rankingEngine.getModelsInfo(path.join(__dirname, '..', config.modelsDir));
    return res.json({ ok: true, message: 'No change', ...modelsInfo });
  }

  console.log(`[Models] Switching active models: ${oldNames} → ${newNames}`);

  // Recompute rankings for current game
  await gameManager.reRankGuesses(config);
  io.to('public').emit('game-state', getFullGameState());

  const modelsInfo = rankingEngine.getModelsInfo(path.join(__dirname, '..', config.modelsDir));
  io.to('public').emit('models-updated', modelsInfo);

  console.log(`[Models] Now active: ${rankingEngine.getActiveModelNames().join(', ')}`);
  res.json({ ok: true, ...modelsInfo });
});

// ---------------------------------------------------------------------------
// Multi-word guess — no batch cap, staggers 1s apart so chat-stuffing a
// long block still dribbles into the game one word per second instead of
// flooding the socket all at once.
// ---------------------------------------------------------------------------
// ── Anti-spam guards for the multi-word fan-out ──
// Per-identity sliding-window rate limiter. Identity mirrors the canonical
// key used by scoring (linkedDiscord preferred, else platform:userId) so a
// spammer can't reset their window by hopping platforms after linking.
// Declared above processMultiWordGuess per the module-TDZ rule.
const _guessRateByIdentity = new Map(); // identity -> [dispatch timestamps]

function _guessIdentityOf(msg) {
  const u = msg.user || {};
  if (msg.linkedDiscord) return 'discord:' + msg.linkedDiscord;
  const pid = u.id || u.userId || u.uniqueId || u.username || null;
  return ((msg.platform || u.platform || '?') + ':' + (pid || 'unknown'));
}

// Returns true (and records the dispatch) if this identity is under the
// rate limit; false drops the guess silently.
function _allowGuessDispatch(identity) {
  const limit = config.guessRateLimit || { max: 40, windowMs: 30000 };
  const now = Date.now();
  let stamps = _guessRateByIdentity.get(identity);
  if (!stamps) { stamps = []; _guessRateByIdentity.set(identity, stamps); }
  while (stamps.length && now - stamps[0] > limit.windowMs) stamps.shift();
  if (stamps.length >= limit.max) return false;
  stamps.push(now);
  return true;
}

// Sweep idle identities so the limiter map doesn't grow with every viewer
// who ever guessed.
setInterval(() => {
  const windowMs = (config.guessRateLimit && config.guessRateLimit.windowMs) || 30000;
  const now = Date.now();
  for (const [id, stamps] of _guessRateByIdentity) {
    while (stamps.length && now - stamps[0] > windowMs) stamps.shift();
    if (!stamps.length) _guessRateByIdentity.delete(id);
  }
}, 5 * 60 * 1000).unref();

function dispatchRound(message) {
  const numbers = message._sessionVariant === 'numbers' || message.variant === 'numbers';
  const manager = numbers ? numberGameManager : gameManager;
  const sessions = numbers ? numberSessionManager : sessionManager;
  const game = message.streamerHandle ? sessions.getSession(message.streamerHandle) : manager.getGame();
  const recovery = numbers ? numberRecovery : searchRecovery;
  return { game, roundId: game && recovery?.current(game)?.roundId };
}
async function processMultiWordGuess(msg, socket) {
  try {
    if (!runtimeReady) return { valid: false, result: 'unavailable', retryable: true };
    if (!msg || typeof msg.message !== 'string' || msg.message.length > 160 || !msg.user || typeof msg.user !== 'object' || Array.isArray(msg.user)) return { valid: false, result: 'bad_request' };
    const cap = Math.min(socket ? 4 : 20, Math.max(1, Number(config.maxWordsPerMessage) || 20));
    const words = msg.message.trim().split(/\s+/).filter(Boolean).slice(0, cap);
    const identity = msg.isSystem || msg.platform === 'system' ? null : _guessIdentityOf(msg);
    const variants = _searchleVariantsFromMessage(msg);
    const dispatches = (variants.length ? variants : ['searchle']).map(variant => {
      const message = { ...msg, ...(msg.streamerHandle ? { _sessionVariant: variant } : { variant }) };
      return { message, lease: dispatchRound(message), fn: msg.streamerHandle
        ? variant === 'numbers' ? handleNumberSessionGuess : handleSessionGuess
        : variant === 'numbers' ? handleNumberGuess : handleGuess };
    });
    let result = { valid: false, result: 'bad_request' }, anyAccepted = false;
    for (let index = 0; index < words.length; index++) {
      if (index) await new Promise(resolve => setTimeout(resolve, 1000));
      if (socket && !socket.connected) break;
      if (identity && !_allowGuessDispatch(identity)) { result = { valid: false, result: 'rate_limited', retryable: true }; break; }
      for (const dispatch of dispatches) {
        const live = dispatchRound(dispatch.message);
        if (dispatch.lease.game && (live.game !== dispatch.lease.game || live.roundId !== dispatch.lease.roundId)) {
          result = { valid: false, result: 'round_changed', retryable: true }; continue;
        }
        result = await dispatch.fn({ ...dispatch.message, message: words[index] }, socket) || { valid: false, result: 'unavailable', retryable: true };
        anyAccepted ||= result.valid === true;
        if (!dispatch.lease.game) dispatch.lease = dispatchRound(dispatch.message);
      }
    }
    return anyAccepted ? { valid: true, result: 'accepted', lastResult: result.result } : result;
  } catch {
    console.warn('[Game] Guess dispatch unavailable');
    return { valid: false, result: 'unavailable', retryable: true };
  }
}
function numberGuessStatus(result) {
  return { valid: ['new', 'win', 'bump'].includes(result?.type), result: ['new', 'win'].includes(result?.type) ? 'accepted' : result?.type || 'unavailable' };
}
const { createWebGuessHandler } = require('./web-guess-handler');
function bindWebGuess(socket, { handle = null, variant = 'searchle', context = 'mp' } = {}) {
  const message = { ...(handle ? { streamerHandle: handle, _sessionVariant: variant } : { variant }) };
  socket.on('test-guess', createWebGuessHandler({
    socket, context, gate: passesPremiumWebGate,
    pageEnabled: () => !handle || !_isPagePlayDisabled(handle),
    current: () => runtimeReady ? dispatchRound(message).roundId : null,
    dispatch: data => processMultiWordGuess({ ...message, message: data.message, user: data.user, platform: 'web', linkedDiscord: data.linkedDiscord,
      streamerGameIds: [variant === 'numbers' ? 'searchle-numbers' : 'searchle'],
    }, socket),
  }));
}

function handleNumberSessionGuess(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  {
    const _u = msg.user || {};
    const _platform = String(msg.platform || _u.platform || '').toLowerCase();
    const _pid = String(_u.id || _u.userId || _u.uniqueId || '').trim();
    if (_platform && _pid && _isStreamerBlocking(handle, _platform, _pid)) return;
  }

  let session;
  try {
    session = numberSessionManager.getOrCreateSession({
      handle,
      sessionId: msg.streamSession || null,
    });
  } catch (err) {
    console.warn('[NumberSession] Guess creation unavailable');
    return {valid:false,result:'unavailable',retryable:true};
  }

  const room = _sessionRoom(handle, 'numbers');
  const result = numberSessionManager.processGuess(session, msg);
  if (!result || result.type === 'ignored' || result.type === 'invalid') return numberGuessStatus(result);

  if (result.type === 'bump') {
    io.to(room).emit('bump-guess', { word: result.word, bumper: result.bumper });
    return numberGuessStatus(result);
  }

  if (result.type === 'new') {
    io.to(room).emit('new-guess', {
      ...result.guess,
      totalRankedWords: numberSessionManager.buildSessionState(session).totalRankedWords,
      xpAward: result.award.pts,
      xpTotal: result.award.total,
    });
    if (result.award.pts > 0) {
      io.to(room).emit('podium-update', { podium: numberSessionManager.getPodium(session, 7) });
    }
    return numberGuessStatus(result);
  }

  io.to(room).emit('game-state', numberSessionManager.buildSessionState(session));
  io.to(room).emit('game-win', {
    game: 'searchle-numbers',
    gameName: 'Number Search',
    word: result.word,
    winner: session.lastWinner?.user || session.winner || result.guess.user,
    targetFinder: session.lastWinner?.targetFinder || result.guess.user,
    jackpot: result.meta.pot,
    guessCount: result.meta.guessCount,
    isDaily: false,
    topPlayers: result.topPlayers,
    streamerHandle: handle,
  });
  relayClient.emit('game-win', {
    game: 'searchle-numbers',
    gameName: 'Number Search',
    word: result.word,
    winner: session.lastWinner?.user || session.winner || result.guess.user,
    targetFinder: session.lastWinner?.targetFinder || result.guess.user,
    jackpot: result.meta.pot,
    guessCount: result.meta.guessCount,
    isDaily: false,
    topPlayers: result.topPlayers,
    streamerHandle: handle,
  });
  io.to(room).emit('game-won', {
    word: result.word,
    rank: 1,
    user: session.lastWinner?.user || session.winner || result.guess.user,
    targetFinder: session.lastWinner?.targetFinder || result.guess.user,
    targetWord: result.word,
    pot: result.meta.pot,
    guessCount: result.meta.guessCount,
    durationSeconds: result.meta.durationSeconds,
    isDaily: false,
    frenzy: null,
    podium: result.podium,
    topPlayers: result.topPlayers,
  });

  numberAdvancer.schedule(session);
  return numberGuessStatus(result);
}

// Session-scoped guess handler — mirrors handleGuess but operates on the
// per-streamer session game and emits all events to the session room only.
// Sessions don't participate in ELO, daily-win, frenzy, or sync — those are
// public-game concepts. Wins schedule a fresh round in the same session.
// ─── Private-session payout + Word Tycoon reporting ─────────────────────────
// Until 2026-07-21 session rounds were purely local: viewers earned session XP
// on the overlay but nothing reached Word Tycoon, so stream play never showed
// up on /goat. Sessions now mirror the public round-end in handleGuess —
// every scoring player is paid their round XP ('word'), the top scorer gets
// the 'win' event, and the round is reported for ELO / rounds-played.
//
// Deliberate differences from the public path: no frenzy multiplier, no
// daily-win event, no sync (all public-game concepts).
async function _finishSessionRound(session, targetFinder, word, meta) {
  const idKeyOf = (u) => {
    if (!u) return null;
    if (u.linkedDiscord) return 'discord:' + u.linkedDiscord;
    const puid = u.platformUserId || u.id;
    return (u.platform && puid) ? u.platform + ':' + puid : null;
  };
  try {
    // playerScores holds every scorer; 1000 is an effective "all of them".
    const scoring = sessionManager.getPodium(session, 1000).filter(p => (p.xp || 0) > 0);
    if (!scoring.length) return;

    const targetFinderKey = idKeyOf(targetFinder);
    const winnerKey = scoring[0].identityKey;   // getPodium is XP-sorted
    const guessCount = (session.guesses || []).length;
    const durationSeconds = (meta && meta.durationSeconds) || null;

    // ── ELO / rounds-played ──
    // Bots and guests play in sessions but must never earn a rating.
    const rated = scoring.filter(p => gameShared.isStatsEligible(p.platform, p.platformUserId));
    if (rated.length < 2) return;
    const participants = rated.map((p, i) => ({
      identityKey: p.identityKey,
      points: p.xp,
      rank: i + 1,
      rankOutOf: rated.length,
      guesses: (session.guesses || []).filter(g => idKeyOf(g.user) === p.identityKey).length,
      hits: p.identityKey === targetFinderKey ? 1 : 0,
      firstHitMs: null,
      wonRound: p.identityKey === winnerKey,
      foundTarget: p.identityKey === targetFinderKey,
      articleTitle: word || '?',
      displayName: p.displayName || null,
    }));

    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'searchle', participants }),
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.log(`[Session] ELO report failed: ${res.status}`);
  } catch (err) {
    console.log(`[Session] round report failed: ${err.message}`);
  }
}

async function handleSessionGuess(msg, socket) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  // Per-streamer blocklist: silently drop guesses from blocked viewers.
  {
    const _u = msg.user || {};
    const _platform = String(msg.platform || _u.platform || '').toLowerCase();
    const _pid = String(_u.id || _u.userId || _u.uniqueId || '');
    if (_platform && _pid && _isStreamerBlocking(handle, _platform, _pid)) return;
  }
  const before = dispatchRound({ ...msg, _sessionVariant: 'searchle' });
  let session;
  try {
    const prefs = await _getStreamerSearchlePrefs(handle);
    const live = dispatchRound({ ...msg, _sessionVariant: 'searchle' });
    if (before.game && (live.game !== before.game || live.roundId !== before.roundId)) return {valid:false,result:'round_changed',retryable:true};
    session = await sessionManager.getOrCreateSession({
      handle,
      sessionId: msg.streamSession || null,
      config,
      targetWords: gameManager.getTargetWordPool(),
      wordFrequency: prefs.wordFrequency,
      language: prefs.language,
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" guess-create failed:`, err.message);
    return;
  }
  if (!session || !session.targetWord) return;
  session.lastActivityAt = Date.now();
  const room = _sessionRoom(handle);

  const callbacks = {
    onBump: (word, bumper) => {
      io.to(room).emit('bump-guess', { word, bumper });
      sessionManager.scheduleSave();
    },
    onNewGuess: (guess, award) => {
      // Session-scoped scoring (mirrors public path's awardForGuess +
      // broadcastPodium). Top-10 first finder gets the big tier; other
      // ranks earn proximity baseline + climb bonus when they improve
      // the session's best non-top-10 rank.

      io.to(room).emit('new-guess', {
        ...guess,
        totalRankedWords: session.totalRankedWords,
        xpAward: award.pts,
        xpTotal: award.total,
      });
      if (award.pts > 0) {
        io.to(room).emit('podium-update', { podium: sessionManager.getPodium(session, 7) });
      }
      // Persist round progress (debounced 2s) so deploys/restarts don't
      // wipe an in-progress round. Covers the guess push + score change.
      sessionManager.scheduleSave();
    },
    onWin: async (guess, word, completion) => {
      const meta = { guessCount: completion.guessCount, durationSeconds: completion.durationSeconds, pot: completion.displayPot };
      roundAdvancer.schedule(session);
      io.to(room).emit('game-state', sessionManager.buildSessionState(session));
      io.to(room).emit('win', {
        winner: completion.winner,
        word,
        guessCount: meta.guessCount,
        durationSeconds: meta.durationSeconds,
        pot: meta.pot,
        isSession: true,
        sessionHandle: handle,
      });
      // Forward win to chat-relay so the per-streamer win-overlay
      // (streamer-win:<handle> room) fires its hologram card.
      try {
        const sessTop10 = sessionManager.getPodium(session, 10).map((p) => ({
          displayName: p.displayName,
          profilePic: p.profilePic || null,
          platform: p.platform,
          platformUserId: p.platformUserId,
          linkedDiscord: p.linkedDiscord || null,
          points: p.xp || 0,
          cosmetics: p.cosmetics || null,
        }));
        // Winner = top of podium by XP (not the target-word finder).
        // Session scoring (proximity + climb bonuses) means a high-XP
        // grinder can outscore the player who finally hits rank 1, and
        // the streamer wants their overlay's headline winner to credit
        // that grinder. Target finder still goes through `targetFinder`
        // so the goals overlay can subtitle "Title found by @X — WORD".
        // Falls back to guess.user if the podium is empty (rare — by
        // the time onWin fires, the finder is on the podium at minimum).
        const _topPodium = sessionManager.getPodium(session, 1);
        const _xpWinnerEntry = _topPodium[0] || null;
        const xpWinnerForOverlay = _xpWinnerEntry ? {
          displayName: _xpWinnerEntry.displayName,
          profilePic: _xpWinnerEntry.profilePic || null,
          platform: _xpWinnerEntry.platform,
          platformUserId: _xpWinnerEntry.platformUserId,
          linkedDiscord: _xpWinnerEntry.linkedDiscord || null,
          cosmetics: _xpWinnerEntry.cosmetics || null,
          points: _xpWinnerEntry.xp || 0,
        } : guess.user;
        const _winPayload = {
          game: 'searchle', gameName: 'Subtextle',
          word,
          winner: xpWinnerForOverlay,
          targetFinder: guess.user,
          jackpot: meta.pot,
          guessCount: meta.guessCount,
          isDaily: false,
          topPlayers: sessTop10,
          streamerHandle: handle,
        };
        io.to(room).emit('game-win', _winPayload);
        relayClient.emit('game-win', _winPayload);

        // In-game winOverlay (main.js line 597) listens for `game-won` with
        // the public-game payload shape — different from the `game-win` we
        // forward to chat-relay's OBS hologram overlay. Without this emit,
        // session viewers see no winner card / target-word reveal.
        io.to(room).emit('game-won', {
          word,
          rank: config.winRank,
          user: session.lastWinner.user,             // XP winner
          targetFinder: guess.user,                  // actual target-word guesser
          targetWord: word,
          pot: meta.pot,
          guessCount: meta.guessCount,
          durationSeconds: meta.durationSeconds,
          isDaily: false,
          frenzy: null,
          podium: session.lastWinner.podium,
          topPlayers: sessTop10,
        });
      } catch (_) {}
      // Pay out + report the round to Word Tycoon (XP, wins, ELO -> /goat).
      await _finishSessionRound(session, guess.user, word, meta);

    },
  };
  return guessProcessor.processGuess(msg, session, config, cosmeticsCache, {
    isCurrent: () => sessionManager.getSession(handle) === session,
    acceptBump: (existing, word, bumper) => {
      searchRecovery.run(session, () => { existing.lastBumper = bumper; });
      callbacks.onBump(word, bumper);
      return { valid: true, result: 'bump', word };
    },
    acceptGuess: (guess, word) => acceptSearchGuess({ recovery: searchRecovery, game: session, session, guess, word, config, gameManager, sessionManager, frenzy: 1,
      afterAccepted: accepted => {
        callbacks.onNewGuess(guess, accepted.award);
        if (accepted.completion) return callbacks.onWin(guess, word, accepted.completion);
      },
    }),
    onBump: callbacks.onBump, onNewGuess: callbacks.onNewGuess, onWin: callbacks.onWin,
  });
}

// Like-for-Hint: chat-relay broadcasts `reveal-hint` to every game server
// when a streamer's likeHint widget crosses its like threshold. We reveal a
// word only if THIS server owns a live session for that handle — otherwise
// no-op (the streamer is on a different game, or has no active round). The
// revealed word renders in the session's guess list like a normal find,
// attributed to "💡 NK Likes".
function revealSessionHint(data) {
  const handle = String(data?.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return { ok: false, reason: 'bad_handle' };

  const session = sessionManager.getSession(handle);
  if (!session || session.isWon || !session.targetWord || !session.rankings) return { ok: false, reason: 'no_session' };

  const result = searchRecovery.run(session, () => sessionManager.revealHintWord(session, { count: Number(data?.count) || 0, label: data?.label })).result;
  if (!result) return { ok: false, reason: 'nothing_to_reveal' };

  session.lastActivityAt = Date.now();
  const room = _sessionRoom(handle);

  // Echo enough back to chat-relay for it to fire the streamer's likeHint
  // overlay burst against the right widget. streamerId/widgetId are opaque
  // values chat-relay handed us in the reveal-hint payload.
  const burstBase = {
    streamerId: data.streamerId || null,
    streamerHandle: handle,
    widgetId: data.widgetId || null,
    test: !!data.test,
  };

  if (result.mode === 'word') {
    const guess = result.guess;
    // Phase 1: the word renders in-game like a normal find...
    io.to(room).emit('new-guess', {
      ...guess,
      totalRankedWords: session.totalRankedWords,
      xpAward: 0,
      xpTotal: 0,
    });
    // ...and also flashes on the stream overlay burst.
    relayClient.emit('hint-reveal', { ...burstBase, mode: 'word', text: `${String(guess.word).toUpperCase()}  #${guess.rank}` });
    console.log(`[LikeHint] "${handle}" revealed word "${guess.word}" = #${guess.rank}${data?.test ? ' (test)' : ''}`);
    return { ok: true, mode: 'word', word: guess.word, rank: guess.rank };
  } else if (result.mode === 'letters') {
    // Phase 2: masked target — overlay burst only, no in-game guess.
    relayClient.emit('hint-reveal', { ...burstBase, mode: 'letters', text: result.masked });
    console.log(`[LikeHint] "${handle}" revealed letters "${result.masked}" (${result.revealed}/${Math.max(0, result.length - 1)})${data?.test ? ' (test)' : ''}`);
    return { ok: true, mode: 'letters', masked: result.masked };
  }
  return { ok: false, reason: 'nothing_to_reveal' };
}

function handleNumberGuess(msg) {
  const numberRound = numberGameManager.getGame();
  const result = numberGameManager.processGuess(msg, config.autoRestartDelay);
  if (!result || result.type === 'ignored' || result.type === 'invalid') return numberGuessStatus(result);

  if (result.type === 'bump') {
    io.to(NUMBERS_PUBLIC_ROOM).emit('bump-guess', {
      word: result.word,
      bumper: result.bumper,
    });
    return numberGuessStatus(result);
  }

  if (result.type === 'new') {
    io.to(NUMBERS_PUBLIC_ROOM).emit('new-guess', {
      ...result.guess,
      totalRankedWords: numberGameManager.getGameState().totalRankedWords,
      xpAward: result.award.pts,
      xpTotal: result.award.total,
    });
    if (result.award.pts > 0) broadcastNumberPodium();
    return numberGuessStatus(result);
  }

  if (result.type === 'win') {
    broadcastNumberPodium();
    const winPayload = {
      game: 'searchle-numbers',
      gameName: 'Number Search',
      word: result.targetWord,
      winner: result.winner,
      targetFinder: result.targetFinder,
      jackpot: result.pot,
      guessCount: result.guessCount,
      isDaily: false,
      topPlayers: result.topPlayers,
    };
    io.to(NUMBERS_PUBLIC_ROOM).emit('game-win', winPayload);
    relayClient.emit('game-win', winPayload);
    io.to(NUMBERS_PUBLIC_ROOM).emit('game-won', {
      word: result.targetWord,
      rank: config.winRank,
      user: result.winner,
      targetFinder: result.targetFinder,
      targetWord: result.targetWord,
      pot: result.pot,
      guessCount: result.guessCount,
      durationSeconds: result.durationSeconds,
      isDaily: false,
      frenzy: null,
      podium: result.podium,
      topPlayers: result.topPlayers,
    });
    numberAdvancer.schedule(numberRound);
  }
  return numberGuessStatus(result);
}

// ---------------------------------------------------------------------------
// Shared guess handler — single source of truth for processing any guess
// Called from both the web UI (test-guess) and chat relay (chat-message)
// ---------------------------------------------------------------------------
function handleGuess(msg, socket) {
  const game = gameManager.getGame();
  const callbacks={
    onBump: (word, bumper) => {
      gameManager.saveGame();
      io.to('public').emit('bump-guess', { word, bumper });
      gameShared.reportLibraryWord(bumper.platform, bumper.platformUserId, word, 'searchle', bumper.displayName, bumper.displayName, socket);
    },
    onNewGuess: (guess,award) => {
      gameManager.saveGame();
      gameShared.reportLibraryWord(guess.user.platform, guess.user.platformUserId, guess.word, 'searchle', guess.user.username || guess.user.displayName, guess.user.displayName, socket);

      // Award XP for this guess (point-based scoring). Top-10 finders get
      // big tier bonuses (90k-10k); everything else falls into proximity.
      // Target (rank 1) is awarded here too, but the gameplay end + winner
      // bookkeeping happens below in onWin.


      io.to('public').emit('new-guess', {
        ...guess,
        totalRankedWords: game.totalRankedWords,
        xpAward: award.pts,        // 0 if outside scoring band or slot taken
        xpTotal: award.total,      // player's running game XP
      });

      if (award.pts > 0) broadcastPodium();
    },
    onWin: (guess,word,completion) => {
      if (!IS_FOLLOWER) roundAdvancer.schedule(game);
      const {winner:winnerUser,targetFinder,winnerKey,targetFinderKey,guessCount,durationSeconds,winnerPayout,multiplier:frenzyMult}=completion;
      const winEvent=completion.isDaily?'mp-daily-win':'win';
      const idKeyOf=u=>u?.linkedDiscord?'discord:'+u.linkedDiscord:(u?.platform||'?')+':'+(u?.platformUserId||u?.id||'unknown');
      const scoringPlayers=gameManager.getAllScoringPlayers();
      const pot = winnerPayout; // legacy var name, used by socket emits below

      // Final podium snapshot for end-of-game UI (after all XP locked in).
      broadcastPodium();

      // Top-10 podium (frenzy-applied) for the in-game win card. Same
      // shape as the relay emit's topPlayers so the local WinOverlay
      // mirrors the holo OBS overlay's leaderboard exactly.
      const localTop10 = gameManager.getPodium(10).map((p) => ({
        displayName: p.displayName,
        profilePic: p.profilePic,
        platform: p.platform,
        platformUserId: p.platformUserId,
        linkedDiscord: p.linkedDiscord,
        points: Math.floor((p.xp || 0) * frenzyMult),
      }));

      io.to('public').emit('game-won', {
        word,
        rank: config.winRank,
        user: winnerUser,                    // winner = top XP player
        targetFinder,                        // who actually guessed the target (may differ)
        targetWord: game.targetWord,
        pot,
        guessCount: game.guesses.length,
        durationSeconds,
        isDaily,
        frenzy: currentFrenzy,
        podium: gameManager.getPodium(7),
        topPlayers: localTop10,
      });
      const sameFinderAndWinner = winnerKey === targetFinderKey;
      const winnerLog = sameFinderAndWinner
        ? `${winnerUser.displayName} found "${word}" AND won (${pot} XP)`
        : `${winnerUser.displayName} won (${pot} XP) — target "${word}" found by ${targetFinder.displayName}`;
      console.log(`[Game] WON! ${winnerLog} (${scoringPlayers.length} scoring players)${isDaily ? ' (DAILY)' : ''}${frenzyMult > 1 ? ` (${frenzyMult}x frenzy)` : ''}`);
      const sassieMsg = sameFinderAndWinner
        ? `${winnerUser.displayName} found ${word.toUpperCase()} and won ${pot.toLocaleString()} XP in Searchle! ${game.guesses.length} total guesses.`
        : `${winnerUser.displayName} won ${pot.toLocaleString()} XP in Searchle! ${targetFinder.displayName} found the target word ${word.toUpperCase()}. ${game.guesses.length} total guesses.`;
      sassie.triggerReaction(sassieMsg);

      // Report ELO round results to Word Tycoon.
      //
      // Pairwise ELO outcomes are driven by the `points` field per
      // participant — A beats B when A.points > B.points; equal points
      // is a tie (zero exchange). With the point-based scoring rewrite,
      // we feed each player's accumulated game XP straight into points,
      // so ELO ranks players by what actually drives the round win
      // (reward + GOAT credit + 'win' event all flow from XP too).
      //
      // Participation: only players who scored XP participate in the
      // ELO update. Non-scoring guessers don't lose ELO for showing up
      // with weak words — they simply don't move.
      //
      // Flags: wonRound = top XP player (the winner), foundTarget =
      // the actual target finder. With the decoupling, these are
      // independent — both can be the same person or different.
      try {
        const scoring = gameManager.getAllScoringPlayers().filter(p => gameShared.isStatsEligible(p.platform, p.platformUserId));
        const sorted = [...scoring].sort((a, b) => b.xp - a.xp);
        const participants = sorted.map((p, i) => {
          const playerGuessCount = game.guesses.filter(g => idKeyOf(g.user) === p.identityKey).length;
          const isWinner = p.identityKey === winnerKey;
          const isFinder = p.identityKey === targetFinderKey;
          return {
            identityKey: p.identityKey,
            points: p.xp,
            rank: i + 1,
            rankOutOf: 0,
            guesses: playerGuessCount,
            hits: isFinder ? 1 : 0,
            firstHitMs: null,
            wonRound: isWinner,
            foundTarget: isFinder,
            articleTitle: game.targetWord || '?',
            displayName: p.displayName || null,
          };
        });

        if (participants.length >= 2) {
          for (const p of participants) p.rankOutOf = participants.length;
          const apiSecret = process.env.GAME_API_SECRET;
          fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiSecret },
            body: JSON.stringify({ game: 'searchle', participants }),
            redirect: 'error', signal: AbortSignal.timeout(5000),
          }).then(res => {
            if (!res.ok) console.log(`[ELO] Report failed: ${res.status}`);
          }).catch(err => {
            console.log(`[ELO] Report error: ${err.message}`);
          });
        }
      } catch (err) {
        console.log('[ELO] Round report failed:', err.message);
      }

      // Notify unified win overlay
      if (!IS_FOLLOWER) {
        // Top-10 podium for the holo overlay's leaderboard. Same identity
        // shape chat-relay's enrichGameWinWithElo expects, plus `points`
        // (the per-round XP) which the lb-row uses for the right-hand
        // value column. ELO + delta are added downstream by chat-relay.
        const top10 = gameManager.getPodium(10).map((p) => ({
          displayName: p.displayName,
          profilePic: p.profilePic,
          platform: p.platform,
          platformUserId: p.platformUserId,
          linkedDiscord: p.linkedDiscord,
          points: Math.floor((p.xp || 0) * frenzyMult),
        }));
        relayClient.emit('game-win', {
          game: 'searchle',
          gameName: 'Subtextle',
          word: word.toUpperCase(),
          // winner = top XP player (may differ from target finder)
          winner: {
            displayName: winnerUser.displayName,
            profilePic: winnerUser.profilePic || null,
            platform: winnerUser.platform,
            platformUserId: winnerUser.platformUserId || null,
            linkedDiscord: winnerUser.linkedDiscord || null,
            cosmetics: winnerUser.cosmetics || null,
          },
          // who actually guessed the target word (for "Found by X" attribution
          // in the holo overlay if it ever wants to render that detail)
          targetFinder: {
            displayName: targetFinder.displayName,
            profilePic: targetFinder.profilePic || null,
            platform: targetFinder.platform,
            platformUserId: targetFinder.platformUserId || targetFinder.id || null,
            linkedDiscord: targetFinder.linkedDiscord || null,
          },
          jackpot: pot,
          guessCount: game.guesses.length,
          isDaily,
          topPlayers: top10,
        });
      }

      // Notify Chat Relay when daily game is won (advances daily sequence).
      // Daily progression credits the WINNER (top XP), consistent with the
      // reward 'win' event flowing through winnerUser.
      if (isDaily && !IS_FOLLOWER) {
        relayClient.emit('daily-win', { game: 'searchle', winner: winnerUser.displayName, platform: winnerUser.platform });
      }

      // Auto-restart (primary only — follower waits for sync-new-game)
      if (!IS_FOLLOWER) {
        syncServer.broadcastGameWon(game.targetWord);
        gameManager.preloadNextGame(config);
        roundAdvancer.schedule(game);
      }
    }
  };
  return guessProcessor.processGuess(msg,game,config,cosmeticsCache,{
    isCurrent:()=>gameManager.getGame()===game,
    acceptBump:(existing,word,bumper)=>{searchRecovery.run(game,()=>{existing.lastBumper=bumper;});callbacks.onBump(word,bumper);return{valid:true,result:'bump',word};},
    acceptGuess:(guess,word)=>acceptSearchGuess({recovery:searchRecovery,game,guess,word,config,gameManager,sessionManager,frenzy:currentFrenzy.multiplier||1,period:isDaily?roundDailyPeriod:null,afterAccepted:accepted=>{
      callbacks.onNewGuess(guess,accepted.award);if(accepted.completion)callbacks.onWin(guess,word,accepted.completion);
    }}),
    onBump:callbacks.onBump,onNewGuess:callbacks.onNewGuess,onWin:callbacks.onWin,
  });
}

// ---------------------------------------------------------------------------
// Socket.IO Server (overlay clients + web UI guess input)
// ---------------------------------------------------------------------------
// Persistent redirect targets per streamer-handle. Chat-relay sets
// these via /api/session/redirect when the streamer switches away;
// any viewer who later loads /?session=<handle> gets the redirect
// modal at socket-connect time. Cleared via /api/session/clear-
// redirect when the streamer returns to this game.
const _streamerRedirectTargets = new Map();

io.on('connection', async (socket) => {
  // Streamer-private session viewer: auth.session=<handle> arrives via the
  // client when the page is opened at /<handle> or /stream?session=<handle>
  // (or /overlay/<handle>). Join the session room so emits scoped to it
  // reach this socket; lazy-create the session game so the first viewer
  // sees a live board immediately. Public broadcasts go to 'public' room
  // (which session sockets do NOT join) — keeps the two paths isolated.
  const requestedVariant = _normalizeSearchleVariant(socket.handshake?.auth?.variant);
  const sessionHandleRaw = socket.handshake?.auth?.session;
  const sessionHandle = typeof sessionHandleRaw === 'string'
    ? sessionHandleRaw.toLowerCase().trim() : null;
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    // Persistent redirect: if chat-relay told us the streamer
    // moved, send the modal to this socket and skip session-build
    // so we don't recreate a private round in a non-current game.
    const _redirTarget = _streamerRedirectTargets.get(_sessionRedirectKey(sessionHandle, requestedVariant));
    if (_redirTarget) {
      socket.emit('session-redirect', { handle: sessionHandle, ..._redirTarget });
      return;
    }
    socket._sessionHandle = sessionHandle;
    socket._sessionVariant = requestedVariant;
    socket.join(_sessionRoom(sessionHandle, requestedVariant));
    try {
      if (requestedVariant === 'numbers') {
        const session = numberSessionManager.getOrCreateSession({
          handle: sessionHandle,
          sessionId: null,
        });
        socket.emit('game-state', numberSessionManager.buildSessionState(session));
      } else {
        const prefs = await _getStreamerSearchlePrefs(sessionHandle);
        const session = await sessionManager.getOrCreateSession({
          handle: sessionHandle,
          sessionId: null,
          config,
          targetWords: gameManager.getTargetWordPool(),
          wordFrequency: prefs.wordFrequency,
          language: prefs.language,
        });
        socket.emit('game-state', sessionManager.buildSessionState(session));
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    // Session viewers can submit guesses too. Stamp streamerHandle on the
    // outgoing message so processMultiWordGuess dispatches to the session
    // path (handleSessionGuess) — keeping them in this streamer's game.
    bindWebGuess(socket, { handle: sessionHandle, variant: requestedVariant, context: 'session' });
    socket.on('disconnect', () => {});
    return;
  }

  if (requestedVariant === 'numbers') {
    socket.join(NUMBERS_PUBLIC_ROOM);
    console.log(`[NumberSearch] CONNECT id=${socket.id}`);
    socket.emit('game-state', getNumberFullGameState());

    bindWebGuess(socket, { variant: 'numbers', context: 'numbers' });

    socket.on('disconnect', () => {
      console.log('[NumberSearch] Overlay client disconnected');
    });
    return;
  }

  // Public-game socket — join 'public' room so broadcasts can be scoped
  // to public clients only (not leaking into session sockets).
  socket.join('public');
  connectedPlayers++;
  const ip = gameShared.getClientIP(socket) || 'unknown';
  console.log('[Searchle] Public client connected');
  socket.emit('game-state', getFullGameState());

  // Web UI guess input — supports multi-word (up to 4, staggered 1s apart)
  bindWebGuess(socket);

  socket.on('disconnect', () => {
    connectedPlayers--;
    console.log('[Server] Overlay client disconnected');
  });
});

// ---------------------------------------------------------------------------
// Chat Relay Connection
// ---------------------------------------------------------------------------
relayClient.init(CHAT_RELAY_URL, config, {
  onChatMessage: (msg) => {
    processMultiWordGuess(msg);
  },

  onCosmeticsUpdated: ({ platform, platformUserId, equipped }) => {
    cosmeticsCache.invalidatePlayer(platform, platformUserId, equipped);
    let changed = false;
    const game = gameManager.getGame();
    for (const g of game.guesses) {
      if (g.user.platform === platform && g.user.platformUserId === platformUserId) {
        g.user.cosmetics = equipped || {};
        changed = true;
      }
    }
    // Also update lastWinner cosmetics so the header bar reflects changes
    if (gameManager.updateLastWinnerCosmetics(platform, platformUserId, equipped)) {
      changed = true;
    }
    if (changed) {
      gameManager.saveGame();
      io.to('public').emit('game-state', getFullGameState());
    }

    if (numberGameManager.updateUserCosmetics(platform, platformUserId, equipped)) {
      io.to(NUMBERS_PUBLIC_ROOM).emit('game-state', getNumberFullGameState());
    }
  },

  onFrenzyUpdate: (data) => {
    if (data && typeof data.multiplier === 'number') {
      currentFrenzy = { multiplier: data.multiplier, activeTappers: data.activeTappers || 0 };
      io.to('public').emit('frenzy-update', currentFrenzy);
    }
  },

  onRevealHint: (data) => {
    revealSessionHint(data);
  },

  onActivateDaily: async () => {
    console.log('[Searchle] activate-daily received from Chat Relay');
    await fetchDailyWord();
    if (!runtimeReady) return;
    searchRecovery.run(gameManager.getGame(), () => {
      dailyPlayed = false; _startDaily = true; jackpotSettings.dailyEnabled = true;
    });
    if (!IS_FOLLOWER) {
      // Start daily immediately if no active game
      const game = gameManager.getGame();
      if (!game || !game.targetWord || game.isWon) {
        console.log('[Searchle] Starting daily game immediately');
        await startNextGame(config, io);
        const g = gameManager.getGame();
        syncServer.broadcastNewGame(g.targetWord, g.startTime);
        io.to('public').emit('game-state', getFullGameState());
      } else {
        console.log('[Searchle] Game in progress — daily will start after current game ends');
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

// Admin: force-end a streamer session round (called by chat-relay on
// /api/streamer/disconnect so the streamer's round doesn't linger in
// memory after they hit Disconnect on the dashboard). Idle sweep would
// also reap it after 4h, but this gives immediate cleanup.
// Streamer-dashboard: read the current target word for this handle's
// private session. Read-only; admin-keyed (matches the conventions of
// the other /api/session/* endpoints). Returns null if no session or
// the session has no targetWord yet.
app.get('/api/session/target', requireInternalApiKey, (req, res) => {
  const handle = String((req.query && req.query.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const variant = _resolveSearchleSessionVariant(req.query?.gameId, req.query?.variant);
  const manager = variant === 'numbers' ? numberSessionManager : sessionManager;
  const sess = manager.getSession(handle);
  if (!sess) return res.json({ ok: true, handle, variant, targetWord: null, isWon: false });
  const targetWord = variant === 'numbers'
    ? (sess.targetNumber ? Number(sess.targetNumber).toLocaleString('en-US') : null)
    : (sess.targetWord || null);
  res.json({ ok: true, handle, variant, targetWord, isWon: !!sess.isWon });
});

app.post('/api/session/set-word', requireInternalApiKey, express.json(), async (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const word = String((req.body && req.body.word) || '').trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  if (!word) return res.status(400).json({ ok: false, error: 'word required' });
  const variant = _resolveSearchleSessionVariant(req.body?.gameId, req.body?.variant);
  if (variant !== 'searchle') return res.status(400).json({ ok: false, error: 'set-word only supports Searchle word sessions' });
  try {
    const prefs = await _getStreamerSearchlePrefs(handle);
    const session = await sessionManager.getOrCreateSession({
      handle,
      sessionId: null,
      config,
      targetWords: gameManager.getTargetWordPool(),
      wordFrequency: prefs.wordFrequency,
      language: prefs.language,
    });
    await sessionManager.startSessionRoundWithWord(session, word, config);
    io.to(_sessionRoom(handle)).emit('game-state', sessionManager.buildSessionState(session));
    res.json({ ok: true, handle, variant, language: session.language || 'en', targetWord: session.targetWord });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'set-word failed' });
  }
});

app.post('/api/session/end', requireInternalApiKey, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const variant = _resolveSearchleSessionVariant(req.body?.gameId, req.body?.variant);
  const manager = variant === 'numbers' ? numberSessionManager : sessionManager;
  const had = manager.endSession(handle);
  res.json({ ok: true, had, variant });
});

// Admin: tell the streamer's session viewers that the streamer
// moved to a different game. Emits a `session-redirect` socket
// event into the session room so any open <handle> tab can show
// a 'follow the streamer' modal. Does NOT end the session — the
// streamer might switch back, in which case the existing round
// resumes. Called by chat-relay's /api/streamer/game on switch.
app.post('/api/session/redirect', requireInternalApiKey, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const variant = _resolveSearchleSessionVariant(req.body?.gameId, req.body?.variant);
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(_sessionRedirectKey(handle, variant), { targetUrl, targetGameName, targetGameId });
  io.to(_sessionRoom(handle, variant)).emit('session-redirect', {
    handle, targetUrl, targetGameName, targetGameId,
  });
  res.json({ ok: true, variant });
});

// Admin: streamer is now active in THIS game — clear any stale
// redirect target so viewers landing on /?session=<handle> aren't
// bounced to wherever the streamer USED to be. Called by chat-
// relay's /api/streamer/game switch handler on the new active game.
app.post('/api/session/clear-redirect', requireInternalApiKey, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const variant = _resolveSearchleSessionVariant(req.body?.gameId, req.body?.variant);
  const had = _streamerRedirectTargets.delete(_sessionRedirectKey(handle, variant));
  res.json({ ok: true, had, variant });
});

// Paid-hint trigger — Chat Relay calls this when a Donor / Super Fan spends a
// /hint. Reuses the exact Like-for-Hint reveal (revealSessionHint): a close
// top-10 word first, then masked letters. Returns whether a hint was actually
// revealed so the relay only charges the viewer on success. No-ops (no charge)
// when there's no live session for this handle.
app.post('/api/session/hint', requireInternalApiKey, express.json(), (req, res) => {
  try {
    const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, reason: 'bad_handle' });
    const label = typeof (req.body && req.body.label) === 'string' ? req.body.label.slice(0, 40) : null;
    const result = revealSessionHint({ streamerHandle: handle, label });
    return res.json(result || { ok: false, reason: 'nothing_to_reveal' });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'error', message: e.message });
  }
});

server.listen(PORT, () => {
  initializeRuntime().catch(() => console.error('[Recovery] Startup requires storage recovery'));
});
async function initializeRuntime() {
  console.log(`[Server] Searchle Mobile running at http://localhost:${PORT}`);

  // Load target words from word bank API (fallback to local file)
  await gameManager.loadTargetWords();
  gameManager.filterTargetWords();
  searchRecovery=createSearchRecovery({createJournal:requireRelayOrShared('src/game-action-journal').createGameActionJournal,directory:path.join(process.env.DATA_DIR||path.join(__dirname,'..','data'),'mp-actions'),sdk:gameShared,getMetadata:getRecoveryMetadata,setMetadata:setRecoveryMetadata,onError:()=>console.warn('[Recovery] Searchle reward handoff pending')});
  gameManager.setRecovery(searchRecovery);sessionManager.setRecovery(searchRecovery);
  numberRecovery = createSearchRecovery({
    createJournal: requireRelayOrShared('src/game-action-journal').createGameActionJournal,
    directory: path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'number-actions'), sdk: gameShared,
    getMetadata: target => target.handle ? { handle: target.handle } : { ...numberGameManager.snapshotMetadata(), numberSessionsMigrated: true },
    setMetadata: (target, value) => { if (!target.handle) numberGameManager.restoreMetadata(value); },
    onError: () => console.warn('[Recovery] Number Searchle handoff deferred'),
  });
  numberGameManager.setRecovery(numberRecovery);numberSessionManager.setRecovery(numberRecovery);
  initializeRoundAdvancers();

  if (IS_FOLLOWER) {
    // FOLLOWER MODE: load saved state for cosmetics/lastWinner, target word comes from primary
    console.log(`[Server] Running as FOLLOWER — syncing with ${SYNC_PRIMARY_URL}`);
    await gameManager.loadGame(config, cosmeticsCache, io);
    syncClient.init(SYNC_PRIMARY_URL, SYNC_SECRET, config, {
      onNewWord: async (targetWord, startTime) => {
        await gameManager.startGameWithWord(targetWord, config, io, startTime);
      },
      onGameWon: (targetWord) => {
        gameManager.forceWin(targetWord);
      },
    });
  } else {
    // PRIMARY / STANDALONE MODE: pick word normally
    // Fetch daily word before loading/starting game
    await fetchDailyWord();
    if (!await gameManager.loadGame(config, cosmeticsCache, io)) {
      await startNextGame(config, io);
    } else {
      // Restored a saved game — check if it matches today's daily word
      const restoredWord = gameManager.getGame().targetWord;
      if (!searchRecovery.load('public') && dailyWord && dailyWord.word && restoredWord === dailyWord.word) {
        isDaily = true;
        roundDailyPeriod = dailyWord.date;
        dailyPlayed = true;
        console.log(`[Searchle] Restored game is today's daily word (${restoredWord.length} letters)`);
      }
    }
  }

  if(!searchRecovery.current(gameManager.getGame()))searchRecovery.start(gameManager.getGame(),'public',getRecoveryMetadata(gameManager.getGame()),true);
  searchRecovery.run(gameManager.getGame(), () => {});
  numberRecovery.run(numberGameManager.getGame(), () => {});
  if (!IS_FOLLOWER) roundAdvancer.schedule(gameManager.getGame());
  for (const session of sessionManager.allSessions()) roundAdvancer.schedule(session);
  numberAdvancer.schedule(numberGameManager.getGame());
  for (const session of numberSessionManager.allSessions()) numberAdvancer.schedule(session);


  runtimeReady = true;
  // Hourly daily word refresh (catches day rollover)
  setInterval(fetchDailyWord, 60 * 60 * 1000);

  // Broadcast updated game-state to any clients that connected during loadGame
  // (fixes race condition: Chat Relay reconnects before loadGame completes,
  //  receiving stale lastWinner/rankings — this re-sends the correct state)
  io.to('public').emit('game-state', getFullGameState());

  // Log SP pool status (read-only pool — no background fill)
  console.log(`[SP Pool] ${spManager.getPoolInfo().total} games available`);

  // Fetch win data from Word Tycoon (single source of truth)
  const wtApiKey = process.env.GAME_API_SECRET;
  await gameManager.fetchWonWords(WORD_EMPIRES_URL, wtApiKey);
  await gameManager.fetchRecentGames(WORD_EMPIRES_URL, wtApiKey);
  await gameManager.fetchWinCounts(WORD_EMPIRES_URL, wtApiKey);
  await gameManager.fetchEloLeaderboard(WORD_EMPIRES_URL, wtApiKey);
  // Refresh win counts and ELO every 5 minutes
  setInterval(() => {
    gameManager.fetchWinCounts(WORD_EMPIRES_URL, wtApiKey);
    gameManager.fetchEloLeaderboard(WORD_EMPIRES_URL, wtApiKey);
  }, 5 * 60 * 1000);

  // Legacy context hook retained for compatibility; Sassie ignores this provider pattern.
  setInterval(() => {
      const game = gameManager.getGame();
      if (!game) return;
      const guessCount = game.guesses ? game.guesses.length : 0;
      const playerCount = game.players ? game.players.size : 0;
      sassie.sendContext(`Searchle: ${guessCount} guesses so far, ${playerCount} players active, target word has ${game.targetWord ? game.targetWord.length : '?'} letters.`);
  }, 60000);
}

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Searchle] Shutting down...');
  roundAdvancer?.stop();numberAdvancer?.stop();
  searchRecovery?.stop();numberRecovery?.stop();
  gameManager.saveGameSync();
  gameManager.savePlayedWords();
  console.log('[Searchle] Game state saved');
  relayClient.disconnect();
  syncClient.disconnect();
  server.close();
  console.log('[Searchle] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
