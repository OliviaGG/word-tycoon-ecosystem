/**
 * Memory + latency benchmark for the ledger-archive engine swap.
 *
 * Replays the six archive queries that getLedgerStats() issues per request
 * against a real-sized archive, and reports peak RSS and wall time.
 *
 *   node scripts/bench-ledger-archive.js <modulePath> <dbPath>
 */
const modulePath = process.argv[2];
const dbPath = process.argv[3];
process.env.LEDGER_ARCHIVE_DB_PATH = dbPath;

const path = require('path');
const archive = require(path.resolve(modulePath));

let peak = 0;
const sample = () => { const r = process.memoryUsage().rss; if (r > peak) peak = r; };
const timer = setInterval(sample, 5);
const mb = (b) => Math.round(b / 1048576);

(async () => {
  sample();
  const baseline = process.memoryUsage().rss;

  const t0 = Date.now();
  await archive.initialize();
  sample();
  const tInit = Date.now() - t0;
  const afterInit = process.memoryUsage().rss;

  // The exact six calls getLedgerStats() makes.
  const t1 = Date.now();
  const total = archive.queryScalar('SELECT COUNT(*) FROM player_ledger');
  sample();
  const byType = archive.queryAll('SELECT event_type, COUNT(*) as cnt FROM player_ledger GROUP BY event_type ORDER BY cnt DESC');
  sample();
  const credits = archive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta > 0');
  sample();
  const debits = archive.queryScalar('SELECT COALESCE(SUM(coins_delta), 0) FROM player_ledger WHERE coins_delta < 0');
  sample();
  const top = archive.queryAll(
    `SELECT player_id, player_name, COUNT(*) as entries,
            SUM(CASE WHEN coins_delta > 0 THEN coins_delta ELSE 0 END) as total_earned
     FROM player_ledger GROUP BY player_id, player_name`
  );
  sample();
  const recent = archive.queryScalar("SELECT COUNT(*) FROM player_ledger WHERE created_at >= datetime('now', '-1 day')");
  sample();
  const tStats = Date.now() - t1;

  clearInterval(timer);
  sample();

  console.log(JSON.stringify({
    module: path.basename(modulePath),
    rows: total,
    eventTypes: byType.length,
    topPlayers: top.length,
    credits, debits, recent,
    initMs: tInit,
    statsMs: tStats,
    baselineRssMB: mb(baseline),
    afterInitRssMB: mb(afterInit),
    peakRssMB: mb(peak),
    peakOverBaselineMB: mb(peak - baseline)
  }, null, 2));
})();
