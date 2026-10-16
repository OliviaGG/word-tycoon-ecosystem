/* WikiSearchle Cosmetics Applier
 *
 * Self-contained vanilla-JS port of Searchle's CosmeticsApplier. Applies the
 * subset of equipped cosmetics the cards/podium need: hero_badge (surface
 * background), profile_border + profile_glow (avatar ring/glow), name_color +
 * name_glow (username text), and title (small label below name).
 *
 * Cosmetic data shape (from Chat Relay's user.cosmetics, which mirrors the
 * Word Tycoon /api/cosmetics/discord/<id> equipped block):
 *   {
 *     hero_badge: { background, backgroundSize, animation },
 *     profile_border: { border, boxShadow, animation },
 *     profile_glow: { boxShadow, animation },
 *     name_color: { color, textShadow, animation },
 *     name_glow: { textShadow, animation },
 *     title: { title, titleColor, titleGlow, animation },
 *   }
 *
 * Usage:
 *   WikiCosmetics.apply({
 *     surfaceEl: cardEl,            // hero_badge background
 *     avatarEl: avatarFbEl,         // profile_border + profile_glow
 *     nameEl: gnameEl,              // name_color + name_glow
 *     titleContainer: whoTextEl,    // title appended as <span class="cosmetic-title">
 *   }, user.cosmetics);
 *
 * Idempotent — safe to call repeatedly. Each call clears prior inline cosmetic
 * styles before applying the current set, so unequipped categories disappear.
 */
(function (global) {
  'use strict';

  // Inject the @keyframes the cosmetic CSS strings reference. Without these,
  // animation names like "ov-gradient-flow" silently no-op. One <style> tag,
  // injected on first load.
  function injectKeyframes() {
    if (document.getElementById('wc-cos-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'wc-cos-keyframes';
    style.textContent = [
      '@keyframes ov-gradient-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }',
      '@keyframes ov-float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }',
      '@keyframes ov-sparkle { 0%, 100% { opacity: 0; transform: scale(0.5); } 50% { opacity: 1; transform: scale(1); } }',
      '@keyframes gen-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.25); } }',
      '@keyframes gen-shift { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(360deg); } }',
      '@keyframes gen-prismatic { 0% { filter: hue-rotate(0deg) brightness(1); } 33% { filter: hue-rotate(120deg) brightness(1.3); } 66% { filter: hue-rotate(240deg) brightness(1.1); } 100% { filter: hue-rotate(360deg) brightness(1); } }'
    ].join('\n');
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectKeyframes, { once: true });
  } else {
    injectKeyframes();
  }

  // The shared ring/word applier and its keyframes live on the relay.
  // Loaded from there so this game needs no HTML or nginx change.
  function hubAssetBase() {
    const h = (window.location && window.location.hostname) || '';
    return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3000' : 'https://wordtycoon.live';
  }
  const _pfpQueue = [];
  function _pfpFlush() {
    if (!window.PfpCosmetics) return;
    const q = _pfpQueue.splice(0);
    q.forEach((a) => { if (a[0] && a[0].isConnected) applyPfp(a[0], a[1]); });
  }
  (function loadShared() {
    try {
      const base = hubAssetBase();
      if (!document.querySelector('link[href*="cosmetics-fx.css"]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = base + '/css/cosmetics-fx.css?v=2';
        document.head.appendChild(l);
      }
      if (window.PfpCosmetics) return;
      const ex = document.querySelector('script[src*="pfp-cosmetics.js"]');
      if (ex) { ex.addEventListener('load', _pfpFlush); return; }
      const sc = document.createElement('script');
      sc.src = base + '/js/pfp-cosmetics.js?v=15';
      sc.addEventListener('load', _pfpFlush);
      document.head.appendChild(sc);
    } catch (e) { /* older CEF */ }
  })();

  // Ring + glow via the shared applier: it owns the conic paint, the
  // size rescale (96px reference) and the no-halo rule.
  function applyPfp(avatarEl, cos) {
    if (!avatarEl || !cos) return;
    if (!window.PfpCosmetics) { _pfpQueue.push([avatarEl, cos]); return; }
    const shell = avatarEl.parentElement || avatarEl;
    window.PfpCosmetics.apply(avatarEl, shell, cos);
  }

  // Legacy local scaler — no longer used for the avatar ring, kept because
  // other call sites may still reference it.
  // Cosmetic px values are authored against an 80px avatar reference. Scale
  // border widths and box-shadow blur radii proportionally to the actual
  // avatar size — otherwise a 4px ring authored for 80px looks oversized at 38px.
  const COSMETIC_REF_SIZE = 80;
  function scaleCosmeticPx(cssValue, avatarSize) {
    if (!cssValue || !avatarSize || avatarSize <= 0) return cssValue;
    const scale = avatarSize / COSMETIC_REF_SIZE;
    if (Math.abs(scale - 1) < 0.05) return cssValue;
    return cssValue.replace(/(\d+(?:\.\d+)?)px/g, (m, n) => {
      return Math.max(1, Math.round(parseFloat(n) * scale)) + 'px';
    });
  }

  // Strip any black-or-near-black shadow layers from a CSS box-/text-shadow
  // string. Cosmetic packs (especially name_glow) often stack a dark layer
  // alongside the coloured glow — on WikiSearchle's dark cards that reads
  // as a black halo behind the name. We split top-level comma commits,
  // drop entries that contain rgba(0,0,0,...), rgb(0,0,0), #000(000)?, or
  // the keyword `black`, then rejoin. Multi-stop colour glows survive.
  function stripDarkShadowLayers(value) {
    if (!value || typeof value !== 'string') return value;
    const parts = [];
    let depth = 0, current = '';
    for (const ch of value) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    const isDark = (p) => {
      const s = p.toLowerCase().replace(/\s+/g, '');
      if (/rgba?\(0,0,0(?:,|\))/.test(s)) return true;
      if (/#000(?:000)?\b/.test(s)) return true;
      if (/(?:^|[^\w-])black(?:[^\w-]|$)/.test(s)) return true;
      return false;
    };
    return parts.filter((p) => !isDark(p)).join(', ');
  }

  function clearSurface(el) {
    if (!el) return;
    el.style.background = '';
    el.style.backgroundSize = '';
    el.style.animation = '';
    el.classList.remove('cos-hero-badge');
  }
  function clearAvatar(el) {
    if (!el) return;
    if (window.PfpCosmetics) window.PfpCosmetics.clear(el.parentElement || el);
    el.style.border = '';
    el.style.boxShadow = '';
    el.style.animation = '';
    delete el.dataset.borderShadow;
  }
  function clearName(el) {
    if (!el) return;
    el.style.color = '';
    el.style.textShadow = '';
    el.style.animation = '';
  }
  function clearTitle(container) {
    if (!container) return;
    container.querySelectorAll('.cosmetic-title').forEach((n) => n.remove());
  }

  function apply(els, cos) {
    if (!els) return;
    // Always reset first — handles unequip on rerender.
    clearSurface(els.surfaceEl);
    clearAvatar(els.avatarEl);
    clearName(els.nameEl);
    clearTitle(els.titleContainer);
    if (!cos || typeof cos !== 'object') return;

    const avatarSize = els.avatarSize || (els.avatarEl ? (els.avatarEl.offsetWidth || els.avatarEl.clientWidth || 0) : 0);

    // hero_badge → card/podium surface background. If the cosmetic ships
    // its own animation string, apply it inline. Otherwise tag the element
    // with .cos-hero-badge so a CSS rule drives a subtle default pulse
    // — using a class (not inline animation) lets more-specific rules like
    // .scoreboard.round-ended .tp-card override it at round end.
    if (cos.hero_badge && els.surfaceEl) {
      if (cos.hero_badge.background) {
        els.surfaceEl.style.background = cos.hero_badge.background;
        if (cos.hero_badge.backgroundSize) els.surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
        if (cos.hero_badge.animation) {
          els.surfaceEl.style.animation = cos.hero_badge.animation;
        } else {
          els.surfaceEl.classList.add('cos-hero-badge');
        }
      }
    }

    // profile_border + profile_glow → shared applier (filled-disc ring,
    // 96px-reference rescale, border emits no halo, glow hugs without one).
    if (els.avatarEl) applyPfp(els.avatarEl, cos);

    // name_color → username text colour + outline shadow. Strip any
    // black/near-black layers from the textShadow first; on WikiSearchle's
    // dark cards those read as a black halo / "background" behind the name.
    if (cos.name_color && els.nameEl) {
      if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
      if (cos.name_color.textShadow) {
        const cleaned = stripDarkShadowLayers(cos.name_color.textShadow);
        if (cleaned) els.nameEl.style.textShadow = cleaned;
      }
      if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
    }

    // name_glow → username glow halo. Same dark-layer stripping; stacks on
    // top of any (already-cleaned) name_color shadow.
    if (cos.name_glow && els.nameEl) {
      if (cos.name_glow.textShadow) {
        const cleaned = stripDarkShadowLayers(cos.name_glow.textShadow);
        if (cleaned) {
          const existing = els.nameEl.style.textShadow;
          els.nameEl.style.textShadow = existing ? existing + ', ' + cleaned : cleaned;
        }
      }
      if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
    }

    // word_color / word_glow → transient spawn on a freshly found word.
    // Pass els.wordEl when rendering a found-word row; the word lands in
    // the finder's colour and settles back to the list's own colour.
    if (els.wordEl && window.PfpCosmetics) {
      window.PfpCosmetics.spawnWord(els.wordEl, cos);
    }

    // title → small label appended below the username
    if (cos.title && cos.title.title && els.titleContainer) {
      const titleEl = document.createElement('span');
      titleEl.className = 'cosmetic-title';
      titleEl.textContent = cos.title.title;
      if (cos.title.titleColor) titleEl.style.color = cos.title.titleColor;
      if (cos.title.titleGlow) titleEl.style.textShadow = cos.title.titleGlow;
      if (cos.title.animation) titleEl.style.animation = cos.title.animation;
      els.titleContainer.appendChild(titleEl);
    }
  }

  global.WikiCosmetics = { apply };
})(typeof window !== 'undefined' ? window : this);
