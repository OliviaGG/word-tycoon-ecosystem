const { io: ioClient } = require('socket.io-client');

let relay = null;
let gameEngine = null;
let commands = null;
let broadcastCosmeticsUpdate = null;

function initialize(engine, cmdModule, broadcastFn, port) {
  gameEngine = engine;
  commands = cmdModule;
  broadcastCosmeticsUpdate = broadcastFn || null;

  const url = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
  console.log(`[Relay] Connecting to Chat Relay at ${url}...`);

  relay = ioClient(url, {
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity
  });

  relay.on('connect', () => {
    console.log('[Relay] Connected to Chat Relay');
    relay.emit('app-register', { id: 'word-tycoon', name: 'Mobile Tycoon', port: port || 3020, apiKey: process.env.GAME_API_SECRET }, (ack) => {
      if (ack?.success) console.log('[Relay] Registered with Chat Relay');
    });
  });

  relay.on('disconnect', (reason) => {
    console.log(`[Relay] Disconnected: ${reason}`);
  });

  relay.on('connect_error', (err) => {
    console.log(`[Relay] Connection error: ${err.message}`);
  });

  relay.on('chat-message', handleChatMessage);
  relay.on('engagement', handleEngagement);
}

async function handleChatMessage(msg) {
  if (!msg || msg.isSystem || msg.platform === 'system') return;

  const text = (msg.message || '').trim();
  if (!text) return;

  // A chat payload without a user has no player to act on. Guard here so a
  // malformed relay message can't throw a TypeError (msg.user.id) and, with no
  // process-level handler upstream, crash the economy engine. Mirrors handleEngagement.
  if (!msg.user) return;

  // Normalize platform name to prevent duplicate player entries
  const platform = (msg.platform || 'unknown').toLowerCase();
  msg.platform = platform;

  // Check for game commands
  if (commands.isCommand(text)) {
    const result = await commands.handle(msg);
    const isDiscord = (msg.user.id || '').startsWith('discord_');
    if (result && result.response !== undefined) {
      // Emit command response to overlay
      gameEngine.emitEvent('command-response', {
        user: msg.user.customNick || msg.user.displayName || msg.user.username,
        userId: msg.user.id || null,
        command: text.split(/\s+/)[0],
        response: result.response || result.message,
        ok: result.ok,
        fromDiscord: isDiscord,
        itemData: result.item || null,
        itemsData: result.items || null,
        setStatus: result.setStatus || null
      });
    } else if (result && result.message !== undefined) {
      gameEngine.emitEvent('command-response', {
        user: msg.user.customNick || msg.user.displayName || msg.user.username,
        userId: msg.user.id || null,
        command: text.split(/\s+/)[0],
        response: result.message,
        ok: result.ok,
        fromDiscord: isDiscord,
        itemData: result.item || null,
        itemsData: result.items || null,
        setStatus: result.setStatus || null
      });
    }
    // Broadcast cosmetics update for equip/unequip/buy commands
    const cmd = text.split(/\s+/)[0].toLowerCase();
    if (result && result.ok && broadcastCosmeticsUpdate && ['!equip', '!unequip', '!buyc', '!buyset', '!test', '!untest'].includes(cmd)) {
      broadcastCosmeticsUpdate(platform, msg.user.id);
    }
    return;
  }

  // Non-command messages: ensure player exists for tracking
  gameEngine.getOrCreatePlayer(
    platform,
    msg.user.id,
    msg.user.username,
    msg.user.customNick || msg.user.displayName || msg.user.username,
    msg.user.profilePic || null
  );
}

function handleEngagement(event) {
  if (!event || !event.user) return;

  // Normalize platform name to prevent duplicate player entries
  const platform = (event.platform || 'tiktok').toLowerCase();

  if (event.type === 'like') {
    // Ensure player exists
    gameEngine.getOrCreatePlayer(
      platform,
      event.user.id,
      event.user.username,
      event.user.displayName,
      event.user.profilePic || null
    );
    // Buffer taps through Redis
    gameEngine.bufferTaps(platform, event.user.id, event.count || 1);
  } else if (event.type === 'gift') {
    // TikTok coin gifts → 2 game coins per TikTok coin
    const tiktokCoins = event.diamondCount || event.coins || 0;
    if (tiktokCoins > 0) {
      gameEngine.handleGift(
        platform,
        event.user.id,
        event.user.username,
        event.user.displayName,
        tiktokCoins
      );
    }
  }
}

function isConnected() {
  return relay && relay.connected;
}

function disconnect() {
  if (relay) {
    relay.disconnect();
  }
}

function emitFrenzyUpdate(data) {
  if (relay && relay.connected) {
    relay.emit('frenzy-update', data);
  }
}

module.exports = { initialize, isConnected, disconnect, emitFrenzyUpdate };
