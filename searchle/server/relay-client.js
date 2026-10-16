// ===== Chat Relay Client =====
// Connects to the central Chat Relay server via Socket.IO.

const path = require('path');

const { requireRelayOrShared } = require('./shared-resolver');
const { createRelayClient } = requireRelayOrShared('src/game-shared.js');

let chatRelay = null;

function init(relayUrl, config, handlers) {
  chatRelay = createRelayClient({
    id: 'searchle',
    name: 'Searchle Mobile',
    port: config.port || 3015,
    relayUrl,
    reconnectionDelay: config.reconnectionDelay,
    reconnectionDelayMax: config.reconnectionDelayMax
  }, {
    onChat: handlers.onChatMessage,
    onCosmeticsUpdated: handlers.onCosmeticsUpdated,
    onFrenzyUpdate: handlers.onFrenzyUpdate,
    onActivateDaily: handlers.onActivateDaily,
    onRevealHint: handlers.onRevealHint
  });

  return chatRelay;
}

function disconnect() {
  if (chatRelay) chatRelay.disconnect();
}

function emit(event, data) {
  if (chatRelay && chatRelay.connected) chatRelay.emit(event, data);
}

module.exports = { init, disconnect, emit };
