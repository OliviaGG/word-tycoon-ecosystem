const RARITY_COLORS = {
  common: '#9d9d9d', uncommon: '#4fc34f', rare: '#4a9eff',
  epic: '#b44aff', legendary: '#ffab00', ultra: '#ff4444', aux: '#00ffcc'
};

const GAME_LABELS = {
  word5000: 'Word5000', subtextle: 'Subtextle', wikicontexto: 'WikiContexto',
  wikirectangled: 'WikirecTangled',
  betwixt: 'Betwixt', rectangled: 'recTangled', erectangled: 'erecTangled',
  triangled: 'Triangled', spellingbee: 'Spelling Bee', wordle: 'Wordle',
  figural: 'Figural', pixeletters: 'PixeLetters', unwordle: 'UnWordle',
  color500: 'Color500'
};

const SORT_LABELS = {
  elo: 'ELO',
  coins: 'Coins', total_game_wins: 'Wins', total_taps: 'Taps',
  library_words: 'Library', wins: 'Wins', suspicion: 'Susp.',
  word5000: 'W5K', subtextle: 'Subtxt', wikicontexto: 'WikiCtx', betwixt: 'Btwn',
  wikirectangled: 'WikiRec',
  rectangled: 'Rect', erectangled: 'eRec', triangled: 'Tri',
  spellingbee: 'SpBee', wordle: 'Wrdl', figural: 'Figr',
  pixeletters: 'Pixl', unwordle: 'UnWd', color500: 'Clr500'
};

const SORT_GETTER = {
  elo: p => p.elo,
  coins: p => p.coins,
  total_game_wins: p => p.totalGameWins,
  total_taps: p => p.totalTaps,
  library_words: p => p.libraryWords,
  wins: p => p.wins,
  suspicion: p => p.suspicion?.score || 0,
};
Object.keys(GAME_LABELS).forEach(k => SORT_GETTER[k] = p => p.gameWins?.[k] || 0);

const COUNTRY_FLAGS = {
  US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', JP: '🇯🇵', SE: '🇸🇪', BR: '🇧🇷',
  CA: '🇨🇦', FR: '🇫🇷', AU: '🇦🇺', NL: '🇳🇱', ES: '🇪🇸', IT: '🇮🇹',
  PL: '🇵🇱', MX: '🇲🇽', KR: '🇰🇷', RU: '🇷🇺', CN: '🇨🇳', TW: '🇹🇼', '??': '🌍'
};

// ELO tier classification
function eloTier(elo) {
  if (elo >= 2400) return { name: 'Grandmaster', cls: 'gm', color: '#ff4d6d' };
  if (elo >= 2100) return { name: 'Master', cls: 'master', color: '#ffab00' };
  if (elo >= 1800) return { name: 'Diamond', cls: 'diamond', color: '#7ad3ff' };
  if (elo >= 1500) return { name: 'Platinum', cls: 'plat', color: '#66efc0' };
  if (elo >= 1300) return { name: 'Gold', cls: 'gold', color: '#ffd670' };
  if (elo >= 1150) return { name: 'Silver', cls: 'silver', color: '#dbe7ff' };
  return { name: 'Bronze', cls: 'bronze', color: '#d68a52' };
}

// Suspicion rule weights (matches backend spec)
const SUS_RULES = [
  { key: 'guessAccuracy',    label: 'Guess accuracy',  weight: 30 },
  { key: 'winRate',          label: 'Win rate',        weight: 25 },
  { key: 'firstHitLatency',  label: 'First-hit latency', weight: 25 },
  { key: 'targetFinds',      label: 'Target finds',    weight: 10 },
  { key: 'pointsPerGuess',   label: 'Points / guess',  weight: 5 },
];

let state = {
  page: 1,
  sort: 'elo',
  scope: 'all',
  region: 'global',
  hideEmpty: false,
  search: '',
  expanded: new Set(),
  admin: false,
  cheatersOnly: false,
};

function fmt(n) {
  if (n == null) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function fmtFull(n) { return (n || 0).toLocaleString('en-US'); }
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function lastActiveText(hours) {
  if (hours < 1) return { txt: 'live', live: true };
  if (hours < 24) return { txt: `${hours}h ago`, live: false };
  return { txt: `${Math.round(hours / 24)}d ago`, live: false };
}

function avatarColors(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 40 + (Math.abs(h >> 8) % 60)) % 360;
  return [`oklch(0.50 0.10 ${hue1})`, `oklch(0.32 0.08 ${hue2})`];
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function providerIcon(provider) {
  const icons = {
    discord: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 3a13 13 0 0 0-3.2-1l-.2.4a12 12 0 0 0-4.2 0L5.7 2A13 13 0 0 0 2.5 3 13 13 0 0 0 .5 11a13 13 0 0 0 3.8 2l.7-1a8 8 0 0 1-1.3-.6c.1-.1.2-.2.3-.2a9 9 0 0 0 7.9 0l.3.2a8 8 0 0 1-1.3.6l.7 1a13 13 0 0 0 3.8-2A13 13 0 0 0 13.5 3ZM5.7 9c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5c.8 0 1.4.7 1.4 1.5S6.5 9 5.7 9Zm4.6 0c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5c.8 0 1.4.7 1.4 1.5S11.1 9 10.3 9Z"/></svg>',
    web: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 1.8 3 3.8 3 6s-1 4.2-3 6c-2-1.8-3-3.8-3-6s1-4.2 3-6Z"/></svg>',
    nick: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12V5h2l3 5V5h2v7"/><path d="M11 8h2"/></svg>'
  };
  return icons[provider] || icons.web;
}

// ─── Row HTML ──────────────────────────────────────────────────
function rowHTML(p) {
  const sortGetter = SORT_GETTER[state.sort];
  const metricVal = sortGetter ? sortGetter(p) : 0;
  const metricLabel = SORT_LABELS[state.sort] || '';
  const winRatePct = Math.round(p.winRate * 100);
  const initials = (p.displayName || '?').slice(0, 2).toUpperCase();
  const [c1, c2] = avatarColors(p.displayName || '');
  const last = lastActiveText(p.lastActiveHours);
  const flag = COUNTRY_FLAGS[p.country] || '';
  const expanded = state.expanded.has(p.identity) ? 'expanded' : '';
  const tier = eloTier(p.elo);

  const eloDelta = p.eloDelta7d || 0;
  const deltaCls = eloDelta > 0 ? 'up' : eloDelta < 0 ? 'down' : 'flat';
  const deltaTxt = eloDelta > 0 ? `+${eloDelta}` : eloDelta < 0 ? `${eloDelta}` : '±0';

  const lowRounds = p.roundsCounted < 5;
  const sus = p.suspicion?.score || 0;
  const susCls = sus >= 70 ? 'high' : sus >= 40 ? 'med' : sus >= 15 ? 'low' : '';

  const flags = [];
  if (p.suspended) flags.push('<span class="badge-flag suspended" title="Suspended">⊘ SUS</span>');
  if (lowRounds) flags.push(`<span class="badge-flag unrated" title="Needs ${5 - p.roundsCounted} more rated round(s)">${p.roundsCounted}/5</span>`);
  if (state.admin && sus >= 50) flags.push(`<span class="badge-flag cheat" title="Suspicion ${sus}">⚠ ${sus}</span>`);

  return `
    <div class="row ${expanded} ${p.suspended ? 'is-suspended' : ''}" data-identity="${p.identity}" tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}">
      <div class="rank ${p.rank === 1 ? 'gold' : p.rank === 2 ? 'silver' : p.rank === 3 ? 'bronze' : ''}">#${p.rank}</div>
      <div class="coins">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 8h4M8 6v4"/></svg>
        ${fmt(p.coins)}
      </div>
      <div class="avatar" style="--ag-from:${c1};--ag-to:${c2}">${initials}</div>
      <div class="name-cell">
        <div class="name">
          ${escapeHtml(p.displayName)}
          ${flags.join('')}
        </div>
        <div class="sub">
          <span class="provider-tag provider-${p.provider}" title="${p.identity}">${providerIcon(p.provider)} ${p.provider}</span>
          <span class="sub-sep">·</span>
          ${p.title ? `<span class="title-tag" style="color:${p.titleColor}">${escapeHtml(p.title)}</span><span class="sub-sep">·</span>` : ''}
          <span>${p.dailyStreak}d streak</span>
        </div>
      </div>

      <div class="elo-cell">
        <div class="elo-main">
          <span class="elo-num tabular">${p.elo}</span>
          <span class="elo-tier tier-${tier.cls}" style="color:${tier.color}">${tier.name}</span>
        </div>
        <div class="elo-sub">
          <span class="delta-pill ${deltaCls}">${deltaTxt}</span>
          <span class="rounds tabular">${p.roundsCounted} rd${p.roundsCounted === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div class="country-cell col-country">
        <span class="cc">${flag} ${p.country}</span>
        <span class="last ${last.live ? 'live' : ''}">${last.live ? '● live' : last.txt}</span>
      </div>
      <div class="num tabular col-wins">${fmt(p.wins)}<span class="unit">/${fmt(p.roundsPlayed)}</span></div>
      <div class="winrate col-winrate">
        <div class="pct">${winRatePct}%</div>
        <div class="bar"><div style="width:${winRatePct}%"></div></div>
      </div>

      ${state.admin ? `
        <div class="sus-cell ${susCls}">
          ${p.suspicion ? `
            <span class="sus-score">${sus}</span>
            <span class="sus-bar"><span style="width:${Math.min(100, sus)}%"></span></span>
          ` : `<span class="sus-empty">—</span>`}
        </div>
      ` : `
        <div class="num tabular col-metric">${fmt(metricVal)}<span class="unit">${metricLabel}</span></div>
      `}

      <div class="expand-chev">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4.5l3 3 3-3"/></svg>
      </div>
    </div>
    <div class="detail" data-detail-identity="${p.identity}">${detailHTML(p)}</div>
  `;
}

// ─── Sparkline ─────────────────────────────────────────────────
function sparkSVG(trend, color = '#7ad3ff') {
  if (!trend?.length) return '';
  const min = Math.min(...trend), max = Math.max(...trend);
  const W = 200, H = 32, pad = 2;
  const points = trend.map((v, i) => {
    const x = pad + (i / (trend.length - 1)) * (W - pad * 2);
    const norm = max === min ? 0.5 : 1 - (v - min) / (max - min); // higher elo = higher on chart
    const y = pad + norm * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${points.join(' L')}`;
  const area = `${path} L${W - pad},${H - pad} L${pad},${H - pad} Z`;
  const last = points[points.length - 1].split(',');
  return `
    <svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-${color.replace('#','')}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#spark-${color.replace('#','')})"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/>
    </svg>
  `;
}

// ─── Detail panel ──────────────────────────────────────────────
function detailHTML(p) {
  const games = Object.entries(GAME_LABELS).map(([k, label]) => ({
    key: k, label, wins: p.gameWins?.[k] || 0
  }));
  const sortedGames = [...games].sort((a, b) => b.wins - a.wins);
  const topKey = sortedGames[0]?.key;

  const gamesHtml = games.map(g => {
    const cls = `${g.wins === 0 ? 'zero' : ''} ${g.key === topKey && g.wins > 0 ? 'top' : ''}`.trim();
    return `<div class="game-cell ${cls}"><span class="name">${g.label}</span><span class="v">${fmt(g.wins)}</span></div>`;
  }).join('');

  const tier = eloTier(p.elo);
  const trendDelta = p.trend[p.trend.length - 1] - p.trend[0];
  const deltaCls = trendDelta > 0 ? 'up' : trendDelta < 0 ? 'down' : 'flat';
  const deltaSign = trendDelta > 0 ? '▲' : trendDelta < 0 ? '▼' : '—';

  // ELO panel — primary
  const eloPanel = `
    <div class="panel elo-panel">
      <div class="panel-head">
        <span class="title">ELO rating · 12-round trend</span>
        <span class="meta">K/(N−1) · backfilled @ 1200</span>
      </div>
      <div class="elo-hero">
        <div class="elo-hero-main">
          <span class="elo-hero-num tabular">${p.elo}</span>
          <span class="elo-hero-tier" style="color:${tier.color}">${tier.name}</span>
        </div>
        <div class="elo-hero-stats">
          <div><span class="lbl">Peak</span><span class="v tabular">${p.peakElo}</span></div>
          <div><span class="lbl">7d Δ</span><span class="v tabular ${p.eloDelta7d >= 0 ? 'up' : 'down'}">${p.eloDelta7d >= 0 ? '+' : ''}${p.eloDelta7d}</span></div>
          <div><span class="lbl">Rated</span><span class="v tabular">${p.roundsCounted}<span class="unit">/${p.roundsPlayed}</span></span></div>
          <div><span class="lbl">Win rate</span><span class="v tabular">${Math.round(p.winRate*100)}%</span></div>
        </div>
      </div>
      <div class="spark-block elo-spark">
        ${sparkSVG(p.trend, tier.color)}
        <div class="spark-meta">
          <div class="delta ${deltaCls}">${deltaSign} ${Math.abs(trendDelta)}</div>
          <div class="lbl">12 rd Δ</div>
        </div>
      </div>
      ${p.roundsCounted < 5 ? `
        <div class="elo-warn">
          <strong>Provisional</strong> — Needs ${5 - p.roundsCounted} more rated round${5-p.roundsCounted===1?'':'s'} to appear on the public leaderboard.
        </div>
      ` : ''}
    </div>
  `;

  // Suspicion panel (admin only) OR cosmetics panel (public)
  const susPanel = state.admin ? renderSusPanel(p) : renderCosmeticsPanel(p);

  // Games panel
  const gamesPanel = `
    <div class="panel">
      <div class="panel-head">
        <span class="title">Word games · wins</span>
        <span class="meta">${sortedGames.filter(g => g.wins > 0).length}/${games.length} active</span>
      </div>
      <div class="games-grid">${gamesHtml}</div>
    </div>
  `;

  // Identity strip
  const identityStrip = `
    <div class="identity-strip">
      <div class="id-block">
        <span class="id-lbl">Identity</span>
        <code class="id-val">${escapeHtml(p.identity)}</code>
        <button class="copy-btn" data-copy="${escapeHtml(p.identity)}" title="Copy identity">copy</button>
      </div>
      <div class="id-block">
        <span class="id-lbl">Provider</span>
        <span class="id-val provider-${p.provider}">${p.provider}</span>
      </div>
      <div class="id-block">
        <span class="id-lbl">Joined</span>
        <span class="id-val">${fmtDate(p.memberSince)}</span>
      </div>
      <div class="id-block">
        <span class="id-lbl">Country</span>
        <span class="id-val">${COUNTRY_FLAGS[p.country] || ''} ${p.country}</span>
      </div>
      ${p.suspended ? `<div class="id-block id-warn"><span class="id-lbl">Suspended</span><span class="id-val">${escapeHtml(p.suspended.reason)} · ${fmtDate(p.suspended.at)}</span></div>` : ''}
      <div class="detail-actions">
        <button class="btn-mini">Profile</button>
        <button class="btn-mini">Compare</button>
        ${state.admin ? `<button class="btn-mini admin-action" data-action="player" data-id="${p.identity}">GET /admin/player</button>` : ''}
        ${state.admin && !p.suspended ? `<button class="btn-mini danger admin-action" data-action="suspend" data-id="${p.identity}">Suspend</button>` : ''}
      </div>
    </div>
  `;

  return `
    <div class="detail-grid">
      ${eloPanel}
      ${gamesPanel}
      ${susPanel}
    </div>
    ${identityStrip}
  `;
}

function renderSusPanel(p) {
  const sus = p.suspicion;
  if (!sus) {
    return `
      <div class="panel sus-panel">
        <div class="panel-head">
          <span class="title">Cheater detection</span>
          <span class="meta">rolling window · last 50 rd</span>
        </div>
        <div class="sus-empty-state">
          <div class="sus-pending">PENDING</div>
          <p>Window not yet populated. Needs ${Math.max(0, 50 - p.roundsCounted)} more round${50 - p.roundsCounted === 1 ? '' : 's'} before rules can fire.</p>
        </div>
      </div>
    `;
  }

  const rules = SUS_RULES.map(r => {
    const score = sus.flags?.[r.key] || 0;
    const fired = score > 0;
    return `
      <div class="rule-row ${fired ? 'fired' : ''}">
        <span class="rule-name">${r.label}</span>
        <span class="rule-weight">+${r.weight}</span>
        <span class="rule-score ${fired ? 'fired' : ''}">${fired ? `+${score}` : '—'}</span>
      </div>
    `;
  }).join('');

  const totalCls = sus.score >= 70 ? 'high' : sus.score >= 40 ? 'med' : 'low';

  return `
    <div class="panel sus-panel ${totalCls}">
      <div class="panel-head">
        <span class="title">Cheater detection</span>
        <span class="meta">last 50 rounds</span>
      </div>
      <div class="sus-total">
        <span class="sus-total-num tabular">${sus.score}</span>
        <span class="sus-total-lbl">suspicion score</span>
        <span class="sus-total-bar"><span style="width:${Math.min(100, sus.score)}%"></span></span>
      </div>
      <div class="rules">${rules}</div>
      <div class="sus-meta">
        <span><b>First-hit latency</b> ${(sus.firstHitLatencyMs/1000).toFixed(1)}s</span>
        <span class="sus-flag-state">${sus.score >= 50 ? '⚠ flagged for review' : 'below threshold'}</span>
      </div>
    </div>
  `;
}

function renderCosmeticsPanel(p) {
  const cosmetics = (p.equippedCosmetics || []).map(c => `
    <span class="cos">
      <span class="dot" style="background:${RARITY_COLORS[c.rarity] || '#888'}"></span>
      <span class="cat">${c.category.replace(/_/g, ' ')}</span>
      <span>${escapeHtml(c.name)}</span>
    </span>
  `).join('');

  return `
    <div class="panel">
      <div class="panel-head">
        <span class="title">Equipped cosmetics</span>
        <span class="meta">${(p.equippedCosmetics || []).length} items</span>
      </div>
      <div class="cosmetics-row">${cosmetics || '<span style="font-size:11px;color:var(--muted-2)">No cosmetics</span>'}</div>
      <div class="detail-meta" style="margin-top:14px;">
        <span><b>Coins</b> ${fmtFull(p.coins)}</span>
        <span><b>Library</b> ${fmtFull(p.libraryWords)} words</span>
        <span><b>Taps</b> ${fmtFull(p.totalTaps)}</span>
        <span><b>Streak</b> ${p.dailyStreak} days</span>
      </div>
    </div>
  `;
}

// ─── Filtering ─────────────────────────────────────────────────
function applyFilters(players) {
  let out = players;
  if (state.search) {
    const q = state.search.toLowerCase();
    out = out.filter(p =>
      p.displayName.toLowerCase().includes(q) ||
      p.identity.toLowerCase().includes(q)
    );
  }
  if (state.cheatersOnly && state.admin) {
    out = out.filter(p => (p.suspicion?.score || 0) >= 50);
  }
  if (state.region !== 'global') {
    const regionMap = {
      NA: ['US','CA','MX'],
      EU: ['GB','DE','FR','SE','NL','ES','IT','PL'],
      APAC: ['JP','KR','AU','BR'],
    };
    const codes = regionMap[state.region] || [];
    out = out.filter(p => codes.includes(p.country));
  }
  return out;
}

// ─── Load ──────────────────────────────────────────────────────
async function loadPage(page) {
  state.page = page;
  const list = document.getElementById('player-list');

  // Mock the live API call.
  // Real call: fetch(`/api/${state.admin ? 'admin/' : ''}leaderboard?limit=1000&sort=${state.sort}`, headers)
  const apiCall = state.admin ? 'adminLeaderboard' : 'publicLeaderboard';
  const data = await window.__GOAT_API[apiCall]({ limit: 1000, sort: state.sort, page: 1 });
  const filtered = applyFilters(data.players);

  const total = filtered.length;
  const limit = 20;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  state.page = safePage;
  const slice = filtered.slice((safePage - 1) * limit, safePage * limit);

  // Hero stats
  document.getElementById('hero-eligible').textContent = data.gating.totalEligible.toLocaleString();
  document.getElementById('hero-accounts').textContent = data.gating.totalAccounts.toLocaleString();
  document.getElementById('hero-top-elo').textContent = Math.max(...data.players.map(p => p.elo));
  const flagged = await window.__GOAT_API.adminCheaters({ minScore: 50 });
  document.getElementById('hero-flagged').textContent = flagged.players.length;

  // API endpoint preview
  document.getElementById('api-endpoint').textContent =
    state.admin
      ? `GET /api/admin/leaderboard?sort=${state.sort}&limit=25  [x-admin-key]`
      : `GET /api/leaderboard?sort=${state.sort}&limit=25`;

  if (!slice.length) {
    list.innerHTML = '<div class="loading-state"><p>No players match these filters.</p></div>';
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  list.innerHTML = slice.map(rowHTML).join('');
  attachRowHandlers();
  renderPagination(safePage, pages, total, limit);

  document.getElementById('range-from').textContent = ((safePage - 1) * limit + 1).toLocaleString();
  document.getElementById('range-to').textContent = Math.min(safePage * limit, total).toLocaleString();
  document.getElementById('range-total').textContent = total.toLocaleString();
  document.getElementById('range-context').textContent = state.admin ? 'all accounts' : `eligible (≥5 rated rounds)`;
}

function attachRowHandlers() {
  document.querySelectorAll('.row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-mini') || e.target.closest('.copy-btn')) return;
      const id = row.dataset.identity;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else { state.expanded.clear(); state.expanded.add(id); }
      document.querySelectorAll('.row.expanded').forEach(r => {
        if (r.dataset.identity !== id) {
          r.classList.remove('expanded');
          r.setAttribute('aria-expanded', 'false');
        }
      });
      const willExpand = state.expanded.has(id);
      row.classList.toggle('expanded', willExpand);
      row.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    });
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(btn.dataset.copy);
      const orig = btn.textContent;
      btn.textContent = '✓ copied';
      setTimeout(() => btn.textContent = orig, 1200);
    });
  });

  document.querySelectorAll('.admin-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'suspend') {
        if (!confirm(`Suspend ${id}? This calls POST /api/admin/suspend/${id}`)) return;
        await window.__GOAT_API.adminSuspend(id, 'flagged via dashboard');
        loadPage(state.page);
      } else if (action === 'player') {
        const p = await window.__GOAT_API.adminPlayer(id);
        alert(`GET /api/admin/player/${id}\n\n${JSON.stringify({
          identity: p.identity, elo: p.elo, peakElo: p.peakElo,
          roundsCounted: p.roundsCounted, roundsPlayed: p.roundsPlayed,
          wins: p.wins, suspicion: p.suspicion, suspended: p.suspended
        }, null, 2)}`);
      }
    });
  });
}

function renderPagination(page, pages, total, limit) {
  const nav = document.getElementById('pagination');
  if (pages <= 1) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  const controls = document.getElementById('page-controls');
  controls.innerHTML = '';
  const mk = (label, p, opts = {}) => {
    const b = document.createElement('button');
    b.className = `page-btn${opts.active ? ' active' : ''}`;
    b.textContent = label;
    b.disabled = !!opts.disabled;
    if (!opts.disabled) b.onclick = () => loadPage(p);
    return b;
  };
  controls.appendChild(mk('‹', page - 1, { disabled: page <= 1 }));
  const visible = new Set([1, pages]);
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) visible.add(i);
  let last = 0;
  for (const p of [...visible].sort((a, b) => a - b)) {
    if (p - last > 1) {
      const ell = document.createElement('span');
      ell.className = 'page-ellipsis';
      ell.textContent = '…';
      controls.appendChild(ell);
    }
    controls.appendChild(mk(String(p), p, { active: p === page }));
    last = p;
  }
  controls.appendChild(mk('›', page + 1, { disabled: page >= pages }));
}

// ─── Toolbar wiring ────────────────────────────────────────────
function initToolbar() {
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.expanded.clear();
    loadPage(1);
  });

  document.querySelectorAll('[data-region]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-region]').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.region = el.dataset.region;
      loadPage(1);
    });
  });

  document.getElementById('toggle-admin').addEventListener('click', (e) => {
    state.admin = !state.admin;
    e.currentTarget.classList.toggle('on', state.admin);
    document.body.classList.toggle('admin-mode', state.admin);
    document.getElementById('cheaters-chip-wrap').style.display = state.admin ? '' : 'none';
    if (!state.admin) state.cheatersOnly = false;
    loadPage(1);
  });

  document.getElementById('toggle-cheaters').addEventListener('click', (e) => {
    state.cheatersOnly = !state.cheatersOnly;
    e.currentTarget.classList.toggle('on', state.cheatersOnly);
    loadPage(1);
  });

  const search = document.getElementById('search');
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = search.value.trim();
      loadPage(1);
    }, 150);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initToolbar();
  loadPage(1);
});
