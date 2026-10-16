// ===== Socket Client =====
// Wraps Socket.IO connection.

import { io } from 'socket.io-client';

export class SocketClient {
  constructor() {
    const basePath = location.pathname.endsWith('/') ? location.pathname.slice(0, -1) : location.pathname.replace(/\/[^/]*$/, '');

    if (window.__SP_MODE) {
      // SP mode: connect to /sp namespace with userId auth + played words
      let user = null;
      try { user = JSON.parse(localStorage.getItem('searchle_user')); } catch {}
      let playedWords = [];
      try { playedWords = JSON.parse(localStorage.getItem('searchle_sp_played') || '[]'); } catch {}
      const spBasePath = basePath.replace(/\/sp\/?$/, '') || '';
      // Read launch mode from URL params (e.g. ?mode=weekly)
      const urlParams = new URLSearchParams(window.location.search);
      const launchMode = urlParams.get('mode') || undefined;
      const rawLanguage = urlParams.get('lang') || localStorage.getItem('searchle_sp_language') || 'en';
      const language = (rawLanguage === 'pt-br' || rawLanguage === 'pt_br' || rawLanguage === 'pt') ? 'pt-br' : 'en';
      const normalizeDifficulty = (raw) => {
        const value = String(raw || 'normal').toLowerCase().trim();
        const aliases = { 'very-easy': 'very-common', easy: 'common', hard: 'rare', 'very-hard': 'very-rare' };
        const normalized = aliases[value] || value;
        return ['very-common', 'common', 'normal', 'rare', 'very-rare'].includes(normalized) ? normalized : 'normal';
      };
      const difficulty = launchMode === 'weekly'
        ? 'normal'
        : normalizeDifficulty(urlParams.get('difficulty') || localStorage.getItem('searchle_sp_difficulty') || 'normal');
      this.socket = io(location.origin + '/sp', {
        path: spBasePath + '/socket.io',
        auth: { userId: user?.id || 'anon', playedWords, userJson: user ? JSON.stringify({ displayName: user.globalName || user.username, username: user.username }) : null, mode: launchMode, language, difficulty },
        reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 10000, reconnectionAttempts: Infinity, transports: ['polling', 'websocket']
      });
    } else {
      // Streamer-private session: ?session=<handle> means we landed via
      // /<handle> or /overlay/<handle> redirect. Pass auth.session so the
      // server joins this socket to the streamer's session room and lazy-
      // creates the round if needed. Without this, the socket would
      // connect to the public game and the page would render against
      // public state instead of the streamer's private round.
      const opts = {
        path: basePath + '/socket.io',
        reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 10000,
        reconnectionAttempts: Infinity, transports: ['polling', 'websocket'],
      };
      try {
        const h = new URLSearchParams(location.search).get('session');
        if (h && /^[a-z0-9_-]{1,32}$/i.test(h)) opts.auth = { session: h.toLowerCase() };
      } catch (_) { /* URLSearchParams unavailable — ignore */ }
      this.socket = io(opts);
    }

    // Streamer-session redirect: when the streamer switches active game,
    // the backend emits `session-redirect` into this socket's session
    // room. Show a follow/stay modal so viewers don't sit on a stale tab.
    // Skipped on OBS overlay (URL flag obs=1) so streams don't auto-nav.
    try {
      const _isObs = new URLSearchParams(location.search).get('obs') === '1';
      if (!_isObs) {
        this.socket.on('session-redirect', (data) => {
          try {
            if (!data || !data.targetUrl) return;
            if (document.getElementById('sessionRedirectModal')) return;
            const overlay = document.createElement('div');
            overlay.id = 'sessionRedirectModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;';
            const card = document.createElement('div');
            card.style.cssText = 'background:#1a1f2e;border:1px solid rgba(248,113,113,0.55);border-radius:14px;padding:22px 24px;max-width:380px;width:100%;color:#f1f5f9;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
            const gameName = (data.targetGameName || 'a different game').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
            card.innerHTML = '<div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#fca5a5;font-weight:700;margin-bottom:6px;">Streamer moved</div>' +
              '<div style="font-size:18px;font-weight:600;line-height:1.35;margin-bottom:16px;">The streamer is now playing <span style="color:#fde68a;">' + gameName + '</span>.</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                '<button id="srmFollow" style="flex:1;min-width:130px;padding:10px 14px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">Follow streamer</button>' +
                '<button id="srmStay" style="flex:0 0 auto;padding:10px 14px;background:transparent;color:#cbd5e1;border:1px solid rgba(203,213,225,0.35);border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Play public version</button>' +
              '</div>';
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            document.getElementById('srmFollow').addEventListener('click', () => { window.location.href = data.targetUrl; });
            document.getElementById('srmStay').addEventListener('click', () => { window.location.href = location.origin + '/'; });
          } catch (e) { console.warn('[session-redirect]', e); }
        });
      }
    } catch (_) {}
  }

  on(event, callback) {
    this.socket.on(event, callback);
  }

  off(event, callback) {
    this.socket.off(event, callback);
  }

  emit(event, data) {
    this.socket.emit(event, data);
  }
}
