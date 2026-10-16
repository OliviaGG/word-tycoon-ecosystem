// ==================== BANK CONFIG ====================
// Bank management business: collects real XP directly.

function effectiveLevel(level, decay) {
  if (level <= 0) return 0;
  if (decay >= 1) return level;
  return (1 - Math.pow(decay, level)) / (1 - decay);
}

const BANK_UPGRADES = {
  branches: {
    name: 'Branches',
    emoji: '🏦',
    desc: 'More branch throughput per cycle',
    effect: 'Adds more transactions per cycle (diminishing)',
    baseCost: 9000000,
    costMultiplier: 1.09,
    maxLevel: 100,
    decay: 0.95
  },
  systems: {
    name: 'Core Systems',
    emoji: '💾',
    desc: 'Faster processing cycles',
    effect: 'Reduces cycle time by 0.26s per level (diminishing)',
    baseCost: 13000000,
    costMultiplier: 1.10,
    maxLevel: 100,
    decay: 0.97
  },
  lending: {
    name: 'Lending Desk',
    emoji: '📄',
    desc: 'Higher-value transactions',
    effect: '+11% transaction value per level (diminishing)',
    baseCost: 24000000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.91
  },
  vaults: {
    name: 'Vault Network',
    emoji: '🔐',
    desc: 'Extra revenue multiplier',
    effect: '+4.5% bank income per level (diminishing)',
    baseCost: 18000000,
    costMultiplier: 1.11,
    maxLevel: 100,
    decay: 0.94
  },
  clients: {
    name: 'Institutional Clients',
    emoji: '💼',
    desc: 'More volume every cycle',
    effect: 'Adds more transactions per cycle (diminishing)',
    baseCost: 32000000,
    costMultiplier: 1.12,
    maxLevel: 100,
    decay: 0.93
  },
  treasury: {
    name: 'Treasury Ops',
    emoji: '🪙',
    desc: 'Improves monetization across the whole bank',
    effect: '+5.5% bank income per level (diminishing)',
    baseCost: 42000000,
    costMultiplier: 1.13,
    maxLevel: 100,
    decay: 0.92
  },
  private_banking: {
    name: 'Private Banking',
    emoji: '👑',
    desc: 'Bonus XP on collection',
    effect: '+17% collection bonus per level (diminishing)',
    baseCost: 70000000,
    costMultiplier: 1.15,
    maxLevel: 100,
    decay: 0.90
  }
};

const PRESTIGE_TIERS = [
  { level: 0, name: 'Community Bank', multiplier: 1, unlocks: 'Classic theme' },
  { level: 1, name: 'Regional Bank', multiplier: 2, unlocks: 'Sunset theme' },
  { level: 2, name: 'National Bank', multiplier: 3, unlocks: 'Emerald theme' },
  { level: 3, name: 'Global Bank', multiplier: 5, unlocks: 'Ocean theme' },
  { level: 4, name: 'Titan Bank', multiplier: 8, unlocks: 'Midnight theme' }
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

const MAX_BANK_LEVEL = 100;
const BASE_CYCLE_SECONDS = 20;
const BASE_TRANSACTION_VALUE = 120000;
const MAX_OFFLINE_SECONDS = 28800;
const COLLECT_CAPS = {
  0: 4000000000,
  1: 12000000000,
  2: 35000000000,
  3: 100000000000,
  4: 250000000000
};

function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(320 * Math.pow(1.1, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

function getCollectCap(prestigeLevel) {
  if (prestigeLevel <= 0) return COLLECT_CAPS[0];
  if (prestigeLevel <= 4) return COLLECT_CAPS[prestigeLevel];
  return COLLECT_CAPS[4] + 50000000000 * (prestigeLevel - 4);
}

function getPrestigeMultiplier(prestigeLevel) {
  if (prestigeLevel <= 0) return 1;
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].multiplier;
  return 8 + 2 * (prestigeLevel - 4);
}

function getPrestigeTierName(prestigeLevel) {
  if (prestigeLevel <= 0) return 'Community Bank';
  if (prestigeLevel <= 4) return PRESTIGE_TIERS[prestigeLevel].name;
  return 'Titan+';
}

function getUpgradeCost(upgradeType, currentLevel) {
  const def = BANK_UPGRADES[upgradeType];
  if (!def) return Number.MAX_SAFE_INTEGER;
  if (currentLevel >= def.maxLevel) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getTransactionsPerCycle(branchesLevel, clientsLevel, prestigeLevel) {
  const effBranches = effectiveLevel(branchesLevel, BANK_UPGRADES.branches.decay);
  const effClients = effectiveLevel(clientsLevel, BANK_UPGRADES.clients.decay);
  return (2 + (effBranches * 0.45) + (effClients * 0.6)) * (1 + prestigeLevel * 0.6);
}

function getCycleSeconds(systemsLevel) {
  const eff = effectiveLevel(systemsLevel, BANK_UPGRADES.systems.decay);
  return Math.max(1, BASE_CYCLE_SECONDS - eff * 0.26);
}

function getTransactionValue(lendingLevel, bankLevel, prestigeLevel) {
  const effLending = effectiveLevel(lendingLevel, BANK_UPGRADES.lending.decay);
  const prestigeMult = getPrestigeMultiplier(prestigeLevel);
  return BASE_TRANSACTION_VALUE * (1 + effLending * 0.11) * (1 + bankLevel * 0.014) * prestigeMult;
}

function getVaultBonus(level) {
  const eff = effectiveLevel(level, BANK_UPGRADES.vaults.decay);
  return 1 + eff * 0.045;
}

function getTreasuryBonus(level) {
  const eff = effectiveLevel(level, BANK_UPGRADES.treasury.decay);
  return 1 + eff * 0.055;
}

function getPrivateBankingBonus(level) {
  const eff = effectiveLevel(level, BANK_UPGRADES.private_banking.decay);
  return 1 + eff * 0.17;
}

function getIncomePerCycle(upgrades, bankLevel, prestigeLevel) {
  const tx = getTransactionsPerCycle(upgrades.branches || 0, upgrades.clients || 0, prestigeLevel);
  const value = getTransactionValue(upgrades.lending || 0, bankLevel, prestigeLevel);
  const vaults = getVaultBonus(upgrades.vaults || 0);
  const treasury = getTreasuryBonus(upgrades.treasury || 0);
  return Math.floor(tx * value * vaults * treasury);
}

function getIncomePerSecond(upgrades, bankLevel, prestigeLevel) {
  return getIncomePerCycle(upgrades, bankLevel, prestigeLevel) / getCycleSeconds(upgrades.systems || 0);
}

function calculatePendingIncome(upgrades, bankLevel, prestigeLevel, lastCollectedAt, privateBankingLevel) {
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
  const cycleTime = getCycleSeconds(upgrades.systems || 0);
  const cyclesCompleted = Math.floor(elapsedSeconds / cycleTime);
  const incomePerCycle = getIncomePerCycle(upgrades, bankLevel, prestigeLevel);
  const txPerCycle = getTransactionsPerCycle(upgrades.branches || 0, upgrades.clients || 0, prestigeLevel);
  const privateBonus = getPrivateBankingBonus(privateBankingLevel);

  let xpEarned = Math.floor(incomePerCycle * cyclesCompleted * privateBonus);
  const collectCap = getCollectCap(prestigeLevel);
  const capped = xpEarned > collectCap;
  if (capped) xpEarned = collectCap;

  return {
    xpEarned,
    transactionsProcessed: cyclesCompleted,
    clientsServed: Math.floor(txPerCycle) * cyclesCompleted,
    xpGained: Math.floor(Math.max(1, txPerCycle) * cyclesCompleted),
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

function getUpgradeEffectPreview(upgradeType, currentLevel, bankLevel, prestigeLevel, upgrades) {
  const def = BANK_UPGRADES[upgradeType];
  if (!def) return { current: '', next: null };

  switch (upgradeType) {
    case 'branches': {
      const cur = getTransactionsPerCycle(currentLevel, upgrades.clients || 0, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getTransactionsPerCycle(currentLevel + 1, upgrades.clients || 0, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} tx/cycle`, next: nxt !== null ? `${Math.floor(nxt)} tx/cycle` : null };
    }
    case 'systems': {
      const cur = getCycleSeconds(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getCycleSeconds(currentLevel + 1) : null;
      return { current: `Cycle: ${cur.toFixed(2)}s`, next: nxt !== null ? `Cycle: ${nxt.toFixed(2)}s` : null };
    }
    case 'lending': {
      const cur = getTransactionValue(currentLevel, bankLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getTransactionValue(currentLevel + 1, bankLevel, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} XP/tx`, next: nxt !== null ? `${Math.floor(nxt)} XP/tx` : null };
    }
    case 'vaults': {
      const cur = getVaultBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getVaultBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'clients': {
      const cur = getTransactionsPerCycle(upgrades.branches || 0, currentLevel, prestigeLevel);
      const nxt = currentLevel < def.maxLevel ? getTransactionsPerCycle(upgrades.branches || 0, currentLevel + 1, prestigeLevel) : null;
      return { current: `${Math.floor(cur)} tx/cycle`, next: nxt !== null ? `${Math.floor(nxt)} tx/cycle` : null };
    }
    case 'treasury': {
      const cur = getTreasuryBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getTreasuryBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% bonus` : null };
    }
    case 'private_banking': {
      const cur = getPrivateBankingBonus(currentLevel);
      const nxt = currentLevel < def.maxLevel ? getPrivateBankingBonus(currentLevel + 1) : null;
      return { current: `${((cur - 1) * 100).toFixed(1)}% collect bonus`, next: nxt !== null ? `${((nxt - 1) * 100).toFixed(1)}% collect bonus` : null };
    }
    default:
      return { current: '', next: null };
  }
}

function calculateMaxBuy(upgradeType, currentLevel, availableCurrency) {
  const def = BANK_UPGRADES[upgradeType];
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
  BANK_UPGRADES,
  PRESTIGE_TIERS,
  CUSTOMIZATION_OPTIONS,
  MAX_BANK_LEVEL,
  MAX_OFFLINE_SECONDS,
  effectiveLevel,
  xpForLevel,
  getCollectCap,
  getPrestigeMultiplier,
  getPrestigeTierName,
  getUpgradeCost,
  getTransactionsPerCycle,
  getCycleSeconds,
  getTransactionValue,
  getVaultBonus,
  getTreasuryBonus,
  getPrivateBankingBonus,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  isCustomizationAllowed,
  getAvailableCustomizations,
  getUpgradeEffectPreview,
  calculateMaxBuy
};
