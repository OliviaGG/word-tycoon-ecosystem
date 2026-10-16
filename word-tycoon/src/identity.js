/**
 * Identity Service — owns all linked-account, merge, verification,
 * account-preferences, and account-overview logic.
 *
 * Created via createIdentityService(deps) so it can use the shared
 * DB primitives (queryOne, queryAll, run, save) without circular imports.
 *
 * Phase 2 extraction from database.js (2026-03-20).
 */
const cosmeticsCatalog = require('./cosmetics');
const profileLogosCatalog = require('./profile-logos');
const { canonicalGameId } = require('./game-ids');
const { validateUsername, pickSafeName } = require('./username-moderation');
const { normalizePlatformUserId } = require('./linked-identity');

function createIdentityService(deps) {
  const {
    queryOne,
    queryAll,
    run,
    save,
    recalcLibraryWordCount,
    getLedgerEconomySummary,
    getLedgerPurchaseCounts,
    reassignLedgerPlayerHistory
  } = deps;
  const MANAGED_BUSINESS_MERGE_CONFIG = [
    {
      table: 'pizza_shops',
      upgradesTable: 'pizza_upgrades',
      customizationsTable: 'pizza_customizations',
      textColumns: ['shop_name'],
      maxColumns: ['prestige_level', 'shop_level', 'shop_xp'],
      sumColumns: ['pizza_coins', 'total_pizzas_served', 'total_coins_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'newspaper_routes',
      upgradesTable: 'newspaper_upgrades',
      customizationsTable: 'newspaper_customizations',
      textColumns: ['route_name'],
      maxColumns: ['prestige_level', 'route_level', 'route_xp'],
      sumColumns: ['total_papers_delivered', 'total_xp_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'carwash_shops',
      upgradesTable: 'carwash_upgrades',
      customizationsTable: 'carwash_customizations',
      textColumns: ['shop_name'],
      maxColumns: ['prestige_level', 'shop_level', 'shop_xp'],
      sumColumns: ['clean_cash', 'total_cars_washed', 'total_clean_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'stockmogul_portfolios',
      upgradesTable: 'stockmogul_upgrades',
      customizationsTable: 'stockmogul_customizations',
      textColumns: ['portfolio_name'],
      maxColumns: ['prestige_level', 'portfolio_level', 'portfolio_xp'],
      sumColumns: ['portfolio_coins', 'total_trades', 'total_coins_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'gym_clubs',
      upgradesTable: 'gym_upgrades',
      customizationsTable: 'gym_customizations',
      textColumns: ['club_name'],
      maxColumns: ['prestige_level', 'club_level', 'club_xp'],
      sumColumns: ['gym_points', 'total_members_trained', 'total_points_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'cinema_theaters',
      upgradesTable: 'cinema_upgrades',
      customizationsTable: 'cinema_customizations',
      textColumns: ['theater_name'],
      maxColumns: ['prestige_level', 'theater_level', 'theater_xp'],
      sumColumns: ['total_viewers_served', 'total_xp_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'startup_hubs',
      upgradesTable: 'startup_upgrades',
      customizationsTable: 'startup_customizations',
      textColumns: ['hub_name'],
      maxColumns: ['prestige_level', 'hub_level', 'hub_xp'],
      sumColumns: ['total_users_served', 'total_xp_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    },
    {
      table: 'bank_vaults',
      upgradesTable: 'bank_upgrades',
      customizationsTable: 'bank_customizations',
      textColumns: ['vault_name'],
      maxColumns: ['prestige_level', 'vault_level', 'vault_xp'],
      sumColumns: ['total_clients_served', 'total_xp_earned'],
      earliestColumns: ['last_collected_at', 'created_at']
    }
  ];

  // ==================== LINKED ACCOUNTS CRUD ====================

  function normalizeIdentityText(value) {
    if (value == null) return '';
    return String(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function collectIdentityTokens(...values) {
    const tokens = new Set();
    for (const value of values) {
      const normalized = normalizeIdentityText(value);
      if (normalized) tokens.add(normalized);
    }
    return tokens;
  }

  function hasSharedIdentityToken(left, right) {
    for (const token of left) {
      if (right.has(token)) return true;
    }
    return false;
  }

  function getProfilePicStableKey(profilePic) {
    if (!profilePic) return null;
    const raw = String(profilePic).trim();
    if (!raw) return null;
    const withoutQuery = raw.split('?')[0];
    const match = withoutQuery.match(/\/([^\/?#]+?)(?:~[^\/?#]+)?(?:\.[a-z0-9]+)?$/i);
    if (match?.[1]) return match[1].toLowerCase();
    return withoutQuery.toLowerCase();
  }

  function normalizeDiscordUserId(discordUserId) {
    if (!discordUserId) return null;
    const raw = String(discordUserId);
    return raw.startsWith('discord_') ? raw.slice('discord_'.length) : raw;
  }

  function getLinkedAccounts(discordUserId) {
    if (!discordUserId) return [];
    return queryAll(
      "SELECT * FROM linked_accounts WHERE discord_user_id = ?",
      [discordUserId]
    );
  }

  function hasLinkedAccount(discordUserId) {
    if (!discordUserId) return false;
    const row = queryOne(
      "SELECT COUNT(*) as cnt FROM linked_accounts WHERE discord_user_id = ?",
      [discordUserId]
    );
    return (row?.cnt || 0) > 0;
  }

  function getDiscordUserForPlatform(platform, platformUserId) {
    if (!platform || !platformUserId) return null;
    const normalizedId = normalizePlatformUserId(platform, platformUserId);
    if (platform === 'tiktok' && /^[a-z0-9_.]{1,24}$/.test(normalizedId) && !normalizedId.startsWith('tt_')) {
      const owners = queryAll(
        'SELECT DISTINCT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ? COLLATE NOCASE',
        [platform, normalizedId]
      );
      return owners.length === 1 ? owners[0].discord_user_id : null;
    }
    const row = queryOne(
      "SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ?",
      [platform, platformUserId]
    );
    return row ? row.discord_user_id : null;
  }

  function findDiscordUserForPlatformAlias(platform, platformUserId, username, displayName, profilePic) {
    if (!platform || !platformUserId) return null;
    if (platform !== 'tiktok' && platform !== 'youtube') return null;

    const picKey = getProfilePicStableKey(profilePic);
    if (!picKey) return null;

    const incomingTokens = collectIdentityTokens(username, displayName);
    if (incomingTokens.size === 0) return null;

    const candidates = queryAll(
      `SELECT discord_user_id, username, display_name, profile_pic
         FROM linked_accounts
        WHERE platform = ?
          AND platform_user_id != ?
          AND profile_pic IS NOT NULL
          AND profile_pic LIKE ?`,
      [platform, platformUserId, `%${picKey}%`]
    );

    const matches = new Set();
    for (const candidate of candidates) {
      if (getProfilePicStableKey(candidate.profile_pic) !== picKey) continue;
      const candidateTokens = collectIdentityTokens(candidate.username, candidate.display_name);
      if (candidateTokens.size === 0 || !hasSharedIdentityToken(incomingTokens, candidateTokens)) continue;
      matches.add(candidate.discord_user_id);
    }

    return matches.size === 1 ? [...matches][0] : null;
  }

  function refreshLinkedAccountInfo(platform, platformUserId, displayName, profilePic, username) {
    const acct = queryOne(
      'SELECT id, display_name, username FROM linked_accounts WHERE platform = ? AND platform_user_id = ?',
      [platform, platformUserId]
    );
    if (acct) {
      const safeDisplayName = pickSafeName([displayName, username], { maxLength: 32 }) || acct.display_name || null;
      const safeUsername = pickSafeName([username, displayName], { maxLength: 32 }) || acct.username || null;
      run(
        'UPDATE linked_accounts SET display_name = ?, profile_pic = ?, username = ? WHERE id = ?',
        [safeDisplayName, profilePic, safeUsername, acct.id]
      );
    }
  }

  function backfillLinkedAccountAliases(discordUserId, options = {}) {
    const normalizedDiscordId = normalizeDiscordUserId(discordUserId);
    if (!normalizedDiscordId) return [];

    const targetPlatform = options.platform || null;
    const persist = options.persist !== false;
    const accounts = getLinkedAccounts(normalizedDiscordId)
      .filter((acct) => !targetPlatform || acct.platform === targetPlatform);
    if (accounts.length === 0) return [];

    const linkedKeys = new Set(accounts.map((acct) => `${acct.platform}:${acct.platform_user_id}`));
    const added = [];

    for (const acct of accounts) {
      if (acct.platform !== 'tiktok' && acct.platform !== 'youtube') continue;

      const player = queryOne(
        'SELECT username, display_name, profile_pic FROM players WHERE platform = ? AND platform_user_id = ?',
        [acct.platform, normalizePlatformUserId(acct.platform, acct.platform_user_id)]
      );
      const picKey = getProfilePicStableKey(player?.profile_pic || acct.profile_pic);
      if (!picKey) continue;

      const knownTokens = collectIdentityTokens(
        acct.username,
        acct.display_name,
        player?.username,
        player?.display_name
      );
      if (knownTokens.size === 0) continue;

      const candidates = queryAll(
        `SELECT id, platform, platform_user_id, username, display_name, profile_pic
           FROM players
          WHERE platform = ?
            AND platform_user_id != ?
            AND profile_pic IS NOT NULL
            AND profile_pic LIKE ?
            AND (coins > 0 OR total_taps > 0 OR COALESCE(library_words, 0) > 0)`,
        [acct.platform, acct.platform_user_id, `%${picKey}%`]
      );

      for (const candidate of candidates) {
        const candidateKey = `${candidate.platform}:${candidate.platform_user_id}`;
        if (linkedKeys.has(candidateKey)) continue;
        if (getProfilePicStableKey(candidate.profile_pic) !== picKey) continue;

        const candidateTokens = collectIdentityTokens(candidate.username, candidate.display_name);
        if (candidateTokens.size === 0 || !hasSharedIdentityToken(knownTokens, candidateTokens)) continue;

        const existingLink = queryOne(
          'SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ?',
          [candidate.platform, candidate.platform_user_id]
        );
        if (existingLink) continue;

        run(
          `INSERT OR IGNORE INTO linked_accounts (discord_user_id, discord_username, platform, platform_user_id, display_name, profile_pic, username)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            normalizedDiscordId,
            acct.discord_username || normalizedDiscordId,
            candidate.platform,
            candidate.platform_user_id,
            candidate.display_name || acct.display_name || null,
            candidate.profile_pic || acct.profile_pic || null,
            candidate.username || acct.username || null
          ]
        );
        linkedKeys.add(candidateKey);
        added.push({
          discordUserId: normalizedDiscordId,
          platform: candidate.platform,
          platformUserId: candidate.platform_user_id,
          playerId: candidate.id
        });
      }
    }

    if (added.length > 0 && persist) save();
    return added;
  }

  function createLinkedAccount(discordUserId, discordUsername, platform, platformUserId) {
    const normalizedDiscordId = normalizeDiscordUserId(discordUserId);
    const normalizedDiscordUsername = normalizeDiscordUserId(discordUserId) || normalizedDiscordId;
    platformUserId = normalizePlatformUserId(platform, platformUserId);
    // Repair a legacy mixed-case link in place, preserving its metadata/date.
    if (platform === 'tiktok' && /^[a-z0-9_.]{1,24}$/.test(platformUserId) && !platformUserId.startsWith('tt_')) {
      const owners = queryAll(
        'SELECT DISTINCT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ? COLLATE NOCASE',
        [platform, platformUserId]
      );
      if (owners.some((row) => row.discord_user_id !== normalizedDiscordId)) {
        throw new Error('This platform account is already linked to another account');
      }
      const canonical = queryOne(
        'SELECT id FROM linked_accounts WHERE discord_user_id = ? AND platform = ? AND platform_user_id = ?',
        [normalizedDiscordId, platform, platformUserId]
      );
      const legacy = queryOne(
        'SELECT id FROM linked_accounts WHERE discord_user_id = ? AND platform = ? AND platform_user_id = ? COLLATE NOCASE',
        [normalizedDiscordId, platform, platformUserId]
      );
      if (!canonical && legacy) {
        run('UPDATE linked_accounts SET platform_user_id = ? WHERE id = ?', [platformUserId, legacy.id]);
      }
    }
    const player = queryOne(
      'SELECT id, username, display_name, profile_pic FROM players WHERE platform = ? AND platform_user_id = ?',
      [platform, platformUserId]
    );
    run(
      `INSERT OR IGNORE INTO linked_accounts (discord_user_id, discord_username, platform, platform_user_id, display_name, profile_pic, username)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [normalizedDiscordId, normalizedDiscordUsername, platform, platformUserId, player?.display_name || null, player?.profile_pic || null, player?.username || null]
    );
    backfillLinkedAccountAliases(normalizedDiscordId, { platform, persist: false });
    save();

    // Drain any pending cosmetic grants queued against this platform user.
    if (player && player.id && typeof cosmeticsCatalog.drainPendingGrantsForPlatformUser === 'function') {
      try {
        const result = cosmeticsCatalog.drainPendingGrantsForPlatformUser(
          { run, queryOne, save },
          platform,
          platformUserId,
          player.id
        );
        if (result && result.drained > 0) {
          console.log(`[Identity] Drained ${result.drained} pending cosmetic grant(s) for ${platform}:${platformUserId} → player ${player.id}`);
        }
      } catch (err) {
        console.warn(`[Identity] drainPendingGrants failed for ${platform}:${platformUserId}:`, err.message);
      }
    }
  }

  function unlinkAccount(discordUserId, platform, platformUserId) {
    const normalizedDiscordId = normalizeDiscordUserId(discordUserId);
    run(
      "DELETE FROM linked_accounts WHERE discord_user_id = ? AND platform = ? AND platform_user_id = ?",
      [normalizedDiscordId, platform, platformUserId]
    );
    const remaining = getLinkedAccounts(normalizedDiscordId);
    if (remaining.length === 0) {
      run("DELETE FROM account_preferences WHERE discord_user_id = ?", [normalizedDiscordId]);
    }
    save();
  }

  // ==================== VERIFIED EMAIL ====================

  function upsertVerifiedEmail(platform, platformUserId, email) {
    if (!platform || !platformUserId || !email) return false;
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return false;
    run(
      `INSERT INTO account_emails (platform, platform_user_id, verified_email, verified_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(platform, platform_user_id) DO UPDATE SET
         verified_email = excluded.verified_email,
         verified_at = excluded.verified_at`,
      [platform, platformUserId, normalized]
    );
    // Mirror into linked_accounts.verified_email when a link row exists, for read convenience.
    run(
      "UPDATE linked_accounts SET verified_email = ? WHERE platform = ? AND platform_user_id = ?",
      [normalized, platform, platformUserId]
    );
    save();
    return true;
  }

  function getVerifiedEmail(platform, platformUserId) {
    const row = queryOne(
      "SELECT verified_email FROM account_emails WHERE platform = ? AND platform_user_id = ?",
      [platform, platformUserId]
    );
    return row?.verified_email || null;
  }

  // Find all (platform, platform_user_id) pairs that share a verified email.
  // Returns array sorted oldest-first so the canonical/anchor account is predictable.
  function findAccountsByEmail(email) {
    if (!email) return [];
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return [];
    return queryAll(
      `SELECT platform, platform_user_id, verified_email, verified_at
       FROM account_emails
       WHERE verified_email = ?
       ORDER BY verified_at ASC`,
      [normalized]
    );
  }

  // Convenience: given an email, find the Discord anchor id (if any account
  // sharing this email is already linked to a Discord identity).
  function findDiscordAnchorByEmail(email) {
    const accounts = findAccountsByEmail(email);
    for (const acct of accounts) {
      if (acct.platform === 'discord') return acct.platform_user_id;
      const anchored = queryOne(
        "SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ? LIMIT 1",
        [acct.platform, acct.platform_user_id]
      );
      if (anchored?.discord_user_id) return anchored.discord_user_id;
    }
    return null;
  }

  // Display info for a Discord anchor — used to render the link-confirm page
  // and to build a session user when silent-linking a non-Discord OAuth to a
  // pre-existing Discord identity.
  function getDiscordIdentityDisplayInfo(discordUserId) {
    if (!discordUserId) return null;
    const row = queryOne(
      `SELECT discord_user_id AS id, discord_username, display_name, profile_pic, username
       FROM linked_accounts WHERE discord_user_id = ?
       ORDER BY linked_at ASC LIMIT 1`,
      [discordUserId]
    );
    if (!row) return { id: discordUserId, username: discordUserId, displayName: discordUserId, avatar: null };
    return {
      id: row.id,
      username: row.username || row.discord_username || row.id,
      displayName: row.display_name || row.discord_username || row.username || row.id,
      avatar: row.profile_pic || null
    };
  }

  // Aggregate progression check for an OAuth identity. Used to decide whether
  // an auto-link can happen silently (zero progression) or needs the confirm
  // page (anything beyond a fresh signup). The `platform` argument is the
  // OAuth provider — note the players table's `platform` column is the GAME
  // platform (web/mobile/tiktok) so we match on platform_user_id regardless.
  function getAccountProgressionState(_platform, platformUserId) {
    if (!platformUserId) return { hasProgression: false, reason: 'no_id', indicators: {} };
    const player = queryOne(
      `SELECT id, coins, xp, total_taps, library_words
       FROM players WHERE platform_user_id = ?
       ORDER BY id ASC LIMIT 1`,
      [platformUserId]
    );
    if (!player) {
      return { hasProgression: false, reason: 'no_player', indicators: {} };
    }
    const coins = Number(player.coins) || 0;
    const xp = Number(player.xp) || 0;
    const taps = Number(player.total_taps) || 0;
    const words = Number(player.library_words) || 0;
    let cosmetics = 0;
    try {
      const c = queryOne('SELECT COUNT(*) AS n FROM player_cosmetics WHERE player_id = ?', [player.id]);
      cosmetics = Number(c?.n) || 0;
    } catch (e) { /* table missing or other shape — treat as 0 */ }
    const hasProgression = coins > 0 || xp > 0 || taps > 0 || words > 0 || cosmetics > 0;
    return {
      hasProgression,
      reason: hasProgression ? 'has_progression' : 'empty',
      indicators: { coins, xp, total_taps: taps, library_words: words, cosmetics }
    };
  }

  // ==================== LINK DECLINE PERSISTENCE ====================
  // Records when a user explicitly chose "Keep separate" on the link-confirm
  // page, so we don't re-prompt on every subsequent login.

  function recordLinkDecline(platform, platformUserId, declinedAnchor) {
    if (!platform || !platformUserId || !declinedAnchor) return false;
    run(
      `INSERT OR REPLACE INTO link_declined (platform, platform_user_id, declined_anchor, declined_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [platform, platformUserId, declinedAnchor]
    );
    save();
    return true;
  }

  function hasLinkDecline(platform, platformUserId, declinedAnchor) {
    if (!platform || !platformUserId || !declinedAnchor) return false;
    const row = queryOne(
      `SELECT 1 FROM link_declined WHERE platform = ? AND platform_user_id = ? AND declined_anchor = ?`,
      [platform, platformUserId, declinedAnchor]
    );
    return !!row;
  }

  // ==================== IDENTITY RESOLUTION ====================

  function resolveUnifiedPlayerByDiscord(discordUserId) {
    const normalizedDiscordId = normalizeDiscordUserId(discordUserId);
    if (!normalizedDiscordId) return null;
    const prefs = queryOne(
      "SELECT primary_player_id FROM account_preferences WHERE discord_user_id = ?",
      [normalizedDiscordId]
    );
    if (prefs && prefs.primary_player_id) {
      const primary = queryOne('SELECT * FROM players WHERE id = ?', [prefs.primary_player_id]);
      if (primary) return primary;
    }

    const accounts = queryAll(
      "SELECT platform, platform_user_id FROM linked_accounts WHERE discord_user_id = ?",
      [normalizedDiscordId]
    );

    for (const acct of accounts) {
      if (acct.platform === 'tiktok' || acct.platform === 'youtube') {
        const player = queryOne(
          "SELECT * FROM players WHERE platform = ? AND platform_user_id = ?",
          [acct.platform, normalizePlatformUserId(acct.platform, acct.platform_user_id)]
        );
        if (player) return player;
      }
    }

    for (const acct of accounts) {
      const player = queryOne(
        "SELECT * FROM players WHERE platform = ? AND platform_user_id = ?",
        [acct.platform, normalizePlatformUserId(acct.platform, acct.platform_user_id)]
      );
      if (player) return player;
    }

    const discordPlayer = queryOne(
      "SELECT * FROM players WHERE platform = ? AND platform_user_id = ?",
      ['mobile', `discord_${normalizedDiscordId}`]
    );
    return discordPlayer || null;
  }

  function getUnifiedPlayer(platform, platformUserId) {
    if (!platform || !platformUserId) return null;
    if (platform === 'web') {
      const normalizedDiscordId = String(platformUserId).startsWith('discord_')
        ? String(platformUserId).slice('discord_'.length)
        : String(platformUserId);
      const direct = resolveUnifiedPlayerByDiscord(normalizedDiscordId);
      if (direct) return direct;
    }
    const accountId = getDiscordUserForPlatform(platform, platformUserId);
    if (!accountId) return null;
    return resolveUnifiedPlayerByDiscord(accountId);
  }

  function getAllPlayerIdsForDiscord(discordUserId) {
    const normalizedDiscordId = normalizeDiscordUserId(discordUserId);
    if (!normalizedDiscordId) return [];
    const playerIds = new Set();

    const platformPlayers = queryAll(`
      SELECT p.id FROM linked_accounts la
      JOIN players p ON p.platform = la.platform AND p.platform_user_id = la.platform_user_id
       WHERE la.discord_user_id = ?
    `, [normalizedDiscordId]);
    for (const r of platformPlayers) playerIds.add(r.id);
    // Existing mixed-case TikTok links predate handle normalization.
    for (const acct of getLinkedAccounts(normalizedDiscordId)) {
      const id = normalizePlatformUserId(acct.platform, acct.platform_user_id);
      if (id === acct.platform_user_id) continue;
      const player = queryOne('SELECT id FROM players WHERE platform = ? AND platform_user_id = ?', [acct.platform, id]);
      if (player) playerIds.add(player.id);
    }

    const discordPlayers = queryAll(
      "SELECT id FROM players WHERE platform IN ('discord', 'mobile', 'web') AND (platform_user_id = ? OR platform_user_id = ?)",
      [normalizedDiscordId, `discord_${normalizedDiscordId}`]
    );
    for (const r of discordPlayers) playerIds.add(r.id);

    const pref = queryOne(
      "SELECT primary_player_id FROM account_preferences WHERE discord_user_id = ?",
      [normalizedDiscordId]
    );
    if (pref && pref.primary_player_id) playerIds.add(pref.primary_player_id);

    if (playerIds.size > 0) {
      const USERNAME_RE = /^[a-zA-Z0-9_]{3,40}$/;
      const found = [...playerIds];
      const ph = found.map(() => '?').join(',');
      const names = queryAll(
        `SELECT DISTINCT display_name FROM players
         WHERE id IN (${ph}) AND platform IN ('discord', 'mobile', 'web') AND display_name IS NOT NULL`,
        found
      );
      for (const row of names) {
        if (!USERNAME_RE.test(row.display_name)) continue;
        const extras = queryAll(
          "SELECT id FROM players WHERE platform IN ('discord', 'mobile', 'web') AND platform_user_id = ?",
          [row.display_name]
        );
        for (const e of extras) playerIds.add(e.id);
      }

      const pids = queryAll(
        `SELECT DISTINCT platform_user_id FROM players
         WHERE id IN (${ph}) AND platform IN ('discord', 'mobile', 'web') AND platform_user_id IS NOT NULL`,
        found
      );
      for (const row of pids) {
        if (!USERNAME_RE.test(row.platform_user_id)) continue;
        const extras = queryAll(
          "SELECT id FROM players WHERE platform IN ('discord', 'mobile', 'web') AND display_name = ?",
          [row.platform_user_id]
        );
        for (const e of extras) playerIds.add(e.id);
      }
    }

    return [...playerIds];
  }

  // ==================== VERIFICATION CODES ====================

  function createVerificationCode(code, discordUserId, discordUsername, expiresAt) {
    // Clear any existing unused codes for this Discord user
    run("DELETE FROM verification_codes WHERE discord_user_id = ? AND used = 0", [discordUserId]);
    run(
      `INSERT INTO verification_codes (code, discord_user_id, discord_username, expires_at)
       VALUES (?, ?, ?, ?)`,
      [code, discordUserId, discordUsername, expiresAt]
    );
    save();
  }

  function getVerificationCode(code) {
    return queryOne(
      "SELECT * FROM verification_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')",
      [code]
    );
  }

  function markCodeUsed(codeId) {
    run("UPDATE verification_codes SET used = 1 WHERE id = ?", [codeId]);
    save();
  }

  function cleanupExpiredCodes() {
    run("DELETE FROM verification_codes WHERE expires_at < datetime('now')");
  }

  // ==================== PLAYER MERGE ====================

  /**
   * Legacy merge: combines coins, XP counters, taps, businesses, cosmetics, library, and tap upgrades.
   * Used by admin panel and duplicate cleanup. For account linking, use mergeLinkedAccounts() instead.
   */
  function mergePlayers(keepId, removeId) {
    const keep = queryOne('SELECT * FROM players WHERE id = ?', [keepId]);
    const remove = queryOne('SELECT * FROM players WHERE id = ?', [removeId]);
    if (!keep) return { ok: false, message: `Player ${keepId} not found` };
    if (!remove) return { ok: false, message: `Player ${removeId} not found` };
    if (keepId === removeId) return { ok: false, message: 'Cannot merge a player with itself' };

    // 1. Merge currencies, lifetime word-game XP, taps, and gift coins
    run('UPDATE players SET coins = coins + ?, xp = xp + ?, word_game_xp = COALESCE(word_game_xp, 0) + ?, total_taps = total_taps + ?, gift_coins = gift_coins + ? WHERE id = ?',
      [remove.coins, remove.xp || 0, remove.word_game_xp || 0, remove.total_taps, remove.gift_coins || 0, keep.id]);

    // 2. Keep higher tap upgrades
    if ((remove.tap_power || 1) > (keep.tap_power || 1)) {
      run('UPDATE players SET tap_power = ? WHERE id = ?', [remove.tap_power, keep.id]);
    }
    if ((remove.crit_chance || 0) > (keep.crit_chance || 0)) {
      run('UPDATE players SET crit_chance = ? WHERE id = ?', [remove.crit_chance, keep.id]);
    }
    if ((remove.multi_tap || 1) > (keep.multi_tap || 1)) {
      run('UPDATE players SET multi_tap = ? WHERE id = ?', [remove.multi_tap, keep.id]);
    }
    if (Number(remove.tax_season_bonus_multiplier || 1) > Number(keep.tax_season_bonus_multiplier || 1)) {
      run('UPDATE players SET tax_season_bonus_multiplier = ? WHERE id = ?', [remove.tax_season_bonus_multiplier, keep.id]);
    }
    if (Number(remove.tax_season_completed || 0) > Number(keep.tax_season_completed || 0)) {
      run(
        `UPDATE players
         SET tax_season_completed = ?,
             tax_season_completed_at = ?,
             tax_season_trigger_business = ?,
             tax_season_reset_reason = ?
         WHERE id = ?`,
        [
          remove.tax_season_completed,
          remove.tax_season_completed_at,
          remove.tax_season_trigger_business,
          remove.tax_season_reset_reason,
          keep.id
        ]
      );
    }
    if ((remove.last_seen || '') > (keep.last_seen || '')) {
      run('UPDATE players SET last_seen = ? WHERE id = ?', [remove.last_seen, keep.id]);
    }

    // 3. Move businesses (keep higher level if both own same type)
    _mergeBusinesses(keep.id, remove.id);

    // 4. Preserve historical and managed-player state keyed by player_id.
    _mergePlayerHistory(keep.id, remove.id);
    _mergeManagedBusinessState(keep.id, remove.id);

    // 5. Move cosmetics (skip duplicates, keep equipped state)
    _mergeCosmetics(keep.id, remove.id);

    // 5b. Merge library words (union unique words, recalc count)
    _mergeLibraryWords(keep.id, remove.id);

    run('UPDATE account_preferences SET primary_player_id = ? WHERE primary_player_id = ?', [keep.id, remove.id]);

    // 6. Delete the duplicate player
    run('DELETE FROM players WHERE id = ?', [remove.id]);
    save();

    const merged = queryOne('SELECT * FROM players WHERE id = ?', [keep.id]);
    console.log(`[Identity] Merged player "${remove.display_name}" (id ${remove.id}) into "${keep.display_name}" (id ${keep.id})`);
    return { ok: true, message: `Merged "${remove.display_name}" (id ${remove.id}) into "${keep.display_name}" (id ${keep.id})`, keepPlayer: merged };
  }

  /**
   * Merge two stream platform players (TikTok + YouTube).
   * SUMS coins, xp, word_game_xp, taps, gift_coins. Keeps highest upgrades.
   * Merges businesses (highest level per type, only 1 Library).
   * Unions cosmetics.
   */
  function mergeStreamPlayers(keepId, removeId) {
    const keep = queryOne('SELECT * FROM players WHERE id = ?', [keepId]);
    const remove = queryOne('SELECT * FROM players WHERE id = ?', [removeId]);
    if (!keep) return { ok: false, message: `Player ${keepId} not found` };
    if (!remove) return { ok: false, message: `Player ${removeId} not found` };
    if (keepId === removeId) return { ok: false, message: 'Cannot merge a player with itself' };

    // 1. Sum currencies, lifetime word-game XP, taps, and gift coins
    run('UPDATE players SET coins = coins + ?, xp = xp + ?, word_game_xp = COALESCE(word_game_xp, 0) + ?, total_taps = total_taps + ?, gift_coins = gift_coins + ? WHERE id = ?',
      [remove.coins, remove.xp || 0, remove.word_game_xp || 0, remove.total_taps, remove.gift_coins || 0, keep.id]);

    // 2. Keep higher tap upgrades
    if ((remove.tap_power || 1) > (keep.tap_power || 1)) {
      run('UPDATE players SET tap_power = ? WHERE id = ?', [remove.tap_power, keep.id]);
    }
    if ((remove.crit_chance || 0) > (keep.crit_chance || 0)) {
      run('UPDATE players SET crit_chance = ? WHERE id = ?', [remove.crit_chance, keep.id]);
    }
    if ((remove.multi_tap || 1) > (keep.multi_tap || 1)) {
      run('UPDATE players SET multi_tap = ? WHERE id = ?', [remove.multi_tap, keep.id]);
    }
    if (Number(remove.tax_season_bonus_multiplier || 1) > Number(keep.tax_season_bonus_multiplier || 1)) {
      run('UPDATE players SET tax_season_bonus_multiplier = ? WHERE id = ?', [remove.tax_season_bonus_multiplier, keep.id]);
    }
    if (Number(remove.tax_season_completed || 0) > Number(keep.tax_season_completed || 0)) {
      run(
        `UPDATE players
         SET tax_season_completed = ?,
             tax_season_completed_at = ?,
             tax_season_trigger_business = ?,
             tax_season_reset_reason = ?
         WHERE id = ?`,
        [
          remove.tax_season_completed,
          remove.tax_season_completed_at,
          remove.tax_season_trigger_business,
          remove.tax_season_reset_reason,
          keep.id
        ]
      );
    }
    if ((remove.last_seen || '') > (keep.last_seen || '')) {
      run('UPDATE players SET last_seen = ? WHERE id = ?', [remove.last_seen, keep.id]);
    }

    // 3. Merge businesses (keep highest level per type)
    _mergeBusinesses(keep.id, remove.id);

    // 4. Preserve historical and managed-player state keyed by player_id.
    _mergePlayerHistory(keep.id, remove.id);
    _mergeManagedBusinessState(keep.id, remove.id);

    // 5. Move cosmetics (skip duplicates, keep equipped state)
    _mergeCosmetics(keep.id, remove.id);

    // 5b. Merge library words (union unique words, recalc count)
    _mergeLibraryWords(keep.id, remove.id);

    run('UPDATE account_preferences SET primary_player_id = ? WHERE primary_player_id = ?', [keep.id, remove.id]);

    // 6. Delete the merged player
    run('DELETE FROM players WHERE id = ?', [remove.id]);
    save();

    const merged = queryOne('SELECT * FROM players WHERE id = ?', [keep.id]);
    console.log(`[Identity] mergeStreamPlayers: "${remove.display_name}" (id ${remove.id}) merged into "${keep.display_name}" (id ${keep.id})`);
    return { ok: true, message: `Merged stream accounts`, keepPlayer: merged };
  }

  /**
   * Deprecated compatibility wrapper.
   * Preserves the full player state by delegating to mergePlayers().
   */
  function mergeDiscordPlayerNoCurrency(keepId, removeId) {
    return mergePlayers(keepId, removeId);
  }

  /**
   * Deprecated destructive path.
   * Intentionally fails closed so callers cannot silently delete player stats.
   */
  function discardDiscordPlayer(playerId) {
    const player = queryOne('SELECT * FROM players WHERE id = ?', [playerId]);
    const message = player
      ? `discardDiscordPlayer is disabled for safety. Use mergePlayers/mergeLinkedAccounts instead of deleting "${player.display_name}" (#${playerId}).`
      : `discardDiscordPlayer is disabled for safety. Player #${playerId} was not deleted.`;
    console.warn(`[Identity] ${message}`);
    return { ok: false, message };
  }

  /**
   * Orchestrate a full linked-account merge for a Discord user.
   * Merges stream players together, then folds discord/mobile players into the primary
   * without discarding their stats.
   */
  function mergeLinkedAccounts(discordUserId) {
    const accounts = getLinkedAccounts(discordUserId);

    // Collect ALL player records (all platforms including discord/mobile)
    const allPlayers = [];
    const seen = new Set();

    for (const acct of accounts) {
      // Exact match by (platform, platform_user_id)
      let player = queryOne(
        "SELECT * FROM players WHERE platform = ? AND platform_user_id = ?",
        [acct.platform, normalizePlatformUserId(acct.platform, acct.platform_user_id)]
      );
      // Fallback: a web/mobile/discord player row may exist with platform_user_id
      // matching the linked account's id but a different platform field (happens
      // when an OAuth identity like 'google_<sub>' or 'gh_<id>' plays a web game
      // and the game tags the player row with platform='web' rather than the
      // OAuth provider name). Without this fallback those player rows are orphaned.
      if (!player) {
        player = queryOne(
          "SELECT * FROM players WHERE platform_user_id = ? AND platform IN ('discord','mobile','web') ORDER BY id ASC LIMIT 1",
          [acct.platform_user_id]
        );
      }
      if (player && !seen.has(player.id)) {
        seen.add(player.id);
        allPlayers.push(player);
      }
    }

    // Also find Discord/mobile/web player records keyed by the Discord snowflake
    const discordPlayerRecords = queryAll(
      "SELECT * FROM players WHERE platform IN ('discord', 'mobile', 'web') AND (platform_user_id = ? OR platform_user_id = ?)",
      [discordUserId, `discord_${discordUserId}`]
    );
    for (const dp of discordPlayerRecords) {
      if (!seen.has(dp.id)) {
        seen.add(dp.id);
        allPlayers.push(dp);
      }
    }

    // Separate stream players (tiktok/youtube) from discord/mobile players
    const streamPlatforms = ['tiktok', 'youtube'];
    const streamPlayers = allPlayers.filter(p => streamPlatforms.includes(p.platform));
    const discordPlayers = allPlayers.filter(p => !streamPlatforms.includes(p.platform));

    // Sort stream players so the first becomes the primary (prefer tiktok first)
    streamPlayers.sort((a, b) => {
      if (a.platform === 'tiktok' && b.platform !== 'tiktok') return -1;
      if (b.platform === 'tiktok' && a.platform !== 'tiktok') return 1;
      return 0;
    });

    let merged = 0;
    let preserved = 0;

    // Merge stream players together (TikTok + YouTube stats combined)
    if (streamPlayers.length >= 2) {
      const primary = streamPlayers[0];
      for (let i = 1; i < streamPlayers.length; i++) {
        const result = mergeStreamPlayers(primary.id, streamPlayers[i].id);
        if (result.ok) merged++;
      }
    }

    // Primary is the first stream player, or first discord player if no stream accounts exist
    const primaryId = streamPlayers.length > 0 ? streamPlayers[0].id : (discordPlayers.length > 0 ? discordPlayers[0].id : null);

    // Merge discord/mobile players into primary and preserve all player stats.
    for (const dp of discordPlayers) {
      // If no stream players exist, keep the first discord player as primary.
      if (streamPlayers.length === 0 && dp === discordPlayers[0]) continue;
      if (primaryId) {
        const result = mergePlayers(primaryId, dp.id);
        if (result.ok) {
          merged++;
          preserved++;
        }
      }
    }

    let primaryPlayer = primaryId
      ? queryOne('SELECT * FROM players WHERE id = ?', [primaryId])
      : null;

    // Update account_preferences with the primary player
    if (primaryPlayer) {
      run(
        `INSERT INTO account_preferences (discord_user_id, primary_player_id, merged_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(discord_user_id) DO UPDATE SET
           primary_player_id = excluded.primary_player_id, merged_at = excluded.merged_at`,
        [discordUserId, primaryPlayer.id]
      );
      save();
    }

    // Refresh primary player data
    if (primaryPlayer) {
      primaryPlayer = queryOne('SELECT * FROM players WHERE id = ?', [primaryPlayer.id]);
    }

    console.log(`[Identity] mergeLinkedAccounts: Discord ${discordUserId} — merged ${merged}, preserved ${preserved} discord/mobile accounts, primary=#${primaryPlayer?.id}`);
    return { merged, discarded: 0, preserved, primaryPlayer, accounts };
  }

  // ---- Merge sub-routines (shared by mergePlayers, mergeStreamPlayers, mergeDiscordPlayerNoCurrency) ----

  function _mergeBusinesses(keepId, removeId) {
    const removeBiz = queryAll('SELECT * FROM player_businesses WHERE player_id = ?', [removeId]);
    for (const biz of removeBiz) {
      const existing = queryOne(
        'SELECT * FROM player_businesses WHERE player_id = ? AND business_type = ?',
        [keepId, biz.business_type]
      );
      if (existing) {
        run(
          'UPDATE player_businesses SET level = ?, last_collected_at = ? WHERE id = ?',
          [
            Math.max(Number(biz.level) || 0, Number(existing.level) || 0),
            _pickEarlierTimestamp(existing.last_collected_at, biz.last_collected_at),
            existing.id
          ]
        );
        run('DELETE FROM player_businesses WHERE id = ?', [biz.id]);
      } else {
        run('UPDATE player_businesses SET player_id = ? WHERE id = ?', [keepId, biz.id]);
      }
    }
  }

  function _mergeCosmetics(keepId, removeId) {
    const removeCosmetics = queryAll('SELECT * FROM player_cosmetics WHERE player_id = ?', [removeId]);
    for (const cos of removeCosmetics) {
      const existing = queryOne(
        'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
        [keepId, cos.cosmetic_id]
      );
      if (existing) {
        if (cos.equipped === 1 && existing.equipped === 0) {
          run('UPDATE player_cosmetics SET equipped = 1 WHERE id = ?', [existing.id]);
        }
        run('DELETE FROM player_cosmetics WHERE id = ?', [cos.id]);
      } else {
        run('UPDATE player_cosmetics SET player_id = ? WHERE id = ?', [keepId, cos.id]);
      }
    }
  }

  function _mergeLibraryWords(keepId, removeId) {
    run('INSERT OR IGNORE INTO library_words (player_id, word, game, found_at) SELECT ?, word, game, found_at FROM library_words WHERE player_id = ?', [keepId, removeId]);
    run('DELETE FROM library_words WHERE player_id = ?', [removeId]);
    recalcLibraryWordCount(keepId);
  }

  function _pickEarlierTimestamp(currentValue, incomingValue) {
    if (!currentValue) return incomingValue || currentValue;
    if (!incomingValue) return currentValue;
    return incomingValue < currentValue ? incomingValue : currentValue;
  }

  function _pickPreferredText(currentValue, incomingValue) {
    const current = typeof currentValue === 'string' ? currentValue.trim() : '';
    const incoming = typeof incomingValue === 'string' ? incomingValue.trim() : '';
    if (!current) return incomingValue;
    if (!incoming) return currentValue;
    return current.length >= incoming.length ? currentValue : incomingValue;
  }

  const GAME_WIN_DEDUPE_WINDOW_MS = 5000;

  function _normalizeNullableText(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return text || null;
  }

  function _normalizeNullableNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function _preferredStoredGameId(rawGame) {
    const canonical = canonicalGameId(rawGame);
    switch (canonical) {
      case 'rectangled':
        return 'rectangled';
      case 'erectangled':
        return 'erectangled';
      case 'spelling-bee':
        return 'spelling-bee';
      default:
        return canonical || rawGame;
    }
  }

  function _getGameWinDedupKey(row) {
    const canonical = canonicalGameId(row?.game) || _normalizeNullableText(row?.game);
    return JSON.stringify([
      canonical,
      _normalizeNullableText(row?.event),
      _normalizeNullableNumber(row?.guess_count),
      _normalizeNullableText(row?.word),
      _normalizeNullableNumber(row?.coins_awarded),
      _normalizeNullableNumber(row?.duration_seconds)
    ]);
  }

  function _getTimestampMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isNaN(ms) ? null : ms;
  }

  function _isSameGameWinRound(existing, incoming) {
    if (_getGameWinDedupKey(existing) !== _getGameWinDedupKey(incoming)) return false;
    const existingMs = _getTimestampMs(existing?.created_at);
    const incomingMs = _getTimestampMs(incoming?.created_at);
    if (existingMs === null || incomingMs === null) {
      return String(existing?.created_at || '') === String(incoming?.created_at || '');
    }
    return Math.abs(existingMs - incomingMs) <= GAME_WIN_DEDUPE_WINDOW_MS;
  }

  function _mergePlayerHistory(keepId, removeId) {
    if (typeof reassignLedgerPlayerHistory === 'function') {
      reassignLedgerPlayerHistory(keepId, removeId);
    } else {
      run('UPDATE player_ledger SET player_id = ? WHERE player_id = ?', [keepId, removeId]);
    }
    const gameWinColumns = new Set(queryAll('PRAGMA table_info(game_wins)').map(col => col.name));
    const existingWinRows = queryAll(
      'SELECT * FROM game_wins WHERE player_id = ? ORDER BY created_at ASC, id ASC',
      [keepId]
    );
    const mergedWinRows = [...existingWinRows];
    const removeWinRows = queryAll(
      'SELECT * FROM game_wins WHERE player_id = ? ORDER BY created_at ASC, id ASC',
      [removeId]
    );
    for (const row of removeWinRows) {
      const existing = mergedWinRows.find(candidate => _isSameGameWinRound(candidate, row));
      if (existing) {
        const nextGame = _preferredStoredGameId(existing.game || row.game);
        const nextGuessCount = existing.guess_count ?? row.guess_count ?? null;
        const nextWord = _pickPreferredText(existing.word, row.word) || null;
        const nextCoinsAwarded = Math.max(Number(existing.coins_awarded) || 0, Number(row.coins_awarded) || 0);
        const nextCreatedAt = _pickEarlierTimestamp(existing.created_at, row.created_at);
        const nextDurationSeconds = existing.duration_seconds ?? row.duration_seconds ?? null;

        if (gameWinColumns.has('duration_seconds')) {
          run(
            `UPDATE game_wins
             SET game = ?, guess_count = ?, word = ?, coins_awarded = ?, duration_seconds = ?, created_at = ?
             WHERE id = ?`,
            [nextGame, nextGuessCount, nextWord, nextCoinsAwarded, nextDurationSeconds, nextCreatedAt, existing.id]
          );
        } else {
          run(
            `UPDATE game_wins
             SET game = ?, guess_count = ?, word = ?, coins_awarded = ?, created_at = ?
             WHERE id = ?`,
            [nextGame, nextGuessCount, nextWord, nextCoinsAwarded, nextCreatedAt, existing.id]
          );
        }

        existing.game = nextGame;
        existing.guess_count = nextGuessCount;
        existing.word = nextWord;
        existing.coins_awarded = nextCoinsAwarded;
        existing.created_at = nextCreatedAt;
        if (gameWinColumns.has('duration_seconds')) {
          existing.duration_seconds = nextDurationSeconds;
        }
        run('DELETE FROM game_wins WHERE id = ?', [row.id]);
      } else {
        run('UPDATE game_wins SET player_id = ? WHERE id = ?', [keepId, row.id]);
        mergedWinRows.push({ ...row, player_id: keepId });
      }
    }
    run('UPDATE tax_season_audit SET player_id = ? WHERE player_id = ?', [keepId, removeId]);
    // player_ips has UNIQUE(player_id, ip_address). When both players have
    // hit the same IP, a bare UPDATE would throw a unique-constraint error
    // mid-merge. Iterate: dedupe on collision (keep highest hit_count,
    // earliest first_seen, latest last_seen), repoint otherwise. Same pattern
    // as game_wins / daily_completions above.
    const ipRows = queryAll('SELECT * FROM player_ips WHERE player_id = ?', [removeId]);
    for (const row of ipRows) {
      const existing = queryOne(
        'SELECT * FROM player_ips WHERE player_id = ? AND ip_address = ?',
        [keepId, row.ip_address]
      );
      if (existing) {
        run(
          'UPDATE player_ips SET hit_count = ?, first_seen = ?, last_seen = ?, game = COALESCE(game, ?) WHERE id = ?',
          [
            (Number(existing.hit_count) || 0) + (Number(row.hit_count) || 0),
            _pickEarlierTimestamp(existing.first_seen, row.first_seen),
            (existing.last_seen || '') > (row.last_seen || '') ? existing.last_seen : row.last_seen,
            row.game,
            existing.id
          ]
        );
        run('DELETE FROM player_ips WHERE id = ?', [row.id]);
      } else {
        run('UPDATE player_ips SET player_id = ? WHERE id = ?', [keepId, row.id]);
      }
    }

    const dailyRows = queryAll('SELECT * FROM daily_completions WHERE player_id = ?', [removeId]);
    for (const row of dailyRows) {
      const existing = queryOne(
        'SELECT * FROM daily_completions WHERE player_id = ? AND game = ? AND date = ?',
        [keepId, row.game, row.date]
      );
      if (existing) {
        run(
          'UPDATE daily_completions SET coins_awarded = ?, completed_at = ? WHERE id = ?',
          [
            Math.max(Number(existing.coins_awarded) || 0, Number(row.coins_awarded) || 0),
            _pickEarlierTimestamp(existing.completed_at, row.completed_at),
            existing.id
          ]
        );
        run('DELETE FROM daily_completions WHERE id = ?', [row.id]);
      } else {
        run('UPDATE daily_completions SET player_id = ? WHERE id = ?', [keepId, row.id]);
      }
    }

    const weeklyRows = queryAll('SELECT * FROM weekly_completions WHERE player_id = ?', [removeId]);
    for (const row of weeklyRows) {
      const existing = queryOne(
        'SELECT * FROM weekly_completions WHERE player_id = ? AND game = ? AND week_start = ?',
        [keepId, row.game, row.week_start]
      );
      if (existing) {
        run(
          'UPDATE weekly_completions SET coins_awarded = ?, completed_at = ? WHERE id = ?',
          [
            Math.max(Number(existing.coins_awarded) || 0, Number(row.coins_awarded) || 0),
            _pickEarlierTimestamp(existing.completed_at, row.completed_at),
            existing.id
          ]
        );
        run('DELETE FROM weekly_completions WHERE id = ?', [row.id]);
      } else {
        run('UPDATE weekly_completions SET player_id = ? WHERE id = ?', [keepId, row.id]);
      }
    }

    const generatedRows = queryAll('SELECT * FROM generated_cosmetics WHERE player_id = ?', [removeId]);
    for (const row of generatedRows) {
      const existing = queryOne(
        'SELECT id FROM generated_cosmetics WHERE player_id = ? AND date_awarded = ?',
        [keepId, row.date_awarded]
      );
      if (existing) {
        run('DELETE FROM generated_cosmetics WHERE id = ?', [row.id]);
      } else {
        run('UPDATE generated_cosmetics SET player_id = ? WHERE id = ?', [keepId, row.id]);
      }
    }
  }

  function _mergeManagedBusinessState(keepId, removeId) {
    for (const config of MANAGED_BUSINESS_MERGE_CONFIG) {
      _mergeManagedBusinessTable(keepId, removeId, config);
      _mergePlayerScopedLevels(keepId, removeId, config.upgradesTable, 'upgrade_type');
      _mergePlayerScopedValues(keepId, removeId, config.customizationsTable, 'category', 'value');
    }
  }

  function _mergeManagedBusinessTable(keepId, removeId, config) {
    const keepRow = queryOne(`SELECT * FROM ${config.table} WHERE player_id = ?`, [keepId]);
    const removeRow = queryOne(`SELECT * FROM ${config.table} WHERE player_id = ?`, [removeId]);
    if (!removeRow) return;
    if (!keepRow) {
      run(`UPDATE ${config.table} SET player_id = ? WHERE player_id = ?`, [keepId, removeId]);
      return;
    }

    const nextValues = {};
    for (const column of config.textColumns || []) {
      nextValues[column] = _pickPreferredText(keepRow[column], removeRow[column]);
    }
    for (const column of config.maxColumns || []) {
      nextValues[column] = Math.max(Number(keepRow[column]) || 0, Number(removeRow[column]) || 0);
    }
    for (const column of config.sumColumns || []) {
      nextValues[column] = (Number(keepRow[column]) || 0) + (Number(removeRow[column]) || 0);
    }
    for (const column of config.earliestColumns || []) {
      nextValues[column] = _pickEarlierTimestamp(keepRow[column], removeRow[column]);
    }

    const columns = Object.keys(nextValues);
    if (columns.length > 0) {
      const setClause = columns.map((column) => `${column} = ?`).join(', ');
      const params = columns.map((column) => nextValues[column]);
      run(`UPDATE ${config.table} SET ${setClause} WHERE player_id = ?`, [...params, keepId]);
    }
    run(`DELETE FROM ${config.table} WHERE player_id = ?`, [removeId]);
  }

  function _mergePlayerScopedLevels(keepId, removeId, tableName, uniqueColumn) {
    const removeRows = queryAll(`SELECT * FROM ${tableName} WHERE player_id = ?`, [removeId]);
    for (const row of removeRows) {
      const existing = queryOne(
        `SELECT * FROM ${tableName} WHERE player_id = ? AND ${uniqueColumn} = ?`,
        [keepId, row[uniqueColumn]]
      );
      if (existing) {
        run(
          `UPDATE ${tableName} SET level = ? WHERE id = ?`,
          [Math.max(Number(existing.level) || 0, Number(row.level) || 0), existing.id]
        );
        run(`DELETE FROM ${tableName} WHERE id = ?`, [row.id]);
      } else {
        run(`UPDATE ${tableName} SET player_id = ? WHERE id = ?`, [keepId, row.id]);
      }
    }
  }

  function _mergePlayerScopedValues(keepId, removeId, tableName, uniqueColumn, valueColumn) {
    const removeRows = queryAll(`SELECT * FROM ${tableName} WHERE player_id = ?`, [removeId]);
    for (const row of removeRows) {
      const existing = queryOne(
        `SELECT * FROM ${tableName} WHERE player_id = ? AND ${uniqueColumn} = ?`,
        [keepId, row[uniqueColumn]]
      );
      if (existing) {
        const nextValue = _pickPreferredText(existing[valueColumn], row[valueColumn]);
        run(`UPDATE ${tableName} SET ${valueColumn} = ? WHERE id = ?`, [nextValue, existing.id]);
        run(`DELETE FROM ${tableName} WHERE id = ?`, [row.id]);
      } else {
        run(`UPDATE ${tableName} SET player_id = ? WHERE id = ?`, [keepId, row.id]);
      }
    }
  }

  // ==================== ACCOUNT PREFERENCES ====================

  function normalizeCosmeticVisibility(value) {
    if (value === null || value === undefined || value === '') return '{}';
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        return '{}';
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '{}';

    // Canonical format stores only hidden categories as `false`.
    // Missing keys mean visible; legacy `true` entries are discarded.
    const normalized = {};
    for (const [key, enabled] of Object.entries(parsed)) {
      if (enabled === false) normalized[key] = false;
    }
    return JSON.stringify(normalized);
  }

  function syncPreferredDisplayName(discordUserId, preferredName) {
    const playerIds = getAllPlayerIdsForDiscord(discordUserId);
    if (!playerIds.length) return;

    for (const playerId of playerIds) {
      const player = queryOne(
        'SELECT id, platform, platform_user_id, username, display_name FROM players WHERE id = ?',
        [playerId]
      );
      if (!player) continue;

      let nextDisplayName = preferredName;
      let nextUsername = preferredName;
      if (!nextDisplayName) {
        const linked = queryOne(
          `SELECT display_name, username
           FROM linked_accounts
           WHERE discord_user_id = ? AND platform = ? AND platform_user_id = ?
           ORDER BY linked_at ASC
           LIMIT 1`,
          [discordUserId, player.platform, player.platform_user_id]
        );
        nextDisplayName =
          linked?.display_name ||
          linked?.username ||
          player.username ||
          player.platform_user_id ||
          player.display_name;
        nextUsername =
          linked?.username ||
          linked?.display_name ||
          player.username ||
          player.platform_user_id ||
          player.display_name;
      }

      run('UPDATE players SET display_name = ?, username = ? WHERE id = ?', [nextDisplayName, nextUsername, playerId]);
    }
  }

  function setAccountPreference(discordUserId, field, value) {
    // Ensure the row exists
    run(
      `INSERT OR IGNORE INTO account_preferences (discord_user_id) VALUES (?)`,
      [discordUserId]
    );
    const allowed = ['preferred_pfp_platform', 'preferred_profile_logo_id', 'preferred_display_name', 'primary_player_id', 'cosmetic_visibility', 'custom_avatar_url', 'game_help_seen', 'city_layout', 'city_decorations', 'city_building_style', 'city_district', 'city_sign_text'];
    if (!allowed.includes(field)) return { ok: false, message: `Invalid preference field: ${field}` };
    if (field === 'cosmetic_visibility') {
      value = normalizeCosmeticVisibility(value);
    }
    if (field === 'preferred_profile_logo_id') {
      value = typeof value === 'string' ? value.trim() : value;
      if (!value || value === 'default') value = null;
      if (value) {
        const logo = profileLogosCatalog.getProfileLogoById(value);
        if (!logo) {
          return { ok: false, message: 'Unknown profile logo.' };
        }
        if (!hasProfileLogoUnlocked(discordUserId, value)) {
          return { ok: false, message: 'That profile logo is not unlocked yet.' };
        }
      }
    }
    if (field === 'preferred_display_name') {
      value = typeof value === 'string' ? value.trim().slice(0, 32) : value;
      if (!value) value = null;
      if (value) {
        const validation = validateUsername(value, { maxLength: 32, minLength: 1 });
        if (!validation.valid) {
          return { ok: false, message: validation.message || 'That username is not allowed.' };
        }
        value = validation.sanitized;
      }
    }
    try {
      // Use direct SQL without parameter for column name (sql.js quirk)
      // The value itself is still parameterized for safety
      const safeField = field.replace(/[^a-z_]/g, ''); // sanitize column name
      run(
        `UPDATE account_preferences SET ${safeField} = ? WHERE discord_user_id = ?`,
        [value, discordUserId]
      );
      console.log(`[Prefs] Updated ${safeField} for ${discordUserId} → ${typeof value === 'string' ? value.slice(0, 50) : value}`);
    } catch (e) {
      console.error(`[Prefs] UPDATE failed for field '${field}':`, e.message);
      return { ok: false, message: `DB error: ${e.message}` };
    }
    if (field === 'preferred_display_name') {
      syncPreferredDisplayName(discordUserId, value);
    }
    save();
    return { ok: true };
  }

  function getCosmeticVisibility(discordUserId) {
    if (!discordUserId) return null;
    const row = queryOne(
      'SELECT cosmetic_visibility FROM account_preferences WHERE discord_user_id = ?',
      [discordUserId]
    );
    // No row = user has never saved preferences -> return null so caller can apply defaults
    if (!row) return null;
    // Row exists but field is empty = user explicitly saved (e.g. all categories ON) -> return {}
    if (!row.cosmetic_visibility) return {};
    try { return JSON.parse(normalizeCosmeticVisibility(row.cosmetic_visibility)); } catch (e) { return {}; }
  }

  function getOwnedProfileLogoIds(discordUserId) {
    if (!discordUserId) return [];
    const rows = queryAll(
      'SELECT logo_id FROM account_profile_logos WHERE discord_user_id = ? ORDER BY unlocked_at ASC',
      [discordUserId]
    );
    return rows
      .map((row) => String(row.logo_id || '').trim())
      .filter((logoId) => !!profileLogosCatalog.getProfileLogoById(logoId));
  }

  function hasProfileLogoUnlocked(discordUserId, logoId) {
    const normalizedLogoId = String(logoId || '').trim();
    if (!normalizedLogoId) return false;
    if (profileLogosCatalog.isFreeProfileLogo(normalizedLogoId)) return true;
    if (!discordUserId) return false;
    return !!queryOne(
      'SELECT 1 AS ok FROM account_profile_logos WHERE discord_user_id = ? AND logo_id = ? LIMIT 1',
      [discordUserId, normalizedLogoId]
    );
  }

  function getAccountProfileLogos(discordUserId) {
    const ownedIds = new Set(getOwnedProfileLogoIds(discordUserId));
    const prefs = discordUserId
      ? queryOne(
        'SELECT preferred_profile_logo_id FROM account_preferences WHERE discord_user_id = ?',
        [discordUserId]
      )
      : null;
    const selectedId = String(prefs?.preferred_profile_logo_id || '').trim() || null;

    return profileLogosCatalog.getProfileLogoCatalog().map((logo) => {
      const owned = logo.unlockSource === 'free' || ownedIds.has(logo.id);
      return {
        ...logo,
        owned,
        selected: owned && selectedId === logo.id
      };
    });
  }

  function grantProfileLogo(discordUserId, logoId, source = null) {
    if (!discordUserId) return { ok: false, message: 'Missing discord user id' };
    const logo = profileLogosCatalog.getProfileLogoById(logoId);
    if (!logo) return { ok: false, message: 'Unknown profile logo' };
    if (profileLogosCatalog.isFreeProfileLogo(logo.id)) {
      return { ok: true, granted: false, alreadyOwned: true, logo };
    }
    if (hasProfileLogoUnlocked(discordUserId, logo.id)) {
      return { ok: true, granted: false, alreadyOwned: true, logo };
    }
    run(
      `INSERT OR IGNORE INTO account_profile_logos (discord_user_id, logo_id, source)
       VALUES (?, ?, ?)`,
      [discordUserId, logo.id, source || logo.unlockSource || null]
    );
    save();
    return { ok: true, granted: true, alreadyOwned: false, logo };
  }

  function revokeProfileLogo(discordUserId, logoId) {
    if (!discordUserId) return { ok: false, message: 'Missing discord user id' };
    const logo = profileLogosCatalog.getProfileLogoById(logoId);
    if (!logo) return { ok: false, message: 'Unknown profile logo' };
    if (profileLogosCatalog.isFreeProfileLogo(logo.id)) {
      return { ok: true, revoked: false, logo };
    }
    run(
      'DELETE FROM account_profile_logos WHERE discord_user_id = ? AND logo_id = ?',
      [discordUserId, logo.id]
    );
    run(
      `UPDATE account_preferences
          SET preferred_profile_logo_id = NULL
        WHERE discord_user_id = ? AND preferred_profile_logo_id = ?`,
      [discordUserId, logo.id]
    );
    save();
    return { ok: true, revoked: true, logo };
  }

  function resolveFallbackAccountProfilePic(discordUserId, preferredPfpPlatform) {
    let profilePic = null;
    const pfpPref = preferredPfpPlatform;
    if (pfpPref === 'discord') {
      const row = queryOne(
        "SELECT profile_pic FROM players WHERE platform IN ('discord','mobile') AND platform_user_id = ? AND profile_pic IS NOT NULL AND profile_pic != '' LIMIT 1",
        [discordUserId]
      );
      profilePic = row?.profile_pic || null;
      if (!profilePic) {
        const linkedFallback = queryOne(
          `SELECT profile_pic
             FROM linked_accounts
            WHERE discord_user_id = ?
              AND profile_pic IS NOT NULL
              AND profile_pic != ''
         ORDER BY CASE
                    WHEN platform = 'mobile' THEN 0
                    WHEN platform = 'tiktok' THEN 1
                    WHEN platform = 'youtube' THEN 2
                    ELSE 9
                  END,
                  linked_at ASC
            LIMIT 1`,
          [discordUserId]
        );
        profilePic = linkedFallback?.profile_pic || null;
      }
    } else if (pfpPref && pfpPref !== 'default') {
      const linkedAccount = queryOne(
        'SELECT platform_user_id FROM linked_accounts WHERE discord_user_id = ? AND platform = ?',
        [discordUserId, pfpPref]
      );
      if (linkedAccount) {
        const row = queryOne(
          "SELECT profile_pic FROM players WHERE platform = ? AND platform_user_id = ? AND profile_pic IS NOT NULL AND profile_pic != ''",
          [pfpPref, linkedAccount.platform_user_id]
        );
        profilePic = row?.profile_pic || null;
      }
      if (!profilePic) {
        const linkedFallback = queryOne(
          'SELECT profile_pic FROM linked_accounts WHERE discord_user_id = ? AND platform = ?',
          [discordUserId, pfpPref]
        );
        profilePic = linkedFallback?.profile_pic || null;
      }
    }
    return profilePic;
  }

  function resolveAccountProfileImage(discordUserId) {
    if (!discordUserId) {
      return { profilePic: null, profileLogo: null };
    }
    const prefs = queryOne(
      'SELECT preferred_pfp_platform, preferred_profile_logo_id, custom_avatar_url FROM account_preferences WHERE discord_user_id = ?',
      [discordUserId]
    );
    const customAvatarUrl = String(prefs?.custom_avatar_url || '').trim() || null;
    if (customAvatarUrl) {
      return {
        profilePic: customAvatarUrl,
        profileLogo: null
      };
    }
    const preferredProfileLogoId = String(prefs?.preferred_profile_logo_id || '').trim() || null;
    if (preferredProfileLogoId && hasProfileLogoUnlocked(discordUserId, preferredProfileLogoId)) {
      const profileLogo = profileLogosCatalog.getProfileLogoById(preferredProfileLogoId);
      if (profileLogo) {
        return {
          profilePic: profileLogo.assetPath,
          profileLogo
        };
      }
    }
    return {
      profilePic: resolveFallbackAccountProfilePic(discordUserId, prefs?.preferred_pfp_platform || null),
      profileLogo: null
    };
  }

  // ==================== ACCOUNT OVERVIEW ====================

  /**
   * Get full account overview for admin panel.
   * Returns linked platforms, unified player stats, businesses, cosmetics, and preferences.
   */
  function getAccountOverview(discordUserId) {
    if (!discordUserId) {
      return {
        discordUserId: null,
        primaryPlayer: null,
        totalLibraryWords: 0,
        preferences: null,
        linkedPlatforms: [],
        businesses: [],
        cosmetics: [],
        profileLogos: [],
        selectedProfileLogo: null,
        resolvedProfilePic: null
      };
    }
    const accounts = getLinkedAccounts(discordUserId);
    const prefs = queryOne(
      "SELECT * FROM account_preferences WHERE discord_user_id = ?",
      [discordUserId]
    );
    if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'cosmetic_visibility')) {
      prefs.cosmetic_visibility = normalizeCosmeticVisibility(prefs.cosmetic_visibility);
    }
    const accountProfileLogos = getAccountProfileLogos(discordUserId);
    const selectedProfileLogo = accountProfileLogos.find((logo) => logo.selected) || null;
    const resolvedProfileImage = resolveAccountProfileImage(discordUserId);

    // Find the primary player
    const resolvedPrimaryPlayer = resolveUnifiedPlayerByDiscord(discordUserId);
    const primaryPlayer = prefs?.preferred_display_name && resolvedPrimaryPlayer
      ? { ...resolvedPrimaryPlayer, display_name: prefs.preferred_display_name }
      : resolvedPrimaryPlayer;

    // Collect all platform profile info
    const platformProfiles = [];
    for (const acct of accounts) {
      const player = queryOne(
        "SELECT id, platform, platform_user_id, username, display_name, profile_pic, coins, total_taps FROM players WHERE platform = ? AND platform_user_id = ?",
        [acct.platform, normalizePlatformUserId(acct.platform, acct.platform_user_id)]
      );
      // Prefer per-platform display info from linked_accounts over shared player row
      const displayInfo = {
        username: acct.username || (player ? player.username : acct.platform_user_id),
        display_name: acct.display_name || (player ? player.display_name : null),
        profile_pic: acct.profile_pic || (player ? player.profile_pic : null)
      };
      platformProfiles.push({
        platform: acct.platform,
        platformUserId: acct.platform_user_id,
        linkedAt: acct.linked_at,
        player: player
          ? { ...player, ...displayInfo }
          : displayInfo
      });
    }

    // Build set of ALL linked player IDs (used for businesses + cosmetics)
    const allPlayerIds = new Set(getAllPlayerIdsForDiscord(discordUserId));
    if (primaryPlayer) allPlayerIds.add(primaryPlayer.id);

    const allPlayerIdList = [...allPlayerIds];
    let aggregatedStats = {
      coins: 0,
      xp: 0,
      total_taps: 0,
      gift_coins: 0,
      library_words: 0,
      tap_power: primaryPlayer?.tap_power || 1,
      crit_chance: primaryPlayer?.crit_chance || 0,
      multi_tap: primaryPlayer?.multi_tap || 1,
      tax_season_bonus_multiplier: primaryPlayer?.tax_season_bonus_multiplier || 1,
      total_game_wins: 0,
      last_seen: primaryPlayer?.last_seen || null
    };
    const careerStats = {
      total_game_wins: 0,
      longest_streak: 0,
      total_daily_claims: 0,
      favorite_game: null,
      favorite_game_wins: 0,
      total_daily_puzzles: 0,
      total_weekly_puzzles: 0,
      cosmetics_owned: 0,
      cosmetics_equipped: 0
    };
    const businessStats = {
      businesses_owned: 0,
      total_prestige: 0,
      pizzas_served: 0,
      papers_delivered: 0,
      cars_washed: 0,
      trades_made: 0,
      members_trained: 0,
      viewers_served: 0,
      users_served: 0,
      clients_served: 0,
      business_records: []
    };
    const collectorStats = {
      cosmetics_owned: 0,
      cosmetics_equipped: 0,
      generated_owned: 0,
      legendary_plus_owned: 0,
      hero_badges_owned: 0,
      win_effects_owned: 0,
      titles_owned: 0
    };
    const economyStats = {
      lifetime_coins_earned: 0,
      lifetime_coins_spent: 0,
      gift_coins_earned: 0,
      gift_coins_spent: 0,
      cosmetic_purchases: 0,
      set_purchases: 0
    };
    const collectionStats = {
      fixed_catalog_owned: 0,
      fixed_catalog_total: 0,
      completion_pct: 0,
      store_owned: 0,
      store_total: 0,
      categories_completed: 0,
      total_categories: 0
    };
    const puzzleStats = {
      total_daily_puzzles: 0,
      total_weekly_puzzles: 0,
      current_daily_completed: 0,
      current_weekly_completed: 0,
      favorite_daily_game: null,
      favorite_daily_game_count: 0,
      favorite_weekly_game: null,
      favorite_weekly_game_count: 0
    };
    const passStats = {
      membership_tier: 'free',
      membership_status: 'inactive'
    };
    const gameStats = {
      per_game_wins: [],
      per_game_records: []
    };

    if (allPlayerIdList.length > 0) {
      const placeholders = allPlayerIdList.map(() => '?').join(',');
      const playerRows = queryAll(
        `SELECT coins, xp, total_taps, gift_coins, library_words, tap_power, crit_chance, multi_tap, tax_season_bonus_multiplier, last_seen
         FROM players
         WHERE id IN (${placeholders})`,
        allPlayerIdList
      );
      for (const row of playerRows) {
        aggregatedStats.coins += Number(row.coins) || 0;
        aggregatedStats.xp += Number(row.xp) || 0;
        aggregatedStats.total_taps += Number(row.total_taps) || 0;
        aggregatedStats.gift_coins += Number(row.gift_coins) || 0;
        aggregatedStats.library_words += Number(row.library_words) || 0;
        aggregatedStats.tap_power = Math.max(aggregatedStats.tap_power, Number(row.tap_power) || 1);
        aggregatedStats.crit_chance = Math.max(aggregatedStats.crit_chance, Number(row.crit_chance) || 0);
        aggregatedStats.multi_tap = Math.max(aggregatedStats.multi_tap, Number(row.multi_tap) || 1);
        aggregatedStats.tax_season_bonus_multiplier = Math.max(
          aggregatedStats.tax_season_bonus_multiplier,
          Number(row.tax_season_bonus_multiplier) || 1
        );
        if (!aggregatedStats.last_seen || ((row.last_seen || '') > aggregatedStats.last_seen)) {
          aggregatedStats.last_seen = row.last_seen || aggregatedStats.last_seen;
        }
      }

      const winsRow = queryOne(
        `SELECT COUNT(*) AS cnt FROM game_wins WHERE player_id IN (${placeholders})`,
        allPlayerIdList
      );
      aggregatedStats.total_game_wins = Number(winsRow?.cnt) || 0;
      careerStats.total_game_wins = aggregatedStats.total_game_wins;

      const favoriteGameRow = queryOne(
        `SELECT game, COUNT(*) AS wins
         FROM game_wins
         WHERE player_id IN (${placeholders}) AND game != 'admin'
         GROUP BY game
         ORDER BY wins DESC, game ASC
         LIMIT 1`,
        allPlayerIdList
      );
      if (favoriteGameRow) {
        careerStats.favorite_game = canonicalGameId(favoriteGameRow.game) || favoriteGameRow.game || null;
        careerStats.favorite_game_wins = Number(favoriteGameRow.wins) || 0;
      }

      const gameRecordMap = new Map();
      function ensureGameRecord(game) {
        const key = canonicalGameId(game);
        if (!key) return null;
        if (!gameRecordMap.has(key)) {
          gameRecordMap.set(key, {
            game: key,
            wins: 0,
            unique_words: 0,
            daily_clears: 0,
            weekly_clears: 0,
            average_guesses: null,
            last_win_at: null,
            _guess_sample_count: 0,
            _guess_weighted_total: 0
          });
        }
        return gameRecordMap.get(key);
      }

      const winRows = queryAll(
        `SELECT game,
                COUNT(*) AS wins,
                COUNT(CASE WHEN guess_count IS NOT NULL AND guess_count > 0 THEN 1 END) AS guess_samples,
                AVG(CASE WHEN guess_count IS NOT NULL AND guess_count > 0 THEN guess_count END) AS average_guesses,
                MAX(created_at) AS last_win_at
         FROM game_wins
         WHERE player_id IN (${placeholders}) AND game != 'admin'
         GROUP BY game`,
        allPlayerIdList
      );
      for (const row of winRows) {
        const record = ensureGameRecord(row.game);
        if (!record) continue;
        record.wins += Number(row.wins) || 0;
        const sampleCount = Number(row.guess_samples) || 0;
        if (sampleCount > 0 && row.average_guesses != null) {
          record._guess_sample_count += sampleCount;
          record._guess_weighted_total += (Number(row.average_guesses) || 0) * sampleCount;
          record.average_guesses = record._guess_weighted_total / record._guess_sample_count;
        }
        const rowLastWin = row.last_win_at || null;
        if (rowLastWin && (!record.last_win_at || rowLastWin > record.last_win_at)) {
          record.last_win_at = rowLastWin;
        }
      }

      const wordRows = queryAll(
        `SELECT game, COUNT(*) AS cnt
         FROM (
           SELECT game, LOWER(word) AS normalized_word
           FROM library_words
           WHERE player_id IN (${placeholders}) AND game IS NOT NULL AND game != ''
           GROUP BY game, LOWER(word)
         )
         GROUP BY game`,
        allPlayerIdList
      );
      for (const row of wordRows) {
        const record = ensureGameRecord(row.game);
        if (!record) continue;
        record.unique_words = Number(row.cnt) || 0;
      }

      const perGameDailyRows = queryAll(
        `SELECT game, COUNT(*) AS cnt
         FROM (
           SELECT game, date
           FROM daily_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, date
         )
         GROUP BY game`,
        allPlayerIdList
      );
      for (const row of perGameDailyRows) {
        const record = ensureGameRecord(row.game);
        if (!record) continue;
        record.daily_clears = Number(row.cnt) || 0;
      }

      const perGameWeeklyRows = queryAll(
        `SELECT game, COUNT(*) AS cnt
         FROM (
           SELECT game, week_start
           FROM weekly_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, week_start
         )
         GROUP BY game`,
        allPlayerIdList
      );
      for (const row of perGameWeeklyRows) {
        const record = ensureGameRecord(row.game);
        if (!record) continue;
        record.weekly_clears = Number(row.cnt) || 0;
      }

      gameStats.per_game_records = [...gameRecordMap.values()].map(row => ({
        game: row.game,
        wins: row.wins,
        unique_words: row.unique_words,
        daily_clears: row.daily_clears,
        weekly_clears: row.weekly_clears,
        average_guesses: row.average_guesses == null ? null : Number(row.average_guesses.toFixed(1)),
        last_win_at: row.last_win_at
      })).sort((a, b) => {
        if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        if ((b.unique_words || 0) !== (a.unique_words || 0)) return (b.unique_words || 0) - (a.unique_words || 0);
        const aClearTotal = (a.daily_clears || 0) + (a.weekly_clears || 0);
        const bClearTotal = (b.daily_clears || 0) + (b.weekly_clears || 0);
        if (bClearTotal !== aClearTotal) return bClearTotal - aClearTotal;
        return String(a.game || '').localeCompare(String(b.game || ''));
      });

      gameStats.per_game_wins = gameStats.per_game_records
        .filter(row => Number(row.wins) > 0)
        .map(row => ({
          game: row.game,
          wins: row.wins
        }));

      const dailyPuzzleRow = queryOne(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT game, date
           FROM daily_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, date
         )`,
        allPlayerIdList
      );
      careerStats.total_daily_puzzles = Number(dailyPuzzleRow?.cnt) || 0;
      puzzleStats.total_daily_puzzles = careerStats.total_daily_puzzles;

      const weeklyPuzzleRow = queryOne(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT game, week_start
           FROM weekly_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, week_start
         )`,
        allPlayerIdList
      );
      careerStats.total_weekly_puzzles = Number(weeklyPuzzleRow?.cnt) || 0;
      puzzleStats.total_weekly_puzzles = careerStats.total_weekly_puzzles;

      const dailyGameRow = queryOne(
        `SELECT game, COUNT(*) AS cnt
         FROM (
           SELECT game, date
           FROM daily_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, date
         )
         GROUP BY game
         ORDER BY cnt DESC, game ASC
         LIMIT 1`,
        allPlayerIdList
      );
      if (dailyGameRow) {
        puzzleStats.favorite_daily_game = dailyGameRow.game || null;
        puzzleStats.favorite_daily_game_count = Number(dailyGameRow.cnt) || 0;
      }

      const weeklyGameRow = queryOne(
        `SELECT game, COUNT(*) AS cnt
         FROM (
           SELECT game, week_start
           FROM weekly_completions
           WHERE player_id IN (${placeholders})
           GROUP BY game, week_start
         )
         GROUP BY game
         ORDER BY cnt DESC, game ASC
         LIMIT 1`,
        allPlayerIdList
      );
      if (weeklyGameRow) {
        puzzleStats.favorite_weekly_game = weeklyGameRow.game || null;
        puzzleStats.favorite_weekly_game_count = Number(weeklyGameRow.cnt) || 0;
      }

      if (typeof getLedgerEconomySummary === 'function') {
        const economySummary = getLedgerEconomySummary(allPlayerIdList);
        economyStats.lifetime_coins_earned = economySummary.coinsEarned || 0;
        economyStats.lifetime_coins_spent = economySummary.coinsSpent || 0;
        economyStats.gift_coins_earned = economySummary.giftEarned || 0;
        economyStats.gift_coins_spent = economySummary.giftSpent || 0;
      } else {
        const economyRow = queryOne(
          `SELECT
              SUM(CASE WHEN coins_delta > 0 THEN coins_delta ELSE 0 END) AS coins_earned,
              SUM(CASE WHEN coins_delta < 0 THEN -coins_delta ELSE 0 END) AS coins_spent,
              SUM(CASE WHEN gift_coins_delta > 0 THEN gift_coins_delta ELSE 0 END) AS gift_earned,
              SUM(CASE WHEN gift_coins_delta < 0 THEN -gift_coins_delta ELSE 0 END) AS gift_spent
           FROM player_ledger
           WHERE player_id IN (${placeholders}) AND success = 1`,
          allPlayerIdList
        );
        economyStats.lifetime_coins_earned = Math.floor(Number(economyRow?.coins_earned) || 0);
        economyStats.lifetime_coins_spent = Math.floor(Number(economyRow?.coins_spent) || 0);
        economyStats.gift_coins_earned = Math.floor(Number(economyRow?.gift_earned) || 0);
        economyStats.gift_coins_spent = Math.floor(Number(economyRow?.gift_spent) || 0);
      }

      if (typeof getLedgerPurchaseCounts === 'function') {
        const purchaseCounts = getLedgerPurchaseCounts(allPlayerIdList);
        economyStats.cosmetic_purchases = purchaseCounts.cosmeticPurchases || 0;
        economyStats.set_purchases = purchaseCounts.setPurchases || 0;
      } else {
        const cosmeticPurchaseRow = queryOne(
          `SELECT COUNT(*) AS cnt
           FROM player_ledger
           WHERE player_id IN (${placeholders}) AND success = 1 AND event_type = 'cosmetic'`,
          allPlayerIdList
        );
        economyStats.cosmetic_purchases = Number(cosmeticPurchaseRow?.cnt) || 0;

        const setPurchaseRow = queryOne(
          `SELECT COUNT(*) AS cnt
           FROM player_ledger
           WHERE player_id IN (${placeholders}) AND success = 1 AND (event_type = 'set' OR command LIKE '!buyset%')`,
          allPlayerIdList
        );
        economyStats.set_purchases = Number(setPurchaseRow?.cnt) || 0;
      }
    }

    const streakState = queryOne(
      'SELECT current_streak, longest_streak, total_claims FROM streak_state WHERE discord_user_id = ?',
      [discordUserId]
    );
    if (streakState) {
      careerStats.longest_streak = Number(streakState.longest_streak) || 0;
      careerStats.total_daily_claims = Number(streakState.total_claims) || 0;
    }

    const dailyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.DAILY_TIMEZONE || 'America/Edmonton',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const today = dailyFormatter.format(new Date());
    const weekStart = (() => {
      const d = new Date(today + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    if (allPlayerIdList.length > 0) {
      const placeholders = allPlayerIdList.map(() => '?').join(',');
      const currentDailyRow = queryOne(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT game
           FROM daily_completions
           WHERE player_id IN (${placeholders}) AND date = ?
           GROUP BY game
         )`,
        [...allPlayerIdList, today]
      );
      puzzleStats.current_daily_completed = Number(currentDailyRow?.cnt) || 0;

      const currentWeeklyRow = queryOne(
        `SELECT COUNT(*) AS cnt FROM (
           SELECT game
           FROM weekly_completions
           WHERE player_id IN (${placeholders}) AND week_start = ?
           GROUP BY game
         )`,
        [...allPlayerIdList, weekStart]
      );
      puzzleStats.current_weekly_completed = Number(currentWeeklyRow?.cnt) || 0;
    }

    const accountPrimaryPlayer = primaryPlayer
      ? {
          ...primaryPlayer,
          ...aggregatedStats,
          profile_pic: resolvedProfileImage.profilePic || primaryPlayer.profile_pic || null
        }
      : null;

    // Get businesses merged from ALL linked players
    let businesses = [];
    if (allPlayerIdList.length > 0) {
      const bizPlaceholders = allPlayerIdList.map(() => '?').join(',');
      const allBusinesses = queryAll(
        `SELECT * FROM player_businesses WHERE player_id IN (${bizPlaceholders})`,
        allPlayerIdList
      );
      // Deduplicate by business_type — keep the highest level if duplicates exist
      const bizMap = new Map();
      for (const biz of allBusinesses) {
        const existing = bizMap.get(biz.business_type);
        if (!existing || (biz.level > existing.level)) {
          bizMap.set(biz.business_type, biz);
        }
      }
      businesses = [...bizMap.values()];
      businessStats.businesses_owned = businesses.length;

      const managedStatMap = {
        pizza_shops: {
          business_type: 'pizza',
          name: 'Pizza Shop',
          name_column: 'shop_name',
          prestige: 'prestige_level',
          level: 'shop_level',
          xp: 'shop_xp',
          lifetime: ['pizzas_served', 'total_pizzas_served', 'Pizzas Served'],
          stored: ['pizza_coins', 'Pizza Coins'],
          earned: ['total_coins_earned', 'Coins Earned'],
          last_collected: 'last_collected_at'
        },
        newspaper_routes: {
          business_type: 'newspaper',
          name: 'Newspaper Route',
          name_column: 'route_name',
          prestige: 'prestige_level',
          level: 'route_level',
          xp: 'route_xp',
          lifetime: ['papers_delivered', 'total_papers_delivered', 'Papers Delivered'],
          stored: null,
          earned: ['total_xp_earned', 'XP Earned'],
          last_collected: 'last_collected_at'
        },
        carwash_shops: {
          business_type: 'carwash',
          name: 'Car Wash',
          name_column: 'shop_name',
          prestige: 'prestige_level',
          level: 'shop_level',
          xp: 'shop_xp',
          lifetime: ['cars_washed', 'total_cars_washed', 'Cars Washed'],
          stored: ['clean_cash', 'Clean Cash'],
          earned: ['total_clean_earned', 'Clean Earned'],
          last_collected: 'last_collected_at'
        },
        stockmogul_portfolios: {
          business_type: 'stockmogul',
          name: 'Stock Mogul',
          name_column: 'portfolio_name',
          prestige: 'prestige_level',
          level: 'portfolio_level',
          xp: 'portfolio_xp',
          lifetime: ['trades_made', 'total_trades', 'Trades Made'],
          stored: ['portfolio_coins', 'Portfolio Coins'],
          earned: ['total_coins_earned', 'Coins Earned'],
          last_collected: 'last_collected_at'
        },
        gym_clubs: {
          business_type: 'gym',
          name: 'Gym',
          name_column: 'club_name',
          prestige: 'prestige_level',
          level: 'club_level',
          xp: 'club_xp',
          lifetime: ['members_trained', 'total_members_trained', 'Members Trained'],
          stored: null,
          earned: ['total_points_earned', 'Points Earned'],
          last_collected: 'last_collected_at'
        },
        cinema_theaters: {
          business_type: 'cinema',
          name: 'Movie Theater',
          name_column: 'theater_name',
          prestige: 'prestige_level',
          level: 'theater_level',
          xp: 'theater_xp',
          lifetime: ['viewers_served', 'total_viewers_served', 'Viewers Served'],
          stored: null,
          earned: ['total_xp_earned', 'XP Earned'],
          last_collected: 'last_collected_at'
        },
        startup_hubs: {
          business_type: 'startup',
          name: 'Tech Startup',
          name_column: 'hub_name',
          prestige: 'prestige_level',
          level: 'hub_level',
          xp: 'hub_xp',
          lifetime: ['users_served', 'total_users_served', 'Users Served'],
          stored: null,
          earned: ['total_xp_earned', 'XP Earned'],
          last_collected: 'last_collected_at'
        },
        bank_vaults: {
          business_type: 'bank',
          name: 'Bank',
          name_column: 'vault_name',
          prestige: 'prestige_level',
          level: 'vault_level',
          xp: 'vault_xp',
          lifetime: ['clients_served', 'total_clients_served', 'Clients Served'],
          stored: null,
          earned: ['total_xp_earned', 'XP Earned'],
          last_collected: 'last_collected_at'
        }
      };
      for (const [tableName, config] of Object.entries(managedStatMap)) {
        const rows = queryAll(
          `SELECT ${config.name_column} AS name_value,
                  ${config.prestige} AS prestige_value,
                  ${config.level} AS level_value,
                  ${config.xp} AS xp_value,
                  ${config.lifetime[1]} AS lifetime_value,
                  ${config.stored ? `${config.stored[0]} AS stored_value,` : `NULL AS stored_value,`}
                  ${config.earned ? `${config.earned[0]} AS earned_value,` : `NULL AS earned_value,`}
                  ${config.last_collected} AS last_collected_value
           FROM ${tableName}
           WHERE player_id IN (${bizPlaceholders})`,
          allPlayerIdList
        );
        let maxPrestige = 0;
        let bestRecord = null;
        for (const row of rows) {
          maxPrestige = Math.max(maxPrestige, Number(row.prestige_value) || 0);
          businessStats[config.lifetime[0]] += Number(row.lifetime_value) || 0;
          if (!bestRecord) {
            bestRecord = row;
            continue;
          }
          const currentPrestige = Number(row.prestige_value) || 0;
          const bestPrestige = Number(bestRecord.prestige_value) || 0;
          const currentLevel = Number(row.level_value) || 0;
          const bestLevel = Number(bestRecord.level_value) || 0;
          if (currentPrestige > bestPrestige || (currentPrestige === bestPrestige && currentLevel > bestLevel)) {
            bestRecord = row;
          }
        }
        businessStats.total_prestige += maxPrestige;
        if (rows.length > 0) {
          const totalLifetime = rows.reduce((sum, row) => sum + (Number(row.lifetime_value) || 0), 0);
          const totalEarned = rows.reduce((sum, row) => sum + (Number(row.earned_value) || 0), 0);
          const totalStored = rows.reduce((sum, row) => sum + (Number(row.stored_value) || 0), 0);
          businessStats.business_records.push({
            business_type: config.business_type,
            business_name: (bestRecord && bestRecord.name_value) || config.name,
            prestige_level: Number(bestRecord?.prestige_value) || 0,
            level: Number(bestRecord?.level_value) || 0,
            xp: Number(bestRecord?.xp_value) || 0,
            lifetime_total: totalLifetime,
            lifetime_label: config.lifetime[2],
            stored_value: config.stored ? totalStored : null,
            stored_label: config.stored ? config.stored[1] : null,
            earned_total: config.earned ? totalEarned : null,
            earned_label: config.earned ? config.earned[1] : null,
            last_collected_at: bestRecord?.last_collected_value || null
          });
        }
      }
      businessStats.business_records.sort((a, b) => {
        if ((b.prestige_level || 0) !== (a.prestige_level || 0)) return (b.prestige_level || 0) - (a.prestige_level || 0);
        if ((b.level || 0) !== (a.level || 0)) return (b.level || 0) - (a.level || 0);
        if ((b.lifetime_total || 0) !== (a.lifetime_total || 0)) return (b.lifetime_total || 0) - (a.lifetime_total || 0);
        return String(a.business_name || '').localeCompare(String(b.business_name || ''));
      });
    }

    // Get cosmetics merged from ALL linked players
    let cosmetics = [];
    if (allPlayerIdList.length > 0) {
      const placeholders = allPlayerIdList.map(() => '?').join(',');
      const allCosmetics = queryAll(
        `SELECT pc.cosmetic_id, pc.equipped, pc.seen, pc.player_id, c.category, c.name, c.rarity, c.cost, c.css_property
         FROM player_cosmetics pc
         JOIN cosmetics c ON c.id = pc.cosmetic_id
         WHERE pc.player_id IN (${placeholders})
         ORDER BY c.sort_order`,
        allPlayerIdList
      );
      // Deduplicate by cosmetic_id — keep equipped=1 if ANY player has it
      // equipped, and seen=1 if ANY linked player has seen it.
      const seen = new Map();
      for (const row of allCosmetics) {
        const existing = seen.get(row.cosmetic_id);
        if (!existing) {
          seen.set(row.cosmetic_id, row);
        } else {
          if (row.seen && !existing.seen) existing.seen = 1;
          if (row.equipped && !existing.equipped) {
            row.seen = row.seen || existing.seen;
            seen.set(row.cosmetic_id, row);
          }
        }
      }
      cosmetics = [...seen.values()];
    }
    careerStats.cosmetics_owned = cosmetics.length;
    careerStats.cosmetics_equipped = cosmetics.filter(row => !!row.equipped).length;
    collectorStats.cosmetics_owned = careerStats.cosmetics_owned;
    collectorStats.cosmetics_equipped = careerStats.cosmetics_equipped;
    for (const cosmetic of cosmetics) {
      const id = String(cosmetic.cosmetic_id || '');
      const rarity = String(cosmetic.rarity || '').toLowerCase();
      const category = String(cosmetic.category || '').toLowerCase();
      if (id.startsWith('gen_')) collectorStats.generated_owned++;
      if (rarity === 'legendary' || rarity === 'ultra' || rarity === 'aux') collectorStats.legendary_plus_owned++;
      if (category === 'hero_badge') collectorStats.hero_badges_owned++;
      if (category === 'win_effect') collectorStats.win_effects_owned++;
      if (category === 'title') collectorStats.titles_owned++;
    }

    const fixedCatalog = Array.isArray(cosmeticsCatalog.COSMETICS_CATALOG)
      ? cosmeticsCatalog.COSMETICS_CATALOG
      : [];
    const fixedCatalogIds = new Set(fixedCatalog.map(item => item.id));
    const ownedFixedIds = new Set(
      cosmetics
        .map(row => String(row.cosmetic_id || ''))
        .filter(id => fixedCatalogIds.has(id))
    );
    const storeCatalog = fixedCatalog.filter(item => !cosmeticsCatalog.isBattlePassOnly(item));
    const ownedStoreIds = storeCatalog.filter(item => ownedFixedIds.has(item.id)).length;
    const categoryTotals = new Map();
    const categoryOwned = new Map();
    for (const item of fixedCatalog) {
      const category = String(item.category || 'unknown');
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + 1);
      if (ownedFixedIds.has(item.id)) {
        categoryOwned.set(category, (categoryOwned.get(category) || 0) + 1);
      }
    }
    let categoriesCompleted = 0;
    for (const [category, total] of categoryTotals.entries()) {
      if ((categoryOwned.get(category) || 0) >= total) categoriesCompleted++;
    }
    collectionStats.fixed_catalog_owned = ownedFixedIds.size;
    collectionStats.fixed_catalog_total = fixedCatalog.length;
    collectionStats.completion_pct = fixedCatalog.length ? (ownedFixedIds.size / fixedCatalog.length) * 100 : 0;
    collectionStats.store_owned = ownedStoreIds;
    collectionStats.store_total = storeCatalog.length;
    collectionStats.categories_completed = categoriesCompleted;
    collectionStats.total_categories = categoryTotals.size;

    const membershipRow = queryOne(
      'SELECT tier, status FROM player_memberships WHERE discord_user_id = ?',
      [discordUserId]
    );
    if (membershipRow) {
      passStats.membership_tier = membershipRow.tier || 'free';
      passStats.membership_status = membershipRow.status || 'inactive';
    }
    // Sum library words across all linked players
    const totalLibraryWords = aggregatedStats.library_words || 0;

    return {
      discordUserId,
      primaryPlayer: accountPrimaryPlayer,
      totalLibraryWords,
      preferences: prefs || null,
      linkedPlatforms: platformProfiles,
      businesses,
      cosmetics,
      profileLogos: accountProfileLogos,
      selectedProfileLogo,
      resolvedProfilePic: resolvedProfileImage.profilePic || null,
      careerStats,
      businessStats,
      collectorStats,
      economyStats,
      collectionStats,
      puzzleStats,
      passStats,
      gameStats
    };
  }

  function getCompletionStatus(discordUserId) {
    if (!discordUserId) {
      return {
        discordUserId: null,
        today: null,
        weekStart: null,
        dailyGames: [],
        weeklyGames: []
      };
    }

    const allPlayerIds = [...new Set(getAllPlayerIdsForDiscord(discordUserId))];
    const dailyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.DAILY_TIMEZONE || 'America/Edmonton',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const today = dailyFormatter.format(new Date());
    const weekStart = (() => {
      const d = new Date(today + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();

    if (!allPlayerIds.length) {
      return {
        discordUserId,
        today,
        weekStart,
        dailyGames: [],
        weeklyGames: []
      };
    }

    const placeholders = allPlayerIds.map(() => '?').join(',');
    const dailyRows = queryAll(
      `SELECT DISTINCT game
       FROM daily_completions
       WHERE player_id IN (${placeholders}) AND date = ?`,
      [...allPlayerIds, today]
    );
    const weeklyRows = queryAll(
      `SELECT DISTINCT game
       FROM weekly_completions
       WHERE player_id IN (${placeholders}) AND week_start = ?`,
      [...allPlayerIds, weekStart]
    );

    const normalizeGames = (rows) => [...new Set(
      rows
        .map((row) => canonicalGameId(row?.game) || _normalizeNullableText(row?.game))
        .filter(Boolean)
    )].sort((a, b) => String(a).localeCompare(String(b)));

    return {
      discordUserId,
      today,
      weekStart,
      dailyGames: normalizeGames(dailyRows),
      weeklyGames: normalizeGames(weeklyRows)
    };
  }

  // ==================== LINKED GROUPS & MATCHING ====================

  /**
   * Get all linked account groups for the admin overview.
   */
  function getLinkedGroups() {
    const discordUsers = queryAll(
      `SELECT discord_user_id, MAX(discord_username) as discord_username, MAX(linked_at) as latest
       FROM linked_accounts GROUP BY discord_user_id ORDER BY latest DESC`
    );

    return discordUsers.map(du => {
      const accounts = getLinkedAccounts(du.discord_user_id);
      const prefs = queryOne(
        "SELECT primary_player_id, preferred_display_name FROM account_preferences WHERE discord_user_id = ?",
        [du.discord_user_id]
      );
      const primaryPlayer = prefs?.primary_player_id
        ? queryOne('SELECT id, display_name, xp AS coins, total_taps, last_seen FROM players WHERE id = ?', [prefs.primary_player_id])
        : null;

      const playerIds = getAllPlayerIdsForDiscord(du.discord_user_id);
      let coins = 0;
      for (const pid of playerIds) {
        const p = queryOne('SELECT xp FROM players WHERE id = ?', [pid]);
        if (p) coins += Number(p.xp) || 0;
      }

      return {
        discordUserId: du.discord_user_id,
        discordUsername: du.discord_username,
        platforms: accounts.map(a => ({ platform: a.platform, platformUserId: a.platform_user_id })),
        primaryPlayerId: prefs?.primary_player_id || null,
        coins,
        displayName: prefs?.preferred_display_name || primaryPlayer?.display_name || du.discord_username,
        lastActive: primaryPlayer?.last_seen || null
      };
    });
  }

  function findPotentialMatches(playerId, limit = 10) {
    const player = queryOne('SELECT id, platform, platform_user_id, username, display_name FROM players WHERE id = ?', [playerId]);
    if (!player) return [];

    // Build exclude set: this player + anyone already in the same linked group
    const excludeIds = new Set([playerId]);
    const linkedDiscord = queryOne(
      'SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ?',
      [player.platform, player.platform_user_id]
    );
    if (linkedDiscord) {
      const linkedAccounts = getLinkedAccounts(linkedDiscord.discord_user_id);
      for (const la of linkedAccounts) {
        const lp = queryOne('SELECT id FROM players WHERE platform = ? AND platform_user_id = ?', [la.platform, la.platform_user_id]);
        if (lp) excludeIds.add(lp.id);
      }
      // Also exclude the discord player itself
      const dp = queryOne('SELECT id FROM players WHERE platform IN (?, ?) AND platform_user_id = ?', ['discord', 'mobile', linkedDiscord.discord_user_id]);
      if (dp) excludeIds.add(dp.id);
    }

    const excludePlaceholders = [...excludeIds].map(() => '?').join(',');
    const excludeParams = [...excludeIds];
    const results = new Map();

    // Strategy 1: exact username match on different platform
    if (player.username) {
      const matches = queryAll(
        `SELECT id, platform, platform_user_id, username, display_name, coins
         FROM players WHERE username = ? AND platform != ? AND id NOT IN (${excludePlaceholders})
         LIMIT ?`,
        [player.username, player.platform, ...excludeParams, limit]
      );
      for (const m of matches) {
        if (!results.has(m.id)) results.set(m.id, { ...m, matchReason: 'Exact username match' });
      }
    }

    // Strategy 2: exact display_name match
    if (player.display_name) {
      const matches = queryAll(
        `SELECT id, platform, platform_user_id, username, display_name, coins
         FROM players WHERE display_name = ? AND id != ? AND id NOT IN (${excludePlaceholders})
         LIMIT ?`,
        [player.display_name, playerId, ...excludeParams, limit]
      );
      for (const m of matches) {
        if (!results.has(m.id)) results.set(m.id, { ...m, matchReason: 'Exact display name match' });
      }
    }

    // Strategy 3: LIKE on username (if >= 3 chars)
    if (player.username && player.username.length >= 3) {
      const matches = queryAll(
        `SELECT id, platform, platform_user_id, username, display_name, coins
         FROM players WHERE username LIKE ? AND id NOT IN (${excludePlaceholders})
         LIMIT ?`,
        [`%${player.username}%`, ...excludeParams, limit]
      );
      for (const m of matches) {
        if (!results.has(m.id)) results.set(m.id, { ...m, matchReason: 'Similar username' });
      }
    }

    // Strategy 4: LIKE on display_name (if >= 3 chars)
    if (player.display_name && player.display_name.length >= 3) {
      const matches = queryAll(
        `SELECT id, platform, platform_user_id, username, display_name, coins
         FROM players WHERE display_name LIKE ? AND id NOT IN (${excludePlaceholders})
         LIMIT ?`,
        [`%${player.display_name}%`, ...excludeParams, limit]
      );
      for (const m of matches) {
        if (!results.has(m.id)) results.set(m.id, { ...m, matchReason: 'Similar display name' });
      }
    }

    return [...results.values()].slice(0, limit);
  }

  // ==================== PUBLIC API ====================

  return {
    // Linked accounts CRUD
    createLinkedAccount,
    getLinkedAccounts,
    hasLinkedAccount,
    getDiscordUserForPlatform,
    findDiscordUserForPlatformAlias,
    refreshLinkedAccountInfo,
    backfillLinkedAccountAliases,
    unlinkAccount,

    // Verified email storage and lookup
    upsertVerifiedEmail,
    getVerifiedEmail,
    findAccountsByEmail,
    findDiscordAnchorByEmail,
    getDiscordIdentityDisplayInfo,
    getAccountProgressionState,
    recordLinkDecline,
    hasLinkDecline,

    // Identity resolution
    getUnifiedPlayer,
    resolveUnifiedPlayerByDiscord,
    getAllPlayerIdsForDiscord,

    // Verification codes
    createVerificationCode,
    getVerificationCode,
    markCodeUsed,
    cleanupExpiredCodes,

    // Player merge
    mergePlayers,
    mergeStreamPlayers,
    mergeDiscordPlayerNoCurrency,
    discardDiscordPlayer,
    mergeLinkedAccounts,

    // Account preferences
    normalizeCosmeticVisibility,
    setAccountPreference,
    getCosmeticVisibility,
    getOwnedProfileLogoIds,
    getAccountProfileLogos,
    grantProfileLogo,
    revokeProfileLogo,
    hasProfileLogoUnlocked,
    resolveAccountProfileImage,

    // Account overview & admin
    getAccountOverview,
    getCompletionStatus,
    getLinkedGroups,
    findPotentialMatches
  };
}

module.exports = {
  createIdentityService
};
