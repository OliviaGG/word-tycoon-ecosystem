// ==================== STARTUP CONFIG ====================
// Startup management business: collects real XP directly.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const STARTUP_UPGRADES = {
  engineers: {
    name: 'Engineers',
    emoji: '🧑‍💻',
    desc: 'More product work per cycle',
    effect: 'Adds more launches per cycle (diminishing)',
    baseCost: 2500000,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.95
  },
  automation: {
    name: 'Automation',
    emoji: '🤖',
    desc: 'Faster deployment cycles',
    effect: 'Reduces cycle time by 0.22s per level (diminishing)',
    baseCost: 3500000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.97
  },
  product: {
    name: 'Product Upgrades',
    emoji: '📱',
    desc: 'Higher-value releases',
    effect: '+10% launch value per level (diminishing)',
    baseCost: 6500000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.91
  },
  ads: {
    name: 'Growth Ads',
    emoji: '📈',
    desc: 'More revenue per launch',
    effect: '+4% launch income per level (diminishing)',
    baseCost: 4800000,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  servers: {
    name: 'Server Fleet',
    emoji: '🖥️',
    desc: 'More users served each cycle',
    effect: 'Adds more users per cycle (diminishing)',
    baseCost: 9000000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.93
  },
  partnerships: {
    name: 'Partnerships',
    emoji: '🤝',
    desc: 'Better monetization and distribution',
    effect: '+5% launch income per level (diminishing)',
    baseCost: 12000000,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.92
  },
  investors: {
    name: 'Investors',
    emoji: '💸',
    desc: 'Bonus XP on collection',
    effect: '+16% collection bonus per level (diminishing)',
    baseCost: 18000000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Garage Build', multiplier: 1, unlocks: 'Classic theme' },
  { level: 1, name: 'Seed Stage', multiplier: 2, unlocks: 'Sunset theme' },
  { level: 2, name: 'Series A', multiplier: 3, unlocks: 'Emerald theme' },
  { level: 3, name: 'Unicorn', multiplier: 5, unlocks: 'Ocean theme' },
  { level: 4, name: 'Decacorn', multiplier: 8, unlocks: 'Midnight theme' }
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

const MAX_STARTUP_LEVEL = 100;
const BASE_CYCLE_SECONDS = 15;
const BASE_LAUNCH_VALUE = 40000;
const MAX_OFFLINE_SECONDS = 28800;
const COLLECT_CAPS = {
  0: 900000000,
  1: 3000000000,
  2: 9000000000,
  3: 25000000000,
  4: 60000000000
};

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(240 * Math.pow(1.095, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getCollectCap(prestigeLevel) {
  if (prestigeLevel <= 0) return COLLECT_CAPS[0];
  if (prestigeLevel <= 4) return COLLECT_CAPS[prestigeLevel];
  return COLLECT_CAPS[4] + 12000000000 * (prestigeLevel - 4);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Garage Build';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Decacorn+';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = STARTUP_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getLaunchesPerCycle(engineersLevel, serversLevel, prestigeLevel) {
  const effEngineers = effectiveLevel(engineersLevel, STARTUP_UPGRADES.engineers.decay);
  const effServers = effectiveLevel(serversLevel, STARTUP_UPGRADES.servers.decay);
  return (2 + (effEngineers * 0.4) + (effServers * 0.55)) * (1 + prestigeLevel * 0.55);
}

function getCycleSeconds(automationLevel) {
  const eff = effectiveLevel(automationLevel, STARTUP_UPGRADES.automation.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.22);
}

function getLaunchValue(productLevel, startupLevel, prestigeLevel) {
  const effProduct = effectiveLevel(productLevel, STARTUP_UPGRADES.product.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_LAUNCH_VALUE * (1 + effProduct * 0.10) * (1 + startupLevel * 0.013) * prestigeMult;
}

function getAdsBonus(level) {
  const eff = effectiveLevel(level, STARTUP_UPGRADES.ads.decay);
  return 1 + eff * 0.04;
}

function getPartnershipsBonus(level) {
  const eff = effectiveLevel(level, STARTUP_UPGRADES.partnerships.decay);
  return 1 + eff * 0.05;
}

function getInvestorBonus(level) {
  const eff = effectiveLevel(level, STARTUP_UPGRADES.investors.decay);
  return 1 + eff * 0.16;
}

function getIncomePerCycle(upgrades, startupLevel, prestigeLevel) {
  const launches = getLaunchesPerCycle(upgrades.engineers || 0, upgrades.servers || 0, prestigeLevel);
  const launchValue = getLaunchValue(upgrades.product || 0, startupLevel, prestigeLevel);
  const ads = getAdsBonus(upgrades.ads || 0);
  const partnerships = getPartnershipsBonus(upgrades.partnerships || 0);
  return Math.floor(launches * launchValue * ads * partnerships);
}

function getIncomePerSecond(upgrades, startupLevel, prestigeLevel) {
  return getIncomePerCycle(upgrades, startupLevel, prestigeLevel) / getCycleSeconds(upgrades.automation || 0);
}

function calculatePendingIncome(upgrades, startupLevel, prestigeLevel, lastCollectedAt, investorsLevel) {
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
  const cycleTime = getCycleSeconds(upgrades.automation || 0);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);
  const incomePerCycle = getIncomePerCycle(upgrades, startupLevel, prestigeLevel);
  const launchesPerCycle = getLaunchesPerCycle(upgrades.engineers || 0, upgrades.servers || 0, prestigeLevel);
  const investorBonus = getInvestorBonus(investorsLevel);

  let xpEarned = Math.floor(incomePerCycle * cyclesCompleted * investorBonus);
  const collectCap = getCollectCap(prestigeLevel);
  const capped = xpEarned > collectCap;
  if (capped) xpEarned = collectCap;

  return {
    xpEarned,
    launchesCompleted: cyclesCompleted,
    usersServed: Math.floor(launchesPerCycle) * cyclesCompleted,
    xpGained: Math.floor(Math.max(1, launchesPerCycle) * cyclesCompleted),
    collectCap,
    capped
  };
}

function isCustomizationAllowed(category, value, prestigeLevel) {
  const catDef = CUSTOMIZATION_OPTIONS[category];
  if (!catDef) return false;
  const option = catDef.options.find((o) => o.id === value);
  if (!option) return false;
  return prestigeLevel >= option.minPrestige;
}

function getAvailableCustomizations(prestigeLevel) {
  const result = {};
  for (const [category, catDef] of Object.entries(CUSTOMIZATION_OPTIONS)) {
    result[category] = {
      name: catDef.name,
      default: catDef.default,
      options: catDef.options.map((o) => ({
        ...o,
        locked: prestigeLevel < o.minPrestige
      }))
    };
  }
  return result;
}

function getUpgradeEffectPreview(upgradeType, currentLevel, startupLevel, prestigeLevel, upgrades) {
  const def = STARTUP_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'engineers': {
      const cur = getLaunchesPerCycle(currentLevel, upgrades.servers || 0, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getLaunchesPerCycle(currentLevel + 1, upgrades.servers || 0, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} launches/cycle`, next: nxt !== null ? `${Math.floor(nxt)} launches/cycle` : null };
    }
    case 'automation': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'product': {
      const cur = getLaunchValue(currentLevel, startupLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getLaunchValue(currentLevel + 1, startupLevel, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} XP/launch`, next: nxt !== null ? `${Math.floor(nxt)} XP/launch` : null };
    }
    case 'ads': {
      const cur = getAdsBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getAdsBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'servers': {
      const cur = getLaunchesPerCycle(upgrades.engineers || 0, currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getLaunchesPerCycle(upgrades.engineers || 0, currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} launches/cycle`, next: nxt !== null ? `${Math.floor(nxt)} launches/cycle` : null };
    }
    case 'partnerships': {
      const cur = getPartnershipsBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getPartnershipsBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'investors': {
      const cur = getInvestorBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getInvestorBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% collect bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% collect bonus` : null };
    }
    default:
      return { current: '', next: null };
  }
}

function calculateMaxBuy(upgradeType, currentLevel, availableCurrency) {
  const def = STARTUP_UPGRADES[upgradeType];
  if (!def) return { levels: 0, totalCost: 0 };

  let levels = 0;
  let totalCost = 0;
  let level = currentLevel;
  let funds = availableCurrency;
  while (level < def.maxLevel) {
    const cost = getUpgradeCost(upgradeType, level);
    if (cost > funds) break;
    funds -= cost;
    totalCost += cost;
    level++;
    levels++;
  }
  return { levels, totalCost };
}

module.exports = {
  STARTUP_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_STARTUP_LEVEL,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getCollectCap,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getLaunchesPerCycle,
  getCycleSeconds,
  getLaunchValue,
  getAdsBonus,
  getPartnershipsBonus,
  getInvestorBonus,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
