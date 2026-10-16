const socket = io();

// Admin auth — prompt once, store in sessionStorage
function getAdminKey() {
  let key = sessionStorage.getItem('adminKey');
  if (!key) {
    key = prompt('Enter admin password:');
    if (key) sessionStorage.setItem('adminKey', key);
  }
  return key || '';
}

function adminFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), 'x-admin-key': getAdminKey() };
  return fetch(url, { ...opts, headers });
}

// DOM refs
const secretWordEl = document.getElementById('secret-word');
const wordLengthEl = document.getElementById('word-length');
const currentLowerEl = document.getElementById('current-lower');
const currentUpperEl = document.getElementById('current-upper');
const guessCountEl = document.getElementById('guess-count');
const gameStatusEl = document.getElementById('game-status');
const lengthSelectorEl = document.getElementById('length-selector');
const feedEl = document.getElementById('feed');
const dotDisplays = document.getElementById('dot-displays');
const dotRelay = document.getElementById('dot-relay');

let currentWordLength = 5;
let availableLengths = {};
let randomWordLength = false;
let useFullDictionary = false;

// ---------- Init ----------

async function init() {
  const [stateRes, settingsRes] = await Promise.all([
    adminFetch('/api/state').then(r => { if (r.status === 403) { sessionStorage.removeItem('adminKey'); location.reload(); } return r.json(); }),
    fetch('/api/settings').then(r => r.json())
  ]);

  availableLengths = settingsRes.available || {};
  currentWordLength = settingsRes.settings?.wordLength || 5;
  randomWordLength = settingsRes.settings?.randomWordLength || false;
  useFullDictionary = settingsRes.settings?.useFullDictionary || false;

  buildLengthSelector();
  updateGameDisplay(stateRes);
  updateToggles();
  updatePoolStats(settingsRes.playedWordsStats);
  loadStats();
}

// ---------- Length Selector ----------

function buildLengthSelector() {
  lengthSelectorEl.innerHTML = '';
  for (let len = 3; len <= 10; len++) {
    const info = availableLengths[len];
    if (!info || info.targets === 0) continue;

    const btn = document.createElement('button');
    btn.className = 'length-btn' + (len === currentWordLength ? ' active' : '');
    btn.dataset.len = len;
    const count = useFullDictionary ? (info.words || info.targets) : info.targets;
    btn.innerHTML = `${len}<span class="count">${count}</span>`;
    btn.addEventListener('click', async () => {
      currentWordLength = len;
      document.querySelectorAll('.length-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Refresh pool stats for newly selected length
      const settingsRes = await fetch('/api/settings').then(r => r.json());
      updatePoolStats(settingsRes.playedWordsStats);
    });
    lengthSelectorEl.appendChild(btn);
  }
}

// ---------- Game Display ----------

function updateGameDisplay(state) {
  if (!state) return;
  secretWordEl.textContent = (state.secret || '?????').toUpperCase();
  wordLengthEl.textContent = state.wordLength || '-';
  currentLowerEl.textContent = (state.currentLower || '---').toUpperCase();
  currentUpperEl.textContent = (state.currentUpper || '---').toUpperCase();
  guessCountEl.textContent = state.guessCount || 0;
  gameStatusEl.textContent = state.isWon ? 'Won!' : 'Active';
  gameStatusEl.style.color = state.isWon ? 'var(--green-bright)' : 'var(--text)';

  renderFeed(state.guesses || []);
}

function renderFeed(guesses) {
  feedEl.innerHTML = '';
  if (guesses.length === 0) {
    feedEl.innerHTML = '<div class="feed-empty">No guesses yet</div>';
    return;
  }
  // Show newest first
  [...guesses].reverse().forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'feed-row';

    const num = guesses.length - i;
    let dirClass = 'dir-correct';
    let dirText = '✓ Correct';
    if (!g.isCorrect) {
      dirClass = g.direction === 'before' ? 'dir-before' : 'dir-after';
      dirText = g.direction === 'before' ? '⬆️ Too early' : '⬇️ Too late';
    }

    row.innerHTML = `
      <span style="color:var(--text-dim);min-width:18px">#${num}</span>
      <span class="word">${g.word.toUpperCase()}</span>
      <span class="user">${g.user?.displayName || 'Player'}</span>
      <span class="${dirClass}">${dirText}</span>
    `;
    feedEl.appendChild(row);
  });
  feedEl.scrollTop = 0;
}

function addGuessToFeed(guess, total) {
  // Remove empty placeholder
  const empty = feedEl.querySelector('.feed-empty');
  if (empty) empty.remove();

  let dirClass = 'dir-correct';
  let dirText = '✓ Correct';
  if (!guess.isCorrect) {
    dirClass = guess.direction === 'before' ? 'dir-before' : 'dir-after';
    dirText = guess.direction === 'before' ? '⬆️ Too early' : '⬇️ Too late';
  }

  const row = document.createElement('div');
  row.className = 'feed-row';
  row.innerHTML = `
    <span style="color:var(--text-dim);min-width:18px">#${total}</span>
    <span class="word">${guess.word.toUpperCase()}</span>
    <span class="user">${guess.user?.displayName || 'Player'}</span>
    <span class="${dirClass}">${dirText}</span>
  `;
  feedEl.insertBefore(row, feedEl.firstChild);
}

// ---------- Stats ----------

async function loadStats() {
  const stats = await fetch('/api/stats').then(r => r.json());
  document.getElementById('stat-games').textContent = stats.gamesPlayed;

  const lb = document.getElementById('leaderboard');
  if (stats.leaderboard.length === 0) {
    lb.innerHTML = '<div class="feed-empty">No games yet</div>';
  } else {
    lb.innerHTML = stats.leaderboard.map((p, i) =>
      `<div class="lb-row"><span class="lb-rank">${i + 1}.</span><span class="lb-name">${p.name}</span><span class="lb-wins">${p.wins}</span></div>`
    ).join('');
  }

  const rg = document.getElementById('recent-games');
  if (stats.recentGames.length === 0) {
    rg.innerHTML = '<div class="feed-empty">No history</div>';
  } else {
    rg.innerHTML = stats.recentGames.map(g => {
      const ago = timeAgo(g.timestamp);
      return `<div class="rg-row"><span class="rg-word">${g.word.toUpperCase()}</span><span class="rg-winner">${g.winner?.displayName || '?'}</span><span class="rg-guesses">${g.guessCount}g</span><span class="rg-time">${ago}</span></div>`;
    }).join('');
  }
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------- Toggles & Pool Stats ----------

function updateToggles() {
  const randomBtn = document.getElementById('toggle-random-length');
  const dictBtn = document.getElementById('toggle-full-dict');
  randomBtn.textContent = randomWordLength ? 'ON' : 'OFF';
  randomBtn.classList.toggle('active', randomWordLength);
  dictBtn.textContent = useFullDictionary ? 'ON' : 'OFF';
  dictBtn.classList.toggle('active', useFullDictionary);
}

function updatePoolStats(stats) {
  const el = document.getElementById('pool-stats');
  if (!stats) { el.innerHTML = ''; return; }

  const len = currentWordLength;
  const s = stats[len];
  if (!s) { el.innerHTML = '<span class="pool-empty">No data</span>'; return; }

  el.innerHTML = `
    <div class="pool-bar-container">
      <div class="pool-bar" style="width: ${Math.round((s.played / s.pool) * 100)}%"></div>
    </div>
    <div class="pool-text">${s.played} / ${s.pool} played (${s.remaining} remaining)</div>
  `;
}

document.getElementById('toggle-random-length').addEventListener('click', async () => {
  randomWordLength = !randomWordLength;
  updateToggles();
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ randomWordLength })
  });
});

document.getElementById('toggle-full-dict').addEventListener('click', async () => {
  useFullDictionary = !useFullDictionary;
  updateToggles();
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useFullDictionary })
  });
  const data = await res.json();
  updatePoolStats(data.playedWordsStats);
  // Rebuild length selector since counts may change
  buildLengthSelector();
});

document.getElementById('btn-reset-played').addEventListener('click', async () => {
  const res = await fetch('/api/reset-played-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();
  updatePoolStats(data.playedWordsStats);
});

// ---------- Actions ----------

document.getElementById('btn-new-game').addEventListener('click', async () => {
  const res = await fetch('/api/new-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wordLength: randomWordLength ? undefined : currentWordLength })
  });
  const data = await res.json();
  updateGameDisplay(data);
  // Refresh pool stats
  const settingsRes = await fetch('/api/settings').then(r => r.json());
  currentWordLength = data.wordLength || settingsRes.settings?.wordLength || currentWordLength;
  updatePoolStats(settingsRes.playedWordsStats);
  // Update active length button if random mode changed it
  document.querySelectorAll('.length-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.len) === currentWordLength);
  });
});

document.getElementById('btn-test-guess').addEventListener('click', async () => {
  const word = document.getElementById('test-word').value.trim();
  const displayName = document.getElementById('test-name').value.trim() || 'Admin';
  if (!word) return;

  const res = await fetch('/api/test-guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, displayName })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById('test-word').value = '';
  }
});

document.getElementById('test-word').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-test-guess').click();
});

// ---------- Socket Events ----------

socket.on('game-state', async (state) => {
  // Fetch admin state with secret
  const adminState = await adminFetch('/api/state').then(r => r.json());
  updateGameDisplay(adminState);
});

socket.on('new-guess', (guess) => {
  guessCountEl.textContent = parseInt(guessCountEl.textContent) + 1;
  addGuessToFeed(guess, parseInt(guessCountEl.textContent));
});

socket.on('new-game', async () => {
  const [adminState, settingsRes] = await Promise.all([
    adminFetch('/api/state').then(r => r.json()),
    fetch('/api/settings').then(r => r.json())
  ]);
  updateGameDisplay(adminState);
  currentWordLength = adminState.wordLength || settingsRes.settings?.wordLength || currentWordLength;
  updatePoolStats(settingsRes.playedWordsStats);
  // Update active length button
  document.querySelectorAll('.length-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.len) === currentWordLength);
  });
});

socket.on('game-won', () => {
  gameStatusEl.textContent = 'Won!';
  gameStatusEl.style.color = 'var(--green-bright)';
  loadStats();
});

socket.on('status', (data) => {
  dotDisplays.textContent = `${data.displays} display${data.displays !== 1 ? 's' : ''}`;
  dotDisplays.className = 'dot ' + (data.displays > 0 ? 'connected' : 'disconnected');
  dotRelay.className = 'dot ' + (data.relayConnected ? 'connected' : 'disconnected');
});

// ---------- Start ----------

init();
