'use strict';

const assert = require('node:assert');
const { describe, it, beforeEach } = require('node:test');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeDb() {
  const state = {
    linkedGroups: {
      1: [1, 2],
      2: [1, 2],
      3: [3]
    },
    players: [
      {
        id: 1,
        platform: 'tiktok',
        platform_user_id: 'tt-1',
        username: 'alpha',
        display_name: 'Alpha',
        coins: 5000,
        gift_coins: 700,
        library_words: 1200,
        tax_season_completed: 0,
        tax_season_completed_at: null,
        tax_season_trigger_business: null,
        tax_season_bonus_multiplier: 1.0,
        tax_season_reset_reason: null
      },
      {
        id: 2,
        platform: 'discord',
        platform_user_id: 'dc-1',
        username: 'alpha_discord',
        display_name: 'Alpha Discord',
        coins: 4000,
        gift_coins: 50,
        library_words: 90,
        tax_season_completed: 0,
        tax_season_completed_at: null,
        tax_season_trigger_business: null,
        tax_season_bonus_multiplier: 1.0,
        tax_season_reset_reason: null
      },
      {
        id: 3,
        platform: 'tiktok',
        platform_user_id: 'tt-3',
        username: 'beta',
        display_name: 'Beta',
        coins: 2500,
        gift_coins: 0,
        library_words: 30,
        tax_season_completed: 0,
        tax_season_completed_at: null,
        tax_season_trigger_business: null,
        tax_season_bonus_multiplier: 1.0,
        tax_season_reset_reason: null
      }
    ],
    playerBusinesses: [
      { id: 11, player_id: 1, business_type: 'library', level: 7, last_collected_at: '2026-03-23 10:00:00' },
      { id: 12, player_id: 1, business_type: 'carwash', level: 62, last_collected_at: '2026-03-23 10:00:00' },
      { id: 13, player_id: 1, business_type: 'pizza', level: 21, last_collected_at: '2026-03-23 10:00:00' },
      { id: 14, player_id: 1, business_type: 'arcade', level: 1, last_collected_at: '2026-03-23 10:00:00' },
      { id: 21, player_id: 2, business_type: 'newspaper', level: 15, last_collected_at: '2026-03-23 10:00:00' }
    ],
    managed: {
      carwash_shops: [
        {
          player_id: 1,
          shop_name: 'Alpha Wash',
          prestige_level: 1,
          shop_level: 62,
          shop_xp: 450,
          clean_cash: 9999,
          total_cars_washed: 222,
          total_clean_earned: 3333,
          last_collected_at: '2026-03-23 10:00:00'
        }
      ],
      pizza_shops: [
        {
          player_id: 1,
          shop_name: 'Alpha Pizza',
          prestige_level: 2,
          shop_level: 21,
          shop_xp: 80,
          pizza_coins: 1234,
          total_pizzas_served: 88,
          total_coins_earned: 999,
          last_collected_at: '2026-03-23 10:00:00'
        }
      ],
      newspaper_routes: [
        {
          player_id: 2,
          route_name: 'Daily Alpha',
          prestige_level: 1,
          route_level: 15,
          route_xp: 44,
          total_papers_delivered: 123,
          total_xp_earned: 888,
          last_collected_at: '2026-03-23 10:00:00'
        }
      ],
      stockmogul_portfolios: [],
      gym_clubs: [],
      cinema_theaters: [],
      startup_hubs: [],
      bank_vaults: []
    },
    upgrades: {
      carwash_upgrades: [{ player_id: 1, upgrade_type: 'soap', level: 5 }],
      pizza_upgrades: [{ player_id: 1, upgrade_type: 'oven', level: 3 }],
      newspaper_upgrades: [{ player_id: 2, upgrade_type: 'bike', level: 2 }],
      stockmogul_upgrades: [],
      gym_upgrades: [],
      cinema_upgrades: [],
      startup_upgrades: [],
      bank_upgrades: []
    },
    taxSeasonAudit: []
  };

  function getLinkedIds(playerId) {
    return clone(state.linkedGroups[playerId] || [playerId]);
  }

  function computeTaxSeasonState(playerId) {
    const playerIds = getLinkedIds(playerId);
    const rows = state.players
      .filter((row) => playerIds.includes(row.id))
      .sort((a, b) => {
        if ((b.tax_season_completed || 0) !== (a.tax_season_completed || 0)) {
          return (b.tax_season_completed || 0) - (a.tax_season_completed || 0);
        }
        return a.id - b.id;
      });
    const canonical = rows[0] || null;
    return {
      playerIds,
      completed: rows.some((row) => Number(row.tax_season_completed) === 1),
      completedAt: canonical ? canonical.tax_season_completed_at : null,
      triggerBusiness: canonical ? canonical.tax_season_trigger_business : null,
      bonusMultiplier: Math.max(1, ...rows.map((row) => Number(row.tax_season_bonus_multiplier) || 1)),
      resetReason: canonical ? canonical.tax_season_reset_reason : null,
      mismatched: false,
      rows: clone(rows)
    };
  }

  function idsFromParams(params) {
    return params.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
  }

  function updateManagedTable(tableName, playerIds, sql) {
    const rows = state.managed[tableName] || [];
    for (const row of rows) {
      if (!playerIds.includes(row.player_id)) continue;
      if (sql.includes('shop_level = 1')) row.shop_level = 1;
      if (sql.includes('route_level = 1')) row.route_level = 1;
      if (sql.includes('portfolio_level = 1')) row.portfolio_level = 1;
      if (sql.includes('club_level = 1')) row.club_level = 1;
      if (sql.includes('theater_level = 1')) row.theater_level = 1;
      if (sql.includes('hub_level = 1')) row.hub_level = 1;
      if (sql.includes('vault_level = 1')) row.vault_level = 1;
      if (sql.includes('shop_xp = 0')) row.shop_xp = 0;
      if (sql.includes('route_xp = 0')) row.route_xp = 0;
      if (sql.includes('portfolio_xp = 0')) row.portfolio_xp = 0;
      if (sql.includes('club_xp = 0')) row.club_xp = 0;
      if (sql.includes('theater_xp = 0')) row.theater_xp = 0;
      if (sql.includes('hub_xp = 0')) row.hub_xp = 0;
      if (sql.includes('vault_xp = 0')) row.vault_xp = 0;
      if (sql.includes('prestige_level = 0')) row.prestige_level = 0;
      if (sql.includes('clean_cash = 0')) row.clean_cash = 0;
      if (sql.includes('pizza_coins = 0')) row.pizza_coins = 0;
      if (sql.includes('portfolio_coins = 0')) row.portfolio_coins = 0;
      if (sql.includes('gym_points = 0')) row.gym_points = 0;
      if (sql.includes('total_cars_washed = 0')) row.total_cars_washed = 0;
      if (sql.includes('total_clean_earned = 0')) row.total_clean_earned = 0;
      if (sql.includes('total_pizzas_served = 0')) row.total_pizzas_served = 0;
      if (sql.includes('total_coins_earned = 0')) row.total_coins_earned = 0;
      if (sql.includes('total_papers_delivered = 0')) row.total_papers_delivered = 0;
      if (sql.includes('total_xp_earned = 0')) row.total_xp_earned = 0;
      if (sql.includes('total_trades = 0')) row.total_trades = 0;
      if (sql.includes('total_members_trained = 0')) row.total_members_trained = 0;
      if (sql.includes('total_points_earned = 0')) row.total_points_earned = 0;
      if (sql.includes('total_viewers_served = 0')) row.total_viewers_served = 0;
      if (sql.includes('total_users_served = 0')) row.total_users_served = 0;
      if (sql.includes('total_clients_served = 0')) row.total_clients_served = 0;
      row.last_collected_at = 'now';
    }
  }

  const fakeDb = {
    __state: state,
    getTaxSeasonState(playerId) {
      return computeTaxSeasonState(playerId);
    },
    async withTransaction(fn) {
      const snapshot = clone(state);
      try {
        return await fn();
      } catch (err) {
        Object.keys(state).forEach((key) => { delete state[key]; });
        Object.assign(state, snapshot);
        throw err;
      }
    },
    queryAll(sql, params = []) {
      if (sql.includes('FROM carwash_shops') && sql.includes('prestige_level')) {
        const ids = idsFromParams(params);
        return clone(state.managed.carwash_shops.filter((row) => ids.includes(row.player_id)));
      }
      if (sql.includes('FROM players') && sql.includes('tax_season_completed')) {
        const ids = idsFromParams(params);
        return clone(state.players.filter((row) => ids.includes(row.id)));
      }
      if (sql.includes('FROM player_businesses')) {
        const ids = idsFromParams(params);
        let rows = state.playerBusinesses.filter((row) => ids.includes(row.player_id));
        if (sql.includes("business_type = 'library'")) {
          rows = rows.filter((row) => row.business_type === 'library');
          return rows.map((row) => ({
            business_id: row.id,
            library_words: state.players.find((player) => player.id === row.player_id)?.library_words || 0
          }));
        }
        return clone(rows);
      }
      for (const tableName of Object.keys(state.managed)) {
        if (sql.includes(`FROM ${tableName}`)) {
          const ids = idsFromParams(params);
          return clone((state.managed[tableName] || []).filter((row) => ids.includes(row.player_id)));
        }
      }
      return [];
    },
    run(sql, params = []) {
      if (sql.startsWith('INSERT INTO tax_season_audit')) {
        state.taxSeasonAudit.push({
          player_id: params[0],
          trigger_business: params[1],
          bonus_multiplier: params[2],
          reset_reason: params[3],
          snapshot_json: params[4]
        });
        return;
      }
      if (sql.startsWith('UPDATE players') && sql.includes('SET coins = 0')) {
        const ids = idsFromParams(params);
        state.players.forEach((player) => {
          if (ids.includes(player.id)) player.coins = 0;
        });
        return;
      }
      if (sql.startsWith('UPDATE player_businesses') && sql.includes("business_type NOT IN ('library', 'newspaper')")) {
        const ids = idsFromParams(params);
        state.playerBusinesses.forEach((row) => {
          if (ids.includes(row.player_id) && row.business_type !== 'library' && row.business_type !== 'newspaper') {
            row.level = 1;
            row.last_collected_at = 'now';
          }
        });
        return;
      }
      if (sql.startsWith('UPDATE player_businesses') && sql.includes('WHERE id = ?')) {
        const businessId = Number(params[1]);
        const row = state.playerBusinesses.find((entry) => entry.id === businessId);
        if (row) {
          row.level = Number(params[0]);
          row.last_collected_at = 'now';
        }
        return;
      }
      if (sql.startsWith('UPDATE players') && sql.includes('tax_season_completed = 1')) {
        const ids = idsFromParams(params.slice(4));
        state.players.forEach((player) => {
          if (!ids.includes(player.id)) return;
          player.tax_season_completed = 1;
          player.tax_season_completed_at = params[0];
          player.tax_season_trigger_business = params[1];
          player.tax_season_bonus_multiplier = params[2];
          player.tax_season_reset_reason = params[3];
        });
        return;
      }
      if (sql.startsWith('DELETE FROM ')) {
        const tableName = sql.split('DELETE FROM ')[1].split(' ')[0].trim();
        const ids = idsFromParams(params);
        if (state.upgrades[tableName]) {
          state.upgrades[tableName] = state.upgrades[tableName].filter((row) => !ids.includes(row.player_id));
          return;
        }
      }
      for (const tableName of Object.keys(state.managed)) {
        if (sql.startsWith(`UPDATE ${tableName}`)) {
          const ids = idsFromParams(params);
          updateManagedTable(tableName, ids, sql);
          return;
        }
      }
      if (sql.startsWith('INSERT INTO ') && sql.includes('SELECT pb.player_id')) {
        const tableName = sql.split('INSERT INTO ')[1].split(' ')[0].trim();
        const businessType = params[0];
        const ids = idsFromParams(params.slice(1));
        const existingIds = new Set((state.managed[tableName] || []).map((row) => row.player_id));
        state.playerBusinesses
          .filter((row) => row.business_type === businessType && ids.includes(row.player_id) && !existingIds.has(row.player_id))
          .forEach((row) => {
            state.managed[tableName].push({ player_id: row.player_id });
          });
        return;
      }
      throw new Error(`Unhandled SQL in fake DB: ${sql}`);
    }
  };

  return fakeDb;
}

function loadTaxSeasonWithDb(fakeDb) {
  const dbPath = require.resolve('../src/database');
  const taxSeasonPath = require.resolve('../src/tax-season');
  delete require.cache[taxSeasonPath];
  require.cache[dbPath] = { exports: fakeDb };
  return require('../src/tax-season');
}

function makeRouteApp() {
  const routes = [];
  return {
    routes,
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler });
    }
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function loadCarwashRoutesWithTaxSeasonMock(taxSeasonMock) {
  const taxSeasonPath = require.resolve('../src/tax-season');
  const carwashRoutePath = require.resolve('../src/routes/carwash');
  delete require.cache[carwashRoutePath];
  require.cache[taxSeasonPath] = { exports: taxSeasonMock };
  return require('../src/routes/carwash');
}

describe('tax-season service', () => {
  let fakeDb;
  let taxSeason;

  beforeEach(() => {
    fakeDb = createFakeDb();
    taxSeason = loadTaxSeasonWithDb(fakeDb);
  });

  it('reports eligibility only after car wash prestige 1', () => {
    let eligibility = taxSeason.getTaxSeasonEligibility(1);
    assert.strictEqual(eligibility.eligible, true);
    assert.strictEqual(eligibility.completed, false);
    assert.strictEqual(eligibility.requiredConfirmation, 'RESET MY EMPIRE');

    fakeDb.__state.managed.carwash_shops[0].prestige_level = 0;
    eligibility = taxSeason.getTaxSeasonEligibility(1);
    assert.strictEqual(eligibility.eligible, false);
    assert.strictEqual(eligibility.reason, 'carwash_prestige_required');
  });

  it('requires the exact confirmation phrase before resetting', async () => {
    const result = await taxSeason.runTaxSeasonReset(1, { confirmation: 'nope' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'confirmation_required');
    assert.strictEqual(fakeDb.__state.players[0].coins, 5000);
    assert.strictEqual(fakeDb.__state.taxSeasonAudit.length, 0);
  });

  it('resets the linked account economy and records the one-time completion', async () => {
    const result = await taxSeason.runTaxSeasonReset(1, {
      confirmation: taxSeason.TAX_SEASON_CONFIRMATION,
      resetReason: 'test_run'
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.bonusMultiplier, 1.10);

    const p1 = fakeDb.__state.players.find((row) => row.id === 1);
    const p2 = fakeDb.__state.players.find((row) => row.id === 2);
    assert.strictEqual(p1.coins, 0);
    assert.strictEqual(p2.coins, 0);
    assert.strictEqual(p1.gift_coins, 700);
    assert.strictEqual(p1.tax_season_completed, 1);
    assert.strictEqual(p2.tax_season_completed, 1);
    assert.strictEqual(p1.tax_season_bonus_multiplier, 1.10);
    assert.strictEqual(p2.tax_season_bonus_multiplier, 1.10);

    const libraryBiz = fakeDb.__state.playerBusinesses.find((row) => row.id === 11);
    const carwashBiz = fakeDb.__state.playerBusinesses.find((row) => row.id === 12);
    const newspaperBiz = fakeDb.__state.playerBusinesses.find((row) => row.id === 21);
    assert.strictEqual(libraryBiz.level, 8);
    assert.strictEqual(carwashBiz.level, 1);
    assert.strictEqual(newspaperBiz.level, 15);

    const carwashShop = fakeDb.__state.managed.carwash_shops[0];
    assert.strictEqual(carwashShop.shop_level, 1);
    assert.strictEqual(carwashShop.prestige_level, 0);
    assert.strictEqual(carwashShop.clean_cash, 0);

    const pizzaShop = fakeDb.__state.managed.pizza_shops[0];
    assert.strictEqual(pizzaShop.shop_level, 1);
    assert.strictEqual(pizzaShop.prestige_level, 0);
    assert.strictEqual(pizzaShop.pizza_coins, 0);

    const newspaperRoute = fakeDb.__state.managed.newspaper_routes[0];
    assert.strictEqual(newspaperRoute.route_level, 15);
    assert.strictEqual(newspaperRoute.route_xp, 44);
    assert.strictEqual(newspaperRoute.prestige_level, 1);

    assert.deepStrictEqual(fakeDb.__state.upgrades.carwash_upgrades, []);
    assert.deepStrictEqual(fakeDb.__state.upgrades.pizza_upgrades, []);
    assert.deepStrictEqual(fakeDb.__state.upgrades.newspaper_upgrades, [{ player_id: 2, upgrade_type: 'bike', level: 2 }]);
    assert.strictEqual(fakeDb.__state.taxSeasonAudit.length, 1);
    assert.match(fakeDb.__state.taxSeasonAudit[0].snapshot_json, /"business_type":"carwash"/);

    const post = taxSeason.getTaxSeasonEligibility(1);
    assert.strictEqual(post.completed, true);
    assert.strictEqual(post.eligible, false);
    assert.strictEqual(taxSeason.getIncomeMultiplier(1), 1.10);
  });
});

describe('carwash tax-season routes', () => {
  function createRouteDb() {
    return {
      resolveCarwashPlayerByDiscord(discordUserId) {
        if (discordUserId === 'discord-ok') return { id: 1, username: 'alpha' };
        return null;
      }
    };
  }

  it('returns preflight state for eligible players', () => {
    const prev = process.env.TAX_SEASON_ENABLED;
    process.env.TAX_SEASON_ENABLED = 'true';
    try {
      const { registerCarwashRoutes } = loadCarwashRoutesWithTaxSeasonMock({
        TAX_SEASON_CONFIRMATION: 'RESET MY EMPIRE',
        getTaxSeasonEligibility(playerId) {
          return { playerIds: [playerId], completed: false, eligible: true, reason: 'eligible' };
        },
        getTaxSeasonState(playerId) {
          return { playerIds: [playerId], completed: false, bonusMultiplier: 1.0 };
        },
        getIncomeMultiplier() { return 1; },
        scaleObjectFields(value) { return value; },
        scaleIncomeAmount(value) { return value; },
        runTaxSeasonReset: async () => ({ ok: true })
      });

      const app = makeRouteApp();
      registerCarwashRoutes(app, { db: createRouteDb(), getPlayerTotalIncomePerSec() { return 0; } });
      const route = app.routes.find((entry) => entry.method === 'GET' && entry.path === '/api/admin/carwash/:discordUserId/tax-season');
      const res = makeRes();
      route.handler({ params: { discordUserId: 'discord-ok' } }, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.enabled, true);
      assert.strictEqual(res.body.confirmationPhrase, 'RESET MY EMPIRE');
      assert.strictEqual(res.body.eligibility.eligible, true);
      assert.strictEqual(res.body.warning.reward, '+10% permanent income');
    } finally {
      if (prev === undefined) delete process.env.TAX_SEASON_ENABLED;
      else process.env.TAX_SEASON_ENABLED = prev;
    }
  });

  it('rejects reset execution while the feature flag is disabled', async () => {
    const prev = process.env.TAX_SEASON_ENABLED;
    delete process.env.TAX_SEASON_ENABLED;
    try {
      const { registerCarwashRoutes } = loadCarwashRoutesWithTaxSeasonMock({
        TAX_SEASON_CONFIRMATION: 'RESET MY EMPIRE',
        getTaxSeasonEligibility() { return { eligible: true }; },
        getTaxSeasonState() { return { completed: false, bonusMultiplier: 1.0 }; },
        getIncomeMultiplier() { return 1; },
        scaleObjectFields(value) { return value; },
        scaleIncomeAmount(value) { return value; },
        async runTaxSeasonReset() {
          throw new Error('should not be called');
        }
      });

      const app = makeRouteApp();
      registerCarwashRoutes(app, { db: createRouteDb(), getPlayerTotalIncomePerSec() { return 0; } });
      const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/api/admin/carwash/:discordUserId/tax-season');
      const res = makeRes();
      await route.handler({ params: { discordUserId: 'discord-ok' }, body: { confirmation: 'RESET MY EMPIRE' } }, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, {
        ok: false,
        code: 'disabled',
        message: 'Tax Season is not enabled'
      });
    } finally {
      if (prev === undefined) delete process.env.TAX_SEASON_ENABLED;
      else process.env.TAX_SEASON_ENABLED = prev;
    }
  });

  it('returns the reset result when execution succeeds', async () => {
    const prev = process.env.TAX_SEASON_ENABLED;
    process.env.TAX_SEASON_ENABLED = 'true';
    try {
      const { registerCarwashRoutes } = loadCarwashRoutesWithTaxSeasonMock({
        TAX_SEASON_CONFIRMATION: 'RESET MY EMPIRE',
        getTaxSeasonEligibility() { return { eligible: true }; },
        getTaxSeasonState() { return { completed: false, bonusMultiplier: 1.0 }; },
        getIncomeMultiplier() { return 1; },
        scaleObjectFields(value) { return value; },
        scaleIncomeAmount(value) { return value; },
        async runTaxSeasonReset(playerId, payload) {
          assert.strictEqual(playerId, 1);
          assert.deepStrictEqual(payload, { confirmation: 'RESET MY EMPIRE', resetReason: 'route_test' });
          return {
            ok: true,
            completedAt: '2026-03-23T18:00:00.000Z',
            bonusMultiplier: 1.10,
            playerIds: [1, 2],
            state: { completed: true, bonusMultiplier: 1.10 }
          };
        }
      });

      const app = makeRouteApp();
      registerCarwashRoutes(app, { db: createRouteDb(), getPlayerTotalIncomePerSec() { return 0; } });
      const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/api/admin/carwash/:discordUserId/tax-season');
      const res = makeRes();
      await route.handler({ params: { discordUserId: 'discord-ok' }, body: { confirmation: 'RESET MY EMPIRE', resetReason: 'route_test' } }, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.bonusMultiplier, 1.10);
      assert.deepStrictEqual(res.body.playerIds, [1, 2]);
      assert.strictEqual(res.body.state.completed, true);
    } finally {
      if (prev === undefined) delete process.env.TAX_SEASON_ENABLED;
      else process.env.TAX_SEASON_ENABLED = prev;
    }
  });
});
