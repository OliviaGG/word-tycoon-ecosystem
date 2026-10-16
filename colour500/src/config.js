'use strict';
// ─── Colour 500 — runtime configuration ───────────────────────────────────
// Persisted to data/config.json. Everything here is streamer-tunable; the
// values are validated and clamped on both load and save so a hand-edited
// file can never put the game into an unplayable state.
//
// Board-shape changes (codeLength / paletteSize / allowDuplicates) apply to
// the NEXT round by design — silently reshaping the board mid-round would
// invalidate every deduction players have already made.

const fs = require('fs');
const path = require('path');
const mm = require('./mastermind');

// Overridable so the integration test can run against a scratch directory
// (kept in step with DATA_DIR in server.js).
const DATA_DIR = process.env.COLOUR500_DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  // Board shape
  codeLength: 4,        // 3-6 slots
  paletteSize: 6,       // 4-8 colours
  allowDuplicates: true, // classic Mastermind allows repeats

  // Chat parsing
  // Letter guessing is deliberately frictionless: a viewer can just type
  // RGBY. Typing coloured emoji on a phone is slow, and plenty of viewers
  // will not bother, so the letters must be as easy as possible.
  //
  // The trade-off: a chat word that is exactly code-length and made only of
  // palette letters registers as a guess (GYRO, PYRO, ORGY, POOR, GROG on the
  // default 4-slot/6-colour board). Harmless — it just adds a wrong row to a
  // board with unlimited guesses. Flip this to true to require a /, ! or .
  // prefix instead. Coloured emoji are always accepted bare either way.
  requireLetterPrefix: false,

  // Round pacing
  newGameDelayMs: 8000, // pause between a win and the next round

  // Jackpot — same shape and curve as Word 5000's, so payouts feel consistent
  // across the ecosystem. See calculatePot() in server.js.
  jackpot: {
    enabled: true,
    base: 300,
    perGuess: 10,
    perSecond: 1.67,
    max: 10000,
  },
};

let _config = { ...DEFAULTS, jackpot: { ...DEFAULTS.jackpot } };

function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Clamp an arbitrary object into a valid configuration.
 * Unknown keys are dropped; missing keys fall back to defaults.
 */
function validate(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const jp = (src.jackpot && typeof src.jackpot === 'object') ? src.jackpot : {};

  const out = {
    codeLength: mm.clampCodeLength(_num(src.codeLength, DEFAULTS.codeLength)),
    paletteSize: mm.clampPaletteSize(_num(src.paletteSize, DEFAULTS.paletteSize)),
    allowDuplicates: src.allowDuplicates === undefined
      ? DEFAULTS.allowDuplicates
      : !!src.allowDuplicates,
    requireLetterPrefix: src.requireLetterPrefix === undefined
      ? DEFAULTS.requireLetterPrefix
      : !!src.requireLetterPrefix,
    newGameDelayMs: Math.min(120000, Math.max(1000,
      _num(src.newGameDelayMs, DEFAULTS.newGameDelayMs))),
    jackpot: {
      enabled: jp.enabled === undefined ? DEFAULTS.jackpot.enabled : !!jp.enabled,
      base: Math.min(1000000, Math.max(0, _num(jp.base, DEFAULTS.jackpot.base))),
      perGuess: Math.min(1000000, Math.max(0, _num(jp.perGuess, DEFAULTS.jackpot.perGuess))),
      perSecond: Math.min(1000000, Math.max(0, _num(jp.perSecond, DEFAULTS.jackpot.perSecond))),
      max: Math.min(1000000000, Math.max(0, _num(jp.max, DEFAULTS.jackpot.max))),
    },
  };

  // A no-duplicates code can never be longer than the palette it draws from.
  if (!out.allowDuplicates && out.codeLength > out.paletteSize) {
    out.codeLength = out.paletteSize;
  }

  return out;
}

/** Load config from disk, falling back to defaults on a missing/corrupt file. */
function load() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* already there */ }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _config = validate(raw);
    console.log('[Colour500] Config loaded from data/config.json');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err; // Preserve corrupt bytes; never reset an accepted configuration.
    }
    _config = validate({});
    save(); // materialise the file so it can be hand-edited later
  }
  return get();
}

/** Crash-safe write (temp file + rename), matching the ecosystem convention. */
function save() {
  try {
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_config, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
    return true;
  } catch (err) {
    console.error('[Colour500] Failed to save config:', err.message);
    return false;
  }
}

/** A defensive copy — callers must never mutate the live config object. */
function get() {
  return { ..._config, jackpot: { ..._config.jackpot } };
}

/**
 * Merge a partial update, validate, persist.
 * @param {object} patch
 * @returns {object} the new effective config
 */
function update(patch) {
  const merged = {
    ..._config,
    ...(patch || {}),
    jackpot: { ..._config.jackpot, ...((patch && patch.jackpot) || {}) },
  };
  _config = validate(merged);
  save();
  return get();
}

function prepare(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Invalid config');
  for (const key of ['allowDuplicates','requireLetterPrefix']) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw Error('Invalid boolean');
  for (const key of ['codeLength','paletteSize','newGameDelayMs']) if (patch[key] !== undefined && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]))) throw Error('Invalid number');
  if (patch.jackpot !== undefined) {
    if (!patch.jackpot || typeof patch.jackpot !== 'object' || Array.isArray(patch.jackpot)) throw Error('Invalid jackpot');
    for (const [key, value] of Object.entries(patch.jackpot)) {
      if (key === 'enabled' ? typeof value !== 'boolean' : !['base','perGuess','perSecond','max'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'max' ? 1000000000 : 1000000)) throw Error('Invalid jackpot value');
    }
  }
  return validate({ ..._config, ...patch, jackpot: { ..._config.jackpot, ...patch.jackpot } });
}
function setAccepted(value) { _config = validate(value); return get(); }
module.exports = { DEFAULTS, CONFIG_PATH, load, save, get, update, validate, prepare, setAccepted };
