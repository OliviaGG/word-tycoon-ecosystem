// ===== Viewport Scaling =====
(function () {
  var BASE = 480;
  var actualW = window.innerWidth;
  var actualH = window.innerHeight;
  var scale = actualW / BASE;

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

  document.documentElement.style.setProperty('--base-width', BASE + 'px');
  document.documentElement.style.setProperty('--base-height', baseH + 'px');
})();

var socket = io();

// DOM refs
var lowerTiles = document.getElementById('lower-tiles');
var upperTiles = document.getElementById('upper-tiles');
var lowerPfp = document.getElementById('lower-pfp');
var upperPfp = document.getElementById('upper-pfp');
var confirmedRow = document.getElementById('confirmed-row');
var alphaRow1 = document.getElementById('alpha-row-1');
var alphaRow2 = document.getElementById('alpha-row-2');
var winOverlay = document.getElementById('win-overlay');
var winWord = document.getElementById('win-word');
var winName = document.getElementById('win-name');
var winPic = document.getElementById('win-pic');
var winCount = document.getElementById('win-count');
var winCountdown = document.getElementById('win-countdown');
var winJackpotEl = document.getElementById('win-jackpot');
var jackpotAmountEl = document.getElementById('jackpot-amount');
var dailyBadge = document.getElementById('daily-badge');
var frenzyBadge = document.getElementById('frenzy-badge');
var frenzyMultEl = document.getElementById('frenzy-mult');
var winnerBanner = document.getElementById('winner-banner');

var AUTO_RESTART_SECONDS = 10;
var countdownInterval = null;
var winHistory = [];
var currentJackpot = 100;
var winnerBannerIndex = 0;
var winnerBannerTimer = null;

var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ===== Build Alphabet (2 rows: A-M, N-Z) =====
function buildAlphabet() {
  alphaRow1.innerHTML = '';
  alphaRow2.innerHTML = '';
  LETTERS.forEach(function (letter, i) {
    var tile = document.createElement('div');
    tile.className = 'alpha-tile possible';
    tile.id = 'tile-' + letter;
    tile.textContent = letter;
    if (i < 13) {
      alphaRow1.appendChild(tile);
    } else {
      alphaRow2.appendChild(tile);
    }
  });
}
buildAlphabet();

// ===== Jackpot Display =====
function updateJackpotDisplay(amount) {
  currentJackpot = amount;
  if (jackpotAmountEl) {
    jackpotAmountEl.textContent = amount.toLocaleString();
  }
}

// ===== Winner Banner =====
function buildWinnerBanner() {
  if (!winnerBanner || !winHistory.length) {
    if (winnerBanner) winnerBanner.innerHTML = '';
    return;
  }

  var recent = winHistory.slice(0, 5);
  showWinnerBannerEntry(0, recent);

  if (winnerBannerTimer) clearInterval(winnerBannerTimer);
  if (recent.length > 1) {
    winnerBannerIndex = 0;
    winnerBannerTimer = setInterval(function () {
      winnerBannerIndex = (winnerBannerIndex + 1) % recent.length;
      showWinnerBannerEntry(winnerBannerIndex, recent);
    }, 4000);
  }
}

function showWinnerBannerEntry(index, entries) {
  if (!winnerBanner || !entries[index]) return;
  var entry = entries[index];
  var winner = entry.winner || {};
  var pfpHtml = '';
  if (winner.profilePic) {
    pfpHtml = '<img class="wb-pfp" src="' + winner.profilePic.replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.style.display=\'none\'">';
  } else {
    var letter = ((winner.displayName || '?')[0]).toUpperCase();
    pfpHtml = '<span class="wb-pfp-letter">' + letter + '</span>';
  }

  winnerBanner.innerHTML = '<div class="wb-entry">' +
    pfpHtml +
    '<span class="wb-name">' + (winner.displayName || 'Player') + '</span>' +
    '<span class="wb-word">' + (entry.word || '').toUpperCase() + '</span>' +
    '<span class="wb-guesses">' + (entry.guessCount || '?') + ' guesses</span>' +
  '</div>';
}

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
}

// ===== Profile Picture =====
function renderPfp(container, user) {
  container.innerHTML = '';
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

// ===== Alphabet =====
function updateAlphabet(state) {
  if (!state) return;
  var lower = state.currentLower.toLowerCase();
  var upper = state.currentUpper.toLowerCase();
  var isMaskLower = /^x+$/.test(lower);
  var isMaskUpper = /^x+$/.test(upper);

  var lowerFirst = isMaskLower ? 'a' : lower[0];
  var upperFirst = isMaskUpper ? 'z' : upper[0];

  LETTERS.forEach(function (letter) {
    var tile = document.getElementById('tile-' + letter);
    var l = letter.toLowerCase();
    var status;

    if (isMaskLower && isMaskUpper) {
      status = 'possible';
    } else if (l < lowerFirst) {
      status = 'eliminated';
    } else if (l > upperFirst) {
      status = 'eliminated';
    } else if (l === lowerFirst && !isMaskLower) {
      status = 'edge';
    } else if (l === upperFirst && !isMaskUpper) {
      status = 'edge';
    } else {
      status = 'possible';
    }

    tile.className = 'alpha-tile ' + status;
  });
}

// ===== Cosmetics =====
function applyCosmetics(els, cos) {
  if (!cos) return;
  if (cos.word_color && els.wordEl) {
    if (cos.word_color.color) els.wordEl.style.color = cos.word_color.color;
    if (cos.word_color.textShadow) els.wordEl.style.textShadow = cos.word_color.textShadow;
    if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
  }
  if (cos.word_glow && els.wordEl) {
    if (cos.word_glow.textShadow) els.wordEl.style.textShadow = cos.word_glow.textShadow;
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
}

// ===== Win Count =====
function getWinCountForUser(platformUserId) {
  if (!platformUserId || !winHistory.length) return 0;
  return winHistory.filter(function (h) {
    var w = h.winner;
    return w && (w.platformUserId === platformUserId || w.id === platformUserId);
  }).length;
}

// ===== Show Win =====
function showWin(data) {
  var winner = data.winner || {};
  var userId = winner.platformUserId || winner.id;
  var totalWins = data.totalWins || getWinCountForUser(userId);
  var badgeHtml = totalWins > 0 ? '<span class="win-badge">' + totalWins + '</span>' : '';

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

  // Show jackpot amount
  var jackpot = data.jackpot || 0;
  if (jackpot > 0 && winJackpotEl) {
    winJackpotEl.textContent = '+' + jackpot.toLocaleString() + ' coins';
  } else if (winJackpotEl) {
    winJackpotEl.textContent = '';
  }

  winName.querySelectorAll('.cosmetic-title').forEach(function (el) { el.remove(); });
  if (winner.cosmetics) {
    var avatarEl = winPic.querySelector('img') || winPic;
    applyCosmetics({ nameEl: winName, titleContainer: winName, wordEl: winWord, avatarEl: avatarEl }, winner.cosmetics);
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

// ===== Handle State =====
function handleState(state) {
  if (state.winHistory) {
    winHistory = state.winHistory;
    buildWinnerBanner();
  }
  if (state.jackpot !== undefined) updateJackpotDisplay(state.jackpot);

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

  if (state.isWon) {
    var correctGuess = state.guesses.find(function (g) { return g.isCorrect; });
    showWin({
      word: correctGuess?.word,
      winner: state.winner,
      guessCount: state.guessCount,
      jackpot: state.jackpot || 0
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
        profilePic: data.winner.profilePic,
      },
      word: data.word,
      guessCount: data.guessCount,
      timestamp: new Date().toISOString(),
    });
    buildWinnerBanner();
  }
  showWin(data);
});

socket.on('jackpot-update', function (data) {
  updateJackpotDisplay(data.jackpot);
});

socket.on('new-game', function (state) {
  hideWin();
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
