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
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(0,229,255,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,18,24,0.98),rgba(22,28,38,0.98));border:1px solid rgba(0,229,255,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(0,229,255,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="/game/figural/sp.html" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(0,229,255,0.12);border:1.5px solid rgba(0,229,255,0.45);color:#fff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
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

// ===== Figural MP (Online) Init =====
// Discord-authenticated multiplayer Figural via Socket.IO.
// Unlimited guesses — game only ends when solved.

(function () {
  'use strict';

  var AVATAR_FALLBACK = '/portal/img/logo.png';
  function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
  }

  var isOverlay = new URLSearchParams(location.search).has('overlay');

  if (isOverlay) document.body.classList.add('overlay-mode');

  // ─── Auth Check ─────────────────────────────────────────────────────

  var loginScreen = document.getElementById('login-screen');
  var gameUI = document.getElementById('game-ui');
  var userSession = null;
  var guestName = null;
  var DEFAULT_AVATAR = 'https://wordtycoon.live/portal/img/logo.png';

  // Inject guest CSS
  if (!document.getElementById('mp-guest-style')) {
    var gs = document.createElement('style');
    gs.id = 'mp-guest-style';
    gs.textContent = '.mp-guest-section{margin:0 0 16px}.mp-guest-row{display:flex;gap:8px;margin-top:8px}.mp-guest-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.15);border-radius:10px;color:inherit;font-size:.9rem;font-family:inherit;outline:none;min-width:0}.mp-guest-input:focus{border-color:#5865F2}.mp-guest-input::placeholder{opacity:.5}.mp-guest-btn{padding:11px 16px;background:#5865F2;border:none;border-radius:10px;color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .2s}.mp-guest-btn:hover{background:#4752c4}';
    document.head.appendChild(gs);
  }

  function launchGame() {
    document.body.classList.add('mp-game-active');
    loginScreen.style.display = 'none';
    gameUI.style.display = 'flex';
    gameUI.style.flexDirection = 'column';
    gameUI.style.height = '100%';
    initGame();
  }

  fetch('/api/me/session')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok && data.user) {
        userSession = data.user;
        launchGame();
      } else {
        setupGuestBtn();
      }
    })
    .catch(function () {
      setupGuestBtn();
    });

  function setupGuestBtn() {
    // wt-obs-guest-fallback: the login card is hidden site-wide by an unconditional
    // rule in mp.html ('.mp-login-screen{display:none!important}'), so its
    // "continue as guest" button can never be clicked. Without this, an
    // unauthenticated viewer — notably the OBS overlay — never reaches
    // launchGame() and the page renders permanently blank. If that rule is
    // ever removed, computed display stops being "none" and the normal
    // login flow returns on its own.
    var _wtLoginScreen = document.getElementById('login-screen');
    if (_wtLoginScreen && getComputedStyle(_wtLoginScreen).display === 'none') {
      guestName = guestName || 'Anonymous';
      launchGame();
      return;
    }
    var guestInput = document.getElementById('guest-name-input');
    var guestBtn = document.getElementById('guest-play-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', function () {
        var name = guestInput ? guestInput.value.trim().replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
        guestName = name || 'Anonymous';
        launchGame();
      });
      if (guestInput) guestInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') guestBtn.click(); });
    }
  }

  // ─── State ──────────────────────────────────────────────────────────

  var socket = null;
  var gameState = null;
  var shownWinOpening = null;
  var connectionLost = false;
  var currentInput = '';
  var SYMBOL_COLOR_MAP = {};

  // ─── DOM refs ───────────────────────────────────────────────────────

  var board = document.getElementById('board');
  var guessCountEl = document.getElementById('guess-count');
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
    var wordLen = gameState.wordLength || 5;
    var guesses = gameState.guesses || [];

    board.className = 'word-len-' + wordLen;

    // Completed guesses
    for (var g = 0; g < guesses.length; g++) {
      var wrapper = document.createElement('div');
      wrapper.className = 'guess-wrapper';

      // Player pfp
      var player = guesses[g].player;
      var pfpWrap = document.createElement('span');
      pfpWrap.className = 'guess-pfp-wrap';
      window.PerkBadges && window.PerkBadges.apply(pfpWrap, player);
      var pfpEl = document.createElement('img');
      pfpEl.className = 'guess-pfp';
      pfpEl.src = resolveAvatar(player && player.profilePic ? player.profilePic : null);
      pfpEl.alt = '';
      pfpEl.onerror = function () { this.onerror = null; this.src = AVATAR_FALLBACK; };
      pfpWrap.appendChild(pfpEl);
      wrapper.appendChild(pfpWrap);

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

      wrapper.appendChild(row);
      board.appendChild(wrapper);
    }

    // Current input row (player mode only, not overlay)
    if (!gameState.solved && !isOverlay) {
      var inputWrapper = document.createElement('div');
      inputWrapper.className = 'guess-wrapper';
      var inputSpacer = document.createElement('div');
      inputSpacer.className = 'guess-pfp-placeholder';
      inputWrapper.appendChild(inputSpacer);

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

      inputWrapper.appendChild(inputRow);
      board.appendChild(inputWrapper);
    }

    // Show all 8 at game start, none during play
    var filledRows = guesses.length + (!gameState.solved && !isOverlay ? 1 : 0);
    var emptyLimit;
    if (guesses.length === 0 && !gameState.solved) {
      emptyLimit = 8;
    } else {
      emptyLimit = filledRows;
    }
    for (var r = filledRows; r < emptyLimit; r++) {
      var emptyWrapper = document.createElement('div');
      emptyWrapper.className = 'guess-wrapper';
      var emptySpacer = document.createElement('div');
      emptySpacer.className = 'guess-pfp-placeholder';
      emptyWrapper.appendChild(emptySpacer);

      var row = document.createElement('div');
      row.className = 'guess-row';
      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        row.appendChild(cell);
      }
      emptyWrapper.appendChild(row);
      board.appendChild(emptyWrapper);
    }

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
    if (guessCountEl) guessCountEl.textContent = (gameState.guesses || []).length + ' guesses';
    if (wordLengthTag) wordLengthTag.textContent = gameState.wordLength + ' letters';
    if (gameState.jackpot != null && jackpotEl) {
      jackpotEl.textContent = gameState.jackpot;
    }
  }

  function updateKeyboard() {
    if (!gameState) return;
    var guesses = gameState.guesses || [];
    var used = {};
    for (var g = 0; g < guesses.length; g++) {
      for (var i = 0; i < guesses[g].word.length; i++) {
        used[guesses[g].word[i]] = true;
      }
    }
    var keys = document.querySelectorAll('.kb-key');
    for (var k = 0; k < keys.length; k++) {
      var letter = keys[k].dataset.key;
      if (letter && letter.length === 1 && used[letter]) {
        keys[k].classList.add('kb-used');
      } else {
        keys[k].classList.remove('kb-used');
      }
    }
  }

  function showMessage(text, type, persistent) {
    if (!messageEl) return;
    text = String(text || '').slice(0, 240);
    messageEl.textContent = text;
    messageEl.className = type || '';
    if (type && !persistent) {
      setTimeout(function () {
        if (messageEl.textContent === text) {
          messageEl.textContent = '';
          messageEl.className = '';
        }
      }, 3000);
    }
  }

  function showWin(data) {
    shownWinOpening = gameState && gameState.startTime;
    if (!window.WinCard) return;
    var winner = data.winner || {};
    // WinCard resolves identity/cosmetics via platformUserId; the guess
    // payload carries it as `id`.
    if (!winner.platformUserId && winner.id) {
      winner = Object.assign({}, winner, { platformUserId: winner.id });
    }
    WinCard.showMp({
      game: 'figural',
      gameName: 'Figural',
      word: data.word,
      jackpot: data.jackpot,
      guessCount: gameState && gameState.guesses ? gameState.guesses.length : 0,
      winner: winner,
      // Server auto-restarts the round after 15s (AUTO_RESTART_MS); the card
      // mirrors that window and 'new-game' also hides it below.
      autoHideMs: 15000
    });
  }

  function shakeCurrentRow() {
    var row = document.getElementById('current-row');
    if (!row) return;
    row.classList.add('shake-row');
    setTimeout(function () { row.classList.remove('shake-row'); }, 400);
  }

  // ─── Socket Events ─────────────────────────────────────────────────

  function initGame() {
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
    socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
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

    socket.on('jackpot-update', function (data) {
      if (!gameState || gameState.solved || !data || !Number.isFinite(data.jackpot)) return;
      gameState.jackpot = data.jackpot; if (jackpotEl) jackpotEl.textContent = data.jackpot;
    });
    socket.on('disconnect', function () {
      connectionLost = true; currentInput = ''; renderBoard();
      showMessage('Connection lost. Reconnect before submitting a guess.', 'error', true);
    });
    socket.on('connect', function () {
      if (!connectionLost) return;
      connectionLost = false; currentInput = ''; showMessage('', '');
    });
    socket.on('game-state', function (state) {
      gameState = state;
      if (gameState) {
        gameState._localStart = Date.now() - Math.max(0, (gameState.guesses || []).length * 6000);
        buildColorMap(gameState.symbols || [], gameState.symbolColors || []);
      }
      currentInput = '';
      renderBoard();
      renderLegend();
      updateStatus();
      updateKeyboard();
      startJackpotTimer();
      if (state && state.solved && state.winner) {
        if (shownWinOpening !== state.startTime) showWin(state);
      } else { shownWinOpening = null; if (window.WinCard) WinCard.hide(); }

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

    socket.on('new-game', function (state) {
      shownWinOpening = null;
      gameState = state;
      if (gameState) {
        gameState._localStart = Date.now();
        buildColorMap(gameState.symbols || [], gameState.symbolColors || []);
      }
      currentInput = '';
      renderBoard();
      renderLegend();
      updateStatus();
      updateKeyboard();
      startJackpotTimer();
      if (window.WinCard) WinCard.hide();
      showMessage('New round! ' + (gameState ? gameState.wordLength : '?') + ' letters', '');

      // Daily badge
      if (dailyBadge) dailyBadge.style.display = (state && state.isDaily) ? '' : 'none';
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

    socket.on('guess-result', function (data) {
      if (!gameState || !data.guess) return;

      gameState.guesses = gameState.guesses || [];
      var isDuplicate = gameState.guesses.some(function (g) { return g.word === data.guess.word; });
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
      updateKeyboard();
    });

    socket.on('game-over', function (data) {
      if (data.won) {
        showWin(data);
      }
      // No fail handling — unlimited guesses
    });

    socket.on('error-msg', function (data) {
      showMessage(data.message || 'Error', 'error');
      shakeCurrentRow();
    });

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
      game: 'figural',
      idempotent: true,
      storageKey: 'wt-hint-figural-mp-' + (handle || 'public'),
      extraBody: function () { return { handle: handle || 'public', expectedStartTime: gameState && new Date(gameState.startTime).toISOString() }; },
      onSuccess: function (data) {
        if (data && data.hint) showHint(data.hint, data);
      },
      onError: function (msg) {
        showMessage(msg || 'Hint failed', 'error');
      }
    });
  }

  var HINT_LABELS = {
    not_present: 'not in the word',
    wrong_position: 'in the word, wrong position',
    correct: 'correct letter & position'
  };

  function showHint(hint, receipt) {
    if (!hint) return;
      if (receipt && (receipt.staleRound || !gameState || new Date(gameState.startTime).toISOString() !== receipt.startTime)) { showMessage('Previous round hint: ' + hint.symbol + ' means ' + (HINT_LABELS[hint.meaning] || hint.meaning), ''); return; }

    if (hint.type === 'symbol_meaning' && hint.symbol) {
      // Reveal the meaning in the legend and highlight it.
      var legendItems = document.querySelectorAll('.legend-item');
      for (var i = 0; i < legendItems.length; i++) {
        var symEl = legendItems[i].querySelector('.legend-symbol');
        if (symEl && symEl.textContent === hint.symbol) {
          var meaningEl = legendItems[i].querySelector('.legend-meaning');
          if (meaningEl) {
            meaningEl.textContent = '= ' + (HINT_LABELS[hint.meaning] || hint.meaning || '?');
          }
          legendItems[i].classList.add('hint-revealed');
          break;
        }
      }
      showMessage('Hint: ' + hint.symbol + ' means ' + (HINT_LABELS[hint.meaning] || hint.meaning), '');
      return;
    }

    // Fallback for a letter-position hint (server can return this shape too).
    if (typeof hint.position === 'number' && hint.letter) {
      var keyBtn = document.querySelector('.kb-key[data-key="' + hint.letter + '"]');
      if (keyBtn) keyBtn.classList.add('hint-reveal');
      showMessage('Hint: ' + hint.letter + ' is in position ' + (hint.position + 1), '');
    }
  }

  // ─── Keyboard input ────────────────────────────────────────────────

  function handleKey(key) {
    if (!gameState || gameState.solved || isOverlay) return;

    if (key === 'Backspace') {
      currentInput = currentInput.slice(0, -1);
      renderBoard();
      return;
    }

    if (key === 'Enter') {
      if (!socket || !socket.connected) { showMessage('Connection lost. Reconnect before submitting a guess.', 'error', true); return; }
      if (currentInput.length !== gameState.wordLength) {
        showMessage('Need ' + gameState.wordLength + ' letters', 'error');
        shakeCurrentRow();
        return;
      }
      var player;
      if (userSession) {
        player = {
          username: userSession.username,
          displayName: userSession.displayName || userSession.username,
          id: userSession.discordId || userSession.id,
          platform: 'mobile',
          profilePic: userSession.avatar || DEFAULT_AVATAR
        };
      } else if (guestName) {
        player = {
          username: guestName,
          displayName: guestName,
          id: 'web_' + guestName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          platform: 'web',
          profilePic: DEFAULT_AVATAR
        };
      }
      socket.emit('guess', { word: currentInput, player: player });
      return;
    }

    if (/^[A-Z]$/.test(key) && currentInput.length < gameState.wordLength) {
      currentInput += key;
      renderBoard();

      var currentRow = document.getElementById('current-row');
      if (currentRow) {
        var cells = currentRow.querySelectorAll('.cell.filled');
        var lastCell = cells[cells.length - 1];
        if (lastCell) {
          lastCell.classList.add('pop');
          setTimeout(function () { lastCell.classList.remove('pop'); }, 120);
        }
      }
    }
  }

  // Physical keyboard
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
  var kbEl = document.getElementById('keyboard');
  if (kbEl) {
    kbEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.kb-key');
      if (!btn) return;
      var key = btn.dataset.key;
      if (key === 'Enter') handleKey('Enter');
      else if (key === 'Backspace') handleKey('Backspace');
      else handleKey(key);
    });
  }

})();
