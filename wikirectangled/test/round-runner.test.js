const test = require('node:test');
const assert = require('node:assert/strict');

const { RoundRunner } = require('../src/round-runner');

test('_persistStateSoon persists once when its debounce expires', () => {
  const runner = Object.create(RoundRunner.prototype);
  runner._persistTimer = null;

  let persisted = 0;
  runner._persistState = () => { persisted += 1; };

  const realSetTimeout = global.setTimeout;
  let scheduled = null;
  const timerHandle = { fake: true };

  global.setTimeout = (callback, delay) => {
    scheduled = { callback, delay };
    return timerHandle;
  };

  try {
    runner._persistStateSoon();
    runner._persistStateSoon();

    assert.equal(scheduled.delay, 5000);
    assert.equal(runner._persistTimer, timerHandle);
    assert.equal(persisted, 0);

    scheduled.callback();

    assert.equal(runner._persistTimer, null);
    assert.equal(persisted, 1);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});
