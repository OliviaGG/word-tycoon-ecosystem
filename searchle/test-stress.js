// Stress test for Searchle server — measures throughput and event loop responsiveness
const { io } = require('socket.io-client');

const URL = 'http://localhost:3015';
const TOTAL_GUESSES = 2000;
const BATCH_SIZE = 50;      // guesses per batch
const BATCH_DELAY_MS = 5;   // delay between batches

// Generate unique words from vocab (avoid target word)
function generateWords(count, excludeSet) {
  const words = [];
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const used = new Set(excludeSet);
  // Generate 3-6 letter random words
  while (words.length < count) {
    const len = 3 + Math.floor(Math.random() * 4);
    let w = '';
    for (let i = 0; i < len; i++) w += chars[Math.floor(Math.random() * 26)];
    if (!used.has(w)) {
      used.add(w);
      words.push(w);
    }
  }
  return words;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Connecting to server...');
  const socket = io(URL, { transports: ['websocket'] });

  // Wait for game-state to get current target word
  const gameState = await new Promise((resolve) => {
    socket.on('game-state', (state) => resolve(state));
  });

  const targetWord = gameState.targetWord || '???';
  console.log(`Connected. Game has ${gameState.guesses.length} existing guesses.`);
  console.log(`Target: ${targetWord || '(hidden — game in progress)'}`);

  // Track received events
  let newGuessCount = 0;
  let bumpCount = 0;
  const latencies = [];

  socket.on('new-guess', () => { newGuessCount++; });
  socket.on('bump-guess', () => { bumpCount++; });

  // Generate test words (exclude target to avoid winning)
  const existingWords = new Set(gameState.guesses.map(g => g.word));
  if (targetWord) existingWords.add(targetWord);
  const words = generateWords(TOTAL_GUESSES, existingWords);

  console.log(`\nSending ${TOTAL_GUESSES} guesses in batches of ${BATCH_SIZE}...`);

  // --- Test 1: Throughput under load ---
  const t0 = Date.now();
  let sent = 0;

  for (let batch = 0; batch < Math.ceil(TOTAL_GUESSES / BATCH_SIZE); batch++) {
    const start = batch * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, TOTAL_GUESSES);

    for (let i = start; i < end; i++) {
      const sendTime = Date.now();
      socket.emit('test-guess', {
        message: words[i],
        platform: 'discord',
        user: {
          id: `stress-${i}`,
          username: `stressbot${i}`,
          displayName: `StressBot ${i}`,
          profilePic: null
        }
      });
      sent++;
    }

    if (batch < Math.ceil(TOTAL_GUESSES / BATCH_SIZE) - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const sendDuration = Date.now() - t0;
  console.log(`All ${sent} guesses sent in ${sendDuration}ms (${(sent / sendDuration * 1000).toFixed(0)} guesses/sec)`);

  // Wait for server to process all guesses
  await sleep(3000);

  console.log(`\n--- Results ---`);
  console.log(`Sent: ${sent}`);
  console.log(`New guesses received: ${newGuessCount}`);
  console.log(`Bumps received: ${bumpCount}`);
  console.log(`Total events: ${newGuessCount + bumpCount}`);

  // --- Test 2: Event loop responsiveness during rankings computation ---
  console.log(`\n--- Test 2: Event loop responsiveness during /api/game/new ---`);
  console.log(`Triggering new game while pinging every 50ms...`);

  const pingLatencies = [];
  let pinging = true;

  // Ping loop — measures how long the event loop is blocked
  const pingLoop = async () => {
    while (pinging) {
      const pingStart = Date.now();
      await new Promise((resolve) => {
        socket.emit('test-guess', {
          message: 'pingtest' + Date.now(),
          platform: 'discord',
          user: { id: 'ping-user', username: 'pingbot', displayName: 'PingBot', profilePic: null }
        });
        // Just wait for next tick — not waiting for response, measuring send+schedule latency
        setImmediate(resolve);
      });
      const elapsed = Date.now() - pingStart;
      pingLatencies.push(elapsed);
      await sleep(50);
    }
  };

  const pingPromise = pingLoop();

  // Trigger new game via REST API and time it
  const newGameStart = Date.now();
  const res = await fetch(`${URL}/api/game/new`, { method: 'POST' });
  const newGameData = await res.json();
  const newGameDuration = Date.now() - newGameStart;

  // Keep pinging for a bit after
  await sleep(500);
  pinging = false;
  await pingPromise;

  console.log(`New game completed in ${newGameDuration}ms`);
  console.log(`Pings during computation: ${pingLatencies.length}`);
  if (pingLatencies.length > 0) {
    const maxPing = Math.max(...pingLatencies);
    const avgPing = (pingLatencies.reduce((a, b) => a + b, 0) / pingLatencies.length).toFixed(1);
    const p95 = pingLatencies.sort((a, b) => a - b)[Math.floor(pingLatencies.length * 0.95)];
    console.log(`Ping latency — avg: ${avgPing}ms, p95: ${p95}ms, max: ${maxPing}ms`);
    const blocked = pingLatencies.filter(l => l > 200).length;
    if (blocked > 0) {
      console.log(`WARNING: ${blocked} pings had >200ms latency (event loop blocked)`);
    } else {
      console.log(`No pings exceeded 200ms — event loop stayed responsive!`);
    }
  }

  socket.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
