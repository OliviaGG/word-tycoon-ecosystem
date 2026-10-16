// ===== Bank Dictionary =====
// Loads the shared Word Bank dictionary so the guess processor can
// distinguish "real English word outside the gated rank pool" from
// "typo/nonsense word". Used to render `(N+)` in the UI instead of `???`
// when the player guesses something like "xylyl" that is valid but has
// been filtered out by the frequency gate.

const fs = require('fs');
const { resolveRelayOrShared } = require('./shared-resolver');

const DEFAULT_PATH = process.env.SEARCHLE_BANK_DICT_PATH
  || resolveRelayOrShared('data/word-bank/dictionary.json');

let bankDict = new Set();
let loaded = false;

function load(dictPath = DEFAULT_PATH) {
  try {
    const t0 = Date.now();
    const raw = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
    const next = new Set();
    // Bank dictionary.json schema: { "3": ["ace","ant",...], "5": [...], ... }
    for (const len in raw) {
      const words = raw[len];
      if (Array.isArray(words)) {
        for (const w of words) next.add(String(w).toLowerCase());
      }
    }
    bankDict = next;
    loaded = true;
    console.log(`[Boot] Loaded bank dictionary: ${bankDict.size.toLocaleString()} words from ${dictPath} (${Date.now() - t0}ms)`);
    return true;
  } catch (e) {
    console.warn(`[Boot] bank dictionary load failed (${dictPath}): ${e.message}. "xylyl-class" words will keep rendering as ???.`);
    bankDict = new Set();
    loaded = false;
    return false;
  }
}

function has(word) {
  if (!word) return false;
  return bankDict.has(String(word).toLowerCase());
}

function size() {
  return bankDict.size;
}

function isLoaded() {
  return loaded;
}

module.exports = { load, has, size, isLoaded };
