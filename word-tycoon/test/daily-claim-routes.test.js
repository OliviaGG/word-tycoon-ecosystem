const test = require('node:test');
const assert = require('node:assert/strict');
const { registerDailyClaimRoutes } = require('../src/routes/daily-claim');

function createAppStub() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) {
      routes.push({ method: 'GET', path, handlers });
    },
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

test('player-game-stats keeps Discord-linked lookup unchanged', () => {
  const app = createAppStub();
  const calls = [];
  const db = {
    getAllPlayerIdsForDiscord(identityKey) {
      calls.push(['getAllPlayerIdsForDiscord', identityKey]);
      return identityKey === 'abc' ? [1, 2] : [];
    },
    resolvePlayer() {
      calls.push(['resolvePlayer']);
      return null;
    },
    getPlayerByUsername() {
      calls.push(['getPlayerByUsername']);
      return null;
    },
    getPlayerByDisplayName() {
      calls.push(['getPlayerByDisplayName']);
      return null;
    },
    getAllPlayerIdsFromPlayer(playerId) {
      calls.push(['getAllPlayerIdsFromPlayer', playerId]);
      return [playerId];
    },
    getPlayerGameStats(playerIds, game) {
      calls.push(['getPlayerGameStats', playerIds, game]);
      return { totalWins: 4, games: { wordle: { wins: 4 } } };
    }
  };

  registerDailyClaimRoutes(app, {
    db,
    gameEngine: { REQUIRED_DAILY_GAMES: [], REQUIRED_WEEKLY_GAMES: [] },
    requireApiKey: (_req, _res, next) => next && next()
  });

  const handler = getRoute(app, 'GET', '/api/player-game-stats/:discordId');
  const res = createResRecorder();
  handler({ params: { discordId: 'abc' }, query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, totalWins: 4, games: { wordle: { wins: 4 } } });
  assert.deepEqual(calls, [
    ['getAllPlayerIdsForDiscord', 'abc'],
    ['getPlayerGameStats', [1, 2], null]
  ]);
});

test('player-game-stats falls back to TikTok-only player ids when no Discord link exists', () => {
  const app = createAppStub();
  const calls = [];
  const db = {
    getAllPlayerIdsForDiscord(identityKey) {
      calls.push(['getAllPlayerIdsForDiscord', identityKey]);
      return [];
    },
    resolvePlayer(platform, identityKey) {
      calls.push(['resolvePlayer', platform, identityKey]);
      return platform === 'tiktok' && identityKey === 'tt_alpha'
        ? { id: 7, platform: 'tiktok', platform_user_id: 'tt_alpha' }
        : null;
    },
    getPlayerByUsername(platform, identityKey) {
      calls.push(['getPlayerByUsername', platform, identityKey]);
      return null;
    },
    getPlayerByDisplayName(platform, identityKey) {
      calls.push(['getPlayerByDisplayName', platform, identityKey]);
      return null;
    },
    getAllPlayerIdsFromPlayer(playerId) {
      calls.push(['getAllPlayerIdsFromPlayer', playerId]);
      return [7];
    },
    getPlayerGameStats(playerIds, game) {
      calls.push(['getPlayerGameStats', playerIds, game]);
      return { totalWins: 2, games: { searchle: { wins: 2 } } };
    }
  };

  registerDailyClaimRoutes(app, {
    db,
    gameEngine: { REQUIRED_DAILY_GAMES: [], REQUIRED_WEEKLY_GAMES: [] },
    requireApiKey: (_req, _res, next) => next && next()
  });

  const handler = getRoute(app, 'GET', '/api/player-game-stats/:discordId');
  const res = createResRecorder();
  handler({ params: { discordId: 'tt_alpha' }, query: { game: 'searchle' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, totalWins: 2, games: { searchle: { wins: 2 } } });
  assert.deepEqual(calls, [
    ['getAllPlayerIdsForDiscord', 'tt_alpha'],
    ['resolvePlayer', 'tiktok', 'tt_alpha'],
    ['getAllPlayerIdsFromPlayer', 7],
    ['getPlayerGameStats', [7], 'searchle']
  ]);
});
