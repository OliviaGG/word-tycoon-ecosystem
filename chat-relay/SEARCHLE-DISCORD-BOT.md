# Searchle Discord Companion Bot

This is a separate Discord bot identity from the main relay bot.

It lives inside Chat Relay so it can reuse:
- the shared word bank
- the existing SQL.js persistence
- Word Tycoon account-link flows
- the internal Searchle server for semantic scoring

## Env Vars

- `SEARCHLE_DISCORD_BOT_TOKEN`
  Companion bot token. If unset, the bot does not start.
- `SEARCHLE_DISCORD_BOT_GUILD_ID`
  Optional. If set, slash commands register only in this guild for faster dev iteration.
- `SEARCHLE_DISCORD_LINK_URL`
  Optional override for the account-link URL.
  Default: `https://wordtycoon.live/auth/discord`
- `SEARCHLE_INTERNAL_URL`
  Optional override for the internal Searchle server.
  Default: `http://localhost:3015`
- `GAME_API_SECRET`
  Shared internal API key used for the Searchle scoring endpoint.

## Slash Commands

- `/searchle daily`
  Show today's Searchle server puzzle.
- `/searchle guess <word>`
  Submit a guess for today's guild puzzle.
- `/searchle leaderboard`
  Show today's guild leaderboard.
- `/searchle link`
  Open the Word Tycoon account-link/login flow.

## Persistence

Stored in Chat Relay's SQL.js database:

- `searchle_discord_daily_puzzles`
- `searchle_discord_guesses`

Leaderboard sorting:
1. solved first
2. lowest best rank
3. fewer attempts
4. earlier first guess

## Searchle Scoring

The bot does not fake Searchle rankings.

It calls the private internal endpoint:

- `POST /api/discord-bot/searchle/evaluate`

on the local Searchle server, authenticated with `GAME_API_SECRET`.

That endpoint:
- normalizes guesses with the same singular/British-American logic as Searchle
- validates against Searchle's vocabulary
- computes the real semantic rank for the supplied target word

## Notes

- The bot currently uses the deterministic word-bank daily target for game id `searchle-discord`.
- This keeps the Discord daily separate from the public Searchle site daily/weekly flows.
- The relay bot and Searchle companion bot can run side-by-side with separate Discord applications.
