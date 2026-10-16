const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRewardsRoutes } = require('../src/routes/rewards');

function createAppStub() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    }
  };
}

function createResRecorder() {
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

function getRoute(app, method, path) {
  const route = app.routes.find((entry) => entry.method === method && entry.path === path);
  assert.ok(route, `Missing route ${method} ${path}`);
  return route.handlers[route.handlers.length - 1];
}

test('reward route normalizes squaredle to rectangled', () => {
  const app = createAppStub();
  const calls = [];
  registerRewardsRoutes(app, {
    db: {},
    ledger: {},
    gameEngine: {
      handleReward(platform, userId, username, displayName, coins, game) {
        calls.push({ platform, userId, username, displayName, coins, game });
        return { ok: true, game };
      }
    },
    sanitizeCoins(value) {
      return Number(value);
    },
    checkRewardRateLimit() {
      return true;
    },
    MAX_SINGLE_REWARD: 100000
  });

  const handler = getRoute(app, 'POST', '/api/reward');
  const res = createResRecorder();
  handler({
    body: {
      platform: 'tiktok',
      userId: 'tt-1',
      username: 'alpha',
      displayName: 'Alpha',
      coins: 25,
      game: 'squaredle'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{
    platform: 'tiktok',
    userId: 'tt-1',
    username: 'alpha',
    displayName: 'Alpha',
    coins: 25,
    game: 'rectangled'
  }]);
  assert.deepEqual(res.body, { ok: true, game: 'rectangled' });
});

test('reward route normalizes legacy sproutle to erectangled', () => {
  const app = createAppStub();
  const calls = [];
  registerRewardsRoutes(app, {
    db: {},
    ledger: {},
    gameEngine: {
      handleReward(platform, userId, username, displayName, coins, game) {
        calls.push({ platform, userId, username, displayName, coins, game });
        return { ok: true, game };
      }
    },
    sanitizeCoins(value) {
      return Number(value);
    },
    checkRewardRateLimit() {
      return true;
    },
    MAX_SINGLE_REWARD: 100000
  });

  const handler = getRoute(app, 'POST', '/api/reward');
  const res = createResRecorder();
  handler({
    body: {
      platform: 'tiktok',
      userId: 'tt-2',
      username: 'beta',
      displayName: 'Beta',
      coins: 25,
      game: 'sproutle'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{
    platform: 'tiktok',
    userId: 'tt-2',
    username: 'beta',
    displayName: 'Beta',
    coins: 25,
    game: 'erectangled'
  }]);
  assert.deepEqual(res.body, { ok: true, game: 'erectangled' });
});
