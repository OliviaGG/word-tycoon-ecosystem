'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createPremiumWebGate } = require('../server/web-premium-gate');
function fixture() {
  let identity = 'provider-a', accountCalls = 0, entitlementCalls = 0, active = true, account = 'anchor-a';
  const gate = createPremiumWebGate({
    gameShared: { resolveWebIdentity: async () => ({ verified: true, id: identity, claimIsSamePerson: true }),
      passesPremiumWebGate: async () => false },
    playBilling: { hasReviewerAccess: () => false, hasActiveEntitlement: async () => { entitlementCalls++; return active; } },
    resolveAccount: async () => { accountCalls++; return account; },
  });
  const socket = { handshake: { headers: { cookie: 'isolated-cookie' } }, emit() {} };
  return { socket, guess: (s = socket) => gate({ message: 'care', user: { id: identity } }, s, 'mp'),
    calls: () => ({ accountCalls, entitlementCalls }), revoke: () => { active = false; },
    identity: () => { identity = 'provider-b'; }, fail: () => { account = null; } };
}
test('repeated guesses reuse trusted account resolution while rechecking access', async () => {
  const f = fixture(); assert.equal(await f.guess(), true); assert.equal(await f.guess(), true);
  assert.deepEqual(f.calls(), { accountCalls: 1, entitlementCalls: 2 }); f.revoke(); assert.equal(await f.guess(), false);
});
test('a new connection or changed verified identity resolves its own account', async () => {
  const f = fixture(); await f.guess(); f.identity(); await f.guess();
  await f.guess({ handshake: { headers: { cookie: 'other-cookie' } }, emit() {} });
  assert.equal(f.calls().accountCalls, 3);
});
test('failed account lookups are retried', async () => {
  const f = fixture(); f.fail(); assert.equal(await f.guess(), false); assert.equal(await f.guess(), false);
  assert.equal(f.calls().accountCalls, 2);
});
