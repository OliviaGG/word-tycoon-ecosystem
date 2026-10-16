// ==================== PIZZA SHOP CONFIG ====================
// Defines upgrades, prestige tiers, customization options, and income formulas
// for the interactive Pizza Shop minigame.

/**
 * Diminishing returns helper.
 * At level 1, returns exactly 1.0 (preserves early game).
 * At higher levels, each successive level gives slightly less benefit.
 * @param {number} level - current upgrade level
 * @param {number} decay - decay factor (0-1). Lower = stronger diminishing returns
 * @returns {number} effective level (always <= actual level)
 */
function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level; // no diminishing returns
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const PIZZA_UPGRADES = {
  oven: {
    name: 'Oven Speed',
    emoji: '\uD83D\uDD25',
    desc: 'Faster pizza cooking',
    effect: 'Reduces cycle time by 0.15s per level (diminishing)',
    baseCost: 500,
    costMultiplier: 1.08,
    maxLevel: 100,
    decay: 0.98
  },
  capacity: {
    name: 'Oven Capacity',
    emoji: '\uD83D\uDCE6',
    desc: 'More pizzas per cycle',
    effect: '+1 pizza per cycle per level (diminishing)',
    baseCost: 1000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.95
  },
  menu: {
    name: 'Menu Variety',
    emoji: '\uD83D\uDCCB',
    desc: 'Higher-value pizza options',
    effect: '+30% pizza value per level (diminishing)',
    baseCost: 2500,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.90
  },
  staff: {
    name: 'Staff Training',
    emoji: '\uD83D\uDC68\u200D\uD83C\uDF73',
    desc: 'Faster customer service',
    effect: '+10% service speed per level (diminishing)',
    baseCost: 1500,
    costMultiplier: 1.08,
    maxLevel: 100,
    decay: 0.95
  },
  seating: {
    name: 'Seating',
    emoji: '\uD83E\uDE91',
    desc: 'More customers at once',
    effect: '+2 max customers per level (diminishing)',
    baseCost: 2000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.95
  },
  marketing: {
    name: 'Marketing',
    emoji: '\uD83D\uDCE3',
    desc: 'Faster customer arrival',
    effect: '+15% arrival rate per level (diminishing)',
    baseCost: 3000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.93
  },
  delivery: {
    name: 'Delivery Service',
    emoji: '\uD83D\uDEF5',
    desc: 'Bonus income on collections',
    effect: '+15% collection bonus per level (diminishing)',
    baseCost: 10000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Amateur',       multiplier: 1,  unlocks: 'Classic theme' },
  { level: 1, name: 'Professional',  multiplier: 2,  unlocks: 'Sunset theme' },
  { level: 2, name: 'Gourmet',       multiplier: 3,  unlocks: 'Emerald theme' },
  { level: 3, name: 'Master',        multiplier: 5,  unlocks: 'Ocean theme' },
  { level: 4, name: 'Legendary',     multiplier: 8,  unlocks: 'Midnight theme' },
  // Level 5+: Legendary+ with +2x per level beyond 4
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

const MAX_SHOP_LEVEL = 100;
const BASE_CYCLE_SECONDS = 5;
const BASE_PIZZA_VALUE = 10;
const MAX_OFFLINE_SECONDS = 28800; // 8 hours max offline accumulation

/**
 * XP required to reach the next shop level.
 * Starts at 100, scales with 1.08^level.
 * After prestige, XP requirements double per prestige level.
 * Prestige 0→1 uses the base curve; prestige 2 doubles, prestige 3 quadruples, etc.
 */
function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(100 * Math.pow(1.08, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

/**
 * Get the prestige multiplier for a given prestige level.
 */
function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  // Level 5+: 8 + 2 * (level - 4)
  return 8 + 2 * (prestigeLevel - 4);
}

/**
 * Get the prestige tier name for a given prestige level.
 */
function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Amateur';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Legendary+';
}

/**
 * Get upgrade cost at a given level.
 */
function getUpgradeCost(upgradeType, currentLevel) {
  const def = PIZZA_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

/**
 * Calculate pizzas produced per cycle based on upgrades and prestige.
 * Uses diminishing returns on capacity level.
 * Returns fractional value for income calc; floor for display.
 */
function getPizzasPerCycle(capacityLevel, prestigeLevel) {
  const effCap = effectiveLevel(capacityLevel, PIZZA_UPGRADES.capacity.decay);
  return (1 + effCap) * (1 + prestigeLevel * 0.5);
}

/**
 * Calculate cycle time in seconds based on oven level.
 * Uses diminishing returns on oven level.
 */
function getCycleSeconds(ovenLevel) {
  const eff = effectiveLevel(ovenLevel, PIZZA_UPGRADES.oven.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.15);
}

/**
 * Calculate the value of each pizza based on upgrades, shop level, and prestige.
 * Uses diminishing returns on menu level. Shop level bonus reduced to 1.5%/level.
 */
function getPizzaValue(menuLevel, shopLevel, prestigeLevel) {
  const effMenu = effectiveLevel(menuLevel, PIZZA_UPGRADES.menu.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_PIZZA_VALUE * (1 + effMenu * 0.3) * (1 + shopLevel * 0.015) * prestigeMult;
}

/**
 * Calculate income per cycle (pizza coins).
 */
function getIncomePerCycle(upgrades, shopLevel, prestigeLevel) {
  const capacityLevel = (upgrades.capacity || 0);
  const menuLevel = (upgrades.menu || 0);
  const ovenLevel = (upgrades.oven || 0);
  const pizzas = getPizzasPerCycle(capacityLevel, prestigeLevel);
  const value = getPizzaValue(menuLevel, shopLevel, prestigeLevel);
  return Math.floor(pizzas * value);
}

/**
 * Calculate income per second (pizza coins).
 */
function getIncomePerSecond(upgrades, shopLevel, prestigeLevel) {
  const ovenLevel = (upgrades.oven || 0);
  const cycleTime = getCycleSeconds(ovenLevel);
  const incomePerCycle = getIncomePerCycle(upgrades, shopLevel, prestigeLevel);
  return incomePerCycle / cycleTime;
}

/**
 * Calculate pending (accumulated) income based on elapsed time.
 * Returns { pizzaCoins, pizzasServed, xpGained }.
 */
function calculatePendingIncome(upgrades, shopLevel, prestigeLevel, lastCollectedAt, deliveryLevel) {
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

  const ovenLevel = (upgrades.oven || 0);
  const cycleTime = getCycleSeconds(ovenLevel);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);

  const incomePerCycle = getIncomePerCycle(upgrades, shopLevel, prestigeLevel);
  const capacityLevel = (upgrades.capacity || 0);
  const pizzasPerCycle = getPizzasPerCycle(capacityLevel, prestigeLevel);

  // Delivery bonus: +15% collection bonus per level (with diminishing returns)
  const effDelivery = effectiveLevel(deliveryLevel, PIZZA_UPGRADES.delivery.decay);
  const deliveryBonus = 1 + (effDelivery * 0.15);

  return {
    pizzaCoins: Math.floor(incomePerCycle * cyclesCompleted * deliveryBonus),
    pizzasServed: Math.floor(pizzasPerCycle) * cyclesCompleted,
    xpGained: Math.floor(pizzasPerCycle) * cyclesCompleted // 1 XP per pizza served
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
 * Returns { current: string, next: string|null } for display in UI.
 */
function getUpgradeEffectPreview(upgradeType, currentLevel, shopLevel, prestigeLevel, upgrades) {
  const def = PIZZA_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  // Build upgrade set with override for the type we're previewing
  const makeUpgrades = (lvl) => ({ ...upgrades, [upgradeType]: lvl });

  switch (upgradeType) {
    case 'oven': {
      const curCycle = getCycleSeconds(currentLevel);
      const nextCycle = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return {
        current: `Cycle: ${curCycle.toFixed(2)}s`,
        next: nextCycle !== null ? `Cycle: ${nextCycle.toFixed(2)}s` : null
      };
    }
    case 'capacity': {
      const curPizzas = getPizzasPerCycle(currentLevel, prestigeLevel);
      const nextPizzas = currentLevel < def.maxLevel ? getPizzasPerCycle(currentLevel + 1, prestigeLevel) : null;
      return {
        current: `${Math.floor(curPizzas)} pizzas/cycle`,
        next: nextPizzas !== null ? `${Math.floor(nextPizzas)} pizzas/cycle` : null
      };
    }
    case 'menu': {
      const curVal = getPizzaValue(currentLevel, shopLevel, prestigeLevel);
      const nextVal = currentLevel < def.maxLevel ? getPizzaValue(currentLevel + 1, shopLevel, prestigeLevel) : null;
      return {
        current: `Value: ${Math.floor(curVal)} ea`,
        next: nextVal !== null ? `Value: ${Math.floor(nextVal)} ea` : null
      };
    }
    case 'staff': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 10)}% speed`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 10)}% speed` : null
      };
    }
    case 'seating': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `${2 + Math.floor(curEff * 2)} seats`,
        next: nextEff !== null ? `${2 + Math.floor(nextEff * 2)} seats` : null
      };
    }
    case 'marketing': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 15)}% arrivals`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 15)}% arrivals` : null
      };
    }
    case 'delivery': {
      const curEff = effectiveLevel(currentLevel, def.decay);
      const nextEff = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return {
        current: `+${Math.floor(curEff * 15)}% bonus`,
        next: nextEff !== null ? `+${Math.floor(nextEff * 15)}% bonus` : null
      };
    }
    default:
      return { current: '', next: null };
  }
}

/**
 * Calculate how many levels of an upgrade the player can afford with given coins.
 * Returns { levels, totalCost } — the number of affordable levels and their total cost.
 */
function calculateMaxBuy(upgradeType, currentLevel, availableCoins) {
  const def = PIZZA_UPGRADES[upgradeType];
  if (!def) return { levels: 0, totalCost: 0 };

  let levels = 0;
  let totalCost = 0;
  let lvl = currentLevel;

  while (lvl < def.maxLevel) {
    const cost = getUpgradeCost(upgradeType, lvl);
    if (totalCost + cost > availableCoins) break;
    totalCost += cost;
    lvl++;
    levels++;
  }

  return { levels, totalCost };
}

module.exports = {
  PIZZA_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_SHOP_LEVEL,
  BASE_CYCLE_SECONDS,
  BASE_PIZZA_VALUE,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getPizzasPerCycle,
  getCycleSeconds,
  getPizzaValue,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
