// Resolve a file or require a module from the Chat Relay directory if available,
// otherwise fall back to the bundled copies in server/shared/. This lets
// Searchle boot and operate even when the relay filesystem is missing.
const fs = require('fs');
const path = require('path');

const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');

function resolveRelayOrShared(relPath) {
  const relayPath = path.join(RELAY_DIR, relPath);
  if (fs.existsSync(relayPath)) return relayPath;
  return path.join(__dirname, 'shared', relPath);
}

function requireRelayOrShared(relPath) {
  const relayFile = path.join(RELAY_DIR, relPath);
  try {
    return require(relayFile);
  } catch (err) {
    if (['src/game-shared.js','src/game-action-journal','src/game-action-journal.js'].includes(relPath)) throw new Error('Canonical Chat Relay security SDK unavailable', { cause: err });
    return require(path.join(__dirname, 'shared', relPath));
  }
}

module.exports = { resolveRelayOrShared, requireRelayOrShared };
