/* top-player-cards.js — Shared top-3 player cards with cosmetics */
(function () {
    'use strict';

    var AVATAR_FALLBACK = 'https://wordtycoon.live/portal/img/logo.png';
    var COSMETIC_LAYER_SELECTOR = '.tp-cosmetic-layer';
    function resolveAvatar(url) {
        if (!url) return AVATAR_FALLBACK;
        if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
        return url;
    }

    var cosCache = new Map();
    var COS_TTL = 60000;

    /** Extract the brightest hex color from a gradient string for border theming */
    function extractBadgeColor(bg) {
        if (!bg) return null;
        var colors = bg.match(/#[0-9a-fA-F]{6}/g);
        if (!colors || !colors.length) return null;
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

    // The ring applier and its keyframes live on the relay, not in the game.
    // Loaded here so no game HTML (or nginx allowlist entry) has to change.
    var _pfpPending = [];
    function _pfpFlush() {
        if (!window.PfpCosmetics) return;
        var q = _pfpPending; _pfpPending = [];
        for (var i = 0; i < q.length; i++) {
            if (q[i][0] && q[i][0].isConnected) applyAvatarCosmetics(q[i][0], q[i][1], q[i][2]);
        }
    }
    (function _loadPfpAssets() {
        try {
            var base = getHubAssetBase();
            if (!document.querySelector('link[href*="cosmetics-fx.css"]')) {
                var l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = base + '/css/cosmetics-fx.css?v=2';
                document.head.appendChild(l);
            }
            if (window.PfpCosmetics) return;
            var ex = document.querySelector('script[src*="pfp-cosmetics.js"]');
            if (ex) { ex.addEventListener('load', _pfpFlush); return; }
            var sc = document.createElement('script');
            sc.src = base + '/js/pfp-cosmetics.js?v=15';
            sc.addEventListener('load', _pfpFlush);
            document.head.appendChild(sc);
        } catch (e) { /* older CEF */ }
    })();

    function resolveCosmeticAsset(asset) {
        if (!asset) return '';
        if (/^https?:\/\//i.test(asset)) return asset;
        if (asset.charAt(0) === '/') return getHubAssetBase() + asset;
        return getHubAssetBase() + '/' + asset;
    }

    function clearRenderLayers(host) {
        if (!host || !host.querySelectorAll) return;
        // `:scope >` is load-bearing. .tp-pfp is a DESCENDANT of .tp-card, so the
        // old unscoped query — run from the card by applySurfaceCosmetics, which
        // fires immediately AFTER applyAvatarCosmetics — deleted the avatar frame
        // layer that had just been added. Net effect: every svg_frame border (the
        // donor + Pookie Pass tiers) was built, inserted and destroyed before it
        // could paint, silently degrading to its flat ring fallback. Verified live
        // on the erecTangled podium: frame layer count 0 on all six cards.
        host.querySelectorAll(':scope > ' + COSMETIC_LAYER_SELECTOR).forEach(function (node) { node.remove(); });
    }

    function buildRenderLayer(render, kind) {
        if (!render || !render.type) return null;
        var layer = document.createElement('span');
        layer.className = 'tp-cosmetic-layer tp-cosmetic-layer--' + kind + ' tp-cosmetic-layer--' + render.type;
        layer.setAttribute('aria-hidden', 'true');
        if (render.type === 'video_bg') {
            // SF/DC hero badges: a muted looping <video>, not a background —
            // CSS background-image cannot paint an mp4, so the badge rendered
            // as its static poster gradient everywhere, and "paused" on mobile.
            if (render.asset) {
                var vid = document.createElement('video');
                vid.src = resolveCosmeticAsset(render.asset);
                if (render.poster) vid.poster = resolveCosmeticAsset(render.poster);
                vid.autoplay = true;
                vid.muted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.setAttribute('muted', '');
                vid.setAttribute('playsinline', '');
                vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
                layer.appendChild(vid);
                // Autoplay can still refuse (Low Power Mode, data saver) — nudge.
                var tryPlay = function () { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); };
                if (vid.readyState >= 2) tryPlay(); else vid.addEventListener('canplay', tryPlay, { once: true });
            }
            if (render.scrim) {
                var scrim = document.createElement('span');
                scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:' + render.scrim + ';';
                layer.appendChild(scrim);
            }
        } else if (render.asset) {
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

    // The frame art is a 256px SVG and the glow wrapped around it is authored in
    // absolute px against the ~96px portal avatar. Podium avatars are 17-32px,
    // where a fixed 7px/12px drop-shadow is a fog wider than the avatar's own
    // radius. Rescale the treatment to the host the layer actually landed on so
    // a frame reads at the same weight everywhere instead of dissolving.
    var FRAME_REF = 96;
    function scaleFrameLayer(host, layer) {
        var w = host.offsetWidth || host.offsetHeight || 0;
        if (!w) {
            // Not laid out yet (hidden tab, card built before attach). Retry
            // rather than bake in a wrong scale; bail if either node is pruned.
            requestAnimationFrame(function () {
                if (layer.isConnected && host.isConnected) scaleFrameLayer(host, layer);
            });
            return;
        }
        var k = Math.min(1, w / FRAME_REF);
        var px = function (n) { return (Math.round(n * k * 100) / 100) + 'px'; };
        layer.style.filter = 'saturate(1.05) brightness(1.03)'
            + ' drop-shadow(0 0 ' + px(7) + ' rgba(255,255,255,0.07))'
            + ' drop-shadow(0 0 ' + px(12) + ' rgba(168,120,255,0.10))';
    }

    function applyRenderLayer(host, item, kind) {
        if (!host || !item || !item.render) return;
        var layer = buildRenderLayer(item.render, kind);
        if (!layer) return;
        if (kind === 'surface') host.prepend(layer);
        else host.appendChild(layer);
        if (kind === 'frame') {
            // The catalog puts frames at z-index 3 — above the avatar, which is
            // how the portal renders them. buildRenderLayer never read
            // render.zIndex, so a surviving frame would have sat behind the photo.
            if (item.render.zIndex != null) layer.style.zIndex = String(item.render.zIndex);
            scaleFrameLayer(host, layer);
        }
    }

    function applyNameCosmetics(nameEl, cos) {
        if (!nameEl || !cos) return;
        if (cos.name_color) {
            if (cos.name_color.color) nameEl.style.color = cos.name_color.color;
            if (cos.name_color.animation) nameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow) {
            if (cos.name_glow.textShadow) nameEl.style.textShadow = cos.name_glow.textShadow;
            if (cos.name_glow.animation && !nameEl.style.animation) nameEl.style.animation = cos.name_glow.animation;
        }
        // Title cosmetic intentionally suppressed on rectangled / erectangled.
        var existingTitle_ = nameEl.parentNode ? nameEl.parentNode.querySelector('.cosmetic-title') : null;
        if (existingTitle_) existingTitle_.remove();
    }

    function applyAvatarCosmetics(avatarEl, wrapEl, cos) {
        if (!avatarEl || !cos) return;
        clearRenderLayers(wrapEl);
        if (cos.profile_border) applyRenderLayer(wrapEl || avatarEl, cos.profile_border, 'frame');
        // Shared applier: renders the ring as a filled disc behind the avatar
        // and rescales the catalog px (authored for ~96px) down to these
        // 22-32px cards. Previously this function copied `border` but not the
        // conic background keys, so every epic+ ring was an invisible gap.
        if (window.PfpCosmetics) {
            window.PfpCosmetics.apply(avatarEl, wrapEl || avatarEl, cos);
        } else {
            // assets still in flight — re-dress once they land
            _pfpPending.push([avatarEl, wrapEl, cos]);
        }
    }

    function applySurfaceCosmetics(surfaceEl, cos) {
        if (!surfaceEl || !cos) return;
        clearRenderLayers(surfaceEl);
        if (cos.hero_badge && cos.hero_badge.background) {
            surfaceEl.style.background = cos.hero_badge.background;
            if (cos.hero_badge.backgroundSize) surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
            if (cos.hero_badge.animation) surfaceEl.style.animation = cos.hero_badge.animation;
            surfaceEl.classList.add('has-hero-badge');
            applyRenderLayer(surfaceEl, cos.hero_badge, 'surface');
            var badgeColor = extractBadgeColor(cos.hero_badge.background);
            if (badgeColor) {
                surfaceEl.style.borderColor = badgeColor;
                surfaceEl.style.boxShadow = '0 0 10px ' + badgeColor + '66, inset 0 1px 0 rgba(255,255,255,0.1)';
            }
        }
    }

    function ensureWinAvatarWrap(card) {
        if (!card) return null;
        var existing = card.querySelector('.win-player-avatar-wrap');
        if (existing) return existing;
        var avatarEl = card.querySelector('.win-player-avatar, .win-player-avatar-fallback');
        if (!avatarEl) return null;
        var wrap = document.createElement('span');
        wrap.className = 'win-player-avatar-wrap';
        if (card.classList.contains('win-scroll-player')) wrap.classList.add('win-player-avatar-wrap--small');
        avatarEl.parentNode.insertBefore(wrap, avatarEl);
        wrap.appendChild(avatarEl);
        return wrap;
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

    // Ranks 4-6 share a flat "minor" tier: pfp + score, no name.
    var RANKS = ['gold', 'silver', 'bronze', 'minor', 'minor', 'minor'];

    /**
     * @param {object} [opts] - { count: 3|6 }. Default 3 — the OBS overlay and
     * the win cards render a podium of three; only the MP page asks for six.
     */
    function renderTopPlayerCards(containerId, players, opts) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var count = Math.min((opts && opts.count) || 3, RANKS.length);
        var top3 = (players || []).slice(0, count);
        var ranks = RANKS;
        container.innerHTML = top3.map(function (p, i) {
            var name = p.displayName || p.name || '?';
            var score = (p.score || 0).toLocaleString();
            // Sanitize double-URL PFPs
            var pfp = p.profileImage || '';
            if (pfp) { var d = pfp.indexOf('https://', 8); if (d > 0) pfp = pfp.substring(d); }
            var rank = ranks[i];
            var plat = (p.platform || '').replace(/"/g, '&quot;');
            var uid = (p.platformUserId || '').replace(/"/g, '&quot;');
            var avatarHtml = '<img class="tp-avatar" src="' + resolveAvatar(pfp).replace(/"/g, '&quot;') + '" alt="" onerror="this.onerror=null;this.src=\'' + AVATAR_FALLBACK + '\'">'
                + '<div class="tp-fallback" style="display:none"></div>';
            var fcClass = '';
            // Minor cards are too small for a legible name — score only.
            var infoHtml = rank === 'minor'
                ? '<span class="tp-score">' + score + '</span>'
                : '<span class="tp-name">' + name.replace(/</g, '&lt;') + '</span><span class="tp-score">' + score + 'pts</span>';
            return '<div class="tp-card ' + rank + '" data-platform="' + plat + '" data-userid="' + uid + '"><div class="tp-pfp' + fcClass + '">' + avatarHtml + '</div><div class="tp-info">' + infoHtml + '</div></div>';
        }).join('');
        // Perk badges — the cards are built as an HTML string above, so the
        // hearts are injected once the markup is in the DOM.
        top3.forEach(function (p, i) {
            var card = container.children[i];
            var wrap = card && card.querySelector('.tp-pfp');
            if (wrap) window.PerkBadges && window.PerkBadges.apply(wrap, p);
        });
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

        applyNameCosmetics(nameEl, cos);
        applyAvatarCosmetics(avatarEl, pfpWrap || avatarEl, cos);
        // Hero badge — apply gradient background to the card itself
        applySurfaceCosmetics(card, cos);
    }

    /** Apply hero_badge to an arbitrary element (used by word-announce banner) */
    function applyHeroBadge(el, cos) {
        if (!el || !cos || !cos.hero_badge) return;
        clearRenderLayers(el);
        if (!cos.hero_badge.background && !cos.hero_badge.render) return;
        applySurfaceCosmetics(el, cos);
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

    function applyWinCardCosmetics(card, cos) {
        if (!card || !cos) return;
        var nameEl = card.querySelector('.win-player-name, .win-scroll-name');
        var avatarWrap = ensureWinAvatarWrap(card);
        var avatarEl = avatarWrap ? avatarWrap.querySelector('.win-player-avatar, .win-player-avatar-fallback') : card.querySelector('.win-player-avatar, .win-player-avatar-fallback');
        applyNameCosmetics(nameEl, cos);
        applyAvatarCosmetics(avatarEl, avatarWrap || avatarEl, cos);
        applySurfaceCosmetics(card, cos);
    }

    function hydrateWinPlayerCards(container, players) {
        if (!container || !players || !players.length) return;
        var rows = container.querySelectorAll('.win-player, .win-scroll-player');
        players.forEach(function (player, i) {
            if (!player || !player.platform || !player.platformUserId) return;
            var row = rows[i];
            if (!row) return;
            getCosmetics(player.platform, player.platformUserId).then(function (cos) {
                if (!cos || Object.keys(cos).length === 0) return;
                applyWinCardCosmetics(row, cos);
            }).catch(function () {});
        });
    }

    window.TopPlayerCards = {
        renderTopPlayerCards: renderTopPlayerCards,
        applyCardCosmetics: applyCardCosmetics,
        applyWinCardCosmetics: applyWinCardCosmetics,
        hydrateWinPlayerCards: hydrateWinPlayerCards,
        getCosmetics: getCosmetics,
        invalidateCosmetics: invalidateCosmetics,
        applyAvatarCosmetics: applyAvatarCosmetics,
        applyHeroBadge: applyHeroBadge,
        clearHeroBadge: clearHeroBadge
    };
})();
