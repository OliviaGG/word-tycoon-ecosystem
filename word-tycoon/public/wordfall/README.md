# Wordfall

Word Tycoon word-finding game with a dimensional CSS board. Trace adjacent
letters in eight directions; accepted tiles disappear and each column falls.

- Practice runs locally with the bundled 3–7-letter fallback list.
- Signed-in solo and daily runs are server-verified, saved per account, and
  challenge players to clear 70 tiles within 18 moves. Daily starts on the same
  seeded board and rotates at Edmonton midnight; completed attempts appear on
  the daily leaderboard.
- Multiplayer has one shared, server-owned board until someone reaches 25,000
  personal points; there is no time limit. Found tiles hold for four seconds,
  with corner timers shifting from green to red as they expire.
  A connected follow-up advances its group's reset duration from four seconds
  to five, then six, seven, and eight, and awards a 200-point/XP extension
  bonus for each new duration tier. Disjoint groups
  keep independent timers, clear, and refill independently. Held tiles remain
  fixed when another group falls. The timer pulses with a `+1s` callout and
  bonus finds display `BONUS XP` in the HUD and payout animation.
  A version check rejects a stale competing trace. A word
  can score again whenever its letters connect on the current board; repeats
  appear as yellow ticker bubbles with an increasing claim count. Invalid
  word guesses appear red, and first finds appear green. All three use
  right-to-left moving bubbles. Red and yellow events get their own lane and
  replay periodically during the round so they are not lost behind green finds.
- Streamer rooms use the same shared-board rules. The stream widget can be
  selected in /streamer and /pro; chat messages that spell a currently visible
  word may claim its path. The latest-word card shows the word's awarded XP
  above that finder's resulting Word Tycoon total, including on the render1 OBS
  widget without requiring a browser sign-in session. Each traced letter emits
  its share of the actual XP reward toward that total; the flight is deliberately
  paced so each letter can be followed, with extension XP shown separately.

The server lives in `C:\Chat Relay\src\wordfall.js`. It loads the canonical
Word Bank targets and uses `game-shared.js` RecTangled letter-rarity and
length bonuses. Valid words are reported to the Word Tycoon Library; eligible
wins receive idempotent XP rewards and appear in GOAT win stats. The frontend
loads the shared cosmetic effects/visibility settings as RecTangled does.

The server owns all ranked state. `words.js` remains a bundled fallback for
local practice when the relay is unavailable. The browser core and relay core
must stay in sync, apart from the relay's empty initial word list (it receives
the live Word Bank at startup).

Tests: `node --test test/wordfall.test.js` here, and
`node --test test/wordfall.test.js` in Chat Relay. The local connected preview
can run with `node test/wordfall-preview-server.js` from Chat Relay; it uses
mock accounts and rewards only.
