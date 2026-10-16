// ===== Color Utilities =====
// Rank-to-color mapping and platform colors.

import config from '../config.js';

// Server sentinel for "not a real word at all" (server/guess-processor.js).
// Distinct from RANK_OUTSIDE_POOL (99999998) / 100001, which are real words
// that simply fall outside the ranked pool — those stay on the normal curve.
export const RANK_INVALID = 9999999;

export function rankToColor(rank, total) {
  const g = config.gradient;
  const logRank = Math.log(rank);
  const logTotal = Math.log(total);
  const ratio = Math.min(logRank / logTotal, 1);
  const hue = g.hueMax * (1 - ratio);
  return `hsla(${hue}, ${g.saturation}%, ${g.lightness}%, ${g.opacity})`;
}

export function rankToFillPercent(rank, total) {
  // Misspelt / non-words fill the bubble completely. On the plain curve
  // they'd bottom out at minFillPercent (2%), which reads as an empty red
  // shell — visually identical to a valid-but-very-distant word. A solid
  // red block makes "that isn't a word" unmistakable at a glance.
  if (rank === RANK_INVALID) return 100;
  const logRank = Math.log(rank);
  const logTotal = Math.log(total);
  const ratio = Math.min(logRank / logTotal, 1);
  return Math.max((1 - ratio) * 100, config.gradient.minFillPercent);
}

export function rankToWaterGradient(rank, total) {
  const g = config.gradient;
  const logRank = Math.log(rank);
  const logTotal = Math.log(total);
  const ratio = Math.min(logRank / logTotal, 1);
  const hue = g.hueMax * (1 - ratio);

  return {
    deep: `hsla(${hue}, ${g.saturation}%, ${g.lightness - 8}%, ${g.opacity})`,
    mid: `hsla(${hue}, ${g.saturation - 5}%, ${g.lightness}%, ${g.opacity})`,
    surface: `hsla(${hue}, ${g.saturation - 10}%, ${g.lightness + 12}%, ${g.opacity - 0.1})`,
  };
}

export function getPlatformColor(platform) {
  return config.platformColors[platform] || config.defaultPlatformColor;
}

export function formatRank(rank) {
  if (rank === RANK_INVALID) return '???';
  if (rank === 100001) return '100,000+';
  return rank.toLocaleString();
}
