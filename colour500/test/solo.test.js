'use strict';
// ─── Color 500 — solo engine tests ────────────────────────────────────────
// Run with:  node test/solo.test.js
//
// Two properties matter most and are covered hard here:
//   1. the daily code is IDENTICAL for everyone on a given date, and stable
//      across restarts — it is derived, never stored
//   2. publicState NEVER leaks the code mid-round, because solving the daily
//      pays real coins

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'colour500-solo-'));
process.env.COLOUR500_DATA_DIR = SCRATCH;

const solo = require('../src/solo');
const mm = require('../src/mastermind');

solo.init(SCRATCH);

let passed = 0;
let failed = 0;

function test(name, fn) {
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

const TODAY = '2026-07-25';
let tokenSeq = 0;
function freshToken() { return 'st_testtoken' + (tokenSeq++) + 'abc'; }

console.log('\ndaily code determinism');

test('the same date always yields the same code', () => {
  const a = solo.dailyCode(TODAY);
  const b = solo.dailyCode(TODAY);
  assert.deepStrictEqual(a, b);
  // ...and again after a notional restart — it is derived, not stored.
  delete require.cache[require.resolve('../src/mastermind')];
  assert.deepStrictEqual(solo.dailyCode(TODAY), a);
});

test('different dates yield different codes (sampled over a year)', () => {
  const seen = new Map();
  let collisions = 0;
  for (let d = 1; d <= 365; d++) {
    const date = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
    const key = solo.dailyCode(date).join(',');
    if (seen.has(key)) collisions++;
    seen.set(key, date);
  }
  // 365 draws from 1296 possible codes — the birthday paradox makes some
  // repeats certain. Assert only that it is not degenerate.
  assert.ok(seen.size > 250, 'only ' + seen.size + ' distinct codes in a year');
});

test('daily codes respect the solo board bounds', () => {
  for (let d = 1; d <= 60; d++) {
    const date = '2026-03-' + String(d % 28 + 1).padStart(2, '0');
    const code = solo.dailyCode(date);
    assert.strictEqual(code.length, solo.SOLO_CODE_LENGTH);
    code.forEach(c => assert.ok(c >= 0 && c < solo.SOLO_PALETTE_SIZE, 'colour out of range'));
  }
});

test('every player gets the same daily on the same date', () => {
  const a = solo.getGame(freshToken(), 'daily', TODAY);
  const b = solo.getGame(freshToken(), 'daily', TODAY);
  assert.deepStrictEqual(a.code, b.code);
});

test('practice codes are independent per player', () => {
  // Not guaranteed different on any single draw, so sample.
  let differed = false;
  for (let i = 0; i < 40 && !differed; i++) {
    const a = solo.getGame(freshToken(), 'practice', TODAY);
    const b = solo.getGame(freshToken(), 'practice', TODAY);
    if (mm.codeKey(a.code) !== mm.codeKey(b.code)) differed = true;
  }
  assert.ok(differed, 'practice codes appear to be shared');
});

console.log('\nthe code stays secret');

test('publicState hides the code while the round is live', () => {
  const g = solo.getGame(freshToken(), 'daily', TODAY);
  const s = solo.publicState(g);
  assert.strictEqual(s.code, null, 'the secret leaked mid-round — daily pays coins!');
  assert.ok(Array.isArray(s.palette) && s.palette.length === solo.SOLO_PALETTE_SIZE);
});

test('publicState reveals the code once the round is over', () => {
  const token = freshToken();
  const g = solo.getGame(token, 'daily', TODAY);
  solo.submitGuess(g, mm.formatCode(g.code));   // instant win
  assert.deepStrictEqual(solo.publicState(g).code, g.code);
});

console.log('\nplaying');

test('a correct guess wins and ends the round', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  const r = solo.submitGuess(g, mm.formatCode(g.code));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.justWon, true);
  assert.strictEqual(g.won, true);
  assert.strictEqual(g.gameOver, true);
  assert.strictEqual(r.row.exact, solo.SOLO_CODE_LENGTH);
});

test('a wrong guess is scored and the round continues', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  // Rotate the secret so the guess is well-formed but (usually) wrong.
  const wrong = g.code.slice(1).concat(g.code.slice(0, 1));
  const r = solo.submitGuess(g, mm.formatCode(wrong));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(typeof r.row.exact, 'number');
  assert.strictEqual(r.row.exact + r.row.misplaced + r.row.absent, solo.SOLO_CODE_LENGTH);
});

test('the same code cannot be submitted twice', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  const wrong = g.code.slice(1).concat(g.code.slice(0, 1));
  if (mm.codeKey(wrong) === mm.codeKey(g.code)) return; // degenerate secret
  assert.strictEqual(solo.submitGuess(g, mm.formatCode(wrong)).ok, true);
  const again = solo.submitGuess(g, mm.formatCode(wrong));
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'duplicate');
  assert.strictEqual(g.guesses.length, 1, 'a duplicate consumed a guess');
});

test('a malformed guess is rejected and costs nothing', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  const before = g.guesses.length;
  assert.strictEqual(solo.submitGuess(g, 'hello').ok, false);
  assert.strictEqual(solo.submitGuess(g, '🟥🟩').ok, false);
  assert.strictEqual(solo.submitGuess(g, '').ok, false);
  assert.strictEqual(g.guesses.length, before);
});

test('running out of guesses ends the round as a loss', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  // Feed distinct wrong codes until the limit trips.
  let used = 0;
  for (let a = 0; a < 6 && !g.gameOver; a++) {
    for (let b = 0; b < 6 && !g.gameOver; b++) {
      const candidate = [a, b, a, b];
      if (mm.codeKey(candidate) === mm.codeKey(g.code)) continue;
      const r = solo.submitGuess(g, mm.formatCode(candidate));
      if (r.ok) used++;
    }
  }
  assert.strictEqual(g.gameOver, true, 'round never ended');
  assert.strictEqual(g.won, false, 'lost round marked as a win');
  assert.strictEqual(used, solo.MAX_GUESSES, 'expected exactly ' + solo.MAX_GUESSES + ' guesses');
  assert.strictEqual(solo.publicState(g).guessesLeft, 0);
});

test('no guesses are accepted after the round ends', () => {
  const g = solo.getGame(freshToken(), 'practice', TODAY);
  solo.submitGuess(g, mm.formatCode(g.code));  // win
  const after = solo.submitGuess(g, mm.formatCode([0, 0, 0, 0]));
  assert.strictEqual(after.ok, false);
  assert.strictEqual(after.reason, 'round-over');
});

console.log('\nsessions');

test('the daily is NOT resettable, practice is', () => {
  const token = freshToken();
  const daily = solo.getGame(token, 'daily', TODAY);
  solo.submitGuess(daily, mm.formatCode(daily.code));
  // Asking again returns the SAME finished daily — no re-roll.
  const again = solo.getGame(token, 'daily', TODAY);
  assert.strictEqual(again.gameOver, true);
  assert.deepStrictEqual(again.code, daily.code);

  const p1 = solo.getGame(token, 'practice', TODAY);
  solo.submitGuess(p1, mm.formatCode(p1.code));
  const p2 = solo.newPractice(token, TODAY);
  assert.strictEqual(p2.gameOver, false, 'practice did not reset');
});

test('a new day replaces yesterday\'s daily', () => {
  const token = freshToken();
  const d1 = solo.getGame(token, 'daily', '2026-07-25');
  const d2 = solo.getGame(token, 'daily', '2026-07-26');
  assert.strictEqual(d2.date, '2026-07-26');
  assert.strictEqual(d2.gameOver, false);
  assert.deepStrictEqual(d2.code, solo.dailyCode('2026-07-26'));
  assert.notStrictEqual(d1.date, d2.date);
});

test('progress on one token is invisible to another', () => {
  const a = freshToken(), b = freshToken();
  const ga = solo.getGame(a, 'daily', TODAY);
  solo.submitGuess(ga, mm.formatCode([0, 1, 2, 3]));
  const gb = solo.getGame(b, 'daily', TODAY);
  assert.strictEqual(gb.guesses.length, 0);
});

console.log('\ntoken validation');

test('well-formed tokens are accepted', () => {
  assert.strictEqual(solo.isValidToken('st_abcdefghij'), true);
  assert.strictEqual(solo.isValidToken('A-b_9'.repeat(3)), true);
});

test('junk tokens are rejected', () => {
  [null, undefined, '', 'short', 'has spaces here', '../../etc/passwd',
   '__proto__', 'x'.repeat(200), 123].forEach(t => {
    assert.strictEqual(solo.isValidToken(t), false, 'accepted: ' + String(t));
  });
});

try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (_) {}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
