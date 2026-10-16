(function() {
  'use strict';

  // ─── Responsive scaling (380px base, same as Word 500 / Betweenly) ──
  var BASE_WIDTH = 380;
  var isOverlay = new URLSearchParams(location.search).has('overlay');

  function scaleViewport() {
    var actualW = window.innerWidth;
    var vp = window.visualViewport;
    var actualH = (vp ? vp.height : window.innerHeight);
    var scale = actualW / BASE_WIDTH;
    var html = document.documentElement;
    html.style.width = BASE_WIDTH + 'px';
    html.style.height = Math.round(actualH / scale) + 'px';
    html.style.transformOrigin = '0 0';
    html.style.transform = 'scale(' + scale + ')';
    window.__gameScale = scale;
  }
  scaleViewport();
  window.addEventListener('resize', scaleViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scaleViewport);
  }

  if (isOverlay) document.body.classList.add('overlay-mode');

  // ─── State ──────────────────────────────────────────────────────────
  var socket = io();
  var gameState = null;
  var currentInput = '';
  var SYMBOL_COLOR_MAP = {};  // symbol char → color name

  // ─── DOM refs ───────────────────────────────────────────────────────
  var board = document.getElementById('board');
  var guessesLeftEl = document.getElementById('guesses-left');
  var wordLengthTag = document.getElementById('word-length-tag');
  var jackpotEl = document.getElementById('jackpot');
  var messageEl = document.getElementById('message');
  var winOverlay = document.getElementById('win-overlay');
  var winWord = document.getElementById('win-word');
  var winPlayer = document.getElementById('win-player');
  var winJackpot = document.getElementById('win-jackpot');
  var failOverlay = document.getElementById('fail-overlay');
  var failWord = document.getElementById('fail-word');
  var dailyBadge = document.getElementById('daily-badge');
  var frenzyBadge = document.getElementById('frenzy-badge');
  var frenzyMultEl = document.getElementById('frenzy-mult');

  // ─── Jackpot timer ──────────────────────────────────────────────────
  var jackpotInterval = null;

  function startJackpotTimer() {
    if (jackpotInterval) clearInterval(jackpotInterval);
    jackpotInterval = setInterval(function() {
      if (gameState && !gameState.solved && !gameState.failed) {
        var base = 50, perGuess = 10, perSecond = 1;
        var guessBonus = (gameState.guesses || []).length * perGuess;
        var elapsed = Math.floor((Date.now() - (gameState._localStart || Date.now())) / 1000);
        jackpotEl.textContent = base + guessBonus + elapsed * perSecond;
      }
    }, 1000);
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
          if (cos.name_color && cos.name_color.css) {
            if (cos.name_color.css.color) tag.style.color = cos.name_color.css.color;
            if (cos.name_color.css.textShadow) tag.style.textShadow = cos.name_color.css.textShadow;
          }
          if (cos.name_glow && cos.name_glow.css && cos.name_glow.css.textShadow) {
            tag.style.textShadow = (tag.style.textShadow ? tag.style.textShadow + ', ' : '') + cos.name_glow.css.textShadow;
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

    // Empty rows — show up to 2 ahead to keep board compact on mobile
    var filledRows = guesses.length + (!gameState.solved && !gameState.failed && !isOverlay ? 1 : 0);
    var emptyLimit = filledRows + 2;
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
    if (gameState.jackpot) {
      jackpotEl.textContent = gameState.jackpot;
    }
  }

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = type || '';
    if (type) {
      setTimeout(function() {
        if (messageEl.textContent === text) {
          messageEl.textContent = '';
          messageEl.className = '';
        }
      }, 3000);
    }
  }

  function showWin(data) {
    winWord.textContent = data.word;
    winPlayer.textContent = (data.winner && data.winner.displayName) || 'Winner!';
    winJackpot.textContent = data.jackpot + ' coins';
    winOverlay.classList.remove('hidden');
    setTimeout(function() { winOverlay.classList.add('hidden'); }, 10000);
  }

  function showFail(data) {
    failWord.textContent = data.word;
    failOverlay.classList.remove('hidden');
    setTimeout(function() { failOverlay.classList.add('hidden'); }, 10000);
  }

  function shakeCurrentRow() {
    var row = document.getElementById('current-row');
    if (!row) return;
    row.classList.add('shake-row');
    setTimeout(function() { row.classList.remove('shake-row'); }, 400);
  }

  // ─── Socket events ─────────────────────────────────────────────────
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
    winOverlay.classList.add('hidden');
    failOverlay.classList.add('hidden');

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
    winOverlay.classList.add('hidden');
    failOverlay.classList.add('hidden');
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
    if (data.won) {
      showWin(data);
    }
    // No fail handling — unlimited guesses in MP
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
