// game.js - Server-side Game class (identity-aware, CommonJS)

const { findAllWords } = require('./solver');

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
// Based on analysis of sproutle.app's word classification (73% match, 15% obscure leak).
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

// ─── Letter Rarity (English frequency-based, 8-tier) ────────────────
const LETTER_RARITY = {
  e: 0, t: 0,
  a: 0, o: 0, i: 0, n: 0, s: 0, h: 0, r: 0,
  d: 15, l: 15,
  c: 30, u: 30, m: 30, w: 30, f: 30,
  g: 60, y: 60, p: 60,
  b: 105, v: 105, k: 105,
  j: 180, x: 180,
  q: 300, z: 300
};

const LETTER_TIER_NAMES = {
  0: 'common', 15: 'uncommon', 30: 'rare', 60: 'epic', 105: 'legendary', 180: 'mythic', 300: 'unique'
};

function getLetterRarityBonus(word) {
  let bonus = 0;
  const tierCounts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, unique: 0 };
  for (const ch of word.toLowerCase()) {
    const b = LETTER_RARITY[ch];
    if (b === undefined) continue;
    bonus += b;
    tierCounts[LETTER_TIER_NAMES[b]]++;
  }
  return { bonus, tierCounts };
}

// Max common (required) words by smallest grid dimension
// Caps playability — excess common words demoted to rare
const COMMON_CAP_BY_SIZE = {
    3: 50, 4: 100, 5: 150, 6: 200, 7: 300, 8: 400,
    9: 500, 10: 500, 11: 500, 12: 500, 13: 500, 14: 500,
    15: 500, 16: 500, 17: 500, 18: 500, 19: 500, 20: 500
};

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

        // Ring expansion state
        this.rings = [];                    // Array of cell index arrays per ring
        this.currentRing = 0;               // Current ring level (0 = center)
        this.revealedCells = new Set();     // All revealed cell indices
        this.ringPhase = 'initial';         // 'initial' | 'ring' | 'complete'
        this.ringCommonWords = new Map();   // Common words playable in current revealed area (informational)
        this.currentRingCells = new Set(); // Cells in the most recently revealed ring tier
        this.ringUsedCells = new Set();    // Cells touched by any found word since last ring advance
        this.replacedCells = new Set();    // Cells whose letter was replaced at gen time (visually distinct)

        // Final ring refresh — pre-computed at init, applied when last ring is revealed
        this.finalRingRefreshMap = new Map();    // cellIdx -> newLetter (pre-computed replacements)
        this.finalRingRefreshedCells = new Set(); // cells replaced when final ring fired (persistent)
        this.finalRingNewCommonCount = 0;          // extra common words unlocked by final ring refresh
        this._finalRingNewWords = new Map();      // new allWords entries from refresh (pre-computed)
        this._finalRingNewCommonWords = new Map(); // new commonWords entries from refresh (pre-computed)
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
     */
    initialize(rows, cols, minWordLength, trie, targetSet, { minCommon = 15, maxCommon = 500, frequencyMap = null } = {}) {
        this.rows = rows;
        this.cols = cols;
        this.minWordLength = minWordLength;

        const totalCells = rows * cols;
        const minWords = MIN_WORDS_BY_SIZE[Math.min(rows, cols)] || 1;
        let attempts = 0;
        const maxAttempts = 500;
        const REFINE_BUDGET = 100; // extra attempts to find fewer rare words after first valid grid
        let validFound = 0;        // how many valid grids we've seen
        let bestRareCount = Infinity;
        let bestState = null;      // { grid, allWords, commonWords, rareWords, threeLetterWords }

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

        // Fix stranded ring cells (replace letters not reachable in their ring's revealed area)
        this._computeRings();
        this._fixRingStrandedCells(trie, frequencyMap);
        this.splitWords(null, frequencyMap); // re-split after any letter replacements

        // Pre-compute final ring letter refresh (uses resolved grid state)
        this._computeFinalRingRefresh(trie, frequencyMap);

        // Initialize ring expansion
        this._initRings();

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

        // Fix stranded ring cells
        this._computeRings();
        this._fixRingStrandedCells(trie, frequencyMap);
        this.splitWords(null, frequencyMap);

        // Pre-compute final ring letter refresh
        this._computeFinalRingRefresh(trie, frequencyMap);

        // Initialize ring expansion
        this._initRings();

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

        const minWords = MIN_WORDS_BY_SIZE[Math.min(rows, cols)] || 20;
        const targetWord = word.toLowerCase();
        let attempts = 0;
        const maxAttempts = 500;
        const REFINE_BUDGET = 100;
        let validFound = 0;
        let bestRareCount = Infinity;
        let bestState = null;

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

            // Verify target word findable, full board, enough words, common count in range
            const valid = this.allWords.has(targetWord) && fullBoard && this.allWords.size >= minWords &&
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
                    console.warn(`[Game] Could not build ideal grid around "${targetWord}" after ${maxAttempts} attempts. Using best (${this.allWords.size} words, ${this.commonWords.size} common, target ${this.allWords.has(targetWord) ? 'found' : 'MISSING'}).`);
                }
                break;
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
        this.puzzleId = 'daily-' + new Date().toISOString().slice(0, 10);
        this.puzzleName = 'Daily: ' + targetWord.toUpperCase();
        this.puzzleTheme = 'Daily';

        // Fix stranded ring cells
        this._computeRings();
        this._fixRingStrandedCells(trie, frequencyMap);
        this.splitWords(null, frequencyMap);

        // Pre-compute final ring letter refresh
        this._computeFinalRingRefresh(trie, frequencyMap);

        // Initialize ring expansion
        this._initRings();

        console.log(`[Game] Daily grid around "${targetWord}": ${rows}x${cols}, ${this.allWords.size} words (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden) (${attempts} attempts, ${validFound} valid)`);
    }

    /**
     * Compute concentric rectangular rings expanding from the center 2x2.
     * Ring 0 = center 2x2 (4 cells).
     * Ring N = cells at exactly N steps from the center rectangle, clipped to grid bounds.
     */
    _computeRings() {
        this.rings = [];
        const centerR = Math.floor(this.rows / 2) - 1;
        const centerC = Math.floor(this.cols / 2) - 1;

        // Ring 0: center 2x2
        const ring0 = [];
        for (let r = centerR; r <= centerR + 1; r++) {
            for (let c = centerC; c <= centerC + 1; c++) {
                if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                    ring0.push(r * this.cols + c);
                }
            }
        }
        this.rings.push(ring0);

        // Expand outward until all cells are covered
        const allCovered = new Set(ring0);
        let expand = 1;
        const totalCells = this.rows * this.cols;

        while (allCovered.size < totalCells) {
            const ring = [];
            const top = centerR - expand;
            const bottom = centerR + 1 + expand;
            const left = centerC - expand;
            const right = centerC + 1 + expand;

            for (let r = top; r <= bottom; r++) {
                for (let c = left; c <= right; c++) {
                    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                        const idx = r * this.cols + c;
                        if (!allCovered.has(idx)) {
                            ring.push(idx);
                            allCovered.add(idx);
                        }
                    }
                }
            }

            if (ring.length > 0) {
                this.rings.push(ring);
            }
            expand++;

            // Safety: prevent infinite loop
            if (expand > Math.max(this.rows, this.cols)) break;
        }
    }

    /**
     * Pre-compute the final ring letter refresh at game initialization.
     * Finds all cells not covered by any word across the full grid, assigns
     * deterministic replacement letters, and solves the modified grid to count
     * how many new common words those replacements add.
     * Called once after splitWords() during initialize/initializeFromPuzzle/initializeAroundWord.
     * The actual application is deferred until _advanceRing reaches the last ring.
     */
    _computeFinalRingRefresh(trie, frequencyMap) {
        this.finalRingRefreshMap = new Map();
        this.finalRingNewCommonCount = 0;
        this._finalRingNewWords = new Map();
        this._finalRingNewCommonWords = new Map();

        // Find every cell not touched by any word in the full grid
        const covered = new Set();
        for (const [, cells] of this.allWords) {
            for (const c of cells) covered.add(c);
        }
        const stranded = [];
        for (let i = 0; i < this.rows * this.cols; i++) {
            if (!covered.has(i)) stranded.push(i);
        }
        if (stranded.length === 0) return;

        // Assign random replacement letters (fixed at init so the count is stable)
        for (const cell of stranded) {
            this.finalRingRefreshMap.set(cell, randomLetter());
        }

        // Apply to a temp grid and re-solve to find new words
        const tempGrid = this.grid.map(row => [...row]);
        for (const [cell, letter] of this.finalRingRefreshMap) {
            tempGrid[Math.floor(cell / this.cols)][cell % this.cols] = letter;
        }
        const tempAllWords = findAllWords(tempGrid, this.rows, this.cols, trie, this.minWordLength);
        const freq = frequencyMap || new Map();
        for (const [word, cells] of tempAllWords) {
            if (!this.allWords.has(word)) {
                this._finalRingNewWords.set(word, cells);
                if (word.length >= 4 && freq.has(word) && freq.get(word) >= ZIPF_COMMON_THRESHOLD) {
                    this._finalRingNewCommonWords.set(word, cells);
                    this.finalRingNewCommonCount++;
                }
            }
        }

        console.log(`[Game] Final ring refresh pre-computed: ${this.finalRingRefreshMap.size} stranded cells → ${this.finalRingNewCommonCount} new common words`);
    }

    /**
     * Initialize ring state: reveal center 2x2, set phase to 'initial'.
     */
    _initRings() {
        this._computeRings();
        this.currentRing = 0;
        this.revealedCells = new Set(this.rings[0]);
        this.currentRingCells = new Set(this.rings[0]);
        this.ringUsedCells = new Set();
        this.ringPhase = this.rings.length <= 1 ? 'complete' : 'initial';
        this._recomputeRingCommonWords();

        console.log(`[Game] Rings: ${this.rings.length} rings computed. Center: ${this.rings[0].length} cells. Phase: ${this.ringPhase}`);
    }

    /**
     * After grid generation, ensure every cell in each ring is reachable by at least one
     * word fully within that ring's revealed area. Stranded cells get a new random letter
     * (up to 3 passes per ring). Only replaces cells that are truly not covered —
     * replacement may affect cross-ring words, so we re-solve the full grid after each pass.
     * Populates this.replacedCells with the indices of all changed cells.
     * Must be called after this.rings is computed and before _initRings().
     * Caller must call splitWords() after this returns.
     */
    _fixRingStrandedCells(trie, frequencyMap) {
        this.replacedCells = new Set();
        const simRevealed = new Set(this.rings[0]);

        for (let ringIdx = 1; ringIdx < this.rings.length; ringIdx++) {
            const ring = this.rings[ringIdx];
            for (const cell of ring) simRevealed.add(cell);

            // Up to 3 passes: replace stranded letters then re-solve
            for (let pass = 0; pass < 3; pass++) {
                // Find which cells in this ring are covered by a fully-revealed word
                const covered = new Set();
                for (const [, cells] of this.allWords) {
                    if (cells.every(c => simRevealed.has(c))) {
                        for (const c of cells) covered.add(c);
                    }
                }

                const stranded = ring.filter(cell => !covered.has(cell));
                if (stranded.length === 0) break; // ring fully covered

                // Replace each stranded cell's letter with a new random one
                for (const cell of stranded) {
                    const r = Math.floor(cell / this.cols);
                    const c = cell % this.cols;
                    this.grid[r][c] = randomLetter();
                    this.replacedCells.add(cell);
                }

                // Re-solve the full grid with the new letters
                this.allWords = findAllWords(this.grid, this.rows, this.cols, trie, this.minWordLength);
            }
        }

        if (this.replacedCells.size > 0) {
            console.log(`[Game] Replaced ${this.replacedCells.size} stranded ring cells: [${[...this.replacedCells].join(',')}]`);
        }
    }

    /**
     * Find all unfound common words whose entire path lies within revealed cells.
     */
    _recomputeRingCommonWords() {
        this.ringCommonWords = new Map();
        for (const [word, cells] of this.commonWords) {
            if (!this.foundCommon.has(word) && cells.every(c => this.revealedCells.has(c))) {
                this.ringCommonWords.set(word, cells);
            }
        }
    }

    /**
     * Check if a found word should advance the ring.
     * - 'initial' phase: any 4+ letter word in revealed cells → advance
     * - 'ring' phase: all common words in revealed area found → advance
     * Returns { advanced, newCells } or null if no advance.
     */
    _checkRingAdvance(foundWord) {
        if (this.ringPhase === 'complete') return null;

        if (this.ringPhase === 'initial') {
            // Need any 4+ letter word (not 3-letter) found in the revealed area
            if (foundWord.length >= 4) {
                return this._advanceRing();
            }
            return null;
        }

        if (this.ringPhase === 'ring') {
            // Check if all common words in current revealed area are found
            // (ringCommonWords was already updated before this call via _recomputeRingCommonWords)
            if (this.ringCommonWords.size === 0) {
                return this._advanceRing();
            }
            return null;
        }

        return null;
    }

    /**
     * Advance to the next ring: reveal its cells, recompute available words.
     * Resets per-ring cell tracking so the new ring starts fully "active".
     * Auto-advances if the new ring area has no unfound common words.
     */
    _advanceRing() {
        const result = { advanced: true, newCells: [], ringsAdvanced: 0, refreshedLetters: {}, isFinalRing: false };

        while (this.currentRing + 1 < this.rings.length) {
            this.currentRing++;
            const newRing = this.rings[this.currentRing];
            for (const cell of newRing) {
                this.revealedCells.add(cell);
                result.newCells.push(cell);
            }
            result.ringsAdvanced++;

            // Reset per-ring cell tracking — all new ring cells start as "active" (untouched)
            this.ringUsedCells = new Set();
            this.currentRingCells = new Set(newRing);

            // Final ring: apply pre-computed letter refresh across ALL uncovered cells
            if (this.currentRing === this.rings.length - 1 && this.finalRingRefreshMap.size > 0) {
                // Apply new letters to the actual grid
                for (const [cell, letter] of this.finalRingRefreshMap) {
                    this.grid[Math.floor(cell / this.cols)][cell % this.cols] = letter;
                }
                // Merge new words into allWords and commonWords
                for (const [word, cells] of this._finalRingNewWords) {
                    this.allWords.set(word, cells);
                }
                for (const [word, cells] of this._finalRingNewCommonWords) {
                    this.commonWords.set(word, cells);
                }
                // Track which cells were refreshed (persistent — used for lighter-blue display)
                this.finalRingRefreshedCells = new Set(this.finalRingRefreshMap.keys());
                result.refreshedLetters = Object.fromEntries(this.finalRingRefreshMap);
                result.isFinalRing = true;
                // Clear pre-computed data (already applied)
                this.finalRingNewCommonCount = 0;
                this._finalRingNewWords = new Map();
                this._finalRingNewCommonWords = new Map();
                this.finalRingRefreshMap = new Map();
                console.log(`[Game] Final ring refresh applied: ${this.finalRingRefreshedCells.size} cells replaced`);
            }

            // Recompute what common words are now playable (includes any new ones from refresh)
            this._recomputeRingCommonWords();

            this.ringPhase = 'ring';

            // If there are unfound common words in the new revealed area, stop here
            if (this.ringCommonWords.size > 0) break;

            // If no unfound common words, auto-advance to next ring
            console.log(`[Game] Ring ${this.currentRing} has no unfound common words, auto-advancing...`);
        }

        // Check if we've revealed everything
        if (this.currentRing >= this.rings.length - 1) {
            // All rings revealed — check if any common words remain
            this._recomputeRingCommonWords();
            if (this.ringCommonWords.size === 0) {
                this.ringPhase = 'complete';
            }
        }

        console.log(`[Game] Ring advanced to ${this.currentRing}/${this.rings.length - 1}, revealed ${result.newCells.length} new cells, phase: ${this.ringPhase}, ring common remaining: ${this.ringCommonWords.size}`);
        return result;
    }

    /**
     * Process a guess from a player.
     * Uses platformUserId as the unique key for player scores (identity-aware).
     * Common words score +1, rare words score +3.
     * Completion is based on common words only (rare are bonus).
     */
    guess(word, platform, platformUserId, username, displayName, profileImage) {
        const normalized = word.trim().toLowerCase();

        // Update existing player's profileImage/displayName on every attempt
        // so PFPs get backfilled even when guesses are wrong
        if (profileImage && platformUserId) {
            const existing = this.playerScores.get(platformUserId);
            if (existing && !existing.profileImage) {
                existing.profileImage = profileImage;
            }
            if (existing && displayName && displayName !== existing.displayName) {
                existing.displayName = displayName;
            }
        }

        if (!normalized || normalized.length < this.minWordLength) {
            return { result: 'too_short', word: normalized };
        }

        if (this.foundWords.has(normalized)) {
            this._rememberGuessTag('already_found', normalized);
            return { result: 'already_found', word: normalized };
        }

        if (this.allWords.has(normalized)) {
            // Ring mechanic: reject words that use unrevealed cells
            const cells = this.allWords.get(normalized);
            if (this.revealedCells.size > 0 && !cells.every(c => this.revealedCells.has(c))) {
                return { result: 'incorrect', word: normalized };
            }

            const isThreeLetter = this.threeLetterWords.has(normalized);
            const isRare = !isThreeLetter && this.rareWords.has(normalized);
            const isHidden = !isThreeLetter && this.hiddenWords.has(normalized);
            const baseScore = isThreeLetter ? 100 : (isHidden ? 1500 : (isRare ? 1000 : 500));
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
                platform: platform
            };
            // Sanitize double-URL profile images (e.g. cdn.discordapp.com/.../https://cdn.discordapp.com/...)
            let cleanPfp = profileImage || prev.profileImage;
            if (cleanPfp) {
                const dblIdx = cleanPfp.indexOf('https://', 8);
                if (dblIdx > 0) cleanPfp = cleanPfp.substring(dblIdx);
            }
            // Also sanitize prev if it was stored before the fix
            if (!profileImage && prev.profileImage) {
                const dblIdx2 = prev.profileImage.indexOf('https://', 8);
                if (dblIdx2 > 0) prev.profileImage = prev.profileImage.substring(dblIdx2);
            }
            this.playerScores.set(platformUserId, {
                score: prev.score + scoreValue,
                displayName: displayName || username || prev.displayName,
                profileImage: cleanPfp,
                platform: platform || prev.platform
            });

            // Ring mechanic: track cells used by this word, then check for ring advancement
            let ringAdvance = null;
            if (this.rings.length > 0) {
                // Mark every cell this word touches as used
                for (const c of cells) {
                    this.ringUsedCells.add(c);
                }
                this._recomputeRingCommonWords();
                ringAdvance = this._checkRingAdvance(normalized);
            }

            const activeCells = this.getActiveCells();

            const totalCommon = this.commonWords.size + this.finalRingNewCommonCount;
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
                totalCount: totalCommon,
                isComplete: this.foundCommon.size === this.commonWords.size && this.finalRingNewCommonCount === 0,
                topPlayers: this.getTopPlayers(),
                activeCells: [...activeCells],
                // Ring state
                ringAdvanced: ringAdvance ? true : false,
                newRevealedCells: ringAdvance ? ringAdvance.newCells : [],
                refreshedLetters: ringAdvance ? (ringAdvance.refreshedLetters || {}) : {},
                isFinalRing: ringAdvance ? (ringAdvance.isFinalRing || false) : false,
                finalRingRefreshedCells: [...this.finalRingRefreshedCells],
                currentRing: this.currentRing,
                totalRings: this.rings.length,
                ringPhase: this.ringPhase,
                revealedCells: [...this.revealedCells],
                ringCommonTotal: this._getRingCommonTotal(),
                ringCommonFound: this._getRingCommonFound()
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
     * Count total common words playable in current revealed area.
     */
    _getRingCommonTotal() {
        let count = 0;
        for (const [word, cells] of this.commonWords) {
            if (cells.every(c => this.revealedCells.has(c))) count++;
        }
        return count;
    }

    /**
     * Count found common words in current revealed area.
     */
    _getRingCommonFound() {
        let count = 0;
        for (const [word, cells] of this.commonWords) {
            if (this.foundCommon.has(word) && cells.every(c => this.revealedCells.has(c))) count++;
        }
        return count;
    }

    /**
     * Get the top 3 players sorted by score.
     */
    getTopPlayers() {
        return [...this.playerScores.entries()]
            .map(([id, data]) => {
                // Sanitize double-URL PFPs on output
                let pfp = data.profileImage;
                if (pfp) { const d = pfp.indexOf('https://', 8); if (d > 0) pfp = pfp.substring(d); }
                return {
                platformUserId: id,
                displayName: data.displayName,
                score: data.score,
                profileImage: pfp,
                platform: data.platform
            }; })
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Get progress stats.
     * Completion is based on common words only (rare are bonus).
     * Ring-aware: shows progress within current revealed area.
     */
    getProgress() {
        const ringTotal = this._getRingCommonTotal();
        const ringFound = this._getRingCommonFound();
        return {
            found: this.foundCommon.size,
            total: this.commonWords.size,
            ringFound,
            ringTotal,
            percentage: this.commonWords.size > 0
                ? Math.round((this.foundCommon.size / this.commonWords.size) * 100)
                : 0,
            ringPercentage: ringTotal > 0
                ? Math.round((ringFound / ringTotal) * 100)
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
                // Only count words whose full path is in revealed cells
                if (this.revealedCells.size > 0 && !cells.every(c => this.revealedCells.has(c))) continue;

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
     * Compute cells in the current ring that have not yet been touched by any found word.
     * These are the cells the player must still use to advance to the next ring.
     * In 'initial' phase, returns all revealed center cells not yet used.
     */
    getActiveCells() {
        const active = new Set();
        for (const cell of this.currentRingCells) {
            if (!this.ringUsedCells.has(cell)) {
                active.add(cell);
            }
        }
        return active;
    }

    /**
     * Get the full serializable game state for Socket.IO broadcast.
     */
    getState() {
        const progress = this.getProgress();
        const totalCommon = this.commonWords.size + this.finalRingNewCommonCount;
        return {
            grid: this.grid,
            rows: this.rows,
            cols: this.cols,
            minWordLength: this.minWordLength,
            foundWords: [...this.foundWords.keys()],
            foundCount: this.foundCommon.size,
            totalCount: totalCommon,
            commonCount: totalCommon,
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
            isComplete: this.foundCommon.size === this.commonWords.size && this.finalRingNewCommonCount === 0,
            startTime: this.startTime,
            puzzleId: this.puzzleId,
            puzzleName: this.puzzleName,
            puzzleTheme: this.puzzleTheme,
            lastFoundWord: this.lastFoundWord || null,
            // Ring expansion state
            revealedCells: [...this.revealedCells],
            currentRing: this.currentRing,
            totalRings: this.rings.length,
            ringPhase: this.ringPhase,
            currentRingCells: [...this.currentRingCells],
            ringUsedCells: [...this.ringUsedCells],
            replacedCells: [...this.replacedCells],
            finalRingRefreshedCells: [...this.finalRingRefreshedCells],
            ringCommonTotal: this._getRingCommonTotal(),
            ringCommonFound: this._getRingCommonFound()
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
    saveState() {
        return {
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
            timestamp: Date.now(),
            // Ring state
            currentRing: this.currentRing,
            revealedCells: [...this.revealedCells],
            ringPhase: this.ringPhase,
            currentRingCells: [...this.currentRingCells],
            ringUsedCells: [...this.ringUsedCells],
            replacedCells: [...this.replacedCells],
            // Final ring refresh state
            finalRingRefreshMap: [...this.finalRingRefreshMap.entries()],
            finalRingRefreshedCells: [...this.finalRingRefreshedCells],
            finalRingNewCommonCount: this.finalRingNewCommonCount,
            finalRingNewWords: [...this._finalRingNewWords.entries()],
            finalRingNewCommonWords: [...this._finalRingNewCommonWords.entries()]
        };
    }

    /**
     * Restore game from a saved state. Re-solves the grid to rebuild allWords.
     */
    restoreFrom(state, trie, targetSet, frequencyMap) {
        this.grid = state.grid;
        this.rows = state.rows;
        this.cols = state.cols;
        this.minWordLength = state.minWordLength;
        this.startTime = state.startTime || Date.now();
        this.puzzleId = state.puzzleId || null;
        this.puzzleName = state.puzzleName || null;
        this.puzzleTheme = state.puzzleTheme || null;

        // Re-solve to rebuild allWords map
        this.allWords = findAllWords(this.grid, this.rows, this.cols, trie, this.minWordLength);

        // Split into common/rare (caps by rarity using frequency data)
        this.splitWords(targetSet, frequencyMap);

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

        // Restore ring state
        this._computeRings();
        if (state.currentRing !== undefined && state.revealedCells) {
            this.currentRing = state.currentRing;
            this.revealedCells = new Set(state.revealedCells);
            this.ringPhase = state.ringPhase || 'ring';

            // Restore currentRingCells — use saved value or derive from current ring index
            if (state.currentRingCells) {
                this.currentRingCells = new Set(state.currentRingCells);
            } else {
                this.currentRingCells = new Set(this.rings[this.currentRing] || []);
            }

            // Restore ringUsedCells — use saved value or reconstruct from found words
            if (state.ringUsedCells) {
                this.ringUsedCells = new Set(state.ringUsedCells);
            } else {
                // Reconstruct: find which current ring cells were touched by any found word
                this.ringUsedCells = new Set();
                for (const [word] of this.foundWords) {
                    const cells = this.allWords.get(word);
                    if (cells) {
                        for (const c of cells) {
                            if (this.currentRingCells.has(c)) {
                                this.ringUsedCells.add(c);
                            }
                        }
                    }
                }
            }
        } else {
            // Legacy save without ring data — reveal all cells
            this.currentRing = this.rings.length - 1;
            this.revealedCells = new Set();
            for (let i = 0; i < this.rows * this.cols; i++) this.revealedCells.add(i);
            this.ringPhase = 'complete';
            this.currentRingCells = new Set(this.rings[this.currentRing] || []);
            this.ringUsedCells = new Set([...this.currentRingCells]); // all used (complete)
        }
        this.replacedCells = state.replacedCells ? new Set(state.replacedCells) : new Set();
        // Final ring refresh state
        this.finalRingRefreshMap = state.finalRingRefreshMap ? new Map(state.finalRingRefreshMap) : new Map();
        this.finalRingRefreshedCells = state.finalRingRefreshedCells ? new Set(state.finalRingRefreshedCells) : new Set();
        this.finalRingNewCommonCount = state.finalRingNewCommonCount || 0;
        this._finalRingNewWords = state.finalRingNewWords ? new Map(state.finalRingNewWords) : new Map();
        this._finalRingNewCommonWords = state.finalRingNewCommonWords ? new Map(state.finalRingNewCommonWords) : new Map();
        this._recomputeRingCommonWords();

        console.log(`[Game] Restored: ${this.rows}x${this.cols} grid, ${this.foundWords.size}/${this.allWords.size} words found (${this.commonWords.size} common, ${this.rareWords.size} rare, ${this.hiddenWords.size} hidden), ring ${this.currentRing}/${this.rings.length - 1}, phase: ${this.ringPhase}`);
    }
}

module.exports = { Game };
