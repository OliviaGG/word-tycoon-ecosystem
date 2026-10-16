const http = require('http');
http.get('http://localhost:3023/api/game/state', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const state = JSON.parse(d);
    const found = new Set(state.foundWords);
    const revealedSet = new Set(state.revealedCells);
    const { findAllWords } = require('./src/solver.js');
    const wordlist = require('./src/wordlist.js');
    wordlist.init().then(() => {
      const trie = wordlist.getTrie();
      const freqMap = wordlist.getFrequencyMap();
      const allWords = findAllWords(state.grid, state.rows, state.cols, trie, 3);
      const ZIPF = 3.65;
      const common = [];
      for (const [word, cells] of allWords) {
        const freq = freqMap.get(word);
        // Only include words where ALL cells are revealed
        const allRevealed = cells.every(idx => revealedSet.has(idx));
        if (word.length >= 4 && freq !== undefined && freq >= ZIPF && !found.has(word) && allRevealed) {
          common.push(word);
        }
      }
      common.sort();
      console.log(common.join(', '));
      console.log('Total:', common.length);
    }).catch(e => console.error(e.message));
  });
}).on('error', e => console.error(e.message));
