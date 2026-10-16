/**
 * Parity harness for the ledger-archive engine swap (sql.js -> node:sqlite).
 *
 * Runs the full public API of ONE implementation against a throwaway DB and
 * prints a JSON result blob. The driver runs it once per implementation and
 * diffs the blobs, so any behavioural drift shows up as a real diff rather than
 * a judgement call.
 *
 *   node scripts/test-ledger-archive-parity.js <modulePath> <dbPath>
 */
const modulePath = process.argv[2];
const dbPath = process.argv[3];

if (!modulePath || !dbPath) {
  console.error('usage: test-ledger-archive-parity.js <modulePath> <dbPath>');
  process.exit(2);
}

// paths.js reads this at require time, so it must be set before the module loads.
process.env.LEDGER_ARCHIVE_DB_PATH = dbPath;

const fs = require('fs');
const path = require('path');
for (const suffix of ['', '-journal', '-wal', '-shm', '.tmp']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}

const archive = require(path.resolve(modulePath));

const out = {};
const step = (name, fn) => {
  try {
    out[name] = { ok: true, value: fn() };
  } catch (err) {
    out[name] = { ok: false, error: String(err && err.message || err) };
  }
};

function entry(over = {}) {
  return Object.assign({
    id: 1,
    player_id: 100,
    player_name: 'Zarul',
    platform: 'tiktok',
    event_type: 'reward',
    command: '!work',
    coins_before: 0,
    coins_after: 190303833607,   // real observed max, near the REAL/INT boundary
    coins_delta: 190303833607,
    gift_coins_before: null,
    gift_coins_after: null,
    gift_coins_delta: 0,
    success: 1,
    response: 'ok',
    detail: null,
    created_at: '2026-08-01 12:00:00'
  }, over);
}

(async () => {
  step('uninitialized_throws', () => {
    try { archive.queryScalar('SELECT 1'); return 'NO THROW'; }
    catch (e) { return 'threw: ' + e.message; }
  });

  await archive.initialize();

  step('empty_append', () => archive.appendEntries([]));
  step('empty_count', () => archive.queryScalar('SELECT COUNT(*) FROM player_ledger'));

  step('append_3', () => archive.appendEntries([
    entry({ id: 1 }),
    // undefined + boolean + unicode + embedded quote: the coercion edge cases
    entry({ id: 2, player_id: 200, player_name: 'Chickadée', command: undefined,
            success: true, detail: "it's a \"quoted\" detail", created_at: '2026-08-02 09:30:00' }),
    entry({ id: 3, player_id: 200, player_name: 'Chickadée', event_type: 'purchase',
            coins_delta: -500.25, coins_after: 12.5, gift_coins_after: 7,
            success: false, created_at: '2026-08-03 23:59:59' })
  ]));

  step('count_after_append', () => archive.queryScalar('SELECT COUNT(*) FROM player_ledger'));
  step('all_rows', () => archive.queryAll('SELECT * FROM player_ledger ORDER BY id'));
  step('row_types', () => archive.queryAll('SELECT id, coins_after, coins_delta, success, command, detail FROM player_ledger ORDER BY id')
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? 'null' : typeof v]))));

  step('queryOne_hit', () => archive.queryOne('SELECT * FROM player_ledger WHERE id = ?', [2]));
  step('queryOne_miss', () => archive.queryOne('SELECT * FROM player_ledger WHERE id = ?', [999]));
  step('queryScalar_miss', () => archive.queryScalar('SELECT id FROM player_ledger WHERE id = ?', [999]));
  step('queryAll_miss', () => archive.queryAll('SELECT * FROM player_ledger WHERE id = ?', [999]));
  step('queryScalar_sum', () => archive.queryScalar('SELECT COALESCE(SUM(coins_delta),0) FROM player_ledger WHERE coins_delta < 0'));
  step('group_by', () => archive.queryAll('SELECT event_type, COUNT(*) as cnt FROM player_ledger GROUP BY event_type ORDER BY cnt DESC, event_type'));
  step('param_undefined_to_null', () => archive.queryAll('SELECT id FROM player_ledger WHERE command IS ?', [undefined]));

  // INSERT OR IGNORE must swallow duplicate ids, not error or double-count.
  step('reappend_same_ids', () => archive.appendEntries([entry({ id: 1 }), entry({ id: 2 })]));
  step('count_after_dupe', () => archive.queryScalar('SELECT COUNT(*) FROM player_ledger'));

  // Rollback: NOT NULL on player_name must abort the WHOLE batch.
  step('bad_batch_throws', () => {
    try {
      archive.appendEntries([entry({ id: 50 }), entry({ id: 51, player_name: null }), entry({ id: 52 })]);
      return 'NO THROW';
    } catch (e) { return 'threw'; }
  });
  step('count_after_rollback', () => archive.queryScalar('SELECT COUNT(*) FROM player_ledger'));

  step('reassign', () => archive.reassignPlayerId(100, 200));
  step('reassign_noop', () => archive.reassignPlayerId(100, 77777));
  step('player_ids_after_reassign', () => archive.queryAll('SELECT DISTINCT player_id FROM player_ledger ORDER BY player_id'));

  step('vacuum', () => archive.vacuum());
  step('count_after_vacuum', () => archive.queryScalar('SELECT COUNT(*) FROM player_ledger'));
  step('archived_at_present', () => archive.queryAll('PRAGMA table_info(player_ledger)').map((c) => c.name).join(','));
  step('file_exists', () => fs.existsSync(dbPath));

  console.log(JSON.stringify(out, null, 2));
})();
