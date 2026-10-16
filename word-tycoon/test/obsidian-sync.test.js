'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { describe, it, beforeEach, afterEach } = require('node:test');

const { createObsidianSyncService } = require('../src/obsidian-sync');
const { registerObsidianSyncRoutes } = require('../src/routes/obsidian-sync');

function makeTempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wt-obsidian-sync-'));
}

function makeDb() {
  const linkedAccounts = [
    {
      platform: 'tiktok',
      platform_user_id: 'tt-jorry',
      linked_at: '2026-03-23 12:00:00',
      player: {
        id: 101,
        platform: 'tiktok',
        platform_user_id: 'tt-jorry',
        username: 'jorry_tt',
        display_name: 'Jorry TikTok',
        coins: 12345,
        total_taps: 678,
        tap_power: 2,
        crit_chance: 0.15,
        multi_tap: 3,
        library_words: 8
      }
    },
    {
      platform: 'discord',
      platform_user_id: 'discord-jorry',
      linked_at: '2026-03-23 12:05:00',
      player: {
        id: 102,
        platform: 'discord',
        platform_user_id: 'discord-jorry',
        username: 'jorry_discord',
        display_name: 'Jorry Discord',
        coins: 54321,
        total_taps: 987,
        tap_power: 4,
        crit_chance: 0.25,
        multi_tap: 2,
        library_words: 9
      }
    }
  ];

  const linkedOverview = {
    discordUserId: 'discord-jorry',
    primaryPlayer: {
      id: 102,
      platform: 'discord',
      platform_user_id: 'discord-jorry',
      username: 'jorry_discord',
      display_name: 'Jorry Prime',
      coins: 54321,
      total_taps: 987,
      tap_power: 4,
      crit_chance: 0.25,
      multi_tap: 2,
      library_words: 9
    },
    totalLibraryWords: 17,
    preferences: {
      preferred_display_name: 'Captain Jorry',
      cosmetic_visibility: 'friends'
    },
    linkedPlatforms: linkedAccounts.map((row) => ({
      platform: row.platform,
      platformUserId: row.platform_user_id,
      linkedAt: row.linked_at,
      player: row.player
    })),
    businesses: [
      { business_type: 'arcade', level: 2, last_collected_at: '2026-03-23 12:10:00' },
      { business_type: 'library', level: 4, last_collected_at: '2026-03-23 12:20:00' }
    ],
    cosmetics: [
      { cosmetic_id: 'hat-1', category: 'hat', name: 'Top Hat', rarity: 'rare', equipped: 1 },
      { cosmetic_id: 'bg-1', category: 'background', name: 'Sunset', rarity: 'common', equipped: 0 }
    ]
  };

  const standalonePlayer = {
    id: 201,
    platform: 'tiktok',
    platform_user_id: 'solo-viewer',
    username: 'solo_viewer',
    display_name: 'Solo Viewer',
    coins: 222,
    total_taps: 33,
    tap_power: 1,
    crit_chance: 0.05,
    multi_tap: 1,
    library_words: 3
  };

  return {
    queryAll(sql, params = []) {
      if (sql.includes('FROM player_ledger')) {
        return [
          { created_at: '2026-03-23 12:30:00', event_type: 'reward', command: 'play', coins_delta: 250, success: 1, response: 'ok' }
        ];
      }
      if (sql.includes('FROM daily_completions')) {
        return [
          { completed_at: '2026-03-23 12:35:00', game: 'rectangled', date: '2026-03-23', coins_awarded: 300 }
        ];
      }
      if (sql.includes('FROM weekly_completions')) {
        return [
          { completed_at: '2026-03-23 12:40:00', game: 'searchle', week_start: '2026-03-17', coins_awarded: 800 }
        ];
      }
      if (sql.includes('FROM players p') && sql.includes('WHERE la.discord_user_id IS NULL')) {
        const limit = params[0] || 1000;
        return [{ id: standalonePlayer.id }].slice(0, limit);
      }
      return [];
    },
    getAllPlayerIdsForDiscord(discordUserId) {
      if (discordUserId === 'discord-jorry') return [101, 102];
      return [];
    },
    getPlayerLibraryWordCount(playerId) {
      if (playerId === 101) return 8;
      if (playerId === 102) return 9;
      if (playerId === 201) return 3;
      return 0;
    },
    getPlayerLibraryWords(playerIds) {
      if (playerIds.includes(201)) {
        return [
          { word: 'solo', game: 'wordle', found_at: '2026-03-23 12:00:00' }
        ];
      }
      return [
        { word: 'crane', game: 'wordle', found_at: '2026-03-23 12:00:00' },
        { word: 'prism', game: 'rectangled', found_at: '2026-03-23 12:05:00' }
      ];
    },
    getPlayerLibraryStats(playerIds) {
      if (playerIds.includes(201)) {
        return { byGame: [{ game: 'wordle', count: 3 }] };
      }
      return {
        byGame: [
          { game: 'wordle', count: 10 },
          { game: 'rectangled', count: 7 }
        ]
      };
    },
    getAccountOverview(discordUserId) {
      if (discordUserId === 'discord-jorry') return linkedOverview;
      return {
        discordUserId: null,
        primaryPlayer: null,
        totalLibraryWords: 0,
        preferences: null,
        linkedPlatforms: [],
        businesses: [],
        cosmetics: []
      };
    },
    getPendingRequests(discordUserId) {
      if (discordUserId !== 'discord-jorry') return [];
      return [
        { displayName: 'Pending Pal', discordId: 'discord-pending', createdAt: '2026-03-23 11:55:00' }
      ];
    },
    getFriends(discordUserId) {
      if (discordUserId !== 'discord-jorry') return [];
      return [
        { displayName: 'Bestie', discordId: 'discord-bestie', coins: 999, totalWins: 44, acceptedAt: '2026-03-23 10:00:00' }
      ];
    },
    getFriendCount(discordUserId) {
      return discordUserId === 'discord-jorry' ? 1 : 0;
    },
    getStreakState(discordUserId) {
      if (discordUserId !== 'discord-jorry') return null;
      return {
        current_streak: 5,
        longest_streak: 11,
        total_claims: 22,
        total_xp_from_claims: 5000,
        last_claim_date: '2026-03-22'
      };
    },
    getPlayerById(playerId) {
      if (playerId === 201) return standalonePlayer;
      if (playerId === 101) return linkedAccounts[0].player;
      if (playerId === 102) return linkedOverview.primaryPlayer;
      return null;
    },
    getPlayerBusinesses(playerId) {
      if (playerId === 201) {
        return [{ business_type: 'library', level: 1, last_collected_at: '2026-03-23 12:00:00' }];
      }
      return linkedOverview.businesses;
    },
    getPlayerOwnedCosmetics(playerId) {
      if (playerId === 201) {
        return [{ cosmetic_id: 'solo-hat', category: 'hat', name: 'Solo Cap', rarity: 'common', equipped: 1 }];
      }
      return linkedOverview.cosmetics;
    },
    getPlayerGameStats(playerIds) {
      if (playerIds.includes(201)) {
        return { totalWins: 2, games: { wordle: { wins: 2 } } };
      }
      return {
        totalWins: 14,
        games: {
          rectangled: { wins: 6 },
          erectangled: { wins: 3 },
          wordle: { wins: 5 }
        }
      };
    },
    getLinkedGroups() {
      return [{ discordUserId: 'discord-jorry' }];
    }
  };
}

function makeRouteApp() {
  const routes = [];
  return {
    routes,
    get(routePath, handler) {
      routes.push({ method: 'GET', path: routePath, handler });
    },
    post(routePath, handler) {
      routes.push({ method: 'POST', path: routePath, handler });
    }
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('obsidian-sync service', () => {
  let prevVaultPath;
  let prevPlayerDir;
  let tempRoot;
  let syncService;

  beforeEach(() => {
    prevVaultPath = process.env.OBSIDIAN_VAULT_PATH;
    prevPlayerDir = process.env.OBSIDIAN_PLAYER_SYNC_DIR;
    tempRoot = makeTempVault();
    process.env.OBSIDIAN_VAULT_PATH = tempRoot;
    process.env.OBSIDIAN_PLAYER_SYNC_DIR = path.join('08 Players', 'Profiles');
    syncService = createObsidianSyncService({
      db: makeDb(),
      computePlayerIncome(playerId) {
        return { total: playerId === 201 ? 1.5 : 42.25 };
      }
    });
  });

  afterEach(() => {
    if (prevVaultPath === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = prevVaultPath;
    if (prevPlayerDir === undefined) delete process.env.OBSIDIAN_PLAYER_SYNC_DIR;
    else process.env.OBSIDIAN_PLAYER_SYNC_DIR = prevPlayerDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('builds linked exports with current game stats', () => {
    const preview = syncService.previewPlayer('discord-jorry');
    assert.strictEqual(preview.ok, true);
    assert.strictEqual(preview.identity.kind, 'linked');
    assert.match(preview.folderPath, /Captain Jorry \(discord-jorry\)$/);

    const statsFile = preview.files.find((file) => file.name === 'Stats.md');
    assert.ok(statsFile);
    assert.match(statsFile.content, /rectangled/i);
    assert.match(statsFile.content, /erectangled/i);
    assert.match(statsFile.content, /wordle/i);
    assert.match(statsFile.content, /Total Wins: 14/);
  });

  it('preserves manual note sections when syncing again', () => {
    const first = syncService.syncPlayer('discord-jorry');
    assert.strictEqual(first.ok, true);

    const profilePath = path.join(first.folderPath, 'Profile.md');
    let profileText = fs.readFileSync(profilePath, 'utf8');
    profileText = profileText.replace(
      '- Manual notes go here.',
      'Keep this operator note.'
    );
    fs.writeFileSync(profilePath, profileText, 'utf8');

    const second = syncService.syncPlayer('discord-jorry');
    assert.strictEqual(second.ok, true);

    const updated = fs.readFileSync(profilePath, 'utf8');
    assert.match(updated, /Keep this operator note\./);
  });

  it('supports standalone player identifiers and includeStandalone syncs', () => {
    const standalone = syncService.previewPlayer('player:201');
    assert.strictEqual(standalone.ok, true);
    assert.strictEqual(standalone.identity.kind, 'player');

    const all = syncService.syncAll(2, true);
    assert.strictEqual(all.ok, true);
    assert.strictEqual(all.total, 2);
    assert.strictEqual(all.synced, 2);
    assert.deepStrictEqual(
      all.results.map((row) => row.identity.kind),
      ['linked', 'player']
    );
  });
});

describe('obsidian-sync routes', () => {
  it('passes includeStandalone through to syncAll', () => {
    const app = makeRouteApp();
    const calls = [];
    registerObsidianSyncRoutes(app, {
      syncService: {
        getSyncRoot() {
          return 'C:\\Vault\\Profiles';
        },
        previewPlayer(identifier) {
          return { ok: true, identifier };
        },
        syncPlayer(identifier) {
          return { ok: true, identifier };
        },
        syncAll(limit, includeStandalone) {
          calls.push({ limit, includeStandalone });
          return { ok: true, total: 0, results: [] };
        }
      }
    });

    const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/api/admin/obsidian-sync/all');
    const res = makeRes();
    route.handler({ query: { limit: '7', includeStandalone: 'true' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls, [{ limit: 7, includeStandalone: true }]);
  });

  it('rejects blank player identifiers before hitting the service', () => {
    const app = makeRouteApp();
    let called = false;
    registerObsidianSyncRoutes(app, {
      syncService: {
        getSyncRoot() {
          return 'C:\\Vault\\Profiles';
        },
        previewPlayer() {
          called = true;
          return { ok: true };
        },
        syncPlayer() {
          called = true;
          return { ok: true };
        },
        syncAll() {
          return { ok: true, total: 0, results: [] };
        }
      }
    });

    const route = app.routes.find((entry) => entry.method === 'GET' && entry.path === '/api/admin/obsidian-sync/player/:identifier/preview');
    const res = makeRes();
    route.handler({ params: { identifier: '   ' } }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(called, false);
    assert.deepStrictEqual(res.body, { ok: false, error: 'Missing player identifier' });
  });
});
