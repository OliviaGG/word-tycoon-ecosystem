# Word Tycoon Ecosystem

The full source of [Word Tycoon](https://wordtycoon.live/): a set of word games built for live streams, where TikTok, YouTube and Discord chat play together. It includes a shared economy (coins, cosmetics, businesses) and a central chat hub.

Free and open source under the [MIT License](LICENSE).

## How it fits together

```
 TikTok / YouTube / Discord chat
              │
        ┌─────▼──────┐        ┌──────────────┐
        │ chat-relay │◄──────►│ word-tycoon  │  accounts, coins, cosmetics,
        │  :3000     │        │  :3020       │  reward/deduct API
        └─────┬──────┘        └──────▲───────┘
   Socket.IO  │  proxies every game page   │ GAME_API_SECRET
     ┌────────┼─────────┬──────────┬───────┘
  searchle  wordle  rectangled  word500 … (each game is its own Node server)
```

- **chat-relay** is the hub. It takes in chat from each platform, normalizes it, proxies all the game pages and owns the shared word bank (`/api/word-bank/*`). Start it first.
- **word-tycoon** is the economy service: accounts, coins, cosmetics and businesses. The games call it to give out rewards.
- **Games** each connect to chat-relay over Socket.IO and serve their own pages. Once the two core services are up, they can start in any order.

| Folder | Game | Default port |
|---|---|---|
| `chat-relay` | Hub, portal, overlays | 3000 |
| `word-tycoon` | Economy API and app | 3020 |
| `searchle` | Searchle (semantic guessing) | 3015 |
| `wikisearchle` | WikiSearchle | 3029 |
| `rectangled` | RecTangled (word grid) | 3016 |
| `erectangled` | eRecTangled / Sproutle | 3023 |
| `wikirectangled` | WikiRecTangled | 3031 |
| `word500` | Word500 | 3006 |
| `word1000` | Word1000 | 3018 |
| `wordle` | Wordle multiplayer | 3003 |
| `unwordle` | UnWordle | 3021 |
| `pixeletters` | PixeLetters | see `server.js` |
| `spellingbee` | SpellingBee | 3013 |
| `figural` | Figural | 3019 |
| `betwixt` | Betwixt | 3017 |
| `triangled` | Triangled | 3024 |
| `wordmine` | WordMine | see `server.js` |
| `colour500` | Colour500 | 3033 |

## Running it locally

Requirements: Node.js 20 or newer.

```bash
# 1. core services
cd chat-relay && cp .env.example .env && npm install && npm start
cd word-tycoon && cp .env.example .env && npm install && npm start

# 2. any game
cd wordle && cp .env.example .env && npm install && npm start

# searchle needs a client build first
cd searchle && npm install && npm run build && npm start
```

Each folder's `.env.example` lists every environment variable that service reads. Most can be left empty. The important ones:

- `GAME_API_SECRET` must be the **same value** in word-tycoon, chat-relay and every game. Generate one with `openssl rand -hex 32`.
- `SESSION_SECRET` (chat-relay) and `LOOT_SECRET` (word-tycoon) should be set to stable random values. Otherwise a random one is generated on each start, which logs everyone out and changes daily loot rolls.
- Platform credentials (Discord, Spotify, TikTok, Google/GitHub OAuth, Stripe) are only needed for the features that use them.

Daily puzzles roll over on `America/Edmonton` time. Domain names such as `wordtycoon.live` are hardcoded in a few places; search and replace them for your own deployment.

## What's not included

- Player data, databases, live game state and backups
- Production secrets and deployment/infra configuration
- Android signing keys and store assets

## License

MIT. See [LICENSE](LICENSE). Word lists and Wikipedia-derived data keep their original sources' terms (Wikipedia content is CC BY-SA).
