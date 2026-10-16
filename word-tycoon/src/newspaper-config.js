// ==================== NEWSPAPER ROUTE CONFIG ====================
// Defines upgrades, prestige tiers, customization options, and income formulas
// for the Newspaper Route minigame.
// KEY DIFFERENCE FROM PIZZA SHOP: Uses real XP (player coins) for upgrades,
// not an internal currency. Collect pays out XP directly.

/**
 * Diminishing returns helper.
 * At level 1, returns exactly 1.0 (preserves early game).
 * At higher levels, each successive level gives slightly less benefit.
 */
function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const NEWSPAPER_UPGRADES = {
  bicycle: {
    name: 'Bicycle Speed',
    emoji: '\uD83D\uDEB2',
    desc: 'Faster delivery routes',
    effect: 'Reduces route time by 0.2s per level (diminishing)',
    baseCost: 400,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.97
  },
  subscribers: {
    name: 'Subscribers',
    emoji: '\uD83D\uDCEC',
    desc: 'More papers per route',
    effect: '+1 paper delivered per route per level (diminishing)',
    baseCost: 800,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  print_quality: {
    name: 'Print Quality',
    emoji: '\uD83D\uDCF0',
    desc: 'Premium paper subscriptions',
    effect: '+25% paper value per level (diminishing)',
    baseCost: 2000,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.91
  },
  carriers: {
    name: 'Carriers',
    emoji: '\uD83D\uDC66',
    desc: 'Hire more delivery kids',
    effect: '+12% delivery speed per level (diminishing)',
    baseCost: 1200,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.94
  },
  racks: {
    name: 'Newsstand Racks',
    emoji: '\uD83D\uDDDE\uFE0F',
    desc: 'Street corner newspaper racks',
    effect: '+2 passive sales per level (diminishing)',
    baseCost: 1800,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  headlines: {
    name: 'Headlines',
    emoji: '\uD83D\uDCE2',
    desc: 'Better headlines attract readers',
    effect: '+18% subscription rate per level (diminishing)',
    baseCost: 2500,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.92
  },
  bundles: {
    name: 'Sunday Bundles',
    emoji: '\uD83C\uDF81',
    desc: 'Coupon inserts & weekend editions',
    effect: '+12% collection bonus per level (diminishing)',
    baseCost: 8000,
    costMultiplier: 1.14,
    maxLevel: 100,
    decay: 0.91
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Paperboy',   multiplier: 1,  unlocks: 'Classic theme' },
  { level: 1, name: 'Carrier',    multiplier: 2,  unlocks: 'Sunset theme' },
  { level: 2, name: 'Editor',     multiplier: 3,  unlocks: 'Emerald theme' },
  { level: 3, name: 'Publisher',  multiplier: 5,  unlocks: 'Ocean theme' },
  { level: 4, name: 'Mogul',      multiplier: 8,  unlocks: 'Midnight theme' },
  // Level 5+: Mogul+ with +2x per level beyond 4
];

const CUSTOMIZATION_OPTIONS = {
  theme: {
    name: 'Empire Theme',
    options: [
      { id: 'classic',  name: 'Classic',   minPrestige: 0 },
      { id: 'sunset',   name: 'Sunset',    minPrestige: 1 },
      { id: 'emerald',  name: 'Emerald',   minPrestige: 2 },
      { id: 'ocean',    name: 'Ocean',     minPrestige: 3 },
      { id: 'midnight', name: 'Midnight',  minPrestige: 4 }
    ],
    default: 'classic'
  }
};

// ==================== FORMULAS ====================

const MAX_ROUTE_LEVEL = 100;
const BASE_ROUTE_SECONDS = 6;     // Slightly slower base than pizza (newspapers take time to deliver)
const BASE_PAPER_VALUE = 8;       // Lower base value since paid in real XP
const MAX_OFFLINE_SECONDS = 28800; // 8 hours max offline accumulation

// Collect caps per prestige level — max XP that can accumulate before collecting
const COLLECT_CAPS = {
  0: 1_000_000,     // Paperboy:  1M   (~1.5 hours at base rate)
  1: 5_000_000,     // Carrier:   5M
  2: 25_000_000,    // Editor:    25M
  3: 100_000_000,   // Publisher: 100M
  4: 500_000_000    // Mogul:     500M
  // Mogul+ (5+): +200M per level beyond 4
};

/**
 * Get the collect cap for a given prestige level.
 */
function getCollectCap(prestigeLevel) {
  if (prestigeLevel <= 0) return COLLECT_CAPS[0];
  if (prestigeLevel <= 4) return COLLECT_CAPS[prestigeLevel];
  return COLLECT_CAPS[4] + 200_000_000 * (prestigeLevel - 4);
}

/**
 * XP required to reach the next route level.
 * Starts at 80, scales with 1.07^level (slightly easier than pizza).
 */
function xpForLevel(level) {
  return Math.floor(80 * Math.pow(1.07, level));
}

/**
 * Get the prestige multiplier for a given prestige level.
 */
function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

/**
 * Get the prestige tier name for a given prestige level.
 */
function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Paperboy';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Mogul+';
}

/**
 * Get upgrade cost at a given level (costs real XP).
 */
function getUpgradeCost(upgradeType, currentLevel) {
  const def = NEWSPAPER_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

/**
 * Calculate papers delivered per route based on subscriber level and prestige.
 */
function getPapersPerRoute(subscriberLevel, prestigeLevel) {
  const effSub = effectiveLevel(subscriberLevel, NEWSPAPER_UPGRADES.subscribers.decay);
  return (1 + effSub) * (1 + prestigeLevel * 0.4);
}

/**
 * Calculate route time in seconds based on bicycle level.
 */
function getRouteSeconds(bicycleLevel) {
  const eff = effectiveLevel(bicycleLevel, NEWSPAPER_UPGRADES.bicycle.decay);
  return Math.max(1, BASE_ROUTE_SECONDS - eff * 0.2);
}

/**
 * Calculate the value of each paper based on print quality, route level, and prestige.
 */
function getPaperValue(printQualityLevel, routeLevel, prestigeLevel) {
  const effPQ = effectiveLevel(printQualityLevel, NEWSPAPER_UPGRADES.print_quality.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_PAPER_VALUE * (1 + effPQ * 0.25) * (1 + routeLevel * 0.012) * prestigeMult;
}

/**
 * Calculate income per route (XP).
 */
function getIncomePerRoute(upgrades, routeLevel, prestigeLevel) {
  const subscriberLevel = upgrades.subscribers || 0;
  const printQualityLevel = upgrades.print_quality || 0;
  const papers = getPapersPerRoute(subscriberLevel, prestigeLevel);
  const value = getPaperValue(printQualityLevel, routeLevel, prestigeLevel);
  return Math.floor(papers * value);
}

/**
 * Calculate income per second (XP).
 */
function getIncomePerSecond(upgrades, routeLevel, prestigeLevel) {
  const bicycleLevel = upgrades.bicycle || 0;
  const routeTime = getRouteSeconds(bicycleLevel);
  const incomePerRoute = getIncomePerRoute(upgrades, routeLevel, prestigeLevel);
  return incomePerRoute / routeTime;
}

/**
 * Calculate pending (accumulated) income based on elapsed time.
 * Returns { xpEarned, papersDelivered, routesCompleted }.
 * NOTE: This returns REAL XP, not internal currency.
 */
function calculatePendingIncome(upgrades, routeLevel, prestigeLevel, lastCollectedAt, bundlesLevel) {
  const now = Date.now();
  let lastTs;
  if (lastCollectedAt) {
    const ts = lastCollectedAt.includes('T') || lastCollectedAt.includes('Z') || lastCollectedAt.includes('+')
      ? new Date(lastCollectedAt).getTime()
      : new Date(lastCollectedAt.trim().replace(' ', 'T') + 'Z').getTime();
    lastTs = isNaN(ts) ? now : ts;
  } else {
    lastTs = now;
  }

  const elapsedMs = now - lastTs;
  const elapsedSeconds = Math.max(0, Math.min(elapsedMs / 1000, MAX_OFFLINE_SECONDS));

  const bicycleLevel = upgrades.bicycle || 0;
  const routeTime = getRouteSeconds(bicycleLevel);
  const routesCompleted = Math.floor(elapsedSeconds / routeTime);

  const incomePerRoute = getIncomePerRoute(upgrades, routeLevel, prestigeLevel);
  const subscriberLevel = upgrades.subscribers || 0;
  const papersPerRoute = getPapersPerRoute(subscriberLevel, prestigeLevel);

  // Bundles bonus: +12% collection bonus per level (with diminishing returns)
  const effBundles = effectiveLevel(bundlesLevel, NEWSPAPER_UPGRADES.bundles.decay);
  const bundlesBonus = 1 + (effBundles * 0.12);

  let xpEarned = Math.floor(incomePerRoute * routesCompleted * bundlesBonus);

  // Apply collect cap based on prestige level
  const cap = getCollectCap(prestigeLevel);
  const capped = xpEarned > cap;
  if (capped) xpEarned = cap;

  return {
    xpEarned,
    papersDelivered: Math.floor(papersPerRoute) * routesCompleted,
    routesCompleted,
    collectCap: cap,
    capped
  };
}

/**
 * Validate a customization choice (checks prestige requirement).
 */
function isCustomizationAllowed(category, value, prestigeLevel) {
  const catDef = CUSTOMIZATION_OPTIONS[category];
  if (!catDef) return false;
  const option = catDef.options.find(o => o.id === value);
  if (!option) return false;
  return prestigeLevel >= option.minPrestige;
}

/**
 * Get all available customization options for a given prestige level.
 */
function getAvailableCustomizations(prestigeLevel) {
  const result = {};
  for (const [category, catDef] of Object.entries(CUSTOMIZATION_OPTIONS)) {
    result[category] = {
      name: catDef.name,
      default: catDef.default,
      options: catDef.options.map(o => ({
        ...o,
        locked: prestigeLevel < o.minPrestige
      }))
    };
  }
  return result;
}

/**
 * Get the current and next-level effect description for an upgrade.
 */
function getUpgradeEffectPreview(upgradeType, currentLevel, routeLevel, prestigeLevel, upgrades) {
  const def = NEWSPAPER_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'bicycle': {
      const curRoute = getRouteSeconds(currentLevel);
      const nextRoute = currentLevel < def.maxLevel ? getRouteSeconds(currentLevel + 1) : null;
      return {
        current: `Route: ${curRoute.toFixed(2)}s`,
        next: nextRoute !== null ? `Route: ${nextRoute.toFixed(2)}s` : null
      };
    }
    case 'subscribers': {
      const curPapers = getPapersPerRoute(currentLevel, prestigeLevel);
      const nextPapers = currentLevel < def.maxLevel ? getPapersPerRoute(currentLevel + 1, prestigeLevel) : null;
      return {
        current: `${Math.floor(curPapers)} papers/route`,
        next: nextPapers !== null ? `${Math.floor(nextPapers)} papers/route` : null
      };
    }
    case 'print_quality': {
      const curVal = getPaperValue(currentLevel, routeLevel, prestigeLevel);
      const nextVal = currentLevel < def.maxLevel ? getPaperValue(currentLevel + 1, routeLevel, prestigeLevel) : null;
      return {
        current: `Value: ${Math.floor(curVal)} ea`,
        next: nextVal !== null ? `Value: ${Math.floor(nextVal)} ea` : null
      };
    }
    case 'carriers': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 12)}% speed`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 12)}% speed` : null
      };
    }
    case 'racks': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `${2 + Math.floor(curEff * 2)} racks`,
        next: nextEff !== null ? `${2 + Math.floor(nextEff * 2)} racks` : null
      };
    }
    case 'headlines': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 18)}% readers`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 18)}% readers` : null
      };
    }
    case 'bundles': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 12)}% bonus`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 12)}% bonus` : null
      };
    }
    default:
      return { current: '', next: null };
  }
}

/**
 * Calculate how many levels of an upgrade the player can afford with given XP.
 * NOTE: availableXP is the player's real coin balance.
 */
function calculateMaxBuy(upgradeType, currentLevel, availableXP) {
  const def = NEWSPAPER_UPGRADES[upgradeType];
  if (!def) return { levels: 0, totalCost: 0 };

  let levels = 0;
  let totalCost = 0;
  let lvl = currentLevel;

  while (lvl < def.maxLevel) {
    const cost = getUpgradeCost(upgradeType, lvl);
    if (totalCost + cost > availableXP) break;
    totalCost += cost;
    lvl++;
    levels++;
  }

  return { levels, totalCost };
}

module.exports = {
  NEWSPAPER_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  COLLECT_CAPS,
  MAX_ROUTE_LEVEL,
  BASE_ROUTE_SECONDS,
  BASE_PAPER_VALUE,
  MAX_OFFLINE_SECONDS,
  getCollectCap,
  effectiveLevel,
  xpForLevel,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getPapersPerRoute,
  getRouteSeconds,
  getPaperValue,
  getIncomePerRoute,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
