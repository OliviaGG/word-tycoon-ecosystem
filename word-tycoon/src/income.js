/**
 * Income calculation — shared player income breakdown.
 *
 * Single source of truth for all passive income math.
 * Created via createIncomeService(deps) so it can use DB
 * primitives without circular imports.
 *
 * Phase 2 extraction from server.js (2026-03-20).
 */

const pizzaCfg = require('./pizza-config');
const newsCfg = require('./newspaper-config');
const carwashCfg = require('./carwash-config');
const stockMogulCfg = require('./stockmogul-config');
const gymCfg = require('./gym-config');
const cinemaCfg = require('./cinema-config');
const startupCfg = require('./startup-config');
const bankCfg = require('./bank-config');
const cosmetics = require('./cosmetics');
const { BUSINESSES, parseUTCTimestamp, getLibraryLevel } = require('./businesses');
const { getIncomeMultiplier } = require('./tax-season');
const presence = require('./presence');
const accrual = require('./accrual');

// Businesses excluded from passive bizIncome — they earn via management collect only
const MANAGED_BIZ_TYPES = accrual.MANAGED_BIZ_TYPES;
// Use authoritative rates from accrual module
const OFFLINE_INCOME_RATE = accrual.OFFLINE_INCOME_RATE;
const MANAGED_OFFLINE_INCOME_RATE = accrual.MANAGED_OFFLINE_INCOME_RATE;

function createIncomeService(db) {
  function normalizePresenceMode(mode) {
    return mode === 'online' || mode === 'offline' ? mode : 'current';
  }

  function resolveOnlineState(playerId, mode) {
    const normalized = normalizePresenceMode(mode);
    if (normalized === 'online') return true;
    if (normalized === 'offline') return false;
    return presence.isOnline(playerId);
  }

  function shouldIncludeIncomeBuffs(options = {}) {
    return options.includeIncomeBuffs !== false;
  }

  function emptyIncomeBreakdown() {
    return {
      bizIncome: 0,
      pizzaIncome: 0,
      newsIncome: 0,
      gymIncome: 0,
      cinemaIncome: 0,
      startupIncome: 0,
      bankIncome: 0,
      carwashCleanRate: 0,
      stockmogulIncome: 0,
      byBusinessType: {},
      total: 0
    };
  }

  function mergeIncomeBreakdowns(target, source) {
    target.bizIncome += source.bizIncome || 0;
    target.pizzaIncome += source.pizzaIncome || 0;
    target.newsIncome += source.newsIncome || 0;
    target.gymIncome += source.gymIncome || 0;
    target.cinemaIncome += source.cinemaIncome || 0;
    target.startupIncome += source.startupIncome || 0;
    target.bankIncome += source.bankIncome || 0;
    target.carwashCleanRate += source.carwashCleanRate || 0;
    target.stockmogulIncome += source.stockmogulIncome || 0;
    target.total += source.total || 0;
    const byType = source.byBusinessType || {};
    for (const [type, amount] of Object.entries(byType)) {
      target.byBusinessType[type] = (target.byBusinessType[type] || 0) + (amount || 0);
    }
    return target;
  }

  /**
   * Authoritative passive multiplier — uses presence service, not stale DB.
   * Phase 2: delegates online/offline to presence.isOnline() so display
   * numbers update immediately when presence changes.
   */
  function getDeterministicPassiveMultiplier(playerId, businessType, options = {}) {
    const includeIncomeBuffs = shouldIncludeIncomeBuffs(options);
    const buffs = includeIncomeBuffs
      ? (cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS)
      : cosmetics.DEFAULT_BUFFS;
    let multiplier = includeIncomeBuffs ? getIncomeMultiplier(playerId) : 1;
    multiplier *= (1 + (buffs.biz_boost || 0));

    if (BUSINESSES[businessType]?.wordUpgrade && buffs.library_boost > 0) {
      multiplier *= (1 + buffs.library_boost);
    }

    // Phase 2: use centralized presence service instead of raw DB last_seen
    const isOnline = resolveOnlineState(playerId, options.presenceMode);
    if (!isOnline) {
      multiplier *= OFFLINE_INCOME_RATE * (1 + (buffs.offline_boost || 0));
    }

    multiplier *= (1 + (buffs.prestige || 0)) * (1 + (buffs.coin_bonus || 0));
    return multiplier;
  }

  /**
   * Managed business display multiplier — uses the same income-affecting
   * cosmetic stack as regular passive businesses, with the shared offline rate.
   */
  function getManagedDisplayMultiplier(playerId, options = {}) {
    const includeIncomeBuffs = shouldIncludeIncomeBuffs(options);
    const buffs = includeIncomeBuffs
      ? (cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS)
      : cosmetics.DEFAULT_BUFFS;
    let multiplier = includeIncomeBuffs ? getIncomeMultiplier(playerId) : 1;
    multiplier *= (1 + (buffs.biz_boost || 0));

    const isOnline = resolveOnlineState(playerId, options.presenceMode);
    if (!isOnline) {
      multiplier *= MANAGED_OFFLINE_INCOME_RATE * (1 + (buffs.offline_boost || 0));
    }

    multiplier *= (1 + (buffs.prestige || 0));
    multiplier *= (1 + (buffs.coin_bonus || 0));
    return multiplier;
  }

  function getEffectiveRegularBusinessLevel(playerId, business) {
    if (BUSINESSES[business.business_type]?.wordUpgrade && db.getLinkedLibraryWordCount) {
      return getLibraryLevel(db.getLinkedLibraryWordCount(playerId));
    }
    return business.level;
  }

  /**
   * Get regular business income/sec (excludes managed businesses).
   * Arcade = 0 (baseIncome guard).
   */
  function getRegularBizIncomeBreakdown(playerId, options = {}) {
    let bizIncome = 0;
    const byBusinessType = {};
    const ownedBusinesses = db.getPlayerBusinesses ? db.getPlayerBusinesses(playerId) : [];
    for (const business of ownedBusinesses) {
      if (MANAGED_BIZ_TYPES.has(business.business_type)) continue;
      const cfg = BUSINESSES[business.business_type];
      const level = getEffectiveRegularBusinessLevel(playerId, business);
      if (!cfg || cfg.baseIncome <= 0 || level <= 0) continue;

      const incomePerSecond = ((cfg.baseIncome * level) / cfg.cycleSeconds) * getDeterministicPassiveMultiplier(playerId, business.business_type, options);
      bizIncome += incomePerSecond;
      byBusinessType[business.business_type] = (byBusinessType[business.business_type] || 0) + incomePerSecond;
    }
    return { total: bizIncome, byBusinessType };
  }

  /**
   * Get pizza shop income/sec.
   */
  /**
   * Phase 2: All managed business display functions now use getManagedDisplayMultiplier()
   * which includes both tax season AND managed-business online/offline rate.
   */

  function getPizzaIncome(playerId, options = {}) {
    const pizzaShop = db.getPizzaShop(playerId);
    if (!pizzaShop) return 0;
    const rows = db.getPizzaUpgrades(playerId);
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return pizzaCfg.getIncomePerSecond(upgrades, pizzaShop.shop_level, pizzaShop.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  function getNewspaperIncome(playerId, options = {}) {
    const route = db.getNewspaperRoute(playerId);
    if (!route) return 0;
    const rows = db.getNewspaperUpgrades(playerId);
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return newsCfg.getIncomePerSecond(upgrades, route.route_level, route.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  function getGymIncome(playerId, options = {}) {
    const club = db.getGymClub ? db.getGymClub(playerId) : null;
    if (!club) return 0;
    const rows = db.getGymUpgrades ? db.getGymUpgrades(playerId) : [];
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return gymCfg.getIncomePerSecond(upgrades, club.club_level, club.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  function getCinemaIncome(playerId, options = {}) {
    const theater = db.getCinemaTheater ? db.getCinemaTheater(playerId) : null;
    if (!theater) return 0;
    const rows = db.getCinemaUpgrades ? db.getCinemaUpgrades(playerId) : [];
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return cinemaCfg.getIncomePerSecond(upgrades, theater.theater_level, theater.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  function getStartupIncome(playerId, options = {}) {
    const hub = db.getStartupHub ? db.getStartupHub(playerId) : null;
    if (!hub) return 0;
    const rows = db.getStartupUpgrades ? db.getStartupUpgrades(playerId) : [];
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return startupCfg.getIncomePerSecond(upgrades, hub.hub_level, hub.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  function getBankIncome(playerId, options = {}) {
    const vault = db.getBankVault ? db.getBankVault(playerId) : null;
    if (!vault) return 0;
    const rows = db.getBankUpgrades ? db.getBankUpgrades(playerId) : [];
    const upgrades = {};
    for (const r of rows) upgrades[r.upgrade_type] = r.level;
    return bankCfg.getIncomePerSecond(upgrades, vault.vault_level, vault.prestige_level) * getManagedDisplayMultiplier(playerId, options);
  }

  /**
   * Total passive income from regular businesses + pizza + newspaper.
   * This is the base that car wash laundering multiplies against.
   *
   * Replaces getPlayerTotalIncomePerSec() from server.js.
   */
  function getPassiveIncomeBase(playerId, options = {}) {
    const regular = getRegularBizIncomeBreakdown(playerId, options).total;
    return regular + getPizzaIncome(playerId, options) + getNewspaperIncome(playerId, options) + getGymIncome(playerId, options) + getCinemaIncome(playerId, options) + getStartupIncome(playerId, options) + getBankIncome(playerId, options);
  }

  /**
   * Full player income breakdown for account overview display.
   *
   * Replaces computePlayerIncome() from server.js.
   * Returns the same shape plus gymIncome:
   * { bizIncome, pizzaIncome, newsIncome, gymIncome, cinemaIncome, startupIncome, bankIncome, carwashCleanRate, stockmogulIncome, total }
   */
  function computePlayerIncome(playerId, options = {}) {
    const breakdown = emptyIncomeBreakdown();
    const regularBiz = getRegularBizIncomeBreakdown(playerId, options);
    const bizIncome = regularBiz.total;
    const pizzaIncome = getPizzaIncome(playerId, options);
    const newsIncome = getNewspaperIncome(playerId, options);
    const gymIncome = getGymIncome(playerId, options);
    const cinemaIncome = getCinemaIncome(playerId, options);
    const startupIncome = getStartupIncome(playerId, options);
    const bankIncome = getBankIncome(playerId, options);

    // Car wash clean cash rate (for display — actual accumulation is separate)
    let carwashCleanRate = 0;
    const carwashShop = db.getCarwashShop ? db.getCarwashShop(playerId) : null;
    if (carwashShop) {
      const cwRows = db.getCarwashUpgrades ? db.getCarwashUpgrades(playerId) : [];
      const cwUpgrades = {};
      for (const r of cwRows) cwUpgrades[r.upgrade_type] = r.level;
      const launderRate = carwashCfg.getLaunderingRate(cwUpgrades.shell || 0, carwashShop.prestige_level);
      carwashCleanRate = launderRate * (bizIncome + pizzaIncome + newsIncome + gymIncome + cinemaIncome + startupIncome + bankIncome);
    }

    // Stock Mogul portfolio coin income (converted to coins on collect at 50%)
    let stockmogulIncome = 0;
    const smPortfolio = db.getStockMogulPortfolio ? db.getStockMogulPortfolio(playerId) : null;
    if (smPortfolio) {
      const smRows = db.getStockMogulUpgrades ? db.getStockMogulUpgrades(playerId) : [];
      const smUpgrades = {};
      for (const r of smRows) smUpgrades[r.upgrade_type] = r.level;
      stockmogulIncome = stockMogulCfg.getIncomePerSecond(smUpgrades, smPortfolio.portfolio_level, smPortfolio.prestige_level) * getManagedDisplayMultiplier(playerId, options);
    }

    Object.assign(breakdown, {
      bizIncome,
      pizzaIncome,
      newsIncome,
      gymIncome,
      cinemaIncome,
      startupIncome,
      bankIncome,
      carwashCleanRate,
      stockmogulIncome,
      byBusinessType: {
        ...regularBiz.byBusinessType,
        pizza: pizzaIncome,
        newspaper: newsIncome,
        gym: gymIncome,
        cinema: cinemaIncome,
        startup: startupIncome,
        bank: bankIncome,
        stockmogul: stockmogulIncome,
        carwash: carwashCleanRate
      }
    });
    breakdown.total = bizIncome + pizzaIncome + newsIncome + gymIncome + cinemaIncome + startupIncome + bankIncome + stockmogulIncome;
    return breakdown;
  }

  function computeCombinedIncome(playerIds, options = {}) {
    if (!Array.isArray(playerIds) || playerIds.length === 0) return emptyIncomeBreakdown();
    return playerIds.reduce((acc, playerId) => mergeIncomeBreakdowns(acc, computePlayerIncome(playerId, options)), emptyIncomeBreakdown());
  }

  return {
    computePlayerIncome,
    computeCombinedIncome,
    getPassiveIncomeBase
  };
}

module.exports = { createIncomeService };
