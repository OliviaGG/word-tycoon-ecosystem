'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture() {
  let now = 1000, calls = 0;
  const requests = [], timers = new Set(), module = { exports: {} };
  const context = { module, process: { env: {} }, Map, Promise, Date: { now: () => now }, AbortSignal,
    console: { error() {} },
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    fetch() { calls++; return new Promise((resolve, reject) => requests.push({ resolve, reject })); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/cosmetics-cache.js'), 'utf8'), context);
  return { ...module.exports, advance(ms) { now += ms; }, calls: () => calls,
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    respond(data, index = 0) { requests[index].resolve({ ok: true, json: async () => ({ equipped: data }) }); },
    timeout() { for (const fn of [...timers]) fn(); }, fail(index = 0) { requests[index].reject(Error('isolated outage')); } };
}
test('guest guesses bypass the decoration service', async () => {
  const f = fixture();
  for (const id of ['web_guest_a', 'guest_a', 'wsguest_a', 'guest-a', 'anon_a']) assert.equal(Object.keys(await f.getPlayerCosmetics('web', id)).length, 0);
  assert.equal(f.calls(), 0);
});
test('a slow first lookup releases acceptance and still warms the next guess', async () => {
  const f = fixture(), lookup = f.getPlayerCosmetics('web', 'player'); await f.flush(); f.timeout();
  assert.equal(Object.keys(await lookup).length, 0);
  const data = { frame: { id: 'frame' } }; f.respond(data); await f.flush();
  assert.equal(await f.getPlayerCosmetics('web', 'player'), data); assert.equal(f.calls(), 1);
});
test('expired cosmetics return immediately while one shared request refreshes them', async () => {
  const f = fixture(), old = { frame: { id: 'old' } }, next = { frame: { id: 'new' } };
  f.invalidatePlayer('web', 'player', old); f.advance(60001);
  assert.equal(await f.getPlayerCosmetics('web', 'player'), old);
  assert.equal(await f.getPlayerCosmetics('web', 'player'), old); assert.equal(f.calls(), 1);
  f.respond(next); await f.flush(); assert.equal(await f.getPlayerCosmetics('web', 'player'), next);
});
test('equipment events supersede a request that started before the change', async () => {
  const f = fixture(), lookup = f.getPlayerCosmetics('web', 'player'); await f.flush();
  const latest = { frame: { id: 'latest' } }; f.invalidatePlayer('web', 'player', latest);
  f.respond({ frame: { id: 'obsolete' } }); await f.flush();
  assert.equal(await lookup, latest); assert.equal(await f.getPlayerCosmetics('web', 'player'), latest);
});
test('an outage keeps recent cosmetics and allows a later refresh attempt', async () => {
  const f = fixture(), old = { title: { id: 'title' } }; f.invalidatePlayer('web', 'player', old); f.advance(60001);
  assert.equal(await f.getPlayerCosmetics('web', 'player'), old); f.fail(); await f.flush();
  assert.equal(await f.getPlayerCosmetics('web', 'player'), old); assert.equal(f.calls(), 2); f.respond({}, 1); await f.flush();
});
