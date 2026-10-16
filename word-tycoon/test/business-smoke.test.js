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

function loadRouteWithMocks({ routeFile, configFile, registerName, configExports, accrualExports, taxSeasonExports }) {
  const routeModulePath = path.join(__dirname, '..', 'src', 'routes', routeFile);
  const configModulePath = path.join(__dirname, '..', 'src', configFile);
  const accrualModulePath = path.join(__dirname, '..', 'src', 'accrual.js');
  const taxSeasonModulePath = path.join(__dirname, '..', 'src', 'tax-season.js');

  clearModule(routeModulePath);
  clearModule(configModulePath);
  clearModule(accrualModulePath);
  clearModule(taxSeasonModulePath);

  mockModule(configModulePath, configExports);
  mockModule(accrualModulePath, accrualExports);
  mockModule(taxSeasonModulePath, taxSeasonExports);

  return require(routeModulePath)[registerName];
}

const passthroughTaxSeason = {
  getIncomeMultiplier: () => 1,
  scaleObjectFields: (value) => value,
  scaleIncomeAmount: (value) => value
};

test('pizza upgrade smoke', async () => {
  const events = [];
  const registerPizzaRoutes = loadRouteWithMocks({
    routeFile: 'pizza.js',
    configFile: 'pizza-config.js',
    registerName: 'registerPizzaRoutes',
    configExports: {
      PIZZA_UPGRADES: {
        oven: { name: 'Oven', emoji: 'O', maxLevel: 5 }
      },
      getUpgradeCost: () => 20
    },
    accrualExports: {
      settleAndMutate: async (_playerId, _business, fn) => {
        events.push('settle');
        return fn();
      },
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let pizzaCoins = 50;
  let newLevel = null;
  const db = {
    resolvePizzaPlayerByDiscord: () => ({ id: 1 }),
    getPizzaShop: () => ({ pizza_coins: pizzaCoins }),
    getPizzaUpgrade: () => ({ level: 1 }),
    deductPizzaCoins: (_playerId, amount) => {
      pizzaCoins -= amount;
      return true;
    },
    setPizzaUpgrade: (_playerId, _type, level) => {
      newLevel = level;
    }
  };

  const app = makeRouteApp();
  registerPizzaRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/pizza/:discordUserId/upgrade'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: { upgradeType: 'oven' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.newLevel, 2);
  assert.equal(res.body.pizzaCoins, 30);
  assert.equal(newLevel, 2);
  assert.deepEqual(events, ['settle']);
});

test('newspaper collect smoke', async () => {
  const ledgerEvents = [];
  const registerNewspaperRoutes = loadRouteWithMocks({
    routeFile: 'newspaper.js',
    configFile: 'newspaper-config.js',
    registerName: 'registerNewspaperRoutes',
    configExports: {
      calculatePendingIncome: () => ({
        xpEarned: 25,
        papersDelivered: 12,
        routesCompleted: 3,
        collectCap: 1000,
        capped: false
      }),
      MAX_ROUTE_LEVEL: 100,
      xpForLevel: () => 999,
      getCollectCap: () => 1000,
      NEWSPAPER_UPGRADES: {}
    },
    accrualExports: {
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let playerCoins = 100;
  let routeState = {
    route_level: 1,
    route_xp: 0,
    prestige_level: 0,
    total_papers_delivered: 0,
    total_xp_earned: 0,
    last_collected_at: '2026-03-28 00:00:00'
  };
  const db = {
    resolveNewspaperPlayerByDiscord: () => ({ id: 2, username: 'news' }),
    getPlayerById: () => ({ coins: playerCoins }),
    withTransaction: async (fn) => fn(),
    getNewspaperRoute: () => routeState,
    getNewspaperUpgrades: () => [],
    claimBusinessCollectSnapshot: () => true,
    updatePlayerCoins: (_playerId, amount) => {
      playerCoins += amount;
    },
    updateNewspaperRoute: (_playerId, fields) => {
      routeState = { ...routeState, ...fields };
    }
  };
  const ledger = {
    record(entry) {
      ledgerEvents.push(entry);
    }
  };

  const app = makeRouteApp();
  registerNewspaperRoutes(app, { db, ledger });
  const handler = app.routes['POST /api/admin/newspaper/:discordUserId/collect'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.collected, 25);
  assert.equal(res.body.newBalance, 125);
  assert.equal(routeState.route_level, 1);
  assert.equal(routeState.route_xp, 3);
  assert.equal(routeState.total_papers_delivered, 12);
  assert.equal(routeState.total_xp_earned, 25);
  assert.equal(ledgerEvents.length, 1);
});

test('carwash collect smoke', async () => {
  const registerCarwashRoutes = loadRouteWithMocks({
    routeFile: 'carwash.js',
    configFile: 'carwash-config.js',
    registerName: 'registerCarwashRoutes',
    configExports: {
      calculatePendingCleanCash: () => ({
        cleanCash: 40,
        xpGained: 5,
        carsWashed: 4
      }),
      MAX_SHOP_LEVEL: 100,
      xpForLevel: () => 999,
      getOffshoreBonus: () => 1.25,
      CARWASH_UPGRADES: {}
    },
    accrualExports: {
      getManagedPresenceMultiplier: () => 1,
      settleAndMutate: async (_playerId, _business, fn) => fn()
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let shopState = {
    clean_cash: 10,
    shop_xp: 0,
    shop_level: 1,
    prestige_level: 0,
    total_cars_washed: 0,
    total_clean_earned: 0,
    last_collected_at: '2026-03-28 00:00:00'
  };
  const db = {
    resolveCarwashPlayerByDiscord: () => ({ id: 3 }),
    withTransaction: async (fn) => fn(),
    getCarwashShop: () => shopState,
    getCarwashUpgrades: () => [],
    updateCarwashShop: (_playerId, fields) => {
      shopState = { ...shopState, ...fields };
    }
  };

  const app = makeRouteApp();
  registerCarwashRoutes(app, { db, getPlayerTotalIncomePerSec: () => 100 });
  const handler = app.routes['POST /api/admin/carwash/:discordUserId/collect'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.collected, 50);
  assert.equal(shopState.clean_cash, 60);
  assert.equal(shopState.total_clean_earned, 50);
  assert.equal(shopState.total_cars_washed, 4);
});

test('stockmogul upgrade smoke', async () => {
  const registerStockMogulRoutes = loadRouteWithMocks({
    routeFile: 'stockmogul.js',
    configFile: 'stockmogul-config.js',
    registerName: 'registerStockMogulRoutes',
    configExports: {
      STOCKMOGUL_UPGRADES: {
        broker: { name: 'Broker', emoji: 'B', maxLevel: 5 }
      },
      getUpgradeCost: () => 15
    },
    accrualExports: {
      settleAndMutate: async (_playerId, _business, fn) => fn(),
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let cleanCash = 40;
  let brokerLevel = null;
  const db = {
    resolveStockMogulPlayerByDiscord: () => ({ id: 4 }),
    getStockMogulPortfolio: () => ({ portfolio_level: 1, prestige_level: 0 }),
    getCarwashShop: () => ({ clean_cash: cleanCash }),
    getStockMogulUpgrade: () => ({ level: 0 }),
    deductCarwashCleanCash: (_playerId, amount) => {
      cleanCash -= amount;
      return true;
    },
    upsertStockMogulUpgrade: (_playerId, _type, level) => {
      brokerLevel = level;
    }
  };

  const app = makeRouteApp();
  registerStockMogulRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/stockmogul/:discordUserId/upgrade'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: { upgradeType: 'broker' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.newLevel, 1);
  assert.equal(res.body.newCleanCash, 25);
  assert.equal(brokerLevel, 1);
});

test('gym prestige smoke', async () => {
  const registerGymRoutes = loadRouteWithMocks({
    routeFile: 'gym.js',
    configFile: 'gym-config.js',
    registerName: 'registerGymRoutes',
    configExports: {
      getPrestigeTierName: () => 'Elite',
      getPrestigeMultiplier: () => 2,
      GYM_UPGRADES: {}
    },
    accrualExports: {
      settleAndMutate: async (_playerId, _business, fn) => fn(),
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  const db = {
    resolveGymPlayerByDiscord: () => ({ id: 5 }),
    prestigeGymClub: () => ({ ok: true, newPrestigeLevel: 2 })
  };

  const app = makeRouteApp();
  registerGymRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/gym/:discordUserId/prestige'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    message: 'Prestiged to Elite! (2x income)',
    prestigeLevel: 2,
    tierName: 'Elite',
    multiplier: 2
  });
});

test('cinema upgrade smoke', async () => {
  const registerCinemaRoutes = loadRouteWithMocks({
    routeFile: 'cinema.js',
    configFile: 'cinema-config.js',
    registerName: 'registerCinemaRoutes',
    configExports: {
      CINEMA_UPGRADES: {
        projectors: { name: 'Projectors', emoji: 'P', maxLevel: 5 }
      },
      getUpgradeCost: () => 12
    },
    accrualExports: {
      settleAndMutate: async (_playerId, _business, fn) => fn(),
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let coins = 50;
  let level = null;
  const db = {
    resolveCinemaPlayerByDiscord: () => ({ id: 6 }),
    getCinemaTheater: () => ({ theater_level: 1 }),
    getCinemaUpgrade: () => ({ level: 0 }),
    getPlayerById: () => ({ coins }),
    deductPlayerCoins: (_playerId, amount) => {
      coins -= amount;
      return true;
    },
    setCinemaUpgrade: (_playerId, _type, next) => {
      level = next;
    }
  };

  const app = makeRouteApp();
  registerCinemaRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/cinema/:discordUserId/upgrade'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: { upgradeType: 'projectors' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.newLevel, 1);
  assert.equal(res.body.playerCoins, 38);
  assert.equal(level, 1);
});

test('startup collect smoke', async () => {
  const ledgerEvents = [];
  const registerStartupRoutes = loadRouteWithMocks({
    routeFile: 'startup.js',
    configFile: 'startup-config.js',
    registerName: 'registerStartupRoutes',
    configExports: {
      calculatePendingIncome: () => ({
        xpEarned: 40,
        xpGained: 6,
        launchesCompleted: 2,
        usersServed: 80,
        collectCap: 1000,
        capped: false
      }),
      MAX_STARTUP_LEVEL: 100,
      xpForLevel: () => 999,
      getCollectCap: () => 1000,
      STARTUP_UPGRADES: {}
    },
    accrualExports: {
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  let playerCoins = 10;
  let startupState = {
    hub_level: 1,
    hub_xp: 0,
    prestige_level: 0,
    total_users_served: 0,
    total_xp_earned: 0,
    last_collected_at: '2026-03-28 00:00:00'
  };
  const db = {
    resolveStartupPlayerByDiscord: () => ({ id: 7, username: 'start' }),
    getPlayerById: () => ({ coins: playerCoins }),
    withTransaction: async (fn) => fn(),
    getStartupHub: () => startupState,
    getStartupUpgrades: () => [],
    updatePlayerCoins: (_playerId, amount) => {
      playerCoins += amount;
    },
    updateStartupHub: (_playerId, fields) => {
      startupState = { ...startupState, ...fields };
    }
  };
  const ledger = {
    record(entry) {
      ledgerEvents.push(entry);
    }
  };

  const app = makeRouteApp();
  registerStartupRoutes(app, { db, ledger });
  const handler = app.routes['POST /api/admin/startup/:discordUserId/collect'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.collected, 40);
  assert.equal(res.body.newBalance, 50);
  assert.equal(startupState.total_users_served, 80);
  assert.equal(startupState.total_xp_earned, 40);
  assert.equal(ledgerEvents.length, 1);
});

test('bank prestige smoke', async () => {
  const registerBankRoutes = loadRouteWithMocks({
    routeFile: 'bank.js',
    configFile: 'bank-config.js',
    registerName: 'registerBankRoutes',
    configExports: {
      getPrestigeTierName: () => 'Sovereign',
      getPrestigeMultiplier: () => 3,
      BANK_UPGRADES: {}
    },
    accrualExports: {
      settleAndMutate: async (_playerId, _business, fn) => fn(),
      getManagedPresenceMultiplier: () => 1
    },
    taxSeasonExports: passthroughTaxSeason
  });

  const db = {
    resolveBankPlayerByDiscord: () => ({ id: 8 }),
    prestigeBankVault: () => ({ ok: true, newPrestigeLevel: 3 })
  };

  const app = makeRouteApp();
  registerBankRoutes(app, { db, ledger: null });
  const handler = app.routes['POST /api/admin/bank/:discordUserId/prestige'];
  const res = makeRes();
  await handler({ params: { discordUserId: 'u' }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    message: 'Prestiged to Sovereign! (3x income)',
    prestigeLevel: 3,
    tierName: 'Sovereign',
    multiplier: 3
  });
});
