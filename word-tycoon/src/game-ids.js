'use strict';

// Canonical internal game IDs (2026-08 rename):
//   Searchle      -> subtextle
//   WikiSearchle  -> wikicontexto
//   word500       -> word5000
//   colour500     -> color500
//   betweenly     -> betwixt
//   sproutle      -> erectangled
//   squaredle     -> rectangled
//   spellingbee   -> spelling-bee
// Old IDs are kept as aliases for backwards compatibility with existing game servers.

const REWARD_GAME_ALIASES = {
  spellingbee: 'spelling-bee',
  'word-500': 'word5000',
  word500: 'word5000',
  color500: 'color500',
  'colour-500': 'color500',
  colour500: 'color500',
  squaredle: 'rectangled',
  sproutle: 'erectangled',
  betweenly: 'betwixt',
  betweenle: 'betwixt',
  searchle: 'subtextle',
  'searchle-grid': 'subtextle',
  wikisearchle: 'wikicontexto',
  wikirectangled: 'wikirectangled'
};

const VALID_REWARD_GAMES = [
  'word5000',
  'color500',
  'subtextle',
  'betwixt',
  'spelling-bee',
  'wordle',
  'figural',
  'pixeletters',
  'unwordle',
  'rectangled',
  'erectangled',
  'triangled',
  'wikicontexto',
  'wikirectangled',
  'junkdrawer',
  'cloudquarry',
  'letterworks',
  'wordfall',
  'synapse',
  'synapse-mp',
  'admin'
];

const STAT_GAME_KEYS = [
  'word5000',
  'color500',
  'subtextle',
  'betwixt',
  'rectangled',
  'erectangled',
  'triangled',
  'wikicontexto',
  'wikirectangled',
  'unwordle',
  'spelling-bee',
  'wordle',
  'figural',
  'pixeletters',
  'synapse',
  'synapse-mp',
  'junkdrawer',
  'cloudquarry',
  'letterworks',
  'wordfall'
];

const CANONICAL_GAME_VARIANTS = {
  word5000: ['word5000', 'word500', 'word-500', 'word1000'],
  color500: ['color500', 'colour500', 'colour-500'],
  subtextle: ['subtextle', 'searchle', 'searchle-grid'],
  betwixt: ['betwixt', 'betweenly', 'betweenle'],
  rectangled: ['rectangled', 'squaredle'],
  erectangled: ['erectangled', 'sproutle'],
  triangled: ['triangled'],
  wikicontexto: ['wikicontexto', 'wikisearchle'],
  wikirectangled: ['wikirectangled'],
  unwordle: ['unwordle'],
  'spelling-bee': ['spelling-bee', 'spellingbee'],
  wordle: ['wordle'],
  figural: ['figural'],
  pixeletters: ['pixeletters'],
  junkdrawer: ['junkdrawer'],
  cloudquarry: ['cloudquarry'],
  letterworks: ['letterworks'],
  wordfall: ['wordfall'],
  synapse: ['synapse'],
  'synapse-mp': ['synapse-mp'],
  arcade: ['arcade']
};

function normalizeRewardGameId(rawGame) {
  const raw = String(rawGame || '').trim().toLowerCase();
  if (!raw) return raw;
  return REWARD_GAME_ALIASES[raw] || raw;
}

function canonicalGameId(rawGame) {
  const raw = String(rawGame || '').trim().toLowerCase();
  if (!raw || raw === 'admin') return null;
  if (/(^|[-_])(test|check|debug)([-_]|$)/.test(raw)) return null;
  if (raw.startsWith('subtextle') || raw.startsWith('searchle')) return 'subtextle';
  if (raw.startsWith('wikicontexto') || raw.startsWith('wikisearchle')) return 'wikicontexto';
  if (raw.startsWith('betwixt') || raw.startsWith('betweenly') || raw.startsWith('betweenle')) return 'betwixt';
  if (raw.startsWith('word1000') || raw.startsWith('word5000') || raw.startsWith('word500') || raw.startsWith('word-500')) return 'word5000';
  if (raw.startsWith('color500') || raw.startsWith('colour500')) return 'color500';
  if (raw.startsWith('wordle')) return 'wordle';
  if (raw.startsWith('pixeletters')) return 'pixeletters';
  if (raw.startsWith('figural')) return 'figural';
  if (raw.startsWith('unwordle')) return 'unwordle';
  if (raw.startsWith('squaredle') || raw.startsWith('rectangled')) return 'rectangled';
  if (raw.startsWith('spellingbee') || raw.startsWith('spelling-bee')) return 'spelling-bee';
  if (raw.startsWith('sproutle') || raw.startsWith('erectangled')) return 'erectangled';
  if (raw.startsWith('triangled')) return 'triangled';
  if (raw.startsWith('wikirectangled')) return 'wikirectangled';
  if (raw.startsWith('junkdrawer')) return 'junkdrawer';
  if (raw.startsWith('cloudquarry')) return 'cloudquarry';
  if (raw.startsWith('letterworks')) return 'letterworks';
  if (raw.startsWith('wordfall')) return 'wordfall';
  if (raw.startsWith('synapse-mp')) return 'synapse-mp';
  if (raw.startsWith('synapse')) return 'synapse';
  if (raw.startsWith('arcade')) return 'arcade';
  return raw;
}

function getCanonicalGameVariants(rawGame) {
  const canonical = canonicalGameId(rawGame);
  if (!canonical) return [];
  return CANONICAL_GAME_VARIANTS[canonical] ? [...CANONICAL_GAME_VARIANTS[canonical]] : [canonical];
}

module.exports = {
  REWARD_GAME_ALIASES,
  VALID_REWARD_GAMES,
  STAT_GAME_KEYS,
  canonicalGameId,
  getCanonicalGameVariants,
  normalizeRewardGameId
};
