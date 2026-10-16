'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/word-foundry/core');
const cloud = require('../public/word-foundry/cloud');

function tileIdsForWord(state, word) {
  const available = [...core.availableTiles(state)];
  return [...word.toUpperCase()].map(letter => {
    const index = available.findIndex(tile => tile.letter === letter);
    assert.notEqual(index, -1, `expected an available ${letter} tile`);
    return available.splice(index, 1)[0].id;
  });
}

function buildStarterWord(state, now = 1000) {
  const built = core.buildWord(state, tileIdsForWord(state, 'earn'), now);
  assert.equal(built.ok, true);
  return built;
}

test('new foundries begin at zero with versatile common starter letters', () => {
  const state = core.createGame(1000, 'test');
  assert.equal(state.cash, 0);
  assert.deepEqual(state.inventory.map(tile => tile.letter), ['E', 'A', 'R', 'N', 'S', 'T']);
  assert.ok(state.inventory.every(tile => tile.starter && tile.paid === 0));
  assert.deepEqual(state.market.map(item => item.letter), ['C', 'L', 'O', 'I', 'D', 'M']);
  assert.equal(core.validateWord(state, tileIdsForWord(state, 'earn')).ok, true);
  assert.equal(core.lineLimit(state), 3);
  assert.equal(core.incomePerSecond(state), 0);
  assert.equal(core.wordIncome('c'), 0);
  assert.equal(core.wordIncome('ca'), 0);
});

test('a new foundry cannot buy a letter before earning currency', () => {
  const state = core.createGame(1000, 'test');
  const result = core.buyLetter(state, state.market[0].id, 1000);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cash');
  assert.equal(result.state.cash, 0);
  assert.equal(result.state.inventory.length, 6);
});

test('buying physical letters and building a word locks those tiles', () => {
  let state = core.createGame(1000, 'test');
  state.cash = 100;
  const bought = core.buyLetter(state, state.market.find(item => item.letter === 'C').id, 1000);
  assert.equal(bought.ok, true);
  state = bought.state;
  const ids = tileIdsForWord(state, 'earn');
  const built = core.buildWord(state, ids, 1000);
  assert.equal(built.ok, true);
  assert.equal(built.line.word, 'earn');
  state = built.state;
  assert.equal(core.availableTiles(state).length, 3);
  assert.equal(core.incomePerSecond(state), core.wordIncome('earn'));
  assert.equal(core.validateWord(state, ids).code, 'tiles');
});

test('dismantling a word returns its letters without refunding their purchase', () => {
  let state = core.createGame(1000, 'test');
  state = buildStarterWord(state).state;
  const afterBuild = state.cash;
  const removed = core.dismantleWord(state, state.words[0].id, 1000);
  assert.equal(removed.ok, true);
  assert.equal(removed.state.words.length, 0);
  assert.equal(core.availableTiles(removed.state).length, 6);
  assert.equal(removed.state.cash, afterBuild);
});

test('words accrue passive income and offline time is capped at eight hours', () => {
  let state = buildStarterWord(core.createGame(1000, 'test')).state;
  const rate = core.incomePerSecond(state);
  const hour = core.accrue(state, 1000 + 60 * 60 * 1000);
  assert.equal(hour.earned, core.roundMoney(rate * 3600));
  const longAbsence = core.accrue(state, 1000 + 24 * 60 * 60 * 1000);
  assert.equal(longAbsence.elapsed, core.OFFLINE_CAP_MS);
  assert.equal(longAbsence.earned, core.roundMoney(rate * 8 * 60 * 60));
});

test('the dictionary rejects nonsense, duplicate words, and occupied lines', () => {
  let state = core.createGame(1000, 'test');
  const ids = tileIdsForWord(state, 'earn');
  assert.equal(core.validateWord(state, ids.slice(0, 2)).code, 'short');
  assert.equal(core.validateWord(state, [ids[0], ids[1], ids[3], ids[2]]).code, 'word');
  state = core.buildWord(state, ids, 1000).state;
  const clonedTiles = ids.map((id, index) => ({ id: `tile-${index + 10}`, letter: state.inventory.find(tile => tile.id === id).letter, paid: 0 }));
  state.inventory.push(...clonedTiles);
  assert.equal(core.validateWord(state, clonedTiles.map(tile => tile.id)).code, 'duplicate');
});

test('press upgrades increase all production and floor upgrades add capacity', () => {
  let state = buildStarterWord(core.createGame(1000, 'test')).state;
  const baseRate = core.incomePerSecond(state);
  state.cash = 1000;
  const press = core.buyUpgrade(state, 'press', 1000);
  assert.equal(press.ok, true);
  assert.equal(core.incomePerSecond(press.state), core.roundMoney(baseRate * 1.25));
  const rack = core.buyUpgrade(press.state, 'rack', 1000);
  assert.equal(rack.ok, true);
  assert.equal(core.lineLimit(rack.state), 4);
});

test('restoring a save validates assignments before granting offline income', () => {
  let state = buildStarterWord(core.createGame(1000, 'test')).state;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(state)), 11000);
  assert.ok(restored);
  assert.equal(restored.state.words[0].word, 'earn');
  assert.equal(restored.earned, core.roundMoney(core.wordIncome('earn') * 10));
  restored.state.words.push({ id: 'line-99', word: 'earn', tileIds: [...restored.state.words[0].tileIds], createdAt: 1000 });
  const sanitized = core.restoreGame(restored.state, 11000);
  assert.equal(sanitized.state.words.length, 1);
});

test('first discoveries pay once and persist after dismantling', () => {
  let state = core.createGame(1000, 'test');
  const ids = tileIdsForWord(state, 'earn');
  const first = core.buildWord(state, ids, 1000);
  assert.ok(first.discoveryBonus > 0);
  assert.deepEqual(first.state.discoveries, ['earn']);
  assert.ok(first.state.achievements.includes('first_word'));
  state = core.dismantleWord(first.state, first.line.id, 1000).state;
  const second = core.buildWord(state, ids, 1000);
  assert.equal(second.discoveryBonus, 0);
  assert.deepEqual(second.state.discoveries, ['earn']);
});

test('daily orders can be claimed once and reset on an Edmonton date change', () => {
  const dayOne = Date.parse('2026-09-27T18:00:00Z');
  const dayTwo = Date.parse('2026-09-28T18:00:00Z');
  let state = core.createGame(dayOne, 'daily-test');
  state.daily.lettersBought = 5;
  const order = core.getDailyOrders(state, dayOne).find(item => item.id === 'letters');
  assert.equal(order.complete, true);
  const claimed = core.claimDailyOrder(state, 'letters', dayOne);
  assert.equal(claimed.ok, true);
  assert.equal(core.claimDailyOrder(claimed.state, 'letters', dayOne).code, 'claimed');
  const advanced = core.accrue(claimed.state, dayTwo).state;
  assert.equal(advanced.daily.date, '2026-09-28');
  assert.equal(advanced.daily.lettersBought, 0);
  assert.deepEqual(advanced.daily.claimed, []);
});

test('extended research affects long words, market prices, and offline capacity', () => {
  let state = core.createGame(1000, 'research-test');
  state.cash = 10000;
  const baseLongWord = core.wordIncome('station', state);
  state = core.buyUpgrade(state, 'longform', 1000).state;
  assert.equal(core.wordIncome('station', state), core.roundMoney(baseLongWord * 1.18));
  const originalRefresh = core.refreshCost(state);
  state = core.buyUpgrade(state, 'market', 1000).state;
  assert.ok(core.refreshCost(state) < originalRefresh);
  const originalCap = core.offlineCap(state);
  state = core.buyUpgrade(state, 'offline', 1000).state;
  assert.equal(core.offlineCap(state), originalCap + 2 * 60 * 60 * 1000);
});

test('individual word lines can be upgraded into stronger presses', () => {
  let state = buildStarterWord(core.createGame(1000, 'line-upgrade')).state;
  state.cash = 100;
  const line = state.words[0];
  const before = core.lineIncome(line, state);
  const cost = core.lineUpgradeCost(line);
  const upgraded = core.upgradeLine(state, line.id, 1000);
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.cost, cost);
  assert.equal(upgraded.line.level, 2);
  assert.equal(upgraded.state.cash, 100 - cost);
  assert.equal(upgraded.state.stats.lineUpgrades, 1);
  assert.equal(core.lineIncome(upgraded.line, upgraded.state), core.roundMoney(before * 1.5));
});

test('a mixed-length word portfolio boosts every active production line', () => {
  const state = core.createGame(1000, 'portfolio');
  state.words = [
    { id: 'line-1', word: 'tea', tileIds: [], level: 1, createdAt: 1000 },
    { id: 'line-2', word: 'earn', tileIds: [], level: 1, createdAt: 1000 },
    { id: 'line-3', word: 'stare', tileIds: [], level: 1, createdAt: 1000 }
  ];
  const portfolio = core.portfolioBonus(state);
  assert.equal(portfolio.distinctLengths, 3);
  assert.equal(portfolio.multiplier, 1.1);
  for (const line of state.words) {
    assert.equal(core.lineIncome(line, state), core.roundMoney(core.wordIncome(line.word, state) * 1.1));
  }
  assert.equal(core.incomePerSecond(state), core.roundMoney(state.words.reduce((sum, line) => sum + core.lineIncome(line, state), 0)));
});

test('collection milestones permanently increase word income', () => {
  const state = core.createGame(1000, 'archive');
  const base = core.wordIncome('earn');
  state.discoveries = ['earn', 'near', 'rate', 'star', 'tea'];
  const progress = core.collectionProgress(state);
  assert.equal(progress.achieved, 1);
  assert.equal(progress.nextCount, 15);
  assert.equal(progress.multiplier, 1.05);
  assert.equal(core.wordIncome('earn', state), core.roundMoney(base * 1.05));
});

test('a matching word automatically completes the daily client brief once', () => {
  let now = Date.parse('2026-09-27T18:00:00Z');
  let state;
  for (let attempts = 0; attempts < 14; attempts += 1) {
    state = core.createGame(now, 'brief');
    if (core.getClientBrief(state, now).check('earn')) break;
    now += 24 * 60 * 60 * 1000;
  }
  const brief = core.getClientBrief(state, now);
  assert.equal(brief.check('earn'), true);
  const first = buildStarterWord(state, now);
  assert.equal(first.briefBonus, brief.reward);
  assert.equal(first.state.daily.briefClaimed, true);
  assert.equal(first.state.daily.briefWord, 'earn');
  assert.equal(first.state.stats.briefsCompleted, 1);
  state = core.dismantleWord(first.state, first.line.id, now).state;
  const second = buildStarterWord(state, now);
  assert.equal(second.briefBonus, 0);
  assert.equal(second.state.stats.briefsCompleted, 1);
});

test('crossing a discovery threshold reports a new archive milestone', () => {
  const state = core.createGame(1000, 'milestone');
  state.discoveries = ['near', 'rate', 'star', 'tea'];
  const built = buildStarterWord(state);
  assert.ok(built.milestone);
  assert.equal(built.milestone.achieved, 1);
  assert.equal(built.milestone.multiplier, 1.05);
});

test('Fame can be invested without reducing its lifetime production multiplier', () => {
  const state = core.createGame(1000, 'fame-tree');
  state.fame = 5;
  const before = core.wordIncome('earn', state);
  const invested = core.buyLegacyUpgrade(state, 'heritage', 1000);
  assert.equal(invested.ok, true);
  assert.equal(invested.cost, 1);
  assert.equal(invested.state.fame, 5);
  assert.equal(invested.state.fameSpent, 1);
  assert.equal(core.availableFame(invested.state), 4);
  assert.equal(invested.state.legacyUpgrades.heritage, 1);
  assert.ok(core.wordIncome('earn', invested.state) > before);
});

test('Fame tree branches enforce prerequisites', () => {
  let state = core.createGame(1000, 'fame-locks');
  state.fame = 10;
  assert.equal(core.legacyUpgradeStatus(state, 'trade').locked, true);
  assert.equal(core.buyLegacyUpgrade(state, 'trade', 1000).code, 'locked');
  state = core.buyLegacyUpgrade(state, 'heritage', 1000).state;
  const tradeStatus = core.legacyUpgradeStatus(state, 'trade');
  assert.equal(tradeStatus.locked, false);
  assert.equal(tradeStatus.cost, 2);
  assert.equal(core.buyLegacyUpgrade(state, 'trade', 1000).ok, true);
});

test('specialized Fame upgrades improve persistent operating systems', () => {
  const state = core.createGame(1000, 'fame-effects');
  const line = { id: 'line-1', word: 'earn', tileIds: [], level: 2, createdAt: 1000 };
  const normalLineCost = core.lineUpgradeCost(line, state);
  state.legacyUpgrades.typesetters = 2;
  state.legacyUpgrades.archive = 1;
  state.legacyUpgrades.night = 1;
  state.legacyUpgrades.imprint = 1;
  state.discoveries = ['earn', 'near', 'rate', 'star', 'tea'];
  assert.ok(core.lineUpgradeCost(line, state) < normalLineCost);
  assert.equal(core.collectionProgress(state).multiplier, 1.07);
  assert.equal(core.offlineCap(state), core.OFFLINE_CAP_MS + 60 * 60 * 1000);
  assert.equal(core.lineLimit(state), 4);
});

test('Fame Works upgrades survive publishing a new Edition', () => {
  const state = core.createGame(1000, 'fame-publish');
  state.fame = 4;
  state.fameSpent = 3;
  state.legacyUpgrades.heritage = 1;
  state.legacyUpgrades.trade = 1;
  state.editionEarnings = core.PRESTIGE_BASE;
  state.lifetimeEarnings = core.PRESTIGE_BASE;
  const published = core.publishEdition(state, 1000);
  assert.equal(published.ok, true);
  assert.equal(published.state.fame, 5);
  assert.equal(published.state.fameSpent, 3);
  assert.equal(core.availableFame(published.state), 2);
  assert.equal(published.state.legacyUpgrades.heritage, 1);
  assert.equal(published.state.legacyUpgrades.trade, 1);
});

test('Edition publishing targets scale to prevent rapid prestige loops', () => {
  const first = core.createGame(1000, 'prestige-scale-one');
  const second = core.createGame(1000, 'prestige-scale-two');
  second.edition = 2;
  const firstPreview = core.prestigePreview(first);
  const secondPreview = core.prestigePreview(second);
  assert.equal(firstPreview.baseTarget, core.PRESTIGE_BASE);
  assert.equal(secondPreview.baseTarget, Math.round(core.PRESTIGE_BASE * core.PRESTIGE_GROWTH));
  second.editionEarnings = core.PRESTIGE_BASE;
  assert.equal(core.prestigePreview(second).ready, false);
});

test('Press Manager spends Fame without reducing the permanent Fame multiplier', () => {
  const state = core.createGame(1000, 'manager-hire');
  state.fame = 3;
  const before = core.wordIncome('earn', state);
  const hired = core.hirePressManager(state, 1000);
  assert.equal(hired.ok, true);
  assert.equal(hired.cost, 3);
  assert.equal(hired.state.managerLevel, 1);
  assert.equal(hired.state.fame, 3);
  assert.equal(hired.state.fameSpent, 3);
  assert.equal(core.availableFame(hired.state), 0);
  assert.equal(core.wordIncome('earn', hired.state), before);
  assert.equal(core.pressManagerStatus(hired.state).current.name, 'Apprentice Foreman');
  assert.ok(hired.state.achievements.includes('manager_first'));
});

test('Press Manager upgrades the cheapest line on schedule and keeps its reserve', () => {
  let state = buildStarterWord(core.createGame(1000, 'manager-work')).state;
  state.fame = 3;
  state = core.hirePressManager(state, 1000).state;
  state.cash = 0;
  const originalCost = core.lineUpgradeCost(state.words[0], state);
  const result = core.accrue(state, 1000 + 120000);
  assert.equal(result.autoUpgrades, 1);
  assert.equal(result.state.words[0].level, 2);
  assert.equal(result.state.stats.lineUpgrades, 1);
  assert.equal(result.state.stats.managerUpgrades, 1);
  assert.ok(result.state.cash >= originalCost);
});

test('Press Manager automation runs during capped offline accrual', () => {
  let state = buildStarterWord(core.createGame(1000, 'manager-offline')).state;
  state.managerLevel = 3;
  state.managerLastRunAt = 1000;
  state.cash = 1000;
  const result = core.accrue(state, 1000 + 24 * 60 * 60 * 1000);
  assert.equal(result.elapsed, core.OFFLINE_CAP_MS);
  assert.ok(result.autoUpgrades > 0);
  assert.equal(result.state.stats.managerUpgrades, result.autoUpgrades);
  assert.equal(result.state.lastTickAt, 1000 + 24 * 60 * 60 * 1000);
});

test('Press Manager training survives publishing a new Edition', () => {
  const state = core.createGame(1000, 'manager-publish');
  state.fame = 3;
  state.fameSpent = 3;
  state.managerLevel = 1;
  state.stats.managersHired = 1;
  state.editionEarnings = core.PRESTIGE_BASE;
  const published = core.publishEdition(state, 2000);
  assert.equal(published.ok, true);
  assert.equal(published.state.managerLevel, 1);
  assert.equal(published.state.managerLastRunAt, 2000);
  assert.equal(published.state.stats.managersHired, 1);
});

test('publishing resets the foundry but preserves collection and grants permanent fame', () => {
  let state = buildStarterWord(core.createGame(1000, 'prestige-test')).state;
  state.editionEarnings = core.PRESTIGE_BASE;
  state.lifetimeEarnings = core.PRESTIGE_BASE;
  state.pressLevel = 2;
  const published = core.publishEdition(state, 1000);
  assert.equal(published.ok, true);
  assert.equal(published.gain, 1);
  assert.equal(published.state.edition, 2);
  assert.equal(published.state.fame, 1);
  assert.deepEqual(published.state.inventory.map(tile => tile.letter), ['E', 'A', 'R', 'N', 'S', 'T']);
  assert.equal(published.state.words.length, 0);
  assert.equal(published.state.pressLevel, 0);
  assert.ok(published.state.discoveries.includes('earn'));
  assert.equal(published.state.lifetimeEarnings, core.PRESTIGE_BASE);
  assert.equal(core.wordIncome('earn', published.state), core.roundMoney(core.wordIncome('earn') * 1.1));
});

test('version one browser saves migrate into the long-play progression model', () => {
  const legacy = core.createGame(1000, 'legacy');
  legacy.version = 1;
  delete legacy.daily;
  delete legacy.discoveries;
  delete legacy.achievements;
  delete legacy.fame;
  delete legacy.edition;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(legacy)), 1000);
  assert.ok(restored);
  assert.equal(restored.state.version, core.VERSION);
  assert.equal(restored.state.edition, 1);
  assert.equal(restored.state.fame, 0);
  assert.equal(restored.state.daily.date, '1969-12-31');
  assert.equal(restored.state.daily.briefClaimed, false);
  assert.equal(restored.state.stats.lineUpgrades, 0);
});

test('version two production lines migrate to level one', () => {
  let legacy = buildStarterWord(core.createGame(1000, 'version-two')).state;
  legacy.version = 2;
  delete legacy.words[0].level;
  delete legacy.daily.briefClaimed;
  delete legacy.daily.briefWord;
  delete legacy.stats.lineUpgrades;
  delete legacy.stats.briefsCompleted;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(legacy)), 1000);
  assert.ok(restored);
  assert.equal(restored.state.version, core.VERSION);
  assert.equal(restored.state.words[0].level, 1);
  assert.equal(restored.state.daily.briefClaimed, false);
  assert.equal(restored.state.stats.briefsCompleted, 0);
});

test('version three saves migrate with an empty Fame Works tree', () => {
  const legacy = core.createGame(1000, 'version-three');
  legacy.version = 3;
  delete legacy.fameSpent;
  delete legacy.legacyUpgrades;
  delete legacy.stats.fameUpgradesBought;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(legacy)), 1000);
  assert.ok(restored);
  assert.equal(restored.state.version, core.VERSION);
  assert.equal(restored.state.fameSpent, 0);
  assert.equal(core.availableFame(restored.state), 0);
  assert.ok(core.LEGACY_UPGRADES.every(upgrade => restored.state.legacyUpgrades[upgrade.id] === 0));
});

test('version four saves migrate with owner-operated presses', () => {
  const legacy = core.createGame(1000, 'version-four');
  legacy.version = 4;
  delete legacy.managerLevel;
  delete legacy.managerLastRunAt;
  delete legacy.stats.managerUpgrades;
  delete legacy.stats.managersHired;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(legacy)), 2000);
  assert.ok(restored);
  assert.equal(restored.state.version, core.VERSION);
  assert.equal(restored.state.managerLevel, 0);
  assert.equal(restored.state.stats.managerUpgrades, 0);
  assert.equal(restored.state.stats.managersHired, 0);
});

test('untouched early prototype saves migrate to the new zero-cash starter case', () => {
  const legacy = core.createGame(1000, 'untouched');
  legacy.version = 1;
  legacy.cash = 40;
  legacy.inventory = [];
  legacy.tileCounter = 0;
  const restored = core.restoreGame(JSON.parse(JSON.stringify(legacy)), 1000);
  assert.ok(restored);
  assert.equal(restored.state.cash, 0);
  assert.deepEqual(restored.state.inventory.map(tile => tile.letter), ['E', 'A', 'R', 'N', 'S', 'T']);
});

test('account client sends action intent without client-supplied identity or state', async () => {
  const calls = [];
  const saved = core.createGame(1000, 'server');
  const client = cloud.createClient(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => options?.method === 'POST'
        ? { ok: false, authenticated: true, state: saved, message: 'Not enough cash.' }
        : { ok: true, authenticated: true, state: saved, offline: { earned: 0, elapsed: 0 } }
    };
  });
  const loaded = await client.load();
  assert.equal(loaded.authenticated, true);
  assert.equal(loaded.state.seed, 'server');
  await client.act('buy-letter', { offerId: 'offer-1' }, 'action-id-1234');
  assert.equal(calls[0].url, '/api/word-foundry/state');
  assert.equal(calls[0].options.credentials, 'same-origin');
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(Object.keys(body), ['type', 'payload', 'actionId']);
  assert.equal('userId' in body, false);
  assert.equal('state' in body, false);
  assert.equal(calls[1].url, '/api/word-foundry/action');
});
