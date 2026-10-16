// ===== Animation Manager =====
// Lightweight tween system running in the requestAnimationFrame loop.

import { Easing } from './Easing.js';

export class AnimationManager {
  constructor() {
    this.tweens = [];
  }

  /**
   * Create a tween.
   * @param {object} opts
   * @param {object} opts.target - The object to mutate
   * @param {string} opts.prop - Property name on target (supports nested via apply fn)
   * @param {number} opts.from - Start value
   * @param {number} opts.to - End value
   * @param {number} opts.duration - Duration in ms
   * @param {string|function} opts.easing - Easing name or function
   * @param {function} [opts.apply] - Custom apply(value) instead of target[prop]
   * @param {function} [opts.onComplete] - Callback when done
   */
  tween(opts) {
    const easingFn = typeof opts.easing === 'function'
      ? opts.easing
      : Easing[opts.easing] || Easing.easeLinear;

    this.tweens.push({
      target: opts.target,
      prop: opts.prop,
      from: opts.from,
      to: opts.to,
      duration: opts.duration,
      easing: easingFn,
      apply: opts.apply || null,
      onComplete: opts.onComplete || null,
      startTime: performance.now(),
    });
  }

  /**
   * Cancel all tweens targeting a specific object.
   */
  cancelFor(target) {
    this.tweens = this.tweens.filter(t => t.target !== target);
  }

  /**
   * Update all active tweens. Called each frame.
   */
  update() {
    const now = performance.now();

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      const elapsed = now - t.startTime;
      const progress = Math.min(elapsed / t.duration, 1);
      const eased = t.easing(progress);
      const value = t.from + (t.to - t.from) * eased;

      if (t.apply) {
        t.apply(value);
      } else if (t.target && t.prop) {
        t.target[t.prop] = value;
      }

      if (progress >= 1) {
        if (t.onComplete) t.onComplete();
        this.tweens.splice(i, 1);
      }
    }
  }

  get active() {
    return this.tweens.length > 0;
  }
}
