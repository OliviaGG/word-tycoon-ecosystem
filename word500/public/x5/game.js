export const WORD_LENGTH = 5;
export const GUESS_LIMIT = 25;
export const VERSION = 'x5-v2';

const across = (row) => Array.from({ length: 5 }, (_, col) => [row, col]);
const down = (col) => Array.from({ length: 5 }, (_, row) => [row, col]);
export const SLOTS = [
  { id: 'a1', number: 1, direction: 'across', label: '1 Across', cells: across(0) },
  { id: 'd1', number: 1, direction: 'down', label: '1 Down', cells: down(0) },
  { id: 'd2', number: 2, direction: 'down', label: '2 Down', cells: down(4) },
  { id: 'a3', number: 3, direction: 'across', label: '3 Across', cells: across(2) },
  { id: 'a4', number: 4, direction: 'across', label: '4 Across', cells: across(4) },
];

export function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
}

function randomFor(seed) {
  let value = parseInt(hash(seed), 36) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = Math.imul(value ^ (value >>> 15), value | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, random) {
  const result = list.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function edmontonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Only the curated Word5000 targets can become answers. The larger dictionary
// is used for guesses, so unusual accepted guesses never enter the puzzle pool.
export function generatePuzzle(targets, seed) {
  const pool = [...new Set(targets.map(word => String(word).toUpperCase()).filter(word => /^[A-Z]{5}$/.test(word)))].sort();
  if (pool.length < 5) throw new Error('The word bank is not ready. Please try again.');
  const generation = hash(pool.join(','));
  const random = randomFor(`${VERSION}:${seed}:${generation}`);
  const ordered = shuffled(pool, random);
  const byEnds = new Map();
  for (const word of ordered) {
    const ends = word[0] + word[4];
    if (!byEnds.has(ends)) byEnds.set(ends, []);
    byEnds.get(ends).push(word);
  }
  for (const left of ordered) for (const right of ordered) {
    if (left === right) continue;
    const used = new Set([left, right]);
    const answers = { d1: left, d2: right };
    let possible = true;
    for (const [row, id] of [[0, 'a1'], [2, 'a3'], [4, 'a4']]) {
      const options = byEnds.get(left[row] + right[row]) || [];
      const word = options.find(candidate => !used.has(candidate));
      if (!word) { possible = false; break; }
      answers[id] = word;
      used.add(word);
    }
    if (possible) return { answers, seed, puzzleGenerationId: `${VERSION}:${seed}:${generation}`, limit: GUESS_LIMIT };
  }
  throw new Error('No crossing puzzle is available from the current word bank. Please try again.');
}

export function scoreGuess(guess, target) {
  const used = Array(WORD_LENGTH).fill(false);
  const exact = Array(WORD_LENGTH).fill(false);
  let correct = 0, present = 0;
  for (let i = 0; i < WORD_LENGTH; i++) if (guess[i] === target[i]) {
    used[i] = true;
    exact[i] = true;
    correct++;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (exact[i]) continue;
    for (let j = 0; j < WORD_LENGTH; j++) if (!used[j] && guess[i] === target[j]) {
      used[j] = true;
      present++;
      break;
    }
  }
  return { correct, present, absent: WORD_LENGTH - correct - present };
}

export function createGame(puzzle) {
  return { puzzle, guesses: [], solved: new Set(), typed: '', notes: {} };
}

// Score each copy independently, including answers found on earlier turns.
// Every combined result describes exactly 25 letter comparisons.
export function scoreAll(guess, answers) {
  const total = { correct: 0, present: 0, absent: 0 };
  const matches = [];
  for (const slot of SLOTS) {
    const score = scoreGuess(guess, answers[slot.id]);
    for (const stat of ['correct', 'present', 'absent']) total[stat] += score[stat];
    if (score.correct === WORD_LENGTH) matches.push(slot.id);
  }
  return { ...total, matches };
}

export function gameStatus(game) {
  if (game.solved.size === SLOTS.length) return 'won';
  if (game.guesses.length >= game.puzzle.limit) return 'lost';
  return 'playing';
}

export function submitGuess(game, input, dictionary) {
  if (gameStatus(game) !== 'playing') return { ok: false, error: 'This puzzle is finished.' };
  const word = String(input).trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(word)) return { ok: false, error: 'Enter a five-letter word.' };
  if (!dictionary.has(word.toLowerCase())) return { ok: false, error: 'Not in the word bank. No guess spent.' };
  if (game.guesses.some(guess => guess.word === word)) return { ok: false, error: 'Already tried that word. No guess spent.' };
  const { matches, ...score } = scoreAll(word, game.puzzle.answers);
  const guess = { word, ...score, found: matches.length };
  game.guesses.push(guess);
  matches.forEach(id => game.solved.add(id));
  game.typed = '';
  game.notes = {};
  return { ok: true, solved: matches.length > 0, status: gameStatus(game), guess };
}

// Replay saved guesses through the same validation as new guesses. Never trust
// saved score counts or solved flags, and discard obsolete puzzle generations.
export function restoreGame(puzzle, saved, dictionary) {
  const game = createGame(puzzle);
  if (!saved || saved.puzzleGenerationId !== puzzle.puzzleGenerationId || !Array.isArray(saved.guesses)) return game;
  for (const guess of saved.guesses.slice(0, puzzle.limit)) {
    if (!guess || !submitGuess(game, guess.word, dictionary).ok) break;
  }
  if (game.guesses.length > 0 && game.guesses.length === saved.guesses.length && saved.notes && typeof saved.notes === 'object' && !Array.isArray(saved.notes)) {
    SLOTS.forEach(slot => {
      const notes = saved.notes[slot.id];
      if (Array.isArray(notes)) game.notes[slot.id] = Array.from({ length: 5 }, (_, i) => [1, 2, 3].includes(notes[i]) ? notes[i] : 0);
    });
  }
  return game;
}

export function snapshot(game) {
  return { puzzleGenerationId: game.puzzle.puzzleGenerationId, guesses: game.guesses.map(({word}) => ({word})), notes: game.notes };
}

export function shareText(game, dailyDate) {
  const heading = `Word5000x5 ${dailyDate || 'Practice'}`;
  const result = `${game.solved.size}/5 words · ${game.guesses.length}/${game.puzzle.limit} guesses`;
  const turns = game.guesses.map(guess => guess.found ? '🟩' : guess.correct + guess.present === 0 ? '🟥' : '🟨').join('') || '⬜';
  return [heading, result, turns, 'https://word5000.com/x5/'].join('\n');
}
