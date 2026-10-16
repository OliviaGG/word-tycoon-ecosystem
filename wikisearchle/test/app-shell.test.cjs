const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function worker(fetch, extra = {}) {
  const handlers = {}, entries = new Map(), puts = [], deleted = [];
  const key = request => typeof request === 'string' ? request : request.url;
  const cache = {
    match: async request => entries.get(key(request)),
    put: async (request, response) => { puts.push(key(request)); entries.set(key(request), response); },
    add: async () => {},
    ...extra.cache
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['wkx-shell-old', 'wkx-shell-v12-home', read('public/sw.js').match(/const CACHE_VERSION = '([^']+)'/)[1], 'other-app-cache'],
    delete: async name => { deleted.push(name); },
  };
  vm.runInNewContext(read('public/sw.js'), {
    self: { location: { origin: 'https://wikicontexto.com' }, addEventListener: (name, handler) => { handlers[name] = handler; }, clients: { claim: async () => {} }, skipWaiting: async () => {} },
    caches, fetch, URL, Request, Response,
  });
  function dispatch(url, options = {}) {
    const lifetime = [];
    const event = { request: { url: new URL(url, 'https://wikicontexto.com').href, method: 'GET', mode: 'cors', ...options }, waitUntil: p => lifetime.push(p), respondWith: p => { event.response = p; } };
    handlers.fetch(event);
    return { event, lifetime };
  }
  return { dispatch, handlers, entries, puts, deleted };
}

test('API, identity, sockets, admin, external, and mutation requests bypass the cache', () => {
  const w = worker(() => { throw Error('Worker must not intercept this request'); });
  for (const url of ['/api/solo/daily', '/api/me/session', '/socket.io/?EIO=4', '/auth/callback', '/review-access', '/solo/admin.html', '/js/app.js?auth_token=private', 'https://wordtycoon.live/api/me/session']) {
    assert.equal(w.dispatch(url).event.response, undefined, url);
  }
  assert.equal(w.dispatch('/api/solo/guess', { method: 'POST' }).event.response, undefined);
});

test('navigation requests fetch current HTML without retaining it', async () => {
  const fresh = new Response('current puzzle');
  const w = worker(async () => fresh);
  w.entries.set('https://wikicontexto.com/', new Response('old puzzle'));
  const { event } = w.dispatch('/?source=play', { mode: 'navigate' });
  assert.equal(await (await event.response).text(), 'current puzzle');
  assert.deepEqual(w.puts, []);
});

test('offline app navigation displays the reconnect screen without stale puzzle HTML', async () => {
  const w = worker(async () => { throw Error('offline'); });
  w.entries.set('/offline.html', new Response('reconnect screen'));
  w.entries.set('https://wikicontexto.com/', new Response('old account or puzzle'));
  const { event } = w.dispatch('/online?source=play', { mode: 'navigate' });
  assert.equal(await (await event.response).text(), 'reconnect screen');
});

test('cached static responses retain background revalidation until cache write completes', async () => {
  let finish;
  const w = worker(() => new Promise(resolve => { finish = resolve; }));
  const url = 'https://wikicontexto.com/css/theme.css?v=2';
  w.entries.set(url, new Response('cached style'));
  const { event, lifetime } = w.dispatch(url);
  assert.equal(await (await event.response).text(), 'cached style');
  assert.equal(lifetime.length, 1);
  finish({ ok: true, type: 'basic', redirected: false, headers: new Headers(), clone: () => new Response('new style') });
  await Promise.all(lifetime);
  assert.equal(await (await w.entries.get(url)).text(), 'new style');
});

test('private/redirected static responses are never cached', async () => {
  for (const properties of [{ headers: new Headers({ 'Cache-Control': 'private' }) }, { redirected: true }]) {
    const response = { ok: true, type: 'basic', redirected: false, headers: new Headers(), ...properties };
    const w = worker(async () => response);
    const { event, lifetime } = w.dispatch('/js/theme.js');
    assert.equal(await event.response, response);
    await Promise.all(lifetime);
    assert.deepEqual(w.puts, []);
  }
});

test('cache quota failures do not discard the successful network response', async () => {
  const response = { ok: true, type: 'basic', redirected: false, headers: new Headers(), clone: () => new Response('style') };
  const w = worker(async () => response, { cache: { put: async () => { throw Error('quota'); } } });
  assert.equal(await w.dispatch('/css/theme.css').event.response, response);
});

test('activation retires only old WikiContexto shell caches', async () => {
  const w = worker(async () => new Response());
  let completion;
  w.handlers.activate({ waitUntil: p => { completion = p; } });
  await completion;
  assert.deepEqual(w.deleted, ['wkx-shell-old', 'wkx-shell-v12-home']);
});

test('solo, online, and private-session entrypoints all advertise the app shell', () => {
  const routes = new Map();
  require('../src/seo-middleware').attach({ get: (route, handler) => routes.set(route, handler) });
  for (const [route, query, expected] of [['/', {}, 'bubble-menu'], ['/daily', {}, '/solo/solo.js'], ['/solo', {}, '/solo/solo.js'], ['/online', {}, 'Live Multiplayer'], ['/', { session: 'test-room' }, 'Live Multiplayer']]) {
    let html;
    routes.get(route)({ method: 'GET', query, headers: { host: 'wikicontexto.com' } }, { set: () => {}, send: result => { html = result; } }, error => { throw error; });
    assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
    const bundled = html.includes('data-vite-ui="true"');
    assert.match(html, bundled ? /type="module"[^>]*src="\/assets\// : /\/js\/app-shell\.js/);
    assert.ok(html.includes(expected) || (bundled && expected === '/solo/solo.js' && html.includes('Solo mode')));
  }
});

test('Android Digital Asset Links statements form one valid array for game and OAuth hub', () => {
  const raw = read('android/app/src/main/res/values/strings.xml').match(/<string name="assetStatements">([\s\S]*?)<\/string>/)[1];
  const statements = JSON.parse(raw.replaceAll('\\"', '"'));
  assert.ok(Array.isArray(statements));
  assert.deepEqual(statements.map(s => s.target.site), ['https://wikicontexto.com', 'https://wordtycoon.live']);
});
