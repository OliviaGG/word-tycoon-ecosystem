// overlay.js - eRecTangled OBS Overlay
// SSE-driven, server is the source of truth. No local game validation needed.

(function () {
'use strict';

// Streamer-private session: server redirects /overlay/<handle> to
// /overlay.html?session=<handle>. Detect the query param and append it to
// every /api/game/state poll so the displayed board reflects the streamer's
// private session. Public /overlay.html (no session param) is unchanged.
const SESSION_HANDLE = (() => {
    try {
        const h = new URLSearchParams(location.search).get('session');
        return h && /^[a-z0-9_-]{1,32}$/i.test(h) ? h.toLowerCase() : null;
    } catch (_) { return null; }
})();
const STATE_URL = SESSION_HANDLE
    ? `api/game/state?session=${encodeURIComponent(SESSION_HANDLE)}`
    : 'api/game/state';

const AVATAR_FALLBACK = '/portal/img/logo.png';
function isLogoUrl(url) { return !!url && (url.indexOf('logo.png') !== -1 || url.indexOf('/profile-logos/') !== -1); }
function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
}

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const gridContainer = document.getElementById('grid-container');
const gameBoard     = document.getElementById('game-board');
const foundCountEl  = document.getElementById('found-count');
const totalCountEl  = document.getElementById('total-count');
const progressBar   = document.getElementById('progress-bar');
const ringProgressBar = document.getElementById('ring-progress-bar');
const ringInfoEl    = document.getElementById('ring-info');
const incorrectArea = document.getElementById('incorrect-area');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');
const completeOverlay = document.getElementById('complete-overlay');
const completeStats = document.getElementById('complete-stats');
const wordAnnounceEl = document.getElementById('word-announce');
const wordAnnounceAvatarEl = document.getElementById('word-announce-avatar');
const wordAnnounceAvatarFallbackEl = document.getElementById('word-announce-avatar-fallback');
const wordAnnounceNameEl = document.getElementById('word-announce-name');
const wordAnnounceWordEl = document.getElementById('word-announce-word');
const wordAnnounceScoreEl = document.getElementById('word-announce-score');
const wordAnnounceRarityEl = document.getElementById('word-announce-rarity');
const wordAnnounceEarnedEl = document.getElementById('word-announce-earned');

// ─── State ────────────────────────────────────────────────────────────────────
let cells = [];
let allPlayers = [];
let lastFoundUsername = null;
let lastDisplayedScore = 0;
let wordAnnounceToken = 0;
let gridRows = 8;
let gridCols = 6;
let lastPresentationState = null;
let presentationPublishTimer = null;
let lastPresentationHash = '';

// ─── Auto-rotate ──────────────────────────────────────────────────────────────
const ROTATION_CLASSES = ['', 'rotated-180'];
let rotationIndex = 0;
let rotationTimer = null;
const ROTATE_INTERVAL = 10 * 60 * 1000; // 10 minutes

function getRotationDegrees() {
    return rotationIndex === 1 ? 180 : 0;
}

function normalizeRect(rect, viewportWidth, viewportHeight) {
    if (!rect || !viewportWidth || !viewportHeight) return null;
    return {
        leftPct: rect.left / viewportWidth,
        topPct: rect.top / viewportHeight,
        widthPct: rect.width / viewportWidth,
        heightPct: rect.height / viewportHeight
    };
}

function buildBoardPresentationPayload() {
    if (!lastPresentationState) return null;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const boardRect = gridContainer.getBoundingClientRect();
    const hudRect = gameBoard.getBoundingClientRect();
    if (!boardRect || boardRect.width <= 0 || boardRect.height <= 0) return null;

    const cellRects = cells
        .map(cell => normalizeRect(cell.getBoundingClientRect(), viewportWidth, viewportHeight))
        .filter(Boolean);

    return {
        game: 'erectangled',
        rows: lastPresentationState.rows || gridRows || 0,
        cols: lastPresentationState.cols || gridCols || 0,
        activeCells: [...(lastPresentationState.activeCells || [])],
        revealedCells: [...(lastPresentationState.revealedCells || [])],
        currentRing: lastPresentationState.currentRing || 0,
        totalRings: lastPresentationState.totalRings || 0,
        rotation: getRotationDegrees(),
        layout: {
            ...normalizeRect(boardRect, viewportWidth, viewportHeight),
            hudBottomPct: hudRect.top / viewportHeight
        },
        cellRects,
        source: 'overlay'
    };
}

function scheduleBoardPresentationPublish(reason) {
    if (presentationPublishTimer) clearTimeout(presentationPublishTimer);
    presentationPublishTimer = setTimeout(() => {
        presentationPublishTimer = null;
        requestAnimationFrame(() => {
            const payload = buildBoardPresentationPayload();
            if (!payload) return;
            const hash = JSON.stringify(payload);
            if (hash === lastPresentationHash) return;
            lastPresentationHash = hash;
            fetch('api/board-presentation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch((e) => {
                console.warn('[overlay] Could not publish board presentation:', e.message);
            });
        });
    }, 40);
}

function applyRotation() {
    for (const cls of ROTATION_CLASSES) {
        if (cls) gridContainer.classList.remove(cls);
    }
    const cls = ROTATION_CLASSES[rotationIndex];
    if (cls) gridContainer.classList.add(cls);
    scheduleBoardPresentationPublish('rotation');
}

function rotateNext() {
    rotationIndex = (rotationIndex + 1) % ROTATION_CLASSES.length;
    applyRotation();
}

function resetRotation() {
    rotationIndex = 0;
    applyRotation();
}

function startAutoRotate() {
    if (rotationTimer) clearInterval(rotationTimer);
    rotationTimer = setInterval(rotateNext, ROTATE_INTERVAL);
}

/**
 * Smart-rotate: when new cells are revealed, orient the grid so those cells
 * appear at the visual top (most prominent position for viewers).
 * Average row of new cells vs grid midpoint → rotated-180 if cells are in the
 * lower half, no rotation if they're in the upper half.
 * Resets the auto-rotate timer so it doesn't immediately undo the smart rotation.
 */
function smartRotateForNewCells(newCellIndices, totalRows, totalCols) {
    if (!newCellIndices || newCellIndices.length === 0) return;

    const avgRow = newCellIndices.reduce((sum, idx) => sum + Math.floor(idx / totalCols), 0) / newCellIndices.length;
    const midRow = (totalRows - 1) / 2;

    // New cells below centre → rotate 180° to bring them to visual top
    // New cells above centre → remove rotation so they're already at visual top
    const wantRotated = avgRow > midRow;
    rotationIndex = wantRotated ? 1 : 0;
    applyRotation();

    // Reset the auto-rotate timer so we hold this position for a full interval
    startAutoRotate();
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
    const defaults = { wsUrl: 'http://localhost:3000', showFoundWords: true, lightMode: false, letterScale: 0.5, numberScale: 0.3 };
    try {
        const saved = localStorage.getItem('sproutle_settings');
        if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (e) {}
    return defaults;
}

// ─── Cosmetics (delegated to shared TopPlayerCards module) ────────────────────
const getCosmetics = TopPlayerCards.getCosmetics;
const invalidateCosmetics = TopPlayerCards.invalidateCosmetics;

// ─── Grid Rendering ───────────────────────────────────────────────────────────
function renderGrid(state) {
    const { grid, rows, cols } = state;
    const activeCells   = new Set(state.activeCells   || []);
    const revealedCells = new Set(state.revealedCells || []);
    const replacedCells = new Set(state.replacedCells || []);
    const refreshedCells = new Set(state.finalRingRefreshedCells || []);

    gridContainer.style.setProperty('--grid-cols', cols);
    gridContainer.style.setProperty('--grid-rows', rows);
    gameBoard.style.setProperty('--grid-cols', cols);
    gridContainer.innerHTML = '';
    cells = [];
    gridRows = rows;
    gridCols = cols;
    lastPresentationState = {
        rows,
        cols,
        activeCells: [...activeCells],
        revealedCells: [...revealedCells],
        currentRing: state.currentRing || 0,
        totalRings: state.totalRings || 0
    };

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.index = idx;
            cell.dataset.letter = grid[r][c];

            const letterSpan = document.createElement('span');
            letterSpan.className = 'cell-letter';
            letterSpan.textContent = grid[r][c];

            const startsSpan = document.createElement('span');
            startsSpan.className = 'cell-starts';

            const usesSpan = document.createElement('span');
            usesSpan.className = 'cell-uses';

            cell.appendChild(letterSpan);
            cell.appendChild(startsSpan);
            cell.appendChild(usesSpan);

            applyCellState(cell, idx, activeCells, revealedCells, replacedCells, refreshedCells);
            gridContainer.appendChild(cell);
            cells.push(cell);
        }
    }

    scheduleBoardPresentationPublish('render-grid');
}

function applyCellState(cell, idx, activeCells, revealedCells, replacedCells, refreshedCells) {
    cell.classList.remove('greyed', 'ring-unrevealed', 'ring-replaced', 'letter-final-refresh');
    if (!revealedCells.has(idx)) {
        cell.classList.add('ring-unrevealed');
    } else if (!activeCells.has(idx)) {
        cell.classList.add('greyed');
    }
    // Replaced cells only show their shade when revealed
    if (revealedCells.has(idx) && replacedCells.has(idx)) {
        cell.classList.add('ring-replaced');
    }
    if (revealedCells.has(idx) && refreshedCells.has(idx)) {
        cell.classList.add('letter-final-refresh');
    }
}

function updateCellStates(state) {
    const activeCells   = new Set(state.activeCells   || []);
    const revealedCells = new Set(state.revealedCells || []);
    const replacedCells = new Set(state.replacedCells || []);
    const refreshedCells = new Set(state.finalRingRefreshedCells || []);
    lastPresentationState = {
        rows: state.rows || gridRows || 0,
        cols: state.cols || gridCols || 0,
        activeCells: [...activeCells],
        revealedCells: [...revealedCells],
        currentRing: state.currentRing || 0,
        totalRings: state.totalRings || 0
    };
    for (let i = 0; i < cells.length; i++) {
        if (cells[i]) applyCellState(cells[i], i, activeCells, revealedCells, replacedCells, refreshedCells);
    }
    scheduleBoardPresentationPublish('cell-state');
}

// ─── Letter Hints ─────────────────────────────────────────────────────────────
function updateLetterStats(letterStats, foundCommon, totalCommon) {
    if (!letterStats || cells.length === 0) return;
    const hintPct = totalCommon > 0 ? foundCommon / totalCommon : 0;
    const cellUsage      = letterStats.cellUsage      || {};
    const cellStartsWith = letterStats.cellStartsWith || {};
    const showUses   = hintPct >= 0.25;
    const showStarts = hintPct >= 0.50;
    for (const cell of cells) {
        const idx = parseInt(cell.dataset.index, 10);
        const isActive = !cell.classList.contains('greyed') && !cell.classList.contains('ring-unrevealed');
        const startsEl = cell.querySelector('.cell-starts');
        const usesEl   = cell.querySelector('.cell-uses');
        if (startsEl) {
            const count = cellStartsWith[idx] || 0;
            startsEl.textContent = (count > 0 && isActive && showStarts) ? (count >= 10 ? '+' : count) : '';
        }
        if (usesEl) {
            const count = cellUsage[idx] || 0;
            usesEl.textContent = (count > 0 && isActive && showUses) ? (count >= 10 ? '+' : count) : '';
        }
        // Blue tint for cells that still have findable common words
        if (isActive && (cellUsage[idx] || 0) > 0) {
            cell.classList.add('has-words');
        } else {
            cell.classList.remove('has-words');
        }
    }
}

// ─── Ring Progress ────────────────────────────────────────────────────────────
function updateRingProgress(state) {
    const currentRing    = state.currentRing    ?? 0;
    const totalRings     = (state.totalRings    ?? 1) - 1; // 0-indexed display
    const ringCommonFound = state.ringCommonFound ?? 0;
    const ringCommonTotal = state.ringCommonTotal ?? 0;
    const ringPhase      = state.ringPhase || 'ring';

    if (ringInfoEl) {
        if (ringPhase === 'complete') {
            ringInfoEl.textContent = 'Complete!';
        } else {
            const remaining = Math.max(0, ringCommonTotal - ringCommonFound);
            ringInfoEl.textContent = `Ring ${currentRing}/${totalRings} · ${remaining} word${remaining !== 1 ? 's' : ''} to grow`;
        }
    }

    if (ringProgressBar) {
        const pct = ringCommonTotal > 0 ? (ringCommonFound / ringCommonTotal) * 100 : 0;
        ringProgressBar.style.width = pct + '%';
    }
}

// ─── Word Count ───────────────────────────────────────────────────────────────
function updateWordCount(found, total) {
    foundCountEl.textContent = found;
    totalCountEl.textContent = total;
    progressBar.style.width = total > 0 ? (found / total * 100) + '%' : '0%';
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function updateBadges(state) {
    const dailyBadge      = document.getElementById('daily-badge');
    const frenzyBadge     = document.getElementById('frenzy-badge');
    const frenzyMultiplier = document.getElementById('frenzy-multiplier');
    if (dailyBadge) dailyBadge.style.display = state.isDaily ? '' : 'none';
    if (frenzyBadge && frenzyMultiplier) {
        const frenzy = state.frenzy;
        if (frenzy && frenzy.multiplier > 1) {
            frenzyMultiplier.textContent = frenzy.multiplier.toFixed(1) + 'x';
            frenzyBadge.style.display = '';
        } else {
            frenzyBadge.style.display = 'none';
        }
    }
}

function updateRareCounts(state) {
    const settings = loadSettings();
    const rareEl  = document.getElementById('rare-count');
    const ultraEl = document.getElementById('ultra-rare-count');
    if (settings.showFoundWords === false) {
        if (rareEl) rareEl.style.display = 'none';
        if (ultraEl) ultraEl.style.display = 'none';
        return;
    }
    const rareFound = Number(state.foundRareCount ?? (state.foundRareWords || []).length ?? 0);
    const rareTotal = Number(state.rareCount || 0);
    const ultraFound = Number(state.foundHiddenCount ?? (state.foundHiddenWords || []).length ?? 0);
    const ultraTotal = Number(state.hiddenCount || 0);

    if (rareEl) {
        rareEl.textContent = `${rareFound}/${rareTotal} rare`;
        rareEl.style.display = rareTotal > 0 ? '' : 'none';
    }
    if (ultraEl) {
        ultraEl.textContent = `${ultraFound}/${ultraTotal} ultra-rare`;
        ultraEl.style.display = ultraTotal > 0 ? '' : 'none';
    }
}

// ─── Top Players ──────────────────────────────────────────────────────────────
function updateTopPlayers(players) {
    if (!players || players.length === 0) { allPlayers = []; return; }
    allPlayers = players;
    // Animate score if word-announce is visible
    if (lastFoundUsername && wordAnnounceEl && !wordAnnounceEl.classList.contains('hidden')) {
        const updated = players.find(p => (p.displayName || p.name) === lastFoundUsername);
        if (updated && updated.score !== lastDisplayedScore) {
            animateCountUp(wordAnnounceScoreEl, lastDisplayedScore, updated.score);
            lastDisplayedScore = updated.score;
        }
    }
    renderTopPlayerCards(players);
}

function renderTopPlayerCards(players) {
    TopPlayerCards.renderTopPlayerCards('top-players', players);
}

function animateCountUp(el, from, to, duration = 800) {
    if (!el) return;
    const start = performance.now();
    const step = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = `${Math.round(from + (to - from) * eased)} pts`;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ─── Word Announcement Banner ─────────────────────────────────────────────────
function showWordAnnounce(data) {
    if (!wordAnnounceEl) return;
    const settings = loadSettings();
    if (settings.showFoundWords === false) {
        wordAnnounceEl.classList.add('hidden');
        return;
    }

    const serverPlayer = allPlayers.find(p => (p.displayName || p.name) === data.username);
    const profileImage = data.profilePic || (serverPlayer ? serverPlayer.profileImage : null);
    const score        = serverPlayer ? serverPlayer.score : null;

    // Avatar
    wordAnnounceAvatarEl.src = resolveAvatar(profileImage);
    wordAnnounceAvatarEl.style.display = '';
    wordAnnounceAvatarEl.onerror = function() { this.onerror = null; this.src = AVATAR_FALLBACK; };
    wordAnnounceAvatarFallbackEl.style.display = 'none';
    wordAnnounceAvatarFallbackEl.textContent = '';

    // Reset all cosmetic styles
    const _existingTitle = wordAnnounceEl.querySelector('.cosmetic-title');
    if (_existingTitle) _existingTitle.remove();
    wordAnnounceNameEl.style.cssText = '';
    wordAnnounceNameEl.textContent = data.username || 'Anonymous';
    TopPlayerCards.clearHeroBadge(wordAnnounceEl);
    wordAnnounceWordEl.style.cssText = '';
    wordAnnounceAvatarEl.style.cssText = wordAnnounceAvatarEl.style.display === 'none' ? 'display:none' : '';
    wordAnnounceAvatarFallbackEl.style.cssText = wordAnnounceAvatarFallbackEl.style.display === 'none' ? 'display:none' : 'display:flex';

    // Word + rarity class
    wordAnnounceWordEl.textContent = data.word.toUpperCase();
    const wordRarityClass = data.isThreeLetter ? 'three-letter' : (data.isRare || data.isHidden ? 'rare' : '');
    wordAnnounceWordEl.className = 'word-announce-word' + (wordRarityClass ? ' ' + wordRarityClass : '');

    // Rarity label + points
    const basePts = data.isThreeLetter ? 100 : (data.isHidden ? 1000 : (data.isRare ? 500 : 1500));
    const wordPts = basePts + (data.letterRarityBonus || 0) + (data.wordLengthBonus || 0);
    if (wordAnnounceRarityEl) {
        let rarityText, rarityClass;
        if (data.isThreeLetter)  { rarityText = '3-Letter';  rarityClass = 'rarity-three-letter'; }
        else if (data.isHidden)  { rarityText = 'Ultra Rare'; rarityClass = 'rarity-hidden'; }
        else if (data.isRare)    { rarityText = 'Rare';       rarityClass = 'rarity-rare'; }
        else                     { rarityText = 'Common';     rarityClass = 'rarity-common'; }
        wordAnnounceRarityEl.className = `word-announce-rarity ${rarityClass}`;
        wordAnnounceRarityEl.textContent = rarityText;
        wordAnnounceRarityEl.style.display = '';
    }
    if (wordAnnounceEarnedEl) {
        wordAnnounceEarnedEl.textContent = `+${wordPts.toLocaleString()}`;
        wordAnnounceEarnedEl.style.display = '';
    }

    // Score (animates up when game-state fires)
    lastFoundUsername  = data.username || null;
    lastDisplayedScore = score !== null ? score : 0;
    wordAnnounceScoreEl.textContent = score !== null ? `${score} pts` : '';

    // Persist for page-refresh recovery
    try {
        localStorage.setItem('sproutle_last_found', JSON.stringify({
            username: data.username || null,
            profilePic: profileImage || null,
            word: data.word,
            isThreeLetter: data.isThreeLetter || false,
            isRare: data.isRare || false,
            isHidden: data.isHidden || false
        }));
    } catch (e) {}

    wordAnnounceToken += 1;
    wordAnnounceEl.classList.remove('hidden', 'fading');
    void wordAnnounceEl.offsetWidth; // restart slide-in animation
}

function getVisibleCosmetics(cos) {
    const filtered = Object.assign({}, cos || {});
    // Viewer-side cosmetic visibility filtering
    var vis = window.__COSMETIC_VISIBILITY;
    if (vis) { for (var c in vis) { if (vis[c] === false) delete filtered[c]; } }
    return filtered;
}

function getWordCosmeticStyles(cos) {
    if (!cos) return null;
    const wColor = cos.word_color;
    const wGlow = cos.word_glow;
    if (!wColor && !wGlow) return null;
    return {
        color: (wColor && wColor.color) || '',
        textShadow: (wGlow && wGlow.textShadow) || '',
        animation: (wColor && wColor.animation) || (wGlow && wGlow.animation) || ''
    };
}

function clearWordCosmetics(targetEl) {
    if (!targetEl) return;
    targetEl.style.color = '';
    targetEl.style.textShadow = '';
    targetEl.style.animation = '';
}

function applyWordCosmetics(targetEl, wordStyles, withAnimation) {
    if (!targetEl) return;
    clearWordCosmetics(targetEl);
    if (!wordStyles) return;
    if (wordStyles.color) targetEl.style.color = wordStyles.color;
    if (wordStyles.textShadow) targetEl.style.textShadow = wordStyles.textShadow;
    if (withAnimation && wordStyles.animation) targetEl.style.animation = wordStyles.animation;
}

function applyAnnounceCosmetics(cos) {
    if (!wordAnnounceEl || wordAnnounceEl.classList.contains('hidden')) return;
    cos = getVisibleCosmetics(cos);
    // Name color
    if (cos.name_color && wordAnnounceNameEl) {
        if (cos.name_color.color)     wordAnnounceNameEl.style.color     = cos.name_color.color;
        if (cos.name_color.animation) wordAnnounceNameEl.style.animation = cos.name_color.animation;
    }
    // Name glow
    if (cos.name_glow && wordAnnounceNameEl) {
        if (cos.name_glow.textShadow) wordAnnounceNameEl.style.textShadow = cos.name_glow.textShadow;
        if (cos.name_glow.animation && !wordAnnounceNameEl.style.animation) wordAnnounceNameEl.style.animation = cos.name_glow.animation;
    }
    // Title
    // Title cosmetic intentionally not displayed on erectangled — keeps the
    // word-announce card legible and avoids overflowing the name field.
    const _existingTitle2 = wordAnnounceEl.querySelector('.cosmetic-title');
    if (_existingTitle2) _existingTitle2.remove();
    // Word color
    if (wordAnnounceWordEl) {
        applyWordCosmetics(wordAnnounceWordEl, getWordCosmeticStyles(cos), true);
    }
    // Profile border
    const avatarEl = wordAnnounceAvatarEl.style.display !== 'none' ? wordAnnounceAvatarEl : wordAnnounceAvatarFallbackEl;
    // ring + glow via the shared applier
    if (avatarEl) pfpxApply(avatarEl, avatarEl.parentElement || avatarEl, cos);
    // Hero badge
    TopPlayerCards.applyHeroBadge(wordAnnounceEl, cos);
}

// The shared ring/word applier + keyframes live on the relay, so every
// game renders a cosmetic identically. Loaded from there: no game HTML
// and no nginx allowlist entry has to change.
function pfpxHubBase() {
  var h = (window.location && window.location.hostname) || '';
  return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3000' : 'https://wordtycoon.live';
}
var _pfpxQueue = [];
function _pfpxFlush() {
  if (!window.PfpCosmetics) return;
  var q = _pfpxQueue.splice(0);
  for (var i = 0; i < q.length; i++) {
    if (q[i][0] && q[i][0].isConnected) pfpxApply(q[i][0], q[i][1], q[i][2]);
  }
}
(function () {
  try {
    var base = pfpxHubBase();
    if (!document.querySelector('link[href*="cosmetics-fx.css"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = base + '/css/cosmetics-fx.css?v=2';
      document.head.appendChild(l);
    }
    if (window.PfpCosmetics) return;
    var ex = document.querySelector('script[src*="pfp-cosmetics.js"]');
    if (ex) { ex.addEventListener('load', _pfpxFlush); return; }
    var sc = document.createElement('script');
    sc.src = base + '/js/pfp-cosmetics.js?v=15';
    sc.addEventListener('load', _pfpxFlush);
    document.head.appendChild(sc);
  } catch (e) { /* older CEF */ }
})();
function pfpxApply(avatarEl, shellEl, cos) {
  if (!avatarEl || !cos) return;
  if (!window.PfpCosmetics) { _pfpxQueue.push([avatarEl, shellEl, cos]); return; }
  window.PfpCosmetics.apply(avatarEl, shellEl || avatarEl.parentElement || avatarEl, cos);
}
// ─── Word Path Animation ──────────────────────────────────────────────────────
// cosPromise: optional Promise<cosmetics> — resolves into a ref so each staggered
// cell setTimeout can read it at the moment it fires, guaranteeing correct timing.
// word_color and word_glow are layered on the lit letter; cleaned
// up in Phase 3 so idle cells always return to their default appearance.
function animateWordPath(cellIndices, isRare, isHidden, isThreeLetter, cosPromise, meta) {
    if (!cellIndices || cellIndices.length === 0) return;
    const stagger  = 300;
    const holdTime = 1500;
    const highlightCls = isThreeLetter ? 'three-letter-highlight'
                       : isHidden      ? 'hidden-highlight'
                       : isRare        ? 'rare-highlight'
                       :                 'found-highlight';

    // ── Per-letter XP fly-out ────────────────────────────────────────
    // Uses the overlay's OWN stagger so each number pops as its tile lights,
    // rather than the faster cadence the in-game boards use. The announce
    // banner is populated by showWordAnnounce() before this runs, so the
    // reactor can rewind its total by the letter sum and tick it back up.
    if (window.XpFlyout && meta && meta.word) {
        Promise.resolve(cosPromise || null).then(function (cos) {
            XpFlyout.spawn({
                word: meta.word,
                cellEls: cellIndices.map(function (i) { return cells[i]; }),
                gridEl: gridContainer,
                stagger: stagger,
                targetSelectors: ['#word-announce-earned', '#word-announce-score', '#found-count'],
                cosmetics: (cos && typeof getVisibleCosmetics === 'function') ? getVisibleCosmetics(cos) : cos,
                onArrive: XpFlyout.reactor({
                    counterEl:   document.getElementById('word-announce-earned'),
                    letterTotal: XpFlyout.letterTotal(meta.word),
                    pulseEls:    [document.getElementById('word-announce'),
                                  XpFlyout.podiumCard('top-players', meta)]
                })
            });
        }).catch(function () {});
    }

    // Resolve cosmetics into a plain ref so staggered setTimeouts can read it synchronously.
    // Cached promises resolve as microtasks — before any setTimeout fires — so wordCos is
    // set before even the first cell lights up when cosmetics are already in cache.
    let wordCos = null;
    if (cosPromise) {
        cosPromise.then(cos => {
            cos = getVisibleCosmetics(cos);
            wordCos = getWordCosmeticStyles(cos);
            if (wordCos) {
                cellIndices.forEach(idx => {
                    const cell = cells[idx];
                    if (!cell || !cell.classList.contains(highlightCls)) return;
                    const letterEl = cell.querySelector('.cell-letter');
                    if (letterEl) applyWordCosmetics(letterEl, wordCos, false);
                });
            }
        }).catch(() => {});
    }

    cellIndices.forEach((idx, i) => {
        const cell = cells[idx];
        if (cell) setTimeout(() => {
            cell.classList.remove('found-fadeout');
            cell.classList.add(highlightCls);
            if (wordCos) {
                const letterEl = cell.querySelector('.cell-letter');
                if (letterEl) applyWordCosmetics(letterEl, wordCos, false);
            }
        }, i * stagger);
    });

    const totalAnim = cellIndices.length * stagger + holdTime;
    setTimeout(() => {
        cellIndices.forEach(idx => {
            const cell = cells[idx];
            if (cell) {
                cell.classList.add('found-fadeout');
                cell.classList.remove(highlightCls);
            }
        });
        setTimeout(() => {
            cellIndices.forEach(idx => {
                const cell = cells[idx];
                if (!cell) return;
                cell.classList.remove('found-fadeout');
                // Reset any word cosmetics applied to the letter
                const letterEl = cell.querySelector('.cell-letter');
                if (letterEl) clearWordCosmetics(letterEl);
            });
        }, 1000);
    }, totalAnim);
}

// ─── Ring Reveal Animation ────────────────────────────────────────────────────
function animateRingReveal(newCellIndices) {
    if (!newCellIndices || newCellIndices.length === 0) return;
    newCellIndices.forEach((idx, i) => {
        const cell = cells[idx];
        if (!cell) return;
        setTimeout(() => {
            cell.classList.remove('ring-unrevealed', 'ring-reveal');
            void cell.offsetWidth;
            cell.classList.add('ring-reveal');
            setTimeout(() => cell.classList.remove('ring-reveal'), 800);
        }, i * 60);
    });
}

// ─── Incorrect Guess Tags ─────────────────────────────────────────────────────
const MAX_INCORRECT = 20;
const incorrectPlaceholder = document.getElementById('word-announce-placeholder');

function addIncorrectTag(cls, text) {
    // Hide placeholder while tags are visible
    if (incorrectPlaceholder) incorrectPlaceholder.style.visibility = 'hidden';

    // Remove oldest tag when full
    while (incorrectArea.querySelectorAll('.incorrect-word, .already-found-tag, .correct-word-tag').length >= MAX_INCORRECT) {
        const oldest = incorrectArea.querySelector('.incorrect-word, .already-found-tag, .correct-word-tag');
        if (oldest) oldest.remove();
    }
    const tag = document.createElement('span');
    tag.className = cls;
    tag.textContent = text;
    incorrectArea.appendChild(tag);
}

// ─── Display Settings ─────────────────────────────────────────────────────────
function applyDisplaySettings(settings) {
    const gameFrame = document.querySelector('.game-frame');
    if (gameFrame) gameFrame.classList.toggle('light-mode', !!settings.lightMode);
    const root = document.documentElement;
    if (settings.letterScale !== undefined) root.style.setProperty('--letter-scale', settings.letterScale);
    if (settings.numberScale !== undefined) root.style.setProperty('--number-scale', settings.numberScale);
    const showFoundWords = settings.showFoundWords !== false;
    const badgeWrap = document.querySelector('.top-bar-badges');
    if (badgeWrap) badgeWrap.style.display = showFoundWords ? '' : 'none';
    if (wordAnnounceEl) {
        wordAnnounceEl.style.display = showFoundWords ? '' : 'none';
        if (!showFoundWords) wordAnnounceEl.classList.add('hidden');
    }
}

// ─── Win Screen ───────────────────────────────────────────────────────────────
function showCompleteScreen(data) {
    // In streamer-session mode the win popup is handled by the chat-relay
    // overlay (/win-overlay?streamer=<handle>) — keep mid-game state updates
    // but skip the built-in completion card.
    if (SESSION_HANDLE) {
        const stats = data.stats || data;
        updateBadges(stats);
        updateCellStates(stats);
        return;
    }
    const stats = data.stats || data;
    updateBadges(stats);
    updateCellStates(stats);

    const fc = stats.foundCommonCount || 0;
    const fr = stats.foundRareCount   || 0;
    const fh = stats.foundHiddenCount || 0;
    let statsLine = `${fc} common word${fc !== 1 ? 's' : ''} found!`;
    const bonusParts = [];
    if (fr > 0) bonusParts.push(`${fr} rare`);
    if (fh > 0) bonusParts.push(`${fh} ultra rare`);
    if (bonusParts.length) statsLine += ` + ${bonusParts.join(' + ')} bonus`;
    completeStats.textContent = statsLine;

    // Top 3 podium
    const winTopEl = document.getElementById('win-top-players');
    const players  = stats.topPlayers || [];
    const crowns   = ['\u{1F451}', '\u{1FA76}', '\u{1F949}'];
        if (winTopEl) {
            winTopEl.innerHTML = players.slice(0, 3).map((p, i) => {
                const name    = (p.displayName || 'Player').replace(/</g, '&lt;');
                const initial = (name[0] || '?').toUpperCase();
                const avatar = `<span class="win-player-avatar-wrap"><img class="win-player-avatar" src="${resolveAvatar(p.profileImage).replace(/"/g, '&quot;')}" alt="" onerror="this.onerror=null;this.src='${AVATAR_FALLBACK}'"></span>`;
                return `<div class="win-player"><span class="win-player-crown">${crowns[i]}</span>${avatar}<span class="win-player-name">${name}</span><span class="win-player-score">${p.score.toLocaleString()} pts</span></div>`;
            }).join('');
            if (typeof TopPlayerCards !== 'undefined') TopPlayerCards.hydrateWinPlayerCards(winTopEl, players.slice(0, 3));
        }

    // Scrolling list (4th place and beyond)
    const scrollEl = document.getElementById('win-scroll-list');
    if (scrollEl) {
        if (window._winScrollTimer) { clearInterval(window._winScrollTimer); window._winScrollTimer = null; }
        const scrollPlayers = players.slice(3);
            if (scrollPlayers.length > 0) {
                scrollEl.innerHTML = scrollPlayers.map((p, i) => {
                    const name   = (p.displayName || 'Player').replace(/</g, '&lt;');
                    const avatar = `<span class="win-player-avatar-wrap win-player-avatar-wrap--small"><img class="win-player-avatar" src="${resolveAvatar(p.profileImage).replace(/"/g, '&quot;')}" alt="" style="width:24px;height:24px;flex-shrink:0" onerror="this.onerror=null;this.src='${AVATAR_FALLBACK}'"></span>`;
                    return `<div class="win-scroll-player" style="animation-delay:${(i * 0.05).toFixed(2)}s"><span class="win-scroll-rank">#${i + 4}</span>${avatar}<span class="win-scroll-name">${name}</span><span class="win-scroll-score">${p.score.toLocaleString()}</span></div>`;
                }).join('');
                if (typeof TopPlayerCards !== 'undefined') TopPlayerCards.hydrateWinPlayerCards(scrollEl, scrollPlayers);
                scrollEl.scrollTop = 0;
                scrollEl.style.display = '';
            window._winScrollTimer = setInterval(() => {
                if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2) scrollEl.scrollTop = 0;
                else scrollEl.scrollTop += 1;
            }, 50);
        } else {
            scrollEl.innerHTML = '';
            scrollEl.style.display = 'none';
        }
    }

    // Countdown
    const winCountdownEl = document.getElementById('win-countdown');
    if (winCountdownEl) {
        let remaining = data.countdown || 30;
        winCountdownEl.textContent = `New game in ${remaining}s`;
        if (window._winCountdownTimer) clearInterval(window._winCountdownTimer);
        window._winCountdownTimer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(window._winCountdownTimer);
                window._winCountdownTimer = null;
                winCountdownEl.textContent = 'Starting...';
            } else {
                winCountdownEl.textContent = `New game in ${remaining}s`;
            }
        }, 1000);
    }

    completeOverlay.classList.remove('hidden');
}

// ─── Load Game State ──────────────────────────────────────────────────────────
function loadState(state) {
    if (!state || !state.grid) return;
    _lastGameId = state.puzzleId || state.startTime || null;
    renderGrid(state);
    updateWordCount(state.foundCommonCount || 0, state.commonCount || 0);
    updateRingProgress(state);
    updateBadges(state);
    updateRareCounts(state);
    updateLetterStats(state.letterStats, state.ringCommonFound ?? 0, state.ringCommonTotal ?? 0);
    if (state.topPlayers) updateTopPlayers(state.topPlayers);
    if (state.displaySettings) applyDisplaySettings(state.displaySettings);

    // Restore last-found card if word is still in this game's found set
    try {
        const stored = localStorage.getItem('sproutle_last_found');
        if (stored) {
            const d = JSON.parse(stored);
            const foundWords = new Set(state.foundWords || []);
            if (d && d.word && foundWords.has(d.word)) showWordAnnounce(d);
        }
    } catch (e) {}
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
let _currentEvtSource = null;
let _lastGameId = null;
let _lastSSEEvent = Date.now();

// Periodic sync — fetches full state every 20s to catch missed events
setInterval(async () => {
    try {
        // If no SSE event in 45s, connection is dead — force reconnect
        if (Date.now() - _lastSSEEvent > 45000) {
            console.log('[overlay] No SSE events for 45s, reconnecting...');
            _lastSSEEvent = Date.now(); // prevent rapid reconnects
            connectSSE();
        }

        const r = await fetch(STATE_URL);
        if (!r.ok) return;
        const state = await r.json();
        if (!state || !state.grid) return;
        const gameId = state.puzzleId || state.startTime || null;
        // Detect new game that we missed — full reload
        if (_lastGameId && gameId && gameId !== _lastGameId) {
            console.log('[overlay] Sync detected new game, full reload');
            completeOverlay.classList.add('hidden');
            if (wordAnnounceEl) wordAnnounceEl.classList.add('hidden');
            try { localStorage.removeItem('sproutle_last_found'); } catch (e) {}
            loadState(state);
        }
        _lastGameId = gameId;
        // Always sync everything — grid, word count, ring progress, cells, players
        updateWordCount(state.foundCommonCount || 0, state.commonCount || 0);
        updateRingProgress(state);
        updateRareCounts(state);
        updateBadges(state);
        updateCellStates(state);
        updateLetterStats(state.letterStats, state.ringCommonFound ?? 0, state.ringCommonTotal ?? 0);
        if (state.topPlayers) updateTopPlayers(state.topPlayers);
        // Sync grid letters
        if (state.grid && typeof state.cols === 'number') {
            for (let i = 0; i < cells.length; i++) {
                if (!cells[i]) continue;
                const row = Math.floor(i / state.cols);
                const col = i % state.cols;
                if (!state.grid[row] || state.grid[row][col] === undefined) continue;
                const letterEl = cells[i].querySelector('.cell-letter');
                if (letterEl && letterEl.textContent !== state.grid[row][col]) {
                    letterEl.textContent = state.grid[row][col];
                    cells[i].dataset.letter = state.grid[row][col];
                }
            }
        }
    } catch (e) { /* ignore fetch errors */ }
}, 20000);

function connectSSE() {
    if (_currentEvtSource) { try { _currentEvtSource.close(); } catch(e){} }
    // In session mode the public SSE channel carries the public game's
    // events, NOT this streamer's. Use a synthetic EventTarget instead;
    // connectSocket() bridges per-session socket.io events onto it so the
    // same addEventListener handlers below fire from session room emits.
    const evtSource = SESSION_HANDLE
        ? Object.assign(new EventTarget(), { close() {}, readyState: 1 })
        : new EventSource('api/events');
    _currentEvtSource = evtSource;

    // ─── End-of-round celebration hold ──────────────────────────────
    // The server builds the next board in the same tick it announces the win,
    // so 'game-over' and 'new-game' arrive together. Applied straight away,
    // new-game hid the completion overlay and the word announce and reloaded
    // the grid while the winning word was still flashing — on stream the
    // round just blinked over. Hold the new board until it has played.
    //
    // Only a completion opens the window, so an admin new-game or the first
    // state after connect still lands immediately.
    const ROUND_CELEBRATION_MS = 5000;
    let celebrationUntil = 0;
    let heldState = null, heldIsNewGame = false, heldTimer = null;

    function startFreshBoard(state) {
        if (window._winScrollTimer)    { clearInterval(window._winScrollTimer);    window._winScrollTimer    = null; }
        if (window._winCountdownTimer) { clearInterval(window._winCountdownTimer); window._winCountdownTimer = null; }
        completeOverlay.classList.add('hidden');
        if (wordAnnounceEl) wordAnnounceEl.classList.add('hidden');
        try { localStorage.removeItem('sproutle_last_found'); } catch (e) {}
        resetRotation();
        startAutoRotate();
        loadState(state);
    }

    function flushHeldState() {
        heldTimer = null;
        if (!heldState) return;
        const state = heldState, isNew = heldIsNewGame;
        heldState = null; heldIsNewGame = false;
        if (isNew) startFreshBoard(state); else applyStateUpdate(state);
    }

    // Board-changing updates route through here. During the celebration the
    // freshest state is kept back and applied once, so a guess landing on the
    // new board mid-window can't repaint the grid early either.
    function applyOrHold(state, isNewGame) {
        const wait = celebrationUntil - Date.now();
        if (wait <= 0) {
            if (isNewGame) startFreshBoard(state); else applyStateUpdate(state);
            return;
        }
        heldState = state;
        heldIsNewGame = heldIsNewGame || isNewGame;
        if (!heldTimer) heldTimer = setTimeout(flushHeldState, wait);
    }

    evtSource.addEventListener('new-game', (e) => {
        _lastSSEEvent = Date.now();
        applyOrHold(JSON.parse(e.data), true);
    });

    evtSource.addEventListener('game-state', (e) => {
        _lastSSEEvent = Date.now();
        applyOrHold(JSON.parse(e.data), false);
    });

    function applyStateUpdate(state) {
        if (state.rows) gridRows = state.rows;
        if (state.cols) gridCols = state.cols;
        updateBadges(state);
        updateWordCount(state.foundCommonCount || 0, state.commonCount || 0);
        updateRingProgress(state);
        updateCellStates(state);
        updateRareCounts(state);
        updateLetterStats(state.letterStats, state.ringCommonFound ?? 0, state.ringCommonTotal ?? 0);
        if (state.topPlayers) updateTopPlayers(state.topPlayers);
        // Sync cell letter text with server grid (catches _refreshStrandedInNewRing changes)
        if (state.grid && typeof state.cols === 'number') {
            for (let i = 0; i < cells.length; i++) {
                if (!cells[i]) continue;
                const r = Math.floor(i / state.cols);
                const c = i % state.cols;
                if (!state.grid[r] || state.grid[r][c] === undefined) continue;
                const newLetter = state.grid[r][c];
                const letterEl = cells[i].querySelector('.cell-letter');
                if (letterEl && letterEl.textContent !== newLetter) {
                    letterEl.textContent = newLetter;
                    cells[i].dataset.letter = newLetter;
                }
            }
        }
    }

    evtSource.addEventListener('word-found', (e) => {
        _lastSSEEvent = Date.now();
        const data = JSON.parse(e.data);

        // Show green found tag
        addIncorrectTag('correct-word-tag', (data.word || '') + ' ✓');

        showWordAnnounce({
            username:      data.displayName,
            profilePic:    data.profilePic,
            word:          data.word,
            isRare:        data.isRare        || false,
            isHidden:      data.isHidden      || false,
            isThreeLetter: data.isThreeLetter || false,
            letterRarityBonus: data.letterRarityBonus || 0,
            wordLengthBonus:   data.wordLengthBonus   || 0,
            platform:          data.platform || null,
            platformUserId:    data.platformUserId || null,
        });
        const announceToken = wordAnnounceToken;

        // Build cosmetics promise once — shared between the banner and the cell animation
        const cosPromise = (data.platform && data.platformUserId)
            ? getCosmetics(data.platform, data.platformUserId)
            : null;

        if (data.cells && data.cells.length > 0) {
            animateWordPath(data.cells, data.isRare, data.isHidden, data.isThreeLetter, cosPromise, data);
        }

        // Ring reveal animation fires after the word-path animation finishes
        if (data.ringAdvanced && data.newRevealedCells && data.newRevealedCells.length > 0) {
            const pathDelay = (data.cells ? data.cells.length * 300 + 1500 : 0) + 400;
            // Smart-rotate so the newly revealed cells are at the visual top
            smartRotateForNewCells(data.newRevealedCells, gridRows, gridCols);
            setTimeout(() => animateRingReveal(data.newRevealedCells), pathDelay);
        }

        // Animate newly-revealed cells that got new letters (fires after ring reveal finishes)
        if (data.refreshedLetters && Object.keys(data.refreshedLetters).length > 0) {
            const pathDelay = (data.cells ? data.cells.length * 300 + 1500 : 0) + 400;
            const ringRevealDuration = data.newRevealedCells ? data.newRevealedCells.length * 60 + 900 : 0;
            const letterDelay = pathDelay + ringRevealDuration + 200;
            setTimeout(() => {
                for (const [idxStr, letter] of Object.entries(data.refreshedLetters)) {
                    const idx = parseInt(idxStr, 10);
                    const cell = cells[idx];
                    if (!cell) continue;
                    const letterEl = cell.querySelector('.cell-letter');
                    if (letterEl) letterEl.textContent = letter;
                    cell.dataset.letter = letter;
                    cell.classList.remove('ring-letter-change');
                    void cell.offsetWidth;
                    cell.classList.add('ring-letter-change');
                    // Final ring: also add permanent lighter-blue after flash animation
                    if (data.isFinalRing) {
                        setTimeout(() => {
                            cell.classList.remove('ring-letter-change');
                            cell.classList.add('letter-final-refresh');
                        }, 800);
                    } else {
                        setTimeout(() => cell.classList.remove('ring-letter-change'), 800);
                    }
                }
            }, letterDelay);
        }

        // Apply banner cosmetics using the same promise (no second fetch)
        if (cosPromise) {
            cosPromise.then(cos => {
                if (announceToken === wordAnnounceToken && cos && Object.keys(cos).length > 0) {
                    applyAnnounceCosmetics(cos);
                }
            }).catch(() => {});
        }
    });

    evtSource.addEventListener('game-over', (e) => {
        _lastSSEEvent = Date.now();
        // Opens the hold window before the completion screen is drawn, so the
        // new board can't land on top of it.
        celebrationUntil = Date.now() + ROUND_CELEBRATION_MS;
        showCompleteScreen(JSON.parse(e.data));
    });

    evtSource.addEventListener('frenzy-update', (e) => {
        const frenzy          = JSON.parse(e.data);
        const frenzyBadge     = document.getElementById('frenzy-badge');
        const frenzyMultiplier = document.getElementById('frenzy-multiplier');
        if (frenzyBadge && frenzyMultiplier) {
            if (frenzy && frenzy.multiplier > 1) {
                frenzyMultiplier.textContent = frenzy.multiplier.toFixed(1) + 'x';
                frenzyBadge.style.display = '';
            } else {
                frenzyBadge.style.display = 'none';
            }
        }
    });

    evtSource.addEventListener('display', (e) => {
        applyDisplaySettings(JSON.parse(e.data));
    });

    evtSource.addEventListener('chat-guess', (e) => {
        const data = JSON.parse(e.data);
        if (data.result === 'incorrect') addIncorrectTag('incorrect-word', data.word || '');
        else if (data.result === 'already_found') addIncorrectTag('already-found-tag', (data.word || '') + ' ✓');
    });

    // Skip SSE error/reconnect plumbing in session mode (no network SSE).
    if (!SESSION_HANDLE) {
        evtSource.onerror = () => {
            console.log('[eRecTangled overlay] SSE disconnected');
            // If EventSource is CLOSED (won't auto-reconnect), manually reconnect
            if (evtSource.readyState === EventSource.CLOSED) {
                console.log('[eRecTangled overlay] SSE closed, reconnecting in 3s...');
                setTimeout(async () => {
                    connectSSE();
                    // Refetch full state after reconnect to catch anything missed
                    try {
                        const r = await fetch(STATE_URL);
                        if (r.ok) {
                            const state = await r.json();
                            if (state && state.grid) loadState(state);
                        }
                    } catch (e) {}
                }, 3000);
            }
        };
    }
}

// ─── Socket.IO (cosmetics-updated only) ──────────────────────────────────────
function connectSocket(wsUrl) {
    if (typeof io === 'undefined') return;
    // Session mode: open a SECOND socket to sproutle's same-origin socket.io
    // (NOT chat-relay's wsUrl — chat-relay doesn't host the session room).
    // auth.session makes sproutle join this socket to the streamer's session
    // room; then mirror its room emits onto the EventTarget so the existing
    // SSE handlers (word-found, chat-guess, etc.) fire from session events.
    if (SESSION_HANDLE && _currentEvtSource && typeof _currentEvtSource.dispatchEvent === 'function') {
        const sessionSocket = io({
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 30000,
            transports: ['websocket', 'polling'],
            auth: { session: SESSION_HANDLE }
        });
        const replay = (name) => (data) => {
            _lastSSEEvent = Date.now();
            _currentEvtSource.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data || {}) }));
        };
        sessionSocket.on('word-found', replay('word-found'));
        sessionSocket.on('chat-guess', replay('chat-guess'));
        sessionSocket.on('new-game', replay('new-game'));
        sessionSocket.on('game-state', replay('game-state'));
        sessionSocket.on('game-over', replay('game-over'));
        sessionSocket.on('connect', () => console.log(`[eRecTangled overlay] session socket connected (${SESSION_HANDLE})`));
        sessionSocket.on('disconnect', () => console.log('[eRecTangled overlay] session socket disconnected'));
    }
    const socket = io(wsUrl, {
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 30000,
        transports: ['websocket', 'polling']
    });
    socket.on('cosmetics-updated', (data) => {
        if (data && data.platform && data.platformUserId) {
            invalidateCosmetics(data.platform, data.platformUserId, data.equipped);
            // Live re-apply to any currently-displayed top player card for this user
            if (data.equipped) {
                const container = document.getElementById('top-players');
                if (container) {
                    const card = container.querySelector('[data-platform="' + data.platform + '"][data-userid="' + data.platformUserId + '"]');
                    if (card) TopPlayerCards.applyCardCosmetics(card, data.equipped);
                }
            }
        }
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Load viewer cosmetic visibility preferences (viewer-side filtering)
try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

async function init() {
    const settings = loadSettings();
    applyDisplaySettings(settings);

    loadingText.textContent = 'Connecting...';
    loadingOverlay.classList.remove('hidden');

    let serverState = null;
    try {
        const r = await fetch(STATE_URL);
        if (r.ok) serverState = await r.json();
    } catch (e) {
        console.warn('[eRecTangled overlay] Could not fetch state:', e.message);
    }

    if (serverState && serverState.grid) {
        loadState(serverState);
    } else {
        updateWordCount(0, 0);
    }

    connectSSE();
    connectSocket(settings.wsUrl);
    startAutoRotate();

    // Re-apply settings if admin changes them
    window.addEventListener('storage', (e) => {
        if (e.key === 'sproutle_settings') applyDisplaySettings(loadSettings());
    });

    loadingOverlay.classList.add('hidden');
    console.log('[eRecTangled overlay] Ready');
}

init();

})();
