// streamer.js - Read-only viewer for a single streamer's private room.
// Same renderers as the public main.js but no composer / no identity flow —
// chat from the streamer's platform is the input, this page is just the
// scoreboard.

// Two URL flavors land on this page:
//   /streamer/<handle>   — original explicit form
//   /<handle>            — family-convention bare-handle form
// In both cases, extract the handle and pass it on the socket.io handshake
// as auth.session — the server lazy-creates the room on the handshake.
function extractHandle() {
  const path = window.location.pathname.replace(/\/$/, '');
  if (path.startsWith('/streamer/')) return path.slice('/streamer/'.length).toLowerCase();
  if (path.startsWith('/overlay/')) return path.slice('/overlay/'.length).toLowerCase();
  if (/^\/[a-z0-9_-]{1,32}$/i.test(path)) return path.slice(1).toLowerCase();
  return '';
}
const handle = extractHandle();
if (handle) window.__SESSION_HANDLE = handle;

function withHubSocketPath(options = {}) {
  if (window.location.pathname.startsWith('/game/wikirectangled')) {
    return { path: '/game/wikirectangled/socket.io', ...options };
  }
  return options;
}

const socket = io(withHubSocketPath({
  transports: ['polling', 'websocket'],
  auth: handle ? { session: handle } : undefined,
}));
// Shared win card: the room's game-win payload (winner hero + top-10 round
// standings) renders via the Word Tycoon WinCard. autoHideMs mirrors the old
// SessionWinCard 7s show duration.
// The shared Word Tycoon WinCard resolves the winner's cosmetics AND perks
// itself, from `platformUserId`. But getTopPlayers() reports the game's
// IDENTITY KEY ("discord:<id>"), and both hub endpoints answer a prefixed id
// with a silent empty rather than an error:
//   /api/public/player-cosmetics?userId=discord:<id> -> {"equipped":{}}
//   /api/public/perks?discordId=discord:<id>         -> all-false
// so the win card rendered with no cosmetics and no perk badge. Peel the
// prefix at the boundary, where the game's internal id shape stops being
// anyone else's problem. Also passes the bare id as `discordId`, which is the
// field WinCard's perk lookup actually prefers.
function normaliseWinPayload(data) {
  const bare = (window.cosmeticsCache && window.cosmeticsCache.bareId)
    || ((p, u) => String(u || '').replace(/^discord[:_]/i, ''));
  const fix = (u) => {
    if (!u || !u.platformUserId) return u;
    const id = bare(u.platform, u.platformUserId);
    if (id === u.platformUserId) return u;
    const out = Object.assign({}, u, { platformUserId: id });
    if (!out.discordId && String(u.platform).toLowerCase() === 'discord' && /^\d{5,}$/.test(id)) {
      out.discordId = id;
    }
    return out;
  };
  const out = Object.assign({}, data);
  if (out.winner) out.winner = fix(out.winner);
  if (Array.isArray(out.topPlayers)) out.topPlayers = out.topPlayers.map(fix);
  return out;
}

socket.on('game-win', (data) => {
  if (window.WinCard && data) window.WinCard.handleGameWin(Object.assign({}, normaliseWinPayload(data), { autoHideMs: 7000 }));
});
// Auth: check hub session and identify with Discord identity if present.
const HUB_ORIGIN = 'https://wordtycoon.live';
window._hubUser = null;
fetch(HUB_ORIGIN + '/api/me/session', { credentials: 'include' })
  .then((r) => r.ok ? r.json() : null)
  .then((data) => {
    if (data && data.ok && data.user) {
      window._hubUser = data.user;
      try {
        const dn = data.user.displayName || data.user.globalName || data.user.username;
        if (dn) localStorage.setItem('wkt-display-name', dn);
      } catch (e) {}
      const sessionId = (typeof localStorage !== 'undefined' && localStorage.getItem('wkt-session-id')) || null;
      const dn = data.user.displayName || data.user.globalName || data.user.username;
      socket.emit('identify', {
        sessionId,
        displayName: dn || 'You',
        discordUserId: data.user.id,
        discordDisplayName: dn,
        discordAvatar: data.user.avatar || null,
      });
    }
  })
  .catch(() => {});


const $ = (sel) => document.querySelector(sel);
const els = {
  titleChips: $('#title-chips'),
  playersRow: $('#players-row'),
  foundWordsCard: $('#found-words-card'),
  foundWordsList: $('#found-words-list'),
  foundWordsCount: $('#found-words-count'),
  targetCards: $('#target-cards'),
  grid: $('#grid'),
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
  status: $('#streamer-status'),
  handleEl: $('#streamer-handle'),
};

if (els.handleEl) els.handleEl.textContent = handle ? `@${handle}` : '';
document.title = handle ? `${handle} — WiKirecTangled` : 'WiKirecTangled';

// auth.session in the handshake (above) is the canonical attach mechanism — the
// server lazy-creates the room and emits 'streamer-state' immediately. The
// 'watch-streamer' emit below is a backwards-compat fallback for older server
// builds that don't honor the handshake auth field.
socket.on('connect', () => {
  if (!handle) return;
  socket.emit('watch-streamer', { handle });
});

socket.on('streamer-state', (msg) => {
  if (!msg || msg.handle !== handle) return;
  if (!msg.state) {
    els.status.style.display = '';
    els.status.textContent = `Waiting for @${handle} to start a round…`;
    return;
  }
  els.status.style.display = 'none';
  render(msg.state);
});

// Once subscribed to streamer:<handle>, the room broadcasts the same events
// the public game does. Reuse the same handlers.
socket.on('round-start', (state) => {
  _a7_resetWave();
  // Nothing from the old board may float over the new one.
  if (window.XpFlyout) XpFlyout.clearAll();
  _sfx('roundStart'); triggerRoundStart(); clearTicker(); render(state); });
socket.on('state', render);
socket.on('round-end', (msg) => {
  _sfx('roundEnd');
  _a7_triggerRoundEndWave();
  if (msg && msg.state) render(msg.state);
});
socket.on("guess-result", (msg) => {
  if (msg && msg.result === 'correct') _sfx(_sfxRarity(msg));
  else if (msg && msg.result === 'miss_in_article') _sfx('missInArticle');
  else if (msg && msg.result === 'already_found') _sfx('alreadyFound');
  else if (msg && msg.result === 'too_short') _sfx('tooShort');
  _a7_markFound(msg);
  _spawnRankFloater(msg);
  if (msg && msg.result === "correct" && msg.cells) {
    const p = msg.by && msg.by.platform;
    const u = msg.by && msg.by.platformUserId;
    const cellsToFlash = (lastSwipe && lastSwipe.word === (msg.word || "").toLowerCase() && Date.now() - lastSwipe.ts < 5000)
      ? (function(){ const pp = lastSwipe.path.slice(); lastSwipe = null; return pp; })()
      : msg.cells;
    if (p && u && window.cosmeticsCache) {
      window.cosmeticsCache.getPlayerCosmetics(p, u).then((cos) => flashCells(cellsToFlash, cos, rarityFromMsg(msg), msg));
      showWordAnnounce(msg);
    } else {
      flashCells(cellsToFlash, null, rarityFromMsg(msg), msg);
      showWordAnnounce(msg);
    }
  }
  if (msg) pushTicker(msg.word, msg.result, msg.rank, msg.guessCount);
});

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
  els.status.style.display = 'none';
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
// The socket payload only ever carries isFanClub — relay-client.js pulls just
// 'fan-club' out of user.badges and resolveWebSession() has no perk fields, so
// session.isSuperfan / session.isDonor are forwarded all the way down but never
// assigned. Paint what the payload claims, then ask the hub for the real class
// and re-apply. PerkBadges.apply is idempotent and diffs on the perk signature.
function applyPerkBadge(el, user) {
  if (!el || !window.PerkBadges) return;
  try { window.PerkBadges.apply(el, user); } catch (e) { return; }
  const p = user && user.platform;
  const u = user && user.platformUserId;
  if (!p || !u || !window.cosmeticsCache || !window.cosmeticsCache.getPlayerPerks) return;
  window.cosmeticsCache.getPlayerPerks(p, u).then((perks) => {
    if (!el.isConnected) return;
    window.PerkBadges.apply(el, Object.assign({}, user, perks));
  }).catch(() => {});
}

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

// applyCosmeticTo — async fetch + apply equipped cosmetics to an avatar/name
// pair. Mirrors the Sproutle pattern: profile_border on the avatar element,
// name_color/name_glow on the name text, and a [Title] chip appended after.
// Safe to call without a cache (no-ops). Caches via window.cosmeticsCache so
// repeated renders don't hammer the network.
function applyCosmeticTo(avatarEl, nameEl, platform, platformUserId, opts) {
  opts = opts || {};
  if (!platform || !platformUserId || !window.cosmeticsCache) return;
  window.cosmeticsCache.getPlayerCosmetics(platform, platformUserId).then((cos) => {
    if (!cos || Object.keys(cos).length === 0) return;
    if (window.WikiCosmetics) {
      // Pass titleContainer: null — title is rendered below with the
      // legacy `[Title]` bracket format wikirec uses.
      window.WikiCosmetics.apply({
        surfaceEl: null,
        avatarEl: avatarEl || null,
        nameEl: nameEl || null,
        titleContainer: null,
      }, cos);
    } else {
      // Fallback if cosmetics-applier.js failed to load — replicate the
      // pre-port behaviour so cosmetics still partially render.
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
    // Title handled here (not via WikiCosmetics) to keep wikirec's
    // `[Title]` bracket format and afterend-of-name placement.
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
  // Fast path: same word list/order as last render — update closeness, rank,
  // and finder identity in place instead of rebuilding the whole rail.
  renderTargets._prev = renderTargets._prev || [];
  const prev = renderTargets._prev;
  const sameOrder = targets.length === prev.length &&
    targets.every((t, i) => t && prev[i] && t.word === prev[i].word);
  renderTargets._prev = targets.slice();

  if (sameOrder) {
    const cards = els.targetCards.children;
    targets.forEach((t, i) => {
      const card = cards[i];
      if (!card) return;
      const body = card.querySelector('.tcard-body');
      const rankEl = card.querySelector('.trank');
      if (body) body.style.setProperty('--close', (t.closeness || 0).toFixed(3));
      if (rankEl) {
        rankEl.textContent = t.isPlaceholder ? ('#' + (t.position || '?')) : ('#' + (t.rank != null ? (t.rank >= 9999999 ? '???' : t.rank) : '?'));
      }
      card.classList.toggle('revealed', !!t.isTarget);
      card.classList.toggle('placeholder', !!t.isPlaceholder);
      card.dataset.rank = (t.rank != null ? String(t.rank) : '');
      if (body && prev[i] && t.rank !== prev[i].rank) {
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
      }
      const prevFinder = prev[i] && prev[i].finder;
      const newFinder = t.finder;
      const finderChanged = (!prevFinder && !!newFinder) ||
        (!!prevFinder && !newFinder) ||
        (prevFinder && newFinder && (
          prevFinder.platform !== newFinder.platform ||
          prevFinder.platformUserId !== newFinder.platformUserId ||
          prevFinder.displayName !== newFinder.displayName ||
          prevFinder.profileImage !== newFinder.profileImage
        ));
      if (finderChanged && body) {
        const existingFinder = body.querySelector('.tfinder');
        if (existingFinder) existingFinder.remove();
        if (newFinder) {
          const finder = document.createElement('div');
          finder.className = 'tfinder';
          const pfp = document.createElement('div');
          pfp.className = 'tpfp';
          if (newFinder.profileImage) {
            const img = document.createElement('img');
            img.src = newFinder.profileImage;
            img.style.width = '100%'; img.style.height = '100%'; img.style.borderRadius = '50%';
            img.onerror = () => { img.remove(); pfp.textContent = (newFinder.displayName || '?')[0].toUpperCase(); };
            pfp.appendChild(img);
          } else {
            pfp.textContent = (newFinder.displayName || '?')[0].toUpperCase();
          }
          const name = document.createElement('div'); name.className = 'tname';
          name.textContent = newFinder.displayName || '';
          finder.appendChild(pfp); finder.appendChild(name);
          applyCosmeticTo(pfp, name, newFinder.platform, newFinder.platformUserId, { skipTitle: true });
          body.appendChild(finder);
        }
      }
    });
    // Scale down long words / finder names instead of clipping them.
    for (const card of els.targetCards.children) fitTargetCardText(card);
    return;
  }

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
    const fill = document.createElement('div'); fill.className = 'tcard-fill';
    body.appendChild(fill);
    const label = document.createElement('div'); label.className = 'tlabel';
    const rank = document.createElement('span'); rank.className = 'trank';
    rank.textContent = t.isPlaceholder ? ('#' + (t.position || '?')) : ('#' + (t.rank != null ? (t.rank >= 9999999 ? '???' : t.rank) : '?'));
    const word = document.createElement('span'); word.className = 'tword';
    word.textContent = t.word ? t.word.toUpperCase() : '';
    label.appendChild(rank); label.appendChild(word);
    body.appendChild(label);
    if (t.finder) {
      const finder = document.createElement('div'); finder.className = 'tfinder';
      const pfp = document.createElement('div'); pfp.className = 'tpfp';
      if (t.finder.profileImage) {
        const img = document.createElement('img');
        img.src = t.finder.profileImage;
        img.style.width = '100%'; img.style.height = '100%'; img.style.borderRadius = '50%';
        img.onerror = () => { img.remove(); pfp.textContent = (t.finder.displayName || '?')[0].toUpperCase(); };
        pfp.appendChild(img);
      } else {
        pfp.textContent = (t.finder.displayName || '?')[0].toUpperCase();
      }
      const name = document.createElement('div'); name.className = 'tname';
      name.textContent = t.finder.displayName || '';
      finder.appendChild(pfp); finder.appendChild(name);
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

function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0.00,[158,234,58]],[0.40,[212,183,65]],[0.75,[179,67,140]],[1.00,[107,45,187]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i+1];
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

  // Vertical (portrait) on narrow viewports, landscape on desktop. Transposes
  // the visual rendering — each cell's dataset.idx still points at the original
  // server-side cellIndex (r*cols+c) so flashCells lookups work either way.
  const isVertical = false; // landscape-only — disabled portrait transpose
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
// The finder's face pops on every tile of the word they just landed, wearing
// their equipped profile_border / profile_glow and their perk heart.
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

// Teardown is on a TIMER, never animationend: an OBS scene that is not active
// suspends animations entirely, and every face would be stranded on the grid
// until the next round rebuilt it. That matters more here than anywhere else —
// this file IS the OBS surface.
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
  // Erectangled-pattern cosmetic application: word_color tints each cell's letter,
  // word_glow stacks an extra textShadow. Both are optional — falls back to the
  // default green flash if no cosmetic is given.
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

  // Length-scaled timing: each letter takes a fixed budget, so longer words
  // genuinely take longer to flash through. phase2Hold matches the longest
  // tier keyframe (ultra/hidden at 1.6s).
  const MS_PER_LETTER = 130;
  const chaseMs = cellIdxs.length * MS_PER_LETTER;
  const phase2Delay = chaseMs + 200;
  const phase2Hold = 1700;
  const totalMs = phase2Delay + phase2Hold;
  const delayPerLetter = MS_PER_LETTER;

  // ── Finder faces + per-letter XP, both riding the same per-letter chase ──
  // Wrapped so a throw in either can never stop the flash itself from running.
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
  cellEls.forEach((el, i) => {
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
    cellEls.forEach((el) => {
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
    cellEls.forEach((el) => {
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


socket.on("cosmetics-updated", (data) => {
  if (data && window.cosmeticsCache) window.cosmeticsCache.invalidatePlayer(data.platform, data.platformUserId, data.equipped);
});

// Word-announce toast — populates + slides in when someone finds a word, holds
// briefly, slides back. Cosmetic-aware via applyCosmeticTo.
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

  const finderName = (msg.by && msg.by.displayName) || 'Anonymous';
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

  wa.classList.add('show');
  if (_waTimer) clearTimeout(_waTimer);
  _waTimer = setTimeout(() => wa.classList.remove('show'), 2500);

  if (msg.by && msg.by.platform && msg.by.platformUserId) {
    applyCosmeticTo(pfp, name, msg.by.platform, msg.by.platformUserId);
  }
}

// ---- Player identity (so the room knows who's guessing) ------------------
const NAME_KEY = 'wkt-display-name';
const SESSION_KEY = 'wkt-session-id';
function getDisplayName() { return localStorage.getItem(NAME_KEY) || 'You'; }
function setDisplayName(name) {
  const v = (name || '').trim().slice(0, 32) || 'You';
  localStorage.setItem(NAME_KEY, v);
  const link = document.getElementById('rename-link');
  if (link) link.textContent = v;
  socket.emit('update-profile', { displayName: v });
}
function identifyStreamer() {
  socket.emit('identify', {
    sessionId: localStorage.getItem(SESSION_KEY) || null,
    displayName: getDisplayName(),
  });
}
// auth.session in the handshake already attaches us to the room. Identify in
// addition so the server can resolve our session for guesses.
socket.on('connect', identifyStreamer);
socket.on('identified', (msg) => {
  if (msg && msg.sessionId) localStorage.setItem(SESSION_KEY, msg.sessionId);
});

// rename link: hooks the small "Playing as <name> · change" affordance
const _renameLink = document.getElementById('rename-link');
if (_renameLink) {
  _renameLink.textContent = getDisplayName();
  _renameLink.addEventListener('click', () => {
    const next = window.prompt('Display name:', getDisplayName());
    if (next != null) setDisplayName(next);
  });
}

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

// ---- Composer + swipe (ported from main.js) -----------------------------
const _composer = document.getElementById('composer');
const _guessInput = document.getElementById('guess-input');
if (_composer && _guessInput) {
  _composer.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const raw = (_guessInput.value || '').trim();
    if (!raw) return;
    const words = parseBatchInput(raw);
    if (!words.length) return;
    if (words.length === 1) {
      socket.emit('guess', { word: words[0], displayName: getDisplayName() });
    } else {
      socket.emit('batch-guess', { words, displayName: getDisplayName() });
    }
    _guessInput.value = '';
  });
}

const swipeSvg = document.getElementById('swipe-svg');
let swipePath = [];
let swipeActive = false;
let cellCenters = new Map();   // source-idx → { x, y } in viewport coords
let cellHitboxes = [];         // { left, right, top, bottom, idx } where idx is source-idx
let activePointerId = null;
let lastSwipe = null;  // { word, path, ts } — used to replay flash along player's own swipe direction
let swipeCols = 0;             // SOURCE cols — adjacency math is in source space

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
  // ZOOM. streamer.html runs under `body { zoom: 0.75 }` (overlay.html does
  // not — it carries .obs-mode, which the media query excludes).
  // getBoundingClientRect() reports VISUAL px, but the SVG's user coordinate
  // system is UNZOOMED CSS px, so feeding visual px straight into the path drew
  // every point at 0.75x and pulled the whole line toward the top-left.
  // Deriving the factor from the two measurements keeps it right at any zoom,
  // including none — which is why this is safe on both surfaces.
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

// onSwipeSubmit is overridden below to wire socket emit on each page.
function onSwipeSubmit(_word) {}

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

function onSwipeSubmit_streamer(word) {
  socket.emit("guess", { word, displayName: getDisplayName() });
}
onSwipeSubmit = onSwipeSubmit_streamer;

// Real-time typing path preview — as the player types, find the best 8-connected
// path through the grid that spells the current prefix and highlight it.
// Lifted-letter check, no cell reuse, source-grid coords (so it works regardless
// of vertical/landscape transpose since cells carry data-idx). Reuses the same
// .swipe-path / .swipe-last classes so it looks identical to a manual swipe.
//
// Search budget: a small per-keystroke time cap so a pathological prefix can't
// hang the page. DFS prunes hard because each step requires a matching letter,
// so in practice every keystroke completes in well under 5 ms.

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
  if (path && path.length > _typingPathLen) {
    for (let _i = _typingPathLen; _i < path.length; _i++) _sfx('cellTap', _i);
    _typingPathLen = path.length;
  } else if (!path || !path.length) {
    _typingPathLen = 0;
  }
  // Skip while user is actively swiping — swipe handlers own the highlight.
  if (typeof swipeActive !== 'undefined' && swipeActive) return;
  // If we previously lit something, clear stale classes so disconnects show
  // instantly when the prefix becomes invalid.
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

// ------------- SFX wiring -------------

// A7: per-cell wave only — streamer page has no round-end overlay.
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


// Rank-points floater. Spawns immediately on guess-result. Multiple can
// coexist; each bubble lives independently, fans out horizontally so they
// don't stack on top of each other, and removes itself on animationend.
let _rankFloaterIdx = 0;
function _spawnRankFloater(msg) {
  if (!msg || typeof msg.rankPoints !== 'number' || msg.rankPoints <= 0) return;
  // Defer to next animation frame: the 'state' event arrives right after
  // 'guess-result' and updates the rank-list DOM. By rAF time both events
  // have been processed and the card matching this rank is in DOM.
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
  // Tight jitter so simultaneous bubbles for the same card don't stack.
  const slot = _rankFloaterIdx++ % 6;
  const xOff = ((slot * 17) % 50) - 25;
  const yOff = (slot % 3) * 14 + Math.floor(Math.random() * 6);
  f.style.position = 'fixed';
  f.style.top = (rect.top + 6 + yOff) + 'px';
  f.style.right = (Math.max(0, window.innerWidth - rect.right) + 12 + xOff) + 'px';
  f.style.zIndex = '9999';
  document.body.appendChild(f);
  // Safety net: animationend can be missed on reduced-motion devices,
  // hidden tabs, or browser quirks — guarantee removal after 10s.
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
  // 'complete' or unknown → no class, no outline color resolves
}
