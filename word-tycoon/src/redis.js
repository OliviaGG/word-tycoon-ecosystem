// ===== In-Memory Tap Buffer =====
// Batches tap events before flushing to the database.
// Formerly used Redis for multi-instance scaling — replaced with pure
// in-memory Map (sufficient for single-server deployment).

const store = {
  taps: new Map(),      // "platform:userId" -> count
  communityTaps: 0
};
const STATUS = Object.freeze({
  mode: 'in-memory',
  ready: true,
  externalService: false,
  fallback: false,
});

async function initialize() {
  console.log('[TapBuffer] In-memory tap buffer ready');
}

async function bufferTap(platform, userId, count = 1) {
  const key = `${platform}:${userId}`;
  store.taps.set(key, (store.taps.get(key) || 0) + count);
  store.communityTaps += count;
}

async function flushTaps() {
  const results = [];
  for (const [key, count] of store.taps.entries()) {
    const sepIdx = key.indexOf(':');
    results.push({
      platform: key.substring(0, sepIdx),
      userId: key.substring(sepIdx + 1),
      count
    });
  }
  const communityTaps = store.communityTaps;
  store.taps.clear();
  store.communityTaps = 0;
  return { tappers: results, communityTaps };
}

function getStatus() {
  return {
    ...STATUS,
    bufferedPlayers: store.taps.size,
    bufferedCommunityTaps: store.communityTaps,
  };
}

function isConnected() { return STATUS.ready; }
function isUsingFallback() { return STATUS.fallback; }
async function shutdown() {}

module.exports = { initialize, bufferTap, flushTaps, getStatus, isConnected, isUsingFallback, shutdown };
