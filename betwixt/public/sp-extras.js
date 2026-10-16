// ===== Betwixt SP Extras =====
// Adds: stats dropdown, local stats tracking, login banner

(function () {
  var STATS_KEY = 'betwixt_sp_stats';
  var BANNER_DISMISSED_KEY = 'betwixt_banner_dismissed';
  var statsOpen = false;
  var userSession = null;
  var myGuessCount = 0; // how many guesses I made this game
  var participatedThisGame = false;

  // ─── Local Stats ───────────────────────────────────────────────────

  function loadStats() {
    try {
      var raw = localStorage.getItem(STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { wins: 0, gamesPlayed: 0, totalGuesses: 0, winStreak: 0, bestStreak: 0, history: [] };
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  function recordGameResult(won, word, guessCount) {
    var stats = loadStats();
    stats.gamesPlayed++;
    if (won) {
      stats.wins++;
      stats.totalGuesses += guessCount;
      stats.winStreak++;
      if (stats.winStreak > stats.bestStreak) stats.bestStreak = stats.winStreak;
    } else {
      stats.winStreak = 0;
    }
    stats.history.unshift({
      word: word,
      won: won,
      guessCount: guessCount,
      timestamp: new Date().toISOString()
    });
    // Cap history at 100
    if (stats.history.length > 100) stats.history.length = 100;
    saveStats(stats);
    renderStats();
  }

  // ─── Stats UI ──────────────────────────────────────────────────────

  function renderStats() {
    var stats = loadStats();
    var winsEl = document.getElementById('stat-wins');
    var gamesEl = document.getElementById('stat-games');
    var avgEl = document.getElementById('stat-avg');
    var streakEl = document.getElementById('stat-streak');
    var historyEl = document.getElementById('stats-history');

    if (winsEl) winsEl.textContent = stats.wins;
    if (gamesEl) gamesEl.textContent = stats.gamesPlayed;
    if (avgEl) avgEl.textContent = stats.wins > 0
      ? (stats.totalGuesses / stats.wins).toFixed(1)
      : '-';
    if (streakEl) streakEl.textContent = stats.winStreak;

    if (historyEl) {
      var recent = (stats.history || []).slice(0, 10);
      if (recent.length === 0) {
        historyEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:0.7rem;padding:8px 0">No games yet</div>';
      } else {
        historyEl.innerHTML = recent.map(function (h) {
          var dt = h.timestamp ? new Date(h.timestamp) : null;
          var dateStr = dt ? dt.toLocaleDateString() : '';
          return '<div class="stats-h-entry">' +
            '<div><span class="stats-h-word">' + (h.word || '???').toUpperCase() + '</span>' +
            '<span class="stats-h-guesses">' + (h.won ? h.guessCount + ' guesses' : 'lost') + '</span></div>' +
            '<span class="stats-h-result ' + (h.won ? 'win' : 'loss') + '">' + (h.won ? 'WIN' : 'LOSS') + '</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  // ─── Stats Toggle ──────────────────────────────────────────────────

  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeBtn = document.getElementById('stats-close');

  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener('click', function () {
      statsOpen = !statsOpen;
      if (statsOpen) {
        dropdown.classList.remove('hidden');
        toggleBtn.classList.add('active');
        renderStats();
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

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (statsOpen && dropdown && toggleBtn &&
        !dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
      statsOpen = false;
      dropdown.classList.add('hidden');
      toggleBtn.classList.remove('active');
    }
  });

  // ─── Login Banner ──────────────────────────────────────────────────

  var banner = document.getElementById('login-banner');
  var bannerClose = document.getElementById('banner-close');

  // Check session
  fetch('/api/me/session').then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      userSession = data.user;
      // Already logged in — hide banner
      if (banner) banner.classList.add('hidden');
    } else {
      // Not logged in — show banner (unless dismissed)
      if (banner && !localStorage.getItem(BANNER_DISMISSED_KEY)) {
        banner.classList.remove('hidden');
      }
    }
  }).catch(function () {});

  if (bannerClose && banner) {
    bannerClose.addEventListener('click', function () {
      banner.classList.add('hidden');
      try { localStorage.setItem(BANNER_DISMISSED_KEY, '1'); } catch (e) {}
    });
  }

  // ─── Hook into game events for stats tracking ─────────────────────

  // Track when user submits a guess
  var _origSubmitGuess = window.submitGuess;
  if (typeof _origSubmitGuess === 'function') {
    window.submitGuess = function () {
      myGuessCount++;
      participatedThisGame = true;
      _origSubmitGuess.apply(this, arguments);
    };
  }

  // Track game-won events
  socket.on('game-won', function (data) {
    if (participatedThisGame) {
      // Check if the winner is "us" (web player with no identity)
      var winner = data.winner || {};
      var isMyWin = (winner.platform === 'web' && (!winner.platformUserId || winner.platformUserId === 'web'));
      recordGameResult(isMyWin, data.word || '?', data.guessCount || myGuessCount);
    }
  });

  // Reset tracking on new game
  socket.on('new-game', function () {
    myGuessCount = 0;
    participatedThisGame = false;
  });

  // Also reset on full state if game not won
  socket.on('game-state', function (state) {
    if (!state.isWon && state.guessCount === 0) {
      myGuessCount = 0;
      participatedThisGame = false;
    }
  });

  // Initial render
  renderStats();
})();
