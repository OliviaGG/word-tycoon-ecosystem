/**
 * Triangle Grid Model
 *
 * 10-row triangle: row 0 has 1 cell, row 1 has 2, ... row 9 has 10
 * Total cells: 55
 *
 * Cell addressing: (row, col) where 0 <= col <= row
 *
 * Adjacency per cell (r, c):
 *   Same row:  (r, c-1), (r, c+1)
 *   Row above: (r-1, c-1), (r-1, c)
 *   Row below: (r+1, c), (r+1, c+1)
 */

const ROWS = 10;
const TOTAL_CELLS = 55; // sum 1..10

class TriangleGrid {
  constructor() {
    this.rows = ROWS;
    this.totalCells = TOTAL_CELLS;
    // cells[r][c] = letter or null
    this.cells = [];
    for (let r = 0; r < ROWS; r++) {
      this.cells.push(new Array(r + 1).fill(null));
    }
  }

  isValid(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c <= r;
  }

  get(r, c) {
    if (!this.isValid(r, c)) return null;
    return this.cells[r][c];
  }

  set(r, c, letter) {
    if (!this.isValid(r, c)) return false;
    this.cells[r][c] = letter;
    return true;
  }

  clear(r, c) {
    if (!this.isValid(r, c)) return;
    this.cells[r][c] = null;
  }

  isEmpty(r, c) {
    return this.isValid(r, c) && this.cells[r][c] === null;
  }

  getNeighbors(r, c) {
    const neighbors = [];
    const candidates = [
      [r, c - 1], [r, c + 1],       // same row
      [r - 1, c - 1], [r - 1, c],   // row above
      [r + 1, c], [r + 1, c + 1]    // row below
    ];
    for (const [nr, nc] of candidates) {
      if (this.isValid(nr, nc)) {
        neighbors.push([nr, nc]);
      }
    }
    return neighbors;
  }

  // Get all cells on a specific edge of the triangle
  getEdgeCells(edge) {
    const cells = [];
    switch (edge) {
      case 'top': // just the apex
        cells.push([0, 0]);
        break;
      case 'left': // left diagonal edge
        for (let r = 0; r < this.rows; r++) {
          cells.push([r, 0]);
        }
        break;
      case 'right': // right diagonal edge
        for (let r = 0; r < this.rows; r++) {
          cells.push([r, r]);
        }
        break;
      case 'bottom': // bottom row
        for (let c = 0; c < this.rows; c++) {
          cells.push([this.rows - 1, c]);
        }
        break;
    }
    return cells;
  }

  // Check if a cell is on any edge
  isEdgeCell(r, c) {
    return r === 0 || r === this.rows - 1 || c === 0 || c === r;
  }

  // Which edges does this cell belong to?
  getCellEdges(r, c) {
    const edges = [];
    if (r === 0) edges.push('top');
    if (c === 0) edges.push('left');
    if (c === r) edges.push('right');
    if (r === this.rows - 1) edges.push('bottom');
    return edges;
  }

  // Get all cells as flat array of [r, c]
  allCells() {
    const result = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c <= r; c++) {
        result.push([r, c]);
      }
    }
    return result;
  }

  // Get all empty cells
  emptyCells() {
    return this.allCells().filter(([r, c]) => this.cells[r][c] === null);
  }

  // Check if two cells are adjacent
  areAdjacent(r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === 0) return Math.abs(dc) === 1;
    if (dr === 1) return dc === 0 || dc === 1;
    if (dr === -1) return dc === 0 || dc === -1;
    return false;
  }

  // Validate that a path of cells forms a connected chain
  isConnectedPath(path) {
    for (let i = 1; i < path.length; i++) {
      if (!this.areAdjacent(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])) {
        return false;
      }
    }
    return true;
  }

  // Check if a path spans from one edge to an opposite edge (for spangram)
  spansOppositeEdges(path) {
    if (path.length < 2) return false;
    const startEdges = this.getCellEdges(path[0][0], path[0][1]);
    const endEdges = this.getCellEdges(path[path.length - 1][0], path[path.length - 1][1]);

    const oppositePairs = [
      ['top', 'bottom'],
      ['left', 'right'],
      ['top', 'right'],
      ['top', 'left'],
      ['left', 'bottom'],
      ['right', 'bottom']
    ];

    for (const [a, b] of oppositePairs) {
      if ((startEdges.includes(a) && endEdges.includes(b)) ||
          (startEdges.includes(b) && endEdges.includes(a))) {
        return true;
      }
    }
    return false;
  }

  // Place a word along a path, returns true if successful
  placeWord(word, path) {
    if (word.length !== path.length) return false;
    if (!this.isConnectedPath(path)) return false;

    // Check all cells are empty
    for (const [r, c] of path) {
      if (!this.isEmpty(r, c)) return false;
    }

    // Place letters
    for (let i = 0; i < word.length; i++) {
      this.set(path[i][0], path[i][1], word[i].toUpperCase());
    }
    return true;
  }

  /**
   * Count how many distinct connected paths through the grid spell `word`.
   * Returns the count (stops early at `maxCount` for efficiency).
   */
  countWordPaths(word, maxCount = 2) {
    const upper = word.toUpperCase();
    let count = 0;

    // Find all cells matching the first letter
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c <= r; c++) {
        if (this.cells[r][c] === upper[0]) {
          const visited = new Set([`${r},${c}`]);
          count += this._countPathsDFS(upper, 1, r, c, visited, maxCount - count);
          if (count >= maxCount) return count;
        }
      }
    }
    return count;
  }

  _countPathsDFS(word, idx, cr, cc, visited, remaining) {
    if (idx === word.length) return 1;
    if (remaining <= 0) return 0;

    let found = 0;
    const neighbors = this.getNeighbors(cr, cc);
    for (const [nr, nc] of neighbors) {
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (this.cells[nr][nc] !== word[idx]) continue;

      visited.add(key);
      found += this._countPathsDFS(word, idx + 1, nr, nc, visited, remaining - found);
      visited.delete(key);

      if (found >= remaining) return found;
    }
    return found;
  }

  // Remove a word from its path
  removeWord(path) {
    for (const [r, c] of path) {
      this.clear(r, c);
    }
  }

  // Convert to flat index (for serialization)
  static toIndex(r, c) {
    return (r * (r + 1)) / 2 + c;
  }

  static fromIndex(idx) {
    let r = 0;
    let remaining = idx;
    while (remaining > r) {
      remaining -= (r + 1);
      r++;
    }
    return [r, remaining];
  }

  // Serialize grid to a flat string (for transmission)
  toFlatString() {
    let result = '';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c <= r; c++) {
        result += this.cells[r][c] || '.';
      }
    }
    return result;
  }

  // Load from flat string
  static fromFlatString(str) {
    const grid = new TriangleGrid();
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= r; c++) {
        const ch = str[idx++];
        grid.cells[r][c] = ch === '.' ? null : ch;
      }
    }
    return grid;
  }

  // Pretty print for debugging / Discord preview
  toAscii() {
    const lines = [];
    const maxWidth = this.rows * 2 - 1;
    for (let r = 0; r < this.rows; r++) {
      const padding = ' '.repeat(this.rows - r - 1);
      const row = this.cells[r].map(c => c || '.').join(' ');
      lines.push(padding + row);
    }
    return lines.join('\n');
  }

  // Clone the grid
  clone() {
    const g = new TriangleGrid();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c <= r; c++) {
        g.cells[r][c] = this.cells[r][c];
      }
    }
    return g;
  }
}

module.exports = { TriangleGrid, ROWS, TOTAL_CELLS };
