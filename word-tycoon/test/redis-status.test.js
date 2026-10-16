const test = require('node:test');
const assert = require('node:assert/strict');

const redis = require('../src/redis');

test('in-memory tap buffer reports ready status without redis fallback alarms', () => {
  const status = redis.getStatus();

  assert.equal(status.mode, 'in-memory');
  assert.equal(status.ready, true);
  assert.equal(status.externalService, false);
  assert.equal(status.fallback, false);
  assert.equal(redis.isConnected(), true);
  assert.equal(redis.isUsingFallback(), false);
});
