const EventEmitter = require('events');
const path = require('path');

const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const { createRelayClient } = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

class ChatClient extends EventEmitter {
  constructor(relayUrl = 'http://localhost:3000', appInfo = null) {
    super();
    this.relayUrl = relayUrl;
    this.appInfo = appInfo;
    this.socket = null;
    this.connected = false;
  }

  connect() {
    console.log(`Connecting to Chat Relay at ${this.relayUrl}...`);

    this.socket = createRelayClient({
      id: this.appInfo?.id,
      name: this.appInfo?.name || 'SpellingBee',
      port: this.appInfo?.port,
      apiSecret: this.appInfo?.apiKey,
      relayUrl: this.relayUrl,
      reconnectionDelay: 3000,
      timeout: 10000
    }, {
      onConnect: () => {
        this.connected = true;
        this.emit('status', { connected: true });
      },
      onDisconnect: (reason) => {
        this.connected = false;
        this.emit('status', { connected: false, reason });
      },
      onConnectError: (err) => {
        this.connected = false;
        this.emit('status', { connected: false, error: err.message });
      },
      onChat: (msg) => {
        if (!msg || !msg.user || !msg.message) return;
        this.emit('message', {
          text: msg.message || '',
          username: msg.user.username || 'unknown',
          displayName: msg.user.customNick || msg.user.displayName || msg.user.username || 'unknown',
          platform: msg.platform || 'unknown',
          platformUserId: msg.user.id || msg.user.username || 'unknown',
          avatar: msg.user.profilePic || '',
          linkedDiscord: msg.linkedDiscord || null,
          streamerHandle: msg.streamerHandle || null,
          raw: msg
        });
      },
      onCosmeticsUpdated: (data) => {
        this.emit('cosmetics-updated', data);
      },
      onFrenzyUpdate: (data) => {
        this.emit('frenzy-update', data);
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

  reconnect() {
    this.disconnect();
    this.connect();
  }

  emitToRelay(event, data) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data);
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = ChatClient;
