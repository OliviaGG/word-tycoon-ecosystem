// cosmetics.js - Cosmetic items catalog and purchase/equip logic
const crypto = require('crypto');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ultra', 'aux'];

// In-memory preview state: { playerId: { category, cosmeticId, itemName, css, timer, onExpire } }
const activeTests = new Map();

const TEST_DURATION_MS = 30000; // 30 seconds
const RARITY_COLORS = {
  common: '#9d9d9d',
  uncommon: '#4fc34f',
  rare: '#4a9eff',
  epic: '#b44aff',
  legendary: '#ffab00',
  ultra: '#ff4444',
  aux: '#00ffcc'
};

const BUFF_TYPE_NAMES = {
  tap_boost: 'Tap Power',
  word_game_boost: 'Word Game Money',
  biz_boost: 'Biz Income',
  offline_boost: 'Offline Income',
  combo_boost: 'Combo Max',
  coin_bonus: 'All Coins',
  prestige: 'All Income',
  lucky_bonus: 'Lucky 2x',
  word_reward_2x: 'Word Reward 2x',
  library_boost: 'Library Income'
};

const CATEGORY_BUFF_TYPE = {
  word_color: 'tap_boost',
  word_glow: 'word_game_boost',
  profile_border: 'biz_boost',
  profile_glow: 'offline_boost',
  name_glow: 'combo_boost',
  name_color: 'coin_bonus',
  title: 'prestige',
  win_effect: 'lucky_bonus',
  hero_badge: 'library_boost'
};

const DEFAULT_BUFFS = {
  tap_boost: 0, word_game_boost: 0, biz_boost: 0, offline_boost: 0,
  combo_boost: 0, coin_bonus: 0, prestige: 0, lucky_bonus: 0, word_reward_2x: 0,
  library_boost: 0
};

const CATEGORY_ALIASES = {
  'word': 'word_color', 'words': 'word_color', 'wordcolor': 'word_color', 'wordcolors': 'word_color', 'wc': 'word_color',
  'word color': 'word_color', 'word colors': 'word_color',
  'border': 'profile_border', 'borders': 'profile_border', 'pb': 'profile_border',
  'profile border': 'profile_border', 'profile borders': 'profile_border',
  'glow': 'profile_glow', 'glows': 'profile_glow', 'pg': 'profile_glow',
  'profile glow': 'profile_glow', 'profile glows': 'profile_glow',
  'nameglow': 'name_glow', 'nameglows': 'name_glow', 'ng': 'name_glow',
  'name glow': 'name_glow', 'name glows': 'name_glow',
  'namecolor': 'name_color', 'namecolors': 'name_color', 'nc': 'name_color',
  'name color': 'name_color', 'name colors': 'name_color',
  'title': 'title', 'titles': 'title', 'tt': 'title',
  'wordglow': 'word_glow', 'wordglows': 'word_glow', 'wg': 'word_glow',
  'word glow': 'word_glow', 'word glows': 'word_glow',
  'wineffect': 'win_effect', 'wineffects': 'win_effect', 'win': 'win_effect', 'we': 'win_effect',
  'win effect': 'win_effect', 'win effects': 'win_effect',
  'word_color': 'word_color', 'word_glow': 'word_glow', 'profile_border': 'profile_border', 'profile_glow': 'profile_glow',
  'name_glow': 'name_glow', 'name_color': 'name_color', 'win_effect': 'win_effect',
  'badge': 'hero_badge', 'badges': 'hero_badge', 'hb': 'hero_badge', 'hero': 'hero_badge',
  'hero badge': 'hero_badge', 'hero badges': 'hero_badge', 'hero_badge': 'hero_badge', 'herobadge': 'hero_badge'
};

const RARITY_ALIASES = {
  'common': 'common', 'c': 'common',
  'uncommon': 'uncommon', 'uc': 'uncommon', 'un': 'uncommon',
  'rare': 'rare', 'r': 'rare',
  'epic': 'epic', 'e': 'epic',
  'legendary': 'legendary', 'leg': 'legendary', 'l': 'legendary',
  'ultra': 'ultra', 'u': 'ultra',
  'aux': 'aux', 'ax': 'aux', 'audio': 'aux'
};

const CATEGORY_NAMES = {
  word_color: 'Word Colors',
  word_glow: 'Word Glows',
  profile_border: 'Borders',
  profile_glow: 'Glows',
  name_glow: 'Name Glows',
  name_color: 'Name Colors',
  title: 'Titles',
  win_effect: 'Win Effects',
  hero_badge: 'Hero Badge'
};

const COSMETICS_CATALOG = [
  // ── Word Colors (18 items) — Buff: Tap Power Boost ─────────
  { id: 'wc_crimson',    category: 'word_color', name: 'Crimson',       rarity: 'common',    cost: 10000,         sort: 1,  css: { color: '#ef4444', textShadow: '0 0 8px rgba(239,68,68,0.5)' }, buff: { type: 'tap_boost', value: 0.01, label: '+1% Tap Power' } },
  { id: 'wc_ocean',      category: 'word_color', name: 'Ocean Blue',    rarity: 'common',    cost: 10000,         sort: 2,  css: { color: '#3b82f6', textShadow: '0 0 8px rgba(59,130,246,0.5)' }, buff: { type: 'tap_boost', value: 0.01, label: '+1% Tap Power' } },
  { id: 'wc_forest',     category: 'word_color', name: 'Forest Green',  rarity: 'common',    cost: 10000,         sort: 3,  css: { color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.5)' }, buff: { type: 'tap_boost', value: 0.01, label: '+1% Tap Power' } },
  { id: 'wc_snow',       category: 'word_color', name: 'Snow White',    rarity: 'common',    cost: 15000,         sort: 4,  css: { color: '#f0f0ff', textShadow: '0 0 6px rgba(200,200,255,0.5)' }, buff: { type: 'tap_boost', value: 0.02, label: '+2% Tap Power' } },
  { id: 'wc_amber',      category: 'word_color', name: 'Amber',         rarity: 'uncommon',  cost: 500000,        sort: 5,  css: { color: '#f59e0b', textShadow: '0 0 8px rgba(245,158,11,0.6), 0 0 18px rgba(245,158,11,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.03, label: '+3% Tap Power' } },
  { id: 'wc_violet',     category: 'word_color', name: 'Violet',        rarity: 'uncommon',  cost: 500000,        sort: 6,  css: { color: '#8b5cf6', textShadow: '0 0 8px rgba(139,92,246,0.6), 0 0 18px rgba(139,92,246,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.03, label: '+3% Tap Power' } },
  { id: 'wc_coral',      category: 'word_color', name: 'Coral Pink',    rarity: 'uncommon',  cost: 500000,        sort: 7,  css: { color: '#f472b6', textShadow: '0 0 8px rgba(244,114,182,0.6), 0 0 18px rgba(244,114,182,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.03, label: '+3% Tap Power' } },
  { id: 'wc_teal',       category: 'word_color', name: 'Teal',          rarity: 'uncommon',  cost: 750000,        sort: 8,  css: { color: '#2dd4bf', textShadow: '0 0 8px rgba(45,212,191,0.6), 0 0 18px rgba(45,212,191,0.28)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.04, label: '+4% Tap Power' } },
  { id: 'wc_blood',      category: 'word_color', name: 'Blood Red',     rarity: 'rare',      cost: 35000000,      sort: 9,  css: { color: '#dc2626', backgroundImage: 'linear-gradient(90deg, #dc2626, #e87272, #f5bebe, #e87272, #dc2626)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(220,38,38,0.55), 0 0 22px rgba(220,38,38,0.28)' }, buff: { type: 'tap_boost', value: 0.06, label: '+6% Tap Power' } },
  { id: 'wc_ice',        category: 'word_color', name: 'Frozen Ice',    rarity: 'rare',      cost: 50000000,      sort: 10, css: { color: '#67e8f9', backgroundImage: 'linear-gradient(90deg, #67e8f9, #9cf0fb, #d1f8fd, #9cf0fb, #67e8f9)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(103,232,249,0.55), 0 0 22px rgba(103,232,249,0.28)' }, buff: { type: 'tap_boost', value: 0.07, label: '+7% Tap Power' } },
  { id: 'wc_electric',   category: 'word_color', name: 'Electric',      rarity: 'rare',      cost: 65000000,      sort: 11, css: { color: '#22d3ee', backgroundImage: 'linear-gradient(90deg, #22d3ee, #6fe2f4, #bdf2fa, #6fe2f4, #22d3ee)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(34,211,238,0.55), 0 0 22px rgba(34,211,238,0.28)' }, buff: { type: 'tap_boost', value: 0.08, label: '+8% Tap Power' } },
  { id: 'wc_neon_green', category: 'word_color', name: 'Neon Green',    rarity: 'epic',      cost: 250000000,     sort: 12, css: { color: '#16a34a', backgroundImage: 'linear-gradient(90deg, #16a34a, #4ade80, #d9f99d, #4ade80, #16a34a)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.8s linear infinite, cfx-flicker 4.5s linear infinite', textShadow: '0 0 10px rgba(74,222,128,0.8), 0 0 24px rgba(74,222,128,0.4)' }, buff: { type: 'tap_boost', value: 0.10, label: '+10% Tap Power' } },
  { id: 'wc_flame',      category: 'word_color', name: 'Living Flame',  rarity: 'epic',      cost: 350000000,     sort: 13, css: { color: '#ea580c', backgroundImage: 'linear-gradient(0deg, #7c2d12 0%, #ea580c 30%, #facc15 65%, #fef9c3 100%)', backgroundSize: '100% 300%', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(250,150,20,0.8), 0 -6px 18px rgba(250,150,20,0.4)', animation: 'cfx-flame 1.2s ease-in-out infinite alternate' }, buff: { type: 'tap_boost', value: 0.12, label: '+12% Tap Power' } },
  { id: 'wc_white_hot',  category: 'word_color', name: 'White Hot',     rarity: 'epic',      cost: 500000000,     sort: 14, css: { color: '#e2e8f0', backgroundImage: 'linear-gradient(90deg, #e2e8f0, #ffffff, #fff3c4, #ffffff, #e2e8f0)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.2s linear infinite, cfx-pulse 1.6s ease-in-out infinite', textShadow: '0 0 12px rgba(255,255,255,0.85), 0 0 26px rgba(255,220,140,0.5)' }, buff: { type: 'tap_boost', value: 0.14, label: '+14% Tap Power' } },
  { id: 'wc_shadow',     category: 'word_color', name: 'Shadow',        rarity: 'legendary', cost: 2000000000,    sort: 15, css: { color: '#374151', backgroundImage: 'linear-gradient(90deg, #111827, #4b5563, #9ca3af, #4b5563, #111827, #111827)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 4.5s linear infinite', textShadow: '-3px -3px 0 rgba(255,255,255,0.5), 3px -3px 0 rgba(255,255,255,0.5), -3px 3px 0 rgba(255,255,255,0.5), 3px 3px 0 rgba(255,255,255,0.5), 0 -3px 0 rgba(255,255,255,0.5), 0 3px 0 rgba(255,255,255,0.5), -3px 0 0 rgba(255,255,255,0.5), 3px 0 0 rgba(255,255,255,0.5), 0 0 12px rgba(100,100,130,0.6), 0 0 26px rgba(60,60,80,0.4)', __ambient: { fx: 'aura', colors: ['#9ca3af', '#e5e7eb'], density: 0.6 } }, buff: { type: 'tap_boost', value: 0.18, label: '+18% Tap Power' } },
  { id: 'wc_prismatic',  category: 'word_color', name: 'Prismatic',     rarity: 'legendary', cost: 2500000000,    sort: 16, css: { color: '#ff4d4d', backgroundImage: 'linear-gradient(90deg, #ff4d4d, #ffb14d, #ffe94d, #5dff7a, #4dc6ff, #b44dff, #ff4d4d)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3s linear infinite', textShadow: '0 0 12px rgba(255,255,255,0.5), 0 0 26px rgba(180,77,255,0.35)', __ambient: { fx: 'sparks', colors: ['#ff4d4d', '#ffe94d', '#4dc6ff', '#b44dff'], density: 0.7 } }, buff: { type: 'tap_boost', value: 0.20, label: '+20% Tap Power' } },
  { id: 'wc_glitch',     category: 'word_color', name: 'Glitch',        rarity: 'ultra',     cost: 7500000000,    sort: 17, css: { color: '#00ff88', backgroundImage: 'linear-gradient(90deg, #00ff88, #00ffff, #baffdd, #00ffff, #00ff88, #00ff88)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-glitch 0.3s infinite, cfx-sweep 2.8s linear infinite', textShadow: '3px 0 #ff0040, -3px 0 #00ffff, 0 0 12px rgba(0,255,136,0.6)', __ambient: { fx: 'aura', colors: ['#00ffcc', '#ff0040'], density: 1 } }, buff: { type: 'tap_boost', value: 0.22, label: '+22% Tap Power' } },
  { id: 'wc_void',       category: 'word_color', name: 'Void Black',    rarity: 'ultra',     cost: 10000000000,   sort: 18, css: { color: '#1a1a2e', backgroundImage: 'linear-gradient(90deg, #1a1a2e, #4c1d95, #7c3aed, #4c1d95, #1a1a2e, #1a1a2e)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 4s linear infinite, cfx-pulse 2.4s ease-in-out infinite', textShadow: '-3px -3px 0 rgba(180,74,255,0.7), 3px -3px 0 rgba(180,74,255,0.7), -3px 3px 0 rgba(180,74,255,0.7), 3px 3px 0 rgba(180,74,255,0.7), 0 -3px 0 rgba(180,74,255,0.7), 0 3px 0 rgba(180,74,255,0.7), -3px 0 0 rgba(180,74,255,0.7), 3px 0 0 rgba(180,74,255,0.7), 0 0 14px rgba(180,74,255,0.9), 0 0 28px rgba(120,0,255,0.55), 0 0 44px rgba(80,0,200,0.35), 0 0 60px rgba(50,0,150,0.18)', __ambient: { fx: 'aura', colors: ['#a855f7', '#6d28d9'], density: 1 } }, buff: { type: 'tap_boost', value: 0.25, label: '+25% Tap Power' } },

  { id: 'wc_moonstone', category: 'word_color', name: 'Moonstone', rarity: 'common', cost: 15000, sort: 30, css: { color: '#dce7f8', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(120,170,255,0.85) 50%, transparent 59%), linear-gradient(96deg, #e9eefa, #ffffff, #cfe0f7, #a9c6ee, #cfe0f7, #ffffff, #e9eefa)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(169,198,238,0.45), 0 0 20px rgba(169,198,238,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'tap_boost', value: 0.02, label: '+2% Tap Power' } },
  { id: 'wc_nacre', category: 'word_color', name: 'Nacre', rarity: 'common', cost: 20000, sort: 31, css: { color: '#ffe6ee', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(150,255,220,0.75) 50%, transparent 59%), linear-gradient(96deg, #fff2e4, #ffd9e3, #ffeef2, #d5f3e4, #dde0ff, #ffeef2, #fff2e4)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(255,214,226,0.45), 0 0 20px rgba(255,214,226,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'tap_boost', value: 0.02, label: '+2% Tap Power' } },
  { id: 'wc_seaglass', category: 'word_color', name: 'Sea Glass', rarity: 'common', cost: 25000, sort: 32, css: { color: '#bfe4da', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(255,255,255,0.85) 50%, transparent 59%), linear-gradient(96deg, #cfeee7, #a9ddd1, #d9ead0, #f2e7c4, #d9ead0, #a9ddd1, #cfeee7)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(169,221,209,0.45), 0 0 20px rgba(169,221,209,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'tap_boost', value: 0.02, label: '+2% Tap Power' } },
  { id: 'wc_alpenglow', category: 'word_color', name: 'Alpenglow', rarity: 'uncommon', cost: 250000, sort: 33, css: { color: '#ffb4a8', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(255,255,255,0.90) 50%, transparent 59%), linear-gradient(96deg, #fde9e4, #ffc3ab, #ff9d9d, #e0a6d6, #b9a9e2, #ff9d9d, #ffc3ab, #fde9e4)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(255,157,157,0.45), 0 0 20px rgba(255,157,157,0.16)', animation: 'cfx-schiller 7.5s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.03, label: '+3% Tap Power' } },
  { id: 'wc_labradorite', category: 'word_color', name: 'Labradorite', rarity: 'uncommon', cost: 600000, sort: 34, css: { color: '#7fa8cf', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(190,235,255,0.95) 50%, transparent 59%), linear-gradient(96deg, #38455c, #4e7fb5, #6cc0f0, #cfe3f5, #d9ae52, #4e7fb5, #38455c)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(108,192,240,0.45), 0 0 20px rgba(108,192,240,0.16)', animation: 'cfx-schiller 7.5s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.04, label: '+4% Tap Power' } },

  // ── Word Glows (12 items) — Buff: Word Game Money Boost ────────
  { id: 'wg_soft',       category: 'word_glow', name: 'Soft Glow',       rarity: 'common',    cost: 12000,         sort: 1,  css: { textShadow: '0 0 8px rgba(255,255,255,0.45)' }, buff: { type: 'word_game_boost', value: 0.02, label: '+2% Word Game Money' } },
  { id: 'wg_warm',       category: 'word_glow', name: 'Warm Glow',       rarity: 'common',    cost: 15000,         sort: 2,  css: { textShadow: '0 0 8px rgba(255,200,100,0.48)' }, buff: { type: 'word_game_boost', value: 0.03, label: '+3% Word Game Money' } },
  { id: 'wg_electric',   category: 'word_glow', name: 'Electric Blue',   rarity: 'uncommon',  cost: 750000,        sort: 3,  css: { textShadow: '0 0 8px rgba(0,150,255,0.65), 0 0 18px rgba(0,150,255,0.3)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.05, label: '+5% Word Game Money' } },
  { id: 'wg_toxic',      category: 'word_glow', name: 'Toxic Green',     rarity: 'uncommon',  cost: 750000,        sort: 4,  css: { textShadow: '0 0 8px rgba(0,255,100,0.65), 0 0 18px rgba(0,255,100,0.3)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.05, label: '+5% Word Game Money' } },
  { id: 'wg_frost',      category: 'word_glow', name: 'Frostbite',       rarity: 'rare',      cost: 35000000,      sort: 5,  css: { textShadow: '0 0 10px rgba(103,232,249,0.7), 0 0 22px rgba(103,232,249,0.38), 0 0 34px rgba(150,240,255,0.15)', animation: 'cosmetic-wg-frost 2.5s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.08, label: '+8% Word Game Money' } },
  { id: 'wg_fire',       category: 'word_glow', name: 'Firestorm',       rarity: 'rare',      cost: 50000000,      sort: 6,  css: { textShadow: '0 0 10px rgba(255,100,0,0.75), 0 0 22px rgba(255,50,0,0.42), 0 0 34px rgba(200,0,0,0.18)', animation: 'cosmetic-wg-fire 2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.10, label: '+10% Word Game Money' } },
  { id: 'wg_bloodmoon',  category: 'word_glow', name: 'Blood Moon',      rarity: 'epic',      cost: 400000000,     sort: 7,  css: { textShadow: '0 0 10px rgba(220,38,38,0.8), 0 0 24px rgba(180,0,0,0.48), 0 0 38px rgba(120,0,0,0.22)', animation: 'cosmetic-wg-bloodmoon 2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.14, label: '+14% Word Game Money' } },
  { id: 'wg_galaxy',     category: 'word_glow', name: 'Galaxy',           rarity: 'epic',      cost: 500000000,     sort: 8,  css: { textShadow: '0 0 12px rgba(180,74,255,0.8), 0 0 26px rgba(100,0,200,0.48), 0 0 40px rgba(50,0,150,0.22)', animation: 'cosmetic-wg-galaxy 3s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.16, label: '+16% Word Game Money' } },
  { id: 'wg_aurora',     category: 'word_glow', name: 'Aurora',            rarity: 'legendary', cost: 2000000000,    sort: 9,  css: { textShadow: '0 0 12px rgba(0,255,135,0.85), 0 0 26px rgba(0,188,212,0.55), 0 0 40px rgba(124,77,255,0.3), 0 0 54px rgba(0,255,135,0.12)', animation: 'cosmetic-wg-aurora 4s linear infinite', __ambient: { fx: 'motes', colors: ['#4dffab', '#4dcdff'], density: 0.5 } }, buff: { type: 'word_game_boost', value: 0.20, label: '+20% Word Game Money' } },
  { id: 'wg_golden',     category: 'word_glow', name: 'Golden Radiance',  rarity: 'legendary', cost: 2500000000,    sort: 10, css: { textShadow: '0 0 12px rgba(255,215,0,0.85), 0 0 26px rgba(255,180,0,0.55), 0 0 42px rgba(255,140,0,0.32), 0 0 56px rgba(255,100,0,0.15)', animation: 'cosmetic-wg-golden 2s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffe34d', '#95ff4d'], density: 0.5 } }, buff: { type: 'word_game_boost', value: 0.22, label: '+22% Word Game Money' } },
  { id: 'wg_void',       category: 'word_glow', name: 'Void Pulse',       rarity: 'ultra',     cost: 7500000000,    sort: 11, css: { textShadow: '0 0 14px rgba(180,74,255,0.9), 0 0 28px rgba(100,0,255,0.58), 0 0 44px rgba(50,0,200,0.35), 0 0 60px rgba(30,0,150,0.15)', animation: 'cosmetic-wg-void 2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#cb80ff', '#ff80d4'], density: 0.8 } }, buff: { type: 'word_game_boost', value: 0.26, label: '+26% Word Game Money' } },
  { id: 'wg_divine',     category: 'word_glow', name: 'Divine Light',     rarity: 'ultra',     cost: 10000000000,   sort: 12, css: { textShadow: '0 0 14px rgba(255,255,255,0.95), 0 0 30px rgba(255,215,0,0.65), 0 0 48px rgba(255,180,0,0.4), 0 0 66px rgba(255,140,0,0.2), 0 0 84px rgba(255,100,0,0.08)', animation: 'cosmetic-wg-divine 2.5s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffffff', '#ffffff'], density: 0.8 } }, buff: { type: 'word_game_boost', value: 0.30, label: '+30% Word Game Money' } },

  // ── Profile Borders (14 items) — Buff: Business Income ─────
  { id: 'pb_bronze',     category: 'profile_border', name: 'Bronze Ring',   rarity: 'common',    cost: 10000,         sort: 1,  css: { border: '3px solid #cd7f32' }, buff: { type: 'biz_boost', value: 0.01, label: '+1% Biz Income' } },
  { id: 'pb_silver',     category: 'profile_border', name: 'Silver Ring',   rarity: 'common',    cost: 15000,         sort: 2,  css: { border: '3px solid #c0c0c0' }, buff: { type: 'biz_boost', value: 0.02, label: '+2% Biz Income' } },
  { id: 'pb_gold',       category: 'profile_border', name: 'Gold Ring',     rarity: 'uncommon',  cost: 750000,        sort: 3,  css: { border: '3px solid #ffd700', boxShadow: '0 0 6px rgba(255,215,0,0.4)' }, buff: { type: 'biz_boost', value: 0.03, label: '+3% Biz Income' } },
  { id: 'pb_rose_gold',  category: 'profile_border', name: 'Rose Gold',     rarity: 'uncommon',  cost: 1000000,       sort: 4,  css: { border: '3px solid #e8a0bf', boxShadow: '0 0 6px rgba(232,160,191,0.4)' }, buff: { type: 'biz_boost', value: 0.04, label: '+4% Biz Income' } },
  { id: 'pb_emerald',    category: 'profile_border', name: 'Emerald Ring',  rarity: 'rare',      cost: 35000000,      sort: 5,  css: { border: '3px solid #50c878', boxShadow: '0 0 10px rgba(80,200,120,0.6), 0 0 24px rgba(80,200,120,0.28)' }, buff: { type: 'biz_boost', value: 0.06, label: '+6% Biz Income' } },
  { id: 'pb_sapphire',   category: 'profile_border', name: 'Sapphire Ring', rarity: 'rare',      cost: 50000000,      sort: 6,  css: { border: '3px solid #0f52ba', boxShadow: '0 0 10px rgba(15,82,186,0.6), 0 0 24px rgba(15,82,186,0.28)' }, buff: { type: 'biz_boost', value: 0.07, label: '+7% Biz Income' } },
  { id: 'pb_ruby',       category: 'profile_border', name: 'Ruby Ring',     rarity: 'rare',      cost: 65000000,      sort: 7,  css: { border: '3px solid #e0115f', boxShadow: '0 0 10px rgba(224,17,95,0.6), 0 0 24px rgba(224,17,95,0.28)' }, buff: { type: 'biz_boost', value: 0.08, label: '+8% Biz Income' } },
  { id: 'pb_diamond',    category: 'profile_border', name: 'Diamond Ring',  rarity: 'epic',      cost: 500000000,     sort: 8,  css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #b9f2ff, #d9f8ff, #f5fdff, #d9f8ff, #b9f2ff, #66858c, #b9f2ff)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 4s linear infinite', boxShadow: '0 0 12px rgba(185,242,255,0.6), 0 0 26px rgba(185,242,255,0.28)' }, buff: { type: 'biz_boost', value: 0.11, label: '+11% Biz Income' } },
  { id: 'pb_neon_pink',  category: 'profile_border', name: 'Neon Pink',     rarity: 'epic',      cost: 600000000,     sort: 9,  css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #ff6ec7, #ffafe0, #ffe9f7, #ffafe0, #ff6ec7, #8c3d6d, #ff6ec7)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 4s linear infinite', boxShadow: '0 0 12px rgba(255,110,199,0.6), 0 0 26px rgba(255,110,199,0.28)' }, buff: { type: 'biz_boost', value: 0.12, label: '+12% Biz Income' } },
  { id: 'pb_plasma',     category: 'profile_border', name: 'Plasma',        rarity: 'epic',      cost: 750000000,     sort: 10, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #7c3aed, #b793f5, #ebe1fc, #b793f5, #7c3aed, #442082, #7c3aed)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 4s linear infinite', boxShadow: '0 0 12px rgba(124,58,237,0.6), 0 0 26px rgba(124,58,237,0.28)' }, buff: { type: 'biz_boost', value: 0.14, label: '+14% Biz Income' } },
  { id: 'pb_rainbow',    category: 'profile_border', name: 'Rainbow',       rarity: 'legendary', cost: 2500000000,    sort: 11, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #ff0000, #ff8800, #ffee00, #22cc44, #2266ff, #aa22ff, #ff0000)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 3s linear infinite', boxShadow: '0 0 14px rgba(255,255,255,0.35), 0 0 30px rgba(170,34,255,0.25)', __ambient: { fx: 'sparks', colors: ['#ff6666', '#ffee00', '#66aaff'], density: 0.5 } }, buff: { type: 'biz_boost', value: 0.18, label: '+18% Biz Income' } },
  { id: 'pb_void_ring',  category: 'profile_border', name: 'Void Ring',     rarity: 'legendary', cost: 3000000000,    sort: 12, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #0f0025, #4c1d95, #a855f7, #4c1d95, #0f0025, #0f0025)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 4s linear infinite', boxShadow: '0 0 14px rgba(124,58,237,0.6), 0 0 32px rgba(76,29,149,0.35)' }, buff: { type: 'biz_boost', value: 0.20, label: '+20% Biz Income' } },
  { id: 'pb_inferno',    category: 'profile_border', name: 'Inferno',       rarity: 'ultra',     cost: 8000000000,    sort: 13, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #7c2d12, #ea580c, #facc15, #ea580c, #7c2d12, #7c2d12)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 2.6s linear infinite', boxShadow: '0 0 16px rgba(255,105,0,0.7), 0 0 36px rgba(255,69,0,0.35)', __ambient: { fx: 'orbit', colors: ['#facc15', '#fb923c'], density: 1 } }, buff: { type: 'biz_boost', value: 0.22, label: '+22% Biz Income' } },
  { id: 'pb_celestial',  category: 'profile_border', name: 'Celestial',     rarity: 'ultra',     cost: 10000000000,   sort: 14, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #ffd700, #fff7cc, #ffffff, #fff7cc, #ffd700, #ffd700)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 3.2s linear infinite', boxShadow: '0 0 16px rgba(255,215,0,0.7), 0 0 36px rgba(255,215,0,0.3)', __ambient: { fx: 'orbit', colors: ['#ffd700', '#ffffff'], density: 1 } }, buff: { type: 'biz_boost', value: 0.25, label: '+25% Biz Income' } },

  { id: 'pb_moonstone', category: 'profile_border', name: 'Moonstone Ring', rarity: 'common', cost: 15000, sort: 30, css: { border: '3px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #e9eefa, #ffffff, #cfe0f7, #a9c6ee, #cfe0f7, #ffffff, #e9eefa)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 10px rgba(169,198,238,0.40), 0 0 26px rgba(169,198,238,0.16)', animation: 'cfx-spin 16s linear infinite' }, buff: { type: 'biz_boost', value: 0.02, label: '+2% Biz Income' } },
  { id: 'pb_seaglass', category: 'profile_border', name: 'Sea Glass Ring', rarity: 'common', cost: 25000, sort: 31, css: { border: '3px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #cfeee7, #a9ddd1, #d9ead0, #f2e7c4, #d9ead0, #a9ddd1, #cfeee7)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 10px rgba(169,221,209,0.40), 0 0 26px rgba(169,221,209,0.16)', animation: 'cfx-spin 16s linear infinite' }, buff: { type: 'biz_boost', value: 0.02, label: '+2% Biz Income' } },
  { id: 'pb_nacre', category: 'profile_border', name: 'Nacre Ring', rarity: 'uncommon', cost: 300000, sort: 32, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #fff2e4, #ffd9e3, #ffeef2, #d5f3e4, #dde0ff, #ffeef2, #fff2e4)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 10px rgba(255,214,226,0.40), 0 0 26px rgba(255,214,226,0.16)', animation: 'cfx-spin 14s linear infinite' }, buff: { type: 'biz_boost', value: 0.03, label: '+3% Biz Income' } },
  { id: 'pb_labradorite', category: 'profile_border', name: 'Labradorite Ring', rarity: 'uncommon', cost: 700000, sort: 33, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #38455c, #4e7fb5, #6cc0f0, #cfe3f5, #d9ae52, #4e7fb5, #38455c)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 10px rgba(108,192,240,0.40), 0 0 26px rgba(108,192,240,0.16)', animation: 'cfx-spin 14s linear infinite' }, buff: { type: 'biz_boost', value: 0.04, label: '+4% Biz Income' } },

  // ── Profile Glows (11 items) — Buff: Offline Income ────────
  { id: 'pg_soft_white',  category: 'profile_glow', name: 'Soft White',    rarity: 'common',    cost: 15000,         sort: 1,  css: { boxShadow: '0 0 10px rgba(255,255,255,0.38)' }, buff: { type: 'offline_boost', value: 0.05, label: '+5% Offline Income' } },
  { id: 'pg_blue_aura',   category: 'profile_glow', name: 'Blue Aura',     rarity: 'uncommon',  cost: 1000000,       sort: 2,  css: { boxShadow: '0 0 12px rgba(59,130,246,0.55), 0 0 24px rgba(59,130,246,0.25)' }, buff: { type: 'offline_boost', value: 0.10, label: '+10% Offline Income' } },
  { id: 'pg_green_aura',  category: 'profile_glow', name: 'Green Aura',    rarity: 'uncommon',  cost: 1000000,       sort: 3,  css: { boxShadow: '0 0 12px rgba(34,197,94,0.55), 0 0 24px rgba(34,197,94,0.25)' }, buff: { type: 'offline_boost', value: 0.10, label: '+10% Offline Income' } },
  { id: 'pg_red_aura',    category: 'profile_glow', name: 'Red Aura',      rarity: 'uncommon',  cost: 1000000,       sort: 4,  css: { boxShadow: '0 0 12px rgba(239,68,68,0.55), 0 0 24px rgba(239,68,68,0.25)' }, buff: { type: 'offline_boost', value: 0.10, label: '+10% Offline Income' } },
  { id: 'pg_pink_aura',   category: 'profile_glow', name: 'Pink Aura',     rarity: 'rare',      cost: 35000000,      sort: 5,  css: { boxShadow: '0 0 14px rgba(244,114,182,0.7), 0 0 30px rgba(244,114,182,0.35), 0 0 46px rgba(244,114,182,0.15)' }, buff: { type: 'offline_boost', value: 0.20, label: '+20% Offline Income' } },
  { id: 'pg_purple_aura', category: 'profile_glow', name: 'Purple Aura',   rarity: 'rare',      cost: 50000000,      sort: 6,  css: { boxShadow: '0 0 14px rgba(139,92,246,0.7), 0 0 30px rgba(139,92,246,0.35), 0 0 46px rgba(139,92,246,0.15)' }, buff: { type: 'offline_boost', value: 0.25, label: '+25% Offline Income' } },
  { id: 'pg_golden_aura', category: 'profile_glow', name: 'Golden Aura',   rarity: 'epic',      cost: 400000000,     sort: 7,  css: { boxShadow: '0 0 16px rgba(255,215,0,0.75), 0 0 34px rgba(104,255,0,0.35), 0 0 52px rgba(255,215,0,0.15)' }, buff: { type: 'offline_boost', value: 0.40, label: '+40% Offline Income' } },
  { id: 'pg_electric',    category: 'profile_glow', name: 'Electric Aura',  rarity: 'epic',     cost: 500000000,     sort: 8,  css: { boxShadow: '0 0 16px rgba(34,211,238,0.7), 0 0 32px rgba(34,211,238,0.4), 0 0 48px rgba(34,211,238,0.18)', animation: 'cosmetic-electric-aura 1.5s ease-in-out infinite' }, buff: { type: 'offline_boost', value: 0.50, label: '+50% Offline Income' } },
  { id: 'pg_void_aura',   category: 'profile_glow', name: 'Void Aura',    rarity: 'legendary', cost: 2500000000,    sort: 9,  css: { boxShadow: '0 0 18px rgba(45,27,105,0.8), 0 0 36px rgba(100,0,255,0.5), 0 0 56px rgba(180,74,255,0.28)', animation: 'cosmetic-void-aura 3s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#776b9e', '#9d6b9e'], density: 0.5 } }, buff: { type: 'offline_boost', value: 0.70, label: '+70% Offline Income' } },
  { id: 'pg_supernova',   category: 'profile_glow', name: 'Supernova',     rarity: 'legendary', cost: 3000000000,    sort: 10, css: { boxShadow: '0 0 18px rgba(255,200,0,0.8), 0 0 36px rgba(255,100,0,0.5), 0 0 56px rgba(255,0,0,0.28)', animation: 'cosmetic-supernova 2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffdb59', '#a7ff59'], density: 0.5 } }, buff: { type: 'offline_boost', value: 0.80, label: '+80% Offline Income' } },
  { id: 'pg_cosmic',      category: 'profile_glow', name: 'Cosmic',        rarity: 'ultra',     cost: 10000000000,   sort: 11, css: { boxShadow: '0 0 20px rgba(100,0,255,0.85), 0 0 40px rgba(200,0,255,0.55), 0 0 62px rgba(255,0,200,0.32), 0 0 80px rgba(100,0,255,0.12)', animation: 'cosmetic-cosmic 4s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#9a59ff', '#ff59e8'], density: 0.8 } }, buff: { type: 'offline_boost', value: 1.00, label: '+100% Offline Income' } },

  { id: 'pg_moonlight', category: 'profile_glow', name: 'Moonlight', rarity: 'common', cost: 15000, sort: 30, css: { boxShadow: '0 0 12px rgba(196,214,246,0.55), 0 0 34px rgba(140,176,232,0.22)' }, buff: { type: 'offline_boost', value: 0.05, label: '+5% Offline Income' } },
  { id: 'pg_seafoam', category: 'profile_glow', name: 'Seafoam', rarity: 'common', cost: 25000, sort: 31, css: { boxShadow: '0 0 12px rgba(169,221,209,0.60), 0 0 34px rgba(96,178,164,0.24)' }, buff: { type: 'offline_boost', value: 0.05, label: '+5% Offline Income' } },
  { id: 'pg_alpenglow', category: 'profile_glow', name: 'Alpenglow', rarity: 'uncommon', cost: 300000, sort: 32, css: { boxShadow: '0 0 14px rgba(255,157,157,0.60), 0 0 38px rgba(185,169,226,0.26)', animation: 'cfx-breath 9s ease-in-out infinite' }, buff: { type: 'offline_boost', value: 0.1, label: '+10% Offline Income' } },
  { id: 'pg_biolume', category: 'profile_glow', name: 'Bioluminescence', rarity: 'uncommon', cost: 700000, sort: 33, css: { boxShadow: '0 0 14px rgba(120,240,210,0.65), 0 0 40px rgba(60,160,255,0.28)', animation: 'cfx-breath 6.5s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#78f0d2', '#3ca0ff'], density: 0.5 } }, buff: { type: 'offline_boost', value: 0.1, label: '+10% Offline Income' } },

  // ── Name Glows (10 items) — Buff: Combo Max Boost ──────────
  { id: 'ng_soft',        category: 'name_glow', name: 'Soft Glow',      rarity: 'common',    cost: 12000,         sort: 1,  css: { textShadow: '0 0 8px rgba(255,255,255,0.45)' }, buff: { type: 'combo_boost', value: 0.05, label: '+5% Combo Max' } },
  { id: 'ng_warm',        category: 'name_glow', name: 'Warm Glow',      rarity: 'common',    cost: 15000,         sort: 2,  css: { textShadow: '0 0 8px rgba(255,200,100,0.45)' }, buff: { type: 'combo_boost', value: 0.06, label: '+6% Combo Max' } },
  { id: 'ng_electric',    category: 'name_glow', name: 'Electric Blue',  rarity: 'uncommon',  cost: 750000,        sort: 3,  css: { textShadow: '0 0 8px rgba(0,150,255,0.6), 0 0 16px rgba(0,150,255,0.28)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.10, label: '+10% Combo Max' } },
  { id: 'ng_toxic',       category: 'name_glow', name: 'Toxic Green',    rarity: 'uncommon',  cost: 750000,        sort: 4,  css: { textShadow: '0 0 8px rgba(0,255,100,0.6), 0 0 16px rgba(0,255,100,0.28)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.10, label: '+10% Combo Max' } },
  { id: 'ng_ice',         category: 'name_glow', name: 'Frozen',         rarity: 'rare',      cost: 35000000,      sort: 5,  css: { textShadow: '0 0 10px rgba(103,232,249,0.75), 0 0 22px rgba(103,232,249,0.4), 0 0 34px rgba(103,232,249,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.15, label: '+15% Combo Max' } },
  { id: 'ng_fire',        category: 'name_glow', name: 'Firestorm',      rarity: 'rare',      cost: 50000000,      sort: 6,  css: { textShadow: '0 0 10px rgba(255,100,0,0.75), 0 0 22px rgba(255,100,0,0.4), 0 0 34px rgba(255,100,0,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.20, label: '+20% Combo Max' } },
  { id: 'ng_blood',       category: 'name_glow', name: 'Blood Moon',     rarity: 'epic',      cost: 400000000,     sort: 7,  css: { textShadow: '0 0 10px rgba(220,38,38,0.85), 0 0 24px rgba(220,175,38,0.45), 0 0 38px rgba(220,38,38,0.2)', animation: 'cfx-breath 2.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.28, label: '+28% Combo Max' } },
  { id: 'ng_galaxy',      category: 'name_glow', name: 'Galaxy',         rarity: 'epic',      cost: 500000000,     sort: 8,  css: { textShadow: '0 0 10px rgba(180,74,255,0.85), 0 0 24px rgba(255,74,194,0.45), 0 0 38px rgba(180,74,255,0.2)', animation: 'cfx-breath 2.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.32, label: '+32% Combo Max' } },
  { id: 'ng_legendary',   category: 'name_glow', name: 'Legendary Glow', rarity: 'legendary', cost: 2500000000,    sort: 9,  css: { textShadow: '0 0 12px rgba(255,215,0,0.85), 0 0 24px rgba(255,180,0,0.55), 0 0 38px rgba(255,140,0,0.3), 0 0 52px rgba(255,100,0,0.12)', animation: 'cosmetic-legendary-glow 2s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffe34d', '#95ff4d'], density: 0.5 } }, buff: { type: 'combo_boost', value: 0.40, label: '+40% Combo Max' } },
  { id: 'ng_divine',      category: 'name_glow', name: 'Divine',         rarity: 'ultra',     cost: 10000000000,   sort: 10, css: { textShadow: '0 0 12px rgba(255,255,255,0.95), 0 0 24px rgba(255,215,0,0.65), 0 0 38px rgba(255,180,0,0.42), 0 0 52px rgba(255,140,0,0.22), 0 0 66px rgba(255,100,0,0.08)', animation: 'cosmetic-divine-glow 2.5s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffffff', '#ffffff'], density: 0.8 } }, buff: { type: 'combo_boost', value: 0.50, label: '+50% Combo Max' } },

  // ── Name Colors (12 items) — Buff: All Coins Bonus ─────────
  { id: 'nc_rose',        category: 'name_color', name: 'Rose',          rarity: 'common',    cost: 10000,         sort: 1,  css: { color: '#fb7185', textShadow: '0 0 6px rgba(251,113,133,0.45)' }, buff: { type: 'coin_bonus', value: 0.005, label: '+0.5% All Coins' } },
  { id: 'nc_mint',        category: 'name_color', name: 'Mint',          rarity: 'common',    cost: 10000,         sort: 2,  css: { color: '#34d399', textShadow: '0 0 6px rgba(52,211,153,0.45)' }, buff: { type: 'coin_bonus', value: 0.005, label: '+0.5% All Coins' } },
  { id: 'nc_sky',         category: 'name_color', name: 'Sky Blue',      rarity: 'common',    cost: 10000,         sort: 3,  css: { color: '#38bdf8', textShadow: '0 0 6px rgba(56,189,248,0.45)' }, buff: { type: 'coin_bonus', value: 0.005, label: '+0.5% All Coins' } },
  { id: 'nc_peach',       category: 'name_color', name: 'Peach',         rarity: 'common',    cost: 15000,         sort: 4,  css: { color: '#fca5a5', textShadow: '0 0 6px rgba(252,165,165,0.45)' }, buff: { type: 'coin_bonus', value: 0.01, label: '+1% All Coins' } },
  { id: 'nc_coral',       category: 'name_color', name: 'Coral',         rarity: 'uncommon',  cost: 400000,        sort: 5,  css: { color: '#f87171', textShadow: '0 0 6px rgba(248,113,113,0.55), 0 0 14px rgba(248,113,113,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.02, label: '+2% All Coins' } },
  { id: 'nc_sunset',      category: 'name_color', name: 'Sunset',        rarity: 'uncommon',  cost: 500000,        sort: 6,  css: { color: '#fb923c', textShadow: '0 0 6px rgba(251,146,60,0.55), 0 0 14px rgba(251,146,60,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.025, label: '+2.5% All Coins' } },
  { id: 'nc_teal',        category: 'name_color', name: 'Teal',          rarity: 'rare',      cost: 35000000,      sort: 7,  css: { color: '#2dd4bf', backgroundImage: 'linear-gradient(90deg, #2dd4bf, #77e3d5, #c0f2ec, #77e3d5, #2dd4bf)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(45,212,191,0.55), 0 0 22px rgba(45,212,191,0.28)' }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'nc_royal',       category: 'name_color', name: 'Royal Purple',  rarity: 'rare',      cost: 50000000,      sort: 8,  css: { color: '#a78bfa', backgroundImage: 'linear-gradient(90deg, #a78bfa, #c6b4fc, #e5dcfe, #c6b4fc, #a78bfa)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(167,139,250,0.55), 0 0 22px rgba(167,139,250,0.28)' }, buff: { type: 'coin_bonus', value: 0.05, label: '+5% All Coins' } },
  { id: 'nc_gold',        category: 'name_color', name: 'Gold',          rarity: 'epic',      cost: 350000000,     sort: 9,  css: { color: '#fbbf24', backgroundImage: 'linear-gradient(110deg, #715610, #fbbf24, #fddc87, #fef5de, #fddc87, #fbbf24, #715610)', backgroundSize: '220% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(251,191,36,0.5), 0 0 24px rgba(251,191,36,0.25)', animation: 'cfx-sweep 3.2s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.07, label: '+7% All Coins' } },
  { id: 'nc_neon',        category: 'name_color', name: 'Neon',          rarity: 'epic',      cost: 400000000,     sort: 10, css: { color: '#65a30d', backgroundImage: 'linear-gradient(90deg, #65a30d, #a3e635, #f7fee7, #a3e635, #65a30d, #65a30d)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cosmetic-neon-flicker 3s infinite, cfx-sweep 2.8s linear infinite', textShadow: '0 0 10px rgba(163,230,53,0.8), 0 0 24px rgba(163,230,53,0.4)' }, buff: { type: 'coin_bonus', value: 0.08, label: '+8% All Coins' } },
  { id: 'nc_chromatic',   category: 'name_color', name: 'Chromatic',     rarity: 'legendary', cost: 2500000000,    sort: 11, css: { color: '#ff6b6b', backgroundImage: 'linear-gradient(90deg, #ff6b6b, #ffd93d, #6bff8a, #6bc6ff, #c86bff, #ff6b6b)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.2s linear infinite', textShadow: '0 0 10px rgba(255,255,255,0.45)', __ambient: { fx: 'sparks', colors: ['#ff6b6b', '#ffd93d', '#6bc6ff'], density: 0.6 } }, buff: { type: 'coin_bonus', value: 0.12, label: '+12% All Coins' } },
  { id: 'nc_glitch',      category: 'name_color', name: 'Glitch',        rarity: 'ultra',     cost: 7500000000,    sort: 12, css: { color: '#00ff88', backgroundImage: 'linear-gradient(90deg, #00ff88, #00ffff, #baffdd, #00ffff, #00ff88, #00ff88)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-glitch 0.3s infinite, cfx-sweep 2.8s linear infinite', textShadow: '2px 0 #ff0040, -2px 0 #00ffff, 0 0 10px rgba(0,255,136,0.6)', __ambient: { fx: 'aura', colors: ['#00ffcc', '#ff0040'], density: 1 } }, buff: { type: 'coin_bonus', value: 0.15, label: '+15% All Coins' } },

  { id: 'nc_alpenglow', category: 'name_color', name: 'Alpenglow', rarity: 'common', cost: 15000, sort: 30, css: { color: '#ffb4a8', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(255,255,255,0.90) 50%, transparent 59%), linear-gradient(96deg, #fde9e4, #ffc3ab, #ff9d9d, #e0a6d6, #b9a9e2, #ff9d9d, #ffc3ab, #fde9e4)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(255,157,157,0.45), 0 0 20px rgba(255,157,157,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'coin_bonus', value: 0.01, label: '+1% All Coins' } },
  { id: 'nc_verdigris', category: 'name_color', name: 'Verdigris', rarity: 'common', cost: 20000, sort: 31, css: { color: '#8ec6b6', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(255,236,190,0.80) 50%, transparent 59%), linear-gradient(96deg, #6fb3a3, #9ecfbf, #d2e3ca, #c9a06a, #a8794c, #9ecfbf, #6fb3a3)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(111,179,163,0.45), 0 0 20px rgba(111,179,163,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'coin_bonus', value: 0.01, label: '+1% All Coins' } },
  { id: 'nc_seaglass', category: 'name_color', name: 'Sea Glass', rarity: 'common', cost: 25000, sort: 32, css: { color: '#bfe4da', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(255,255,255,0.85) 50%, transparent 59%), linear-gradient(96deg, #cfeee7, #a9ddd1, #d9ead0, #f2e7c4, #d9ead0, #a9ddd1, #cfeee7)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(169,221,209,0.45), 0 0 20px rgba(169,221,209,0.16)', animation: 'cfx-schiller 7.5s linear infinite' }, buff: { type: 'coin_bonus', value: 0.01, label: '+1% All Coins' } },
  { id: 'nc_moonstone', category: 'name_color', name: 'Moonstone', rarity: 'uncommon', cost: 250000, sort: 33, css: { color: '#dce7f8', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(120,170,255,0.85) 50%, transparent 59%), linear-gradient(96deg, #e9eefa, #ffffff, #cfe0f7, #a9c6ee, #cfe0f7, #ffffff, #e9eefa)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(169,198,238,0.45), 0 0 20px rgba(169,198,238,0.16)', animation: 'cfx-schiller 7.5s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.02, label: '+2% All Coins' } },
  { id: 'nc_labradorite', category: 'name_color', name: 'Labradorite', rarity: 'uncommon', cost: 600000, sort: 34, css: { color: '#7fa8cf', backgroundImage: 'linear-gradient(100deg, transparent 41%, rgba(190,235,255,0.95) 50%, transparent 59%), linear-gradient(96deg, #38455c, #4e7fb5, #6cc0f0, #cfe3f5, #d9ae52, #4e7fb5, #38455c)', backgroundSize: '300% auto, 200% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 6px rgba(108,192,240,0.45), 0 0 20px rgba(108,192,240,0.16)', animation: 'cfx-schiller 7.5s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.025, label: '+2.5% All Coins' } },

  // ── Titles (17 items) — Buff: Prestige (All Income) ────────
  { id: 'tt_rookie',      category: 'title', name: 'Rookie',         rarity: 'common',    cost: 20000,         sort: 1,  css: { title: 'Rookie',         titleColor: '#9d9d9d' }, buff: { type: 'prestige', value: 0.01, label: '+1% All Income' } },
  { id: 'tt_wordsmith',   category: 'title', name: 'Wordsmith',      rarity: 'uncommon',  cost: 400000,        sort: 2,  css: { title: 'Wordsmith', titleColor: '#4fc34f', titleAnimation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.02, label: '+2% All Income' } },
  { id: 'tt_scholar',     category: 'title', name: 'Scholar',        rarity: 'uncommon',  cost: 750000,        sort: 3,  css: { title: 'Scholar', titleColor: '#60a5fa', titleAnimation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.025, label: '+2.5% All Income' } },
  { id: 'tt_strategist',  category: 'title', name: 'Strategist',     rarity: 'uncommon',  cost: 1000000,       sort: 4,  css: { title: 'Strategist', titleColor: '#a78bfa', titleAnimation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.03, label: '+3% All Income' } },
  { id: 'tt_champion',    category: 'title', name: 'Champion',       rarity: 'rare',      cost: 35000000,      sort: 5,  css: { title: 'Champion', titleColor: '#fbbf24', titleGlow: '0 0 6px rgba(251,191,36,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.05, label: '+5% All Income' } },
  { id: 'tt_veteran',     category: 'title', name: 'Veteran',        rarity: 'rare',      cost: 50000000,      sort: 6,  css: { title: 'Veteran', titleColor: '#f59e0b', titleGlow: '0 0 6px rgba(245,158,11,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.06, label: '+6% All Income' } },
  { id: 'tt_genius',      category: 'title', name: 'Genius',         rarity: 'rare',      cost: 55000000,      sort: 7,  css: { title: 'Genius', titleColor: '#34d399', titleGlow: '0 0 6px rgba(52,211,153,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.065, label: '+6.5% All Income' } },
  { id: 'tt_word_wizard', category: 'title', name: 'Word Wizard',    rarity: 'rare',      cost: 65000000,      sort: 8,  css: { title: 'Word Wizard', titleColor: '#c084fc', titleGlow: '0 0 6px rgba(192,132,252,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.07, label: '+7% All Income' } },
  { id: 'tt_overlord',    category: 'title', name: 'Word Overlord',  rarity: 'epic',      cost: 600000000,     sort: 9,  css: { title: 'Word Overlord', titleColor: '#f97316', titleGlow: '0 0 10px rgba(249,115,22,0.55)', titleBackground: 'linear-gradient(110deg, #7d3a0b, #f97316, #fcb27f, #feeadc, #fcb27f, #f97316, #7d3a0b)', titleAnimation: 'cfx-sweep 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.09, label: '+9% All Income' } },
  { id: 'tt_legend',      category: 'title', name: 'The Legend',     rarity: 'epic',      cost: 700000000,     sort: 10, css: { title: 'The Legend', titleColor: '#fb923c', titleGlow: '0 0 10px rgba(251,146,60,0.55)', titleBackground: 'linear-gradient(110deg, #7e491e, #fb923c, #fdc394, #feefe2, #fdc394, #fb923c, #7e491e)', titleAnimation: 'cfx-sweep 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.10, label: '+10% All Income' } },
  { id: 'tt_tycoon',      category: 'title', name: 'Empire Tycoon',  rarity: 'epic',      cost: 750000000,     sort: 11, css: { title: 'Empire Tycoon', titleColor: '#fbbf24', titleGlow: '0 0 10px rgba(251,191,36,0.55)', titleBackground: 'linear-gradient(110deg, #7e6012, #fbbf24, #fddc87, #fef5de, #fddc87, #fbbf24, #7e6012)', titleAnimation: 'cfx-sweep 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.105, label: '+10.5% All Income' } },
  { id: 'tt_destroyer',   category: 'title', name: 'Word Destroyer', rarity: 'epic',      cost: 750000000,     sort: 12, css: { title: 'Word Destroyer', titleColor: '#ef4444', titleGlow: '0 0 10px rgba(239,68,68,0.55)', titleBackground: 'linear-gradient(110deg, #782222, #ef4444, #f69898, #fde3e3, #f69898, #ef4444, #782222)', titleAnimation: 'cfx-sweep 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.105, label: '+10.5% All Income' } },
  { id: 'tt_ancient',     category: 'title', name: 'Ancient One',    rarity: 'legendary', cost: 2500000000,    sort: 13, css: { title: 'Ancient One', titleColor: '#a78bfa', titleGlow: '0 0 12px rgba(167,139,250,0.65), 0 0 26px rgba(167,139,250,0.3)', titleBackground: 'linear-gradient(110deg, #54467d, #a78bfa, #cfbffc, #f2eefe, #cfbffc, #a78bfa, #54467d)', titleAnimation: 'cfx-sweep 2.6s ease-in-out infinite, cfx-pulse 2.2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.14, label: '+14% All Income' } },
  { id: 'tt_mythic',      category: 'title', name: 'Mythic Legend',  rarity: 'legendary', cost: 3000000000,    sort: 14, css: { title: 'Mythic Legend', titleColor: '#ff6ec7', titleGlow: '0 0 12px rgba(255,110,199,0.65), 0 0 26px rgba(255,110,199,0.3)', titleBackground: 'linear-gradient(110deg, #803764, #ff6ec7, #ffafe0, #ffe9f7, #ffafe0, #ff6ec7, #803764)', titleAnimation: 'cfx-sweep 2.6s ease-in-out infinite, cfx-pulse 2.2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.15, label: '+15% All Income' } },
  { id: 'tt_immortal',    category: 'title', name: 'Immortal',       rarity: 'legendary', cost: 3500000000,    sort: 15, css: { title: 'Immortal', titleColor: '#fbbf24', titleGlow: '0 0 12px rgba(251,191,36,0.65), 0 0 26px rgba(251,191,36,0.3)', titleBackground: 'linear-gradient(110deg, #7e6012, #fbbf24, #fddc87, #fef5de, #fddc87, #fbbf24, #7e6012)', titleAnimation: 'cfx-sweep 2.6s ease-in-out infinite, cfx-pulse 2.2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.16, label: '+16% All Income' } },
  { id: 'tt_god',         category: 'title', name: 'Word God',       rarity: 'ultra',     cost: 8500000000,    sort: 16, css: { title: 'Word God', titleColor: '#ff4444', titleGlow: '0 0 12px rgba(255,68,68,0.7), 0 0 28px rgba(255,68,68,0.35)', titleBackground: 'linear-gradient(110deg, #ff4444, #ffa2a2, #ffe6b4, #ffa2a2, #ff4444)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-god-pulse 2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.18, label: '+18% All Income' } },
  { id: 'tt_supreme',     category: 'title', name: 'Supreme Being',  rarity: 'ultra',     cost: 10000000000,   sort: 17, css: { title: 'Supreme Being', titleColor: '#ffffff', titleGlow: '0 0 12px rgba(255,255,255,0.7), 0 0 28px rgba(255,255,255,0.35)', titleBackground: 'linear-gradient(110deg, #ffffff, #ffffff, #ffffff, #ffffff, #ffffff)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-supreme-pulse 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.20, label: '+20% All Income' } },

  // ── Win Effects (12 items) — Buff: Lucky 2x Chance ─────────
  { id: 'we_confetti',       category: 'win_effect', name: 'Confetti',        rarity: 'common',    cost: 25000,         sort: 1,  css: { effect: 'confetti', colors: ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'], duration: 3000, particleCount: 80 }, buff: { type: 'lucky_bonus', value: 0.01, label: '+1% Lucky 2x' } },
  { id: 'we_sparkles',       category: 'win_effect', name: 'Sparkle Burst',   rarity: 'common',    cost: 25000,         sort: 2,  css: { effect: 'sparkles', colors: ['#ffffff','#fffacd','#ffd700'], duration: 2500, particleCount: 40 }, buff: { type: 'lucky_bonus', value: 0.01, label: '+1% Lucky 2x' } },
  { id: 'we_hearts',         category: 'win_effect', name: 'Heart Shower',    rarity: 'uncommon',  cost: 1000000,       sort: 3,  css: { effect: 'hearts', colors: ['#ff6b81','#ff4757','#ff6348','#ff7979'], duration: 3000, particleCount: 30 }, buff: { type: 'lucky_bonus', value: 0.02, label: '+2% Lucky 2x' } },
  { id: 'we_fireworks',      category: 'win_effect', name: 'Fireworks',       rarity: 'uncommon',  cost: 1500000,       sort: 4,  css: { effect: 'fireworks', colors: ['#ff0000','#ffd700','#00ff00','#00bfff','#ff69b4'], duration: 3500, particleCount: 60 }, buff: { type: 'lucky_bonus', value: 0.025, label: '+2.5% Lucky 2x' } },
  { id: 'we_snowfall',       category: 'win_effect', name: 'Snowfall',        rarity: 'rare',      cost: 55000000,      sort: 5,  css: { effect: 'snowfall', colors: ['#ffffff','#e0f2fe','#bae6fd','#dbeafe'], duration: 4000, particleCount: 60 }, buff: { type: 'lucky_bonus', value: 0.035, label: '+3.5% Lucky 2x' } },
  { id: 'we_lightning',      category: 'win_effect', name: 'Lightning',       rarity: 'rare',      cost: 65000000,      sort: 6,  css: { effect: 'lightning', colors: ['#ffffff','#a5f3fc','#67e8f9'], duration: 2000, particleCount: 8 }, buff: { type: 'lucky_bonus', value: 0.04, label: '+4% Lucky 2x' } },
  { id: 'we_meteors',        category: 'win_effect', name: 'Meteor Shower',   rarity: 'rare',      cost: 75000000,      sort: 7,  css: { effect: 'meteors', colors: ['#ff8c00','#ff6347','#ffd700','#ff4500'], duration: 3000, particleCount: 12 }, buff: { type: 'lucky_bonus', value: 0.05, label: '+5% Lucky 2x' } },
  { id: 'we_cherry_blossom', category: 'win_effect', name: 'Cherry Blossom',  rarity: 'epic',      cost: 600000000,     sort: 8,  css: { effect: 'cherry_blossom', colors: ['#ffb7c5','#ff69b4','#ffc0cb','#fff0f5'], duration: 4000, particleCount: 50 }, buff: { type: 'lucky_bonus', value: 0.07, label: '+7% Lucky 2x' } },
  { id: 'we_aurora',         category: 'win_effect', name: 'Aurora Borealis', rarity: 'epic',      cost: 750000000,     sort: 9,  css: { effect: 'aurora', colors: ['#00ff87','#00bcd4','#7c4dff','#e040fb'], duration: 4000, particleCount: 6 }, buff: { type: 'lucky_bonus', value: 0.08, label: '+8% Lucky 2x' } },
  { id: 'we_galaxy_burst',   category: 'win_effect', name: 'Galaxy Burst',    rarity: 'legendary', cost: 3000000000,    sort: 10, css: { effect: 'galaxy_burst', colors: ['#8b5cf6','#a78bfa','#c4b5fd','#818cf8','#6366f1','#fcd34d'], duration: 4500, particleCount: 120 }, buff: { type: 'lucky_bonus', value: 0.10, label: '+10% Lucky 2x' } },
  { id: 'we_phoenix',        category: 'win_effect', name: 'Phoenix Rise',    rarity: 'legendary', cost: 3500000000,    sort: 11, css: { effect: 'phoenix', colors: ['#ff4500','#ff6347','#ffd700','#ff8c00','#ffffff'], duration: 4500, particleCount: 120 }, buff: { type: 'lucky_bonus', value: 0.11, label: '+11% Lucky 2x' } },
  { id: 'we_nuclear',        category: 'win_effect', name: 'Nuclear Blast',   rarity: 'ultra',     cost: 10000000000,   sort: 12, css: { effect: 'nuclear', colors: ['#ffffff','#ffff00','#ffa500','#ff4500','#ff0000'], duration: 4500, particleCount: 200 }, buff: { type: 'lucky_bonus', value: 0.15, label: '+15% Lucky 2x' } },

  { id: 'we_fireflies', category: 'win_effect', name: 'Fireflies', rarity: 'common', cost: 25000, sort: 30, css: { effect: 'fireflies', colors: ['#ffe9a8', '#fff3c9', '#d8f5b0', '#ffd980'], duration: 4200, particleCount: 34 }, buff: { type: 'lucky_bonus', value: 0.01, label: '+1% Lucky 2x' } },
  { id: 'we_soap_bubbles', category: 'win_effect', name: 'Iridescent Bubbles', rarity: 'uncommon', cost: 300000, sort: 31, css: { effect: 'soap_bubbles', colors: ['#6fd4ff', '#ff8fd0', '#63ffc0', '#b795ff', '#ffdb6b'], duration: 4600, particleCount: 26 }, buff: { type: 'lucky_bonus', value: 0.02, label: '+2% Lucky 2x' } },
  { id: 'we_silk_ribbons', category: 'win_effect', name: 'Silk Ribbons', rarity: 'uncommon', cost: 750000, sort: 32, css: { effect: 'silk_ribbons', colors: ['#ffc9b0', '#ff9e9e', '#d9a7d4', '#b8a9e0', '#fde8e4'], duration: 4800, particleCount: 7 }, buff: { type: 'lucky_bonus', value: 0.025, label: '+2.5% Lucky 2x' } },

  // ── Hero Badges (20 items) — Buff: Library Income ─────────
  // CSS: background gradient applied to hero card .ov-hero-bg element
  { id: 'hb_slate',         category: 'hero_badge', name: 'Slate',           rarity: 'common',    cost: 10000,         sort: 1,  css: { background: 'radial-gradient(120% 90% at 50% 0%, #334155 0%, #1e293b 55%, #0f172a 100%)' }, buff: { type: 'library_boost', value: 0.02, label: '+2% Library Income' } },
  { id: 'hb_ember',         category: 'hero_badge', name: 'Ember',           rarity: 'common',    cost: 12000,         sort: 2,  css: { background: 'radial-gradient(90% 70% at 50% 100%, #7f1d1d 0%, #3d0a0a 45%, #1a0000 100%)' }, buff: { type: 'library_boost', value: 0.03, label: '+3% Library Income' } },
  { id: 'hb_forest',        category: 'hero_badge', name: 'Forest',          rarity: 'common',    cost: 15000,         sort: 3,  css: { background: 'radial-gradient(120% 90% at 50% 0%, #14532d 0%, #0f2b0f 55%, #0a1a0a 100%)' }, buff: { type: 'library_boost', value: 0.04, label: '+4% Library Income' } },
  { id: 'hb_ocean',         category: 'hero_badge', name: 'Ocean',           rarity: 'uncommon',  cost: 500000,        sort: 4,  css: { background: 'linear-gradient(115deg, #0a192f, #0d3b66, #155e75, #0d3b66, #0a192f)', backgroundSize: '300% 100%', animation: 'cfx-flow 13s linear infinite' }, buff: { type: 'library_boost', value: 0.06, label: '+6% Library Income' } },
  { id: 'hb_dusk',          category: 'hero_badge', name: 'Dusk',            rarity: 'uncommon',  cost: 750000,        sort: 5,  css: { background: 'linear-gradient(115deg, #1a0533, #2d1045, #4c1d95, #0f1b3d, #1a0533)', backgroundSize: '300% 100%', animation: 'cfx-flow 14s linear infinite' }, buff: { type: 'library_boost', value: 0.08, label: '+8% Library Income' } },
  { id: 'hb_copper',        category: 'hero_badge', name: 'Copper',          rarity: 'uncommon',  cost: 1000000,       sort: 6,  css: { background: 'linear-gradient(115deg, #1a0f00, #3d2200, #8a5a00, #5c3400, #1a0f00)', backgroundSize: '300% 100%', animation: 'cfx-flow 13s linear infinite' }, buff: { type: 'library_boost', value: 0.10, label: '+10% Library Income' } },
  { id: 'hb_sapphire',      category: 'hero_badge', name: 'Sapphire',        rarity: 'rare',      cost: 35000000,      sort: 7,  css: { background: 'linear-gradient(115deg, #06091e, #0d2857, #2563eb, #1a5276, #06091e)', backgroundSize: '300% 100%', animation: 'cfx-flow 8s linear infinite' }, buff: { type: 'library_boost', value: 0.12, label: '+12% Library Income' } },
  { id: 'hb_ruby',          category: 'hero_badge', name: 'Ruby',            rarity: 'rare',      cost: 50000000,      sort: 8,  css: { background: 'linear-gradient(115deg, #0f0000, #3d0011, #be123c, #7a0022, #0f0000)', backgroundSize: '300% 100%', animation: 'cfx-flow 8s linear infinite' }, buff: { type: 'library_boost', value: 0.14, label: '+14% Library Income' } },
  { id: 'hb_emerald',       category: 'hero_badge', name: 'Emerald',         rarity: 'rare',      cost: 65000000,      sort: 9,  css: { background: 'linear-gradient(115deg, #000f07, #003d1a, #059669, #006633, #000f07)', backgroundSize: '300% 100%', animation: 'cfx-flow 8s linear infinite' }, buff: { type: 'library_boost', value: 0.16, label: '+16% Library Income' } },
  { id: 'hb_amethyst',      category: 'hero_badge', name: 'Amethyst',        rarity: 'epic',      cost: 250000000,     sort: 10, css: { background: 'radial-gradient(60% 80% at 30% 30%, rgba(147,51,234,0.55) 0%, transparent 60%), radial-gradient(70% 90% at 75% 70%, rgba(88,28,135,0.6) 0%, transparent 65%), linear-gradient(135deg, #0f001f, #2d0052, #4a0080, #0f001f)', backgroundSize: '200% 200%, 200% 200%, 300% 300%', animation: 'cfx-galaxy 11s ease-in-out infinite alternate' }, buff: { type: 'library_boost', value: 0.20, label: '+20% Library Income' } },
  { id: 'hb_magma',         category: 'hero_badge', name: 'Magma',           rarity: 'epic',      cost: 400000000,     sort: 11, css: { background: 'radial-gradient(1.5px 1.5px at 22% 78%, #fde047, transparent), radial-gradient(2px 2px at 64% 62%, #fb923c, transparent), linear-gradient(0deg, #661100 0%, #3d0000 55%, #0f0000 100%)', backgroundSize: '160px 160px, 220px 220px, 100% 100%', animation: 'cfx-rise 9s linear infinite', __ambient: { fx: 'embers', colors: ['#fb923c', '#fde047', '#ef4444'], density: 1 } }, buff: { type: 'library_boost', value: 0.24, label: '+24% Library Income' } },
  { id: 'hb_storm',         category: 'hero_badge', name: 'Storm',           rarity: 'epic',      cost: 600000000,     sort: 12, css: { background: 'repeating-linear-gradient(105deg, transparent 0px, transparent 22px, rgba(160,200,255,0.06) 23px, transparent 26px), linear-gradient(180deg, #060610, #141433, #2a2a5c)', backgroundSize: '80px 340px, 100% 100%', animation: 'cfx-fall 3.5s linear infinite, cfx-storm 6s linear infinite' }, buff: { type: 'library_boost', value: 0.28, label: '+28% Library Income' } },
  { id: 'hb_aurora',        category: 'hero_badge', name: 'Aurora',          rarity: 'legendary', cost: 2000000000,    sort: 13, css: { background: 'linear-gradient(100deg, rgba(0,0,0,0) 15%, rgba(52,211,153,0.5) 35%, rgba(56,189,248,0.45) 50%, rgba(167,139,250,0.5) 65%, rgba(0,0,0,0) 85%), linear-gradient(180deg, #001010, #003333, #001010)', backgroundSize: '250% 100%, 100% 100%', animation: 'cfx-aurora 8s ease-in-out infinite' }, buff: { type: 'library_boost', value: 0.35, label: '+35% Library Income' } },
  { id: 'hb_nebula',        category: 'hero_badge', name: 'Nebula',          rarity: 'legendary', cost: 2500000000,    sort: 14, css: { background: 'radial-gradient(1.5px 1.5px at 25% 35%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #e0e7ff, transparent), radial-gradient(60% 80% at 60% 40%, rgba(124,58,237,0.5) 0%, transparent 65%), linear-gradient(135deg, #08001a, #1a0044, #33006b, #08001a)', backgroundSize: '190px 190px, 130px 130px, 200% 200%, 300% 300%', animation: 'cfx-galaxy 13s ease-in-out infinite alternate' }, buff: { type: 'library_boost', value: 0.40, label: '+40% Library Income' } },
  { id: 'hb_inferno',       category: 'hero_badge', name: 'Inferno',         rarity: 'legendary', cost: 3000000000,    sort: 15, css: { background: 'radial-gradient(2px 2px at 30% 70%, #fde047, transparent), radial-gradient(1.5px 1.5px at 75% 55%, #fb923c, transparent), linear-gradient(0deg, #8a2100 0%, #3d0a00 50%, #0f0300 100%)', backgroundSize: '150px 150px, 200px 200px, 100% 100%', animation: 'cfx-rise 7s linear infinite', __ambient: { fx: 'embers', colors: ['#fde047', '#fb923c', '#f87171'], density: 1.5 } }, buff: { type: 'library_boost', value: 0.45, label: '+45% Library Income' } },
  { id: 'hb_arctic',        category: 'hero_badge', name: 'Arctic',          rarity: 'legendary', cost: 3500000000,    sort: 16, css: { background: 'radial-gradient(1.5px 1.5px at 20% 20%, #fff, transparent), radial-gradient(1px 1px at 65% 45%, #dbeafe, transparent), linear-gradient(180deg, #001020, #003355, #005588)', backgroundSize: '140px 140px, 90px 90px, 100% 100%', animation: 'cfx-fall 8s linear infinite' }, buff: { type: 'library_boost', value: 0.50, label: '+50% Library Income' } },
  { id: 'hb_void',          category: 'hero_badge', name: 'Void',            rarity: 'ultra',     cost: 7500000000,    sort: 17, css: { background: 'radial-gradient(70% 90% at 50% 50%, rgba(124,58,237,0.35) 0%, rgba(15,0,37,0.9) 60%, #000000 100%), linear-gradient(135deg, #000000, #0f0025, #000000)', backgroundSize: '200% 200%, 300% 300%', animation: 'cfx-galaxy 10s ease-in-out infinite alternate, cfx-pulse 3.5s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#a855f7', '#6d28d9'], density: 0.8 } }, buff: { type: 'library_boost', value: 0.60, label: '+60% Library Income' } },
  { id: 'hb_supernova',     category: 'hero_badge', name: 'Supernova',       rarity: 'ultra',     cost: 10000000000,   sort: 18, css: { background: 'radial-gradient(80% 100% at 50% 50%, rgba(255,196,0,0.5) 0%, rgba(102,68,0,0.7) 45%, #100500 100%), linear-gradient(115deg, #100500, #3d1a00, #100500)', backgroundSize: '200% 200%, 300% 100%', animation: 'cfx-flow 6s linear infinite, cfx-pulse 2.4s ease-in-out infinite', __ambient: { fx: 'sparks', colors: ['#ffd700', '#ff9500'], density: 1 } }, buff: { type: 'library_boost', value: 0.70, label: '+70% Library Income' } },
  { id: 'hb_celestial',     category: 'hero_badge', name: 'Celestial',       rarity: 'ultra',     cost: 15000000000,   sort: 19, css: { background: 'radial-gradient(2px 2px at 18% 28%, #fff, transparent), radial-gradient(1.5px 1.5px at 58% 68%, #cfe0ff, transparent), radial-gradient(2px 2px at 82% 18%, #fff, transparent), linear-gradient(135deg, #000022, #001166, #0033bb, #000022)', backgroundSize: '220px 220px, 150px 150px, 260px 260px, 300% 300%', animation: 'cfx-drift 26s linear infinite', __ambient: { fx: 'motes', colors: ['#93c5fd', '#e0e7ff'], density: 0.7 } }, buff: { type: 'library_boost', value: 0.80, label: '+80% Library Income' } },
  { id: 'hb_divine',        category: 'hero_badge', name: 'Divine',          rarity: 'ultra',     cost: 20000000000,   sort: 20, css: { background: 'repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 120%, rgba(255,215,0,0.28) 0deg 6deg, rgba(102,85,0,0.12) 6deg 12deg), linear-gradient(0deg, #665500 0%, #332200 55%, #0f0800 100%)', animation: 'cfx-spin 24s linear infinite, cfx-pulse 3s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffd700', '#fff3c4'], density: 1 } }, buff: { type: 'library_boost', value: 1.00, label: '+100% Library Income' } },

  { id: 'hb_moonstone', category: 'hero_badge', name: 'Moonstone', rarity: 'common', cost: 15000, sort: 30, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(150,190,255,0.55), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.30), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(96,140,220,0.45), transparent 100%), radial-gradient(1.4px 1.4px at 30% 40%, rgba(255,255,255,0.85), transparent), #080d18', backgroundSize: '181px 113px, 127px 79px, 89px 57px, 61px 37px', animation: 'cfx-shimmer 30s linear infinite' }, buff: { type: 'library_boost', value: 0.04, label: '+4% Library Income' } },
  { id: 'hb_seaglass', category: 'hero_badge', name: 'Sea Glass', rarity: 'common', cost: 25000, sort: 31, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(120,220,195,0.55), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(214,236,170,0.32), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(60,160,150,0.48), transparent 100%), radial-gradient(1.4px 1.4px at 30% 40%, rgba(232,255,246,0.80), transparent), #04140f', backgroundSize: '181px 113px, 127px 79px, 89px 57px, 61px 37px', animation: 'cfx-shimmer 30s linear infinite' }, buff: { type: 'library_boost', value: 0.04, label: '+4% Library Income' } },
  { id: 'hb_alpenglow', category: 'hero_badge', name: 'Alpenglow', rarity: 'uncommon', cost: 300000, sort: 32, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,140,140,0.58), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(255,190,150,0.34), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(170,140,225,0.50), transparent 100%), radial-gradient(1.4px 1.4px at 30% 40%, rgba(255,236,232,0.80), transparent), #150a16', backgroundSize: '181px 113px, 127px 79px, 89px 57px, 61px 37px', animation: 'cfx-shimmer 27s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'library_boost', value: 0.06, label: '+6% Library Income' } },
  { id: 'hb_verdigris', category: 'hero_badge', name: 'Verdigris', rarity: 'uncommon', cost: 500000, sort: 33, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(90,190,165,0.55), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(210,150,80,0.32), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(140,205,185,0.42), transparent 100%), radial-gradient(1.4px 1.4px at 30% 40%, rgba(226,242,232,0.75), transparent), #04120f', backgroundSize: '181px 113px, 127px 79px, 89px 57px, 61px 37px', animation: 'cfx-shimmer 27s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'library_boost', value: 0.08, label: '+8% Library Income' } },
  { id: 'hb_labradorite', category: 'hero_badge', name: 'Labradorite', rarity: 'uncommon', cost: 750000, sort: 34, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(80,190,250,0.55), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(230,180,70,0.30), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(60,110,190,0.55), transparent 100%), radial-gradient(1.4px 1.4px at 30% 40%, rgba(200,224,255,0.85), transparent), #050a12', backgroundSize: '181px 113px, 127px 79px, 89px 57px, 61px 37px', animation: 'cfx-shimmer 27s linear infinite, cfx-breath 11s ease-in-out infinite' }, buff: { type: 'library_boost', value: 0.1, label: '+10% Library Income' } },

  // ── AUX Audio-Reactive Cosmetics (8 items) — Most expensive tier, multi-buff, audio-reactive ─────
  { id: 'aux_wc_frequency',   category: 'word_color',     name: 'Frequency',      rarity: 'aux', cost: 25000000000, sort: 19, audioReactive: true, css: { color: '#00ffcc', textShadow: '0 0 10px rgba(0,255,204,0.85), 0 0 20px rgba(0,255,128,0.48), 0 0 30px rgba(0,200,255,0.25)', animation: 'aux-frequency 1.5s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#33ffd6', '#8000ff'], density: 1.2 } }, buffs: [{ type: 'tap_boost', value: 0.30, label: '+30% Tap Power' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_wg_bassdrop',    category: 'word_glow',      name: 'Bass Drop',      rarity: 'aux', cost: 25000000000, sort: 13, audioReactive: true, css: { textShadow: '0 0 14px rgba(0,255,204,0.95), 0 0 28px rgba(0,200,255,0.65), 0 0 42px rgba(128,0,255,0.35)', animation: 'aux-bassdrop 0.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#33ffd6', '#8000ff'], density: 1.2 } }, buffs: [{ type: 'word_game_boost', value: 0.35, label: '+35% Word Game Money' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_pb_equalizer',   category: 'profile_border', name: 'Equalizer',      rarity: 'aux', cost: 25000000000, sort: 15, audioReactive: true, css: { border: '3px solid #00ffcc', boxShadow: '0 0 14px rgba(0,255,204,0.75), 0 0 28px rgba(0,200,255,0.45), 0 0 44px rgba(0,255,204,0.18), inset 0 0 10px rgba(0,255,204,0.25)', animation: 'aux-equalizer 1.2s ease-in-out infinite' }, buffs: [{ type: 'biz_boost', value: 0.30, label: '+30% Biz Income' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_pg_subwoofer',   category: 'profile_glow',   name: 'Subwoofer',      rarity: 'aux', cost: 25000000000, sort: 12, audioReactive: true, css: { boxShadow: '0 0 22px rgba(0,255,204,0.85), 0 0 44px rgba(0,200,255,0.55), 0 0 66px rgba(128,0,255,0.35), 0 0 84px rgba(0,255,204,0.12)', animation: 'aux-subwoofer 1.0s ease-in-out infinite' }, buffs: [{ type: 'offline_boost', value: 1.20, label: '+120% Offline Income' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_ng_reverb',      category: 'name_glow',      name: 'Reverb',         rarity: 'aux', cost: 25000000000, sort: 11, audioReactive: true, css: { textShadow: '0 0 10px rgba(0,255,204,0.85), 0 0 20px rgba(0,200,255,0.55), 0 0 30px rgba(128,0,255,0.35), 0 0 40px rgba(0,255,204,0.18)', animation: 'aux-reverb 2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#33ffd6', '#8000ff'], density: 1.2 } }, buffs: [{ type: 'combo_boost', value: 0.60, label: '+60% Combo Max' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_nc_synthwave',   category: 'name_color',     name: 'Synthwave',      rarity: 'aux', cost: 25000000000, sort: 13, audioReactive: true, css: { color: '#00ffcc', textShadow: '0 0 8px rgba(0,255,204,0.7), 0 0 18px rgba(0,255,204,0.35), 0 0 30px rgba(0,200,255,0.15)', animation: 'aux-synthwave 3s linear infinite', __ambient: { fx: 'aura', colors: ['#33ffd6', '#8000ff'], density: 1.2 } }, buffs: [{ type: 'coin_bonus', value: 0.20, label: '+20% All Coins' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_tt_dj',          category: 'title',          name: 'DJ',             rarity: 'aux', cost: 25000000000, sort: 18, audioReactive: true, css: { title: 'DJ', titleColor: '#00ffcc', titleGlow: '0 0 12px rgba(0,255,204,0.85), 0 0 24px rgba(0,200,255,0.5), 0 0 38px rgba(128,0,255,0.28)', animation: 'aux-dj-pulse 1.5s ease-in-out infinite' }, buffs: [{ type: 'prestige', value: 0.25, label: '+25% All Income' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },
  { id: 'aux_we_sonicboom',   category: 'win_effect',     name: 'Sonic Boom',     rarity: 'aux', cost: 25000000000, sort: 13, audioReactive: true, css: { effect: 'sonic_boom', colors: ['#00ffcc','#00ccff','#8000ff','#00ff88','#ffffff'], duration: 4000, particleCount: 200, audioReactive: true }, buffs: [{ type: 'lucky_bonus', value: 0.20, label: '+20% Lucky 2x' }, { type: 'word_reward_2x', value: 1.0, label: '2x Word Reward' }] },

  // ══════════════════════════════════════════════════════════════════
  // ══  COSMETIC SETS — 8 themed sets, one item per category each ══
  // ══════════════════════════════════════════════════════════════════

  // ── Pixel Set (Common) — Retro 8-bit gaming ──────────────────────
  { id: 'set_pixel_wc', setId: 'pixel', category: 'word_color',     name: 'Pixel Pulse',   rarity: 'common', cost: 12500,  sort: 100, css: { color: '#00ff41', textShadow: '0 0 8px rgba(0,255,65,0.5)' }, buff: { type: 'tap_boost', value: 0.01, label: '+1% Tap Power' } },
  { id: 'set_pixel_wg', setId: 'pixel', category: 'word_glow',      name: 'Pixel Glow',    rarity: 'common', cost: 12500,  sort: 100, css: { textShadow: '0 0 8px rgba(0,255,65,0.45)' }, buff: { type: 'word_game_boost', value: 0.02, label: '+2% Word Game Money' } },
  { id: 'set_pixel_pb', setId: 'pixel', category: 'profile_border',  name: 'Pixel Frame',   rarity: 'common', cost: 12500,  sort: 100, css: { border: '3px solid #00ff41' }, buff: { type: 'biz_boost', value: 0.01, label: '+1% Biz Income' } },
  { id: 'set_pixel_pg', setId: 'pixel', category: 'profile_glow',    name: 'Pixel Aura',    rarity: 'common', cost: 12500,  sort: 100, css: { boxShadow: '0 0 10px rgba(0,255,65,0.38)' }, buff: { type: 'offline_boost', value: 0.05, label: '+5% Offline Income' } },
  { id: 'set_pixel_ng', setId: 'pixel', category: 'name_glow',       name: 'Pixel Shine',   rarity: 'common', cost: 12500,  sort: 100, css: { textShadow: '0 0 8px rgba(0,255,65,0.45)' }, buff: { type: 'combo_boost', value: 0.05, label: '+5% Combo Max' } },
  { id: 'set_pixel_nc', setId: 'pixel', category: 'name_color',      name: 'Pixel Green',   rarity: 'common', cost: 12500,  sort: 100, css: { color: '#00ff41', textShadow: '0 0 6px rgba(0,255,65,0.45)' }, buff: { type: 'coin_bonus', value: 0.005, label: '+0.5% All Coins' } },
  { id: 'set_pixel_tt', setId: 'pixel', category: 'title',           name: 'Retro Gamer',   rarity: 'common', cost: 12500,  sort: 100, css: { title: 'Retro Gamer', titleColor: '#00ff41' }, buff: { type: 'prestige', value: 0.01, label: '+1% All Income' } },
  { id: 'set_pixel_we', setId: 'pixel', category: 'win_effect',      name: 'Pixel Burst',   rarity: 'common', cost: 12500,  sort: 100, css: { effect: 'confetti', colors: ['#00ff41','#ff0040','#00bfff','#ffff00'], duration: 3000, particleCount: 60 }, buff: { type: 'lucky_bonus', value: 0.01, label: '+1% Lucky 2x' } },

  // ── Steampunk Set (Uncommon) — Victorian tech, brass/copper ──────
  { id: 'set_steam_wc', setId: 'steampunk', category: 'word_color',     name: 'Brass Ink',     rarity: 'uncommon', cost: 62500,  sort: 101, css: { color: '#b8860b', textShadow: '0 0 8px rgba(184,134,11,0.6), 0 0 18px rgba(184,134,11,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.03, label: '+3% Tap Power' } },
  { id: 'set_steam_wg', setId: 'steampunk', category: 'word_glow',      name: 'Cog Glow',      rarity: 'uncommon', cost: 62500,  sort: 101, css: { textShadow: '0 0 8px rgba(184,134,11,0.6), 0 0 18px rgba(184,115,51,0.28)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.05, label: '+5% Word Game Money' } },
  { id: 'set_steam_pb', setId: 'steampunk', category: 'profile_border',  name: 'Gear Ring',     rarity: 'uncommon', cost: 62500,  sort: 101, css: { border: '3px solid #b87333', boxShadow: '0 0 6px rgba(184,115,51,0.4)' }, buff: { type: 'biz_boost', value: 0.03, label: '+3% Biz Income' } },
  { id: 'set_steam_pg', setId: 'steampunk', category: 'profile_glow',    name: 'Steam Aura',    rarity: 'uncommon', cost: 62500,  sort: 101, css: { boxShadow: '0 0 12px rgba(184,134,11,0.55), 0 0 24px rgba(184,115,51,0.25)' }, buff: { type: 'offline_boost', value: 0.10, label: '+10% Offline Income' } },
  { id: 'set_steam_ng', setId: 'steampunk', category: 'name_glow',       name: 'Brass Shine',   rarity: 'uncommon', cost: 62500,  sort: 101, css: { textShadow: '0 0 8px rgba(184,134,11,0.6), 0 0 16px rgba(184,134,11,0.28)', animation: 'cfx-breath 3.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.10, label: '+10% Combo Max' } },
  { id: 'set_steam_nc', setId: 'steampunk', category: 'name_color',      name: 'Copper Tone',   rarity: 'uncommon', cost: 62500,  sort: 101, css: { color: '#b87333', textShadow: '0 0 6px rgba(184,115,51,0.55), 0 0 14px rgba(184,115,51,0.25)', animation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.02, label: '+2% All Coins' } },
  { id: 'set_steam_tt', setId: 'steampunk', category: 'title',           name: 'Artificer',     rarity: 'uncommon', cost: 62500,  sort: 101, css: { title: 'Artificer', titleColor: '#b8860b', titleAnimation: 'cfx-breath 3.4s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.02, label: '+2% All Income' } },
  { id: 'set_steam_we', setId: 'steampunk', category: 'win_effect',      name: 'Gear Burst',    rarity: 'uncommon', cost: 62500,  sort: 101, css: { effect: 'confetti', colors: ['#b8860b','#b87333','#d4c5a9','#8b7355'], duration: 3000, particleCount: 70 }, buff: { type: 'lucky_bonus', value: 0.02, label: '+2% Lucky 2x' } },

  // ── Sakura Set (Rare) — Cherry blossom, pink/white ───────────────
  { id: 'set_sakura_wc', setId: 'sakura', category: 'word_color',     name: 'Blossom Pink',  rarity: 'rare', cost: 50000000,  sort: 102, css: { color: '#ffb7c5', backgroundImage: 'linear-gradient(90deg, #ffb7c5, #ffd0d9, #ffe9ee, #ffd0d9, #ffb7c5)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,183,197,0.55), 0 0 22px rgba(255,183,197,0.28)' }, buff: { type: 'tap_boost', value: 0.06, label: '+6% Tap Power' } },
  { id: 'set_sakura_wg', setId: 'sakura', category: 'word_glow',      name: 'Petal Glow',    rarity: 'rare', cost: 50000000,  sort: 102, css: { textShadow: '0 0 10px rgba(255,105,180,0.75), 0 0 22px rgba(255,105,180,0.4), 0 0 34px rgba(255,105,180,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.08, label: '+8% Word Game Money' } },
  { id: 'set_sakura_pb', setId: 'sakura', category: 'profile_border',  name: 'Blossom Ring',  rarity: 'rare', cost: 50000000,  sort: 102, css: { border: '3px solid #ff69b4', boxShadow: '0 0 10px rgba(255,105,180,0.6), 0 0 24px rgba(255,105,180,0.28)' }, buff: { type: 'biz_boost', value: 0.06, label: '+6% Biz Income' } },
  { id: 'set_sakura_pg', setId: 'sakura', category: 'profile_glow',    name: 'Petal Aura',    rarity: 'rare', cost: 50000000,  sort: 102, css: { boxShadow: '0 0 14px rgba(255,105,180,0.7), 0 0 30px rgba(255,105,180,0.35), 0 0 46px rgba(255,105,180,0.15)' }, buff: { type: 'offline_boost', value: 0.20, label: '+20% Offline Income' } },
  { id: 'set_sakura_ng', setId: 'sakura', category: 'name_glow',       name: 'Blossom Shine', rarity: 'rare', cost: 50000000,  sort: 102, css: { textShadow: '0 0 10px rgba(255,105,180,0.75), 0 0 22px rgba(255,105,180,0.4), 0 0 34px rgba(255,105,180,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.15, label: '+15% Combo Max' } },
  { id: 'set_sakura_nc', setId: 'sakura', category: 'name_color',      name: 'Sakura Rose',   rarity: 'rare', cost: 50000000,  sort: 102, css: { color: '#ff69b4', backgroundImage: 'linear-gradient(90deg, #ff69b4, #ff9ece, #ffd2e9, #ff9ece, #ff69b4)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,105,180,0.55), 0 0 22px rgba(255,105,180,0.28)' }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'set_sakura_tt', setId: 'sakura', category: 'title',           name: 'Hanami',        rarity: 'rare', cost: 50000000,  sort: 102, css: { title: 'Hanami', titleColor: '#ff69b4', titleGlow: '0 0 6px rgba(255,105,180,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.05, label: '+5% All Income' } },
  { id: 'set_sakura_we', setId: 'sakura', category: 'win_effect',      name: 'Petal Storm',   rarity: 'rare', cost: 50000000,  sort: 102, css: { effect: 'cherry_blossom', colors: ['#ffb7c5','#ff69b4','#ffc0cb','#fff0f5','#ffffff'], duration: 4000, particleCount: 80 }, buff: { type: 'lucky_bonus', value: 0.035, label: '+3.5% Lucky 2x' } },

  // ── Storm Set (Epic) — Lightning/thunder, electric ───────────────
  { id: 'set_storm_wc', setId: 'storm', category: 'word_color',     name: 'Thunder Bolt',    rarity: 'epic', cost: 500000000,  sort: 103, css: { color: '#00bfff', backgroundImage: 'linear-gradient(110deg, #005673, #00bfff, #73dcff, #d9f5ff, #73dcff, #00bfff, #005673)', backgroundSize: '220% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(0,191,255,0.5), 0 0 24px rgba(0,191,255,0.25)', animation: 'cfx-sweep 3.2s ease-in-out infinite' }, buff: { type: 'tap_boost', value: 0.10, label: '+10% Tap Power' } },
  { id: 'set_storm_wg', setId: 'storm', category: 'word_glow',      name: 'Lightning Glow',  rarity: 'epic', cost: 500000000,  sort: 103, css: { textShadow: '0 0 10px rgba(240,230,140,0.85), 0 0 24px rgba(175,240,140,0.45), 0 0 38px rgba(240,230,140,0.2)', animation: 'cfx-breath 2.2s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.14, label: '+14% Word Game Money' } },
  { id: 'set_storm_pb', setId: 'storm', category: 'profile_border',  name: 'Storm Ring',      rarity: 'epic', cost: 500000000,  sort: 103, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #00bfff, #73dcff, #d9f5ff, #73dcff, #00bfff, #00698c, #00bfff)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 4s linear infinite', boxShadow: '0 0 12px rgba(0,191,255,0.6), 0 0 26px rgba(0,191,255,0.28)' }, buff: { type: 'biz_boost', value: 0.11, label: '+11% Biz Income' } },
  { id: 'set_storm_pg', setId: 'storm', category: 'profile_glow',    name: 'Thunder Aura',    rarity: 'epic', cost: 500000000,  sort: 103, css: { boxShadow: '0 0 16px rgba(0,191,255,0.7), 0 0 32px rgba(240,230,140,0.4), 0 0 48px rgba(0,191,255,0.18)', animation: 'cosmetic-electric-aura 1.5s ease-in-out infinite' }, buff: { type: 'offline_boost', value: 0.40, label: '+40% Offline Income' } },
  { id: 'set_storm_ng', setId: 'storm', category: 'name_glow',       name: 'Lightning Shine', rarity: 'epic', cost: 500000000,  sort: 103, css: { textShadow: '0 0 10px rgba(0,191,255,0.85), 0 0 24px rgba(0,0,255,0.45), 0 0 38px rgba(0,191,255,0.2)', animation: 'cfx-breath 2.2s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.28, label: '+28% Combo Max' } },
  { id: 'set_storm_nc', setId: 'storm', category: 'name_color',      name: 'Storm Blue',      rarity: 'epic', cost: 500000000,  sort: 103, css: { color: '#00bfff', backgroundImage: 'linear-gradient(110deg, #005673, #00bfff, #73dcff, #d9f5ff, #73dcff, #00bfff, #005673)', backgroundSize: '220% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(0,191,255,0.5), 0 0 24px rgba(0,191,255,0.25)', animation: 'cfx-sweep 3.2s ease-in-out infinite' }, buff: { type: 'coin_bonus', value: 0.07, label: '+7% All Coins' } },
  { id: 'set_storm_tt', setId: 'storm', category: 'title',           name: 'Stormcaller',     rarity: 'epic', cost: 500000000,  sort: 103, css: { title: 'Stormcaller', titleColor: '#00bfff', titleGlow: '0 0 10px rgba(0,191,255,0.55)', titleBackground: 'linear-gradient(110deg, #006080, #00bfff, #73dcff, #d9f5ff, #73dcff, #00bfff, #006080)', titleAnimation: 'cfx-sweep 3s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.09, label: '+9% All Income' } },
  { id: 'set_storm_we', setId: 'storm', category: 'win_effect',      name: 'Lightning Strike', rarity: 'epic', cost: 500000000, sort: 103, css: { effect: 'lightning', colors: ['#ffffff','#00bfff','#f0e68c','#87ceeb'], duration: 2500, particleCount: 12 }, buff: { type: 'lucky_bonus', value: 0.07, label: '+7% Lucky 2x' } },

  // ── Dragon Set (Legendary) — Draconic, fire/gold ─────────────────
  { id: 'set_dragon_wc', setId: 'dragon', category: 'word_color',     name: 'Dragon Fire',   rarity: 'legendary', cost: 2500000000,  sort: 104, css: { color: '#ff6600', backgroundImage: 'linear-gradient(0deg, #7c2d12 0%, #ff6600 30%, #ffb700 65%, #fff3c4 100%)', backgroundSize: '100% 300%', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(255,140,26,0.8), 0 -6px 18px rgba(255,140,26,0.4)', animation: 'cfx-flame 1.2s ease-in-out infinite alternate', __ambient: { fx: 'sparks', colors: ['#ffb700', '#ff6600'], density: 0.7 } }, buff: { type: 'tap_boost', value: 0.18, label: '+18% Tap Power' } },
  { id: 'set_dragon_wg', setId: 'dragon', category: 'word_glow',      name: 'Flame Glow',    rarity: 'legendary', cost: 2500000000,  sort: 104, css: { textShadow: '0 0 12px rgba(255,102,0,0.85), 0 0 26px rgba(255,215,0,0.55), 0 0 40px rgba(139,0,0,0.3), 0 0 54px rgba(255,102,0,0.12)', animation: 'cfx-breath 2s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ff944d', '#e4ff4d'], density: 0.5 } }, buff: { type: 'word_game_boost', value: 0.20, label: '+20% Word Game Money' } },
  { id: 'set_dragon_pb', setId: 'dragon', category: 'profile_border',  name: 'Scale Ring',    rarity: 'legendary', cost: 2500000000,  sort: 104, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #8b0000, #bf7373, #eed9d9, #bf7373, #8b0000, #4c0000, #8b0000, #bf7373, #8b0000)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 3s linear infinite', boxShadow: '0 0 14px rgba(139,0,0,0.65), 0 0 32px rgba(139,0,0,0.3)' }, buff: { type: 'biz_boost', value: 0.18, label: '+18% Biz Income' } },
  { id: 'set_dragon_pg', setId: 'dragon', category: 'profile_glow',    name: 'Dragon Aura',   rarity: 'legendary', cost: 2500000000,  sort: 104, css: { boxShadow: '0 0 18px rgba(255,102,0,0.8), 0 0 36px rgba(255,215,0,0.5), 0 0 56px rgba(139,0,0,0.28)', animation: 'cosmetic-supernova 2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ff9c59', '#e6ff59'], density: 0.5 } }, buff: { type: 'offline_boost', value: 0.70, label: '+70% Offline Income' } },
  { id: 'set_dragon_ng', setId: 'dragon', category: 'name_glow',       name: 'Flame Shine',   rarity: 'legendary', cost: 2500000000,  sort: 104, css: { textShadow: '0 0 12px rgba(255,102,0,0.85), 0 0 24px rgba(255,215,0,0.55), 0 0 38px rgba(139,0,0,0.3), 0 0 52px rgba(255,102,0,0.12)', animation: 'cfx-breath 2s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ff944d', '#e4ff4d'], density: 0.5 } }, buff: { type: 'combo_boost', value: 0.40, label: '+40% Combo Max' } },
  { id: 'set_dragon_nc', setId: 'dragon', category: 'name_color',      name: 'Dragon Gold',   rarity: 'legendary', cost: 2500000000,  sort: 104, css: { color: '#ffd700', backgroundImage: 'linear-gradient(110deg, #736100, #ffd700, #ffe973, #fff9d9, #ffe973, #ffd700, #736100)', backgroundSize: '220% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(255,215,0,0.6), 0 0 24px rgba(255,215,0,0.3)', animation: 'cfx-sweep 2.8s ease-in-out infinite', __ambient: { fx: 'sparks', colors: ['#ffd700', '#ff6600'], density: 0.7 } }, buff: { type: 'coin_bonus', value: 0.12, label: '+12% All Coins' } },
  { id: 'set_dragon_tt', setId: 'dragon', category: 'title',           name: 'Dragonlord',    rarity: 'legendary', cost: 2500000000,  sort: 104, css: { title: 'Dragonlord', titleColor: '#ff6600', titleGlow: '0 0 12px rgba(255,102,0,0.65), 0 0 26px rgba(255,102,0,0.3)', titleBackground: 'linear-gradient(110deg, #803300, #ff6600, #ffab73, #ffe8d9, #ffab73, #ff6600, #803300)', titleAnimation: 'cfx-sweep 2.6s ease-in-out infinite, cfx-pulse 2.2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.14, label: '+14% All Income' } },
  { id: 'set_dragon_we', setId: 'dragon', category: 'win_effect',      name: 'Dragon Breath', rarity: 'legendary', cost: 2500000000,  sort: 104, css: { effect: 'phoenix', colors: ['#ff6600','#ffd700','#8b0000','#ff4500','#fff8dc'], duration: 4500, particleCount: 120 }, buff: { type: 'lucky_bonus', value: 0.10, label: '+10% Lucky 2x' } },

  // ── Quantum Set (Ultra) — Sci-fi quantum/probability ─────────────
  { id: 'set_quantum_wc', setId: 'quantum', category: 'word_color',     name: 'Qubit Shift',       rarity: 'ultra', cost: 10000000000,  sort: 105, css: { color: '#7c3aed', backgroundImage: 'linear-gradient(90deg, #7c3aed, #c084fc, #e9d5ff, #c084fc, #7c3aed, #7c3aed)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-glitch 0.3s infinite, cfx-sweep 2.8s linear infinite', textShadow: '2px 0 #00ffff, -2px 0 #ff00aa, 0 0 12px rgba(124,58,237,0.7)', __ambient: { fx: 'aura', colors: ['#c084fc', '#00ffff'], density: 1 } }, buff: { type: 'tap_boost', value: 0.22, label: '+22% Tap Power' } },
  { id: 'set_quantum_wg', setId: 'quantum', category: 'word_glow',      name: 'Entangled Glow',    rarity: 'ultra', cost: 10000000000,  sort: 105, css: { textShadow: '0 0 14px rgba(124,58,237,0.9), 0 0 28px rgba(0,255,136,0.58), 0 0 44px rgba(124,58,237,0.35), 0 0 60px rgba(0,255,136,0.15)', animation: 'cfx-breath 1.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#a375f2', '#f275e4'], density: 0.8 } }, buff: { type: 'word_game_boost', value: 0.26, label: '+26% Word Game Money' } },
  { id: 'set_quantum_pb', setId: 'quantum', category: 'profile_border',  name: 'Quantum Ring',      rarity: 'ultra', cost: 10000000000,  sort: 105, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #2e1065, #7c3aed, #00ffff, #7c3aed, #2e1065, #2e1065)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', animation: 'cfx-spin 3s linear infinite', boxShadow: '0 0 14px rgba(124,58,237,0.65), 0 0 30px rgba(0,255,255,0.2)', __ambient: { fx: 'orbit', colors: ['#c084fc', '#00ffff'], density: 1 } }, buff: { type: 'biz_boost', value: 0.22, label: '+22% Biz Income' } },
  { id: 'set_quantum_pg', setId: 'quantum', category: 'profile_glow',    name: 'Probability Aura',  rarity: 'ultra', cost: 10000000000,  sort: 105, css: { boxShadow: '0 0 20px rgba(124,58,237,0.85), 0 0 40px rgba(0,255,136,0.55), 0 0 62px rgba(124,58,237,0.32), 0 0 80px rgba(0,255,136,0.12)', animation: 'cosmetic-cosmic 4s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#aa7ff3', '#f37fe6'], density: 0.8 } }, buff: { type: 'offline_boost', value: 1.00, label: '+100% Offline Income' } },
  { id: 'set_quantum_ng', setId: 'quantum', category: 'name_glow',       name: 'Entangled Shine',   rarity: 'ultra', cost: 10000000000,  sort: 105, css: { textShadow: '0 0 12px rgba(124,58,237,0.95), 0 0 24px rgba(0,255,136,0.6), 0 0 38px rgba(124,58,237,0.35), 0 0 52px rgba(0,255,136,0.15)', animation: 'cfx-breath 1.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#a375f2', '#f275e4'], density: 0.8 } }, buff: { type: 'combo_boost', value: 0.50, label: '+50% Combo Max' } },
  { id: 'set_quantum_nc', setId: 'quantum', category: 'name_color',      name: 'Quantum Violet',    rarity: 'ultra', cost: 10000000000,  sort: 105, css: { color: '#7c3aed', backgroundImage: 'linear-gradient(90deg, #7c3aed, #c084fc, #e9d5ff, #c084fc, #7c3aed, #7c3aed)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-glitch 0.3s infinite, cfx-sweep 2.8s linear infinite', textShadow: '2px 0 #00ffff, -2px 0 #ff00aa, 0 0 12px rgba(124,58,237,0.7)', __ambient: { fx: 'aura', colors: ['#c084fc', '#00ffff'], density: 1 } }, buff: { type: 'coin_bonus', value: 0.15, label: '+15% All Coins' } },
  { id: 'set_quantum_tt', setId: 'quantum', category: 'title',           name: 'Observer',          rarity: 'ultra', cost: 10000000000,  sort: 105, css: { title: 'Observer', titleColor: '#7c3aed', titleGlow: '0 0 12px rgba(124,58,237,0.7), 0 0 28px rgba(124,58,237,0.35)', titleBackground: 'linear-gradient(110deg, #7c3aed, #be9df6, #f8b0f5, #be9df6, #7c3aed)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.18, label: '+18% All Income' } },
  { id: 'set_quantum_we', setId: 'quantum', category: 'win_effect',      name: 'Wave Collapse',     rarity: 'ultra', cost: 10000000000,  sort: 105, css: { effect: 'galaxy_burst', colors: ['#8b5cf6','#00ff88','#a78bfa','#00ffcc','#ffffff'], duration: 4500, particleCount: 200 }, buff: { type: 'lucky_bonus', value: 0.15, label: '+15% Lucky 2x' } },

  // ── Stars & Stripes Set (Gift-only) — Patriotic USA ──────────────
  { id: 'set_usa_wc', setId: 'america', giftSet: true, category: 'word_color',     name: 'Liberty Red',     rarity: 'rare', cost: 0, sort: 106, css: { color: '#b22234', backgroundImage: 'linear-gradient(90deg, #b22234, #cd6f7b, #e8bdc2, #cd6f7b, #b22234)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(178,34,52,0.55), 0 0 22px rgba(178,34,52,0.28)' }, buff: { type: 'tap_boost', value: 0.06, label: '+6% Tap Power' } },
  { id: 'set_usa_wg', setId: 'america', giftSet: true, category: 'word_glow',      name: 'Star Glow',       rarity: 'rare', cost: 0, sort: 106, css: { textShadow: '0 0 10px rgba(60,59,110,0.75), 0 0 22px rgba(60,59,110,0.4), 0 0 34px rgba(60,59,110,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.08, label: '+8% Word Game Money' } },
  { id: 'set_usa_pb', setId: 'america', giftSet: true, category: 'profile_border',  name: 'Star Ring',       rarity: 'rare', cost: 0, sort: 106, css: { border: '3px solid #3c3b6e', boxShadow: '0 0 10px rgba(60,59,110,0.6), 0 0 24px rgba(60,59,110,0.28)' }, buff: { type: 'biz_boost', value: 0.06, label: '+6% Biz Income' } },
  { id: 'set_usa_pg', setId: 'america', giftSet: true, category: 'profile_glow',    name: 'Liberty Aura',    rarity: 'rare', cost: 0, sort: 106, css: { boxShadow: '0 0 14px rgba(178,34,52,0.7), 0 0 30px rgba(178,34,52,0.35), 0 0 46px rgba(178,34,52,0.15)' }, buff: { type: 'offline_boost', value: 0.20, label: '+20% Offline Income' } },
  { id: 'set_usa_ng', setId: 'america', giftSet: true, category: 'name_glow',       name: 'Star Shine',      rarity: 'rare', cost: 0, sort: 106, css: { textShadow: '0 0 10px rgba(60,59,110,0.75), 0 0 22px rgba(60,59,110,0.4), 0 0 34px rgba(60,59,110,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.15, label: '+15% Combo Max' } },
  { id: 'set_usa_nc', setId: 'america', giftSet: true, category: 'name_color',      name: 'Patriot Blue',    rarity: 'rare', cost: 0, sort: 106, css: { color: '#3c3b6e', backgroundImage: 'linear-gradient(90deg, #3c3b6e, #8080a1, #c5c4d4, #8080a1, #3c3b6e)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(60,59,110,0.55), 0 0 22px rgba(60,59,110,0.28)' }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'set_usa_tt', setId: 'america', giftSet: true, category: 'title',           name: 'Patriot',         rarity: 'rare', cost: 0, sort: 106, css: { title: 'Patriot', titleColor: '#b22234', titleGlow: '0 0 6px rgba(60,59,110,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.05, label: '+5% All Income' } },
  { id: 'set_usa_we', setId: 'america', giftSet: true, category: 'win_effect',      name: 'Firework Salute', rarity: 'rare', cost: 0, sort: 106, css: { effect: 'fireworks', colors: ['#b22234','#ffffff','#3c3b6e','#ffd700'], duration: 4000, particleCount: 100 }, buff: { type: 'lucky_bonus', value: 0.035, label: '+3.5% Lucky 2x' } },

  // ── Great North Set (Gift-only) — Patriotic Canada ───────────────
  { id: 'set_can_wc', setId: 'canada', giftSet: true, category: 'word_color',     name: 'Maple Red',       rarity: 'rare', cost: 0, sort: 107, css: { color: '#ff0000', backgroundImage: 'linear-gradient(90deg, #ff0000, #ff5959, #ffb3b3, #ff5959, #ff0000)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,0,0,0.55), 0 0 22px rgba(255,0,0,0.28)' }, buff: { type: 'tap_boost', value: 0.06, label: '+6% Tap Power' } },
  { id: 'set_can_wg', setId: 'canada', giftSet: true, category: 'word_glow',      name: 'Northern Glow',   rarity: 'rare', cost: 0, sort: 107, css: { textShadow: '0 0 10px rgba(255,0,0,0.75), 0 0 22px rgba(255,0,0,0.4), 0 0 34px rgba(255,0,0,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.08, label: '+8% Word Game Money' } },
  { id: 'set_can_pb', setId: 'canada', giftSet: true, category: 'profile_border',  name: 'Maple Ring',      rarity: 'rare', cost: 0, sort: 107, css: { border: '3px solid #c41e3a', boxShadow: '0 0 10px rgba(196,30,58,0.6), 0 0 24px rgba(196,30,58,0.28)' }, buff: { type: 'biz_boost', value: 0.06, label: '+6% Biz Income' } },
  { id: 'set_can_pg', setId: 'canada', giftSet: true, category: 'profile_glow',    name: 'Aurora Aura',     rarity: 'rare', cost: 0, sort: 107, css: { boxShadow: '0 0 14px rgba(196,30,58,0.7), 0 0 30px rgba(196,30,58,0.35), 0 0 46px rgba(196,30,58,0.15)' }, buff: { type: 'offline_boost', value: 0.20, label: '+20% Offline Income' } },
  { id: 'set_can_ng', setId: 'canada', giftSet: true, category: 'name_glow',       name: 'Northern Shine',  rarity: 'rare', cost: 0, sort: 107, css: { textShadow: '0 0 10px rgba(196,30,58,0.75), 0 0 22px rgba(196,30,58,0.4), 0 0 34px rgba(196,30,58,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.15, label: '+15% Combo Max' } },
  { id: 'set_can_nc', setId: 'canada', giftSet: true, category: 'name_color',      name: 'Maple White',     rarity: 'rare', cost: 0, sort: 107, css: { color: '#ffffff', backgroundImage: 'linear-gradient(90deg, #ffffff, #ffffff, #ffffff, #ffffff, #ffffff)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.28)' }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'set_can_tt', setId: 'canada', giftSet: true, category: 'title',           name: 'Voyageur',        rarity: 'rare', cost: 0, sort: 107, css: { title: 'Voyageur', titleColor: '#c41e3a', titleGlow: '0 0 6px rgba(196,30,58,0.4)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.05, label: '+5% All Income' } },
  { id: 'set_can_we', setId: 'canada', giftSet: true, category: 'win_effect',      name: 'Maple Storm',     rarity: 'rare', cost: 0, sort: 107, css: { effect: 'cherry_blossom', colors: ['#ff0000','#c41e3a','#ffffff','#ffcccc'], duration: 4000, particleCount: 80 }, buff: { type: 'lucky_bonus', value: 0.035, label: '+3.5% Lucky 2x' } },
  { id: 'pp_sunspindle_words', category: 'word_color', name: 'Sunspindle Words', rarity: 'ultra', cost: 15200000000, sort: 18.5, css: { color: '#fff4d0', backgroundImage: 'linear-gradient(90deg, #fff4d0, #ebffd0, #fffbec, #ffd5d0, #fff4d0)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,244,208,0.7), 0 0 28px rgba(255,244,208,0.35)', __ambient: { fx: 'aura', colors: ['#fff7de', '#f1ffde'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 6, buff: { type: 'tap_boost', value: 0.255, label: '+25.5% Tap Power' } },
  { id: 'pp_opaline_lexicon', category: 'word_color', name: 'Opaline Lexicon', rarity: 'ultra', cost: 16800000000, sort: 19, css: { color: '#fff7e5', backgroundImage: 'linear-gradient(90deg, #fff7e5, #f6ffe5, #fffcf5, #ffe6e5, #fff7e5)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,247,229,0.7), 0 0 28px rgba(255,247,229,0.35)', __ambient: { fx: 'aura', colors: ['#fff9ed', '#f9ffed'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 24, buff: { type: 'tap_boost', value: 0.26, label: '+26% Tap Power' } },
  { id: 'dc_prism_lattice', category: 'profile_border', name: 'Prism Lattice', rarity: 'ultra', cost: 15500000000, sort: 14.5, css: { border: '4px solid #9fe0ff', boxShadow: '0 0 18px rgba(159,224,255,0.78), 0 0 36px rgba(111,116,255,0.32), 0 0 56px rgba(229,248,255,0.16), inset 0 0 0 1px rgba(255,255,255,0.4), inset 0 0 18px rgba(98,195,255,0.22)' }, fallbackCss: { border: '4px solid #9fe0ff', boxShadow: '0 0 18px rgba(159,224,255,0.78), 0 0 36px rgba(111,116,255,0.32), 0 0 56px rgba(229,248,255,0.16), inset 0 0 0 1px rgba(255,255,255,0.4), inset 0 0 18px rgba(98,195,255,0.22)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/donor-prism-lattice-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 2, buff: { type: 'biz_boost', value: 0.255, label: '+25.5% Biz Income' } },
  { id: 'pb_donor_signal', category: 'profile_border', name: 'Donor Signal', rarity: 'ultra', cost: 18000000000, sort: 15, css: { border: '4px solid #6aa8ff', boxShadow: '0 0 16px rgba(106,168,255,0.55), 0 0 32px rgba(132,87,255,0.35)' }, fallbackCss: { border: '4px solid #6aa8ff', boxShadow: '0 0 16px rgba(106,168,255,0.55), 0 0 32px rgba(132,87,255,0.35)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/donor-signal-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 10, buff: { type: 'biz_boost', value: 0.26, label: '+26% Biz Income' } },
  { id: 'dc_signal_trace', category: 'profile_border', name: 'Lumenvale Crest', rarity: 'ultra', cost: 21000000000, sort: 16, css: { border: '4px solid #7cbcff', boxShadow: '0 0 18px rgba(124,188,255,0.62), 0 0 34px rgba(124,188,255,0.24), 0 0 42px rgba(123,97,255,0.18)' }, fallbackCss: { border: '4px solid #7cbcff', boxShadow: '0 0 18px rgba(124,188,255,0.62), 0 0 34px rgba(124,188,255,0.24), 0 0 42px rgba(123,97,255,0.18)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/donor-trace-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 12, buff: { type: 'biz_boost', value: 0.27, label: '+27% Biz Income' } },
  { id: 'pp_crownthread', category: 'profile_border', name: 'Crown Thread', rarity: 'ultra', cost: 22000000000, sort: 16.5, css: { border: '4px solid #ffe18b', boxShadow: '0 0 18px rgba(255,225,139,0.82), 0 0 34px rgba(255,209,104,0.34), 0 0 56px rgba(255,246,221,0.16), inset 0 0 0 1px rgba(255,250,234,0.48), inset 0 0 16px rgba(255,214,102,0.18)' }, fallbackCss: { border: '4px solid #ffe18b', boxShadow: '0 0 18px rgba(255,225,139,0.82), 0 0 34px rgba(255,209,104,0.34), 0 0 56px rgba(255,246,221,0.16), inset 0 0 0 1px rgba(255,250,234,0.48), inset 0 0 16px rgba(255,214,102,0.18)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/pookie-crownthread-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 1, buff: { type: 'biz_boost', value: 0.275, label: '+27.5% Biz Income' } },
  { id: 'pb_pookie_orbit', category: 'profile_border', name: 'Pookie Orbit', rarity: 'ultra', cost: 25000000000, sort: 17, css: { border: '4px solid #f0c33c', boxShadow: '0 0 16px rgba(240,195,60,0.65), 0 0 34px rgba(153,82,255,0.38)' }, fallbackCss: { border: '4px solid #f0c33c', boxShadow: '0 0 16px rgba(240,195,60,0.65), 0 0 34px rgba(153,82,255,0.38)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/pookie-orbit-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 30, buff: { type: 'biz_boost', value: 0.28, label: '+28% Biz Income' } },
  { id: 'pp_royal_halo', category: 'profile_border', name: 'Sun Court Halo', rarity: 'ultra', cost: 28000000000, sort: 18, css: { border: '4px solid #f7d86b', boxShadow: '0 0 18px rgba(247,216,107,0.7), 0 0 36px rgba(160,107,255,0.32), 0 0 48px rgba(255,216,111,0.2)' }, fallbackCss: { border: '4px solid #f7d86b', boxShadow: '0 0 18px rgba(247,216,107,0.7), 0 0 36px rgba(160,107,255,0.32), 0 0 48px rgba(255,216,111,0.2)' }, render: { type: 'svg_frame', asset: '/portal/assets/cosmetics/frames/pookie-royal-halo-frame.svg', anchor: 'avatar', zIndex: 3 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 32, buff: { type: 'biz_boost', value: 0.29, label: '+29% Biz Income' } },
  { id: 'ft_signal_bloom', category: 'profile_glow', name: 'Signal Bloom', rarity: 'ultra', cost: 11000000000, sort: 11.5, css: { boxShadow: '0 0 16px rgba(110,206,255,0.78), 0 0 30px rgba(123,97,255,0.34), 0 0 48px rgba(231,247,255,0.14)', animation: 'cosmetic-electric-aura 2.6s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#a1dfff', '#a9a1ff'], density: 0.8 } }, membershipTier: 'free', unlockSource: 'battlepass', battlePassTier: 'free', battlePassLevel: 3, buff: { type: 'offline_boost', value: 1.01, label: '+101% Offline Income' } },
  { id: 'ft_signal_spark', category: 'profile_glow', name: 'Signal Spark', rarity: 'ultra', cost: 12000000000, sort: 12, css: { boxShadow: '0 0 18px rgba(99,179,255,0.78), 0 0 34px rgba(99,179,255,0.42), 0 0 52px rgba(123,97,255,0.2)', animation: 'cosmetic-electric-aura 1.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#9aceff', '#b29aff'], density: 0.8 } }, membershipTier: 'free', unlockSource: 'battlepass', battlePassTier: 'free', battlePassLevel: 8, buff: { type: 'offline_boost', value: 1.05, label: '+105% Offline Income' } },
  { id: 'dc_afterglow',   category: 'profile_glow', name: 'Afterglow',    rarity: 'ultra', cost: 14500000000, sort: 13, css: { boxShadow: '0 0 18px rgba(98,195,255,0.72), 0 0 32px rgba(123,97,255,0.36), 0 0 54px rgba(215,240,255,0.16)', animation: 'cosmetic-electric-aura 2.2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#99d8ff', '#a799ff'], density: 0.8 } }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 18, buff: { type: 'offline_boost', value: 1.08, label: '+108% Offline Income' } },
  { id: 'pp_moonveil', category: 'profile_glow', name: 'Moonveil', rarity: 'ultra', cost: 19500000000, sort: 13.5, css: { boxShadow: '0 0 0 2px rgba(255,247,223,0.28), 0 0 18px rgba(255,236,176,0.92), 0 0 38px rgba(255,213,104,0.48), 0 0 68px rgba(160,107,255,0.34), inset 0 0 18px rgba(255,255,255,0.12), inset 0 0 42px rgba(133,90,255,0.14)', animation: 'cosmetic-divine-glow 2.8s ease-in-out infinite, cosmetic-celestial 7.2s linear infinite', __ambient: { fx: 'aura', colors: ['#fffaea', '#f5ffea'], density: 0.8 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 2, buff: { type: 'offline_boost', value: 1.11, label: '+111% Offline Income' } },
  { id: 'pp_solstice_aura', category: 'profile_glow', name: 'Solstice Aura', rarity: 'ultra', cost: 20800000000, sort: 13.75, css: { boxShadow: '0 0 0 2px rgba(255,245,214,0.26), 0 0 18px rgba(255,223,128,0.88), 0 0 34px rgba(255,211,102,0.52), 0 0 60px rgba(166,110,255,0.3), inset 0 0 18px rgba(255,255,255,0.1)', animation: 'cosmetic-divine-glow 3.4s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#fff9e4', '#f1ffe4'], density: 0.8 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 28, buff: { type: 'offline_boost', value: 1.115, label: '+111.5% Offline Income' } },
  { id: 'pp_velvet_aura', category: 'profile_glow', name: 'Velvet Aura',  rarity: 'ultra', cost: 20500000000, sort: 14, css: { boxShadow: '0 0 20px rgba(255,216,111,0.78), 0 0 38px rgba(160,107,255,0.34), 0 0 60px rgba(255,216,111,0.16)', animation: 'cosmetic-divine-glow 3.2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffe6a1', '#d2ffa1'], density: 0.8 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 34, buff: { type: 'offline_boost', value: 1.12, label: '+112% Offline Income' } },
  { id: 'ft_signal_lilt', category: 'name_glow', name: 'Signal Lilt',    rarity: 'ultra',     cost: 13500000000,   sort: 11, css: { textShadow: '0 0 10px rgba(98,195,255,0.8), 0 0 22px rgba(123,97,255,0.38), 0 0 36px rgba(215,240,255,0.18)', animation: 'cfx-breath 1.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#91d5ff', '#a091ff'], density: 0.8 } }, membershipTier: 'free', unlockSource: 'battlepass', battlePassTier: 'free', battlePassLevel: 28, buff: { type: 'combo_boost', value: 0.18, label: '+18% Combo Max' } },
  { id: 'pp_starlace_glow', category: 'name_glow', name: 'Starlace Glow', rarity: 'ultra', cost: 14600000000, sort: 11.5, css: { textShadow: '0 0 10px rgba(255,242,198,0.92), 0 0 22px rgba(255,214,111,0.64), 0 0 34px rgba(186,132,255,0.34), 0 0 48px rgba(255,255,255,0.16)', animation: 'cosmetic-divine-glow 3.4s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#fff6d7', '#eaffd7'], density: 0.8 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 8, buff: { type: 'combo_boost', value: 0.54, label: '+54% Combo Max' } },
  { id: 'pp_gilded_script', category: 'name_color', name: 'Gilded Script', rarity: 'ultra', cost: 13500000000, sort: 12.5, css: { color: '#fff0bb', backgroundImage: 'linear-gradient(90deg, #fff0bb, #e1ffbb, #fff9e4, #ffc3bb, #fff0bb)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,240,187,0.7), 0 0 28px rgba(255,240,187,0.35)', __ambient: { fx: 'aura', colors: ['#fff5cf', '#eaffcf'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 3, buff: { type: 'coin_bonus', value: 0.155, label: '+15.5% All Coins' } },
  { id: 'pp_starfall_name', category: 'name_color', name: 'Starfall Name', rarity: 'ultra', cost: 14000000000, sort: 13, css: { color: '#fff2c8', backgroundImage: 'linear-gradient(90deg, #fff2c8, #e7ffc8, #fffae9, #ffcdc8, #fff2c8)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,242,200,0.7), 0 0 28px rgba(255,242,200,0.35)', __ambient: { fx: 'aura', colors: ['#fff6d9', '#eeffd9'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 35, buff: { type: 'coin_bonus', value: 0.16, label: '+16% All Coins' } },
  { id: 'pp_orchid_static', category: 'name_color', name: 'Orchid Static', rarity: 'ultra', cost: 15800000000, sort: 13.25, css: { color: '#fff0ff', backgroundImage: 'linear-gradient(90deg, #fff0ff, #fff0f5, #fff9ff, #f5f0ff, #fff0ff)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,240,255,0.7), 0 0 28px rgba(255,240,255,0.35)', __ambient: { fx: 'aura', colors: ['#fff5ff', '#fff5f8'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 9, buff: { type: 'coin_bonus', value: 0.158, label: '+15.8% All Coins' } },
  { id: 'pp_celestial_ink', category: 'name_color', name: 'Celestial Ink', rarity: 'ultra', cost: 18600000000, sort: 13.5, css: { color: '#fff6de', backgroundImage: 'linear-gradient(90deg, #fff6de, #f2ffde, #fffbf2, #ffe0de, #fff6de)', backgroundSize: '300% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite', textShadow: '0 0 12px rgba(255,246,222,0.7), 0 0 28px rgba(255,246,222,0.35)', __ambient: { fx: 'aura', colors: ['#fff9e8', '#f6ffe8'], density: 1 } }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 21, buff: { type: 'coin_bonus', value: 0.162, label: '+16.2% All Coins' } },
  { id: 'ft_wave_tag',    category: 'title', name: 'Wave Tag',       rarity: 'ultra',     cost: 12000000000,   sort: 18, css: { title: 'Wave Tag', titleColor: '#9dd7ff', titleGlow: '0 0 12px rgba(157,215,255,0.7), 0 0 28px rgba(157,215,255,0.35)', titleBackground: 'linear-gradient(110deg, #9dd7ff, #ceebff, #dbd8ff, #ceebff, #9dd7ff)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-prismatic 6s linear infinite' }, membershipTier: 'free', unlockSource: 'battlepass', battlePassTier: 'free', battlePassLevel: 18, buff: { type: 'prestige', value: 0.21, label: '+21% All Income' } },
  { id: 'dc_patron_pulse', category: 'title', name: 'Patron Pulse', rarity: 'ultra', cost: 14500000000, sort: 18.5, css: { title: 'Patron Pulse', titleColor: '#f3ecff', titleGlow: '0 0 12px rgba(243,236,255,0.7), 0 0 28px rgba(243,236,255,0.35)', titleBackground: 'linear-gradient(110deg, #f3ecff, #f9f6ff, #fff7ff, #f9f6ff, #f3ecff)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-prismatic 4.8s linear infinite' }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 4, buff: { type: 'prestige', value: 0.215, label: '+21.5% All Income' } },
  { id: 'dc_prism_title', category: 'title', name: 'Prism Title',    rarity: 'ultra',     cost: 15000000000,   sort: 19, css: { title: 'Prism Title', titleColor: '#efe9ff', titleGlow: '0 0 12px rgba(239,233,255,0.7), 0 0 28px rgba(239,233,255,0.35)', titleBackground: 'linear-gradient(110deg, #efe9ff, #f7f4ff, #fff6ff, #f7f4ff, #efe9ff)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-prismatic 3.6s linear infinite' }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 15, buff: { type: 'prestige', value: 0.22, label: '+22% All Income' } },
  { id: 'dc_supporter_stamp', category: 'title', name: 'Supporter Stamp', rarity: 'ultra', cost: 17500000000, sort: 20, css: { title: 'Supporter Stamp', titleColor: '#d7f0ff', titleGlow: '0 0 12px rgba(215,240,255,0.7), 0 0 28px rgba(215,240,255,0.35)', titleBackground: 'linear-gradient(110deg, #d7f0ff, #ebf8ff, #f0efff, #ebf8ff, #d7f0ff)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-legendary-glow 3s ease-in-out infinite' }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 28, buff: { type: 'prestige', value: 0.23, label: '+23% All Income' } },
  { id: 'pp_velour_vow', category: 'title', name: 'Velour Vow', rarity: 'ultra', cost: 19800000000, sort: 20.5, css: { title: 'Velour Vow', titleColor: '#fff4d3', titleGlow: '0 0 12px rgba(255,244,211,0.7), 0 0 28px rgba(255,244,211,0.35)', titleBackground: 'linear-gradient(110deg, #fff4d3, #fffae9, #f8ffed, #fffae9, #fff4d3)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-prismatic 5.2s linear infinite' }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 12, buff: { type: 'prestige', value: 0.235, label: '+23.5% All Income' } },
  { id: 'pp_rosecourt_title', category: 'title', name: 'Rosecourt Title', rarity: 'ultra', cost: 17600000000, sort: 20.75, css: { title: 'Rosecourt', titleColor: '#fff0da', titleGlow: '0 0 12px rgba(255,240,218,0.7), 0 0 28px rgba(255,240,218,0.35)', titleBackground: 'linear-gradient(110deg, #fff0da, #fff8ed, #fbfff0, #fff8ed, #fff0da)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-prismatic 5.8s linear infinite' }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 11, buff: { type: 'prestige', value: 0.232, label: '+23.2% All Income' } },
  { id: 'pp_gilded_vow', category: 'title', name: 'Gilded Vow', rarity: 'ultra', cost: 20200000000, sort: 21, css: { title: 'Gilded Vow', titleColor: '#fff5da', titleGlow: '0 0 12px rgba(255,245,218,0.7), 0 0 28px rgba(255,245,218,0.35)', titleBackground: 'linear-gradient(110deg, #fff5da, #fffaed, #f9fff0, #fffaed, #fff5da)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite', animation: 'cosmetic-divine-glow 3.6s ease-in-out infinite' }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 37, buff: { type: 'prestige', value: 0.238, label: '+23.8% All Income' } },
  { id: 'ft_arc_ping',       category: 'win_effect', name: 'Arc Ping',        rarity: 'ultra',     cost: 13000000000,   sort: 13, css: { effect: 'sparkles', colors: ['#63b3ff', '#7b61ff', '#d7f0ff', '#ffffff'], duration: 2600, particleCount: 44 }, membershipTier: 'free', unlockSource: 'battlepass', battlePassTier: 'free', battlePassLevel: 12, buff: { type: 'lucky_bonus', value: 0.11, label: '+11% Lucky 2x' } },
  { id: 'dc_grid_pop',       category: 'win_effect', name: 'Grid Pop',        rarity: 'ultra',     cost: 17000000000,   sort: 14, css: { effect: 'fireworks', colors: ['#62c3ff', '#7b61ff', '#bba7ff', '#d7f0ff'], duration: 3600, particleCount: 90 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 25, buff: { type: 'lucky_bonus', value: 0.16, label: '+16% Lucky 2x' } },
  { id: 'pp_starpetal_burst', category: 'win_effect', name: 'Starpetal Burst', rarity: 'ultra', cost: 21000000000, sort: 14.5, css: { effect: 'aurora', colors: ['#ffe08a', '#fff6dc', '#c992ff', '#ffbfd8'], duration: 3900, particleCount: 10 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 4, buff: { type: 'lucky_bonus', value: 0.165, label: '+16.5% Lucky 2x' } },
  { id: 'pp_courtfire', category: 'win_effect', name: 'Courtfire', rarity: 'ultra', cost: 21400000000, sort: 14.75, css: { effect: 'fireworks', colors: ['#fff3cf', '#ffd86f', '#a06bff', '#ffb3e8'], duration: 4300, particleCount: 120 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 20, buff: { type: 'lucky_bonus', value: 0.168, label: '+16.8% Lucky 2x' } },
  { id: 'pp_comet_trail',    category: 'win_effect', name: 'Comet Trail',     rarity: 'ultra',     cost: 22000000000,   sort: 15, css: { effect: 'meteors', colors: ['#ffd86f', '#fff3c4', '#a06bff', '#ffb84d'], duration: 4200, particleCount: 18 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 38, buff: { type: 'lucky_bonus', value: 0.17, label: '+17% Lucky 2x' } },
  { id: 'hb_donor_signal',   category: 'hero_badge', name: 'Donor Signal',   rarity: 'ultra',     cost: 18000000000,   sort: 21, css: { background: 'linear-gradient(135deg, rgba(15,28,56,0.86), rgba(59,130,246,0.16), rgba(109,40,217,0.18), rgba(15,28,56,0.9))', backgroundSize: '220% 220%' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(15,28,56,0.86), rgba(59,130,246,0.16), rgba(109,40,217,0.18), rgba(15,28,56,0.9))', backgroundSize: '220% 220%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/donor-signal-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.9 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 20, buff: { type: 'library_boost', value: 1.05, label: '+105% Library Income' } },
  { id: 'hb_donor_prism',    category: 'hero_badge', name: 'Donor Prism',    rarity: 'ultra',     cost: 21000000000,   sort: 22, css: { background: 'linear-gradient(135deg, rgba(14,24,50,0.9), rgba(98,195,255,0.12), rgba(123,97,255,0.18), rgba(14,24,50,0.94))', backgroundSize: '240% 240%' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(14,24,50,0.9), rgba(98,195,255,0.12), rgba(123,97,255,0.18), rgba(14,24,50,0.94))', backgroundSize: '240% 240%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/donor-prism-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.9 }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 22, buff: { type: 'library_boost', value: 1.08, label: '+108% Library Income' } },
  { id: 'hb_pookie_daystar', category: 'hero_badge', name: 'Daystar Court', rarity: 'ultra', cost: 22200000000, sort: 22.2, css: { background: 'linear-gradient(135deg, rgba(31,16,48,0.94), rgba(255,228,144,0.14), rgba(167,107,255,0.16), rgba(31,16,48,0.98))', backgroundSize: '250% 250%', animation: 'ov-gradient-flow 24s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(31,16,48,0.94), rgba(255,228,144,0.14), rgba(167,107,255,0.16), rgba(31,16,48,0.98))', backgroundSize: '250% 250%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-daystar-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 5, buff: { type: 'library_boost', value: 1.06, label: '+106% Library Income' } },
  { id: 'hb_pookie_veilstar', category: 'hero_badge', name: 'Veilstar Court', rarity: 'ultra', cost: 22800000000, sort: 22.4, css: { background: 'linear-gradient(135deg, rgba(27,15,46,0.95), rgba(255,218,124,0.12), rgba(160,107,255,0.18), rgba(27,15,46,0.99))', backgroundSize: '255% 255%', animation: 'ov-gradient-flow 22s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(27,15,46,0.95), rgba(255,218,124,0.12), rgba(160,107,255,0.18), rgba(27,15,46,0.99))', backgroundSize: '255% 255%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-veilstar-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 15, buff: { type: 'library_boost', value: 1.07, label: '+107% Library Income' } },
  { id: 'hb_pookie_lumenveil', category: 'hero_badge', name: 'Lumenveil Crest', rarity: 'ultra', cost: 23100000000, sort: 22.5, css: { background: 'linear-gradient(135deg, rgba(26,14,42,0.96), rgba(255,231,156,0.14), rgba(201,146,255,0.18), rgba(26,14,42,0.99))', backgroundSize: '260% 260%', animation: 'ov-gradient-flow 21s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(26,14,42,0.96), rgba(255,231,156,0.14), rgba(201,146,255,0.18), rgba(26,14,42,0.99))', backgroundSize: '260% 260%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-lumenveil-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 18, buff: { type: 'library_boost', value: 1.075, label: '+107.5% Library Income' } },
  { id: 'hb_pookie_mooncourt', category: 'hero_badge', name: 'Mooncourt Sigil', rarity: 'ultra', cost: 23300000000, sort: 22.6, css: { background: 'linear-gradient(135deg, rgba(25,14,43,0.96), rgba(255,214,112,0.12), rgba(160,107,255,0.18), rgba(25,14,43,1))', backgroundSize: '260% 260%', animation: 'ov-gradient-flow 20s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(25,14,43,0.96), rgba(255,214,112,0.12), rgba(160,107,255,0.18), rgba(25,14,43,1))', backgroundSize: '260% 260%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-mooncourt-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 25, buff: { type: 'library_boost', value: 1.08, label: '+108% Library Income' } },
  { id: 'hb_pookie_suncourt', category: 'hero_badge', name: 'Suncourt Halo', rarity: 'ultra', cost: 24100000000, sort: 22.9, css: { background: 'linear-gradient(135deg, rgba(28,14,40,0.96), rgba(255,225,148,0.16), rgba(162,106,255,0.18), rgba(28,14,40,0.99))', backgroundSize: '270% 270%', animation: 'ov-gradient-flow 19s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(28,14,40,0.96), rgba(255,225,148,0.16), rgba(162,106,255,0.18), rgba(28,14,40,0.99))', backgroundSize: '270% 270%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-suncourt-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 31, buff: { type: 'library_boost', value: 1.088, label: '+108.8% Library Income' } },
  { id: 'hb_pookie_starcall', category: 'hero_badge', name: 'Starcall Archive', rarity: 'ultra', cost: 23800000000, sort: 22.8, css: { background: 'linear-gradient(135deg, rgba(23,14,42,0.96), rgba(255,214,111,0.12), rgba(160,107,255,0.2), rgba(23,14,42,1))', backgroundSize: '270% 270%', animation: 'ov-gradient-flow 18s ease infinite' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(23,14,42,0.96), rgba(255,214,111,0.12), rgba(160,107,255,0.2), rgba(23,14,42,1))', backgroundSize: '270% 270%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-starcall-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 33, buff: { type: 'library_boost', value: 1.085, label: '+108.5% Library Income' } },
  { id: 'hb_pookie_constellation', category: 'hero_badge', name: 'Pookie Constellation', rarity: 'ultra', cost: 23500000000, sort: 23, css: { background: 'linear-gradient(135deg, rgba(30,16,48,0.92), rgba(255,217,107,0.12), rgba(167,107,255,0.16), rgba(30,16,48,0.96))', backgroundSize: '250% 250%' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(30,16,48,0.92), rgba(255,217,107,0.12), rgba(167,107,255,0.16), rgba(30,16,48,0.96))', backgroundSize: '250% 250%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-constellation-badge.svg', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 36, buff: { type: 'library_boost', value: 1.09, label: '+109% Library Income' } },
  { id: 'hb_pookie_crown',   category: 'hero_badge', name: 'Pookie Sigil',   rarity: 'ultra',     cost: 25000000000,   sort: 24, css: { background: 'linear-gradient(135deg, rgba(32,16,48,0.9), rgba(255,204,84,0.14), rgba(153,82,255,0.18), rgba(32,16,48,0.94))', backgroundSize: '240% 240%' }, fallbackCss: { background: 'linear-gradient(135deg, rgba(32,16,48,0.9), rgba(255,204,84,0.14), rgba(153,82,255,0.18), rgba(32,16,48,0.94))', backgroundSize: '240% 240%' }, render: { type: 'svg_badge', asset: '/portal/assets/cosmetics/badges/pookie-crown-badge.svg?v=3', anchor: 'surface', zIndex: 1, opacity: 0.92 }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 40, buff: { type: 'library_boost', value: 1.1, label: '+110% Library Income' } },
  { id: 'dc_signal_slate',   category: 'hero_badge', name: 'Signal Slate',   rarity: 'ultra',     cost: 22500000000,   sort: 25, css: { background: 'linear-gradient(135deg, rgba(10,20,44,0.94), rgba(98,195,255,0.10), rgba(123,97,255,0.16), rgba(12,26,52,0.96))', backgroundSize: '260% 260%', animation: 'cfx-flow 7s linear infinite', __ambient: { fx: 'motes', colors: ['#ffffff', '#ffe9b3'], density: 0.5 } }, fallbackCss: { background: 'linear-gradient(135deg, rgba(10,20,44,0.94), rgba(98,195,255,0.10), rgba(123,97,255,0.16), rgba(12,26,52,0.96))', backgroundSize: '260% 260%' }, membershipTier: 'donor_class', unlockSource: 'battlepass', battlePassTier: 'donor_class', battlePassLevel: 34, buff: { type: 'library_boost', value: 1.085, label: '+108.5% Library Income' } },
  { id: 'pp_signal_throne',  category: 'hero_badge', name: 'Signal Throne',  rarity: 'ultra',     cost: 25500000000,   sort: 26, css: { background: 'linear-gradient(135deg, rgba(24,14,42,0.96), rgba(255,216,111,0.12), rgba(160,107,255,0.16), rgba(24,14,42,0.98))', backgroundSize: '280% 280%', animation: 'cfx-flow 7s linear infinite', __ambient: { fx: 'motes', colors: ['#ffffff', '#ffe9b3'], density: 0.5 } }, fallbackCss: { background: 'linear-gradient(135deg, rgba(24,14,42,0.96), rgba(255,216,111,0.12), rgba(160,107,255,0.16), rgba(24,14,42,0.98))', backgroundSize: '280% 280%' }, membershipTier: 'pookie_pass', unlockSource: 'battlepass', battlePassTier: 'pookie_pass', battlePassLevel: 39, buff: { type: 'library_boost', value: 1.095, label: '+109.5% Library Income' } },

  // ── TikTok Fan Club Set (Gift-only, unlock = join @jorrybeaufart fan club) ──
  // Palette: TikTok pink #FE2C55, cyan #25F4EE, black accents.
  // Exception: the two *text* colours — 'Heartbeat' (word_color) and
  // 'Heartbeat Gold' (name_color) — are both TikTok coin-gold #FFC300 so a
  // fan-club member's name and their guessed word read as one unit. Only the
  // base colour is shared; each keeps its own pink/cyan glow radii, and the
  // rest of the set (borders, aura, title, badge) stays pink.
  { id: 'set_tiktokfc_wc', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'word_color',     name: 'Heartbeat',      rarity: 'rare', cost: 0, sort: 108, css: { color: '#FFC300', backgroundImage: 'linear-gradient(90deg, #FFC300, #ffd859, #ffedb3, #ffd859, #FFC300)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,195,0,0.55), 0 0 22px rgba(255,195,0,0.28)' }, buff: { type: 'tap_boost', value: 0.06, label: '+6% Tap Power' } },
  { id: 'set_tiktokfc_wg', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'word_glow',      name: 'Heart Glow',     rarity: 'rare', cost: 0, sort: 108, css: { textShadow: '0 0 10px rgba(254,44,85,0.75), 0 0 22px rgba(254,44,85,0.4), 0 0 34px rgba(254,44,85,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'word_game_boost', value: 0.08, label: '+8% Word Game Money' } },
  { id: 'set_tiktokfc_pb', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'profile_border',  name: 'Heart Ring',     rarity: 'rare', cost: 0, sort: 108, css: { border: '3px solid #FE2C55', boxShadow: '0 0 10px rgba(254,44,85,0.6), 0 0 24px rgba(254,44,85,0.28)' }, buff: { type: 'biz_boost', value: 0.06, label: '+6% Biz Income' } },
  { id: 'set_tiktokfc_pg', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'profile_glow',    name: 'Fan Aura',       rarity: 'rare', cost: 0, sort: 108, css: { boxShadow: '0 0 14px rgba(254,44,85,0.7), 0 0 30px rgba(254,44,85,0.35), 0 0 46px rgba(254,44,85,0.15)' }, buff: { type: 'offline_boost', value: 0.20, label: '+20% Offline Income' } },
  { id: 'set_tiktokfc_ng', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'name_glow',       name: 'Heart Shine',    rarity: 'rare', cost: 0, sort: 108, css: { textShadow: '0 0 10px rgba(254,44,85,0.75), 0 0 22px rgba(254,44,85,0.4), 0 0 34px rgba(254,44,85,0.18)', animation: 'cfx-breath 2.6s ease-in-out infinite' }, buff: { type: 'combo_boost', value: 0.15, label: '+15% Combo Max' } },
  { id: 'set_tiktokfc_nc', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'name_color',      name: 'Heartbeat Gold', rarity: 'rare', cost: 0, sort: 108, css: { color: '#FFC300', backgroundImage: 'linear-gradient(90deg, #FFC300, #ffd859, #ffedb3, #ffd859, #FFC300)', backgroundSize: '250% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', animation: 'cfx-sweep 2.6s linear infinite', textShadow: '0 0 10px rgba(255,195,0,0.55), 0 0 22px rgba(255,195,0,0.28)' }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'set_tiktokfc_tt', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'title',           name: 'Fan Club',       rarity: 'rare', cost: 0, sort: 108, css: { title: 'Fan Club', titleColor: '#FE2C55', titleGlow: '0 0 8px rgba(254,44,85,0.7), 0 0 20px rgba(37,244,238,0.32)', titleAnimation: 'cfx-breath 2.8s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.05, label: '+5% All Income' } },
  // Heart Hero — drifting TikTok aurora. Each blob is inscribed in its own tile
  // (50% 50% size at 50% 50%) so alpha reaches 0 exactly at the tile edge and
  // tiles butt together seamlessly; cfx-drift then moves each layer by exactly
  // one whole tile (440/440, 280/280, 180/90x2, 120/60x2), so 0% and 100% are
  // identical and the loop cannot seam. The trailing colour is background-color,
  // not a positioned layer. Keep the tile sizes and cfx-drift's offsets in step.
  { id: 'set_tiktokfc_hb', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'hero_badge',      name: 'Heart Hero',     rarity: 'rare', cost: 0, sort: 108, css: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(254,44,85,0.88), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(37,244,238,0.46), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(255,110,170,0.30), transparent 100%), radial-gradient(1.5px 1.5px at 30% 40%, rgba(255,255,255,0.55), transparent), #140410', backgroundSize: '440px 220px, 280px 140px, 180px 90px, 120px 60px', backgroundImage: '/cosmetics/fanclub-heart.png', backgroundImageSize: '80%', animation: 'cfx-drift 26s linear infinite, cfx-breath 7s ease-in-out infinite' }, render: { type: 'image_overlay', asset: '/cosmetics/fanclub-heart.png', inset: '8%', opacity: 0.95, backgroundSize: '80% auto', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }, fallbackCss: { background: 'radial-gradient(50% 50% at 50% 50%, rgba(254,44,85,0.88), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(37,244,238,0.46), transparent 100%), radial-gradient(50% 50% at 50% 50%, rgba(255,110,170,0.30), transparent 100%), radial-gradient(1.5px 1.5px at 30% 40%, rgba(255,255,255,0.55), transparent), #140410', backgroundSize: '440px 220px, 280px 140px, 180px 90px, 120px 60px', animation: 'cfx-drift 26s linear infinite, cfx-breath 7s ease-in-out infinite' }, buff: { type: 'library_boost', value: 0.14, label: '+14% Library Income' } },
  { id: 'set_tiktokfc_we', setId: 'tiktok_fc', giftSet: true, fanClubOnly: true, category: 'win_effect',      name: 'Heart Shower',   rarity: 'rare', cost: 0, sort: 108, css: { effect: 'heart_shower', imageUrl: '/cosmetics/fanclub-heart.png', colors: ['#FE2C55','#FF4D7A','#FFFFFF','#25F4EE'], duration: 4000, particleCount: 50 }, buff: { type: 'lucky_bonus', value: 0.04, label: '+4% Lucky 2x' } },

  // ── Super Fan (9 items) — Super Fan exclusive, auto-granted ──
  { id: 'set_sf_wc', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'word_color', name: 'Sovereign Script', rarity: 'ultra', cost: 0, sort: 109, css: { color: '#ffd700', backgroundImage: 'linear-gradient(110deg, #4c1d95, #7c3aed, #ffd700, #fff7cc, #ffd700, #7c3aed, #4c1d95)', backgroundSize: '240% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 12px rgba(255,215,0,0.65), 0 0 28px rgba(124,58,237,0.35)', animation: 'cfx-sweep 3s linear infinite, cfx-pulse 2.2s ease-in-out infinite', __ambient: { fx: 'sparks', colors: ['#ffd700', '#fff7cc', '#e9d5ff'], density: 0.9 } }, buff: { type: 'tap_boost', value: 0.2, label: '+20% Tap Power' } },
  { id: 'set_sf_wg', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'word_glow', name: 'Crown Radiance', rarity: 'ultra', cost: 0, sort: 109, css: { textShadow: '0 0 10px rgba(255,215,0,0.85), 0 0 24px rgba(168,85,247,0.5), 0 0 40px rgba(255,215,0,0.25), 0 0 56px rgba(124,58,237,0.12)', animation: 'cfx-breath 1.8s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffe680', '#c084fc'], density: 0.8 } }, buff: { type: 'word_game_boost', value: 0.24, label: '+24% Word Game Money' } },
  { id: 'set_sf_nc', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'name_color', name: 'Royal Decree', rarity: 'ultra', cost: 0, sort: 109, css: { color: '#ffd700', backgroundImage: 'linear-gradient(90deg, #ffd700, #fff7cc, #ffffff, #e9d5ff, #ffffff, #fff7cc, #ffd700)', backgroundSize: '260% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(255,215,0,0.6), 0 0 24px rgba(168,85,247,0.3)', animation: 'cfx-sweep 2.8s linear infinite, cfx-pulse 2s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffe680', '#e9d5ff'], density: 1 } }, buff: { type: 'coin_bonus', value: 0.05, label: '+5% All Coins' } },
  { id: 'set_sf_ng', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'name_glow', name: 'Coronation', rarity: 'ultra', cost: 0, sort: 109, css: { textShadow: '0 0 10px rgba(255,215,0,0.8), 0 0 22px rgba(168,85,247,0.45), 0 0 38px rgba(255,215,0,0.2)', animation: 'cfx-breath 2s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffd700', '#e9d5ff'], density: 0.6 } }, buff: { type: 'combo_boost', value: 0.25, label: '+25% Combo Max' } },
  { id: 'set_sf_pb', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'profile_border', name: 'Crown of Suns', rarity: 'ultra', cost: 0, sort: 109, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #ffd700, #fff7cc, #ffffff, #e9d5ff, #a855f7, #ffd700, #fff7cc, #ffd700)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 16px rgba(255,215,0,0.7), 0 0 36px rgba(168,85,247,0.3)', animation: 'cfx-spin 2.6s linear infinite', __ambient: { fx: 'orbit', colors: ['#ffd700', '#e9d5ff'], density: 1 } }, buff: { type: 'biz_boost', value: 0.2, label: '+20% Biz Income' } },
  { id: 'set_sf_pg', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'profile_glow', name: 'Sovereign Halo', rarity: 'ultra', cost: 0, sort: 109, css: { boxShadow: '0 0 16px rgba(255,215,0,0.8), 0 0 34px rgba(168,85,247,0.4), 0 0 54px rgba(255,215,0,0.22), 0 0 72px rgba(124,58,237,0.1)', __ambient: { fx: 'aura', colors: ['#ffe680', '#c084fc'], density: 0.9 } }, buff: { type: 'offline_boost', value: 0.5, label: '+50% Offline Income' } },
  { id: 'set_sf_tt', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'title', name: 'Sovereign', rarity: 'ultra', cost: 0, sort: 109, css: { title: 'Sovereign', titleColor: '#ffd700', titleGlow: '0 0 12px rgba(255,215,0,0.7), 0 0 26px rgba(168,85,247,0.4)', titleBackground: 'linear-gradient(110deg, #7c3aed, #ffd700, #fff7cc, #ffffff, #fff7cc, #ffd700, #7c3aed)', titleAnimation: 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.1, label: '+10% All Income' } },
  { id: 'set_sf_hb', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'hero_badge', name: 'Throne of Rays', rarity: 'ultra', cost: 0, sort: 109, css: { background: 'radial-gradient(1.5px 1.5px at 25% 30%, #fff7cc, transparent), radial-gradient(2px 2px at 70% 20%, #ffd700, transparent), repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 118%, rgba(255,215,0,0.30) 0deg 5deg, rgba(124,58,237,0.10) 5deg 11deg), linear-gradient(0deg, #4c1d95 0%, #2d1045 55%, #14051f 100%)', backgroundSize: '200px 200px, 260px 260px, 100% 100%, 100% 100%', backgroundImage: '/cosmetics/superfan-heart.png', backgroundImageSize: '80%', animation: 'cfx-spin 60s linear infinite, cfx-pulse 9s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffd700', '#e9d5ff'], density: 1.2 } }, render: { type: 'video_bg', asset: '/cosmetics/superfan-hero.mp4', poster: '/cosmetics/superfan-hero-poster.jpg', scrim: 'linear-gradient(90deg, rgba(20,5,31,0.82), rgba(20,5,31,0.38) 45%, rgba(20,5,31,0.18))' }, fallbackCss: { background: 'repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 118%, rgba(255,215,0,0.30) 0deg 5deg, rgba(124,58,237,0.10) 5deg 11deg), linear-gradient(0deg, #4c1d95 0%, #2d1045 55%, #14051f 100%)', animation: 'cfx-spin 60s linear infinite' }, buff: { type: 'library_boost', value: 0.25, label: '+25% Library Income' } },
  { id: 'set_sf_we', setId: 'superfan', giftSet: true, superfanOnly: true, category: 'win_effect', name: 'Crown Burst', rarity: 'ultra', cost: 0, sort: 109, css: { effect: 'crown_burst', imageUrl: '/cosmetics/superfan-heart.png', colors: ['#ffd700', '#fff7cc', '#a855f7', '#ffffff'], duration: 4200, particleCount: 90 }, buff: { type: 'lucky_bonus', value: 0.06, label: '+6% Lucky 2x' } },

  // ── Donor Class (9 items) — membership exclusive, auto-granted on activation ──
  { id: 'set_dc_wc', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'word_color', name: 'Chrome Script', rarity: 'ultra', cost: 0, sort: 110, css: { color: '#e5e7eb', backgroundImage: 'linear-gradient(110deg, #1d4ed8, #2563eb, #e5e7eb, #ffffff, #e5e7eb, #2563eb, #1d4ed8)', backgroundSize: '240% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 12px rgba(96,165,250,0.6), 0 0 28px rgba(37,99,235,0.3)', animation: 'cfx-sweep 3s linear infinite, cfx-pulse 2.4s ease-in-out infinite', __ambient: { fx: 'sparks', colors: ['#60a5fa', '#dbeafe', '#ffffff'], density: 0.8 } }, buff: { type: 'tap_boost', value: 0.15, label: '+15% Tap Power' } },
  { id: 'set_dc_wg', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'word_glow', name: 'Sapphire Radiance', rarity: 'ultra', cost: 0, sort: 110, css: { textShadow: '0 0 10px rgba(96,165,250,0.85), 0 0 24px rgba(37,99,235,0.5), 0 0 40px rgba(219,234,254,0.25)', animation: 'cfx-breath 1.9s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#60a5fa', '#dbeafe'], density: 0.7 } }, buff: { type: 'word_game_boost', value: 0.18, label: '+18% Word Game Money' } },
  { id: 'set_dc_nc', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'name_color', name: 'Platinum Signature', rarity: 'ultra', cost: 0, sort: 110, css: { color: '#e5e7eb', backgroundImage: 'linear-gradient(90deg, #cbd5e1, #ffffff, #dbeafe, #60a5fa, #dbeafe, #ffffff, #cbd5e1)', backgroundSize: '260% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(203,213,225,0.6), 0 0 24px rgba(96,165,250,0.35)', animation: 'cfx-sweep 2.9s linear infinite, cfx-pulse 2.1s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#dbeafe', '#ffffff'], density: 0.9 } }, buff: { type: 'coin_bonus', value: 0.04, label: '+4% All Coins' } },
  { id: 'set_dc_ng', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'name_glow', name: 'Silver Halo', rarity: 'ultra', cost: 0, sort: 110, css: { textShadow: '0 0 10px rgba(229,231,235,0.8), 0 0 22px rgba(96,165,250,0.45), 0 0 38px rgba(37,99,235,0.2)', animation: 'cfx-breath 2.1s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#e5e7eb', '#60a5fa'], density: 0.5 } }, buff: { type: 'combo_boost', value: 0.2, label: '+20% Combo Max' } },
  { id: 'set_dc_pb', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'profile_border', name: 'Sapphire Circlet', rarity: 'ultra', cost: 0, sort: 110, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #2563eb, #60a5fa, #ffffff, #e5e7eb, #60a5fa, #1d4ed8, #2563eb)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 16px rgba(37,99,235,0.65), 0 0 34px rgba(96,165,250,0.3)', animation: 'cfx-spin 2.8s linear infinite', __ambient: { fx: 'orbit', colors: ['#60a5fa', '#ffffff'], density: 0.9 } }, buff: { type: 'biz_boost', value: 0.15, label: '+15% Biz Income' } },
  { id: 'set_dc_pg', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'profile_glow', name: 'Chrome Aura', rarity: 'ultra', cost: 0, sort: 110, css: { boxShadow: '0 0 16px rgba(229,231,235,0.75), 0 0 34px rgba(37,99,235,0.4), 0 0 54px rgba(96,165,250,0.2)', __ambient: { fx: 'aura', colors: ['#dbeafe', '#e5e7eb'], density: 0.8 } }, buff: { type: 'offline_boost', value: 0.4, label: '+40% Offline Income' } },
  { id: 'set_dc_tt', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'title', name: 'Benefactor', rarity: 'ultra', cost: 0, sort: 110, css: { title: 'Benefactor', titleColor: '#60a5fa', titleGlow: '0 0 12px rgba(96,165,250,0.7), 0 0 26px rgba(37,99,235,0.4)', titleBackground: 'linear-gradient(110deg, #1d4ed8, #60a5fa, #ffffff, #e5e7eb, #ffffff, #60a5fa, #1d4ed8)', titleAnimation: 'cfx-sweep 2.5s linear infinite, cfx-pulse 2.1s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.08, label: '+8% All Income' } },
  { id: 'set_dc_hb', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'hero_badge', name: 'Chrome Throne', rarity: 'ultra', cost: 0, sort: 110, css: { background: 'radial-gradient(1.5px 1.5px at 25% 30%, #dbeafe, transparent), radial-gradient(2px 2px at 70% 20%, #ffffff, transparent), repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 118%, rgba(96,165,250,0.28) 0deg 5deg, rgba(229,231,235,0.08) 5deg 11deg), linear-gradient(0deg, #1d4ed8 0%, #12245c 55%, #060d24 100%)', backgroundSize: '200px 200px, 260px 260px, 100% 100%, 100% 100%', backgroundImage: '/cosmetics/donorclass-heart.png', backgroundImageSize: '80%', animation: 'cfx-spin 60s linear infinite, cfx-pulse 9.5s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#60a5fa', '#dbeafe'], density: 1 } }, render: { type: 'video_bg', asset: '/cosmetics/donorclass-hero.mp4', poster: '/cosmetics/donorclass-hero-poster.jpg', scrim: 'linear-gradient(90deg, rgba(4,10,31,0.82), rgba(4,10,31,0.38) 45%, rgba(4,10,31,0.18))' }, fallbackCss: { background: 'repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 118%, rgba(96,165,250,0.28) 0deg 5deg, rgba(229,231,235,0.08) 5deg 11deg), linear-gradient(0deg, #1d4ed8 0%, #12245c 55%, #060d24 100%)', animation: 'cfx-spin 60s linear infinite' }, buff: { type: 'library_boost', value: 0.2, label: '+20% Library Income' } },
  { id: 'set_dc_we', setId: 'donor_class', giftSet: true, donorClassOnly: true, category: 'win_effect', name: 'Sapphire Burst', rarity: 'ultra', cost: 0, sort: 110, css: { effect: 'crown_burst', imageUrl: '/cosmetics/donorclass-heart.png', colors: ['#60a5fa', '#dbeafe', '#2563eb', '#ffffff'], duration: 4200, particleCount: 85 }, buff: { type: 'lucky_bonus', value: 0.05, label: '+5% Lucky 2x' } },

  // ── Super Donor (9 items) — held ONLY by players carrying BOTH the Super Fan
  // and Donor Class entitlements (or Pookie Pass, which is both). Palette is
  // deliberately the two parents fused: Super Fan's molten gold and royal
  // violet, wearing Donor Class's crown recast in emerald. Every buff sits
  // above BOTH parents so the set is worth the second subscription.
  { id: 'set_sd_wc', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'word_color', name: 'Emerald Edict', rarity: 'ultra', cost: 0, sort: 111, css: { color: '#ffd700', backgroundImage: 'linear-gradient(110deg, #14532d, #2fbf3f, #b6f79a, #fff7cc, #ffd700, #a855f7, #4c1d95)', backgroundSize: '260% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 12px rgba(255,215,0,0.7), 0 0 26px rgba(110,227,74,0.4), 0 0 44px rgba(124,58,237,0.3)', animation: 'cfx-sweep 2.8s linear infinite, cfx-pulse 2s ease-in-out infinite', __ambient: { fx: 'sparks', colors: ['#ffd700', '#b6f79a', '#fff7cc'], density: 1.1 } }, buff: { type: 'tap_boost', value: 0.28, label: '+28% Tap Power' } },
  { id: 'set_sd_wg', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'word_glow', name: 'Verdant Radiance', rarity: 'ultra', cost: 0, sort: 111, css: { textShadow: '0 0 10px rgba(255,215,0,0.9), 0 0 22px rgba(110,227,74,0.6), 0 0 38px rgba(168,85,247,0.4), 0 0 58px rgba(255,215,0,0.2)', animation: 'cfx-breath 1.7s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffe680', '#8ee86a', '#c084fc'], density: 1 } }, buff: { type: 'word_game_boost', value: 0.32, label: '+32% Word Game Money' } },
  { id: 'set_sd_nc', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'name_color', name: 'Gilded Patron', rarity: 'ultra', cost: 0, sort: 111, css: { color: '#ffd700', backgroundImage: 'linear-gradient(90deg, #ffd700, #fff7cc, #ffffff, #b6f79a, #6ee34a, #b6f79a, #ffffff, #fff7cc, #ffd700)', backgroundSize: '280% auto', webkitBackgroundClip: 'text', backgroundClip: 'text', webkitTextFillColor: 'transparent', textShadow: '0 0 10px rgba(255,215,0,0.7), 0 0 24px rgba(110,227,74,0.35)', animation: 'cfx-sweep 2.6s linear infinite, cfx-pulse 1.9s ease-in-out infinite', __ambient: { fx: 'aura', colors: ['#ffe680', '#b6f79a', '#e9d5ff'], density: 1.2 } }, buff: { type: 'coin_bonus', value: 0.07, label: '+7% All Coins' } },
  { id: 'set_sd_ng', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'name_glow', name: 'Laurel Halo', rarity: 'ultra', cost: 0, sort: 111, css: { textShadow: '0 0 10px rgba(255,215,0,0.85), 0 0 20px rgba(110,227,74,0.55), 0 0 36px rgba(168,85,247,0.35), 0 0 54px rgba(255,215,0,0.18)', animation: 'cfx-breath 1.9s ease-in-out infinite', __ambient: { fx: 'motes', colors: ['#ffd700', '#b6f79a', '#e9d5ff'], density: 0.8 } }, buff: { type: 'combo_boost', value: 0.34, label: '+34% Combo Max' } },
  { id: 'set_sd_pb', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'profile_border', name: 'Laurel Crown', rarity: 'ultra', cost: 0, sort: 111, css: { border: '4px solid transparent', backgroundImage: 'conic-gradient(from var(--cfx-a, 0deg), #ffd700, #fff7cc, #b6f79a, #6ee34a, #2fbf3f, #b6f79a, #ffffff, #a855f7, #7c3aed, #ffd700)', backgroundOrigin: 'border-box', backgroundClip: 'border-box', boxShadow: '0 0 18px rgba(255,215,0,0.75), 0 0 32px rgba(110,227,74,0.45), 0 0 52px rgba(168,85,247,0.28)', animation: 'cfx-spin 2.4s linear infinite', __ambient: { fx: 'orbit', colors: ['#ffd700', '#6ee34a', '#e9d5ff'], density: 1.2 } }, buff: { type: 'biz_boost', value: 0.28, label: '+28% Biz Income' } },
  { id: 'set_sd_pg', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'profile_glow', name: 'Aurum Aura', rarity: 'ultra', cost: 0, sort: 111, css: { boxShadow: '0 0 18px rgba(255,215,0,0.85), 0 0 32px rgba(110,227,74,0.5), 0 0 52px rgba(168,85,247,0.35), 0 0 76px rgba(255,215,0,0.16)', __ambient: { fx: 'aura', colors: ['#ffe680', '#8ee86a', '#c084fc'], density: 1.1 } }, buff: { type: 'offline_boost', value: 0.7, label: '+70% Offline Income' } },
  { id: 'set_sd_tt', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'title', name: 'Super Donor', rarity: 'ultra', cost: 0, sort: 111, css: { title: 'Super Donor', titleColor: '#ffd700', titleGlow: '0 0 12px rgba(255,215,0,0.75), 0 0 24px rgba(110,227,74,0.45), 0 0 40px rgba(168,85,247,0.3)', titleBackground: 'linear-gradient(110deg, #4c1d95, #a855f7, #ffd700, #fff7cc, #b6f79a, #6ee34a, #b6f79a, #fff7cc, #ffd700, #a855f7, #4c1d95)', titleAnimation: 'cfx-sweep 2.2s linear infinite, cfx-pulse 1.9s ease-in-out infinite' }, buff: { type: 'prestige', value: 0.14, label: '+14% All Income' } },
  // The flagship. Nine painted layers under a looping video plate: a sparkle
  // field, a vignette, a gold band sweeping across, ONE gold ray-fan rising
  // from below the frame, emerald crown-light pooling at its base, over a
  // violet→green floor. Both variants were tuned in the browser, not by eye
  // in source — three things that looked reasonable written down did not
  // survive rendering:
  //   · cfx-aurora is WRONG here. Its hue-rotate(40deg) drags gold to lime
  //     and violet to magenta, and the badge came out a garish plaid.
  //     cfx-flow gives the same lateral wash with no filter, so the palette
  //     survives. It also leaves `filter` free for a future layer.
  //   · Two counter-rotating fans read as a plaid where they cross. One fan
  //     plus a base glow reads as light.
  //   · repeating-conic-gradient with hard stops gives hard-edged wedges;
  //     each beam needs its own 0→peak→0 falloff to read as a beam.
  // cfx-spin drives ONLY the registered --cfx-a angle, cfx-flow only
  // background-position, so the two never fight over a property.
  { id: 'set_sd_hb', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'hero_badge', name: 'Throne of Laurels', rarity: 'ultra', cost: 0, sort: 111, css: { background: 'radial-gradient(1.6px 1.6px at 18% 26%, rgba(255,247,204,0.95), transparent), radial-gradient(2px 2px at 62% 16%, rgba(182,247,154,0.9), transparent), radial-gradient(1.6px 1.6px at 82% 42%, rgba(255,215,0,0.95), transparent), radial-gradient(2.4px 2.4px at 34% 68%, rgba(234,255,214,0.85), transparent), radial-gradient(120% 130% at 50% 50%, transparent 42%, rgba(7,10,22,0.55) 100%), linear-gradient(100deg, rgba(255,215,0,0) 24%, rgba(255,215,0,0.14) 44%, rgba(255,247,204,0.22) 52%, rgba(201,146,255,0.14) 62%, rgba(255,215,0,0) 78%), repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 125%, rgba(255,215,0,0) 0deg, rgba(255,215,0,0.13) 3.5deg, rgba(255,247,204,0.16) 5deg, rgba(255,215,0,0.13) 6.5deg, rgba(255,215,0,0) 10deg, rgba(255,215,0,0) 18deg), radial-gradient(140% 95% at 50% 116%, rgba(110,227,74,0.42), rgba(110,227,74,0.10) 45%, transparent 66%), linear-gradient(0deg, #3b1a6e 0%, #26124a 40%, #12251a 78%, #050f0a 100%)', backgroundSize: '200px 200px, 260px 260px, 240px 240px, 300px 300px, 100% 100%, 300% 100%, 100% 100%, 100% 100%, 100% 100%', backgroundImage: '/cosmetics/superdonor-heart.png', backgroundImageSize: '82%', animation: 'cfx-spin 50s linear infinite, cfx-flow 16s linear infinite', __ambient: { fx: 'sparks', colors: ['#ffd700', '#b6f79a', '#fff7cc', '#e9d5ff'], density: 1.5 } }, render: { type: 'video_bg', asset: '/cosmetics/superdonor-hero.mp4', poster: '/cosmetics/superdonor-hero-poster.jpg', scrim: 'linear-gradient(90deg, rgba(9,20,10,0.84), rgba(20,5,31,0.40) 45%, rgba(20,5,31,0.16))' }, fallbackCss: { background: 'radial-gradient(120% 130% at 50% 50%, transparent 42%, rgba(7,10,22,0.55) 100%), linear-gradient(100deg, rgba(255,215,0,0) 24%, rgba(255,215,0,0.14) 44%, rgba(255,247,204,0.22) 52%, rgba(201,146,255,0.14) 62%, rgba(255,215,0,0) 78%), repeating-conic-gradient(from var(--cfx-a, 0deg) at 50% 125%, rgba(255,215,0,0) 0deg, rgba(255,215,0,0.13) 3.5deg, rgba(255,247,204,0.16) 5deg, rgba(255,215,0,0.13) 6.5deg, rgba(255,215,0,0) 10deg, rgba(255,215,0,0) 18deg), radial-gradient(140% 95% at 50% 116%, rgba(110,227,74,0.42), rgba(110,227,74,0.10) 45%, transparent 66%), linear-gradient(0deg, #3b1a6e 0%, #26124a 40%, #12251a 78%, #050f0a 100%)', backgroundSize: '100% 100%, 300% 100%, 100% 100%, 100% 100%, 100% 100%', animation: 'cfx-spin 50s linear infinite, cfx-flow 16s linear infinite' }, buff: { type: 'library_boost', value: 0.35, label: '+35% Library Income' } },
  { id: 'set_sd_we', setId: 'super_donor', giftSet: true, superDonorOnly: true, category: 'win_effect', name: 'Laurel Burst', rarity: 'ultra', cost: 0, sort: 111, css: { effect: 'crown_burst', imageUrl: '/cosmetics/superdonor-heart.png', colors: ['#ffd700', '#fff7cc', '#6ee34a', '#b6f79a', '#a855f7'], duration: 4600, particleCount: 110 }, buff: { type: 'lucky_bonus', value: 0.085, label: '+8.5% Lucky 2x' } },
];

// Index by ID for fast lookup
const catalogById = {};
for (const item of COSMETICS_CATALOG) {
  catalogById[item.id] = item;
}

// Index by lowercase name for name-based lookup
const catalogByName = {};
for (const item of COSMETICS_CATALOG) {
  const key = item.name.toLowerCase();
  if (!catalogByName[key]) catalogByName[key] = [];
  catalogByName[key].push(item);
}

// ── Cosmetic Set Definitions ─────────────────────────────────────────
const COSMETIC_SETS = {
  pixel: {
    name: 'Pixel',
    rarity: 'common',
    theme: 'Retro 8-bit gaming',
    totalCost: 100000,
    currency: 'coins',
    setBonus: 0.05,
    setBonusLabel: '+5% All Buffs',
    itemIds: ['set_pixel_wc','set_pixel_wg','set_pixel_pb','set_pixel_pg','set_pixel_ng','set_pixel_nc','set_pixel_tt','set_pixel_we']
  },
  steampunk: {
    name: 'Steampunk',
    rarity: 'uncommon',
    theme: 'Victorian tech, brass/copper',
    totalCost: 500000,
    currency: 'coins',
    setBonus: 0.08,
    setBonusLabel: '+8% All Buffs',
    itemIds: ['set_steam_wc','set_steam_wg','set_steam_pb','set_steam_pg','set_steam_ng','set_steam_nc','set_steam_tt','set_steam_we']
  },
  sakura: {
    name: 'Sakura',
    rarity: 'rare',
    theme: 'Cherry blossom, pink/white',
    totalCost: 400000000,
    currency: 'coins',
    setBonus: 0.12,
    setBonusLabel: '+12% All Buffs',
    itemIds: ['set_sakura_wc','set_sakura_wg','set_sakura_pb','set_sakura_pg','set_sakura_ng','set_sakura_nc','set_sakura_tt','set_sakura_we']
  },
  storm: {
    name: 'Storm',
    rarity: 'epic',
    theme: 'Lightning/thunder, electric',
    totalCost: 4000000000,
    currency: 'coins',
    setBonus: 0.16,
    setBonusLabel: '+16% All Buffs',
    itemIds: ['set_storm_wc','set_storm_wg','set_storm_pb','set_storm_pg','set_storm_ng','set_storm_nc','set_storm_tt','set_storm_we']
  },
  dragon: {
    name: 'Dragon',
    rarity: 'legendary',
    theme: 'Draconic, fire/gold scales',
    totalCost: 20000000000,
    currency: 'coins',
    setBonus: 0.20,
    setBonusLabel: '+20% All Buffs',
    itemIds: ['set_dragon_wc','set_dragon_wg','set_dragon_pb','set_dragon_pg','set_dragon_ng','set_dragon_nc','set_dragon_tt','set_dragon_we']
  },
  quantum: {
    name: 'Quantum',
    rarity: 'ultra',
    theme: 'Sci-fi quantum/probability',
    totalCost: 80000000000,
    currency: 'coins',
    setBonus: 0.25,
    setBonusLabel: '+25% All Buffs',
    itemIds: ['set_quantum_wc','set_quantum_wg','set_quantum_pb','set_quantum_pg','set_quantum_ng','set_quantum_nc','set_quantum_tt','set_quantum_we']
  },
  america: {
    name: 'Stars & Stripes',
    rarity: 'rare',
    theme: 'Red/white/blue patriotic USA',
    totalCost: 3000,
    currency: 'gift_coins',
    setBonus: 0.10,
    setBonusLabel: '+10% All Buffs',
    giftSet: true,
    itemIds: ['set_usa_wc','set_usa_wg','set_usa_pb','set_usa_pg','set_usa_ng','set_usa_nc','set_usa_tt','set_usa_we']
  },
  canada: {
    name: 'Great North',
    rarity: 'rare',
    theme: 'Red/white maple leaf Canada',
    totalCost: 3000,
    currency: 'gift_coins',
    setBonus: 0.10,
    setBonusLabel: '+10% All Buffs',
    giftSet: true,
    itemIds: ['set_can_wc','set_can_wg','set_can_pb','set_can_pg','set_can_ng','set_can_nc','set_can_tt','set_can_we']
  },
  tiktok_fc: {
    name: 'TikTok Fan Club',
    rarity: 'rare',
    theme: 'Pink hearts, TikTok-pink + cyan',
    totalCost: 0,
    currency: 'fan_club',
    setBonus: 0.12,
    setBonusLabel: '+12% All Buffs',
    giftSet: true,
    fanClubOnly: true,
    unlock: 'fan_club_jorrybeaufart',
    unlockLabel: 'Join @jorrybeaufart\'s TikTok Fan Club',
    unlockUrl: 'https://www.tiktok.com/@jorrybeaufart',
    itemIds: ['set_tiktokfc_wc','set_tiktokfc_wg','set_tiktokfc_pb','set_tiktokfc_pg','set_tiktokfc_ng','set_tiktokfc_nc','set_tiktokfc_tt','set_tiktokfc_hb','set_tiktokfc_we']
  },
  superfan: {
    name: 'Super Fan',
    rarity: 'ultra',
    theme: 'Molten gold + royal violet — Super Fan exclusive',
    totalCost: 0,
    currency: 'superfan',
    setBonus: 0.2,
    setBonusLabel: '+20% All Buffs',
    giftSet: true,
    superfanOnly: true,
    unlock: 'superfan_jorrybeaufart',
    unlockLabel: 'Become a Super Fan of @jorrybeaufart ($9.99/mo) — or take the Pookie Pass ($10/mo) if you are not on TikTok',
    unlockUrl: 'https://www.tiktok.com/@jorrybeaufart',
    itemIds: ['set_sf_wc', 'set_sf_wg', 'set_sf_nc', 'set_sf_ng', 'set_sf_pb', 'set_sf_pg', 'set_sf_tt', 'set_sf_hb', 'set_sf_we']
  },
  donor_class: {
    name: 'Donor Class',
    rarity: 'ultra',
    theme: 'Chrome + sapphire — Donor Class exclusive',
    totalCost: 0,
    currency: 'donor_class',
    setBonus: 0.15,
    setBonusLabel: '+15% All Buffs',
    giftSet: true,
    donorClassOnly: true,
    unlock: 'donor_class_membership',
    unlockLabel: 'Become a Donor Class member',
    unlockUrl: 'https://wordtycoon.live/portal/',
    itemIds: ['set_dc_wc', 'set_dc_wg', 'set_dc_nc', 'set_dc_ng', 'set_dc_pb', 'set_dc_pg', 'set_dc_tt', 'set_dc_hb', 'set_dc_we']
  },
  // Top of the ladder: only players holding BOTH Super Fan and Donor Class.
  // Pookie Pass counts on its own — it IS both entitlements in one
  // subscription, and already grants both parent sets.
  super_donor: {
    name: 'Super Donor',
    rarity: 'ultra',
    theme: 'Molten gold + emerald crown + royal violet — Super Fan AND Donor Class',
    totalCost: 0,
    currency: 'super_donor',
    setBonus: 0.35,
    setBonusLabel: '+35% All Buffs',
    giftSet: true,
    superDonorOnly: true,
    unlock: 'superfan_and_donor_class',
    unlockLabel: 'Hold BOTH Super Fan and Donor Class — or the Pookie Pass ($10/mo), which is both',
    unlockUrl: 'https://wordtycoon.live/portal/',
    itemIds: ['set_sd_wc', 'set_sd_wg', 'set_sd_nc', 'set_sd_ng', 'set_sd_pb', 'set_sd_pg', 'set_sd_tt', 'set_sd_hb', 'set_sd_we']
  }
};

// Reverse index: cosmetic ID → set key
const cosmeticToSet = {};
for (const [setKey, setDef] of Object.entries(COSMETIC_SETS)) {
  for (const itemId of setDef.itemIds) {
    cosmeticToSet[itemId] = setKey;
  }
}

// ── Set Detection Functions ──────────────────────────────────────────

/**
 * Get which set a cosmetic belongs to (if any).
 * @returns {string|null} set key or null
 */
function getSetForCosmetic(cosmeticId) {
  return cosmeticToSet[cosmeticId] || null;
}

/**
 * Get status of all sets for a player: owned count, equipped count, completion.
 * @returns {Object} setKey → { ...setDef, key, owned, equipped, total, complete, active }
 */
function getPlayerSetStatus(db, playerId) {
  const owned = db.queryAll(
    `SELECT cosmetic_id, equipped FROM player_cosmetics WHERE player_id = ?`,
    [playerId]
  );
  const ownedMap = {};
  const equippedMap = {};
  for (const row of owned) {
    ownedMap[row.cosmetic_id] = true;
    if (row.equipped) equippedMap[row.cosmetic_id] = true;
  }

  const result = {};
  for (const [setKey, setDef] of Object.entries(COSMETIC_SETS)) {
    let ownedCount = 0;
    let equippedCount = 0;
    for (const itemId of setDef.itemIds) {
      if (ownedMap[itemId]) ownedCount++;
      if (equippedMap[itemId]) equippedCount++;
    }
    result[setKey] = {
      ...setDef,
      key: setKey,
      owned: ownedCount,
      equipped: equippedCount,
      total: setDef.itemIds.length,
      complete: ownedCount === setDef.itemIds.length,
      active: equippedCount === setDef.itemIds.length
    };
  }
  return result;
}

/**
 * Get active (fully equipped) set bonuses for a player.
 * @returns {Array<{setKey, name, bonus, label}>}
 */
function getActiveSetBonuses(db, playerId) {
  const equipped = db.queryAll(
    `SELECT cosmetic_id FROM player_cosmetics WHERE player_id = ? AND equipped = 1`,
    [playerId]
  );
  const equippedIds = new Set(equipped.map(r => r.cosmetic_id));

  const bonuses = [];
  for (const [setKey, setDef] of Object.entries(COSMETIC_SETS)) {
    const allEquipped = setDef.itemIds.every(id => equippedIds.has(id));
    if (allEquipped) {
      bonuses.push({ setKey, name: setDef.name, bonus: setDef.setBonus, label: setDef.setBonusLabel });
    }
  }
  return bonuses;
}

/**
 * Detect complete sets from a Set of equipped cosmetic IDs (batch helper).
 * @param {Set<string>} equippedIds
 * @returns {number} total set bonus multiplier (e.g. 0.05 for Pixel)
 */
function _calcSetBonusFromIds(equippedIds) {
  let totalBonus = 0;
  for (const setDef of Object.values(COSMETIC_SETS)) {
    if (setDef.itemIds.every(id => equippedIds.has(id))) {
      totalBonus += setDef.setBonus;
    }
  }
  return totalBonus;
}

function seedCosmetics(db) {
  for (const item of COSMETICS_CATALOG) {
    db.run(
      `INSERT OR IGNORE INTO cosmetics (id, category, name, description, rarity, cost, css_property, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.category, item.name, item.name, item.rarity, item.cost, JSON.stringify(item.css), item.sort]
    );
    // Update existing entries in case catalog changed
    db.run(
      `UPDATE cosmetics SET name = ?, rarity = ?, cost = ?, css_property = ?, sort_order = ?, category = ? WHERE id = ?`,
      [item.name, item.rarity, item.cost, JSON.stringify(item.css), item.sort, item.category, item.id]
    );
  }
  db.save();
}

function getCosmeticById(id) {
  return catalogById[id] || null;
}

/**
 * Resolve a cosmetic by ID or name. Accepts:
 *  - Exact ID: "wc_crimson" → direct match
 *  - Exact name (case-insensitive): "crimson" → matches if unique
 *  - Name with spaces: "ocean blue" → matches "Ocean Blue"
 * Returns { item, error } — item is the cosmetic or null, error is a message if ambiguous/not found
 */
function resolveCosmetic(input) {
  if (!input) return { item: null, error: 'No cosmetic specified.' };
  const query = input.toLowerCase().trim();

  // 0. Generated cosmetic (gen_ prefix) — build virtual item from seed
  if (query.startsWith('gen_')) {
    const info = getGeneratedCosmeticInfo(query);
    if (info) {
      return { item: { id: info.id, category: info.category, name: info.name, rarity: info.rarity, cost: 0, css: info.css, sort: 999, buff: info.buff }, error: null };
    }
    return { item: null, error: `Generated cosmetic "${input}" not found.` };
  }

  // 1. Try exact ID match first
  if (catalogById[query]) {
    return { item: catalogById[query], error: null };
  }

  // 2. Try exact name match (case-insensitive)
  const nameMatches = catalogByName[query];
  if (nameMatches && nameMatches.length === 1) {
    return { item: nameMatches[0], error: null };
  }
  if (nameMatches && nameMatches.length > 1) {
    // Multiple items share this name — list them with IDs
    const options = nameMatches.map(m => `${m.name} [${CATEGORY_NAMES[m.category]}] → ${m.id}`).join(' | ');
    return { item: null, error: `Multiple items named "${nameMatches[0].name}": ${options}` };
  }

  // 3. Try [rarity] [category] format (e.g. "uncommon word glow", "ultra win effect")
  const words = query.split(/\s+/);
  if (words.length >= 2) {
    const firstWord = words[0];
    const rarity = RARITY_ALIASES[firstWord];
    if (rarity) {
      const catPart = words.slice(1).join(' ');
      const category = CATEGORY_ALIASES[catPart];
      if (category) {
        const matches = COSMETICS_CATALOG.filter(c => c.category === category && c.rarity === rarity);
        if (matches.length === 1) {
          return { item: matches[0], error: null };
        }
        if (matches.length > 1) {
          const options = matches.map(m => `${m.name} (${m.id})`).join(' | ');
          return { item: null, error: `${rarity} ${CATEGORY_NAMES[category]}: ${options} — specify by name` };
        }
        if (matches.length === 0) {
          return { item: null, error: `No ${rarity} items in ${CATEGORY_NAMES[category]}. Try !shop ${catPart}` };
        }
      }
    }
  }

  // 4. Try partial name match (starts with)
  const partialMatches = COSMETICS_CATALOG.filter(c => c.name.toLowerCase().startsWith(query));
  if (partialMatches.length === 1) {
    return { item: partialMatches[0], error: null };
  }
  if (partialMatches.length > 1) {
    const options = partialMatches.slice(0, 5).map(m => `${m.name} (${m.id})`).join(' | ');
    const suffix = partialMatches.length > 5 ? ` and ${partialMatches.length - 5} more` : '';
    return { item: null, error: `Multiple matches: ${options}${suffix}. Use the code instead.` };
  }

  return { item: null, error: `Unknown cosmetic "${input}". Use !shop [category] to browse, or try !buyc [rarity] [category]` };
}

function resolveCategory(input) {
  if (!input) return null;
  return CATEGORY_ALIASES[input.toLowerCase().trim()] || null;
}

function getCategoryItems(category) {
  return COSMETICS_CATALOG.filter(c => c.category === category).sort((a, b) => a.sort - b.sort);
}

function getAllCategories() {
  const cats = {};
  for (const item of COSMETICS_CATALOG) {
    if (!cats[item.category]) cats[item.category] = 0;
    cats[item.category]++;
  }
  return cats;
}

function resolveRarity(input) {
  if (!input) return null;
  return RARITY_ALIASES[input.toLowerCase().trim()] || null;
}

function getItemsByRarity(rarity, category) {
  let items = COSMETICS_CATALOG;
  if (category) items = items.filter(c => c.category === category);
  return items.filter(c => c.rarity === rarity).sort((a, b) => a.sort - b.sort);
}

function getRarityCounts(category) {
  const items = category
    ? COSMETICS_CATALOG.filter(c => c.category === category)
    : COSMETICS_CATALOG;
  const counts = {};
  for (const r of RARITY_ORDER) counts[r] = 0;
  for (const item of items) counts[item.rarity]++;
  return counts;
}

function isBattlePassOnly(item) {
  if (!item || typeof item !== 'object') return false;
  return Boolean(
    item.battlePassOnly ||
    item.battle_pass_only ||
    item.passOnly ||
    item.pass_only ||
    item.source === 'battle_pass' ||
    item.source === 'pass'
  );
}

function getPlayerEquipped(db, playerId) {
  const rows = db.queryAll(
    `SELECT c.id, c.category, c.css_property FROM player_cosmetics pc
     JOIN cosmetics c ON c.id = pc.cosmetic_id
     WHERE pc.player_id = ? AND pc.equipped = 1`,
    [playerId]
  );
  const result = {};
  for (const row of rows) {
    const css = JSON.parse(row.css_property);
    // Add audioReactive flag from catalog if present
    const catalogItem = catalogById[row.id];
    if (catalogItem && catalogItem.audioReactive) {
      css.audioReactive = true;
      css.auxProfileId = row.id;
    }
    // Tag items so Chat Relay can apply per-stream visibility filters.
    // Keys are `__`-prefixed so DOM style assignment silently drops them.
    if (catalogItem) {
      css.__cosmeticId = row.id;
      if (catalogItem.setId) css.__setId = catalogItem.setId;
      if (catalogItem.fanClubOnly) css.__fanClubOnly = true;
      if (catalogItem.render) css.__render = catalogItem.render;
    }
    result[row.category] = css;
  }

  // Overlay active test cosmetic (if any)
  const test = activeTests.get(playerId);
  if (test) {
    const testCss = { ...test.css };
    const testItem = catalogById[test.cosmeticId];
    if (testItem && testItem.audioReactive) {
      testCss.audioReactive = true;
      testCss.auxProfileId = test.cosmeticId;
    }
    result[test.category] = testCss;
  }

  return result;
}

/**
 * Get aggregated buff stats from all equipped cosmetics for a player.
 * Returns object with all buff type values (0 if no buff of that type).
 */
function getPlayerBuffs(db, playerId) {
  const rows = db.queryAll(
    `SELECT pc.cosmetic_id FROM player_cosmetics pc
     WHERE pc.player_id = ? AND pc.equipped = 1`,
    [playerId]
  );
  const buffs = { ...DEFAULT_BUFFS };
  const equippedIds = new Set();
  for (const row of rows) {
    equippedIds.add(row.cosmetic_id);
    // Check for generated cosmetics (gen_ prefix)
    if (row.cosmetic_id.startsWith('gen_')) {
      const genBuff = getGeneratedCosmeticBuff(row.cosmetic_id);
      if (genBuff) {
        buffs[genBuff.type] = (buffs[genBuff.type] || 0) + genBuff.value;
      }
      continue;
    }
    const item = catalogById[row.cosmetic_id];
    if (!item) continue;
    // AUX items have multiple buffs
    if (item.buffs) {
      for (const b of item.buffs) {
        buffs[b.type] = (buffs[b.type] || 0) + b.value;
      }
    } else if (item.buff) {
      buffs[item.buff.type] += item.buff.value;
    }
  }
  // Apply set bonus multiplier (stacks on top of individual buffs)
  const setBonus = _calcSetBonusFromIds(equippedIds);
  if (setBonus > 0) {
    for (const key of Object.keys(buffs)) {
      if (buffs[key] > 0) {
        buffs[key] *= (1 + setBonus);
      }
    }
  }
  return buffs;
}

/**
 * Get buffs for all players who have at least one equipped cosmetic.
 * Returns Map<playerId, buffsObject> — efficient for batch processing.
 */
function getBuffsForAllEquippedPlayers(db) {
  const rows = db.queryAll(
    `SELECT pc.player_id, pc.cosmetic_id FROM player_cosmetics pc
     WHERE pc.equipped = 1`
  );
  const playerBuffs = new Map();
  const playerEquippedIds = new Map(); // track equipped IDs per player for set detection
  for (const row of rows) {
    // Track equipped IDs for set detection
    if (!playerEquippedIds.has(row.player_id)) {
      playerEquippedIds.set(row.player_id, new Set());
    }
    playerEquippedIds.get(row.player_id).add(row.cosmetic_id);

    // Check for generated cosmetics (gen_ prefix)
    if (row.cosmetic_id.startsWith('gen_')) {
      const genBuff = getGeneratedCosmeticBuff(row.cosmetic_id);
      if (genBuff) {
        if (!playerBuffs.has(row.player_id)) {
          playerBuffs.set(row.player_id, { ...DEFAULT_BUFFS });
        }
        const buffs = playerBuffs.get(row.player_id);
        buffs[genBuff.type] = (buffs[genBuff.type] || 0) + genBuff.value;
      }
      continue;
    }
    const item = catalogById[row.cosmetic_id];
    if (!item) continue;
    if (!item.buff && !item.buffs) continue;
    if (!playerBuffs.has(row.player_id)) {
      playerBuffs.set(row.player_id, { ...DEFAULT_BUFFS });
    }
    const buffs = playerBuffs.get(row.player_id);
    // AUX items have multiple buffs
    if (item.buffs) {
      for (const b of item.buffs) {
        buffs[b.type] = (buffs[b.type] || 0) + b.value;
      }
    } else if (item.buff) {
      buffs[item.buff.type] += item.buff.value;
    }
  }
  // Apply set bonus multipliers for each player
  for (const [playerId, equippedIds] of playerEquippedIds) {
    const setBonus = _calcSetBonusFromIds(equippedIds);
    if (setBonus > 0 && playerBuffs.has(playerId)) {
      const buffs = playerBuffs.get(playerId);
      for (const key of Object.keys(buffs)) {
        if (buffs[key] > 0) {
          buffs[key] *= (1 + setBonus);
        }
      }
    }
  }
  return playerBuffs;
}

/**
 * Format a buff label from a buff object.
 */
function formatBuffLabel(buff) {
  if (!buff) return '';
  const pct = buff.value * 100;
  const pctStr = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
  return `+${pctStr}% ${BUFF_TYPE_NAMES[buff.type] || buff.type}`;
}

/**
 * Temporarily preview a cosmetic without purchasing.
 * @param {number} playerId
 * @param {string} cosmeticInput - cosmetic name or ID
 * @param {function} onExpire - called when preview expires (used to broadcast update)
 * @returns {{ ok: boolean, message: string, item?: object }}
 */
function setTestCosmetic(playerId, cosmeticInput, onExpire) {
  const { item, error } = resolveCosmetic(cosmeticInput);
  if (!item) return { ok: false, message: error || 'Cosmetic not found.' };

  // Clear any existing test for this player
  clearTestCosmetic(playerId);

  const timer = setTimeout(() => {
    activeTests.delete(playerId);
    if (onExpire) onExpire();
  }, TEST_DURATION_MS);

  activeTests.set(playerId, {
    category: item.category,
    cosmeticId: item.id,
    itemName: item.name,
    rarity: item.rarity,
    css: item.css,
    timer
  });

  const catName = CATEGORY_NAMES[item.category] || item.category;
  const buffStr = item.buffs
    ? ' Buffs: ' + item.buffs.map(b => b.label).join(', ')
    : item.buff ? ' Buff: ' + item.buff.label : '';
  return {
    ok: true,
    message: `Testing ${item.name} (${catName}) for 30s!${buffStr} Use !buyc ${item.name} to purchase.`,
    item
  };
}

/**
 * Clear an active test cosmetic preview.
 * @returns {boolean} true if something was cleared
 */
function clearTestCosmetic(playerId) {
  const test = activeTests.get(playerId);
  if (!test) return false;
  clearTimeout(test.timer);
  activeTests.delete(playerId);
  return true;
}

/**
 * Get active test info for a player (if any).
 */
function getActiveTest(playerId) {
  return activeTests.get(playerId) || null;
}

function getPlayerOwned(db, playerId) {
  return db.queryAll(
    `SELECT pc.cosmetic_id, pc.equipped, c.category, c.name, c.rarity, c.cost, c.css_property
     FROM player_cosmetics pc
     JOIN cosmetics c ON c.id = pc.cosmetic_id
     WHERE pc.player_id = ?
     ORDER BY c.sort_order`,
    [playerId]
  );
}

function buyCosmetic(db, playerId, cosmeticId, playerXp, allPlayerIds) {
  const { item, error } = resolveCosmetic(cosmeticId);
  if (!item) return { ok: false, message: error };

  // Block individual purchase of gift-set items
  if (item.giftSet) {
    const setKey = cosmeticToSet[item.id];
    const setDef = setKey ? COSMETIC_SETS[setKey] : null;
    const setName = setDef ? setDef.name : 'this';
    return { ok: false, message: `${item.name} is part of the ${setName} set — use !buyset ${setKey || 'setname'} to purchase the full set with gift coins!` };
  }

  // Check if already owned
  const existing = db.queryOne(
    'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
    [playerId, item.id]
  );
  if (existing) return { ok: false, message: `You already own ${item.name}!` };

  if (playerXp < item.cost) {
    return { ok: false, message: `Need ${formatCost(item.cost)} XP for ${item.name} (have ${formatCost(playerXp)})` };
  }

  try {
    db.deductPlayerXp(playerId, item.cost);

    // Unequip any existing cosmetic in the same category (across all linked players)
    const idsToUnequip = (allPlayerIds && allPlayerIds.length > 0) ? allPlayerIds : [playerId];
    const ph = idsToUnequip.map(() => '?').join(',');
    db.run(
      `UPDATE player_cosmetics SET equipped = 0
       WHERE player_id IN (${ph}) AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
      [...idsToUnequip, item.category]
    );

    // Insert and auto-equip the new cosmetic
    db.run(
      `INSERT INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 1)`,
      [playerId, item.id]
    );
    db.save();

    const buffInfo = item.buffs
      ? ` (${item.buffs.map(b => b.label).join(', ')})`
      : item.buff ? ` (${item.buff.label})` : '';
    return { ok: true, message: `${item.name} purchased and equipped!${buffInfo}`, item };
  } catch (err) {
    db.updatePlayerXp(playerId, item.cost);
    db.save();
    console.error(`[Cosmetics] buyCosmetic rollback for player ${playerId}:`, err.message);
    return { ok: false, message: 'Cosmetic purchase failed (rolled back). Try again.' };
  }
}

function equipCosmetic(db, playerId, cosmeticId, allPlayerIds) {
  const { item, error } = resolveCosmetic(cosmeticId);
  if (!item) return { ok: false, message: error };

  const owned = db.queryOne(
    'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
    [playerId, item.id]
  );
  if (!owned) return { ok: false, message: `You don't own ${item.name}. Buy it first with: !buyc ${item.name}` };

  if (owned.equipped === 1) return { ok: false, message: `${item.name} is already equipped!` };

  // Unequip any existing in same category across ALL linked players
  const idsToUnequip = (allPlayerIds && allPlayerIds.length > 0) ? allPlayerIds : [playerId];
  const ph = idsToUnequip.map(() => '?').join(',');
  db.run(
    `UPDATE player_cosmetics SET equipped = 0
     WHERE player_id IN (${ph}) AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
    [...idsToUnequip, item.category]
  );

  // Equip the new one (equipping implies the player has seen it)
  db.run(
    'UPDATE player_cosmetics SET equipped = 1, seen = 1 WHERE player_id = ? AND cosmetic_id = ?',
    [playerId, item.id]
  );
  db.save();

  const buffInfo = item.buffs
    ? ` ${item.buffs.map(b => b.label).join(', ')} active!`
    : item.buff ? ` ${item.buff.label} active!` : '';
  return { ok: true, message: `${item.name} equipped!${buffInfo}`, item };
}

function unequipCategory(db, playerId, categoryInput) {
  const category = resolveCategory(categoryInput);
  if (!category) return { ok: false, message: `Unknown category. Options: ${Object.keys(CATEGORY_NAMES).join(', ')}` };

  // Find the currently equipped item before unequipping (for visual card)
  const equippedRow = db.queryOne(
    `SELECT pc.cosmetic_id FROM player_cosmetics pc
     JOIN cosmetics c ON c.id = pc.cosmetic_id
     WHERE pc.player_id = ? AND pc.equipped = 1 AND c.category = ?`,
    [playerId, category]
  );
  const unequippedItem = equippedRow ? catalogById[equippedRow.cosmetic_id] : null;

  db.run(
    `UPDATE player_cosmetics SET equipped = 0
     WHERE player_id = ? AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
    [playerId, category]
  );
  db.save();

  const buffType = CATEGORY_BUFF_TYPE[category];
  const buffNote = buffType ? ` ${BUFF_TYPE_NAMES[buffType]} buff removed.` : '';
  return { ok: true, message: `${CATEGORY_NAMES[category]} cosmetic unequipped.${buffNote}`, item: unequippedItem };
}

function formatCost(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return String(num);
}

/**
 * Buy a complete gift-coin set. Grants all 8 items and auto-equips them.
 * @param {object} db
 * @param {number} playerId
 * @param {string} setKey - 'america' or 'canada'
 * @param {number} playerGiftCoins - player's current gift_coins balance
 * @returns {{ ok, message, setDef?, items? }}
 */
function buySet(db, playerId, setKey, playerGiftCoins, allPlayerIds) {
  const setDef = COSMETIC_SETS[setKey];
  if (!setDef) {
    const giftSetNames = Object.entries(COSMETIC_SETS)
      .filter(([, s]) => s.giftSet)
      .map(([k]) => k)
      .join(', ');
    return { ok: false, message: `Unknown set. Available gift sets: ${giftSetNames}. Use !sets to view all sets.` };
  }
  if (!setDef.giftSet) return { ok: false, message: `${setDef.name} is a coin set — buy each piece with !buyc [name]. Gift sets: !buyset america, !buyset canada` };
  if (setDef.fanClubOnly) {
    return { ok: false, message: `${setDef.name} unlocks automatically when you join @jorrybeaufart's TikTok Fan Club: ${setDef.unlockUrl || 'https://www.tiktok.com/@jorrybeaufart'}` };
  }
  if (setDef.superfanOnly) {
    return { ok: false, message: `${setDef.name} unlocks automatically for @jorrybeaufart's TikTok Super Fans: ${setDef.unlockUrl || 'https://www.tiktok.com/@jorrybeaufart'}` };
  }
  if (setDef.donorClassOnly) {
    return { ok: false, message: `${setDef.name} unlocks automatically for Donor Class members: ${setDef.unlockUrl || 'https://wordtycoon.live/portal/'}` };
  }
  if (setDef.superDonorOnly) {
    return { ok: false, message: `${setDef.name} unlocks automatically once you hold BOTH Super Fan and Donor Class: ${setDef.unlockUrl || 'https://wordtycoon.live/portal/'}` };
  }

  // Check if already fully owned
  const ownedItems = [];
  let alreadyOwnedCount = 0;
  for (const itemId of setDef.itemIds) {
    const existing = db.queryOne(
      'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
      [playerId, itemId]
    );
    if (existing) alreadyOwnedCount++;
  }
  if (alreadyOwnedCount === setDef.itemIds.length) {
    return { ok: false, message: `You already own the full ${setDef.name} set!` };
  }

  // Prorate cost: only charge for items not already owned
  const unownedCount = setDef.itemIds.length - alreadyOwnedCount;
  const costPerItem = setDef.totalCost / setDef.itemIds.length;
  const proratedCost = Math.ceil(costPerItem * unownedCount);

  if (playerGiftCoins < proratedCost) {
    const costLabel = alreadyOwnedCount > 0
      ? `${formatCost(proratedCost)} gift coins for remaining ${unownedCount} pieces`
      : `${formatCost(setDef.totalCost)} gift coins for ${setDef.name} set`;
    return { ok: false, message: `Need ${costLabel} (have ${formatCost(playerGiftCoins)}). Earn gift coins from TikTok gifts!` };
  }

  try {
    // Deduct prorated gift coins
    db.run('UPDATE players SET gift_coins = gift_coins - ? WHERE id = ?', [proratedCost, playerId]);

    // Grant all items and auto-equip
    const idsForUnequip = (allPlayerIds && allPlayerIds.length > 0) ? allPlayerIds : [playerId];
    const setPh = idsForUnequip.map(() => '?').join(',');
    const grantedItems = [];
    for (const itemId of setDef.itemIds) {
      const item = catalogById[itemId];
      if (!item) continue;

      const existing = db.queryOne(
        'SELECT * FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
        [playerId, itemId]
      );

      // Unequip any existing in same category across all linked players
      db.run(
        `UPDATE player_cosmetics SET equipped = 0
         WHERE player_id IN (${setPh}) AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
        [...idsForUnequip, item.category]
      );

      if (existing) {
        // Already owned — just equip
        db.run('UPDATE player_cosmetics SET equipped = 1 WHERE player_id = ? AND cosmetic_id = ?', [playerId, itemId]);
      } else {
        // Insert and auto-equip
        db.run(
          `INSERT INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 1)`,
          [playerId, itemId]
        );
        grantedItems.push(item);
      }
    }
    db.save();
  } catch (err) {
    db.run('UPDATE players SET gift_coins = gift_coins + ? WHERE id = ?', [proratedCost, playerId]);
    db.save();
    console.error(`[Cosmetics] buySet rollback for player ${playerId}:`, err.message);
    return { ok: false, message: 'Set purchase failed (rolled back). Try again.' };
  }

  return {
    ok: true,
    message: `🎁 ${setDef.name} set unlocked! All 8 pieces equipped — ${setDef.setBonusLabel} set bonus active!`,
    setDef,
    items: grantedItems
  };
}

// ==================== PROCEDURAL COSMETIC GENERATION ====================
// Seed-based HSL system for daily loot box rewards.
// Only seed + rarity stored; CSS computed from pure math.

const LOOT_SECRET = process.env.LOOT_SECRET || crypto.randomBytes(16).toString('hex'); // set LOOT_SECRET to keep daily loot stable across restarts

// Rarity weights (total 1000)
const RARITY_WEIGHTS = [
  { rarity: 'common',    weight: 600 },
  { rarity: 'uncommon',  weight: 250 },
  { rarity: 'rare',      weight: 100 },
  { rarity: 'epic',      weight: 35  },
  { rarity: 'legendary', weight: 12  },
  { rarity: 'ultra',     weight: 3   }
];
const RARITY_WEIGHT_TOTAL = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);

// Category weights (total 100) — win_effect excluded (uses particle system)
const CATEGORY_WEIGHTS = [
  { category: 'word_color',     weight: 18 },
  { category: 'name_color',     weight: 18 },
  { category: 'word_glow',      weight: 14 },
  { category: 'name_glow',      weight: 14 },
  { category: 'profile_border', weight: 12 },
  { category: 'profile_glow',   weight: 12 },
  { category: 'title',          weight: 12 }
];
const CATEGORY_WEIGHT_TOTAL = CATEGORY_WEIGHTS.reduce((s, c) => s + c.weight, 0);

// Lightness ranges per rarity (for dark background #0d0d0f visibility)
const RARITY_LIGHTNESS = {
  common:    { min: 55, max: 65 },
  uncommon:  { min: 58, max: 70 },
  rare:      { min: 60, max: 75 },
  epic:      { min: 65, max: 80 },
  legendary: { min: 70, max: 85 },
  ultra:     { min: 75, max: 90 }
};

// Buff values per rarity (lower than shop cosmetics since these are free)
const RARITY_BUFF_VALUES = {
  common:    0.005,
  uncommon:  0.015,
  rare:      0.03,
  epic:      0.05,
  legendary: 0.08,
  ultra:     0.12
};

// Hue-indexed name pools (8 bands)
const HUE_NAMES = [
  { min: 0,   max: 30,  adjectives: ['Crimson', 'Scarlet', 'Ruby', 'Ember', 'Blazing'],    nouns: ['Flame', 'Spark', 'Blaze', 'Inferno', 'Flare'] },
  { min: 30,  max: 60,  adjectives: ['Amber', 'Copper', 'Bronze', 'Saffron', 'Molten'],    nouns: ['Forge', 'Sun', 'Harvest', 'Sand', 'Dusk'] },
  { min: 60,  max: 90,  adjectives: ['Golden', 'Solar', 'Radiant', 'Aureate', 'Gilded'],   nouns: ['Light', 'Crown', 'Halo', 'Gleam', 'Ray'] },
  { min: 90,  max: 150, adjectives: ['Verdant', 'Emerald', 'Jade', 'Sylvan', 'Viridian'],  nouns: ['Leaf', 'Vine', 'Grove', 'Thorn', 'Moss'] },
  { min: 150, max: 200, adjectives: ['Glacial', 'Arctic', 'Crystal', 'Aqua', 'Cerulean'],  nouns: ['Ice', 'Tide', 'Mist', 'Frost', 'Wave'] },
  { min: 200, max: 260, adjectives: ['Cobalt', 'Sapphire', 'Midnight', 'Azure', 'Indigo'], nouns: ['Sky', 'Storm', 'Abyss', 'Depth', 'Void'] },
  { min: 260, max: 310, adjectives: ['Violet', 'Amethyst', 'Arcane', 'Mystic', 'Orchid'],  nouns: ['Veil', 'Shadow', 'Rune', 'Spirit', 'Wisp'] },
  { min: 310, max: 360, adjectives: ['Rose', 'Coral', 'Blossom', 'Magenta', 'Cerise'],     nouns: ['Petal', 'Dawn', 'Silk', 'Bloom', 'Kiss'] }
];

const RARE_PREFIXES = ['Ancient', 'Eternal', 'Lost', 'Awakened', 'Celestial', 'Cosmic', 'Transcendent', 'Phantom', 'Primal', 'Divine'];

// Short title words for title cosmetics
const TITLE_WORDS = {
  common:   ['Ember', 'Frost', 'Bloom', 'Spark', 'Drift', 'Gleam', 'Shade', 'Dusk', 'Tide', 'Mist'],
  uncommon: ['Tempest', 'Eclipse', 'Oracle', 'Zenith', 'Nexus', 'Cipher', 'Flux', 'Apex', 'Prism', 'Vortex'],
  rare:     ['Sovereign', 'Harbinger', 'Warden', 'Sentinel', 'Phantom', 'Archmage', 'Paragon', 'Herald'],
  epic:     ['Godslayer', 'Starforged', 'Voidwalker', 'Dawnbringer', 'Soulweaver', 'Stormlord'],
  legendary: ['Transcendent', 'Eternal', 'Mythical', 'Primordial', 'Celestial', 'Omniscient'],
  ultra:    ['Ascendant', 'Infinite', 'Absolute', 'Cosmic', 'Unbound', 'Supreme']
};

/**
 * Seeded PRNG — deterministic random from seed string.
 * Uses md5 hash to generate sequential random numbers.
 */
function createPRNG(seed) {
  let counter = 0;
  return function next() {
    const hash = crypto.createHash('md5').update(seed + ':' + counter).digest();
    counter++;
    // Read first 4 bytes as uint32, convert to [0,1)
    const uint32 = hash.readUInt32BE(0);
    return uint32 / 0x100000000;
  };
}

/**
 * Generate deterministic seed from player ID + date.
 */
function generateSeed(playerId, date) {
  return crypto.createHash('sha256')
    .update(playerId + ':' + date + ':' + LOOT_SECRET)
    .digest('hex')
    .substring(0, 8);
}

/**
 * Pick rarity from weighted distribution using PRNG value [0,1).
 */
function pickRarity(rng) {
  const roll = Math.floor(rng() * RARITY_WEIGHT_TOTAL);
  let cum = 0;
  for (const r of RARITY_WEIGHTS) {
    cum += r.weight;
    if (roll < cum) return r.rarity;
  }
  return 'common';
}

/**
 * Pick category from weighted distribution using PRNG value [0,1).
 */
function pickCategory(rng) {
  const roll = Math.floor(rng() * CATEGORY_WEIGHT_TOTAL);
  let cum = 0;
  for (const c of CATEGORY_WEIGHTS) {
    cum += c.weight;
    if (roll < cum) return c.category;
  }
  return 'word_color';
}

/**
 * Convert HSL to RGB values [0-255].
 */
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Generate primary color from seed.
 * Returns { hue, sat, light, r, g, b, hex, outlineHex }.
 */
function generateColor(rng, rarity) {
  const hue = Math.floor(rng() * 360);
  const sat = 55 + Math.floor(rng() * 46); // 55-100%
  const lr = RARITY_LIGHTNESS[rarity];
  const light = lr.min + Math.floor(rng() * (lr.max - lr.min + 1));
  const [r, g, b] = hslToRgb(hue, sat, light);
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  // Color-coordinated outline: same hue, reduced saturation, very low lightness
  const outSat = Math.max(20, sat - 20);
  const outLight = 12 + Math.floor(rng() * 7); // 12-18%
  const [or, og, ob] = hslToRgb(hue, outSat, outLight);
  const outlineHex = '#' + [or, og, ob].map(v => v.toString(16).padStart(2, '0')).join('');
  return { hue, sat, light, r, g, b, hex, outlineHex, outR: or, outG: og, outB: ob };
}

/**
 * Generate a secondary color offset from primary hue.
 */
function generateSecondaryColor(rng, primaryHue, rarity) {
  const offset = 60 + Math.floor(rng() * 120); // 60-180 degree offset
  const hue = (primaryHue + offset) % 360;
  const sat = 60 + Math.floor(rng() * 41);
  const lr = RARITY_LIGHTNESS[rarity];
  const light = lr.min + Math.floor(rng() * (lr.max - lr.min + 1));
  const [r, g, b] = hslToRgb(hue, sat, light);
  return { hue, sat, light, r, g, b };
}

/**
 * Build 8-directional outline using color-coordinated shade.
 */
function buildOutline(outlineHex) {
  const d = 3; // outline distance
  return [
    `-${d}px -${d}px 0 ${outlineHex}`, `${d}px -${d}px 0 ${outlineHex}`,
    `-${d}px ${d}px 0 ${outlineHex}`, `${d}px ${d}px 0 ${outlineHex}`,
    `0 -${d}px 0 ${outlineHex}`, `0 ${d}px 0 ${outlineHex}`,
    `-${d}px 0 ${outlineHex}`, `${d}px 0 ${outlineHex}`
  ];
}

/**
 * Build glow layers based on rarity.
 */
function buildGlowLayers(rng, color, rarity) {
  const { r, g, b } = color;
  const layers = [];

  // All rarities: tight glow
  layers.push(`0 0 8px rgba(${r},${g},${b},0.5)`);

  // Uncommon+: medium glow + dark reinforcement
  if (['uncommon', 'rare', 'epic', 'legendary', 'ultra'].includes(rarity)) {
    layers.push(`0 0 18px rgba(${r},${g},${b},0.28)`);
    layers.push(`0 0 8px rgba(0,0,0,0.85)`);
    layers.push(`0 0 14px rgba(0,0,0,0.4)`);
  }

  // Rare+: wide spread
  if (['rare', 'epic', 'legendary', 'ultra'].includes(rarity)) {
    const spread = 28 + Math.floor(rng() * 9); // 28-36
    layers.push(`0 0 ${spread}px rgba(${r},${g},${b},0.15)`);
  }

  // Epic+: secondary hue glow
  if (['epic', 'legendary', 'ultra'].includes(rarity)) {
    const sec = generateSecondaryColor(rng, color.hue, rarity);
    layers.push(`0 0 44px rgba(${sec.r},${sec.g},${sec.b},0.2)`);
  }

  // Legendary+: tertiary hue glow
  if (['legendary', 'ultra'].includes(rarity)) {
    const tert = generateSecondaryColor(rng, color.hue + 180, rarity);
    layers.push(`0 0 54px rgba(${tert.r},${tert.g},${tert.b},0.15)`);
  }

  // Ultra: ultra-wide ambient
  if (rarity === 'ultra') {
    layers.push(`0 0 68px rgba(${r},${g},${b},0.1)`);
  }

  return layers;
}

/**
 * Get animation CSS for rarity (or empty string).
 */
function getAnimation(rarity) {
  if (rarity === 'epic') return 'gen-pulse 2.5s ease-in-out infinite';
  if (rarity === 'legendary') return 'gen-shift 4s linear infinite';
  if (rarity === 'ultra') return 'gen-prismatic 3s linear infinite';
  return '';
}

/**
 * Generate a cosmetic name from hue-indexed word pools.
 */
function generateName(rng, hue, rarity) {
  // Find hue band
  const band = HUE_NAMES.find(b => hue >= b.min && hue < b.max) || HUE_NAMES[0];
  const adj = band.adjectives[Math.floor(rng() * band.adjectives.length)];
  const noun = band.nouns[Math.floor(rng() * band.nouns.length)];

  // Rare+ get optional prefix
  if (['rare', 'epic', 'legendary', 'ultra'].includes(rarity) && rng() < 0.6) {
    const prefix = RARE_PREFIXES[Math.floor(rng() * RARE_PREFIXES.length)];
    return `${prefix} ${adj} ${noun}`;
  }
  return `${adj} ${noun}`;
}

/**
 * Generate a title text string.
 */
function generateTitleText(rng, rarity) {
  const words = TITLE_WORDS[rarity] || TITLE_WORDS.common;
  const word = words[Math.floor(rng() * words.length)];

  // Rare+ may get a prefix word
  if (['rare', 'epic', 'legendary', 'ultra'].includes(rarity) && rng() < 0.5) {
    const prefixWords = TITLE_WORDS[rarity === 'rare' ? 'uncommon' : 'rare'];
    const prefix = prefixWords[Math.floor(rng() * prefixWords.length)];
    return `${prefix} ${word}`;
  }
  return word;
}

/**
 * Generate CSS properties for a given category + color + rarity.
 * Returns an object matching existing cosmetic css format.
 */
// Mix a generated color toward white/black (tier motion language gradients).
function _liftHex(color, t) {
  const c = v => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0');
  return '#' + c(color.r) + c(color.g) + c(color.b);
}
function _dropHex(color, t) {
  const c = v => Math.round(v * (1 - t)).toString(16).padStart(2, '0');
  return '#' + c(color.r) + c(color.g) + c(color.b);
}
const _GRAD_TIERS = ['rare', 'epic', 'legendary', 'ultra'];

// Add the cyclic gradient-text material for rare+ generated word/name colors.
function _applyGradientText(css, color, rarity) {
  const lt = _liftHex(color, rarity === 'rare' ? 0.35 : 0.45);
  const wh = _liftHex(color, rarity === 'rare' ? 0.7 : 0.85);
  const dk = _dropHex(color, 0.5);
  const stops = rarity === 'rare'
    ? [color.hex, lt, wh, lt, color.hex]
    : [dk, color.hex, lt, wh, lt, color.hex, dk];
  css.backgroundImage = `linear-gradient(${rarity === 'rare' ? 90 : 110}deg, ${stops.join(', ')}, ${stops[0]})`;
  css.backgroundSize = rarity === 'ultra' ? '300% auto' : '235% auto';
  css.webkitBackgroundClip = 'text';
  css.backgroundClip = 'text';
  css.webkitTextFillColor = 'transparent';
  if (rarity === 'rare') css.animation = 'cfx-sweep 2.6s linear infinite';
  else if (rarity === 'epic') css.animation = 'cfx-sweep 3.2s ease-in-out infinite';
  else if (rarity === 'legendary') {
    css.animation = 'cfx-sweep 2.8s ease-in-out infinite, cfx-pulse 2.4s ease-in-out infinite';
    css.__ambient = { fx: 'sparks', colors: [lt, wh], density: 0.6 };
  } else {
    css.animation = 'cfx-sweep 3.5s linear infinite, cfx-pulse 2.2s ease-in-out infinite';
    css.__ambient = { fx: 'aura', colors: [lt, wh], density: 1 };
  }
}

function generateCategoryCSS(rng, category, color, rarity) {
  const anim = getAnimation(rarity);

  switch (category) {
    case 'word_color':
    case 'name_color': {
      const outline = buildOutline(color.outlineHex);
      const glows = buildGlowLayers(rng, color, rarity);
      const css = {
        color: color.hex,
        textShadow: [...outline, ...glows].join(', ')
      };
      if (rarity === 'uncommon') css.animation = 'cfx-breath 3.4s ease-in-out infinite';
      else if (_GRAD_TIERS.includes(rarity)) _applyGradientText(css, color, rarity);
      return css;
    }

    case 'word_glow':
    case 'name_glow': {
      const glows = buildGlowLayers(rng, color, rarity);
      const css = { textShadow: glows.join(', ') };
      if (rarity === 'uncommon') css.animation = 'cfx-breath 3.2s ease-in-out infinite';
      else if (rarity === 'rare') css.animation = 'cfx-breath 2.6s ease-in-out infinite';
      else if (anim) css.animation = anim;
      if (rarity === 'legendary') css.__ambient = { fx: 'motes', colors: [_liftHex(color, 0.3)], density: 0.5 };
      if (rarity === 'ultra') css.__ambient = { fx: 'aura', colors: [_liftHex(color, 0.3)], density: 0.8 };
      return css;
    }

    case 'profile_border': {
      // Epic+ generated borders become rotating conic rings.
      if (['epic', 'legendary', 'ultra'].includes(rarity)) {
        const lt = _liftHex(color, 0.45), wh = _liftHex(color, 0.85), dk = _dropHex(color, 0.45);
        const css = {
          border: '4px solid transparent',
          backgroundImage: `conic-gradient(from var(--cfx-a, 0deg), ${color.hex}, ${lt}, ${wh}, ${lt}, ${color.hex}, ${dk}, ${color.hex})`,
          backgroundOrigin: 'border-box',
          backgroundClip: 'border-box',
          boxShadow: `0 0 12px rgba(${color.r},${color.g},${color.b},0.6), 0 0 26px rgba(${color.r},${color.g},${color.b},0.28)`,
          animation: `cfx-spin ${rarity === 'ultra' ? '2.8s' : rarity === 'legendary' ? '3s' : '4s'} linear infinite`
        };
        if (rarity === 'ultra') css.__ambient = { fx: 'orbit', colors: [lt, wh], density: 0.9 };
        return css;
      }
      const borderWidth = 3;
      const css = { border: `${borderWidth}px solid ${color.hex}` };
      // Uncommon+ get box glow
      if (['uncommon', 'rare'].includes(rarity)) {
        const layers = [`0 0 8px rgba(${color.r},${color.g},${color.b},0.55)`];
        if (rarity === 'rare') {
          layers.push(`0 0 20px rgba(${color.r},${color.g},${color.b},0.25)`);
        }
        css.boxShadow = layers.join(', ');
      }
      return css;
    }

    case 'profile_glow': {
      const layers = [`0 0 12px rgba(${color.r},${color.g},${color.b},0.55)`];
      if (['uncommon', 'rare', 'epic', 'legendary', 'ultra'].includes(rarity)) {
        layers.push(`0 0 24px rgba(${color.r},${color.g},${color.b},0.28)`);
      }
      if (['rare', 'epic', 'legendary', 'ultra'].includes(rarity)) {
        layers.push(`0 0 36px rgba(${color.r},${color.g},${color.b},0.15)`);
      }
      if (['legendary', 'ultra'].includes(rarity)) {
        const sec = generateSecondaryColor(rng, color.hue, rarity);
        layers.push(`0 0 48px rgba(${sec.r},${sec.g},${sec.b},0.12)`);
      }
      if (rarity === 'ultra') {
        layers.push(`0 0 60px rgba(${color.r},${color.g},${color.b},0.08)`);
      }
      const css = { boxShadow: layers.join(', ') };
      if (anim) css.animation = anim;
      if (rarity === 'legendary') css.__ambient = { fx: 'aura', colors: [_liftHex(color, 0.35)], density: 0.5 };
      if (rarity === 'ultra') css.__ambient = { fx: 'aura', colors: [_liftHex(color, 0.35)], density: 0.8 };
      return css;
    }

    case 'title': {
      const titleText = generateTitleText(rng, rarity);
      const css = { title: titleText, titleColor: color.hex };
      // Rare+ titles get a glow
      if (['rare', 'epic', 'legendary', 'ultra'].includes(rarity)) {
        css.titleGlow = `0 0 6px rgba(${color.r},${color.g},${color.b},0.4)`;
      }
      if (['legendary', 'ultra'].includes(rarity)) {
        css.titleGlow = `0 0 8px rgba(${color.r},${color.g},${color.b},0.5), 0 0 20px rgba(${color.r},${color.g},${color.b},0.25)`;
      }
      if (rarity === 'uncommon') css.titleAnimation = 'cfx-breath 3.4s ease-in-out infinite';
      else if (rarity === 'rare') css.titleAnimation = 'cfx-breath 2.8s ease-in-out infinite';
      else if (['epic', 'legendary', 'ultra'].includes(rarity)) {
        const lt = _liftHex(color, 0.45), wh = _liftHex(color, 0.85), dk = _dropHex(color, 0.5);
        css.titleBackground = `linear-gradient(110deg, ${dk}, ${color.hex}, ${lt}, ${wh}, ${lt}, ${color.hex}, ${dk})`;
        css.titleAnimation = rarity === 'epic'
          ? 'cfx-sweep 3s ease-in-out infinite'
          : rarity === 'legendary'
            ? 'cfx-sweep 2.6s ease-in-out infinite, cfx-pulse 2.2s ease-in-out infinite'
            : 'cfx-sweep 2.4s linear infinite, cfx-pulse 2s ease-in-out infinite';
      }
      if (anim && !css.titleAnimation) css.animation = anim;
      return css;
    }

    default:
      return { color: color.hex };
  }
}

/**
 * Generate buff for a generated cosmetic based on category and rarity.
 */
function generateBuff(category, rarity) {
  const buffType = CATEGORY_BUFF_TYPE[category];
  if (!buffType) return null;
  const value = RARITY_BUFF_VALUES[rarity] || 0.005;
  const pct = value * 100;
  const pctStr = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
  const label = `+${pctStr}% ${BUFF_TYPE_NAMES[buffType] || buffType}`;
  return { type: buffType, value, label };
}

/**
 * Fully generate a cosmetic from a seed.
 * Returns { id, seed, category, rarity, name, css, buff, cssJson }.
 * @param {string} seed - 8-char hex seed
 * @param {string} [rarityFloor] - Minimum rarity ('uncommon', 'rare', 'epic', 'legendary'). Rerolls up to 10 times.
 */
function generateFromSeed(seed, rarityFloor) {
  const rng = createPRNG(seed);
  let rarity = pickRarity(rng);
  if (rarityFloor) {
    const floorIdx = RARITY_ORDER.indexOf(rarityFloor);
    if (floorIdx > 0) {
      let rerolls = 0;
      while (RARITY_ORDER.indexOf(rarity) < floorIdx && rerolls < 10) {
        rarity = pickRarity(rng);
        rerolls++;
      }
      // If still below floor after 10 rerolls, force the floor rarity
      if (RARITY_ORDER.indexOf(rarity) < floorIdx) rarity = rarityFloor;
    }
  }
  const category = pickCategory(rng);
  const color = generateColor(rng, rarity);
  const name = generateName(rng, color.hue, rarity);
  const css = generateCategoryCSS(rng, category, color, rarity);
  const buff = generateBuff(category, rarity);
  const id = 'gen_' + seed;

  return {
    id,
    seed,
    category,
    rarity,
    name,
    css,
    buff,
    cssJson: JSON.stringify(css)
  };
}

/**
 * Generate and award a loot box cosmetic to a player.
 * Checks for duplicate (one per player per day).
 * Returns the generated cosmetic or null if already awarded today.
 */
function generateAndAwardLootBox(db, playerId, date, rarityFloor) {
  // Check if already awarded today
  if (db.hasGeneratedCosmeticForDate(playerId, date)) {
    return null;
  }

  const seed = generateSeed(playerId, date);
  const cosmetic = generateFromSeed(seed, rarityFloor);

  const success = db.insertGeneratedCosmetic(
    playerId,
    cosmetic.id,
    seed,
    cosmetic.category,
    cosmetic.rarity,
    cosmetic.name,
    date,
    cosmetic.cssJson
  );

  if (!success) return null;

  return cosmetic;
}

/**
 * Generate and award a loot box with multiple cosmetic items.
 * Each item uses an indexed date key (date:0, date:1, date:2) for uniqueness.
 * Returns array of generated cosmetics or null if already awarded.
 * @param {string} [rarityFloor] - Minimum rarity for all items in this box.
 */
function generateAndAwardLootBoxMulti(db, playerId, date, count = 3, rarityFloor) {
  // Check if ALL items already awarded — only skip if the full set exists
  let allExist = true;
  for (let i = 0; i < count; i++) {
    if (!db.hasGeneratedCosmeticForDate(playerId, date + ':' + i)) {
      allExist = false;
      break;
    }
  }
  if (allExist) return null;

  const items = [];
  for (let i = 0; i < count; i++) {
    const indexedDate = date + ':' + i;

    // Skip items already awarded (partial-recovery: fill in the gaps)
    if (db.hasGeneratedCosmeticForDate(playerId, indexedDate)) {
      // Still include in result so caller sees the full set
      const seed = generateSeed(playerId, indexedDate);
      items.push(generateFromSeed(seed, rarityFloor));
      continue;
    }

    const seed = generateSeed(playerId, indexedDate);
    const cosmetic = generateFromSeed(seed, rarityFloor);

    const success = db.insertGeneratedCosmetic(
      playerId,
      cosmetic.id,
      seed,
      cosmetic.category,
      cosmetic.rarity,
      cosmetic.name,
      indexedDate,
      cosmetic.cssJson
    );

    if (success) items.push(cosmetic);
  }

  return items.length > 0 ? items : null;
}

/**
 * Get buff from a generated cosmetic (looked up from seed).
 * Used by getPlayerBuffs when encountering gen_ IDs.
 */
function getGeneratedCosmeticBuff(cosmeticId) {
  if (!cosmeticId.startsWith('gen_')) return null;
  const seed = cosmeticId.substring(4);
  const cosmetic = generateFromSeed(seed);
  return cosmetic.buff;
}

/**
 * Get full generated cosmetic info from ID.
 */
function getGeneratedCosmeticInfo(cosmeticId) {
  if (!cosmeticId.startsWith('gen_')) return null;
  const seed = cosmeticId.substring(4);
  return generateFromSeed(seed);
}

// ─── Fan Club bundle grant ────────────────────────────────────────────
/**
 * Grant a one-off cosmetic set to a player. Ownership is granted for ALL
 * items in the set; auto-equip only fills empty categories — never
 * overrides an existing equip. Idempotent: subsequent calls are a no-op
 * once player_cosmetic_grants records the grant.
 */
function grantSetToPlayer(db, playerId, setKey, source) {
  const setDef = COSMETIC_SETS[setKey];
  if (!setDef) return { ok: false, message: `Unknown set: ${setKey}` };

  const existingGrant = db.queryOne(
    'SELECT player_id FROM player_cosmetic_grants WHERE player_id = ? AND grant_key = ?',
    [playerId, setKey]
  );
  if (existingGrant) {
    return { ok: true, alreadyGranted: true, grantedItems: [], equippedItems: [] };
  }

  const grantedItems = [];
  const equippedItems = [];

  try {
    for (const itemId of setDef.itemIds) {
      const item = catalogById[itemId];
      if (!item) continue;

      const owned = db.queryOne(
        'SELECT id, equipped FROM player_cosmetics WHERE player_id = ? AND cosmetic_id = ?',
        [playerId, itemId]
      );
      if (!owned) {
        db.run(
          'INSERT INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 0)',
          [playerId, itemId]
        );
        grantedItems.push(item);
      }

      // Membership sets (Super Fan / Donor Class / Super Donor) AUTO-EQUIP the
      // full set on grant — paid tiers should be worn the moment they land;
      // owners can re-style after. Other sets keep the gentle
      // fill-empty-slots behavior.
      if (setDef.superfanOnly || setDef.donorClassOnly || setDef.superDonorOnly) {
        db.run(
          `UPDATE player_cosmetics SET equipped = 0
           WHERE player_id = ? AND cosmetic_id IN (SELECT id FROM cosmetics WHERE category = ?)`,
          [playerId, item.category]
        );
        db.run(
          'UPDATE player_cosmetics SET equipped = 1, seen = 1 WHERE player_id = ? AND cosmetic_id = ?',
          [playerId, itemId]
        );
        equippedItems.push(item);
        continue;
      }

      const equippedInCat = db.queryOne(
        `SELECT pc.id FROM player_cosmetics pc
         JOIN cosmetics c ON c.id = pc.cosmetic_id
         WHERE pc.player_id = ? AND c.category = ? AND pc.equipped = 1
         LIMIT 1`,
        [playerId, item.category]
      );
      if (!equippedInCat) {
        db.run(
          'UPDATE player_cosmetics SET equipped = 1 WHERE player_id = ? AND cosmetic_id = ?',
          [playerId, itemId]
        );
        equippedItems.push(item);
      }
    }

    db.run(
      'INSERT OR IGNORE INTO player_cosmetic_grants (player_id, grant_key, source) VALUES (?, ?, ?)',
      [playerId, setKey, source || null]
    );
    db.save();
  } catch (err) {
    db.save();
    console.error(`[Cosmetics] grantSetToPlayer error player=${playerId} set=${setKey}:`, err.message);
    return { ok: false, message: 'Grant failed: ' + err.message };
  }

  return { ok: true, alreadyGranted: false, grantedItems, equippedItems, setDef };
}

function enqueuePendingGrant(db, platform, platformUserId, setKey, source) {
  if (!platform || !platformUserId || !setKey) return { ok: false, message: 'platform/user/setKey required' };
  db.run(
    'INSERT OR IGNORE INTO pending_cosmetic_grants (platform, platform_user_id, grant_key, source) VALUES (?, ?, ?, ?)',
    [platform, String(platformUserId), setKey, source || null]
  );
  db.save();
  return { ok: true };
}

function drainPendingGrantsForPlatformUser(db, platform, platformUserId, playerId) {
  if (!platform || !platformUserId || !playerId) return { drained: 0 };
  let drained = 0;
  while (true) {
    const row = db.queryOne(
      'SELECT id, grant_key, source FROM pending_cosmetic_grants WHERE platform = ? AND platform_user_id = ? LIMIT 1',
      [platform, String(platformUserId)]
    );
    if (!row) break;

    const res = grantSetToPlayer(db, playerId, row.grant_key, row.source);
    if (res.ok) {
      db.run('DELETE FROM pending_cosmetic_grants WHERE id = ?', [row.id]);
      drained++;
    } else {
      console.warn(`[Cosmetics] drain skip pending#${row.id} (${row.grant_key}): ${res.message}`);
      db.run('DELETE FROM pending_cosmetic_grants WHERE id = ?', [row.id]);
    }
  }
  if (drained > 0) db.save();
  return { drained };
}

module.exports = {
  COSMETICS_CATALOG,
  COSMETIC_SETS,
  RARITY_ORDER,
  RARITY_COLORS,
  RARITY_ALIASES,
  CATEGORY_NAMES,
  BUFF_TYPE_NAMES,
  CATEGORY_BUFF_TYPE,
  DEFAULT_BUFFS,
  seedCosmetics,
  getCosmeticById,
  resolveCosmetic,
  resolveCategory,
  resolveRarity,
  getCategoryItems,
  getItemsByRarity,
  getAllCategories,
  getRarityCounts,
  isBattlePassOnly,
  getPlayerEquipped,
  getPlayerOwned,
  getPlayerBuffs,
  getBuffsForAllEquippedPlayers,
  formatBuffLabel,
  buyCosmetic,
  buySet,
  equipCosmetic,
  unequipCategory,
  formatCost,
  setTestCosmetic,
  clearTestCosmetic,
  getActiveTest,
  getSetForCosmetic,
  getPlayerSetStatus,
  getActiveSetBonuses,
  cosmeticToSet,
  generateSeed,
  generateFromSeed,
  generateAndAwardLootBox,
  generateAndAwardLootBoxMulti,
  getGeneratedCosmeticBuff,
  getGeneratedCosmeticInfo,
  grantSetToPlayer,
  enqueuePendingGrant,
  drainPendingGrantsForPlatformUser
};
