// ===== Galaxy Burst Effect =====
// Spiraling particles expanding outward from the center like a galaxy.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeGalaxyParticle(colors, w, h) {
  const cx = w / 2, cy = h / 2;
  const angle = rand(0, Math.PI * 2);
  const dist = rand(5, 200);
  return {
    x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist,
    angle: angle, dist: dist, speed: rand(0.01, 0.04),
    size: rand(1, 4), color: pick(colors),
    vr: rand(0.5, 2), life: 1, decay: rand(0.002, 0.008),
    cx: cx, cy: cy
  };
}

export const galaxy_burst = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 100); i++) {
      ps.push(makeGalaxyParticle(cfg.colors, w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn galaxy particles during first 60% of duration
    if (elapsed < dur * 0.6 && ps.length < 120) {
      for (let s = 0; s < 3; s++) {
        ps.push(makeGalaxyParticle(effectConfig.colors, w, h));
      }
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.angle += p.speed;
      p.dist += p.vr;
      p.x = p.cx + Math.cos(p.angle) * p.dist;
      p.y = p.cy + Math.sin(p.angle) * p.dist;
      p.life -= p.decay;
      if (p.life <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
};
