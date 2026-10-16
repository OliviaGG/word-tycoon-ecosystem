/* top-player-cards.js — Shared top-3 player cards with cosmetics */
(function () {
    'use strict';

    var COSMETIC_LAYER_SELECTOR = '.tp-cosmetic-layer';
    var cosCache = new Map();
    var COS_TTL = 60000;

    /** Extract the brightest hex color from a gradient string for border theming */
    function extractBadgeColor(bg) {
        if (!bg) return null;
        var colors = bg.match(/#[0-9a-fA-F]{6}/g);
        if (!colors || !colors.length) return null;
        // Pick the brightest color (highest sum of RGB) — skip very dark stops
        var best = null, bestBright = 0;
        for (var i = 0; i < colors.length; i++) {
            var r = parseInt(colors[i].substr(1, 2), 16);
            var g = parseInt(colors[i].substr(3, 2), 16);
            var b = parseInt(colors[i].substr(5, 2), 16);
            var bright = r + g + b;
            if (bright > bestBright) { bestBright = bright; best = colors[i]; }
        }
        return best;
    }

    function invalidateCosmetics(platform, userId, equipped) {
        var key = platform + ':' + userId;
        if (equipped) cosCache.set(key, { data: equipped, expiresAt: Date.now() + COS_TTL });
        else cosCache.delete(key);
    }

    function getHubAssetBase() {
        var host = (window.location && window.location.hostname) || '';
        return (host === 'localhost' || host === '127.0.0.1')
            ? 'http://localhost:3000'
            : 'https://wordtycoon.live';
    }

    function resolveCosmeticAsset(asset) {
        if (!asset) return '';
        if (/^https?:\/\//i.test(asset)) return asset;
        if (asset.charAt(0) === '/') return getHubAssetBase() + asset;
        return getHubAssetBase() + '/' + asset;
    }

    function clearRenderLayers(host) {
        if (!host || !host.querySelectorAll) return;
        host.querySelectorAll(COSMETIC_LAYER_SELECTOR).forEach(function (node) { node.remove(); });
    }

    function buildRenderLayer(render, kind) {
        if (!render || !render.type) return null;
        var layer = document.createElement('span');
        layer.className = 'tp-cosmetic-layer tp-cosmetic-layer--' + kind + ' tp-cosmetic-layer--' + render.type;
        layer.setAttribute('aria-hidden', 'true');
        if (render.asset) {
            var assetUrl = resolveCosmeticAsset(render.asset);
            layer.style.backgroundImage = 'url("' + assetUrl.replace(/"/g, '\\"') + '")';
        }
        if (render.opacity != null) layer.style.opacity = String(render.opacity);
        if (render.blend) layer.style.mixBlendMode = render.blend;
        if (render.backgroundSize) layer.style.backgroundSize = render.backgroundSize;
        if (render.backgroundPosition) layer.style.backgroundPosition = render.backgroundPosition;
        if (render.backgroundRepeat) layer.style.backgroundRepeat = render.backgroundRepeat;
        if (render.animation) layer.style.animation = render.animation;
        return layer;
    }

    function applyRenderLayer(host, item, kind) {
        if (!host || !item || !item.render) return;
        var layer = buildRenderLayer(item.render, kind);
        if (!layer) return;
        if (kind === 'surface') host.prepend(layer);
        else host.appendChild(layer);
    }

    function getCosmetics(platform, userId) {
        var key = platform + ':' + userId;
        var cached = cosCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
        return fetch('/api/cosmetics/' + encodeURIComponent(platform) + '/' + encodeURIComponent(userId))
            .then(function (r) { return r.ok ? r.json() : { equipped: {} }; })
            .then(function (d) {
                var data = d.equipped || {};
                cosCache.set(key, { data: data, expiresAt: Date.now() + COS_TTL });
                return data;
            })
            .catch(function () { return cached ? cached.data : {}; });
    }

    function renderTopPlayerCards(containerId, players) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var top3 = (players || []).slice(0, 3);
        var ranks = ['gold', 'silver', 'bronze'];
        container.innerHTML = top3.map(function (p, i) {
            var name = p.displayName || p.name || '?';
            var score = (p.score || 0).toLocaleString();
            // Sanitize double-URL PFPs and build Discord default if missing
            var pfp = p.profileImage || '';
            if (pfp) { var d = pfp.indexOf('https://', 8); if (d > 0) pfp = pfp.substring(d); }
            if (!pfp && p.platformUserId && (p.platform === 'web' || p.platform === 'discord')) {
                pfp = 'https://cdn.discordapp.com/embed/avatars/' + (parseInt(p.platformUserId.slice(-1)) % 5) + '.png';
            }
            var rank = ranks[i];
            var plat = (p.platform || '').replace(/"/g, '&quot;');
            var uid = (p.platformUserId || '').replace(/"/g, '&quot;');
            var avatarHtml = pfp
                ? '<img class="tp-avatar" src="' + pfp.replace(/"/g, '&quot;') + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
                + '<div class="tp-fallback" style="display:none">' + name.charAt(0).toUpperCase() + '</div>'
                : '<div class="tp-fallback">' + name.charAt(0).toUpperCase() + '</div>';
            return '<div class="tp-card ' + rank + '" data-platform="' + plat + '" data-userid="' + uid + '"><div class="tp-pfp">' + avatarHtml + '</div><div class="tp-info"><span class="tp-name">' + name.replace(/</g, '&lt;') + '</span><span class="tp-score">' + score + 'pts</span></div></div>';
        }).join('');
        // Fetch and apply cosmetics
        top3.forEach(function (p, i) {
            if (!p.platform || !p.platformUserId) return;
            getCosmetics(p.platform, p.platformUserId).then(function (cos) {
                if (!cos || Object.keys(cos).length === 0) return;
                var card = container.children[i];
                if (!card) return;
                applyCardCosmetics(card, cos);
            }).catch(function () {});
        });
    }

    function applyCardCosmetics(card, cos) {
        var nameEl = card.querySelector('.tp-name');
        var avatarEl = card.querySelector('.tp-avatar') || card.querySelector('.tp-fallback');
        var pfpWrap = card.querySelector('.tp-pfp');

        clearRenderLayers(pfpWrap);
        clearRenderLayers(card);

        if (cos.name_color && nameEl) {
            if (cos.name_color.color) nameEl.style.color = cos.name_color.color;
            if (cos.name_color.animation) nameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow && nameEl) {
            if (cos.name_glow.textShadow) nameEl.style.textShadow = cos.name_glow.textShadow;
            if (cos.name_glow.animation && !nameEl.style.animation) nameEl.style.animation = cos.name_glow.animation;
        }
        if (cos.profile_border && avatarEl) {
            if (cos.profile_border.border) avatarEl.style.border = cos.profile_border.border;
            if (cos.profile_border.boxShadow) avatarEl.style.boxShadow = cos.profile_border.boxShadow;
            if (cos.profile_border.animation) avatarEl.style.animation = cos.profile_border.animation;
            applyRenderLayer(pfpWrap || avatarEl, cos.profile_border, 'frame');
        }
        if (cos.profile_glow && (pfpWrap || avatarEl)) {
            var target = pfpWrap || avatarEl;
            if (cos.profile_glow.boxShadow) target.style.boxShadow = cos.profile_glow.boxShadow;
            if (cos.profile_glow.animation) target.style.animation = cos.profile_glow.animation;
        }
        // Hero badge — apply gradient background to the card itself
        if (cos.hero_badge && cos.hero_badge.background) {
            card.style.background = cos.hero_badge.background;
            if (cos.hero_badge.backgroundSize) card.style.backgroundSize = cos.hero_badge.backgroundSize;
            if (cos.hero_badge.animation) card.style.animation = cos.hero_badge.animation;
            card.classList.add('has-hero-badge');
            applyRenderLayer(card, cos.hero_badge, 'surface');
            // Border + glow follows hero badge theme
            var badgeColor = extractBadgeColor(cos.hero_badge.background);
            if (badgeColor) {
                card.style.borderColor = badgeColor;
                card.style.boxShadow = '0 0 10px ' + badgeColor + '66, inset 0 1px 0 rgba(255,255,255,0.1)';
            }
        }
    }

    /** Apply hero_badge to an arbitrary element (used by word-announce banner) */
    function applyHeroBadge(el, cos) {
        if (!el || !cos || !cos.hero_badge) return;
        clearRenderLayers(el);
        if (!cos.hero_badge.background && !cos.hero_badge.render) return;
        el.style.background = cos.hero_badge.background;
        if (cos.hero_badge.backgroundSize) el.style.backgroundSize = cos.hero_badge.backgroundSize;
        if (cos.hero_badge.animation) el.style.animation = cos.hero_badge.animation;
        el.classList.add('has-hero-badge');
        applyRenderLayer(el, cos.hero_badge, 'surface');
        var badgeColor = extractBadgeColor(cos.hero_badge.background);
        if (badgeColor) {
            el.style.borderColor = badgeColor;
            el.style.boxShadow = '0 0 10px ' + badgeColor + '66, inset 0 1px 0 rgba(255,255,255,0.1)';
        }
    }

    /** Reset hero_badge from an element */
    function clearHeroBadge(el) {
        if (!el) return;
        clearRenderLayers(el);
        el.style.background = '';
        el.style.backgroundSize = '';
        el.style.animation = '';
        el.style.borderColor = '';
        el.style.boxShadow = '';
        el.classList.remove('has-hero-badge');
    }

    window.TopPlayerCards = {
        renderTopPlayerCards: renderTopPlayerCards,
        applyCardCosmetics: applyCardCosmetics,
        getCosmetics: getCosmetics,
        invalidateCosmetics: invalidateCosmetics,
        applyHeroBadge: applyHeroBadge,
        clearHeroBadge: clearHeroBadge
    };
})();
