/**
 * Triangled — Main App
 */

const API_BASE = '';
const HUB_ORIGIN = /(^|\.)triangled\.(?:io|live)$/i.test(window.location.hostname)
  ? 'https://wordtycoon.live'
  : '';

let dailyIdentityToken = null;
let dailyIdentityExpires = 0;
let dailyIdentityLookupAfter = 0;
let dailyIdentityLookup = null;
let dailyIdentityAccount = null;
async function dailyHeaders(force = false) {
  if (force) { dailyIdentityToken = null; dailyIdentityExpires = 0; dailyIdentityLookupAfter = 0; }
  if (dailyIdentityLookup) {
    await dailyIdentityLookup;
    return { headers: { 'Content-Type': 'application/json', ...(dailyIdentityToken ? { 'x-game-session': dailyIdentityToken } : {}) }, accountId: dailyIdentityAccount };
  }
  if (Date.now() > dailyIdentityLookupAfter && (!dailyIdentityToken || Date.now() > dailyIdentityExpires - 30000)) {
    dailyIdentityLookupAfter = Date.now() + 30000;
    dailyIdentityLookup = (async () => {
      let r;
      try { r = await fetch(HUB_ORIGIN + '/api/game-session/triangled', { credentials: 'include',
        cache: 'no-store', signal: AbortSignal.timeout(5000) }); } catch {}
      if (r && r.ok) {
        const d = await r.json().catch(() => null);
        if (d && typeof d.token === 'string' && d.token.length <= 4096 && Number.isFinite(d.expires) && d.expires > Date.now()) {
          dailyIdentityToken = d.token; dailyIdentityExpires = d.expires;
          dailyIdentityAccount = typeof d.accountId === 'string' && d.accountId.length <= 128 ? d.accountId : null;
          return;
        }
      }
      dailyIdentityToken = null; dailyIdentityExpires = 0; dailyIdentityAccount = null;
    })();
    try { await dailyIdentityLookup; }
    finally { dailyIdentityLookup = null; }
  }
  return { headers: { 'Content-Type': 'application/json', ...(dailyIdentityToken ? { 'x-game-session': dailyIdentityToken } : {}) }, accountId: dailyIdentityAccount };
}
async function dailyFetch(input, options = {}) {
  const authorization = await dailyHeaders();
  const headers = authorization.headers, account = authorization.accountId;
  let response = await fetch(input, { ...options, headers });
  if (response.status === 401 && headers['x-game-session']) {
    const error = await response.clone().json().catch(() => null);
    if (error?.error === 'auth_required') {
      // Rotated or expired proof is rejected before gameplay writes, so one
      // retry with a freshly minted proof cannot repeat an accepted action.
      const refreshed = await dailyHeaders(true), fresh = refreshed.headers;
      if (account && refreshed.accountId && account !== refreshed.accountId) {
        if (typeof showToast === 'function') showToast('Your signed-in account changed. Reload to continue.', 'error');
        return response;
      }
      if (fresh['x-game-session'] && fresh['x-game-session'] !== headers['x-game-session']) {
        response = await fetch(input, { ...options, headers: fresh });
      }
    }
  }
  return response;
}

// ── State ─────────────────────────────────────────────────────────────

let puzzle = null;       // today's puzzle from server
let renderer = null;
let foundWords = [];
let hintProgress = 0;
let hintsUsed = 0;
let hintsAvailable = 0;
let completed = false;

// Player identity (simple — can be upgraded to OAuth later)
let player = {
  platform: 'web',
  userId: null,
  username: 'Guest'
};

const WT_USER_KEY = 'wt_user';
const LEGACY_USER_KEY = 'searchle_user';

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

function applyAuthenticatedUser(user) {
  if (!user || !user.id) return false;
  player.platform = user.provider || user.platform || 'discord';
  player.userId = user.id;
  player.username = getDisplayName(user) || 'Player';
  try {
    localStorage.setItem(WT_USER_KEY, JSON.stringify(user));
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {}
  window._wtUser = user;
  return true;
}

function loadCachedUser() {
  try {
    const raw = localStorage.getItem(WT_USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
    if (!raw) return false;
    return applyAuthenticatedUser(JSON.parse(raw));
  } catch {
    return false;
  }
}

async function restoreFromSession() {
  if (!HUB_ORIGIN) return false;
  try {
    const res = await fetch(HUB_ORIGIN + '/api/me/session', { credentials: 'include' });
    const data = res.ok ? await res.json() : null;
    if (data && data.ok && data.user) {
      return applyAuthenticatedUser(data.user);
    }
  } catch {}
  return false;
}

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load or generate a session ID
  player.userId = localStorage.getItem('triangled_user_id');
  if (!player.userId) {
    player.userId = 'guest_triangled_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('triangled_user_id', player.userId);
  }
  player.username = localStorage.getItem('triangled_username') || 'Guest';

  // Reuse the shared Word Tycoon identity cache and refresh it from session
  // cookies so direct visits / bookmarks don't lose the logged-in player.
  loadCachedUser();
  await restoreFromSession();

  // Init renderer
  const canvas = document.getElementById('grid-canvas');
  renderer = new GridRenderer(canvas);

  // Re-render once fonts are loaded so canvas picks up the web font
  document.fonts.ready.then(() => renderer.render());

  renderer.onTraceComplete = handleTraceComplete;
  renderer.onTraceUpdate = (letters) => {
    document.getElementById('current-trace').textContent = letters;
  };

  // Buttons
  document.getElementById('hint-btn').addEventListener('click', handleHint);
  document.getElementById('clear-btn').addEventListener('click', () => renderer.clearTrace());

  // Type bar
  const typeInput = document.getElementById('type-input');
  const typeSubmit = document.getElementById('type-submit');
  typeSubmit.addEventListener('click', () => handleTypedWord(typeInput));
  typeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleTypedWord(typeInput); }
  });

  // Load puzzle
  await loadPuzzle();

  // Monthly hint button (Donor / Super Fan perk)
  initHintButton();
});

// ── API Calls ─────────────────────────────────────────────────────────

async function loadPuzzle() {
  try {
    const res = await fetch(`${API_BASE}/api/daily`);
    const data = await res.json();

    if (!data.available) {
      document.getElementById('game-area').classList.add('hidden');
      document.getElementById('controls').classList.add('hidden');
      document.getElementById('no-puzzle').classList.remove('hidden');
      document.getElementById('theme-hint').textContent = 'No puzzle today';
      return;
    }

    puzzle = data;
    document.getElementById('theme-hint').textContent = data.themeHint;
    updateWordCount(0, data.wordCount);
    initPlaceholders(data.wordCount, data.spangramLength);

    renderer.setGrid(data.gridString);

    // Load background image (use relative path so proxy rewriter works)
    if (data.imageUrl) {
      const imgUrl = data.imageUrl.startsWith('/') ? data.imageUrl.slice(1) : data.imageUrl;
      renderer.loadBackgroundImage(imgUrl);
    }

    // Load saved progress
    await loadProgress();

  } catch (err) {
    console.error('Failed to load puzzle:', err);
    document.getElementById('theme-hint').textContent = 'Error loading puzzle';
  }
}

async function loadProgress() {
  try {
    const res = await dailyFetch(
      `${API_BASE}/api/daily/progress?platform=${player.platform}&userId=${player.userId}`,
      {}
    );
    const data = await res.json();

    if (data.started && data.foundWords && data.foundWords.length > 0) {
      foundWords = data.foundWords;
      hintProgress = data.hintProgress || 0;
      hintsUsed = data.hintsUsed || 0;
      completed = data.completed;

      // Re-render found words on the grid using server-provided paths
      const container = document.getElementById('found-words');
      container.innerHTML = '';
      for (const word of foundWords) {
        const type = data.foundWordTypes?.[word] || 'theme';
        const path = data.foundWordPaths?.[word];
        addFoundWordChip(word, type);
        if (path) {
          renderer.markWordFound(word, path, type);
        }
      }
      updateWordCount(foundWords.length, puzzle?.wordCount || '?');
      updateHintButton(hintProgress, hintProgress >= 3);

      if (completed) {
        showCompletion(hintsUsed, null);
      }
    }
  } catch (err) {
    console.error('Failed to load progress:', err);
  }
}

// ── Game Logic ────────────────────────────────────────────────────────

async function handleTraceComplete(path) {
  if (completed || !puzzle) return;

  // Read the word from the path
  const word = path.map(([r, c]) => {
    const idx = (r * (r + 1)) / 2 + c;
    return puzzle.gridString[idx];
  }).join('').toLowerCase();

  // Check if already found
  if (foundWords.includes(word)) {
    showToast('Already found!', 'error');
    return;
  }

  // Submit to server
  try {
    const res = await dailyFetch(`${API_BASE}/api/daily/submit`, {
      method: 'POST',
      body: JSON.stringify({
        platform: player.platform,
        userId: player.userId,
        username: player.username,
        path
      })
    });
    const result = await res.json();

    if (result.valid) {
      if (result.type === 'spangram' || result.type === 'theme') {
        if (!result.alreadyFound) {
          foundWords.push(result.word);
          // Use the canonical answer path (not player's trace) to reveal correct cells
          const revealPath = result.answerPath || path;
          renderer.markWordFound(result.word, revealPath, result.type);
          addFoundWordChip(result.word, result.type);
          updateWordCount(foundWords.length, puzzle.wordCount);

          if (result.completed) {
            completed = true;
            reportDailyCompletion();
            showCompletion(hintsUsed, result.coinsAwarded);
          }
        }
      } else if (result.type === 'bonus') {
        hintProgress = result.hintProgress;
        updateHintButton(hintProgress, result.hintEarned);

        if (result.hintEarned) {
          hintsAvailable++;
          showToast('Hint earned!', 'hint');
          updateHintButton(0, true);
        } else {
          showToast(`Bonus word! (${hintProgress}/3 to hint)`, 'bonus');
        }
      }
    } else {
      if (result.reason === 'not_connected') {
        showToast('Letters must be connected', 'error');
      } else if (result.reason === 'too_short') {
        showToast('Word too short', 'error');
      } else if (result.reason === 'already_completed') {
        // silently ignore
      } else {
        showToast('Not a valid word', 'error');
      }
    }
  } catch (err) {
    console.error('Submit error:', err);
    showToast('Connection error', 'error');
  }
}

async function handleHint() {
  if (completed || hintsAvailable <= 0) return;

  try {
    const res = await dailyFetch(`${API_BASE}/api/daily/hint`, {
      method: 'POST',
      body: JSON.stringify({
        platform: player.platform,
        userId: player.userId
      })
    });
    const result = await res.json();

    if (result.cells) {
      renderer.revealHintCells(result.cells);
      hintsUsed = result.hintsUsed;
      hintsAvailable--;
      updateHintButton(hintProgress, hintsAvailable > 0);
      showToast(`Hint: look for a ${result.cells.length}-letter word`, 'hint');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (err) {
    console.error('Hint error:', err);
  }
}

// ── Typed Word Submission ─────────────────────────────────────────────

async function handleTypedWord(input) {
  const word = input.value.trim().toLowerCase();
  if (!word || completed || !puzzle) return;

  input.value = '';

  if (word.length < 3) {
    showToast('Word too short', 'error');
    return;
  }

  if (foundWords.includes(word)) {
    showToast('Already found!', 'error');
    return;
  }

  try {
    const res = await dailyFetch(`${API_BASE}/api/daily/submit-word`, {
      method: 'POST',
      body: JSON.stringify({
        platform: player.platform,
        userId: player.userId,
        username: player.username,
        word
      })
    });
    const result = await res.json();

    if (result.valid) {
      if (result.type === 'spangram' || result.type === 'theme') {
        if (!result.alreadyFound) {
          foundWords.push(result.word);
          const revealPath = result.answerPath;
          renderer.markWordFound(result.word, revealPath, result.type);
          addFoundWordChip(result.word, result.type);
          updateWordCount(foundWords.length, puzzle.wordCount);

          if (result.completed) {
            completed = true;
            reportDailyCompletion();
            showCompletion(hintsUsed, result.coinsAwarded);
          }
        }
      }
    } else {
      if (result.reason === 'not_a_theme_word') {
        showToast('Not a theme word', 'error');
      } else {
        showToast('Word not found', 'error');
      }
    }
  } catch (err) {
    console.error('Type submit error:', err);
    showToast('Connection error', 'error');
  }
}

// ── Daily Completion Reporting ─────────────────────────────────────────

function reportDailyCompletion() {
  if (!puzzle || !puzzle.date) return;

  // Set localStorage so the portal knows this daily is done
  localStorage.setItem('triangled_sp_daily_date', puzzle.date);

  // Report to Chat Relay's sp-daily endpoint
  fetch(HUB_ORIGIN + '/api/sp-daily/complete/triangled-sp', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: puzzle.date })
  }).catch(err => console.warn('Daily completion report failed:', err.message));
}

// ── Portal Auth Listener ──────────────────────────────────────────────

window.addEventListener('message', (e) => {
  if (![location.origin, 'https://wordtycoon.live', 'https://www.wordtycoon.live'].includes(e.origin)) return;
  dailyIdentityToken = null; dailyIdentityExpires = 0; dailyIdentityLookupAfter = 0;
  if (e.data && e.data.type === 'triangled-auth') {
    const user = e.data.user;
    if (applyAuthenticatedUser(user)) {
      loadProgress();
    }
  }
});

// ── Monthly Hint Button ───────────────────────────────────────────────

function initHintButton() {
  if (!window.WTHints) return;
  const hintWrap = document.getElementById('hint-btn-wrap');
  if (!hintWrap) return;

  WTHints.init({
    container: hintWrap,
    game: 'triangled',
    onSuccess: (data) => {
      if (data && data.hint) showHint(data.hint);
    },
    onError: (msg) => {
      showToast(msg || 'Hint failed', 'error');
    }
  });
}

function showHint(hint) {
  if (!hint || !hint.cells || !hint.cells.length) return;
  renderer.revealHintCells(hint.cells);
  const wordType = hint.isSpangram ? 'spangram' : 'word';
  showToast(
    `Hint: the ${hint.wordLength}-letter ${wordType} starts with ${hint.letter}`,
    'hint',
    3000
  );
}
