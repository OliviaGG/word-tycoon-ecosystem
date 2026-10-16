// ===== XP Bubble =====
// Spawns a floating "+N XP" notification at a guess entry's position when
// the server reports a non-zero xpAward for that guess. Floats up and
// fades over 3s, then self-removes.
//
// Cosmetics applied:
//   • hero_badge   → layered translucent badge gradient + optional PNG
//                    overlay (e.g. fan-club fanclub-heart.png) painted
//                    BENEATH the bubble's text but ABOVE the glass
//                    morphism backdrop. Mirrors the alt-mode grid's
//                    ChipXpFloater approach so both XP tags read the
//                    same way visually.
//   • profile_border → ring on the bubble's outer edge (signature color)
//   • profile_glow   → outer aura merged into the bubble's box-shadow
//   • name_color / name_glow → applied to the player-name line
//   • win_effect     → themed particle trail dragged behind the bubble
//                      as it floats up (fan-club hearts, sparkles, etc.)
//
// A BokehParticles instance must be attached via XpBubble.setParticleSystem
// for the themed trail to render. Without one, the bubble still spawns
// (text + frame) but no trail particles.
//
// Static API:
//   XpBubble.setParticleSystem(bokeh);             // optional, once at boot
//   XpBubble.spawn(domRenderer, x, y, options);    // per-XP-award

import { applyCosmetics } from '../utils/CosmeticsApplier.js';

const FLOAT_DURATION_MS = 3000;
const REMOVE_DELAY_MS = FLOAT_DURATION_MS + 100;

// Trail emission throttle — every Nth animation frame we spawn a batch.
// 2 → ~30Hz @ 60fps. Combined with TRAIL_PARTICLES_PER_EMIT this gives
// a continuous wake without crushing the particle pool.
const TRAIL_EMIT_EVERY_N_FRAMES = 2;
const TRAIL_PARTICLES_PER_EMIT = 4;
// Stop emitting before the bubble fully fades so the last trail particles
// have life to die before the bubble is gone (avoids trail hanging in
// empty space). Same logic as ChipXpFloater.
const TRAIL_EMIT_UNTIL_MS = 2100;

let _particleSystem = null;

// Rewrite leading-slash asset paths to the WT origin. Cosmetic catalog
// stores paths like '/cosmetics/fanclub-heart.png' which resolve fine on
// wordtycoon.live but 404 on other game origins (subtextle.com, etc.).
// Versioned query param busts browser cache when the asset is replaced
// server-side — keep aligned with ChipXpFloater + BokehParticles loaders.
function _resolveCosmeticUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  let url = rawUrl;
  if (url.startsWith('/') && !url.startsWith('//')) {
    url = 'https://wordtycoon.live' + url;
  }
  if (!url.includes('?')) url += '?v=3';
  return url;
}

export class XpBubble {
  // Attach the BokehParticles instance so spawned bubbles can drag a
  // themed trail behind them. Safe to call with null to disable trails.
  static setParticleSystem(p) {
    _particleSystem = p || null;
  }

  static spawn(domRenderer, worldX, worldY, options) {
    const { xpAmount, playerName, cosmetics } = options || {};
    if (!xpAmount || xpAmount <= 0) return;

    // Extract individual categories. Hero_badge handled manually below
    // so we get the layered badge approach (gradient + optional PNG
    // overlay) instead of applyCosmetics's flat-background fallback.
    const cos = cosmetics ? { ...cosmetics } : {};
    const heroBadge = cos.hero_badge || null;
    const profileBorder = cos.profile_border || null;
    const profileGlow = cos.profile_glow || null;
    const winEffect = cos.win_effect || null;
    // name_color / word_color — applied as COLOR ONLY below (no
    // textShadow). The cosmetic catalog packs an 8-direction outline +
    // glow into textShadow; both are intentionally stripped on the XP
    // bubble so the text reads clean. word_color drives the "+N XP"
    // amount line; name_color drives the username line.
    const nameColor = cos.name_color || null;
    const wordColor = cos.word_color || null;
    // Pull categories out of the dict passed to applyCosmetics so the
    // shared applier doesn't paint shadows or override the surface
    // background — we handle each category ourselves above.
    delete cos.hero_badge;
    delete cos.name_color;
    delete cos.name_glow;
    delete cos.word_color;
    delete cos.word_glow;

    const anchor = document.createElement('div');
    anchor.className = 'xp-bubble-anchor';

    // Float container owns the float-up keyframe. The surface (its child)
    // owns the visual look + receives cosmetic styling. Two layers because
    // applyCosmetics resets surfaceEl.style.animation and may overwrite it
    // with a hero_badge animation — that would kill the float keyframe if
    // they shared a node.
    const bubble = document.createElement('div');
    bubble.className = 'xp-bubble';

    const surface = document.createElement('div');
    surface.className = 'xp-bubble-surface';

    // Hero-badge layer: absolute-positioned child that fills the surface.
    // Sits below text (z-index 0) and above the surface's own background
    // glass + backdrop-filter (because it's a child). Opacity 0.5 lets
    // the underlying glass morphism still bleed through the badge so the
    // bubble reads as tinted stained glass, not a solid colored panel.
    if (heroBadge && typeof heroBadge.background === 'string'
        && heroBadge.background.length > 0) {
      const badgeLayer = document.createElement('div');
      badgeLayer.className = 'xp-bubble-badge';
      badgeLayer.style.background = heroBadge.background;
      if (typeof heroBadge.backgroundSize === 'string') {
        badgeLayer.style.backgroundSize = heroBadge.backgroundSize;
      }
      if (typeof heroBadge.animation === 'string') {
        badgeLayer.style.animation = heroBadge.animation;
      }
      // Fan-club Heart Hero badge stacks a heart PNG on top of the gradient.
      // Layer the image as a nested absolute-filled child so it sits ABOVE
      // the gradient but is still part of the opacity:0.5 badge layer.
      // No-op for legacy badges (Slate / Magma / etc.) without an image.
      if (typeof heroBadge.backgroundImage === 'string'
          && heroBadge.backgroundImage.length > 0) {
        const imgOverlay = document.createElement('div');
        imgOverlay.className = 'xp-bubble-badge-image';
        imgOverlay.style.cssText =
          'position:absolute;inset:0;pointer-events:none;' +
          'background-repeat:no-repeat;background-position:center;';
        imgOverlay.style.backgroundImage = `url("${_resolveCosmeticUrl(heroBadge.backgroundImage)}")`;
        const sz = (typeof heroBadge.backgroundImageSize === 'string'
          && heroBadge.backgroundImageSize.length > 0)
          ? heroBadge.backgroundImageSize : '80% auto';
        imgOverlay.style.backgroundSize = sz;
        badgeLayer.appendChild(imgOverlay);
      }
      surface.appendChild(badgeLayer);
    }

    const amountEl = document.createElement('div');
    amountEl.className = 'xp-bubble-amount';
    amountEl.textContent = '+' + xpAmount.toLocaleString() + ' XP';
    // word_color cosmetic → amount color ONLY. textShadow (8-dir
    // outline + glow baked into the cosmetic) is intentionally NOT
    // applied — the bubble's own backdrop-filter / box-shadow already
    // separate the text from background. animation is preserved so
    // animated word_color cosmetics still play.
    if (wordColor && typeof wordColor.color === 'string') {
      amountEl.style.color = wordColor.color;
    }
    if (wordColor && typeof wordColor.animation === 'string') {
      amountEl.style.animation = wordColor.animation;
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'xp-bubble-name';
    nameEl.textContent = playerName || '';
    // name_color cosmetic → name color ONLY (no textShadow). Same
    // rationale as word_color above.
    if (nameColor && typeof nameColor.color === 'string') {
      nameEl.style.color = nameColor.color;
    }
    if (nameColor && typeof nameColor.animation === 'string') {
      nameEl.style.animation = nameColor.animation;
    }

    surface.appendChild(amountEl);
    if (playerName) surface.appendChild(nameEl);
    bubble.appendChild(surface);
    anchor.appendChild(bubble);

    // Any remaining categories (profile_border/profile_glow handled
    // below, title, etc.) — the shared applier still runs for them.
    // hero_badge, name_color/glow, word_color/glow were already
    // deleted from `cos` so the applier won't touch those.
    if (cos && Object.keys(cos).length > 0) {
      applyCosmetics({ surfaceEl: surface }, cos);
    }

    // Profile border + glow on the bubble's outer edge. Border replaces
    // the default rgba ring; glow is MERGED into the existing box-shadow
    // string so the glass rim highlights still pop on top of the
    // cosmetic-driven outer aura. Read computed style to pick up the
    // CSS default, then prepend cosmetic shadows so they paint first
    // (outermost layer).
    if (profileBorder && typeof profileBorder.border === 'string') {
      surface.style.border = profileBorder.border;
    }
    const cosmeticShadows = [];
    if (profileBorder && typeof profileBorder.boxShadow === 'string') {
      cosmeticShadows.push(profileBorder.boxShadow);
    }
    if (profileGlow && typeof profileGlow.boxShadow === 'string') {
      cosmeticShadows.push(profileGlow.boxShadow);
    }
    if (cosmeticShadows.length > 0) {
      // Defer reading computed style until the element is in the DOM
      // (after the domRenderer.add below), so the CSS default has had
      // a chance to apply. Done in a microtask before the float starts.
      Promise.resolve().then(() => {
        try {
          const existing = window.getComputedStyle(surface).boxShadow;
          const merged = (existing && existing !== 'none')
            ? cosmeticShadows.join(', ') + ', ' + existing
            : cosmeticShadows.join(', ');
          surface.style.boxShadow = merged;
        } catch (_) {}
      });
    }

    // Mounted on the static layer (same as PinnedGuess / HeaderBar) so the
    // bubble can paint above ranked entries AND the pinned guess overlay.
    // Caller must pre-add the current group scroll offset into worldY so
    // the bubble lands at the on-screen position of the entry, not the
    // group-local position.
    domRenderer.add(anchor);
    domRenderer.applyTransform(anchor, worldX, worldY, 0);

    // ─── Themed particle trail ─────────────────────────────────────
    // While the bubble's float keyframe runs, sample its actual viewport
    // rect each frame and emit a band of trail particles across its
    // bottom edge. Particle type depends on the guesser's equipped
    // win_effect:
    //   • themed effect (heart_shower etc.) → fc heart PNG / shape pool
    //   • no themed effect                  → gold sparkle wake
    // Skips entirely if no particle system has been attached.
    if (_particleSystem) {
      const trailEffect = winEffect && typeof winEffect.effect === 'string'
        ? winEffect.effect : null;
      const trailPalette = winEffect && Array.isArray(winEffect.colors)
        && winEffect.colors.length > 0 ? winEffect.colors : null;
      const useThemedTrail = trailEffect && trailPalette
        && typeof _particleSystem.emitTrailShape === 'function';

      const startedAt = performance.now();
      let frameCount = 0;
      let trailRaf = 0;
      const trailTick = () => {
        const elapsed = performance.now() - startedAt;
        if (elapsed >= FLOAT_DURATION_MS || !bubble.parentNode) {
          trailRaf = 0;
          return;
        }
        // Wait until the bubble's pop-in has settled (~12% into keyframe)
        // before emitting so trails don't start in empty space at the
        // pre-scale anchor position.
        if (elapsed > 360 && elapsed < TRAIL_EMIT_UNTIL_MS
            && (frameCount % TRAIL_EMIT_EVERY_N_FRAMES === 0)) {
          const r = bubble.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            // Stratified sample across the bubble's full width, along a
            // band on the bottom 30% of the bubble — "curtain" wake.
            const yBandTop = r.top + r.height * 0.70;
            const yBandBot = r.bottom;
            for (let j = 0; j < TRAIL_PARTICLES_PER_EMIT; j++) {
              const tFrac = (j + Math.random()) / TRAIL_PARTICLES_PER_EMIT;
              const cx = r.left + tFrac * r.width;
              const cy = yBandTop + Math.random() * (yBandBot - yBandTop);
              if (useThemedTrail) {
                _particleSystem.emitTrailShape(trailEffect, cx, cy, trailPalette, 1);
              } else if (typeof _particleSystem.emitTrail === 'function') {
                _particleSystem.emitTrail(cx, cy, '#ffd95a', 1);
              }
            }
          }
        }
        frameCount++;
        trailRaf = requestAnimationFrame(trailTick);
      };
      trailRaf = requestAnimationFrame(trailTick);
    }

    setTimeout(() => {
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    }, REMOVE_DELAY_MS);
  }
}
