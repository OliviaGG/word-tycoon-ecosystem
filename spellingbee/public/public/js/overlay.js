const socket = io();
if (window.CoinReward) CoinReward.init(socket);

socket.on('connect_error', (err) => {
  console.log('[Overlay] Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('[Overlay] Disconnected:', reason);
});

// ── State ───────────────────────────────────────────────────

let currentState = null;
let popupTimeout = null;

// ── DOM References ──────────────────────────────────────────

const idleScreen = document.getElementById('idle-screen');
const gameScreen = document.getElementById('game-screen');
const foundCount = document.getElementById('found-count');
const totalCount = document.getElementById('total-count');
const currentScore = document.getElementById('current-score');
const totalScore = document.getElementById('total-score');
const progressFill = document.getElementById('progress-fill');
const leaderboardList = document.getElementById('leaderboard-list');
const wordFeedList = document.getElementById('word-feed-list');
const timerEl = document.getElementById('timer');
const timerValue = document.getElementById('timer-value');
const statusBadge = document.getElementById('status-badge');
const wordFeedSection = document.getElementById('word-feed-section');
const wordPopup = document.getElementById('word-popup');
const popupWord = document.getElementById('popup-word');
const popupPlayer = document.getElementById('popup-player');
const popupScore = document.getElementById('popup-score');
const dailyBadge = document.getElementById('daily-badge');
const frenzyBadge = document.getElementById('frenzy-badge');
const frenzyMultiplier = document.getElementById('frenzy-multiplier');

// ── Socket Events ───────────────────────────────────────────

socket.on('game-state', (state) => {
  currentState = state;
  render(state);
});

socket.on('word-found', (entry) => {
  showWordPopup(entry);
});

socket.on('overlay-settings', (settings) => {
  if (wordFeedSection) {
    wordFeedSection.classList.toggle('hidden', !settings.showRecentWords);
  }
});

socket.on('letters-shuffled', (letters) => {
  if (currentState) {
    currentState.letters = letters;
    renderLetters(letters);
  }
});

socket.on('timer-tick', (remaining) => {
  renderTimer(remaining);
});

socket.on('frenzy-update', (frenzy) => {
  renderFrenzy(frenzy);
});

// ── Render Functions ────────────────────────────────────────

function render(state) {
  if (!state || !state.letters || state.letters.length === 0 || state.status === 'idle' && state.letters.length === 0) {
    idleScreen.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    return;
  }

  idleScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  renderLetters(state.letters);
  renderProgress(state);
  renderLeaderboard(state.leaderboard);
  renderWordFeed(state.wordHistory);
  renderStatus(state.status);
  renderDaily(state.isDaily);
  renderFrenzy(state.frenzy);

  if (state.remainingTime !== null && state.remainingTime !== undefined) {
    renderTimer(state.remainingTime);
    timerEl.classList.remove('hidden');
  } else if (state.timerDuration === 0) {
    timerEl.classList.add('hidden');
  }
}

function renderLetters(letters) {
  if (!letters || letters.length < 7) return;
  for (let i = 0; i < 7; i++) {
    const el = document.getElementById(`letter-${i}`);
    if (el) el.textContent = letters[i].toUpperCase();
  }
}

function renderProgress(state) {
  foundCount.textContent = state.foundCount;
  totalCount.textContent = state.totalWords;
  currentScore.textContent = state.currentScore;
  totalScore.textContent = state.totalScore;

  const pct = state.totalWords > 0
    ? (state.foundCount / state.totalWords) * 100
    : 0;
  progressFill.style.width = `${pct}%`;
}

function renderLeaderboard(leaderboard) {
  if (!leaderboard || leaderboard.length === 0) {
    leaderboardList.innerHTML = '<div class="empty-state">No words found yet</div>';
    return;
  }

  leaderboardList.innerHTML = leaderboard.slice(0, 5).map((player, i) => `
    <div class="leader-row">
      <span class="leader-rank">${i + 1}</span>
      ${player.avatar
        ? `<img class="leader-avatar" src="${escapeAttr(player.avatar)}" alt="">`
        : `<div class="leader-avatar"></div>`
      }
      <span class="leader-name">${escapeHtml(player.displayName)}</span>
      <span class="leader-platform ${player.platform}">${player.platform}</span>
      <span class="leader-score">${player.score}</span>
      <span class="leader-words">${player.words.length}w</span>
    </div>
  `).join('');
}

function renderWordFeed(history) {
  if (!history || history.length === 0) {
    wordFeedList.innerHTML = '';
    return;
  }

  wordFeedList.innerHTML = history.slice(0, 10).map(entry => `
    <div class="feed-item ${entry.isPangram ? 'pangram' : ''}">
      <span class="feed-word">${escapeHtml(entry.word)}</span>
      ${entry.isPangram ? '<span class="feed-pangram-badge">P</span>' : ''}
      <span class="feed-player ${entry.platform || ''}">${escapeHtml(entry.player)}</span>
      <span class="feed-score">+${entry.score}</span>
    </div>
  `).join('');
}

function renderStatus(status) {
  statusBadge.className = 'status-badge';
  switch (status) {
    case 'active':
      statusBadge.textContent = 'LIVE';
      statusBadge.classList.add('active');
      break;
    case 'paused':
      statusBadge.textContent = 'PAUSED';
      statusBadge.classList.add('paused');
      break;
    case 'ended':
      statusBadge.textContent = 'ENDED';
      statusBadge.classList.add('ended');
      break;
    default:
      statusBadge.textContent = 'WAITING';
  }
}

function renderTimer(remaining) {
  if (remaining === null || remaining === undefined) return;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  timerValue.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  timerEl.classList.remove('hidden');
  if (remaining <= 30) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }
}

function renderDaily(isDailyFlag) {
  if (isDailyFlag) {
    dailyBadge.classList.remove('hidden');
  } else {
    dailyBadge.classList.add('hidden');
  }
}

function renderFrenzy(frenzy) {
  if (frenzy && frenzy.multiplier > 1.0) {
    frenzyMultiplier.textContent = frenzy.multiplier.toFixed(1) + 'x';
    frenzyBadge.classList.remove('hidden');
  } else {
    frenzyBadge.classList.add('hidden');
  }
}

// ── Word Found Popup ────────────────────────────────────────

function showWordPopup(entry) {
  if (popupTimeout) clearTimeout(popupTimeout);

  popupWord.textContent = entry.word.toUpperCase();
  popupPlayer.textContent = entry.player;
  popupScore.textContent = `+${entry.score}`;

  // Reset cosmetic styles
  popupWord.style.cssText = '';
  popupPlayer.style.cssText = '';
  // Remove old cosmetic titles
  popupPlayer.parentElement.querySelectorAll('.cosmetic-title').forEach(el => el.remove());
  applyCosmetics({ wordEl: popupWord, nameEl: popupPlayer, titleContainer: popupPlayer.parentElement }, entry.cosmetics);

  wordPopup.className = 'word-popup';
  if (entry.isPangram) {
    wordPopup.classList.add('pangram-popup');
  }

  // Trigger animation
  requestAnimationFrame(() => {
    wordPopup.classList.add('show');
  });

  popupTimeout = setTimeout(() => {
    wordPopup.classList.remove('show');
    setTimeout(() => {
      wordPopup.classList.add('hidden');
    }, 300);
  }, entry.isPangram ? 3000 : 2000);
}

// ── Cosmetics ───────────────────────────────────────────────

function applyCosmetics(els, cos) {
  if (!cos) return;
  if (cos.name_color && els.nameEl) {
    if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
    if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
  }
  if (cos.name_glow && els.nameEl) {
    if (cos.name_glow.textShadow) els.nameEl.style.textShadow = cos.name_glow.textShadow;
    if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
  }
  if (cos.word_color && els.wordEl) {
    if (cos.word_color.color) els.wordEl.style.color = cos.word_color.color;
    if (cos.word_color.textShadow) els.wordEl.style.textShadow = cos.word_color.textShadow;
    if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
  }
  if (cos.word_glow && els.wordEl) {
    if (cos.word_glow.textShadow) els.wordEl.style.textShadow = cos.word_glow.textShadow;
    if (cos.word_glow.animation && !els.wordEl.style.animation) els.wordEl.style.animation = cos.word_glow.animation;
  }
  if (cos.title && cos.title.title && els.titleContainer) {
    var titleSpan = document.createElement('span');
    titleSpan.className = 'cosmetic-title';
    titleSpan.textContent = ' [' + cos.title.title + ']';
    if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
    if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
    if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
    els.titleContainer.appendChild(titleSpan);
  }
}

// ── Helpers ─────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
