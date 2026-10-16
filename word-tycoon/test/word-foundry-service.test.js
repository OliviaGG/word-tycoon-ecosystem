'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/word-foundry/core');
const { createWordFoundryService } = require('../src/word-foundry');

function createMemoryDb() {
  const rows = new Map();
  return {
    getWordFoundryState(accountId) { return rows.get(accountId) || null; },
    saveWordFoundryState(accountId, state, updatedAt) {
      const previous = rows.get(accountId) || {};
      rows.set(accountId, { ...previous, account_id: accountId, state_json: JSON.stringify(state), updated_at: updatedAt });
    },
    saveWordFoundryAction(accountId, state, updatedAt, actionId, result) {
      rows.set(accountId, {
        account_id: accountId,
        state_json: JSON.stringify(state),
        updated_at: updatedAt,
        last_action_id: actionId,
        last_action_result: JSON.stringify(result)
      });
    }
  };
}

function tileIdsFor(state, word) {
  const unused = [...state.inventory];
  return [...word.toUpperCase()].map(letter => {
    const index = unused.findIndex(tile => tile.letter === letter);
    assert.notEqual(index, -1, `missing ${letter}`);
    return unused.splice(index, 1)[0].id;
  });
}

test('server creates the zero-cash starter foundry and owns its clock', () => {
  let timestamp = 1000;
  const service = createWordFoundryService({ db: createMemoryDb(), core, now: () => timestamp });
  const initial = service.load('discord:123');
  assert.equal(initial.ok, true);
  assert.equal(initial.state.cash, 0);
  assert.deepEqual(initial.state.inventory.map(tile => tile.letter), ['E', 'A', 'R', 'N', 'S', 'T']);

  const tileIds = tileIdsFor(initial.state, 'earn');
  const built = service.act('discord:123', 'build-action-0001', 'build-word', { tileIds });
  assert.equal(built.ok, true);
  timestamp += 10000;
  const accrued = service.load('discord:123');
  assert.ok(accrued.state.cash > 0);
  assert.equal(accrued.offline.elapsed, 10000);
});

test('server ignores client balances and rejects unaffordable purchases', () => {
  const service = createWordFoundryService({ db: createMemoryDb(), core, now: () => 1000 });
  const initial = service.load('discord:456');
  const offer = initial.state.market[0];
  const result = service.act('discord:456', 'purchase-action-1', 'buy-letter', {
    offerId: offer.id,
    cash: 999999,
    state: { cash: 999999 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cash');
  assert.equal(result.state.cash, 0);
  assert.equal(result.state.inventory.length, 6);
});

test('duplicate action ids replay one canonical mutation', () => {
  const service = createWordFoundryService({ db: createMemoryDb(), core, now: () => 1000 });
  const initial = service.load('discord:789');
  const tileIds = tileIdsFor(initial.state, 'earn');
  const first = service.act('discord:789', 'duplicate-action-1', 'build-word', { tileIds });
  const replay = service.act('discord:789', 'duplicate-action-1', 'build-word', { tileIds });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.words.length, 1);
  assert.equal(replay.state.stats.wordsBuilt, 1);
});

test('invalid accounts, action ids, and action names cannot mutate state', () => {
  const service = createWordFoundryService({ db: createMemoryDb(), core, now: () => 1000 });
  assert.equal(service.load('bad account').code, 'account');
  assert.equal(service.act('discord:1', 'short', 'reset', {}).code, 'action-id');
  const unknown = service.act('discord:1', 'unknown-action-1', 'mint-cash', { amount: 1000 });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'action');
  assert.equal(unknown.state.cash, 0);
});

test('server owns Press Manager hiring and reports offline automation', () => {
  let timestamp = 1000;
  const db = createMemoryDb();
  const service = createWordFoundryService({ db, core, now: () => timestamp });
  const initial = service.load('discord:manager');
  const state = initial.state;
  state.fame = 3;
  state.edition = 2;
  db.saveWordFoundryState('discord:manager', state, timestamp);
  const hired = service.act('discord:manager', 'manager-action-001', 'hire-manager', {});
  assert.equal(hired.ok, true);
  assert.equal(hired.state.managerLevel, 1);

  const tileIds = tileIdsFor(hired.state, 'earn');
  const built = service.act('discord:manager', 'manager-action-002', 'build-word', { tileIds });
  assert.equal(built.ok, true);
  built.state.cash = 0;
  db.saveWordFoundryState('discord:manager', built.state, timestamp);
  timestamp += 120000;
  const loaded = service.load('discord:manager');
  assert.equal(loaded.offline.autoUpgrades, 1);
  assert.equal(loaded.state.stats.managerUpgrades, 1);
});
