// ===== Betwixt Play Page =====
// Mobile-first single-player interface with QWERTY keyboard

var socket = io();

// Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
window.__COSMETIC_VISIBILITY = {};
try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

// DOM Elements
var lowerTiles = document.getElementById('lower-tiles');
var upperTiles = document.getElementById('upper-tiles');
var lowerPfp = document.getElementById('lower-pfp');
var upperPfp = document.getElementById('upper-pfp');
var lowerBoundary = document.getElementById('lower-boundary');
var upperBoundary = document.getElementById('upper-boundary');
var confirmedRow = document.getElementById('confirmed-row');
var alphaRow1 = document.getElementById('alpha-row-1');
var alphaRow2 = document.getElementById('alpha-row-2');
var keyboardEl = document.getElementById('keyboard');
var errorToast = document.getElementById('error-toast');
var winOverlay = document.getElementById('win-overlay');
var winModal = winOverlay ? winOverlay.querySelector('.win-modal') : null;
var winPic = document.getElementById('win-pic');
var winName = document.getElementById('win-name');
var winWord = document.getElementById('win-word');
var winCount = document.getElementById('win-count');
var winCountdown = document.getElementById('win-countdown');
var wordSizeToggle = document.getElementById('word-size-toggle');
var guessCounterEl = document.getElementById('guess-counter');
var dailyBadge = document.getElementById('daily-badge');
var frenzyBadge = document.getElementById('frenzy-badge');
var frenzyMultEl = document.getElementById('frenzy-mult');

// State
var currentState = null;
var currentInput = '';
var currentWordLength = 5;
var winHistory = [];
var countdownInterval = null;
var errorTimeout = null;
var submitCooldown = false;
var AUTO_RESTART_SECONDS = 10;
var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Available word lengths for toggle
var WORD_LENGTHS = [4, 5, 6, 7, 8];

// ===== Build Alphabet (2 rows: A-M, N-Z) =====
function buildAlphabet() {
  alphaRow1.innerHTML = '';
  alphaRow2.innerHTML = '';
  LETTERS.forEach(function (letter, i) {
    var tile = document.createElement('div');
    tile.className = 'alpha-tile possible';
    tile.id = 'alpha-' + letter;
    tile.textContent = letter;
    if (i < 13) {
      alphaRow1.appendChild(tile);
    } else {
      alphaRow2.appendChild(tile);
    }
  });
}
buildAlphabet();

// ===== Word Size Toggle =====
function buildWordSizeToggle() {
  wordSizeToggle.innerHTML = '';
  WORD_LENGTHS.forEach(function (len) {
    var btn = document.createElement('button');
    btn.className = 'ws-btn' + (len === currentWordLength ? ' active' : '');
    btn.textContent = len;
    btn.setAttribute('type', 'button');
    btn.addEventListener('click', function () {
      if (len === currentWordLength) return;
      changeWordLength(len);
    });
    wordSizeToggle.appendChild(btn);
  });
}
buildWordSizeToggle();

function updateWordSizeToggle() {
  var btns = wordSizeToggle.querySelectorAll('.ws-btn');
  btns.forEach(function (btn) {
    var len = parseInt(btn.textContent);
    if (len === currentWordLength) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function changeWordLength(len) {
  // Use socket event instead of fetch — avoids Chat Relay proxy body-parsing issue
  socket.emit('change-word-length', { wordLength: len });
}

function updateGuessCounter() {
  if (!guessCounterEl || !currentState) return;
  guessCounterEl.textContent = currentState.guessCount || 0;
}

// ===== Build QWERTY Keyboard =====
var KB_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']
];

function buildKeyboard() {
  keyboardEl.innerHTML = '';
  KB_ROWS.forEach(function (row) {
    var rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    row.forEach(function (key) {
      var btn = document.createElement('button');
      btn.className = 'kb-key';
      btn.setAttribute('type', 'button');

      if (key === 'ENTER') {
        btn.classList.add('wide', 'enter');
        btn.textContent = 'GO';
        btn.addEventListener('click', function () { handleKeyPress('ENTER'); });
      } else if (key === '⌫') {
        btn.classList.add('wide', 'backspace');
        btn.textContent = '⌫';
        btn.addEventListener('click', function () { handleKeyPress('BACK'); });
      } else {
        btn.textContent = key;
        btn.addEventListener('click', function () { handleKeyPress(key); });
      }

      rowEl.appendChild(btn);
    });
    keyboardEl.appendChild(rowEl);
  });
}
buildKeyboard();

// ===== Keyboard Input =====
function handleKeyPress(key) {
  if (currentState && currentState.isWon) return;

  if (key === 'ENTER') {
    submitGuess();
  } else if (key === 'BACK') {
    if (currentInput.length > 0) {
      currentInput = currentInput.slice(0, -1);
      updateConfirmedRowWithTyping();
    }
  } else if (/^[A-Z]$/.test(key)) {
    if (currentInput.length < currentWordLength) {
      currentInput += key;
      updateConfirmedRowWithTyping();
    }
  }
}

// Physical keyboard support
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Enter') {
    e.preventDefault();
    handleKeyPress('ENTER');
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    handleKeyPress('BACK');
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    handleKeyPress(e.key.toUpperCase());
  }
});

// ===== Boundary Tiles =====
function createBoundaryTiles(container, word, isMask) {
  container.innerHTML = '';
  var letters = word.toUpperCase().split('');
  letters.forEach(function (ch) {
    var tile = document.createElement('div');
    tile.className = 'bnd-tile' + (isMask ? ' masked' : '');
    tile.textContent = isMask ? '-' : ch;
    container.appendChild(tile);
  });
}

function updateBoundaries(state) {
  if (!state) return;
  var lower = state.currentLower;
  var upper = state.currentUpper;
  var isMaskLower = /^x+$/i.test(lower);
  var isMaskUpper = /^x+$/i.test(upper);

  createBoundaryTiles(lowerTiles, lower, isMaskLower);
  createBoundaryTiles(upperTiles, upper, isMaskUpper);

  renderPfp(lowerPfp, state.lowerBoundaryUser);
  renderPfp(upperPfp, state.upperBoundaryUser);

  // Pop animation
  lowerBoundary.classList.add('pop');
  upperBoundary.classList.add('pop');
  setTimeout(function () {
    lowerBoundary.classList.remove('pop');
    upperBoundary.classList.remove('pop');
  }, 300);
}

// ===== Profile Picture =====
function renderPfp(container, user) {
  container.innerHTML = '';
  var _isFC = !!(user && (user.isFanClub || (Array.isArray(user.badges) && user.badges.indexOf('fan-club') !== -1)));
  container.classList.toggle('has-fan-club-badge', _isFC);
  if (!user) {
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');
  if (user.profilePic) {
    var letter = ((user.displayName || '?')[0]).toUpperCase();
    var img = document.createElement('img');
    img.src = user.profilePic;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.crossOrigin = 'anonymous';
    img.onerror = function () {
      container.innerHTML = '<span class="pfp-letter">' + letter + '</span>';
    };
    container.appendChild(img);
  } else {
    var letter = ((user.displayName || '?')[0]).toUpperCase();
    var span = document.createElement('span');
    span.className = 'pfp-letter';
    span.textContent = letter;
    container.appendChild(span);
  }
}

// ===== Confirmed Letters =====
function updateConfirmedRow(state) {
  if (currentInput.length > 0) {
    updateConfirmedRowWithTyping();
    return;
  }

  confirmedRow.innerHTML = '';
  var len = state.wordLength;
  var confirmed = state.confirmedLetters || [];

  for (var i = 0; i < len; i++) {
    var tile = document.createElement('div');
    tile.className = 'confirmed-tile';
    if (confirmed[i]) {
      tile.classList.add('confirmed');
      tile.textContent = confirmed[i];
    } else {
      tile.textContent = '';
    }
    confirmedRow.appendChild(tile);
  }
}

function updateConfirmedRowWithTyping() {
  if (!currentState) return;
  confirmedRow.innerHTML = '';

  var len = currentState.wordLength;
  var confirmed = currentState.confirmedLetters || [];

  for (var i = 0; i < len; i++) {
    var tile = document.createElement('div');
    tile.className = 'typing-tile';

    if (i < currentInput.length) {
      tile.classList.add('active');
      tile.textContent = currentInput[i];
    } else if (confirmed[i]) {
      tile.className = 'confirmed-tile confirmed';
      tile.textContent = confirmed[i];
      tile.style.opacity = '0.4';
    } else {
      tile.classList.add('empty');
      tile.textContent = '';
    }
    confirmedRow.appendChild(tile);
  }
}

// ===== Alphabet =====
function updateAlphabet(state) {
  if (!state) return;

  var lower = state.currentLower.toLowerCase();
  var upper = state.currentUpper.toLowerCase();
  var isMaskLower = /^x+$/.test(lower);
  var isMaskUpper = /^x+$/.test(upper);

  // Find the first position where bounds differ
  var pos = 0;
  if (!isMaskLower && !isMaskUpper) {
    while (pos < lower.length && pos < upper.length && lower[pos] === upper[pos]) {
      pos++;
    }
    if (pos >= lower.length || pos >= upper.length) pos = 0;
  }

  var lowerChar = isMaskLower ? 'a' : lower[pos] || 'a';
  var upperChar = isMaskUpper ? 'z' : upper[pos] || 'z';

  // Update position label
  var alphaEl = document.getElementById('alphabet');
  var label = document.getElementById('alpha-pos-label');
  if (pos > 0 && !isMaskLower && !isMaskUpper) {
    if (!label) {
      label = document.createElement('div');
      label.id = 'alpha-pos-label';
      label.className = 'alpha-pos-label';
      alphaEl.insertBefore(label, alphaEl.firstChild);
    }
    label.textContent = 'LETTER ' + (pos + 1);
  } else if (label) {
    label.remove();
  }

  LETTERS.forEach(function (letter) {
    var tile = document.getElementById('alpha-' + letter);
    var l = letter.toLowerCase();
    var status;

    if (isMaskLower && isMaskUpper) {
      status = 'possible';
    } else if (l < lowerChar) {
      status = 'eliminated';
    } else if (l > upperChar) {
      status = 'eliminated';
    } else if (l === lowerChar && !isMaskLower) {
      status = 'edge';
    } else if (l === upperChar && !isMaskUpper) {
      status = 'edge';
    } else {
      status = 'possible';
    }

    tile.className = 'alpha-tile ' + status;
  });
}

// ===== Cosmetics =====
var WC_OUTLINE = '7px 7px 3px #000, -7px -7px 3px #000, 7px -7px 3px #000, -7px 7px 3px #000, 0 7px 3px #000, 0 -7px 3px #000, 7px 0 3px #000, -7px 0 3px #000';
function ensureRoundFilter() {
  if (!document.getElementById('wc-round')) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0';
    svg.innerHTML = '<filter id="wc-round" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="3" in="SourceGraphic" result="d"/><feMorphology operator="erode" radius="3" in="d"/></filter>';
    document.body.appendChild(svg);
  }
}
function applyCosmetics(els, cos) {
  if (!cos) return;
  var vis = window.__COSMETIC_VISIBILITY;
  if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }
  if (cos.word_color && els.wordEl) {
    if (cos.word_color.color) {
            els.wordEl.style.color = '#fff';
      els.wordEl.style.webkitTextStroke = '28px ' + cos.word_color.color;
      els.wordEl.style.paintOrder = 'stroke fill';
      els.wordEl.style.letterSpacing = '-3px';
    }
    els.wordEl.style.textShadow = WC_OUTLINE;
    if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
  }
  if (cos.word_glow && els.wordEl) {
    if (cos.word_glow.textShadow) {
      var existing = els.wordEl.style.textShadow;
      els.wordEl.style.textShadow = existing ? existing + ', ' + cos.word_glow.textShadow : WC_OUTLINE + ', ' + cos.word_glow.textShadow;
    }
    if (cos.word_glow.animation && !els.wordEl.style.animation) els.wordEl.style.animation = cos.word_glow.animation;
  }
  if (cos.name_color && els.nameEl) {
    if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
    if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
  }
  if (cos.name_glow && els.nameEl) {
    if (cos.name_glow.textShadow) els.nameEl.style.textShadow = cos.name_glow.textShadow;
    if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
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
  // Hero badge — background gradient on surface element
  if (cos.hero_badge && els.surfaceEl) {
    if (cos.hero_badge.background) {
      els.surfaceEl.style.background = cos.hero_badge.background;
      if (cos.hero_badge.backgroundSize) els.surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
      if (cos.hero_badge.animation) els.surfaceEl.style.animation = cos.hero_badge.animation;
    }
  }
}

// ===== Error Toast =====
function showError(msg) {
  if (errorTimeout) clearTimeout(errorTimeout);
  errorToast.textContent = msg;
  errorToast.className = 'error-toast shake';
  errorTimeout = setTimeout(function () {
    errorToast.classList.add('hidden');
    errorToast.classList.remove('shake');
  }, 2500);
}

// ===== Win =====
function getWinCountForUser(platformUserId) {
  if (!platformUserId || !winHistory.length) return 0;
  return winHistory.filter(function (h) {
    var w = h.winner;
    return w && (w.platformUserId === platformUserId || w.id === platformUserId);
  }).length;
}

function showWin(data) {
  var winner = data.winner || {};
  var userId = winner.platformUserId || winner.id;
  var totalWins = data.totalWins || getWinCountForUser(userId);
  var badgeHtml = totalWins > 0 ? '<span class="win-badge">' + totalWins + '</span>' : '';

  var _winFC = !!(winner.isFanClub || (Array.isArray(winner.badges) && winner.badges.indexOf('fan-club') !== -1));
  if (winPic) winPic.classList.toggle('has-fan-club-badge', _winFC);
  if (winner.profilePic) {
    var letter = ((winner.displayName || '?')[0]).toUpperCase();
    winPic.innerHTML = '<img src="' + winner.profilePic.replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.parentElement.innerHTML=\'<span class=placeholder-letter>' + letter + '</span>' + badgeHtml.replace(/'/g, "\\'") + '\'">' + badgeHtml;
  } else {
    var letter = ((winner.displayName || '?')[0]).toUpperCase();
    winPic.innerHTML = '<span class="placeholder-letter">' + letter + '</span>' + badgeHtml;
  }

  winName.textContent = winner.displayName || 'Player';
  winName.style.cssText = '';
  winWord.textContent = data.word?.toUpperCase() || '';
  winWord.style.cssText = '';
  winCount.textContent = data.guessCount || '?';

  winName.querySelectorAll('.cosmetic-title').forEach(function (el) { el.remove(); });
  // Reset hero badge surface
  if (winModal) { winModal.style.background = ''; winModal.style.backgroundSize = ''; winModal.style.animation = ''; }
  if (winner.cosmetics) {
    var avatarEl = winPic.querySelector('img') || winPic;
    applyCosmetics({ nameEl: winName, titleContainer: winName, wordEl: winWord, avatarEl: avatarEl, surfaceEl: winModal }, winner.cosmetics);
    if (winner.cosmetics.win_effect && window.playWinEffect) {
      window.playWinEffect(winner.cosmetics.win_effect);
    }
  }

  winOverlay.classList.remove('hidden');
  startCountdown(winCountdown);
}

function hideWin() {
  winOverlay.classList.add('hidden');
  stopCountdown();
}

// ===== Countdown =====
function startCountdown(el) {
  stopCountdown();
  var remaining = AUTO_RESTART_SECONDS;
  el.textContent = 'Next game in ' + remaining + 's';
  countdownInterval = setInterval(function () {
    remaining--;
    if (remaining <= 0) {
      stopCountdown();
      el.textContent = 'Starting...';
    } else {
      el.textContent = 'Next game in ' + remaining + 's';
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (winCountdown) winCountdown.textContent = '';
}

// ===== Guess Submission =====
function submitGuess() {
  if (submitCooldown) return;
  var word = currentInput.trim().toLowerCase();
  if (!word || word.length !== currentWordLength) return;

  socket.emit('guess', { word: word });
  currentInput = '';
  if (currentState) updateConfirmedRow(currentState);

  submitCooldown = true;
  setTimeout(function () {
    submitCooldown = false;
  }, 400);
}

// ===== Handle Full State =====
function handleState(state) {
  currentState = state;
  var prevLen = currentWordLength;
  currentWordLength = state.wordLength || 5;
  if (state.winHistory) winHistory = state.winHistory;

  // Daily & frenzy badges
  if (dailyBadge) dailyBadge.style.display = state.isDaily ? '' : 'none';
  if (state.frenzy && frenzyBadge) {
    if (state.frenzy.multiplier > 1.0) {
      frenzyBadge.style.display = '';
      if (frenzyMultEl) frenzyMultEl.textContent = state.frenzy.multiplier.toFixed(1) + 'x';
    } else {
      frenzyBadge.style.display = 'none';
    }
  }

  updateBoundaries(state);
  updateConfirmedRow(state);
  updateAlphabet(state);
  updateGuessCounter();

  if (currentWordLength !== prevLen) {
    updateWordSizeToggle();
  }

  if (state.isWon) {
    var correctGuess = state.guesses.find(function (g) { return g.isCorrect; });
    showWin({
      word: correctGuess?.word,
      winner: state.winner,
      guessCount: state.guessCount
    });
  } else {
    hideWin();
  }
}

// ===== Socket Events =====
socket.on('game-state', function (state) {
  handleState(state);
});

socket.on('new-guess', function () {});

socket.on('game-won', function (data) {
  if (data.winner) {
    winHistory.unshift({
      winner: {
        displayName: data.winner.displayName,
        platform: data.winner.platform,
        platformUserId: data.winner.platformUserId || data.winner.id,
      },
      word: data.word,
      guessCount: data.guessCount,
      timestamp: new Date().toISOString(),
    });
  }
  showWin(data);
});

socket.on('guess-error', function (data) {
  showError(data.error || 'Invalid guess');
  currentInput = '';
  if (currentState) updateConfirmedRow(currentState);
});

socket.on('new-game', function (state) {
  hideWin();
  currentInput = '';
  // Daily badge for the new game
  if (dailyBadge) dailyBadge.style.display = (state && state.isDaily) ? '' : 'none';
  handleState(state);
});

socket.on('frenzy-update', function (data) {
  if (!data || !frenzyBadge) return;
  if (data.multiplier > 1.0) {
    frenzyBadge.style.display = '';
    if (frenzyMultEl) frenzyMultEl.textContent = data.multiplier.toFixed(1) + 'x';
  } else {
    frenzyBadge.style.display = 'none';
  }
});
