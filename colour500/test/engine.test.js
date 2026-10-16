'use strict';
// ─── Colour 500 engine tests ──────────────────────────────────────────────
// Plain Node, no test framework (matches the rest of the ecosystem — no new
// dependencies). Run with:  node test/engine.test.js
//
// The scoring cases below are the ones that actually break Mastermind
// implementations: duplicate colours in the guess, in the secret, or both.

const assert = require('assert');
const mm = require('../src/mastermind');

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

// Palette index shorthand for readability in the cases below.
const R = 0, G = 1, B = 2, Y = 3, P = 4, O = 5, N = 6, K = 7;

console.log('\nscoreGuess — no duplicates');

test('all four exact', () => {
  assert.deepStrictEqual(mm.scoreGuess([R, G, B, Y], [R, G, B, Y]), { exact: 4, misplaced: 0 });
});

test('complete miss scores nothing', () => {
  assert.deepStrictEqual(mm.scoreGuess([R, R, R, R], [G, G, G, G]), { exact: 0, misplaced: 0 });
});

test('full reversal is all misplaced', () => {
  assert.deepStrictEqual(mm.scoreGuess([Y, B, G, R], [R, G, B, Y]), { exact: 0, misplaced: 4 });
});

test('the worked example from the design', () => {
  // secret 🟩🟥🟦🟨 / guess 🟥🟩🟦🟪 -> 1 exact (blue), 2 misplaced (red, green)
  assert.deepStrictEqual(mm.scoreGuess([R, G, B, P], [G, R, B, Y]), { exact: 1, misplaced: 2 });
});

console.log('\nscoreGuess — duplicates (the cases that break naive code)');

test('four of one colour against a secret holding exactly one', () => {
  // The classic bug: must be 1 exact + 0 misplaced, NOT 1 exact + 3 misplaced.
  assert.deepStrictEqual(mm.scoreGuess([R, R, R, R], [R, G, B, Y]), { exact: 1, misplaced: 0 });
});

test('duplicate in guess, single in secret, none aligned', () => {
  // Only one red exists to be found, so only one peg may be awarded.
  assert.deepStrictEqual(mm.scoreGuess([R, R, G, G], [B, Y, R, B]), { exact: 0, misplaced: 1 });
});

test('duplicate in secret, single in guess', () => {
  assert.deepStrictEqual(mm.scoreGuess([R, G, B, Y], [R, R, R, R]), { exact: 1, misplaced: 0 });
});

test('duplicates on both sides, partially aligned', () => {
  // guess RRGG vs secret RGRG: slot0 (red) and slot3 (green) match exactly.
  // Leftover guess R,G vs leftover secret G,R -> one of each -> 2 misplaced.
  assert.deepStrictEqual(mm.scoreGuess([R, R, G, G], [R, G, R, G]), { exact: 2, misplaced: 2 });
});

test('triple in guess against double in secret', () => {
  // guess RRRG vs secret RRBY: two exact reds, third red has nothing left.
  assert.deepStrictEqual(mm.scoreGuess([R, R, R, G], [R, R, B, Y]), { exact: 2, misplaced: 0 });
});

test('exact matches are never recounted as misplaced', () => {
  assert.deepStrictEqual(mm.scoreGuess([R, R, B, B], [R, B, R, B]), { exact: 2, misplaced: 2 });
});

console.log('\nscoreGuess — invariants over random play');

test('exact + misplaced never exceeds code length, over 20k random rounds', () => {
  for (let i = 0; i < 20000; i++) {
    const len = 3 + Math.floor(Math.random() * 4);   // 3..6
    const size = 4 + Math.floor(Math.random() * 5);  // 4..8
    const code = mm.generateCode(len, size, true);
    const guess = mm.generateCode(len, size, true);
    const { exact, misplaced } = mm.scoreGuess(guess, code);
    assert.ok(exact >= 0 && misplaced >= 0, 'negative peg count');
    assert.ok(exact + misplaced <= len,
      `pegs ${exact}+${misplaced} exceed length ${len} (code ${code} guess ${guess})`);
  }
});

test('a guess scored against itself is always all-exact', () => {
  for (let i = 0; i < 2000; i++) {
    const len = 3 + Math.floor(Math.random() * 4);
    const code = mm.generateCode(len, 8, true);
    assert.deepStrictEqual(mm.scoreGuess(code, code), { exact: len, misplaced: 0 });
  }
});

test('scoring is symmetric in total pegs', () => {
  // Mastermind's peg total is the multiset intersection size, so swapping the
  // guess and the secret must produce identical exact and misplaced counts.
  for (let i = 0; i < 5000; i++) {
    const len = 4;
    const a = mm.generateCode(len, 6, true);
    const b = mm.generateCode(len, 6, true);
    assert.deepStrictEqual(mm.scoreGuess(a, b), mm.scoreGuess(b, a));
  }
});

console.log('\ngenerateCode');

test('respects length and palette bounds', () => {
  for (let i = 0; i < 1000; i++) {
    const code = mm.generateCode(5, 6, true);
    assert.strictEqual(code.length, 5);
    for (const c of code) assert.ok(c >= 0 && c < 6, 'colour outside palette');
  }
});

test('clamps out-of-range configuration', () => {
  assert.strictEqual(mm.generateCode(99, 99, true).length, mm.MAX_CODE_LENGTH);
  const wide = mm.generateCode(4, 99, true);
  for (const c of wide) assert.ok(c < mm.MAX_PALETTE_SIZE);
  assert.strictEqual(mm.generateCode(1, 1, true).length, mm.MIN_CODE_LENGTH);
});

test('no-duplicates mode never repeats a colour', () => {
  for (let i = 0; i < 2000; i++) {
    const code = mm.generateCode(4, 6, false);
    assert.strictEqual(new Set(code).size, code.length, 'repeated colour: ' + code);
  }
});

test('duplicates mode does actually produce duplicates sometimes', () => {
  // Sanity guard against a generator that silently de-duplicates.
  let sawDuplicate = false;
  for (let i = 0; i < 500 && !sawDuplicate; i++) {
    const code = mm.generateCode(4, 4, true);
    if (new Set(code).size < code.length) sawDuplicate = true;
  }
  assert.ok(sawDuplicate, 'never generated a duplicate in 500 draws of 4 slots / 4 colours');
});

console.log('\nparseGuess — emoji');

const opts = { codeLength: 4, paletteSize: 6, requireLetterPrefix: true };

test('coloured squares, no spaces (the TikTok-safe form)', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥🟩🟦🟨', opts), { ok: true, code: [R, G, B, Y], via: 'emoji' });
});

test('coloured circles map to the same colours', () => {
  assert.deepStrictEqual(mm.parseGuess('🔴🟢🔵🟡', opts), { ok: true, code: [R, G, B, Y], via: 'emoji' });
});

test('squares and circles may be mixed', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥🟢🟦🟡', opts), { ok: true, code: [R, G, B, Y], via: 'emoji' });
});

test('coloured hearts guess the same colours', () => {
  assert.deepStrictEqual(mm.parseGuess('❤💚💙💛', opts), { ok: true, code: [R, G, B, Y], via: 'emoji' });
});

test('the red heart works WITH its variation selector (how phones send it)', () => {
  // ❤️ is U+2764 U+FE0F. The selector is stripped before lookup, so the table
  // holds the bare codepoint — this is the case that silently breaks if the
  // literal glyph is ever pasted into the palette table.
  assert.deepStrictEqual(mm.parseGuess('❤️\u{1F49A}\u{1F499}\u{1F49B}', opts).code, [R, G, B, Y]);
});

test('the card-suit heart ♥ is accepted as red', () => {
  assert.deepStrictEqual(mm.parseGuess('♥💚💙💛', opts).code, [R, G, B, Y]);
});

test('hearts, squares and circles can all be mixed in one guess', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥💚🔵💛', opts).code, [R, G, B, Y]);
});

test('brown and black hearts only work on the 8-colour palette', () => {
  const eight = { codeLength: 4, paletteSize: 8 };
  assert.deepStrictEqual(mm.parseGuess('🤎🖤💚💙', eight).code, [N, K, G, B]);
  assert.deepStrictEqual(mm.parseGuess('🤎🖤💚💙', opts), { ok: false, reason: 'out-of-palette' });
});

test('a pink/white heart is NOT a colour and rejects the guess', () => {
  // 🤍 white and 🩷 pink are not playable colours; treating them as "some
  // heart" would silently score a guess the viewer never made.
  assert.strictEqual(mm.parseGuess('🤍💚💙💛', opts).ok, false);
  assert.strictEqual(mm.parseGuess('🩷💚💙💛', opts).ok, false);
});

test('spaces between squares are ignored', () => {
  // Reaches the parser this way from the web page and Discord; on TikTok the
  // relay truncates it first, which is why the UI teaches the unspaced form.
  assert.deepStrictEqual(mm.parseGuess('🟥 🟩 🟦 🟨', opts), { ok: true, code: [R, G, B, Y], via: 'emoji' });
});

test('repeated colours are a legal guess', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥🟥🟥🟥', opts), { ok: true, code: [R, R, R, R], via: 'emoji' });
});

test('a variation selector after the glyph is tolerated', () => {
  assert.deepStrictEqual(mm.parseGuess('⬛️⬛️⬛️⬛️',
    { codeLength: 4, paletteSize: 8 }), { ok: true, code: [K, K, K, K], via: 'emoji' });
});

test('too few symbols is rejected, not padded', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥🟩🟦', opts), { ok: false, reason: 'wrong-length' });
});

test('too many symbols is rejected, not truncated', () => {
  assert.deepStrictEqual(mm.parseGuess('🟥🟩🟦🟨🟪', opts), { ok: false, reason: 'wrong-length' });
});

test('a colour outside the active palette is rejected', () => {
  // Brown is index 6 — not playable on a 6-colour palette.
  assert.deepStrictEqual(mm.parseGuess('🟫🟩🟦🟨', opts), { ok: false, reason: 'out-of-palette' });
});

test('emoji mixed with chatter is rejected rather than half-read', () => {
  assert.deepStrictEqual(mm.parseGuess('lol 🟥🟩🟦🟨 nice', opts), { ok: false, reason: 'mixed-content' });
});

test('ordinary chat with no colours is ignored', () => {
  assert.deepStrictEqual(mm.parseGuess('hello everyone', opts), { ok: false, reason: 'no-prefix' });
});

test('an unrelated emoji is not a guess', () => {
  assert.strictEqual(mm.parseGuess('😂😂😂😂', opts).ok, false);
});

test('empty and whitespace messages are ignored', () => {
  assert.deepStrictEqual(mm.parseGuess('', opts), { ok: false, reason: 'empty' });
  assert.deepStrictEqual(mm.parseGuess('   ', opts), { ok: false, reason: 'empty' });
  assert.deepStrictEqual(mm.parseGuess(null, opts), { ok: false, reason: 'empty' });
});

console.log('\nparseGuess — TikTok filter-dodging padding');

// Viewers pad repeated messages with punctuation and emoji to get past
// TikTok's spam/censorship filters. That padding must never cost them a guess.
// Letter guesses run WITHOUT a required prefix in production, so these use
// the live shape rather than the prefixed `opts` above.
const live = { codeLength: 4, paletteSize: 6, requireLetterPrefix: false };

test('trailing punctuation does not kill a letter guess', () => {
  // "bgro!" used to be rejected outright — a real reported symptom.
  assert.deepStrictEqual(mm.parseGuess('bgro!', live).code, [B, G, R, O]);
  assert.deepStrictEqual(mm.parseGuess('bgro!!!', live).code, [B, G, R, O]);
  assert.deepStrictEqual(mm.parseGuess('bgro?', live).code, [B, G, R, O]);
  assert.deepStrictEqual(mm.parseGuess('...bgro...', live).code, [B, G, R, O]);
});

test('arbitrary emoji BETWEEN colour symbols is ignored', () => {
  assert.deepStrictEqual(mm.parseGuess('🟦✨🟩✨🟥✨🟧', opts).code, [B, G, R, O]);
  assert.deepStrictEqual(mm.parseGuess('🟦🟩🟥🟧🎉', opts).code, [B, G, R, O]);
});

test('arbitrary emoji between LETTERS is ignored too', () => {
  assert.deepStrictEqual(mm.parseGuess('b✨g✨r✨o', live).code, [B, G, R, O]);
});

test('hearts tolerate padding as well', () => {
  assert.deepStrictEqual(mm.parseGuess('❤💚💙💛!!', opts).code, [R, G, B, Y]);
});

test('REAL chat is still rejected — padding tolerance must not open that door', () => {
  // The guard is now "any stray letter or digit means this is a sentence".
  const chat = [
    'lol 🟦🟩🟥🟧 nice',   // colours embedded in a sentence
    'hello everyone',
    'bgro is my guess',
    'wow!!',
    'b1g2r3o4',            // digits are word chars, not padding
    'omg bgro',
  ];
  for (const t of chat) {
    assert.strictEqual(mm.parseGuess(t, live).ok, false, t + ' was scored as a guess');
  }
});

console.log('\nparseGuess — spoken colour names');

// "green blue red orange" — only viable since Color 500 was exempted from the
// relay's batch-guess clamp, which used to truncate multi-word messages to
// their first word for non-Donors.
test('four colour names score', () => {
  assert.deepStrictEqual(mm.parseGuess('green blue red orange', live),
    { ok: true, code: [G, B, R, O], via: 'names' });
});

test('names are case-insensitive and tolerate punctuation', () => {
  assert.deepStrictEqual(mm.parseGuess('GREEN BLUE RED ORANGE', live).code, [G, B, R, O]);
  assert.deepStrictEqual(mm.parseGuess('Green, Blue, Red, Orange', live).code, [G, B, R, O]);
  assert.deepStrictEqual(mm.parseGuess('green-blue-red-orange', live).code, [G, B, R, O]);
  assert.deepStrictEqual(mm.parseGuess('green blue red orange!!', live).code, [G, B, R, O]);
});

test('repeated names are legal', () => {
  assert.deepStrictEqual(mm.parseGuess('red red red red', live).code, [R, R, R, R]);
});

test('violet is accepted as purple', () => {
  assert.deepStrictEqual(mm.parseGuess('green blue red violet', live).code, [G, B, R, P]);
});

test('names never need a prefix, even when letter codes do', () => {
  // Spelling colours out is unambiguous in a way a bare 4-letter code is not.
  const gated = { codeLength: 4, paletteSize: 6, requireLetterPrefix: true };
  assert.deepStrictEqual(mm.parseGuess('green blue red orange', gated).code, [G, B, R, O]);
  assert.deepStrictEqual(mm.parseGuess('bgro', gated), { ok: false, reason: 'no-prefix' });
});

test('a name outside the active palette is rejected', () => {
  assert.deepStrictEqual(mm.parseGuess('brown black green blue', live),
    { ok: false, reason: 'out-of-palette' });
});

test('names do NOT shadow the letter path', () => {
  // "gory" is not a colour name, so it must still parse letter-by-letter.
  assert.deepStrictEqual(mm.parseGuess('gory', live), { ok: true, code: [G, O, R, Y], via: 'letters' });
});

test('a sentence mentioning colours is still rejected', () => {
  // Every token must be a colour name — that is the whole guard.
  for (const t of ['the green one is nice', 'i like red and blue', 'red stuff',
                   'green', 'green blue', 'green blue red orange yellow']) {
    assert.strictEqual(mm.parseGuess(t, live).ok, false, t + ' was scored as a guess');
  }
});

console.log('\nparseGuess — letter codes');

test('prefixed letter code is accepted', () => {
  assert.deepStrictEqual(mm.parseGuess('/RGBY', opts), { ok: true, code: [R, G, B, Y], via: 'letters' });
});

test('all three prefixes work, case-insensitively', () => {
  for (const t of ['/rgby', '!rgby', '.RgBy']) {
    assert.deepStrictEqual(mm.parseGuess(t, opts).code, [R, G, B, Y], 'failed for ' + t);
  }
});

test('bare letter code is rejected while the prefix is required', () => {
  // This is what stops ordinary chat words scoring as guesses.
  assert.deepStrictEqual(mm.parseGuess('RGBY', opts), { ok: false, reason: 'no-prefix' });
});

test('chat words that happen to be valid colour codes are NOT scored', () => {
  // BONK, PONY and BOOK are all legal codes on an 8-colour palette.
  const eight = { codeLength: 4, paletteSize: 8, requireLetterPrefix: true };
  for (const word of ['BONK', 'PONY', 'BOOK', 'GORY']) {
    assert.deepStrictEqual(mm.parseGuess(word, eight), { ok: false, reason: 'no-prefix' },
      word + ' should not have been read as a guess');
  }
});

test('bare letter codes work once the prefix requirement is off', () => {
  const relaxed = { codeLength: 4, paletteSize: 6, requireLetterPrefix: false };
  assert.deepStrictEqual(mm.parseGuess('RGBY', relaxed), { ok: true, code: [R, G, B, Y], via: 'letters' });
});

test('brown is N and black is K — no collision with blue', () => {
  const eight = { codeLength: 4, paletteSize: 8, requireLetterPrefix: true };
  assert.deepStrictEqual(mm.parseGuess('/BNKB', eight).code, [B, N, K, B]);
});

test('an invalid letter rejects the whole code', () => {
  assert.deepStrictEqual(mm.parseGuess('/RGBZ', opts), { ok: false, reason: 'unknown-colour' });
});

test('a letter outside the active palette is rejected', () => {
  assert.deepStrictEqual(mm.parseGuess('/RGBN', opts), { ok: false, reason: 'out-of-palette' });
});

test('separators inside a letter code are ignored', () => {
  assert.deepStrictEqual(mm.parseGuess('/R-G-B-Y', opts).code, [R, G, B, Y]);
});

console.log('\nbare letter codes (the default — no prefix needed)');

// Chat viewers should be able to just type RGBY. This is the default because
// tapping out coloured emoji on a phone is slow enough that many viewers
// simply would not play.
const bare = { codeLength: 4, paletteSize: 6 }; // requireLetterPrefix omitted

test('requireLetterPrefix defaults to off', () => {
  const config = require('../src/config');
  assert.strictEqual(config.DEFAULTS.requireLetterPrefix, false);
  assert.strictEqual(config.validate({}).requireLetterPrefix, false);
});

test('a bare letter code is accepted with no prefix', () => {
  assert.deepStrictEqual(mm.parseGuess('RGBY', bare), { ok: true, code: [R, G, B, Y], via: 'letters' });
});

test('lowercase works — viewers will not use caps', () => {
  assert.deepStrictEqual(mm.parseGuess('rgby', bare).code, [R, G, B, Y]);
  assert.deepStrictEqual(mm.parseGuess('rGbY', bare).code, [R, G, B, Y]);
});

test('the / prefix still works when it is not required', () => {
  // Viewers who learned the prefixed form must not suddenly be broken.
  for (const t of ['/rgby', '!rgby', '.rgby']) {
    assert.deepStrictEqual(mm.parseGuess(t, bare).code, [R, G, B, Y], 'failed for ' + t);
  }
});

test('a 6-slot bare code works on the full 8-colour palette', () => {
  const six = { codeLength: 6, paletteSize: 8 };
  assert.deepStrictEqual(mm.parseGuess('rbgryo', six).code, [R, B, G, R, Y, O]);
  assert.deepStrictEqual(mm.parseGuess('RBGRYOPNK'.slice(0, 6), six).code, [R, B, G, R, Y, O]);
});

test('ordinary chat is still rejected — wrong length or unknown letters', () => {
  for (const t of ['hello everyone', 'lol', 'nice one', 'whats the code', 'yes']) {
    assert.strictEqual(mm.parseGuess(t, bare).ok, false, t + ' was wrongly read as a guess');
  }
});

test('a wrong-length run of palette letters is ignored', () => {
  assert.deepStrictEqual(mm.parseGuess('RGB', bare), { ok: false, reason: 'wrong-length' });
  assert.deepStrictEqual(mm.parseGuess('RGBYP', bare), { ok: false, reason: 'wrong-length' });
});

test('KNOWN TRADE-OFF: a code-length chat word of palette letters does score', () => {
  // Documented, accepted behaviour rather than a bug. On the default board
  // these are the realistic collisions; each one merely adds a wrong row to a
  // board with unlimited guesses. Set requireLetterPrefix to restore the gate.
  for (const word of ['GYRO', 'PYRO', 'ORGY', 'POOR', 'GROG']) {
    assert.strictEqual(mm.parseGuess(word, bare).ok, true,
      word + ' should parse under the documented trade-off');
  }
  // ...and the gate still works when switched back on.
  const gated = { codeLength: 4, paletteSize: 6, requireLetterPrefix: true };
  for (const word of ['GYRO', 'PYRO', 'ORGY', 'POOR', 'GROG']) {
    assert.deepStrictEqual(mm.parseGuess(word, gated), { ok: false, reason: 'no-prefix' });
  }
});

console.log('\nformatting helpers');

test('formatCode renders squares', () => {
  assert.strictEqual(mm.formatCode([R, G, B, Y]), '🟥🟩🟦🟨');
});

test('formatLetters renders the letter code', () => {
  assert.strictEqual(mm.formatLetters([R, G, B, Y]), 'RGBY');
});

test('formatScore lists exact pegs first and reveals no positions', () => {
  assert.strictEqual(mm.formatScore(2, 1), '⚫⚫⚪');
  assert.strictEqual(mm.formatScore(0, 0), '');
});

test('codeKey is stable and distinguishes orderings', () => {
  assert.strictEqual(mm.codeKey([R, G, B, Y]), mm.codeKey([R, G, B, Y]));
  assert.notStrictEqual(mm.codeKey([R, G, B, Y]), mm.codeKey([G, R, B, Y]));
});

test('getPalette returns exactly the playable colours', () => {
  assert.strictEqual(mm.getPalette(4).length, 4);
  assert.strictEqual(mm.getPalette(6).length, 6);
  assert.strictEqual(mm.getPalette(99).length, mm.MAX_PALETTE_SIZE);
  assert.deepStrictEqual(mm.getPalette(4).map(c => c.letter), ['R', 'G', 'B', 'Y']);
});

test('every palette letter is unique', () => {
  const letters = mm.PALETTE.map(c => c.letter);
  assert.strictEqual(new Set(letters).size, letters.length);
});

test('every palette glyph is unique across squares, circles and hearts', () => {
  const glyphs = mm.PALETTE.flatMap(c => [c.square, c.circle, c.heart]);
  assert.strictEqual(new Set(glyphs).size, glyphs.length);
});

test('every colour has a heart, and none carry a variation selector', () => {
  mm.PALETTE.forEach(c => {
    assert.ok(c.heart, c.key + ' has no heart glyph');
    assert.ok(!c.heart.includes('️'),
      c.key + " heart has U+FE0F baked in — lookups will never match");
  });
});

test('white is not playable — it is reserved for feedback pegs', () => {
  const glyphs = mm.PALETTE.flatMap(c => [c.square, c.circle]);
  assert.ok(!glyphs.includes('⬜') && !glyphs.includes('⚪'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
