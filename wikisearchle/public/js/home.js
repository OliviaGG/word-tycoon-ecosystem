(function () {
  'use strict';
  async function restoreUser() {
    const params = new URLSearchParams(location.search);
    const token = params.get('auth_token') || params.get('auth');
    if (token) {
      params.delete('auth_token'); params.delete('auth'); params.delete('sso_checked');
      history.replaceState({}, '', location.pathname + (params.size ? '?' + params.toString() : '') + location.hash);
      try { await fetch('/api/auth/exchange?token=' + encodeURIComponent(token), { credentials:'include' }); } catch (_) {}
    }
    try {
      const response = await fetch('/api/me/session', { credentials:'include', cache:'no-store' });
      const data = response.ok ? await response.json() : null;
      if (data && data.ok && data.user) {
        const user = data.user;
        const name = user.displayName || user.globalName || user.username || 'explorer';
        const status = document.getElementById('accountStatus');
        if (status) status.textContent = 'Hi, ' + name;
        try { localStorage.setItem('wt_user', JSON.stringify(user)); } catch (_) {}
      }
    } catch (_) {}
  }
  function civilDate(date, options) {
    return new Intl.DateTimeFormat('en', { ...options, timeZone:'UTC' }).format(new Date(date + 'T12:00:00Z'));
  }
  async function dailyStatus() {
    const el = document.getElementById('dailyDate');
    if (!el) return;
    try {
      const response = await fetch('/api/solo/status', { cache:'no-store' });
      const data = response.ok ? await response.json() : null;
      if (data && data.daily && /^\d{4}-\d{2}-\d{2}$/.test(data.daily.dateKey)) {
        el.textContent = civilDate(data.daily.dateKey, { month:'long', day:'numeric' });
        if (data.daily.completed) document.getElementById('dailyTag').textContent = 'COMPLETED ✓';
      }
    } catch (_) {}
  }
  async function archive() {
    const list = document.getElementById('archiveList');
    if (!list) return;
    const message = document.getElementById('archiveMessage');
    const more = document.getElementById('archiveMore');
    let before = null, loading = false;
    async function load() {
      if (loading) return;
      loading = true; more.disabled = true;
      try {
        const response = await fetch('/api/solo/archive' + (before ? '?before=' + before : ''), { cache:'no-store' });
        if (!response.ok) throw Error('Archive unavailable');
        const data = await response.json();
        if (!Array.isArray(data.puzzles)) throw Error('Archive unavailable');
        for (const puzzle of data.puzzles) {
          const date = puzzle.dateKey;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const link = document.createElement('a'); link.className = 'archive-game';
          link.href = '/solo?date=' + date;
          const badge = document.createElement('span'); badge.className = 'archive-calendar'; badge.setAttribute('aria-hidden','true');
          const day = document.createElement('strong'); day.textContent = String(Number(date.slice(8)));
          const month = document.createElement('span'); month.textContent = civilDate(date,{month:'short'}).toUpperCase();
          badge.append(day,month);
          const label = document.createElement('span');
          const heading = document.createElement('h2'); heading.textContent = civilDate(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
          const detail = document.createElement('p'); detail.textContent = 'Replay this daily puzzle';
          label.append(heading,detail);
          const arrow = document.createElement('span'); arrow.className='archive-arrow'; arrow.textContent='›'; arrow.setAttribute('aria-hidden','true');
          link.append(badge,label,arrow); list.append(link);
        }
        message.hidden = list.children.length > 0;
        if (!list.children.length) message.textContent = 'Past puzzles will appear here as new dailies arrive.';
        before = data.nextBefore;
        more.hidden = !data.hasMore; more.textContent = 'Show earlier games';
      } catch (_) {
        message.hidden=false; message.textContent='We couldn’t load past puzzles. Try again in a moment.';
        more.hidden=false; more.textContent='Try again';
      } finally { loading=false; more.disabled=false; }
    }
    more.addEventListener('click',load);
    await load();
  }
  restoreUser().then(dailyStatus);
  archive();
})();
