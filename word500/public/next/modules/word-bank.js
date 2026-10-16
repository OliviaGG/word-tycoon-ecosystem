// Word bank — loads the dictionary for a given word length and validates guesses.
// The dictionary is the SAME endpoint used by the legacy solo/MP clients
// (proxied through Chat Relay), so what counts as a "valid word" stays
// identical to before.

const _dicts = new Map();         // length → Set<string> (lowercase)
// Keyed by length: the solo length picker can request a second dictionary while
// the first is still in flight, and a single shared promise would hand back the
// wrong length's word set.
const _loadInflight = new Map();  // length → Promise<Set<string>>

/**
 * Ensure the dictionary for a given word length is loaded.
 * Returns a Promise<Set<string>>. Cached after first load.
 */
export function loadDictionary(wordLen) {
  const key = String(wordLen);
  if (_dicts.has(key)) return Promise.resolve(_dicts.get(key));
  if (_loadInflight.has(key)) return _loadInflight.get(key);

  const p = fetch(`/api/word-bank/dictionary/${encodeURIComponent(key)}`, {
    credentials: 'same-origin', signal: AbortSignal.timeout(20000),
  })
    .then(r => {
      if (!r.ok) throw new Error(`dict HTTP ${r.status}`);
      return r.json();
    })
    .then(arr => {
      const set = new Set(arr.map(w => String(w).toLowerCase()));
      _dicts.set(key, set);
      _loadInflight.delete(key);
      return set;
    })
    .catch(e => {
      _loadInflight.delete(key);
      console.warn('[word-bank] failed to load dictionary:', e);
      // Return an empty set so callers don't crash; validation becomes "accept all".
      return new Set();
    });
  _loadInflight.set(key, p);
  return p;
}

/**
 * Synchronous validation. Returns true if the word is in the loaded dictionary
 * OR if the dictionary failed to load (don't punish the player for our outage).
 */
export function isValidGuess(word, wordLen) {
  const set = _dicts.get(String(wordLen || word.length));
  if (!set || set.size === 0) return true;   // not loaded yet → allow
  return set.has(String(word).toLowerCase());
}

/**
 * Fetch today's daily target word. Returns { word, date, length, gameId }.
 * Caller decides whether to use it (solo daily) or ignore (MP / practice).
 */
export function fetchDaily(wordLen) {
  return fetch(`/api/sp/daily?length=${encodeURIComponent(wordLen)}`, {
    credentials: 'same-origin', signal: AbortSignal.timeout(20000),
  })
    .then(r => {
      if (!r.ok) throw new Error(`daily HTTP ${r.status}`);
      return r.json();
    })
    .catch(e => {
      console.warn('[word-bank] failed to fetch daily:', e);
      return null;
    });
}

/**
 * Fetch the targets list (object keyed by length → array of words). Cached
 * in module scope so practice mode can pick a random word without re-fetching.
 */
const _targets = new Map();
let _targetsInflight = null;

export function loadTargets() {
  if (_targets.size > 0) return Promise.resolve(_targets);
  if (_targetsInflight) return _targetsInflight;
  _targetsInflight = fetch('/api/word-bank/targets', { credentials: 'same-origin', signal: AbortSignal.timeout(20000) })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && typeof data === 'object') {
        for (const [len, words] of Object.entries(data)) {
          if (Array.isArray(words)) _targets.set(String(len), words);
        }
      }
      _targetsInflight = null;
      return _targets;
    })
    .catch(() => { _targetsInflight = null; return _targets; });
  return _targetsInflight;
}

/** Random target word at the given length. Returns null if targets not loaded. */
export function pickRandomTarget(wordLen) {
  const arr = _targets.get(String(wordLen));
  if (!arr || arr.length === 0) return null;
  return String(arr[Math.floor(Math.random() * arr.length)]).toUpperCase();
}
