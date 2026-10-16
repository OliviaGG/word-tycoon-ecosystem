const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function mockModule(modulePath, exports) {
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

function makeRouteApp() {
  const routes = {};
  return {
    routes,
    get(routePath, handler) {
      routes[`GET ${routePath}`] = handler;
    },
    post(routePath, handler) {
      routes[`POST ${routePath}`] = handler;
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

function loadPizzaRoutesWithMocks({ pizzaConfig, taxSeason, presence, accrual }) {
  const routeModulePath = path.join(__dirname, '..', 'src', 'routes', 'pizza.js');
  const pizzaConfigPath = path.join(__dirname, '..', 'src', 'pizza-config.js');
  const taxSeasonPath = path.join(__dirname, '..', 'src', 'tax-season.js');
  const presencePath = path.join(__dirname, '..', 'src', 'presence.js');
  const accrualPath = path.join(__dirname, '..', 'src', 'accrual.js');

  clearModule(routeModulePath);
  clearModule(pizzaConfigPath);
  clearModule(taxSeasonPath);
  clearModule(presencePath);
  clearModule(accrualPath);

  mockModule(pizzaConfigPath, pizzaConfig);
  mockModule(taxSeasonPath, taxSeason);
  mockModule(presencePath, presence);
  mockModule(accrualPath, accrual);

  return require(routeModulePath);
}

test('pizza upgrade settles before presence is touched', async () => {
  const events = [];
  const { registerPizzaRoutes } = loadPizzaRoutesWithMocks({
    pizzaConfig: {
      PIZZA_UPGRADES: {
        oven: { name: 'Oven', emoji: 'O', maxLevel: 5 }
      },
      getUpgradeCost: () => 10
    },
    taxSeason: {
      getIncomeMultiplier: () => 1,
      scaleObjectFields: (value) => value,
      scaleIncomeAmount: (value) => value
    },
    presence: {
      touch: () => events.push('touch')
    },
    accrual: {
      settleAndMutate: async (_playerId, _business, fn) => {
        events.push('settle-start');
        const result = fn();
        events.push('settle-end');
        return result;
      },
      getManagedPresenceMultiplier: () => 1
    }
  });

  const db = {
    resolvePizzaPlayerByDiscord: () => ({ id: 7 }),
    getPizzaShop: () => ({ pizza_coins: 50 }),
    getPizzaUpgrade: () => ({ level: 0 }),
    deductPizzaCoins: () => true,
    setPizzaUpgrade: () => {},
    getPizzaShop: (() => {
      let call = 0;
      return () => {
        call += 1;
        return call === 1 ? { pizza_coins: 50 } : { pizza_coins: 40 };
      };
    })()
  };

  const app = makeRouteApp();
  registerPizzaRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/pizza/:discordUserId/upgrade'];
  assert.ok(handler);

  const res = makeRes();
  await handler({ params: { discordUserId: 'abc' }, body: { upgradeType: 'oven' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(events, ['settle-start', 'settle-end', 'touch']);
});

test('pizza collect computes pending before presence is touched', async () => {
  const events = [];
  const { registerPizzaRoutes } = loadPizzaRoutesWithMocks({
    pizzaConfig: {
      PIZZA_UPGRADES: {},
      calculatePendingIncome: () => {
        events.push('pending');
        return { pizzaCoins: 20, xpGained: 5, pizzasServed: 3 };
      },
      MAX_SHOP_LEVEL: 100,
      xpForLevel: () => 999
    },
    taxSeason: {
      getIncomeMultiplier: () => 1,
      scaleObjectFields: (value) => value,
      scaleIncomeAmount: (value) => value
    },
    presence: {
      touch: () => events.push('touch')
    },
    accrual: {
      getManagedPresenceMultiplier: () => 1,
      settleAndMutate: async () => ({ ok: true })
    }
  });

  const shop = {
    shop_level: 1,
    prestige_level: 0,
    last_collected_at: '2026-03-28 00:00:00',
    pizza_coins: 10,
    shop_xp: 0,
    total_pizzas_served: 0,
    total_coins_earned: 0
  };
  const db = {
    resolvePizzaPlayerByDiscord: () => ({ id: 9, username: 'pizza-user' }),
    getPlayerById: () => ({ coins: 100 }),
    withTransaction: async (fn) => fn(),
    getPizzaShop: () => shop,
    getPizzaUpgrades: () => [],
    claimBusinessCollectSnapshot: () => true,
    updatePlayerCoins: () => {},
    updatePizzaShop: () => {}
  };

  const app = makeRouteApp();
  registerPizzaRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/pizza/:discordUserId/collect'];
  assert.ok(handler);

  const res = makeRes();
  await handler({ params: { discordUserId: 'abc' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(events, ['pending', 'touch']);
});
