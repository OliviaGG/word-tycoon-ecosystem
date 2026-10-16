# Word Tycoon Ecosystem — Master Reference

> Cross-referenced by all game apps. Single source of truth for ports, paths, and procedures.

---

## Startup Order

1. **Chat Relay** (port 3000) — MUST start first
2. **Word Tycoon** (port 3020) — start second (accounts, cosmetics, economy)
3. **All game servers** (any order) — they auto-reconnect to Chat Relay

---

## Core Services

| Service | Port | PM2 Name | Deploy Path | Public URL |
|---------|------|----------|-------------|------------|
| Chat Relay | 3000 | mobile-relay | /opt/chat-relay/ | https://wordtycoon.live/ |
| Word Tycoon | 3020 | mobile-tycoon | /opt/word-tycoon/ | N/A (API only) |

## Game Servers

| Game | Port | PM2 Name | Deploy Path | Public URL |
|------|------|----------|-------------|------------|
| My Bubble | 3010 | — | — | N/A |
| Word500 | 3011 | word500 | /opt/word500/ | /word500/ |
| PixeLetters | 3012 | pixeletters | /opt/pixeletters/ | /pixeletters-multi/ |
| SpellingBee | 3013 | spellingbee | /opt/spellingbee/ | /spellingbee-multi/ |
| Wordle | 3014 | wordle | /opt/wordle/ | /wordle-multi/ |
| Searchle | 3015 | searchle-mobile | /opt/searchle/ | /searchle/ |
| RecTangled | 3016 | rectangled | /opt/rectangled/ | /rectangled-multi/ |
| Betweenly | 3017 | betweenly | /opt/betweenly/ | /betweenly-multi/ |
| Word1000 | 3018 | word1000 | /opt/word1000/ | /word1000/ |
| Figural | 3019 | figural | /opt/figural/ | /figural-multi/ |
| UnWordle | 3021 | unwordle | /opt/unwordle/ | /unwordle-multi/ |
| WordMine | 3022 | wordmine | /opt/wordmine/ | /wordmine-multi/ |
| eRectAngled | 3023 | erectangled | /opt/sproutle/ | /erectangled-multi/ |
| StreamDeck | 3025 | — | /opt/streamdeck/ | N/A |
| Discord Bot | 3026 | discord-bot | (in chat-relay) | N/A |
| Arcade | 3028 | arcade | /opt/arcade/ | /arcade/ |
| Monopoly | 3030 | — | /opt/monopoly/ | /monopoly/ |

> Public URLs resolve to `https://wordtycoon.live/<path>`. Do NOT use `/game/<id>/` URLs publicly.

---

## Architecture

- All games connect TO Chat Relay on startup via `socket.io-client`
- Chat Relay proxies game pages internally via `/game/:id/` reverse proxy
- Word bank (targets, dictionary, frequency) served at `/api/word-bank/*`
- Shared game module: `src/game-shared.js` — rewards, library words, cosmetics
- Unified win overlay: `https://wordtycoon.live/win-overlay` (1080x1920 portrait OBS source)

### Socket.IO Events
- **To games:** `chat-message`, `engagement`, `frenzy-update`, `cosmetics-updated`
- **From games:** `app-register` (handshake: `{ id, name, port }`)
- **Rooms:** `main`, `wordle`, `searchle`, `spellingbee`, `pixeletters`, `word500`, `betweenly`, `squaredle`, `figural`, `unwordle`

---

## Common Commands

```bash
# SSH to production
ssh deploy@wordtycoon.live

# Check all services
pm2 list

# Restart a specific service
pm2 restart <pm2-name>

# Restart everything
pm2 restart all --update-env

# View logs (last 20 lines, no follow)
pm2 logs <pm2-name> --nostream --lines 20

# View error logs only
pm2 logs <pm2-name> --err --nostream --lines 20

# Verify after deploy
pm2 logs --nostream --lines 5

# Reboot droplet
sudo reboot
```

---

## Environment Variables

| Variable | Used By | Default |
|----------|---------|---------|
| `CHAT_RELAY_URL` | All games | `http://localhost:3000` |
| `WORD_TYCOON_URL` | Chat Relay, games | `http://localhost:3020` |
| `WORD_EMPIRES_URL` | Games (same as above) | `http://localhost:3020` |
| `GAME_API_SECRET` | All admin endpoints | set in each service's `/opt/<svc>/.env` on droplet — value in password manager only, no fallback |
| `NODE_ENV` | All services | `production` on server |
| `BRIDGE_RELAY_URL` | Chat Relay | (unset = disabled) |

---

## PM2 Memory Limits

| Service | Limit | Notes |
|---------|-------|-------|
| Searchle | 1800 MB | 2 embedding models (~508 MB normal) |
| RecTangled | 400 MB | Full word list + puzzles (~230 MB base) |
| Word Tycoon | 400 MB | Accounts, economy, cosmetics |
| Chat Relay | 300 MB | Relay, proxy, word bank |
| All other games | 200 MB | Sufficient for standard games |

---

## Admin Access

- **Dashboard:** `https://wordtycoon.live/` (password protected)
- **Game admin pages:** `https://wordtycoon.live/game/<gameId>/admin.html`
- **Searchle admin:** managed via Chat Relay dashboard (no separate admin.html)
- **API key header:** `x-api-key: <value from GAME_API_SECRET env var; retrieve from password manager, never commit to git>`

---

## Security

- All admin HTTP endpoints require `x-api-key` header (or `x-admin-key` / `?adminKey`)
- Chat Relay proxy blocks `/api/admin/` paths from public access
- Socket.IO admin: emit `admin-auth` with key, server sets `socket.isAdmin = true`
- SSL via Let's Encrypt (auto-renew via certbot)

---

## Frequency / Rarity System

Word frequency data served by Chat Relay at `/api/word-bank/frequency`.

| Zipf Range | Rarity | Role |
|------------|--------|------|
| 7.0 - 8.0 | Ultra common | Core gameplay |
| 5.0 - 6.9 | Common | Core gameplay |
| 4.0 - 4.9 | Uncommon | Core gameplay (threshold) |
| < 4.0 | Rare | Bonus words |
| No data | Hidden | Ultra rare bonus |

Common threshold: Zipf >= 4.0. Games complete when all common words are found.

---

## Win Overlay

- OBS source: `https://wordtycoon.live/win-overlay` (1080x1920 portrait)
- Games emit `game-win` via relay socket; Chat Relay forwards to `win-overlay` room
- **Integrated:** Wordle, Betweenly, Word500, Figural, PixeLetters, RecTangled, SpellingBee, eRectAngled, Searchle
- **Not integrated:** WordMine, Word1000, UnWordle

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Game not loading | `pm2 list` — verify process is running, port matches `apps.json` |
| Admin controls broken | Socket.IO proxy — check `/game/<id>/socket.io/` path |
| Chat not flowing | Chat Relay logs — verify TikFinity / Streamer.bot connections |
| Frequency data stale | Restart game server (fetches on startup from Chat Relay) |
| Win overlay blank | Verify game emits `game-win`, check relay socket connection |
| Deploy permission denied | Monopoly: `sudo chown -R deploy:deploy /opt/monopoly/src/` |

---

## Deploy Checklist

1. SCP files to `deploy@wordtycoon.live:/opt/<service>/`
2. SSH in and `pm2 restart <pm2-name> --update-env`
3. `pm2 logs <pm2-name> --nostream --lines 5` — verify no errors
4. Test public URL in browser
