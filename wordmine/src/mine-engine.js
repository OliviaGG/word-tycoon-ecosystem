/**
 * Mine Engine — Letter set generation, word solving, and depth classification
 * Core algorithm module for Word Mine.
 */

// ─── Depth Tier Definitions ──────────────────────────────────────────────────

const DEPTH_TIERS = [
  { id: 'surface', label: 'Surface', ore: 'Coal',    color: '#6b7280', xp: 2 },
  { id: 'shallow', label: 'Shallow', ore: 'Iron',    color: '#a1724a', xp: 2 },
  { id: 'medium',  label: 'Medium',  ore: 'Silver',  color: '#94a3b8', xp: 2 },
  { id: 'deep',    label: 'Deep',    ore: 'Gold',    color: '#f59e0b', xp: 3 },
  { id: 'core',    label: 'Core',    ore: 'Diamond', color: '#06b6d4', xp: 3 },
];

const DEPTH_THRESHOLDS = {
  surface: 15,  // Find 15 Surface words → unlock Shallow + bonus letter 1
  shallow: 12,  // Find 12 Shallow words → unlock Medium + bonus letter 2
  medium:  10,  // Find 10 Medium words → unlock Deep + bonus letter 3
  deep:    8,   // Find 8 Deep words → unlock Core (all letters already revealed)
};

const TIER_XP = {};
for (const t of DEPTH_TIERS) TIER_XP[t.id] = t.xp;

// ─── Letter Weights (English frequency-based) ───────────────────────────────

const LETTER_WEIGHTS = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4,
  m: 2, n: 6, o: 8, p: 2, q: 1, r: 6, s: 6, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1
};

const LETTERS = Object.keys(LETTER_WEIGHTS);

// ─── Seeded PRNG ────────────────────────────────────────────────────────────

/**
 * Hash a string into a 32-bit integer seed.
 */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Create a deterministic PRNG from a string seed.
 * Returns a function that behaves like Math.random() but is repeatable.
 * @param {string} seed
 * @returns {Function} rng() → number in [0, 1)
 */
function seededRandom(seed) {
  let s = hashSeed(String(seed));
  return function () {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}

// ─── Letter Set Generation ───────────────────────────────────────────────────

/**
 * Build a weighted random letter picker.
 * @param {string[]} [biasLetters] - Letters to boost 3× for themed mines
 * @param {Function} [rng] - Random function (default: Math.random)
 * @returns {Function} picker() → random letter
 */
function buildWeightedPicker(biasLetters, rng) {
  rng = rng || Math.random;
  const weights = {};
  for (const ch of LETTERS) weights[ch] = LETTER_WEIGHTS[ch];
  if (biasLetters) {
    for (const ch of biasLetters) {
      if (weights[ch] !== undefined) weights[ch] *= 3;
    }
  }
  // Build cumulative distribution
  const entries = Object.entries(weights);
  let total = 0;
  const cumulative = [];
  for (const [ch, w] of entries) {
    total += w;
    cumulative.push({ ch, cum: total });
  }
  return function picker() {
    const r = rng() * total;
    for (const { ch, cum } of cumulative) {
      if (r < cum) return ch;
    }
    return cumulative[cumulative.length - 1].ch;
  };
}

/**
 * Generate a 12-letter set for a mine.
 * @param {string} [seedWord] - Optional seed word to guarantee its letters are included
 * @param {object} [options]
 * @param {string[]} [options.biasLetters] - Theme bias letters (3× weight boost)
 * @param {number} [options.totalLetters=12] - Total letters to generate
 * @returns {{ letters: string[], initialIndices: number[], bonusOrder: number[] }}
 */
function generateLetterSet(seedWord, options = {}) {
  const total = options.totalLetters || 12;
  const biasLetters = options.biasLetters || null;
  const rng = options.rng || Math.random;
  const picker = buildWeightedPicker(biasLetters, rng);

  // Start with seed word's unique letters (guarantees some good words exist)
  const seedLetters = seedWord
    ? [...new Set(seedWord.toLowerCase().replace(/[^a-z]/g, '').split(''))]
    : [];

  const letters = [...seedLetters];

  // Ensure at least 2 vowels in seed portion
  const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
  let vowelCount = letters.filter(l => vowels.has(l)).length;

  // Pad to target count with weighted random letters
  while (letters.length < total) {
    const ch = picker();
    // Unique letters only — letters are reusable so duplicates waste a slot
    if (letters.includes(ch)) continue;
    // Ensure minimum 3 vowels in the full set
    if (letters.length === total - 1 && vowelCount < 3 && !vowels.has(ch)) continue;
    letters.push(ch);
    if (vowels.has(ch)) vowelCount++;
  }

  // Shuffle
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }

  // Default: first 9 = initial, last 3 = bonus
  const initialIndices = [];
  for (let i = 0; i < 9; i++) initialIndices.push(i);
  const bonusOrder = [];
  for (let i = 9; i < total; i++) bonusOrder.push(i);

  return { letters, initialIndices, bonusOrder };
}

/**
 * Optimize which letters are initial vs bonus.
 * Initial 9 should maximize Surface/Shallow words.
 * Bonus 3 should unlock the most Medium/Deep/Core words.
 *
 * @param {string[]} letters - All 12 letters
 * @param {object} wordsByTier - Pre-solved { surface: [...], ... }
 * @param {Set} dictionarySet - Valid words set
 * @returns {{ initialIndices: number[], bonusOrder: number[] }}
 */
function optimizeBonusAssignment(letters, wordsByTier, dictionarySet) {
  const letterSet12 = new Set(letters);
  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

  // For each possible 3-letter bonus combination, score how many Deep/Core words
  // are ONLY possible with the bonus letters (not with just the initial 9)
  let bestScore = -1;
  let bestBonusIndices = [9, 10, 11];

  // Try all C(12,3) = 220 combinations for bonus
  for (let a = 0; a < 12; a++) {
    for (let b = a + 1; b < 12; b++) {
      for (let c = b + 1; c < 12; c++) {
        const bonusSet = new Set([a, b, c]);
        const initialLetterSet = new Set();
        let initialVowelCount = 0;
        for (let i = 0; i < 12; i++) {
          if (!bonusSet.has(i)) {
            initialLetterSet.add(letters[i]);
            if (VOWELS.has(letters[i])) initialVowelCount++;
          }
        }

        // HARD CONSTRAINT: initial 9 must have at least 2 vowels
        if (initialVowelCount < 2) continue;

        // Count how many surface+shallow words are possible with just initial 9
        let surfaceShallowCount = 0;
        const easyWords = [...(wordsByTier.surface || []), ...(wordsByTier.shallow || [])];
        for (const w of easyWords) {
          if (wordFormedFrom(w, initialLetterSet)) surfaceShallowCount++;
        }

        // SOFT CONSTRAINT: need at least 10 easy words from initial set
        if (surfaceShallowCount < 10) continue;

        // Count how many deep+core words REQUIRE bonus letters
        let deepCoreExclusive = 0;
        const hardWords = [...(wordsByTier.deep || []), ...(wordsByTier.core || [])];
        for (const w of hardWords) {
          if (wordFormedFrom(w, letterSet12) && !wordFormedFrom(w, initialLetterSet)) {
            deepCoreExclusive++;
          }
        }

        // Score: heavily favor accessible easy words, bonus for depth exclusivity
        const score = surfaceShallowCount * 10 + deepCoreExclusive * 3;
        if (score > bestScore) {
          bestScore = score;
          bestBonusIndices = [a, b, c];
        }
      }
    }
  }

  const bonusSet = new Set(bestBonusIndices);
  const initialIndices = [];
  for (let i = 0; i < 12; i++) {
    if (!bonusSet.has(i)) initialIndices.push(i);
  }

  return { initialIndices, bonusOrder: bestBonusIndices };
}

/**
 * Optimize bonus assignment for variable-length letter sets.
 * numBonus letters become bonus; the rest are initial.
 */
function optimizeBonusAssignmentFlex(letters, wordsByTier, numBonus) {
  const total = letters.length;
  if (numBonus <= 0 || numBonus >= total) {
    const initialIndices = [];
    for (let i = 0; i < total; i++) initialIndices.push(i);
    return { initialIndices, bonusOrder: [] };
  }
  const numInitial = total - numBonus;
  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
  const allLetterSet = new Set(letters);

  let bestScore = -1;
  let bestBonusIndices = [];
  // Default fallback: last N are bonus
  for (let i = total - numBonus; i < total; i++) bestBonusIndices.push(i);

  // For small sets, try all C(total, numBonus) combinations
  function combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const result = [];
    const [first, ...rest] = arr;
    for (const c of combinations(rest, k - 1)) result.push([first, ...c]);
    for (const c of combinations(rest, k)) result.push(c);
    return result;
  }

  const indices = [];
  for (let i = 0; i < total; i++) indices.push(i);
  const combos = combinations(indices, numBonus);

  for (const bonusIdxs of combos) {
    const bonusSet = new Set(bonusIdxs);
    const initialLetterSet = new Set();
    let initialVowels = 0;
    for (let i = 0; i < total; i++) {
      if (!bonusSet.has(i)) {
        initialLetterSet.add(letters[i]);
        if (VOWELS.has(letters[i])) initialVowels++;
      }
    }
    // Need at least 1 vowel in initial set
    if (initialVowels < 1) continue;

    let easyCount = 0;
    const easyWords = [...(wordsByTier.surface || []), ...(wordsByTier.shallow || [])];
    for (const w of easyWords) {
      if (wordFormedFrom(w, initialLetterSet)) easyCount++;
    }
    if (easyCount < 3) continue;

    let hardExclusive = 0;
    const hardWords = [...(wordsByTier.deep || []), ...(wordsByTier.core || [])];
    for (const w of hardWords) {
      if (wordFormedFrom(w, allLetterSet) && !wordFormedFrom(w, initialLetterSet)) {
        hardExclusive++;
      }
    }

    const score = easyCount * 10 + hardExclusive * 3;
    if (score > bestScore) {
      bestScore = score;
      bestBonusIndices = bonusIdxs;
    }
  }

  const bonusSet = new Set(bestBonusIndices);
  const initialIndices = [];
  for (let i = 0; i < total; i++) {
    if (!bonusSet.has(i)) initialIndices.push(i);
  }
  return { initialIndices, bonusOrder: bestBonusIndices };
}

/**
 * Generate a mine with exactly 15 letters (11 initial + 4 bonus).
 * Grows letter-by-letter toward targetWords, with RNG variance in selection
 * to ensure variety across mines. Win condition is finding all surface words
 * — thresholds are set as surface-word quarterly milestones.
 *
 * @param {string} seedWord - Seed word for letter generation
 * @param {number} targetWords - Guides which letters to pick (word count goal)
 * @param {string[]} dictionaryArr - Full dictionary array
 * @param {object} frequency - Zipf frequency map
 * @param {object} [options] - { rng, totalLetters, numBonus }
 * @returns {{ letters, initialIndices, bonusOrder, allWords }}
 */
function generateScaledMine(seedWord, targetWords, dictionaryArr, frequency, options = {}) {
  const rng = options.rng || Math.random;
  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
  const totalLetters = options.totalLetters || 15;
  const numBonus = options.numBonus !== undefined ? options.numBonus : 4;

  // Start with seed word's unique letters (up to totalLetters)
  const seedLetters = seedWord
    ? [...new Set(seedWord.toLowerCase().replace(/[^a-z]/g, '').split(''))]
    : [];
  const letters = seedLetters.slice(0, Math.min(totalLetters, seedLetters.length));

  // Grow one letter at a time to totalLetters
  // Picks from the top 3 candidates by closeness to targetWords — adds variety
  while (letters.length < totalLetters) {
    const vowelCount = letters.filter(l => VOWELS.has(l)).length;
    const needVowel = vowelCount < 2;

    // Score all candidates
    const candidates = [];
    for (const candidate of LETTERS) {
      if (letters.includes(candidate)) continue;
      if (needVowel && !VOWELS.has(candidate)) continue;
      const trial = [...letters, candidate];
      const result = solveMine(trial, dictionaryArr, frequency);
      const diff = Math.abs(result.totals.total - targetWords);
      candidates.push({ ch: candidate, diff, words: result });
    }

    if (!candidates.length) break;

    // Sort by diff (smallest = closest to target)
    candidates.sort((a, b) => a.diff - b.diff);

    // Weighted pick from top 3: best=4 weight, 2nd=2, 3rd=1 — adds variance
    const topN = Math.min(3, candidates.length);
    const weights = [4, 2, 1].slice(0, topN);
    const totalW = weights.reduce((a, b) => a + b, 0);
    let r = rng() * totalW;
    let chosen = candidates[0];
    for (let ci = 0; ci < topN; ci++) {
      r -= weights[ci];
      if (r <= 0) { chosen = candidates[ci]; break; }
    }

    letters.push(chosen.ch);
  }

  // Solve final word set
  const bestWords = solveMine(letters, dictionaryArr, frequency);

  // Shuffle letters before assigning initial/bonus positions
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }

  // Optimize which letters are initial (shown upfront) vs bonus (revealed per milestone)
  const { initialIndices, bonusOrder } = optimizeBonusAssignmentFlex(
    letters, bestWords, numBonus
  );

  // Thresholds: finding surface words drives ALL depth progression.
  // 4 milestones at 25% / 50% / 75% / 100% of surface words = win.
  const s = (bestWords.surface || []).length || 4;
  const q1 = Math.ceil(s * 0.25);
  const q2 = Math.ceil(s * 0.50) - q1;
  const q3 = Math.ceil(s * 0.75) - q1 - q2;
  const q4 = s - q1 - q2 - q3;
  bestWords.thresholds = {
    surface: Math.max(1, q1),
    shallow: Math.max(1, q2),
    medium:  Math.max(1, q3),
    deep:    Math.max(1, q4),
  };

  return {
    letters,
    initialIndices,
    bonusOrder,
    allWords: bestWords,
  };
}

// ─── Word Solving ────────────────────────────────────────────────────────────

/**
 * Check if a word can be formed from a set of letters (letters reusable).
 * @param {string} word
 * @param {Set<string>} letterSet
 * @returns {boolean}
 */
function wordFormedFrom(word, letterSet) {
  for (let i = 0; i < word.length; i++) {
    if (!letterSet.has(word[i])) return false;
  }
  return true;
}

/**
 * Classify a word into a depth tier based on Zipf frequency.
 * @param {string} word
 * @param {object} frequency - { word: zipfScore, ... }
 * @returns {string} Tier id: 'surface' | 'shallow' | 'medium' | 'deep' | 'core'
 */
function classifyWord(word, frequency) {
  const zipf = frequency[word.toLowerCase()];
  if (zipf !== undefined) {
    if (zipf >= 5.0) return 'surface';
    if (zipf >= 4.0) return 'shallow';
    if (zipf >= 3.0) return 'medium';
    return 'deep';
  }
  // No frequency data — ultra rare
  return 'hidden';
}

/**
 * Find all valid words from a set of letters and classify by depth tier.
 * @param {string[]} letters - All 12 letters
 * @param {string[]|Set} dictionary - All valid words (array or Set)
 * @param {object} frequency - { word: zipfScore, ... }
 * @param {number} [minLength=4] - Minimum word length
 * @returns {{ surface: string[], shallow: string[], medium: string[], deep: string[], core: string[], totals: object }}
 */
function solveMine(letters, dictionary, frequency, minLength = 4) {
  const letterSet = new Set(letters.map(l => l.toLowerCase()));

  const result = { surface: [], shallow: [], medium: [], deep: [], core: [], hidden: [] };

  // Iterate all dictionary words
  const words = dictionary instanceof Set ? [...dictionary] : dictionary;
  for (const word of words) {
    if (word.length < minLength) continue;
    if (!wordFormedFrom(word, letterSet)) continue;
    const tier = classifyWord(word, frequency);
    result[tier].push(word);
  }

  // Sort each tier alphabetically
  for (const tier of Object.keys(result)) {
    result[tier].sort();
  }

  // Totals: goal = non-hidden only, hidden tracked separately as bonus
  result.totals = {
    surface: result.surface.length,
    shallow: result.shallow.length,
    medium: result.medium.length,
    deep: result.deep.length,
    core: result.core.length,
    hidden: result.hidden.length,
    total: result.surface.length + result.shallow.length + result.medium.length +
           result.deep.length + result.core.length,
  };

  return result;
}

/**
 * Find valid words using ONLY a subset of letters (for progressive reveal).
 * @param {string[]} availableLetters - Currently available letters (9-12)
 * @param {object} wordsByTier - Pre-solved full mine words
 * @returns {object} Filtered wordsByTier with only words formable from availableLetters
 */
function filterWordsByAvailable(availableLetters, wordsByTier) {
  const letterSet = new Set(availableLetters.map(l => l.toLowerCase()));
  const result = {};
  for (const tier of ['surface', 'shallow', 'medium', 'deep', 'core', 'hidden']) {
    result[tier] = (wordsByTier[tier] || []).filter(w => wordFormedFrom(w, letterSet));
  }
  return result;
}

// ─── Word Count Capping ─────────────────────────────────────────────────────

/**
 * Cap the total word count in a solved mine while keeping tier distribution balanced.
 * Uses proportional allocation across all tiers with minimum guarantees.
 * @param {object} wordsByTier - Output from solveMine()
 * @param {number} maxWords - Target maximum total word count
 * @returns {object} Capped wordsByTier with updated totals
 */
function capWordCount(wordsByTier, maxWords) {
  if (!maxWords || wordsByTier.totals.total <= maxWords) {
    // Even if not capping, ensure hidden passes through
    if (!wordsByTier.hidden) wordsByTier.hidden = [];
    return wordsByTier;
  }

  const TIERS = ['surface', 'shallow', 'medium', 'deep', 'core'];
  const total = wordsByTier.totals.total;
  const result = {};

  // Pass 1: proportional allocation (minimum 1 per non-empty tier)
  let allocated = 0;
  for (const tier of TIERS) {
    const available = wordsByTier[tier].length;
    if (available === 0) { result[tier] = []; continue; }
    const alloc = Math.max(1, Math.round((available / total) * maxWords));
    result[tier] = wordsByTier[tier].slice(0, Math.min(alloc, available));
    allocated += result[tier].length;
  }

  // Pass 2: trim if over budget (trim largest tier first, repeatedly)
  while (allocated > maxWords) {
    let maxTier = null, maxLen = 0;
    for (const tier of TIERS) {
      if (result[tier].length > 1 && result[tier].length > maxLen) {
        maxLen = result[tier].length;
        maxTier = tier;
      }
    }
    if (!maxTier) break;
    result[maxTier].pop();
    allocated--;
  }

  // Pass 3: fill if under budget (add to tiers that have remaining capacity)
  while (allocated < maxWords) {
    let added = false;
    for (const tier of TIERS) {
      if (allocated >= maxWords) break;
      if (result[tier].length < wordsByTier[tier].length) {
        result[tier].push(wordsByTier[tier][result[tier].length]);
        allocated++;
        added = true;
      }
    }
    if (!added) break;
  }

  // Pass hidden through unchanged (valid guesses, not subject to capping)
  result.hidden = wordsByTier.hidden || [];

  // Recalculate totals (goal = non-hidden, hidden tracked separately)
  result.totals = {};
  let grandTotal = 0;
  for (const tier of TIERS) {
    result.totals[tier] = result[tier].length;
    grandTotal += result[tier].length;
  }
  result.totals.hidden = result.hidden.length;
  result.totals.total = grandTotal;

  return result;
}

// ─── Threshold-Based Capping ─────────────────────────────────────────────────

/**
 * Cap each tier to exactly the depth threshold count (5/4/3/2/1).
 * Filters each tier's words to only those formable from available letters
 * at that depth (progressive reveal: surface=initial, shallow=+1 bonus, etc.).
 * Randomly selects within each tier for variety.
 *
 * @param {object} wordsByTier - Output from solveMine()
 * @param {string[]} letters - All 12 letters
 * @param {number[]} initialIndices - Initial 9 letter indices
 * @param {number[]} bonusOrder - Bonus letter indices (unlocked per tier)
 * @param {number} [maxWords=50] - Total target words to distribute across tiers
 * @returns {object} Capped wordsByTier with updated totals and .thresholds
 */
function capToThresholds(wordsByTier, letters, initialIndices, bonusOrder, maxWords) {
  const TIER_IDS = ['surface', 'shallow', 'medium', 'deep', 'core'];

  // Compute proportional caps from maxWords
  // Ratios: surface 30%, shallow 24%, medium 20%, deep 16%, core 10%
  maxWords = maxWords || 50;
  const RATIOS = [0.30, 0.24, 0.20, 0.16, 0.10]; // same order as TIER_IDS
  const CAPS = {};
  let allocated = 0;
  for (let i = 0; i < TIER_IDS.length; i++) {
    CAPS[TIER_IDS[i]] = Math.max(1, Math.floor(RATIOS[i] * maxWords));
    allocated += CAPS[TIER_IDS[i]];
  }
  // Distribute remainder to tiers in order (surface gets extras first)
  let remainder = maxWords - allocated;
  for (let i = 0; i < TIER_IDS.length && remainder > 0; i++) {
    CAPS[TIER_IDS[i]]++;
    remainder--;
    allocated++;
  }

  // Build available letter sets at each depth level
  // Surface: only initial letters; each deeper tier adds one bonus letter
  const avail = new Set(initialIndices.map(i => letters[i].toLowerCase()));
  const availSets = { surface: new Set(avail) };
  for (let t = 1; t < TIER_IDS.length; t++) {
    if (t - 1 < bonusOrder.length) {
      avail.add(letters[bonusOrder[t - 1]].toLowerCase());
    }
    availSets[TIER_IDS[t]] = new Set(avail);
  }

  const result = {};
  let grandTotal = 0;
  for (const tier of TIER_IDS) {
    const letterSet = availSets[tier] || new Set(letters.map(l => l.toLowerCase()));
    // Filter to words formable from available letters at this depth
    const eligible = (wordsByTier[tier] || []).filter(w => wordFormedFrom(w, letterSet));

    // Shuffle then take cap (randomize selection for variety)
    const shuffled = eligible.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const cap = CAPS[tier] ?? 1;
    result[tier] = shuffled.slice(0, Math.min(cap, shuffled.length));
    grandTotal += result[tier].length;
  }

  // Pass hidden through unchanged (valid guesses, not subject to capping)
  result.hidden = wordsByTier.hidden || [];

  result.totals = {};
  for (const tier of TIER_IDS) {
    result.totals[tier] = result[tier].length;
  }
  result.totals.hidden = result.hidden.length;
  result.totals.total = grandTotal;

  // Attach per-game thresholds (= actual word count per tier, find all to progress)
  result.thresholds = {};
  for (const tier of TIER_IDS) {
    if (tier !== 'core') result.thresholds[tier] = result.totals[tier];
  }

  return result;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  generateLetterSet,
  generateScaledMine,
  optimizeBonusAssignment,
  solveMine,
  filterWordsByAvailable,
  classifyWord,
  wordFormedFrom,
  buildWeightedPicker,
  seededRandom,
  capWordCount,
  capToThresholds,
  DEPTH_TIERS,
  DEPTH_THRESHOLDS,
  TIER_XP,
  LETTER_WEIGHTS,
  LETTERS,
};
