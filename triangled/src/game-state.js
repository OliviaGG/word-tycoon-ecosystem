/**
 * Player Game State
 *
 * Tracks per-player progress on the daily puzzle:
 * - Found words, hint progress, completion
 * - Uses sql.js for persistence
 */

const fs = require('fs');
const path = require('path');
const { TriangleGrid } = require('./grid');

let DB_PATH = path.join(__dirname, '..', 'data', 'triangled.db');

let db = null;

// --- sql.js WASM corruption watchdog ---
// sql.js keeps the whole DB in a WASM heap that can degrade over long uptime.
// Once corrupted, every query throws "memory access out of bounds" and the
// service stays silently dead until a manual restart. Detect it at the DB
// choke point, persist what we can, and exit so PM2 restarts us clean.
function _installCorruptionWatchdog(instance) {
  const bail = (err) => {
    console.error('[DB] sql.js WASM heap corrupted — persisting and exiting for PM2 restart:', err && err.message);
    try { saveDB(); } catch (_) {}
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
  instance.run = guard(instance.run.bind(instance));
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

function initDB(initSqlJs, options = {}) {
  if (options.filePath) DB_PATH = path.resolve(options.filePath);
  return initSqlJs().then(SQL => {
    let buffer = null;
    if (fs.existsSync(DB_PATH)) {
      buffer = fs.readFileSync(DB_PATH);
    }
    db = _installCorruptionWatchdog(buffer ? new SQL.Database(buffer) : new SQL.Database());

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT DEFAULT '',
        found_words TEXT DEFAULT '[]',
        hint_progress INTEGER DEFAULT 0,
        hints_used INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        completed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date, platform, user_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        total_players INTEGER DEFAULT 0,
        total_completions INTEGER DEFAULT 0,
        avg_hints_used REAL DEFAULT 0
      )
    `);

    saveDB();
    return db;
  });
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Player Progress ───────────────────────────────────────────────────

function getProgress(date, platform, userId) {
  if (!db) return null;
  const row = db.exec(
    `SELECT * FROM daily_progress WHERE date = ? AND platform = ? AND user_id = ?`,
    [date, platform, userId]
  );
  if (!row.length || !row[0].values.length) return null;

  const cols = row[0].columns;
  const vals = row[0].values[0];
  const obj = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  obj.found_words = JSON.parse(obj.found_words);
  return obj;
}

function createProgress(date, platform, userId, username) {
  if (!db) return null;
  db.run(
    `INSERT OR IGNORE INTO daily_progress (date, platform, user_id, username) VALUES (?, ?, ?, ?)`,
    [date, platform, userId, username || '']
  );
  saveDB();
  return getProgress(date, platform, userId);
}

function getOrCreateProgress(date, platform, userId, username) {
  let progress = getProgress(date, platform, userId);
  if (!progress) {
    progress = createProgress(date, platform, userId, username);
  }
  return progress;
}

// ── Word Submission ───────────────────────────────────────────────────

/**
 * Submit a word trace. Returns result object.
 * @param {string} date - puzzle date
 * @param {string} platform
 * @param {string} userId
 * @param {string} username
 * @param {Array} path - [[r,c], [r,c], ...] traced cells
 * @param {object} puzzleData - full puzzle with wordPaths
 * @returns {{ valid, word, type, alreadyFound, completed, hintEarned }}
 */
function submitWord(date, platform, userId, username, tracedPath, puzzleData, options = {}) {
  if (!Array.isArray(tracedPath) || tracedPath.length < 3 || tracedPath.length > 55
    || !tracedPath.every(cell => Array.isArray(cell) && cell.length === 2
      && Number.isInteger(cell[0]) && Number.isInteger(cell[1])
      && cell[0] >= 0 && cell[0] < 10 && cell[1] >= 0 && cell[1] <= cell[0]))
    return { valid: false, reason: 'invalid_path' };
  const progress = getOrCreateProgress(date, platform, userId, username);
  if (progress.completed) {
    return { valid: false, reason: 'already_completed' };
  }

  const grid = TriangleGrid.fromFlatString(puzzleData.gridString);

  // Validate the path is connected
  if (!grid.isConnectedPath(tracedPath)) {
    return { valid: false, reason: 'not_connected' };
  }

  // Read letters from the path
  const word = tracedPath.map(([r, c]) => grid.get(r, c)).join('').toLowerCase();
  if (word.length < 3) {
    return { valid: false, reason: 'too_short' };
  }

  // Check if the traced word matches any themed word or spangram
  const allThemeWords = [puzzleData.spangram, ...puzzleData.words];
  const isThemeWord = allThemeWords.includes(word);
  const isSpangram = word === puzzleData.spangram;

  const foundWords = progress.found_words;

  if (isThemeWord) {
    // Accept ANY valid path that spells a themed word.
    // Return the canonical answer path so the client highlights the correct cells.
    // Already found?
    if (foundWords.includes(word)) {
      return { valid: true, word, type: isSpangram ? 'spangram' : 'theme', alreadyFound: true };
    }

    // Mark as found
    foundWords.push(word);
    const completed = foundWords.length === allThemeWords.length;
    if (completed && options.beforeComplete) options.beforeComplete({ date, platform, userId, username, hintsUsed: progress.hints_used });

    db.run(
      `UPDATE daily_progress SET found_words = ?, completed = ?, completed_at = ?,
       updated_at = datetime('now') WHERE date = ? AND platform = ? AND user_id = ?`,
      [
        JSON.stringify(foundWords),
        completed ? 1 : 0,
        completed ? new Date().toISOString() : null,
        date, platform, userId
      ]
    );
    saveDB();

    // Return the canonical answer path (not the player's traced path)
    const answerPath = puzzleData.wordPaths[word];

    // Include per-word image URL if available
    let wordImageUrl = null;
    if (puzzleData.wordImages && puzzleData.wordImages[word]) {
      wordImageUrl = `/api/daily/images/${puzzleData.wordImages[word]}`;
    }

    return {
      valid: true,
      word,
      type: isSpangram ? 'spangram' : 'theme',
      alreadyFound: false,
      completed,
      wordsRemaining: allThemeWords.length - foundWords.length,
      answerPath,
      wordImageUrl
    };
  }

  // Not a themed word — check if it's a valid dictionary word (4+ letters for hint progress)
  // For now, we'll accept any 4+ letter non-theme word as hint progress
  // A proper dictionary check would use the word-bank API
  if (word.length >= 4) {
    const newHintProgress = progress.hint_progress + 1;
    const hintEarned = newHintProgress >= 3;

    db.run(
      `UPDATE daily_progress SET hint_progress = ?, updated_at = datetime('now')
       WHERE date = ? AND platform = ? AND user_id = ?`,
      [hintEarned ? 0 : newHintProgress, date, platform, userId]
    );
    saveDB();

    return {
      valid: true,
      word,
      type: 'bonus',
      hintProgress: hintEarned ? 0 : newHintProgress,
      hintEarned
    };
  }

  return { valid: false, reason: 'not_a_word', word };
}

// ── Hints ─────────────────────────────────────────────────────────────

function useHint(date, platform, userId, puzzleData) {
  const progress = getProgress(date, platform, userId);
  if (!progress) return { error: 'no_progress' };
  if (progress.completed) return { error: 'already_completed' };

  // Check if player has earned a hint via hint_progress resets
  // hints_used tracks total hints consumed
  const allThemeWords = [puzzleData.spangram, ...puzzleData.words];
  const foundWords = progress.found_words;
  const unfound = allThemeWords.filter(w => !foundWords.includes(w));

  if (unfound.length === 0) return { error: 'all_found' };

  // Reveal a random unfound word's cells
  const revealWord = unfound[Math.floor(Math.random() * unfound.length)];
  const revealPath = puzzleData.wordPaths[revealWord];

  db.run(
    `UPDATE daily_progress SET hints_used = hints_used + 1, updated_at = datetime('now')
     WHERE date = ? AND platform = ? AND user_id = ?`,
    [date, platform, userId]
  );
  saveDB();

  return {
    word: revealWord,
    cells: revealPath,
    isSpangram: revealWord === puzzleData.spangram,
    hintsUsed: progress.hints_used + 1
  };
}

// ── Stats ─────────────────────────────────────────────────────────────

function hasCompletedToday(date, platform, userId) {
  const progress = getProgress(date, platform, userId);
  return progress ? !!progress.completed : false;
}

function getDailyStats(date) {
  if (!db) return null;
  const row = db.exec(
    `SELECT COUNT(*) as players, SUM(completed) as completions, AVG(CASE WHEN completed = 1 THEN hints_used END) as avg_hints
     FROM daily_progress WHERE date = ?`,
    [date]
  );
  if (!row.length || !row[0].values.length) return { players: 0, completions: 0, avgHints: 0 };
  const [players, completions, avgHints] = row[0].values[0];
  return { players: players || 0, completions: completions || 0, avgHints: avgHints || 0 };
}

module.exports = {
  initDB,
  saveDB,
  get db() { return db; },
  getProgress,
  getOrCreateProgress,
  submitWord,
  useHint,
  hasCompletedToday,
  getDailyStats
};
