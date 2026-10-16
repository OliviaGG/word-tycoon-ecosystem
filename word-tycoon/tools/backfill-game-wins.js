/**
 * Backfill game_wins table from existing player_ledger reward entries.
 *
 * Only copies WIN events (win, daily-win, jackpot-win, jackpot) —
 * skips per-word events (word, pangram) that inflate counts.
 *
 * Also normalizes game names (spellingbee → spelling-bee).
 *
 * Usage: node tools/backfill-game-wins.js [--dry-run]
 *
 * IMPORTANT: Run while mobile-tycoon is STOPPED.
 */

const db = require('../src/database');

const DRY_RUN = process.argv.includes('--dry-run');
const WIN_EVENTS = new Set(['win', 'daily-win', 'jackpot-win', 'jackpot']);
const GAME_ALIASES = { 'spellingbee': 'spelling-bee', 'word-500': 'word500' };

(async () => {
  await db.initialize();
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : '🔧 LIVE RUN — will insert into game_wins\n');

  // Check if game_wins already has data
  const existingCount = db.queryScalar('SELECT COUNT(*) FROM game_wins');
  if (existingCount > 0) {
    console.log(`⚠ game_wins already has ${existingCount} entries.`);
    console.log('  To re-run, first DELETE FROM game_wins and try again.');
    process.exit(1);
  }

  // Read all reward entries from player_ledger
  const ledgerRows = db.queryAll(
    "SELECT id, player_id, detail, created_at FROM player_ledger WHERE event_type = 'reward' AND detail IS NOT NULL ORDER BY created_at ASC"
  );

  console.log(`Found ${ledgerRows.length} total reward entries in player_ledger\n`);

  let inserted = 0;
  let skippedPerWord = 0;
  let skippedNoGame = 0;
  let skippedAdmin = 0;
  let skippedParseError = 0;
  const gameCounts = {};

  for (const row of ledgerRows) {
    let detail;
    try {
      detail = JSON.parse(row.detail);
    } catch {
      skippedParseError++;
      continue;
    }

    let game = detail.game;
    const event = detail.event || 'reward';

    if (!game) { skippedNoGame++; continue; }
    if (game === 'admin') { skippedAdmin++; continue; }

    // Normalize game name
    game = GAME_ALIASES[game] || game;

    // Only record actual win events
    if (!WIN_EVENTS.has(event)) {
      skippedPerWord++;
      continue;
    }

    // Extract any available details
    const coinsAwarded = detail.boostedCoins || detail.baseCoins || 0;

    if (!DRY_RUN) {
      db.run(
        `INSERT INTO game_wins (player_id, game, event, guess_count, word, coins_awarded, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
        [row.player_id, game, event, coinsAwarded, row.created_at]
      );
    }
    inserted++;
    gameCounts[game] = (gameCounts[game] || 0) + 1;
  }

  console.log('━━━ RESULTS ━━━');
  console.log(`Win entries to insert: ${inserted}`);
  console.log(`Skipped per-word (word/pangram): ${skippedPerWord}`);
  console.log(`Skipped admin: ${skippedAdmin}`);
  console.log(`Skipped no game: ${skippedNoGame}`);
  console.log(`Skipped parse error: ${skippedParseError}`);
  console.log('');
  console.log('Per-game breakdown:');
  for (const [game, count] of Object.entries(gameCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${game}: ${count}`);
  }

  if (!DRY_RUN && inserted > 0) {
    db.save();
    console.log(`\n💾 Database saved — ${inserted} entries inserted into game_wins`);
  }

  process.exit(0);
})();
