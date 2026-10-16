// Word5000 — unified shell.
// Demo mode for now: hardcoded target word, local scoring. Once the look is
// approved, mp-loop.js and solo-loop.js swap in real socket / API calls.

import { renderRow } from './modules/render-row.js?v=9';
import { renderKeyboard, applyKeyStates, bindPhysicalKeys } from './modules/keyboard.js?v=3';
import { loadDictionary, isValidGuess, fetchDaily, loadTargets, pickRandomTarget } from './modules/word-bank.js?v=20261003-deadline';
import { toast } from './modules/toast.js?v=1';
import { getSession, getEquippedCosmetics, getVisibility, showLoginModal, AUTH_BASE } from './modules/auth.js?v=20261003-deadline';
import { bindSoloOwner, soloStorage as localStorage, soloContextHeaders } from './modules/solo-owner.js?v=20261003-owner2';
import { isDailyCompleted, markDailyComplete } from './modules/sp-daily.js?v=20261003-owner2';
import { recordGame, statsSummary } from './modules/stats.js?v=20261003-owner2';
import { connectMP, parseSessionHandle } from './modules/mp-loop.js?v=durable-mp-20261003-1';

const SLOTS = 8;
let WORD_LEN = 5;                  // mp may change this from game-state.wordLength
const FALLBACK_TARGET = 'CRANE';   // shown only if /api/sp/daily fetch fails

// Solo word length. The daily puzzle only exists at DAILY_LENGTH — every other
// length is a practice round, and coming back to 5 restores the daily if it
// hasn't been played yet. Remembered across visits.
const SOLO_LENGTHS = [4, 5, 6, 7, 8];
const DAILY_LENGTH = 5;
const SOLO_LEN_KEY = 'w5k_solo_word_len';

function readStoredSoloLength() {
  try {
    const n = parseInt(localStorage.getItem(SOLO_LEN_KEY), 10);
    return SOLO_LENGTHS.includes(n) ? n : DAILY_LENGTH;
  } catch (_) { return DAILY_LENGTH; }
}

// The daily fetched on boot, kept so switching back to DAILY_LENGTH can restore
// it instead of stranding the player in practice until they reload. Declared up
// here (not next to bootSolo) so the boot IIFE can never hit a TDZ on them.
let _dailyCache = null;      // { word, date } or null
let _dailyConsumed = false;  // true once the daily round has been played out

const guessesEl = document.getElementById('guesses');
const keyboardEl = document.getElementById('keyboard');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayWord = document.getElementById('overlay-word');
const overlayDetail = document.getElementById('overlay-detail');
const overlayAction = document.getElementById('overlay-action');
const titleSub = document.getElementById('title-sub');
const dailyBadge = document.getElementById('daily');
const jackpotPill = document.getElementById('jackpot');
const jackpotAmount = jackpotPill ? jackpotPill.querySelector('.jp-amount') : null;
const frenzyPill = document.getElementById('frenzy');
const frenzyMult = document.getElementById('frenzy-mult');
const onlineLink = document.getElementById('online-link');
const soloLink = document.getElementById('solo-link');
const lenBtn = document.getElementById('len-btn');

// --- State -----------------------------------------------------------------
const state = {
  mode: detectMode(),
  isDaily: true,                  // true if current game is today's daily; false in practice mode
  target: FALLBACK_TARGET,        // replaced by fetchDaily on boot
  dailyDate: null,                // ISO date if target came from /api/sp/daily
  guesses: [],                    // committed: { word, correct, present, absent, allAbsent }
  typed: '',                      // current active slot
  pendingGuess: false, pendingTimer: null, mpRoundStartedAt: null,
  gameOver: false,
  ready: false,                   // dictionary loaded + target fetched
  dailyAlreadyCompleted: false,   // server says you've finished today
  usedLetters: new Set(),         // letters typed in any committed guess
  user: null,                     // session user (null = guest)
  cosmetics: null,                // equipped cosmetics (null = no win-flash cosmetic colour)
  visibility: { word_color: true, word_glow: false },
  mp: null,                       // { socket, emitGuess, disconnect } when MP
  sessionHandle: null,            // streamer-private session handle if URL has one
  animatedRows: new Set(),        // flatIdx of guesses that have already played the entrance animation
};
titleSub.textContent = state.mode.toUpperCase();
document.body.dataset.mode = state.mode;
// Show the cross-mode link that DOESN'T match the current page.
if (state.mode === 'solo') onlineLink.style.display = '';
else if (state.mode === 'mp') soloLink.style.display = '';

// Wire the Solo/Online links so they switch modes in BOTH serving contexts:
//   • Domain root (word5000.com): mode comes from the PATH (/online → mp, / → solo),
//     so the clean path links baked into the HTML ("./", "online") already work.
//   • Portal proxy (wordtycoon.live/game/word500/?mode=…): the base path is
//     /game/word500/, so a path link like "online" points at /game/word500/online —
//     which detectMode() doesn't recognise, and it drops ?mode → stays solo.
// detectMode() always honours ?mode= first, so whenever we're served under a
// sub-path (or already carry ?mode) build the links from ?mode instead.
(function wireModeLinks() {
  const hasModeParam = new URLSearchParams(location.search).has('mode');
  const underSubpath = location.pathname.replace(/^\/+|\/+$/g, '').includes('/');
  if (hasModeParam || underSubpath) {
    const withMode = (m) => {
      const u = new URL(location.href);
      u.searchParams.set('mode', m);
      return u.pathname + u.search;
    };
    soloLink.setAttribute('href', withMode('solo'));
    onlineLink.setAttribute('href', withMode('mp'));
  }
})();

// --- Scoring (local demo only — real game state comes from server) ---------
function scoreGuess(guess, target) {
  const g = guess.toUpperCase().split('');
  const t = target.toUpperCase().split('');
  const states = new Array(g.length).fill('absent');
  const used = new Array(t.length).fill(false);

  // pass 1: correct
  for (let i = 0; i < g.length; i++) {
    if (g[i] === t[i]) { states[i] = 'correct'; used[i] = true; }
  }
  // pass 2: present
  for (let i = 0; i < g.length; i++) {
    if (states[i] === 'correct') continue;
    for (let j = 0; j < t.length; j++) {
      if (!used[j] && g[i] === t[j]) { states[i] = 'present'; used[j] = true; break; }
    }
  }

  let correct = 0, present = 0, absent = 0;
  for (const s of states) {
    if (s === 'correct') correct++;
    else if (s === 'present') present++;
    else absent++;
  }
  return { displayStates: states, correct, present, absent, allAbsent: correct === 0 && present === 0 };
}

function markLettersUsed(guess) {
  for (const ch of guess.toUpperCase()) state.usedLetters.add(ch);
}

// --- Render ----------------------------------------------------------------
function render() {
  if (state.mode === 'mp' || state.mode === 'overlay') renderMP();
  else renderSolo();
  if (state.mode !== 'overlay') applyKeyStates(keyboardEl, state.usedLetters);
  // Row composition changed (MP avatars arrive with socket data, well after
  // boot) — re-fit the board or --tile-h goes stale and rows clip.
  sizeBoard();
}

// Solo: 8 slots, top-down fill. Guesses spawn at the top (slot 0) and the
// active typing slot is at the next free index. After 8 commits, all slots
// are filled and there is no active slot.
function renderSolo() {
  guessesEl.innerHTML = '';
  const committedCount = state.guesses.length;
  const showActive = !state.gameOver && committedCount < SLOTS;
  const activeIndex = showActive ? committedCount : -1;

  for (let i = 0; i < SLOTS; i++) {
    let row;
    if (i === activeIndex) {
      row = renderRow({ state: 'active', wordLen: WORD_LEN, typed: state.typed });
    } else if (i < committedCount) {
      const g = state.guesses[i];
      const animate = !state.animatedRows.has(i);
      row = renderRow({ state: 'committed', ...g, wordLen: WORD_LEN, cosmetics: state.cosmetics, guessIdx: i, animate });
      state.animatedRows.add(i);
    } else {
      row = renderRow({ state: 'empty', wordLen: WORD_LEN });
    }
    guessesEl.appendChild(row);
  }
}

// MP: 8 slots, active typing always at the bottom slot. The 7 most-recent
// committed guesses (own + other players') fill slots 0–6 with the newest
// just above the active slot. As more guesses arrive, the oldest scrolls off
// the top.
//
// Overlay mode (`/overlay/<handle>`) is the same layout minus the active
// slot — all 8 slots are committed guesses, newest at the bottom.
function renderMP() {
  guessesEl.innerHTML = '';
  const committedCount = state.guesses.length;
  const isOverlay = state.mode === 'overlay';
  const showActive = !isOverlay && !state.gameOver;
  const activeIndex = showActive ? SLOTS - 1 : -1;
  const newestCommitSlot = showActive ? SLOTS - 2 : SLOTS - 1;

  for (let i = 0; i < SLOTS; i++) {
    let row;
    if (i === activeIndex) {
      row = renderRow({ state: 'active', wordLen: WORD_LEN, typed: state.typed });
    } else {
      const offsetFromNewest = newestCommitSlot - i;
      const flatIdx = committedCount - 1 - offsetFromNewest;
      if (offsetFromNewest >= 0 && flatIdx >= 0 && flatIdx < committedCount) {
        const g = state.guesses[flatIdx];
        const animate = !state.animatedRows.has(flatIdx);
        row = renderRow({ state: 'committed', ...g, wordLen: WORD_LEN, guessIdx: flatIdx, animate });
        state.animatedRows.add(flatIdx);
      } else {
        row = renderRow({ state: 'empty', wordLen: WORD_LEN });
      }
    }
    guessesEl.appendChild(row);
  }
}

// --- Input handlers --------------------------------------------------------
function handleKey(k) {
  if (state.gameOver || state.mode === 'mp' && state.pendingGuess) return;
  if (k === 'ENTER') return submitGuess();
  if (k === 'BACKSPACE') {
    if (state.typed.length > 0) {
      state.typed = state.typed.slice(0, -1);
      render();
    }
    return;
  }
  if (/^[A-Z]$/.test(k) && state.typed.length < WORD_LEN) {
    state.typed += k;
    render();
  }
}

function submitGuess() {
  if (state.typed.length !== WORD_LEN) return;
  if (!state.ready) { toast('Loading…'); return; }
  const guess = state.typed;

  if (!isValidGuess(guess, WORD_LEN)) {
    toast('Not in word list');
    const activeRow = guessesEl.querySelector('.row-active');
    if (activeRow) {
      activeRow.classList.add('row-shake');
      setTimeout(() => activeRow.classList.remove('row-shake'), 400);
    }
    return;
  }

  if (state.mode === 'mp') return submitGuessMP(guess);
  return submitGuessSolo(guess);
}

function submitGuessSolo(guess) {
  if (state.guesses.some(g => g.word === guess)) { toast('Already guessed'); return; }

  const score = scoreGuess(guess, state.target);
  state.guesses.push({ word: guess, ...score });
  markLettersUsed(guess);
  state.typed = '';

  if (score.correct === WORD_LEN) endGame(true);
  else if (state.guesses.length >= SLOTS) endGame(false);
  render();
}

function mpError(message) {
  let node = document.getElementById('mp-error');
  if (!node) { node = document.createElement('p'); node.id = 'mp-error'; node.setAttribute('role', 'alert');
    node.style.cssText = 'text-align:center;color:#ffd666;margin:8px 12px;font-size:0.85rem'; keyboardEl.before(node); }
  node.textContent = message; node.hidden = !message;
}
function releasePendingGuess() {
  clearTimeout(state.pendingTimer); state.pendingTimer = null; state.pendingGuess = false;
}
function submitGuessMP(guess) {
  if (state.pendingGuess) return;
  if (!state.user) { toast('Sign in to play multiplayer'); return; }
  if (!state.mp?.socket?.connected) { mpError('Connection lost. Reconnect before submitting.'); return; }
  state.pendingGuess = true; mpError('');
  state.pendingTimer = setTimeout(() => { releasePendingGuess(); mpError('No confirmation received. Reconnect and check the board before retrying.'); }, 15000);
  if (state.mp.emitGuess(guess, state.user) !== true) { releasePendingGuess(); mpError('Connection lost. Your guess is still here.'); }
}
function onMpGuessResult(result) {
  releasePendingGuess();
  if (result?.ok) { state.typed = ''; mpError(''); }
  else mpError(result?.reason === 'storage-unavailable'
    ? 'Progress could not be saved. Your guess is still here; please retry.'
    : 'Guess not accepted: ' + (result?.reason || 'please retry'));
  render();
}

// ─── Daily share ────────────────────────────────────
function shareResult(text) {
  if (!text) return;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied!'), () => {
      try { window.prompt('Copy your result:', text); } catch (e) {}
    });
  } else {
    try { window.prompt('Copy your result:', text); } catch (e) {}
  }
}

// Solo win → shared WinCard. The LOSS variant keeps the old #overlay card
// (see endGame); only the win UI moved to the shared component.
function showSoloWinCard() {
  const u = state.user;
  const winner = u ? {
    displayName: u.displayName || u.globalName || u.username,
    username: u.username,
    profilePic: u.avatar || u.profilePic || null,
    // 'web' regardless of provider: WT stores a hub login as a `web` player
    // row, so passing 'google'/'github' through as the platform resolved to
    // no cosmetics at all when state.cosmetics hadn't loaded yet.
    platform: 'web',
    platformUserId: u.id,
    linkedDiscord: u.provider === 'discord' ? u.id : (u.linkedDiscord || null),
    cosmetics: state.cosmetics || null,
  } : { displayName: 'You' };   // guest → the card's total-wins chip auto-hides

  const actions = [];
  if (state.isDaily) {
    const text = '🟢 Word5000 Daily' + (state.dailyDate ? ' ' + state.dailyDate : '') +
      ' — solved in ' + state.guesses.length + ' guess' + (state.guesses.length === 1 ? '' : 'es') +
      '\nhttps://word5000.com';
    actions.push({ label: 'Share', onClick: () => shareResult(text) });
  }
  actions.push({
    label: state.isDaily ? 'Practice another' : 'Play again',
    primary: true,
    onClick: () => { window.WinCard.hide(); startPracticeRound(); },
  });

  // Same 3s beat the old overlay used — let the player see the completed
  // grid + win flash first. autoHideMs: 0 = sticky, like the old overlay.
  setTimeout(() => {
    window.WinCard.showSolo({
      game: 'word500',
      gameName: 'Word 500',
      word: state.target,
      guessCount: state.guesses.length,
      winner,
      actions,
      autoHideMs: 0,
    });
  }, 3000);
}

function reportLibraryWord(word, gameId) {
  if (!state.user || !word) return;
  fetch(`${AUTH_BASE}/api/library/word`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...soloContextHeaders() },
    body: JSON.stringify({ word: word.toLowerCase(), game: gameId })
  }).catch(() => {});
}

function endGame(won) {
  state.gameOver = true;

  // Record library word on any solo/practice win
  if (won) reportLibraryWord(state.target, 'word500-sp');

  // Record local stats (totals + streak)
  recordGame({
    word: state.target,
    won,
    guesses: state.guesses.length,
    isDaily: state.isDaily,
    date: state.dailyDate,
  });

  // Mark daily complete on server + localStorage. Per the legacy client,
  // we mark on both win AND loss to prevent replay exploits.
  if (state.isDaily && state.dailyDate && !state.dailyAlreadyCompleted) {
    state.dailyAlreadyCompleted = true;
    _dailyConsumed = true;   // cycling back to 5 letters won't re-serve it
    markDailyComplete(state.dailyDate, !!state.user, { length: WORD_LEN, guesses: state.guesses.map(g => g.word) }).then(res => {
      if (res && res.ok && res.reward && state.user) {
        // Best-effort: tell the player about the reward
        toast('Daily win recorded · +reward sent');
      }
    });
  }

  if (won && window.WinCard) {
    showSoloWinCard();
    return;
  }

  // Loss (or WinCard failed to load — graceful fallback).
  overlayTitle.textContent = won
    ? (state.isDaily ? 'Daily solved!' : 'Got it!')
    : 'Out of guesses';
  overlayWord.textContent = state.target.toUpperCase();
  overlayDetail.textContent = won
    ? `Solved in ${state.guesses.length} guess${state.guesses.length === 1 ? '' : 'es'}`
    : `The word was ${state.target.toUpperCase()}`;
  // No Share button on this card any more \u2014 sharing lives on the WinCard's
  // Share action, and this branch is the loss / no-WinCard fallback.
  overlayAction.textContent = state.isDaily ? 'Practice another' : 'Play again';
  // Let the player see the completed grid + win flash first
  setTimeout(() => overlay.classList.add('is-open'), 3000);
}

function showAlreadyCompleted() {
  state.gameOver = true;
  overlayTitle.textContent = 'Daily completed';
  overlayWord.textContent = state.target.toUpperCase();
  overlayDetail.textContent = "You've already finished today's daily. Come back tomorrow for a new word.";
  overlayAction.textContent = 'Practice another';
  overlay.classList.add('is-open');
}

function updateLenBtn() {
  if (lenBtn) lenBtn.textContent = String(WORD_LEN);
}

// Cycles 4→5→6→7→8→4. Landing back on DAILY_LENGTH hands the player today's
// daily if they haven't played it yet; every other length is practice.
async function cycleSoloLength() {
  if (state.mode !== 'solo') return;
  const idx = SOLO_LENGTHS.indexOf(WORD_LEN);
  const next = SOLO_LENGTHS[(idx + 1) % SOLO_LENGTHS.length];
  WORD_LEN = next;
  try { localStorage.setItem(SOLO_LEN_KEY, String(next)); } catch (_) { /* private mode */ }
  updateLenBtn();

  if (lenBtn) lenBtn.disabled = true;
  try {
    await loadDictionary(next);
  } finally {
    if (lenBtn) lenBtn.disabled = false;
  }

  if (next === DAILY_LENGTH && _dailyCache && !_dailyConsumed) {
    state.target = _dailyCache.word;
    state.dailyDate = _dailyCache.date;
    state.isDaily = true;
    state.guesses = [];
    state.typed = '';
    state.gameOver = false;
    state.usedLetters = new Set();
    state.animatedRows = new Set();
    titleSub.textContent = 'DAILY';
    dailyBadge.style.display = '';
    overlay.classList.remove('is-open');
    render();
    return;
  }
  startPracticeRound();
}

function startPracticeRound() {
  dailyBadge.style.display = 'none';
  const next = pickRandomTarget(WORD_LEN);
  if (!next && WORD_LEN !== FALLBACK_TARGET.length) {
    // No targets loaded at this length — FALLBACK_TARGET is 5 letters and would
    // make the board unwinnable, so drop back to the length it does fit.
    toast(`No ${WORD_LEN}-letter words available right now`);
    WORD_LEN = FALLBACK_TARGET.length;
    try { localStorage.setItem(SOLO_LEN_KEY, String(WORD_LEN)); } catch (_) { /* private mode */ }
    updateLenBtn();
  }
  state.target = next || FALLBACK_TARGET;
  state.isDaily = false;
  state.dailyDate = null;
  state.dailyAlreadyCompleted = false;
  state.guesses = [];
  state.typed = '';
  state.gameOver = false;
  state.usedLetters = new Set();
  state.animatedRows = new Set();
  titleSub.textContent = 'PRACTICE';
  overlay.classList.remove('is-open');
  render();
}

// --- Personal tile marks (player tap-cycle) -------------------------------
// Cycle: null → 'mark-green' → 'mark-yellow' → 'mark-red' → null
const MARK_CYCLE = [null, 'mark-green', 'mark-yellow', 'mark-red'];

// Wedge-class → mark name
const WEDGE_TO_MARK = {
  'tri-wedge-correct': 'mark-green',
  'tri-wedge-present': 'mark-yellow',
  'tri-wedge-absent':  'mark-red',
};

// Single-click on a wedge is delayed slightly so a real double-click can
// cancel it and trigger the row reset instead.
let _wedgeClickTimer = null;

function wedgeOf(target) {
  return target.closest('.tri-wedge-correct, .tri-wedge-present, .tri-wedge-absent');
}

guessesEl.addEventListener('click', (e) => {
  // Triangle wedge → fill the whole row with that colour (delayed)
  const wedge = wedgeOf(e.target);
  if (wedge) {
    const row = wedge.closest('.guess-row.row-committed');
    if (!row) return;
    const idx = parseInt(row.dataset.guessIdx, 10);
    if (!Number.isInteger(idx) || !state.guesses[idx]) return;

    const mark = WEDGE_TO_MARK[
      ['tri-wedge-correct', 'tri-wedge-present', 'tri-wedge-absent']
        .find(c => wedge.classList.contains(c))
    ];
    if (!mark) return;

    if (_wedgeClickTimer) clearTimeout(_wedgeClickTimer);
    _wedgeClickTimer = setTimeout(() => {
      const g = state.guesses[idx];
      g.marks = new Array(g.word.length).fill(mark);
      render();
      _wedgeClickTimer = null;
    }, 250);
    return;
  }

  // Letter tile → cycle that single tile's mark
  const tile = e.target.closest('.letter-tile');
  if (!tile) return;
  const row = tile.closest('.guess-row.row-committed');
  if (!row) return;
  const idx = parseInt(row.dataset.guessIdx, 10);
  const letterIdx = parseInt(tile.dataset.letterIdx, 10);
  if (!Number.isInteger(idx) || !Number.isInteger(letterIdx)) return;
  const g = state.guesses[idx];
  if (!g) return;

  if (!g.marks) g.marks = new Array(g.word.length).fill(null);
  const current = g.marks[letterIdx];
  const nextIdx = (MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length;
  g.marks[letterIdx] = MARK_CYCLE[nextIdx];

  tile.classList.add('tile-tap');
  setTimeout(() => tile.classList.remove('tile-tap'), 130);
  setTimeout(render, 150);
});

// Double-click any wedge → reset that row's marks (cancels any pending
// single-click fill).
guessesEl.addEventListener('dblclick', (e) => {
  const wedge = wedgeOf(e.target);
  if (!wedge) return;
  const row = wedge.closest('.guess-row.row-committed');
  if (!row) return;
  const idx = parseInt(row.dataset.guessIdx, 10);
  if (!Number.isInteger(idx) || !state.guesses[idx]) return;

  if (_wedgeClickTimer) { clearTimeout(_wedgeClickTimer); _wedgeClickTimer = null; }
  state.guesses[idx].marks = null;
  render();
});

overlayAction.addEventListener('click', () => {
  // After a daily (or after "already completed"), the action button starts a
  // practice round with a fresh random target. In practice mode it just resets.
  startPracticeRound();
});

// --- Mode detection --------------------------------------------------------
//   Hostname  live.word5000.com / live.*  → mp
//   Path      /online                     → mp
//             /overlay/<handle>           → overlay
//             /<handle>  (not reserved)   → mp (streamer-private session)
//             /, /solo, /next/            → solo
//   Override  ?mode=solo|mp|overlay       → wins over the above (for testing)
function detectMode() {
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'mp' || q === 'solo' || q === 'overlay') return q;

  if (location.hostname.startsWith('live.')) return 'mp';

  const p = location.pathname.replace(/\/+$/, '');         // strip trailing slash
  if (p === '/online' || p.startsWith('/online/')) return 'mp';
  if (p.startsWith('/overlay/')) return 'overlay';
  if (p === '' || p === '/solo' || p === '/next') return 'solo';
  // A bare `/<handle>` path (any single segment that isn't a reserved word)
  // is a streamer-private session → MP.
  if (/^\/[a-z0-9_-]{1,32}$/i.test(p)) return 'mp';
  return 'solo';
}

// --- User pill (auth) ------------------------------------------------------
const userPill = document.getElementById('user-pill');
const userPillAvatar = document.getElementById('user-pill-avatar');
const userPillName = document.getElementById('user-pill-name');

function renderUserPill() {
  if (state.user) {
    userPillName.textContent = state.user.displayName || state.user.username || 'Player';
    if (state.user.avatar) {
      userPillAvatar.src = state.user.avatar;
      userPillAvatar.style.display = '';
    } else {
      userPillAvatar.style.display = 'none';
    }
    userPill.classList.add('is-authed');
  } else {
    userPillName.textContent = 'Sign in';
    userPillAvatar.style.display = 'none';
    userPill.classList.remove('is-authed');
  }
}

userPill.addEventListener('click', () => {
  if (state.user) return;       // future: open profile menu
  showLoginModal({ returnTo: location.href });
});

renderUserPill();

// --- Stats overlay ---------------------------------------------------------
const statsOverlay = document.getElementById('stats-overlay');
const statsBtn = document.getElementById('stats-btn');
const statsClose = document.getElementById('stats-close');
const statsGrid = document.getElementById('stats-grid');
const statsHistory = document.getElementById('stats-history');

function renderStatsOverlay() {
  const s = statsSummary();
  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-value">${s.played}</div><div class="stat-label">Played</div></div>
    <div class="stat-card"><div class="stat-value green">${s.winRate}%</div><div class="stat-label">Win rate</div></div>
    <div class="stat-card"><div class="stat-value">${s.avgGuesses}</div><div class="stat-label">Avg guesses</div></div>
    <div class="stat-card"><div class="stat-value green">${s.currentStreak}</div><div class="stat-label">Streak</div></div>
    <div class="stat-card"><div class="stat-value">${s.bestStreak}</div><div class="stat-label">Best streak</div></div>
    <div class="stat-card"><div class="stat-value">${s.wins}</div><div class="stat-label">Wins</div></div>
  `;
  if (s.history.length === 0) {
    statsHistory.innerHTML = '<div class="stats-empty">No games played yet</div>';
  } else {
    statsHistory.innerHTML = s.history.map(h => `
      <div class="stats-row">
        <span class="stats-row-word">${h.word}</span>
        <span class="stats-row-result ${h.won ? 'win' : 'loss'}">${h.won ? '✓ ' + h.guesses : '✗'}</span>
        <span class="stats-row-tag">${h.isDaily ? 'daily' : 'practice'}</span>
      </div>
    `).join('');
  }
}

statsBtn.addEventListener('click', () => {
  renderStatsOverlay();
  statsOverlay.classList.add('is-open');
});
statsClose.addEventListener('click', () => statsOverlay.classList.remove('is-open'));
statsOverlay.addEventListener('click', (e) => {
  if (e.target === statsOverlay) statsOverlay.classList.remove('is-open');
});

// --- Help overlay ----------------------------------------------------------
// Purely static content (see index.html), so this is open/close only — no
// render step, nothing to keep in sync with game state.
const helpOverlay = document.getElementById('help-overlay');
const helpBtn = document.getElementById('help-btn');
const helpClose = document.getElementById('help-close');

helpBtn.addEventListener('click', () => helpOverlay.classList.add('is-open'));
helpClose.addEventListener('click', () => helpOverlay.classList.remove('is-open'));
helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) helpOverlay.classList.remove('is-open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') helpOverlay.classList.remove('is-open');
});

// --- Fluid board sizing ----------------------------------------------------
// Make the 8-row board as large as it can be while still fitting the space
// between the header and the (in-page) keyboard, so it fills the screen on any
// phone — the tall app/PWA viewport AND a shorter browser tab (URL bar) alike.
// One CSS var (--tile-h) drives every row dimension; we set it to the largest
// value bounded by BOTH available height and available width.
function sizeBoard() {
  if (document.body.dataset.mode === 'overlay') return;  // OBS view keeps the default
  const root = document.documentElement;
  const guessesEl = document.getElementById('guesses');
  if (!guessesEl) return;
  const vv = window.visualViewport;
  const vw = (vv && vv.width) || window.innerWidth;

  // Height: measure the board container's ACTUAL height (it's flex:1, so this is
  // exactly the space between header and footer, above the keyboard) rather than
  // reconstructing it from part heights — that reconstruction ran a few px
  // optimistic and let overflow:hidden shave the top/bottom row.
  const csG = getComputedStyle(guessesEl);   // vertical padding is 4px on phones but
  const PAD = (parseFloat(csG.paddingTop) || 0) + (parseFloat(csG.paddingBottom) || 0);
  const MIN_GAP = 2;                          // 12px on ≥520px — measure, don't guess
  // The toon skin extrudes a 4px slab UNDER every pill with box-shadow, which
  // contributes NOTHING to layout — see the gap distribution at the foot of
  // this function, which is where that has to be paid for.
  const SLAB = 4;
  const boxH = guessesEl.clientHeight - PAD;
  // A committed (triangle) row is ~1.073× the tile height; worst case all 8 are
  // committed ⇒ 8·1.073 ≈ 8.6 tile-heights. Also reserve the 7 minimum gaps.
  const byHeight = (boxH - 7 * MIN_GAP) / 8.6;

  // Width: WORD_LEN tiles + the triangle that overhangs the last one ≈ 0.5·tileH, plus
  // ~28px padding. In MP a player avatar sits to the left of the pill, so leave
  // room for it (otherwise the wider MP row overflows / clips).
  const isMP = document.body.dataset.mode === 'mp';
  const av = isMP ? guessesEl.querySelector('.guess-player') : null;
  const avatarSpace = av ? av.getBoundingClientRect().width - 8 : (isMP ? 40 : 0);
  const byWidth = (vw - 28 - avatarSpace) / (WORD_LEN + 0.5);

  const tileH = Math.max(38, Math.min(76, byHeight, byWidth));
  root.style.setProperty('--tile-h', tileH.toFixed(1) + 'px');

  // Spread the rows into any leftover vertical slack (when the tile is capped by
  // width the board is shorter than the space), capped so a very tall phone
  // doesn't get sparse rows — the remainder just centres.
  if (guessesEl.children.length) {
    root.style.setProperty('--row-gap', MIN_GAP + 'px');   // reset before measuring
    let sum = 0;
    for (const r of guessesEl.children) sum += r.getBoundingClientRect().height;
    const gaps = Math.max(1, guessesEl.children.length - 1);
    // 🔴 Hold back SLAB*2 before spreading the slack into the gaps. Without it
    // this fills boxH EXACTLY — sum + gaps·gap === boxH — so the bottom row's
    // 4px shadow slab lands outside #guesses{overflow:hidden} and gets shaved:
    // a sliver of missing pill with visible empty space beneath it. Doubled
    // because justify-content:center hands back only half the slack below.
    //
    // It belongs HERE and not in boxH/byHeight above: Math.max(MIN_GAP, …)
    // discards the reserve automatically once the rows no longer fit, so short
    // viewports (where --tile-h is already pinned to its 38px floor and the
    // board overflows regardless) are left exactly as they were. Taking it out
    // of the tile budget instead would have shrunk every tile and pushed that
    // floor-clamp threshold ~8px further up.
    const gap = Math.max(MIN_GAP, Math.min(10, (boxH - sum - SLAB * 2) / gaps));
    root.style.setProperty('--row-gap', gap.toFixed(1) + 'px');
  }
}

// --- Boot ------------------------------------------------------------------
renderKeyboard(keyboardEl, handleKey);
bindPhysicalKeys(handleKey);
render();
sizeBoard();
requestAnimationFrame(sizeBoard);          // re-measure once layout/fonts settle
window.addEventListener('load', sizeBoard);
window.addEventListener('resize', sizeBoard);
window.addEventListener('orientationchange', () => setTimeout(sizeBoard, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);

(async function boot() {
  // Session is shared across modes
  const session = await getSession();
  if (session.redirecting) return;
  if (state.mode !== 'mp' && state.mode !== 'overlay') bindSoloOwner(session.loggedIn ? session.user : null);
  if (session.loggedIn) {
    state.user = session.user;
    renderUserPill();
    const [cos, vis] = await Promise.all([getEquippedCosmetics(), getVisibility()]);
    state.cosmetics = cos;
    state.visibility = vis || state.visibility;
  }

  initHints();

  if (state.mode === 'mp' || state.mode === 'overlay') return bootMP();
  return bootSolo();
})();

function initHints() {
  if (!window.WTHints) return;
  const wrap = document.getElementById('hint-btn-wrap');
  if (!wrap) return;
  // Solo mode is self-contained; MP hints need the streamer handle.
  const handle = state.mode === 'mp' || state.mode === 'overlay' ? (state.sessionHandle || 'public') : 'solo';
  WTHints.init({
    container: wrap,
    game: 'word500',
    extraBody: { handle },
    onSuccess: (data) => {
      if (data && data.hint) showHint(data.hint);
    },
    onError: (msg) => {
      toast(msg || 'Hint failed');
    }
  });
}

function showHint(hint) {
  if (!hint || typeof hint.position !== 'number') return;
  toast(`Hint: ${hint.letter} is in position ${hint.position + 1}`);
}

async function bootSolo() {
  WORD_LEN = readStoredSoloLength();
  updateLenBtn();
  if (lenBtn) {
    lenBtn.style.display = '';
    lenBtn.addEventListener('click', cycleSoloLength);
  }

  // The daily only exists at DAILY_LENGTH; at any other remembered length we
  // still fetch it so switching back to 5 can hand it over.
  const [_dict, daily, _targets] = await Promise.all([
    loadDictionary(WORD_LEN),
    fetchDaily(DAILY_LENGTH),
    loadTargets(),
  ]);

  if (daily && daily.word && typeof daily.word === 'string') {
    _dailyCache = { word: daily.word.toUpperCase(), date: daily.date || null };
  }
  state.ready = true;

  if (_dailyCache && _dailyCache.date) {
    const done = await isDailyCompleted(_dailyCache.date, !!state.user);
    if (done) {
      _dailyConsumed = true;
      state.dailyAlreadyCompleted = true;
    }
  }

  // Remembered a non-daily length, or today's daily is already done → practice.
  if (WORD_LEN !== DAILY_LENGTH || !_dailyCache || _dailyConsumed) {
    if (WORD_LEN !== DAILY_LENGTH) await loadDictionary(WORD_LEN);
    startPracticeRound();
    return;
  }

  state.target = _dailyCache.word;
  state.dailyDate = _dailyCache.date;
  state.isDaily = true;
  titleSub.textContent = 'DAILY';
  dailyBadge.style.display = '';
  render();

  console.log('[next] solo ready', {
    target: state.target, daily: state.dailyDate,
    dailyDone: state.dailyAlreadyCompleted,
    user: state.user ? state.user.displayName : 'guest',
  });
}

async function bootMP() {
  state.sessionHandle = parseSessionHandle();
  const isOverlay = state.mode === 'overlay';
  titleSub.textContent = state.sessionHandle
    ? `@${state.sessionHandle.toUpperCase()}`
    : (isOverlay ? 'OVERLAY' : 'MP');
  dailyBadge.style.display = 'none';
  jackpotPill.style.display = '';
  statsBtn.style.display = 'none';

  // Overlay is the streamer's browser source — no typing, no signing in.
  // The body[data-mode="overlay"] CSS hides keyboard + user pill + footer.
  // Plain MP still needs the dictionary for local guess pre-check.
  if (!isOverlay) await loadDictionary(WORD_LEN);

  state.mp = connectMP({
    onConnect: () => { mpError(''); },
    onDisconnect: () => { releasePendingGuess(); mpError('Connection lost. Reconnect before submitting.'); },
    onGuessResult: result => onMpGuessResult(result),
    onGameState: (s) => onMpGameState(s),
    onGuess:     (g) => onMpGuess(g),
    onNewGame:   (n) => onMpNewGame(n),
    onGameOver:  (o) => onMpGameOver(o),
    onGameWin:   (w) => onMpGameWin(w),
    onFrenzy:    (f) => onMpFrenzy(f),
    onSessionRedirect: (r) => onMpSessionRedirect(r),
  }, state.sessionHandle);

  state.ready = true;
  if (!isOverlay && !state.user) toast('Sign in to play multiplayer');
}

// --- MP event handlers -----------------------------------------------------
function applyVisibility(cos) {
  if (!cos) return cos;
  const out = { ...cos };
  for (const k in cos) {
    if (state.visibility && state.visibility[k] === false) delete out[k];
  }
  return out;
}

function normalizeMpGuess(g) {
  const fanClub = !!g.isFanClub
    || (Array.isArray(g.badges) && g.badges.indexOf('fan-club') !== -1);
  return {
    word: String(g.word || '').toUpperCase(),
    correct: g.correct || 0,
    present: g.present || 0,
    absent:  g.absent  || 0,
    allAbsent: !!g.allAbsent,
    displayName: g.displayName || '',
    avatar: g.profilePic || null,
    platform: g.platform || 'unknown',
    isFanClub: fanClub,
    cosmetics: applyVisibility(g.cosmetics),
  };
}

function onMpGameState(snapshot) {
  if (!snapshot) return;
  const opening = snapshot.roundStartedAt ?? snapshot.gameStartTime;
  const changed = state.mpRoundStartedAt !== null && state.mpRoundStartedAt !== opening;
  state.mpRoundStartedAt = opening;
  if (changed || snapshot.gameOver || (snapshot.guesses || []).some(g => g.word === state.typed)) { releasePendingGuess(); state.typed = ''; }
  if (snapshot.wordLength) WORD_LEN = snapshot.wordLength;
  state.guesses = (snapshot.guesses || []).map(normalizeMpGuess);
  state.gameOver = !!snapshot.gameOver;
  state.usedLetters = new Set();
  for (const g of state.guesses) for (const ch of g.word) state.usedLetters.add(ch);
  // Pre-mark every guess in this snapshot as already-animated so the feed
  // paints statically on connect/reconnect; only subsequent live guesses
  // will trigger the stamp animation.
  state.animatedRows = new Set();
  for (let i = 0; i < state.guesses.length; i++) state.animatedRows.add(i);

  if (typeof snapshot.jackpot === 'number') jackpotAmount.textContent = snapshot.jackpot;
  if (snapshot.frenzy) onMpFrenzy(snapshot.frenzy);
  dailyBadge.style.display = snapshot.isDaily ? '' : 'none';
  if (snapshot.gameOver && snapshot.winner) onMpGameWin({ winner: snapshot.winner, word: snapshot.word, guessCount: snapshot.guessCount, totalWins: snapshot.totalWins, jackpot: snapshot.jackpotAwarded ?? snapshot.jackpot });
  else if (window.WinCard) window.WinCard.hide();
  render();
}

function onMpGuess(guessData) {
  const g = normalizeMpGuess(guessData);
  state.guesses.push(g);
  for (const ch of g.word) state.usedLetters.add(ch);
  render();
}

function onMpNewGame(n) {
  releasePendingGuess(); mpError(''); state.mpRoundStartedAt = n?.gameStartTime ?? null;
  if (n && n.wordLength) WORD_LEN = n.wordLength;
  state.guesses = [];
  state.gameOver = false;
  state.usedLetters = new Set();
  state.typed = '';
  state.animatedRows = new Set();
  if (n && typeof n.isDaily === 'boolean') {
    dailyBadge.style.display = n.isDaily ? '' : 'none';
  }
  if (window.WinCard) window.WinCard.hide();
  render();
}

function onMpGameOver(_o) {
  releasePendingGuess(); state.typed = '';
  state.gameOver = true;
  render();
}

// MP win → the shared WinCard, replacing the old #mp-banner strip and the
// #last-winner chrome (both removed from index.html). Word5000 MP is a race to
// one word with a single winner, so there are no round standings to pass.
function onMpGameWin(w) {
  if (!w || !w.winner || !window.WinCard) return;
  let winner = w.winner;
  if (!winner.platformUserId && winner.id) {
    winner = Object.assign({}, winner, { platformUserId: winner.id });
  }
  window.WinCard.showMp({
    game: 'word500',
    gameName: 'Word5000',
    word: w.word,
    guessCount: w.guessCount || w.guesses || 0,
    jackpot: w.jackpot,
    totalWins: typeof w.totalWins === 'number' ? w.totalWins : undefined,
    winner,
    autoHideMs: 0,
  });
}

function onMpFrenzy(f) {
  const mult = f && (typeof f.multiplier === 'number' ? f.multiplier : f.mult);
  if (typeof mult === 'number' && mult > 1) {
    frenzyMult.textContent = `${mult.toFixed(1)}x`;
    frenzyPill.style.display = '';
  } else {
    frenzyPill.style.display = 'none';
  }
}

// Server says the streamer this session belongs to has switched to a
// different game. Pop a modal letting the viewer either follow them or fall
// back to the public version.
function onMpSessionRedirect(data) {
  if (!data || !data.targetUrl) return;
  if (document.getElementById('session-redirect-modal')) return;
  const tname = data.targetGameName || 'a different game';
  const overlay = document.createElement('div');
  overlay.id = 'session-redirect-modal';
  overlay.innerHTML = `
    <div class="srm-card">
      <div class="srm-title">Streamer switched games</div>
      <div class="srm-body">They're now playing <b>${escapeHtml(tname)}</b>.</div>
      <button class="srm-btn srm-follow" type="button">Follow streamer →</button>
      <button class="srm-btn srm-public" type="button">Play public version</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.srm-follow').addEventListener('click', () => {
    location.href = data.targetUrl;
  });
  overlay.querySelector('.srm-public').addEventListener('click', () => {
    // Drop the session handle from the URL so a refresh stays public.
    const url = new URL(location.href);
    url.searchParams.delete('session');
    if (url.pathname !== '/' && url.pathname !== '/next/') {
      url.pathname = url.pathname.replace(/\/[a-z0-9_-]{1,32}\/?$/, '/');
    }
    location.href = url.toString();
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}
