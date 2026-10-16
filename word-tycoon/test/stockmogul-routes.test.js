'use strict';

const assert = require('node:assert');
const { describe, it, beforeEach } = require('node:test');

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

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadCarwashRoutes(overrides = {}) {
  const routePath = '../src/routes/carwash';
  const taxSeasonPath = require.resolve('../src/tax-season');
  const accrualPath = require.resolve('../src/accrual');
  const presencePath = require.resolve('../src/presence');

  clearModule(routePath);
  require.cache[taxSeasonPath] = {
    exports: {
      TAX_SEASON_CONFIRMATION: 'RESET MY EMPIRE',
      getTaxSeasonEligibility() { return { eligible: false }; },
      getTaxSeasonState() { return { completed: false }; },
      getIncomeMultiplier() { return 1; },
      scaleObjectFields(value) { return value; },
      scaleIncomeAmount(value) { return value; },
      async runTaxSeasonReset() { return { ok: false }; }
    }
  };
  require.cache[accrualPath] = {
    exports: {
      async settleAndMutate(playerId, businessType, mutationFn) {
        return mutationFn();
      },
      getManagedPresenceMultiplier() {
        return 1;
      },
      ...overrides.accrual
    }
  };
  require.cache[presencePath] = {
    exports: {
      touch() {}
    }
  };
  return require(routePath);
}

function loadStockMogulRoutes(overrides = {}) {
  const routePath = '../src/routes/stockmogul';
  const taxSeasonPath = require.resolve('../src/tax-season');
  const accrualPath = require.resolve('../src/accrual');
  const presencePath = require.resolve('../src/presence');
  const configPath = require.resolve('../src/stockmogul-config');

  clearModule(routePath);
  require.cache[taxSeasonPath] = {
    exports: {
      getIncomeMultiplier() { return 1; },
      scaleObjectFields(value) { return value; },
      scaleIncomeAmount(value) { return value; }
    }
  };
  require.cache[accrualPath] = {
    exports: {
      getManagedPresenceMultiplier() {
        return 1;
      },
      async settleAndMutate(playerId, businessType, mutationFn) {
        return mutationFn();
      },
      ...overrides.accrual
    }
  };
  require.cache[presencePath] = {
    exports: {
      touch() {}
    }
  };
  require.cache[configPath] = {
    exports: {
      STOCKMOGUL_UPGRADES: {},
      MAX_PORTFOLIO_LEVEL: 100,
      calculatePendingPortfolioCoins() {
        return { portfolioCoins: 0, xpGained: 0, tradesCompleted: 0 };
      },
      getDividendBonus() {
        return 1;
      },
      xpForLevel() {
        return Number.MAX_SAFE_INTEGER;
      },
      getPrestigeTierName() {
        return 'Day Trader';
      },
      getPrestigeMultiplier() {
        return 1;
      },
      getIncomePerSecond() {
        return 0;
      },
      getCycleSeconds() {
        return 1;
      },
      getPortfolioCoinsPerCycle() {
        return 0;
      },
      getPortfolioCoinsCap() {
        return 0;
      },
      getUpgradeEffectPreview() {
        return { current: '', next: null };
      },
      calculateMaxBuy() {
        return { levels: 0, totalCost: 0 };
      },
      getUpgradeCost() {
        return 0;
      },
      getAvailableCustomizations() {
        return {};
      },
      ...overrides.config
    }
  };
  return require(routePath);
}

function loadAccrualWithMocks(overrides = {}) {
  const accrualPath = '../src/accrual';
  const presencePath = require.resolve('../src/presence');
  const cosmeticsPath = require.resolve('../src/cosmetics');
  const taxSeasonPath = require.resolve('../src/tax-season');
  const businessesPath = require.resolve('../src/businesses');
  const stockMogulConfigPath = require.resolve('../src/stockmogul-config');
  const incomePath = require.resolve('../src/income');

  clearModule(accrualPath);
  require.cache[presencePath] = {
    exports: {
      OFFLINE_THRESHOLD_MS: 180000,
      isOnline() { return true; }
    }
  };
  require.cache[cosmeticsPath] = {
    exports: {
      DEFAULT_BUFFS: {},
      getPlayerBuffs() { return {}; }
    }
  };
  require.cache[taxSeasonPath] = {
    exports: {
      getIncomeMultiplier() { return 1; },
      scaleObjectFields(value) { return value; }
    }
  };
  require.cache[businessesPath] = {
    exports: {
      BUSINESSES: {},
      parseUTCTimestamp(value) { return value ? Date.parse(String(value).replace(' ', 'T') + 'Z') : Date.now(); },
      getLibraryLevel() { return 1; },
      isWordUpgrade() { return false; }
    }
  };
  require.cache[stockMogulConfigPath] = {
    exports: {
      MAX_PORTFOLIO_LEVEL: 100,
      calculatePendingPortfolioCoins() {
        return { portfolioCoins: 100, xpGained: 0, tradesCompleted: 1 };
      },
      getDividendBonus() {
        return 1.5;
      },
      xpForLevel() {
        return Number.MAX_SAFE_INTEGER;
      },
      ...overrides.config
    }
  };
  require.cache[incomePath] = {
    exports: {
      createIncomeService() {
        return {
          getPassiveIncomeBase() {
            return 0;
          }
        };
      }
    }
  };
  return require(accrualPath);
}

describe('carwash buy-stockmogul', () => {
  beforeEach(() => {
    clearModule('../src/routes/carwash');
  });

  it('keeps the Stock Mogul portfolio level in sync when upgrading via clean cash', async () => {
    const { registerCarwashRoutes } = loadCarwashRoutes();
    const app = makeRouteApp();
    const calls = [];
    const db = {
      resolveCarwashPlayerByDiscord(discordUserId) {
        if (discordUserId === 'discord-ok') return { id: 7, username: 'alpha' };
        return null;
      },
      getCarwashShop() {
        return { clean_cash: 9000 };
      },
      getPlayerBusiness(playerId, businessType) {
        if (playerId === 7 && businessType === 'stockmogul') {
          return { id: 42, level: 1 };
        }
        return null;
      },
      getStockMogulPortfolio() {
        return { portfolio_level: 1 };
      },
      updateCarwashShop(playerId, fields) {
        calls.push(['updateCarwashShop', playerId, fields]);
      },
      upgradePlayerBusiness(businessId) {
        calls.push(['upgradePlayerBusiness', businessId]);
      },
      updateStockMogulPortfolio(playerId, fields) {
        calls.push(['updateStockMogulPortfolio', playerId, fields]);
      },
      createPlayerBusiness() {
        throw new Error('should not create a new stockmogul business on upgrade');
      },
      createStockMogulPortfolio() {
        throw new Error('should not create a new portfolio when one exists');
      }
    };

    registerCarwashRoutes(app, { db, getPlayerTotalIncomePerSec() { return 0; } });
    const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/api/admin/carwash/:discordUserId/buy-stockmogul');
    const res = makeRes();

    await route.handler({ params: { discordUserId: 'discord-ok' }, body: {} }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.newLevel, 2);
    assert.deepStrictEqual(
      calls.find((entry) => entry[0] === 'updateStockMogulPortfolio'),
      ['updateStockMogulPortfolio', 7, { portfolio_level: 2 }]
    );
  });
});

describe('stockmogul collect', () => {
  beforeEach(() => {
    clearModule('../src/routes/stockmogul');
  });

  it('allows collect when portfolio_coins are already stored even if new pending accrual is zero', async () => {
    const { registerStockMogulRoutes } = loadStockMogulRoutes();
    const app = makeRouteApp();
    const playerState = { coins: 1000 };
    const portfolio = {
      portfolio_level: 3,
      portfolio_xp: 0,
      prestige_level: 0,
      portfolio_coins: 200,
      total_trades: 5,
      total_coins_earned: 1000,
      last_collected_at: '2026-03-28 10:00:00'
    };
    const db = {
      resolveStockMogulPlayerByDiscord(discordUserId) {
        if (discordUserId === 'discord-ok') return { id: 5, username: 'alpha', display_name: 'Alpha', platform: 'discord' };
        return null;
      },
      getPlayerById() {
        return { coins: playerState.coins };
      },
      async withTransaction(fn) {
        return fn();
      },
      getStockMogulPortfolio() {
        return portfolio;
      },
      getStockMogulUpgrades() {
        return [];
      },
      updateStockMogulPortfolio(playerId, fields) {
        Object.assign(portfolio, fields);
      },
      updatePlayerCoins(playerId, amount) {
        playerState.coins += amount;
      }
    };

    registerStockMogulRoutes(app, { db, ledger: null });
    const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/api/admin/stockmogul/:discordUserId/collect');
    const res = makeRes();

    await route.handler({ params: { discordUserId: 'discord-ok' }, body: {} }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.realCoinsEarned, 100);
    assert.strictEqual(res.body.newBalance, 1100);
    assert.strictEqual(portfolio.portfolio_coins, 0);
    assert.strictEqual(portfolio.total_coins_earned, 1100);
  });
});

describe('accrual stockmogul settlement', () => {
  beforeEach(() => {
    clearModule('../src/accrual');
  });

  it('does not treat settled portfolio inventory as lifetime real-coin earnings', () => {
    const accrual = loadAccrualWithMocks();
    const portfolio = {
      portfolio_level: 4,
      portfolio_xp: 0,
      prestige_level: 0,
      portfolio_coins: 200,
      total_trades: 10,
      total_coins_earned: 1000,
      last_collected_at: '2026-03-28 10:00:00'
    };
    const db = {
      getStockMogulPortfolio() {
        return portfolio;
      },
      getStockMogulUpgrades() {
        return [];
      },
      updateStockMogulPortfolio(playerId, fields) {
        Object.assign(portfolio, fields);
      },
      updatePlayerCoins() {
        throw new Error('stockmogul settlement should not pay real coins');
      }
    };

    accrual.initialize(db);
    const result = accrual.settleManagedBusiness(5, 'stockmogul');

    assert.strictEqual(result.settled, true);
    assert.strictEqual(result.amount, 150);
    assert.strictEqual(portfolio.portfolio_coins, 350);
    assert.strictEqual(portfolio.total_coins_earned, 1000);
  });
});
