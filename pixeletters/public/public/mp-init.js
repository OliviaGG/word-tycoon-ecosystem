// ===== PixeLetters Multiplayer Init =====
// Handles: auth check, game UI init, stats from server, identity-aware guesses
// Pixel-art letter grids with color feedback, keyboard states

(function () {
  var userSession = null;
  var userProfile = null;
  var statsOpen = false;
  var mpStats = null;
  var currentInput = '';
  var MAX_GUESSES = 5;
  var submitCooldown = false;

  // Pixel font data (5x5 grid per letter, 1 = filled, 0 = empty)
  var PIXEL_FONT = {
    A: [0,1,1,1,0, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1],
    B: [1,1,1,1,0, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,1, 1,1,1,1,0],
    C: [0,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 0,1,1,1,1],
    D: [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0],
    E: [1,1,1,1,1, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,1,1,1,1],
    F: [1,1,1,1,1, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0],
    G: [0,1,1,1,1, 1,0,0,0,0, 1,0,1,1,1, 1,0,0,0,1, 0,1,1,1,0],
    H: [1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1],
    I: [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1],
    J: [0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
    K: [1,0,0,1,0, 1,0,1,0,0, 1,1,0,0,0, 1,0,1,0,0, 1,0,0,1,0],
    L: [1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
    M: [1,0,0,0,1, 1,1,0,1,1, 1,0,1,0,1, 1,0,0,0,1, 1,0,0,0,1],
    N: [1,0,0,0,1, 1,1,0,0,1, 1,0,1,0,1, 1,0,0,1,1, 1,0,0,0,1],
    O: [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
    P: [1,1,1,1,0, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0],
    Q: [0,1,1,1,0, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,1,0, 0,1,1,0,1],
    R: [1,1,1,1,0, 1,0,0,0,1, 1,1,1,1,0, 1,0,1,0,0, 1,0,0,1,0],
    S: [0,1,1,1,1, 1,0,0,0,0, 0,1,1,1,0, 0,0,0,0,1, 1,1,1,1,0],
    T: [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
    U: [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
    V: [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0],
    W: [1,0,0,0,1, 1,0,0,0,1, 1,0,1,0,1, 1,1,0,1,1, 1,0,0,0,1],
    X: [1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,1,0,1,0, 1,0,0,0,1],
    Y: [1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
    Z: [1,1,1,1,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,1,1,1,1]
  };

  var KB_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '\u232B']
  ];

  // ─── Auth Check ────────────────────────────────────────────────────

  fetch('/api/me/session')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok && data.user) {
        userSession = data.user;
        initGame();
        fetchProfile();
        fetchServerStats();
      } else {
        showLogin();
      }
    })
    .catch(function () { showLogin(); });

  function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('game-ui').style.display = 'none';
  }

  function initGame() {
    document.getElementById('login-screen').style.display = 'none';
    var gameUI = document.getElementById('game-ui');
    gameUI.style.display = 'flex';
    initPlayEngine();
  }

  function fetchProfile() {
    fetch('/api/me/profile')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok && data.profile) {
          userProfile = data.profile;
        }
      })
      .catch(function () {});
  }

  // ─── Server Stats ──────────────────────────────────────────────────

  function fetchServerStats() {
    fetch('/api/me/pixeletters')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        mpStats = data;
        renderStats();
      })
      .catch(function () {});
  }

  function renderStats() {
    var data = mpStats || {};
    var winsEl = document.getElementById('stat-wins');
    var gamesEl = document.getElementById('stat-games');
    var avgEl = document.getElementById('stat-avg');
    var streakEl = document.getElementById('stat-streak');
    var historyEl = document.getElementById('stats-history');

    if (winsEl) winsEl.textContent = data.totalWins || 0;
    if (gamesEl) gamesEl.textContent = data.gamesPlayed || 0;
    if (avgEl) avgEl.textContent = data.averageGuesses || '-';
    if (streakEl) streakEl.textContent = data.winStreak || 0;

    if (historyEl) {
      var history = (data.history || []).slice(0, 10);
      if (history.length === 0) {
        historyEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:0.7rem;padding:8px 0">No wins yet</div>';
      } else {
        historyEl.innerHTML = history.map(function (h) {
          return '<div class="stats-h-entry">' +
            '<div><span class="stats-h-word">' + ((h.word || '???').toUpperCase()) + '</span>' +
            '<span class="stats-h-guesses">' + (h.guessCount || '?') + ' guesses</span></div>' +
            '<span class="stats-h-result win">WIN</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  // ─── Stats Toggle ──────────────────────────────────────────────────

  function bindStatsToggle() {
    var toggleBtn = document.getElementById('stats-toggle');
    var dropdown = document.getElementById('stats-dropdown');
    var closeBtn = document.getElementById('stats-close');

    if (toggleBtn && dropdown) {
      toggleBtn.addEventListener('click', function () {
        statsOpen = !statsOpen;
        if (statsOpen) {
          dropdown.classList.remove('hidden');
          toggleBtn.classList.add('active');
          fetchServerStats();
        } else {
          dropdown.classList.add('hidden');
          toggleBtn.classList.remove('active');
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        statsOpen = false;
        if (dropdown) dropdown.classList.add('hidden');
        if (toggleBtn) toggleBtn.classList.remove('active');
      });
    }

    document.addEventListener('click', function (e) {
      if (statsOpen && dropdown && toggleBtn &&
          !dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
        statsOpen = false;
        dropdown.classList.add('hidden');
        toggleBtn.classList.remove('active');
      }
    });
  }

  // ─── Game Engine ───────────────────────────────────────────────────

  function initPlayEngine() {
    var socket = io({ transports: ['websocket', 'polling'] });

    // DOM
    var gridEl = document.getElementById('pixel-grid');
    var keyboardEl = document.getElementById('keyboard');
    var errorToast = document.getElementById('error-toast');
    var winOverlay = document.getElementById('win-overlay');
    var winPic = document.getElementById('win-pic');
    var winName = document.getElementById('win-name');
    var winWord = document.getElementById('win-word');
    var winCount = document.getElementById('win-count');
    var winCountdown = document.getElementById('win-countdown');
    var guessCounterEl = document.getElementById('guess-counter');
    var modeBadge = document.getElementById('mode-badge');

    var currentState = null;
    var currentWordLength = 5;
    var keyStates = {};
    var allGuesses = [];
    var countdownInterval = null;
    var errorTimeout = null;
    var myGuessCount = 0;
    var participatedThisGame = false;
    var AUTO_RESTART_SECONDS = 10;

    // Build keyboard
    function buildKeyboard() {
      keyboardEl.innerHTML = '';
      KB_ROWS.forEach(function (row) {
        var rowEl = document.createElement('div');
        rowEl.className = 'kb-row';
        row.forEach(function (key) {
          var btn = document.createElement('button');
          btn.className = 'kb-key';
          btn.setAttribute('type', 'button');
          if (key === 'ENTER') {
            btn.classList.add('wide', 'enter');
            btn.textContent = 'GO';
            btn.setAttribute('data-key', 'ENTER');
            btn.addEventListener('click', function () { handleKeyPress('ENTER'); });
          } else if (key === '\u232B') {
            btn.classList.add('wide', 'backspace');
            btn.textContent = '\u232B';
            btn.setAttribute('data-key', 'BACK');
            btn.addEventListener('click', function () { handleKeyPress('BACK'); });
          } else {
            btn.textContent = key;
            btn.setAttribute('data-key', key);
            btn.addEventListener('click', function () { handleKeyPress(key); });
          }
          rowEl.appendChild(btn);
        });
        keyboardEl.appendChild(rowEl);
      });
    }
    buildKeyboard();

    function handleKeyPress(key) {
      if (currentState && currentState.gameOver) return;
      if (key === 'ENTER') {
        submitGuess();
      } else if (key === 'BACK') {
        if (currentInput.length > 0) {
          currentInput = currentInput.slice(0, -1);
          renderGrid();
        }
      } else if (/^[A-Z]$/.test(key)) {
        if (currentInput.length < currentWordLength) {
          currentInput += key;
          renderGrid();
        }
      }
    }

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
      else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
      else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
    });

    // Helper: create a pixel-box from a 7x5 grid of color classes
    function createPixelBox(grid, boxClass) {
      var tile = document.createElement('div');
      tile.className = 'letter-tile';
      var box = document.createElement('div');
      box.className = 'pixel-box' + (boxClass ? ' ' + boxClass : '');
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < grid[r].length; c++) {
          var px = document.createElement('div');
          px.className = 'px ' + grid[r][c];
          box.appendChild(px);
        }
      }
      tile.appendChild(box);
      return tile;
    }

    // Helper: create an empty 7x5 pixel-box
    function createEmptyTile(boxClass) {
      var tile = document.createElement('div');
      tile.className = 'letter-tile';
      var box = document.createElement('div');
      box.className = 'pixel-box' + (boxClass ? ' ' + boxClass : ' empty-box');
      for (var p = 0; p < 35; p++) {
        var px = document.createElement('div');
        px.className = 'px empty';
        box.appendChild(px);
      }
      tile.appendChild(box);
      return tile;
    }

    // Rendering
    function renderGrid() {
      if (!currentState) return;
      gridEl.innerHTML = '';

      var len = currentWordLength;
      var displayGuesses = allGuesses.slice(-MAX_GUESSES);
      var totalRows = MAX_GUESSES;
      var kb = currentState.keyboard || {};

      for (var row = 0; row < totalRows; row++) {
        var rowEl = document.createElement('div');

        if (row < displayGuesses.length) {
          // Guessed row
          rowEl.className = 'guess-row';
          var guess = displayGuesses[row];

          if (guess.pixelFeedback) {
            for (var col = 0; col < guess.pixelFeedback.length; col++) {
              var pf = guess.pixelFeedback[col];
              rowEl.appendChild(createPixelBox(pf.grid, pf.correct ? 'correct-box' : ''));
            }
          } else {
            // Fallback: use keyboard grids with gray coloring
            for (var col = 0; col < len; col++) {
              var letter = ((guess.word || '')[col] || '').toUpperCase();
              var kbData = kb[letter];
              if (kbData && kbData.grid) {
                var mappedGrid = kbData.grid.map(function (r) {
                  return r.map(function (v) { return v === 'off' || v === 0 ? 'off' : 'gray'; });
                });
                rowEl.appendChild(createPixelBox(mappedGrid, ''));
              } else {
                rowEl.appendChild(createEmptyTile(''));
              }
            }
          }

          // Player name label
          var nameLabel = document.createElement('div');
          nameLabel.className = 'guess-player';
          nameLabel.textContent = guess.displayName || guess.player || '';

          if (guess.profilePic) {
            var img = document.createElement('img');
            img.src = guess.profilePic;
            img.className = 'guess-pfp';
            img.referrerPolicy = 'no-referrer';
            img.crossOrigin = 'anonymous';
            img.onerror = function () { this.style.display = 'none'; };
            nameLabel.insertBefore(img, nameLabel.firstChild);
          }

          rowEl.appendChild(nameLabel);

        } else if (row === displayGuesses.length && !currentState.gameOver) {
          // Current input row
          rowEl.className = 'guess-row current-row';
          for (var col = 0; col < len; col++) {
            if (col < currentInput.length) {
              var letter = currentInput[col].toUpperCase();
              var kbData = kb[letter];
              if (kbData && kbData.grid) {
                var neutralGrid = kbData.grid.map(function (r) {
                  return r.map(function (v) { return v === 'off' || v === 0 ? 'off' : 'neutral'; });
                });
                rowEl.appendChild(createPixelBox(neutralGrid, 'current-box'));
              } else {
                rowEl.appendChild(createEmptyTile('current-box'));
              }
            } else {
              rowEl.appendChild(createEmptyTile('current-box'));
            }
          }

        } else {
          // Empty future row
          rowEl.className = 'guess-row empty-row';
          for (var col = 0; col < len; col++) {
            rowEl.appendChild(createEmptyTile(''));
          }
        }

        gridEl.appendChild(rowEl);
      }
    }

    function updateKeyboard() {
      var kb = (currentState && currentState.keyboard) || {};
      var keys = keyboardEl.querySelectorAll('.kb-key');
      keys.forEach(function (btn) {
        var letter = btn.getAttribute('data-key');
        if (!letter || letter === 'ENTER' || letter === 'BACK') return;
        var kbData = kb[letter];
        btn.classList.remove('correct', 'wrong', 'absent');

        // Update pixel mini-grid on key if present
        var existingPixels = btn.querySelector('.key-pixels');
        if (existingPixels) existingPixels.remove();

        if (kbData && kbData.grid) {
          if (kbData.status === 'correct') btn.classList.add('correct');
          else if (kbData.status === 'wrong') btn.classList.add('wrong');
          else if (kbData.status === 'absent') btn.classList.add('absent');

          var keyPixels = document.createElement('div');
          keyPixels.className = 'key-pixels';
          for (var r = 0; r < kbData.grid.length; r++) {
            for (var c = 0; c < kbData.grid[r].length; c++) {
              var kpx = document.createElement('div');
              kpx.className = 'kpx ' + kbData.grid[r][c];
              keyPixels.appendChild(kpx);
            }
          }

          // Remove old text label, add pixels + label
          var existingLabel = btn.querySelector('.key-label');
          if (!existingLabel) {
            btn.textContent = '';
            btn.appendChild(keyPixels);
            var label = document.createElement('div');
            label.className = 'key-label';
            label.textContent = letter;
            btn.appendChild(label);
          } else {
            btn.insertBefore(keyPixels, existingLabel);
          }
        }
      });
    }

    function rebuildKeyStates() {
      // No-op: keyboard state comes from server via currentState.keyboard
    }

    function updateGuessCounter() {
      if (guessCounterEl && currentState) {
        guessCounterEl.textContent = allGuesses.length;
      }
    }

    function updateModeBadge(state) {
      if (modeBadge) {
        modeBadge.style.display = 'none';
      }
    }

    // Cosmetics
    function applyCosmetics(els, cos) {
      if (!cos) return;
      if (cos.word_color && els.wordEl) {
        if (cos.word_color.color) els.wordEl.style.color = cos.word_color.color;
        if (cos.word_color.textShadow) els.wordEl.style.textShadow = cos.word_color.textShadow;
        if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
      }
      if (cos.word_glow && els.wordEl) {
        if (cos.word_glow.textShadow) els.wordEl.style.textShadow = cos.word_glow.textShadow;
      }
      if (cos.name_color && els.nameEl) {
        if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
      }
      if (cos.name_glow && els.nameEl) {
        if (cos.name_glow.textShadow) els.nameEl.style.textShadow = cos.name_glow.textShadow;
      }
      if (cos.title && cos.title.title && els.titleContainer) {
        var ts = document.createElement('span');
        ts.className = 'cosmetic-title';
        ts.textContent = ' [' + cos.title.title + ']';
        if (cos.title.titleColor) ts.style.color = cos.title.titleColor;
        els.titleContainer.appendChild(ts);
      }
    }

    // Error toast
    function showError(msg) {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.textContent = msg;
      errorToast.className = 'error-toast shake';
      errorTimeout = setTimeout(function () {
        errorToast.classList.add('hidden');
        errorToast.classList.remove('shake');
      }, 2500);
    }

    // Win display
    function showWin(data) {
      var winner = data.winner || {};
      var totalWins = data.totalWins || 0;
      var badgeHtml = totalWins > 0 ? '<span class="win-badge">' + totalWins + '</span>' : '';
      if (winner.profilePic) {
        var letter = ((winner.displayName || '?')[0]).toUpperCase();
        winPic.innerHTML = '<img src="' + winner.profilePic.replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.parentElement.innerHTML=\'<span class=placeholder-letter>' + letter + '</span>' + badgeHtml.replace(/'/g, "\\'") + '\'">' + badgeHtml;
      } else {
        var letter = ((winner.displayName || '?')[0]).toUpperCase();
        winPic.innerHTML = '<span class="placeholder-letter">' + letter + '</span>' + badgeHtml;
      }
      winName.textContent = winner.displayName || 'Player';
      winName.style.cssText = '';
      winWord.textContent = data.word ? data.word.toUpperCase() : '';
      winWord.style.cssText = '';
      winCount.textContent = (data.guessCount || '?') + ' guesses';
      winName.querySelectorAll('.cosmetic-title').forEach(function (el) { el.remove(); });
      if (winner.cosmetics) {
        applyCosmetics({ nameEl: winName, titleContainer: winName, wordEl: winWord }, winner.cosmetics);
        if (winner.cosmetics.win_effect && window.playWinEffect) window.playWinEffect(winner.cosmetics.win_effect);
      }
      winOverlay.classList.remove('hidden');
      startCountdown(winCountdown);
    }

    function hideWin() {
      winOverlay.classList.add('hidden');
      stopCountdown();
    }

    function startCountdown(el) {
      stopCountdown();
      var remaining = AUTO_RESTART_SECONDS;
      el.textContent = 'Next game in ' + remaining + 's';
      countdownInterval = setInterval(function () {
        remaining--;
        if (remaining <= 0) { stopCountdown(); el.textContent = 'Starting...'; }
        else el.textContent = 'Next game in ' + remaining + 's';
      }, 1000);
    }

    function stopCountdown() {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      if (winCountdown) winCountdown.textContent = '';
    }

    // Guess submission with identity
    function submitGuess() {
      if (submitCooldown) return;
      var word = currentInput.trim().toLowerCase();
      if (!word || word.length !== currentWordLength) return;

      var guessData = { word: word };
      if (userSession) {
        guessData.displayName = userSession.globalName || userSession.username;
        guessData.platform = 'discord';
        guessData.platformUserId = userSession.id;
        guessData.linkedDiscord = userSession.id;
        guessData.profilePic = userSession.avatar || '';
      }

      socket.emit('guess', guessData);
      currentInput = '';
      renderGrid();
      myGuessCount++;
      participatedThisGame = true;

      submitCooldown = true;
      setTimeout(function () { submitCooldown = false; }, 500);
    }

    // Handle full state from server
    function handleState(state) {
      // Normalize: server sends status='won'/'lost'/'active', client expects gameOver bool
      state.gameOver = (state.status === 'won' || state.status === 'lost');
      currentState = state;
      currentWordLength = state.wordLength || 5;
      allGuesses = state.guesses || [];

      rebuildKeyStates();
      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      updateModeBadge(state);

      if (state.status === 'won' && state.winner) {
        showWin({
          word: state.word || (state.guesses.length > 0 ? state.guesses[state.guesses.length - 1].word : ''),
          winner: state.winner,
          guessCount: state.guesses.length,
          totalWins: state.winnerTotalWins || 0
        });
      } else if (state.status === 'active') {
        hideWin();
      }
    }

    // Socket events
    socket.on('game-state', function (state) { handleState(state); });

    socket.on('game-over', function (data) {
      if (currentState) currentState.gameOver = true;
      showWin(data);
      if (participatedThisGame) setTimeout(fetchServerStats, 2000);
    });

    socket.on('guess-error', function (data) {
      showError(data.error || 'Invalid guess');
      currentInput = '';
      renderGrid();
    });

    socket.on('new-game', function (data) {
      hideWin();
      currentInput = '';
      myGuessCount = 0;
      participatedThisGame = false;
      allGuesses = [];
      keyStates = {};
      currentWordLength = data.wordLength || 5;
      currentState = { wordLength: currentWordLength, guesses: [], gameOver: false, winner: null };
      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      updateModeBadge(data);
    });

    // Bind stats toggle after UI is ready
    bindStatsToggle();
  }
})();
