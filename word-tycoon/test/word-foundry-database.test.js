'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-foundry-db-'));
process.env.WORD_TYCOON_DATA_DIR = dataDir;
const db = require('../src/database');

test('database persists canonical Foundry state and idempotency metadata', async t => {
  t.after(() => {
    db.saveImmediate();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await db.initialize();

  const state = { version: 4, cash: 12.5, inventory: [], words: [], market: [] };
  db.saveWordFoundryState('discord:db-test', state, 1000);
  let row = db.getWordFoundryState('discord:db-test');
  assert.equal(JSON.parse(row.state_json).cash, 12.5);
  assert.equal(row.updated_at, 1000);

  const nextState = { ...state, cash: 7.5 };
  db.saveWordFoundryAction('discord:db-test', nextState, 2000, 'db-action-0001', { ok: true, cost: 5 });
  row = db.getWordFoundryState('discord:db-test');
  assert.equal(JSON.parse(row.state_json).cash, 7.5);
  assert.equal(row.last_action_id, 'db-action-0001');
  assert.deepEqual(JSON.parse(row.last_action_result), { ok: true, cost: 5 });

  db.saveWordFoundryState('discord:db-test', { ...nextState, cash: 8 }, 3000);
  row = db.getWordFoundryState('discord:db-test');
  assert.equal(JSON.parse(row.state_json).cash, 8);
  assert.equal(row.last_action_id, 'db-action-0001');
});
