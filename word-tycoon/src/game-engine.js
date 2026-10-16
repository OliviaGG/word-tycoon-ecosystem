const businesses = require('./businesses');
const cosmetics = require('./cosmetics');
const feedPush = require('./feed-push');
const profileLogos = require('./profile-logos');
const { getIncomeMultiplier } = require('./tax-season');
const presence = require('./presence');

let io = null;
let db = null;
let redis = null;
let batchInterval = null;
let periodicSaveInterval = null;
let currentSession = null;
let sessionPlayerIds = new Set();

// Rate limiting for !tap command
const tapRateLimits = new Map();
const TAP_RATE_LIMIT_MS = parseInt(process.env.TAP_RATE_LIMIT_MS) || 1000;
const BATCH_INTERVAL_MS = parseInt(process.env.BATCH_INTERVAL_MS) || 2000;
const MAX_OFFLINE_SECONDS = (parseInt(process.env.MAX_OFFLINE_HOURS) || 8760) * 3600; // Default: 1 year (8760 hours)
const OFFLINE_INCOME_RATE = 0.10; // Offline players earn at 10% speed
const OFFLINE_THRESHOLD_MS = presence.OFFLINE_THRESHOLD_MS; // Shared source of truth
const DAILY_TIMEZONE = process.env.DAILY_TIMEZONE || 'America/Edmonton';
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const GAME_API_SECRET = process.env.GAME_API_SECRET || '';

// Required daily games for all-dailies bonus loot box
const REQUIRED_DAILY_GAMES = ['word5000', 'betwixt', 'wordle', 'figural', 'pixeletters', 'unwordle', 'rectangled', 'erectangled', 'triangled'];
// Required weekly games for all-weeklies bonus loot box
const REQUIRED_WEEKLY_GAMES = ['subtextle', 'rectangled', 'erectangled', 'spelling-bee', 'wikicontexto'];

const { canonicalGameId, getCanonicalGameVariants } = require('./game-ids');

const DAILY_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function getDailyDateString(date = new Date()) {
  return DAILY_DATE_FORMATTER.format(date);
}

function getNextDailyResetISO(date = new Date()) {
  const zonedNow = new Date(date.toLocaleString('en-US', { timeZone: DAILY_TIMEZONE }));
  const zonedNextMidnight = new Date(zonedNow);
  zonedNextMidnight.setHours(24, 0, 0, 0);
  const msUntilReset = zonedNextMidnight.getTime() - zonedNow.getTime();
  return new Date(date.getTime() + msUntilReset).toISOString();
}

/**
 * Get the Monday of the Edmonton civil week.
 */
function getWeekStart(date) {
  // Date-only inputs are civil dates; instants first resolve in Edmonton.
  const today = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date : DAILY_DATE_FORMATTER.format(date ? new Date(date) : new Date());
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Get ISO week number for a date string (YYYY-MM-DD).
 * Returns 'YYYY-WXX' format.
 */
function getISOWeekString(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Combo tracking (in-memory, per player id)
const comboState = new Map(); // playerId -> { streak, lastBatchTime }
const COMBO_DECAY_MS = 5000; // combo resets after 5 seconds of no tapping

// Frenzy tracking: count unique tappers in a rolling window
const FRENZY_WINDOW_MS = 60000;   // 60-second rolling window
const FRENZY_MAX_MULT = 5.0;      // cap at 5x
const FRENZY_MIN_TAPPERS = 5;     // minimum tappers to activate frenzy
let activeTapperTimestamps = new Map(); // playerId → lastTapTime
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let frenzyEmitter = null;          // callback set by server.js

// Buff cache: refreshed at start of each batch tick
let playerBuffCache = new Map(); // playerId -> buffsObject

// In-memory cache for overlay
let cachedState = {
  topTappers: [],
  topEarners: [],
  playerEmpires: [],
  recentEvents: []
};
let lastEmittedJson = '';

// Data version tracking — increments on state changes so overlay clients
// know when to re-fetch static data (cosmetics, shop, etc.)
let dataVersion = 1;
function bumpDataVersion() {
  dataVersion++;
  if (io) io.emit('data-refresh', { version: dataVersion });
}

let ledger = null;

function initialize(socketIo, database, redisModule, ledgerModule) {
  io = socketIo;
  db = database;
  redis = redisModule;
  ledger = ledgerModule || null;

  // Start a new stream session
  currentSession = db.createSession();
  console.log(`[Engine] Stream session #${currentSession.id} started`);

  // Seed cosmetics catalog into DB
  cosmetics.seedCosmetics(db);

  // Start batch processor. processBatch is async and does extensive DB work; a
  // rejection here would otherwise be unhandled and crash the whole process every
  // tick, so swallow-and-log to keep the heartbeat alive.
  batchInterval = setInterval(() => {
    processBatch().catch(err => console.error('[Engine] processBatch failed:', err && err.stack ? err.stack : err));
  }, BATCH_INTERVAL_MS);
  console.log(`[Engine] Batch processor running every ${BATCH_INTERVAL_MS}ms`);

  // Periodic database save every 30 seconds
  periodicSaveInterval = setInterval(() => db.save(), 30000);

  // Build initial cache
  refreshCache();
}

// Player management

function getOrCreatePlayer(platform, platformUserId, username, displayName, profilePic, country) {
  const player = db.getOrCreatePlayer(platform, platformUserId, username, displayName, profilePic, country);
  if (player) {
    const safePlayerName = player.display_name || player.username || displayName || username || platformUserId;
    // Touch presence on any player contact
    presence.touch(player.id, platform || 'unknown');

    if (!sessionPlayerIds.has(player.id)) {
      sessionPlayerIds.add(player.id);
      if (currentSession) {
        db.updateSessionPlayers(currentSession.id, sessionPlayerIds.size);
      }
      // Log join event for brand new players (total_taps === 0)
      if (player.total_taps === 0) {
        db.logEvent('join', safePlayerName, { platform });
      }
    }
  }
  return player;
}

// Tapping

function canTap(platform, userId) {
  const key = `${platform}:${userId}`;
  const now = Date.now();
  const last = tapRateLimits.get(key) || 0;
  if (now - last < TAP_RATE_LIMIT_MS) return false;
  tapRateLimits.set(key, now);
  return true;
}

async function bufferTaps(platform, userId, count = 1) {
  await redis.bufferTap(platform, userId, count);
}
function isGuestId(userId) {  if (!userId) return true;  const id = String(userId).toLowerCase();  return id.startsWith("web_guest_") ||         id.startsWith("guest_") ||         id.startsWith("wsguest_") ||         id.startsWith("guest-") ||         id.startsWith("anon_");}

async function handleManualTap(platform, platformUserId, username, displayName) {
  if (isGuestId(platformUserId)) {
    return { ok: true, guest: true, message: 'Guest tap (not saved)' };
  }
  if (!canTap(platform, platformUserId)) {
    return { ok: false, message: 'Tap cooldown! (1/sec)' };
  }

  const player = getOrCreatePlayer(platform, platformUserId, username, displayName);
  await redis.bufferTap(platform, platformUserId, 1);
  return { ok: true, message: `Tap! (${player.total_taps + 1} total)` };
}

// Batch processor - the heartbeat
const activeBatches = new Set();
function processBatch() {
  const task = performBatch();
  activeBatches.add(task);
  return task.finally(() => activeBatches.delete(task));
}
async function performBatch() {
  const { tappers, communityTaps } = await redis.flushTaps();
  let dirty = false;

  // Refresh buff cache from equipped cosmetics (single DB query for all players)
  playerBuffCache = cosmetics.getBuffsForAllEquippedPlayers(db);

  // Track per-player income for bubbles: { playerId -> { name, coins } }
  const playerIncome = {};

  if (tappers.length > 0) {
    let totalCoinsThisBatch = 0;
    const now = Date.now();
    const critDef = businesses.getTapUpgradeDef('crit');

    for (const { platform, userId, count } of tappers) {
      const player = db.resolvePlayer(platform, userId);
      if (player) {
        // Touch presence — tapping = definitely online
        presence.touch(player.id, 'tap');

        // Multi-tap: multiply tap count
        const multiTap = player.multi_tap || 1;
        const effectiveTaps = count * multiTap;

        // Combo: update streak
        const combo = comboState.get(player.id) || { streak: 0, lastBatchTime: 0 };
        if (now - combo.lastBatchTime > COMBO_DECAY_MS) {
          combo.streak = effectiveTaps;
        } else {
          combo.streak += effectiveTaps;
        }
        combo.lastBatchTime = now;
        comboState.set(player.id, combo);

        // Get cosmetic buffs for this player
        const buffs = playerBuffCache.get(player.id) || cosmetics.DEFAULT_BUFFS;

        // Combo multiplier with combo_boost: +10% per 10 streak, boosted max
        const maxComboMult = 2.0 * (1 + buffs.combo_boost);
        const comboMultiplier = 1 + Math.min(Math.floor(combo.streak / 10) * 0.1, maxComboMult - 1);

        // Critical tap: multiplier on combo streak
        const critLevel = Math.round((player.crit_chance || 0) / critDef.chancePerLevel);
        const critStreakMult = 1 + critLevel * critDef.comboMultPerLevel;

        // Tap income with tap_boost (crit amplifies the combo portion only)
        const comboWithCrit = 1 + (comboMultiplier - 1) * critStreakMult;
        let coinsEarned = effectiveTaps * player.tap_power * (1 + buffs.tap_boost) * comboWithCrit;

        // Prestige (title) + coin bonus (name_color)
        coinsEarned *= (1 + buffs.prestige) * (1 + buffs.coin_bonus);

        // Lucky bonus (win_effect) — random 2x chance
        if (buffs.lucky_bonus > 0 && Math.random() < buffs.lucky_bonus) {
          coinsEarned *= 2;
        }

        coinsEarned = Math.floor(coinsEarned);
        db.updatePlayerTaps(player.id, effectiveTaps, coinsEarned);
        totalCoinsThisBatch += coinsEarned;

        // Ledger entry for tap income (only for significant amounts to avoid flooding)
        if (ledger && coinsEarned >= 500) {
          const afterTap = db.getPlayerById(player.id);
          ledger.record({
            playerId: player.id,
            playerName: player.display_name || player.username,
            platform: player.platform,
            eventType: 'tap-income',
            command: null,
            coinsBefore: (afterTap ? (afterTap.xp || 0) : 0) - coinsEarned,
            coinsAfter: afterTap ? (afterTap.xp || 0) : coinsEarned,
            success: 1,
            response: null,
            detail: { taps: effectiveTaps, comboStreak: combo ? combo.streak : 0 }
          });
        }

        // Accumulate for bubble
        if (!playerIncome[player.id]) playerIncome[player.id] = { name: player.display_name || player.username, coins: 0, pic: player.profile_pic || null };
        playerIncome[player.id].coins += coinsEarned;
      }
    }

    // Update session
    if (currentSession) {
      db.updateSessionTaps(currentSession.id, communityTaps);
      if (totalCoinsThisBatch > 0) {
        db.updateSessionCoins(currentSession.id, totalCoinsThisBatch);
      }
    }

    dirty = true;
  }

  // Update frenzy: track unique tappers in rolling 60-second window
  const frenzyNow = Date.now();
  for (const { platform, userId } of tappers) {
    const player = db.resolvePlayer(platform, userId);
    if (player) activeTapperTimestamps.set(player.id, frenzyNow);
  }
  for (const [pid, ts] of activeTapperTimestamps) {
    if (frenzyNow - ts > FRENZY_WINDOW_MS) activeTapperTimestamps.delete(pid);
  }
  const frenzyCount = activeTapperTimestamps.size;
  const frenzyMult = frenzyCount < FRENZY_MIN_TAPPERS ? 1.0 : Math.min(2.0 + (frenzyCount - FRENZY_MIN_TAPPERS) * 0.2, FRENZY_MAX_MULT);
  const newFrenzy = { multiplier: parseFloat(frenzyMult.toFixed(1)), activeTappers: frenzyCount };
  if (newFrenzy.multiplier !== currentFrenzy.multiplier || newFrenzy.activeTappers !== currentFrenzy.activeTappers) {
    currentFrenzy = newFrenzy;
    if (frenzyEmitter) frenzyEmitter(currentFrenzy);
    if (io) io.emit('frenzy-update', currentFrenzy);
  }

  // Auto-collect business income for all players
  const { totalIncome: businessIncome, perPlayer: bizPerPlayer } = autoCollectAll();
  if (businessIncome > 0) {
    if (currentSession) {
      db.updateSessionCoins(currentSession.id, businessIncome);
    }
    // Merge business income into bubble data
    for (const [pid, data] of Object.entries(bizPerPlayer)) {
      if (!playerIncome[pid]) playerIncome[pid] = { name: data.name, coins: 0, pic: data.pic || null };
      playerIncome[pid].coins += data.coins;
    }
    dirty = true;
  }

  if (dirty) db.save();

  // Emit income bubbles to overlay
  const bubbles = Object.values(playerIncome).filter(b => b.coins > 0);
  if (bubbles.length > 0 && io) {
    io.emit('income-bubbles', bubbles);
  }

  // Always refresh cache and push to overlay
  refreshCache();
  emitOverlayUpdate();

  // Periodic cleanup: purge stale entries from in-memory Maps to prevent leaks
  const cleanupThreshold = Date.now() - 60000; // 1 minute stale threshold
  for (const [key, lastTime] of tapRateLimits) {
    if (lastTime < cleanupThreshold) tapRateLimits.delete(key);
  }
  for (const [key, state] of comboState) {
    if (state.lastBatchTime < cleanupThreshold) comboState.delete(key);
  }
}

// Businesses with management pages that handle their own income collection.
// These are excluded from passive auto-collect — their revenue comes entirely
// from the management collect button (clean cash, portfolio coins, pizza coins, etc.)
const MANAGED_BUSINESSES = new Set(['newspaper', 'carwash', 'pizza', 'stockmogul', 'gym', 'cinema', 'startup', 'bank']);

function initializeManagedBusinessState(playerId, businessType) {
  switch (businessType) {
    case 'pizza':
      if (db.createPizzaShop) db.createPizzaShop(playerId);
      break;
    case 'newspaper':
      if (db.createNewspaperRoute) db.createNewspaperRoute(playerId);
      break;
    case 'carwash':
      if (db.createCarwashShop) db.createCarwashShop(playerId);
      break;
    case 'stockmogul':
      if (db.createStockMogulPortfolio) db.createStockMogulPortfolio(playerId);
      break;
    case 'gym':
      if (db.createGymClub) db.createGymClub(playerId);
      break;
    case 'cinema':
      if (db.createCinemaTheater) db.createCinemaTheater(playerId);
      break;
    case 'startup':
      if (db.createStartupHub) db.createStartupHub(playerId);
      break;
    case 'bank':
      if (db.createBankVault) db.createBankVault(playerId);
      break;
  }
}

// Auto-collect income from all player businesses every batch tick
function autoCollectAll() {
  const allBiz = db.getAllBusinesses();
  let totalIncome = 0;
  const perPlayer = {}; // playerId -> { name, coins }
  const luckyRolls = {}; // playerId -> boolean (roll once per player per batch)
  const now = Date.now();

  for (const biz of allBiz) {
    // Skip managed businesses — they earn via their management page collect, not auto-collect
    if (MANAGED_BUSINESSES.has(biz.business_type)) continue;

    let effectiveLevel = biz.level;

    // Library level is based on word count, auto-sync it
    if (businesses.isWordUpgrade(biz.business_type)) {
      effectiveLevel = businesses.getLibraryLevel(db.getLinkedLibraryWordCount(biz.player_id));
      if (effectiveLevel !== biz.level) {
        db.setBusinessLevel(biz.id, effectiveLevel);
      }
    }

    const { income, remainder } = businesses.calculatePendingIncome(
      biz.business_type, effectiveLevel, biz.last_collected_at, MAX_OFFLINE_SECONDS
    );
    if (income > 0) {
      // Get cosmetic buffs for this player
      const buffs = playerBuffCache.get(biz.player_id) || cosmetics.DEFAULT_BUFFS;

      // Apply biz_boost (profile_border)
        let adjustedIncome = income * getIncomeMultiplier(biz.player_id) * (1 + buffs.biz_boost);

      // Apply library_boost (hero_badge) — extra income for library business only
      if (businesses.isWordUpgrade(biz.business_type) && buffs.library_boost > 0) {
        adjustedIncome *= (1 + buffs.library_boost);
      }

      // Offline players earn at reduced rate, with offline_boost
      // Phase 2: use centralized presence service instead of stale DB last_seen
      const isOffline = !presence.isOnline(biz.player_id);
      if (isOffline) {
        const boostedOfflineRate = OFFLINE_INCOME_RATE * (1 + buffs.offline_boost);
        adjustedIncome *= boostedOfflineRate;
      }

      // Prestige (title) + coin bonus (name_color)
      adjustedIncome *= (1 + buffs.prestige) * (1 + buffs.coin_bonus);

      // Single floor at end to avoid cumulative precision loss; min 1 for offline
      adjustedIncome = isOffline ? Math.max(1, Math.floor(adjustedIncome)) : Math.floor(adjustedIncome);

      // Lucky bonus (win_effect) — roll once per player per batch for biz income
      if (buffs.lucky_bonus > 0) {
        if (luckyRolls[biz.player_id] === undefined) {
          luckyRolls[biz.player_id] = Math.random() < buffs.lucky_bonus;
        }
        if (luckyRolls[biz.player_id]) adjustedIncome *= 2;
      }

      db.updatePlayerCoins(biz.player_id, adjustedIncome);
      totalIncome += adjustedIncome;
      const newCollectedAt = new Date(now - remainder * 1000).toISOString();
      db.updateBusinessCollectedAt(biz.id, newCollectedAt);

      // Ledger entry for business income (only for significant amounts to avoid flooding)
      if (ledger && adjustedIncome >= 1000) {
        const afterBiz = db.getPlayerById(biz.player_id);
        ledger.record({
          playerId: biz.player_id,
          playerName: biz.player_display_name || 'Player',
          platform: 'system',
          eventType: 'biz-income',
          command: null,
          coinsBefore: (afterBiz ? (afterBiz.xp || 0) : 0) - adjustedIncome,
          coinsAfter: afterBiz ? (afterBiz.xp || 0) : adjustedIncome,
          success: 1,
          response: null,
          detail: { business: biz.business_type, level: biz.level, income: adjustedIncome, offline: isOffline }
        });
      }

      // Track per-player for bubbles
      const pid = String(biz.player_id);
      if (!perPlayer[pid]) perPlayer[pid] = { name: biz.player_display_name || 'Player', coins: 0, pic: biz.player_profile_pic || null };
      perPlayer[pid].coins += adjustedIncome;
    }
  }

  return { totalIncome, perPlayer };
}

// Business operations

function buyBusiness(player, businessAlias) {
  const type = businesses.resolveBusinessType(businessAlias);
  if (!type) {
    const names = businesses.getBusinessList().map(b => b.type).join(', ');
    return { ok: false, message: `Unknown business. Options: ${names}` };
  }

  const existing = db.getPlayerBusiness(player.id, type);
  const def = businesses.getBusinessDef(type);

  // Stock Mogul is purchased with clean cash via the Car Wash management page, not here
  if (type === 'stockmogul') {
    return { ok: false, message: '📈 Stock Mogul is purchased with 💰 clean cash from your Car Wash management page!' };
  }

  // Word-upgraded businesses can't be manually upgraded
  if (existing && businesses.isWordUpgrade(type)) {
    return { ok: false, message: `${def.emoji} ${def.name} levels up as you find unique words across all word games!` };
  }

  if (existing && MANAGED_BUSINESSES.has(type)) {
    return { ok: false, message: `${def.emoji} ${def.name} progresses through its management page now. Open the business to level it up.` };
  }

  const currentLevel = existing ? existing.level : 0;

  // Check max level cap
  if (existing && def.maxLevel && currentLevel >= def.maxLevel) {
    return { ok: false, message: `${def.emoji} ${def.name} is already at max level (${def.maxLevel})!` };
  }

  const cost = businesses.getCost(type, currentLevel);

  // Refresh player data for accurate XP balance
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found.' };

  if ((freshPlayer.xp || 0) < cost) {
    const needed = Math.ceil(cost - (freshPlayer.xp || 0));
    return { ok: false, message: `Need ${formatNumber(cost)} XP for ${def.name} (need ${formatNumber(needed)} more)` };
  }

  let deducted = false;
  try {
    // Free businesses (cost 0, e.g. Library) skip the deduct — deductPlayerCoins
    // rejects amounts <= 0, which used to make them permanently unbuyable.
    deducted = cost > 0 ? db.deductPlayerCoins(freshPlayer.id, cost) : true;
    if (!deducted) {
      return { ok: false, message: `Need ${formatNumber(cost)} XP for ${def.name} (balance changed, try again)` };
    }

    if (existing) {
      db.upgradePlayerBusiness(existing.id);
      const newLevel = currentLevel + 1;
      const ips = businesses.getIncomePerSecond(type, newLevel);
      db.save();
      db.logEvent('levelup', freshPlayer.display_name, { business: def.name, level: newLevel });
      emitTickerEvent('levelup', freshPlayer.display_name, `${def.name} Lv.${newLevel}`);
      feedPush.pushBusinessLevelUp(freshPlayer, def.name, newLevel, def.maxLevel || null);
      refreshCache();
      emitOverlayUpdate(true);
      bumpDataVersion();
      return { ok: true, message: `${def.emoji} ${def.name} upgraded to Lv.${newLevel}! (${formatNumber(ips, 1)}/sec)` };
    } else {
      db.createPlayerBusiness(freshPlayer.id, type);
      if (MANAGED_BUSINESSES.has(type)) initializeManagedBusinessState(freshPlayer.id, type);
      const ips = businesses.getIncomePerSecond(type, 1);
      db.save();
      db.logEvent('buy', freshPlayer.display_name, { business: def.name });
      emitTickerEvent('buy', freshPlayer.display_name, `bought ${def.name}`);
      feedPush.pushBusinessBuy(freshPlayer, def.name);
      refreshCache();
      emitOverlayUpdate(true);
      bumpDataVersion();
      return { ok: true, message: `${def.emoji} ${def.name} purchased! Earning ${formatNumber(ips, 1)} XP/sec` };
    }
  } catch (err) {
    if (deducted && cost > 0) {
      db.updatePlayerCoins(freshPlayer.id, cost);
      db.save();
    }
    console.error(`[Engine] buyBusiness rollback for player ${freshPlayer.id}:`, err.message);
    return { ok: false, message: 'Purchase failed (rolled back). Try again.' };
  }
}

// Tap upgrade operations

function upgradeTap(player, upgradeType) {
  const def = businesses.getTapUpgradeDef(upgradeType);
  if (!def) {
    const list = businesses.getTapUpgradeList().map(u => u.key).join(', ');
    return { ok: false, message: `Unknown upgrade. Options: ${list}` };
  }

  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found.' };

  let currentLevel;
  if (upgradeType === 'tap') currentLevel = freshPlayer.tap_power;
  else if (upgradeType === 'crit') currentLevel = Math.round((freshPlayer.crit_chance || 0) / 0.01);
  else if (upgradeType === 'multi') currentLevel = freshPlayer.multi_tap || 1;

  if (currentLevel >= def.maxLevel) {
    return { ok: false, message: `${def.name} is already at max level (${def.maxLevel})!` };
  }

  const cost = businesses.getTapUpgradeCost(upgradeType, currentLevel);
  if ((freshPlayer.xp || 0) < cost) {
    const needed = Math.ceil(cost - (freshPlayer.xp || 0));
    return { ok: false, message: `Need ${formatNumber(cost)} XP for ${def.name} (need ${formatNumber(needed)} more)` };
  }

  let deducted = false;
  try {
    deducted = db.deductPlayerCoins(freshPlayer.id, cost);
    if (!deducted) {
      return { ok: false, message: `Need ${formatNumber(cost)} XP for ${def.name} (balance changed, try again)` };
    }

    if (upgradeType === 'tap') {
      const newLevel = freshPlayer.tap_power + 1;
      db.setPlayerTapPower(freshPlayer.id, newLevel);
      db.save();
      bumpDataVersion();
      emitTickerEvent('upgrade', freshPlayer.display_name, `Tap Power Lv.${newLevel}`);
      return { ok: true, message: `Tap Power upgraded to Lv.${newLevel}! (${newLevel} XP/tap)` };
    } else if (upgradeType === 'crit') {
      const critDef = businesses.getTapUpgradeDef('crit');
      const newChance = (freshPlayer.crit_chance || 0) + critDef.chancePerLevel;
      db.setPlayerCritChance(freshPlayer.id, newChance);
      db.save();
      bumpDataVersion();
      const newLevel = Math.round(newChance / critDef.chancePerLevel);
      const newMult = (1 + newLevel * critDef.comboMultPerLevel).toFixed(2);
      emitTickerEvent('upgrade', freshPlayer.display_name, `Combo Crit ${newMult}x`);
      return { ok: true, message: `Critical Tap upgraded! Combo multiplier: ${newMult}x` };
    } else if (upgradeType === 'multi') {
      const newLevel = (freshPlayer.multi_tap || 1) + 1;
      db.setPlayerMultiTap(freshPlayer.id, newLevel);
      db.save();
      bumpDataVersion();
      emitTickerEvent('upgrade', freshPlayer.display_name, `Multi-Tap x${newLevel}`);
      return { ok: true, message: `Multi-Tap upgraded to x${newLevel}! Each like counts as ${newLevel} taps` };
    }
  } catch (err) {
    if (deducted) {
      db.updatePlayerXp(freshPlayer.id, cost);
      db.save();
    }
    console.error(`[Engine] upgradeTap rollback for player ${freshPlayer.id}:`, err.message);
    return { ok: false, message: 'Upgrade failed (rolled back). Try again.' };
  }
}

function getComboInfo(player) {
  const combo = comboState.get(player.id) || { streak: 0, lastBatchTime: 0 };
  const now = Date.now();
  const active = (now - combo.lastBatchTime) < COMBO_DECAY_MS;
  const streak = active ? combo.streak : 0;
  // Match the batch processor's combo multiplier calculation (includes combo_boost)
  const buffs = playerBuffCache.get(player.id) || cosmetics.DEFAULT_BUFFS;
  const maxComboMult = 2.0 * (1 + buffs.combo_boost);
  const multiplier = 1 + Math.min(Math.floor(streak / 10) * 0.1, maxComboMult - 1);
  // Crit streak multiplier
  const freshPlayer = db.getPlayerById(player.id);
  const critDef = businesses.getTapUpgradeDef('crit');
  const critLevel = freshPlayer ? Math.round((freshPlayer.crit_chance || 0) / critDef.chancePerLevel) : 0;
  const critStreakMult = 1 + critLevel * critDef.comboMultPerLevel;
  return { streak, multiplier, active, critStreakMult };
}

function getEmpireInfo(player) {
  const playerBiz = db.getPlayerBusinesses(player.id);

  if (playerBiz.length === 0) {
    return {
      ok: true,
      message: `No businesses yet! Type !play to start your empire.`
    };
  }

  let totalIncomePerSec = 0;
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
  const lines = [];

  for (const biz of playerBiz) {
    const def = businesses.getBusinessDef(biz.business_type);
    const ips = businesses.getIncomePerSecond(biz.business_type, biz.level);
    totalIncomePerSec += ips;
    if (def.playtimeUpgrade) {
      const elapsedMs = Date.now() - businesses.parseUTCTimestamp(freshPlayer.created_at);
      const hoursPlayed = elapsedMs / (1000 * 3600);
      const nextLevelHours = biz.level * def.hoursPerLevel;
      const hoursLeft = Math.max(0, nextLevelHours - hoursPlayed);
      lines.push(`${def.emoji} ${def.name} Lv.${biz.level} | ${formatNumber(ips, 1)}/s | Next: ${Math.ceil(hoursLeft)}hrs`);
    } else {
      const nextCost = businesses.getCost(biz.business_type, biz.level);
      lines.push(`${def.emoji} ${def.name} Lv.${biz.level} | ${formatNumber(ips, 1)}/s | Next: ${formatNumber(nextCost)}`);
    }
  }

  // Add buff multiplier info to header
  const buffs = cosmetics.getPlayerBuffs(db, freshPlayer.id);
  const buffParts = [];
  if (buffs.biz_boost > 0) buffParts.push(`+${(buffs.biz_boost * 100).toFixed(0)}% biz`);
  if (buffs.library_boost > 0) buffParts.push(`+${(buffs.library_boost * 100).toFixed(0)}% library`);
  if (buffs.prestige > 0) buffParts.push(`+${(buffs.prestige * 100).toFixed(buffs.prestige * 100 % 1 === 0 ? 0 : 1)}% prestige`);
  if (buffs.coin_bonus > 0) buffParts.push(`+${(buffs.coin_bonus * 100).toFixed(buffs.coin_bonus * 100 % 1 === 0 ? 0 : 1)}% coins`);
  const buffStr = buffParts.length > 0 ? ` (${buffParts.join(', ')})` : '';

  const header = `${formatNumber(freshPlayer.xp || 0)} XP | +${formatNumber(totalIncomePerSec, 1)}/sec${buffStr}`;
  return { ok: true, message: `${header} | ${lines.join(' | ')}` };
}

/**
 * Get a summary of active cosmetic buffs for a player.
 * Returns array of human-readable buff strings.
 */
function getPlayerBuffSummary(player) {
  const buffs = cosmetics.getPlayerBuffs(db, player.id);
  const active = [];
  for (const [type, value] of Object.entries(buffs)) {
    if (value > 0) {
      // Special display for word_reward_2x
      if (type === 'word_reward_2x') {
        active.push('2x Word Reward');
        continue;
      }
      const pct = value * 100;
      const pctStr = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
      active.push(`+${pctStr}% ${cosmetics.BUFF_TYPE_NAMES[type]}`);
    }
  }
  // Append active set bonus labels
  const setBonuses = cosmetics.getActiveSetBonuses(db, player.id);
  for (const sb of setBonuses) {
    active.push(`🧩 ${sb.name} Set: ${sb.label}`);
  }
  return active;
}

// State for overlay

function refreshCache() {
  cachedState.topTappers = db.getTopTappers(5);
  cachedState.topEarners = db.getTopByCoins(5);
  cachedState.playerEmpires = buildPlayerEmpires();
  cachedState.recentEvents = db.getRecentEvents(20).map(e => ({
    type: e.event_type,
    playerName: e.player_name,
    detail: e.detail ? JSON.parse(e.detail) : {},
    timestamp: e.created_at
  }));
}

function buildPlayerEmpires() {
  const playersWithBiz = db.getPlayersWithBusinesses(200);
  const now = Date.now();
  return playersWithBiz.map(p => {
    let totalIncomePerSec = 0;
    const bizList = p.businesses.map(b => {
      const def = businesses.getBusinessDef(b.business_type);
      if (!def) return null;
      const ips = businesses.getIncomePerSecond(b.business_type, b.level);
      totalIncomePerSec += ips;
      return {
        name: def.name,
        emoji: def.emoji,
        level: b.level,
        incomePerSec: ips
      };
    }).filter(Boolean);

    // Apply buffs + offline rate so overlay interpolation matches actual income
    const buffs = playerBuffCache.get(p.id) || cosmetics.DEFAULT_BUFFS;
    // Calculate library IPS share for library_boost
    let libraryIPS = 0;
    if (buffs.library_boost > 0) {
      for (const b of p.businesses) {
        if (businesses.isWordUpgrade(b.business_type)) {
          libraryIPS += businesses.getIncomePerSecond(b.business_type, b.level);
        }
      }
    }
    let effectiveIPS = totalIncomePerSec * (1 + buffs.biz_boost) + libraryIPS * buffs.library_boost;
    const lastSeenMs = p.lastSeen ? businesses.parseUTCTimestamp(p.lastSeen) : 0;
    const isOffline = (now - lastSeenMs) > OFFLINE_THRESHOLD_MS;
    if (isOffline) {
      effectiveIPS *= OFFLINE_INCOME_RATE * (1 + buffs.offline_boost);
    }
    effectiveIPS *= (1 + buffs.prestige) * (1 + buffs.coin_bonus);

    return {
      name: p.name,
      coins: p.coins,
      incomePerSec: effectiveIPS,
      businesses: bizList
    };
  });
}

function getGameState() {
  return {
    ...cachedState,
    dataVersion,
    shopItems: businesses.getBusinessList().map(b => {
      const def = businesses.getBusinessDef(b.type);
      return {
        type: b.type,
        name: b.name,
        emoji: b.emoji,
        cost: b.baseCost,
        incomePerSec: b.baseIncome / b.cycleSeconds,
        playtimeUpgrade: !!def.playtimeUpgrade
      };
    }),
    tapUpgrades: businesses.getTapUpgradeList().map(u => {
      const def = businesses.getTapUpgradeDef(u.key);
      return {
        key: u.key,
        name: u.name,
        desc: u.desc,
        baseCost: def.baseCost,
        maxLevel: u.maxLevel
      };
    })
  };
}

function getLeaderboard(limit = 10) {
  return {
    tappers: db.getTopTappers(limit),
    earners: db.getTopByCoins(limit)
  };
}

// Overlay event emission

function emitOverlayUpdate(force = false) {
  if (!io) return;
  const payload = {
    topTappers: cachedState.topTappers,
    topEarners: cachedState.topEarners,
    playerEmpires: cachedState.playerEmpires,
    dataVersion
  };
  // Skip emission if data hasn't changed (prevents constant DOM rebuilds/twitching)
  if (!force) {
    const json = JSON.stringify(payload);
    if (json === lastEmittedJson) return;
    lastEmittedJson = json;
  } else {
    lastEmittedJson = JSON.stringify(payload);
  }
  io.emit('tap-update', payload);
}

function emitTickerEvent(type, playerName, detail) {
  if (!io) return;
  const event = { type, playerName, detail, timestamp: new Date().toISOString() };
  cachedState.recentEvents.unshift(event);
  if (cachedState.recentEvents.length > 20) cachedState.recentEvents.pop();
  io.emit('ticker-event', event);
}

function emitEvent(eventName, data) {
  if (!io) return;
  io.emit(eventName, data);
}

// TikTok gift handling — every TikTok coin gifted = 2 game XP
const GIFT_COIN_MULTIPLIER = 2;

function handleGift(platform, platformUserId, username, displayName, tiktokCoins) {
  if (!tiktokCoins || tiktokCoins <= 0) return;
  if (isGuestId(platformUserId)) return;

  const player = getOrCreatePlayer(platform, platformUserId, username, displayName);
  if (!player) return;
  const safePlayerName = player.display_name || player.username || displayName || username || platformUserId;

  // Snapshot XP balance before
  const beforePlayer = db.getPlayerById(player.id);
  const coinsBefore = beforePlayer ? (beforePlayer.xp || 0) : 0;
  const giftCoinsBefore = beforePlayer ? (beforePlayer.gift_coins || 0) : 0;

  const gameXp = Math.floor(tiktokCoins * GIFT_COIN_MULTIPLIER);
  db.updatePlayerXp(player.id, gameXp);
  // Track raw TikTok coins as gift_coins for set purchases
  db.updatePlayerGiftCoins(player.id, tiktokCoins);
  db.save();

  // Ledger entry
  if (ledger) {
    const afterPlayer = db.getPlayerById(player.id);
    ledger.record({
      playerId: player.id,
      playerName: safePlayerName,
      platform,
      eventType: 'gift',
      command: null,
      coinsBefore,
      coinsAfter: afterPlayer ? (afterPlayer.xp || 0) : coinsBefore + gameXp,
      giftCoinsBefore,
      giftCoinsAfter: afterPlayer ? (afterPlayer.gift_coins || 0) : giftCoinsBefore + tiktokCoins,
      success: 1,
      response: null,
      detail: { tiktokCoins, gameXp, currency: 'xp' }
    });
  }

  const detail = `gifted ${formatNumber(tiktokCoins)} TikTok coins -> earned ${formatNumber(gameXp)} XP!`;
  db.logEvent('gift', safePlayerName, { tiktokCoins, gameXp });
  emitTickerEvent('gift', safePlayerName, detail);
  refreshCache();
  emitOverlayUpdate(true);

  console.log(`[Gift] ${safePlayerName} gifted ${tiktokCoins} TikTok coins → +${gameXp} XP (gift balance: +${tiktokCoins})`);
}

// Word game rewards

/**
 * Check if a player has completed all required daily games and award loot box if so.
 * Aggregates completions across all linked player IDs.
 * Returns the generated cosmetic result or null.
 */
function checkAndAwardDailyLootBox(player, today) {
  try {
    const allIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
    const allCompletions = new Set();
    for (const pid of allIds) {
      const completions = db.getDailyCompletions(pid, today);
      for (const c of completions) {
        allCompletions.add(canonicalGameId(c.game) || c.game);
      }
    }

    // Check if all required games are completed
    if (!REQUIRED_DAILY_GAMES.every(g => allCompletions.has(g))) {
      return null;
    }

    // Award loot box of 3 items (checks for duplicate internally)
    const result = cosmetics.generateAndAwardLootBoxMulti(db, player.id, today + ':daily', 3);
    return result;
  } catch (err) {
    console.error(`[LootBox] Error checking/awarding for player ${player.id}:`, err.message);
    return null;
  }
}

/**
 * Check if ALL required weekly games are completed this week.
 * If so, awards a bonus 3-item loot box.
 */
function checkAndAwardWeeklyAllGamesBox(player, weekStart) {
  try {
    const allIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
    const allCompletions = new Set();
    for (const pid of allIds) {
      const completions = db.getWeeklyCompletions ? db.getWeeklyCompletions(pid, weekStart) : [];
      for (const c of completions) {
        allCompletions.add(canonicalGameId(c.game) || c.game);
      }
    }

    if (!REQUIRED_WEEKLY_GAMES.every(g => allCompletions.has(g))) {
      return null;
    }

    const weekStr = getISOWeekString(weekStart);
    const result = cosmetics.generateAndAwardLootBoxMulti(db, player.id, weekStr + ':weekly-all', 3);
    if (result) {
      console.log(`[Weekly] ${player.display_name || player.username} awarded ALL-WEEKLIES bonus loot box (week ${weekStart})`);
    }
    return result;
  } catch (err) {
    console.error(`[Weekly] Error checking all-weeklies for player ${player.id}:`, err.message);
    return null;
  }
}

/**
 * Check if a player has already received an MP loot box for this game today.
 * If not, award 3-item loot box. Aggregates across linked accounts for dedup.
 */
function checkAndAwardMPLootBox(player, game, today) {
  try {
    const dateKey = today + ':mp:' + game;

    // Check all linked accounts for existing MP loot box
    const allIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
    for (const pid of allIds) {
      if (db.hasGeneratedCosmeticForDate(pid, dateKey + ':0')) {
        return null;
      }
    }

    // Award loot box of 3 items
    const result = cosmetics.generateAndAwardLootBoxMulti(db, player.id, dateKey, 3);
    if (result) {
      console.log(`[MPLootBox] ${player.display_name || player.username} awarded ${result.length} MP cosmetics for ${game}`);
    }
    return result;
  } catch (err) {
    console.error(`[MPLootBox] Error for player ${player.id}:`, err.message);
    return null;
  }
}

/**
 * Check if a player has already completed this week's challenge for a game,
 * aggregating across all linked player IDs. If not, record the completion
 * and award a procedurally generated cosmetic.
 */
function checkAndAwardWeeklyCosmetic(player, game, weekStart) {
  try {
    const canonical = canonicalGameId(game) || game;
    const variants = getCanonicalGameVariants(canonical);

    // Check all linked accounts for existing weekly completion (any legacy variant)
    const allIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
    for (const pid of allIds) {
      for (const variant of variants) {
        if (db.hasWeeklyCompletion(pid, variant, weekStart)) {
          console.log(`[Weekly] Player ${player.id} (linked ${pid}) already completed ${canonical} for week ${weekStart}`);
          return null;
        }
      }
    }

    // Record weekly completion under canonical ID
    db.recordWeeklyCompletion(player.id, canonical, weekStart, 0);

    // Build a unique cosmetic date string: "YYYY-WXX:game" so each game gives separate cosmetic
    const weekStr = getISOWeekString(weekStart);
    const cosmeticDate = `${weekStr}:${game}`;

    // Award loot box of 3 items using the same procedural system as daily loot box
    const result = cosmetics.generateAndAwardLootBoxMulti(db, player.id, cosmeticDate, 3);
    if (result) {
      console.log(`[Weekly] ${player.display_name || player.username} awarded ${result.length} weekly cosmetics for ${game} (week ${weekStart})`);
    }
    return result;
  } catch (err) {
    console.error(`[Weekly] Error checking/awarding for player ${player.id}:`, err.message);
    return null;
  }
}

// ==================== DAILY CLAIM + STREAK ====================

const BASE_CLAIM_XP = 150;
const CLAIM_SCALING = 0.25;
const CLAIM_XP_CAP = 500;
const COSMETIC_CHANCE = 0.20;
const CYCLE_LENGTH = 30;
// Per-user mutex: prevents concurrent double-claim between async requests
const claimInProgress = new Set();
const MILESTONE_CONFIG = {
  3:  { bonusXp: 500,    cosmeticCount: 1, rarityFloor: 'uncommon', lootBoxCount: 0 },
  7:  { bonusXp: 1500,   cosmeticCount: 0, rarityFloor: 'rare',    lootBoxCount: 3, titleKey: 'day7', titleName: 'Weekly Warrior' },
  14: { bonusXp: 3000,   cosmeticCount: 0, rarityFloor: 'rare',    lootBoxCount: 5 },
  30: { bonusXp: 10000,  cosmeticCount: 0, rarityFloor: 'epic',    lootBoxCount: 5, titleKey: 'day30', titleName: 'Monthly Legend' },
};

function getDailyToday() {
  return getDailyDateString(new Date());
}

function hasLinkedDailyCompletion(player, game, today) {
  const canonical = canonicalGameId(game) || game;
  const variants = getCanonicalGameVariants(canonical);
  const allIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
  for (const pid of allIds) {
    for (const variant of variants) {
      if (db.hasDailyCompletion(pid, variant, today)) {
        return true;
      }
    }
  }
  return false;
}

function getDailyYesterday() {
  return getDailyDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

function getDailyTwoDaysAgo() {
  return getDailyDateString(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function getNextDailyMidnightISO() {
  return getNextDailyResetISO(new Date());
}

/**
 * Compute scaled claim XP based on player's progression tier.
 */
function computeClaimXP(progressionMult) {
  const log2Val = progressionMult > 1 ? Math.log2(progressionMult) : 0;
  const scaled = Math.floor(BASE_CLAIM_XP * (1 + CLAIM_SCALING * log2Val));
  return Math.min(scaled, CLAIM_XP_CAP);
}

/**
 * Get the business tier label for display.
 */
function getProgressionTierLabel(progressionMult) {
  if (progressionMult >= 250) return 'Space';
  if (progressionMult >= 150) return 'Bank';
  if (progressionMult >= 100) return 'Startup';
  if (progressionMult >= 60)  return 'Cinema';
  if (progressionMult >= 30)  return 'Gym';
  if (progressionMult >= 15)  return 'Arcade';
  if (progressionMult >= 8)   return 'Pizza';
  if (progressionMult >= 6)   return 'Stock Mogul';
  if (progressionMult >= 4)   return 'Car Wash';
  if (progressionMult >= 2)   return 'Newspaper';
  if (progressionMult > 1)    return 'Library';
  return 'None';
}

/**
 * Get daily claim status for a user (portal loads this on init).
 */
function getDailyClaimStatus(discordUserId) {
  const today = getDailyToday();
  const state = db.getStreakState(discordUserId);
  const alreadyClaimed = db.hasDailyClaim(discordUserId, today);

  // Compute preview XP
  const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
  let progressionMult = 1;
  if (player) {
    const playerBiz = db.getPlayerBusinesses(player.id);
    progressionMult = businesses.getProgressionMultiplier(playerBiz);
  }
  const previewXp = computeClaimXP(progressionMult);
  const tierLabel = getProgressionTierLabel(progressionMult);

  // Determine current streak (accounting for potential break)
  let currentStreak = 0;
  let longestStreak = 0;
  let totalClaims = 0;
  let milestoneHistory = [];
  const ownedProfileLogoIds = db.getOwnedProfileLogoIds ? db.getOwnedProfileLogoIds(discordUserId) : [];

  if (state) {
    currentStreak = state.current_streak;
    longestStreak = state.longest_streak;
    totalClaims = state.total_claims;

    // If last claim was more than 2 days ago, streak is already broken
    if (state.last_claim_date && state.last_claim_date !== today) {
      const daysSince = daysBetween(state.last_claim_date, today);
      if (daysSince > 3) {
        currentStreak = 0; // Streak broken — will start fresh on next claim
      }
    }

    try { milestoneHistory = Object.keys(JSON.parse(state.milestone_titles_awarded || '{}')); } catch (e) {}
  }

  // Compute next milestone using cycle day (milestones repeat every 30 days)
  const nextStreakDay = alreadyClaimed ? currentStreak : currentStreak + 1;
  const nextCycleDay = ((nextStreakDay - 1) % CYCLE_LENGTH) + 1;
  let nextMilestone = null;
  for (const day of [3, 7, 14, 30]) {
    if (day >= nextCycleDay) {
      const daysAway = day - nextCycleDay;
      nextMilestone = { day, daysAway, bonusXp: MILESTONE_CONFIG[day].bonusXp, lootBoxItems: MILESTONE_CONFIG[day].lootBoxCount || MILESTONE_CONFIG[day].cosmeticCount };
      break;
    }
  }

  return {
    canClaim: !alreadyClaimed,
    currentStreak: alreadyClaimed ? currentStreak : (state?.last_claim_date === getDailyYesterday() ? currentStreak : 0),
    longestStreak,
    lastClaimDate: state?.last_claim_date || null,
    totalClaims,
    todayDate: today,
    previewXp: { scaled: previewXp, tierLabel },
    cosmeticChance: COSMETIC_CHANCE,
    nextMilestone,
    nextProfileLogoUnlock: profileLogos.getNextDailyClaimUnlock(totalClaims, ownedProfileLogoIds),
    milestoneHistory,
    nextClaimAt: alreadyClaimed ? getNextDailyMidnightISO() : null
  };
}

/**
 * Grant +1 hint for a daily claim. Fires-and-forgets so the daily claim itself
 * never fails if Chat Relay is temporarily unreachable.
 */
function grantDailyHint(discordUserId) {
  if (!discordUserId || !GAME_API_SECRET) return;
  fetch(`${CHAT_RELAY_URL}/api/internal/hints/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': GAME_API_SECRET },
    body: JSON.stringify({ discordId: discordUserId, hints: 1, sourceMonth: 'daily-claim' })
  })
    .then((r) => {
      if (!r.ok) console.error(`[DailyClaim] hint grant failed: HTTP ${r.status} for ${discordUserId}`);
      else console.log(`[DailyClaim] granted 1 hint to ${discordUserId}`);
    })
    .catch((err) => console.error('[DailyClaim] hint grant error:', err.message));
}

/**
 * Process a daily claim for a user. Returns the full result.
 *
 * Title milestone policy (DECIDED — once ever, not per cycle):
 *   Day-7 "Weekly Warrior" and Day-30 "Monthly Legend" are awarded ONCE EVER per user.
 *   milestone_titles_awarded is intentionally never reset on 30-day cycle wrap.
 *   Subsequent cycles still award normal milestone XP, loot boxes, and cosmetics — just not duplicate titles.
 */
function processDailyClaim(discordUserId) {
  const today = getDailyToday();

  // Already claimed?
  if (db.hasDailyClaim(discordUserId, today)) {
    const state = db.getStreakState(discordUserId);
    return {
      ok: true,
      claimed: false,
      alreadyClaimed: true,
      streakDay: state?.current_streak || 0,
      nextClaimAt: getNextDailyMidnightISO()
    };
  }

  // Per-user lock: block concurrent requests from the same user
  if (claimInProgress.has(discordUserId)) {
    return { ok: false, error: 'Claim already in progress, please try again' };
  }
  claimInProgress.add(discordUserId);

  try {
    // Resolve player
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return { ok: false, error: 'Account linking required' };
    presence.touch(player.id, 'daily-claim');

    // Get progression mult
    const playerBiz = db.getPlayerBusinesses(player.id);
    const progressionMult = businesses.getProgressionMultiplier(playerBiz);

    // Get current streak state
    const state = db.getStreakState(discordUserId);
    const yesterday = getDailyYesterday();

    // Determine new streak (true consecutive count, never wraps)
    // 2-day grace window: can miss up to 2 days and still continue
    let newStreak;
    if (!state || !state.last_claim_date) {
      newStreak = 1; // First claim ever
    } else if (state.last_claim_date === today) {
      // Safety: hasDailyClaim check above should have caught this
      return { ok: true, claimed: false, alreadyClaimed: true, streakDay: state.current_streak, nextClaimAt: getNextDailyMidnightISO() };
    } else {
      const daysSince = daysBetween(state.last_claim_date, today);
      if (daysSince <= 3) {
        newStreak = (state.current_streak || 0) + 1; // Continue streak (within grace window)
      } else {
        newStreak = 1; // Streak broken
      }
    }

    // Compute XP
    const scaledXp = computeClaimXP(progressionMult);
    let totalXp = scaledXp;

    // Milestones repeat every 30 days using cycle day
    const cycleDay = ((newStreak - 1) % CYCLE_LENGTH) + 1;
    const milestoneConf = MILESTONE_CONFIG[cycleDay] || null;
    let milestoneResult = null;
    let isMilestone = false;
    let milestoneType = null;

    if (milestoneConf) {
      isMilestone = true;
      milestoneType = 'day' + newStreak;
      totalXp += milestoneConf.bonusXp;
      milestoneResult = { type: milestoneType, bonusXp: milestoneConf.bonusXp };
    }

    // Record the claim FIRST — this is the authoritative duplicate guard.
    // insertDailyClaim returns false if the UNIQUE constraint fires (duplicate).
    // All awards happen AFTER this succeeds, so duplicates never receive anything.
    const claimInserted = db.insertDailyClaim(discordUserId, today, totalXp, newStreak, isMilestone, milestoneType, false, progressionMult);
    if (!claimInserted) {
      db.save();
      console.warn(`[DailyClaim] DUPLICATE blocked for ${discordUserId} on ${today} despite lock — no awards issued`);
      const existingState = db.getStreakState(discordUserId);
      return { ok: true, claimed: false, alreadyClaimed: true, streakDay: existingState?.current_streak || 0, nextClaimAt: getNextDailyMidnightISO() };
    }

    // --- All awards below this line: claim is already recorded, no dupe risk ---

    // Milestone awards
    if (milestoneConf) {
      // Award loot box if configured
      if (milestoneConf.lootBoxCount > 0) {
        const dateKey = today + ':claim-milestone:' + milestoneType;
        const lootBox = cosmetics.generateAndAwardLootBoxMulti(db, player.id, dateKey, milestoneConf.lootBoxCount, milestoneConf.rarityFloor);
        if (lootBox) milestoneResult.lootBox = lootBox;
      }

      // Award single milestone cosmetic if configured
      if (milestoneConf.cosmeticCount > 0 && !milestoneConf.lootBoxCount) {
        const dateKey = today + ':claim-milestone:' + milestoneType;
        const item = cosmetics.generateAndAwardLootBox(db, player.id, dateKey, milestoneConf.rarityFloor);
        if (item) milestoneResult.cosmetic = item;
      }

      // Award title cosmetic (once-ever — skips if already in milestone_titles_awarded)
      if (milestoneConf.titleKey) {
        let titlesAwarded = {};
        try { titlesAwarded = JSON.parse(state?.milestone_titles_awarded || '{}'); } catch (e) {}
        if (!titlesAwarded[milestoneConf.titleKey]) {
          const titleDateKey = 'claim-title:' + milestoneConf.titleKey;
          const titleSeed = cosmetics.generateSeed(player.id, titleDateKey);
          const titleCosmetic = cosmetics.generateFromSeed(titleSeed, milestoneConf.rarityFloor);
          titleCosmetic.category = 'title';
          titleCosmetic.name = milestoneConf.titleName;
          const stored = db.insertGeneratedCosmetic(player.id, titleCosmetic.id, titleCosmetic.seed, 'title', titleCosmetic.rarity, milestoneConf.titleName, titleDateKey, titleCosmetic.cssJson);
          if (stored) {
            milestoneResult.titleCosmetic = titleCosmetic;
            titlesAwarded[milestoneConf.titleKey] = true;
          }
        }
      }
    }

    // Normal cosmetic drop (20% chance)
    let cosmeticDrop = null;
    const cosmeticRoll = Math.random();
    if (cosmeticRoll < COSMETIC_CHANCE) {
      const dateKey = today + ':claim-daily';
      cosmeticDrop = cosmetics.generateAndAwardLootBox(db, player.id, dateKey);
    }

    // Update the claim record with cosmetic drop status (non-critical — claim is already safe)
    if (cosmeticDrop) {
      try { db.run('UPDATE daily_claims SET cosmetic_awarded = 1 WHERE discord_user_id = ? AND claim_date = ?', [discordUserId, today]); } catch (e) {}
    }

    // Credit Word Tycoon XP
    db.updatePlayerXp(player.id, totalXp);

    // Update streak state
    const longestStreak = Math.max(state?.longest_streak || 0, newStreak);
    const totalClaims = (state?.total_claims || 0) + 1;
    const totalXpFromClaims = (state?.total_xp_from_claims || 0) + totalXp;
    const ownedProfileLogoIds = db.getOwnedProfileLogoIds ? db.getOwnedProfileLogoIds(discordUserId) : [];
    const unlockedProfileLogos = [];
    for (const profileLogo of profileLogos.getDailyClaimUnlocks(totalClaims, ownedProfileLogoIds)) {
      if (!db.grantProfileLogo) break;
      const grant = db.grantProfileLogo(discordUserId, profileLogo.id, 'daily_claim');
      if (grant.ok && grant.granted) {
        unlockedProfileLogos.push(profileLogo);
      }
    }
    let titlesAwarded = {};
    try { titlesAwarded = JSON.parse(state?.milestone_titles_awarded || '{}'); } catch (e) {}
    if (milestoneConf?.titleKey && milestoneResult?.titleCosmetic) {
      titlesAwarded[milestoneConf.titleKey] = true;
    }
    db.upsertStreakState(discordUserId, newStreak, longestStreak, today, totalClaims, totalXpFromClaims, JSON.stringify(titlesAwarded));

    db.save();

    // Daily login reward: +1 hint (rolled-over balance, never expires).
    grantDailyHint(discordUserId);

    // Ledger audit entry — daily claim XP visible alongside other coin events
    if (ledger) {
      const afterPlayer = db.getPlayerById(player.id);
      ledger.record({
        playerId: player.id,
        playerName: player.display_name || player.username,
        platform: player.platform,
        eventType: 'daily-claim',
        command: null,
        coinsBefore: afterPlayer ? (afterPlayer.xp || 0) - totalXp : 0,
        coinsAfter: afterPlayer ? (afterPlayer.xp || 0) : totalXp,
        success: 1,
        response: null,
        detail: { streakDay: newStreak, scaledXp, milestoneXp: milestoneConf ? milestoneConf.bonusXp : 0, cosmeticDrop: !!cosmeticDrop, isMilestone, currency: 'xp' }
      });
    }

    // Compute next milestone for response
    let nextMilestone = null;
    for (const day of [3, 7, 14, 30]) {
      if (day > newStreak) {
        nextMilestone = { day, daysAway: day - newStreak };
        break;
      }
    }

    const result = {
      ok: true,
      claimed: true,
      streakDay: newStreak,
      xp: totalXp,
      xpBreakdown: { scaled: scaledXp, milestone: milestoneConf ? milestoneConf.bonusXp : 0 },
      progressionMult: Math.round(progressionMult * 100) / 100,
      tierLabel: getProgressionTierLabel(progressionMult),
      cosmeticDrop: cosmeticDrop || null,
      milestone: milestoneResult,
      profileLogosUnlocked: unlockedProfileLogos,
      nextProfileLogoUnlock: profileLogos.getNextDailyClaimUnlock(
        totalClaims,
        (db.getOwnedProfileLogoIds ? db.getOwnedProfileLogoIds(discordUserId) : [])
      ),
      nextMilestone
    };

    console.log(`[DailyClaim] ${discordUserId} claimed day ${newStreak} — ${totalXp} XP (${scaledXp} scaled + ${milestoneConf ? milestoneConf.bonusXp : 0} milestone), cosmetic: ${!!cosmeticDrop}, milestone: ${milestoneType || 'none'}`);

    return result;

  } finally {
    claimInProgress.delete(discordUserId);
  }
}

// ── Progress Summary Builder ────────────────────────────────────────────────
// Returns a progressSummary object for the post-game progress card,
// or null if nothing meaningful happened (server-side suppression).

const GAME_LABELS = {
  wordle: 'Wordle', betwixt: 'Betwixt', word5000: 'Word5000',
  'spelling-bee': 'Spelling Bee', pixeletters: 'PixeLetters', subtextle: 'Subtextle',
  rectangled: 'recTangled', erectangled: 'erecTangled', sproutle: 'erecTangled', unwordle: 'UnWordle',
  figural: 'Figural', triangled: 'Triangled', wikicontexto: 'WikiContexto', wikirectangled: 'WikirecTangled',
  wordfall: 'Wordfall'
};

function buildProgressSummary({ player, platform, platformUserId, game, event, boostedCoins, isDailyWin, today, singleCosmeticResult, lootBoxResult, weeklyResult, weeklyAllResult }) {
  const summary = {};

  // 1. Reward earned (for win events including MP variants)
  const PROGRESS_WIN_EVENTS = new Set(['win', 'daily-win', 'weekly-win', 'jackpot-win', 'jackpot', 'mp-daily-win', 'mp-weekly-win']);
  if (boostedCoins > 0 && PROGRESS_WIN_EVENTS.has(event)) {
    summary.reward = { xp: boostedCoins, label: '+' + formatNumber(boostedCoins) + ' XP' };
  }

  // 2. Daily progress delta
  const gameLabel = GAME_LABELS[game] || game;
  if (isDailyWin) {
    // This reward just completed a daily — show it
    const allIds = getAllLinkedPlayerIds(platform, platformUserId);
    const allCompletions = new Set();
    for (const pid of allIds) {
      for (const c of db.getDailyCompletions(pid, today)) allCompletions.add(c.game);
    }
    const done = allCompletions.size;
    const total = REQUIRED_DAILY_GAMES.length;
    if (done >= total) {
      summary.daily = { game, completed: true, progress: done + '/' + total, label: 'All ' + total + ' dailies cleared!' };
    } else {
      summary.daily = { game, completed: false, progress: done + '/' + total, label: 'Daily ' + gameLabel + ' \u2713 \u00b7 ' + done + '/' + total };
    }
  }

  // 3. Weekly progress delta
  if (event === 'weekly-win' || event === 'mp-weekly-win') {
    const weekStart = getWeekStart();
    const allIds = getAllLinkedPlayerIds(platform, platformUserId);
    const allCompletions = new Set();
    for (const pid of allIds) {
      const comps = db.getWeeklyCompletions ? db.getWeeklyCompletions(pid, weekStart) : [];
      for (const c of comps) allCompletions.add(c.game);
    }
    const done = allCompletions.size;
    const total = REQUIRED_WEEKLY_GAMES.length;
    if (done >= total) {
      summary.weekly = { current: done, target: total, label: 'All weeklies complete!' };
    } else {
      summary.weekly = { current: done, target: total, label: 'Weekly: ' + done + '/' + total + ' games' };
    }
  }

  // 4. Streak milestone proximity (only for linked/discord users)
  let discordUserId = platform === 'discord' ? platformUserId : db.getDiscordUserForPlatform(platform, platformUserId);
  if (discordUserId) {
    const streak = db.getStreakState(discordUserId);
    if (streak && streak.current_streak > 0) {
      const nextStreakDay = streak.current_streak + 1; // what tomorrow's claim would be
      for (const day of [3, 7, 14, 30]) {
        if (day >= nextStreakDay) {
          const daysAway = day - nextStreakDay;
          if (daysAway <= 5) { // only show when close
            const milestoneLabel = daysAway === 0
              ? 'Streak milestone tomorrow!'
              : daysAway + ' day' + (daysAway > 1 ? 's' : '') + ' to day ' + day + ' milestone';
            summary.milestone = { type: 'streak', current: streak.current_streak, target: day, label: milestoneLabel };
          }
          break;
        }
      }
    }
  }

  // 5. Next action — suggest first incomplete daily
  if (isDailyWin || event === 'daily-win' || event === 'mp-daily-win') {
    const allIds = getAllLinkedPlayerIds(platform, platformUserId);
    const allCompletions = new Set();
    for (const pid of allIds) {
      for (const c of db.getDailyCompletions(pid, today)) allCompletions.add(c.game);
    }
    const remaining = REQUIRED_DAILY_GAMES.filter(g => !allCompletions.has(g));
    if (remaining.length > 0 && remaining.length < REQUIRED_DAILY_GAMES.length) {
      const nextGame = remaining[0];
      const nextLabel = GAME_LABELS[nextGame] || nextGame;
      summary.nextAction = { type: 'daily', game: nextGame, label: 'Try today\u2019s ' + nextLabel };
    }
  }

  // 6. Cosmetic award callout (pick the most notable one)
  const cosmeticItems = [
    ...(singleCosmeticResult || []),
    ...(lootBoxResult || []),
    ...(weeklyResult || []),
    ...(weeklyAllResult || [])
  ];
  if (cosmeticItems.length > 0) {
    // Pick highest rarity
    const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ultra'];
    const best = cosmeticItems.reduce((a, b) =>
      rarityOrder.indexOf(b.rarity) > rarityOrder.indexOf(a.rarity) ? b : a
    );
    summary.cosmetic = { awarded: true, name: best.name, rarity: best.rarity, category: best.category };
  }

  // Suppression gate: omit if nothing meaningful
  if (Object.keys(summary).length === 0) return null;
  // Suppress reward-only cards for non-win events (per-word XP, etc.)
  if (Object.keys(summary).length === 1 && summary.reward && !PROGRESS_WIN_EVENTS.has(event)) return null;

  return summary;
}

function handleReward(platform, platformUserId, username, displayName, coins, game, event, guessCount, word, durationSeconds, rewardContext = {}) {
  if (!coins || coins <= 0) return { ok: false, message: 'Invalid XP amount' };
  // Normalize legacy game IDs to canonical IDs (Searchle -> Subtextle, etc.)
  game = canonicalGameId(game) || game;
  if (isGuestId(platformUserId)) {
    return { ok: true, guest: true, coinsAwarded: coins, newBalance: 0 };
  }

  const player = getOrCreatePlayer(platform, platformUserId, username, displayName);
  if (!player) return { ok: false, message: 'Could not find or create player' };
  const safePlayerName = player.display_name || player.username || displayName || username || platformUserId;

  // Snapshot XP balance before
  const beforePlayer = db.getPlayerById(player.id);
  const coinsBefore = beforePlayer ? (beforePlayer.xp || 0) : 0;

  // Apply word_game_boost from equipped Word Glow cosmetics
  const buffs = playerBuffCache.get(player.id) || cosmetics.DEFAULT_BUFFS;
  let boostedCoins = Math.floor(coins * (1 + (buffs.word_game_boost || 0)));

  // AUX word_reward_2x: double word reward income
  if (buffs.word_reward_2x > 0) {
    boostedCoins = Math.floor(boostedCoins * (1 + buffs.word_reward_2x));
  }

  // Prestige (title) + coin bonus (name_color) — "All Income" and "All Coins" apply everywhere
  boostedCoins = Math.floor(boostedCoins * (1 + (buffs.prestige || 0)) * (1 + (buffs.coin_bonus || 0)));

  // Frenzy multiplier: applied locally in each game server before sending rewards.
  // Do NOT apply here — games already send frenzy-multiplied amounts.

  // Progression multiplier: scale based on highest owned business tier
  const playerBiz = db.getPlayerBusinesses(player.id);
  const progressionMult = businesses.getProgressionMultiplier(playerBiz);
  if (progressionMult > 1) {
    boostedCoins = Math.floor(boostedCoins * progressionMult);
  }

  // Daily multiplier: 3x for daily-win events (once per player per game per day)
  const DAILY_MULTIPLIER = 3;
  let isDailyWin = false;
  let lootBoxResult = null;
  let singleCosmeticResult = null;
  const today = rewardContext.period || getDailyToday();
  let afterPlayer = null;

  let weeklyResult = null;
  let weeklyAllResult = null;

  // Lucky bonus (win_effect) — random 2x chance
  let luckyHit = false;
  if (buffs.lucky_bonus > 0 && Math.random() < buffs.lucky_bonus) {
    boostedCoins *= 2;
    luckyHit = true;
  }

  // The total cap includes the once-per-period daily bonus. Apply it
  // again after that bonus, before recording completion XP or crediting XP.
  const configuredCap = parseInt(process.env.MAX_TOTAL_MULTIPLIER, 10);
  const MAX_TOTAL_MULT = Number.isSafeInteger(configuredCap) && configuredCap > 0 ? configuredCap : 1500;
  const capReward = amount => Math.min(amount, Math.floor(coins * MAX_TOTAL_MULT));
  boostedCoins = capReward(boostedCoins);

  db.withTransactionSync(() => {
    // SP Daily win: 1 cosmetic + 3x coins + check all-dailies bonus
    if (event === 'daily-win') {
      if (!hasLinkedDailyCompletion(player, game, today)) {
        boostedCoins = capReward(Math.floor(boostedCoins * DAILY_MULTIPLIER));
        isDailyWin = true;
        db.recordDailyCompletion(player.id, game, today, boostedCoins);

        // Award 1 cosmetic for this game's daily win (was 3)
        singleCosmeticResult = cosmetics.generateAndAwardLootBoxMulti(db, player.id, today + ':sp:' + game, 1);

        // Check if all required daily games complete → bonus 3-item loot box
        lootBoxResult = checkAndAwardDailyLootBox(player, today);
      }
    }

    // MP Daily win: 1 loot box (3 items) + 3x coins + check all-dailies bonus
    if (event === 'mp-daily-win') {
      if (!hasLinkedDailyCompletion(player, game, today)) {
        boostedCoins = capReward(Math.floor(boostedCoins * DAILY_MULTIPLIER));
        isDailyWin = true;
        db.recordDailyCompletion(player.id, game, today, boostedCoins);

        // Award 3-item loot box for MP daily win
        singleCosmeticResult = cosmetics.generateAndAwardLootBoxMulti(db, player.id, today + ':mp:' + game, 3);

        // Check if all required daily games complete → bonus loot box
        lootBoxResult = checkAndAwardDailyLootBox(player, today);
      }
    }

    // SP Weekly win: 1 loot box (3 items) + check all-weeklies bonus
    if (event === 'weekly-win' || event === 'mp-weekly-win') {
      const weekStart = rewardContext.period || getWeekStart();
      weeklyResult = checkAndAwardWeeklyCosmetic(player, game, weekStart);
      // Check if all required weekly games complete → bonus loot box
      weeklyAllResult = checkAndAwardWeeklyAllGamesBox(player, weekStart);
    }

    db.updatePlayerXp(player.id, boostedCoins);
    db.updatePlayerWordGameXp(player.id, boostedCoins);

    // Record in game_wins table for win events only (not per-word rewards)
    if (db.isWinEvent(event)) {
      db.recordGameWin(
        player.id,
        game,
        event,
        Number.isFinite(guessCount) ? guessCount : null,
        word || null,
        boostedCoins,
        Number.isFinite(durationSeconds) ? durationSeconds : null
      );
    }

    db.save();
    afterPlayer = db.getPlayerById(player.id);
  });

  // Ledger entry
  if (ledger) {
    ledger.record({
      playerId: player.id,
      playerName: safePlayerName,
      platform,
      eventType: 'reward',
      command: null,
      coinsBefore,
      coinsAfter: afterPlayer ? (afterPlayer.xp || 0) : coinsBefore + boostedCoins,
      giftCoinsBefore: null,
      giftCoinsAfter: null,
      success: 1,
      response: null,
      detail: { game, event, baseXp: coins, boostedXp: boostedCoins, luckyHit, progressionMult, isDailyWin, currency: 'xp' }
    });
  }

  const boostParts = [];
  if (buffs.word_game_boost > 0) boostParts.push(`+${Math.round(buffs.word_game_boost * 100)}%`);
  if (buffs.word_reward_2x > 0) boostParts.push('2x AUX');
  if (buffs.prestige > 0) boostParts.push(`+${Math.round(buffs.prestige * 100)}% prestige`);
  if (buffs.coin_bonus > 0) boostParts.push(`+${Math.round(buffs.coin_bonus * 100)}% coins`);
  if (progressionMult > 1) boostParts.push(`${progressionMult}x progression`);
  if (isDailyWin) boostParts.push('3x DAILY');
  if (luckyHit) boostParts.push('LUCKY 2x!');
  const boostNote = boostParts.length > 0 ? ` (${boostParts.join(' + ')})` : '';
  const detail = `earned ${formatNumber(boostedCoins)} XP from ${game}${boostNote}`;
  db.logEvent('reward', safePlayerName, { game, event, xp: boostedCoins, baseXp: coins });
  emitTickerEvent('reward', safePlayerName, detail);

  // Emit per-game daily loot box ticker (3 items)
  if (singleCosmeticResult && singleCosmeticResult.length > 0) {
    for (const item of singleCosmeticResult) {
      const scDetail = `won a ${item.rarity} ${item.name} (${cosmetics.CATEGORY_NAMES[item.category] || item.category}) from daily ${game}!`;
      emitTickerEvent('lootbox', safePlayerName, scDetail);
    }
    const names = singleCosmeticResult.map(i => `${i.rarity} "${i.name}"`).join(', ');
    console.log(`[DailyLootBox] ${safePlayerName} awarded ${singleCosmeticResult.length} items from daily ${game}: ${names}`);
  }

  // Emit daily all-games loot box ticker if awarded (array of items)
  if (lootBoxResult && lootBoxResult.length > 0) {
    for (const item of lootBoxResult) {
      const lbDetail = `unlocked a ${item.rarity} ${item.name} (${cosmetics.CATEGORY_NAMES[item.category] || item.category})!`;
      emitTickerEvent('lootbox', safePlayerName, lbDetail);
    }
    const names = lootBoxResult.map(i => `${i.rarity} "${i.name}"`).join(', ');
    console.log(`[LootBox] ${safePlayerName} awarded ${lootBoxResult.length} items: ${names}`);
  }

  // Emit weekly cosmetic ticker if awarded (now an array of items)
  if (weeklyResult && weeklyResult.length > 0) {
    for (const item of weeklyResult) {
      const wDetail = `earned a weekly ${item.rarity} ${item.name} (${cosmetics.CATEGORY_NAMES[item.category] || item.category}) from ${game}!`;
      emitTickerEvent('lootbox', safePlayerName, wDetail);
    }
    const names = weeklyResult.map(i => `${i.rarity} "${i.name}"`).join(', ');
    console.log(`[Weekly] ${safePlayerName} awarded ${weeklyResult.length} items: ${names}`);
  }

  // Epic+ loot box drops land in the social feed (rarity filter in feed-push).
  feedPush.pushLootboxItems(player, [
    ...(singleCosmeticResult || []),
    ...(lootBoxResult || []),
    ...(weeklyResult || [])
  ]);

  refreshCache();
  emitOverlayUpdate(true);

  // Fetch updated balance
  const updated = db.queryOne('SELECT xp FROM players WHERE id = ?', [player.id]);
  const newBalance = updated ? (updated.xp || 0) : ((player.xp || 0) + boostedCoins);

  console.log(`[Reward] ${safePlayerName} +${boostedCoins} XP from ${game} (${event})${boostNote} -> balance: ${formatNumber(newBalance)}`);
  const result = {
    ok: true,
    message: `${formatNumber(boostedCoins)} XP awarded${boostNote}`,
    xpAwarded: boostedCoins,
    coinsAwarded: boostedCoins,
    newXpBalance: newBalance,
    newBalance
  };
  if (singleCosmeticResult && singleCosmeticResult.length > 0) {
    result.dailyLootBox = singleCosmeticResult;
  }
  if (lootBoxResult) {
    result.lootBox = lootBoxResult;
  }
  if (weeklyResult) {
    result.weeklyCosmetic = weeklyResult;
  }
  if (weeklyAllResult) {
    result.weeklyAllGamesBox = weeklyAllResult;
  }

  // ── Post-Game Progress Summary ──────────────────────────────────────────
  // Build progressSummary for client-side progress card.
  // Omit entirely if nothing meaningful happened (suppression rule).
  const progressSummary = buildProgressSummary({
    player, platform, platformUserId, game, event,
    boostedCoins, isDailyWin, today,
    singleCosmeticResult, lootBoxResult, weeklyResult, weeklyAllResult
  });
  if (progressSummary) {
    result.progressSummary = progressSummary;
  }

  // Library word tracking removed from /api/reward to prevent double-counting.
  // Library words are now ONLY tracked via /api/library/report (called by reportLibraryWord()).
  return result;
}

// Cosmetics

function handleBuyCosmetic(platform, platformUserId, username, displayName, cosmeticId) {
  const player = getOrCreatePlayer(platform, platformUserId, username, displayName);
  if (!player) return { ok: false, message: 'Could not find or create player' };
  const safePlayerName = player.display_name || player.username || displayName || username || platformUserId;

  const coinsBefore = player.xp || 0;
  const allPlayerIds = [...getAllLinkedPlayerIds(player.platform, player.platform_user_id)];
  const result = cosmetics.buyCosmetic(db, player.id, cosmeticId, player.xp || 0, allPlayerIds);

  if (result.ok) {
    const item = result.item;
    if (item) {
      db.logEvent('cosmetic', player.display_name, { action: 'buy', cosmetic: item.name });
      emitTickerEvent('upgrade', player.display_name, `bought ${item.name}`);
      feedPush.pushCosmeticBuy(player, item);

      // Audit trail: log to permanent ledger
      if (ledger) {
        const afterPlayer = db.getPlayerById(player.id);
        ledger.record({
          playerId: player.id,
          playerName: safePlayerName,
          platform,
          eventType: 'cosmetic',
          command: `!buyc ${item.id}`,
          coinsBefore,
          coinsAfter: afterPlayer ? (afterPlayer.xp || 0) : coinsBefore - item.cost,
          success: 1,
          response: `${item.name} purchased`,
          detail: { cosmeticId: item.id, cosmeticName: item.name, cost: item.cost }
        });
      }
    }
    refreshCache();
    emitOverlayUpdate(true);
    bumpDataVersion();
  }
  return result;
}

function handleBuySet(platform, platformUserId, username, displayName, setKey) {
  const player = getOrCreatePlayer(platform, platformUserId, username, displayName);
  if (!player) return { ok: false, message: 'Could not find or create player' };
  const safePlayerName = player.display_name || player.username || displayName || username || platformUserId;

  const giftCoinsBefore = player.gift_coins || 0;
  const allSetIds = [...getAllLinkedPlayerIds(player.platform, player.platform_user_id)];
  const result = cosmetics.buySet(db, player.id, setKey, giftCoinsBefore, allSetIds);

  if (result.ok) {
    db.logEvent('cosmetic', player.display_name, { action: 'buyset', set: result.setDef.name });
    emitTickerEvent('upgrade', player.display_name, `unlocked the ${result.setDef.name} set! 🧩`);
    feedPush.pushSetUnlock(player, result.setDef.name);

    // Audit trail: log to permanent ledger
    if (ledger) {
      const afterPlayer = db.getPlayerById(player.id);
      ledger.record({
        playerId: player.id,
        playerName: safePlayerName,
        platform,
        eventType: 'cosmetic',
        command: `!buyset ${setKey}`,
        coinsBefore: player.xp || 0,
        coinsAfter: afterPlayer ? (afterPlayer.xp || 0) : (player.xp || 0),
        giftCoinsBefore,
        giftCoinsAfter: afterPlayer ? (afterPlayer.gift_coins || 0) : giftCoinsBefore,
        success: 1,
        response: `${result.setDef.name} set purchased`,
        detail: { setKey, setName: result.setDef.name, cost: result.setDef.totalCost }
      });
    }

    refreshCache();
    emitOverlayUpdate(true);
    bumpDataVersion();
  }
  return result;
}

function handleEquipCosmetic(platform, platformUserId, cosmeticId) {
  const player = db.resolvePlayer(platform, platformUserId);
  if (!player) return { ok: false, message: 'Player not found' };
  const allPlayerIds = [...getAllLinkedPlayerIds(player.platform, player.platform_user_id)];

  // Find which linked player owns this cosmetic
  let ownerPid = null;
  for (const pid of allPlayerIds) {
    const owned = db.queryOne(
      'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
      [pid, cosmeticId]
    );
    if (owned) { ownerPid = pid; break; }
  }
  if (!ownerPid) return { ok: false, message: 'Item not found in your inventory' };

  // Equip on owner, unequip same category across ALL linked players
  const result = cosmetics.equipCosmetic(db, ownerPid, cosmeticId, allPlayerIds);
  if (result.ok) bumpDataVersion();
  return result;
}

function handleUnequipCosmetic(platform, platformUserId, categoryInput) {
  const player = db.resolvePlayer(platform, platformUserId);
  if (!player) return { ok: false, message: 'Player not found' };
  // Unequip on all linked players so cosmetics stay in sync
  const allPlayerIds = getAllLinkedPlayerIds(player.platform, player.platform_user_id);
  let result = { ok: false };
  for (const pid of allPlayerIds) {
    const r = cosmetics.unequipCategory(db, pid, categoryInput);
    if (r.ok) result = r;
  }
  if (result.ok) bumpDataVersion();
  return result;
}

function getAllLinkedPlayerIds(platform, platformUserId) {
  const resolvedPlayer =
    db.resolvePlayer(platform, platformUserId) ||
    db.getPlayerByUsername(platform, platformUserId) ||
    db.getPlayerByDisplayName(platform, platformUserId);

  if (resolvedPlayer) {
    return new Set(db.getAllPlayerIdsFromPlayer(resolvedPlayer.id));
  }

  let discordUserId = null;
  if (platform === 'discord' || platform === 'mobile') {
    discordUserId = String(platformUserId || '');
    if (discordUserId.startsWith('discord_')) {
      discordUserId = discordUserId.slice('discord_'.length);
    }
  } else {
    discordUserId = db.getDiscordUserForPlatform(platform, platformUserId);
  }

  if (!discordUserId) return new Set();
  return new Set(db.getAllPlayerIdsForDiscord(discordUserId));
}

// DEPRECATED: Owner-side visibility filtering removed March 19 2026.
// Cosmetic visibility is now a VIEWER preference applied client-side.
// The visibility data model (account_preferences.cosmetic_visibility) is
// still used — clients fetch it via /api/me/visibility and filter at render time.
// Keeping this code commented for reference only.
// const DEFAULT_VISIBILITY = { word_color: false, word_glow: false };
// function _applyVisibilityFilter(equipped, discordUserId) { ... }

function getPlayerCosmeticsForAPI(platform, platformUserId) {
  let player = db.resolvePlayer(platform, platformUserId);
  // Fallback: try looking up by username or display_name
  if (!player) player = db.getPlayerByUsername(platform, platformUserId);
  if (!player) player = db.getPlayerByDisplayName(platform, platformUserId);
  if (!player) return {};

  // For linked accounts, merge cosmetics from all linked players
  // so cosmetics equipped on any account show everywhere
  let discordUserId = null;
  if (player.platform === 'discord' || player.platform === 'web' || player.platform === 'mobile') {
    // web and mobile platform IDs ARE Discord IDs — resolve directly
    discordUserId = player.platform_user_id;
  } else {
    discordUserId = db.getDiscordUserForPlatform(player.platform, player.platform_user_id);
  }

  if (discordUserId) {
    const linkedAccounts = db.getLinkedAccounts(discordUserId);
    if (linkedAccounts.length > 0) {
      const merged = {};
      // Collect cosmetics from all linked platform players
      for (const acct of linkedAccounts) {
        const lp = db.queryOne(
          'SELECT * FROM players WHERE platform = ? AND platform_user_id = ?',
          [acct.platform, acct.platform_user_id]
        );
        if (lp) Object.assign(merged, cosmetics.getPlayerEquipped(db, lp.id));
      }
      // Discord player cosmetics override (highest priority)
      // Discord players may use username (e.g. '.jorost') not numeric ID
      const linkedForUsername = db.getLinkedAccounts(discordUserId);
      const dUsername = linkedForUsername.length > 0 ? linkedForUsername[0].discord_username : null;
      const dLookups = [discordUserId];
      if (dUsername && dUsername !== discordUserId) dLookups.push(dUsername);
      for (const lookup of dLookups) {
        const dp = db.queryOne('SELECT * FROM players WHERE platform IN (?, ?) AND platform_user_id = ?', ['discord', 'mobile', lookup]);
        if (dp) Object.assign(merged, cosmetics.getPlayerEquipped(db, dp.id));
      }
      if (Object.keys(merged).length > 0) return merged;
    }
  }

  return cosmetics.getPlayerEquipped(db, player.id);
}

// ==================== BUY BEST (ROI-based auto-purchase) ====================

function findBestBusinessROI(playerId) {
  const playerBiz = db.getPlayerBusinesses(playerId);
  const ownedMap = {};
  for (const b of playerBiz) ownedMap[b.business_type] = b.level;

  const candidates = [];
  for (const biz of businesses.getBusinessList()) {
    if (businesses.isWordUpgrade(biz.type)) continue;

    const currentLevel = ownedMap[biz.type] || 0;
    const cost = businesses.getCost(biz.type, currentLevel);
    if (cost <= 0 || cost >= Number.MAX_SAFE_INTEGER) continue;

    const nextLevel = currentLevel + 1;
    const currentIps = currentLevel > 0 ? businesses.getIncomePerSecond(biz.type, currentLevel) : 0;
    const nextIps = businesses.getIncomePerSecond(biz.type, nextLevel);
    const ipsGain = nextIps - currentIps;
    if (ipsGain <= 0) continue;

    const def = businesses.getBusinessDef(biz.type);
    candidates.push({
      kind: 'business',
      type: biz.type,
      name: def.name,
      emoji: def.emoji,
      cost,
      currentLevel,
      nextLevel,
      ipsGain,
      roi: ipsGain / cost
    });
  }

  candidates.sort((a, b) => b.roi - a.roi);
  return candidates;
}

function findBestTapROI(freshPlayer) {
  const candidates = [];
  const tapTypes = [
    { key: 'tap', getCurrentLevel: () => freshPlayer.tap_power },
    { key: 'crit', getCurrentLevel: () => Math.round((freshPlayer.crit_chance || 0) / 0.01) },
    { key: 'multi', getCurrentLevel: () => freshPlayer.multi_tap || 1 }
  ];

  for (const { key, getCurrentLevel } of tapTypes) {
    const def = businesses.getTapUpgradeDef(key);
    const currentLevel = getCurrentLevel();
    if (currentLevel >= def.maxLevel) continue;

    const cost = businesses.getTapUpgradeCost(key, currentLevel);

    // Pseudo income/sec gain heuristic for cross-category ROI comparison
    let pseudoIpsGain;
    if (key === 'tap') {
      pseudoIpsGain = 1; // +1 coin/tap × ~1 tap/sec
    } else if (key === 'crit') {
      pseudoIpsGain = 0.04 * freshPlayer.tap_power; // +1% chance × 4x extra × tapPower
    } else if (key === 'multi') {
      pseudoIpsGain = freshPlayer.tap_power; // +1 effective tap × tapPower
    }

    candidates.push({
      kind: 'tap',
      type: key,
      name: def.name,
      cost,
      currentLevel,
      nextLevel: currentLevel + 1,
      roi: pseudoIpsGain / cost
    });
  }

  candidates.sort((a, b) => b.roi - a.roi);
  return candidates;
}

function findBestCosmeticROI(playerId) {
  const owned = new Set(
    cosmetics.getPlayerOwned(db, playerId).map(o => o.cosmetic_id)
  );

  const INCOME_BUFF_TYPES = new Set(['biz_boost', 'tap_boost', 'prestige', 'coin_bonus', 'library_boost']);
  const candidates = [];

  for (const item of cosmetics.COSMETICS_CATALOG) {
    if (owned.has(item.id)) continue;
    if (item.giftSet) continue;
    if (item.cost <= 0) continue;

    const buffs = item.buffs || (item.buff ? [item.buff] : []);
    const incomeBuffs = buffs.filter(b => INCOME_BUFF_TYPES.has(b.type));
    if (incomeBuffs.length === 0) continue;

    const totalBuffValue = incomeBuffs.reduce((sum, b) => sum + b.value, 0);
    candidates.push({
      kind: 'cosmetic',
      id: item.id,
      name: item.name,
      cost: item.cost,
      buffLabel: incomeBuffs.map(b => b.label).join(', '),
      roi: totalBuffValue / item.cost
    });
  }

  candidates.sort((a, b) => b.roi - a.roi);
  return candidates;
}

function executeBestPurchase(player, candidate) {
  if (candidate.kind === 'business') {
    return buyBusiness(player, candidate.type);
  } else if (candidate.kind === 'tap') {
    return upgradeTap(player, candidate.type);
  } else if (candidate.kind === 'cosmetic') {
    return handleBuyCosmetic(
      player.platform, player.platform_user_id,
      player.username, player.display_name,
      candidate.id
    );
  }
  return { ok: false, message: 'Unknown purchase type' };
}

function buyBest(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };

  const allCandidates = [
    ...findBestBusinessROI(freshPlayer.id),
    ...findBestTapROI(freshPlayer),
    ...findBestCosmeticROI(freshPlayer.id)
  ].filter(c => c.cost <= (freshPlayer.xp || 0));

  if (allCandidates.length === 0) {
    // Find the cheapest option overall to show how much more is needed
    const allOptions = [
      ...findBestBusinessROI(freshPlayer.id),
      ...findBestTapROI(freshPlayer),
      ...findBestCosmeticROI(freshPlayer.id)
    ];
    if (allOptions.length > 0) {
      const cheapest = allOptions.reduce((a, b) => a.cost < b.cost ? a : b);
      const needed = Math.ceil(cheapest.cost - (freshPlayer.xp || 0));
      return {
        ok: false,
        message: `${freshPlayer.display_name}: Can't afford any upgrades. Cheapest: ${cheapest.name} (${formatNumber(cheapest.cost)}, need ${formatNumber(needed)} more)`
      };
    }
    return { ok: false, message: `${freshPlayer.display_name}: No upgrades available.` };
  }

  // Pick best ROI
  allCandidates.sort((a, b) => b.roi - a.roi);
  return executeBestPurchase(player, allCandidates[0]);
}

function buyBestMax(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };

  const startingCoins = freshPlayer.xp || 0;
  const purchases = [];
  let totalSpent = 0;
  const MAX_ITERATIONS = 500;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const current = db.getPlayerById(freshPlayer.id);
    if (!current || (current.xp || 0) <= 0) break;

    // Exclude cosmetics — they are preference-based, not pure ROI
    const allCandidates = [
      ...findBestBusinessROI(current.id),
      ...findBestTapROI(current)
    ].filter(c => c.cost <= (current.xp || 0));

    if (allCandidates.length === 0) break;

    allCandidates.sort((a, b) => b.roi - a.roi);
    const best = allCandidates[0];

    const result = executeBestPurchase(player, best);
    if (result && result.ok) {
      totalSpent += best.cost;
      purchases.push(best);
    } else {
      break;
    }
  }

  if (purchases.length === 0) {
    return {
      ok: false,
      message: `${freshPlayer.display_name}: Can't afford any upgrades! (${formatNumber(freshPlayer.xp || 0)} XP)`
    };
  }

  // Build compact summary grouped by kind
  const remaining = db.getPlayerById(freshPlayer.id);
  const remainingCoins = remaining ? (remaining.xp || 0) : 0;

  const parts = [];

  // Businesses: group by type, show final level reached
  const bizPurchases = purchases.filter(p => p.kind === 'business');
  if (bizPurchases.length > 0) {
    const bizFinal = {};
    for (const p of bizPurchases) bizFinal[p.type] = p;
    parts.push(Object.values(bizFinal).map(p => `${p.emoji} ${p.name} Lv.${p.nextLevel}`).join(', '));
  }

  // Tap upgrades: group by type, show final level
  const tapPurchases = purchases.filter(p => p.kind === 'tap');
  if (tapPurchases.length > 0) {
    const tapFinal = {};
    for (const p of tapPurchases) tapFinal[p.type] = p;
    parts.push(Object.values(tapFinal).map(p => `${p.name} Lv.${p.nextLevel}`).join(', '));
  }

  // Cosmetics: list names
  const cosPurchases = purchases.filter(p => p.kind === 'cosmetic');
  if (cosPurchases.length > 0) {
    parts.push(cosPurchases.map(p => p.name).join(', '));
  }

  return {
    ok: true,
    message: `${freshPlayer.display_name} bought ${purchases.length} upgrades for ${formatNumber(totalSpent)} coins! ${parts.join(' | ')} | ${formatNumber(remainingCoins)} remaining`
  };
}

// Utilities

function formatNumber(num, decimals = 0) {
  if (num === undefined || num === null) return '0';
  num = Number(num);
  if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e4) return (num / 1e3).toFixed(1) + 'K';
  return decimals > 0 ? num.toFixed(decimals) : Math.floor(num).toLocaleString();
}

async function shutdown() {
  if (batchInterval) { clearInterval(batchInterval); batchInterval = null; }
  if (periodicSaveInterval) { clearInterval(periodicSaveInterval); periodicSaveInterval = null; }
  // Wait for earlier Redis flushes before draining the last buffered taps.
  await Promise.all([...activeBatches]);
  await processBatch();
}

function setFrenzyEmitter(fn) {
  frenzyEmitter = fn;
}

function getFrenzyMultiplier() {
  return currentFrenzy.multiplier;
}

function getFrenzyState() {
  return currentFrenzy;
}

module.exports = {
  initialize,
  getOrCreatePlayer,
  canTap,
  bufferTaps,
  handleManualTap,
  upgradeTap,
  getComboInfo,
  buyBusiness,
  getEmpireInfo,
  getGameState,
  getLeaderboard,
  refreshCache,
  emitOverlayUpdate,
  emitTickerEvent,
  emitEvent,
  bumpDataVersion,
  handleGift,
  handleReward,
  handleBuyCosmetic,
  handleBuySet,
  handleEquipCosmetic,
  handleUnequipCosmetic,
  getPlayerCosmeticsForAPI,
  getPlayerBuffSummary,
  buyBest,
  buyBestMax,
  formatNumber,
  setFrenzyEmitter,
  getFrenzyMultiplier,
  getFrenzyState,
  checkAndAwardDailyLootBox,
  checkAndAwardWeeklyCosmetic,
  getAllLinkedPlayerIds,
  getWeekStart,
  getDailyToday,
  getDailyClaimStatus,
  processDailyClaim,
  shutdown,
  REQUIRED_DAILY_GAMES,
  REQUIRED_WEEKLY_GAMES
};
