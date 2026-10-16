// game.js - Grid generation, game state management

import { findAllWords } from './solver.js';

const LETTER_WEIGHTS = {
    a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2,
    i: 9, j: 1, k: 1, l: 4, m: 2, n: 6, o: 8, p: 2,
    q: 1, r: 6, s: 6, t: 6, u: 4, v: 2, w: 2, x: 1,
    y: 2, z: 1
};

const MIN_WORDS_BY_SIZE = {
    2: 1, 3: 3, 4: 10, 5: 15, 6: 20, 7: 25, 8: 25, 9: 25, 10: 25
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

export class Game {
    constructor() {
        this.grid = [];
        this.rows = 4;
        this.cols = 4;
        this.minWordLength = 3;
        this.allWords = new Map();       // word -> Array<cellIndex> (single path)
        this.foundWords = new Set();
        this.incorrectGuesses = [];      // { word, timestamp }
        this.activeCells = new Set();
        this.playerScores = new Map();   // username -> count of words found
        this.onGuessResult = null;       // callback
        // Server-provided stats (common-only) — used for display
        this.serverLetterStats = null;
        this.serverActiveCells = null;
        this.serverCommonCount = 0;
        this.serverFoundCommonCount = 0;
    }

    initialize(rows, cols, minWordLength, trie) {
        this.rows = rows;
        this.cols = cols;
        this.minWordLength = minWordLength;

        const minWords = MIN_WORDS_BY_SIZE[Math.min(rows, cols)] || 1;
        let attempts = 0;
        const maxAttempts = 50;

        do {
            this.grid = generateGrid(rows, cols);
            this.allWords = findAllWords(this.grid, rows, cols, trie, minWordLength);
            attempts++;
            if (attempts >= maxAttempts) {
                console.warn(`Could not generate grid with ${minWords}+ words after ${maxAttempts} attempts. Using best result.`);
                break;
            }
        } while (this.allWords.size < minWords);

        this.foundWords = new Set();
        this.incorrectGuesses = [];
        this.playerScores = new Map();
        this.activeCells = this.computeActiveCells();

        console.log(`Game initialized: ${rows}x${cols} grid, ${this.allWords.size} words to find`);
    }

    guess(word, username = 'local', profileImage = null) {
        // Take only first word; ignore @mentions
        const firstWord = word.trim().split(/\s+/)[0];
        if (firstWord.startsWith('@')) return { result: 'too_short', word: firstWord };
        const normalized = firstWord.toLowerCase();

        if (!normalized || normalized.length < this.minWordLength) {
            return { result: 'too_short', word: normalized };
        }

        if (this.foundWords.has(normalized)) {
            return { result: 'already_found', word: normalized };
        }

        if (this.allWords.has(normalized)) {
            this.foundWords.add(normalized);

            // Track player score and profile image
            const prev = this.playerScores.get(username) || { score: 0, profileImage: null };
            const prevScore = typeof prev === 'number' ? prev : prev.score;
            const prevImage = typeof prev === 'number' ? null : prev.profileImage;
            this.playerScores.set(username, {
                score: prevScore + 1,
                profileImage: profileImage || prevImage
            });

            // Use server-provided active cells if available
            const prevActive = this.activeCells;
            this.activeCells = this.serverActiveCells
                ? new Set(this.serverActiveCells)
                : this.computeActiveCells();
            const newlyGreyed = [...prevActive].filter(c => !this.activeCells.has(c));

            const result = {
                result: 'correct',
                word: normalized,
                username: username,
                cells: this.allWords.get(normalized),
                newlyGreyedCells: newlyGreyed,
                isThreeLetter: normalized.length === 3,
                foundCount: this.serverFoundCommonCount,
                totalCount: this.serverCommonCount,
                isComplete: this.serverCommonCount > 0 && this.serverFoundCommonCount >= this.serverCommonCount,
                topPlayer: this.getTopPlayer(),
                topPlayers: this.getTopPlayers()
            };
            return result;
        }

        const entry = { word: normalized, timestamp: Date.now() };
        this.incorrectGuesses.push(entry);
        // Keep only last 10
        if (this.incorrectGuesses.length > 10) {
            this.incorrectGuesses.shift();
        }

        return { result: 'incorrect', word: normalized };
    }

    // Store server-provided stats (common-only)
    setServerStats(serverState) {
        if (serverState.letterStats) {
            this.serverLetterStats = serverState.letterStats;
        }
        if (serverState.activeCells) {
            this.serverActiveCells = serverState.activeCells;
            this.activeCells = new Set(serverState.activeCells);
        }
        if (typeof serverState.commonCount === 'number') {
            this.serverCommonCount = serverState.commonCount;
        }
        if (typeof serverState.foundCommonCount === 'number') {
            this.serverFoundCommonCount = serverState.foundCommonCount;
        }
    }

    computeActiveCells() {
        const active = new Set();
        for (const [word, cells] of this.allWords) {
            if (!this.foundWords.has(word)) {
                for (const cell of cells) {
                    active.add(cell);
                }
            }
        }
        return active;
    }

    getTopPlayer() {
        const top = this.getTopPlayers();
        return top.length > 0 ? top[0] : null;
    }

    getTopPlayers() {
        return [...this.playerScores.entries()]
            .filter(([name]) => name !== 'local')
            .map(([name, data]) => {
                const score = typeof data === 'number' ? data : data.score;
                const profileImage = typeof data === 'number' ? null : data.profileImage;
                return { name, score, profileImage };
            })
            .sort((a, b) => b.score - a.score);
    }

    // Get per-letter stats — uses server stats (common-only) when available
    getLetterStats() {
        if (this.serverLetterStats) {
            return this.serverLetterStats;
        }
        // Fallback: compute from all words (before server data arrives)
        const startsWith = {};
        const usesLetter = {};
        const cellUsage = {};
        const cellStartsWith = {};

        for (const [word, cells] of this.allWords) {
            if (!this.foundWords.has(word)) {
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
                    for (const cellIdx of cells) {
                        cellUsage[cellIdx] = (cellUsage[cellIdx] || 0) + 1;
                    }
                    cellStartsWith[cells[0]] = (cellStartsWith[cells[0]] || 0) + 1;
                }
            }
        }

        return { startsWith, usesLetter, cellUsage, cellStartsWith };
    }

    getProgress() {
        return {
            found: this.serverFoundCommonCount || this.foundWords.size,
            total: this.serverCommonCount || this.allWords.size,
            percentage: (this.serverCommonCount || this.allWords.size) > 0
                ? Math.round(((this.serverFoundCommonCount || this.foundWords.size) / (this.serverCommonCount || this.allWords.size)) * 100)
                : 0
        };
    }

    // Restore game from a saved state (re-solves to rebuild allWords)
    restoreFrom(state, trie) {
        this.grid = state.grid;
        this.rows = state.rows;
        this.cols = state.cols;
        this.minWordLength = state.minWordLength;
        this.allWords = findAllWords(this.grid, this.rows, this.cols, trie, this.minWordLength);
        this.foundWords = new Set(state.foundWords);
        this.playerScores = new Map(state.playerScores);
        this.incorrectGuesses = [];
        this.activeCells = this.computeActiveCells();
        console.log(`Game restored: ${this.rows}x${this.cols} grid, ${this.foundWords.size}/${this.allWords.size} words found`);
    }

    // Save current game state to localStorage
    saveState() {
        try {
            const state = {
                grid: this.grid,
                rows: this.rows,
                cols: this.cols,
                minWordLength: this.minWordLength,
                foundWords: [...this.foundWords],
                playerScores: [...this.playerScores.entries()],
                timestamp: Date.now()
            };
            localStorage.setItem('sproutle_game_state', JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save game state:', e);
        }
    }

    // Load saved game state from localStorage
    static loadState() {
        try {
            const saved = localStorage.getItem('sproutle_game_state');
            if (saved) return JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to load game state:', e);
        }
        return null;
    }

    // Clear saved game state
    static clearState() {
        localStorage.removeItem('sproutle_game_state');
    }
}
