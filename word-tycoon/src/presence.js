/**
 * Player Presence Service
 *
 * Explicit presence tracking separated from income calculation.
 * Replaces the incidental `last_seen` writes scattered across the codebase
 * with a centralized, intentional presence model.
 *
 * Phase 1 of income system refactor (2026-03-26).
 *
 * Usage:
 *   const presence = require('./presence');
 *   presence.initialize(db);
 *   presence.touch(playerId, 'portal');  // mark player as active
 *   presence.isOnline(playerId);         // true if active within threshold
 */

const OFFLINE_THRESHOLD_MS = 180_000; // 3 minutes — matches game-engine.js

// In-memory presence cache: playerId -> { lastActivityAt: number, source: string }
// This avoids a DB write on every presence touch (we batch-flush to DB periodically).
const presenceCache = new Map();

let db = null;
let flushInterval = null;
const FLUSH_INTERVAL_MS = 10_000; // flush to DB every 10s

function initialize(database) {
  db = database;

  // Seed cache from DB for any recently-active players
  // (so presence survives a server restart within the threshold)
  if (db.queryAll) {
    try {
      const recent = db.queryAll(
        `SELECT id, last_seen FROM players
         WHERE last_seen >= datetime('now', '-5 minutes')
         ORDER BY last_seen DESC
         LIMIT 500`
      );
      for (const row of recent) {
        const ts = parseUTCTimestamp(row.last_seen);
        if (Number.isFinite(ts)) {
          presenceCache.set(row.id, { lastActivityAt: ts, source: 'db-seed' });
        }
      }
    } catch (e) {
      // Non-fatal — cache starts empty
      console.warn('[Presence] Failed to seed from DB:', e.message);
    }
  }

  // Periodic flush of in-memory presence to DB `last_seen`
  if (!flushInterval) {
    flushInterval = setInterval(flushToDB, FLUSH_INTERVAL_MS);
    // Don't keep the process alive just for presence flushing
    if (flushInterval.unref) flushInterval.unref();
  }
}

/**
 * Mark a player as currently active.
 *
 * @param {number} playerId - The player's DB id
 * @param {string} [source='unknown'] - What triggered the touch (e.g. 'tap', 'portal', 'collect', 'game')
 */
function touch(playerId, source = 'unknown') {
  if (!playerId) return;
  presenceCache.set(playerId, {
    lastActivityAt: Date.now(),
    source
  });
}

/**
 * Check if a player is considered online.
 *
 * @param {number} playerId
 * @returns {boolean}
 */
function isOnline(playerId) {
  const entry = presenceCache.get(playerId);
  if (entry) {
    return (Date.now() - entry.lastActivityAt) <= OFFLINE_THRESHOLD_MS;
  }

  // Fall back to DB last_seen for players not in cache
  if (db?.getPlayerById) {
    const player = db.getPlayerById(playerId);
    if (player?.last_seen) {
      const ts = parseUTCTimestamp(player.last_seen);
      if (Number.isFinite(ts)) {
        return (Date.now() - ts) <= OFFLINE_THRESHOLD_MS;
      }
    }
  }

  return false;
}

/**
 * Get the full presence state for a player.
 *
 * @param {number} playerId
 * @returns {{ isOnline: boolean, lastActivityAt: number|null, source: string|null }}
 */
function getState(playerId) {
  const entry = presenceCache.get(playerId);
  if (entry) {
    return {
      isOnline: (Date.now() - entry.lastActivityAt) <= OFFLINE_THRESHOLD_MS,
      lastActivityAt: entry.lastActivityAt,
      source: entry.source
    };
  }

  // Fall back to DB
  if (db?.getPlayerById) {
    const player = db.getPlayerById(playerId);
    if (player?.last_seen) {
      const ts = parseUTCTimestamp(player.last_seen);
      if (Number.isFinite(ts)) {
        return {
          isOnline: (Date.now() - ts) <= OFFLINE_THRESHOLD_MS,
          lastActivityAt: ts,
          source: 'db'
        };
      }
    }
  }

  return { isOnline: false, lastActivityAt: null, source: null };
}

/**
 * Get the last-activity timestamp in milliseconds.
 * Returns Date.now() if unknown (safe default for income calcs — treats as online).
 */
function getLastActivityMs(playerId) {
  const entry = presenceCache.get(playerId);
  if (entry) return entry.lastActivityAt;

  if (db?.getPlayerById) {
    const player = db.getPlayerById(playerId);
    if (player?.last_seen) {
      const ts = parseUTCTimestamp(player.last_seen);
      if (Number.isFinite(ts)) return ts;
    }
  }

  return Date.now();
}

/**
 * Flush in-memory presence data to the DB `last_seen` column.
 * Only writes players whose presence is newer than what's in DB.
 */
function flushToDB() {
  if (!db?.run) return;

  const now = Date.now();
  const staleThreshold = now - (OFFLINE_THRESHOLD_MS * 2); // Only flush recent entries

  for (const [playerId, entry] of presenceCache) {
    // Skip stale entries (no point writing old timestamps)
    if (entry.lastActivityAt < staleThreshold) {
      presenceCache.delete(playerId);
      continue;
    }

    try {
      // Convert to SQLite datetime format
      const isoStr = new Date(entry.lastActivityAt).toISOString()
        .replace('T', ' ').replace('Z', '').split('.')[0];
      db.run(
        'UPDATE players SET last_seen = ? WHERE id = ? AND last_seen < ?',
        [isoStr, playerId, isoStr]
      );
    } catch (e) {
      // Non-fatal
    }
  }
}

/**
 * Clean shutdown — flush everything and clear interval.
 */
function shutdown() {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  flushToDB();
}

function getStats() {
  const now = Date.now();
  let onlineCount = 0;

  for (const entry of presenceCache.values()) {
    if ((now - entry.lastActivityAt) <= OFFLINE_THRESHOLD_MS) {
      onlineCount++;
    }
  }

  return {
    cacheSize: presenceCache.size,
    onlineCount,
    flushIntervalMs: FLUSH_INTERVAL_MS,
    offlineThresholdMs: OFFLINE_THRESHOLD_MS
  };
}

// ---------- Utility ----------

function parseUTCTimestamp(ts) {
  if (!ts) return NaN;
  let ms;
  if (ts.includes('T') || ts.includes('Z') || ts.includes('+')) {
    ms = new Date(ts).getTime();
  } else {
    ms = new Date(ts.trim().replace(' ', 'T') + 'Z').getTime();
  }
  return isNaN(ms) ? NaN : ms;
}

module.exports = {
  OFFLINE_THRESHOLD_MS,
  initialize,
  touch,
  isOnline,
  getState,
  getLastActivityMs,
  getStats,
  flushToDB,
  shutdown
};
