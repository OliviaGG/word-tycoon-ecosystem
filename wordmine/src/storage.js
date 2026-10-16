/**
 * Storage — JSON file persistence for game state, player stats, played mines.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function loadJSON(filename, fallback) {
  const p = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn(`[Storage] Failed to load ${filename}:`, e.message);
  }
  return fallback;
}

function saveJSON(filename, data) {
  ensureDataDir();
  try {
    atomicWriteSync(path.join(DATA_DIR, filename), data);
  } catch (e) {
    console.warn(`[Storage] Failed to save ${filename}:`, e.message);
  }
}

// ─── Current Game ────────────────────────────────────────────────────────────

function loadCurrentGame() {
  return loadJSON('current-game.json', null);
}

function saveCurrentGame(state) {
  saveJSON('current-game.json', state);
}

function clearCurrentGame() {
  const p = path.join(DATA_DIR, 'current-game.json');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ }
}

// ─── Player Stats ────────────────────────────────────────────────────────────

function loadPlayerStats() {
  return loadJSON('player-stats.json', {});
}

function savePlayerStats(stats) {
  saveJSON('player-stats.json', stats);
}

// ─── Played Mines ────────────────────────────────────────────────────────────

function loadPlayedMines() {
  return new Set(loadJSON('played-mines.json', []));
}

function savePlayedMines(set) {
  saveJSON('played-mines.json', [...set].slice(-500));
}

module.exports = {
  atomicWriteSync,
  loadCurrentGame,
  saveCurrentGame,
  clearCurrentGame,
  loadPlayerStats,
  savePlayerStats,
  loadPlayedMines,
  savePlayedMines,
  DATA_DIR,
};
