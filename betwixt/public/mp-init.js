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
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(123,104,238,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,18,24,0.98),rgba(22,28,38,0.98));border:1px solid rgba(123,104,238,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(123,104,238,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="/game/betwixt/play" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(123,104,238,0.12);border:1.5px solid rgba(123,104,238,0.45);color:#fff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
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

// ===== Betwixt Multiplayer Init =====
// Handles: auth check, game UI init, stats from server, identity-aware guesses

(function () {
  // Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
  window.__COSMETIC_VISIBILITY = {};
  try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

  var AVATAR_FALLBACK = '/portal/img/logo.png';
  function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
  }

  var userSession = null;
  var userProfile = null;
  var guestName = localStorage.getItem('betwixt_guest_name') || '';
  var guestId = localStorage.getItem('betwixt_guest_id') || ('web_guest_' + Math.random().toString(36).slice(2, 10));
  localStorage.setItem('betwixt_guest_id', guestId);
  var DEFAULT_AVATAR = 'https://wordtycoon.live/portal/img/logo.png';
  var statsOpen = false;
  var mpStats = null;
  var myGuessCount = 0;
  var participatedThisGame = false;

  // Inject guest CSS
  if (!document.getElementById('mp-guest-style')) {
    var s = document.createElement('style');
    s.id = 'mp-guest-style';
    s.textContent = '.mp-guest-section{margin:20px 0 0}.mp-guest-row{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border-radius:10px;padding:4px}.mp-guest-input{flex:1;min-width:0;padding:12px 14px;border:none;background:transparent;color:#fff;font-size:.95rem;font-family:Inter,sans-serif;outline:none}.mp-guest-input::placeholder{color:#818384}.mp-guest-btn{width:auto;flex-shrink:0;padding:12px 18px;background:#39ff14;border:none;border-radius:10px;color:#1a1a2e;font-size:.95rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:Inter,sans-serif;transition:transform .16s ease,opacity .16s ease}.mp-guest-btn:hover{transform:translateY(-1px);opacity:.96}';
    document.head.appendChild(s);
  }

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
    var closeBtn = document.getElementById('login-close-btn');
    function continueAsGuest(forceAnonymous) {
      var name = guestInput ? guestInput.value.trim().replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
      guestName = forceAnonymous ? 'Anonymous' : (name || 'Anonymous');
      localStorage.setItem('betwixt_guest_name', guestName);
      initGame();
    }
    if (guestInput) guestInput.value = guestName === 'Anonymous' ? '' : guestName;
    if (guestBtn) guestBtn.onclick = function () { continueAsGuest(false); };
    if (closeBtn) closeBtn.onclick = function () { continueAsGuest(true); };
    if (guestInput) guestInput.onkeydown = function (e) { if (e.key === 'Enter') continueAsGuest(false); };
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
    var _sessHandle = (function () {
      try {
        var q = new URLSearchParams(location.search).get('session');
        if (q && /^[a-z0-9_-]{1,32}$/.test(q)) return q;
        var m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})$/i);
        if (m && m[1]) {
          var h = m[1].toLowerCase();
          var RES = ['admin', 'overlay', 'index.html', 'mp.html', 'sp.html', 'overlay.html', 'play', 'play.html'];
          if (RES.indexOf(h) === -1) return h;
        }
      } catch (e) {}
      return null;
    })();
    window.__SESSION_HANDLE = _sessHandle;
    var socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
    socket.on('premium-required', function (info) { pendingGuess = null; window.wtShowPremiumWall(!!(info && info.loggedIn)); });
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
    var guessCounterEl = document.getElementById('guess-counter');

    var currentState = null;
    var currentInput = '';
    var hintRevealed = {};
    var currentWordLength = 5;
    var winHistory = [];
    var errorTimeout = null;
    var submitCooldown = false;
    var pendingGuess = null;
    var shownWinOpening = null;
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
      ['⌫', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
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
      window.PerkBadges && window.PerkBadges.apply(container, user);
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
        } else if (hintRevealed[i]) {
          tile.className = 'confirmed-tile confirmed hint-reveal';
          tile.textContent = hintRevealed[i];
          tile.style.background = '#f5c542';
          tile.style.color = '#1a1a2e';
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
    var WC_OUTLINE = '7px 7px 3px #000, -7px -7px 3px #000, 7px -7px 3px #000, -7px 7px 3px #000, 0 7px 3px #000, 0 -7px 3px #000, 7px 0 3px #000, -7px 0 3px #000';
    function ensureRoundFilter() {
      if (!document.getElementById('wc-round')) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0';
        svg.innerHTML = '<filter id="wc-round" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="3" in="SourceGraphic" result="d"/><feMorphology operator="erode" radius="3" in="d"/></filter>';
        document.body.appendChild(svg);
      }
    }

    // Error toast
    function showError(msg, persistent) {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.textContent = String(msg || 'Unable to complete action').slice(0, 240);
      errorToast.className = 'error-toast shake';
      if (persistent) return;
      errorTimeout = setTimeout(function () {
        errorToast.classList.add('hidden');
        errorToast.classList.remove('shake');
      }, 2500);
    }

    // Win display — the shared WinCard. Betwixt MP is a race to one word with
    // a single winner, so there are no round standings to pass.
    function showWin(data) {
      if (!window.WinCard) return;
      var opening = currentState && currentState.hintStartTime;
      if (opening && shownWinOpening === opening) return;
      shownWinOpening = opening;
      var winner = data.winner || {};
      // WinCard resolves identity/cosmetics off platformUserId; the guess
      // payload carries it as `id`.
      if (!winner.platformUserId && winner.id) {
        winner = Object.assign({}, winner, { platformUserId: winner.id });
      }
      WinCard.showMp({
        game: 'betwixt',
        gameName: 'Betwixt',
        word: data.word,
        jackpot: data.jackpot,
        guessCount: data.guessCount,
        totalWins: typeof data.totalWins === 'number' ? data.totalWins : undefined,
        winner: winner,
        // Server auto-restarts after AUTO_RESTART_SECONDS; 'new-game' also
        // hides the card below.
        autoHideMs: AUTO_RESTART_SECONDS * 1000
      });
    }

    function hideWin() {
      shownWinOpening = null;
      if (window.WinCard) WinCard.hide();
    }

    // Guess submission — with identity
    function submitGuess() {
      if (!socket.connected) { showError('Connection lost. Reconnect before submitting a guess.', true); return; }
      if (submitCooldown || pendingGuess) return;
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
        guessData.platformUserId = guestId;
        guessData.profilePic = DEFAULT_AVATAR;
      }

      pendingGuess = word;
      socket.emit('guess', guessData);

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
        showWin({ word: cg?.word, winner: state.winner, guessCount: state.guessCount, jackpot: state.jackpotAwarded ?? state.jackpot });
      } else {
        hideWin();
      }
    }

    // Socket events
    socket.on('disconnect', function () {
      pendingGuess = null; currentInput = ''; submitCooldown = false;
      if (currentState) updateConfirmedRow(currentState);
      showError('Connection lost. Reconnect before submitting a guess.', true);
    });
    socket.on('connect', function () {
      pendingGuess = null; currentInput = ''; submitCooldown = false;
      if (errorTimeout) clearTimeout(errorTimeout);
      errorToast.classList.add('hidden');
      if (currentState) updateConfirmedRow(currentState);
    });
    socket.on('guess-result', function (data) {
      if (!data || !data.ok || !pendingGuess) return;
      pendingGuess = null; currentInput = '';
      myGuessCount++; participatedThisGame = true;
      if (currentState) updateConfirmedRow(currentState);
    });
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
      pendingGuess = null;
      showError(data.error || 'Invalid guess');
      if (currentState) updateConfirmedRow(currentState);
    });
    socket.on('new-game', function (state) {
      pendingGuess = null;
      hideWin();
      currentInput = '';
      hintRevealed = {};
      myGuessCount = 0;
      participatedThisGame = false;
      handleState(state);
    });

    function initHintButton() {
      if (!window.WTHints) return;
      var hintWrap = document.getElementById('hint-btn-wrap');
      if (!hintWrap) return;
      var handle = null;
      try { handle = window.__SESSION_HANDLE || null; } catch (_) {}

      WTHints.init({
        container: hintWrap,
        game: 'betwixt',
      idempotent: true,
      storageKey: 'wt-hint-betwixt-mp-' + (handle || 'public'),
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
      var letter = (hint.letter || '').toUpperCase();
      if (!letter) return;
      hintRevealed[hint.position] = letter;
      updateConfirmedRowWithTyping();
      showError('Hint: ' + letter + ' is in position ' + (hint.position + 1));
      if (keyboardEl) {
        var keyBtn = keyboardEl.querySelector('.kb-key[data-key="' + letter + '"]');
        if (keyBtn) {
          keyBtn.classList.add('hint-reveal');
          var oldBg = keyBtn.style.background;
          var oldColor = keyBtn.style.color;
          keyBtn.style.background = '#f5c542';
          keyBtn.style.color = '#1a1a2e';
          setTimeout(function () {
            keyBtn.classList.remove('hint-reveal');
            keyBtn.style.background = oldBg;
            keyBtn.style.color = oldColor;
          }, 2500);
        }
      }
    }

    // Bind stats toggle after UI is ready
    bindStatsToggle();

    // Monthly hint button (Donor / Super Fan perk)
    initHintButton();
  }
})();
