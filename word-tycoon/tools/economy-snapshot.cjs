'use strict';
// Offline cohort backup/restore. Dry run is the default; never opens a live DB for writing.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const FILES = ['word-tycoon.db', 'player-ledger.db', 'player-ledger-archive.db'];
async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const dir = await fsp.open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
const sha = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
function inside(root, candidate) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function ensureStopped(project, processes) {
  const rows = processes || JSON.parse(execFileSync('pm2', ['jlist'], { maxBuffer: 8388608 }));
  const matching = rows.filter(p => p.name === 'mobile-tycoon' && p.pm2_env?.pm_cwd === project);
  if (matching.length !== 1 || matching[0].pid > 0 || matching[0].pm2_env.status !== 'stopped')
    throw Error('Stop mobile-tycoon before taking or applying an offline cohort');
}
function checkDatabase(file, role = path.basename(file)) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare('PRAGMA quick_check').all().some(row => Object.values(row)[0] !== 'ok')) throw Error('Invalid database');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    if (!tables.includes('player_ledger') || (role === 'word-tycoon.db' && !tables.includes('players')))
      throw Error('Wrong database role');
    return true;
  } finally { db?.close(); }
}
async function snapshot({ project = '/opt/word-tycoon', checkStopped = () => ensureStopped(project), now = Date.now } = {}) {
  const data = path.join(project, 'data'), root = path.join(data, 'backups', 'cohorts');
  checkStopped();
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const name = 'cohort-' + now() + '-' + crypto.randomBytes(4).toString('hex'), directory = path.join(root, name);
  await fsp.mkdir(directory, { mode: 0o700 });
  const manifest = { version: 1, capturedAt: now(), offline: true, files: {} };
  for (const name of FILES) {
    const source = path.join(data, name), destination = path.join(directory, name);
    if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw Error('Invalid database source');
    for (const suffix of ['-wal', '-shm', '-journal']) if (fs.existsSync(source + suffix)) throw Error('Database sidecar requires recovery before snapshot');
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(destination, 0o600);
    const file = await fsp.open(destination, 'r+'); try { await file.sync(); } finally { await file.close(); }
    manifest.files[name] = { bytes: (await fsp.stat(destination)).size, sha256: await sha(destination) };
  }
  checkStopped();
  const file = await fsp.open(path.join(directory, 'manifest.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(manifest)); await file.sync(); } finally { await file.close(); }
  await syncDirectory(directory);
  await syncDirectory(root);
  return { ok: true, cohort: name, capturedAt: manifest.capturedAt, files: FILES.length };
}
async function validate({ project = '/opt/word-tycoon', cohort }) {
  const root = path.join(project, 'data', 'backups', 'cohorts');
  if (typeof cohort !== 'string' || !/^cohort-\d+-[a-f0-9]{8}$/.test(cohort)) throw Error('Invalid cohort name');
  const directory = path.join(root, cohort);
  if (!inside(root, directory)) throw Error('Cohort outside backup directory');
  const file = path.join(directory, 'manifest.json');
  if (!inside(directory, file) || fs.statSync(file).size > 8192) throw Error('Invalid manifest');
  const manifest = JSON.parse(await fsp.readFile(file, 'utf8'));
  if (manifest.version !== 1 || manifest.offline !== true || !Number.isFinite(manifest.capturedAt) ||
      Object.keys(manifest.files || {}).sort().join() !== [...FILES].sort().join()) throw Error('Invalid manifest');
  for (const name of FILES) {
    const file = path.join(directory, name), record = manifest.files[name];
    if (!inside(directory, file) || fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile() ||
        fs.statSync(file).size !== record.bytes || await sha(file) !== record.sha256) throw Error('Cohort integrity failure');
    checkDatabase(file);
  }
  return { ok: true, cohort, capturedAt: manifest.capturedAt, files: FILES.length, validated: true, integrity: manifest.files };
}
async function restore({ project = '/opt/word-tycoon', cohort, apply = false,
    checkStopped = () => ensureStopped(project) }) {
  const verified = await validate({ project, cohort });
  if (!apply) return { ...verified, applied: false };
  checkStopped();
  // Save all three old files before replacing any one. Service stays stopped on failure.
  const source = path.join(project, 'data', 'backups', 'cohorts', cohort), data = path.join(project, 'data');
  const intentFile = path.join(data, 'economy-restore-in-progress.json');
  let intent;
  if (fs.existsSync(intentFile)) {
    if (fs.statSync(intentFile).size > 8192) throw Error('Invalid interrupted restore');
    intent = JSON.parse(await fsp.readFile(intentFile, 'utf8'));
    if (intent.version !== 1 || intent.cohort !== cohort || !/^cohort-\d+-[a-f0-9]{8}$/.test(intent.before))
      throw Error('Interrupted restore requires its original cohort');
    await validate({ project, cohort: intent.before });
  } else {
    const before = await snapshot({ project, checkStopped });
    intent = { version: 1, cohort, before: before.cohort };
  }
  const staged = [];
  for (const name of FILES) {
    const target = path.join(data, name);
    if (!inside(data, target) || fs.lstatSync(target).isSymbolicLink()) throw Error('Invalid restore target');
    const tmp = target + '.restore-' + crypto.randomBytes(4).toString('hex');
    await fsp.copyFile(path.join(source, name), tmp, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(tmp, 0o600);
    if (await sha(tmp) !== verified.integrity[name].sha256) throw Error('Restore source changed while staging');
    checkDatabase(tmp, name);
    const fd = await fsp.open(tmp, 'r+'); try { await fd.sync(); } finally { await fd.close(); }
    staged.push([tmp, target]);
  }
  checkStopped();
  if (!fs.existsSync(intentFile)) {
    const file = await fsp.open(intentFile, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(intent)); await file.sync(); } finally { await file.close(); }
    await syncDirectory(data);
  }
  for (const [tmp, target] of staged) await fsp.rename(tmp, target);
  await syncDirectory(data);
  await fsp.unlink(intentFile); await syncDirectory(data);
  return { ...verified, applied: true, before: intent.before, restartRequired: true };
}
module.exports = { FILES, inside, ensureStopped, checkDatabase, snapshot, validate, restore };
if (require.main === module) {
  const [command, cohort, ...flags] = process.argv.slice(2);
  const validFlags = flags.length === 0 || (flags.length === 1 && flags[0] === '--apply');
  const task = command === 'snapshot' && !cohort && !flags.length ? snapshot() : command === 'restore' && validFlags
    ? restore({ cohort, apply: flags.length === 1 && flags[0] === '--apply' })
    : Promise.reject(Error('Use snapshot or restore COHORT [--apply]'));
  task.then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Offline cohort operation failed. Keep the service stopped, review integrity/status and retry.'); process.exitCode = 1;
  });
}
