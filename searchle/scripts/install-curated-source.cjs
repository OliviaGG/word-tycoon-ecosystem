#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const HASH = /^[a-f0-9]{64}$/;
const runtime = new Set(['server/game-manager.js', 'server/sp-manager.js', 'server/session-manager.js', 'server/curated-targets.js']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const bytes = data => Buffer.from(JSON.stringify(data, null, 2) + '\n');
function safePath(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Refusing a symlink path');
    if (path.dirname(current) === current) return;
  }
}
function regular(file) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Expected regular source file'); return stat; }
function directory(dir) { safePath(dir); const stat = fs.lstatSync(dir); if (!stat.isDirectory()) throw Error('Expected plain directory'); }
function currentHash(file) { if (!fs.existsSync(file)) return null; safePath(file); regular(file); return hashFile(file); }
function allowedTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('/opt/searchle/') || target.includes('\\')) return false;
  const relative = target.slice('/opt/searchle/'.length);
  if (relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) return false;
  return runtime.has(relative) || relative === '.gitattributes' || /^(scripts|test|docs|curation)\/[a-zA-Z0-9_.\/-]+$/.test(relative);
}
function writeExclusive(file, content, mode = 0o644) {
  const fd = fs.openSync(file, 'wx', mode);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDir(dir) { if (process.platform !== 'win32') { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } }
function replace(file, content, mode = 0o644) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { writeExclusive(temp, content, mode); fs.renameSync(temp, file); syncDir(path.dirname(file)); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function journalWrite(file, data) { replace(file, bytes(data), 0o600); }

function preflight({ stage, manifest, allowTarget = allowedTarget, isRuntime = target => runtime.has(target.slice('/opt/searchle/'.length)) }) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Invalid source manifest');
  const seen = new Set(), plans = [], skipped = [];
  for (const entry of manifest.files) {
    if (!entry || !allowTarget(entry.target) || seen.has(entry.target) || !(entry.beforeSha256 === null || HASH.test(entry.beforeSha256)) || !HASH.test(entry.afterSha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw Error('Unsafe or duplicate source destination');
    seen.add(entry.target);
    if (typeof entry.source !== 'string' || path.isAbsolute(entry.source) || entry.source.includes('\\') || entry.source.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw Error('Unsafe staged source');
    const source = path.resolve(stage, entry.source);
    if (!source.startsWith(path.resolve(stage) + path.sep)) throw Error('Staged source escapes release directory');
    safePath(source); const sourceStat = regular(source);
    if (sourceStat.size !== entry.bytes || hashFile(source) !== entry.afterSha256) throw Error('Uploaded source checksum mismatch');
    safePath(entry.target);
    const before = currentHash(entry.target);
    if (before === entry.afterSha256) { skipped.push(entry.target); continue; }
    if (before !== entry.beforeSha256) throw Error(`Canonical source changed: ${entry.target}`);
    plans.push({ ...entry, source, runtime: isRuntime(entry.target), mode: before === null ? 0o644 : fs.statSync(entry.target).mode & 0o777 });
  }
  return { plans, skipped, requiresStop: plans.some(entry => entry.runtime) };
}

function rollback({ stage, journal, assertStopped }) {
  if (journal.requiresStop) assertStopped();
  const errors = [];
  for (const record of [...journal.files].reverse()) {
    try {
      const hash = currentHash(record.target);
      if (hash === record.beforeSha256) continue;
      if (hash !== record.afterSha256) throw Error('Source changed outside this transaction');
      if (record.beforeSha256 === null) {
        const identity = fs.statSync(record.target);
        if (identity.dev !== record.device || identity.ino !== record.inode) throw Error('New filename belongs to another writer');
        fs.unlinkSync(record.target); syncDir(path.dirname(record.target));
      } else {
        if (currentHash(record.backup) !== record.beforeSha256) throw Error('Source rollback backup mismatch');
        replace(record.target, fs.readFileSync(record.backup), record.mode);
      }
    } catch (error) { errors.push({ target: record.target, error: error.message }); }
  }
  journal.status = errors.length ? 'rollback-incomplete' : 'rolled-back'; journal.rollbackErrors = errors;
  journalWrite(path.join(stage, 'source-installation-journal.json'), journal);
  if (errors.length) throw Error('Source rollback incomplete; retain stopped process and inspect journal');
}

function installSources(options) {
  const { stage, manifest, backups, installing = false, assertStopped, hooks = {} } = options;
  directory(stage);
  const lock = path.join(stage, '.source-installation-lock');
  if (fs.existsSync(lock)) throw Error('Unfinished or concurrent source installation');
  fs.mkdirSync(lock);
  let journal = null;
  try {
    const flight = preflight(options);
    const report = { installing, changed: flight.plans.map(entry => entry.target), unchanged: flight.skipped, requiresStop: flight.requiresStop };
    if (!installing || !flight.plans.length) return report;
    if (flight.requiresStop) { if (typeof assertStopped !== 'function') throw Error('Stopped-process guard required'); assertStopped(); }
    safePath(backups); if (!fs.existsSync(backups)) fs.mkdirSync(backups, { recursive: true }); directory(backups);
    const backupDir = path.join(backups, `subtextle-source-${Date.now()}-${crypto.randomUUID()}`); fs.mkdirSync(backupDir);
    const records = flight.plans.map((entry, index) => {
      const backup = entry.beforeSha256 === null ? null : path.join(backupDir, `source-${index}.bak`);
      if (backup !== null) writeExclusive(backup, fs.readFileSync(entry.target), entry.mode);
      return { target: entry.target, beforeSha256: entry.beforeSha256, afterSha256: entry.afterSha256, backup, mode: entry.mode, runtime: entry.runtime };
    });
    syncDir(backupDir);
    journal = { version: 1, status: 'installing', createdAt: new Date().toISOString(), backupDir, requiresStop: flight.requiresStop, files: records };
    const journalFile = path.join(stage, 'source-installation-journal.json'); journalWrite(journalFile, journal);
    hooks.afterJournal?.();
    for (const [index, entry] of flight.plans.entries()) {
      if (flight.requiresStop) assertStopped();
      if (currentHash(entry.target) !== entry.beforeSha256) throw Error('Source changed after preflight');
      if (hashFile(entry.source) !== entry.afterSha256) throw Error('Staged source changed after preflight');
      safePath(path.dirname(entry.target)); fs.mkdirSync(path.dirname(entry.target), { recursive: true }); directory(path.dirname(entry.target));
      const record = journal.files[index];
      if (entry.beforeSha256 === null) {
        const temp = `${entry.target}.${crypto.randomUUID()}.tmp`;
        try {
          writeExclusive(temp, fs.readFileSync(entry.source), entry.mode);
          const identity = fs.statSync(temp); record.device = identity.dev; record.inode = identity.ino;
          journalWrite(journalFile, journal);
          fs.linkSync(temp, entry.target); fs.unlinkSync(temp); syncDir(path.dirname(entry.target));
        } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      } else replace(entry.target, fs.readFileSync(entry.source), entry.mode);
      hooks.afterFile?.(entry.target);
    }
    if (flight.requiresStop) assertStopped();
    for (const entry of flight.plans) if (currentHash(entry.target) !== entry.afterSha256) throw Error('Installed source verification failed');
    journal.status = 'committed'; journal.completedAt = new Date().toISOString(); journalWrite(journalFile, journal);
    return { ...report, backupDir };
  } catch (error) {
    if (journal && journal.status !== 'committed') {
      try { rollback({ stage, journal, assertStopped }); } catch (failure) { error.message += `; ${failure.message}`; }
    }
    throw error;
  } finally { if (!journal || ['committed', 'rolled-back'].includes(journal.status)) fs.rmdirSync(lock); }
}

function assertStopped() {
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error('Cannot confirm stopped service');
  let list; try { list = JSON.parse(result.stdout); } catch { throw Error('Invalid stopped-service response'); }
  const matching = list.filter(entry => entry.name === 'searchle-mobile');
  if (matching.length !== 1 || matching[0].pm2_env?.status !== 'stopped' || Number(matching[0].pid) !== 0) throw Error('searchle-mobile must be stopped for runtime source installation');
}
function validateJournal(journal) {
  if (journal?.version !== 1 || !['installing', 'committed', 'rollback-incomplete'].includes(journal.status) || !/^\/opt\/_deploy-backups\/subtextle-source-\d+-[a-f0-9-]+$/.test(journal.backupDir) || !Array.isArray(journal.files) || !journal.files.length || new Set(journal.files.map(entry => entry.target)).size !== journal.files.length) throw Error('Unsafe source rollback journal');
  for (const record of journal.files) {
    if (!allowedTarget(record.target) || !HASH.test(record.afterSha256) || !(record.beforeSha256 === null ? record.backup === null : HASH.test(record.beforeSha256) && path.dirname(record.backup || '') === journal.backupDir && /^source-\d+\.bak$/.test(path.basename(record.backup))) || !Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o777 || record.runtime !== runtime.has(record.target.slice('/opt/searchle/'.length))) throw Error('Unsafe source rollback entry');
    if (journal.status === 'committed' && record.beforeSha256 === null && (!Number.isFinite(record.device) || !Number.isFinite(record.inode))) throw Error('Committed source addition lacks ownership evidence');
  }
  if (journal.requiresStop !== journal.files.some(entry => entry.runtime)) throw Error('Invalid source rollback stopped guard');
}
function main() {
  const args = process.argv.slice(2), stages = args.filter(arg => arg.startsWith('--stage='));
  if (stages.length !== 1 || args.some(arg => !arg.startsWith('--stage=') && !['--dry-run', '--install', '--rollback'].includes(arg)) || args.filter(arg => ['--dry-run', '--install', '--rollback'].includes(arg)).length > 1) throw Error('Use --stage=/tmp/subtextle-online-expansion-... [--dry-run | --install | --rollback]');
  const stage = path.resolve(stages[0].slice(8));
  if (process.platform === 'win32' || !/^\/tmp\/subtextle-online-expansion-[a-z0-9-]+$/.test(stage)) throw Error('Source installer requires uploaded /tmp release');
  directory(stage);
  if (args.includes('--rollback')) {
    const journalFile = path.join(stage, 'source-installation-journal.json'); safePath(journalFile); regular(journalFile);
    const journal = json(journalFile); validateJournal(journal); rollback({ stage, journal, assertStopped });
    const lock = path.join(stage, '.source-installation-lock'); if (fs.existsSync(lock)) fs.rmdirSync(lock);
    console.log(JSON.stringify({ status: journal.status })); return;
  }
  const manifestFile = path.join(stage, 'source-manifest.json'); safePath(manifestFile); regular(manifestFile);
  const report = installSources({ stage, manifest: json(manifestFile), backups: '/opt/_deploy-backups', installing: args.includes('--install'), assertStopped });
  replace(path.join(stage, args.includes('--install') ? 'source-installation-report.json' : 'source-dry-run-report.json'), bytes(report), 0o600);
  console.log(JSON.stringify(report));
}
module.exports = { installSources, preflight, rollback, allowedTarget, hashFile, validateJournal };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
