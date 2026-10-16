// Auth + cosmetics — thin wrapper over Chat Relay's /api/me/* endpoints.
// Stays standalone: no DOM references, just data. The caller decides how
// to render the session state.

const AUTH_BASE = 'https://wordtycoon.live';
const AUTH_TOKEN_PARAMS = ['auth_token', 'auth'];
const SSO_RETRY_MS = 60000;

/**
 * Returns { loggedIn, user } where `user` is { id, displayName, avatar, provider }
 * or null. Guests are { loggedIn: false, user: null }.
 */
export async function getSession() {
  const token = getAuthTokenFromUrl();
  if (token) {
    try {
      const exchanged = await exchangeAuthToken(token);
      cleanAuthParamsFromUrl();
      if (exchanged.loggedIn) {
        clearSsoMarker();
        reloadForFreshHandshake();
        return publishAuthState(exchanged);
      }
    } catch {
      cleanAuthParamsFromUrl();
    }
  }

  const localSession = await fetchSession('/api/me/session');
  if (localSession.loggedIn) {
    clearSsoMarker();
    return publishAuthState(localSession);
  }

  if (shouldTryHubSso()) {
    const hubSession = await fetchSession(`${AUTH_BASE}/api/me/session`);
    if (hubSession.loggedIn && !recentlyTriedSso()) {
      markSsoTried();
      redirectToSso();
      return publishAuthState({ loggedIn: false, user: null, redirecting: true });
    }
  }

  return publishAuthState({ loggedIn: false, user: null });
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
    const u = new URL(location.href);
    u.searchParams.delete('auth_token');
    u.searchParams.delete('auth');
    u.searchParams.delete('sso_checked');
    location.replace(u.pathname + u.search + u.hash);
  } catch (e) { location.reload(); }
}
async function fetchSession(url) {
  try {
    const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { loggedIn: false, user: null };
    const data = await r.json();
    if (!data || !data.ok || !data.user) return { loggedIn: false, user: null };
    return { loggedIn: true, user: data.user };
  } catch {
    return { loggedIn: false, user: null };
  }
}

async function exchangeAuthToken(token) {
  const r = await fetch(`/api/auth/exchange?token=${encodeURIComponent(token)}`, {
    credentials: 'include', signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return { loggedIn: false, user: null };
  const data = await r.json();
  if (!data || !data.ok || !data.user) return { loggedIn: false, user: null };
  return { loggedIn: true, user: data.user };
}

function getAuthTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  for (const name of AUTH_TOKEN_PARAMS) {
    const value = params.get(name);
    if (value) return value;
  }
  return null;
}

function cleanAuthParamsFromUrl() {
  const url = new URL(location.href);
  let changed = false;
  for (const name of AUTH_TOKEN_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) history.replaceState(history.state, document.title, url.pathname + url.search + url.hash);
}

function getCleanReturnTo() {
  const url = new URL(location.href);
  for (const name of AUTH_TOKEN_PARAMS) url.searchParams.delete(name);
  return url.toString();
}

function shouldTryHubSso() {
  try {
    return location.origin !== new URL(AUTH_BASE).origin && /^https?:$/.test(location.protocol);
  } catch {
    return false;
  }
}

function ssoMarkerKey() {
  return `word5000:sso:${location.origin}${location.pathname}`;
}

function recentlyTriedSso() {
  try {
    const ts = Number(sessionStorage.getItem(ssoMarkerKey()) || 0);
    return ts && (Date.now() - ts) < SSO_RETRY_MS;
  } catch {
    return false;
  }
}

function markSsoTried() {
  try {
    sessionStorage.setItem(ssoMarkerKey(), String(Date.now()));
  } catch {}
}

function clearSsoMarker() {
  try {
    sessionStorage.removeItem(ssoMarkerKey());
  } catch {}
}

function redirectToSso() {
  const url = `${AUTH_BASE}/api/auth/sso-check?returnTo=${encodeURIComponent(getCleanReturnTo())}`;
  location.href = url;
}

function publishAuthState(session) {
  try {
    window.dispatchEvent(new CustomEvent('word500-auth-updated', { detail: session }));
  } catch {}
  return session;
}

/**
 * Returns the user's equipped cosmetics object (or null for guests / errors).
 * Shape mirrors what game.js's applyCosmetics expects:
 *   { word_color?: {color, textShadow?, animation?}, name_color?, name_glow?,
 *     profile_border?, profile_glow?, title?, word_glow?, ... }
 */
export async function getEquippedCosmetics() {
  try {
    const r = await fetch('/api/me/equipped-cosmetics', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    return (data && data.ok && data.equipped) ? data.equipped : null;
  } catch {
    return null;
  }
}

/**
 * Returns the user's cosmetic visibility prefs (what they want to see from
 * other players). For solo + own guesses this is irrelevant; for MP this
 * filters incoming guesses' cosmetics.
 */
export async function getVisibility() {
  try {
    const r = await fetch('/api/me/visibility', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { word_color: true, word_glow: false };  // unauthed default
    const data = await r.json();
    return (data && data.visibility) || { word_color: true, word_glow: false };
  } catch {
    return { word_color: true, word_glow: false };
  }
}

/**
 * Open the unified login modal. Requires `<script src="${AUTH_BASE}/login-prompt.js">`
 * to be loaded in the page. Falls back to redirecting to Discord auth.
 */
export function showLoginModal({ returnTo } = {}) {
  const target = returnTo || getCleanReturnTo();
  if (window.LoginPrompt && window.LoginPrompt.showModal) {
    return window.LoginPrompt.showModal({
      authBase: AUTH_BASE,
      returnTo: target,
    });
  }
  // Fallback: SSO redirect
  const url = `${AUTH_BASE}/api/auth/sso-check?returnTo=${encodeURIComponent(target)}`;
  location.href = url;
}

export { AUTH_BASE };
