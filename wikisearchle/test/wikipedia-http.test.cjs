'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '../lib/wikipedia.js'), 'utf8');

function transport() {
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = () => { request.destroyed = true; };
  const timers = [];
  let respond, requestedUrl;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    require: (name) => {
      assert.equal(name, 'https');
      return { get: (url, options, callback) => {
        requestedUrl = url;
        assert.match(options.headers['User-Agent'], /WikiWord/);
        respond = callback;
        return request;
      } };
    },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { timer.cleared = true; },
  });
  const pending = module.exports.fetchLeadSection('Example title');
  return {
    pending, request, timers,
    get url() { return requestedUrl; },
    respond(statusCode = 200) {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.destroyed = false;
      response.destroy = () => { response.destroyed = true; };
      respond(response);
      return response;
    },
  };
}

test('Wikipedia JSON completes normally and clears the total deadline', async () => {
  const http = transport();
  assert.match(http.url, /page=Example%20title/);
  assert.equal(http.timers[0].delay, 8000);
  const response = http.respond();
  response.emit('data', '{"parse":{"title":"Resolved title",');
  response.emit('data', '"text":"<p>A normal article paragraph.</p>"}}');
  assert.equal(http.timers[0].cleared, false, 'Headers must not cancel the body deadline');
  response.emit('end');
  response.emit('close');
  assert.deepEqual(JSON.parse(JSON.stringify(await http.pending)), {
    title: 'Resolved title', plaintext: 'A normal article paragraph.',
  });
  assert.equal(http.timers[0].cleared, true);
  assert.equal(http.request.destroyed, false);
  assert.equal(response.destroyed, false);
});

for (const receivedHeaders of [false, true]) {
  test(`Wikipedia deadline aborts a stalled ${receivedHeaders ? 'body' : 'connection'}`, async () => {
    const http = transport();
    const response = receivedHeaders ? http.respond() : null;
    if (response) response.emit('data', '{"parse":');
    http.timers[0].callback();
    await assert.rejects(http.pending, { code: 'ETIMEDOUT' });
    assert.equal(http.timers[0].cleared, true);
    assert.equal(http.request.destroyed, true);
    if (response) assert.equal(response.destroyed, true);
    // Late transport errors must not escape after the timeout has settled.
    http.request.emit('error', new Error('late connection error'));
    if (response) response.emit('error', new Error('late response error'));
  });
}

test('Wikipedia rejects non-success HTTP responses without waiting for a body', async () => {
  const http = transport();
  const response = http.respond(429);
  await assert.rejects(http.pending, /Wikipedia HTTP 429/);
  assert.equal(http.timers[0].cleared, true);
  assert.equal(http.request.destroyed, true);
  assert.equal(response.destroyed, true);
});

for (const event of ['aborted', 'close', 'error']) {
  test(`Wikipedia rejects an incomplete response on ${event}`, async () => {
    const http = transport();
    const response = http.respond();
    response.emit('data', '{"parse":');
    response.emit(event, ...(event === 'error' ? [new Error('response failed')] : []));
    await assert.rejects(http.pending, /aborted|closed before completion|response failed/);
    assert.equal(http.timers[0].cleared, true);
    assert.equal(http.request.destroyed, true);
    assert.equal(response.destroyed, true);
  });
}

test('Wikipedia request failures clear the deadline', async () => {
  const http = transport();
  http.request.emit('error', new Error('connection failed'));
  await assert.rejects(http.pending, /connection failed/);
  assert.equal(http.timers[0].cleared, true);
  assert.equal(http.request.destroyed, true);
});

test('Wikipedia rejects malformed JSON and clears the deadline', async () => {
  const http = transport();
  const response = http.respond();
  response.emit('data', '<html>upstream error</html>');
  response.emit('end');
  await assert.rejects(http.pending, /JSON|Unexpected token/);
  assert.equal(http.timers[0].cleared, true);
});
