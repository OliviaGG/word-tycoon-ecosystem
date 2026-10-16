/**
 * Word Mine — MP Client
 * SP-style layout (tier-grouped found words, win overlay) with multiplayer components
 * (Socket.IO, player names, cosmetics, leaderboard).
 */
(function () {
  'use strict';

  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  // ─── Constants ──────────────────────────────────────────────────────────────

  var DEPTH_TIERS = [
    { id: 'surface', label: 'Surface', ore: 'Coal',    icon: '\u2B1B', color: '#6b7280', xp: 2 },
    { id: 'shallow', label: 'Shallow', ore: 'Iron',    icon: '\uD83D\uDFEB', color: '#a1724a', xp: 2 },
    { id: 'medium',  label: 'Medium',  ore: 'Silver',  icon: '\u26AA', color: '#94a3b8', xp: 2 },
    { id: 'deep',    label: 'Deep',    ore: 'Gold',    icon: '\uD83D\uDFE1', color: '#f59e0b', xp: 3 },
    { id: 'core',    label: 'Core',    ore: 'Diamond', icon: '\uD83D\uDC8E', color: '#06b6d4', xp: 3 },
  ];
  var TIER_IDS = ['surface', 'shallow', 'medium', 'deep', 'core'];
  var TIER_MAP = {};
  DEPTH_TIERS.forEach(function (t) { TIER_MAP[t.id] = t; });
  TIER_MAP.hidden = { id: 'hidden', label: 'Ultra Rare', ore: 'Fossil', icon: '\uD83E\uDEA8', color: '#7c3aed', xp: 4 };

  // ─── State ──────────────────────────────────────────────────────────────────

  var socket = null;
  var state = null;
  var currentWord = '';
  var playerName = '';
  var shuffledOrder = null;
  var winShown = false;

  // ─── DOM Refs ───────────────────────────────────────────────────────────────

  var elIdleScreen, elGameScreen;
  var elMineName, elStatusBadge, elXPCount;
  var elLetterRow1, elLetterRow2, elLetterRow3;
  var elCurrentWord, elBtnDelete, elBtnShuffle, elBtnDig;
  var elFeedback, elDepthTiers;
  var elFoundCount, elWordsTotal, elFoundList;
  var elLeaderboard, elLeaderboardList;

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    window.__SESSION_HANDLE = null;

    var $ = function (id) { return document.getElementById(id); };
    elIdleScreen      = $('idle-screen');
    elGameScreen      = $('game-screen');
    elMineName        = $('mine-name');
    elStatusBadge     = $('status-badge');
    elXPCount         = $('xp-count');
    elLetterRow1      = $('letter-row-1');
    elLetterRow2      = $('letter-row-2');
    elLetterRow3      = $('letter-row-3');
    elCurrentWord     = $('current-word');
    elBtnDelete       = $('btn-delete');
    elBtnShuffle      = $('btn-shuffle');
    elBtnDig          = $('btn-dig');
    elFeedback        = $('feedback');
    elDepthTiers      = $('depth-tiers');
    elFoundCount      = $('found-count');
    elWordsTotal      = $('words-total');
    elFoundList       = $('found-list');
    elLeaderboard     = $('leaderboard');
    elLeaderboardList = $('leaderboard-list');

    elBtnDelete.addEventListener('click', deleteLetter);
    elBtnShuffle.addEventListener('click', shuffleLetters);
    elBtnDig.addEventListener('click', submitWord);

    document.addEventListener('keydown', function (e) {
      if (!state || state.status !== 'active') return;
      if (isWinCardOpen()) return;
      if (e.key === 'Enter') { submitWord(); e.preventDefault(); }
      else if (e.key === 'Backspace') { deleteLetter(); e.preventDefault(); }
      else if (/^[a-zA-Z]$/.test(e.key)) { typeLetter(e.key.toLowerCase()); }
    });

    // Theme toggles (both idle and game headers)
    var themeBtns = document.querySelectorAll('#theme-toggle-idle, #theme-toggle-game');
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener('click', function () {
        var html = document.documentElement;
        var current = html.getAttribute('data-theme');
        var next = current === 'light' ? 'dark' : 'light';
        if (next === 'dark') html.removeAttribute('data-theme');
        else html.setAttribute('data-theme', next);
        try { localStorage.setItem('wordmine-theme', next === 'dark' ? '' : next); } catch(e) {}
      });
    }

    getPlayerName(function () { connectSocket(); initHintButton(); });
  }

  // ─── Player Name ────────────────────────────────────────────────────────────

  function getPlayerName(cb) {
    fetch('/api/me/session').then(function (r) { return r.json(); }).then(function (data) {
      if (data.ok && data.user) {
        playerName = data.user.globalName || data.user.username || '';
      }
      if (!playerName) {
        try { playerName = localStorage.getItem('wordmine-name') || ''; } catch(e) {}
      }
      if (!playerName) {
        playerName = (prompt('Enter your display name for Word Mine:') || '').trim();
        if (!playerName) playerName = 'Miner';
        try { localStorage.setItem('wordmine-name', playerName); } catch(e) {}
      }
      cb();
    }).catch(function () {
      try { playerName = localStorage.getItem('wordmine-name') || ''; } catch(e) {}
      if (!playerName) {
        playerName = (prompt('Enter your display name for Word Mine:') || '').trim();
        if (!playerName) playerName = 'Miner';
        try { localStorage.setItem('wordmine-name', playerName); } catch(e) {}
      }
      cb();
    });
  }

  // ─── Socket.IO ──────────────────────────────────────────────────────────────

  function connectSocket() {
    socket = io();

    socket.on('game-state', function (s) {
      state = s;
      shuffledOrder = null;
      winShown = false;
      if (s.depthTiers) s.depthTiers.forEach(function (t) { TIER_MAP[t.id] = t; });
      renderAll();
    });

    socket.on('word-found', function (entry) {
      if (!state) return;
      state.foundWords[entry.word] = entry;
      state.foundCount = (state.foundCount || 0) + 1;
      state.depthProgress = entry.depthProgress || state.depthProgress;
      if (entry.tierLetters) state.tierLetters = entry.tierLetters;
      if (entry.startCounts) state.startCounts = entry.startCounts;
      if (!state.wordHistory) state.wordHistory = [];
      state.wordHistory.push(entry);
      renderFoundWords();
      renderLetters();
      renderDepthMeter();
      updateWordCount();
      var td = getTierDef(entry.tier);
      highlightLetters(entry.word, td.color || '#f59e0b');
      // Show feedback for this player's own words
      if (entry.player && playerName && entry.player.toLowerCase() === playerName.toLowerCase()) {
        showFeedback(td.icon + ' +' + entry.xp + ' ' + td.ore + '!', 'success');
      }
    });

    socket.on('depth-unlocked', function (data) {
      if (!state) return;
      state.currentDepth = data.depth;
      state.unlockedDepths = data.state.unlockedDepths;
      state.revealedBonusCount = data.revealedBonusCount;
      state.bonusOrder = data.state.bonusOrder;
      if (data.state.tierLetters) state.tierLetters = data.state.tierLetters;
      if (data.state.startCounts) state.startCounts = data.state.startCounts;
      shuffledOrder = null;
      showFeedback('\u26CF ' + data.label + ' unlocked!', 'depth-unlock');
      renderLetters();
      renderDepthMeter();
    });

    socket.on('game-started', function (s) {
      state = s;
      shuffledOrder = null;
      winShown = false;
      if (s.depthTiers) s.depthTiers.forEach(function (t) { TIER_MAP[t.id] = t; });
      showFeedback('Mine opened! Start digging!', 'info');
      renderAll();
    });

    socket.on('mine-completed', function (s) {
      state = s;
      state.mineCompleted = true;
      showWinOverlay();
      renderDepthMeter();
    });

    socket.on('game-ended', function (s) {
      state = s;
      showFeedback('Mine closed!', 'info');
      renderAll();
      renderLeaderboard(s.leaderboard || []);
    });

    socket.on('game-paused', function (s) {
      state = s;
      showFeedback('Game paused', 'info');
      renderAll();
    });

    socket.on('game-resumed', function (s) {
      state = s;
      showFeedback('Game resumed!', 'info');
      renderAll();
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  function renderAll() {
    if (!state) return;
    var isActive = state.status === 'active' || state.status === 'paused';
    var hasEnded = state.status === 'ended';

    elIdleScreen.style.display = (isActive || hasEnded) ? 'none' : '';
    elGameScreen.style.display = (isActive || hasEnded) ? '' : 'none';

    if (!isActive && !hasEnded) return;

    elMineName.textContent = state.mineName || 'Word Mine';

    if (state.status === 'active') {
      elStatusBadge.textContent = 'LIVE';
      elStatusBadge.className = 'daily-badge';
      elStatusBadge.style.background = '#22c55e';
    } else if (state.status === 'paused') {
      elStatusBadge.textContent = 'PAUSED';
      elStatusBadge.className = 'daily-badge';
      elStatusBadge.style.background = '#f59e0b';
    } else if (hasEnded) {
      elStatusBadge.textContent = 'ENDED';
      elStatusBadge.className = 'daily-badge';
      elStatusBadge.style.background = '#ef4444';
    }

    elLeaderboard.style.display = hasEnded ? '' : 'none';

    renderLetters();
    renderDepthMeter();
    renderFoundWords();
    updateWordCount();
  }

  // ─── Letters ────────────────────────────────────────────────────────────────

  function renderLetters() {
    if (!state || !state.letters || !state.letters.length) return;
    elLetterRow1.innerHTML = '';
    elLetterRow2.innerHTML = '';
    elLetterRow3.innerHTML = '';

    var initialIndices = state.initialIndices || [];
    var revealedBonus  = state.bonusOrder || [];
    var numBonus       = state.letters.length - initialIndices.length;
    var startCounts    = state.startCounts || {};

    var displayOrder = shuffledOrder || initialIndices.slice();
    var badgeUsed = {};

    for (var di = 0; di < displayOrder.length; di++) {
      var li = displayOrder[di];
      var ch = state.letters[li];

      var cell = document.createElement('div');
      cell.className = 'letter-cell revealed';
      cell.dataset.letterIdx = li;
      cell.textContent = ch.toUpperCase();
      cell.addEventListener('click', (function (c) {
        return function () { typeLetter(c); };
      })(ch));

      var cnt = startCounts[ch];
      if (cnt && cnt > 0 && !badgeUsed[ch]) {
        badgeUsed[ch] = true;
        var badge = document.createElement('span');
        badge.className = 'letter-start-badge';
        badge.textContent = cnt;
        cell.appendChild(badge);
      }

      if (di < 6) elLetterRow1.appendChild(cell);
      else        elLetterRow2.appendChild(cell);
    }

    for (var bi = 0; bi < numBonus; bi++) {
      var cell3 = document.createElement('div');
      cell3.className = 'letter-cell';
      if (bi < revealedBonus.length) {
        var li3 = revealedBonus[bi];
        var ch3 = state.letters[li3];
        cell3.classList.add('revealed');
        cell3.dataset.letterIdx = li3;
        cell3.textContent = ch3.toUpperCase();
        cell3.addEventListener('click', (function (c) {
          return function () { typeLetter(c); };
        })(ch3));
      } else {
        cell3.classList.add('locked');
        cell3.textContent = '?';
      }
      elLetterRow3.appendChild(cell3);
    }
  }

  // ─── Depth Meter ────────────────────────────────────────────────────────────

  function renderDepthMeter() {
    if (!state) return;
    var tiers = state.depthTiers || DEPTH_TIERS;
    elDepthTiers.innerHTML = '';

    for (var i = 0; i < tiers.length; i++) {
      var tier = tiers[i];
      var td = getTierDef(tier.id);
      var isUnlocked = (state.unlockedDepths || []).indexOf(tier.id) >= 0;
      var isCurrent  = tier.id === state.currentDepth;
      var isBonus    = tier.id === 'deep' || tier.id === 'core';

      var row = document.createElement('div');
      row.className = 'depth-tier' + (!isUnlocked ? ' locked' : isCurrent ? ' current' : ' unlocked');

      var icon = document.createElement('span');
      icon.className = 'tier-icon';
      icon.textContent = !isUnlocked ? '\uD83D\uDD12' : (td.icon || '');
      row.appendChild(icon);

      var label = document.createElement('span');
      label.className = 'tier-label';
      label.style.color = tier.color;
      label.textContent = tier.label + (isBonus ? ' \u2605' : '');
      if (isBonus) label.title = 'Bonus tier';
      row.appendChild(label);

      var progWrap = document.createElement('div');
      progWrap.className = 'tier-progress';
      var bar = document.createElement('div');
      bar.className = 'tier-progress-bar';
      bar.style.background = tier.color;

      var threshold = (state.depthThresholds || {})[tier.id];
      var prog = (state.depthProgress || {})[tier.id] || 0;

      if (!isUnlocked) {
        bar.style.width = '0%';
      } else if (threshold && isCurrent) {
        bar.style.width = Math.min(100, (prog / threshold) * 100) + '%';
      } else if (isUnlocked && !isCurrent) {
        bar.style.width = '100%';
      } else {
        bar.style.width = countFoundInTier(tier.id) > 0 ? '100%' : '0%';
      }
      progWrap.appendChild(bar);
      row.appendChild(progWrap);

      var countEl = document.createElement('span');
      countEl.className = 'tier-count';
      if (threshold && isCurrent) {
        countEl.textContent = prog + '/' + threshold;
      } else if (isUnlocked && !isCurrent) {
        var found = countFoundInTier(tier.id);
        if (found > 0) countEl.textContent = found;
      }
      row.appendChild(countEl);

      var xpEl = document.createElement('span');
      xpEl.className = 'tier-xp';
      xpEl.textContent = '\u2726' + tier.xp;
      row.appendChild(xpEl);

      elDepthTiers.appendChild(row);
    }
  }

  function countFoundInTier(tierId) {
    if (!state || !state.wordHistory) return 0;
    var n = 0;
    var history = state.wordHistory;
    for (var i = 0; i < history.length; i++) {
      if (history[i].tier === tierId) n++;
    }
    return n;
  }

  // ─── Found Words (tier-grouped, SP-style) ───────────────────────────────────

  function renderFoundWords() {
    if (!state) return;
    elFoundList.innerHTML = '';
    var history = state.wordHistory || [];
    var allTiers = TIER_IDS.concat(['hidden']);

    // Group by tier
    var groups = {};
    for (var i = 0; i < history.length; i++) {
      var tid = history[i].tier || 'surface';
      if (!groups[tid]) groups[tid] = [];
      groups[tid].push(history[i]);
    }

    for (var t = 0; t < allTiers.length; t++) {
      var tierId = allTiers[t];
      var words = groups[tierId];
      if (!words || words.length === 0) continue;
      var td = getTierDef(tierId);

      var group = document.createElement('div');
      group.className = 'found-tier-group';

      var labelEl = document.createElement('div');
      labelEl.className = 'found-tier-label';
      labelEl.style.background = td.color + '22';
      labelEl.style.color = td.color;
      labelEl.textContent = td.icon + ' ' + td.ore + ' \u2014 ' + td.label + ' (' + words.length + ')';
      group.appendChild(labelEl);

      for (var j = 0; j < words.length; j++) {
        group.appendChild(createFoundWordRow(words[j], td));
      }
      elFoundList.appendChild(group);
    }
  }

  function createFoundWordRow(entry, td) {
    var row = document.createElement('div');
    row.className = 'found-word-row';
    var equipped = entry.cosmetics || {};
    var vis = window.__COSMETIC_VISIBILITY;
    if (vis) { for (var c in vis) { if (vis[c] === false) delete equipped[c]; } }

    var textSpan = document.createElement('span');
    textSpan.className = 'found-word-text';

    // Player name
    var playerSpan = document.createElement('span');
    playerSpan.className = 'found-word-player';
    playerSpan.style.textTransform = 'none';
    playerSpan.textContent = entry.player || '?';
    applyCosmetics(playerSpan, equipped.name_color);
    applyCosmetics(playerSpan, equipped.name_glow);
    textSpan.appendChild(playerSpan);

    // Title
    if (equipped.title && equipped.title.title) {
      var titleSpan = document.createElement('span');
      titleSpan.className = 'found-word-title';
      titleSpan.textContent = equipped.title.title;
      if (equipped.title.titleColor) titleSpan.style.color = equipped.title.titleColor;
      textSpan.appendChild(titleSpan);
    }

    // Word
    var wordSpan = document.createElement('span');
    wordSpan.className = 'found-word-word';
    wordSpan.style.color = td.color || '';
    wordSpan.textContent = entry.word;
    applyCosmetics(wordSpan, equipped.word_color);
    applyCosmetics(wordSpan, equipped.word_glow);
    textSpan.appendChild(wordSpan);

    row.appendChild(textSpan);

    var xpEl = document.createElement('span');
    xpEl.className = 'found-word-xp';
    xpEl.style.color = td.color || '';
    xpEl.textContent = (td.icon || '') + ' \u2726' + entry.xp;
    row.appendChild(xpEl);

    return row;
  }

  // ─── Win Card (shared WinCard component) ───────────────────────────────────

  function isWinCardOpen() {
    var wc = document.getElementById('wt-win-card');
    return !!(wc && wc.style.display !== 'none');
  }

  function showWinOverlay() {
    if (winShown) return;
    winShown = true;

    var history = (state && state.wordHistory) || [];
    var totalXP = 0;
    for (var i = 0; i < history.length; i++) totalXP += (history[i].xp || 0);

    // WinCard hero = top-XP player; rows = top 10 by XP from game state.
    var players = (state && state.players) || {};
    var topPlayers = Object.keys(players).map(function (k) {
      var p = players[k];
      return {
        displayName: p.displayName,
        platform: p.platform,
        platformUserId: p.userId,
        cosmetics: p.cosmetics,
        xp: p.totalXP
      };
    }).sort(function (a, b) { return b.xp - a.xp; }).slice(0, 10);

    if (!window.WinCard) return;

    window.WinCard.showMp({
      game: 'wordmine',
      gameName: 'Word Mine',
      jackpot: totalXP,
      winner: topPlayers[0] || { displayName: 'The Team' },
      topPlayers: topPlayers,
      listTitle: 'MINE STANDINGS',
      autoHideMs: 0,
      actions: [{ label: 'Continue Mining', primary: true, onClick: function () { window.WinCard.hide(); } }]
    });
  }

  // ─── Leaderboard ────────────────────────────────────────────────────────────

  function renderLeaderboard(lb) {
    elLeaderboardList.innerHTML = '';
    for (var i = 0; i < lb.length; i++) {
      var p = lb[i];
      var row = document.createElement('div');
      row.className = 'found-word-row';
      row.innerHTML = '<span class="found-word-text" style="text-transform:none;">' +
        (i + 1) + '. ' + esc(p.displayName) +
        ' <small style="color:var(--text-dim)">(' + p.wordsFound + ' words)</small></span>' +
        '<span class="found-word-xp">\u2726' + p.totalXP + '</span>';
      elLeaderboardList.appendChild(row);
    }
    elLeaderboard.style.display = '';
  }

  // ─── Word Count ─────────────────────────────────────────────────────────────

  function updateWordCount() {
    if (!state) return;
    elFoundCount.textContent = state.foundCount || 0;
    elWordsTotal.textContent = state.totalWords || 0;
    var history = state.wordHistory || [];
    var totalXP = 0;
    for (var i = 0; i < history.length; i++) totalXP += (history[i].xp || 0);
    elXPCount.textContent = totalXP;
  }

  // ─── Input ──────────────────────────────────────────────────────────────────

  function typeLetter(ch) {
    currentWord += ch.toLowerCase();
    elCurrentWord.textContent = currentWord.toUpperCase();
  }

  function deleteLetter() {
    if (currentWord.length > 0) {
      currentWord = currentWord.slice(0, -1);
      elCurrentWord.textContent = currentWord.toUpperCase();
    }
  }

  function shuffleLetters() {
    if (!state || !state.initialIndices) return;
    var arr = state.initialIndices.slice();
    for (var j = arr.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
    }
    shuffledOrder = arr;
    renderLetters();
  }

  function submitWord() {
    if (!currentWord || !socket) return;
    socket.emit('submit-word', { word: currentWord.toLowerCase(), name: playerName });
    currentWord = '';
    elCurrentWord.textContent = '';
  }

  // ─── Feedback ───────────────────────────────────────────────────────────────

  var feedbackTimer = null;
  function showFeedback(msg, type) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    elFeedback.textContent = msg;
    elFeedback.className = 'feedback ' + (type || 'info');
    feedbackTimer = setTimeout(function () {
      elFeedback.classList.add('hidden');
    }, type === 'depth-unlock' ? 3000 : 1500);
  }

  // ─── Cosmetics ──────────────────────────────────────────────────────────────

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

  // ─── Letter Glow Animation ──────────────────────────────────────────────────

  function highlightLetters(word, tierColor) {
    var cells = document.querySelectorAll('.letter-cell.revealed');
    var letterMap = {};
    for (var i = 0; i < cells.length; i++) {
      var ch = (cells[i].textContent || '').toLowerCase().charAt(0);
      if (!letterMap[ch]) letterMap[ch] = [];
      letterMap[ch].push(cells[i]);
    }

    var matched = [];
    var w = word.toLowerCase();
    for (var j = 0; j < w.length; j++) {
      var arr = letterMap[w[j]];
      if (arr && arr.length) matched.push(arr.shift());
    }

    for (var k = 0; k < matched.length; k++) {
      (function (cell, delay) {
        setTimeout(function () {
          cell.classList.remove('word-glow');
          void cell.offsetWidth;
          cell.style.setProperty('--glow-color', tierColor);
          cell.classList.add('word-glow');
          setTimeout(function () { cell.classList.remove('word-glow'); }, 650);
        }, delay);
      })(matched[k], k * 80);
    }
  }

  // ─── Monthly Hint Button ───────────────────────────────────────────────────

  function initHintButton() {
    if (!window.WTHints) return;
    var hintWrap = document.getElementById('hint-btn-wrap');
    if (!hintWrap) return;

    WTHints.init({
      container: hintWrap,
      game: 'wordmine',
      extraBody: { handle: window.__SESSION_HANDLE || 'public' },
      onSuccess: function (data) {
        if (data && data.hint) showHint(data.hint);
      },
      onError: function (msg) {
        showError(msg || 'Hint failed');
      }
    });
  }

  function showHint(hint) {
    if (!hint || !hint.letter) return;
    var msg = 'Hint: ' + hint.letter;
    showFeedback(msg, 'info');

    // Briefly highlight the hinted letter cell if it is currently rendered.
    if (typeof hint.position === 'number') {
      var cell = document.querySelector('.letter-cell[data-letter-idx="' + hint.position + '"]');
      if (cell) {
        cell.classList.remove('word-glow');
        void cell.offsetWidth;
        cell.style.setProperty('--glow-color', '#f59e0b');
        cell.classList.add('word-glow');
        setTimeout(function () { cell.classList.remove('word-glow'); }, 1200);
      }
    }
  }

  function showError(msg) {
    showFeedback(msg, 'error');
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function getTierDef(id) {
    return TIER_MAP[id] || { id: id, label: id, ore: id, icon: '', color: '#888', xp: 1 };
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ─── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
