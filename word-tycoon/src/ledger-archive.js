/**
 * Cold ledger archive.
 *
 * Backed by node:sqlite (file-backed) rather than sql.js. This matters: sql.js
 * holds the WHOLE database in memory, so the old implementation did a
 * `readFileSync` of the entire archive plus a second copy into the WASM heap on
 * EVERY call, and a full `export()` on every write. At a 526MB archive that is
 * ~1.0GB transient per read and ~1.6GB per write, on top of mobile-tycoon's
 * ~840MB baseline. Combined with the 30-minute retention interval it pushed RSS
 * past the PM2 cap ~47 times a day (2026-08-09 audit). node:sqlite reads pages
 * off disk, so the archive now costs effectively nothing to open.
 *
 * The open/close-per-call shape is deliberately unchanged: connections are
 * cheap, nothing holds a handle between calls, and the file stays consistent
 * for backup.js's copy except during a commit.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { LEDGER_ARCHIVE_DB_PATH } = require('./paths');

const ARCHIVE_DB_PATH = LEDGER_ARCHIVE_DB_PATH;

// Set by initialize(). Mirrors the old `SQL` guard so callers that forget to
// initialize still fail loudly instead of silently creating an empty archive.
let ready = false;
// The schema cannot change under us mid-process, and getLedgerStats() opens the
// archive six times in a row — so only pay for the DDL once per process.
let schemaReady = false;

function sanitizeParams(params = []) {
  return params.map((value) => {
    if (value === undefined) return null;
    // node:sqlite rejects booleans outright; sql.js used to coerce them.
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureInitialized() {
  if (!ready) {
    throw new Error('Ledger archive not initialized');
  }
}

function queryAllWithDb(database, sql, params = []) {
  return database.prepare(sql).all(...sanitizeParams(params));
}

function queryOneWithDb(database, sql, params = []) {
  const row = database.prepare(sql).get(...sanitizeParams(params));
  return row === undefined ? null : row;
}

function queryScalarWithDb(database, sql, params = []) {
  const row = queryOneWithDb(database, sql, params);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : null;
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS player_ledger (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_type TEXT NOT NULL,
      command TEXT,
      coins_before REAL NOT NULL DEFAULT 0,
      coins_after REAL NOT NULL DEFAULT 0,
      coins_delta REAL NOT NULL DEFAULT 0,
      gift_coins_before REAL,
      gift_coins_after REAL,
      gift_coins_delta REAL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      response TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_archive_ledger_player_id ON player_ledger(player_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_archive_ledger_event_type ON player_ledger(event_type)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_archive_ledger_created_at ON player_ledger(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_archive_ledger_player_name ON player_ledger(player_name)');

  const cols = queryAllWithDb(database, 'PRAGMA table_info(player_ledger)');
  if (!cols.some((col) => col.name === 'archived_at')) {
    database.exec("ALTER TABLE player_ledger ADD COLUMN archived_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
}

function openArchiveDb() {
  // 10s busy timeout: the restore drill and the archive-ledger cron can be
  // reading this file when a retention pass lands.
  try {
    return new DatabaseSync(ARCHIVE_DB_PATH, { timeout: 10000 });
  } catch (err) {
    if (err && err.code === 'ERR_INVALID_ARG_TYPE') throw err;
    return new DatabaseSync(ARCHIVE_DB_PATH);
  }
}

// `write` is kept for call-site compatibility. It was the flag that decided
// whether to re-export the whole DB to disk; node:sqlite persists in place, so
// it no longer does anything.
function withArchiveDb(fn, { write = false } = {}) { // eslint-disable-line no-unused-vars
  ensureInitialized();
  ensureDir(ARCHIVE_DB_PATH);
  const database = openArchiveDb();

  try {
    if (!schemaReady) {
      ensureSchema(database);
      schemaReady = true;
    }
    return fn(database);
  } finally {
    database.close();
  }
}

async function initialize() {
  ensureDir(ARCHIVE_DB_PATH);
  ready = true;
  schemaReady = false;
  withArchiveDb(() => null);
  console.log('[LedgerArchive] Ready at', ARCHIVE_DB_PATH);
}

function queryAll(sql, params = []) {
  return withArchiveDb((database) => queryAllWithDb(database, sql, params));
}

function queryOne(sql, params = []) {
  return withArchiveDb((database) => queryOneWithDb(database, sql, params));
}

function queryScalar(sql, params = []) {
  return withArchiveDb((database) => queryScalarWithDb(database, sql, params));
}

function appendEntries(entries = []) {
  if (!entries.length) return 0;

  return withArchiveDb((database) => {
    database.exec('BEGIN IMMEDIATE TRANSACTION');
    const stmt = database.prepare(`
      INSERT OR IGNORE INTO player_ledger (
        id, player_id, player_name, platform, event_type, command,
        coins_before, coins_after, coins_delta,
        gift_coins_before, gift_coins_after, gift_coins_delta,
        success, response, detail, created_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    try {
      for (const entry of entries) {
        stmt.run(...sanitizeParams([
          entry.id,
          entry.player_id,
          entry.player_name,
          entry.platform,
          entry.event_type,
          entry.command,
          entry.coins_before,
          entry.coins_after,
          entry.coins_delta,
          entry.gift_coins_before,
          entry.gift_coins_after,
          entry.gift_coins_delta,
          entry.success,
          entry.response,
          entry.detail,
          entry.created_at
        ]));
      }
      database.exec('COMMIT');
      return entries.length;
    } catch (err) {
      try { database.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }, { write: true });
}

function reassignPlayerId(keepId, removeId) {
  return withArchiveDb((database) => {
    const info = database
      .prepare('UPDATE player_ledger SET player_id = ? WHERE player_id = ?')
      .run(...sanitizeParams([keepId, removeId]));
    return Number(info.changes) || 0;
  }, { write: true });
}

function vacuum() {
  return withArchiveDb((database) => {
    database.exec('VACUUM');
    return true;
  }, { write: true });
}

module.exports = {
  initialize,
  queryAll,
  queryOne,
  queryScalar,
  appendEntries,
  reassignPlayerId,
  vacuum,
  ARCHIVE_DB_PATH
};
