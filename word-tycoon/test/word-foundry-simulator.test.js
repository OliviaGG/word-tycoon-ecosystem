'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const simulator = require('../src/word-foundry-simulator');

test('economy baseline is deterministic and stays inside long-play pacing gates', () => {
  const first = simulator.runBaseline();
  const second = simulator.runBaseline();
  assert.deepEqual(second, first);
  assert.equal(first.evaluation.pass, true, first.evaluation.checks.filter(check => !check.pass).map(check => check.id).join(', '));
  assert.ok(first.report.every(scenario => Number.isFinite(scenario.cash) && Number.isFinite(scenario.rate)));
});

test('seven-day baseline unlocks permanent offline automation', () => {
  const week = simulator.simulateWeek();
  assert.ok(week.managerLevel >= 1);
  assert.ok(week.automaticUpgrades >= 1);
  assert.ok(week.milestones.firstManagerAt !== null);
});
