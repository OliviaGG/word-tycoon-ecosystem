'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { installSources, rollback, allowedTarget, hashFile, validateJournal } = require('../scripts/install-curated-source.cjs');
function fixture(t, { runtime = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-source-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage'), targetRoot = path.join(root, 'target'); fs.mkdirSync(stage); fs.mkdirSync(targetRoot); fs.mkdirSync(path.join(stage, 'source'));
  const old = path.join(targetRoot, 'game-manager.js'), added = path.join(targetRoot, 'curated-targets.js'), unrelated = path.join(targetRoot, 'untouched.js');
  fs.writeFileSync(old, 'old manager\n'); fs.writeFileSync(unrelated, 'unrelated canonical code\n');
  fs.writeFileSync(path.join(stage, 'source', 'game-manager.js'), 'new manager\n'); fs.writeFileSync(path.join(stage, 'source', 'curated-targets.js'), 'new helper\n');
  const manifest = { version: 1, files: [old, added].map((target, i) => { const source = 'source/' + path.basename(target); const sourcePath = path.join(stage, source); return { target, source, beforeSha256: i ? null : hashFile(target), afterSha256: hashFile(sourcePath), bytes: fs.statSync(sourcePath).size }; }) };
  const guard = { calls: 0, running: false };
  const options = { stage, manifest, backups: path.join(root, 'backups'), allowTarget: target => path.dirname(target) === targetRoot, isRuntime: () => runtime, assertStopped: () => { guard.calls++; if (guard.running) throw Error('service running'); } };
  return { root, stage, old, added, unrelated, manifest, options, guard };
}
test('fixed production allowlist accepts only release paths and rejects traversal or unrelated server files', () => {
  for (const file of ['/opt/searchle/server/game-manager.js', '/opt/searchle/server/sp-manager.js', '/opt/searchle/server/session-manager.js', '/opt/searchle/server/curated-targets.js', '/opt/searchle/scripts/generate-curated-solo.cjs', '/opt/searchle/test/manager-recovery.test.cjs', '/opt/searchle/docs/content.md', '/opt/searchle/curation/selected.json', '/opt/searchle/.gitattributes']) assert.equal(allowedTarget(file), true, file);
  for (const file of ['/opt/searchle/.env', '/opt/searchle/server/config.js', '/opt/searchle/data/game-state.json', '/opt/searchle/scripts/../../.env', '/opt/searchle/scripts//file.js', '/opt/chat-relay/src/server.js']) assert.equal(allowedTarget(file), false, file);
});
test('dry run validates all sources without writes or requiring stopped runtime', t => {
  const f = fixture(t); f.guard.running = true;
  const result = installSources(f.options); assert.equal(result.changed.length, 2); assert.equal(f.guard.calls, 0);
  assert.equal(fs.readFileSync(f.old, 'utf8'), 'old manager\n'); assert.equal(fs.existsSync(f.added), false); assert.equal(fs.existsSync(f.options.backups), false);
});
test('installs only manifest targets, preserves unrelated bytes, and skips exact unchanged sources on retry', t => {
  const f = fixture(t), unrelated = fs.readFileSync(f.unrelated);
  const report = installSources({ ...f.options, installing: true });
  assert.equal(report.changed.length, 2); assert.ok(f.guard.calls >= 3); assert.equal(fs.readFileSync(f.old, 'utf8'), 'new manager\n'); assert.equal(fs.readFileSync(f.added, 'utf8'), 'new helper\n'); assert.deepEqual(fs.readFileSync(f.unrelated), unrelated);
  const retry = installSources({ ...f.options, installing: true }); assert.equal(retry.changed.length, 0); assert.equal(retry.unchanged.length, 2);
});
test('runtime source writes require a stopped service; tooling-only writes do not', t => {
  const f = fixture(t); f.guard.running = true;
  assert.throws(() => installSources({ ...f.options, installing: true }), /service running/); assert.equal(fs.existsSync(f.added), false);
  const tools = fixture(t, { runtime: false }); tools.guard.running = true;
  installSources({ ...tools.options, installing: true }); assert.equal(tools.guard.calls, 0);
});
test('every upload and preimage is validated before the first write', t => {
  for (const corruption of ['upload', 'preimage', 'duplicate', 'traversal']) {
    const f = fixture(t);
    if (corruption === 'upload') fs.appendFileSync(path.join(f.stage, f.manifest.files[1].source), 'changed');
    if (corruption === 'preimage') fs.appendFileSync(f.old, 'canonical update');
    if (corruption === 'duplicate') f.manifest.files.push({ ...f.manifest.files[0] });
    if (corruption === 'traversal') f.manifest.files[1].source = '../target/game-manager.js';
    assert.throws(() => installSources({ ...f.options, installing: true }), /checksum mismatch|Canonical source changed|Unsafe or duplicate|Unsafe staged source/);
    assert.equal(fs.existsSync(f.added), false); assert.equal(fs.existsSync(f.options.backups), false);
  }
});
test('restores original sources after a failure following the first replacement', t => {
  const f = fixture(t), original = fs.readFileSync(f.old);
  assert.throws(() => installSources({ ...f.options, installing: true, hooks: { afterFile() { throw Error('injected source failure'); } } }), /injected source failure/);
  assert.deepEqual(fs.readFileSync(f.old), original); assert.equal(fs.existsSync(f.added), false); assert.equal(fs.existsSync(path.join(f.stage, '.source-installation-lock')), false);
  const journal = JSON.parse(fs.readFileSync(path.join(f.stage, 'source-installation-journal.json'))); assert.equal(journal.status, 'rolled-back');
});
test('recovery reverses both replacements and exclusive additions after an interrupted final commit', t => {
  const f = fixture(t), original = fs.readFileSync(f.old);
  installSources({ ...f.options, installing: true });
  const journal = JSON.parse(fs.readFileSync(path.join(f.stage, 'source-installation-journal.json'))); journal.status = 'installing';
  rollback({ stage: f.stage, journal, assertStopped: f.options.assertStopped });
  assert.deepEqual(fs.readFileSync(f.old), original); assert.equal(fs.existsSync(f.added), false); assert.equal(journal.status, 'rolled-back');
});

test('a committed source release can be deliberately rolled back after failed boot verification with all guards retained', t => {
  const f = fixture(t), original = fs.readFileSync(f.old);
  installSources({ ...f.options, installing: true });
  const journal = JSON.parse(fs.readFileSync(path.join(f.stage, 'source-installation-journal.json')));
  assert.equal(journal.status, 'committed');
  const fixed = structuredClone(journal); fixed.backupDir = '/opt/_deploy-backups/subtextle-source-123-abc';
  fixed.files.forEach(record => { record.target = '/opt/searchle/server/' + path.basename(record.target); if (record.backup) record.backup = fixed.backupDir + '/' + path.basename(record.backup); });
  assert.doesNotThrow(() => validateJournal(fixed));
  const unsafe = structuredClone(fixed); unsafe.files[0].target = '/opt/searchle/.env'; assert.throws(() => validateJournal(unsafe), /Unsafe source rollback entry/);
  const noOwnership = structuredClone(fixed); delete noOwnership.files[1].inode; assert.throws(() => validateJournal(noOwnership), /ownership evidence/);
  f.guard.running = true; assert.throws(() => rollback({ stage: f.stage, journal, assertStopped: f.options.assertStopped }), /service running/);
  assert.equal(journal.status, 'committed'); f.guard.running = false;
  rollback({ stage: f.stage, journal, assertStopped: f.options.assertStopped });
  assert.deepEqual(fs.readFileSync(f.old), original); assert.equal(fs.existsSync(f.added), false); assert.equal(journal.status, 'rolled-back');
});
test('rollback retains a source changed by another writer and preserves an unfinished lock', t => {
  const f = fixture(t);
  assert.throws(() => installSources({ ...f.options, installing: true, hooks: { afterFile(target) { fs.writeFileSync(target, 'another writer\n'); throw Error('external write'); } } }), /rollback incomplete/);
  assert.equal(fs.readFileSync(f.old, 'utf8'), 'another writer\n'); assert.equal(fs.existsSync(path.join(f.stage, '.source-installation-lock')), true);
});
test('a newly created target whose preimage was absent is never overwritten', t => {
  const f = fixture(t);
  assert.throws(() => installSources({ ...f.options, installing: true, hooks: { afterJournal() { fs.writeFileSync(f.added, 'independent file\n'); } } }), /Source changed after preflight/);
  assert.equal(fs.readFileSync(f.added, 'utf8'), 'independent file\n'); assert.equal(fs.readFileSync(f.old, 'utf8'), 'old manager\n');
});
