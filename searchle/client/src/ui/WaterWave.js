// ===== Water Wave =====
// SVG path-based water simulation for guess entry bubbles.
// Creates a wavy surface with idle ripple and velocity-driven sloshing.
// Water fills full width — left/right/bottom edges flush with bubble.
// Surface Y level (water height) represents rank: closer = more water.
// Uses viewBox="0 0 100 100" with preserveAspectRatio="none" so coordinates
// map as percentages of the bubble's actual pixel dimensions.

import config from '../config.js';

const svgNS = 'http://www.w3.org/2000/svg';
let _idCounter = 0;

export class WaterWave {
  constructor(svgEl, gradientColors, fillPercent, aspectRatio) {
    this._svg = svgEl;
    this._id = _idCounter++;
    this.fillPercent = fillPercent;
    this.time = Math.random() * 10; // stagger idle phases across bubbles
    this.amplitude = 0;
    this.targetAmplitude = 0;
    this.sloshing = 0;
    this.tilt = 0;          // surface tilt from horizontal velocity (water inertia)
    this._lastPathD = '';
    this._skipCounter = 0;  // frame-skip counter for sleep mode
    this.idleFade = 1;      // multiplier for idle wave — decayed during settling

    // Aspect ratio compensation for preserveAspectRatio="none".
    // Element is typically ~8x wider than tall, so Y viewBox units map to
    // far fewer pixels than X units. Scale amplitudes up so waves look natural.
    this._yBoost = Math.min(Math.sqrt(aspectRatio || 7.5), 3.5);

    // Set viewBox so we work in 0-100 percentage coordinates
    svgEl.setAttribute('viewBox', '0 0 100 100');

    // Create gradient (vertical: dark at bottom, light at surface)
    const defs = document.createElementNS(svgNS, 'defs');
    this._gradient = document.createElementNS(svgNS, 'linearGradient');
    this._gradient.id = 'wg-' + this._id;
    this._gradient.setAttribute('x1', '0');
    this._gradient.setAttribute('y1', '1');
    this._gradient.setAttribute('x2', '0');
    this._gradient.setAttribute('y2', '0');

    this._stopDeep = document.createElementNS(svgNS, 'stop');
    this._stopDeep.setAttribute('offset', '0%');
    this._stopMid = document.createElementNS(svgNS, 'stop');
    this._stopMid.setAttribute('offset', '50%');
    this._stopSurface = document.createElementNS(svgNS, 'stop');
    this._stopSurface.setAttribute('offset', '100%');

    this._gradient.appendChild(this._stopDeep);
    this._gradient.appendChild(this._stopMid);
    this._gradient.appendChild(this._stopSurface);
    defs.appendChild(this._gradient);
    svgEl.appendChild(defs);

    this._setGradientColors(gradientColors);

    // Main water path
    this._path = document.createElementNS(svgNS, 'path');
    this._path.setAttribute('class', 'water-fill');
    this._path.setAttribute('fill', `url(#wg-${this._id})`);
    svgEl.appendChild(this._path);

    // Highlight path (foam/light line at surface)
    this._highlight = document.createElementNS(svgNS, 'path');
    this._highlight.setAttribute('class', 'water-highlight');
    this._highlight.setAttribute('stroke', 'rgba(255,255,255,0.15)');
    this._highlight.setAttribute('stroke-width', '1.5');
    this._highlight.setAttribute('fill', 'none');
    this._highlight.setAttribute('vector-effect', 'non-scaling-stroke');
    svgEl.appendChild(this._highlight);

    // Build initial path
    this._buildPath();
  }

  _setGradientColors(colors) {
    this._stopDeep.setAttribute('stop-color', colors.deep);
    this._stopMid.setAttribute('stop-color', colors.mid);
    this._stopSurface.setAttribute('stop-color', colors.surface);
  }

  setFill(fillPercent, gradientColors) {
    this.fillPercent = fillPercent;
    this._setGradientColors(gradientColors);
  }

  setAspectRatio(ratio) {
    this._yBoost = Math.min(Math.sqrt(ratio || 7.5), 3.5);
  }

  update(dt, vx, vy) {
    const w = config.water;

    // Advance time (always, so phase stays in sync)
    this.time += dt;

    // Update slosh from velocity
    const speed = Math.sqrt(vx * vx + vy * vy);
    this.targetAmplitude = Math.min(speed * w.sloshVelocityScale, w.maxAmplitude);
    this.amplitude += (this.targetAmplitude - this.amplitude) * dt * w.amplitudeFollowRate;
    this.amplitude *= w.amplitudeDamping;
    this.sloshing += vx * dt * w.sloshPhaseScale;
    this.sloshing *= w.phaseDamping;

    // Tilt: water inertia — surface tilts opposite to horizontal movement
    // Like water in a glass being moved sideways
    const tiltTarget = Math.max(-6, Math.min(6, vx * 0.004));
    this.tilt += (tiltTarget - this.tilt) * dt * 12;
    this.tilt *= 0.96;

    // Frame-skip when water is idle (low amplitude, low velocity)
    if (this.amplitude < w.sleepThreshold && speed < 1 && this.idleFade >= 1) {
      if (++this._skipCounter < w.sleepFrameSkip) return;
      this._skipCounter = 0;
    } else {
      this._skipCounter = 0;
    }

    this._buildPath();
  }

  _buildPath() {
    const w = config.water;
    // Coordinate system: viewBox 0 0 100 100, preserveAspectRatio="none"
    // X: 0=left, 100=right — water always fills full width.
    // Y: 0=top, 100=bottom. Surface Y level determined by fillPercent.
    // All edges (left, right, bottom) flush with bubble border.
    const WIDTH = 100;
    const BOTTOM = 100;
    const SURFACE_Y = BOTTOM - this.fillPercent;
    const samples = w.samples;
    const step = WIDTH / samples;

    const idleFreq = w.idleFrequency * Math.PI * 2;
    const sloshFreq = w.sloshFrequency * Math.PI * 2;
    // Scale amplitudes by yBoost to compensate for squished aspect ratio.
    // waveY clamp (below) prevents overflow at edges.
    const yB = this._yBoost;
    const idleAmp = w.idleAmplitude * yB * this.idleFade;
    const sloshAmp = this.amplitude * yB * 1.5;

    // Tilt: linear surface slope from horizontal velocity (water inertia).
    // Positive vx (moving right) → water piles on left (lower Y at x=0).
    // Scaled by yBoost so it's visible despite squished aspect ratio.
    const tiltRange = this.tilt * yB;

    // Helper: compute wave Y at any X position, clamped to viewBox bounds
    const waveY = (x) => Math.max(0, Math.min(BOTTOM, SURFACE_Y
      + tiltRange * (x / WIDTH - 0.5)
      + idleAmp * Math.sin(x * idleFreq + this.time * w.idleSpeed)
      + sloshAmp * Math.sin(x * sloshFreq + this.sloshing)));

    // Right edge surface point
    const rightSurfaceY = waveY(WIDTH);

    // Bottom-left → bottom-right → right edge up to surface
    let fillD = `M0 ${BOTTOM}L${WIDTH} ${BOTTOM}L${WIDTH} ${rightSurfaceY.toFixed(1)}`;
    let highlightD = `M${WIDTH} ${rightSurfaceY.toFixed(1)}`;

    // Trace wavy surface from right to left
    // Control points sample the actual wave at midpoints for smooth curves
    for (let i = samples - 1; i >= 0; i--) {
      const x = i * step;
      const y = waveY(x);
      const mx = x + step * 0.5;
      const my = waveY(mx);
      fillD += `Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      highlightD += `Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }

    // Z closes from (0, surfaceY_left) back to (0, 100) = flush left edge
    fillD += 'Z';

    if (fillD !== this._lastPathD) {
      this._path.setAttribute('d', fillD);
      this._highlight.setAttribute('d', highlightD);
      this._lastPathD = fillD;
    }
  }

  flatten() {
    this.amplitude = 0;
    this.targetAmplitude = 0;
    this.sloshing = 0;
    this.tilt = 0;
    this.idleFade = 1;
    const SURFACE_Y = (100 - this.fillPercent).toFixed(1);
    const fillD = `M0 100L100 100L100 ${SURFACE_Y}L0 ${SURFACE_Y}Z`;
    const highlightD = `M100 ${SURFACE_Y}L0 ${SURFACE_Y}`;
    if (fillD !== this._lastPathD) {
      this._path.setAttribute('d', fillD);
      this._highlight.setAttribute('d', highlightD);
      this._lastPathD = fillD;
    }
  }

  dispose() {
    if (this._path.parentNode) this._path.parentNode.removeChild(this._path);
    if (this._highlight.parentNode) this._highlight.parentNode.removeChild(this._highlight);
    const defs = this._svg.querySelector('defs');
    if (defs && defs.parentNode) defs.parentNode.removeChild(defs);
  }
}
