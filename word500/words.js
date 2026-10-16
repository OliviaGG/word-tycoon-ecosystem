/**
 * Word 500 - Word Manager
 * Fetches word data from Chat Relay's shared word bank.
 * Falls back to a minimal built-in list if word bank is unavailable.
 */

const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const relayOrigin = new URL(CHAT_RELAY_URL);
if (!['localhost','127.0.0.1','[::1]'].includes(relayOrigin.hostname) || relayOrigin.protocol !== 'http:' || relayOrigin.port !== '3000' || relayOrigin.username || relayOrigin.password) throw Error('Invalid local word bank origin');
const bankFetch = url => { if (new URL(url).origin !== relayOrigin.origin) throw Error('Invalid word bank destination'); return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }); };

// Word data (populated on init from word bank)
let targets = {};      // { "5": ["abbey","abyss",...], ... }
let dictionarySet = new Set();  // flat set of all valid guess words
let targetSet = new Set();      // flat set of all target words
let loaded = false;

// Minimal fallback targets if word bank is unavailable
const FALLBACK_TARGETS = {
  5: [
    'angel','apple','bacon','beach','brain','bread','cabin','chain','chair','chalk',
    'chess','cliff','cloud','crane','cream','crown','dairy','demon','denim','dream',
    'eagle','earth','flame','flesh','flood','flour','flute','forge','fruit','ghost',
    'glass','globe','grain','grape','gravel','heart','honey','horse','house','ivory',
    'jelly','jewel','juice','knife','lemon','light','llama','lunar','magic','maple',
    'medal','melon','money','mouse','nerve','night','noble','novel','nurse','ocean',
    'olive','onion','opera','otter','paint','panic','paper','pearl','piano','pilot',
    'plant','plumb','queen','radar','raven','river','robin','robot','royal','sauce',
    'scout','shale','shark','sheep','shell','shirt','slime','smoke','snail','snake',
    'solar','spice','spoon','steam','steel','stone','storm','stove','sugar','swift',
    'sword','table','tiger','toast','tower','train','trout','tulip','ultra','valve',
    'vapor','vault','viola','vodka','wagon','whale','wheat','wheel','witch','yacht',
    'zebra'
  ]
};

/**
 * Initialize word data from Chat Relay's word bank.
 * Retries a few times if Chat Relay isn't ready yet.
 */
async function init() {
  const maxRetries = 5;
  const retryDelay = 3000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Words] Fetching from word bank (attempt ${attempt}/${maxRetries})...`);

      const [targetsRes, statsRes] = await Promise.all([
        bankFetch(`${CHAT_RELAY_URL}/api/word-bank/targets`),
        bankFetch(`${CHAT_RELAY_URL}/api/word-bank/stats`)
      ]);

      if (!targetsRes.ok || !statsRes.ok) {
        throw new Error(`HTTP ${targetsRes.status}/${statsRes.status}`);
      }

      targets = await targetsRes.json();
      const stats = await statsRes.json();

      // Build target set
      targetSet = new Set();
      for (const words of Object.values(targets)) {
        for (const w of words) targetSet.add(w.toLowerCase());
      }

      // Fetch dictionary for each length that has targets
      dictionarySet = new Set();
      const rawLengths = stats.lengths || Object.keys(targets).map(Number);
      if (!Array.isArray(rawLengths) || rawLengths.length > 32) throw Error('Invalid word bank lengths');
      const lengths = [...new Set(rawLengths)].filter(n => Number.isInteger(n) && n >= 3 && n <= 12);

      await Promise.all(lengths.map(async len => {
        try {
          const dictRes = await bankFetch(`${CHAT_RELAY_URL}/api/word-bank/dictionary/${len}`);
          if (dictRes.ok) {
            const words = await dictRes.json();
            for (const w of words) dictionarySet.add(w.toLowerCase());
          }
        } catch (e) {
          console.warn(`[Words] Failed to fetch dictionary for length ${len}`);
        }
      }));

      // Ensure all targets are also in dictionary
      for (const w of targetSet) dictionarySet.add(w);

      loaded = true;
      const targetCount = targetSet.size;
      const dictCount = dictionarySet.size;
      console.log(`[Words] Loaded ${targetCount} targets, ${dictCount} dictionary words from word bank`);
      return;

    } catch (err) {
      console.warn(`[Words] Word bank fetch failed (attempt ${attempt}): ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }

  // Fallback to built-in minimal list
  console.warn('[Words] Using fallback word list (word bank unavailable)');
  targets = FALLBACK_TARGETS;
  targetSet = new Set();
  for (const words of Object.values(targets)) {
    for (const w of words) targetSet.add(w.toLowerCase());
  }
  dictionarySet = new Set(targetSet);
  loaded = true;
}

/**
 * Get target words for a specific length.
 * @param {number} length
 * @returns {string[]}
 */
function getTargets(length) {
  return (targets[String(length)] || []).filter(word => typeof word === 'string' && /^[a-zA-Z]+$/.test(word) && word.length === Number(length));
}

/**
 * Get all available word lengths.
 * @returns {number[]}
 */
function getWordLengths() {
  return Object.keys(targets)
    .map(Number)
    .filter(n => (targets[String(n)] || []).length > 0)
    .sort((a, b) => a - b);
}

/**
 * Get a random target word for a given length, excluding already-played words.
 * @param {number} length
 * @param {string[]} [exclude=[]]
 * @returns {string|null}
 */
function getRandomTarget(length, exclude = []) {
  const pool = getTargets(length);
  if (pool.length === 0) return null;

  const excludeSet = new Set(exclude.map(w => w.toLowerCase()));
  const available = pool.filter(w => !excludeSet.has(w.toLowerCase()));

  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Check if a word is in the curated target pool.
 * @param {string} word
 * @returns {boolean}
 */
function isValidWord(word) {
  return targetSet.has(word.toLowerCase());
}

/**
 * Check if a word is a valid English word (for guess validation).
 * @param {string} word
 * @returns {boolean}
 */
function isValidGuess(word) {
  return dictionarySet.has(word.toLowerCase());
}

/**
 * Check if word data has been loaded.
 * @returns {boolean}
 */
function isLoaded() {
  return loaded;
}

/**
 * Get stats about loaded words.
 */
function getStats() {
  const stats = {};
  for (const [len, words] of Object.entries(targets)) {
    stats[len] = { targets: words.length };
  }
  return {
    loaded,
    totalTargets: targetSet.size,
    totalDictionary: dictionarySet.size,
    byLength: stats
  };
}

module.exports = {
  init,
  getTargets,
  getWordLengths,
  getRandomTarget,
  isValidWord,
  isValidGuess,
  isLoaded,
  getStats
};
