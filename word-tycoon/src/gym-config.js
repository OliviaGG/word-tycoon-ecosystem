// ==================== GYM CONFIG ====================
// Gym management business: accumulates gym points from members trained.
// Gym points are spent on upgrades and a portion converts to real coins on collect.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const GYM_UPGRADES = {
  equipment: {
    name: 'Equipment',
    emoji: '🏋️',
    desc: 'More stations means more members per session',
    effect: 'Adds more members per cycle (diminishing)',
    baseCost: 150000,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.95
  },
  trainers: {
    name: 'Personal Trainers',
    emoji: '💪',
    desc: 'Keeps workouts moving faster',
    effect: 'Reduces cycle time by 0.15s per level (diminishing)',
    baseCost: 225000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.97
  },
  classes: {
    name: 'Group Classes',
    emoji: '🧘',
    desc: 'Higher-value workouts and memberships',
    effect: '+8% member value per level (diminishing)',
    baseCost: 500000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.90
  },
  supplements: {
    name: 'Supplement Bar',
    emoji: '🥤',
    desc: 'Extra profit per member',
    effect: '+3% gym point gain per level (diminishing)',
    baseCost: 350000,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  cardio: {
    name: 'Cardio Wing',
    emoji: '🏃',
    desc: 'More members stick around every cycle',
    effect: 'Adds more members per cycle (diminishing)',
    baseCost: 650000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.93
  },
  branding: {
    name: 'Branding',
    emoji: '📣',
    desc: 'More signups and stronger prestige scaling',
    effect: '+4% gym point gain per level (diminishing)',
    baseCost: 900000,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.92
  },
  membership: {
    name: 'Premium Membership',
    emoji: '🎟️',
    desc: 'Bonus points on collection',
    effect: '+14% collection bonus per level (diminishing)',
    baseCost: 1500000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Neighborhood Gym', multiplier: 1, unlocks: 'Classic theme' },
  { level: 1, name: 'Fitness Club', multiplier: 2, unlocks: 'Sunset theme' },
  { level: 2, name: 'Athletic Center', multiplier: 3, unlocks: 'Emerald theme' },
  { level: 3, name: 'Iron Empire', multiplier: 5, unlocks: 'Ocean theme' },
  { level: 4, name: 'Titanium League', multiplier: 8, unlocks: 'Midnight theme' }
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

const MAX_GYM_LEVEL = 100;
const BASE_CYCLE_SECONDS = 10;
const BASE_MEMBER_VALUE = 4000;
const MAX_OFFLINE_SECONDS = 28800;
const COLLECT_CAPS = {
  0: 12_000_000,
  1: 40_000_000,
  2: 125_000_000,
  3: 350_000_000,
  4: 900_000_000
};

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(120 * Math.pow(1.085, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getCollectCap(prestigeLevel) {
  if (prestigeLevel <= 0) return COLLECT_CAPS[0];
  if (prestigeLevel <= 4) return COLLECT_CAPS[prestigeLevel];
  return COLLECT_CAPS[4] + 300_000_000 * (prestigeLevel - 4);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Neighborhood Gym';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Titanium+';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = GYM_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getMembersPerCycle(equipmentLevel, cardioLevel, prestigeLevel) {
  const effEquipment = effectiveLevel(equipmentLevel, GYM_UPGRADES.equipment.decay);
  const effCardio = effectiveLevel(cardioLevel, GYM_UPGRADES.cardio.decay);
  return (3 + (effEquipment * 0.35) + (effCardio * 0.5)) * (1 + prestigeLevel * 0.45);
}

function getCycleSeconds(trainersLevel) {
  const eff = effectiveLevel(trainersLevel, GYM_UPGRADES.trainers.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.15);
}

function getMemberValue(classesLevel, gymLevel, prestigeLevel) {
  const effClasses = effectiveLevel(classesLevel, GYM_UPGRADES.classes.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_MEMBER_VALUE * (1 + effClasses * 0.08) * (1 + gymLevel * 0.01) * prestigeMult;
}

function getSupplementsBonus(level) {
  const eff = effectiveLevel(level, GYM_UPGRADES.supplements.decay);
  return 1 + eff * 0.03;
}

function getBrandingBonus(level) {
  const eff = effectiveLevel(level, GYM_UPGRADES.branding.decay);
  return 1 + eff * 0.04;
}

function getMembershipBonus(level) {
  const eff = effectiveLevel(level, GYM_UPGRADES.membership.decay);
  return 1 + eff * 0.14;
}

function getIncomePerCycle(upgrades, gymLevel, prestigeLevel) {
  const members = getMembersPerCycle(upgrades.equipment || 0, upgrades.cardio || 0, prestigeLevel);
  const value = getMemberValue(upgrades.classes || 0, gymLevel, prestigeLevel);
  const supplements = getSupplementsBonus(upgrades.supplements || 0);
  const branding = getBrandingBonus(upgrades.branding || 0);
  return Math.floor(members * value * supplements * branding);
}

function getIncomePerSecond(upgrades, gymLevel, prestigeLevel) {
  const cycleTime = getCycleSeconds(upgrades.trainers || 0);
  return getIncomePerCycle(upgrades, gymLevel, prestigeLevel) / cycleTime;
}

function calculatePendingIncome(upgrades, gymLevel, prestigeLevel, lastCollectedAt, membershipLevel) {
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
  const cycleTime = getCycleSeconds(upgrades.trainers || 0);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);

  const incomePerCycle = getIncomePerCycle(upgrades, gymLevel, prestigeLevel);
  const membersPerCycle = getMembersPerCycle(upgrades.equipment || 0, upgrades.cardio || 0, prestigeLevel);
  const membershipBonus = getMembershipBonus(membershipLevel);
  let xpEarned = Math.floor(incomePerCycle * cyclesCompleted * membershipBonus);
  const collectCap = getCollectCap(prestigeLevel);
  const capped = xpEarned > collectCap;
  if (capped) xpEarned = collectCap;

  return {
    xpEarned,
    membersTrained: Math.floor(membersPerCycle) * cyclesCompleted,
    xpGained: Math.floor(Math.max(1, membersPerCycle) * cyclesCompleted),
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

function getUpgradeEffectPreview(upgradeType, currentLevel, gymLevel, prestigeLevel, upgrades) {
  const def = GYM_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'equipment': {
      const cur = getMembersPerCycle(currentLevel, upgrades.cardio || 0, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getMembersPerCycle(currentLevel + 1, upgrades.cardio || 0, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} members/cycle`, next: nxt !== null ? `${Math.floor(nxt)} members/cycle` : null };
    }
    case 'trainers': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'classes': {
      const cur = getMemberValue(currentLevel, gymLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getMemberValue(currentLevel + 1, gymLevel, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} pts/member`, next: nxt !== null ? `${Math.floor(nxt)} pts/member` : null };
    }
    case 'supplements': {
      const cur = getSupplementsBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getSupplementsBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'cardio': {
      const cur = getMembersPerCycle(upgrades.equipment || 0, currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getMembersPerCycle(upgrades.equipment || 0, currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} members/cycle`, next: nxt !== null ? `${Math.floor(nxt)} members/cycle` : null };
    }
    case 'branding': {
      const cur = getBrandingBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getBrandingBonus(currentLevel + 1) : null;
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
  const def = GYM_UPGRADES[upgradeType];
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
  GYM_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_GYM_LEVEL,
  getCollectCap,
  effectiveLevel,
  xpForLevel,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getMembersPerCycle,
  getCycleSeconds,
  getMemberValue,
  getSupplementsBonus,
  getBrandingBonus,
  getMembershipBonus,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
