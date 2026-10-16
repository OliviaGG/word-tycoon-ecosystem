'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function section(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Production section exists: ' + start);
  return text.slice(a, b);
}

function manager() {
  const scope = { module: { exports: {} }, process: { env: {} }, __dirname: path.join(root, 'src'),
    console: { log() {}, warn() {}, error() {} }, setTimeout: () => 1, clearTimeout() {},
    setInterval: () => ({ unref() {} }),
    require(name) {
      if (name === 'fs') return { existsSync: () => false };
      if (name === '../lib/hint-journal') return { writeAtomic() {} };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/session-manager.js'), 'utf8'), scope);
  return scope.module.exports;
}

test('private rounds notify their room once after installation, including concurrent builds and rotation', async () => {
  const sessions = manager(), events = [];
  const scope = { _sessionRoom: h => 'session:' + h,
    io: { to: room => ({ emit: (event, data) => events.push({ room, event, data }) }) },
    broadcastSessionState(round) {
      assert.equal(sessions.getSession(round.sessionHandle), round);
      events.push({ room: 'session:' + round.sessionHandle, event: 'wikisearchle-state' });
      events.push({ room: 'session:' + round.sessionHandle, event: 'wikiword-state' });
    },
  };
  vm.runInNewContext(section(source, 'function broadcastSessionRoundStart(', 'function broadcastSessionState('), scope);
  let release, builds = 0;
  const first = { targetWord: 'Secret Article', articleTitle: 'Secret Article', startTime: 'first' };
  const builder = () => { builds++; return new Promise(resolve => { release = resolve; }); };
  const a = sessions.getOrBuildSession('Streamer', builder, scope.broadcastSessionRoundStart);
  const b = sessions.getOrBuildSession('streamer', builder, scope.broadcastSessionRoundStart);
  release(first);
  assert.equal(await a, first); assert.equal(await b, first); assert.equal(builds, 1);
  assert.deepEqual(events.map(e => e.event), ['wikisearchle-round-start', 'wikisearchle-state', 'wikiword-state']);
  assert.ok(events.every(e => e.room === 'session:streamer'));
  assert.equal(events[0].data.startTime, 'first');
  assert.equal(events[0].data.targetWord, '(active)'); assert.equal(events[0].data.articleTitle, null);
  assert.ok(!JSON.stringify(events[0]).includes('Secret'));
  await sessions.getOrBuildSession('streamer', builder, scope.broadcastSessionRoundStart);
  assert.equal(events.length, 3); // Connecting to the current round must not reset other viewers.
  first.won = true;
  const next = { startTime: 'next' };
  await sessions.getOrBuildSession('streamer', async () => next, scope.broadcastSessionRoundStart);
  assert.equal(events[3].event, 'wikisearchle-round-start'); assert.equal(events[3].data.startTime, 'next');
  assert.equal(sessions.getSession('streamer'), next);
  assert.equal(await sessions.getOrBuildSession('failed', async () => null, scope.broadcastSessionRoundStart), null);
  assert.equal(events.length, 6);
});

function overlay(file = 'overlay-unified.html') {
  const html = fs.readFileSync(path.join(root, file === 'vite' ? 'client/src/online/game.js' : 'public/' + file), 'utf8');
  const handlers = new Map(), timers = new Map(), paints = [];
  let now = 0, timerId = 0;
  const element = () => ({ classList: { add() {}, remove() {} }, style: {}, offsetWidth: 1 });
  const panels = new Map();
  const scope = {
    window: { WikiMotion: { article() {}, reveal() {}, revealWords() {} } }, socket: { on: (event, cb) => handlers.set(event, cb) },
    document: { querySelector: sel => { if (!panels.has(sel)) panels.set(sel, element()); return panels.get(sel); }, querySelectorAll: () => [] },
    Date: class extends Date { static now() { return now; } },
    setTimeout(cb, delay = 0) { const id = ++timerId; timers.set(id, { cb, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    _guessCards: { reset() {}, queue() {} }, _xpAwardByNorm: new Map(), _xpPaidNorms: new Set(),
    renderArticle: s => paints.push(s), renderCards() {}, renderScoreboard() {}, renderAnnounce() {},
    setActive() {}, setIdle() {}, setGuessCount() {}, showRoundEnd() {}, pushChip() {},
    scoreboardEl: element(), titleBlock: element(), ticker: { innerHTML: 'old ticker' },
    totalRankedWordsCache: 0, localGuessCount: 0,
    startOnlineLoading() {}, finishOnlineLoading() {},
    articleReceived: false, articleReady: false, roundStateReady: false, roundActive: false,
  };
  const context = vm.createContext(scope);
  vm.runInContext(section(html, '  const FRESH_REVEAL_MS', '  // ── Article') +
    section(html, ['index.html', 'vite'].includes(file) ? '  // ── Socket events' : '  const roundTransition =', '  // Prime from REST'), context);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].cb();
    }
    now = end;
  }
  return { scope, paints, advance, emit: (event, s) => handlers.get(event)(s),
    read: expression => vm.runInContext(expression, context) };
}

function article(startedAt, won = false) {
  return { startedAt, won, titleTokens: [{ type: 'word', text: won ? 'Old target' : null }],
    paragraphs: [[{ type: 'word', text: won ? 'Old article' : null, revealed: won }]] };
}
const snapshot = startTime => ({ startTime, targetWord: '(active)', topGuesses: [], scoreboard: [] });

test('unified overlay clears the previous article even without seeing its win animation', () => {
  const ui = overlay(); ui.emit('wikisearchle-state', snapshot('old'));
  ui.emit('wikiword-state', article('old', true));
  ui.emit('wikiword-reveal', { words: ['old'] });
  ui.emit('wikisearchle-round-start', { startTime: 'next' });
  assert.equal(ui.paints.at(-1), null); assert.equal(ui.read('prevArticleState'), null);
  assert.equal(ui.read('freshReveals.size'), 0); assert.equal(ui.read('pendingHideSentences.size'), 0);
  assert.equal(ui.scope.ticker.innerHTML, '');
  const next = article('next'); ui.emit('wikisearchle-state', snapshot('next')); ui.emit('wikiword-state', next);
  ui.advance(6000); assert.equal(ui.paints.at(-1), next);
});

test('unified overlay replaces held title and article after slide-out and clears reveal timers', () => {
  const ui = overlay(); ui.emit('wikisearchle-state', snapshot('old')); ui.emit('wikiword-state', article('old'));
  const old = article('old', true); ui.emit('wikiword-round-end', old); ui.advance(50);
  ui.emit('wikiword-reveal', { words: ['old'] });
  ui.emit('wikisearchle-round-start', { startTime: 'next' });
  const next = article('next'); ui.emit('wikisearchle-state', snapshot('next')); ui.emit('wikiword-state', next);
  assert.equal(ui.paints.at(-1), old); // Old content exits before the new content enters.
  ui.advance(2401); assert.equal(ui.paints.at(-1), next);
  assert.equal(ui.read('prevArticleState'), next); assert.equal(ui.read('freshReveals.size'), 0);
  ui.advance(6000); assert.ok(!ui.paints.slice(ui.paints.indexOf(next)).includes(old));
});

test('unified overlay recovers a missed round-start from a changed state snapshot', () => {
  const ui = overlay(); ui.emit('wikisearchle-state', snapshot('old')); ui.emit('wikiword-state', article('old'));
  ui.emit('wikiword-round-end', article('old', true)); ui.advance(50);
  const next = article('next'); ui.emit('wikisearchle-state', snapshot('next')); ui.emit('wikiword-state', next);
  ui.advance(5000); assert.equal(ui.paints.at(-1), next);
  assert.equal(ui.read('roundTransition.isInTransition()'), false);
});

test('main page round-start clears cached title/article before the new article arrives', () => {
  const ui = overlay('index.html'); ui.emit('wikiword-state', article('old', true));
  ui.emit('wikiword-reveal', { words: ['old'] }); ui.emit('wikisearchle-round-start', { startTime: 'next' });
  assert.equal(ui.paints.at(-1), null); assert.equal(ui.read('prevArticleState'), null);
  assert.equal(ui.read('freshReveals.size'), 0); assert.equal(ui.read('expiryTimer'), null);
  ui.advance(6000); assert.equal(ui.paints.at(-1), null);
});

test('Vite multiplayer clears the old article and title before accepting the next snapshot', () => {
  const ui = overlay('vite'); ui.emit('wikiword-state', article('old', true));
  ui.emit('wikiword-reveal', { words: ['old'] }); ui.emit('wikisearchle-round-start', { startTime: 'next' });
  assert.equal(ui.paints.at(-1), null); assert.equal(ui.read('prevArticleState'), null);
  assert.equal(ui.read('freshReveals.size'), 0); assert.equal(ui.read('expiryTimer'), null);
  const next = article('next'); ui.emit('wikiword-state', next); ui.advance(6000);
  assert.equal(ui.paints.at(-1), next);
});
