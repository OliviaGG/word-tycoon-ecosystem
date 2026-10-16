'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { createIdentityService } = require('../src/identity');
const dbModule = require('../src/database');
const membership = require('../src/membership');
const cosmetics = require('../src/cosmetics');
const { normalizePlatformUserId } = require('../src/linked-identity');

async function fixture() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, platform TEXT, platform_user_id TEXT,
      username TEXT, display_name TEXT, profile_pic TEXT, coins REAL DEFAULT 0,
      total_taps INTEGER DEFAULT 0, library_words INTEGER DEFAULT 0);
    CREATE TABLE linked_accounts (id INTEGER PRIMARY KEY, discord_user_id TEXT,
      discord_username TEXT, platform TEXT, platform_user_id TEXT, display_name TEXT,
      profile_pic TEXT, username TEXT, linked_at TEXT DEFAULT 'original-date',
      UNIQUE(discord_user_id, platform, platform_user_id));
    CREATE TABLE account_preferences (discord_user_id TEXT PRIMARY KEY, primary_player_id INTEGER,
      preferred_display_name TEXT, merged_at TEXT);
    CREATE TABLE player_cosmetic_grants (player_id INTEGER, grant_key TEXT, source TEXT,
      UNIQUE(player_id, grant_key));
    CREATE TABLE player_cosmetics (id INTEGER PRIMARY KEY, player_id INTEGER,
      cosmetic_id TEXT, equipped INTEGER DEFAULT 0, seen INTEGER DEFAULT 0);
    CREATE TABLE cosmetics (id TEXT PRIMARY KEY, category TEXT);
    CREATE TABLE pending_cosmetic_grants (id INTEGER PRIMARY KEY, platform TEXT,
      platform_user_id TEXT, grant_key TEXT, source TEXT);
    INSERT INTO players (id,platform,platform_user_id,username,display_name)
      VALUES (25905,'tiktok','t.primmz','T','T');
    INSERT INTO linked_accounts (discord_user_id,platform,platform_user_id)
      VALUES ('go_paid','tiktok','T.primmz');
  `);
  const queryAll = (sql, params = []) => {
    const stmt = db.prepare(sql, params);
    const rows = [];
    try { while (stmt.step()) rows.push(stmt.getAsObject()); } finally { stmt.free(); }
    return rows;
  };
  const deps = { queryAll, queryOne: (sql, params) => queryAll(sql, params)[0] || null,
    run: (sql, params = []) => db.run(sql, params), save() {} };
  return { db, ...deps, identity: createIdentityService(deps) };
}

test('legacy mixed-case link resolves both handles and the paid account player', async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  for (const handle of ['t.primmz', 'T.primmz', '@T.Primmz']) {
    assert.equal(f.identity.getDiscordUserForPlatform('tiktok', handle), 'go_paid');
    assert.equal(f.identity.getUnifiedPlayer('tiktok', handle).id, 25905);
  }
  assert.equal(f.identity.resolveUnifiedPlayerByDiscord('go_paid').id, 25905);
  assert.deepEqual(f.identity.getAllPlayerIdsForDiscord('go_paid'), [25905]);
});

test('link writes repair the existing handle without replacing metadata or creating duplicates', async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  f.identity.createLinkedAccount('go_paid', 'T', 'tiktok', '@T.Primmz');
  f.identity.createLinkedAccount('go_paid', 'T', 'tiktok', 'T.primmz');
  const rows = f.queryAll('SELECT * FROM linked_accounts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform_user_id, 't.primmz');
  assert.equal(rows[0].linked_at, 'original-date');
  f.run('INSERT INTO account_preferences (discord_user_id, preferred_display_name) VALUES (?, ?)', ['go_paid', 'Tprimmz']);
  f.identity.mergeLinkedAccounts('go_paid');
  const prefs = f.queryOne('SELECT * FROM account_preferences WHERE discord_user_id=?', ['go_paid']);
  assert.equal(prefs.primary_player_id, 25905);
  assert.equal(prefs.preferred_display_name, 'Tprimmz');
  assert.throws(() => f.identity.createLinkedAccount('other_account', 'Other', 'tiktok', 'T.Primmz'), /already linked/);
});

test('opaque OAuth IDs and other providers retain case', () => {
  for (const [platform, id] of [['tiktok', 'tt_AbCd'], ['tiktok', 'AbCd-OpenId'],
    ['tiktok', 'AbCdEfGhIjKlMnOpQrStUvWxYz123456'], ['google', 'AbCd'], ['youtube', 'AbCd']]) {
    assert.equal(normalizePlatformUserId(platform, id), id);
  }
});

test('membership read restores late-linked donor sets once and preserves subsequent styling', async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  const originals = {};
  for (const key of ['getMembership', 'grantProfileLogo', 'resolveUnifiedPlayerByDiscord', 'queryOne', 'run', 'save']) {
    originals[key] = dbModule[key];
  }
  t.after(() => Object.assign(dbModule, originals));
  let linked = false;
  let status = 'active';
  Object.assign(dbModule, {
    getMembership: () => ({ tier: 'donor_class', status }),
    grantProfileLogo() {},
    resolveUnifiedPlayerByDiscord: () => linked ? f.identity.resolveUnifiedPlayerByDiscord('go_paid') : null,
    queryOne: f.queryOne, run: f.run, save: f.save
  });
  for (const item of cosmetics.COSMETICS_CATALOG) {
    f.run('INSERT INTO cosmetics (id, category) VALUES (?, ?)', [item.id, item.category]);
  }
  membership.getMembershipState('go_paid');
  assert.equal(f.queryAll('SELECT * FROM player_cosmetic_grants').length, 0);
  linked = true;
  status = 'inactive';
  membership.getMembershipState('go_paid');
  assert.equal(f.queryAll('SELECT * FROM player_cosmetic_grants').length, 0);
  status = 'active';
  membership.getMembershipState('go_paid');
  assert.equal(f.queryAll('SELECT * FROM player_cosmetics WHERE equipped=1').length, 9);
  assert.equal(f.queryAll('SELECT * FROM player_cosmetic_grants').length, 1);
  f.run('UPDATE player_cosmetics SET equipped=0');
  membership.getMembershipState('go_paid');
  assert.equal(f.queryAll('SELECT * FROM player_cosmetics WHERE equipped=1').length, 0);
  assert.equal(f.queryAll('SELECT * FROM player_cosmetic_grants').length, 1);
});
