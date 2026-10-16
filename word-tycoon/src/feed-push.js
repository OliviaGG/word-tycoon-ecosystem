/**
 * Feed push — fire-and-forget notifications to Chat Relay's social feed
 * (POST /api/feed-event on :3000, shown on the wordtycoon.live Feed tab
 * and Toon Tower ticker). Sibling of cosmetics-broadcast.js: same relay
 * URL + shared-secret header, never blocks or throws into the caller.
 *
 * Volume policy lives HERE so call sites stay clean:
 *   - business first purchases always post
 *   - level-ups post only at milestone levels (every 10th, or max level)
 *   - cosmetic shop / set purchases always post
 *   - loot box drops post only for epic+ rarities
 */

const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const GAME_API_SECRET = process.env.GAME_API_SECRET;

const FEED_LOOTBOX_RARITIES = new Set(['epic', 'legendary', 'ultra']);
const LEVEL_MILESTONE = 10;

function push(eventType, player, { value, valueLabel, detail } = {}) {
  if (!GAME_API_SECRET || !player) return;
  const body = {
    eventType,
    user: {
      displayName: player.display_name || player.username || 'Player',
      platform: player.platform || 'unknown',
      platformUserId: player.platform_user_id || null,
      profilePic: player.profile_pic || null
    },
    value: typeof value === 'number' ? value : null,
    valueLabel: valueLabel || null,
    detail: detail || null
  };
  fetch(`${CHAT_RELAY_URL}/api/feed-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': GAME_API_SECRET },
    body: JSON.stringify(body)
  }).catch(err => console.error('[FeedPush] failed:', err.message));
}

function pushBusinessBuy(player, businessName) {
  push('buy', player, { detail: { businessName } });
}

function pushBusinessLevelUp(player, businessName, level, maxLevel) {
  if (level % LEVEL_MILESTONE !== 0 && level !== maxLevel) return;
  push('levelup', player, { value: level, valueLabel: 'lvl', detail: { businessName, level } });
}

function pushCosmeticBuy(player, item) {
  if (!item) return;
  push('cosmetic', player, {
    detail: { cosmeticName: item.name, rarity: item.rarity || null, category: item.category || null }
  });
}

function pushSetUnlock(player, setName) {
  push('cosmetic', player, { detail: { cosmeticName: `${setName} set`, rarity: 'set' } });
}

function pushLootboxItems(player, items) {
  for (const item of (items || [])) {
    if (!item || !FEED_LOOTBOX_RARITIES.has(String(item.rarity || '').toLowerCase())) continue;
    push('lootbox', player, {
      detail: { cosmeticName: item.name, rarity: item.rarity, category: item.category || null }
    });
  }
}

module.exports = {
  pushBusinessBuy,
  pushBusinessLevelUp,
  pushCosmeticBuy,
  pushSetUnlock,
  pushLootboxItems
};
