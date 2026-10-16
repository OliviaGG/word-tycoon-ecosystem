/**
 * Generate high-rarity cosmetics for a specific player.
 * Usage: node tools/generate-rare-cosmetics.js
 *
 * Must stop PM2 first (or run while server is down) since sql.js uses in-memory DB.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Import cosmetics module for generation functions
const cosmetics = require('../src/cosmetics');

// Target: player_id 13 (Jorry)
const PLAYER_ID = 13;
const TARGET_COUNT = 20;
// Distribution: 5 ultra, 7 legendary, 8 epic
const RARITY_TARGETS = { ultra: 5, legendary: 7, epic: 8 };
const DESIRED_RARITIES = new Set(['ultra', 'legendary', 'epic']);

// Use cosmetics module's generateFromSeed
const { generateFromSeed } = cosmetics;

// Generate random 8-char hex seeds and filter for desired rarities
function findRareSeeds() {
  const found = { ultra: [], legendary: [], epic: [] };
  let attempts = 0;

  while (true) {
    const seed = crypto.randomBytes(4).toString('hex'); // 8-char hex
    const result = generateFromSeed(seed);

    if (DESIRED_RARITIES.has(result.rarity) && found[result.rarity].length < RARITY_TARGETS[result.rarity]) {
      found[result.rarity].push(result);
      const totalFound = found.ultra.length + found.legendary.length + found.epic.length;
      console.log(`  [${totalFound}/${TARGET_COUNT}] Found ${result.rarity} ${result.category}: "${result.name}" (seed: ${seed})`);

      if (totalFound >= TARGET_COUNT) break;
    }

    attempts++;
    if (attempts > 500000) {
      console.error('Too many attempts, giving up');
      break;
    }
  }

  console.log(`\nFound all ${TARGET_COUNT} in ${attempts} attempts`);
  return [...found.ultra, ...found.legendary, ...found.epic];
}

// Load and modify the database
async function insertIntoDatabase(items) {
  const initSqlJs = require('sql.js');
  const DB_PATH = path.join(__dirname, '..', 'data', 'word-tycoon.db');

  if (!fs.existsSync(DB_PATH)) {
    console.error('Database not found at', DB_PATH);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // Create generated_cosmetics table if it doesn't exist
  db.run(`CREATE TABLE IF NOT EXISTS generated_cosmetics (
    id TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL,
    seed TEXT NOT NULL,
    category TEXT NOT NULL,
    rarity TEXT NOT NULL,
    name TEXT NOT NULL,
    date_awarded TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE(player_id, date_awarded)
  )`);

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let inserted = 0;

  for (const item of items) {
    try {
      // Use a fake date offset so each item gets a unique date (avoids UNIQUE constraint on player+date)
      const fakeDate = `2026-03-${String(5 + inserted).padStart(2, '0')}`;

      // 1. Insert into generated_cosmetics tracking table
      db.run(
        `INSERT OR IGNORE INTO generated_cosmetics (id, player_id, seed, category, rarity, name, date_awarded)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [item.id, PLAYER_ID, item.seed, item.category, item.rarity, item.name, fakeDate]
      );

      // 2. Insert into cosmetics table so JOINs/rendering work
      db.run(
        `INSERT OR IGNORE INTO cosmetics (id, category, name, description, rarity, cost, css_property, sort_order)
         VALUES (?, ?, ?, ?, ?, 0, ?, 999)`,
        [item.id, item.category, item.name, 'Daily loot box reward', item.rarity, item.cssJson]
      );

      // 3. Grant to player (unequipped)
      db.run(
        `INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped)
         VALUES (?, ?, 0)`,
        [PLAYER_ID, item.id]
      );

      inserted++;
      console.log(`  ✓ Inserted ${item.rarity} ${item.category}: "${item.name}" (${item.id})`);
    } catch (err) {
      console.error(`  ✗ Failed to insert ${item.id}:`, err.message);
    }
  }

  // Save to disk
  const data = db.export();
  const outBuffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, outBuffer);
  console.log(`\nSaved database (${inserted} items inserted, ${outBuffer.length} bytes)`);

  // Verify
  const stmt = db.prepare(
    `SELECT gc.id, gc.rarity, gc.category, gc.name FROM generated_cosmetics gc WHERE gc.player_id = ? ORDER BY gc.rarity, gc.name`
  );
  stmt.bind([PLAYER_ID]);
  console.log(`\nAll generated cosmetics for player ${PLAYER_ID}:`);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    console.log(`  ${row.rarity.padEnd(10)} ${row.category.padEnd(15)} ${row.name}`);
  }
  stmt.free();

  db.close();
}

async function main() {
  console.log(`Generating ${TARGET_COUNT} rare cosmetics for player ${PLAYER_ID} (Jorry)...`);
  console.log(`Target: ${RARITY_TARGETS.ultra} ultra, ${RARITY_TARGETS.legendary} legendary, ${RARITY_TARGETS.epic} epic\n`);

  const items = findRareSeeds();

  console.log('\n--- Generated Items ---');
  for (const item of items) {
    console.log(`[${item.rarity.toUpperCase()}] ${item.category}: "${item.name}" | buff: ${item.buff?.label || 'none'}`);
    // Show a snippet of the CSS
    const cssKeys = Object.keys(item.css);
    console.log(`  CSS keys: ${cssKeys.join(', ')}`);
  }

  console.log('\nInserting into database...');
  await insertIntoDatabase(items);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
