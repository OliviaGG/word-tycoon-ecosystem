// database.js - sql.js database for RecTangled (CommonJS)

const path = require('path');
const fs = require('fs');

let db = null;
let SQL = null;

const DB_PATH = path.join(__dirname, '..', 'data', 'rectangled.db');

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

async function init() {
    SQL = await require('sql.js')();

    // Load existing DB or create new
    let buffer = null;
    if (fs.existsSync(DB_PATH)) {
        buffer = fs.readFileSync(DB_PATH);
    }

    db = _installCorruptionWatchdog(buffer ? new SQL.Database(buffer) : new SQL.Database());

    // Create tables
    db.run(`CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grid_json TEXT,
        rows INTEGER,
        cols INTEGER,
        total_words INTEGER,
        words_found INTEGER,
        status TEXT DEFAULT 'active',
        participants_json TEXT,
        started_at INTEGER,
        ended_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS game_state (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    save();
    return db;
}

// Debounced save — coalesces rapid writes into a single disk flush
let _saveTimer = null;
const SAVE_DELAY = 1000;

function save() {
    if (!db) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushToDisk, SAVE_DELAY);
}

function _flushToDisk() {
    if (!db) return;
    _saveTimer = null;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
        console.error('[DB] Save error:', err.message);
    }
}

process.on('exit', () => { _flushToDisk(); });
process.on('SIGINT', () => { _flushToDisk(); process.exit(0); });
process.on('SIGTERM', () => { _flushToDisk(); process.exit(0); });

/**
 * Save a completed game to history.
 */
function saveGameHistory(data) {
    if (!db) return;
    db.run(
        `INSERT INTO game_history (grid_json, rows, cols, total_words, words_found, status, participants_json, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            JSON.stringify(data.grid),
            data.rows,
            data.cols,
            data.totalWords,
            data.wordsFound,
            data.wordsFound >= data.totalWords ? 'complete' : 'incomplete',
            JSON.stringify(data.participants || []),
            data.startedAt || Date.now(),
            data.endedAt || Date.now()
        ]
    );
    save();
}

/**
 * Get recent game history.
 */
function getRecentHistory(limit = 100) {
    if (!db) return [];
    const stmt = db.prepare(`SELECT * FROM game_history ORDER BY ended_at DESC LIMIT ?`);
    stmt.bind([limit]);
    const results = [];
    while (stmt.step()) {
        const obj = stmt.getAsObject();
        try { obj.grid_json = JSON.parse(obj.grid_json); } catch {}
        try { obj.participants_json = JSON.parse(obj.participants_json); } catch {}
        results.push(obj);
    }
    stmt.free();
    return results;
}

/**
 * Save the current game state (UPSERT into game_state key='current_game').
 */
function saveGameState(state) {
    if (!db) return;
    db.run(`INSERT OR REPLACE INTO game_state (key, value) VALUES (?, ?)`, [
        'current_game',
        JSON.stringify(state)
    ]);
    save();
}

/**
 * Load the current game state.
 */
function loadGameState() {
    if (!db) return null;
    const stmt = db.prepare(`SELECT value FROM game_state WHERE key = ?`);
    stmt.bind(['current_game']);
    let result = null;
    if (stmt.step()) {
        const row = stmt.getAsObject();
        try { result = JSON.parse(row.value); } catch {}
    }
    stmt.free();
    return result;
}

/**
 * Clear the saved game state.
 */
function clearGameState() {
    if (!db) return;
    db.run(`DELETE FROM game_state WHERE key = ?`, ['current_game']);
    save();
}

module.exports = { init, save, saveGameHistory, getRecentHistory, saveGameState, loadGameState, clearGameState };
