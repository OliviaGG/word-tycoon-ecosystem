// ==================== STOCK MOGUL CONFIG ====================
// Stock Mogul management: accumulates portfolio_coins passively.
// All upgrades cost clean_cash (from carwash_shops).
// Collection converts portfolio_coins to real player coins.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const STOCKMOGUL_UPGRADES = {
  portfolio: {
    name: 'Portfolio Size',
    emoji: '📊',
    desc: 'More stock holdings per cycle',
    effect: '+1 holding per level (diminishing)',
    baseCost: 400,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.95
  },
  analyst: {
    name: 'Market Analyst',
    emoji: '🔍',
    desc: 'Higher value per holding',
    effect: '+28% holding value per level (diminishing)',
    baseCost: 1200,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.91
  },
  broker: {
    name: 'Broker Network',
    emoji: '📞',
    desc: 'Faster dividend cycles',
    effect: 'Reduces cycle time by 0.12s per level (diminishing)',
    baseCost: 700,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.97
  },
  insider: {
    name: 'Insider Tips',
    emoji: '🤫',
    desc: 'Bonus income multiplier',
    effect: '+8% income per level (diminishing)',
    baseCost: 1800,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  offshore_hold: {
    name: 'Offshore Holdings',
    emoji: '🌴',
    desc: 'More portfolio coins stored',
    effect: '+60% storage cap per level (diminishing)',
    baseCost: 2500,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.92
  },
  leverage: {
    name: 'Leverage',
    emoji: '📈',
    desc: 'Amplify all returns',
    effect: '+12% income multiplier per level (diminishing)',
    baseCost: 6000,
    costMultiplier: 1.14,
    maxLevel: 100,
    decay: 0.89
  },
  dividend: {
    name: 'Dividend Reinvestment',
    emoji: '💹',
    desc: 'Bonus on portfolio collections',
    effect: '+14% collection bonus per level (diminishing)',
    baseCost: 10000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Day Trader',          multiplier: 1, unlocks: 'Classic theme' },
  { level: 1, name: 'Hedge Fund Manager',  multiplier: 2, unlocks: 'Sunset theme' },
  { level: 2, name: 'Market Maker',        multiplier: 3, unlocks: 'Emerald theme' },
  { level: 3, name: 'Wolf of Wall Street', multiplier: 5, unlocks: 'Ocean theme' },
  { level: 4, name: 'Market Overlord',     multiplier: 8, unlocks: 'Midnight theme' },
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

const MAX_PORTFOLIO_LEVEL = 100;
const BASE_CYCLE_SECONDS = 8;
const BASE_HOLDING_VALUE = 15;
const MAX_OFFLINE_SECONDS = 28800; // 8 hours

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(120 * Math.pow(1.08, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Day Trader';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'The Illuminati';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = STOCKMOGUL_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getHoldingsPerCycle(portfolioLevel, prestigeLevel) {
  const effPort = effectiveLevel(portfolioLevel, STOCKMOGUL_UPGRADES.portfolio.decay);
  return (1 + effPort) * (1 + prestigeLevel * 0.5);
}

function getCycleSeconds(brokerLevel) {
  const eff = effectiveLevel(brokerLevel, STOCKMOGUL_UPGRADES.broker.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.12);
}

function getHoldingValue(analystLevel, portfolioLevel, prestigeLevel) {
  const effAnalyst = effectiveLevel(analystLevel, STOCKMOGUL_UPGRADES.analyst.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_HOLDING_VALUE * (1 + effAnalyst * 0.28) * (1 + portfolioLevel * 0.015) * prestigeMult;
}

function getIncomeMultiplier(insiderLevel, leverageLevel) {
  const effInsider = effectiveLevel(insiderLevel, STOCKMOGUL_UPGRADES.insider.decay);
  const effLeverage = effectiveLevel(leverageLevel, STOCKMOGUL_UPGRADES.leverage.decay);
  return (1 + effInsider * 0.08) * (1 + effLeverage * 0.12);
}

function getPortfolioCoinsPerCycle(upgrades, portfolioLevel, prestigeLevel) {
  const holdings = getHoldingsPerCycle(upgrades.portfolio || 0, prestigeLevel);
  const value = getHoldingValue(upgrades.analyst || 0, portfolioLevel, prestigeLevel);
  const mult = getIncomeMultiplier(upgrades.insider || 0, upgrades.leverage || 0);
  return Math.floor(holdings * value * mult);
}

function getIncomePerSecond(upgrades, portfolioLevel, prestigeLevel) {
  return getPortfolioCoinsPerCycle(upgrades, portfolioLevel, prestigeLevel) / getCycleSeconds(upgrades.broker || 0);
}

function getPortfolioCoinsCap(offshoreHoldLevel, prestigeLevel) {
  const effOH = effectiveLevel(offshoreHoldLevel, STOCKMOGUL_UPGRADES.offshore_hold.decay);
  return Math.floor(15000 * (1 + effOH * 0.6) * (1 + prestigeLevel * 1.0));
}

function getDividendBonus(dividendLevel) {
  const effDiv = effectiveLevel(dividendLevel, STOCKMOGUL_UPGRADES.dividend.decay);
  return 1 + effDiv * 0.14;
}

function calculatePendingPortfolioCoins(upgrades, portfolioLevel, prestigeLevel, lastCollectedAt, currentPortfolioCoins) {
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

  const cycleTime = getCycleSeconds(upgrades.broker || 0);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);
  const coinsPerCycle = getPortfolioCoinsPerCycle(upgrades, portfolioLevel, prestigeLevel);
  const holdingsPerCycle = getHoldingsPerCycle(upgrades.portfolio || 0, prestigeLevel);

  const cap = getPortfolioCoinsCap(upgrades.offshore_hold || 0, prestigeLevel);
  const alreadyHave = currentPortfolioCoins || 0;
  const spaceLeft = Math.max(0, cap - alreadyHave);
  const rawEarned = coinsPerCycle * cyclesCompleted;
  const cappedEarned = Math.min(rawEarned, spaceLeft);

  return {
    portfolioCoins: Math.floor(cappedEarned),
    tradesCompleted: cyclesCompleted,
    holdingsTraded: Math.floor(holdingsPerCycle) * cyclesCompleted,
    xpGained: Math.floor(cappedEarned / 100)
  };
}

function isCustomizationAllowed(category, value, prestigeLevel) {
  const catDef = CUSTOMIZATION_OPTIONS[category];
  if (!catDef) return false;
  const option = catDef.options.find(o => o.id === value);
  if (!option) return false;
  return prestigeLevel >= option.minPrestige;
}

function getAvailableCustomizations(prestigeLevel) {
  const result = {};
  for (const [category, catDef] of Object.entries(CUSTOMIZATION_OPTIONS)) {
    result[category] = {
      name: catDef.name,
      default: catDef.default,
      options: catDef.options.map(o => ({ ...o, locked: prestigeLevel < o.minPrestige }))
    };
  }
  return result;
}

function getUpgradeEffectPreview(upgradeType, currentLevel, portfolioLevel, prestigeLevel, upgrades) {
  const def = STOCKMOGUL_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'portfolio': {
      const cur = getHoldingsPerCycle(currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getHoldingsPerCycle(currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} holdings/cycle`, next: nxt !== null ? `${Math.floor(nxt)} holdings/cycle` : null };
    }
    case 'analyst': {
      const cur = getHoldingValue(currentLevel, portfolioLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getHoldingValue(currentLevel + 1, portfolioLevel, prestigeLevel) : null;
      return { current: `Value: ${Math.floor(cur)} ea`, next: nxt !== null ? `Value: ${Math.floor(nxt)} ea` : null };
    }
    case 'broker': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'insider': {
      const cur = effectiveLevel(currentLevel, def.decay);
      const nxt = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return { current: `+${Math.floor(cur * 8)}% bonus`, next: nxt !== null ? `+${Math.floor(nxt * 8)}% bonus` : null };
    }
    case 'offshore_hold': {
      const cur = getPortfolioCoinsCap(currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getPortfolioCoinsCap(currentLevel + 1, prestigeLevel) : null;
      return { current: `Cap: ${Math.floor(cur).toLocaleString()}`, next: nxt !== null ? `Cap: ${Math.floor(nxt).toLocaleString()}` : null };
    }
    case 'leverage': {
      const cur = effectiveLevel(currentLevel, def.decay);
      const nxt = currentLevel < def.maxLevel ? effectiveLevel(currentLevel + 1, def.decay) : null;
      return { current: `+${Math.floor(cur * 12)}% amplify`, next: nxt !== null ? `+${Math.floor(nxt * 12)}% amplify` : null };
    }
    case 'dividend': {
      const cur = getDividendBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getDividendBonus(currentLevel + 1) : null;
      return { current: `+${Math.floor((cur - 1) * 100)}% on collect`, next: nxt !== null ? `+${Math.floor((nxt - 1) * 100)}% on collect` : null };
    }
    default: return { current: '', next: null };
  }
}

function calculateMaxBuy(upgradeType, currentLevel, availableCleanCash) {
  const def = STOCKMOGUL_UPGRADES[upgradeType];
  if (!def) return { levels: 0, totalCost: 0 };
  let levels = 0, totalCost = 0, lvl = currentLevel;
  while (lvl < def.maxLevel) {
    const cost = getUpgradeCost(upgradeType, lvl);
    if (totalCost + cost > availableCleanCash) break;
    totalCost += cost;
    lvl++;
    levels++;
  }
  return { levels, totalCost };
}

module.exports = {
  STOCKMOGUL_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_PORTFOLIO_LEVEL,
  BASE_CYCLE_SECONDS,
  BASE_HOLDING_VALUE,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getHoldingsPerCycle,
  getCycleSeconds,
  getHoldingValue,
  getIncomeMultiplier,
  getPortfolioCoinsPerCycle,
  getIncomePerSecond,
  getPortfolioCoinsCap,
  getDividendBonus,
  calculatePendingPortfolioCoins,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
