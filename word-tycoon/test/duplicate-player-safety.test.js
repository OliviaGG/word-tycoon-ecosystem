'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WORD_TYCOON_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-player-safety-'));
const db = require('../src/database');

test('startup and legacy cleanup preserve unrelated players with the same display name', async () => {
  await db.initialize();
  db.run(`INSERT INTO players (platform,platform_user_id,username,display_name,xp)
    VALUES ('tiktok','treverberated','treverberated','T',100),
           ('tiktok','t.primmz','t.primmz','T',200)`);
  db.saveImmediate();
  await db.initialize();
  assert.equal(db.cleanupDuplicatePlayers().merged, 0);
  assert.deepEqual(db.queryAll('SELECT platform_user_id,xp FROM players ORDER BY id'), [
    { platform_user_id: 'treverberated', xp: 100 },
    { platform_user_id: 't.primmz', xp: 200 }
  ]);
  db.saveImmediate();
});
