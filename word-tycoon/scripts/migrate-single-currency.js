#!/usr/bin/env node
/**
 * Single-currency migration (2026-08-09)
 *
 * 1. Collapses every linked-account group into its primary player row via
 *    db.mergeLinkedAccounts() — businesses, managed state, cosmetics, library
 *    words, and currencies all move to one row per group.
 * 2. Folds the legacy players.coins ("dollars") balance into players.xp and
 *    zeroes coins. From this point the game has ONE spendable currency: XP.
 *
 * RUN ONLY WITH mobile-tycoon STOPPED — sql.js keeps the DB in RAM and a
 * running server would overwrite this script's changes on its next save.
 *
 * Usage:  node scripts/migrate-single-currency.js [--dry-run]
 */

process.env.GAME_API_SECRET = process.env.GAME_API_SECRET || 'migration-local';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const db = require('../src/database');
  await db.initialize();

  const sumRow = () => db.queryOne(
    'SELECT COUNT(*) AS players, SUM(xp) AS xp, SUM(coins) AS coins, SUM(gift_coins) AS gift FROM players'
  );

  const before = sumRow();
  console.log('[Migrate] BEFORE  players=%d  xp=%d  coins=%d  gift=%d',
    before.players, Math.floor(before.xp || 0), Math.floor(before.coins || 0), Math.floor(before.gift || 0));
  const expectedXp = Math.floor((before.xp || 0)) + Math.floor((before.coins || 0));

  // ── Step 1: consolidate linked groups ──────────────────────────────────────
  const discordIds = db.queryAll(
    `SELECT DISTINCT discord_user_id AS id FROM linked_accounts
     UNION SELECT DISTINCT discord_user_id AS id FROM account_preferences`
  ).map(r => r.id).filter(Boolean);

  let groupsMerged = 0;
  let groupsSkipped = 0;
  for (const discordId of discordIds) {
    const playerIds = db.getAllPlayerIdsForDiscord(discordId);
    if (playerIds.length <= 1) { groupsSkipped++; continue; }
    if (DRY_RUN) {
      console.log(`[Migrate] (dry) would merge ${playerIds.length} rows for discord ${discordId}`);
      groupsMerged++;
      continue;
    }
    try {
      const result = db.mergeLinkedAccounts(discordId);
      groupsMerged++;
      console.log(`[Migrate] merged discord ${discordId}: ${playerIds.length} rows -> primary #${result.primaryPlayer?.id}`);
    } catch (err) {
      console.error(`[Migrate] FAILED merging discord ${discordId}:`, err.message);
      process.exitCode = 1;
    }
  }
  console.log(`[Migrate] linked groups: ${groupsMerged} merged, ${groupsSkipped} already single-row`);

  // ── Step 2: fold legacy coins into xp ──────────────────────────────────────
  const dirtyRows = db.queryOne('SELECT COUNT(*) AS n FROM players WHERE coins != 0');
  console.log(`[Migrate] rows with legacy coins balance: ${dirtyRows.n}`);
  if (!DRY_RUN) {
    db.run('UPDATE players SET xp = CAST(xp AS INTEGER) + CAST(coins AS INTEGER), coins = 0 WHERE coins != 0');
  }

  // ── Step 3: verify conservation ────────────────────────────────────────────
  const after = sumRow();
  console.log('[Migrate] AFTER   players=%d  xp=%d  coins=%d  gift=%d',
    after.players, Math.floor(after.xp || 0), Math.floor(after.coins || 0), Math.floor(after.gift || 0));

  if (!DRY_RUN) {
    const xpAfter = Math.floor(after.xp || 0);
    const drift = Math.abs(xpAfter - expectedXp);
    // mergeLinkedAccounts casts REAL fractions; allow ±1 per merged group of rounding.
    const tolerance = Math.max(4, groupsMerged * 2 + 4);
    if ((after.coins || 0) !== 0) {
      console.error('[Migrate] ERROR: coins column not fully zeroed!');
      process.exitCode = 1;
    } else if (drift > tolerance) {
      console.error(`[Migrate] ERROR: xp total drifted by ${drift} (expected ~${expectedXp}, got ${xpAfter})`);
      process.exitCode = 1;
    } else {
      console.log(`[Migrate] conservation OK (drift ${drift} <= tolerance ${tolerance})`);
    }
    // db.save() only debounce-schedules on an unref'd timer — a short-lived
    // script exits before it fires. Flush synchronously.
    db.saveImmediate();
    console.log('[Migrate] saved (immediate flush).');

    // Belt-and-braces: re-open the file read-only and confirm the write landed.
    const { DatabaseSync } = require('node:sqlite');
    const check = new DatabaseSync(require('../src/paths').DB_PATH, { readOnly: true });
    const row = check.prepare('SELECT COUNT(*) AS n, SUM(coins) AS coins FROM players').get();
    check.close();
    console.log(`[Migrate] on-disk verify: players=${row.n} coins=${row.coins}`);
    if (Number(row.coins) !== 0) {
      console.error('[Migrate] ERROR: on-disk coins column is not zero — save did not persist!');
      process.exitCode = 1;
    }
  } else {
    console.log('[Migrate] dry run — nothing written.');
  }
  process.exit(process.exitCode || 0);
}

main().catch(err => {
  console.error('[Migrate] fatal:', err);
  process.exit(1);
});
