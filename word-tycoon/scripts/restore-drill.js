#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const backup = require('../src/backup');

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');
const LEDGER_ARCHIVE_TYPE = backup.LEDGER_ARCHIVE_BACKUP_TYPE || 'ledger-archive';
const DEFAULT_TYPES = ['startup', 'hourly', 'daily', 'pre-shutdown', LEDGER_ARCHIVE_TYPE];
const MAIN_DB_KINDS = new Set(['word-tycoon', 'word-empires']);
const MAIN_REQUIRED_TABLES = ['players', 'player_ledger', 'linked_accounts', 'player_businesses', 'cosmetics'];
const LEDGER_REQUIRED_TABLES = ['player_ledger'];
const LEDGER_ARCHIVE_REQUIRED_TABLES = ['player_ledger'];

function parseArgs(argv) {
  const args = {
    backupDir: backup.BACKUP_DIR,
    types: DEFAULT_TYPES,
    snapshotsPerType: 1,
    json: false,
    requireLedgerMirror: true,
    minPlayers: 1,
    minMainLedgerRows: 1,
    minLedgerMirrorRows: 1,
    minLedgerArchiveRows: 1
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--backup-dir' && argv[i + 1]) {
      args.backupDir = argv[++i];
    } else if (arg === '--types' && argv[i + 1]) {
      args.types = argv[++i].split(',').map((type) => type.trim()).filter(Boolean);
    } else if (arg === '--snapshots-per-type' && argv[i + 1]) {
      args.snapshotsPerType = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === '--no-ledger-mirror') {
      args.requireLedgerMirror = false;
    } else if (arg === '--min-players' && argv[i + 1]) {
      args.minPlayers = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === '--min-main-ledger-rows' && argv[i + 1]) {
      args.minMainLedgerRows = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === '--min-ledger-mirror-rows' && argv[i + 1]) {
      args.minLedgerMirrorRows = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === '--min-ledger-archive-rows' && argv[i + 1]) {
      args.minLedgerArchiveRows = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/restore-drill.js [options]

Read-only backup restore drill. Loads retained backup snapshots into memory,
runs SQLite integrity checks, and verifies key Word Tycoon/ledger tables.

Options:
  --backup-dir PATH              Backup root directory (default: data/backups)
  --types LIST                   Comma-separated types (default: ${DEFAULT_TYPES.join(',')})
  --snapshots-per-type N         Newest snapshots to check per type (default: 1)
  --no-ledger-mirror             Do not fail if a matching player-ledger backup is absent
  --min-players N                Minimum players expected in main DB (default: 1)
  --min-main-ledger-rows N       Minimum hot ledger rows expected in main DB (default: 1)
  --min-ledger-mirror-rows N     Minimum ledger mirror rows expected (default: 1)
  --min-ledger-archive-rows N    Minimum archived ledger rows expected (default: 1)
  --json                         Print JSON report`);
}

function hasSqliteHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.allocUnsafe(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(fd, header, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryScalar(db, sql, params = []) {
  const row = queryAll(db, sql, params)[0];
  if (!row) return null;
  const key = Object.keys(row)[0];
  return row[key];
}

function tableExists(db, tableName) {
  return Number(queryScalar(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ) || 0) > 0;
}

function countTable(db, tableName) {
  if (!tableExists(db, tableName)) return null;
  return Number(queryScalar(db, `SELECT COUNT(*) FROM ${tableName}`) || 0);
}

function inspectDatabase(SQL, filePath, requiredTables, countTables) {
  const stat = fs.statSync(filePath);
  const result = {
    path: filePath,
    sizeBytes: stat.size,
    sizeMB: Number((stat.size / (1024 * 1024)).toFixed(2)),
    headerOk: hasSqliteHeader(filePath),
    integrityOk: false,
    integrityResult: null,
    requiredTables: {},
    counts: {},
    errors: []
  };

  if (!result.headerOk) {
    result.errors.push('missing SQLite header');
    return result;
  }

  let db = null;
  try {
    db = new SQL.Database(fs.readFileSync(filePath));
    const integrity = queryScalar(db, 'PRAGMA integrity_check');
    result.integrityResult = integrity;
    result.integrityOk = integrity === 'ok';
    if (!result.integrityOk) {
      result.errors.push(`integrity_check returned ${integrity}`);
    }

    for (const table of requiredTables) {
      result.requiredTables[table] = tableExists(db, table);
      if (!result.requiredTables[table]) {
        result.errors.push(`missing table ${table}`);
      }
    }
    for (const table of countTables) {
      result.counts[table] = countTable(db, table);
    }
  } catch (err) {
    result.errors.push(err.message);
  } finally {
    if (db) db.close();
  }

  return result;
}

function snapshotDirForType(backupDir, type) {
  return type === 'manual' ? backupDir : path.join(backupDir, type);
}

function listSelectedSnapshots(config) {
  const selected = [];
  const missingTypes = [];
  const noCompleteTypes = [];
  const skippedIncompleteSnapshots = [];

  for (const type of config.types) {
    const dir = snapshotDirForType(config.backupDir, type);
    const snapshots = backup.listSnapshotsInDir(dir, type === 'manual' ? 'manual' : null);
    if (snapshots.length === 0) {
      missingTypes.push(type);
      continue;
    }

    let selectedForType = 0;
    for (const snapshot of snapshots) {
      const candidate = { ...snapshot, dir };
      const files = resolveSnapshotFiles(candidate);
      const missingFiles = [];

      if (type === LEDGER_ARCHIVE_TYPE) {
        if (!files.ledgerArchive) missingFiles.push('player-ledger-archive backup file');
      } else {
        if (!files.main) missingFiles.push('word-tycoon backup file');
        if (config.requireLedgerMirror && !files.ledgerMirror) {
          missingFiles.push('player-ledger mirror backup file');
        }
      }

      if (missingFiles.length > 0) {
        skippedIncompleteSnapshots.push({
          key: snapshot.key,
          type,
          timestamp: snapshot.timestamp,
          missingFiles
        });
        continue;
      }

      selected.push(candidate);
      selectedForType += 1;
      if (selectedForType >= config.snapshotsPerType) break;
    }

    if (selectedForType === 0) {
      noCompleteTypes.push(type);
    }
  }

  return { selected, missingTypes, noCompleteTypes, skippedIncompleteSnapshots };
}

function resolveSnapshotFiles(snapshot) {
  const files = snapshot.files.map((file) => ({
    ...file,
    path: path.join(snapshot.dir, file.name)
  }));
  return {
    main: files.find((file) => MAIN_DB_KINDS.has(file.dbKind)) || null,
    ledgerMirror: files.find((file) => file.dbKind === 'player-ledger') || null,
    ledgerArchive: files.find((file) => file.dbKind === 'player-ledger-archive') || null
  };
}

function evaluateSnapshot(snapshot, inspected, config) {
  const errors = [];
  const warnings = [];
  const main = inspected.main;
  const ledgerMirror = inspected.ledgerMirror;
  const ledgerArchive = inspected.ledgerArchive;

  if (snapshot.type === LEDGER_ARCHIVE_TYPE) {
    if (!ledgerArchive) {
      errors.push('missing player-ledger-archive backup file');
    } else {
      errors.push(...ledgerArchive.errors.map((error) => `ledgerArchive: ${error}`));
      const archiveRows = ledgerArchive.counts.player_ledger ?? 0;
      if (archiveRows < config.minLedgerArchiveRows) {
        errors.push(`ledgerArchive: player_ledger rows ${archiveRows} < ${config.minLedgerArchiveRows}`);
      }
    }

    return {
      key: snapshot.key,
      type: snapshot.type,
      timestamp: snapshot.timestamp,
      totalSizeMB: snapshot.totalSizeMB,
      ok: errors.length === 0,
      errors,
      warnings,
      main,
      ledgerMirror,
      ledgerArchive
    };
  }

  if (!main) {
    errors.push('missing word-tycoon backup file');
  } else {
    errors.push(...main.errors.map((error) => `main: ${error}`));
    const playerCount = main.counts.players ?? 0;
    const mainLedgerRows = main.counts.player_ledger ?? 0;
    if (playerCount < config.minPlayers) {
      errors.push(`main: players ${playerCount} < ${config.minPlayers}`);
    }
    if (mainLedgerRows < config.minMainLedgerRows) {
      errors.push(`main: player_ledger rows ${mainLedgerRows} < ${config.minMainLedgerRows}`);
    }
  }

  if (!ledgerMirror) {
    const message = 'missing player-ledger mirror backup file';
    if (config.requireLedgerMirror) errors.push(message);
    else warnings.push(message);
  } else {
    errors.push(...ledgerMirror.errors.map((error) => `ledgerMirror: ${error}`));
    const mirrorRows = ledgerMirror.counts.player_ledger ?? 0;
    if (mirrorRows < config.minLedgerMirrorRows) {
      errors.push(`ledgerMirror: player_ledger rows ${mirrorRows} < ${config.minLedgerMirrorRows}`);
    }
  }

  return {
    key: snapshot.key,
    type: snapshot.type,
    timestamp: snapshot.timestamp,
    totalSizeMB: snapshot.totalSizeMB,
    ok: errors.length === 0,
    errors,
    warnings,
    main,
    ledgerMirror,
    ledgerArchive
  };
}

async function run(config) {
  const SQL = await initSqlJs();
  const {
    selected,
    missingTypes,
    noCompleteTypes,
    skippedIncompleteSnapshots
  } = listSelectedSnapshots(config);
  const snapshots = [];

  for (const snapshot of selected) {
    const files = resolveSnapshotFiles(snapshot);
    const inspected = {
      main: files.main
        ? inspectDatabase(SQL, files.main.path, MAIN_REQUIRED_TABLES, [
          'players',
          'player_ledger',
          'linked_accounts',
          'player_businesses',
          'player_cosmetics',
          'daily_completions'
        ])
        : null,
      ledgerMirror: files.ledgerMirror
        ? inspectDatabase(SQL, files.ledgerMirror.path, LEDGER_REQUIRED_TABLES, ['player_ledger'])
        : null,
      ledgerArchive: files.ledgerArchive
        ? inspectDatabase(SQL, files.ledgerArchive.path, LEDGER_ARCHIVE_REQUIRED_TABLES, ['player_ledger'])
        : null
    };
    snapshots.push(evaluateSnapshot(snapshot, inspected, config));
  }

  const errors = [];
  if (selected.length === 0) errors.push('no backup snapshots selected');
  for (const type of missingTypes) {
    errors.push(`no snapshots found for type ${type}`);
  }
  for (const type of noCompleteTypes) {
    const details = skippedIncompleteSnapshots
      .filter((snapshot) => snapshot.type === type)
      .map((snapshot) => `${snapshot.key}: missing ${snapshot.missingFiles.join(', ')}`)
      .join('; ');
    errors.push(`no complete snapshots found for type ${type}${details ? ` (${details})` : ''}`);
  }
  for (const snapshot of snapshots) {
    errors.push(...snapshot.errors.map((error) => `${snapshot.key}: ${error}`));
  }

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    backupDir: config.backupDir,
    types: config.types,
    snapshotsPerType: config.snapshotsPerType,
    selectedCount: selected.length,
    missingTypes,
    noCompleteTypes,
    skippedIncompleteSnapshots,
    errors,
    snapshots
  };
}

function printHuman(report) {
  console.log(`Restore drill: ${report.ok ? 'OK' : 'FAILED'}`);
  console.log(`Backup dir: ${report.backupDir}`);
  console.log(`Snapshots checked: ${report.selectedCount}`);
  if (report.missingTypes.length) {
    console.log(`Missing types: ${report.missingTypes.join(', ')}`);
  }
  for (const snapshot of report.skippedIncompleteSnapshots) {
    console.log(`Skipped incomplete ${snapshot.key}: missing ${snapshot.missingFiles.join(', ')}`);
  }
  for (const snapshot of report.snapshots) {
    const main = snapshot.main;
    const mirror = snapshot.ledgerMirror;
    const archive = snapshot.ledgerArchive;
    const mainCounts = main?.counts || {};
    const mirrorCounts = mirror?.counts || {};
    const archiveCounts = archive?.counts || {};
    console.log(`- ${snapshot.key}: ${snapshot.ok ? 'ok' : 'failed'} (${snapshot.totalSizeMB} MB)`);
    if (main) {
      console.log(`  main: integrity=${main.integrityResult} players=${mainCounts.players ?? 'n/a'} hotLedger=${mainCounts.player_ledger ?? 'n/a'} linked=${mainCounts.linked_accounts ?? 'n/a'}`);
    }
    if (mirror) {
      console.log(`  mirror: integrity=${mirror.integrityResult} rows=${mirrorCounts.player_ledger ?? 'n/a'}`);
    }
    if (archive) {
      console.log(`  archive: integrity=${archive.integrityResult} rows=${archiveCounts.player_ledger ?? 'n/a'}`);
    }
    for (const warning of snapshot.warnings) console.log(`  warning: ${warning}`);
    for (const error of snapshot.errors) console.log(`  error: ${error}`);
  }
  if (report.errors.length) {
    console.log('Errors:');
    for (const error of report.errors) console.log(`- ${error}`);
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const report = await run(config);
  if (config.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { run, parseArgs };
