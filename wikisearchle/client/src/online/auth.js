window.WikiSearchleAuth = (function () {
  var NICK_KEY = 'wikisearchle_nickname';
  var USER_KEY = 'wt_user';
  var GUEST_KEY = 'wikisearchle_guest_profile';
  var AUTH_ORIGIN = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? 'http://' + location.hostname + ':3000'
    : 'https://wordtycoon.live';
  // Where the auth/account APIs are FETCHED. Must be this origin, not the hub:
  // wt_remember is host-scoped everywhere except *.wordtycoon.live, and the premium
  // gate in game-shared.js proves identity from the cookie riding the Socket.IO
  // handshake. Exchanging against the hub plants the cookie on the hub, so the
  // handshake carries no proof and the gate refuses a player whose page looks
  // signed in. nginx proxies /auth/, /api/auth/ and /api/me/ here — see
  // snippets/wt-relay-auth.conf. AUTH_ORIGIN stays absolute for the login LINKS,
  // which are top-level navigations to the hub's OAuth and unaffected by cookie scope.
  var AUTH_API = '';
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

  var state = {
    user: null,
    guestProfile: null,
    uiReady: false,
    promptVisible: false,
    els: null,
  };

  function readCachedUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }

  function getDisplayName(user) {
    if (!user || typeof user !== 'object') return '';
    return String(
      user.displayName ||
      user.global_name ||
      user.globalName ||
      user.username ||
      user.name ||
      ''
    ).trim();
  }

  function getProfilePicUrl(user) {
    if (!user || typeof user !== 'object') return null;
    if (user.profilePic) return user.profilePic;
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (typeof user.avatar === 'string' && user.avatar.startsWith('http')) return user.avatar;
    if (typeof user.avatar === 'string' && user.id && /^[a-f0-9_]+$/i.test(user.avatar)) {
      return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    }
    return null;
  }

  function sanitizeGuestId(value) {
    var clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (clean.length > 48) clean = clean.slice(0, 48);
    return clean;
  }

  function createGuestId() {
    return 'wsguest_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  }

  function saveGuestProfile(profile) {
    var id = sanitizeGuestId(profile && profile.id);
    if (!id) id = createGuestId();
    state.guestProfile = { id: id };
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(state.guestProfile)); } catch (e) {}
    return state.guestProfile;
  }

  function loadGuestProfile() {
    try {
      var stored = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
      var guestId = sanitizeGuestId(stored && stored.id);
      if (guestId) {
        state.guestProfile = { id: guestId };
        return state.guestProfile;
      }
    } catch (e) {}
    return saveGuestProfile({ id: createGuestId() });
  }

  function applyUser(user) {
    if (!user) return null;
    state.user = user;
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) {}
    var nick = getDisplayName(user);
    if (nick) {
      try { localStorage.setItem(NICK_KEY, nick); } catch (e) {}
    }
    window._wtUser = user;
    window._wtUserPicUrl = getProfilePicUrl(user);
    return user;
  }

  function clearCachedUser() {
    state.user = null;
    window._wtUser = null;
    window._wtUserPicUrl = null;
    try { localStorage.removeItem(USER_KEY); } catch (e) {}
  }

  function isAuthenticated() {
    return !!state.user;
  }

  function ensureLinks() {
    if (!state.els) return;
    state.els.discord.href = AUTH_ORIGIN + '/auth/discord?returnTo=' + encodeURIComponent(location.href);
    state.els.github.href = AUTH_ORIGIN + '/auth/github?returnTo=' + encodeURIComponent(location.href);
  }

  function updatePromptCopy() {
    if (!state.els) return;
    // The prompt was simplified — wsLoginLead and wsLoginNote elements
    // were removed in favor of just the logo + "Play as Anon" row. Guard
    // both updates so the JS keeps working with the leaner markup.
    if (state.els.lead) {
      state.els.lead.textContent = isAuthenticated()
        ? 'Word Tycoon login detected. Your profile, stats, and rewards stay linked here.'
        : 'Login with Discord or GitHub to keep your identity, stats, and rewards synced across Word Tycoon.';
    }
    if (state.els.note) {
      state.els.note.textContent = isAuthenticated()
        ? 'Signed in as ' + getDisplayName(state.user)
        : 'Play instantly as a unique Anon name, or sign in for stats and rewards.';
    }
  }

  function hidePrompt() {
    if (!state.els || !state.els.screen) return;
    state.els.screen.classList.add('hidden');
    state.promptVisible = false;
  }

  function showPrompt() {
    if (!state.els || !state.els.screen || isAuthenticated()) return;
    ensureLinks();
    updatePromptCopy();
    state.els.screen.classList.remove('hidden');
    state.promptVisible = true;
  }

  function continueAsGuest() {
    loadGuestProfile();
    hidePrompt();
  }

  function initUi() {
    if (state.uiReady) {
      updatePromptCopy();
      ensureLinks();
      return api;
    }
    state.els = {
      screen: document.getElementById('wsLoginScreen'),
      close: document.getElementById('wsLoginDismiss'),
      guest: document.getElementById('wsGuestContinueBtn'),
      discord: document.getElementById('wsDiscordLoginLink'),
      github: document.getElementById('wsGithubLoginLink'),
      lead: document.getElementById('wsLoginLead'),
      note: document.getElementById('wsLoginNote'),
    };
    state.uiReady = !!state.els.screen;
    if (!state.uiReady) return api;
    ensureLinks();
    updatePromptCopy();
    if (state.els.close) state.els.close.addEventListener('click', continueAsGuest);
    if (state.els.guest) state.els.guest.addEventListener('click', continueAsGuest);
    if (isAuthenticated()) hidePrompt();
    else showPrompt();
    return api;
  }

  function buildGuessPayload(fallbackNickname) {
    if (isAuthenticated()) {
      var u = state.user || {};
      var platformUserId = String(
        u.platformUserId || u.id || u.discordId || u.discord_id || u.githubId || u.github_id || ''
      ).trim();
      var platform = String(u.platform || 'web').trim().toLowerCase() || 'web';
      return {
        guestId: null,
        nickname: getDisplayName(u) || String(fallbackNickname || 'player').trim() || 'player',
        username: String(u.username || u.name || '').trim() || null,
        profilePic: getProfilePicUrl(u) || null,
        platform: platform,
        platformUserId: platformUserId || null,
      };
    }
    var guest = state.guestProfile || loadGuestProfile();
    return {
      guestId: guest.id,
      nickname: '',
      username: null,
      profilePic: null,
      platform: 'web',
      platformUserId: null,
    };
  }

  function cleanAuthTokenFromUrl() {
    try {
      var params = new URLSearchParams(location.search);
      params.delete('auth_token');
      var q = params.toString();
      history.replaceState({}, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) {}
  }

  function restoreFromSession() {
    return fetch(AUTH_API + '/api/me/session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.ok && data.user) applyUser(data.user);
      })
      .catch(function () {});
  }

  function bootstrap() {
    loadGuestProfile();
    var params = new URLSearchParams(location.search);
    var token = params.get('auth_token');
    var cached = readCachedUser();

    if (token) {
      return fetch(AUTH_API + '/api/auth/exchange?token=' + encodeURIComponent(token), {
        credentials: 'include',
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.user) { applyUser(data.user); reloadForFreshHandshake(); }
        })
        .catch(function () {})
        .finally(cleanAuthTokenFromUrl)
        .then(function () {
          if (!isAuthenticated()) return restoreFromSession();
        })
        .then(function () {
          if (state.uiReady) {
            if (isAuthenticated()) hidePrompt();
            else showPrompt();
          }
          return api;
        });
    }

    if (cached) {
      applyUser(cached);
      restoreFromSession().then(function () {
        if (state.uiReady) {
          if (isAuthenticated()) hidePrompt();
          else showPrompt();
        }
      });
      return Promise.resolve(api);
    }

    return restoreFromSession().then(function () {
      if (state.uiReady) {
        if (isAuthenticated()) hidePrompt();
        else showPrompt();
      }
      return api;
    });
  }

  var api = {
    initUi: initUi,
    showPrompt: showPrompt,
    hidePrompt: hidePrompt,
    continueAsGuest: continueAsGuest,
    isAuthenticated: isAuthenticated,
    getGuestId: function () {
      var guest = state.guestProfile || loadGuestProfile();
      return guest.id;
    },
    buildGuessPayload: buildGuessPayload,
    getUser: function () { return state.user; },
  };

  api.ready = bootstrap();
  return api;
})();
window.__wikisearchleAuthReady = window.WikiSearchleAuth.ready;
