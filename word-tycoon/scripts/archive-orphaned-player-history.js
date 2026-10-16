#!/usr/bin/env node
/**
 * Archive and prune remaining orphaned player-scoped history rows.
 *
 * Safe by default:
 * - dry-run unless --apply is passed
 * - exports full orphan rows to a JSON archive before deletion when applying
 * - creates a DB backup before mutating
 *
 * Usage:
 *   node scripts/archive-orphaned-player-history.js
 *   node scripts/archive-orphaned-player-history.js --db /opt/word-tycoon/data/word-tycoon.db --apply
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'word-tycoon.db');
const DEFAULT_EXPORT_DIR = path.join(__dirname, '..', 'data', 'backups');
const TABLES = [
  { name: 'player_ledger', key: 'id' },
  { name: 'game_wins', key: 'id' },
  { name: 'daily_completions', key: 'id' },
  { name: 'weekly_completions', key: 'id' },
  { name: 'generated_cosmetics', key: 'id' }
];

function parseArgs(argv) {
  const args = {
    dbPath: DEFAULT_DB_PATH,
    exportDir: DEFAULT_EXPORT_DIR,
    apply: false,
    reportPath: null,
    archivePath: null,
    backupPath: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--db') {
      args.dbPath = argv[++i];
      continue;
    }
    if (arg === '--export-dir') {
      args.exportDir = argv[++i];
      continue;
    }
    if (arg === '--report') {
      args.reportPath = argv[++i];
      continue;
    }
    if (arg === '--archive') {
      args.archivePath = argv[++i];
      continue;
    }
    if (arg === '--backup') {
      args.backupPath = argv[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printUsage(exitCode = 1) {
  console.log(`Usage:
  node scripts/archive-orphaned-player-history.js [--db path] [--export-dir dir] [--report path] [--archive path] [--apply] [--backup path]

Options:
  --db         SQLite database path (default: ${DEFAULT_DB_PATH})
  --export-dir Directory for generated report/archive files (default: ${DEFAULT_EXPORT_DIR})
  --report     Optional explicit JSON report path
  --archive    Optional explicit JSON archive path
  --apply      Perform export + prune; without this flag the script is dry-run only
  --backup     Optional DB backup path for apply mode`);
  process.exit(exitCode);
}

function ensurePathExists(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function makeSqlHelpers(db) {
  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql, params);
    const rows = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  return { queryAll, run };
}

function summarizeRows(rows) {
  const counts = new Map();
  for (const row of rows) {
    const playerId = Number(row.player_id);
    counts.set(playerId, (counts.get(playerId) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([playerId, rowCount]) => ({ playerId, rowCount }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensurePathExists(args.dbPath, 'Database');

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(args.dbPath));
  const { queryAll, run } = makeSqlHelpers(db);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const reportPath = args.reportPath || path.join(args.exportDir, `orphan-prune-report-${stamp}.json`);
  const archivePath = args.archivePath || path.join(args.exportDir, `orphan-prune-archive-${stamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    dbPath: args.dbPath,
    tables: []
  };

  const archive = {
    generatedAt: report.generatedAt,
    dbPath: args.dbPath,
    tables: {}
  };

  for (const table of TABLES) {
    const rows = queryAll(`SELECT * FROM ${table.name} WHERE player_id NOT IN (SELECT id FROM players) ORDER BY player_id, ${table.key}`);
    const orphanPlayerIds = new Set(rows.map(row => Number(row.player_id)));
    const summary = {
      table: table.name,
      orphanRows: rows.length,
      orphanPlayerIds: orphanPlayerIds.size,
      topPlayerIds: summarizeRows(rows).slice(0, 20),
      deletedRows: 0
    };

    report.tables.push(summary);
    archive.tables[table.name] = rows;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });

  if (args.apply) {
    const backupPath = args.backupPath || `${args.dbPath}.bak-orphan-prune-${stamp}`;
    fs.copyFileSync(args.dbPath, backupPath);
    report.backupPath = backupPath;
    report.archivePath = archivePath;

    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));

    run('BEGIN TRANSACTION');
    try {
      for (const table of TABLES) {
        const summary = report.tables.find(entry => entry.table === table.name);
        if (!summary || !summary.orphanRows) continue;
        run(`DELETE FROM ${table.name} WHERE player_id NOT IN (SELECT id FROM players)`);
        summary.deletedRows = summary.orphanRows;
      }
      run('COMMIT');
      fs.writeFileSync(args.dbPath, Buffer.from(db.export()));
    } catch (error) {
      try { run('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`[Archive] Mode: ${report.mode}`);
  for (const table of report.tables) {
    console.log(
      `[Archive] ${table.table}: orphanRows=${table.orphanRows}, orphanPlayerIds=${table.orphanPlayerIds}, deletedRows=${table.deletedRows}`
    );
  }
  if (report.archivePath) {
    console.log(`[Archive] Archive written to ${report.archivePath}`);
  }
  if (report.backupPath) {
    console.log(`[Archive] Backup written to ${report.backupPath}`);
  }
  console.log(`[Archive] Report written to ${reportPath}`);
}

main().catch(error => {
  console.error(`[Archive] Failed: ${error.stack || error.message}`);
  process.exit(1);
});
