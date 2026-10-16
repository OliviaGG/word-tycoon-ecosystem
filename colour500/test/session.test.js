'use strict';
// ─── Color 500 — private streamer session tests ───────────────────────────
// Boots the real server against a stand-in Chat Relay that serves a streamer
// whitelist, then drives it with genuine `chat-message` payloads carrying
// `streamerHandle`.
//
// Run with:  node test/session.test.js
//
// The properties that matter:
//   - a streamer's chat plays THEIR round and never touches the public board
//   - unknown handles cannot lazily create sessions (fail-closed whitelist)
//   - a session win emits game-win STAMPED with streamerHandle, which is what
//     scopes the Win Card overlay and the win tallies to that streamer

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');

const RELAY_PORT = 3094;
const GAME_PORT = 3093;
const SECRET = 'test-secret-for-session-tests';
const HANDLE = 'teststreamer';
const OTHER = 'otherstreamer';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'colour500-sess-'));

let passed = 0, failed = 0, child = null, relay = null, relayIo = null;

function check(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name); console.log('       ' + err.message); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function chatMessage(text, handle, opts = {}) {
  return {
    id: 'm' + Math.random().toString(36).slice(2),
    platform: 'tiktok',
    user: {
      id: opts.userId || 'viewer-1',
      username: opts.username || 'viewer1',
      displayName: opts.displayName || 'Viewer One',
      profilePic: null,
      badges: opts.badges || [],
    },
    message: text,
    timestamp: new Date().toISOString(),
    streamerHandle: handle,
  };
}

async function api(pathname, opts = {}) {
  const res = await fetch(`http://localhost:${GAME_PORT}${pathname}`, opts);
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body, res };
}

const adminHeaders = { 'x-api-key': SECRET, 'content-type': 'application/json' };

async function main() {
  const wins = [];
  let registered = null;

  // ── Stand-in relay: whitelist + app-register + game-win sink ────────────
  relay = http.createServer((req, res) => {
    if (req.url.startsWith('/api/streamer-handles')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ handles: [HANDLE, OTHER] }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  relayIo = new Server(relay);
  relayIo.on('connection', (socket) => {
    socket.on('app-register', (data, cb) => {
      registered = data;
      if (typeof cb === 'function') cb({ success: true, id: data && data.id });
    });
    socket.on('game-win', (p) => wins.push(p));
  });
  await new Promise(r => relay.listen(RELAY_PORT, r));

  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      GAME_API_SECRET: SECRET,
      PORT: String(GAME_PORT),
      CHAT_RELAY_URL: `http://localhost:${RELAY_PORT}`,
      COLOUR500_DATA_DIR: SCRATCH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  for (let i = 0; i < 80 && !registered; i++) await wait(100);
  await wait(400); // let the whitelist fetch land

  console.log('\nsession URLs (fail-closed whitelist)');

  const good = await api('/' + HANDLE, { redirect: 'manual' });
  check('a whitelisted handle serves the player page', () => {
    assert.strictEqual(good.status, 200, 'log: ' + log.slice(-300));
  });

  const bad = await api('/nosuchstreamer', { redirect: 'manual' });
  check('an unknown handle redirects to the public game', () => {
    assert.ok(bad.status === 302 || bad.status === 301, 'got ' + bad.status);
  });

  const overlayOk = await api('/overlay/' + HANDLE, { redirect: 'manual' });
  check('the OBS overlay serves for a whitelisted handle', () => {
    assert.strictEqual(overlayOk.status, 200);
  });

  const overlayBad = await api('/overlay/nosuchstreamer', { redirect: 'manual' });
  check('the OBS overlay refuses an unknown handle', () => {
    assert.ok(overlayBad.status === 302 || overlayBad.status === 301);
  });

  const soloStill = await api('/solo', { redirect: 'manual' });
  check('/solo is not swallowed by the handle route', () => {
    assert.strictEqual(soloStill.status, 200);
  });

  console.log('\nstreamer chat plays the streamer\'s own round');

  const emitChat = (msg) => relayIo.emit('chat-message', msg);
  const mm = require('../src/mastermind');

  const publicBefore = (await api('/api/state')).body.guesses.length;

  emitChat(chatMessage('🟥🟩🟦🟨', HANDLE));
  await wait(400);

  let sess = await api('/api/session/state/' + HANDLE, { headers: adminHeaders });
  check('a session is created on first chat and the guess lands', () => {
    assert.strictEqual(sess.status, 200);
    assert.strictEqual(sess.body.ok, true);
    assert.strictEqual(sess.body.guesses.length, 1);
    assert.strictEqual(sess.body.guesses[0].symbols, '🟥🟩🟦🟨');
    assert.strictEqual(sess.body.streamerHandle, HANDLE);
  });

  // This is the whole point of private sessions.
  const pub = await api('/api/state');
  check('the PUBLIC board is untouched by streamer chat', () => {
    assert.strictEqual(pub.body.guesses.length, publicBefore,
      'streamer chat leaked into the public game');
  });

  emitChat(chatMessage('🟪🟪🟪🟪', OTHER));
  await wait(400);
  const other = await api('/api/session/state/' + OTHER, { headers: adminHeaders });
  const first = await api('/api/session/state/' + HANDLE, { headers: adminHeaders });
  check('two streamers get independent boards', () => {
    assert.strictEqual(other.body.guesses.length, 1);
    assert.strictEqual(first.body.guesses.length, 1);
    assert.notStrictEqual(other.body.guesses[0].symbols, first.body.guesses[0].symbols);
  });

  emitChat(chatMessage('🟥🟥🟥🟥', 'ghoststreamer'));
  await wait(400);
  const ghost = await api('/api/session/state/ghoststreamer', { headers: adminHeaders });
  check('an unwhitelisted handle cannot create a session via chat', () => {
    assert.strictEqual(ghost.body.ok, false, 'a ghost session was created');
  });

  console.log('\nwinning a session round');

  const secret = (await api('/api/session/state/' + HANDLE, { headers: adminHeaders })).body.code;
  wins.length = 0;
  emitChat(chatMessage(mm.formatCode(secret), HANDLE, {
    userId: 'session-winner', displayName: 'Session Winner', badges: ['fan-club'],
  }));
  await wait(600);

  check('the round ends and records the winner', () => {
    assert.strictEqual(wins.length, 1, 'expected exactly one game-win emit');
    assert.strictEqual(wins[0].winner.displayName, 'Session Winner');
    assert.strictEqual(wins[0].winner.isFanClub, true);
  });

  check('game-win is STAMPED with streamerHandle (scopes the Win Card)', () => {
    // Without this the win would land on the global overlay and the wrong
    // streamer's tally.
    assert.strictEqual(wins[0].streamerHandle, HANDLE);
    assert.strictEqual(wins[0].game, 'colour500');
    assert.strictEqual(wins[0].gameName, 'Color 500');
    assert.ok(wins[0].jackpot > 0, 'session win paid no jackpot');
  });

  console.log('\nadmin lifecycle');

  const redirect = await api('/api/session/redirect', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      handle: HANDLE, targetUrl: 'https://word5000.com/' + HANDLE,
      targetGameName: 'Word5000', targetGameId: 'word500',
    }),
  });
  check('redirect is accepted with the admin key', () => {
    assert.strictEqual(redirect.body.ok, true);
  });

  const noKey = await api('/api/session/end', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: HANDLE }),
  });
  check('session admin refuses a request with no key', () => {
    assert.strictEqual(noKey.status, 403);
  });

  // A viewer arriving after the switch should be redirected, not handed a board.
  const late = ioClient(`http://localhost:${GAME_PORT}`, { auth: { session: HANDLE } });
  const lateEvent = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ type: 'timeout' }), 3000);
    late.on('session-redirect', (d) => { clearTimeout(t); resolve({ type: 'redirect', d }); });
    late.on('game-state', (d) => { clearTimeout(t); resolve({ type: 'state', d }); });
  });
  check('a late viewer gets the redirect, not a stale board', () => {
    assert.strictEqual(lateEvent.type, 'redirect');
    assert.strictEqual(lateEvent.d.targetGameName, 'Word5000');
  });
  late.close();

  await api('/api/session/clear-redirect', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ handle: HANDLE }),
  });
  const cleared = ioClient(`http://localhost:${GAME_PORT}`, { auth: { session: HANDLE } });
  const clearedEvent = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ type: 'timeout' }), 3000);
    cleared.on('session-redirect', () => { clearTimeout(t); resolve({ type: 'redirect' }); });
    cleared.on('game-state', (d) => { clearTimeout(t); resolve({ type: 'state', d }); });
  });
  check('clearing the redirect restores normal session joins', () => {
    assert.strictEqual(clearedEvent.type, 'state');
    assert.strictEqual(clearedEvent.d.isSession, true);
  });
  cleared.close();

  const ended = await api('/api/session/end', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ handle: HANDLE }),
  });
  check('a session can be ended', () => {
    assert.strictEqual(ended.body.ok, true);
    assert.strictEqual(ended.body.ended, true);
  });

  const gone = await api('/api/session/state/' + HANDLE, { headers: adminHeaders });
  check('the ended session is gone', () => {
    assert.strictEqual(gone.body.ok, false);
  });

  console.log('\npublic game still works alongside sessions');
  const pubState = await api('/api/state');
  check('public board is alive and still hides its code', () => {
    assert.strictEqual(pubState.status, 200);
    assert.strictEqual(pubState.body.code, null);
    assert.ok(Array.isArray(pubState.body.palette));
  });
}

function cleanup() {
  try { if (child) child.kill(); } catch (_) {}
  try { if (relayIo) relayIo.close(); } catch (_) {}
  try { if (relay) relay.close(); } catch (_) {}
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (_) {}
}

main()
  .then(() => {
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    cleanup();
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nsession test crashed:', err);
    cleanup();
    process.exit(1);
  });
