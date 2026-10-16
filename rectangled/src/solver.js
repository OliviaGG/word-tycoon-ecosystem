// solver.js - DFS word finder with Trie pruning (CommonJS)

/**
 * Compute adjacency list for a grid of rows x cols.
 * Each cell maps to its 8-directional neighbors.
 * @param {number} rows
 * @param {number} cols
 * @returns {number[][]} adj[cellIndex] = [neighbor indices]
 */
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

/**
 * Find all valid words in the grid using DFS with Trie pruning.
 * @param {string[][]} grid - 2D array of lowercase letters
 * @param {number} rows
 * @param {number} cols
 * @param {Trie} trie - Trie containing valid dictionary words
 * @param {number} minLength - Minimum word length to include
 * @returns {Map<string, number[]>} word -> Array of cell indices (first valid path)
 */
// Adjacency depends only on the grid shape, and the retry loop calls
// findAllWords up to 1500x with the same shape — build it once per size.
const _adjCache = new Map();
function getAdjacency(rows, cols) {
    const key = `${rows}x${cols}`;
    let adj = _adjCache.get(key);
    if (!adj) {
        adj = computeAdjacency(rows, cols);
        _adjCache.set(key, adj);
    }
    return adj;
}

function findAllWords(grid, rows, cols, trie, minLength) {
    const adj = getAdjacency(rows, cols);
    const totalCells = rows * cols;
    const visited = new Uint8Array(totalCells);
    const path = [];

    // word -> Array<cellIndex> (first valid path found — single path per word)
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
            if (!wordCells.has(word)) {
                wordCells.set(word, path.slice());
            }
        }

        for (const neighbor of adj[cellIdx]) {
            if (!visited[neighbor]) {
                dfs(neighbor, childNode);
            }
        }

        visited[cellIdx] = 0;
        path.pop();
    }

    for (let i = 0; i < totalCells; i++) {
        dfs(i, trie.root);
    }

    // No log here: the grid-retry loop calls this up to 1500x per round, which
    // buried the logs (110k lines / 7MB). "[Game] Initialized:" reports the
    // final word counts once per round instead.
    return wordCells;
}

module.exports = { findAllWords, computeAdjacency };
