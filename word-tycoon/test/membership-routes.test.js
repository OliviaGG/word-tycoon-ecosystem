const test = require('node:test');
const assert = require('node:assert/strict');

const membership = require('../src/membership');
const { registerMembershipRoutes } = require('../src/routes/membership');

function createAppStub() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) {
      routes.push({ method: 'GET', path, handlers });
    },
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    },
    delete(path, ...handlers) {
      routes.push({ method: 'DELETE', path, handlers });
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

test('membership checkout redirects an existing subscriber to the Stripe billing portal', async (t) => {
  const originalCreateCheckoutSession = membership.createCheckoutSession;
  t.after(() => {
    membership.createCheckoutSession = originalCreateCheckoutSession;
  });

  membership.createCheckoutSession = async () => {
    const error = new Error('Existing Stripe subscription must be managed in the billing portal');
    error.code = 'subscription_exists';
    error.portalUrl = 'https://billing.stripe.com/session/test_portal';
    throw error;
  };

  const app = createAppStub();
  registerMembershipRoutes(app, { db: {} });

  const handler = getRoute(app, 'POST', '/api/admin/membership/:discordUserId/checkout');
  const res = createResRecorder();
  await handler({
    params: { discordUserId: 'discord-user' },
    body: { tier: 'donor_class' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    code: 'subscription_exists',
    destination: 'billing_portal',
    url: 'https://billing.stripe.com/session/test_portal'
  });
});

test('membership checkout still reports a conflict when a portal session cannot be created', async (t) => {
  const originalCreateCheckoutSession = membership.createCheckoutSession;
  t.after(() => {
    membership.createCheckoutSession = originalCreateCheckoutSession;
  });

  membership.createCheckoutSession = async () => {
    const error = new Error('Existing Stripe subscription must be managed in the billing portal');
    error.code = 'subscription_exists';
    error.portalUrl = '';
    throw error;
  };

  const app = createAppStub();
  registerMembershipRoutes(app, { db: {} });

  const handler = getRoute(app, 'POST', '/api/admin/membership/:discordUserId/checkout');
  const res = createResRecorder();
  await handler({
    params: { discordUserId: 'discord-user' },
    body: { tier: 'donor_class' }
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'subscription_exists');
  assert.equal(res.body.url, '');
});
