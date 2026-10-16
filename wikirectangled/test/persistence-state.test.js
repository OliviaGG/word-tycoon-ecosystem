'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createPersistenceState } = require('../src/persistence-state');

test('known corruption permanently disables persistence for the process', () => {
  const state = createPersistenceState();

  assert.strictEqual(state.canFlush(), true);
  assert.strictEqual(state.markUnsafe(new Error('memory access out of bounds')), true);
  assert.strictEqual(state.canFlush(), false);
  assert.deepStrictEqual(state.snapshot(), {
    canFlush: false,
    unsafeReason: 'memory access out of bounds',
  });
});

test('only the first corruption signal schedules recovery work', () => {
  const state = createPersistenceState();

  assert.strictEqual(state.markUnsafe('first failure'), true);
  assert.strictEqual(state.markUnsafe('second failure'), false);
  assert.strictEqual(state.snapshot().unsafeReason, 'first failure');
});
