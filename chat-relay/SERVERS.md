# Game Server Operations Guide

## Server Inventory

| Server | Directory | Port | Data Storage | Shutdown Risk |
|--------|-----------|------|-------------|---------------|
| Chat Relay | `C:\Chat Relay` | 3000 | sql.js (saves on every write) | Medium |
| My Bubble | `C:\My Bubble` | 3001 | None (in-memory only) | Low |
| Interactive Squaredle | `C:\Interactive Squaredle` | 3001 | None (static file server) | None |
| SpellingBee | `C:\SpellingBee` | 3002 | JSON files (current game, player stats, saved games) | Low |
| Wordle | `C:\Wordle` | 3003 | JSON file (winners.json) | Low |
| Word500 | `C:\Word500` | 3006 | JSON files (win-history + backup) | Low |
| Searchle 3.0 | `C:\Searchle 3.0` | 3015 | JSON files (game-state, played-words, win-history + backup) | Low |
| Betweenle | `C:\Betweenle` | 3017 | JSON files (game-state, history + backup) | Low |
| WiPGaMe (Word Empires) | `C:\WiPGaMe` | 3020 | sql.js + Redis + backup system | High |
| PixeLetters | `C:\PixeLetters` | ~3100 | sql.js (saves on every write) | Low |

**Port conflict:** My Bubble and Interactive Squaredle both use port 3001. Only run one at a time.

---

## Architecture Overview

```
                     TikTok (TikFinity)
                           |
                           v
  YouTube (Streamer.bot) --> Chat Relay (3000) <-- Discord Bot
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
        Game Servers      WiPGaMe (3020)    Dashboard/Overlays
        (all games)       (reward engine)
              |                ^
              +----------------+
              (reward requests via HTTP POST)
```

**Chat Relay** is the central hub. All game servers connect to it via Socket.IO to receive chat messages. Game servers also send HTTP reward requests to **WiPGaMe** when players win.

---

## Startup

### Startup Order

Start servers in dependency order:

1. **Chat Relay** (port 3000) - must start first, all others connect to it
2. **WiPGaMe** (port 3020) - start second, handles reward requests from games
3. **All game servers** (any order) - they auto-reconnect to Chat Relay if it's not ready yet

### Starting Individual Servers

From any terminal, run:

```bash
cd "C:\<ServerDirectory>"
node server.js
```

### Starting via Claude Code

All servers are configured in `C:\Chat Relay\.claude\launch.json`. Start any server by name:

```
chat-relay      -> Chat Relay (port 3000)
my-bubble       -> My Bubble (port 3001)
squaredle       -> Interactive Squaredle (port 3001)
spellingbee     -> SpellingBee (port 3002)
wordle          -> Wordle (port 3003)
word500         -> Word500 (port 3006)
searchle        -> Searchle 3.0 (port 3015)
betweenle       -> Betweenle (port 3017)
wipgame         -> WiPGaMe / Word Empires (port 3020)
pixeletters     -> PixeLetters (port ~3100)
```

### What Happens on Startup

Each server performs these steps:

1. **Load data** - Databases initialize, JSON files are read from disk, saved game state is restored
2. **Start HTTP server** - Express (or plain HTTP) begins listening on its port
3. **Connect to Chat Relay** - Socket.IO client connects with auto-reconnection enabled
4. **Ready** - Server logs its URL and status

Servers with game state persistence (Searchle 3.0, SpellingBee, Betweenle, PixeLetters) will restore the previous game if one was in progress. Others (Wordle, Word500) start a fresh game each time.

### Verifying Servers Are Running

Check which ports are active:

```bash
netstat -ano | findstr "LISTENING" | findstr "300[0-9] 301[0-9] 302[0-9] 310[0-9]"
```

Or check a specific port:

```bash
netstat -ano | findstr ":3000 " | findstr "LISTENING"
```

---

## Shutdown

### Graceful Shutdown Behavior

Every server has a SIGINT/SIGTERM handler that performs these steps:

1. **Prevents double-shutdown** - A guard flag ignores repeated Ctrl+C presses
2. **Saves persistent data** - Databases are flushed to disk, game state is written to JSON files
3. **Disconnects external clients** - Socket.IO and WebSocket connections are closed cleanly
4. **Closes the HTTP server** - Stops accepting new connections
5. **Exits cleanly** - `process.exit(0)`

### Shutdown Order

Shut down in **reverse dependency order** - games first, infrastructure last:

1. **All game servers first** (any order) - SpellingBee, Wordle, Word500, Searchle 3.0, Betweenle, PixeLetters, Interactive Squaredle, My Bubble
2. **WiPGaMe second** - creates a pre-shutdown backup and JSON snapshot
3. **Chat Relay last** - sends SIGTERM to any child app processes, then exits

### How to Shut Down

**From the terminal (recommended):**

Press `Ctrl+C` in the terminal where the server is running. This sends SIGINT and triggers the graceful shutdown handler.

You will see output like:

```
[ServerName] Shutting down...
[ServerName] Database saved        (if applicable)
[ServerName] Game state saved      (if applicable)
[ServerName] Shutdown complete
```

**By process ID:**

```bash
# Find the PID
netstat -ano | findstr ":3000 " | findstr "LISTENING"

# Graceful shutdown (sends SIGTERM, triggers handler)
taskkill /PID <pid>

# Or in PowerShell
Stop-Process -Id <pid>
```

### What NOT to Do

- **Never use `taskkill /F`** (force kill) on WiPGaMe or Chat Relay - this skips their shutdown handlers
- **Never use `kill -9`** on any server with data persistence - it bypasses the save step
- **Never shut down Chat Relay before the game servers** - game servers will lose their relay connection and may behave unexpectedly until they reconnect

### What Each Server Saves on Shutdown

| Server | Saves on Shutdown |
|--------|------------------|
| Chat Relay | sql.js database, kills child app processes, disconnects Discord bot |
| WiPGaMe | Pre-shutdown backup, JSON snapshot of all players, Redis cleanup |
| PixeLetters | sql.js database |
| Searchle 3.0 | Game state (target word, guesses), played words list |
| SpellingBee | Current game state, player stats |
| Wordle | Winners leaderboard |
| Word500 | (nothing extra - win history is saved on every game event) |
| Betweenle | Game state (secret word, bounds, guesses), win history |
| Interactive Squaredle | Closes SSE client connections |
| My Bubble | Closes relay + TikFinity + Streamer.bot connections |

---

## Troubleshooting

### Server won't start - port already in use

Find what's using the port and stop it:

```bash
netstat -ano | findstr ":3000 " | findstr "LISTENING"
# Note the PID (last column)

# Check what process it is
powershell -Command "Get-Process -Id <PID> | Select-Object ProcessName,Id,Path"

# Gracefully stop it
taskkill /PID <PID>
```

### Game server can't connect to Chat Relay

All game servers auto-reconnect. If Chat Relay is down, you'll see periodic "connection error (will retry)" messages. Once Chat Relay starts, they reconnect automatically. No action needed.

### Data appears lost after restart

- **Wordle / Word500 / My Bubble**: These don't persist game state between restarts. A new game starts each time. Win history (Wordle, Word500) is preserved.
- **Searchle 3.0 / SpellingBee / Betweenle / PixeLetters**: These restore game state from disk. If data is missing, check the `data/` directory in each project for JSON or `.db` files.
- **WiPGaMe**: Has comprehensive backups in `data/backups/`. Subdirectories: `rolling/` (every 5 min, last 10), `hourly/` (last 24), `daily/` (last 30), `startup/`, `pre-shutdown/`.

### WiPGaMe backup restore

If WiPGaMe data needs to be restored from a backup:

```bash
cd "C:\WiPGaMe"
# List available backups
ls data/backups/pre-shutdown/
ls data/backups/hourly/
ls data/backups/daily/

# The backup files are SQLite database snapshots
# Copy the desired backup to the main database path
cp data/backups/pre-shutdown/<timestamp>.db data/word-empires.db
```
