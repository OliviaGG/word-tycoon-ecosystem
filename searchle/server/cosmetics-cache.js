const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const cache = new Map();
const TTL = 60000;
const pending = new Map();
const STALE_TTL = 5 * 60000;
const FIRST_LOOKUP_WAIT = 400;

function remember(key, data) {
  cache.delete(key);
  cache.set(key, { data, expiresAt: Date.now() + TTL });
  while (cache.size > 5000) cache.delete(cache.keys().next().value);
}

function refresh(key, platform, userId) {
  if (pending.has(key)) return pending.get(key);
  const task = Promise.resolve().then(async () => {
    try {
      const url = `${WORD_EMPIRES_URL}/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}`;
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()).equipped || {};
      // An equipment-change event supersedes an older request in flight.
      if (pending.get(key) === task) remember(key, data);
      return cache.get(key)?.data || data;
    } catch (err) {
      console.error(`[Cosmetics] Fetch failed for ${platform}/${userId}:`, err.message);
      const cached = cache.get(key);
      return cached && Date.now() < cached.expiresAt + STALE_TTL ? cached.data : {};
    } finally {
      if (pending.get(key) === task) pending.delete(key);
    }
  });
  pending.set(key, task);
  return task;
}

async function getPlayerCosmetics(platform, userId) {
  if (!platform || !userId) return {};
  if (/^(?:web_guest_|guest_|wsguest_|guest-|anon_)/i.test(String(userId))) return {};
  const key = `${platform}:${userId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const task = refresh(key, platform, userId);
  if (cached && Date.now() < cached.expiresAt + STALE_TTL) return cached.data;
  // A slow decoration service must not hold word acceptance for five seconds.
  // Continue warming the cache after this short first-lookup budget expires.
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({}), FIRST_LOOKUP_WAIT);
    task.then(data => { clearTimeout(timer); resolve(data); });
  });
}

function invalidatePlayer(platform, platformUserId, equipped) {
  const key = `${platform}:${platformUserId}`;
  pending.delete(key);
  if (equipped) {
    remember(key, equipped);
  } else {
    cache.delete(key);
  }
}

function getStats() {
  const now = Date.now();
  let liveEntries = 0;
  let expiredEntries = 0;
  for (const entry of cache.values()) {
    if (entry.expiresAt > now) liveEntries++;
    else expiredEntries++;
  }
  return {
    size: cache.size,
    liveEntries,
    expiredEntries,
    ttlMs: TTL
  };
}

module.exports = { getPlayerCosmetics, invalidatePlayer, getStats };
