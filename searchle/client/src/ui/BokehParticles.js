// ===== BokehParticles =====
// Multi-effect particle system that paints layered VFX bursts on new-chip
// insertions in the alt-mode grid. Despite the legacy filename, this now
// hosts six layered effect pools:
//
//   bokeh + halo : the original soft glowing pillow blobs (always)
//   spark        : small fast bright pinpoints (always — energy layer)
//   crisp        : sharp tiny pops with hard edges (always — sparkle)
//   flame        : rising orange/yellow flicker (hot guesses only)
//   smoke        : grey puffs growing + rising (hot guesses only)
//   ice          : white-cyan sharp shards radiating out (cold guesses)
//   snow         : drifting flakes with sinusoidal sway (cold guesses)
//
// Each effect is an instance of the generic _EffectPool helper — same
// shader, same attribute layout, different texture + per-particle spawn
// fn + size/color/physics profile. All pools share the same renderer,
// scene, camera and RAF loop; the main render is a single
// `renderer.render(scene, camera)` call with all Points objects in the
// scene (additive blending → draw order is mathematically commutative).
//
// Public API (unchanged):
//   const particles = new BokehParticles();
//   particles.emit(rect, hslColorOrHex, count = 32);
//   particles.dispose();

import * as THREE from 'three';

// ─── Constants ─────────────────────────────────────────────────────
const FADE_IN_MS = 180;

// Per-effect pool sizes. Sum is the total ceiling; idle pools cost
// almost nothing (their update loop short-circuits when active=0).
// Win-effect dispatch table — when a guesser has a win_effect cosmetic,
// the burst uses these per-profile pool ratios instead of the rank-tier
// defaults. Each entry tunes the burst's character to match the effect:
//   - bokehRatio + sparkRatio split `count` between soft halos and
//     fast pinpoints (must sum to ≤ 1.0).
//   - crispCount is an absolute count (not budget-driven).
//   - special: optional pool to also fire ('flame' | 'snow' | 'ice')
//     for thematic effects whose look isn't reproducible from
//     bokeh/spark/crisp alone (phoenix → orange flame; snowfall →
//     white flakes; cold-themed effects → ice shards).
const EFFECT_PROFILES = {
  // Spark-heavy explosive bursts — radial / energetic
  fireworks:      { bokehRatio: 0.25, sparkRatio: 0.75, crispCount: 20 },
  galaxy_burst:   { bokehRatio: 0.30, sparkRatio: 0.70, crispCount: 16 },
  nuclear:        { bokehRatio: 0.20, sparkRatio: 0.80, crispCount: 24 },
  meteors:        { bokehRatio: 0.10, sparkRatio: 0.90, crispCount: 10 },
  lightning:      { bokehRatio: 0.05, sparkRatio: 0.95, crispCount: 22 },
  // Confetti / sparkle — dense pinpoints + medium bokeh
  confetti:       { bokehRatio: 0.20, sparkRatio: 0.80, crispCount: 18 },
  sparkles:       { bokehRatio: 0.40, sparkRatio: 0.60, crispCount: 22 },
  // Soft, floaty — bokeh-dominated
  hearts:         { bokehRatio: 0.85, sparkRatio: 0.15, crispCount: 4 },
  cherry_blossom: { bokehRatio: 0.85, sparkRatio: 0.15, crispCount: 4 },
  aurora:         { bokehRatio: 0.90, sparkRatio: 0.10, crispCount: 2 },
  // Thematic specials — use a dedicated pool on top of the base burst
  snowfall:       { bokehRatio: 0.30, sparkRatio: 0.20, crispCount: 4, special: 'snow' },
  phoenix:        { bokehRatio: 0.25, sparkRatio: 0.45, crispCount: 10, special: 'flame' },
  // Fallback for any future / unknown effect string — balanced look
  _default:       { bokehRatio: 0.55, sparkRatio: 0.45, crispCount: 14 },
};

const POOL_SIZES = {
  bokeh: 400,
  spark: 160,
  crisp: 200,
  flame: 180,
  smoke: 80,
  ice:   180,
  snow:  120,
  // Trail: gold sparkles emitted along the path of floating XP bubbles.
  // ~30 emissions/sec × 4 particles × 2.5s × up to 3 concurrent bubbles
  // ≈ 900 in flight at peak — pool sized generously above that.
  trail: 1100,
  // Heart: dedicated win_effect pool. ~60 hearts × ~2.5s life × a few
  // concurrent guesses worst-case → sized generously.
  heart: 240,
  // Per-shape win_effect pools — sized for ~few concurrent guessers all
  // using the same effect. Confetti can spam, nuclear is huge but rare.
  confetti: 280,
  star:     260,
  flake:    220,
  petal:    260,
  bolt:     80,
  comet:    100,
  ring:     60,
  // Fan-club hearts — loads the actual fanclub-heart.png as a texture
  // so heart_shower particles render the brand heart icon, not the
  // canvas-drawn generic heart shape used by the legacy 'hearts' effect.
  fcHeart:  280,
};

// ─── Shaders ───────────────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute float opacity;
  attribute vec3 color;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vOpacity = opacity;
    vColor = color;
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(vColor, 1.0) * tex * vOpacity;
  }
`;

const HALO_VERTEX_SHADER = /* glsl */ `
  uniform float uSizeScale;
  attribute float size;
  attribute float opacity;
  attribute vec3 color;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vOpacity = opacity;
    vColor = color;
    gl_PointSize = size * uSizeScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uOpacityScale;
  uniform float uWhiteLift;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    vec3 lifted = mix(vColor, vec3(1.0), uWhiteLift);
    gl_FragColor = vec4(lifted, 1.0) * tex * vOpacity * uOpacityScale;
  }
`;

// ─── Color utils ───────────────────────────────────────────────────
function parseColor(c) {
  if (!c) return [1, 1, 1];
  if (c.startsWith('#')) {
    const s = c.slice(1);
    if (s.length === 6) {
      return [
        parseInt(s.slice(0, 2), 16) / 255,
        parseInt(s.slice(2, 4), 16) / 255,
        parseInt(s.slice(4, 6), 16) / 255,
      ];
    }
  }
  if (c.startsWith('hsl')) {
    const m = c.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
    if (m) return hslToRgb(parseFloat(m[1]) / 360, parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
  }
  return [1, 1, 1];
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = ((b - r) / d + 2);
  else                h = ((r - g) / d + 4);
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}

// ─── Perimeter sampling ────────────────────────────────────────────
// Given a chip rect and a normalized t in [0,1), return a position on
// the pill (capsule) perimeter plus the outward normal at that point.
function samplePillPerimeter(rect, t) {
  const W = rect.width || 0;
  const H = rect.height || 0;
  const radius = H / 2;
  const straight = Math.max(0, W - H);
  const perim = 2 * straight + 2 * Math.PI * radius;
  const cy = (rect.y || 0) + H / 2;
  const xLeftArc  = (rect.x || 0) + radius;
  const xRightArc = (rect.x || 0) + W - radius;
  if (perim === 0) {
    const ang = Math.random() * Math.PI * 2;
    return {
      x: (rect.x || 0) + W / 2,
      y: cy,
      nx: Math.cos(ang),
      ny: Math.sin(ang),
    };
  }
  const s = t * perim;
  if (s < straight) {
    return { x: xLeftArc + s, y: (rect.y || 0), nx: 0, ny: -1 };
  }
  if (s < straight + Math.PI * radius) {
    const a = (s - straight) / radius - Math.PI / 2;
    return {
      x: xRightArc + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
      nx: Math.cos(a),
      ny: Math.sin(a),
    };
  }
  if (s < 2 * straight + Math.PI * radius) {
    return {
      x: xRightArc - (s - straight - Math.PI * radius),
      y: (rect.y || 0) + H,
      nx: 0, ny: 1,
    };
  }
  const a = (s - 2 * straight - Math.PI * radius) / radius + Math.PI / 2;
  return {
    x: xLeftArc + Math.cos(a) * radius,
    y: cy + Math.sin(a) * radius,
    nx: Math.cos(a),
    ny: Math.sin(a),
  };
}

// ─── Texture generators ────────────────────────────────────────────
// All textures are square canvases with radial gradients. Bigger sizes
// give crisper bokeh at large render sizes; mipmaps handle the shrink.

function makeBokehTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,    'rgba(255,255,255,1.00)');
  g.addColorStop(0.06, 'rgba(255,255,255,0.94)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.64)');
  g.addColorStop(0.38, 'rgba(255,255,255,0.30)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.02)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const inner = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.05);
  inner.addColorStop(0, 'rgba(255,255,255,0.65)');
  inner.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = inner; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Crisp: sharp circle with hard cutoff — used for the "sparkle" layer.
// Tiny but very bright. No soft halo since the bokeh pool already has
// the halo pass; crisp particles read as sharp pixel-perfect dots.
function makeCrispTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Sharp white inner disc.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,    'rgba(255,255,255,1.00)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.50, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.70, 'rgba(255,255,255,0.10)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Flame: vertically-elongated drop with bright top + warmer bottom.
// Painted with overlapping gradients to fake the cooler tips + hot core.
function makeFlameTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Outer warm halo — broad orange-tinted glow
  const halo = ctx.createRadialGradient(size / 2, size * 0.55, 0, size / 2, size * 0.55, size * 0.5);
  halo.addColorStop(0,    'rgba(255, 200, 100, 0.95)');
  halo.addColorStop(0.30, 'rgba(255, 140, 50, 0.55)');
  halo.addColorStop(0.65, 'rgba(220, 70, 30, 0.20)');
  halo.addColorStop(1.00, 'rgba(180, 30, 20, 0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, size, size);
  // Hot core — bright yellow-white concentrated upper-middle
  const core = ctx.createRadialGradient(size / 2, size * 0.40, 0, size / 2, size * 0.40, size * 0.22);
  core.addColorStop(0,    'rgba(255, 255, 230, 1.00)');
  core.addColorStop(0.40, 'rgba(255, 240, 150, 0.80)');
  core.addColorStop(1.00, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = core; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Smoke: very soft gray puff — large radial fade with a slight inner
// density bump. Multiplicative blending would look better but we use
// the same additive pipeline; gray-on-transparent additive reads as a
// faint cloud which is fine.
function makeSmokeTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,    'rgba(160,160,160,0.55)');
  g.addColorStop(0.30, 'rgba(140,140,140,0.40)');
  g.addColorStop(0.60, 'rgba(120,120,120,0.18)');
  g.addColorStop(0.85, 'rgba(90,90,90,0.05)');
  g.addColorStop(1.00, 'rgba(60,60,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Ice: sharp four-point star sparkle — drawn with two crossed bright
// linear streaks plus a tight central glow. Reads as a tiny diamond.
function makeIceTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Soft cyan-white background glow
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.45);
  glow.addColorStop(0,    'rgba(220, 245, 255, 0.95)');
  glow.addColorStop(0.30, 'rgba(180, 220, 255, 0.55)');
  glow.addColorStop(0.75, 'rgba(120, 180, 230, 0.10)');
  glow.addColorStop(1.00, 'rgba(80, 140, 200, 0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, size, size);
  // Vertical streak (4-point star arm)
  const vert = ctx.createLinearGradient(size / 2, 0, size / 2, size);
  vert.addColorStop(0,    'rgba(255,255,255,0)');
  vert.addColorStop(0.40, 'rgba(230,245,255,0.85)');
  vert.addColorStop(0.50, 'rgba(255,255,255,1)');
  vert.addColorStop(0.60, 'rgba(230,245,255,0.85)');
  vert.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = vert;
  ctx.fillRect(size / 2 - 2, 0, 4, size);
  // Horizontal streak
  const horiz = ctx.createLinearGradient(0, size / 2, size, size / 2);
  horiz.addColorStop(0,    'rgba(255,255,255,0)');
  horiz.addColorStop(0.40, 'rgba(230,245,255,0.85)');
  horiz.addColorStop(0.50, 'rgba(255,255,255,1)');
  horiz.addColorStop(0.60, 'rgba(230,245,255,0.85)');
  horiz.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = horiz;
  ctx.fillRect(0, size / 2 - 2, size, 4);
  // Bright pinpoint center
  const center = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.06);
  center.addColorStop(0, 'rgba(255,255,255,1)');
  center.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = center; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Snow: small soft white flake — basically a smaller smoke without
// the gray, with a hint of cyan at the edge to feel cool.
function makeSnowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,    'rgba(255,255,255,0.95)');
  g.addColorStop(0.30, 'rgba(245,250,255,0.55)');
  g.addColorStop(0.65, 'rgba(220,235,255,0.18)');
  g.addColorStop(0.90, 'rgba(190,215,245,0.04)');
  g.addColorStop(1.00, 'rgba(180,210,245,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Heart: solid filled heart shape with a soft outer glow, used for the
// 'hearts' win_effect. White-on-transparent so the shader's vColor tint
// paints each particle in the player's palette colors.
function makeHeartTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // THREE.CanvasTexture defaults to flipY=true, which mirrors the canvas
  // vertically when sampled. Pre-flip the drawing transform here so the
  // heart renders point-DOWN (the natural way) in the final particle.
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  const cy = size / 2;
  // Heart spans ~80% of canvas with margin for the outer glow.
  const w = size * 0.78;
  const h = size * 0.72;
  const left = cx - w / 2;
  const top = cy - h * 0.42;

  function heartPath(scale = 1) {
    const sw = w * scale;
    const sh = h * scale;
    const sl = cx - sw / 2;
    const st = cy - sh * 0.42;
    ctx.beginPath();
    // Start at bottom point
    ctx.moveTo(cx, st + sh);
    // Left side rising up to left lobe
    ctx.bezierCurveTo(
      cx - sw * 0.60, st + sh * 0.65,
      cx - sw * 0.62, st + sh * 0.12,
      cx - sw * 0.28, st + sh * 0.05,
    );
    // Left lobe peak → dip in the middle
    ctx.bezierCurveTo(
      cx - sw * 0.10, st - sh * 0.05,
      cx,             st + sh * 0.10,
      cx,             st + sh * 0.20,
    );
    // Dip → right lobe peak
    ctx.bezierCurveTo(
      cx,             st + sh * 0.10,
      cx + sw * 0.10, st - sh * 0.05,
      cx + sw * 0.28, st + sh * 0.05,
    );
    // Right side back down to bottom point
    ctx.bezierCurveTo(
      cx + sw * 0.62, st + sh * 0.12,
      cx + sw * 0.60, st + sh * 0.65,
      cx,             st + sh,
    );
    ctx.closePath();
  }

  // Outer glow halo — wide and soft, painted in white so vColor tints it
  // the palette color. Drawn first so the solid heart sits on top.
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 48;
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  heartPath(1.05);
  ctx.fill();
  ctx.restore();

  // Solid bright heart
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  heartPath(1.0);
  ctx.fill();

  // Subtle highlight on the upper-left lobe to give a glossy feel.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const hi = ctx.createRadialGradient(
    cx - w * 0.18, top + h * 0.18, 0,
    cx - w * 0.18, top + h * 0.18, w * 0.22,
  );
  hi.addColorStop(0, 'rgba(255,255,255,0.85)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  return canvasToTexture(c);
}

// Confetti: thin tilted rectangle inside the square canvas with a soft
// outer glow. Used for the 'confetti' win_effect. Each particle gets a
// random rotation per emit (via canvas-baked tilt + multiple variants).
function makeConfettiTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Flip-y compensation (THREE.CanvasTexture defaults flipY = true).
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 6);
  ctx.translate(-cx, -cy);
  // Soft halo
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx - 90, cy - 22, 180, 44);
  ctx.restore();
  // Main confetti strip
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  ctx.fillRect(cx - 86, cy - 18, 172, 36);
  // Slight highlight strip on top half
  const hi = ctx.createLinearGradient(0, cy - 18, 0, cy);
  hi.addColorStop(0, 'rgba(255,255,255,0.6)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(cx - 86, cy - 18, 172, 18);
  ctx.restore();
  return canvasToTexture(c);
}

// Star: classic 5-point star with bright center halo. Used for sparkles
// + galaxy_burst.
function makeStarTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.42;
  const innerR = outerR * 0.42;
  function starPath(or, ir) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 === 0) ? or : ir;
      const a = -Math.PI / 2 + i * (Math.PI / 5);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  // Outer halo
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  starPath(outerR * 1.05, innerR * 1.05);
  ctx.fill();
  ctx.restore();
  // Solid star
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  starPath(outerR, innerR);
  ctx.fill();
  // Bright central core to give it sparkle pop
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR * 0.4);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Snowflake: 6-fold hexagonal crystal with branching arms. Used for
// 'snowfall' win_effect — each particle reads as an actual flake instead
// of a generic white blob.
function makeSnowflakeTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,1.0)';
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 18;
  const armLen = size * 0.36;
  const branchLen = armLen * 0.35;
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 3);
    ctx.lineWidth = 7;
    // Main arm
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(armLen, 0);
    ctx.stroke();
    // Two side branches at 60° outward
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(armLen * 0.55, 0);
    ctx.lineTo(armLen * 0.55 + branchLen * Math.cos(Math.PI / 3),
              branchLen * Math.sin(Math.PI / 3));
    ctx.moveTo(armLen * 0.55, 0);
    ctx.lineTo(armLen * 0.55 + branchLen * Math.cos(-Math.PI / 3),
              branchLen * Math.sin(-Math.PI / 3));
    ctx.stroke();
    // Smaller tip branches
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(armLen * 0.82, 0);
    ctx.lineTo(armLen * 0.82 + branchLen * 0.55 * Math.cos(Math.PI / 3),
              branchLen * 0.55 * Math.sin(Math.PI / 3));
    ctx.moveTo(armLen * 0.82, 0);
    ctx.lineTo(armLen * 0.82 + branchLen * 0.55 * Math.cos(-Math.PI / 3),
              branchLen * 0.55 * Math.sin(-Math.PI / 3));
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  // Bright central hub
  const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.10);
  hub.addColorStop(0, 'rgba(255,255,255,1.0)');
  hub.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hub;
  ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Petal: teardrop-shaped soft petal with a faint center vein. Used for
// 'cherry_blossom' win_effect.
function makePetalTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  const cy = size / 2;
  // Petal: ellipse pinched to a teardrop tip at bottom.
  function petalPath(scale = 1) {
    const w = size * 0.36 * scale;
    const h = size * 0.50 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);            // tip at top
    ctx.bezierCurveTo(
      cx + w, cy - h * 0.5,
      cx + w, cy + h * 0.5,
      cx, cy + h,                       // rounded bottom
    );
    ctx.bezierCurveTo(
      cx - w, cy + h * 0.5,
      cx - w, cy - h * 0.5,
      cx, cy - h,
    );
    ctx.closePath();
  }
  // Soft outer halo
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  petalPath(1.05);
  ctx.fill();
  ctx.restore();
  // Solid petal
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  petalPath(1.0);
  ctx.fill();
  // Subtle center vein for depth
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const vein = ctx.createLinearGradient(cx, cy - size * 0.25, cx, cy + size * 0.25);
  vein.addColorStop(0, 'rgba(255,255,255,0)');
  vein.addColorStop(0.5, 'rgba(255,200,220,0.18)');
  vein.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vein;
  ctx.fillRect(cx - 4, cy - size * 0.25, 8, size * 0.5);
  ctx.restore();
  return canvasToTexture(c);
}

// Bolt: jagged zigzag lightning shape, white with bright glow. Used for
// 'lightning' win_effect.
function makeBoltTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const cx = size / 2;
  function boltPath() {
    ctx.beginPath();
    // Classic zigzag bolt shape
    ctx.moveTo(cx + 12, 20);
    ctx.lineTo(cx - 18, size * 0.4);
    ctx.lineTo(cx + 4, size * 0.42);
    ctx.lineTo(cx - 22, size * 0.78);
    ctx.lineTo(cx + 18, size * 0.45);
    ctx.lineTo(cx - 6, size * 0.43);
    ctx.lineTo(cx + 22, 20);
    ctx.closePath();
  }
  // Outer halo
  ctx.save();
  ctx.shadowColor = 'rgba(180,230,255,0.9)';
  ctx.shadowBlur = 32;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  boltPath();
  ctx.fill();
  ctx.restore();
  // Solid bright bolt
  ctx.fillStyle = 'rgba(255,255,255,1.0)';
  boltPath();
  ctx.fill();
  return canvasToTexture(c);
}

// Comet: bright head with a long tapered tail trailing one direction.
// Used for 'meteors' win_effect.
function makeCometTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(0, size);
  ctx.scale(1, -1);
  const headX = size * 0.72;
  const headY = size * 0.50;
  // Tail: linear gradient from head fading toward upper-left
  const grad = ctx.createLinearGradient(headX, headY, size * 0.1, size * 0.85);
  grad.addColorStop(0,    'rgba(255,255,255,1.0)');
  grad.addColorStop(0.20, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(headX + 14, headY - 14);
  ctx.lineTo(headX + 14, headY + 14);
  ctx.lineTo(size * 0.10, size * 0.86);
  ctx.lineTo(size * 0.16, size * 0.92);
  ctx.closePath();
  ctx.fill();
  // Bright head
  const head = ctx.createRadialGradient(headX, headY, 0, headX, headY, 28);
  head.addColorStop(0, 'rgba(255,255,255,1.0)');
  head.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  head.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = head;
  ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

// Ring: thin annular ring (donut) with bright edge. Used for sonic_boom
// + nuclear blast wave halo.
function makeRingTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  // Concentric rings via composite radial gradients
  const g = ctx.createRadialGradient(cx, cy, size * 0.30, cx, cy, size * 0.48);
  g.addColorStop(0,    'rgba(255,255,255,0)');
  g.addColorStop(0.30, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.70)');
  g.addColorStop(0.68, 'rgba(255,255,255,1.00)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasToTexture(c);
}

function canvasToTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

// ─── Generic effect pool ───────────────────────────────────────────
// Single Points object backed by a fixed particle pool. The owning
// effect calls `emit()` with a per-particle spawn callback. Update is
// generic: physics integration + size/opacity curves + color lerp.
//
// Size profile is selected per particle (effect-specific). Color curve
// uses two endpoints (start → end) interpolated with t^colorCurve.
class _EffectPool {
  constructor(scene, texture, maxCount, options = {}) {
    this.maxCount = maxCount;
    this.particles = new Array(maxCount);
    this._freeIndices = new Array(maxCount);
    this._activeIndices = [];
    for (let i = 0; i < maxCount; i++) {
      this.particles[i] = {
        active: false,
        age: 0, life: 0,
        x: 0, y: 0,
        vx: 0, vy: 0,
        gravity: 0, drag: 0,
        peakSize: 0,
        r: 1, g: 1, b: 1,
        r2: 1, g2: 1, b2: 1,
        opacityCap: 0.7,
        colorCurve: 1.4,
        sizeProfile: 'bokeh',
        // Per-particle wobble (used by flame + snow for organic drift).
        // amp=0 disables wobble. freq is in radians per ms.
        wobAmpX: 0,
        wobAmpY: 0,
        wobFreq: 0,
        wobPhase: 0,
      };
      this._freeIndices[i] = maxCount - 1 - i;
    }
    this._activeCount = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3));
    this.geometry.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3));
    this.geometry.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(maxCount), 1));
    this.geometry.setAttribute('opacity',  new THREE.BufferAttribute(new Float32Array(maxCount), 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: options.blending || THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  // Spawn up to `count` particles. spawnFn is called for each newly
  // claimed particle slot — it mutates the particle object in place.
  emit(count, spawnFn) {
    let emitted = 0;
    while (this._freeIndices.length > 0 && emitted < count) {
      const i = this._freeIndices.pop();
      const p = this.particles[i];
      p.active = true;
      p.age = 0;
      spawnFn(p, emitted);
      emitted++;
      this._activeCount++;
      this._activeIndices.push(i);
    }
  }

  update(dt) {
    if (this._activeCount === 0) return;

    const posAttr = this.geometry.attributes.position;
    const colorAttr = this.geometry.attributes.color;
    const sizeAttr = this.geometry.attributes.size;
    const opacityAttr = this.geometry.attributes.opacity;
    const stillActive = [];

    for (const i of this._activeIndices) {
      const p = this.particles[i];
      p.age += dt * 1000;
      if (p.age >= p.life) {
        p.active = false;
        this._activeCount--;
        sizeAttr.array[i] = 0;
        opacityAttr.array[i] = 0;
        this._freeIndices.push(i);
        continue;
      }

      // Integrate
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      if (p.drag > 0) {
        const k = p.drag * dt;
        p.vx -= p.vx * k;
        p.vy -= p.vy * k;
      }
      // Optional sinusoidal wobble (in pixels) — added to position each frame
      if (p.wobAmpX !== 0 || p.wobAmpY !== 0) {
        const phase = p.age * p.wobFreq + p.wobPhase;
        // Apply as a velocity-style offset so it accumulates naturally.
        p.x += Math.sin(phase) * p.wobAmpX * dt;
        p.y += Math.cos(phase) * p.wobAmpY * dt;
      }

      const t = p.age / p.life;

      // Opacity: fade in over FADE_IN_MS, fade out over the remainder,
      // then scaled by per-particle opacityCap.
      let opacity;
      if (p.age < FADE_IN_MS) {
        opacity = p.age / FADE_IN_MS;
      } else {
        const remaining = p.life - p.age;
        const fadeOutWindow = p.life - FADE_IN_MS;
        opacity = remaining / fadeOutWindow;
      }
      opacity *= p.opacityCap;

      // Size curve — picked per particle. Each profile is a piecewise
      // function over t in [0,1] returning a multiplier on peakSize.
      let sizeMul = 1;
      switch (p.sizeProfile) {
        case 'spark': {
          if (t < 0.1) {
            const u = t / 0.1;
            sizeMul = 0.5 + 0.5 * (1 - (1 - u) * (1 - u));
          } else {
            sizeMul = 1 - 0.8 * ((t - 0.1) / 0.9);
          }
          break;
        }
        case 'crisp': {
          // Pop in fast, hold the bright sharp shape, fade quickly at end.
          if (t < 0.08) sizeMul = t / 0.08;
          else if (t < 0.70) sizeMul = 1;
          else sizeMul = 1 - (t - 0.70) / 0.30;
          break;
        }
        case 'flame': {
          // Quick bloom, slow taper. Flame stays close to peak briefly.
          if (t < 0.15) sizeMul = 0.6 + 0.4 * (t / 0.15);
          else sizeMul = 1 - 0.75 * ((t - 0.15) / 0.85);
          break;
        }
        case 'smoke': {
          // Grow continuously to ~2.4x peak, with opacity fading.
          sizeMul = 0.45 + 1.95 * t;
          break;
        }
        case 'ice': {
          // Fast bloom, sustained twinkle, fade out. Subtle size pulse
          // throughout the lifetime adds shimmer.
          if (t < 0.1) sizeMul = 0.45 + 0.55 * (t / 0.1);
          else sizeMul = 1 - 0.7 * ((t - 0.1) / 0.9);
          sizeMul *= 1 + 0.18 * Math.sin(p.age * 0.022 + p.wobPhase);
          break;
        }
        case 'snow': {
          // Gentle bloom, slow fade — flake stays roughly constant size
          // for most of its life as it drifts down.
          if (t < 0.18) sizeMul = 0.7 + 0.3 * (t / 0.18);
          else sizeMul = 1 - 0.35 * ((t - 0.18) / 0.82);
          break;
        }
        case 'bokeh':
        default: {
          if (t < 0.2) {
            const u = t / 0.2;
            sizeMul = 0.4 + 0.6 * (1 - (1 - u) * (1 - u));
          } else {
            const u = (t - 0.2) / 0.8;
            sizeMul = 1 - 0.45 * u * u;
          }
          break;
        }
      }

      // Color lerp start→end with biased curve (t^colorCurve) — values
      // <1 push the transition early, >1 push it late.
      const cT = Math.pow(t, p.colorCurve);
      const cr = p.r + (p.r2 - p.r) * cT;
      const cg = p.g + (p.g2 - p.g) * cT;
      const cb = p.b + (p.b2 - p.b) * cT;

      posAttr.array[i * 3]     = p.x;
      posAttr.array[i * 3 + 1] = -p.y; // ortho camera Y is inverted
      posAttr.array[i * 3 + 2] = 0;
      colorAttr.array[i * 3]     = cr;
      colorAttr.array[i * 3 + 1] = cg;
      colorAttr.array[i * 3 + 2] = cb;
      sizeAttr.array[i] = p.peakSize * sizeMul;
      opacityAttr.array[i] = opacity;
      stillActive.push(i);
    }
    this._activeIndices = stillActive;
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    opacityAttr.needsUpdate = true;
  }

  get activeCount() { return this._activeCount; }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ─── Main orchestrator ─────────────────────────────────────────────
export class BokehParticles {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:50;';
    document.body.appendChild(this.canvas);
    this.canvas.style.display = 'none';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1000, 1000);

    // Textures — created once, shared across pools that use the same.
    this.bokehTex = makeBokehTexture();
    this.crispTex = makeCrispTexture();
    this.flameTex = makeFlameTexture();
    this.smokeTex = makeSmokeTexture();
    this.iceTex   = makeIceTexture();
    this.snowTex  = makeSnowTexture();
    this.heartTex    = makeHeartTexture();
    this.confettiTex = makeConfettiTexture();
    this.starTex     = makeStarTexture();
    this.flakeTex    = makeSnowflakeTexture();
    this.petalTex    = makePetalTexture();
    this.boltTex     = makeBoltTexture();
    this.cometTex    = makeCometTexture();
    this.ringTex     = makeRingTexture();
    // Fan-club heart icon — loaded from wordtycoon.live (CORS-friendly
    // for img use; THREE.TextureLoader uses an Image under the hood).
    // Falls back to the canvas heart if the image fails to load so the
    // heart_shower effect always renders something. Uses absolute URL
    // so it resolves cross-origin from grid.subtextle.com where the
    // /cosmetics/ path 404s on the local origin.
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    this.fcHeartTex = loader.load(
      // Versioned query param busts browser cache when the underlying
      // PNG is replaced on the server (cosmetics/fanclub-heart.png).
      // Bump the v=N when uploading a new heart asset.
      'https://wordtycoon.live/cosmetics/fanclub-heart.png?v=3',
      (tex) => {
        // PNG loaded via TextureLoader → default flipY=true makes the
        // sprite render upside-down (UV origin flipped vs the canvas-
        // drawn shape textures that pre-compensate via canvas
        // translate/scale). Disable flipY so the heart points down
        // (face right-side up) the way the source PNG was drawn.
        tex.flipY = false;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
      },
      undefined,
      () => {
        // Asset failed to load — leave fcHeartPool with the (empty)
        // texture; the spawner will fall back to canvas hearts.
        console.warn('[BokehParticles] fanclub-heart.png failed to load');
        this._fcHeartTexFailed = true;
      },
    );

    // Pools — order added to scene determines draw order. Additive
    // blending is commutative for color math, but back-to-front order
    // still affects how the layers feel visually for soft alpha edges.
    this.smokePool = new _EffectPool(this.scene, this.smokeTex, POOL_SIZES.smoke);
    this.bokehPool = new _EffectPool(this.scene, this.bokehTex, POOL_SIZES.bokeh);

    // Halo pass: shares the bokeh pool's geometry — same attribute writes
    // drive both the soft halo (this) and the sharp core (bokeh pool).
    this.haloMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.bokehTex },
        uSizeScale: { value: 2.6 },
        uOpacityScale: { value: 0.32 },
        uWhiteLift: { value: 0.45 },
      },
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.haloPoints = new THREE.Points(this.bokehPool.geometry, this.haloMaterial);
    this.scene.add(this.haloPoints);

    this.flamePool = new _EffectPool(this.scene, this.flameTex, POOL_SIZES.flame);
    this.snowPool  = new _EffectPool(this.scene, this.snowTex,  POOL_SIZES.snow);
    this.icePool   = new _EffectPool(this.scene, this.iceTex,   POOL_SIZES.ice);
    this.sparkPool = new _EffectPool(this.scene, this.bokehTex, POOL_SIZES.spark);
    this.crispPool = new _EffectPool(this.scene, this.crispTex, POOL_SIZES.crisp);
    // Trail pool — used by XP bubbles. Reuses the soft bokeh texture so
    // the trail dots feel like the bubble's own glow shedding off behind
    // it, not like a separate sparkle effect.
    this.trailPool = new _EffectPool(this.scene, this.bokehTex, POOL_SIZES.trail);
    // Win_effect shape pools — each effect with a unique shape gets its
    // own pool so the player's equipped cosmetic visually OWNS the burst
    // (real hearts, real petals, real lightning bolts, etc.) instead of
    // looking like a recolored bokeh blob.
    this.heartPool    = new _EffectPool(this.scene, this.heartTex,    POOL_SIZES.heart);
    this.confettiPool = new _EffectPool(this.scene, this.confettiTex, POOL_SIZES.confetti);
    this.starPool     = new _EffectPool(this.scene, this.starTex,     POOL_SIZES.star);
    this.flakePool    = new _EffectPool(this.scene, this.flakeTex,    POOL_SIZES.flake);
    this.petalPool    = new _EffectPool(this.scene, this.petalTex,    POOL_SIZES.petal);
    this.boltPool     = new _EffectPool(this.scene, this.boltTex,     POOL_SIZES.bolt);
    this.cometPool    = new _EffectPool(this.scene, this.cometTex,    POOL_SIZES.comet);
    this.ringPool     = new _EffectPool(this.scene, this.ringTex,     POOL_SIZES.ring);
    this.fcHeartPool  = new _EffectPool(this.scene, this.fcHeartTex,  POOL_SIZES.fcHeart);

    this._allPools = [
      this.smokePool, this.bokehPool, this.flamePool,
      this.snowPool, this.icePool, this.sparkPool, this.crispPool,
      this.trailPool, this.heartPool,
      this.confettiPool, this.starPool, this.flakePool, this.petalPool,
      this.boltPool, this.cometPool, this.ringPool, this.fcHeartPool,
    ];

    this._lastTickMs = 0;
    this._rafId = 0;

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = 0;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  // emit(rect, color, count, colors, effect)
  //   rect:    { x, y, width, height } in CSS-pixel viewport coordinates.
  //   color:   '#rrggbb' or 'hsl(...)' — the chip's heat color. Used for
  //            the hot/cold flame/ice gates in default mode, and as a
  //            fallback per-particle color when no palette is provided.
  //   count:   TOTAL particle budget for the bokeh+spark base burst.
  //   colors:  optional palette (string[]) — when present, the burst
  //            is driven by the player's win_effect cosmetic instead of
  //            the heat-tier defaults. ALL rank-based gates (flame /
  //            smoke / ice / snow) are bypassed so the burst reflects
  //            player identity, not rank. Pool ratios and special-pool
  //            triggers are picked per `effect` name (see EFFECT_PROFILES).
  //   effect:  optional win_effect.effect string (e.g. 'fireworks',
  //            'snowfall', 'phoenix'). Selects the dispatch profile when
  //            a palette is also present.
  emit(rect, color, count = 32, colors = null, effect = null) {
    const [baseR, baseG, baseB] = parseColor(color);
    const [bh, bs, bl] = rgbToHsl(baseR, baseG, baseB);
    const hueDeg = bh * 360;

    // Pre-process the optional win-effect palette into a flat list of
    // valid colors. Empty / malformed arrays fall back to default mode.
    const palette = (Array.isArray(colors) && colors.length > 0)
      ? colors.filter(c => typeof c === 'string' && c.length > 0)
      : null;

    // ─── Player win_effect path ───────────────────────────────────
    // When the guesser has a win_effect equipped, REPLACE the default
    // heat-tier flame/smoke/ice/snow stack with a palette-driven burst.
    // Each effect name maps to its own pool ratios so a fireworks player
    // gets a spark-heavy radial blast, sparkles get dense pinpoints,
    // hearts/aurora get soft floaty bokeh, and snowfall/phoenix route
    // through the existing snow/flame pools for thematic specials.
    if (palette) {
      // ─── Shape-textured win_effects ─────────────────────────────
      // Each named effect FULLY REPLACES the default bokeh/spark/crisp
      // stack with its own shape-textured spawner. Player should see
      // actual hearts / petals / lightning bolts / etc. — not recolored
      // bokeh blobs. Unknown effect names fall through to the generic
      // palette path below.
      const sb = Math.round(count * 1.5); // shape-effect base budget
      switch (effect) {
        case 'hearts':         this._spawnHearts(rect, palette, sb); break;
        // 'heart_shower' is the fan-club win_effect — uses the actual
        // fanclub-heart.png loaded as a Three.js texture so each particle
        // is the brand heart icon, not a canvas-drawn approximation.
        // Falls back to canvas hearts if the image failed to load.
        case 'heart_shower':
          if (this._fcHeartTexFailed) this._spawnHearts(rect, palette, Math.round(sb * 1.2));
          else this._spawnFcHearts(rect, Math.round(sb * 1.2));
          break;
        case 'confetti':       this._spawnConfetti(rect, palette, sb); break;
        case 'sparkles':       this._spawnSparkles(rect, palette, sb); break;
        case 'snowfall':       this._spawnSnowfall(rect, palette, sb); break;
        case 'cherry_blossom': this._spawnPetals(rect, palette, sb); break;
        case 'lightning':      this._spawnLightning(rect, palette, sb); break;
        case 'meteors':        this._spawnMeteors(rect, palette, sb); break;
        case 'fireworks':      this._spawnFireworks(rect, palette, sb); break;
        case 'galaxy_burst':   this._spawnGalaxy(rect, palette, sb); break;
        case 'aurora':         this._spawnAurora(rect, palette, sb); break;
        case 'phoenix':        this._spawnPhoenixEffect(rect, palette, sb); break;
        case 'nuclear':        this._spawnNuclear(rect, palette, sb); break;
        case 'sonic_boom':     this._spawnSonicBoom(rect, palette, sb); break;
        default: {
          // Unknown / future effect name → generic palette-driven burst.
          // Uses bokeh+spark+crisp with profile ratios and player colors.
          const profile = EFFECT_PROFILES[effect] || EFFECT_PROFILES._default;
          const boostedCount = Math.round(count * 2);
          const sparkN = Math.max(0, Math.round(boostedCount * profile.sparkRatio));
          const bokehN = Math.max(0, Math.round(boostedCount * profile.bokehRatio));
          if (bokehN > 0) this._spawnBokeh(rect, baseR, baseG, baseB, bh, bs, bl, bokehN, palette, false);
          if (sparkN > 0) this._spawnSparks(rect, baseR, baseG, baseB, bh, bs, bl, sparkN, palette);
          if (profile.crispCount > 0) this._spawnCrisp(rect, baseR, baseG, baseB, bh, bs, bl, profile.crispCount, palette);
          break;
        }
      }
      if (!this._rafId) this._start();
      return;
    }

    // ─── Default heat-tier path ───────────────────────────────────
    // No win_effect: fall back to the rank-driven burst — bokeh + sparks
    // + crisp always, flame/smoke for hot guesses, ice/snow for cold.
    const isHot = hueDeg >= 60;
    const isCold = hueDeg < 18;
    const sparkN = Math.round(count * 0.3);
    const bokehN = count - sparkN;
    this._spawnBokeh(rect, baseR, baseG, baseB, bh, bs, bl, bokehN, null);
    this._spawnSparks(rect, baseR, baseG, baseB, bh, bs, bl, sparkN, null);
    this._spawnCrisp(rect, baseR, baseG, baseB, bh, bs, bl, 10, null);

    if (isHot) {
      this._spawnFlame(rect, 14);
      this._spawnSmoke(rect, 5);
    } else if (isCold) {
      this._spawnIce(rect, 11);
      this._spawnSnow(rect, 7);
    }

    if (!this._rafId) this._start();
  }

  // emitTrail(x, y, color, count)
  //   Emit gentle trailing particles at a point. Used by floating XP
  //   bubbles to leave a sparkle wake behind them as they rise. Called
  //   ~20×/sec by ChipXpFloater while the bubble's float animation is
  //   running.
  //
  //   x, y:  viewport pixel coords (CSS).
  //   color: optional hex/hsl string; defaults to XP-gold if omitted.
  //   count: how many particles to spawn per call (default 1).
  emitTrail(x, y, color, count = 1) {
    const [baseR, baseG, baseB] = parseColor(color || '#ffd95a');
    const [bh, bs, bl] = rgbToHsl(baseR, baseG, baseB);
    this.trailPool.emit(count, (p) => {
      // Wider scatter so the wake reads as a fat painterly stream rather
      // than a single-pixel-wide thread.
      p.x = x + (Math.random() - 0.5) * 22;
      p.y = y + (Math.random() - 0.5) * 10;
      // Shorter life so the trail tail fades out close to when the XP
      // bubble disappears — previously trails lingered ~1.5s after the
      // bubble was gone. ChipXpFloater also stops emitting earlier
      // (TRAIL_EMIT_UNTIL_MS) so the last spawn dies near bubble removal.
      p.life = 900 * (0.6 + Math.random() * 0.55);
      // Very gentle motion — barely drifting downward + slight horizontal
      // sway so the trail "hangs" in space behind the bubble as it rises.
      p.vx = (Math.random() - 0.5) * 26;
      p.vy = 14 + Math.random() * 22;
      p.gravity = 8;
      p.drag = 1.2;
      // Bigger sparkles — comparable to spark size now, so each individual
      // particle is more visible.
      p.peakSize = 9 + Math.random() * 10;
      // Higher opacity cap — particles read at near-full brightness.
      p.opacityCap = 0.98;
      p.colorCurve = 1.25;
      p.sizeProfile = 'bokeh';
      // Start: near-white-hot with the gold cast. End: rich saturated gold.
      // Bumped start luminance higher so the trail "pops" against any
      // background (including the bright pinned-guess card above).
      const startLum = Math.min(0.98, bl + 0.40 + Math.random() * 0.05);
      const startSat = clamp01(bs * 0.55);
      [p.r, p.g, p.b] = hslToRgb(bh, startSat, startLum);
      const endLum = Math.max(0.32, bl - 0.02);
      [p.r2, p.g2, p.b2] = hslToRgb(bh, clamp01(bs * 1.05), endLum);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    if (!this._rafId) this._start();
  }

  // emitTrailShape(effect, x, y, palette, count)
  //   Emit shape-textured trail particles at (x,y) as a player-themed
  //   accent for the XP bubble. Picks the right pool based on the effect
  //   name (hearts → heart pool, confetti → confetti pool, etc.) so the
  //   XP bubble's wake reflects the guesser's equipped cosmetic.
  //
  //   effect:  win_effect.effect string. Unknown / null → no-op.
  //   x, y:    viewport pixel coords (CSS).
  //   palette: array of hex strings (win_effect.colors).
  //   count:   particles to spawn per call (default 1).
  emitTrailShape(effect, x, y, palette, count = 1) {
    if (!palette || palette.length === 0) return;
    let pool = null;
    switch (effect) {
      case 'hearts':         pool = this.heartPool; break;
      // heart_shower uses the actual fan-club heart PNG. Fall back to
      // the canvas heart pool if the image texture failed to load.
      case 'heart_shower':   pool = this._fcHeartTexFailed ? this.heartPool : this.fcHeartPool; break;
      case 'confetti':       pool = this.confettiPool; break;
      case 'sparkles':       pool = this.starPool; break;
      case 'fireworks':      pool = this.starPool; break;
      case 'galaxy_burst':   pool = this.starPool; break;
      case 'snowfall':       pool = this.flakePool; break;
      case 'cherry_blossom': pool = this.petalPool; break;
      case 'lightning':      pool = this.boltPool; break;
      case 'meteors':        pool = this.cometPool; break;
      case 'aurora':         pool = this.starPool; break;
      case 'phoenix':        pool = this.flamePool; break;
      case 'nuclear':        pool = this.starPool; break;
      case 'sonic_boom':     pool = this.starPool; break;
      default: return;
    }
    pool.emit(count, (p) => {
      // Wider scatter so the trail reads as a soft drift, not a thread.
      p.x = x + (Math.random() - 0.5) * 22;
      p.y = y + (Math.random() - 0.5) * 10;
      // Short life — trail accents shouldn't outlast the XP bubble's
      // gold sparkles or they'll hang in empty space after the bubble
      // disappears.
      p.life = 950 * (0.6 + Math.random() * 0.55);
      // Gentle drift: small horizontal sway + slow downward motion so
      // hearts trail BEHIND the rising XP bubble (which is moving up).
      p.vx = (Math.random() - 0.5) * 26;
      p.vy = 14 + Math.random() * 22;
      p.gravity = 8;
      p.drag = 1.2;
      // Small but readable hearts — bigger than a sparkle dot, smaller
      // than the burst hearts. Just enough to be recognizable as hearts.
      p.peakSize = 14 + Math.random() * 10;
      p.opacityCap = 0.85;
      p.colorCurve = 1.25;
      p.sizeProfile = 'bokeh';
      // Color handling depends on whether the pool's texture already
      // carries the brand colors (fan-club PNG) or is a white silhouette
      // that needs palette tinting (canvas-drawn shapes).
      if (effect === 'heart_shower' && !this._fcHeartTexFailed) {
        // FC heart PNG already has its own pink/red coloring baked in —
        // pass through with white vColor so the shader multiplies by 1.
        p.r = 1.0; p.g = 1.0; p.b = 1.0;
        p.r2 = 1.0; p.g2 = 1.0; p.b2 = 1.0;
      } else {
        // Start near-white in the palette hue, end saturated in palette.
        const [ph, ps, pl] = this._pickPaletteHSL(palette, 0, 0.7, 0.6);
        const startLum = Math.min(0.95, pl + 0.30);
        const startSat = clamp01(ps * 0.6);
        [p.r, p.g, p.b] = hslToRgb(ph, startSat, startLum);
        const endLum = Math.max(0.32, pl - 0.02);
        [p.r2, p.g2, p.b2] = hslToRgb(ph, clamp01(ps * 1.05), endLum);
      }
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    if (!this._rafId) this._start();
  }

  // ─── Per-effect spawners ─────────────────────────────────────────

  // Per-particle palette pick helper. Returns the [hue, sat, lum] of a
  // randomly-chosen color from the palette (if non-null) or the supplied
  // fallback HSL. Centralized so all spawners pick consistently and we
  // only pay the parse/RGB-to-HSL cost when palette is actually in use.
  _pickPaletteHSL(palette, fallbackH, fallbackS, fallbackL) {
    if (!palette || palette.length === 0) return [fallbackH, fallbackS, fallbackL];
    const c = palette[Math.floor(Math.random() * palette.length)];
    const [pr, pg, pb] = parseColor(c);
    return rgbToHsl(pr, pg, pb);
  }

  _spawnBokeh(rect, R, G, B, bh, bs, bl, n, palette, floaty = false) {
    this.bokehPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      // Floaty bokeh (hearts / cherry_blossom / aurora) lives a bit longer
      // so the rising particles linger on screen, reading as a "shower"
      // rather than a quick puff.
      p.life = (floaty ? 2200 : 1500) * (0.55 + Math.random() * 0.9);
      p.x = samp.x; p.y = samp.y;
      const speed = 18 + Math.random() * 28;
      const tang = (Math.random() - 0.5) * speed * 0.4;
      p.vx = samp.nx * speed + (-samp.ny) * tang;
      // Floaty: stronger initial upward kick so particles RISE off the
      // chip like petals/hearts. Default keeps the original small bias.
      const upKick = floaty ? -(40 + Math.random() * 30) : -8;
      p.vy = samp.ny * speed + ( samp.nx) * tang + upKick;
      // Floaty: negative gravity (buoyancy) so particles continue to
      // rise gently instead of sagging back down. Default falls under
      // mild gravity.
      p.gravity = floaty ? -22 : 14;
      p.drag = 0;
      // Floaty: larger soft orbs so hearts/petals read as chunky shapes
      // rather than tiny dots — visible signature even from across the room.
      p.peakSize = (floaty ? 28 : 18) + Math.random() * (floaty ? 42 : 34);
      p.opacityCap = 0.7;
      p.colorCurve = 1.4;
      p.sizeProfile = 'bokeh';
      // Per-particle base color: either the chip's heat (default) or a
      // randomly-picked color from the player's win_effect palette.
      const [pbh, pbs, pbl] = this._pickPaletteHSL(palette, bh, bs, bl);
      // Start: base color slightly brightened. End: hue-shifted-warm + dimmed.
      const hueShift = (Math.random() - 0.5) * (36 / 360);
      const startHue = ((pbh + hueShift) + 1) % 1;
      const satJitter = clamp01(pbs + (Math.random() - 0.5) * 0.15);
      const lumJitter = clamp01(pbl + 0.05 + (Math.random() - 0.5) * 0.10);
      [p.r, p.g, p.b] = hslToRgb(startHue, satJitter, lumJitter);
      const endHueShift = -0.022 + Math.random() * -0.012;
      const endHue = ((startHue + endHueShift) + 1) % 1;
      const endLum = Math.max(0.12, lumJitter * 0.55);
      [p.r2, p.g2, p.b2] = hslToRgb(endHue, satJitter, endLum);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
  }

  _spawnSparks(rect, R, G, B, bh, bs, bl, n, palette) {
    this.sparkPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 900 * (0.55 + Math.random() * 0.9);
      p.x = samp.x; p.y = samp.y;
      const speed = 90 + Math.random() * 140;
      const tang = (Math.random() - 0.5) * speed * 0.15;
      p.vx = samp.nx * speed + (-samp.ny) * tang;
      p.vy = samp.ny * speed + ( samp.nx) * tang + -8;
      p.gravity = 8; p.drag = 1.6;
      p.peakSize = 4 + Math.random() * 7;
      p.opacityCap = 0.95;
      p.colorCurve = 1.4;
      p.sizeProfile = 'spark';
      const [pbh, pbs, pbl] = this._pickPaletteHSL(palette, bh, bs, bl);
      const hueShift = (Math.random() - 0.5) * (36 / 360);
      const startHue = ((pbh + hueShift) + 1) % 1;
      const startLum = Math.min(0.95, pbl + 0.45 + Math.random() * 0.05);
      const startSat = clamp01(pbs * 0.4);
      [p.r, p.g, p.b] = hslToRgb(startHue, startSat, startLum);
      const endSat = clamp01(pbs + (Math.random() - 0.4) * 0.10);
      const endLum = Math.max(0.20, pbl - 0.05);
      [p.r2, p.g2, p.b2] = hslToRgb(startHue, endSat, endLum);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
  }

  // Crisp: tiny sharp pops radiating in all directions from random
  // perimeter points. Fast, bright, short life. Adds the "sparkle" feel.
  _spawnCrisp(rect, R, G, B, bh, bs, bl, n, palette) {
    this.crispPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 650 * (0.6 + Math.random() * 0.8);
      p.x = samp.x; p.y = samp.y;
      const speed = 70 + Math.random() * 80;
      const ang = Math.random() * Math.PI * 2;
      p.vx = Math.cos(ang) * speed * 0.4 + samp.nx * speed * 0.6;
      p.vy = Math.sin(ang) * speed * 0.4 + samp.ny * speed * 0.6 + -16;
      p.gravity = 4; p.drag = 1.8;
      p.peakSize = 3 + Math.random() * 5;
      p.opacityCap = 1.0;
      p.colorCurve = 1.2;
      p.sizeProfile = 'crisp';
      const [pbh, pbs, pbl] = this._pickPaletteHSL(palette, bh, bs, bl);
      // Near-white core fading to the saturated player/heat color.
      [p.r, p.g, p.b] = [0.98 + Math.random() * 0.02, 0.98 + Math.random() * 0.02, 0.95 + Math.random() * 0.05];
      const endLum = Math.max(0.4, pbl);
      [p.r2, p.g2, p.b2] = hslToRgb(pbh, clamp01(pbs * 1.1), endLum);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
  }

  // Hearts: dedicated win_effect spawner that emits shaped heart sprites
  // rising upward from the chip's perimeter. Fully REPLACES the default
  // bokeh/spark/crisp stack when the user has the 'hearts' win_effect
  // equipped — the player should see actual heart shapes drifting up,
  // not red round bokeh that looks identical to the default heat burst.
  //
  // rect:    chip bounding rect (x, y, width, height)
  // palette: array of hex color strings from win_effect.colors
  // n:       total heart particles to spawn for this burst
  _spawnHearts(rect, palette, n) {
    // Push hearts to the SIDES of the chip (not its vertical centerline)
    // so the chip's XP bubble — which rises straight up from the chip
    // center — has a clear path through them. Without this, the bubble's
    // backdrop-filter samples a wall of additive-bright hearts and the
    // gold text gets visually washed out.
    this.heartPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      // Long life — hearts should drift up and linger so the user
      // clearly sees a "shower" rising off the chip.
      p.life = 2400 * (0.7 + Math.random() * 0.7);
      p.x = samp.x;
      p.y = samp.y;
      // Push hearts outward + slightly DOWN-then-up so they arc away
      // from the chip top before rising — keeps the chip's vertical
      // centerline (where the XP bubble lives) clearer.
      const outSpeed = 50 + Math.random() * 60;
      p.vx = samp.nx * outSpeed + (Math.random() - 0.5) * 40;
      p.vy = samp.ny * outSpeed * 0.5 - (30 + Math.random() * 50);
      p.gravity = -28;
      p.drag = 0.6;
      // Smaller hearts so individual shapes are still readable but they
      // don't carpet the screen and wash out the XP bubble that rises
      // straight up from the chip. Tier-down from 36-88 to 22-54.
      p.peakSize = 22 + Math.random() * 32;
      // Cap opacity below additive-blowout so dense overlap doesn't pure
      // white-out the area where the XP bubble lives.
      p.opacityCap = 0.78;
      p.colorCurve = 1.2;
      // Use bokeh size profile so hearts fade-in/out smoothly over life.
      p.sizeProfile = 'bokeh';
      // Per-particle palette color — start brighter (lifted toward white)
      // then settle into the saturated palette color as the heart rises.
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0, 0.7, 0.6);
      const startLum = Math.min(0.92, pl + 0.25);
      const startSat = clamp01(ps * 0.85);
      [p.r, p.g, p.b] = hslToRgb(ph, startSat, startLum);
      const endLum = Math.max(0.35, pl - 0.05);
      const endSat = clamp01(ps + 0.05);
      [p.r2, p.g2, p.b2] = hslToRgb(ph, endSat, endLum);
      // Gentle horizontal sway so hearts drift like floating petals,
      // not in straight lines.
      p.wobAmpX = 12 + Math.random() * 14;
      p.wobAmpY = 0;
      p.wobFreq = 0.003 + Math.random() * 0.002;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Fan-club heart shower (heart_shower win_effect).
  // Spawns the actual fanclub-heart.png as particles instead of canvas-
  // drawn hearts. Same float-up motion as _spawnHearts but no palette
  // tinting (white rgb = preserve PNG's native pink + tiktok colors).
  _spawnFcHearts(rect, n) {
    this.fcHeartPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 2400 * (0.7 + Math.random() * 0.7);
      p.x = samp.x;
      p.y = samp.y;
      const outSpeed = 50 + Math.random() * 60;
      p.vx = samp.nx * outSpeed + (Math.random() - 0.5) * 40;
      p.vy = samp.ny * outSpeed * 0.5 - (30 + Math.random() * 50);
      p.gravity = -28;
      p.drag = 0.6;
      // Slightly larger than canvas hearts since the PNG has its own
      // detail (gradient, highlight) that reads at smaller sizes too.
      p.peakSize = 28 + Math.random() * 38;
      p.opacityCap = 0.95;
      p.colorCurve = 1.0;
      p.sizeProfile = 'bokeh';
      // White rgb so the shader's vColor * texture passes through the
      // PNG's original colors (pink heart). The image already has the
      // brand palette baked in.
      p.r = 1.0; p.g = 1.0; p.b = 1.0;
      p.r2 = 1.0; p.g2 = 1.0; p.b2 = 1.0;
      p.wobAmpX = 12 + Math.random() * 14;
      p.wobAmpY = 0;
      p.wobFreq = 0.003 + Math.random() * 0.002;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Confetti: chunky paper rectangles tumbling outward + down.
  // Wide horizontal scatter, gentle gravity, lots of horizontal sway so
  // each paper "flutter" reads organically.
  _spawnConfetti(rect, palette, n) {
    this.confettiPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 1800 * (0.7 + Math.random() * 0.7);
      p.x = samp.x; p.y = samp.y;
      const speed = 90 + Math.random() * 140;
      const ang = (Math.random() - 0.5) * Math.PI * 1.3 - Math.PI / 2; // mostly upward
      p.vx = Math.cos(ang) * speed + samp.nx * 30;
      p.vy = Math.sin(ang) * speed * 0.85;
      p.gravity = 70;     // confetti falls noticeably
      p.drag = 0.8;
      p.peakSize = 18 + Math.random() * 16;
      p.opacityCap = 0.92;
      p.colorCurve = 1.1;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0, 0.85, 0.55);
      [p.r, p.g, p.b]  = hslToRgb(ph, Math.min(1, ps + 0.10), Math.min(0.95, pl + 0.15));
      [p.r2, p.g2, p.b2] = hslToRgb(ph, clamp01(ps), Math.max(0.30, pl - 0.05));
      p.wobAmpX = 18 + Math.random() * 22;
      p.wobAmpY = 6;
      p.wobFreq = 0.006 + Math.random() * 0.004;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Sparkles: dense bright stars popping from the chip's perimeter.
  // Fast, short-lived, sharp twinkle feel.
  _spawnSparkles(rect, palette, n) {
    this.starPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 950 * (0.6 + Math.random() * 0.7);
      p.x = samp.x; p.y = samp.y;
      const speed = 120 + Math.random() * 140;
      p.vx = samp.nx * speed + (Math.random() - 0.5) * 50;
      p.vy = samp.ny * speed + (Math.random() - 0.5) * 50 - 20;
      p.gravity = 18;
      p.drag = 1.3;
      p.peakSize = 14 + Math.random() * 18;
      p.opacityCap = 1.0;
      p.colorCurve = 1.2;
      p.sizeProfile = 'crisp';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0, 0.85, 0.7);
      // Stars start white-hot and settle to the palette color
      [p.r, p.g, p.b] = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, Math.min(1, ps), Math.max(0.45, pl));
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
  }

  // ─── Snowfall: snowflakes drifting DOWN from above the chip.
  // Slow downward drift with strong horizontal sway, long life.
  _spawnSnowfall(rect, palette, n) {
    const W = rect.width || 1;
    const top = (rect.y || 0) - 8;
    const cx = (rect.x || 0);
    this.flakePool.emit(n, (p) => {
      p.life = 3000 * (0.7 + Math.random() * 0.7);
      // Spawn across a wide band ABOVE the chip so flakes fall through
      // the word.
      p.x = cx + Math.random() * W;
      p.y = top - Math.random() * 40;
      p.vx = (Math.random() - 0.5) * 18;
      p.vy = 30 + Math.random() * 36; // slow fall
      p.gravity = 22;
      p.drag = 0.7;
      p.peakSize = 16 + Math.random() * 18;
      p.opacityCap = 0.92;
      p.colorCurve = 1.0;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.6, 0.4, 0.85);
      // Bright white-ish core, settle to faint palette tint
      [p.r, p.g, p.b] = [0.98, 0.99, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, Math.min(0.5, ps), Math.max(0.7, pl));
      p.wobAmpX = 28 + Math.random() * 18;
      p.wobAmpY = 4;
      p.wobFreq = 0.0018 + Math.random() * 0.0012;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Cherry-blossom petals: soft pink petals drifting upward+outward.
  _spawnPetals(rect, palette, n) {
    this.petalPool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 2600 * (0.7 + Math.random() * 0.7);
      p.x = samp.x; p.y = samp.y;
      const outSpeed = 40 + Math.random() * 50;
      p.vx = samp.nx * outSpeed + (Math.random() - 0.5) * 36;
      p.vy = samp.ny * outSpeed * 0.4 - (30 + Math.random() * 50);
      p.gravity = -22;
      p.drag = 0.7;
      p.peakSize = 22 + Math.random() * 28;
      p.opacityCap = 0.85;
      p.colorCurve = 1.15;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.95, 0.6, 0.85);
      [p.r, p.g, p.b] = hslToRgb(ph, clamp01(ps * 0.6), Math.min(0.95, pl + 0.10));
      [p.r2, p.g2, p.b2] = hslToRgb(ph, clamp01(ps), Math.max(0.55, pl));
      p.wobAmpX = 24 + Math.random() * 20;
      p.wobAmpY = 0;
      p.wobFreq = 0.0024 + Math.random() * 0.0018;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Lightning: a few sharp electric bolts striking from above + a
  // bright spark splash at the chip. Quick, intense.
  _spawnLightning(rect, palette, n) {
    // Limit bolts — they're large + dramatic, too many looks busy.
    const bolts = Math.min(6, Math.max(3, Math.floor(n * 0.25)));
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const top = (rect.y || 0);
    this.boltPool.emit(bolts, (p) => {
      p.life = 350 * (0.7 + Math.random() * 0.5);
      p.x = cx + (Math.random() - 0.5) * (rect.width || 30) * 1.4;
      p.y = top - 80 - Math.random() * 60;
      p.vx = (Math.random() - 0.5) * 30;
      p.vy = 280 + Math.random() * 120; // strike downward fast
      p.gravity = 0;
      p.drag = 0.5;
      p.peakSize = 70 + Math.random() * 40;
      p.opacityCap = 1.0;
      p.colorCurve = 0.7;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.55, 0.4, 0.85);
      [p.r, p.g, p.b] = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, Math.min(0.9, ps), Math.max(0.55, pl));
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    // Bright crisp spark splash where bolts hit
    this._spawnCrisp(rect, 1, 1, 1, 0.55, 0.4, 0.85, Math.min(24, Math.floor(n * 0.6)), palette);
  }

  // ─── Meteors: streaking comets from upper-left of chip.
  _spawnMeteors(rect, palette, n) {
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    // Meteor count capped — each is a chunky streaking sprite.
    const meteors = Math.min(14, Math.max(6, Math.floor(n * 0.35)));
    this.cometPool.emit(meteors, (p) => {
      p.life = 1100 * (0.7 + Math.random() * 0.6);
      // Spawn off-screen upper-left of the chip
      const offset = 70 + Math.random() * 90;
      p.x = cx - offset;
      p.y = cy - offset;
      // Streak toward lower-right (same direction as the texture's tail)
      const speed = 360 + Math.random() * 240;
      p.vx = speed * 0.78;
      p.vy = speed * 0.78;
      p.gravity = 0;
      p.drag = 0.4;
      p.peakSize = 90 + Math.random() * 60;
      p.opacityCap = 0.95;
      p.colorCurve = 0.8;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.08, 0.85, 0.6);
      [p.r, p.g, p.b] = [1.0, 0.95 + Math.random() * 0.05, 0.85];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, clamp01(ps), Math.max(0.45, pl));
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    // Small spark trail along their wake
    this._spawnCrisp(rect, 1, 1, 1, 0.08, 0.85, 0.6, Math.min(16, Math.floor(n * 0.3)), palette);
  }

  // ─── Fireworks: dense radial spark burst from chip center, palette-tinted.
  _spawnFireworks(rect, palette, n) {
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    // All particles erupt radially from CENTER, not perimeter — that's
    // the firework signature look.
    this.starPool.emit(Math.round(n * 0.45), (p) => {
      p.life = 1200 * (0.7 + Math.random() * 0.6);
      p.x = cx; p.y = cy;
      const ang = Math.random() * Math.PI * 2;
      const speed = 180 + Math.random() * 200;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed - 40;
      p.gravity = 90;
      p.drag = 1.2;
      p.peakSize = 16 + Math.random() * 18;
      p.opacityCap = 1.0;
      p.colorCurve = 1.0;
      p.sizeProfile = 'crisp';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.0, 0.9, 0.6);
      [p.r, p.g, p.b] = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, Math.min(1, ps), Math.max(0.45, pl));
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    // Glow halo via crisp particles (smaller, denser)
    this._spawnCrisp(rect, 1, 1, 1, 0, 0.85, 0.6, Math.min(28, Math.floor(n * 0.55)), palette);
  }

  // ─── Galaxy burst: spiraling stars in palette purples/golds.
  _spawnGalaxy(rect, palette, n) {
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    this.starPool.emit(n, (p) => {
      p.life = 1800 * (0.7 + Math.random() * 0.7);
      p.x = cx; p.y = cy;
      const ang = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed - 30;
      p.gravity = 12;
      p.drag = 0.6;
      p.peakSize = 10 + Math.random() * 22;
      p.opacityCap = 0.95;
      p.colorCurve = 1.1;
      p.sizeProfile = 'crisp';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.75, 0.7, 0.65);
      [p.r, p.g, p.b] = hslToRgb(ph, clamp01(ps * 0.6), Math.min(0.95, pl + 0.25));
      [p.r2, p.g2, p.b2] = hslToRgb(ph, Math.min(1, ps), Math.max(0.40, pl));
      // Wide orbital wobble — spirals
      p.wobAmpX = 8 + Math.random() * 14;
      p.wobAmpY = 8 + Math.random() * 14;
      p.wobFreq = 0.004 + Math.random() * 0.004;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Aurora: wide undulating bokeh ribbons in palette greens/violets.
  _spawnAurora(rect, palette, n) {
    // Aurora uses oversized soft bokeh with extreme horizontal wobble so
    // particles read as undulating ribbons rather than individual orbs.
    this._spawnBokeh(rect,
      255, 255, 255, 0.45, 0.7, 0.6,
      Math.round(n * 1.2), palette, true,
    );
    // Layer a few stars as twinkle accents.
    this.starPool.emit(Math.min(12, Math.floor(n * 0.2)), (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 2200 * (0.7 + Math.random() * 0.5);
      p.x = samp.x; p.y = samp.y;
      p.vx = (Math.random() - 0.5) * 30;
      p.vy = -40 - Math.random() * 30;
      p.gravity = -10;
      p.drag = 0.6;
      p.peakSize = 8 + Math.random() * 10;
      p.opacityCap = 0.9;
      p.colorCurve = 1.0;
      p.sizeProfile = 'crisp';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.45, 0.7, 0.7);
      [p.r, p.g, p.b] = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, ps, pl);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
  }

  // ─── Phoenix: fiery upward column with embers + smoke.
  _spawnPhoenixEffect(rect, palette, n) {
    // Heavy use of the existing flame + smoke pools (they look great for
    // fire), supplemented with palette-tinted spark embers rising upward.
    this._spawnFlame(rect, Math.min(22, Math.floor(n * 0.45)));
    this._spawnSmoke(rect, Math.min(10, Math.floor(n * 0.15)));
    // Palette-tinted ember sparks rising from chip top
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const top = (rect.y || 0);
    this.starPool.emit(Math.min(24, Math.floor(n * 0.4)), (p) => {
      p.life = 1400 * (0.7 + Math.random() * 0.6);
      p.x = cx + (Math.random() - 0.5) * (rect.width || 30) * 0.8;
      p.y = top + (rect.height || 0) * 0.5;
      const speed = 150 + Math.random() * 140;
      p.vx = (Math.random() - 0.5) * 80;
      p.vy = -speed;
      p.gravity = -20;
      p.drag = 0.8;
      p.peakSize = 8 + Math.random() * 12;
      p.opacityCap = 1.0;
      p.colorCurve = 0.9;
      p.sizeProfile = 'crisp';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.06, 0.95, 0.55);
      [p.r, p.g, p.b] = [1.0, 0.95, 0.7];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, ps, Math.max(0.40, pl));
      p.wobAmpX = 8; p.wobAmpY = 0;
      p.wobFreq = 0.004; p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // ─── Nuclear: massive radial blast wave ring + dense spark explosion.
  _spawnNuclear(rect, palette, n) {
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    // Single expanding blast ring at center
    this.ringPool.emit(1, (p) => {
      p.life = 800;
      p.x = cx; p.y = cy;
      p.vx = 0; p.vy = 0;
      p.gravity = 0; p.drag = 0;
      p.peakSize = 320 + Math.random() * 80; // huge expanding ring
      p.opacityCap = 0.75;
      p.colorCurve = 0.7;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.08, 0.95, 0.7);
      [p.r, p.g, p.b] = [1.0, 1.0, 0.9];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, ps, pl);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    // Dense radial spark/star explosion
    this._spawnFireworks(rect, palette, Math.round(n * 1.4));
  }

  // ─── Sonic boom: expanding rings + bright sparkles.
  _spawnSonicBoom(rect, palette, n) {
    const cx = (rect.x || 0) + (rect.width || 0) / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    // Two staggered rings — main + echo
    this.ringPool.emit(2, (p, i) => {
      p.life = 950 + Math.random() * 200;
      p.x = cx; p.y = cy;
      p.vx = 0; p.vy = 0;
      p.gravity = 0; p.drag = 0;
      p.peakSize = (i === 0 ? 260 : 180) + Math.random() * 40;
      p.opacityCap = 0.65;
      p.colorCurve = 0.8;
      p.sizeProfile = 'bokeh';
      const [ph, ps, pl] = this._pickPaletteHSL(palette, 0.5, 0.9, 0.7);
      [p.r, p.g, p.b] = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = hslToRgb(ph, ps, pl);
      p.wobAmpX = 0; p.wobAmpY = 0;
    });
    // Sparkle pinpoints layered inside the rings
    this._spawnSparkles(rect, palette, Math.round(n * 0.7));
  }

  // Flame: orange/yellow drops rising rapidly from inside the chip rect.
  // Strong upward velocity, slight horizontal wobble for flicker.
  _spawnFlame(rect, n) {
    const W = rect.width || 0;
    const cx = (rect.x || 0) + W / 2;
    const cy = (rect.y || 0) + (rect.height || 0) / 2;
    this.flamePool.emit(n, (p) => {
      // Spawn from a horizontal band across the chip's middle, weighted
      // toward the center.
      const sideBias = (Math.random() + Math.random() - 1) * 0.45; // -0.45..0.45 (center-biased)
      p.x = cx + sideBias * W;
      p.y = cy + (Math.random() - 0.3) * (rect.height || 30) * 0.5;
      p.life = 700 * (0.7 + Math.random() * 0.9);
      // Strong upward velocity with a small horizontal kick.
      const upSpeed = 110 + Math.random() * 90;
      p.vy = -upSpeed; // negative Y = up in our coordinate space
      p.vx = (Math.random() - 0.5) * 50;
      p.gravity = -18; // continues to accelerate upward slightly
      p.drag = 0.6;
      p.peakSize = 18 + Math.random() * 22;
      p.opacityCap = 0.85;
      p.colorCurve = 0.9; // bias toward end color (cooling) sooner
      p.sizeProfile = 'flame';
      // Hot center: bright yellow-white. Cooling toward orange-red.
      const startHue = 0.13 + Math.random() * 0.04;   // ~47°-61° (yellow-orange)
      const endHue   = 0.02 + Math.random() * 0.03;   // ~7°-18° (red-orange)
      [p.r, p.g, p.b]    = hslToRgb(startHue, 1.0, 0.72);
      [p.r2, p.g2, p.b2] = hslToRgb(endHue,   1.0, 0.42);
      // Flicker — small horizontal wobble.
      p.wobAmpX = 18 + Math.random() * 22;
      p.wobAmpY = 0;
      p.wobFreq = 0.012 + Math.random() * 0.008;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // Smoke: gray puffs growing & rising slowly above the flame.
  _spawnSmoke(rect, n) {
    const W = rect.width || 0;
    const cx = (rect.x || 0) + W / 2;
    const top = (rect.y || 0);
    this.smokePool.emit(n, (p) => {
      const sideBias = (Math.random() - 0.5) * 0.6;
      p.x = cx + sideBias * W;
      p.y = top + (Math.random() - 0.2) * 20;
      p.life = 2200 * (0.8 + Math.random() * 0.5);
      p.vy = -(30 + Math.random() * 30);
      p.vx = (Math.random() - 0.5) * 18;
      p.gravity = -4;
      p.drag = 0.3;
      p.peakSize = 30 + Math.random() * 25;
      p.opacityCap = 0.55;
      p.colorCurve = 1.0;
      p.sizeProfile = 'smoke';
      const g0 = 0.55 + Math.random() * 0.12;
      const g1 = 0.20 + Math.random() * 0.10;
      p.r = g0; p.g = g0; p.b = g0;
      p.r2 = g1; p.g2 = g1; p.b2 = g1;
      p.wobAmpX = 10 + Math.random() * 12;
      p.wobAmpY = 0;
      p.wobFreq = 0.004 + Math.random() * 0.003;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // Ice: sharp white/cyan four-point stars radiating outward — same
  // perimeter spawn as bokeh but with crystal texture and shimmer.
  _spawnIce(rect, n) {
    this.icePool.emit(n, (p) => {
      const samp = samplePillPerimeter(rect, Math.random());
      p.life = 1100 * (0.7 + Math.random() * 0.7);
      p.x = samp.x; p.y = samp.y;
      const speed = 45 + Math.random() * 70;
      const tang = (Math.random() - 0.5) * speed * 0.25;
      p.vx = samp.nx * speed + (-samp.ny) * tang;
      p.vy = samp.ny * speed + ( samp.nx) * tang;
      p.gravity = 12;
      p.drag = 0.9;
      p.peakSize = 10 + Math.random() * 16;
      p.opacityCap = 0.92;
      p.colorCurve = 1.1;
      p.sizeProfile = 'ice';
      // Bright cyan-white start, fades to a paler ice-blue.
      const startHue = 0.55 + Math.random() * 0.03; // ~200° cyan
      [p.r, p.g, p.b]    = hslToRgb(startHue, 0.30, 0.92);
      [p.r2, p.g2, p.b2] = hslToRgb(startHue, 0.55, 0.55);
      p.wobAmpX = 0; p.wobAmpY = 0;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  // Snow: drifting white flakes above the chip falling slowly with a
  // sideways sinusoidal sway.
  _spawnSnow(rect, n) {
    const W = rect.width || 0;
    const left = (rect.x || 0);
    const top = (rect.y || 0);
    this.snowPool.emit(n, (p) => {
      p.x = left + Math.random() * W;
      p.y = top - 10 - Math.random() * 30;
      p.life = 2800 * (0.7 + Math.random() * 0.6);
      p.vy = 28 + Math.random() * 30; // gentle downward
      p.vx = (Math.random() - 0.5) * 20;
      p.gravity = 6;
      p.drag = 0.2;
      p.peakSize = 6 + Math.random() * 6;
      p.opacityCap = 0.85;
      p.colorCurve = 1.0;
      p.sizeProfile = 'snow';
      [p.r, p.g, p.b]    = [1.0, 1.0, 1.0];
      [p.r2, p.g2, p.b2] = [0.78, 0.86, 1.0];
      p.wobAmpX = 22 + Math.random() * 20;
      p.wobAmpY = 0;
      p.wobFreq = 0.003 + Math.random() * 0.002;
      p.wobPhase = Math.random() * Math.PI * 2;
    });
  }

  _start() {
    if (this._rafId) return;
    this.canvas.style.display = '';
    this._lastTickMs = performance.now();
    const tick = (now) => {
      this._rafId = 0;
      const dt = Math.min(0.1, (now - this._lastTickMs) / 1000);
      this._lastTickMs = now;

      let totalActive = 0;
      for (const pool of this._allPools) {
        pool.update(dt);
        totalActive += pool.activeCount;
      }
      this.renderer.render(this.scene, this.camera);

      if (totalActive > 0) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._lastTickMs = 0;
        this.canvas.style.display = 'none';
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    for (const pool of this._allPools) pool.dispose();
    this.haloMaterial.dispose();
    this.bokehTex.dispose();
    this.crispTex.dispose();
    this.flameTex.dispose();
    this.smokeTex.dispose();
    this.iceTex.dispose();
    this.snowTex.dispose();
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
