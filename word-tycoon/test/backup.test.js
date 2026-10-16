'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backup = require('../src/backup');

test('parseSnapshotMeta supports legacy backup prefixes and old manual filenames', () => {
  const startup = backup.parseSnapshotMeta('word-empires_startup_2026-03-25_02-48-31-958.db');
  assert.deepEqual(startup, {
    dbKind: 'word-empires',
    type: 'startup',
    timestamp: '2026-03-25_02-48-31-958',
    key: 'startup:2026-03-25_02-48-31-958'
  });

  const legacyManual = backup.parseSnapshotMeta('word-empires_2026-02-24_04-44-12-171.db', 'manual');
  assert.deepEqual(legacyManual, {
    dbKind: 'word-empires',
    type: 'manual',
    timestamp: '2026-02-24_04-44-12-171',
    key: 'manual:2026-02-24_04-44-12-171'
  });
});

test('listSnapshotsInDir and buildDirPruneReport include legacy snapshot pairs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-backup-test-'));

  try {
    const files = [
      {
        name: 'word-empires_startup_2026-03-20_10-00-00-000.db',
        body: 'legacy-main',
        mtime: new Date('2026-03-20T10:00:00.000Z')
      },
      {
        name: 'player-ledger_startup_2026-03-20_10-00-00-000.db',
        body: 'legacy-ledger',
        mtime: new Date('2026-03-20T10:00:00.000Z')
      },
      {
        name: 'word-tycoon_startup_2026-03-21_10-00-00-000.db',
        body: 'current-main',
        mtime: new Date('2026-03-21T10:00:00.000Z')
      }
    ];

    for (const file of files) {
      const filePath = path.join(tempDir, file.name);
      fs.writeFileSync(filePath, file.body);
      fs.utimesSync(filePath, file.mtime, file.mtime);
    }

    const snapshots = backup.listSnapshotsInDir(tempDir);
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].key, 'startup:2026-03-21_10-00-00-000');
    assert.equal(snapshots[1].key, 'startup:2026-03-20_10-00-00-000');
    assert.equal(snapshots[1].files.length, 2);
    assert.deepEqual(
      snapshots[1].files.map((file) => file.name).sort(),
      [
        'player-ledger_startup_2026-03-20_10-00-00-000.db',
        'word-empires_startup_2026-03-20_10-00-00-000.db'
      ]
    );

    const report = backup.buildDirPruneReport(tempDir, 1, { dbSnapshots: snapshots });
    assert.equal(report.count, 2);
    assert.equal(report.retainedCount, 1);
    assert.equal(report.pruneCandidateCount, 1);
    assert.equal(report.pruneCandidates[0].key, 'startup:2026-03-20_10-00-00-000');
    assert.equal(report.pruneCandidates[0].timestamp, '2026-03-20_10-00-00-000');
    assert.equal(report.pruneCandidates[0].totalSizeMB, snapshots[1].totalSizeMB);
    assert.deepEqual(
      report.pruneCandidates[0].files.slice().sort(),
      [
        'player-ledger_startup_2026-03-20_10-00-00-000.db',
        'word-empires_startup_2026-03-20_10-00-00-000.db'
      ]
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
