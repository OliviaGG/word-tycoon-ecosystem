(() => {
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
  const currentWordEl = document.getElementById('current-word');
  const guessCountEl = document.getElementById('guess-count');
  const gameStatusEl = document.getElementById('game-status');
  const displayCountEl = document.getElementById('display-count');
  const dotDisplays = document.getElementById('dot-displays');
  const dotRelay = document.getElementById('dot-relay');
  const feedEl = document.getElementById('feed');
  const totalGamesEl = document.getElementById('total-games');
  const leaderboardEl = document.getElementById('leaderboard');
  const historyEl = document.getElementById('history');
  const btnNewGame = document.getElementById('btn-new-game');
  const btnGuess = document.getElementById('btn-guess');
  const guessWordInput = document.getElementById('guess-word');
  const guessUserInput = document.getElementById('guess-user');
  const toggleSlash = document.getElementById('toggle-slash');
  const toggleJackpot = document.getElementById('toggle-jackpot');
  const btnResetJackpot = document.getElementById('btn-reset-jackpot');

  // --- Fetch helpers ---

  async function fetchState() {
    const res = await adminFetch('/api/admin-state');
    if (res.status === 403) { sessionStorage.removeItem('adminKey'); return fetchState(); }
    const data = await res.json();
    renderState(data);
  }

  async function fetchStats() {
    const res = await fetch('/api/stats');
    const data = await res.json();
    renderStats(data);
  }

  // --- Render ---

  function renderState(data) {
    currentWordEl.textContent = data.word || '-----';
    guessCountEl.textContent = data.guesses.length;

    if (data.gameOver && data.winner) {
      gameStatusEl.textContent = 'Won by ' + data.winner.displayName;
      gameStatusEl.className = 'meta-value won';
    } else {
      gameStatusEl.textContent = 'Active';
      gameStatusEl.className = 'meta-value active';
    }

    displayCountEl.textContent = data.connectedDisplays + ' display' + (data.connectedDisplays !== 1 ? 's' : '');
    dotDisplays.className = 'dot ' + (data.connectedDisplays > 0 ? 'on' : 'off');
    dotRelay.className = 'dot ' + (data.chatRelayConnected ? 'on' : 'off');
    toggleSlash.checked = !!data.requireSlashPrefix;
    toggleJackpot.checked = data.jackpotEnabled !== false;

    // Rebuild feed from current guesses
    feedEl.innerHTML = '';
    if (data.guesses.length === 0) {
      feedEl.innerHTML = '<div class="feed-empty">Waiting for guesses...</div>';
    } else {
      const reversed = [...data.guesses].reverse();
      reversed.forEach(g => addFeedItem(g, false));
    }
  }

  function addFeedItem(g, animate) {
    // Remove empty placeholder
    const empty = feedEl.querySelector('.feed-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'feed-item';
    if (!animate) item.style.animation = 'none';

    item.innerHTML = `
      <span class="feed-name">${esc(g.displayName)}</span>
      <span class="feed-word">${esc(g.word)}</span>
      <div class="feed-counts">
        <span class="feed-c fc-g${g.correct === 0 ? ' fc-zero' : ''}">${g.correct}</span>
        <span class="feed-c fc-y${g.present === 0 ? ' fc-zero' : ''}">${g.present}</span>
        <span class="feed-c fc-r${g.absent === 0 ? ' fc-zero' : ''}">${g.absent}</span>
      </div>
    `;

    feedEl.prepend(item);
  }

  function renderStats(data) {
    totalGamesEl.textContent = data.totalGamesPlayed;

    if (data.leaderboard.length === 0) {
      leaderboardEl.innerHTML = '<li class="lb-empty">No wins yet</li>';
    } else {
      leaderboardEl.innerHTML = '';
      data.leaderboard.forEach((entry, i) => {
        const li = document.createElement('li');
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        li.innerHTML = `
          <span class="lb-rank ${rankClass}">${i + 1}</span>
          <span class="lb-name">${esc(entry.name)}</span>
          <span class="lb-wins">${entry.wins} win${entry.wins !== 1 ? 's' : ''}</span>
        `;
        leaderboardEl.appendChild(li);
      });
    }

    if (data.gameHistory.length === 0) {
      historyEl.innerHTML = '<li class="lb-empty">No games yet</li>';
    } else {
      historyEl.innerHTML = '';
      data.gameHistory.slice(0, 15).forEach(g => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="hist-word">${esc(g.word)}</span>
          <span class="hist-winner">${esc(g.winner)}</span>
          <span class="hist-guesses">${g.guessCount} guesses</span>
          <span class="hist-time">${timeAgo(g.timestamp)}</span>
        `;
        historyEl.appendChild(li);
      });
    }
  }

  // --- Actions ---

  btnNewGame.addEventListener('click', async () => {
    btnNewGame.disabled = true;
    await fetch('/api/new-game', { method: 'POST' });
    btnNewGame.disabled = false;
  });

  btnResetJackpot.addEventListener('click', async () => {
    btnResetJackpot.disabled = true;
    await fetch('/api/reset-jackpot', { method: 'POST' });
    btnResetJackpot.disabled = false;
  });

  toggleJackpot.addEventListener('change', async () => {
    toggleJackpot.disabled = true;
    await fetch('/api/jackpot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: toggleJackpot.checked }),
    });
    toggleJackpot.disabled = false;
  });

  toggleSlash.addEventListener('change', async () => {
    toggleSlash.disabled = true;
    await fetch('/api/toggle-slash-prefix', { method: 'POST' });
    toggleSlash.disabled = false;
  });

  btnGuess.addEventListener('click', submitGuess);
  guessWordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });

  async function submitGuess() {
    const word = guessWordInput.value.trim();
    const user = guessUserInput.value.trim() || 'Admin';
    if (word.length !== 5) return;

    btnGuess.disabled = true;
    await adminFetch('/api/test-guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, user }),
    });
    guessWordInput.value = '';
    btnGuess.disabled = false;
    guessWordInput.focus();
  }

  // --- Socket events ---

  socket.on('game-state', () => {
    fetchState();
  });

  socket.on('new-game', () => {
    fetchState();
  });

  socket.on('guess', (data) => {
    guessCountEl.textContent = parseInt(guessCountEl.textContent) + 1;
    addFeedItem(data, true);
  });

  socket.on('game-over', (data) => {
    gameStatusEl.textContent = 'Won by ' + data.winner.displayName;
    gameStatusEl.className = 'meta-value won';
    fetchStats();
  });

  // --- Helpers ---

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // --- Init ---
  fetchState();
  fetchStats();

  // Refresh connection status every 10s
  setInterval(fetchState, 10000);
})();
