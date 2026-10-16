/**
 * Word Mine — Admin Panel Controller
 */
(function () {
  'use strict';

  var socket = null;
  var authed = false;
  var adminKey = '';
  var state = null;
  var mines = [];

  function init() {
    var $ = function (id) { return document.getElementById(id); };

    // Auth
    $('auth-btn').addEventListener('click', function () {
      var key = $('admin-key').value.trim();
      if (!key) return;
      if (!socket || !socket.connected) {
        alert('Socket not connected yet — wait a moment and try again.');
        return;
      }
      socket.emit('admin-auth', key, function (resp) {
        if (resp && resp.ok) {
          authed = true;
          adminKey = key;
          $('auth-panel').style.display = 'none';
          $('admin-controls').style.display = '';
          loadMineList();
        } else {
          alert('Invalid admin key');
        }
      });
    });
    $('admin-key').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('auth-btn').click();
    });

    // Mine loading
    $('load-daily').addEventListener('click', function () {
      socket.emit('admin-load-mine', { type: 'daily' });
    });
    $('load-weekly').addEventListener('click', function () {
      socket.emit('admin-load-mine', { type: 'weekly' });
    });
    $('load-random').addEventListener('click', function () {
      socket.emit('admin-load-mine', { type: 'random' });
    });
    $('load-selected').addEventListener('click', function () {
      var id = $('mine-select').value;
      if (id) socket.emit('admin-load-mine', { type: 'pool', id: id });
    });

    // Game controls
    $('btn-start').addEventListener('click', function () {
      var timer = parseInt($('timer-input').value) || 0;
      socket.emit('admin-start', { timerSeconds: timer });
    });
    $('btn-pause').addEventListener('click', function () { socket.emit('admin-pause'); });
    $('btn-resume').addEventListener('click', function () { socket.emit('admin-resume'); });
    $('btn-end').addEventListener('click', function () { socket.emit('admin-end'); });

    // Socket
    socket = io();

    socket.on('connect', function () {
      console.log('[Admin] Socket connected');
      // Re-authenticate on reconnect
      if (authed && adminKey) {
        socket.emit('admin-auth', adminKey, function (resp) {
          if (resp && resp.ok) console.log('[Admin] Re-authenticated after reconnect');
          else console.warn('[Admin] Re-auth failed');
        });
      }
    });

    socket.on('game-state', function (s) {
      state = s;
      renderState();
    });

    socket.on('word-found', function (entry) {
      if (state) {
        state.foundWords[entry.word] = entry;
        state.foundCount = Object.keys(state.foundWords).length;
        state.depthProgress = entry.depthProgress || state.depthProgress;
      }
      renderState();
    });

    socket.on('depth-unlocked', function (data) {
      if (state) {
        state.currentDepth = data.depth;
        state.unlockedDepths = data.state.unlockedDepths;
        state.revealedBonusCount = data.revealedBonusCount;
      }
      renderState();
    });

    socket.on('game-started', function (s) { state = s; renderState(); });
    socket.on('game-ended', function (s) { state = s; renderState(); });
    socket.on('game-paused', function (s) { state = s; renderState(); });
    socket.on('game-resumed', function (s) { state = s; renderState(); });
  }

  function loadMineList() {
    fetch('/api/mines').then(function (r) { return r.json(); }).then(function (data) {
      mines = data || [];
      var sel = document.getElementById('mine-select');
      sel.innerHTML = '';
      for (var i = 0; i < mines.length; i++) {
        var opt = document.createElement('option');
        opt.value = mines[i].id;
        opt.textContent = '#' + (i + 1) + ' ' + mines[i].name + ' (' + mines[i].theme + ')';
        sel.appendChild(opt);
      }
    });
  }

  function renderState() {
    if (!state) return;
    var $ = function (id) { return document.getElementById(id); };

    $('game-status').textContent = state.status.toUpperCase();
    $('game-status').style.color =
      state.status === 'active' ? '#22c55e' :
      state.status === 'paused' ? '#f59e0b' :
      state.status === 'ended' ? '#ef4444' : 'var(--text-dim)';

    $('mine-info-text').textContent = state.mineName ?
      state.mineName + ' \u2014 ' + (state.foundCount || 0) + '/' + (state.totalWords || 0) + ' words' : '';

    $('admin-word-count').textContent = (state.foundCount || 0) + '/' + (state.totalWords || 0);

    // Depth tiers
    var tiersEl = $('admin-depth-tiers');
    tiersEl.innerHTML = '';
    if (state.depthTiers) {
      for (var i = 0; i < state.depthTiers.length; i++) {
        var tier = state.depthTiers[i];
        var isUnlocked = (state.unlockedDepths || []).indexOf(tier.id) >= 0;
        var isCurrent = tier.id === state.currentDepth;

        var row = document.createElement('div');
        row.className = 'depth-tier' + (!isUnlocked ? ' locked' : isCurrent ? ' current' : ' unlocked');

        var label = document.createElement('span');
        label.className = 'tier-label';
        label.style.color = tier.color;
        label.textContent = (isUnlocked ? '' : '\uD83D\uDD12 ') + tier.label;
        row.appendChild(label);

        var progWrap = document.createElement('div');
        progWrap.className = 'tier-progress';
        var bar = document.createElement('div');
        bar.className = 'tier-progress-bar';
        bar.style.background = tier.color;
        var threshold = (state.depthThresholds || {})[tier.id];
        var prog = (state.depthProgress || {})[tier.id] || 0;
        if (!isUnlocked) bar.style.width = '0%';
        else if (threshold && isCurrent) bar.style.width = Math.min(100, (prog / threshold) * 100) + '%';
        else bar.style.width = isUnlocked ? '100%' : '0%';
        progWrap.appendChild(bar);
        row.appendChild(progWrap);

        var count = document.createElement('span');
        count.className = 'tier-count';
        if (threshold && isCurrent) count.textContent = prog + '/' + threshold;
        row.appendChild(count);

        tiersEl.appendChild(row);
      }
    }

    // Leaderboard
    var lb = $('admin-leaderboard');
    lb.innerHTML = '';
    var players = state.players || {};
    var sorted = Object.entries(players).sort(function (a, b) { return b[1].totalXP - a[1].totalXP; });
    for (var j = 0; j < sorted.length; j++) {
      var p = sorted[j][1];
      var row = document.createElement('div');
      row.className = 'found-word-row';
      row.innerHTML = '<span class="found-word-text">' + (j + 1) + '. ' + esc(p.displayName) +
        ' <small style="color:var(--text-dim)">' + p.wordsFound + 'w / ' + p.deepestTier + '</small></span>' +
        '<span class="found-word-xp">\u2726' + p.totalXP + '</span>';
      lb.appendChild(row);
    }
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
