let io = null;
let gameEngine = null;

function initialize(socketIo, engine) {
  io = socketIo;
  gameEngine = engine;

  io.on('connection', (socket) => {
    console.log('[Overlay] Client connected');

    // Send initial state
    socket.emit('game-state', gameEngine.getGameState());

    socket.on('disconnect', () => {
      console.log('[Overlay] Client disconnected');
    });

    socket.on('request-state', () => {
      socket.emit('game-state', gameEngine.getGameState());
    });
  });
}

module.exports = { initialize };
