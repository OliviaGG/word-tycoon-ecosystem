const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SPELLINGBEE_DATA_DIR || path.join(__dirname, '..', 'data');
const CURRENT_GAME_FILE = path.join(DATA_DIR, 'current-game.json');
const SAVED_GAMES_FILE = path.join(DATA_DIR, 'saved-games.json');
const PLAYER_STATS_FILE = path.join(DATA_DIR, 'player-stats.json');
const ROUND_METADATA_FILE = path.join(DATA_DIR, 'round-metadata.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    throw new Error(`Spelling Bee storage needs recovery: ${path.basename(filePath)}`, { cause: err });
  }
  return fallback;
}

function writeJSON(filePath, data, strict = false) {
  try {
    const temp = filePath + '.tmp-' + require('crypto').randomUUID();
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
      fs.renameSync(temp, filePath);
      if (process.platform !== 'win32') {
        const directory = fs.openSync(path.dirname(filePath), 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      }
    } finally {
      if (fd !== null && fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return true;
  } catch (err) {
    if (strict) throw err;
    console.error(`Error writing ${path.basename(filePath)}:`, err.message);
    return false;
  }
}

// ── Current Game ──────────────────────────────────────────────

function loadCurrentGame() {
  return readJSON(CURRENT_GAME_FILE, null);
}

function saveCurrentGame(gameData) {
  writeJSON(CURRENT_GAME_FILE, gameData);
}

function clearCurrentGame() {
  try {
    if (fs.existsSync(CURRENT_GAME_FILE)) {
      fs.unlinkSync(CURRENT_GAME_FILE);
    }
  } catch (err) {
    console.error('Error clearing current game:', err.message);
  }
}

// ── Saved Games ───────────────────────────────────────────────

function loadSavedGames() {
  return readJSON(SAVED_GAMES_FILE, []);
}

function saveSavedGames(games) {
  writeJSON(SAVED_GAMES_FILE, games);
}

// ── Player Stats ──────────────────────────────────────────────

function loadPlayerStats() {
  return readJSON(PLAYER_STATS_FILE, {});
}

function savePlayerStats(stats) {
  writeJSON(PLAYER_STATS_FILE, stats);
}

module.exports = {
  ensureDataDir,
  loadCurrentGame,
  saveCurrentGame,
  clearCurrentGame,
  loadSavedGames,
  saveSavedGames,
  loadPlayerStats,
  savePlayerStats,
  loadRoundMetadata: () => readJSON(ROUND_METADATA_FILE, null),
  saveRoundMetadata: data => writeJSON(ROUND_METADATA_FILE, data, true)
};
