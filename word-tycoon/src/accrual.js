/**
 * Accrual Engine — Authoritative Income Settlement
 *
 * Single source of truth for "how much income has been earned in a time window"
 * for both regular passive businesses and managed businesses.
 *
 * Key principle: SETTLE BEFORE MUTATE
 * Before any upgrade, prestige, equip, or collection that changes income state,
 * accrue everything up to now using the OLD state, then apply the mutation.
 *
 * Phase 1 of income system refactor (2026-03-26).
 *
 * Usage:
 *   const accrual = require('./accrual');
 *   accrual.initialize(db, presence);
 *
 *   // Before an upgrade:
 *   accrual.settleBeforeMutate(playerId, 'pizza', () => {
 *     // apply upgrade here
 *   });
 */

const presence = require('./presence');
const cosmetics = require('./cosmetics');
const { getIncomeMultiplier } = require('./tax-season');
const { BUSINESSES, parseUTCTimestamp, getLibraryLevel, isWordUpgrade } = require('./businesses');

const OFFLINE_INCOME_RATE = 0.10;          // Regular passive businesses earn 10% offline
const MANAGED_OFFLINE_INCOME_RATE = 0.10;   // Managed businesses now use the same offline rate
const OFFLINE_THRESHOLD_MS = presence.OFFLINE_THRESHOLD_MS;

// Managed business types that have their own config/pending calculations
const MANAGED_BIZ_TYPES = new Set([
  'newspaper', 'carwash', 'pizza', 'stockmogul',
  'gym', 'cinema', 'startup', 'bank'
]);

let db = null;

function initialize(database) {
  db = database;
}

// ==================== INCOME RATE CALCULATION ====================

/**
 * Get the online/offline multiplier for a player right now.
 * This is the AUTHORITATIVE source for whether a player is online or offline.
 *
 * @param {number} playerId
 * @param {object} [buffs] - Pre-fetched cosmetic buffs (optimization)
 * @returns {number} The multiplier (1.0 for online, OFFLINE_RATE * (1+boost) for offline)
 */
function getPresenceMultiplier(playerId, buffs) {
  if (!buffs) {
    buffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
  }

  const online = presence.isOnline(playerId);
  if (online) return 1.0;

  return OFFLINE_INCOME_RATE * (1 + (buffs.offline_boost || 0));
}

/**
 * Get the shared managed-business multiplier stack.
 * Managed businesses now use the same income-affecting cosmetics as
 * regular passive businesses, except for library-only boosts.
 *
 * @param {number} playerId
 * @param {object} [buffs] - Pre-fetched cosmetic buffs (optimization)
 * @returns {number} Multiplier excluding tax season, so callers can safely
 * multiply it by getIncomeMultiplier(playerId) without double-applying tax.
 */
function getManagedPresenceMultiplier(playerId, buffs) {
  if (!buffs) {
    buffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
  }

  let multiplier = 1 + (buffs.biz_boost || 0);
  const online = presence.isOnline(playerId);
  if (!online) {
    multiplier *= MANAGED_OFFLINE_INCOME_RATE * (1 + (buffs.offline_boost || 0));
  }

  multiplier *= (1 + (buffs.prestige || 0));
  multiplier *= (1 + (buffs.coin_bonus || 0));
  return multiplier;
}

/**
 * Compute the full multiplier stack for a regular passive business.
 * This is the AUTHORITATIVE version — replaces getDeterministicPassiveMultiplier in income.js.
 *
 * @param {number} playerId
 * @param {string} businessType
 * @param {object} [buffs] - Pre-fetched cosmetic buffs
 * @returns {number}
 */
function getRegularBusinessMultiplier(playerId, businessType, buffs) {
  if (!buffs) {
    buffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
  }

  let multiplier = getIncomeMultiplier(playerId); // Tax season bonus
  multiplier *= (1 + (buffs.biz_boost || 0));     // Business boost cosmetic

  // Library boost — extra multiplier for word-upgraded businesses
  if (BUSINESSES[businessType]?.wordUpgrade && buffs.library_boost > 0) {
    multiplier *= (1 + buffs.library_boost);
  }

  // Online/offline
  multiplier *= getPresenceMultiplier(playerId, buffs);

  // Prestige + coin bonus
  multiplier *= (1 + (buffs.prestige || 0));
  multiplier *= (1 + (buffs.coin_bonus || 0));

  return multiplier;
}

/**
 * Get the effective level for a regular business, accounting for library word count.
 */
function getEffectiveLevel(playerId, business) {
  if (BUSINESSES[business.business_type]?.wordUpgrade && db.getLinkedLibraryWordCount) {
    return getLibraryLevel(db.getLinkedLibraryWordCount(playerId));
  }
  return business.level;
}

/**
 * Compute income/sec for a single regular passive business.
 */
function getRegularBizIncomePerSec(playerId, business, buffs) {
  const cfg = BUSINESSES[business.business_type];
  const level = getEffectiveLevel(playerId, business);
  if (!cfg || cfg.baseIncome <= 0 || level <= 0) return 0;

  const rawIncomePerSec = (cfg.baseIncome * level) / cfg.cycleSeconds;
  return rawIncomePerSec * getRegularBusinessMultiplier(playerId, business.business_type, buffs);
}

// ==================== SETTLEMENT ====================

/**
 * Settle all regular (non-managed) businesses for a single player.
 * Accrues pending income using current state and credits to player coins.
 *
 * This is the AUTHORITATIVE version of autoCollectAll() for a single player.
 * Returns { totalIncome, details[] }.
 */
function settleRegularBusinesses(playerId) {
  const businesses = db.getPlayerBusinesses ? db.getPlayerBusinesses(playerId) : [];
  const buffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
  const now = Date.now();
  let totalIncome = 0;
  const details = [];

  for (const biz of businesses) {
    if (MANAGED_BIZ_TYPES.has(biz.business_type)) continue;

    const cfg = BUSINESSES[biz.business_type];
    if (!cfg || cfg.baseIncome <= 0) continue;

    let effectiveLevel = getEffectiveLevel(playerId, biz);

    // Sync library level if needed
    if (isWordUpgrade(biz.business_type) && effectiveLevel !== biz.level) {
      if (db.setBusinessLevel) db.setBusinessLevel(biz.id, effectiveLevel);
    }

    // Calculate elapsed time and cycles
    const lastCollectedMs = parseUTCTimestamp(biz.last_collected_at);
    const elapsedMs = now - lastCollectedMs;
    const MAX_OFFLINE_SECONDS = 8760 * 3600; // 1 year
    const elapsedSeconds = Math.max(0, Math.min(elapsedMs / 1000, MAX_OFFLINE_SECONDS));

    const incomePerCycle = cfg.baseIncome * effectiveLevel;
    const cyclesCompleted = Math.floor(elapsedSeconds / cfg.cycleSeconds);
    const remainder = elapsedSeconds % cfg.cycleSeconds;

    if (cyclesCompleted <= 0) continue;

    const rawIncome = incomePerCycle * cyclesCompleted;

    // Apply multiplier stack
    let multiplier = getIncomeMultiplier(playerId) * (1 + (buffs.biz_boost || 0));
    if (isWordUpgrade(biz.business_type) && buffs.library_boost > 0) {
      multiplier *= (1 + buffs.library_boost);
    }

    // Online/offline at the moment of settlement
    const isOffline = !presence.isOnline(playerId);
    if (isOffline) {
      multiplier *= OFFLINE_INCOME_RATE * (1 + (buffs.offline_boost || 0));
    }

    multiplier *= (1 + (buffs.prestige || 0)) * (1 + (buffs.coin_bonus || 0));

    let adjustedIncome = rawIncome * multiplier;
    adjustedIncome = isOffline ? Math.max(1, Math.floor(adjustedIncome)) : Math.floor(adjustedIncome);

    if (adjustedIncome > 0) {
      db.updatePlayerCoins(playerId, adjustedIncome);
      totalIncome += adjustedIncome;
    }

    // Update last_collected_at to exclude remainder
    const newCollectedAt = new Date(now - remainder * 1000).toISOString();
    db.updateBusinessCollectedAt(biz.id, newCollectedAt);

    details.push({
      businessType: biz.business_type,
      level: effectiveLevel,
      cycles: cyclesCompleted,
      rawIncome,
      adjustedIncome,
      isOffline,
      multiplier
    });
  }

  return { totalIncome, details };
}

/**
 * Compute a cycle-aligned last_collected_at timestamp that preserves partial
 * cycle progress. Instead of resetting to exactly "now", we back off by the
 * remainder so accumulated time within the current cycle is not lost.
 *
 * @param {number} nowMs - current time in ms
 * @param {string} lastCollectedAt - the entity's last_collected_at string
 * @param {number} cycleSeconds - current effective cycle length in seconds
 * @returns {string} ISO-like UTC string "YYYY-MM-DD HH:MM:SS"
 */
function cycleAlignedTimestamp(nowMs, lastCollectedAt, cycleSeconds) {
  const lastMs = parseUTCTimestamp(lastCollectedAt);
  const elapsedMs = Math.max(0, nowMs - lastMs);
  const cycleMs = cycleSeconds * 1000;
  const aligned = nowMs - (elapsedMs % cycleMs);
  return new Date(aligned).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
}

/**
 * Settle a specific managed business for a player.
 * This updates last_collected_at to "now" without running the full collect flow.
 *
 * For managed businesses, "settling" means:
 * - Compute pending income using OLD state
 * - Credit the business-specific currency (pizza coins, clean cash, etc.)
 * - Update last_collected_at preserving partial cycle progress
 *
 * This is called BEFORE upgrades/prestige to prevent retroactive recalculation.
 *
 * @param {number} playerId
 * @param {string} businessType - e.g. 'pizza', 'gym', 'newspaper'
 * @returns {{ settled: boolean, amount: number }}
 */
function settleManagedBusiness(playerId, businessType) {
  // Each managed business has its own config and DB structure.
  // Rather than duplicating all the config logic here, we call the
  // config's calculatePendingIncome with current state, then credit
  // the result to the appropriate currency and update last_collected_at.

  const now = new Date();
  const nowMs = now.getTime();
  const nowStr = now.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
  // Combined multiplier: tax season × managed-business shared income stack
  const taxMult = getIncomeMultiplier(playerId);
  const buffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
  const presenceMult = getManagedPresenceMultiplier(playerId, buffs);
  const multiplier = taxMult * presenceMult;

  switch (businessType) {
    case 'pizza': {
      const shop = db.getPizzaShop ? db.getPizzaShop(playerId) : null;
      if (!shop) return { settled: false, amount: 0 };
      const pizzaCfg = require('./pizza-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getPizzaUpgrades(playerId);
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const deliveryLevel = upgrades.delivery || 0;
      const pending = scaleObjectFields(
        pizzaCfg.calculatePendingIncome(upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, deliveryLevel),
        ['pizzaCoins', 'xpGained', 'pizzasServed'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, shop.last_collected_at, pizzaCfg.getCycleSeconds(upgrades.oven || 0));
      if (pending.pizzaCoins > 0) {
        // Credit pizza coins and XP, update last_collected_at
        let newXp = shop.shop_xp + pending.xpGained;
        let newLevel = shop.shop_level;
        while (newLevel < pizzaCfg.MAX_SHOP_LEVEL) {
          const xpNeeded = pizzaCfg.xpForLevel(newLevel, shop.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updatePizzaShop(playerId, {
          pizza_coins: shop.pizza_coins + pending.pizzaCoins,
          shop_xp: newXp,
          shop_level: newLevel,
          total_pizzas_served: shop.total_pizzas_served + pending.pizzasServed,
          total_coins_earned: shop.total_coins_earned + Math.floor(pending.pizzaCoins),
          last_collected_at: newCollectedAt
        });
        // Also credit the real coin bonus (10% of pizza coins)
        const realCoinBonus = Math.floor(pending.pizzaCoins * 0.1);
        if (realCoinBonus > 0) db.updatePlayerCoins(playerId, realCoinBonus);
      } else {
        // Just update timestamp
        db.updatePizzaShop(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.pizzaCoins || 0 };
    }

    case 'newspaper': {
      const route = db.getNewspaperRoute ? db.getNewspaperRoute(playerId) : null;
      if (!route) return { settled: false, amount: 0 };
      const newsCfg = require('./newspaper-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getNewspaperUpgrades(playerId);
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const bundlesLevel = upgrades.bundles || 0;
      const pending = scaleObjectFields(
        newsCfg.calculatePendingIncome(upgrades, route.route_level, route.prestige_level, route.last_collected_at, bundlesLevel),
        ['xpEarned', 'papersDelivered', 'routesCompleted'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, route.last_collected_at, newsCfg.getRouteSeconds(upgrades.bicycle || 0));
      if (pending.xpEarned > 0) {
        db.updatePlayerCoins(playerId, pending.xpEarned);
        let newXp = route.route_xp + pending.routesCompleted;
        let newLevel = route.route_level;
        while (newLevel < newsCfg.MAX_ROUTE_LEVEL) {
          const xpNeeded = newsCfg.xpForLevel(newLevel);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateNewspaperRoute(playerId, {
          route_xp: newXp,
          route_level: newLevel,
          total_papers_delivered: route.total_papers_delivered + pending.papersDelivered,
          total_xp_earned: route.total_xp_earned + pending.xpEarned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateNewspaperRoute(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.xpEarned || 0 };
    }

    case 'gym': {
      const club = db.getGymClub ? db.getGymClub(playerId) : null;
      if (!club) return { settled: false, amount: 0 };
      const gymCfg = require('./gym-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getGymUpgrades ? db.getGymUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const membershipLevel = upgrades.membership || 0;
      const pending = scaleObjectFields(
        gymCfg.calculatePendingIncome(upgrades, club.club_level, club.prestige_level, club.last_collected_at, membershipLevel),
        ['xpEarned', 'xpGained', 'membersTrained'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, club.last_collected_at, gymCfg.getCycleSeconds(upgrades.trainers || 0));
      if (pending.xpEarned > 0) {
        db.updatePlayerCoins(playerId, pending.xpEarned);
        let newXp = club.club_xp + pending.xpGained;
        let newLevel = club.club_level;
        while (newLevel < gymCfg.MAX_GYM_LEVEL) {
          const xpNeeded = gymCfg.xpForLevel(newLevel, club.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateGymClub(playerId, {
          club_xp: newXp,
          club_level: newLevel,
          total_members_trained: club.total_members_trained + pending.membersTrained,
          total_points_earned: club.total_points_earned + pending.xpEarned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateGymClub(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.xpEarned || 0 };
    }

    case 'cinema': {
      const theater = db.getCinemaTheater ? db.getCinemaTheater(playerId) : null;
      if (!theater) return { settled: false, amount: 0 };
      const cinemaCfg = require('./cinema-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getCinemaUpgrades ? db.getCinemaUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const membershipLevel = upgrades.membership || 0;
      const pending = scaleObjectFields(
        cinemaCfg.calculatePendingIncome(upgrades, theater.theater_level, theater.prestige_level, theater.last_collected_at, membershipLevel),
        ['xpEarned', 'xpGained', 'showsRun', 'viewersServed'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, theater.last_collected_at, cinemaCfg.getCycleSeconds(upgrades.projectors || 0));
      if (pending.xpEarned > 0) {
        db.updatePlayerCoins(playerId, pending.xpEarned);
        let newXp = theater.theater_xp + pending.xpGained;
        let newLevel = theater.theater_level;
        while (newLevel < cinemaCfg.MAX_CINEMA_LEVEL) {
          const xpNeeded = cinemaCfg.xpForLevel(newLevel, theater.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateCinemaTheater(playerId, {
          theater_xp: newXp,
          theater_level: newLevel,
          total_viewers_served: theater.total_viewers_served + pending.viewersServed,
          total_xp_earned: theater.total_xp_earned + pending.xpEarned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateCinemaTheater(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.xpEarned || 0 };
    }

    case 'startup': {
      const hub = db.getStartupHub ? db.getStartupHub(playerId) : null;
      if (!hub) return { settled: false, amount: 0 };
      const startupCfg = require('./startup-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getStartupUpgrades ? db.getStartupUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const investorsLevel = upgrades.investors || 0;
      const pending = scaleObjectFields(
        startupCfg.calculatePendingIncome(upgrades, hub.hub_level, hub.prestige_level, hub.last_collected_at, investorsLevel),
        ['xpEarned', 'xpGained', 'launchesCompleted', 'usersServed'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, hub.last_collected_at, startupCfg.getCycleSeconds(upgrades.automation || 0));
      if (pending.xpEarned > 0) {
        db.updatePlayerCoins(playerId, pending.xpEarned);
        let newXp = hub.hub_xp + pending.xpGained;
        let newLevel = hub.hub_level;
        while (newLevel < startupCfg.MAX_STARTUP_LEVEL) {
          const xpNeeded = startupCfg.xpForLevel(newLevel, hub.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateStartupHub(playerId, {
          hub_xp: newXp,
          hub_level: newLevel,
          total_users_served: hub.total_users_served + pending.usersServed,
          total_xp_earned: hub.total_xp_earned + pending.xpEarned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateStartupHub(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.xpEarned || 0 };
    }

    case 'bank': {
      const vault = db.getBankVault ? db.getBankVault(playerId) : null;
      if (!vault) return { settled: false, amount: 0 };
      const bankCfg = require('./bank-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getBankUpgrades ? db.getBankUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const privateLevel = upgrades.private_banking || 0;
      const pending = scaleObjectFields(
        bankCfg.calculatePendingIncome(upgrades, vault.vault_level, vault.prestige_level, vault.last_collected_at, privateLevel),
        ['xpEarned', 'xpGained', 'transactionsProcessed', 'clientsServed'], multiplier
      );
      const newCollectedAt = cycleAlignedTimestamp(nowMs, vault.last_collected_at, bankCfg.getCycleSeconds(upgrades.systems || 0));
      if (pending.xpEarned > 0) {
        db.updatePlayerCoins(playerId, pending.xpEarned);
        let newXp = vault.vault_xp + pending.xpGained;
        let newLevel = vault.vault_level;
        while (newLevel < bankCfg.MAX_BANK_LEVEL) {
          const xpNeeded = bankCfg.xpForLevel(newLevel, vault.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateBankVault(playerId, {
          vault_xp: newXp,
          vault_level: newLevel,
          total_clients_served: vault.total_clients_served + pending.clientsServed,
          total_xp_earned: vault.total_xp_earned + pending.xpEarned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateBankVault(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: pending.xpEarned || 0 };
    }

    case 'carwash': {
      const shop = db.getCarwashShop ? db.getCarwashShop(playerId) : null;
      if (!shop) return { settled: false, amount: 0 };
      const carwashCfg = require('./carwash-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getCarwashUpgrades ? db.getCarwashUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      // For carwash, we need total biz income. Use income.js if available.
      let totalBizIncome = 0;
      try {
        // Dynamic require to avoid circular dep — carwash settlement is rare
        const { createIncomeService } = require('./income');
        const incomeService = createIncomeService(db);
        totalBizIncome = incomeService.getPassiveIncomeBase(playerId);
      } catch (e) {
        // Fallback: 0 biz income means 0 clean cash — safe default
      }
      const pending = scaleObjectFields(
        carwashCfg.calculatePendingCleanCash(upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, totalBizIncome, shop.clean_cash),
        ['cleanCash', 'xpGained', 'carsWashed'], multiplier
      );
      const offshoreLevel = upgrades.offshore || 0;
      const offshoreBonus = carwashCfg.getOffshoreBonus(offshoreLevel);
      const cleanWithBonus = Math.floor((pending.cleanCash || 0) * offshoreBonus);
      const newCollectedAt = cycleAlignedTimestamp(nowMs, shop.last_collected_at, carwashCfg.getCycleSeconds(upgrades.dryers || 0));
      if (cleanWithBonus > 0 || pending.xpGained > 0) {
        let newShopXp = shop.shop_xp + (pending.xpGained || 0);
        let newShopLevel = shop.shop_level;
        while (newShopLevel < carwashCfg.MAX_SHOP_LEVEL) {
          const xpNeeded = carwashCfg.xpForLevel(newShopLevel, shop.prestige_level);
          if (newShopXp >= xpNeeded) { newShopXp -= xpNeeded; newShopLevel++; } else break;
        }
        db.updateCarwashShop(playerId, {
          clean_cash: shop.clean_cash + cleanWithBonus,
          shop_xp: newShopXp,
          shop_level: newShopLevel,
          total_cars_washed: shop.total_cars_washed + (pending.carsWashed || 0),
          total_clean_earned: shop.total_clean_earned + cleanWithBonus,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateCarwashShop(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: cleanWithBonus };
    }

    case 'stockmogul': {
      const portfolio = db.getStockMogulPortfolio ? db.getStockMogulPortfolio(playerId) : null;
      if (!portfolio) return { settled: false, amount: 0 };
      const smCfg = require('./stockmogul-config');
      const { scaleObjectFields } = require('./tax-season');
      const rows = db.getStockMogulUpgrades ? db.getStockMogulUpgrades(playerId) : [];
      const upgrades = {};
      for (const r of rows) upgrades[r.upgrade_type] = r.level;
      const pending = scaleObjectFields(
        smCfg.calculatePendingPortfolioCoins(upgrades, portfolio.portfolio_level, portfolio.prestige_level, portfolio.last_collected_at, portfolio.portfolio_coins),
        ['portfolioCoins', 'xpGained', 'tradesCompleted'], multiplier
      );
      const dividendBonus = smCfg.getDividendBonus(upgrades.dividend || 0);
      const coinsWithBonus = Math.floor((pending.portfolioCoins || 0) * dividendBonus);
      const newCollectedAt = cycleAlignedTimestamp(nowMs, portfolio.last_collected_at, smCfg.getCycleSeconds(upgrades.broker || 0));
      if (coinsWithBonus > 0 || pending.xpGained > 0) {
        let newXp = portfolio.portfolio_xp + (pending.xpGained || 0);
        let newLevel = portfolio.portfolio_level;
        while (newLevel < smCfg.MAX_PORTFOLIO_LEVEL) {
          const xpNeeded = smCfg.xpForLevel(newLevel, portfolio.prestige_level);
          if (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel++; } else break;
        }
        db.updateStockMogulPortfolio(playerId, {
          portfolio_coins: portfolio.portfolio_coins + coinsWithBonus,
          portfolio_xp: newXp,
          portfolio_level: newLevel,
          total_trades: portfolio.total_trades + (pending.tradesCompleted || 0),
          // Keep this as real-coin lifetime payout only; settled portfolio coins
          // are still internal inventory until the player explicitly collects.
          total_coins_earned: portfolio.total_coins_earned,
          last_collected_at: newCollectedAt
        });
      } else {
        db.updateStockMogulPortfolio(playerId, { last_collected_at: newCollectedAt });
      }
      return { settled: true, amount: coinsWithBonus };
    }

    default:
      return { settled: false, amount: 0 };
  }
}

/**
 * Settle ALL pending income for a player (both regular and all owned managed businesses).
 * Call this before any global state mutation (e.g. cosmetic equip, tax season).
 */
function settleAll(playerId) {
  const results = {
    regular: settleRegularBusinesses(playerId),
    managed: {}
  };

  for (const bizType of MANAGED_BIZ_TYPES) {
    results.managed[bizType] = settleManagedBusiness(playerId, bizType);
  }

  return results;
}

/**
 * Settle a specific managed business, then execute a mutation within a transaction.
 * This is the PRIMARY safe pattern for upgrades and prestiges.
 *
 * @param {number} playerId
 * @param {string} businessType
 * @param {function} mutationFn - Called after settlement. May be sync or async.
 * @returns {*} The result of mutationFn
 */
async function settleAndMutate(playerId, businessType, mutationFn) {
  if (db.withTransaction) {
    return db.withTransaction(async () => {
      settleManagedBusiness(playerId, businessType);
      return mutationFn();
    });
  }

  // Fallback if no transaction support
  settleManagedBusiness(playerId, businessType);
  return mutationFn();
}

module.exports = {
  MANAGED_BIZ_TYPES,
  OFFLINE_INCOME_RATE,
  MANAGED_OFFLINE_INCOME_RATE,
  initialize,
  getPresenceMultiplier,
  getManagedPresenceMultiplier,
  getRegularBusinessMultiplier,
  getEffectiveLevel,
  getRegularBizIncomePerSec,
  settleRegularBusinesses,
  settleManagedBusiness,
  settleAll,
  settleAndMutate
};
