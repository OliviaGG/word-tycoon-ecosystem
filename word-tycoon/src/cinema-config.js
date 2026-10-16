// ==================== CINEMA CONFIG ====================
// Cinema management business: collects real XP directly.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const CINEMA_UPGRADES = {
  screens: {
    name: 'Screens',
    emoji: '🎞️',
    desc: 'More screenings per cycle',
    effect: 'Adds more screenings per cycle (diminishing)',
    baseCost: 900000,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.95
  },
  projectors: {
    name: 'Projectors',
    emoji: '📽️',
    desc: 'Faster turnaround between shows',
    effect: 'Reduces cycle time by 0.18s per level (diminishing)',
    baseCost: 1300000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.97
  },
  premium: {
    name: 'Premium Formats',
    emoji: '✨',
    desc: 'Higher-value ticket packages',
    effect: '+9% ticket value per level (diminishing)',
    baseCost: 2500000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.91
  },
  concessions: {
    name: 'Concessions',
    emoji: '🍿',
    desc: 'Extra revenue per visitor',
    effect: '+3.5% show income per level (diminishing)',
    baseCost: 1800000,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  seating: {
    name: 'Seating Capacity',
    emoji: '💺',
    desc: 'More viewers per screening',
    effect: 'Adds more viewers per cycle (diminishing)',
    baseCost: 3200000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.93
  },
  marketing: {
    name: 'Marketing Blitz',
    emoji: '🎟️',
    desc: 'Keeps attendance high',
    effect: '+4.5% show income per level (diminishing)',
    baseCost: 4500000,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.92
  },
  membership: {
    name: 'VIP Memberships',
    emoji: '🌟',
    desc: 'Bonus XP on collection',
    effect: '+15% collection bonus per level (diminishing)',
    baseCost: 7000000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Neighborhood Theater', multiplier: 1, unlocks: 'Classic theme' },
  { level: 1, name: 'Multiplex', multiplier: 2, unlocks: 'Sunset theme' },
  { level: 2, name: 'Premiere House', multiplier: 3, unlocks: 'Emerald theme' },
  { level: 3, name: 'Red Carpet Empire', multiplier: 5, unlocks: 'Ocean theme' },
  { level: 4, name: 'Silver Screen Legend', multiplier: 8, unlocks: 'Midnight theme' }
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

const MAX_CINEMA_LEVEL = 100;
const BASE_CYCLE_SECONDS = 12;
const BASE_TICKET_VALUE = 22000;
const MAX_OFFLINE_SECONDS = 28800;
const COLLECT_CAPS = {
  0: 300000000,
  1: 1200000000,
  2: 3500000000,
  3: 9000000000,
  4: 22000000000
};

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(180 * Math.pow(1.09, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getCollectCap(prestigeLevel) {
  if (prestigeLevel <= 0) return COLLECT_CAPS[0];
  if (prestigeLevel <= 4) return COLLECT_CAPS[prestigeLevel];
  return COLLECT_CAPS[4] + 5000000000 * (prestigeLevel - 4);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Neighborhood Theater';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Silver Screen+';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = CINEMA_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getShowsPerCycle(screensLevel, seatingLevel, prestigeLevel) {
  const effScreens = effectiveLevel(screensLevel, CINEMA_UPGRADES.screens.decay);
  const effSeating = effectiveLevel(seatingLevel, CINEMA_UPGRADES.seating.decay);
  return (2 + (effScreens * 0.45) + (effSeating * 0.6)) * (1 + prestigeLevel * 0.5);
}

function getCycleSeconds(projectorLevel) {
  const eff = effectiveLevel(projectorLevel, CINEMA_UPGRADES.projectors.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.18);
}

function getTicketValue(premiumLevel, cinemaLevel, prestigeLevel) {
  const effPremium = effectiveLevel(premiumLevel, CINEMA_UPGRADES.premium.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_TICKET_VALUE * (1 + effPremium * 0.09) * (1 + cinemaLevel * 0.012) * prestigeMult;
}

function getConcessionsBonus(level) {
  const eff = effectiveLevel(level, CINEMA_UPGRADES.concessions.decay);
  return 1 + eff * 0.035;
}

function getMarketingBonus(level) {
  const eff = effectiveLevel(level, CINEMA_UPGRADES.marketing.decay);
  return 1 + eff * 0.045;
}

function getMembershipBonus(level) {
  const eff = effectiveLevel(level, CINEMA_UPGRADES.membership.decay);
  return 1 + eff * 0.15;
}

function getIncomePerCycle(upgrades, cinemaLevel, prestigeLevel) {
  const shows = getShowsPerCycle(upgrades.screens || 0, upgrades.seating || 0, prestigeLevel);
  const ticketValue = getTicketValue(upgrades.premium || 0, cinemaLevel, prestigeLevel);
  const concessions = getConcessionsBonus(upgrades.concessions || 0);
  const marketing = getMarketingBonus(upgrades.marketing || 0);
  return Math.floor(shows * ticketValue * concessions * marketing);
}

function getIncomePerSecond(upgrades, cinemaLevel, prestigeLevel) {
  return getIncomePerCycle(upgrades, cinemaLevel, prestigeLevel) / getCycleSeconds(upgrades.projectors || 0);
}

function calculatePendingIncome(upgrades, cinemaLevel, prestigeLevel, lastCollectedAt, membershipLevel) {
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
  const cycleTime = getCycleSeconds(upgrades.projectors || 0);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);
  const incomePerCycle = getIncomePerCycle(upgrades, cinemaLevel, prestigeLevel);
  const showsPerCycle = getShowsPerCycle(upgrades.screens || 0, upgrades.seating || 0, prestigeLevel);
  const membershipBonus = getMembershipBonus(membershipLevel);

  let xpEarned = Math.floor(incomePerCycle * cyclesCompleted * membershipBonus);
  const collectCap = getCollectCap(prestigeLevel);
  const capped = xpEarned > collectCap;
  if (capped) xpEarned = collectCap;

  return {
    xpEarned,
    showsRun: cyclesCompleted,
    viewersServed: Math.floor(showsPerCycle) * cyclesCompleted,
    xpGained: Math.floor(Math.max(1, showsPerCycle) * cyclesCompleted),
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

function getUpgradeEffectPreview(upgradeType, currentLevel, cinemaLevel, prestigeLevel, upgrades) {
  const def = CINEMA_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'screens': {
      const cur = getShowsPerCycle(currentLevel, upgrades.seating || 0, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getShowsPerCycle(currentLevel + 1, upgrades.seating || 0, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} shows/cycle`, next: nxt !== null ? `${Math.floor(nxt)} shows/cycle` : null };
    }
    case 'projectors': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'premium': {
      const cur = getTicketValue(currentLevel, cinemaLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getTicketValue(currentLevel + 1, cinemaLevel, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} XP/show`, next: nxt !== null ? `${Math.floor(nxt)} XP/show` : null };
    }
    case 'concessions': {
      const cur = getConcessionsBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getConcessionsBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'seating': {
      const cur = getShowsPerCycle(upgrades.screens || 0, currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getShowsPerCycle(upgrades.screens || 0, currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} shows/cycle`, next: nxt !== null ? `${Math.floor(nxt)} shows/cycle` : null };
    }
    case 'marketing': {
      const cur = getMarketingBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getMarketingBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'membership': {
      const cur = getMembershipBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getMembershipBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% collect bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% collect bonus` : null };
    }
    default:
      return { current: '', next: null };
  }
}

function calculateMaxBuy(upgradeType, currentLevel, availableCurrency) {
  const def = CINEMA_UPGRADES[upgradeType];
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
  CINEMA_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_CINEMA_LEVEL,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getCollectCap,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getShowsPerCycle,
  getCycleSeconds,
  getTicketValue,
  getConcessionsBonus,
  getMarketingBonus,
  getMembershipBonus,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
