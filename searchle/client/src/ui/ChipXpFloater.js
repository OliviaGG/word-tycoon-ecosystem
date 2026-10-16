// ===== ChipXpFloater =====
// Floating "+N XP" bubble for alt-mode chips (mirrors default Searchle's
// XpBubble, but for chips rendered in normal DOM flow instead of the
// CSS3D scene). Mounted on a fixed-position overlay layer so bubbles can
// paint above any chrome; one bubble per spawn, self-removes after the
// float animation completes.
//
// Liquid-glass morphism styling lives in alt.css (.alt-xp-bubble-*).
//
// If a particle system (BokehParticles) is attached via setParticleSystem,
// each bubble leaves a gold sparkle trail behind it as it rises — sampled
// from the bubble's actual viewport rect each animation frame.
//
// Public API:
//   const floater = new ChipXpFloater();
//   floater.setParticleSystem(bokeh);                           // optional
//   floater.spawn(viewportX, viewportY, xpAmount, playerName);
//   floater.dispose();

const FLOAT_DURATION_MS = 3000;
const REMOVE_DELAY_MS = FLOAT_DURATION_MS + 100;
// Cut off trail emission well before the bubble itself fades out, so the
// last sparkles have time to die before the bubble disappears. With
// ~900ms particle lifetime and emission stopping at 2100ms, the last
// trail dies around 3000ms — same time the bubble vanishes.
const TRAIL_EMIT_UNTIL_MS = 2100;
// Trail emission throttle — every Nth animation frame we spawn trail
// particles. 2 → ~30Hz at 60fps. Combined with the per-emission count
// below this gives a dense visible wake without crushing the pool.
const TRAIL_EMIT_EVERY_N_FRAMES = 2;
// Particles emitted per tick are spread ACROSS the bubble's width using
// stratified sampling, so the trail reads as a wide curtain peeling off
// the bottom of the XP tag rather than a single thin column.
const TRAIL_PARTICLES_PER_EMIT = 4;

export class ChipXpFloater {
  constructor() {
    // Optional particle emitter — set after construction via
    // setParticleSystem(bokeh). When present, each spawned bubble leaves
    // a trail of small gold sparkles behind it.
    this._particles = null;
    // Single fixed-position layer for all bubbles. Pointer-events:none so
    // it never blocks chip interaction; z-index sits above the bokeh
    // particle layer (z:50) so bubbles read in front of particle bursts.
    this.layer = document.createElement('div');
    this.layer.className = 'alt-xp-layer';
    this.layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:120;overflow:visible;';
    document.body.appendChild(this.layer);
  }

  // Attach the BokehParticles instance so trail particles can be emitted
  // from each bubble's rising path. Safe to call with null to disable.
  setParticleSystem(p) {
    this._particles = p;
  }

  // Spawn a single XP bubble centered at (x, y) viewport coords. The CSS
  // keyframe handles the lift+fade; this method just builds DOM and
  // schedules cleanup. No-op for non-positive xpAmount.
  //
  // `cosmetics` is the guesser's equipped cosmetic dict (from
  // guess.user.cosmetics). All relevant categories are destructured
  // below; missing fields fall through to default-bubble visuals.
  spawn(viewportX, viewportY, xpAmount, playerName, cosmetics = null) {
    if (!xpAmount || xpAmount <= 0) return;
    const cos = cosmetics || {};
    const winEffect = cos.win_effect || null;
    const heroBadge = cos.hero_badge || null;
    const profileBorder = cos.profile_border || null;
    const profileGlow = cos.profile_glow || null;
    // name_color / name_glow / word_color / word_glow — applied as
    // color-only (textShadow stripped, see below) so the bubble takes
    // on the player's signature colors without the heavy 8-direction
    // outline+glow shadow stack that ships in the cosmetic catalog.
    const nameColor = cos.name_color || null;
    const wordColor = cos.word_color || null;
    // winEffect: optional { effect, colors } from the guesser's equipped
    // cosmetic. When present, the trail mixes the player's themed shapes
    // (e.g. hearts) into the default gold sparkle wake so the XP bubble
    // visually belongs to that player too. Null = plain gold default.
    const trailEffect = winEffect && typeof winEffect.effect === 'string'
      ? winEffect.effect : null;
    const trailPalette = winEffect && Array.isArray(winEffect.colors)
      && winEffect.colors.length > 0 ? winEffect.colors : null;
    // heroBadge: optional { background, backgroundSize, animation } CSS
    // chunk from the guesser's equipped hero_badge. When present, a
    // translucent badge gradient layer is added INSIDE the bubble so
    // the bubble takes on the player's badge color while the glass
    // morphism (backdrop-blur + white rim highlights) stays intact.

    // Single element carries both the float animation AND the backdrop
    // filter. The previous wrapper/surface split created a stacking
    // context on the wrapper (transform + will-change) that broke the
    // child's backdrop-filter — Chromium can't sample beyond a
    // transformed ancestor. Co-locating them fixes the glass effect.
    const bubble = document.createElement('div');
    bubble.className = 'alt-xp-bubble';
    bubble.style.left = viewportX + 'px';
    bubble.style.top = viewportY + 'px';

    const amt = document.createElement('div');
    amt.className = 'alt-xp-bubble-amount';
    amt.textContent = '+' + xpAmount.toLocaleString() + ' XP';
    // word_color cosmetic → amount color ONLY (no textShadow).
    // The cosmetic catalog packs an 8-direction outline + glow into
    // textShadow; both are intentionally omitted here so the bubble
    // stays clean. animation is preserved so animated word_color
    // cosmetics (rainbow shifts etc.) still play.
    if (wordColor && typeof wordColor.color === 'string') {
      amt.style.color = wordColor.color;
    }
    if (wordColor && typeof wordColor.animation === 'string') {
      amt.style.animation = wordColor.animation;
    }
    bubble.appendChild(amt);

    if (playerName) {
      const name = document.createElement('div');
      name.className = 'alt-xp-bubble-name';
      name.textContent = playerName;
      // name_color cosmetic → name color ONLY (no textShadow).
      if (nameColor && typeof nameColor.color === 'string') {
        name.style.color = nameColor.color;
      }
      if (nameColor && typeof nameColor.animation === 'string') {
        name.style.animation = nameColor.animation;
      }
      bubble.appendChild(name);
    }

    // Hero-badge layer — added BEFORE appending the bubble so it paints
    // first in DOM order (then z-index 0 puts it below the z-index:1
    // text + the bubble's own glass morphism layers via mix-blend-mode).
    // Prepend so it's the bubble's first child regardless of name order.
    if (heroBadge && typeof heroBadge.background === 'string'
        && heroBadge.background.length > 0) {
      const badgeLayer = document.createElement('div');
      badgeLayer.className = 'alt-xp-bubble-badge';
      // background is the gradient string from cosmetics.js (e.g.
      // "linear-gradient(135deg, #1e293b, #334155, #1e293b)"). Optional
      // backgroundSize + animation come from the same cosmetic css.
      badgeLayer.style.background = heroBadge.background;
      if (typeof heroBadge.backgroundSize === 'string') {
        badgeLayer.style.backgroundSize = heroBadge.backgroundSize;
      }
      if (typeof heroBadge.animation === 'string') {
        badgeLayer.style.animation = heroBadge.animation;
      }
      // Fan-club hero_badge introduces a `backgroundImage` (PNG URL) +
      // optional `backgroundImageSize` field that paints an icon on
      // TOP of the gradient (e.g. a heart silhouette over pink). Layer
      // it as a second absolute-filled overlay so it sits ABOVE the
      // base gradient but is still part of the opacity:0.5 badge layer.
      // No-op for legacy badges (Slate, Magma, etc.) that don't define
      // backgroundImage.
      if (typeof heroBadge.backgroundImage === 'string'
          && heroBadge.backgroundImage.length > 0) {
        const imgOverlay = document.createElement('div');
        imgOverlay.className = 'alt-xp-bubble-badge-image';
        imgOverlay.style.cssText =
          'position:absolute;inset:0;pointer-events:none;' +
          'background-repeat:no-repeat;background-position:center;';
        // Cosmetic assets live at wordtycoon.live/cosmetics/. The cosmetic
        // catalog stores the path as a relative URL (e.g.
        // "/cosmetics/fanclub-heart.png"), which resolves correctly on
        // wordtycoon.live (OBS overlays, portal) but 404s on the searchle
        // origin (grid.subtextle.com / subtextle.com). Rewrite leading-
        // slash paths to the absolute WT origin so the image actually
        // loads when this code runs on the grid page.
        let imgUrl = heroBadge.backgroundImage;
        if (imgUrl.startsWith('/') && !imgUrl.startsWith('//')) {
          imgUrl = 'https://wordtycoon.live' + imgUrl;
        }
        // Bust browser cache when the underlying PNG is replaced server-
        // side. The cosmetic catalog stores the bare path; we append the
        // version here so a future heart upload doesn't get masked by a
        // stale cached image in viewer browsers. Keep aligned with the
        // ?v=N in BokehParticles fcHeartTex loader.
        if (!imgUrl.includes('?')) imgUrl += '?v=3';
        imgOverlay.style.backgroundImage = `url("${imgUrl}")`;
        // Default to 80% if no explicit size — matches the WT cosmetic
        // spec's `backgroundImageSize: '80%'` default for fan-club.
        const sz = (typeof heroBadge.backgroundImageSize === 'string'
          && heroBadge.backgroundImageSize.length > 0)
          ? heroBadge.backgroundImageSize : '80% auto';
        imgOverlay.style.backgroundSize = sz;
        badgeLayer.appendChild(imgOverlay);
      }
      // Insert as first child so it sits at the back of the stacking
      // context regardless of where it's added relative to text nodes.
      bubble.insertBefore(badgeLayer, bubble.firstChild);
    }

    // Apply profile_border ring + profile_glow aura to the bubble's
    // outer edge so the XP tag visually "belongs" to the guesser even
    // beyond the hero_badge stained-glass interior. The glass morphism
    // (backdrop-filter + white rim highlights via box-shadow) stays
    // intact — we MERGE the cosmetic shadow into the existing box-shadow
    // string rather than replacing it, so the rim still pops.
    if (profileBorder && typeof profileBorder.border === 'string') {
      bubble.style.border = profileBorder.border;
    }
    const cosmeticShadows = [];
    if (profileBorder && typeof profileBorder.boxShadow === 'string') {
      cosmeticShadows.push(profileBorder.boxShadow);
    }
    if (profileGlow && typeof profileGlow.boxShadow === 'string') {
      cosmeticShadows.push(profileGlow.boxShadow);
    }
    if (cosmeticShadows.length > 0) {
      // Read computed style to pick up the alt.css default box-shadow,
      // then prepend the cosmetic shadows so they paint FIRST (outermost),
      // with the glass rim highlights still showing on top.
      const existing = window.getComputedStyle(bubble).boxShadow;
      const merged = (existing && existing !== 'none')
        ? cosmeticShadows.join(', ') + ', ' + existing
        : cosmeticShadows.join(', ');
      bubble.style.boxShadow = merged;
    }
    // Hero-badge animation: if the cosmetic has its own animation (e.g.
    // ov-gradient-flow for animated gradient badges), apply it to the
    // bubble. The float animation set by alt.css already coexists via
    // the keyframe being on a different property (transform/opacity).
    // We don't override the float animation — it's set in CSS, and
    // profile_border may add its own animation via the badge layer.

    this.layer.appendChild(bubble);

    // ─── Trail particle emission ─────────────────────────────────
    // While the bubble's CSS float animation runs, sample its actual
    // viewport rect each frame and emit a small gold sparkle at the
    // current bottom-center of the bubble. Reading the rect (vs.
    // computing position from the keyframe formula) lets us track the
    // browser's interpolated easing curve exactly. The emission is
    // throttled to every Nth frame so the trail reads as a wake of
    // distinct sparkles rather than a continuous smear.
    const startedAt = performance.now();
    let frameCount = 0;
    let trailRaf = 0;
    const trailTick = () => {
      const elapsed = performance.now() - startedAt;
      // Once trail emission is done, stop the rAF entirely. The bubble
      // itself is removed by the timeout below, so continuing to tick
      // after the wake has ended just burns frames for no visible gain.
      if (elapsed >= TRAIL_EMIT_UNTIL_MS || !bubble.parentNode || !this._particles) {
        trailRaf = 0;
        return;
      }
      // Skip emission during the very first frames — the bubble is still
      // scaling in (0% → 18% of the keyframe) and a trail before it has
      // taken shape would look strange. Wait until the bubble has begun
      // its upward drift (~250ms in). Stop emitting at TRAIL_EMIT_UNTIL_MS
      // so the last sparkles get to die before the bubble disappears
      // (otherwise the trail visibly lingers in empty space).
      if (elapsed > 250 && (frameCount % TRAIL_EMIT_EVERY_N_FRAMES === 0)) {
        const r = bubble.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // Spread the emission across the bubble's full width using
          // stratified random sampling: split the width into N equal
          // bands and pick a random X within each. Y is sampled from a
          // band along the bottom 35% of the bubble so trails appear
          // to peel off the bottom edge with some vertical scatter.
          // The result is a wide "curtain" of trailing sparkles instead
          // of a single thin column from one anchor point.
          const yBandTop = r.top + r.height * 0.65;
          const yBandBot = r.bottom;
          // Trail style depends on the guesser's equipped win_effect:
          //   • Themed effect equipped (hearts / heart_shower / etc.):
          //     emit the THEMED shape (actual fan-club heart PNG, real
          //     star, petal, etc.) as the trail PRIMARY. No gold here
          //     — the user explicitly equipped this cosmetic so their
          //     wake should read as that cosmetic.
          //   • No themed effect: stick with the gold sparkle wake.
          // The result is that a fan-club member's XP bubble drags a
          // ribbon of actual heart icons behind it, not gold sparkles
          // with a few hearts sprinkled in.
          const useThemedTrail = trailEffect && trailPalette
            && typeof this._particles.emitTrailShape === 'function';
          for (let j = 0; j < TRAIL_PARTICLES_PER_EMIT; j++) {
            const tFrac = (j + Math.random()) / TRAIL_PARTICLES_PER_EMIT;
            const cx = r.left + tFrac * r.width;
            const cy = yBandTop + Math.random() * (yBandBot - yBandTop);
            if (useThemedTrail) {
              this._particles.emitTrailShape(trailEffect, cx, cy, trailPalette, 1);
            } else {
              this._particles.emitTrail(cx, cy, '#ffd95a', 1);
            }
          }
        }
      }
      frameCount++;
      trailRaf = requestAnimationFrame(trailTick);
    };
    if (this._particles) trailRaf = requestAnimationFrame(trailTick);

    // Self-remove after the float-out animation completes. Slight extra
    // delay past FLOAT_DURATION_MS so the final frame paints before the
    // node detaches.
    setTimeout(() => {
      if (trailRaf) cancelAnimationFrame(trailRaf);
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, REMOVE_DELAY_MS);
  }

  dispose() {
    if (this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  }
}
