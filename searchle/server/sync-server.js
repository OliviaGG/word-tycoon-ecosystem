// ===== Sync Server (Primary) =====
// Exposes target word and game lifecycle to follower instances via Socket.IO /sync namespace.

const SYNC_SECRET = process.env.SYNC_SECRET || null;

let _io = null;

function init(io, gameManager) {
  if (!SYNC_SECRET) {
    console.log('[Sync] SYNC_SECRET not set — sync server disabled');
    return;
  }

  _io = io;

  const syncNsp = io.of('/sync');

  // Auth middleware — reject connections without valid secret
  syncNsp.use((socket, next) => {
    const token = socket.handshake.auth?.secret;
    if (token === SYNC_SECRET) {
      next();
    } else {
      console.log('[Sync] Rejected follower — invalid secret');
      next(new Error('Invalid sync secret'));
    }
  });

  syncNsp.on('connection', (socket) => {
    console.log('[Sync] Follower connected');

    // Send current game state immediately on connect
    const game = gameManager.getGame();
    socket.emit('sync-state', {
      targetWord: game.targetWord,
      startTime: game.startTime,
      isWon: game.isWon,
    });

    socket.on('disconnect', () => {
      console.log('[Sync] Follower disconnected');
    });
  });

  console.log('[Sync] Sync server initialized on /sync namespace');
}

function broadcastNewGame(targetWord, startTime) {
  if (!_io) return;
  _io.of('/sync').emit('sync-new-game', { targetWord, startTime });
}

function broadcastGameWon(targetWord) {
  if (!_io) return;
  _io.of('/sync').emit('sync-game-won', { targetWord });
}

module.exports = { init, broadcastNewGame, broadcastGameWon };
