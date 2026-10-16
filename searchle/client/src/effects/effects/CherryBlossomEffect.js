// ===== Cherry Blossom Effect =====
// Delicate petals drifting down with wobble and gentle rotation.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function drawPetal(ctx, cx, cy, size, color, opacity, rotation) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.4, size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function makePetal(colors, w) {
  return {
    x: rand(-20, w + 20), y: rand(-40, -10),
    vx: rand(-1.5, 1.5), vy: rand(1, 2.5),
    size: rand(6, 14), color: pick(colors),
    rotation: rand(0, 360), rotSpeed: rand(-3, 3),
    wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05), wobbleAmp: rand(0.5, 1.5),
    opacity: rand(0.6, 1)
  };
}

export const cherry_blossom = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 50); i++) {
      const p = makePetal(cfg.colors, w);
      p.y = rand(-h * 0.5, -10);
      ps.push(p);
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn petals during first 65% of duration
    if (elapsed < dur * 0.65 && ps.length < 60) {
      ps.push(makePetal(effectConfig.colors, w));
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      if (elapsed > dur * 0.7) p.opacity = Math.max(0, p.opacity - 0.01);
      if (p.y > h + 30 || p.opacity <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      drawPetal(ctx, p.x, p.y, p.size, p.color, p.opacity, p.rotation);
    }
  }
};
