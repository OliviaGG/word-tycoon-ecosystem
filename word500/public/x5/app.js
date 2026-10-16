import { SLOTS, generatePuzzle, edmontonDate, createGame, restoreGame, snapshot, gameStatus, submitGuess, scoreGuess, shareText } from './game.js?v=2';
import { buildStatsTriangle } from '../next/modules/render-row.js';
import { renderKeyboard, applyKeyStates } from '../next/modules/keyboard.js';

const $ = id => document.getElementById(id);
const STORAGE = 'word5000.x5.v2';
const input = $('guess-input');
const letters = [];
const cells = [];
let dictionary;
let targets;
let game;
let mode = 'daily';
let date = edmontonDate();
let busy = false;
let storageWarning = false;

function readStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}
function save() {
  if (!game) return;
  try {
    const stored = readStorage();
    stored[mode] = { ...snapshot(game), date, seed: game.puzzle.seed };
    localStorage.setItem(STORAGE, JSON.stringify(stored));
  } catch { storageWarning = true; }
}
function message(text, error = false) {
  $('status-message').textContent = text + (storageWarning ? ' Browser storage is unavailable; progress cannot be saved.' : '');
  $('status-message').classList.toggle('error', error);
}
function freshSeed() {
  return `practice-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
}

function renderNote(item) {
  const note = (game.notes[item.slot.id] || [])[item.index] || 0;
  item.button.querySelector('.tile-note')?.remove();
  if (note) {
    const sticker = document.createElement('span');
    sticker.className = 'tile-note';
    sticker.dataset.note = note;
    sticker.setAttribute('aria-hidden', 'true');
    item.button.appendChild(sticker);
  }
  const word = game.guesses.at(-1)?.word || '';
  item.button.disabled = !word;
  const colour = item.button.dataset.wordColour;
  item.button.setAttribute('aria-label', `${item.slot.label}, letter ${item.index + 1}: ${word[item.index] || 'blank'}.${colour ? ` Word colour: ${colour}.` : ''} Your note: ${['none','right spot','wrong spot','absent'][note]}. Tap to cycle note.`);
}

function buildBoard() {
  const numbers = { '0,0': 1, '0,4': 2, '2,0': 3, '4,0': 4 };
  for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
    const key = `${row},${col}`;
    const copies = SLOTS.flatMap(slot => slot.cells.map((cell, index) => ({slot, cell, index}))).filter(item => item.cell.join(',') === key).sort((a, b) => (a.slot.direction === 'down') - (b.slot.direction === 'down'));
    const cell = document.createElement('div');
    if (!copies.length) {
      cell.className = 'blocked-cell';
      $('crossword').appendChild(cell);
      continue;
    }
    cell.className = 'toon-tile board-cell' + (copies.length > 1 ? ' crossing-cell' : '');
    if (numbers[key]) {
      const number = document.createElement('span');
      number.className = 'tile-number';
      number.textContent = numbers[key];
      cell.appendChild(number);
    }
    for (const copy of copies) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'board-letter';
      button.disabled = true;
      button.dataset.slot = copy.slot.id;
      button.dataset.position = copy.index;
      if (copies.length > 1) {
        const direction = document.createElement('span');
        direction.className = 'letter-direction';
        direction.setAttribute('aria-hidden', 'true');
        direction.textContent = copy.slot.direction === 'across' ? '→' : '↓';
        button.appendChild(direction);
      }
      const text = document.createElement('span');
      text.className = 'tile-letter';
      button.appendChild(text);
      const item = {...copy, button, text};
      button.addEventListener('click', () => {
        if (!game?.guesses.length) return;
        if (!game.notes[copy.slot.id]) game.notes[copy.slot.id] = Array(5).fill(0);
        game.notes[copy.slot.id][copy.index] = (game.notes[copy.slot.id][copy.index] + 1) % 4;
        save();
        renderNote(item);
      });
      cell.appendChild(button);
      letters.push(item);
    }
    cells.push(cell);
    $('crossword').appendChild(cell);
  }
  for (let i = 0; i < 5; i++) {
    const tile = document.createElement('span');
    tile.className = 'toon-tile';
    $('entry-tiles').appendChild(tile);
  }
}

function renderEntry() {
  if (!game) return;
  [...$('entry-tiles').children].forEach((tile, index) => { tile.textContent = game.typed[index] || ''; });
}

function render() {
  if (!game) return;
  const latest = game.guesses.at(-1);
  const status = gameStatus(game);
  const word = latest?.word || '';
  const colours = new Map();
  if (latest) for (const slot of SLOTS) {
    const score = scoreGuess(word, game.puzzle.answers[slot.id]);
    const hue = Math.max(0, Math.min(120, (score.correct + .5 * score.present) / 5 * 120));
    colours.set(slot.id, {
      face: `hsl(${hue} 78% 65%)`, slab: `hsl(${hue} 50% 38%)`,
      label: hue === 120 ? 'green' : hue >= 90 ? 'yellow-green' : hue >= 50 ? 'yellow' : hue > 0 ? 'orange' : 'red',
    });
  }
  letters.forEach(item => {
    item.text.textContent = word[item.index] || '';
    const colour = colours.get(item.slot.id);
    if (colour) {
      item.button.style.setProperty('--word-face', colour.face);
      item.button.dataset.wordColour = colour.label;
    } else {
      item.button.style.removeProperty('--word-face');
      delete item.button.dataset.wordColour;
    }
    renderNote(item);
  });
  cells.forEach(cell => {
    cell.classList.toggle('has-guess', !!latest);
    const colour = colours.get(cell.querySelector('.board-letter').dataset.slot);
    if (colour && !cell.classList.contains('crossing-cell')) {
      cell.style.setProperty('--face', colour.face);
      cell.style.setProperty('--slab', colour.slab);
    } else {
      cell.style.removeProperty('--face');
      cell.style.removeProperty('--slab');
    }
  });
  $('board-guess').textContent = latest ? word : 'The latest guess';
  $('solved-count').textContent = `${game.solved.size} / 5`;
  $('solved-count').setAttribute('aria-label', `${game.solved.size} of 5 words found`);
  $('guess-budget').textContent = `${game.puzzle.limit - game.guesses.length} guesses left`;
  $('daily-button').setAttribute('aria-pressed', String(mode === 'daily'));
  $('practice-button').setAttribute('aria-pressed', String(mode === 'practice'));
  $('date-tag').textContent = mode === 'daily' ? `${date} · Daily` : 'Fresh puzzle · Practice';
  const closed = status !== 'playing';
  input.disabled = closed;
  $('submit-button').disabled = closed;
  $('entry-row').classList.toggle('closed', closed);
  $('result-actions').hidden = !closed;
  $('keyboard').querySelectorAll('button').forEach(button => { button.disabled = closed; });
  applyKeyStates($('keyboard'), new Set(game.guesses.flatMap(guess => [...guess.word])));
  $('combined-triangle').replaceChildren();
  if (latest) {
    const triangle = buildStatsTriangle(latest.correct, latest.present, latest.absent);
    triangle.setAttribute('role', 'img');
    $('combined-triangle').appendChild(triangle);
  }
  $('combined-label').textContent = latest ? `${word} · 25 letters checked` : 'One triangle for all five words';
  renderEntry();
}

function showStatus() {
  const status = gameStatus(game);
  if (status === 'won') message(`All five found in ${game.guesses.length} guesses.`);
  else if (status === 'lost') message(`Out of guesses. ${game.solved.size} of 5 words found.`);
  else message('Each word has its own match colour. The triangle adds up all 25 letters.');
}

function start(nextMode, fresh = false) {
  if (!targets || busy) return;
  const nextDate = edmontonDate();
  const saved = readStorage()[nextMode];
  const practiceSeed = !fresh && saved && typeof saved.seed === 'string' && /^practice-/.test(saved.seed) ? saved.seed : freshSeed();
  const seed = nextMode === 'daily' ? `daily-${nextDate}` : practiceSeed;
  try {
    const puzzle = generatePuzzle(targets, seed);
    game = fresh ? createGame(puzzle) : restoreGame(puzzle, saved, dictionary);
    mode = nextMode;
    date = nextDate;
    input.value = '';
    save();
    render();
    showStatus();
  } catch (error) { message(error.message, true); $('retry-button').hidden = false; }
}

function submit() {
  if (!game || busy || gameStatus(game) !== 'playing') return;
  if (mode === 'daily' && date !== edmontonDate()) {
    start('daily');
    message('A new daily is ready. This guess was not spent.');
    return;
  }
  const result = submitGuess(game, game.typed, dictionary);
  if (!result.ok) { message(result.error, true); return; }
  input.value = '';
  save();
  render();
  if (result.status !== 'playing') showStatus();
  else message(`${result.guess.correct} right spot · ${result.guess.present} wrong spot · ${result.guess.absent} absent.${result.solved ? ' You found a word!' : ''}`);
  if (window.matchMedia('(max-width: 700px)').matches) $('game').scrollIntoView({ block: 'start', behavior: 'instant' });
}

function onKey(key) {
  if (!game || $('help-dialog').open || input.disabled) return;
  if (key === 'ENTER') { submit(); return; }
  const position = input.selectionStart ?? game.typed.length;
  const end = input.selectionEnd ?? position;
  if (key === 'BACKSPACE') {
    const from = position === end ? Math.max(0, position - 1) : position;
    game.typed = game.typed.slice(0, from) + game.typed.slice(end);
    input.value = game.typed;
    input.focus({ preventScroll: true });
    input.setSelectionRange(from, from);
  } else if (/^[A-Z]$/.test(key)) {
    const next = game.typed.slice(0, position) + key + game.typed.slice(end);
    if (next.length > 5) return;
    game.typed = next;
    input.value = next;
    input.focus({ preventScroll: true });
    input.setSelectionRange(position + 1, position + 1);
  }
  renderEntry();
}

async function load() {
  busy = true;
  $('retry-button').hidden = true;
  $('daily-button').disabled = true;
  $('practice-button').disabled = true;
  $('submit-button').disabled = true;
  input.disabled = true;
  $('keyboard').querySelectorAll('button').forEach(button => { button.disabled = true; });
  message('Loading the word bank…');
  try {
    const responses = await Promise.all([
      fetch('../api/word-bank/dictionary/5', { signal: AbortSignal.timeout(15000) }),
      fetch('../api/word-bank/targets/5', { signal: AbortSignal.timeout(15000) }),
    ]);
    if (responses.some(response => !response.ok)) throw new Error('The word bank is unavailable. Please try again.');
    const [guessWords, answerWords] = await Promise.all(responses.map(response => response.json()));
    if (!Array.isArray(guessWords) || !Array.isArray(answerWords) || !guessWords.length) throw new Error('The word bank is not ready. Please try again.');
    targets = answerWords;
    dictionary = new Set([...guessWords, ...answerWords].map(word => String(word).toLowerCase()));
    busy = false;
    start('daily');
  } catch (error) {
    message(error.name === 'TimeoutError' ? 'The word bank took too long. Please try again.' : error.message, true);
    $('retry-button').hidden = false;
  } finally {
    busy = false;
    $('daily-button').disabled = !targets;
    $('practice-button').disabled = !targets;
  }
}

function updateTheme() {
  const night = document.documentElement.classList.contains('night');
  $('theme-button').textContent = night ? '☾' : '☀';
  $('theme-button').setAttribute('aria-label', night ? 'Switch to day' : 'Switch to night');
  document.querySelector('meta[name="theme-color"]').content = night ? '#141230' : '#fdf6e9';
}

buildBoard();
renderKeyboard($('keyboard'), onKey);
input.disabled = true;
$('submit-button').disabled = true;
$('help-triangle').appendChild(buildStatsTriangle(8, 6, 11));
$('guess-form').addEventListener('submit', event => { event.preventDefault(); submit(); });
input.addEventListener('input', () => {
  if (!game) return;
  game.typed = input.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0,5);
  input.value = game.typed;
  renderEntry();
});
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || $('help-dialog').open || event.target === input) return;
  if (event.key === 'Enter') {
    if (event.target.closest('button, a')) return;
    event.preventDefault(); onKey('ENTER');
  } else if (event.key === 'Backspace') { event.preventDefault(); onKey('BACKSPACE'); }
  else if (/^[a-z]$/i.test(event.key)) { event.preventDefault(); onKey(event.key.toUpperCase()); }
});
$('daily-button').addEventListener('click', () => start('daily'));
$('practice-button').addEventListener('click', () => start('practice', mode === 'practice' && gameStatus(game) !== 'playing'));
$('new-puzzle-button').addEventListener('click', () => start('practice', true));
$('retry-button').addEventListener('click', load);
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('help-close').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => {
  if (event.target !== $('help-dialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
$('theme-button').addEventListener('click', () => {
  document.documentElement.classList.toggle('night');
  try { localStorage.setItem('wt-night', document.documentElement.classList.contains('night') ? '1' : '0'); } catch {}
  updateTheme();
});
$('share-button').addEventListener('click', async () => {
  const text = shareText(game, mode === 'daily' ? date : null);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); message('Result copied.'); }
  } catch (error) { if (error.name !== 'AbortError') window.prompt('Copy your result:', text); }
});
updateTheme();
load();
