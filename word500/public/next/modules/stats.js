import { soloStorage as localStorage } from './solo-owner.js?v=20261003-owner2';
// Local stats for solo. Schema mirrors the legacy word1000 client so that
// once we point the same browser at the new shell, stats carry over.

const KEY = 'word500.next.stats';

function blank() {
  return {
    totalGames: 0,
    totalWins: 0,
    totalGuesses: 0,        // sum across wins (denominator for avg)
    currentStreak: 0,
    bestStreak: 0,
    history: [],            // [{ word, won, guesses, isDaily, date }] newest last
  };
}

export function getStats() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    return Object.assign(blank(), s || {});
  } catch {
    return blank();
  }
}

function saveStats(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/**
 * Record a finished game. Updates streaks correctly:
 *   - daily win → currentStreak +1 (cap at bestStreak)
 *   - daily loss → currentStreak = 0
 *   - practice game → totals only, no streak change
 */
export function recordGame({ word, won, guesses, isDaily, date }) {
  const s = getStats();
  s.totalGames++;
  if (won) {
    s.totalWins++;
    s.totalGuesses += Number(guesses) || 0;
  }
  if (isDaily) {
    if (won) {
      s.currentStreak++;
      if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
    } else {
      s.currentStreak = 0;
    }
  }
  s.history.push({
    word: String(word || '').toUpperCase(),
    won: !!won,
    guesses: Number(guesses) || 0,
    isDaily: !!isDaily,
    date: date || new Date().toISOString().slice(0, 10),
  });
  // Cap history to last 50 entries
  if (s.history.length > 50) s.history = s.history.slice(-50);
  saveStats(s);
  return s;
}

/**
 * Compute a derived stats summary suitable for rendering.
 */
export function statsSummary() {
  const s = getStats();
  const winRate = s.totalGames > 0 ? Math.round((s.totalWins / s.totalGames) * 100) : 0;
  const avgGuesses = s.totalWins > 0 ? (s.totalGuesses / s.totalWins).toFixed(1) : '–';
  return {
    played: s.totalGames,
    wins: s.totalWins,
    winRate,
    avgGuesses,
    currentStreak: s.currentStreak,
    bestStreak: s.bestStreak,
    history: [...s.history].reverse().slice(0, 20),  // newest first, cap 20
  };
}
