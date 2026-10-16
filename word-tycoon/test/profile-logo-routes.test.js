const test = require('node:test');
const assert = require('node:assert/strict');

const { registerCosmeticsRoutes } = require('../src/routes/cosmetics');

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

test('discord cosmetics payload includes selected profile logo metadata', () => {
  const app = createAppStub();
  const db = {
    queryOne(_sql, params) {
      return { preferred_display_name: params[0] === 'discord-user' ? 'Signal Queen' : null };
    },
    resolveAccountProfileImage(discordId) {
      assert.equal(discordId, 'discord-user');
      return {
        profilePic: '/portal/assets/profile-logos/neon-arcade.png',
        profileLogo: { id: 'pl_neon_arcade', name: 'Neon Arcade' }
      };
    },
    getLinkedAccounts() {
      return [{ platform: 'tiktok', platform_user_id: 'tt123' }];
    }
  };
  const gameEngine = {
    getPlayerCosmeticsForAPI(platform, userId) {
      assert.equal(platform, 'tiktok');
      assert.equal(userId, 'tt123');
      return [{ cosmetic_id: 'wc_crimson', category: 'word_color' }];
    }
  };

  registerCosmeticsRoutes(app, {
    db,
    gameEngine,
    requireApiKey: (_req, _res, next) => next && next(),
    broadcastCosmeticsUpdate: () => {}
  });

  const handler = getRoute(app, 'GET', '/api/cosmetics/discord/:discordId');
  const res = createResRecorder();
  handler({ params: { discordId: 'discord-user' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    equipped: [{ cosmetic_id: 'wc_crimson', category: 'word_color' }],
    preferredDisplayName: 'Signal Queen',
    profilePic: '/portal/assets/profile-logos/neon-arcade.png',
    profileLogo: { id: 'pl_neon_arcade', name: 'Neon Arcade' }
  });
});
