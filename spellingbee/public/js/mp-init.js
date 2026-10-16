// Premium gate (2026-07-19): public multiplayer is Donor-only. The server
// drops non-premium web guesses and emits premium-required; this wall is
// dismissible so spectating stays open.
window.wtShowPremiumWall = window.wtShowPremiumWall || function (loggedIn) {
  var existing = document.getElementById('premium-wall');
  if (existing) { existing.style.display = 'flex'; return; }
  var el = document.createElement('div');
  el.id = 'premium-wall';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(5,8,12,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
  var signinBtn = loggedIn ? '' :
    '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,171,0,0.35);color:#eef2f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
  el.innerHTML =
    '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(14,18,24,0.98),rgba(22,28,38,0.98));border:1px solid rgba(255,171,0,0.25);border-radius:18px;position:relative;color:#eef2f4;">' +
      '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#b8c4d0;font-size:16px;cursor:pointer;">&times;</button>' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,171,0,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
      '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(184,196,208,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eef2f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<a href="/spellingbee/solo/" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(255,171,0,0.12);border:1.5px solid rgba(255,171,0,0.45);color:#fff;font-weight:900;text-decoration:none;">Play the free weekly</a>' +
        '<a href="https://wordtycoon.live/me?tab=pass" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(196,102,255,0.1);border:1.5px solid rgba(196,102,255,0.4);color:#c98aff;font-weight:900;text-decoration:none;">Become a Donor &mdash; $2/mo</a>' +
        signinBtn +
      '</div>' +
      '<p style="margin:18px 0 0;font-size:0.72rem;color:rgba(184,196,208,0.55);">You can keep watching the game behind this message.</p>' +
    '</div>';
  document.body.appendChild(el);
  document.getElementById('premium-wall-close').onclick = function () { el.style.display = 'none'; };
  var sb = document.getElementById('premium-wall-signin');
  if (sb) sb.onclick = function () {
    window.location.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent(location.href);
  };
};

(function() {
'use strict';

var AVATAR_FALLBACK = '/portal/img/logo.png';
function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
}

var user = null;
var guestName = null;
var DEFAULT_AVATAR = 'https://wordtycoon.live/portal/img/logo.png';
var socket = null;
var currentWordBuffer = '';
var pendingGuess=null, pendingGuessTimer=null;
var localLetters = []; // copy for shuffle (visual only)
var gameLetters = [];  // original letters from server

// Drag state
var isDragging = false;
var dragJustEnded = false;
var lastDragCellEl = null;
var dragPath = [];
var dragPreviewEl = null;
var svgOverlay = null;

// ─── DOM Refs ───
var loginScreen, gameUI;
var hexRowTop, hexRowMid, hexRowBot, honeycombArea;
var currentWordEl, scoreValEl;
var btnDelete, btnShuffle, btnSubmit;
var progressBar, foundCountEl, totalCountEl, foundLabel;
var incorrectArea, foundWordsList;
var statsDropdown, errorToast;
var topPlayersEl;
var puzzleInfoEl, puzzleNumEl, puzzleNameEl, puzzleThemeBadgeEl;
var rareCountEl, rareLabelEl, rareWordsList, rareSection;
var hiddenCountEl, hiddenLabelEl, hiddenWordsList, hiddenSection;
var threeLetterCountEl, threeLetterLabelEl, threeLetterWordsList, threeLetterSection;
var dailyBadgeEl, frenzyBadgeEl, frenzyMultiplierEl;
var mpStatusRowEl, jackpotValEl, momentumValEl, leaderValEl;

function initDom() {
    loginScreen = document.getElementById('login-screen');
    gameUI = document.getElementById('game-ui');

    // Honeycomb
    honeycombArea = document.getElementById('honeycomb-area');
    hexRowTop = document.getElementById('hex-row-top');
    hexRowMid = document.getElementById('hex-row-mid');
    hexRowBot = document.getElementById('hex-row-bot');

    // Current word + actions
    currentWordEl = document.getElementById('current-word');
    scoreValEl = document.getElementById('score-val');
    btnDelete = document.getElementById('btn-delete');
    btnShuffle = document.getElementById('btn-shuffle');
    btnSubmit = document.getElementById('btn-submit');

    // Progress
    progressBar = document.getElementById('progress-bar');
    foundCountEl = document.getElementById('found-count');
    totalCountEl = document.getElementById('total-count');
    foundLabel = document.getElementById('found-label');

    // Feedback
    incorrectArea = document.getElementById('incorrect-area');
    foundWordsList = document.getElementById('found-words');

    // Stats / misc
    statsDropdown = document.getElementById('stats-dropdown');
    errorToast = document.getElementById('error-toast');
    topPlayersEl = document.getElementById('top-players');

    // Puzzle info
    puzzleInfoEl = document.getElementById('puzzle-info');
    puzzleNumEl = document.getElementById('puzzle-num');
    puzzleNameEl = document.getElementById('puzzle-name');
    puzzleThemeBadgeEl = document.getElementById('puzzle-theme-badge');

    // Rare words
    rareCountEl = document.getElementById('rare-count');
    rareLabelEl = document.getElementById('rare-label');
    rareWordsList = document.getElementById('rare-words');
    rareSection = document.getElementById('rare-section');

    // Hidden words
    hiddenCountEl = document.getElementById('hidden-count');
    hiddenLabelEl = document.getElementById('hidden-label');
    hiddenWordsList = document.getElementById('hidden-words');
    hiddenSection = document.getElementById('hidden-section');

    // 3-letter words
    threeLetterCountEl = document.getElementById('three-letter-count');
    threeLetterLabelEl = document.getElementById('three-letter-label');
    threeLetterWordsList = document.getElementById('three-letter-words');
    threeLetterSection = document.getElementById('three-letter-section');

    // Daily/Frenzy badges
    dailyBadgeEl = document.getElementById('daily-badge');
    frenzyBadgeEl = document.getElementById('frenzy-badge');
    frenzyMultiplierEl = document.getElementById('frenzy-multiplier');

    // MP status chips
    mpStatusRowEl = document.getElementById('mp-status-row');
    jackpotValEl = document.getElementById('jackpot-val');
    momentumValEl = document.getElementById('momentum-val');
    leaderValEl = document.getElementById('leader-val');
}

// ─── Auth Check ───
function checkAuth() {
    // Inject guest CSS
    if (!document.getElementById('mp-guest-style')) {
        var gs = document.createElement('style');
        gs.id = 'mp-guest-style';
        gs.textContent = '.mp-guest-section{margin:0 0 16px}.mp-guest-row{display:flex;gap:8px;margin-top:8px}.mp-guest-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.15);border-radius:10px;color:inherit;font-size:.9rem;font-family:inherit;outline:none;min-width:0}.mp-guest-input:focus{border-color:#5865F2}.mp-guest-input::placeholder{opacity:.5}.mp-guest-btn{padding:11px 16px;background:#5865F2;border:none;border-radius:10px;color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .2s}.mp-guest-btn:hover{background:#4752c4}';
        document.head.appendChild(gs);
    }

    fetch('/api/me/session')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.ok) {
                user = data.user;
                showGame();
            } else {
                showLogin();
            }
        })
        .catch(function() { showLogin(); });
}

var guestNameValidationPromise = null;

function ensureGuestNameValidation() {
  if (window.WordTycoonGuestNameValidation) return Promise.resolve(window.WordTycoonGuestNameValidation);
  if (guestNameValidationPromise) return guestNameValidationPromise;
  guestNameValidationPromise = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://127.0.0.1:3020' : 'https://wordtycoon.live') + '/portal/js/guest-name-validation.js?v=20260328';
    script.onload = function () {
      if (window.WordTycoonGuestNameValidation) resolve(window.WordTycoonGuestNameValidation);
      else reject(new Error('Guest name validation helper unavailable.'));
    };
    script.onerror = function () { reject(new Error('Guest name validation helper failed to load.')); };
    document.head.appendChild(script);
  });
  return guestNameValidationPromise;
}

function showGuestNameError(input, message) {
  if (window.WordTycoonGuestNameValidation && window.WordTycoonGuestNameValidation.showError) {
    window.WordTycoonGuestNameValidation.showError(input, message);
    return;
  }
  if (!input) return;
  input.setCustomValidity(message || 'That username is not allowed.');
  input.reportValidity();
  setTimeout(function () { input.setCustomValidity(''); }, 50);
}

async function validateGuestUsername(input) {
  try {
    var helper = await ensureGuestNameValidation();
    return await helper.validateInput(input, { maxLength: 20, minLength: 1 });
  } catch (error) {
    return { ok: false, valid: false, sanitized: '', message: 'Username validation unavailable.' };
  }
}

function showLogin() {
    document.body.classList.remove('game-active');
    loginScreen.style.display = 'flex';
    gameUI.style.display = 'none';
    var guestInput = document.getElementById('guest-name-input');
    var guestBtn = document.getElementById('guest-play-btn');
    if (guestBtn) {
        guestBtn.addEventListener('click', async function () {
            var validation = await validateGuestUsername(guestInput);
            if (!validation.ok) {
                showGuestNameError(guestInput, validation.message);
                return;
            }
            guestName = validation.sanitized || 'Anonymous';
            showGame();
        });
        if (guestInput) guestInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') guestBtn.click(); });
    }
}

function showGame() {
    loginScreen.style.display = 'none';
    gameUI.style.display = 'block';
    document.body.classList.add('game-active');
    window.scrollTo(0, 0);
    connectSocket();
    fetchStats();
    setupKeyboard();
    setupActions();
    setupStatsToggle();
    setupDragInput();
    setupCheatSheet();
    initHintButton();
}

// ─── Socket.IO ───
function _detectSessionHandle() {
    try {
        const q = new URLSearchParams(location.search).get('session');
        if (q && /^[a-z0-9_-]{1,32}$/.test(q)) return q;
        const m = location.pathname.match(/^\/(?:overlay\/)?([a-z0-9_-]{1,32})$/i);
        if (m && m[1]) {
            const h = m[1].toLowerCase();
            const RES = new Set(['admin', 'overlay', 'index.html', 'mp.html', 'sp.html', 'overlay.html']);
            if (!RES.has(h)) return h;
        }
    } catch (e) {}
    return null;
}
function connectSocket() {
    const _sess = _detectSessionHandle();
    window.__SESSION_HANDLE = _sess;
    socket = _sess ? io({ auth: { session: _sess } }) : io();
    socket.on('premium-required', function (info) { clearPendingGuess(); window.wtShowPremiumWall(!!(info && info.loggedIn)); });
    socket.on('premium-unavailable',function(){clearPendingGuess();showToast('Account verification unavailable. Please retry.');});
    socket.on('disconnect',function(){clearPendingGuess();showToast('Connection lost. Your word is retained.');});

    // Round-end win card (winner hero + top-10 standings) — shared component.
    // Sessions emit an in-page 'game-win'; per-word winType:'word' events are
    // filtered out inside handleGameWin.
    socket.on('game-win', function (data) {
        if (window.WinCard) WinCard.handleGameWin(data);
    });

    socket.on('session-redirect', function (data) {
        if (!data || !data.targetUrl) return;
        if (document.getElementById('session-redirect-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'session-redirect-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:inherit';
        const card = document.createElement('div');
        card.style.cssText = 'background:#1a1f2e;border:1px solid #2a3148;border-radius:14px;padding:28px;max-width:340px;width:88%;text-align:center;color:#fff';
        const tname = (data.targetGameName || 'a different game').replace(/[<>"]/g, '');
        card.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:8px">Streamer switched games</div>'
            + '<div style="opacity:.8;font-size:14px;margin-bottom:18px">They\'re now playing <b>' + tname + '</b>.</div>';
        const btnFollow = document.createElement('button');
        btnFollow.textContent = 'Follow streamer →';
        btnFollow.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#5865F2,#a855f7);color:#fff;font-size:14px;font-weight:700;margin-bottom:8px;cursor:pointer';
        btnFollow.onclick = function () { window.location.href = data.targetUrl; };
        const btnPublic = document.createElement('button');
        btnPublic.textContent = 'Play public version';
        btnPublic.style.cssText = 'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid #2a3148;background:#0f1320;color:#cbd5e1;font-size:14px;font-weight:700;cursor:pointer';
        btnPublic.onclick = function () { window.location.href = location.origin + '/'; };
        card.appendChild(btnFollow);
        card.appendChild(btnPublic);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    });

    socket.on('game-state', function(state) {
        renderGameState(state);
        if(state && state.completion && window.WinCard){
            var c=state.completion,w=c.winner;
            if(w)WinCard.handleGameWin({game:'spellingbee',gameName:'Spelling Bee',word:null,winner:{displayName:w.displayName,platform:w.platform,profilePic:w.avatar||null},jackpot:c.amount,guessCount:w.words.length,isDaily:c.isDaily,topPlayers:c.leaderboard.slice(0,10).map(function(p){return{displayName:p.displayName,platform:p.platform,points:p.score||0};})});
        }
    });

    socket.on('guess-result', function(result) {
        handleGuessResult(result);
    });

    socket.on('word-found', function(entry) {
        // Pulse the matching hex cells when ANY player in this session
        // finds a word. game-state will follow with the leaderboard update;
        // this is the immediate visual celebration on the honeycomb itself.
        try { animateHexesForWord(entry && entry.word, !!(entry && entry.isPangram)); } catch (_) {}
        try { celebrateWordFound(entry); } catch (_) {}
    });

    socket.on('guess-attempt', function(attempt) {
        try { addGuessToTicker(attempt); } catch (_) {}
    });

    socket.on('game-over', function(data) {
        showWin(data);
    });

    socket.on('new-game', function(state) {
        if (window.WinCard) WinCard.hide();
        currentWordBuffer = '';
        renderCurrentWord();
        renderGameState(state);
    });

    socket.on('all-words-found', function(state) {
        // game-over will follow
    });

    socket.on('frenzy-update', function(frenzy) {
        renderFrenzy(frenzy);
    });

    socket.on('jackpot-update', function(update) {
        if (!jackpotValEl || !update) return;
        jackpotValEl.textContent = formatCompactNumber(update.jackpot || 0);
    });

    socket.on('connect_error', function() {
        showToast('Connection lost. Reconnecting...');
    });

    socket.on('connect', function() {
        hideToast();
    });
}

// ─── Render Game State ───
function renderGameState(state) {
    if (!state || !state.letters || state.letters.length !== 7) return;

    gameLetters = state.letters;
    // Only re-render the honeycomb when the puzzle actually changed.
    // Otherwise every game-state event (one per word found) wipes the hex
    // cells via innerHTML='', destroying the word-found pulse animations
    // we just added milliseconds earlier in the word-found handler.
    var puzzleChanged = (localLetters.length !== 7 || localLetters[0] !== state.letters[0]
        || localLetters.slice().sort().join('') !== state.letters.slice().sort().join(''));
    if (puzzleChanged) {
        localLetters = state.letters.slice();
    }

    // Puzzle info
    if (state.puzzleId) {
        puzzleNumEl.textContent = '#' + state.puzzleId;
        puzzleNameEl.textContent = state.puzzleName || '';
        puzzleThemeBadgeEl.textContent = state.puzzleTheme || '';
        puzzleThemeBadgeEl.style.display = state.puzzleTheme ? '' : 'none';
        puzzleInfoEl.classList.remove('hidden');
    } else {
        puzzleInfoEl.classList.add('hidden');
    }

    // Honeycomb — only rebuild DOM when the puzzle itself changed
    // (preserves word-found animation classes between updates).
    if (puzzleChanged) renderHoneycomb();
    renderCurrentWord();

    // Goal = common words only
    var cc = state.commonCount || state.totalWords || 0;
    var fc = state.foundCommonCount || state.foundCount || 0;
    foundCountEl.textContent = fc;
    totalCountEl.textContent = cc;
    foundLabel.textContent = fc;
    var pct = cc > 0 ? (fc / cc * 100) : 0;
    progressBar.style.width = pct + '%';

    // Score
    if (scoreValEl) scoreValEl.textContent = state.currentScore || 0;

    // Rare counter
    var rc = state.foundRareCount || 0;
    if (rc > 0) {
        rareCountEl.textContent = '+' + rc + ' rare';
        rareCountEl.classList.remove('hidden');
    } else {
        rareCountEl.classList.add('hidden');
    }

    // Ultra rare counter
    var hc = state.foundHiddenCount || 0;
    if (hiddenCountEl) {
        if (hc > 0) {
            hiddenCountEl.textContent = '+' + hc + ' ultra rare';
            hiddenCountEl.classList.remove('hidden');
        } else {
            hiddenCountEl.classList.add('hidden');
        }
    }

    // 3-letter counter
    var tlc = state.foundThreeLetterCount || 0;
    if (threeLetterCountEl) {
        if (tlc > 0) {
            threeLetterCountEl.textContent = '+' + tlc + ' 3-letter';
            threeLetterCountEl.classList.remove('hidden');
        } else {
            threeLetterCountEl.classList.add('hidden');
        }
    }

    // Found words - common
    var commonW = state.foundCommonWords || [];
    if (commonW.length === 0) {
        foundWordsList.innerHTML = '<span class="found-empty">No words found yet</span>';
    } else {
        var html = '';
        for (var i = 0; i < commonW.length; i++) {
            var w = commonW[i];
            var entry = state.foundWords ? state.foundWords[w] : null;
            var cls = 'found-word';
            if (entry && entry.isPangram) cls += ' pangram';
            html += '<span class="' + cls + '">' + w + '</span>';
        }
        foundWordsList.innerHTML = html;
    }

    // Found words - rare
    var rareW = state.foundRareWords || [];
    rareLabelEl.textContent = rareW.length;
    if (state.rareCount > 0) {
        rareSection.style.display = '';
        if (rareW.length === 0) {
            rareWordsList.innerHTML = '<span class="found-empty">Find bonus rare words!</span>';
        } else {
            var rHtml = '';
            for (var r = 0; r < rareW.length; r++) {
                var rw = rareW[r];
                var rEntry = state.foundWords ? state.foundWords[rw] : null;
                var rCls = 'found-word rare';
                if (rEntry && rEntry.isPangram) rCls += ' pangram';
                rHtml += '<span class="' + rCls + '">' + rw + '</span>';
            }
            rareWordsList.innerHTML = rHtml;
        }
    } else {
        rareSection.style.display = 'none';
    }

    // Found words - hidden
    if (hiddenSection) {
        var hiddenW = state.foundHiddenWords || [];
        if (hiddenLabelEl) hiddenLabelEl.textContent = hiddenW.length;
        if (hiddenW.length > 0) {
            hiddenSection.style.display = '';
            var hHtml = '';
            for (var hi = 0; hi < hiddenW.length; hi++) {
                var hw = hiddenW[hi];
                var hEntry = state.foundWords ? state.foundWords[hw] : null;
                var hCls = 'found-word hidden-word';
                if (hEntry && hEntry.isPangram) hCls += ' pangram';
                hHtml += '<span class="' + hCls + '">' + hw + '</span>';
            }
            hiddenWordsList.innerHTML = hHtml;
        } else {
            hiddenSection.style.display = 'none';
        }
    }

    // Found words - 3-letter
    if (threeLetterSection) {
        var threeW = state.foundThreeLetterWords || [];
        if (threeLetterLabelEl) threeLetterLabelEl.textContent = threeW.length;
        if (state.threeLetterCount > 0) {
            threeLetterSection.style.display = '';
            if (threeW.length === 0) {
                threeLetterWordsList.innerHTML = '<span class="found-empty">3-letter words — 1 pt each</span>';
            } else {
                var tHtml = '';
                for (var ti = 0; ti < threeW.length; ti++) {
                    tHtml += '<span class="found-word three-letter">' + threeW[ti] + '</span>';
                }
                threeLetterWordsList.innerHTML = tHtml;
            }
        } else {
            threeLetterSection.style.display = 'none';
        }
    }

    // Top players
    renderTopPlayers(state.topPlayers || []);
    renderMpStatus(state);
    updateCheatSheet(state);

    // Daily/Frenzy badges
    renderDaily(state.isDaily);
    renderFrenzy(state.frenzy);
}

function updateCheatSheet(state) {
    if (!window.SpellingBeeCheatSheet) return;
    window.SpellingBeeCheatSheet.setSummary(state && state.cheatSheet ? state.cheatSheet : null);
}

function renderMpStatus(state) {
    if (!mpStatusRowEl) return;
    var hasJackpot = !!(state && state.jackpotEnabled);
    var commonCount = state && (state.commonCount || state.totalWords || 0);
    var foundCommon = state && (state.foundCommonCount || state.foundCount || 0);
    var top = state && state.topPlayers && state.topPlayers[0];

    if (!hasJackpot && !commonCount && !top) {
        mpStatusRowEl.classList.add('hidden');
        return;
    }

    if (jackpotValEl) jackpotValEl.textContent = hasJackpot ? formatCompactNumber(state.jackpot || 0) : '--';
    if (momentumValEl) {
        var pct = commonCount > 0 ? Math.min(100, Math.round(foundCommon / commonCount * 100)) : 0;
        momentumValEl.textContent = pct + '%';
    }
    if (leaderValEl) {
        var leaderName = top && (top.displayName || top.name);
        leaderValEl.textContent = leaderName ? trimName(leaderName, 12) : '--';
    }
    mpStatusRowEl.classList.remove('hidden');
}

function formatCompactNumber(num) {
    num = Number(num) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(num >= 10000000 ? 0 : 1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(num >= 10000 ? 0 : 1) + 'K';
    return String(num);
}

function trimName(name, max) {
    name = String(name || '');
    if (name.length <= max) return name;
    return name.slice(0, Math.max(1, max - 3)) + '...';
}

// ─── Honeycomb ───
function renderHoneycomb() {
    hexRowTop.innerHTML = '';
    hexRowMid.innerHTML = '';
    hexRowBot.innerHTML = '';

    var center = localLetters[0];
    var outer = localLetters.slice(1);

    // Top row: outer[0], outer[1]
    hexRowTop.appendChild(createHexCell(outer[0], false, center));
    hexRowTop.appendChild(createHexCell(outer[1], false, center));

    // Mid row: outer[2], CENTER, outer[3]
    hexRowMid.appendChild(createHexCell(outer[2], false, center));
    hexRowMid.appendChild(createHexCell(center, true, center));
    hexRowMid.appendChild(createHexCell(outer[3], false, center));

    // Bot row: outer[4], outer[5]
    hexRowBot.appendChild(createHexCell(outer[4], false, center));
    hexRowBot.appendChild(createHexCell(outer[5], false, center));
}

function createHexCell(letter, isCenter, centerLetter) {
    var cell = document.createElement('div');
    cell.className = 'hex-cell' + (isCenter ? ' center' : '');
    cell.textContent = letter.toUpperCase();
    cell.dataset.letter = letter;
    cell.addEventListener('click', function() {
        if (isDragging || dragJustEnded) return;
        cell.classList.remove('pop-animation');
        void cell.offsetWidth;
        cell.classList.add('pop-animation');
        currentWordBuffer += letter;
        renderCurrentWord();
    });
    return cell;
}

function renderCurrentWord() {
    var wordArea = currentWordEl ? currentWordEl.parentElement : null;
    if (wordArea) wordArea.classList.toggle('current-word-empty', currentWordBuffer.length === 0);
    if (!localLetters.length) { currentWordEl.innerHTML = '&nbsp;'; return; }
    var center = localLetters[0];
    var html = '';
    for (var i = 0; i < currentWordBuffer.length; i++) {
        var ch = currentWordBuffer[i];
        if (ch === center) {
            html += '<span class="center-letter">' + ch.toUpperCase() + '</span>';
        } else {
            html += ch.toUpperCase();
        }
    }
    currentWordEl.innerHTML = html || '&nbsp;';
}

// ─── Drag/Swipe Input ─────────────────
function setupDragInput() {
    if (!honeycombArea) return;

    // Create drag preview element
    dragPreviewEl = document.createElement('div');
    dragPreviewEl.className = 'drag-preview hidden';
    honeycombArea.parentNode.insertBefore(dragPreviewEl, honeycombArea);

    // Mouse events
    honeycombArea.addEventListener('mousedown', function(e) {
        var cell = getHexCellFromPoint(e.clientX, e.clientY);
        if (!cell) return;
        e.preventDefault();
        startDrag(cell);
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        continueDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        endDrag();
    });

    // Touch events
    honeycombArea.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        var touch = e.touches[0];
        var cell = getHexCellFromPoint(touch.clientX, touch.clientY);
        if (!cell) return;
        e.preventDefault();
        startDrag(cell);
    }, { passive: false });

    honeycombArea.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        if (e.touches.length !== 1) return;
        var touch = e.touches[0];
        continueDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    honeycombArea.addEventListener('touchend', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        endDrag();
    });

    honeycombArea.addEventListener('touchcancel', function() {
        cancelDrag();
    });

    document.addEventListener('mouseleave', function() {
        if (isDragging) cancelDrag();
    });
}

function getHexCellFromPoint(x, y) {
    var cells = honeycombArea.querySelectorAll('.hex-cell');
    if (cells.length === 0) return null;

    var closest = null;
    var closestDist = Infinity;
    var maxR = 0;

    for (var i = 0; i < cells.length; i++) {
        var rect = cells[i].getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        if (i === 0) maxR = rect.width;
        var dx = x - cx;
        var dy = y - cy;
        var dist = dx * dx + dy * dy;
        if (dist < closestDist) {
            closestDist = dist;
            closest = cells[i];
        }
    }

    if (closest && closestDist > maxR * maxR) return null;
    return closest;
}

function startDrag(cell) {
    var letter = cell.dataset.letter;
    if (!letter) return;

    isDragging = true;
    dragJustEnded = false;
    lastDragCellEl = cell;
    dragPath = [letter];

    // Don't clear currentWordBuffer here — if this turns out to be a
    // single tap we want to APPEND the letter. Buffer is cleared in
    // continueDrag when a real multi-cell swipe begins.

    updateDragVisuals();
}

function continueDrag(x, y) {
    if (!isDragging) return;
    var cell = getHexCellFromPoint(x, y);
    if (!cell) return;

    // Same physical cell as last — no action (prevents wobble re-entry)
    if (cell === lastDragCellEl) return;

    var letter = cell.dataset.letter;
    if (!letter) return;

    // First move to a second cell — this is a real swipe, clear the tap buffer
    if (dragPath.length === 1) {
        currentWordBuffer = '';
    }

    // Track the new cell
    lastDragCellEl = cell;
    dragPath.push(letter);
    updateDragVisuals();
}

function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    lastDragCellEl = null;

    // Single-cell "drag" = tap — append letter to word buffer instead of submitting
    if (dragPath.length === 1) {
        var tappedLetter = dragPath[0];
        clearDragVisuals();
        dragPath = [];

        // Suppress the click event that fires after touchend
        dragJustEnded = true;
        setTimeout(function() { dragJustEnded = false; }, 150);

        // Append letter and animate
        currentWordBuffer += tappedLetter;
        renderCurrentWord();
        var cell = findCellByLetter(tappedLetter);
        if (cell) {
            cell.classList.remove('pop-animation');
            void cell.offsetWidth;
            cell.classList.add('pop-animation');
        }
        return;
    }

    // Multi-cell swipe — submit as word
    dragJustEnded = true;
    setTimeout(function() { dragJustEnded = false; }, 150);

    var word = dragPath.join('');
    clearDragVisuals();
    dragPath = [];

    if (word.length >= 3) {
        submitToServer(word);
    } else if (word.length > 0) {
        showIncorrect(word, 'too_short');
    }

    renderCurrentWord();
}

function cancelDrag() {
    isDragging = false;
    lastDragCellEl = null;
    dragJustEnded = true;
    setTimeout(function() { dragJustEnded = false; }, 150);
    dragPath = [];
    clearDragVisuals();
}

function updateDragVisuals() {
    var allCells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < allCells.length; i++) {
        allCells[i].classList.remove('drag-active');
    }

    var letterMap = {};
    for (var j = 0; j < dragPath.length; j++) {
        letterMap[dragPath[j]] = true;
    }
    for (var k = 0; k < allCells.length; k++) {
        if (letterMap[allCells[k].dataset.letter]) {
            allCells[k].classList.add('drag-active');
        }
    }

    var word = dragPath.join('').toUpperCase();
    if (word.length > 0) {
        dragPreviewEl.textContent = word;
        dragPreviewEl.classList.remove('hidden');
    } else {
        dragPreviewEl.classList.add('hidden');
    }

    updateDragLines();
}

function updateDragLines() {
    if (!svgOverlay || !honeycombArea.contains(svgOverlay)) {
        svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgOverlay.setAttribute('class', 'drag-svg-overlay');
        honeycombArea.appendChild(svgOverlay);
    }

    while (svgOverlay.firstChild) svgOverlay.removeChild(svgOverlay.firstChild);

    if (dragPath.length < 2) return;

    var containerRect = honeycombArea.getBoundingClientRect();
    svgOverlay.setAttribute('width', containerRect.width);
    svgOverlay.setAttribute('height', containerRect.height);

    for (var i = 0; i < dragPath.length - 1; i++) {
        var cellA = findCellByLetter(dragPath[i]);
        var cellB = findCellByLetter(dragPath[i + 1]);
        if (!cellA || !cellB) continue;

        var rectA = cellA.getBoundingClientRect();
        var rectB = cellB.getBoundingClientRect();

        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', rectA.left + rectA.width / 2 - containerRect.left);
        line.setAttribute('y1', rectA.top + rectA.height / 2 - containerRect.top);
        line.setAttribute('x2', rectB.left + rectB.width / 2 - containerRect.left);
        line.setAttribute('y2', rectB.top + rectB.height / 2 - containerRect.top);
        line.setAttribute('class', 'drag-line');
        svgOverlay.appendChild(line);
    }
}

function findCellByLetter(letter) {
    var cells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < cells.length; i++) {
        if (cells[i].dataset.letter === letter) return cells[i];
    }
    return null;
}

function clearDragVisuals() {
    var allCells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < allCells.length; i++) {
        allCells[i].classList.remove('drag-active');
    }
    if (dragPreviewEl) {
        dragPreviewEl.classList.add('hidden');
        dragPreviewEl.textContent = '';
    }
    if (svgOverlay) {
        while (svgOverlay.firstChild) svgOverlay.removeChild(svgOverlay.firstChild);
    }
}

// ─── Top Players ───
function renderTopPlayers(players) {
    if (!players || players.length === 0) {
        topPlayersEl.innerHTML = '';
        return;
    }

    var tiers = ['gold', 'silver', 'bronze'];
    var crowns = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    var html = '';

    for (var i = 0; i < Math.min(players.length, 3); i++) {
        var p = players[i];
        var name = p.displayName || p.name || 'Anonymous';
        var avatarSrc = resolveAvatar(p.profileImage);
        var isLogo = avatarSrc === AVATAR_FALLBACK;
        var avatarHtml = '<img class="top-player-avatar' + (isLogo ? ' avatar-is-logo' : '') + '" src="' + avatarSrc.replace(/"/g, '&quot;') + '" alt="" onerror="this.onerror=null;this.src=\'' + AVATAR_FALLBACK + '\';this.classList.add(\'avatar-is-logo\')">';

        html += '<div class="top-player-card ' + tiers[i] + '">' +
            '<div class="top-player-avatar-wrap">' +
                '<span class="top-player-crown">' + crowns[i] + '</span>' +
                avatarHtml +
            '</div>' +
            '<span class="top-player-name">' + escapeHtml(name) + '</span>' +
            '<span class="top-player-score">' + (p.score || 0) + '</span>' +
        '</div>';
    }
    topPlayersEl.innerHTML = html;
}

// ─── Guess Result ───
function handleGuessResult(result) {
    if (!result) return;
    var submitted=pendingGuess;clearPendingGuess();
    if(result.valid===false && ['storage_unavailable','round_changed','auth_required','blocked'].indexOf(result.result)!==-1){showToast(result.error || 'Please retry. Your word is retained.');return;}
    if (result.valid) {
        // Word accepted — clear buffer
        if(!submitted || currentWordBuffer===submitted)currentWordBuffer = '';
        renderCurrentWord();
    } else {
        var reason = result.result || result.error || 'incorrect';
        showIncorrect(result.word || submitted || currentWordBuffer, reason);
        if(!submitted || currentWordBuffer===submitted)currentWordBuffer = '';
        renderCurrentWord();
    }
}

// ─── Win / Game Over ───
var countdownTimer = null;
// When the page is embedded as part of a streamer broadcast (?obs=1), the
// streamer-overlay system renders its own winCard widget for the game-win
// event. Showing this internal mp.html win overlay on top duplicates the
// notification and obscures the gameEmbed widget. Skip when obs flag is on.
function _isObsEmbed() {
    try {
        var qp = new URLSearchParams(location.search);
        return qp.get('obs') === '1' || qp.get('streamer_self') === '1';
    } catch (e) { return false; }
}
function showWin(data) {
    if (_isObsEmbed()) {
        // Still drive the local countdown for state visibility — the
        // overlay just stays hidden.
        if (countdownTimer) clearInterval(countdownTimer);
        var c = data && data.countdown ? data.countdown : 30;
        countdownTimer = setInterval(function () {
            c--;
            if (c <= 0) { clearInterval(countdownTimer); countdownTimer = null; }
        }, 1000);
        return;
    }
    // Streamer sessions: the round-end 'game-win' event (winner + top-10
    // standings) already drove the shared win card via handleGameWin.
    if (window.__SESSION_HANDLE) return;
    // The public room gets no in-page 'game-win' — build the same card from
    // the game-over stats (stats.leaderboard carries full player objects).
    if (!window.WinCard) return;
    var stats = (data && data.stats) || {};
    var lb = Array.isArray(stats.leaderboard) ? stats.leaderboard : [];
    if (!lb.length) return;
    var mapP = function (p) {
        return {
            displayName: p.displayName || p.username,
            username: p.username,
            platform: p.platform,
            platformUserId: p.platformUserId || p.username,
            linkedDiscord: p.linkedDiscord || null,
            profilePic: p.avatar || null,
            cosmetics: p.cosmetics || null,
            points: p.score || 0
        };
    };
    var countdown = (data && data.countdown) || 30;
    WinCard.showMp({
        game: 'spellingbee',
        gameName: 'Spelling Bee',
        winner: mapP(lb[0]),
        topPlayers: lb.slice(0, 10).map(mapP),
        guessCount: lb[0].words ? lb[0].words.length : 0,
        jackpot: stats.jackpot || 0,
        autoHideMs: countdown * 1000 // card stays up until the next puzzle starts
    });
}

// ─── Keyboard (desktop letter keys, no text input) ───
function setupKeyboard() {
    document.addEventListener('keydown', function(e) {
        if (!gameUI || gameUI.style.display === 'none') return;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

        if (e.key === 'Enter') {
            e.preventDefault();
            if (currentWordBuffer.length > 0) {
                submitToServer(currentWordBuffer);
            }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (currentWordBuffer.length > 0) {
                currentWordBuffer = currentWordBuffer.slice(0, -1);
                renderCurrentWord();
            }
            return;
        }
        var ch = e.key.toLowerCase();
        if (ch.length === 1 && /^[a-z]$/.test(ch) && localLetters.indexOf(ch) !== -1) {
            e.preventDefault();
            currentWordBuffer += ch;
            renderCurrentWord();
            var cell = findCellByLetter(ch);
            if (cell) {
                cell.classList.remove('pop-animation');
                void cell.offsetWidth;
                cell.classList.add('pop-animation');
            }
        }
    });
}

function setupActions() {
    btnDelete.onclick = function() {
        if (currentWordBuffer.length > 0) {
            currentWordBuffer = currentWordBuffer.slice(0, -1);
            renderCurrentWord();
        }
    };

    btnShuffle.onclick = function() {
        var outer = localLetters.slice(1);
        for (var i = outer.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = outer[i];
            outer[i] = outer[j];
            outer[j] = temp;
        }
        localLetters = [localLetters[0]].concat(outer);
        renderHoneycomb();
    };

    btnSubmit.onclick = function() {
        if (currentWordBuffer.length > 0) {
            submitToServer(currentWordBuffer);
        }
    };
}

function clearPendingGuess(){if(pendingGuessTimer)clearTimeout(pendingGuessTimer);pendingGuessTimer=null;pendingGuess=null;if(btnSubmit)btnSubmit.disabled=false;}
function submitToServer(word) {
    if (!socket || !socket.connected) {showToast('Connection unavailable. Your word is retained.');return;}
    if(pendingGuess)return;
    if(typeof word!=='string'||word.length>128)return;
    if (!user && !guestName) return;
    var data = { word: word };
    if (user) {
        data.platform = 'discord';
        data.platformUserId = user.id;
        data.displayName = user.globalName || user.username;
        data.linkedDiscord = user.id;
        data.profilePic = user.avatar || DEFAULT_AVATAR;
    } else {
        data.platform = 'web';
        data.platformUserId = 'web_' + guestName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        data.displayName = guestName;
        data.profilePic = DEFAULT_AVATAR;
    }
    currentWordBuffer=word;renderCurrentWord();
    pendingGuess=word;if(btnSubmit)btnSubmit.disabled=true;
    pendingGuessTimer=setTimeout(function(){clearPendingGuess();showToast('No response yet. Your word is retained; retry when connected.');},12000);
    socket.emit('guess', data);
}

// ─── Stats ───
function setupStatsToggle() {
    document.getElementById('stats-toggle').onclick = function() {
        statsDropdown.classList.toggle('hidden');
        if (!statsDropdown.classList.contains('hidden')) fetchStats();
    };
}

function setupCheatSheet() {
    if (!window.SpellingBeeCheatSheet) return;
    window.SpellingBeeCheatSheet.init();
}

function fetchStats() {
    fetch('/api/me/spellingbee')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.ok) {
                document.getElementById('stat-words').textContent = data.totalWordsFound || 0;
                document.getElementById('stat-games').textContent = data.gamesParticipated || 0;
                document.getElementById('stat-pangrams').textContent = data.totalPangrams || 0;
                document.getElementById('stat-score').textContent = data.totalScore || 0;
            }
        })
        .catch(function() {});
}

// ─── Incorrect Feedback ───
function showIncorrect(word, reason) {
    var tag = document.createElement('span');
    var cls, text;
    if (reason === 'already_found') {
        cls = 'already-found-tag';
        text = (word || '').toUpperCase();
    } else if (reason === 'too_short') {
        cls = 'too-short-tag';
        text = 'Too short';
    } else if (reason === 'missing_center') {
        cls = 'missing-center-tag';
        text = 'Missing center letter';
    } else if (reason === 'not_active') {
        cls = 'too-short-tag';
        text = 'Game not active';
    } else {
        cls = 'incorrect-word';
        text = (word || '').toUpperCase();
    }
    tag.className = cls;
    tag.textContent = text;
    incorrectArea.appendChild(tag);

    currentWordEl.classList.remove('shake');
    void currentWordEl.offsetWidth;
    currentWordEl.classList.add('shake');

    setTimeout(function() {
        tag.classList.add('fading');
        setTimeout(function() {
            if (tag.parentNode) tag.parentNode.removeChild(tag);
        }, 400);
    }, 1500);
}

// ─── Daily / Frenzy Badges ───
function renderDaily(isDailyFlag) {
    if (!dailyBadgeEl) return;
    if (isDailyFlag) {
        dailyBadgeEl.classList.remove('hidden');
    } else {
        dailyBadgeEl.classList.add('hidden');
    }
}

function renderFrenzy(frenzy) {
    if (!frenzyBadgeEl) return;
    if (frenzy && frenzy.multiplier > 1.0) {
        frenzyMultiplierEl.textContent = frenzy.multiplier.toFixed(1) + 'x';
        frenzyBadgeEl.classList.remove('hidden');
    } else {
        frenzyBadgeEl.classList.add('hidden');
    }
}

// ─── Helpers ───
function showToast(msg) {
    errorToast.textContent = msg;
    errorToast.classList.remove('hidden');
}

function hideToast() {
    errorToast.classList.add('hidden');
}

function showError(msg) {
    showToast(msg);
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ─── Monthly hint button ───
function initHintButton() {
    if (!window.WTHints) return;
    var hintWrap = document.getElementById('hint-btn-wrap');
    if (!hintWrap) return;
    var handle = null;
    try { handle = window.__SESSION_HANDLE || null; } catch (_) {}

    WTHints.init({
        container: hintWrap,
        game: 'spellingbee',
        extraBody: { handle: handle || 'public' },
        onSuccess: function (data) {
            if (data && data.hint) showHint(data.hint);
        },
        onError: function (msg) {
            showError(msg || 'Hint failed');
        }
    });
}

function showHint(hint) {
    if (!hint || !hint.letter) return;
    showToast('Hint: the letters include ' + hint.letter);
}

// ─── Bootstrap ───
function bootstrap() {
    initDom();
    checkAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}

})();

// ─── Word-found hex animation ──────────────────────────────────────
// Walks the letters of a newly-found word and pulses each matching
// .hex-cell on the honeycomb with a staggered glow. Pangrams (all 7
// letters used) get a richer rainbow effect on every cell. Lives
// OUTSIDE the IIFE above (globally callable from the socket handler)
// and queries the DOM directly so it doesn't depend on IIFE-scoped vars.
function animateHexesForWord(word, isPangram) {
    var honeycombArea = document.getElementById('honeycomb-area');
    if (!word || !honeycombArea) return;
    var letters = String(word).toLowerCase().split('');
    var cells = honeycombArea.querySelectorAll('.hex-cell');
    var byLetter = {};
    cells.forEach(function(c) {
        var l = (c.dataset.letter || '').toLowerCase();
        if (!byLetter[l]) byLetter[l] = [];
        byLetter[l].push(c);
    });
    if (isPangram) {
        cells.forEach(function(c, i) {
            c.classList.remove('word-found-pangram');
            void c.offsetWidth;
            c.style.animationDelay = (i * 60) + 'ms';
            c.classList.add('word-found-pangram');
            setTimeout(function () {
                c.classList.remove('word-found-pangram');
                c.style.animationDelay = '';
            }, 1000 + i * 60);
        });
        return;
    }
    var stepMs = 70;
    letters.forEach(function(l, i) {
        var matches = byLetter[l];
        if (!matches || !matches.length) return;
        var cell = matches[0];
        setTimeout(function() {
            cell.classList.remove('word-found-pulse');
            void cell.offsetWidth;
            cell.classList.add('word-found-pulse');
            setTimeout(function () { cell.classList.remove('word-found-pulse'); }, 620);
        }, i * stepMs);
    });
}

function celebrateWordFound(entry) {
    if (!entry || !entry.word) return;
    var streakCount = _sbUpdatePlayerStreak(entry);
    _sbShowXpFloat(entry, streakCount);
    _sbPulseScore();

    var word = String(entry.word || '');
    if (entry.isPangram) {
        _sbShowAchievement('PANGRAM', '+' + (entry.score || 0) + ' XP', 'pangram');
    } else if (entry.isHidden) {
        _sbShowAchievement('ULTRA RARE', word.toUpperCase(), 'hidden');
    } else if (entry.isRare) {
        _sbShowAchievement('RARE FIND', word.toUpperCase(), 'rare');
    } else if (word.length >= 9) {
        _sbShowAchievement('MONSTER WORD', word.length + ' letters', 'long');
    } else if (word.length >= 7) {
        _sbShowAchievement('LONG WORD', word.length + ' letters', 'long');
    }

    if (streakCount >= 3) {
        var player = entry.player || entry.displayName || 'Player';
        _sbShowAchievement(streakCount + 'X STREAK', _sbTrimTickerName(player, 18), 'streak');
    }
}

function _sbFeedbackState() {
    if (!window.__spellingBeeFeedbackState) {
        window.__spellingBeeFeedbackState = {
            streaks: {},
            burstIndex: 0,
            floatIndex: 0
        };
    }
    return window.__spellingBeeFeedbackState;
}

function _sbFeedbackLayer() {
    var layer = document.getElementById('mp-feedback-layer');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'mp-feedback-layer';
    layer.className = 'mp-feedback-layer';
    document.body.appendChild(layer);
    return layer;
}

function _sbPlayerKey(entry) {
    return entry.playerKey || [entry.platform || 'web', entry.platformUserId || entry.player || 'anon'].join(':');
}

function _sbUpdatePlayerStreak(entry) {
    var state = _sbFeedbackState();
    var key = _sbPlayerKey(entry);
    var now = Date.now();
    var streak = state.streaks[key] || { count: 0, lastAt: 0 };
    streak.count = now - streak.lastAt <= 30000 ? streak.count + 1 : 1;
    streak.lastAt = now;
    state.streaks[key] = streak;
    return streak.count;
}

function _sbShowXpFloat(entry, streakCount) {
    var layer = _sbFeedbackLayer();
    var anchor = document.getElementById('honeycomb-area') || document.getElementById('current-word') || document.body;
    var rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    var state = _sbFeedbackState();
    var el = document.createElement('div');
    var variant = entry.isPangram ? 'pangram' : entry.isHidden ? 'hidden' : entry.isRare ? 'rare' : 'common';
    el.className = 'xp-float xp-' + variant;
    el.style.left = Math.round(rect.left + rect.width * (0.32 + Math.random() * 0.36)) + 'px';
    el.style.top = Math.round(rect.top + rect.height * (0.22 + Math.random() * 0.18)) + 'px';
    el.style.setProperty('--x-drift', ((state.floatIndex % 2 === 0 ? -1 : 1) * (18 + Math.random() * 28)).toFixed(0) + 'px');
    state.floatIndex++;

    var xp = document.createElement('span');
    xp.className = 'xp-float-main';
    xp.textContent = '+' + (entry.score || 0) + ' XP';
    var meta = document.createElement('span');
    meta.className = 'xp-float-meta';
    meta.textContent = _sbXpMeta(entry, streakCount);
    el.appendChild(xp);
    el.appendChild(meta);
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1450);
}

function _sbXpMeta(entry, streakCount) {
    var parts = [];
    if (entry.player) parts.push(_sbTrimTickerName(entry.player, 16));
    if (entry.isPangram) parts.push('PANGRAM');
    else if (entry.isHidden) parts.push('ULTRA');
    else if (entry.isRare) parts.push('RARE');
    if (streakCount >= 3) parts.push(streakCount + 'X');
    return parts.join(' / ') || String(entry.word || '').toUpperCase();
}

function _sbShowAchievement(title, detail, variant) {
    var layer = _sbFeedbackLayer();
    var state = _sbFeedbackState();
    var el = document.createElement('div');
    el.className = 'achievement-burst achievement-' + (variant || 'common');
    el.style.setProperty('--burst-slot', state.burstIndex % 4);
    state.burstIndex++;

    var titleEl = document.createElement('span');
    titleEl.className = 'achievement-title';
    titleEl.textContent = title;
    var detailEl = document.createElement('span');
    detailEl.className = 'achievement-detail';
    detailEl.textContent = detail || '';
    el.appendChild(titleEl);
    el.appendChild(detailEl);
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1900);
}

function _sbPulseScore() {
    var score = document.getElementById('score-val');
    if (!score) return;
    score.classList.remove('score-kick');
    void score.offsetWidth;
    score.classList.add('score-kick');
}

function _sbTrimTickerName(name, max) {
    name = String(name || '');
    if (name.length <= max) return name;
    return name.slice(0, Math.max(1, max - 3)) + '...';
}

// ─── Live guess ticker ─────────────────────────────────────────────
function addGuessToTicker(attempt) {
    var ticker = document.getElementById('guess-ticker');
    if (!ticker || !attempt || !attempt.word) return;
    var word = String(attempt.word).toUpperCase();
    var pill = document.createElement('span');
    pill.className = 'guess-pill ' + _guessRarityClass(attempt);
    var player = attempt.player ? _sbTrimTickerName(attempt.player, 13) + ' / ' : '';
    var suffix = attempt.valid && attempt.score ? ' +' + attempt.score : (!attempt.valid ? ' MISS' : '');
    pill.textContent = player + word + suffix;
    var lane = window.__spellingBeeTickerLane || 0;
    window.__spellingBeeTickerLane = (lane + 1) % 2;
    pill.style.setProperty('--ticker-lane', lane);
    pill.style.setProperty('--ticker-speed', Math.max(8, Math.min(11, 7.5 + word.length * 0.22)) + 's');
    ticker.appendChild(pill);
    pill.addEventListener('animationend', function () {
        if (pill.parentNode) pill.parentNode.removeChild(pill);
    });
    while (ticker.children.length > 24) {
        ticker.removeChild(ticker.firstElementChild);
    }
}

function _guessRarityClass(a) {
    if (!a || !a.valid) return 'r-invalid';
    if (a.isPangram) return 'r-pangram';
    if (a.isHidden) return 'r-hidden';
    if (a.isRare) return 'r-rare';
    if (a.isThreeLetter) return 'r-three-letter';
    return 'r-common';
}
