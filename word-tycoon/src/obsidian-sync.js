const fs = require('fs');
const path = require('path');

function createObsidianSyncService({ db, computePlayerIncome }) {
  const DEFAULT_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || 'C:\\Obsidian\\Word Tycoon Vault';
  const DEFAULT_PLAYER_DIR = process.env.OBSIDIAN_PLAYER_SYNC_DIR || path.join('08 Players', 'Profiles');

  function getSyncRoot() {
    return path.join(DEFAULT_VAULT_PATH, DEFAULT_PLAYER_DIR);
  }

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function safeSegment(value) {
    return String(value || 'Unknown')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Unknown';
  }

  function extractHumanSection(existingText, marker) {
    if (!existingText) return '';
    const start = `<!-- ${marker}:START -->`;
    const end = `<!-- ${marker}:END -->`;
    const startIndex = existingText.indexOf(start);
    const endIndex = existingText.indexOf(end);
    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) return '';
    return existingText
      .slice(startIndex + start.length, endIndex)
      .replace(/^\r?\n/, '')
      .replace(/\r?\n$/, '');
  }

  function withHumanSection(marker, preserved, fallback) {
    const body = (preserved && preserved.trim().length > 0) ? preserved : fallback;
    return `<!-- ${marker}:START -->\n${body}\n<!-- ${marker}:END -->`;
  }

  function toMarkdownTable(rows, headers) {
    if (!rows.length) return '_None_';
    const head = `| ${headers.join(' | ')} |`;
    const rule = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
    return [head, rule, body].join('\n');
  }

  function fmtNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('en-US');
  }

  function fmtDecimal(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function buildPlayerFolderName(discordUserId, overview) {
    const displayName =
      overview?.preferences?.preferred_display_name ||
      overview?.primaryPlayer?.display_name ||
      overview?.linkedPlatforms?.[0]?.player?.display_name ||
      overview?.linkedPlatforms?.[0]?.player?.username ||
      discordUserId;
    return `${safeSegment(displayName)} (${safeSegment(discordUserId)})`;
  }

  function buildStandaloneFolderName(player) {
    const displayName = player?.display_name || player?.username || `${player?.platform || 'player'}-${player?.id || 'unknown'}`;
    return `${safeSegment(displayName)} (player-${safeSegment(player?.id)})`;
  }

  function getAllPlayerIds(discordUserId, overview) {
    const ids = new Set(db.getAllPlayerIdsForDiscord(discordUserId));
    if (overview?.primaryPlayer?.id) ids.add(overview.primaryPlayer.id);
    return [...ids];
  }

  function getRecentLedger(playerIds, limit = 25) {
    if (!playerIds.length) return [];
    if (typeof db.getRecentLedgerEntries === 'function') {
      return db.getRecentLedgerEntries(playerIds, limit);
    }
    const placeholders = playerIds.map(() => '?').join(',');
    return db.queryAll(
      `SELECT id, player_id, event_type, command, coins_delta, success, created_at, response
       FROM player_ledger
       WHERE player_id IN (${placeholders})
       ORDER BY id DESC
       LIMIT ?`,
      [...playerIds, limit]
    );
  }

  function getRecentDailyCompletions(playerIds, limit = 20) {
    if (!playerIds.length) return [];
    const placeholders = playerIds.map(() => '?').join(',');
    return db.queryAll(
      `SELECT game, date, coins_awarded, completed_at
       FROM daily_completions
       WHERE player_id IN (${placeholders})
       ORDER BY completed_at DESC
       LIMIT ?`,
      [...playerIds, limit]
    );
  }

  function getRecentWeeklyCompletions(playerIds, limit = 20) {
    if (!playerIds.length) return [];
    const placeholders = playerIds.map(() => '?').join(',');
    return db.queryAll(
      `SELECT game, week_start, coins_awarded, completed_at
       FROM weekly_completions
       WHERE player_id IN (${placeholders})
       ORDER BY completed_at DESC
       LIMIT ?`,
      [...playerIds, limit]
    );
  }

  function getUnifiedLibrary(discordUserId, playerIds) {
    if (!playerIds.length) {
      return { wordCount: 0, level: 0, nextLevelAt: null, words: [], stats: [] };
    }
    const wordCount = playerIds.reduce((sum, pid) => sum + (db.getPlayerLibraryWordCount(pid) || 0), 0);
    const words = db.getPlayerLibraryWords(playerIds, { limit: 50, offset: 0, game: null, search: null });
    const stats = db.getPlayerLibraryStats(playerIds);
    const overview = db.getAccountOverview(discordUserId);
    return {
      wordCount,
      words,
      stats,
      totalLibraryWords: overview.totalLibraryWords || wordCount
    };
  }

  function buildStandaloneOverview(player) {
    return {
      primaryPlayer: player,
      totalLibraryWords: player?.library_words || 0,
      preferences: null,
      linkedPlatforms: [{
        platform: player.platform,
        platformUserId: player.platform_user_id,
        linkedAt: null,
        player
      }],
      businesses: db.getPlayerBusinesses(player.id),
      cosmetics: db.getPlayerOwnedCosmetics(player.id)
    };
  }

  function getStandaloneFriends() {
    return {
      friends: [],
      pending: [],
      friendCount: 0,
      pendingCount: 0
    };
  }

  function getStandalonePlayerIds(limit = 1000) {
    return db.queryAll(
      `SELECT p.id
       FROM players p
       LEFT JOIN linked_accounts la
         ON la.platform = p.platform AND la.platform_user_id = p.platform_user_id
       LEFT JOIN account_preferences ap
         ON ap.primary_player_id = p.id
       WHERE la.discord_user_id IS NULL
         AND ap.discord_user_id IS NULL
       ORDER BY p.last_seen DESC, p.id DESC
       LIMIT ?`,
      [limit]
    ).map((row) => row.id);
  }

  function buildLinkedExport(discordUserId) {
    const overview = db.getAccountOverview(discordUserId);
    if (!overview || !overview.primaryPlayer) {
      return { ok: false, error: `No unified player found for ${discordUserId}` };
    }

    const playerIds = getAllPlayerIds(discordUserId, overview);
    const incomePerSecond = overview.primaryPlayer ? (computePlayerIncome(overview.primaryPlayer.id)?.total || 0) : 0;
    const library = getUnifiedLibrary(discordUserId, playerIds);
    const pending = db.getPendingRequests(discordUserId);
    const friends = {
      friends: db.getFriends(discordUserId),
      pending,
      friendCount: db.getFriendCount(discordUserId),
      pendingCount: pending.length
    };
    const streakState = db.getStreakState(discordUserId);
    const recentLedger = getRecentLedger(playerIds, 25);
    const dailyCompletions = getRecentDailyCompletions(playerIds, 20);
    const weeklyCompletions = getRecentWeeklyCompletions(playerIds, 20);

    const folderName = buildPlayerFolderName(discordUserId, overview);
    const folderPath = path.join(getSyncRoot(), folderName);
    const identity = { kind: 'linked', id: discordUserId };

    return buildExportPayload({
      identity,
      folderPath,
      overview,
      playerIds,
      library,
      friends,
      incomePerSecond,
      streakState,
      recentLedger,
      dailyCompletions,
      weeklyCompletions
    });
  }

  function buildStandaloneExport(playerId) {
    const player = db.getPlayerById(playerId);
    if (!player) {
      return { ok: false, error: `No player found for player-${playerId}` };
    }
    const overview = buildStandaloneOverview(player);
    const playerIds = [player.id];
    const incomePerSecond = computePlayerIncome(player.id)?.total || 0;
    const library = {
      wordCount: db.getPlayerLibraryWordCount(player.id) || 0,
      words: db.getPlayerLibraryWords(playerIds, { limit: 50, offset: 0, game: null, search: null }),
      stats: db.getPlayerLibraryStats(playerIds),
      totalLibraryWords: player.library_words || 0
    };
    const friends = getStandaloneFriends();
    const streakState = null;
    const recentLedger = getRecentLedger(playerIds, 25);
    const dailyCompletions = getRecentDailyCompletions(playerIds, 20);
    const weeklyCompletions = getRecentWeeklyCompletions(playerIds, 20);
    const folderPath = path.join(getSyncRoot(), buildStandaloneFolderName(player));
    const identity = { kind: 'player', id: player.id };

    return buildExportPayload({
      identity,
      folderPath,
      overview,
      playerIds,
      library,
      friends,
      incomePerSecond,
      streakState,
      recentLedger,
      dailyCompletions,
      weeklyCompletions
    });
  }

  function buildExportPayload({
    identity,
    folderPath,
    overview,
    playerIds,
    library,
    friends,
    incomePerSecond,
    streakState,
    recentLedger,
    dailyCompletions,
    weeklyCompletions
  }) {
    const identityId = identity.kind === 'linked' ? identity.id : `player-${identity.id}`;
    const files = [
      {
        name: 'Profile.md',
        build: (existing) => buildProfileMarkdown(identityId, overview, library, friends, incomePerSecond, existing)
      },
      {
        name: 'Stats.md',
        build: (existing) => buildStatsMarkdown(identityId, overview, playerIds, library, incomePerSecond, streakState, existing)
      },
      {
        name: 'Social.md',
        build: (existing) => buildSocialMarkdown(identityId, friends, existing)
      },
      {
        name: 'Game History.md',
        build: (existing) => buildHistoryMarkdown(identityId, recentLedger, dailyCompletions, weeklyCompletions, existing)
      },
      {
        name: 'Tags and Notes.md',
        build: (existing) => buildTagsMarkdown(identityId, overview, existing)
      }
    ].map((file) => {
      const filePath = path.join(folderPath, file.name);
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      return {
        path: filePath,
        name: file.name,
        content: file.build(existing)
      };
    });

    return {
      ok: true,
      identity,
      folderPath,
      primaryPlayerId: overview.primaryPlayer?.id || null,
      files
    };
  }

  function buildProfileMarkdown(discordUserId, overview, library, friends, incomePerSecond, existing) {
    const primary = overview.primaryPlayer;
    const equipped = overview.cosmetics.filter((item) => item.equipped);
    const linkedRows = overview.linkedPlatforms.map((acct) => [
      acct.platform,
      acct.player?.display_name || acct.player?.username || acct.platformUserId,
      acct.platformUserId,
      acct.linkedAt || ''
    ]);
    const equippedRows = equipped.map((item) => [
      item.category,
      item.name,
      item.rarity
    ]);
    const businessRows = overview.businesses
      .sort((a, b) => a.business_type.localeCompare(b.business_type))
      .map((biz) => [biz.business_type, String(biz.level), biz.last_collected_at || '']);
    const human = extractHumanSection(existing, 'HUMAN_NOTES');
    const generatedAt = new Date().toISOString();

    return `---
type: player-profile
discordUserId: ${discordUserId}
primaryPlayerId: ${primary?.id || ''}
generatedAt: ${generatedAt}
---

# ${overview.preferences?.preferred_display_name || primary?.display_name || discordUserId}

<!-- GENERATED:START -->
## Identity
- Discord ID: \`${discordUserId}\`
- Primary Player ID: \`${primary?.id || 'none'}\`
- Display Name: ${primary?.display_name || 'Unknown'}
- Username: ${primary?.username || 'Unknown'}
- XP: ${fmtDecimal(primary?.xp)}
- Total Taps: ${fmtNumber(primary?.total_taps)}
- Library Words: ${fmtNumber(overview.totalLibraryWords || library.totalLibraryWords || 0)}
- Passive Income/sec: ${fmtDecimal(incomePerSecond)}

## Linked Platforms
${toMarkdownTable(linkedRows, ['Platform', 'Display Name', 'Platform User ID', 'Linked At'])}

## Cosmetics
- Equipped Count: ${equipped.length}
- Owned Count: ${overview.cosmetics.length}

### Equipped
${toMarkdownTable(equippedRows, ['Category', 'Name', 'Rarity'])}

## Businesses
${toMarkdownTable(businessRows, ['Business', 'Level', 'Last Collected'])}

## Social
- Friend Count: ${friends.friendCount}
- Pending Requests: ${friends.pendingCount}
<!-- GENERATED:END -->

## Notes
${withHumanSection('HUMAN_NOTES', human, '- Manual notes go here.')}
`;
  }

  function buildStatsMarkdown(discordUserId, overview, playerIds, library, incomePerSecond, streakState, existing) {
    const primary = overview.primaryPlayer || {};
    const gameSummary = playerIds.length > 0 ? (db.getPlayerGameStats(playerIds) || {}) : {};
    const statsRows = Object.entries(gameSummary.games || {})
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([game, details]) => [game, fmtNumber(details?.wins || 0)]);
    const libraryRows = ((library.stats && library.stats.byGame) || []).map((row) => [
      row.game || 'unknown',
      fmtNumber(row.count || row.word_count || row.words || 0)
    ]);
    const human = extractHumanSection(existing, 'HUMAN_STATS_NOTES');
    const generatedAt = new Date().toISOString();

    return `---
type: player-stats
discordUserId: ${discordUserId}
generatedAt: ${generatedAt}
---

# Stats

<!-- GENERATED:START -->
## Core
- XP: ${fmtDecimal(primary.xp)}
- Total Taps: ${fmtNumber(primary.total_taps)}
- Tap Power: ${fmtNumber(primary.tap_power || 1)}
- Crit Chance: ${fmtDecimal(primary.crit_chance || 0)}
- Multi Tap: ${fmtNumber(primary.multi_tap || 1)}
- Income/sec: ${fmtDecimal(incomePerSecond)}

## Streak
- Current Streak: ${fmtNumber(streakState?.current_streak || 0)}
- Longest Streak: ${fmtNumber(streakState?.longest_streak || 0)}
- Total Claims: ${fmtNumber(streakState?.total_claims || 0)}
- Total XP from Claims: ${fmtNumber(streakState?.total_xp_from_claims || 0)}
- Last Claim Date: ${streakState?.last_claim_date || 'None'}

## Game Wins
${toMarkdownTable(statsRows, ['Game', 'Wins'])}
- Total Wins: ${fmtNumber(gameSummary.totalWins || 0)}

## Library Breakdown
${toMarkdownTable(libraryRows, ['Game', 'Words'])}
<!-- GENERATED:END -->

## Analyst Notes
${withHumanSection('HUMAN_STATS_NOTES', human, '- Add interpretation, trends, or anomalies here.')}
`;
  }

  function buildSocialMarkdown(discordUserId, friends, existing) {
    const friendRows = (friends.friends || []).map((friend) => [
      friend.displayName || friend.discordId,
      friend.discordId,
      fmtDecimal(friend.coins || 0),
      fmtNumber(friend.totalWins || 0),
      friend.acceptedAt || ''
    ]);
    const pendingRows = (friends.pending || []).map((request) => [
      request.displayName || request.discordId,
      request.discordId,
      request.createdAt || ''
    ]);
    const human = extractHumanSection(existing, 'HUMAN_SOCIAL_NOTES');
    const generatedAt = new Date().toISOString();

    return `---
type: player-social
discordUserId: ${discordUserId}
generatedAt: ${generatedAt}
---

# Social

<!-- GENERATED:START -->
## Friends
${toMarkdownTable(friendRows, ['Display Name', 'Discord ID', 'Coins', 'Wins', 'Accepted At'])}

## Pending Requests
${toMarkdownTable(pendingRows, ['Display Name', 'Discord ID', 'Created At'])}
<!-- GENERATED:END -->

## Social Notes
${withHumanSection('HUMAN_SOCIAL_NOTES', human, '- Add relationship notes or moderation context here.')}
`;
  }

  function buildHistoryMarkdown(discordUserId, recentLedger, dailyCompletions, weeklyCompletions, existing) {
    const ledgerRows = recentLedger.map((row) => [
      row.created_at || '',
      row.event_type || '',
      row.command || '',
      fmtDecimal(row.coins_delta || 0),
      row.success ? 'yes' : 'no'
    ]);
    const dailyRows = dailyCompletions.map((row) => [
      row.completed_at || '',
      row.game || '',
      row.date || '',
      fmtDecimal(row.coins_awarded || 0)
    ]);
    const weeklyRows = weeklyCompletions.map((row) => [
      row.completed_at || '',
      row.game || '',
      row.week_start || '',
      fmtDecimal(row.coins_awarded || 0)
    ]);
    const human = extractHumanSection(existing, 'HUMAN_HISTORY_NOTES');
    const generatedAt = new Date().toISOString();

    return `---
type: player-history
discordUserId: ${discordUserId}
generatedAt: ${generatedAt}
---

# Game History

<!-- GENERATED:START -->
## Recent Ledger
${toMarkdownTable(ledgerRows, ['When', 'Event', 'Command', 'Coins Delta', 'Success'])}

## Recent Daily Completions
${toMarkdownTable(dailyRows, ['Completed At', 'Game', 'Date', 'Coins'])}

## Recent Weekly Completions
${toMarkdownTable(weeklyRows, ['Completed At', 'Game', 'Week Start', 'Coins'])}
<!-- GENERATED:END -->

## History Notes
${withHumanSection('HUMAN_HISTORY_NOTES', human, '- Add milestone callouts or audit notes here.')}
`;
  }

  function buildTagsMarkdown(discordUserId, overview, existing) {
    const generatedAt = new Date().toISOString();
    const human = extractHumanSection(existing, 'HUMAN_TAGS');
    const linkedPlatforms = overview.linkedPlatforms.map((acct) => acct.platform).join(', ') || 'none';
    const equipped = overview.cosmetics.filter((item) => item.equipped).map((item) => item.name).join(', ') || 'none';

    return `---
type: player-tags
discordUserId: ${discordUserId}
generatedAt: ${generatedAt}
---

# Tags and Notes

<!-- GENERATED:START -->
## Snapshot
- Linked Platforms: ${linkedPlatforms}
- Equipped Cosmetics: ${equipped}
- Cosmetic Visibility: ${overview.preferences?.cosmetic_visibility || 'default'}
<!-- GENERATED:END -->

## Manual Tags
${withHumanSection('HUMAN_TAGS', human, '- Add tags, behavior notes, and custom annotations here.')}
`;
  }

  function buildPlayerExport(identifier) {
    if (typeof identifier === 'number') {
      return buildStandaloneExport(identifier);
    }
    if (typeof identifier === 'string' && identifier.startsWith('player:')) {
      return buildStandaloneExport(parseInt(identifier.slice(7), 10));
    }
    return buildLinkedExport(identifier);
  }

  function syncPlayer(discordUserId) {
    const payload = buildPlayerExport(discordUserId);
    if (!payload.ok) return payload;
    ensureDir(payload.folderPath);
    for (const file of payload.files) {
      fs.writeFileSync(file.path, file.content, 'utf8');
    }
    return {
      ok: true,
      identity: payload.identity,
      discordUserId: payload.identity.kind === 'linked' ? payload.identity.id : null,
      folderPath: payload.folderPath,
      files: payload.files.map((file) => ({ path: file.path, name: file.name }))
    };
  }

  function previewPlayer(discordUserId) {
    return buildPlayerExport(discordUserId);
  }

  function syncAll(limit = 100, includeStandalone = false) {
    const groups = db.getLinkedGroups().slice(0, limit);
    const results = [];
    for (const group of groups) {
      results.push(syncPlayer(group.discordUserId || group.discord_user_id));
    }
    if (includeStandalone) {
      const remaining = Math.max(0, limit - results.length);
      const standaloneIds = getStandalonePlayerIds(remaining);
      for (const playerId of standaloneIds) {
        results.push(syncPlayer(playerId));
      }
    }
    return {
      ok: true,
      total: results.length,
      synced: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      results
    };
  }

  return {
    getSyncRoot,
    previewPlayer,
    syncPlayer,
    syncAll
  };
}

module.exports = { createObsidianSyncService };
