'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectTargets, validatePool, dualMeaningBlock, assertLocalRoot } = require('../scripts/expand-solo-pool.cjs');

test('curated additions preserve exclusions, played files, canonical morphology, and bank membership', () => {
  const result = selectTargets({ easy: ['music', 'music', 'tree', 'twain', 'calif', 'china', 'cats', 'colour', 'unknown', 'missing', 'art'],
    bank: new Set(['music', 'tree', 'twain', 'calif', 'china', 'cats', 'colour', 'missing', 'art']), existing: new Set(['tree']),
    blocked: new Set(['twain', 'calif', 'china']), isBlocked: () => false,
    normalize: word => ({ cats: 'cat', colour: 'color' }[word] || word), modelHas: word => word !== 'missing' });
  assert.deepEqual(result.selected, ['music']);
  assert.equal(result.rejected.find(r => r.word === 'twain').reason, 'intentional-exclusion');
  assert.equal(result.rejected.find(r => r.word === 'unknown').reason, 'absent-canonical-bank');
  assert.equal(result.rejected.find(r => r.word === 'missing').reason, 'missing-model-vector');
});
test('policy rejects globally excluded words even if curated', () => {
  assert.deepEqual(selectTargets({ easy: ['blocked'], bank: new Set(['blocked']), existing: new Set(), blocked: new Set(),
    isBlocked: () => true, normalize: w => w, modelHas: () => true }).selected, []);
});
test('exclusions are extracted from canonical source and comment text is ignored', () => {
  const block = dualMeaningBlock("const SEARCHLE_DUAL_MEANING_BLOCK = new Set(['twain', // 'comment'\n'calif']);");
  assert.deepEqual([...block], ['twain', 'calif']);
  assert.throws(() => dualMeaningBlock(''), /missing/);
});
test('old truncated pools and corrupted ranking sequences are rejected', () => {
  assert.throws(() => validatePool({ targetWord: 'music', rankings: { music: 1 }, totalRankedWords: 339509 }, 'music'), /Incomplete/);
  const rankings = Object.fromEntries(Array.from({ length: 100000 }, (_, i) => [i ? `word${i}` : 'music', i + 1]));
  assert.equal(validatePool({ targetWord: 'music', rankings, totalRankedWords: 100000 }, 'music'), 100000);
  rankings.word1 = 1;
  assert.throws(() => validatePool({ targetWord: 'music', rankings, totalRankedWords: 100000 }, 'music'), /duplicate/);
  assert.throws(() => validatePool({ targetWord: 'other', rankings, totalRankedWords: 100000 }, 'music'), /mismatch/);
});
test('production roots are rejected before loading or generating content', () => {
  assert.throws(() => assertLocalRoot('/opt/searchle'), /production source root/);
});
