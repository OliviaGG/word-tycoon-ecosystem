# Word Tycoon Documentation

## Systems

| Doc | What |
|-----|------|
| [`ELO.md`](ELO.md) | Centralized ELO + global leaderboards + suspicion engine |
| [`INTEGRATION.md`](INTEGRATION.md) | How game servers connect to Word Tycoon |
| [`STREAKS.md`](STREAKS.md) | Daily claim streaks, milestones, and Discord command |

## Quick Reference

- **Port:** 3020
- **PM2:** `mobile-tycoon`
- **Server:** `178.156.171.251`
- **Deploy path:** `/opt/word-tycoon/`
- **Auth header:** `x-api-key: <GAME_API_SECRET>`

## Recent Changes (2026-04)

### Guest/Anonymous Player Filtering
Auto-generated guest IDs (`web_guest_*`, `guest_*`, `anon_*`, `wsguest_*`, `guest-*`) no longer create persistent player records. Guests can still play and see in-game reward celebrations, but stats are session-only. Existing guest rows were purged from the DB.

### Streak Display on GOAT Leaderboard
Daily claim streaks now appear on the GOAT leaderboard. Each player card shows current streak + longest streak. Discord `!streak` command added.

### Region Settings
Players can set their country flag via Discord OAuth auto-detection or manual override (`POST /api/player/region`). 7-day cooldown between changes.

### Admin Suspended Mode
Admin panel shows "Suspended only" toggle. Suspended players are dimmed and marked with ⊘ badge.

### Linked Account Deduplication
GOAT leaderboard groups linked accounts (Discord/web/mobile with matching IDs) into single entries. Manual exceptions supported (e.g., Isaac GitHub ↔ TikTok).
