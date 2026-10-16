// cosmetics-cache.js - Client-side cosmetics fetch + cache for Sproutle
// Uses relative URL so it works both locally and in production (via Chat Relay proxy)

const cache = new Map();
const TTL = 60000; // 1 minute

export function invalidatePlayer(platform, platformUserId, equipped) {
    const key = `${platform}:${platformUserId}`;
    if (equipped) {
        cache.set(key, { data: equipped, expiresAt: Date.now() + TTL });
    } else {
        cache.delete(key);
    }
}

export async function getPlayerCosmetics(platform, userId) {
    const key = `${platform}:${userId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
        const res = await fetch(`/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}`);
        const data = res.ok ? (await res.json()).equipped || {} : {};
        cache.set(key, { data, expiresAt: Date.now() + TTL });
        return data;
    } catch {
        return cached ? cached.data : {};
    }
}
