(function attachWordFoundryCore(root, factory) {
  const words = typeof module === 'object' && module.exports
    ? require('../wordfall/words')
    : root.WordfallWords;
  const api = factory(words || []);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordFoundryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWordFoundryCore(words) {
  'use strict';

  const VERSION = 5;
  const STARTING_CASH = 0;
  const MARKET_SIZE = 6;
  const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
  const MAX_OFFLINE_CAP_MS = 36 * 60 * 60 * 1000;
  const MIN_WORD_LENGTH = 3;
  const MAX_WORD_LENGTH = 7;
  const PRESTIGE_BASE = 60000;
  const PRESTIGE_GROWTH = 2.75;
  const LINE_LEVEL_BONUS = 0.5;
  const PORTFOLIO_STEP = 0.05;
  const PRESS_MANAGER_LEVELS = Object.freeze([
    Object.freeze({ level: 1, name: 'Apprentice Foreman', cost: 3, intervalMs: 120000, reserveRatio: 1,
      description: 'Checks every 2 minutes and upgrades the cheapest word line while keeping a 100% cash reserve.' }),
    Object.freeze({ level: 2, name: 'Shift Supervisor', cost: 7, intervalMs: 60000, reserveRatio: 0.5,
      description: 'Checks every minute and keeps a 50% cash reserve.' }),
    Object.freeze({ level: 3, name: 'Master Printer', cost: 15, intervalMs: 30000, reserveRatio: 0.2,
      description: 'Checks every 30 seconds and keeps a 20% cash reserve.' })
  ]);
  const STARTER_LETTERS = Object.freeze(['E', 'A', 'R', 'N', 'S', 'T']);
  const STARTER_OFFERS = ['C', 'L', 'O', 'I', 'D', 'M'];
  const LETTER_BAG = 'EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ';
  const SCRABBLE_VALUE = Object.freeze({
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
    J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1,
    S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
  });
  const BASE_LETTER_PRICE = Object.freeze({ 1: 5, 2: 7, 3: 10, 4: 14, 5: 20, 8: 28, 10: 36 });
  const LENGTH_INCOME = Object.freeze({ 3: 0.4, 4: 0.85, 5: 1.65, 6: 3.1, 7: 5.75 });
  const WORDS = new Set(words.map(word => String(word).toLowerCase())
    .filter(word => word.length >= MIN_WORD_LENGTH && word.length <= MAX_WORD_LENGTH));

  const UPGRADES = Object.freeze([
    { id: 'press', property: 'pressLevel', name: 'Precision Press', icon: '↗', baseCost: 80, growth: 2.4,
      description: 'All production earns 25% more per level.' },
    { id: 'rack', property: 'rackLevel', name: 'Floor Expansion', icon: '+', baseCost: 110, growth: 2.8,
      description: 'Adds one permanent production line.' },
    { id: 'longform', property: 'longformLevel', name: 'Longform Imprint', icon: '7', baseCost: 140, growth: 2.5,
      description: 'Words with 5–7 letters earn 18% more per level.' },
    { id: 'market', property: 'marketLevel', name: 'Trade Contacts', icon: '%', baseCost: 160, growth: 3,
      description: 'Letters and crate refreshes cost 5% less per level.' },
    { id: 'offline', property: 'offlineLevel', name: 'Night Crew', icon: '☾', baseCost: 220, growth: 3.2,
      description: 'Extends the offline earnings cap by 2 hours.' }
  ]);
  const UPGRADE_BY_ID = new Map(UPGRADES.map(upgrade => [upgrade.id, upgrade]));
  const LEGACY_UPGRADES = Object.freeze([
    { id: 'heritage', name: 'Heritage Press', icon: 'W', maxLevel: 5, baseCost: 1, growth: 1.75,
      description: 'Every word earns 5% more per level.', requires: [] },
    { id: 'typesetters', name: 'Master Typesetters', icon: 'Aa', maxLevel: 5, baseCost: 2, growth: 1.8,
      description: 'Word-line upgrades cost 8% less per level.', requires: [{ id: 'heritage', level: 1 }] },
    { id: 'trade', name: 'Trade Charter', icon: '%', maxLevel: 5, baseCost: 2, growth: 1.8,
      description: 'Permanent 3% letter-market discount per level.', requires: [{ id: 'heritage', level: 1 }] },
    { id: 'archive', name: 'Archive Foundation', icon: '↗', maxLevel: 5, baseCost: 4, growth: 1.9,
      description: 'Each Archive milestone adds another 2% output per level.', requires: [{ id: 'typesetters', level: 2 }] },
    { id: 'night', name: 'Night Network', icon: '☾', maxLevel: 4, baseCost: 4, growth: 2,
      description: 'Adds one permanent hour of offline production per level.', requires: [{ id: 'trade', level: 2 }] },
    { id: 'imprint', name: 'Grand Imprint', icon: '+', maxLevel: 2, baseCost: 8, growth: 2.5,
      description: 'Adds one permanent production line per level.', requires: [{ id: 'archive', level: 2 }, { id: 'night', level: 2 }] }
  ]);
  const LEGACY_BY_ID = new Map(LEGACY_UPGRADES.map(upgrade => [upgrade.id, upgrade]));
  const DAILY_ORDERS = Object.freeze([
    { id: 'letters', name: 'Stock the cases', description: 'Buy letter tiles', baseTarget: 5, baseReward: 35,
      progress: state => state.daily.lettersBought },
    { id: 'words', name: 'Run the presses', description: 'Build production words', baseTarget: 3, baseReward: 55,
      progress: state => state.daily.wordsBuilt },
    { id: 'earnings', name: 'Meet the quota', description: 'Earn passive cash', baseTarget: 150, baseReward: 90,
      progress: state => state.daily.earnings }
  ]);
  const CLIENT_BRIEFS = Object.freeze([
    { id: 'compact', name: 'Pocket Catalogue', description: 'Set an exact 4-letter word.', reward: 30,
      check: word => word.length === 4 },
    { id: 'feature', name: 'Feature Article', description: 'Set a word with 5 or more letters.', reward: 55,
      check: word => word.length >= 5 },
    { id: 'vowel', name: 'Open with Impact', description: 'Set a 4+ letter word beginning with a vowel.', reward: 45,
      check: word => word.length >= 4 && /^[aeiou]/.test(word) },
    { id: 'double', name: 'Double Type', description: 'Set a word containing a repeated letter.', reward: 70,
      check: word => /(.).*\1/.test(word) },
    { id: 'uncommon', name: 'Uncommon Ink', description: 'Set a word using K, V, W, or Y.', reward: 85,
      check: word => /[kvwy]/.test(word) },
    { id: 'perfect', name: 'Perfect Setting', description: 'Set a 6+ letter word with no repeated letters.', reward: 100,
      check: word => word.length >= 6 && new Set(word).size === word.length }
  ]);
  const COLLECTION_MILESTONES = Object.freeze([5, 15, 30, 60, 100, 175]);
  const ACHIEVEMENTS = Object.freeze([
    { id: 'first_word', name: 'First Edition', description: 'Build your first word.', reward: 25,
      check: state => state.stats.wordsBuilt >= 1 },
    { id: 'full_case', name: 'Full Type Case', description: 'Own 12 letter tiles.', reward: 60,
      check: state => state.inventory.length >= 12 },
    { id: 'collector', name: 'Pocket Dictionary', description: 'Discover 10 different words.', reward: 100,
      check: state => state.discoveries.length >= 10 },
    { id: 'longform', name: 'Longform', description: 'Discover a seven-letter word.', reward: 150,
      check: state => state.discoveries.some(word => word.length === 7) },
    { id: 'rare_type', name: 'Rare Type', description: 'Discover a word using J, Q, X, or Z.', reward: 200,
      check: state => state.discoveries.some(word => /[jqxz]/.test(word)) },
    { id: 'busy_floor', name: 'Full Capacity', description: 'Fill every available production line.', reward: 125,
      check: state => state.words.length >= lineLimit(state) },
    { id: 'ten_per_second', name: 'Print Baron', description: 'Reach $10 per second.', reward: 500,
      check: state => incomePerSecond(state) >= 10 },
    { id: 'publisher', name: 'Publisher', description: 'Publish a new edition.', reward: 1000,
      check: state => state.edition >= 2 },
    { id: 'line_five', name: 'Master Press', description: 'Upgrade one word line to level 5.', reward: 300,
      check: state => state.words.some(line => line.level >= 5) },
    { id: 'portfolio', name: 'Balanced Portfolio', description: 'Run three different word lengths together.', reward: 250,
      check: state => portfolioBonus(state).distinctLengths >= 3 },
    { id: 'briefs', name: 'Reliable Printer', description: 'Complete seven daily client briefs.', reward: 600,
      check: state => state.stats.briefsCompleted >= 7 },
    { id: 'archive', name: 'Living Dictionary', description: 'Discover 30 different words.', reward: 500,
      check: state => state.discoveries.length >= 30 },
    { id: 'legacy_first', name: 'Family Business', description: 'Invest in your first Fame upgrade.', reward: 200,
      check: state => state.stats.fameUpgradesBought >= 1 },
    { id: 'legacy_master', name: 'Printing Dynasty', description: 'Reach 12 total Fame upgrade levels.', reward: 1000,
      check: state => Object.values(state.legacyUpgrades || {}).reduce((sum, level) => sum + level, 0) >= 12 },
    { id: 'manager_first', name: 'Trusted Hands', description: 'Hire your first Press Manager.', reward: 300,
      check: state => Number(state.managerLevel) >= 1 },
    { id: 'manager_master', name: 'Runs Itself', description: 'Train a Master Printer.', reward: 1200,
      check: state => Number(state.managerLevel) >= PRESS_MANAGER_LEVELS.length }
  ]);
  const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map(achievement => [achievement.id, achievement]));

  function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
  function normalizeWord(value) { return String(value || '').trim().toLowerCase(); }
  function getEdmontonDate(value = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(value));
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    result += 0x6D2B79F5;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return (result ^ result >>> 14) >>> 0;
  }
  function seededUnit(seed) { return hash(seed) / 4294967296; }
  function newDaily(now) {
    return {
      date: getEdmontonDate(now), lettersBought: 0, wordsBuilt: 0, earnings: 0, claimed: [],
      briefClaimed: false, briefWord: ''
    };
  }
  function ensureDaily(state, now) {
    if (!state.daily || state.daily.date !== getEdmontonDate(now)) state.daily = newDaily(now);
    if (!Array.isArray(state.daily.claimed)) state.daily.claimed = [];
    return state.daily;
  }
  function copyState(state) {
    return {
      ...state,
      inventory: state.inventory.map(tile => ({ ...tile })),
      words: state.words.map(line => ({ ...line, tileIds: [...line.tileIds] })),
      market: state.market.map(offer => ({ ...offer })),
      purchases: { ...state.purchases },
      legacyUpgrades: { ...state.legacyUpgrades },
      discoveries: [...state.discoveries],
      achievements: [...state.achievements],
      daily: { ...state.daily, claimed: [...state.daily.claimed] },
      stats: { ...state.stats }
    };
  }
  function legacyLevel(state, id) {
    return Math.max(0, Math.floor(Number(state.legacyUpgrades && state.legacyUpgrades[id]) || 0));
  }
  function availableFame(state) { return Math.max(0, Math.floor(Number(state.fame) || 0) - Math.floor(Number(state.fameSpent) || 0)); }
  function marketDiscount(state) {
    const research = Math.max(0, Number(state.marketLevel) || 0) * 0.05;
    const charter = legacyLevel(state, 'trade') * 0.03;
    return Math.min(0.6, research + charter);
  }
  function makeOffer(state, forcedLetter) {
    const index = state.offerCounter++;
    const letter = forcedLetter || LETTER_BAG[Math.floor(seededUnit(`${state.seed}:offer:${index}`) * LETTER_BAG.length)];
    const ownedCount = Number(state.purchases[letter] || 0);
    const base = BASE_LETTER_PRICE[SCRABBLE_VALUE[letter]] || 8;
    return {
      id: `offer-${index}`,
      letter,
      price: Math.max(1, Math.round(base * (1 + ownedCount * 0.16) * (1 - marketDiscount(state))))
    };
  }
  function fillMarket(state, starter) {
    while (state.market.length < MARKET_SIZE) {
      const forced = starter ? STARTER_OFFERS[state.market.length] : null;
      state.market.push(makeOffer(state, forced));
    }
  }
  function createGame(now = Date.now(), seed = now) {
    const state = {
      version: VERSION,
      seed: String(seed),
      cash: STARTING_CASH,
      lifetimeEarnings: 0,
      editionEarnings: 0,
      fame: 0,
      fameSpent: 0,
      edition: 1,
      legacyUpgrades: Object.fromEntries(LEGACY_UPGRADES.map(upgrade => [upgrade.id, 0])),
      inventory: STARTER_LETTERS.map((letter, index) => ({ id: `tile-${index + 1}`, letter, paid: 0, starter: true })),
      words: [],
      market: [],
      purchases: {},
      discoveries: [],
      achievements: [],
      daily: newDaily(now),
      offerCounter: 0,
      tileCounter: STARTER_LETTERS.length,
      lineCounter: 0,
      refreshCount: 0,
      pressLevel: 0,
      rackLevel: 0,
      longformLevel: 0,
      marketLevel: 0,
      offlineLevel: 0,
      managerLevel: 0,
      managerLastRunAt: now,
      createdAt: now,
      lastTickAt: now,
      stats: {
        lettersBought: 0, wordsBuilt: 0, wordsDismantled: 0, bestWordIncome: 0,
        discoveryBonuses: 0, ordersClaimed: 0, editionsPublished: 0,
        lineUpgrades: 0, managerUpgrades: 0, managersHired: 0, briefsCompleted: 0, fameUpgradesBought: 0
      }
    };
    fillMarket(state, true);
    return state;
  }
  function assignedTileIds(state) { return new Set(state.words.flatMap(line => line.tileIds)); }
  function availableTiles(state) {
    const assigned = assignedTileIds(state);
    return state.inventory.filter(tile => !assigned.has(tile.id));
  }
  function wordIncome(word, modifiers = 0) {
    const clean = normalizeWord(word);
    const lengthBase = LENGTH_INCOME[clean.length] || 0;
    if (!lengthBase || !/^[a-z]+$/.test(clean)) return 0;
    const state = typeof modifiers === 'object' && modifiers ? modifiers : { pressLevel: modifiers };
    const rarity = [...clean].reduce((sum, letter) => sum + Math.max(0, (SCRABBLE_VALUE[letter.toUpperCase()] || 1) - 1), 0);
    const press = 1 + Math.max(0, Number(state.pressLevel) || 0) * 0.25;
    const longform = clean.length >= 5 ? 1 + Math.max(0, Number(state.longformLevel) || 0) * 0.18 : 1;
    const fame = 1 + Math.max(0, Number(state.fame) || 0) * 0.1;
    const heritage = 1 + legacyLevel(state, 'heritage') * 0.05;
    const collection = typeof modifiers === 'object' && modifiers ? collectionProgress(state).multiplier : 1;
    return roundMoney((lengthBase + rarity * 0.08) * press * longform * fame * heritage * collection);
  }
  function collectionProgress(state) {
    const count = new Set(state.discoveries || []).size;
    const achieved = COLLECTION_MILESTONES.filter(target => count >= target).length;
    const nextCount = COLLECTION_MILESTONES[achieved] || null;
    const previousCount = achieved ? COLLECTION_MILESTONES[achieved - 1] : 0;
    return {
      count, achieved, nextCount, previousCount,
      multiplier: 1 + achieved * (0.05 + legacyLevel(state, 'archive') * 0.02),
      progress: nextCount ? Math.min(1, (count - previousCount) / (nextCount - previousCount)) : 1
    };
  }
  function portfolioBonus(state) {
    const distinctLengths = new Set((state.words || []).map(line => normalizeWord(line.word).length)
      .filter(length => length >= MIN_WORD_LENGTH && length <= MAX_WORD_LENGTH)).size;
    return { distinctLengths, multiplier: 1 + Math.max(0, distinctLengths - 1) * PORTFOLIO_STEP };
  }
  function lineLevel(line) { return Math.max(1, Math.floor(Number(line && line.level) || 1)); }
  function lineIncome(line, state) {
    return roundMoney(wordIncome(line.word, state) * (1 + (lineLevel(line) - 1) * LINE_LEVEL_BONUS) * portfolioBonus(state).multiplier);
  }
  function lineUpgradeCost(line, state) {
    const level = lineLevel(line);
    const base = Math.max(15, Math.ceil(wordIncome(line.word) * 20));
    const discount = Math.min(0.4, legacyLevel(state || {}, 'typesetters') * 0.08);
    return Math.max(1, Math.ceil(base * Math.pow(1.85, level - 1) * (1 - discount)));
  }
  function incomePerSecond(state) {
    return roundMoney(state.words.reduce((sum, line) => sum + lineIncome(line, state), 0));
  }
  function lineLimit(state) { return 3 + Math.max(0, Number(state.rackLevel) || 0) + legacyLevel(state, 'imprint'); }
  function offlineCap(state) {
    const research = Math.max(0, Number(state.offlineLevel) || 0) * 2 * 60 * 60 * 1000;
    const network = legacyLevel(state, 'night') * 60 * 60 * 1000;
    return Math.min(MAX_OFFLINE_CAP_MS, OFFLINE_CAP_MS + research + network);
  }
  function getUpgradeCost(state, type) {
    const upgrade = UPGRADE_BY_ID.get(type);
    if (!upgrade) return null;
    return Math.round(upgrade.baseCost * Math.pow(upgrade.growth, Math.max(0, Number(state[upgrade.property]) || 0)));
  }
  function getLegacyUpgradeCost(state, id) {
    const upgrade = LEGACY_BY_ID.get(id);
    if (!upgrade) return null;
    const level = Math.min(upgrade.maxLevel, legacyLevel(state, id));
    if (level >= upgrade.maxLevel) return null;
    return Math.max(1, Math.ceil(upgrade.baseCost * Math.pow(upgrade.growth, level)));
  }
  function legacyUpgradeStatus(state, id) {
    const upgrade = LEGACY_BY_ID.get(id);
    if (!upgrade) return null;
    const level = Math.min(upgrade.maxLevel, legacyLevel(state, id));
    const missing = upgrade.requires.filter(requirement => legacyLevel(state, requirement.id) < requirement.level)
      .map(requirement => ({ ...requirement, name: LEGACY_BY_ID.get(requirement.id)?.name || requirement.id }));
    const cost = getLegacyUpgradeCost(state, id);
    return {
      id, level, maxLevel: upgrade.maxLevel, cost, missing,
      locked: missing.length > 0, maxed: level >= upgrade.maxLevel,
      affordable: cost !== null && availableFame(state) >= cost
    };
  }
  function pressManagerStatus(state) {
    const level = Math.min(PRESS_MANAGER_LEVELS.length, Math.max(0, Math.floor(Number(state.managerLevel) || 0)));
    const current = level > 0 ? PRESS_MANAGER_LEVELS[level - 1] : null;
    const next = PRESS_MANAGER_LEVELS[level] || null;
    return {
      level,
      maxLevel: PRESS_MANAGER_LEVELS.length,
      current,
      next,
      cost: next ? next.cost : null,
      maxed: !next,
      affordable: Boolean(next && availableFame(state) >= next.cost)
    };
  }
  function pressUpgradeCost(state) { return getUpgradeCost(state, 'press'); }
  function rackUpgradeCost(state) { return getUpgradeCost(state, 'rack'); }
  function refreshCost(state) {
    return Math.max(1, Math.round(12 * Math.pow(1.35, Math.max(0, Number(state.refreshCount) || 0)) * (1 - marketDiscount(state))));
  }
  function discoveryBonus(word, state) {
    const clean = normalizeWord(word);
    const rarity = [...clean].reduce((sum, letter) => sum + Math.max(0, (SCRABBLE_VALUE[letter.toUpperCase()] || 1) - 1), 0);
    return Math.round((clean.length * 4 + rarity * 2) * (1 + Math.max(0, Number(state.edition) - 1) * 0.2));
  }
  function getClientBrief(state, now = Date.now()) {
    const date = getEdmontonDate(now);
    const daily = state.daily && state.daily.date === date ? state.daily : newDaily(now);
    const brief = CLIENT_BRIEFS[hash(`${date}:word-foundry-brief`) % CLIENT_BRIEFS.length];
    const scale = (1 + Math.max(0, Number(state.edition) - 1) * 0.25) * (1 + Math.max(0, Number(state.fame) || 0) * 0.05);
    return {
      ...brief,
      reward: Math.round(brief.reward * scale),
      claimed: Boolean(daily.briefClaimed),
      word: normalizeWord(daily.briefWord)
    };
  }
  function applyAchievements(state) {
    const owned = new Set(state.achievements);
    const unlocked = [];
    for (const achievement of ACHIEVEMENTS) {
      if (owned.has(achievement.id) || !achievement.check(state)) continue;
      state.achievements.push(achievement.id);
      state.cash = roundMoney(state.cash + achievement.reward);
      owned.add(achievement.id);
      unlocked.push(achievement.id);
    }
    return unlocked;
  }
  function creditPassive(state, elapsed) {
    if (elapsed <= 0) return 0;
    const earned = roundMoney(incomePerSecond(state) * elapsed / 1000);
    state.cash = roundMoney(state.cash + earned);
    state.lifetimeEarnings = roundMoney(state.lifetimeEarnings + earned);
    state.editionEarnings = roundMoney(state.editionEarnings + earned);
    state.daily.earnings = roundMoney(state.daily.earnings + earned);
    return earned;
  }
  function cheapestManagerLine(state) {
    return state.words.map(line => ({ line, cost: lineUpgradeCost(line, state) }))
      .sort((a, b) => a.cost - b.cost || a.line.id.localeCompare(b.line.id))[0] || null;
  }
  function runManagerCheck(state) {
    const status = pressManagerStatus(state);
    const candidate = cheapestManagerLine(state);
    if (!status.current || !candidate) return false;
    const requiredCash = candidate.cost * (1 + status.current.reserveRatio);
    if (state.cash + 1e-9 < requiredCash) return false;
    state.cash = roundMoney(state.cash - candidate.cost);
    candidate.line.level = lineLevel(candidate.line) + 1;
    state.stats.lineUpgrades += 1;
    state.stats.managerUpgrades += 1;
    state.stats.bestWordIncome = Math.max(state.stats.bestWordIncome, lineIncome(candidate.line, state));
    return true;
  }
  function accrue(state, now = Date.now()) {
    const next = copyState(state);
    const timestamp = Number(now);
    ensureDaily(next, timestamp);
    const startedAt = Number(next.lastTickAt || timestamp);
    const elapsed = Math.min(offlineCap(next), Math.max(0, timestamp - startedAt));
    const endsAt = startedAt + elapsed;
    const manager = pressManagerStatus(next).current;
    let earned = 0;
    let cursor = startedAt;
    let autoUpgrades = 0;

    if (manager && next.words.length && elapsed > 0) {
      let lastManagerRun = Number(next.managerLastRunAt);
      if (!Number.isFinite(lastManagerRun)) lastManagerRun = startedAt;
      if (lastManagerRun > startedAt) lastManagerRun = startedAt;
      if (lastManagerRun + manager.intervalMs <= startedAt) {
        const skipped = Math.floor((startedAt - lastManagerRun) / manager.intervalMs);
        lastManagerRun += skipped * manager.intervalMs;
      }
      let nextManagerRun = lastManagerRun + manager.intervalMs;
      while (nextManagerRun <= endsAt) {
        earned = roundMoney(earned + creditPassive(next, nextManagerRun - cursor));
        cursor = nextManagerRun;
        next.managerLastRunAt = nextManagerRun;
        if (runManagerCheck(next)) autoUpgrades += 1;
        nextManagerRun += manager.intervalMs;
      }
    } else if (manager && elapsed > 0) {
      const baseRun = Math.min(startedAt, Number(next.managerLastRunAt) || startedAt);
      const checks = Math.floor((endsAt - baseRun) / manager.intervalMs);
      if (checks > 0) next.managerLastRunAt = baseRun + checks * manager.intervalMs;
    }
    earned = roundMoney(earned + creditPassive(next, endsAt - cursor));
    next.lastTickAt = timestamp;
    const unlocked = applyAchievements(next);
    return { state: next, earned, elapsed, autoUpgrades, unlocked };
  }
  function resultWithAchievements(accrual, next, result) {
    return { ...result, state: next, autoUpgrades: accrual.autoUpgrades || 0, unlocked: [...(accrual.unlocked || []), ...applyAchievements(next)] };
  }
  function buyLetter(state, offerId, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const index = next.market.findIndex(offer => offer.id === offerId);
    if (index < 0) return { ok: false, code: 'missing', message: 'That letter is no longer in the market.', state: next };
    const offer = next.market[index];
    if (next.cash < offer.price) return { ok: false, code: 'cash', message: `You need $${roundMoney(offer.price - next.cash).toFixed(2)} more.`, state: next };
    next.cash = roundMoney(next.cash - offer.price);
    next.tileCounter += 1;
    const tile = { id: `tile-${next.tileCounter}`, letter: offer.letter, paid: offer.price };
    next.inventory.push(tile);
    next.purchases[offer.letter] = Number(next.purchases[offer.letter] || 0) + 1;
    next.stats.lettersBought += 1;
    next.daily.lettersBought += 1;
    next.market.splice(index, 1, makeOffer(next));
    return resultWithAchievements(accrual, next, { ok: true, tile });
  }
  function refreshMarket(state, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const cost = refreshCost(next);
    if (next.cash < cost) return { ok: false, code: 'cash', message: `A new crate costs $${cost}.`, state: next };
    next.cash = roundMoney(next.cash - cost);
    next.refreshCount += 1;
    next.market = [];
    fillMarket(next, false);
    return resultWithAchievements(accrual, next, { ok: true, cost });
  }
  function validateWord(state, tileIds) {
    if (!Array.isArray(tileIds)) return { ok: false, code: 'tiles', message: 'Choose letters from your type case.' };
    const uniqueIds = new Set(tileIds);
    if (uniqueIds.size !== tileIds.length) return { ok: false, code: 'tiles', message: 'A tile can only be used once.' };
    const available = new Map(availableTiles(state).map(tile => [tile.id, tile]));
    const tiles = tileIds.map(id => available.get(id));
    if (tiles.some(tile => !tile)) return { ok: false, code: 'tiles', message: 'One of those letters is already working.' };
    const word = tiles.map(tile => tile.letter).join('').toLowerCase();
    if (word.length < MIN_WORD_LENGTH) return { ok: false, code: 'short', message: 'Words need at least three letters.' };
    if (word.length > MAX_WORD_LENGTH) return { ok: false, code: 'long', message: 'The foundry can only set up to seven letters.' };
    if (!/^[a-z]+$/.test(word) || !WORDS.has(word)) return { ok: false, code: 'word', message: 'That word is not in the foundry dictionary.' };
    if (state.words.some(line => line.word === word)) return { ok: false, code: 'duplicate', message: 'That word already has a production line.' };
    if (state.words.length >= lineLimit(state)) return { ok: false, code: 'capacity', message: 'All production lines are busy. Expand the floor or dismantle a word.' };
    return { ok: true, word, tileIds: [...tileIds] };
  }
  function buildWord(state, tileIds, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const validation = validateWord(next, tileIds);
    if (!validation.ok) return { ...validation, state: next };
    next.lineCounter += 1;
    const line = { id: `line-${next.lineCounter}`, word: validation.word, tileIds: validation.tileIds, level: 1, createdAt: Number(now) };
    next.words.push(line);
    next.stats.wordsBuilt += 1;
    next.daily.wordsBuilt += 1;
    const previousCollectionLevel = collectionProgress(next).achieved;
    let bonus = 0;
    if (!next.discoveries.includes(line.word)) {
      next.discoveries.push(line.word);
      bonus = discoveryBonus(line.word, next);
      next.cash = roundMoney(next.cash + bonus);
      next.stats.discoveryBonuses = roundMoney(next.stats.discoveryBonuses + bonus);
    }
    const collection = collectionProgress(next);
    const milestone = collection.achieved > previousCollectionLevel ? collection : null;
    const brief = getClientBrief(next, now);
    let briefBonus = 0;
    if (!brief.claimed && brief.check(line.word)) {
      briefBonus = brief.reward;
      next.cash = roundMoney(next.cash + briefBonus);
      next.daily.briefClaimed = true;
      next.daily.briefWord = line.word;
      next.stats.briefsCompleted += 1;
    }
    next.stats.bestWordIncome = Math.max(next.stats.bestWordIncome, lineIncome(line, next));
    return resultWithAchievements(accrual, next, { ok: true, line, discoveryBonus: bonus, briefBonus, milestone });
  }
  function dismantleWord(state, lineId, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const index = next.words.findIndex(line => line.id === lineId);
    if (index < 0) return { ok: false, code: 'missing', message: 'That line is already gone.', state: next };
    const [line] = next.words.splice(index, 1);
    next.stats.wordsDismantled += 1;
    return resultWithAchievements(accrual, next, { ok: true, line });
  }
  function buyUpgrade(state, type, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const upgrade = UPGRADE_BY_ID.get(type);
    const cost = getUpgradeCost(next, type);
    if (!upgrade || cost === null) return { ok: false, code: 'upgrade', message: 'Unknown upgrade.', state: next };
    if (next.cash < cost) return { ok: false, code: 'cash', message: `You need $${roundMoney(cost - next.cash).toFixed(2)} more.`, state: next };
    next.cash = roundMoney(next.cash - cost);
    next[upgrade.property] += 1;
    if (type === 'market') next.market = next.market.map(offer => ({ ...offer, price: Math.max(1, Math.round(offer.price * 0.95)) }));
    return resultWithAchievements(accrual, next, { ok: true, type, cost });
  }
  function upgradeLine(state, lineId, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const line = next.words.find(item => item.id === lineId);
    if (!line) return { ok: false, code: 'missing', message: 'That production line is no longer running.', state: next };
    const cost = lineUpgradeCost(line, next);
    if (next.cash < cost) return { ok: false, code: 'cash', message: `You need $${roundMoney(cost - next.cash).toFixed(2)} more.`, state: next };
    next.cash = roundMoney(next.cash - cost);
    line.level = lineLevel(line) + 1;
    next.stats.lineUpgrades += 1;
    next.stats.bestWordIncome = Math.max(next.stats.bestWordIncome, lineIncome(line, next));
    return resultWithAchievements(accrual, next, { ok: true, line, cost });
  }
  function buyLegacyUpgrade(state, id, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const upgrade = LEGACY_BY_ID.get(id);
    const status = legacyUpgradeStatus(next, id);
    if (!upgrade || !status) return { ok: false, code: 'upgrade', message: 'Unknown Fame upgrade.', state: next };
    if (status.maxed) return { ok: false, code: 'maxed', message: 'That Fame upgrade is already mastered.', state: next };
    if (status.locked) {
      const requirement = status.missing[0];
      return { ok: false, code: 'locked', message: `Requires ${requirement.name} level ${requirement.level}.`, state: next };
    }
    if (!status.affordable) return { ok: false, code: 'fame', message: `You need ${status.cost - availableFame(next)} more Fame.`, state: next };
    next.fameSpent += status.cost;
    next.legacyUpgrades[id] = status.level + 1;
    next.stats.fameUpgradesBought += 1;
    if (id === 'trade') next.market = next.market.map(offer => ({ ...offer, price: Math.max(1, Math.round(offer.price * 0.97)) }));
    return resultWithAchievements(accrual, next, { ok: true, upgrade, cost: status.cost, level: status.level + 1 });
  }
  function hirePressManager(state, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const status = pressManagerStatus(next);
    if (status.maxed) return { ok: false, code: 'maxed', message: 'Your Press Manager is already fully trained.', state: next };
    if (!status.affordable) return { ok: false, code: 'fame', message: `You need ${status.cost - availableFame(next)} more Fame.`, state: next };
    next.fameSpent += status.cost;
    next.managerLevel = status.level + 1;
    next.managerLastRunAt = Number(now);
    next.stats.managersHired += 1;
    return resultWithAchievements(accrual, next, {
      ok: true,
      cost: status.cost,
      level: next.managerLevel,
      manager: PRESS_MANAGER_LEVELS[next.managerLevel - 1]
    });
  }
  function getDailyOrders(state, now = Date.now()) {
    const next = copyState(state);
    ensureDaily(next, now);
    const scale = Math.pow(1.35, Math.max(0, next.edition - 1)) * (1 + next.fame * 0.1);
    return DAILY_ORDERS.map(order => {
      const targetScale = order.id === 'earnings' ? Math.pow(1.5, Math.max(0, next.edition - 1)) : 1;
      const target = Math.round(order.baseTarget * targetScale);
      const progress = roundMoney(order.progress(next));
      return {
        id: order.id, name: order.name, description: order.description,
        progress, target, reward: Math.round(order.baseReward * scale),
        complete: progress >= target, claimed: next.daily.claimed.includes(order.id)
      };
    });
  }
  function claimDailyOrder(state, orderId, now = Date.now()) {
    const accrual = accrue(state, now);
    const next = accrual.state;
    const order = getDailyOrders(next, now).find(item => item.id === orderId);
    if (!order) return { ok: false, code: 'order', message: 'That order is not available.', state: next };
    if (order.claimed) return { ok: false, code: 'claimed', message: 'That order is already claimed.', state: next };
    if (!order.complete) return { ok: false, code: 'incomplete', message: 'That order is not complete yet.', state: next };
    next.daily.claimed.push(order.id);
    next.cash = roundMoney(next.cash + order.reward);
    next.stats.ordersClaimed += 1;
    return resultWithAchievements(accrual, next, { ok: true, order, reward: order.reward });
  }
  function prestigePreview(state) {
    const baseTarget = Math.round(PRESTIGE_BASE * Math.pow(PRESTIGE_GROWTH, Math.max(0, Number(state.edition) - 1)));
    const gain = Math.floor(Math.sqrt(Math.max(0, Number(state.editionEarnings) || 0) / baseTarget));
    const nextTarget = Math.pow(gain + 1, 2) * baseTarget;
    const heritage = 1 + legacyLevel(state, 'heritage') * 0.05;
    return {
      gain,
      ready: gain >= 1,
      baseTarget,
      nextTarget,
      progress: Math.min(1, Math.max(0, state.editionEarnings / nextTarget)),
      currentMultiplier: (1 + state.fame * 0.1) * heritage,
      nextMultiplier: (1 + (state.fame + Math.max(1, gain)) * 0.1) * heritage
    };
  }
  function publishEdition(state, now = Date.now()) {
    const accrual = accrue(state, now);
    const current = accrual.state;
    const preview = prestigePreview(current);
    if (!preview.ready) return { ok: false, code: 'prestige', message: `Earn $${roundMoney(preview.baseTarget - current.editionEarnings).toFixed(2)} more this edition.`, state: current };
    const next = createGame(now, `${current.seed}:edition:${current.edition + 1}`);
    next.cash = STARTING_CASH;
    next.lifetimeEarnings = current.lifetimeEarnings;
    next.fame = current.fame + preview.gain;
    next.fameSpent = current.fameSpent;
    next.edition = current.edition + 1;
    next.managerLevel = current.managerLevel;
    next.managerLastRunAt = Number(now);
    next.legacyUpgrades = { ...current.legacyUpgrades };
    next.discoveries = [...current.discoveries];
    next.achievements = [...current.achievements];
    next.daily = { ...current.daily, claimed: [...current.daily.claimed] };
    next.stats = { ...current.stats, editionsPublished: current.stats.editionsPublished + 1 };
    const unlocked = applyAchievements(next);
    return { ok: true, gain: preview.gain, state: next, unlocked };
  }
  function restoreGame(raw, now = Date.now()) {
    if (!raw || !Number.isInteger(Number(raw.version)) || Number(raw.version) < 1 || Number(raw.version) > VERSION || !Array.isArray(raw.inventory)
      || !Array.isArray(raw.words) || !Array.isArray(raw.market)) return null;
    const rawStats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    const untouchedLegacyStart = raw.inventory.length === 0 && raw.words.length === 0
      && Number(raw.lifetimeEarnings || 0) === 0 && Number(rawStats.wordsBuilt || 0) === 0
      && Number(rawStats.lettersBought || 0) === 0 && Number(raw.cash || 0) <= 40
      && (!Array.isArray(raw.discoveries) || raw.discoveries.length === 0);
    if (untouchedLegacyStart) return accrue(createGame(Number(raw.createdAt) || now, raw.seed || raw.createdAt || now), now);
    const base = createGame(Number(raw.createdAt) || now, raw.seed || raw.createdAt || now);
    const knownAchievements = new Set(ACHIEVEMENTS.map(item => item.id));
    const legacyUpgrades = Object.fromEntries(LEGACY_UPGRADES.map(upgrade => [
      upgrade.id, Math.min(upgrade.maxLevel, Math.max(0, Math.floor(Number(raw.legacyUpgrades && raw.legacyUpgrades[upgrade.id]) || 0)))
    ]));
    const state = {
      ...base,
      ...raw,
      version: VERSION,
      cash: Math.max(0, Number(raw.cash) || 0),
      lifetimeEarnings: Math.max(0, Number(raw.lifetimeEarnings) || 0),
      editionEarnings: Math.max(0, Number(raw.editionEarnings ?? raw.lifetimeEarnings) || 0),
      fame: Math.max(0, Math.floor(Number(raw.fame) || 0)),
      fameSpent: Math.max(0, Math.floor(Number(raw.fameSpent) || 0)),
      edition: Math.max(1, Math.floor(Number(raw.edition) || 1)),
      legacyUpgrades,
      inventory: raw.inventory.filter(tile => tile && /^tile-\d+$/.test(tile.id) && /^[A-Z]$/.test(tile.letter))
        .map(tile => ({ id: tile.id, letter: tile.letter, paid: Math.max(0, Number(tile.paid) || 0), starter: Boolean(tile.starter) })),
      market: raw.market.filter(offer => offer && /^offer-\d+$/.test(offer.id) && /^[A-Z]$/.test(offer.letter))
        .map(offer => ({ id: offer.id, letter: offer.letter, price: Math.max(1, Math.round(Number(offer.price) || 1)) })),
      purchases: raw.purchases && typeof raw.purchases === 'object' ? { ...raw.purchases } : {},
      discoveries: [...new Set((raw.discoveries || raw.words.map(line => line.word)).map(normalizeWord).filter(word => WORDS.has(word)))],
      achievements: [...new Set((raw.achievements || []).filter(id => knownAchievements.has(id)))],
      daily: raw.daily && typeof raw.daily === 'object'
        ? { ...newDaily(now), ...raw.daily, claimed: Array.isArray(raw.daily.claimed) ? [...new Set(raw.daily.claimed)] : [] }
        : newDaily(now),
      stats: { ...base.stats, ...(raw.stats || {}) },
      pressLevel: Math.max(0, Math.floor(Number(raw.pressLevel) || 0)),
      rackLevel: Math.max(0, Math.floor(Number(raw.rackLevel) || 0)),
      longformLevel: Math.max(0, Math.floor(Number(raw.longformLevel) || 0)),
      marketLevel: Math.max(0, Math.floor(Number(raw.marketLevel) || 0)),
      offlineLevel: Math.max(0, Math.floor(Number(raw.offlineLevel) || 0)),
      managerLevel: Math.min(PRESS_MANAGER_LEVELS.length, Math.max(0, Math.floor(Number(raw.managerLevel) || 0))),
      managerLastRunAt: Number.isFinite(Number(raw.managerLastRunAt))
        ? Math.min(Number(now), Number(raw.managerLastRunAt))
        : Math.min(Number(now), Number(raw.lastTickAt) || now)
    };
    ensureDaily(state, now);
    state.fameSpent = Math.min(state.fame, state.fameSpent);
    state.daily.briefClaimed = Boolean(state.daily.briefClaimed);
    state.daily.briefWord = normalizeWord(state.daily.briefWord);
    state.offerCounter = Math.max(state.offerCounter, ...state.market.map(offer => Number(offer.id.slice(6)) + 1), 0);
    state.tileCounter = Math.max(state.tileCounter, ...state.inventory.map(tile => Number(tile.id.slice(5))), 0);
    const tileIds = new Set(state.inventory.map(tile => tile.id));
    const used = new Set();
    state.words = raw.words.filter(line => {
      if (!line || !/^line-\d+$/.test(line.id) || !Array.isArray(line.tileIds)
        || !WORDS.has(normalizeWord(line.word)) || line.tileIds.length !== normalizeWord(line.word).length) return false;
      if (line.tileIds.some(id => !tileIds.has(id) || used.has(id))) return false;
      line.tileIds.forEach(id => used.add(id));
      return true;
    }).slice(0, lineLimit(state)).map(line => ({
      id: line.id, word: normalizeWord(line.word), tileIds: [...line.tileIds],
      level: Math.max(1, Math.floor(Number(line.level) || 1)), createdAt: Number(line.createdAt) || now
    }));
    state.lineCounter = Math.max(state.lineCounter, ...state.words.map(line => Number(line.id.slice(5))), 0);
    fillMarket(state, false);
    return accrue(state, now);
  }

  return {
    VERSION, STARTING_CASH, STARTER_LETTERS, MARKET_SIZE, OFFLINE_CAP_MS, MAX_OFFLINE_CAP_MS, MIN_WORD_LENGTH, MAX_WORD_LENGTH,
    WORDS, SCRABBLE_VALUE, UPGRADES, LEGACY_UPGRADES, PRESS_MANAGER_LEVELS, ACHIEVEMENTS, DAILY_ORDERS, CLIENT_BRIEFS, COLLECTION_MILESTONES, PRESTIGE_BASE, PRESTIGE_GROWTH,
    createGame, restoreGame, accrue, availableTiles, assignedTileIds, getEdmontonDate,
    wordIncome, lineIncome, lineUpgradeCost, portfolioBonus, collectionProgress, incomePerSecond, lineLimit, offlineCap,
    getUpgradeCost, getLegacyUpgradeCost, legacyUpgradeStatus, pressManagerStatus, availableFame, pressUpgradeCost, rackUpgradeCost,
    refreshCost, discoveryBonus, getClientBrief, getDailyOrders, prestigePreview, validateWord, buyLetter, refreshMarket,
    buildWord, dismantleWord, upgradeLine, buyUpgrade, buyLegacyUpgrade, hirePressManager, claimDailyOrder, publishEdition, roundMoney,
    achievementById: id => ACHIEVEMENT_BY_ID.get(id) || null
  };
});
