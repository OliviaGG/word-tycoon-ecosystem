// ===== Snowfall Effect =====
// Gentle snowflakes drifting down with wobble and rotation.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeSnowflake(colors, w) {
  return {
    x: rand(-20, w + 20), y: rand(-40, -10),
    vx: rand(-0.5, 0.5), vy: rand(1, 3),
    size: rand(3, 8), color: pick(colors),
    wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.01, 0.04), wobbleAmp: rand(0.3, 1),
    opacity: rand(0.5, 1), rotation: rand(0, 360), rotSpeed: rand(-2, 2)
  };
}

export const snowfall = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 60); i++) {
      const p = makeSnowflake(cfg.colors, w);
      p.y = rand(-h, -10); // stagger start positions
      ps.push(p);
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn snowflakes during first 70% of duration
    if (elapsed < dur * 0.7 && ps.length < 80) {
      ps.push(makeSnowflake(effectConfig.colors, w));
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      if (elapsed > dur * 0.75) p.opacity = Math.max(0, p.opacity - 0.01);
      if (p.y > h + 20 || p.opacity <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      // Simple snowflake: 6-pointed star
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        ctx.fillRect(-0.5, 0, 1, p.size);
        ctx.save();
        ctx.rotate(a);
        ctx.fillRect(-0.5, 0, 1, p.size);
        ctx.restore();
      }
      ctx.restore();
    }
  }
};
