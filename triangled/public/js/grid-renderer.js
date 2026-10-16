/**
 * Triangle Grid Renderer — Glass Minimalism
 *
 * Square glass tiles arranged in a triangle over a background image.
 * Unfound tiles: frosted glass (blurred image + semi-transparent overlay)
 * Found tiles: fully transparent (clean image reveal)
 */

const ROWS = 10;
const TOTAL_CELLS = 55;

class GridRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Grid data
    this.letters = null;
    this.cellPositions = [];  // [{x, y, w, h, r, c}]
    this.cellSize = 0;

    // Background image
    this.bgImage = null;       // sharp original
    this.bgBlurred = null;     // blurred offscreen canvas
    this.bgLoaded = false;
    this.bgGradient = null;    // fallback gradient

    // State
    this.tracedCells = [];
    this.foundPaths = {};
    this.foundTypes = {};
    this.wordImages = {};       // word -> { img, loaded }
    this.hintRevealedCells = new Set();

    // Interaction
    this.isTracing = false;
    this.onTraceComplete = null;
    this.onTraceUpdate = null;

    this._setupEvents();
  }

  // ── Setup ─────────────────────────────────────────────────────────

  setGrid(gridString) {
    this.letters = gridString;
    this.tracedCells = [];
    this._computeLayout();
    this.render();
  }

  loadBackgroundImage(url) {
    if (!url) {
      this.bgLoaded = false;
      this.render();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.bgImage = img;
      this._createBlurredVersion();
      this.bgLoaded = true;
      this.render();
    };
    img.onerror = () => {
      console.warn('Failed to load background image');
      this.bgLoaded = false;
      this.render();
    };
    img.src = url;
  }

  _createBlurredVersion() {
    if (!this.bgImage) return;

    // Use logical dimensions (same coordinate space as render)
    const w = Math.ceil(this.canvas.width / this.dpr);
    const h = Math.ceil(this.canvas.height / this.dpr);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext('2d');

    // Apply blur filter and draw at full logical size
    octx.filter = 'blur(6px) brightness(0.72) saturate(1.1)';
    this._drawImageCover(octx, this.bgImage, 0, 0, w, h);
    octx.filter = 'none';

    this.bgBlurred = offscreen;
  }

  _drawImageCover(ctx, img, x, y, w, h) {
    // Cover the area while maintaining aspect ratio
    const imgAspect = img.width / img.height;
    const areaAspect = w / h;

    let sx, sy, sw, sh;
    if (imgAspect > areaAspect) {
      sh = img.height;
      sw = sh * areaAspect;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / areaAspect;
      sx = 0;
      sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  resize() {
    this._computeLayout();
    if (this.bgImage) this._createBlurredVersion();
    this.render();
  }

  _computeLayout() {
    const parent = this.canvas.parentElement;
    const maxW = Math.min(parent.clientWidth - 12, 420);
    const maxH = Math.min(window.innerHeight * 0.48, 400);

    // Square tiles with gap
    const gap = 3;
    const cellsWide = ROWS;
    const cellsHigh = ROWS;

    const tileSizeByW = (maxW - gap * (cellsWide - 1)) / cellsWide;
    const tileSizeByH = (maxH - gap * (cellsHigh - 1)) / cellsHigh;
    const tileSize = Math.min(tileSizeByW, tileSizeByH);
    this.cellSize = Math.floor(tileSize);

    const gridW = cellsWide * this.cellSize + (cellsWide - 1) * gap;
    const gridH = cellsHigh * this.cellSize + (cellsHigh - 1) * gap;

    const canvasW = Math.ceil(gridW + this.cellSize);
    const canvasH = Math.ceil(gridH + this.cellSize * 0.5);

    this.canvas.width = canvasW * this.dpr;
    this.canvas.height = canvasH * this.dpr;
    this.canvas.style.width = canvasW + 'px';
    this.canvas.style.height = canvasH + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Compute cell positions — triangle arrangement of squares
    this.cellPositions = [];
    const step = this.cellSize + gap;

    for (let r = 0; r < ROWS; r++) {
      const cols = r + 1;
      const rowWidth = cols * this.cellSize + (cols - 1) * gap;
      const startX = (canvasW - rowWidth) / 2;
      const y = r * step + this.cellSize * 0.2;

      for (let c = 0; c < cols; c++) {
        this.cellPositions.push({
          x: startX + c * step,
          y: y,
          w: this.cellSize,
          h: this.cellSize,
          r: r,
          c: c
        });
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.clearRect(0, 0, w, h);

    if (!this.letters) return;

    // Build lookup sets
    const tracedSet = new Set(this.tracedCells.map(c => `${c.r},${c.c}`));
    const foundCells = {};
    for (const [word, path] of Object.entries(this.foundPaths)) {
      const type = this.foundTypes[word] || 'theme';
      for (const cell of path) {
        foundCells[`${cell.r},${cell.c}`] = type;
      }
    }

    // Draw trace lines behind tiles
    if (this.tracedCells.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(210, 205, 200, 0.25)';
      ctx.lineWidth = this.cellSize * 0.35;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const first = this._getCellCenter(this.tracedCells[0].r, this.tracedCells[0].c);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.tracedCells.length; i++) {
        const pos = this._getCellCenter(this.tracedCells[i].r, this.tracedCells[i].c);
        ctx.lineTo(pos.x, pos.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw each cell
    for (let i = 0; i < this.cellPositions.length; i++) {
      const pos = this.cellPositions[i];
      const key = `${pos.r},${pos.c}`;
      const letter = this.letters[i];
      const isTraced = tracedSet.has(key);
      const foundType = foundCells[key];
      const isHintRevealed = this.hintRevealedCells.has(key);

      this._drawCell(ctx, pos, letter, isTraced, foundType, isHintRevealed, w, h);
    }
  }

  _drawCell(ctx, pos, letter, isTraced, foundType, isHintRevealed, canvasW, canvasH) {
    const { x, y, w, h } = pos;
    const radius = 0; // sharp edges

    ctx.save();

    // Clip to rounded rect
    this._roundRectPath(ctx, x, y, w, h, radius);

    if (foundType) {
      // ── FOUND: Clean reveal — show sharp background image
      ctx.clip();
      if (this.bgLoaded && this.bgImage) {
        this._drawImageCover(ctx, this.bgImage, 0, 0, canvasW, canvasH);
      } else {
        this._drawFallbackGradient(ctx, canvasW, canvasH);
      }
      ctx.restore();
      return;
    }

    // ── UNFOUND: Frosted glass tile

    // Draw blurred background through tile
    ctx.clip();
    if (this.bgLoaded && this.bgBlurred) {
      ctx.drawImage(this.bgBlurred, 0, 0, canvasW, canvasH);
    } else {
      // Fallback: dark background
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(x, y, w, h);
    }

    // Marble glass overlay
    if (isTraced) {
      ctx.fillStyle = 'rgba(220, 215, 210, 0.2)';
    } else if (isHintRevealed) {
      ctx.fillStyle = 'rgba(176, 164, 190, 0.15)';
    } else {
      ctx.fillStyle = 'rgba(200, 195, 190, 0.04)';
    }
    ctx.fillRect(x, y, w, h);

    // Top highlight — marble sheen
    const hlGrad = ctx.createLinearGradient(x, y, x, y + h * 0.35);
    hlGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    hlGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = hlGrad;
    ctx.fillRect(x, y, w, h * 0.35);

    ctx.restore();

    // Marble border
    ctx.save();
    this._roundRectPath(ctx, x, y, w, h, radius);
    if (isTraced) {
      ctx.strokeStyle = 'rgba(220, 215, 210, 0.45)';
      ctx.lineWidth = 1.5;
    } else if (isHintRevealed) {
      ctx.strokeStyle = 'rgba(176, 164, 190, 0.35)';
      ctx.lineWidth = 1;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.5;
    }
    ctx.stroke();
    ctx.restore();

    // Letter
    if (letter && letter !== '.') {
      const cx = x + w / 2;
      const cy = y + h / 2 + 1;
      const fontSize = Math.round(w * 0.48);

      ctx.font = `500 ${fontSize}px 'Inter', 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // Measure to center vertically
      const metrics = ctx.measureText(letter.toUpperCase());
      const textH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const drawY = y + h / 2 + textH / 2;

      // Subtle shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillText(letter.toUpperCase(), cx + 0.5, drawY + 0.5);

      if (isTraced) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      } else {
        ctx.fillStyle = 'rgba(230, 225, 220, 0.85)';
      }
      ctx.fillText(letter.toUpperCase(), cx, drawY);
    }
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _drawFallbackGradient(ctx, w, h) {
    if (!this.bgGradient) {
      this.bgGradient = ctx.createLinearGradient(0, 0, w, h);
      this.bgGradient.addColorStop(0, '#1a1a1e');
      this.bgGradient.addColorStop(0.5, '#1e1e22');
      this.bgGradient.addColorStop(1, '#14141a');
    }
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, w, h);
  }

  _getWordBounds(cells) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cell of cells) {
      const idx = (cell.r * (cell.r + 1)) / 2 + cell.c;
      const pos = this.cellPositions[idx];
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + pos.w > maxX) maxX = pos.x + pos.w;
      if (pos.y + pos.h > maxY) maxY = pos.y + pos.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  _getCellCenter(r, c) {
    const idx = (r * (r + 1)) / 2 + c;
    const pos = this.cellPositions[idx];
    return { x: pos.x + pos.w / 2, y: pos.y + pos.h / 2 };
  }

  // ── Hit Testing ───────────────────────────────────────────────────

  _hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    for (const pos of this.cellPositions) {
      if (x >= pos.x && x <= pos.x + pos.w &&
          y >= pos.y && y <= pos.y + pos.h) {
        return { r: pos.r, c: pos.c };
      }
    }
    return null;
  }

  // ── Adjacency ─────────────────────────────────────────────────────

  _areAdjacent(r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === 0) return Math.abs(dc) === 1;
    if (dr === 1) return dc === 0 || dc === 1;
    if (dr === -1) return dc === 0 || dc === -1;
    return false;
  }

  // ── Interaction ───────────────────────────────────────────────────

  _setupEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._startTrace(e.clientX, e.clientY));
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isTracing) this._continueTrace(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => this._endTrace());

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this._startTrace(t.clientX, t.clientY);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (this.isTracing) {
        const t = e.touches[0];
        this._continueTrace(t.clientX, t.clientY);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._endTrace();
    }, { passive: false });

    window.addEventListener('resize', () => {
      this._computeLayout();
      if (this.bgImage) this._createBlurredVersion();
      this.render();
    });
  }

  _startTrace(clientX, clientY) {
    const cell = this._hitTest(clientX, clientY);
    if (!cell) return;

    const key = `${cell.r},${cell.c}`;
    for (const [word, path] of Object.entries(this.foundPaths)) {
      if (path.some(c => `${c.r},${c.c}` === key)) return;
    }

    this.isTracing = true;
    this.tracedCells = [cell];
    this._updateTraceDisplay();
    this.render();
  }

  _continueTrace(clientX, clientY) {
    const cell = this._hitTest(clientX, clientY);
    if (!cell) return;

    const last = this.tracedCells[this.tracedCells.length - 1];
    if (cell.r === last.r && cell.c === last.c) return;

    // Backtrack
    if (this.tracedCells.length >= 2) {
      const prev = this.tracedCells[this.tracedCells.length - 2];
      if (cell.r === prev.r && cell.c === prev.c) {
        this.tracedCells.pop();
        this._updateTraceDisplay();
        this.render();
        return;
      }
    }

    if (!this._areAdjacent(last.r, last.c, cell.r, cell.c)) return;

    const key = `${cell.r},${cell.c}`;
    if (this.tracedCells.some(c => `${c.r},${c.c}` === key)) return;

    for (const [word, path] of Object.entries(this.foundPaths)) {
      if (path.some(c => `${c.r},${c.c}` === key)) return;
    }

    this.tracedCells.push(cell);
    this._updateTraceDisplay();
    this.render();
  }

  _endTrace() {
    if (!this.isTracing) return;
    this.isTracing = false;

    if (this.tracedCells.length >= 3 && this.onTraceComplete) {
      const path = this.tracedCells.map(c => [c.r, c.c]);
      this.onTraceComplete(path);
    }

    this.tracedCells = [];
    this._updateTraceDisplay();
    this.render();
  }

  _updateTraceDisplay() {
    if (!this.onTraceUpdate) return;
    if (!this.letters || this.tracedCells.length === 0) {
      this.onTraceUpdate('');
      return;
    }

    const word = this.tracedCells.map(c => {
      const idx = (c.r * (c.r + 1)) / 2 + c.c;
      return this.letters[idx];
    }).join('');

    this.onTraceUpdate(word);
  }

  // ── Public Methods ────────────────────────────────────────────────

  markWordFound(word, path, type) {
    this.foundPaths[word] = path.map(([r, c]) => ({ r, c }));
    this.foundTypes[word] = type;
    this.render();
  }

  revealHintCells(cells) {
    for (const [r, c] of cells) {
      this.hintRevealedCells.add(`${r},${c}`);
    }
    this.render();
  }

  clearTrace() {
    this.tracedCells = [];
    this.isTracing = false;
    this._updateTraceDisplay();
    this.render();
  }

  reset() {
    this.tracedCells = [];
    this.foundPaths = {};
    this.foundTypes = {};
    this.hintRevealedCells.clear();
    this.isTracing = false;
    this.render();
  }
}
