/**
 * Cosmetics broadcast helper — notify game servers when cosmetics change.
 *
 * Extracted from server.js (2026-03-20).
 * Used by cosmetics routes, commands, relay client, and account routes.
 */

function createCosmeticsBroadcast({ db, gameEngine, CHAT_RELAY_URL, GAME_API_SECRET }) {
  const BROADCAST_HEADERS = { 'Content-Type': 'application/json', 'x-api-key': GAME_API_SECRET };

  /**
   * Broadcast cosmetics update to Chat Relay for all linked identities.
   *
   * Two call modes:
   *   broadcastCosmeticsUpdate(playerId)              — from admin endpoints
   *   broadcastCosmeticsUpdate(platform, platformUserId) — from relay commands
   */
  function broadcastCosmeticsUpdate(platformOrId, platformUserId) {
    let player;
    if (platformUserId !== undefined) {
      // Called with (platform, userId) from relay commands
      player = db.getPlayer(platformOrId, platformUserId);
    } else {
      // Called with (playerId) from admin endpoints
      player = db.getPlayerById(platformOrId);
    }
    if (!player) return;
    // Use merged cosmetics (across all linked accounts) instead of single-player equipped
    try {
      const equipped = gameEngine.getPlayerCosmeticsForAPI(player.platform, player.platform_user_id);

      // Broadcast for ALL linked player identities so game servers update
      // regardless of which platform/userId the player's guesses are stored under
      const allIds = gameEngine.getAllLinkedPlayerIds(player.platform, player.platform_user_id);
      const broadcasted = new Set();
      for (const pid of allIds) {
        const p = db.getPlayerById(pid);
        if (!p) continue;
        const key = `${p.platform}:${p.platform_user_id}`;
        if (broadcasted.has(key)) continue;
        broadcasted.add(key);
        const payload = { platform: p.platform, platformUserId: p.platform_user_id, equipped };
        fetch(`${CHAT_RELAY_URL}/api/cosmetics-broadcast`, {
          method: 'POST',
          headers: BROADCAST_HEADERS,
          body: JSON.stringify(payload)
        }).catch(err => console.error(`[Cosmetics] Broadcast failed for ${key}:`, err.message));
      }
      // Also broadcast for linked_accounts entries that have no players row
      // (e.g. tiktok/jorrybeaufart — TikTok username used in chat but no dedicated player record)
      let discordUserId = player.platform === 'discord' ? player.platform_user_id : db.getDiscordUserForPlatform(player.platform, player.platform_user_id);
      if (discordUserId) {
        const linkedAccts = db.getLinkedAccounts(discordUserId);
        for (const acct of linkedAccts) {
          const key = `${acct.platform}:${acct.platform_user_id}`;
          if (broadcasted.has(key)) continue;
          broadcasted.add(key);
          const payload = { platform: acct.platform, platformUserId: acct.platform_user_id, equipped };
          fetch(`${CHAT_RELAY_URL}/api/cosmetics-broadcast`, {
            method: 'POST',
            headers: BROADCAST_HEADERS,
            body: JSON.stringify(payload)
          }).catch(err => console.error(`[Cosmetics] Broadcast failed for ${key}:`, err.message));
        }
      }
      console.log(`[Cosmetics] Broadcast sent for ${broadcasted.size} identities: ${[...broadcasted].join(', ')} (${Object.keys(equipped).length} categories)`);
      // If no linked IDs found, fall back to single broadcast
      if (broadcasted.size === 0) {
        const payload = { platform: player.platform, platformUserId: player.platform_user_id, equipped };
        fetch(`${CHAT_RELAY_URL}/api/cosmetics-broadcast`, {
          method: 'POST',
          headers: BROADCAST_HEADERS,
          body: JSON.stringify(payload)
        }).catch(err => console.error('[Cosmetics] Broadcast failed:', err.message));
        console.log(`[Cosmetics] Broadcast fallback for ${player.platform}/${player.platform_user_id}`);
      }
    } catch (err) {
      console.error('[Cosmetics] broadcastCosmeticsUpdate error:', err.message, err.stack);
    }
  }

  return broadcastCosmeticsUpdate;
}

module.exports = { createCosmeticsBroadcast };
