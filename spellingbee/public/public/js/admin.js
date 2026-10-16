const socket = io();

// ── State ───────────────────────────────────────────────────

let state = null;
let adminState = null;
let wordsVisible = true;

// ── DOM ─────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const serverDot = $('server-dot');
const serverStatus = $('server-status');
const chatDot = $('chat-dot');
const chatDot2 = $('chat-dot-2');
const chatStatus = $('chat-status');
const chatStatus2 = $('chat-status-2');

const btnGenerate = $('btn-generate');
const btnCustom = $('btn-custom');
const btnShuffle = $('btn-shuffle');
const btnStart = $('btn-start');
const btnPause = $('btn-pause');
const btnResume = $('btn-resume');
const btnEnd = $('btn-end');
const btnReset = $('btn-reset');
const btnTest = $('btn-test');
const btnReconnectChat = $('btn-reconnect-chat');
const toggleRecentWords = $('toggle-recent-words');

const customLetters = $('custom-letters');
const customCenter = $('custom-center');
const timerInput = $('timer-input');
const testWord = $('test-word');
const testResult = $('test-result');

const puzzleInfo = $('puzzle-info');
const miniHoneycomb = $('mini-honeycomb');
const statWords = $('stat-words');
const statPoints = $('stat-points');
const statPangrams = $('stat-pangrams');

const gameStatus = $('game-status');
const infoFound = $('info-found');
const infoTotal = $('info-total');
const infoScore = $('info-score');
const infoMaxScore = $('info-max-score');
const infoTimerWrap = $('info-timer-wrap');
const infoTimer = $('info-timer');
const adminProgress = $('admin-progress');
const adminLeaderboard = $('admin-leaderboard');
const adminFeed = $('admin-feed');
const validWordsDiv = $('valid-words');
const savedGamesDiv = $('saved-games');
const playerStatsDiv = $('player-stats');

// ── Socket Events ───────────────────────────────────────────

socket.on('connect', () => {
  serverDot.classList.add('connected');
  serverStatus.textContent = 'Connected';
  socket.emit('get-admin-state');
  socket.emit('get-saved-games');
  socket.emit('get-player-stats');
});

socket.on('disconnect', () => {
  serverDot.classList.remove('connected');
  serverStatus.textContent = 'Disconnected';
});

socket.on('game-state', (s) => {
  state = s;
  render();
  socket.emit('get-admin-state');
});

socket.on('admin-state', (s) => {
  adminState = s;
  renderValidWords();
});

socket.on('chat-relay-status', (s) => {
  const connected = s.connected;
  chatDot.classList.toggle('connected', connected);
  chatDot2.classList.toggle('connected', connected);
  chatStatus.textContent = connected ? 'Chat Connected' : 'Chat Disconnected';
  chatStatus2.textContent = connected ? 'Connected' : 'Disconnected';
});

socket.on('timer-tick', (remaining) => {
  if (remaining !== null) {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    infoTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }
});

socket.on('submit-result', (result) => {
  testResult.textContent = result.valid
    ? `Valid! "${result.word}" = +${result.score}${result.isPangram ? ' PANGRAM!' : ''}`
    : `Invalid: ${result.error}`;
  testResult.className = `test-result ${result.valid ? 'valid' : 'invalid'}`;
  if (result.valid) testWord.value = '';
});

socket.on('overlay-settings', (settings) => {
  toggleRecentWords.checked = settings.showRecentWords;
});

socket.on('saved-games', (games) => {
  renderSavedGames(games);
});

socket.on('player-stats', (stats) => {
  renderPlayerStats(stats);
});

socket.on('error', (err) => {
  alert(err.message);
});

// ── Button Handlers ─────────────────────────────────────────

btnGenerate.addEventListener('click', () => {
  socket.emit('generate-puzzle');
});

btnCustom.addEventListener('click', () => {
  const letters = customLetters.value.toLowerCase().replace(/[^a-z]/g, '');
  const center = customCenter.value.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length !== 7) return alert('Enter exactly 7 letters');
  if (center.length !== 1) return alert('Enter exactly 1 center letter');
  if (!letters.includes(center)) return alert('Center letter must be one of the 7 letters');
  socket.emit('custom-puzzle', { letters: letters.split(''), centerLetter: center });
});

btnStart.addEventListener('click', () => {
  const timer = parseInt(timerInput.value) || 0;
  socket.emit('start-game', { timer });
});

btnPause.addEventListener('click', () => socket.emit('pause-game'));
btnResume.addEventListener('click', () => socket.emit('resume-game'));
btnEnd.addEventListener('click', () => socket.emit('end-game'));

btnReset.addEventListener('click', () => {
  if (confirm('Reset the entire game? This clears all scores and the puzzle.')) {
    socket.emit('reset-game');
  }
});

btnShuffle.addEventListener('click', () => socket.emit('shuffle-letters'));

btnTest.addEventListener('click', () => submitTestWord());
testWord.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitTestWord();
});

function submitTestWord() {
  const word = testWord.value.trim();
  if (!word) return;
  socket.emit('manual-submit', { word });
}

btnReconnectChat.addEventListener('click', () => socket.emit('reconnect-chat'));

toggleRecentWords.addEventListener('change', () => {
  socket.emit('update-overlay-settings', { showRecentWords: toggleRecentWords.checked });
});


// ── Render ──────────────────────────────────────────────────

function render() {
  if (!state) return;

  // Puzzle info
  if (state.letters && state.letters.length === 7) {
    puzzleInfo.style.display = '';
    renderMiniHoneycomb(state.letters);
    statWords.textContent = state.totalWords;
    statPoints.textContent = state.totalScore;
    statPangrams.textContent = state.pangrams;
  } else {
    puzzleInfo.style.display = 'none';
  }

  // Status
  gameStatus.textContent = state.status.toUpperCase();
  gameStatus.className = `game-status ${state.status}`;

  // Progress
  infoFound.textContent = state.foundCount;
  infoTotal.textContent = state.totalWords;
  infoScore.textContent = state.currentScore;
  infoMaxScore.textContent = state.totalScore;
  const pct = state.totalWords > 0 ? (state.foundCount / state.totalWords) * 100 : 0;
  adminProgress.style.width = `${pct}%`;

  // Timer
  if (state.remainingTime !== null && state.remainingTime !== undefined && state.timerDuration > 0) {
    infoTimerWrap.style.display = '';
    const m = Math.floor(state.remainingTime / 60);
    const s = state.remainingTime % 60;
    infoTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  } else {
    infoTimerWrap.style.display = 'none';
  }

  // Button states
  const hasLetters = state.letters && state.letters.length === 7;
  btnStart.disabled = !hasLetters || state.status === 'active';
  btnPause.disabled = state.status !== 'active';
  btnResume.disabled = state.status !== 'paused';
  btnEnd.disabled = state.status !== 'active' && state.status !== 'paused';

  // Leaderboard
  renderLeaderboard(state.leaderboard);

  // Feed
  renderFeed(state.wordHistory);
}

function renderMiniHoneycomb(letters) {
  // Absolute positions for tight honeycomb (38px hexes, ~42px spacing)
  const positions = [
    { left: 44, top: 30, cls: 'center' },   // 0: center
    { left: 22, top: 0, cls: 'outer' },      // 1: top-left
    { left: 66, top: 0, cls: 'outer' },      // 2: top-right
    { left: 0,  top: 30, cls: 'outer' },     // 3: left
    { left: 88, top: 30, cls: 'outer' },     // 4: right
    { left: 22, top: 60, cls: 'outer' },     // 5: bottom-left
    { left: 66, top: 60, cls: 'outer' },     // 6: bottom-right
  ];

  miniHoneycomb.innerHTML = positions.map((pos, i) => `
    <div class="mini-hex ${pos.cls}" style="left:${pos.left}px; top:${pos.top}px;">
      ${letters[i].toUpperCase()}
    </div>
  `).join('');
}

function renderLeaderboard(lb) {
  if (!lb || lb.length === 0) {
    adminLeaderboard.innerHTML = '<div class="empty">No players yet</div>';
    return;
  }
  adminLeaderboard.innerHTML = lb.map((p, i) => `
    <div class="admin-leader-row">
      <span class="admin-rank">${i + 1}</span>
      ${p.avatar
        ? `<img class="admin-avatar" src="${esc(p.avatar)}" alt="">`
        : '<div class="admin-avatar"></div>'
      }
      <span class="admin-name">${esc(p.displayName)}</span>
      <span class="admin-platform ${p.platform}">${p.platform}</span>
      <span class="admin-score">${p.score}</span>
      <span class="admin-word-count">${p.words.length}w</span>
    </div>
  `).join('');
}

function renderFeed(history) {
  if (!history || history.length === 0) {
    adminFeed.innerHTML = '<div class="empty">No words found yet</div>';
    return;
  }
  adminFeed.innerHTML = history.slice(0, 20).map(e => `
    <div class="admin-feed-item ${e.isPangram ? 'pangram' : ''}">
      <span class="admin-feed-word">${esc(e.word)}</span>
      ${e.isPangram ? '<span class="admin-feed-pangram">PANGRAM</span>' : ''}
      <span class="admin-feed-player">${esc(e.player)}</span>
      <span class="admin-feed-score">+${e.score}</span>
    </div>
  `).join('');
}

function renderValidWords() {
  if (!adminState || !adminState.validWords) {
    validWordsDiv.innerHTML = '<div class="empty">Load a puzzle first</div>';
    return;
  }

  const found = adminState.foundWords || {};
  const pangrams = new Set(adminState.pangramWords || []);

  validWordsDiv.innerHTML = `<div class="valid-words-grid">
    ${adminState.validWords.map(w => {
      const isFound = w in found;
      const isPangram = pangrams.has(w);
      return `<span class="valid-word-chip ${isFound ? 'found' : ''} ${isPangram ? 'pangram' : ''}">${w}</span>`;
    }).join('')}
  </div>`;
}

// ── Saved Games ────────────────────────────────────────────

function renderSavedGames(games) {
  if (!games || games.length === 0) {
    savedGamesDiv.innerHTML = '<div class="empty">No saved games</div>';
    return;
  }

  savedGamesDiv.innerHTML = games.map(g => {
    const pct = g.totalWords > 0 ? Math.round((g.foundCount / g.totalWords) * 100) : 0;
    const letters = (g.letters || []).join('').toUpperCase();
    const center = (g.centerLetter || '').toUpperCase();
    const date = g.savedAt ? new Date(g.savedAt).toLocaleDateString() : '';
    const statusLabel = g.allWordsFound ? 'COMPLETED' : (g.status || 'ended').toUpperCase();
    const statusClass = g.allWordsFound ? 'completed' : (g.status || 'ended');
    const topPlayer = g.topPlayers && g.topPlayers.length > 0
      ? esc(g.topPlayers[0].displayName || g.topPlayers[0].username)
      : '—';

    return `
      <div class="saved-game-row">
        <div class="saved-game-header">
          <span class="saved-game-letters">${letters} <span class="saved-game-center">(${center})</span></span>
          <span class="saved-game-date">${date}</span>
        </div>
        <div class="saved-game-details">
          <span class="saved-game-progress">${g.foundCount}/${g.totalWords} words (${pct}%)</span>
          <span class="saved-game-score">${g.currentScore}/${g.totalScore} pts</span>
          <span class="saved-game-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="saved-game-details">
          <span class="saved-game-top">Top: ${topPlayer}</span>
          <span class="saved-game-players">${g.playerCount || 0} players</span>
        </div>
        <div class="saved-game-actions">
          <button class="btn small primary" onclick="loadSavedGame('${esc(g.id)}')">Load</button>
          <button class="btn small danger" onclick="deleteSavedGame('${esc(g.id)}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function loadSavedGame(id) {
  if (confirm('Load this saved game? Current game state will be replaced.')) {
    socket.emit('load-saved-game', { id });
  }
}

function deleteSavedGame(id) {
  if (confirm('Delete this saved game permanently?')) {
    socket.emit('delete-saved-game', { id });
  }
}

// ── Player Stats ───────────────────────────────────────────

function renderPlayerStats(stats) {
  if (!stats || Object.keys(stats).length === 0) {
    playerStatsDiv.innerHTML = '<div class="empty">No stats yet</div>';
    return;
  }

  const sorted = Object.values(stats).sort((a, b) => b.totalScore - a.totalScore);

  playerStatsDiv.innerHTML = sorted.map((p, i) => `
    <div class="admin-leader-row">
      <span class="admin-rank">${i + 1}</span>
      ${p.avatar
        ? `<img class="admin-avatar" src="${esc(p.avatar)}" alt="">`
        : '<div class="admin-avatar"></div>'
      }
      <span class="admin-name">${esc(p.displayName || p.username)}</span>
      <span class="admin-platform ${p.platform}">${p.platform}</span>
      <span class="admin-score">${p.totalScore}</span>
      <span class="stats-detail">${p.totalWords}w · ${p.totalPangrams}p · ${p.gamesPlayed}g</span>
    </div>
  `).join('');
}

// ── Helpers ────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
