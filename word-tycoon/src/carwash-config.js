// ==================== CAR WASH CONFIG ====================
// Car Wash minigame: accumulates "clean cash" by laundering a % of total business income.
// Clean cash is used exclusively for the Stock Mogul business.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const CARWASH_UPGRADES = {
  bays: {
    name: 'Wash Bays',
    emoji: '🚗',
    desc: 'More bays, more cars per cycle',
    effect: '+1 car per cycle per level (diminishing)',
    baseCost: 300,
    costMultiplier: 1.08,
    maxLevel: 100,
    decay: 0.95
  },
  dryers: {
    name: 'Speed Dryers',
    emoji: '💨',
    desc: 'Faster cycle time',
    effect: 'Reduces cycle time by 0.1s per level (diminishing)',
    baseCost: 600,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.97
  },
  detailing: {
    name: 'Detail Packages',
    emoji: '✨',
    desc: 'Premium wash options',
    effect: '+25% wash value per level (diminishing)',
    baseCost: 1500,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.91
  },
  staff: {
    name: 'Hired Staff',
    emoji: '👷',
    desc: 'More workers, more income',
    effect: '+10% income per level (diminishing)',
    baseCost: 1000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.94
  },
  cameras: {
    name: 'Security Cameras',
    emoji: '📷',
    desc: 'Increases clean cash storage cap',
    effect: 'Strongly increases clean cash storage cap',
    baseCost: 2000,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.93
  },
  shell: {
    name: 'Shell Companies',
    emoji: '🏢',
    desc: 'Increases laundering rate',
    effect: '+0.3% laundering rate per level (diminishing)',
    baseCost: 5000,
    costMultiplier: 1.14,
    maxLevel: 100,
    decay: 0.88
  },
  offshore: {
    name: 'Offshore Accounts',
    emoji: '🏦',
    desc: 'Bonus on clean cash collections',
    effect: '+12% collection bonus per level (diminishing)',
    baseCost: 8000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Neighborhood Wash', multiplier: 1,  unlocks: 'Classic theme' },
  { level: 1, name: 'Sudsy Business',    multiplier: 2,  unlocks: 'Sunset theme' },
  { level: 2, name: 'The Rinse Cycle',   multiplier: 3,  unlocks: 'Emerald theme' },
  { level: 3, name: 'Money Bubbles',     multiplier: 5,  unlocks: 'Ocean theme' },
  { level: 4, name: 'The Syndicate',     multiplier: 8,  unlocks: 'Midnight theme' },
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

const MAX_SHOP_LEVEL = 100;
const BASE_CYCLE_SECONDS = 6;
const BASE_WASH_VALUE = 8;
const MAX_OFFLINE_SECONDS = 28800; // 8 hours

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(100 * Math.pow(1.08, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Neighborhood Wash';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'El Jefe';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = CARWASH_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getCarsPerCycle(baysLevel, prestigeLevel) {
  const effBays = effectiveLevel(baysLevel, CARWASH_UPGRADES.bays.decay);
  return (1 + effBays) * (1 + prestigeLevel * 0.5);
}

function getCycleSeconds(dryersLevel) {
  const eff = effectiveLevel(dryersLevel, CARWASH_UPGRADES.dryers.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.1);
}

function getWashValue(detailingLevel, shopLevel, prestigeLevel) {
  const effDetail = effectiveLevel(detailingLevel, CARWASH_UPGRADES.detailing.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_WASH_VALUE * (1 + effDetail * 0.25) * (1 + shopLevel * 0.015) * prestigeMult;
}

function getStaffBonus(staffLevel) {
  const effStaff = effectiveLevel(staffLevel, CARWASH_UPGRADES.staff.decay);
  return 1 + effStaff * 0.10;
}

function getIncomePerCycle(upgrades, shopLevel, prestigeLevel) {
  const baysLevel = upgrades.bays || 0;
  const detailingLevel = upgrades.detailing || 0;
  const staffLevel = upgrades.staff || 0;
  const cars = getCarsPerCycle(baysLevel, prestigeLevel);
  const value = getWashValue(detailingLevel, shopLevel, prestigeLevel);
  const staffMult = getStaffBonus(staffLevel);
  return Math.floor(cars * value * staffMult);
}

function getIncomePerSecond(upgrades, shopLevel, prestigeLevel) {
  const dryersLevel = upgrades.dryers || 0;
  const cycleTime = getCycleSeconds(dryersLevel);
  return getIncomePerCycle(upgrades, shopLevel, prestigeLevel) / cycleTime;
}

// Laundering rate: what % of total business income becomes clean cash per second
// Returns a decimal (e.g., 0.025 = 2.5%)
function getLaunderingRate(shellLevel, prestigeLevel) {
  const effShell = effectiveLevel(shellLevel, CARWASH_UPGRADES.shell.decay);
  const base = 0.015 + effShell * 0.003;
  const prestigeBonus = 1 + prestigeLevel * 0.25;
  return Math.min(0.15, base * prestigeBonus); // cap at 15%
}

// Clean cash storage cap
function getCleanCashCap(camerasLevel, prestigeLevel) {
  const cameraGrowth = Math.pow(1.107, Math.max(0, camerasLevel));
  const prestigeGrowth = Math.pow(1.65, Math.max(0, prestigeLevel));
  return Math.floor(345800 * cameraGrowth * prestigeGrowth);
}

// Offshore bonus: applied at collection time
function getOffshoreBonus(offshoreLevel) {
  const effOffshore = effectiveLevel(offshoreLevel, CARWASH_UPGRADES.offshore.decay);
  return 1 + effOffshore * 0.12;
}

// Calculate pending clean cash (does NOT accumulate regular coins - that is handled by the engine)
// totalBizIncomePerSec: the player's total business income per second (all businesses combined)
function calculatePendingCleanCash(upgrades, shopLevel, prestigeLevel, lastCollectedAt, totalBizIncomePerSec, currentCleanCash) {
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

  const launderingRate = getLaunderingRate(upgrades.shell || 0, prestigeLevel);
  const cleanCashPerSec = launderingRate * Math.max(0, totalBizIncomePerSec);
  const rawEarned = cleanCashPerSec * elapsedSeconds;

  // Apply offshore collection bonus (only when collecting, not in live display)
  const carsWashed = Math.floor(getCarsPerCycle(upgrades.bays || 0, prestigeLevel) * elapsedSeconds / getCycleSeconds(upgrades.dryers || 0));

  const camerasLevel = upgrades.cameras || 0;
  const cap = getCleanCashCap(camerasLevel, prestigeLevel);
  const alreadyHave = currentCleanCash || 0;
  const spaceLeft = Math.max(0, cap - alreadyHave);
  const cappedEarned = Math.min(rawEarned, spaceLeft);

  return {
    cleanCash: Math.floor(cappedEarned),
    carsWashed: Math.max(0, carsWashed),
    xpGained: Math.floor(cappedEarned / 100) // 1 XP per 100 clean cash earned
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
      options: catDef.options.map(o => ({
        ...o,
        locked: prestigeLevel < o.minPrestige
      }))
    };
  }
  return result;
}

function getUpgradeEffectPreview(upgradeType, currentLevel, shopLevel, prestigeLevel, upgrades) {
  const def = CARWASH_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'bays': {
      const cur = getCarsPerCycle(currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getCarsPerCycle(currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} cars/cycle`, next: nxt !== null ? `${Math.floor(nxt)} cars/cycle` : null };
    }
    case 'dryers': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'detailing': {
      const cur = getWashValue(currentLevel, shopLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getWashValue(currentLevel + 1, shopLevel, prestigeLevel) : null;
      return { current: `Value: ${Math.floor(cur)} ea`, next: nxt !== null ? `Value: ${Math.floor(nxt)} ea` : null };
    }
    case 'staff': {
      const cur = getStaffBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getStaffBonus(currentLevel + 1) : null;
      return { current: `+${Math.floor((cur-1)*100)}% bonus`, next: nxt !== null ? `+${Math.floor((nxt-1)*100)}% bonus` : null };
    }
    case 'cameras': {
      const cur = getCleanCashCap(currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getCleanCashCap(currentLevel + 1, prestigeLevel) : null;
      return { current: `Cap: ${Math.floor(cur).toLocaleString()}`, next: nxt !== null ? `Cap: ${Math.floor(nxt).toLocaleString()}` : null };
    }
    case 'shell': {
      const cur = getLaunderingRate(currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getLaunderingRate(currentLevel + 1, prestigeLevel) : null;
      return { current: `${(cur*100).toFixed(2)}% launder rate`, next: nxt !== null ? `${(nxt*100).toFixed(2)}% launder rate` : null };
    }
    case 'offshore': {
      const cur = getOffshoreBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getOffshoreBonus(currentLevel + 1) : null;
      return { current: `+${Math.floor((cur-1)*100)}% bonus`, next: nxt !== null ? `+${Math.floor((nxt-1)*100)}% bonus` : null };
    }
    default: return { current: '', next: null };
  }
}

function calculateMaxBuy(upgradeType, currentLevel, availableCoins) {
  const def = CARWASH_UPGRADES[upgradeType];
  if (!def) return { levels: 0, totalCost: 0 };
  let levels = 0, totalCost = 0, lvl = currentLevel;
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
  CARWASH_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_SHOP_LEVEL,
  BASE_CYCLE_SECONDS,
  BASE_WASH_VALUE,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getCarsPerCycle,
  getCycleSeconds,
  getWashValue,
  getStaffBonus,
  getIncomePerCycle,
  getIncomePerSecond,
  getLaunderingRate,
  getCleanCashCap,
  getOffshoreBonus,
  calculatePendingCleanCash,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
