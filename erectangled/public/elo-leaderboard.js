/* elo-leaderboard.js — Shared ELO leaderboard for eRecTangled */
(function () {
    'use strict';

    var CACHE_TTL = 60000; // 60 seconds
    var _cache = null;
    var _cacheTime = 0;
    var _fetching = false;
    var _pending = [];

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

    function fetchEloLeaderboard(cb) {
        var now = Date.now();
        if (_cache && (now - _cacheTime) < CACHE_TTL) {
            if (cb) cb(_cache);
            return;
        }
        if (_fetching) {
            if (cb) _pending.push(cb);
            return;
        }
        _fetching = true;
        fetch('/api/elo/leaderboard', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (data) {
                _cache = data;
                _cacheTime = now;
                _fetching = false;
                var cbs = _pending.slice();
                _pending = [];
                cbs.forEach(function (fn) { fn(data); });
                if (cb) cb(data);
            })
            .catch(function () {
                _fetching = false;
                _pending = [];
                if (cb) cb({ ok: false, leaderboard: [] });
            });
    }

    function renderEloLeaderboard(containerId, opts) {
        opts = opts || {};
        var container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:8px">Loading rankings…</div>';
        fetchEloLeaderboard(function (data) {
            var board = data.leaderboard || data.players || [];
            var limit = opts.limit || 10;
            var rows = board.slice(0, limit).map(function (p, i) {
                var tier = getEloTier(p.elo || 1200);
                return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-radius:4px;font-size:0.78rem;">' +
                    '<span style="font-weight:600;">' + (i + 1) + '. ' + escapeHtml(p.nickname || p.identityKey || '?') + '</span>' +
                    '<span style="color:' + tier.color + ';font-weight:700;">' + (p.elo || 0) + ' ' + tier.name + '</span>' +
                '</div>';
            }).join('');
            if (!rows) rows = '<div style="color:var(--muted);font-size:0.8rem;padding:8px">No rated players yet.</div>';
            container.innerHTML = '<div style="font-weight:700;font-size:0.85rem;margin-bottom:4px;color:var(--text)">Top Rated Players</div>' + rows;
        });
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    window.EloLeaderboard = {
        fetch: fetchEloLeaderboard,
        render: renderEloLeaderboard,
        getTier: getEloTier
    };
})();
