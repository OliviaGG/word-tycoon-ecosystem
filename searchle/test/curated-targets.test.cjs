'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateCatalog, readCuratedTargets, mergeTargets } = require('../server/curated-targets');

test('new curated words can supplement the bank without changing existing selection order', () => {
  const bank = ['house', 'river'];
  const extra = validateCatalog({ version: 1, words: ['river', 'carpet'] }, new Set(['river', 'carpet']));
  assert.deepEqual(mergeTargets(bank, extra), ['house', 'river', 'carpet']);
  assert.deepEqual(bank, ['house', 'river']);
  assert.deepEqual(mergeTargets(bank, extra, word => word !== 'carpet'), bank);
});

test('invalid dictionary words, duplicates and noncanonical target spellings are rejected', () => {
  const dictionary = new Set(['carpet', 'river']);
  for (const words of [['invented'], ['carpet', 'carpet'], ['Carpet'], ['car-pet'], ['car']]) {
    assert.throws(() => validateCatalog({ version: 1, words }, dictionary));
  }
  assert.throws(() => validateCatalog({ words: ['river'] }, dictionary));
});

test('an absent supplement preserves legacy behavior; a supplied one must have dictionary evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtextle-curated-'));
  try {
    const supplement = path.join(dir, 'curated.json');
    const dictionary = path.join(dir, 'dictionary.json');
    assert.deepEqual(readCuratedTargets(supplement, dictionary), []);
    fs.writeFileSync(dictionary, JSON.stringify({ 6: ['carpet'] }));
    fs.writeFileSync(supplement, JSON.stringify({ version: 1, words: ['carpet'] }));
    assert.deepEqual(readCuratedTargets(supplement, dictionary), ['carpet']);
    fs.writeFileSync(supplement, JSON.stringify({ version: 1, words: ['missing'] }));
    assert.throws(() => readCuratedTargets(supplement, dictionary), /dictionary/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
