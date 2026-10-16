// solver.js - DFS word finder with Trie pruning

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

export function findAllWords(grid, rows, cols, trie, minLength) {
    const adj = computeAdjacency(rows, cols);
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

    console.log(`Solver found ${wordCells.size} words`);
    return wordCells;
}
