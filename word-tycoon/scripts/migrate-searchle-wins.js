#!/usr/bin/env node
/**
 * Migrate Searchle win-history.json entries into Word Tycoon game_wins table.
 *
 * Usage: node scripts/migrate-searchle-wins.js /path/to/win-history.json
 *
 * For each entry in win-history.json:
 *   1. getOrCreatePlayer() to ensure player exists
 *   2. Resolve the player's linked identity set
 *   3. Check if that exact historical win already exists for any linked row
 *   3. If not, INSERT into game_wins with the original timestamp
 *
 * Safe to run multiple times — skips duplicates by exact canonical win identity
 * (linked account set + word + guessCount + created_at).
 */

const path = require('path');
const fs = require('fs');

// Load Word Tycoon database module
const db = require(path.join(__dirname, '..', 'src', 'database.js'));

const WIN_HISTORY_PATH = process.argv[2];
if (!WIN_HISTORY_PATH || !fs.existsSync(WIN_HISTORY_PATH)) {
  console.error('Usage: node scripts/migrate-searchle-wins.js <path-to-win-history.json>');
  process.exit(1);
}

// Wait for database to initialize
async function main() {
  await db.initialize();

  const raw = JSON.parse(fs.readFileSync(WIN_HISTORY_PATH, 'utf-8'));
  console.log(`[Migrate] Loaded ${raw.length} entries from win-history.json`);

  const existingWins = db.queryAll(
    `SELECT id, player_id, LOWER(word) as word, guess_count, created_at
     FROM game_wins
     WHERE game = 'searchle' AND word IS NOT NULL`,
    []
  );
  console.log(`[Migrate] ${existingWins.length} existing searchle wins in game_wins`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of raw) {
    const { user, word, guessCount, timestamp } = entry;
    const wordLower = (word || '').toLowerCase();

    try {
      // Find or create the player
      const platform = user.platform || 'tiktok';
      const platformUserId = user.platformUserId || user.id;
      const username = user.username || user.displayName || platformUserId;
      const displayName = user.displayName || username;
      const profilePic = user.profilePic || null;

      const player = db.getOrCreatePlayer(platform, platformUserId, username, displayName, profilePic);
      if (!player) {
        console.error(`  [ERROR] Could not create player for ${platform}/${platformUserId}`);
        errors++;
        continue;
      }

      // Convert ISO timestamp to SQLite datetime format
      // "2026-02-23T20:56:00.831Z" → "2026-02-23 20:56:00"
      const ts = timestamp ? timestamp.replace('T', ' ').replace(/\.\d+Z$/, '') : null;

      // Resolve all linked player ids for duplicate detection
      let candidatePlayerIds = [player.id];
      const discordUserId = db.getDiscordUserForPlatform(platform, platformUserId);
      if (discordUserId) {
        const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
        if (allIds && allIds.length > 0) candidatePlayerIds = allIds;
      }

      const placeholders = candidatePlayerIds.map(() => '?').join(',');
      const existing = db.queryOne(
        `SELECT id FROM game_wins
         WHERE game = 'searchle'
           AND player_id IN (${placeholders})
           AND LOWER(word) = ?
           AND ((guess_count IS NULL AND ? IS NULL) OR guess_count = ?)
           AND created_at = ?
         LIMIT 1`,
        [...candidatePlayerIds, wordLower, guessCount ?? null, guessCount ?? null, ts]
      );
      if (existing) {
        skipped++;
        continue;
      }

      // Insert into game_wins with original timestamp
      db.run(
        `INSERT INTO game_wins (player_id, game, event, guess_count, word, coins_awarded, created_at)
         VALUES (?, 'searchle', 'win', ?, ?, 0, ?)`,
        [player.id, Number.isFinite(guessCount) ? guessCount : null, word || null, ts || "datetime('now')"]
      );
      imported++;

      if (imported % 50 === 0) {
        console.log(`  ... imported ${imported} so far`);
      }
    } catch (err) {
      console.error(`  [ERROR] ${word}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n[Migrate] Done!`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total game_wins for searchle now: ${skipped + imported}`);

  // Verify
  const finalCount = db.queryOne("SELECT COUNT(*) as c FROM game_wins WHERE game = 'searchle'", []);
  const uniqueWords = db.queryOne("SELECT COUNT(DISTINCT LOWER(word)) as c FROM game_wins WHERE game = 'searchle' AND word IS NOT NULL", []);
  console.log(`\n[Verify] game_wins rows for searchle: ${finalCount.c}`);
  console.log(`[Verify] Unique words: ${uniqueWords.c}`);

  // Save database to disk
  db.save();
  console.log(`[Migrate] Database saved to disk`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
