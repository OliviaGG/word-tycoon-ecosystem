/**
 * Backfill missing game wins from local win-history files into the player_ledger.
 *
 * For each player+game combo, compares local win count vs ledger count.
 * If local > ledger, inserts the difference using timestamps from the
 * most recent local wins that don't have ledger matches.
 *
 * Usage: node tools/backfill-wins.js [--dry-run]
 */

const fs = require('fs');
const db = require('../src/database');

const DRY_RUN = process.argv.includes('--dry-run');

const GAME_SOURCES = [
  {
    game: 'searchle',
    file: '/opt/searchle/data/win-history.json',
    getWinner: (entry) => entry.user,
    getTimestamp: (entry) => entry.timestamp || (entry.date ? new Date(entry.date).getTime() : null),
  },
  {
    game: 'word500',
    file: '/opt/word500/data/win-history.json',
    getWinner: (entry) => entry.winner,
    getTimestamp: (entry) => entry.timestamp,
  },
  {
    game: 'betweenly',
    file: '/opt/betweenly/data/history.json',
    getWinner: (entry) => entry.winner,
    getTimestamp: (entry) => entry.timestamp,
  },
  {
    game: 'wordle',
    file: '/opt/wordle/data/history.json',
    getWinner: (entry) => entry.winner,
    getTimestamp: (entry) => entry.timestamp,
  },
];

function readJsonFile(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.log(`  ⚠ Could not read ${filepath}: ${e.message}`);
    return null;
  }
}

function buildPlayerLookup() {
  const players = db.queryAll('SELECT id, platform, platform_user_id, display_name FROM players');
  const lookup = {};
  for (const p of players) {
    if (p.platform && p.platform_user_id) {
      lookup[`${p.platform}:${p.platform_user_id}`] = p.id;
    }
  }
  return lookup;
}

function resolvePlayerId(winner, playerLookup) {
  if (!winner) return null;
  const platform = winner.platform;
  const platformUserId = winner.platformUserId || winner.id;

  if (platform && platformUserId) {
    const key = `${platform}:${platformUserId}`;
    if (playerLookup[key]) return playerLookup[key];
  }

  if (winner.id) {
    for (const prefix of ['tiktok', 'youtube', 'discord', 'mobile']) {
      const key = `${prefix}:${winner.id}`;
      if (playerLookup[key]) return playerLookup[key];
    }
  }

  return null;
}

function buildLedgerCounts() {
  const rows = db.queryAll(
    "SELECT player_id, detail FROM player_ledger WHERE event_type = 'reward' AND detail IS NOT NULL"
  );
  const counts = {}; // "playerId:game" → count
  for (const row of rows) {
    try {
      const d = JSON.parse(row.detail);
      if (!d.game || d.game === 'admin') continue;
      const key = `${row.player_id}:${d.game}`;
      counts[key] = (counts[key] || 0) + 1;
    } catch {}
  }
  return counts;
}

function formatTs(ms) {
  if (!ms) return new Date().toISOString().replace('T', ' ').slice(0, 19);
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

(async () => {
  await db.initialize();
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : '🔧 LIVE RUN — will insert missing entries\n');

  const playerLookup = buildPlayerLookup();
  const ledgerCounts = buildLedgerCounts();

  let totalInserted = 0;
  let totalUnresolved = 0;

  for (const source of GAME_SOURCES) {
    console.log(`━━━ ${source.game.toUpperCase()} ━━━`);

    const data = readJsonFile(source.file);
    if (!data || !Array.isArray(data)) {
      console.log('  Skipped (no data)\n');
      continue;
    }

    // Count local wins per player
    const localWins = {}; // playerId → [{timestamp}, ...]
    let unresolved = 0;

    for (const entry of data) {
      const winner = source.getWinner(entry);
      const timestamp = source.getTimestamp(entry);
      const playerId = resolvePlayerId(winner, playerLookup);

      if (!playerId) {
        unresolved++;
        continue;
      }

      if (!localWins[playerId]) localWins[playerId] = [];
      localWins[playerId].push({ timestamp });
    }

    // Compare and backfill
    let gameInserted = 0;
    const playerDetails = [];

    for (const [playerId, wins] of Object.entries(localWins)) {
      const ledgerKey = `${playerId}:${source.game}`;
      const ledgerCount = ledgerCounts[ledgerKey] || 0;
      const localCount = wins.length;
      const missing = localCount - ledgerCount;

      if (missing <= 0) continue;

      const playerName = db.queryOne('SELECT display_name FROM players WHERE id = ?', [parseInt(playerId)]);
      playerDetails.push(`    ${playerName ? playerName.display_name : playerId}: ${ledgerCount} → ${localCount} (+${missing})`);

      // Insert the missing entries using timestamps from the most recent wins
      // Sort wins by timestamp descending and take the last N (most recent missing)
      const sorted = wins.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const toInsert = sorted.slice(0, missing);

      for (const win of toInsert) {
        if (!DRY_RUN) {
          const createdAt = formatTs(win.timestamp);
          const playerRow = db.queryOne('SELECT display_name, platform FROM players WHERE id = ?', [parseInt(playerId)]);
          const detail = JSON.stringify({
            game: source.game,
            event: 'win',
            backfilled: true,
            baseCoins: 0,
            boostedCoins: 0,
          });
          db.run(
            `INSERT INTO player_ledger (player_id, player_name, platform, event_type, command, coins_before, coins_after, coins_delta, success, detail, created_at)
             VALUES (?, ?, ?, 'reward', NULL, 0, 0, 0, 1, ?, ?)`,
            [parseInt(playerId), playerRow?.display_name || 'Unknown', playerRow?.platform || 'unknown', detail, createdAt]
          );
        }
        gameInserted++;
      }

      // Update ledger counts for future iterations
      ledgerCounts[ledgerKey] = localCount;
    }

    const currentLedger = Object.entries(ledgerCounts)
      .filter(([k]) => k.endsWith(`:${source.game}`))
      .reduce((sum, [, v]) => sum + v, 0);

    console.log(`  Local: ${data.length} | Ledger before: ${currentLedger - gameInserted} | Inserting: ${gameInserted} | Unresolved: ${unresolved}`);
    if (playerDetails.length > 0) {
      console.log('  Per-player changes:');
      for (const d of playerDetails) console.log(d);
    }
    console.log('');

    totalInserted += gameInserted;
    totalUnresolved += unresolved;
  }

  console.log('━━━ SUMMARY ━━━');
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total unresolved players: ${totalUnresolved}`);

  if (!DRY_RUN && totalInserted > 0) {
    db.save();
    console.log('\n💾 Database saved');
  }

  process.exit(0);
})();
