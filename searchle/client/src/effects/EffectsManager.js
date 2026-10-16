// ===== Effects Manager =====
// Coordinates win celebration effects using Canvas 2D overlay.
// Uses the same proven Canvas approach from 2.0 but manages it from the ES module system.

import config from '../config.js';
import { isMobile, isOBS } from '../utils/Mobile.js';

// Import all effect handlers
import { confetti } from './effects/ConfettiEffect.js';
import { sparkles } from './effects/SparklesEffect.js';
import { hearts } from './effects/HeartsEffect.js';
import { heart_shower } from './effects/HeartShowerEffect.js';
import { fireworks } from './effects/FireworksEffect.js';
import { lightning } from './effects/LightningEffect.js';
import { snowfall } from './effects/SnowfallEffect.js';
import { meteors } from './effects/MeteorsEffect.js';
import { cherry_blossom } from './effects/CherryBlossomEffect.js';
import { aurora } from './effects/AuroraEffect.js';
import { galaxy_burst } from './effects/GalaxyBurstEffect.js';
import { phoenix } from './effects/PhoenixEffect.js';
import { nuclear } from './effects/NuclearEffect.js';

const effectRegistry = {
  confetti, sparkles, hearts, heart_shower, fireworks, lightning, snowfall,
  meteors, cherry_blossom, aurora, galaxy_burst, phoenix, nuclear,
};

export class EffectsManager {
  constructor(viewport) {
    this.viewport = viewport;
    this.canvas = null;
    this.ctx = null;
    this.particles = null;
    this.animFrame = null;
    this.startTime = 0;
    this.duration = 0;
    this.effectConfig = null;
    this.currentEffect = null;
  }

  playWinEffect(effectCfg) {
    if (!effectCfg || !effectCfg.effect) return;
    const handler = effectRegistry[effectCfg.effect];
    if (!handler) return;

    this._cleanup();
    this._createCanvas();

    const w = this.canvas.width;
    const h = this.canvas.height;

    this.effectConfig = effectCfg;
    this.duration = effectCfg.duration || 3000;
    this.startTime = Date.now();
    this.currentEffect = handler;
    this.particles = handler.init(effectCfg, w, h);

    this.animFrame = requestAnimationFrame(() => this._animate());

    // Safety timeout
    setTimeout(() => this._cleanup(), this.duration + 1000);
  }

  _createCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
    // Mobile: half-res effect canvas — particles don't need pixel-perfect rendering
    const scale = (isMobile || isOBS) ? 0.5 : 1;
    this.canvas.width = Math.round(this.viewport.width * scale);
    this.canvas.height = Math.round(this.viewport.height * scale);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  _cleanup() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.particles = null;
    this.currentEffect = null;
  }

  _animate() {
    if (!this.canvas || !this.ctx || !this.particles) return;

    const elapsed = Date.now() - this.startTime;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.currentEffect) {
      this.currentEffect.update(this.particles, 16, elapsed, this.duration, this.canvas.width, this.canvas.height, this.effectConfig);
      this.currentEffect.draw(this.particles, this.ctx, this.canvas);
    }

    if (elapsed < this.duration) {
      this.animFrame = requestAnimationFrame(() => this._animate());
    } else {
      this._cleanup();
    }
  }

  get hasActiveEffect() {
    return this.canvas !== null;
  }
}
