const crypto = require('crypto');

function createRewardEvents(db) {
  let ready = false;
  function ensureSchema() {
    if (ready) return;
    db.run(`CREATE TABLE IF NOT EXISTS reward_events (
      game TEXT NOT NULL, event_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      payload_json TEXT NOT NULL, response_json TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game, event_id))`);
    ready = true;
  }
  function lookup(game, eventId) {
    ensureSchema();
    return db.queryOne('SELECT * FROM reward_events WHERE game = ? AND event_id = ?', [game, eventId]);
  }
  async function apply(payload, execute) {
    ensureSchema();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let duplicate = false;
    const result = db.withTransactionSync(() => {
      const old = lookup(payload.game, payload.eventId);
      if (old) {
        // Receipts written before duration forwarding have no duration field.
        // A compatible retry must return that original receipt, not conflict or
        // retrospectively alter win analytics. Newly recorded durations remain
        // part of immutable request identity.
        const oldPayload = JSON.parse(old.payload_json);
        const { durationSeconds, ...withoutDuration } = payload;
        const legacyDurationRetry = !Object.prototype.hasOwnProperty.call(oldPayload, 'durationSeconds') &&
          crypto.createHash('sha256').update(JSON.stringify(withoutDuration)).digest('hex') === old.fingerprint;
        if (old.fingerprint !== fingerprint && !legacyDurationRetry) {
          const error = new Error('Reward event ID was reused with different data');
          error.status = 409; throw error;
        }
        duplicate = true;
        return JSON.parse(old.response_json);
      }
      const applied = execute();
      if (!applied || applied.ok !== true) {
        const error = new Error(applied?.message || 'Reward could not be applied');
        error.status = 503; throw error;
      }
      const response = { ...applied, rewardEventId: payload.eventId };
      db.run('INSERT INTO reward_events (game, event_id, fingerprint, payload_json, response_json) VALUES (?, ?, ?, ?, ?)',
        [payload.game, payload.eventId, fingerprint, JSON.stringify(payload), JSON.stringify(response)]);
      db.save();
      return response;
    });
    // The XP, completion, cosmetics and response share one main-DB snapshot.
    // Even duplicate responses must flush a prior failed/unacknowledged save.
    await db.flushDurable();
    return { ...result, duplicate };
  }
  async function status(game, eventId) {
    const row = lookup(game, eventId);
    if (!row) return { ok: true, found: false };
    await db.flushDurable();
    return { ok: true, found: true, appliedAt: row.applied_at, result: JSON.parse(row.response_json) };
  }
  return { apply, status };
}

function validRewardEventId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,199}$/.test(value);
}

module.exports = { createRewardEvents, validRewardEventId };
