#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const backup = require('../src/backup');

const DEFAULT_DB_TYPES = ['rolling', 'hourly', 'daily', 'startup', 'pre-shutdown', backup.LEDGER_ARCHIVE_BACKUP_TYPE || 'ledger-archive'];
const DEFAULT_JSON_SNAPSHOT_COUNT = 1;

function parseArgs(argv) {
  const args = {
    sourceDir: backup.BACKUP_DIR,
    destDir: process.env.BACKUP_REPLICA_DEST || '',
    dbTypes: DEFAULT_DB_TYPES,
    jsonSnapshotCount: DEFAULT_JSON_SNAPSHOT_COUNT,
    dryRun: false,
    verify: true,
    json: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source-dir' && argv[i + 1]) {
      args.sourceDir = argv[++i];
    } else if (arg === '--dest-dir' && argv[i + 1]) {
      args.destDir = argv[++i];
    } else if (arg === '--db-types' && argv[i + 1]) {
      args.dbTypes = argv[++i].split(',').map((type) => type.trim()).filter(Boolean);
    } else if (arg === '--json-snapshots' && argv[i + 1]) {
      args.jsonSnapshotCount = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-verify') {
      args.verify = false;
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
  console.log(`Usage: node scripts/replicate-backups.js --dest-dir PATH [options]

Replicate the latest Word Tycoon recovery artifacts to another directory.
The destination can be a mounted/off-box path. No secrets are read or stored.

Options:
  --source-dir PATH       Backup root directory (default: data/backups)
  --dest-dir PATH         Destination root, or BACKUP_REPLICA_DEST env var
  --db-types LIST         Snapshot lanes to include (default: ${DEFAULT_DB_TYPES.join(',')})
  --json-snapshots N      Latest JSON snapshots to include (default: ${DEFAULT_JSON_SNAPSHOT_COUNT})
  --dry-run               Build the manifest without copying files
  --no-verify             Skip destination hash verification after copy
  --json                  Print JSON report`);
}

function formatTimestamp(date = new Date()) {
  return date.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function roundMB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toManifestRelativePath(sourceDir, sourcePath) {
  return path.relative(sourceDir, sourcePath).split(path.sep).join('/');
}

function destinationPath(replicaDir, relativePath) {
  return path.join(replicaDir, ...relativePath.split('/'));
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function statFile(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sizeBytes: stat.size,
    sizeMB: roundMB(stat.size),
    modified: stat.mtime.toISOString()
  };
}

function dbSnapshotDir(sourceDir, type) {
  return type === 'manual' ? sourceDir : path.join(sourceDir, type);
}

function selectLatestDbSnapshots(sourceDir, dbTypes) {
  const selected = [];
  const missing = [];

  for (const type of dbTypes) {
    const dir = dbSnapshotDir(sourceDir, type);
    const snapshots = backup.listSnapshotsInDir(dir, type === 'manual' ? 'manual' : null);
    const latest = snapshots[0];
    if (!latest) {
      missing.push(type);
      continue;
    }

    for (const file of latest.files) {
      const sourcePath = path.join(dir, file.name);
      selected.push({
        category: 'db',
        snapshotType: type,
        snapshotKey: latest.key,
        dbKind: file.dbKind,
        sourcePath,
        relativePath: toManifestRelativePath(sourceDir, sourcePath),
        ...statFile(sourcePath)
      });
    }
  }

  return { selected, missing };
}

function selectJsonSnapshots(sourceDir, count) {
  if (count <= 0) return [];
  const snapshotDir = path.join(sourceDir, 'snapshots');
  if (!fs.existsSync(snapshotDir)) return [];

  return fs.readdirSync(snapshotDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const sourcePath = path.join(snapshotDir, name);
      const stat = fs.statSync(sourcePath);
      return {
        name,
        sourcePath,
        modifiedMs: stat.mtimeMs,
        ...statFile(sourcePath)
      };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, count)
    .map(({ modifiedMs, ...file }) => ({
      category: 'json-snapshot',
      snapshotType: 'json',
      snapshotKey: file.name,
      dbKind: null,
      relativePath: toManifestRelativePath(sourceDir, file.sourcePath),
      ...file
    }));
}

function copyFile(sourcePath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
}

async function run(config) {
  const sourceDir = path.resolve(config.sourceDir);
  if (!fs.existsSync(sourceDir)) {
    return {
      ok: false,
      errors: [`source directory not found: ${sourceDir}`],
      warnings: [],
      files: []
    };
  }

  const destDir = path.resolve(config.destDir || '');
  if (!config.dryRun && !config.destDir) {
    return {
      ok: false,
      errors: ['missing --dest-dir or BACKUP_REPLICA_DEST'],
      warnings: [],
      files: []
    };
  }
  if (!config.dryRun && isSubpath(sourceDir, destDir)) {
    return {
      ok: false,
      errors: [`destination must not be inside source backup directory: ${destDir}`],
      warnings: [],
      files: []
    };
  }

  const generatedAt = new Date().toISOString();
  const replicaId = `word-tycoon-backups_${formatTimestamp(new Date(generatedAt))}`;
  const replicaDir = path.join(destDir, replicaId);
  const { selected: dbFiles, missing: missingDbTypes } = selectLatestDbSnapshots(sourceDir, config.dbTypes);
  const jsonFiles = selectJsonSnapshots(sourceDir, config.jsonSnapshotCount);
  const selectedFiles = [...dbFiles, ...jsonFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const errors = [];
  const warnings = [];

  if (selectedFiles.length === 0) {
    errors.push('no backup files selected');
  }
  for (const type of missingDbTypes) {
    warnings.push(`no ${type} backup snapshot found`);
  }
  if (config.jsonSnapshotCount > 0 && jsonFiles.length === 0) {
    warnings.push('no JSON snapshots found');
  }

  const files = [];
  let totalBytes = 0;
  for (const file of selectedFiles) {
    const sha256 = hashFile(file.sourcePath);
    const destPath = destinationPath(replicaDir, file.relativePath);
    totalBytes += file.sizeBytes;

    let copied = false;
    let verified = false;
    let destSha256 = null;
    if (!config.dryRun && errors.length === 0) {
      copyFile(file.sourcePath, destPath);
      copied = true;
      if (config.verify) {
        destSha256 = hashFile(destPath);
        verified = destSha256 === sha256;
        if (!verified) {
          errors.push(`verification failed for ${file.relativePath}`);
        }
      }
    }

    files.push({
      category: file.category,
      snapshotType: file.snapshotType,
      snapshotKey: file.snapshotKey,
      dbKind: file.dbKind,
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      sizeMB: file.sizeMB,
      modified: file.modified,
      sha256,
      copied,
      verified,
      destSha256
    });
  }

  const manifest = {
    version: 1,
    generatedAt,
    replicaId,
    mode: 'latest-recovery-set',
    sourceDir,
    replicaDir: config.dryRun ? null : replicaDir,
    dryRun: config.dryRun,
    verify: config.verify,
    dbTypes: config.dbTypes,
    jsonSnapshotCount: config.jsonSnapshotCount,
    missingDbTypes,
    totalBytes,
    totalSizeMB: roundMB(totalBytes),
    fileCount: files.length,
    files
  };

  if (!config.dryRun && errors.length === 0) {
    fs.mkdirSync(replicaDir, { recursive: true });
    fs.writeFileSync(path.join(replicaDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...manifest
  };
}

function printHuman(report) {
  console.log(`Backup replication: ${report.ok ? 'OK' : 'FAILED'}`);
  console.log(`Source: ${report.sourceDir || 'n/a'}`);
  console.log(`Replica: ${report.replicaDir || '(dry-run)'}`);
  console.log(`Files: ${report.fileCount || 0}`);
  console.log(`Total: ${report.totalSizeMB || 0} MB`);
  for (const warning of report.warnings || []) console.log(`warning: ${warning}`);
  for (const error of report.errors || []) console.log(`error: ${error}`);
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

module.exports = { run, parseArgs, selectLatestDbSnapshots, selectJsonSnapshots };
