// WikiSearchle Solo client — renders the solo target using the exact same
// DOM structure and class names as the multiplayer page, so the shared CSS
// produces a visually identical layout. Single-player: no sockets, progress
// persists per-browser in localStorage keyed by the article's setAt.
//
// Server endpoints used:
//   GET  /api/solo/status
//   GET  /api/solo/daily
//   GET  /api/solo/weekly
//   GET  /api/solo/random
//   POST /api/solo/guess { word, foundTitleNorms }

(() => {
  const API_BASE = '/api/solo';
  const TOP_N = 5;
  const STORAGE_KEY = 'wikisearchle-solo-progress-v1';
  const launchParams = new URLSearchParams(location.search);
  const requestedArchiveDate = launchParams.get('date');
  const TICKER_GAP = 3;
  const TICKER_FADE_INSET = 24;
  const USER_KEY = 'wt_user';
  const LEGACY_USER_KEY = 'wikisearchle_user';
  // Empty on production: /api/auth/ and /api/me/ are proxied to the relay on THIS
  // origin (snippets/wt-relay-auth.conf) so the token exchange plants a first-party
  // wt_remember. That cookie is what rides the Socket.IO handshake and lets the
  // premium gate in game-shared.js prove who the player is; a cookie planted on
  // wordtycoon.live never reaches this domain.
  const AUTH_API = document.body.dataset.viteUi ? '' : (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? 'http://' + location.hostname + ':3000'
    : '');

  const noWeeklyEl = document.getElementById('noWeekly');
  const gameAreaEl = document.getElementById('gameArea');
  const titleText  = document.getElementById('titleText');
  const titleBlock = titleText ? titleText.closest('.title-block') : null;
  const bodyEl     = document.getElementById('body');
  const cardsEl    = document.getElementById('cards');
  const cardsEmpty = document.getElementById('cardsEmpty');
  const tickerEl   = document.getElementById('ticker');
  const scoreEl    = document.getElementById('soloScore');
  const titleProgEl= document.getElementById('soloTitleProg');
  const guessCntEl = document.getElementById('soloGuessCount');
  const announceEl = document.getElementById('announce');
  const waAvatar   = document.getElementById('waAvatar');
  const waName     = document.getElementById('waName');
  const waTotal    = document.getElementById('waTotal');
  const waEarned   = document.getElementById('waEarned');
  const waWord     = document.getElementById('waWord');
  const waRarity   = document.getElementById('waRarity');
  const toastEl    = document.getElementById('soloToast');

  let weekly = null;
  let state = null;
  let toastTimer = null;
  let totalRankedWordsCache = 339509;
  let guessInFlight = false;
  let wikiUser = null;
  // Current solo mode: 'daily' | 'weekly' | 'random'. Weekly is retained as a
  // backend fallback; the visible player flow is Daily -> Random.
  let currentMode = null;
  let soloStatus = null; // last /api/solo/status snapshot

  // ── Auth: exchange auth_token → cached user (same pattern as Searchle) ──
  function getDisplayName(user) {
    if (!user || typeof user !== 'object') return '';
    return String(
      user.displayName ||
      user.global_name ||
      user.globalName ||
      user.username ||
      user.name ||
      ''
    ).trim();
  }
  // Word Tycoon sometimes stores profile pics as root-relative paths
  // (/portal/assets/profile-logos/foo.png). The browser resolves those
  // against this domain — which 404s, since they live on wordtycoon.live.
  function resolvePfp(url) {
    if (!url) return null;
    if (/^(?:https?:)?\/\//i.test(url)) return url;
    if (url.charAt(0) === '/') return 'https://wordtycoon.live' + url;
    return url;
  }
  function getProfilePicUrl(user) {
    if (!user || typeof user !== 'object') return null;
    if (user.profilePic) return resolvePfp(user.profilePic);
    if (user.avatarUrl) return resolvePfp(user.avatarUrl);
    if (user.picture) return resolvePfp(user.picture);
    if (user.avatar_url) return resolvePfp(user.avatar_url);
    if (typeof user.avatar === 'string' && /^(?:https?:\/\/|\/)/i.test(user.avatar)) return resolvePfp(user.avatar);
    if (typeof user.avatar === 'string' && user.id && /^[a-f0-9_]+$/i.test(user.avatar)) {
      return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    }
    return null;
  }
  function applyUser(user) {
    if (!user || typeof user !== 'object') return null;
    const sameUser = wikiUser && String(wikiUser.id) === String(user.id) && wikiUser.provider === user.provider;
    wikiUser = { ...user, cosmetics: user.cosmetics || (sameUser && wikiUser.cosmetics) || null };
    const currentUser = wikiUser;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      localStorage.removeItem(LEGACY_USER_KEY);
    } catch (e) {}
    window._wtUser = currentUser;
    window._wtUserPicUrl = getProfilePicUrl(currentUser);
    refreshUserUi();
    // Refresh equipment from the authenticated session. Keep cached cosmetics
    // visible while it loads, and ignore responses for a replaced identity.
    fetch(AUTH_API + '/api/me/equipped-cosmetics', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (wikiUser === currentUser && data && Object.prototype.hasOwnProperty.call(data, 'equipped')) {
          currentUser.cosmetics = data.equipped || {};
          try { localStorage.setItem(USER_KEY, JSON.stringify(currentUser)); } catch (e) {}
          refreshUserUi();
        }
      })
      .catch(() => {});
    return wikiUser;
  }
  function refreshUserUi() {
    document.body.classList.toggle('solo-authenticated', !!(wikiUser && wikiUser.id));
    syncGuessBarProfile();
    if (state) {
      _cardDomCache.forEach((el) => { WikiGuessCards.dispose(el); el.remove(); });
      _cardDomCache.clear();
      renderCards();
    }
    if (!announceEl.classList.contains('hidden') && !announceEl.classList.contains('beta-invite')) {
      const name = getDisplayName(wikiUser) || 'You';
      waAvatar.innerHTML = avatarMarkup(wikiUser, name);
      waAvatar.title = name;
      waName.textContent = name;
      applyAnnounceCosmetics();
    }
  }
  function syncGuessBarProfile() {
    const avatar = document.getElementById('wwgb-avatar');
    const nick = document.getElementById('wwgb-nick');
    if (!avatar || !nick || !wikiUser || !wikiUser.id) return;
    let shell = document.getElementById('soloGuessProfile');
    if (!shell) {
      shell = document.createElement('span');
      shell.id = 'soloGuessProfile';
      shell.className = 'solo-guess-profile';
      avatar.before(shell);
      shell.appendChild(avatar);
      const initial = document.createElement('span');
      initial.className = 'solo-guess-initial';
      shell.appendChild(initial);
    }
    const name = getDisplayName(wikiUser) || 'Player';
    const initial = shell.querySelector('.solo-guess-initial');
    initial.textContent = Array.from(name)[0].toUpperCase();
    shell.title = name;
    shell.setAttribute('aria-label', name);
    const pic = getProfilePicUrl(wikiUser);
    shell.classList.toggle('has-photo', !!pic);
    avatar.alt = name;
    avatar.title = name;
    avatar.onerror = () => {
      shell.classList.remove('has-photo');
      if (window.WikiCosmetics) WikiCosmetics.apply({ avatarEl: initial }, wikiUser && wikiUser.cosmetics);
    };
    if (pic && avatar.getAttribute('src') !== pic) avatar.src = pic;
    nick.value = name.slice(0, 16);
    nick.style.display = 'none';
    if (window.WikiCosmetics) WikiCosmetics.apply({ avatarEl: pic ? avatar : initial }, wikiUser.cosmetics);
  }
  function loadCachedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
      if (raw) applyUser(JSON.parse(raw));
    } catch (e) {}
  }
  async function maybeExchangeAuthToken() {
    try {
      const params = new URLSearchParams(location.search);
      const authToken = params.get('auth_token') || params.get('auth');
      if (!authToken) return false;
      params.delete('auth'); params.delete('auth_token'); params.delete('sso_checked');
      const remaining = params.toString();
      history.replaceState({}, '', location.pathname + (remaining ? '?' + remaining : ''));
      const r = await fetch(AUTH_API + '/api/auth/exchange?token=' + encodeURIComponent(authToken), { credentials: 'include' });
      const data = await r.json();
      if (data && data.ok && data.user) {
        applyUser(data.user);
        return true;
      }
    } catch (e) {}
    return false;
  }
  async function restoreFromSession() {
    try {
      const r = await fetch(AUTH_API + '/api/me/session', { credentials: 'include' });
      const data = r.ok ? await r.json() : null;
      if (data && data.ok && data.user) {
        return applyUser(data.user);
      }
    } catch (e) {}
    return wikiUser;
  }

  function currentWeekStartISO() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  async function postSoloComplete() {
    const claimState = state, claimArticle = weekly, claimUser = wikiUser;
    // Random articles never reward — skip the round-trip entirely. Both
    // daily and weekly award coins.
    const isReward = !!(claimArticle && (claimArticle.isDaily || claimArticle.isWeekly));
    if (!isReward) return;
    if (!claimUser || !claimUser.id) return;
    if (claimState.rewardClaimed) return;
    try {
    let provenTitles = [];
    try { provenTitles = JSON.parse(atob(claimState.progressProof.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).titles || []; } catch {}
    if (!claimState.progressProof || provenTitles.length < claimArticle.titleWordCount) {
      showToast('Checking saved progress…');
      const words = [...new Set([...(claimState.rewardGuesses || []), ...Object.values(claimState.revealedTexts || {}), ...(claimState.foundTitleNorms || [])])];
      let proof = claimState.progressProof || null;
      for (const word of words) {
        let r = await fetch(`${API_BASE}/guess`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, progressProof: proof, articleHandle: claimArticle.articleHandle })
        });
        if (r.status === 409) {
          proof = null;
          r = await fetch(`${API_BASE}/guess`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, articleHandle: claimArticle.articleHandle })
          });
        }
        if (!r.ok) throw new Error('Could not validate saved progress');
        const d = await r.json();
        if (d.progressProof) proof = d.progressProof;
        claimState.progressProof = proof; if (state === claimState) saveState();
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      claimState.progressProof = proof;
      if (state === claimState) saveState();
    }
      const r = await fetch(`${API_BASE}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: claimUser.provider || 'discord',
          userId: claimUser.id,
          username: claimUser.username || claimUser.displayName || 'player',
          displayName: claimUser.globalName || claimUser.displayName || claimUser.username || 'player',
          progressProof: claimState.progressProof,
          score: claimState.score,
          guessCount: claimState.guessCount,
          articleHandle: (claimArticle && claimArticle.articleHandle) || undefined,
        }),
      });
      const d = await r.json();
      if (d && d.ok) {
        claimState.rewardClaimed = true;
        claimState.rewardPending = !!d.rewardPending;
        claimState.rewardNeedsReview = !!d.rewardNeedsReview;
        if (state === claimState) saveState();
        if (state === claimState && d.rewardPending) showToast('Reward saved. Coins will update when delivery recovers.');
        if (state === claimState && d.rewardNeedsReview) showToast('Your saved reward needs checking.');
        // Refresh status so the mode-bar checkmark + Next-Article
        // progression both reflect the just-completed mode.
        fetchSoloStatus().then(() => renderModeBar()).catch(() => {});
      }
    } catch (e) {}
    if (claimArticle && claimArticle.isWeekly) {
      try { localStorage.setItem('wikisearchle_sp_weekly', currentWeekStartISO()); } catch (e) {}
    }
  }

  // ── Persistence ─────────────────────────────────────
  function emptyState(setAt) {
    return {
      setAt,
      revealedIds: [],
      // id -> text for tokens this player has earned. Persisted because the
      // article payload no longer carries unrevealed text (see textFor).
      revealedTexts: {},
      foundTitleNorms: [],
      score: 0,
      guessCount: 0,
      top: [],
      seenGuesses: [],
      progressProof: null,
      rewardGuesses: [],
      won: false,
    };
  }
  function loadState(setAt) {
    try {
      const raw = localStorage.getItem(progressStorageKey());
      if (!raw) return emptyState(setAt);
      const s = JSON.parse(raw);
      if (s && s.setAt === setAt) return s;
    } catch (e) {}
    return emptyState(setAt);
  }
  function saveState() {
    try { localStorage.setItem(progressStorageKey(), JSON.stringify(state)); } catch (e) {}
  }
  function progressStorageKey() {
    if (currentMode !== 'archive') return STORAGE_KEY;
    const owner = wikiUser && wikiUser.id ? String(wikiUser.id) : 'guest';
    return STORAGE_KEY + ':archive:' + weekly.dateKey + ':' + owner;
  }
  function revealedSet() { return new Set(state.revealedIds); }

  // ── Helpers ─────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtNum(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString() : '?'; }
  function compactRank(n) {
    const v = Number(n);
    if (!isFinite(v)) return '?';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  }
  // Anonymous / no-avatar fallback — show the Word Tycoon PFP at full size,
  // not the colored initial letter. Same image is used everywhere a real
  // user pic isn't available so anon presence reads as "Word Tycoon".
  const ANON_PFP_URL = '/img/wt-pfp.png';
  function avatarMarkup(user, fallbackName) {
    const displayName = getDisplayName(user) || String(fallbackName || 'You').trim() || 'You';
    const initial = (displayName[0] || '?').toUpperCase();
    const picUrl = getProfilePicUrl(user);
    if (!picUrl) {
      if (user && user.id) return esc(initial);
      return `<img src="${esc(ANON_PFP_URL)}" alt="Word Tycoon" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;" onerror='this.remove();this.parentNode.textContent=${JSON.stringify(initial)};'>`;
    }
    return `<img src="${esc(picUrl)}" alt="${esc(displayName)}" data-initial="${esc(initial)}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.replaceWith(document.createTextNode(this.dataset.initial));">`;
  }

  // ── Title auto-fit (matches MP's fitTitleSlot) ──────
  function fitTitleSlot() {
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

  // ── Article rendering (MP-compatible) ───────────────
  // The server sends text ONLY for tokens it seeded as revealed; everything
  // else is earned via /guess -> revealTexts and kept in state.revealedTexts
  // so a reload can still paint what this player already uncovered.
  function textFor(t) {
    if (t.text) return t.text;
    const store = (state && state.revealedTexts) || null;
    return (store && store[t.id]) || '';
  }
  function renderArticle() {
    if (!weekly) return;
    const revealed = revealedSet();

    titleText.innerHTML = '';
    for (const t of weekly.titleTokens) {
      if (t.type !== 'word') continue;
      const wrap = document.createElement('span');
      const wText = document.createElement('span');
      wText.className = 'w-text';
      const isRevealed = t.revealed || revealed.has(t.id);
      if (isRevealed) {
        wrap.className = 't-word revealed';
        wText.textContent = textFor(t);
      } else {
        wrap.className = 't-word hidden current-hint';
        const raw = String(t.hintText || t.hintLetter || '').trim();
        const chars = Array.from(raw).slice(0, Math.max(1, Number(t.len) || raw.length || 1)).join('').toUpperCase();
        const len = Math.max(chars.length + 1, Number(t.len) || chars.length + 1);
        wText.textContent = chars + '_'.repeat(Math.max(0, len - chars.length));
      }
      wrap.appendChild(wText);
      titleText.appendChild(wrap);
    }
    fitTitleSlot();

    bodyEl.innerHTML = '';
    for (const para of weekly.paragraphs) {
      const p = document.createElement('p');
      for (const t of para) {
        if (t.type === 'space') { p.appendChild(document.createTextNode(t.text)); continue; }
        const s = document.createElement('span');
        s.className = 'word';
        s.dataset.len = t.len;
        s.dataset.id = t.id;
        const shown = t.revealed || revealed.has(t.id);
        if (shown) {
          s.classList.add('revealed');
          s.textContent = textFor(t);
          s.dataset.norm = (s.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        } else {
          s.classList.add('redacted');
          if (t.isNumber) {
            s.classList.add('is-number');
            const digits = (typeof t.digitCount === 'number' && t.digitCount > 0) ? t.digitCount : t.len;
            s.textContent = digits + ' DIGIT' + (digits === 1 ? '' : 'S');
          } else {
            s.textContent = '\u00a0'.repeat(Math.max(1, t.len));
          }
        }
        p.appendChild(s);
      }
      bodyEl.appendChild(p);
    }
  }

  function weeklyTokenText(id) {
    const store = (state && state.revealedTexts) || null;
    if (store && store[id]) return store[id];
    for (const t of weekly.titleTokens) if (t.type === 'word' && t.id === id && t.text) return t.text;
    for (const para of weekly.paragraphs) for (const t of para) if (t.type === 'word' && t.id === id && t.text) return t.text;
    return null;
  }

  function applyFreshReveal(ids) {
    for (const id of ids) {
      const el = bodyEl.querySelector(`.word[data-id="${id}"]`);
      if (!el || !el.classList.contains('revealed')) continue;
      el.classList.remove('fresh-reveal');
      void el.offsetWidth;
      el.classList.add('fresh-reveal');
    }
  }

  function flipReveals(ids, texts) {
    if (!ids || !ids.length) return;
    if (texts) {
      if (!state.revealedTexts) state.revealedTexts = {};
      for (const id of Object.keys(texts)) state.revealedTexts[id] = texts[id];
    }
    const revealed = revealedSet();
    for (const id of ids) revealed.add(id);
    state.revealedIds = Array.from(revealed);
    // Partial DOM update: flip each new id's body span in place.
    for (const id of ids) {
      const el = bodyEl.querySelector(`.word[data-id="${id}"]`);
      if (!el) continue;
      if (el.classList.contains('redacted')) {
        const text = weeklyTokenText(id) || '';
        el.classList.remove('redacted', 'is-number');
        el.classList.add('revealed');
        el.textContent = text;
        el.dataset.norm = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    }
    // If a title norm was completed, re-render title so it flips hidden→revealed.
    if (titleHasHidden()) {
      // Some title tokens may have flipped — rerender title only.
      rerenderTitle();
    }
    applyFreshReveal(ids);
  }

  function titleHasHidden() {
    return weekly.titleTokens.some((t) => t.type === 'word' && !t.revealed);
  }

  function rerenderTitle() {
    const revealed = revealedSet();
    titleText.innerHTML = '';
    for (const t of weekly.titleTokens) {
      if (t.type !== 'word') continue;
      const wrap = document.createElement('span');
      const wText = document.createElement('span');
      wText.className = 'w-text';
      const isRevealed = t.revealed || revealed.has(t.id);
      if (isRevealed) {
        wrap.className = 't-word revealed just-revealed';
        wText.textContent = t.text != null ? t.text : (weeklyTokenText(t.id) || '');
      } else {
        wrap.className = 't-word hidden current-hint';
        const raw = String(t.hintText || t.hintLetter || '').trim();
        const chars = Array.from(raw).slice(0, Math.max(1, Number(t.len) || raw.length || 1)).join('').toUpperCase();
        const len = Math.max(chars.length + 1, Number(t.len) || chars.length + 1);
        wText.textContent = chars + '_'.repeat(Math.max(0, len - chars.length));
      }
      wrap.appendChild(wText);
      titleText.appendChild(wrap);
    }
    fitTitleSlot();
  }

  // ── Stats ───────────────────────────────────────────
  function renderStats() {
    scoreEl.textContent = fmtNum(state.score);
    guessCntEl.textContent = state.guessCount;
    titleProgEl.textContent = `${state.foundTitleNorms.length} / ${weekly.titleWordCount}`;
    fitStats();
  }

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

  window.addEventListener('resize', () => { try { fitStats(); } catch (e) {} });

  // ── Cards (proximity meter, MP style) ───────────────
  const MIN_FILL_PCT = 5;
  function rankMeter(rank) {
    const r = Math.max(1, Number(rank) || 0);
    const max = Math.max(r, totalRankedWordsCache || r);
    const progress = Math.min(1, Math.log(r) / Math.log(max));
    const hue = 120 - progress * 120;
    const fillPct = Math.max(MIN_FILL_PCT, (1 - progress) * 100);
    return { fillPct, fillColor: `hsl(${hue}, 72%, 50%)`, hue };
  }

  const _guessCards = WikiGuessCards.create(cardsEl);
  const _cardDomCache = new Map();
  const _placeholderCache = [];
  function renderCards() {
    if (window.WikiMotion) return window.WikiMotion.rankUpdate(renderCardsNow);
    return renderCardsNow();
  }
  function renderCardsNow() {
    const newTop = state.top.slice();
    if (cardsEmpty.parentNode === cardsEl) cardsEl.removeChild(cardsEmpty);

    const keepWords = new Set(newTop.map((g) => g.word));
    for (const [word, el] of [..._cardDomCache.entries()]) {
      if (!keepWords.has(word)) {
        WikiGuessCards.dispose(el);
        if (el.parentNode) el.remove();
        _cardDomCache.delete(word);
      }
    }
    for (const ph of _placeholderCache) {
      if (ph && ph.parentNode) ph.remove();
    }

    newTop.forEach((g, i) => {
      const isTopSlot = i === 0;
      const isExactRank = Number(g.rank) === 1;
      const wordLen = String(g.word || '').length;
      let sizeCls = '';
      if (wordLen > 13) sizeCls = ' xl-word';
      else if (wordLen >= 11) sizeCls = ' lg-word';
      else if (wordLen >= 8) sizeCls = ' md-word';
      const cardClass = 'card' + (isTopSlot ? ' top' : '') + (isExactRank ? ' exact' : '') + sizeCls;
      const { fillPct, fillColor, hue } = rankMeter(g.rank);
      const viewerName = getDisplayName(wikiUser) || 'You';
      let c = _cardDomCache.get(g.word);
      if (!c) {
        c = document.createElement('div');
        c.dataset.word = g.word;
        c.className = cardClass;
        const inner = (
          `<div class="rank-word">` +
          `<div class="rank">#${compactRank(g.rank)}</div>` +
          `<div class="word-lbl">${esc(g.word || '')}</div>` +
          `</div>` +
          `<div class="who">` +
          `<div class="avatar-fb" style="overflow:hidden">${avatarMarkup(wikiUser, viewerName)}</div>` +
          `<div class="who-text">` +
          `<div class="gname">${esc(viewerName)}</div>` +
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
        c.className = cardClass;
        c.style.animation = 'none';
      }
        c.style.setProperty('--fill-pct', fillPct.toFixed(2) + '%');
        c.style.setProperty('--fill-color', fillColor);
        c.style.setProperty('--rank-hue', hue);
        c.style.setProperty('--word-len', String(wordLen));
      cardsEl.appendChild(c);
      c._guessUser = wikiUser;
      WikiGuessCards.prepare(c, wikiUser && wikiUser.cosmetics);
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
        }, wikiUser && wikiUser.cosmetics);
      }
      WikiGuessCards.fit(c);
    });
    _guessCards.sync();

    // Fill remaining slots with placeholder cards so the column always shows 5.
    const filled = newTop.length;
    for (let i = filled; i < TOP_N; i++) {
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

  // Shrink an element's font-size 1px at a time until its text fits within
  // its own clientWidth (or hits minPx). Keeps the announce card's word +
  // name fully visible without ellipsis when they're long.
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
  // ── Announce banner ─────────────────────────────────
  function renderAnnounce(word, earned, total, tier, opts) {
    if (opts && opts.miss && announceEl.classList.contains('beta-invite')) return;
    announceEl.classList.remove('hidden', 'beta-invite');
    const viewerName = getDisplayName(wikiUser) || 'You';
    waAvatar.innerHTML = avatarMarkup(wikiUser, viewerName);
    waAvatar.title = viewerName;
    waName.textContent = viewerName;
    waWord.textContent = (word || '').toUpperCase();
    if (opts && opts.miss) {
      waTotal.textContent = '';
      waEarned.textContent = '';
      waRarity.className = 'wa-rarity miss';
      waRarity.textContent = 'NOT IN ARTICLE';
      applyAnnounceCosmetics();
      requestAnimationFrame(() => { fitText(waWord, 10); fitRow(waName.closest('.wa-top'), 10); });
      return;
    }
    waTotal.textContent = `${fmtNum(total)} pts`;
    waEarned.textContent = `+${fmtNum(earned)}`;
    const t = (tier || 'common').toLowerCase();
    waRarity.className = `wa-rarity ${t}`;
    waRarity.textContent = t.toUpperCase();
    applyAnnounceCosmetics();
    requestAnimationFrame(() => { fitText(waWord, 10); fitRow(waName.closest('.wa-top'), 10); });
  }
  // Find the first newly-revealed body word for scroll/FX targeting.
  function firstRevealedBodyWord(ids) {
    for (const id of ids) {
      const el = bodyEl.querySelector(`.word[data-id="${id}"]`);
      if (el && el.classList.contains('revealed')) return el;
    }
    return null;
  }

  // Effective page zoom for the scrolling container. The <html> element is
  // zoomed to 0.75 on desktop pointer devices below 1000px, while scrollTop
  // lives in CSS (pre-zoom) pixels — visual measurements must be divided by
  // this factor before being added to scrollTop.
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

  function waitForScroll(el, onDone) {
    let last = -1, ticks = 0;
    const iv = setInterval(() => {
      const cur = el.scrollTop;
      ticks++;
      if ((cur === last && ticks > 1) || ticks > 16) {
        clearInterval(iv);
        if (onDone) onDone();
      }
      last = cur;
    }, 90);
  }

  // Scroll the article so the first found word is centred in view. This runs
  // on every hit so the player always sees what they just uncovered.
  function scrollToFoundWord(ids, onDone) {
    const el = firstRevealedBodyWord(ids);
    if (!el) { if (onDone) onDone(); return; }
    const zoom = getHtmlZoom();
    const box = bodyEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const offsetVisual = (r.top + r.height / 2) - (box.top + box.height / 2);
    const offsetCss = offsetVisual / zoom;
    const reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (Math.abs(offsetCss) > 20) {
      const target = Math.max(0, bodyEl.scrollTop + offsetCss);
      bodyEl.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
      waitForScroll(bodyEl, onDone);
      return;
    }
    if (onDone) onDone();
  }

  // Per-letter XP numbers that pop off the revealed word in the article and
  // arc into the announce card — same effect as the multiplayer surface.
  // `total` scales the split to the points the server actually paid, so the
  // numbers always sum to the real award. Purely decorative: any failure to
  // find an on-screen source span just skips the effect.
  function spawnXpFlyout(ids, earned) {
    if (!window.XpFlyout || !earned || earned <= 0 || !ids || !ids.length) return;
    try {
      const src = firstRevealedBodyWord(ids);
      if (!src) return;
      flyFrom(src, earned);
    } catch (e) { /* decoration only */ }
  }

  function flyFrom(src, earned) {
    try {
      const node = src.firstChild;
      if (!node || node.nodeType !== 3 || !node.data) return;
      // Per-letter rects without touching the DOM — wrapping the letters in
      // spans would disturb the reveal animation and redaction sizing.
      const cellEls = [];
      for (let i = 0; i < node.data.length; i++) {
        const rg = document.createRange();
        rg.setStart(node, i);
        rg.setEnd(node, i + 1);
        const r = rg.getBoundingClientRect();
        cellEls.push((r.width || r.height) ? { getBoundingClientRect: () => r } : null);
      }
      XpFlyout.spawn({
        word: node.data,
        cellEls,
        gridEl: bodyEl,
        total: earned,
        cosmetics: (wikiUser && wikiUser.cosmetics) || null,
        targetSelectors: ['#waEarned', '#waTotal', '.word-announce'],
        onArrive() { XpFlyout.pulse(announceEl, null); },
      });
    } catch (e) { /* decoration only */ }
  }

  function applyAnnounceCosmetics() {
    if (!window.WikiCosmetics) return;
    window.WikiCosmetics.apply({
      surfaceEl: announceEl,
      avatarEl: waAvatar,
      nameEl: waName,
      titleContainer: document.getElementById('waPlayer'),
    }, wikiUser && wikiUser.cosmetics);
  }

  // ── Ticker chips (MP style) ─────────────────────────
  function pushChip(word, status) {
    const el = document.createElement('div');
    el.className = `chip ${status}`;
    const icon = status === 'miss' ? '\u2715' : '\u2713';
    el.innerHTML = `<span>${esc(word)}</span><span class="tick">${icon}</span>`;
    tickerEl.appendChild(el);
    requestAnimationFrame(() => {
      const chipRightAtEnd = el.offsetLeft + el.offsetWidth;
      const chipRightAtStart = tickerEl.clientWidth - TICKER_FADE_INSET;
      const slideDist = Math.max(0, chipRightAtStart - chipRightAtEnd);
      el.style.setProperty('--slide-dist', `${slideDist}px`);
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';

      let total = 0;
      for (const c of tickerEl.children) {
        if (c.classList.contains('exit')) continue;
        total += c.offsetWidth + TICKER_GAP;
      }
      total -= TICKER_GAP;
      if (total > tickerEl.clientWidth) {
        for (const c of tickerEl.children) {
          if (c === el) break;
          if (c.classList.contains('exit')) continue;
          c.classList.add('exit');
          c.addEventListener('animationend', () => { if (c.parentNode) c.remove(); }, { once: true });
          break;
        }
      }
    });
  }

  // ── Toast ───────────────────────────────────────────
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  function setGuessBarEnabled(enabled) {
    if (window.WikiWordGuessBar && typeof window.WikiWordGuessBar.setEnabled === 'function') {
      window.WikiWordGuessBar.setEnabled(enabled);
    }
  }

  // ── Daily share ─────────────────────────────────────
  // Only the daily and weekly puzzles are shareable — a random article is
  // nobody else's puzzle, so there is nothing to compare a result against.
  function shareResult(text) {
    if (!text) return;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('Copied!'),
        () => { try { window.prompt('Copy your result:', text); } catch (e) {} }
      );
    } else {
      try { window.prompt('Copy your result:', text); } catch (e) {}
    }
  }

  function buildShareText() {
    const onWikisearchle = /(^|\.)wikisearchle\.com$/i.test(location.hostname);
    const brand = onWikisearchle ? 'WikiSearchle' : 'WikiContexto';
    const origin = onWikisearchle ? 'https://wikisearchle.com' : 'https://wikicontexto.com';
    const link = origin + (currentMode === 'archive' ? '/solo?date=' + weekly.dateKey : '/daily');
    const label = currentMode === 'daily' ? 'Daily' : currentMode === 'weekly' ? 'Weekly' : currentMode === 'archive' ? 'Daily ' + weekly.dateKey : '';
    if (!label) return '';
    return '\uD83D\uDCDA ' + brand + ' ' + label + ' \u2014 ' + fmtNum(state.score) + ' pts \u00b7 ' +
      state.guessCount + ' guess' + (state.guessCount === 1 ? '' : 'es') + '\n' + link;
  }

  // ── Win card  ───────────────────────────────────────
  // The bespoke .round-end-overlay markup was removed from this page when it
  // was rebranded, so every solo win renders through the shared WinCard that
  // the rest of Word Tycoon uses.
  function showWinCard() {
    if (!window.WinCard) return;
    const u = wikiUser || null;
    const onWikisearchle = /(^|\.)wikisearchle\.com$/i.test(location.hostname);
    const text = buildShareText();
    const actions = [];
    if (text) actions.push({ label: 'Share', onClick: () => shareResult(text) });
    actions.push(currentMode === 'archive'
      ? { label: 'Previous daily games', primary: true, onClick: () => { location.href = '/previous-dailies'; } }
      : { label: 'Next Article', primary: true, onClick: () => loadNextArticle() });
    WinCard.showSolo({
      game: 'wikisearchle',
      gameName: onWikisearchle ? 'WikiSearchle' : 'WikiContexto',
      word: titleText.textContent.trim(),
      guessCount: state.guessCount,
      jackpot: state.score,
      winner: {
        displayName: getDisplayName(u) || 'You',
        username: (u && u.username) || null,
        platform: (u && u.provider) || 'web',
        platformUserId: u && u.id ? String(u.id) : null,
        profilePic: getProfilePicUrl(u),
        cosmetics: (u && u.cosmetics) || null,
        linkedDiscord: (u && u.linkedDiscord) || null,
      },
      // The old modal stayed up until "Next Article" was clicked - keep it
      // sticky rather than inheriting WinCard's auto-dismiss.
      autoHideMs: 0,
      actions,
    });
  }

  function maybeShowWin() {
    if (!weekly || state.foundTitleNorms.length < weekly.titleWordCount) return;
    if (state.won) {
      // Re-open silently so replay shows the completed title.
      showWinCard();
      return;
    }
    state.won = true;
    saveState();
    showWinCard();
    postSoloComplete();
  }

  // ── Premium wall ────────────────────────────────────
  // Unlimited (random-article) solo is Donor-only; the wall is
  // NON-dismissible here — the free out is the daily/weekly puzzle.
  function showPremiumWall(loggedIn) {
    const existing = document.getElementById('premium-wall');
    if (existing) { existing.style.display = 'flex'; return; }
    const el = document.createElement('div');
    el.id = 'premium-wall';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(8,4,14,0.92);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
    const signinBtn = loggedIn ? '' :
      '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(160,140,190,0.35);color:#eee8f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
    el.innerHTML =
      '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(20,14,30,0.98),rgba(30,22,46,0.98));border:1px solid rgba(160,140,190,0.2);border-radius:18px;color:#eee8f4;">' +
        '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(138,92,247,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
        '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Unlimited play is Donor-only</h2>' +
        '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(196,180,216,0.78);">The daily and weekly puzzles are free for everyone, forever. Unlimited random articles need <strong style="color:#eee8f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<a href="/solo" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(138,92,247,0.12);border:1.5px solid rgba(138,92,247,0.45);color:#b79aff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
          '<a href="https://wordtycoon.live/me?tab=pass" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(196,102,255,0.1);border:1.5px solid rgba(196,102,255,0.4);color:#c98aff;font-weight:900;text-decoration:none;">Become a Donor &mdash; $2/mo</a>' +
          signinBtn +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    const sb = document.getElementById('premium-wall-signin');
    if (sb) sb.onclick = () => {
      window.location.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent(location.href);
    };
  }

  // ── Guess handling ──────────────────────────────────
  async function submitGuess(rawWord) {
    if (window.WikiContextoLoading && window.WikiContextoLoading.isPending()) return;
    if (window.WikiContextoHelp && window.WikiContextoHelp.isOpen()) return;
    const word = String(rawWord || '').trim();
    if (!word) return;
    const quickNorm = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!quickNorm) return;
    if (guessInFlight) return;

    guessInFlight = true;
    setGuessBarEnabled(false);

    state.guessCount++;
    renderStats();

    let resp;
    try {
      // Pass identity so the server can credit library words in real time for
      // logged-in players. Anonymous players omit these fields.
      const identity = wikiUser && wikiUser.id ? {
        platform: wikiUser.provider || 'discord',
        platformUserId: String(wikiUser.id),
        username: wikiUser.username || wikiUser.displayName || null,
        displayName: wikiUser.globalName || wikiUser.displayName || wikiUser.username || null,
      } : null;
      const r = await fetch(`${API_BASE}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          progressProof: state.progressProof,
          foundTitleNorms: state.foundTitleNorms,
          identity,
          articleHandle: (weekly && weekly.articleHandle) || undefined,
        }),
      });
      resp = await r.json();
      // Premium gate: unlimited (random-article) solo requires Donor Class.
      // The daily/weekly puzzles never return 402.
      if (r.status === 402 && resp && resp.premiumRequired) {
        showPremiumWall(!!resp.loggedIn);
        return;
      }
      if (!r.ok) throw new Error(resp.error || 'guess failed');
    } catch (e) {
      showToast('Network error');
      return;
    } finally {
      guessInFlight = false;
      setGuessBarEnabled(true);
    }

    if (resp.progressProof) state.progressProof = resp.progressProof;
    const { rank, revealIds, points, tier, isTitleWord, isNumber, canonical, titleNorm } = resp;
    const canon = canonical || quickNorm;

    // Classify result
    let status;
    const newIds = (revealIds || []).filter((id) => !state.revealedIds.includes(id));
    if (newIds.length > 0) status = 'hit';
    else if (revealIds && revealIds.length > 0) status = 'dup';
    else status = 'miss';

    // Ticker chip (dedup miss spam)
    const isSeenMiss = status === 'miss' && state.seenGuesses.includes(quickNorm);
    if (!isSeenMiss) pushChip(word, status);
    if (status === 'miss' && !state.seenGuesses.includes(quickNorm)) {
      state.seenGuesses.push(quickNorm);
    }

    if (status === 'hit') {
      if (!Array.isArray(state.rewardGuesses)) state.rewardGuesses = [];
      state.rewardGuesses.push(word);
      state.score += (points || 0);
      flipReveals(newIds, resp.revealTexts);
      const titleKey = titleNorm || resp.norm;
      if (isTitleWord && titleKey && !state.foundTitleNorms.includes(titleKey)) {
        state.foundTitleNorms.push(titleKey);
        // rankTarget advances to the next unrevealed title word — the old
        // cards were ranked against the previous target and are now stale.
        // Clear them so the searchle side tracks the new target cleanly.
        state.top = [];
        state.seenGuesses = [];
        renderCards();
      }
      renderAnnounce(word, points, state.score, tier || (isNumber ? 'uncommon' : 'common'));
      if (window.WikiMotion) window.WikiMotion.reveal(newIds, { title: isTitleWord });
      scrollToFoundWord(newIds, () => spawnXpFlyout(newIds, points));
    } else if (status === 'miss') {
      renderAnnounce(word, 0, state.score, null, { miss: true });
    }

    // Top-N cards by best rank — include misses so the search-le ranking
    // aspect is visible even for guesses not in the article. Dedupe by
    // canonical (singular/American) form so "cat" and "cats" don't both
    // appear — first guess of the canonical form stays on the board.
    if (typeof rank === 'number' && rank > 0) {
      const existing = state.top.find((g) => (g.canonical || g.word.toLowerCase()) === canon);
      if (!existing) {
        _guessCards.queue(word);
        state.top.push({ word, rank, canonical: canon });
        state.top.sort((a, b) => a.rank - b.rank);
        state.top = state.top.slice(0, TOP_N);
        renderCards();
      }
    }

    renderStats();
    saveState();
    maybeShowWin();
  }

  // Apply a freshly-fetched article (daily / weekly / random) to the page.
  // Used both for initial boot and for mode transitions ("Next Article" or a
  // mode-bar tap).
  function applyArticle(data, mode) {
    if (!data || !data.available) return false;
    weekly = data;
    currentMode = mode || (data.isDaily ? 'daily' : data.isWeekly ? 'weekly' : 'random');
    if (typeof weekly.totalRankedWords === 'number' && weekly.totalRankedWords > 0) {
      totalRankedWordsCache = weekly.totalRankedWords;
    }
    _guessCards.reset();
    state = loadState(weekly.setAt);
    _guessCards.snapshot(state.top);
    gameAreaEl.hidden = false;
    renderArticle();
    if (window.WikiMotion) window.WikiMotion.article();
    renderStats();
    renderCards();
    renderModeBar();
    const hasFoundWord = (state.revealedIds || []).length > 0 || (state.foundTitleNorms || []).length > 0 || state.score > 0;
    announceEl.classList.toggle('beta-invite', !hasFoundWord);
    announceEl.classList.toggle('hidden', hasFoundWord);
    if (window.WikiCosmetics) WikiCosmetics.apply({ surfaceEl: announceEl }, null);
    if (state.won) {
      maybeShowWin();
      if (!state.rewardClaimed && wikiUser && wikiUser.id) postSoloComplete();
    }
    return true;
  }

  // ── Mode bar: Daily / Random with completion state ───
  const modeBarEl = document.getElementById('modeBar');
  function renderModeBar() {
    if (!modeBarEl) return;
    const replayNote = document.getElementById('archiveReplayNote');
    if (replayNote) {
      replayNote.hidden = currentMode !== 'archive';
      if (currentMode === 'archive') replayNote.textContent = 'Daily ' + weekly.dateKey + ' · Practice replay';
    }
    if (currentMode === 'archive') { modeBarEl.hidden = true; return; }
    modeBarEl.hidden = false;
    const segs = modeBarEl.querySelectorAll('.mode-seg');
    segs.forEach((seg) => {
      const m = seg.getAttribute('data-mode');
      seg.classList.toggle('active', m === currentMode);
      let completed = false;
      if (soloStatus) {
        if (m === 'daily' && soloStatus.daily && soloStatus.daily.completed) completed = true;
        if (m === 'weekly' && soloStatus.weekly && soloStatus.weekly.completed) completed = true;
      }
      seg.classList.toggle('completed', completed);
      // Disable when the mode isn't available server-side.
      let available = true;
      if (soloStatus) {
        if (m === 'daily') available = !!(soloStatus.daily && soloStatus.daily.available);
        if (m === 'weekly') available = !!(soloStatus.weekly && soloStatus.weekly.available);
        if (m === 'random') available = !!(soloStatus.random && soloStatus.random.available);
      }
      seg.disabled = !available;
      seg.style.opacity = available ? '' : '0.4';
    });
  }
  if (modeBarEl) {
    modeBarEl.addEventListener('click', (ev) => {
      const seg = ev.target.closest('.mode-seg');
      if (!seg || seg.disabled) return;
      const m = seg.getAttribute('data-mode');
      if (!m || m === currentMode) return;
      switchToMode(m);
    });
  }

  async function fetchSoloStatus() {
    try {
      let url = `${API_BASE}/status`;
      if (wikiUser && wikiUser.id) {
        const platform = encodeURIComponent(wikiUser.provider || 'discord');
        const userId = encodeURIComponent(wikiUser.id);
        url += `?platform=${platform}&userId=${userId}`;
      }
      const r = await fetch(url);
      soloStatus = r.ok ? await r.json() : null;
      const rewardStatus = soloStatus && soloStatus[currentMode];
      if (state?.won && rewardStatus && rewardStatus.completed && rewardStatus.setAt === state.setAt) {
        state.rewardClaimed = true;
        state.rewardPending = !!rewardStatus.rewardPending;
        state.rewardNeedsReview = !!rewardStatus.rewardNeedsReview;
        saveState();
      }
    } catch (e) { soloStatus = null; }
    return soloStatus;
  }

  // Mode-aware loader. Returns true if the mode loaded successfully.
  async function loadMode(mode) {
    let endpoint = null;
    if (mode === 'daily') endpoint = `${API_BASE}/daily`;
    else if (mode === 'weekly') endpoint = `${API_BASE}/weekly`;
    else if (mode === 'archive') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedArchiveDate || '')) return false;
      endpoint = `${API_BASE}/archive/${encodeURIComponent(requestedArchiveDate)}`;
    }
    else endpoint = `${API_BASE}/random`;
    try {
      const r = await fetch(endpoint);
      const data = r.ok ? await r.json() : null;
      if (data && data.available) {
        if (window.WinCard) WinCard.hide();
        applyArticle(data, mode);
        return true;
      }
    } catch (e) {}
    return false;
  }
  // Home links select their mode explicitly. Historical dates never fall
  // through to today's puzzle when a saved daily is unavailable.
  async function pickInitialMode() {
    if (requestedArchiveDate !== null) return 'archive';
    if (/^\/daily\/?$/.test(location.pathname) || launchParams.get('mode') === 'daily') return 'daily';
    if (/^\/solo\/?$/.test(location.pathname) || launchParams.get('mode') === 'random') return 'random';
    const s = soloStatus;
    if (s && s.daily && s.daily.available) return 'daily';
    if (!s) return 'daily';
    return 'random';
  }
  // Used by the mode bar and by Next-Article progression.
  async function switchToMode(mode) {
    if (window.WikiContextoLoading) window.WikiContextoLoading.start('Getting your puzzle ready.');
    let ok = await loadMode(mode);
    if (!ok && mode !== 'random') ok = await loadMode('random');
    if (window.WikiContextoLoading) window.WikiContextoLoading.ready();
    if (!ok) showToast('Couldn’t load this puzzle. Try again.');
  }
  // Daily -> Random progression. Random wins keep loading random articles.
  async function pickNextMode() {
    await fetchSoloStatus();
    if (currentMode === 'daily' || currentMode === 'weekly') return 'random';
    return 'random';
  }

  let nextArticleInFlight = false;
  // After a win, advance daily -> random. Random wins always load another
  // random article for perpetual play.
  // The WinCard renders its own buttons, so reach for the primary one rather
  // than holding a reference -- it is replaced every time the card is shown.
  function nextArticleBtn() {
    return document.querySelector('#wt-win-card .wc-action.primary');
  }

  async function loadNextArticle() {
    if (nextArticleInFlight) return;
    nextArticleInFlight = true;
    if (window.WikiContextoLoading) window.WikiContextoLoading.start('Getting your next puzzle ready.');
    const btn = nextArticleBtn();
    if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    // loadMode() hides the card on success; on failure the card stays up so
    // the player still has a button to retry with.
    let ok = false;
    try {
      const next = await pickNextMode();
      ok = await loadMode(next);
      if (!ok && next !== 'random') ok = await loadMode('random');
    } catch (e) {
      ok = false;
    } finally {
      nextArticleInFlight = false;
      if (window.WikiContextoLoading) window.WikiContextoLoading.ready();
      if (btn) {
        btn.disabled = false;
        btn.textContent = ok ? 'Next Article' : 'Try again';
      }
    }
  }

  // ── Boot ────────────────────────────────────────────
  async function init() {
    loadCachedUser();
    const usedAuthToken = await maybeExchangeAuthToken();
    if (!usedAuthToken) await restoreFromSession();

    await fetchSoloStatus();
    const initialMode = await pickInitialMode();
    let ok = await loadMode(initialMode);
    // Fallback chain if initial mode failed (e.g. daily build error).
    if (!ok && initialMode !== 'archive' && initialMode !== 'random') ok = await loadMode('random');
    if (!ok && initialMode !== 'archive' && initialMode !== 'weekly') ok = await loadMode('weekly');
    if (!ok) {
      if (initialMode === 'archive') {
        noWeeklyEl.querySelector('h2').textContent = 'This past puzzle isn’t available';
        noWeeklyEl.querySelector('p').textContent = 'Choose another puzzle from Previous daily games.';
      }
      noWeeklyEl.hidden = false;
      if (window.WikiContextoLoading) window.WikiContextoLoading.fail(noWeeklyEl.querySelector('p').textContent);
      return;
    }

    if (window.WikiWordGuessBar && typeof window.WikiWordGuessBar.mount === 'function') {
      WikiWordGuessBar.mount({
        onSubmit: (word) => { submitGuess(word); },
        nicknameKey: 'wikiword_nickname',
        placeholder: 'Type a word to guess…',
      });
      syncGuessBarProfile();
    }
    const showHelp = () => { if (window.WikiContextoHelp) window.WikiContextoHelp.showFirstTime(); };
    if (window.WikiContextoLoading) window.WikiContextoLoading.ready(showHelp);
    else showHelp();
  }

  init().catch(() => {
    if (window.WikiContextoLoading) window.WikiContextoLoading.fail('Check your connection, then try again.');
  });
})();
