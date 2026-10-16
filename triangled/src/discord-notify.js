/**
 * Discord Notification Module
 *
 * Sends puzzle + image options to the admin via Discord bot.
 *
 * Admin gets one or more puzzle-image pairs and picks a numbered option.
 */

const path = require('path');
const daily = require('./daily');

const PUZZLES_DIR = path.join(__dirname, '..', 'data', 'puzzles');

let ioServer = null;

function init(io) {
  ioServer = io;

  io.on('connection', (socket) => {
    socket.on('triangled-puzzle-decision', (data) => {
      const { date, puzzleChoice, imageChoice } = data;
      console.log(`[Discord] Admin chose puzzle ${puzzleChoice}, image ${imageChoice} for ${date}`);

      if (puzzleChoice) {
        daily.selectPuzzleAndImage(date, puzzleChoice, imageChoice || 1);
      }
    });
  });
}

/**
 * Send all puzzle + image options for admin review.
 */
function sendForReview(date) {
  if (!ioServer) {
    console.warn('[Discord] IO server not initialized');
    return false;
  }

  const record = daily.getPuzzleForDate(date);
  if (!record) {
    console.warn(`[Discord] No puzzle found for ${date}`);
    return false;
  }

  const puzzleOptions = record.puzzleOptions || [];
  const imageOpts = record.imageOptions || [];
  const numberEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

  // Build message
  const lines = [
    `**Triangled Daily Puzzle — ${date}**`,
    ''
  ];

  // List each puzzle option (each paired with its image)
  for (let i = 0; i < puzzleOptions.length; i++) {
    const p = puzzleOptions[i];
    const num = numberEmoji[i] || `${i + 1}.`;
    const hasImg = imageOpts[i] ? '  (image attached)' : '';
    lines.push(`${num} **${p.theme}** — *"${p.themeHint}"*${hasImg}`);
    lines.push(`> Spangram: ||${p.spangram}||`);
    lines.push(`> Words: ||${p.words.join(', ')}||`);
    lines.push('');
  }

  if (puzzleOptions.length === 1) {
    lines.push('React 1️⃣ to approve this puzzle and its matching image.');
  } else {
    lines.push('Each number picks both the puzzle AND its matching image.');
    lines.push(`React ${numberEmoji.slice(0, puzzleOptions.length).join(', ')} to choose.`);
  }

  // Collect image file paths
  const imageFiles = imageOpts.filter(Boolean).map(f => path.join(PUZZLES_DIR, f));

  ioServer.to('triangled-review-admin').emit('triangled-puzzle-review', {
    date,
    message: lines.join('\n'),
    puzzleCount: puzzleOptions.length,
    imageFiles
  });

  console.log(`[Discord] Sent ${puzzleOptions.length} puzzles + ${imageFiles.length} images for ${date}`);
  return true;
}

module.exports = { init, sendForReview };
