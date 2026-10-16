require('dotenv').config();
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const db = require('./src/database');
const redis = require('./src/redis');
const relayClient = require('./src/relay-client');
const gameEngine = require('./src/game-engine');
const commands = require('./src/commands');
const overlay = require('./src/overlay');
const backup = require('./src/backup');
const { createOperationsMonitor } = require('./src/operations-monitor');
const operationsMonitor = createOperationsMonitor({ directory: path.join(__dirname, 'data') });
const ledgerDb = require('./src/ledger-db');
const ledger = require('./src/ledger');
const { registerFriendsRoutes } = require('./src/routes/friends');
const { registerLibraryRoutes } = require('./src/routes/library');
const { registerLedgerRoutes } = require('./src/routes/ledger');
const { registerRewardsRoutes } = require('./src/routes/rewards');
const { registerAccountRoutes } = require('./src/routes/accounts');
const { registerPizzaRoutes } = require('./src/routes/pizza');
const { registerNewspaperRoutes } = require('./src/routes/newspaper');
const { registerCarwashRoutes } = require('./src/routes/carwash');
const { registerStockMogulRoutes } = require('./src/routes/stockmogul');
const { registerGymRoutes } = require('./src/routes/gym');
const { registerCinemaRoutes } = require('./src/routes/cinema');
const { registerManagerRoutes } = require('./src/routes/managers');
const { registerStartupRoutes } = require('./src/routes/startup');
const { registerBankRoutes } = require('./src/routes/bank');
const { registerDailyClaimRoutes } = require('./src/routes/daily-claim');
const { registerBackupRoutes } = require('./src/routes/backups');
const { registerCosmeticsRoutes } = require('./src/routes/cosmetics');
const { registerMembershipRoutes } = require('./src/routes/membership');
const { registerIPLogRoutes } = require('./src/routes/ip-log');
const { createCosmeticsBroadcast } = require('./src/cosmetics-broadcast');
const { createObsidianSyncService } = require('./src/obsidian-sync');
const { registerObsidianSyncRoutes } = require('./src/routes/obsidian-sync');
const { registerEloRoutes, suspicionData } = require('./src/routes/elo');
const { registerWordFoundryRoutes } = require('./src/routes/word-foundry');
const { validateUsername } = require('./src/username-moderation');

const PORT = process.env.PORT || 3020;

const app = express();
let isShuttingDown = false;
app.use((_req, res, next) => {
  if (isShuttingDown) return res.status(503).json({ ok: false, message: 'Economy restarting; retry the same action shortly.' });
  next();
});
const server = http.createServer(app);
// CORS — whitelist known origins (game servers, Chat Relay, portal)
const ALLOWED_ORIGINS = [
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'https://wordtycoon.live', 'https://www.wordtycoon.live',
  'https://searchle.live', 'https://www.searchle.live', 'https://grid.searchle.live',
  'https://subtextle.com', 'https://www.subtextle.com', 'https://grid.subtextle.com',
  'https://word5000.com', 'https://www.word5000.com', 'https://origin.word5000.com', 'https://live.word5000.com',
  'https://word500.ca', 'https://www.word500.ca',
  'https://wordgame.live', 'https://www.wordgame.live',
  'https://rectangled.live', 'https://www.rectangled.live', 'https://origin.rectangled.live',
  'https://erectangled.com', 'https://www.erectangled.com', 'https://origin.erectangled.com',
  'https://triangled.io', 'https://www.triangled.io', 'https://triangled.live', 'https://www.triangled.live',
  'https://wikisearchle.com', 'https://www.wikisearchle.com',
  'https://wikicontexto.com', 'https://www.wikicontexto.com',
  'https://wikirectangled.com', 'https://www.wikirectangled.com', 'https://3d.wikirectangled.com',
  'https://wikiword.live', 'https://www.wikiword.live',
  'https://betwixt.live', 'https://www.betwixt.live',
  'http://localhost:3010', 'http://localhost:3012', 'http://localhost:3014',
  'http://localhost:3016', 'http://localhost:3018', 'http://localhost:3020',
  'http://localhost:3022', 'http://localhost:3024', 'http://localhost:3026'
];

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      // Allow no-origin requests (same-origin, server-to-server, socket.io-client)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('CORS rejected'));
    },
    credentials: true
  },
  pingInterval: 10000,    // Send ping every 10s (detect dead connections faster)
  pingTimeout: 5000,      // Consider dead after 5s with no pong
  transports: ['polling', 'websocket']  // Polling first — most reliable in OBS CEF
});
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  // Same-origin and server-to-server requests (no Origin header) pass through naturally
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-relay-auth');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get(['/wikirectangled', '/wikirectangled/'], (req, res) => {
  res.redirect(302, 'https://wikirectangled.com/');
});

// Serve static files
require('./src/word-trails').registerWordTrailsRoutes(app);
app.use(express.static(path.join(__dirname, 'public')));
// Digital Asset Links for the Android TWA (Play Store app). express.static
// skips dot-directories and sendFile defaults dotfiles:'ignore', so
// /.well-known needs an explicit route with dotfiles allowed.
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'), { dotfiles: 'allow' });
});
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl === '/api/stripe/webhook') {
      req.rawBody = Buffer.from(buf);
    }
  }
}));

// ==================== SECURITY MIDDLEWARE ====================
const GAME_API_SECRET = process.env.GAME_API_SECRET;
const RELAY_GATEWAY_SECRET = process.env.RELAY_GATEWAY_SECRET || null;
// Operator authorization is separate from every game issuer.
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || null;
const serviceKeyPolicy = require('./src/service-key-policy').createServiceKeyPolicy({
  filename: require('path').join(__dirname, 'data', 'service-keys.json'),
});
const serviceAuth = require('./src/service-auth').createServiceAuth({ policy: serviceKeyPolicy, adminKey: ADMIN_API_SECRET });
const MAX_SINGLE_REWARD = parseInt(process.env.MAX_SINGLE_REWARD) || 1000000;
const MAX_TOTAL_MULTIPLIER = parseInt(process.env.MAX_TOTAL_MULTIPLIER) || 1500;

// Route capabilities use the full path, including mounted /api prefixes.
const requireApiKey = serviceAuth.requireApiKey;
const requireAdminKey = serviceAuth.requireAdminKey;

// Browser account state must only arrive through the co-located Chat Relay,
// which owns the signed-in portal session. Other game servers also know the
// game API secret. This route needs its separate gateway credential;
// neither the game key nor an admin key authorizes an account action.
function requireRelayKey(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (isLocalhost && RELAY_GATEWAY_SECRET && req.headers['x-relay-auth'] === RELAY_GATEWAY_SECRET) return next();
  return res.status(401).json({ ok: false, message: 'Unauthorized: relay session gateway required' });
}

// Coin input sanitizer — prevents NaN, Infinity, negative, and float corruption
function sanitizeCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

// Rate limiter for /api/reward (max 10 per second per game)
const rewardRateLimits = new Map();      // per-game window: 10/sec
const rewardUserRateLimits = new Map();  // per-user window: 30/sec
const REWARD_GAME_LIMIT = 10;
const REWARD_USER_LIMIT = 30;
function _bumpRewardWindow(map, key, limit, now) {
  const entry = map.get(key);
  if (!entry || now - entry.windowStart > 1000) {
    map.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}
// Enforces BOTH a per-game and a per-user cap. The per-user cap is independent
// of the game name, so rotating the `game` field can no longer multiply a single
// account's reward rate past 30/sec (audit 2026-07-18; observed legit peak ~2/sec).
function checkRewardRateLimit(game, userKey) {
  const now = Date.now();
  // Prune stale per-user entries so the map can't grow unbounded across players.
  if (rewardUserRateLimits.size > 5000) {
    for (const [k, v] of rewardUserRateLimits) {
      if (now - v.windowStart > 1000) rewardUserRateLimits.delete(k);
    }
  }
  const gameOk = _bumpRewardWindow(rewardRateLimits, game || 'unknown', REWARD_GAME_LIMIT, now);
  const userOk = userKey ? _bumpRewardWindow(rewardUserRateLimits, userKey, REWARD_USER_LIMIT, now) : true;
  return gameOk && userOk;
}

// Apply API key to sensitive endpoints
app.use('/api/reward', requireApiKey);
app.use('/api/deduct', requireApiKey);
app.use('/api/balance', requireApiKey);
app.use('/api/city-data', requireApiKey);
app.use('/api/admin', requireAdminKey);
app.get('/api/admin/operations', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(operationsMonitor.summary());
});

// ── Presence + Accrual (Phase 1 income refactor, 2026-03-26) ──
const presence = require('./src/presence');
const accrual = require('./src/accrual');

// ── Income/sec computation (extracted to src/income.js) ──
const { createIncomeService } = require('./src/income');
const businesses = require('./src/businesses');
const incomeService = createIncomeService(db);
const computePlayerIncome = incomeService.computePlayerIncome;
const computeCombinedIncome = incomeService.computeCombinedIncome;
const getPlayerTotalIncomePerSec = incomeService.getPassiveIncomeBase;
const obsidianSync = createObsidianSyncService({ db, computePlayerIncome });

function roundMB(value) {
  return Number((value / (1024 * 1024)).toFixed(2));
}

function summarizeMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: roundMB(usage.rss),
    heapUsed: roundMB(usage.heapUsed),
    heapTotal: roundMB(usage.heapTotal),
    external: roundMB(usage.external || 0),
    arrayBuffers: roundMB(usage.arrayBuffers || 0)
  };
}

function summarizeBackupHealth() {
  const stats = backup.listBackupStats();
  const targets = backup.getConfiguredRetentionTargets();
  const out = {};

  for (const [key, value] of Object.entries(stats || {})) {
    out[key] = {
      snapshotCount: Number(value?.snapshotCount || 0),
      fileCount: Number(value?.count || 0),
      totalSizeMB: Number(value?.totalSizeMB || 0),
      targetSnapshots: targets[key] ?? null,
      latestModified: value?.files?.[0]?.modified || null
    };
  }

  return out;
}

function summarizeLedgerHealth() {
  const status = ledger.getMaintenanceStatus();
  return {
    running: !!status?.running,
    retentionDays: status?.retentionDays ?? null,
    batchSize: status?.batchSize ?? null,
    intervalMs: status?.intervalMs ?? null,
    startupDelayMs: status?.startupDelayMs ?? null,
    eligibleHotRows: Number(status?.eligibleHotRows || 0),
    hotRows: Number(status?.hotRows || 0),
    mirrorRows: Number(status?.mirrorRows || 0),
    archiveRows: Number(status?.archiveRows || 0),
    mainDbSizeMB: status?.mainDbSizeMB ?? null,
    mirrorDbSizeMB: status?.mirrorDbSizeMB ?? null,
    archiveDbSizeMB: status?.archiveDbSizeMB ?? null,
    lastMaintenance: status?.lastMaintenance || null
  };
}

function summarizeTapBufferHealth() {
  const tapBuffer = redis.getStatus
    ? redis.getStatus()
    : {
        mode: redis.isUsingFallback() ? 'redis-fallback' : 'redis',
        ready: redis.isConnected(),
        externalService: true,
        fallback: redis.isUsingFallback(),
      };
  const usingRedis = tapBuffer.mode === 'redis' || tapBuffer.mode === 'redis-fallback';
  return {
    tapBuffer,
    redisConnected: usingRedis ? !!tapBuffer.ready : null,
    redisFallback: usingRedis ? !!tapBuffer.fallback : false,
  };
}

function formatTapBufferLogStatus() {
  const { tapBuffer } = summarizeTapBufferHealth();
  if (tapBuffer.mode === 'in-memory') return 'In-memory ready';
  if (tapBuffer.ready) return 'Connected';
  if (tapBuffer.fallback) return 'In-memory fallback';
  return 'Connecting...';
}

// Clean route for GOAT leaderboard page
app.get('/goat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'goat.html'));
});

// API endpoints
app.get('/api/state', (req, res) => {
  res.json(gameEngine.getGameState());
});

app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json(gameEngine.getLeaderboard(limit));
});

// Wikisearchle fallback-pfp map, cached with a 60s TTL so the hot /api/goat
// endpoint doesn't do a synchronous file read + JSON.parse on every request.
let _wikiPfpsCache = null;
let _wikiPfpsCacheAt = 0;
function getWikiPfps() {
  const now = Date.now();
  if (_wikiPfpsCache && (now - _wikiPfpsCacheAt) < 60000) return _wikiPfpsCache;
  const map = {};
  try {
    const wikiStats = JSON.parse(require('fs').readFileSync('/opt/wikisearchle/data/player-stats.json', 'utf-8'));
    for (const entry of Object.values(wikiStats)) {
      const user = entry.user || entry;
      if (user.profilePic && user.platformUserId) {
        map[user.platformUserId] = user.profilePic;
      }
    }
  } catch (e) { /* ignore — file may be absent */ }
  _wikiPfpsCache = map;
  _wikiPfpsCacheAt = now;
  return map;
}

const goatCosmetics = require('./src/cosmetics');
const GOAT_MIN_ROUNDS = 5;
const GOAT_PUBLIC_CACHE_TTL_MS = 15_000;
const goatPublicCache = new Map();
const GOAT_SORTS = new Set([
  'coins', 'elo', 'total_game_wins', 'total_taps', 'library_words', 'streak', 'longest_streak',
  'word5000', 'word500', 'color500', 'colour500', 'subtextle', 'searchle', 'betwixt',
  'rectangled', 'erectangled', 'unwordle', 'spelling-bee', 'spellingbee', 'wordle', 'figural',
  'pixeletters', 'wikicontexto', 'wikisearchle', 'wikirectangled', 'triangled', 'synapse',
  'synapse-mp', 'junkdrawer', 'cloudquarry', 'letterworks', 'wordfall',
  'elo:subtextle', 'elo:searchle', 'elo:wikicontexto', 'elo:wikisearchle',
  'elo:rectangled', 'elo:erectangled'
]);

function parseGoatQuery(query) {
  const compact = String(query.compact || '') === '1';
  const requestedSort = String(query.sort || (compact ? 'elo' : 'coins')).toLowerCase();
  const sort = GOAT_SORTS.has(requestedSort) ? requestedSort : (compact ? 'elo' : 'coins');
  const requestedRegion = String(query.region || 'global').toUpperCase();
  const region = ['GLOBAL', 'NA', 'EU', 'APAC'].includes(requestedRegion) ? requestedRegion : 'GLOBAL';
  return {
    page: Math.max(1, parseInt(query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit, 10) || (compact ? 20 : 50))),
    sort,
    sortDir: query.direction === 'asc' ? 'asc' : 'desc',
    search: String(query.q || '').trim().slice(0, 80),
    region,
    compact,
    ratedOnly: compact && (sort === 'elo' || sort.startsWith('elo:')),
    excludeSuspended: compact
  };
}

function parseEquippedCosmetics(player, includePrivateDetails) {
  return (player.equipped_cosmetics || []).map(c => {
    const item = {
      category: c.category,
      name: c.name,
      rarity: c.rarity
    };
    if (!includePrivateDetails) return item;
    try { item.css = JSON.parse(c.css_property); } catch { item.css = {}; }
    item.buff = goatCosmetics.getCosmeticById(c.cosmetic_id)?.buff || null;
    return item;
  });
}

function goatGameWins(player) {
  return {
    word5000: player.word5000_wins,
    color500: player.color500_wins,
    subtextle: player.subtextle_wins,
    betwixt: player.betwixt_wins,
    rectangled: player.rectangled_wins,
    erectangled: player.erectangled_wins,
    unwordle: player.unwordle_wins,
    spellingbee: player.spellingbee_wins,
    wordle: player.wordle_wins,
    figural: player.figural_wins,
    pixeletters: player.pixeletters_wins,
    wikicontexto: player.wikicontexto_wins,
    triangled: player.triangled_wins,
    wikirectangled: player.wikirectangled_wins,
    synapse: player.synapse_wins,
    'synapse-mp': player.synapsemp_wins,
    junkdrawer: player.junkdrawer_wins,
    cloudquarry: player.cloudquarry_wins,
    letterworks: player.letterworks_wins,
    wordfall: player.wordfall_wins
  };
}

function getGoatSuspicion(identityKeys) {
  let maximum = null;
  for (const key of identityKeys || []) {
    const candidate = suspicionData[key]?.global;
    if (candidate && (!maximum || (candidate.score || 0) > (maximum.score || 0))) maximum = candidate;
  }
  return maximum ? {
    score: maximum.score || 0,
    flags: maximum.flags || [],
    flagged: maximum.flagged || null
  } : null;
}

function baseGoatPlayer(player, rank, wikiPfps, includePrivateDetails) {
  const publicPlatform = player.discord_user_id ? 'discord' : (player.platform || 'web');
  const base = {
    rank,
    displayName: player.display_name || 'Unknown',
    profilePic: player.profile_pic || wikiPfps[player.platform_user_id || player.discord_user_id || ''] || null,
    platform: publicPlatform,
    xp: player.xp || 0,
    totalTaps: player.total_taps || 0,
    totalGameWins: player.total_game_wins || 0,
    gameWins: goatGameWins(player),
    libraryWords: player.library_words || 0,
    country: player.country || null,
    currentStreak: player.current_streak || 0,
    longestStreak: player.longest_streak || 0,
    memberSince: player.created_at ? player.created_at.split(' ')[0] : null,
    equippedCosmetics: parseEquippedCosmetics(player, includePrivateDetails),
    elo: player.goat_elo || null,
    eloPeak: player.goat_elo || null,
    roundsCounted: player.goat_rounds_counted || 0,
    gamesParticipated: player.goat_games_participated || 0,
    gameElos: player.goat_game_elos || {},
    gameEloRounds: player.goat_game_elo_rounds || {}
  };
  if (!includePrivateDetails) return base;
  return {
    ...base,
    discordUserId: player.discord_user_id || null,
    platform: player.platform || null,
    platformUserId: player.platform_user_id || null,
    coins: player.xp || 0,
    wordGameXp: player.word_game_xp || 0,
    suspended: player.suspended || 0,
    suspicion: getGoatSuspicion(player.identity_keys)
  };
}

function cachePublicGoat(key, payload) {
  if (goatPublicCache.size >= 100) goatPublicCache.delete(goatPublicCache.keys().next().value);
  goatPublicCache.set(key, { payload, expiresAt: Date.now() + GOAT_PUBLIC_CACHE_TTL_MS });
}

// GOAT Hall of Fame leaderboard. compact=1 is the privacy-safe, server-paginated
// public surface used by /goat; the legacy response remains for older clients.
app.get('/api/goat', (req, res) => {
  const params = parseGoatQuery(req.query);
  const cacheKey = params.compact ? JSON.stringify(params) : null;
  const cached = cacheKey ? goatPublicCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    return res.json(cached.payload);
  }
  if (cached) goatPublicCache.delete(cacheKey);

  const data = db.getGoatLeaderboard(params.page, params.limit, params.sort, {
    search: params.search,
    region: params.region,
    sortDir: params.sortDir,
    excludeSuspended: params.excludeSuspended,
    ratedOnly: params.ratedOnly
  });
  const wikiPfps = getWikiPfps();
  const offset = (data.page - 1) * data.limit;
  const players = data.players.map((player, index) =>
    baseGoatPlayer(player, player.goat_rank || offset + index + 1, wikiPfps, !params.compact));
  const payload = {
    ok: true,
    players,
    pagination: {
      page: data.page,
      limit: data.limit,
      total: data.total,
      pages: data.pages
    },
    summary: {
      totalAccounts: data.totalAccounts,
      minRoundsCounted: GOAT_MIN_ROUNDS
    }
  };

  if (params.compact) {
    cachePublicGoat(cacheKey, payload);
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
  } else {
    res.set('Cache-Control', 'no-store');
  }
  res.json(payload);
});

// City data for TycoonIO isometric city — returns all players with businesses
app.get('/api/city-data', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 500));
  const data = db.getCityData(limit);
  res.json({ ok: true, ...data });
});

app.get('/api/commands', (req, res) => {
  res.json(commands.getCommandList());
});

app.get('/api/status', (req, res) => {
  const tapHealth = summarizeTapBufferHealth();
  res.json({
    relay: relayClient.isConnected(),
    tapBuffer: tapHealth.tapBuffer,
    redis: tapHealth.redisConnected,
    redisFallback: tapHealth.redisFallback
  });
});

app.get('/api/health', (req, res) => {
  const tapHealth = summarizeTapBufferHealth();
  res.json({
    ok: true,
    service: 'mobile-tycoon',
    role: 'economy',
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    connectivity: {
      relayConnected: relayClient.isConnected(),
      tapBuffer: tapHealth.tapBuffer,
      redisConnected: tapHealth.redisConnected,
      redisFallback: tapHealth.redisFallback
    },
    memoryMB: summarizeMemoryUsage(),
    players: {
      total: Number(db.getPlayerCount ? db.getPlayerCount() : 0)
    },
    gameplay: {
      frenzy: gameEngine.getFrenzyState ? gameEngine.getFrenzyState() : null
    },
    presence: presence.getStats ? presence.getStats() : null,
    databases: {
      main: db.getRuntimeInfo ? db.getRuntimeInfo() : null,
      ledgerMirror: ledgerDb.getRuntimeInfo ? ledgerDb.getRuntimeInfo() : null,
      ledger: summarizeLedgerHealth()
    },
    backups: summarizeBackupHealth()
  });
});

app.post('/api/username/validate', (req, res) => {
  const { name, maxLength, minLength } = req.body || {};
  const result = validateUsername(name, {
    maxLength: maxLength || 20,
    minLength: minLength || 1
  });
  res.status(result.valid ? 200 : 400).json(result);
});

// Cosmetics broadcast — notify game servers when cosmetics change
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const broadcastCosmeticsUpdate = createCosmeticsBroadcast({ db, gameEngine, CHAT_RELAY_URL, GAME_API_SECRET });

// ─── Extracted route modules ──────────────────────────────────────────────────
registerFriendsRoutes(app, { db, requireApiKey });
registerLibraryRoutes(app, { db, gameEngine, businesses, requireApiKey, ADMIN_API_SECRET, CHAT_RELAY_URL });
registerLedgerRoutes(app, { ledger, backup });
registerRewardsRoutes(app, { db, gameEngine, ledger, sanitizeCoins, checkRewardRateLimit, MAX_SINGLE_REWARD });
registerAccountRoutes(app, { db, gameEngine, ledger, requireApiKey, broadcastCosmeticsUpdate, computePlayerIncome, computeCombinedIncome, cosmetics: require('./src/cosmetics'), businesses });
registerPizzaRoutes(app, { db, ledger });
registerNewspaperRoutes(app, { db, ledger });
registerCarwashRoutes(app, { db, ledger, getPlayerTotalIncomePerSec });
registerStockMogulRoutes(app, { db, ledger });
registerGymRoutes(app, { db, ledger });
registerCinemaRoutes(app, { db, ledger });
registerManagerRoutes(app, { db });
registerStartupRoutes(app, { db, ledger });
registerBankRoutes(app, { db, ledger });
registerDailyClaimRoutes(app, { db, gameEngine, requireApiKey });
registerBackupRoutes(app, { db, backup });
registerCosmeticsRoutes(app, { db, gameEngine, requireApiKey, broadcastCosmeticsUpdate });
registerMembershipRoutes(app, { db });
registerIPLogRoutes(app, { db, requireApiKey });
registerObsidianSyncRoutes(app, { syncService: obsidianSync });
registerEloRoutes(app, { requireApiKey, db });
registerWordFoundryRoutes(app, { db, requireRelayKey });

// Play endpoint — auto-grants Library (used by Discord bot /play).
// Gated: the only caller is the Discord bot, which sends x-api-key. Without the
// gate this endpoint let anyone create player rows with attacker-controlled
// profilePic/displayName (rendered on overlays) and spam ticker/overlay events.
app.post('/api/play', requireApiKey, (req, res) => {
  const { platform, userId, username, displayName, profilePic, country } = req.body;
  if (!platform || !userId) {
    return res.status(400).json({ ok: false, message: 'Missing required fields' });
  }
  const player = gameEngine.getOrCreatePlayer(platform, userId, username || userId, displayName || username || userId, profilePic || null, country);
  if (!player) return res.json({ ok: false, message: 'Could not create player' });
  const safePlayerName = player.display_name || player.username || userId;

  const existingLibrary = db.getPlayerBusiness(player.id, 'library');
  let grantedLibrary = false;
  if (!existingLibrary) {
    db.createPlayerBusiness(player.id, 'library');
    db.save();
    db.logEvent('play', safePlayerName, { business: 'Library', auto: true });
    gameEngine.emitTickerEvent('buy', safePlayerName, 'started their empire with a Library!');
    grantedLibrary = true;
  }

  gameEngine.refreshCache();
  gameEngine.emitOverlayUpdate(true);

  const updatedPlayer = db.getPlayerById(player.id);
  res.json({
    ok: true,
    grantedLibrary,
    player: {
      id: updatedPlayer.id,
      displayName: updatedPlayer.display_name,
      coins: updatedPlayer.xp || 0,
      totalTaps: updatedPlayer.total_taps
    }
  });
});



// Start everything

// Region update endpoint (manual override with 7-day cooldown)
const VALID_COUNTRIES = ['US','GB','DE','FR','JP','KR','SE','NL','BR','ES','MX','IT','PL','RU','CN','TW','CA','AU','??'];
app.post('/api/player/region', requireApiKey, (req, res) => {
  const { platform, userId, country } = req.body;
  if (!platform || !userId || !country) {
    return res.status(400).json({ ok: false, message: 'Missing required fields' });
  }
  if (!VALID_COUNTRIES.includes(country)) {
    return res.status(400).json({ ok: false, message: 'Invalid country code' });
  }
  const player = db.getPlayer(platform, userId);
  if (!player) {
    return res.status(404).json({ ok: false, message: 'Player not found' });
  }
  const now = Math.floor(Date.now() / 1000);
  const lastChanged = player.region_changed_at || 0;
  const cooldown = 604800; // 7 days in seconds
  if (lastChanged && (now - lastChanged) < cooldown) {
    const daysLeft = Math.ceil((cooldown - (now - lastChanged)) / 86400);
    return res.status(429).json({ ok: false, message: `Region can only be changed once per week. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` });
  }
  db.run('UPDATE players SET country = ?, region_changed_at = ? WHERE id = ?', [country, now, player.id]);
  db.save();
  res.json({ ok: true, country, changedAt: now });
});
async function start() {
  console.log('========================================');
  console.log('  Mobile Tycoon - Livestream Tycoon Clicker');
  console.log('========================================');

  require('./src/restore-guard').ensureNoInterruptedRestore(require('./src/paths').DATA_DIR);
  await db.initialize();
  presence.initialize(db);
  accrual.initialize(db);
  await redis.initialize();
  await ledgerDb.initialize();
  await ledger.initialize(db, ledgerDb);

  // Initialize data redundancy system (creates startup backup)
  backup.initialize();
  // Probe is asynchronous and separate from the economy request loop.
  operationsMonitor.start().catch(() => console.warn('[Operations] Startup probe unavailable'));

  gameEngine.initialize(io, db, redis, ledger);
  commands.initialize(gameEngine, db, broadcastCosmeticsUpdate, ledger);
  relayClient.initialize(gameEngine, commands, broadcastCosmeticsUpdate, PORT);
  gameEngine.setFrenzyEmitter((data) => relayClient.emitFrenzyUpdate(data));
  overlay.initialize(io, gameEngine);

  // Create initial JSON snapshot of all player data
  backup.createJsonSnapshot(db);

  // Bind to localhost only — all external access goes through Chat Relay's reverse proxy
  const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
  server.listen(PORT, BIND_HOST, () => {
    console.log(`[Mobile Tycoon] Server running at http://${BIND_HOST}:${PORT}`);
    console.log(`[Mobile Tycoon] Overlay: http://${BIND_HOST}:${PORT}/overlay.html`);
    console.log(`[Mobile Tycoon] Player Empires: http://${BIND_HOST}:${PORT}/overlay-empires.html`);
    console.log(`[Relay] Status: ${relayClient.isConnected() ? 'Connected' : 'Connecting...'}`);
    console.log(`[TapBuffer] Status: ${formatTapBufferLogStatus()}`);
  });
}

start().catch(err => {
  console.error('Failed to start Mobile Tycoon:', err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[Mobile Tycoon] Draining requests and persisting economy...');
  operationsMonitor.stop();
  if (typeof ledger.stopRetention === 'function') ledger.stopRetention();
  relayClient.disconnect();
  io.disconnectSockets(true);
  io.engine.close();
  const drainedRequests = new Promise(resolve => server.close(resolve));
  await gameEngine.shutdown();
  await drainedRequests;
  presence.shutdown();
  backup.shutdown({ createSnapshot: false });
  await db.flushDurable();
  await ledgerDb.flushDurable();
  await redis.shutdown();
  process.exit(0);
}
function requestShutdown() {
  shutdown().catch(() => {
    console.error('[Mobile Tycoon] Durable shutdown failed; inspect persistence before restart.');
    process.exit(1);
  });
}
process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

// Last-resort crash guards. Word Tycoon is the reward engine for every game,
// so an unhandled throw/rejection in any route handler or timer would otherwise
// take the whole economy down (Node terminates the process on unhandled
// rejection). Log and keep serving instead of exiting.
process.on('unhandledRejection', (reason) => {
  console.error('[Mobile Tycoon] Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Mobile Tycoon] Uncaught exception:', err && err.stack ? err.stack : err);
});
