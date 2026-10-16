'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// Trie
// ============================================================
class TrieNode {
    constructor() { this.children = {}; this.isWord = false; this.word = null; }
}
class Trie {
    constructor() { this.root = new TrieNode(); this.wordCount = 0; }
    insert(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) node.children[char] = new TrieNode();
            node = node.children[char];
        }
        if (!node.isWord) { node.isWord = true; node.word = word; this.wordCount++; }
    }
    has(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) return false;
            node = node.children[char];
        }
        return node.isWord;
    }
}

// ============================================================
// Solver
// ============================================================
function computeAdjacency(rows, cols) {
    const total = rows * cols;
    const adj = new Array(total);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            adj[idx] = [];
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                        adj[idx].push(nr * cols + nc);
                    }
                }
            }
        }
    }
    return adj;
}

function findAllWords(grid, rows, cols, trie, minLength) {
    const adj = computeAdjacency(rows, cols);
    const totalCells = rows * cols;
    const visited = new Uint8Array(totalCells);
    const path = [];
    const wordCells = new Map();

    function dfs(cellIdx, trieNode) {
        const r = Math.floor(cellIdx / cols);
        const c = cellIdx % cols;
        const letter = grid[r][c];
        const childNode = trieNode.children[letter];
        if (!childNode) return;
        visited[cellIdx] = 1;
        path.push(cellIdx);
        if (childNode.isWord && childNode.word.length >= minLength) {
            const word = childNode.word;
            if (!wordCells.has(word)) wordCells.set(word, new Set());
            const cellSet = wordCells.get(word);
            for (const idx of path) cellSet.add(idx);
        }
        for (const neighbor of adj[cellIdx]) {
            if (!visited[neighbor]) dfs(neighbor, childNode);
        }
        visited[cellIdx] = 0;
        path.pop();
    }
    for (let i = 0; i < totalCells; i++) dfs(i, trie.root);
    return wordCells;
}

// ============================================================
// Grid generation helpers
// ============================================================
const BASE_WEIGHTS = {
    a:9, b:2, c:2, d:4, e:12, f:2, g:3, h:2, i:9, j:1, k:1, l:4,
    m:2, n:6, o:8, p:2, q:1, r:6, s:6, t:6, u:4, v:2, w:2, x:1, y:2, z:1
};

const LETTERS = Object.keys(BASE_WEIGHTS);

function buildWeightedPicker(biasLetters) {
    const weights = {};
    for (const ch of LETTERS) {
        weights[ch] = BASE_WEIGHTS[ch];
    }
    for (const ch of biasLetters) {
        weights[ch] *= 3;
    }
    // Build cumulative distribution
    const entries = [];
    let cumulative = 0;
    for (const ch of LETTERS) {
        cumulative += weights[ch];
        entries.push({ letter: ch, cum: cumulative });
    }
    const total = cumulative;
    return function pickLetter() {
        const r = Math.random() * total;
        for (const e of entries) {
            if (r < e.cum) return e.letter;
        }
        return entries[entries.length - 1].letter;
    };
}

function generateGrid(rows, cols, pickLetter) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push(pickLetter());
        }
        grid.push(row);
    }
    return grid;
}

function checkFullCoverage(wordCells, totalCells) {
    const covered = new Set();
    for (const cells of wordCells.values()) {
        for (const idx of cells) covered.add(idx);
    }
    return covered.size === totalCells;
}

function countCommonCoverage(wordCells, commonSet, totalCells) {
    // Count how many cells are covered by COMMON words (Zipf >= threshold)
    const covered = new Set();
    for (const [word, cells] of wordCells) {
        if (commonSet.has(word)) {
            for (const idx of cells) covered.add(idx);
        }
    }
    return covered.size;
}

function checkCommonCoverage(wordCells, commonSet, totalCells) {
    // Every cell must be reachable by at least one common word.
    // This matches the runtime game behavior where only common-word cells are active.
    return countCommonCoverage(wordCells, commonSet, totalCells) === totalCells;
}

// ============================================================
// Flexible grid size configuration
// ============================================================
// Each tier defines a preferred size, but the generator also tries ±1 size
// and picks whichever achieves acceptable common words with fewest rare words.
const SIZE_CONFIG = {
    3: { minTargets: 3,  attempts: 300  },
    4: { minTargets: 5,  attempts: 500  },
    5: { minTargets: 10, attempts: 500  },
    6: { minTargets: 20, attempts: 500  },
    7: { minTargets: 25, attempts: 800  },
    8: { minTargets: 30, attempts: 1000 },
    9: { minTargets: 35, attempts: 1000 },
};

// Preferred size per tier (same progression as before)
const PREFERRED_SIZES = [4, 5, 6, 7, 8];
const PUZZLES_PER_TIER = 20;

function getPreferredSize(themeIndex) {
    const tierIdx = Math.min(Math.floor(themeIndex / PUZZLES_PER_TIER), PREFERRED_SIZES.length - 1);
    return PREFERRED_SIZES[tierIdx];
}

// Get sizes to try for a theme: preferred ± 1 (clamped to 4-9, never go below 4×4)
function getSizesToTry(themeIndex) {
    const preferred = getPreferredSize(themeIndex);
    const sizes = new Set();
    sizes.add(preferred);
    if (preferred - 1 >= 4) sizes.add(preferred - 1);
    if (preferred < 9 && SIZE_CONFIG[preferred + 1]) sizes.add(preferred + 1);
    return [...sizes].sort((a, b) => a - b);
}

// ============================================================
// 100 Themes
// ============================================================
const THEMES = [
    // Nature (1-10)
    { name: 'Morning Meadow', theme: 'Nature', bias: ['m','e','a','d','o','w'] },
    { name: 'Forest Trail', theme: 'Nature', bias: ['f','o','r','e','s','t'] },
    { name: 'River Delta', theme: 'Nature', bias: ['r','i','v','e','d','l'] },
    { name: 'Mountain Peak', theme: 'Nature', bias: ['m','o','u','n','t','p'] },
    { name: 'Desert Bloom', theme: 'Nature', bias: ['d','e','s','r','b','l'] },
    { name: 'Coral Reef', theme: 'Nature', bias: ['c','o','r','a','l','e'] },
    { name: 'Jungle Canopy', theme: 'Nature', bias: ['j','u','n','g','l','c'] },
    { name: 'Arctic Tundra', theme: 'Nature', bias: ['a','r','c','t','i','u'] },
    { name: 'Rolling Hills', theme: 'Nature', bias: ['r','o','l','i','n','g'] },
    { name: 'Autumn Grove', theme: 'Nature', bias: ['a','u','t','m','n','g'] },
    // Food & Kitchen (11-20)
    { name: 'Bakery Fresh', theme: 'Food & Kitchen', bias: ['b','a','k','e','r','f'] },
    { name: 'Spice Market', theme: 'Food & Kitchen', bias: ['s','p','i','c','e','m'] },
    { name: 'Garden Harvest', theme: 'Food & Kitchen', bias: ['g','a','r','d','e','h'] },
    { name: 'Sunday Brunch', theme: 'Food & Kitchen', bias: ['s','u','n','d','b','r'] },
    { name: 'Street Food', theme: 'Food & Kitchen', bias: ['s','t','r','e','f','o'] },
    { name: 'Sweet Tooth', theme: 'Food & Kitchen', bias: ['s','w','e','t','o','h'] },
    { name: 'Farm Table', theme: 'Food & Kitchen', bias: ['f','a','r','m','t','l'] },
    { name: 'Seafood Shack', theme: 'Food & Kitchen', bias: ['s','e','a','f','o','d'] },
    { name: 'Herb Garden', theme: 'Food & Kitchen', bias: ['h','e','r','b','g','d'] },
    { name: 'Pasta Night', theme: 'Food & Kitchen', bias: ['p','a','s','t','n','i'] },
    // Animals (21-30)
    { name: 'Jungle Safari', theme: 'Animals', bias: ['j','u','n','g','s','a'] },
    { name: 'Ocean Life', theme: 'Animals', bias: ['o','c','e','a','n','l'] },
    { name: 'Backyard Birds', theme: 'Animals', bias: ['b','a','c','k','i','r'] },
    { name: 'Night Owls', theme: 'Animals', bias: ['n','i','g','h','t','o'] },
    { name: 'Wild Cats', theme: 'Animals', bias: ['w','i','l','d','c','a'] },
    { name: 'Dog Park', theme: 'Animals', bias: ['d','o','g','p','a','r'] },
    { name: 'Farm Friends', theme: 'Animals', bias: ['f','a','r','m','i','e'] },
    { name: 'Insect World', theme: 'Animals', bias: ['i','n','s','e','c','t'] },
    { name: 'Pond Life', theme: 'Animals', bias: ['p','o','n','d','l','i'] },
    { name: 'Deep Dive', theme: 'Animals', bias: ['d','e','p','i','v'] },
    // City & Travel (31-40)
    { name: 'Downtown Rush', theme: 'City & Travel', bias: ['d','o','w','n','t','r'] },
    { name: 'Harbor View', theme: 'City & Travel', bias: ['h','a','r','b','o','v'] },
    { name: 'Airport Lounge', theme: 'City & Travel', bias: ['a','i','r','p','o','l'] },
    { name: 'Train Station', theme: 'City & Travel', bias: ['t','r','a','i','n','s'] },
    { name: 'Market Square', theme: 'City & Travel', bias: ['m','a','r','k','e','s'] },
    { name: 'Rooftop Sunset', theme: 'City & Travel', bias: ['r','o','f','t','s','u'] },
    { name: 'Bridge Crossing', theme: 'City & Travel', bias: ['b','r','i','d','g','c'] },
    { name: 'Old Town', theme: 'City & Travel', bias: ['o','l','d','t','w','n'] },
    { name: 'Night Market', theme: 'City & Travel', bias: ['n','i','g','h','m','a'] },
    { name: 'Skyline', theme: 'City & Travel', bias: ['s','k','y','l','i','n'] },
    // Science & Tech (41-50)
    { name: 'Lab Report', theme: 'Science & Tech', bias: ['l','a','b','r','e','p'] },
    { name: 'Star Gazer', theme: 'Science & Tech', bias: ['s','t','a','r','g','e'] },
    { name: 'Circuit Board', theme: 'Science & Tech', bias: ['c','i','r','u','t','b'] },
    { name: 'Code Sprint', theme: 'Science & Tech', bias: ['c','o','d','e','s','p'] },
    { name: 'Data Stream', theme: 'Science & Tech', bias: ['d','a','t','s','r','e'] },
    { name: 'Gene Pool', theme: 'Science & Tech', bias: ['g','e','n','p','o','l'] },
    { name: 'Atom Core', theme: 'Science & Tech', bias: ['a','t','o','m','c','r'] },
    { name: 'Solar Flare', theme: 'Science & Tech', bias: ['s','o','l','a','r','f'] },
    { name: 'Deep Space', theme: 'Science & Tech', bias: ['d','e','p','s','a','c'] },
    { name: 'Nano World', theme: 'Science & Tech', bias: ['n','a','o','w','r','l'] },
    // Arts & Culture (51-60)
    { name: 'Jazz Night', theme: 'Arts & Culture', bias: ['j','a','z','n','i','g'] },
    { name: 'Canvas Art', theme: 'Arts & Culture', bias: ['c','a','n','v','s','r'] },
    { name: 'Stage Light', theme: 'Arts & Culture', bias: ['s','t','a','g','l','i'] },
    { name: 'Book Club', theme: 'Arts & Culture', bias: ['b','o','k','c','l','u'] },
    { name: 'Film Noir', theme: 'Arts & Culture', bias: ['f','i','l','m','n','o'] },
    { name: 'Rock Band', theme: 'Arts & Culture', bias: ['r','o','c','k','b','a'] },
    { name: 'Dance Floor', theme: 'Arts & Culture', bias: ['d','a','n','c','e','f'] },
    { name: 'Ink Press', theme: 'Arts & Culture', bias: ['i','n','k','p','r','e'] },
    { name: 'Silk Road', theme: 'Arts & Culture', bias: ['s','i','l','k','r','o'] },
    { name: 'Clay Studio', theme: 'Arts & Culture', bias: ['c','l','a','y','s','t'] },
    // Sports & Games (61-70)
    { name: 'Home Run', theme: 'Sports & Games', bias: ['h','o','m','e','r','u'] },
    { name: 'Court Side', theme: 'Sports & Games', bias: ['c','o','u','r','t','s'] },
    { name: 'Race Track', theme: 'Sports & Games', bias: ['r','a','c','e','t','k'] },
    { name: 'Goal Line', theme: 'Sports & Games', bias: ['g','o','a','l','i','n'] },
    { name: 'Card Shark', theme: 'Sports & Games', bias: ['c','a','r','d','s','h'] },
    { name: 'Chess Match', theme: 'Sports & Games', bias: ['c','h','e','s','m','a'] },
    { name: 'Ring Side', theme: 'Sports & Games', bias: ['r','i','n','g','s','d'] },
    { name: 'Surf Break', theme: 'Sports & Games', bias: ['s','u','r','f','b','e'] },
    { name: 'Ski Lodge', theme: 'Sports & Games', bias: ['s','k','i','l','o','d'] },
    { name: 'Match Point', theme: 'Sports & Games', bias: ['m','a','t','c','h','p'] },
    // Weather & Seasons (71-80)
    { name: 'Spring Rain', theme: 'Weather & Seasons', bias: ['s','p','r','i','n','g'] },
    { name: 'Summer Heat', theme: 'Weather & Seasons', bias: ['s','u','m','e','r','h'] },
    { name: 'Fall Breeze', theme: 'Weather & Seasons', bias: ['f','a','l','b','r','e'] },
    { name: 'Winter Frost', theme: 'Weather & Seasons', bias: ['w','i','n','t','e','r'] },
    { name: 'Storm Front', theme: 'Weather & Seasons', bias: ['s','t','o','r','m','f'] },
    { name: 'Clear Skies', theme: 'Weather & Seasons', bias: ['c','l','e','a','r','s'] },
    { name: 'Thunder Roll', theme: 'Weather & Seasons', bias: ['t','h','u','n','d','e'] },
    { name: 'Fog Bank', theme: 'Weather & Seasons', bias: ['f','o','g','b','a','n'] },
    { name: 'Snow Drift', theme: 'Weather & Seasons', bias: ['s','n','o','w','d','r'] },
    { name: 'Heat Wave', theme: 'Weather & Seasons', bias: ['h','e','a','t','w','v'] },
    // Home & Daily (81-90)
    { name: 'Cozy Corner', theme: 'Home & Daily', bias: ['c','o','z','y','r','n'] },
    { name: 'Work Desk', theme: 'Home & Daily', bias: ['w','o','r','k','d','e'] },
    { name: 'Attic Find', theme: 'Home & Daily', bias: ['a','t','i','c','f','n'] },
    { name: 'Tool Shed', theme: 'Home & Daily', bias: ['t','o','l','s','h','e'] },
    { name: 'Craft Room', theme: 'Home & Daily', bias: ['c','r','a','f','t','o'] },
    { name: 'Wash Day', theme: 'Home & Daily', bias: ['w','a','s','h','d','y'] },
    { name: 'Porch Light', theme: 'Home & Daily', bias: ['p','o','r','c','h','l'] },
    { name: 'Bed Time', theme: 'Home & Daily', bias: ['b','e','d','t','i','m'] },
    { name: 'Play Room', theme: 'Home & Daily', bias: ['p','l','a','y','r','o'] },
    { name: 'Door Step', theme: 'Home & Daily', bias: ['d','o','r','s','t','e'] },
    // History & Fantasy (91-100)
    { name: 'Knight Quest', theme: 'History & Fantasy', bias: ['k','n','i','g','h','t'] },
    { name: 'Ship Wreck', theme: 'History & Fantasy', bias: ['s','h','i','p','w','r'] },
    { name: 'Gold Rush', theme: 'History & Fantasy', bias: ['g','o','l','d','r','u'] },
    { name: 'Time Warp', theme: 'History & Fantasy', bias: ['t','i','m','e','w','a'] },
    { name: 'Dragon Lair', theme: 'History & Fantasy', bias: ['d','r','a','g','o','n'] },
    { name: 'Wizard Tower', theme: 'History & Fantasy', bias: ['w','i','z','a','r','d'] },
    { name: 'Lost City', theme: 'History & Fantasy', bias: ['l','o','s','t','c','i'] },
    { name: 'Crown Jewel', theme: 'History & Fantasy', bias: ['c','r','o','w','n','j'] },
    { name: 'Iron Forge', theme: 'History & Fantasy', bias: ['i','r','o','n','f','g'] },
    { name: 'Stone Age', theme: 'History & Fantasy', bias: ['s','t','o','n','e','a'] },
];

// ============================================================
// Main
// ============================================================
function main() {
    const MIN_WORD_LENGTH = 3;
    const ZIPF_COMMON_THRESHOLD = 3.0; // Common = Zipf >= 3.0, Rare = has freq + below, Hidden = no freq

    const projectDir = path.resolve(__dirname, '..');
    const dictionaryPath = path.join(projectDir, 'data', 'dictionary.txt');
    const frequencyPath = path.resolve('C:/Chat Relay/data/word-bank/frequency.json');
    const outputPath = path.join(projectDir, 'data', 'puzzles.json');

    // --- Load frequency data ---
    console.log('Loading frequency data...');
    const freqJson = JSON.parse(fs.readFileSync(frequencyPath, 'utf-8'));
    const freqMap = {};
    for (const [word, score] of Object.entries(freqJson)) {
        freqMap[word.toLowerCase()] = score;
    }
    console.log(`Frequency loaded: ${Object.keys(freqMap).length} entries`);

    // --- Build "common" set from frequency (replaces target set) ---
    // Common words = Zipf >= ZIPF_COMMON_THRESHOLD (~24k words)
    const commonSet = new Set();
    for (const [word, score] of Object.entries(freqMap)) {
        if (score >= ZIPF_COMMON_THRESHOLD) commonSet.add(word.toLowerCase());
    }
    console.log(`Common words (Zipf >= ${ZIPF_COMMON_THRESHOLD}): ${commonSet.size}`);

    // --- Load FULL dictionary into Trie (no filtering) ---
    console.log('Loading full dictionary...');
    const dictLines = fs.readFileSync(dictionaryPath, 'utf-8').split(/\r?\n/).filter(Boolean);
    const trie = new Trie();
    for (const line of dictLines) {
        const word = line.trim().toLowerCase();
        if (word.length >= MIN_WORD_LENGTH && /^[a-z]+$/.test(word)) {
            trie.insert(word);
        }
    }
    console.log(`Dictionary: ${trie.wordCount} words loaded (full, unfiltered)`);
    console.log('');
    console.log(`Classification: common (Zipf >= ${ZIPF_COMMON_THRESHOLD}), rare (has freq, below), hidden (no freq)`);
    console.log('Flexible sizing: preferred 1-20=4x4, 21-40=5x5, 41-60=6x6, 61-80=7x7, 81-100=8x8');
    console.log('Each theme tries preferred ±1 size, picks fewest rare words with acceptable common count');
    console.log('');

    // --- Generate puzzles ---
    const puzzles = [];
    const startTime = Date.now();
    const tierStats = {}; // track stats per size tier

    for (let ti = 0; ti < THEMES.length; ti++) {
        const { name, theme, bias } = THEMES[ti];
        const sizesToTry = getSizesToTry(ti);
        const preferredSize = getPreferredSize(ti);

        const pickLetter = buildWeightedPicker(bias);

        // Best result across ALL sizes tried
        let bestGrid = null;
        let bestRows = 0;
        let bestCols = 0;
        let bestTargetCount = 0;
        let bestTotalCount = 0;
        let bestRareCount = Infinity;
        let bestWordCells = null;
        let bestRareRatio = Infinity; // rare / (common + rare) — lower is better

        for (const size of sizesToTry) {
            const config = SIZE_CONFIG[size];
            if (!config) continue;

            const ROWS = size;
            const COLS = size;
            const TOTAL_CELLS = ROWS * COLS;
            const GRIDS_PER_SIZE = config.attempts;
            const MIN_TARGET_WORDS = config.minTargets;

            // Best for THIS size
            let sizebestGrid = null;
            let sizebestTargetCount = 0;
            let sizebestTotalCount = 0;
            let sizebestRareCount = Infinity;
            let sizebestWordCells = null;

            for (let attempt = 0; attempt < GRIDS_PER_SIZE; attempt++) {
                const grid = generateGrid(ROWS, COLS, pickLetter);
                const wordCells = findAllWords(grid, ROWS, COLS, trie, MIN_WORD_LENGTH);

                // Check full board coverage
                if (!checkCommonCoverage(wordCells, commonSet, TOTAL_CELLS)) continue;

                // Count common (Zipf >= threshold) and rare (has freq, below threshold)
                // Hidden words (no freq data) are not counted — valid but invisible
                let targetCount = 0;
                let rareCount = 0;
                for (const word of wordCells.keys()) {
                    if (word.length >= 4) {
                        if (commonSet.has(word)) targetCount++;
                        else if (freqMap[word] !== undefined) rareCount++;
                        // else: hidden (no freq data) — not counted
                    }
                }

                if (targetCount < MIN_TARGET_WORDS) continue;

                // Score within this size: most common → fewest rare → most total
                const better = targetCount > sizebestTargetCount ||
                    (targetCount === sizebestTargetCount && rareCount < sizebestRareCount) ||
                    (targetCount === sizebestTargetCount && rareCount === sizebestRareCount && wordCells.size > sizebestTotalCount);

                if (better) {
                    sizebestGrid = grid;
                    sizebestTargetCount = targetCount;
                    sizebestRareCount = rareCount;
                    sizebestTotalCount = wordCells.size;
                    sizebestWordCells = wordCells;
                }
            }

            // If this size produced no valid grid, try relaxed (no minTargets)
            if (!sizebestGrid) {
                for (let attempt = 0; attempt < Math.floor(GRIDS_PER_SIZE / 2); attempt++) {
                    const grid = generateGrid(ROWS, COLS, pickLetter);
                    const wordCells = findAllWords(grid, ROWS, COLS, trie, MIN_WORD_LENGTH);
                    if (!checkCommonCoverage(wordCells, commonSet, TOTAL_CELLS)) continue;

                    let targetCount = 0;
                    let rareCount = 0;
                    for (const word of wordCells.keys()) {
                        if (word.length >= 4) {
                            if (commonSet.has(word)) targetCount++;
                            else if (freqMap[word] !== undefined) rareCount++;
                        }
                    }

                    const better = targetCount > sizebestTargetCount ||
                        (targetCount === sizebestTargetCount && rareCount < sizebestRareCount) ||
                        (targetCount === sizebestTargetCount && rareCount === sizebestRareCount && wordCells.size > sizebestTotalCount);

                    if (better) {
                        sizebestGrid = grid;
                        sizebestTargetCount = targetCount;
                        sizebestRareCount = rareCount;
                        sizebestTotalCount = wordCells.size;
                        sizebestWordCells = wordCells;
                    }
                }
            }

            if (!sizebestGrid) continue; // this size failed entirely

            // Compare this size's best against the overall best across sizes
            // Key metric: rare ratio (rare / total 4+ letter words) — lower is better
            // But common count must be "acceptable" (at least half the preferred size's minTargets)
            const total4plus = sizebestTargetCount + sizebestRareCount;
            const rareRatio = total4plus > 0 ? sizebestRareCount / total4plus : 0;

            // Decision: prefer the result with the lowest rare ratio,
            // breaking ties by most common words, then most total words.
            // Give a slight bonus to the preferred size (multiply its rare ratio by 0.95)
            const adjustedRatio = size === preferredSize ? rareRatio * 0.95 : rareRatio;

            const crossSizeBetter = adjustedRatio < bestRareRatio ||
                (Math.abs(adjustedRatio - bestRareRatio) < 0.01 && sizebestTargetCount > bestTargetCount) ||
                (Math.abs(adjustedRatio - bestRareRatio) < 0.01 && sizebestTargetCount === bestTargetCount && sizebestTotalCount > bestTotalCount);

            if (crossSizeBetter) {
                bestGrid = sizebestGrid;
                bestRows = ROWS;
                bestCols = COLS;
                bestTargetCount = sizebestTargetCount;
                bestRareCount = sizebestRareCount;
                bestTotalCount = sizebestTotalCount;
                bestWordCells = sizebestWordCells;
                bestRareRatio = adjustedRatio;
            }
        }

        if (!bestGrid) {
            // Last resort: use preferred size, accept grid with best TARGET coverage
            const size = preferredSize;
            const ROWS = size, COLS = size, TOTAL_CELLS = ROWS * COLS;
            console.log(`  [!!] Theme "${name}" — all sizes failed, accepting best-target-coverage ${ROWS}x${COLS}...`);
            let bestCoverage = 0;
            for (let attempt = 0; attempt < 500; attempt++) {
                const grid = generateGrid(ROWS, COLS, pickLetter);
                const wordCells = findAllWords(grid, ROWS, COLS, trie, MIN_WORD_LENGTH);

                // Count cells covered by TARGET words only
                const covered = new Set();
                for (const [word, cells] of wordCells) {
                    if (commonSet.has(word)) {
                        for (const idx of cells) covered.add(idx);
                    }
                }

                if (covered.size > bestCoverage) {
                    bestCoverage = covered.size;
                    bestGrid = grid;
                    bestRows = ROWS;
                    bestCols = COLS;
                    bestTotalCount = wordCells.size;
                    bestWordCells = wordCells;
                    bestTargetCount = 0;
                    bestRareCount = 0;
                    for (const word of wordCells.keys()) {
                        if (word.length >= 4) {
                            if (commonSet.has(word)) bestTargetCount++;
                            else if (freqMap[word] !== undefined) bestRareCount++;
                        }
                    }
                    if (covered.size === TOTAL_CELLS) break;
                }
            }
        }

        const puzzleId = ti + 1;
        const chosenSize = `${bestRows}x${bestCols}`;
        const prefSize = `${preferredSize}x${preferredSize}`;
        const sizeNote = chosenSize !== prefSize ? ` (was ${prefSize})` : '';

        puzzles.push({
            id: puzzleId,
            name: name,
            theme: theme,
            grid: bestGrid,
            rows: bestRows,
            cols: bestCols
        });

        // Track per-tier stats
        if (!tierStats[chosenSize]) tierStats[chosenSize] = { count: 0, totalTargets: 0, totalRare: 0, totalWords: 0 };
        tierStats[chosenSize].count++;
        tierStats[chosenSize].totalTargets += bestTargetCount;
        tierStats[chosenSize].totalRare += bestRareCount;
        tierStats[chosenSize].totalWords += bestTotalCount;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Puzzle ${puzzleId}/100: ${name} (${chosenSize}${sizeNote}) — ${bestTargetCount} common, ${bestRareCount} rare, ${bestTotalCount} total [${elapsed}s]`);
    }

    // --- Write output ---
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(puzzles, null, 2), 'utf-8');

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log(`Done! Generated ${puzzles.length} puzzles in ${totalTime}s`);
    console.log(`Output: ${outputPath}`);
    console.log('');
    console.log('Size distribution:');
    for (const [size, stats] of Object.entries(tierStats).sort()) {
        const avgTargets = Math.round(stats.totalTargets / stats.count);
        const avgRare = Math.round(stats.totalRare / stats.count);
        const avgWords = Math.round(stats.totalWords / stats.count);
        const avgRatio = stats.totalTargets > 0 ? Math.round(100 * stats.totalRare / (stats.totalTargets + stats.totalRare)) : 0;
        console.log(`  ${size}: ${stats.count} puzzles, avg ${avgTargets} common / ${avgRare} rare / ${avgWords} total (${avgRatio}% rare)`);
    }
}

main();
