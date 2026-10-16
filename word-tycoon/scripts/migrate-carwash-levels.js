/**
 * Migration: Unify Car Wash business level with Car Wash management shop level
 *
 * For every player whose carwash business level is > 1:
 *   - Compute total XP equivalent to their business level using the same
 *     xpForLevel formula as the management system
 *   - Add that XP to their carwash_shops.shop_xp (creating the row if missing)
 *   - Run the level-up loop to recalculate shop_level / shop_xp
 *   - Reset player_businesses.level = 1 for carwash
 *
 * Usage: node scripts/migrate-carwash-levels.js [--dry-run]
 */

'use strict';

const database = require('../src/database');

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_SHOP_LEVEL = 100;

// Mirror of carwash-config.js xpForLevel (prestige 0 for all pre-existing players)
function xpForLevel(level, prestigeLevel) {
  const base = Math.floor(100 * Math.pow(1.08, level));
  const pMult = (prestigeLevel || 0) > 1 ? Math.pow(2, (prestigeLevel || 0) - 1) : 1;
  return Math.floor(base * pMult);
}

// Total XP to go from shop_level 1 to shop_level targetLevel
function totalXpForLevel(targetLevel, prestigeLevel) {
  let total = 0;
  for (let l = 1; l < targetLevel; l++) {
    total += xpForLevel(l, prestigeLevel || 0);
  }
  return total;
}

// Given a starting level/xp, add bonusXp and run the level-up loop
function applyXp(startLevel, startXp, bonusXp, prestige) {
  let level = startLevel;
  let xp = startXp + bonusXp;
  while (level < MAX_SHOP_LEVEL) {
    const needed = xpForLevel(level, prestige);
    if (xp >= needed) {
      xp -= needed;
      level++;
    } else {
      break;
    }
  }
  if (level >= MAX_SHOP_LEVEL) xp = 0;
  return { level, xp };
}

async function run() {
  console.log(`\n=== Car Wash Level Migration ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  await database.initialize();

  // Get all carwash businesses with level > 1
  const cwBizRows = database.queryAll(
    `SELECT pb.id as biz_id, pb.player_id, pb.level as biz_level
     FROM player_businesses pb
     WHERE pb.business_type = 'carwash' AND pb.level > 1`
  );

  console.log(`Found ${cwBizRows.length} players with carwash business level > 1\n`);

  let migrated = 0;
  let created = 0;

  for (const row of cwBizRows) {
    const playerId = row.player_id;
    const bizLevel = row.biz_level;

    // Look up existing carwash_shops row
    const shop = database.queryOne(
      `SELECT id, shop_level, shop_xp, prestige_level FROM carwash_shops WHERE player_id = ?`,
      [playerId]
    );

    const prestige = shop ? (shop.prestige_level || 0) : 0;
    const currentShopLevel = shop ? (shop.shop_level || 1) : 1;
    const currentShopXp = shop ? (shop.shop_xp || 0) : 0;

    // Compute XP bonus from the old business level
    const bonusXp = totalXpForLevel(bizLevel, prestige);

    // Apply bonus XP with level-up loop
    const result = applyXp(currentShopLevel, currentShopXp, bonusXp, prestige);

    const tag = !shop ? ' [new shop row]' : '';
    console.log(
      `Player ${String(playerId).padStart(5)}: biz_level=${String(bizLevel).padStart(3)}` +
      `  bonus_xp=${String(bonusXp).padStart(8)}` +
      `  shop ${currentShopLevel}→${result.level} (xp ${currentShopXp}→${result.xp})${tag}`
    );

    if (!DRY_RUN) {
      if (shop) {
        database.run(
          `UPDATE carwash_shops SET shop_level = ?, shop_xp = ? WHERE player_id = ?`,
          [result.level, result.xp, playerId]
        );
      } else {
        database.run(
          `INSERT INTO carwash_shops
             (player_id, shop_name, prestige_level, shop_level, shop_xp,
              clean_cash, total_cars_washed, total_clean_earned, last_collected_at, created_at)
           VALUES (?, 'My Car Wash', 0, ?, ?, 0, 0, 0, datetime('now'), datetime('now'))`,
          [playerId, result.level, result.xp]
        );
        created++;
      }

      // Reset business level to 1
      database.run(
        `UPDATE player_businesses SET level = 1 WHERE id = ?`,
        [row.biz_id]
      );

      migrated++;
    } else {
      migrated++;
      if (!shop) created++;
    }
  }

  if (!DRY_RUN && migrated > 0) {
    database.save();
    console.log(`\n✅ Database saved.`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Players migrated : ${migrated}`);
  console.log(`  Shop rows created: ${created}`);
  if (DRY_RUN) console.log(`\n[DRY RUN] No changes written. Re-run without --dry-run to apply.`);
  console.log('');
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
