// ===== Searchle 3.0 Client Configuration =====

export default {
  // Win overlay — match the OBS holo overlay's big-mode 10s hold so
  // the in-game card and the stream card disappear at the same moment.
  winDisplayDuration: 10000,

  // Color gradient (closest -> furthest)
  gradient: {
    hueMax: 120,     // green (closest)
    hueMin: 0,       // red (furthest)
    saturation: 80,
    lightness: 35,
    opacity: 0.9,
    minFillPercent: 2,
    bgColor: '#111827',
  },

  // Platform colors
  platformColors: {
    tiktok: '#69C9D0',
    youtube: '#FF0000',
    discord: '#5865F2',
  },
  defaultPlatformColor: '#9147FF',

  // Default settings (overridden by user via Settings panel)
  defaults: {
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    textSize: 72,
    scoreSize: 63,
    bubbleSize: 180,
    bubbleStyle: 'rounded',
    volume: 50,
  },

  // Bubble style -> border-radius
  bubbleRadiusMap: {
    rounded: '36px',
    square: '0px',
    pill: '999px',
  },

  // Viewport
  baseWidth: 1800,
  timerInterval: 1000,

  // Transition durations (ms)
  transitions: {
    guessEnter: 300,
    guessReorder: 400,
    guessExit: 200,
    bumpFlash: 300,
    jackpotBump: 350,
    jackpotCount: 800,
    winSlideIn: 400,
    staggerDelay: 50,
  },

  // Easing names
  easing: {
    enter: 'easeBackOut',
    reorder: 'easeCubicInOut',
    exit: 'easeQuadIn',
  },

  // Water simulation
  water: {
    idleAmplitude: 2.5,
    idleFrequency: 0.02,
    idleSpeed: 1.8,
    sloshFrequency: 0.03,
    sloshVelocityScale: 0.025,
    sloshPhaseScale: 0.008,
    maxAmplitude: 6,
    amplitudeDamping: 0.97,
    amplitudeFollowRate: 14,
    phaseDamping: 0.98,
    samples: 12,
    sleepThreshold: 0.1,
    sleepFrameSkip: 4,
  },

  // LocalStorage key
  storageKey: 'searchle-3-settings-v2',
};
