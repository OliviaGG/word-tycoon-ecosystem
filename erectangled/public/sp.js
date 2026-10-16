// sp.js - Sproutle Single Player

// ─── SP State ─────────────────────────────────────────────────────────────────
let spState = null;
let spDailyDate = null;
let spGridEl = null;
let flashTimer = null;
let swipeInputInit = false;
let spHubPlayerId = null;
let spHubSessionKnown = false;
let spDailyCompletionMarkedFor = null;

async function ensureSpHubSession() {
    if (spHubSessionKnown) return spHubPlayerId;
    spHubSessionKnown = true;
    try {
        const res = await fetch('https://wordtycoon.live/api/me/session', { credentials: 'include' });
        const data = await res.json();
        if (data && data.ok && data.user && data.user.id) {
            spHubPlayerId = data.user.id;
        }
    } catch (_) {}
    return spHubPlayerId;
}

async function markSproutleDailyComplete(date) {
    if (!date || spDailyCompletionMarkedFor === date) return;
    spDailyCompletionMarkedFor = date;
    try { localStorage.setItem('sproutle_sp_daily_date', date); } catch (_) {}
    const userId = await ensureSpHubSession();
    if (!userId) return;
    fetch('api/sp/daily/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, userId })
    }).catch(() => {});
}

// ─── Adjacency ────────────────────────────────────────────────────────────────
function computeAdj(rows, cols) {
    const total = rows * cols;
    const adj = new Array(total);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        adj[idx] = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) adj[idx].push(nr * cols + nc);
        }
    }
    return adj;
}

function isAdjacentCells(idx1, idx2, cols) {
    const r1 = Math.floor(idx1 / cols), c1 = idx1 % cols;
    const r2 = Math.floor(idx2 / cols), c2 = idx2 % cols;
    return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && idx1 !== idx2;
}

function canSpellWord(word, grid, rows, cols, revealed) {
    const adj = computeAdj(rows, cols);
    const letters = word.toLowerCase().split('');
    const revSet = new Set(revealed);

    function dfs(idx, pos, visited) {
        if (pos === letters.length) return true;
        const r = Math.floor(idx / cols), c = idx % cols;
        if (grid[r][c] !== letters[pos]) return false;
        visited.add(idx);
        for (const nb of adj[idx]) {
            if (!visited.has(nb) && revSet.has(nb)) {
                if (dfs(nb, pos + 1, visited)) return true;
            }
        }
        visited.delete(idx);
        return false;
    }

    for (let i = 0; i < rows * cols; i++) {
        if (!revSet.has(i)) continue;
        const r = Math.floor(i / cols), c = i % cols;
        if (grid[r][c] === letters[0]) {
            if (dfs(i, 0, new Set())) return true;
        }
    }
    return false;
}

function getWordPath(word, grid, rows, cols, revealed) {
    const adj = computeAdj(rows, cols);
    const letters = word.toLowerCase().split('');
    const revSet = new Set(revealed);
    let foundPath = null;

    function dfs(idx, pos, path) {
        if (foundPath) return;
        if (pos === letters.length) { foundPath = [...path]; return; }
        const r = Math.floor(idx / cols), c = idx % cols;
        if (grid[r][c] !== letters[pos]) return;
        path.push(idx);
        for (const nb of adj[idx]) {
            if (!path.includes(nb) && revSet.has(nb)) dfs(nb, pos + 1, path);
        }
        if (!foundPath) path.pop();
    }

    for (let i = 0; i < rows * cols; i++) {
        if (!revSet.has(i)) continue;
        const r = Math.floor(i / cols), c = i % cols;
        if (grid[r][c] === letters[0]) { dfs(i, 0, []); if (foundPath) break; }
    }
    return foundPath;
}

// ─── Ring Order ───────────────────────────────────────────────────────────────
function computeRevealOrder(rows, cols) {
    const r0 = Math.floor(rows / 2) - 1;
    const c0 = Math.floor(cols / 2) - 1;
    const center = [r0 * cols + c0, r0 * cols + c0 + 1, (r0 + 1) * cols + c0, (r0 + 1) * cols + c0 + 1];
    const added = new Set(center);
    const queue = [];
    let ring = 1;
    while (added.size < rows * cols) {
        const r1 = r0 - ring, r2 = r0 + 1 + ring, c1 = c0 - ring, c2 = c0 + 1 + ring;
        const ringCells = [], seen = new Set();
        function add(r, c) {
            if (r < 0 || r >= rows || c < 0 || c >= cols) return;
            const idx = r * cols + c;
            if (added.has(idx) || seen.has(idx)) return;
            seen.add(idx); ringCells.push(idx);
        }
        for (let c = c1; c <= c2; c++) add(r1, c);
        for (let r = r1 + 1; r <= r2; r++) add(r, c2);
        for (let c = c2 - 1; c >= c1; c--) add(r2, c);
        for (let r = r2 - 1; r >= r1 + 1; r--) add(r, c1);
        if (!ringCells.length) break;
        ringCells.forEach(i => { added.add(i); queue.push(i); });
        ring++;
        if (ring > Math.max(rows, cols) + 2) break;
    }
    return { centerCells: center, revealQueue: queue };
}

// ─── Game Load (via server API) ───────────────────────────────────────────────
async function spNewGame(options = {}) {
    showMsg('Generating...', '');
    try {
        const url = options.daily ? 'api/sp/daily' : 'api/sp/game';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Server error ' + res.status);
        const data = await res.json();
        initSpGame(data, options.daily || false);
    } catch (e) {
        document.getElementById('spMsg').textContent = 'Could not reach server — try refreshing.';
        document.getElementById('spMsg').className = 'sp-msg err';
    }
}

async function spLoadDaily() {
    await spNewGame({ daily: true });
}

function initSpGame(data, isDaily) {
    spState = {
        grid: data.grid,
        rows: data.rows,
        cols: data.cols,
        centerCells: data.centerCells,
        revealedIndices: data.revealedIndices || data.centerCells.slice(),
        revealQueue: data.revealQueue,
        allWords: new Set(data.allWords || []),
        commonWords: new Set(data.commonWords || []),
        rareWords: new Set(data.rareWords || []),
        foundWords: new Set(),
        isDaily,
        dailyDate: data.dailyDate || null,
        gridFingerprint: data.gridFingerprint || null
    };

    if (isDaily && data.dailyDate) {
        spDailyDate = data.dailyDate;
        const saved = loadSpDaily(data.dailyDate);
        // Only restore save if the grid fingerprint matches — prevents stale saves
        // from a different grid (e.g. after a server-side regeneration) being applied.
        if (saved && saved.gridFingerprint === data.gridFingerprint) {
            spState.foundWords = new Set(saved.foundWords);
            spState.revealedIndices = saved.revealedIndices;
            spState.revealQueue = saved.revealQueue;
        }
    }

    document.getElementById('spDailyBadge').style.display = isDaily ? '' : 'none';
    showMsg('', '');
    renderSpAll();
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveSpDaily(date, state) {
    try {
        localStorage.setItem('sproutle-daily-' + date, JSON.stringify({
            foundWords: [...state.foundWords],
            revealedIndices: state.revealedIndices,
            revealQueue: state.revealQueue,
            gridFingerprint: state.gridFingerprint
        }));
    } catch {}
}

function loadSpDaily(date) {
    try {
        const s = localStorage.getItem('sproutle-daily-' + date);
        return s ? JSON.parse(s) : null;
    } catch { return null; }
}


// ─── Grid Render ──────────────────────────────────────────────────────────────
function renderSpGrid() {
    if (!spState) return;
    const { grid, rows, cols, revealedIndices, centerCells } = spState;
    spGridEl = document.getElementById('spGrid');
    document.documentElement.style.setProperty('--grid-cols', cols);

    const revealed = new Set(revealedIndices);
    const center   = new Set(centerCells);
    const total    = rows * cols;

    if (spGridEl.children.length !== total) {
        spGridEl.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const cell = document.createElement('div');
            cell.dataset.idx = i;
            const letterSpan = document.createElement('span');
            letterSpan.className = 'cell-letter';
            const startsSpan = document.createElement('span');
            startsSpan.className = 'cell-starts';
            const usesSpan = document.createElement('span');
            usesSpan.className = 'cell-uses';
            cell.appendChild(letterSpan);
            cell.appendChild(startsSpan);
            cell.appendChild(usesSpan);
            spGridEl.appendChild(cell);
        }
    }

    for (let i = 0; i < total; i++) {
        const cell = spGridEl.children[i];
        const r = Math.floor(i / cols), c = i % cols;
        const letterEl = cell.querySelector('.cell-letter');
        if (revealed.has(i)) {
            if (letterEl) letterEl.textContent = grid[r][c].toUpperCase();
            cell.className = 'grid-cell revealed' + (center.has(i) ? ' center' : '');
        } else {
            if (letterEl) letterEl.textContent = '';
            cell.className = 'grid-cell hidden';
        }
    }

    if (!swipeInputInit) {
        initDragInput();
        swipeInputInit = true;
    }
}

function spFlashCells(cells) {
    if (!cells || !spGridEl) return;
    if (flashTimer) clearTimeout(flashTimer);
    cells.forEach(idx => {
        const cell = spGridEl.querySelector(`[data-idx="${idx}"]`);
        if (cell) cell.classList.add('path-highlight');
    });
    flashTimer = setTimeout(() => {
        cells.forEach(idx => {
            const cell = spGridEl.querySelector(`[data-idx="${idx}"]`);
            if (cell) cell.classList.remove('path-highlight');
        });
    }, 1000);
}

function spRevealCell(idx) {
    if (!spGridEl || !spState) return;
    const cell = spGridEl.querySelector(`[data-idx="${idx}"]`);
    if (!cell) return;
    const r = Math.floor(idx / spState.cols), c = idx % spState.cols;
    const letterEl = cell.querySelector('.cell-letter');
    if (letterEl) letterEl.textContent = spState.grid[r][c].toUpperCase();
    // Update letter stats after revealing
    setTimeout(renderSpLetterStats, 100);
    cell.className = 'grid-cell revealed revealing';
    setTimeout(() => cell.classList.remove('revealing'), 700);
}

// ─── Found Words (flat list) ──────────────────────────────────────────────────
function renderSpWords() {
    if (!spState) return;
    const { commonWords, rareWords, foundWords, revealedIndices, grid, rows, cols } = spState;

    // Build flat found words list sorted by find order
    const allFound = [...foundWords];
    const listEl = document.getElementById('spFoundWords');
    listEl.innerHTML = allFound.map(w => {
        const isCommon = commonWords.has(w);
        const isRare = rareWords.has(w);
        const cls = isCommon ? 'common found' : isRare ? 'rare found' : 'found';
        const style = (!isCommon && !isRare) ? ' style="background:#222;border-color:#555;color:#aaa"' : '';
        return `<li class="word-tag ${cls}"${style}>${escHtml(w.toUpperCase())}</li>`;
    }).join('');

    document.getElementById('spFoundLabel').textContent = allFound.length;
}

function renderSpProgress() {
    if (!spState) return;
    const { commonWords, foundWords, revealedIndices, rows, cols } = spState;
    const foundCommonCount = [...foundWords].filter(w => commonWords.has(w)).length;
    const pct = commonWords.size ? foundCommonCount / commonWords.size : 0;

    document.getElementById('spProgressBar').style.width = Math.round(pct * 100) + '%';
    document.getElementById('spFoundCount').textContent  = foundCommonCount;
    document.getElementById('spTotalCount').textContent   = commonWords.size;
    document.getElementById('spCellCount').textContent    = `${revealedIndices.length}/${rows * cols} cells`;
}

// ─── Letter Stats (number hints on tiles) ─────────────────────────────────────
function computeSpLetterStats() {
    if (!spState) return { cellUsage: {}, cellStartsWith: {} };
    const { grid, rows, cols, commonWords, foundWords, revealedIndices } = spState;
    const cellUsage = {}, cellStartsWith = {};
    for (const word of commonWords) {
        if (foundWords.has(word)) continue;
        const path = getWordPath(word, grid, rows, cols, revealedIndices);
        if (!path || path.length === 0) continue;
        cellStartsWith[path[0]] = (cellStartsWith[path[0]] || 0) + 1;
        for (const idx of path) cellUsage[idx] = (cellUsage[idx] || 0) + 1;
    }
    return { cellUsage, cellStartsWith };
}

function renderSpLetterStats() {
    if (!spState || !spGridEl) return;
    const { cellUsage, cellStartsWith } = computeSpLetterStats();
    const total = spState.rows * spState.cols;
    const revealed = new Set(spState.revealedIndices);
    for (let i = 0; i < total; i++) {
        const cell = spGridEl.children[i];
        if (!cell) continue;
        const startsEl = cell.querySelector('.cell-starts');
        const usesEl   = cell.querySelector('.cell-uses');
        const isRevealed = revealed.has(i);
        const startsCount = cellStartsWith[i] || 0;
        const usesCount   = cellUsage[i]      || 0;
        const hasWords = isRevealed && (startsCount > 0 || usesCount > 0);
        cell.classList.toggle('has-words', hasWords);
        if (startsEl) startsEl.textContent = (startsCount > 0 && isRevealed) ? (startsCount >= 10 ? '+' : startsCount) : '';
        if (usesEl)   usesEl.textContent   = (usesCount   > 0 && isRevealed) ? (usesCount   >= 10 ? '+' : usesCount)   : '';
    }
}

function renderSpAll() {
    renderSpGrid();
    renderSpProgress();
    renderSpWords();
    renderSpLetterStats();
}

// ─── Word Processing (shared by typed and swiped/dragged input) ──────────────
function processGuess(word, pathOverride = null) {
    if (!spState) { showMsg('No game active', 'err'); return; }
    if (word.length < 4) { showMsg('Min 4 letters', 'err'); feedbackError(); return; }
    if (!/^[a-z]+$/.test(word)) { showMsg('Letters only', 'err'); feedbackError(); return; }

    if (spState.foundWords.has(word)) {
        showMsg('Already found!', 'warn');
        feedbackError();
        return;
    }

    const path = pathOverride || getWordPath(word, spState.grid, spState.rows, spState.cols, spState.revealedIndices);
    if (!path) {
        showMsg('Not a valid path', 'err');
        feedbackError();
        return;
    }

    if (!spState.allWords.has(word)) {
        showMsg('Not a word in this grid', 'err');
        feedbackError();
        return;
    }

    // Valid!
    spState.foundWords.add(word);
    spFlashCells(path);

    const isCommon = spState.commonWords.has(word);
    const isRare   = spState.rareWords.has(word);
    const scoreMsg = isCommon ? '+150' : isRare ? '+400' : '+75';
    showMsg(`✓ ${word.toUpperCase()} ${scoreMsg}`, 'ok');

    // Reveal next cell
    if (spState.revealQueue.length > 0) {
        const newIdx = spState.revealQueue.shift();
        spState.revealedIndices = [...spState.revealedIndices, newIdx];
        spRevealCell(newIdx);

        // Auto-reveal cells until at least 1 unfound common word is available.
        // Mirrors server-side logic — no arbitrary cap, just minimum needed.
        let extraDelay = 1;
        while (spState.revealQueue.length > 0) {
            const activeCommon = [...spState.commonWords].filter(
                w => !spState.foundWords.has(w) && canSpellWord(w, spState.grid, spState.rows, spState.cols, spState.revealedIndices)
            );
            const unfoundCommon = spState.commonWords.size - [...spState.foundWords].filter(w => spState.commonWords.has(w)).length;
            if (activeCommon.length > 0 || unfoundCommon === 0) break;
            const extraIdx = spState.revealQueue.shift();
            spState.revealedIndices = [...spState.revealedIndices, extraIdx];
            setTimeout(() => spRevealCell(extraIdx), 400 * extraDelay);
            extraDelay++;
        }
    }

    if (spState.isDaily && spDailyDate) saveSpDaily(spDailyDate, spState);

    renderSpProgress();
    setTimeout(renderSpWords, 300);
    setTimeout(renderSpLetterStats, 350);

    const foundCommonCount = [...spState.foundWords].filter(w => spState.commonWords.has(w)).length;
    if (spState.commonWords.size > 0 && foundCommonCount >= spState.commonWords.size) {
        setTimeout(() => showMsg('🌱 Garden Complete! All common words found!', 'ok'), 500);
        if (spState.isDaily) {
            const today = spDailyDate || new Date().toISOString().slice(0, 10);
            markSproutleDailyComplete(today);
        }
    }
}

// ─── Typed Input ──────────────────────────────────────────────────────────────
function spSubmit() {
    const input = document.getElementById('spInput');
    const word = input.value.trim().toLowerCase();
    input.value = '';
    processGuess(word);
}

function feedbackError() {
    const input = document.getElementById('spInput');
    if (input && document.activeElement === input) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 500);
    }
    const swEl = document.getElementById('swipeWord');
    if (swEl) {
        swEl.classList.add('swipe-error');
        setTimeout(() => swEl.classList.remove('swipe-error'), 400);
    }
}

// ─── Drag Input (touch + mouse) ──────────────────────────────────────────────
let swipePath = [];
let isSwiping = false;

function initDragInput() {
    if (!spGridEl) return;

    // Touch events
    spGridEl.addEventListener('touchstart', handleDragStart, { passive: false });
    spGridEl.addEventListener('touchmove',  handleDragMove,  { passive: false });
    spGridEl.addEventListener('touchend',   handleDragEnd,   { passive: false });
    spGridEl.addEventListener('touchcancel', handleDragEnd,  { passive: false });

    // Mouse events (desktop drag support)
    spGridEl.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup',   handleMouseUp);
}

// -- Touch handlers --
function getCellFromTouch(e) {
    const t = e.touches[0] || e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el) return null;
    const cell = el.dataset?.idx !== undefined ? el : el.closest('[data-idx]');
    if (!cell) return null;
    return parseInt(cell.dataset.idx);
}

function handleDragStart(e) {
    e.preventDefault();
    const idx = getCellFromTouch(e);
    startDrag(idx);
}

function handleDragMove(e) {
    e.preventDefault();
    const idx = getCellFromTouch(e);
    continueDrag(idx);
}

function handleDragEnd(e) {
    e.preventDefault();
    endDrag();
}

// -- Mouse handlers --
function getCellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.dataset?.idx !== undefined ? el : el.closest('[data-idx]');
    if (!cell) return null;
    return parseInt(cell.dataset.idx);
}

function handleMouseDown(e) {
    e.preventDefault();
    const idx = getCellFromPoint(e.clientX, e.clientY);
    startDrag(idx);
}

function handleMouseMove(e) {
    if (!isSwiping) return;
    const idx = getCellFromPoint(e.clientX, e.clientY);
    continueDrag(idx);
}

function handleMouseUp(e) {
    if (!isSwiping) return;
    endDrag();
}

// -- Shared drag logic --
function startDrag(idx) {
    swipePath = [];
    isSwiping = false;
    if (!spState || idx === null) return;
    if (!new Set(spState.revealedIndices).has(idx)) return;

    isSwiping = true;
    swipePath.push(idx);
    updateSwipeUI();
}

function continueDrag(idx) {
    if (!isSwiping || !spState || idx === null) return;
    if (!new Set(spState.revealedIndices).has(idx)) return;

    // Back-tracking: if touching an already-visited cell, truncate path back to it
    const existingPos = swipePath.indexOf(idx);
    if (existingPos !== -1) {
        const removed = swipePath.splice(existingPos + 1);
        clearSwipeCells(removed);
        updateSwipeUI();
        return;
    }

    // Must be adjacent to last cell
    const last = swipePath[swipePath.length - 1];
    if (!isAdjacentCells(last, idx, spState.cols)) return;

    swipePath.push(idx);
    updateSwipeUI();
}

function endDrag() {
    isSwiping = false;

    if (swipePath.length >= 4 && spState) {
        const word = swipePath.map(idx => {
            const r = Math.floor(idx / spState.cols), c = idx % spState.cols;
            return spState.grid[r][c];
        }).join('').toLowerCase();
        processGuess(word, swipePath.slice());
    }

    clearAllSwipeCells();
    swipePath = [];
    updateSwipeUI();
}

function updateSwipeUI() {
    if (spGridEl) {
        spGridEl.querySelectorAll('.swipe-path, .swipe-last').forEach(el => {
            el.classList.remove('swipe-path', 'swipe-last');
        });
        swipePath.forEach((idx, i) => {
            const cell = spGridEl.querySelector(`[data-idx="${idx}"]`);
            if (cell) cell.classList.add(i === swipePath.length - 1 ? 'swipe-last' : 'swipe-path');
        });
    }

    const el = document.getElementById('swipeWord');
    if (!el) return;
    if (!spState || swipePath.length === 0) {
        el.textContent = '';
        el.className = 'swipe-word-display';
        return;
    }
    const word = swipePath.map(idx => {
        const r = Math.floor(idx / spState.cols), c = idx % spState.cols;
        return spState.grid[r][c].toUpperCase();
    }).join('');
    el.textContent = word;
    el.className = 'swipe-word-display' + (swipePath.length >= 4 ? ' swipe-ready' : '');
}

function clearSwipeCells(indices) {
    if (!spGridEl) return;
    (indices || []).forEach(idx => {
        const cell = spGridEl.querySelector(`[data-idx="${idx}"]`);
        if (cell) cell.classList.remove('swipe-path', 'swipe-last');
    });
}

function clearAllSwipeCells() {
    if (spGridEl) spGridEl.querySelectorAll('.swipe-path, .swipe-last').forEach(el => {
        el.classList.remove('swipe-path', 'swipe-last');
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function showMsg(text, cls) {
    const el = document.getElementById('spMsg');
    el.textContent = text;
    el.className = 'sp-msg ' + (cls || '');
    if (cls === 'ok' || cls === 'warn') {
        setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'sp-msg'; } }, 2000);
    }
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toggleHelp() {
    document.getElementById('spHelp').classList.toggle('open');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.body.classList.add('touch-device');
    }

    document.getElementById('spInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') spSubmit();
    });

    spLoadDaily();
});
