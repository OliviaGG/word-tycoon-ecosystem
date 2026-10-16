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

var _sessHandle = (function () {
  try {
    var q = new URLSearchParams(location.search).get('session');
    if (q && /^[a-z0-9_-]{1,32}$/.test(q)) return q;
    var m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})$/i);
    if (m && m[1]) {
      var h = m[1].toLowerCase();
      var RES = ['admin', 'overlay', 'index.html', 'mp.html', 'sp.html', 'overlay.html', 'play', 'play.html'];
      if (RES.indexOf(h) === -1) return h;
    }
  } catch (e) {}
  return null;
})();
window.__SESSION_HANDLE = _sessHandle;
var socket = _sessHandle ? io({ auth: { session: _sessHandle } }) : io();
socket.on('session-redirect', function (data) {
  if (!data || !data.targetUrl) return;
  try {
    var isOverlay = !document.body || document.body.dataset.mode !== 'mp';
    if (isOverlay) return;
    if (document.getElementById('session-redirect-modal')) return;
    var ov = document.createElement('div');
    ov.id = 'session-redirect-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:inherit';
    var card = document.createElement('div');
    card.style.cssText = 'background:#1a1f2e;border:1px solid #2a3148;border-radius:14px;padding:28px;max-width:340px;width:88%;text-align:center;color:#fff';
    var tname = (data.targetGameName || 'a different game').replace(/[<>"]/g, '');
    card.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:8px">Streamer switched games</div><div style="opacity:.8;font-size:14px;margin-bottom:18px">They\'re now playing <b>' + tname + '</b>.</div>';
    var b1 = document.createElement('button');
    b1.textContent = 'Follow streamer →';
    b1.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#5865F2,#a855f7);color:#fff;font-size:14px;font-weight:700;margin-bottom:8px;cursor:pointer';
    b1.onclick = function () { window.location.href = data.targetUrl; };
    var b2 = document.createElement('button');
    b2.textContent = 'Play public version';
    b2.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2a3148;background:#0f1320;color:#cbd5e1;font-size:14px;font-weight:700;cursor:pointer';
    b2.onclick = function () { window.location.href = location.origin + '/'; };
    card.appendChild(b1); card.appendChild(b2);
    ov.appendChild(card);
    document.body.appendChild(ov);
  } catch (e) {}
});

// Load viewer cosmetic visibility preferences (default OFF for word_color/word_glow)
window.__COSMETIC_VISIBILITY = {};
try { var xhr = new XMLHttpRequest(); xhr.open('GET', '/api/me/visibility', false); xhr.withCredentials = true; xhr.send(); if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); if (d && d.visibility) window.__COSMETIC_VISIBILITY = d.visibility; } } catch (e) {}

// DOM refs
var lowerTiles = document.getElementById('lower-tiles');
var upperTiles = document.getElementById('upper-tiles');
var lowerPfp = document.getElementById('lower-pfp');
var upperPfp = document.getElementById('upper-pfp');
var lowerDistance = document.getElementById('lower-distance');
var upperDistance = document.getElementById('upper-distance');
var confirmedRow = document.getElementById('confirmed-row');
var alphaRow1 = document.getElementById('alpha-row-1');
var alphaRow2 = document.getElementById('alpha-row-2');
var jackpotAmountEl = document.getElementById('jackpot-amount');
var dailyBadge = document.getElementById('daily-badge');
var frenzyBadge = document.getElementById('frenzy-badge');
var frenzyMultEl = document.getElementById('frenzy-mult');
var winnerBanner = document.getElementById('winner-banner');

var AUTO_RESTART_SECONDS = 10;

var winHistory = [];
var currentJackpot = 100;
var currentState = null;
var shownWinOpening = null;
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
  if (!Number.isFinite(amount) || amount < 0) return;
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

  // Closeness numbers
  if (lowerDistance) lowerDistance.textContent = state.lowerCloseness != null ? state.lowerCloseness : '';
  if (upperDistance) upperDistance.textContent = state.upperCloseness != null ? state.upperCloseness : '';
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
var WC_OUTLINE = '7px 7px 3px #000, -7px -7px 3px #000, 7px -7px 3px #000, -7px 7px 3px #000, 0 7px 3px #000, 0 -7px 3px #000, 7px 0 3px #000, -7px 0 3px #000';
function makeColorBorder(color, radius) {
  var s = [];
  // Color layer (outermost, rendered first = behind)
  for (var r = 1; r <= radius; r++) {
    var steps = Math.max(8, Math.ceil(r * 3));
    for (var i = 0; i < steps; i++) {
      var a = (2 * Math.PI * i) / steps;
      s.push((r * Math.cos(a)).toFixed(1) + 'px ' + (r * Math.sin(a)).toFixed(1) + 'px 0 ' + color);
    }
  }
  // Black outline layer (between color and white text)
  for (var b = 1; b <= 3; b++) {
    var bsteps = Math.max(8, b * 6);
    for (var i = 0; i < bsteps; i++) {
      var a = (2 * Math.PI * i) / bsteps;
      s.push((b * Math.cos(a)).toFixed(1) + 'px ' + (b * Math.sin(a)).toFixed(1) + 'px 0 #000');
    }
  }
  return s.join(', ');
}
function applyCosmetics(els, cos) {
  if (!cos) return;
  var vis = window.__COSMETIC_VISIBILITY;
  if (vis) { for (var c in vis) { if (vis[c] === false) delete cos[c]; } }
  // Word cosmetics were suppressed here "for eyestrain reduction" back when
  // they were a PERMANENT tint. They are now a transient spawn effect
  // (PfpCosmetics.spawnWord: ~500ms hold, 600ms fade), so the suppression
  // was removed 2026-08-03 and OBS shows them like every other surface.
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

// ===== Handle State =====
function handleState(state) {
  currentState = state;
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
    var correct = (state.guesses || []).find(function (guess) { return guess.isCorrect; });
    showRecoveredWin({ word: correct && correct.word, winner: state.winner, guessCount: state.guessCount, jackpot: state.jackpotAwarded ?? state.jackpot });
  } else { shownWinOpening = null; if (window.WinCard) WinCard.hide(); }
}
function showRecoveredWin(data) {
  if (!window.WinCard) return;
  var opening = currentState && currentState.hintStartTime;
  if (opening && shownWinOpening === opening) return;
  shownWinOpening = opening;
  var winner = data.winner || {};
  if (!winner.platformUserId && winner.id) winner = Object.assign({}, winner, { platformUserId: winner.id });
  WinCard.showMp({ game: 'betwixt', gameName: 'Betwixt', word: data.word, guessCount: data.guessCount,
    jackpot: data.jackpot, totalWins: typeof data.totalWins === 'number' ? data.totalWins : undefined, winner: winner, autoHideMs: 10000 });
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

  showRecoveredWin(data);
});

socket.on('jackpot-update', function (data) {
  if (currentState && currentState.isWon) return;
  updateJackpotDisplay(data.jackpot);
});

socket.on('new-game', function (state) {
  if (window.WinCard) WinCard.hide();
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
