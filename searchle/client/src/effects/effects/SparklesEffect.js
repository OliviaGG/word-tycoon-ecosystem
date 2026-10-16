// ===== Sparkles Effect =====
// Twinkling star-shaped particles radiating from the center.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function drawStar(ctx, cx, cy, size, color, opacity) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
    ctx.lineTo(cx + Math.cos(a + 0.3) * size * 0.3, cy + Math.sin(a + 0.3) * size * 0.3);
  }
  ctx.fill();
  ctx.restore();
}

function makeSparkleParticle(colors, w, h) {
  const cx = w / 2, cy = h / 2;
  const angle = rand(0, Math.PI * 2);
  const speed = rand(2, 8);
  return {
    x: cx + rand(-100, 100), y: cy + rand(-100, 100),
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    size: rand(2, 5), color: pick(colors),
    life: 1, decay: rand(0.008, 0.02), twinkle: rand(0, Math.PI * 2),
    gravity: 0.02
  };
}

export const sparkles = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 40); i++) {
      ps.push(makeSparkleParticle(cfg.colors, w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn sparkles during first 75% of duration
    if (elapsed < dur * 0.75 && ps.length < 60) {
      for (let s = 0; s < 2; s++) {
        ps.push(makeSparkleParticle(effectConfig.colors, w, h));
      }
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.twinkle += 0.15;
      p.life -= p.decay;
      if (p.life <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const alpha = p.life * (0.5 + 0.5 * Math.sin(p.twinkle));
      drawStar(ctx, p.x, p.y, p.size * 2, p.color, alpha);
    }
  }
};
