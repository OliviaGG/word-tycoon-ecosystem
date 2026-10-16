// ===== Betwixt Multiplayer Init =====
// Handles: auth check, game UI init, stats from server, identity-aware guesses

(function () {
  var AVATAR_FALLBACK = '/portal/img/logo.png';
  function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
  }

  var userSession = null;
  var userProfile = null;
  var statsOpen = false;
  var mpStats = null;
  var myGuessCount = 0;
  var participatedThisGame = false;

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

    // Initialize the game (inline version of play.js logic)
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
    fetch('/api/me/betwixt')
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

  // Defer binding until game UI is visible
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

  // ─── Game Engine (inline play.js equivalent) ──────────────────────

  function initPlayEngine() {
    var socket = io();

    // DOM Elements
    var lowerTiles = document.getElementById('lower-tiles');
    var upperTiles = document.getElementById('upper-tiles');
    var lowerPfp = document.getElementById('lower-pfp');
    var upperPfp = document.getElementById('upper-pfp');
    var lowerBoundary = document.getElementById('lower-boundary');
    var upperBoundary = document.getElementById('upper-boundary');
    var lowerDistEl = document.getElementById('lower-distance');
    var upperDistEl = document.getElementById('upper-distance');
    var confirmedRow = document.getElementById('confirmed-row');
    var alphaRow1 = document.getElementById('alpha-row-1');
    var alphaRow2 = document.getElementById('alpha-row-2');
    var keyboardEl = document.getElementById('keyboard');
    var errorToast = document.getElementById('error-toast');
    var winOverlay = document.getElementById('win-overlay');
    var winPic = document.getElementById('win-pic');
    var winName = document.getElementById('win-name');
    var winWord = document.getElementById('win-word');
    var winCount = document.getElementById('win-count');
    var winCountdown = document.getElementById('win-countdown');
    var guessCounterEl = document.getElementById('guess-counter');

    var currentState = null;
    var currentInput = '';
    var currentWordLength = 5;
    var winHistory = [];
    var countdownInterval = null;
    var errorTimeout = null;
    var submitCooldown = false;
    var AUTO_RESTART_SECONDS = 10;
    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    // Build alphabet
    function buildAlphabet() {
      alphaRow1.innerHTML = '';
      alphaRow2.innerHTML = '';
      LETTERS.forEach(function (letter, i) {
        var tile = document.createElement('div');
        tile.className = 'alpha-tile possible';
        tile.id = 'alpha-' + letter;
        tile.textContent = letter;
        if (i < 13) alphaRow1.appendChild(tile);
        else alphaRow2.appendChild(tile);
      });
    }
    buildAlphabet();

    function updateGuessCounter() {
      if (guessCounterEl && currentState) guessCounterEl.textContent = currentState.guessCount || 0;
    }

    // QWERTY Keyboard
    var KB_ROWS = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']
    ];

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
            btn.addEventListener('click', function () { handleKeyPress('ENTER'); });
          } else if (key === '⌫') {
            btn.classList.add('wide', 'backspace');
            btn.textContent = '⌫';
            btn.addEventListener('click', function () { handleKeyPress('BACK'); });
          } else {
            btn.textContent = key;
            btn.addEventListener('click', function () { handleKeyPress(key); });
          }
          rowEl.appendChild(btn);
        });
        keyboardEl.appendChild(rowEl);
      });
    }
    buildKeyboard();

    function handleKeyPress(key) {
      if (currentState && currentState.isWon) return;
      if (key === 'ENTER') {
        submitGuess();
      } else if (key === 'BACK') {
        if (currentInput.length > 0) {
          currentInput = currentInput.slice(0, -1);
          updateConfirmedRowWithTyping();
        }
      } else if (/^[A-Z]$/.test(key)) {
        if (currentInput.length < currentWordLength) {
          currentInput += key;
          updateConfirmedRowWithTyping();
        }
      }
    }

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
      else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
      else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
    });

    // Boundary tiles
    function createBoundaryTiles(container, word, isMask) {
      container.innerHTML = '';
      word.toUpperCase().split('').forEach(function (ch) {
        var tile = document.createElement('div');
        tile.className = 'bnd-tile' + (isMask ? ' masked' : '');
        tile.textContent = isMask ? '-' : ch;
        container.appendChild(tile);
      });
    }

    function updateBoundaries(state) {
      if (!state) return;
      var isMaskLower = /^x+$/i.test(state.currentLower);
      var isMaskUpper = /^x+$/i.test(state.currentUpper);
      createBoundaryTiles(lowerTiles, state.currentLower, isMaskLower);
      createBoundaryTiles(upperTiles, state.currentUpper, isMaskUpper);
      renderPfp(lowerPfp, state.lowerBoundaryUser);
      renderPfp(upperPfp, state.upperBoundaryUser);
      if (lowerDistEl) lowerDistEl.textContent = state.lowerCloseness != null ? state.lowerCloseness : '';
      if (upperDistEl) upperDistEl.textContent = state.upperCloseness != null ? state.upperCloseness : '';
      lowerBoundary.classList.add('pop');
      upperBoundary.classList.add('pop');
      setTimeout(function () {
        lowerBoundary.classList.remove('pop');
        upperBoundary.classList.remove('pop');
      }, 300);
    }

    function renderPfp(container, user) {
      container.innerHTML = '';
      if (!user) { container.classList.add('empty'); return; }
      container.classList.remove('empty');
      var img = document.createElement('img');
      img.src = resolveAvatar(user.profilePic);
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.crossOrigin = 'anonymous';
      img.onerror = function () { this.onerror = null; this.src = AVATAR_FALLBACK; };
      container.appendChild(img);
    }

    function updateConfirmedRow(state) {
      if (currentInput.length > 0) { updateConfirmedRowWithTyping(); return; }
      confirmedRow.innerHTML = '';
      var len = state.wordLength;
      var confirmed = state.confirmedLetters || [];
      for (var i = 0; i < len; i++) {
        var tile = document.createElement('div');
        tile.className = 'confirmed-tile';
        if (confirmed[i]) {
          tile.classList.add('confirmed');
          tile.textContent = confirmed[i];
        }
        confirmedRow.appendChild(tile);
      }
    }

    function updateConfirmedRowWithTyping() {
      if (!currentState) return;
      confirmedRow.innerHTML = '';
      var len = currentState.wordLength;
      var confirmed = currentState.confirmedLetters || [];
      for (var i = 0; i < len; i++) {
        var tile = document.createElement('div');
        if (i < currentInput.length) {
          tile.className = 'typing-tile active';
          tile.textContent = currentInput[i];
        } else if (confirmed[i]) {
          tile.className = 'confirmed-tile confirmed';
          tile.textContent = confirmed[i];
          tile.style.opacity = '0.4';
        } else {
          tile.className = 'typing-tile empty';
        }
        confirmedRow.appendChild(tile);
      }
    }

    function updateAlphabet(state) {
      if (!state) return;
      var lower = state.currentLower.toLowerCase();
      var upper = state.currentUpper.toLowerCase();
      var isMaskLower = /^x+$/.test(lower);
      var isMaskUpper = /^x+$/.test(upper);
      var lowerFirst = isMaskLower ? 'a' : lower[0];
      var upperFirst = isMaskUpper ? 'z' : upper[0];

      LETTERS.forEach(function (letter) {
        var tile = document.getElementById('alpha-' + letter);
        var l = letter.toLowerCase();
        var status;
        if (isMaskLower && isMaskUpper) status = 'possible';
        else if (l < lowerFirst) status = 'eliminated';
        else if (l > upperFirst) status = 'eliminated';
        else if (l === lowerFirst && !isMaskLower) status = 'edge';
        else if (l === upperFirst && !isMaskUpper) status = 'edge';
        else status = 'possible';
        tile.className = 'alpha-tile ' + status;
      });
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
      winPic.innerHTML = '<img src="' + resolveAvatar(winner.profilePic).replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.onerror=null;this.src=\'' + AVATAR_FALLBACK + '\'">' + badgeHtml;
      winName.textContent = winner.displayName || 'Player';
      winName.style.cssText = '';
      winWord.textContent = data.word?.toUpperCase() || '';
      winWord.style.cssText = '';
      winCount.textContent = data.guessCount || '?';
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

    // Guess submission — with identity
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
      if (currentState) updateConfirmedRow(currentState);
      myGuessCount++;
      participatedThisGame = true;

      submitCooldown = true;
      setTimeout(function () { submitCooldown = false; }, 400);
    }

    // Handle full state
    function handleState(state) {
      currentState = state;
      var prevLen = currentWordLength;
      currentWordLength = state.wordLength || 5;
      if (state.winHistory) winHistory = state.winHistory;
      updateBoundaries(state);
      updateConfirmedRow(state);
      updateAlphabet(state);
      updateGuessCounter();
      if (state.isWon) {
        var cg = state.guesses.find(function (g) { return g.isCorrect; });
        showWin({ word: cg?.word, winner: state.winner, guessCount: state.guessCount });
      } else {
        hideWin();
      }
    }

    // Socket events
    socket.on('game-state', function (state) { handleState(state); });
    socket.on('new-guess', function () {});
    socket.on('game-won', function (data) {
      if (data.winner) {
        winHistory.unshift({
          winner: { displayName: data.winner.displayName, platform: data.winner.platform, platformUserId: data.winner.platformUserId || data.winner.id },
          word: data.word, guessCount: data.guessCount, timestamp: new Date().toISOString()
        });
      }
      showWin(data);
      // Refresh stats after win
      if (participatedThisGame) setTimeout(fetchServerStats, 2000);
    });
    socket.on('guess-error', function (data) {
      showError(data.error || 'Invalid guess');
      currentInput = '';
      if (currentState) updateConfirmedRow(currentState);
    });
    socket.on('new-game', function (state) {
      hideWin();
      currentInput = '';
      myGuessCount = 0;
      participatedThisGame = false;
      handleState(state);
    });

    // Bind stats toggle after UI is ready
    bindStatsToggle();
  }
})();
