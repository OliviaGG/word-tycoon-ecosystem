/**
 * xp-flyout.js — per-letter XP numbers that pop out of each found tile and
 * arc into the score readout ("Variant B — Arc to HUD").
 *
 * Drop-in: include before the page's own scripts, then call XpFlyout.spawn()
 * from inside flashCells(), which already walks the word's cells in path order
 * on a per-letter stagger and already holds the finder's cosmetics.
 *
 * DESIGN NOTES — the non-obvious parts, all of which caused real bugs:
 *
 * 1. TWO LAYERS PER NUMBER. .xpfly owns MOTION (a Web Animations transform);
 *    .xpfly-ink owns the COSMETIC. word_color payloads carry their own
 *    `animation` (cfx-sweep, cfx-glitch, cfx-pulse …) and setting that on the
 *    element running the flight REPLACES the flight — the number never moves.
 *    Same split the grid already uses for .cell-finder-pfp / -rot.
 *
 * 2. NUMBERS LIVE ON A BODY-LEVEL FIXED LAYER, not inside the tile. Lit tiles
 *    take transform:scale(1.06), which would drag their children and skew the
 *    arc, and the grid clips. A fixed layer on <body> also means viewport
 *    coordinates from getBoundingClientRect() map 1:1 with no offsetParent maths.
 *
 * 3. THE ARC IS SAMPLED, NOT A CSS @keyframes. The control point depends on
 *    where each tile sits relative to the target, so every letter needs its own
 *    curve. Sampling to transform keyframes keeps it GPU-composited and
 *    transform/opacity-only — the subset that is safe in OBS.
 *
 * 4. TEARDOWN IS ON A TIMER, NEVER animationend. An OBS scene that is not
 *    active suspends animations and rAF entirely, so animationend may never
 *    fire and every number would be stranded on the grid until the next render.
 *
 * 5. THE TARGET IS RESOLVED LATE. In multiplayer the score lives in the
 *    word-announce card, which is display:none until the word lands — measuring
 *    it at spawn time returns a zero rect. Resolution happens when the flight
 *    starts, with a fallback chain and a final fixed point.
 */
(function () {
  'use strict';
  if (window.XpFlyout) return;

  // ── letter values ──────────────────────────────────────────────────
  // Mirrors LETTER_TIER_VALUE / LETTER_TIER in src/game.js. Values are computed
  // client-side rather than read off the socket payload so this works
  // identically on every surface (including the OBS overlay, which receives a
  // different event shape) and needs no server change. Keep in step with
  // src/game.js — the per-word TOTAL is always the server's number; these are
  // only the per-tile attribution of it.
  var TIER_VALUE = {
    common: 25, uncommon: 40, rare: 60, epic: 90, legendary: 140, mythic: 220, unique: 350
  };
  var TIER = {
    e:'common', t:'common', a:'common', o:'common', i:'common',
    n:'common', s:'common', h:'common', r:'common',
    d:'uncommon', l:'uncommon',
    c:'rare', u:'rare', m:'rare', w:'rare', f:'rare',
    g:'epic', y:'epic', p:'epic',
    b:'legendary', v:'legendary', k:'legendary',
    j:'mythic', x:'mythic',
    q:'unique', z:'unique'
  };
  var TIER_COLOR = {
    common:'#cbd5e1', uncommon:'#4ade80', rare:'#38bdf8', epic:'#a78bfa',
    legendary:'#fbbf24', mythic:'#fb7185', unique:'#f0abfc'
  };

  function tierOf(ch) { return TIER[String(ch).toLowerCase()] || null; }
  function valueOf(ch) { var t = tierOf(ch); return t ? TIER_VALUE[t] : 0; }
  function letterValues(word) {
    var out = [];
    String(word || '').toLowerCase().split('').forEach(function (c) { out.push(valueOf(c)); });
    return out;
  }

  // ── tunables ───────────────────────────────────────────────────────
  // Timing. Slowed deliberately (was 70/190/560 = ~1.17s for a 7-letter word,
  // now ~1.87s): at the old speed the numbers were gone before a viewer could
  // read them, which is the whole point of showing per-letter values. `hang` is
  // the readable beat — raise that first if it still feels quick.
  var DEFAULTS = {
    stagger: 130,    // per-letter launch spacing — wide enough that the letters
                     // read one at a time instead of all hanging at once
    hang:    480,    // pop out and HOLD, so the number is actually readable
    flight:  820,    // arc into the target
    arc:     0.55,   // curve depth as a fraction of the chord
    // Deliberately a NARROW range. Scaling font size straight off the value
    // made the common tiles — about 65% of every board — render their "XP"
    // suffix at ~8px, which is unreadable on a stream. The floor matters more
    // than the spread; rare letters still read as bigger.
    minSize: 16,
    maxSize: 28
  };
  // Hard ceiling on simultaneous numbers. A busy multiplayer board can land
  // several words a second; every extra number is another composited layer
  // repainting every frame of the stream.
  var MAX_LIVE = 48;
  var live = 0;

  // ── the fixed layer ────────────────────────────────────────────────
  var layer = null;
  function getLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.id = 'xpfly-layer';
    layer.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;' +
      'z-index:2147483000;overflow:visible;contain:layout style;';
    document.body.appendChild(layer);
    return layer;
  }

  var STYLE_ID = 'xpfly-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.xpfly{position:absolute;left:0;top:0;will-change:transform,opacity;' +
        'transform-origin:50% 50%;pointer-events:none}' +
      '.xpfly-ink{display:block;font-weight:900;line-height:1;white-space:nowrap;' +
        'font-variant-numeric:tabular-nums;transform:translate(-50%,-50%);' +
        'font-family:Inter,system-ui,"Segoe UI",sans-serif;' +
        'text-shadow:0 2px 6px rgba(0,0,0,.85)}' +
      '.xpfly-ink .xpfly-u{font-size:.66em;font-weight:800;margin-left:3px;' +
        'letter-spacing:.02em;opacity:1}' +
      // Impact ring. Drawn on the SHARED FIXED LAYER over the target's rect,
      // never appended to the target itself: .tp-card already runs
      // tp-cosmetic-frame-float / -surface-breathe transform animations, and a
      // pulse set on that element would clobber them. Positioning it on our own
      // layer also means the target needs no `position:relative`.
      '.xpfly-ring{position:absolute;border-radius:999px;pointer-events:none;' +
        'border:2px solid currentColor;will-change:transform,opacity}' +
      '@keyframes xpfly-ring-kf{0%{transform:translate(-50%,-50%) scale(.55);opacity:.85}' +
        '100%{transform:translate(-50%,-50%) scale(1.9);opacity:0}}';
    // NB: no `@media (prefers-reduced-motion: reduce){display:none}` here.
    // Hiding the layer removed the XP values entirely for anyone with Reduce
    // Motion switched on — which is a very common phone setting, and meant the
    // whole feature silently did nothing for them. Reduced motion is handled in
    // launch() instead: the numbers still appear and the counter still ticks,
    // they just don't travel.
    document.head.appendChild(s);
  }

  // ── cosmetics ──────────────────────────────────────────────────────
  // Rare+ word_color items are NOT a colour: they are a gradient clipped to the
  // glyphs with the fill made transparent, so setting `color` alone renders
  // nothing at all. Mirrors PfpCosmetics.paintText.
  var GRAD_KEYS = ['background-image', 'background-size', '-webkit-background-clip',
                   'background-clip', '-webkit-text-fill-color'];

  function paintInk(ink, cos, fallbackColor) {
    ink.style.color = fallbackColor;
    if (!cos) return;
    var wc = cos.word_color, wg = cos.word_glow;
    if (!wc && !wg) return;

    if (wc) {
      if (wc.color) ink.style.color = wc.color;
      if (wc.textShadow) ink.style.textShadow = wc.textShadow;
      if (wc.backgroundImage) {
        ink.style.backgroundImage = wc.backgroundImage;
        if (wc.backgroundSize) ink.style.backgroundSize = wc.backgroundSize;
        ink.style.webkitBackgroundClip = wc.webkitBackgroundClip || 'text';
        ink.style.backgroundClip = wc.backgroundClip || 'text';
        ink.style.webkitTextFillColor = wc.webkitTextFillColor || 'transparent';
      } else {
        for (var i = 0; i < GRAD_KEYS.length; i++) ink.style.removeProperty(GRAD_KEYS[i]);
      }
      if (wc.animation) ink.style.animation = wc.animation;
    }
    if (wg) {
      if (wg.textShadow) {
        ink.style.textShadow = (wc && wc.textShadow)
          ? wc.textShadow + ', ' + wg.textShadow
          : wg.textShadow;
      }
      // only if the colour did not already claim the slot
      if (wg.animation && !ink.style.animation) ink.style.animation = wg.animation;
    }
  }

  function tintOf(cos, fallback) {
    if (cos && cos.word_color && cos.word_color.color) return cos.word_color.color;
    return fallback;
  }

  // ── animation, with a fallback ─────────────────────────────────────
  // Older mobile browsers have no Web Animations API. The previous version
  // wrapped element.animate() in try/catch and destroyed the number on throw,
  // so those devices silently showed nothing at all. Now they fall back to a
  // CSS transition straight to the final frame — a straight line instead of an
  // arc, which is a fair degradation and vastly better than an invisible feature.
  var HAS_WAAPI = typeof Element.prototype.animate === 'function';

  function anim(el, frames, cfg) {
    if (HAS_WAAPI) {
      try { el.animate(frames, cfg); return true; } catch (e) { /* fall through */ }
    }
    var last = frames[frames.length - 1];
    var first = frames[0];
    try {
      el.style.transition = 'none';
      if (first.transform != null) el.style.transform = first.transform;
      if (first.opacity != null) el.style.opacity = String(first.opacity);
      void el.offsetWidth;                       // commit the start state
      el.style.transition = 'transform ' + cfg.duration + 'ms ' + (cfg.easing || 'ease') +
                            ', opacity ' + cfg.duration + 'ms ' + (cfg.easing || 'ease');
      if (last.transform != null) el.style.transform = last.transform;
      if (last.opacity != null) el.style.opacity = String(last.opacity);
      return true;
    } catch (e) { return false; }
  }

  function prefersReduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // ── geometry ───────────────────────────────────────────────────────
  function centreOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    // A display:none element (the multiplayer announce card before it opens)
    // reports 0x0 — treat that as "not available" rather than flying to 0,0.
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function resolveTarget(selectors, fallbackEl) {
    for (var i = 0; i < (selectors || []).length; i++) {
      var c = centreOf(document.querySelector(selectors[i]));
      if (c) return c;
    }
    // Last resort: just above the grid, so the numbers still travel somewhere
    // sensible instead of collapsing to the top-left corner.
    var g = fallbackEl && fallbackEl.getBoundingClientRect();
    if (g && g.width) return { x: g.left + g.width / 2, y: Math.max(12, g.top - 24) };
    return { x: window.innerWidth / 2, y: 40 };
  }

  // Quadratic bezier sampled into transform keyframes. See design note 3.
  function arcFrames(from, to, arc, steps) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    // control point pushed perpendicular to the chord and biased upward, so the
    // number always rises before diving into the target
    var lift = arc * len * 0.5;
    var cx = (from.x + to.x) / 2 + (-dy / len) * lift;
    var cy = (from.y + to.y) / 2 + (dx / len) * lift - Math.abs(arc) * 70;
    var frames = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, u = 1 - t;
      var x = u * u * from.x + 2 * u * t * cx + t * t * to.x;
      var y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
      var sc = t < 0.15 ? 1 + t * 0.5 : 1.075 - (t - 0.15) * 0.74;
      frames.push({
        offset: t,
        transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')',
        opacity: t > 0.86 ? String(((1 - t) / 0.14).toFixed(2)) : '1'
      });
    }
    return frames;
  }

  // ── one number, start to finish ────────────────────────────────────
  function launch(cellEl, value, tier, opts, delay) {
    if (live >= MAX_LIVE) return;
    var from = centreOf(cellEl);
    if (!from) return;

    live++;
    var host = getLayer();
    var fly = document.createElement('span');
    fly.className = 'xpfly';
    var ink = document.createElement('span');
    ink.className = 'xpfly-ink';
    ink.innerHTML = '+' + value.toLocaleString() + '<span class="xpfly-u">XP</span>';

    var t = value / (opts._maxValue || value || 1);
    ink.style.fontSize = (DEFAULTS.minSize + t * (DEFAULTS.maxSize - DEFAULTS.minSize)).toFixed(1) + 'px';
    // Cosmetic on the INK only — see design note 1.
    paintInk(ink, opts.cosmetics, TIER_COLOR[tier] || '#cbd5e1');

    fly.appendChild(ink);
    fly.style.transform = 'translate(' + from.x + 'px,' + from.y + 'px) scale(.32)';
    fly.style.opacity = '0';
    host.appendChild(fly);

    var done = false, arrived = false;

    // The arrival tick must happen EXACTLY once, and must never be lost.
    function arrive() {
      if (arrived) return;
      arrived = true;
      if (typeof opts.onArrive !== 'function') return;
      try { opts.onArrive(value); } catch (e) {}
    }

    function destroy() {
      if (done) return;
      done = true;
      // Fire the arrival first if it somehow hasn't yet. The teardown timer sits
      // only ~90ms after the arrival timer, and a throttled timer queue — an
      // inactive OBS scene, a backgrounded tab, a janky frame — coalesces the
      // two so teardown can run first. That silently dropped the tick and left
      // the rewound counter permanently short of the real total.
      arrive();
      live = Math.max(0, live - 1);
      if (fly.parentNode) fly.parentNode.removeChild(fly);
    }

    // ── reduced motion: show, don't fly ──────────────────────────────
    // Reduce Motion is a common phone setting. Suppressing the whole effect
    // there removed the XP values outright, which is a loss of INFORMATION, not
    // just polish. So the number still appears over its tile and the counter
    // still ticks — it simply doesn't travel, scale-bounce, or arc.
    if (opts.reduced) {
      fly.style.transform = 'translate(' + from.x + 'px,' + (from.y - 20) + 'px)';
      var hold = Math.max(500, Math.round((opts.hang + opts.flight) * 0.6));
      anim(fly, [{ opacity: 0 }, { opacity: 1, offset: 0.18 },
                 { opacity: 1, offset: 0.72 }, { opacity: 0 }],
           { duration: hold, easing: 'ease-out', fill: 'forwards' });
      var r1 = setTimeout(arrive, Math.round(hold * 0.45));
      var r2 = setTimeout(destroy, hold + 60);
      fly._xpflyKill = function () { clearTimeout(r1); clearTimeout(r2); destroy(); };
      return;
    }

    // 1 · pop out of the tile and hold, readable
    var rise = { x: from.x, y: from.y - 34 };
    if (!anim(fly, [
      { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(.32)', opacity: 0 },
      { transform: 'translate(' + rise.x + 'px,' + (from.y - 42) + 'px) scale(1.34)', opacity: 1, offset: 0.55 },
      { transform: 'translate(' + rise.x + 'px,' + rise.y + 'px) scale(1)', opacity: 1 }
    ], { duration: Math.max(120, opts.hang), easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'forwards' })) {
      destroy(); return;
    }

    // 2 · arc into the target — resolved NOW, not at spawn (design note 5)
    var t1 = setTimeout(function () {
      if (done || !fly.isConnected) return;
      var target = resolveTarget(opts.targetSelectors, opts.gridEl);
      if (!anim(fly, arcFrames(rise, target, opts.arc, 26),
                { duration: opts.flight, easing: 'cubic-bezier(.42,0,.3,1)', fill: 'forwards' })) {
        destroy(); return;
      }
      setTimeout(arrive, opts.flight);
    }, opts.hang);

    // 3 · teardown on a timer, never animationend (design note 4)
    var t2 = setTimeout(destroy, opts.hang + opts.flight + 90);
    fly._xpflyKill = function () { clearTimeout(t1); clearTimeout(t2); destroy(); };
  }

  // ── reactions: what the destination does when a number lands ───────

  /** A ring flashed over an element's rect, on our own layer. */
  function pulse(el, color) {
    if (!el) return;
    if (prefersReduced()) return;   // pure decoration, carries no information
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;          // hidden — nothing to flash
    injectStyle();
    var ring = document.createElement('span');
    ring.className = 'xpfly-ring';
    var size = Math.max(18, Math.min(r.width, r.height));
    ring.style.width  = size + 'px';
    ring.style.height = size + 'px';
    ring.style.left   = (r.left + r.width / 2) + 'px';
    ring.style.top    = (r.top + r.height / 2) + 'px';
    ring.style.color  = color || '#ffd54a';
    ring.style.animation = 'xpfly-ring-kf 420ms ease-out forwards';
    getLayer().appendChild(ring);
    setTimeout(function () { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 500);
  }

  /** The finder's podium card, if they happen to be on it. */
  function podiumCard(containerId, finder) {
    if (!finder || !finder.platformUserId) return null;
    var c = document.getElementById(containerId || 'top-players');
    if (!c) return null;
    try {
      return c.querySelector('.tp-card[data-userid="' +
        String(finder.platformUserId).replace(/["\\]/g, '') + '"]');
    } catch (e) { return null; }
  }

  /**
   * reactor({ counterEl, letterTotal, pulseEls, color }) -> onArrive handler
   *
   * The counter REWINDS rather than counting from zero. The destination already
   * shows the true word total (base + letters + length bonus), but only the
   * LETTER portion is carried by tiles — counting up from zero would land
   * short. So we read whatever total is already on screen, subtract the letter
   * total, and let the arriving numbers put it back. It therefore always ends
   * on exactly the figure that was there, with no knowledge of the rarity bases.
   *
   * If anything else rewrites that element mid-flight (solo's updatePlayerCard
   * is called from several places), the next tick simply rewrites it and the
   * final tick still lands on the true total.
   */
  function reactor(o) {
    o = o || {};
    var el = o.counterEl || null;
    var pulseEls = o.pulseEls || [];
    var color = o.color || null;
    var cur = null, prefix = '';

    if (el && o.letterTotal > 0) {
      var raw = String(el.textContent || '');
      prefix = /^\s*\+/.test(raw) ? '+' : '';
      var total = parseInt(raw.replace(/[^\d-]/g, ''), 10);
      if (isFinite(total)) {
        cur = total - o.letterTotal;
        el.textContent = prefix + cur.toLocaleString();
      }
    }

    return function onArrive(value) {
      if (el && cur != null) {
        cur += value;
        el.textContent = prefix + cur.toLocaleString();
      }
      for (var i = 0; i < pulseEls.length; i++) pulse(pulseEls[i], color);
    };
  }

  // ── public API ─────────────────────────────────────────────────────
  /**
   * spawn({ word, cellEls, gridEl, targetSelectors, cosmetics, stagger, hang,
   *         flight, arc, onArrive })
   *
   * cellEls          the word's cell elements IN PATH ORDER — index i must be
   *                  the tile carrying word[i]
   * cosmetics        the finder's equipped cosmetics, ALREADY passed through
   *                  the surface's applyViewerVisibility() so a viewer who
   *                  turned word cosmetics off does not see them here
   * targetSelectors  ordered fallback chain; first one with a real rect wins
   */
  function spawn(o) {
    o = o || {};
    if (!o.word || !o.cellEls || !o.cellEls.length) return;
    injectStyle();

    // Reduce Motion no longer suppresses the effect — it switches launch() to a
    // show-and-fade with no travel. Callers can force it with o.reduced.
    var reduced = o.reduced != null ? !!o.reduced : prefersReduced();

    var vals = letterValues(o.word);
    var opts = {
      cosmetics:       o.cosmetics || null,
      gridEl:          o.gridEl || null,
      targetSelectors: o.targetSelectors || [],
      hang:            o.hang   != null ? o.hang   : DEFAULTS.hang,
      flight:          o.flight != null ? o.flight : DEFAULTS.flight,
      arc:             o.arc    != null ? o.arc    : DEFAULTS.arc,
      onArrive:        o.onArrive,
      reduced:         reduced,
      _maxValue:       Math.max.apply(null, vals.concat([1]))
    };
    // With no travel there is nothing to spread out, so the letters land in a
    // brisker sequence rather than dragging the whole word out.
    var stagger = o.stagger != null ? o.stagger
                : (reduced ? Math.round(DEFAULTS.stagger * 0.6) : DEFAULTS.stagger);

    for (var n = 0; n < o.cellEls.length && n < vals.length; n++) {
      if (!vals[n]) continue;                         // unknown glyph — nothing to throw
      (function (cell, value, tier, delay) {
        setTimeout(function () { launch(cell, value, tier, opts, delay); }, delay);
      })(o.cellEls[n], vals[n], tierOf(o.word[n]), n * stagger);
    }
  }

  // Called when the grid is rebuilt underneath us, so nothing is left floating
  // over a board it no longer belongs to.
  function clearAll() {
    if (!layer) return;
    var nodes = layer.querySelectorAll('.xpfly');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i]._xpflyKill) nodes[i]._xpflyKill();
      else if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
    live = 0;
  }

  /** Sum of a word's letter values — what the tiles collectively carry. */
  function letterTotal(word) {
    return letterValues(word).reduce(function (a, b) { return a + b; }, 0);
  }

  window.XpFlyout = {
    spawn: spawn,
    clearAll: clearAll,
    reactor: reactor,
    pulse: pulse,
    podiumCard: podiumCard,
    letterTotal: letterTotal,
    letterValues: letterValues,
    valueOf: valueOf,
    tierOf: tierOf,
    TIER_VALUE: TIER_VALUE,
    TIER_COLOR: TIER_COLOR
  };
})();
