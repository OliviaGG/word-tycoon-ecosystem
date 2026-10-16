/**
 * Word Mine — OBS Overlay Controller
 * Shows live letter grid, word feed, and depth progress.
 * Letters auto-shuffle every 5 minutes.
 */
(function () {
  'use strict';

  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  var TIER_MAP = {};
  var state = null;
  var socket = io();
  var displayOrder = [];       // current shuffled display order (indices into state.letters)
  var shuffleTimer = null;
  var SHUFFLE_INTERVAL = 5 * 60 * 1000; // 5 minutes

  var elMineName = document.getElementById('mine-name');
  var elFoundCount = document.getElementById('found-count');
  var elWordsTotal = document.getElementById('words-total');
  var elDepthMini = document.getElementById('depth-mini');
  var elFeed = document.getElementById('feed');
  var elLetterRow1 = document.getElementById('letter-row-1');
  var elLetterRow2 = document.getElementById('letter-row-2');
  var elLetterRow3 = document.getElementById('letter-row-3');
  var elLetterArea = document.getElementById('letter-area');

  // ─── Socket Events ────────────────────────────────────────────────────────

  socket.on('game-state', function (s) {
    state = s;
    if (s.depthTiers) s.depthTiers.forEach(function (t) { TIER_MAP[t.id] = t; });
    buildDisplayOrder();
    renderAll();
    startShuffleTimer();
  });

  socket.on('word-found', function (entry) {
    if (!state) return;
    state.foundCount = (state.foundCount || 0) + 1;
    state.depthProgress = entry.depthProgress || state.depthProgress;
    if (entry.tierLetters) state.tierLetters = entry.tierLetters;
    if (entry.startCounts) state.startCounts = entry.startCounts;
    addFeedEntry(entry);
    renderLetters();
    updateCounts();
    renderDepth();
    var td = TIER_MAP[entry.tier] || {};
    highlightLetters(entry.word, td.color || '#f59e0b');
  });

  socket.on('depth-unlocked', function (data) {
    if (!state) return;
    state.currentDepth = data.depth;
    state.unlockedDepths = data.state.unlockedDepths;
    state.revealedBonusCount = data.revealedBonusCount;
    if (data.state.bonusOrder) state.bonusOrder = data.state.bonusOrder;
    if (data.state.tierLetters) state.tierLetters = data.state.tierLetters;
    if (data.state.startCounts) state.startCounts = data.state.startCounts;
    buildDisplayOrder();
    renderLetters();
    renderDepth();
  });

  socket.on('mine-completed', function (s) { state = s; state.mineCompleted = true; renderDepth(); });
  socket.on('game-started', function (s) { state = s; buildDisplayOrder(); renderAll(); startShuffleTimer(); });
  socket.on('game-ended', function (s) { state = s; renderAll(); stopShuffleTimer(); });
  socket.on('game-paused', function (s) { state = s; renderAll(); });
  socket.on('game-resumed', function (s) { state = s; renderAll(); startShuffleTimer(); });

  // ─── Display Order + Shuffle ──────────────────────────────────────────────

  /**
   * Build the display order array: initial letter indices + bonus letter indices.
   * Initial positions can be shuffled; bonus positions stay at the end in order.
   */
  function buildDisplayOrder() {
    if (!state || !state.letters || !state.letters.length) { displayOrder = []; return; }

    var tierLetters = state.tierLetters || [];
    var startCounts = state.startCounts || {};
    var tierSet = {};
    for (var i = 0; i < tierLetters.length; i++) tierSet[tierLetters[i]] = true;

    var visible = [], hidden = [];
    for (var i = 0; i < state.letters.length; i++) {
      if (tierSet[state.letters[i]]) visible.push(i);
      else hidden.push(i);
    }

    // Sort visible by how many unfound words start with that letter (descending)
    visible.sort(function (a, b) {
      var ca = startCounts[state.letters[a]] || 0;
      var cb = startCounts[state.letters[b]] || 0;
      return cb - ca;
    });
    displayOrder = visible.concat(hidden);
  }

  /**
   * Shuffle only the initial 9 letter positions (bonus letters stay in place).
   */
  function shuffleLetters() {
    if (!state || !state.letters || state.status !== 'active') return;

    var tierLetters = state.tierLetters || [];
    var tierSet = {};
    for (var i = 0; i < tierLetters.length; i++) tierSet[tierLetters[i]] = true;

    var visible = [], hidden = [];
    for (var i = 0; i < state.letters.length; i++) {
      if (tierSet[state.letters[i]]) visible.push(i);
      else hidden.push(i);
    }

    fisherYatesShuffle(visible);
    displayOrder = visible.concat(hidden);

    renderLetters();
  }

  function fisherYatesShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function startShuffleTimer() {
    stopShuffleTimer();
    if (state && state.status === 'active') {
      shuffleTimer = setInterval(shuffleLetters, SHUFFLE_INTERVAL);
    }
  }

  function stopShuffleTimer() {
    if (shuffleTimer) { clearInterval(shuffleTimer); shuffleTimer = null; }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  function renderAll() {
    if (!state) return;
    var wrap = document.querySelector('.overlay-wrap');
    if (state.status === 'idle') { wrap.style.opacity = '0.3'; }
    else { wrap.style.opacity = '1'; }

    elMineName.textContent = state.mineName || 'Word Mine';
    updateCounts();
    renderLetters();
    renderDepth();
    renderFeed();
  }

  function updateCounts() {
    if (!state) return;
    elFoundCount.textContent = state.foundCount || 0;
    elWordsTotal.textContent = state.totalWords || 0;
  }

  function renderLetters() {
    if (!state || !state.letters || !state.letters.length || !displayOrder.length) {
      if (elLetterArea) elLetterArea.style.display = 'none';
      return;
    }
    if (elLetterArea) elLetterArea.style.display = '';

    elLetterRow1.innerHTML = '';
    elLetterRow2.innerHTML = '';
    elLetterRow3.innerHTML = '';

    // Tier letters drive which cells are revealed vs locked
    var tierLetters = state.tierLetters || [];
    var startCounts = state.startCounts || {};
    var tierSet = {};
    for (var i = 0; i < tierLetters.length; i++) tierSet[tierLetters[i]] = true;

    var badgeUsed = {}; // Only show badge on first occurrence of each letter
    for (var di = 0; di < displayOrder.length; di++) {
      var li = displayOrder[di];
      var ch = state.letters[li];
      var isVisible = !!tierSet[ch];

      var cell = document.createElement('div');
      cell.className = 'letter-cell';

      if (!isVisible) {
        cell.classList.add('locked');
        cell.textContent = '?';
      } else {
        cell.classList.add('revealed');
        cell.textContent = ch.toUpperCase();

        // Blue badge: how many unfound current-tier words start with this letter
        // Only show on first tile of each letter to avoid duplicate badges
        var count = startCounts[ch];
        if (count && count > 0 && !badgeUsed[ch]) {
          badgeUsed[ch] = true;
          var badge = document.createElement('span');
          badge.className = 'letter-start-badge';
          badge.textContent = count;
          cell.appendChild(badge);
        }
      }

      // 6+5+4 upside-down pyramid: 0-5 → row1, 6-10 → row2, 11+ → row3
      if (di < 6) elLetterRow1.appendChild(cell);
      else if (di < 11) elLetterRow2.appendChild(cell);
      else elLetterRow3.appendChild(cell);
    }
  }

  function renderDepth() {
    if (!state || !state.depthTiers) return;
    elDepthMini.innerHTML = '';

    for (var i = 0; i < state.depthTiers.length; i++) {
      var tier = state.depthTiers[i];
      var isUnlocked = (state.unlockedDepths || []).indexOf(tier.id) >= 0;
      var isCurrent = tier.id === state.currentDepth;

      var row = document.createElement('div');
      row.className = 'depth-tier' + (!isUnlocked ? ' locked' : isCurrent ? ' current' : ' unlocked');
      row.style.padding = '3px 6px';

      var label = document.createElement('span');
      label.className = 'tier-label';
      label.style.color = tier.color;
      label.style.fontSize = '0.7rem';
      var isBonus = (tier.id === 'deep' || tier.id === 'core');
      label.textContent = (!isUnlocked ? '\uD83D\uDD12 ' : '') + tier.label + (isBonus ? ' \u2605' : '');
      row.appendChild(label);

      var progWrap = document.createElement('div');
      progWrap.className = 'tier-progress';
      var bar = document.createElement('div');
      bar.className = 'tier-progress-bar';
      bar.style.background = tier.color;
      var threshold = (state.depthThresholds || {})[tier.id];
      var prog = (state.depthProgress || {})[tier.id] || 0;
      if (!isUnlocked) bar.style.width = '0%';
      else if (threshold && isCurrent) bar.style.width = Math.min(100, (prog / threshold) * 100) + '%';
      else bar.style.width = isUnlocked ? '100%' : '0%';
      progWrap.appendChild(bar);
      row.appendChild(progWrap);

      if (threshold && isCurrent) {
        var count = document.createElement('span');
        count.className = 'tier-count';
        count.textContent = prog + '/' + threshold;
        row.appendChild(count);
      }

      elDepthMini.appendChild(row);
    }
  }

  // ─── Cosmetics Helpers ───────────────────────────────────────────────────

  function parseCssProp(equipped, category) {
    if (!equipped || !equipped[category]) return null;
    var cp = equipped[category].css_property;
    if (!cp) return null;
    try { return typeof cp === 'string' ? JSON.parse(cp) : cp; }
    catch (e) { return null; }
  }

  function applyCosmetics(el, css) {
    if (!css) return;
    if (css.color) el.style.color = css.color;
    if (css.textShadow) {
      var existing = el.style.textShadow;
      el.style.textShadow = existing ? existing + ', ' + css.textShadow : css.textShadow;
    }
    if (css.background) {
      el.style.background = css.background;
      el.style.webkitBackgroundClip = 'text';
      el.style.webkitTextFillColor = 'transparent';
    }
    if (css.animation) el.style.animation = css.animation;
  }

  // ─── Feed ─────────────────────────────────────────────────────────────────

  function renderFeed() {
    if (!state) return;
    elFeed.innerHTML = '';
    var history = state.wordHistory || [];
    var recent = history.slice(-10).reverse();
    for (var i = 0; i < recent.length; i++) {
      elFeed.appendChild(createFeedRow(recent[i]));
    }
  }

  function addFeedEntry(entry) {
    var row = createFeedRow(entry);
    var first = elFeed.firstChild;
    if (first) elFeed.insertBefore(row, first);
    else elFeed.appendChild(row);
    while (elFeed.children.length > 10) elFeed.removeChild(elFeed.lastChild);
  }

  function createFeedRow(entry) {
    var row = document.createElement('div');
    row.className = 'overlay-feed-row';
    var td = TIER_MAP[entry.tier] || {};
    var equipped = entry.cosmetics || {};
    var vis = window.__COSMETIC_VISIBILITY;
    if (vis) { for (var c in vis) { if (vis[c] === false) delete equipped[c]; } }

    // Left side: player name + word
    var leftSpan = document.createElement('span');

    // Player name with cosmetics
    var playerSpan = document.createElement('span');
    playerSpan.className = 'overlay-feed-player';
    playerSpan.textContent = entry.player || '?';
    applyCosmetics(playerSpan, parseCssProp(equipped, 'name_color'));
    applyCosmetics(playerSpan, parseCssProp(equipped, 'name_glow'));
    leftSpan.appendChild(playerSpan);

    // Title badge (if equipped)
    var titleCss = parseCssProp(equipped, 'title');
    if (titleCss && titleCss.title) {
      var titleSpan = document.createElement('span');
      titleSpan.className = 'overlay-feed-title';
      titleSpan.textContent = titleCss.title;
      if (titleCss.titleColor) titleSpan.style.color = titleCss.titleColor;
      leftSpan.appendChild(titleSpan);
    }

    // Word with tier color + cosmetics
    var wordSpan = document.createElement('span');
    wordSpan.className = 'overlay-feed-word';
    wordSpan.style.color = td.color || '';
    wordSpan.textContent = entry.word;
    // OBS overlay: word_color/word_glow suppressed for eyestrain reduction
    leftSpan.appendChild(wordSpan);

    // XP badge
    var xpSpan = document.createElement('span');
    xpSpan.className = 'overlay-feed-xp';
    xpSpan.style.color = td.color || '';
    xpSpan.textContent = '\u2726' + (entry.xp || entry.coins || 0);

    row.appendChild(leftSpan);
    row.appendChild(xpSpan);
    return row;
  }

  // ─── Letter Glow Animation ──────────────────────────────────────────────────

  function highlightLetters(word, tierColor) {
    var cells = document.querySelectorAll('.letter-cell.revealed');
    // Build map: lowercase letter → [cell elements]
    var letterMap = {};
    for (var i = 0; i < cells.length; i++) {
      var ch = (cells[i].textContent || '').toLowerCase();
      if (!letterMap[ch]) letterMap[ch] = [];
      letterMap[ch].push(cells[i]);
    }

    var matched = [];
    var w = word.toLowerCase();
    for (var j = 0; j < w.length; j++) {
      var arr = letterMap[w[j]];
      if (arr && arr.length) {
        matched.push(arr.shift());
      }
    }

    for (var k = 0; k < matched.length; k++) {
      (function (cell, delay) {
        setTimeout(function () {
          cell.classList.remove('word-glow');
          void cell.offsetWidth; // force reflow for re-trigger
          cell.style.setProperty('--glow-color', tierColor);
          cell.classList.add('word-glow');
          setTimeout(function () { cell.classList.remove('word-glow'); }, 650);
        }, delay);
      })(matched[k], k * 80);
    }
  }
})();
