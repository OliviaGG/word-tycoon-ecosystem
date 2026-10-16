// ===== Viewport Scaling =====
// Designed for baseWidth (380px). Larger viewports scale proportionally
// so the game looks identical at any resolution (e.g. 1140×1800 = 3× scale).
(function () {
  var BASE = 380;
  var actualW = window.innerWidth;
  var actualH = window.innerHeight;
  var scale = actualW / BASE;

  // Expose effective viewport for other scripts (coin-reward, win-effects)
  var baseH = Math.round(actualH / scale);
  window.__gameScale = scale;
  window.__gameViewport = { width: BASE, height: baseH };

  if (Math.abs(scale - 1) > 0.01) {
    var html = document.documentElement;
    html.style.width = BASE + 'px';
    html.style.height = baseH + 'px';
    html.style.overflow = 'hidden';
    html.style.transformOrigin = '0 0';
    html.style.transform = 'scale(' + scale + ')';
  }

  // Set CSS custom properties for base dimensions (used by animations)
  document.documentElement.style.setProperty('--base-width', BASE + 'px');
  document.documentElement.style.setProperty('--base-height', baseH + 'px');
})();

// Load viewer cosmetic visibility preferences
try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

(() => {
  const socket = io();
  if (window.CoinReward) CoinReward.init(socket);

  // DOM refs
  const guessesEl = document.getElementById('guesses');
  const keyboardEl = document.getElementById('keyboard');
  const winOverlay = document.getElementById('win-overlay');
  const winBubble = winOverlay ? winOverlay.querySelector('.win-bubble') : null;
  const winWordEl = document.getElementById('win-word');
  const winNameEl = document.getElementById('win-name');
  const winPicEl = document.getElementById('win-pic');
  const winDetailEl = document.getElementById('win-detail');
  const lastWinnerEl = document.getElementById('last-winner');

  // State
  let letterStates = {};
  let gameStartTime = Date.now();
  let guessCount = 0;
  let jackpotInterval = null;
  let winHistory = [];
  const jackpotAmountEl = document.getElementById('jackpot-amount');
  const jackpotBar = document.getElementById('jackpot-bar');

  const AVATAR_FALLBACK = '/portal/img/logo.png';
  function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
  }

  // Platform colors for fallback avatars
  const PLATFORM_COLORS = {
    tiktok: '#69C9D0',
    youtube: '#FF0000',
    discord: '#5865F2',
    test: '#9147FF',
    unknown: '#9147FF',
  };

  // === Jackpot ===

  function calculatePot(numGuesses, startTime) {
    const seconds = (Date.now() - startTime) / 1000;

    // Guess bonus: 10 coins per guess up to 100, then exponential
    let guessBonus;
    if (numGuesses <= 100) {
      guessBonus = numGuesses * 10;
    } else {
      guessBonus = 1000 * Math.pow(numGuesses / 100, 1.5);
    }

    // Time bonus: linear up to 600s (10 min), then exponential
    let timeBonus;
    if (seconds <= 600) {
      timeBonus = (seconds / 600) * 1000;
    } else {
      timeBonus = 1000 * Math.pow(seconds / 600, 1.5);
    }

    return 300 + Math.round(guessBonus + timeBonus);
  }

  function formatPot(n) {
    return n.toLocaleString();
  }

  function updateJackpot() {
    const pot = calculatePot(guessCount, gameStartTime);
    if (jackpotAmountEl) jackpotAmountEl.textContent = formatPot(pot);
  }

  function bumpJackpot() {
    if (!jackpotBar) return;
    jackpotBar.classList.remove('bump');
    void jackpotBar.offsetWidth; // force reflow
    jackpotBar.classList.add('bump');
    setTimeout(() => jackpotBar.classList.remove('bump'), 350);
  }

  function startJackpotTicker() {
    if (jackpotInterval) clearInterval(jackpotInterval);
    updateJackpot();
    jackpotInterval = setInterval(updateJackpot, 1000);
  }

  // === Rendering ===

  function buildGuessRow(g) {
    const row = document.createElement('div');
    row.className = 'guess-row';
    if (g.allAbsent) row.classList.add('all-absent');

    // Player pic only (no name)
    const player = document.createElement('div');
    player.className = 'guess-player';
    if (g.isFanClub || (Array.isArray(g.badges) && g.badges.indexOf('fan-club') !== -1)) {
      player.classList.add('has-fan-club-badge');
    }

    const img = document.createElement('img');
    img.src = resolveAvatar(g.profilePic);
    img.className = 'player-pic';
    img.alt = g.displayName;
    img.onerror = function () { this.onerror = null; this.src = AVATAR_FALLBACK; };
    player.appendChild(img);

    // Letters
    const letters = document.createElement('div');
    letters.className = 'guess-letters';
    g.word.split('').forEach((letter, i) => {
      const tile = document.createElement('div');
      tile.className = 'letter-tile ' + (g.displayStates[i] || 'neutral');
      tile.textContent = letter;
      letters.appendChild(tile);
    });

    // Counts
    const counts = document.createElement('div');
    counts.className = 'guess-counts';

    const cc = document.createElement('span');
    cc.className = 'count count-correct' + (g.correct === 0 ? ' zero' : '');
    cc.textContent = g.correct;

    const cp = document.createElement('span');
    cp.className = 'count count-present' + (g.present === 0 ? ' zero' : '');
    cp.textContent = g.present;

    const ca = document.createElement('span');
    ca.className = 'count count-absent' + (g.absent === 0 ? ' zero' : '');
    ca.textContent = g.absent;

    counts.appendChild(cc);
    counts.appendChild(cp);
    counts.appendChild(ca);

    row.appendChild(player);
    row.appendChild(letters);
    row.appendChild(counts);

    const avatarEl = player.querySelector('.player-pic') || player.querySelector('.player-pic-fb');
    if (avatarEl) applyCosmetics({ avatarEl, avatarSize: 32 }, g.cosmetics);

    return row;
  }

  function createFallback(name, platform) {
    const fb = document.createElement('div');
    fb.className = 'player-pic-fb';
    fb.style.backgroundColor = PLATFORM_COLORS[platform] || PLATFORM_COLORS.unknown;
    fb.textContent = (name || '?')[0].toUpperCase();
    return fb;
  }

  function addGuessRow(g) {
    const row = buildGuessRow(g);
    guessesEl.prepend(row);

    // Update local letter states from guess
    if (g.letterStates) {
      letterStates = { ...g.letterStates };
    }

    // Scroll to top (newest first)
    const wrapper = guessesEl.parentElement;
    wrapper.scrollTop = 0;
  }

  function getWinCountForUser(platformUserId) {
    if (!platformUserId || !winHistory.length) return 0;
    return winHistory.filter(function (h) {
      return h.winner && h.winner.platformUserId === platformUserId;
    }).length;
  }

  function renderLastWinner(data) {
    if (!data) {
      lastWinnerEl.innerHTML = '';
      return;
    }

    const info = document.createElement('div');
    info.className = 'last-winner-info';

    // Avatar wrapper (for win badge positioning)
    const picWrap = document.createElement('div');
    picWrap.className = 'last-winner-pic-wrap';
    if (data.isFanClub || (Array.isArray(data.badges) && data.badges.indexOf('fan-club') !== -1)) {
      picWrap.classList.add('has-fan-club-badge');
    }

    const img = document.createElement('img');
    img.src = resolveAvatar(data.profilePic);
    img.className = 'last-winner-pic';
    img.alt = data.displayName;
    img.onerror = function () { this.onerror = null; this.src = AVATAR_FALLBACK; };
    picWrap.appendChild(img);

    // Win badge on profile pic
    const totalWins = data.totalWins || getWinCountForUser(data.platformUserId);
    if (totalWins > 0) {
      const badge = document.createElement('span');
      badge.className = 'win-badge';
      badge.textContent = totalWins;
      picWrap.appendChild(badge);
    }

    info.appendChild(picWrap);

    // Text wrapper (name above word)
    const textWrap = document.createElement('div');
    textWrap.className = 'last-winner-text';

    // Name
    const name = document.createElement('span');
    name.className = 'last-winner-name';
    name.textContent = data.displayName;
    textWrap.appendChild(name);

    // Word
    const word = document.createElement('span');
    word.className = 'last-winner-word';
    word.textContent = data.word;
    textWrap.appendChild(word);

    info.appendChild(textWrap);

    lastWinnerEl.innerHTML = '';
    lastWinnerEl.appendChild(info);

    const avatarEl = info.querySelector('.last-winner-pic') || info.querySelector('.last-winner-pic-fb');
    applyCosmetics({ wordEl: word, nameEl: name, avatarEl, avatarSize: 28, titleContainer: name }, data.cosmetics);
  }

  function renderKeyboard() {
    const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    keyboardEl.innerHTML = '';

    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'keyboard-row';

      for (const letter of row) {
        const key = document.createElement('div');
        const state = letterStates[letter] || '';
        key.className = 'key' + (state ? ' ' + state : '');
        key.textContent = letter;
        rowEl.appendChild(key);
      }

      keyboardEl.appendChild(rowEl);
    });
  }

  function clearGame() {
    guessesEl.innerHTML = '';
    letterStates = {};
    renderKeyboard();
    winOverlay.classList.add('hidden');
  }

  function showWin(data) {
    // Profile pic with win badge
    const totalWins = data.totalWins || getWinCountForUser(data.winner.platformUserId);
    const badgeHtml = totalWins > 0 ? '<span class="win-badge win-badge-lg">' + totalWins + '</span>' : '';
    const _w = data.winner || {};
    if (winPicEl) winPicEl.classList.toggle('has-fan-club-badge', !!(_w.isFanClub || (Array.isArray(_w.badges) && _w.badges.indexOf('fan-club') !== -1)));

    winPicEl.innerHTML = '<img src="' + resolveAvatar(data.winner.profilePic).replace(/"/g, '&quot;') + '" alt="" onerror="this.onerror=null;this.src=\'' + AVATAR_FALLBACK + '\'">' + badgeHtml;

    // Name
    winNameEl.textContent = data.winner.displayName;
    winNameEl.style.cssText = '';

    // Word
    winWordEl.textContent = data.word;
    winWordEl.style.cssText = '';

    // Detail with pot amount
    const potText = data.pot ? formatPot(data.pot) + ' coins' : '';
    const guessText = 'Found in ' + data.guessCount + ' guess' + (data.guessCount !== 1 ? 'es' : '');
    winDetailEl.textContent = [potText, guessText].filter(Boolean).join(' \u2022 ');

    // Cosmetics
    winNameEl.querySelectorAll('.cosmetic-title').forEach(el => el.remove());
    // Reset hero badge surface
    if (winBubble) { winBubble.style.background = ''; winBubble.style.backgroundSize = ''; winBubble.style.animation = ''; }
    if (data.winner?.cosmetics) {
      const avatarEl = winPicEl.querySelector('img') || winPicEl;
      applyCosmetics({ wordEl: winWordEl, nameEl: winNameEl, avatarEl, avatarSize: 160, titleContainer: winNameEl, surfaceEl: winBubble }, data.winner.cosmetics);
    }
    winOverlay.classList.remove('hidden');
  }

  // === Socket Events ===

  socket.on('game-state', (data) => {
    guessesEl.innerHTML = '';
    letterStates = data.letterStates || {};

    // Sync win history
    if (data.winHistory) winHistory = data.winHistory;

    // Sync jackpot state
    if (data.gameStartTime) gameStartTime = data.gameStartTime;
    guessCount = data.guesses ? data.guesses.length : 0;
    startJackpotTicker();

    // Render existing guesses (newest at top)
    const recent = [...data.guesses].reverse();
    recent.forEach((g) => {
      const row = buildGuessRow(g);
      row.style.animation = 'none';
      guessesEl.appendChild(row);
    });

    renderKeyboard();

    // Render last winner if available
    if (data.lastWinner) {
      renderLastWinner(data.lastWinner);
    }
  });

  socket.on('new-game', (data) => {
    clearGame();
    if (data && data.gameStartTime) gameStartTime = data.gameStartTime;
    else gameStartTime = Date.now();
    guessCount = 0;
    startJackpotTicker();
    // Three.js event hook
    if (window.ThreeManager && window.ThreeManager.onGameEvent) {
      window.ThreeManager.onGameEvent('new-game', data);
    }
  });

  socket.on('guess', (data) => {
    addGuessRow(data);
    renderKeyboard();
    guessCount++;
    updateJackpot();
    bumpJackpot();
    // Three.js event hook
    if (window.ThreeManager && window.ThreeManager.onGameEvent) {
      window.ThreeManager.onGameEvent('guess', data);
    }
  });

  socket.on('game-over', (data) => {
    // Stop jackpot ticker on game end
    if (jackpotInterval) { clearInterval(jackpotInterval); jackpotInterval = null; }

    // Add this win to local history for badge display
    if (data.winner) {
      winHistory.push({
        winner: {
          displayName: data.winner.displayName,
          platform: data.winner.platform,
          platformUserId: data.winner.platformUserId,
        },
        word: data.word,
        guessCount: data.guessCount,
        timestamp: Date.now(),
      });
    }

    // Three.js event hook
    if (window.ThreeManager && window.ThreeManager.onGameEvent) {
      window.ThreeManager.onGameEvent('game-over', data);
    }

    const totalDelay = 600;
    setTimeout(() => {
      showWin(data);
      // Trigger win effect particle animation
      if (data.winner && data.winner.cosmetics && data.winner.cosmetics.win_effect && window.playWinEffect) {
        window.playWinEffect(data.winner.cosmetics.win_effect);
      }
    }, totalDelay);

    // Update last winner
    renderLastWinner({
      displayName: data.winner.displayName,
      profilePic: data.winner.profilePic,
      platform: data.winner.platform,
      platformUserId: data.winner.platformUserId,
      word: data.word,
      totalWins: data.totalWins,
      cosmetics: data.winner.cosmetics,
    });

    // Auto-hide after a few seconds (new game will clear it)
    setTimeout(() => {
      winOverlay.classList.add('hidden');
    }, 4000);
  });

  // --- Cosmetics ---
  // Scale px values in CSS strings proportionally to avatar size.
  // Reference size: 80px — cosmetic values are authored for this baseline.
  var COSMETIC_REF_SIZE = 80;
  // The shared ring/word applier + keyframes live on the relay, so every
  // game renders a cosmetic identically. Loaded from there: no game HTML
  // and no nginx allowlist entry has to change.
  function pfpxHubBase() {
    var h = (window.location && window.location.hostname) || '';
    return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3000' : 'https://wordtycoon.live';
  }
  var _pfpxQueue = [];
  function _pfpxFlush() {
    if (!window.PfpCosmetics) return;
    var q = _pfpxQueue.splice(0);
    for (var i = 0; i < q.length; i++) {
      if (q[i][0] && q[i][0].isConnected) pfpxApply(q[i][0], q[i][1], q[i][2]);
    }
  }
  (function () {
    try {
      var base = pfpxHubBase();
      if (!document.querySelector('link[href*="cosmetics-fx.css"]')) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = base + '/css/cosmetics-fx.css?v=2';
        document.head.appendChild(l);
      }
      if (window.PfpCosmetics) return;
      var ex = document.querySelector('script[src*="pfp-cosmetics.js"]');
      if (ex) { ex.addEventListener('load', _pfpxFlush); return; }
      var sc = document.createElement('script');
      sc.src = base + '/js/pfp-cosmetics.js?v=15';
      sc.addEventListener('load', _pfpxFlush);
      document.head.appendChild(sc);
    } catch (e) { /* older CEF */ }
  })();
  function pfpxApply(avatarEl, shellEl, cos) {
    if (!avatarEl || !cos) return;
    if (!window.PfpCosmetics) { _pfpxQueue.push([avatarEl, shellEl, cos]); return; }
    window.PfpCosmetics.apply(avatarEl, shellEl || avatarEl.parentElement || avatarEl, cos);
  }
  function scaleCosmeticPx(cssValue, avatarSize) {
    if (!cssValue || !avatarSize || avatarSize <= 0) return cssValue;
    var scale = avatarSize / COSMETIC_REF_SIZE;
    if (Math.abs(scale - 1) < 0.05) return cssValue; // skip if ~1x
    return cssValue.replace(/(\d+(?:\.\d+)?)px/g, function(m, n) {
      return Math.max(1, Math.round(parseFloat(n) * scale)) + 'px';
    });
  }

  function applyCosmetics(els, cos) {
    if (!cos) return;
    var vis = window.__COSMETIC_VISIBILITY;
    if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }

    // Get avatar size for proportional border/glow scaling
    // Use explicit avatarSize if provided (element may not be in DOM yet)
    var avatarSize = els.avatarSize || (els.avatarEl ? (els.avatarEl.offsetWidth || els.avatarEl.clientWidth || 0) : 0);

    if (cos.name_color && els.nameEl) {
      if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
      if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
    }
    if (cos.name_glow && els.nameEl) {
      if (cos.name_glow.textShadow) els.nameEl.style.textShadow = cos.name_glow.textShadow;
      if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
    }
    // ring + glow via the shared applier
    if (els.avatarEl) pfpxApply(els.avatarEl, els.avatarEl.parentElement || els.avatarEl, cos);
    if (cos.title && cos.title.title && els.titleContainer) {
      var titleSpan = document.createElement('span');
      titleSpan.className = 'cosmetic-title';
      titleSpan.textContent = ' [' + cos.title.title + ']';
      if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
      if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
      if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
      els.titleContainer.appendChild(titleSpan);
    }
    // word_color / word_glow are no longer a permanent tint — the word
    // spawns wearing the finder's colour and settles back to default.
    if (els.wordEl && window.PfpCosmetics) window.PfpCosmetics.spawnWord(els.wordEl, cos);
    // Hero badge — background gradient on surface element
    if (cos.hero_badge && els.surfaceEl) {
      if (cos.hero_badge.background) {
        els.surfaceEl.style.background = cos.hero_badge.background;
        if (cos.hero_badge.backgroundSize) els.surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
        if (cos.hero_badge.animation) els.surfaceEl.style.animation = cos.hero_badge.animation;
      }
    }
  }

  // Initial keyboard render
  renderKeyboard();
})();
