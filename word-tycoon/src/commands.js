const businesses = require('./businesses');
const cosmetics = require('./cosmetics');

let gameEngine = null;
let db = null;
let broadcastCosmeticsUpdate = null;
let ledger = null;

function initialize(engine, database, broadcastFn, ledgerModule) {
  gameEngine = engine;
  db = database;
  broadcastCosmeticsUpdate = broadcastFn || null;
  ledger = ledgerModule || null;
}

const COMMANDS = {
  '!play':    { handler: handlePlay,    desc: 'Start playing!',                usage: '!play' },
  '!discord': { handler: handleDiscord, desc: 'Get Discord invite',            usage: '!discord [username]' },
  '!tap':     { handler: handleTap,     desc: 'Manual tap (1/sec)',            usage: '!tap' },
  '!taps':    { handler: handleTaps,    desc: 'Show your tap stats',           usage: '!taps' },
  '!coins':   { handler: handleCoins,   desc: 'Show your coin balance',        usage: '!coins' },
  '!empire':  { handler: handleEmpire,  desc: 'View your businesses',          usage: '!empire' },
  '!buy':     { handler: handleBuy,     desc: 'Buy/upgrade a business',        usage: '!buy [name]' },
  '!upgrade': { handler: handleUpgrade, desc: 'Upgrade tap/crit/multi',        usage: '!upgrade [tap|crit|multi]' },
  '!combo':   { handler: handleCombo,   desc: 'Show combo streak',             usage: '!combo' },
  '!streak':  { handler: handleStreak,  desc: 'Show daily claim streak',       usage: '!streak' },
  '!shop':    { handler: handleShop,    desc: 'Browse cosmetics shop',         usage: '!shop [category]' },
  '!cosmetics': { handler: handleShop,  desc: 'Browse cosmetics shop',         usage: '!cosmetics' },
  '!buyc':    { handler: handleBuyCosmetic, desc: 'Buy a cosmetic',            usage: '!buyc [name] or [rarity] [category]' },
  '!equip':   { handler: handleEquip,   desc: 'Equip a cosmetic',             usage: '!equip [name] or [rarity] [category]' },
  '!unequip': { handler: handleUnequip, desc: 'Unequip a cosmetic',           usage: '!unequip [category]' },
  '!mycos':   { handler: handleMyCosmetics, desc: 'View owned cosmetics',     usage: '!mycos' },
  '!sets':    { handler: handleSets,    desc: 'View cosmetic sets',            usage: '!sets' },
  '!buyset':  { handler: handleBuySet,  desc: 'Buy a gift set',               usage: '!buyset [america|canada]' },
  '!buybest':    { handler: handleBuyBest,    desc: 'Buy best ROI upgrade',          usage: '!buybest' },
  '!buybestmax': { handler: handleBuyBestMax, desc: 'Spend all coins on best ROI',  usage: '!buybestmax' },
  '!help':    { handler: handleHelp,    desc: 'Show game commands',            usage: '!help' },
  '!test':    { handler: handleTest,    desc: 'Preview a cosmetic (30s)',      usage: '!test [name]' },
  '!untest':  { handler: handleUntest,  desc: 'Clear cosmetic preview',        usage: '!untest' },
  '!verify':  { handler: handleVerify,  desc: 'Verify Discord account link',   usage: '!verify [code]' }
};

function isCommand(message) {
  if (!message || typeof message !== 'string') return false;
  const cmd = message.trim().split(/\s+/)[0].toLowerCase();
  return !!COMMANDS[cmd];
}

const COMMAND_EVENT_MAP = {
  '!buy': 'buy', '!upgrade': 'upgrade', '!buyc': 'cosmetic',
  '!buyset': 'set', '!buybest': 'buybest', '!buybestmax': 'buybestmax', '!play': 'play'
};

function handle(msg) {
  const text = (msg.message || '').trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  const entry = COMMANDS[cmd];
  if (!entry) return null;

  const player = gameEngine.getOrCreatePlayer(
    msg.platform,
    msg.user.id,
    msg.user.username,
    msg.user.customNick || msg.user.displayName || msg.user.username
  );

  // Capture balance BEFORE command execution (single currency: XP)
  const freshBefore = db.getPlayerById(player.id);
  const coinsBefore = freshBefore ? (freshBefore.xp || 0) : 0;
  const giftCoinsBefore = freshBefore ? (freshBefore.gift_coins || 0) : 0;

  const result = entry.handler(player, args, msg);

  // Handle async results (handleTap returns a Promise)
  if (result && typeof result.then === 'function') {
    return result.then(res => {
      recordCommandLedger(player, msg, cmd, text, coinsBefore, giftCoinsBefore, res);
      return res;
    });
  }

  // Synchronous result
  recordCommandLedger(player, msg, cmd, text, coinsBefore, giftCoinsBefore, result);
  return result;
}

function recordCommandLedger(player, msg, cmd, text, coinsBefore, giftCoinsBefore, result) {
  if (!ledger) return;
  try {
    const freshAfter = db.getPlayerById(player.id);
    const coinsAfter = freshAfter ? (freshAfter.xp || 0) : coinsBefore;
    const giftCoinsAfter = freshAfter ? (freshAfter.gift_coins || 0) : giftCoinsBefore;

    ledger.record({
      playerId: player.id,
      playerName: player.display_name || player.username,
      platform: msg.platform,
      eventType: COMMAND_EVENT_MAP[cmd] || 'command',
      command: text,
      coinsBefore,
      coinsAfter,
      giftCoinsBefore,
      giftCoinsAfter,
      success: result ? (result.ok ? 1 : 0) : 0,
      response: result ? (result.message || '') : '',
      detail: null
    });
  } catch (err) {
    console.error('[Commands] Ledger record failed:', err.message);
  }
}

function handlePlay(player, args, msg) {
  const freshPlayer = db.getPlayerById(player.id);
  if (!freshPlayer) return { ok: false, message: 'Could not find player. Try again!' };

  // Auto-grant Library if player doesn't have one
  const existingLibrary = db.getPlayerBusiness(freshPlayer.id, 'library');
  let grantedLibrary = false;
  if (!existingLibrary) {
    db.createPlayerBusiness(freshPlayer.id, 'library');
    db.save();
    db.logEvent('play', freshPlayer.display_name, { business: 'Library', auto: true });
    gameEngine.emitTickerEvent('buy', freshPlayer.display_name, 'started their empire with a Library!');
    grantedLibrary = true;
  }

  const parts = [];
  if (grantedLibrary) {
    parts.push(`Welcome ${freshPlayer.display_name}! Your free Library is now collecting words!`);
  } else {
    parts.push(`Welcome back ${freshPlayer.display_name}!`);
  }
  parts.push(`${gameEngine.formatNumber(freshPlayer.xp || 0)} XP`);
  parts.push('!tap to earn | !buy to expand | !shop for cosmetics');

  // On TikTok, prompt to join Discord
  if (msg.platform === 'tiktok') {
    parts.push('Type !discord [YourDiscordName] to join our Discord server!');
  }

  gameEngine.refreshCache();
  gameEngine.emitOverlayUpdate(true);

  return { ok: true, message: parts.join(' | ') };
}

function handleDiscord(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !discord [YourDiscordUsername] — We will send you a server invite via DM!' };
  }

  const discordUsername = args.join(' ').trim();
  const platformLabel = (msg.platform || 'unknown').charAt(0).toUpperCase() + (msg.platform || 'unknown').slice(1);

  // Emit event for the Discord bot to handle
  gameEngine.emitEvent('discord-invite-request', {
    discordUsername,
    platform: msg.platform,
    platformUsername: player.display_name
  });

  return {
    ok: true,
    message: `${player.display_name}: Discord invite request sent to "${discordUsername}"! Check your Discord DMs.`
  };
}

async function handleTap(player, args, msg) {
  const result = await gameEngine.handleManualTap(
    msg.platform,
    msg.user.id,
    msg.user.username,
    msg.user.customNick || msg.user.displayName || msg.user.username
  );
  return result;
}

function handleTaps(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
  const critDef = businesses.getTapUpgradeDef('crit');
  const critLevel = Math.round((freshPlayer.crit_chance || 0) / critDef.chancePerLevel);
  const critMult = (1 + critLevel * critDef.comboMultPerLevel).toFixed(2);
  const multiTap = freshPlayer.multi_tap || 1;
  const combo = gameEngine.getComboInfo(player);
  const parts = [
    `${gameEngine.formatNumber(freshPlayer.total_taps)} taps`,
    `Power: ${freshPlayer.tap_power}x`,
    `Crit: ${critMult}x combo`,
    `Multi: x${multiTap}`
  ];
  if (combo.active) parts.push(`Combo: ${combo.streak} (${combo.multiplier.toFixed(1)}x)`);
  const buffSummary = gameEngine.getPlayerBuffSummary(freshPlayer);
  if (buffSummary.length > 0) parts.push(`Buffs: ${buffSummary.join(', ')}`);
  return { ok: true, message: `${freshPlayer.display_name}: ${parts.join(' | ')}` };
}

function handleCoins(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
  const buffSummary = gameEngine.getPlayerBuffSummary(freshPlayer);
  const buffPart = buffSummary.length > 0 ? ` | Buffs: ${buffSummary.join(', ')}` : '';
  return {
    ok: true,
    message: `${freshPlayer.display_name}: ${gameEngine.formatNumber(freshPlayer.xp || 0)} XP${buffPart}`
  };
}

function handleEmpire(player) {
  return gameEngine.getEmpireInfo(player);
}

function handleBuy(player, args) {
  if (args.length === 0) {
    const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
    if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
    const playerBiz = db.getPlayerBusinesses(freshPlayer.id);
    const ownedMap = {};
    for (const b of playerBiz) ownedMap[b.business_type] = b.level;

    const list = businesses.getBusinessList().map(b => {
      const level = ownedMap[b.type] || 0;
      const def = businesses.getBusinessDef(b.type);
      const nextLevel = level > 0 ? level + 1 : 1;
      const ips = businesses.getIncomePerSecond(b.type, nextLevel);
      const earnStr = gameEngine.formatNumber(ips, ips < 10 ? 1 : 0) + '/s';
      if (def.playtimeUpgrade) {
        if (level > 0) {
          const curIps = businesses.getIncomePerSecond(b.type, level);
          return `${b.emoji} ${b.type} Lv.${level} [${gameEngine.formatNumber(curIps, curIps < 10 ? 1 : 0)}/s] (playtime)`;
        }
        return `${b.emoji} ${b.type} [${earnStr}] (FREE)`;
      }
      const cost = businesses.getCost(b.type, level);
      const costStr = cost === 0 ? 'FREE' : gameEngine.formatNumber(cost);
      if (level > 0) {
        const curIps = businesses.getIncomePerSecond(b.type, level);
        return `${b.emoji} ${b.type} Lv.${level} [${gameEngine.formatNumber(curIps, curIps < 10 ? 1 : 0)}/s -> ${earnStr}] (${costStr})`;
      }
      return `${b.emoji} ${b.type} [${earnStr}] (${costStr})`;
    }).join(' | ');
    return { ok: true, message: `${gameEngine.formatNumber(freshPlayer.xp || 0)} XP | ${list} | !buy [name]` };
  }
  return gameEngine.buyBusiness(player, args[0]);
}

function handleUpgrade(player, args) {
  if (args.length === 0) {
    const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
    if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
    const tapCost = businesses.getTapUpgradeCost('tap', freshPlayer.tap_power);
    const critDef = businesses.getTapUpgradeDef('crit');
    const critLevel = Math.round((freshPlayer.crit_chance || 0) / critDef.chancePerLevel);
    const critMult = (1 + critLevel * critDef.comboMultPerLevel).toFixed(2);
    const critCost = businesses.getTapUpgradeCost('crit', critLevel);
    const multiLevel = freshPlayer.multi_tap || 1;
    const multiCost = businesses.getTapUpgradeCost('multi', multiLevel);
    return {
      ok: true,
      message: `${gameEngine.formatNumber(freshPlayer.xp || 0)} XP | ` +
        `Tap Power Lv.${freshPlayer.tap_power} (${gameEngine.formatNumber(tapCost)}) | ` +
        `Crit ${critMult}x (${gameEngine.formatNumber(critCost)}) | ` +
        `Multi x${multiLevel} (${gameEngine.formatNumber(multiCost)}) | ` +
        `!upgrade [tap|crit|multi]`
    };
  }
  return gameEngine.upgradeTap(player, args[0].toLowerCase());
}

function handleCombo(player) {
  const combo = gameEngine.getComboInfo(player);
  if (!combo.active || combo.streak === 0) {
    return { ok: true, message: `${player.display_name}: No active combo. Keep tapping to build one!` };
  }
  // Calculate the player's actual max combo multiplier (buffs may increase beyond 2x)
  const buffs = cosmetics.getPlayerBuffs(db, player.id);
  const maxMult = 2.0 * (1 + (buffs.combo_boost || 0));
  const critInfo = combo.critStreakMult > 1 ? ` | Crit: ${combo.critStreakMult.toFixed(2)}x` : '';
  return {
    ok: true,
    message: `${player.display_name}: Combo ${combo.streak} streak! (${combo.multiplier.toFixed(1)}x multiplier) | +10% per 10 taps, max ${maxMult.toFixed(1)}x${critInfo}`
  };
}

function handleStreak(player) {
  const discordId = player.platform === 'discord' ? player.platform_user_id : null;
  if (!discordId) {
    return { ok: true, message: `${player.display_name}: Daily claim streaks are only available for Discord-linked accounts.` };
  }
  const status = gameEngine.getDailyClaimStatus(discordId);
  const streak = status.currentStreak || 0;
  const longest = status.longestStreak || 0;
  const canClaim = status.canClaim;
  const nextMilestone = status.nextMilestone;

  let msg = `${player.display_name}: **${streak} day${streak === 1 ? '' : 's'}** streak`;
  if (longest > streak) {
    msg += ` (best: ${longest})`;
  }
  if (canClaim) {
    msg += ` — Claim today for **${status.previewXp.scaled} XP**!`;
  } else {
    msg += ` — Already claimed today.`;
  }
  if (nextMilestone) {
    msg += ` Next milestone: **Day ${nextMilestone.day}** in ${nextMilestone.daysAway} day${nextMilestone.daysAway === 1 ? '' : 's'} (+${nextMilestone.bonusXp} XP)`;
  }
  return { ok: true, message: msg };
}

function handleShop(player, args) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
  const bal = gameEngine.formatNumber(freshPlayer.xp || 0);
  const owned = new Set(cosmetics.getPlayerOwned(db, freshPlayer.id).map(o => o.cosmetic_id));

  // Helper to get buff label text for any item (single or multi-buff)
  function getBuffLabel(item) {
    if (item.buffs) return ` [${item.buffs.map(b => b.label).join(', ')}]`;
    if (item.buff) return ` [${item.buff.label}]`;
    return '';
  }

  // No args — enhanced overview with buff types and rarity breakdown
  if (args.length === 0) {
    const parts = Object.entries(cosmetics.CATEGORY_NAMES).map(([cat, name]) => {
      const counts = cosmetics.getRarityCounts(cat);
      const buffType = cosmetics.CATEGORY_BUFF_TYPE[cat];
      const buffName = cosmetics.BUFF_TYPE_NAMES[buffType] || '';
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const auxCount = counts.aux || 0;
      const dist = `${counts.common}c/${counts.uncommon}uc/${counts.rare}r/${counts.epic}e/${counts.legendary}l/${counts.ultra}u` + (auxCount > 0 ? `/${auxCount}aux` : '');
      return `${name} (${total}) ~${buffName}~ ${dist}`;
    });
    return { ok: true, message: `${bal} XP | OVERVIEW | ${parts.join(' | ')} | !shop [category] or !shop [rarity]` };
  }

  // Try resolving first arg as category or rarity
  const category = cosmetics.resolveCategory(args[0]);
  const rarity = cosmetics.resolveRarity(args[0]);

  if (args.length === 1) {
    if (category) {
      // !shop word → show all items in category with rarity tags
      const items = cosmetics.getCategoryItems(category);
      const list = items.map(item => {
        const tag = owned.has(item.id) ? ' ✓' : '';
        const buffLbl = getBuffLabel(item);
        return `{${item.rarity}} ${item.name} (${cosmetics.formatCost(item.cost)})${buffLbl}${tag}`;
      }).join(' | ');
      return { ok: true, message: `${bal} XP | ${list} | !buyc [name]` };
    }

    if (rarity) {
      // !shop rare → show ALL items of that rarity across all categories
      const items = cosmetics.getItemsByRarity(rarity);
      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      const list = items.map(item => {
        const tag = owned.has(item.id) ? ' ✓' : '';
        const catLabel = cosmetics.CATEGORY_NAMES[item.category] || item.category;
        const buffLbl = getBuffLabel(item);
        return `{${item.rarity}} ${item.name} (${catLabel}) (${cosmetics.formatCost(item.cost)})${buffLbl}${tag}`;
      }).join(' | ');
      return { ok: true, message: `${bal} XP | ${label} Items | ${list} | !buyc [name]` };
    }

    return { ok: false, message: `Unknown category or rarity. Categories: ${Object.values(cosmetics.CATEGORY_NAMES).join(', ')}. Rarities: common, uncommon, rare, epic, legendary, ultra, aux` };
  }

  // Two args — category + rarity filter (either order)
  if (args.length >= 2) {
    const cat = cosmetics.resolveCategory(args[0]) || cosmetics.resolveCategory(args[1]);
    const rar = cosmetics.resolveRarity(args[1]) || cosmetics.resolveRarity(args[0]);

    if (!cat) {
      return { ok: false, message: `Unknown category. Options: ${Object.values(cosmetics.CATEGORY_NAMES).join(', ')}` };
    }
    if (!rar) {
      return { ok: false, message: `Unknown rarity. Options: common, uncommon, rare, epic, legendary, ultra, aux` };
    }

    const items = cosmetics.getItemsByRarity(rar, cat);
    const rarLabel = rar.charAt(0).toUpperCase() + rar.slice(1);
    const catName = cosmetics.CATEGORY_NAMES[cat];

    if (items.length === 0) {
      return { ok: true, message: `${bal} XP | No ${rarLabel} items in ${catName}` };
    }

    const list = items.map(item => {
      const tag = owned.has(item.id) ? ' ✓' : '';
      const buffLbl = getBuffLabel(item);
      return `{${item.rarity}} ${item.name} (${cosmetics.formatCost(item.cost)})${buffLbl}${tag}`;
    }).join(' | ');
    return { ok: true, message: `${bal} XP | ${catName} — ${rarLabel} | ${list} | !buyc [name]` };
  }
}

function handleBuyCosmetic(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !buyc [name] or !buyc [rarity] [category] — e.g. !buyc rare word glow' };
  }
  // Join all args to support multi-word names like "ocean blue"
  const input = args.join(' ').toLowerCase();
  return gameEngine.handleBuyCosmetic(
    msg.platform, msg.user.id, msg.user.username,
    msg.user.customNick || msg.user.displayName || msg.user.username,
    input
  );
}

function handleEquip(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !equip [name] — Use !mycos to see owned' };
  }
  // Join all args to support multi-word names like "ocean blue"
  const input = args.join(' ').toLowerCase();
  return gameEngine.handleEquipCosmetic(msg.platform, msg.user.id, input);
}

function handleUnequip(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: `Usage: !unequip [category] — Categories: ${Object.values(cosmetics.CATEGORY_NAMES).join(', ')}` };
  }
  return gameEngine.handleUnequipCosmetic(msg.platform, msg.user.id, args[0].toLowerCase());
}

function handleMyCosmetics(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };
  const owned = cosmetics.getPlayerOwned(db, freshPlayer.id);

  if (owned.length === 0) {
    return { ok: true, message: 'No cosmetics owned. Use !shop to browse the shop!' };
  }

  const list = owned.map(o => {
    const tag = o.equipped ? ' ✓' : '';
    return `${o.name}${tag}`;
  }).join(' | ');

  // Collect full item objects for equipped cosmetics (for Discord visual cards)
  const equippedItems = owned
    .filter(o => o.equipped)
    .map(o => cosmetics.getCosmeticById(o.cosmetic_id))
    .filter(Boolean);

  const buffSummary = gameEngine.getPlayerBuffSummary(freshPlayer);
  const buffLine = buffSummary.length > 0 ? ` | Buffs: ${buffSummary.join(', ')}` : '';
  return { ok: true, message: `${owned.length} cosmetics: ${list}${buffLine}`, items: equippedItems };
}

function handleSets(player) {
  const freshPlayer = db.getPlayer(player.platform, player.platform_user_id);
  if (!freshPlayer) return { ok: false, message: 'Player not found. Try !tap first.' };

  const status = cosmetics.getPlayerSetStatus(db, freshPlayer.id);
  const bal = gameEngine.formatNumber(freshPlayer.xp || 0);
  const giftBal = freshPlayer.gift_coins ? gameEngine.formatNumber(freshPlayer.gift_coins) : '0';

  const lines = [];
  for (const [setKey, s] of Object.entries(status)) {
    const activeTag = s.active ? ' 🧩 ACTIVE' : '';
    const ownedTag = s.complete ? ' ✅' : ` ${s.owned}/${s.total}`;
    const costStr = s.giftSet
      ? `${cosmetics.formatCost(s.totalCost)} gift XP`
      : `${cosmetics.formatCost(s.totalCost)} XP`;
    const rarLabel = s.rarity.charAt(0).toUpperCase() + s.rarity.slice(1);
    lines.push(`{${rarLabel}} ${s.name} (${costStr})${ownedTag} — ${s.setBonusLabel}${activeTag}`);
  }

  return {
    ok: true,
      message: `${bal} XP | ${giftBal} gift XP | SETS | ${lines.join(' | ')} | !buyset [name] for gift sets`,
    setStatus: status
  };
}

function handleBuySet(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !buyset [america|canada] — Buy a full country set with gift XP from TikTok gifts!' };
  }

  const setKey = args[0].toLowerCase();
  return gameEngine.handleBuySet(
    msg.platform, msg.user.id, msg.user.username,
    msg.user.customNick || msg.user.displayName || msg.user.username,
    setKey
  );
}

function handleTest(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !test [name] — Preview any cosmetic for 30s. Use !shop to browse.' };
  }

  const input = args.join(' ').toLowerCase();
  const result = cosmetics.setTestCosmetic(player.id, input, () => {
    // onExpire callback — broadcast update to revert overlay to real cosmetics
    if (broadcastCosmeticsUpdate) {
      broadcastCosmeticsUpdate(player.platform, player.platform_user_id);
    }
  });

  return result;
}

function handleUntest(player) {
  const cleared = cosmetics.clearTestCosmetic(player.id);
  if (!cleared) {
    return { ok: true, message: 'No active preview to clear.' };
  }
  return { ok: true, message: 'Cosmetic preview cleared.' };
}

function handleVerify(player, args, msg) {
  if (args.length === 0) {
    return { ok: false, message: 'Usage: !verify [code] — Get a code with /link in Discord' };
  }

  const code = args[0].trim();
  const codeRecord = db.getVerificationCode(code);
  if (!codeRecord) {
    return { ok: false, message: 'Invalid or expired code. Get a new one with /link in Discord.' };
  }

  // Mark code as used
  db.markCodeUsed(codeRecord.id);

  // Create the linked account record for this platform
  db.createLinkedAccount(
    codeRecord.discord_user_id,
    codeRecord.discord_username,
    msg.platform,
    msg.user.id
  );

  // Merge linked accounts using Word Tycoon rules:
  // - Discord stats are DISCARDED (not merged)
  // - TikTok + YouTube stats are SUMMED
  // - Only 1 free Library is kept
  const { merged, discarded, primaryPlayer } = db.mergeLinkedAccounts(codeRecord.discord_user_id);

  // Emit account-linked event for Discord bot notification
  const linkedAccounts = db.getLinkedAccounts(codeRecord.discord_user_id);
  const platforms = linkedAccounts.map(a => a.platform);
  gameEngine.emitEvent('account-linked', {
    discordUserId: codeRecord.discord_user_id,
    platform: msg.platform,
    platformUsername: msg.user.customNick || msg.user.displayName || msg.user.username,
    linkedPlatforms: platforms,
    mergedCount: merged,
    discardedCount: discarded
  });

  const platformLabel = msg.platform.charAt(0).toUpperCase() + msg.platform.slice(1);
  const parts = [`${player.display_name} linked their ${platformLabel} account to Discord!`];
  if (merged > 0) parts.push(`Stream accounts merged.`);
  if (discarded > 0) parts.push(`Discord stats cleared — using stream stats only.`);
  if (platforms.length > 1) parts.push(`Synced across ${platforms.length} platforms!`);
  return {
    ok: true,
    message: parts.join(' ')
  };
}

function handleBuyBest(player) {
  return gameEngine.buyBest(player);
}

function handleBuyBestMax(player) {
  return gameEngine.buyBestMax(player);
}

function handleHelp() {
  const lines = Object.entries(COMMANDS).map(([cmd, info]) => `${cmd} - ${info.desc}`);
  return { ok: true, message: `Commands: ${lines.join(' | ')}` };
}

function getCommandList() {
  return Object.entries(COMMANDS).map(([cmd, info]) => ({
    command: cmd,
    description: info.desc,
    usage: info.usage
  }));
}

module.exports = { initialize, isCommand, handle, getCommandList };
