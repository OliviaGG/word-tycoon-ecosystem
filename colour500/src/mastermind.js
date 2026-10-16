'use strict';
// ─── Colour 500 — pure deduction engine ───────────────────────────────────
// No I/O, no state, no dependencies. Everything here is a pure function so it
// can be unit-tested in isolation (see test/engine.test.js) and reused by both
// the server and, if ever needed, the browser.
//
// The game is classic Mastermind played with colours instead of letters:
//   - A secret CODE of N slots is drawn from a palette of M colours.
//   - Colours MAY repeat in the secret (this is the original rule).
//   - Feedback is AGGREGATE and UNORDERED: you learn how many slots are an
//     exact match and how many are the right colour in the wrong slot, but
//     never WHICH ones. That ambiguity is the entire game.

// ─── Palette ──────────────────────────────────────────────────────────────
// Ordered by visual distinctness, NOT by rainbow order. A 4-colour game takes
// the first four (red/green/blue/yellow — maximally distinguishable, including
// for most colour-vision deficiencies); 6 adds purple+orange to match classic
// Mastermind; 8 adds brown+black.
//
// `letter` codes are collision-free on purpose: blue, brown and black all
// begin with B, so brown is N (browN) and black is K (blacK), following the
// CMYK convention. R G B Y P O N K are unique.
//
// White (⬜/⚪) is deliberately NOT a playable colour — it is reserved for the
// feedback pegs below, so a viewer can never confuse a guess with a result.
// `heart` glyphs are written as \u escapes on purpose. The red heart is
// U+2764, which is almost always typed as U+2764 + U+FE0F (variation
// selector); parseGuess strips FE0F before lookup, so the BARE codepoint is
// what must be in this table. Pasting the literal "❤️" here would embed the
// selector and the lookup would never match.
const PALETTE = [
  { key: 'red',    name: 'Red',    letter: 'R', square: '🟥', circle: '🔴', heart: '❤',   hex: '#e8404a' },
  { key: 'green',  name: 'Green',  letter: 'G', square: '🟩', circle: '🟢', heart: '\u{1F49A}', hex: '#3fbf5f' },
  { key: 'blue',   name: 'Blue',   letter: 'B', square: '🟦', circle: '🔵', heart: '\u{1F499}', hex: '#3d7ff2' },
  { key: 'yellow', name: 'Yellow', letter: 'Y', square: '🟨', circle: '🟡', heart: '\u{1F49B}', hex: '#f2c53d' },
  { key: 'purple', name: 'Purple', letter: 'P', square: '🟪', circle: '🟣', heart: '\u{1F49C}', hex: '#9b5de5' },
  { key: 'orange', name: 'Orange', letter: 'O', square: '🟧', circle: '🟠', heart: '\u{1F9E1}', hex: '#f08a24' },
  { key: 'brown',  name: 'Brown',  letter: 'N', square: '🟫', circle: '🟤', heart: '\u{1F90E}', hex: '#96602e' },
  { key: 'black',  name: 'Black',  letter: 'K', square: '⬛', circle: '⚫', heart: '\u{1F5A4}', hex: '#2b2b33' },
];

// Extra glyphs that mean the same colour but aren't the canonical form shown
// in the UI. Keeps the palette table one-glyph-per-column while still being
// forgiving about what a viewer's keyboard actually inserts.
const SYMBOL_ALIASES = [
  ['♥', 'red'],   // ♥ card-suit heart — some keyboards offer this first
];

// Spoken colour names, e.g. "green blue red orange". Only worth supporting now
// that Color 500 is exempt from the relay's batch-guess clamp — before that a
// multi-word guess was truncated to its first word for non-Donors.
const NAME_ALIASES = { violet: 'purple' };

// Feedback peg glyphs — classic Mastermind colours.
const PEG_EXACT = '⚫';     // right colour, right slot
const PEG_MISPLACED = '⚪'; // right colour, wrong slot

// Config bounds. Streamer-configurable within these limits.
const MIN_CODE_LENGTH = 3;
const MAX_CODE_LENGTH = 6;
const MIN_PALETTE_SIZE = 4;
const MAX_PALETTE_SIZE = PALETTE.length; // 8

// ─── Lookup tables ────────────────────────────────────────────────────────
// Built once. Map every accepted input glyph to its palette index.
const SYMBOL_TO_INDEX = new Map();
const LETTER_TO_INDEX = new Map();
PALETTE.forEach((c, i) => {
  SYMBOL_TO_INDEX.set(c.square, i);
  SYMBOL_TO_INDEX.set(c.circle, i);
  SYMBOL_TO_INDEX.set(c.heart, i);
  LETTER_TO_INDEX.set(c.letter, i);
});
SYMBOL_ALIASES.forEach(([glyph, key]) => {
  const i = PALETTE.findIndex(c => c.key === key);
  if (i !== -1) SYMBOL_TO_INDEX.set(glyph, i);
});

const NAME_TO_INDEX = new Map();
PALETTE.forEach((c, i) => {
  NAME_TO_INDEX.set(c.key.toLowerCase(), i);
  NAME_TO_INDEX.set(c.name.toLowerCase(), i);
});
Object.entries(NAME_ALIASES).forEach(([alias, key]) => {
  const i = PALETTE.findIndex(c => c.key === key);
  if (i !== -1) NAME_TO_INDEX.set(alias.toLowerCase(), i);
});

// What counts as real chat content: an actual letter or digit, in any script.
// EVERYTHING else — spaces, punctuation, and any other emoji — is treated as
// noise and silently skipped.
//
// This is deliberate and load-bearing. TikTok viewers pad repeated messages
// with dots, exclamation marks and random emoji to get past the platform's
// spam/censorship filters, and a guess like "bgro!" or "🟦✨🟩✨🟥✨🟧" must
// still count. Only a stray letter or digit means "this is a sentence, not a
// guess" — which is what still keeps ordinary chat off the board.
//
// (Note: on TikTok a space-separated guess is truncated by Chat Relay's
// batch-guess perk gate before it ever reaches this parser — see AGENTS.md.)
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

// Prefixes that mark an intentional letter-code guess: /rgby, !rgby, .rgby
const PREFIX_RE = /^[/!.]+/;

/**
 * The playable colours for a given palette size.
 * @param {number} paletteSize
 * @returns {Array<object>} slice of PALETTE (never mutated by callers)
 */
function getPalette(paletteSize) {
  const n = clampPaletteSize(paletteSize);
  return PALETTE.slice(0, n).map(c => ({ ...c }));
}

function clampCodeLength(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 4;
  return Math.min(MAX_CODE_LENGTH, Math.max(MIN_CODE_LENGTH, v));
}

function clampPaletteSize(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 6;
  return Math.min(MAX_PALETTE_SIZE, Math.max(MIN_PALETTE_SIZE, v));
}

/**
 * Draw a random secret code.
 *
 * @param {number} codeLength  slots in the code
 * @param {number} paletteSize colours available
 * @param {boolean} allowDuplicates may a colour appear more than once
 * @returns {number[]} palette indices
 */
function generateCode(codeLength, paletteSize, allowDuplicates = true) {
  const len = clampCodeLength(codeLength);
  const size = clampPaletteSize(paletteSize);

  if (allowDuplicates) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(Math.floor(Math.random() * size));
    return out;
  }

  // Distinct-colours mode: partial Fisher-Yates over the palette indices.
  // Guarded because a code can never be longer than the palette without repeats.
  const pool = Array.from({ length: size }, (_, i) => i);
  const take = Math.min(len, size);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * Score a guess against the secret — the heart of the game.
 *
 * Two passes, and the second pass MUST only consider slots the first pass did
 * not consume. Getting this wrong is the classic Mastermind bug: a guess of
 * 🟥🟥🟥🟥 against a secret containing a single red would otherwise report
 * four misplaced pegs instead of one.
 *
 * Invariant: exact + misplaced <= codeLength, always.
 *
 * @param {number[]} guess  palette indices
 * @param {number[]} code   palette indices (the secret)
 * @returns {{exact: number, misplaced: number}}
 */
function scoreGuess(guess, code) {
  const len = code.length;
  let exact = 0;

  // Tally colour counts for the slots that are NOT exact matches. Anything
  // already matched exactly is removed from both pools so it cannot be
  // double-counted as a misplaced peg.
  const codeCounts = new Map();
  const guessCounts = new Map();

  for (let i = 0; i < len; i++) {
    if (guess[i] === code[i]) {
      exact++;
    } else {
      codeCounts.set(code[i], (codeCounts.get(code[i]) || 0) + 1);
      guessCounts.set(guess[i], (guessCounts.get(guess[i]) || 0) + 1);
    }
  }

  // A colour contributes min(appearances in leftover secret, in leftover guess).
  let misplaced = 0;
  for (const [colour, n] of guessCounts) {
    const inCode = codeCounts.get(colour) || 0;
    misplaced += Math.min(n, inCode);
  }

  return { exact, misplaced };
}

/**
 * Parse a chat message (or web submission) into a code.
 *
 * Accepted forms, for a 4-slot game on a 6-colour palette:
 *   🟥🟩🟦🟨   coloured squares
 *   🔴🟢🔵🟡   coloured circles, treated as the same colours
 *   RGBY       bare letter code, any case — the easy path on a phone
 *   /RGBY      the same, with an optional /, ! or . prefix
 *
 * Letter codes are accepted bare by default because tapping out coloured
 * emoji on a phone keyboard is slow enough that many viewers would not play
 * at all. The cost: a chat word that is exactly code-length and built only
 * from palette letters scores as a guess (GYRO, PYRO, ORGY, POOR and GROG on
 * the default board). That is harmless on a board with unlimited guesses —
 * it adds one wrong row. Set `requireLetterPrefix` true in data/config.json
 * to close that door; emoji stay bare either way.
 *
 * @param {string} text raw message
 * @param {object} opts { codeLength, paletteSize, requireLetterPrefix }
 * @returns {{ok: true, code: number[], via: 'emoji'|'letters'}
 *          |{ok: false, reason: string}}
 */
function parseGuess(text, opts = {}) {
  const codeLength = clampCodeLength(opts.codeLength);
  const paletteSize = clampPaletteSize(opts.paletteSize);
  // Defaults to OFF, matching config.DEFAULTS — a caller that omits the
  // option gets the same frictionless behaviour chat viewers get.
  const requireLetterPrefix = opts.requireLetterPrefix === true;

  if (typeof text !== 'string') return { ok: false, reason: 'empty' };

  // Drop emoji presentation selectors and zero-width joiners so a glyph sent
  // as e.g. "⬛️" (with U+FE0F) still matches the bare "⬛" in the lookup table.
  // Written as escapes because these characters are invisible in source.
  const cleaned = text.replace(/[\uFE0F\uFE0E\u200D]/g, '').trim();
  if (!cleaned) return { ok: false, reason: 'empty' };

  // ── Attempt 1: emoji ────────────────────────────────────────────────────
  // Walk by code point (NOT by char) — every palette glyph is astral and would
  // be split into surrogate halves by a plain index loop.
  const chars = Array.from(cleaned);
  const emojiHits = [];
  let sawUnknown = false;
  let sawOutOfPalette = false;

  for (const ch of chars) {
    if (SYMBOL_TO_INDEX.has(ch)) {
      const idx = SYMBOL_TO_INDEX.get(ch);
      if (idx >= paletteSize) sawOutOfPalette = true;
      emojiHits.push(idx);
    } else if (WORD_CHAR_RE.test(ch)) {
      // Real text alongside the colours — a sentence, not a guess.
      sawUnknown = true;
    }
    // Anything else (punctuation, other emoji) is filter-dodging noise: skip.
  }

  if (emojiHits.length > 0) {
    // The message contains colour emoji, so it is meant as a guess. Anything
    // else mixed in makes it unparseable rather than silently truncated —
    // scoring half a viewer's intent is worse than ignoring it.
    if (sawUnknown) return { ok: false, reason: 'mixed-content' };
    if (sawOutOfPalette) return { ok: false, reason: 'out-of-palette' };
    if (emojiHits.length !== codeLength) return { ok: false, reason: 'wrong-length' };
    return { ok: true, code: emojiHits, via: 'emoji' };
  }

  const hasPrefix = PREFIX_RE.test(cleaned);
  const body = cleaned.replace(PREFIX_RE, '');

  // ── Attempt 2: spoken colour names ──────────────────────────────────────
  // "green blue red orange". Tried BEFORE the letter path because those two
  // can't be confused: a colour name contains letters like E and N that are
  // not palette letters, so the letter path would reject it outright.
  //
  // Only accepted when EVERY token is a colour name — that is what keeps
  // ordinary chat ("the green one") off the board. A non-name token simply
  // falls through to the letter path, so "gory" still parses as G-O-R-Y.
  //
  // No prefix is ever required here: spelling out four colour names is
  // unambiguous in a way a bare four-letter code is not.
  const words = body.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length && words.every(w => NAME_TO_INDEX.has(w))) {
    const named = words.map(w => NAME_TO_INDEX.get(w));
    if (named.some(i => i >= paletteSize)) return { ok: false, reason: 'out-of-palette' };
    if (named.length !== codeLength) return { ok: false, reason: 'wrong-length' };
    return { ok: true, code: named, via: 'names' };
  }

  // ── Attempt 3: letter code ──────────────────────────────────────────────
  if (requireLetterPrefix && !hasPrefix) return { ok: false, reason: 'no-prefix' };

  const letters = [];
  for (const ch of Array.from(body)) {
    if (!WORD_CHAR_RE.test(ch)) continue;   // punctuation / emoji padding
    const idx = LETTER_TO_INDEX.get(ch.toUpperCase());
    if (idx === undefined) return { ok: false, reason: 'unknown-colour' };
    if (idx >= paletteSize) return { ok: false, reason: 'out-of-palette' };
    letters.push(idx);
  }

  if (letters.length === 0) return { ok: false, reason: 'empty' };
  if (letters.length !== codeLength) return { ok: false, reason: 'wrong-length' };
  return { ok: true, code: letters, via: 'letters' };
}

/**
 * Render a code as emoji squares — used in logs and any chat-facing output.
 * @param {number[]} code
 * @returns {string}
 */
function formatCode(code) {
  return (code || []).map(i => (PALETTE[i] ? PALETTE[i].square : '❓')).join('');
}

/**
 * Render a code as its letter form, e.g. "RGBY".
 * @param {number[]} code
 * @returns {string}
 */
function formatLetters(code) {
  return (code || []).map(i => (PALETTE[i] ? PALETTE[i].letter : '?')).join('');
}

/**
 * Render peg feedback, e.g. "⚫⚪⚪". Deliberately gives no positional hint —
 * exact pegs are simply listed first.
 * @param {number} exact
 * @param {number} misplaced
 * @returns {string}
 */
function formatScore(exact, misplaced) {
  return PEG_EXACT.repeat(exact) + PEG_MISPLACED.repeat(misplaced);
}

/**
 * Stable string key for a code, for duplicate-guess detection.
 * @param {number[]} code
 * @returns {string}
 */
function codeKey(code) {
  return (code || []).join(',');
}

module.exports = {
  PALETTE,
  PEG_EXACT,
  PEG_MISPLACED,
  MIN_CODE_LENGTH,
  MAX_CODE_LENGTH,
  MIN_PALETTE_SIZE,
  MAX_PALETTE_SIZE,
  getPalette,
  clampCodeLength,
  clampPaletteSize,
  generateCode,
  scoreGuess,
  parseGuess,
  formatCode,
  formatLetters,
  formatScore,
  codeKey,
};
