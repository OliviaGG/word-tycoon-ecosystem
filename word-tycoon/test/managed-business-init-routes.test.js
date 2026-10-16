const test = require('node:test');
const assert = require('node:assert/strict');

const { registerPizzaRoutes } = require('../src/routes/pizza');
const { registerNewspaperRoutes } = require('../src/routes/newspaper');
const { registerGymRoutes } = require('../src/routes/gym');
const { registerCinemaRoutes } = require('../src/routes/cinema');
const { registerStartupRoutes } = require('../src/routes/startup');
const { registerBankRoutes } = require('../src/routes/bank');

function makeRouteApp() {
  const routes = {};
  return {
    routes,
    get(path, handler) {
      routes[`GET ${path}`] = handler;
    },
    post(path, handler) {
      routes[`POST ${path}`] = handler;
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

const cases = [
  {
    name: 'pizza',
    path: '/api/admin/pizza/:discordUserId/init',
    register(app, db) {
      registerPizzaRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolvePizzaPlayerByDiscord',
    getterFn: 'getPizzaShop',
    responseKey: 'shop',
    expectedMessage: 'Pizza Shop already initialized!'
  },
  {
    name: 'newspaper',
    path: '/api/admin/newspaper/:discordUserId/init',
    register(app, db) {
      registerNewspaperRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolveNewspaperPlayerByDiscord',
    getterFn: 'getNewspaperRoute',
    responseKey: 'route',
    expectedMessage: 'Newspaper Route already initialized!'
  },
  {
    name: 'gym',
    path: '/api/admin/gym/:discordUserId/init',
    register(app, db) {
      registerGymRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolveGymPlayerByDiscord',
    getterFn: 'getGymClub',
    responseKey: 'club',
    expectedMessage: 'Gym already initialized!'
  },
  {
    name: 'cinema',
    path: '/api/admin/cinema/:discordUserId/init',
    register(app, db) {
      registerCinemaRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolveCinemaPlayerByDiscord',
    getterFn: 'getCinemaTheater',
    responseKey: 'theater',
    expectedMessage: 'Cinema already initialized!'
  },
  {
    name: 'startup',
    path: '/api/admin/startup/:discordUserId/init',
    register(app, db) {
      registerStartupRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolveStartupPlayerByDiscord',
    getterFn: 'getStartupHub',
    responseKey: 'hub',
    expectedMessage: 'Startup already initialized!'
  },
  {
    name: 'bank',
    path: '/api/admin/bank/:discordUserId/init',
    register(app, db) {
      registerBankRoutes(app, { db, ledger: null });
    },
    resolveFn: 'resolveBankPlayerByDiscord',
    getterFn: 'getBankVault',
    responseKey: 'vault',
    expectedMessage: 'Bank already initialized!'
  }
];

test('managed business init routes reuse an existing linked-account row', async (t) => {
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let linkedLookupCalls = 0;
      let createCalls = 0;
      const existingRecord = { player_id: 42, marker: scenario.name };
      const db = {
        [scenario.resolveFn]: (discordUserId) => {
          assert.equal(discordUserId, 'discord-user');
          return { id: 42 };
        },
        [scenario.getterFn]: (playerId) => {
          assert.equal(playerId, 42);
          return existingRecord;
        },
        getAllPlayerIdsForDiscord: () => {
          linkedLookupCalls += 1;
          return [];
        },
        resolveUnifiedPlayerByDiscord: () => ({ id: 999 }),
        getPlayerBusiness: () => null,
        createPizzaShop: () => { createCalls += 1; return null; },
        createNewspaperRoute: () => { createCalls += 1; return null; },
        createGymClub: () => { createCalls += 1; return null; },
        createCinemaTheater: () => { createCalls += 1; return null; },
        createStartupHub: () => { createCalls += 1; return null; },
        createBankVault: () => { createCalls += 1; return null; }
      };

      const app = makeRouteApp();
      scenario.register(app, db);

      const handler = app.routes[`POST ${scenario.path}`];
      assert.ok(handler, `expected handler for ${scenario.path}`);

      const res = makeRes();
      await handler({ params: { discordUserId: 'discord-user' } }, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        ok: true,
        message: scenario.expectedMessage,
        [scenario.responseKey]: existingRecord
      });
      assert.equal(linkedLookupCalls, 0, 'should not scan linked account ownership once an existing row is found');
      assert.equal(createCalls, 0, 'should not create a duplicate managed business row');
    });
  }
});
