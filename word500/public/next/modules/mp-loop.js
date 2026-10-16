// MP loop — thin wrapper around the word500 socket.io stream.
//
// The server is the source of truth: it scores every guess, broadcasts the
// public game state, runs the jackpot, and rotates the round. This module
// just listens and forwards events to the orchestrator (app.js).

let _socket = null;

// Reserved URL paths that look like a streamer handle but aren't one.
// Mirrors the legacy game.js list so handle parsing stays consistent.
const RESERVED_HANDLES = new Set([
  'admin', 'overlay', 'play', 'index.html', 'mp.html', 'sp.html', 'play.html',
  'solo', 'next', 'api', 'online', 'auth', 'portal', 'login',
]);
const HANDLE_RE = /^[a-z0-9_-]{1,32}$/;

/**
 * Parse the streamer-private session handle from the current URL.
 *   - prefer `?session=<handle>`
 *   - else accept `/<handle>` or `/overlay/<handle>` path forms
 *   - returns null if neither pattern hits or the handle is reserved
 */
export function parseSessionHandle() {
  try {
    const q = new URLSearchParams(location.search).get('session');
    if (q && HANDLE_RE.test(q)) return q.toLowerCase();
    const m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})\/?$/i);
    if (m && m[1]) {
      const h = m[1].toLowerCase();
      if (!RESERVED_HANDLES.has(h)) return h;
    }
  } catch {}
  return null;
}

/**
 * Connect to the word500 Socket.IO endpoint. The hub proxy serves the same
 * page under /game/word500/, so the socket path has to move with it.
 *
 *   handlers        — object of event callbacks (see below; any unset is ignored)
 *   sessionHandle?  — optional streamer-private session handle. When set, the
 *                     socket joins the session room and the server scopes all
 *                     events (`game-state`, `guess`, `session-redirect`) to it.
 *
 * Event callbacks:
 *   onGameState(state)        — full snapshot (boot + reconnect)
 *   onGuess(guessData)        — every individual guess (own + others)
 *   onNewGame(payload)        — round started
 *   onGameOver(payload)       — round ended without a winner (or after one)
 *   onGameWin(payload)        — someone solved it
 *   onFrenzy(payload)         — frenzy multiplier change
 *   onSessionRedirect(payload)— streamer switched games (private sessions)
 *   onConnect()  / onDisconnect()
 *
 * Returns { socket, emitGuess(word, user), sessionHandle, disconnect() }.
 */
export function connectMP(handlers = {}, sessionHandle = null) {
  if (typeof io === 'undefined') {
    console.error('[mp] socket.io client not loaded');
    return null;
  }
  const socketPath = location.pathname.indexOf('/game/word500/') === 0
    ? '/game/word500/socket.io'
    : '/socket.io';
  const opts = { transports: ['websocket', 'polling'], path: socketPath };
  if (sessionHandle) opts.auth = { session: sessionHandle };
  _socket = io(opts);

  _socket.on('connect',    () => { handlers.onConnect && handlers.onConnect(); });
  _socket.on('disconnect', () => { handlers.onDisconnect && handlers.onDisconnect(); });

  // Server events we react to
  const map = {
    'game-state':       'onGameState',
    'guess-result':     'onGuessResult',
    'guess':            'onGuess',
    'new-game':         'onNewGame',
    'game-over':        'onGameOver',
    'game-win':         'onGameWin',
    'frenzy-update':    'onFrenzy',
    'session-redirect': 'onSessionRedirect',
  };
  for (const [evt, fn] of Object.entries(map)) {
    _socket.on(evt, (payload) => {
      if (typeof handlers[fn] === 'function') handlers[fn](payload);
    });
  }

  // Premium gate: public multiplayer guessing requires Donor Class. The
  // server rejects the guess and emits premium-required; show a dismissible
  // wall (spectating stays open). An orchestrator can override via
  // handlers.onPremiumRequired.
  _socket.on('premium-required', (info) => {
    if (typeof handlers.onPremiumRequired === 'function') return handlers.onPremiumRequired(info);
    showPremiumWall(!!(info && info.loggedIn));
  });

  return {
    socket: _socket,
    sessionHandle,
    emitGuess(word, user) {
      if (!_socket?.connected || !word || !user) return false;
      _socket.emit('play-guess', {
        word: String(word).toLowerCase(),
        user: {
          id:          user.id,
          username:    user.username,
          displayName: user.displayName || user.globalName || user.username,
        },
      });
      return true;
    },
    disconnect() {
      if (_socket) { _socket.disconnect(); _socket = null; }
    },
  };
}

function showPremiumWall(loggedIn) {
  const existing = document.getElementById('premium-wall');
  if (existing) { existing.style.display = 'flex'; return; }
  const onHub = location.pathname.indexOf('/game/word500/') === 0;
  const soloHref = onHub ? '/game/word500/?mode=solo' : '/?mode=solo';
  const el = document.createElement('div');
  el.id = 'premium-wall';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(4,10,6,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
  const signinBtn = loggedIn ? '' :
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(140,190,140,0.35);color:#eaf4ea;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,26,16,0.98),rgba(20,40,24,0.98));border:1px solid rgba(140,190,140,0.2);border-radius:18px;position:relative;color:#eaf4ea;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#bcd8bc;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(79,195,79,0.8);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(188,216,188,0.78);">The daily puzzle is free for everyone, forever. Online multiplayer needs <strong style="color:#eaf4ea;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="' + soloHref + '" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(79,195,79,0.1);border:1.5px solid rgba(79,195,79,0.4);color:#8ce58c;font-weight:900;text-decoration:none;">Play the free daily</a>' +
        '<a href="https://wordtycoon.live/me?tab=pass" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(196,102,255,0.1);border:1.5px solid rgba(196,102,255,0.4);color:#c98aff;font-weight:900;text-decoration:none;">Become a Donor &mdash; $2/mo</a>' +
        signinBtn +
      '</div>' +
      '<p style="margin:18px 0 0;font-size:0.72rem;color:rgba(188,216,188,0.55);">You can keep watching the game behind this message.</p>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById('premium-wall-close').onclick = () => { el.style.display = 'none'; };
  const sb = document.getElementById('premium-wall-signin');
  if (sb) sb.onclick = () => {
    window.location.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent(location.href);
  };
}
