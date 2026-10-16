// WikiSearchle Solo client — renders the weekly target using the exact same
// DOM structure and class names as the multiplayer page, so the shared CSS
// produces a visually identical layout. Single-player: no sockets, progress
// persists per-browser in localStorage keyed by the weekly's setAt.
//
// Server endpoints used:
//   GET  /searchle/api/solo/weekly
//   POST /searchle/api/solo/guess { word, foundTitleNorms }

(() => {
  const API_BASE = '/searchle/api/solo';
  const TOP_N = 5;
  const STORAGE_KEY = 'wikisearchle-solo-progress-v1';
  const TICKER_GAP = 3;
  const TICKER_FADE_INSET = 24;
  const USER_KEY = 'wt_user';
  const LEGACY_USER_KEY = 'wikisearchle_user';
  // Empty on production: /api/auth/ and /api/me/ are proxied to the relay on THIS
  // origin (snippets/wt-relay-auth.conf) so the token exchange plants a first-party
  // wt_remember. That cookie is what rides the Socket.IO handshake and lets the
  // premium gate in game-shared.js prove who the player is; a cookie planted on
  // wordtycoon.live never reaches this domain.
  const AUTH_API = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? 'http://' + location.hostname + ':3000'
    : '';

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
  function getProfilePicUrl(user) {
    if (!user || typeof user !== 'object') return null;
    if (user.profilePic) return user.profilePic;
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (typeof user.avatar === 'string' && user.avatar.startsWith('http')) return user.avatar;
    if (typeof user.avatar === 'string' && user.id && /^[a-f0-9_]+$/i.test(user.avatar)) {
      return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    }
    return null;
  }
  function applyUser(user) {
    if (!user || typeof user !== 'object') return null;
    wikiUser = user;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      localStorage.removeItem(LEGACY_USER_KEY);
    } catch (e) {}
    window._wtUser = user;
    window._wtUserPicUrl = getProfilePicUrl(user);
    return wikiUser;
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
      }
    } catch (e) {}
    return true;
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
    if (!wikiUser || !wikiUser.id) return;
    if (state.rewardClaimed) return;
    try {
      const r = await fetch(`${API_BASE}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: wikiUser.provider || 'discord',
          userId: wikiUser.id,
          username: wikiUser.username || wikiUser.displayName || 'player',
          displayName: wikiUser.globalName || wikiUser.displayName || wikiUser.username || 'player',
          score: state.score,
          guessCount: state.guessCount,
        }),
      });
      const d = await r.json();
      if (d && d.ok) {
        state.rewardClaimed = true;
        saveState();
      }
    } catch (e) {}
    try { localStorage.setItem('wikisearchle_sp_weekly', currentWeekStartISO()); } catch (e) {}
  }

  // ── Persistence ─────────────────────────────────────
  function emptyState(setAt) {
    return {
      setAt,
      revealedIds: [],
      foundTitleNorms: [],
      score: 0,
      guessCount: 0,
      top: [],
      seenGuesses: [],
      won: false,
    };
  }
  function loadState(setAt) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState(setAt);
      const s = JSON.parse(raw);
      if (s && s.setAt === setAt) return s;
    } catch (e) {}
    return emptyState(setAt);
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function revealedSet() { return new Set(state.revealedIds); }

  // ── Helpers ─────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtNum(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString() : '?'; }
  function avatarMarkup(user, fallbackName) {
    const displayName = getDisplayName(user) || String(fallbackName || 'You').trim() || 'You';
    const initial = (displayName[0] || '?').toUpperCase();
    const picUrl = getProfilePicUrl(user);
    if (!picUrl) return esc(initial);
    return `<img src="${esc(picUrl)}" alt="${esc(displayName)}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror='this.remove();this.parentNode.textContent=${JSON.stringify(initial)};'>`;
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
  // Server sends every token's text; client decides redaction based on
  // revealedIds + server's seed-revealed flag (stop words, etc.).
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
        wText.textContent = t.text || '';
      } else {
        wrap.className = 't-word hidden';
        wText.textContent = 'HIDDEN';
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
          s.textContent = t.text || '';
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

  function flipReveals(ids) {
    if (!ids || !ids.length) return;
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
        wrap.className = 't-word hidden';
        wText.textContent = 'HIDDEN';
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

  const _cardDomCache = new Map();
  const _placeholderCache = [];
  function renderCards() {
    const newTop = state.top.slice();
    if (cardsEmpty.parentNode === cardsEl) cardsEl.removeChild(cardsEmpty);

    const keepWords = new Set(newTop.map((g) => g.word));
    for (const [word, el] of [..._cardDomCache.entries()]) {
      if (!keepWords.has(word)) {
        if (el.parentNode) el.remove();
        _cardDomCache.delete(word);
      }
    }
    for (const ph of _placeholderCache) {
      if (ph && ph.parentNode) ph.remove();
    }

    newTop.forEach((g, i) => {
      const isTopSlot = i === 0;
      const { fillPct, fillColor, hue } = rankMeter(g.rank);
      const wlen = (g.word || '').length;
      const sizeCls = wlen > 13 ? ' xl-word' : wlen > 10 ? ' lg-word' : '';
      const viewerName = getDisplayName(wikiUser) || 'You';
      let c = _cardDomCache.get(g.word);
      if (!c) {
        c = document.createElement('div');
        c.dataset.word = g.word;
        c.className = 'card' + (isTopSlot ? ' top' : '') + sizeCls;
        const inner = (
          `<div class="rank-word">` +
          `<div class="rank">#${fmtNum(g.rank)}</div>` +
          `<div class="word-lbl">${esc(g.word || '')}</div>` +
          `</div>` +
          `<div class="who">` +
          `<div class="avatar-fb" style="overflow:hidden">${avatarMarkup(wikiUser, viewerName)}</div>` +
          `<div class="gname">${esc(viewerName)}</div>` +
          `</div>`
        );
        c.innerHTML =
          `<div class="fill"></div>` +
          `<div class="card-inner base">${inner}</div>` +
          `<div class="card-inner overlay" aria-hidden="true">${inner}</div>`;
        _cardDomCache.set(g.word, c);
      } else {
        c.className = 'card' + (isTopSlot ? ' top' : '') + sizeCls;
        c.style.animation = 'none';
      }
      c.style.setProperty('--fill-pct', fillPct.toFixed(2) + '%');
      c.style.setProperty('--fill-color', fillColor);
      c.style.setProperty('--rank-hue', hue);
      cardsEl.appendChild(c);
    });

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

  // ── Announce banner ─────────────────────────────────
  function renderAnnounce(word, earned, total, tier, opts) {
    announceEl.classList.remove('hidden');
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
      return;
    }
    waTotal.textContent = `${fmtNum(total)} pts`;
    waEarned.textContent = `+${fmtNum(earned)}`;
    const t = (tier || 'common').toLowerCase();
    waRarity.className = `wa-rarity ${t}`;
    waRarity.textContent = t.toUpperCase();
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

  // ── Win card (shared WinCard component) ───────────────────
  function showWinCard() {
    if (!window.WinCard) return;
    const u = wikiUser || null;
    WinCard.showSolo({
      game: 'wikisearchle',
      gameName: 'WikiSearchle',
      word: titleText.textContent.trim(),
      guessCount: state.guessCount,
      jackpot: state.score,
      winner: {
        displayName: getDisplayName(u) || 'You',
        username: (u && u.username) || null,
        platform: (u && u.provider) || 'web',
        platformUserId: u && u.id ? String(u.id) : null,
        profilePic: getProfilePicUrl(u),
        linkedDiscord: (u && u.linkedDiscord) || null,
      },
      // Old modal stayed up until "Next Article" was clicked — keep sticky.
      autoHideMs: 0,
      actions: [{ label: 'Next Article', primary: true, onClick: () => window.WinCard.hide() }],
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

  // ── Guess handling ──────────────────────────────────
  async function submitGuess(rawWord) {
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
        body: JSON.stringify({ word, foundTitleNorms: state.foundTitleNorms, identity }),
      });
      resp = await r.json();
      if (!r.ok) throw new Error(resp.error || 'guess failed');
    } catch (e) {
      showToast('Network error');
      return;
    } finally {
      guessInFlight = false;
      setGuessBarEnabled(true);
    }

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
      state.score += (points || 0);
      flipReveals(newIds);
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

  // ── Boot ────────────────────────────────────────────
  async function init() {
    loadCachedUser();
    const usedAuthToken = await maybeExchangeAuthToken();
    if (!usedAuthToken) await restoreFromSession();

    let data;
    try {
      const r = await fetch(`${API_BASE}/weekly`);
      data = await r.json();
    } catch (e) {
      noWeeklyEl.hidden = false;
      return;
    }
    if (!data || !data.available) {
      noWeeklyEl.hidden = false;
      return;
    }
    weekly = data;
    if (typeof weekly.totalRankedWords === 'number' && weekly.totalRankedWords > 0) {
      totalRankedWordsCache = weekly.totalRankedWords;
    }
    state = loadState(weekly.setAt);

    gameAreaEl.hidden = false;

    renderArticle();
    renderStats();
    renderCards();
    if (state.won) {
      maybeShowWin();
      if (!state.rewardClaimed && wikiUser && wikiUser.id) postSoloComplete();
    }

    if (window.WikiWordGuessBar && typeof window.WikiWordGuessBar.mount === 'function') {
      WikiWordGuessBar.mount({
        onSubmit: (word) => { submitGuess(word); },
        nicknameKey: 'wikiword_nickname',
        placeholder: 'Type a word to guess…',
      });
    }
  }

  init();
})();
