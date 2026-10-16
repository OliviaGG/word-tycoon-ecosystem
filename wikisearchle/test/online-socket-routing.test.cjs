'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function connect(pathname, search = '') {
  const source = fs.readFileSync(path.join(__dirname, '../client/src/online/game.js'), 'utf8');
  const end = source.indexOf('  let roundStateReady');
  assert.ok(end > 0, 'Connection setup precedes game handlers');
  const calls = [];
  vm.runInNewContext(source.slice(0, end) + '})();', {
    location: { pathname, search }, URLSearchParams,
    io: (...args) => { calls.push(JSON.parse(JSON.stringify(args))); return {}; },
  });
  assert.equal(calls.length, 1);
  return calls[0];
}

test('dashboard and audience-room embeds keep credentials on the game proxy and retain the private session', () => {
  for (const pathname of ['/game/wikisearchle/', '/game/wikisearchle/index.html', '/game/wikisearchle/online']) {
    assert.deepEqual(connect(pathname, '?session=JorryBeaufart&stream_widget=1&obs=1'), [
      { path: '/game/wikisearchle/socket.io', withCredentials: true, auth: { session: 'jorrybeaufart' } },
    ]);
  }
});

test('direct production and Vite pages retain same-origin sockets and their session', () => {
  for (const pathname of ['/', '/online', '/index.html', '/game/wikisearchle-other/']) {
    assert.deepEqual(connect(pathname, '?session=jorrybeaufart'), [
      { path: '/socket.io', withCredentials: true, auth: { session: 'jorrybeaufart' } },
    ]);
  }
});

test('public and invalid-session embeds connect to the game without joining a private round', () => {
  for (const search of ['', '?session=invalid.handle', '?session=../other']) {
    assert.deepEqual(connect('/game/wikisearchle/', search), [
      { path: '/game/wikisearchle/socket.io', withCredentials: true },
    ]);
  }
});
