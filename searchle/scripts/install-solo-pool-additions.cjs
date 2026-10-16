#!/usr/bin/env node
'use strict';
// Install locally generated SCP artifacts additively. Default is a dry run.
// This does not generate rankings or write an index on the production host.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const staging = path.resolve(process.argv[2] || '');
const target = '/opt/searchle/data/sp-pool';
if (process.platform === 'win32' || !staging.startsWith('/tmp/subtextle-content-expansion-')) throw Error('Expected an uploaded /tmp expansion directory');
const installing = process.argv.includes('--install');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const manifest = json(path.join(staging, 'addition-manifest.json'));
const snapshotFile = path.join(staging, 'production-snapshot.json');
if (hash(snapshotFile) !== manifest.sourceSnapshotSha256) throw Error('Snapshot manifest mismatch');
const snapshot = json(snapshotFile);
const indexFile = '/opt/searchle/data/sp-pool-index.json';
const indexBefore = hash(indexFile);
const index = json(indexFile);
for (const [relative, expected] of Object.entries(snapshot.files)) {
  const file = relative.startsWith('relay/') ? path.join('/opt/chat-relay', relative.slice(6)) : path.join('/opt/searchle', relative);
  if (hash(file) !== expected) throw Error(`Canonical input changed: ${relative}`);
}
if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw Error('Unsafe destination');
const names = new Set(), words = new Set();
for (const addition of manifest.additions) {
  if (!/^[a-z]{4,}$/.test(addition.word) || !/^pool_\d+_[a-z]{4,}\.json$/.test(addition.filename) || !addition.filename.endsWith(`_${addition.word}.json`)) throw Error('Unsafe addition filename');
  if (names.has(addition.filename) || words.has(addition.word)) throw Error('Duplicate addition');
  names.add(addition.filename); words.add(addition.word);
  if (!addition.historicalNumber || index.words[addition.word] !== addition.historicalNumber) throw Error(`Historical number changed: ${addition.word}`);
  const file = path.join(staging, 'sp-pool', addition.filename);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== addition.bytes || hash(file) !== addition.sha256) throw Error(`Uploaded payload mismatch: ${addition.word}`);
  const payload = json(file);
  if (payload.targetWord !== addition.word || payload.rankings?.[addition.word] !== 1 ||
      Object.keys(payload.rankings).length !== addition.rankedWords || payload.totalRankedWords !== addition.rankedWords) throw Error(`Invalid answer/full rankings: ${addition.word}`);
}
const report = { installing, before: fs.readdirSync(target).filter(f => /^pool_\d+_.+\.json$/.test(f)).length, installed: [], skipped: [], failures: [] };
for (const addition of manifest.additions) {
  // Recheck current files to avoid a duplicate if live MP adds a target during installation.
  const already = fs.readdirSync(target).find(file => file.endsWith(`_${addition.word}.json`));
  if (already) { report.skipped.push({ word: addition.word, existing: already }); continue; }
  if (!installing) continue;
  const destination = path.join(target, addition.filename);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(path.join(staging, 'sp-pool', addition.filename), temporary, fs.constants.COPYFILE_EXCL);
    fs.linkSync(temporary, destination); // Atomic, fails if any final filename exists.
    report.installed.push(addition.filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  fs.writeFileSync(path.join(staging, 'installation-progress.json'), JSON.stringify(report));
}
report.after = fs.readdirSync(target).filter(f => /^pool_\d+_.+\.json$/.test(f)).length;
report.indexUnchanged = hash(indexFile) === indexBefore;
// Live multiplayer may append unrelated entries; the installer itself never writes it.
const finalIndex = json(indexFile);
report.originalNumbersPreserved = manifest.additions.every(a => finalIndex.words[a.word] === a.historicalNumber);
report.restartRequired = false;
fs.writeFileSync(path.join(staging, installing ? 'installation-report.json' : 'dry-run-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ installing, before: report.before, after: report.after, installed: report.installed.length, skipped: report.skipped.length,
  indexUnchanged: report.indexUnchanged, originalNumbersPreserved: report.originalNumbersPreserved, restartRequired: false }));
