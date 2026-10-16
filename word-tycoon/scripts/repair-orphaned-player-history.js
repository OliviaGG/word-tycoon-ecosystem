#!/usr/bin/env node
/**
 * Repair historical orphaned player-scoped rows by replaying known merge targets from logs.
 *
 * Safe by default:
 * - dry-run unless --apply is passed
 * - only repairs rows whose orphaned player_id can be resolved to an existing survivor player
 * - leaves unmapped orphan rows untouched and reports them
 *
 * Usage:
 *   node scripts/repair-orphaned-player-history.js --log /opt/word-tycoon/logs/output.log
 *   node scripts/repair-orphaned-player-history.js --db /opt/word-tycoon/data/word-tycoon.db --log /opt/word-tycoon/logs/output.log --apply
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'word-tycoon.db');
const DEFAULT_LOG_PATH = path.join(__dirname, '..', 'logs', 'output.log');
const TABLES = [
  { name: 'player_ledger', mode: 'reassign', key: 'id' },
  { name: 'game_wins', mode: 'reassign', key: 'id' },
  { name: 'daily_completions', mode: 'daily', key: 'id' },
  { name: 'weekly_completions', mode: 'weekly', key: 'id' },
  { name: 'generated_cosmetics', mode: 'generated', key: 'id' }
];

function parseArgs(argv) {
  const args = {
    dbPath: DEFAULT_DB_PATH,
    logPath: DEFAULT_LOG_PATH,
    apply: false,
    reportPath: null,
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
    if (arg === '--log') {
      args.logPath = argv[++i];
      continue;
    }
    if (arg === '--report') {
      args.reportPath = argv[++i];
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
  node scripts/repair-orphaned-player-history.js [--db path] [--log path] [--report path] [--apply] [--backup path]

Options:
  --db      SQLite database path (default: ${DEFAULT_DB_PATH})
  --log     Merge log file or directory (default: ${DEFAULT_LOG_PATH})
  --report  Optional JSON report output path
  --apply   Perform writes; without this flag the script is dry-run only
  --backup  Optional backup path; defaults to "<db>.bak-orphan-repair-<timestamp>" when applying`);
  process.exit(exitCode);
}

function ensurePathExists(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function listLogFiles(logPath) {
  ensurePathExists(logPath, 'Log path');
  const stat = fs.statSync(logPath);
  if (stat.isDirectory()) {
    return fs.readdirSync(logPath)
      .filter(name => name.toLowerCase().endsWith('.log'))
      .map(name => path.join(logPath, name))
      .sort();
  }
  return [logPath];
}

function loadMergeMappings(logFiles) {
  const direct = new Map();
  const regex = /Merged player .*?\(id\s+(\d+)\)\s+into .*?\(id\s+(\d+)\)/g;

  for (const file of logFiles) {
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const removeId = Number(match[1]);
      const keepId = Number(match[2]);
      if (Number.isFinite(removeId) && Number.isFinite(keepId) && removeId !== keepId) {
        direct.set(removeId, keepId);
      }
    }
  }

  return direct;
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

  function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows[0] || null;
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  return { queryAll, queryOne, run };
}

function pickEarlierTimestamp(currentValue, incomingValue) {
  if (!currentValue) return incomingValue;
  if (!incomingValue) return currentValue;
  return incomingValue < currentValue ? incomingValue : currentValue;
}

function buildResolver(directMap, existingPlayers) {
  const cache = new Map();

  return function resolveFinalTarget(orphanId) {
    if (cache.has(orphanId)) return cache.get(orphanId);

    let current = Number(orphanId);
    const seen = new Set();

    while (directMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = directMap.get(current);
    }

    const resolved = existingPlayers.has(current) && current !== Number(orphanId) ? current : null;
    cache.set(orphanId, resolved);
    return resolved;
  };
}

function createTableSummary(name) {
  return {
    table: name,
    orphanRows: 0,
    orphanPlayerIds: 0,
    mappedRows: 0,
    unmappedRows: 0,
    updatedRows: 0,
    deletedRows: 0,
    mergedRows: 0,
    unmappedPlayerIds: []
  };
}

function repairDailyLike({ mode, helpers, rows, resolveTarget, apply, summary }) {
  const { queryOne, run } = helpers;
  const unmapped = new Set();

  for (const row of rows) {
    summary.orphanRows++;
    const targetId = resolveTarget(row.player_id);
    if (!targetId) {
      summary.unmappedRows++;
      unmapped.add(Number(row.player_id));
      continue;
    }

    summary.mappedRows++;

    if (mode === 'daily') {
      const existing = queryOne(
        'SELECT * FROM daily_completions WHERE player_id = ? AND game = ? AND date = ?',
        [targetId, row.game, row.date]
      );
      if (existing) {
        summary.mergedRows++;
        if (apply) {
          run(
            'UPDATE daily_completions SET coins_awarded = ?, completed_at = ? WHERE id = ?',
            [
              Math.max(Number(existing.coins_awarded) || 0, Number(row.coins_awarded) || 0),
              pickEarlierTimestamp(existing.completed_at, row.completed_at),
              existing.id
            ]
          );
          run('DELETE FROM daily_completions WHERE id = ?', [row.id]);
          summary.updatedRows++;
          summary.deletedRows++;
        }
      } else if (apply) {
        run('UPDATE daily_completions SET player_id = ? WHERE id = ?', [targetId, row.id]);
        summary.updatedRows++;
      }
      continue;
    }

    if (mode === 'weekly') {
      const existing = queryOne(
        'SELECT * FROM weekly_completions WHERE player_id = ? AND game = ? AND week_start = ?',
        [targetId, row.game, row.week_start]
      );
      if (existing) {
        summary.mergedRows++;
        if (apply) {
          run(
            'UPDATE weekly_completions SET coins_awarded = ?, completed_at = ? WHERE id = ?',
            [
              Math.max(Number(existing.coins_awarded) || 0, Number(row.coins_awarded) || 0),
              pickEarlierTimestamp(existing.completed_at, row.completed_at),
              existing.id
            ]
          );
          run('DELETE FROM weekly_completions WHERE id = ?', [row.id]);
          summary.updatedRows++;
          summary.deletedRows++;
        }
      } else if (apply) {
        run('UPDATE weekly_completions SET player_id = ? WHERE id = ?', [targetId, row.id]);
        summary.updatedRows++;
      }
      continue;
    }

    const existing = queryOne(
      'SELECT id FROM generated_cosmetics WHERE player_id = ? AND date_awarded = ?',
      [targetId, row.date_awarded]
    );
    if (existing) {
      summary.mergedRows++;
      if (apply) {
        run('DELETE FROM generated_cosmetics WHERE id = ?', [row.id]);
        summary.deletedRows++;
      }
    } else if (apply) {
      run('UPDATE generated_cosmetics SET player_id = ? WHERE id = ?', [targetId, row.id]);
      summary.updatedRows++;
    }
  }

  summary.orphanPlayerIds = new Set(rows.map(row => Number(row.player_id))).size;
  summary.unmappedPlayerIds = Array.from(unmapped).sort((a, b) => a - b);
}

function repairReassignTable({ table, helpers, rows, resolveTarget, apply, summary }) {
  const { run } = helpers;
  const unmapped = new Set();

  for (const row of rows) {
    summary.orphanRows++;
    const targetId = resolveTarget(row.player_id);
    if (!targetId) {
      summary.unmappedRows++;
      unmapped.add(Number(row.player_id));
      continue;
    }

    summary.mappedRows++;
    if (apply) {
      run(`UPDATE ${table.name} SET player_id = ? WHERE ${table.key} = ?`, [targetId, row[table.key]]);
      summary.updatedRows++;
    }
  }

  summary.orphanPlayerIds = new Set(rows.map(row => Number(row.player_id))).size;
  summary.unmappedPlayerIds = Array.from(unmapped).sort((a, b) => a - b);
}

function summarizeTopUnmappedIds(tableRows, unmappedIds, limit = 20) {
  const counts = new Map();
  for (const row of tableRows) {
    const playerId = Number(row.player_id);
    if (unmappedIds.includes(playerId)) {
      counts.set(playerId, (counts.get(playerId) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([playerId, rowCount]) => ({ playerId, rowCount }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensurePathExists(args.dbPath, 'Database');

  const logFiles = listLogFiles(args.logPath);
  const mergeMap = loadMergeMappings(logFiles);
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(args.dbPath));
  const helpers = makeSqlHelpers(db);

  const existingPlayers = new Set(
    helpers.queryAll('SELECT id FROM players').map(row => Number(row.id))
  );
  const resolveTarget = buildResolver(mergeMap, existingPlayers);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    dbPath: args.dbPath,
    logFiles,
    directMergeMappings: mergeMap.size,
    existingPlayers: existingPlayers.size,
    tables: []
  };

  if (args.apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = args.backupPath || `${args.dbPath}.bak-orphan-repair-${stamp}`;
    fs.copyFileSync(args.dbPath, backupPath);
    report.backupPath = backupPath;
    helpers.run('BEGIN TRANSACTION');
  }

  try {
    for (const table of TABLES) {
      const rows = helpers.queryAll(
        `SELECT * FROM ${table.name} WHERE player_id NOT IN (SELECT id FROM players) ORDER BY player_id`
      );
      const summary = createTableSummary(table.name);

      if (table.mode === 'reassign') {
        repairReassignTable({ table, helpers, rows, resolveTarget, apply: args.apply, summary });
      } else {
        repairDailyLike({ mode: table.mode, helpers, rows, resolveTarget, apply: args.apply, summary });
      }

      summary.topUnmappedPlayerIds = summarizeTopUnmappedIds(rows, summary.unmappedPlayerIds);
      report.tables.push(summary);
    }

    if (args.apply) {
      helpers.run('COMMIT');
      fs.writeFileSync(args.dbPath, Buffer.from(db.export()));
    }
  } catch (error) {
    if (args.apply) {
      try { helpers.run('ROLLBACK'); } catch (_) {}
    }
    throw error;
  }

  if (args.reportPath) {
    fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
    fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2));
  }

  console.log(`[Repair] Mode: ${report.mode}`);
  console.log(`[Repair] Direct merge mappings: ${report.directMergeMappings}`);
  for (const table of report.tables) {
    console.log(
      `[Repair] ${table.table}: orphanRows=${table.orphanRows}, mappedRows=${table.mappedRows}, ` +
      `unmappedRows=${table.unmappedRows}, updatedRows=${table.updatedRows}, deletedRows=${table.deletedRows}, mergedRows=${table.mergedRows}`
    );
    if (table.topUnmappedPlayerIds.length) {
      const preview = table.topUnmappedPlayerIds
        .slice(0, 5)
        .map(entry => `${entry.playerId}(${entry.rowCount})`)
        .join(', ');
      console.log(`  Unmapped top ids: ${preview}`);
    }
  }
  if (args.reportPath) {
    console.log(`[Repair] Report written to ${args.reportPath}`);
  }
  if (report.backupPath) {
    console.log(`[Repair] Backup written to ${report.backupPath}`);
  }
}

main().catch(error => {
  console.error(`[Repair] Failed: ${error.stack || error.message}`);
  process.exit(1);
});
