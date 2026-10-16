// ===== Aurora Effect =====
// Shimmering aurora borealis waves with gradient fills.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeAuroraWave(colors, w, h, i) {
  return {
    color: pick(colors), y: h * rand(0.15, 0.6),
    amplitude: rand(30, 80), frequency: rand(0.003, 0.008),
    speed: rand(0.5, 1.5), phase: i * 1.2,
    opacity: rand(0.15, 0.35), height: rand(60, 140),
    w: w
  };
}

export const aurora = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 6); i++) {
      ps.push(makeAuroraWave(cfg.colors, w, h, i));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    for (let i = 0; i < ps.length; i++) {
      ps[i].phase += ps[i].speed * 0.01;
      if (elapsed > dur * 0.6) {
        ps[i].opacity = Math.max(0, ps[i].opacity - 0.003);
      }
    }
    for (let j = ps.length - 1; j >= 0; j--) {
      if (ps[j].opacity <= 0) ps.splice(j, 1);
    }
  },

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const w = ps[i];
      ctx.save();
      ctx.globalAlpha = w.opacity;
      const grad = ctx.createLinearGradient(0, w.y - w.height / 2, 0, w.y + w.height / 2);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, w.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.moveTo(0, w.y);
      for (let x = 0; x <= w.w; x += 4) {
        const yOff = Math.sin(x * w.frequency + w.phase) * w.amplitude;
        ctx.lineTo(x, w.y + yOff);
      }
      ctx.lineTo(w.w, w.y + w.height);
      ctx.lineTo(0, w.y + w.height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
};
