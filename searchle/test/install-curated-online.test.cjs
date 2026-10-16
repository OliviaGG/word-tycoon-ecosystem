'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashBytes, hashFile, installExpansion, rollback, validateRankings, mergeIndex, stagedFile, validateRollbackJournal } = require('../scripts/install-curated-online.cjs');
const bytes = data => Buffer.from(JSON.stringify(data, null, 2) + '\n');
const write = (file, data) => fs.writeFileSync(file, bytes(data));
const read = file => JSON.parse(fs.readFileSync(file));
const puzzle = word => ({ targetWord: word, rankings: { [word]: 1, alpha: word === 'alpha' ? 1 : 2, companion: word === 'alpha' ? 2 : 3 }, totalRankedWords: word === 'alpha' ? 2 : 3 });

function fixture(t, { previousCurated = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtextle-install-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage'), pool = path.join(root, 'pool');
  fs.mkdirSync(stage); fs.mkdirSync(pool); fs.mkdirSync(path.join(stage, 'sp-pool'));
  const paths = { pool, index: path.join(root, 'sp-pool-index.json'), curated: path.join(root, 'curated-public-targets.json'), backups: path.join(root, 'backups') };
  const index = { nextNumber: 10, words: { alpha: 7 }, vacantNumbers: [2, 8], weeklyNumbers: { weeklyword: 3 }, nextWeeklyNumber: 4, weeklyAssignments: { '2026-10-05': 'weeklyword' }, dailyAssignments: { '2026-10-09': 'alpha' }, futureState: { preserve: [1, 'two', false] } };
  write(paths.index, index);
  if (previousCurated) write(paths.curated, { version: 1, words: ['oldword'], opaqueMetadata: { retained: true } });
  const oldNames = ['pool_101_alpha.json', 'pool_102_weeklyword.json'];
  write(path.join(pool, oldNames[0]), puzzle('alpha'));
  write(path.join(pool, oldNames[1]), puzzle('weeklyword'));
  const policyFile = path.join(root, 'policy.txt'); fs.writeFileSync(policyFile, 'immutable canonical policy');
  const curatedWords = ['bravo', 'charlie', 'weeklyword'];
  const additions = curatedWords.slice(0, 2).map((word, number) => {
    const filename = `pool_${200 + number}_${word}.json`, file = path.join(stage, 'sp-pool', filename);
    write(file, puzzle(word));
    return { word, filename, bytes: fs.statSync(file).size, sha256: hashFile(file), rankedWords: 3 };
  });
  const evidence = { minZipf: 4, accepted: curatedWords.map(word => ({ word, zipf: 4.5, checks: { dictionary: true, model: true, morphology: true, policy: true, notPreviouslyWon: true, curated: true } })) };
  const evidenceFile = path.join(stage, 'selection-evidence.json'); write(evidenceFile, evidence);
  const manifest = { version: 1, curatedWords, additions, baseline: { curatedSha256: previousCurated ? hashFile(paths.curated) : null, indexSha256: hashFile(paths.index), poolFiles: oldNames }, inputs: [{ target: policyFile, sha256: hashFile(policyFile) }], selectionEvidence: { filename: 'selection-evidence.json', sha256: hashFile(evidenceFile) } };
  const stopped = { value: true };
  const options = { stage, manifest, paths, minimumRankedWords: 3, validateWord: () => true, assertStopped: () => { if (!stopped.value) throw Error('service running'); } };
  return { root, stage, paths, index, manifest, evidence, evidenceFile, policyFile, options, stopped };
}

test('installs exclusively, keeps pins and weekly identity, appends new game IDs above historical IDs', t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.paths.pool, 'pool_101_alpha.json'));
  const result = installExpansion({ ...f.options, installing: true });
  assert.deepEqual(result.assigned, [{ word: 'bravo', number: 10 }, { word: 'charlie', number: 11 }]);
  assert.equal(result.soloAdded, 2); assert.equal(result.soloAlreadyPresent, 1);
  const after = read(f.paths.index);
  assert.deepEqual(after, { ...f.index, words: { alpha: 7, bravo: 10, charlie: 11 }, nextNumber: 12 });
  assert.deepEqual(fs.readFileSync(path.join(f.paths.pool, 'pool_101_alpha.json')), before);
  assert.deepEqual(read(f.paths.curated), { version: 1, words: f.manifest.curatedWords });
  assert.equal(read(path.join(f.stage, 'installation-journal.json')).status, 'committed');
});

test('preserves concurrent multiplayer append made after capture and skips its duplicate solo file', t => {
  const f = fixture(t);
  const live = { ...f.index, words: { alpha: 7, delta: 14, charlie: 15 }, nextNumber: 16 };
  write(f.paths.index, live); write(path.join(f.paths.pool, 'pool_190_delta.json'), puzzle('delta')); write(path.join(f.paths.pool, 'pool_191_charlie.json'), puzzle('charlie'));
  const livePuzzle = fs.readFileSync(path.join(f.paths.pool, 'pool_191_charlie.json'));
  const result = installExpansion({ ...f.options, installing: true });
  assert.equal(result.indexChangedSinceCapture, true);
  assert.deepEqual(result.assigned, [{ word: 'bravo', number: 16 }]);
  assert.deepEqual(read(f.paths.index), { ...live, words: { ...live.words, bravo: 16 }, nextNumber: 17 });
  assert.deepEqual(fs.readFileSync(path.join(f.paths.pool, 'pool_191_charlie.json')), livePuzzle);
  assert.equal(fs.existsSync(path.join(f.paths.pool, f.manifest.additions[1].filename)), false);
});

test('preserves an existing supplemental catalog prefix and opaque fields', t => {
  const f = fixture(t, { previousCurated: true });
  installExpansion({ ...f.options, installing: true });
  assert.deepEqual(read(f.paths.curated), { version: 1, words: ['oldword', ...f.manifest.curatedWords], opaqueMetadata: { retained: true } });
});

test('dry run validates without changing any runtime file or requiring a stopped process', t => {
  const f = fixture(t); f.stopped.value = false;
  const index = fs.readFileSync(f.paths.index), pool = fs.readdirSync(f.paths.pool);
  const result = installExpansion(f.options);
  assert.equal(result.installing, false);
  assert.deepEqual(fs.readFileSync(f.paths.index), index); assert.deepEqual(fs.readdirSync(f.paths.pool), pool);
  assert.equal(fs.existsSync(f.paths.curated), false); assert.equal(fs.existsSync(f.paths.backups), false);
});

test('refuses writes while the service is running', t => {
  const f = fixture(t); f.stopped.value = false;
  assert.throws(() => installExpansion({ ...f.options, installing: true }), /service running/);
  assert.equal(fs.existsSync(f.paths.curated), false); assert.equal(fs.existsSync(path.join(f.stage, '.installation-lock')), false);
});

test('source/policy changes, rejected policy, or failed selection criteria abort before writes', t => {
  for (const reason of ['source', 'policy', 'evidence', 'frequency']) {
    const f = fixture(t);
    if (reason === 'source') fs.appendFileSync(f.policyFile, 'changed');
    if (reason === 'policy') f.options.validateWord = word => word !== 'bravo';
    if (reason === 'evidence') f.evidence.accepted[0].checks.morphology = false;
    if (reason === 'frequency') f.evidence.accepted[0].zipf = 3.9;
    if (['evidence', 'frequency'].includes(reason)) { write(f.evidenceFile, f.evidence); f.manifest.selectionEvidence.sha256 = hashFile(f.evidenceFile); }
    assert.throws(() => installExpansion({ ...f.options, installing: true }), /Canonical input changed|Live target policy rejected|Selection criteria failed|Frequency criterion failed/);
    assert.equal(fs.existsSync(f.paths.curated), false); assert.equal(fs.existsSync(f.paths.backups), false);
  }
});

test('checksum corruption and nonpermutation ranks fail even if a manifest checksum is recomputed', t => {
  const f = fixture(t), file = path.join(f.stage, 'sp-pool', f.manifest.additions[0].filename);
  fs.appendFileSync(file, 'corruption');
  assert.throws(() => installExpansion({ ...f.options, installing: true }), /checksum mismatch/);
  const bad = puzzle('bravo'); bad.rankings.companion = 2;
  write(file, bad); f.manifest.additions[0].sha256 = hashFile(file); f.manifest.additions[0].bytes = fs.statSync(file).size;
  assert.throws(() => installExpansion({ ...f.options, installing: true }), /Invalid rank permutation/);
});

test('rejects duplicate words/files, malformed words, and staging path traversal', t => {
  for (const mutate of [m => m.curatedWords.push('bravo'), m => m.curatedWords.push('../evil'), m => m.additions.push({ ...m.additions[0] }), m => { m.additions[0].filename = '../pool_200_bravo.json'; }]) {
    const f = fixture(t); mutate(f.manifest);
    assert.throws(() => installExpansion({ ...f.options, installing: true }), /Unsafe or duplicate/);
    assert.equal(fs.existsSync(f.paths.curated), false);
  }
  const f = fixture(t); assert.throws(() => stagedFile(f.stage, '../policy.txt'), /Unsafe staging filename/);
});

test('rejects deletion of a historical pool file or unexpected supplemental creation', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.paths.pool, f.manifest.baseline.poolFiles[0]));
  assert.throws(() => installExpansion({ ...f.options, installing: true }), /Historical pool file disappeared/);
  const second = fixture(t); write(second.paths.curated, { version: 1, words: ['externalword'] });
  assert.throws(() => installExpansion({ ...second.options, installing: true }), /Supplemental curated catalog changed/);
});

test('rolls back added pool files and the index after a partial catalog failure, byte for byte', t => {
  for (const previousCurated of [false, true]) {
    const f = fixture(t, { previousCurated }), index = fs.readFileSync(f.paths.index), oldCurated = previousCurated ? fs.readFileSync(f.paths.curated) : null, oldPool = fs.readdirSync(f.paths.pool);
    assert.throws(() => installExpansion({ ...f.options, installing: true, hooks: { afterIndexCommit() { throw Error('injected failure'); } } }), /injected failure/);
    assert.deepEqual(fs.readFileSync(f.paths.index), index); assert.deepEqual(fs.readdirSync(f.paths.pool), oldPool);
    assert.deepEqual(fs.existsSync(f.paths.curated) ? fs.readFileSync(f.paths.curated) : null, oldCurated);
    assert.equal(read(path.join(f.stage, 'installation-journal.json')).status, 'rolled-back');
    assert.equal(fs.existsSync(path.join(f.stage, '.installation-lock')), false);
  }
});

test('recovery restores both committed catalog writes if a process died before marking its journal committed', t => {
  const f = fixture(t), index = fs.readFileSync(f.paths.index), pool = fs.readdirSync(f.paths.pool);
  installExpansion({ ...f.options, installing: true });
  const journalFile = path.join(f.stage, 'installation-journal.json'), journal = read(journalFile);
  journal.status = 'installing'; write(journalFile, journal);
  rollback({ journalFile, journal, assertStopped: f.options.assertStopped });
  assert.deepEqual(fs.readFileSync(f.paths.index), index); assert.deepEqual(fs.readdirSync(f.paths.pool), pool); assert.equal(fs.existsSync(f.paths.curated), false);
  assert.equal(read(journalFile).status, 'rolled-back');
});

test('a deliberately rolled-back committed release retains stopped/hash/inode guards and restores prior content', t => {
  const f = fixture(t), index = fs.readFileSync(f.paths.index), pool = fs.readdirSync(f.paths.pool);
  installExpansion({ ...f.options, installing: true });
  const journalFile = path.join(f.stage, 'installation-journal.json'), journal = read(journalFile);
  assert.equal(journal.status, 'committed');
  const fixed = structuredClone(journal);
  fixed.backupDir = '/opt/_deploy-backups/subtextle-online-123-abc';
  fixed.catalogs.forEach(record => { record.target = '/opt/searchle/data/' + path.basename(record.target); if (record.backup) record.backup = fixed.backupDir + '/' + path.basename(record.backup); });
  fixed.newFiles.forEach(record => { record.target = '/opt/searchle/data/sp-pool/' + path.basename(record.target); });
  assert.doesNotThrow(() => validateRollbackJournal(fixed));
  const unsafe = structuredClone(fixed); unsafe.catalogs[0].target = '/etc/passwd'; assert.throws(() => validateRollbackJournal(unsafe), /Unsafe rollback journal/);
  const noOwnership = structuredClone(fixed); delete noOwnership.catalogs[1].inode; assert.throws(() => validateRollbackJournal(noOwnership), /Unsafe rollback journal/);
  f.stopped.value = false; assert.throws(() => rollback({ journalFile, journal, assertStopped: f.options.assertStopped }), /service running/);
  assert.equal(read(journalFile).status, 'committed');
  f.stopped.value = true; rollback({ journalFile, journal, assertStopped: f.options.assertStopped });
  assert.deepEqual(fs.readFileSync(f.paths.index), index); assert.deepEqual(fs.readdirSync(f.paths.pool), pool); assert.equal(fs.existsSync(f.paths.curated), false);
});

test('rejects a writer appearing after the stopped preflight and retains its unrelated file', t => {
  const f = fixture(t), index = fs.readFileSync(f.paths.index);
  assert.throws(() => installExpansion({ ...f.options, installing: true, hooks: { afterPoolFile() { write(path.join(f.paths.pool, 'pool_999_externalword.json'), puzzle('externalword')); } } }), /Pool changed after stopped preflight/);
  assert.deepEqual(fs.readFileSync(f.paths.index), index);
  assert.equal(fs.existsSync(path.join(f.paths.pool, 'pool_999_externalword.json')), true);
  assert.equal(fs.existsSync(path.join(f.paths.pool, f.manifest.additions[0].filename)), false);
});

test('rollback never removes another writer’s file that occupies the intended filename', t => {
  const f = fixture(t), index = fs.readFileSync(f.paths.index);
  assert.throws(() => installExpansion({ ...f.options, installing: true, hooks: { afterPoolFile(word) { const addition = f.manifest.additions.find(a => a.word === word); const target = path.join(f.paths.pool, addition.filename); fs.unlinkSync(target); fs.copyFileSync(path.join(f.stage, 'sp-pool', addition.filename), target); throw Error('replaced by another writer'); } } }), /another writer/);
  assert.deepEqual(fs.readFileSync(f.paths.index), index);
  assert.equal(fs.existsSync(path.join(f.paths.pool, f.manifest.additions[0].filename)), true);
  assert.equal(read(path.join(f.stage, 'installation-journal.json')).status, 'rollback-incomplete');
  assert.equal(fs.existsSync(path.join(f.stage, '.installation-lock')), true);
});

test('stable ID allocation does not reuse vacant or previously allocated IDs even with an inconsistent low nextNumber', () => {
  const source = { nextNumber: 4, words: { alpha: 20 }, vacantNumbers: [9, 99], weeklyNumbers: { weeklyword: 3 }, dailyAssignments: { today: 'alpha' }, custom: 'retained' };
  const result = mergeIndex(source, ['bravo', 'weeklyword']);
  assert.deepEqual(result.assigned, [{ word: 'bravo', number: 100 }]); assert.equal(result.index.nextNumber, 101);
  assert.deepEqual(result.index.vacantNumbers, [9, 99]); assert.deepEqual(source.words, { alpha: 20 }); assert.deepEqual(result.index.dailyAssignments, source.dailyAssignments);
});

test('full ranking validation rejects an incorrect answer and a truncated rank set', () => {
  const payload = puzzle('bravo'); payload.rankings.bravo = 2;
  assert.throws(() => validateRankings(payload, 'bravo', 3), /Incomplete rankings/);
  assert.throws(() => validateRankings(puzzle('bravo'), 'bravo', 100000), /Incomplete rankings/);
});
