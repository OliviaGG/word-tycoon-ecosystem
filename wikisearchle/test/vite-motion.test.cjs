const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture() {
  const calls = [], events = {}, frames = new Map(), words = [], titles = [], cards = [];
  let frameId = 0;
  const reduced = { matches: false, addEventListener: (name, cb) => { events.reduced = cb; } };
  const body = { classList: { contains: () => false } };
  const document = { body, hidden: false,
    addEventListener: (name, cb) => { events[name] = cb; },
    querySelector: selector => words.find(el => selector.includes('"' + el.dataset.id + '"')),
    querySelectorAll: selector => selector.includes('#body') ? words : selector.includes('#titleText') ? titles : selector.includes('#cards') ? cards : [],
    documentElement: { classList: { contains: () => false } },
  };
  const window = { addEventListener: (name, cb) => { events[name] = cb; } };
  const scope = { document, window, location: { search: '' }, URLSearchParams, CSS: { escape: String }, innerWidth: 600, innerHeight: 900,
    matchMedia: () => reduced, AbortController,
    MutationObserver: class { constructor(cb) { events.loading = cb; } observe() {} disconnect() {} },
    requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
  };
  const code = fs.readFileSync(path.join(__dirname, '../client/src/shared/motion.js'), 'utf8')
    .replace(/if \(import\.meta\.hot\).*\n?/, '');
  vm.runInNewContext(code, scope);
  function element(id, norm, text = '') {
    const el = { isConnected: true, offsetHeight: 40, top: 100, dataset: { id, norm }, textContent: text,
      closest: () => null, getBoundingClientRect: () => ({ width: 120, height: 40, top: el.top, bottom: el.top + 40, left: 0, right: 120 }),
      animate(keyframes, options) { const a = { target: el, keyframes, options, cancelled: false, finished: new Promise(() => {}), cancel() { this.cancelled = true; } }; calls.push(a); return a; },
    };
    return el;
  }
  return { motion: window.WikiMotion, calls, words, titles, cards, element, reduced, document, scope, events,
    flush() { while (frames.size) { const [id, cb] = frames.entries().next().value; frames.delete(id); cb(); } } };
}
test('restored article reveals stay still; live new reveals animate once', () => {
  const f = fixture(); f.words.push(f.element('saved', 'sky')); f.motion.article(); f.flush();
  f.motion.reveal(['saved']); assert.equal(f.calls.length, 0);
  f.words.push(f.element('new', 'moon')); f.motion.reveal(['new', 'new']);
  assert.equal(f.calls.length, 1); f.motion.reveal(['new']); assert.equal(f.calls.length, 1);
});
test('multiplayer repeated socket reveals and title renders do not replay', () => {
  const f = fixture(); f.motion.article(); f.flush();
  f.words.push(f.element('one', 'moon'), f.element('two', 'moon'));
  f.motion.revealWords(['moon']); assert.equal(f.calls.length, 2);
  f.motion.revealWords(['moon']); assert.equal(f.calls.length, 2);
  f.titles.push(f.element('title', '', 'Solar')); f.motion.reveal([], { title: true });
  assert.equal(f.calls.length, 3); f.motion.reveal([], { title: true }); assert.equal(f.calls.length, 3);
});
test('reduced motion suppresses animation and immediately cancels running effects', () => {
  const f = fixture(); f.words.push(f.element('one', 'moon')); f.motion.reveal(['one']);
  f.reduced.matches = true; f.events.reduced(); assert.ok(f.calls.every(a => a.cancelled));
  f.words.push(f.element('two', 'sky')); f.motion.reveal(['two']); f.motion.article(); f.flush();
  assert.equal(f.calls.length, 1);
});
test('hidden pages and pagehide cancel animation; OBS never creates effects', () => {
  const f = fixture(); f.words.push(f.element('one', 'moon')); f.motion.reveal(['one']);
  f.document.hidden = true; f.events.visibilitychange(); assert.equal(f.calls[0].cancelled, true);
  f.document.hidden = false; f.events.pagehide(); f.words.push(f.element('two', 'sun')); f.motion.reveal(['two']);
  assert.equal(f.calls.length, 1); f.events.pageshow(); f.scope.location.search = '?obs=1'; f.motion.reveal(['two']);
  assert.equal(f.calls.length, 1);
});
test('live rank reordering animates a retained row, while snapshots remain still', () => {
  const f = fixture(), card = f.element('card'); f.cards.push(card);
  f.motion.rankUpdate(() => { card.top = 200; }); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].keyframes[0].transform, 'translateY(-100px)');
  f.motion.rankUpdate(() => { card.top = 300; }, true); assert.equal(f.calls.length, 1);
});
test('large reveal bursts are bounded and offscreen tokens stay still', () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.words.push(f.element(String(i), 'word' + i));
  f.motion.reveal(f.words.map(el => el.dataset.id)); assert.equal(f.calls.length, 24);
  const offscreen = f.element('offscreen', 'hidden'); offscreen.top = 1000; f.words.push(offscreen);
  f.motion.reveal(['offscreen']); assert.equal(f.calls.length, 24);
});
