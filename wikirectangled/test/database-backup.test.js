'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('database initialization creates a valid last-known-good snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikirectangled-db-backup-'));
  const dbPath = path.join(dir, 'game.db');
  const backupPath = path.join(dir, 'game.db.bak');
  process.env.DB_PATH = dbPath;
  process.env.DB_BACKUP_PATH = backupPath;

  const database = require('../src/database');
  await database.init();

  assert.strictEqual(fs.existsSync(dbPath), true);
  assert.strictEqual(fs.existsSync(backupPath), true);

  const SQL = await require('sql.js')();
  const backup = new SQL.Database(fs.readFileSync(backupPath));
  const result = backup.exec('PRAGMA quick_check');
  assert.strictEqual(result[0].values[0][0], 'ok');
  backup.close();
});

test('a malformed live database cannot replace the last-known-good snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikirectangled-db-corrupt-'));
  const dbPath = path.join(dir, 'game.db');
  const backupPath = path.join(dir, 'game.db.bak');
  const preserved = Buffer.from('preserved recovery point');
  const malformed = Buffer.alloc(4096);
  malformed.write('SQLite format 3\0', 0, 'binary');
  fs.writeFileSync(dbPath, malformed);
  fs.writeFileSync(backupPath, preserved);

  const root = path.join(__dirname, '..');
  const child = spawnSync(process.execPath, [
    '-e',
    "require('./src/database').init().then(() => process.exit(0)).catch(() => process.exit(2))",
  ], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath, DB_BACKUP_PATH: backupPath },
    encoding: 'utf8',
  });

  assert.strictEqual(child.status, 2, child.stderr || child.stdout);
  assert.deepStrictEqual(fs.readFileSync(backupPath), preserved);
});
