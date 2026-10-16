/**
 * Redundant Ledger Database
 * Separate sql.js instance writing to data/player-ledger.db
 * Mirrors the player_ledger table from the main DB for redundancy
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync, writeFileDurableSync, removeIfExists, writeFileAtomic } = require('./atomic-write');
const { LEDGER_DB_PATH } = require('./paths');

let db = null;
let saveCounter = 0;
let saveTimer = null;
let saveDirty = false;
let lastSaveStats = null;
let saveInProgress = false;
const VERIFIED_SAVE_INTERVAL = 100;
const LEDGER_SAVE_DEBOUNCE_MS = parseInt(process.env.LEDGER_SAVE_DEBOUNCE_MS || '5000', 10);
const SAVE_OBSERVABILITY_RSS_MB = parseInt(process.env.LEDGER_SAVE_OBSERVABILITY_RSS_MB || '350', 10);
const SAVE_OBSERVABILITY_MS = parseInt(process.env.LEDGER_SAVE_OBSERVABILITY_MS || '150', 10);
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

// --- sql.js WASM corruption watchdog ---
// sql.js keeps the whole DB in a WASM heap that can degrade over long uptime.
// Once corrupted, every query throws "memory access out of bounds" and the
// service stays silently dead until a manual restart. Detect it at the DB
// choke point, persist what we can, and exit so PM2 restarts us clean.
function _installCorruptionWatchdog(instance) {
  const bail = (err) => {
    console.error('[LedgerDB] sql.js WASM heap corrupted — persisting and exiting for PM2 restart:', err && err.message);
    try { save(); } catch (_) {}
    setTimeout(() => process.exit(1), 1500);
  };
  const guard = (fn) => function (...args) {
    try { return fn.apply(this, args); }
    catch (err) {
      if (err && /memory access out of bounds/i.test(String(err.message || err))) bail(err);
      throw err;
    }
  };
  instance.exec = guard(instance.exec.bind(instance));
  instance.run = guard(instance.run.bind(instance));
  const origPrepare = instance.prepare.bind(instance);
  instance.prepare = guard(function (...args) {
    const stmt = origPrepare(...args);
    if (stmt) {
      stmt.bind = guard(stmt.bind.bind(stmt));
      stmt.step = guard(stmt.step.bind(stmt));
      stmt.getAsObject = guard(stmt.getAsObject.bind(stmt));
      stmt.run = guard(stmt.run.bind(stmt));
    }
    return stmt;
  });
  return instance;
}

async function initialize() {
  const SQL = await initSqlJs();
  const dir = path.dirname(LEDGER_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(LEDGER_DB_PATH)) {
    const buffer = fs.readFileSync(LEDGER_DB_PATH);
    db = _installCorruptionWatchdog(new SQL.Database(buffer));
  } else {
    db = _installCorruptionWatchdog(new SQL.Database());
  }

  // Create the ledger table + indexes
  db.run(`
    CREATE TABLE IF NOT EXISTS player_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_player_id ON player_ledger(player_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_event_type ON player_ledger(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON player_ledger(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_player_name ON player_ledger(player_name)');

  save();
  console.log('[LedgerDB] Initialized at', LEDGER_DB_PATH);
}

function bufferFromUint8Array(data) {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function hasValidSqliteHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.allocUnsafe(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(fd, header, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}


async function saveImmediateAsync() {
  if (!db) return;
  if (saveInProgress) return;
  saveInProgress = true;
  saveDirty = false;
  const startedAt = Date.now();
  const exportStartedAt = Date.now();
  const data = db.export();
  const exportMs = Date.now() - exportStartedAt;
  const buffer = bufferFromUint8Array(data);
  let verifiedReadBackBytes = null;
  let verifiedHeaderOk = null;
  let usedFallbackWrite = false;
  let savedOk = false;

  const tmpPath = LEDGER_DB_PATH + '.tmp';
  try {
    await writeFileAtomic(LEDGER_DB_PATH, buffer, {
      tmpPath,
      validateTmp(filePath, stat) {
        if (stat.size !== buffer.length) {
          throw new Error(`temp file size mismatch (${stat.size} vs ${buffer.length})`);
        }
        if (!hasValidSqliteHeader(filePath)) {
          throw new Error('temp file missing SQLite header');
        }
      }
    });
    saveCounter++;
    savedOk = true;

    if (saveCounter % VERIFIED_SAVE_INTERVAL === 0) {
      const readBackStat = await fs.promises.stat(LEDGER_DB_PATH);
      verifiedReadBackBytes = readBackStat.size;
      verifiedHeaderOk = hasValidSqliteHeader(LEDGER_DB_PATH);
      if (readBackStat.size !== buffer.length) {
        console.error(`[LedgerDB] VERIFIED SAVE MISMATCH! Expected ${buffer.length} bytes, got ${readBackStat.size}`);
      }
      if (!verifiedHeaderOk) {
        console.error('[LedgerDB] VERIFIED SAVE HEADER MISMATCH! Saved file is missing the SQLite header');
      }
    }
  } catch (err) {
    console.error('[LedgerDB] Save error:', err.message);
    try {
      removeIfExists(tmpPath);
      writeFileDurableSync(LEDGER_DB_PATH, buffer);
      saveCounter++;
      savedOk = true;
      usedFallbackWrite = true;
    } catch (fallbackErr) {
      console.error('[LedgerDB] Fallback save also failed:', fallbackErr.message);
    }
  }

  saveInProgress = false;

  const totalMs = Date.now() - startedAt;
  const rssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const shouldLogSave =
    savedOk && (
      saveCounter % VERIFIED_SAVE_INTERVAL === 0 ||
      totalMs >= SAVE_OBSERVABILITY_MS ||
      rssMB >= SAVE_OBSERVABILITY_RSS_MB
    );

  if (shouldLogSave) {
    const ledgerRows = queryScalar('SELECT COUNT(*) FROM player_ledger') || 0;
    const parts = [
      `[LedgerDB] Save stats #${saveCounter}`,
      `sizeMB=${(buffer.length / (1024 * 1024)).toFixed(2)}`,
      `exportMs=${exportMs}`,
      `totalMs=${totalMs}`,
      `rssMB=${rssMB}`,
      `ledgerRows=${ledgerRows}`
    ];
    if (verifiedReadBackBytes != null) {
      parts.push(`verifiedReadBackMB=${(verifiedReadBackBytes / (1024 * 1024)).toFixed(2)}`);
    }
    if (verifiedHeaderOk != null) {
      parts.push(`verifiedHeaderOk=${verifiedHeaderOk ? 1 : 0}`);
    }
    if (usedFallbackWrite) {
      parts.push('fallback=1');
    }
    console.log(parts.join(' '));
  }

  lastSaveStats = {
    saveCounter,
    savedOk,
    sizeMB: Number((buffer.length / (1024 * 1024)).toFixed(2)),
    exportMs,
    totalMs,
    rssMB,
    verifiedReadBackMB: verifiedReadBackBytes != null
      ? Number((verifiedReadBackBytes / (1024 * 1024)).toFixed(2))
      : null,
    verifiedHeaderOk,
    usedFallbackWrite,
    savedAt: new Date().toISOString()
  };

  if (saveDirty && !saveTimer) {
    save();
  }
}

function save() {
  if (!db) return;
  if (saveInProgress) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveInProgress = true;
  saveDirty = false;
  const startedAt = Date.now();
  const exportStartedAt = Date.now();
  const data = db.export();
  const exportMs = Date.now() - exportStartedAt;
  const buffer = bufferFromUint8Array(data);
  let verifiedReadBackBytes = null;
  let verifiedHeaderOk = null;
  let usedFallbackWrite = false;
  let savedOk = false;

  const tmpPath = LEDGER_DB_PATH + '.tmp';
  try {
    writeFileAtomicSync(LEDGER_DB_PATH, buffer, {
      tmpPath,
      validateTmp(filePath, stat) {
        if (stat.size !== buffer.length) {
          throw new Error(`temp file size mismatch (${stat.size} vs ${buffer.length})`);
        }
        if (!hasValidSqliteHeader(filePath)) {
          throw new Error('temp file missing SQLite header');
        }
      }
    });
    saveCounter++;
    savedOk = true;

    if (saveCounter % VERIFIED_SAVE_INTERVAL === 0) {
      const readBackStat = fs.statSync(LEDGER_DB_PATH);
      verifiedReadBackBytes = readBackStat.size;
      verifiedHeaderOk = hasValidSqliteHeader(LEDGER_DB_PATH);
      if (readBackStat.size !== buffer.length) {
        console.error(`[LedgerDB] VERIFIED SAVE MISMATCH! Expected ${buffer.length} bytes, got ${readBackStat.size}`);
      }
      if (!verifiedHeaderOk) {
        console.error('[LedgerDB] VERIFIED SAVE HEADER MISMATCH! Saved file is missing the SQLite header');
      }
    }
  } catch (err) {
    console.error('[LedgerDB] Save error:', err.message);
    try {
      removeIfExists(tmpPath);
      writeFileDurableSync(LEDGER_DB_PATH, buffer);
      saveCounter++;
      savedOk = true;
      usedFallbackWrite = true;
    } catch (fallbackErr) {
      console.error('[LedgerDB] Fallback save also failed:', fallbackErr.message);
    }
  }

  const totalMs = Date.now() - startedAt;
  const rssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const shouldLogSave =
    savedOk && (
      saveCounter % VERIFIED_SAVE_INTERVAL === 0 ||
      totalMs >= SAVE_OBSERVABILITY_MS ||
      rssMB >= SAVE_OBSERVABILITY_RSS_MB
    );

  if (shouldLogSave) {
    const ledgerRows = queryScalar('SELECT COUNT(*) FROM player_ledger') || 0;
    const parts = [
      `[LedgerDB] Save stats #${saveCounter}`,
      `sizeMB=${(buffer.length / (1024 * 1024)).toFixed(2)}`,
      `exportMs=${exportMs}`,
      `totalMs=${totalMs}`,
      `rssMB=${rssMB}`,
      `ledgerRows=${ledgerRows}`
    ];
    if (verifiedReadBackBytes != null) {
      parts.push(`verifiedReadBackMB=${(verifiedReadBackBytes / (1024 * 1024)).toFixed(2)}`);
    }
    if (verifiedHeaderOk != null) {
      parts.push(`verifiedHeaderOk=${verifiedHeaderOk ? 1 : 0}`);
    }
    if (usedFallbackWrite) {
      parts.push('fallback=1');
    }
    console.log(parts.join(' '));
  }

  lastSaveStats = {
    saveCounter,
    savedOk,
    sizeMB: Number((buffer.length / (1024 * 1024)).toFixed(2)),
    exportMs,
    totalMs,
    rssMB,
    verifiedReadBackMB: verifiedReadBackBytes != null
      ? Number((verifiedReadBackBytes / (1024 * 1024)).toFixed(2))
      : null,
    verifiedHeaderOk,
    usedFallbackWrite,
    savedAt: new Date().toISOString()
  };

  saveInProgress = false;

  if (saveDirty && !saveTimer) {
    save();
  }
}

function scheduleSave() {
  if (!db) return;
  saveDirty = true;
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!saveDirty) return;
    saveImmediateAsync();
  }, LEDGER_SAVE_DEBOUNCE_MS);

  if (saveTimer.unref) saveTimer.unref();
}

function run(sql, params = []) {
  if (!db) return;
  db.run(sql, params);
}

function queryAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function queryScalar(sql, params = []) {
  const row = queryOne(sql, params);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : null;
}

async function flushDurable() {
  if (!db) throw new Error('Ledger database unavailable');
  const deadline = Date.now() + 20000;
  while (saveInProgress) {
    if (Date.now() >= deadline) throw new Error('Ledger save did not finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // A fresh synchronous export follows any older in-flight write.
  save();
  if (!lastSaveStats?.savedOk) throw new Error('Ledger database persistence failed');
}

function exportBuffer() {
  if (!db) return null;
  return bufferFromUint8Array(db.export());
}

function getRuntimeInfo() {
  let fileSizeMB = null;
  try {
    fileSizeMB = Number((fs.statSync(LEDGER_DB_PATH).size / (1024 * 1024)).toFixed(2));
  } catch (_) {}

  return {
    fileSizeMB,
    saveCounter,
    saveDirty,
    debounceMs: LEDGER_SAVE_DEBOUNCE_MS,
    verifiedSaveInterval: VERIFIED_SAVE_INTERVAL,
    lastSave: lastSaveStats
  };
}

module.exports = { initialize, save, flushDurable, scheduleSave, run, queryAll, queryOne, queryScalar, exportBuffer, getRuntimeInfo, LEDGER_DB_PATH };
