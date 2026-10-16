// Premium gate (2026-07-19): public multiplayer is Donor-only. The server
// drops non-premium web guesses and emits premium-required; this wall is
// dismissible so spectating stays open.
window.wtShowPremiumWall = window.wtShowPremiumWall || function (loggedIn) {
  var existing = document.getElementById('premium-wall');
  if (existing) { existing.style.display = 'flex'; return; }
  var el = document.createElement('div');
  el.id = 'premium-wall';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(5,8,12,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
  var signinBtn = loggedIn ? '' :
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,107,157,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,18,24,0.98),rgba(22,28,38,0.98));border:1px solid rgba(255,107,157,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,107,157,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="/pixeletters/solo/" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(255,107,157,0.12);border:1.5px solid rgba(255,107,157,0.45);color:#fff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
        '<a href="https://wordtycoon.live/me?tab=pass" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(196,102,255,0.1);border:1.5px solid rgba(196,102,255,0.4);color:#c98aff;font-weight:900;text-decoration:none;">Become a Donor &mdash; $2/mo</a>' +
        signinBtn +
      '</div>' +
      '<p style="margin:18px 0 0;font-size:0.72rem;color:rgba(184,196,208,0.55);">You can keep watching the game behind this message.</p>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById('premium-wall-close').onclick = function () { el.style.display = 'none'; };
  var sb = document.getElementById('premium-wall-signin');
  if (sb) sb.onclick = function () {
    window.location.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent(location.href);
  };
};

// ===== PixeLetters Multiplayer Init =====
// Handles: auth check, game UI init, stats from server, identity-aware guesses
// Pixel-art letter grids with color feedback, keyboard states

(function () {
  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  var userSession = null;
  var userProfile = null;
  var guestName = null;
  var DEFAULT_AVATAR = 'https://wordtycoon.live/portal/img/logo.png';
  var statsOpen = false;

  // Inject guest CSS
  if (!document.getElementById('mp-guest-style')) {
    var s = document.createElement('style');
    s.id = 'mp-guest-style';
    s.textContent = '.mp-guest-section{margin:0 0 16px}.mp-guest-row{display:flex;gap:8px;margin-top:8px}.mp-guest-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.15);border-radius:10px;color:inherit;font-size:.9rem;font-family:inherit;outline:none;min-width:0}.mp-guest-input:focus{border-color:#5865F2}.mp-guest-input::placeholder{opacity:.5}.mp-guest-btn{padding:11px 16px;background:#5865F2;border:none;border-radius:10px;color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .2s}.mp-guest-btn:hover{background:#4752c4}';
    document.head.appendChild(s);
  }
  var mpStats = null;
  var currentInput = '';
  var MAX_GUESSES = 0; // 0 = unlimited, overridden by server state
  var submitCooldown = false;
  var pendingGuess = false;

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
    ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
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
    // wt-obs-guest-fallback: the login card is hidden site-wide by an unconditional
    // rule in mp.html ('.mp-login-screen{display:none!important}'), so its
    // "continue as guest" button can never be clicked. Without this, an
    // unauthenticated viewer — notably the OBS overlay — never reaches
    // initGame() and the page renders permanently blank. If that rule is
    // ever removed, computed display stops being "none" and the normal
    // login flow returns on its own.
    var _wtLoginScreen = document.getElementById('login-screen');
    if (_wtLoginScreen && getComputedStyle(_wtLoginScreen).display === 'none') {
      guestName = guestName || 'Anonymous';
      initGame();
      return;
    }
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('game-ui').style.display = 'none';
    var guestInput = document.getElementById('guest-name-input');
    var guestBtn = document.getElementById('guest-play-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', function () {
        var name = guestInput ? guestInput.value.trim().replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
        guestName = name || 'Anonymous';
        initGame();
      });
      if (guestInput) guestInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') guestBtn.click(); });
    }
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
    var _ioOpts = { transports: ['websocket', 'polling'] };
    if (_sessHandle) _ioOpts.auth = { session: _sessHandle };
    var socket = io(_ioOpts);
    socket.on('premium-required', function (info) { window.wtShowPremiumWall(!!(info && info.loggedIn)); });
    socket.on('session-redirect', function (data) {
      if (!data || !data.targetUrl) return;
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
    });

    // DOM
    var gridEl = document.getElementById('pixel-grid');
    var keyboardEl = document.getElementById('keyboard');
    var errorToast = document.getElementById('error-toast');
    var guessCounterEl = document.getElementById('guess-counter');
    var modeBadge = document.getElementById('mode-badge');

    var currentState = null;
    var currentWordLength = 5;
    var keyStates = {};
    var allGuesses = [];
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
      if (pendingGuess || (currentState && currentState.gameOver)) return;
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
      var displayGuesses = allGuesses;
      var maxG = (currentState && currentState.maxGuesses) ? currentState.maxGuesses : 0;
      // With unlimited (0): only show guesses + current input, no empty future rows
      var totalRows;
      if (maxG > 0) {
        totalRows = Math.max(maxG, displayGuesses.length + (currentState.gameOver ? 0 : 1));
      } else {
        totalRows = displayGuesses.length + (currentState.gameOver ? 0 : 1);
      }
      var kb = currentState.keyboard || {};

      for (var row = 0; row < totalRows; row++) {
        var rowEl = document.createElement('div');

        if (row < displayGuesses.length) {
          // Guessed row
          rowEl.className = 'guess-row';
          var guess = displayGuesses[row];
          var pfpWrap = document.createElement('span');
          pfpWrap.className = 'guess-pfp-wrap';
          window.PerkBadges && window.PerkBadges.apply(pfpWrap, guess);
          rowEl.appendChild(pfpWrap);

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

          if (guess.profilePic) {
            var pfp = document.createElement('img');
            pfp.className = 'guess-pfp';
            if (guess.profilePic.indexOf('logo.png') !== -1) pfp.classList.add('avatar-is-logo');
            pfp.src = guess.profilePic;
            pfp.referrerPolicy = 'no-referrer';
            pfp.crossOrigin = 'anonymous';
            pfp.onerror = function () { this.style.display = 'none'; };
            pfpWrap.appendChild(pfp);
          }

        } else if (row === displayGuesses.length && !currentState.gameOver) {
          // Current input row
          rowEl.className = 'guess-row current-row';
          var currentSpacer = document.createElement('span');
          currentSpacer.className = 'guess-pfp-wrap guess-pfp-placeholder';
          rowEl.appendChild(currentSpacer);
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

        } else if (maxG > 0) {
          // Empty future row (only when max guesses is set)
          rowEl.className = 'guess-row empty-row';
          var emptySpacer = document.createElement('span');
          emptySpacer.className = 'guess-pfp-wrap guess-pfp-placeholder';
          rowEl.appendChild(emptySpacer);
          for (var col = 0; col < len; col++) {
            rowEl.appendChild(createEmptyTile(''));
          }
        }

        gridEl.appendChild(rowEl);
      }

      // Auto-scroll game area to keep latest guesses visible
      var gameArea = document.getElementById('game-area');
      if (gameArea) {
        requestAnimationFrame(function () { gameArea.scrollTop = gameArea.scrollHeight; });
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
          // Only highlight correct (blue) — all others stay green (default)
          if (kbData.status === 'correct') btn.classList.add('correct');

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

    // Error toast
    function showError(msg) {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.textContent = String(msg || 'Please retry').slice(0, 240);
      errorToast.className = 'error-toast shake';
      errorTimeout = setTimeout(function () {
        errorToast.classList.add('hidden');
        errorToast.classList.remove('shake');
      }, 2500);
    }

    // Win display — shared WinCard component. It renders perk badges,
    // cosmetics and win_effect itself, and lazy-fetches whatever the payload
    // doesn't carry (cosmetics, perks, total wins) from the winner's identity.
    var winCardShown = false;
    function showWin(data) {
      if (winCardShown || !window.WinCard) return;
      winCardShown = true;
      var opts = {
        game: 'pixeletters',
        gameName: 'PixeLetters',
        word: data.word || '',
        guessCount: data.guessCount || 0,
        winner: data.winner || {},
        jackpot: data.jackpot,
        autoHideMs: AUTO_RESTART_SECONDS * 1000
      };
      if (data.totalWins > 0) opts.totalWins = data.totalWins;
      window.WinCard.showMp(opts);
    }

    function hideWin() {
      winCardShown = false;
      if (window.WinCard) window.WinCard.hide();
    }

    // Guess submission with identity
    function submitGuess() {
      if (!socket.connected) { showOffline(); return; }
      if (submitCooldown || pendingGuess || (currentState && currentState.gameOver)) return;
      var word = currentInput.trim().toLowerCase();
      if (!word || word.length !== currentWordLength) return;

      var guessData = { word: word };
      if (userSession) {
        guessData.displayName = userSession.globalName || userSession.username;
        guessData.platform = 'discord';
        guessData.platformUserId = userSession.id;
        guessData.linkedDiscord = userSession.id;
        guessData.profilePic = userSession.avatar || DEFAULT_AVATAR;
      } else if (guestName) {
        guessData.displayName = guestName;
        guessData.platform = 'web';
        guessData.platformUserId = 'web_' + guestName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        guessData.profilePic = DEFAULT_AVATAR;
      }

      pendingGuess = true;
      socket.emit('guess', guessData);
      submitCooldown = true;
      setTimeout(function () { submitCooldown = false; }, 500);
    }

    // Handle full state from server
    function handleState(state) {
      // Normalize: server sends status='won'/'lost'/'active', client expects gameOver bool
      state.gameOver = state.status !== 'active';
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
          totalWins: state.winnerTotalWins || 0,
          jackpot: state.jackpotAwarded == null ? state.jackpot : state.jackpotAwarded
        });
      } else if (state.status === 'active') {
        hideWin();
      }
    }

    function showOffline() {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.setAttribute('role','alert');
      errorToast.textContent = 'Offline — reconnect before submitting a guess.';
      errorToast.className = 'error-toast';
    }
    socket.on('disconnect', function () { pendingGuess = false; showOffline(); });
    socket.on('connect_error', function () { pendingGuess = false; showOffline(); });
    socket.on('connect', function () {
      pendingGuess = false; submitCooldown = false; currentInput = ''; renderGrid();
      errorToast.classList.add('hidden');
    });
    socket.on('premium-required', function () { pendingGuess = false; });
    socket.on('guess-result', function (result) {
      if (!pendingGuess) return;
      pendingGuess = false;
      if (result.error) { showError(result.error); return; }
      currentInput = ''; myGuessCount++; participatedThisGame = true; renderGrid();
    });
    // Socket events
    socket.on('game-state', function (state) { handleState(state); });

    socket.on('game-over', function (data) {
      if (currentState) currentState.gameOver = true;
      showWin(data);
      if (participatedThisGame) setTimeout(fetchServerStats, 2000);
    });

    socket.on('guess-error', function (data) {
      pendingGuess = false;
      showError(data.error || 'Invalid guess');
      renderGrid();
    });

    socket.on('new-game', function (data) {
      hideWin();
      pendingGuess = false;
      currentInput = '';
      myGuessCount = 0;
      participatedThisGame = false;
      allGuesses = [];
      keyStates = {};
      currentWordLength = data.wordLength || 5;
      currentState = { hintStartTime: data.hintStartTime || data.startedAt || data.startTime, wordLength: currentWordLength, guesses: [], gameOver: false, winner: null };
      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      updateModeBadge(data);
    });

    // Bind stats toggle after UI is ready
    bindStatsToggle();

    // Monthly hint button (Donor / Super Fan perk)
    initHintButton();

    function initHintButton() {
      if (!window.WTHints) return;
      var hintWrap = document.getElementById('hint-btn-wrap');
      if (!hintWrap) return;
      var handle = null;
      try { handle = window.__SESSION_HANDLE || null; } catch (_) {}

      WTHints.init({
        container: hintWrap,
        game: 'pixeletters',
      idempotent: true,
      storageKey: 'wt-hint-pixeletters-mp-' + (handle || 'public'),
        extraBody: function () { return { handle: handle || 'public', expectedStartTime: currentState && currentState.hintStartTime }; },
        onSuccess: function (data) {
          if (data && data.hint) showHint(data.hint, data);
        },
        onError: function (msg) {
          showError(msg || 'Hint failed');
        }
      });
    }

    function showHint(hint, receipt) {
      if (!hint || typeof hint.position !== 'number') return;
      if (receipt && (receipt.staleRound || !currentState || currentState.hintStartTime !== receipt.startTime)) { showError('Previous round hint: ' + hint.letter + ' is in position ' + (hint.position + 1)); return; }
      var pos = hint.position + 1;
      showError('Hint: ' + hint.letter + ' is in position ' + pos);
      // Also briefly highlight the hinted letter on the keyboard.
      if (keyboardEl) {
        var keyBtn = keyboardEl.querySelector('.kb-key[data-key="' + hint.letter + '"]');
        if (keyBtn) {
          keyBtn.classList.add('hint-reveal');
          setTimeout(function () { keyBtn.classList.remove('hint-reveal'); }, 2500);
        }
      }
    }
  }
})();
