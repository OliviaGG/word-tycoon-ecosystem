# Word Tycoon Ecosystem — Complete Documentation

> **Last updated:** March 12, 2026
> **Portal:** [wordtycoon.live/me](https://wordtycoon.live/me)
> **Production server:** 64.23.145.183 (DigitalOcean droplet)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Chat Relay Hub](#2-chat-relay-hub)
3. [Word Tycoon Economy Server](#3-word-tycoon-economy-server)
4. [Game Servers](#4-game-servers)
5. [Player Portal](#5-player-portal)
6. [Shared Word Bank](#6-shared-word-bank)
7. [Authentication & Account Linking](#7-authentication--account-linking)
8. [Daily & Weekly Challenge System](#8-daily--weekly-challenge-system)
9. [Cosmetics & Economy](#9-cosmetics--economy)
10. [Deployment & Infrastructure](#10-deployment--infrastructure)
11. [API Reference](#11-api-reference)
12. [Data Storage Reference](#12-data-storage-reference)

---

## 1. Architecture Overview

### System Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│                        CHAT RELAY HUB (:3000)                     │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐ │
│  │ TikFinity │ │Streamer  │ │ Discord │ │  Spotify │ │ Word   │ │
│  │ WebSocket │ │.bot WS   │ │ Bot v14 │ │  OAuth   │ │ Bank   │ │
│  └─────┬─────┘ └────┬─────┘ └────┬────┘ └────┬─────┘ └───┬────┘ │
│        └─────────────┴────────────┴───────────┘            │      │
│                    ┌──────────┐                             │      │
│                    │  RELAY   │  (normalize + broadcast)    │      │
│                    └────┬─────┘                             │      │
│         ┌───────────────┼───────────────┐                  │      │
│    Socket.IO      Socket.IO        HTTP Proxy              │      │
│    broadcast      app-register     /game/:id/*             │      │
│         │               │               │                  │      │
│  ┌──────┴────┐  ┌───────┴───────┐  ┌───┴──────┐          │      │
│  │  Portal   │  │ Game Servers  │  │ Reverse  │          │      │
│  │  /me      │  │ (14 apps)     │  │ Proxy    │          │      │
│  └───────────┘  └───────────────┘  └──────────┘          │      │
│                                                            │      │
│  ┌──────────────────────────────────────────────────────┐ │      │
│  │            OAuth (Discord + GitHub)                   │ │      │
│  │    Session Management + Remember Cookies              │ │      │
│  │    SP Daily/Weekly Tracking + Game State Sync         │ │      │
│  └──────────────────────────────────────────────────────┘ │      │
└───────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  WORD TYCOON      │
                    │  Economy (:3020)  │
                    │  ┌─────────────┐  │
                    │  │ Coins/Taps  │  │
                    │  │ Businesses  │  │
                    │  │ Cosmetics   │  │
                    │  │ Pizza Shop  │  │
                    │  │ Loot Boxes  │  │
                    │  │ Ledger      │  │
                    │  └─────────────┘  │
                    └───────────────────┘
```

### Port Map

| Port | Service | PM2 Name | Description |
|------|---------|----------|-------------|
| 3000 | Chat Relay | `mobile-relay` | Central hub, reverse proxy, portal |
| 3010 | My Bubble | `my-bubble` | Team tapping game |
| 3011 | Word 500 | `word500` | Word deduction (MP) |
| 3012 | PixeLetters | `pixeletters` | Pixel art word game |
| 3013 | Spelling Bee | `spellingbee` | Honeycomb word finder |
| 3014 | Wordle | `wordle` | Variable-length Wordle |
| 3015 | Searchle | `searchle` | Semantic word guessing |
| 3016 | RecTangled | `rectangled` | Letter grid word search |
| 3017 | Betwixt | `betwixt` | Alphabetical word game |
| 3018 | Word 500 SP | `word1000` | Client-side SP Word 500 |
| 3019 | Figural | `figural` | Symbol-based deduction |
| 3020 | Word Tycoon | `mobile-tycoon` | Economy/tycoon server |
| 3025 | StreamDeck | `streamdeck` | OBS overlay orchestrator |
| 3026 | Discord Bot | `discord-bot` | SassBot#3864 |
| 3030 | Word Monopoly | `monopoly` | Chat-driven Monopoly |

### Technology Stack

- **Runtime:** Node.js v24.13.1
- **Framework:** Express 4
- **Real-time:** Socket.IO 4.8 + raw WebSocket (ws)
- **Database:** sql.js (SQLite via WASM) — no native compilation needed
- **Frontend:** Vanilla JS (no framework), dark theme, CSS custom properties
- **Chat sources:** TikTok (via TikFinity), YouTube (via Streamer.bot), Discord (discord.js v14)
- **Auth:** Discord OAuth2 + GitHub OAuth2, session cookies + HMAC remember tokens
- **Deployment:** SCP to DigitalOcean, PM2 process manager, nginx reverse proxy

---

## 2. Chat Relay Hub

**Location:** `C:\Chat Relay\` → `/opt/chat-relay/`
**Entry:** `server.js` (port 3000)
**Package:** `relay-broadcast` v1.0.0

### Core Responsibilities

1. **Message relay** — Normalizes chat from TikTok/YouTube/Discord, broadcasts to all game servers via Socket.IO
2. **Game reverse proxy** — Serves all games through `/game/:id/` on port 3000 (single domain)
3. **Player portal** — Full SPA at `/me` with game stats, cosmetics, store, businesses
4. **App manager** — Starts/stops/monitors all 14 game apps, 8-second health checks
5. **Word bank** — Central word database API for all word games
6. **OAuth gateway** — Discord + GitHub login for portal
7. **SP tracking** — Daily/weekly challenge completion storage, cross-device game state sync
8. **Spotify** — Now-playing integration via OAuth + 5-second polling

### Source Modules (src/)

| Module | Purpose |
|--------|---------|
| `auth.js` | Admin password login, session middleware, route protection |
| `database.js` | SQLite via sql.js — users, TTS settings, chat history |
| `relay.js` | Central message bus — normalize, broadcast, cosmetics/linked caches |
| `tiktok.js` | TikFinity WebSocket client (chat, likes, gifts) |
| `youtube.js` | Streamer.bot WebSocket client (chat, SuperChat, memberships) |
| `discord.js` | discord.js v14 bot — channel watcher, message relay |
| `commands.js` | Unified `/command` handler (15 commands: TTS, linking, color, nick) |
| `apps.js` | Game app manager — spawn, kill, health check, logs |
| `spotify.js` | Spotify OAuth2 + Now Playing polling |
| `word-bank.js` | Shared word database — targets, dictionary, frequency, daily/weekly words |
| `chat-filter.js` | Moderation — blacklist, spam, flood, leet-speak, zalgo, link stripping |
| `relay-bridge.js` | Optional remote relay sync (for multi-server streaming) |
| `discord-oauth.js` | Discord OAuth2 (identify + connections) |
| `github-oauth.js` | GitHub OAuth2 (read:user + user:email) |
| ~~`google-oauth.js`~~ | *(Deleted March 9 — replaced by GitHub OAuth)* |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `ADMIN_PASSWORD` | Admin login for dashboard |
| `SESSION_SECRET` | Session + remember cookie signing |
| `TIKFINITY_WS_URL` | TikFinity WebSocket endpoint |
| `TIKTOK_USERNAME` | TikTok streamer username |
| `STREAMERBOT_WS_URL` | Streamer.bot WebSocket for YouTube |
| `DISCORD_BOT_TOKEN` | Discord bot auth token |
| `DISCORD_CHANNEL_ID` | Discord channel to watch |
| `DISCORD_WEBHOOK_URL` | Discord webhook for relaying |
| `DISCORD_CLIENT_ID/SECRET` | Discord OAuth2 credentials |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth2 credentials |
| `SPOTIFY_CLIENT_ID/SECRET` | Spotify OAuth2 credentials |
| `GAME_API_SECRET` | Inter-service API key |
| `BRIDGE_RELAY_URL/SECRET` | Remote relay bridge (optional) |
| `ADMIN_USER_IDS` | Comma-separated admin identifiers |

### Game Reverse Proxy

All games are served through `/game/:gameId/*` on port 3000. The proxy:
- Creates `http-proxy` instances for every app in `apps.json`
- Intercepts HTML responses to inject Socket.IO path rewriting and fetch interceptor scripts
- Injects chat widget script on every game page
- Proxies WebSocket upgrades for Socket.IO through the proxy
- Blocks sensitive paths (`/api/admin`, `/api/cosmetics/buy`, etc.)
- Injects `x-api-key` header for admin requests to game servers

### Vanity URL Redirects

14 user-friendly paths redirect to game proxy pages:

| URL | Game Page |
|-----|-----------|
| `/wordle/` | Wordle SP |
| `/wordle-multi/` | Wordle MP |
| `/searchle/` | Searchle MP |
| `/searchle-single/` | Searchle SP |
| `/spellingbee/` | Spelling Bee SP |
| `/betwixt/` | Betwixt SP |
| `/pixeletters/` | PixeLetters SP |
| `/rectangled/` | RecTangled SP |
| `/figural/` | Figural SP |
| `/word1000/` | Word 500 SP |
| + `-multi/` variants | MP pages |

### Startup Sequence

1. Initialize SQLite database
2. Initialize relay message bus with Socket.IO + Discord webhook
3. Start chat message cleanup (every 30 min, removes >12h)
4. Initialize app manager (loads `apps.json`, starts 8s health checks)
5. Initialize Spotify (auto-resumes from saved tokens)
6. Connect to Searchle + Word500 via Socket.IO (real-time state relay)
7. Start HTTP server
8. Start live game state polling (every 5s, polls 8 game servers)
9. Connect to TikFinity, Streamer.bot, Discord (if configured)
10. Initialize Discord + GitHub OAuth
11. Initialize relay bridge (if configured)

### Socket.IO Events

**Server → Client:**
`platform-status`, `tts-update`, `commands`, `apps-status`, `chat-message`, `engagement`, `overlay-settings`, `spotify-now-playing`, `cosmetics-updated`, `searchle-*` (5 events), `word500-*` (4 events), `chat-room-*` (3 events), `frenzy-update`

**Client → Server:**
`mobile-message`, `chat-join-room`, `chat-leave-room`, `chat-room-message`, `relay-bridge`, `app-register`, `frenzy-update`

**Valid Chat Rooms:** main, wordle, searchle, spellingbee, pixeletters, word500, betwixt, rectangled, figural

---

## 3. Word Tycoon Economy Server

**Location:** `C:\Word Tycoon\` → `/opt/word-tycoon/`
**Entry:** `server.js` (port 3020, bound to 127.0.0.1)
**Stack:** Express + Socket.IO + sql.js + Redis (with in-memory fallback)

### Core Responsibilities

1. **Coin economy** — All games reward coins through this server
2. **Businesses** — 10 tiers of passive income generators
3. **Tap system** — Engagement-based income from likes/chat
4. **Cosmetics** — 178-item catalog with 8 categories, 7 rarities
5. **Pizza shop** — Mini-game with its own progression
6. **Account linking** — Discord-anchored cross-platform identity
7. **Procedural loot boxes** — Daily/weekly cosmetic rewards
8. **Audit ledger** — Permanent transaction trail
9. **Overlay feed** — Real-time data for OBS overlays

### Source Modules

| Module | Purpose |
|--------|---------|
| `database.js` | SQLite — 16 tables, player resolution, merge system |
| `game-engine.js` | Core loop (2s batch), tap processing, reward stack, frenzy |
| `cosmetics.js` | 178-item catalog, sets, procedural generation |
| `businesses.js` | 10 business tiers, tap upgrades, progression multipliers |
| `pizza-config.js` | Pizza shop — 7 upgrades, prestige (XP doubles per tier), income formulas |
| `relay-client.js` | Socket.IO client to Chat Relay |
| `commands.js` | Chat command handler (!coins, !buy, !shop, etc.) |
| `overlay.js` | OBS overlay data feed |
| `backup.js` | Database backup/restore system |
| `ledger.js` / `ledger-db.js` | Financial audit trail |
| `redis.js` | Tap buffer (Redis with in-memory fallback) |

### Database Schema (16 Tables)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `players` | All platform users | coins, total_taps, tap_power, crit_chance, multi_tap, gift_coins |
| `player_businesses` | Owned businesses | player_id, business_type, level |
| `cosmetics` | Catalog definition | id, category, rarity, cost, css_property (JSON) |
| `player_cosmetics` | Ownership + equip state | player_id, cosmetic_id, equipped |
| `linked_accounts` | Cross-platform links | discord_user_id, platform, platform_user_id |
| `verification_codes` | Linking codes (10-min expiry) | code, discord_user_id |
| `account_preferences` | PFP/display prefs | preferred_pfp_platform, preferred_display_name |
| `player_ledger` | Full audit trail | coins_before, coins_after, coins_delta, event_type |
| `daily_completions` | Daily challenge tracking | player_id, game, date |
| `weekly_completions` | Weekly challenge tracking | player_id, game, week_start |
| `generated_cosmetics` | Loot box awards | seed, category, rarity, date_awarded |
| `pizza_shops` | Pizza shop state | shop_level, prestige_level, pizza_coins |
| `pizza_upgrades` | Pizza upgrade levels | upgrade_type, level |
| `pizza_customizations` | Pizza shop theming | category, value |
| `game_wins` | Win history across games | game, event, guess_count, coins_awarded |
| `stream_sessions` | Stream session tracking | total_taps, total_coins_earned |

### 10-Layer Reward Multiplier Stack

When a game server calls `POST /api/reward`, the base reward passes through:

1. **word_game_boost** — From Word Glow cosmetics (up to +35%)
2. **word_reward_2x** — AUX cosmetic bonus (doubles reward)
3. **prestige** — From Title cosmetics (up to +25%)
4. **coin_bonus** — From Name Color cosmetics (up to +20%)
5. **Frenzy multiplier** — 1.0x to 5.0x based on active tappers
6. **Progression multiplier** — 1x to 250x based on highest business tier
7. **Daily 3x** — First win per game per day gets 3x
8. **Lucky 2x** — Random chance from Win Effect cosmetics (up to 20%)
9. **MAX_TOTAL_MULTIPLIER cap** — Final result capped at 1500x base
10. **game_wins recording** — Logged if it's a win event

### Frenzy System

- Rolling 60-second window of unique tappers
- Multiplier: `1.0 + (activeTappers * 0.1)`, capped at 5.0x
- Broadcast via Socket.IO to all game servers

### Batch Processor (every 2 seconds)

1. Flush Redis tap buffer
2. Refresh cosmetic buff cache (single DB query)
3. Process taps: multi_tap → combo streak → crit multiplier → tap_power → buffs → lucky bonus
4. Update frenzy state
5. Auto-collect business income (with offline rate 10%)
6. Emit overlay updates (income bubbles, state)
7. Cleanup stale rate-limit/combo entries

---

## 4. Game Servers

### 4.1 Word Games with SP + MP

All 8 word games share common infrastructure:

- **Chat Relay connection** via Socket.IO client, register with `app-register`
- **Word Bank integration** for targets + dictionary
- **Coin rewards** via `POST /api/reward` to Word Tycoon
- **Jackpot system** (standardized 3 endpoints: GET/POST settings, POST reset)
- **Frenzy multiplier** forwarded from Word Tycoon
- **Cosmetics** cached for player display customization
- **Admin auth** via `requireAdmin` middleware + socket `admin-auth`

#### Searchle (:3015)

**Path:** `C:\Searchle 3.0\`
**Mechanic:** Semantic word guessing using 2 embedding models (ConceptNet Numberbatch + FastText). Guesses ranked by cosine similarity via Reciprocal Rank Fusion (RRF). Win at rank 1.
**SP:** Pre-computed SP pool files (gzipped), client-side processing
**MP:** Chat-driven, guess bumping system
**Special:** ~330MB embedding models (float16), 446K union vocabulary, own word database, contributed 2,474 targets to shared bank
**Data:** Game state JSON files, played words tracking, embedding models in `data/models/`

#### Word 500 (:3011)

**Path:** `C:\Word500(2.0)\`
**Mechanic:** 5-letter word deduction with abstract color feedback (all-absent vs neutral — does NOT reveal individual green/yellow).
**SP:** Separate server at `:3018` (`C:\Word1000\`) — entirely client-side
**MP:** Chat-driven + web socket guesses
**Data:** JSON files — `played-words.json`, `win-history.json`

#### Wordle (:3014)

**Path:** `C:\Wordle\`
**Mechanic:** Standard Wordle with green/yellow/gray tiles. Variable word length. Unlimited guesses.
**SP:** `public/sp-engine.js`
**MP:** Chat-driven + web socket
**Data:** JSON files — `winners.json`, `history.json`, `played-words.json`

#### Betwixt (:3017)

**Path:** `C:\Betweenle\`
**Mechanic:** Alphabetical binary search. Each guess narrows upper/lower boundaries. Confirmed letters revealed when boundaries agree.
**SP:** `public/sp-engine.js`
**MP:** Chat-driven + web socket
**Data:** JSON files — `game-state.json`, `history.json`, `played-words.json`

#### PixeLetters (:3012)

**Path:** `C:\PixeLetters\`
**Mechanic:** Word guessing with pixel art reveals. 7×5 pixel font grid per letter. Three modes: Standard (top-down), Plus (random direction), Pro (only latest row visible).
**SP:** `public/sp-engine.js`
**MP:** Chat-driven + web socket
**Data:** sql.js SQLite — `pixeletters.db` (game_state, user_stats, game_history, settings)

#### Figural (:3019)

**Path:** `C:\Figural\`
**Mechanic:** Symbol-based deduction. 3 mystery symbols from pool of 6, each with random meaning (not_present/correct/wrong_position). Decode symbols to find the word.
**SP:** `public/sp-engine.js`
**MP:** Chat-driven + web socket, rate-limited (500ms between guesses)
**Data:** In-memory only

#### Spelling Bee (:3013)

**Path:** `C:\SpellingBee\`
**Mechanic:** Find valid words from 7 letters with mandatory center letter. Collaborative — all players contribute. Common vs rare word classification.
**SP:** `public/js/sp-engine.js`, 100 themed puzzles
**MP/Weekly:** Chat-driven + web socket, weekly puzzle from Word Bank
**Data:** JSON files via `src/storage.js` — `current-game.json`, `saved-games.json`, `player-stats.json`, `game-history.json`

#### RecTangled (:3016)

**Path:** `C:\RecTangled\`
**Mechanic:** Letter grid word search via adjacency paths. Trie-based path validation. Common/rare classification.
**SP:** `public/sp-engine.js`
**MP/Weekly:** Chat-driven + web socket, weekly puzzle from deterministic SHA-256 seed
**Data:** sql.js SQLite — `rectangled.db` (game_history, game_state), themed puzzles in `data/puzzles.json`

### 4.2 Non-Word Games

#### My Bubble (:3010)

**Path:** `C:\My Bubble\`
**Mechanic:** Team tapping — viewers join a country's team via `/team [country]`. Chat messages = taps. TikTok likes/gifts = bonus taps.
**Data:** In-memory only (resets on restart)

#### Word Monopoly (:3030)

**Path:** `C:\Monopoly\`
**Mechanic:** Full Monopoly rules — 40 board spaces, dice, property, houses/hotels, auctions, trading, jail. Chat-driven via 25+ commands (`!join`, `!roll`, `!buy`, `!build`, `!trade`, etc.).
**Special:** Buy-in using Word Tycoon coins, AI auto-play for AFK, up to 8 players
**Data:** sql.js SQLite (players, games, history, achievements)

### 4.3 Infrastructure

#### StreamDeck (:3025)

**Path:** `C:\StreamDeck\`
**Purpose:** Unified 1920×1080 OBS overlay manager. Embeds game overlays + economy panels in configurable layouts. Scene presets.
**Data:** Layout presets in JSON files

#### Discord Bot (:3026)

**Path:** `C:\Word Tycoon\discord-bot\`
**Purpose:** SassBot#3864 — 21 slash commands + prefix (`!`) equivalents for economy interaction from Discord.
**Commands:** `/tap`, `/coins`, `/empire`, `/buy`, `/upgrade`, `/shop`, `/buyc`, `/equip`, `/unequip`, `/mycos`, `/sets`, `/buyset`, `/buybest`, `/buybestmax`, `/play`, `/link`, `/verify`, `/leaderboard`, `/help`, `/combo`, `/test`

### SP Engine Distribution

| Game | SP Engine File | Daily | Weekly |
|------|---------------|-------|--------|
| Searchle | Pre-computed pool files | ✅ | — |
| Word 500 | Client-side (`C:\Word1000`) | ✅ | — |
| Wordle | `public/sp-engine.js` | ✅ | — |
| Betwixt | `public/sp-engine.js` | ✅ | — |
| PixeLetters | `public/sp-engine.js` | ✅ | — |
| Figural | `public/sp-engine.js` | ✅ | — |
| Spelling Bee | `public/js/sp-engine.js` | — | ✅ |
| RecTangled | `public/sp-engine.js` | — | ✅ |

---

## 5. Player Portal

**URL:** `wordtycoon.live/me`
**Files:** `C:\Chat Relay\public\portal/`
**Stack:** Vanilla JS SPA, Socket.IO for live chat, dark theme

### File Sizes

| File | Lines | Size |
|------|-------|------|
| `index.html` | 451 | 21 KB |
| `js/portal.js` | 3,371 | 145 KB |
| `css/portal.css` | 4,047 | 85 KB |
| `chat-widget.js` | 914 | 40 KB |

### 7 Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Hero banner, coins/stats, daily/weekly challenge trackers, games grid, business chips, linked platforms |
| **Word Games** | 8 game selector bubbles with accordion stat panels (SP + MP) |
| **Businesses** | 10 business cards with buy/upgrade, earnings breakdown, buff summary |
| **Store** | Cosmetics shop (5 filters, sort, preview panel), set progress |
| **Cosmetics** | Owned cosmetics grid, equip/unequip toggle, preview per platform |
| **History** | Transaction ledger with type filter + pagination (30/page) |
| **Live Chat** | Socket.IO chat feed, send from portal |

Plus hidden **Pizza Shop** tab (accessed from Businesses → Manage Shop).

### GAMES Array (8 entries)

| ID | Name | Color | SP URL | Daily Key |
|----|------|-------|--------|-----------|
| searchle | Searchle | #4a9eff | `/searchle-single/` | `searchle_sp_daily_date` |
| word500 | Word 500 | #4fc34f | `/word1000/` | `word500_sp_daily_date` |
| wordle | Wordle | #6aaa64 | `/wordle/` | `wordle_sp_daily_date` |
| betwixt | Betwixt | #7b68ee | `/betwixt/` | `betwixt_sp_daily_date` |
| pixeletters | PixeLetters | #ff6b9d | `/pixeletters/` | `pixeletters_sp_daily_date` |
| spellingbee | Spelling Bee | #ffab00 | `/spellingbee/` | weeklyKey: `spellingbee_sp_weekly` |
| rectangled | RecTangled | #e94560 | `/rectangled/` | weeklyKey: `rectangled_sp_weekly` |
| figural | Figural | #00e5ff | `/figural/` | `figural_sp_daily_date` |

### API Endpoints Called by Portal

**Session:** `/api/me/session`, `/api/me/logout`
**Profile:** `/api/me/profile`, `/api/me/prefs`
**Stats (7 games):** `/api/me/searchle`, `/api/me/word500`, `/api/me/wordle`, `/api/me/betwixt`, `/api/me/pixeletters`, `/api/me/rectangled`, `/api/me/spellingbee`
**Cosmetics:** `/api/me/shop`, `/api/me/sets`, `/api/me/cosmetics/equip`, `/api/me/cosmetics/unequip`, `/api/me/cosmetics/buy`, `/api/me/cosmetics/buyset`
**Business:** `/api/me/business/buy`
**Pizza:** `/api/me/pizza`, `/api/me/pizza/init`, `/api/me/pizza/collect`, `/api/me/pizza/upgrade`, `/api/me/pizza/prestige`, `/api/me/pizza/customize`, `/api/me/pizza/rename`
**Sync:** `/api/sp-sync`, `/api/games/live`
**History:** `/api/me/history`
**Auth:** `/auth/discord`, `/auth/github`

### localStorage Keys

**Daily completions (6):** `searchle_sp_daily_date`, `word500_sp_daily_date`, `wordle_sp_daily_date`, `betwixt_sp_daily_date`, `pixeletters_sp_daily_date`, `figural_sp_daily_date`
**Weekly completions (2):** `spellingbee_sp_weekly`, `rectangled_sp_weekly`
**SP stats (7):** `word500sp_stats`, `betwixt_sp_stats`, `wordle_sp_stats`, `pixeletters_sp_stats`, `rectangled_sp_stats`, `spellingbee_sp_stats`, `figural_sp_stats`

### CSS Theme

```css
--bg: #0f0f14          /* Page background */
--surface: #1a1a24     /* Card background */
--surface2: #22222e    /* Input/hover */
--border: #2a2a3a      /* Borders */
--text: #e0e0e0        /* Primary text */
--text-dim: #888       /* Secondary text */
--accent: #a78bfa      /* Purple accent */
--accent-hover: #7c3aed
```

**Responsive breakpoints:** 860px, 640px, 600px, 380px
**Animations:** 30+ cosmetic effects, hero gradient, daily glow, live pulse, pizza shop animations

### GOAT Hall of Fame

Separate page at `/goat` — top players across all games, standalone HTML/CSS/JS with Google Fonts.

---

## 6. Shared Word Bank

**Module:** `C:\Chat Relay\src\word-bank.js`
**Data:** `C:\Chat Relay\data\word-bank/`

### Data Files

| File | Contents |
|------|----------|
| `targets.json` | 7,101 curated target words by length (keys "2"-"13") |
| `dictionary.json` | 177,107 valid guess words by length (keys "2"-"28") |
| `frequency.json` | 121,042 words with Zipf frequency scores |

### API Endpoints

**Public:**
- `GET /api/word-bank/targets` — all targets by length
- `GET /api/word-bank/targets/:length` — targets for specific length
- `GET /api/word-bank/dictionary/:length` — valid words for a length
- `GET /api/word-bank/validate/:word` — check word (valid, isTarget, isCommon, zipf)
- `GET /api/word-bank/stats` — stats per length + totals
- `GET /api/word-bank/common` — frequency-based common word set (for rarity)
- `GET /api/word-bank/frequency/:word` — Zipf frequency score

**Protected (API key or localhost):**
- `GET /api/word-bank/daily/:gameId` — deterministic daily word (SHA-256 seed)
- `GET /api/word-bank/weekly/:gameId` — deterministic weekly word (SHA-256 seed)

**Admin:**
- `GET /api/word-bank/admin/candidates/:length` — non-target dictionary words
- `POST /api/word-bank/admin/add` / `remove` — CRUD targets
- `GET /api/word-bank/admin/browse/:length` — browse current targets

### How Games Use It

- **Word 500, Wordle, Betwixt, PixeLetters, Figural:** Fetch targets + dictionary on startup. Fall back to local lists if unavailable.
- **Spelling Bee, RecTangled:** Fetch common set for rarity classification + full dictionary for validation. Weekly word from Word Bank.
- **Searchle:** Own embedding models. Daily word from Word Bank. Contributed 2,474 curated targets.

---

## 7. Authentication & Account Linking

### OAuth Providers

| Provider | Scopes | Purpose |
|----------|--------|---------|
| Discord | `identify connections` | Primary login, auto-link TikTok/YouTube/Twitch connections |
| GitHub | `read:user user:email` | Alternative login |

### Session Flow

1. User clicks Login → redirected to OAuth provider
2. Callback exchanges code → creates session with `{ id, username, globalName, avatar, provider }`
3. HMAC-SHA256 signed remember cookie set (30-day expiry)
4. Auto-link Discord connections (TikTok, YouTube, Twitch) on Discord login

### Account Linking Model (Discord-Centric)

Discord ID is always the **anchor**. Other platforms link TO it.

**Source of truth:** Word Tycoon `linked_accounts` table
- Schema: `discord_user_id, platform, platform_user_id, display_name, profile_pic, username`
- `UNIQUE(discord_user_id, platform, platform_user_id)`

**Self-service linking:**
1. Logged in as Provider A → click "Link [Provider B]"
2. Portal navigates to `/auth/providerB?action=link`
3. Server detects `linkingFrom` session → creates link
4. Session switches to Discord identity (always the anchor)

**Merge on link:** When accounts are linked, stats/coins are consolidated. TikTok+YouTube stats sum into the Discord anchor.

---

## 8. Daily & Weekly Challenge System

### Daily Challenges (6 games)

- **Games:** Searchle, Word 500, Wordle, Betwixt, PixeLetters, Figural
- **Reset:** UTC midnight
- **Portal display:** "Complete for a Loot Box 🎁" subtitle, completed pills show "🎁 Loot Box"
- **Reward:** Complete all 6 → procedural cosmetic loot box
- **Server tracking:** `POST /api/sp-daily/complete/:gameId` validates `date === todayUTC`
- **Cross-device sync:** `GET /api/sp-sync` returns all completion states

### Weekly Challenges (2 games)

- **Games:** Spelling Bee, RecTangled
- **Reset:** Monday UTC (ISO week)
- **Portal display:** "Complete for a Cosmetic 🎰 • X days left"
- **Reward:** Each game awards one procedural cosmetic per week
- **Server tracking:** `POST /api/sp-weekly/complete/:gameId` validates `weekStart === currentWeekStart`

### Daily Word Generation

Deterministic via SHA-256: `hash(gameId + ':' + date)` → index into target list for that length. Same word for all players on the same day. Weekly words use `hash(gameId + ':' + weekStart)`.

### Cross-Device State Sync

- `POST /api/sp-state/:gameId` — save in-progress game state (50KB max)
- `GET /api/sp-state/:gameId` — restore state on another device
- `DELETE /api/sp-state/:gameId` — clear state on completion

---

## 9. Cosmetics & Economy

### Currency Types

| Currency | Source | Used For |
|----------|--------|----------|
| **Coins** | Taps, businesses, game wins | Businesses, cosmetics, upgrades |
| **Gift coins** | TikTok gifts (2:1 conversion) | Gift-only sets (Stars & Stripes, Great North) |
| **Pizza coins** | Pizza shop minigame | Pizza upgrades (10% converts to real coins) |

### 10 Businesses

| # | Name | Base Cost | Income/cycle | Reward Multiplier |
|---|------|-----------|--------------|-------------------|
| 1 | Lemonade Stand | Free | Exponential (10^level) | 1x |
| 2 | Newspaper Route | 5K | 5/cycle | 2x |
| 3 | Car Wash | 100K | 25/cycle | 4x |
| 4 | Pizza Shop | 2M | 50/cycle | 8x |
| 5 | Arcade | 50M | 200/cycle | 15x |
| 6 | Gym | 250M | 1K/cycle | 30x |
| 7 | Movie Theater | 1B | 5K/cycle | 60x |
| 8 | Tech Startup | 3B | 25K/cycle | 100x |
| 9 | Bank | 6B | 150K/cycle | 150x |
| 10 | Space Agency | 10B | 1M/cycle | 250x |

### 3 Tap Upgrades

| Upgrade | Base Cost | Max Level | Effect |
|---------|-----------|-----------|--------|
| Tap Power | 1K | 100 | +1 coin/tap per level |
| Critical Tap | 25K | 50 | +4% combo multiplier per level |
| Multi-Tap | 250K | 10 | Each interaction counts as N taps |

### 178 Cosmetic Items

**8 Categories:** Word Color (18), Word Glow (12), Border (14), Glow (11), Name Glow (10), Name Color (12), Title (17), Win Effect (12), + 8 AUX items

**7 Rarity Tiers:** Common (#9d9d9d), Uncommon (#4fc34f), Rare (#4a9eff), Epic (#b44aff), Legendary (#ffab00), Ultra (#ff4444), AUX (#00ffcc)

**8 Themed Sets:** Pixel (100K), Steampunk (500K), Sakura (400M), Storm (4B), Dragon (20B), Quantum (80B), Stars & Stripes (3K gift), Great North (3K gift)

Each cosmetic provides a buff (tap_boost, biz_boost, word_game_boost, etc.). AUX items provide dual buffs + audio-reactive effects.

### Procedural Loot Box Generation

- **Seed:** `SHA-256(playerId + ':' + date + ':' + LOOT_SECRET)` → 8 hex chars
- **PRNG:** MD5-based counter mode
- **Rarity weights:** Common 60%, Uncommon 25%, Rare 10%, Epic 3.5%, Legendary 1.2%, Ultra 0.3%
- **CSS generation:** HSL color → 8-directional outline → glow layers scaled by rarity → animations (epic+)
- **Storage:** Only seed/category/rarity/name stored — CSS recomputed from seed on demand

### Pizza Shop Mini-Game

- Unlocked by buying Pizza business (2M coins)
- 7 upgrade types: Oven Speed, Capacity, Menu Variety, Staff, Seating, Marketing, Delivery
- Diminishing returns formula on all upgrades
- 5 prestige tiers (Amateur → Legendary), multiplier 1x → 8x+
- 6 customization categories with prestige gates
- Income: 10% of pizza coins → real coins on collection
- Max offline accumulation: 8 hours

---

## 10. Deployment & Infrastructure

### Production Environment

- **Server:** DigitalOcean droplet at `64.23.145.183`
- **Domain:** `wordtycoon.live` (nginx reverse proxy → port 3000)
- **Process manager:** PM2 (all services)
- **Node version:** v24.13.1

### PM2 Services

| PM2 Name | Service | Port | Memory Limit |
|----------|---------|------|-------------|
| `mobile-relay` | Chat Relay | 3000 | 300MB |
| `mobile-tycoon` | Word Tycoon | 3020 | 400MB |
| `word500` | Word 500 | 3011 | 200MB |
| `searchle-mobile` | Searchle | 3015 | 1800MB |
| `discord-bot` | Discord Bot | 3026 | 200MB |
| `word1000` | Word 500 SP | 3018 | 200MB |
| `betwixt` | Betwixt | 3017 | 200MB |
| `spellingbee` | Spelling Bee | 3013 | 200MB |
| `wordle` | Wordle | 3014 | 200MB |
| `figural` | Figural | 3019 | 200MB |
| `pixeletters` | PixeLetters | 3012 | 200MB |
| `unwordle` | UnWordle | 3021 | 200MB |
| `rectangled` | RecTangled | 3016 | 400MB |

### Deployment Process

1. Edit files locally in `C:\` directories
2. SCP changed files to production paths in `/opt/`
3. Static files (portal HTML/CSS/JS) — no restart needed, bump `?v=` cache
4. Server files — PM2 restart required: `pm2 restart <name>`

### Startup Order

1. **Chat Relay** (port 3000) — must start first (hosts word bank, proxy)
2. **Word Tycoon** (port 3020) — start second (economy server)
3. **All game servers** — any order (auto-reconnect to Chat Relay)

### Security Measures

- **API key auth** on Word Bank daily/weekly endpoints + all game server admin endpoints
- **OAuth open redirect prevention** — same-origin path validation
- **CORS origin whitelist** on token exchange (not wildcard)
- **gameId whitelist** — prevents prototype pollution
- **State size limit** — 50KB per game per user
- **Atomic file writes** — tmp + rename pattern
- **File locking** — promise-based sequential access
- **Date validation** — server validates daily/weekly dates match current
- **Error message sanitization** — generic messages in production
- **Reward caps** — MAX_SINGLE_REWARD (100K) + MAX_TOTAL_MULTIPLIER (1500x)
- **Rate limiting** — taps (1/sec), rewards (10/sec/game)
- **Coin sanitization** — rejects NaN, Infinity, negative, float
- **Chat moderation** — blacklist, spam detection, flood protection

---

## 11. API Reference

### Chat Relay Routes (port 3000)

**Authentication:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/auth/discord` | — | Discord OAuth2 login/link |
| GET | `/auth/discord/callback` | — | Discord callback |
| GET | `/auth/github` | — | GitHub OAuth2 login/link |
| GET | `/auth/github/callback` | — | GitHub callback |
| GET | `/api/auth/exchange` | — | One-time token exchange (cross-origin) |

**Portal User API (`/api/me/*`):**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/me/session` | — | Check active session |
| POST | `/api/me/logout` | — | Clear session + cookie |
| GET | `/api/me/profile` | User | Full profile (proxied from WT) |
| PUT | `/api/me/prefs` | User | Update PFP/display preferences |
| POST | `/api/me/unlink` | User | Unlink platform account |
| GET | `/api/me/history` | User | Transaction ledger |
| GET | `/api/me/{game}` | User | Per-game stats (7 endpoints) |
| GET | `/api/me/shop` | — | Cosmetics shop catalog |
| GET | `/api/me/sets` | — | Cosmetic sets |
| POST | `/api/me/cosmetics/equip` | User | Equip cosmetic |
| POST | `/api/me/cosmetics/unequip` | User | Unequip category |
| POST | `/api/me/cosmetics/buy` | User | Buy cosmetic |
| POST | `/api/me/cosmetics/buyset` | User | Buy gift set |
| POST | `/api/me/business/buy` | User | Buy/upgrade business |
| GET/POST | `/api/me/pizza/*` | User | Pizza shop (7 endpoints) |

**SP Tracking:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sp-sync` | User | Bulk sync all completions |
| POST | `/api/sp-daily/complete/:gameId` | User/API | Mark daily complete |
| POST | `/api/sp-weekly/complete/:gameId` | User | Mark weekly complete |
| GET/POST/DELETE | `/api/sp-state/:gameId` | User | Game state CRUD (50KB max) |

**Word Bank:** 15 endpoints (see [Section 6](#6-shared-word-bank))

**Admin:** ~50 endpoints covering apps, TTS, overlay, Spotify, cosmetics-admin, accounts-admin, ledger, Searchle/Word500/RecTangled admin proxies, jackpots

**Live:** `GET /api/games/live`, `GET /api/goat`, `GET /api/status`

### Word Tycoon Routes (port 3020)

**Public:** `/api/state`, `/api/leaderboard`, `/api/goat`, `/api/cosmetics/shop`, `/api/cosmetics/:platform/:userId`, `/api/cosmetics/sets`

**Mutation:** `/api/cosmetics/buy`, `/api/cosmetics/equip`, `/api/cosmetics/unequip`, `/api/cosmetics/buyset`

**API-key protected:** `/api/reward`, `/api/balance`, `/api/deduct`

**Admin:** 40+ endpoints for player management, cosmetics, backups, linking, pizza, ledger

### Standardized Jackpot API (all 8 word games)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jackpot/settings` | Current jackpot config |
| POST | `/api/jackpot/settings` | Update settings (API key) |
| POST | `/api/jackpot/reset` | Reset timer (API key) |

---

## 12. Data Storage Reference

### Chat Relay Data (`data/`)

| File/Dir | Type | Purpose |
|----------|------|---------|
| `relaybroadcast.db` | SQLite | Users, TTS settings, chat history |
| `blocked-words.json` | JSON | Chat moderation word lists |
| `spotify-tokens.json` | JSON | Persisted Spotify OAuth tokens |
| `sp-daily-completions.json` | JSON | SP daily completion tracking |
| `sp-game-state.json` | JSON | In-progress SP game states |
| `word-bank/targets.json` | JSON | 7,101 curated target words |
| `word-bank/dictionary.json` | JSON | 177,107 dictionary words |
| `word-bank/frequency.json` | JSON | 24,323 words with Zipf scores |

### Word Tycoon Data

| File | Type | Purpose |
|------|------|---------|
| `word-tycoon.db` | SQLite | 16-table economy database |
| `ledger.db` | SQLite | Permanent audit trail |
| `backups/` | Directory | Database snapshots |

### Game Server Data

| Game | Storage | Location |
|------|---------|----------|
| Word 500 | JSON files | `data/played-words.json`, `data/win-history.json` |
| PixeLetters | sql.js SQLite | `data/pixeletters.db` |
| Spelling Bee | JSON files | `data/current-game.json`, `data/saved-games.json`, `data/player-stats.json` |
| Wordle | JSON files | `data/winners.json`, `data/history.json`, `data/played-words.json` |
| Searchle | JSON + models | `data/sp-pool/`, `data/models/` (~330MB float16) |
| RecTangled | sql.js SQLite | `data/rectangled.db` |
| Betwixt | JSON files | `data/game-state.json`, `data/history.json`, `data/played-words.json` |
| Figural | In-memory | None (resets on restart) |
| Monopoly | sql.js SQLite | `data/` (players, games, history) |

---

## 13. Change Log

### March 9, 2026 — Ecosystem Audit Round 2
- RecTangled PM2 limit raised 200→400MB, secret logging removed (Betwixt/Wordle)
- RecTangled `reportLibraryWord` username fix, PixeLetters dead CSS ref removed
- Searchle weekly numbering stability fix, `reportLibraryWord` consolidated to `gameShared`
- Cosmetics-broadcast auth added, game proxy key injection removed
- Wordle MP switched from Google→GitHub OAuth, CORS origins fixed
- Overlay settings persistence, session secret fallback, dead files deleted
- `google-oauth.js` deleted (was dead code, replaced by GitHub OAuth)

### March 10, 2026 — Dictionary Expansion + Searchle Model Upgrade
- **Dictionary expansion**: 5-letter words expanded from 8,636 → 12,986 via SOWPODS + Wordle dictionary merge
- **Target words**: Grew to 7,101 across all lengths (admin additions over time)
- **Searchle embedding models**: Replaced GloVe + Word2Vec + FastText (3-model, ~650MB) with ConceptNet Numberbatch + FastText (2-model, ~330MB float16)
  - Numberbatch: Knowledge-graph-enhanced embeddings (IsA, PartOf, RelatedTo), 359K words, 300d
  - Semantically isolated words dropped from 115 → 1 ("chevre")
  - Memory usage: ~508MB (down from ~650MB)
  - New tools: `tools/isolation-scan.js`, `tools/convert-float16.js`

### March 12, 2026 — Multi-Task Update + Security Audit
- **Word Mine SP**: Dynamic thresholds, auto-skip 0-word tiers, variable bonus letters
- **Frequency rebuild**: 24,323 → 121,042 words (wordfreq primary + en_50k fallback + inflections)
- **Betwixt CSS**: Arrow/number sizes increased across all modes (OBS + player)
- **Cosmetics New badge**: Fixed timing bug (mark-before-render) and aggressive seeding
- **Pizza prestige**: XP doubles per prestige tier (prestige 1 = base, 2 = 2x, 3 = 4x, etc.)
- **Visibility defaults**: `word_color` and `word_glow` OFF by default for new users
- **Security fixes**: `escapeHtml()` on cosmetic rarity/buff, `sanitizeCssValue()` for CSS injection prevention

*Generated from full codebase audit — updated March 12, 2026*
