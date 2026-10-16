(() => {
  // Streamer-private session viewer: ?session=<handle> means we landed via
  // /<handle> redirect. Pass auth.session so the server joins this socket
  // to the streamer's session room and lazy-creates the round if needed.
  const _sessionHandle = (() => {
    try {
      const h = new URLSearchParams(location.search).get('session');
      return h && /^[a-z0-9_-]{1,32}$/i.test(h) ? h.toLowerCase() : null;
    } catch (_) { return null; }
  })();
  // Bundled clients do not use Chat Relay's legacy Socket.IO script wrapper.
  // Keep embedded game traffic on the host's game proxy so the handshake
  // carries the same signed-in cookies as the page's account API requests.
  const _sockOpts = {
    path: /^\/game\/wikisearchle(?:\/|$)/.test(location.pathname)
      ? '/game/wikisearchle/socket.io' : '/socket.io',
    withCredentials: true,
  };
  if (_sessionHandle) _sockOpts.auth = { session: _sessionHandle };
  const socket = io(_sockOpts);
  let roundStateReady = false, articleReceived = false, articleReady = false, roundActive = false;
  function finishOnlineLoading() {
    if (roundStateReady && roundActive && articleReceived && articleReady && document.getElementById('wwgb-root')) {
      if (window.WikiContextoLoading && window.WikiContextoLoading.isPending()) window.WikiContextoLoading.ready();
    }
  }
  function startOnlineLoading(message) {
    roundStateReady = articleReceived = articleReady = roundActive = false;
    if (window.WikiContextoLoading) window.WikiContextoLoading.start(message);
  }
  window.WikiContextoOnlineReady = finishOnlineLoading;
  socket.on('connect', () => {
    if (window.WikiContextoLoading && window.WikiContextoLoading.isPending()) window.WikiContextoLoading.start();
  });
  socket.on('disconnect', () => startOnlineLoading('Reconnecting to Online…'));
  socket.on('connect_error', () => {
    if (window.WikiContextoLoading && window.WikiContextoLoading.isPending()) window.WikiContextoLoading.fail('Unable to connect to Online. Check your connection and try again.');
  });
  // Cache invalidation when WT pushes a cosmetics-updated event upstream.
  // Mirrors wikirec's listener at /opt/wikirectangled/public/js/main.js:1061.
  socket.on('cosmetics-updated', (data) => {
    if (data && window.cosmeticsCache) window.cosmeticsCache.invalidatePlayer(data.platform, data.platformUserId, data.equipped);
    if (data) WikiGuessCards.updateEquipment(data);
  });
  if (_sessionHandle) window.__SESSION_HANDLE = _sessionHandle;
  // Shared win card: the server emits `game-win` (public rounds to the 'ws'
  // room, streamer-session rounds to the session room) with the full
  // winner/topPlayers payload. Skip on OBS-overlay variants of this page —
  // chat-relay's /win-overlay renders the card there instead.
  function _isObsOverlay() {
    const h = document.documentElement, b = document.body;
    if (h.classList.contains('obs-overlay-mode') || h.classList.contains('obs-mode')) return true;
    if (b && (b.classList.contains('obs-overlay-mode') || b.classList.contains('obs-mode'))) return true;
    if (b && b.dataset && b.dataset.mode && b.dataset.mode !== 'mp') return true;
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('obs') === '1' || q.get('stream_widget') === '1') return true;
    } catch (_) {}
    return false;
  }
  if (window.WinCard) {
    socket.on('game-win', (data) => {
      if (!data || _isObsOverlay()) return;
      WinCard.showMp({
        game: data.game || 'wikisearchle',
        gameName: data.gameName || 'WikiContexto',
        word: data.word,
        winner: data.winner,
        topPlayers: data.topPlayers,
        jackpot: data.jackpot,
        guessCount: data.guessCount,
        // Old round-end modal auto-hid after 10s; the next round's
        // round-start handler hides any card still up (setActive).
        autoHideMs: 10000,
        actions: [{ label: 'Dismiss', onClick: () => window.WinCard.hide() }],
      });
    });
  }

  // Streamer-session redirect: when the streamer switches active game,
  // chat-relay tells this game's backend, which emits `session-redirect`
  // into the session room. Show a modal letting viewers follow or stay.
  // Skip on OBS overlay — overlays should silently follow (or stay; we
  // choose stay so the OBS scene doesn't auto-navigate).
  socket.on('session-redirect', (data) => {
    try {
      if (!data || !data.targetUrl) return;
      if (document.documentElement.classList.contains('obs-overlay-mode')) return;
      if (document.getElementById('sessionRedirectModal')) return;
      const overlay = document.createElement('div');
      overlay.id = 'sessionRedirectModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;';
      const card = document.createElement('div');
      card.style.cssText = 'background:#1a1f2e;border:1px solid rgba(248,113,113,0.55);border-radius:14px;padding:22px 24px;max-width:380px;width:100%;color:#f1f5f9;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
      const gameName = data.targetGameName || 'a different game';
      card.innerHTML = '<div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#fca5a5;font-weight:700;margin-bottom:6px;">Streamer moved</div>' +
        '<div style="font-size:18px;font-weight:600;line-height:1.35;margin-bottom:16px;">The streamer is now playing <span style="color:#fde68a;">' + gameName.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</span>.</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="srmFollow" style="flex:1;min-width:130px;padding:10px 14px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">Follow streamer</button>' +
          '<button id="srmStay" style="flex:0 0 auto;padding:10px 14px;background:transparent;color:#cbd5e1;border:1px solid rgba(203,213,225,0.35);border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Play public version</button>' +
        '</div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      document.getElementById('srmFollow').addEventListener('click', () => {
        window.location.href = data.targetUrl;
      });
      document.getElementById('srmStay').addEventListener('click', () => {
        window.location.href = location.origin + '/';
      });
    } catch (e) { console.warn('[session-redirect]', e); }
  });


  const cardsEl          = document.getElementById('cards');
  const cardsEmpty       = document.getElementById('cardsEmpty');
  const ticker           = document.getElementById('ticker');
  const titleText        = document.getElementById('titleText');
  const titleBlock       = titleText ? titleText.closest('.title-block') : null;
  const hintPromptEl     = document.getElementById('hintPrompt');
  const bodyEl           = document.getElementById('body');
  const guessCountEl     = document.getElementById('guessCount');
  const revealProgressEl = document.getElementById('revealProgress');
  const scoreboardEl     = document.getElementById('scoreboard');
  const announceEl       = document.getElementById('announce');
  const waAvatar         = document.getElementById('waAvatar');
  const waName           = document.getElementById('waName');
  const waTotal          = document.getElementById('waTotal');
  const waEarned         = document.getElementById('waEarned');
  const waWord           = document.getElementById('waWord');
  const waRarity         = document.getElementById('waRarity');

  let localGuessCount = 0;

  function _fitTitleSlotOnce() {
    if (!titleBlock || !titleText) return;
    titleBlock.classList.remove('title-compact', 'title-tight', 'title-clipped');
    if (!titleText.textContent.trim()) return;

    for (const cls of ['title-compact', 'title-tight']) {
      if (titleText.scrollHeight <= titleText.clientHeight + 1) break;
      titleBlock.classList.add(cls);
    }

    if (titleText.scrollHeight > titleText.clientHeight + 1) {
      titleBlock.classList.add('title-clipped');
    }
  }
  function fitTitleSlot() {
    // Run immediately, then again after layout/animation settles. The
    // mid-round title updates (word reveals) can fire while the just-revealed
    // animation is still expanding letter-spacing — first pass would measure
    // wider-than-final, second pass corrects after the keyframe ends.
    _fitTitleSlotOnce();
    requestAnimationFrame(() => {
      _fitTitleSlotOnce();
      // One more pass after the reveal animation completes (~0.9s).
      setTimeout(_fitTitleSlotOnce, 950);
    });
  }

  function setIdle() {
    document.body.classList.remove('game-active');
    hideRoundEnd();
  }
  function setActive() {
    document.body.classList.add('game-active');
    hideRoundEnd();
  }
  function hideRoundEnd() {
    if (window.WinCard) window.WinCard.hide();
  }

  // ── Helpers ────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtNum(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString() : '?'; }
  function compactRank(n) {
    const v = Number(n);
    if (!isFinite(v)) return '?';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  }
  const PLAT_COLORS = { tiktok:'#69C9D0', youtube:'#FF0000', discord:'#5865F2', web:'#FF6600' };
  // Anonymous / no-avatar fallback — show the Word Tycoon PFP at full size,
  // matching the solo page so anon presence reads as "Word Tycoon" everywhere.
  const ANON_PFP_URL = '/img/wt-pfp.png';
  // User profile pics from Word Tycoon are sometimes stored as root-relative
  // paths (/portal/assets/profile-logos/foo.png). Browsers resolve those
  // against this domain (wikicontexto.com) which 404s — they live on
  // wordtycoon.live. Absolute URLs and protocol-relative URLs pass through.
  function resolvePfp(url) {
    if (!url) return null;
    if (/^(?:https?:)?\/\//i.test(url)) return url;
    if (url.charAt(0) === '/') return 'https://wordtycoon.live' + url;
    return url; // unknown shape — let the browser try
  }
  function avatarHtml(user, cls) {
    const url = user && user.profilePic ? resolvePfp(user.profilePic) : null;
    if (url) {
      // If the resolved custom pfp also fails, swap to the WT logo before
      // giving up — better than a stark "?" fallback.
      const onerr = `if(!this.dataset.f){this.dataset.f=1;this.src='${ANON_PFP_URL}';this.alt='Word Tycoon';}else{this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls}-fb',textContent:'?'}));}`;
      return `<img src="${esc(url)}" alt="" onerror="${onerr}">`;
    }
    return `<img src="${esc(ANON_PFP_URL)}" alt="Word Tycoon">`;
  }

  // Perk badge (Super Donor / Super Fan / Donor Class / Fan Club).
  //
  // server.js reads only 'fan-club' and 'superfan' off msg.user.badges — never
  // 'donor' or 'super-donor', though the relay stamps both. So a Super Donor
  // reached this page looking like a Super Fan, and a Donor Class holder like
  // nobody. Paint what the payload claims immediately (no flicker, no wait),
  // then ask the hub for the real class and re-apply. PerkBadges.apply is
  // idempotent and diffs on the perk signature, so the second call is a no-op
  // unless it actually changes the tier.
  function applyPerkBadge(el, user) {
    if (!el || !window.PerkBadges) return;
    try { window.PerkBadges.apply(el, user); } catch (e) { return; }
    const cc = window.cosmeticsCache;
    if (!cc || !cc.getPlayerPerks || !cc.discordIdOf || !cc.discordIdOf(user)) return;
    cc.getPlayerPerks(user).then((perks) => {
      // The node may have been re-rendered out from under us mid-fetch.
      if (!el.isConnected) return;
      // The user's own flags stay in the merge: readPerks ORs them, so a
      // payload that DID know about fan club can't be downgraded by a hub blip.
      window.PerkBadges.apply(el, Object.assign({}, user, perks));
    }).catch(() => {});
  }

  // ── Cards ─────────────────────────────────────────
  // Each card has a proximity fill bar whose width & colour reflect the
  // guess's semantic rank vs the target. Log scale so the middle ranks get
  // visibly distinct treatment. Width floor keeps far cards from vanishing.
  let totalRankedWordsCache = 339509;
  const MIN_FILL_PCT = 5;
  function rankMeter(rank) {
    const r = Math.max(1, Number(rank) || 0);
    const max = Math.max(r, totalRankedWordsCache || r);
    const progress = Math.min(1, Math.log(r) / Math.log(max));
    const hue = 30 + (1 - progress) * 90;
    const fillPct = Math.max(MIN_FILL_PCT, (1 - progress) * 100);
    const nextHue = Math.min(120, hue + 12);
    const fillColor = r === 1
      ? 'linear-gradient(90deg, #41d976 0%, #55e889 48%, #24b95b 100%)'
      : `linear-gradient(90deg, hsl(${hue}, 82%, 54%) 0%, hsl(${nextHue}, 82%, 58%) 62%, transparent 100%)`;
    return { fillPct, fillColor, hue };
  }
  // Stable-DOM card render. Keyed by the guess word, so cards that are
  // still in the top-six after a refresh keep their existing DOM node —
  // no animation replay, no flash. Only genuinely new entries animate in.
  const _guessCards = WikiGuessCards.create(cardsEl);
  const _cardDomCache = new Map();
  const _placeholderCache = [];
  const TOP_N_SLOTS = 6;
  function fitWordLabel(card, minPx) {
    if (card.dataset.refinedGuess) { WikiGuessCards.fit(card); return; }
    const labels = card.querySelectorAll('.word-lbl');
    if (!labels.length) return;
    labels.forEach((l) => { l.style.fontSize = ''; l.style.letterSpacing = ''; });
    // Compute the space actually available for the rank-word block: the
    // card-inner's content width minus the avatar's footprint and the
    // single gap between rank-word and .who. We check rank-word.scrollWidth
    // against THAT, not card-inner.scrollWidth — because .who has
    // overflow:visible (so cosmetic glow can extend past it) and .gname
    // has max-width: 120px, both of which can push card-inner.scrollWidth
    // past clientWidth without the WORD itself actually being clipped.
    const inner = card.querySelector('.card-inner.base') || card;
    const rankWord = inner.querySelector('.rank-word');
    if (!rankWord) return;
    const avatar = inner.querySelector('.avatar-fb');
    const innerStyle = getComputedStyle(inner);
    const padX = (parseFloat(innerStyle.paddingLeft) || 0) + (parseFloat(innerStyle.paddingRight) || 0);
    const gap = parseFloat(innerStyle.columnGap || innerStyle.gap || '0') || 0;
    const avatarW = avatar ? (avatar.offsetWidth || 38) : 38;
    const available = inner.clientWidth - padX - avatarW - gap;
    if (rankWord.scrollWidth <= available + 1 && labels[0].scrollWidth <= labels[0].clientWidth + 1) return;
    let size = parseFloat(getComputedStyle(labels[0]).fontSize) || 18;
    while ((rankWord.scrollWidth > available + 1 || labels[0].scrollWidth > labels[0].clientWidth + 1) && size > (minPx || 10)) {
      size -= 1;
      labels.forEach((l) => { l.style.fontSize = size + 'px'; l.style.letterSpacing = '0.3px'; });
    }
  }
  function renderCards(top, restored = false) {
    return window.WikiMotion.rankUpdate(() => renderCardsNow(top, restored), restored);
  }
  function renderCardsNow(top, restored = false) {
    if (restored) _guessCards.snapshot(top);
    const newTop = (top || []).slice(0, TOP_N_SLOTS);
    if (cardsEmpty.parentNode === cardsEl) cardsEl.removeChild(cardsEmpty);
    for (const ph of _placeholderCache) {
      if (ph && ph.parentNode) ph.remove();
    }

    const keepWords = new Set(newTop.map(g => g.word));
    for (const [word, el] of [..._cardDomCache.entries()]) {
      if (!keepWords.has(word)) {
        WikiGuessCards.dispose(el);
        if (el.parentNode) el.remove();
        _cardDomCache.delete(word);
      }
    }

    newTop.forEach((g, i) => {
      const isTopSlot = i === 0;
      const isExactRank = Number(g.rank) === 1;
      const { fillPct, fillColor, hue } = rankMeter(g.rank);
      const wlen = (g.word || '').length;
      let sizeCls = '';
      if (wlen > 13) sizeCls = ' xl-word';
      else if (wlen >= 11) sizeCls = ' lg-word';
      else if (wlen >= 8) sizeCls = ' md-word';
      let c = _cardDomCache.get(g.word);
      if (!c) {
        c = document.createElement('div');
        c.dataset.word = g.word;
        c.className = 'card' + (isTopSlot ? ' top' : '') + (isExactRank ? ' exact' : '') + sizeCls;
        // White text and the inset capsule sit above the proximity fill.
        const inner = (
          `<div class="rank-word">` +
          `<div class="rank">#${compactRank(g.rank)}</div>` +
          `<div class="word-lbl">${esc(g.word || '')}</div>` +
          `</div>` +
          `<div class="who">` +
          // No legacy has-fan-club-badge class: applyPerkBadge below draws the
          // Fan Club heart itself, and both together render two overlapping.
          `<div class="avatar-fb" style="overflow:visible">${avatarHtml(g.user, 'avatar')}</div>` +
          `<div class="who-text">` +
          `<div class="gname">${esc((g.user && g.user.displayName) || 'viewer')}</div>` +
          `</div>` +
          `</div>`
        );
        // .card-clip wraps the fill so the proximity bar still gets clipped
        // to the rounded pill, while the outer .card stays overflow:visible
        // so cosmetic glows can extend past the card edge.
        c.innerHTML =
          `<div class="card-clip"><div class="fill"></div></div>` +
          `<div class="card-inner base">${inner}</div>`;
        _cardDomCache.set(g.word, c);
      } else {
        // Update structural classes without wiping FX classes
        c.classList.remove('top', 'exact', 'lg-word', 'xl-word');
        if (isTopSlot) c.classList.add('top');
        if (isExactRank) c.classList.add('exact');
        if (wlen > 13) c.classList.add('xl-word');
        else if (wlen >= 10) c.classList.add('lg-word');
        // Re-apply FC class on reused cards — user may have been flagged FC
        // after the card first rendered. Toggle both base + overlay layers.
        c.querySelectorAll('.avatar-fb').forEach(el => applyPerkBadge(el, g.user));
        // Kill the cardIn keyframe on reused nodes so a reorder can't
        // replay the pop-in flash.
        c.style.animation = 'none';
      }
      // Update proximity meter every render so totalRankedWords changes
      // propagate and fill bars animate via their CSS transition.
      c.style.setProperty('--fill-pct', fillPct.toFixed(2) + '%');
      c.style.setProperty('--fill-color', fillColor);
      c.style.setProperty('--rank-hue', hue);
      c.style.setProperty('--word-len', String(wlen));
      // appendChild on an existing node is a move, not a recreate — no flash.
      cardsEl.appendChild(c);
      c._guessUser = g.user;
      WikiGuessCards.prepare(c, g.user && g.user.cosmetics);
      c.querySelector('.rank').textContent = '#' + compactRank(g.rank);
      // Equipment paints the slanted panel; avatar, name and title keep their hooks.
      if (window.WikiCosmetics) {
        window.WikiCosmetics.apply({
          surfaceEl: c.querySelector('.guess-panel-surface'),
          wordFrameEl: c.querySelector('.guess-panel-frame'),
          wordGlowEl: c.querySelector('.guess-panel-glow'),
          avatarEl: c.querySelector('.avatar-fb'),
          nameEl: c.querySelector('.gname'),
          titleContainer: c.querySelector('.who-text'),
        }, g.user && g.user.cosmetics);
      }
      fitWordLabel(c);
    });
    _guessCards.sync();

    // Fill remaining slots with placeholder cards so the column always shows 6.
    for (let i = newTop.length; i < TOP_N_SLOTS; i++) {
      let ph = _placeholderCache[i];
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'card placeholder';
        ph.innerHTML = `<div class="card-inner base"><div class="rank-word"><div class="rank">#${i + 1}</div><div class="word-lbl"></div></div></div>`;
        _placeholderCache[i] = ph;
      }
      cardsEl.appendChild(ph);
    }
  }

  // ── Scoreboard ────────────────────────────────────
  let _prevGoldKey = null;
  function renderScoreboard(top3) {
    scoreboardEl.innerHTML = '';
    const slots = [{cls:'gold', idx:0}, {cls:'silver', idx:1}, {cls:'bronze', idx:2}];
    for (const s of slots) {
      const p = (top3 || [])[s.idx];
      const card = document.createElement('div');
      card.className = `tp-card ${s.cls}` + (p ? '' : ' empty');
      if (!p) {
        card.innerHTML = `<div class="tp-pfp">${s.idx + 1}</div><div class="tp-name">—</div><div class="tp-score">0</div>`;
      } else {
        const key = String(p.nickname || '').toLowerCase();
        card.dataset.playerKey = key;
        card.dataset.playerNick = p.nickname || '';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `View stats for ${p.nickname}`);
        // No legacy has-fan-club-badge class here — PerkBadges (applied below)
        // draws the Fan Club heart itself, and both together render two.
        card.innerHTML =
          `<div class="tp-pfp">${avatarHtml(p.user, 'tp')}</div>` +
          `<div class="tp-name">${esc(p.nickname)}</div>` +
          `<div class="tp-score">${fmtNum(p.points)}</div>`;
      }
      scoreboardEl.appendChild(card);
      if (s.cls === 'gold' && p) {
        const key = String(p.nickname || '').toLowerCase();
        if (_prevGoldKey !== key) {
          _prevGoldKey = key;
          if (window.FX) window.FX.podiumCoronation();
        }
      }
      // Apply equipped cosmetics on the podium too. hero_badge replaces the
      // gold/silver/bronze gradient via inline style precedence; profile
      // border/glow ring the pfp; name color/glow style the name; title
      // appended to the card after the score.
      if (p && window.WikiCosmetics) {
        window.WikiCosmetics.apply({
          surfaceEl: card,
          avatarEl: card.querySelector('.tp-pfp'),
          nameEl: card.querySelector('.tp-name'),
          titleContainer: card,
        }, p.user && p.user.cosmetics);
      }
      // Perk hearts (Super Donor / Super Fan / Donor Class / Fan Club). Applied
      // AFTER the cosmetics pass so nothing that pass rewrites can drop the
      // badge spans. Only the legacy FC ::after was ever wired here, and it was
      // clipped away by .tp-pfp's overflow — so no perk badge showed at all.
      if (p) applyPerkBadge(card.querySelector('.tp-pfp'), p.user);
      // Score is the only flexible-width text on the podium card. If a 7-figure
      // total ever overflows, shrink it 1px at a time. Names stay single-line
      // and ellipsize via CSS — no JS needed.
      if (p) {
        const scoreEl = card.querySelector('.tp-score');
        if (scoreEl && typeof fitText === 'function') {
          requestAnimationFrame(() => fitText(scoreEl, 7));
        }
      }
    }
  }

  // ── Player stats modal ────────────────────────────
  const psModal   = document.getElementById('psModal');
  const psClose   = document.getElementById('psClose');
  const psAvatar  = document.getElementById('psAvatar');
  const psName    = document.getElementById('psName');
  const psSub     = document.getElementById('psSub');
  const psBody    = document.getElementById('psBody');
  function openPlayerStats(key, nickFallback) {
    if (!key) return;
    psName.textContent = nickFallback || key;
    psSub.textContent = '';
    psAvatar.textContent = (nickFallback || key || '?')[0].toUpperCase();
    psAvatar.innerHTML = '';
    psAvatar.textContent = (nickFallback || key || '?')[0].toUpperCase();
    psBody.innerHTML = '<div class="ps-loading">Loading…</div>';
    psModal.classList.remove('hidden');
    fetch('/api/player-stats/' + encodeURIComponent(key), { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'no-data' : 'fetch-failed')))
      .then(data => renderPlayerStats(data, nickFallback))
      .catch(err => {
        if (err && err.message === 'no-data') {
          psBody.innerHTML = '<div class="ps-empty">No history yet — stats begin accumulating from the next completed round.</div>';
        } else {
          psBody.innerHTML = '<div class="ps-empty">Could not load stats.</div>';
        }
      });
  }
  function renderPlayerStats(data, nickFallback) {
    const lt = data.lifetime || null;
    const cr = data.currentRound || null;
    const user = (lt && lt.user) || null;
    const displayName = (lt && lt.nickname) || nickFallback || '—';
    psName.textContent = displayName;
    if (user && user.profilePic) {
      psAvatar.innerHTML = '';
      const img = document.createElement('img');
      img.src = user.profilePic;
      img.alt = '';
      img.onerror = () => { psAvatar.textContent = (displayName || '?')[0].toUpperCase(); };
      psAvatar.appendChild(img);
    } else {
      psAvatar.textContent = (displayName || '?')[0].toUpperCase();
    }
    applyPerkBadge(psAvatar, user);
    const platform = (user && user.platform) || 'web';
    psSub.textContent = platform.toUpperCase();

    if (!lt && !cr) { psBody.innerHTML = '<div class="ps-empty">No stats yet.</div>'; return; }

    const hitRate = lt && lt.totalGuesses > 0
      ? Math.round((lt.totalWordsFound / lt.totalGuesses) * 100) + '%'
      : '—';
    const bestRound = (lt && lt.bestRound) || null;
    const sections = [];

    if (cr) {
      sections.push(
        '<div class="ps-section-h">This round</div>' +
        '<div class="ps-round-row">' +
          `<div class="title">${esc(cr.articleTitle || cr.targetWord || '?')}</div>` +
          `<div class="pts">${fmtNum(cr.points)}</div>` +
        '</div>'
      );
    }

    sections.push(
      '<div class="ps-section-h">Lifetime</div>' +
      '<div class="ps-grid">' +
        (lt ? [
          ['Total points', fmtNum(lt.totalPoints || 0), ''],
          ['Rounds played', fmtNum(lt.roundsPlayed || 0), ''],
          ['Wins', fmtNum(lt.roundsWon || 0), (lt.roundsPlayed ? Math.round((lt.roundsWon/lt.roundsPlayed)*100) + '% win rate' : '')],
          ['Targets found', fmtNum(lt.targetFinds || 0), ''],
          ['Best round', bestRound ? fmtNum(bestRound.points) : '—', bestRound ? esc(bestRound.articleTitle || '') : ''],
          ['Hit rate', hitRate, lt.totalWordsFound ? fmtNum(lt.totalWordsFound) + ' / ' + fmtNum(lt.totalGuesses) : ''],
        ].map(([label, val, sub]) =>
          `<div class="ps-stat"><div class="ps-stat-label">${label}</div><div class="ps-stat-val">${val}</div>${sub ? `<div class="ps-stat-sub">${sub}</div>` : ''}</div>`
        ).join('') : '<div class="ps-empty" style="grid-column: 1 / -1">No history yet.</div>') +
      '</div>'
    );

    if (lt && Array.isArray(lt.recentRounds) && lt.recentRounds.length > 0) {
      const rows = lt.recentRounds.map(r => {
        const cls = r.wonRound ? ' crown' : '';
        const meta = [];
        if (r.foundTarget) meta.push('target');
        if (r.wordsFound) meta.push(r.wordsFound + ' words');
        const metaTxt = meta.length ? `<span class="meta">${meta.join(' · ')}</span>` : '';
        return `<div class="ps-round-row${cls}">` +
          `<div class="title">${esc(r.articleTitle || '?')}</div>` +
          metaTxt +
          `<div class="pts">${fmtNum(r.points || 0)}</div>` +
        '</div>';
      }).join('');
      sections.push('<div class="ps-section-h">Recent rounds</div>' + rows);
    }

    psBody.innerHTML = sections.join('');
  }
  function closePlayerStats() { psModal.classList.add('hidden'); }
  scoreboardEl.addEventListener('click', (e) => {
    const card = e.target.closest('.tp-card');
    if (!card || card.classList.contains('empty')) return;
    const key = card.dataset.playerKey;
    const nick = card.dataset.playerNick;
    if (key) openPlayerStats(key, nick);
  });
  scoreboardEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.tp-card');
    if (!card || card.classList.contains('empty')) return;
    e.preventDefault();
    const key = card.dataset.playerKey;
    const nick = card.dataset.playerNick;
    if (key) openPlayerStats(key, nick);
  });
  psClose.addEventListener('click', closePlayerStats);
  psModal.addEventListener('click', (e) => { if (e.target === psModal) closePlayerStats(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !psModal.classList.contains('hidden')) closePlayerStats(); });

  // ── Stats drawer (slides down from header) ───────────────
  const statsToggle = document.getElementById('statsToggle');
  const statsDrawer = document.getElementById('statsDrawer');
  const statsBackdrop = document.getElementById('statsBackdrop');
  const statsDrawerClose = document.getElementById('statsDrawerClose');
  const statsDrawerBody = document.getElementById('statsDrawerBody');
  const statsDrawerTabs = statsDrawer ? statsDrawer.querySelectorAll('.stats-drawer-tab') : [];
  let statsActiveTab = 'career';
  let statsCareerCache = null;
  let statsCareerLoadedFor = null;

  function getCurrentUserKey() {
    try {
      const u = window.WikiSearchleAuth && window.WikiSearchleAuth.getUser && window.WikiSearchleAuth.getUser();
      if (!u) return null;
      const name = u.globalName || u.displayName || u.username || u.name;
      return name ? String(name).toLowerCase() : null;
    } catch (e) { return null; }
  }

  function openStatsDrawer() {
    if (!statsDrawer) return;
    statsDrawer.classList.remove('hidden');
    statsBackdrop.classList.remove('hidden');
    // Force reflow so the transition runs from the hidden translateY.
    void statsDrawer.offsetWidth;
    statsDrawer.classList.add('open');
    statsBackdrop.classList.add('open');
    statsToggle.setAttribute('aria-expanded', 'true');
    renderStatsDrawerTab(statsActiveTab);
  }
  function closeStatsDrawer() {
    if (!statsDrawer) return;
    statsDrawer.classList.remove('open');
    statsBackdrop.classList.remove('open');
    statsToggle.setAttribute('aria-expanded', 'false');
    // Hide via display: none after the slide-out animation completes so it
    // doesn't capture clicks while invisible.
    setTimeout(() => {
      if (!statsDrawer.classList.contains('open')) {
        statsDrawer.classList.add('hidden');
        statsBackdrop.classList.add('hidden');
      }
    }, 320);
  }

  function renderStatsDrawerTab(tab) {
    statsActiveTab = tab;
    statsDrawerTabs.forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (tab === 'career') renderStatsDrawerCareer();
    else if (tab === 'round') renderStatsDrawerRound();
    else if (tab === 'ranked') renderStatsDrawerRanked();
  }

  function renderStatsDrawerCareer() {
    const key = getCurrentUserKey();
    if (!key) {
      statsDrawerBody.innerHTML = '<div class="ps-empty">Sign in to track your stats across rounds.</div>';
      return;
    }
    if (statsCareerCache && statsCareerLoadedFor === key) {
      writeStatsDrawerCareer(statsCareerCache);
      return;
    }
    statsDrawerBody.innerHTML = '<div class="ps-loading">Loading…</div>';
    fetch('/api/player-stats/' + encodeURIComponent(key), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'no-data' : 'fetch-failed'))))
      .then((data) => {
        statsCareerCache = data;
        statsCareerLoadedFor = key;
        writeStatsDrawerCareer(data);
      })
      .catch((err) => {
        statsDrawerBody.innerHTML = (err && err.message === 'no-data')
          ? '<div class="ps-empty">No history yet — stats begin accumulating from the next completed round.</div>'
          : '<div class="ps-empty">Could not load stats.</div>';
      });
  }
  function writeStatsDrawerCareer(data) {
    const lt = data.lifetime || null;
    const cr = data.currentRound || null;
    const sections = [];
    if (cr) {
      sections.push(
        '<div class="ps-section-h">This round</div>' +
        '<div class="ps-round-row">' +
          `<div class="title">${esc(cr.articleTitle || cr.targetWord || '?')}</div>` +
          `<div class="pts">${fmtNum(cr.points)}</div>` +
        '</div>'
      );
    }
    const hitRate = lt && lt.totalGuesses > 0
      ? Math.round((lt.totalWordsFound / lt.totalGuesses) * 100) + '%'
      : '—';
    const bestRound = (lt && lt.bestRound) || null;
    sections.push(
      '<div class="ps-section-h">Lifetime</div>' +
      '<div class="ps-grid">' +
        (lt ? [
          ['Total points', fmtNum(lt.totalPoints || 0), ''],
          ['Rounds played', fmtNum(lt.roundsPlayed || 0), ''],
          ['Wins', fmtNum(lt.roundsWon || 0), (lt.roundsPlayed ? Math.round((lt.roundsWon/lt.roundsPlayed)*100) + '% win rate' : '')],
          ['Targets found', fmtNum(lt.targetFinds || 0), ''],
          ['Best round', bestRound ? fmtNum(bestRound.points) : '—', bestRound ? esc(bestRound.articleTitle || '') : ''],
          ['Hit rate', hitRate, lt.totalWordsFound ? fmtNum(lt.totalWordsFound) + ' / ' + fmtNum(lt.totalGuesses) : ''],
        ].map(([label, val, sub]) =>
          `<div class="ps-stat"><div class="ps-stat-label">${label}</div><div class="ps-stat-val">${val}</div>${sub ? `<div class="ps-stat-sub">${sub}</div>` : ''}</div>`
        ).join('') : '<div class="ps-empty" style="grid-column: 1 / -1">No history yet.</div>') +
      '</div>'
    );
    if (lt && Array.isArray(lt.recentRounds) && lt.recentRounds.length > 0) {
      const rows = lt.recentRounds.slice(0, 8).map((r) => {
        const cls = r.wonRound ? ' crown' : '';
        const meta = [];
        if (r.foundTarget) meta.push('target');
        if (r.wordsFound) meta.push(r.wordsFound + ' words');
        const metaTxt = meta.length ? `<span class="meta">${meta.join(' · ')}</span>` : '';
        return `<div class="ps-round-row${cls}"><div class="title">${esc(r.articleTitle || '?')}</div>${metaTxt}<div class="pts">${fmtNum(r.points || 0)}</div></div>`;
      }).join('');
      sections.push('<div class="ps-section-h">Recent rounds</div>' + rows);
    }
    statsDrawerBody.innerHTML = sections.join('');
  }

  let statsRankedCache = null;
  let statsRankedCacheTime = 0;

  function getEloTier(elo) {
    if (elo >= 2400) return { name: 'Grandmaster', color: '#ff0055' };
    if (elo >= 2200) return { name: 'Master', color: '#ffd700' };
    if (elo >= 2000) return { name: 'Expert', color: '#f44336' };
    if (elo >= 1800) return { name: 'Class A', color: '#ff9800' };
    if (elo >= 1600) return { name: 'Class B', color: '#9c27b0' };
    if (elo >= 1400) return { name: 'Class C', color: '#2196f3' };
    if (elo >= 1200) return { name: 'Class D', color: '#4caf50' };
    if (elo >= 1000) return { name: 'Novice', color: '#8bc34a' };
    return { name: 'Beginner', color: '#9e9e9e' };
  }

  function renderStatsDrawerRanked() {
    const now = Date.now();
    // Cache for 60 seconds to avoid hammering the API
    if (statsRankedCache && (now - statsRankedCacheTime) < 60000) {
      writeStatsDrawerRanked(statsRankedCache);
      return;
    }
    statsDrawerBody.innerHTML = '<div class="ps-loading">Loading rankings…</div>';
    fetch('/api/elo/leaderboard', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch-failed'))))
      .then((data) => {
        statsRankedCache = data;
        statsRankedCacheTime = now;
        writeStatsDrawerRanked(data);
      })
      .catch((err) => {
        statsDrawerBody.innerHTML = '<div class="ps-empty">Could not load rankings.</div>';
      });
  }

  function writeStatsDrawerRanked(data) {
    const board = data.leaderboard || data.players || [];
    const userKey = getCurrentUserKey();
    const userIdentityKeys = [];
    if (userKey) {
      userIdentityKeys.push('nick:' + userKey);
      // Also try plain nickname match for broader compatibility
      userIdentityKeys.push(userKey);
    }

    const rows = board.length
      ? board.slice(0, 50).map((p, i) => {
          const tier = getEloTier(p.elo || 1200);
          const isMe = userIdentityKeys.some(k => (p.identityKey || '').toLowerCase().includes(k) || (p.nickname || '').toLowerCase() === k);
          const meClass = isMe ? ' style="background:rgba(255,102,0,0.12)"' : '';
          return `<div class="ps-round-row"${meClass}><div class="title">${i + 1}. ${esc(p.nickname || p.identityKey || '?')}</div><div class="pts" style="color:${tier.color}">${fmtNum(p.elo || 0)} ${tier.name}</div></div>`;
        }).join('')
      : '<div class="ps-empty">No rated players yet.</div>';

    const legend = [
      { min: 2400, name: 'Legend', color: '#ff0055' },
      { min: 2000, name: 'Elder', color: '#f44336' },
      { min: 1600, name: 'Canopy', color: '#9c27b0' },
      { min: 1200, name: 'Sapling', color: '#4caf50' },
      { min: 0, name: 'Sprout', color: '#9e9e9e' },
    ].map(t => `<span style="color:${t.color};font-weight:700;">${t.name}</span>`).join(' · ');

    statsDrawerBody.innerHTML =
      '<div class="ps-section-h">Top Rated Players</div>' + rows +
      '<div class="ps-section-h">Tiers</div>' +
      '<div style="color:var(--muted);font-size:12px;line-height:1.6">' + legend + '</div>';
  }

  function renderStatsDrawerRound() {
    // Pull live round leaderboard from currentRound state via the most-
    // recent wikisearchle-state snapshot. We cache the latest snapshot in
    // a global so it's available without re-fetching.
    const snap = window._lastWikiState || null;
    if (!snap || !snap.targetWord) {
      statsDrawerBody.innerHTML = '<div class="ps-empty">No round in progress.</div>';
      return;
    }
    const board = (snap.scoreboard || []).slice(0, 10);
    const rows = board.length
      ? board.map((p, i) => `<div class="ps-round-row"><div class="title">${i + 1}. ${esc(p.nickname || '?')}</div><div class="pts">${fmtNum(p.points || 0)}</div></div>`).join('')
      : '<div class="ps-empty">No guesses yet — be the first!</div>';
    statsDrawerBody.innerHTML =
      '<div class="ps-section-h">Live leaderboard</div>' + rows +
      '<div class="ps-section-h">Round info</div>' +
      '<div class="ps-grid">' +
        `<div class="ps-stat"><div class="ps-stat-label">Total guesses</div><div class="ps-stat-val">${fmtNum(snap.guessCount || 0)}</div></div>` +
        `<div class="ps-stat"><div class="ps-stat-label">Players</div><div class="ps-stat-val">${fmtNum(board.length)}</div></div>` +
      '</div>';
  }

  if (statsToggle && statsDrawer) {
    statsToggle.addEventListener('click', () => {
      const open = statsDrawer.classList.contains('open');
      if (open) closeStatsDrawer();
      else openStatsDrawer();
    });
    statsDrawerClose.addEventListener('click', closeStatsDrawer);
    statsBackdrop.addEventListener('click', closeStatsDrawer);
    statsDrawerTabs.forEach((b) => b.addEventListener('click', () => renderStatsDrawerTab(b.dataset.tab)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && statsDrawer.classList.contains('open')) closeStatsDrawer();
    });
  }

  // ── Announce banner ───────────────────────────────
  // Shrink an element's font-size 1px at a time until its text fits within
  // its own clientWidth (or hits minPx). Used to keep the word-announce
  // card's word + name visible without ellipsis when they're long.
  function fitText(el, minPx) {
    if (!el) return;
    el.style.fontSize = '';
    if (el.scrollWidth <= el.clientWidth + 1) return;
    let size = parseFloat(getComputedStyle(el).fontSize) || 16;
    while (el.scrollWidth > el.clientWidth + 1 && size > (minPx || 8)) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }
  // Scale every visible child of `parent` proportionally until the row fits
  // within parent's clientWidth (or hits minPx). Use when children have
  // flex-shrink: 0 (e.g. wa-total / wa-earned) and per-element fitText
  // can't trim them — a full row-level scale-down does.
  function fitRow(parent, minPx) {
    if (!parent) return;
    const kids = Array.from(parent.children).filter((c) => c.offsetParent !== null);
    if (!kids.length) return;
    kids.forEach((c) => { c.style.fontSize = ''; });
    if (parent.scrollWidth <= parent.clientWidth + 1) return;
    const sizes = kids.map((c) => parseFloat(getComputedStyle(c).fontSize) || 14);
    const min = minPx || 8;
    let scale = 1;
    while (parent.scrollWidth > parent.clientWidth + 1 && scale > 0.4) {
      scale -= 0.04;
      kids.forEach((c, i) => {
        const s = Math.max(min, sizes[i] * scale);
        c.style.fontSize = s + 'px';
      });
      if (sizes.every((s) => s * scale <= min)) break;
    }
  }
  // ── Per-word XP fly-out ───────────────────────────
  // Numbers erupt from the word where it actually appears in the ARTICLE BODY
  // and arc into the "word found" banner.
  //
  // `wikisearchle-announce` carries the points and the guessed word; by the time
  // it arrives, `wikiword-reveal` has already un-redacted the matching body span,
  // so we fire directly from the DOM (like solo mode). If the DOM isn't ready
  // yet, we fall back to banking the award against a fresh reveal or the announce
  // norm itself and letting spawnRevealXp claim it later.
  //
  // Two robustness fixes for online:
  // 1. After scrolling, re-query the DOM by norm — renderArticle can recreate the
  //    article while a smooth-scroll is in flight, and the original element
  //    reference becomes detached.
  // 2. FX.tumbleWord wraps revealed letters in `.fx-letter` spans; when those are
  //    present, use the spans as the per-letter source rects instead of Range
  //    slices on a text node.
  // Diagnostic only. No behaviour change unless ?xpdebug=1 is on the URL.
  const XPDBG = /[?&]xpdebug=1/.test(location.search);
  function xpdbg() { if (XPDBG) try { console.log.apply(console, ['[xp]'].concat([].slice.call(arguments))); } catch (e) {} }

  const _xpAwardByNorm = new Map();   // norm -> { earned, cosmetics, at }
  const _xpPaidNorms = new Set();     // norms already paid out this round
  const XP_AWARD_TTL_MS = 15000;

  function normWord(w) {
    return String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Directly spawn from a revealed body occurrence, exactly like solo mode.
  // Returns true if a source element was found and the flyout was attempted.
  function spawnRevealXpFromDom(norm, award) {
    if (!window.XpFlyout || !norm || !bodyEl || !award || award.earned <= 0) return false;
    const cands = bodyEl.querySelectorAll('.word.revealed[data-norm="' + norm + '"]');
    xpdbg('direct spawn try: norm=' + norm + ' cands=' + cands.length + ' earned=' + award.earned);
    if (!cands.length) return false;

    const el = cands[0];
    const zoom = getHtmlZoom();
    const obsScale = getObsScale();
    const scale = zoom * obsScale;
    const box = bodyEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const lineHeight = getLineHeight(el);
    const offsetVisual = r.top - (box.top + 2 * lineHeight);
    const offsetCss = offsetVisual / scale;

    function fireFromVisible() {
      // The article may have re-rendered during the smooth-scroll wait, so
      // re-query by norm instead of trusting the original element reference.
      const liveCands = bodyEl.querySelectorAll('.word.revealed[data-norm="' + norm + '"]');
      if (!liveCands.length) { xpdbg('direct spawn: no live occurrence of "' + norm + '" after scroll'); return; }
      const box2 = bodyEl.getBoundingClientRect();
      let src = null;
      for (let i = 0; i < liveCands.length; i++) {
        const r2 = liveCands[i].getBoundingClientRect();
        if (r2.width && r2.bottom > box2.top + 2 && r2.top < box2.bottom - 2) { src = liveCands[i]; break; }
      }
      if (!src) src = liveCands[0];
      xpdbg('direct spawn: firing from occurrence of "' + norm + '"');
      fireRevealXpFrom(src, award);
    }

    const top = Math.max(0, bodyEl.scrollTop + offsetCss);
    xpdbg('direct spawn: scroll "' + norm + '" to 2 lines below top (top=' + Math.round(top) + ' scale=' + scale.toFixed(3) + ')');
    bodyEl.scrollTo({ top: top, behavior: 'auto' });
    waitForScroll(bodyEl, fireFromVisible);
    return true;
  }

  function noteXpAward(a) {
    if (!a || !a.word) { xpdbg('award: no announce/word'); return; }
    const n = normWord(a.word);
    xpdbg('award in: word=' + a.word + ' norm=' + n + ' earned=' + a.earned);
    if (!n) { xpdbg('award: empty norm'); return; }
    if (_xpPaidNorms.has(n)) { xpdbg('award: already paid this round'); return; }
    const now = Date.now();
    // Prune stale banked awards.
    for (const [k, v] of _xpAwardByNorm) if (now - v.at > XP_AWARD_TTL_MS) _xpAwardByNorm.delete(k);

    const award = {
      earned: Number(a.earned) || 0,
      cosmetics: (a.user && a.user.cosmetics) || null,
      at: now
    };

    // PRIMARY PATH: try to fire immediately from the DOM, like solo mode.
    // The reveal event already updated the article; if the announced word (or a
    // morphological variant that was just revealed) is visible, animate now.
    if (spawnRevealXpFromDom(n, award)) {
      _xpPaidNorms.add(n);
      xpdbg('award: direct spawn succeeded for "' + n + '"');
      return;
    }

    // EXACT FRESH fallback: the DOM may not be updated yet if this announce
    // raced ahead of the reveal, but the reveal is still fresh in memory.
    const ts = freshReveals.get(n);
    let target = (typeof ts === 'number' && (now - ts) < FRESH_REVEAL_MS) ? n : null;
    if (!target) {
      for (const [k, t] of freshReveals) {
        if ((now - t) < FRESH_REVEAL_MS && !_xpPaidNorms.has(k)) { target = k; break; }
      }
      if (target) xpdbg('award: exact norm not in DOM, attributing to just-revealed "' + target + '"');
    }

    if (target) {
      _xpAwardByNorm.set(target, award);
      spawnRevealXp(target);
      _xpPaidNorms.add(n);
      xpdbg('award: banked under fresh target "' + target + '"');
      return;
    }

    // LAST RESORT: bank the award under the announce norm. When the reveal
    // event finally lands (or on a re-render that calls applyFreshRevealToDom),
    // spawnRevealXp will pick it up if the word is revealed.
    _xpAwardByNorm.set(n, award);
    xpdbg('award: banked under "' + n + '" — waiting for reveal/DOM (normal if reveal lags)');
  }

  // Effective page zoom for the scrolling container. <html> is zoomed to 0.75
  // on desktop pointer devices below 1000px, while scrollTop lives in CSS pixels.
  // Visual measurements must be divided by this factor before adding to scrollTop.
  function getHtmlZoom() {
    try {
      const z = parseFloat(getComputedStyle(document.documentElement).zoom);
      if (isFinite(z) && z > 0) return z;
    } catch (e) {}
    try {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden;';
      document.body.appendChild(probe);
      const zoom = probe.getBoundingClientRect().width / 100;
      document.body.removeChild(probe);
      return zoom || 1;
    } catch (e) { return 1; }
  }

  // OBS overlay mode scales .page-wrap via CSS transform (see the obs=1 block
  // near the top of the page). getHtmlZoom catches html { zoom } but not this
  // transform, so measure it separately and combine the two when converting
  // visual pixels to scrollTop CSS pixels.
  function getObsScale() {
    try {
      const wrap = document.querySelector('.page-wrap');
      if (!wrap) return 1;
      const t = getComputedStyle(wrap).transform;
      if (!t || t === 'none') return 1;
      const m = t.match(/matrix\(([^,]+)\s*,/);
      if (m) {
        const s = parseFloat(m[1]);
        if (isFinite(s) && s > 0) return s;
      }
    } catch (e) {}
    return 1;
  }

  function waitForScroll(el, onDone) {
    let last = -1, ticks = 0;
    const iv = setInterval(function () {
      const cur = el.scrollTop;
      ticks++;
      if ((cur === last && ticks > 1) || ticks > 16) {
        clearInterval(iv);
        if (onDone) onDone();
      }
      last = cur;
    }, 90);
  }

  // Resolved line height of an element's text. Used to position newly found
  // words a fixed number of lines below the top of the scrolling article.
  function getLineHeight(el) {
    try {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (isFinite(lh) && lh > 0) return lh;
    } catch (e) {}
    const r = el.getBoundingClientRect();
    return r.height > 0 ? r.height * 1.2 : 24;
  }

  // Fired once per freshly-revealed word. Throws from the first occurrence that
  // is actually SCROLLED INTO VIEW inside #body — that panel is overflow:auto
  // and taller than its box, so a word below the fold would otherwise launch
  // numbers from somewhere the viewer cannot see.
  function spawnRevealXp(norm) {
    xpdbg('spawn try: norm=' + norm + ' XpFlyout=' + !!window.XpFlyout + ' bodyEl=' + !!bodyEl);
    if (!window.XpFlyout || !norm || !bodyEl) { xpdbg('spawn: missing XpFlyout/norm/bodyEl'); return; }
    if (_xpPaidNorms.has(norm)) { xpdbg('spawn: already paid'); return; }
    const award = _xpAwardByNorm.get(norm);
    if (!award || award.earned <= 0) { xpdbg('spawn: no award banked yet for "' + norm + '" earned=' + (award && award.earned)); return; }

    const cands = bodyEl.querySelectorAll('.word.revealed[data-norm="' + norm + '"]');
    xpdbg('spawn: cands=' + cands.length + ' for "' + norm + '" earned=' + award.earned);
    if (!cands.length) { xpdbg('spawn: no revealed occurrence of "' + norm + '" in #body'); return; }

    _xpAwardByNorm.delete(norm);
    _xpPaidNorms.add(norm);

    const el = cands[0];
    const zoom = getHtmlZoom();
    const obsScale = getObsScale();
    const scale = zoom * obsScale;
    const box = bodyEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const lineHeight = getLineHeight(el);
    const offsetVisual = r.top - (box.top + 2 * lineHeight);
    const offsetCss = offsetVisual / scale;

    function fireFromVisible() {
      // Re-query after any smooth-scroll wait — the article can re-render.
      const liveCands = bodyEl.querySelectorAll('.word.revealed[data-norm="' + norm + '"]');
      if (!liveCands.length) { xpdbg('spawn: no live occurrence of "' + norm + '" after scroll'); return; }
      const box2 = bodyEl.getBoundingClientRect();
      let src = null;
      for (let i = 0; i < liveCands.length; i++) {
        const r2 = liveCands[i].getBoundingClientRect();
        if (r2.width && r2.bottom > box2.top + 2 && r2.top < box2.bottom - 2) { src = liveCands[i]; break; }
      }
      if (!src) src = liveCands[0];
      xpdbg('spawn: firing from occurrence of "' + norm + '" earned=' + award.earned);
      fireRevealXpFrom(src, award);
    }

    const top = Math.max(0, bodyEl.scrollTop + offsetCss);
    xpdbg('spawn: scroll ' + cands.length + ' occurrence(s) of "' + norm + '" to 2 lines below top (top=' + Math.round(top) + ' scale=' + scale.toFixed(3) + ')');
    bodyEl.scrollTo({ top: top, behavior: 'auto' });
    waitForScroll(bodyEl, fireFromVisible);
    return;
  }

  // Measure per-letter rects and throw the numbers. The body span is either a
  // single text node (Range slices, DOM untouched) or FX.tumbleWord has wrapped
  // each letter in .fx-letter spans (online path). Both are handled here.
  function fireRevealXpFrom(src, award) {
    const letters = src.querySelectorAll('.fx-letter');
    let word, cellEls;
    if (letters.length) {
      // FX.tumbleWord wrapped each letter in a span; use those spans as the
      // per-letter source rects. This is the online path.
      word = src.textContent || '';
      cellEls = Array.from(letters);
      xpdbg('fire: tumbled word="' + word + '" letters=' + letters.length + ' earned=' + award.earned);
    } else {
      const node = src.firstChild;
      if (!node || node.nodeType !== 3 || !node.data) {
        xpdbg('fire: bad text node. outerHTML=' + (src.outerHTML || '').slice(0, 120) +
              ' childNodes=' + src.childNodes.length +
              ' firstType=' + (src.firstChild && src.firstChild.nodeType) +
              ' fxLetters=' + src.querySelectorAll('.fx-letter').length);
        return;
      }
      word = node.data;
      cellEls = [];
      let goodRects = 0;
      for (let i = 0; i < node.data.length; i++) {
        const rg = document.createRange();
        rg.setStart(node, i);
        rg.setEnd(node, i + 1);
        const r = rg.getBoundingClientRect();
        const ok = !!(r.width || r.height);
        if (ok) goodRects++;
        cellEls.push(ok ? { getBoundingClientRect: () => r } : null);
      }
      xpdbg('fire: word="' + word + '" goodRects=' + goodRects + '/' + word.length + ' earned=' + award.earned);
    }
    try {
      XpFlyout.spawn({
        word: word,
        cellEls: cellEls,
        gridEl: bodyEl,
        total: award.earned,
        cosmetics: award.cosmetics,
        targetSelectors: ['#waEarned', '#waTotal', '.word-announce'],
        onArrive: function () { XpFlyout.pulse(announceEl, null); }
      });
      xpdbg('fire: XpFlyout.spawn called for "' + word + '"');
    } catch (e) { xpdbg('fire: XpFlyout.spawn threw', e && e.message); }
  }

  function renderAnnounce(a) {
    if (!a) {
      announceEl.classList.remove('hidden');
      announceEl.classList.add('beta-invite');
      if (window.WikiCosmetics) WikiCosmetics.apply({ surfaceEl: announceEl }, null);
      return;
    }
    announceEl.classList.remove('hidden', 'beta-invite');
    noteXpAward(a);
    waAvatar.innerHTML = avatarHtml(a.user, 'wa-avatar');
    waName.textContent = a.nickname || 'viewer';
    waTotal.textContent = `${fmtNum(a.totalPoints)} pts`;
    waEarned.textContent = `+${fmtNum(a.earned)}`;
    waWord.textContent = (a.word || '').toUpperCase();
    const tier = (a.rarity || 'common').toLowerCase();
    waRarity.className = `wa-rarity ${tier}`;
    waRarity.textContent = tier.toUpperCase();
    // Paint the announce banner with the finder's equipped cosmetics:
    // hero_badge fills the whole banner background; profile_border /
    // profile_glow ring the avatar; name_color / name_glow style the name.
    // Title is intentionally skipped here — the banner is already crowded.
    if (window.WikiCosmetics) {
      window.WikiCosmetics.apply({
        surfaceEl: announceEl,
        avatarEl: waAvatar,
        nameEl: waName,
        titleContainer: null,
      }, a.user && a.user.cosmetics);
    }
    // Perk hearts on the finder's avatar. innerHTML above wipes the badge
    // spans on every announce; PerkBadges re-adds them because it compares the
    // rendered child count, not just the perk signature.
    applyPerkBadge(waAvatar, a.user);
    requestAnimationFrame(() => {
      fitText(waWord, 12);
      fitText(waEarned, 12);
      // Keep the identity and lifetime total together without letting either
      // collide with the independently centered found word or reward value.
      fitRow(waName.parentNode, 10);
    });
  }

  // ── Ticker chips ──────────────────────────────────
  // Flex fills left-to-right; each new chip slides in from the right edge of
  // the ticker to its natural slot. Chips accumulate until the row is full,
  // then the oldest (leftmost) slides off to make room.
  const TICKER_GAP = 3;
  const TICKER_FADE_INSET = 24; // matches .ticker::after gradient width
  function pushChip(chip) {
    const el = document.createElement('div');
    el.className = `chip ${chip.status}`;
    // Red x for any miss-flavoured chip (fresh miss OR duplicate miss);
    // green check for everything else (fresh hit OR duplicate hit).
    const isMiss = chip.status === 'miss' || chip.status === 'dup-miss';
    const icon = isMiss ? '✕' : '✓';
    // If the server attached a profilePic for the guesser, render it on the
    // left of the word. Falls back silently if the image fails to load.
    const avatarHtml = chip.profilePic
      ? `<img class="chip-avatar" src="${esc(chip.profilePic)}" alt="" onerror="this.remove();">`
      : '';
    el.innerHTML = `${avatarHtml}<span>${esc(chip.word)}</span><span class="tick">${icon}</span>`;
    ticker.appendChild(el);
    // After layout, compute slide distance so the chip starts with its
    // right edge just inside the ticker's fade gradient (always fully
    // visible) and animates to its natural flex slot. If the chip's
    // natural position is already inside that zone, slideDist = 0 and the
    // chip just fades in place.
    requestAnimationFrame(() => {
      const chipRightAtEnd = el.offsetLeft + el.offsetWidth;
      const chipRightAtStart = ticker.clientWidth - TICKER_FADE_INSET;
      const slideDist = Math.max(0, chipRightAtStart - chipRightAtEnd);
      el.style.setProperty('--slide-dist', `${slideDist}px`);
      // Restart the animation so the newly-set variable is applied.
      el.style.animation = 'none'; void el.offsetWidth;
      el.style.animation = '';

      // Eviction: when the row overflows, fade out the oldest chip.
      let total = 0;
      for (const c of ticker.children) {
        if (c.classList.contains('exit')) continue;
        total += c.offsetWidth + TICKER_GAP;
      }
      total -= TICKER_GAP;
      if (total > ticker.clientWidth) {
        for (const c of ticker.children) {
          if (c === el) break;
          if (c.classList.contains('exit')) continue;
          c.classList.add('exit');
          c.addEventListener('animationend', () => { if (c.parentNode) c.remove(); }, { once: true });
          break;
        }
      }
    });
  }

  // ── Fresh-reveal + sentence pending-hide tracking ─────────
  // Every revealed word gets a short reveal animation, then settles back to
  // normal article text (freshReveals, populated by wikiword-reveal).
  // Independently, fully-revealed sentences linger on-screen for 5 seconds
  // before being removed (pendingHideSentences, populated by state diff).
  // Both timers share one expiry setTimeout.
  const FRESH_REVEAL_MS = 5000;
  const PENDING_HIDE_MS = 5000;
  let prevArticleState = null;
  const freshReveals = new Map();
  const _fxTumbledWords = new Set();          // norm -> revealedAt ms
  const pendingHideSentences = new Map();  // "pi:sid" -> { completeAt }
  let expiryTimer = null;
  // Title-word state — who found each title word (for the PFP badge) and
  // which norms just flipped hidden→revealed this frame (for one-shot
  // reveal animation). Populated by wikisearchle-state (on reconnect) and
  // wikisearchle-title-word-found (incrementally).
  const titleWordFinders = new Map();      // norm -> { nickname, profilePic, platform }
  const titleJustRevealedNorms = new Set();

  function buildSentenceMap(state) {
    const out = new Map();
    if (!state) return out;
    for (let pi = 0; pi < state.paragraphs.length; pi++) {
      for (const t of state.paragraphs[pi]) {
        if (t.type !== 'word') continue;
        const sid = t.sentenceId || 0;
        const key = `${pi}:${sid}`;
        if (!out.has(key)) out.set(key, { words: [], allRevealed: true });
        const rec = out.get(key);
        rec.words.push(t);
        if (!t.revealed) rec.allRevealed = false;
      }
    }
    return out;
  }

  function diffPendingHide(prev, next) {
    if (!next) return;
    const prevMap = buildSentenceMap(prev);
    const nextMap = buildSentenceMap(next);
    const now = Date.now();
    for (const [key, rec] of nextMap) {
      if (!rec.allRevealed) continue;
      const pr = prevMap.get(key);
      if (pr && pr.allRevealed) continue;       // already complete — ignore
      if (pendingHideSentences.has(key)) continue;
      pendingHideSentences.set(key, { completeAt: now });
    }
  }

  function markFreshReveals(words) {
    if (!words || !words.length) return;
    const now = Date.now();
    for (const w of words) {
      const n = String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (n) freshReveals.set(n, now);
    }
  }

  function applyFreshRevealToDom() {
    const now = Date.now();
    document.querySelectorAll('#body .word.revealed').forEach(el => {
      const n = el.dataset.norm || el.textContent.toLowerCase().replace(/[^a-z0-9]/g, '');
      const ts = freshReveals.get(n);
      if (typeof ts !== 'number') return;
      const elapsed = now - ts;
      if (elapsed < 0 || elapsed >= FRESH_REVEAL_MS) return;
      el.classList.remove('fresh-reveal');
      void el.offsetWidth;
      el.classList.add('fresh-reveal');
      el.style.animationDelay = `-${elapsed}ms`;
      if (window.FX && !window.WikiMotion && !_fxTumbledWords.has(n)) {
        _fxTumbledWords.add(n);
        window.FX.tumbleWord(el);
      }
      // Not gated on window.FX: spawnRevealXp owns its own once-per-word guard,
      // so the numbers still fly if the FX engine failed to load.
      spawnRevealXp(n);
    });
  }

  function scheduleExpiryRerender() {
    if (expiryTimer) return;
    let soonest = Infinity;
    for (const ts of freshReveals.values()) soonest = Math.min(soonest, ts + FRESH_REVEAL_MS);
    for (const r of pendingHideSentences.values()) soonest = Math.min(soonest, r.completeAt + PENDING_HIDE_MS);
    if (soonest === Infinity) return;
    const delay = Math.max(0, soonest - Date.now());
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      const now = Date.now();
      for (const [n, ts] of freshReveals) if (now - ts >= FRESH_REVEAL_MS) freshReveals.delete(n);
      for (const [k, r] of pendingHideSentences) if (now - r.completeAt >= PENDING_HIDE_MS) pendingHideSentences.delete(k);
      if (prevArticleState) renderArticle(prevArticleState);
      scheduleExpiryRerender();
    }, delay + 20);
  }

  function renderHintPrompt(prompt) {
    if (!hintPromptEl) return;
    const show = !!(prompt && prompt.show);
    if (titleBlock) titleBlock.classList.toggle('has-hint-prompt', show);
    if (!show) {
      hintPromptEl.classList.add('is-hidden');
      hintPromptEl.textContent = '';
      hintPromptEl.removeAttribute('aria-label');
      return;
    }
    const required = Math.max(1, Number(prompt.likesRequired) || 1000);
    const likes = Math.max(0, Math.min(required, Math.floor(Number(prompt.likes) || 0)));
    const label = likes > 0
      ? `${fmtNum(likes)} / ${fmtNum(required)} likes for hint`
      : `${fmtNum(required)} likes for hint`;
    hintPromptEl.textContent = label;
    hintPromptEl.setAttribute('aria-label', label);
    hintPromptEl.classList.remove('is-hidden');
  }

  // ── Article ───────────────────────────────────────
  function renderArticle(state) {
    if (!state) {
      titleText.innerHTML = '';
      bodyEl.innerHTML = '';
      revealProgressEl.textContent = '— / —';
      renderHintPrompt(null);
      fitTitleSlot();
      return;
    }
    let total = 0, revealed = 0;
    for (const para of state.paragraphs) for (const t of para) if (t.type === 'word') { total++; if (t.text) revealed++; }
    revealProgressEl.textContent = `${fmtNum(revealed)} / ${fmtNum(total)}`;
    try { fitStats(); } catch (e) {}

    titleText.innerHTML = '';
    // Always render per-word. Revealed words show the text (uppercased,
    // orange) with a small PFP badge of whoever found them. Unrevealed
    // words show a HIDDEN redaction box. Punctuation/spaces between
    // adjacent words are suppressed — flex gap handles spacing.
    for (const t of state.titleTokens) {
      if (t.type !== 'word') continue;
      const wrap = document.createElement('span');
      const norm = (t.text ? t.text : '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || (t.norm || '');
      const wText = document.createElement('span');
      wText.className = 'w-text';
      if (t.revealed && t.text) {
        wrap.className = 't-word revealed';
        wText.textContent = t.text;
        wrap.dataset.norm = norm;
        if (titleJustRevealedNorms.has(norm)) {
          wrap.classList.add('just-revealed');
          if (window.FX) window.FX.unlockTitleWord(wrap);
        }
        wrap.appendChild(wText);
        // Finder PFP — only for title words we actually tracked. Title
        // stopwords like "of" / "and" are pre-revealed and have no finder.
        const finder = titleWordFinders.get(norm);
        if (finder) {
          // Wrap the pfp in a span so the FC badge ::after can sit relative
          // to a stable parent (the img element itself can't host the ::after
          // pseudo-element reliably across browsers).
          const pfpWrap = document.createElement('span');
          pfpWrap.className = 'finder-pfp-wrap';
          applyPerkBadge(pfpWrap, finder);
          const pfp = document.createElement(finder.profilePic ? 'img' : 'span');
          pfp.className = 'finder-pfp';
          if (finder.profilePic) {
            pfp.src = finder.profilePic;
            pfp.alt = '';
            pfp.onerror = () => {
              const fb = document.createElement('span');
              fb.className = 'finder-pfp fallback';
              fb.textContent = (finder.nickname || '?').charAt(0).toUpperCase();
              pfp.replaceWith(fb);
            };
          } else {
            pfp.classList.add('fallback');
            pfp.textContent = (finder.nickname || '?').charAt(0).toUpperCase();
          }
          pfpWrap.appendChild(pfp);
          wrap.appendChild(pfpWrap);
        }
      } else {
        const hintRaw = String(t.hintText || t.hintLetter || '').trim();
        const hintLen = Math.max(1, Number(t.len) || Array.from(hintRaw).length || 1);
        const hintChars = Array.from(hintRaw).slice(0, hintLen).join('').toUpperCase();
        const hintMask = hintChars ? hintChars + '_'.repeat(Math.max(0, hintLen - Array.from(hintChars).length)) : '';
        wrap.className = 't-word hidden current-hint';
        wText.textContent = hintMask || 'HIDDEN';
        wrap.title = `First letter revealed (${hintChars.length} of ${hintLen})`;
        wText.setAttribute('aria-label', `First letter revealed (${hintChars.length} of ${hintLen})`);
        wrap.appendChild(wText);
      }
      titleText.appendChild(wrap);
    }
    renderHintPrompt(state.hintPrompt || null);
    fitTitleSlot();
    // Clear the one-shot just-revealed set after a frame so the animation
    // doesn't replay on every subsequent re-render (e.g. body word reveals).
    if (titleJustRevealedNorms.size > 0) {
      setTimeout(() => titleJustRevealedNorms.clear(), 1000);
    }

    // Sentence-skip: once the title is revealed, hide the contiguous prefix
    // of already-fully-revealed sentences so the next partially-redacted
    // sentence moves to the top. A sentence in pendingHideSentences is fully
    // revealed but still within its 5s victory window — render it with green
    // highlights on the words that just completed it, and stop the prefix
    // walk there so later sentences render normally.
    // Only skip fully-revealed sentences mid-game, never on round-end —
    // otherwise the 15s post-win reveal hides the whole article because
    // every sentence is fully revealed at that point.
    const skipKeys = new Set();
    if (state.titleRevealed && !state.won) {
      let stop = false;
      for (let pi = 0; pi < state.paragraphs.length && !stop; pi++) {
        const buckets = new Map();
        for (const t of state.paragraphs[pi]) {
          if (t.type !== 'word') continue;
          const sid = t.sentenceId || 0;
          if (!buckets.has(sid)) buckets.set(sid, []);
          buckets.get(sid).push(t);
        }
        const sids = [...buckets.keys()].sort((a, b) => a - b);
        for (const sid of sids) {
          const key = `${pi}:${sid}`;
          if (buckets.get(sid).every(w => w.revealed)) {
            if (pendingHideSentences.has(key)) { stop = true; break; }
            skipKeys.add(key);
          } else { stop = true; break; }
        }
      }
    }

    // Build set of confirmed-found slot ids for the green-redaction paint.
    // foundConfirmed only flips true once two or more title words are found.
    const foundSlotSet = new Set(Array.isArray(state.foundSlotIds) ? state.foundSlotIds : []);
    const foundConfirmed = !!state.foundConfirmed;

    bodyEl.innerHTML = '';
    for (let pi = 0; pi < state.paragraphs.length; pi++) {
      const para = state.paragraphs[pi];
      const p = document.createElement('p');
      for (const t of para) {
        const sid = t.sentenceId || 0;
        const key = `${pi}:${sid}`;
        if (skipKeys.has(key)) continue;
        if (t.type === 'space') { p.appendChild(document.createTextNode(t.text)); continue; }
        const s = document.createElement('span');
        s.className = 'word';
        s.dataset.len = t.len;
        if (t.isNumber) s.classList.add('is-number');
        if (t.text) {
          s.textContent = t.text;
          s.classList.add('revealed');
          s.dataset.norm = t.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          const ts = freshReveals.get(s.dataset.norm);
          if (typeof ts === 'number') {
            const elapsed = Date.now() - ts;
            if (elapsed < FRESH_REVEAL_MS) {
              s.classList.add('fresh-reveal');
              s.style.animationDelay = `-${elapsed}ms`;
              if (window.FX && !window.WikiMotion && !_fxTumbledWords.has(s.dataset.norm)) {
                _fxTumbledWords.add(s.dataset.norm);
                window.FX.tumbleWord(s);
              }
            }
          }
        } else {
          s.classList.add('redacted');
          if (t.targetSlotId) {
            s.classList.add('target-slot');
            s.dataset.slotId = t.targetSlotId;
            // Confirmed-find paint: green redaction once two title words
            // have been found AND this slot is among the found set.
            if (foundConfirmed && foundSlotSet.has(t.targetSlotId)) {
              s.classList.add('confirmed');
            }
          }
          if (t.isNumber) {
            // Show "N DIGIT(S)" label inside the orange box so players know
            // the length of the hidden number without seeing its value.
            // Prefer digitCount (digits only, ignores trailing letters like
            // "1920s") and fall back to total token length if unset.
            const digits = (typeof t.digitCount === 'number' && t.digitCount > 0) ? t.digitCount : t.len;
            s.textContent = digits + ' DIGIT' + (digits === 1 ? '' : 'S');
          } else {
            s.style.minWidth = `calc(${t.len}ch + 8px)`;
            s.textContent = '\u00a0'.repeat(t.len);
          }
        }
        p.appendChild(s);
      }
      if (p.childNodes.length > 0) bodyEl.appendChild(p);
    }
  }

  // Anti-cheat: block copy / right-click / drag selection on the article,
  // title, and rank-card panels. CSS already kills user-select; these JS
  // listeners cover the keyboard-shortcut path and the right-click menu.
  (function installAntiCopy() {
    const ids = ['titleText', 'body', 'cards'];
    const blockEvents = ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      for (const ev of blockEvents) {
        el.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
      }
    }
  })();

  function setGuessCount(n) { localGuessCount = n; guessCountEl.textContent = fmtNum(n); fitStats(); }
  function fitStats() {
    document.querySelectorAll('.stats-bar .stat').forEach((stat) => {
      const val = stat.querySelector('.stat-val');
      if (!val) return;
      val.style.fontSize = '';
      let size = parseFloat(getComputedStyle(val).fontSize);
      let tries = 0;
      while (stat.scrollWidth > stat.clientWidth && size > 12 && tries < 30) {
        size -= 1;
        val.style.fontSize = size + 'px';
        tries++;
      }
    });
  }
  window.addEventListener('resize', () => {
    try { fitStats(); } catch (e) {}
    try { _cardDomCache.forEach((c) => fitWordLabel(c)); } catch (e) {}
  });

  // ── Socket events ─────────────────────────────────
  socket.on('wikisearchle-state', s => {
    if (s && s.error) {
      startOnlineLoading();
      if (window.WikiContextoLoading) window.WikiContextoLoading.fail(s.error);
      return;
    }
    roundStateReady = true;
    roundActive = !!(s && s.targetWord);
    // Cache the latest snapshot so the stats drawer's "This Round" tab can
    // read the live leaderboard without a separate fetch.
    window._lastWikiState = s || null;
    if (!s || !s.targetWord) {
      startOnlineLoading('Waiting for the next live round…');
      setIdle(); renderScoreboard([]); renderAnnounce(null);
      return;
    }
    if (s.totalRankedWords) totalRankedWordsCache = s.totalRankedWords;
    setActive();
    renderCards(s.topGuesses || [], true);
    renderScoreboard(s.scoreboard || []);
    renderAnnounce(s.lastAnnounce || null);
    setGuessCount(s.guessCount || 0);
    // Populate title-word finders from the authoritative server map so a
    // reconnecting / newly-loaded client sees existing PFP badges.
    titleWordFinders.clear();
    if (s.titleWordFinders) {
      for (const [n, f] of Object.entries(s.titleWordFinders)) titleWordFinders.set(n, f);
    }
    finishOnlineLoading();
  });
  socket.on('wikisearchle-round-start', () => {
    startOnlineLoading('Getting the next live round ready.');
    _guessCards.reset();
    _xpAwardByNorm.clear();
    _xpPaidNorms.clear();
    if (window.XpFlyout) XpFlyout.clearAll();
    _fxTumbledWords.clear();
    setActive();
    renderCards([]);
    renderScoreboard([]);
    renderAnnounce(null);
    ticker.innerHTML = '';
    setGuessCount(0);
    titleWordFinders.clear();
    titleJustRevealedNorms.clear();
    // Stop old reveal timers and clear both the article and its target slots.
    prevArticleState = null;
    freshReveals.clear();
    pendingHideSentences.clear();
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    renderArticle(null);
  });
  socket.on('wikisearchle-title-word-found', e => {
    if (!e) return;
    // Update the finders map from the server's authoritative view so the
    // PFP badge is always consistent, then flag the just-revealed norms
    // so the next renderArticle animates them.
    if (e.finders) {
      titleWordFinders.clear();
      for (const [n, f] of Object.entries(e.finders)) titleWordFinders.set(n, f);
    } else if (Array.isArray(e.wordsRevealed) && e.user) {
      for (const n of e.wordsRevealed) {
        titleWordFinders.set(n, {
          nickname: e.user.displayName || e.by || '',
          profilePic: e.user.profilePic || null,
          platform: e.user.platform || 'unknown',
        });
      }
    }
    for (const n of (e.wordsRevealed || [])) titleJustRevealedNorms.add(n);
    // Re-render using the last-known article state so the title updates
    // immediately (wikiword-state follows on the same socket but this lets
    // us trigger the reveal animation without waiting).
    if (prevArticleState) renderArticle(prevArticleState);
    window.WikiMotion.reveal([], { title: true });
    if (typeof e.totalRankedWords === 'number') totalRankedWordsCache = e.totalRankedWords;
  });
  socket.on('wikisearchle-title-revealed', () => {
    // endRound follows on the same socket; round-end handler animates
    // the final state. Nothing to do here for now — reserved for future
    // "title fully revealed" celebration effects.
  });
  socket.on('wikisearchle-round-end', () => {
    // The win card itself arrives via the `game-win` broadcast (WinCard).
    if (window.FX) window.FX.finale(titleBlock);
  });
  socket.on('wikisearchle-new-guess', g => { _guessCards.queue(g && g.word); setGuessCount(localGuessCount + 1); });
  socket.on('wikisearchle-top', top => { renderCards(top || []); });
  socket.on('wikisearchle-scoreboard', top3 => { renderScoreboard(top3 || []); });
  socket.on('wikisearchle-announce', a => { renderAnnounce(a); });
  socket.on('wikisearchle-chip', chip => { pushChip(chip); });

  socket.on('wikiword-state', s => {
    articleReceived = true;
    articleReady = !!s;
    if (s) {
      const initial = !prevArticleState || prevArticleState.startedAt !== s.startedAt;
      setActive();
      diffPendingHide(prevArticleState, s);
      renderArticle(s);
      if (initial) window.WikiMotion.article();
      prevArticleState = s;
      scheduleExpiryRerender();
    } else {
      prevArticleState = null;
      freshReveals.clear();
      pendingHideSentences.clear();
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
      renderArticle(null);
    }
    finishOnlineLoading();
  });
  socket.on('wikiword-reveal', e => {
    if (!e || !e.words) return;
    markFreshReveals(e.words);
    applyFreshRevealToDom();
    window.WikiMotion.revealWords(e.words);
    scheduleExpiryRerender();
  });
  socket.on('wikiword-round-end', state => {
    freshReveals.clear();
    pendingHideSentences.clear();
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    prevArticleState = state;
    renderArticle(state);
    document.querySelectorAll('#body .word.redacted').forEach(s => { s.classList.remove('redacted'); s.classList.add('revealed'); });
  });
  socket.on('wikiword-idle', () => {
    prevArticleState = null;
    freshReveals.clear();
    pendingHideSentences.clear();
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    renderArticle(null);
    setIdle();
  });

  // Prime from REST. In session mode, include ?session=<handle> so we
  // get the streamer's private round state — otherwise the server returns
  // the public game's state and we'd render that briefly before the socket
  // overrides, or worse, leave the public state visible if the socket
  // event order races with the fetch.
  const _primeUrl = _sessionHandle
    ? '/api/state?session=' + encodeURIComponent(_sessionHandle)
    : '/api/state';
  fetch(_primeUrl).then(r => r.json()).then(s => {
    if (s && s.targetWord) {
      setActive();
      renderCards(s.topGuesses || [], true);
      renderScoreboard(s.scoreboard || []);
      renderAnnounce(s.lastAnnounce || null);
      setGuessCount(s.guessCount || 0);
      roundStateReady = true;
      roundActive = true;
      finishOnlineLoading();
    }
  }).catch(() => {});

  // Monthly hint button (Donor / Super Fan perk)
  initHintButton();

  function initHintButton() {
    if (!window.WTHints) return;
    var hintWrap = document.getElementById('hint-btn-wrap');
    if (!hintWrap) return;
    var handle = null;
    try { handle = _sessionHandle || null; } catch (_) {}

    WTHints.init({
      container: hintWrap,
      game: 'wikisearchle',
      idempotent: true,
      storageKey: 'wt-hint-wikisearchle:' + (handle || 'public'),
      extraBody: function () { return { handle: handle || 'public', expectedStartTime: window._lastWikiState && window._lastWikiState.startTime }; },
      onSuccess: function (data) {
        if (!data || !data.hint) return;
        if (data.staleRound || !window._lastWikiState || window._lastWikiState.startTime !== data.startTime)
          showHintToast('Previous round hint: ' + data.hint.word, false);
        else showHint(data.hint);
      },
      onError: function (msg) {
        showHintToast(msg || 'Hint failed', true);
      }
    });
  }

  function showHint(hint) {
    if (!hint) return;
    var word = hint.word || '';
    var position = hint.position || '';
    var msg = word
      ? 'Hint revealed: word #' + position + ' is "' + word + '"'
      : 'Hint applied';
    showHintToast(msg, false);
  }

  function showHintToast(msg, isError) {
    var existing = document.querySelector('.ws-hint-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'ws-hint-toast';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:9999;max-width:90vw;padding:10px 18px;border-radius:999px;font-weight:800;font-size:0.9rem;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.25);background:' + (isError ? 'rgba(220,38,38,0.95)' : 'rgba(138,92,247,0.95)') + ';';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  window.addEventListener('resize', fitTitleSlot);
  window._wsSocket = socket;
})();
