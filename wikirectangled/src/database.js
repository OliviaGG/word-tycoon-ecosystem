// database.js - sql.js persistence for WiKirecTangled.
//
// Schema is round-centric: every round is a row, every guess + every player
// aggregate fans out from there, and a separate leaderboard table holds
// cross-round totals so /api/leaderboard is a single SELECT.
//
// Identity uses the same key shape RecTangled uses ("platform:platformUserId",
// e.g. "discord:123…", "web:UNZxH_…"). Until Roadmap #2 lands, web players are
// keyed by socket.id — that means each browser tab is a distinct row in the
// leaderboard. Documented; swap when session-manager arrives.

const path = require('path');
const fs = require('fs');
const { writeFileAtomicSync } = require('./atomic-write');
const { createPersistenceState } = require('./persistence-state');

let db = null;
let SQL = null;
const persistenceState = createPersistenceState();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wikirectangled.db');
const DB_BACKUP_PATH = process.env.DB_BACKUP_PATH || `${DB_PATH}.bak`;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS browser_action_receipts (scope TEXT NOT NULL, action_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, accepted_at INTEGER NOT NULL, PRIMARY KEY(scope,action_id))`,
  `CREATE TABLE IF NOT EXISTS reward_intentions (event_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, accepted_at INTEGER NOT NULL, queued_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS rounds (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     article_title TEXT NOT NULL,
     article_key TEXT NOT NULL,
     rows INTEGER NOT NULL,
     cols INTEGER NOT NULL,
     grid_json TEXT NOT NULL,
     targets_json TEXT NOT NULL,
     title_words_json TEXT NOT NULL,
     total_grid_words INTEGER,
     status TEXT NOT NULL DEFAULT 'active',
     started_at INTEGER NOT NULL,
     ended_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS participants (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     round_id INTEGER NOT NULL,
     identity_key TEXT NOT NULL,
     display_name TEXT,
     profile_image TEXT,
     platform TEXT,
     score INTEGER NOT NULL DEFAULT 0,
     xp INTEGER NOT NULL DEFAULT 0,
     word_count INTEGER NOT NULL DEFAULT 0,
     target_count INTEGER NOT NULL DEFAULT 0,
     title_word_count INTEGER NOT NULL DEFAULT 0,
     final_rank INTEGER,
     UNIQUE(round_id, identity_key)
   )`,
  `CREATE TABLE IF NOT EXISTS found_words (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     round_id INTEGER NOT NULL,
     identity_key TEXT NOT NULL,
     word TEXT NOT NULL,
     points INTEGER NOT NULL,
     is_target INTEGER NOT NULL DEFAULT 0,
     is_title_word INTEGER NOT NULL DEFAULT 0,
     target_position INTEGER,
     found_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS leaderboard (
     identity_key TEXT PRIMARY KEY,
     display_name TEXT,
     profile_image TEXT,
     platform TEXT,
     total_score INTEGER NOT NULL DEFAULT 0,
     total_xp INTEGER NOT NULL DEFAULT 0,
     total_rounds INTEGER NOT NULL DEFAULT 0,
     total_wins INTEGER NOT NULL DEFAULT 0,
     total_targets INTEGER NOT NULL DEFAULT 0,
     total_title_words INTEGER NOT NULL DEFAULT 0,
     total_words INTEGER NOT NULL DEFAULT 0,
     last_played_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_found_words_round ON found_words(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_found_words_identity ON found_words(identity_key)`,
  `CREATE INDEX IF NOT EXISTS idx_participants_round ON participants(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_participants_identity ON participants(identity_key)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     session_id TEXT PRIMARY KEY,
     identity_key TEXT NOT NULL,
     platform TEXT NOT NULL,
     platform_user_id TEXT NOT NULL,
     display_name TEXT,
     profile_image TEXT,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_identity ON sessions(identity_key)`,
];

// --- sql.js WASM corruption watchdog ---
// sql.js keeps the whole DB in a WASM heap that can degrade over long uptime.
// Once corrupted, every query throws "memory access out of bounds" and the
// service stays silently dead until a manual restart. Detect it at the DB
// choke point and exit so PM2 restarts us clean. Never export a known-bad
// WASM heap: preserving the last good disk image is safer than replacing it
// with bytes from corrupted memory.
function _installCorruptionWatchdog(instance) {
  const bail = (err) => {
    if (!persistenceState.markUnsafe(err)) return;
    console.error('[DB] sql.js WASM heap corrupted — preserving disk image and exiting for PM2 restart:', err && err.message);
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
  let buffer = null;
  if (fs.existsSync(DB_PATH)) {
    buffer = fs.readFileSync(DB_PATH);
  }
  db = _installCorruptionWatchdog(buffer ? new SQL.Database(buffer) : new SQL.Database());
  for (const stmt of SCHEMA) db.run(stmt);

  // Lazy schema migrations (additive only — sql.js handles ALTER ADD COLUMN).
  // Each block silently no-ops if the column already exists. Add new ones here
  // rather than mutating the SCHEMA constant so existing DBs keep working.
  const migrations = [
    `ALTER TABLE rounds ADD COLUMN room_handle TEXT`,
    `ALTER TABLE rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'public'`,
    `ALTER TABLE daily_puzzles ADD COLUMN total_ranked_words INTEGER`,
    `ALTER TABLE daily_puzzles ADD COLUMN rank_target TEXT`,
    `CREATE TABLE IF NOT EXISTS daily_puzzles (
       puzzle_date TEXT PRIMARY KEY,
       article_key TEXT NOT NULL,
       article_title TEXT NOT NULL,
       rows INTEGER NOT NULL,
       cols INTEGER NOT NULL,
       grid_json TEXT NOT NULL,
       targets_json TEXT NOT NULL,
       title_words_json TEXT NOT NULL,
       article_plaintext TEXT NOT NULL,
       total_grid_words INTEGER,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS solo_runs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       identity_key TEXT NOT NULL,
       mode TEXT NOT NULL,
       puzzle_date TEXT,
       article_title TEXT,
       score INTEGER NOT NULL DEFAULT 0,
       xp INTEGER NOT NULL DEFAULT 0,
       word_count INTEGER NOT NULL DEFAULT 0,
       target_count INTEGER NOT NULL DEFAULT 0,
       title_word_count INTEGER NOT NULL DEFAULT 0,
       total_targets INTEGER NOT NULL DEFAULT 0,
       total_title_words INTEGER NOT NULL DEFAULT 0,
       status TEXT NOT NULL DEFAULT 'active',
       started_at INTEGER NOT NULL,
       ended_at INTEGER
     )`,
    `CREATE TABLE IF NOT EXISTS daily_personal_best (
       identity_key TEXT NOT NULL,
       puzzle_date TEXT NOT NULL,
       best_score INTEGER NOT NULL,
       word_count INTEGER NOT NULL,
       target_count INTEGER NOT NULL,
       title_word_count INTEGER NOT NULL,
       achieved_at INTEGER NOT NULL,
       PRIMARY KEY (identity_key, puzzle_date)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_solo_runs_identity ON solo_runs(identity_key)`,
    `CREATE INDEX IF NOT EXISTS idx_solo_runs_date ON solo_runs(puzzle_date)`,
    `ALTER TABLE rounds ADD COLUMN state_json TEXT`,
    `ALTER TABLE solo_runs ADD COLUMN state_json TEXT`,
    `ALTER TABLE solo_runs ADD COLUMN payload_json TEXT`,
    `ALTER TABLE rounds ADD COLUMN article_plaintext TEXT`,
  ];
  for (const m of migrations) {
    try { db.run(m); } catch (e) { /* duplicate column / table = already migrated */ }
  }

  const integrity = db.exec('PRAGMA quick_check');
  const integrityResult = integrity[0] && integrity[0].values[0] && integrity[0].values[0][0];
  if (integrityResult !== 'ok') {
    throw new Error(`database quick_check failed: ${integrityResult || 'no result'}`);
  }

  // Refresh one independently replaceable recovery point only after the disk
  // image has loaded and passed SQLite's own structural check. A corrupt live
  // file fails above and cannot overwrite this backup on a restart loop.
  try {
    const backupData = buffer || Buffer.from(db.export());
    writeFileAtomicSync(DB_BACKUP_PATH, backupData, {
      tmpPath: `${DB_BACKUP_PATH}.tmp-${process.pid}`,
      validateTmp(_tmpPath, stat) {
        if (stat.size < 100 || backupData.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') {
          throw new Error('refusing to replace last-known-good backup with an invalid SQLite image');
        }
      },
    });
    console.log(`[DB] Last-known-good backup refreshed at ${DB_BACKUP_PATH}`);
  } catch (e) {
    console.error(`[DB] backup refresh failed: ${e.message}`);
  }

  // Active rounds + solo runs are intentionally left in place at boot — the
  // server resume path (server.js) hydrates them back into memory. Any that
  // can't be resumed get marked abandoned individually via abandonRound() /
  // abandonSoloRun().
  const activeR = db.exec(`SELECT COUNT(*) FROM rounds WHERE status = 'active'`);
  const activeS = db.exec(`SELECT COUNT(*) FROM solo_runs WHERE status = 'active'`);
  const aR = activeR[0] ? activeR[0].values[0][0] : 0;
  const aS = activeS[0] ? activeS[0].values[0][0] : 0;
  if (aR + aS > 0) {
    console.log(`[DB] ${aR} active round(s) + ${aS} active solo run(s) pending resume`);
  }

  flushNow();
  console.log(`[DB] Initialized at ${DB_PATH}`);
  return db;
}

// Debounced save — coalesces rapid writes into one disk flush.
let flushTimer = null;
const FLUSH_DELAY_MS = 5000;

function scheduleFlush() {
  if (!db || !persistenceState.canFlush()) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, FLUSH_DELAY_MS);
}

function flushNow() {
  if (!db || !persistenceState.canFlush()) return false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    const data = Buffer.from(db.export());
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    writeFileAtomicSync(DB_PATH, data, {
      tmpPath: `${DB_PATH}.tmp-${process.pid}`,
      strictDirectorySync: true,
      validateTmp(_tmpPath, stat) {
        if (stat.size < 100 || data.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') {
          throw new Error('refusing to replace database with an invalid SQLite export');
        }
      },
    });
    return true;
  } catch (e) {
    console.error(`[DB] flush failed: ${e.message}`);
    return false;
  }
}

// Synchronous: no other socket/database mutation can interleave between the
// before-image, accepted state and its fsynced SQLite export. Any save failure
// blocks subsequent durable actions until restart; no success is acknowledged.
function durable(callback) {
  if (!db || !persistenceState.canFlush()) throw Error('durable_storage_unavailable');
  if (callback.constructor.name === 'AsyncFunction') throw Error('durable callback must be synchronous');
  const before = db.export();
  let saving = false;
  try {
    const result = callback();
    if (result && typeof result.then === 'function') throw Error('durable callback must be synchronous');
    saving = true;
    if (!flushNow()) throw Error('durable_storage_unavailable');
    return result;
  } catch (error) {
    db.close(); db = new SQL.Database(before); _installCorruptionWatchdog(db);
    if (saving) persistenceState.markUnsafe(error);
    throw error;
  }
}
function getActionReceipt(scope,actionId,fingerprint) {
  if(!actionId)return null;
  if(!/^[a-f0-9-]{36}(?::[0-9]{1,2})?$/.test(actionId))throw Error('invalid_action_id');
  const rows=db.exec('SELECT fingerprint,result_json FROM browser_action_receipts WHERE scope = ? AND action_id = ?',[scope,actionId]);
  if(!rows.length)return null;
  if(rows[0].values[0][0]!==fingerprint)throw Error('action_id_reused');
  return JSON.parse(rows[0].values[0][1]);
}
function saveActionReceipt(scope,actionId,fingerprint,result) {
  if(!actionId)return;
  getActionReceipt(scope,actionId,fingerprint);
  const count=db.exec('SELECT COUNT(*) FROM browser_action_receipts WHERE scope = ?',[scope])[0].values[0][0];
  if(count>=10000)throw Error('action_receipt_capacity');
  db.run('INSERT OR IGNORE INTO browser_action_receipts(scope,action_id,fingerprint,result_json,accepted_at) VALUES(?,?,?,?,?)',[scope,actionId,fingerprint,JSON.stringify(result),Date.now()]);
}

function reserveRewardIntention(payload) {
  if (!db || !payload || typeof payload.eventId !== 'string') throw Error('invalid reward intention');
  const text = JSON.stringify(payload);
  const existing = db.exec('SELECT payload_json FROM reward_intentions WHERE event_id = ?', [payload.eventId]);
  if (existing.length && existing[0].values[0][0] !== text) throw Error('changed reward intention');
  db.run('INSERT OR IGNORE INTO reward_intentions(event_id,payload_json,accepted_at) VALUES(?,?,?)',[payload.eventId,text,Date.now()]);
}
function pendingRewardIntentions(limit = 25) {
  if (!db || !persistenceState.canFlush()) return [];
  const result = db.exec('SELECT payload_json FROM reward_intentions WHERE queued_at IS NULL ORDER BY accepted_at,event_id LIMIT ?', [Math.min(25,Math.max(1,limit))]);
  return result.length ? result[0].values.map(row => JSON.parse(row[0])) : [];
}
function markRewardQueued(eventId) { db.run('UPDATE reward_intentions SET queued_at = ? WHERE event_id = ? AND queued_at IS NULL',[Date.now(),eventId]); }
// The queued flag only means "the fsynced reward outbox owns this now". Losing
// it in a crash just repeats an idempotent outbox reserve on the next boot, so
// it rides the debounced flush instead of forcing its own full-image save.
const REWARD_INTENTION_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
let lastIntentionPruneAt = 0;
function markRewardsQueued(eventIds) {
  if (!db || !eventIds || !eventIds.length) return;
  for (const eventId of eventIds) markRewardQueued(eventId);
  if (Date.now() - lastIntentionPruneAt > 60 * 60 * 1000) {
    lastIntentionPruneAt = Date.now();
    db.run('DELETE FROM reward_intentions WHERE queued_at IS NOT NULL AND queued_at < ?', [Date.now() - REWARD_INTENTION_RETENTION_MS]);
  }
  scheduleFlush();
}
function rewardIntentionSummary() {
  if (!db) return {records:0,pending:0,blocked:true};
  const rows=db.exec('SELECT COUNT(*),SUM(queued_at IS NULL),MIN(CASE WHEN queued_at IS NULL THEN accepted_at END) FROM reward_intentions');
  const [records,pending,oldest]=rows[0].values[0];
  return {records,pending:pending||0,oldestAcceptedAt:oldest,blocked:!persistenceState.canFlush()};
}

let shutdownFlushed = false;
function flushOnShutdown() {
  if (shutdownFlushed) return;
  shutdownFlushed = true;
  flushNow();
}

process.on('exit', flushOnShutdown);
process.on('SIGINT', () => { flushOnShutdown(); process.exit(0); });
process.on('SIGTERM', () => { flushOnShutdown(); process.exit(0); });

// ---- Round lifecycle ---------------------------------------------------------

function insertRound(round) {
  if (!db) return null;
  db.run(
    `INSERT INTO rounds (article_title, article_key, rows, cols, grid_json, targets_json, title_words_json, total_grid_words, status, started_at, room_handle, mode, article_plaintext)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [
      round.articleTitle,
      round.articleKey,
      round.rows,
      round.cols,
      JSON.stringify(round.grid),
      JSON.stringify(round.targets),
      JSON.stringify(round.titleWords),
      round.totalGridWords || 0,
      Date.now(),
      round.roomHandle || null,
      round.mode || 'public',
      round.articlePlaintext || '',
    ],
  );
  const r = db.exec(`SELECT last_insert_rowid() AS id`);
  scheduleFlush();
  return r[0].values[0][0];
}

function endRound(roundId, status, participants) {
  if (!db || !roundId) return;
  // state_json is only read back for status='active' rows (getActiveRounds),
  // so drop it once a round is over — it was 92MB of the 142MB image that every
  // durable() exports and fsyncs on the main thread.
  db.run(`UPDATE rounds SET status = ?, ended_at = ?, state_json = CASE WHEN ? = 'active' THEN state_json ELSE NULL END WHERE id = ?`,
         [status, Date.now(), status, roundId]);

  // Re-rank by score (desc); store final_rank per participant.
  const ranked = [...(participants || [])].sort((a, b) => b.score - a.score);
  ranked.forEach((p, idx) => {
    p.finalRank = idx + 1;
    db.run(
      `UPDATE participants
         SET display_name = ?, profile_image = ?, platform = ?,
             score = ?, xp = ?, word_count = ?, target_count = ?, title_word_count = ?,
             final_rank = ?
         WHERE round_id = ? AND identity_key = ?`,
      [
        p.displayName, p.profileImage, p.platform,
        p.score, p.xp, p.wordCount, p.targetCount, p.titleWordCount,
        p.finalRank, roundId, p.identityKey,
      ],
    );
  });

  // Roll into the cross-round leaderboard.
  const winnerKey = ranked[0] ? ranked[0].identityKey : null;
  for (const p of ranked) {
    db.run(
      `INSERT INTO leaderboard (identity_key, display_name, profile_image, platform,
                                 total_score, total_xp, total_rounds, total_wins,
                                 total_targets, total_title_words, total_words, last_played_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(identity_key) DO UPDATE SET
         display_name = excluded.display_name,
         profile_image = COALESCE(excluded.profile_image, leaderboard.profile_image),
         platform = excluded.platform,
         total_score = leaderboard.total_score + excluded.total_score,
         total_xp = leaderboard.total_xp + excluded.total_xp,
         total_rounds = leaderboard.total_rounds + 1,
         total_wins = leaderboard.total_wins + excluded.total_wins,
         total_targets = leaderboard.total_targets + excluded.total_targets,
         total_title_words = leaderboard.total_title_words + excluded.total_title_words,
         total_words = leaderboard.total_words + excluded.total_words,
         last_played_at = excluded.last_played_at`,
      [
        p.identityKey, p.displayName, p.profileImage, p.platform,
        p.score, p.xp, (p.identityKey === winnerKey ? 1 : 0),
        p.targetCount, p.titleWordCount, p.wordCount, Date.now(),
      ],
    );
  }
  scheduleFlush();
}

// Upsert a participant row mid-round so partial credit survives a crash.
function upsertParticipant(roundId, p) {
  if (!db || !roundId) return;
  db.run(
    `INSERT INTO participants (round_id, identity_key, display_name, profile_image, platform,
                                score, xp, word_count, target_count, title_word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_id, identity_key) DO UPDATE SET
       display_name = excluded.display_name,
       profile_image = COALESCE(excluded.profile_image, participants.profile_image),
       platform = excluded.platform,
       score = excluded.score,
       xp = excluded.xp,
       word_count = excluded.word_count,
       target_count = excluded.target_count,
       title_word_count = excluded.title_word_count`,
    [
      roundId, p.identityKey, p.displayName, p.profileImage, p.platform,
      p.score, p.xp, p.wordCount, p.targetCount, p.titleWordCount,
    ],
  );
  scheduleFlush();
}

function recordFind(roundId, find) {
  if (!db || !roundId) return;
  db.run(
    `INSERT INTO found_words (round_id, identity_key, word, points, is_target, is_title_word, target_position, found_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      roundId, find.identityKey, find.word, find.points,
      find.isTarget ? 1 : 0, find.isTitleWord ? 1 : 0,
      find.targetPosition || null, find.foundAt || Date.now(),
    ],
  );
  scheduleFlush();
}

// ---- Read endpoints ----------------------------------------------------------

function getLeaderboard(limit = 50) {
  if (!db) return [];
  const stmt = db.prepare(
    `SELECT identity_key, display_name, profile_image, platform,
            total_score, total_xp, total_rounds, total_wins,
            total_targets, total_title_words, total_words, last_played_at
       FROM leaderboard
      ORDER BY total_score DESC
      LIMIT ?`,
  );
  stmt.bind([limit]);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function getRecentRounds(limit = 25) {
  if (!db) return [];
  const stmt = db.prepare(
    `SELECT id, article_title, article_key, rows, cols, total_grid_words, status,
            started_at, ended_at, room_handle, mode
       FROM rounds
      ORDER BY started_at DESC
      LIMIT ?`,
  );
  stmt.bind([limit]);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function getRoundDetail(roundId) {
  if (!db || !roundId) return null;
  const rstmt = db.prepare(`SELECT * FROM rounds WHERE id = ?`);
  rstmt.bind([roundId]);
  let round = null;
  if (rstmt.step()) round = rstmt.getAsObject();
  rstmt.free();
  if (!round) return null;
  try { round.grid = JSON.parse(round.grid_json); } catch {}
  try { round.targets = JSON.parse(round.targets_json); } catch {}
  try { round.titleWords = JSON.parse(round.title_words_json); } catch {}

  const pstmt = db.prepare(
    `SELECT identity_key, display_name, profile_image, platform,
            score, xp, word_count, target_count, title_word_count, final_rank
       FROM participants WHERE round_id = ? ORDER BY score DESC`,
  );
  pstmt.bind([roundId]);
  const participants = [];
  while (pstmt.step()) participants.push(pstmt.getAsObject());
  pstmt.free();

  const fstmt = db.prepare(
    `SELECT identity_key, word, points, is_target, is_title_word, target_position, found_at
       FROM found_words WHERE round_id = ? ORDER BY found_at ASC`,
  );
  fstmt.bind([roundId]);
  const foundWords = [];
  while (fstmt.step()) foundWords.push(fstmt.getAsObject());
  fstmt.free();

  return { round, participants, foundWords };
}

function getStats() {
  if (!db) return null;
  // Sourced from raw event tables (found_words / participants) so mid-round
  // play is visible — leaderboard alone only updates at endRound.
  const r = db.exec(
    `SELECT
       (SELECT COUNT(*) FROM rounds) AS total_rounds,
       (SELECT COUNT(*) FROM rounds WHERE status = 'complete') AS completed_rounds,
       (SELECT COUNT(DISTINCT identity_key) FROM participants) AS total_players,
       (SELECT COUNT(*) FROM found_words) AS total_finds,
       (SELECT COALESCE(SUM(points), 0) FROM found_words) AS total_score,
       (SELECT COUNT(*) FROM found_words WHERE is_target = 1) AS total_target_finds,
       (SELECT COUNT(*) FROM found_words WHERE is_title_word = 1) AS total_title_reveals`,
  );
  if (!r.length) return null;
  const cols = r[0].columns;
  const vals = r[0].values[0];
  const out = {};
  cols.forEach((c, i) => { out[c] = vals[i]; });
  return out;
}

// ---- Session/identity persistence -------------------------------------------

function getSessionById(sessionId) {
  if (!db || !sessionId) return null;
  const stmt = db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
  stmt.bind([sessionId]);
  let out = null;
  if (stmt.step()) out = stmt.getAsObject();
  stmt.free();
  return out;
}

function findSessionByIdentity(identityKey) {
  if (!db || !identityKey) return null;
  const stmt = db.prepare(`SELECT * FROM sessions WHERE identity_key = ? LIMIT 1`);
  stmt.bind([identityKey]);
  let out = null;
  if (stmt.step()) out = stmt.getAsObject();
  stmt.free();
  return out;
}

function upsertSession(s) {
  if (!db || !s.sessionId) return;
  db.run(
    `INSERT INTO sessions (session_id, identity_key, platform, platform_user_id, display_name, profile_image, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       identity_key = excluded.identity_key,
       platform = excluded.platform,
       platform_user_id = excluded.platform_user_id,
       display_name = COALESCE(excluded.display_name, sessions.display_name),
       profile_image = COALESCE(excluded.profile_image, sessions.profile_image),
       last_seen_at = excluded.last_seen_at`,
    [
      s.sessionId, s.identityKey, s.platform, s.platformUserId,
      s.displayName || null, s.profileImage || null,
      s.createdAt || Date.now(), s.lastSeenAt || Date.now(),
    ],
  );
  scheduleFlush();
}

function touchSession(sessionId) {
  if (!db || !sessionId) return;
  db.run(`UPDATE sessions SET last_seen_at = ? WHERE session_id = ?`, [Date.now(), sessionId]);
  scheduleFlush();
}

// ---- Daily puzzles ----------------------------------------------------------

function getDailyPuzzle(puzzleDate) {
  if (!db || !puzzleDate) return null;
  const stmt = db.prepare(`SELECT * FROM daily_puzzles WHERE puzzle_date = ?`);
  stmt.bind([puzzleDate]);
  let out = null;
  if (stmt.step()) out = stmt.getAsObject();
  stmt.free();
  if (!out) return null;
  try { out.grid = JSON.parse(out.grid_json); } catch {}
  try { out.targets = JSON.parse(out.targets_json); } catch {}
  try { out.titleWords = JSON.parse(out.title_words_json); } catch {}
  out.total_ranked_words = out.total_ranked_words || 0;
  out.rank_target = out.rank_target || null;
  return out;
}

function saveDailyPuzzle(puzzle) {
  if (!db || !puzzle.puzzleDate) return;
  db.run(
    `INSERT OR REPLACE INTO daily_puzzles (puzzle_date, article_key, article_title, rows, cols,
       grid_json, targets_json, title_words_json, article_plaintext, total_grid_words, total_ranked_words, rank_target, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      puzzle.puzzleDate, puzzle.articleKey, puzzle.articleTitle,
      puzzle.rows, puzzle.cols,
      JSON.stringify(puzzle.grid), JSON.stringify(puzzle.targets), JSON.stringify(puzzle.titleWords),
      puzzle.articlePlaintext || '', puzzle.totalGridWords || 0, puzzle.totalRankedWords || 0, puzzle.rankTarget || '', Date.now(),
    ],
  );
  scheduleFlush();
}

// ---- Solo runs --------------------------------------------------------------

function startSoloRun(run) {
  if (!db) return null;
  db.run(
    `INSERT INTO solo_runs (identity_key, mode, puzzle_date, article_title, total_targets, total_title_words, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      run.identityKey, run.mode, run.puzzleDate || null, run.articleTitle || null,
      run.totalTargets || 0, run.totalTitleWords || 0, Date.now(),
    ],
  );
  const r = db.exec(`SELECT last_insert_rowid() AS id`);
  scheduleFlush();
  return r[0].values[0][0];
}

function updateSoloRun(id, fields) {
  if (!db || !id) return;
  db.run(
    `UPDATE solo_runs SET score = ?, xp = ?, word_count = ?, target_count = ?, title_word_count = ?
       WHERE id = ?`,
    [
      fields.score || 0, fields.xp || 0,
      fields.wordCount || 0, fields.targetCount || 0, fields.titleWordCount || 0,
      id,
    ],
  );
  scheduleFlush();
}

function endSoloRun(id, status, fields) {
  if (!db || !id) return;
  db.run(
    `UPDATE solo_runs SET status = ?, ended_at = ?,
       score = ?, xp = ?, word_count = ?, target_count = ?, title_word_count = ?
     WHERE id = ?`,
    [
      status, Date.now(),
      fields.score || 0, fields.xp || 0,
      fields.wordCount || 0, fields.targetCount || 0, fields.titleWordCount || 0,
      id,
    ],
  );
  scheduleFlush();
}

// Bump personal best if this run beat the player's prior best for this day.
function maybeUpdateDailyPB(identityKey, puzzleDate, fields) {
  if (!db || !identityKey || !puzzleDate) return false;
  const stmt = db.prepare(`SELECT best_score FROM daily_personal_best WHERE identity_key = ? AND puzzle_date = ?`);
  stmt.bind([identityKey, puzzleDate]);
  let prev = -1;
  if (stmt.step()) prev = stmt.getAsObject().best_score;
  stmt.free();
  if (fields.score <= prev) return false;
  db.run(
    `INSERT OR REPLACE INTO daily_personal_best (identity_key, puzzle_date, best_score, word_count, target_count, title_word_count, achieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      identityKey, puzzleDate,
      fields.score || 0,
      fields.wordCount || 0, fields.targetCount || 0, fields.titleWordCount || 0,
      Date.now(),
    ],
  );
  scheduleFlush();
  return true;
}

function getDailyLeaderboard(puzzleDate, limit = 50) {
  if (!db) return [];
  const stmt = db.prepare(
    `SELECT b.identity_key, b.best_score, b.word_count, b.target_count, b.title_word_count, b.achieved_at,
            s.display_name, s.profile_image, s.platform
       FROM daily_personal_best b
       LEFT JOIN sessions s ON s.identity_key = b.identity_key
      WHERE b.puzzle_date = ?
      ORDER BY b.best_score DESC
      LIMIT ?`,
  );
  stmt.bind([puzzleDate, limit]);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function getDailyPB(identityKey, puzzleDate) {
  if (!db || !identityKey || !puzzleDate) return null;
  const stmt = db.prepare(`SELECT * FROM daily_personal_best WHERE identity_key = ? AND puzzle_date = ?`);
  stmt.bind([identityKey, puzzleDate]);
  let out = null;
  if (stmt.step()) out = stmt.getAsObject();
  stmt.free();
  return out;
}

function getRecentSoloRuns(identityKey, limit = 20) {
  if (!db || !identityKey) return [];
  const stmt = db.prepare(
    `SELECT id, mode, puzzle_date, article_title, score, xp, word_count, target_count, title_word_count,
            total_targets, total_title_words, status, started_at, ended_at
       FROM solo_runs WHERE identity_key = ?
      ORDER BY started_at DESC LIMIT ?`,
  );
  stmt.bind([identityKey, limit]);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

// ---- Resume support ---------------------------------------------------------

function updateRoundState(roundId, blob) {
  if (!db || !roundId) return;
  db.run(`UPDATE rounds SET state_json = ? WHERE id = ?`, [blob || null, roundId]);
  scheduleFlush();
}

function updateSoloRunState(runId, blob) {
  if (!db || !runId) return;
  db.run(`UPDATE solo_runs SET state_json = ? WHERE id = ?`, [blob || null, runId]);
  scheduleFlush();
}

function setSoloRunPayload(runId, blob) {
  if (!db || !runId) return;
  db.run(`UPDATE solo_runs SET payload_json = ? WHERE id = ?`, [blob || null, runId]);
  scheduleFlush();
}

function getActiveRounds() {
  if (!db) return [];
  const stmt = db.prepare(`SELECT id, article_title, article_key, rows, cols,
                                  grid_json, targets_json, title_words_json,
                                  total_grid_words, status, started_at,
                                  room_handle, mode, state_json, article_plaintext
                             FROM rounds WHERE status = 'active'
                            ORDER BY id ASC`);
  const out = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    try { r.grid = JSON.parse(r.grid_json); } catch {}
    try { r.targets = JSON.parse(r.targets_json); } catch {}
    try { r.titleWords = JSON.parse(r.title_words_json); } catch {}
    try { r.state = r.state_json ? JSON.parse(r.state_json) : null; } catch { r.state = null; }
    out.push(r);
  }
  stmt.free();
  return out;
}

function getActiveSoloRuns() {
  if (!db) return [];
  const stmt = db.prepare(`SELECT id, identity_key, mode, puzzle_date, article_title,
                                  score, xp, word_count, target_count, title_word_count,
                                  total_targets, total_title_words, status, started_at,
                                  state_json, payload_json
                             FROM solo_runs WHERE status = 'active'
                            OR (status = 'complete' AND mode = 'daily' AND puzzle_date = ? AND id IN (SELECT MAX(id) FROM solo_runs WHERE mode = 'daily' AND status = 'complete' GROUP BY identity_key,puzzle_date))
                            ORDER BY id ASC`);
  stmt.bind([new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())]);
  const out = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    try { r.state = r.state_json ? JSON.parse(r.state_json) : null; } catch { r.state = null; }
    try { r.payload = r.payload_json ? JSON.parse(r.payload_json) : null; } catch { r.payload = null; }
    out.push(r);
  }
  stmt.free();
  return out;
}

function getSoloRunForOwner(identityKey,mode,puzzleDate=null) {
  const rows=db.exec(`SELECT * FROM solo_runs WHERE identity_key = ? AND mode = ?
    AND (status = 'active' OR (status = 'complete' AND mode = 'daily'))
    AND (? IS NULL OR puzzle_date = ?) ORDER BY id DESC LIMIT 1`,[identityKey,mode,puzzleDate,puzzleDate]);
  if(!rows.length)return null;
  const row=Object.fromEntries(rows[0].columns.map((key,i)=>[key,rows[0].values[0][i]]));
  row.state=row.state_json?JSON.parse(row.state_json):null;row.payload=row.payload_json?JSON.parse(row.payload_json):null;
  return row;
}

function abandonRound(roundId, reason = 'abandoned') {
  if (!db || !roundId) return;
  db.run(`UPDATE rounds SET status = ?, ended_at = COALESCE(ended_at, ?), state_json = NULL WHERE id = ?`,
         [reason, Date.now(), roundId]);
  scheduleFlush();
}

function abandonSoloRun(runId, reason = 'abandoned') {
  if (!db || !runId) return;
  db.run(`UPDATE solo_runs SET status = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`,
         [reason, Date.now(), runId]);
  scheduleFlush();
}

module.exports = {
  init,
  insertRound,
  endRound,
  upsertParticipant,
  recordFind,
  getLeaderboard,
  getRecentRounds,
  getRoundDetail,
  getStats,
  getActionReceipt, saveActionReceipt,
  flushNow, durable, reserveRewardIntention, pendingRewardIntentions, markRewardQueued, markRewardsQueued, rewardIntentionSummary,
  getSessionById,
  findSessionByIdentity,
  upsertSession,
  touchSession,
  getDailyPuzzle,
  saveDailyPuzzle,
  startSoloRun,
  updateSoloRun,
  endSoloRun,
  maybeUpdateDailyPB,
  getDailyLeaderboard,
  getDailyPB,
  getRecentSoloRuns,
  updateRoundState,
  updateSoloRunState,
  setSoloRunPayload,
  getActiveRounds,
  getActiveSoloRuns, getSoloRunForOwner,
  abandonRound,
  abandonSoloRun,
};
