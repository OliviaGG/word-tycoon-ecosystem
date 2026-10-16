const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
let _storageBlocked = false;

let db = null;
let SQL = null;

const DB_PATH = path.join(__dirname, '..', 'data', 'pixeletters.db');

// --- sql.js WASM corruption watchdog ---
// sql.js keeps the whole DB in a WASM heap that can degrade over long uptime.
// Once corrupted, every query throws "memory access out of bounds" and the
// service stays silently dead until a manual restart. Detect it at the DB
// choke point, persist what we can, and exit so PM2 restarts us clean.
function _installCorruptionWatchdog(instance) {
  const bail = (err) => {
    console.error('[DB] sql.js WASM heap corrupted — persisting and exiting for PM2 restart:', err && err.message);
    try { save(); } catch (_) {}
    setTimeout(() => process.exit(1), 1500);
  };
  const guard = (fn) => function (...args) {
    try { return fn.apply(this, args); }
    catch (err) {
      if (err && /memory access out of bounds/i.test(String(err.message || err))) bail(err);
      throw err;
    }
  };
  instance.exec = guard(instance.exec.bind(instance));
  const originalRun = instance.run.bind(instance);
  instance.run = guard(function (...args) { if (_storageBlocked) throw Error('Database requires storage recovery'); return originalRun(...args); });
  const origPrepare = instance.prepare.bind(instance);
  instance.prepare = guard(function (...args) {
    const stmt = origPrepare(...args);
    if (stmt) {
      stmt.bind = guard(stmt.bind.bind(stmt));
      stmt.step = guard(stmt.step.bind(stmt));
      stmt.getAsObject = guard(stmt.getAsObject.bind(stmt));
      stmt.run = guard(stmt.run.bind(stmt));
    }
    return stmt;
  });
  return instance;
}

async function initialize() {
  SQL = await require('sql.js')();

  // Load existing DB or create new
  let buffer = null;
  if (fs.existsSync(DB_PATH)) {
    buffer = fs.readFileSync(DB_PATH);
  }

  db = _installCorruptionWatchdog(buffer ? new SQL.Database(buffer) : new SQL.Database());

  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    word TEXT NOT NULL,
    word_length INTEGER NOT NULL,
    max_guesses INTEGER NOT NULL DEFAULT 5,
    guesses TEXT NOT NULL DEFAULT '[]',
    revealed_rows TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    winner_platform TEXT,
    winner_user_id TEXT,
    winner_username TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_stats (
    platform TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    total_guesses INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    PRIMARY KEY (platform, platform_user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    word_length INTEGER NOT NULL,
    guesses TEXT NOT NULL,
    status TEXT NOT NULL,
    winner_platform TEXT,
    winner_user_id TEXT,
    winner_username TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run('CREATE TABLE IF NOT EXISTS mp_statistics_receipts (event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, accepted_at TEXT NOT NULL)');

  // Default settings
  const defaults = {
    word_length: '5',
    max_guesses: '0',
    auto_restart_delay: '10',
    port: '3100',
    require_slash: '0',
    game_mode: 'plus'
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }

  save();
  console.log('[DB] Database initialized');
}

// Debounced save — coalesces rapid writes into a single disk flush
let _saveTimer = null;
const SAVE_DELAY = 1000;

function save() {
  if (!db) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushToDisk, SAVE_DELAY);
}

function _persistToDisk() {
  if (!db) return;
  if (_storageBlocked) throw Error('Database requires storage recovery');
  const bytes = Buffer.from(db.export()), directory = path.dirname(DB_PATH);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(DB_PATH)) { const stat = fs.lstatSync(DB_PATH); if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Unsafe database file'); }
  const temporary = DB_PATH + '.' + crypto.randomUUID() + '.tmp'; let fd, renamed = false;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, DB_PATH); renamed = true;
    if (process.platform !== 'win32') { const directoryFd = fs.openSync(directory, 'r'); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); } }
  } catch (error) { if (renamed) _storageBlocked = true; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function _flushToDisk() {
  if (!db) return;
  _saveTimer = null;
  try { _persistToDisk(); } catch (err) { console.error('[DB] Save error:', err.message); }
}

// A receipt, statistics delta and optional round history persist together.
// Retrying after a crash between this commit and journal handoff is idempotent.
function applyStatisticsReceipt(entry) {
  if (_storageBlocked) throw Error('Database requires storage recovery');
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.eventId || '') || !Number.isFinite(Date.parse(entry.acceptedAt)) || !Array.isArray(entry.participants) || entry.participants.length > 10000) throw Error('Invalid statistics receipt');
  const players = [entry.guess, ...entry.participants].filter(Boolean);
  for (const player of players) {
    if (typeof player.platform !== 'string' || !player.platform || typeof player.platformUserId !== 'string' || !player.platformUserId || player.platformUserId.length > 128 || typeof player.username !== 'string' || player.username.length > 80 || typeof player.displayName !== 'string' || player.displayName.length > 80) throw Error('Invalid statistics player');
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  const statement = db.prepare('SELECT digest FROM mp_statistics_receipts WHERE event_id = ?'); statement.bind([entry.eventId]);
  let previous; try { if (statement.step()) previous = statement.getAsObject().digest; } finally { statement.free(); }
  if (previous) { if (previous !== digest) throw Error('Conflicting statistics receipt'); return false; }
  const before = Buffer.from(db.export());
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    db.run('BEGIN IMMEDIATE');
    if (entry.guess) { const p = entry.guess; getOrCreateUserStats(p.platform, p.platformUserId, p.username, p.displayName); recordGuess(p.platform, p.platformUserId, entry.acceptedAt); }
    for (const p of entry.participants) { getOrCreateUserStats(p.platform, p.platformUserId, p.username, p.displayName); recordGamePlayed(p.platform, p.platformUserId, !!p.won, entry.acceptedAt); }
    if (entry.history) addGameHistory(entry.history);
    db.run('INSERT INTO mp_statistics_receipts (event_id, digest, accepted_at) VALUES (?, ?, ?)', [entry.eventId, digest, entry.acceptedAt]);
    db.run('COMMIT'); _persistToDisk(); return true;
  } catch (error) {
    // Before rename, the prior bytes remain canonical. After an uncertain
    // rename/fsync, preserve the new file and block mutation until reload.
    if (!_storageBlocked) { db.close(); db = _installCorruptionWatchdog(new SQL.Database(before)); }
    throw error;
  } finally { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; } }
}

process.on('exit', () => { _flushToDisk(); });
process.on('SIGINT', () => { _flushToDisk(); process.exit(0); });
process.on('SIGTERM', () => { _flushToDisk(); process.exit(0); });

// Settings
function getSetting(key) {
  const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  stmt.bind([key]);
  let value = null;
  if (stmt.step()) {
    value = stmt.getAsObject().value;
  }
  stmt.free();
  return value;
}

function setSetting(key, value) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  save();
}

function getAllSettings() {
  const rows = db.exec(`SELECT key, value FROM settings`);
  if (rows.length === 0) return {};
  const settings = {};
  for (const row of rows[0].values) {
    settings[row[0]] = row[1];
  }
  return settings;
}

// Game state
function getGameState() {
  const rows = db.exec(`SELECT * FROM game_state WHERE id = 1`);
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  const cols = rows[0].columns;
  const vals = rows[0].values[0];
  const state = {};
  for (let i = 0; i < cols.length; i++) {
    state[cols[i]] = vals[i];
  }
  state.guesses = JSON.parse(state.guesses);
  state.revealed_rows = JSON.parse(state.revealed_rows);
  return state;
}

function saveGameState(state) {
  db.run(`DELETE FROM game_state WHERE id = 1`);
  db.run(`INSERT INTO game_state (id, word, word_length, max_guesses, guesses, revealed_rows, status, started_at, ended_at, winner_platform, winner_user_id, winner_username)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    state.word,
    state.word_length,
    state.max_guesses,
    JSON.stringify(state.guesses),
    JSON.stringify(state.revealed_rows),
    state.status,
    state.started_at,
    state.ended_at || null,
    state.winner_platform || null,
    state.winner_user_id || null,
    state.winner_username || null
  ]);
  save();
}

function clearGameState() {
  db.run(`DELETE FROM game_state WHERE id = 1`);
  save();
}

// Game history
function addGameHistory(game) {
  db.run(`INSERT INTO game_history (word, word_length, guesses, status, winner_platform, winner_user_id, winner_username, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    game.word,
    game.word_length,
    JSON.stringify(game.guesses),
    game.status,
    game.winner_platform || null,
    game.winner_user_id || null,
    game.winner_username || null,
    game.started_at,
    game.ended_at
  ]);
  save();
}

function getRecentHistory(limit = 20) {
  const stmt = db.prepare(`SELECT * FROM game_history ORDER BY id DESC LIMIT ?`);
  stmt.bind([limit]);
  const results = [];
  while (stmt.step()) {
    const obj = stmt.getAsObject();
    obj.guesses = JSON.parse(obj.guesses);
    results.push(obj);
  }
  stmt.free();
  return results;
}

// User stats
function getOrCreateUserStats(platform, platformUserId, username, displayName) {
  const stmt = db.prepare(`SELECT * FROM user_stats WHERE platform = ? AND platform_user_id = ?`);
  stmt.bind([platform, platformUserId]);
  if (stmt.step()) {
    const stats = stmt.getAsObject();
    stmt.free();
    // Update username if changed
    if (stats.username !== username || stats.display_name !== displayName) {
      db.run(`UPDATE user_stats SET username = ?, display_name = ? WHERE platform = ? AND platform_user_id = ?`,
        [username, displayName || username, platform, platformUserId]);
      save();
    }
    return stats;
  }
  stmt.free();
  db.run(`INSERT INTO user_stats (platform, platform_user_id, username, display_name) VALUES (?, ?, ?, ?)`,
    [platform, platformUserId, username, displayName || username]);
  save();
  return { platform, platform_user_id: platformUserId, username, display_name: displayName || username,
    games_played: 0, games_won: 0, total_guesses: 0, current_streak: 0, best_streak: 0, last_played_at: null };
}

function recordGuess(platform, platformUserId, acceptedAt = new Date().toISOString()) {
  db.run(`UPDATE user_stats SET total_guesses = total_guesses + 1, last_played_at = ? WHERE platform = ? AND platform_user_id = ?`,
    [acceptedAt, platform, platformUserId]);
  save();
}

function recordGamePlayed(platform, platformUserId, won, acceptedAt = new Date().toISOString()) {
  if (won) {
    db.run(`UPDATE user_stats SET games_played = games_played + 1, games_won = games_won + 1,
      current_streak = current_streak + 1,
      best_streak = MAX(best_streak, current_streak + 1),
      last_played_at = ? WHERE platform = ? AND platform_user_id = ?`,
      [acceptedAt, platform, platformUserId]);
  } else {
    db.run(`UPDATE user_stats SET games_played = games_played + 1, current_streak = 0,
      last_played_at = ? WHERE platform = ? AND platform_user_id = ?`,
      [acceptedAt, platform, platformUserId]);
  }
  save();
}

function getLeaderboard(limit = 10) {
  const stmt = db.prepare(`SELECT * FROM user_stats ORDER BY games_won DESC, best_streak DESC LIMIT ?`);
  stmt.bind([limit]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getAllUserStats() {
  const rows = db.exec(`SELECT * FROM user_stats ORDER BY games_won DESC`);
  if (rows.length === 0) return [];
  return rows[0].values.map(vals => {
    const obj = {};
    rows[0].columns.forEach((col, i) => obj[col] = vals[i]);
    return obj;
  });
}

module.exports = {
  initialize, save, applyStatisticsReceipt, getSetting, setSetting, getAllSettings,
  getGameState, saveGameState, clearGameState,
  addGameHistory, getRecentHistory,
  getOrCreateUserStats, recordGuess, recordGamePlayed,
  getLeaderboard, getAllUserStats
};
