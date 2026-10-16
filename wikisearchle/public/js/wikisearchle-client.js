// WikiSearchle — shared client renderer for overlay.html and index.html.
// Subscribes to the WikiSearchle server's aggregated socket feed; renders the
// Searchle top-N cards, horizontal guess ticker, and the WikiWord redacted
// article side-by-side.

(() => {
  // Streamer-private session: ?session=<handle> in the URL means we landed
  // here via /play/<handle> → /game/wikisearchle/?session=<handle>. The
  // chat-relay proxy serves socket.io under /game/wikisearchle/socket.io for
  // that path. The public deploy uses nginx-prefixed /searchle/socket.io.
  const _sessionHandle = (() => {
    try { return new URLSearchParams(location.search).get('session') || null; } catch (_) { return null; }
  })();
  const _proxyPathMatch = location.pathname.match(/^\/game\/[^/]+\//);
  const _socketPath = _proxyPathMatch ? `${_proxyPathMatch[0]}socket.io` : '/searchle/socket.io';
  const socket = _sessionHandle
    ? io({ path: _socketPath, auth: { session: _sessionHandle } })
    : io({ path: _socketPath });

  const cardsEl = document.getElementById('cards');
  const tickerTrack = document.getElementById('tickerTrack');
  const titleText = document.getElementById('titleText');
  const body = document.getElementById('body');

  let lastWikiWordState = null;
  // Cap the ticker buffer locally so the rendered DOM stays light.
  const TICKER_CAP = 80;
  const tickerBuffer = []; // [{word, rank, displayName}]

  // ── Searchle cards ───────────────────────────────────
  const platformColors = { tiktok: '#69C9D0', youtube: '#FF0000', discord: '#5865F2' };
  // Anonymous / no-avatar fallback — show the Word Tycoon PFP at full size,
  // matching the solo page so anon presence reads as "Word Tycoon" everywhere.
  const ANON_PFP_URL = '/img/wt-pfp.png';
  function avatarHtml(user) {
    if (user && user.profilePic) {
      return `<img class="avatar" src="${escapeAttr(user.profilePic)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar-fb',textContent:(this.alt||'?')[0].toUpperCase()}))">`;
    }
    return `<img class="avatar" src="${escapeAttr(ANON_PFP_URL)}" alt="Word Tycoon">`;
  }
  function platIconHtml(platform) {
    if (platform === 'tiktok') return '<span class="plat" style="color:#69C9D0">♪</span>';
    if (platform === 'youtube') return '<span class="plat" style="color:#FF0000">▶</span>';
    if (platform === 'discord') return '<span class="plat" style="color:#5865F2">◇</span>';
    return '';
  }
  function renderCards(top) {
    cardsEl.innerHTML = '';
    (top || []).forEach((g, i) => {
      const c = document.createElement('div');
      c.className = 'card' + (i === 0 ? ' top' : '');
      c.innerHTML = `
        <div class="rank">#${formatRank(g.rank)}</div>
        <div class="word">${escapeHtml(g.word || '')}</div>
        <div class="who">
          ${avatarHtml(g.user)}
          <div class="name">${escapeHtml((g.user && g.user.displayName) || 'viewer')}</div>
          ${platIconHtml(g.user && g.user.platform)}
        </div>
      `;
      cardsEl.appendChild(c);
    });
  }

  // ── Ticker (RecTangled-style horizontal scroll) ────
  function renderTicker() {
    // Build content twice to make the seamless loop with translateX(-50%).
    const items = tickerBuffer.map(itemHtml).join('');
    tickerTrack.innerHTML = items + items;
  }
  function itemHtml(g) {
    return `<span class="ticker-item"><span class="tw-rank">#${formatRank(g.rank)}</span><span class="tw-word">${escapeHtml(g.word)}</span></span>`;
  }
  function pushTicker(g) {
    tickerBuffer.push({ word: g.word, rank: g.rank, displayName: g.user && g.user.displayName });
    if (tickerBuffer.length > TICKER_CAP) tickerBuffer.shift();
    renderTicker();
  }

  // ── WikiWord article ───────────────────────────────
  function renderArticle(state) {
    if (!state) {
      titleText.innerHTML = '';
      body.innerHTML = '';
      document.body.classList.add('idle');
      return;
    }
    document.body.classList.remove('idle');

    titleText.innerHTML = '';
    // Hidden hard-title words (T3/T4) don't gate the "all revealed" check —
    // they're never revealed during play, only when the round ends and the
    // server flips revealed=true on all tokens including isSkipped.
    const allTitleRevealed = state.titleTokens.every((t) => t.type !== 'word' || t.isSkipped || t.revealed);
    if (allTitleRevealed) {
      for (const t of state.titleTokens) {
        if (t.type === 'space') { titleText.appendChild(document.createTextNode(t.text)); continue; }
        // Skipped tokens stay invisible during play; render only after the
        // server flips them revealed at round end.
        if (t.isSkipped && !t.revealed) continue;
        const s = document.createElement('span');
        s.className = 'word revealed';
        s.textContent = t.text;
        titleText.appendChild(s);
      }
    } else {
      const s = document.createElement('span');
      s.className = 'word redacted title-blackout';
      s.textContent = '\u00a0';
      titleText.appendChild(s);
    }

    body.innerHTML = '';
    for (const para of state.paragraphs) {
      const p = document.createElement('p');
      for (const t of para) {
        if (t.type === 'space') { p.appendChild(document.createTextNode(t.text)); continue; }
        const s = document.createElement('span');
        s.className = 'word';
        s.dataset.len = t.len;
        if (t.text) {
          s.textContent = t.text;
          s.classList.add('revealed');
          s.dataset.norm = t.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        } else {
          s.classList.add('redacted');
          s.style.minWidth = `calc(${t.len}ch + 10px)`;
          s.textContent = '\u00a0'.repeat(t.len);
        }
        p.appendChild(s);
      }
      body.appendChild(p);
    }
  }

  function applyGlow(words) {
    for (const word of words) {
      document.querySelectorAll(`.word[data-norm="${CSS.escape(word)}"]`).forEach((s) => {
        s.classList.remove('glow');
        void s.offsetWidth;
        s.classList.add('glow');
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  function formatRank(n) {
    const v = Number(n);
    if (!isFinite(v)) return '?';
    return v.toLocaleString();
  }

  // ── Socket wiring ──────────────────────────────────
  socket.on('wikisearchle-state', (s) => {
    if (s && s.targetWord) renderCards(s.topGuesses || []);
    (s && s.recentGuesses || []).slice(-TICKER_CAP).forEach((g) => tickerBuffer.push({ word: g.word, rank: g.rank, displayName: g.user && g.user.displayName }));
    while (tickerBuffer.length > TICKER_CAP) tickerBuffer.shift();
    renderTicker();
  });

  socket.on('wikisearchle-round-start', () => {
    cardsEl.innerHTML = '';
    tickerBuffer.length = 0;
    renderTicker();
  });

  socket.on('wikisearchle-new-guess', (g) => { pushTicker(g); });
  socket.on('wikisearchle-top', (top) => { renderCards(top || []); });

  socket.on('wikiword-state', (s) => { lastWikiWordState = s; renderArticle(s); });
  socket.on('wikiword-reveal', (e) => {
    fetch('/searchle/api/state').then(r => r.json()).then((s) => {
      // wikisearchle-state has both halves; we want the wikiword state mirrored
      // separately — for V1, we simply request a wikiword refresh by re-rendering
      // with the cached state and applying a glow.
    }).catch(() => {});
    if (e && e.words) applyGlow(e.words);
  });
  socket.on('wikiword-round-end', (state) => {
    renderArticle(state);
    document.querySelectorAll('.word').forEach((s) => s.classList.remove('redacted'));
  });
  socket.on('wikiword-idle', () => { renderArticle(null); });

  // Prime
  fetch('/searchle/api/state').then(r => r.json()).then((s) => {
    if (s && s.topGuesses) renderCards(s.topGuesses);
    (s && s.recentGuesses || []).forEach((g) => tickerBuffer.push({ word: g.word, rank: g.rank, displayName: g.user && g.user.displayName }));
    renderTicker();
  }).catch(() => {});
})();
