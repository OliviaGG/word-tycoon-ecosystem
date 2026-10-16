// ===== Hearts Effect =====
// Heart shapes rising from the bottom with gentle wobble.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function drawHeart(ctx, cx, cy, size, color, opacity, rotation) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  const s = size / 2;
  ctx.moveTo(0, s * 0.4);
  ctx.bezierCurveTo(-s, -s * 0.4, -s * 1.4, s * 0.4, 0, s * 1.2);
  ctx.bezierCurveTo(s * 1.4, s * 0.4, s, -s * 0.4, 0, s * 0.4);
  ctx.fill();
  ctx.restore();
}

function makeHeartParticle(colors, w, h) {
  return {
    x: rand(0, w), y: h + rand(10, 60),
    vx: rand(-1, 1), vy: rand(-4, -2),
    size: rand(10, 22), color: pick(colors),
    rotation: rand(-20, 20), wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05),
    opacity: 1, fadeStart: 0.7
  };
}

export const hearts = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 30); i++) {
      ps.push(makeHeartParticle(cfg.colors, w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn hearts during first 65% of duration
    if (elapsed < dur * 0.65 && ps.length < 40) {
      ps.push(makeHeartParticle(effectConfig.colors, w, h));
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.5;
      p.y += p.vy;
      p.rotation += Math.sin(p.wobble) * 0.5;
      const progress = elapsed / dur;
      if (progress > p.fadeStart) {
        p.opacity = Math.max(0, 1 - (progress - p.fadeStart) / (1 - p.fadeStart));
      }
      if (p.y < -40 || p.opacity <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      drawHeart(ctx, p.x, p.y, p.size, p.color, p.opacity, p.rotation);
    }
  }
};
