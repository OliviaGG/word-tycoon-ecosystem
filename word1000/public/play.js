// Word5000 Solo — Single Player (fully client-side)
(function () {
  'use strict';
  // Load both current ownership helpers before reading any game progress.
  if (!window.WordTycoonSoloAccount || window.WTDurableCompletion?.sessionContextVersion !== 2) {
    var engineURL = document.currentScript.src;
    var dependencies = ['solo-account.js?v=20261003-owner2','durable-completion.js?v=20261003-owner2'];
    function loadDependency() {
      var script = document.createElement('script');
      if (!dependencies.length) { script.src = engineURL; document.head.appendChild(script); return; }
      script.src = new URL(dependencies.shift(), engineURL).href;
      script.onload = loadDependency;
      script.onerror = function () { var notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.textContent = 'Progress protection could not load. Refresh to try again.'; document.body.appendChild(notice); };
      document.head.appendChild(script);
    }
    loadDependency(); return;
  }
  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'word500-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // --- State ---
  const MAX_GUESSES = 8;
  let wordLength = 5;
  let targetWord = '';
  let guesses = [];
  let currentInput = '';
  let letterStates = {};
  let gameOver = false;
  let guessNumber = 0;
  let currentUser = null;
  let guestProfile = null;
  let manualColors = {};
  const COLOR_CYCLE = ['neutral', 'absent', 'present', 'correct'];

  // Word data (fetched from word bank)
  let targets = {};       // { "4": [...], "5": [...], ... }
  let dictSets = {};      // { "4": Set, "5": Set, ... }
  let dataReady = false;

  // Daily word state
  let dailyData = null;       // { word, date, length } from /api/sp/daily
  let dailyPlayed = false;    // in-memory flag: daily already assigned this session
  let currentGameIsDaily = false;  // is current game the daily?
  const DAILY_KEY = 'word500_sp_daily_date';
  let serverCompletedDates = new Set();  // dates completed on server (cross-device)

  // Launch mode (from portal pill links)
  const launchMode = new URLSearchParams(window.location.search).get('mode'); // 'daily' or null
  let stateSyncTimer = null;  // debounce timer for server state saves

  // Stats
  const STATS_KEY = 'word500sp_stats';
  const GAME_STATE_KEY = 'word500sp_game';
  const DAILY_STATE_KEY = 'word500sp_daily_game';  // separate save for daily game
  const GUEST_KEY = 'word500sp_guest_profile';

  // DOM refs
  let inputRow, guessesEl, keyboardEl, winOverlay, winWordEl, winDetailEl, winEmojiEl;
  let loadingOverlay, statsOverlay, statsGrid, statsHistory;
  let lengthButtons, lenToggle, discordLoginBtn, discordLoginText;
  let loginScreen, loginCloseBtn, guestNameInput, guestPlayBtn, discordLoginLink, githubLoginLink;
  const LENGTHS = [4, 5, 6, 7, 8, 9, 10];

  // --- Init ---
  async function init() {
    inputRow = document.getElementById('input-row');
    guessesEl = document.getElementById('guesses');
    keyboardEl = document.getElementById('keyboard');
    winOverlay = document.getElementById('win-overlay');
    winWordEl = document.getElementById('win-word');
    winDetailEl = document.getElementById('win-detail');
    winEmojiEl = document.getElementById('win-emoji');
    loadingOverlay = document.getElementById('loading-overlay');
    statsOverlay = document.getElementById('stats-overlay');
    statsGrid = document.getElementById('stats-grid');
    statsHistory = document.getElementById('stats-history');
    lengthButtons = document.getElementById('length-buttons');
    lenToggle = document.getElementById('len-toggle');
    discordLoginBtn = document.getElementById('discord-login-btn');
    discordLoginText = document.getElementById('discord-login-text');
    loginScreen = document.getElementById('login-screen');
    loginCloseBtn = document.getElementById('login-close-btn');
    guestNameInput = document.getElementById('guest-name-input');
    guestPlayBtn = document.getElementById('guest-play-btn');
    discordLoginLink = document.getElementById('discord-login-link');
    githubLoginLink = document.getElementById('github-login-link');
    guestProfile = loadGuestProfile();

    renderInputTiles();
    renderKeyboard();
    bindEvents();
    await checkAuth();   // must complete before loadWordData so server completions are known
    loadWordData();
    initHints();
  }

  function initHints() {
    if (!window.WTHints) return;
    const wrap = document.getElementById('hint-btn-wrap');
    if (!wrap) return;
    WTHints.init({
      container: wrap,
      game: 'word1000',
      idempotent: true,
      storageKey: 'wt-hint-word1000-daily-v1',
      canUse: function () {
        return currentGameIsDaily && !gameOver && dailyData && dailyData.length === wordLength
          ? true : 'Hints are available during an active daily puzzle.';
      },
      extraBody: function () { return { length: wordLength, handle: 'daily-' + wordLength,
        daily: currentGameIsDaily, gameOver: gameOver, date: dailyData && dailyData.date,
        expectedStartTime: dailyData && dailyData.date + 'T00:00:00.000Z',
        guesses: guesses.map(function (guess) { return typeof guess === 'string' ? guess : guess.word; }) }; },
      onSuccess: function (data) {
        if (!data || !data.hint) return;
        const current = currentGameIsDaily && !gameOver && dailyData && dailyData.length === wordLength
          && data.startTime === dailyData.date + 'T00:00:00.000Z' && data.hint.wordLength === wordLength;
        if (data.staleRound || !current) showToast('Previous daily hint: ' + data.hint.letter + ' in position ' + (data.hint.position + 1));
        else showHint(data.hint);
      },
      onError: function (msg) {
        showToast(msg || 'Hint failed');
      }
    });
  }

  function showHint(hint) {
    if (!hint || typeof hint.position !== 'number') return;
    showToast('Hint: ' + hint.letter + ' is in position ' + (hint.position + 1));
  }

  // --- Auth (optional — game works without it) ---
  async function checkAuth() {
    const authBaseURL = getAuthBaseURL();
    setupLoginLinks();

    // Check for auth token in URL (returned from Discord OAuth redirect)
    const params = new URLSearchParams(window.location.search);
    const authToken = params.get('auth_token') || params.get('auth');
    if (authToken) {
      params.delete('auth_token');
      params.delete('auth');
      const remaining = params.toString();
      history.replaceState(null, '', window.location.pathname + (remaining ? '?' + remaining : ''));
      try {
        const res = await fetch(authBaseURL + '/api/auth/exchange?token=' + encodeURIComponent(authToken), {
          credentials: 'include', signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();
        if (data.ok && data.user) {
          soloAccount.bind(data.user);
          currentUser = data.user;
          showLoggedIn();
          await fetchServerCompletions();
        getCompletionRecovery().recover();
          return;
        }
      } catch {}
    }

    // Check existing session
    try {
      const res = await fetch(authBaseURL + '/api/me/session', {
        credentials: 'include', signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      if (data.ok && data.user) {
        soloAccount.bind(data.user);
          currentUser = data.user;
        showLoggedIn();
        await fetchServerCompletions();
        getCompletionRecovery().recover();
        return;
      }
    } catch {}

    soloAccount.bind(null);
    discordLoginBtn.classList.remove('hidden');
    discordLoginBtn.classList.remove('logged-in');
    discordLoginText.textContent = 'Login';
    showLoginScreen();
  }

  // Fetch daily completions from server (cross-device sync)
  async function fetchServerCompletions() {
    try {
      const res = await fetch(getAuthBaseURL() + '/api/sp-daily/status/word500-sp', {
        credentials: 'include', headers: { 'x-solo-session-context': JSON.stringify({ id: String(currentUser.id), provider: currentUser.provider || 'discord', anchorId: String(currentUser.anchorId || currentUser.id) }) }, signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      if (data.ok && data.completedDates) {
        serverCompletedDates = new Set(data.completedDates);
        // Early sync deferred to fetchDaily() where dailyData.date is available
        // (dates are Edmonton timezone from server, not UTC)
      }
    } catch (e) {
      console.warn('[SP] Failed to fetch server completions:', e);
    }
  }

  // Save daily completion to server
  var completionRecovery = null;
  function getCompletionRecovery() {
    if (!completionRecovery) completionRecovery = window.WTDurableCompletion.attach({
      gameId: 'word500-sp', getSession: function() { return currentUser; }, getAccount: function() { return currentUser && (currentUser.anchorId || currentUser.id); }, baseUrl: getAuthBaseURL
    });
    return completionRecovery;
  }
  function saveServerCompletion(date) {
    var evidence = { length: wordLength, guesses: guesses.map(g => g.word) };
    return getCompletionRecovery().submit(date, evidence);
  }

  function showLoggedIn() {
    const name = currentUser.globalName || currentUser.username || 'You';
    if (currentUser.avatar) {
      discordLoginBtn.innerHTML = '<img class="user-pic" src="' + currentUser.avatar + '" alt=""> <span>' + escapeHtml(name) + '</span>';
    } else {
      discordLoginText.textContent = name;
    }
    discordLoginBtn.classList.remove('hidden');
    discordLoginBtn.classList.add('logged-in');
    discordLoginBtn.removeAttribute('href');
    hideLoginScreen();
  }

  function setupLoginLinks() {
    const returnTo = location.href;
    if (discordLoginBtn) {
      discordLoginBtn.href = 'https://wordtycoon.live/api/auth/sso-check?returnTo=' + encodeURIComponent(returnTo);
    }
    if (discordLoginLink) {
      discordLoginLink.href = 'https://wordtycoon.live/api/auth/sso-check?returnTo=' + encodeURIComponent(returnTo);
    }
    if (githubLoginLink) {
      githubLoginLink.href = 'https://wordtycoon.live/auth/github?returnTo=' + encodeURIComponent(returnTo);
    }
  }

  function hideLoginScreen() {
    if (loginScreen) loginScreen.classList.add('hidden');
  }

  function showLoginScreen() {
    if (!loginScreen || currentUser) return;
    loginScreen.classList.remove('hidden');
    if (guestNameInput) {
      guestNameInput.value = guestProfile && guestProfile.displayName ? guestProfile.displayName : '';
    }
  }

  function continueAsGuest() {
    hideLoginScreen();
  }

  function chooseGuestName() {
    const chosenName = sanitizeGuestName(guestNameInput ? guestNameInput.value : '');
    guestProfile = saveGuestProfile({
      id: guestProfile && guestProfile.id ? guestProfile.id : createGuestId(),
      displayName: chosenName
    });
    hideLoginScreen();
  }

  function createGuestId() {
    return 'guest-' + Math.random().toString(36).slice(2, 10);
  }

  function sanitizeGuestName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  }

  function saveGuestProfile(profile) {
    const next = {
      id: profile && profile.id ? profile.id : createGuestId(),
      displayName: sanitizeGuestName(profile && profile.displayName)
    };
    localStorage.setItem(GUEST_KEY, JSON.stringify(next));
    return next;
  }

  function loadGuestProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
      if (stored && stored.id) {
        return {
          id: stored.id,
          displayName: sanitizeGuestName(stored.displayName)
        };
      }
    } catch (e) {}
    return saveGuestProfile({ id: createGuestId(), displayName: '' });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Word Bank Fetching ---
  async function loadWordData() {
    loadingOverlay.classList.remove('hidden');

    // Determine base URL for word bank API
    // In production (proxied through Chat Relay), use relative paths
    // The game is at /word1000/ and Chat Relay is at root /
    const baseURL = getBaseURL();

    try {
      // Fetch targets (all lengths)
      const targetsRes = await fetch(baseURL + '/api/word-bank/targets', { signal: AbortSignal.timeout(20000) });
      if (!targetsRes.ok) throw new Error('Failed to fetch targets');
      targets = await targetsRes.json();

      // Fetch dictionary for lengths 4-10
      const lengths = [4, 5, 6, 7, 8, 9, 10];
      const dictPromises = lengths.map(async (len) => {
        try {
          const res = await fetch(baseURL + '/api/word-bank/dictionary/' + len, { signal: AbortSignal.timeout(20000) });
          if (res.ok) {
            const words = await res.json();
            dictSets[String(len)] = new Set(words.map(w => w.toLowerCase()));
          }
        } catch (e) {
          console.warn('[SP] Failed to fetch dictionary for length ' + len);
        }
      });

      await Promise.all(dictPromises);

      // Ensure all targets are in their dictionary sets
      for (const [len, words] of Object.entries(targets)) {
        if (!dictSets[len]) dictSets[len] = new Set();
        for (const w of words) dictSets[len].add(w.toLowerCase());
      }

      dataReady = true;
      loadingOverlay.classList.add('hidden');

      // Disable length buttons that have no targets
      updateLengthButtons();

      // Helper to restore a game from a state object
      function restoreFromState(saved) {
        targetWord = saved.targetWord;
        wordLength = saved.wordLength;
        guesses = [];
        letterStates = saved.letterStates || {};
        gameOver = false;
        guessNumber = saved.guessNumber || 0;
        currentGameIsDaily = saved.isDaily || false;
        currentInput = '';

        if (lenToggle) lenToggle.textContent = wordLength;
        if (lengthButtons) {
          lengthButtons.querySelectorAll('.len-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.len) === wordLength);
          });
        }

        guessesEl.innerHTML = '';
        winOverlay.classList.add('hidden');
        renderEmptyRows();
        renderInputTiles();
        updateDailyBadge();

        for (const g of saved.guesses) {
          guesses.push(g);
          addGuessRow(g);
        }
        renderKeyboard();
      }

      function startGame() {
        console.log('[SP DEBUG] startGame called');
        console.log('[SP DEBUG] launchMode:', launchMode);
        console.log('[SP DEBUG] dailyData:', dailyData);
        console.log('[SP DEBUG] dailyPlayed:', dailyPlayed);
        // Try to restore a saved game
        let saved = loadGameState();
        console.log('[SP DEBUG] saved game:', saved ? (saved.isDaily ? 'daily' : 'non-daily') : 'null');
        // Don't restore a non-daily saved game if:
        // 1. In daily launch mode, OR
        // 2. Daily is available and hasn't been played yet (prioritize daily)
        const shouldPrioritizeDaily = dailyData && !dailyPlayed && dailyData.date;
        console.log('[SP DEBUG] shouldPrioritizeDaily:', shouldPrioritizeDaily);
        if (saved && !saved.isDaily && (launchMode === 'daily' || shouldPrioritizeDaily)) {
          console.log('[SP] Clearing non-daily saved game to prioritize daily');
          clearGameState();
          saved = null;
        }
        if (saved && !saved.gameOver && saved.guesses && saved.guesses.length > 0) {
          restoreFromState(saved);
        } else if (launchMode === 'daily' && currentUser && !loadDailyGameState()) {
          // In daily mode with no local state — try loading from server (cross-device)
          loadGameStateFromServer(function(serverState) {
            if (serverState && serverState.guesses && serverState.guesses.length > 0) {
              // Write to localStorage so the normal restore path works
              localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(serverState));
              console.log('[SP] Restored daily state from server');
            }
            if (saved) clearGameState();
            startNewGame();
          });
          return; // async path — startNewGame called in callback
        } else {
          if (saved) clearGameState();
          startNewGame();
        }
      }

      // Always wait for fetchDaily to complete before starting game
      // so dailyData is available and the daily puzzle loads by default
      fetchDaily(function() { startGame(); });

    } catch (err) {
      console.error('[SP] Failed to load word data:', err);
      loadingOverlay.querySelector('.loading-text').textContent =
        'Failed to load words. Refresh to retry.';
    }
  }

  function getBaseURL() {
    // If we're proxied through Chat Relay or the dedicated word5000.com domain,
    // the word bank API is at the root origin
    const loc = window.location;
    return loc.protocol + '//' + loc.host;
  }

  function getAuthBaseURL() {
      if (location.hostname === 'wordtycoon.live' || location.hostname === 'www.wordtycoon.live' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        return getBaseURL();
      }
    return 'https://wordtycoon.live';
  }

  function getSoloBasePath() {
      return '';
    }

  // --- Daily Word ---
  function fetchDaily(cb) {
    const x = new XMLHttpRequest();
      // Relative path: the daily word is served by the word1000 app itself, reached
      // under the current base (/game/word1000/api/sp/daily → proxied to :3018).
      // An absolute /api/sp/daily would hit chat-relay's origin, which has no such route (404).
      x.open('GET', 'api/sp/daily?length=' + wordLength, true);
    x.onload = function () {
      if (x.status === 200) {
        try {
          dailyData = JSON.parse(x.responseText);
          const localPlayed = localStorage.getItem(DAILY_KEY);
          // Check both localStorage AND server completions (dates are Edmonton timezone)
          dailyPlayed = (localPlayed === dailyData.date) || serverCompletedDates.has(dailyData.date);
          // Sync server knowledge to localStorage (cross-device)
          if (!dailyPlayed && serverCompletedDates.has(dailyData.date)) {
            dailyPlayed = true;
          }
          if (dailyPlayed && localPlayed !== dailyData.date) {
            localStorage.setItem(DAILY_KEY, dailyData.date);
          }
          console.log('[SP] Daily fetched:', dailyData.word, 'played:', dailyPlayed);
        } catch (e) { dailyData = null; }
      }
      if (cb) cb();
    };
    x.onerror = function () { dailyData = null; if (cb) cb(); };
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  function updateDailyBadge() {
    const badge = document.getElementById('daily-badge');
    if (!badge) return;
    if (currentGameIsDaily) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // --- Game Logic ---
  function startNewGame() {
    console.log('[SP DEBUG] startNewGame called');
    console.log('[SP DEBUG] wordLength:', wordLength);
    console.log('[SP DEBUG] dailyData:', dailyData ? dailyData.word : 'null');
    console.log('[SP DEBUG] dailyPlayed:', dailyPlayed);
    const pool = targets[String(wordLength)] || [];
    if (pool.length === 0) {
      showToast('No words available for length ' + wordLength);
      return;
    }

    clearGameState();

    // Check for a saved daily game at this length (user switched away and back)
    const savedDaily = loadDailyGameState();
    console.log('[SP DEBUG] savedDaily:', savedDaily ? 'yes' : 'no');
    if (savedDaily && savedDaily.wordLength === wordLength && savedDaily.guesses && savedDaily.guesses.length > 0) {
      // Restore daily game in progress
      targetWord = savedDaily.targetWord;
      guesses = [];
      letterStates = savedDaily.letterStates || {};
      gameOver = false;
      guessNumber = savedDaily.guessNumber || 0;
      currentGameIsDaily = true;
      currentInput = '';

      guessesEl.innerHTML = '';
      winOverlay.classList.add('hidden');
      renderEmptyRows();
      renderInputTiles();
      updateDailyBadge();

      // Replay each saved guess visually
      for (const g of savedDaily.guesses) {
        guesses.push(g);
        addGuessRow(g);
      }
      renderKeyboard();
      console.log('[SP] Restored DAILY game in progress');
      return;
    }

    // Use daily word if available and not yet completed
    console.log('[SP DEBUG] Checking daily conditions:', {
      hasDailyData: !!dailyData,
      dailyPlayed: dailyPlayed,
      dailyDate: dailyData ? dailyData.date : null,
      dailyLength: dailyData ? dailyData.length : null,
      wordLength: wordLength,
      lengthMatch: dailyData ? dailyData.length === wordLength : false
    });
    if (dailyData && !dailyPlayed && dailyData.date && dailyData.length === wordLength) {
      targetWord = dailyData.word.toUpperCase();
      dailyPlayed = true;  // prevent re-assignment this session
      currentGameIsDaily = true;
      console.log('[SP] Starting DAILY game with word:', targetWord);
    } else {
      targetWord = pool[Math.floor(Math.random() * pool.length)].toUpperCase();
      currentGameIsDaily = false;
      console.log('[SP] Starting RANDOM game with word:', targetWord);
    }

    guesses = [];
    currentInput = '';
    letterStates = {};
    gameOver = false;
    guessNumber = 0;
    manualColors = {};

    guessesEl.innerHTML = '';
    winOverlay.classList.add('hidden');
    renderEmptyRows();
    renderInputTiles();
    updateDailyBadge();
    renderKeyboard();
  }

  function renderEmptyRows() {
    guessesEl.innerHTML = '';
    for (let r = 0; r < MAX_GUESSES; r++) {
      const row = document.createElement('div');
      row.className = 'guess-row empty-row';
      row.dataset.rowIndex = r;

      const numEl = document.createElement('div');
      numEl.className = 'guess-num';
      numEl.textContent = r + 1;
      row.appendChild(numEl);

      const letters = document.createElement('div');
      letters.className = 'guess-letters';

      const pillBase = document.createElement('div');
      pillBase.className = 'pill-base';
      letters.appendChild(pillBase);

      const pillGlass = document.createElement('div');
      pillGlass.className = 'pill-glass';
      letters.appendChild(pillGlass);

      const pillSpec = document.createElement('div');
      pillSpec.className = 'pill-spec';
      letters.appendChild(pillSpec);

      for (let i = 0; i < wordLength; i++) {
        const tile = document.createElement('div');
        tile.className = 'letter-tile neutral';
        letters.appendChild(tile);
      }
      row.appendChild(letters);

      const counts = document.createElement('div');
      counts.className = 'guess-counts empty-counts';
      row.appendChild(counts);

      guessesEl.appendChild(row);
    }
  }

  function processGuess(guess) {
    if (gameOver || !dataReady) return;
    if (guess.length !== wordLength) return;

    const guessLower = guess.toLowerCase();

    // Validate against dictionary
    const dict = dictSets[String(wordLength)];
    if (!dict || !dict.has(guessLower)) {
      showToast('Not in word list');
      return;
    }

    // Check for duplicate guess
    if (guesses.some(g => g.word === guess)) {
      showToast('Already guessed');
      return;
    }

    guessNumber++;
    const target = targetWord;
    const len = wordLength;
    const used = Array(len).fill(false);
    const states = Array(len).fill(null);
    let correct = 0, present = 0, absent = 0;

    // Pass 1: exact matches
    for (let i = 0; i < len; i++) {
      if (guess[i] === target[i]) {
        states[i] = 'correct';
        used[i] = true;
        correct++;
      }
    }

    // Pass 2: present / absent
    for (let i = 0; i < len; i++) {
      if (states[i]) continue;
      let found = false;
      for (let j = 0; j < len; j++) {
        if (!used[j] && guess[i] === target[j]) {
          states[i] = 'present';
          used[j] = true;
          present++;
          found = true;
          break;
        }
      }
      if (!found) {
        states[i] = 'absent';
        absent++;
      }
    }

    // Display: only reveal red when ALL letters are absent
    const allAbsent = correct === 0 && present === 0;
    const displayStates = allAbsent
      ? guess.split('').map(() => 'absent')
      : guess.split('').map(() => 'neutral');

    // Keyboard: mark used letters, absent when entire word misses
    for (const letter of guess) {
      if (!letterStates[letter]) {
        letterStates[letter] = 'used';
      }
    }
    if (allAbsent) {
      for (const letter of guess) {
        if (letterStates[letter] !== 'inword') {
          letterStates[letter] = 'absent';
        }
      }
    }

    const guessData = {
      word: guess,
      correct,
      present,
      absent,
      displayStates,
      allAbsent,
      number: guessNumber,
    };

    guesses.push(guessData);
    addGuessRow(guessData);
    renderKeyboard();

    // Check win
    if (correct === len) {
      gameOver = true;
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      saveGameResult(true, guessNumber);
      reportLibraryWord(targetWord, 'word500-sp');
      setTimeout(() => showWin(), 400);
    } else if (guesses.length >= MAX_GUESSES) {
      // Out of guesses — loss
      gameOver = true;
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      saveGameResult(false, guessNumber);
      setTimeout(() => showLoss(), 400);
    } else {
      saveGameState();
      if (currentGameIsDaily) saveDailyGameState();
    }

    // Clear input
    currentInput = '';
    updateInputTiles();
  }

  // --- Guess Rendering ---
  function rightnessGradient(ratio) {
    const hue = Math.max(0, Math.min(120, ratio * 120));
    const top = `hsl(${hue}, 78%, 60%)`;
    const mid = `hsl(${hue}, 75%, 46%)`;
    const bot = `hsl(${hue}, 72%, 34%)`;
    return `linear-gradient(180deg, ${top} 0%, ${mid} 50%, ${bot} 100%)`;
  }

  function buildStatsTriangle(correct, present, absent) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'guess-triangle');
    svg.setAttribute('viewBox', '0 0 64 56');
    svg.setAttribute('aria-label', `${correct} correct, ${present} present, ${absent} absent`);

    const wedges = [
      { cls: 'tri-wedge-correct', points: '32,2 17,28 32,37 47,28' },
      { cls: 'tri-wedge-present', points: '2,54 32,54 32,37 17,28' },
      { cls: 'tri-wedge-absent',  points: '62,54 47,28 32,37 32,54' },
    ];
    wedges.forEach(w => {
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('class', w.cls);
      p.setAttribute('points', w.points);
      svg.appendChild(p);
    });

    const spokes = document.createElementNS(NS, 'path');
    spokes.setAttribute('class', 'tri-spokes');
    spokes.setAttribute('d', 'M32,37 L17,28 M32,37 L32,54 M32,37 L47,28');
    svg.appendChild(spokes);

    const outline = document.createElementNS(NS, 'polygon');
    outline.setAttribute('class', 'tri-outline');
    outline.setAttribute('points', '32,2 2,54 62,54');
    svg.appendChild(outline);

    [
      { cls: 't-correct', x: 32, y: 22, value: correct },
      { cls: 't-present', x: 19, y: 45, value: present },
      { cls: 't-absent',  x: 45, y: 45, value: absent },
    ].forEach(l => {
      if (!l.value) return;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', l.cls);
      t.setAttribute('x', l.x);
      t.setAttribute('y', l.y);
      t.textContent = l.value;
      svg.appendChild(t);
    });

    return svg;
  }

  function buildGuessRow(g) {
    const row = document.createElement('div');
    row.className = 'guess-row';
    const wordLen = (g.word || '').length || 1;
    const correct = g.correct || 0;
    const present = g.present || 0;
    const absent = g.absent || 0;
    if (g.allAbsent || (correct === 0 && present === 0)) row.classList.add('all-absent');
    if (correct === wordLen) row.classList.add('all-correct');

    // Guess number (hidden in SP via CSS)
    const numEl = document.createElement('div');
    numEl.className = 'guess-num';
    numEl.textContent = g.number;
    row.appendChild(numEl);

    // Liquid-glass pill — base + glass + spec + crisp letters
    const ratio = Math.max(0, Math.min(1, (correct + 0.5 * present) / wordLen));
    const letters = document.createElement('div');
    letters.className = 'guess-letters';
    letters.style.setProperty('--guess-gradient', rightnessGradient(ratio));

    const pillBase = document.createElement('div');
    pillBase.className = 'pill-base';
    letters.appendChild(pillBase);

    const pillGlass = document.createElement('div');
    pillGlass.className = 'pill-glass';
    letters.appendChild(pillGlass);

    const pillSpec = document.createElement('div');
    pillSpec.className = 'pill-spec';
    letters.appendChild(pillSpec);

    g.word.split('').forEach((letter, i) => {
      const tile = document.createElement('div');
      tile.className = 'letter-tile ' + (g.displayStates ? g.displayStates[i] : 'neutral');
      tile.textContent = letter;
      letters.appendChild(tile);
    });
    row.appendChild(letters);

    // Stats triangle — perches on pill right edge via CSS margin-left negative
    const counts = document.createElement('div');
    counts.className = 'guess-counts';
    counts.appendChild(buildStatsTriangle(correct, present, absent));
    row.appendChild(counts);

    return row;
  }

  function addGuessRow(g) {
    // Fill the next empty row
    const rowIndex = guesses.length - 1;
    const emptyRow = guessesEl.querySelector('.guess-row[data-row-index="' + rowIndex + '"]');
    if (emptyRow) {
      const newRow = buildGuessRow(g);
      newRow.dataset.rowIndex = rowIndex;
      emptyRow.replaceWith(newRow);
    } else {
      // Fallback: append if no matching empty row
      guessesEl.appendChild(buildGuessRow(g));
    }
  }

  // --- Input Tiles ---
  function renderInputTiles() {
    inputRow.innerHTML = '';
    for (let i = 0; i < wordLength; i++) {
      const tile = document.createElement('div');
      tile.className = 'input-tile';
      tile.id = 't' + i;
      inputRow.appendChild(tile);
    }
    updateInputTiles();
  }

  function updateInputTiles() {
    for (let i = 0; i < wordLength; i++) {
      const tile = document.getElementById('t' + i);
      if (!tile) continue;
      tile.textContent = currentInput[i] || '';
      tile.classList.toggle('filled', !!currentInput[i]);
    }
  }

  // --- Keyboard ---
  function accessibleKey(element, label) {
    element.setAttribute('role', 'button'); element.setAttribute('aria-label', label); element.tabIndex = 0;
    element.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); element.click(); } });
  }
  function renderKeyboard() {
    const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    keyboardEl.innerHTML = '';

    rows.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'keyboard-row';

      if (rowIdx === 2) {
        const back = document.createElement('div');
        back.className = 'key wide';
        back.textContent = '\u232B';
        back.dataset.key = 'BACK';
        accessibleKey(back, 'Backspace');
        rowEl.appendChild(back);
      }

      for (const letter of row) {
        const key = document.createElement('div');
        const state = letterStates[letter] || '';
        key.className = 'key' + (state ? ' ' + state : '');
        key.textContent = letter;
        key.dataset.key = letter;
        accessibleKey(key, letter);
        rowEl.appendChild(key);
      }

      if (rowIdx === 2) {
        const enter = document.createElement('div');
        enter.className = 'key wide enter-key';
        enter.textContent = 'ENTER';
        enter.dataset.key = 'ENTER';
        accessibleKey(enter, 'Enter');
        rowEl.appendChild(enter);
      }

      keyboardEl.appendChild(rowEl);
    });
  }

  // --- Length Buttons ---
  function updateLengthButtons() {
    if (!lengthButtons) return;
    const btns = lengthButtons.querySelectorAll('.len-btn');
    btns.forEach(btn => {
      const len = parseInt(btn.dataset.len);
      const pool = targets[String(len)] || [];
      if (pool.length === 0) {
        btn.classList.add('disabled');
      } else {
        btn.classList.remove('disabled');
      }
    });
  }

  // ─── Daily share ────────────────────────────────────
  function shareResult(text) {
    if (!text) return;
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {}, function () {
        try { window.prompt('Copy your result:', text); } catch (e) {}
      });
    } else {
      try { window.prompt('Copy your result:', text); } catch (e) {}
    }
  }

  // Winner identity for the shared WinCard: session user (Discord id lets
  // the card lazy-fetch the 🏆 wins chip + cosmetics/perks from the hub) or
  // the local guest profile (no identity → wins chip stays hidden).
  function buildWinCardWinner() {
    if (currentUser) {
      const w = {
        displayName: currentUser.globalName || currentUser.displayName || currentUser.username || 'You',
        username: currentUser.username || undefined,
        profilePic: currentUser.avatar || undefined,
      };
      // Always carry an identity: WinCard only lazy-fetches cosmetics when a
      // platform is present, so gating the whole block on a Discord login
      // left Google/GitHub players with a bare card. 'web' is the platform WT
      // stores a hub login under; discordId still drives the 🏆 wins chip.
      w.platform = 'web';
      w.platformUserId = currentUser.id;
      if ((currentUser.provider || 'discord') === 'discord') {
        w.discordId = currentUser.id;
      }
      return w;
    }
    return { displayName: (guestProfile && guestProfile.displayName) || 'Guest' };
  }

  // --- Win Card (shared Word Tycoon WinCard component) ---
  function showWin() {
    const shareTxt = '🟢 Word5000 Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
      ' — solved in ' + guessNumber + ' guess' + (guessNumber === 1 ? '' : 'es') + '\nhttps://word5000.com';
    const actions = [];
    if (currentGameIsDaily) {
      actions.push({ label: 'Share', onClick: function () { shareResult(shareTxt); } });
    }
    actions.push({ label: 'Play Again', primary: true, onClick: function () { WinCard.hide(); startNewGame(); } });

    WinCard.showSolo({
      game: 'word1000',
      gameName: 'Word 1000',
      word: targetWord,
      guessCount: guessNumber,
      winner: buildWinCardWinner(),
      actions: actions,
      // Daily mode used to auto-start a new random game 5s after winning.
      autoHideMs: launchMode === 'daily' ? 5000 : 0,
      onHide: launchMode === 'daily' ? function () { startNewGame(); } : undefined,
    });
  }

  function showLoss() {
    const bubble = winOverlay.querySelector('.win-bubble');
    if (bubble) bubble.classList.add('loss');
    winEmojiEl.textContent = '😔';
    winWordEl.textContent = targetWord;
    winDetailEl.textContent = 'The word was ' + targetWord;
    winOverlay.classList.remove('hidden');
  }

  function showDailyCompleted() {
    winEmojiEl.textContent = '✅';
    winWordEl.textContent = 'Daily Completed!';
    winDetailEl.textContent = "You've already finished today's daily challenge.";
    winOverlay.classList.remove('hidden');
    const btn = document.getElementById('play-again-btn');
    if (btn) { btn.textContent = '← Back to Portal'; btn.onclick = function() { window.location.href = '/me'; }; }
  }

  // --- Stats ---
  function getStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return { totalGames: 0, totalWins: 0, totalGuesses: 0, currentStreak: 0, bestStreak: 0, history: [] };
      return JSON.parse(raw);
    } catch {
      return { totalGames: 0, totalWins: 0, totalGuesses: 0, currentStreak: 0, bestStreak: 0, history: [] };
    }
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      console.warn('[SP] Failed to save stats:', e);
    }
  }

  // --- Game State Persistence ---
  function saveGameState() {
    try {
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify({
        targetWord,
        wordLength,
        guesses,
        letterStates,
        guessNumber,
        isDaily: currentGameIsDaily,
      }));
    } catch (e) {}
  }

  function loadGameState() {
    try {
      const raw = localStorage.getItem(GAME_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.targetWord || !s.wordLength) return null;
      return s;
    } catch (e) { return null; }
  }

  function clearGameState() {
    try { localStorage.removeItem(GAME_STATE_KEY); } catch (e) {}
  }

  // --- Daily Game State (preserved across length changes) ---
  function saveDailyGameState() {
    if (!currentGameIsDaily || gameOver) return;
    try {
      localStorage.setItem(DAILY_STATE_KEY, JSON.stringify({
        targetWord,
        wordLength,
        guesses,
        letterStates,
        guessNumber,
        dailyDate: dailyData ? dailyData.date : null,
      }));
      debouncedSaveToServer();
    } catch (e) {}
  }

  function loadDailyGameState() {
    try {
      const raw = localStorage.getItem(DAILY_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.targetWord || !s.wordLength || !s.dailyDate) return null;
      // Only restore if it's for today's daily
      if (dailyData && s.dailyDate !== dailyData.date) {
        clearDailyGameState();
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function clearDailyGameState() {
    try { localStorage.removeItem(DAILY_STATE_KEY); } catch (e) {}
    clearGameStateFromServer();
  }

  // ─── Server Game State Sync (cross-device) ──────────
  function saveGameStateToServer() {
    if (!currentUser || !currentGameIsDaily) return;
    var stateRaw = localStorage.getItem(DAILY_STATE_KEY);
    if (!stateRaw) return;
    var x = new XMLHttpRequest();
    x.open('POST', getAuthBaseURL() + '/api/sp-state/word500-sp', true);
    x.withCredentials = true;
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!currentUser) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', getAuthBaseURL() + '/api/sp-state/word500-sp', true);
    x.withCredentials = true;
    x.send();
  }

  function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', getAuthBaseURL() + '/api/sp-state/word500-sp', true);
    x.withCredentials = true;
    x.onload = function() {
      if (x.status === 200) {
        try {
          var data = JSON.parse(x.responseText);
          callback(data.ok && data.state ? data.state : null);
        } catch(e) { callback(null); }
      } else { callback(null); }
    };
    x.onerror = function() { callback(null); };
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  function debouncedSaveToServer() {
    if (stateSyncTimer) clearTimeout(stateSyncTimer);
    stateSyncTimer = setTimeout(saveGameStateToServer, 2000);
  }

  function saveGameResult(won, numGuesses) {
    // Mark daily as completed (win or loss — prevent replay exploit)
    if (currentGameIsDaily && dailyData && dailyData.date) {
      localStorage.setItem(DAILY_KEY, dailyData.date);
      saveServerCompletion(dailyData.date);  // sync to server (cross-device)
      console.log('[SP] Daily completed!');
    }

    const stats = getStats();
    stats.totalGames++;
    if (won) {
      stats.totalWins++;
      stats.totalGuesses += numGuesses;
      stats.currentStreak++;
      if (stats.currentStreak > stats.bestStreak) {
        stats.bestStreak = stats.currentStreak;
      }
    } else {
      stats.currentStreak = 0;
    }

    stats.history.push({
      word: targetWord,
      guessCount: numGuesses,
      won,
      length: wordLength,
      timestamp: Date.now(),
    });

    // Keep last 100 entries
    if (stats.history.length > 100) {
      stats.history = stats.history.slice(-100);
    }

    saveStats(stats);
  }

  function renderStats() {
    const stats = getStats();
    const winRate = stats.totalGames > 0 ? Math.round((stats.totalWins / stats.totalGames) * 100) : 0;
    const avgGuesses = stats.totalWins > 0 ? (stats.totalGuesses / stats.totalWins).toFixed(1) : '-';

    statsGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.totalGames}</div>
        <div class="stat-label">PLAYED</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${winRate}%</div>
        <div class="stat-label">WIN RATE</div>
      </div>
      <div class="stat-card">
        <div class="stat-value yellow">${avgGuesses}</div>
        <div class="stat-label">AVG GUESSES</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">${stats.bestStreak}</div>
        <div class="stat-label">BEST STREAK</div>
      </div>
    `;

    // History (newest first, max 20)
    const recent = [...stats.history].reverse().slice(0, 20);
    if (recent.length === 0) {
      statsHistory.innerHTML = '<div class="stats-empty">No games played yet</div>';
    } else {
      statsHistory.innerHTML = '';
      for (const h of recent) {
        const row = document.createElement('div');
        row.className = 'history-row';

        const word = document.createElement('span');
        word.className = 'history-word';
        word.textContent = h.word;

        const info = document.createElement('span');
        if (h.won) {
          info.className = 'history-guesses';
          info.textContent = h.guessCount + ' guess' + (h.guessCount !== 1 ? 'es' : '');
        } else {
          info.className = 'history-guesses history-loss';
          info.textContent = 'gave up';
        }

        row.appendChild(word);
        row.appendChild(info);
        statsHistory.appendChild(row);
      }
    }
  }

  // --- Library word reporting ---
  function reportLibraryWord(word, gameId) {
    if (!currentUser || !word) return;
    var x = new XMLHttpRequest();
    x.open('POST', getAuthBaseURL() + '/api/library/word', true);
    x.withCredentials = true;
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
      try {
        var data = JSON.parse(x.responseText);
        if (data.ok && data.isNew) showLibraryToast(word);
      } catch(e) {}
    };
    x.send(JSON.stringify({ word: word.toLowerCase(), game: gameId }));
  }

  function showLibraryToast(word) {
    if (!document.getElementById('library-toast-style')) {
      var style = document.createElement('style');
      style.id = 'library-toast-style';
      style.textContent = '.library-toast{position:fixed;top:20px;right:20px;background:linear-gradient(135deg,#1a0f00,#2d1f0a);border:1px solid #8b6914;border-radius:12px;padding:12px 20px;color:#f5deb3;font-size:14px;font-weight:600;z-index:10000;opacity:0;transform:translateX(50px);transition:opacity .3s,transform .3s;pointer-events:none;box-shadow:0 4px 20px rgba(139,105,20,.3)}.library-toast.show{opacity:1;transform:translateX(0)}.library-toast strong{color:#ffd700;letter-spacing:1px}';
      document.head.appendChild(style);
    }
    var toast = document.createElement('div');
    toast.className = 'library-toast';
    toast.innerHTML = '\uD83D\uDCDA Word Found! <strong>' + word.toUpperCase() + '</strong>';
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('show'); }, 10);
    setTimeout(function() {
      toast.classList.remove('show');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // --- Toast ---
  function showToast(msg) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.querySelector('.game-frame').appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // --- Letter tile color cycling ---
  function bindTileClicks() {
    guessesEl.addEventListener('click', (e) => {
      const tile = e.target.closest('.letter-tile');
      if (!tile) return;

      const current = COLOR_CYCLE.find(c => tile.classList.contains(c)) || 'neutral';
      const nextIdx = (COLOR_CYCLE.indexOf(current) + 1) % COLOR_CYCLE.length;
      const next = COLOR_CYCLE[nextIdx];

      COLOR_CYCLE.forEach(c => tile.classList.remove(c));
      tile.classList.add(next);

      tile.classList.add('tile-tap');
      setTimeout(() => tile.classList.remove('tile-tap'), 150);

      // Track for re-renders
      const row = tile.closest('.guess-row');
      const rowIdx = Array.from(guessesEl.children).indexOf(row);
      const tileIdx = Array.from(tile.parentNode.children).indexOf(tile);
      manualColors[rowIdx + '_' + tileIdx] = next;
    });
  }

  function reapplyManualColors() {
    Object.keys(manualColors).forEach(key => {
      const [rowIdx, tileIdx] = key.split('_').map(Number);
      const row = guessesEl.children[rowIdx];
      if (!row) return;
      const tile = row.querySelectorAll('.letter-tile')[tileIdx];
      if (!tile) return;
      COLOR_CYCLE.forEach(c => tile.classList.remove(c));
      tile.classList.add(manualColors[key]);
    });
  }

  // --- Events ---
  function bindEvents() {
    // Letter tile color cycling
    bindTileClicks();

    // Keyboard clicks
    keyboardEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.key');
      if (!btn || gameOver) return;
      const key = btn.dataset.key;

      if (key === 'BACK') {
        currentInput = currentInput.slice(0, -1);
        updateInputTiles();
      } else if (key === 'ENTER') {
        if (currentInput.length === wordLength) {
          processGuess(currentInput);
        }
      } else if (currentInput.length < wordLength) {
        currentInput += key;
        updateInputTiles();
      }
    });

    // Physical keyboard
    document.addEventListener('keydown', (e) => {
      // Don't capture if an overlay is visible (except win, which just needs Enter)
      if (!statsOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') statsOverlay.classList.add('hidden');
        return;
      }

      const key = e.key.toUpperCase();

      if (key === 'BACKSPACE') {
        e.preventDefault();
        currentInput = currentInput.slice(0, -1);
        updateInputTiles();
      } else if (key === 'ENTER') {
        e.preventDefault();
        if (gameOver) {
          startNewGame();
        } else if (currentInput.length === wordLength) {
          processGuess(currentInput);
        }
      } else if (/^[A-Z]$/.test(key) && !gameOver && currentInput.length < wordLength) {
        currentInput += key;
        updateInputTiles();
      }
    });

    // Length toggle (cycles through available lengths)
    if (lenToggle) {
      lenToggle.addEventListener('click', () => {
        // Save daily game state before switching away
        if (currentGameIsDaily && !gameOver) {
          saveDailyGameState();
        }

        // Find next available length
        const curIdx = LENGTHS.indexOf(wordLength);
        for (let i = 1; i <= LENGTHS.length; i++) {
          const nextLen = LENGTHS[(curIdx + i) % LENGTHS.length];
          const pool = targets[String(nextLen)] || [];
          if (pool.length > 0) {
            wordLength = nextLen;
            lenToggle.textContent = wordLength;
            startNewGame();
            return;
          }
        }
      });
    }

    // Legacy length buttons (if present)
    if (lengthButtons) {
      lengthButtons.addEventListener('click', (e) => {
        const btn = e.target.closest('.len-btn');
        if (!btn || btn.classList.contains('disabled')) return;
        const newLen = parseInt(btn.dataset.len);
        if (newLen === wordLength && !gameOver) return;
        if (currentGameIsDaily && !gameOver) saveDailyGameState();
        lengthButtons.querySelectorAll('.len-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wordLength = newLen;
        if (lenToggle) lenToggle.textContent = wordLength;
        startNewGame();
      });
    }

    // Play again
    document.getElementById('play-again-btn').addEventListener('click', () => {
      startNewGame();
    });

    if (guestPlayBtn) {
      guestPlayBtn.addEventListener('click', chooseGuestName);
    }

    if (guestNameInput) {
      guestNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          chooseGuestName();
        }
      });
    }

    if (loginCloseBtn) {
      loginCloseBtn.addEventListener('click', continueAsGuest);
    }

    // Stats button
    document.getElementById('stats-btn').addEventListener('click', () => {
      renderStats();
      statsOverlay.classList.remove('hidden');
    });

    // Stats close
    document.getElementById('stats-close').addEventListener('click', () => {
      statsOverlay.classList.add('hidden');
    });

    // Close stats on backdrop click
    statsOverlay.addEventListener('click', (e) => {
      if (e.target === statsOverlay) {
        statsOverlay.classList.add('hidden');
      }
    });

    // Reset colors — tap "WORD5000" title to clear manual tile colors
    const titleText = document.querySelector('.title-text');
    if (titleText) {
      titleText.addEventListener('click', () => {
        manualColors = {};
        const rows = guessesEl.querySelectorAll('.guess-row:not(.empty-row)');
        rows.forEach((row) => {
          const idx = parseInt(row.dataset.rowIndex);
          const g = guesses[idx];
          if (!g) return;
          const tiles = row.querySelectorAll('.letter-tile');
          tiles.forEach((tile, t) => {
            COLOR_CYCLE.forEach(c => tile.classList.remove(c));
            tile.classList.add(g.displayStates ? g.displayStates[t] : 'neutral');
          });
        });
      });
    }
  }

  // --- Boot ---
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else void init();
})();
