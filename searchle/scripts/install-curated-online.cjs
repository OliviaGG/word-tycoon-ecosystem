#!/usr/bin/env node
'use strict';

// Transactional installer for locally authored Subtextle content. The CLI has
// fixed production destinations. Library paths exist solely for fixture tests.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const hashBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hashBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const HASH = /^[a-f0-9]{64}$/;
const WORD = /^[a-z]{4,}$/;
const POOL = /^pool_\d+_[a-z]{4,}\.json$/;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Expected a regular file: ${file}`);
  return stat;
}
function plainDirectory(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(`Unsafe directory: ${dir}`);
}
function noSymlinkAncestors(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error(`Refusing a symlink path: ${file}`);
    if (path.dirname(current) === current) return;
  }
}
function stagedFile(stage, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '..' || p === '.')) throw Error('Unsafe staging filename');
  const file = path.resolve(stage, relative);
  if (!file.startsWith(path.resolve(stage) + path.sep)) throw Error('Staging file escapes its directory');
  noSymlinkAncestors(file);
  regularFile(file);
  return file;
}
function durableWrite(file, bytes) {
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicReplace(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { durableWrite(temporary, bytes); fs.renameSync(temporary, file); syncDirectory(path.dirname(file)); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function exclusiveCreate(file, bytes, beforeLink) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    durableWrite(temporary, bytes);
    beforeLink(fs.statSync(temporary));
    fs.linkSync(temporary, file);
    fs.unlinkSync(temporary); syncDirectory(path.dirname(file));
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function writeJournal(file, data) { atomicReplace(file, jsonBytes(data)); }

function validateRankings(payload, expectedWord, minimumRankedWords = 100000) {
  if (!payload || payload.targetWord !== expectedWord || !WORD.test(expectedWord) || !payload.rankings || typeof payload.rankings !== 'object' || Array.isArray(payload.rankings)) throw Error('Invalid ranking target');
  const entries = Object.entries(payload.rankings);
  if (!Number.isSafeInteger(payload.totalRankedWords) || payload.totalRankedWords !== entries.length || entries.length < minimumRankedWords || payload.rankings[expectedWord] !== 1) throw Error(`Incomplete rankings: ${expectedWord}`);
  const seen = new Uint8Array(entries.length + 1);
  for (const [word, rank] of entries) {
    if (!word || !Number.isSafeInteger(rank) || rank < 1 || rank > entries.length || seen[rank]) throw Error(`Invalid rank permutation: ${expectedWord}`);
    seen[rank] = 1;
  }
  return entries.length;
}

function validateIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index) || !index.words || typeof index.words !== 'object' || Array.isArray(index.words) || !Number.isSafeInteger(index.nextNumber) || index.nextNumber < 1) throw Error('Invalid current pool index');
  for (const [word, number] of Object.entries(index.words)) {
    if (!/^[a-z]+$/.test(word) || !Number.isSafeInteger(number) || number < 1) throw Error('Invalid existing word number');
  }
  for (const number of index.vacantNumbers || []) if (!Number.isSafeInteger(number) || number < 1) throw Error('Invalid historical vacant number');
  if (index.weeklyNumbers && (typeof index.weeklyNumbers !== 'object' || Array.isArray(index.weeklyNumbers))) throw Error('Invalid weekly number index');
}

function mergeIndex(index, words) {
  validateIndex(index);
  const merged = structuredClone(index);
  let next = Math.max(index.nextNumber, 1, ...Object.values(index.words).map(n => n + 1), ...(index.vacantNumbers || []).map(n => n + 1));
  const assigned = [];
  for (const word of words) {
    if (Object.hasOwn(index.words, word) || Object.hasOwn(index.weeklyNumbers || {}, word)) continue;
    merged.words[word] = next++;
    assigned.push({ word, number: merged.words[word] });
  }
  // Even when a legacy index has nextNumber below a historical vacancy, never
  // allocate an earlier identity. Nothing consumes or edits vacantNumbers.
  merged.nextNumber = next;
  return { index: merged, assigned };
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.curatedWords) || !manifest.curatedWords.length || !Array.isArray(manifest.additions) || !manifest.baseline || !Array.isArray(manifest.inputs) || !manifest.inputs.length) throw Error('Invalid release manifest');
  const words = new Set();
  for (const word of manifest.curatedWords) {
    if (!WORD.test(word) || words.has(word)) throw Error('Unsafe or duplicate curated word');
    words.add(word);
  }
  if (!(manifest.baseline.curatedSha256 === null || HASH.test(manifest.baseline.curatedSha256)) || !HASH.test(manifest.baseline.indexSha256) || !Array.isArray(manifest.baseline.poolFiles)) throw Error('Missing canonical baseline');
  const oldNames = new Set();
  for (const name of manifest.baseline.poolFiles) {
    if (!POOL.test(name) || oldNames.has(name)) throw Error('Invalid baseline pool filename');
    oldNames.add(name);
  }
  const additions = new Set(), names = new Set();
  for (const addition of manifest.additions) {
    if (!words.has(addition.word) || additions.has(addition.word) || !POOL.test(addition.filename) || !addition.filename.endsWith(`_${addition.word}.json`) || names.has(addition.filename) || !HASH.test(addition.sha256) || !Number.isSafeInteger(addition.bytes) || addition.bytes < 1 || !Number.isSafeInteger(addition.rankedWords) || addition.rankedWords < 1) throw Error('Unsafe or duplicate ranking addition');
    additions.add(addition.word); names.add(addition.filename);
  }
  const targets = new Set();
  for (const input of manifest.inputs) {
    if (!input || typeof input.target !== 'string' || !path.isAbsolute(input.target) || !HASH.test(input.sha256) || targets.has(input.target)) throw Error('Invalid canonical input hash');
    targets.add(input.target);
  }
  if (!manifest.selectionEvidence || !HASH.test(manifest.selectionEvidence.sha256)) throw Error('Missing independently reviewed selection evidence');
  return words;
}

function validateEvidence(manifest, evidence) {
  if (!evidence || !Array.isArray(evidence.accepted)) throw Error('Invalid selection evidence');
  const accepted = new Map();
  for (const entry of evidence.accepted) {
    if (!entry || !WORD.test(entry.word) || accepted.has(entry.word)) throw Error('Duplicate or invalid selection evidence');
    accepted.set(entry.word, entry);
  }
  const mandatory = ['dictionary', 'model', 'morphology', 'policy', 'notPreviouslyWon', 'curated'];
  for (const word of manifest.curatedWords) {
    const entry = accepted.get(word);
    if (!entry || mandatory.some(check => entry.checks?.[check] !== true)) throw Error(`Selection criteria failed: ${word}`);
    if (!Number.isFinite(entry.zipf) || !Number.isFinite(evidence.minZipf) || entry.zipf < evidence.minZipf) throw Error(`Frequency criterion failed: ${word}`);
  }
  if (accepted.size !== manifest.curatedWords.length) throw Error('Selection evidence and release words differ');
}

function poolEntries(poolDir) {
  const entries = new Map();
  for (const name of fs.readdirSync(poolDir)) {
    if (!POOL.test(name)) continue;
    regularFile(path.join(poolDir, name));
    const word = name.replace(/^pool_\d+_/, '').slice(0, -5);
    if (!entries.has(word)) entries.set(word, []);
    entries.get(word).push(name);
  }
  return entries;
}

function preflight({ stage, manifest, paths, validateWord, minimumRankedWords = 100000 }) {
  validateManifest(manifest);
  for (const destination of [paths.pool, paths.index, paths.curated]) noSymlinkAncestors(destination);
  plainDirectory(paths.pool); regularFile(paths.index);
  const hasCurated = fs.existsSync(paths.curated);
  if (hasCurated) regularFile(paths.curated);
  for (const input of manifest.inputs) {
    regularFile(input.target);
    if (hashFile(input.target) !== input.sha256) throw Error(`Canonical input changed: ${input.target}`);
  }
  if (hasCurated ? hashFile(paths.curated) !== manifest.baseline.curatedSha256 : manifest.baseline.curatedSha256 !== null) throw Error('Supplemental curated catalog changed since capture');
  const evidenceFile = stagedFile(stage, manifest.selectionEvidence.filename);
  if (hashFile(evidenceFile) !== manifest.selectionEvidence.sha256) throw Error('Selection evidence checksum mismatch');
  validateEvidence(manifest, readJson(evidenceFile));
  if (typeof validateWord !== 'function') throw Error('Canonical live policy validator is required');
  for (const word of manifest.curatedWords) if (validateWord(word) !== true) throw Error(`Live target policy rejected: ${word}`);

  const curated = hasCurated ? readJson(paths.curated) : { version: 1, words: [] };
  if (curated.version !== 1 || !Array.isArray(curated.words) || curated.words.some(w => !WORD.test(w)) || new Set(curated.words).size !== curated.words.length) throw Error('Invalid current supplemental curated catalog');
  const oldCurated = new Set(curated.words);
  for (const word of manifest.curatedWords) if (oldCurated.has(word)) throw Error(`Word is already supplemental-curated: ${word}`);
  const currentNames = new Set(fs.readdirSync(paths.pool));
  for (const name of manifest.baseline.poolFiles) if (!currentNames.has(name)) throw Error(`Historical pool file disappeared: ${name}`);
  const existing = poolEntries(paths.pool);
  const staged = new Map();
  for (const addition of manifest.additions) {
    const file = stagedFile(stage, `sp-pool/${addition.filename}`), stat = regularFile(file);
    if (stat.size !== addition.bytes || hashFile(file) !== addition.sha256) throw Error(`Ranking payload checksum mismatch: ${addition.word}`);
    if (validateRankings(readJson(file), addition.word, minimumRankedWords) !== addition.rankedWords) throw Error(`Ranking count mismatch: ${addition.word}`);
    if (currentNames.has(addition.filename) && !existing.has(addition.word)) throw Error(`Ranking destination exists: ${addition.filename}`);
    staged.set(addition.word, { ...addition, file });
  }
  for (const word of manifest.curatedWords) if (!existing.has(word) && !staged.has(word)) throw Error(`Curated word has no solo payload: ${word}`);
  for (const word of manifest.curatedWords.filter(w => existing.has(w))) {
    // A concurrent multiplayer append is useful only if it is a valid puzzle.
    // Legacy puzzles may use an older smaller vocabulary, so keep their size.
    validateRankings(readJson(path.join(paths.pool, existing.get(word)[0])), word, 1);
  }
  const indexBytes = fs.readFileSync(paths.index), index = readJson(paths.index);
  const merged = mergeIndex(index, manifest.curatedWords);
  const installs = manifest.curatedWords.filter(word => !existing.has(word)).map(word => staged.get(word));
  return { installs, skipped: manifest.curatedWords.filter(word => existing.has(word)), indexBytes, curatedBytes: hasCurated ? fs.readFileSync(paths.curated) : null, index: merged.index, assigned: merged.assigned, curated: { ...structuredClone(curated), words: [...curated.words, ...manifest.curatedWords] }, currentNames, indexChangedSinceCapture: hashBytes(indexBytes) !== manifest.baseline.indexSha256 };
}

function rollback({ journalFile, journal, assertStopped }) {
  assertStopped();
  const errors = [];
  // A killed process may have renamed a file just before updating its journal.
  // Detect both before/after hashes, then restore only this transaction's writes.
  for (const record of [...journal.catalogs].reverse()) {
    try {
      noSymlinkAncestors(record.target);
      const current = fs.existsSync(record.target) ? hashFile(record.target) : null;
      if (current === record.beforeSha256) continue;
      if (current !== record.afterSha256) throw Error('Destination changed outside this transaction');
      if (record.beforeSha256 === null) {
        const stat = fs.statSync(record.target);
        if (stat.dev !== record.device || stat.ino !== record.inode) throw Error('New catalog belongs to another writer');
        fs.unlinkSync(record.target); syncDirectory(path.dirname(record.target)); continue;
      }
      noSymlinkAncestors(record.backup); regularFile(record.backup);
      if (hashFile(record.backup) !== record.beforeSha256) throw Error('Rollback backup mismatch');
      atomicReplace(record.target, fs.readFileSync(record.backup));
    } catch (error) { errors.push({ target: record.target, message: error.message }); }
  }
  for (const record of [...journal.newFiles].reverse()) {
    try {
      if (!fs.existsSync(record.target)) continue;
      noSymlinkAncestors(record.target); regularFile(record.target);
      if (hashFile(record.target) !== record.sha256) throw Error('New pool file changed outside this transaction');
      const stat = fs.statSync(record.target);
      if (stat.dev !== record.device || stat.ino !== record.inode) throw Error('Pool filename now belongs to another writer');
      fs.unlinkSync(record.target); syncDirectory(path.dirname(record.target));
    } catch (error) { errors.push({ target: record.target, message: error.message }); }
  }
  journal.status = errors.length ? 'rollback-incomplete' : 'rolled-back';
  journal.rollbackErrors = errors;
  writeJournal(journalFile, journal);
  if (errors.length) throw Error('Rollback incomplete; retain stopped service and inspect the journal');
}

function installExpansion(options) {
  const { stage, manifest, paths, installing = false, assertStopped, hooks = {} } = options;
  plainDirectory(stage);
  if (installing && typeof assertStopped !== 'function') throw Error('Stopped-process guard required');
  if (installing) assertStopped();
  const lock = path.join(stage, '.installation-lock');
  if (fs.existsSync(lock)) throw Error('Unfinished or concurrent installation; inspect journal before continuing');
  fs.mkdirSync(lock);
  let journal = null, journalFile = path.join(stage, 'installation-journal.json'), committed = false;
  try {
    const current = preflight(options);
    const report = { installing, curatedAdded: manifest.curatedWords.length, curatedTotal: current.curated.words.length, soloAdded: current.installs.length, soloAlreadyPresent: current.skipped.length, assigned: current.assigned, indexChangedSinceCapture: current.indexChangedSinceCapture, originalIndexPreserved: true, sharedBankAndEasyModified: false };
    if (!installing) return report;
    assertStopped();
    // All writes follow this fresh merge. Reject any external writer after it.
    const indexBefore = hashBytes(current.indexBytes), curatedBefore = current.curatedBytes === null ? null : hashBytes(current.curatedBytes);
    const unchanged = () => {
      assertStopped();
      const currentCuratedHash = fs.existsSync(paths.curated) ? hashFile(paths.curated) : null;
      if (hashFile(paths.index) !== indexBefore || currentCuratedHash !== curatedBefore) throw Error('Catalog changed after stopped preflight');
      const expected = new Set([...current.currentNames, ...current.installs.filter(a => fs.existsSync(path.join(paths.pool, a.filename))).map(a => a.filename)]);
      if (JSON.stringify([...new Set(fs.readdirSync(paths.pool))].sort()) !== JSON.stringify([...expected].sort())) throw Error('Pool changed after stopped preflight');
    };
    if (!fs.existsSync(paths.backups)) fs.mkdirSync(paths.backups, { recursive: true });
    noSymlinkAncestors(paths.backups); plainDirectory(paths.backups);
    const backupDir = path.join(paths.backups, `subtextle-online-${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(backupDir);
    const indexAfter = jsonBytes(current.index), curatedAfter = jsonBytes(current.curated);
    const catalogs = [[paths.index, current.indexBytes, indexAfter, 'sp-pool-index.json'], [paths.curated, current.curatedBytes, curatedAfter, 'curated-public-targets.json']].map(([target, bytes, after, name]) => {
      const backup = bytes === null ? null : path.join(backupDir, name);
      if (bytes !== null) durableWrite(backup, bytes);
      return { target, backup, beforeSha256: bytes === null ? null : hashBytes(bytes), afterSha256: hashBytes(after) };
    });
    syncDirectory(backupDir);
    journal = { version: 1, status: 'installing', createdAt: new Date().toISOString(), backupDir, catalogs, newFiles: [], plannedFiles: current.installs.map(a => ({ target: path.join(paths.pool, a.filename), sha256: a.sha256 })), report };
    writeJournal(journalFile, journal);
    hooks.afterJournal?.();
    for (const addition of current.installs) {
      unchanged();
      const destination = path.join(paths.pool, addition.filename);
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        fs.copyFileSync(addition.file, temporary, fs.constants.COPYFILE_EXCL);
        const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        // Journal intent before link, making an abrupt process death recoverable.
        const identity = fs.statSync(temporary);
        journal.newFiles.push({ target: destination, sha256: addition.sha256, device: identity.dev, inode: identity.ino });
        writeJournal(journalFile, journal);
        fs.linkSync(temporary, destination); // Exclusive and atomic; cannot replace a historical file.
        fs.unlinkSync(temporary); syncDirectory(paths.pool);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      hooks.afterPoolFile?.(addition.word);
    }
    unchanged();
    hooks.beforeCatalogCommit?.();
    unchanged();
    atomicReplace(paths.index, indexAfter);
    hooks.afterIndexCommit?.();
    assertStopped();
    const currentCuratedHash = fs.existsSync(paths.curated) ? hashFile(paths.curated) : null;
    if (currentCuratedHash !== curatedBefore) throw Error('Supplemental curated catalog changed during commit');
    if (curatedBefore === null) {
      exclusiveCreate(paths.curated, curatedAfter, identity => {
        const record = journal.catalogs.find(r => r.target === paths.curated);
        record.device = identity.dev; record.inode = identity.ino;
        writeJournal(journalFile, journal);
      });
    } else atomicReplace(paths.curated, curatedAfter);
    assertStopped();
    for (const record of catalogs) if (hashFile(record.target) !== record.afterSha256) throw Error('Catalog verification failed');
    for (const addition of current.installs) if (hashFile(path.join(paths.pool, addition.filename)) !== addition.sha256) throw Error('Installed ranking verification failed');
    journal.status = 'committed'; journal.completedAt = new Date().toISOString();
    writeJournal(journalFile, journal);
    committed = true;
    return { ...report, backupDir, indexAfterSha256: hashFile(paths.index), curatedAfterSha256: hashFile(paths.curated) };
  } catch (error) {
    if (journal && !committed) {
      try { rollback({ journalFile, journal, assertStopped }); }
      catch (rollbackError) { error.message += `; ${rollbackError.message}`; }
    }
    throw error;
  } finally {
    if (!journal || committed || journal.status === 'rolled-back') fs.rmdirSync(lock);
  }
}

function assertProductionStopped() {
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error('Cannot confirm PM2 service is stopped');
  let processes; try { processes = JSON.parse(result.stdout); } catch { throw Error('Invalid PM2 stopped-process response'); }
  const matching = processes.filter(p => p.name === 'searchle-mobile');
  if (matching.length !== 1 || matching[0].pm2_env?.status !== 'stopped' || Number(matching[0].pid) !== 0) throw Error('searchle-mobile must be stopped before content installation');
}

async function productionValidator(manifest) {
  const required = ['/opt/chat-relay/src/game-word-policy.js', '/opt/chat-relay/src/word-bank-exclusions.js', '/opt/chat-relay/data/blocked-words.json', '/opt/searchle/server/game-manager.js'];
  for (const target of required) if (!manifest.inputs.some(i => i.target === target)) throw Error(`Required policy preimage missing: ${target}`);
  const policy = require('/opt/chat-relay/src/game-word-policy.js');
  const source = fs.readFileSync('/opt/searchle/server/game-manager.js', 'utf8');
  const section = source.match(/const SEARCHLE_DUAL_MEANING_BLOCK = new Set\(\[([\s\S]*?)\]\);/);
  if (!section) throw Error('Cannot validate canonical dual-meaning exclusion');
  const blocked = new Set([...section[1].replace(/\/\/[^\r\n]*/g, '').matchAll(/['"]([a-z]+)['"]/g)].map(m => m[1]));
  // Use the private credentials only on the host and expose neither credentials
  // nor the API response. Recheck after public play has stopped, because other
  // streamer channels may have solved one of the candidate words meanwhile.
  require('/opt/searchle/node_modules/dotenv').config({ path: '/opt/searchle/.env', quiet: true });
  const key = process.env.GAME_API_SECRET;
  if (!key) throw Error('Fresh won-history authentication unavailable');
  let body;
  try {
    const response = await fetch(`${process.env.WORD_EMPIRES_URL || 'http://localhost:3020'}/api/admin/game-won-words?game=searchle`, {
      headers: { 'x-api-key': key, 'x-admin-key': process.env.ADMIN_API_SECRET || key }, redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error('request failed');
    body = await response.json();
  } catch { throw Error('Fresh won-history lookup failed; content was not installed'); }
  if (!body?.ok || !Array.isArray(body.words) || body.words.some(word => typeof word !== 'string')) throw Error('Fresh won-history response invalid');
  const won = new Set(body.words.map(word => word.toLowerCase().trim()));
  return word => !won.has(word) && !blocked.has(word) && !policy.isWordBlockedForGame('searchle', 'target', word);
}

function validateRollbackJournal(journal) {
  const allowedCatalogs = new Set(['/opt/searchle/data/sp-pool-index.json', '/opt/searchle/data/curated-public-targets.json']);
  if (!/^\/opt\/_deploy-backups\/subtextle-online-\d+-[a-f0-9-]+$/.test(journal.backupDir) || journal.version !== 1 || !['installing', 'committed', 'rollback-incomplete'].includes(journal.status) || journal.catalogs?.length !== 2 || new Set(journal.catalogs.map(r => r.target)).size !== 2 || journal.catalogs.some(r => !allowedCatalogs.has(r.target) || !(r.beforeSha256 === null ? r.backup === null && r.target === '/opt/searchle/data/curated-public-targets.json' && (journal.status !== 'committed' || Number.isFinite(r.device) && Number.isFinite(r.inode)) : path.dirname(r.backup || '') === journal.backupDir && path.basename(r.backup) === path.basename(r.target) && HASH.test(r.beforeSha256)) || !HASH.test(r.afterSha256)) || !Array.isArray(journal.newFiles) || journal.newFiles.some(r => path.dirname(r.target) !== '/opt/searchle/data/sp-pool' || !POOL.test(path.basename(r.target)) || !HASH.test(r.sha256) || !Number.isFinite(r.device) || !Number.isFinite(r.inode))) throw Error('Unsafe rollback journal');
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const stagingArg = argumentsList.find(a => a.startsWith('--stage='));
  if (!stagingArg || argumentsList.some(a => !a.startsWith('--stage=') && a !== '--install' && a !== '--rollback')) throw Error('Use --stage=/tmp/subtextle-online-expansion-... [--install | --rollback]');
  const stage = path.resolve(stagingArg.slice(8));
  if (process.platform === 'win32' || !/^\/tmp\/subtextle-online-expansion-[a-z0-9-]+$/.test(stage)) throw Error('Installer requires an uploaded /tmp expansion directory');
  noSymlinkAncestors(stage); plainDirectory(stage);
  if (argumentsList.includes('--rollback')) {
    if (argumentsList.includes('--install')) throw Error('Choose install or rollback');
    const journalFile = stagedFile(stage, 'installation-journal.json'), journal = readJson(journalFile);
    // The journal must not be usable as an arbitrary filesystem-write recipe.
    validateRollbackJournal(journal);
    rollback({ journalFile, journal, assertStopped: assertProductionStopped });
    const lock = path.join(stage, '.installation-lock'); if (fs.existsSync(lock)) fs.rmdirSync(lock);
    console.log(JSON.stringify({ status: journal.status })); return;
  }
  const manifestFile = stagedFile(stage, 'release-manifest.json'), manifest = readJson(manifestFile);
  validateManifest(manifest);
  for (const input of manifest.inputs) if (!/^\/opt\/(searchle|chat-relay)\//.test(input.target) || input.target.split('/').includes('..')) throw Error('Canonical input outside allowed repositories');
  // Validate checksums before requiring production policy code.
  for (const input of manifest.inputs) if (hashFile(input.target) !== input.sha256) throw Error(`Canonical input changed: ${input.target}`);
  if (argumentsList.includes('--install')) assertProductionStopped();
  const validateWord = await productionValidator(manifest);
  const report = installExpansion({ stage, manifest, installing: argumentsList.includes('--install'), assertStopped: assertProductionStopped, validateWord, paths: { pool: '/opt/searchle/data/sp-pool', index: '/opt/searchle/data/sp-pool-index.json', curated: '/opt/searchle/data/curated-public-targets.json', backups: '/opt/_deploy-backups' } });
  atomicReplace(path.join(stage, argumentsList.includes('--install') ? 'installation-report.json' : 'dry-run-report.json'), jsonBytes(report));
  console.log(JSON.stringify(report));
}

module.exports = { hashBytes, hashFile, validateRankings, validateManifest, validateEvidence, mergeIndex, preflight, installExpansion, rollback, stagedFile, validateRollbackJournal };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
