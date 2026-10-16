/* === Color 500 — solo page ===============================================
   Daily puzzle + unlimited practice, sharing the multiplayer shell and the
   builders in ui.js.

   The browser never sees the secret. Every guess is scored by POST
   /api/solo/guess and the code only comes back once the round is over, which
   is what makes the daily worth paying coins for.                           */

(function () {
  'use strict';

  var UI = window.C500UI;
  var MAX_ROWS = 10;              // the whole board fits — solo caps at 10 guesses

  var state = {
    mode: 'daily',
    palette: [],
    codeLength: 4,
    maxGuesses: 10,
    guesses: [],
    gameOver: false,
    won: false,
    code: null,
    today: null,
  };
  var draft = [];
  var enterKey = null;
  var busy = false;

  var el = {
    guesses: document.getElementById('guesses'),
    palette: document.getElementById('palette'),
    guessesLeft: document.getElementById('guesses-left'),
    modeSub: document.getElementById('mode-sub'),
    userPill: document.getElementById('user-pill'),
    userPillName: document.getElementById('user-pill-name'),
    userPillAvatar: document.getElementById('user-pill-avatar'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayCode: document.getElementById('overlay-code'),
    overlayDetail: document.getElementById('overlay-detail'),
    overlayReward: document.getElementById('overlay-reward'),
    playAgain: document.getElementById('play-again'),
    helpBtn: document.getElementById('help-btn'),
    helpOverlay: document.getElementById('help-overlay'),
    helpClose: document.getElementById('help-close'),
    helpTriangle: document.getElementById('help-triangle'),
    letterLegend: document.getElementById('letterLegend'),
  };

  // ── Solo token ─────────────────────────────────────────────────────────
  // Identifies this browser's in-progress rounds. NOT an identity: daily
  // completion for a signed-in player is tracked by Chat Relay against their
  // account, so clearing this can't farm the daily reward twice.
  function soloToken() {
    var key = 'colour500:solo-token';
    var t = null;
    try { t = localStorage.getItem(key); } catch (e) {}
    if (!t || !/^[A-Za-z0-9_-]{8,64}$/.test(t)) {
      t = 'st_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(key, t); } catch (e) {}
    }
    return t;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'x-solo-token': soloToken() }, opts.headers || {});
    if (opts.body) opts.headers['content-type'] = 'application/json';
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  // ── Auth (same flow as the multiplayer page) ───────────────────────────
  var AUTH_BASE = 'https://wordtycoon.live';
  var loggedIn = false;
  // Kept for the WinCard on a win: the hub session carries a Discord-style
  // identity (provider defaults to 'discord' — see Chat Relay /api/me/session),
  // which is what the card's total-wins lazy-fetch resolves against.
  var user = null;

  function paintUserPill(name, pic) {
    el.userPillName.textContent = name;
    el.userPill.classList.toggle('is-guest', !loggedIn);
    el.userPill.title = loggedIn
      ? 'Signed in as ' + name
      : 'Sign in so your daily counts toward your streak and pays coins';
    if (pic) { el.userPillAvatar.src = pic; el.userPillAvatar.style.display = ''; }
    else el.userPillAvatar.style.display = 'none';
    // Avatar-only when signed in with a picture — same rule as the MP page, so
    // the two Color 500 headers don't disagree. See .is-avatar-only in app.css.
    el.userPill.classList.toggle('is-avatar-only', loggedIn && !!pic);
  }

  function resolveUser() {
    return fetch('api/me/session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        if (d && d.ok && d.user) {
          loggedIn = true;
          user = {
            displayName: d.user.displayName || d.user.username || 'Player',
            username: d.user.username || null,
            profilePic: d.user.avatar || d.user.profilePic || null,
            platform: d.user.provider || 'discord',
            platformUserId: d.user.id || null,
          };
          paintUserPill(user.displayName, user.profilePic);
        } else {
          loggedIn = false;
          user = null;
          paintUserPill('Sign in', null);
        }
      });
  }

  el.userPill.addEventListener('click', function () {
    if (loggedIn) { location.href = AUTH_BASE + '/me'; return; }
    if (window.LoginPrompt && window.LoginPrompt.showModal) {
      return window.LoginPrompt.showModal({ authBase: AUTH_BASE, returnTo: location.href });
    }
    location.href = AUTH_BASE + '/api/auth/sso-check?returnTo=' + encodeURIComponent(location.href);
  });

  // ── Rendering ──────────────────────────────────────────────────────────

  function renderBoard() {
    el.guesses.innerHTML = '';
    var list = state.guesses.slice(-MAX_ROWS);
    list.forEach(function (g, i) {
      el.guesses.appendChild(UI.committedRow(g, state.palette, {
        index: i + 1,
        animate: false,
      }));
    });
    if (!state.gameOver) {
      el.guesses.appendChild(UI.activeRow(draft, state.codeLength, state.palette, {
        index: state.guesses.length + 1,
      }));
    }
    el.guessesLeft.textContent = Math.max(0, state.maxGuesses - state.guesses.length);
    if (enterKey) enterKey.disabled = state.gameOver || busy || draft.length !== state.codeLength;
  }

  function renderPalette() {
    enterKey = UI.renderPalette(el.palette, state.palette, {
      onPick: pick,
      onDelete: function () { draft.pop(); renderBoard(); },
      onSubmit: submit,
    });
  }

  function renderHelp() {
    el.helpTriangle.innerHTML = '';
    el.helpTriangle.appendChild(UI.buildTriangle(1, 2, 1));
    el.letterLegend.innerHTML = '';
    state.palette.forEach(function (c) {
      var li = document.createElement('li');
      var sw = document.createElement('i');
      sw.style.background = c.hex;
      li.appendChild(sw);
      li.appendChild(document.createTextNode(c.letter + ' — ' + c.name));
      el.letterLegend.appendChild(li);
    });
  }

  // ── Input ──────────────────────────────────────────────────────────────

  function pick(i) {
    if (state.gameOver || busy) return;
    if (draft.length >= state.codeLength) return;
    draft.push(i);
    renderBoard();
  }

  function submit() {
    if (state.gameOver || busy) return;
    if (draft.length !== state.codeLength) return;
    var symbols = draft.map(function (i) { return state.palette[i].square; }).join('');
    busy = true;
    renderBoard();
    api('api/solo/guess', {
      method: 'POST',
      body: JSON.stringify({ guess: symbols, mode: state.mode }),
    }).then(function (d) {
      busy = false;
      if (!d || !d.ok) {
        showError(d && d.error === 'storage-unavailable'
          ? 'Progress could not be saved. Your guess is still here; please retry.'
          : 'Guess not accepted: ' + (d && d.error || 'please retry'));
        renderBoard();
        return;
      }
      draft = [];
      applyState(d);
      if (state.gameOver) {
        if (state.mode === 'daily' && state.won) markDailyLocally(state.today);
        showRoundOver(d.reward);
      }
    }).catch(function () {
      busy = false;
      showError('Connection lost. Your guess is still here; reconnect before retrying.');
      renderBoard();
    });
  }
  function showError(message) {
    var node = document.getElementById('c500-solo-error');
    if (!node) { node = document.createElement('div'); node.id = 'c500-solo-error'; node.setAttribute('role', 'alert');
      node.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;max-width:90vw;background:#141b2b;color:#fff;padding:12px;border-radius:12px;'; document.body.appendChild(node); }
    node.textContent = message;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (el.helpOverlay.classList.contains('is-open')) {
      if (ev.key === 'Escape') closeHelp();
      return;
    }
    if (ev.key === 'Enter') { submit(); return; }
    if (ev.key === 'Backspace') { if (!busy) { draft.pop(); renderBoard(); } ev.preventDefault(); return; }
    var k = String(ev.key || '').toUpperCase();
    for (var i = 0; i < state.palette.length; i++) {
      if (state.palette[i].letter === k) { pick(i); return; }
    }
  });

  // ── Round over ─────────────────────────────────────────────────────────

  function showRoundOver(reward) {
    // Win → the shared Word Tycoon win card. The overlay below is now the
    // LOSS card (and the fallback if win-card.js failed to load).
    if (state.won && window.WinCard) { showWinCard(reward); return; }

    el.overlayTitle.textContent = state.won ? 'Cracked it!' : 'Out of guesses';
    el.overlayTitle.style.color = state.won ? '' : 'var(--red)';

    el.overlayCode.innerHTML = '';
    (state.code || []).forEach(function (i) {
      el.overlayCode.appendChild(UI.codeChip(i, state.palette));
    });

    el.overlayDetail.textContent = state.won
      ? 'Solved in ' + state.guesses.length + ' guess' + (state.guesses.length === 1 ? '' : 'es')
      : 'The code was above.';

    var note = '';
    if (state.mode === 'daily') {
      if (state.won && reward && reward.alreadyCompleted) note = 'Daily already counted today.';
      else if (state.won && reward) note = reward.rewardPending ? 'Daily complete — reward delivery pending.' : 'Daily complete — coins awarded.';
      else if (state.won && !loggedIn) note = 'Sign in to earn coins and build a streak.';
      else if (!state.won) note = 'Come back tomorrow for a new code.';
    }
    el.overlayReward.textContent = note;

    // The daily can't be replayed; practice always can.
    el.playAgain.textContent = state.mode === 'daily' ? 'Try practice mode' : 'Practice again';
    el.overlay.classList.add('is-open');
  }

  // Sticky (autoHideMs 0) like the old card — the practice action is the only
  // way onward. The card has no free-text slot, so the daily reward note rides
  // as an inert action chip. Guests get no identity, so the card's total-wins
  // chip stays hidden for them (the component skips the fetch).
  function showWinCard(reward) {
    var note = '';
    if (state.mode === 'daily') {
      if (reward && reward.alreadyCompleted) note = 'Daily already counted today.';
      else if (reward) note = reward.rewardPending ? 'Daily complete — reward delivery pending.' : 'Daily complete — coins awarded.';
      else if (!loggedIn) note = 'Sign in to earn coins and build a streak.';
    }
    var word = (state.code || []).map(function (i) {
      var c = state.palette[i];
      return c ? c.letter : '?';
    }).join('');
    var actions = [];
    if (note) actions.push({ label: note });
    actions.push({
      label: state.mode === 'daily' ? 'Try practice mode' : 'Practice again',
      primary: true,
      onClick: startPractice,
    });
    actions.push({ label: 'Play online', href: './' });
    window.WinCard.showSolo({
      game: 'colour500',
      gameName: 'Colour 500',
      word: word,
      guessCount: state.guesses.length,
      winner: user || { displayName: 'You' },
      actions: actions,
      autoHideMs: 0,
    });
  }

  function startPractice() {
    state.mode = 'practice';
    el.modeSub.textContent = 'PRACTICE';
    el.overlay.classList.remove('is-open');
    if (window.WinCard) window.WinCard.hide();
    api('api/solo/new', { method: 'POST', body: JSON.stringify({ mode: 'practice' }) })
      .then(function (d) {
        if (d && d.ok) { draft = []; applyState(d); renderBoard(); }
      });
  }

  el.playAgain.addEventListener('click', startPractice);

  // ── Help ───────────────────────────────────────────────────────────────
  function openHelp() { renderHelp(); el.helpOverlay.classList.add('is-open'); }
  function closeHelp() { el.helpOverlay.classList.remove('is-open'); }
  el.helpBtn.addEventListener('click', openHelp);
  el.helpClose.addEventListener('click', closeHelp);
  el.helpOverlay.addEventListener('click', function (ev) {
    if (ev.target === el.helpOverlay) closeHelp();
  });

  // ── State ──────────────────────────────────────────────────────────────

  // The Word Tycoon hub shows a "done today" dot by comparing this
  // localStorage date against today (the `dailyKey` on the portal game card).
  // Server-side completion is the real record for signed-in players; this is
  // the guest-facing fallback, same pattern as word5000's sp-daily module.
  function markDailyLocally(date) {
    if (!date) return;
    try { localStorage.setItem('colour500_sp_daily_date', date); } catch (e) {}
  }

  function applyState(d) {
    state.mode = d.mode || state.mode;
    state.palette = d.palette || state.palette;
    state.codeLength = d.codeLength || state.codeLength;
    state.maxGuesses = d.maxGuesses || state.maxGuesses;
    state.guesses = d.guesses || [];
    state.gameOver = !!d.gameOver;
    state.won = !!d.won;
    state.code = d.code || null;
    if (d.today) state.today = d.today;
    el.modeSub.textContent = state.mode === 'daily' ? 'DAILY' : 'PRACTICE';
    renderBoard();
  }

  function boot() {
    // ?mode=practice jumps straight past the daily.
    var q = new URLSearchParams(location.search).get('mode');
    state.mode = q === 'practice' ? 'practice' : 'daily';

    resolveUser();
    api('api/solo/state?mode=' + state.mode).then(function (d) {
      if (!d || !d.ok) return;
      state.palette = d.palette || [];
      renderPalette();
      applyState(d);
      if (state.gameOver) showRoundOver(null);
    });
  }

  boot();
})();
