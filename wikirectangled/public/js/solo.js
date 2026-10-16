// solo.js - Solo mode client (daily).
// Mirrors main.js — same layout, renderers, and effects as the multiplayer
// page. Only the lifecycle differs: everything is per-socket, the daily
// puzzle auto-starts on load (no mode picker), and there's an explicit
// end-run + end-overlay with the daily share card.

function withHubSocketPath(options = {}) {
  if (window.location.pathname.startsWith('/game/wikirectangled')) {
    return { path: '/game/wikirectangled/socket.io', ...options };
  }
  return options;
}

const socket = io(withHubSocketPath({ transports: ['polling', 'websocket'] }));

const $ = (sel) => document.querySelector(sel);
const els = {
  titleChips: $('#title-chips'),
  playersRow: $('#players-row'),
  foundWordsCard: $('#found-words-card'),
  foundWordsList: $('#found-words-list'),
  foundWordsCount: $('#found-words-count'),
  targetCards: $('#target-cards'),
  grid: $('#grid'),
  composer: $('#composer'),
  guessInput: $('#guess-input'),
  gridFound: $('#grid-found'),
  gridTotal: $('#grid-total'),
  titleFound: $('#title-found'),
  titleTotal: $('#title-total'),
  commonFound: $('#common-found'),
  commonTotal: $('#common-total'),
  winTitleFound: $('#win-title-found'),
  winTitleTotal: $('#win-title-total'),
  winCommonFound: $('#win-common-found'),
  winCommonTotal: $('#win-common-total'),
  winRareFound: $('#win-rare-found'),
  winRareTotal: $('#win-rare-total'),
  winUltraFound: $('#win-ultra-found'),
  winUltraTotal: $('#win-ultra-total'),
  endOverlay: $('#solo-end-overlay'),
  endTitle: $('#solo-end-title'),
  endArticle: $('#solo-end-article'),
  endStats: $('#solo-end-stats'),
  endAgain: $('#solo-end-again'),
  endSolo: $('#end-solo'),
  renameLink: $('#rename-link'),
  logo: $('#logo'),
};

const NAME_KEY = 'wkt-display-name';
const SESSION_KEY = 'wkt-session-id';
function getDisplayName() { return localStorage.getItem(NAME_KEY) || 'You'; }
function setDisplayName(name) {
  const v = (name || '').trim().slice(0, 32) || 'You';
  localStorage.setItem(NAME_KEY, v);
  if (els.renameLink) els.renameLink.textContent = v;
  socket.emit('update-profile', { displayName: v });
}
if (els.renameLink) {
  els.renameLink.textContent = getDisplayName();
  els.renameLink.addEventListener('click', () => {
    const next = window.prompt('Display name:', getDisplayName());
    if (next != null) setDisplayName(next);
  });
}

let _hubUser = null;
function identify() {
  const sessionId = localStorage.getItem(SESSION_KEY) || null;
  const payload = {
    sessionId,
    displayName: getDisplayName(),
  };
  if (_hubUser && _hubUser.id) {
    payload.discordUserId = _hubUser.id;
    payload.discordDisplayName = _hubUser.displayName || _hubUser.globalName || _hubUser.username;
    if (_hubUser.avatar) payload.discordAvatar = _hubUser.avatar;
  }
  socket.emit('identify', payload);
}

// Auth: check wordtycoon.live SSO session and use Discord identity if present.
// The daily auto-start is gated on this fetch settling so the run is created
// under the player's real identity (daily PB is keyed to identityKey).
const HUB_ORIGIN = 'https://wordtycoon.live';
const HUB_API = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) ? HUB_ORIGIN : '';
function consumeSoloAuthToken() {
  const url = new URL(location.href), token = url.searchParams.get('auth_token');
  if (!token) return Promise.resolve();
  url.searchParams.delete('auth_token');
  history.replaceState({}, '', url.pathname + url.search + url.hash);
  return fetch(HUB_API + '/api/auth/exchange?token=' + encodeURIComponent(token), { credentials: 'include' }).then(response => {
    if (response.ok) location.replace(url.pathname + url.search + url.hash);
  });
}
let _hubSettled = false;
let _identified = false;
let _started = false;
let _completed = false;
let activeSoloMode = 'daily';
let currentState = null;
let _dailyDateStr = '';

fetch('/api/daily').then((r) => r.json()).then((r) => {
  if (r && r.puzzleDate) _dailyDateStr = r.puzzleDate;
}).catch(() => {});

consumeSoloAuthToken().then(() => fetch(HUB_API + '/api/me/session', { credentials: 'include' }))
  .then((r) => r.ok ? r.json() : null)
  .then((data) => {
    if (data && data.ok && data.user) {
      _hubUser = data.user;
      const dn = data.user.displayName || data.user.globalName || data.user.username;
      if (dn) {
        localStorage.setItem(NAME_KEY, dn);
        if (els.renameLink) els.renameLink.textContent = dn;
      }
      identify();
    }
  })
  .catch(() => {})
  .finally(() => { _hubSettled = true; maybeAutoStart(); });

socket.on('connect', identify);
socket.on('identified', (msg) => {
  if (msg && msg.sessionId) localStorage.setItem(SESSION_KEY, msg.sessionId);
  if (msg && msg.displayName) { localStorage.setItem(NAME_KEY, msg.displayName); if (els.renameLink) els.renameLink.textContent = msg.displayName; }
  _identified = true;
  if (_started && !_completed) {
    // Reconnect mid-run: re-emit start-solo to rebind this socket to the
    // existing server-side session (startSolo returns it unchanged).
    startMode(activeSoloMode);
  } else {
    maybeAutoStart();
  }
});

// Auto-play the daily: no intro screen, no daily/practice picker. Starts once
// the socket is identified AND the hub SSO check has settled (so the run is
// owned by the right identity from guess #1).
function maybeAutoStart() {
  if (_started || !_hubSettled || !_identified) return;
  _started = true;
  startMode('daily');
}

let _startRetries = 0;
function startMode(mode) {
  socket.emit('start-solo', { mode }, (ack) => {
    if (ack && ack.ok) {
      _startRetries = 0;
      activeSoloMode = mode;
      soloStatus(els.guessInput.value.trim() ? 'Connected. Your guess is still here.' : 'Connected. Ready to play.');
      _sfx('soloStart');
      els.endOverlay.classList.add('hidden');
      if (window.WinCard) window.WinCard.hide(); // dismiss a sticky win card from the previous run
      _completed = !!ack.completed;
      if (_completed) showEndOverlay({ reason: 'complete', recovered: true }, currentState);
      els.guessInput.focus();
      return;
    }
    // Boot race (trie/daily still building) — retry quietly before surfacing.
    if (_startRetries < 5) {
      _startRetries++;
      setTimeout(() => startMode(mode), 2500);
    } else {
      alert('Could not start solo: ' + ((ack && ack.error) || 'unknown'));
    }
  });
}

// Hide logo if the file isn't there yet — placeholder text fills the gap.
if (els.logo) {
  els.logo.addEventListener('error', () => {
    const replacement = document.createElement('div');
    replacement.textContent = 'WiKirecTangled';
    replacement.style.fontFamily = 'Fredoka, sans-serif';
    replacement.style.fontWeight = 700;
    replacement.style.fontSize = '1.6rem';
    replacement.style.color = 'var(--accent-orange)';
    els.logo.replaceWith(replacement);
  });
}

let lastState = null;

let _lastTitleRevealed = -1;
function render(state) {
  if (state) {
    // targetCardPop: fire when a NEW word enters the top-5 cards
    const _newTargetWords = new Set((state.targets || []).map((t) => t && t.word).filter(Boolean));
    const _prev = window._lastTargetCardWords || new Set();
    let _newEntry = false;
    for (const w of _newTargetWords) { if (!_prev.has(w)) { _newEntry = true; break; } }
    if (_newEntry && _prev.size > 0) {
      // skip if previous set was empty (round-start init), only fire after at least one prior render
      if (window.SFX) _sfx('targetCardPop');
    }
    window._lastTargetCardWords = _newTargetWords;

    // Phase-aware tier-tagged start cells. New shape: [{idx, tier}].
    // Old shape (numbers only) tolerated for backward compat.
    const _atsc = Array.isArray(state.activeTierStartCells) ? state.activeTierStartCells : [];
    const _idxSet = new Set();
    const _tierByIdx = new Map();
    for (const _entry of _atsc) {
      if (typeof _entry === 'number') {
        _idxSet.add(_entry);
      } else if (_entry && typeof _entry.idx === 'number') {
        _idxSet.add(_entry.idx);
        if (_entry.tier) _tierByIdx.set(_entry.idx, _entry.tier);
      }
    }
    window._commonStartCells = _idxSet;
    window._cellTierByIdx = _tierByIdx;
    window._activeCommonCells = new Set(state.activeCommonCells || []);
  }
  if (state) {
    const r = state.revealedTitleWordCount || 0;
    const t = state.titleWordCount || 0;
    if (t > 0 && r >= t && _lastTitleRevealed < t) {
      _sfx('titleRevealAll');
      requestAnimationFrame(() => {
        const strip = els.titleChips;
        if (!strip) return;
        strip.classList.remove('shimmering');
        void strip.offsetWidth;
        strip.classList.add('shimmering');
        strip.addEventListener('animationend', function onEnd(e) {
          if (e.animationName !== 'titleStripShimmer') return;
          strip.classList.remove('shimmering');
          strip.removeEventListener('animationend', onEnd);
        });
      });
    }
    _lastTitleRevealed = r;
  }
  if (!state) return;
  if (state.totalRankedWords) window._totalRankedWords = state.totalRankedWords;
  lastState = state;
  renderTitleChips(state.titleChips || [], (state.articleTitle || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim());
  renderPlayers(state.topPlayers || []);
  renderFoundWords(state.foundWords || []);
  renderTargets(state.targets || []);
  window._tierPhase = state.currentTierPhase || null;  // A4
  // Tier-search status line — shown below the title chip strip once every
  // title chip has been revealed. Tells viewers which word-tier the round
  // is still hunting (common / rare / ultra). Hidden during title-reveal
  // phase and once the round is complete.
  (function _renderTierStatus() {
    var el = document.getElementById('title-tier-status');
    if (!el) return;
    var chips = state.titleChips || [];
    var titleDone = chips.length > 0 && chips.every(function (c) { return c && c.revealed; });
    var phase = state.currentTierPhase;
    if (!titleDone || !phase || phase === 'complete') {
      el.setAttribute('data-active', 'false');
      el.removeAttribute('data-tier');
      el.textContent = '';
      return;
    }
    el.textContent = 'Searching for ' + phase + ' words';
    el.setAttribute('data-tier', phase);
    el.setAttribute('data-active', 'true');
  })();
  const gridRebuilt = renderGrid(state.grid || [], state.rows || 0, state.cols || 0);
  if (!gridRebuilt) _refreshOutlines();
  if (els.gridFound) els.gridFound.textContent = state.foundCount || 0;
  if (els.gridTotal) els.gridTotal.textContent = state.totalGridWords || 0;
  if (els.titleFound) els.titleFound.textContent = state.revealedTitleWordCount || 0;
  if (els.titleTotal) els.titleTotal.textContent = state.titleWordCount || 0;
  _renderTierProgress(state);
  if (els.winTitleFound) els.winTitleFound.textContent = state.revealedTitleWordCount || 0;
  if (els.winTitleTotal) els.winTitleTotal.textContent = state.titleWordCount || 0;
  if (els.winCommonFound) els.winCommonFound.textContent = state.foundCommonCount || 0;
  if (els.winCommonTotal) els.winCommonTotal.textContent = state.commonWordTarget || 0;
  if (els.winRareFound) els.winRareFound.textContent = state.foundRareCount || 0;
  if (els.winRareTotal) els.winRareTotal.textContent = state.rareWordTarget || 0;
  if (els.winUltraFound) els.winUltraFound.textContent = state.foundUltraCount || 0;
  if (els.winUltraTotal) els.winUltraTotal.textContent = state.ultraWordTarget || 0;
}

function renderTitleChips(chips, articleTitle) {
  els.titleChips.innerHTML = "";
  // A6 round-start chip-stagger counter — bumped as each chip is appended.
  let _a6_chipIdx = 0;
  function _a6_tag(span) { span.style.setProperty('--i', _a6_chipIdx++); }
  // A3 shimmer wave counter — bumped on every appended chip + connector so
  // the gold-edge stagger covers the whole strip evenly.
  let _a3_j = 0;
  function _a3_tag(node) { node.style.setProperty('--j', _a3_j++); }
  // A2 reveal: track which chips just flipped revealed → animate them.
  renderTitleChips._prevRevealed = renderTitleChips._prevRevealed || new Set();
  const _a2_just = new Set();
  for (const _c of chips) {
    if (_c && _c.revealed && !renderTitleChips._prevRevealed.has(_c.word)) _a2_just.add(_c.word);
  }
  const _a2_next = new Set();
  for (const _c of chips) if (_c && _c.revealed) _a2_next.add(_c.word);
  renderTitleChips._prevRevealed = _a2_next;
  function _a2_letters(span, text) {
    for (let i = 0; i < text.length; i++) {
      const s = document.createElement('span');
      s.className = 'ltr';
      s.style.setProperty('--i', i);
      s.textContent = text[i];
      span.appendChild(s);
    }
  }
  function _a2_attach(span, key) {
    if (!_a2_just.has(key)) return;
    span.classList.add('revealing');
    span.addEventListener('animationend', function onEnd(e) {
      if (e.animationName !== 'titleChipPulse') return;
      span.classList.remove('revealing');
      span.removeEventListener('animationend', onEnd);
    });
  }
  const allRevealed = chips.length > 0 && chips.every((c) => c && c.revealed);

  // === In-progress state: scrambled chips only, no static connectors ===
  if (!allRevealed) {
    // Stable shuffle by article-title seed so the order doesn't change on
    // every state broadcast within a round.
    const seedKey = (articleTitle || '') + '|' + chips.length;
    let seed = 0;
    for (let i = 0; i < seedKey.length; i++) seed = (seed * 31 + seedKey.charCodeAt(i)) | 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) | 0;
      return ((seed >>> 0) % 1000) / 1000;
    };
    const order = chips.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const c = chips[idx];
      if (!c) continue;
      const span = document.createElement("span");
      span.className = "title-chip" + (c.revealed ? "" : " hidden-word");
      if (c.revealed) _a2_letters(span, c.word.toUpperCase());
      else span.textContent = "HIDDEN";
      const ico = document.createElement("span");
      ico.className = "ico";
      span.appendChild(ico);
      _a6_tag(span); _a3_tag(span);
      els.titleChips.appendChild(span);
      if (c.revealed && c.finder && c.finder.platform && c.finder.platformUserId) {
        applyCosmeticTo(null, span, c.finder.platform, c.finder.platformUserId, { skipTitle: true });
      }
      if (c.revealed) _a2_attach(span, c.word);
    }
    return;
  }

  // === Fully-revealed state: render the proper article title with connectors ===
  if (!articleTitle) {
    for (const c of chips) {
      const span = document.createElement("span");
      span.className = "title-chip";
      _a2_letters(span, c.word.toUpperCase());
      const ico = document.createElement("span");
      ico.className = "ico";
      span.appendChild(ico);
      _a6_tag(span); _a3_tag(span);
      els.titleChips.appendChild(span);
      if (c.finder && c.finder.platform && c.finder.platformUserId) {
        applyCosmeticTo(null, span, c.finder.platform, c.finder.platformUserId, { skipTitle: true });
      }
      _a2_attach(span, c.word);
    }
    return;
  }
  const chipByNorm = new Map();
  for (const c of chips) {
    if (c.word && !chipByNorm.has(c.word)) chipByNorm.set(c.word, c);
  }
  const tokens = articleTitle.split(/([^a-zA-Z]+)/).filter(Boolean);
  for (const tok of tokens) {
    if (!/[a-zA-Z]/.test(tok)) {
      els.titleChips.appendChild(document.createTextNode(tok));
      continue;
    }
    const norm = tok.toLowerCase();
    const chip = chipByNorm.get(norm);
    if (chip) {
      const span = document.createElement("span");
      span.className = "title-chip";
      _a2_letters(span, tok.toUpperCase());
      const ico = document.createElement("span");
      ico.className = "ico";
      span.appendChild(ico);
      _a6_tag(span); _a3_tag(span);
      els.titleChips.appendChild(span);
      if (chip.finder && chip.finder.platform && chip.finder.platformUserId) {
        applyCosmeticTo(null, span, chip.finder.platform, chip.finder.platformUserId, { skipTitle: true });
      }
      _a2_attach(span, norm);
    } else {
      const span = document.createElement("span");
      span.className = "title-static";
      span.textContent = tok;
      _a3_tag(span);
      els.titleChips.appendChild(span);
    }
  }
}

// Perk badge (Super Donor / Super Fan / Donor Class / Fan Club).
//
// The socket payload only ever carries isFanClub - relay-client.js pulls just
// 'fan-club' out of user.badges, and resolveWebSession() has no perk fields at
// all, so session.isSuperfan / session.isDonor are read all the way down the
// chain but never assigned. A Super Donor therefore arrived here looking like
// a plain Fan Club member.
//
// So: paint what the payload claims immediately (no flicker, no wait), then
// ask the hub for the real class and re-apply. PerkBadges.apply is idempotent
// and diffs on the perk signature, so the second call is a no-op unless it
// actually upgrades the tier.
function applyPerkBadge(el, user) {
  if (!el || !window.PerkBadges) return;
  try { window.PerkBadges.apply(el, user); } catch (e) { return; }
  const p = user && user.platform;
  const u = user && user.platformUserId;
  if (!p || !u || !window.cosmeticsCache || !window.cosmeticsCache.getPlayerPerks) return;
  window.cosmeticsCache.getPlayerPerks(p, u).then((perks) => {
    // The node may have been re-rendered out from under us mid-fetch.
    if (!el.isConnected) return;
    // user's own flags stay in the merge: readPerks ORs them, so a payload
    // that DID know about fan club can't be downgraded by a hub blip.
    window.PerkBadges.apply(el, Object.assign({}, user, perks));
  }).catch(() => {});
}

// Player avatar: a .pfp div that holds either an <img> or fallback initial text.
function makePfp(player) {
  const div = document.createElement('div');
  div.className = 'pfp';
  applyPerkBadge(div, player);
  if (player.profileImage) {
    const img = document.createElement('img');
    img.src = player.profileImage;
    img.style.width = '100%'; img.style.height = '100%'; img.style.borderRadius = '50%';
    img.onerror = () => { img.remove(); div.textContent = (player.displayName || '?')[0].toUpperCase(); };
    div.appendChild(img);
  } else {
    div.textContent = (player.displayName || '?')[0].toUpperCase();
  }
  return div;
}

// applyCosmeticTo — same as main.js: delegates to WikiCosmetics.apply with a
// legacy `[Title]` bracket fallback. No-ops without cosmeticsCache.
function applyCosmeticTo(avatarEl, nameEl, platform, platformUserId, opts) {
  opts = opts || {};
  if (!platform || !platformUserId || !window.cosmeticsCache) return;
  window.cosmeticsCache.getPlayerCosmetics(platform, platformUserId).then((cos) => {
    if (!cos || Object.keys(cos).length === 0) return;
    if (window.WikiCosmetics) {
      window.WikiCosmetics.apply({
        surfaceEl: null,
        avatarEl: avatarEl || null,
        nameEl: nameEl || null,
        titleContainer: null,
      }, cos);
    } else {
      if (avatarEl && cos.profile_border) {
        if (cos.profile_border.border) avatarEl.style.border = cos.profile_border.border;
        if (cos.profile_border.boxShadow) avatarEl.style.boxShadow = cos.profile_border.boxShadow;
        if (cos.profile_border.animation) avatarEl.style.animation = cos.profile_border.animation;
      }
      if (nameEl) {
        if (cos.name_color) {
          if (cos.name_color.color) nameEl.style.color = cos.name_color.color;
          if (cos.name_color.animation) nameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow && cos.name_glow.textShadow) {
          nameEl.style.textShadow = cos.name_glow.textShadow;
        }
      }
    }
    if (nameEl && !opts.skipTitle && cos.title && cos.title.title) {
      const parent = nameEl.parentElement;
      if (parent) {
        const existing = parent.querySelector('.cosmetic-title');
        if (existing) existing.remove();
        const titleSpan = document.createElement('span');
        titleSpan.className = 'cosmetic-title';
        titleSpan.textContent = ' [' + cos.title.title + ']';
        if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
        if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
        if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
        nameEl.insertAdjacentElement('afterend', titleSpan);
      }
    }
  });
}

function renderPlayers(players) {
  els.playersRow.innerHTML = '';
  const ranks = ['first', 'second', 'third'];
  players.slice(0, 3).forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'player-card ' + (ranks[i] || '');
    card.appendChild(makePfp(p));
    const name = document.createElement('div'); name.className = 'pname'; name.textContent = p.displayName || '';
    const score = document.createElement('div'); score.className = 'pscore'; score.textContent = (p.score || 0).toLocaleString();
    card.appendChild(name); card.appendChild(score);
    els.playersRow.appendChild(card);
    applyCosmeticTo(card.querySelector(".pfp"), card.querySelector(".pname"), p.platform, p.platformUserId);
  });
}

function renderFoundWords(foundWords) {
  if (!els.foundWordsCard || !els.foundWordsList) return;
  els.foundWordsCard.style.display = '';
  if (els.foundWordsCount) els.foundWordsCount.textContent = foundWords.length;
  els.foundWordsList.innerHTML = '';
  if (!foundWords || foundWords.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'found-word-item found-word-empty';
    empty.innerHTML = '<span style="opacity:0.5;font-size:0.85rem;">None yet</span>';
    els.foundWordsList.appendChild(empty);
    return;
  }
  // Show only the most recent word — server returns newest-first (sorted by timestamp desc).
  const item = foundWords[0];
  const row = document.createElement('div');
  row.className = 'found-word-item';
  const name = (item.displayName || '?').slice(0, 18);
  const initial = name[0].toUpperCase();
  const pic = item.profileImage || null;
  const fcCls = '';
  let avatarHtml = '';
  if (pic) {
    avatarHtml = `<span class="fw-avatar-wrap${fcCls}"><img class="fw-avatar" src="${pic}" alt="" onerror="this.outerHTML='<div class=\\'fw-avatar fw-fallback\\'>${initial}</div>'"></span>`;
  } else {
    avatarHtml = `<span class="fw-avatar-wrap${fcCls}"><div class="fw-avatar fw-fallback">${initial}</div></span>`;
  }
  row.innerHTML = `
    ${avatarHtml}
    <span class="fw-finder-wrap">
      <span class="fw-finder">${name}</span>
    </span>
    <span class="fw-word">${(item.word || '').toUpperCase()}</span>
    <span class="fw-pts">+${(item.points || 0).toLocaleString()}</span>
  `;
  els.foundWordsList.appendChild(row);
  applyPerkBadge(row.querySelector('.fw-avatar-wrap'), item);
  applyCosmeticTo(row.querySelector(".fw-avatar") || row.querySelector(".fw-fallback"), row.querySelector(".fw-finder"), item.platform, item.platformUserId);
}

function fitText(el, minPx) {
  if (!el) return;
  el.style.fontSize = '';
  const style = getComputedStyle(el);
  let size = parseFloat(style.fontSize);
  minPx = minPx || 10;
  const available = el.clientWidth;
  const needed = el.scrollWidth;
  if (needed <= available || available <= 0) return;
  const ratio = available / needed;
  size = Math.max(minPx, Math.floor(size * ratio));
  el.style.fontSize = size + 'px';
}

function fitTargetCardText(card) {
  if (!card) return;
  fitText(card.querySelector('.tword'), 12);
  fitText(card.querySelector('.tname'), 10);
}

function renderTargets(targets) {
  // A1: ranked-list FLIP — snapshot positions by word before rebuilding DOM.
  const _a1_prev = new Map();
  for (const _n of [...els.targetCards.children]) {
    const _w = _n.dataset && _n.dataset.word;
    if (_w) _a1_prev.set(_w, _n.getBoundingClientRect());
  }
  const _a1_prevTop = els.targetCards.firstElementChild
    ? els.targetCards.firstElementChild.dataset.word : null;

  els.targetCards.innerHTML = '';
  const total = targets.length;
  targets.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'tcard';
    card.dataset.word = t.word || '';
    card.dataset.rank = (t.rank != null ? String(t.rank) : '');
    if (t.isTarget) card.classList.add('revealed');
    if (t.isPlaceholder) card.classList.add('placeholder');

    const body = document.createElement('div');
    body.className = 'tcard-body';
    // Rank-driven gradient: HSL hue interpolated green→purple on a logarithmic
    // scale against the round's totalRankedWords (matches Searchle's pattern).
    const _GREEN_HUE = 120, _PURPLE_HUE = 285;
    const _total = window._totalRankedWords || 1;
    let _gradT;
    if (t.rank != null && t.rank > 0 && _total > 1) {
      _gradT = Math.min(1, Math.log(Math.max(1, t.rank)) / Math.log(_total));
    } else {
      _gradT = 1;
    }
    const _hue = _GREEN_HUE + (_PURPLE_HUE - _GREEN_HUE) * _gradT;
    body.style.setProperty('--card-color', 'hsl(' + _hue.toFixed(1) + ', 70%, 55%)');
    body.style.setProperty('--close', (t.closeness || 0).toFixed(3));

    const fill = document.createElement('div');
    fill.className = 'tcard-fill';
    body.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'tlabel';
    const rank = document.createElement('span');
    rank.className = 'trank';
    rank.textContent = t.isPlaceholder ? ('#' + (t.position || '?')) : ('#' + (t.rank != null ? (t.rank >= 9999999 ? '???' : t.rank) : '?'));
    const word = document.createElement('span');
    word.className = 'tword';
    word.textContent = t.word ? t.word.toUpperCase() : '';
    label.appendChild(rank);
    label.appendChild(word);
    body.appendChild(label);

    if (t.finder) {
      const finder = document.createElement('div');
      finder.className = 'tfinder';
      const pfp = document.createElement('div');
      pfp.className = 'tpfp';
      applyPerkBadge(pfp, t.finder);
      if (t.finder.profileImage) {
        const img = document.createElement('img');
        img.src = t.finder.profileImage;
        img.style.width = '100%'; img.style.height = '100%'; img.style.borderRadius = '50%';
        img.onerror = () => { img.remove(); pfp.textContent = (t.finder.displayName || '?')[0].toUpperCase(); };
        pfp.appendChild(img);
      } else {
        pfp.textContent = (t.finder.displayName || '?')[0].toUpperCase();
      }
      const name = document.createElement('div');
      name.className = 'tname';
      name.textContent = t.finder.displayName || '';
      finder.appendChild(pfp);
      finder.appendChild(name);
      applyCosmeticTo(pfp, name, t.finder.platform, t.finder.platformUserId, { skipTitle: true });
      body.appendChild(finder);
    }

    card.appendChild(body);
    els.targetCards.appendChild(card);
  });

  // Scale down long words / finder names instead of clipping them.
  els.targetCards.querySelectorAll('.tcard').forEach(fitTargetCardText);

  // A1: FLIP playback. New cards (word not in snapshot) get the enter classes;
  // existing cards translate from their old position back to new position over
  // 280 ms via the .tcard transition rule.
  const _a1_cards = [...els.targetCards.children];
  const _a1_fresh = [];
  for (const node of _a1_cards) {
    const w = node.dataset.word;
    const before = w ? _a1_prev.get(w) : null;
    if (!before) {
      _a1_fresh.push(node);
      node.classList.add('tcard-enter');
      continue;
    }
    const after = node.getBoundingClientRect();
    const dy = before.top - after.top;
    if (!dy) continue;
    node.style.transition = 'none';
    node.style.transform = 'translateY(' + dy + 'px)';
  }
  // Force layout flush so the inverted transform paints before we clear it.
  void els.targetCards.offsetWidth;
  for (const node of _a1_cards) {
    if (_a1_fresh.indexOf(node) !== -1) continue;
    node.style.transition = '';
    node.style.transform = '';
  }
  requestAnimationFrame(() => {
    for (const node of _a1_fresh) {
      node.classList.remove('tcard-enter');
      node.classList.add('tcard-enter-active');
      node.addEventListener('transitionend',
        () => node.classList.remove('tcard-enter-active'), { once: true });
    }
  });

  // Coronation halo if #1 changed hands this render.
  const _a1_newTop = targets[0] && targets[0].word;
  if (_a1_newTop && _a1_newTop !== _a1_prevTop) {
    const top = els.targetCards.firstElementChild;
    if (top) {
      top.classList.remove('crown-flash');
      void top.offsetWidth;
      top.classList.add('crown-flash');
      top.addEventListener('animationend',
        () => top.classList.remove('crown-flash'), { once: true });
    }
  }
}

// Ramp from green (0) → amber (0.4) → magenta (0.75) → purple (1.0).
// Linear RGB interpolation between stops.
function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, [158, 234, 58]],
    [0.40, [212, 183, 65]],
    [0.75, [179, 67, 140]],
    [1.00, [107, 45, 187]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (t <= b) {
      const f = (t - a) / (b - a);
      const rgb = ca.map((v, j) => Math.round(v + (cb[j] - v) * f));
      return `rgb(${rgb.join(',')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`;
}

function _refreshOutlines() {
  if (!els.grid) return;
  const startSet = window._commonStartCells || new Set();
  const tierMap = window._cellTierByIdx || new Map();
  const activeSet = window._activeCommonCells || new Set();

  const last = _refreshOutlines._last || { startSet: new Set(), tierMap: new Map(), activeSet: new Set() };
  const startSame = last.startSet.size === startSet.size && [...startSet].every(v => last.startSet.has(v));
  const tierSame = last.tierMap.size === tierMap.size && [...tierMap].every(([k, v]) => last.tierMap.get(k) === v);
  const activeSame = last.activeSet.size === activeSet.size && [...activeSet].every(v => last.activeSet.has(v));
  if (startSame && tierSame && activeSame) return;

  _refreshOutlines._last = {
    startSet: new Set(startSet),
    tierMap: new Map(tierMap),
    activeSet: new Set(activeSet)
  };

  const cells = els.grid.querySelectorAll('.cell');
  cells.forEach((cell) => {
    const idx = parseInt(cell.dataset.idx, 10);
    if (Number.isNaN(idx)) return;
    const wasStart = last.startSet.has(idx);
    const isStart = startSet.has(idx);
    const wasTier = last.tierMap.get(idx);
    const isTier = tierMap.get(idx);
    const wasDimmed = last.activeSet.size > 0 && !last.activeSet.has(idx);
    const isDimmed = activeSet.size > 0 && !activeSet.has(idx);

    if (wasStart === isStart && wasTier === isTier && wasDimmed === isDimmed) return;

    cell.classList.remove('common-start', 'tier-common', 'tier-rare', 'tier-ultra', 'dimmed');
    if (isStart) {
      cell.classList.add('common-start');
      if (isTier === 'common' || isTier === 'rare' || isTier === 'ultra') cell.classList.add('tier-' + isTier);
    }
    if (isDimmed) cell.classList.add('dimmed');
  });
}

function renderGrid(grid, rows, cols) {

  // A4: phase-advancement wave. The active tier phase is stamped onto window
  // by render() before renderGrid runs. Diff vs the prior render and, on a
  // change, ripple a column-indexed flash + outline-color transition across
  // every .common-start cell.
  renderGrid._prevPhase = renderGrid._prevPhase || null;
  const _a4_phase = window._tierPhase || null;
  const _a4_phaseChanged = renderGrid._prevPhase && _a4_phase && renderGrid._prevPhase !== _a4_phase;
  renderGrid._prevPhase = _a4_phase;

  const isVertical = false; // landscape-only — matches main.js
  const visualRows = isVertical ? cols : rows;
  const visualCols = isVertical ? rows : cols;

  const incomingFlat = grid.map(row => row.join('')).join('');
  const dimsMatch = els.grid.dataset.rows === String(rows)
      && els.grid.dataset.cols === String(cols)
      && els.grid.dataset.vertical === String(isVertical);
  const flatMatch = dimsMatch && els.grid.dataset.prevGrid === incomingFlat;
  let rebuilt = false;

  if (!flatMatch) {
    // If the dimensions changed, do a full rebuild. If only the letters changed
    // (rare), update textContent in place instead of wiping innerHTML.
    const cells = !dimsMatch ? null : Array.from(els.grid.querySelectorAll('.cell'));
    const letterOnlyUpdate = dimsMatch && cells.length === rows * cols;

    if (letterOnlyUpdate) {
      let i = 0;
      for (let vr = 0; vr < visualRows; vr++) {
        for (let vc = 0; vc < visualCols; vc++) {
          const r = isVertical ? vc : vr;
          const c = isVertical ? vr : vc;
          const cell = cells[i++];
          const letter = (grid[r] && grid[r][c]) || '';
          if (cell.textContent !== letter) cell.textContent = letter;
        }
      }
    } else {
      rebuilt = true;
      els.grid.dataset.rows = rows;
      els.grid.dataset.cols = cols;
      els.grid.dataset.vertical = String(isVertical);
      els.grid.style.gridTemplateColumns = `repeat(${visualCols}, 1fr)`;
      // Wiping the cells strands finder faces and leaves XP numbers arcing over a
      // board that no longer exists.
      if (window.XpFlyout) XpFlyout.clearAll();
      els.grid.innerHTML = '';
      for (let vr = 0; vr < visualRows; vr++) {
        for (let vc = 0; vc < visualCols; vc++) {
          const r = isVertical ? vc : vr;
          const c = isVertical ? vr : vc;
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.style.setProperty('--i', r + c);  // A6: diagonal sweep index
          cell.style.setProperty('--col', c);     // A4: column index for phase-wave
          cell.dataset.idx = r * cols + c;
          cell.textContent = (grid[r] && grid[r][c]) || '';
          const _idx = r * cols + c;
          if (window._commonStartCells && window._commonStartCells.has(_idx)) {
            cell.classList.add('common-start');
            const _tier = window._cellTierByIdx && window._cellTierByIdx.get(_idx);
            if (_tier === 'common' || _tier === 'rare' || _tier === 'ultra') {
              cell.classList.add('tier-' + _tier);
            }
          }
          if (window._activeCommonCells && window._activeCommonCells.size > 0 && !window._activeCommonCells.has(_idx)) cell.classList.add('dimmed');
          els.grid.appendChild(cell);
        }
      }
    }
  }

  // A4: paint the wave classes if the phase changed this render.
  if (_a4_phaseChanged) {
    const _flash = { common: '90,163,255', rare: '247,201,72', ultra: '167,139,250' };
    const _rgb = _flash[_a4_phase] || _flash.ultra;
    els.grid.querySelectorAll('.cell.common-start').forEach((cell) => {
      cell.style.setProperty('--phase-flash',      'rgba(' + _rgb + ', 0.55)');
      cell.style.setProperty('--phase-flash-fade', 'rgba(' + _rgb + ', 0)');
      cell.classList.add('phase-advancing', 'phase-flash');
    });
    setTimeout(() => {
      els.grid.querySelectorAll('.cell.common-start').forEach((cell) =>
        cell.classList.remove('phase-advancing', 'phase-flash'));
    }, 1300);
  }

  els.grid.dataset.prevGrid = incomingFlat;
  return rebuilt;
}

// ─── Finder PFP on found tiles ──────────────────────────────────────────
// Mirrors main.js. In solo the finder is always the local player, so this is
// your own face landing on the tiles you just cleared.
function buildFinderPfp(finder) {
  const name = String((finder && (finder.displayName || finder.username)) || '');
  const pic = (finder && (finder.profileImage || finder.profilePic)) || '';
  const initial = (name.trim()[0] || '?').toUpperCase();

  const outer = document.createElement('span');
  outer.className = 'cell-finder-pfp';
  const inner = document.createElement('span');
  inner.className = 'cell-finder-pfp-inner';

  const makeFallback = () => {
    const fb = document.createElement('span');
    fb.className = 'cell-finder-pfp-img cell-finder-pfp-fallback';
    fb.textContent = initial;
    return fb;
  };

  if (pic) {
    const img = document.createElement('img');
    img.className = 'cell-finder-pfp-img';
    img.alt = '';
    img.addEventListener('error', () => {
      const fb = makeFallback();
      fb.style.cssText = img.style.cssText;
      if (img.parentNode) img.parentNode.replaceChild(fb, img);
    });
    img.src = pic;
    inner.appendChild(img);
  } else {
    inner.appendChild(makeFallback());
  }

  outer.appendChild(inner);
  return { outer, inner };
}

// Teardown is on a TIMER, never animationend — a suspended animation context
// would otherwise strand every face on the board.
function spawnFinderPfpOnCell(cell, finder, cos, duration) {
  if (!cell || !finder) return;
  const stale = cell.querySelector('.cell-finder-pfp');
  if (stale) stale.remove();

  const built = buildFinderPfp(finder);
  cell.appendChild(built.outer);
  cell.classList.add('has-finder-pfp');

  if (cos && window.PfpCosmetics) {
    const img = built.inner.querySelector('.cell-finder-pfp-img');
    if (img) { try { window.PfpCosmetics.apply(img, built.inner, cos); } catch (e) {} }
  }
  applyPerkBadge(built.inner, finder);

  setTimeout(() => {
    if (!built.outer.isConnected) return;
    built.outer.classList.add('is-leaving');
    setTimeout(() => {
      if (!built.outer.isConnected) return;
      built.outer.remove();
      if (!cell.querySelector('.cell-finder-pfp')) cell.classList.remove('has-finder-pfp');
    }, 320);
  }, duration);
}

function flashCells(cellIdxs, cos, rarity, msg) {
  if (!Array.isArray(cellIdxs) || cellIdxs.length === 0) return;
  // Cosmetic application matches main.js: word_color tints each cell's letter,
  // word_glow stacks an extra textShadow. Both optional.
  const wColor = cos && cos.word_color;
  const wGlow = cos && cos.word_glow;
  const apply = (el) => {
    if (wColor && wColor.color) {
      el.style.color = wColor.color;
      // A CSS animation outranks an inline style, so setting `color` alone is
      // not enough — the flash keyframes would paint their dark ink over it for
      // the whole animation and the cosmetic colour would only appear at the
      // end. The keyframes read --flash-ink, so publish it here instead.
      el.style.setProperty('--flash-ink', wColor.color);
    }
    let shadow = '';
    if (wColor && wColor.textShadow) shadow = wColor.textShadow;
    if (wGlow && wGlow.textShadow) shadow = (shadow ? shadow + ', ' : '') + wGlow.textShadow;
    if (shadow) el.style.textShadow = shadow;
  };
  const clearStyle = (el) => {
    el.style.color = '';
    el.style.textShadow = '';
    el.style.removeProperty('--flash-ink');
  };

  const MS_PER_LETTER = 130;
  const chaseMs = cellIdxs.length * MS_PER_LETTER;
  const phase2Delay = chaseMs + 200;
  const phase2Hold = 1700;
  const totalMs = phase2Delay + phase2Hold;
  const delayPerLetter = MS_PER_LETTER;

  // ── Finder faces + per-letter XP, on the same per-letter chase ──
  const finder = msg && msg.by;
  const cellEls = cellIdxs.map((idx) => els.grid.querySelector(`.cell[data-idx="${idx}"]`));
  if (finder) {
    try {
      cellEls.forEach((el, i) => {
        if (!el) return;
        setTimeout(() => spawnFinderPfpOnCell(el, finder, cos, totalMs - i * delayPerLetter), i * delayPerLetter);
      });
    } catch (e) { /* decoration only */ }
  }
  if (window.XpFlyout && msg && msg.word) {
    try {
      // `total` is the server's real award, split across the letters — see
      // splitTotal() in xp-flyout.js for why the raw table is not used here.
      //
      // Destination is the FOUND-WORDS BANNER directly under the podium, NOT
      // #word-announce — that one is `position: fixed` and parked off-screen
      // above the viewport (measured at y=-55), sliding down only while a find
      // is being announced. Numbers aimed at it flew off the top of the screen.
      // Resolved as a SELECTOR at flight time because renderFoundWords()
      // rebuilds the row on every state tick.
      XpFlyout.spawn({
        word: msg.word,
        cellEls: cellEls,
        gridEl: els.grid,
        total: msg.points,
        stagger: delayPerLetter,
        targetSelectors: ['#found-words-card .fw-pts', '#found-words-list', '#found-words-card'],
        cosmetics: cos,
        onArrive: function () {
          // Pulse over the XP counter, not the whole found-words card.
          const pts = document.querySelector('#found-words-card .fw-pts') ||
                      document.getElementById('found-words-card');
          if (pts) XpFlyout.pulse(pts, null);
        }
      });
    } catch (e) { /* decoration only */ }
  }

  // Phase 1: sequential per-cell chase
  cellIdxs.forEach((idx, i) => {
    const el = els.grid.querySelector(`.cell[data-idx="${idx}"]`);
    if (!el) return;
    setTimeout(() => {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      if (rarity) el.classList.add('flash-' + rarity);
      apply(el);
    }, i * delayPerLetter);
  });
  // Phase 2: full-word simultaneous flash
  setTimeout(() => {
    cellIdxs.forEach((idx) => {
      const el = els.grid.querySelector(`.cell[data-idx="${idx}"]`);
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      if (rarity) el.classList.add('flash-' + rarity);
      apply(el);
    });
  }, phase2Delay);
  // Cleanup: remove cosmetic styles once flash fully ends
  setTimeout(() => {
    cellIdxs.forEach((idx) => {
      const el = els.grid.querySelector(`.cell[data-idx="${idx}"]`);
      if (el) {
        clearStyle(el);
        el.classList.remove('flash', 'flash-common', 'flash-three-letter', 'flash-rare', 'flash-hidden', 'flash-ultra');
      }
    });
  }, totalMs);
}

function rarityFromMsg(msg) {
  if (!msg) return 'common';
  if (Array.isArray(msg.cells) && msg.cells.length === 3) return 'three-letter';
  if (msg.isTitleWord) return 'hidden';
  if (msg.isTarget) return 'rare';
  return 'common';
}


// ------------- Swipe-to-guess (Rectangled-style, same as main.js) -------------
const swipeSvg = document.getElementById('swipe-svg');
let swipePath = [];
let swipeActive = false;
let cellCenters = new Map();   // source-idx → { x, y } in viewport coords
let cellHitboxes = [];         // { idx, x, y, radiusSq }
let activePointerId = null;
let lastSwipe = null;  // { word, path, ts } — replay flash along player's own swipe direction
let swipeCols = 0;

function isAdjacent(a, b) {
  const dr = Math.abs(Math.floor(a / swipeCols) - Math.floor(b / swipeCols));
  const dc = Math.abs((a % swipeCols) - (b % swipeCols));
  return (dr <= 1 && dc <= 1) && (dr + dc > 0);
}

function interpolatePath(fromIdx, toIdx) {
  const result = [];
  const r1 = Math.floor(fromIdx / swipeCols), c1 = fromIdx % swipeCols;
  const r2 = Math.floor(toIdx   / swipeCols), c2 = toIdx   % swipeCols;
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const r = Math.round(r1 + (r2 - r1) * t);
    const c = Math.round(c1 + (c2 - c1) * t);
    result.push(r * swipeCols + c);
  }
  return result;
}

function cacheCellCenters() {
  cellCenters = new Map();
  cellHitboxes = [];
  const cells = els.grid.querySelectorAll('.cell');
  const gridRect = els.grid.getBoundingClientRect();
  // ZOOM. On desktop pointers the page runs `body { zoom: 0.75 }`.
  // getBoundingClientRect() reports VISUAL px (post-zoom), but the SVG's user
  // coordinate system is UNZOOMED CSS px -- svg.clientWidth reads 640 where the
  // grid measures 480. Feeding visual px straight into the path drew every
  // point at 0.75x, pulling the whole swipe line toward the top-left corner
  // (the error grows with distance, so it read as "off to the left").
  // Deriving the factor from the two measurements rather than reading `zoom`
  // keeps it correct at any zoom, including none.
  const svgW = (swipeSvg && swipeSvg.clientWidth) || gridRect.width;
  const svgScale = gridRect.width ? (svgW / gridRect.width) : 1;
  cells.forEach((cell) => {
    const r = cell.getBoundingClientRect();
    const idx = parseInt(cell.dataset.idx, 10);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = Math.min(r.width, r.height) * 0.40;
    // Path coords go into the SVG's space; hitboxes stay in VISUAL space
    // because they are compared against pointer-event clientX/clientY.
    cellCenters.set(idx, { x: (cx - gridRect.left) * svgScale, y: (cy - gridRect.top) * svgScale });
    cellHitboxes.push({ idx, x: cx, y: cy, radiusSq: radius * radius });
  });
}

function resolveCell(tx, ty) {
  let bestIdx = -1;
  let bestDistSq = Infinity;
  for (const h of cellHitboxes) {
    const dx = tx - h.x;
    const dy = ty - h.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= h.radiusSq && distSq < bestDistSq) {
      bestIdx = h.idx;
      bestDistSq = distSq;
    }
  }
  return bestIdx;
}

function applySwipeHighlight() {
  const pathSet = new Set(swipePath);
  const lastIdx = swipePath.length > 0 ? swipePath[swipePath.length - 1] : -1;
  els.grid.querySelectorAll('.cell').forEach((cell) => {
    const idx = parseInt(cell.dataset.idx, 10);
    cell.classList.toggle('swipe-path', pathSet.has(idx) && idx !== lastIdx);
    cell.classList.toggle('swipe-last', idx === lastIdx);
  });
  if (swipePath.length < 2 || cellCenters.size === 0 || !swipeSvg) {
    if (swipeSvg) swipeSvg.innerHTML = '';
    return;
  }
  const points = swipePath.map((idx) => cellCenters.get(idx)).filter(Boolean);
  if (points.length < 2) { swipeSvg.innerHTML = ''; return; }
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  swipeSvg.innerHTML = `<path d="${d}" stroke="rgba(158,234,58,0.65)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function updateSwipeWordDisplay() {
  const word = swipePath.map((i) => {
    const cell = els.grid.querySelector(`.cell[data-idx="${i}"]`);
    return cell ? cell.textContent : '';
  }).join('');
  const input = document.getElementById('guess-input');
  if (input) input.value = word;
}

function clearSwipe() {
  swipePath = [];
  swipeActive = false;
  activePointerId = null;
  applySwipeHighlight();
  if (swipeSvg) swipeSvg.innerHTML = '';
}

// Per-page override — solo.js: emit guess into the solo session.
function onSwipeSubmit(word) {
  if (soloSending) return;
  els.guessInput.value = word;
  submitSoloWords([word], word);
}

if (els.grid) {
  els.grid.addEventListener('pointerdown', (e) => {
    const cols = parseInt(els.grid.dataset.cols || '0', 10);
    if (!cols) return;
    swipeCols = cols;
    cacheCellCenters();
    const idx = resolveCell(e.clientX, e.clientY);
    if (idx < 0) return;
    try { els.grid.setPointerCapture(e.pointerId); } catch {}
    activePointerId = e.pointerId;
    swipeActive = true;
    swipePath = [idx];
    _sfx('cellTap', 0);
    applySwipeHighlight();
    updateSwipeWordDisplay();
  });
  els.grid.addEventListener('pointermove', (e) => {
    if (!swipeActive || e.pointerId !== activePointerId) return;
    const idx = resolveCell(e.clientX, e.clientY);
    if (idx < 0) return;
    const last = swipePath[swipePath.length - 1];
    if (idx === last) return;
    if (swipePath.length > 1 && idx === swipePath[swipePath.length - 2]) {
      swipePath.pop();
      applySwipeHighlight();
      updateSwipeWordDisplay();
      return;
    }
    if (swipePath.includes(idx)) return;
    if (isAdjacent(last, idx)) {
      swipePath.push(idx);
      _sfx('cellTap', swipePath.length - 1);
    } else {
      const intermediate = interpolatePath(last, idx);
      for (const i of intermediate) {
        if (swipePath.includes(i)) continue;
        swipePath.push(i);
        _sfx('cellTap', swipePath.length - 1);
      }
    }
    applySwipeHighlight();
    updateSwipeWordDisplay();
  });
  els.grid.addEventListener('pointerup', (e) => {
    if (!swipeActive || e.pointerId !== activePointerId) return;
    try { els.grid.releasePointerCapture(e.pointerId); } catch {}
    const word = swipePath.map((i) => {
      const cell = els.grid.querySelector(`.cell[data-idx="${i}"]`);
      return cell ? cell.textContent : '';
    }).join('');
    if (word.length >= 3) {
      lastSwipe = { word: word.toLowerCase(), path: swipePath.slice(), ts: Date.now() };
      _sfx('swipeSubmit');
      onSwipeSubmit(word);
    } else if (swipePath.length > 0) {
      _sfx('swipeClear');
    }
    clearSwipe();
    const input = document.getElementById('guess-input');
    if (input) input.value = '';
  });
  els.grid.addEventListener('pointercancel', clearSwipe);
}

// ------------- Socket.IO wiring (solo lifecycle) -------------

let _lastRunId = null;
socket.on('solo-state', (state) => {
  if (state && state.runId && state.runId !== _lastRunId) {
    _lastRunId = state.runId;
    _a7_resetWave();
    triggerRoundStart();
    clearTicker();
    _lastTitleRevealed = -1;
  }
  currentState = state;
  render(state);
});

socket.on('solo-result', (msg) => {
  if (!msg) return;
  // Normalize: solo results carry `finder`; MP results carry `by`. The shared
  // announce/flash code reads `by`.
  if (!msg.by && msg.finder) msg.by = msg.finder;
  if (msg.result === 'correct') _sfx(_sfxRarity(msg));
  else if (msg.result === 'miss_in_article') _sfx('missInArticle');
  else if (msg.result === 'already_found') _sfx('alreadyFound');
  else if (msg.result === 'too_short') _sfx('tooShort');
  _a7_markFound(msg);
  _spawnRankFloater(msg);
  if (msg.result === 'correct' && msg.cells) {
    const p = msg.by && msg.by.platform; const u = msg.by && msg.by.platformUserId;
    const cellsToFlash = (lastSwipe && lastSwipe.word === (msg.word || '').toLowerCase() && Date.now() - lastSwipe.ts < 5000)
      ? (function(){ const pp = lastSwipe.path.slice(); lastSwipe = null; return pp; })() : msg.cells;
    if (p && u && window.cosmeticsCache) {
      window.cosmeticsCache.getPlayerCosmetics(p, u).then((cos) => flashCells(cellsToFlash, cos, rarityFromMsg(msg), msg));
    } else {
      flashCells(cellsToFlash, null, rarityFromMsg(msg), msg);
    }
    showWordAnnounce(msg);
  }
  pushTicker(msg.word, msg.result, msg.rank, msg.guessCount);
});

socket.on('solo-end', (msg) => {
  _completed = true;
  if (msg && msg.pbBumped) _sfx('dailyPb'); else _sfx('roundEnd');
  _a7_triggerRoundEndWave();
  showEndOverlay(msg, currentState);
});

// ------------- Composer -------------

function parseBatchInput(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(/[\s,]+/)) {
    const w = part.trim().toLowerCase();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 50) break;
  }
  return out;
}

function soloStatus(message) {
  let notice = document.getElementById('solo-save-status');
  if (!notice) { notice = document.createElement('div'); notice.id = 'solo-save-status'; notice.setAttribute('role','status'); notice.setAttribute('aria-live','polite'); els.composer.insertAdjacentElement('afterend',notice); }
  notice.textContent = message;
}
let soloSending = null;
function submitSoloWords(words, raw = null) {
  if (soloSending) return;
  if (!socket.connected) { soloStatus('Disconnected. Your guess is still here; reconnect and try again.'); return; }
  const command = { actionId: crypto.randomUUID(), words, raw, runId: currentState && currentState.runId };
  soloSending = command;
  const event = words.length === 1 ? 'solo-guess' : 'solo-batch-guess';
  const payload = { actionId: command.actionId, ...(words.length === 1 ? { word: words[0] } : { words }) };
  const send = attempt => {
    if (soloSending !== command) return;
    if (!socket.connected || command.runId !== (currentState && currentState.runId)) { soloSending = null; soloStatus('Connection or puzzle changed. Your guess is still here; try again.'); return; }
    soloStatus('Saving guess…');
    socket.timeout(7000).emit(event, payload, (error, ack) => {
      if (soloSending !== command) return;
      if (error && attempt < 2) { setTimeout(() => send(attempt + 1), 600); return; }
      soloSending = null;
      if (error || !ack || !ack.ok) { soloStatus('Your guess could not be confirmed. It is still here; try again.'); return; }
      if (raw !== null && els.guessInput.value.trim() === raw) els.guessInput.value = '';
      soloStatus('Guess saved.');
    });
  };
  send(0);
}
socket.on('solo-action-error', () => soloStatus('Your guess could not be saved. It is still here; try again.'));
let refreshingIdentity = false;
let identityReconnectPending = false;
let identityRevision = 0;
function clearSoloIdentityView() {
  soloSending = null; _hubUser = null; _identified = false; _started = false; _completed = false; currentState = null;
  for (const element of [els.grid,els.titleChips,els.playersRow,els.foundWordsList,els.targetCards]) if (element) element.replaceChildren();
  delete els.grid.dataset.prevGrid; delete els.grid.dataset.rows; delete els.grid.dataset.cols;
  lastState = null; _lastTitleRevealed = -1; renderGrid._prevPhase = null; _refreshOutlines._last = null;
  localStorage.setItem(NAME_KEY, 'Guest');
  if (els.renameLink) els.renameLink.textContent = getDisplayName();
  if (window.WinCard) window.WinCard.hide();
  const oldCard = document.getElementById('wt-win-card'); if (oldCard) oldCard.style.display = 'none';
  els.endOverlay.classList.add('hidden');
}
async function refreshSoloIdentity(force = false) {
  if (force) {
    identityRevision++; identityReconnectPending = true; clearSoloIdentityView(); socket.disconnect();
  }
  if (refreshingIdentity) return;
  refreshingIdentity = true;
  const revision = identityRevision;
  try {
    const response = await fetch(HUB_API + '/api/me/session', { credentials: 'include', signal: AbortSignal.timeout(7000) });
    if (!response.ok) { soloStatus('Sign-in is temporarily unavailable. Your guess is still here. Return to this page to retry.'); return; }
    const data = await response.json(), user = data && data.ok && data.user || null;
    if (revision !== identityRevision) return;
    if (!identityReconnectPending && (user && user.id) === (_hubUser && _hubUser.id)) return;
    clearSoloIdentityView(); _hubUser = user; identityReconnectPending = false;
    localStorage.setItem(NAME_KEY, user && (user.displayName || user.globalName || user.username) || 'Guest');
    if (els.renameLink) els.renameLink.textContent = getDisplayName();
    soloStatus('Sign-in changed. Reconnecting…'); socket.disconnect(); setTimeout(() => socket.connect(), 400);
  } catch (_) { soloStatus('Sign-in is temporarily unavailable. Your guess is still here. Return to this page to retry.'); }
  finally { refreshingIdentity = false; if (revision !== identityRevision) setTimeout(() => refreshSoloIdentity(), 0); }
}
socket.on('identity-required', () => refreshSoloIdentity(true));
window.addEventListener('focus', () => refreshSoloIdentity());
els.composer.addEventListener('submit', ev => {
  ev.preventDefault(); const raw = (els.guessInput.value || '').trim();
  const words = parseBatchInput(raw); if (words.length) submitSoloWords(words, raw);
});

els.endSolo.addEventListener('click', () => {
  if (!confirm('End this run?')) return;
  const runId = currentState && currentState.runId;
  if (!socket.connected) { soloStatus('Disconnected. Reconnect before ending this run.'); return; }
  socket.timeout(7000).emit('leave-solo', {}, (error, ack) => {
    if (error || !ack || !ack.ok) { soloStatus('The run could not be closed. Reconnect and try again.'); return; }
    if (!currentState || currentState.runId !== runId) return;
    _completed = true; showEndOverlay({ reason: 'left' }, currentState);
  });
});

els.endAgain.addEventListener('click', () => {
  startMode('daily');
});

socket.on('cosmetics-updated', (data) => {
  if (data && window.cosmeticsCache) window.cosmeticsCache.invalidatePlayer(data.platform, data.platformUserId, data.equipped);
});

// ─── End of run: shared WinCard on completion; the old overlay only
// remains for a manually-ended run ("Run ended"). The daily share moved to
// a WinCard action. ────────────────────
function shareDailyText(text) {
  if (!text) return;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      try { window.prompt('Copy your result:', text); } catch (e) {}
    });
  } else {
    try { window.prompt('Copy your result:', text); } catch (e) {}
  }
}

function showEndOverlay(msg, state) {
  const s2 = (state && state.personal) || {};
  const dayStr = _dailyDateStr ? ' ' + _dailyDateStr : '';
  const shareText = '🟧 WiKirecTangled Daily' + dayStr + ' — ' + (s2.score || 0).toLocaleString() + ' pts · ' + (s2.wordCount || 0) + ' words · ' + (s2.targetCount || 0) + '/' + ((state && state.targetCount) || 0) + ' targets\nhttps://wikirectangled.com';
  if (msg && msg.reason === 'complete' && window.WinCard) {
    // Win: sticky shared win card (the old overlay had no auto-hide). Winner
    // identity comes from the hub SSO session so the all-time-wins chip and
    // cosmetics/perks resolve; guests get no wins chip (component auto-hides).
    const winner = { displayName: getDisplayName() };
    if (_hubUser && _hubUser.id) {
      winner.platform = 'discord';
      winner.platformUserId = _hubUser.id;
      winner.linkedDiscord = _hubUser.id;
      if (_hubUser.avatar) winner.profilePic = 'https://cdn.discordapp.com/avatars/' + _hubUser.id + '/' + _hubUser.avatar + '.png';
    }
    WinCard.showSolo({
      game: 'wikirectangled',
      gameName: 'WiKirecTangled',
      word: state ? state.articleTitle : '',
      guessCount: s2.wordCount || 0,
      jackpot: s2.score || 0,
      winner,
      autoHideMs: 0,
      actions: [
        { label: 'Play again', primary: true, onClick: () => { WinCard.hide(); startMode('practice'); } },
        { label: 'Share', onClick: () => shareDailyText(shareText) },
      ],
    });
    return;
  }
  els.endOverlay.classList.remove('hidden');
  els.endTitle.textContent = 'Run ended';
  els.endArticle.textContent = state ? state.articleTitle : '';
  els.endStats.innerHTML = '';
  if (state && state.personal) {
    const s = state.personal;
    const items = [
      ['Score', (s.score || 0).toLocaleString()],
      ['Words', s.wordCount || 0],
      ['Targets', `${s.targetCount || 0}/${state.targetCount || 0}`],
      ['Title words', `${s.titleWordCount || 0}/${state.titleWordCount || 0}`],
    ];
    for (const [label, val] of items) {
      const el = document.createElement('span');
      el.className = 'tag correct';
      el.textContent = `${label}: ${val}`;
      els.endStats.appendChild(el);
    }
  }
}

// Word-announce toast — same as main.js. In solo every find is the player's
// own, which matches the multiplayer look (announce on every correct find).
let _waTimer = null;
function showWordAnnounce(msg) {
  _sfx('scoreAnnounce');
  const wa = document.getElementById('word-announce');
  if (!wa) return;
  const pfp = document.getElementById('wa-pfp');
  const name = document.getElementById('wa-name');
  const word = document.getElementById('wa-word');
  const pts = document.getElementById('wa-pts');

  // Clear any stale cosmetic styles from a prior find
  pfp.style.cssText = '';
  name.style.cssText = '';
  pfp.innerHTML = '';
  const oldTitle = wa.querySelector('.cosmetic-title');
  if (oldTitle) oldTitle.remove();

  const finderName = (msg.by && msg.by.displayName) || getDisplayName();
  if (msg.by && msg.by.profileImage) {
    const img = document.createElement('img');
    img.src = msg.by.profileImage;
    img.onerror = () => { img.remove(); pfp.textContent = finderName[0].toUpperCase(); };
    pfp.appendChild(img);
  } else {
    pfp.textContent = finderName[0].toUpperCase();
  }
  name.textContent = finderName;
  word.textContent = (msg.word || '').toUpperCase();
  pts.textContent = '+' + (msg.points || 0).toLocaleString();
  // Rank-bonus subtitle: only if this find earned rank points beyond the grid total.
  let _waSub = wa.querySelector('.wa-rank-sub');
  const _rp = (typeof msg.rankPoints === 'number') ? msg.rankPoints : 0;
  if (_rp > 0 && (msg.points || 0) > _rp) {
    if (!_waSub) {
      _waSub = document.createElement('div');
      _waSub.className = 'wa-rank-sub';
      const _info = wa.querySelector('.wa-info') || wa;
      _info.appendChild(_waSub);
    }
    _waSub.textContent = '+' + _rp.toLocaleString() + ' rank';
    _waSub.style.display = '';
  } else if (_waSub) {
    _waSub.style.display = 'none';
  }

  wa.classList.add('show');
  if (_waTimer) clearTimeout(_waTimer);
  _waTimer = setTimeout(() => wa.classList.remove('show'), 2500);

  if (msg.by && msg.by.platform && msg.by.platformUserId) {
    applyCosmeticTo(pfp, name, msg.by.platform, msg.by.platformUserId);
  }
}

// Real-time typing path preview — same as main.js.
let _typingHighlightActive = false;

function findPathForPrefix(prefix) {
  if (!prefix || prefix.length === 0) return null;
  const sourceCols = parseInt(els.grid.dataset.cols || '0', 10);
  const sourceRows = parseInt(els.grid.dataset.rows || '0', 10);
  if (!sourceCols || !sourceRows) return null;

  // Snapshot all cells once: idx → letter.
  const cellsByIdx = new Map();
  els.grid.querySelectorAll('.cell').forEach((cell) => {
    const idx = parseInt(cell.dataset.idx, 10);
    cellsByIdx.set(idx, (cell.textContent || '').toLowerCase());
  });

  function neighborsOf(idx) {
    const r = Math.floor(idx / sourceCols);
    const c = idx % sourceCols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= sourceRows || nc < 0 || nc >= sourceCols) continue;
        out.push(nr * sourceCols + nc);
      }
    }
    return out;
  }

  const target = prefix.toLowerCase();
  const path = [];
  const visited = new Set();
  const deadline = performance.now() + 8; // 8 ms budget per keystroke

  function dfs(idx, depth) {
    if (performance.now() > deadline) return false;
    if (cellsByIdx.get(idx) !== target[depth]) return false;
    if (visited.has(idx)) return false;
    visited.add(idx);
    path.push(idx);
    if (depth === target.length - 1) return true;
    for (const n of neighborsOf(idx)) {
      if (dfs(n, depth + 1)) return true;
    }
    visited.delete(idx);
    path.pop();
    return false;
  }

  for (const [idx, letter] of cellsByIdx) {
    if (letter !== target[0]) continue;
    visited.clear();
    path.length = 0;
    if (dfs(idx, 0)) return path.slice();
    if (performance.now() > deadline) break;
  }
  return null;
}

let _typingPathLen = 0;
function applyTypingPathHighlight(path) {
  // Skip while user is actively swiping — swipe handlers own the highlight.
  if (typeof swipeActive !== 'undefined' && swipeActive) return;
  if (_typingHighlightActive) {
    els.grid.querySelectorAll(".cell.typing-path, .cell.typing-last").forEach((c) => {
      c.classList.remove("typing-path", "typing-last");
    });
    _typingHighlightActive = false;
  }
  if (!path || path.length === 0) return;
  const last = path[path.length - 1];
  for (const idx of path) {
    const cell = els.grid.querySelector(`.cell[data-idx="${idx}"]`);
    if (!cell) continue;
    cell.classList.toggle("typing-last", idx === last);
    cell.classList.toggle("typing-path", idx !== last);
  }
  _typingHighlightActive = true;
}

(function wireTypingPath() {
  const input = document.getElementById('guess-input');
  if (!input) return;
  let pending = null;
  input.addEventListener('input', () => {
    if (typeof swipeActive !== 'undefined' && swipeActive) return;
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = null;
      const v = (input.value || '').trim();
      if (!v) { applyTypingPathHighlight(null); return; }
      applyTypingPathHighlight(findPathForPrefix(v));
    });
  });
  // Clear highlight on submit / blur so the chase isn't drowned in stale paint.
  input.addEventListener('blur', () => applyTypingPathHighlight(null));
  if (els.composer) {
    els.composer.addEventListener('submit', () => applyTypingPathHighlight(null));
  }
})();

// ------------- Round-end wave + round-start (A6/A7, same as main.js) -------------

let _a7_findCounter = 0;
function _a7_markFound(msg) {
  if (!msg || msg.result !== 'correct' || !Array.isArray(msg.cells) || msg.cells.length === 0) return;
  const tn = (msg.breakdown && msg.breakdown.tierName) || null;
  const tier = tn === 'common' || tn === 'rare' || tn === 'ultra' || tn === 'three' ? tn : 'hidden';
  for (const idx of msg.cells) {
    const el = els.grid.querySelector('.cell[data-idx="' + idx + '"]');
    if (!el || el.dataset.foundOrder) continue;
    el.dataset.foundOrder = String(_a7_findCounter);
    el.style.setProperty('--w', _a7_findCounter);
    el.classList.add('found-' + tier);
    _a7_findCounter++;
  }
}
function _a7_resetWave() {
  _a7_findCounter = 0;
  if (els.endOverlay) {
    els.endOverlay.classList.remove('entering');
    const old = els.endOverlay.querySelector('.sparks');
    if (old) old.remove();
  }
  if (!els.grid) return;
  els.grid.querySelectorAll('.cell').forEach((c) => {
    c.classList.remove('round-end-wave', 'found-common', 'found-rare', 'found-ultra', 'found-hidden', 'found-three');
    c.style.removeProperty('--w');
    delete c.dataset.foundOrder;
  });
}
function _a7_triggerRoundEndWave() {
  if (!els.grid) return;
  els.grid.querySelectorAll('.cell.found-common, .cell.found-rare, .cell.found-ultra, .cell.found-hidden, .cell.found-three')
    .forEach((c) => c.classList.add('round-end-wave'));
  if (!els.endOverlay) return;
  const old = els.endOverlay.querySelector('.sparks');
  if (old) old.remove();
  const sparks = document.createElement('div');
  sparks.className = 'sparks';
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.style.setProperty('--dx',    ((Math.random()*2-1)*200).toFixed(0) + 'px');
    s.style.setProperty('--rot',   ((Math.random()*2-1)*360).toFixed(0) + 'deg');
    s.style.setProperty('--hue',   (32 + Math.random()*30).toFixed(0));
    s.style.setProperty('--delay', (Math.random()*320).toFixed(0) + 'ms');
    sparks.appendChild(s);
  }
  els.endOverlay.appendChild(sparks);
  els.endOverlay.classList.add('entering');
}

// A6: replay grid + title-chips reveal animations on a new round.
function triggerRoundStart() {
  const grid  = els.grid;
  const chips = els.titleChips;
  if (!grid || !chips) return;
  grid.classList.remove('round-start');
  chips.classList.remove('round-start');
  void grid.offsetWidth;
  grid.classList.add('round-start');
  chips.classList.add('round-start');
  setTimeout(() => {
    grid.classList.remove('round-start');
    chips.classList.remove('round-start');
  }, 1500);
}

// Rank-points floater — same as main.js.
let _rankFloaterIdx = 0;
function _spawnRankFloater(msg) {
  if (!msg || typeof msg.rankPoints !== 'number' || msg.rankPoints <= 0) return;
  requestAnimationFrame(() => _doSpawnRankFloater(msg));
}
function _doSpawnRankFloater(msg) {
  if (!els.targetCards) return;
  const word = String(msg.word || '').toLowerCase();
  const rank = (typeof msg.rank === 'number') ? msg.rank : null;
  const points = msg.rankPoints;
  let anchor = null;
  if (rank != null) anchor = els.targetCards.querySelector('.tcard[data-rank="' + rank + '"]');
  if (!anchor && word) anchor = els.targetCards.querySelector('.tcard[data-word="' + word + '"]');
  if (!anchor) anchor = els.targetCards;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  let cls = 'size-small';
  if (points >= 10000) cls = 'size-big';
  else if (points >= 1000) cls = 'size-med';
  const f = document.createElement('span');
  f.className = 'rank-pts-floater ' + cls;
  f.textContent = '+' + points.toLocaleString();
  const slot = _rankFloaterIdx++ % 6;
  const xOff = ((slot * 17) % 50) - 25;
  const yOff = (slot % 3) * 14 + Math.floor(Math.random() * 6);
  f.style.position = 'fixed';
  f.style.top = (rect.top + 6 + yOff) + 'px';
  f.style.right = (Math.max(0, window.innerWidth - rect.right) + 12 + xOff) + 'px';
  f.style.zIndex = '9999';
  document.body.appendChild(f);
  let _removed = false;
  const _kill = () => { if (_removed) return; _removed = true; f.remove(); };
  f.addEventListener('animationend', _kill, { once: true });
  setTimeout(_kill, 10000);
}

function _sfx(name, ...args) {
  if (window.SFX && window.SFX.sounds && typeof window.SFX.sounds[name] === 'function') {
    try { window.SFX.sounds[name](...args); } catch (e) {}
  }
}
function _sfxRarity(msg) {
  if (!msg) return 'correctCommon';
  if (msg.isTitleWord) return 'correctTitle';
  if (Array.isArray(msg.cells) && msg.cells.length === 3) return 'correctThree';
  if (msg.isTarget) return 'correctRare';
  return 'correctCommon';
}
(function wireMuteToggle() {
  var btn = document.getElementById('muteToggle');
  if (!btn || !window.SFX) return;
  function refresh() {
    var m = window.SFX.isMuted();
    btn.classList.toggle('muted', m);
    btn.setAttribute('aria-pressed', m ? 'true' : 'false');
  }
  btn.addEventListener('click', function () { window.SFX.toggleMute(); refresh(); });
  refresh();
})();

function _renderTierProgress(state) {
  const phase = (state && state.currentTierPhase) || 'common';
  const countSpan = els.commonFound ? els.commonFound.closest('.count') : null;
  const badge = countSpan ? countSpan.querySelector('.badge') : null;
  if (countSpan) {
    countSpan.classList.remove('c', 'r', 'u');
    if (phase === 'rare') countSpan.classList.add('r');
    else if (phase === 'ultra' || phase === 'complete') countSpan.classList.add('u');
    else countSpan.classList.add('c');
  }
  if (badge) {
    badge.textContent = phase === 'rare' ? 'R' : (phase === 'ultra' || phase === 'complete') ? 'U' : 'C';
  }
  let found = 0, target = 0;
  if (phase === 'rare') {
    found = state.foundRareCount || 0; target = state.rareWordTarget || 0;
  } else if (phase === 'ultra' || phase === 'complete') {
    found = state.foundUltraCount || 0; target = state.ultraWordTarget || 0;
  } else {
    found = state.foundCommonCount || 0; target = state.commonWordTarget || state.commonWordCount || 0;
  }
  if (els.commonFound) els.commonFound.textContent = found;
  if (els.commonTotal) els.commonTotal.textContent = target;

  // Toggle body class for tier-aware cell outline colors.
  // 'complete' = no class → outlines disappear (no color resolves).
  document.body.classList.remove('tier-active-common', 'tier-active-rare', 'tier-active-ultra');
  if (phase === 'common') document.body.classList.add('tier-active-common');
  else if (phase === 'rare') document.body.classList.add('tier-active-rare');
  else if (phase === 'ultra') document.body.classList.add('tier-active-ultra');
}
