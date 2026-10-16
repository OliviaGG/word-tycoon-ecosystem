/**
 * GOAT Data Adapter
 *
 * Bridges /api/goat (real) → window.__GOAT_API (prototype interface).
 * Caches fetched pages and transforms field names to match the prototype.
 */

let _cache = null;
let _cacheSort = null;
let _eloCache = null;
let _eloCacheSort = null;
let _cheaterCache = null;

async function fetchGoatPage(page, limit, sort) {
  const res = await fetch(`/api/goat?page=${page}&limit=${limit}&sort=${sort}`);
  return res.json();
}

async function fetchEloMap(sort) {
  if (_eloCache && _eloCacheSort === sort) return _eloCache;

  // Default 'elo' sort → global ELO; per-game sort → that game's ELO
  const endpoint = sort === 'elo'
    ? '/api/elo/global/leaderboard?limit=100'
    : `/api/elo/${sort}/leaderboard?limit=100`;

  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    if (!data.players || !Array.isArray(data.players)) {
      _eloCache = {};
      _eloCacheSort = sort;
      return _eloCache;
    }
    const map = {};
    for (const p of data.players) {
      if (p.identityKey) map[p.identityKey] = p.elo || 1200;
    }
    _eloCache = map;
    _eloCacheSort = sort;
    return _eloCache;
  } catch (e) {
    console.log('[goat-data] ELO fetch failed:', e.message);
    _eloCache = {};
    _eloCacheSort = sort;
    return _eloCache;
  }
}

async function getAllPlayers(sort) {
  if (_cache && _cacheSort === sort) return _cache;
  const all = [];
  let page = 1;
  while (page <= 20) {
    const data = await fetchGoatPage(page, 100, sort);
    if (!data.ok || !data.players || !data.players.length) break;
    all.push(...data.players);
    if (page >= data.pagination.pages) break;
    page++;
  }
  _cache = all;
  _cacheSort = sort;
  return all;
}

function transformPlayer(p, eloMap) {
  const titleEntry = (p.equippedCosmetics || []).find(c => c.category === 'title');
  const title = titleEntry ? titleEntry.name : 'Rookie';
  const titleColor = '#9aa7c1';

  const identity = p.discordUserId
    ? `discord:${p.discordUserId}`
    : (p.platform && p.platformUserId)
      ? `${p.platform}:${p.platformUserId}`
      : `nick:${(p.displayName || '').toLowerCase()}`;

  const elo = eloMap[identity] || 1200;

  return {
    rank: p.rank,
    identity,
    provider: p.discordUserId ? 'discord' : (p.platform || 'nick'),
    displayName: p.displayName || 'Unknown',
    profilePic: p.profilePic || null,
    elo: elo,
    peakElo: elo,
    eloDelta7d: 0,
    roundsCounted: p.roundsCounted || 0,
    roundsPlayed: p.roundsCounted || 0,
    wins: 0,
    coins: p.coins || 0,
    totalTaps: p.totalTaps || 0,
    libraryWords: p.libraryWords || 0,
    totalGameWins: p.totalGameWins || 0,
    gameWins: p.gameWins || {},
    title,
    titleColor,
    equippedCosmetics: (p.equippedCosmetics || []).map(c => ({
      category: c.category,
      name: c.name,
      rarity: c.rarity
    })),
    country: p.country || '??',
    lastActiveHours: 24,
    winRate: 0,
    dailyStreak: 0,
    peakRank: p.rank,
    trend: Array(12).fill(elo),
    memberSince: p.memberSince || null,
    suspicion: p.suspicion || null,
    suspended: null,
  };
}

window.__GOAT_API = {
  async publicLeaderboard({ limit = 25, sort = 'elo', page = 1 } = {}) {
    const raw = await getAllPlayers(sort);
    const eloMap = await fetchEloMap(sort);
    const players = raw.map(p => transformPlayer(p, eloMap));
    const eligible = players.filter(p => !p.suspended);

    const sortGetters = {
      elo: p => p.elo,
      coins: p => p.coins,
      total_game_wins: p => p.totalGameWins,
      total_taps: p => p.totalTaps,
      library_words: p => p.libraryWords,
      wins: p => p.wins,
    };
    const allGames = ['word5000','color500','subtextle','wikicontexto','wikirectangled','betwixt','rectangled','erectangled','triangled','spellingbee','wordle','figural','pixeletters','unwordle','synapse','synapse-mp','junkdrawer','cloudquarry'];
    const get = sortGetters[sort] || (allGames.includes(sort) ? p => p.gameWins[sort] || 0 : sortGetters.elo);
    const sorted = [...eligible].sort((a, b) => get(b) - get(a)).map((p, i) => ({ ...p, rank: i + 1 }));
    const start = (page - 1) * limit;
    return {
      ok: true,
      players: sorted.slice(start, start + limit),
      pagination: { page, limit, total: sorted.length, pages: Math.ceil(sorted.length / limit) },
      gating: { minRoundsCounted: 5, totalEligible: sorted.length, totalAccounts: players.length }
    };
  },

  async adminLeaderboard({ limit = 25, sort = 'elo', page = 1 } = {}) {
    const raw = await getAllPlayers(sort);
    const eloMap = await fetchEloMap(sort);
    const players = raw.map(p => transformPlayer(p, eloMap));

    const sortGetters = {
      elo: p => p.elo, coins: p => p.coins,
      total_game_wins: p => p.totalGameWins,
      total_taps: p => p.totalTaps,
      library_words: p => p.libraryWords,
      wins: p => p.wins,
      suspicion: p => p.suspicion?.score || 0,
    };
    const allGames = ['word5000','color500','subtextle','wikicontexto','wikirectangled','betwixt','rectangled','erectangled','triangled','spellingbee','wordle','figural','pixeletters','unwordle','synapse','synapse-mp','junkdrawer','cloudquarry'];
    const get = sortGetters[sort] || (allGames.includes(sort) ? p => p.gameWins[sort] || 0 : sortGetters.elo);
    const sorted = [...players].sort((a, b) => get(b) - get(a)).map((p, i) => ({ ...p, rank: i + 1 }));
    const start = (page - 1) * limit;
    return {
      ok: true,
      players: sorted.slice(start, start + limit),
      pagination: { page, limit, total: sorted.length, pages: Math.ceil(sorted.length / limit) },
      gating: { minRoundsCounted: 5, totalEligible: players.filter(p => p.roundsCounted >= 5).length, totalAccounts: players.length }
    };
  },

  async adminCheaters({ minScore = 50 } = {}) {
    // Reuse already-loaded players and filter locally
    const raw = _cache || [];
    const eloMap = await fetchEloMap('elo');
    const players = raw.map(p => transformPlayer(p, eloMap));
    return {
      ok: true,
      players: players
        .filter(p => p.suspicion && p.suspicion.score >= minScore)
        .sort((a, b) => (b.suspicion?.score || 0) - (a.suspicion?.score || 0))
    };
  },

  async adminPlayer(identity) {
    const raw = _cache || [];
    const eloMap = await fetchEloMap('elo');
    const players = raw.map(p => transformPlayer(p, eloMap));
    return players.find(p => p.identity === identity) || null;
  },

  async adminSuspend(identity, reason) {
    console.log('adminSuspend stub:', identity, reason);
    return { ok: true };
  }
};
