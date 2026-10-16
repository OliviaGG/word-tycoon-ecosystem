// game.js - Server-side Game class (identity-aware, CommonJS)

const path = require('path');

const { findAllWords, computeAdjacency } = require('./solver');

// Safety valve for _bestLitPath's DFS. An 8x6 board with a <=15 letter word
// explores a few hundred nodes; this only exists so a pathological board can
// never stall a guess.
const MAX_PATH_NODES = 200000;
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const GAME_WORD_POLICY_ID = process.env.GAME_WORD_POLICY_ID || 'rectangled';

let gameWordPolicy = { isWordBlockedForGame: () => false };
try {
    gameWordPolicy = require(path.join(RELAY_DIR, 'src', 'game-word-policy.js'));
} catch (error) {
    console.warn('[Game] Word policy unavailable:', error.message);
}

const LETTER_WEIGHTS = {
    a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2,
    i: 9, j: 1, k: 1, l: 4, m: 2, n: 6, o: 8, p: 2,
    q: 1, r: 6, s: 6, t: 6, u: 4, v: 2, w: 2, x: 1,
    y: 2, z: 1
};

const MIN_WORDS_BY_SIZE = {
    2: 1, 3: 3, 4: 10, 5: 15, 6: 30, 7: 25, 8: 25, 9: 25, 10: 25
};

// Zipf frequency threshold: words >= this are "common" (required for completion).
// Words below this but in freq dataset are "rare" (visible bonus).
// Words without freq data are "hidden" (valid guess, not shown).
// Standardized at 4.0 to match the Chat Relay word bank and professional word game norms.
const ZIPF_COMMON_THRESHOLD = 4.0;

// ─── Word Length Bonus (exponential curve) ──────────────────────────
const WORD_LENGTH_BONUS = { 4: 75, 5: 150, 6: 300, 7: 500, 8: 800, 9: 1200, 10: 1750, 11: 2500 };
const WORD_LENGTH_BONUS_MAX = 3500;
function getWordLengthBonus(word) {
  const len = word.length;
  if (len <= 3) return 0;
  if (len >= 12) return WORD_LENGTH_BONUS_MAX;
  return WORD_LENGTH_BONUS[len] || 0;
}

// ─── Letter Rarity (English frequency-based, 7-tier) ────────────────
// EVERY letter scores — no tier is worth 0. Rebased 2026-08-07: the old table
// gave e t a o i n s h r a value of 0, which meant 64.6% of all tiles on a
// board contributed nothing, and 3% of dictionary words scored no letter bonus
// at all. Raises the average MP payout ~10% (1,910 → 2,102), accepted
// deliberately rather than offset by cutting the flat word base.
//
// Tier VALUES and letter→tier live in separate maps and the number map is
// derived from them. Previously the value→name lookup was keyed by the value
// itself ({0:'common', 15:'uncommon', …}), so changing any number without
// changing that key in lockstep silently produced tierCounts[undefined]++.
const LETTER_TIER_VALUE = {
  common: 25, uncommon: 40, rare: 60, epic: 90, legendary: 140, mythic: 220, unique: 350
};

const LETTER_TIER = {
  e: 'common', t: 'common',
  a: 'common', o: 'common', i: 'common', n: 'common', s: 'common', h: 'common', r: 'common',
  d: 'uncommon', l: 'uncommon',
  c: 'rare', u: 'rare', m: 'rare', w: 'rare', f: 'rare',
  g: 'epic', y: 'epic', p: 'epic',
  b: 'legendary', v: 'legendary', k: 'legendary',
  j: 'mythic', x: 'mythic',
  q: 'unique', z: 'unique'
};

// Derived letter→number map; hot paths index this directly.
const LETTER_RARITY = Object.fromEntries(
  Object.entries(LETTER_TIER).map(([ch, tier]) => [ch, LETTER_TIER_VALUE[tier]])
);

function getLetterRarityBonus(word) {
  let bonus = 0;
  const tierCounts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, unique: 0 };
  // Per-letter values in word order, so a caller can attribute the bonus to
  // individual tiles instead of only reporting the sum.
  const letterValues = [];
  for (const ch of word.toLowerCase()) {
    const tier = LETTER_TIER[ch];
    if (tier === undefined) { letterValues.push(0); continue; }
    const b = LETTER_TIER_VALUE[tier];
    bonus += b;
    tierCounts[tier]++;
    letterValues.push(b);
  }
  return { bonus, tierCounts, letterValues };
}

// How long the grid-retry loop may run before an async driver hands the event
// loop back. ~15ms keeps socket traffic flowing during a background build.
const YIELD_SLICE_MS = 15;

// Max common (required) words by smallest grid dimension
// Caps playability — excess common words demoted to rare
const COMMON_CAP_BY_SIZE = {
    3: 50, 4: 100, 5: 150, 6: 200, 7: 300, 8: 400,
    9: 500, 10: 500, 11: 500, 12: 500, 13: 500, 14: 500,
    15: 500, 16: 500, 17: 500, 18: 500, 19: 500, 20: 500
};

function isBlockedGuess(word) {
    if (!word || typeof gameWordPolicy.isWordBlockedForGame !== 'function') return false;
    return gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'guess', word);
}

function buildWeightedPool() {
    const pool = [];
    for (const [letter, weight] of Object.entries(LETTER_WEIGHTS)) {
        for (let i = 0; i < weight; i++) {
            pool.push(letter);
        }
    }
    return pool;
}

const LETTER_POOL = buildWeightedPool();

function randomLetter() {
    return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
}

function generateGrid(rows, cols) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push(randomLetter());
        }
        grid.push(row);
    }
    return grid;
}

class Game {
    constructor() {
        this.grid = [];
        this.rows = 4;
        this.cols = 4;
        this.minWordLength = 3;
        this.allWords = new Map();          // word -> Array<cellIndex> (single path)
        this.foundWords = new Map();        // word -> { platform, platformUserId, username, displayName, timestamp, isRare }
        this.playerScores = new Map();      // platformUserId -> { score, displayName, profileImage, platform }
        this.incorrectGuesses = [];         // { word, timestamp }
        this.recentGuessTags = [];         // { result, word, timestamp }
        this.lastFoundWord = null;
        this.startTime = null;
        this.commonWords = new Map();       // word -> cells (targets ≥4 letters — required)
        this.rareWords = new Map();         // word -> cells (has freq data, not target, ≥4 letters — visible bonus)
        this.hiddenWords = new Map();       // word -> cells (no freq data, not target, ≥4 letters — valid but not shown)
        this.threeLetterWords = new Map();  // word -> cells (all 3-letter words — separate bonus)
        this.foundCommon = new Map();       // word -> finder info
        this.foundRare = new Map();         // word -> finder info
        this.foundHidden = new Map();       // word -> finder info
        this.foundThreeLetter = new Map();  // word -> finder info
        this.puzzleId = null;
        this.puzzleName = null;
        this.puzzleTheme = null;
    }

    /**
     * Split allWords into common, rare, hidden, and 3-letter categories.
     * Classification is frequency-based (Zipf scores from word bank):
     *   - 3-letter: all 3-letter words (separate bonus category)
     *   - common: Zipf >= ZIPF_COMMON_THRESHOLD (required for completion)
     *   - rare: has frequency data but below threshold (visible bonus)
     *   - hidden: no frequency data at all (valid guess but not shown in counts)
     * After splitting, caps common words by grid size for playability.
     */
    splitWords(targetSet, frequencyMap) {
        this.commonWords = new Map();
        this.rareWords = new Map();
        this.hiddenWords = new Map();
        this.threeLetterWords = new Map();

        const freq = frequencyMap || new Map();

        for (const [word, cells] of this.allWords) {
            if (word.length === 3) {
                this.threeLetterWords.set(word, cells);
            } else if (freq.has(word)) {
                if (freq.get(word) >= ZIPF_COMMON_THRESHOLD) {
                    this.commonWords.set(word, cells);
                } else {
                    // Has freq data but below threshold → visible rare/bonus
                    this.rareWords.set(word, cells);
                }
            } else {
                // No frequency data → hidden (valid but not shown in counts)
                this.hiddenWords.set(word, cells);
            }
        }

        // Cap common words based on grid size — demote lowest-frequency words first
        const maxCommon = COMMON_CAP_BY_SIZE[Math.min(this.rows, this.cols)] || 40;
        if (this.commonWords.size > maxCommon) {
            const sorted = [...this.commonWords.entries()].sort((a, b) => {
                return (freq.get(a[0]) || 0) - (freq.get(b[0]) || 0);
            });
            const excess = sorted.slice(0, this.commonWords.size - maxCommon);
            for (const [word, cells] of excess) {
                this.commonWords.delete(word);
                this.rareWords.set(word, cells);
            }
        }
    }

    /**
     * Initialize a new game with a generated grid.
     * Retries until every cell is used by at least one word (full board).
     *
     * Runs the retry loop to completion synchronously. Identical behaviour to
     * before the generator split — see _initializeSteps for the actual work.
     */
    initialize(rows, cols, minWordLength, trie, targetSet, opts = {}) {
        const steps = this._initializeSteps(rows, cols, minWordLength, trie, targetSet, opts);
        while (!steps.next().done) { /* drain — no yielding for sync callers */ }
    }

    /**
     * Same as initialize(), but releases the event loop between chunks of
     * attempts so the server stays responsive while a board is generated.
     * Used by board-pool to build the next round ahead of time.
     */
    async initializeAsync(rows, cols, minWordLength, trie, targetSet, opts = {}) {
        const steps = this._initializeSteps(rows, cols, minWordLength, trie, targetSet, opts);
        while (!steps.next().done) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    /**
     * The retry loop itself, as a generator. Yields roughly every
     * YIELD_SLICE_MS of work so async drivers can hand the event loop back;
     * sync drivers just drain it and see the original blocking behaviour.
     */
    *_initializeSteps(rows, cols, minWordLength, trie, targetSet, { minCommon = 15, maxCommon = 500, frequencyMap = null } = {}) {
        this.rows = rows;
        this.cols = cols;
        this.minWordLength = minWordLength;

        const totalCells = rows * cols;
        const largeBoard = totalCells >= 60;
        const mediumBoard = totalCells >= 48;
        const minWords = MIN_WORDS_BY_SIZE[Math.min(rows, cols)] || 1;
        let attempts = 0;
        const maxAttempts = largeBoard ? 1500 : (mediumBoard ? 1000 : 500);
        const REFINE_BUDGET = largeBoard ? 150 : (mediumBoard ? 125 : 100);
        let validFound = 0;        // how many valid grids we've seen
        let bestRareCount = Infinity;
        let bestState = null;      // { grid, allWords, commonWords, rareWords, threeLetterWords }
        let sliceStart = Date.now();

        do {
            this.grid = generateGrid(rows, cols);
            this.allWords = findAllWords(this.grid, rows, cols, trie, minWordLength);
            this.splitWords(targetSet, frequencyMap);
            attempts++;

            // Ensure every cell is used by at least one COMMON word (no greyed cells)
            const usedCells = new Set();
            for (const [, cells] of this.commonWords) {
                for (const c of cells) usedCells.add(c);
            }
            const fullBoard = usedCells.size === totalCells;
            const commonCount = this.commonWords.size;

            const valid = this.allWords.size >= minWords && fullBoard &&
                commonCount >= minCommon && commonCount <= maxCommon;

            if (valid) {
                validFound++;
                // Keep the grid with fewest rare words
                if (this.rareWords.size < bestRareCount) {
                    bestRareCount = this.rareWords.size;
                    bestState = {
                        grid: this.grid,
                        allWords: this.allWords,
                        commonWords: this.commonWords,
                        rareWords: this.rareWords,
                        hiddenWords: this.hiddenWords,
                        threeLetterWords: this.threeLetterWords
                    };
                }
                // Stop early if rare count is very low, or we've refined enough
                if (bestRareCount <= 3 || validFound >= REFINE_BUDGET) break;
            }

            if (attempts >= maxAttempts) {
                if (!bestState) {
                    console.warn(`[Game] Could not generate ideal grid after ${maxAttempts} attempts. Using last (${usedCells.size}/${totalCells} cells, ${this.allWords.size} words, ${this.commonWords.size} common).`);
                }
                break;
            }

            if (Date.now() - sliceStart >= YIELD_SLICE_MS) {
                yield;
                sliceStart = Date.now();
            }
        } while (true);

        // Restore best grid state
        if (bestState) {
            this.grid = bestState.grid;
            this.allWords = bestState.allWords;
            this.commonWords = bestState.commonWords;
            this.rareWords = bestState.rareWords;
            this.hiddenWords = bestState.hiddenWords;
            this.threeLetterWords = bestState.threeLetterWords;
        }

        this.foundWords = new Map();
        this.foundCommon = new Map();
        this.foundRare = new Map();
        this.foundHidden = new Map();
        this.playerScores = new Map();
        this.incorrectGuesses = [];
        this.recentGuessTags = [];
        this.startTime = Date.now();
        this.puzzleId = null;
        this.puzzleName = null;
        this.puzzleTheme = null;

        console.log(`[Game] Initialized: ${rows}x${cols} grid, ${this.allWords.size} words (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden) (${attempts} attempts, ${validFound} valid)`);
    }

    /**
     * Initialize a game from a pre-made puzzle.
     * No retry loop — puzzles are pre-validated.
     */
    initializeFromPuzzle(puzzle, trie, targetSet, frequencyMap) {
        this.grid = puzzle.grid;
        this.rows = puzzle.grid.length;
        this.cols = puzzle.grid[0].length;
        this.minWordLength = puzzle.minWordLength || 3;

        this.allWords = findAllWords(this.grid, this.rows, this.cols, trie, this.minWordLength);
        this.splitWords(targetSet, frequencyMap);

        this.foundWords = new Map();
        this.foundCommon = new Map();
        this.foundRare = new Map();
        this.foundHidden = new Map();
        this.playerScores = new Map();
        this.incorrectGuesses = [];
        this.recentGuessTags = [];
        this.startTime = Date.now();
        this.puzzleId = puzzle.id;
        this.puzzleName = puzzle.name;
        this.puzzleTheme = puzzle.theme;

        console.log(`[Game] Puzzle "${puzzle.name}": ${this.rows}x${this.cols} grid, ${this.allWords.size} words (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden)`);
    }

    /**
     * Place a word as a snake path through adjacent cells on an empty grid.
     * Returns a grid with the word placed (remaining cells are null) or null if placement fails.
     */
    static _placeWordSnake(word, rows, cols) {
        const totalCells = rows * cols;
        const letters = word.toLowerCase().split('');

        for (let startAttempt = 0; startAttempt < 30; startAttempt++) {
            const startCell = Math.floor(Math.random() * totalCells);
            const placed = [startCell];
            const usedCells = new Set([startCell]);
            let success = true;

            for (let li = 1; li < letters.length; li++) {
                const prevCell = placed[placed.length - 1];
                const prevR = Math.floor(prevCell / cols);
                const prevC = prevCell % cols;

                // Find all unvisited adjacent cells
                const neighbors = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const nr = prevR + dr, nc = prevC + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                            const nIdx = nr * cols + nc;
                            if (!usedCells.has(nIdx)) neighbors.push(nIdx);
                        }
                    }
                }

                if (neighbors.length === 0) { success = false; break; }
                const nextCell = neighbors[Math.floor(Math.random() * neighbors.length)];
                placed.push(nextCell);
                usedCells.add(nextCell);
            }

            if (!success) continue;

            // Build grid with word placed, remaining cells null
            const grid = [];
            for (let r = 0; r < rows; r++) {
                const row = [];
                for (let c = 0; c < cols; c++) row.push(null);
                grid.push(row);
            }
            for (let i = 0; i < letters.length; i++) {
                const r = Math.floor(placed[i] / cols);
                const c = placed[i] % cols;
                grid[r][c] = letters[i];
            }
            return grid;
        }
        return null;
    }

    /**
     * Initialize a game with a grid built around a specific word.
     * The word is placed as an adjacent path, remaining cells filled randomly.
     * Used for daily puzzles (e.g. 6x6 grid around a 5-letter word).
     */
    initializeAroundWord(word, rows, cols, trie, targetSet, { minCommon = 15, maxCommon = 40, frequencyMap = null } = {}) {
        this.rows = rows;
        this.cols = cols;
        this.minWordLength = 3;

        const totalCells = rows * cols;
        const largeBoard = totalCells >= 60;
        const mediumBoard = totalCells >= 48;
        const minWords = MIN_WORDS_BY_SIZE[Math.min(rows, cols)] || 20;
        const targetWord = word.toLowerCase();
        let attempts = 0;
        const maxAttempts = largeBoard ? 1500 : (mediumBoard ? 1000 : 500);
        const REFINE_BUDGET = largeBoard ? 150 : (mediumBoard ? 125 : 100);
        let validFound = 0;
        let bestRareCount = Infinity;
        let bestState = null;
        // Fallback used when 500 attempts produce zero valid grids — pick
        // the grid whose commonCount is closest to the desired range
        // midpoint (instead of the random last attempt).
        const targetCommon = Math.round((minCommon + maxCommon) / 2);
        let bestFallbackDistance = Infinity;
        let bestFallbackState = null;

        do {
            // Place the word as a snake path
            const partialGrid = Game._placeWordSnake(targetWord, rows, cols);
            if (!partialGrid) { attempts++; continue; }

            // Fill remaining cells with weighted random letters
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (partialGrid[r][c] === null) {
                        partialGrid[r][c] = randomLetter();
                    }
                }
            }

            this.grid = partialGrid;
            this.allWords = findAllWords(this.grid, rows, cols, trie, this.minWordLength);
            this.splitWords(targetSet, frequencyMap);
            attempts++;

            // Ensure every cell is used by at least one COMMON word (no greyed cells)
            const usedCells = new Set();
            for (const [, cells] of this.commonWords) {
                for (const c of cells) usedCells.add(c);
            }
            const fullBoard = usedCells.size === (rows * cols);
            const commonCount = this.commonWords.size;
            const targetReachable = this.allWords.has(targetWord);
            const enoughWords = this.allWords.size >= minWords;

            // Track the best fallback in case no fully-valid grid is found.
            if (targetReachable && fullBoard && enoughWords) {
                const distance = Math.abs(commonCount - targetCommon);
                if (distance < bestFallbackDistance) {
                    bestFallbackDistance = distance;
                    bestFallbackState = {
                        grid: this.grid,
                        allWords: this.allWords,
                        commonWords: this.commonWords,
                        rareWords: this.rareWords,
                        hiddenWords: this.hiddenWords,
                        threeLetterWords: this.threeLetterWords
                    };
                }
            }

            // Verify target word findable, full board, enough words, common count in range
            const valid = targetReachable && fullBoard && enoughWords &&
                commonCount >= minCommon && commonCount <= maxCommon;

            if (valid) {
                validFound++;
                if (this.rareWords.size < bestRareCount) {
                    bestRareCount = this.rareWords.size;
                    bestState = {
                        grid: this.grid,
                        allWords: this.allWords,
                        commonWords: this.commonWords,
                        rareWords: this.rareWords,
                        hiddenWords: this.hiddenWords,
                        threeLetterWords: this.threeLetterWords
                    };
                }
                if (bestRareCount <= 3 || validFound >= REFINE_BUDGET) break;
            }

            if (attempts >= maxAttempts) {
                if (!bestState) {
                    console.warn(`[Game] Could not build ideal grid around "${targetWord}" after ${maxAttempts} attempts. Best fallback: ${bestFallbackState ? bestFallbackState.commonWords.size + ' common (closest to target ' + targetCommon + ')' : 'using last grid (' + this.commonWords.size + ' common)'}.`);
                }
                break;
            }
        } while (true);

        // Restore best grid state — prefer fully valid, fall back to the
        // closest-to-range candidate, and only as a last resort use the
        // current (last attempt) grid.
        if (bestState) {
            this.grid = bestState.grid;
            this.allWords = bestState.allWords;
            this.commonWords = bestState.commonWords;
            this.rareWords = bestState.rareWords;
            this.hiddenWords = bestState.hiddenWords;
            this.threeLetterWords = bestState.threeLetterWords;
        } else if (bestFallbackState) {
            this.grid = bestFallbackState.grid;
            this.allWords = bestFallbackState.allWords;
            this.commonWords = bestFallbackState.commonWords;
            this.rareWords = bestFallbackState.rareWords;
            this.hiddenWords = bestFallbackState.hiddenWords;
            this.threeLetterWords = bestFallbackState.threeLetterWords;
        }

        this.foundWords = new Map();
        this.foundCommon = new Map();
        this.foundRare = new Map();
        this.foundHidden = new Map();
        this.playerScores = new Map();
        this.incorrectGuesses = [];
        this.recentGuessTags = [];
        this.startTime = Date.now();
        this.puzzleId = 'daily-' + new Date().toISOString().slice(0, 10);
        this.puzzleName = 'Daily: ' + targetWord.toUpperCase();
        this.puzzleTheme = 'Daily';

        console.log(`[Game] Daily grid around "${targetWord}": ${rows}x${cols}, ${this.allWords.size} words (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden) (${attempts} attempts, ${validFound} valid)`);
    }

    /**
     * Process a guess from a player.
     * Uses platformUserId as the unique key for player scores (identity-aware).
     * Common words score +1, rare words score +3.
     * Completion is based on common words only (rare are bonus).
     */
    guess(word, platform, platformUserId, username, displayName, profileImage, isFanClub, perks) {
        const normalized = word.trim().toLowerCase();
        const lettersOnly = normalized.replace(/[^a-z]/g, '');

        // Update existing player's profileImage/displayName on every attempt
        // so PFPs get backfilled even when guesses are wrong
        if (platformUserId) {
            const existing = this.playerScores.get(platformUserId);
            if (existing) {
                if (profileImage && !existing.profileImage) {
                    existing.profileImage = profileImage;
                }
                if (displayName && displayName !== existing.displayName) {
                    existing.displayName = displayName;
                }
                // Sticky FC flag: any chat from a fan-club member flips it on,
                // even on incorrect/already-found guesses. Once true, stays true.
                if (isFanClub && !existing.isFanClub) {
                    existing.isFanClub = true;
                }
                // Same sticky treatment for the other two perks.
                if (perks && perks.isFanClub && !existing.isFanClub) existing.isFanClub = true;
                if (perks && perks.isSuperfan && !existing.isSuperfan) existing.isSuperfan = true;
                if (perks && perks.isDonor && !existing.isDonor) existing.isDonor = true;
            }
        }

        if (!normalized || normalized.length < this.minWordLength) {
            return { result: 'too_short', word: normalized };
        }

        if (isBlockedGuess(word) || isBlockedGuess(lettersOnly)) {
            return { result: 'blocked', word: normalized };
        }

        if (this.foundWords.has(normalized)) {
            this._rememberGuessTag('already_found', normalized);
            return { result: 'already_found', word: normalized };
        }

        if (this.allWords.has(normalized)) {
            const isThreeLetter = this.threeLetterWords.has(normalized);
            const isRare = !isThreeLetter && this.rareWords.has(normalized);
            const isHidden = !isThreeLetter && this.hiddenWords.has(normalized);
            const baseScore = isThreeLetter ? 100 : (isHidden ? 1000 : (isRare ? 500 : 1500));
            const letterRarity = getLetterRarityBonus(normalized);
            const lengthBonus = getWordLengthBonus(normalized);
            const scoreValue = baseScore + letterRarity.bonus + lengthBonus;

            const finderInfo = {
                platform,
                platformUserId,
                username,
                displayName,
                timestamp: Date.now(),
                isRare,
                isHidden,
                isThreeLetter
            };

            // Snapshot the lit board as the player saw it. getActiveCells()
            // below runs after this word is marked found, so by then it no
            // longer reflects what was lit at guess time.
            const activeBefore = this.getActiveCells();

            // Record in foundWords (backwards compat)
            this.foundWords.set(normalized, finderInfo);

            // Record in appropriate tracking category
            if (isThreeLetter) {
                this.foundThreeLetter.set(normalized, finderInfo);
            } else if (isHidden) {
                this.foundHidden.set(normalized, finderInfo);
            } else if (isRare) {
                this.foundRare.set(normalized, finderInfo);
            } else {
                this.foundCommon.set(normalized, finderInfo);
            }

            // Update player score using platformUserId as key
            const prev = this.playerScores.get(platformUserId) || {
                score: 0,
                displayName: displayName || username,
                profileImage: null,
                platform: platform,
                isFanClub: false,
                isSuperfan: false,
                isDonor: false
            };
            this.playerScores.set(platformUserId, {
                score: prev.score + scoreValue,
                displayName: displayName || username || prev.displayName,
                profileImage: profileImage || prev.profileImage,
                platform: platform || prev.platform,
                // Sticky: once flagged FC, stays flagged across rounds.
                isFanClub: !!isFanClub || !!prev.isFanClub || !!(perks && perks.isFanClub),
                isSuperfan: !!prev.isSuperfan || !!(perks && perks.isSuperfan),
                isDonor: !!prev.isDonor || !!(perks && perks.isDonor)
            });

            const activeCells = this.getActiveCells();
            const cells = this._bestLitPath(normalized, activeBefore);

            const correctResult = {
                result: 'correct',
                word: normalized,
                isRare,
                isHidden,
                isThreeLetter,
                letterRarityBonus: letterRarity.bonus,
                letterRarityTierCounts: letterRarity.tierCounts,
                wordLengthBonus: lengthBonus,
                username: displayName || username,
                displayName: displayName || username,
                profilePic: profileImage || null,
                platform,
                platformUserId,
                cells: [...cells],
                foundCount: this.foundCommon.size,
                totalCount: this.commonWords.size,
                isComplete: this.foundCommon.size === this.commonWords.size,
                topPlayers: this.getTopPlayers(),
                activeCells: [...activeCells]
            };

            this.lastFoundWord = correctResult;
            return correctResult;
        }

        // Incorrect guess
        const entry = { word: normalized, timestamp: Date.now() };
        this.incorrectGuesses.push(entry);
        if (this.incorrectGuesses.length > 10) {
            this.incorrectGuesses.shift();
        }
        this._rememberGuessTag('incorrect', normalized);

        return { result: 'incorrect', word: normalized };
    }

    _rememberGuessTag(result, word) {
        if (!word || (result !== 'incorrect' && result !== 'already_found')) return;
        this.recentGuessTags.push({ result, word, timestamp: Date.now() });
        if (this.recentGuessTags.length > 12) {
            this.recentGuessTags.shift();
        }
    }

    getRecentActivityTags(limit = 12) {
        const combined = [];

        for (const tag of this.recentGuessTags) {
            if (!tag || !tag.word) continue;
            if (tag.result !== 'incorrect' && tag.result !== 'already_found') continue;
            combined.push({
                result: tag.result,
                word: tag.word,
                timestamp: Number(tag.timestamp) || 0
            });
        }

        for (const [word, info] of this.foundWords.entries()) {
            combined.push({
                result: 'already_found',
                word,
                timestamp: Number(info && info.timestamp) || 0
            });
        }

        combined.sort((a, b) => a.timestamp - b.timestamp);

        const dedupedNewestFirst = [];
        const seen = new Set();
        for (let i = combined.length - 1; i >= 0; i--) {
            const tag = combined[i];
            const key = `${tag.result}:${tag.word}`;
            if (!tag.word || seen.has(key)) continue;
            seen.add(key);
            dedupedNewestFirst.push(tag);
            if (dedupedNewestFirst.length >= limit) break;
        }

        return dedupedNewestFirst.reverse();
    }

    /**
     * Get the top 3 players sorted by score.
     */
    getTopPlayers() {
        return [...this.playerScores.entries()]
            .map(([id, data]) => ({
                platformUserId: id,
                displayName: data.displayName,
                score: data.score,
                profileImage: data.profileImage,
                platform: data.platform,
                isFanClub: !!data.isFanClub,
                isSuperfan: !!data.isSuperfan,
                isDonor: !!data.isDonor
            }))
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Get progress stats.
     * Completion is based on common words only (rare are bonus).
     */
    getProgress() {
        return {
            found: this.foundCommon.size,
            total: this.commonWords.size,
            percentage: this.commonWords.size > 0
                ? Math.round((this.foundCommon.size / this.commonWords.size) * 100)
                : 0
        };
    }

    /**
     * Get per-letter stats for unfound COMMON words (used for hints/heatmap).
     * Only counts common words — rare words are bonus and not hinted.
     */
    getLetterStats() {
        const startsWith = {};
        const usesLetter = {};
        const cellUsage = {};       // cellIndex -> count of unfound common words using that cell
        const cellStartsWith = {};  // cellIndex -> count of unfound common words starting at that cell

        for (const [word, cells] of this.commonWords) {
            if (!this.foundCommon.has(word)) {
                const first = word[0];
                startsWith[first] = (startsWith[first] || 0) + 1;

                const seen = new Set();
                for (const ch of word) {
                    if (!seen.has(ch)) {
                        usesLetter[ch] = (usesLetter[ch] || 0) + 1;
                        seen.add(ch);
                    }
                }

                if (cells && cells.length > 0) {
                    // Per-cell usage count
                    for (const cellIdx of cells) {
                        cellUsage[cellIdx] = (cellUsage[cellIdx] || 0) + 1;
                    }
                    // Per-cell starts-with (first cell in path)
                    cellStartsWith[cells[0]] = (cellStartsWith[cells[0]] || 0) + 1;
                }
            }
        }

        return { startsWith, usesLetter, cellUsage, cellStartsWith };
    }

    /**
     * Compute cells that still have unfound COMMON words passing through them.
     * Rare words do not keep cells active.
     */
    /**
     * Pick which of a word's grid paths to show as the found-word flash.
     *
     * findAllWords records only the FIRST path its DFS happens to hit, and on a
     * typical 8x6 board ~40% of words can be spelled along more than one. When
     * that recorded path runs through cells the player can see are already dead,
     * the flash lights up letters they could not have been reading. Re-walk the
     * word and prefer the path with the most cells that were still active when
     * the guess arrived.
     *
     * Presentation only — the recorded path still drives commonWords and
     * getActiveCells(), so which tiles grey out is unchanged.
     */
    _bestLitPath(word, activeBefore) {
        const fallback = this.allWords.get(word);
        if (!fallback || !activeBefore || activeBefore.size === 0) return fallback;
        if (fallback.every(c => activeBefore.has(c))) return fallback;

        const rows = this.rows, cols = this.cols;
        const key = `${rows}x${cols}`;
        if (this._pathAdjKey !== key) {
            this._pathAdj = computeAdjacency(rows, cols);
            this._pathAdjKey = key;
        }
        const adj = this._pathAdj;
        const total = rows * cols;
        const visited = new Uint8Array(total);
        const path = [];
        let best = fallback;
        let bestLit = fallback.reduce((n, c) => n + (activeBefore.has(c) ? 1 : 0), 0);
        let budget = MAX_PATH_NODES;
        let done = false;

        const walk = (idx, pos, lit) => {
            if (done || --budget <= 0) return;
            if (this.grid[Math.floor(idx / cols)][idx % cols] !== word[pos]) return;
            visited[idx] = 1;
            path.push(idx);
            const litNow = lit + (activeBefore.has(idx) ? 1 : 0);
            if (pos === word.length - 1) {
                if (litNow > bestLit) {
                    bestLit = litNow;
                    best = path.slice();
                    if (bestLit === word.length) done = true; // fully lit — nothing can beat it
                }
            } else {
                for (const n of adj[idx]) {
                    if (!visited[n]) walk(n, pos + 1, litNow);
                    if (done) break;
                }
            }
            visited[idx] = 0;
            path.pop();
        };

        for (let i = 0; i < total && !done; i++) walk(i, 0, 0);
        return best;
    }

    getActiveCells() {
        const active = new Set();
        for (const [word, cells] of this.commonWords) {
            if (!this.foundCommon.has(word)) {
                for (const cell of cells) {
                    active.add(cell);
                }
            }
        }
        return active;
    }

    /**
     * Get the full serializable game state for Socket.IO broadcast.
     */
    getState() {
        const progress = this.getProgress();
        return {
            grid: this.grid,
            rows: this.rows,
            cols: this.cols,
            minWordLength: this.minWordLength,
            foundWords: [...this.foundWords.keys()],
            foundCount: this.foundCommon.size,
            totalCount: this.commonWords.size,
            commonCount: this.commonWords.size,
            rareCount: this.rareWords.size,
            hiddenCount: this.hiddenWords.size,
            threeLetterCount: this.threeLetterWords.size,
            foundCommonCount: this.foundCommon.size,
            foundRareCount: this.foundRare.size,
            foundHiddenCount: this.foundHidden.size,
            foundThreeLetterCount: this.foundThreeLetter.size,
            foundCommonWords: [...this.foundCommon.keys()],
            foundRareWords: [...this.foundRare.keys()],
            foundHiddenWords: [...this.foundHidden.keys()],
            foundThreeLetterWords: [...this.foundThreeLetter.keys()],
            recentGuessTags: this.getRecentActivityTags(),
            percentage: progress.percentage,
            topPlayers: this.getTopPlayers(),
            letterStats: this.getLetterStats(),
            activeCells: [...this.getActiveCells()],
            isComplete: this.foundCommon.size === this.commonWords.size,
            startTime: this.startTime,
            puzzleId: this.puzzleId,
            puzzleName: this.puzzleName,
            puzzleTheme: this.puzzleTheme,
            lastFoundWord: this.lastFoundWord || null
        };
    }

    /**
     * Get list of participants with their stats (for game history).
     */
    getParticipants() {
        return [...this.playerScores.entries()].map(([id, data]) => ({
            platformUserId: id,
            displayName: data.displayName,
            score: data.score,
            platform: data.platform
        }));
    }

    /**
     * Save game state to JSON-serializable object (for database persistence).
     */
    saveState({ exact = false } = {}) {
        return {
            puzzleGenerationId: this.puzzleGenerationId || null,
            ...(exact ? { exactState: 1, exactPlayerScores: [...this.playerScores], wordMaps: Object.fromEntries(['allWords', 'commonWords', 'rareWords', 'hiddenWords', 'threeLetterWords'].map(key => [key, [...this[key]]])), foundMaps: Object.fromEntries(['foundCommon', 'foundRare', 'foundHidden', 'foundThreeLetter'].map(key => [key, [...this[key]]])) } : {}),
            grid: this.grid,
            rows: this.rows,
            cols: this.cols,
            minWordLength: this.minWordLength,
            puzzleId: this.puzzleId,
            puzzleName: this.puzzleName,
            puzzleTheme: this.puzzleTheme,
            foundWords: [...this.foundWords.entries()].map(([word, info]) => ({
                word,
                platform: info.platform,
                platformUserId: info.platformUserId,
                username: info.username,
                displayName: info.displayName,
                timestamp: info.timestamp,
                isRare: info.isRare || false,
                isHidden: info.isHidden || false,
                isThreeLetter: info.isThreeLetter || false
            })),
            playerScores: [...this.playerScores.entries()].map(([id, data]) => ({
                platformUserId: id,
                score: data.score,
                displayName: data.displayName,
                profileImage: data.profileImage,
                platform: data.platform
            })),
            recentGuessTags: this.recentGuessTags.map(tag => ({
                result: tag.result,
                word: tag.word,
                timestamp: tag.timestamp
            })),
            startTime: this.startTime,
            timestamp: Date.now()
        };
    }

    /**
     * Restore game from a saved state. Re-solves the grid to rebuild allWords.
     */
    restoreFrom(state, trie, targetSet, frequencyMap, { trusted = false } = {}) {
        this.puzzleGenerationId = state.puzzleGenerationId || null;
        this.grid = state.grid;
        this.rows = state.rows;
        this.cols = state.cols;
        this.minWordLength = state.minWordLength;
        this.startTime = state.startTime || Date.now();
        this.puzzleId = state.puzzleId ?? null;
        this.puzzleName = state.puzzleName || null;
        this.puzzleTheme = state.puzzleTheme || null;

        // Re-solve to rebuild allWords map
        this.allWords = findAllWords(this.grid, this.rows, this.cols, trie, this.minWordLength);

        // Split into common/rare (caps by rarity using frequency data)
        this.splitWords(targetSet, frequencyMap);

        if (trusted && state.exactState === 1 && state.wordMaps) {
            for (const key of ['allWords', 'commonWords', 'rareWords', 'hiddenWords', 'threeLetterWords']) this[key] = new Map(state.wordMaps[key]);
        }

        // Restore found words
        this.foundWords = new Map();
        this.foundCommon = new Map();
        this.foundRare = new Map();
        this.foundHidden = new Map();
        this.foundThreeLetter = new Map();

        if (Array.isArray(state.foundWords)) {
            for (const entry of state.foundWords) {
                if (typeof entry === 'object' && entry.word) {
                    // New format: array of objects
                    const finderInfo = {
                        platform: entry.platform,
                        platformUserId: entry.platformUserId,
                        username: entry.username,
                        displayName: entry.displayName,
                        timestamp: entry.timestamp,
                        isRare: entry.isRare || false,
                        isHidden: entry.isHidden || false,
                        isThreeLetter: entry.isThreeLetter || false
                    };
                    this.foundWords.set(entry.word, finderInfo);

                    // Restore into appropriate tracking category
                    if (this.threeLetterWords.has(entry.word)) {
                        this.foundThreeLetter.set(entry.word, finderInfo);
                    } else if (this.hiddenWords.has(entry.word)) {
                        this.foundHidden.set(entry.word, finderInfo);
                    } else if (this.rareWords.has(entry.word)) {
                        this.foundRare.set(entry.word, finderInfo);
                    } else if (this.commonWords.has(entry.word)) {
                        this.foundCommon.set(entry.word, finderInfo);
                    }
                } else if (typeof entry === 'string') {
                    // Legacy format: array of word strings
                    const finderInfo = {
                        platform: 'unknown',
                        platformUserId: 'unknown',
                        username: 'unknown',
                        displayName: 'unknown',
                        timestamp: 0,
                        isRare: false,
                        isHidden: false,
                        isThreeLetter: false
                    };
                    this.foundWords.set(entry, finderInfo);

                    if (this.threeLetterWords.has(entry)) {
                        this.foundThreeLetter.set(entry, finderInfo);
                    } else if (this.hiddenWords.has(entry)) {
                        this.foundHidden.set(entry, finderInfo);
                    } else if (this.rareWords.has(entry)) {
                        this.foundRare.set(entry, finderInfo);
                    } else if (this.commonWords.has(entry)) {
                        this.foundCommon.set(entry, finderInfo);
                    }
                }
            }
        }

        if (trusted && state.exactState === 1 && state.foundMaps) {
            for (const key of ['foundCommon', 'foundRare', 'foundHidden', 'foundThreeLetter']) this[key] = new Map(state.foundMaps[key]);
        }

        // Restore player scores
        this.playerScores = new Map();
        if (Array.isArray(state.playerScores)) {
            for (const entry of state.playerScores) {
                if (Array.isArray(entry)) {
                    // Legacy format: [[key, value], ...]
                    const [id, data] = entry;
                    const score = typeof data === 'number' ? data : data.score;
                    this.playerScores.set(id, {
                        score,
                        displayName: typeof data === 'object' ? data.displayName || id : id,
                        profileImage: typeof data === 'object' ? data.profileImage : null,
                        platform: typeof data === 'object' ? data.platform : 'unknown'
                    });
                } else if (typeof entry === 'object' && entry.platformUserId) {
                    // New format: array of objects
                    this.playerScores.set(entry.platformUserId, {
                        score: entry.score,
                        displayName: entry.displayName,
                        profileImage: entry.profileImage,
                        platform: entry.platform
                    });
                }
            }
        }

        this.incorrectGuesses = [];
        if (trusted && state.exactState === 1 && Array.isArray(state.exactPlayerScores)) this.playerScores = new Map(state.exactPlayerScores);

        this.recentGuessTags = Array.isArray(state.recentGuessTags)
            ? state.recentGuessTags
                .filter(tag => tag && tag.word && (tag.result === 'incorrect' || tag.result === 'already_found'))
                .slice(-12)
                .map(tag => ({
                    result: tag.result,
                    word: String(tag.word),
                    timestamp: Number(tag.timestamp) || 0
                }))
            : [];

        console.log(`[Game] Restored: ${this.rows}x${this.cols} grid, ${this.foundWords.size}/${this.allWords.size} words found (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden)`);
    }
}

module.exports = { Game };
