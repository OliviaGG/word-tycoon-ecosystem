(function() {
  'use strict';

  var isOverlay = new URLSearchParams(location.search).has('overlay');

  if (isOverlay) document.body.classList.add('overlay-mode');

  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  // ─── State ──────────────────────────────────────────────────────────
  var _sessHandle = (function () {
    try {
      var q = new URLSearchParams(location.search).get('session');
      if (q && /^[a-z0-9_-]{1,32}$/.test(q)) return q;
      var m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})$/i);
      if (m && m[1]) {
        var h = m[1].toLowerCase();
        var RES = ['admin', 'overlay', 'index.html', 'mp.html', 'sp.html', 'overlay.html'];
        if (RES.indexOf(h) === -1) return h;
      }
    } catch (e) {}
    return null;
  })();
  window.__SESSION_HANDLE = _sessHandle;
  var socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
  if (window.SessionWinCard) SessionWinCard.init(socket);
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
  var gameState = null;
  var currentInput = '';
  var SYMBOL_COLOR_MAP = {};  // symbol char → color name

  // ─── DOM refs ───────────────────────────────────────────────────────
  var board = document.getElementById('board');
  var guessesLeftEl = document.getElementById('guesses-left');
  var wordLengthTag = document.getElementById('word-length-tag');
  var jackpotEl = document.getElementById('jackpot');
  var messageEl = document.getElementById('message');
  var dailyBadge = document.getElementById('daily-badge');
  var frenzyBadge = document.getElementById('frenzy-badge');
  var frenzyMultEl = document.getElementById('frenzy-mult');

  // ─── Jackpot timer ──────────────────────────────────────────────────
  var jackpotInterval = null;

  function startJackpotTimer() {
    if (jackpotInterval) clearInterval(jackpotInterval);
    jackpotInterval = null;
  }

  // ─── Symbol → color mapping ─────────────────────────────────────────
  function buildColorMap(symbols, colors) {
    SYMBOL_COLOR_MAP = {};
    for (var i = 0; i < symbols.length; i++) {
      SYMBOL_COLOR_MAP[symbols[i]] = colors[i] || 'cyan';
    }
  }

  function glowClass(symbol) {
    return 'glow-' + (SYMBOL_COLOR_MAP[symbol] || 'cyan');
  }

  function borderClass(symbol) {
    return 'border-' + (SYMBOL_COLOR_MAP[symbol] || 'cyan');
  }

  // ─── Board rendering ───────────────────────────────────────────────
  function renderBoard() {
    if (!gameState) return;

    board.innerHTML = '';
    var maxGuesses = gameState.maxGuesses || null;
    var wordLen = gameState.wordLength || 5;
    var guesses = gameState.guesses || [];

    // Set word-length class on board for cell sizing
    board.className = 'word-len-' + wordLen;

    // Completed guesses
    for (var g = 0; g < guesses.length; g++) {
      var row = document.createElement('div');
      row.className = 'guess-row';

      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell revealed ' + borderClass(guesses[g].symbols[i]);

        var letter = document.createElement('div');
        letter.className = 'cell-letter';
        letter.textContent = guesses[g].word[i];

        var sym = document.createElement('div');
        sym.className = 'cell-symbol ' + glowClass(guesses[g].symbols[i]);
        sym.textContent = guesses[g].symbols[i];

        cell.appendChild(letter);
        cell.appendChild(sym);
        row.appendChild(cell);
      }

      board.appendChild(row);

      // Show player tag for stream guesses
      if (guesses[g].player && guesses[g].player.username !== 'Player') {
        var tag = document.createElement('div');
        tag.className = 'guess-player';
        var name = guesses[g].player.displayName || guesses[g].player.username;
        // Apply cosmetics to player name
        if (guesses[g].player.cosmetics) {
          var cos = guesses[g].player.cosmetics;
          var vis = window.__COSMETIC_VISIBILITY;
          if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }
          if (cos.name_color) {
            if (cos.name_color.color) tag.style.color = cos.name_color.color;
            if (cos.name_color.textShadow) tag.style.textShadow = cos.name_color.textShadow;
            if (cos.name_color.animation) tag.style.animation = cos.name_color.animation;
          }
          if (cos.name_glow && cos.name_glow.textShadow) {
            tag.style.textShadow = (tag.style.textShadow ? tag.style.textShadow + ', ' : '') + cos.name_glow.textShadow;
          }
        }
        tag.textContent = name;
        board.appendChild(tag);
      }
    }

    // Current input row (solo mode only)
    if (!gameState.solved && !gameState.failed && !isOverlay) {
      var inputRow = document.createElement('div');
      inputRow.className = 'guess-row current';
      inputRow.id = 'current-row';

      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell' + (i < currentInput.length ? ' filled' : '');

        var letter = document.createElement('div');
        letter.className = 'cell-letter';
        letter.textContent = i < currentInput.length ? currentInput[i] : '';
        letter.style.opacity = '1';
        letter.style.fontSize = '20px';

        cell.appendChild(letter);
        inputRow.appendChild(cell);
      }

      board.appendChild(inputRow);
    }

    // Show all 8 at game start, none during play
    var filledRows = guesses.length + (!gameState.solved && !gameState.failed && !isOverlay ? 1 : 0);
    var emptyLimit;
    if (guesses.length === 0 && !gameState.solved && !gameState.failed) {
      emptyLimit = 8;
    } else {
      emptyLimit = filledRows;
    }
    for (var r = filledRows; r < emptyLimit; r++) {
      var row = document.createElement('div');
      row.className = 'guess-row';
      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        row.appendChild(cell);
      }
      board.appendChild(row);
    }

    // Scroll to see latest
    board.scrollTop = board.scrollHeight;
  }

  function renderLegend() {
    if (!gameState) return;
    var symbols = gameState.symbols || [];
    for (var i = 0; i < 3; i++) {
      var item = document.getElementById('legend-' + i);
      if (!item) continue;
      var symEl = item.querySelector('.legend-symbol');
      var meaningEl = item.querySelector('.legend-meaning');
      if (symbols[i]) {
        symEl.textContent = symbols[i];
        symEl.className = 'legend-symbol ' + glowClass(symbols[i]);
        meaningEl.textContent = '= ?';
      }
    }
  }

  function updateStatus() {
    if (!gameState) return;
    guessesLeftEl.textContent = (gameState.guesses || []).length + ' guesses';
    wordLengthTag.textContent = gameState.wordLength + ' letters';
    if (gameState.jackpot != null) {
      jackpotEl.textContent = gameState.jackpot;
    }
  }

  function showMessage(text, type, persistent) {
    text = String(text || '').slice(0, 240);
    messageEl.textContent = text;
    messageEl.className = type || '';
    if (type && !persistent) {
      setTimeout(function() {
        if (messageEl.textContent === text) {
          messageEl.textContent = '';
          messageEl.className = '';
        }
      }, 3000);
    }
  }

  function shakeCurrentRow() {
    var row = document.getElementById('current-row');
    if (!row) return;
    row.classList.add('shake-row');
    setTimeout(function() { row.classList.remove('shake-row'); }, 400);
  }

  // ─── Socket events ─────────────────────────────────────────────────
  socket.on('jackpot-update', function(data) {
    if (!gameState || gameState.solved || !data || !Number.isFinite(data.jackpot)) return;
    gameState.jackpot = data.jackpot; if (jackpotEl) jackpotEl.textContent = data.jackpot;
  });
  socket.on('game-state', function(state) {
    gameState = state;
    if (gameState) {
      gameState._localStart = Date.now() - Math.max(0, (gameState.guesses || []).length * 6000);
      buildColorMap(gameState.symbols || [], gameState.symbolColors || []);
    }
    currentInput = '';
    renderBoard();
    renderLegend();
    updateStatus();
    startJackpotTimer();
    // Daily & frenzy badges
    if (dailyBadge) dailyBadge.style.display = (state && state.isDaily) ? '' : 'none';
    if (state && state.frenzy && frenzyBadge) {
      if (state.frenzy.multiplier > 1.0) {
        frenzyBadge.style.display = '';
        if (frenzyMultEl) frenzyMultEl.textContent = state.frenzy.multiplier.toFixed(1) + 'x';
      } else {
        frenzyBadge.style.display = 'none';
      }
    }
  });

  socket.on('new-game', function(state) {
    gameState = state;
    if (gameState) {
      gameState._localStart = Date.now();
      buildColorMap(gameState.symbols || [], gameState.symbolColors || []);
    }
    currentInput = '';
    renderBoard();
    renderLegend();
    updateStatus();
    startJackpotTimer();
    showMessage('New round! ' + (gameState ? gameState.wordLength : '?') + ' letters', '');

    // Daily badge
    if (dailyBadge) dailyBadge.style.display = (state && state.isDaily) ? '' : 'none';
  });

  socket.on('frenzy-update', function(data) {
    if (!data || !frenzyBadge) return;
    if (data.multiplier > 1.0) {
      frenzyBadge.style.display = '';
      if (frenzyMultEl) frenzyMultEl.textContent = data.multiplier.toFixed(1) + 'x';
    } else {
      frenzyBadge.style.display = 'none';
    }
  });

  socket.on('guess-result', function(data) {
    if (!gameState || !data.guess) return;

    // Update local state
    gameState.guesses = gameState.guesses || [];
    var isDuplicate = gameState.guesses.some(function(g) { return g.word === data.guess.word; });
    if (!isDuplicate) {
      gameState.guesses.push(data.guess);
    }
    if (data.solved) {
      gameState.solved = true;
      gameState.winner = data.winner;
      gameState.word = data.word;
    }

    currentInput = '';
    renderBoard();
    updateStatus();
  });

  socket.on('game-over', function(data) {
    // Win handled by unified win-overlay
  });

  socket.on('error-msg', function(data) {
    showMessage(data.message || 'Error', 'error');
    shakeCurrentRow();
  });

  // ─── Keyboard input (solo mode) ────────────────────────────────────
  function handleKey(key) {
    if (!gameState || gameState.solved || gameState.failed || isOverlay) return;

    if (key === 'Backspace') {
      currentInput = currentInput.slice(0, -1);
      renderBoard();
      return;
    }

    if (key === 'Enter') {
      if (currentInput.length !== gameState.wordLength) {
        showMessage('Need ' + gameState.wordLength + ' letters', 'error');
        shakeCurrentRow();
        return;
      }
      socket.emit('guess', { word: currentInput });
      return;
    }

    // Letter key
    if (/^[A-Z]$/.test(key) && currentInput.length < gameState.wordLength) {
      currentInput += key;
      renderBoard();

      // Pop animation on last filled cell
      var currentRow = document.getElementById('current-row');
      if (currentRow) {
        var cells = currentRow.querySelectorAll('.cell.filled');
        var lastCell = cells[cells.length - 1];
        if (lastCell) {
          lastCell.classList.add('pop');
          setTimeout(function() { lastCell.classList.remove('pop'); }, 120);
        }
      }
    }
  }

  // Physical keyboard
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var key = e.key;
    if (key === 'Backspace' || key === 'Enter') {
      e.preventDefault();
      handleKey(key);
    } else if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      e.preventDefault();
      handleKey(key.toUpperCase());
    }
  });

  // On-screen keyboard
  document.getElementById('keyboard').addEventListener('click', function(e) {
    var btn = e.target.closest('.kb-key');
    if (!btn) return;
    handleKey(btn.dataset.key);
  });

})();
