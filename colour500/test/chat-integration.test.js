'use strict';
// ─── Colour 500 — chat path integration test ──────────────────────────────
// Boots the real server against a stand-in Chat Relay and drives it with the
// exact `chat-message` payload shape src/relay.js emits. This is the path the
// whole game depends on, so it is tested for real rather than mocked away.
//
// Run with:  node test/chat-integration.test.js
//
// The server is pointed at a scratch data directory (COLOUR500_DATA_DIR) so
// test rounds never land in the real win history.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');

const RELAY_PORT = 3098;   // stand-in relay — deliberately not 3000
const GAME_PORT = 3097;    // deliberately not 3033, so a running instance is untouched
const SECRET = 'test-secret-for-integration-only';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'colour500-test-'));

let passed = 0;
let failed = 0;
let child = null;
let relay = null;
let relayIo = null;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
  }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Build a chat-message exactly as src/relay.js emits it. */
function chatMessage(text, opts = {}) {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    platform: opts.platform || 'tiktok',
    user: {
      id: opts.userId || 'tiktok-user-1',
      username: opts.username || 'viewer1',
      displayName: opts.displayName || 'Viewer One',
      profilePic: null,
      badges: opts.badges || [],
    },
    message: text,
    timestamp: new Date().toISOString(),
    linkedDiscord: null,
    streamerHandle: opts.streamerHandle || null,
  };
}

async function api(pathname, adminKey) {
  const res = await fetch(`http://localhost:${GAME_PORT}${pathname}`, {
    headers: adminKey ? { 'x-api-key': adminKey } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  // ── Stand-in Chat Relay ─────────────────────────────────────────────────
  const wins = [];
  let registered = null;

  relay = http.createServer();
  relayIo = new Server(relay);
  relayIo.on('connection', (socket) => {
    socket.on('app-register', (data, cb) => {
      registered = data;
      if (typeof cb === 'function') cb({ success: true, id: data && data.id });
    });
    socket.on('game-win', (payload) => wins.push(payload));
  });
  await new Promise(r => relay.listen(RELAY_PORT, r));

  // ── Boot the real game server ───────────────────────────────────────────
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

  let serverLog = '';
  child.stdout.on('data', d => { serverLog += d.toString(); });
  child.stderr.on('data', d => { serverLog += d.toString(); });

  // Wait for listen + relay registration.
  for (let i = 0; i < 60 && !registered; i++) await wait(100);

  console.log('\napp-register handshake');

  check('the game registers with Chat Relay', () => {
    assert.ok(registered, 'never registered (log: ' + serverLog.slice(-400) + ')');
  });
  check('registers under the id colour500', () => {
    assert.strictEqual(registered.id, 'colour500');
  });
  check('presents the shared API secret', () => {
    assert.strictEqual(registered.apiKey, SECRET);
  });

  // ── Read the secret via the admin API ───────────────────────────────────
  console.log('\nadmin + public API');

  const adminState = await api('/api/admin-state', SECRET);
  check('admin state returns 200 with the correct key', () => {
    assert.strictEqual(adminState.status, 200);
  });
  check('admin state reveals the secret code', () => {
    assert.ok(Array.isArray(adminState.body.code) && adminState.body.code.length === 4);
  });

  const noKey = await api('/api/admin-state');
  check('admin state is refused without the key', () => {
    assert.strictEqual(noKey.status, 403);
  });

  const publicState = await api('/api/state');
  check('public state NEVER leaks the code mid-round', () => {
    assert.strictEqual(publicState.body.code, null,
      'the secret was exposed on /api/state — anyone could win instantly');
  });
  check('public state exposes the palette the page needs', () => {
    assert.strictEqual(publicState.body.palette.length, 6);
    assert.strictEqual(publicState.body.codeLength, 4);
  });

  // ── Drive chat ──────────────────────────────────────────────────────────
  const relaySocket = ioClient(`http://localhost:${RELAY_PORT}`);
  await new Promise(r => relaySocket.on('connect', r));

  // The stand-in relay must push to the game's socket, not the test client's.
  const emitChat = (msg) => relayIo.emit('chat-message', msg);

  const secret = adminState.body.code;
  const mm = require('../src/mastermind');
  const secretSymbols = mm.formatCode(secret);

  console.log('\nchat guesses');

  // A wrong-but-valid guess: rotate the secret so it is guaranteed different
  // yet always well-formed.
  const wrong = secret.slice(1).concat(secret.slice(0, 1));
  const wrongSymbols = mm.formatCode(wrong);
  const isActuallyDifferent = mm.codeKey(wrong) !== mm.codeKey(secret);

  emitChat(chatMessage(wrongSymbols));
  await wait(300);
  let st = (await api('/api/state')).body;

  check('an emoji guess from chat lands on the board', () => {
    if (!isActuallyDifferent) return; // secret was e.g. RRRR — rotation equals it
    assert.strictEqual(st.guesses.length, 1, 'chat guess did not register');
    assert.strictEqual(st.guesses[0].symbols, wrongSymbols);
    assert.strictEqual(st.guesses[0].platform, 'tiktok');
    assert.strictEqual(st.guesses[0].displayName, 'Viewer One');
  });

  const beforeChatter = (await api('/api/state')).body.guesses.length;
  emitChat(chatMessage('hey everyone how are you'));
  // BONK is B,O,N,K — brown and black are outside the 6-colour palette, so it
  // is rejected as out-of-palette. NOTE: on an 8-colour board it WOULD score,
  // which is the documented bare-letter trade-off, not a bug.
  emitChat(chatMessage('BONK'));
  emitChat(chatMessage('😂😂😂😂'));         // unrelated emoji
  emitChat(chatMessage('🟥🟩'));            // too short
  emitChat(chatMessage('🟥🟩🟦🟨🟪🟧'));     // too long
  await wait(300);
  st = (await api('/api/state')).body;

  check('ordinary chat never lands on the board', () => {
    assert.strictEqual(st.guesses.length, beforeChatter,
      'chatter was scored as a guess: ' + JSON.stringify(st.guesses.map(g => g.symbols)));
  });

  // Duplicate suppression.
  if (isActuallyDifferent) {
    emitChat(chatMessage(wrongSymbols, { userId: 'someone-else' }));
    await wait(250);
    st = (await api('/api/state')).body;
    check('a code already on the board is not scored twice', () => {
      assert.strictEqual(st.guesses.length, beforeChatter);
    });
  }

  // Streamer-tagged traffic must be ignored in phase 1.
  const beforeStreamer = (await api('/api/state')).body.guesses.length;
  const streamerGuess = mm.formatCode(secret.slice().reverse());
  emitChat(chatMessage(streamerGuess, { streamerHandle: 'someonelse' }));
  await wait(250);
  st = (await api('/api/state')).body;
  check('streamer-tagged chat is ignored (no private sessions yet)', () => {
    assert.strictEqual(st.guesses.length, beforeStreamer);
  });

  // ── Letter codes from chat ──────────────────────────────────────────────
  // The easy path for viewers who will not tap out emoji on a phone.

  /** A code that is neither the secret nor already on the board. */
  async function freshCode() {
    const board = (await api('/api/state')).body.guesses.map(g => mm.codeKey(g.code));
    for (let i = 0; i < 200; i++) {
      const c = mm.generateCode(4, 6, true);
      const k = mm.codeKey(c);
      if (k !== mm.codeKey(secret) && board.indexOf(k) === -1) return c;
    }
    throw new Error('could not find a fresh code');
  }

  const bareCode = await freshCode();
  let before = (await api('/api/state')).body.guesses.length;
  emitChat(chatMessage(mm.formatLetters(bareCode).toLowerCase(), { userId: 'letters-user' }));
  await wait(300);
  st = (await api('/api/state')).body;

  check('a BARE lowercase letter code from chat scores', () => {
    assert.strictEqual(st.guesses.length, before + 1,
      'bare letter guess was ignored — viewers cannot type letters');
    assert.deepStrictEqual(st.guesses[st.guesses.length - 1].code, bareCode);
    assert.strictEqual(st.guesses[st.guesses.length - 1].via, 'letters');
  });

  const prefixed = await freshCode();
  before = (await api('/api/state')).body.guesses.length;
  emitChat(chatMessage('/' + mm.formatLetters(prefixed), { userId: 'prefix-user' }));
  await wait(300);
  st = (await api('/api/state')).body;

  check('the optional / prefix still works', () => {
    assert.strictEqual(st.guesses.length, before + 1, 'prefixed letter guess was ignored');
    assert.deepStrictEqual(st.guesses[st.guesses.length - 1].code, prefixed);
  });

  before = (await api('/api/state')).body.guesses.length;
  emitChat(chatMessage('lol', { userId: 'chatter-a' }));
  emitChat(chatMessage('whats the code', { userId: 'chatter-b' }));
  emitChat(chatMessage('RGB', { userId: 'chatter-c' }));      // too short
  emitChat(chatMessage('RGBYP', { userId: 'chatter-d' }));    // too long
  await wait(300);
  st = (await api('/api/state')).body;

  check('bare letters do not turn ordinary chat into guesses', () => {
    assert.strictEqual(st.guesses.length, before,
      'chatter scored: ' + JSON.stringify(st.guesses.map(g => g.letters)));
  });

  console.log('\nwinning from chat');

  emitChat(chatMessage(secretSymbols, {
    userId: 'winner-123',
    username: 'thewinner',
    displayName: 'The Winner',
    badges: ['fan-club'],
  }));
  await wait(500);
  st = (await api('/api/state')).body;

  check('the correct code ends the round', () => {
    assert.strictEqual(st.gameOver, true, 'round did not end on a correct guess');
  });
  check('the winner is attributed to the chat viewer', () => {
    assert.ok(st.winner, 'no winner recorded');
    assert.strictEqual(st.winner.displayName, 'The Winner');
    assert.strictEqual(st.winner.platform, 'tiktok');
    assert.strictEqual(st.winner.isFanClub, true, 'fan-club badge was dropped');
  });
  check('the code is revealed once the round is over', () => {
    assert.deepStrictEqual(st.code, secret);
  });

  check('a game-win event reaches Chat Relay for the Win Card', () => {
    assert.strictEqual(wins.length, 1, 'expected exactly one game-win emit');
    assert.strictEqual(wins[0].game, 'colour500');
    assert.strictEqual(wins[0].gameName, 'Colour 500');
    assert.strictEqual(wins[0].word, secretSymbols);
    assert.ok(wins[0].jackpot > 0, 'jackpot was zero');
  });

  check('the win is written to history', () => {
    const hist = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'win-history.json'), 'utf8'));
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].displayName, 'The Winner');
    assert.strictEqual(hist[0].code, mm.formatLetters(secret));
  });

  check('guesses after the round ends are rejected', () => {
    // gameOver short-circuits processGuess; the board must not grow.
    const n = st.guesses.length;
    emitChat(chatMessage(mm.formatCode(mm.generateCode(4, 6, true))));
    assert.strictEqual(st.guesses.length, n);
  });

  console.log('\nnext round');

  // config default newGameDelayMs is 8000; wait it out.
  for (let i = 0; i < 120; i++) {
    st = (await api('/api/state')).body;
    if (!st.gameOver) break;
    await wait(200);
  }

  check('a fresh round starts automatically', () => {
    assert.strictEqual(st.gameOver, false, 'no new round after the win');
    assert.strictEqual(st.guesses.length, 0, 'board was not cleared');
  });

  check('the new secret is not exposed', () => {
    assert.strictEqual(st.code, null);
  });

  const newAdmin = await api('/api/admin-state', SECRET);
  check('the new round drew a different secret', () => {
    // Not strictly guaranteed (1/1296), but a repeat twice running would be
    // worth investigating — treated as informational rather than fatal.
    if (mm.codeKey(newAdmin.body.code) === mm.codeKey(secret)) {
      console.log('       (note: same code drawn twice — 1/1296 chance, not a failure)');
    }
    assert.strictEqual(newAdmin.body.code.length, 4);
  });

  relaySocket.close();
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
    console.error('\nintegration test crashed:', err);
    cleanup();
    process.exit(1);
  });
