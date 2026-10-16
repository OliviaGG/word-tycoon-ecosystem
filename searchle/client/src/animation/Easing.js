// ===== Easing Functions =====
// Ported from D3 easings used in Searchle 2.0 to 3.0

export const Easing = {
  easeBackOut(t) {
    const s = 1.70158;
    return --t * t * ((s + 1) * t + s) + 1;
  },

  easeCubicInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },

  easeQuadIn(t) {
    return t * t;
  },

  easeLinear(t) {
    return t;
  },

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  },
};
