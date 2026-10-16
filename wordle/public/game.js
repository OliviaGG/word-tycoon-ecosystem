// ===== Viewport Scaling =====
// Designed for baseWidth (380px). Larger viewports scale proportionally
// so the game looks identical at any resolution (e.g. 1140×1800 = 3× scale).
(function () {
  var BASE = 380;
  var actualW = window.innerWidth;
  var actualH = window.innerHeight;
  var scale = actualW / BASE;

  // Expose effective viewport for other scripts (coin-reward, win-effects)
  var baseH = Math.round(actualH / scale);
  window.__gameScale = scale;
  window.__gameViewport = { width: BASE, height: baseH };

  if (Math.abs(scale - 1) > 0.01) {
    var html = document.documentElement;
    html.style.width = BASE + 'px';
    html.style.height = baseH + 'px';
    html.style.overflow = 'hidden';
    html.style.transformOrigin = '0 0';
    html.style.transform = 'scale(' + scale + ')';
  }

  // Set CSS custom properties for base dimensions (used by animations)
  document.documentElement.style.setProperty('--base-width', BASE + 'px');
  document.documentElement.style.setProperty('--base-height', baseH + 'px');
})();

(() => {
  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  const _sessHandle = (function () {
    try {
      const q = new URLSearchParams(location.search).get('session');
      if (q && /^[a-z0-9_-]{1,32}$/.test(q)) return q;
      const m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})$/i);
      if (m && m[1]) {
        const h = m[1].toLowerCase();
        const RES = new Set(['admin', 'overlay', 'index.html', 'mp.html', 'sp.html', 'overlay.html']);
        if (!RES.has(h)) return h;
      }
    } catch (e) {}
    return null;
  })();
  window.__SESSION_HANDLE = _sessHandle;
  const socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
  socket.on('session-redirect', function (data) {
    if (!data || !data.targetUrl) return;
    try {
      var isOverlay = !document.body || document.body.dataset.mode !== 'mp';
      if (isOverlay) return;
      if (document.getElementById('session-redirect-modal')) return;
      var ov = document.createElement('div');
      ov.id = 'session-redirect-modal';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:inherit';
      var card = document.createElement('div');
      card.style.cssText = 'background:#1a1f2e;border:1px solid #2a3148;border-radius:14px;padding:28px;max-width:340px;width:88%;text-align:center;color:#fff';
      var tname = (data.targetGameName || 'a different game').replace(/[<>"]/g, '');
      card.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:8px">Streamer switched games</div><div style="opacity:.8;font-size:14px;margin-bottom:18px">They\'re now playing <b>' + tname + '</b>.</div>';
      var b1 = document.createElement('button');
      b1.textContent = 'Follow streamer →';
      b1.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#5865F2,#a855f7);color:#fff;font-size:14px;font-weight:700;margin-bottom:8px;cursor:pointer';
      b1.onclick = function () { window.location.href = data.targetUrl; };
      var b2 = document.createElement('button');
      b2.textContent = 'Play public version';
      b2.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2a3148;background:#0f1320;color:#cbd5e1;font-size:14px;font-weight:700;cursor:pointer';
      b2.onclick = function () { window.location.href = location.origin + '/'; };
      card.appendChild(b1); card.appendChild(b2);
      ov.appendChild(card);
      document.body.appendChild(ov);
    } catch (e) {}
  });

  // DOM refs
  const grid = document.getElementById('grid');
  const lastWinnerEl = document.getElementById('lastWinner');
  const badgesBar = document.getElementById('badges-bar');
  const dailyBadge = document.getElementById('daily-badge');
  const frenzyBadge = document.getElementById('frenzy-badge');
  const frenzyMultEl = document.getElementById('frenzy-mult');

  // Config
  let wordLength = 5;

  // Tile / grid sizing constants
  const MAX_TILE = 70;
  const GAP = 8;
  const MAX_GRID = 500; // cap for very long words

  // Compute snug grid width for a given word length
  function getGridWidth(wLen) {
    return Math.min(MAX_GRID, wLen * MAX_TILE + (wLen - 1) * GAP);
  }

  // Push the computed width into the CSS variable so the frame contours to the word
  function updateGridWidth(wLen) {
    document.documentElement.style.setProperty('--grid-width', getGridWidth(wLen) + 'px');
  }

  // Dynamic row count: keep grid same visual height regardless of word length
  // Baseline: 6 rows of 5-letter tiles
  function getMaxVisibleRows(wLen) {
    const gridWidth = getGridWidth(wLen);
    const labelH = 16;

    function tileSize(len) {
      return Math.min(MAX_TILE, (gridWidth - GAP * (len - 1)) / len);
    }

    const refGridW = getGridWidth(5);
    const refTile = Math.min(MAX_TILE, (refGridW - GAP * 4) / 5);
    const refHeight = 6 * (refTile + labelH + 2 * GAP) - GAP;

    const curTile = tileSize(wLen);
    const curPerRow = curTile + labelH + 2 * GAP;

    return Math.max(6, Math.round((refHeight + GAP) / curPerRow));
  }

  // --- Win card (shared WinCard component) ---

  function showWinCard(data) {
    if (!window.WinCard || !data || !data.winner) return;
    WinCard.showMp({
      game: 'wordle',
      gameName: 'Wordle',
      winner: data.winner,
      totalWins: data.totalWins || undefined, // 0 (session rounds) -> lazy-fetch from hub
      word: data.word,
      guessCount: data.guessCount,
      jackpot: data.jackpot,
      isDaily: data.isDaily
    });
  }

  // --- Grid: scrolling feed of guesses ---

  function clearGrid() {
    grid.innerHTML = '';
  }

  function showBlankRow() {
    const row = document.createElement('div');
    row.className = 'row blank-row';
    for (let i = 0; i < wordLength; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile blank';
      row.appendChild(tile);
    }
    grid.appendChild(row);
  }

  function countVisibleRows() {
    return grid.querySelectorAll('.row:not(.exiting)').length;
  }

  function removeOldestRow() {
    // Find the bottom-most non-exiting row and its player label
    const rows = grid.querySelectorAll('.row:not(.exiting)');
    const labels = grid.querySelectorAll('.row-player:not(.exiting)');

    if (rows.length === 0) return;

    // The bottom row is the OLDEST (first child)
    const oldestRow = rows[rows.length - 1];
    const oldestLabel = labels[labels.length - 1];

    oldestRow.classList.add('exiting');
    if (oldestLabel) oldestLabel.classList.add('exiting');

    // Remove from DOM after animation
    setTimeout(() => {
      oldestRow.remove();
      if (oldestLabel) oldestLabel.remove();
    }, 400);
  }

  function addGuessRow(word, result, playerName, cosmetics) {
    // Remove blank placeholder row if present
    const blankRow = grid.querySelector('.blank-row');
    if (blankRow) blankRow.remove();

    // If at max visible, remove the oldest (bottom) row
    if (countVisibleRows() >= getMaxVisibleRows(wordLength)) {
      removeOldestRow();
    }

    // Create the new row
    const row = document.createElement('div');
    row.className = 'row';

    const letters = word.split('');
    letters.forEach((letter, i) => {
      const tile = document.createElement('div');
      tile.className = 'tile reveal-pending';
      tile.style.setProperty('--i', i);
      tile.textContent = letter;
      row.appendChild(tile);

      // Apply result color when this tile's animation ends
      tile.addEventListener('animationend', () => {
        tile.classList.remove('reveal-pending');
        tile.classList.add(result[i]);
      }, { once: true });
    });

    // Player label
    const playerLabel = document.createElement('div');
    playerLabel.className = 'row-player';
    playerLabel.textContent = playerName;
    playerLabel.style.opacity = '0';

    applyCosmetics({ nameEl: playerLabel, titleContainer: playerLabel }, cosmetics);

    // Show player name after all tiles finish
    const totalDelay = letters.length * 120 + 500;
    setTimeout(() => { playerLabel.style.opacity = ''; }, totalDelay);

    // Trigger staggered animation on next frame
    requestAnimationFrame(() => {
      row.classList.add('revealing');
    });

    // Insert at the TOP of the grid (newest first)
    grid.prepend(playerLabel);
    grid.prepend(row);
  }

  // --- Socket events ---

  socket.on('game-state', (data) => {
    wordLength = data.wordLength;
    updateGridWidth(wordLength);
    clearGrid();

    // Show only last N guesses (newest first), based on word length
    const maxRows = getMaxVisibleRows(wordLength);
    const recentGuesses = data.guesses.slice(-maxRows).reverse();
    recentGuesses.forEach((g) => {
      // Add without animation for initial sync
      const row = document.createElement('div');
      row.className = 'row';
      row.style.animation = 'none';

      g.word.split('').forEach((letter, i) => {
        const tile = document.createElement('div');
        tile.className = 'tile ' + g.result[i];
        tile.textContent = letter;
        row.appendChild(tile);
      });

      const playerLabel = document.createElement('div');
      playerLabel.className = 'row-player';
      playerLabel.textContent = g.displayName;
      applyCosmetics({ nameEl: playerLabel, titleContainer: playerLabel }, g.cosmetics);

      grid.appendChild(row);
      grid.appendChild(playerLabel);
    });

    // Show blank row if no guesses yet
    if (recentGuesses.length === 0 && !data.gameOver) {
      showBlankRow();
    }

    // Show last winner
    if (data.lastWinner) {
      showLastWinner(data.lastWinner, data.lastWinnerTotalWins);
    } else if (data.winner && data.gameOver) {
      showLastWinner(data.winner, data.winnerTotalWins);
    }

    // Daily & frenzy badges
    updateBadges(data);

  });

  socket.on('new-game', (data) => {
    wordLength = data.wordLength;
    updateGridWidth(wordLength);
    clearGrid();
    showBlankRow();
    if (window.WinCard) WinCard.hide();
    // Update daily badge for new game
    if (dailyBadge) dailyBadge.style.display = (data && data.isDaily) ? '' : 'none';
    updateBadgesBarVisibility();
  });

  socket.on('guess', (data) => {
    addGuessRow(data.word, data.result, data.displayName, data.cosmetics);
  });

  socket.on('game-over', (data) => {
    showWinCard(data);
  });

  socket.on('frenzy-update', (data) => {
    if (!data || !frenzyBadge) return;
    if (data.multiplier > 1.0) {
      frenzyBadge.style.display = '';
      if (frenzyMultEl) frenzyMultEl.textContent = data.multiplier.toFixed(1) + 'x';
    } else {
      frenzyBadge.style.display = 'none';
    }
    updateBadgesBarVisibility();
  });

  // --- Badges helpers ---

  function updateBadges(data) {
    if (dailyBadge) dailyBadge.style.display = data.isDaily ? '' : 'none';
    if (data.frenzy && frenzyBadge) {
      if (data.frenzy.multiplier > 1.0) {
        frenzyBadge.style.display = '';
        if (frenzyMultEl) frenzyMultEl.textContent = data.frenzy.multiplier.toFixed(1) + 'x';
      } else {
        frenzyBadge.style.display = 'none';
      }
    }
    updateBadgesBarVisibility();
  }

  function updateBadgesBarVisibility() {
    if (!badgesBar) return;
    var showDaily = dailyBadge && dailyBadge.style.display !== 'none';
    var showFrenzy = frenzyBadge && frenzyBadge.style.display !== 'none';
    badgesBar.style.display = (showDaily || showFrenzy) ? '' : 'none';
  }

  // --- Cosmetics ---
  var WC_OUTLINE = '7px 7px 3px #000, -7px -7px 3px #000, 7px -7px 3px #000, -7px 7px 3px #000, 0 7px 3px #000, 0 -7px 3px #000, 7px 0 3px #000, -7px 0 3px #000';
  function ensureRoundFilter() {
    if (!document.getElementById('wc-round')) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:absolute;width:0;height:0';
      svg.innerHTML = '<filter id="wc-round" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="3" in="SourceGraphic" result="d"/><feMorphology operator="erode" radius="3" in="d"/></filter>';
      document.body.appendChild(svg);
    }
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
  function applyCosmetics(els, cos) {
    if (!cos) return;
    var vis = window.__COSMETIC_VISIBILITY;
    if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }
    // Word cosmetics were suppressed here "for eyestrain reduction" back when
    // they were a PERMANENT tint. They are now a transient spawn effect
    // (PfpCosmetics.spawnWord: ~500ms hold, 600ms fade), so the suppression
    // was removed 2026-08-03 and OBS shows them like every other surface.
    if (cos.name_color && els.nameEl) {
      if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
      if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
    }
    if (cos.name_glow && els.nameEl) {
      if (cos.name_glow.textShadow) els.nameEl.style.textShadow = cos.name_glow.textShadow;
      if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
    }
    // ring + glow via the shared applier
    if (els.avatarEl) pfpxApply(els.avatarEl, els.avatarEl.parentElement || els.avatarEl, cos);
    if (cos.title && cos.title.title && els.titleContainer) {
      var titleSpan = document.createElement('span');
      titleSpan.className = 'cosmetic-title';
      titleSpan.textContent = ' [' + cos.title.title + ']';
      if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
      if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
      if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
      els.titleContainer.appendChild(titleSpan);
    }
  }

  // --- Utility ---

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
