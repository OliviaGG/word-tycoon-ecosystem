// ===== Water Fill (Canvas 2D, static) =====
// Plain gradient fill — no wave animation, no physics.
// API matches the animated version so GuessList needs no changes.

const WATER_FADE_START = {
  deep: 'hsla(274, 82%, 34%, 0.88)',
  mid: 'hsla(274, 78%, 42%, 0.88)',
  surface: 'hsla(274, 74%, 55%, 0.78)',
};

export class WaterWave {
  constructor(canvas, gradientColors, fillPercent) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this.fillPercent = fillPercent;
    this._colors = gradientColors;
    this._targetColors = gradientColors;
    this._colorFadeFrame = null;
    this._colorFadeStartedAt = 0;
    this._colorFadeDuration = 0;
    this._flat = true;
    this.idleFade = 0; // always 0 — tells GuessList no wave to wait for

    this.flatten();
  }

  setFill(fillPercent, gradientColors) {
    this.fillPercent = fillPercent;
    this._targetColors = gradientColors;
    if (!this._colorFadeFrame) {
      this._colors = gradientColors;
    }
    this.flatten();
  }

  startColorTransition(durationMs = 4200) {
    if (!this._ctx || !this._canvas) return;
    if (this._colorFadeFrame) {
      cancelAnimationFrame(this._colorFadeFrame);
      this._colorFadeFrame = null;
    }

    const start = WATER_FADE_START;
    const initialEnd = this._targetColors || this._colors;
    this._colors = start;
    this._colorFadeDuration = Math.max(0, durationMs);
    this._colorFadeStartedAt = performance.now();

    const step = (now) => {
      if (!this._ctx || !this._canvas) return;
      const raw = this._colorFadeDuration > 0
        ? (now - this._colorFadeStartedAt) / this._colorFadeDuration
        : 1;
      const t = easeColor(Math.max(0, Math.min(1, raw)));
      const end = this._targetColors || initialEnd;
      this._colors = mixGradient(start, end, t);
      this.flatten();
      if (t < 1) {
        this._colorFadeFrame = requestAnimationFrame(step);
      } else {
        this._colors = this._targetColors || initialEnd;
        this._colorFadeFrame = null;
        this.flatten();
      }
    };

    this._colors = WATER_FADE_START;
    this.flatten();
    this._colorFadeFrame = requestAnimationFrame(step);
  }

  setAspectRatio() {} // no-op, kept for API compat

  // Called every frame by GuessList while entry is animating.
  // Nothing to animate — just draw once on first call after waking, then go flat.
  update(_dt, _vx, _vy) {
    if (!this._flat) {
      this.flatten();
    }
  }

  flatten() {
    const c = this._canvas;
    const ctx = this._ctx;
    const cw = c.width;
    const ch = c.height;
    if (cw === 0 || ch === 0) { this._flat = true; return; }

    const surfaceY = ch * (1 - this.fillPercent / 100);
    const g = ctx.createLinearGradient(0, ch, 0, surfaceY);
    g.addColorStop(0, this._colors.deep);
    g.addColorStop(0.5, this._colors.mid);
    g.addColorStop(1, this._colors.surface);

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = g;
    ctx.fillRect(0, surfaceY, cw, ch - surfaceY);

    ctx.beginPath();
    ctx.moveTo(0, surfaceY);
    ctx.lineTo(cw, surfaceY);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this._flat = true;
  }

  dispose() {
    if (this._colorFadeFrame) {
      cancelAnimationFrame(this._colorFadeFrame);
      this._colorFadeFrame = null;
    }
    this._ctx = null;
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
  }
}

function easeColor(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mixGradient(start, end, t) {
  return {
    deep: mixColor(start.deep, end.deep, t),
    mid: mixColor(start.mid, end.mid, t),
    surface: mixColor(start.surface, end.surface, t),
  };
}

function mixColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 1 ? a : b;

  const hueDelta = ((cb.h - ca.h + 540) % 360) - 180;
  const h = (ca.h + hueDelta * t + 360) % 360;
  const s = ca.s + (cb.s - ca.s) * t;
  const l = ca.l + (cb.l - ca.l) * t;
  const alpha = ca.a + (cb.a - ca.a) * t;
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha.toFixed(3)})`;
}

function parseColor(value) {
  const text = String(value || '').trim();
  let m = text.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    return {
      h: parseFloat(m[1]),
      s: parseFloat(m[2]),
      l: parseFloat(m[3]),
      a: m[4] == null ? 1 : parseFloat(m[4]),
    };
  }

  m = text.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100, a: 1 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100, a: 1 };
}
