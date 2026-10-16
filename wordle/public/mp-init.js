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
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(106,170,100,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,18,24,0.98),rgba(22,28,38,0.98));border:1px solid rgba(106,170,100,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(106,170,100,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="/wordle/solo/" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(106,170,100,0.12);border:1.5px solid rgba(106,170,100,0.45);color:#fff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
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

// ===== Wordle Multiplayer Init =====
// Handles: auth check, game UI init, stats from server, identity-aware guesses
// Traditional Wordle: 6-row grid showing latest guesses, green/yellow/gray, keyboard states

(function () {
  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  var userSession = null;
  var userProfile = null;
  var guestName = null;
  var DEFAULT_AVATAR = 'https://wordtycoon.live/portal/img/logo.png';
  var statsOpen = false;
  var mpStats = null;
  var myGuessCount = 0;
  var participatedThisGame = false;
  var MAX_ROWS = 6;

  // Inject guest CSS
  if (!document.getElementById('mp-guest-style')) {
    var s = document.createElement('style');
    s.id = 'mp-guest-style';
    s.textContent = '.mp-guest-section{margin:0 0 16px}.mp-guest-row{display:flex;gap:8px;margin-top:8px}.mp-guest-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.15);border-radius:10px;color:inherit;font-size:.9rem;font-family:inherit;outline:none;min-width:0}.mp-guest-input:focus{border-color:#5865F2}.mp-guest-input::placeholder{opacity:.5}.mp-guest-btn{padding:11px 16px;background:#5865F2;border:none;border-radius:10px;color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .2s}.mp-guest-btn:hover{background:#4752c4}';
    document.head.appendChild(s);
  }

  // ─── Auth Check ────────────────────────────────────────────────────

  // OBS embeds (?obs=1) are anonymous and headless: the login screen is
  // force-hidden by mp.html's shim and LoginPrompt skips obs, so without
  // an auto-guest path the page renders fully blank on stream. Start as
  // a guest viewer instead — same flow as a viewer dismissing the login
  // modal on stream-view.
  var IS_OBS_EMBED = false;
  try { IS_OBS_EMBED = new URLSearchParams(location.search).get('obs') === '1'; } catch (_) {}
  function enterAnonymous() {
    if (IS_OBS_EMBED) { guestName = 'Viewer'; initGame(); }
    else showLogin();
  }

  fetch('/api/me/session')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok && data.user) {
        userSession = data.user;
        initGame();
        fetchProfile();
        fetchServerStats();
      } else {
        enterAnonymous();
      }
    })
    .catch(function () { enterAnonymous(); });

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
    fetch('/api/me/wordle')
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
    var socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
    var connectionLost = false;
    var shownWinOpening = null;
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
    var gridEl = document.getElementById('wordle-grid');
    var keyboardEl = document.getElementById('keyboard');
    var errorToast = document.getElementById('error-toast');
    var guessCounterEl = document.getElementById('guess-counter');

    var dailyBadge = document.getElementById('daily-badge');
    var frenzyBadge = document.getElementById('frenzy-badge');
    var frenzyMultEl = document.getElementById('frenzy-mult');

    var currentState = null;
    var currentInput = '';
    var currentWordLength = 5;
    var keyStates = {};      // Cumulative keyboard states from all guesses
    var allGuesses = [];     // All guesses from server
    var errorTimeout = null;
    var submitCooldown = false;

    var KB_ROWS = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
    ];

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

    function updateInputPreview() {
    }

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
      updateInputPreview();
    }

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
      else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
      else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
    });

    // Rendering
    function renderGrid() {
      if (!currentState) return;
      gridEl.innerHTML = '';

      var len = currentWordLength;
      gridEl.style.setProperty('--cols', len);

      // Show last MAX_ROWS guesses (or fewer)
      var displayGuesses = allGuesses.slice(-MAX_ROWS);
      var totalRows = MAX_ROWS;

      for (var row = 0; row < totalRows; row++) {
        var rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        var avatarSlot = document.createElement('div');
        avatarSlot.className = 'guess-player';
        rowEl.appendChild(avatarSlot);

        if (row < displayGuesses.length) {
          var guess = displayGuesses[row];
          for (var col = 0; col < len; col++) {
            var tile = document.createElement('div');
            tile.className = 'wordle-tile filled ' + guess.result[col];
            tile.textContent = guess.word[col];
            tile.style.setProperty('--i', col);
            rowEl.appendChild(tile);
          }

          avatarSlot.textContent = guess.displayName || guess.player || '';

          // Profile pic
          if (guess.profilePic) {
            var img = document.createElement('img');
            img.src = guess.profilePic;
            img.className = 'guess-pfp';
            if (guess.profilePic.indexOf('logo.png') !== -1) img.classList.add('avatar-is-logo');
            img.referrerPolicy = 'no-referrer';
            img.crossOrigin = 'anonymous';
            img.onerror = function () { this.style.display = 'none'; };
            avatarSlot.insertBefore(img, avatarSlot.firstChild);
          }
          // Perk badge. Must run AFTER the textContent write above, which
          // would otherwise wipe the injected span.
          window.PerkBadges && window.PerkBadges.apply(avatarSlot, guess);

          rowEl.classList.add('guessed');
        } else if (row === displayGuesses.length && !currentState.gameOver) {
          // Current input row
          for (var col = 0; col < len; col++) {
            var tile = document.createElement('div');
            if (col < currentInput.length) {
              tile.className = (col === currentInput.length - 1) ? 'wordle-tile typing' : 'wordle-tile typed';
              tile.textContent = currentInput[col];
            } else {
              tile.className = 'wordle-tile empty';
            }
            rowEl.appendChild(tile);
          }
          rowEl.classList.add('current');
        } else {
          // Empty row
          for (var col = 0; col < len; col++) {
            var tile = document.createElement('div');
            tile.className = 'wordle-tile empty';
            rowEl.appendChild(tile);
          }
        }

        gridEl.appendChild(rowEl);
      }
    }

    function updateKeyboard() {
      var keys = keyboardEl.querySelectorAll('.kb-key');
      keys.forEach(function (btn) {
        var letter = btn.getAttribute('data-key');
        if (!letter || letter === 'ENTER' || letter === 'BACK') return;
        var state = keyStates[letter] || '';
        btn.classList.remove('correct', 'present', 'absent');
        if (state) btn.classList.add(state);
      });
    }

    function rebuildKeyStates() {
      keyStates = {};
      for (var i = 0; i < allGuesses.length; i++) {
        var guess = allGuesses[i];
        for (var j = 0; j < guess.word.length; j++) {
          var letter = guess.word[j];
          var state = guess.result[j];
          var current = keyStates[letter];
          if (state === 'correct') {
            keyStates[letter] = 'correct';
          } else if (state === 'present' && current !== 'correct') {
            keyStates[letter] = 'present';
          } else if (state === 'absent' && !current) {
            keyStates[letter] = 'absent';
          }
        }
      }
    }

    function updateGuessCounter() {
      if (guessCounterEl && currentState) {
        guessCounterEl.textContent = allGuesses.length;
      }
    }

    // Cosmetics
    var WC_OUTLINE = '7px 7px 3px #000, -7px -7px 3px #000, 7px -7px 3px #000, -7px 7px 3px #000, 0 7px 3px #000, 0 -7px 3px #000, 7px 0 3px #000, -7px 0 3px #000';
    function ensureRoundFilter() {
      if (!document.getElementById('wc-round')) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0';
        svg.innerHTML = '<filter id="wc-round" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="3" in="SourceGraphic" result="d"/><feMorphology operator="erode" radius="3" in="d"/></filter>';
        document.body.appendChild(svg);
      }
    }
    function applyCosmetics(els, cos) {
      if (!cos) return;
      var vis = window.__COSMETIC_VISIBILITY;
      if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }
      if (cos.word_color && els.wordEl) {
        if (cos.word_color.color) {
                    els.wordEl.style.color = '#fff';
          els.wordEl.style.webkitTextStroke = '28px ' + cos.word_color.color;
          els.wordEl.style.paintOrder = 'stroke fill';
          els.wordEl.style.letterSpacing = '-3px';
        }
        els.wordEl.style.textShadow = WC_OUTLINE;
        if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
      }
      if (cos.word_glow && els.wordEl) {
        if (cos.word_glow.textShadow) {
          var existing = els.wordEl.style.textShadow;
          els.wordEl.style.textShadow = existing ? existing + ', ' + cos.word_glow.textShadow : WC_OUTLINE + ', ' + cos.word_glow.textShadow;
        }
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
      // Hero badge — background gradient on surface element
      if (cos.hero_badge && els.surfaceEl) {
        if (cos.hero_badge.background) {
          els.surfaceEl.style.background = cos.hero_badge.background;
          if (cos.hero_badge.backgroundSize) els.surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
          if (cos.hero_badge.animation) els.surfaceEl.style.animation = cos.hero_badge.animation;
        }
      }
    }

    // Error toast
    function showError(msg, persistent) {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.textContent = String(msg || 'Unable to submit').slice(0, 240);
      errorToast.className = 'error-toast shake';
      if (persistent) return;
      errorTimeout = setTimeout(function () {
        errorToast.classList.add('hidden');
        errorToast.classList.remove('shake');
      }, 2500);
    }

    // Win card — shared WinCard component (single winner, no standings)
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

    // Guess submission — with identity
    function submitGuess() {
      if (submitCooldown) return;
      if (!socket.connected) { showError('Connection lost. Reconnect before submitting a guess.', true); return; }
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

      socket.emit('guess', guessData);
      currentInput = '';
      renderGrid();
      myGuessCount++;
      participatedThisGame = true;

      submitCooldown = true;
      setTimeout(function () { submitCooldown = false; }, 400);
    }

    // Handle full state from server
    function handleState(state) {
      currentState = state;
      currentInput = '';
      currentWordLength = state.wordLength || 5;
      allGuesses = state.guesses || [];

      // Rebuild keyboard states from all guesses
      rebuildKeyStates();

      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      if (state.gameOver && state.winner && shownWinOpening !== state.startTime) {
        shownWinOpening = state.startTime;
        var solved = allGuesses.find(function (g) { return g.result && g.result.length && g.result.every(function (r) { return r === 'correct'; }); });
        showWinCard({ winner: state.winner, totalWins: state.winnerTotalWins || state.totalWins || 0,
          word: state.word || (solved && solved.word) || '', guessCount: allGuesses.length,
          jackpot: state.completedJackpot == null ? state.jackpot : state.completedJackpot, isDaily: !!state.isDaily });
      }
      if (!state.gameOver) { shownWinOpening = null; if (window.WinCard) WinCard.hide(); }

      // Daily & frenzy badges
      if (dailyBadge) dailyBadge.style.display = state.isDaily ? '' : 'none';
      if (state.frenzy && frenzyBadge) {
        if (state.frenzy.multiplier > 1.0) {
          frenzyBadge.style.display = '';
          if (frenzyMultEl) frenzyMultEl.textContent = state.frenzy.multiplier.toFixed(1) + 'x';
        } else {
          frenzyBadge.style.display = 'none';
        }
      }
    }

    // Socket events
    socket.on('disconnect', function () {
      connectionLost = true; currentInput = ''; renderGrid();
      showError('Connection lost. Reconnect before submitting a guess.', true);
    });
    socket.on('connect', function () {
      if (!connectionLost) return;
      connectionLost = false;
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.classList.add('hidden');
    });
    socket.on('game-state', function (state) { handleState(state); });

    socket.on('guess', function (guessData) {
      allGuesses.push(guessData);

      // Update key states incrementally
      for (var i = 0; i < guessData.word.length; i++) {
        var letter = guessData.word[i];
        var state = guessData.result[i];
        var current = keyStates[letter];
        if (state === 'correct') {
          keyStates[letter] = 'correct';
        } else if (state === 'present' && current !== 'correct') {
          keyStates[letter] = 'present';
        } else if (state === 'absent' && !current) {
          keyStates[letter] = 'absent';
        }
      }

      renderGrid();
      updateKeyboard();
      updateGuessCounter();
    });

    socket.on('game-over', function (data) {
      if (currentState) { currentState.gameOver = true; shownWinOpening = currentState.startTime; }
      showWinCard(data);
      if (participatedThisGame) setTimeout(fetchServerStats, 2000);
    });

    socket.on('guess-error', function (data) {
      showError(data.error || 'Invalid guess');
      currentInput = '';
      renderGrid();
    });

    socket.on('new-game', function (data) {
      shownWinOpening = null;
      if (window.WinCard) WinCard.hide();
      currentInput = '';
      myGuessCount = 0;
      participatedThisGame = false;
      allGuesses = [];
      keyStates = {};
      currentWordLength = data.wordLength || 5;
      currentState = { wordLength: currentWordLength, guesses: [], gameOver: false, winner: null, startTime: data.startTime || null };
      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      // Daily badge
      if (dailyBadge) dailyBadge.style.display = (data && data.isDaily) ? '' : 'none';
    });

    socket.on('frenzy-update', function (data) {
      if (!data || !frenzyBadge) return;
      if (data.multiplier > 1.0) {
        frenzyBadge.style.display = '';
        if (frenzyMultEl) frenzyMultEl.textContent = data.multiplier.toFixed(1) + 'x';
      } else {
        frenzyBadge.style.display = 'none';
      }
    });

    // Bind stats toggle after UI is ready
    bindStatsToggle();

    // Monthly hint button (Donor / Super Fan perk)
    initHintButton();
  }

  function initHintButton() {
    if (!window.WTHints) return;
    var hintWrap = document.getElementById('hint-btn-wrap');
    if (!hintWrap) return;
    var handle = null;
    try { handle = window.__SESSION_HANDLE || null; } catch (_) {}

    WTHints.init({
      container: hintWrap,
      game: 'wordle',
      idempotent: true,
      storageKey: 'wordle-hint:' + (handle || 'public'),
      extraBody: function () { return { handle: handle || 'public', expectedStartTime: currentState && currentState.startTime }; },
      onSuccess: function (data) {
        if (data && data.hint) showHint(data.hint, data.staleRound || !currentState || currentState.gameOver || currentState.startTime !== data.startTime);
      },
      onError: function (msg) {
        showError(msg || 'Hint failed');
      }
    });
  }

  function showHint(hint, stale) {
    if (!hint || typeof hint.position !== 'number') return;
    var pos = hint.position + 1;
    var msg = (stale ? 'Previous round hint: ' : 'Hint: ') + hint.letter + ' is in position ' + pos;
    showError(msg);
    // Also briefly highlight the hinted letter on the keyboard.
    if (keyboardEl && !stale) {
      var keyBtn = keyboardEl.querySelector('.kb-key[data-key="' + hint.letter + '"]');
      if (keyBtn) {
        keyBtn.classList.add('hint-reveal');
        setTimeout(function () { keyBtn.classList.remove('hint-reveal'); }, 2500);
      }
    }
  }
})();
