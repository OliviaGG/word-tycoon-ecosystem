# Centralized ELO + Cheater Detection Service

Hosted on **Word Tycoon** (`mobile-tycoon` PM2 process, port 3020). All games report round results here. Computes both per-game ELO ratings and a cross-game global ELO.

---

## Architecture

```
┌─────────────┐   POST /api/elo/update   ┌──────────────────────┐
│ WikiSearchle│ ────────────────────────> │                      │
│   (port 3029)│                         │   Word Tycoon        │
├─────────────┤                         │   Centralized ELO    │
│   Searchle  │ ────────────────────────> │   + Suspicion        │
│   (port 3015)│                         │   + Leaderboards     │
├─────────────┤                         │                      │
│ Erectangled │ ────────────────────────> │   data/elo-ratings   │
│   (port 3023)│                         │   data/suspicion     │
├─────────────┤                         │                      │
│  Rectangled │ ────────────────────────> │                      │
│   (port 3016)│                         └──────────────────────┘
└─────────────┘
```

Each game POSTs round results after a round ends. Word Tycoon:
1. Updates per-game ELO for the reporting game
2. Recomputes global ELO as a weighted average across all games
3. Updates rolling-window suspicion scores

---

## Data Model

### `elo-ratings.json`

```json
{
  "games": {
    "wikisearchle": {
      "discord:123456789012345678": {
        "elo": 1247,
        "roundsCounted": 15,
        "history": [
          { "at": 1777566288039, "delta": 20, "newElo": 1247, "articleTitle": "Coptic Orthodox Church" }
        ]
      }
    },
    "searchle": { ... },
    "erectangled": { ... },
    "rectangled": { ... }
  },
  "global": {
    "discord:123456789012345678": {
      "elo": 1233,
      "gamesParticipated": 3,
      "totalRounds": 42
    }
  }
}
```

### `suspicion-scores.json`

```json
{
  "discord:123456789012345678": {
    "byGame": {
      "wikisearchle": {
        "score": 35,
        "flags": ["guess-accuracy"],
        "flagged": null,
        "window": [ ... ]
      }
    },
    "global": {
      "score": 35,
      "flags": ["guess-accuracy"],
      "flagged": null
    }
  }
}
```

**Flag levels:**
- `null` — score < 50
- `"suspicious"` — score 50–74
- `"high-risk"` — score ≥ 75

---

## ELO Math

### Pairwise updates with K/(N-1) normalization

For each round with `N` participants (minimum 3):

```
for each player A:
  for each opponent B (where A ≠ B):
    if A.points == B.points: skip  // ties give 0 delta
    actual = A.points > B.points ? 1 : 0
    expected = 1 / (1 + 10^((B.elo - A.elo) / 400))
    K = 40  if roundsCounted < 10
      = 32  if roundsCounted < 30
      = 24  if roundsCounted < 100
      = 16  otherwise
    delta += (K / (N - 1)) * (actual - expected)

A.elo = max(100, round(A.elo + delta))
A.roundsCounted++
```

### Global ELO

```
for each participant:
  totalWeightedElo = Σ (gameElo * gameRoundsCounted)
  totalRounds       = Σ gameRoundsCounted
  global.elo        = round(totalWeightedElo / totalRounds)
```

Only identities with `totalRounds > 0` get a global entry.

---

## Suspicion Scoring

Rolling window of the last 50 rounds per player per game. Five weighted rules:

| Rule | Condition | Weight |
|------|-----------|--------|
| `guess-accuracy` | `hits / guesses > 0.40` | +30 |
| `win-rate` | `wins / Σ(1/N) > 2.5` | +25 |
| `first-hit-latency` | median `firstHitMs < 3000` (min 20 samples) | +25 |
| `target-find-rate` | `targets / Σ(1/N) > 2.5` | +15 |
| `points-per-guess` | `(points - targetBonuses) / guesses > 2500` | +5 |

**Minimum window size:** 50 rounds before any rules fire. Newly deployed systems will show `score: 0` until enough rounds accumulate.

---

## Endpoints

### Game Servers → Report Round Results

```http
POST /api/elo/update
Headers:
  x-api-key: <GAME_API_SECRET>
  Content-Type: application/json
```

**Body:**
```json
{
  "game": "wikisearchle",
  "participants": [
    {
      "identityKey": "discord:123456789012345678",
      "points": 100,
      "rank": 1,
      "rankOutOf": 5,
      "guesses": 12,
      "hits": 5,
      "firstHitMs": 3200,
      "wonRound": true,
      "foundTarget": false,
      "articleTitle": "Coptic Orthodox Church"
    }
  ]
}
```

**Response:** `{"ok": true, "updated": 5}`

### Public Leaderboards

```http
GET /api/elo/:game/leaderboard?limit=25&sort=elo
```

- `game` — `wikisearchle`, `searchle`, `erectangled`, `rectangled`
- `sort` — `elo` (default) or `rounds`
- `limit` — 1 to 100, default 25
- Filter: only players with `roundsCounted >= 5`

```http
GET /api/elo/global/leaderboard?limit=25
```

- Filter: only players with `totalRounds >= 5`

### Admin — Cheater Panel

```http
GET /api/elo/cheaters?minScore=50&game=wikisearchle
Headers:
  x-api-key: <GAME_API_SECRET>
```

- `minScore` — default 50
- `game` — optional, sorts by that game's score

### Admin — Player Profile

```http
GET /api/elo/player/:identityKey
Headers:
  x-api-key: <GAME_API_SECRET>
```

Returns per-game ELOs, global ELO, and suspicion data for the identity.

---

## Identity Keys

All games normalize players to the same key format before reporting:

| Source | Key Format | Example |
|--------|-----------|---------|
| Discord-linked | `discord:<discordId>` | `discord:123456789012345678` |
| Web/platform auth | `<platform>:<platformUserId>` | `web:abc123`, `tiktok:xyz789` |
| Anonymous / nickname-only | `nick:<lowercase_name>` | `nick:anon82` |

**Important:** When a player links Discord, their old `nick:` ELO does **not** migrate. They start fresh at 1200 under the `discord:` key. This prevents gaming the system by creating anonymous accounts and then linking Discord to consolidate inflated ratings.

---

## Files

| File | Purpose |
|------|---------|
| `src/routes/elo.js` | Route definitions, ELO math, suspicion engine |
| `data/elo-ratings.json` | All ELO ratings (per-game + global) |
| `data/suspicion-scores.json` | Suspicion windows and scores |
| `server.js` | `registerEloRoutes(app, { requireApiKey })` |

---

## Deployment

```bash
# Local → server
rsync -avz src/routes/elo.js deploy@178.156.171.251:/opt/word-tycoon/src/routes/elo.js
# server.js already has: registerEloRoutes(app, { requireApiKey });
pm2 reload mobile-tycoon --update-env
```
