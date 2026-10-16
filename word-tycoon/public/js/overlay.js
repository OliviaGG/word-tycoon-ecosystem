// ==================== DATA LAYER ====================
// Primary: HTTP fetch polling every 3s (bulletproof in OBS CEF)
// Secondary: Socket.IO for real-time events only (bubbles, toasts, ticker)

const socket = io({ reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 10000, reconnectionAttempts: Infinity, transports: ['polling', 'websocket'] });

// State
let topTappers = [];
let topEarners = [];
let playerEmpires = [];
let shopItems = [];
let tapUpgrades = [];
let showingTappers = true;
let leaderboardRotateInterval = null;
let tickerItems = [];
let lastEmpiresJson = '';
let lastLeaderboardJson = '';

// Data version tracking — triggers re-fetch when server state changes
let knownDataVersion = 0;

// DOM refs
const leaderboardTitleEl = document.getElementById('leaderboard-title');
const leaderboardListEl = document.getElementById('leaderboard-list');
const empiresListEl = document.getElementById('empires-list');
const shopListEl = document.getElementById('shop-list');
const tickerTrackEl = document.getElementById('ticker-track');
const upgradesListEl = document.getElementById('upgrades-list');
const toastContainerEl = document.getElementById('toast-container');

// ==================== FETCH POLLING (primary data source) ====================

function applyState(state) {
  if (!state) return;
  topTappers = state.topTappers || [];
  topEarners = state.topEarners || [];
  playerEmpires = state.playerEmpires || [];
  if (state.dataVersion && state.dataVersion !== knownDataVersion) {
    knownDataVersion = state.dataVersion;
    if (state.shopItems) { shopItems = state.shopItems; renderShop(); }
    if (state.tapUpgrades) { tapUpgrades = state.tapUpgrades; renderTapUpgrades(); }
    fetchCosmeticsShop();
  } else {
    if (state.shopItems && shopItems.length === 0) { shopItems = state.shopItems; renderShop(); }
    if (state.tapUpgrades && tapUpgrades.length === 0) { tapUpgrades = state.tapUpgrades; renderTapUpgrades(); }
  }
  // Always force re-render (no de-dup on poll — data freshness is guaranteed)
  lastEmpiresJson = '';
  lastLeaderboardJson = '';
  renderLeaderboard();
  renderEmpires();

  if (state.recentEvents && state.recentEvents.length > 0) {
    tickerItems = state.recentEvents.slice(0, 15).reverse().map(e => formatTickerText(e));
    rebuildTicker();
  }
}

function pollState() {
  fetch('/api/state')
    .then(r => r.json())
    .then(applyState)
    .catch(err => console.warn('[Overlay] Fetch failed:', err.message));
}

// Fetch immediately on page load — no waiting for Socket.IO
pollState();
fetchCosmeticsShop();

// Poll every 3 seconds — completely independent of Socket.IO
setInterval(pollState, 3000);

// ==================== SOCKET.IO (real-time events only) ====================

socket.on('connect', () => {
  console.log('[Overlay] Socket connected (used for events only)');
  // Start leaderboard rotation on connect
  if (!leaderboardRotateInterval) {
    leaderboardRotateInterval = setInterval(() => {
      const panel = document.getElementById('leaderboard-panel');
      if (!panel) return;
      panel.classList.add('switching');
      setTimeout(() => {
        showingTappers = !showingTappers;
        renderLeaderboard(true);
        panel.classList.remove('switching');
      }, 200);
    }, 10000);
  }
  // Init AUX audio on connect
  if (window.AuxAudio) {
    AuxAudio.init().then(() => {
      console.log('[Overlay] AUX Audio ready, live audio:', AuxAudio.isAudioActive());
    });
  }
});

socket.on('disconnect', () => {
  console.log('[Overlay] Socket disconnected (fetch polling continues)');
  if (leaderboardRotateInterval) {
    clearInterval(leaderboardRotateInterval);
    leaderboardRotateInterval = null;
  }
});

// Real-time events — these only work via Socket.IO
socket.on('ticker-event', (event) => {
  const text = formatTickerText(event);
  if (text) addTickerItem(text, event.type);
});

socket.on('command-response', (data) => {
  showToast(data.user, data.response, data.ok);
});

socket.on('income-bubbles', (bubbles) => {
  if (bubbles && bubbles.length > 0) spawnIncomeBubbles(bubbles);
});

// data-refresh triggers an immediate poll instead of waiting for next 3s cycle
socket.on('data-refresh', (data) => {
  if (data && data.version) knownDataVersion = data.version;
  pollState();
  fetchCosmeticsShop();
});

// ==================== PLAYER EMPIRES (D3 Treemap) ====================

var EMPIRE_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#6366f1','#a855f7','#ec4899','#f43f5e',
  '#84cc16','#06b6d4','#8b5cf6','#d946ef','#f59e0b'
];

function renderEmpires() {
  if (!playerEmpires || playerEmpires.length === 0) {
    d3.select(empiresListEl).selectAll('*').remove();
    empiresListEl.innerHTML = '<div class="empty-state">No empires yet \u2014 type !play to start</div>';
    lastEmpiresJson = '';
    return;
  }

  var json = JSON.stringify(playerEmpires);
  if (json === lastEmpiresJson) return;
  lastEmpiresJson = json;

  var W = 390;
  var H = Math.min(540, Math.max(160, playerEmpires.length * 50));

  // Build flat hierarchy — each leaf = one player, sized by income
  var treeData = {
    name: 'root',
    children: playerEmpires.map(function(e, i) {
      return {
        name: e.name || 'Anonymous',
        coins: e.coins || 0,
        incomePerSec: e.incomePerSec || 0,
        businesses: e.businesses || [],
        value: Math.max(e.incomePerSec || 0.1, 0.1),
        idx: i
      };
    })
  };

  var root = d3.hierarchy(treeData).sum(function(d) { return d.value; })
    .sort(function(a, b) { return b.value - a.value; });
  d3.treemap().size([W, H]).padding(3).round(true)(root);

  // Create or reuse SVG
  var svg = d3.select(empiresListEl).select('svg.emp-treemap');
  if (svg.empty()) {
    empiresListEl.innerHTML = '';
    svg = d3.select(empiresListEl).append('svg').attr('class', 'emp-treemap');
  }
  svg.attr('width', W).attr('height', H);

  var cells = svg.selectAll('g.emp-cell').data(root.leaves(), function(d) { return d.data.name; });

  // EXIT
  cells.exit().transition().duration(400).style('opacity', 0).remove();

  // ENTER
  var enter = cells.enter().append('g').attr('class', 'emp-cell').style('opacity', 0);
  enter.append('rect').attr('class', 'emp-cell-rect').attr('rx', 6);
  enter.append('text').attr('class', 'emp-cell-name');
  enter.append('text').attr('class', 'emp-cell-coins');
  enter.append('text').attr('class', 'emp-cell-biz');
  enter.append('text').attr('class', 'emp-cell-income');

  // MERGE
  var merged = enter.merge(cells);
  merged.transition().duration(600).ease(d3.easeCubicOut).style('opacity', 1);

  // Animate cell rectangles
  merged.select('.emp-cell-rect')
    .transition().duration(600).ease(d3.easeCubicOut)
    .attr('x', function(d) { return d.x0; })
    .attr('y', function(d) { return d.y0; })
    .attr('width', function(d) { return Math.max(0, d.x1 - d.x0); })
    .attr('height', function(d) { return Math.max(0, d.y1 - d.y0); })
    .attr('fill', function(d) { return EMPIRE_COLORS[d.data.idx % EMPIRE_COLORS.length]; })
    .attr('fill-opacity', 0.3)
    .attr('stroke', function(d) { return EMPIRE_COLORS[d.data.idx % EMPIRE_COLORS.length]; })
    .attr('stroke-opacity', 0.6)
    .attr('stroke-width', 1.5);

  // Update text labels per cell
  merged.each(function(d) {
    var g = d3.select(this);
    var w = d.x1 - d.x0;
    var h = d.y1 - d.y0;
    var px = d.x0 + 5;
    var py = d.y0;

    // Player name
    g.select('.emp-cell-name')
      .attr('x', px).attr('y', py + 15)
      .text(w < 45 ? (d.data.name).charAt(0) : d.data.name.substring(0, Math.floor(w / 7)))
      .style('font-size', '11px').style('font-weight', '700').style('fill', '#fff')
      .style('font-family', 'Inter, sans-serif');

    // Coins (animated tween)
    g.select('.emp-cell-coins').each(function() {
      var el = d3.select(this);
      el.attr('x', px).attr('y', py + 27);
      if (w < 50) { el.text(''); return; }
      var prev = parseFloat(el.attr('data-val')) || 0;
      var next = d.data.coins;
      el.attr('data-val', next);
      if (Math.abs(prev - next) < 0.5) { el.text(formatNumber(next)); return; }
      el.transition().duration(600).tween('text', function() {
        var interp = d3.interpolateNumber(prev, next);
        return function(t) { this.textContent = formatNumber(interp(t)); };
      });
    })
    .style('font-size', '9px').style('font-weight', '600')
    .style('fill', 'rgba(255,170,0,0.8)').style('font-family', 'Inter, sans-serif');

    // Business emojis
    g.select('.emp-cell-biz')
      .attr('x', px).attr('y', py + (h > 55 ? 41 : 39))
      .text(w < 30 || h < 40 ? '' : d.data.businesses.map(function(b) { return b.emoji; }).join(''))
      .style('font-size', '11px');

    // Income rate (top-right of cell)
    g.select('.emp-cell-income')
      .attr('x', d.x1 - 4).attr('y', py + 15)
      .attr('text-anchor', 'end')
      .text(w < 80 ? '' : '+' + formatNumber(d.data.incomePerSec, 1) + '/s')
      .style('font-size', '9px').style('font-weight', '700')
      .style('fill', '#4CAF50').style('font-family', 'Inter, sans-serif');
  });
}

// ==================== SHOP ====================

function renderShop() {
  if (!shopItems || shopItems.length === 0) return;

  shopListEl.innerHTML = shopItems.map(item => {
    const costStr = item.playtimeUpgrade ? 'FREE' : (item.cost === 0 ? 'FREE' : formatNumber(item.cost));
    const costClass = (item.cost === 0 || item.playtimeUpgrade) ? 'free' : '';
    const detail = item.playtimeUpgrade
      ? `<span class="shop-income-val">+${formatNumber(item.incomePerSec, 1)}/sec</span> &middot; Levels up via playtime`
      : `<span class="shop-income-val">+${formatNumber(item.incomePerSec, 1)}/sec</span> &middot; !buy ${item.type}`;
    return `
      <div class="shop-row">
        <span class="shop-emoji">${item.emoji}</span>
        <div class="shop-info">
          <div class="shop-name">${escapeHtml(item.name)}</div>
          <div class="shop-detail">${detail}</div>
        </div>
        <span class="shop-cost ${costClass}">${costStr}</span>
      </div>
    `;
  }).join('');
}

// ==================== TAP UPGRADES ====================

const UPGRADE_EMOJIS = { tap: '\u26A1', crit: '\uD83C\uDFAF', multi: '\u2728' };

function renderTapUpgrades() {
  if (!tapUpgrades || tapUpgrades.length === 0) return;

  upgradesListEl.innerHTML = tapUpgrades.map(u => {
    const emoji = UPGRADE_EMOJIS[u.key] || '\u2B50';
    return `
      <div class="upgrade-row">
        <span class="upgrade-emoji">${emoji}</span>
        <div class="upgrade-info">
          <div class="upgrade-name">${escapeHtml(u.name)}</div>
          <div class="upgrade-desc">${escapeHtml(u.desc)} &middot; !upgrade ${u.key}</div>
        </div>
        <span class="upgrade-cost">${formatNumber(u.baseCost)}</span>
      </div>
    `;
  }).join('');
}

// ==================== LEADERBOARD (D3 Bar Chart) ====================

let lbSvg = null;

function renderLeaderboard(force) {
  const data = showingTappers ? topTappers : topEarners;
  const title = showingTappers ? 'TOP TAPPERS' : 'TOP EARNERS';
  leaderboardTitleEl.textContent = title;

  if (!data || data.length === 0) {
    if (lbSvg) lbSvg.selectAll('.lb-bar-g').remove();
    else leaderboardListEl.innerHTML = '<div class="empty-state">No players yet</div>';
    lastLeaderboardJson = '';
    return;
  }

  const json = JSON.stringify({ showing: showingTappers, data });
  if (!force && json === lastLeaderboardJson) return;
  lastLeaderboardJson = json;

  // Initialize SVG once
  if (!lbSvg) {
    leaderboardListEl.innerHTML = '';
    lbSvg = d3.select(leaderboardListEl).append('svg').attr('class', 'lb-svg');
  }

  var W = 220, ROW_H = 30, BAR_X = 28;
  var totalH = data.length * ROW_H;
  lbSvg.attr('width', W).attr('height', totalH);

  var maxVal = d3.max(data, function(d) {
    return showingTappers ? (d.total_taps || 0) : (d.coins || 0);
  }) || 1;
  var xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W - BAR_X - 55]);

  // Data join keyed by player identity
  var rows = lbSvg.selectAll('.lb-bar-g')
    .data(data, function(d, i) { return d.display_name || d.id || ('p' + i); });

  // EXIT
  rows.exit().transition().duration(400).style('opacity', 0).remove();

  // ENTER
  var enter = rows.enter().append('g').attr('class', 'lb-bar-g')
    .attr('transform', function(d, i) { return 'translate(0,' + (i * ROW_H) + ')'; })
    .style('opacity', 0);

  enter.append('rect').attr('class', 'lb-bar-rect')
    .attr('x', BAR_X).attr('y', 3).attr('height', ROW_H - 6).attr('rx', 4).attr('width', 0);

  enter.append('text').attr('class', 'lb-rank-t')
    .attr('x', 14).attr('y', ROW_H / 2)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
    .style('font-size', '13px').style('font-weight', '900')
    .style('font-family', 'Inter, sans-serif');

  enter.append('text').attr('class', 'lb-name-t')
    .attr('x', BAR_X + 6).attr('y', ROW_H / 2)
    .attr('dominant-baseline', 'central')
    .style('font-size', '12px').style('font-weight', '600').style('fill', '#fff')
    .style('font-family', 'Inter, sans-serif');

  enter.append('text').attr('class', 'lb-val-t')
    .attr('x', W - 2).attr('y', ROW_H / 2)
    .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
    .style('font-size', '12px').style('font-weight', '700')
    .style('fill', 'rgba(255,170,0,0.9)')
    .style('font-family', 'Inter, sans-serif');

  // MERGE enter + update
  var merged = enter.merge(rows);

  // Animate rank position changes
  merged.transition().duration(600).ease(d3.easeCubicOut)
    .attr('transform', function(d, i) { return 'translate(0,' + (i * ROW_H) + ')'; })
    .style('opacity', 1);

  // Animate bar width
  merged.select('.lb-bar-rect')
    .transition().duration(600).ease(d3.easeCubicOut)
    .attr('width', function(d) {
      return Math.max(4, xScale(showingTappers ? (d.total_taps || 0) : (d.coins || 0)));
    })
    .attr('fill', function(d, i) {
      return i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#6366f1';
    })
    .attr('fill-opacity', function(d, i) { return i < 3 ? 0.5 : 0.25; });

  // Rank number
  merged.select('.lb-rank-t')
    .text(function(d, i) { return i + 1; })
    .style('fill', function(d, i) {
      return i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'rgba(255,255,255,0.4)';
    });

  // Player name
  merged.select('.lb-name-t')
    .text(function(d) {
      var n = d.display_name || 'Anonymous';
      return n.length > 12 ? n.substring(0, 11) + '\u2026' : n;
    });

  // Animated value counter (D3 tween)
  merged.select('.lb-val-t').each(function(d) {
    var el = d3.select(this);
    var prev = parseFloat(el.attr('data-val')) || 0;
    var next = showingTappers ? (d.total_taps || 0) : (d.coins || 0);
    el.attr('data-val', next);
    if (Math.abs(prev - next) < 0.5) { el.text(formatNumber(next)); return; }
    el.transition().duration(600).tween('text', function() {
      var interp = d3.interpolateNumber(prev, next);
      return function(t) { this.textContent = formatNumber(interp(t)); };
    });
  });
}

// Leaderboard rotation started via socket 'connect' handler above
// Also start it immediately in case socket never connects
if (!leaderboardRotateInterval) {
  leaderboardRotateInterval = setInterval(() => {
    const panel = document.getElementById('leaderboard-panel');
    if (!panel) return;
    panel.classList.add('switching');
    setTimeout(() => {
      showingTappers = !showingTappers;
      renderLeaderboard(true);
      panel.classList.remove('switching');
    }, 200);
  }, 10000);
}

// ==================== TICKER ====================

function formatTickerText(event) {
  if (!event) return null;
  const name = event.playerName || 'Someone';

  switch (event.type) {
    case 'join':
      return { text: `${name} joined the game!`, type: 'join', player: name };
    case 'buy':
      return { text: `${name} ${event.detail || 'bought a business'}`, type: 'buy', player: name };
    case 'levelup': {
      const d = typeof event.detail === 'string' ? event.detail : '';
      return { text: `${name} upgraded ${d}`, type: 'levelup', player: name };
    }
    case 'collect': {
      const d = typeof event.detail === 'string' ? event.detail : '';
      return { text: `${name} ${d}`, type: 'collect', player: name };
    }
    case 'upgrade': {
      const d = typeof event.detail === 'string' ? event.detail : '';
      return { text: `${name} upgraded ${d}`, type: 'upgrade', player: name };
    }
    case 'reward': {
      const d = typeof event.detail === 'string' ? event.detail : '';
      return { text: `${name} ${d}`, type: 'reward', player: name };
    }
    default:
      return { text: `${name} did something cool!`, type: 'default', player: name };
  }
}

function addTickerItem(item, type) {
  if (!item) return;
  tickerItems.push(item);
  if (tickerItems.length > 30) tickerItems.shift();
  rebuildTicker();
}

function rebuildTicker() {
  if (tickerItems.length === 0) {
    tickerTrackEl.innerHTML = '<span class="ticker-item">Welcome to Word Tycoon! Type !help to get started.</span>';
    return;
  }

  const items = [...tickerItems, ...tickerItems];
  tickerTrackEl.innerHTML = items.map(item => {
    const dotClass = item.type || 'default';
    const player = item.player || '';
    const detail = player ? item.text.split(player).slice(1).join(player).trim() : item.text.trim();
    return `<span class="ticker-item"><span class="ticker-dot ${dotClass}"></span><span class="ticker-player">${escapeHtml(player)}</span>${escapeHtml(detail)}</span>`;
  }).join('');

  const trackWidth = tickerTrackEl.scrollWidth;
  const duration = Math.max(15, trackWidth / 80);
  tickerTrackEl.style.animationDuration = duration + 's';
}

rebuildTicker();

// ==================== TOASTS ====================

function showToast(user, message, ok = true) {
  const toast = document.createElement('div');
  toast.className = `toast ${ok ? '' : 'toast-error'}`;
  toast.innerHTML = `<span class="toast-user">${escapeHtml(user)}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
  toastContainerEl.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);

  while (toastContainerEl.children.length > 5) {
    toastContainerEl.removeChild(toastContainerEl.firstChild);
  }
}

// ==================== COSMETICS TAB ====================

const cosmeticsPanelEl = document.getElementById('cosmetics-panel');
const cosTabBarEl = document.getElementById('cos-tab-bar');
const cosmeticsListEl = document.getElementById('cosmetics-list');
let cosmeticsData = null;
let activeCosTab = 'aux'; // Default to AUX tab

const COS_TAB_NAMES = {
  aux: 'AUX',
  sets: '\u{1F9E9} Sets',
  word_color: 'Colors',
  word_glow: 'Glows',
  profile_border: 'Borders',
  profile_glow: 'Auras',
  name_glow: 'Name Glow',
  name_color: 'Name Color',
  title: 'Titles',
  win_effect: 'Effects'
};

let setsData = null;

const RARITY_DOT_COLORS = {
  common: '#c0c0c0', uncommon: '#5fd65f', rare: '#5aafff',
  epic: '#c45aff', legendary: '#ffbb33', ultra: '#ff5555', aux: '#00ffcc'
};

// AUX preview content per category
const AUX_PREVIEW = {
  word_color: 'ABC', word_glow: 'Glow', name_color: 'Aa', name_glow: 'Glow',
  profile_border: '', profile_glow: '', title: '', win_effect: 'BOOM'
};

function fetchCosmeticsShop() {
  fetch('/api/cosmetics/shop')
    .then(r => r.json())
    .then(data => {
      cosmeticsData = data;
      buildCosmeticsPanel();
    })
    .catch(() => {});
  // Also fetch sets data
  fetch('/api/cosmetics/sets')
    .then(r => r.json())
    .then(data => {
      setsData = data.sets || {};
      if (activeCosTab === 'sets') buildCosmeticsPanel();
    })
    .catch(() => {});
}

function buildCosmeticsPanel() {
  if (!cosmeticsData) return;

  // Unregister previous AUX elements before rebuilding
  if (window.AuxAudio) AuxAudio.unregisterAll();

  // Build tab bar: AUX first, then Sets, then categories
  const tabs = ['aux', 'sets', ...Object.keys(cosmeticsData)];
  cosTabBarEl.innerHTML = tabs.map(tab => {
    const isAux = tab === 'aux';
    const name = COS_TAB_NAMES[tab] || tab;
    const activeClass = tab === activeCosTab ? ' active' : '';
    const auxClass = isAux ? ' aux-tab' : '';
    return `<div class="cos-tab${activeClass}${auxClass}" data-tab="${tab}">${name}</div>`;
  }).join('');

  // Tab click handlers
  cosTabBarEl.querySelectorAll('.cos-tab').forEach(el => {
    el.addEventListener('click', () => {
      activeCosTab = el.dataset.tab;
      buildCosmeticsPanel();
    });
  });

  // Render items for active tab
  renderCosmeticsTab(activeCosTab);
  cosmeticsPanelEl.classList.add('active');

  // Register AUX preview elements with audio-reactive engine
  if (window.AuxAudio) {
    requestAnimationFrame(() => {
      cosmeticsListEl.querySelectorAll('[data-aux-profile]').forEach(el => {
        AuxAudio.registerElement(el, el.dataset.auxProfile);
      });
    });
  }
}

function renderCosmeticsTab(tab) {
  // Sets tab — special render
  if (tab === 'sets') {
    renderSetsTab();
    return;
  }

  let items = [];

  if (tab === 'aux') {
    // Collect all AUX items across categories
    for (const cat of Object.keys(cosmeticsData)) {
      const catItems = cosmeticsData[cat] || [];
      items.push(...catItems.filter(i => i.rarity === 'aux'));
    }
  } else {
    items = cosmeticsData[tab] || [];
  }

  if (items.length === 0) {
    cosmeticsListEl.innerHTML = '<div class="empty-state">No items</div>';
    return;
  }

  cosmeticsListEl.innerHTML = items.map(item => {
    const isAux = item.rarity === 'aux';
    const dotColor = RARITY_DOT_COLORS[item.rarity] || '#9d9d9d';
    const dotClass = isAux ? 'cos-rarity-dot aux' : 'cos-rarity-dot';
    const nameClass = isAux ? 'cos-item-name aux-name' : 'cos-item-name';
    const costStr = formatNumber(item.cost);

    let buffStr = '';
    if (item.buffs) {
      buffStr = item.buffs.map(b => b.label).join(', ');
    } else if (item.buff) {
      buffStr = item.buff.label;
    }

    const audioBadge = isAux ? '<span class="cos-audio-badge">AUX</span>' : '';

    // AUX items get a live audio-reactive preview swatch
    let previewHtml = '';
    if (isAux) {
      const cat = item.category || '';
      const isCircle = cat === 'profile_border' || cat === 'profile_glow';
      const previewText = AUX_PREVIEW[cat] || item.name;
      if (cat === 'title') {
        previewHtml = `<span class="cos-aux-preview" data-aux-profile="${item.id}">[${escapeHtml(item.css && item.css.title ? item.css.title : item.name)}]</span>`;
      } else if (isCircle) {
        previewHtml = `<span class="cos-aux-preview cos-aux-preview-circle" data-aux-profile="${item.id}"></span>`;
      } else {
        previewHtml = `<span class="cos-aux-preview" data-aux-profile="${item.id}">${escapeHtml(previewText)}</span>`;
      }
    }

    return `<div class="cos-item${isAux ? ' cos-item-aux' : ''}">
      ${isAux ? previewHtml : `<span class="${dotClass}" style="background: ${dotColor}"></span>`}
      <span class="${nameClass}">${escapeHtml(item.name)}</span>
      ${audioBadge}
      <span class="cos-item-buff">${escapeHtml(buffStr)}</span>
      <span class="cos-item-cost">${costStr}</span>
    </div>`;
  }).join('');
}

function renderSetsTab() {
  if (!setsData || Object.keys(setsData).length === 0) {
    cosmeticsListEl.innerHTML = '<div class="empty-state">Loading sets...</div>';
    return;
  }

  cosmeticsListEl.innerHTML = Object.entries(setsData).map(([key, s]) => {
    const dotColor = RARITY_DOT_COLORS[s.rarity] || '#9d9d9d';
    const costStr = s.giftSet
      ? formatNumber(s.totalCost) + ' gift coins'
      : formatNumber(s.totalCost) + ' coins';
    const rarLabel = s.rarity.charAt(0).toUpperCase() + s.rarity.slice(1);
    const giftBadge = s.giftSet ? '<span class="cos-audio-badge" style="background:#e53e3e">GIFT</span>' : '';

    return `<div class="cos-item">
      <span class="cos-rarity-dot" style="background: ${dotColor}"></span>
      <span class="cos-item-name">${escapeHtml(s.name)}</span>
      ${giftBadge}
      <span class="cos-item-buff">${rarLabel} \u2022 ${escapeHtml(s.setBonusLabel)}</span>
      <span class="cos-item-cost">${costStr}</span>
    </div>`;
  }).join('');
}

// ==================== UTILITIES ====================

function formatNumber(num, decimals) {
  if (num === undefined || num === null) return '0';
  num = Number(num);
  if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e4) return (num / 1e3).toFixed(1) + 'K';
  if (decimals !== undefined) return num.toFixed(decimals);
  return Math.floor(num).toLocaleString();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== INCOME BUBBLES (D3 Force Simulation) ====================

var bubbleContainerEl = document.getElementById('bubble-container');
var AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'
];
var MAX_BUBBLES = 30;
var bubbleNodes = [];
var bubbleSim = null;

function getAvatarColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Custom upward drift force for D3 simulation
function createUpwardForce(strength) {
  var nodes;
  function force() {
    for (var i = 0; i < nodes.length; i++) nodes[i].vy -= strength;
  }
  force.initialize = function(n) { nodes = n; };
  return force;
}

function initBubbleSim() {
  if (bubbleSim) return;
  bubbleSim = d3.forceSimulation(bubbleNodes)
    .force('collide', d3.forceCollide().radius(function(d) { return d.r + 6; }).strength(0.6).iterations(2))
    .force('up', createUpwardForce(0.2))
    .velocityDecay(0.12)
    .alphaDecay(0)
    .on('tick', function() {
      var vp = window.__gameViewport || { width: 1920, height: 1080 };
      for (var i = 0; i < bubbleNodes.length; i++) {
        var n = bubbleNodes[i];
        if (!n.el) continue;
        // Keep bubbles within the middle zone (avoid side panels)
        n.x = Math.max(n.r + 380, Math.min(vp.width - 380 - n.r, n.x));
        n.el.style.transform = 'translate(' + (n.x - n.r) + 'px,' + (n.y - n.r) + 'px)';
      }
    });
  bubbleSim.stop(); // Don't run until bubbles exist
}

function spawnIncomeBubbles(bubbles) {
  initBubbleSim();
  for (var i = 0; i < bubbles.length; i++) {
    var b = bubbles[i];
    if (!b.coins || b.coins <= 0) continue;
    (function(bb, delay) {
      setTimeout(function() { spawnSingleBubble(bb); }, delay);
    })(b, i * 150);
  }
}

function spawnSingleBubble(data) {
  initBubbleSim();

  // Cap max bubbles on screen
  while (bubbleNodes.length >= MAX_BUBBLES) {
    var old = bubbleNodes.shift();
    if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }

  var vp = window.__gameViewport || { width: 1920, height: 1080 };
  var xPos = 450 + Math.random() * (vp.width - 900);

  var bubble = document.createElement('div');
  bubble.className = 'income-bubble d3-bubble';

  var name = data.name || '?';
  var letter = name.charAt(0).toUpperCase();
  var color = getAvatarColor(name);
  var coinStr = '+' + formatNumber(data.coins);

  var avatarHtml;
  if (data.pic) {
    avatarHtml = '<img class="bubble-avatar bubble-avatar-img" src="' + escapeHtml(data.pic) + '" alt="" onerror="this.outerHTML=\'<div class=\\\'bubble-avatar\\\' style=\\\'background:' + color + '\\\'>' + escapeHtml(letter) + '</div>\'">';
  } else {
    avatarHtml = '<div class="bubble-avatar" style="background:' + color + '">' + escapeHtml(letter) + '</div>';
  }

  bubble.innerHTML = avatarHtml + '<span class="bubble-coins">' + escapeHtml(coinStr) + '</span>';
  bubble.style.opacity = '0';
  bubbleContainerEl.appendChild(bubble);

  // Fade in
  requestAnimationFrame(function() {
    bubble.style.transition = 'opacity 0.5s ease-out';
    bubble.style.opacity = '1';
  });

  // Add to D3 force simulation
  var node = { x: xPos, y: vp.height + 40, r: 26, el: bubble };
  bubbleNodes.push(node);
  bubbleSim.nodes(bubbleNodes);
  bubbleSim.restart();

  // Remove after duration (float time)
  var dur = 8000 + Math.random() * 4000;
  (function(bbl, nd) {
    setTimeout(function() {
      bbl.style.transition = 'opacity 1s ease-in';
      bbl.style.opacity = '0';
      setTimeout(function() {
        if (bbl.parentNode) bbl.parentNode.removeChild(bbl);
        var idx = bubbleNodes.indexOf(nd);
        if (idx !== -1) {
          bubbleNodes.splice(idx, 1);
          bubbleSim.nodes(bubbleNodes);
          if (bubbleNodes.length === 0) bubbleSim.stop();
        }
      }, 1000);
    }, dur);
  })(bubble, node);
}
