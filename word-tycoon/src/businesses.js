const BUSINESSES = {
  library: {
    name: 'Library',
    emoji: '\uD83D\uDCDA',
    aliases: ['library', 'lib'],
    baseCost: 0,
    baseUpgradeCost: 0,
    baseIncome: 10,
    cycleSeconds: 1,
    costMultiplier: 1,
    wordUpgrade: true,
    maxLevel: 100
  },
  newspaper: {
    name: 'Newspaper Route',
    emoji: '\uD83D\uDCF0',
    aliases: ['newspaper', 'news', 'paper', 'nr'],
    baseCost: 5000,
    baseUpgradeCost: 5000,
    baseIncome: 5,
    cycleSeconds: 3,
    costMultiplier: 1.15,
    maxLevel: 100
  },
  carwash: {
    name: 'Car Wash',
    emoji: '\uD83D\uDE97',
    aliases: ['carwash', 'car', 'wash', 'cw'],
    baseCost: 100000,
    baseUpgradeCost: 100000,
    baseIncome: 25,
    cycleSeconds: 6,
    costMultiplier: 1.15,
    maxLevel: 100
  },
  stockmogul: {
    name: 'Stock Mogul',
    emoji: '\uD83D\uDCC8',
    aliases: ['stockmogul', 'stock', 'stocks', 'sm'],
    baseCost: 0,
    baseUpgradeCost: 0,
    cleanCashCost: 5000,
    cleanCashUpgradeCost: 2500,
    baseIncome: 200,
    cycleSeconds: 8,
    costMultiplier: 1.15,
    maxLevel: 100
  },
  pizza: {
    name: 'Pizza Shop',
    emoji: '\uD83C\uDF55',
    aliases: ['pizza', 'pz'],
    baseCost: 2000000,
    baseUpgradeCost: 2000000,
    baseIncome: 50,
    cycleSeconds: 5,
    costMultiplier: 1.15,
    maxLevel: 100
  },
  arcade: {
    name: 'Arcade',
    emoji: '\uD83C\uDFAE',
    aliases: ['arcade', 'arc', 'game'],
    baseCost: 1000,
    baseUpgradeCost: 0,
    baseIncome: 0,
    cycleSeconds: 8,
    costMultiplier: 1.15,
    maxLevel: 1
  },
  gym: {
    name: 'Gym',
    emoji: '\uD83C\uDFCB\uFE0F',
    aliases: ['gym', 'fit'],
    baseCost: 250000000,
    baseUpgradeCost: 250000000,
    baseIncome: 1000,
    cycleSeconds: 10,
    costMultiplier: 1.15,
    maxLevel: 75
  },
  cinema: {
    name: 'Movie Theater',
    emoji: '\uD83C\uDFAC',
    aliases: ['cinema', 'movie', 'theater', 'mt'],
    baseCost: 1000000000,
    baseUpgradeCost: 1000000000,
    baseIncome: 5000,
    cycleSeconds: 12,
    costMultiplier: 1.15,
    maxLevel: 50
  },
  startup: {
    name: 'Tech Startup',
    emoji: '\uD83D\uDCBB',
    aliases: ['startup', 'tech', 'ts'],
    baseCost: 3000000000,
    baseUpgradeCost: 3000000000,
    baseIncome: 25000,
    cycleSeconds: 15,
    costMultiplier: 1.15,
    maxLevel: 50
  },
  bank: {
    name: 'Bank',
    emoji: '\uD83C\uDFE6',
    aliases: ['bank', 'bk'],
    baseCost: 6000000000,
    baseUpgradeCost: 6000000000,
    baseIncome: 150000,
    cycleSeconds: 20,
    costMultiplier: 1.15,
    maxLevel: 50
  },
  space: {
    name: 'Space Agency',
    emoji: '\uD83D\uDE80',
    aliases: ['space', 'rocket', 'nasa', 'sa'],
    baseCost: 10000000000,
    baseUpgradeCost: 10000000000,
    baseIncome: 1000000,
    cycleSeconds: 25,
    costMultiplier: 1.15,
    maxLevel: 25
  }
};

// ==================== PROGRESSION TIERS ====================
// Word game reward multiplier based on highest owned business tier.
// More aggressive scaling so word games become a primary income source.

const PROGRESSION_TIERS = {
  library:    { order: 0, multiplier: 1 },
  // Arcade rebalance (2026-08-09): was order 4 / 15x for a 1,000 cost — a
  // 1k purchase outmultiplied the 2M Pizza Shop and inflated XP balances.
  // Now an early-game 2x sitting at its actual price point.
  arcade:     { order: 1, multiplier: 2 },
  newspaper:  { order: 1, multiplier: 2 },
  carwash:    { order: 2, multiplier: 4 },
  stockmogul: { order: 3, multiplier: 6 },
  pizza:      { order: 3, multiplier: 8 },
  gym:       { order: 5, multiplier: 30 },
  cinema:    { order: 6, multiplier: 60 },
  startup:   { order: 7, multiplier: 100 },
  bank:      { order: 8, multiplier: 150 },
  space:     { order: 9, multiplier: 250 }
};

// Returns the level-scaled progression multiplier for a single business.
// Formula: tierMultiplier * (1 + 0.5 * (level - 1) / (maxLevel - 1))
// - Level 1  = base tier multiplier (no change from purchase)
// - Max level = 1.5x the tier multiplier
// - Buying a higher tier is always better than maxing a lower one
function getLevelScaledMultiplier(businessType, level) {
  const tier = PROGRESSION_TIERS[businessType];
  const def = BUSINESSES[businessType];
  if (!tier || !def) return 1;
  const maxLevel = def.maxLevel || 100;
  if (maxLevel <= 1) return tier.multiplier;
  const levelFraction = (level - 1) / (maxLevel - 1);
  return tier.multiplier * (1 + 0.5 * levelFraction);
}

function getProgressionMultiplier(playerBusinesses) {
  if (!playerBusinesses || playerBusinesses.length === 0) return 1;
  let best = 1;
  for (const biz of playerBusinesses) {
    const scaled = getLevelScaledMultiplier(biz.business_type, biz.level || 1);
    if (scaled > best) best = scaled;
  }
  return best;
}

// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC but without a TZ marker.
// new Date() parses that as local time, causing a timezone offset bug.
// This ensures the timestamp is always parsed as UTC.
function parseUTCTimestamp(ts) {
  if (!ts) return Date.now();
  let ms;
  if (ts.includes('T') || ts.includes('Z') || ts.includes('+')) {
    ms = new Date(ts).getTime();
  } else {
    // SQLite format: "YYYY-MM-DD HH:MM:SS" -> treat as UTC
    ms = new Date(ts.trim().replace(' ', 'T') + 'Z').getTime();
  }
  // Guard against invalid dates returning NaN
  return isNaN(ms) ? Date.now() : ms;
}

function resolveBusinessType(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (BUSINESSES[lower]) return lower;
  for (const [type, def] of Object.entries(BUSINESSES)) {
    if (def.aliases.includes(lower)) return type;
  }
  return null;
}

function getCost(businessType, currentLevel) {
  const biz = BUSINESSES[businessType];
  if (!biz) return Number.MAX_SAFE_INTEGER;
  if (currentLevel === 0) return biz.baseCost;
  return Math.floor(biz.baseUpgradeCost * Math.pow(biz.costMultiplier, currentLevel));
}

function getIncomePerCycle(businessType, level) {
  const biz = BUSINESSES[businessType];
  if (!biz) return 0;
  if (biz.levelMultiplier) {
    return biz.baseIncome * Math.pow(biz.levelMultiplier, level - 1);
  }
  return biz.baseIncome * level;
}

function getIncomePerSecond(businessType, level) {
  const biz = BUSINESSES[businessType];
  if (!biz) return 0;
  if (biz.levelMultiplier) {
    return (biz.baseIncome * Math.pow(biz.levelMultiplier, level - 1)) / biz.cycleSeconds;
  }
  return (biz.baseIncome * level) / biz.cycleSeconds;
}

// Library level thresholds: levels 1-5 use fixed thresholds, levels 6-100 use exponential curve
// Level 1: 100 words, Level 2: 200, Level 3: 400, Level 4: 600, Level 5: 1000, Level 100: 800,000
const LIBRARY_THRESHOLDS = [0, 100, 200, 400, 600, 1000];

function getLibraryLevel(wordCount) {
  if (!wordCount || wordCount < 100) return 1;
  // Check fixed thresholds for levels 1-5
  for (let i = LIBRARY_THRESHOLDS.length - 1; i >= 1; i--) {
    if (wordCount >= LIBRARY_THRESHOLDS[i]) {
      if (i < 5) return i + 1;
      break; // wordCount >= 1000, fall through to exponential
    }
  }
  // Levels 6-100: exponential curve from 1000 → 800,000
  if (wordCount >= 1000) {
    const level = 5 + Math.floor(95 * Math.log(wordCount / 1000) / Math.log(800)) + 1;
    return Math.min(100, Math.max(6, level));
  }
  return 1;
}

function getNextLevelThreshold(currentLevel) {
  if (currentLevel >= 100) return null;
  const nextLevel = currentLevel + 1;
  if (nextLevel <= 5) return LIBRARY_THRESHOLDS[currentLevel];
  return Math.round(1000 * Math.pow(800, (nextLevel - 6) / 95));
}

function isWordUpgrade(businessType) {
  const biz = BUSINESSES[businessType];
  return biz && biz.wordUpgrade === true;
}

function calculatePendingIncome(businessType, level, lastCollectedAt, maxOfflineSeconds) {
  const biz = BUSINESSES[businessType];
  if (!biz) return { income: 0, remainder: 0 };

  const elapsedMs = Date.now() - parseUTCTimestamp(lastCollectedAt);
  const elapsedSeconds = Math.max(0, Math.min(elapsedMs / 1000, maxOfflineSeconds));
  const incomePerCycle = biz.levelMultiplier
    ? biz.baseIncome * Math.pow(biz.levelMultiplier, level - 1)
    : biz.baseIncome * level;
  const cyclesCompleted = Math.floor(elapsedSeconds / biz.cycleSeconds);
  const remainder = elapsedSeconds % biz.cycleSeconds;

  return {
    income: incomePerCycle * cyclesCompleted,
    remainder
  };
}

function getBusinessList() {
  return Object.entries(BUSINESSES).map(([type, def]) => ({
    type,
    name: def.name,
    emoji: def.emoji,
    baseCost: def.baseCost,
    baseIncome: def.baseIncome,
    cycleSeconds: def.cycleSeconds
  }));
}

function getBusinessDef(type) {
  return BUSINESSES[type] || null;
}

// ==================== TAP UPGRADES ====================

const TAP_UPGRADES = {
  tap: {
    name: 'Tap Power',
    desc: 'Coins earned per tap',
    baseCost: 1000,
    costMultiplier: 1.15,
    maxLevel: 100
  },
  crit: {
    name: 'Critical Tap',
    desc: 'Multiplier on combo streak',
    baseCost: 25000,
    costMultiplier: 1.25,
    maxLevel: 50,
    chancePerLevel: 0.01, // +1 level per upgrade (DB storage increment)
    comboMultPerLevel: 0.04 // +4% combo multiplier per level → 3.0x at max
  },
  multi: {
    name: 'Multi-Tap',
    desc: 'Taps per like/interaction',
    baseCost: 250000,
    costMultiplier: 1.5,
    maxLevel: 10
  }
};

function getTapUpgradeDef(type) {
  return TAP_UPGRADES[type] || null;
}

function getTapUpgradeCost(type, currentLevel) {
  const def = TAP_UPGRADES[type];
  if (!def) return Number.MAX_SAFE_INTEGER;
  return Math.floor(def.baseCost * Math.pow(def.costMultiplier, currentLevel));
}

function getTapUpgradeList() {
  return Object.entries(TAP_UPGRADES).map(([key, def]) => ({
    key,
    name: def.name,
    desc: def.desc,
    maxLevel: def.maxLevel
  }));
}

module.exports = {
  BUSINESSES,
  PROGRESSION_TIERS,
  resolveBusinessType,
  getCost,
  getIncomePerCycle,
  getIncomePerSecond,
  calculatePendingIncome,
  getLibraryLevel,
  getNextLevelThreshold,
  isWordUpgrade,
  getBusinessList,
  getBusinessDef,
  getLevelScaledMultiplier,
  getProgressionMultiplier,
  parseUTCTimestamp,
  TAP_UPGRADES,
  getTapUpgradeDef,
  getTapUpgradeCost,
  getTapUpgradeList
};
