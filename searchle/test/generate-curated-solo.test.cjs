'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePlan } = require('../scripts/generate-curated-solo.cjs');
test('new targets receive files while existing solo targets keep their identity', () => {
  const snapshot = { poolFiles: ['pool_100_river.json'], poolIndex: { words: { river: 10, carpet: 22 } } };
  const plan = makePlan({ words: ['river', 'carpet', 'backpack'], wonWords: [] }, snapshot, 1000);
  assert.deepEqual(plan.alreadySolo, ['river']);
  assert.deepEqual(plan.additions, [
    { word: 'carpet', filename: 'pool_1001_carpet.json', historicalNumber: 22 },
    { word: 'backpack', filename: 'pool_1002_backpack.json', historicalNumber: null },
  ]);
  assert.deepEqual(snapshot.poolIndex.words, { river: 10, carpet: 22 });
});
test('duplicates, unreviewed spelling forms and won targets cannot enter a generation plan', () => {
  const snapshot = { poolFiles: [], poolIndex: { words: {} } };
  for (const selection of [{ words: ['carpet', 'carpet'] }, { words: ['Carpet'] },
    { words: ['car'] }, { words: ['carpet'], wonWords: ['carpet'] }]) {
    assert.throws(() => makePlan(selection, snapshot));
  }
});
