/**
 * Library Service — owns all library word storage, counting, and stats.
 *
 * Created via createLibraryService(deps) so it can use the shared
 * DB primitives and identity functions without circular imports.
 *
 * Phase 2 B2 extraction from database.js (2026-03-20).
 */

function createLibraryService(deps) {
  const {
    queryOne, queryAll, run, save,
    getDiscordUserForPlatform, getAllPlayerIdsForDiscord
  } = deps;

  // ==================== CORE LIBRARY OPERATIONS ====================

  function addLibraryWord(playerId, word, game) {
    try {
      run('INSERT OR IGNORE INTO library_words (player_id, word, game) VALUES (?, ?, ?)',
          [playerId, word.toLowerCase(), game || null]);
      // Check if the row was actually inserted (not ignored as duplicate)
      const inserted = queryOne('SELECT changes() as cnt');
      return inserted && inserted.cnt > 0;
    } catch (e) { return false; }
  }

  /**
   * Add a library word with cross-identity dedupe.
   * Checks all linked player IDs before inserting, preventing duplicates
   * when the same human reports from different linked platform accounts.
   * Returns { isNew: boolean, existingPlayerId: number|null }
   */
  function addLibraryWordLinked(player, word, game) {
    const w = word.toLowerCase();
    // Find all player IDs for this user's linked identity
    let discordId = normalizeDiscordId(getDiscordUserForPlatform(player.platform, player.platform_user_id));
    // Discord/mobile/web players ARE the discord identity — their platform_user_id is the discord ID
    if (!discordId && (player.platform === 'discord' || player.platform === 'mobile' || player.platform === 'web')) {
      discordId = normalizeDiscordId(player.platform_user_id);
    }
    if (discordId) {
      const allIds = getAllPlayerIdsForDiscord(discordId);
      if (allIds.length > 0) {
        const ph = allIds.map(() => '?').join(',');
        const existing = queryOne(
          `SELECT player_id FROM library_words WHERE word = ? AND player_id IN (${ph})`,
          [w, ...allIds]
        );
        if (existing) {
          return { isNew: false, existingPlayerId: existing.player_id };
        }
      }
    }
    // No linked duplicate found — insert against the resolved player
    const isNew = addLibraryWord(player.id, w, game);
    return { isNew, existingPlayerId: isNew ? null : player.id };
  }

  // ==================== WORD COUNT ====================

  function normalizeDiscordId(value) {
    if (!value) return null;
    const raw = String(value);
    return raw.startsWith('discord_') ? raw.slice('discord_'.length) : raw;
  }

  function getLinkedPlayerIdsForPlayer(playerOrId) {
    const player = (playerOrId && typeof playerOrId === 'object')
      ? playerOrId
      : queryOne('SELECT id, platform, platform_user_id FROM players WHERE id = ?', [playerOrId]);
    if (!player?.id) return [];

    let discordId = normalizeDiscordId(getDiscordUserForPlatform(player.platform, player.platform_user_id));
    if (!discordId && (player.platform === 'discord' || player.platform === 'mobile' || player.platform === 'web')) {
      discordId = normalizeDiscordId(player.platform_user_id);
    }
    if (!discordId) return [player.id];

    const linkedIds = getAllPlayerIdsForDiscord(discordId);
    return linkedIds.length > 0 ? linkedIds : [player.id];
  }

  function incrementLibraryWordCount(playerId) {
    run('UPDATE players SET library_words = library_words + 1 WHERE id = ?', [playerId]);
  }

  function getPlayerLibraryWordCount(playerId) {
    const row = queryOne('SELECT library_words FROM players WHERE id = ?', [playerId]);
    return row ? (row.library_words || 0) : 0;
  }

  function recalcLibraryWordCount(playerId) {
    const row = queryOne('SELECT COUNT(*) as cnt FROM library_words WHERE player_id = ?', [playerId]);
    const count = row ? row.cnt : 0;
    run('UPDATE players SET library_words = ? WHERE id = ?', [count, playerId]);
    return count;
  }

  function getLinkedLibraryWordCount(playerOrId) {
    const playerIds = getLinkedPlayerIdsForPlayer(playerOrId);
    if (playerIds.length === 0) return 0;
    if (playerIds.length === 1) return getPlayerLibraryWordCount(playerIds[0]);
    const placeholders = playerIds.map(() => '?').join(',');
    const row = queryOne(
      `SELECT COUNT(*) as cnt FROM library_words WHERE player_id IN (${placeholders})`,
      playerIds
    );
    return row ? (row.cnt || 0) : 0;
  }

  // ==================== QUERY / STATS ====================

  function getPlayerLibraryWords(playerIds, options = {}) {
    if (!playerIds || playerIds.length === 0) return [];
    const { limit = 50, offset = 0, game, search } = options;
    const placeholders = playerIds.map(() => '?').join(',');
    let sql = `SELECT word, game, found_at FROM library_words WHERE player_id IN (${placeholders})`;
    const params = [...playerIds];
    if (game) { sql += ' AND game = ?'; params.push(game); }
    if (search) { sql += ' AND word LIKE ?'; params.push('%' + search + '%'); }
    sql += ' ORDER BY found_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  function getPlayerLibraryStats(playerIds) {
    if (!playerIds || playerIds.length === 0) return { byGame: [], total: 0, recent: [] };
    const placeholders = playerIds.map(() => '?').join(',');
    const byGame = queryAll(
      `SELECT game, COUNT(*) as count FROM library_words
       WHERE player_id IN (${placeholders}) GROUP BY game ORDER BY count DESC`,
      [...playerIds]
    );
    const total = queryOne(
      `SELECT COUNT(*) as cnt FROM library_words WHERE player_id IN (${placeholders})`,
      [...playerIds]
    );
    const recent = queryAll(
      `SELECT word, game, found_at FROM library_words
       WHERE player_id IN (${placeholders}) ORDER BY found_at DESC LIMIT 5`,
      [...playerIds]
    );
    return { byGame, total: total ? total.cnt : 0, recent };
  }

  // ==================== PUBLIC API ====================

  return {
    addLibraryWord,
    addLibraryWordLinked,
    getLinkedPlayerIdsForPlayer,
    incrementLibraryWordCount,
    getPlayerLibraryWordCount,
    getLinkedLibraryWordCount,
    recalcLibraryWordCount,
    getPlayerLibraryWords,
    getPlayerLibraryStats
  };
}

module.exports = {
  createLibraryService
};
