/**
 * Chat Relay WebSocket client wrapper.
 * Connects to Chat Relay, registers this game, and forwards events.
 */

const { EventEmitter } = require('events');
const path = require('path');

const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const { createRelayClient } = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

class ChatClient extends EventEmitter {
  constructor(relayUrl, appInfo) {
    super();
    this.relayUrl = relayUrl;
    this.appInfo = appInfo; // { id, name, port }
    this.socket = null;
    this.connected = false;
  }

  connect() {
    this.socket = createRelayClient({
      id: this.appInfo?.id,
      name: this.appInfo?.name || 'Word Mine',
      port: this.appInfo?.port,
      apiSecret: this.appInfo?.apiKey,
      relayUrl: this.relayUrl,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 5000
    }, {
      onConnect: () => {
      this.connected = true;
      },
      onDisconnect: () => {
      this.connected = false;
      },
      onChat: (msg) => {
      this.emit('message', msg);
      },
      onEngagement: (data) => {
      this.emit('engagement', data);
      },
      onFrenzyUpdate: (data) => {
      this.emit('frenzy-update', data);
      },
      onCosmeticsUpdated: (data) => {
      this.emit('cosmetics-updated', data);
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }
}

module.exports = ChatClient;
