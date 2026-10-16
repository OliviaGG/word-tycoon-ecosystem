// room-manager.js - Streamer-private game rooms.
//
// One Room per streamer handle. Created lazily the first time a chat-message
// with a `streamerHandle` field arrives from Chat Relay. Each room owns its
// own RoundRunner — independent article + grid + scoring — and broadcasts to
// the Socket.IO room `streamer:<handle>` so the /streamer/<handle> viewer page
// can subscribe.
//
// Rooms idle out: if no chat activity arrives for `IDLE_SHUTDOWN_MS` the room
// shuts down (cancels timers, drops its game). The next chat-message recreates
// it. This keeps memory bounded for streamers who connect once and forget.

const { RoundRunner } = require('./round-runner');
const { buildCompactQuoteRound } = require('./quotes');

const IDLE_SHUTDOWN_MS = 30 * 60_000;   // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 5 * 60_000;

// Streamer handles that run the WikiWord board (5×7, 6 targets, pyramid cards).
const WIKIWORD_STREAMER_HANDLES = new Set(['pro']);

const rooms = new Map();   // key "<mode>:<handle>" -> Room
const inflight = new Map(); // key -> Promise<Room> while a room is being initialized

function roomKey(handle, mode) {
  return `${mode || 'streamer'}:${handle}`;
}

function runnerExtrasFor(handle, mode) {
  if (mode === 'wikiword-4x4') {
    return {
      roundBuilder: buildCompactQuoteRound,
      roundBuildOpts: {
        targetCount: 1,
        maxTotalLetters: 16,
        rows: 4,
        cols: 4,
      },
      gameLabel: 'wikiword-4x4',
      gameName: 'WikiWord 4×4',
    };
  }
  if (WIKIWORD_STREAMER_HANDLES.has(handle)) {
    return {
      roundBuildOpts: {
        targetCount: 6,
        maxTotalLetters: 35,
        rows: 5,
        cols: 7,
      },
      gameLabel: 'wikiword',
      gameName: 'WikiWord',
    };
  }
  return {};
}

let io = null;
let idleSweepTimer = null;

function init({ io: ioInstance }) {
  io = ioInstance;
  if (idleSweepTimer) clearInterval(idleSweepTimer);
  idleSweepTimer = setInterval(sweepIdleRooms, IDLE_CHECK_INTERVAL_MS);
  // Don't keep the process alive solely for the sweep timer.
  if (idleSweepTimer.unref) idleSweepTimer.unref();
}

function normalizeHandle(handle) {
  return String(handle || '').toLowerCase().trim();
}

function broadcasterFor(handle) {
  const channel = `streamer:${handle}`;
  return (event, payload) => {
    if (!io) return;
    io.to(channel).emit(event, payload);
  };
}

// Build (or fetch existing) room. Returns the Room or null on failure. The
// inflight map dedupes concurrent first-message bursts so we don't open two
// rounds for the same handle.
async function getOrCreateRoom(rawHandle, mode = 'streamer') {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return null;
  const key = roomKey(handle, mode);

  const existing = rooms.get(key);
  if (existing) return existing;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const extras = runnerExtrasFor(handle, mode);
    const runner = new RoundRunner({
      label: `${mode}:${handle}`,
      mode,
      roomHandle: handle,
      broadcast: broadcasterFor(handle),
      autoLoop: true,
      enableElo: false,                  // streamer rooms don't feed the global ELO ladder
      roundBuilder: extras.roundBuilder || null,
      roundBuildOpts: extras.roundBuildOpts || {},
      gameLabel: extras.gameLabel || null,
      gameName: extras.gameName || null,
    });
    const room = {
      handle,
      mode,
      runner,
      createdAt: Date.now(),
    };
    rooms.set(key, room);
    try {
      await runner.startRound();
    } catch (e) {
      console.log(`[Room ${handle}] failed to start: ${e.message}`);
      rooms.delete(key);
      return null;
    }
    console.log(`[Room ${handle}] created (${mode})`);
    return room;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function getRoom(rawHandle, mode = 'streamer') {
  return rooms.get(roomKey(normalizeHandle(rawHandle), mode)) || null;
}

function listRooms() {
  return [...rooms.values()].map((r) => ({
    handle: r.handle,
    mode: r.mode,
    createdAt: r.createdAt,
    lastActivityAt: r.runner.lastActivityAt,
    articleTitle: r.runner.game ? r.runner.game.getState().articleTitle : null,
    rows: r.runner.game ? r.runner.game.rows : null,
    cols: r.runner.game ? r.runner.game.cols : null,
    foundCount: r.runner.game ? r.runner.game.foundWords.size : 0,
    targetCount: r.runner.game ? r.runner.game.targetByWord.size : 0,
    foundTargetCount: r.runner.game ? r.runner.game.foundTargets.size : 0,
    playerCount: r.runner.game ? r.runner.game.playerScores.size : 0,
  }));
}

function endRoom(rawHandle, mode = 'streamer', reason = 'manual') {
  const handle = normalizeHandle(rawHandle);
  const key = roomKey(handle, mode);
  const room = rooms.get(key);
  if (!room) return false;
  if (room.runner.game) room.runner.endRound(reason);
  room.runner.shutdown();
  rooms.delete(key);
  console.log(`[Room ${handle}] ended (${reason})`);
  return true;
}

function sweepIdleRooms() {
  const cutoff = Date.now() - IDLE_SHUTDOWN_MS;
  for (const [key, room] of rooms.entries()) {
    const last = room.runner.lastActivityAt || room.createdAt;
    if (last < cutoff) {
      console.log(`[Room ${room.handle} (${room.mode})] idle since ${new Date(last).toISOString()} — shutting down`);
      endRoom(room.handle, room.mode, 'idle');
    }
  }
}

// Resume a streamer room from a persisted active round row. Called once at
// boot from server.js for each row in db.getActiveRounds() with mode='streamer'.
// The room is registered into the rooms map so subsequent getOrCreateRoom
// calls return this resumed instance instead of opening a new round.
async function resumeRoomFromRound(row) {
  const handle = normalizeHandle(row.room_handle);
  const mode = row.mode || 'streamer';
  if (!handle) throw new Error('resumeRoomFromRound: missing handle');
  const key = roomKey(handle, mode);
  if (rooms.has(key)) return rooms.get(key);

  const extras = runnerExtrasFor(handle, mode);
  const runner = new RoundRunner({
    label: `${mode}:${handle}`,
    mode,
    roomHandle: handle,
    broadcast: broadcasterFor(handle),
    autoLoop: true,
    enableElo: false,
    roundBuilder: extras.roundBuilder || null,
    roundBuildOpts: extras.roundBuildOpts || {},
    gameLabel: extras.gameLabel || null,
    gameName: extras.gameName || null,
  });
  const room = { handle, mode, runner, createdAt: Date.now() };
  rooms.set(key, room);
  runner.restoring = true;
  const restore = async () => {
    try { await runner.resumeRound(row); runner.restoring = false; }
    catch (error) {
      console.error('[Room] persisted round restore deferred:', error.message);
      const timer = setTimeout(() => { if (rooms.get(key) === room) restore(); }, 10000); timer.unref?.();
    }
  };
  await restore();
  console.log(`[Room ${handle}] resumed (round #${row.id}, ${mode})`);
  return room;
}

module.exports = { init, getOrCreateRoom, getRoom, listRooms, endRoom, resumeRoomFromRound };
