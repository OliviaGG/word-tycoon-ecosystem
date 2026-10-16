const fs = require('fs');
const dict = fs.readFileSync('C:/Interactive Sproutle/data/dictionary.txt','utf8').split(/\r?\n/).filter(Boolean).map(w=>w.trim().toLowerCase());
const freq = require('C:/Chat Relay/data/word-bank/frequency.json');
const targetsJson = require('C:/Chat Relay/data/word-bank/targets.json');
const targetSet = new Set();
for (const k of Object.keys(targetsJson)) for (const w of targetsJson[k]) targetSet.add(w.toLowerCase());

console.log('Dictionary:', dict.length);
console.log('Targets:', targetSet.size);
console.log('Frequency entries:', Object.keys(freq).length);

let hasFreq = 0, noFreq = 0, inTarget = 0;
for (const w of dict) {
  if (freq[w] !== undefined) hasFreq++;
  else noFreq++;
  if (targetSet.has(w)) inTarget++;
}
console.log('Dict words WITH frequency:', hasFreq);
console.log('Dict words WITHOUT frequency:', noFreq);
console.log('Dict words in targets:', inTarget);
console.log('');

for (const threshold of [2, 2.5, 3, 3.5]) {
  let kept = 0;
  for (const w of dict) {
    if (targetSet.has(w) || (freq[w] !== undefined && freq[w] >= threshold)) kept++;
  }
  console.log('Zipf >= ' + threshold + ' OR targets: ' + kept + ' (' + Math.round(100*kept/dict.length) + '% of dict)');
}

// With 3-letter always kept
let kept3 = 0;
for (const w of dict) {
  if (w.length === 3) { kept3++; continue; }
  if (targetSet.has(w) || (freq[w] !== undefined && freq[w] >= 3)) kept3++;
}
console.log('Zipf >= 3 OR targets OR 3-letter: ' + kept3);

// Simulate what a 4x4 grid would look like with filtered dict
// Check: how many targets have freq < 3?
let targetsLowFreq = 0, targetsNoFreq = 0;
for (const w of targetSet) {
  if (freq[w] === undefined) targetsNoFreq++;
  else if (freq[w] < 3) targetsLowFreq++;
}
console.log('');
console.log('Target words with NO frequency data:', targetsNoFreq);
console.log('Target words with freq < 3:', targetsLowFreq);
