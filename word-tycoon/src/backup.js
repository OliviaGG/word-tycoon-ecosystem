const fs = require('fs');
const crypto = require('node:crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { BACKUP_DIR, DB_PATH, LEDGER_DB_PATH, LEDGER_ARCHIVE_DB_PATH } = require('./paths');

const LEDGER_ARCHIVE_BACKUP_TYPE = 'ledger-archive';
const SNAPSHOT_DB_DIRS = ['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', 'manual', 'pre-restore', LEDGER_ARCHIVE_BACKUP_TYPE];
const SNAPSHOT_DB_TYPES = new Set(SNAPSHOT_DB_DIRS);
const AUTO_DEDUP_BACKUP_TYPES = new Set(['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown']);
const RECOMMENDED_RETENTION_TARGETS = {
  rolling: 6,
  hourly: 12,
  daily: 14,
  startup: 12,
  'pre-shutdown': 8,
  'ledger-archive': 2,
  snapshots: 10,
  manual: null,
  'pre-restore': null
};

// Backup settings
// These are logical snapshot counts, not raw .db file counts.
const MAX_ROLLING_BACKUPS = parseInt(process.env.MAX_ROLLING_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS.rolling), 10);
const MAX_HOURLY_BACKUPS = parseInt(process.env.MAX_HOURLY_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS.hourly), 10);
const MAX_DAILY_BACKUPS = parseInt(process.env.MAX_DAILY_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS.daily), 10);
const MAX_STARTUP_BACKUPS = parseInt(process.env.MAX_STARTUP_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS.startup), 10);
const MAX_SHUTDOWN_BACKUPS = parseInt(process.env.MAX_SHUTDOWN_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS['pre-shutdown']), 10);
const MAX_LEDGER_ARCHIVE_BACKUPS = parseInt(process.env.MAX_LEDGER_ARCHIVE_BACKUPS || String(RECOMMENDED_RETENTION_TARGETS['ledger-archive']), 10);
const MAX_JSON_SNAPSHOTS = parseInt(process.env.MAX_JSON_SNAPSHOTS || String(RECOMMENDED_RETENTION_TARGETS.snapshots), 10);
const PERIODIC_BACKUP_MS = 5 * 60 * 1000; // Every 5 minutes
const HOURLY_BACKUP_MS = 60 * 60 * 1000;  // Every hour

let periodicTimer = null;
let hourlyTimer = null;
let lastBackupHash = null;
let lastLedgerArchiveHash = null;

function getConfiguredRetentionTargets() {
  return {
    rolling: MAX_ROLLING_BACKUPS,
    hourly: MAX_HOURLY_BACKUPS,
    daily: MAX_DAILY_BACKUPS,
    startup: MAX_STARTUP_BACKUPS,
    'pre-shutdown': MAX_SHUTDOWN_BACKUPS,
    'ledger-archive': MAX_LEDGER_ARCHIVE_BACKUPS,
    snapshots: MAX_JSON_SNAPSHOTS,
    manual: null,
    'pre-restore': null
  };
}

function initialize() {
  // Create backup directories
  const dirs = [
    BACKUP_DIR,
    path.join(BACKUP_DIR, 'rolling'),
    path.join(BACKUP_DIR, 'hourly'),
    path.join(BACKUP_DIR, 'daily'),
    path.join(BACKUP_DIR, 'pre-shutdown'),
    path.join(BACKUP_DIR, LEDGER_ARCHIVE_BACKUP_TYPE)
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Create startup backup (snapshot before any changes this session)
  createBackup('startup');
  createLedgerArchiveBackup();
  applyConfiguredRetention();

  // Start periodic backups (every 5 minutes)
  periodicTimer = setInterval(() => createRollingBackup(), PERIODIC_BACKUP_MS);

  // Start hourly backups
  hourlyTimer = setInterval(() => createHourlyBackup(), HOURLY_BACKUP_MS);

  console.log('[Backup] Data redundancy system initialized');
  console.log(`[Backup]   Rolling: every 5 min (keep ${MAX_ROLLING_BACKUPS})`);
  console.log(`[Backup]   Hourly: every 1 hr (keep ${MAX_HOURLY_BACKUPS})`);
  console.log(`[Backup]   Daily: on first hourly of each day (keep ${MAX_DAILY_BACKUPS})`);
  console.log(`[Backup]   Ledger archive: keep ${MAX_LEDGER_ARCHIVE_BACKUPS} changed snapshots`);
  console.log(`[Backup]   Startup/Shutdown: automatic snapshots`);

  return listBackupStats();
}

/**
 * Snapshot the ledger archive to destPath.
 *
 * SQLite's VACUUM INTO provides a consistent snapshot even during retention.
 * Failure removes the partial output and fails closed; a raw copy could be torn.
 */
function copyArchiveConsistently(destPath) {
  let source = null;
  try {
    source = new DatabaseSync(LEDGER_ARCHIVE_DB_PATH, { readOnly: true });
    source.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    return 'vacuum-into';
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw new Error('Consistent ledger archive snapshot unavailable');
  } finally {
    if (source) { try { source.close(); } catch (_) {} }
  }
}

function createLedgerArchiveBackup(type = LEDGER_ARCHIVE_BACKUP_TYPE) {
  try {
    if (!fs.existsSync(LEDGER_ARCHIVE_DB_PATH)) {
      return { ok: true, skipped: true, message: 'No ledger archive DB to backup' };
    }

    const now = new Date();
    const timestamp = formatTimestamp(now);
    const subDir = path.join(BACKUP_DIR, type);
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    const archiveStat = fs.statSync(LEDGER_ARCHIVE_DB_PATH);
    const hash = simpleHashFile(LEDGER_ARCHIVE_DB_PATH, archiveStat.size);
    if (
      hash === lastLedgerArchiveHash ||
      hasMatchingLatestSnapshot(subDir, hash, type, 'player-ledger-archive')
    ) {
      return { ok: true, skipped: true, message: 'No changes since latest ledger archive snapshot' };
    }

    const filename = `player-ledger-archive_${type}_${timestamp}.db`;
    const destPath = path.join(subDir, filename);
    // VACUUM INTO, not copyFileSync: ledger-archive.js writes the archive in
    // place (node:sqlite) rather than via an atomic tmp+rename, so a raw file
    // copy taken during a commit could be torn. VACUUM INTO takes a read lock
    // and emits a guaranteed-consistent, compacted snapshot. It costs ~1.8s on
    // a 527MB archive vs ~0.5s for a copy, and no extra memory.
    copyArchiveConsistently(destPath);
    lastLedgerArchiveHash = hash;
    pruneSnapshotDir(subDir, MAX_LEDGER_ARCHIVE_BACKUPS, type);

    const size = fs.statSync(destPath).size;
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    console.log(`[Backup] ${type} backup created: ${filename} (${sizeMB} MB)`);

    return { ok: true, file: filename, size, sizeMB };
  } catch (err) {
    console.error('[Backup] Ledger archive backup failed:', err.message);
    return { ok: false, message: err.message };
  }
}

/**
 * Create a timestamped backup of the database file
 * @param {string} type - 'rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', 'manual'
 * @returns {{ ok: boolean, file?: string, size?: number, message?: string }}
 */
function createBackup(type = 'manual') {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { ok: false, message: 'No database file to backup' };
    }

    const now = new Date();
    const timestamp = formatTimestamp(now);
    const subDir = (type === 'startup' || type === 'pre-shutdown' || type === 'manual')
      ? type === 'manual' ? BACKUP_DIR : path.join(BACKUP_DIR, type)
      : path.join(BACKUP_DIR, type);

    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    const filename = `word-tycoon_${type}_${timestamp}.db`;
    const destPath = path.join(subDir, filename);
    const dbStat = fs.statSync(DB_PATH);

    // Skip if identical to last backup (no changes)
    const hash = simpleHashFile(DB_PATH, dbStat.size);
    if (type === 'rolling' && hash === lastBackupHash) {
      return { ok: true, skipped: true, message: 'No changes since last backup' };
    }
    if (AUTO_DEDUP_BACKUP_TYPES.has(type) && hasMatchingLatestSnapshot(subDir, hash, type)) {
      return { ok: true, skipped: true, message: `No changes since latest ${type} snapshot` };
    }

    // Write backup without loading another full JS copy of the DB into memory.
    fs.copyFileSync(DB_PATH, destPath);

    // Also backup the ledger DB if it exists
    if (fs.existsSync(LEDGER_DB_PATH)) {
      try {
        const ledgerFilename = `player-ledger_${type}_${timestamp}.db`;
        const ledgerDestPath = path.join(subDir, ledgerFilename);
        fs.copyFileSync(LEDGER_DB_PATH, ledgerDestPath);
      } catch (ledgerErr) {
        try { fs.unlinkSync(destPath); } catch (_) {}
        throw new Error('Ledger mirror snapshot unavailable');
      }
    }
    lastBackupHash = hash;

    const sizeMB = (dbStat.size / (1024 * 1024)).toFixed(2);
    console.log(`[Backup] ${type} backup created: ${filename} (${sizeMB} MB)`);

    return { ok: true, file: filename, size: dbStat.size, sizeMB };
  } catch (err) {
    console.error(`[Backup] Failed to create ${type} backup:`, err.message);
    return { ok: false, message: err.message };
  }
}

/**
 * Create a backup from an in-memory sql.js database object (used by save())
 * This avoids race conditions by backing up the exact data being saved
 */
function createBackupFromBuffer(buffer, type = 'rolling') {
  try {
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const subDir = path.join(BACKUP_DIR, type);

    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    const filename = `word-tycoon_${type}_${timestamp}.db`;
    const destPath = path.join(subDir, filename);

    fs.writeFileSync(destPath, buffer);

    return { ok: true, file: filename, size: buffer.length };
  } catch (err) {
    console.error(`[Backup] Buffer backup failed:`, err.message);
    return { ok: false, message: err.message };
  }
}

function createRollingBackup() {
  const result = createBackup('rolling');
  if (result.ok && !result.skipped) {
    pruneBackups(path.join(BACKUP_DIR, 'rolling'), MAX_ROLLING_BACKUPS);
  }
  return result;
}

function createHourlyBackup() {
  const archiveResult = createLedgerArchiveBackup();

  // Also check if we need a daily backup (first hourly of the day)
  const dailyDir = path.join(BACKUP_DIR, 'daily');
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const existingDailies = fs.existsSync(dailyDir)
    ? fs.readdirSync(dailyDir).filter(f => f.includes(today))
    : [];

  if (existingDailies.length === 0) {
    createBackup('daily');
    pruneBackups(dailyDir, MAX_DAILY_BACKUPS);
  }

  const result = createBackup('hourly');
  if (result.ok) {
    pruneBackups(path.join(BACKUP_DIR, 'hourly'), MAX_HOURLY_BACKUPS);
  }
  if (archiveResult.ok && !archiveResult.skipped) {
    pruneSnapshotDir(path.join(BACKUP_DIR, LEDGER_ARCHIVE_BACKUP_TYPE), MAX_LEDGER_ARCHIVE_BACKUPS, LEDGER_ARCHIVE_BACKUP_TYPE);
  }
  return result;
}

function createShutdownBackup() {
  const result = createBackup('pre-shutdown');
  createLedgerArchiveBackup();
  pruneBackups(path.join(BACKUP_DIR, 'pre-shutdown'), MAX_SHUTDOWN_BACKUPS);
  return result;
}

function hasMatchingLatestSnapshot(dir, hash, explicitType = null, dbKind = 'word-tycoon') {
  try {
    const snapshots = listSnapshotsInDir(dir, explicitType);
    const latest = snapshots[0];
    if (!latest) return false;
    const mainFile = latest.files.find((file) => file.dbKind === dbKind);
    if (!mainFile) return false;
    const latestPath = path.join(dir, mainFile.name);
    if (!fs.existsSync(latestPath)) return false;
    const latestHash = simpleHashFile(latestPath);
    return latestHash === hash;
  } catch (_) {
    return false;
  }
}

/**
 * Keep only the N most recent files in a directory, delete older ones
 */
function pruneBackups(dir, maxKeep) {
  try {
    if (!fs.existsSync(dir)) return;
    const snapshots = listSnapshotsInDir(dir);

    if (snapshots.length > maxKeep) {
      const toDelete = snapshots.slice(maxKeep);
      let deletedFiles = 0;
      for (const snapshot of toDelete) {
        for (const file of snapshot.files) {
          fs.unlinkSync(path.join(dir, file.name));
          deletedFiles++;
        }
      }
      if (toDelete.length > 0) {
        console.log(`[Backup] Pruned ${toDelete.length} backup snapshots (${deletedFiles} files) from ${path.basename(dir)}`);
      }
    }
  } catch (err) {
    console.error(`[Backup] Prune error in ${dir}:`, err.message);
  }
}

function pruneSnapshotDir(dir, maxKeep, explicitType = null) {
  if (!Number.isFinite(maxKeep)) {
    return { ok: true, deletedSnapshots: 0, deletedFiles: 0 };
  }

  const snapshots = listSnapshotsInDir(dir, explicitType);
  if (snapshots.length <= maxKeep) {
    return { ok: true, deletedSnapshots: 0, deletedFiles: 0 };
  }

  const toDelete = snapshots.slice(maxKeep);
  let deletedFiles = 0;
  for (const snapshot of toDelete) {
    for (const file of snapshot.files) {
      fs.unlinkSync(path.join(dir, file.name));
      deletedFiles++;
    }
  }

  return {
    ok: true,
    deletedSnapshots: toDelete.length,
    deletedFiles
  };
}

function applyRetentionTargets(targets = getConfiguredRetentionTargets()) {
  const summary = {};
  const dirMap = {
    rolling: path.join(BACKUP_DIR, 'rolling'),
    hourly: path.join(BACKUP_DIR, 'hourly'),
    daily: path.join(BACKUP_DIR, 'daily'),
    startup: path.join(BACKUP_DIR, 'startup'),
    'pre-shutdown': path.join(BACKUP_DIR, 'pre-shutdown'),
    'ledger-archive': path.join(BACKUP_DIR, LEDGER_ARCHIVE_BACKUP_TYPE),
    'pre-restore': path.join(BACKUP_DIR, 'pre-restore')
  };

  for (const [key, dir] of Object.entries(dirMap)) {
    summary[key] = pruneSnapshotDir(dir, targets[key], key === 'pre-restore' ? 'pre-restore' : null);
  }

  summary.manual = pruneSnapshotDir(BACKUP_DIR, targets.manual, 'manual');
  pruneFiles(path.join(BACKUP_DIR, 'snapshots'), '.json', targets.snapshots);
  summary.snapshots = buildFilePruneReport(path.join(BACKUP_DIR, 'snapshots'), '.json', targets.snapshots);

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    targets,
    summary,
    postPrune: buildPruneReport(targets)
  };
}

function applyConfiguredRetention() {
  return applyRetentionTargets(getConfiguredRetentionTargets());
}

/**
 * List all available backups with stats
 */
function listBackupStats() {
  const stats = {};
  const subdirs = ['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', LEDGER_ARCHIVE_BACKUP_TYPE, 'pre-restore'];

  for (const sub of subdirs) {
    const dir = path.join(BACKUP_DIR, sub);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'))
        .map(f => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, modified: st.mtime.toISOString() };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
      const snapshots = listSnapshotsInDir(dir);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      stats[sub] = {
        count: files.length,
        snapshotCount: snapshots.length,
        totalBytes,
        totalSizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
        files
      };
    } else {
      stats[sub] = { count: 0, snapshotCount: 0, totalBytes: 0, totalSizeMB: '0.00', files: [] };
    }
  }

  // Also check root backup dir for manual backups
  const manualFiles = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db') && !fs.statSync(path.join(BACKUP_DIR, f)).isDirectory())
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, modified: st.mtime.toISOString() };
      })
    : [];
  const manualSnapshots = listSnapshotsInDir(BACKUP_DIR, 'manual');
  const manualBytes = manualFiles.reduce((sum, file) => sum + file.size, 0);
  stats.manual = {
    count: manualFiles.length,
    snapshotCount: manualSnapshots.length,
    totalBytes: manualBytes,
    totalSizeMB: (manualBytes / (1024 * 1024)).toFixed(2),
    files: manualFiles
  };

  return stats;
}

/**
 * List all backup files across all categories, sorted by date (newest first)
 */
function listAllBackups() {
  const all = [];
  const subdirs = ['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', LEDGER_ARCHIVE_BACKUP_TYPE, 'pre-restore'];

  for (const sub of subdirs) {
    const dir = path.join(BACKUP_DIR, sub);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));
      for (const f of files) {
        const st = fs.statSync(path.join(dir, f));
        all.push({
          type: sub,
          name: f,
          path: path.join(dir, f),
          size: st.size,
          sizeMB: (st.size / (1024 * 1024)).toFixed(2),
          modified: st.mtime.toISOString()
        });
      }
    }
  }

  if (fs.existsSync(BACKUP_DIR)) {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db') && !fs.statSync(path.join(BACKUP_DIR, f)).isDirectory());
    for (const f of files) {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      all.push({
        type: 'manual',
        name: f,
        path: path.join(BACKUP_DIR, f),
        size: st.size,
        sizeMB: (st.size / (1024 * 1024)).toFixed(2),
        modified: st.mtime.toISOString()
      });
    }
  }

  return all.sort((a, b) => b.modified.localeCompare(a.modified));
}

function parseSnapshotMeta(filename, dirHint = null) {
  const rootMatch = filename.match(/^(.+?)_(rolling|hourly|daily|startup|pre-shutdown|manual|pre-restore|ledger-archive)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})\.db$/);
  if (rootMatch) {
    const [, dbKind, type, timestamp] = rootMatch;
    return {
      dbKind,
      type,
      timestamp,
      key: `${type}:${timestamp}`
    };
  }
  if (dirHint && dirHint === 'manual') {
    const manualMatch = filename.match(/^(.+?)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})\.db$/);
    if (manualMatch) {
      return {
        dbKind: manualMatch[1],
        type: 'manual',
        timestamp: manualMatch[2],
        key: `manual:${manualMatch[2]}`
      };
    }
  }
  return null;
}

function listSnapshotsInDir(dir, explicitType = null) {
  if (!fs.existsSync(dir)) return [];
  const dirName = explicitType || path.basename(dir);
  if (explicitType && !SNAPSHOT_DB_TYPES.has(explicitType)) return [];
  const groups = new Map();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));

  for (const name of files) {
    const meta = parseSnapshotMeta(name, explicitType);
    if (!meta) continue;
    const filePath = path.join(dir, name);
    const st = fs.statSync(filePath);
    const existing = groups.get(meta.key) || {
      key: meta.key,
      type: meta.type || dirName,
      timestamp: meta.timestamp,
      modified: st.mtime.toISOString(),
      modifiedMs: st.mtimeMs,
      totalBytes: 0,
      files: []
    };
    existing.files.push({
      name,
      dbKind: meta.dbKind,
      size: st.size,
      modified: st.mtime.toISOString()
    });
    existing.totalBytes += st.size;
    if (st.mtimeMs > existing.modifiedMs) {
      existing.modifiedMs = st.mtimeMs;
      existing.modified = st.mtime.toISOString();
    }
    groups.set(meta.key, existing);
  }

  return [...groups.values()]
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .map(snapshot => ({
      ...snapshot,
      totalSizeMB: (snapshot.totalBytes / (1024 * 1024)).toFixed(2)
    }));
}

function buildDirPruneReport(dir, targetSnapshots, options = {}) {
  const snapshots = options.dbSnapshots || listSnapshotsInDir(dir, options.explicitType);
  const keep = Number.isFinite(targetSnapshots) ? targetSnapshots : null;
  const totalBytes = snapshots.reduce((sum, snapshot) => sum + snapshot.totalBytes, 0);
  const retained = keep == null ? snapshots : snapshots.slice(0, keep);
  const pruned = keep == null ? [] : snapshots.slice(keep);
  const retainedBytes = retained.reduce((sum, snapshot) => sum + snapshot.totalBytes, 0);
  const reclaimableBytes = pruned.reduce((sum, snapshot) => sum + snapshot.totalBytes, 0);
  return {
    count: snapshots.length,
    keep,
    totalBytes,
    totalSizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
    retainedCount: retained.length,
    retainedSizeMB: (retainedBytes / (1024 * 1024)).toFixed(2),
    reclaimableBytes,
    reclaimableSizeMB: (reclaimableBytes / (1024 * 1024)).toFixed(2),
    pruneCandidateCount: pruned.length,
    pruneCandidates: pruned.map(snapshot => ({
      key: snapshot.key,
      timestamp: snapshot.timestamp,
      totalSizeMB: snapshot.totalSizeMB,
      files: snapshot.files.map(file => file.name)
    }))
  };
}

function buildFilePruneReport(dir, ext, targetFiles) {
  if (!fs.existsSync(dir)) {
    return {
      count: 0,
      keep: targetFiles,
      totalBytes: 0,
      totalSizeMB: '0.00',
      retainedCount: 0,
      retainedSizeMB: '0.00',
      reclaimableBytes: 0,
      reclaimableSizeMB: '0.00',
      pruneCandidateCount: 0,
      pruneCandidates: []
    };
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return {
        name: f,
        modifiedMs: st.mtimeMs,
        modified: st.mtime.toISOString(),
        size: st.size
      };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs);

  const keep = Number.isFinite(targetFiles) ? targetFiles : null;
  const retained = keep == null ? files : files.slice(0, keep);
  const pruned = keep == null ? [] : files.slice(keep);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const retainedBytes = retained.reduce((sum, file) => sum + file.size, 0);
  const reclaimableBytes = pruned.reduce((sum, file) => sum + file.size, 0);

  return {
    count: files.length,
    keep,
    totalBytes,
    totalSizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
    retainedCount: retained.length,
    retainedSizeMB: (retainedBytes / (1024 * 1024)).toFixed(2),
    reclaimableBytes,
    reclaimableSizeMB: (reclaimableBytes / (1024 * 1024)).toFixed(2),
    pruneCandidateCount: pruned.length,
    pruneCandidates: pruned.map(file => ({
      name: file.name,
      modified: file.modified,
      sizeMB: (file.size / (1024 * 1024)).toFixed(2)
    }))
  };
}

function buildPruneReport(targets = RECOMMENDED_RETENTION_TARGETS) {
  const configuredTargets = getConfiguredRetentionTargets();
  const snapshotDirs = ['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', LEDGER_ARCHIVE_BACKUP_TYPE];
  const reports = {};

  for (const sub of snapshotDirs) {
    const dir = path.join(BACKUP_DIR, sub);
    reports[sub] = buildDirPruneReport(dir, targets[sub], {
      dbSnapshots: listSnapshotsInDir(dir)
    });
  }

  reports.manual = buildDirPruneReport(BACKUP_DIR, targets.manual, {
    explicitType: 'manual',
    dbSnapshots: listSnapshotsInDir(BACKUP_DIR, 'manual')
  });
  reports['pre-restore'] = buildDirPruneReport(path.join(BACKUP_DIR, 'pre-restore'), targets['pre-restore'], {
    explicitType: 'pre-restore',
    dbSnapshots: listSnapshotsInDir(path.join(BACKUP_DIR, 'pre-restore'), 'pre-restore')
  });
  reports.snapshots = buildFilePruneReport(path.join(BACKUP_DIR, 'snapshots'), '.json', targets.snapshots);

  const reclaimableBytes = Object.values(reports).reduce((sum, entry) => sum + (entry.reclaimableBytes || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    configuredTargets,
    requestedTargets: targets,
    reclaimableBytes,
    reclaimableSizeMB: (reclaimableBytes / (1024 * 1024)).toFixed(2),
    categories: reports
  };
}

/**
 * Restore from a backup file. Creates a pre-restore backup first.
 * @param {string} backupFilePath - Full path to the backup file to restore
 * @returns {{ ok: boolean, message: string }}
 */
function restoreFromBackup() {
  return { ok: false, message: 'Online restore disabled. Use the stopped-service offline cohort procedure.' };
}

function createJsonSnapshot(dbModule) {
  try {
    const snapshotDir = path.join(BACKUP_DIR, 'snapshots');
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

    const players = dbModule.queryAll('SELECT * FROM players ORDER BY id');
    const businesses = dbModule.queryAll(
      `SELECT pb.*, p.display_name AS player_name
       FROM player_businesses pb
       JOIN players p ON p.id = pb.player_id
       ORDER BY pb.player_id, pb.business_type`
    );
    const playerCosmetics = dbModule.queryAll(
      `SELECT pc.*, c.name AS cosmetic_name, c.category, p.display_name AS player_name
       FROM player_cosmetics pc
       JOIN cosmetics c ON c.id = pc.cosmetic_id
       JOIN players p ON p.id = pc.player_id
       ORDER BY pc.player_id`
    );

    // Index businesses and cosmetics by player ID for inline embedding
    const bizByPlayer = {};
    for (const b of businesses) {
      if (!bizByPlayer[b.player_id]) bizByPlayer[b.player_id] = [];
      bizByPlayer[b.player_id].push({
        businessType: b.business_type,
        level: b.level,
        lastCollectedAt: b.last_collected_at
      });
    }

    const cosByPlayer = {};
    for (const c of playerCosmetics) {
      if (!cosByPlayer[c.player_id]) cosByPlayer[c.player_id] = [];
      cosByPlayer[c.player_id].push({
        cosmeticId: c.cosmetic_id,
        cosmeticName: c.cosmetic_name,
        category: c.category,
        equipped: c.equipped === 1,
        purchasedAt: c.purchased_at
      });
    }

    const snapshot = {
      version: 2,
      exportedAt: new Date().toISOString(),
      stats: {
        totalPlayers: players.length,
        totalBusinesses: businesses.length,
        totalCosmeticsOwned: playerCosmetics.length,
        totalCoinsInCirculation: players.reduce((sum, p) => sum + (p.xp || 0) + (p.coins || 0), 0),
        totalTapsAllTime: players.reduce((sum, p) => sum + (p.total_taps || 0), 0)
      },
      players: players.map(p => ({
        id: p.id,
        platform: p.platform,
        platformUserId: p.platform_user_id,
        username: p.username,
        displayName: p.display_name,
        profilePic: p.profile_pic || null,
        coins: p.coins,
        xp: p.xp,
        totalTaps: p.total_taps,
        tapPower: p.tap_power,
        critChance: p.crit_chance,
        multiTap: p.multi_tap,
        createdAt: p.created_at,
        lastSeen: p.last_seen,
        businesses: bizByPlayer[p.id] || [],
        cosmetics: cosByPlayer[p.id] || []
      }))
    };

    const timestamp = formatTimestamp(new Date());
    const filename = `snapshot_${timestamp}.json`;
    const filePath = path.join(snapshotDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    // Keep the configured number of JSON snapshots
    pruneFiles(snapshotDir, '.json', MAX_JSON_SNAPSHOTS);

    const sizeMB = (Buffer.byteLength(JSON.stringify(snapshot)) / (1024 * 1024)).toFixed(2);
    console.log(`[Backup] JSON snapshot created: ${filename} (${sizeMB} MB, ${players.length} players)`);

    return { ok: true, file: filename, stats: snapshot.stats };
  } catch (err) {
    console.error('[Backup] JSON snapshot failed:', err.message);
    return { ok: false, message: err.message };
  }
}

function pruneFiles(dir, ext, maxKeep) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(ext))
      .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (files.length > maxKeep) {
      for (const file of files.slice(maxKeep)) {
        fs.unlinkSync(path.join(dir, file.name));
      }
    }
  } catch (err) { /* ignore */ }
}

function formatTimestamp(date) {
  return date.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function simpleHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function simpleHashFile(filePath, knownSize = null) {
  const statSize = knownSize != null ? knownSize : fs.statSync(filePath).size;
  const chunkSize = 256 * 1024;
  const chunk = Buffer.allocUnsafe(chunkSize);
  const fd = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  let position = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, chunk, 0, chunkSize, position);
      if (bytesRead <= 0) break;

      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest('hex');
}

function shutdown({ createSnapshot = true } = {}) {
  if (periodicTimer) clearInterval(periodicTimer);
  if (hourlyTimer) clearInterval(hourlyTimer);
  if (createSnapshot) createShutdownBackup();
  console.log('[Backup] Backup timers stopped');
}

module.exports = {
  initialize,
  createBackup,
  createLedgerArchiveBackup,
  createBackupFromBuffer,
  createRollingBackup,
  createHourlyBackup,
  createShutdownBackup,
  listBackupStats,
  listAllBackups,
  parseSnapshotMeta,
  listSnapshotsInDir,
  restoreFromBackup,
  createJsonSnapshot,
  buildDirPruneReport,
  buildPruneReport,
  applyRetentionTargets,
  applyConfiguredRetention,
  getConfiguredRetentionTargets,
  RECOMMENDED_RETENTION_TARGETS,
  LEDGER_ARCHIVE_BACKUP_TYPE,
  shutdown,
  BACKUP_DIR
};
