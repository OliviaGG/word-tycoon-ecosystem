// ===== Animated Background =====
// Mirror of the parent overlay's anim-bg renderer (in chat-relay's
// public/streamer/goals-overlay.html). Rendered INSIDE searchle's
// iframe document so backdrop-filter on glass cards has same-document
// pixels to sample — cross-iframe blur is a no-op, so without this the
// ranked card glass effect doesn't work.
//
// Five presets: gradient-pulse (pure CSS), ripples (canvas), particles
// (canvas), vertical-scroll (DOM strip), petri (canvas). Each preset
// has its own RAF loop and is torn down before swapping.
//
// Parent + iframe both render the SAME preset with the SAME colors so
// they visually overlay continuously across the iframe boundary. Frame
// sync isn't perfect across documents — for slow presets it's invisible,
// for ripples a slight edge desync may show.

let _activeStop = null;
let _activeRaf = null;
let _layer = null;
let _styleTag = null;
// Active mount config — kept so tint() can blend a transient color
// (e.g. winner's hero-badge gradient) on top of the streamer's chosen
// primary/secondary without losing the originals.
let _activeConfig = null;
let _tintColor = null;          // hex string, null when no active tint
let _tintExpiresAt = 0;          // ms epoch when the tint ends + fades
const TINT_FADE_MS = 1800;       // fade in / out window inside the duration

const STYLE_CSS = `
#anim-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: -1;
  /* Center-anchored so x/y/scale transform from the layer's middle. */
  transform-origin: center center;
}
#anim-bg-name {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-family: 'Outfit', system-ui, sans-serif;
  font-weight: 900;
  font-size: 14vw;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.10);
  text-transform: uppercase;
  user-select: none;
  text-shadow: 0 4px 24px rgba(0,0,0,0.35);
  z-index: 1;
}
#anim-bg-layer canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
#anim-bg-layer .vscroll {
  position: absolute;
  top: 0; left: 50%;
  transform: translateX(-50%);
  width: 120px;
  height: 100%;
  overflow: hidden;
}
#anim-bg-layer .vscroll-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: animBgScroll var(--anim-bg-scroll-dur, 200s) linear infinite;
  will-change: transform;
}
@keyframes animBgScroll {
  0%   { transform: translateY(0); }
  100% { transform: translateY(-50%); }
}
#anim-bg-layer .vscroll .v-letter {
  width: 120px;
  text-align: center;
  font-family: 'Outfit', system-ui, sans-serif;
  font-weight: 900;
  font-size: 64px;
  line-height: 0.95;
  padding: 4px 0;
  text-transform: uppercase;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5);
  color: var(--anim-bg-fg, #fff);
}
#anim-bg-layer .vscroll .v-letter.faded { opacity: 0.38; }
#anim-bg-layer .vscroll .v-letter.tld   { font-size: 44px; }
#anim-bg-layer.preset-gradient-pulse {
  background:
    radial-gradient(circle at var(--gp-x, 50%) var(--gp-y, 50%),
      var(--anim-bg-primary, #5865F2) 0%,
      var(--anim-bg-secondary, #0a0e1a) 70%);
  animation: animBgGradient var(--anim-bg-gp-dur, 16s) ease-in-out infinite alternate;
}
@keyframes animBgGradient {
  0%   { --gp-x: 30%; --gp-y: 40%; filter: hue-rotate(0deg)   brightness(1); }
  50%  { --gp-x: 70%; --gp-y: 60%; filter: hue-rotate(20deg)  brightness(1.08); }
  100% { --gp-x: 50%; --gp-y: 50%; filter: hue-rotate(-15deg) brightness(0.95); }
}
@property --gp-x { syntax: '<percentage>'; inherits: true; initial-value: 50%; }
@property --gp-y { syntax: '<percentage>'; inherits: true; initial-value: 50%; }
`;

function _ensureStyle() {
  if (_styleTag) return;
  _styleTag = document.createElement('style');
  _styleTag.id = 'anim-bg-style';
  _styleTag.textContent = STYLE_CSS;
  document.head.appendChild(_styleTag);
}

function _ensureLayer() {
  if (_layer) return _layer;
  _ensureStyle();
  _layer = document.createElement('div');
  _layer.id = 'anim-bg-layer';
  document.body.appendChild(_layer);
  return _layer;
}

function _teardown() {
  if (_activeStop) { try { _activeStop(); } catch (_) {} _activeStop = null; }
  if (_activeRaf) { cancelAnimationFrame(_activeRaf); _activeRaf = null; }
  if (_layer) {
    _layer.className = '';
    _layer.innerHTML = '';
    _layer.removeAttribute('style');
  }
}

function _viewport() {
  // Searchle's iframe is sized to the host's chosen canvas. We use the
  // actual document size so the canvas matches whatever the host gave us.
  // Min 720x1280 keeps the renderer sensible if it boots into a 0x0 frame.
  return {
    W: Math.max(720, window.innerWidth || 720),
    H: Math.max(1280, window.innerHeight || 1280),
  };
}

// ===== Color helpers =====
function _hexToRgb(hex) {
  const s = String(hex || '').trim();
  if (!s.startsWith('#')) return null;
  let h = s.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function _hexToRgba(hex, alpha) {
  const s = String(hex || '').trim();
  if (!s.startsWith('#')) return s;
  let h = s.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return s;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, alpha)) + ')';
}
function _shade(hex, percent) {
  const s = String(hex || '').trim();
  if (!s.startsWith('#')) return s;
  let h = s.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return s;
  const f = (1 + percent / 100);
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(parseInt(h.slice(0, 2), 16) * f);
  const g = clamp(parseInt(h.slice(2, 4), 16) * f);
  const b = clamp(parseInt(h.slice(4, 6), 16) * f);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
function _hexToHsl(hex) {
  const rgb = _hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function _hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if      (h <  60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r1) + toHex(g1) + toHex(b1);
}
function _petriPalette(seedHex, count) {
  const out = [];
  const hsl = _hexToHsl(seedHex);
  if (!hsl) return [seedHex];
  const step = 360 / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const h = (hsl.h + i * step) % 360;
    out.push(_hslToHex(h, Math.max(0.5, hsl.s), Math.min(0.65, Math.max(0.45, hsl.l))));
  }
  return out;
}
function _mixHex(a, b, t) {
  const ra = _hexToRgb(a), rb = _hexToRgb(b);
  if (!ra || !rb) return a;
  const lerp = (x, y) => Math.round(x + (y - x) * t);
  return '#' + [lerp(ra.r, rb.r), lerp(ra.g, rb.g), lerp(ra.b, rb.b)]
    .map(n => n.toString(16).padStart(2, '0')).join('');
}

// ===== Presets =====
function _bgGradientPulse(layer, c) {
  layer.classList.add('preset-gradient-pulse');
  const dur = Math.max(6, 30 - c.speed * 2.4);
  layer.style.setProperty('--anim-bg-gp-dur', dur.toFixed(1) + 's');
}

function _bgRipples(layer, c) {
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const ctx = cvs.getContext('2d');
  const { W, H } = _viewport();
  cvs.width = W; cvs.height = H;
  // Rebuilt per-frame so tint() can re-tone the gradient mid-animation.
  let _grd = null, _grdKey = '';
  function _gradFor() {
    const sec = _effectiveSecondary() || c.secondaryColor;
    if (sec !== _grdKey) {
      _grd = ctx.createLinearGradient(0, 0, 0, H);
      _grd.addColorStop(0, sec);
      _grd.addColorStop(1, _shade(sec, -10));
      _grdKey = sec;
    }
    return _grd;
  }
  const ripples = [];
  const speed = 0.4 + c.speed * 0.4;
  const spawnEvery = Math.max(8, 60 - c.intensity * 5);
  let tick = 0;
  function frame() {
    ctx.fillStyle = _gradFor();
    ctx.fillRect(0, 0, W, H);
    tick++;
    if (tick % spawnEvery === 0) {
      ripples.push({ x: Math.random() * W, y: Math.random() * H, r: 0, life: 1 });
      if (ripples.length > 60) ripples.shift();
    }
    const strokeColor = _effectivePrimary() || c.primaryColor;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += speed;
      rp.life -= 0.005;
      if (rp.life <= 0) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = _hexToRgba(strokeColor, rp.life * 0.7);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

function _bgParticles(layer, c) {
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const ctx = cvs.getContext('2d');
  const { W, H } = _viewport();
  cvs.width = W; cvs.height = H;
  const count = 30 + c.intensity * 12;
  const vSpeed = 0.3 + c.speed * 0.25;
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 4 + Math.random() * 18,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.5 + Math.random()) * vSpeed,
      alpha: 0.15 + Math.random() * 0.35,
      hue: Math.random(),
    });
  }
  // Rebuilt per-frame so tint() can re-tone mid-animation.
  let _grd = null, _grdKey = '';
  function _gradFor() {
    const sec = _effectiveSecondary() || c.secondaryColor;
    if (sec !== _grdKey) {
      _grd = ctx.createLinearGradient(0, 0, 0, H);
      _grd.addColorStop(0, sec);
      _grd.addColorStop(1, _shade(sec, -12));
      _grdKey = sec;
    }
    return _grd;
  }
  function frame() {
    ctx.fillStyle = _gradFor();
    ctx.fillRect(0, 0, W, H);
    const primEff = _effectivePrimary() || c.primaryColor;
    const secEff = _effectiveSecondary() || c.secondaryColor;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y + p.r < 0) { p.y = H + p.r; p.x = Math.random() * W; }
      if (p.x < -50) p.x = W + 50;
      if (p.x > W + 50) p.x = -50;
      const col = p.hue < 0.5 ? primEff : secEff;
      const rad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      rad.addColorStop(0, _hexToRgba(col, p.alpha));
      rad.addColorStop(1, _hexToRgba(col, 0));
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

function _bgVerticalScroll(layer, c) {
  const strip = document.createElement('div');
  strip.className = 'vscroll';
  const inner = document.createElement('div');
  inner.className = 'vscroll-inner';
  strip.appendChild(inner);
  layer.appendChild(strip);
  // Iframe is always searchle — hardcode the brand for the strip.
  const gameName = 'SEARCHLE';
  const url = 'subtextle.com';
  const block = document.createElement('div');
  gameName.split('').forEach((ch) => {
    const d = document.createElement('div');
    d.className = 'v-letter';
    d.textContent = ch;
    block.appendChild(d);
  });
  const sp1 = document.createElement('div');
  sp1.className = 'v-letter';
  sp1.style.height = '36px';
  block.appendChild(sp1);
  url.toUpperCase().split('').forEach((ch) => {
    const d = document.createElement('div');
    d.className = 'v-letter faded';
    if (ch === '.') d.classList.add('tld');
    d.textContent = ch;
    block.appendChild(d);
  });
  const sp2 = document.createElement('div');
  sp2.className = 'v-letter';
  sp2.style.height = '60px';
  block.appendChild(sp2);
  inner.appendChild(block.cloneNode(true));
  inner.appendChild(block.cloneNode(true));
  const dur = Math.max(60, 400 - c.speed * 34);
  inner.style.setProperty('--anim-bg-scroll-dur', dur + 's');
  layer.style.background = 'linear-gradient(180deg, ' + c.secondaryColor + ' 0%, ' + _shade(c.secondaryColor, -8) + ' 100%)';
  _activeStop = () => { if (strip.parentNode) strip.parentNode.removeChild(strip); };
}

// ===== Petri Evolution =====
// Self-contained ecosystem: 12-trait genome per blob, behavior driven
// by aggression (chase / evade / drift), energy economy via metabolism +
// absorption, toxin warfare with resistance, lifespan vs reproduction-
// rate tradeoff, cooperation (same-hue tribe). Reproduction blends two
// genomes + ±10% mutation. Population auto-balanced — below floor a
// random new species seeds in; above cap the oldest dies. Long-term
// arms-race dynamics emerge: aggressive strains dominate then crash
// from prey scarcity, friendly strains recolonize, repeat.

// Random in [a, b)
function _rand(a, b) { return a + Math.random() * (b - a); }
// Clamp to [0,1]
function _c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Weighted shape pick. Anatomical creatures (humanoid, ant) are biased
// heavier than geometric shapes so the dish reads as "ecosystem of
// little organisms" rather than "drifting polygons".
// 0=circle 1=tri 2=square 3=pent 4=star 5=humanoid 6=starfish 7=amoeba 8=ant
const _SHAPE_WEIGHTS = [1, 1, 1, 1, 1, 3, 2, 1, 3];
const _SHAPE_WEIGHT_SUM = _SHAPE_WEIGHTS.reduce((a, b) => a + b, 0);
function _pickShape() {
  let r = Math.random() * _SHAPE_WEIGHT_SUM;
  for (let i = 0; i < _SHAPE_WEIGHTS.length; i++) {
    r -= _SHAPE_WEIGHTS[i];
    if (r < 0) return i;
  }
  return _SHAPE_WEIGHTS.length - 1;
}

// Build a random genome respecting the high-reproduction-vs-long-lifespan
// and toxin-vs-metabolic-efficiency tradeoffs.
function _randomGenome(seedHue) {
  const aggression = _c01(_rand(0, 1));
  const reproductionRate = _c01(_rand(0.1, 1));
  // Tradeoff: long lifespan precludes high reproduction.
  const lifespan = _c01(1.2 - reproductionRate + _rand(-0.15, 0.15));
  const toxinProduction = _c01(_rand(0, 1));
  // Tradeoff: toxin production drains energy → poorer metabolic efficiency.
  const metabolism = _c01(toxinProduction * 0.7 + _rand(0, 0.4));
  return {
    speed: _c01(_rand(0.15, 1)),
    aggression,
    // Shape index — 9 forms: 0=circle, 1=triangle, 2=square, 3=pentagon,
    // 4=star, 5=humanoid (head/torso/arms/legs), 6=starfish (5 tentacles
    // from a central body), 7=amoeba (lumpy organic blob), 8=ant (3 body
    // segments + 6 legs + 2 antennae). Weighted via _pickShape so the
    // anatomical creatures (humanoid + ant) dominate.
    shape: _pickShape(),
    size: _c01(_rand(0.2, 1)),
    hue: typeof seedHue === 'number' ? seedHue : Math.random() * 360,
    perception: _c01(_rand(0.2, 1)),
    metabolism,
    lifespan,
    resistance: _c01(_rand(0, 1)),
    toxinProduction,
    reproductionRate,
    cooperation: _c01(_rand(0, 1)),
  };
}

// Blend two genomes + per-trait ±mutationStrength mutation. Discrete
// traits (shape) inherit from one parent + mutation chance to flip.
function _blendGenome(g1, g2, mutationStrength = 0.1) {
  const mix = (a, b) => (a + b) * 0.5 + _rand(-mutationStrength, mutationStrength);
  const mixHue = (a, b) => {
    // Shortest arc on the hue circle, then mutate.
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * 0.5 + _rand(-30, 30) * mutationStrength * 5 + 720) % 360;
  };
  const reproductionRate = _c01(mix(g1.reproductionRate, g2.reproductionRate));
  // Re-apply tradeoff after blend so children don't escape the constraint.
  const lifespan = _c01(Math.min(mix(g1.lifespan, g2.lifespan), 1.3 - reproductionRate));
  const toxinProduction = _c01(mix(g1.toxinProduction, g2.toxinProduction));
  const metabolism = _c01(Math.max(mix(g1.metabolism, g2.metabolism), toxinProduction * 0.6));
  return {
    speed: _c01(mix(g1.speed, g2.speed)),
    aggression: _c01(mix(g1.aggression, g2.aggression)),
    shape: Math.random() < 0.1 ? _pickShape() : (Math.random() < 0.5 ? g1.shape : g2.shape),
    size: _c01(mix(g1.size, g2.size)),
    hue: mixHue(g1.hue, g2.hue),
    perception: _c01(mix(g1.perception, g2.perception)),
    metabolism,
    lifespan,
    resistance: _c01(mix(g1.resistance, g2.resistance)),
    toxinProduction,
    reproductionRate,
    cooperation: _c01(mix(g1.cooperation, g2.cooperation)),
  };
}

// Derived render values from a genome.
function _gRadius(g, baseR) { return baseR * (0.5 + g.size * 1.4); }
function _gSpeed(g, baseV)  { return baseV * (0.3 + g.speed * 1.7); }
function _gColor(g, lightnessShift = 0) {
  // Aggressive → vivid + slightly darker; friendly → pastel + lighter.
  const sat = 35 + g.aggression * 55;
  const lit = 60 - g.aggression * 18 + lightnessShift;
  return `hsl(${g.hue.toFixed(0)}, ${sat.toFixed(0)}%, ${Math.max(20, Math.min(85, lit)).toFixed(0)}%)`;
}

// Draw a smooth fluid-wobbled outline. Samples N points along a polar
// curve defined by radiusFn(angle), perturbs each with a low-freq +
// high-freq sine driven by `phase`, then connects them with quadratic
// curves through midpoints — same recipe the amoeba uses, applied
// universally so every shape pulses like a living organism.
function _fluidLoop(ctx, x, y, r, N, radiusFn, phase, wobbleAmt) {
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const baseR = radiusFn(ang) * r;
    const wob = 1
      + Math.sin(ang * 3 + phase)        * wobbleAmt
      + Math.sin(ang * 7 + phase * 1.7)  * wobbleAmt * 0.45;
    pts[i] = { x: x + Math.cos(ang) * baseR * wob, y: y + Math.sin(ang) * baseR * wob };
  }
  const first = pts[0], last = pts[N - 1];
  ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
  for (let i = 0; i < N; i++) {
    const c = pts[i], n = pts[(i + 1) % N];
    ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2);
  }
}

// Regular-polygon radial distance: corners reach r, edge midpoints sit
// closer at r*cos(π/sides). Rotation aligns one corner upward.
function _polyRadiusFn(sides, rotation) {
  const segHalf = Math.PI / sides;
  const apothem = Math.cos(segHalf);
  return (ang) => {
    const local = ((ang - rotation + Math.PI / 2) % (2 * segHalf) + 2 * segHalf) % (2 * segHalf) - segHalf;
    return apothem / Math.cos(local);
  };
}

// Draw a shape centered at (x,y) with bounding radius r. All shapes use
// fluid smooth-curve outlines so they read as living things rather than
// rigid geometry. `phase` drives the wobble; `fluidity` scales it
// (aggressive sharper, friendly more flowing).
//   0=circle, 1=triangle, 2=square, 3=pentagon, 4=star
//   5=humanoid (head+torso+arms+legs, each a small fluid blob)
//   6=starfish (central body + 5 fluid tentacle bulbs)
//   7=amoeba (organic lumpy blob — the original fluid shape)
function _drawShape(ctx, x, y, r, shapeIdx, rotation = 0, phase = 0, fluidity = 1) {
  ctx.beginPath();
  // Wobble amplitude — kept gentle so shapes read as breathing rather
  // than seizing. Aggressive fluidity ≈ 0.5 → ~1% wobble; friendly ≈ 1.4
  // → ~3% wobble.
  const wob = 0.02 * fluidity;
  if (shapeIdx === 0) {
    _fluidLoop(ctx, x, y, r, 18, () => 1, phase, wob);
    return;
  }
  if (shapeIdx === 4) {
    // Star: 10-lobe polar curve alternating outer (1) / inner (0.45).
    // Sample densely so the curves sweep smoothly between points.
    _fluidLoop(ctx, x, y, r, 60, (ang) => {
      // 10 segments around the circle; ratio in segment maps to a smooth
      // peak-trough using cos so the curve is differentiable everywhere.
      const segLen = (2 * Math.PI) / 10;
      const local = ((ang - rotation + Math.PI / 2) % segLen + segLen) % segLen - segLen / 2;
      // Two peaks per segment? No — alternate by floor(seg index).
      const segIdx = Math.floor(((ang - rotation + Math.PI / 2 + segLen) % (2 * Math.PI)) / segLen);
      const outer = (segIdx % 2 === 0);
      const a = outer ? 1 : 0.45;
      // Soften the transition between outer and inner so the path bends rather than kinks.
      const t = Math.abs(local) / (segLen / 2);
      return a + (outer ? -1 : 1) * (1 - 0.45) * 0.18 * t;
    }, phase, wob);
    return;
  }
  if (shapeIdx === 5) {
    // Humanoid silhouette — each body part is a tiny fluid blob, all
    // composed into one path for a single fill+stroke pass.
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const place = (lx, ly, rad) => {
      const cx = x + lx * cos - ly * sin;
      const cy = y + lx * sin + ly * cos;
      // Per-part phase offsets so limbs wobble independently.
      _fluidLoop(ctx, cx, cy, rad, 12, () => 1, phase + (lx + ly) * 0.5, wob * 0.8);
    };
    place(0,         -r * 0.65, r * 0.32);    // head
    place(0,         -r * 0.05, r * 0.42);    // torso
    place(-r * 0.55, -r * 0.05, r * 0.18);    // left arm
    place( r * 0.55, -r * 0.05, r * 0.18);    // right arm
    place(-r * 0.25,  r * 0.55, r * 0.20);    // left leg
    place( r * 0.25,  r * 0.55, r * 0.20);    // right leg
    return;
  }
  if (shapeIdx === 6) {
    // Starfish: central body + 5 fluid tentacle bulbs.
    _fluidLoop(ctx, x, y, r * 0.42, 14, () => 1, phase * 0.7, wob);
    for (let i = 0; i < 5; i++) {
      const ang = rotation - Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const tx = x + Math.cos(ang) * r * 0.78;
      const ty = y + Math.sin(ang) * r * 0.78;
      _fluidLoop(ctx, tx, ty, r * 0.26, 12, () => 1, phase + i * 0.9, wob * 1.2);
    }
    return;
  }
  if (shapeIdx === 7) {
    // Amoeba: bigger built-in wobble (it's the most fluid shape, that's its identity).
    _fluidLoop(ctx, x, y, r, 14, () => 0.92, phase, wob * 3.5);
    return;
  }
  if (shapeIdx === 8) {
    // Ant — 3 overlapping body segments (head/thorax/abdomen) + 6
    // jointed legs (each a chain of 4 overlapping blobs that read as
    // a continuous limb after fill+stroke) + 2 antennae (3-blob chains).
    // Legs animate via phase-driven swing in a tripod gait so the ant
    // visibly walks. The membrane stroke that wraps every individual
    // blob is what ties the chain into a unified silhouette.
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const legWob = wob * 0.4; // limbs are tiny — keep their wobble subtle
    const place = (lx, ly, rad, wAmt) => {
      const cx = x + lx * cos - ly * sin;
      const cy = y + lx * sin + ly * cos;
      _fluidLoop(ctx, cx, cy, rad, 12, () => 1, phase + (lx + ly) * 0.5, wAmt != null ? wAmt : wob * 0.8);
    };

    // Body — abdomen rear, thorax middle, head front. Spacing tuned so
    // each segment's fill overlaps its neighbor — reads as one body.
    place(-r * 0.55, 0, r * 0.46);  // abdomen (largest)
    place( 0,        0, r * 0.30);  // thorax
    place( r * 0.50, 0, r * 0.36);  // head

    // Tripod gait — two alternating leg groups (A vs B), 180° out of
    // phase. swingFreq 6 → ~0.7s per full leg cycle at default phase
    // increment, matching a brisk ant pace. Swing displaces the leg
    // anchor fore/aft along the body axis so legs visibly step.
    const swingFreq = 6;
    const swingMag = 0.30;
    const sA = Math.sin(phase * swingFreq) * swingMag;
    const sB = Math.sin(phase * swingFreq + Math.PI) * swingMag;

    // Leg anchors: 3 pairs along the body, splayed left/right.
    // tri 0 → swing in phase with sA; tri 1 → in phase with sB.
    const legs = [
      { ax:  r * 0.18, side: -1, tri: 0 }, // front-left
      { ax:  r * 0.18, side:  1, tri: 1 }, // front-right
      { ax:  0,        side: -1, tri: 1 }, // mid-left
      { ax:  0,        side:  1, tri: 0 }, // mid-right
      { ax: -r * 0.18, side: -1, tri: 0 }, // rear-left
      { ax: -r * 0.18, side:  1, tri: 1 }, // rear-right
    ];
    for (const L of legs) {
      const sw = L.tri ? sA : sB;
      const tipX = L.ax + sw * r;
      const tipY = L.side * r * 1.05;
      // 4 chain blobs from thorax-edge out to foot, each one a bit
      // smaller. Sinusoidal cross-axis bulge gives a knee bend in the
      // middle. Adjacent blobs overlap so the stroke renders an
      // unbroken limb outline.
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const bulge = Math.sin(t * Math.PI) * r * 0.12 * L.side;
        const segX = L.ax * (1 - t) + tipX * t;
        const segY = L.side * r * 0.22 * (1 - t) + tipY * t + bulge;
        const rad = r * (0.12 - t * 0.04);
        place(segX, segY, rad, legWob);
      }
    }

    // 2 antennae — 3-blob chains forward of head, bobbing on a
    // slower-than-legs frequency so they read as separate motion.
    const antBob = Math.sin(phase * swingFreq * 0.55) * 0.18;
    for (const side of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        const ax = r * 0.78 + t * r * 0.55;
        const ay = side * (r * 0.18 + t * r * 0.38) + side * antBob * r * (1 - t);
        const rad = r * (0.09 - t * 0.025);
        place(ax, ay, rad, legWob);
      }
    }
    return;
  }
  // Triangle / square / pentagon — fluid-smoothed polygon outline.
  const sides = shapeIdx === 1 ? 3 : shapeIdx === 2 ? 4 : 5;
  _fluidLoop(ctx, x, y, r, sides * 8, _polyRadiusFn(sides, rotation), phase, wob);
}

// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// PSY-* PRESETS — ported from chat-relay/goals-overlay.html
// ═══════════════════════════════════════════════════════════════════════
// 11 variants of high-energy stylized backgrounds (aurora, lava, phoenix,
// solar, tidal, deep, vaporwave, kaleidoscope, chrome, void, supernova).
// Dispatcher _bgPsy(layer, c, variant) routes to per-variant renderers.

function _psyCanvas(layer) {
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const { W, H } = _viewport();
  cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  return { cvs, ctx: cvs.getContext('2d'), W, H };
}

// ── Dispatcher ──
function _bgPsy(layer, c, variant) {
  layer.classList.add('preset-psy-' + variant);
  switch (variant) {
    case 'aurora':       _bgPsyAurora(layer, c); break;
    case 'lava':         _bgPsyLava(layer, c); break;
    case 'phoenix':      _bgPsyPhoenix(layer, c); break;
    case 'solar':        _bgPsySolar(layer, c); break;
    case 'tidal':        _bgPsyTidal(layer, c); break;
    case 'deep':         _bgPsyDeep(layer, c); break;
    case 'vaporwave':    _bgPsyVaporwave(layer, c); break;
    case 'kaleidoscope': _bgPsyKaleidoscope(layer, c); break;
    case 'chrome':       _bgPsyChrome(layer, c); break;
    case 'void':         _bgPsyVoid(layer, c); break;
    case 'supernova':    _bgPsySupernova(layer, c); break;
  }
}

// ── Aurora: flowing ribbons + falling sparkles ──
function _bgPsyAurora(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const ribbons = 4;
  const sparkles = Array.from({ length: 30 + intn * 8 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() * 2 + 0.5,
    vy: 0.3 + Math.random() * 1.2, ph: Math.random() * 10
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, _shade(sec, -30));
    grd.addColorStop(1, _shade(sec, -55));
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < ribbons; i++) {
      const phase = t * 0.0012 * sp + i * 1.7;
      const yc = H * (0.2 + (i / ribbons) * 0.6);
      const wavelen = W * (0.4 + i * 0.12);
      ctx.beginPath();
      for (let x = -50; x <= W + 50; x += 14) {
        const y = yc + Math.sin(x / wavelen + phase) * 90 + Math.sin(x / (wavelen*0.45) + phase * 2.1) * 35;
        if (x === -50) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 70 + Math.sin(phase * 1.3) * 25;
      const g2 = ctx.createLinearGradient(0, yc - 90, 0, yc + 90);
      g2.addColorStop(0,   _hexToRgba(prim, 0));
      g2.addColorStop(0.5, _hexToRgba(prim, 0.55));
      g2.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.strokeStyle = g2; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of sparkles) {
      s.y += s.vy * (0.4 + sp * 0.18);
      if (s.y > H) { s.y = -10; s.x = Math.random() * W; }
      const a = 0.4 + Math.sin(t * 0.06 + s.ph) * 0.45;
      ctx.fillStyle = _hexToRgba(prim, Math.max(0.05, a));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Lava: bubbling molten blobs + rising sparks ──
function _bgPsyLava(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const blobs = Array.from({ length: 4 + Math.floor(intn * 0.5) }, () => ({
    x: Math.random() * W, y: H + Math.random() * H * 0.4,
    r: 80 + Math.random() * 140,
    vy: -(0.4 + Math.random() * 0.9),
    ph: Math.random() * 6
  }));
  const sparks = Array.from({ length: 20 + intn * 6 }, () => ({
    x: Math.random() * W, y: H * 0.6 + Math.random() * H * 0.4,
    vx: (Math.random() - 0.5) * 0.6, vy: -(0.8 + Math.random() * 1.4),
    r: Math.random() * 2 + 0.6, life: Math.random()
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    const grd = ctx.createRadialGradient(W/2, H, 0, W/2, H, H);
    grd.addColorStop(0, _shade(sec, 5));
    grd.addColorStop(1, _shade(sec, -40));
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (const b of blobs) {
      b.y += b.vy * (0.5 + sp * 0.18);
      if (b.y < -b.r) { b.y = H + b.r; b.x = Math.random() * W; b.r = 80 + Math.random() * 140; }
      const rr = b.r * (1 + Math.sin(t * 0.02 + b.ph) * 0.08);
      const g2 = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr);
      g2.addColorStop(0,   _hexToRgba(prim, 0.85));
      g2.addColorStop(0.5, _hexToRgba(prim, 0.45));
      g2.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, Math.PI * 2); ctx.fill();
    }
    for (const sk of sparks) {
      sk.x += sk.vx; sk.y += sk.vy * (0.5 + sp * 0.2);
      sk.life -= 0.005;
      if (sk.life <= 0 || sk.y < -10) {
        sk.y = H + 10; sk.x = Math.random() * W; sk.life = 1;
        sk.vy = -(0.8 + Math.random() * 1.4);
      }
      ctx.fillStyle = _hexToRgba(prim, sk.life * 0.9);
      ctx.beginPath(); ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Phoenix: rising embers with glow trails ──
function _bgPsyPhoenix(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const count = 40 + intn * 12;
  const embers = Array.from({ length: count }, () => ({
    x: Math.random() * W, y: H + Math.random() * H * 0.3,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -(0.6 + Math.random() * 1.8),
    r: 1.5 + Math.random() * 3.5, life: 1, max: 1
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, _shade(sec, -50));
    grd.addColorStop(1, _shade(sec, 10));
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      e.x += e.vx + Math.sin((e.y + t) * 0.005) * 0.6;
      e.y += e.vy * (0.5 + sp * 0.2);
      e.life -= 0.004;
      if (e.life <= 0 || e.y < -20) {
        e.y = H + 20; e.x = Math.random() * W; e.life = 1;
        e.vy = -(0.6 + Math.random() * 1.8);
      }
      const a = e.life * 0.95;
      const g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 6);
      g2.addColorStop(0,   _hexToRgba(prim, a));
      g2.addColorStop(0.4, _hexToRgba(prim, a * 0.35));
      g2.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Solar: pulsing core + rotating corona rays + flare specks ──
function _bgPsySolar(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const cx = W / 2, cy = H / 2;
  const rays = 14;
  const flares = Array.from({ length: 20 + intn * 4 }, () => ({
    a: Math.random() * Math.PI * 2,
    d: 200 + Math.random() * 400,
    r: 1 + Math.random() * 3,
    sp: 0.001 + Math.random() * 0.003
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    ctx.fillStyle = _shade(sec, -45); ctx.fillRect(0, 0, W, H);
    const pulse = 1 + Math.sin(t * 0.04 * (sp / 5)) * 0.08;
    // Corona rays
    ctx.globalCompositeOperation = 'screen';
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.0008 * sp);
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2;
      const g = ctx.createLinearGradient(0, 0, Math.cos(ang) * H, Math.sin(ang) * H);
      g.addColorStop(0,   _hexToRgba(prim, 0.55));
      g.addColorStop(0.4, _hexToRgba(prim, 0.15));
      g.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, H, ang - 0.06, ang + 0.06);
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.restore();
    // Core
    const coreR = Math.min(W, H) * 0.22 * pulse;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    cg.addColorStop(0,    'rgba(255,255,240,0.95)');
    cg.addColorStop(0.25, _hexToRgba(prim, 0.85));
    cg.addColorStop(0.8,  _hexToRgba(prim, 0.15));
    cg.addColorStop(1,    _hexToRgba(prim, 0));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 2, 0, Math.PI * 2); ctx.fill();
    // Flares
    for (const f of flares) {
      f.a += f.sp * sp;
      const x = cx + Math.cos(f.a) * f.d;
      const y = cy + Math.sin(f.a) * f.d;
      ctx.fillStyle = _hexToRgba(prim, 0.7);
      ctx.beginPath(); ctx.arc(x, y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Tidal: parallax wave layers + foam bubbles ──
function _bgPsyTidal(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const layers = 3;
  const foam = Array.from({ length: 25 + intn * 5 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: 1 + Math.random() * 4,
    vy: -(0.2 + Math.random() * 0.6), ph: Math.random() * 8
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, _shade(sec, -20));
    bg.addColorStop(1, _shade(sec, -55));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < layers; i++) {
      const phase = t * 0.0015 * sp + i * 0.9;
      const ampl = 60 + i * 30;
      const yc = H * (0.35 + i * 0.2);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 14) {
        const y = yc + Math.sin(x / 280 + phase) * ampl + Math.sin(x / 110 + phase * 1.6) * ampl * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath();
      const wg = ctx.createLinearGradient(0, yc - ampl, 0, H);
      wg.addColorStop(0, _hexToRgba(prim, 0.5));
      wg.addColorStop(1, _hexToRgba(prim, 0.05));
      ctx.fillStyle = wg; ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of foam) {
      b.y += b.vy * (0.3 + sp * 0.12);
      if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
      const a = 0.5 + Math.sin(t * 0.04 + b.ph) * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.1, a * 0.6).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Deep: nebula clouds + twinkling starfield ──
function _bgPsyDeep(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const clouds = Array.from({ length: 5 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: 200 + Math.random() * 250,
    vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2,
    ph: Math.random() * 6
  }));
  const stars = Array.from({ length: 80 + intn * 12 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() * 1.5 + 0.3, ph: Math.random() * 10
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    ctx.fillStyle = _shade(sec, -60); ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (const cl of clouds) {
      cl.x += cl.vx * sp * 0.4; cl.y += cl.vy * sp * 0.4;
      if (cl.x < -cl.r) cl.x = W + cl.r;
      if (cl.x > W + cl.r) cl.x = -cl.r;
      if (cl.y < -cl.r) cl.y = H + cl.r;
      if (cl.y > H + cl.r) cl.y = -cl.r;
      const rr = cl.r * (1 + Math.sin(t * 0.005 + cl.ph) * 0.06);
      const g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, rr);
      g.addColorStop(0,   _hexToRgba(prim, 0.45));
      g.addColorStop(0.5, _hexToRgba(prim, 0.18));
      g.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cl.x, cl.y, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of stars) {
      const tw = 0.4 + Math.abs(Math.sin(t * 0.03 + s.ph)) * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${tw.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Vaporwave: receding grid + retro sun + scanlines ──
// Vaporwave preset — full canvas with 6 element types + 5 custom params.
// _activeRaf/_activeStop/_effectivePrimary/_effectiveSecondary placeholders are substituted per target (goa vs abg).
// Reads c.extras.vaporwave = { grid, sun, shapes, glitch, stars } (0-10),
// each defaulting if absent so the renderer works without dashboard wiring.
function _bgPsyVaporwave(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const spd = c.speed || 5;
  const ext = (c.extras && c.extras.vaporwave) || {};
  const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pGrid    = _clamp(ext.grid    != null ? +ext.grid    : 5, 1, 10);
  const pSun     = _clamp(ext.sun     != null ? +ext.sun     : 5, 1, 10);
  const pShapes  = _clamp(ext.shapes  != null ? +ext.shapes  : 4, 0, 10);
  const pGlitch  = _clamp(ext.glitch  != null ? +ext.glitch  : 3, 0, 10);
  const pStars   = _clamp(ext.stars   != null ? +ext.stars   : 5, 0, 10);

  const horizonY = H * 0.6;
  const sunY = H * 0.55;
  const sunR = Math.min(W, H) * (0.10 + pSun * 0.025);

  // Mountains — 3 parallax silhouette layers, back-to-front.
  const mountains = [
    { peaks: 5, h: 100, shade: -25, drift: 0.3 },
    { peaks: 4, h:  75, shade: -32, drift: 0.5 },
    { peaks: 3, h:  50, shade: -40, drift: 0.8 },
  ];

  // Wireframe shapes — cubes + pyramids floating in sky.
  const shapes = Array.from({ length: pShapes }, (_, i) => ({
    x: 100 + Math.random() * (W - 200),
    y: 80 + Math.random() * (horizonY - 200),
    size: 35 + Math.random() * 55,
    rx: Math.random() * Math.PI * 2,
    ry: Math.random() * Math.PI * 2,
    rz: Math.random() * Math.PI * 2,
    vrx: (Math.random() - 0.5) * 0.025,
    vry: (Math.random() - 0.5) * 0.025,
    vrz: (Math.random() - 0.5) * 0.012,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.2,
    type: i % 2 === 0 ? 'cube' : 'pyramid'
  }));

  // Star field — only above horizon.
  const stars = Array.from({ length: pStars * 18 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (horizonY - 20),
    r: 0.4 + Math.random() * 1.4,
    ph: Math.random() * 10
  }));

  // Floating sparkles — drift upward from below horizon.
  const sparkles = Array.from({ length: 18 }, () => ({
    x: Math.random() * W,
    y: horizonY + Math.random() * (H - horizonY),
    vy: -(0.3 + Math.random() * 0.7),
    ph: Math.random() * 8,
    r: 0.8 + Math.random() * 1.4
  }));

  let t = 0;
  let glitchActive = 0;  // remaining frames of current glitch
  let glitchY = 0;
  let glitchOffset = 0;
  let glitchBarH = 0;

  // Project a 3D vertex through Euler rotations and return [x, y, z]
  // (z kept for line-width depth cue).
  function _proj(v, s) {
    let [x, y, z] = v;
    const cx = Math.cos(s.rx), sx = Math.sin(s.rx);
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    const cy = Math.cos(s.ry), sy = Math.sin(s.ry);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    const cz = Math.cos(s.rz), sz = Math.sin(s.rz);
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [x * s.size, y * s.size, z];
  }

  const CUBE_V = [
    [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
    [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]
  ];
  const CUBE_E = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7]
  ];
  const PYR_V = [
    [-1, 1,-1],[1, 1,-1],[1, 1, 1],[-1, 1, 1],
    [ 0,-1, 0]
  ];
  const PYR_E = [
    [0,1],[1,2],[2,3],[3,0],
    [0,4],[1,4],[2,4],[3,4]
  ];

  function _drawWire(s, color) {
    const V = s.type === 'cube' ? CUBE_V : PYR_V;
    const E = s.type === 'cube' ? CUBE_E : PYR_E;
    const P = V.map((v) => _proj(v, s));
    ctx.save(); ctx.translate(s.x, s.y);
    for (const [a, b] of E) {
      const za = P[a][2], zb = P[b][2];
      const depth = (za + zb) / 2;
      const alpha = 0.45 + depth * 0.18;  // closer = brighter
      ctx.strokeStyle = _hexToRgba(color, _clamp(alpha, 0.15, 0.9));
      ctx.lineWidth = 1.2 + Math.max(0, depth) * 0.8;
      ctx.beginPath();
      ctx.moveTo(P[a][0], P[a][1]);
      ctx.lineTo(P[b][0], P[b][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;

    // ── Sky → ground gradient ──
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    _shade(sec, -10));
    sky.addColorStop(0.55, _shade(prim, -40));
    sky.addColorStop(0.6,  _shade(prim, -25));
    sky.addColorStop(1,    _shade(prim, -55));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // ── Stars (above horizon) ──
    for (const s of stars) {
      const tw = 0.25 + Math.abs(Math.sin(t * 0.025 + s.ph)) * 0.75;
      ctx.fillStyle = `rgba(255,255,255,${(tw * 0.85).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // ── Mountains (parallax silhouettes) ──
    for (let m = 0; m < mountains.length; m++) {
      const mt = mountains[m];
      const driftX = Math.sin(t * 0.0008 * mt.drift) * 8;
      ctx.fillStyle = _shade(sec, mt.shade);
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let i = 0; i <= mt.peaks * 2; i++) {
        const xx = ((i / (mt.peaks * 2)) * (W + 200)) - 100 + driftX;
        const yy = horizonY - (i % 2 === 1 ? mt.h * (0.7 + 0.6 * Math.sin(i * 1.7 + m)) : 0);
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(W, horizonY);
      ctx.closePath();
      ctx.fill();
    }

    // ── Setting sun ──
    const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY);
    sg.addColorStop(0, _hexToRgba(prim, 0.95));
    sg.addColorStop(1, _hexToRgba(_shade(prim, 30), 0.95));
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(W/2, sunY, sunR, Math.PI, Math.PI * 2); ctx.fill();

    // ── Lens flare (additive) ──
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, sunY, W, sunY);
    beam.addColorStop(0,    _hexToRgba(prim, 0));
    beam.addColorStop(0.5,  _hexToRgba(prim, 0.30));
    beam.addColorStop(1,    _hexToRgba(prim, 0));
    ctx.fillStyle = beam;
    ctx.fillRect(0, sunY - 3, W, 6);
    // Flare orbs off-axis
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const fx = W/2 + i * sunR * 1.6;
      const fr = (10 - Math.abs(i) * 2) * 3;
      const fg = ctx.createRadialGradient(fx, sunY, 0, fx, sunY, fr);
      fg.addColorStop(0, _hexToRgba(prim, 0.55));
      fg.addColorStop(1, _hexToRgba(prim, 0));
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fx, sunY, fr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── Perspective grid (below horizon, scrolling forward) ──
    ctx.strokeStyle = _hexToRgba(prim, 0.6);
    ctx.lineWidth = 1.4;
    const HRows = Math.floor(pGrid * 4);
    const scroll = (t * spd * 0.4) % (24);
    for (let zi = 0; zi < HRows; zi++) {
      const z = zi + scroll / 24;
      const yy = horizonY + Math.pow(z / HRows, 2) * (H - horizonY);
      if (yy > H) continue;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    const vp = W / 2;
    const VCols = Math.floor(pGrid * 2);
    for (let i = -VCols; i <= VCols; i++) {
      ctx.beginPath();
      ctx.moveTo(vp, horizonY);
      ctx.lineTo(vp + i * (W / VCols), H);
      ctx.stroke();
    }

    // ── Wireframe shapes ──
    for (const sh of shapes) {
      sh.x += sh.vx * spd * 0.3;
      sh.y += sh.vy * spd * 0.3;
      if (sh.x < 60 || sh.x > W - 60) sh.vx *= -1;
      if (sh.y < 60 || sh.y > horizonY - 80) sh.vy *= -1;
      sh.rx += sh.vrx * spd * 0.4;
      sh.ry += sh.vry * spd * 0.4;
      sh.rz += sh.vrz * spd * 0.4;
      _drawWire(sh, prim);
    }

    // ── Sparkles ──
    for (const sk of sparkles) {
      sk.y += sk.vy * (0.3 + spd * 0.13);
      if (sk.y < 0) { sk.y = H + 10; sk.x = Math.random() * W; }
      const a = 0.4 + Math.sin(t * 0.05 + sk.ph) * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.1, a * 0.85).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2); ctx.fill();
    }

    // ── Glitch bars (VHS tracking) ──
    if (pGlitch > 0) {
      if (glitchActive <= 0) {
        if (Math.random() < pGlitch * 0.002) {
          glitchActive = 5 + Math.floor(Math.random() * 8);
          glitchY = Math.random() * H;
          glitchOffset = (Math.random() - 0.5) * 30;
          glitchBarH = 6 + Math.random() * 22;
        }
      }
      if (glitchActive > 0) {
        const wobble = glitchOffset + (Math.random() - 0.5) * 10;
        // Cyan channel offset
        ctx.fillStyle = 'rgba(0,220,255,0.40)';
        ctx.fillRect(wobble, glitchY, W, glitchBarH);
        // Magenta channel offset (opposite direction)
        ctx.fillStyle = 'rgba(255,40,220,0.40)';
        ctx.fillRect(-wobble, glitchY + 2, W, glitchBarH);
        // White noise streak
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(0, glitchY + 1, W, Math.max(1, glitchBarH * 0.3));
        glitchActive--;
      }
    }

    t++;
    _activeRaf = requestAnimationFrame(frame);
  }

  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}


// ── Kaleidoscope: rotating mirrored wedges with shapes ──
function _bgPsyKaleidoscope(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const wedges = 6;
  const wedgeAng = (Math.PI * 2) / wedges;
  // Shapes drawn inside one wedge, then mirrored to the others.
  const shapes = Array.from({ length: 6 + Math.floor(intn * 0.7) }, () => ({
    r: 100 + Math.random() * 300,
    a: Math.random() * wedgeAng,
    rad: 30 + Math.random() * 80,
    sp: 0.0005 + Math.random() * 0.002,
    kind: Math.floor(Math.random() * 3) // circle / triangle / star
  }));
  const cx = W/2, cy = H/2;
  let t = 0;
  function drawShape(s) {
    const x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r;
    ctx.beginPath();
    if (s.kind === 0) ctx.arc(x, y, s.rad, 0, Math.PI * 2);
    else if (s.kind === 1) {
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + s.a * 2;
        const px = x + Math.cos(ang) * s.rad, py = y + Math.sin(ang) * s.rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + s.a * 3;
        const rr = i % 2 === 0 ? s.rad : s.rad * 0.4;
        const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    ctx.fillStyle = _shade(sec, -50); ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.001 * sp);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      s.a += s.sp * sp; if (s.a > wedgeAng) s.a -= wedgeAng;
      ctx.fillStyle = _hexToRgba(i % 2 === 0 ? prim : _shade(prim, 30), 0.55);
      for (let w = 0; w < wedges; w++) {
        ctx.save(); ctx.rotate(w * wedgeAng);
        if (w % 2 === 1) ctx.scale(1, -1); // mirror alternating wedges
        drawShape(s);
        ctx.restore();
      }
    }
    ctx.restore();
    // Vignette
    ctx.globalCompositeOperation = 'multiply';
    const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Chrome: morphing liquid metal blobs ──
function _bgPsyChrome(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const blobs = Array.from({ length: 4 + Math.floor(intn * 0.3) }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: 200 + Math.random() * 250,
    vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
    ph: Math.random() * 6
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    // Base
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, _shade(sec, -20));
    bg.addColorStop(1, _shade(sec, -40));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (const b of blobs) {
      b.x += b.vx * sp * 0.3; b.y += b.vy * sp * 0.3;
      if (b.x < -b.r) b.x = W + b.r;
      if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r;
      if (b.y > H + b.r) b.y = -b.r;
      const rr = b.r * (1 + Math.sin(t * 0.012 + b.ph) * 0.10);
      // Liquid metal: dark center → bright rim → dark
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr);
      g.addColorStop(0,    _hexToRgba(_shade(prim, -50), 0.55));
      g.addColorStop(0.4,  _hexToRgba(prim, 0.45));
      g.addColorStop(0.7,  _hexToRgba(_shade(prim, 40), 0.7));
      g.addColorStop(0.9,  _hexToRgba(prim, 0.25));
      g.addColorStop(1,    _hexToRgba(prim, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Void: chill plasma drift + sparse starfield ──
function _bgPsyVoid(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const stars = Array.from({ length: 60 + intn * 8 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() * 1.2 + 0.2, ph: Math.random() * 8
  }));
  const blobs = Array.from({ length: 3 }, (_, i) => ({
    x: W * (0.25 + (i % 2) * 0.5), y: H * (0.3 + Math.floor(i / 2) * 0.5),
    r: 280 + i * 60, ph: i * 2
  }));
  let t = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    ctx.fillStyle = _shade(sec, -55); ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const px = b.x + Math.sin(t * 0.001 * sp + b.ph) * 80;
      const py = b.y + Math.cos(t * 0.0011 * sp + b.ph) * 80;
      const g = ctx.createRadialGradient(px, py, 0, px, py, b.r);
      g.addColorStop(0,   _hexToRgba(prim, 0.3));
      g.addColorStop(0.7, _hexToRgba(prim, 0.06));
      g.addColorStop(1,   _hexToRgba(prim, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of stars) {
      const tw = 0.3 + Math.abs(Math.sin(t * 0.02 + s.ph)) * 0.7;
      ctx.fillStyle = `rgba(255,255,255,${(tw * 0.7).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ── Supernova: explosive radiating particles + shockwave rings ──
function _bgPsySupernova(layer, c) {
  const { cvs, ctx, W, H } = _psyCanvas(layer);
  const sp = c.speed || 5, intn = c.intensity || 5;
  const cx = W / 2, cy = H / 2;
  const parts = Array.from({ length: 50 + intn * 10 }, () => ({
    a: Math.random() * Math.PI * 2,
    d: Math.random() * 200,
    vd: 1 + Math.random() * 4,
    r: 1 + Math.random() * 3,
    life: Math.random(), col: Math.random()
  }));
  const rings = [];
  let t = 0, ringTimer = 0;
  function frame() {
    const prim = _effectivePrimary() || c.primaryColor;
    const sec  = _effectiveSecondary() || c.secondaryColor;
    ctx.fillStyle = _shade(sec, -55); ctx.fillRect(0, 0, W, H);
    // Core
    ctx.globalCompositeOperation = 'screen';
    const corePulse = 1 + Math.sin(t * 0.08 * (sp / 5)) * 0.15;
    const coreR = Math.min(W, H) * 0.12 * corePulse;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    cg.addColorStop(0,   'rgba(255,255,255,0.95)');
    cg.addColorStop(0.2, _hexToRgba(prim, 0.85));
    cg.addColorStop(0.6, _hexToRgba(prim, 0.20));
    cg.addColorStop(1,   _hexToRgba(prim, 0));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2); ctx.fill();
    // Shockwave rings
    ringTimer++;
    if (ringTimer > Math.max(8, 30 - sp * 2)) {
      rings.push({ r: coreR, life: 1 });
      ringTimer = 0;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 4 + sp * 1.2;
      r.life -= 0.012;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = _hexToRgba(prim, r.life * 0.7);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    // Radiating particles
    for (const p of parts) {
      p.d += p.vd * (0.5 + sp * 0.2);
      p.life -= 0.006;
      if (p.life <= 0 || p.d > Math.max(W, H)) {
        p.a = Math.random() * Math.PI * 2;
        p.d = Math.random() * 50; p.life = 1; p.col = Math.random();
      }
      const x = cx + Math.cos(p.a) * p.d;
      const y = cy + Math.sin(p.a) * p.d;
      const col = p.col < 0.33 ? prim : (p.col < 0.66 ? _shade(prim, 30) : '#ffffff');
      ctx.fillStyle = _hexToRgba(col, p.life * 0.9);
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    t++; _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}


// ── Winner-pulse preset override ─────────────────────
// On a game-win, briefly swap the active bg to a psychedelic preset
// hue-matched to the winner's cosmetics, then restore. This sits on
// top of the existing bgTint color-blend — they're complementary.
let _winnerPresetSavedSig = null;
let _winnerPresetTimer = null;
const WINNER_PRESET_MS = 8000;

// ═══════════════════════════════════════════════════════════════════════
// PETRI DISH V2 — high-detail microscope ecosystem
// ═══════════════════════════════════════════════════════════════════════
// Replaces v1 (_bgPetri below, kept for rollback). Architecture:
//   • 4 species, each with dedicated pose + draw functions
//   • Skeletal animation — per-frame joint positions, not wobble loops
//   • Procedural per-creature variation via a lightweight genome
//   • Microscope-style substrate: agar gradient, caustics, drifting debris
//   • Ecosystem v2: species-aware predator/prey food chain, perception
//     scanning, energy economy, age + death + respawn cycle

const _V2_SPECIES = ['ant', 'paramecium', 'worm', 'beetle'];
const _V2_WEIGHTS = { ant: 3, paramecium: 2, worm: 2, beetle: 2 };
// Food chain — predator → list of prey species. Drives target selection
// in the ecosystem step and triggers consumption on contact.
const _V2_FOOD_CHAIN = {
  ant:        ['paramecium', 'worm'],
  beetle:     ['ant', 'worm', 'paramecium'],
  worm:       ['paramecium'],
  paramecium: [],
};
const _V2_BASE_SIZE   = { ant: 22, paramecium: 36, worm: 28, beetle: 26 };
const _V2_BASE_SPEED  = { ant: 1.2, paramecium: 0.45, worm: 0.4, beetle: 0.95 };
const _V2_BODY_RADIUS = { ant: 14, paramecium: 22, worm: 10, beetle: 18 };
// How fast each species' gait phase advances per unit of motion.
const _V2_GAIT_RATE   = { ant: 0.22, paramecium: 0.10, worm: 0.16, beetle: 0.16 };

function _v2PickSpecies() {
  const total = _V2_SPECIES.reduce((s, k) => s + _V2_WEIGHTS[k], 0);
  let r = Math.random() * total;
  for (const k of _V2_SPECIES) {
    r -= _V2_WEIGHTS[k];
    if (r < 0) return k;
  }
  return _V2_SPECIES[0];
}

// Per-creature genome. Drives visual variation (size, color, leg/body
// proportions, segment counts) and behavior (aggression, perception).
function _v2Genome(species, seedHue) {
  const baseHue = typeof seedHue === 'number' ? seedHue : Math.random() * 360;
  return {
    species,
    sizeMul:    0.80 + Math.random() * 0.60,    // 0.80..1.40
    speedMul:   0.70 + Math.random() * 0.55,    // 0.70..1.25
    aggression: Math.random(),                  // 0..1
    hue:        (baseHue + (Math.random() - 0.5) * 70 + 360) % 360,
    sat:        45 + Math.random() * 30,        // % — saturation
    lit:        28 + Math.random() * 18,        // % — base lightness
    legLenMul:  0.85 + Math.random() * 0.45,    // 0.85..1.30
    bodyLenMul: 0.90 + Math.random() * 0.40,    // 0.90..1.30
    segments:   7 + Math.floor(Math.random() * 4),     // worms: 7..10
    ciliaCount: 18 + Math.floor(Math.random() * 8),    // paramecium: 18..25 (cheaper)
    elytraSplit: 0.85 + Math.random() * 0.30,          // beetle wing midline ratio
    perceptionR: 90 + Math.random() * 220,
    energyCap:  90 + Math.random() * 60,
  };
}

function _v2MakeCreature(species, opts) {
  opts = opts || {};
  const g = _v2Genome(species, opts.seedHue);
  return {
    g,
    x: opts.x != null ? opts.x : Math.random() * (opts.W || 1080),
    y: opts.y != null ? opts.y : Math.random() * (opts.H || 1920),
    heading: Math.random() * Math.PI * 2,
    targetHeading: null,
    vx: 0, vy: 0,
    gaitPhase: Math.random() * Math.PI * 2,
    age: 0,
    maxAge: 4000 + Math.random() * 6000,
    energy: g.energyCap * 0.7,
    state: 'born',
    born: 0,
    pose: {},
    dead: false,
  };
}

// ── Microscope substrate ─────────────────────────────────────────
// Drawn each frame: radial agar gradient (slightly lighter at center),
// drifting caustic light blobs (additive), then debris specks on top.
// Substrate: gradient + caustics + vignette are cached to an offscreen
// canvas (refreshed every 30 frames) and blitted each tick. Avoids
// recomputing two gradients + 5 fills every rAF — that was the main
// freeze culprit.
let _v2SubCache = null;
let _v2SubCacheTick = -999;
function _v2DrawSubstrate(ctx, W, H, baseColor, tick) {
  if (!_v2SubCache || _v2SubCache.width !== W || _v2SubCache.height !== H || (tick - _v2SubCacheTick) > 30 || _v2SubCache._base !== baseColor) {
    if (!_v2SubCache || _v2SubCache.width !== W || _v2SubCache.height !== H) {
      _v2SubCache = document.createElement('canvas');
      _v2SubCache.width = W;
      _v2SubCache.height = H;
    }
    const sc = _v2SubCache.getContext('2d');
    sc.clearRect(0, 0, W, H);
    const grad = sc.createRadialGradient(W * 0.5, H * 0.4, 60, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    grad.addColorStop(0,    _shade(baseColor, 12));
    grad.addColorStop(0.55, baseColor);
    grad.addColorStop(1,    _shade(baseColor, -22));
    sc.fillStyle = grad;
    sc.fillRect(0, 0, W, H);
    // Caustics — drawn into cache; positions reflect current tick.
    sc.globalCompositeOperation = 'lighter';
    sc.globalAlpha = 0.05;
    sc.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const px = W * 0.5 + Math.cos(tick * 0.0008 + i * 1.5) * W * 0.32;
      const py = H * 0.5 + Math.sin(tick * 0.0006 + i * 1.1) * H * 0.30;
      sc.beginPath();
      sc.arc(px, py, W * 0.20, 0, Math.PI * 2);
      sc.fill();
    }
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    // Vignette.
    const vig = sc.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    sc.fillStyle = vig;
    sc.fillRect(0, 0, W, H);
    _v2SubCache._base = baseColor;
    _v2SubCacheTick = tick;
  }
  ctx.drawImage(_v2SubCache, 0, 0);
}

function _v2SeedDebris(eco, W, H, n) {
  for (let i = 0; i < n; i++) {
    eco.debris.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.5 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      alpha: 0.12 + Math.random() * 0.28,
      hue: 25 + Math.random() * 60,
      depth: Math.random(),  // 0=back, 1=front — slight parallax cue
    });
  }
}
function _v2StepDebris(eco, W, H) {
  for (const d of eco.debris) {
    d.x += d.vx * (0.4 + d.depth * 0.8);
    d.y += d.vy * (0.4 + d.depth * 0.8);
    if (d.x < -5) d.x = W + 5; else if (d.x > W + 5) d.x = -5;
    if (d.y < -5) d.y = H + 5; else if (d.y > H + 5) d.y = -5;
  }
}
function _v2DrawDebris(ctx, eco) {
  for (const d of eco.debris) {
    ctx.fillStyle = `hsla(${d.hue.toFixed(0)}, 35%, 32%, ${d.alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * (0.6 + d.depth * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Ecosystem behavior step ──────────────────────────────────────
function _v2StepCreatures(eco, W, H, c) {
  const speedScale = c.speed / 5;  // dashboard 1..10 → 0.2..2x
  for (const k of eco.creatures) {
    if (k.dead) continue;

    // Born → live ramp
    if (k.state === 'born') {
      k.born++;
      if (k.born > 24) k.state = 'live';
    } else if (k.state === 'live') {
      k.age++;
      k.energy -= 0.018 + 0.018 * k.g.aggression;
      if (k.age > k.maxAge || k.energy <= 0) k.state = 'dying';
    } else if (k.state === 'dying') {
      k.energy -= 0.6;
      if (k.energy < -30) k.dead = true;
    }

    // Heading decision (only when live).
    if (k.state === 'live') {
      // Periodically pick a new wander heading.
      if (k.targetHeading == null || eco.tick % 90 === ((k.x | 0) % 90)) {
        k.targetHeading = k.heading + (Math.random() - 0.5) * 2;
      }
      // Predator scan: aggressive creatures chase nearest valid prey.
      const preyList = _V2_FOOD_CHAIN[k.g.species];
      if (preyList.length && k.g.aggression > 0.45) {
        let best = null, bestD2 = k.g.perceptionR * k.g.perceptionR;
        for (const o of eco.creatures) {
          if (o === k || o.state !== 'live') continue;
          if (preyList.indexOf(o.g.species) < 0) continue;
          const dx = o.x - k.x, dy = o.y - k.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = o; }
        }
        if (best) k.targetHeading = Math.atan2(best.y - k.y, best.x - k.x);
      }
      // Smooth-turn toward target heading.
      let dh = k.targetHeading - k.heading;
      while (dh >  Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      k.heading += dh * 0.07;
    }

    // Walk: velocity from heading × species speed × genome × dashboard.
    const sp = (k.state === 'live')
      ? _V2_BASE_SPEED[k.g.species] * k.g.speedMul * speedScale
      : 0;
    k.vx = Math.cos(k.heading) * sp;
    k.vy = Math.sin(k.heading) * sp;
    k.x += k.vx;
    k.y += k.vy;

    // Edge bounce — flip heading along the violated axis.
    const pad = 24;
    if      (k.x < pad)       { k.x = pad;       k.heading = Math.PI - k.heading; k.targetHeading = k.heading; }
    else if (k.x > W - pad)   { k.x = W - pad;   k.heading = Math.PI - k.heading; k.targetHeading = k.heading; }
    if      (k.y < pad)       { k.y = pad;       k.heading = -k.heading;          k.targetHeading = k.heading; }
    else if (k.y > H - pad)   { k.y = H - pad;   k.heading = -k.heading;          k.targetHeading = k.heading; }

    // Predation contact — consume prey on touch.
    if (k.state === 'live') {
      const preyList = _V2_FOOD_CHAIN[k.g.species];
      if (preyList.length) {
        const myR = _V2_BODY_RADIUS[k.g.species] * k.g.sizeMul;
        for (const o of eco.creatures) {
          if (o === k || o.state !== 'live') continue;
          if (preyList.indexOf(o.g.species) < 0) continue;
          const dx = o.x - k.x, dy = o.y - k.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const touch = myR + _V2_BODY_RADIUS[o.g.species] * o.g.sizeMul;
          if (d < touch * 0.85) {
            k.energy = Math.min(k.g.energyCap, k.energy + 30);
            o.state = 'dying';
          }
        }
      }
    }

    // Update skeletal pose for this frame.
    _v2PoseDispatch(k);
  }

  // Cull dead.
  for (let i = eco.creatures.length - 1; i >= 0; i--) {
    if (eco.creatures[i].dead) eco.creatures.splice(i, 1);
  }
  // Top up population at most ONE per frame — never block the loop.
  if (eco.creatures.length < eco.targetCount && (eco.tick & 7) === 0) {
    const species = _v2PickSpecies();
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if      (edge === 0) { x = 5;     y = Math.random() * H; }
    else if (edge === 1) { x = W - 5; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = 5; }
    else                 { x = Math.random() * W; y = H - 5; }
    eco.creatures.push(_v2MakeCreature(species, { x, y, seedHue: eco.seedHue, W, H }));
  }
}

// ── Pose dispatch ────────────────────────────────────────────────
function _v2PoseDispatch(k) {
  // Phase advances proportional to actual movement so paused creatures
  // stop swinging their legs.
  const motion = Math.sqrt(k.vx * k.vx + k.vy * k.vy) + 0.15;
  k.gaitPhase += _V2_GAIT_RATE[k.g.species] * motion;
  if      (k.g.species === 'ant')        _v2PoseAnt(k);
  else if (k.g.species === 'beetle')     _v2PoseBeetle(k);
  else if (k.g.species === 'worm')       _v2PoseWorm(k);
  else if (k.g.species === 'paramecium') _v2PoseParamecium(k);
}

function _v2DrawCreature(ctx, k) {
  if      (k.g.species === 'ant')        _v2DrawAnt(ctx, k);
  else if (k.g.species === 'beetle')     _v2DrawBeetle(ctx, k);
  else if (k.g.species === 'worm')       _v2DrawWorm(ctx, k);
  else if (k.g.species === 'paramecium') _v2DrawParamecium(ctx, k);
}

// ───────────────────────────────────────────────────────────────
// ANT — articulated body + jointed 6 legs + antennae + mandibles
// ───────────────────────────────────────────────────────────────
function _v2PoseAnt(k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.ant * g.sizeMul;
  const ll = s * 1.5 * g.legLenMul;
  const ph = k.gaitPhase;
  // 6 leg anchors on the thorax. tri 0/1 form alternating tripod groups.
  const legCfg = [
    { sx:  s * 0.10, sy: -s * 0.22, tri: 0 },
    { sx:  s * 0.10, sy:  s * 0.22, tri: 1 },
    { sx:  0,        sy: -s * 0.26, tri: 1 },
    { sx:  0,        sy:  s * 0.26, tri: 0 },
    { sx: -s * 0.12, sy: -s * 0.22, tri: 0 },
    { sx: -s * 0.12, sy:  s * 0.22, tri: 1 },
  ];
  k.pose.legs = [];
  for (const L of legCfg) {
    const swing = Math.sin(ph + (L.tri ? Math.PI : 0));
    const lift = Math.max(0, swing);  // 0..1 — foot off the ground
    // Foot at full outward reach, shifted fore-aft by swing.
    const sideSign = L.sy < 0 ? -1 : 1;
    const fx = L.sx + swing * s * 0.42;
    const fy = sideSign * (Math.abs(L.sy) + ll * (1 - lift * 0.18));
    // Knee bulges outward perpendicular to leg.
    const kx = (L.sx + fx) * 0.5 - lift * s * 0.30;
    const ky = (L.sy + fy) * 0.5 + sideSign * s * 0.18;
    k.pose.legs.push({ shoulder: [L.sx, L.sy], knee: [kx, ky], foot: [fx, fy] });
  }
  // Antennae sweep slowly forward-and-out.
  const antSweep = Math.sin(ph * 0.35) * 0.30;
  k.pose.antennae = [
    { base: [s * 0.45, -s * 0.16], tip: [s * 1.05 + Math.sin(ph * 0.5) * s * 0.10, -s * 0.55 + antSweep * s] },
    { base: [s * 0.45,  s * 0.16], tip: [s * 1.05 + Math.sin(ph * 0.5) * s * 0.10,  s * 0.55 - antSweep * s] },
  ];
  // Mandibles flare open briefly during predation cycles.
  k.pose.mandibleOpen = (g.aggression > 0.5 && Math.sin(ph * 0.4) > 0.7) ? 0.7 : 0.05;
}

function _v2DrawAnt(ctx, k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.ant * g.sizeMul;
  const cos = Math.cos(k.heading), sin = Math.sin(k.heading);
  const tx = (lx, ly) => [k.x + lx * cos - ly * sin, k.y + lx * sin + ly * cos];

  const body  = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${g.lit.toFixed(0)}%)`;
  const limb  = `hsl(${g.hue.toFixed(0)}, ${(g.sat * 0.9).toFixed(0)}%, ${(g.lit * 0.75).toFixed(0)}%)`;
  const edge  = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.55).toFixed(0)}%)`;
  const eyeC  = `hsla(${((g.hue + 180) % 360).toFixed(0)}, 60%, 60%, 0.9)`;
  const alpha = k.state === 'born' ? k.born / 24 : k.state === 'dying' ? Math.max(0, k.energy / 40) : 1;
  ctx.globalAlpha = alpha;

  // Legs (under body).
  ctx.strokeStyle = limb;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, s * 0.11);
  for (const L of k.pose.legs) {
    const a = tx(L.shoulder[0], L.shoulder[1]);
    const b = tx(L.knee[0], L.knee[1]);
    const c = tx(L.foot[0], L.foot[1]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
    ctx.stroke();
  }

  // Antennae.
  ctx.lineWidth = Math.max(1.2, s * 0.07);
  for (const A of k.pose.antennae) {
    const a = tx(A.base[0], A.base[1]);
    const t = tx(A.tip[0], A.tip[1]);
    const mx = (a[0] + t[0]) * 0.5 + cos * s * 0.05;
    const my = (a[1] + t[1]) * 0.5 + sin * s * 0.05;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mx, my, t[0], t[1]);
    ctx.stroke();
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(t[0], t[1], Math.max(0.8, s * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }

  // Body segments — abdomen + thorax + head, each a rotated ellipse.
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.2;
  const drawSeg = (lx, ly, rx, ry) => {
    const p = tx(lx, ly);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], rx, ry, k.heading, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return p;
  };
  drawSeg(-s * 0.55 * g.bodyLenMul, 0, s * 0.55, s * 0.42);    // abdomen
  drawSeg( 0,                       0, s * 0.32, s * 0.28);    // thorax
  const head = drawSeg(s * 0.55 * g.bodyLenMul, 0, s * 0.36, s * 0.32);  // head

  // Eyes — two highlight dots on the head, rotated with body.
  const eL = tx(s * 0.55 * g.bodyLenMul + s * 0.13, -s * 0.18);
  const eR = tx(s * 0.55 * g.bodyLenMul + s * 0.13,  s * 0.18);
  ctx.fillStyle = eyeC;
  ctx.beginPath();
  ctx.arc(eL[0], eL[1], s * 0.07, 0, Math.PI * 2);
  ctx.arc(eR[0], eR[1], s * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Mandibles — two short curved arms forward of head, spread by mandibleOpen.
  const mando = k.pose.mandibleOpen;
  ctx.strokeStyle = limb;
  ctx.lineWidth = Math.max(1.4, s * 0.10);
  for (const sd of [-1, 1]) {
    const baseLx = s * (0.55 * g.bodyLenMul + 0.30);
    const baseLy = sd * s * 0.10;
    const tipLx  = s * (0.55 * g.bodyLenMul + 0.55 + mando * 0.10);
    const tipLy  = sd * (s * 0.18 + mando * s * 0.18);
    const a = tx(baseLx, baseLy);
    const t = tx(tipLx, tipLy);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(t[0], t[1]);
    ctx.stroke();
  }

  // Abdomen gloss highlight — small specular ellipse on top.
  const ag = tx(-s * 0.55 * g.bodyLenMul, -s * 0.18);
  ctx.fillStyle = `hsla(${g.hue.toFixed(0)}, 55%, 65%, 0.30)`;
  ctx.beginPath();
  ctx.ellipse(ag[0], ag[1], s * 0.28, s * 0.10, k.heading, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

// ───────────────────────────────────────────────────────────────
// BEETLE — domed elytra + 6 legs + mandibles
// ───────────────────────────────────────────────────────────────
function _v2PoseBeetle(k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.beetle * g.sizeMul;
  const ll = s * 1.2 * g.legLenMul;
  const ph = k.gaitPhase;
  const legCfg = [
    { sx:  s * 0.30, sy: -s * 0.30, tri: 0 },
    { sx:  s * 0.30, sy:  s * 0.30, tri: 1 },
    { sx:  0,        sy: -s * 0.36, tri: 1 },
    { sx:  0,        sy:  s * 0.36, tri: 0 },
    { sx: -s * 0.28, sy: -s * 0.30, tri: 0 },
    { sx: -s * 0.28, sy:  s * 0.30, tri: 1 },
  ];
  k.pose.legs = [];
  for (const L of legCfg) {
    const swing = Math.sin(ph + (L.tri ? Math.PI : 0));
    const lift = Math.max(0, swing);
    const sideSign = L.sy < 0 ? -1 : 1;
    const fx = L.sx + swing * s * 0.35;
    const fy = sideSign * (Math.abs(L.sy) + ll * (1 - lift * 0.20));
    const kx = (L.sx + fx) * 0.5 - lift * s * 0.25;
    const ky = (L.sy + fy) * 0.5 + sideSign * s * 0.20;
    k.pose.legs.push({ shoulder: [L.sx, L.sy], knee: [kx, ky], foot: [fx, fy] });
  }
  // Antennae — short clubbed feelers.
  const antSweep = Math.sin(ph * 0.4) * 0.18;
  k.pose.antennae = [
    { base: [s * 0.55, -s * 0.15], tip: [s * 0.90, -s * 0.42 + antSweep * s] },
    { base: [s * 0.55,  s * 0.15], tip: [s * 0.90,  s * 0.42 - antSweep * s] },
  ];
  k.pose.mandibleOpen = (g.aggression > 0.6 && Math.sin(ph * 0.3) > 0.6) ? 0.5 : 0.0;
}

function _v2DrawBeetle(ctx, k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.beetle * g.sizeMul;
  const cos = Math.cos(k.heading), sin = Math.sin(k.heading);
  const tx = (lx, ly) => [k.x + lx * cos - ly * sin, k.y + lx * sin + ly * cos];

  const body  = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${g.lit.toFixed(0)}%)`;
  const elytraDark = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.7).toFixed(0)}%)`;
  const elytraLight = `hsl(${g.hue.toFixed(0)}, ${(g.sat * 0.7).toFixed(0)}%, ${(g.lit * 1.6).toFixed(0)}%)`;
  const limb  = `hsl(${g.hue.toFixed(0)}, ${(g.sat * 0.7).toFixed(0)}%, ${(g.lit * 0.55).toFixed(0)}%)`;
  const alpha = k.state === 'born' ? k.born / 24 : k.state === 'dying' ? Math.max(0, k.energy / 40) : 1;
  ctx.globalAlpha = alpha;

  // Legs.
  ctx.strokeStyle = limb;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.8, s * 0.13);
  for (const L of k.pose.legs) {
    const a = tx(L.shoulder[0], L.shoulder[1]);
    const b = tx(L.knee[0], L.knee[1]);
    const c = tx(L.foot[0], L.foot[1]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
    ctx.stroke();
  }

  // Antennae.
  ctx.lineWidth = Math.max(1.4, s * 0.08);
  for (const A of k.pose.antennae) {
    const a = tx(A.base[0], A.base[1]);
    const t = tx(A.tip[0], A.tip[1]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(t[0], t[1]);
    ctx.stroke();
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(t[0], t[1], Math.max(1.2, s * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  // Pronotum (the "shoulder" plate forward of elytra).
  const pron = tx(s * 0.35 * g.bodyLenMul, 0);
  ctx.fillStyle = elytraDark;
  ctx.strokeStyle = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.45).toFixed(0)}%)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(pron[0], pron[1], s * 0.28, s * 0.32, k.heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Head + mandibles.
  const head = tx(s * 0.65 * g.bodyLenMul, 0);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(head[0], head[1], s * 0.22, s * 0.20, k.heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const mando = k.pose.mandibleOpen;
  if (mando > 0.05) {
    ctx.strokeStyle = limb;
    ctx.lineWidth = Math.max(1.4, s * 0.09);
    for (const sd of [-1, 1]) {
      const a = tx(s * 0.78 * g.bodyLenMul, sd * s * 0.06);
      const t = tx(s * (0.92 + mando * 0.08) * g.bodyLenMul, sd * (s * 0.14 + mando * s * 0.12));
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(t[0], t[1]);
      ctx.stroke();
    }
  }

  // Elytra — domed wing covers. Two halves with a split midline gives
  // the characteristic beetle silhouette. Specular highlight on top.
  const ely = tx(-s * 0.20 * g.bodyLenMul, 0);
  ctx.save();
  ctx.translate(ely[0], ely[1]);
  ctx.rotate(k.heading);
  const eW = s * 0.50 * g.bodyLenMul;
  const eH = s * 0.42;
  // Full elytra fill.
  ctx.fillStyle = elytraDark;
  ctx.strokeStyle = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.40).toFixed(0)}%)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, eW, eH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Midline split — a darker line down the center.
  ctx.strokeStyle = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.30).toFixed(0)}%)`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-eW * g.elytraSplit, 0);
  ctx.lineTo( eW * g.elytraSplit, 0);
  ctx.stroke();
  // Specular gloss highlight along the top of the dome.
  ctx.fillStyle = `hsla(${g.hue.toFixed(0)}, 65%, 75%, 0.30)`;
  ctx.beginPath();
  ctx.ellipse(0, -eH * 0.45, eW * 0.55, eH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = 1;
}

// ───────────────────────────────────────────────────────────────
// WORM / CATERPILLAR — segmented body with peristaltic wave
// ───────────────────────────────────────────────────────────────
function _v2PoseWorm(k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.worm * g.sizeMul;
  const N = g.segments;  // 7..10
  const ph = k.gaitPhase;
  // Sample N segment positions along the body in local coords. The body
  // is laid out -1..+1 on x (rear→head) and sinuates side-to-side based
  // on the peristaltic wave. The wave is a sin traveling rear→head so
  // each segment's lateral offset follows the segment in front, sold
  // as "the wave passes through the body".
  k.pose.segments = [];
  const segLen = s * 2.0 * g.bodyLenMul / N;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);  // 0..1 along body
    // Wave: travels from rear (t=0) to head (t=1), sin lateral offset.
    const wavePhase = ph - t * 2.2;
    const lat = Math.sin(wavePhase) * s * 0.18 * (1 - Math.abs(t - 0.5) * 0.6);
    // Slight foreshortening as the wave compresses the body forward.
    const compress = 1 + Math.sin(wavePhase) * 0.08;
    const lx = -s * 1.05 * g.bodyLenMul + i * segLen * compress;
    const ly = lat;
    // Segment radius: thicker in the middle.
    const rad = s * 0.22 * (0.65 + 0.35 * Math.sin(t * Math.PI));
    k.pose.segments.push({ lx, ly, rad });
  }
  // Head probes side-to-side at a slower rate.
  k.pose.headProbe = Math.sin(ph * 0.5) * 0.5;
}

function _v2DrawWorm(ctx, k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.worm * g.sizeMul;
  const cos = Math.cos(k.heading), sin = Math.sin(k.heading);
  const tx = (lx, ly) => [k.x + lx * cos - ly * sin, k.y + lx * sin + ly * cos];

  const body  = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${g.lit.toFixed(0)}%)`;
  const dark  = `hsl(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.55).toFixed(0)}%)`;
  const limb  = `hsl(${g.hue.toFixed(0)}, ${(g.sat * 0.8).toFixed(0)}%, ${(g.lit * 0.45).toFixed(0)}%)`;
  const alpha = k.state === 'born' ? k.born / 24 : k.state === 'dying' ? Math.max(0, k.energy / 40) : 1;
  ctx.globalAlpha = alpha;

  // Prolegs — tiny stub feet under alternating segments. Drawn under body.
  ctx.strokeStyle = limb;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.4, s * 0.10);
  for (let i = 1; i < k.pose.segments.length - 1; i++) {
    if (i % 2 !== 0) continue;
    const S = k.pose.segments[i];
    // Two prolegs per segment, splayed left and right.
    for (const sd of [-1, 1]) {
      const a = tx(S.lx, S.ly + sd * S.rad * 0.6);
      const b = tx(S.lx, S.ly + sd * (S.rad * 1.3));
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  // Body — connected fill: traverse segments, lay down a smooth
  // boundary by tracing the top edge forward then the bottom edge back.
  const segs = k.pose.segments;
  const head = segs[segs.length - 1];
  const tail = segs[0];
  ctx.fillStyle = body;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  // Top edge — head → tail
  for (let i = segs.length - 1; i >= 0; i--) {
    const S = segs[i];
    const p = tx(S.lx, S.ly - S.rad);
    if (i === segs.length - 1) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  // Tail cap
  const tailCap = tx(tail.lx - tail.rad * 0.5, tail.ly);
  ctx.lineTo(tailCap[0], tailCap[1]);
  // Bottom edge — tail → head
  for (let i = 0; i < segs.length; i++) {
    const S = segs[i];
    const p = tx(S.lx, S.ly + S.rad);
    ctx.lineTo(p[0], p[1]);
  }
  // Head cap
  const headCap = tx(head.lx + head.rad * 0.6 + k.pose.headProbe * s * 0.12, head.ly);
  ctx.lineTo(headCap[0], headCap[1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Segment ring lines on top — gives the segmented look.
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.0;
  for (let i = 1; i < segs.length - 1; i++) {
    const S = segs[i];
    const a = tx(S.lx, S.ly - S.rad * 0.85);
    const b = tx(S.lx, S.ly + S.rad * 0.85);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Head dot + tiny eyes.
  const eyeC = `hsla(${((g.hue + 200) % 360).toFixed(0)}, 60%, 65%, 0.9)`;
  const headP = tx(head.lx, head.ly);
  ctx.fillStyle = eyeC;
  for (const sd of [-1, 1]) {
    const e = tx(head.lx + s * 0.10, head.ly + sd * s * 0.08);
    ctx.beginPath();
    ctx.arc(e[0], e[1], s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

// ───────────────────────────────────────────────────────────────
// PARAMECIUM — translucent oval body + cilia border + vacuoles
// ───────────────────────────────────────────────────────────────
function _v2PoseParamecium(k) {
  // Pose state for paramecia is minimal — the cilia phase rides along
  // with gaitPhase. We just need an "internal" axis rotation so the
  // organism rotates slowly even while moving forward (real paramecia
  // spin as they swim).
  k.pose.spin = (k.pose.spin || 0) + 0.012;
  k.pose.cilia = k.gaitPhase;
}

function _v2DrawParamecium(ctx, k) {
  const g = k.g;
  const s = _V2_BASE_SIZE.paramecium * g.sizeMul;
  const cos = Math.cos(k.heading + k.pose.spin), sin = Math.sin(k.heading + k.pose.spin);
  const tx = (lx, ly) => [k.x + lx * cos - ly * sin, k.y + lx * sin + ly * cos];

  const body = `hsla(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit + 30).toFixed(0)}%, 0.55)`;
  const edge = `hsla(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit + 15).toFixed(0)}%, 0.85)`;
  const cilia = `hsla(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit + 35).toFixed(0)}%, 0.65)`;
  const alpha = k.state === 'born' ? k.born / 24 : k.state === 'dying' ? Math.max(0, k.energy / 40) : 1;
  ctx.globalAlpha = alpha;

  // Body — elongated translucent oval.
  const rx = s * 0.62 * g.bodyLenMul;
  const ry = s * 0.30;
  const ctr = tx(0, 0);
  ctx.fillStyle = body;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(ctr[0], ctr[1], rx, ry, k.heading + k.pose.spin, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cilia — sample N points around the ellipse border and draw short
  // outward bristles, each phase-offset so the border ripples like a
  // metachronal wave (real paramecia move via this wave).
  const N = g.ciliaCount;
  const phase = k.pose.cilia;
  ctx.strokeStyle = cilia;
  ctx.lineWidth = Math.max(0.8, s * 0.04);
  ctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Local ellipse point and outward normal.
    const px = Math.cos(a) * rx;
    const py = Math.sin(a) * ry;
    // Outward normal: gradient of ellipse equation, normalized.
    const nxL = Math.cos(a) / rx;
    const nyL = Math.sin(a) / ry;
    const nLen = Math.sqrt(nxL * nxL + nyL * nyL) || 1;
    const nx = nxL / nLen, ny = nyL / nLen;
    // Cilia length oscillates with the wave.
    const wave = Math.sin(phase + a * 4);  // 4 = wave wavelength
    const ciliaLen = s * 0.16 * (0.6 + 0.4 * wave);
    const a1 = tx(px, py);
    const a2 = tx(px + nx * ciliaLen, py + ny * ciliaLen);
    ctx.beginPath();
    ctx.moveTo(a1[0], a1[1]);
    ctx.lineTo(a2[0], a2[1]);
    ctx.stroke();
  }

  // Contractile vacuoles — two pale interior bubbles that pulse slowly.
  const vacPulse = 0.85 + 0.15 * Math.sin(phase * 0.3);
  ctx.fillStyle = `hsla(${g.hue.toFixed(0)}, 30%, 85%, 0.45)`;
  for (const off of [-rx * 0.40, rx * 0.40]) {
    const v = tx(off, 0);
    ctx.beginPath();
    ctx.arc(v[0], v[1], s * 0.08 * vacPulse, 0, Math.PI * 2);
    ctx.fill();
  }
  // Inner edge of vacuoles — subtle dark ring.
  ctx.strokeStyle = `hsla(${g.hue.toFixed(0)}, 30%, 30%, 0.35)`;
  ctx.lineWidth = 0.8;
  for (const off of [-rx * 0.40, rx * 0.40]) {
    const v = tx(off, 0);
    ctx.beginPath();
    ctx.arc(v[0], v[1], s * 0.08 * vacPulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Macronucleus — slight darker oval in body center.
  ctx.fillStyle = `hsla(${g.hue.toFixed(0)}, ${g.sat.toFixed(0)}%, ${(g.lit * 0.6).toFixed(0)}%, 0.35)`;
  ctx.beginPath();
  ctx.ellipse(ctr[0], ctr[1], rx * 0.20, ry * 0.45, k.heading + k.pose.spin, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

// ───────────────────────────────────────────────────────────────
// Top-level renderer — replaces _bgPetri
// ───────────────────────────────────────────────────────────────
function _bgPetriV2(layer, c) {
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const ctx = cvs.getContext('2d');
  const { W, H } = _viewport();
  cvs.width = W; cvs.height = H;

  const eco = {
    creatures: [],
    debris: [],
    tick: 0,
    seedHue: (_hexToHsl(c.primaryColor) || { h: Math.random() * 360 }).h,
    targetCount: 8 + Math.round(c.intensity * 1.0),   // 9..18 (perf-conservative)
  };
  _v2SeedDebris(eco, W, H, 40 + Math.round(c.intensity * 6));
  // Initial population — pre-seed full target so the dish opens lively.
  for (let i = 0; i < eco.targetCount; i++) {
    eco.creatures.push(_v2MakeCreature(_v2PickSpecies(), { seedHue: eco.seedHue, W, H }));
    eco.creatures[eco.creatures.length - 1].state = 'live';
    eco.creatures[eco.creatures.length - 1].born = 24;
  }

  function frame() {
    eco.tick++;
    const base = _effectiveSecondary() || c.secondaryColor;
    _v2DrawSubstrate(ctx, W, H, base, eco.tick);
    _v2StepDebris(eco, W, H);
    _v2DrawDebris(ctx, eco);
    _v2StepCreatures(eco, W, H, c);
    const drawList = eco.creatures.slice().sort((a, b) => a.y - b.y);
    for (const k of drawList) _v2DrawCreature(ctx, k);
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

function _bgPetri(layer, c) {
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const ctx = cvs.getContext('2d');
  const { W, H } = _viewport();
  cvs.width = W; cvs.height = H;

  // When the streamer picked a custom palette (trio/quad/rainbow), use
  // its hues directly so the petri colony matches their colors exactly.
  // Otherwise hue-rotate around primaryColor for variety (legacy).
  const userPalette = Array.isArray(c.palette) && c.palette.length >= 2 ? c.palette : null;
  const seedPalette = userPalette
    ? userPalette.map((hex) => { const h = _hexToHsl(hex); return h ? h.h : Math.random() * 360; })
    : _petriPalette(c.primaryColor, 6).map((hex) => { const h = _hexToHsl(hex); return h ? h.h : Math.random() * 360; });
  const targetCount = 10 + Math.round(c.intensity * 1.2);
  const minPop = Math.max(4, Math.round(targetCount * 0.3));
  const maxPop = Math.min(32, Math.round(targetCount * 1.6));
  const baseR = 14 + c.intensity * 3;
  const baseV = 0.18 + c.speed * 0.18;

  const blobs = [];
  const toxinPuffs = [];   // tiny visual particles around toxic blobs
  let frameTick = 0;

  function spawnFromGenome(g, opts = {}) {
    const ang = Math.random() * Math.PI * 2;
    const v = _gSpeed(g, baseV) * (0.6 + Math.random() * 0.6);
    return {
      g,
      x: opts.x != null ? opts.x : Math.random() * W,
      y: opts.y != null ? opts.y : Math.random() * H,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      r: _gRadius(g, baseR),
      energy: opts.energy != null ? opts.energy : 90,
      age: 0,
      maxAge: 3000 + g.lifespan * 9000,
      state: 'born',
      lifePhase: opts.lifePhase != null ? opts.lifePhase : 0,
      rot: Math.random() * Math.PI * 2,
      rotV: _rand(-0.012, 0.012),
    };
  }
  function seedNewSpecies() {
    const hue = seedPalette[Math.floor(Math.random() * seedPalette.length)] + _rand(-30, 30);
    const g = _randomGenome((hue + 720) % 360);
    return spawnFromGenome(g, { lifePhase: _rand(0.4, 0.9) });
  }
  for (let i = 0; i < targetCount; i++) blobs.push(seedNewSpecies());

  // Rebuilt per-frame because tint() can re-tone the secondary color
  // mid-animation. Cached against last-secondary so we skip the rebuild
  // on frames where nothing changed.
  let _bgGrad = null;
  let _bgGradKey = '';
  function _currentBgGrad() {
    const sec = _effectiveSecondary() || c.secondaryColor;
    const key = sec;
    if (key !== _bgGradKey) {
      _bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      _bgGrad.addColorStop(0, sec);
      _bgGrad.addColorStop(1, _shade(sec, -15));
      _bgGradKey = key;
    }
    return _bgGrad;
  }

  // True if a's tribe (within cooperation arc of its hue) includes b.
  function _sameTribe(a, b) {
    const arc = a.g.cooperation * 80;          // up to ±80° tribe radius
    if (arc <= 0) return false;
    let d = Math.abs(((a.g.hue - b.g.hue + 540) % 360) - 180);
    return d <= arc;
  }

  function frame() {
    frameTick++;
    ctx.fillStyle = _currentBgGrad();
    ctx.fillRect(0, 0, W, H);

    // ── PHASE 1: behavior + intent ────────────────────────────────
    for (const b of blobs) {
      if (b.state !== 'live') continue;
      const perceptionR = 80 + b.g.perception * 240;
      let intent = null;       // { tx, ty, mode: 'chase'|'evade' }
      // Aggressive: scan for weaker non-tribe prey.
      if (b.g.aggression > 0.6) {
        let best = null, bestScore = Infinity;
        for (const o of blobs) {
          if (o === b || o.state !== 'live') continue;
          if (_sameTribe(b, o)) continue;
          const dx = o.x - b.x, dy = o.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > perceptionR * perceptionR) continue;
          // Prefer smaller, weaker targets — score lower is better.
          if (o.r >= b.r * 1.1) continue;
          const score = o.r + o.energy * 0.2;
          if (score < bestScore) { bestScore = score; best = o; }
        }
        if (best) intent = { tx: best.x, ty: best.y, mode: 'chase' };
      }
      // Friendly: scan for bigger threats to evade.
      else if (b.g.aggression < 0.4) {
        let worst = null, worstD = Infinity;
        for (const o of blobs) {
          if (o === b || o.state !== 'live') continue;
          if (o.r <= b.r * 1.1) continue;
          const dx = o.x - b.x, dy = o.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > perceptionR * perceptionR) continue;
          if (d2 < worstD) { worstD = d2; worst = o; }
        }
        if (worst) intent = { tx: worst.x, ty: worst.y, mode: 'evade' };
      }
      // Apply intent to velocity (gentle steering, not snap-to).
      const desiredV = _gSpeed(b.g, baseV);
      if (intent) {
        const dx = intent.tx - b.x, dy = intent.ty - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const sign = intent.mode === 'chase' ? 1 : -1;
        const tvx = (dx / dist) * desiredV * sign;
        const tvy = (dy / dist) * desiredV * sign;
        b.vx = b.vx * 0.92 + tvx * 0.08;
        b.vy = b.vy * 0.92 + tvy * 0.08;
      } else {
        // Wander: small random heading nudges.
        if (frameTick % 30 === 0) {
          const ang = Math.atan2(b.vy, b.vx) + _rand(-0.6, 0.6);
          b.vx = Math.cos(ang) * desiredV;
          b.vy = Math.sin(ang) * desiredV;
        }
      }
    }

    // ── PHASE 2: motion + energy + age ─────────────────────────────
    for (const b of blobs) {
      if (b.state === 'born') {
        b.lifePhase = Math.min(1, b.lifePhase + 0.025);
        if (b.lifePhase >= 1) b.state = 'live';
      } else if (b.state === 'dying') {
        b.lifePhase -= 0.05;
        b.r *= 0.93;
      }
      if (b.state === 'live') {
        b.age++;
        // Metabolism: base drain + toxin-prod tax + size cost. Halved from
        // the original tuning so blobs don't starve in 6 seconds.
        const drain = 0.012 + b.g.metabolism * 0.045 + b.g.toxinProduction * 0.03 + b.r * 0.0004;
        // Passive trickle — ambient resource everyone gets just from
        // existing. Friendly (low-aggression) blobs get a photosynthesis
        // bonus so a peaceful strategy is genuinely viable without
        // needing to hunt. Aggressive blobs barely tick — they must hunt.
        let trickle = 0.025;
        if (b.g.aggression < 0.4) trickle += 0.025;
        else if (b.g.aggression > 0.6) trickle = 0.008;
        b.energy = Math.min(150, b.energy + trickle - drain);
        // Death: starvation or old age.
        if (b.age > b.maxAge || b.energy <= 0) b.state = 'dying';
      }
      b.x += b.vx; b.y += b.vy;
      b.rot += b.rotV;
      if (b.x - b.r < 0)   { b.x = b.r;     b.vx = Math.abs(b.vx) * 0.95; }
      if (b.x + b.r > W)   { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.95; }
      if (b.y - b.r < 0)   { b.y = b.r;     b.vy = Math.abs(b.vy) * 0.95; }
      if (b.y + b.r > H)   { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.95; }
    }

    // ── PHASE 3: toxin warfare (radius damage) ─────────────────────
    for (const t of blobs) {
      if (t.state !== 'live') continue;
      if (t.g.toxinProduction < 0.3) continue;
      const toxR = 50 + t.g.toxinProduction * 90;
      for (const v of blobs) {
        if (v === t || v.state !== 'live') continue;
        if (_sameTribe(t, v)) continue;            // tribe immunity
        const dx = v.x - t.x, dy = v.y - t.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > toxR * toxR) continue;
        const d = Math.sqrt(d2);
        const dmg = t.g.toxinProduction * 0.10 * (1 - v.g.resistance) * (1 - d / toxR);
        v.energy -= dmg;
      }
      // Occasional toxin puff for visual feedback.
      if (frameTick % 14 === 0 && Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2;
        const off = t.r * (0.8 + Math.random() * 0.3);
        toxinPuffs.push({
          x: t.x + Math.cos(ang) * off,
          y: t.y + Math.sin(ang) * off,
          vx: Math.cos(ang) * 0.4,
          vy: Math.sin(ang) * 0.4 - 0.2,
          life: 1,
          hue: t.g.hue,
        });
      }
    }

    // ── PHASE 4: physical contact — bite-based combat ──────────────
    // Replaces the old instant-absorb. When a bigger blob contacts a
    // smaller non-tribe one, it takes a bite: transfer some energy +
    // shrink prey slightly. Prey only dies once shrunken below floor or
    // out of energy — combat plays out over several touches so the prey
    // has a chance to escape and the dish stays populated longer.
    const MIN_R = 6;
    for (let i = 0; i < blobs.length; i++) {
      const a = blobs[i];
      if (a.state !== 'live') continue;
      for (let j = i + 1; j < blobs.length; j++) {
        const b = blobs[j];
        if (b.state !== 'live') continue;
        if (_sameTribe(a, b)) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= (a.r + b.r) * 0.6) continue;
        // Determine predator + prey (larger eats smaller, only if size
        // advantage is meaningful — 20% bigger).
        let big, small;
        if (a.r > b.r * 1.2)      { big = a; small = b; }
        else if (b.r > a.r * 1.2) { big = b; small = a; }
        else {
          // Similar size: small elastic bounce so they don't stick.
          const nx = dx / (dist || 1), ny = dy / (dist || 1);
          a.vx += nx * 0.4; a.vy += ny * 0.4;
          b.vx -= nx * 0.4; b.vy -= ny * 0.4;
          continue;
        }
        // Peaceful hosts don't hunt — only aggressive blobs initiate
        // biting. Same elastic bounce as similar-size case. This keeps
        // leeches viable parasites: they can latch onto a friendly
        // giant without being nibbled to death first.
        if (big.g.aggression < 0.5) {
          const nx = dx / (dist || 1), ny = dy / (dist || 1);
          big.vx += nx * 0.2; big.vy += ny * 0.2;
          small.vx -= nx * 0.6; small.vy -= ny * 0.6;
          continue;
        }
        // Bite size scales with predator aggression; friendlies barely nibble.
        const biteFrac = 0.10 + big.g.aggression * 0.18;
        const energyBite = Math.min(small.energy, small.energy * biteFrac + 4);
        const sizeBite = small.r * (biteFrac * 0.55);
        small.energy -= energyBite;
        small.r -= sizeBite;
        big.energy = Math.min(150, big.energy + energyBite * 0.85);
        big.r = Math.min(W * 0.22, Math.sqrt(big.r * big.r + sizeBite * sizeBite * 0.6));
        // Knockback so prey isn't stuck inside predator next frame.
        const nx = dx / (dist || 1), ny = dy / (dist || 1);
        small.vx -= nx * 0.9; small.vy -= ny * 0.9;
        // Slight hue drift on predator (visible "ate that").
        let dHue = ((small.g.hue - big.g.hue + 540) % 360) - 180;
        big.g.hue = (big.g.hue + dHue * 0.04 + 720) % 360;
        // Prey dies when too small or starved.
        if (small.r < MIN_R || small.energy <= 0) small.state = 'dying';
      }
    }

    // ── PHASE 4.5: leech behavior ──────────────────────────────────
    // Tiny low-aggression blobs (size < 0.3) acting as parasites: when
    // they're near a much larger non-tribe host (>2.2x their radius)
    // they latch on — steer toward the host and drain energy slowly.
    // They don't trigger Phase-4 bite combat because of the 1.2x-size
    // threshold (host is much bigger, so leech is prey not predator —
    // BUT host's aggression has to be high enough to bother biting back,
    // and tribes still apply). Leeches survive a long time on big hosts.
    for (const leech of blobs) {
      if (leech.state !== 'live') continue;
      if (leech.g.size >= 0.3) continue;
      // Pick the largest non-tribe host within perception.
      const perR = 90 + leech.g.perception * 220;
      let host = null, hostR = -1;
      for (const o of blobs) {
        if (o === leech || o.state !== 'live') continue;
        if (_sameTribe(leech, o)) continue;
        if (o.r < leech.r * 2.2) continue;
        const dx = o.x - leech.x, dy = o.y - leech.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > perR * perR) continue;
        if (o.r > hostR) { hostR = o.r; host = o; }
      }
      if (!host) continue;
      // Steer toward the host (override wander/evade).
      const dx = host.x - leech.x, dy = host.y - leech.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const desiredV = _gSpeed(leech.g, baseV) * 1.2;
      const tvx = (dx / dist) * desiredV;
      const tvy = (dy / dist) * desiredV;
      leech.vx = leech.vx * 0.85 + tvx * 0.15;
      leech.vy = leech.vy * 0.85 + tvy * 0.15;
      // Latched? Drain.
      if (dist < (leech.r + host.r) * 1.1) {
        const drain = 0.10 * (1 - host.g.resistance * 0.6);
        const stolen = Math.min(host.energy, drain);
        host.energy -= stolen;
        leech.energy = Math.min(150, leech.energy + stolen * 0.9);
        // Stay glued — counter any drift.
        leech.vx *= 0.6; leech.vy *= 0.6;
      }
    }

    // ── PHASE 5: reproduction ──────────────────────────────────────
    // Healthy live blobs may bud off an offspring. With a tribemate within
    // perception, they breed (genome blend). Otherwise solo (parent + mut).
    const newborns = [];
    for (const a of blobs) {
      if (a.state !== 'live') continue;
      if (a.energy < 65) continue;
      const repChance = a.g.reproductionRate * 0.0035;
      if (Math.random() > repChance) continue;
      // Find a tribemate to breed with.
      let mate = null, mateD = Infinity;
      const perR = 100 + a.g.perception * 180;
      for (const o of blobs) {
        if (o === a || o.state !== 'live') continue;
        if (!_sameTribe(a, o)) continue;
        const dx = o.x - a.x, dy = o.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < perR * perR && d2 < mateD) { mateD = d2; mate = o; }
      }
      const childG = mate ? _blendGenome(a.g, mate.g, 0.1) : _blendGenome(a.g, a.g, 0.15);
      const ang = Math.random() * Math.PI * 2;
      const off = a.r * 1.4;
      const child = spawnFromGenome(childG, {
        x: a.x + Math.cos(ang) * off,
        y: a.y + Math.sin(ang) * off,
        energy: 50,
      });
      a.energy -= 35;
      newborns.push(child);
    }
    blobs.push(...newborns);

    // ── PHASE 6: render ────────────────────────────────────────────
    // Larger first so smaller ones layer on top.
    const sorted = blobs.slice().sort((x, y) => y.r - x.r);
    ctx.globalCompositeOperation = 'source-over';
    for (const b of sorted) {
      const a = Math.max(0, Math.min(1, b.lifePhase));
      if (a <= 0.02) continue;
      // Aggressive jitter / friendly breath — subtle pulse on rendered radius.
      let renderR = b.r;
      if (b.g.aggression > 0.6) renderR *= 1 + Math.sin(frameTick * 0.35 + b.x) * 0.04 * b.g.aggression;
      else if (b.g.aggression < 0.4) renderR *= 1 + Math.sin(frameTick * 0.04 + b.y) * 0.05;
      // Fluid wobble phase — frameTick-driven + per-blob position offset
      // so every blob's outline shimmers on its own beat. Slow phase
      // (0.025) reads as a calm breath rather than a tremor.
      const wobblePhase = frameTick * 0.025 + b.x * 0.013 + b.y * 0.011;
      const fluidity = 1.4 - b.g.aggression * 0.9;
      ctx.fillStyle = _gColor(b.g);
      _drawShape(ctx, b.x, b.y, renderR, b.g.shape, b.rot, wobblePhase, fluidity);
      ctx.globalAlpha = a;
      ctx.fill();
      // Membrane border — lighter shade of the body color. Trace the
      // SAME wobble path (same phase/fluidity) so border + fill align.
      ctx.strokeStyle = `hsla(${b.g.hue.toFixed(0)}, 80%, ${(70 + b.g.aggression * 10).toFixed(0)}%, ${(0.7 * a).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      _drawShape(ctx, b.x, b.y, Math.max(0, renderR - 1.5), b.g.shape, b.rot, wobblePhase, fluidity);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Toxin puffs (additive bloom for sci-fi feel).
    ctx.globalCompositeOperation = 'lighter';
    for (let i = toxinPuffs.length - 1; i >= 0; i--) {
      const p = toxinPuffs[i];
      p.x += p.vx; p.y += p.vy; p.vy -= 0.005; p.life -= 0.025;
      if (p.life <= 0) { toxinPuffs.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${p.hue.toFixed(0)}, 80%, 65%, ${(p.life * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + (1 - p.life) * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── PHASE 7: cull + population dynamics ────────────────────────
    for (let i = blobs.length - 1; i >= 0; i--) {
      if (blobs[i].state === 'dying' && blobs[i].lifePhase <= 0) blobs.splice(i, 1);
    }
    // Below floor — seed a random new species (resets the dish when one
    // strategy dominates and crashes from prey scarcity).
    if (blobs.length < minPop) {
      blobs.push(seedNewSpecies());
    }
    // Above cap — oldest live blob dies of old age.
    if (blobs.length > maxPop) {
      let oldest = null, oldestAge = -1;
      for (const b of blobs) {
        if (b.state === 'live' && b.age > oldestAge) { oldestAge = b.age; oldest = b; }
      }
      if (oldest) oldest.state = 'dying';
    }

    _activeRaf = requestAnimationFrame(frame);
  }
  _activeStop = () => { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); };
  _activeRaf = requestAnimationFrame(frame);
}

// ══════════════════════════════════════════════════════════════
// ──── Premium WebGL presets (prem-*) ─────────────────────────
// ══════════════════════════════════════════════════════════════
// Ported from /opt/chat-relay/public/streamer/goals-overlay.html
// 2026-05-22. Mirrors the parent overlay's prem-* preset set so
// Searchle can render the same higher-fidelity backgrounds inside
// its own iframe (Searchle is in _GAMES_RENDERING_OWN_BG, so the
// parent overlay defers bg rendering to us via postMessage).

const _PREM_PAL_HELPERS = `
        precision highp float;
        uniform vec2 uRes; uniform float uTime; uniform float uSpeed; uniform float uIntensity;
        uniform vec3 uPal[8]; uniform int uPalLen;

        // ── Palette accessors ──
        vec3 palAt(int i) {
          if (i <= 0) return uPal[0];
          if (i == 1) return uPal[1];
          if (i == 2) return uPal[2];
          if (i == 3) return uPal[3];
          if (i == 4) return uPal[4];
          if (i == 5) return uPal[5];
          if (i == 6) return uPal[6];
          return uPal[7];
        }
        vec3 palSample(float x) {
          // Smoothstep interpolation between palette stops — gives a much
          // softer gradient than linear mix between adjacent slots.
          float n = float(uPalLen);
          float s = clamp(x, 0.0, 0.999) * n;
          int i0 = int(floor(s));
          int i1 = int(min(float(uPalLen - 1), float(i0) + 1.0));
          float f = smoothstep(0.0, 1.0, fract(s));
          return mix(palAt(i0), palAt(i1), f);
        }
        // Palette accessor that wraps around — cycles through every color
        // even if i exceeds uPalLen. Lets shaders use a fixed element
        // count (e.g. 8 blobs) while still respecting palette length.
        vec3 palCycle(int i) {
          int n = uPalLen;
          int j = i;
          // Manual modulo since GLSL ES 1.0 lacks % on ints.
          // uPalLen <= 8, so up to two subtractions normalizes.
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          if (j >= n) j -= n;
          return palAt(j);
        }
        // Contrast-stretch a value from a typical noise range (lo..hi)
        // to full 0..1 so palSample reaches both palette endpoints.
        float expand01(float x, float lo, float hi) {
          return clamp((x - lo) / (hi - lo), 0.0, 1.0);
        }

        // ── Noise primitives ──
        float _hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = _hash21(i), b = _hash21(i + vec2(1.0, 0.0));
          float c = _hash21(i + vec2(0.0, 1.0)), d = _hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        // Standard 6-octave fbm — richer than the 3-octave we used before.
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 6; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
          return v;
        }
        // Inigo Quilez domain-warping — two iterations of fbm applied to
        // coordinates produce dramatically richer cloud / lava / mesh
        // structure than raw fbm. The signature look of "high-end"
        // procedural shaders.
        float fbmWarped(vec2 p, float t) {
          vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
          vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7 + t * 0.1, 9.2)),
                        fbm(p + 4.0 * q + vec2(8.3 + t * 0.07, 2.8)));
          return fbm(p + 4.0 * r);
        }
        // Curl noise — divergence-free vector field. Drives organic
        // swirling motion that looks like fluid flow vs. mechanical sines.
        vec2 curlNoise(vec2 p, float t) {
          float eps = 0.01;
          vec2 dx = vec2(eps, 0.0); vec2 dy = vec2(0.0, eps);
          float n1 = vnoise(p + dx + t * 0.3);
          float n2 = vnoise(p - dx + t * 0.3);
          float n3 = vnoise(p + dy + t * 0.3);
          float n4 = vnoise(p - dy + t * 0.3);
          return vec2((n3 - n4), -(n1 - n2)) / (2.0 * eps);
        }

        // ── HDR / post-processing ──
        // ACES filmic tonemap — turns HDR colors into rich, cinematic
        // output instead of clipping. Highlights compress softly,
        // shadows stay rich. Industry-standard look.
        vec3 acesFilm(vec3 x) {
          float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        // Soft single-pass "bloom" — push bright pixels up non-linearly
        // so highlights feel glowy. Not real multi-pass bloom but
        // cheap, additive, and visually convincing.
        vec3 softBloom(vec3 c) {
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          float bright = max(0.0, l - 0.55);
          return c + c * bright * 1.6;
        }
        // Saturation pump — boost peaks so palette colors pop.
        vec3 pumpSat(vec3 c, float amt) {
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          return mix(vec3(l), c, 1.0 + amt);
        }
        // Vignette — 1.0 at center, falls off toward corners.
        float vignette(vec2 uv) {
          vec2 d = uv - vec2(0.5);
          return clamp(1.0 - dot(d, d) * 1.6, 0.0, 1.0);
        }
        // Film grain — adds organic noise texture, hides banding.
        float filmGrain(vec2 uv, float t) {
          return (_hash21(uv * 360.0 + t * 13.7) - 0.5) * 0.045;
        }
      `;

// All 7 prem-* presets enabled — see goals-overlay.html for the
// root-cause note (noise2 → vnoise rename).
const _PREM_ENABLED = new Set([
  'prem-liquid-mesh', 'prem-oil-slick', 'prem-rain-glass',
  'prem-aurora', 'prem-particles', 'prem-cosmic-pulse',
  'prem-nebula', 'prem-nebula-v2', 'prem-nebula-v3', 'prem-nebula-v4',
]);
let _premLastError = null;
function _premCanvas(layer, fragSrcRaw) {
  const fragSrc = _PREM_PAL_HELPERS + '\n' + fragSrcRaw;
  const cvs = document.createElement('canvas');
  layer.appendChild(cvs);
  const isLandscape = document.body.classList.contains('landscape');
  const W = isLandscape ? 1920 : 1080;
  const H = isLandscape ? 1080 : 1920;
  cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  const gl = cvs.getContext('webgl', { antialias: true, premultipliedAlpha: false })
          || cvs.getContext('experimental-webgl');
  if (!gl) { console.warn('[bg] WebGL unavailable'); return null; }
  const vsSrc = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0., 1.); }';
  const compile = (src, type, label) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error('[bg] ' + label + ' compile:', log);
      _premLastError = label + ': ' + (log || 'unknown').split('\n')[0].slice(0, 160);
      return null;
    }
    return sh;
  };
  const vSh = compile(vsSrc, gl.VERTEX_SHADER, 'vs');
  const fSh = compile(fragSrc, gl.FRAGMENT_SHADER, 'fs');
  if (!vSh || !fSh) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vSh); gl.attachShader(program, fSh);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[bg] link:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, W, H);
  return {
    cvs, gl, program, W, H,
    u: (name) => gl.getUniformLocation(program, name),
    draw: () => gl.drawArrays(gl.TRIANGLES, 0, 6),
    stop: () => {
      try { gl.useProgram(null); gl.deleteProgram(program); gl.deleteShader(vSh); gl.deleteShader(fSh); gl.deleteBuffer(buf); } catch(_) {}
      if (cvs.parentNode) cvs.parentNode.removeChild(cvs);
    },
  };
}

function _bgPaletteToVec3(c, maxLen) {
  const max = maxLen || 8;
  let pal = (c && Array.isArray(c.palette) && c.palette.length) ? c.palette.slice(0, max) : null;
  if (!pal || !pal.length) {
    pal = [c?.primaryColor || '#5865F2', c?.secondaryColor || '#0a0e1a'];
  }
  const arr = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) {
    const hex = pal[i % pal.length] || '#5865F2';
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    arr[i*3]   = m ? parseInt(m[1], 16) / 255 : 0.5;
    arr[i*3+1] = m ? parseInt(m[2], 16) / 255 : 0.5;
    arr[i*3+2] = m ? parseInt(m[3], 16) / 255 : 0.5;
  }
  return { arr, len: pal.length };
}

function _premBoot(ctx, c, presetName) {
  const { gl, W, H } = ctx;
  gl.uniform2f(ctx.u('uRes'), W, H);
  gl.uniform1f(ctx.u('uSpeed'), Number(c.speed) || 5);
  gl.uniform1f(ctx.u('uIntensity'), Number(c.intensity) || 5);
  const pal = _bgPaletteToVec3(c, 8);
  gl.uniform3fv(ctx.u('uPal'), pal.arr);
  gl.uniform1i(ctx.u('uPalLen'), pal.len);
  _activeStop = () => { try { ctx.stop(); } catch(_) {} };
  console.log('[bg-searchle] ' + (presetName || 'prem-?') + ' running — palette=' + pal.len + ' speed=' + (c.speed || 5) + ' intensity=' + (c.intensity || 5));
}

// ── Preset: prem-liquid-mesh ─────────────────────────────────
const _premLiquidMeshFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.04 + uSpeed * 0.010);
          // Curl-noise UV warp — blobs swim through a divergence-free
          // velocity field instead of orbiting on perfect sines.
          vec2 warp = curlNoise(uv * 2.6, t * 0.5) * (0.04 + uIntensity * 0.004);
          vec2 wuv = uv + warp;
          vec3 col = vec3(0.0);
          float total = 0.0;
          // Always 8 blobs — palette cycles through them via palCycle so
          // duo mode = 4 blobs each color, quad = 2 each, rainbow = 1 each.
          for (int i = 0; i < 8; i++) {
            float fi = float(i);
            vec2 c = vec2(
              0.5 + 0.36 * sin(t * (0.7 + fi * 0.137) + fi * 1.71)
                  + 0.07 * sin(t * 2.31 + fi),
              0.5 + 0.34 * cos(t * (0.6 + fi * 0.173) + fi * 2.13)
                  + 0.07 * cos(t * 1.97 + fi * 1.4)
            );
            // Tighter radius (0.22) so adjacent palette colors don't all
            // average together at the canvas center.
            float r = 0.22 + 0.06 * sin(t * 0.5 + fi);
            float d = distance(wuv, c);
            float w = pow(smoothstep(r, 0.0, d), 1.6) * (0.7 + uIntensity * 0.05);
            col += palCycle(i) * w * 1.5;
            total += w;
          }
          col /= max(total, 0.001);
          col = softBloom(col);
          col = pumpSat(col, 0.18);
          col = acesFilm(col);
          col *= 0.62 + 0.38 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremLiquidMesh(layer, c) {
  const ctx = _premCanvas(layer, _premLiquidMeshFs);
  if (!ctx) { console.warn('[bg-searchle] prem-liquid-mesh shader failed — falling back to gradient-pulse'); _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-liquid-mesh');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-nebula ──────────────────────────────────────
const _premNebulaFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.02 + uSpeed * 0.008);
          vec2 q = uv * 2.6 + vec2(t * 0.4, -t * 0.3);
          float deep = fbmWarped(q, t);
          float mid  = fbm(q * 1.7 - vec2(t * 0.5));
          float raw = clamp(deep * 0.7 + mid * 0.4, 0.0, 1.0);
          // Contrast-stretch the noise into 0..1 so palSample reaches both
          // palette endpoints (raw fbm typically only spans ~0.25..0.75).
          float blend = expand01(raw, 0.20, 0.80);
          vec3 col = palSample(blend) * (0.7 + blend * 1.4);
          vec2 sp = uv * 220.0;
          float s = _hash21(floor(sp));
          if (s > 0.9985 && blend < 0.45) {
            float tw = 0.5 + 0.5 * sin(t * 6.0 + s * 60.0);
            col += vec3(1.0, 0.95, 0.9) * tw * 0.9;
          }
          col = softBloom(col);
          col = pumpSat(col, 0.25);
          col = acesFilm(col);
          col *= 0.55 + 0.45 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremNebula(layer, c) {
  const ctx = _premCanvas(layer, _premNebulaFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-nebula');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-nebula-v2 (Galactic Spiral) ─────────────────
const _premNebulaV2Fs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.015 + uSpeed * 0.007);
          // Polar coords centered on canvas — radius r, angle a.
          vec2 p = uv - 0.5;
          float r = length(p);
          float a = atan(p.y, p.x);
          // Differential rotation — inner regions spin faster than outer,
          // gives the spiral arm illusion.
          float rot = t * (2.2 - r * 0.9);
          vec2 polar = vec2(a + rot, r * 3.0);
          // Same warped fbm structure but applied in polar space.
          float deep = fbmWarped(polar * 1.4, t);
          float mid  = fbm(polar * 2.2 - vec2(t * 0.3, 0.0));
          float raw = clamp(deep * 0.75 + mid * 0.35, 0.0, 1.0);
          float blend = expand01(raw, 0.22, 0.78);
          vec3 col = palSample(blend) * (0.65 + blend * 1.5);
          // Bright galactic core — palette[0]-tinted, falls off with r.
          col += palAt(0) * smoothstep(0.45, 0.0, r) * 0.65;
          // Sparse field stars.
          vec2 sp = uv * 240.0;
          float s = _hash21(floor(sp));
          if (s > 0.9985) {
            float tw = 0.5 + 0.5 * sin(t * 8.0 + s * 60.0);
            col += vec3(1.0) * tw * 0.9;
          }
          col = softBloom(col);
          col = pumpSat(col, 0.30);
          col = acesFilm(col);
          col *= 0.50 + 0.50 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremNebulaV2(layer, c) {
  const ctx = _premCanvas(layer, _premNebulaV2Fs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-nebula-v2');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-nebula-v3 (Plasma Filaments) ────────────────
const _premNebulaV3Fs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.025 + uSpeed * 0.010);
          vec2 q = uv * 2.2 + vec2(t * 0.3, -t * 0.2);
          // Ridged noise: invert centered fbm via abs() to get sharp ridges.
          float n1 = 1.0 - abs(fbmWarped(q, t) - 0.5) * 2.0;
          float n2 = 1.0 - abs(fbm(q * 1.7 + vec2(t * 0.4, 0.0)) - 0.5) * 2.0;
          float ridges = pow(max(n1, n2), 1.6);
          // Horizontal electric streaks via curl-noise warp.
          vec2 cw = curlNoise(uv * 3.0, t * 0.5);
          float streak = pow(max(0.0, 1.0 - abs(uv.x + cw.y * 0.4 - 0.5) * 1.6), 60.0);
          float raw = clamp(ridges * 0.85 + streak * 0.5, 0.0, 1.0);
          float blend = expand01(raw, 0.15, 0.85);
          vec3 col = palSample(blend) * (0.5 + blend * 1.8);
          // High-energy filament cores — bright palette accents at ridge peaks.
          col += palCycle(int(ridges * 7.0)) * pow(ridges, 4.0) * 1.5;
          col = softBloom(col);
          col = pumpSat(col, 0.35);
          col = acesFilm(col);
          col *= 0.50 + 0.50 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremNebulaV3(layer, c) {
  const ctx = _premCanvas(layer, _premNebulaV3Fs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-nebula-v3');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-nebula-v4 (Rainbow Plasma) ──────────────────
const _premNebulaV4Fs = `
        varying vec2 vUv;
        uniform float uV4HueOffset;
        uniform float uV4HueSpeed;
        uniform float uV4Sat;
        uniform float uV4Lum;
        uniform float uV4PlasmaScale;
        vec3 cosRainbow(float t, float L, float amp) {
          return vec3(L) + amp * cos(6.2832 * (vec3(t) + vec3(0.0, 0.333, 0.667)));
        }
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.025 + uSpeed * 0.010);
          float cellScale = 2.2 / max(0.001, uV4PlasmaScale);
          vec2 q = uv * cellScale + vec2(t * 0.3, -t * 0.2);
          float n1 = 1.0 - abs(fbmWarped(q, t) - 0.5) * 2.0;
          float n2 = 1.0 - abs(fbm(q * 1.7 + vec2(t * 0.4, 0.0)) - 0.5) * 2.0;
          float ridges = pow(max(n1, n2), 1.6);
          vec2 cw = curlNoise(uv * 3.0, t * 0.5);
          float streak = pow(max(0.0, 1.0 - abs(uv.x + cw.y * 0.4 - 0.5) * 1.6), 60.0);
          float raw = clamp(ridges * 0.85 + streak * 0.5, 0.0, 1.0);
          float blend = expand01(raw, 0.15, 0.85);
          float hueOffset = uV4HueOffset + uTime * 0.025 * uV4HueSpeed;
          vec3 col = cosRainbow(blend + hueOffset, uV4Lum, uV4Sat) * (0.55 + blend * 0.40);
          col += cosRainbow(ridges + hueOffset + 0.5, uV4Lum + 0.02, uV4Sat) * pow(ridges, 4.0) * 0.30;
          col *= 0.50 + 0.50 * vignette(uv);
          float finalMul = 0.55 + (uIntensity - 5.0) * 0.046;
          col *= clamp(finalMul, 0.40, 1.05);
          col += filmGrain(uv, uTime) * 0.5;
          col = clamp(col, 0.0, 1.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremNebulaV4(layer, c) {
  const ctx = _premCanvas(layer, _premNebulaV4Fs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-nebula-v4');
  const v4 = (c && typeof c.v4 === 'object' && c.v4) ? c.v4 : {};
  const _num = (v, dflt, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  };
  ctx.gl.uniform1f(ctx.u('uV4HueOffset'),   _num(v4.hueOffset,   0.00, 0.00, 1.00));
  ctx.gl.uniform1f(ctx.u('uV4HueSpeed'),    _num(v4.hueSpeed,    1.00, 0.00, 3.00));
  ctx.gl.uniform1f(ctx.u('uV4Sat'),         _num(v4.sat,         0.16, 0.05, 0.30));
  ctx.gl.uniform1f(ctx.u('uV4Lum'),         _num(v4.lum,         0.20, 0.10, 0.35));
  ctx.gl.uniform1f(ctx.u('uV4PlasmaScale'), _num(v4.plasmaScale, 1.00, 0.50, 2.50));
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-aurora ──────────────────────────────────────
const _premAuroraFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.10 + uSpeed * 0.04);
          // Soft night-sky base.
          vec3 sky = mix(vec3(0.03, 0.04, 0.10), vec3(0.0, 0.0, 0.02), 1.0 - uv.y);
          vec3 col = sky;
          // 8 ribbons total — palCycle wraps through palette so duo mode
          // shows alternating colors, quad gets pairs, rainbow = 8 unique.
          for (int i = 0; i < 8; i++) {
            float fi = float(i);
            // Spread peak heights more deliberately so ribbons don't pile up.
            float yPeak = 0.30 + (fi / 7.0) * 0.45 + 0.06 * sin(fi * 1.31 + t * 0.3);
            float thick = 0.075 + uIntensity * 0.012;
            float warp = vnoise(vec2(uv.x * 3.0 + fi, t + fi * 7.0)) * 0.18
                       + vnoise(vec2(uv.x * 8.0 - fi, t * 1.7)) * 0.08
                       + vnoise(vec2(uv.x * 20.0 + fi * 3.0, t * 3.2)) * 0.025;
            float dy = uv.y - (yPeak + warp);
            float lum;
            if (dy > 0.0) lum = exp(-dy * dy / (thick * thick)) * 0.7;
            else          lum = exp(-dy * dy / (thick * thick * 5.0)) * 1.2;
            lum *= 0.85 + 0.15 * sin(uv.x * 18.0 + t * 4.0 + fi);
            col += palCycle(i) * lum * (0.65 + uIntensity * 0.045) * 1.3;
          }
          // Layered starfield — 3 depths, palette-tinted twinkle.
          if (uv.y > 0.40) {
            for (int L = 0; L < 3; L++) {
              float scale = 160.0 + float(L) * 90.0;
              vec2 sp = uv * vec2(scale, scale * 1.78);
              float s = _hash21(floor(sp));
              float thresh = 0.998 - float(L) * 0.001;
              if (s > thresh) {
                float tw = 0.5 + 0.5 * sin(t * 4.0 + s * 30.0);
                col += vec3(1.0, 0.96, 0.85) * tw * (0.9 - float(L) * 0.25);
              }
            }
          }
          // Ground glow palette-tinted.
          float ground = smoothstep(0.20, 0.0, uv.y);
          col += palAt(0) * ground * 0.22;
          col = softBloom(col);
          col = pumpSat(col, 0.20);
          col = acesFilm(col);
          col *= 0.70 + 0.30 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremAurora(layer, c) {
  const ctx = _premCanvas(layer, _premAuroraFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-aurora');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-oil-slick ──────────────────────────────────
const _premOilSlickFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.08 + uSpeed * 0.04);
          // Curl-noise UV warp distorts the surface — simulates the
          // shifting micro-topography of oil floating on water.
          vec2 wuv = uv + curlNoise(uv * 3.0, t * 0.7) * 0.03;
          // Film thickness = base sinusoid layers + multi-octave noise
          // crinkles. Noise breaks the perfect-grid look.
          float thickness =
              sin(wuv.x * 6.0 + t) * 0.5
            + sin(wuv.y * 8.0 - t * 0.7) * 0.4
            + sin((wuv.x + wuv.y) * 5.0 + t * 1.3) * 0.3
            + sin(length(wuv - 0.5) * 18.0 - t) * 0.25
            + fbm(wuv * 8.0 + t * 0.3) * 0.4;
          thickness *= 0.5 + uIntensity * 0.03;
          // Map thickness to palette — fract gives full hue cycle on the
          // smoothstep-interpolated palette → iridescent shift.
          float hue = fract(thickness * 0.5 + 0.5 + t * 0.05);
          vec3 col = palSample(hue) * 1.2;
          // Specular: two highlight frequencies (broad + sharp) for
          // CD-rainbow look. Highlights HDR-blast past 1.0.
          float spec1 = pow(0.5 + 0.5 * sin(thickness * 8.0 + t * 2.0), 6.0);
          float spec2 = pow(0.5 + 0.5 * sin(thickness * 18.0 - t), 24.0);
          col += vec3(1.0) * (spec1 * 0.25 + spec2 * 0.5);
          col = softBloom(col);
          col = pumpSat(col, 0.30);
          col = acesFilm(col);
          col *= 0.55 + 0.45 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremOilSlick(layer, c) {
  const ctx = _premCanvas(layer, _premOilSlickFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-oil-slick');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-rain-glass ──────────────────────────────────
const _premRainGlassFs = `
        varying vec2 vUv;
        // Per-column drop track — returns (head intensity, refraction
        // bulge, trail intensity). Drop fattens at the head and leaves a
        // dim wet streak above it.
        vec3 dropColumn(vec2 uv, float col, float t) {
          float phase = _hash21(vec2(col, 0.0));
          float speed = 0.15 + 0.5 * _hash21(vec2(col, 1.0));
          float y = fract(uv.y - (t * speed + phase));
          float head  = smoothstep(0.0, 0.04, y) * smoothstep(0.50, 0.0, y);
          float bulge = exp(-y * 12.0) * 0.05;
          // Wet streak persists above the head for ~30% of the column —
          // dim, faintly refractive.
          float trail = smoothstep(0.0, 0.04, y) * smoothstep(0.95, 0.40, y) * 0.30;
          return vec3(head, bulge, trail);
        }
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.35 + uSpeed * 0.12);
          // Glass background = palette gradient + condensation noise.
          // Use the full uv.y range to span all palette stops top-to-bottom.
          float gradient = 1.0 - uv.y;
          float cond = (fbm(uv * 6.0 + t * 0.05) - 0.5) * 0.18;
          vec3 bg = palSample(clamp(gradient + cond, 0.0, 1.0));
          int streams = 18 + int(uIntensity * 1.8);
          float drop = 0.0, refract = 0.0, trail = 0.0;
          for (int i = 0; i < 60; i++) {
            if (i >= streams) break;
            float col = float(i) / float(streams);
            float dx = uv.x - col;
            float colMask = exp(-dx * dx * 1600.0);
            vec3 d = dropColumn(uv, float(i) * 1.731, t);
            drop    += d.x * colMask;
            refract += d.y * colMask;
            trail   += d.z * colMask;
          }
          // Refract the bg sample where drops are — palette stretches.
          vec3 col = palSample(clamp(gradient + cond + refract * 0.6, 0.0, 1.0));
          // Trails brighten the bg slightly (revealing what's behind).
          col = mix(col, palSample(clamp(gradient + cond - 0.1, 0.0, 1.0)), trail);
          // Drop heads: bright specular highlight, HDR-style.
          col += vec3(1.0) * pow(drop, 1.3) * 0.9;
          col = softBloom(col);
          col = pumpSat(col, 0.10);
          col = acesFilm(col);
          // Stronger vignette to feel like looking through a small lens.
          col *= 0.4 + 0.6 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremRainGlass(layer, c) {
  const ctx = _premCanvas(layer, _premRainGlassFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-rain-glass');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-cosmic-pulse ────────────────────────────────
const _premCosmicPulseFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.15 + uSpeed * 0.05);
          // Deep space base + faint nebula dust (warped fbm).
          float dust = fbmWarped(uv * 1.8, t * 0.4);
          vec3 col = mix(vec3(0.0), palAt(0) * 0.22, 1.0 - uv.y);
          col += palSample(dust) * dust * 0.08;
          // Five-layer parallax starfield — palette-tinted twinkles.
          for (int L = 0; L < 5; L++) {
            float scale = 80.0 + float(L) * 70.0;
            float par = t * (0.012 + float(L) * 0.006);
            vec2 sp = (uv + vec2(par, par * 0.4)) * vec2(scale, scale * 1.78);
            float s = _hash21(floor(sp));
            float thresh = 0.997 - float(L) * 0.002;
            if (s > thresh) {
              float tw = 0.5 + 0.5 * sin(t * 3.0 + s * 60.0);
              float br = (1.0 - float(L) * 0.18) * tw;
              // Some stars take palette tints (varies per L), others white.
              vec3 starCol = mix(vec3(1.0, 0.96, 0.88), palAt(int(s * 7.0)), 0.4);
              col += starCol * br * 0.85;
            }
          }
          // 8 shockwave rings — palCycle wraps through palette, so duo
          // mode shows alternating-color rings, quad gets pairs, rainbow
          // gives 8 unique-hue rings.
          for (int i = 0; i < 8; i++) {
            float fi = float(i);
            vec2 origin = vec2(
              -0.4 + 0.3 * sin(fi * 1.7),
              0.2 + 0.2 * cos(fi * 1.3)
            );
            float d = distance(uv, origin);
            float ringPhase = fract(t * 0.08 + fi * 0.18);
            float ringR = ringPhase * 2.5;
            float ringWidth = 0.018;
            float ring = exp(-pow((d - ringR) / ringWidth, 2.0)) * (1.0 - ringPhase) * 0.9;
            float inner = exp(-pow((d - ringR + 0.04) / 0.06, 2.0)) * (1.0 - ringPhase) * 0.25;
            col += palCycle(i) * (ring + inner) * (0.7 + uIntensity * 0.05);
          }
          col = softBloom(col);
          col = pumpSat(col, 0.20);
          col = acesFilm(col);
          col *= 0.45 + 0.55 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremCosmicPulse(layer, c) {
  const ctx = _premCanvas(layer, _premCosmicPulseFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-cosmic-pulse');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}

// ── Preset: prem-particles ───────────────────────────────────
const _premParticlesFs = `
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float t = uTime * (0.06 + uSpeed * 0.025);
          int lastIdx = uPalLen - 1;
          // Background: dark palette tone + faint nebula dust.
          float dust = fbm(uv * 1.6 + t * 0.2);
          vec3 col = palAt(lastIdx) * 0.18 + palSample(dust) * dust * 0.08;
          int count = 40 + int(uIntensity * 6.0);
          for (int i = 0; i < 80; i++) {
            if (i >= count) break;
            float fi = float(i);
            float sx = _hash21(vec2(fi, 1.0));
            float sy = _hash21(vec2(fi, 2.0));
            float sr = _hash21(vec2(fi, 3.0));
            float sp = _hash21(vec2(fi, 4.0));
            float sd = _hash21(vec2(fi, 5.0));  // depth (0=back, 1=front)
            // Curl-noise displacement adds organic swirling on top of
            // the base Lissajous orbit.
            vec2 base = vec2(
              sx + 0.20 * sin(t * (0.4 + sp * 0.6) + fi),
              fract(sy - t * (0.04 + sp * 0.03))
            );
            vec2 swirl = curlNoise(base * 1.5, t + fi) * 0.04;
            vec2 p = base + swirl;
            // Depth varies radius (DoF feel) — far particles smaller,
            // near particles bigger + softer.
            float radius = (0.018 + sr * 0.05) * (0.5 + sd);
            float d = distance(uv, p);
            // Two-tier glow: tight core + soft halo.
            float core = exp(-d * d / (radius * radius * 0.5));
            float halo = exp(-d * d / (radius * radius * 4.0)) * 0.35;
            vec3 pc = palCycle(i);
            // Color-shift over time per particle (palette breathing).
            pc = mix(pc, palCycle(i + 1), 0.4 * (0.5 + 0.5 * sin(t * 0.5 + fi)));
            col += pc * (core + halo) * (0.7 + uIntensity * 0.04) * (0.6 + sd * 0.8);
          }
          col = softBloom(col);
          col = pumpSat(col, 0.22);
          col = acesFilm(col);
          col *= 0.6 + 0.4 * vignette(uv);
          col += filmGrain(uv, uTime);
          gl_FragColor = vec4(col, 1.0);
        }
      `;
function _bgPremParticles(layer, c) {
  const ctx = _premCanvas(layer, _premParticlesFs);
  if (!ctx) { _bgGradientPulse(layer, c); return; }
  _premBoot(ctx, c, 'prem-particles');
  const t0 = performance.now();
  function frame() {
    ctx.gl.uniform1f(ctx.u('uTime'), (performance.now() - t0) / 1000);
    ctx.draw();
    _activeRaf = requestAnimationFrame(frame);
  }
  _activeRaf = requestAnimationFrame(frame);
}


// ===== Public API =====
// Resolve the active color palette from a bg config. Same shape as
// goals-overlay.html's _bgResolvePalette — duplicated here so the
// searchle iframe doesn't need to import dashboard JS.
function _resolvePalette(c) {
  if (!c) return ['#5865F2', '#0a0e1a'];
  const mode = c.colorMode || 'duo';
  if (mode === 'rainbow') {
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(_hslToHex2((i * 360 / 8) % 360, 0.78, 0.55));
    }
    return out;
  }
  const targetLen = mode === 'quad' ? 4 : mode === 'trio' ? 3 : 2;
  const palette = [];
  if (Array.isArray(c.colors)) {
    for (const hex of c.colors) {
      if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) palette.push(hex);
      if (palette.length >= targetLen) break;
    }
  }
  while (palette.length < targetLen) {
    if (palette.length === 0) palette.push(c.primaryColor || '#5865F2');
    else if (palette.length === 1) palette.push(c.secondaryColor || '#0a0e1a');
    else palette.push(palette[palette.length - 1]);
  }
  return palette;
}
function _hslToHex2(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

export function mount(config) {
  if (!config || config.preset === 'none') return;
  _activeConfig = { ...config };
  // Resolve palette + back-fill primary/secondary so existing renderers
  // that read c.primaryColor / c.secondaryColor still see the right
  // colors when the user chose trio/quad/rainbow mode.
  _activeConfig.palette = _resolvePalette(_activeConfig);
  if (_activeConfig.palette.length > 0) {
    _activeConfig.primaryColor = _activeConfig.palette[0];
    _activeConfig.secondaryColor = _activeConfig.palette[_activeConfig.palette.length - 1] || _activeConfig.palette[0];
  }
  config = _activeConfig;
  const layer = _ensureLayer();
  _teardown();
  layer.style.setProperty('--anim-bg-primary', config.primaryColor);
  layer.style.setProperty('--anim-bg-secondary', config.secondaryColor);
  layer.style.setProperty('--anim-bg-fg', config.primaryColor);
  // Apply x/y/scale from the config so the dashboard's position sliders
  // take effect on mount. applyTransform also stamps them back onto
  // _activeConfig so later live updates have a defined baseline.
  applyTransform({
    x: Number.isFinite(config.x) ? config.x : 50,
    y: Number.isFinite(config.y) ? config.y : 50,
    scale: Number.isFinite(config.scale) ? config.scale : 100,
  });
  // Game-name watermark (e.g. "SEARCHLE") behind the canvas.
  setShowGameName(!!config.showGameName, config.gameName || '');
  switch (config.preset) {
    case 'gradient-pulse':  _bgGradientPulse(layer, config); break;
    case 'ripples':         _bgRipples(layer, config); break;
    case 'particles':       _bgParticles(layer, config); break;
    case 'vertical-scroll': _bgVerticalScroll(layer, config); break;
    case 'petri':           _bgPetriV2(layer, config); break;
    case 'psy-aurora':       _bgPsy(layer, config, 'aurora'); break;
    case 'psy-lava':         _bgPsy(layer, config, 'lava'); break;
    case 'psy-phoenix':      _bgPsy(layer, config, 'phoenix'); break;
    case 'psy-solar':        _bgPsy(layer, config, 'solar'); break;
    case 'psy-tidal':        _bgPsy(layer, config, 'tidal'); break;
    case 'psy-deep':         _bgPsy(layer, config, 'deep'); break;
    case 'psy-vaporwave':    _bgPsy(layer, config, 'vaporwave'); break;
    case 'psy-kaleidoscope': _bgPsy(layer, config, 'kaleidoscope'); break;
    case 'psy-chrome':       _bgPsy(layer, config, 'chrome'); break;
    case 'psy-void':         _bgPsy(layer, config, 'void'); break;
    case 'psy-supernova':    _bgPsy(layer, config, 'supernova'); break;
    // Premium WebGL presets — kill-switch routes to gradient-pulse while
    // we investigate a load-blocking issue. Re-enable by flipping
    // _PREM_DISABLED below.
    case 'prem-liquid-mesh':  _PREM_ENABLED.has('prem-liquid-mesh')  ? _bgPremLiquidMesh(layer, config)  : _bgGradientPulse(layer, config); break;
    case 'prem-nebula':       _PREM_ENABLED.has('prem-nebula')       ? _bgPremNebula(layer, config)       : _bgGradientPulse(layer, config); break;
    case 'prem-nebula-v2':    _PREM_ENABLED.has('prem-nebula-v2')    ? _bgPremNebulaV2(layer, config)     : _bgGradientPulse(layer, config); break;
    case 'prem-nebula-v3':    _PREM_ENABLED.has('prem-nebula-v3')    ? _bgPremNebulaV3(layer, config)     : _bgGradientPulse(layer, config); break;
    case 'prem-nebula-v4':    _PREM_ENABLED.has('prem-nebula-v4')    ? _bgPremNebulaV4(layer, config)     : _bgGradientPulse(layer, config); break;
    case 'prem-aurora':       _PREM_ENABLED.has('prem-aurora')       ? _bgPremAurora(layer, config)       : _bgGradientPulse(layer, config); break;
    case 'prem-oil-slick':    _PREM_ENABLED.has('prem-oil-slick')    ? _bgPremOilSlick(layer, config)    : _bgGradientPulse(layer, config); break;
    case 'prem-rain-glass':   _PREM_ENABLED.has('prem-rain-glass')   ? _bgPremRainGlass(layer, config)   : _bgGradientPulse(layer, config); break;
    case 'prem-cosmic-pulse': _PREM_ENABLED.has('prem-cosmic-pulse') ? _bgPremCosmicPulse(layer, config) : _bgGradientPulse(layer, config); break;
    case 'prem-particles':    _PREM_ENABLED.has('prem-particles')    ? _bgPremParticles(layer, config)    : _bgGradientPulse(layer, config); break;
    default:                _bgGradientPulse(layer, config); break;
  }
}

export function unmount() {
  _teardown();
  _activeConfig = null;
  _tintColor = null;
  if (_layer && _layer.parentNode) {
    _layer.parentNode.removeChild(_layer);
    _layer = null;
  }
}

// Temporary color tint — call when a winner's cosmetics include a
// hero-badge gradient. The bg primary/secondary blend toward the hero
// color for `durationMs` (fade-in/out of TINT_FADE_MS at each end),
// then drift back to the streamer's chosen palette. Idempotent: calling
// again with a new color restarts the timer.
//
// Pass a hex string like '#ff5e8c'. Renderers read _tintIntensity() +
// _effectivePrimary/Secondary() each frame so the tint is picked up
// without a teardown — blob state, canvas, and animation phase persist.
// Apply position + scale to the bg layer without rebuilding the renderer.
// x, y, scale are in canvas-percent units matching the parent overlay's
// resolveBg() shape (50/50/100 = centered, full size). Lets the dashboard
// X/Y/Scale sliders update live without losing animation state.
export function applyTransform(opts) {
  if (!_layer || !opts) return;
  const x = Number.isFinite(opts.x) ? opts.x : 50;
  const y = Number.isFinite(opts.y) ? opts.y : 50;
  const s = Number.isFinite(opts.scale) ? Math.max(10, Math.min(300, opts.scale)) : 100;
  const dx = (x - 50);     // canvas-percent offset from center
  const dy = (y - 50);
  _layer.style.transform = `translate(${dx}%, ${dy}%) scale(${s / 100})`;
  if (_activeConfig) {
    _activeConfig.x = x;
    _activeConfig.y = y;
    _activeConfig.scale = s;
  }
}

// Live color updates — gradients auto-pick these up next frame via
// _effective*(). No renderer rebuild needed.
export function applyColors(opts) {
  if (!_activeConfig || !opts) return;
  if (typeof opts.primaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(opts.primaryColor)) {
    _activeConfig.primaryColor = opts.primaryColor;
  }
  if (typeof opts.secondaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(opts.secondaryColor)) {
    _activeConfig.secondaryColor = opts.secondaryColor;
  }
  if (_layer) {
    _layer.style.setProperty('--anim-bg-primary', _activeConfig.primaryColor);
    _layer.style.setProperty('--anim-bg-secondary', _activeConfig.secondaryColor);
    _layer.style.setProperty('--anim-bg-fg', _activeConfig.primaryColor);
  }
}

// Toggle a watermark text label of the game name (or any string). Live
// add/remove without renderer rebuild. Empty `name` hides the watermark.
export function setShowGameName(enabled, name) {
  if (!_layer) return;
  let label = document.getElementById('anim-bg-name');
  if (!enabled || !name) {
    if (label) label.remove();
    return;
  }
  if (!label) {
    label = document.createElement('div');
    label.id = 'anim-bg-name';
    _layer.appendChild(label);
  }
  label.textContent = String(name).toUpperCase();
}

export function tint(hexColor, durationMs = 9000) {
  if (!hexColor || !/^#[0-9a-f]{6}$/i.test(hexColor)) return;
  _tintColor = hexColor.toLowerCase();
  _tintExpiresAt = Date.now() + durationMs;
  if (_layer) {
    _layer.style.setProperty('--anim-bg-primary', _effectivePrimary());
    _layer.style.setProperty('--anim-bg-secondary', _effectiveSecondary());
  }
  _startTintLoop();
}

// Per-frame ticker that keeps the CSS-var-driven presets (gradient-pulse)
// and the vscroll inline gradient in sync with the active tint. Canvas
// presets (ripples/particles/petri) read effective colors in their own
// frame loops so they don't need this. The loop self-terminates once
// the tint fades out, restoring the streamer's chosen palette.
let _tintRafId = null;
function _startTintLoop() {
  if (_tintRafId) return;
  const tick = () => {
    if (!_layer || !_activeConfig) { _tintRafId = null; return; }
    const t = _tintIntensity();
    const prim = _effectivePrimary() || _activeConfig.primaryColor;
    const sec = _effectiveSecondary() || _activeConfig.secondaryColor;
    _layer.style.setProperty('--anim-bg-primary', prim);
    _layer.style.setProperty('--anim-bg-secondary', sec);
    _layer.style.setProperty('--anim-bg-fg', prim);
    // Vertical-scroll uses an inline background gradient (no CSS var) —
    // recompute and reapply when the active preset is vscroll.
    if (_activeConfig.preset === 'vertical-scroll') {
      _layer.style.background = 'linear-gradient(180deg, ' + sec + ' 0%, ' + _shade(sec, -8) + ' 100%)';
    }
    if (t <= 0) { _tintRafId = null; return; }
    _tintRafId = requestAnimationFrame(tick);
  };
  _tintRafId = requestAnimationFrame(tick);
}

// Tint intensity 0..1 — full inside the [fade-in end, fade-out start]
// window, zero outside it. Drives blob colors via _effective*().
function _tintIntensity() {
  if (!_tintColor) return 0;
  const now = Date.now();
  const remaining = _tintExpiresAt - now;
  if (remaining <= -TINT_FADE_MS) {
    _tintColor = null;
    return 0;
  }
  // Fade out at the tail; otherwise the duration of the tint defines the
  // "full on" period. Fade-in is handled by caller-side timing if needed.
  if (remaining < 0) return Math.max(0, 1 + remaining / TINT_FADE_MS);
  return 1;
}

function _effectivePrimary() {
  if (!_activeConfig) return null;
  const t = _tintIntensity();
  if (t <= 0) return _activeConfig.primaryColor;
  // Cap tint blend at 0.65 so the streamer's chosen color isn't fully
  // erased — hero-badge color should *flavor* the bg, not replace it.
  return _mixHex(_activeConfig.primaryColor, _tintColor, t * 0.65);
}
function _effectiveSecondary() {
  if (!_activeConfig) return null;
  const t = _tintIntensity();
  if (t <= 0) return _activeConfig.secondaryColor;
  // Lower blend on secondary so the dark "background" stays mostly dark.
  return _mixHex(_activeConfig.secondaryColor, _tintColor, t * 0.30);
}
