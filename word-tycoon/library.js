/**
 * Library routes — /api/library/*, /api/admin/library/*, /api/admin/accounts/:id/library
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

function registerLibraryRoutes(app, { db, gameEngine, businesses, GAME_API_SECRET, CHAT_RELAY_URL }) {

  // Library word report — called by game servers when a player finds a word
  app.post('/api/library/report', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== GAME_API_SECRET) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    const { platform, userId, word, game, username, displayName } = req.body;
    if (!platform || !userId || !word || !game) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    if (typeof word !== 'string' || word.length < 3 || word.length > 30) {
      return res.json({ ok: false, message: 'Invalid word' });
    }
    // Validate word exists in word bank dictionary (Chat Relay on same machine)
    try {
      const vRes = await fetch(`${CHAT_RELAY_URL}/api/word-bank/validate/${encodeURIComponent(word.toLowerCase())}`);
      const vData = await vRes.json();
      if (!vData.valid) {
        return res.json({ ok: false, message: 'Not a valid word' });
      }
    } catch (e) {
      // If word bank is down, reject to be safe
      return res.json({ ok: false, message: 'Word validation unavailable' });
    }
    // Resolve display info — avoid storing raw numeric IDs as names
    const isNumericId = /^\d{10,}$/.test(userId);
    const uname = username || (isNumericId ? null : userId) || userId;
    const dname = displayName || username || (isNumericId ? null : userId) || userId;
    const player = gameEngine.getOrCreatePlayer(platform, userId, uname, dname);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    // Dedupe across all linked player IDs to prevent the same human
    // re-adding the same word from a different linked platform account
    const result = db.addLibraryWordLinked(player, word.toLowerCase(), game);
    if (result.isNew) {
      db.incrementLibraryWordCount(player.id);
      const wc = db.getPlayerLibraryWordCount(player.id);
      const level = businesses.getLibraryLevel(wc);
      // Sync stored library business level so business card shows correct level
      const libBiz = db.getPlayerBusiness(player.id, 'library');
      if (libBiz && libBiz.level !== level) {
        db.setBusinessLevel(libBiz.id, level);
      }
      db.save();
      gameEngine.emitTickerEvent('library-word', player.display_name, word.toUpperCase());
      gameEngine.refreshCache();
      return res.json({ ok: true, isNew: true, word: word.toLowerCase(), level, wordCount: wc });
    }
    const wc = db.getPlayerLibraryWordCount(player.id);
    res.json({ ok: true, isNew: false, word: word.toLowerCase(), wordCount: wc });
  });

  // Library data endpoint — returns player's word list + stats
  app.get('/api/admin/accounts/:discordUserId/library', (req, res) => {
    const discordUserId = req.params.discordUserId;
    const { limit, offset, game, search } = req.query;
    const playerIds = [...db.getAllPlayerIdsForDiscord(discordUserId)];
    if (playerIds.length === 0) return res.json({ ok: false, error: 'No player found' });

    const wordCount = playerIds.reduce((sum, pid) => sum + db.getPlayerLibraryWordCount(pid), 0);
    const level = businesses.getLibraryLevel(wordCount);
    const nextLevelAt = businesses.getNextLevelThreshold(level);
    const words = db.getPlayerLibraryWords(playerIds, {
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      game: game || null,
      search: search || null
    });
    const stats = db.getPlayerLibraryStats(playerIds);

    res.json({ ok: true, level, wordCount, nextLevelAt, words, stats });
  });

  // One-time library cleanup — remove words not in word bank dictionary
  app.post('/api/admin/library/cleanup', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== GAME_API_SECRET) return res.status(401).json({ ok: false });

    const allWords = db.queryAll('SELECT DISTINCT word FROM library_words');
    let removed = 0;
    const removedWords = [];

    for (const row of allWords) {
      try {
        const vRes = await fetch(`${CHAT_RELAY_URL}/api/word-bank/validate/${encodeURIComponent(row.word)}`);
        const vData = await vRes.json();
        if (!vData.valid) {
          const countResult = db.queryOne('SELECT COUNT(*) as cnt FROM library_words WHERE word = ?', [row.word]);
          db.run('DELETE FROM library_words WHERE word = ?', [row.word]);
          removed += countResult.cnt;
          removedWords.push(row.word);
        }
      } catch (e) {
        // Skip words we can't validate
      }
    }

    // Recalculate library_words counts for all affected players
    if (removed > 0) {
      db.run(`UPDATE players SET library_words = (
        SELECT COUNT(*) FROM library_words WHERE library_words.player_id = players.id
      )`);
      db.save();
    }

    res.json({ ok: true, totalWords: allWords.length, removed, removedWords });
  });

  // One-time linked-identity library dedupe — remove duplicate words across linked player IDs
  app.post('/api/admin/library/dedupe-linked', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== GAME_API_SECRET) return res.status(401).json({ ok: false });

    // Step 1: Group all linked identities by discord_user_id
    const discordUsers = db.queryAll('SELECT DISTINCT discord_user_id FROM linked_accounts');
    let totalRemoved = 0;
    let groupsAffected = 0;
    const samples = [];

    for (const row of discordUsers) {
      const discordId = row.discord_user_id;
      const allIds = db.getAllPlayerIdsForDiscord(discordId);
      if (allIds.length < 2) continue; // No cross-identity dupes possible with 1 player

      // Step 2: Find words that appear on more than one player_id in this group
      const ph = allIds.map(() => '?').join(',');
      const dupes = db.queryAll(
        `SELECT word, COUNT(*) as cnt, GROUP_CONCAT(player_id) as pids, GROUP_CONCAT(id) as row_ids, GROUP_CONCAT(found_at) as dates
         FROM library_words
         WHERE player_id IN (${ph})
         GROUP BY LOWER(word)
         HAVING cnt > 1`,
        allIds
      );
      if (dupes.length === 0) continue;

      // Step 3: Determine canonical player_id (primary player for this identity)
      const primary = db.resolveUnifiedPlayerByDiscord(discordId);
      const primaryId = primary ? primary.id : allIds[0];

      groupsAffected++;
      for (const d of dupes) {
        const rowIds = d.row_ids.split(',').map(Number);
        const pids = d.pids.split(',').map(Number);
        const dates = d.dates.split(',');

        // Step 4: Pick which row to keep
        // Prefer: row on primary player; tie-break by oldest found_at; then lowest row id
        let keepIdx = 0;
        for (let i = 0; i < rowIds.length; i++) {
          const iIsPrimary = pids[i] === primaryId;
          const keepIsPrimary = pids[keepIdx] === primaryId;
          if (iIsPrimary && !keepIsPrimary) { keepIdx = i; continue; }
          if (!iIsPrimary && keepIsPrimary) continue;
          // Same primary status — keep oldest
          if (dates[i] < dates[keepIdx]) { keepIdx = i; continue; }
          if (dates[i] === dates[keepIdx] && rowIds[i] < rowIds[keepIdx]) { keepIdx = i; }
        }

        const keepRowId = rowIds[keepIdx];
        const deleteIds = rowIds.filter(id => id !== keepRowId);

        if (deleteIds.length > 0) {
          const delPh = deleteIds.map(() => '?').join(',');
          db.run(`DELETE FROM library_words WHERE id IN (${delPh})`, deleteIds);
          totalRemoved += deleteIds.length;

          if (samples.length < 10) {
            samples.push({
              word: d.word,
              discordId,
              keptRowId: keepRowId,
              keptPlayerId: pids[keepIdx],
              deletedRowIds: deleteIds,
              isPrimaryKeep: pids[keepIdx] === primaryId
            });
          }
        }
      }
    }

    // Step 5: Recalculate library_words cached counts for ALL players
    if (totalRemoved > 0) {
      db.run(`UPDATE players SET library_words = (
        SELECT COUNT(*) FROM library_words WHERE library_words.player_id = players.id
      )`);
      db.save();
    }

    res.json({
      ok: true,
      linkedGroups: discordUsers.length,
      groupsAffected,
      duplicateRowsRemoved: totalRemoved,
      samples
    });
  });
}

module.exports = { registerLibraryRoutes };
