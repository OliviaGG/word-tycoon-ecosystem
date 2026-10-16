const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { createIdentityService } = require('../src/identity');

const MANAGED_SCHEMAS = [
  {
    mainTable: 'pizza_shops',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      shop_name TEXT NOT NULL DEFAULT 'My Pizza Shop',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      shop_level INTEGER NOT NULL DEFAULT 1,
      shop_xp INTEGER NOT NULL DEFAULT 0,
      pizza_coins REAL NOT NULL DEFAULT 0,
      total_pizzas_served INTEGER NOT NULL DEFAULT 0,
      total_coins_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'pizza_upgrades',
    customizationsTable: 'pizza_customizations'
  },
  {
    mainTable: 'newspaper_routes',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      route_name TEXT NOT NULL DEFAULT 'My Paper Route',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      route_level INTEGER NOT NULL DEFAULT 1,
      route_xp INTEGER NOT NULL DEFAULT 0,
      total_papers_delivered INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'newspaper_upgrades',
    customizationsTable: 'newspaper_customizations'
  },
  {
    mainTable: 'carwash_shops',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      shop_name TEXT NOT NULL DEFAULT 'My Car Wash',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      shop_level INTEGER NOT NULL DEFAULT 1,
      shop_xp INTEGER NOT NULL DEFAULT 0,
      clean_cash REAL NOT NULL DEFAULT 0,
      total_cars_washed INTEGER NOT NULL DEFAULT 0,
      total_clean_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'carwash_upgrades',
    customizationsTable: 'carwash_customizations'
  },
  {
    mainTable: 'stockmogul_portfolios',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      portfolio_name TEXT NOT NULL DEFAULT 'My Portfolio',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      portfolio_level INTEGER NOT NULL DEFAULT 1,
      portfolio_xp INTEGER NOT NULL DEFAULT 0,
      portfolio_coins REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      total_coins_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'stockmogul_upgrades',
    customizationsTable: 'stockmogul_customizations'
  },
  {
    mainTable: 'gym_clubs',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      club_name TEXT NOT NULL DEFAULT 'My Gym',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      club_level INTEGER NOT NULL DEFAULT 1,
      club_xp INTEGER NOT NULL DEFAULT 0,
      gym_points REAL NOT NULL DEFAULT 0,
      total_members_trained INTEGER NOT NULL DEFAULT 0,
      total_points_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'gym_upgrades',
    customizationsTable: 'gym_customizations'
  },
  {
    mainTable: 'cinema_theaters',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      theater_name TEXT NOT NULL DEFAULT 'My Cinema',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      theater_level INTEGER NOT NULL DEFAULT 1,
      theater_xp INTEGER NOT NULL DEFAULT 0,
      total_viewers_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'cinema_upgrades',
    customizationsTable: 'cinema_customizations'
  },
  {
    mainTable: 'startup_hubs',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      hub_name TEXT NOT NULL DEFAULT 'My Startup',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      hub_level INTEGER NOT NULL DEFAULT 1,
      hub_xp INTEGER NOT NULL DEFAULT 0,
      total_users_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'startup_upgrades',
    customizationsTable: 'startup_customizations'
  },
  {
    mainTable: 'bank_vaults',
    mainColumns: `
      player_id INTEGER NOT NULL UNIQUE,
      vault_name TEXT NOT NULL DEFAULT 'My Bank',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      vault_level INTEGER NOT NULL DEFAULT 1,
      vault_xp INTEGER NOT NULL DEFAULT 0,
      total_clients_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    `,
    upgradesTable: 'bank_upgrades',
    customizationsTable: 'bank_customizations'
  }
];

async function createDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.exec(`
    CREATE TABLE players (
      id INTEGER PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      profile_pic TEXT,
      coins REAL NOT NULL DEFAULT 0,
      total_taps INTEGER NOT NULL DEFAULT 0,
      tap_power INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      gift_coins REAL NOT NULL DEFAULT 0,
      crit_chance REAL NOT NULL DEFAULT 0,
      multi_tap INTEGER NOT NULL DEFAULT 1,
      library_words INTEGER NOT NULL DEFAULT 0,
      tax_season_completed INTEGER NOT NULL DEFAULT 0,
      tax_season_completed_at TEXT,
      tax_season_trigger_business TEXT,
      tax_season_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      tax_season_reset_reason TEXT
    );

    CREATE TABLE player_businesses (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      business_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, business_type)
    );

    CREATE TABLE player_cosmetics (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      cosmetic_id TEXT NOT NULL,
      equipped INTEGER NOT NULL DEFAULT 0,
      UNIQUE(player_id, cosmetic_id)
    );

    CREATE TABLE cosmetics (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0,
      css_property TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE library_words (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      game TEXT,
      found_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, word)
    );

    CREATE TABLE linked_accounts (
      id INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      discord_username TEXT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      display_name TEXT,
      profile_pic TEXT,
      username TEXT,
      linked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE verification_codes (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      discord_user_id TEXT NOT NULL,
      discord_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE account_preferences (
      discord_user_id TEXT PRIMARY KEY,
      primary_player_id INTEGER,
      preferred_display_name TEXT
    );

    CREATE TABLE player_ledger (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_type TEXT NOT NULL,
      coins_delta REAL NOT NULL DEFAULT 0,
      gift_coins_delta REAL NOT NULL DEFAULT 0,
      command TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE game_wins (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      event TEXT NOT NULL,
      guess_count INTEGER,
      word TEXT,
      coins_awarded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE daily_completions (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      date TEXT NOT NULL,
      coins_awarded REAL NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, game, date)
    );

    CREATE TABLE weekly_completions (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      week_start TEXT NOT NULL,
      coins_awarded REAL NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, game, week_start)
    );

    CREATE TABLE generated_cosmetics (
      id TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL,
      seed TEXT NOT NULL,
      category TEXT NOT NULL,
      rarity TEXT NOT NULL,
      name TEXT NOT NULL,
      date_awarded TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, date_awarded)
    );

    CREATE TABLE tax_season_audit (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      trigger_business TEXT NOT NULL,
      bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      reset_reason TEXT,
      snapshot_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE streak_state (
      discord_user_id TEXT PRIMARY KEY,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      total_claims INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE player_memberships (
      id INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive'
    );

    CREATE TABLE season_definitions (
      id INTEGER PRIMARY KEY,
      season_id TEXT NOT NULL,
      name TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT
    );

    CREATE TABLE season_pass_progress (
      id INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      pass_xp INTEGER NOT NULL DEFAULT 0,
      tier_level INTEGER NOT NULL DEFAULT 1,
      premium_unlocked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE season_pass_claims (
      id INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      lane TEXT NOT NULL
    );
  `);

  for (const schema of MANAGED_SCHEMAS) {
    db.exec(`
      CREATE TABLE ${schema.mainTable} (
        id INTEGER PRIMARY KEY,
        ${schema.mainColumns}
      );
      CREATE TABLE ${schema.upgradesTable} (
        id INTEGER PRIMARY KEY,
        player_id INTEGER NOT NULL,
        upgrade_type TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        UNIQUE(player_id, upgrade_type)
      );
      CREATE TABLE ${schema.customizationsTable} (
        id INTEGER PRIMARY KEY,
        player_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(player_id, category)
      );
    `);
  }

  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql, params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryOne(sql, params = []) {
    return queryAll(sql, params)[0] || null;
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  function recalcLibraryWordCount(playerId) {
    const row = queryOne('SELECT COUNT(*) AS cnt FROM library_words WHERE player_id = ?', [playerId]);
    run('UPDATE players SET library_words = ? WHERE id = ?', [Number(row?.cnt || 0), playerId]);
  }

  const identity = createIdentityService({
    queryOne,
    queryAll,
    run,
    save() {},
    recalcLibraryWordCount
  });

  return { db, identity, queryOne, queryAll, run };
}

test('mergePlayers preserves historical stats and managed business state', async () => {
  const { identity, queryOne, queryAll, run } = await createDb();

  run(
    `INSERT INTO players
      (id, platform, platform_user_id, username, display_name, coins, total_taps, tap_power, last_seen, gift_coins, crit_chance, multi_tap, library_words, tax_season_completed, tax_season_completed_at, tax_season_trigger_business, tax_season_bonus_multiplier, tax_season_reset_reason)
     VALUES
      (1, 'tiktok', 'tt-alpha', 'alpha', 'Alpha', 100, 10, 5, '2026-03-24 10:00:00', 50, 0.10, 2, 1, 0, NULL, NULL, 1.0, NULL),
      (2, 'discord', 'discord_abc', 'alpha_discord', 'Alpha Discord', 200, 20, 7, '2026-03-25 10:00:00', 30, 0.25, 3, 2, 1, '2026-03-24 09:00:00', 'carwash', 1.1, 'first-prestige')`
  );

  run(`INSERT INTO account_preferences (discord_user_id, primary_player_id) VALUES ('abc', 2)`);

  run(
    `INSERT INTO player_businesses (id, player_id, business_type, level, last_collected_at) VALUES
      (11, 1, 'library', 3, '2026-03-24 12:00:00'),
      (12, 2, 'library', 5, '2026-03-23 12:00:00'),
      (13, 2, 'pizza', 8, '2026-03-22 12:00:00')`
  );

  run(
    `INSERT INTO library_words (id, player_id, word, game, found_at) VALUES
      (1, 1, 'alpha', 'searchle', '2026-03-20 00:00:00'),
      (2, 2, 'beta', 'searchle', '2026-03-21 00:00:00'),
      (3, 2, 'alpha', 'searchle', '2026-03-22 00:00:00')`
  );

  run(
    `INSERT INTO player_ledger (id, player_id, player_name, platform, event_type, coins_delta) VALUES
      (1, 2, 'Alpha Discord', 'discord', 'reward', 50)`
  );
  run(
    `INSERT INTO game_wins (id, player_id, game, event, coins_awarded, created_at) VALUES
      (1, 2, 'searchle', 'win', 25, '2026-03-22 00:00:00')`
  );
  run(
    `INSERT INTO tax_season_audit (id, player_id, trigger_business, bonus_multiplier, reset_reason) VALUES
      (1, 2, 'carwash', 1.1, 'first-prestige')`
  );

  run(
    `INSERT INTO daily_completions (id, player_id, game, date, coins_awarded, completed_at) VALUES
      (1, 1, 'wordle', '2026-03-25', 10, '2026-03-25 09:00:00'),
      (2, 2, 'wordle', '2026-03-25', 20, '2026-03-25 08:00:00'),
      (3, 2, 'betweenly', '2026-03-25', 15, '2026-03-25 07:00:00')`
  );
  run(
    `INSERT INTO weekly_completions (id, player_id, game, week_start, coins_awarded, completed_at) VALUES
      (1, 1, 'spelling-bee', '2026-03-23', 10, '2026-03-24 09:00:00'),
      (2, 2, 'spelling-bee', '2026-03-23', 25, '2026-03-24 08:00:00'),
      (3, 2, 'rectangled', '2026-03-23', 30, '2026-03-24 07:00:00')`
  );
  run(
    `INSERT INTO generated_cosmetics (id, player_id, seed, category, rarity, name, date_awarded, created_at) VALUES
      ('gc-keep', 1, 'keep', 'profile_border', 'rare', 'Keep', '2026-03-20', '2026-03-20 01:00:00'),
      ('gc-drop', 2, 'drop', 'profile_border', 'rare', 'Drop', '2026-03-20', '2026-03-20 02:00:00'),
      ('gc-move', 2, 'move', 'hero_badge', 'rare', 'Move', '2026-03-21', '2026-03-21 02:00:00')`
  );

  run(
    `INSERT INTO carwash_shops
      (id, player_id, shop_name, prestige_level, shop_level, shop_xp, clean_cash, total_cars_washed, total_clean_earned, last_collected_at, created_at)
     VALUES
      (1, 1, 'Keep Wash', 1, 20, 50, 100, 10, 1000, '2026-03-24 12:00:00', '2026-03-10 00:00:00'),
      (2, 2, 'Ultra Wash', 2, 25, 80, 200, 30, 3000, '2026-03-23 12:00:00', '2026-03-09 00:00:00')`
  );
  run(
    `INSERT INTO carwash_upgrades (id, player_id, upgrade_type, level) VALUES
      (1, 1, 'soap', 2),
      (2, 2, 'soap', 5),
      (3, 2, 'dryer', 4)`
  );
  run(
    `INSERT INTO carwash_customizations (id, player_id, category, value) VALUES
      (1, 1, 'theme', 'blue'),
      (2, 2, 'theme', 'ultraviolet'),
      (3, 2, 'music', 'nightdrive')`
  );

  run(
    `INSERT INTO newspaper_routes
      (id, player_id, route_name, prestige_level, route_level, route_xp, total_papers_delivered, total_xp_earned, last_collected_at, created_at)
     VALUES
      (1, 2, 'Morning Route', 1, 9, 33, 120, 800, '2026-03-23 11:00:00', '2026-03-08 00:00:00')`
  );
  run(`INSERT INTO newspaper_upgrades (id, player_id, upgrade_type, level) VALUES (1, 2, 'bike', 3)`);
  run(`INSERT INTO newspaper_customizations (id, player_id, category, value) VALUES (1, 2, 'bag', 'red')`);

  const result = identity.mergePlayers(1, 2);
  assert.equal(result.ok, true);

  const mergedPlayer = queryOne('SELECT * FROM players WHERE id = ?', [1]);
  assert.equal(queryOne('SELECT * FROM players WHERE id = ?', [2]), null);
  assert.equal(mergedPlayer.coins, 300);
  assert.equal(mergedPlayer.total_taps, 30);
  assert.equal(mergedPlayer.gift_coins, 80);
  assert.equal(mergedPlayer.tap_power, 7);
  assert.equal(mergedPlayer.crit_chance, 0.25);
  assert.equal(mergedPlayer.multi_tap, 3);
  assert.equal(mergedPlayer.tax_season_completed, 1);
  assert.equal(mergedPlayer.tax_season_bonus_multiplier, 1.1);
  assert.equal(mergedPlayer.tax_season_trigger_business, 'carwash');
  assert.equal(mergedPlayer.last_seen, '2026-03-25 10:00:00');

  const libraryBiz = queryOne('SELECT * FROM player_businesses WHERE player_id = ? AND business_type = ?', [1, 'library']);
  const pizzaBiz = queryOne('SELECT * FROM player_businesses WHERE player_id = ? AND business_type = ?', [1, 'pizza']);
  assert.equal(libraryBiz.level, 5);
  assert.equal(libraryBiz.last_collected_at, '2026-03-23 12:00:00');
  assert.equal(pizzaBiz.level, 8);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM library_words WHERE player_id = ?', [1]).cnt, 2);
  assert.equal(queryOne('SELECT * FROM account_preferences WHERE discord_user_id = ?', ['abc']).primary_player_id, 1);

  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM player_ledger WHERE player_id = ?', [1]).cnt, 1);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM game_wins WHERE player_id = ?', [1]).cnt, 1);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM tax_season_audit WHERE player_id = ?', [1]).cnt, 1);

  const dailyWordle = queryOne('SELECT * FROM daily_completions WHERE player_id = ? AND game = ? AND date = ?', [1, 'wordle', '2026-03-25']);
  const dailyBetweenly = queryOne('SELECT * FROM daily_completions WHERE player_id = ? AND game = ? AND date = ?', [1, 'betweenly', '2026-03-25']);
  assert.equal(dailyWordle.coins_awarded, 20);
  assert.equal(dailyWordle.completed_at, '2026-03-25 08:00:00');
  assert.ok(dailyBetweenly);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM daily_completions WHERE player_id = ?', [2]).cnt, 0);

  const weeklyBee = queryOne('SELECT * FROM weekly_completions WHERE player_id = ? AND game = ? AND week_start = ?', [1, 'spelling-bee', '2026-03-23']);
  const weeklyRectangled = queryOne('SELECT * FROM weekly_completions WHERE player_id = ? AND game = ? AND week_start = ?', [1, 'rectangled', '2026-03-23']);
  assert.equal(weeklyBee.coins_awarded, 25);
  assert.equal(weeklyBee.completed_at, '2026-03-24 08:00:00');
  assert.ok(weeklyRectangled);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM weekly_completions WHERE player_id = ?', [2]).cnt, 0);

  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM generated_cosmetics WHERE player_id = ?', [1]).cnt, 2);
  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM generated_cosmetics WHERE player_id = ?', [2]).cnt, 0);

  const carwash = queryOne('SELECT * FROM carwash_shops WHERE player_id = ?', [1]);
  assert.equal(carwash.shop_name, 'Ultra Wash');
  assert.equal(carwash.prestige_level, 2);
  assert.equal(carwash.shop_level, 25);
  assert.equal(carwash.shop_xp, 80);
  assert.equal(carwash.clean_cash, 300);
  assert.equal(carwash.total_cars_washed, 40);
  assert.equal(carwash.total_clean_earned, 4000);
  assert.equal(carwash.last_collected_at, '2026-03-23 12:00:00');
  assert.equal(carwash.created_at, '2026-03-09 00:00:00');
  assert.equal(queryOne('SELECT * FROM carwash_upgrades WHERE player_id = ? AND upgrade_type = ?', [1, 'soap']).level, 5);
  assert.equal(queryOne('SELECT * FROM carwash_upgrades WHERE player_id = ? AND upgrade_type = ?', [1, 'dryer']).level, 4);
  assert.equal(queryOne('SELECT * FROM carwash_customizations WHERE player_id = ? AND category = ?', [1, 'theme']).value, 'ultraviolet');
  assert.equal(queryOne('SELECT * FROM carwash_customizations WHERE player_id = ? AND category = ?', [1, 'music']).value, 'nightdrive');

  const newspaper = queryOne('SELECT * FROM newspaper_routes WHERE player_id = ?', [1]);
  assert.equal(newspaper.route_name, 'Morning Route');
  assert.equal(newspaper.route_level, 9);
  assert.equal(queryOne('SELECT * FROM newspaper_upgrades WHERE player_id = ? AND upgrade_type = ?', [1, 'bike']).level, 3);
  assert.equal(queryOne('SELECT * FROM newspaper_customizations WHERE player_id = ? AND category = ?', [1, 'bag']).value, 'red');

  for (const schema of MANAGED_SCHEMAS) {
    assert.equal(queryOne(`SELECT COUNT(*) AS cnt FROM ${schema.mainTable} WHERE player_id = ?`, [2]).cnt, 0);
    assert.equal(queryOne(`SELECT COUNT(*) AS cnt FROM ${schema.upgradesTable} WHERE player_id = ?`, [2]).cnt, 0);
    assert.equal(queryOne(`SELECT COUNT(*) AS cnt FROM ${schema.customizationsTable} WHERE player_id = ?`, [2]).cnt, 0);
  }
});

test('mergePlayers deduplicates same-round game wins but preserves distinct rounds', async () => {
  const { identity, queryOne, queryAll, run } = await createDb();

  run(
    `INSERT INTO players
      (id, platform, platform_user_id, username, display_name, coins, total_taps)
     VALUES
      (1, 'tiktok', 'tt-alpha', 'alpha', 'Alpha', 100, 10),
      (2, 'discord', 'discord_alpha', 'alpha_discord', 'Alpha Discord', 50, 5)`
  );

  run(
    `INSERT INTO game_wins (id, player_id, game, event, guess_count, word, coins_awarded, created_at) VALUES
      (1, 1, 'rectangled', 'win', 4, 'crate', 25, '2026-03-25 10:00:00'),
      (2, 2, 'squaredle', 'win', 4, 'crate', 25, '2026-03-25 10:00:03'),
      (3, 2, 'searchle', 'win', 3, 'sonic', 50, '2026-03-25 10:00:20'),
      (4, 1, 'searchle', 'win', 3, 'sonic', 50, '2026-03-25 10:01:00')`
  );

  const result = identity.mergePlayers(1, 2);
  assert.equal(result.ok, true);

  const mergedWins = queryAll(
    'SELECT game, event, guess_count, word, coins_awarded, created_at FROM game_wins WHERE player_id = ? ORDER BY created_at ASC',
    [1]
  );

  assert.equal(mergedWins.length, 3);
  assert.deepEqual(
    mergedWins.map(row => ({
      game: row.game,
      event: row.event,
      guess_count: row.guess_count,
      word: row.word,
      coins_awarded: row.coins_awarded,
      created_at: row.created_at
    })),
    [
      {
        game: 'rectangled',
        event: 'win',
        guess_count: 4,
        word: 'crate',
        coins_awarded: 25,
        created_at: '2026-03-25 10:00:00'
      },
      {
        game: 'searchle',
        event: 'win',
        guess_count: 3,
        word: 'sonic',
        coins_awarded: 50,
        created_at: '2026-03-25 10:00:20'
      },
      {
        game: 'searchle',
        event: 'win',
        guess_count: 3,
        word: 'sonic',
        coins_awarded: 50,
        created_at: '2026-03-25 10:01:00'
      }
    ]
  );

  assert.equal(queryOne('SELECT COUNT(*) AS cnt FROM game_wins WHERE player_id = ?', [2]).cnt, 0);
});

test('account overview sums linked stats and resolves discord_ mobile ids', async () => {
  const { identity, run } = await createDb();

  run(
    `INSERT INTO players
      (id, platform, platform_user_id, username, display_name, coins, total_taps, tap_power, last_seen, gift_coins, crit_chance, multi_tap, library_words)
     VALUES
      (1, 'tiktok', 'tt-alpha', 'alpha_tt', 'Alpha TikTok', 100, 10, 5, '2026-03-24 10:00:00', 50, 0.10, 2, 4),
      (2, 'youtube', 'yt-alpha', 'alpha_yt', 'Alpha YouTube', 200, 20, 7, '2026-03-25 11:00:00', 25, 0.25, 3, 6),
      (3, 'mobile', 'discord_abc', 'alpha_mobile', 'Alpha Mobile', 30, 5, 4, '2026-03-23 09:00:00', 10, 0.05, 1, 2)`
  );
  run(
    `INSERT INTO linked_accounts (id, discord_user_id, discord_username, platform, platform_user_id, linked_at) VALUES
      (1, 'abc', '.alpha', 'tiktok', 'tt-alpha', '2026-03-20 00:00:00'),
      (2, 'abc', '.alpha', 'youtube', 'yt-alpha', '2026-03-21 00:00:00')`
  );
  run(`INSERT INTO account_preferences (discord_user_id, primary_player_id, preferred_display_name) VALUES ('abc', 1, 'Alpha Prime')`);
  run(
    `INSERT INTO game_wins (id, player_id, game, event, coins_awarded, created_at) VALUES
      (1, 1, 'searchle', 'win', 25, '2026-03-21 00:00:00'),
      (2, 2, 'wordle', 'win', 25, '2026-03-22 00:00:00'),
      (3, 3, 'rectangled', 'win', 25, '2026-03-23 00:00:00')`
  );

  const idsFromMobile = identity.getAllPlayerIdsForDiscord('abc').sort((a, b) => a - b);
  assert.deepEqual(idsFromMobile, [1, 2, 3]);

  const overview = identity.getAccountOverview('abc');
  assert.ok(overview.primaryPlayer);
  assert.equal(overview.primaryPlayer.display_name, 'Alpha Prime');
  assert.equal(overview.primaryPlayer.coins, 330);
  assert.equal(overview.primaryPlayer.total_taps, 35);
  assert.equal(overview.primaryPlayer.gift_coins, 85);
  assert.equal(overview.primaryPlayer.library_words, 12);
  assert.equal(overview.primaryPlayer.tap_power, 7);
  assert.equal(overview.primaryPlayer.crit_chance, 0.25);
  assert.equal(overview.primaryPlayer.multi_tap, 3);
  assert.equal(overview.primaryPlayer.total_game_wins, 3);
  assert.equal(overview.primaryPlayer.last_seen, '2026-03-25 11:00:00');

  const group = identity.getLinkedGroups().find((entry) => entry.discordUserId === 'abc');
  assert.ok(group);
  assert.equal(group.coins, 330);
  assert.equal(group.displayName, 'Alpha Prime');
});

test('account overview includes username-keyed web sidecars even when linked accounts exist', async () => {
  const { identity, run } = await createDb();

  run(
    `INSERT INTO players
      (id, platform, platform_user_id, username, display_name, coins, total_taps, tap_power, last_seen, gift_coins, crit_chance, multi_tap, library_words)
     VALUES
      (1, 'tiktok', 'tt-sidecar', 'sidecar_tt', 'StreamerPrime', 100, 10, 2, '2026-03-24 10:00:00', 5, 0.05, 1, 4),
      (2, 'discord', 'abc', 'abc', 'dayu573', 20, 5, 1, '2026-03-24 11:00:00', 0, 0.00, 1, 1),
      (3, 'web', 'dayu573', 'dayu573', 'dayu573', 30, 7, 1, '2026-03-24 12:00:00', 0, 0.00, 1, 2)`
  );
  run(
    `INSERT INTO linked_accounts (id, discord_user_id, discord_username, platform, platform_user_id, linked_at) VALUES
      (1, 'abc', '.abc', 'tiktok', 'tt-sidecar', '2026-03-20 00:00:00')`
  );
  run(`INSERT INTO account_preferences (discord_user_id, primary_player_id, preferred_display_name) VALUES ('abc', 1, 'StreamerPrime')`);
  run(
    `INSERT INTO game_wins (id, player_id, game, event, coins_awarded, created_at) VALUES
      (1, 1, 'searchle', 'win', 25, '2026-03-21 00:00:00'),
      (2, 2, 'wordle', 'win', 25, '2026-03-22 00:00:00'),
      (3, 3, 'rectangled', 'win', 25, '2026-03-23 00:00:00')`
  );

  const ids = identity.getAllPlayerIdsForDiscord('abc').sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3]);

  const overview = identity.getAccountOverview('abc');
  assert.equal(overview.primaryPlayer.total_game_wins, 3);
  assert.equal(overview.primaryPlayer.coins, 150);
  assert.equal(overview.primaryPlayer.total_taps, 22);
  assert.equal(overview.totalLibraryWords, 7);
});

test('discardDiscordPlayer fails closed and does not delete the player row', async () => {
  const { identity, queryOne, run } = await createDb();

  run(
    `INSERT INTO players
      (id, platform, platform_user_id, username, display_name, coins, total_taps)
     VALUES
      (9, 'mobile', 'discord_blocked', 'blocked', 'Blocked Player', 123, 45)`
  );

  const result = identity.discardDiscordPlayer(9);
  assert.equal(result.ok, false);
  assert.match(result.message, /disabled for safety/i);
  assert.ok(queryOne('SELECT * FROM players WHERE id = ?', [9]));
});
