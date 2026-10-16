const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const cache = new Map();
const TTL = 60000;

async function getPlayerCosmetics(platform, userId) {
  if (!platform || !userId) return {};
  const key = `${platform}:${userId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}`);
    const data = res.ok ? (await res.json()).equipped || {} : {};
    cache.set(key, { data, expiresAt: Date.now() + TTL });
    if (cache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of cache) { if (v.expiresAt < now) cache.delete(k); }
    }
    return data;
  } catch {
    return cached ? cached.data : {};
  }
}

function invalidatePlayer(platform, platformUserId, equipped) {
  const key = `${platform}:${platformUserId}`;
  if (equipped) {
    cache.set(key, { data: equipped, expiresAt: Date.now() + TTL });
  } else {
    cache.delete(key);
  }
}

module.exports = { getPlayerCosmetics, invalidatePlayer };
