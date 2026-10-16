/**
 * Verifies createLedgerArchiveBackup() against the REAL archive, writing into a
 * throwaway backup dir. Checks the snapshot is a valid, complete SQLite DB and
 * that producing it costs no meaningful memory.
 *
 *   WORD_TYCOON_DATA_DIR=/tmp/... LEDGER_ARCHIVE_DB_PATH=<real> node scripts/test-archive-backup.js
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const backup = require(path.resolve(process.argv[2] || `${__dirname}/../src/backup.js`));
const { LEDGER_ARCHIVE_DB_PATH, BACKUP_DIR } = require('../src/paths');

let peak = 0;
const timer = setInterval(() => { const r = process.memoryUsage().rss; if (r > peak) peak = r; }, 5);
const mb = (b) => Math.round(b / 1048576);

function stats(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  const out = {
    integrity: d.prepare('PRAGMA integrity_check').get().integrity_check,
    rows: d.prepare('SELECT COUNT(*) c FROM player_ledger').get().c,
    maxId: d.prepare('SELECT MAX(id) m FROM player_ledger').get().m,
    indexes: d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='player_ledger'").get().c,
    freePages: Object.values(d.prepare('PRAGMA freelist_count').get())[0]
  };
  d.close();
  return out;
}

const base = process.memoryUsage().rss;
const src = stats(LEDGER_ARCHIVE_DB_PATH);

const t0 = Date.now();
const res = backup.createLedgerArchiveBackup('manual');
const ms = Date.now() - t0;
clearInterval(timer);

if (!res.ok || res.skipped) {
  console.log('RESULT:', JSON.stringify(res));
  process.exit(res.skipped ? 0 : 1);
}

const destPath = path.join(BACKUP_DIR, 'manual', res.file);
const dst = stats(destPath);

console.log(JSON.stringify({
  ms,
  peakRssOverBaselineMB: mb(peak - base),
  srcMB: mb(fs.statSync(LEDGER_ARCHIVE_DB_PATH).size),
  dstMB: mb(fs.statSync(destPath).size),
  src,
  dst,
  rowsMatch: src.rows === dst.rows,
  maxIdMatch: src.maxId === dst.maxId,
  indexesMatch: src.indexes === dst.indexes,
  integrityOk: dst.integrity === 'ok'
}, null, 2));

const pass = src.rows === dst.rows && src.maxId === dst.maxId
  && src.indexes === dst.indexes && dst.integrity === 'ok';
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
