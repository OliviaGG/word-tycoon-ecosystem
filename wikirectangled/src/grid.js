// grid.js - Build a letter grid that hides every target word as a snake path.
//
// 8-connected, no cell reuse within a single word (Rectangled / Squaredle rules).
// Multiple targets are placed independently — they may overlap shared letters
// but they don't have to. After placement, blank cells are filled with weighted
// random letters and the solver verifies every target is still findable.
//
// Sized for grids around 7x7..9x9 with 5-10 targets averaging 4-7 letters each.

const { findAllWords } = require('./solver');

const LETTER_WEIGHTS = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2,
  i: 9, j: 1, k: 1, l: 4, m: 2, n: 6, o: 8, p: 2,
  q: 1, r: 6, s: 6, t: 6, u: 4, v: 2, w: 2, x: 1,
  y: 2, z: 1,
};

const LETTER_POOL = (() => {
  const pool = [];
  for (const [letter, weight] of Object.entries(LETTER_WEIGHTS)) {
    for (let i = 0; i < weight; i++) pool.push(letter);
  }
  return pool;
})();

function randomLetter() {
  return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function neighbors(cellIdx, rows, cols) {
  const r = Math.floor(cellIdx / cols);
  const c = cellIdx % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
  }
  return out;
}

// Place a single word into a partially-filled grid (`cells` is an Array of letter|null).
// May reuse pre-existing letters if they happen to match the next character.
// Returns the path (Array<cellIndex>) or null on failure.
function placeWord(word, cells, rows, cols, attempts = 60) {
  const total = rows * cols;
  const letters = word.split('');

  for (let a = 0; a < attempts; a++) {
    // Prefer starting on a cell that already holds the first letter so we
    // can reuse it. Fall back to any empty cell.
    const startCandidates = [];
    for (let i = 0; i < total; i++) {
      if (cells[i] === letters[0]) startCandidates.push(i);
    }
    for (let i = 0; i < total; i++) {
      if (cells[i] === null) startCandidates.push(i);
    }
    shuffle(startCandidates);
    if (startCandidates.length === 0) return null;

    const start = startCandidates[0];
    const path = [start];
    const used = new Set([start]);

    let ok = true;
    for (let li = 1; li < letters.length; li++) {
      const prev = path[path.length - 1];
      const wanted = letters[li];

      // Candidate next cells: unused neighbors that either match or are blank.
      const matching = [];
      const blank = [];
      for (const n of neighbors(prev, rows, cols)) {
        if (used.has(n)) continue;
        if (cells[n] === wanted) matching.push(n);
        else if (cells[n] === null) blank.push(n);
      }
      shuffle(matching);
      shuffle(blank);
      const candidates = matching.concat(blank);

      if (candidates.length === 0) { ok = false; break; }
      const next = candidates[0];
      path.push(next);
      used.add(next);
    }

    if (!ok) continue;

    // Commit
    for (let i = 0; i < letters.length; i++) {
      cells[path[i]] = letters[i];
    }
    return path;
  }

  return null;
}

// Try to place every target word into a fresh grid. Targets are placed longest-first
// (harder placements get the most empty space). Returns { cells, paths } or null.
function tryPlacement(targets, rows, cols) {
  const cells = new Array(rows * cols).fill(null);
  const paths = {};

  const ordered = [...targets].sort((a, b) => b.length - a.length);
  for (const word of ordered) {
    const path = placeWord(word, cells, rows, cols);
    if (!path) return null;
    paths[word] = path;
  }
  return { cells, paths };
}

// Convert flat cells -> 2D grid and fill blanks with weighted random letters.
function finalize(cells, rows, cols) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c];
      row.push(v === null ? randomLetter() : v);
    }
    grid.push(row);
  }
  return grid;
}

// Public entry. Returns:
//   { grid, rows, cols, allWords, targetPaths }
// where targetPaths[word] = Array<cellIndex>. Throws if no layout fits the targets.
function buildGrid(targets, trie, { rows = 7, cols = 7, minWordLength = 3, placementAttempts = 200, refineAttempts = 30, scoringTrie = null } = {}) {
  const cleaned = targets
    .map((w) => String(w || '').toLowerCase().replace(/[^a-z]/g, ''))
    .filter((w) => w.length >= 3);

  if (cleaned.length === 0) throw new Error('buildGrid: no usable target words');
  const totalLetters = cleaned.reduce((s, w) => s + w.length, 0);
  if (totalLetters > rows * cols) {
    throw new Error(`buildGrid: ${totalLetters} target letters exceed ${rows}x${cols} (${rows * cols}) cells`);
  }

  let bestGrid = null;
  let bestPaths = null;
  let bestAllWords = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < placementAttempts; attempt++) {
    const placed = tryPlacement(cleaned, rows, cols);
    if (!placed) continue;

    const grid = finalize(placed.cells, rows, cols);
    // Score by topic-word findability when a scoringTrie is provided.
    // The semantic trie is much smaller (~1500 words vs ~170k base), so
    // findAllWords is fast per attempt. The base trie's allWords is
    // recomputed once at the end on the winning grid.
    const effectiveTrie = scoringTrie || trie;
    const scoringWords = findAllWords(grid, rows, cols, effectiveTrie, minWordLength);

    // Verify every target is still discoverable by the solver after random fill
    // (a random letter could create an alternate, longer match that occludes the
    // original placement — but findAllWords records every distinct word, so the
    // target should always be present unless the placement itself was invalid).
    let allFound = true;
    for (const t of cleaned) {
      if (!effectiveTrie.has(t)) continue; // proper nouns / non-topic targets: placement OK, scorer won't find — skip
      if (!scoringWords.has(t)) { allFound = false; break; }
    }
    if (!allFound) continue;

    // Score: more topic-word matches is better. Picks placements whose
    // random-fill letters happen to complete semantic-trie words.
    const score = scoringWords.size;
    if (score > bestScore) {
      bestScore = score;
      bestGrid = grid;
      bestPaths = placed.paths;
      bestAllWords = scoringWords; // overwritten below with base-trie set
      if (score >= refineAttempts * 5) break; // good enough — stop early
    }
  }

  if (!bestGrid) {
    throw new Error(`buildGrid: could not place [${cleaned.join(', ')}] in ${rows}x${cols} after ${placementAttempts} attempts`);
  }

  // Recompute allWords on the winning grid against the BASE trie — the
  // game uses this for guess validity (any English word in the grid is
  // a legal find). Tier classification later filters back to topic words
  // via game.splitWords + topicTrie.
  const finalAllWords = scoringTrie ? findAllWords(bestGrid, rows, cols, trie, minWordLength) : bestAllWords;

  return { grid: bestGrid, rows, cols, allWords: finalAllWords, targetPaths: bestPaths, targets: cleaned };
}

// Board width stays at 9 columns so the overlay layout remains familiar, but
// we add rows when the title chip set is too large for the original 45-cell
// board. That keeps round-builds from failing on perfectly playable articles
// with 46-72 total title letters.
function pickDims(totalTargetLetters = 0) {
  if (totalTargetLetters > 63) return { rows: 8, cols: 9 };
  if (totalTargetLetters > 54) return { rows: 7, cols: 9 };
  if (totalTargetLetters > 45) return { rows: 6, cols: 9 };
  return { rows: 5, cols: 9 };
}

module.exports = { buildGrid, pickDims, randomLetter };
