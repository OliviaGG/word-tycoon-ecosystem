'use strict';

const core = require('../public/word-foundry/core');

const DEFAULT_START = Date.parse('2026-09-28T15:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function tileIdsForWord(state, word) {
  const available = [...core.availableTiles(state)];
  const ids = [];
  for (const letter of word.toUpperCase()) {
    const index = available.findIndex(tile => tile.letter === letter);
    if (index < 0) return null;
    ids.push(available.splice(index, 1)[0].id);
  }
  return ids;
}

function bestBuildableWord(state, preferredWord) {
  if (state.words.length >= core.lineLimit(state)) return null;
  if (preferredWord) {
    const preferredIds = tileIdsForWord(state, preferredWord);
    if (preferredIds && core.validateWord(state, preferredIds).ok) return { word: preferredWord, tileIds: preferredIds };
  }
  let best = null;
  for (const word of core.WORDS) {
    if (state.words.some(line => line.word === word)) continue;
    const tileIds = tileIdsForWord(state, word);
    if (!tileIds) continue;
    const income = core.wordIncome(word, state);
    if (!best || income > best.income || (income === best.income && word.length > best.word.length)
      || (income === best.income && word.length === best.word.length && word < best.word)) {
      best = { word, tileIds, income };
    }
  }
  return best;
}

function emptyMilestones() {
  return {
    firstWordAt: null,
    firstLetterAt: null,
    fullFloorAt: null,
    firstEditionAt: null,
    firstManagerAt: null
  };
}

function recordMilestones(state, now, start, milestones) {
  const elapsed = now - start;
  if (milestones.firstWordAt === null && state.stats.wordsBuilt > 0) milestones.firstWordAt = elapsed;
  if (milestones.firstLetterAt === null && state.stats.lettersBought > 0) milestones.firstLetterAt = elapsed;
  if (milestones.fullFloorAt === null && state.words.length >= core.lineLimit(state)) milestones.fullFloorAt = elapsed;
  if (milestones.firstEditionAt === null && state.edition >= 2) milestones.firstEditionAt = elapsed;
  if (milestones.firstManagerAt === null && state.managerLevel >= 1) milestones.firstManagerAt = elapsed;
}

function makeBot(start = DEFAULT_START, seed = 'economy-baseline') {
  let state = core.createGame(start, seed);
  const milestones = emptyMilestones();

  function accept(result, now) {
    if (!result || !result.state) return false;
    state = result.state;
    recordMilestones(state, now, start, milestones);
    return Boolean(result.ok);
  }

  function investFame(now) {
    let manager = core.pressManagerStatus(state);
    if (!manager.maxed && manager.affordable && (manager.level > 0 || state.fame >= core.PRESS_MANAGER_LEVELS[0].cost)) {
      accept(core.hirePressManager(state, now), now);
      return;
    }
    if (state.managerLevel === 0) return;
    for (const upgrade of core.LEGACY_UPGRADES) {
      const status = core.legacyUpgradeStatus(state, upgrade.id);
      if (!status.maxed && !status.locked && status.affordable) {
        accept(core.buyLegacyUpgrade(state, upgrade.id, now), now);
        return;
      }
    }
  }

  function decide(now) {
    accept(core.accrue(state, now), now);

    for (const order of core.getDailyOrders(state, now)) {
      if (order.complete && !order.claimed) accept(core.claimDailyOrder(state, order.id, now), now);
    }

    if (core.prestigePreview(state).ready) {
      accept(core.publishEdition(state, now), now);
      investFame(now);
    } else {
      investFame(now);
    }

    let candidate = bestBuildableWord(state, state.stats.wordsBuilt === 0 ? 'earn' : null);
    while (candidate && state.words.length < core.lineLimit(state)) {
      if (!accept(core.buildWord(state, candidate.tileIds, now), now)) break;
      candidate = bestBuildableWord(state);
    }

    const cheapestOffer = [...state.market].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
    if (cheapestOffer && state.cash >= cheapestOffer.price * 1.1) accept(core.buyLetter(state, cheapestOffer.id, now), now);

    if (state.managerLevel === 0 && state.words.length) {
      const cheapestLine = state.words.map(line => ({ line, cost: core.lineUpgradeCost(line, state) }))
        .sort((a, b) => a.cost - b.cost || a.line.id.localeCompare(b.line.id))[0];
      if (cheapestLine && state.cash >= cheapestLine.cost * 2) accept(core.upgradeLine(state, cheapestLine.line.id, now), now);
    }

    const affordableResearch = core.UPGRADES.map(upgrade => ({ upgrade, cost: core.getUpgradeCost(state, upgrade.id) }))
      .filter(item => state.cash >= item.cost * 2)
      .sort((a, b) => a.cost - b.cost || a.upgrade.id.localeCompare(b.upgrade.id))[0];
    if (affordableResearch) accept(core.buyUpgrade(state, affordableResearch.upgrade.id, now), now);

    recordMilestones(state, now, start, milestones);
  }

  function accrueTo(now) { accept(core.accrue(state, now), now); }
  function snapshot() { return { state, milestones: { ...milestones } }; }
  return { decide, accrueTo, snapshot };
}

function summary(name, bot, elapsed) {
  const { state, milestones } = bot.snapshot();
  return {
    name,
    elapsed,
    cash: core.roundMoney(state.cash),
    rate: core.incomePerSecond(state),
    lifetimeEarnings: core.roundMoney(state.lifetimeEarnings),
    edition: state.edition,
    fame: state.fame,
    availableFame: core.availableFame(state),
    words: state.words.length,
    letters: state.inventory.length,
    discoveries: state.discoveries.length,
    managerLevel: state.managerLevel,
    automaticUpgrades: state.stats.managerUpgrades,
    milestones
  };
}

function simulateContinuous({ name, durationMs, stepMs = 15000, start = DEFAULT_START, seed = name }) {
  const bot = makeBot(start, seed);
  for (let elapsed = 0; elapsed <= durationMs; elapsed += stepMs) bot.decide(start + elapsed);
  bot.accrueTo(start + durationMs);
  return summary(name, bot, durationMs);
}

function simulateFirstEdition({ maxDurationMs = 8 * 60 * 60 * 1000, stepMs = 15000, start = DEFAULT_START } = {}) {
  const bot = makeBot(start, 'first-edition');
  let elapsed = 0;
  for (; elapsed <= maxDurationMs; elapsed += stepMs) {
    bot.decide(start + elapsed);
    if (bot.snapshot().state.edition >= 2) break;
  }
  return summary('first-edition', bot, Math.min(elapsed, maxDurationMs));
}

function simulateWeek({ activeMinutesPerDay = 30, stepMs = 15000, start = DEFAULT_START } = {}) {
  const bot = makeBot(start, 'seven-day-baseline');
  const activeMs = activeMinutesPerDay * 60 * 1000;
  for (let day = 0; day < 7; day += 1) {
    const sessionStart = start + day * DAY_MS;
    for (let elapsed = 0; elapsed <= activeMs; elapsed += stepMs) bot.decide(sessionStart + elapsed);
    const nextSession = day === 6 ? sessionStart + activeMs : start + (day + 1) * DAY_MS;
    bot.accrueTo(nextSession);
  }
  return summary('seven-day', bot, 6 * DAY_MS + activeMs);
}

function evaluateEconomy(report) {
  const byName = Object.fromEntries(report.map(item => [item.name, item]));
  const firstHour = byName['first-hour'];
  const firstEdition = byName['first-edition'];
  const week = byName['seven-day'];
  const checks = [
    { id: 'starter-word', pass: firstHour.milestones.firstWordAt !== null && firstHour.milestones.firstWordAt <= 60000,
      detail: 'First word should be running within one minute.' },
    { id: 'first-purchase', pass: firstHour.milestones.firstLetterAt !== null && firstHour.milestones.firstLetterAt <= 10 * 60000,
      detail: 'The zero-cash opening should fund a first market purchase within ten minutes.' },
    { id: 'first-edition', pass: firstEdition.milestones.firstEditionAt !== null && firstEdition.milestones.firstEditionAt >= 10 * 60000
      && firstEdition.milestones.firstEditionAt <= 60 * 60000,
      detail: 'An optimized first Edition should take between 10 and 60 minutes.' },
    { id: 'first-hour-depth', pass: firstHour.edition >= 2 && firstHour.edition <= 4,
      detail: 'An optimized first hour should publish, without racing beyond Edition 4.' },
    { id: 'week-depth', pass: week.edition >= 5 && week.edition <= 12 && week.discoveries >= 20,
      detail: 'Seven days of short sessions should reach Editions 5–12 and twenty discoveries.' },
    { id: 'automation', pass: week.managerLevel >= 1 && week.automaticUpgrades >= 1,
      detail: 'The seven-day route should unlock and exercise Press Manager automation.' }
  ];
  return { pass: checks.every(check => check.pass), checks };
}

function runBaseline() {
  const report = [
    simulateContinuous({ name: 'first-hour', durationMs: 60 * 60 * 1000 }),
    simulateFirstEdition(),
    simulateWeek()
  ];
  return { report, evaluation: evaluateEconomy(report) };
}

module.exports = {
  DEFAULT_START,
  tileIdsForWord,
  bestBuildableWord,
  makeBot,
  simulateContinuous,
  simulateFirstEdition,
  simulateWeek,
  evaluateEconomy,
  runBaseline
};
