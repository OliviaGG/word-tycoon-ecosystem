(function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isLight = document.documentElement.classList.toggle('theme-light');
      try { localStorage.setItem('wikisearchle-theme', isLight ? 'light' : 'dark'); } catch (e) {}
    });
  })();

  // Stats drawer (career stats only — solo has no live multiplayer leaderboard)
  (function () {
    const toggle = document.getElementById('statsToggle');
    const drawer = document.getElementById('statsDrawer');
    const backdrop = document.getElementById('statsBackdrop');
    const closeBtn = document.getElementById('statsDrawerClose');
    const body = document.getElementById('statsDrawerBody');
    if (!toggle || !drawer) return;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function fmtNum(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString() : '?'; }
    function getUserKey() {
      try {
        const raw = localStorage.getItem('wt_user');
        if (!raw) return null;
        const u = JSON.parse(raw);
        const name = u.globalName || u.displayName || u.username || u.name;
        return name ? String(name).toLowerCase() : null;
      } catch (e) { return null; }
    }

    function renderCareer() {
      const key = getUserKey();
      if (!key) {
        body.innerHTML = '<div class="ps-empty">Sign in to track your stats across rounds.</div>';
        return;
      }
      body.innerHTML = '<div class="ps-loading">Loading…</div>';
      fetch('/api/player-stats/' + encodeURIComponent(key), { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'no-data' : 'fetch-failed'))))
        .then((data) => writeCareer(data))
        .catch((err) => {
          body.innerHTML = (err && err.message === 'no-data')
            ? '<div class="ps-empty">No history yet — stats begin accumulating from the next completed round.</div>'
            : '<div class="ps-empty">Could not load stats.</div>';
        });
    }
    function writeCareer(data) {
      const lt = data.lifetime || null;
      const sections = [];
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
      body.innerHTML = sections.join('');
    }

    function open() {
      drawer.classList.remove('hidden');
      backdrop.classList.remove('hidden');
      void drawer.offsetWidth;
      drawer.classList.add('open');
      backdrop.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      renderCareer();
    }
    function close() {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      setTimeout(() => {
        if (!drawer.classList.contains('open')) {
          drawer.classList.add('hidden');
          backdrop.classList.add('hidden');
        }
      }, 320);
    }

    toggle.addEventListener('click', () => {
      drawer.classList.contains('open') ? close() : open();
    });
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  })();
