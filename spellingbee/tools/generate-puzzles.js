#!/usr/bin/env node
// Generate 100 themed Spelling Bee puzzles from the dictionary
// Usage: node tools/generate-puzzles.js

const wordList = require('an-array-of-english-words');
const fs = require('fs');
const path = require('path');

// Filter to valid spelling bee words: 4+ letters, only lowercase a-z
const words = wordList.filter(w => w.length >= 4 && w.length <= 15 && /^[a-z]+$/.test(w));
console.log(`Dictionary: ${words.length} valid words`);

// Find all pangrams (words with exactly 7 unique letters)
const pangrams = words.filter(w => new Set(w).size === 7);
console.log(`Found ${pangrams.length} pangrams`);

// For each pangram, find the best center letter
function getValidWords(letters, center) {
  const letterSet = new Set(letters);
  return words.filter(w => {
    if (!w.includes(center)) return false;
    for (const ch of w) {
      if (!letterSet.has(ch)) return false;
    }
    return true;
  });
}

// Curated pangram → theme/name mapping
const THEMED_PANGRAMS = [
  { pangram: 'kitchen', theme: 'Cooking', name: 'Kitchen Creations' },
  { pangram: 'dolphin', theme: 'Ocean', name: 'Dolphin Bay' },
  { pangram: 'blanket', theme: 'Home', name: 'Cozy Blanket' },
  { pangram: 'country', theme: 'Geography', name: 'Country Roads' },
  { pangram: 'bowling', theme: 'Sports', name: 'Bowling Alley' },
  { pangram: 'chapter', theme: 'Books', name: 'Next Chapter' },
  { pangram: 'weather', theme: 'Climate', name: 'Weather Watch' },
  { pangram: 'picture', theme: 'Art', name: 'Picture Perfect' },
  { pangram: 'flowers', theme: 'Garden', name: 'Flower Garden' },
  { pangram: 'outside', theme: 'Nature', name: 'Great Outdoors' },
  { pangram: 'healthy', theme: 'Fitness', name: 'Healthy Living' },
  { pangram: 'capture', theme: 'Photography', name: 'Perfect Capture' },
  { pangram: 'writing', theme: 'Literature', name: 'Creative Writing' },
  { pangram: 'ancient', theme: 'History', name: 'Ancient World' },
  { pangram: 'mixture', theme: 'Chemistry', name: 'Mix It Up' },
  { pangram: 'journey', theme: 'Travel', name: 'Epic Journey' },
  { pangram: 'shelter', theme: 'Survival', name: 'Safe Shelter' },
  { pangram: 'morning', theme: 'Time', name: 'Morning Light' },
  { pangram: 'mothers', theme: 'Family', name: 'Mother Knows Best' },
  { pangram: 'plastic', theme: 'Materials', name: 'Plastic World' },
  { pangram: 'culture', theme: 'Society', name: 'Pop Culture' },
  { pangram: 'kingdom', theme: 'Fantasy', name: 'Lost Kingdom' },
  { pangram: 'subject', theme: 'Education', name: 'Study Subject' },
  { pangram: 'playing', theme: 'Games', name: 'Game Night' },
  { pangram: 'resting', theme: 'Relaxation', name: 'Rest Easy' },
  { pangram: 'fishing', theme: 'Hobbies', name: 'Gone Fishing' },
  { pangram: 'problem', theme: 'Science', name: 'Problem Solver' },
  { pangram: 'fashion', theme: 'Style', name: 'High Fashion' },
  { pangram: 'mustard', theme: 'Food', name: 'Mustard Seed' },
  { pangram: 'hosting', theme: 'Events', name: 'Perfect Host' },
  { pangram: 'quilted', theme: 'Crafts', name: 'Quilted Art' },
  { pangram: 'wonders', theme: 'Exploration', name: 'World Wonders' },
  { pangram: 'explain', theme: 'Learning', name: 'Explain It' },
  { pangram: 'counter', theme: 'Kitchen', name: 'Counter Culture' },
  { pangram: 'plumber', theme: 'Trades', name: 'Pipe Dreams' },
  { pangram: 'twinkle', theme: 'Stars', name: 'Twinkle Star' },
  { pangram: 'migrate', theme: 'Birds', name: 'Bird Migration' },
  { pangram: 'vibrate', theme: 'Physics', name: 'Good Vibes' },
  { pangram: 'organic', theme: 'Farming', name: 'Organic Farm' },
  { pangram: 'storage', theme: 'Organization', name: 'Storage Wars' },
  { pangram: 'mindful', theme: 'Wellness', name: 'Mindful Living' },
  { pangram: 'planted', theme: 'Gardening', name: 'Freshly Planted' },
  { pangram: 'mineral', theme: 'Geology', name: 'Mineral Rich' },
  { pangram: 'trading', theme: 'Business', name: 'Trading Floor' },
  { pangram: 'explore', theme: 'Adventure', name: 'Wild Explorer' },
  { pangram: 'protein', theme: 'Nutrition', name: 'Protein Power' },
  { pangram: 'curtain', theme: 'Theater', name: 'Curtain Call' },
  { pangram: 'bravely', theme: 'Courage', name: 'Brave Heart' },
  { pangram: 'journal', theme: 'Writing', name: 'Daily Journal' },
  { pangram: 'complex', theme: 'Math', name: 'Complex Numbers' },
  { pangram: 'whisker', theme: 'Cats', name: 'Cat Whiskers' },
  { pangram: 'blazing', theme: 'Fire', name: 'Blazing Trail' },
  { pangram: 'jukebox', theme: 'Music', name: 'Jukebox Hero' },
  { pangram: 'wrinkle', theme: 'Aging', name: 'Time Wrinkle' },
  { pangram: 'crumble', theme: 'Baking', name: 'Sweet Crumble' },
  { pangram: 'whistle', theme: 'Sound', name: 'Steam Whistle' },
  { pangram: 'praying', theme: 'Faith', name: 'Quiet Prayer' },
  { pangram: 'bouncer', theme: 'Nightlife', name: 'Night Bouncer' },
  { pangram: 'furnace', theme: 'Winter', name: 'Warm Furnace' },
  { pangram: 'scarlet', theme: 'Colors', name: 'Scarlet Red' },
  { pangram: 'wrangle', theme: 'Cowboys', name: 'Ranch Wrangler' },
  { pangram: 'sparkle', theme: 'Gems', name: 'Diamond Sparkle' },
  { pangram: 'minster', theme: 'Architecture', name: 'Grand Minster' },
  { pangram: 'cluster', theme: 'Space', name: 'Star Cluster' },
  { pangram: 'decrypt', theme: 'Codes', name: 'Code Breaker' },
  { pangram: 'dolphin', theme: 'Marine', name: 'Marine Life' },
  { pangram: 'golfing', theme: 'Sports', name: 'Golf Course' },
  { pangram: 'poultry', theme: 'Farming', name: 'Poultry Farm' },
  { pangram: 'rebuild', theme: 'Construction', name: 'Rebuild Strong' },
  { pangram: 'thawing', theme: 'Spring', name: 'Spring Thaw' },
  { pangram: 'clumped', theme: 'Nature', name: 'Forest Clump' },
  { pangram: 'wasting', theme: 'Environment', name: 'Zero Waste' },
  { pangram: 'quilter', theme: 'Textile', name: 'Master Quilter' },
  { pangram: 'pulsing', theme: 'Rhythm', name: 'Pulse Beat' },
  { pangram: 'shortly', theme: 'Time', name: 'Shortly After' },
  { pangram: 'flighty', theme: 'Aviation', name: 'Flight Path' },
  { pangram: 'clamber', theme: 'Climbing', name: 'Rock Climber' },
  { pangram: 'craving', theme: 'Appetite', name: 'Midnight Craving' },
  { pangram: 'dumpier', theme: 'Weather', name: 'Dumpy Day' },
  { pangram: 'thumbed', theme: 'Gesture', name: 'Thumbs Up' },
  { pangram: 'stumble', theme: 'Movement', name: 'Quick Stumble' },
  { pangram: 'factory', theme: 'Industry', name: 'The Factory' },
  { pangram: 'mouthed', theme: 'Speech', name: 'Spoken Word' },
  { pangram: 'lecturing', theme: 'Teaching', name: 'Grand Lecture' },
  { pangram: 'swiftly', theme: 'Speed', name: 'Swift Runner' },
  { pangram: 'glacier', theme: 'Ice', name: 'Icy Glacier' },
  { pangram: 'touched', theme: 'Emotion', name: 'Deeply Touched' },
  { pangram: 'bracket', theme: 'Tournament', name: 'Final Bracket' },
  { pangram: 'pumpkin', theme: 'Autumn', name: 'Pumpkin Patch' },
  { pangram: 'archive', theme: 'History', name: 'The Archive' },
  { pangram: 'mastery', theme: 'Skills', name: 'Total Mastery' },
  { pangram: 'thicken', theme: 'Cooking', name: 'Thick Sauce' },
  { pangram: 'polished', theme: 'Luxury', name: 'Finely Polished' },
  { pangram: 'miracle', theme: 'Wonder', name: 'Small Miracle' },
  { pangram: 'bowling', theme: 'Leisure', name: 'Strike Zone' },
  { pangram: 'clunked', theme: 'Sound', name: 'Loud Clunk' },
  { pangram: 'plowing', theme: 'Agriculture', name: 'Field Plow' },
  { pangram: 'exhaust', theme: 'Energy', name: 'Full Exhaust' },
  { pangram: 'brought', theme: 'Delivery', name: 'Special Delivery' },
  { pangram: 'violent', theme: 'Storms', name: 'Storm Warning' },
];

// Remove duplicates by pangram
const seen = new Set();
const uniqueThemed = THEMED_PANGRAMS.filter(t => {
  if (seen.has(t.pangram)) return false;
  seen.add(t.pangram);
  return true;
});

console.log(`\nTesting ${uniqueThemed.length} curated pangrams...`);

const results = [];

for (const themed of uniqueThemed) {
  const p = themed.pangram.toLowerCase();

  // Verify it has exactly 7 unique letters
  const unique = [...new Set(p)];
  if (unique.size === 7 || unique.length === 7) {
    // Find best center letter
    let bestCenter = null;
    let bestCount = 0;
    let bestWords = [];

    for (const center of unique) {
      const valid = getValidWords(unique, center);
      // Prefer puzzles with 15-100 words
      if (valid.length >= 15 && valid.length <= 150) {
        if (valid.length > bestCount) {
          bestCenter = center;
          bestCount = valid.length;
          bestWords = valid;
        }
      }
    }

    if (bestCenter) {
      // Shuffle outer letters
      const outer = unique.filter(l => l !== bestCenter);
      for (let i = outer.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [outer[i], outer[j]] = [outer[j], outer[i]];
      }

      results.push({
        id: results.length + 1,
        name: themed.name,
        theme: themed.theme,
        letters: [bestCenter, ...outer],
        centerLetter: bestCenter,
        pangram: p,
        wordCount: bestCount
      });
      console.log(`  #${results.length}: "${themed.name}" (${themed.theme}) — ${p.toUpperCase()} center=${bestCenter.toUpperCase()} — ${bestCount} words`);
    } else {
      console.log(`  SKIP: "${themed.name}" — ${p.toUpperCase()} — no good center letter found`);
    }
  } else {
    console.log(`  SKIP: "${themed.name}" — ${p} — doesn't have exactly 7 unique letters (has ${unique.length})`);
  }
}

// If we have < 100, generate more from random pangrams
if (results.length < 100) {
  console.log(`\nNeed ${100 - results.length} more puzzles. Finding from random pangrams...`);

  const usedLetterSets = new Set(results.map(r => [...new Set(r.pangram)].sort().join('')));

  const themes = ['Mystery', 'Discovery', 'Challenge', 'Puzzle', 'Brain Teaser', 'Word Hunt', 'Letter Play', 'Vocabulary', 'Language', 'Wordsmith'];
  const names = ['Hidden Words', 'Letter Maze', 'Word Quest', 'Brain Buzz', 'Bee Challenge', 'Honey Pot', 'Letter Mix', 'Word Hive', 'Spell Craft', 'Bee Mine'];

  // Shuffle pangrams for variety
  const shuffled = [...pangrams].sort(() => Math.random() - 0.5);

  for (const p of shuffled) {
    if (results.length >= 100) break;

    const unique = [...new Set(p)];
    const key = unique.sort().join('');
    if (usedLetterSets.has(key)) continue;

    let bestCenter = null;
    let bestCount = 0;

    for (const center of unique) {
      const count = getValidWords(unique, center).length;
      if (count >= 20 && count <= 120 && count > bestCount) {
        bestCenter = center;
        bestCount = count;
      }
    }

    if (bestCenter) {
      usedLetterSets.add(key);
      const outer = unique.filter(l => l !== bestCenter);
      for (let i = outer.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [outer[i], outer[j]] = [outer[j], outer[i]];
      }

      const idx = results.length;
      results.push({
        id: idx + 1,
        name: names[idx % names.length] + ' ' + (Math.floor(idx / names.length) + 1),
        theme: themes[idx % themes.length],
        letters: [bestCenter, ...outer],
        centerLetter: bestCenter,
        pangram: p,
        wordCount: bestCount
      });
      console.log(`  #${results.length}: "${results[results.length-1].name}" — ${p.toUpperCase()} center=${bestCenter.toUpperCase()} — ${bestCount} words`);
    }
  }
}

console.log(`\nGenerated ${results.length} puzzles`);

// Remove wordCount from output (internal only)
const output = results.map(({ wordCount, ...rest }) => rest);

const outPath = path.join(__dirname, '..', 'data', 'puzzles.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Saved to ${outPath}`);
