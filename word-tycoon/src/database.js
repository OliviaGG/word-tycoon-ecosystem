const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { createIdentityService } = require('./identity');
const { createLibraryService } = require('./library');
const { canonicalGameId, getCanonicalGameVariants, STAT_GAME_KEYS } = require('./game-ids');
const { pickSafeName } = require('./username-moderation');
const ledgerArchive = require('./ledger-archive');
const { writeFileAtomicSync, writeFileDurableSync, removeIfExists, writeFileAtomic } = require('./atomic-write');
const { DB_PATH } = require('./paths');

let db = null;
let saveCounter = 0;
let transactionDepth = 0;
let pendingSave = false;
let saveTimer = null;
let saveDirty = false;
let lastSaveStats = null;
let saveInProgress = false;
const VERIFIED_SAVE_INTERVAL = 50; // Read-back less often to reduce export spikes under load
const DB_SAVE_DEBOUNCE_MS = parseInt(process.env.DB_SAVE_DEBOUNCE_MS || '3000', 10);
const DB_STARTUP_COMPACT_THRESHOLD_MB = parseFloat(process.env.DB_STARTUP_COMPACT_THRESHOLD_MB || '16');
const SAVE_OBSERVABILITY_RSS_MB = parseInt(process.env.DB_SAVE_OBSERVABILITY_RSS_MB || '350', 10);
const SAVE_OBSERVABILITY_MS = parseInt(process.env.DB_SAVE_OBSERVABILITY_MS || '250', 10);
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');
const MANAGED_BUSINESS_LEVEL_CONFIG = {
  pizza: { table: 'pizza_shops', levelColumn: 'shop_level' },
  newspaper: { table: 'newspaper_routes', levelColumn: 'route_level' },
  carwash: { table: 'carwash_shops', levelColumn: 'shop_level' },
  stockmogul: { table: 'stockmogul_portfolios', levelColumn: 'portfolio_level' },
  gym: { table: 'gym_clubs', levelColumn: 'club_level' },
  cinema: { table: 'cinema_theaters', levelColumn: 'theater_level' },
  startup: { table: 'startup_hubs', levelColumn: 'hub_level' },
  bank: { table: 'bank_vaults', levelColumn: 'vault_level' }
};

// --- sql.js WASM corruption watchdog ---
// sql.js keeps the whole DB in a WASM heap that can degrade over long uptime.
// Once corrupted, every query throws "memory access out of bounds" and the
// service stays silently dead until a manual restart. Detect it at the DB
// choke point, persist what we can, and exit so PM2 restarts us clean.
function _installCorruptionWatchdog(instance) {
  const bail = (err) => {
    console.error('[DB] sql.js WASM heap corrupted — persisting and exiting for PM2 restart:', err && err.message);
    try { save(); } catch (_) {}
    setTimeout(() => process.exit(1), 1500);
  };
  const guard = (fn) => function (...args) {
    try { return fn.apply(this, args); }
    catch (err) {
      if (err && /memory access out of bounds/i.test(String(err.message || err))) bail(err);
      throw err;
    }
  };
  instance.exec = guard(instance.exec.bind(instance));
  instance.run = guard(instance.run.bind(instance));
  const origPrepare = instance.prepare.bind(instance);
  instance.prepare = guard(function (...args) {
    const stmt = origPrepare(...args);
    if (stmt) {
      stmt.bind = guard(stmt.bind.bind(stmt));
      stmt.step = guard(stmt.step.bind(stmt));
      stmt.getAsObject = guard(stmt.getAsObject.bind(stmt));
      stmt.run = guard(stmt.run.bind(stmt));
    }
    return stmt;
  });
  return instance;
}

async function initialize() {
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = _installCorruptionWatchdog(new SQL.Database(buffer));
  } else {
    db = _installCorruptionWatchdog(new SQL.Database());
  }

  await ledgerArchive.initialize();

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      coins REAL NOT NULL DEFAULT 0,
      xp REAL NOT NULL DEFAULT 0,
      word_game_xp REAL NOT NULL DEFAULT 0,
      total_taps INTEGER NOT NULL DEFAULT 0,
      tap_power INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, platform_user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tax_season_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      trigger_business TEXT NOT NULL,
      bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      reset_reason TEXT,
      snapshot_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_tax_season_audit_player ON tax_season_audit(player_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tax_season_audit_created_at ON tax_season_audit(created_at)');

  db.run(`
    CREATE TABLE IF NOT EXISTS player_businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      business_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id),
      UNIQUE(player_id, business_type)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stream_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      total_taps INTEGER NOT NULL DEFAULT 0,
      total_coins_earned REAL NOT NULL DEFAULT 0,
      unique_players INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      player_name TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cosmetics (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      rarity TEXT NOT NULL,
      cost INTEGER NOT NULL,
      css_property TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS player_cosmetics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      cosmetic_id TEXT NOT NULL,
      equipped INTEGER NOT NULL DEFAULT 0,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (cosmetic_id) REFERENCES cosmetics(id),
      UNIQUE(player_id, cosmetic_id)
    )
  `);

  // Idempotency record: which one-off cosmetic grants have already fired for a player
  // (e.g. 'tiktok_fc' for the TikTok Fan Club bundle). Prevents re-granting on every chat msg.
  db.run(`
    CREATE TABLE IF NOT EXISTS player_cosmetic_grants (
      player_id INTEGER NOT NULL,
      grant_key TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT,
      PRIMARY KEY (player_id, grant_key),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Pending grant queue: holds cosmetic grants destined for a platform user
  // who has not yet linked a Word Tycoon account. Drained on link.
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_cosmetic_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      grant_key TEXT NOT NULL,
      source TEXT,
      queued_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, platform_user_id, grant_key)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_pending_grants_platform_user ON pending_cosmetic_grants(platform, platform_user_id)');

  // Account linking tables
  db.run(`
    CREATE TABLE IF NOT EXISTS linked_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      discord_username TEXT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(discord_user_id, platform, platform_user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discord_user_id TEXT NOT NULL,
      discord_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Account preferences table (for unified account management)
  db.run(`
    CREATE TABLE IF NOT EXISTS account_preferences (
      discord_user_id TEXT PRIMARY KEY,
      preferred_pfp_platform TEXT,
      preferred_profile_logo_id TEXT,
      preferred_display_name TEXT,
      primary_player_id INTEGER,
      merged_at TEXT,
      FOREIGN KEY (primary_player_id) REFERENCES players(id)
    )
  `);

  // Word Foundry uses its own server-authoritative economy. The account key is
  // resolved by Chat Relay from the signed-in session; browser-provided player
  // identifiers never reach this table.
  db.run(`
    CREATE TABLE IF NOT EXISTS word_foundry_states (
      account_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      last_action_id TEXT,
      last_action_result TEXT
    )
  `);

  db.run(`CREATE TABLE IF NOT EXISTS word_foundry_actions (
    account_id TEXT NOT NULL, action_id TEXT NOT NULL, request_hash TEXT,
    result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, action_id))`);
  db.run('CREATE INDEX IF NOT EXISTS word_foundry_actions_period ON word_foundry_actions(account_id, created_at)');
  db.run(`INSERT OR IGNORE INTO word_foundry_actions(account_id, action_id, request_hash, result_json, created_at)
    SELECT account_id, last_action_id, NULL, last_action_result, updated_at
    FROM word_foundry_states WHERE last_action_id IS NOT NULL AND last_action_result IS NOT NULL`);

  db.run(`
    CREATE TABLE IF NOT EXISTS account_profile_logos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      logo_id TEXT NOT NULL,
      source TEXT,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(discord_user_id, logo_id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_account_profile_logos_user ON account_profile_logos(discord_user_id)');

  // account_emails — verified email per (platform, platform_user_id), used for
  // auto-linking accounts that share the same verified email across providers.
  db.run(`
    CREATE TABLE IF NOT EXISTS account_emails (
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      verified_email TEXT NOT NULL,
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, platform_user_id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_account_emails_email ON account_emails(verified_email)');

  // link_declined — remembers "Keep separate" decisions from the link-confirm
  // page so we don't re-prompt every login.
  db.run(`
    CREATE TABLE IF NOT EXISTS link_declined (
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      declined_anchor TEXT NOT NULL,
      declined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, platform_user_id, declined_anchor)
    )
  `);

  // Add preferred_profile_logo_id column (migration — safe to re-run)
  try { db.run('ALTER TABLE account_preferences ADD COLUMN preferred_profile_logo_id TEXT'); } catch (e) {}
  // Add cosmetic_visibility column (migration — safe to re-run)
  try { db.run('ALTER TABLE account_preferences ADD COLUMN cosmetic_visibility TEXT'); } catch (e) {}
  // Add custom_avatar_url column (migration — safe to re-run)
  try { db.run('ALTER TABLE account_preferences ADD COLUMN custom_avatar_url TEXT'); } catch (e) {}
  // Add game_help_seen column (migration — safe to re-run)
  try { db.run('ALTER TABLE account_preferences ADD COLUMN game_help_seen TEXT'); } catch (e) {}
  // TycoonIO city preferences (migration — safe to re-run)
  try { db.run('ALTER TABLE account_preferences ADD COLUMN city_layout TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE account_preferences ADD COLUMN city_decorations TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE account_preferences ADD COLUMN city_building_style TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE account_preferences ADD COLUMN city_district TEXT'); } catch (e) {}
  try { db.run('ALTER TABLE account_preferences ADD COLUMN city_sign_text TEXT'); } catch (e) {}
  // Per-item "seen in the wardrobe" flag (migration — safe to re-run).
  // Backfill runs ONLY when the ALTER succeeds (first boot with this code):
  // pre-existing items count as already seen so the whole collection doesn't
  // light up as NEW; anything acquired afterwards defaults to unseen.
  try {
    db.run('ALTER TABLE player_cosmetics ADD COLUMN seen INTEGER DEFAULT 0');
    db.run('UPDATE player_cosmetics SET seen = 1');
  } catch (e) {}

  // Player ledger for permanent audit trail (NOT pruned like event_log)
  db.run(`
    CREATE TABLE IF NOT EXISTS player_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_type TEXT NOT NULL,
      command TEXT,
      coins_before REAL NOT NULL DEFAULT 0,
      coins_after REAL NOT NULL DEFAULT 0,
      coins_delta REAL NOT NULL DEFAULT 0,
      gift_coins_before REAL,
      gift_coins_after REAL,
      gift_coins_delta REAL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      response TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_player_id ON player_ledger(player_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_event_type ON player_ledger(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON player_ledger(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ledger_player_name ON player_ledger(player_name)');

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      date TEXT NOT NULL,
      coins_awarded REAL NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, game, date)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_player_date ON daily_completions(player_id, date)');

  // Generated cosmetics (daily loot box rewards)
  db.run(`
    CREATE TABLE IF NOT EXISTS generated_cosmetics (
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
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_gen_cosmetics_player ON generated_cosmetics(player_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_gen_cosmetics_date ON generated_cosmetics(date_awarded)');

  // Weekly SP challenge completions (Spelling Bee + Squaredle)
  db.run(`
    CREATE TABLE IF NOT EXISTS weekly_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      week_start TEXT NOT NULL,
      coins_awarded REAL NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, game, week_start)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_weekly_player_week ON weekly_completions(player_id, week_start)');

  // Pizza Shop tables
  db.run(`
    CREATE TABLE IF NOT EXISTS pizza_shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      shop_name TEXT NOT NULL DEFAULT 'My Pizza Shop',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      shop_level INTEGER NOT NULL DEFAULT 1,
      shop_xp INTEGER NOT NULL DEFAULT 0,
      pizza_coins REAL NOT NULL DEFAULT 0,
      total_pizzas_served INTEGER NOT NULL DEFAULT 0,
      total_coins_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pizza_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pizza_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Newspaper Route tables
  db.run(`
    CREATE TABLE IF NOT EXISTS newspaper_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      route_name TEXT NOT NULL DEFAULT 'My Paper Route',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      route_level INTEGER NOT NULL DEFAULT 1,
      route_xp INTEGER NOT NULL DEFAULT 0,
      total_papers_delivered INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS newspaper_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS newspaper_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Car Wash tables
  db.run(`
    CREATE TABLE IF NOT EXISTS carwash_shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      shop_name TEXT NOT NULL DEFAULT 'My Car Wash',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      shop_level INTEGER NOT NULL DEFAULT 1,
      shop_xp INTEGER NOT NULL DEFAULT 0,
      clean_cash REAL NOT NULL DEFAULT 0,
      total_cars_washed INTEGER NOT NULL DEFAULT 0,
      total_clean_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS carwash_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS carwash_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Stock Mogul tables
  db.run(`
    CREATE TABLE IF NOT EXISTS stockmogul_portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      portfolio_name TEXT NOT NULL DEFAULT 'My Portfolio',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      portfolio_level INTEGER NOT NULL DEFAULT 1,
      portfolio_xp INTEGER NOT NULL DEFAULT 0,
      portfolio_coins REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      total_coins_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stockmogul_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stockmogul_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Gym tables
  db.run(`
    CREATE TABLE IF NOT EXISTS gym_clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      club_name TEXT NOT NULL DEFAULT 'My Gym',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      club_level INTEGER NOT NULL DEFAULT 1,
      club_xp INTEGER NOT NULL DEFAULT 0,
      gym_points REAL NOT NULL DEFAULT 0,
      total_members_trained INTEGER NOT NULL DEFAULT 0,
      total_points_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gym_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gym_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Cinema tables
  db.run(`
    CREATE TABLE IF NOT EXISTS cinema_theaters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      theater_name TEXT NOT NULL DEFAULT 'My Cinema',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      theater_level INTEGER NOT NULL DEFAULT 1,
      theater_xp INTEGER NOT NULL DEFAULT 0,
      total_viewers_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cinema_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cinema_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Startup tables
  db.run(`
    CREATE TABLE IF NOT EXISTS startup_hubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      hub_name TEXT NOT NULL DEFAULT 'My Startup',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      hub_level INTEGER NOT NULL DEFAULT 1,
      hub_xp INTEGER NOT NULL DEFAULT 0,
      total_users_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS startup_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS startup_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Bank tables
  db.run(`
    CREATE TABLE IF NOT EXISTS bank_vaults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL UNIQUE,
      vault_name TEXT NOT NULL DEFAULT 'My Bank',
      prestige_level INTEGER NOT NULL DEFAULT 0,
      vault_level INTEGER NOT NULL DEFAULT 1,
      vault_xp INTEGER NOT NULL DEFAULT 0,
      total_clients_served INTEGER NOT NULL DEFAULT 0,
      total_xp_earned REAL NOT NULL DEFAULT 0,
      last_collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bank_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      upgrade_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, upgrade_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bank_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(player_id, category),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Game wins table — single source of truth for game win stats
  db.run(`
    CREATE TABLE IF NOT EXISTS game_wins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      game TEXT NOT NULL,
      event TEXT NOT NULL,
      guess_count INTEGER,
      word TEXT,
      coins_awarded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_game_wins_player ON game_wins(player_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_game_wins_game ON game_wins(game)');
  db.run('CREATE INDEX IF NOT EXISTS idx_game_wins_player_game ON game_wins(player_id, game)');

  // Library words table — tracks unique words each player has found across all games
  db.run(`
    CREATE TABLE IF NOT EXISTS library_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      game TEXT,
      found_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, word)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_discord_id TEXT NOT NULL,
      target_discord_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accepted_at DATETIME,
      UNIQUE(requester_discord_id, target_discord_id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_target ON friends(target_discord_id, status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friends_requester ON friends(requester_discord_id, status)');

  // Daily claim streak system
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      claim_date TEXT NOT NULL,
      xp_awarded INTEGER NOT NULL,
      streak_day INTEGER NOT NULL,
      is_milestone INTEGER DEFAULT 0,
      milestone_type TEXT,
      cosmetic_awarded INTEGER DEFAULT 0,
      progression_mult REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(discord_user_id, claim_date)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_claims_user ON daily_claims(discord_user_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS streak_state (
      discord_user_id TEXT PRIMARY KEY,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_claim_date TEXT,
      total_claims INTEGER DEFAULT 0,
      total_xp_from_claims INTEGER DEFAULT 0,
      milestone_titles_awarded TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Membership + monthly pass system
  db.run(`
    CREATE TABLE IF NOT EXISTS player_memberships (
      discord_user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      last_monthly_grant_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_player_memberships_tier ON player_memberships(tier)');
  db.run('CREATE INDEX IF NOT EXISTS idx_player_memberships_status ON player_memberships(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_player_memberships_subscription ON player_memberships(stripe_subscription_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS membership_grants (
      discord_user_id TEXT NOT NULL,
      membership_tier TEXT NOT NULL,
      period_key TEXT NOT NULL,
      gift_coins_awarded INTEGER NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (discord_user_id, membership_tier, period_key)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_membership_grants_tier ON membership_grants(membership_tier, granted_at)');

  // IP logging for anti-cheat — tracks player IPs across sessions
  db.run(`
    CREATE TABLE IF NOT EXISTS player_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL,
      game TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      hit_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, ip_address)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_player_ips_ip ON player_ips(ip_address)');
  db.run('CREATE INDEX IF NOT EXISTS idx_player_ips_player ON player_ips(player_id)');

  reconcileManagedBusinessState();

  // Migrate: add tap upgrade columns if missing
  migratePlayerColumns();

  // Migrate: add display info columns to linked_accounts
  migrateLinkedAccountsColumns();

  // Migrate: add game win metadata columns used by Searchle and other game history UIs
  migrateGameWinsColumns();

  // Display names are not identities. Never merge unrelated players at startup.

  // Migrate: floor all REAL coin values to integers (prevent float precision drift)
  migrateCoinsToInteger();

  // Migrate: rename lemonade business to library
  migrateLemonadeToLibrary();

  // Migrate: seed library_words from existing game_wins history
  migrateLibraryFromGameWins();

  // The UNIQUE(player_id, word) auto-index already covers player_id prefix scans,
  // so the standalone player_id index only bloats the exported DB.
  const removedRedundantIndexes = migrateRedundantIndexes();
  maybeCompactDatabaseOnStartup({ force: removedRedundantIndexes > 0 });

  saveImmediate();
  console.log('[DB] Database initialized');
}

function bufferFromUint8Array(data) {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function hasValidSqliteHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.allocUnsafe(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(fd, header, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

function getFreelistStats() {
  const freelistCount = Number(queryScalar('PRAGMA freelist_count') || 0);
  const pageSize = Number(queryScalar('PRAGMA page_size') || 0);
  const freeBytes = freelistCount * pageSize;
  const freeMB = freeBytes / (1024 * 1024);
  return {
    freelistCount,
    pageSize,
    freeBytes,
    freeMB
  };
}

function migrateRedundantIndexes() {
  let removed = 0;
  const indexNames = queryAll("SELECT name FROM sqlite_master WHERE type = 'index'").map((row) => row.name);

  if (indexNames.includes('idx_library_words_player')) {
    run('DROP INDEX idx_library_words_player');
    removed++;
  }

  return removed;
}

function maybeCompactDatabaseOnStartup({ force = false } = {}) {
  if (!db) return;

  const before = getFreelistStats();
  if (!force && before.freeMB < DB_STARTUP_COMPACT_THRESHOLD_MB) {
    return;
  }

  const startedAt = Date.now();
  run('VACUUM');
  const after = getFreelistStats();
  const totalMs = Date.now() - startedAt;

  console.log(
    `[DB] Startup VACUUM completed freeBeforeMB=${before.freeMB.toFixed(2)} ` +
    `freeAfterMB=${after.freeMB.toFixed(2)} totalMs=${totalMs}`
  );
}

function migratePlayerColumns() {
  const cols = queryAll("PRAGMA table_info(players)").map(c => c.name);
  if (!cols.includes('xp')) {
    run('ALTER TABLE players ADD COLUMN xp REAL NOT NULL DEFAULT 0');
    // First split bootstrap: preserve the current shared balance as starting Word Tycoon XP.
    run('UPDATE players SET xp = CAST(coins AS INTEGER) WHERE xp = 0 AND coins > 0');
  }
  if (!cols.includes('crit_chance')) {
    run('ALTER TABLE players ADD COLUMN crit_chance REAL NOT NULL DEFAULT 0');
  }
  if (!cols.includes('multi_tap')) {
    run('ALTER TABLE players ADD COLUMN multi_tap INTEGER NOT NULL DEFAULT 1');
  }
  if (!cols.includes('profile_pic')) {
    run('ALTER TABLE players ADD COLUMN profile_pic TEXT');
  }
  if (!cols.includes('gift_coins')) {
    run('ALTER TABLE players ADD COLUMN gift_coins REAL NOT NULL DEFAULT 0');
  }
  if (!cols.includes('library_words')) {
    run('ALTER TABLE players ADD COLUMN library_words INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('tax_season_completed')) {
    run('ALTER TABLE players ADD COLUMN tax_season_completed INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('tax_season_completed_at')) {
    run('ALTER TABLE players ADD COLUMN tax_season_completed_at TEXT');
  }
  if (!cols.includes('tax_season_trigger_business')) {
    run('ALTER TABLE players ADD COLUMN tax_season_trigger_business TEXT');
  }
  if (!cols.includes('tax_season_bonus_multiplier')) {
    run('ALTER TABLE players ADD COLUMN tax_season_bonus_multiplier REAL NOT NULL DEFAULT 1.0');
  }
  if (!cols.includes('tax_season_reset_reason')) {
    run('ALTER TABLE players ADD COLUMN tax_season_reset_reason TEXT');
  }
  if (!cols.includes('country')) {
    run('ALTER TABLE players ADD COLUMN country TEXT');
  }
  if (!cols.includes('region_changed_at')) {
    run('ALTER TABLE players ADD COLUMN region_changed_at INTEGER');
  }
  if (!cols.includes('word_game_xp')) {
    run('ALTER TABLE players ADD COLUMN word_game_xp REAL NOT NULL DEFAULT 0');
  }
  if (!cols.includes('suspended')) {
    run('ALTER TABLE players ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0');
  }
}

function migrateLinkedAccountsColumns() {
  const cols = queryAll("PRAGMA table_info(linked_accounts)").map(c => c.name);
  if (!cols.includes('display_name')) {
    run('ALTER TABLE linked_accounts ADD COLUMN display_name TEXT');
  }
  if (!cols.includes('profile_pic')) {
    run('ALTER TABLE linked_accounts ADD COLUMN profile_pic TEXT');
  }
  if (!cols.includes('username')) {
    run('ALTER TABLE linked_accounts ADD COLUMN username TEXT');
  }
  if (!cols.includes('verified_email')) {
    run('ALTER TABLE linked_accounts ADD COLUMN verified_email TEXT');
    run('CREATE INDEX IF NOT EXISTS idx_linked_verified_email ON linked_accounts(verified_email)');
  }
  // Backfill from existing player rows
  const accounts = queryAll('SELECT * FROM linked_accounts WHERE display_name IS NULL');
  for (const acct of accounts) {
    const player = queryOne(
      'SELECT username, display_name, profile_pic FROM players WHERE platform = ? AND platform_user_id = ?',
      [acct.platform, acct.platform_user_id]
    );
    if (player) {
      run(
        'UPDATE linked_accounts SET username = ?, display_name = ?, profile_pic = ? WHERE id = ?',
        [player.username, player.display_name, player.profile_pic, acct.id]
      );
    }
  }
}

function migrateCoinsToInteger() {
  // Floor all float coin values to prevent precision drift
  // This is a one-time migration for existing REAL-typed columns
  const floatPlayers = queryAll("SELECT id FROM players WHERE typeof(coins) = 'real' OR coins != CAST(coins AS INTEGER)");
  if (floatPlayers.length > 0) {
    run('UPDATE players SET coins = CAST(coins AS INTEGER) WHERE typeof(coins) = \'real\' OR coins != CAST(coins AS INTEGER)');
    run('UPDATE players SET gift_coins = CAST(gift_coins AS INTEGER) WHERE typeof(gift_coins) = \'real\' OR gift_coins != CAST(gift_coins AS INTEGER)');
    console.log(`[DB] Migrated ${floatPlayers.length} player coin values from REAL to INTEGER`);
  }
}

function migrateLemonadeToLibrary() {
  const count = queryOne("SELECT COUNT(*) as cnt FROM player_businesses WHERE business_type = 'lemonade'");
  if (!count || count.cnt === 0) return;
  run("UPDATE player_businesses SET business_type = 'library' WHERE business_type = 'lemonade'");
  console.log('[DB] Migrated ' + count.cnt + ' lemonade businesses to library');
}

function migrateLibraryFromGameWins() {
  // Only seed once — skip if library_words table already has data
  const count = queryOne('SELECT COUNT(*) as cnt FROM library_words');
  if (count && count.cnt > 0) return;
  // Check if there are any game_wins with words to seed from
  const winCount = queryOne("SELECT COUNT(*) as cnt FROM game_wins WHERE word IS NOT NULL AND word != ''");
  if (!winCount || winCount.cnt === 0) return;
  // Seed library_words from existing game_wins history (unique words per player)
  run("INSERT OR IGNORE INTO library_words (player_id, word, game, found_at) SELECT player_id, LOWER(word), game, MIN(created_at) FROM game_wins WHERE word IS NOT NULL AND word != '' GROUP BY player_id, LOWER(word)");
  // Backfill player.library_words cached counts
  run("UPDATE players SET library_words = (SELECT COUNT(*) FROM library_words WHERE library_words.player_id = players.id)");
  const total = queryOne('SELECT COUNT(*) as cnt FROM library_words');
  console.log('[DB] Seeded ' + (total?.cnt || 0) + ' library words from game_wins history');
}

function cleanupDuplicatePlayers() {
  // Retain the legacy admin API without merging by a non-unique display name.
  // Actual duplicates are linked/merged explicitly using verified identities.
  return { merged: 0, details: [], message: 'Display-name cleanup is disabled; link verified accounts instead.' };
}

/**
 * Find all duplicate player groups (same display_name + platform with multiple entries).
 * Returns array of groups: [{ display_name, platform, players: [...] }, ...]
 */
function findDuplicatePlayers() {
  const dupes = queryAll(
    `SELECT display_name, platform, COUNT(*) as cnt FROM players
     GROUP BY display_name, platform HAVING cnt > 1`
  );
  const groups = [];
  for (const dupe of dupes) {
    const players = queryAll(
      'SELECT * FROM players WHERE display_name = ? AND platform = ? ORDER BY total_taps DESC, coins DESC, id ASC',
      [dupe.display_name, dupe.platform]
    );
    if (players.length >= 2) {
      groups.push({
        display_name: dupe.display_name,
        platform: dupe.platform,
        count: players.length,
        players
      });
    }
  }
  return groups;
}

// mergePlayers — now delegated to identity service (see delegate accessors above)


let activeAsyncSave = null;
function saveImmediateAsync() {
  if (activeAsyncSave) return activeAsyncSave;
  activeAsyncSave = performImmediateSave();
  return activeAsyncSave.finally(() => { activeAsyncSave = null; });
}

const durableWaiters = [];
let durableDrainRunning = false;
function flushDurable() {
  return new Promise((resolve, reject) => {
    durableWaiters.push({ resolve, reject });
    if (durableDrainRunning) return;
    durableDrainRunning = true;
    // Coalesce a burst of rewards into one durable database export.
    setTimeout(drainDurableWaiters, 25);
  });
}
async function drainDurableWaiters() {
  while (durableWaiters.length) {
    const batch = durableWaiters.splice(0);
    try {
      if (activeAsyncSave) await activeAsyncSave;
      // A fresh snapshot is necessary: an older in-flight save may predate this batch.
      await saveImmediateAsync();
      if (!lastSaveStats?.savedOk) throw new Error('Reward database persistence failed');
      for (const waiter of batch) waiter.resolve();
    } catch (error) {
      for (const waiter of batch) waiter.reject(error);
    }
  }
  durableDrainRunning = false;
}

async function performImmediateSave() {
  if (!db) return;
  if (saveInProgress) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (transactionDepth > 0) {
    pendingSave = true;
    return;
  }

  saveInProgress = true;
  saveDirty = false;
  pendingSave = false;
  const startedAt = Date.now();
  const exportStartedAt = Date.now();
  const data = db.export();
  const exportMs = Date.now() - exportStartedAt;
  const buffer = bufferFromUint8Array(data);
  let verifiedReadBackBytes = null;
  let verifiedHeaderOk = null;
  let usedFallbackWrite = false;
  let savedOk = false;

  const tmpPath = DB_PATH + '.tmp';
  try {
    await writeFileAtomic(DB_PATH, buffer, {
      tmpPath,
      validateTmp(filePath, stat) {
        if (stat.size !== buffer.length) {
          throw new Error(`temp file size mismatch (${stat.size} vs ${buffer.length})`);
        }
        if (!hasValidSqliteHeader(filePath)) {
          throw new Error('temp file missing SQLite header');
        }
      }
    });

    saveCounter++;
    savedOk = true;

    if (saveCounter % VERIFIED_SAVE_INTERVAL === 0) {
      const readBackStat = await fs.promises.stat(DB_PATH);
      verifiedReadBackBytes = readBackStat.size;
      verifiedHeaderOk = hasValidSqliteHeader(DB_PATH);
      if (readBackStat.size !== buffer.length) {
        console.error(`[DB] VERIFIED SAVE MISMATCH! Expected ${buffer.length} bytes, got ${readBackStat.size}`);
      }
      if (!verifiedHeaderOk) {
        console.error('[DB] VERIFIED SAVE HEADER MISMATCH! Saved file is missing the SQLite header');
      }
    }
  } catch (err) {
    console.error('[DB] Save error:', err.message);
    try {
      removeIfExists(tmpPath);
      writeFileDurableSync(DB_PATH, buffer);
      saveCounter++;
      savedOk = true;
      usedFallbackWrite = true;
    } catch (fallbackErr) {
      console.error('[DB] Fallback save also failed:', fallbackErr.message);
    }
  }

  saveInProgress = false;

  const totalMs = Date.now() - startedAt;
  const rssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const shouldLogSave =
    savedOk && (
      saveCounter % VERIFIED_SAVE_INTERVAL === 0 ||
      totalMs >= SAVE_OBSERVABILITY_MS ||
      rssMB >= SAVE_OBSERVABILITY_RSS_MB
    );

  if (shouldLogSave) {
    const ledgerRows = queryScalar('SELECT COUNT(*) FROM player_ledger') || 0;
    const parts = [
      `[DB] Save stats #${saveCounter}`,
      `sizeMB=${(buffer.length / (1024 * 1024)).toFixed(2)}`,
      `exportMs=${exportMs}`,
      `totalMs=${totalMs}`,
      `rssMB=${rssMB}`,
      `ledgerRows=${ledgerRows}`
    ];
    if (verifiedReadBackBytes != null) {
      parts.push(`verifiedReadBackMB=${(verifiedReadBackBytes / (1024 * 1024)).toFixed(2)}`);
    }
    if (verifiedHeaderOk != null) {
      parts.push(`verifiedHeaderOk=${verifiedHeaderOk ? 1 : 0}`);
    }
    if (usedFallbackWrite) {
      parts.push('fallback=1');
    }
    console.log(parts.join(' '));
  }

  lastSaveStats = {
    saveCounter,
    savedOk,
    sizeMB: Number((buffer.length / (1024 * 1024)).toFixed(2)),
    exportMs,
    totalMs,
    rssMB,
    verifiedReadBackMB: verifiedReadBackBytes != null
      ? Number((verifiedReadBackBytes / (1024 * 1024)).toFixed(2))
      : null,
    verifiedHeaderOk,
    usedFallbackWrite,
    savedAt: new Date().toISOString()
  };

  if (saveDirty && !saveTimer) {
    save();
  }
}

function saveImmediate() {
  if (!db) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveInProgress) {
    pendingSave = true;
    return;
  }
  if (transactionDepth > 0) {
    pendingSave = true;
    return;
  }

  saveInProgress = true;
  saveDirty = false;
  pendingSave = false;
  const startedAt = Date.now();
  const exportStartedAt = Date.now();
  const data = db.export();
  const exportMs = Date.now() - exportStartedAt;
  const buffer = bufferFromUint8Array(data);
  let verifiedReadBackBytes = null;
  let verifiedHeaderOk = null;
  let usedFallbackWrite = false;
  let savedOk = false;

  // Safe durable write: fsync temp file, validate it, atomic rename, then fsync the directory when supported.
  const tmpPath = DB_PATH + '.tmp';
  try {
    writeFileAtomicSync(DB_PATH, buffer, {
      tmpPath,
      validateTmp(filePath, stat) {
        if (stat.size !== buffer.length) {
          throw new Error(`temp file size mismatch (${stat.size} vs ${buffer.length})`);
        }
        if (!hasValidSqliteHeader(filePath)) {
          throw new Error('temp file missing SQLite header');
        }
      }
    });

    saveCounter++;
    savedOk = true;

    // Periodic verified save: confirm size/header without loading the whole file.
    if (saveCounter % VERIFIED_SAVE_INTERVAL === 0) {
      const readBackStat = fs.statSync(DB_PATH);
      verifiedReadBackBytes = readBackStat.size;
      verifiedHeaderOk = hasValidSqliteHeader(DB_PATH);
      if (readBackStat.size !== buffer.length) {
        console.error(`[DB] VERIFIED SAVE MISMATCH! Expected ${buffer.length} bytes, got ${readBackStat.size}`);
      }
      if (!verifiedHeaderOk) {
        console.error('[DB] VERIFIED SAVE HEADER MISMATCH! Saved file is missing the SQLite header');
      }
    }
  } catch (err) {
    console.error('[DB] Save error:', err.message);
    // If temp file exists but rename failed, try direct write as fallback
    try {
      removeIfExists(tmpPath);
      writeFileDurableSync(DB_PATH, buffer);
      saveCounter++;
      savedOk = true;
      usedFallbackWrite = true;
    } catch (fallbackErr) {
      console.error('[DB] Fallback save also failed:', fallbackErr.message);
    }
  }

  const totalMs = Date.now() - startedAt;
  const rssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const shouldLogSave =
    savedOk && (
      saveCounter % VERIFIED_SAVE_INTERVAL === 0 ||
      totalMs >= SAVE_OBSERVABILITY_MS ||
      rssMB >= SAVE_OBSERVABILITY_RSS_MB
    );

  if (shouldLogSave) {
    const ledgerRows = queryScalar('SELECT COUNT(*) FROM player_ledger') || 0;
    const parts = [
      `[DB] Save stats #${saveCounter}`,
      `sizeMB=${(buffer.length / (1024 * 1024)).toFixed(2)}`,
      `exportMs=${exportMs}`,
      `totalMs=${totalMs}`,
      `rssMB=${rssMB}`,
      `ledgerRows=${ledgerRows}`
    ];
    if (verifiedReadBackBytes != null) {
      parts.push(`verifiedReadBackMB=${(verifiedReadBackBytes / (1024 * 1024)).toFixed(2)}`);
    }
    if (verifiedHeaderOk != null) {
      parts.push(`verifiedHeaderOk=${verifiedHeaderOk ? 1 : 0}`);
    }
    if (usedFallbackWrite) {
      parts.push('fallback=1');
    }
    console.log(parts.join(' '));
  }

  lastSaveStats = {
    saveCounter,
    savedOk,
    sizeMB: Number((buffer.length / (1024 * 1024)).toFixed(2)),
    exportMs,
    totalMs,
    rssMB,
    verifiedReadBackMB: verifiedReadBackBytes != null
      ? Number((verifiedReadBackBytes / (1024 * 1024)).toFixed(2))
      : null,
    verifiedHeaderOk,
    usedFallbackWrite,
    savedAt: new Date().toISOString()
  };

  saveInProgress = false;

  if (saveDirty && !saveTimer) {
    save();
  }
}

function save() {
  if (!db) return;
  if (transactionDepth > 0) {
    pendingSave = true;
    return;
  }

  saveDirty = true;
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!saveDirty) return;
    saveImmediateAsync().catch(error => console.error('[DB] Async save failed:', error.message));
  }, DB_SAVE_DEBOUNCE_MS);

  if (saveTimer.unref) saveTimer.unref();
}

/**
 * Export the raw database buffer (used by backup system)
 */
function exportBuffer() {
  if (!db) return null;
  return bufferFromUint8Array(db.export());
}

function getRuntimeInfo() {
  let fileSizeMB = null;
  try {
    fileSizeMB = Number((fs.statSync(DB_PATH).size / (1024 * 1024)).toFixed(2));
  } catch (_) {}

  return {
    fileSizeMB,
    saveCounter,
    saveDirty,
    pendingSave,
    transactionDepth,
    debounceMs: DB_SAVE_DEBOUNCE_MS,
    verifiedSaveInterval: VERIFIED_SAVE_INTERVAL,
    lastSave: lastSaveStats
  };
}

function run(sql, params = []) {
  db.run(sql, params);
}

function sanitizeParams(params, sql) {
  return params.map((p, i) => {
    if (p === undefined) {
      console.warn(`[DB] undefined param at index ${i} in query: ${sql.slice(0, 120)}`);
      return null;
    }
    return p;
  });
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(sanitizeParams(params, sql));
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(sanitizeParams(params, sql));
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function queryScalar(sql, params = []) {
  const row = queryOne(sql, params);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : null;
}

function getRecentLedgerEntries(playerIds, limit = 25) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];
  const safeLimit = Math.max(1, Number(limit) || 25);
  const placeholders = playerIds.map(() => '?').join(',');
  const selectSql = `
    SELECT id, player_id, event_type, command, coins_delta, success, created_at, response
    FROM player_ledger
    WHERE player_id IN (${placeholders})
    ORDER BY id DESC
    LIMIT ?
  `;
  const hotEntries = queryAll(selectSql, [...playerIds, safeLimit]);
  if (hotEntries.length >= safeLimit) return hotEntries;

  const archiveEntries = ledgerArchive.queryAll(selectSql, [...playerIds, safeLimit - hotEntries.length]);
  return hotEntries.concat(archiveEntries);
}

function getLedgerEconomySummary(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { coinsEarned: 0, coinsSpent: 0, giftEarned: 0, giftSpent: 0 };
  }

  const placeholders = playerIds.map(() => '?').join(',');
  const sql = `
    SELECT
      SUM(CASE WHEN coins_delta > 0 THEN coins_delta ELSE 0 END) AS coins_earned,
      SUM(CASE WHEN coins_delta < 0 THEN -coins_delta ELSE 0 END) AS coins_spent,
      SUM(CASE WHEN gift_coins_delta > 0 THEN gift_coins_delta ELSE 0 END) AS gift_earned,
      SUM(CASE WHEN gift_coins_delta < 0 THEN -gift_coins_delta ELSE 0 END) AS gift_spent
    FROM player_ledger
    WHERE player_id IN (${placeholders}) AND success = 1
  `;
  const hotRow = queryOne(sql, playerIds) || {};
  const archiveRow = ledgerArchive.queryOne(sql, playerIds) || {};

  return {
    coinsEarned: Math.floor((Number(hotRow.coins_earned) || 0) + (Number(archiveRow.coins_earned) || 0)),
    coinsSpent: Math.floor((Number(hotRow.coins_spent) || 0) + (Number(archiveRow.coins_spent) || 0)),
    giftEarned: Math.floor((Number(hotRow.gift_earned) || 0) + (Number(archiveRow.gift_earned) || 0)),
    giftSpent: Math.floor((Number(hotRow.gift_spent) || 0) + (Number(archiveRow.gift_spent) || 0))
  };
}

function getLedgerPurchaseCounts(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { cosmeticPurchases: 0, setPurchases: 0 };
  }

  const placeholders = playerIds.map(() => '?').join(',');
  const cosmeticSql = `
    SELECT COUNT(*) AS cnt
    FROM player_ledger
    WHERE player_id IN (${placeholders}) AND success = 1 AND event_type = 'cosmetic'
  `;
  const setSql = `
    SELECT COUNT(*) AS cnt
    FROM player_ledger
    WHERE player_id IN (${placeholders}) AND success = 1 AND (event_type = 'set' OR command LIKE '!buyset%')
  `;

  const hotCosmetic = Number((queryOne(cosmeticSql, playerIds) || {}).cnt) || 0;
  const archiveCosmetic = Number((ledgerArchive.queryOne(cosmeticSql, playerIds) || {}).cnt) || 0;
  const hotSet = Number((queryOne(setSql, playerIds) || {}).cnt) || 0;
  const archiveSet = Number((ledgerArchive.queryOne(setSql, playerIds) || {}).cnt) || 0;

  return {
    cosmeticPurchases: hotCosmetic + archiveCosmetic,
    setPurchases: hotSet + archiveSet
  };
}

function reassignLedgerPlayerHistory(keepId, removeId) {
  run('UPDATE player_ledger SET player_id = ? WHERE player_id = ?', [keepId, removeId]);
  ledgerArchive.reassignPlayerId(keepId, removeId);
}

function migrateGameWinsColumns() {
  const cols = queryAll("PRAGMA table_info(game_wins)").map(c => c.name);
  if (!cols.includes('duration_seconds')) {
    run('ALTER TABLE game_wins ADD COLUMN duration_seconds INTEGER');
  }
}

async function withTransaction(fn) {
  const savepoint = `sp_${transactionDepth + 1}_${Date.now()}`;
  const isOuter = transactionDepth === 0;

  run(isOuter ? 'BEGIN IMMEDIATE TRANSACTION' : `SAVEPOINT ${savepoint}`);
  transactionDepth++;

  try {
    const result = await fn();
    transactionDepth--;
    run(isOuter ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    if (isOuter && pendingSave) save();
    return result;
  } catch (err) {
    transactionDepth--;
    try {
      run(isOuter ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
      if (!isOuter) run(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) {}
    if (isOuter) pendingSave = false;
    throw err;
  }
}

function withTransactionSync(fn) {
  const savepoint = `sp_${transactionDepth + 1}_${Date.now()}`;
  const isOuter = transactionDepth === 0;

  run(isOuter ? 'BEGIN IMMEDIATE TRANSACTION' : `SAVEPOINT ${savepoint}`);
  transactionDepth++;

  try {
    const result = fn();
    transactionDepth--;
    run(isOuter ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    if (isOuter && pendingSave) save();
    return result;
  } catch (err) {
    transactionDepth--;
    try {
      run(isOuter ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
      if (!isOuter) run(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) {}
    if (isOuter) pendingSave = false;
    throw err;
  }
}

// ── Composed services ──
// Identity and Library are extracted modules. Both are late-bound because they
// have a mutual dependency: identity merge needs recalcLibraryWordCount, and
// library's addLibraryWordLinked needs identity resolution functions.
// The delegate functions below forward to the service singletons. They resolve
// at call-time (not definition-time), so the init order doesn't matter.

let identityService;
let libraryService;

function _initServices() {
  // Library service — needs identity delegates for cross-identity dedupe.
  // The identity delegates are closures that resolve identityService at call-time,
  // so it's safe to create library first even though identityService is null here.
  libraryService = createLibraryService({
    queryOne, queryAll, run, save,
    getDiscordUserForPlatform, getAllPlayerIdsForDiscord
  });

  // Identity service — needs recalcLibraryWordCount for merge flows.
  identityService = createIdentityService({
    queryOne, queryAll, run, save,
    recalcLibraryWordCount: libraryService.recalcLibraryWordCount,
    getLedgerEconomySummary,
    getLedgerPurchaseCounts,
    reassignLedgerPlayerHistory
  });
}

// Identity delegate accessors — call sites use db.functionName unchanged.
// Link-topology mutations clear the wallet cache so XP routing follows the new primary.
function createLinkedAccount(...a) { clearWalletCache(); return identityService.createLinkedAccount(...a); }
function getLinkedAccounts(...a) { return identityService.getLinkedAccounts(...a); }
function hasLinkedAccount(...a) { return identityService.hasLinkedAccount(...a); }
function getDiscordUserForPlatform(...a) { return identityService.getDiscordUserForPlatform(...a); }
function findDiscordUserForPlatformAlias(...a) { return identityService.findDiscordUserForPlatformAlias(...a); }
function refreshLinkedAccountInfo(...a) { return identityService.refreshLinkedAccountInfo(...a); }
function backfillLinkedAccountAliases(...a) { return identityService.backfillLinkedAccountAliases(...a); }
function getUnifiedPlayer(...a) { return identityService.getUnifiedPlayer(...a); }
function resolveUnifiedPlayerByDiscord(...a) { return identityService.resolveUnifiedPlayerByDiscord(...a); }
function unlinkAccount(...a) { clearWalletCache(); return identityService.unlinkAccount(...a); }
function upsertVerifiedEmail(...a) { return identityService.upsertVerifiedEmail(...a); }
function getVerifiedEmail(...a) { return identityService.getVerifiedEmail(...a); }
function findAccountsByEmail(...a) { return identityService.findAccountsByEmail(...a); }
function findDiscordAnchorByEmail(...a) { return identityService.findDiscordAnchorByEmail(...a); }
function getDiscordIdentityDisplayInfo(...a) { return identityService.getDiscordIdentityDisplayInfo(...a); }
function getAccountProgressionState(...a) { return identityService.getAccountProgressionState(...a); }
function recordLinkDecline(...a) { return identityService.recordLinkDecline(...a); }
function hasLinkDecline(...a) { return identityService.hasLinkDecline(...a); }
function getAllPlayerIdsForDiscord(...a) { return identityService.getAllPlayerIdsForDiscord(...a); }
function createVerificationCode(...a) { return identityService.createVerificationCode(...a); }
function getVerificationCode(...a) { return identityService.getVerificationCode(...a); }
function markCodeUsed(...a) { return identityService.markCodeUsed(...a); }
function cleanupExpiredCodes(...a) { return identityService.cleanupExpiredCodes(...a); }
function mergePlayers(...a) { clearWalletCache(); return identityService.mergePlayers(...a); }
function mergeLinkedAccounts(...a) { clearWalletCache(); return identityService.mergeLinkedAccounts(...a); }
function mergeStreamPlayers(...a) { clearWalletCache(); return identityService.mergeStreamPlayers(...a); }
function mergeDiscordPlayerNoCurrency(...a) { clearWalletCache(); return identityService.mergeDiscordPlayerNoCurrency(...a); }
function discardDiscordPlayer(...a) { clearWalletCache(); return identityService.discardDiscordPlayer(...a); }
function getAccountOverview(...a) { return identityService.getAccountOverview(...a); }
function getCompletionStatus(...a) { return identityService.getCompletionStatus(...a); }
function setAccountPreference(...a) { clearWalletCache(); return identityService.setAccountPreference(...a); }
function getCosmeticVisibility(...a) { return identityService.getCosmeticVisibility(...a); }
function getOwnedProfileLogoIds(...a) { return identityService.getOwnedProfileLogoIds(...a); }
function getAccountProfileLogos(...a) { return identityService.getAccountProfileLogos(...a); }
function grantProfileLogo(...a) { return identityService.grantProfileLogo(...a); }
function revokeProfileLogo(...a) { return identityService.revokeProfileLogo(...a); }
function hasProfileLogoUnlocked(...a) { return identityService.hasProfileLogoUnlocked(...a); }
function resolveAccountProfileImage(...a) { return identityService.resolveAccountProfileImage(...a); }
function getLinkedGroups(...a) { return identityService.getLinkedGroups(...a); }
function findPotentialMatches(...a) { return identityService.findPotentialMatches(...a); }

// Library delegate accessors
function addLibraryWord(...a) { return libraryService.addLibraryWord(...a); }
function addLibraryWordLinked(...a) { return libraryService.addLibraryWordLinked(...a); }
function getLinkedPlayerIdsForPlayer(...a) { return libraryService.getLinkedPlayerIdsForPlayer(...a); }
function incrementLibraryWordCount(...a) { return libraryService.incrementLibraryWordCount(...a); }
function getPlayerLibraryWordCount(...a) { return libraryService.getPlayerLibraryWordCount(...a); }
function getLinkedLibraryWordCount(...a) { return libraryService.getLinkedLibraryWordCount(...a); }
function recalcLibraryWordCount(...a) { return libraryService.recalcLibraryWordCount(...a); }
function getPlayerLibraryWords(...a) { return libraryService.getPlayerLibraryWords(...a); }
function getPlayerLibraryStats(...a) { return libraryService.getPlayerLibraryStats(...a); }

// Player operations

function resolvePreferredNameForPlatform(platform, platformUserId, fallbackName) {
  const discordUserId = getDiscordUserForPlatform(platform, platformUserId);
  if (!discordUserId) return fallbackName;
  const prefs = queryOne(
    'SELECT preferred_display_name FROM account_preferences WHERE discord_user_id = ?',
    [discordUserId]
  );
  return prefs?.preferred_display_name || fallbackName;
}

function normalizePlatformAliasToken(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getStableProfilePicKey(profilePic) {
  if (!profilePic) return null;
  const raw = String(profilePic).trim();
  if (!raw) return null;
  const withoutQuery = raw.split('?')[0];
  const match = withoutQuery.match(/\/([^\/?#]+?)(?:~[^\/?#]+)?(?:\.[a-z0-9]+)?$/i);
  if (match?.[1]) return match[1].toLowerCase();
  return withoutQuery.toLowerCase();
}

function pickRecentTikTokAliasCandidate(candidates, username, profilePic) {
  const incomingUsernameToken = normalizePlatformAliasToken(username);
  const incomingProfilePicKey = getStableProfilePicKey(profilePic);
  const scored = [];

  for (const candidate of candidates) {
    let score = 0;
    const candidateUsernameToken = normalizePlatformAliasToken(candidate.username);
    const candidateProfilePicKey = getStableProfilePicKey(candidate.profile_pic);

    if (incomingUsernameToken && candidateUsernameToken && incomingUsernameToken === candidateUsernameToken) {
      score += 3;
    }
    if (incomingProfilePicKey && candidateProfilePicKey && incomingProfilePicKey === candidateProfilePicKey) {
      score += 4;
    }
    if (score > 0) scored.push({ candidate, score });
  }

  scored.sort((left, right) =>
    right.score - left.score ||
    String(right.candidate.last_seen || '').localeCompare(String(left.candidate.last_seen || ''))
  );

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].candidate;
}

function getOrCreatePlayer(platform, platformUserId, username, displayName, profilePic, country) {
  // Canonicalize platform: this app has no real "web" identity — every login
  // is Discord. A (web, <snowflake>) call is the same human as
  // (discord, <snowflake>), so route web upserts that look like Discord
  // (17–20-digit numeric puid) to the discord row. Prevents the split-row
  // pattern that fragments XP/coins/wins across two identities.
  if (platform === 'web' && platformUserId && /^\d{17,20}$/.test(String(platformUserId))) {
    platform = 'discord';
  }
  // Bidirectional canonicalization: when a fresh (discord, <snowflake>) upsert
  // arrives but a legacy (web, <same-snowflake>) row already exists with no
  // discord counterpart, repoint the existing row in place. This handles the
  // case where someone played as a 'web' user before linking Discord — without
  // this, a Discord OAuth login would create a duplicate discord row that the
  // implicit pairing in buildIdentityGroups has to paper over forever.
  if (platform === 'discord' && platformUserId && /^\d{17,20}$/.test(String(platformUserId))) {
    const existingWeb = queryOne(
      'SELECT id FROM players WHERE platform = ? AND platform_user_id = ? LIMIT 1',
      ['web', platformUserId]
    );
    if (existingWeb) {
      const existingDiscord = queryOne(
        'SELECT id FROM players WHERE platform = ? AND platform_user_id = ? LIMIT 1',
        ['discord', platformUserId]
      );
      if (!existingDiscord) {
        // Safe in-place conversion: no discord row collides, just relabel the
        // platform on the existing web row so the rest of the function finds
        // it via the standard (discord, snowflake) lookup below.
        run('UPDATE players SET platform = ? WHERE id = ?', ['discord', existingWeb.id]);
      }
      // If both existed (rare after this fix is in place — e.g. legacy data),
      // fall through; admin/players/merge can collapse them later.
    }
  }
  const preferredName = resolvePreferredNameForPlatform(platform, platformUserId, displayName || username || platformUserId);
  const safePlatformId = pickSafeName([platformUserId], { maxLength: 32 }) || 'Player';
  const incomingDisplayName = pickSafeName(
    [preferredName, displayName, username],
    { maxLength: 32 }
  );
  const incomingUsername = pickSafeName(
    [preferredName, username, displayName],
    { maxLength: 32 }
  );
  const effectiveDisplayName = incomingDisplayName || safePlatformId;
  const effectiveUsername = incomingUsername || incomingDisplayName || safePlatformId;
  const aliasDisplayName = preferredName || displayName || username || platformUserId;
  const aliasUsername = preferredName || username || displayName || platformUserId;

  // 1. Primary lookup: exact match on (platform, platform_user_id)
  let player = queryOne(
    'SELECT * FROM players WHERE platform = ? AND platform_user_id = ?',
    [platform, platformUserId]
  );

  if (player) {
    if (profilePic) {
      run(
        'UPDATE players SET display_name = ?, username = ?, profile_pic = ?, last_seen = datetime("now") WHERE id = ?',
        [incomingDisplayName || player.display_name || safePlatformId, incomingUsername || player.username || incomingDisplayName || safePlatformId, profilePic, player.id]
      );
    } else {
      run(
        'UPDATE players SET display_name = ?, username = ?, last_seen = datetime("now") WHERE id = ?',
        [incomingDisplayName || player.display_name || safePlatformId, incomingUsername || player.username || incomingDisplayName || safePlatformId, player.id]
      );
    }
    if (country && !player.country) {
      run('UPDATE players SET country = ? WHERE id = ?', [country, player.id]);
    }
    refreshLinkedAccountInfo(
      platform,
      platformUserId,
      incomingDisplayName || player.display_name,
      profilePic || player.profile_pic,
      incomingUsername || player.username
    );
    // Single-wallet: a linked account's earns/spends live on the group's primary
    // row, so hand callers that row — not the platform row they arrived on.
    const walletId = resolveWalletPlayerId(player.id);
    if (walletId !== player.id) {
      run('UPDATE players SET last_seen = datetime("now") WHERE id = ?', [walletId]);
      return queryOne('SELECT * FROM players WHERE id = ?', [walletId]);
    }
    return queryOne('SELECT * FROM players WHERE id = ?', [player.id]);
  }

  // 1.5. Linked account resolution: if this platform+userId is linked to a Discord user,
  //       resolve to the unified primary player so all platforms share the same stats.
  const linkedPrimary = getUnifiedPlayer(platform, platformUserId);
  if (linkedPrimary) {
    if (profilePic) {
      run(
        'UPDATE players SET display_name = ?, username = ?, profile_pic = ?, last_seen = datetime("now") WHERE id = ?',
        [incomingDisplayName || linkedPrimary.display_name || safePlatformId, incomingUsername || linkedPrimary.username || incomingDisplayName || safePlatformId, profilePic, linkedPrimary.id]
      );
    } else {
      run(
        'UPDATE players SET display_name = ?, username = ?, last_seen = datetime("now") WHERE id = ?',
        [incomingDisplayName || linkedPrimary.display_name || safePlatformId, incomingUsername || linkedPrimary.username || incomingDisplayName || safePlatformId, linkedPrimary.id]
      );
    }
    if (country && !linkedPrimary.country) {
      run('UPDATE players SET country = ? WHERE id = ?', [country, linkedPrimary.id]);
    }
    refreshLinkedAccountInfo(
      platform,
      platformUserId,
      incomingDisplayName || linkedPrimary.display_name,
      profilePic || linkedPrimary.profile_pic,
      incomingUsername || linkedPrimary.username
    );
    return queryOne('SELECT * FROM players WHERE id = ?', [linkedPrimary.id]);
  }

  // 1.75. Alias-linked account resolution: if a renamed TikTok/YouTube handle matches
  //       an existing linked profile by stable avatar + normalized name, attach it now.
  const aliasDiscordUserId = findDiscordUserForPlatformAlias(
    platform,
    platformUserId,
    aliasUsername,
    aliasDisplayName,
    profilePic || null
  );
  if (aliasDiscordUserId) {
    createLinkedAccount(aliasDiscordUserId, aliasDiscordUserId, platform, platformUserId);
    const aliasPrimary = resolveUnifiedPlayerByDiscord(aliasDiscordUserId);
    if (aliasPrimary) {
      if (profilePic) {
        run(
          'UPDATE players SET display_name = ?, username = ?, profile_pic = ?, last_seen = datetime("now") WHERE id = ?',
          [incomingDisplayName || aliasPrimary.display_name || safePlatformId, incomingUsername || aliasPrimary.username || incomingDisplayName || safePlatformId, profilePic, aliasPrimary.id]
        );
      } else {
        run(
          'UPDATE players SET display_name = ?, username = ?, last_seen = datetime("now") WHERE id = ?',
          [incomingDisplayName || aliasPrimary.display_name || safePlatformId, incomingUsername || aliasPrimary.username || incomingDisplayName || safePlatformId, aliasPrimary.id]
        );
      }
      refreshLinkedAccountInfo(
        platform,
        platformUserId,
        incomingDisplayName || aliasPrimary.display_name,
        profilePic || aliasPrimary.profile_pic,
        incomingUsername || aliasPrimary.username
      );
      return queryOne('SELECT * FROM players WHERE id = ?', [aliasPrimary.id]);
    }
  }

  // 2. Fallback: TikTok-only display_name merge with recency guard.
  //    TikFinity can send inconsistent user IDs for the same person
  //    (numeric userId vs uniqueId vs displayName). Only merge if:
  //    - Platform is tiktok (only platform with this inconsistency)
  //    - Existing record was seen in the last 7 days (prevents stale merges)
  if (displayName && platform === 'tiktok') {
    const recentCandidates = queryAll(
      `SELECT * FROM players WHERE platform = ? AND display_name = ?
       AND last_seen >= datetime('now', '-7 days')`,
      [platform, displayName]
    );
    player = pickRecentTikTokAliasCandidate(recentCandidates, aliasUsername, profilePic || null);
    if (player) {
      const previousPlatformUserId = player.platform_user_id;
      const linkedDiscordUserId = getDiscordUserForPlatform(platform, previousPlatformUserId);

      // Preserve the old alias and adopt the new one on the same player row.
      if (profilePic) {
        run(
          'UPDATE players SET platform_user_id = ?, display_name = ?, username = ?, profile_pic = ?, last_seen = datetime("now") WHERE id = ?',
          [platformUserId, incomingDisplayName || player.display_name || safePlatformId, incomingUsername || player.username || incomingDisplayName || safePlatformId, profilePic, player.id]
        );
      } else {
        run(
          'UPDATE players SET platform_user_id = ?, display_name = ?, username = ?, last_seen = datetime("now") WHERE id = ?',
          [platformUserId, incomingDisplayName || player.display_name || safePlatformId, incomingUsername || player.username || incomingDisplayName || safePlatformId, player.id]
        );
      }
      if (linkedDiscordUserId && platformUserId !== previousPlatformUserId) {
        createLinkedAccount(linkedDiscordUserId, linkedDiscordUserId, platform, platformUserId);
        refreshLinkedAccountInfo(
          platform,
          platformUserId,
          incomingDisplayName || player.display_name,
          profilePic || player.profile_pic,
          incomingUsername || player.username
        );
      }
      save();
      return queryOne('SELECT * FROM players WHERE id = ?', [player.id]);
    }
  }

  // 3. No match found — create new player
  run(
    `INSERT INTO players (platform, platform_user_id, username, display_name, profile_pic, country)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [platform, platformUserId, effectiveUsername || platformUserId, effectiveDisplayName || platformUserId, profilePic || null, country || null]
  );
  save();
  return queryOne(
    'SELECT * FROM players WHERE platform = ? AND platform_user_id = ?',
    [platform, platformUserId]
  );
}

function getPlayer(platform, platformUserId) {
  return queryOne(
    'SELECT * FROM players WHERE platform = ? AND platform_user_id = ?',
    [platform, platformUserId]
  );
}

/**
 * Resolve a player through linked accounts WITHOUT creating a new record.
 * Use this instead of getPlayer() anywhere you need to find a player
 * who may have linked/merged accounts (e.g. TikTok user playing from Discord).
 */
function resolvePlayer(platform, platformUserId) {
  if (!platform || !platformUserId) return null;
  // 1. Direct exact match (fast path — covers most cases).
  //    Single-wallet: linked accounts resolve through to the group's primary row.
  const player = queryOne(
    'SELECT * FROM players WHERE platform = ? AND platform_user_id = ?',
    [platform, platformUserId]
  );
  if (player) {
    const walletId = resolveWalletPlayerId(player.id);
    if (walletId !== player.id) {
      return queryOne('SELECT * FROM players WHERE id = ?', [walletId]) || player;
    }
    return player;
  }

  // 2. Discord shortcut — discord IDs live in linked_accounts.discord_user_id column,
  //    not as platform='discord' entries, so go directly to unified resolution.
  if (platform === 'discord') {
    return resolveUnifiedPlayerByDiscord(platformUserId);
  }

  // 3. Linked account resolution for other platforms
  return getUnifiedPlayer(platform, platformUserId);
}

function getPlayerByUsername(platform, username) {
  return queryOne(
    'SELECT * FROM players WHERE platform = ? AND username = ?',
    [platform, username]
  );
}

function getPlayerByDisplayName(platform, displayName) {
  return queryOne(
    'SELECT * FROM players WHERE platform = ? AND display_name = ?',
    [platform, displayName]
  );
}

// ==================== SINGLE-CURRENCY WALLET ====================
// The game has ONE spendable currency: XP (players.xp). The legacy players.coins
// ("dollars") column was merged into xp and must stay at 0 — nothing may write it.
// All XP/gift-coin mutations are redirected to the linked group's PRIMARY row
// (the "wallet row") so the balance shown by the portal (aggregated) is the same
// row every earn and spend touches.

const walletIdCache = new Map(); // playerId -> wallet playerId

function clearWalletCache() {
  walletIdCache.clear();
}

function resolveWalletPlayerId(playerId) {
  if (!playerId) return playerId;
  const cached = walletIdCache.get(playerId);
  if (cached) return cached;

  let walletId = playerId;
  const row = queryOne('SELECT id, platform, platform_user_id FROM players WHERE id = ?', [playerId]);
  if (row) {
    let discordUserId = null;
    const linked = queryOne(
      'SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ?',
      [row.platform, row.platform_user_id]
    );
    if (linked) {
      discordUserId = linked.discord_user_id;
    } else if (['discord', 'mobile', 'web'].includes(row.platform)) {
      const puid = String(row.platform_user_id || '');
      discordUserId = puid.startsWith('discord_') ? puid.slice('discord_'.length) : puid;
      // Only treat as a discord group if that group actually exists
      if (!queryOne('SELECT 1 FROM linked_accounts WHERE discord_user_id = ? LIMIT 1', [discordUserId]) &&
          !queryOne('SELECT 1 FROM account_preferences WHERE discord_user_id = ? LIMIT 1', [discordUserId])) {
        discordUserId = null;
      }
    }
    if (discordUserId) {
      const primary = resolveUnifiedPlayerByDiscord(discordUserId);
      if (primary && primary.id) walletId = primary.id;
    }
  }
  walletIdCache.set(playerId, walletId);
  return walletId;
}

function getWalletPlayerById(playerId) {
  return queryOne('SELECT * FROM players WHERE id = ?', [resolveWalletPlayerId(playerId)]);
}

function updatePlayerCoins(playerId, coinsToAdd) {
  // Legacy name kept for call-site compatibility — credits the unified XP wallet.
  updatePlayerXp(playerId, coinsToAdd);
}

function updatePlayerXp(playerId, xpToAdd) {
  if (!Number.isFinite(xpToAdd) || xpToAdd <= 0) return;
  run('UPDATE players SET xp = xp + ? WHERE id = ?', [Math.floor(xpToAdd), resolveWalletPlayerId(playerId)]);
}

function updatePlayerWordGameXp(playerId, xpToAdd) {
  if (!Number.isFinite(xpToAdd) || xpToAdd <= 0) return;
  run('UPDATE players SET word_game_xp = COALESCE(word_game_xp, 0) + ? WHERE id = ?', [Math.floor(xpToAdd), playerId]);
}

// Atomic conditional deduct — returns true if deduction succeeded, false if insufficient funds
function deductPlayerCoins(playerId, amount) {
  // Legacy name kept for call-site compatibility — deducts from the unified XP wallet.
  return deductPlayerXp(playerId, amount);
}

function deductPlayerXp(playerId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const amt = Math.floor(amount);
  run('UPDATE players SET xp = xp - ? WHERE id = ? AND xp >= ?', [amt, resolveWalletPlayerId(playerId), amt]);
  return db.getRowsModified() > 0;
}

function updatePlayerGiftCoins(playerId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  run('UPDATE players SET gift_coins = gift_coins + ? WHERE id = ?', [Math.floor(amount), resolveWalletPlayerId(playerId)]);
}

function deductPlayerGiftCoins(playerId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const amt = Math.floor(amount);
  run('UPDATE players SET gift_coins = gift_coins - ? WHERE id = ? AND gift_coins >= ?', [amt, resolveWalletPlayerId(playerId), amt]);
  return db.getRowsModified() > 0;
}

function deductPizzaCoins(playerId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const amt = Math.floor(amount);
  run('UPDATE pizza_shops SET pizza_coins = pizza_coins - ? WHERE player_id = ? AND pizza_coins >= ?', [amt, playerId, amt]);
  return db.getRowsModified() > 0;
}

function deductCarwashCleanCash(playerId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const amt = Math.floor(amount);
  run('UPDATE carwash_shops SET clean_cash = clean_cash - ? WHERE player_id = ? AND clean_cash >= ?', [amt, playerId, amt]);
  return db.getRowsModified() > 0;
}

function claimTimedBusinessCollect(tableName, playerId, claimedAt, minSeconds = 5) {
  const allowedTables = new Set([
    'pizza_shops',
    'newspaper_routes'
  ]);
  if (!allowedTables.has(tableName)) {
    throw new Error(`Unsupported timed collect table: ${tableName}`);
  }

  const safeSeconds = Math.max(0, Math.floor(Number(minSeconds) || 0));
  run(
    `UPDATE ${tableName}
     SET last_collected_at = ?
     WHERE player_id = ?
       AND (
         last_collected_at IS NULL
         OR COALESCE(strftime('%s', last_collected_at), 0) <= (strftime('%s', ?) - ?)
       )`,
    [claimedAt, playerId, claimedAt, safeSeconds]
  );
  return db.getRowsModified() > 0;
}

function claimBusinessCollectSnapshot(tableName, playerId, expectedLastCollectedAt, claimedAt) {
  const allowedTables = new Set([
    'pizza_shops',
    'newspaper_routes'
  ]);
  if (!allowedTables.has(tableName)) {
    throw new Error(`Unsupported collect snapshot table: ${tableName}`);
  }

  run(
    `UPDATE ${tableName}
     SET last_collected_at = ?
     WHERE player_id = ?
       AND (
         (last_collected_at IS NULL AND ? IS NULL)
         OR last_collected_at = ?
       )`,
    [claimedAt, playerId, expectedLastCollectedAt, expectedLastCollectedAt]
  );
  return db.getRowsModified() > 0;
}

function updatePlayerTaps(playerId, tapsToAdd, xpToAdd) {
  if (!Number.isFinite(xpToAdd) || xpToAdd < 0) xpToAdd = 0;
  if (!Number.isFinite(tapsToAdd) || tapsToAdd < 0) tapsToAdd = 0;
  run(
    'UPDATE players SET total_taps = total_taps + ?, xp = xp + ?, last_seen = datetime("now") WHERE id = ?',
    [Math.floor(tapsToAdd), Math.floor(xpToAdd), resolveWalletPlayerId(playerId)]
  );
}

function setPlayerTapPower(playerId, level) {
  run('UPDATE players SET tap_power = ? WHERE id = ?', [level, playerId]);
}

function setPlayerCritChance(playerId, chance) {
  run('UPDATE players SET crit_chance = ? WHERE id = ?', [chance, playerId]);
}

function setPlayerMultiTap(playerId, level) {
  run('UPDATE players SET multi_tap = ? WHERE id = ?', [level, playerId]);
}

function getTopTappers(limit = 5) {
  return queryAll(
    'SELECT display_name, total_taps, xp AS coins FROM players ORDER BY total_taps DESC LIMIT ?',
    [limit]
  );
}

function getTopByCoins(limit = 5) {
  return queryAll(
    'SELECT display_name, total_taps, xp AS coins FROM players ORDER BY xp DESC LIMIT ?',
    [limit]
  );
}

function getPlayerCount() {
  return queryScalar('SELECT COUNT(*) FROM players') || 0;
}

function getPlayersWithBusinesses(limit = 10) {
  // Get players who own at least one business, ordered by total income potential
  const players = queryAll(
    `SELECT p.id, p.display_name, p.xp AS coins, p.total_taps, p.last_seen
     FROM players p
     WHERE EXISTS (SELECT 1 FROM player_businesses pb WHERE pb.player_id = p.id)
     ORDER BY p.xp DESC
     LIMIT ?`,
    [limit]
  );

  return players.map(p => {
    const bizRows = queryAll(
      'SELECT business_type, level, last_collected_at FROM player_businesses WHERE player_id = ?',
      [p.id]
    );
    return {
      id: p.id,
      name: p.display_name,
      coins: p.coins,
      taps: p.total_taps,
      lastSeen: p.last_seen,
      businesses: bizRows
    };
  });
}

// Business operations

function getAllBusinesses() {
  return queryAll(
    `SELECT pb.*, p.created_at AS player_created_at, p.last_seen AS player_last_seen, p.display_name AS player_display_name, p.profile_pic AS player_profile_pic, p.library_words AS player_library_words
     FROM player_businesses pb
     JOIN players p ON p.id = pb.player_id`
  );
}

function getPlayerBusinesses(playerId) {
  return queryAll(
    'SELECT * FROM player_businesses WHERE player_id = ?',
    [playerId]
  );
}

function getPlayerBusiness(playerId, businessType) {
  return queryOne(
    'SELECT * FROM player_businesses WHERE player_id = ? AND business_type = ?',
    [playerId, businessType]
  );
}

function ensurePlayerBusiness(playerId, businessType, level = 1) {
  let existing = getPlayerBusiness(playerId, businessType);
  if (!existing) {
    createPlayerBusiness(playerId, businessType);
    existing = getPlayerBusiness(playerId, businessType);
  }
  if (existing && Number.isFinite(level) && existing.level !== level) {
    setBusinessLevel(existing.id, level);
    existing.level = level;
  }
  return existing;
}

function syncManagedBusinessLevel(playerId, businessType, level) {
  if (!Number.isFinite(level) || level < 1) return;
  ensurePlayerBusiness(playerId, businessType, level);
}

function getOwnedBusinessLevel(playerId, businessType) {
  const business = getPlayerBusiness(playerId, businessType);
  return business && business.level > 0 ? business.level : 1;
}

function seedManagedBusinessLevel(playerId, businessType, levelColumn, tableName) {
  const seededLevel = getOwnedBusinessLevel(playerId, businessType);
  if (seededLevel > 1) {
    run(`UPDATE ${tableName} SET ${levelColumn} = ? WHERE player_id = ?`, [seededLevel, playerId]);
  }
  syncManagedBusinessLevel(playerId, businessType, seededLevel);
}

function createPlayerBusiness(playerId, businessType) {
  run(
    `INSERT INTO player_businesses (player_id, business_type, last_collected_at)
     VALUES (?, ?, datetime('now'))`,
    [playerId, businessType]
  );
}

function upgradePlayerBusiness(businessId) {
  run('UPDATE player_businesses SET level = level + 1 WHERE id = ?', [businessId]);
}

function setBusinessLevel(businessId, level) {
  run('UPDATE player_businesses SET level = ? WHERE id = ?', [level, businessId]);
}

function updateBusinessCollectedAt(businessId, isoTimestamp) {
  run('UPDATE player_businesses SET last_collected_at = ? WHERE id = ?', [isoTimestamp, businessId]);
}

function reconcileManagedBusinessState() {
  for (const [businessType, cfg] of Object.entries(MANAGED_BUSINESS_LEVEL_CONFIG)) {
    const managedRows = queryAll(`SELECT player_id, ${cfg.levelColumn} AS level FROM ${cfg.table}`);
    for (const row of managedRows) {
      syncManagedBusinessLevel(row.player_id, businessType, row.level || 1);
    }

    const missingOwnedRows = queryAll(
      `SELECT pb.player_id, pb.level
       FROM player_businesses pb
       LEFT JOIN ${cfg.table} managed ON managed.player_id = pb.player_id
       WHERE pb.business_type = ? AND managed.player_id IS NULL`,
      [businessType]
    );

    for (const row of missingOwnedRows) {
      switch (businessType) {
        case 'pizza':
          createPizzaShop(row.player_id);
          break;
        case 'newspaper':
          createNewspaperRoute(row.player_id);
          break;
        case 'carwash':
          createCarwashShop(row.player_id);
          break;
        case 'stockmogul':
          createStockMogulPortfolio(row.player_id);
          break;
        case 'gym':
          createGymClub(row.player_id);
          break;
        case 'cinema':
          createCinemaTheater(row.player_id);
          break;
        case 'startup':
          createStartupHub(row.player_id);
          break;
        case 'bank':
          createBankVault(row.player_id);
          break;
      }
    }
  }
}

// Session operations

function createSession() {
  run("INSERT INTO stream_sessions (started_at) VALUES (datetime('now'))");
  save();
  return queryOne('SELECT * FROM stream_sessions ORDER BY id DESC LIMIT 1');
}

function updateSessionTaps(sessionId, tapsToAdd) {
  run('UPDATE stream_sessions SET total_taps = total_taps + ? WHERE id = ?', [tapsToAdd, sessionId]);
}

function updateSessionCoins(sessionId, coinsToAdd) {
  run('UPDATE stream_sessions SET total_coins_earned = total_coins_earned + ? WHERE id = ?', [coinsToAdd, sessionId]);
}

function updateSessionPlayers(sessionId, count) {
  run('UPDATE stream_sessions SET unique_players = ? WHERE id = ?', [count, sessionId]);
}

function getSession(sessionId) {
  return queryOne('SELECT * FROM stream_sessions WHERE id = ?', [sessionId]);
}

// Event log

let _eventLogCount = -1; // lazy-initialized
const EVENT_LOG_MAX = 500;
const EVENT_LOG_PRUNE_THRESHOLD = 600; // prune when 20% over max

function logEvent(eventType, playerName, detail) {
  run(
    "INSERT INTO event_log (event_type, player_name, detail) VALUES (?, ?, ?)",
    [eventType, playerName, JSON.stringify(detail || {})]
  );
  // Lazy-init count on first call
  if (_eventLogCount < 0) {
    _eventLogCount = queryScalar("SELECT COUNT(*) as c FROM event_log") || 0;
  }
  _eventLogCount++;
  // Only prune when threshold exceeded (avoids expensive DELETE on every insert)
  if (_eventLogCount > EVENT_LOG_PRUNE_THRESHOLD) {
    run("DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT ?)", [EVENT_LOG_MAX]);
    _eventLogCount = EVENT_LOG_MAX;
  }
}

function getRecentEvents(limit = 20) {
  return queryAll(
    'SELECT * FROM event_log ORDER BY id DESC LIMIT ?',
    [limit]
  );
}

// Cosmetic operations

function getPlayerEquippedCosmetics(playerId) {
  return queryAll(
    `SELECT c.category, c.css_property FROM player_cosmetics pc
     JOIN cosmetics c ON c.id = pc.cosmetic_id
     WHERE pc.player_id = ? AND pc.equipped = 1`,
    [playerId]
  );
}

function getPlayerOwnedCosmetics(playerId) {
  return queryAll(
    `SELECT pc.cosmetic_id, pc.equipped, c.category, c.name, c.rarity, c.cost, c.css_property
     FROM player_cosmetics pc
     JOIN cosmetics c ON c.id = pc.cosmetic_id
     WHERE pc.player_id = ?
     ORDER BY c.sort_order`,
    [playerId]
  );
}

function searchPlayers(term, limit = 20) {
  // Support #ID syntax for exact player ID lookup
  const idMatch = term.match(/^#(\d+)$/);
  if (idMatch) {
    return queryAll(
      `SELECT id, platform, platform_user_id, username, display_name, xp AS coins
       FROM players
       WHERE id = ?`,
      [parseInt(idMatch[1])]
    );
  }
  const like = `%${term}%`;
  return queryAll(
    `SELECT id, platform, platform_user_id, username, display_name, xp AS coins
     FROM players
     WHERE display_name LIKE ? OR username LIKE ?
     ORDER BY last_seen DESC
     LIMIT ?`,
    [like, like, limit]
  );
}

function searchDiscordPlayers(term, limit = 20) {
  const like = `%${term}%`;
  return queryAll(
    `SELECT id, platform, platform_user_id, username, display_name, xp AS coins
     FROM players
     WHERE platform IN ('discord', 'mobile')
       AND (display_name LIKE ? OR username LIKE ? OR platform_user_id LIKE ?)
     ORDER BY last_seen DESC
     LIMIT ?`,
    [like, like, like, limit]
  );
}

function getPlayerById(playerId) {
  return queryOne('SELECT * FROM players WHERE id = ?', [playerId]);
}

function grantCosmetic(playerId, cosmeticId) {
  run(
    `INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 0)`,
    [playerId, cosmeticId]
  );
  save();
}

function revokeCosmetic(playerId, cosmeticId) {
  run(
    'DELETE FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
    [playerId, cosmeticId]
  );
  save();
}

/**
 * Get all linked player IDs given a single player ID.
 * Looks up the player's platform, finds their discord user, then resolves all linked IDs.
 * Falls back to just [playerId] if no links exist.
 */
function getAllPlayerIdsFromPlayer(playerId) {
  const player = queryOne('SELECT platform, platform_user_id FROM players WHERE id = ?', [playerId]);
  if (!player) return [playerId];

  let discordUserId = null;
  if (player.platform === 'discord' || player.platform === 'mobile' || player.platform === 'web') {
    discordUserId = String(player.platform_user_id || '');
    if (discordUserId.startsWith('discord_')) {
      discordUserId = discordUserId.slice('discord_'.length);
    }
  } else {
    discordUserId = getDiscordUserForPlatform(player.platform, player.platform_user_id);
  }

  if (!discordUserId) return [playerId];
  const allIds = getAllPlayerIdsForDiscord(discordUserId);
  return allIds.length > 0 ? allIds : [playerId];
}

function getTaxSeasonPlayerIds(playerId) {
  const ids = getAllPlayerIdsFromPlayer(playerId).filter(Boolean);
  return ids.length > 0 ? Array.from(new Set(ids.map(id => Number(id)).filter(Number.isFinite))) : [playerId];
}

function getTaxSeasonState(playerId) {
  const playerIds = getTaxSeasonPlayerIds(playerId);
  const placeholders = playerIds.map(() => '?').join(',');
  const rows = queryAll(
    `SELECT id, tax_season_completed, tax_season_completed_at, tax_season_trigger_business,
            tax_season_bonus_multiplier, tax_season_reset_reason
     FROM players
     WHERE id IN (${placeholders})
     ORDER BY tax_season_completed DESC, tax_season_completed_at DESC, id ASC`,
    playerIds
  );

  const canonical = rows[0] || null;
  const completed = rows.some(r => Number(r.tax_season_completed) === 1);
  const multiplier = rows.reduce((max, row) => Math.max(max, Number(row.tax_season_bonus_multiplier) || 1), 1);
  const mismatched = rows.some(row =>
    Number(row.tax_season_completed || 0) !== (completed ? 1 : 0) ||
    (Number(row.tax_season_bonus_multiplier) || 1) !== multiplier ||
    (row.tax_season_completed_at || null) !== (canonical?.tax_season_completed_at || null) ||
    (row.tax_season_trigger_business || null) !== (canonical?.tax_season_trigger_business || null) ||
    (row.tax_season_reset_reason || null) !== (canonical?.tax_season_reset_reason || null)
  );

  return {
    playerIds,
    completed,
    completedAt: canonical?.tax_season_completed_at || null,
    triggerBusiness: canonical?.tax_season_trigger_business || null,
    bonusMultiplier: multiplier,
    resetReason: canonical?.tax_season_reset_reason || null,
    mismatched,
    rows
  };
}

function updateTaxSeasonState(playerId, fields = {}) {
  const playerIds = getTaxSeasonPlayerIds(playerId);
  const assignments = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(fields, 'tax_season_completed')) {
    assignments.push('tax_season_completed = ?');
    params.push(fields.tax_season_completed ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'tax_season_completed_at')) {
    assignments.push('tax_season_completed_at = ?');
    params.push(fields.tax_season_completed_at || null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'tax_season_trigger_business')) {
    assignments.push('tax_season_trigger_business = ?');
    params.push(fields.tax_season_trigger_business || null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'tax_season_bonus_multiplier')) {
    assignments.push('tax_season_bonus_multiplier = ?');
    params.push(Number(fields.tax_season_bonus_multiplier) || 1.0);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'tax_season_reset_reason')) {
    assignments.push('tax_season_reset_reason = ?');
    params.push(fields.tax_season_reset_reason || null);
  }

  if (assignments.length === 0) return getTaxSeasonState(playerId);

  const placeholders = playerIds.map(() => '?').join(',');
  run(`UPDATE players SET ${assignments.join(', ')} WHERE id IN (${placeholders})`, [...params, ...playerIds]);
  save();
  return getTaxSeasonState(playerId);
}

function recordTaxSeasonAudit(playerId, {
  triggerBusiness = 'carwash',
  bonusMultiplier = 1.0,
  resetReason = null,
  snapshot = null
} = {}) {
  run(
    `INSERT INTO tax_season_audit
     (player_id, trigger_business, bonus_multiplier, reset_reason, snapshot_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      playerId,
      triggerBusiness,
      Number(bonusMultiplier) || 1.0,
      resetReason,
      snapshot == null ? null : JSON.stringify(snapshot)
    ]
  );
  save();
}

function getTaxSeasonAudit(playerId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  return queryAll(
    `SELECT id, player_id, trigger_business, bonus_multiplier, reset_reason, snapshot_json, created_at
     FROM tax_season_audit
     WHERE player_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [playerId, safeLimit]
  ).map(row => ({
    ...row,
    snapshot: row.snapshot_json ? (() => {
      try { return JSON.parse(row.snapshot_json); } catch (_) { return null; }
    })() : null
  }));
}

function resolveManagedBusinessPlayerByDiscord(discordUserId, tableName) {
  const unified = resolveUnifiedPlayerByDiscord(discordUserId);
  const allIds = getAllPlayerIdsForDiscord(discordUserId);
  if (allIds.length === 0) return unified || null;

  const placeholders = allIds.map(() => '?').join(',');
  const row = queryOne(
    `SELECT player_id
     FROM ${tableName}
     WHERE player_id IN (${placeholders})
     ORDER BY player_id ASC
     LIMIT 1`,
    allIds
  );
  if (row?.player_id) {
    const player = queryOne('SELECT * FROM players WHERE id = ?', [row.player_id]);
    if (player) return player;
  }

  return unified || null;
}

function adminEquipCosmetic(playerId, cosmeticId, equip) {
  if (equip) {
    // Get the category of this cosmetic
    const cosmetic = queryOne('SELECT category FROM cosmetics WHERE id = ?', [cosmeticId]);
    if (cosmetic) {
      // Unequip others in same category across ALL linked players
      const allIds = getAllPlayerIdsFromPlayer(playerId);
      const ph = allIds.map(() => '?').join(',');
      run(
        `UPDATE player_cosmetics SET equipped = 0
         WHERE player_id IN (${ph}) AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
        [...allIds, cosmetic.category]
      );
    }
    run(
      'UPDATE player_cosmetics SET equipped = 1 WHERE player_id = ? AND cosmetic_id = ?',
      [playerId, cosmeticId]
    );
  } else {
    run(
      'UPDATE player_cosmetics SET equipped = 0 WHERE player_id = ? AND cosmetic_id = ?',
      [playerId, cosmeticId]
    );
  }
  save();
}

// ==================== ACCOUNT LINKING ====================
// All identity logic (merge, verification codes, account preferences, overview,
// linked groups, potential matches) extracted to src/identity.js.
// Delegate accessors defined above preserve the db.* export shape.
// ==================== DAILY COMPLETIONS ====================

function hasDailyCompletion(playerId, game, date) {
  return queryOne(
    'SELECT id FROM daily_completions WHERE player_id = ? AND game = ? AND date = ?',
    [playerId, game, date]
  ) !== null;
}

function recordDailyCompletion(playerId, game, date, coinsAwarded) {
  try {
    run(
      'INSERT INTO daily_completions (player_id, game, date, coins_awarded) VALUES (?, ?, ?, ?)',
      [playerId, game, date, coinsAwarded]
    );
    return true;
  } catch (err) {
    // UNIQUE constraint violation means already completed today
    return false;
  }
}

function getDailyCompletions(playerId, date) {
  return queryAll(
    'SELECT * FROM daily_completions WHERE player_id = ? AND date = ?',
    [playerId, date]
  );
}

// ==================== WEEKLY COMPLETIONS ====================

function hasWeeklyCompletion(playerId, game, weekStart) {
  return queryOne(
    'SELECT id FROM weekly_completions WHERE player_id = ? AND game = ? AND week_start = ?',
    [playerId, game, weekStart]
  ) !== null;
}

function recordWeeklyCompletion(playerId, game, weekStart, coinsAwarded) {
  try {
    run(
      'INSERT INTO weekly_completions (player_id, game, week_start, coins_awarded) VALUES (?, ?, ?, ?)',
      [playerId, game, weekStart, coinsAwarded]
    );
    return true;
  } catch (err) {
    // UNIQUE constraint violation means already completed this week
    return false;
  }
}

function getWeeklyCompletions(playerId, weekStart) {
  return queryAll(
    'SELECT * FROM weekly_completions WHERE player_id = ? AND week_start = ?',
    [playerId, weekStart]
  );
}

// ==================== DAILY CLAIM STREAKS ====================

function getStreakState(discordUserId) {
  return queryOne('SELECT * FROM streak_state WHERE discord_user_id = ?', [discordUserId]);
}

function upsertStreakState(discordUserId, streak, longestStreak, claimDate, totalClaims, totalXp, milestoneTitles) {
  const existing = getStreakState(discordUserId);
  if (existing) {
    run(
      `UPDATE streak_state SET current_streak = ?, longest_streak = ?, last_claim_date = ?,
       total_claims = ?, total_xp_from_claims = ?, milestone_titles_awarded = ?,
       updated_at = datetime('now') WHERE discord_user_id = ?`,
      [streak, longestStreak, claimDate, totalClaims, totalXp, milestoneTitles, discordUserId]
    );
  } else {
    run(
      `INSERT INTO streak_state (discord_user_id, current_streak, longest_streak, last_claim_date,
       total_claims, total_xp_from_claims, milestone_titles_awarded)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [discordUserId, streak, longestStreak, claimDate, totalClaims, totalXp, milestoneTitles]
    );
  }
}

function insertDailyClaim(discordUserId, claimDate, xpAwarded, streakDay, isMilestone, milestoneType, cosmeticAwarded, progressionMult) {
  try {
    run(
      `INSERT INTO daily_claims (discord_user_id, claim_date, xp_awarded, streak_day, is_milestone, milestone_type, cosmetic_awarded, progression_mult)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [discordUserId, claimDate, xpAwarded, streakDay, isMilestone ? 1 : 0, milestoneType, cosmeticAwarded ? 1 : 0, progressionMult]
    );
    return true;
  } catch (err) {
    // UNIQUE constraint = already claimed today
    return false;
  }
}

function hasDailyClaim(discordUserId, claimDate) {
  return queryOne('SELECT id FROM daily_claims WHERE discord_user_id = ? AND claim_date = ?', [discordUserId, claimDate]) !== null;
}

function getDailyClaimHistory(discordUserId, limit = 30) {
  return queryAll('SELECT * FROM daily_claims WHERE discord_user_id = ? ORDER BY claim_date DESC LIMIT ?', [discordUserId, limit]);
}

// ==================== MEMBERSHIP + MONTHLY PASS ====================

function getMembership(discordUserId) {
  if (!discordUserId) return null;
  const row = queryOne('SELECT * FROM player_memberships WHERE discord_user_id = ?', [discordUserId]);
  if (!row) {
    return {
      discord_user_id: discordUserId,
      tier: 'free',
      status: 'inactive',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: 0,
      last_monthly_grant_at: null,
      created_at: null,
      updated_at: null
    };
  }
  return row;
}

function upsertMembership(discordUserId, fields = {}) {
  if (!discordUserId) return { ok: false, message: 'Missing discordUserId' };
  const existing = queryOne('SELECT discord_user_id FROM player_memberships WHERE discord_user_id = ?', [discordUserId]);
  const normalized = {
    tier: fields.tier || 'free',
    status: fields.status || 'inactive',
    stripe_customer_id: Object.prototype.hasOwnProperty.call(fields, 'stripe_customer_id') ? (fields.stripe_customer_id || null) : undefined,
    stripe_subscription_id: Object.prototype.hasOwnProperty.call(fields, 'stripe_subscription_id') ? (fields.stripe_subscription_id || null) : undefined,
    current_period_start: Object.prototype.hasOwnProperty.call(fields, 'current_period_start') ? (fields.current_period_start || null) : undefined,
    current_period_end: Object.prototype.hasOwnProperty.call(fields, 'current_period_end') ? (fields.current_period_end || null) : undefined,
    cancel_at_period_end: Object.prototype.hasOwnProperty.call(fields, 'cancel_at_period_end') ? (fields.cancel_at_period_end ? 1 : 0) : undefined,
    last_monthly_grant_at: Object.prototype.hasOwnProperty.call(fields, 'last_monthly_grant_at') ? (fields.last_monthly_grant_at || null) : undefined
  };

  if (existing) {
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(normalized)) {
      if (value === undefined) continue;
      assignments.push(`${key} = ?`);
      params.push(value);
    }
    assignments.push("updated_at = datetime('now')");
    run(
      `UPDATE player_memberships SET ${assignments.join(', ')} WHERE discord_user_id = ?`,
      [...params, discordUserId]
    );
  } else {
    run(
      `INSERT INTO player_memberships
       (discord_user_id, tier, status, stripe_customer_id, stripe_subscription_id,
        current_period_start, current_period_end, cancel_at_period_end, last_monthly_grant_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        discordUserId,
        normalized.tier,
        normalized.status,
        normalized.stripe_customer_id === undefined ? null : normalized.stripe_customer_id,
        normalized.stripe_subscription_id === undefined ? null : normalized.stripe_subscription_id,
        normalized.current_period_start === undefined ? null : normalized.current_period_start,
        normalized.current_period_end === undefined ? null : normalized.current_period_end,
        normalized.cancel_at_period_end === undefined ? 0 : normalized.cancel_at_period_end,
        normalized.last_monthly_grant_at === undefined ? null : normalized.last_monthly_grant_at
      ]
    );
  }

  save();
  return { ok: true, membership: getMembership(discordUserId) };
}

function setMembershipStatus(discordUserId, status, extraFields = {}) {
  return upsertMembership(discordUserId, { ...extraFields, status });
}


function hasMembershipGrant(discordUserId, membershipTier, periodKey) {
  return queryOne(
    'SELECT 1 FROM membership_grants WHERE discord_user_id = ? AND membership_tier = ? AND period_key = ?',
    [discordUserId, membershipTier, periodKey]
  ) !== null;
}

function recordMembershipGrant(discordUserId, membershipTier, periodKey, giftCoinsAwarded) {
  try {
    run(
      `INSERT INTO membership_grants (discord_user_id, membership_tier, period_key, gift_coins_awarded)
       VALUES (?, ?, ?, ?)`,
      [discordUserId, membershipTier, periodKey, Math.max(0, Math.floor(Number(giftCoinsAwarded) || 0))]
    );
    save();
    return { ok: true };
  } catch (err) {
    return { ok: false, alreadyGranted: true, message: 'Monthly membership grant already recorded' };
  }
}

function getMembershipGrantHistory(discordUserId, limit = 24) {
  if (!discordUserId) return [];
  return queryAll(
    'SELECT * FROM membership_grants WHERE discord_user_id = ? ORDER BY granted_at DESC LIMIT ?',
    [discordUserId, limit]
  );
}

// ==================== GENERATED COSMETICS (LOOT BOX) ====================

/**
 * Check if a player already received a generated cosmetic for a given date.
 */
function hasGeneratedCosmeticForDate(playerId, date) {
  return queryOne(
    'SELECT id FROM generated_cosmetics WHERE player_id = ? AND date_awarded = ?',
    [playerId, date]
  ) !== null;
}

/**
 * Insert a generated cosmetic record + cosmetics table + player_cosmetics grant.
 * Returns true on success, false if duplicate (already awarded today).
 */
function insertGeneratedCosmetic(playerId, id, seed, category, rarity, name, date, cssJson) {
  try {
    // 1. Record in generated_cosmetics tracking table
    run(
      `INSERT INTO generated_cosmetics (id, player_id, seed, category, rarity, name, date_awarded)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, playerId, seed, category, rarity, name, date]
    );
    // 2. Insert into cosmetics table so JOINs/rendering work unchanged
    run(
      `INSERT OR IGNORE INTO cosmetics (id, category, name, description, rarity, cost, css_property, sort_order)
       VALUES (?, ?, ?, ?, ?, 0, ?, 999)`,
      [id, category, name, 'Daily loot box reward', rarity, cssJson]
    );
    // 3. Grant to player (unequipped — player chooses to equip)
    run(
      `INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped)
       VALUES (?, ?, 0)`,
      [playerId, id]
    );
    save();
    return true;
  } catch (err) {
    // UNIQUE constraint violation — already awarded today
    return false;
  }
}

/**
 * Get all generated cosmetics for a player (most recent first).
 */
function getGeneratedCosmetics(playerId) {
  return queryAll(
    `SELECT gc.*, c.css_property FROM generated_cosmetics gc
     LEFT JOIN cosmetics c ON c.id = gc.id
     WHERE gc.player_id = ?
     ORDER BY gc.date_awarded DESC`,
    [playerId]
  );
}

// ==================== PIZZA SHOP FUNCTIONS ====================

/**
 * Find the pizza shop player across all linked accounts for a Discord user.
 * Returns the player object whose ID has a pizza_shops entry, or falls back to primary player.
 */
function resolvePizzaPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'pizza_shops');
}

function getPizzaShop(playerId) {
  return queryOne('SELECT * FROM pizza_shops WHERE player_id = ?', [playerId]);
}

function createPizzaShop(playerId) {
  const existing = getPizzaShop(playerId);
  if (existing) return existing;
  run(
    `INSERT INTO pizza_shops (player_id) VALUES (?)`,
    [playerId]
  );
  seedManagedBusinessLevel(playerId, 'pizza', 'shop_level', 'pizza_shops');
  save();
  return getPizzaShop(playerId);
}

function updatePizzaShop(playerId, fields) {
  const allowed = ['shop_name', 'prestige_level', 'shop_level', 'shop_xp',
                    'pizza_coins', 'total_pizzas_served', 'total_coins_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE pizza_shops SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.shop_level)) syncManagedBusinessLevel(playerId, 'pizza', fields.shop_level);
}

function getPizzaUpgrades(playerId) {
  return queryAll('SELECT * FROM pizza_upgrades WHERE player_id = ?', [playerId]);
}

function getPizzaUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM pizza_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setPizzaUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO pizza_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getPizzaCustomizations(playerId) {
  return queryAll('SELECT * FROM pizza_customizations WHERE player_id = ?', [playerId]);
}

function setPizzaCustomization(playerId, category, value) {
  run(
    `INSERT INTO pizza_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_PRESTIGE_LEVEL = 10;

function prestigePizzaShop(playerId) {
  const shop = getPizzaShop(playerId);
  if (!shop) return { ok: false, message: 'No pizza shop found' };
  if (shop.shop_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (shop.prestige_level >= MAX_PRESTIGE_LEVEL) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_PRESTIGE_LEVEL})` };
  }

  const newPrestige = shop.prestige_level + 1;
  run(
    `UPDATE pizza_shops SET prestige_level = ?, shop_level = 1, shop_xp = 0, pizza_coins = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  // Reset all upgrades
  run('DELETE FROM pizza_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'pizza', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deletePizzaShopData(playerId) {
  run('DELETE FROM pizza_shops WHERE player_id = ?', [playerId]);
  run('DELETE FROM pizza_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM pizza_customizations WHERE player_id = ?', [playerId]);
}

// ==================== NEWSPAPER ROUTE FUNCTIONS ====================

/**
 * Find the newspaper route player across all linked accounts for a Discord user.
 */
function resolveNewspaperPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'newspaper_routes');
}

function getNewspaperRoute(playerId) {
  return queryOne('SELECT * FROM newspaper_routes WHERE player_id = ?', [playerId]);
}

function createNewspaperRoute(playerId) {
  const existing = getNewspaperRoute(playerId);
  if (existing) return existing;
  run(
    `INSERT INTO newspaper_routes (player_id) VALUES (?)`,
    [playerId]
  );
  seedManagedBusinessLevel(playerId, 'newspaper', 'route_level', 'newspaper_routes');
  save();
  return getNewspaperRoute(playerId);
}

function updateNewspaperRoute(playerId, fields) {
  const allowed = ['route_name', 'prestige_level', 'route_level', 'route_xp',
                    'total_papers_delivered', 'total_xp_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE newspaper_routes SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.route_level)) syncManagedBusinessLevel(playerId, 'newspaper', fields.route_level);
}

function getNewspaperUpgrades(playerId) {
  return queryAll('SELECT * FROM newspaper_upgrades WHERE player_id = ?', [playerId]);
}

function getNewspaperUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM newspaper_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setNewspaperUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO newspaper_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getNewspaperCustomizations(playerId) {
  return queryAll('SELECT * FROM newspaper_customizations WHERE player_id = ?', [playerId]);
}

function setNewspaperCustomization(playerId, category, value) {
  run(
    `INSERT INTO newspaper_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_NEWSPAPER_PRESTIGE = 10;

function prestigeNewspaperRoute(playerId) {
  const route = getNewspaperRoute(playerId);
  if (!route) return { ok: false, message: 'No newspaper route found' };
  if (route.route_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (route.prestige_level >= MAX_NEWSPAPER_PRESTIGE) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_NEWSPAPER_PRESTIGE})` };
  }

  const newPrestige = route.prestige_level + 1;
  run(
    `UPDATE newspaper_routes SET prestige_level = ?, route_level = 1, route_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  // Reset all upgrades
  run('DELETE FROM newspaper_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'newspaper', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deleteNewspaperRouteData(playerId) {
  run('DELETE FROM newspaper_routes WHERE player_id = ?', [playerId]);
  run('DELETE FROM newspaper_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM newspaper_customizations WHERE player_id = ?', [playerId]);
}

// ==================== CAR WASH FUNCTIONS ====================

/**
 * Find the carwash player across all linked accounts for a Discord user.
 */
function resolveCarwashPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'carwash_shops');
}

function getCarwashShop(playerId) {
  return queryOne('SELECT * FROM carwash_shops WHERE player_id = ?', [playerId]);
}

function createCarwashShop(playerId) {
  const existing = getCarwashShop(playerId);
  if (existing) return existing;
  run(`INSERT INTO carwash_shops (player_id) VALUES (?)`, [playerId]);
  seedManagedBusinessLevel(playerId, 'carwash', 'shop_level', 'carwash_shops');
  save();
  return getCarwashShop(playerId);
}

function updateCarwashShop(playerId, fields) {
  const allowed = ['shop_name','prestige_level','shop_level','shop_xp','clean_cash','total_cars_washed','total_clean_earned','last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE carwash_shops SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.shop_level)) syncManagedBusinessLevel(playerId, 'carwash', fields.shop_level);
}

function getCarwashUpgrades(playerId) {
  return queryAll('SELECT * FROM carwash_upgrades WHERE player_id = ?', [playerId]);
}

function getCarwashUpgrade(playerId, upgradeType) {
  return queryOne('SELECT * FROM carwash_upgrades WHERE player_id = ? AND upgrade_type = ?', [playerId, upgradeType]);
}

function upsertCarwashUpgrade(playerId, upgradeType, level) {
  const existing = getCarwashUpgrade(playerId, upgradeType);
  if (existing) {
    run('UPDATE carwash_upgrades SET level = ? WHERE player_id = ? AND upgrade_type = ?', [level, playerId, upgradeType]);
  } else {
    run('INSERT INTO carwash_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)', [playerId, upgradeType, level]);
  }
}

function deleteCarwashUpgrades(playerId) {
  run('DELETE FROM carwash_upgrades WHERE player_id = ?', [playerId]);
}

function getCarwashCustomizations(playerId) {
  return queryAll('SELECT * FROM carwash_customizations WHERE player_id = ?', [playerId]);
}

function upsertCarwashCustomization(playerId, category, value) {
  const existing = queryOne('SELECT * FROM carwash_customizations WHERE player_id = ? AND category = ?', [playerId, category]);
  if (existing) {
    run('UPDATE carwash_customizations SET value = ? WHERE player_id = ? AND category = ?', [value, playerId, category]);
  } else {
    run('INSERT INTO carwash_customizations (player_id, category, value) VALUES (?, ?, ?)', [playerId, category, value]);
  }
}

function prestigeCarwashShop(playerId) {
  const shop = getCarwashShop(playerId);
  if (!shop) return null;
  const newPrestige = shop.prestige_level + 1;
  run(
    `UPDATE carwash_shops SET prestige_level = ?, shop_level = 1, shop_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM carwash_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'carwash', 1);
  save();
  return getCarwashShop(playerId);
}

function deleteCarwashShopData(playerId) {
  run('DELETE FROM carwash_shops WHERE player_id = ?', [playerId]);
  run('DELETE FROM carwash_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM carwash_customizations WHERE player_id = ?', [playerId]);
}

// ==================== STOCK MOGUL ====================

/**
 * Find the stockmogul player across all linked accounts for a Discord user.
 */
function resolveStockMogulPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'stockmogul_portfolios');
}

function getStockMogulPortfolio(playerId) {
  return queryOne('SELECT * FROM stockmogul_portfolios WHERE player_id = ?', [playerId]);
}

function createStockMogulPortfolio(playerId) {
  const existing = getStockMogulPortfolio(playerId);
  if (existing) return existing;
  run(`INSERT INTO stockmogul_portfolios (player_id) VALUES (?)`, [playerId]);
  seedManagedBusinessLevel(playerId, 'stockmogul', 'portfolio_level', 'stockmogul_portfolios');
  save();
  return getStockMogulPortfolio(playerId);
}

function updateStockMogulPortfolio(playerId, fields) {
  const allowed = ['portfolio_name','prestige_level','portfolio_level','portfolio_xp','portfolio_coins','total_trades','total_coins_earned','last_collected_at'];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE stockmogul_portfolios SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.portfolio_level)) syncManagedBusinessLevel(playerId, 'stockmogul', fields.portfolio_level);
}

function getStockMogulUpgrades(playerId) {
  return queryAll('SELECT * FROM stockmogul_upgrades WHERE player_id = ?', [playerId]);
}

function getStockMogulUpgrade(playerId, upgradeType) {
  return queryOne('SELECT * FROM stockmogul_upgrades WHERE player_id = ? AND upgrade_type = ?', [playerId, upgradeType]);
}

function upsertStockMogulUpgrade(playerId, upgradeType, level) {
  const existing = getStockMogulUpgrade(playerId, upgradeType);
  if (existing) {
    run('UPDATE stockmogul_upgrades SET level = ? WHERE player_id = ? AND upgrade_type = ?', [level, playerId, upgradeType]);
  } else {
    run('INSERT INTO stockmogul_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)', [playerId, upgradeType, level]);
  }
}

function deleteStockMogulUpgrades(playerId) {
  run('DELETE FROM stockmogul_upgrades WHERE player_id = ?', [playerId]);
}

function getStockMogulCustomizations(playerId) {
  return queryAll('SELECT * FROM stockmogul_customizations WHERE player_id = ?', [playerId]);
}

function upsertStockMogulCustomization(playerId, category, value) {
  const existing = queryOne('SELECT * FROM stockmogul_customizations WHERE player_id = ? AND category = ?', [playerId, category]);
  if (existing) {
    run('UPDATE stockmogul_customizations SET value = ? WHERE player_id = ? AND category = ?', [value, playerId, category]);
  } else {
    run('INSERT INTO stockmogul_customizations (player_id, category, value) VALUES (?, ?, ?)', [playerId, category, value]);
  }
}

function prestigeStockMogulPortfolio(playerId) {
  const port = getStockMogulPortfolio(playerId);
  if (!port) return null;
  const newPrestige = port.prestige_level + 1;
  run(
    `UPDATE stockmogul_portfolios SET prestige_level = ?, portfolio_level = 1, portfolio_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM stockmogul_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'stockmogul', 1);
  save();
  return getStockMogulPortfolio(playerId);
}

function deleteStockMogulData(playerId) {
  run('DELETE FROM stockmogul_portfolios WHERE player_id = ?', [playerId]);
  run('DELETE FROM stockmogul_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM stockmogul_customizations WHERE player_id = ?', [playerId]);
}

// ==================== GYM ====================

/**
 * Find the gym player across all linked accounts for a Discord user.
 */
function resolveGymPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'gym_clubs');
}

function getGymClub(playerId) {
  return queryOne('SELECT * FROM gym_clubs WHERE player_id = ?', [playerId]);
}

function createGymClub(playerId) {
  const existing = getGymClub(playerId);
  if (existing) return existing;
  run('INSERT INTO gym_clubs (player_id) VALUES (?)', [playerId]);
  seedManagedBusinessLevel(playerId, 'gym', 'club_level', 'gym_clubs');
  save();
  return getGymClub(playerId);
}

function updateGymClub(playerId, fields) {
  const allowed = ['club_name', 'prestige_level', 'club_level', 'club_xp', 'gym_points',
    'total_members_trained', 'total_points_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE gym_clubs SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.club_level)) syncManagedBusinessLevel(playerId, 'gym', fields.club_level);
}

function getGymUpgrades(playerId) {
  return queryAll('SELECT * FROM gym_upgrades WHERE player_id = ?', [playerId]);
}

function getGymUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM gym_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setGymUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO gym_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getGymCustomizations(playerId) {
  return queryAll('SELECT * FROM gym_customizations WHERE player_id = ?', [playerId]);
}

function setGymCustomization(playerId, category, value) {
  run(
    `INSERT INTO gym_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_GYM_PRESTIGE = 10;

function prestigeGymClub(playerId) {
  const club = getGymClub(playerId);
  if (!club) return { ok: false, message: 'No gym found' };
  if (club.club_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (club.prestige_level >= MAX_GYM_PRESTIGE) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_GYM_PRESTIGE})` };
  }

  const newPrestige = club.prestige_level + 1;
  run(
    `UPDATE gym_clubs SET prestige_level = ?, club_level = 1, club_xp = 0, gym_points = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM gym_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'gym', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deleteGymClubData(playerId) {
  run('DELETE FROM gym_clubs WHERE player_id = ?', [playerId]);
  run('DELETE FROM gym_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM gym_customizations WHERE player_id = ?', [playerId]);
}

// ==================== CINEMA ====================

function resolveCinemaPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'cinema_theaters');
}

function getCinemaTheater(playerId) {
  return queryOne('SELECT * FROM cinema_theaters WHERE player_id = ?', [playerId]);
}

function createCinemaTheater(playerId) {
  const existing = getCinemaTheater(playerId);
  if (existing) return existing;
  run('INSERT INTO cinema_theaters (player_id) VALUES (?)', [playerId]);
  seedManagedBusinessLevel(playerId, 'cinema', 'theater_level', 'cinema_theaters');
  save();
  return getCinemaTheater(playerId);
}

function updateCinemaTheater(playerId, fields) {
  const allowed = ['theater_name', 'prestige_level', 'theater_level', 'theater_xp',
    'total_viewers_served', 'total_xp_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE cinema_theaters SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.theater_level)) syncManagedBusinessLevel(playerId, 'cinema', fields.theater_level);
}

function getCinemaUpgrades(playerId) {
  return queryAll('SELECT * FROM cinema_upgrades WHERE player_id = ?', [playerId]);
}

function getCinemaUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM cinema_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setCinemaUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO cinema_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getCinemaCustomizations(playerId) {
  return queryAll('SELECT * FROM cinema_customizations WHERE player_id = ?', [playerId]);
}

function setCinemaCustomization(playerId, category, value) {
  run(
    `INSERT INTO cinema_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_CINEMA_PRESTIGE = 10;

function prestigeCinemaTheater(playerId) {
  const theater = getCinemaTheater(playerId);
  if (!theater) return { ok: false, message: 'No cinema found' };
  if (theater.theater_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (theater.prestige_level >= MAX_CINEMA_PRESTIGE) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_CINEMA_PRESTIGE})` };
  }

  const newPrestige = theater.prestige_level + 1;
  run(
    `UPDATE cinema_theaters SET prestige_level = ?, theater_level = 1, theater_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM cinema_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'cinema', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deleteCinemaTheaterData(playerId) {
  run('DELETE FROM cinema_theaters WHERE player_id = ?', [playerId]);
  run('DELETE FROM cinema_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM cinema_customizations WHERE player_id = ?', [playerId]);
}

// ==================== STARTUP ====================

function resolveStartupPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'startup_hubs');
}

function getStartupHub(playerId) {
  return queryOne('SELECT * FROM startup_hubs WHERE player_id = ?', [playerId]);
}

function createStartupHub(playerId) {
  const existing = getStartupHub(playerId);
  if (existing) return existing;
  run('INSERT INTO startup_hubs (player_id) VALUES (?)', [playerId]);
  seedManagedBusinessLevel(playerId, 'startup', 'hub_level', 'startup_hubs');
  save();
  return getStartupHub(playerId);
}

function updateStartupHub(playerId, fields) {
  const allowed = ['hub_name', 'prestige_level', 'hub_level', 'hub_xp',
    'total_users_served', 'total_xp_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE startup_hubs SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.hub_level)) syncManagedBusinessLevel(playerId, 'startup', fields.hub_level);
}

function getStartupUpgrades(playerId) {
  return queryAll('SELECT * FROM startup_upgrades WHERE player_id = ?', [playerId]);
}

function getStartupUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM startup_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setStartupUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO startup_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getStartupCustomizations(playerId) {
  return queryAll('SELECT * FROM startup_customizations WHERE player_id = ?', [playerId]);
}

function setStartupCustomization(playerId, category, value) {
  run(
    `INSERT INTO startup_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_STARTUP_PRESTIGE = 10;

function prestigeStartupHub(playerId) {
  const hub = getStartupHub(playerId);
  if (!hub) return { ok: false, message: 'No startup found' };
  if (hub.hub_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (hub.prestige_level >= MAX_STARTUP_PRESTIGE) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_STARTUP_PRESTIGE})` };
  }

  const newPrestige = hub.prestige_level + 1;
  run(
    `UPDATE startup_hubs SET prestige_level = ?, hub_level = 1, hub_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM startup_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'startup', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deleteStartupHubData(playerId) {
  run('DELETE FROM startup_hubs WHERE player_id = ?', [playerId]);
  run('DELETE FROM startup_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM startup_customizations WHERE player_id = ?', [playerId]);
}

// ==================== BANK ====================

function resolveBankPlayerByDiscord(discordUserId) {
  return resolveManagedBusinessPlayerByDiscord(discordUserId, 'bank_vaults');
}

function getBankVault(playerId) {
  return queryOne('SELECT * FROM bank_vaults WHERE player_id = ?', [playerId]);
}

function createBankVault(playerId) {
  const existing = getBankVault(playerId);
  if (existing) return existing;
  run('INSERT INTO bank_vaults (player_id) VALUES (?)', [playerId]);
  seedManagedBusinessLevel(playerId, 'bank', 'vault_level', 'bank_vaults');
  save();
  return getBankVault(playerId);
}

function updateBankVault(playerId, fields) {
  const allowed = ['vault_name', 'prestige_level', 'vault_level', 'vault_xp',
    'total_clients_served', 'total_xp_earned', 'last_collected_at'];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(playerId);
  run(`UPDATE bank_vaults SET ${sets.join(', ')} WHERE player_id = ?`, vals);
  if (Number.isFinite(fields.vault_level)) syncManagedBusinessLevel(playerId, 'bank', fields.vault_level);
}

function getBankUpgrades(playerId) {
  return queryAll('SELECT * FROM bank_upgrades WHERE player_id = ?', [playerId]);
}

function getBankUpgrade(playerId, upgradeType) {
  return queryOne(
    'SELECT * FROM bank_upgrades WHERE player_id = ? AND upgrade_type = ?',
    [playerId, upgradeType]
  );
}

function setBankUpgrade(playerId, upgradeType, level) {
  run(
    `INSERT INTO bank_upgrades (player_id, upgrade_type, level) VALUES (?, ?, ?)
     ON CONFLICT(player_id, upgrade_type) DO UPDATE SET level = ?`,
    [playerId, upgradeType, level, level]
  );
}

function getBankCustomizations(playerId) {
  return queryAll('SELECT * FROM bank_customizations WHERE player_id = ?', [playerId]);
}

function setBankCustomization(playerId, category, value) {
  run(
    `INSERT INTO bank_customizations (player_id, category, value) VALUES (?, ?, ?)
     ON CONFLICT(player_id, category) DO UPDATE SET value = ?`,
    [playerId, category, value, value]
  );
}

const MAX_BANK_PRESTIGE = 10;

function prestigeBankVault(playerId) {
  const vault = getBankVault(playerId);
  if (!vault) return { ok: false, message: 'No bank found' };
  if (vault.vault_level < 100) return { ok: false, message: 'Must reach level 100 to prestige' };
  if (vault.prestige_level >= MAX_BANK_PRESTIGE) {
    return { ok: false, message: `Already at maximum prestige level (${MAX_BANK_PRESTIGE})` };
  }

  const newPrestige = vault.prestige_level + 1;
  run(
    `UPDATE bank_vaults SET prestige_level = ?, vault_level = 1, vault_xp = 0,
     last_collected_at = datetime('now') WHERE player_id = ?`,
    [newPrestige, playerId]
  );
  run('DELETE FROM bank_upgrades WHERE player_id = ?', [playerId]);
  syncManagedBusinessLevel(playerId, 'bank', 1);
  save();
  return { ok: true, newPrestigeLevel: newPrestige };
}

function deleteBankVaultData(playerId) {
  run('DELETE FROM bank_vaults WHERE player_id = ?', [playerId]);
  run('DELETE FROM bank_upgrades WHERE player_id = ?', [playerId]);
  run('DELETE FROM bank_customizations WHERE player_id = ?', [playerId]);
}

// ==================== GOAT LEADERBOARD ====================

// ── Game Wins ──────────────────────────────────────────────────────────────

const WIN_EVENTS = new Set(['win', 'daily-win', 'weekly-win', 'jackpot-win', 'jackpot', 'mp-daily-win', 'mp-weekly-win']);

function isWinEvent(event) {
  return WIN_EVENTS.has(event);
}

function recordGameWin(playerId, game, event, guessCount, word, coinsAwarded, durationSeconds) {
  run(
    `INSERT INTO game_wins (player_id, game, event, guess_count, word, coins_awarded, duration_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      playerId,
      game,
      event,
      Number.isFinite(guessCount) ? guessCount : null,
      word || null,
      coinsAwarded || 0,
      Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : null
    ]
  );
}

function getGameWonWords(game) {
  return queryAll(
    "SELECT DISTINCT LOWER(word) as word FROM game_wins WHERE game = ? AND word IS NOT NULL AND word != ''",
    [game]
  ).map(r => r.word);
}

function getGameRecent(game, limit = 20) {
  const recent = queryAll(
    `SELECT w.word, w.guess_count, w.duration_seconds, w.created_at, p.display_name, p.platform
     FROM game_wins w
     JOIN players p ON w.player_id = p.id
     WHERE w.game = ? AND w.word IS NOT NULL AND w.word != ''
     ORDER BY w.created_at DESC LIMIT ?`,
    [game, limit]
  );
  const stats = queryOne(
    `SELECT COUNT(*) as totalGames, AVG(guess_count) as avgGuesses
     FROM game_wins
     WHERE game = ? AND word IS NOT NULL AND word != ''`,
    [game]
  );
  return {
    totalGames: stats ? (stats.totalGames || 0) : 0,
    avgGuesses: stats && stats.avgGuesses ? Math.round(stats.avgGuesses) : 0,
    recent: recent.map(r => ({
      word: r.word,
      guessCount: r.guess_count,
      durationSeconds: r.duration_seconds,
      timestamp: r.created_at,
      displayName: r.display_name,
      platform: r.platform
    }))
  };
}

// ── Library Words ─────────────────────────────────────────────────────────
// All library logic extracted to src/library.js.
// Delegate accessors defined above preserve the db.* export shape.

// Wire up both services now that all module-level code is parsed.
_initServices();

function getGameWinCounts(playerIds) {
  if (!playerIds || playerIds.length === 0) return { total: 0 };
  const placeholders = playerIds.map(() => '?').join(',');
  const rows = queryAll(
    `SELECT game, COUNT(*) as wins FROM game_wins
     WHERE player_id IN (${placeholders})
     GROUP BY game`,
    playerIds
  );
  const result = { total: 0 };
  for (const r of rows) {
    const canonical = canonicalGameId(r.game);
    if (!canonical) continue;
    const wins = Number(r.wins) || 0;
    result[canonical] = (result[canonical] || 0) + wins;
    result.total += wins;
  }
  return result;
}

// Linked identity-set expansion extracted to src/identity.js.

function getPlayerGameStats(playerIds, game, historyLimit = 50) {
  if (!playerIds || playerIds.length === 0) {
    return { totalWins: 0, averageGuesses: null, history: [] };
  }
  const placeholders = playerIds.map(() => '?').join(',');

  // Win counts per game
  const counts = getGameWinCounts(playerIds);

  // If a specific game is requested, get detailed history
  if (game) {
    const canonical = canonicalGameId(game);
    if (!canonical) {
      return { totalWins: 0, averageGuesses: null, history: [] };
    }
    const variants = getCanonicalGameVariants(canonical);
    const gamePlaceholders = variants.map(() => '?').join(',');
    const history = queryAll(
      `SELECT game, event, guess_count, word, coins_awarded, created_at
       FROM game_wins
       WHERE player_id IN (${placeholders}) AND game IN (${gamePlaceholders})
       ORDER BY created_at DESC
       LIMIT ?`,
      [...playerIds, ...variants, historyLimit]
    ).map((entry) => ({
      ...entry,
      game: canonicalGameId(entry.game) || entry.game
    }));
    const totalWins = counts[canonical] || 0;
    const withGuesses = history.filter(h => h.guess_count != null);
    const avgGuesses = withGuesses.length > 0
      ? Math.round((withGuesses.reduce((s, h) => s + h.guess_count, 0) / withGuesses.length) * 10) / 10
      : null;
    return { totalWins, averageGuesses: avgGuesses, history };
  }

  // All games summary
  const games = {};
  for (const gk of STAT_GAME_KEYS) {
    if (counts[gk]) {
      const variants = getCanonicalGameVariants(gk);
      const gamePlaceholders = variants.map(() => '?').join(',');
      const history = queryAll(
        `SELECT game, event, guess_count, word, coins_awarded, created_at
         FROM game_wins
         WHERE player_id IN (${placeholders}) AND game IN (${gamePlaceholders})
         ORDER BY created_at DESC
         LIMIT ?`,
        [...playerIds, ...variants, historyLimit]
      ).map((entry) => ({
        ...entry,
        game: canonicalGameId(entry.game) || entry.game
      }));
      const withGuesses = history.filter(h => h.guess_count != null);
      const avgGuesses = withGuesses.length > 0
        ? Math.round((withGuesses.reduce((s, h) => s + h.guess_count, 0) / withGuesses.length) * 10) / 10
        : null;
      games[gk] = { wins: counts[gk], averageGuesses: avgGuesses, history };
    }
  }
  return { totalWins: counts.total, games };
}


// ─── Identity Groups Helper (replaces 6 manual JOINs) ──────────────────────
function buildIdentityGroups() {
  const playerToGroup = {};   // player_id → groupKey
  const groupPlayerIds = {};  // groupKey → Set of player_ids

  // Use centralized identity service for Discord-linked accounts
  const discordIds = queryAll("SELECT DISTINCT discord_user_id FROM linked_accounts");
  const primaryByDiscord = {};
  const prefRows = queryAll("SELECT discord_user_id, primary_player_id FROM account_preferences WHERE primary_player_id IS NOT NULL");
  for (const p of prefRows) {
    primaryByDiscord[p.discord_user_id] = p.primary_player_id;
  }

  for (const row of discordIds) {
    const dId = row.discord_user_id;
    if (!dId) continue;
    const ids = getAllPlayerIdsForDiscord(dId);
    for (const pid of ids) {
      playerToGroup[pid] = dId;
      if (!groupPlayerIds[dId]) groupPlayerIds[dId] = new Set();
      groupPlayerIds[dId].add(pid);
    }
  }

  // Also pull in account_preferences primary players that may not be in linked_accounts
  for (const p of prefRows) {
    if (!groupPlayerIds[p.discord_user_id]) {
      groupPlayerIds[p.discord_user_id] = new Set();
    }
    groupPlayerIds[p.discord_user_id].add(p.primary_player_id);
    playerToGroup[p.primary_player_id] = p.discord_user_id;
  }

  // ── Implicit web↔discord pairing ──
  // This app has no real "web" identity — every login is Discord. So a
  // (web, <snowflake>) row IS the same human as (discord, <same-snowflake>)
  // even when no linked_accounts entry was ever written. Collapse them
  // into the discord groupKey so getGoatLeaderboard's Step 4 sums their
  // stats into a single row instead of emitting two.
  const implicitPairs = queryAll(
    "SELECT w.id AS web_id, d.id AS dc_id, d.platform_user_id AS dc_snowflake "
    + "FROM players w JOIN players d "
    + "ON d.platform = 'discord' AND d.platform_user_id = w.platform_user_id "
    + "WHERE w.platform = 'web' "
    + "AND w.platform_user_id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'"
  );
  for (const pair of implicitPairs) {
    const dId = pair.dc_snowflake;
    if (!groupPlayerIds[dId]) groupPlayerIds[dId] = new Set();
    groupPlayerIds[dId].add(pair.web_id);
    groupPlayerIds[dId].add(pair.dc_id);
    playerToGroup[pair.web_id] = dId;
    playerToGroup[pair.dc_id] = dId;
  }

  // ── Manual exceptions: players who can't be linked automatically ──
  // Isaac: GitHub (web) gh_270206283 ↔ TikTok f0lkh0re
  const manualIsaac = queryAll(`
    SELECT id FROM players
    WHERE (platform = 'web' AND platform_user_id = 'gh_270206283')
       OR (platform = 'tiktok' AND platform_user_id = 'f0lkh0re')
  `);
  if (manualIsaac.length >= 2) {
    const groupKey = 'manual_isaac_f0lkh0re';
    for (const row of manualIsaac) {
      const oldGroup = playerToGroup[row.id];
      if (oldGroup && groupPlayerIds[oldGroup]) {
        groupPlayerIds[oldGroup].delete(row.id);
      }
      playerToGroup[row.id] = groupKey;
      if (!groupPlayerIds[groupKey]) groupPlayerIds[groupKey] = new Set();
      groupPlayerIds[groupKey].add(row.id);
    }
  }

  return { playerToGroup, groupPlayerIds, primaryByDiscord };
}

function getGoatLeaderboard(page = 1, limit = 50, sort = 'coins', options = {}) {
  const offset = (page - 1) * limit;
  const GAME_KEYS = STAT_GAME_KEYS;
  const search = String(options.search || '').trim().toLocaleLowerCase().slice(0, 80);
  const region = String(options.region || 'global').toUpperCase();
  const sortDir = options.sortDir === 'asc' ? 'asc' : 'desc';
  const excludeSuspended = options.excludeSuspended === true;
  const ratedOnly = options.ratedOnly === true;

  // ── Step 1: Build player_id → group mapping via identity service ──
  const { playerToGroup, groupPlayerIds, primaryByDiscord } = buildIdentityGroups();

  // ── Step 2: Build per-player game wins from game_wins table ──
  const winRows = queryAll(
    "SELECT player_id, game, COUNT(*) as wins FROM game_wins WHERE game != 'admin' GROUP BY player_id, game"
  );
  const winsByPlayer = {};
  for (const row of winRows) {
    if (!winsByPlayer[row.player_id]) {
      winsByPlayer[row.player_id] = { total: 0 };
      for (const k of GAME_KEYS) winsByPlayer[row.player_id][k] = 0;
    }
    const entry = winsByPlayer[row.player_id];
    const canonical = canonicalGameId(row.game);
    const wins = Number(row.wins) || 0;
    if (!canonical) continue;
    entry.total += wins;
    if (GAME_KEYS.includes(canonical)) entry[canonical] += wins;
  }

  // ── Step 3: Get ALL active players with stats ──
  const allPlayers = queryAll(`
    SELECT
      p.id, p.platform, p.platform_user_id, p.display_name, p.profile_pic, p.coins, p.xp, p.word_game_xp, p.total_taps, p.created_at, p.last_seen,
      p.library_words, p.country, p.suspended,
      COALESCE(biz.biz_count, 0) AS biz_count,
      COALESCE(biz.total_biz_levels, 0) AS total_biz_levels,
      COALESCE(ps.shop_level, 0) AS pizza_level,
      COALESCE(ps.prestige_level, 0) AS pizza_prestige,
      COALESCE(ps.total_pizzas_served, 0) AS total_pizzas_served
    FROM players p
    LEFT JOIN (
      SELECT player_id, COUNT(*) AS biz_count, SUM(level) AS total_biz_levels
      FROM player_businesses GROUP BY player_id
    ) biz ON biz.player_id = p.id
    LEFT JOIN pizza_shops ps ON ps.player_id = p.id
    WHERE (p.coins > 0
       OR p.xp > 0
       OR p.total_taps > 0
       OR EXISTS (SELECT 1 FROM game_wins gw WHERE gw.player_id = p.id))
       AND NOT (
         p.platform = 'web' AND (
           p.platform_user_id LIKE 'web_guest_%' OR
           p.platform_user_id LIKE 'guest_%' OR
           p.platform_user_id LIKE 'wsguest_%' OR
           p.platform_user_id LIKE 'guest-%' OR
           p.platform_user_id LIKE 'anon_%'
         )
       )
  `);

  // ── Step 4: Consolidate into groups ──
  const groups = {};  // groupKey → consolidated entry
  const seen = new Set();

  for (const p of allPlayers) {
    const discordId = playerToGroup[p.id];
    const groupKey = discordId || `solo_${p.id}`;

    if (!groups[groupKey]) {
      const primaryId = discordId ? primaryByDiscord[discordId] : null;
      groups[groupKey] = {
        groupKey,
        primaryId,
        playerIds: [],
        // Identity keys for ELO lookup — collected from every player record
        // in this group during Step 4. Used by Step 5.7 to compute _sortElo.
        _identityKeys: new Set(),
        // Track platform info for solo Discord players (their platformUserId IS their Discord snowflake)
        _soloPlatform: !discordId ? p.platform : null,
        _soloPlatformUserId: !discordId ? p.platform_user_id : null,
        display_name: p.display_name,
        profile_pic: p.profile_pic,
        country: p.country || null,
        suspended: p.suspended || 0,
        coins: 0,
        xp: 0,
        word_game_xp: 0,
        total_taps: 0,
        library_words: 0,
        biz_count: 0,
        total_biz_levels: 0,
        pizza_level: 0,
        pizza_prestige: 0,
        created_at: p.created_at,
      };
    }

    const g = groups[groupKey];
    g.playerIds.push(p.id);
    if (p.platform && p.platform_user_id) {
      g._identityKeys.add(p.platform + ':' + p.platform_user_id);
      // Snowflake-shaped web IDs are stored under discord: in eloData.
      if (p.platform === 'web' && /^\d{17,20}$/.test(p.platform_user_id)) {
        g._identityKeys.add('discord:' + p.platform_user_id);
      }
    }
    if (discordId) g._identityKeys.add('discord:' + discordId);

    // Sum coins, taps, and library words across all player records
    g.coins += p.coins;
    g.xp += p.xp;
    g.word_game_xp += (p.word_game_xp || 0);
    g.total_taps += p.total_taps;
    g.library_words += (p.library_words || 0);

    // Take best business/pizza stats
    g.biz_count = Math.max(g.biz_count, p.biz_count);
    g.total_biz_levels = Math.max(g.total_biz_levels, p.total_biz_levels);
    g.pizza_level = Math.max(g.pizza_level, p.pizza_level);
    g.pizza_prestige = Math.max(g.pizza_prestige, p.pizza_prestige);

    // Earliest join date
    if (p.created_at && (!g.created_at || p.created_at < g.created_at)) {
      g.created_at = p.created_at;
    }

    // Use primary player's display info, or fallback to player with most coins
    const isPrimary = g.primaryId === p.id;
    if (isPrimary) {
      g.display_name = p.display_name;
      g.profile_pic = p.profile_pic;
      g.country = p.country;
      g.suspended = p.suspended || g.suspended;
    } else if (!g.primaryId && p.xp > (g._maxCoins || 0)) {
      g._maxCoins = p.xp;
      g.display_name = p.display_name;
      g.profile_pic = p.profile_pic;
      g.country = p.country;
      g.suspended = p.suspended || g.suspended;
    }

    // Preserve country from any player that has one
    if (p.country && !g.country) {
      g.country = p.country;
    }
    if (p.suspended && !g.suspended) {
      g.suspended = 1;
    }

    // Track all non-numeric display names + profile pics as fallback candidates
    if (p.display_name && !/^\d{10,}$/.test(p.display_name)) {
      if (!g._bestAltName || p.xp > (g._bestAltCoins || 0)) {
        g._bestAltName = p.display_name;
        g._bestAltPic = p.profile_pic;
        g._bestAltCoins = p.xp;
      }
    }
  }

  // Fix groups where display_name is a raw numeric Discord ID
  for (const g of Object.values(groups)) {
    if (g.display_name && /^\d{10,}$/.test(g.display_name)) {
      let fixed = false;
      if (g.groupKey && !g.groupKey.startsWith('solo_')) {
        // Try linked_accounts: prefer display_name, then non-numeric discord_username
        const laName = queryOne(
          "SELECT display_name FROM linked_accounts WHERE discord_user_id = ? AND display_name IS NOT NULL AND display_name != '' AND display_name NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' LIMIT 1",
          [g.groupKey]
        );
        if (laName && laName.display_name && !/^\d{10,}$/.test(laName.display_name)) {
          g.display_name = laName.display_name;
          fixed = true;
        }
        if (!fixed) {
          const laUser = queryOne(
            "SELECT discord_username FROM linked_accounts WHERE discord_user_id = ? AND discord_username IS NOT NULL AND discord_username NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' LIMIT 1",
            [g.groupKey]
          );
          if (laUser && laUser.discord_username) {
            g.display_name = laUser.discord_username;
            fixed = true;
          }
        }
      }
      if (!fixed && g._bestAltName) {
        g.display_name = g._bestAltName;
        if (!g.profile_pic && g._bestAltPic) g.profile_pic = g._bestAltPic;
      }
    }
  }

  // ── Step 5: Aggregate game wins across all player IDs per group ──
  for (const g of Object.values(groups)) {
    const merged = { total: 0 };
    for (const k of GAME_KEYS) merged[k] = 0;

    for (const pid of g.playerIds) {
      const w = winsByPlayer[pid];
      if (!w) continue;
      merged.total += w.total;
      for (const k of GAME_KEYS) merged[k] += w[k];
    }
    g.wins = merged;
  }

  // ── Step 5.5: Lookup streak state for Discord-linked groups ──
  const streakRows = queryAll(`SELECT discord_user_id, current_streak, longest_streak FROM streak_state`);
  const streakByDiscord = {};
  for (const s of streakRows) {
    streakByDiscord[s.discord_user_id] = {
      current: s.current_streak || 0,
      longest: s.longest_streak || 0
    };
  }
  for (const g of Object.values(groups)) {
    if (!g.groupKey.startsWith('solo_') && streakByDiscord[g.groupKey]) {
      g.current_streak = streakByDiscord[g.groupKey].current;
      g.longest_streak = streakByDiscord[g.groupKey].longest;
    } else {
      g.current_streak = 0;
      g.longest_streak = 0;
    }
  }

  // ── Step 5.7: Compute per-group ELO for sorting ──
  // Lazy-load eloData here so the ELO routes module stays the single source
  // of truth. eloData.games[<game>][identityKey] = { elo, roundsCounted, ... }
  let _eloData = { games: {}, global: {} };
  try { _eloData = require('./routes/elo').eloData || _eloData; } catch (e) {}
  const _MP_ELO_GAMES = ['subtextle', 'wikicontexto', 'rectangled', 'erectangled'];
  for (const g of Object.values(groups)) {
    let legacyGlobal = 0;
    let globalWeightedElo = 0;
    let totalRoundsCounted = 0;
    let gamesParticipated = 0;
    const perGameElo = {};
    const perGameRounds = {};
    for (const key of g._identityKeys) {
      const globalEntry = _eloData.global && _eloData.global[key];
      if (globalEntry && typeof globalEntry === 'object') {
        const rounds = Number(globalEntry.totalRounds) || 0;
        globalWeightedElo += (Number(globalEntry.elo) || 0) * rounds;
        totalRoundsCounted += rounds;
        gamesParticipated = Math.max(gamesParticipated, Number(globalEntry.gamesParticipated) || 0);
      } else if (typeof globalEntry === 'number' && globalEntry > legacyGlobal) {
        legacyGlobal = globalEntry;
      }
      for (const game of _MP_ELO_GAMES) {
        const gameEntry = _eloData.games[game] && _eloData.games[game][key];
        if (!gameEntry) continue;
        const rounds = Number(gameEntry.roundsCounted) || 0;
        const elo = Number(gameEntry.elo) || 0;
        if (rounds > (perGameRounds[game] || 0)
            || (rounds === (perGameRounds[game] || 0) && elo > (perGameElo[game] || 0))) {
          perGameElo[game] = elo;
          perGameRounds[game] = rounds;
        }
      }
    }
    g._sortElo = totalRoundsCounted > 0
      ? Math.round(globalWeightedElo / totalRoundsCounted)
      : legacyGlobal;
    g._sortRoundsCounted = totalRoundsCounted;
    g._sortGamesParticipated = gamesParticipated;
    g._sortPerGameElo = perGameElo;
    g._sortPerGameRounds = perGameRounds;
  }

  // ── Step 6: Sort by requested field DESC, paginate ──
  // sort=coins is a legacy name retained for the API surface; the GOAT page
  // labels and renders the value as XP. Sort by g.xp to match the frontend's
  // sort-and-display logic and stop pagination from eliding rows that have
  // high xp but zero word_game_xp (e.g. older players never touched by the
  // word-game reward path).
  const SORT_FIELDS = {
    coins: g => g.xp,
    total_game_wins: g => g.wins.total,
    total_taps: g => g.total_taps,
    library_words: g => g.library_words,
    biz_count: g => g.biz_count,
    pizza_level: g => g.pizza_level,
    streak: g => g.current_streak || 0,
    longest_streak: g => g.longest_streak || 0,
    // Canonical game sorts (matches the frontend's GAME_LABELS keys).
    word5000: g => g.wins.word5000 || 0,
    word500: g => g.wins.word5000 || 0,
    color500: g => g.wins.color500 || 0,
    colour500: g => g.wins.color500 || 0,
    subtextle: g => g.wins.subtextle || 0,
    searchle: g => g.wins.subtextle || 0,
    betwixt: g => g.wins.betwixt || 0,
    betweenly: g => g.wins.betwixt || 0,
    rectangled: g => g.wins.rectangled || 0,
    squaredle: g => g.wins.rectangled || 0,
    erectangled: g => g.wins.erectangled || 0,
    sproutle: g => g.wins.erectangled || 0,
    unwordle: g => g.wins.unwordle || 0,
    'spelling-bee': g => g.wins['spelling-bee'] || 0,
    spellingbee: g => g.wins['spelling-bee'] || 0,
    wordle: g => g.wins.wordle || 0,
    figural: g => g.wins.figural || 0,
    pixeletters: g => g.wins.pixeletters || 0,
    wikicontexto: g => g.wins.wikicontexto || 0,
    wikisearchle: g => g.wins.wikicontexto || 0,
    wikirectangled: g => g.wins.wikirectangled || 0,
    triangled: g => g.wins.triangled || 0,
    synapse: g => g.wins.synapse || 0,
    'synapse-mp': g => g.wins['synapse-mp'] || 0,
    junkdrawer: g => g.wins.junkdrawer || 0,
    cloudquarry: g => g.wins.cloudquarry || 0,
    letterworks: g => g.wins.letterworks || 0,
    wordfall: g => g.wins.wordfall || 0,
    // ELO sorts — null/zero ELO sinks to the bottom on desc sort.
    elo: g => g._sortElo || 0,
    'elo:subtextle': g => (g._sortPerGameElo && g._sortPerGameElo.subtextle) || 0,
    'elo:searchle': g => (g._sortPerGameElo && g._sortPerGameElo.subtextle) || 0,
    'elo:wikicontexto': g => (g._sortPerGameElo && g._sortPerGameElo.wikicontexto) || 0,
    'elo:wikisearchle': g => (g._sortPerGameElo && g._sortPerGameElo.wikicontexto) || 0,
    'elo:rectangled': g => (g._sortPerGameElo && g._sortPerGameElo.rectangled) || 0,
    'elo:erectangled': g => (g._sortPerGameElo && g._sortPerGameElo.erectangled) || 0,
  };
  const sortFn = SORT_FIELDS[sort] || SORT_FIELDS.coins;
  const regionMap = {
    NA: new Set(['US', 'CA', 'MX']),
    EU: new Set(['GB', 'DE', 'FR', 'SE', 'NL', 'ES', 'IT', 'PL']),
    APAC: new Set(['JP', 'KR', 'AU', 'NZ', 'CN', 'TW', 'SG', 'IN'])
  };
  const eloGameAliases = {
    subtextle: 'subtextle',
    searchle: 'subtextle',
    wikicontexto: 'wikicontexto',
    wikisearchle: 'wikicontexto',
    rectangled: 'rectangled',
    erectangled: 'erectangled'
  };
  const eloGame = sort.startsWith('elo:') ? eloGameAliases[sort.slice(4)] : null;
  const allGroups = Object.values(groups);
  let candidates = allGroups;
  if (excludeSuspended) candidates = candidates.filter(g => !g.suspended);
  if (regionMap[region]) {
    candidates = candidates.filter(g => regionMap[region].has(String(g.country || '').toUpperCase()));
  }
  if (ratedOnly) {
    candidates = candidates.filter(g => eloGame
      ? (g._sortPerGameRounds[eloGame] || 0) >= 5
      : (g._sortRoundsCounted || 0) >= 5);
  }

  const direction = sortDir === 'asc' ? 1 : -1;
  const sorted = candidates.sort((a, b) => {
    const diff = sortFn(a) - sortFn(b);
    if (diff !== 0) return direction * diff;
    const xpDiff = (a.xp || 0) - (b.xp || 0);
    if (xpDiff !== 0) return direction * xpDiff;
    return String(a.display_name || '').localeCompare(String(b.display_name || ''));
  });
  sorted.forEach((group, index) => { group._goatRank = index + 1; });
  const filtered = search
    ? sorted.filter(g => String(g.display_name || '').toLocaleLowerCase().includes(search))
    : sorted;
  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  // ── Step 7: Fetch cosmetics for primary/best player per group ──
  const players = paged.map(g => {
    const cosmeticPlayerId = g.primaryId || g.playerIds[0];
    const equipped_cosmetics = queryAll(`
      SELECT pc.cosmetic_id, c.category, c.name, c.rarity, c.css_property
      FROM player_cosmetics pc
      JOIN cosmetics c ON c.id = pc.cosmetic_id
      WHERE pc.player_id = ? AND pc.equipped = 1
    `, [cosmeticPlayerId]);

    return {
      id: cosmeticPlayerId,
      discord_user_id: g.groupKey.startsWith('solo_')
        ? (g._soloPlatform === 'discord' ? g._soloPlatformUserId : null)
        : g.groupKey,
      platform: g.groupKey.startsWith('solo_') ? (g._soloPlatform || null) : null,
      platform_user_id: g.groupKey.startsWith('solo_') ? (g._soloPlatformUserId || null) : null,
      display_name: g.display_name,
      profile_pic: g.profile_pic,
      country: g.country || null,
      coins: g.coins,
      xp: g.xp,
      word_game_xp: g.word_game_xp,
      total_taps: g.total_taps,
      library_words: g.library_words,
      biz_count: g.biz_count,
      total_biz_levels: g.total_biz_levels,
      pizza_level: g.pizza_level,
      pizza_prestige: g.pizza_prestige,
      created_at: g.created_at,
      total_game_wins: g.wins.total,
      word5000_wins: g.wins.word5000 || 0,
      color500_wins: g.wins.color500 || 0,
      subtextle_wins: g.wins.subtextle || 0,
      betwixt_wins: g.wins.betwixt || 0,
      rectangled_wins: g.wins.rectangled || 0,
      erectangled_wins: g.wins.erectangled || 0,
      unwordle_wins: g.wins.unwordle || 0,
      spellingbee_wins: g.wins['spelling-bee'] || 0,
      wordle_wins: g.wins.wordle || 0,
      figural_wins: g.wins.figural || 0,
      pixeletters_wins: g.wins.pixeletters || 0,
      wikicontexto_wins: g.wins.wikicontexto || 0,
      wikirectangled_wins: g.wins.wikirectangled || 0,
      triangled_wins: g.wins.triangled || 0,
      synapse_wins: g.wins.synapse || 0,
      synapsemp_wins: g.wins['synapse-mp'] || 0,
      junkdrawer_wins: g.wins.junkdrawer || 0,
      cloudquarry_wins: g.wins.cloudquarry || 0,
      letterworks_wins: g.wins.letterworks || 0,
      wordfall_wins: g.wins.wordfall || 0,
      equipped_cosmetics,
      suspended: g.suspended || 0,
      current_streak: g.current_streak || 0,
      longest_streak: g.longest_streak || 0,
      identity_keys: Array.from(g._identityKeys),
      goat_elo: g._sortElo || 0,
      goat_rounds_counted: g._sortRoundsCounted || 0,
      goat_games_participated: g._sortGamesParticipated || 0,
      goat_game_elos: { ...g._sortPerGameElo },
      goat_game_elo_rounds: { ...g._sortPerGameRounds },
      goat_rank: g._goatRank,
    };
  });

  return {
    players,
    total,
    totalAccounts: allGroups.length,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
}

// ==================== WORD FOUNDRY ====================

function getWordFoundryState(accountId) {
  return queryOne('SELECT * FROM word_foundry_states WHERE account_id = ?', [String(accountId)]);
}

function saveWordFoundryState(accountId, state, updatedAt = Date.now()) {
  const stateJson = JSON.stringify(state);
  run(
    `INSERT INTO word_foundry_states (account_id, state_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET state_json = ?, updated_at = ?`,
    [String(accountId), stateJson, updatedAt, stateJson, updatedAt]
  );
  save();
}

function getWordFoundryAction(accountId, actionId) {
  return queryOne('SELECT * FROM word_foundry_actions WHERE account_id = ? AND action_id = ?', [String(accountId), actionId]);
}
function countWordFoundryActions(accountId, timestamp) {
  // Expired timestamped actions cannot execute again: the service rejects their age.
  // Legacy IDs have no verifiable age and remain retained rather than reopened.
  run("DELETE FROM word_foundry_actions WHERE account_id = ? AND action_id LIKE 'wf2:%' AND created_at < ?", [String(accountId), timestamp - 30 * 86400000]);
  return queryOne('SELECT COUNT(*) AS count FROM word_foundry_actions WHERE account_id = ?', [String(accountId)]).count;
}
function saveWordFoundryAction(accountId, state, updatedAt, actionId, result, requestHash = null) {
  const stateJson = JSON.stringify(state), resultJson = JSON.stringify(result);
  return withTransactionSync(() => {
    run(`INSERT INTO word_foundry_actions(account_id, action_id, request_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [String(accountId), actionId, requestHash, resultJson, updatedAt]);
    run(`INSERT INTO word_foundry_states(account_id, state_json, updated_at, last_action_id, last_action_result)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET state_json = ?, updated_at = ?, last_action_id = ?, last_action_result = ?`,
      [String(accountId), stateJson, updatedAt, actionId, resultJson, stateJson, updatedAt, actionId, resultJson]);
    save();
  });
}

// ─── Friend System ────────────────────────────────────────────────────────────

function sendFriendRequest(requesterDiscordId, targetDiscordId) {
  if (requesterDiscordId === targetDiscordId) return { ok: false, error: 'Cannot friend yourself' };
  // Check if already friends or pending in either direction
  const existing = queryOne(
    `SELECT id, status, requester_discord_id FROM friends
     WHERE (requester_discord_id = ? AND target_discord_id = ?)
        OR (requester_discord_id = ? AND target_discord_id = ?)`,
    [requesterDiscordId, targetDiscordId, targetDiscordId, requesterDiscordId]
  );
  if (existing) {
    if (existing.status === 'accepted') return { ok: false, error: 'Already friends' };
    if (existing.requester_discord_id === requesterDiscordId) return { ok: false, error: 'Request already pending' };
    // They already sent us a request — auto-accept
    db.run(`UPDATE friends SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?`, [existing.id]);
    save();
    return { ok: true, autoAccepted: true };
  }
  db.run(`INSERT INTO friends (requester_discord_id, target_discord_id, status) VALUES (?, ?, 'pending')`,
    [requesterDiscordId, targetDiscordId]);
  save();
  return { ok: true };
}

function acceptFriendRequest(requestId, acceptorDiscordId) {
  const req = queryOne(`SELECT * FROM friends WHERE id = ? AND target_discord_id = ? AND status = 'pending'`,
    [requestId, acceptorDiscordId]);
  if (!req) return { ok: false, error: 'Request not found' };
  db.run(`UPDATE friends SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?`, [requestId]);
  save();
  return { ok: true };
}

function declineFriendRequest(requestId, declinorDiscordId) {
  // Allow both requester (cancel) and target (decline) to delete
  const req = queryOne(`SELECT * FROM friends WHERE id = ? AND (target_discord_id = ? OR requester_discord_id = ?) AND status = 'pending'`,
    [requestId, declinorDiscordId, declinorDiscordId]);
  if (!req) return { ok: false, error: 'Request not found' };
  db.run(`DELETE FROM friends WHERE id = ?`, [requestId]);
  save();
  return { ok: true };
}

function removeFriend(userDiscordId, friendDiscordId) {
  const row = queryOne(
    `SELECT id FROM friends WHERE status = 'accepted'
     AND ((requester_discord_id = ? AND target_discord_id = ?) OR (requester_discord_id = ? AND target_discord_id = ?))`,
    [userDiscordId, friendDiscordId, friendDiscordId, userDiscordId]
  );
  if (!row) return { ok: false, error: 'Not friends' };
  db.run(`DELETE FROM friends WHERE id = ?`, [row.id]);
  save();
  return { ok: true };
}

function getFriends(discordId) {
  const rows = [];
  const stmt = db.prepare(
    `SELECT f.id, f.requester_discord_id, f.target_discord_id, f.accepted_at,
            CASE WHEN f.requester_discord_id = ? THEN f.target_discord_id ELSE f.requester_discord_id END AS friend_discord_id
     FROM friends f
     WHERE f.status = 'accepted'
       AND (f.requester_discord_id = ? OR f.target_discord_id = ?)
     ORDER BY f.accepted_at DESC`
  );
  stmt.bind([discordId, discordId, discordId]);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  // Enrich with profile data
  return rows.map(r => {
    const friendId = r.friend_discord_id;
    const prefs = queryOne(`SELECT preferred_display_name, preferred_pfp_platform FROM account_preferences WHERE discord_user_id = ?`, [friendId]);
    const linked = queryOne(`SELECT platform_user_id, username, display_name, profile_pic FROM linked_accounts WHERE discord_user_id = ? ORDER BY linked_at ASC LIMIT 1`, [friendId]);
    const playerIds = getAllPlayerIdsForDiscord(friendId);
    let coins = 0, totalWins = 0;
    for (const pid of playerIds) {
      const p = queryOne(`SELECT xp FROM players WHERE id = ?`, [pid]);
      if (p) coins += p.xp;
    }
    // Count game wins
    if (playerIds.length > 0) {
      const placeholders = playerIds.map(() => '?').join(',');
      const winRow = queryOne(`SELECT COUNT(*) as cnt FROM game_wins WHERE player_id IN (${placeholders})`, playerIds);
      if (winRow) totalWins = winRow.cnt;
    }
    return {
      friendshipId: r.id,
      discordId: friendId,
      displayName: prefs?.preferred_display_name || linked?.display_name || linked?.username || friendId,
      profilePic: linked?.profile_pic || null,
      coins,
      totalWins,
      acceptedAt: r.accepted_at
    };
  });
}

function getPendingRequests(discordId) {
  const rows = [];
  const stmt = db.prepare(
    `SELECT f.id, f.requester_discord_id, f.created_at
     FROM friends f
     WHERE f.target_discord_id = ? AND f.status = 'pending'
     ORDER BY f.created_at DESC`
  );
  stmt.bind([discordId]);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(r => {
    const prefs = queryOne(`SELECT preferred_display_name FROM account_preferences WHERE discord_user_id = ?`, [r.requester_discord_id]);
    const linked = queryOne(`SELECT display_name, username, profile_pic FROM linked_accounts WHERE discord_user_id = ? ORDER BY linked_at ASC LIMIT 1`, [r.requester_discord_id]);
    const playerIds = getAllPlayerIdsForDiscord(r.requester_discord_id);
    let coins = 0;
    for (const pid of playerIds) {
      const p = queryOne(`SELECT xp FROM players WHERE id = ?`, [pid]);
      if (p) coins += p.xp;
    }
    return {
      requestId: r.id,
      discordId: r.requester_discord_id,
      displayName: prefs?.preferred_display_name || linked?.display_name || linked?.username || r.requester_discord_id,
      profilePic: linked?.profile_pic || null,
      coins,
      createdAt: r.created_at
    };
  });
}

function searchPlayersForFriend(query, excludeDiscordId, limit = 10) {
  if (!query || query.length < 2) return [];
  const like = '%' + query + '%';
  const rows = [];
  // Search across preferred name, linked account names, and player display names
  const stmt = db.prepare(
    `SELECT DISTINCT la.discord_user_id,
            COALESCE(ap.preferred_display_name, la.display_name, la.username) AS display_name,
            la.profile_pic
     FROM linked_accounts la
     LEFT JOIN account_preferences ap ON ap.discord_user_id = la.discord_user_id
     WHERE la.discord_user_id != ?
       AND (ap.preferred_display_name LIKE ? OR la.display_name LIKE ? OR la.username LIKE ?)
     GROUP BY la.discord_user_id
     LIMIT ?`
  );
  stmt.bind([excludeDiscordId, like, like, like, limit]);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  // Enrich with coins and friend status
  return rows.map(r => {
    const playerIds = getAllPlayerIdsForDiscord(r.discord_user_id);
    let coins = 0;
    for (const pid of playerIds) {
      const p = queryOne(`SELECT xp FROM players WHERE id = ?`, [pid]);
      if (p) coins += p.xp;
    }
    const friendship = queryOne(
      `SELECT id, status, requester_discord_id FROM friends
       WHERE (requester_discord_id = ? AND target_discord_id = ?) OR (requester_discord_id = ? AND target_discord_id = ?)`,
      [excludeDiscordId, r.discord_user_id, r.discord_user_id, excludeDiscordId]
    );
    let friendStatus = 'none';
    if (friendship) {
      if (friendship.status === 'accepted') friendStatus = 'friends';
      else if (friendship.requester_discord_id === excludeDiscordId) friendStatus = 'pending_sent';
      else friendStatus = 'pending_received';
    }
    return {
      discordId: r.discord_user_id,
      displayName: r.display_name,
      profilePic: r.profile_pic,
      coins,
      friendStatus
    };
  });
}

function getFriendProfile(discordId) {
  const prefs = queryOne(`SELECT * FROM account_preferences WHERE discord_user_id = ?`, [discordId]);
  const linked = queryOne(`SELECT display_name, username, profile_pic FROM linked_accounts WHERE discord_user_id = ? ORDER BY linked_at ASC LIMIT 1`, [discordId]);
  const playerIds = getAllPlayerIdsForDiscord(discordId);
  const dailyFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.DAILY_TIMEZONE || 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const today = dailyFormatter.format(new Date());
  const weekStart = (() => {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  let coins = 0, totalTaps = 0, libraryWords = 0;
  for (const pid of playerIds) {
    const p = queryOne(`SELECT xp, total_taps, library_words FROM players WHERE id = ?`, [pid]);
    if (p) { coins += p.xp; totalTaps += p.total_taps; libraryWords += (p.library_words || 0); }
  }
  // Game win counts
  const gameWins = {};
  if (playerIds.length > 0) {
    const ph = playerIds.map(() => '?').join(',');
    const stmt2 = db.prepare(`SELECT game, COUNT(*) as wins FROM game_wins WHERE player_id IN (${ph}) GROUP BY game`);
    stmt2.bind(playerIds);
    while (stmt2.step()) {
      const r = stmt2.getAsObject();
      const canonical = canonicalGameId(r.game);
      if (!canonical) continue;
      gameWins[canonical] = (gameWins[canonical] || 0) + (Number(r.wins) || 0);
    }
    stmt2.free();
  }
  // Equipped cosmetics
  const cosmetics = [];
  if (playerIds.length > 0) {
    const ph = playerIds.map(() => '?').join(',');
    const stmt3 = db.prepare(`SELECT c.name, c.category, c.rarity, c.css_property FROM player_cosmetics pc JOIN cosmetics c ON c.id = pc.cosmetic_id WHERE pc.player_id IN (${ph}) AND pc.equipped = 1`);
    stmt3.bind(playerIds);
    while (stmt3.step()) cosmetics.push(stmt3.getAsObject());
    stmt3.free();
  }
  const dailyCompletions = [];
  const weeklyCompletions = [];
  if (playerIds.length > 0) {
    const seenDaily = new Map();
    const seenWeekly = new Map();
    for (const pid of playerIds) {
      for (const row of getDailyCompletions(pid, today)) {
        const existing = seenDaily.get(row.game);
        if (!existing || row.completed_at < existing.completedAt) {
          seenDaily.set(row.game, { game: row.game, completedAt: row.completed_at });
        }
      }
      for (const row of getWeeklyCompletions(pid, weekStart)) {
        const existing = seenWeekly.get(row.game);
        if (!existing || row.completed_at < existing.completedAt) {
          seenWeekly.set(row.game, { game: row.game, completedAt: row.completed_at });
        }
      }
    }
    dailyCompletions.push(...Array.from(seenDaily.values()).sort((a, b) => a.game.localeCompare(b.game)));
    weeklyCompletions.push(...Array.from(seenWeekly.values()).sort((a, b) => a.game.localeCompare(b.game)));
  }
  return {
    discordId,
    displayName: prefs?.preferred_display_name || linked?.display_name || linked?.username || discordId,
    profilePic: linked?.profile_pic || null,
    coins, totalTaps, libraryWords,
    gameWins,
    cosmetics,
    dailyChallenges: {
      date: today,
      completions: dailyCompletions
    },
    weeklyChallenges: {
      weekStart,
      completions: weeklyCompletions
    }
  };
}

function getFriendCount(discordId) {
  const row = queryOne(
    `SELECT COUNT(*) as cnt FROM friends WHERE status = 'accepted' AND (requester_discord_id = ? OR target_discord_id = ?)`,
    [discordId, discordId]
  );
  return row ? row.cnt : 0;
}

// ─── City Data (TycoonIO isometric city) ────────────────────────────────────

/**
 * Get all players who own at least one business, with their business details,
 * equipped cosmetics, and account preferences. Used by /api/city-data.
 * Reuses the GOAT leaderboard's account-linking consolidation logic.
 */
function getCityData(limit = 500) {
  // Reuse goat's player consolidation to get grouped players
  const goat = getGoatLeaderboard(1, limit, 'coins');

  // Filter to players with businesses and fetch per-business detail
  const cityPlayers = [];
  for (const p of goat.players) {
    if (p.biz_count <= 0) continue;

    // Get individual businesses with prestige levels
    const businesses = queryAll(`
      SELECT
        pb.business_type, pb.level,
        COALESCE(pz.prestige_level, nr.prestige_level, cw.prestige_level,
                 sm.prestige_level, gc.prestige_level, ct.prestige_level,
                 sh.prestige_level, bv.prestige_level, 0) AS prestige
      FROM player_businesses pb
      LEFT JOIN pizza_shops pz ON pz.player_id = pb.player_id AND pb.business_type = 'pizza'
      LEFT JOIN newspaper_routes nr ON nr.player_id = pb.player_id AND pb.business_type = 'newspaper'
      LEFT JOIN carwash_shops cw ON cw.player_id = pb.player_id AND pb.business_type = 'carwash'
      LEFT JOIN stockmogul_portfolios sm ON sm.player_id = pb.player_id AND pb.business_type = 'stockmogul'
      LEFT JOIN gym_clubs gc ON gc.player_id = pb.player_id AND pb.business_type = 'gym'
      LEFT JOIN cinema_theaters ct ON ct.player_id = pb.player_id AND pb.business_type = 'cinema'
      LEFT JOIN startup_hubs sh ON sh.player_id = pb.player_id AND pb.business_type = 'startup'
      LEFT JOIN bank_vaults bv ON bv.player_id = pb.player_id AND pb.business_type = 'bank'
      WHERE pb.player_id = ?
      ORDER BY pb.level DESC
    `, [p.id]);

    // Parse equipped cosmetics into compact format
    const equippedCosmetics = {};
    if (p.equipped_cosmetics) {
      for (const c of p.equipped_cosmetics) {
        try {
          equippedCosmetics[c.category] = {
            ...JSON.parse(c.css_property),
            name: c.name,
            rarity: c.rarity,
          };
        } catch (e) {}
      }
    }

    // Get city preferences from account_preferences
    let cityPrefs = {};
    if (p.discord_user_id) {
      const prefs = queryOne(
        "SELECT * FROM account_preferences WHERE discord_user_id = ?",
        [p.discord_user_id]
      );
      if (prefs) {
        let decos = [];
        let layout = {};
        try { decos = JSON.parse(prefs.city_decorations || '[]'); } catch (e) {}
        try { layout = JSON.parse(prefs.city_layout || '{}'); } catch (e) {}
        cityPrefs = {
          buildingStyle: prefs.city_building_style || null,
          district: prefs.city_district || null,
          signText: prefs.city_sign_text || null,
          decorations: Array.isArray(decos) ? decos : [],
          buildingLayout: (layout && typeof layout === 'object') ? layout : {},
        };
      }
    }

    // Determine favorite game from win counts (canonical IDs)
    const gameWinEntries = [
      ['wordle', p.wordle_wins], ['subtextle', p.subtextle_wins],
      ['rectangled', p.rectangled_wins], ['spelling-bee', p.spellingbee_wins],
      ['word5000', p.word5000_wins], ['color500', p.color500_wins],
      ['figural', p.figural_wins], ['betwixt', p.betwixt_wins],
      ['erectangled', p.erectangled_wins], ['triangled', p.triangled_wins],
      ['wikicontexto', p.wikicontexto_wins], ['wikirectangled', p.wikirectangled_wins],
      ['unwordle', p.unwordle_wins], ['pixeletters', p.pixeletters_wins],
    ].filter(e => e[1] > 0);
    gameWinEntries.sort((a, b) => b[1] - a[1]);
    const favoriteGame = gameWinEntries.length ? gameWinEntries[0][0] : null;

    cityPlayers.push({
      discordId: p.discord_user_id || null,
      displayName: p.display_name || 'Unknown',
      profilePic: p.profile_pic || null,
      coins: p.xp,
      incomePerSecond: 0, // computed client-side from business levels
      businesses: businesses.map(b => ({ type: b.business_type, level: b.level, prestige: b.prestige || 0 })),
      equippedCosmetics,
      favoriteGame,
      cityPrefs,
      totalGameWins: p.total_game_wins || 0,
    });
  }

  return { players: cityPlayers };
}

// ── IP Logging ────────────────────────────────────────────────────────────────

function upsertPlayerIP(playerId, ipAddress, game) {
  run(`
    INSERT INTO player_ips (player_id, ip_address, game)
    VALUES (?, ?, ?)
    ON CONFLICT(player_id, ip_address)
    DO UPDATE SET last_seen = datetime('now'), hit_count = hit_count + 1, game = ?
  `, [playerId, ipAddress, game, game]);
  save();
}

function getPlayerIPs(playerId) {
  return queryAll(
    'SELECT * FROM player_ips WHERE player_id = ? ORDER BY last_seen DESC',
    [playerId]
  );
}

function getPlayersByIP(ipAddress) {
  return queryAll(`
    SELECT pi.*, p.platform, p.platform_user_id, p.username, p.display_name
    FROM player_ips pi
    JOIN players p ON pi.player_id = p.id
    WHERE pi.ip_address = ?
    ORDER BY pi.last_seen DESC
  `, [ipAddress]);
}

module.exports = {
  initialize,
  save,
  saveImmediate,
  flushDurable,
  exportBuffer,
  getRuntimeInfo,
  run,
  queryAll,
  queryOne,
  queryScalar,
  getRecentLedgerEntries,
  getLedgerEconomySummary,
  getLedgerPurchaseCounts,
  reassignLedgerPlayerHistory,
  withTransaction,
  getOrCreatePlayer,
  getPlayer,
  resolvePlayer,
  getPlayerByUsername,
  getPlayerByDisplayName,
  updatePlayerCoins,
  updatePlayerXp,
  resolveWalletPlayerId,
  getWalletPlayerById,
  clearWalletCache,
  updatePlayerWordGameXp,
  deductPlayerCoins,
  deductPlayerXp,
  updatePlayerGiftCoins,
  deductPlayerGiftCoins,
  deductPizzaCoins,
  deductCarwashCleanCash,
  claimTimedBusinessCollect,
  claimBusinessCollectSnapshot,
  updatePlayerTaps,
  setPlayerTapPower,
  setPlayerCritChance,
  setPlayerMultiTap,
  getTopTappers,
  getTopByCoins,
  getPlayerCount,
  getPlayersWithBusinesses,
  getAllBusinesses,
  getPlayerBusinesses,
  getPlayerBusiness,
  createPlayerBusiness,
  upgradePlayerBusiness,
  setBusinessLevel,
  updateBusinessCollectedAt,
  createSession,
  updateSessionTaps,
  updateSessionCoins,
  updateSessionPlayers,
  getSession,
  logEvent,
  getRecentEvents,
  getPlayerEquippedCosmetics,
  getPlayerOwnedCosmetics,
  searchPlayers,
  searchDiscordPlayers,
  getPlayerById,
  grantCosmetic,
  revokeCosmetic,
  adminEquipCosmetic,
  mergePlayers,
  findDuplicatePlayers,
  cleanupDuplicatePlayers,
  createVerificationCode,
  getVerificationCode,
  markCodeUsed,
  cleanupExpiredCodes,
  createLinkedAccount,
  getLinkedAccounts,
  hasLinkedAccount,
  getDiscordUserForPlatform,
  findDiscordUserForPlatformAlias,
  backfillLinkedAccountAliases,
  getUnifiedPlayer,
  resolveUnifiedPlayerByDiscord,
  resolvePizzaPlayerByDiscord,
  mergeLinkedAccounts,
  mergeStreamPlayers,
  mergeDiscordPlayerNoCurrency,
  discardDiscordPlayer,
  unlinkAccount,
  upsertVerifiedEmail,
  getVerifiedEmail,
  findAccountsByEmail,
  findDiscordAnchorByEmail,
  getDiscordIdentityDisplayInfo,
  getAccountProgressionState,
  recordLinkDecline,
  hasLinkDecline,
  getAccountOverview,
  getCompletionStatus,
  setAccountPreference,
  getCosmeticVisibility,
  getOwnedProfileLogoIds,
  getAccountProfileLogos,
  grantProfileLogo,
  revokeProfileLogo,
  hasProfileLogoUnlocked,
  resolveAccountProfileImage,
  getLinkedGroups,
  findPotentialMatches,
  refreshLinkedAccountInfo,
  hasDailyCompletion,
  recordDailyCompletion,
  getDailyCompletions,
  hasWeeklyCompletion,
  recordWeeklyCompletion,
  getWeeklyCompletions,
  getTaxSeasonPlayerIds,
  getTaxSeasonState,
  updateTaxSeasonState,
  recordTaxSeasonAudit,
  getTaxSeasonAudit,
  hasGeneratedCosmeticForDate,
  insertGeneratedCosmetic,
  getGeneratedCosmetics,
  getPizzaShop,
  createPizzaShop,
  updatePizzaShop,
  getPizzaUpgrades,
  getPizzaUpgrade,
  setPizzaUpgrade,
  getPizzaCustomizations,
  setPizzaCustomization,
  prestigePizzaShop,
  deletePizzaShopData,
  resolveNewspaperPlayerByDiscord,
  getNewspaperRoute,
  createNewspaperRoute,
  updateNewspaperRoute,
  getNewspaperUpgrades,
  getNewspaperUpgrade,
  setNewspaperUpgrade,
  getNewspaperCustomizations,
  setNewspaperCustomization,
  prestigeNewspaperRoute,
  deleteNewspaperRouteData,
  resolveCarwashPlayerByDiscord,
  getCarwashShop,
  createCarwashShop,
  updateCarwashShop,
  getCarwashUpgrades,
  getCarwashUpgrade,
  upsertCarwashUpgrade,
  deleteCarwashUpgrades,
  getCarwashCustomizations,
  upsertCarwashCustomization,
  prestigeCarwashShop,
  deleteCarwashShopData,
  resolveStockMogulPlayerByDiscord,
  getStockMogulPortfolio,
  createStockMogulPortfolio,
  updateStockMogulPortfolio,
  getStockMogulUpgrades,
  getStockMogulUpgrade,
  upsertStockMogulUpgrade,
  deleteStockMogulUpgrades,
  getStockMogulCustomizations,
  upsertStockMogulCustomization,
  prestigeStockMogulPortfolio,
  deleteStockMogulData,
  resolveGymPlayerByDiscord,
  getGymClub,
  createGymClub,
  updateGymClub,
  getGymUpgrades,
  getGymUpgrade,
  setGymUpgrade,
  getGymCustomizations,
  setGymCustomization,
  prestigeGymClub,
  deleteGymClubData,
  resolveCinemaPlayerByDiscord,
  getCinemaTheater,
  createCinemaTheater,
  updateCinemaTheater,
  getCinemaUpgrades,
  getCinemaUpgrade,
  setCinemaUpgrade,
  getCinemaCustomizations,
  setCinemaCustomization,
  prestigeCinemaTheater,
  deleteCinemaTheaterData,
  resolveStartupPlayerByDiscord,
  getStartupHub,
  createStartupHub,
  updateStartupHub,
  getStartupUpgrades,
  getStartupUpgrade,
  setStartupUpgrade,
  getStartupCustomizations,
  setStartupCustomization,
  prestigeStartupHub,
  deleteStartupHubData,
  resolveBankPlayerByDiscord,
  getBankVault,
  createBankVault,
  updateBankVault,
  getBankUpgrades,
  getBankUpgrade,
  setBankUpgrade,
  getBankCustomizations,
  setBankCustomization,
  prestigeBankVault,
  deleteBankVaultData,
  getWordFoundryState,
  saveWordFoundryState,
  saveWordFoundryAction,
  getWordFoundryAction,
  countWordFoundryActions,
  isWinEvent,
  recordGameWin,
  getGameWonWords,
  getGameRecent,
  addLibraryWord,
  addLibraryWordLinked,
  getLinkedPlayerIdsForPlayer,
  incrementLibraryWordCount,
  getPlayerLibraryWordCount,
  getLinkedLibraryWordCount,
  recalcLibraryWordCount,
  getPlayerLibraryWords,
  getPlayerLibraryStats,
  getGameWinCounts,
  getAllPlayerIdsForDiscord,
  getAllPlayerIdsFromPlayer,
  getPlayerGameStats,
  getGoatLeaderboard,
  getCityData,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getFriends,
  getPendingRequests,
  searchPlayersForFriend,
  getFriendProfile,
  getFriendCount,
  getStreakState,
  upsertStreakState,
  insertDailyClaim,
  hasDailyClaim,
  getDailyClaimHistory,
  getMembership,
  upsertMembership,
  setMembershipStatus,
  hasMembershipGrant,
  recordMembershipGrant,
  getMembershipGrantHistory,
  withTransactionSync,
  upsertPlayerIP,
  getPlayerIPs,
  getPlayersByIP
};
