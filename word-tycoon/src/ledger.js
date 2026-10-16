/**
 * Player Ledger — Central audit trail module
 * Dual-writes to main DB (player_ledger table) and separate ledger DB for redundancy.
 * Admin reads combine the hot ledger with the archive ledger once retention moves old rows out.
 */

const fs = require('fs');
const ledgerArchive = require('./ledger-archive');
const { DB_PATH } = require('./paths');

let mainDb = null;
let ledgerDb = null;
let retentionTimer = null;
let retentionStartupTimer = null;
let retentionRunning = false;
let lastMaintenance = null;

const LEDGER_RETENTION_DAYS = parseInt(process.env.LEDGER_RETENTION_DAYS || '21', 10);
const LEDGER_RETENTION_BATCH_SIZE = parseInt(process.env.LEDGER_RETENTION_BATCH_SIZE || '5000', 10);
const LEDGER_RETENTION_INTERVAL_MS = parseInt(process.env.LEDGER_RETENTION_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
const LEDGER_RETENTION_STARTUP_DELAY_MS = parseInt(process.env.LEDGER_RETENTION_STARTUP_DELAY_MS || '120000', 10);
const WORD_TYCOON_DB_PATH = DB_PATH;

async function initialize(database, ledgerDbModule) {
  mainDb = database;
  ledgerDb = ledgerDbModule;
  await ledgerArchive.initialize();
  scheduleRetention();
  console.log('[Ledger] Initialized (dual-write mode + archive retention)');
}

function stopRetention() {
  if (retentionStartupTimer) {
    clearTimeout(retentionStartupTimer);
    retentionStartupTimer = null;
  }
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

function fileSizeMB(filePath) {
  try {
    return Number((fs.statSync(filePath).size / (1024 * 1024)).toFixed(2));
  } catch (_) {
    return null;
  }
}

function buildMaintenanceStatus() {
  const hotRows = mainDb ? Number(mainDb.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0) : 0;
  const mirrorRows = ledgerDb ? Number(ledgerDb.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0) : 0;
  const archiveRows = Number(ledgerArchive.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0);
  const eligibleHotRows = mainDb
    ? Number(mainDb.queryScalar(
      "SELECT COUNT(*) FROM player_ledger WHERE created_at < datetime('now', ?)",
      [getRetentionCutoffModifier()]
    ) || 0)
    : 0;

  return {
    running: retentionRunning,
    retentionDays: LEDGER_RETENTION_DAYS,
    batchSize: LEDGER_RETENTION_BATCH_SIZE,
    intervalMs: LEDGER_RETENTION_INTERVAL_MS,
    startupDelayMs: LEDGER_RETENTION_STARTUP_DELAY_MS,
    eligibleHotRows,
    hotRows,
    mirrorRows,
    archiveRows,
    mainDbSizeMB: fileSizeMB(WORD_TYCOON_DB_PATH),
    mirrorDbSizeMB: ledgerDb?.LEDGER_DB_PATH ? fileSizeMB(ledgerDb.LEDGER_DB_PATH) : null,
    archiveDbSizeMB: fileSizeMB(ledgerArchive.ARCHIVE_DB_PATH),
    archiveDbPath: ledgerArchive.ARCHIVE_DB_PATH,
    lastMaintenance
  };
}

function getMaintenanceStatus() {
  return buildMaintenanceStatus();
}

function scheduleRetention() {
  stopRetention();
  if (!mainDb || !ledgerDb) return;
  if (!Number.isFinite(LEDGER_RETENTION_DAYS) || LEDGER_RETENTION_DAYS <= 0) {
    console.log('[Ledger] Retention disabled');
    return;
  }

  retentionStartupTimer = setTimeout(() => {
    retentionStartupTimer = null;
    try {
      runRetentionPass({ reason: 'startup', compact: false });
    } catch (err) {
      console.error('[Ledger] Startup retention failed:', err.message);
    }

    retentionTimer = setInterval(() => {
      try {
        runRetentionPass({ reason: 'interval', compact: false });
      } catch (err) {
        console.error('[Ledger] Scheduled retention failed:', err.message);
      }
    }, LEDGER_RETENTION_INTERVAL_MS);

    if (retentionTimer && retentionTimer.unref) retentionTimer.unref();
  }, LEDGER_RETENTION_STARTUP_DELAY_MS);

  if (retentionStartupTimer && retentionStartupTimer.unref) retentionStartupTimer.unref();
}

function parseEntryDetail(entry) {
  if (entry.detail && typeof entry.detail === 'string') {
    try { entry.detail = JSON.parse(entry.detail); } catch { /* keep as string */ }
  }
  return entry;
}

function parseEntryDetails(entries) {
  return entries.map((entry) => parseEntryDetail(entry));
}

function buildLedgerFilters({ query, playerId, eventType, from, to } = {}) {
  const conditions = [];
  const params = [];

  if (playerId) {
    conditions.push('player_id = ?');
    params.push(playerId);
  }
  if (eventType) {
    const types = String(eventType).split(',').map((value) => value.trim()).filter(Boolean);
    if (types.length === 1) {
      conditions.push('event_type = ?');
      params.push(types[0]);
    } else if (types.length > 1) {
      conditions.push(`event_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }
  if (query) {
    const like = `%${query}%`;
    conditions.push('(player_name LIKE ? OR command LIKE ?)');
    params.push(like, like);
  }
  if (from) {
    conditions.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('created_at <= ?');
    params.push(to);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function storeCount(store, where, params) {
  return Number(store.queryScalar(`SELECT COUNT(*) FROM player_ledger ${where}`, params) || 0);
}

function storeEntries(store, where, params, limit, offset) {
  return store.queryAll(
    `SELECT * FROM player_ledger ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

function mergePagedEntries(hotStore, archiveStore, where, params, limit, offset) {
  const hotTotal = storeCount(hotStore, where, params);
  const archiveTotal = storeCount(archiveStore, where, params);
  const total = hotTotal + archiveTotal;
  let entries = [];

  if (offset < hotTotal) {
    const hotEntries = storeEntries(hotStore, where, params, limit, offset);
    entries = hotEntries;
    const remaining = limit - hotEntries.length;
    if (remaining > 0) {
      entries = entries.concat(storeEntries(archiveStore, where, params, remaining, 0));
    }
  } else {
    entries = storeEntries(archiveStore, where, params, limit, Math.max(0, offset - hotTotal));
  }

  return { entries: parseEntryDetails(entries), total };
}

/**
 * Record a ledger entry. Dual-writes to both databases.
 * Wrapped in try-catch so ledger failures never crash the game.
 */
function record({ playerId, playerName, platform, eventType, command, coinsBefore, coinsAfter, giftCoinsBefore, giftCoinsAfter, success, response, detail }) {
  try {
    const coinsDelta = (coinsAfter || 0) - (coinsBefore || 0);
    const giftCoinsDelta = (giftCoinsAfter != null && giftCoinsBefore != null)
      ? (giftCoinsAfter - giftCoinsBefore)
      : null;

    const truncResponse = response ? String(response).slice(0, 500) : null;
    const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;

    const sql = `INSERT INTO player_ledger
      (player_id, player_name, platform, event_type, command,
       coins_before, coins_after, coins_delta,
       gift_coins_before, gift_coins_after, gift_coins_delta,
       success, response, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      playerId,
      playerName || 'unknown',
      platform || 'unknown',
      eventType || 'unknown',
      command || null,
      coinsBefore || 0,
      coinsAfter || 0,
      coinsDelta,
      giftCoinsBefore != null ? giftCoinsBefore : null,
      giftCoinsAfter != null ? giftCoinsAfter : null,
      giftCoinsDelta,
      success != null ? success : 1,
      truncResponse,
      detailStr
    ];

    if (mainDb) {
      try { mainDb.run(sql, params); } catch (e) {
        console.error('[Ledger] Main DB write failed:', e.message);
      }
    }

    if (ledgerDb) {
      try {
        ledgerDb.run(sql, params);
        if (typeof ledgerDb.scheduleSave === 'function') {
          ledgerDb.scheduleSave();
        } else {
          ledgerDb.save();
        }
      } catch (e) {
        console.error('[Ledger] Ledger DB write failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[Ledger] Record failed:', err.message);
  }
}

/**
 * Search the ledger with flexible filters and pagination.
 * Returns { entries, total, page, limit, totalPages }
 */
function searchLedger({ query, playerId, eventType, from, to, page = 1, limit = 50 } = {}) {
  if (!mainDb) return { entries: [], total: 0, page: 1, limit, totalPages: 0 };

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Number(limit) || 50);
  const offset = (safePage - 1) * safeLimit;
  const { where, params } = buildLedgerFilters({ query, playerId, eventType, from, to });
  const { entries, total } = mergePagedEntries(mainDb, ledgerArchive, where, params, safeLimit, offset);

  return {
    entries,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit)
  };
}

function getPlayerLedger(playerId, { eventType, from, to, page = 1, limit = 50 } = {}) {
  return searchLedger({ playerId, eventType, from, to, page, limit });
}

function combineCountRows(rows) {
  const merged = {};
  for (const row of rows) {
    const key = row.event_type;
    merged[key] = (merged[key] || 0) + (Number(row.cnt) || 0);
  }
  return merged;
}

function getLedgerStats() {
  if (!mainDb) return { totalEntries: 0, byType: {}, totalCredits: 0, totalDebits: 0, topPlayers: [], recent24h: 0 };

  const hotTotal = Number(mainDb.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0);
  const archiveTotal = Number(ledgerArchive.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0);
  const totalEntries = hotTotal + archiveTotal;

  const hotTypeRows = mainDb.queryAll('SELECT event_type, COUNT(*) as cnt FROM player_ledger GROUP BY event_type ORDER BY cnt DESC');
  const archiveTypeRows = ledgerArchive.queryAll('SELECT event_type, COUNT(*) as cnt FROM player_ledger GROUP BY event_type ORDER BY cnt DESC');
  const byType = combineCountRows(hotTypeRows.concat(archiveTypeRows));

  const hotCredits = Number(mainDb.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta > 0') || 0);
  const archiveCredits = Number(ledgerArchive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta > 0') || 0);
  const totalCredits = hotCredits + archiveCredits;

  const hotDebits = Number(mainDb.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta < 0') || 0);
  const archiveDebits = Number(ledgerArchive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta < 0') || 0);
  const totalDebits = hotDebits + archiveDebits;

  const topRows = mainDb.queryAll(
    `SELECT player_id, player_name, COUNT(*) as entries,
            SUM(CASE WHEN coins_delta > 0 THEN coins_delta ELSE 0 END) as total_earned,
            SUM(CASE WHEN coins_delta < 0 THEN coins_delta ELSE 0 END) as total_spent
     FROM player_ledger GROUP BY player_id, player_name`
  ).concat(
    ledgerArchive.queryAll(
      `SELECT player_id, player_name, COUNT(*) as entries,
              SUM(CASE WHEN coins_delta > 0 THEN coins_delta ELSE 0 END) as total_earned,
              SUM(CASE WHEN coins_delta < 0 THEN coins_delta ELSE 0 END) as total_spent
       FROM player_ledger GROUP BY player_id, player_name`
    )
  );

  const topMap = new Map();
  for (const row of topRows) {
    const key = Number(row.player_id);
    const current = topMap.get(key) || {
      player_id: key,
      player_name: row.player_name,
      entries: 0,
      total_earned: 0,
      total_spent: 0
    };
    current.player_name = current.player_name || row.player_name;
    current.entries += Number(row.entries) || 0;
    current.total_earned += Number(row.total_earned) || 0;
    current.total_spent += Number(row.total_spent) || 0;
    topMap.set(key, current);
  }
  const topPlayers = [...topMap.values()]
    .sort((a, b) => (b.entries - a.entries) || String(a.player_name || '').localeCompare(String(b.player_name || '')))
    .slice(0, 10);

  const recent24h =
    Number(mainDb.queryScalar("SELECT COUNT(*) FROM player_ledger WHERE created_at >= datetime('now', '-1 day')") || 0) +
    Number(ledgerArchive.queryScalar("SELECT COUNT(*) FROM player_ledger WHERE created_at >= datetime('now', '-1 day')") || 0);

  return { totalEntries, byType, totalCredits, totalDebits, topPlayers, recent24h };
}

function getPlayerLedgerSummary(playerId) {
  if (!mainDb) return { totalCommands: 0, totalEarned: 0, totalSpent: 0, byType: {}, recentEntries: [] };

  const totalCommands =
    Number(mainDb.queryScalar('SELECT COUNT(*) FROM player_ledger WHERE player_id = ?', [playerId]) || 0) +
    Number(ledgerArchive.queryScalar('SELECT COUNT(*) FROM player_ledger WHERE player_id = ?', [playerId]) || 0);
  const totalEarned =
    Number(mainDb.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE player_id = ? AND coins_delta > 0', [playerId]) || 0) +
    Number(ledgerArchive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE player_id = ? AND coins_delta > 0', [playerId]) || 0);
  const totalSpent =
    Number(mainDb.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE player_id = ? AND coins_delta < 0', [playerId]) || 0) +
    Number(ledgerArchive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE player_id = ? AND coins_delta < 0', [playerId]) || 0);

  const typeRows = mainDb.queryAll(
    'SELECT event_type, COUNT(*) as cnt FROM player_ledger WHERE player_id = ? GROUP BY event_type ORDER BY cnt DESC',
    [playerId]
  ).concat(
    ledgerArchive.queryAll(
      'SELECT event_type, COUNT(*) as cnt FROM player_ledger WHERE player_id = ? GROUP BY event_type ORDER BY cnt DESC',
      [playerId]
    )
  );
  const byType = combineCountRows(typeRows);

  const hotEntries = mainDb.queryAll('SELECT * FROM player_ledger WHERE player_id = ? ORDER BY id DESC LIMIT 10', [playerId]);
  const archiveEntries = hotEntries.length < 10
    ? ledgerArchive.queryAll('SELECT * FROM player_ledger WHERE player_id = ? ORDER BY id DESC LIMIT ?', [playerId, 10 - hotEntries.length])
    : [];
  const recentEntries = parseEntryDetails(hotEntries.concat(archiveEntries));

  return { totalCommands, totalEarned, totalSpent, byType, recentEntries };
}

function getRetentionCutoffModifier() {
  return `-${LEDGER_RETENTION_DAYS} days`;
}

function loadRetentionBatch(limit) {
  return mainDb.queryAll(
    `SELECT *
     FROM player_ledger
     WHERE created_at < datetime('now', ?)
     ORDER BY id ASC
     LIMIT ?`,
    [getRetentionCutoffModifier(), limit]
  );
}

function deleteHotRowsByIds(ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  if (typeof mainDb.withTransactionSync === 'function') {
    return mainDb.withTransactionSync(() => {
      mainDb.run(`DELETE FROM player_ledger WHERE id IN (${placeholders})`, ids);
      return Number(mainDb.queryScalar('SELECT changes()') || 0);
    });
  }
  mainDb.run(`DELETE FROM player_ledger WHERE id IN (${placeholders})`, ids);
  return Number(mainDb.queryScalar('SELECT changes()') || 0);
}

function pruneMirrorBatch(limit) {
  if (!ledgerDb) return 0;
  const eligible = Number(ledgerDb.queryScalar(
    `SELECT COUNT(*)
     FROM (
       SELECT id
       FROM player_ledger
       WHERE created_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?
     )`,
    [getRetentionCutoffModifier(), limit]
  ) || 0);

  if (eligible <= 0) return 0;

  ledgerDb.run(
    `DELETE FROM player_ledger
     WHERE id IN (
       SELECT id
       FROM player_ledger
       WHERE created_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?
     )`,
    [getRetentionCutoffModifier(), limit]
  );
  return Number(ledgerDb.queryScalar('SELECT changes()') || eligible);
}

function compactStores() {
  if (mainDb) {
    mainDb.run('VACUUM');
    if (typeof mainDb.saveImmediate === 'function') mainDb.saveImmediate();
    else mainDb.save();
  }
  if (ledgerDb) {
    ledgerDb.run('VACUUM');
    ledgerDb.save();
  }
  ledgerArchive.vacuum();
}

function runRetentionPassInternal({ reason = 'manual', compact = false } = {}) {
  const batch = loadRetentionBatch(LEDGER_RETENTION_BATCH_SIZE);
  if (!batch.length) {
    return { archived: 0, deleted: 0, mirrorPruned: 0, compacted: false, cutoffDays: LEDGER_RETENTION_DAYS };
  }

  const archived = ledgerArchive.appendEntries(batch);
  const deleted = deleteHotRowsByIds(batch.map((entry) => entry.id));
  const mirrorPruned = pruneMirrorBatch(LEDGER_RETENTION_BATCH_SIZE);

  if (typeof mainDb.saveImmediate === 'function') mainDb.saveImmediate();
  else mainDb.save();
  ledgerDb.save();

  let compacted = false;
  if (compact) {
    compactStores();
    compacted = true;
  }

  const hotRemaining = Number(mainDb.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0);
  const archiveTotal = Number(ledgerArchive.queryScalar('SELECT COUNT(*) FROM player_ledger') || 0);
  console.log(
    `[Ledger] Retention ${reason} archived=${archived} deleted=${deleted} mirrorPruned=${mirrorPruned} ` +
    `hotRemaining=${hotRemaining} archiveTotal=${archiveTotal} cutoffDays=${LEDGER_RETENTION_DAYS}` +
    (compacted ? ' compacted=1' : '')
  );

  return { archived, deleted, mirrorPruned, compacted, hotRemaining, archiveTotal, cutoffDays: LEDGER_RETENTION_DAYS };
}

function runRetentionPass({ reason = 'manual', compact = false } = {}) {
  if (!mainDb || !ledgerDb) {
    return { archived: 0, deleted: 0, mirrorPruned: 0, compacted: false, skipped: 'not_initialized' };
  }
  if (retentionRunning) {
    return { archived: 0, deleted: 0, mirrorPruned: 0, compacted: false, skipped: 'already_running' };
  }
  if (!Number.isFinite(LEDGER_RETENTION_DAYS) || LEDGER_RETENTION_DAYS <= 0) {
    return { archived: 0, deleted: 0, mirrorPruned: 0, compacted: false, skipped: 'disabled' };
  }

  retentionRunning = true;
  try {
    const result = runRetentionPassInternal({ reason, compact });
    lastMaintenance = {
      type: compact ? 'retention+compact' : 'retention',
      reason,
      ranAt: new Date().toISOString(),
      ...result
    };
    return result;
  } finally {
    retentionRunning = false;
  }
}

function runRetentionDrain({ maxBatches = 10, compact = false, reason = 'manual-drain' } = {}) {
  const results = [];
  const safeBatches = Math.max(1, Number(maxBatches) || 1);
  for (let i = 0; i < safeBatches; i++) {
    const batchReason = i === 0 ? reason : `${reason}-${i + 1}`;
    const result = runRetentionPass({ reason: batchReason, compact: false });
    results.push(result);
    if (!result.archived) break;
  }

  const movedAny = results.some((result) => result.archived > 0);
  if (movedAny && compact) {
    compactStores();
  }

  return {
    batchesRun: results.length,
    archived: results.reduce((sum, result) => sum + (result.archived || 0), 0),
    deleted: results.reduce((sum, result) => sum + (result.deleted || 0), 0),
    mirrorPruned: results.reduce((sum, result) => sum + (result.mirrorPruned || 0), 0),
    compacted: movedAny && compact,
    results
  };
}

function runMaintenance({ reason = 'manual-maintenance', maxBatches = 10, compact = false } = {}) {
  if (!mainDb || !ledgerDb) {
    return { ok: false, skipped: 'not_initialized' };
  }
  if (retentionRunning) {
    return { ok: false, skipped: 'already_running' };
  }

  retentionRunning = true;
  try {
    const before = buildMaintenanceStatus();
    const safeBatches = Math.max(0, Number(maxBatches) || 0);
    const results = [];
    for (let i = 0; i < safeBatches; i++) {
      const batchReason = i === 0 ? reason : `${reason}-${i + 1}`;
      const result = runRetentionPassInternal({ reason: batchReason, compact: false });
      results.push(result);
      if (!result.archived) break;
    }

    if (compact) {
      compactStores();
      console.log(`[Ledger] Maintenance compact reason=${reason} compacted=1`);
    }

    const after = buildMaintenanceStatus();
    const archived = results.reduce((sum, result) => sum + (result.archived || 0), 0);
    const deleted = results.reduce((sum, result) => sum + (result.deleted || 0), 0);
    const mirrorPruned = results.reduce((sum, result) => sum + (result.mirrorPruned || 0), 0);
    const output = {
      ok: true,
      reason,
      batchesRun: results.length,
      archived,
      deleted,
      mirrorPruned,
      compacted: !!compact,
      before,
      after,
      results
    };
    lastMaintenance = {
      type: compact ? 'maintenance+compact' : 'maintenance',
      reason,
      ranAt: new Date().toISOString(),
      batchesRun: output.batchesRun,
      archived,
      deleted,
      mirrorPruned,
      compacted: output.compacted,
      before: {
        hotRows: before.hotRows,
        archiveRows: before.archiveRows,
        mainDbSizeMB: before.mainDbSizeMB,
        mirrorDbSizeMB: before.mirrorDbSizeMB,
        archiveDbSizeMB: before.archiveDbSizeMB
      },
      after: {
        hotRows: after.hotRows,
        archiveRows: after.archiveRows,
        mainDbSizeMB: after.mainDbSizeMB,
        mirrorDbSizeMB: after.mirrorDbSizeMB,
        archiveDbSizeMB: after.archiveDbSizeMB
      }
    };
    return output;
  } finally {
    retentionRunning = false;
  }
}

module.exports = {
  initialize,
  stopRetention,
  record,
  searchLedger,
  getPlayerLedger,
  getLedgerStats,
  getPlayerLedgerSummary,
  getMaintenanceStatus,
  runRetentionPass,
  runRetentionDrain,
  runMaintenance
};
