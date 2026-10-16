/* === Colour 500 — play page ==============================================
   Mirrors Word 5000's shell (header → guess stack → docked input → overlays).
   Plain script, no build step, matching the rest of the ecosystem's static
   game pages. The server owns all game logic; this file renders state and
   submits guesses.

   Layout parity notes:
     - The guess stack shows the newest MAX_ROWS committed guesses, oldest of
       those at the top, with the active row pinned at the bottom — the same
       reading order as word5000. Colour 500 has unlimited guesses, so older
       rows fall off rather than filling a fixed 8-slot board.
     - The palette sits exactly where word5000 docks its keyboard and reuses
       its .kb-key glass shell.
     - The triangle is word5000's, geometry for geometry:
         green = exact · yellow = right colour wrong slot · red = not in code
*/

(function () {
  'use strict';

  var MAX_ROWS = 8;               // committed rows kept on screen

  // ── Private streamer session detection ─────────────────────────────────
  // Rooms use ?session=<handle> on the hub's /game/colour500/ proxy; the
  // dedicated site also accepts color500.com/<handle>. The query takes
  // precedence, while the proxy mount itself must never become a handle.
  function detectSessionHandle() {
    var queryHandle = new URLSearchParams(location.search).get('session');
    if (queryHandle !== null) {
      queryHandle = queryHandle.toLowerCase().trim();
      return /^[a-z0-9_-]{1,32}$/.test(queryHandle) ? queryHandle : null;
    }
    var parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    var first = parts[0].toLowerCase();
    if (first === 'game' || first === 'solo' || first === 'overlay') return null;
    if (!/^[a-z0-9_-]{1,32}$/.test(first)) return null;
    return first;
  }

  var sessionHandle = detectSessionHandle();
  var socket = sessionHandle ? io({ auth: { session: sessionHandle } }) : io();

  // Premium gate (2026-07-31): web multiplayer is Donor Class / TikTok Super
  // Fan only — public room and streamer player page alike. The server drops
  // non-premium guesses and emits premium-required; this wall is dismissible
  // so spectating stays open. Same copy and layout as the other games' walls
  // (see figural/public/mp-init.js), recoloured to the Color 500 palette.
  socket.on('premium-required', function (info) {
    showPremiumWall(!!(info && info.loggedIn));
  });
  function showPremiumWall(loggedIn) {
    var existing = document.getElementById('premium-wall');
    if (existing) { existing.style.display = 'flex'; return; }
    var el = document.createElement('div');
    el.id = 'premium-wall';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(6,8,14,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
    var signinBtn = loggedIn ? '' :
      '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,214,102,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
    el.innerHTML =
      '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,16,26,0.98),rgba(24,26,42,0.98));border:1px solid rgba(255,214,102,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
        '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
        '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,214,102,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
        '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
        '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<a href="/solo" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(255,214,102,0.12);border:1.5px solid rgba(255,214,102,0.45);color:#ffd666;font-weight:900;text-decoration:none;">Play the free daily</a>' +
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
  }

  var state = {
    palette: [],
    codeLength: 4,
    gameOver: false,
    requireLetterPrefix: false,
    guesses: [],
  };
  var draft = [];
  var submitting = false;
  var submissionTimer = null;
  var roundStartedAt = null;
  var user = null;
  var animateLast = false;
  var enterKey = null;
  var UI = window.C500UI;

  var el = {
    guesses: document.getElementById('guesses'),
    palette: document.getElementById('palette'),
    userPill: document.getElementById('user-pill'),
    userPillName: document.getElementById('user-pill-name'),
    userPillAvatar: document.getElementById('user-pill-avatar'),
    helpBtn: document.getElementById('help-btn'),
    helpOverlay: document.getElementById('help-overlay'),
    helpClose: document.getElementById('help-close'),
    helpTriangle: document.getElementById('help-triangle'),
  };

  // ── Identity + sign-in ─────────────────────────────────────────────────
  // Chat Relay on wordtycoon.live owns auth for the whole ecosystem. This is
  // a plain-script port of word5000's modules/auth.js, and the flow is:
  //
  //   1. ?auth_token=… in the URL  → exchange it for a session cookie
  //   2. otherwise ask for our own session
  //   3. still a guest, and we're on color500.com rather than the hub?
  //      quietly ask the hub whether it knows this browser. If it does,
  //      bounce through sso-check to pick up a token. If it doesn't, stay a
  //      guest — no redirect loop, no interruption.
  //
  // Why signing in matters: guests (web_guest_*) get session-only rewards,
  // so a guest who cracks the code earns NOTHING. A signed-in player's
  // jackpot lands in their real Word Tycoon balance.
  //
  // Two server-side allowlists must contain color500.com or this silently
  // fails — CR_ALLOWED_ORIGINS (for step 3's cross-origin read) and
  // TRUSTED_RETURN_HOSTS (or sso-check bounces to /me instead of back here).

  var AUTH_BASE = 'https://wordtycoon.live';
  var AUTH_TOKEN_PARAMS = ['auth_token', 'auth'];
  var SSO_RETRY_MS = 60000;
  var loggedIn = false;

  function guestId() {
    var key = 'colour500:guest';
    var id = null;
    try { id = localStorage.getItem(key); } catch (e) { /* private mode */ }
    if (!id) {
      id = 'web_guest_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(key, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  function authTokenFromUrl() {
    var params = new URLSearchParams(location.search);
    for (var i = 0; i < AUTH_TOKEN_PARAMS.length; i++) {
      var v = params.get(AUTH_TOKEN_PARAMS[i]);
      if (v) return v;
    }
    return null;
  }

  function cleanAuthParamsFromUrl() {
    var url = new URL(location.href);
    var changed = false;
    AUTH_TOKEN_PARAMS.forEach(function (n) {
      if (url.searchParams.has(n)) { url.searchParams.delete(n); changed = true; }
    });
    if (changed) {
      history.replaceState(history.state, document.title,
        url.pathname + url.search + url.hash);
    }
  }

  function cleanReturnTo() {
    var url = new URL(location.href);
    AUTH_TOKEN_PARAMS.forEach(function (n) { url.searchParams.delete(n); });
    return url.toString();
  }

  // Only worth trying when we're on a different origin than the hub. Served
  // under wordtycoon.live/game/colour500/ the ordinary session check already
  // hits the same cookie jar.
  function shouldTryHubSso() {
    try {
      return location.origin !== new URL(AUTH_BASE).origin
        && /^https?:$/.test(location.protocol);
    } catch (e) { return false; }
  }

  function ssoMarkerKey() { return 'colour500:sso:' + location.origin + location.pathname; }
  function recentlyTriedSso() {
    try {
      var ts = Number(sessionStorage.getItem(ssoMarkerKey()) || 0);
      return ts && (Date.now() - ts) < SSO_RETRY_MS;
    } catch (e) { return false; }
  }
  function markSsoTried() {
    try { sessionStorage.setItem(ssoMarkerKey(), String(Date.now())); } catch (e) {}
  }
  function clearSsoMarker() {
    try { sessionStorage.removeItem(ssoMarkerKey()); } catch (e) {}
  }

  // Premium-gate handshake. The gate proves identity from the wt_remember cookie
  // carried on the Socket.IO handshake -- but that handshake went out at parse time,
  // before the exchange below planted the cookie, and handshake headers are frozen
  // for the life of a connection. Without this the player looks signed in and still
  // gets 'premium-required' on every guess until they refresh by hand. Reload once,
  // on the token-stripped URL, so the new handshake carries the cookie. Uses
  // location.replace + an explicit param strip: no history entry, and no chance of
  // re-consuming a spent token. See chat-relay/src/game-shared.js verifySocketIdentity.
  function reloadForFreshHandshake() {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('auth_token');
      u.searchParams.delete('auth');
      u.searchParams.delete('sso_checked');
      location.replace(u.pathname + u.search + u.hash);
    } catch (e) { location.reload(); }
  }
  function fetchSession(url) {
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        return (d && d.ok && d.user) ? d.user : null;
      });
  }

  function adoptUser(u) {
    loggedIn = true;
    user = {
      id: u.id,
      username: u.username || u.displayName || u.id,
      displayName: u.displayName || u.globalName || u.username || 'Player',
      profilePic: u.avatar || u.profilePic || null,
    };
    paintUserPill();
  }

  function adoptGuest() {
    loggedIn = false;
    var id = guestId();
    user = { id: id, username: id, displayName: 'Sign in', profilePic: null };
    paintUserPill();
  }

  function paintUserPill() {
    el.userPillName.textContent = user.displayName;
    el.userPill.classList.toggle('is-guest', !loggedIn);
    el.userPill.title = loggedIn
      ? 'Signed in as ' + user.displayName
      : 'Sign in so your winnings are paid to your account';
    // is-avatar-only collapses the pill to the picture alone (word5000 does the
    // same on narrow screens) — the name is the widest thing in the header and
    // it's already on the /me page the pill links to. Gated on there actually
    // BEING a picture: a signed-in account with no profilePic would otherwise
    // render an empty pill with nothing to click.
    if (user.profilePic) {
      el.userPillAvatar.src = user.profilePic;
      el.userPillAvatar.style.display = '';
    } else {
      el.userPillAvatar.style.display = 'none';
    }
    el.userPill.classList.toggle('is-avatar-only', loggedIn && !!user.profilePic);
  }

  function signIn() {
    var returnTo = cleanReturnTo();
    // login-prompt.js (loaded from the hub) gives the shared modal with every
    // provider. If it hasn't loaded, fall back to the SSO redirect.
    if (window.LoginPrompt && window.LoginPrompt.showModal) {
      return window.LoginPrompt.showModal({ authBase: AUTH_BASE, returnTo: returnTo });
    }
    location.href = AUTH_BASE + '/api/auth/sso-check?returnTo=' + encodeURIComponent(returnTo);
  }

  el.userPill.addEventListener('click', function () {
    if (loggedIn) location.href = AUTH_BASE + '/me';
    else signIn();
  });

  function resolveUser() {
    var token = authTokenFromUrl();
    var step;

    if (token) {
      // Root-relative on purpose: nginx proxies /api/auth/ straight to the
      // relay, so Set-Cookie lands on THIS origin. Routing it through our own
      // /api/me proxy would swallow the cookie.
      step = fetchSession('/api/auth/exchange?token=' + encodeURIComponent(token))
        .then(function (u) {
          cleanAuthParamsFromUrl();
          if (u) { clearSsoMarker(); reloadForFreshHandshake(); }
          return u;
        });
    } else {
      step = Promise.resolve(null);
    }

    return step
      .then(function (u) {
        if (u) return u;
        return fetchSession('api/me/session');
      })
      .then(function (u) {
        if (u) { clearSsoMarker(); adoptUser(u); return; }

        if (shouldTryHubSso() && !recentlyTriedSso()) {
          return fetchSession(AUTH_BASE + '/api/me/session').then(function (hubUser) {
            if (hubUser) {
              markSsoTried();
              location.href = AUTH_BASE + '/api/auth/sso-check?returnTo='
                + encodeURIComponent(cleanReturnTo());
              return;
            }
            adoptGuest();
          });
        }
        adoptGuest();
      })
      .catch(adoptGuest);
  }

  // ── Board + docked palette (builders shared with solo via ui.js) ───────

  function renderBoard() {
    el.guesses.innerHTML = '';
    var list = state.guesses.slice(-MAX_ROWS);
    list.forEach(function (g, i) {
      var isNewest = (i === list.length - 1);
      el.guesses.appendChild(UI.committedRow(g, state.palette, {
        showAvatar: true,
        animate: animateLast && isNewest,
      }));
    });
    animateLast = false;
    if (!state.gameOver) {
      el.guesses.appendChild(UI.activeRow(draft, state.codeLength, state.palette));
    }
    updateEnter();
  }

  function renderPalette() {
    enterKey = UI.renderPalette(el.palette, state.palette, {
      onPick: pick,
      onDelete: function () { if (!submitting) { draft.pop(); renderBoard(); } },
      onSubmit: submit,
    });
    updateEnter();
  }

  function updateEnter() {
    if (enterKey) enterKey.disabled = submitting || !socket.connected || state.gameOver || draft.length !== state.codeLength;
  }

  // ── Lightweight toast for transient messages (hints, errors) ─────────────
  function showError(msg) {
    if (!msg) return;
    var existing = document.getElementById('c500-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'c500-toast';
    t.setAttribute('role', 'alert');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;max-width:min(90vw,360px);padding:12px 18px;background:rgba(14,16,26,0.96);border:1px solid rgba(255,214,102,0.35);border-radius:12px;color:#fff;font-size:0.9rem;font-weight:800;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.45);pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2500);
    setTimeout(function () { t.remove(); }, 2800);
  }

  function pick(i) {
    if (state.gameOver || submitting) return;
    if (draft.length >= state.codeLength) return;
    draft.push(i);
    renderBoard();
  }

  function submit() {
    if (state.gameOver || submitting) return;
    if (!socket.connected) { showError('Connection lost. Reconnect before submitting.'); return; }
    if (draft.length !== state.codeLength) return;
    if (!user) return;
    // Send the emoji form so web and chat guesses go through one parser.
    var symbols = draft.map(function (i) { return state.palette[i].square; }).join('');
    submitting = true;
    submissionTimer = setTimeout(function () {
      submitting = false; submissionTimer = null;
      showError('No confirmation yet. Reconnect to check the board before retrying.'); renderBoard();
    }, 15000);
    socket.emit('play-guess', { guess: symbols, user: user });
    renderBoard();
  }

  // Keyboard: colour letters, Backspace, Enter.
  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (el.helpOverlay.classList.contains('is-open')) {
      if (ev.key === 'Escape') closeHelp();
      return;
    }
    if (ev.key === 'Enter') { submit(); return; }
    if (ev.key === 'Backspace') { if (!submitting) { draft.pop(); renderBoard(); } ev.preventDefault(); return; }
    var k = String(ev.key || '').toUpperCase();
    for (var i = 0; i < state.palette.length; i++) {
      if (state.palette[i].letter === k) { pick(i); return; }
    }
  });

  // ── Help overlay ───────────────────────────────────────────────────────

  // The chat-syntax samples (squares / hearts / letters / colour names) and the
  // letter legend were removed along with the "Guessing from TikTok chat"
  // section — everything they rendered was built from state.palette purely to
  // teach chat input, which no visitor to this page uses. The triangle is the
  // one piece of the modal that still has to be drawn from live state.
  function renderHelp() {
    el.helpTriangle.innerHTML = '';
    el.helpTriangle.appendChild(UI.buildTriangle(1, 2, 1));
  }

  function openHelp() { renderHelp(); el.helpOverlay.classList.add('is-open'); }
  function closeHelp() { el.helpOverlay.classList.remove('is-open'); }
  el.helpBtn.addEventListener('click', openHelp);
  el.helpClose.addEventListener('click', closeHelp);
  el.helpOverlay.addEventListener('click', function (ev) {
    if (ev.target === el.helpOverlay) closeHelp();
  });

  // ── Monthly hint button ────────────────────────────────────────────────
  function initHintButton() {
    if (!window.WTHints) return;
    var hintWrap = document.getElementById('hint-btn-wrap');
    if (!hintWrap) return;

    WTHints.init({
      container: hintWrap,
      game: 'colour500',
      onSuccess: function (data) {
        if (data && data.hint) showHint(data.hint);
      },
      onError: function (msg) {
        showError(msg || 'Hint failed');
      }
    });
  }

  function showHint(hint) {
    if (!hint) return;
    showError(hint.message || 'Hint revealed');
    // Briefly pulse the hinted colour on the docked palette.
    if (hint.colorLetter && el.palette) {
      var key = el.palette.querySelector('.kb-key[data-key="' + hint.colorLetter + '"]');
      if (key) {
        key.style.transform = 'scale(1.12)';
        key.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.8), 0 6px 18px rgba(0,0,0,0.4)';
        key.style.zIndex = '10';
        setTimeout(function () {
          key.style.transform = '';
          key.style.boxShadow = '';
          key.style.zIndex = '';
        }, 2500);
      }
    }
  }

  // ── Socket wiring ──────────────────────────────────────────────────────

  function applyState(s) {
    if (!s) return;
    state.palette = s.palette || [];
    state.codeLength = s.codeLength || 4;
    state.gameOver = !!s.gameOver;
    state.requireLetterPrefix = s.requireLetterPrefix !== false;
    state.guesses = s.guesses || [];
    if (roundStartedAt !== s.roundStartedAt || state.gameOver) draft = [];
    roundStartedAt = s.roundStartedAt;
    submitting = false; clearTimeout(submissionTimer); submissionTimer = null;

    renderPalette();
    renderBoard();

    // s.pot and s.lastWinner still arrive on every snapshot; they just have no
    // header chip to paint any more. The pot is still shown where it actually
    // matters — the WinCard below, and overlay.html's win strip on stream.

    if (s.gameOver && s.winner) {
      showWin(s.winner, s.code, state.guesses.length, s.pot);
    } else if (window.WinCard) {
      // A fresh round's state is what retires the win card — the same timing
      // the old "Next round starting…" overlay had (server waits
      // newGameDelayMs, then broadcasts the new round).
      window.WinCard.hide();
    }
  }

  // The shared Word Tycoon win card (win-card.js, loaded from the hub) is the
  // whole win UI now. Sticky (autoHideMs 0) — see the game-state branch above.
  // No topPlayers: this game is first-to-crack with no per-round scoring, so
  // the card renders winner-only. totalWins arrives on the public game's
  // 'game-over'; the game-state snapshot and streamer sessions don't carry it,
  // and the component lazy-fetches it from the winner's identity. The winner
  // object is passed through as-is — it already carries cosmetics and the
  // fan-club/superfan/donor flags.
  function showWin(winner, code, guessCount, pot, totalWins) {
    state.gameOver = true;
    var word = (code || []).map(function (i) {
      var c = state.palette[i];
      return c ? c.letter : '?';
    }).join('');
    var opts = {
      game: 'colour500',
      gameName: 'Color 500',
      word: word,
      guessCount: guessCount,
      jackpot: pot || 0,
      winner: winner,
      autoHideMs: 0,
    };
    if (typeof totalWins === 'number') opts.totalWins = totalWins;
    window.WinCard.showMp(opts);
    updateEnter();
  }

  socket.on('game-state', applyState);
  socket.on('guess-result', function (result) {
    submitting = false; clearTimeout(submissionTimer); submissionTimer = null;
    if (result && result.ok) draft = [];
    else showError(result && result.reason === 'storage-unavailable'
      ? 'Progress could not be saved. Your guess is still here; please retry.'
      : 'Guess not accepted: ' + (result && result.reason || 'please retry'));
    renderBoard();
  });
  socket.on('disconnect', function () {
    submitting = false; clearTimeout(submissionTimer); submissionTimer = null;
    showError('Connection lost. Reconnect before submitting.'); updateEnter();
  });
  socket.on('connect', function () { updateEnter(); });

  socket.on('guess', function (g) {
    if (!g) return;
    state.guesses.push(g);
    animateLast = true;
    renderBoard();
  });

  socket.on('game-over', function (d) {
    if (!d) return;
    showWin(d.winner || {}, d.code, d.guessCount, d.pot, d.totalWins);
  });

  // 'pot-update' is no longer subscribed here: the header POT chip was its only
  // consumer. The win card takes the final pot from 'game-over' instead. The
  // server still emits the event — nothing else on this page needed it.

  // ── Session lifecycle ──────────────────────────────────────────────────
  // The streamer moved to another game. Offer to follow them or fall back to
  // the public board — never navigate on our own.
  socket.on('session-redirect', function (d) {
    if (!d) return;
    var wrap = document.getElementById('session-redirect');
    if (!wrap) return;
    document.getElementById('sr-game').textContent = d.targetGameName || 'another game';
    var follow = document.getElementById('sr-follow');
    if (d.targetUrl) follow.href = d.targetUrl;
    else follow.style.display = 'none';
    wrap.classList.add('is-open');
  });

  socket.on('session-ended', function () {
    var wrap = document.getElementById('session-redirect');
    if (!wrap) return;
    document.getElementById('sr-title').textContent = 'This round has ended';
    document.getElementById('sr-body').textContent =
      'The streamer closed their session.';
    document.getElementById('sr-follow').style.display = 'none';
    wrap.classList.add('is-open');
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  resolveUser();
  renderBoard();
  initHintButton();
})();
