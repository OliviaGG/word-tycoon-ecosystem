const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GLOVE_FILE = path.join(__dirname, '..', 'data', 'glove', 'glove.6B.50d.txt');
const TARGET_WORDS_FILE = path.join(__dirname, '..', 'data', 'target-words.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'vocabulary.json');

if (!fs.existsSync(GLOVE_FILE)) {
  console.error(`GloVe file not found at ${GLOVE_FILE}`);
  console.error('Run "npm run download:glove" first.');
  process.exit(1);
}

async function main() {
  console.log('Loading target words...');
  const targetWords = JSON.parse(fs.readFileSync(TARGET_WORDS_FILE, 'utf-8'));
  const targetSet = new Set(targetWords);
  console.log(`  ${targetWords.length} target words loaded.`);

  console.log(`\nParsing ${GLOVE_FILE}...`);
  const words = {};
  let totalLines = 0;
  let accepted = 0;
  let skipped = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(GLOVE_FILE, 'utf-8'),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    totalLines++;
    if (totalLines % 50000 === 0) {
      process.stdout.write(`\r  Processed ${totalLines.toLocaleString()} lines, kept ${accepted.toLocaleString()} words`);
    }

    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;

    const word = line.substring(0, spaceIdx);

    // Filter: purely alphabetic, lowercase, at least 2 chars
    if (word.length < 2) { skipped++; continue; }
    if (!/^[a-z]+$/.test(word)) { skipped++; continue; }

    const vectorStr = line.substring(spaceIdx + 1);
    const vector = vectorStr.split(' ').map(Number);

    if (vector.length !== 50) { skipped++; continue; }

    words[word] = vector;
    accepted++;
  }

  console.log(`\r  Processed ${totalLines.toLocaleString()} lines, kept ${accepted.toLocaleString()} words`);
  console.log(`  Skipped ${skipped.toLocaleString()} entries (non-alphabetic, too short, etc.)`);

  // Validate target words
  const missing = [];
  for (const tw of targetWords) {
    if (!words[tw]) {
      missing.push(tw);
    }
  }

  if (missing.length > 0) {
    console.warn(`\n  WARNING: ${missing.length} target word(s) NOT found in vocabulary:`);
    console.warn(`  ${missing.join(', ')}`);
    console.warn('  These words will not work as game targets. Remove them from target-words.json.');
  } else {
    console.log(`\n  All ${targetWords.length} target words are present in the vocabulary.`);
  }

  // Write output
  console.log(`\nWriting ${OUTPUT_FILE}...`);
  const output = {
    dimensions: 50,
    count: accepted,
    words
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));
  const stats = fs.statSync(OUTPUT_FILE);
  console.log(`  Done! vocabulary.json is ${(stats.size / 1024 / 1024).toFixed(1)} MB with ${accepted.toLocaleString()} words.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
