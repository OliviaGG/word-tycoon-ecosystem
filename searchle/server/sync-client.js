// ===== Sync Client (Follower) =====
// Connects to the primary Searchle server's /sync namespace to follow its target word.

const { io: ioClient } = require('socket.io-client');

let syncSocket = null;

function init(primaryUrl, secret, config, handlers) {
  syncSocket = ioClient(`${primaryUrl}/sync`, {
    auth: { secret },
    reconnection: true,
    reconnectionDelay: config.reconnectionDelay || 1000,
    reconnectionDelayMax: config.reconnectionDelayMax || 5000,
  });

  syncSocket.on('connect', () => {
    console.log(`[Sync] Connected to primary at ${primaryUrl}`);
  });

  syncSocket.on('disconnect', (reason) => {
    console.log(`[Sync] Disconnected from primary: ${reason}`);
  });

  syncSocket.on('connect_error', (err) => {
    console.log(`[Sync] Connection error: ${err.message}`);
  });

  // Primary sends current state on connect (handles reconnection mid-game)
  syncSocket.on('sync-state', (data) => {
    console.log(`[Sync] Received state: target="${data.targetWord}", isWon=${data.isWon}`);
    if (data.targetWord && !data.isWon) {
      handlers.onNewWord(data.targetWord, data.startTime);
    }
  });

  // Primary started a new game
  syncSocket.on('sync-new-game', (data) => {
    console.log(`[Sync] Primary started new game: "${data.targetWord}"`);
    handlers.onNewWord(data.targetWord, data.startTime);
  });

  // Primary's game was won (safety net for timing edge cases)
  syncSocket.on('sync-game-won', (data) => {
    console.log(`[Sync] Primary game won: "${data.targetWord}"`);
    handlers.onGameWon(data.targetWord);
  });

  return syncSocket;
}

function disconnect() {
  if (syncSocket) syncSocket.disconnect();
}

module.exports = { init, disconnect };
