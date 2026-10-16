// play-test.js — Fast SP game solver using server's pre-computed word paths
// The server returns allWords + their cell paths — no need for DFS at all.

const BASE = process.env.SP_URL || 'http://localhost:3023';

async function main() {
    console.log(`Fetching game from ${BASE}/api/sp/game ...`);
    const res = await fetch(`${BASE}/api/sp/game`);
    const data = await res.json();

    const { grid, rows, cols, centerCells, revealQueue: queue,
            commonWords, rareWords, allWords: allWordsArr } = data;

    // The server returns allWords as a flat array of word strings.
    // We need word→path, but the server doesn't send paths in SP mode.
    // Use the server's internal game endpoint to get the full state instead.
    // Actually we'll use the game module directly.

    // Load from server game module
    const path = require('path');
    const { SproutleGame } = require(path.join(__dirname, 'src/game'));
    const wordlist = require(path.join(__dirname, 'src/wordlist'));

    await wordlist.init();
    const g = new SproutleGame();
    g.initialize(wordlist.getTrie(), wordlist.getFrequencyMap(), null);

    const commonSet = g.commonWords;
    const allWords  = g.allWords; // Map<word, cells[]>
    let revealedSet = new Set(g.centerCells);
    let revQueue    = [...g.revealQueue];
    const foundWords = new Set();

    // Print grid
    console.log(`\nGrid ${g.rows}x${g.cols} — ${commonSet.size} common words, ${allWords.size} total`);
    for (let r = 0; r < g.rows; r++) {
        console.log('  ' + g.grid[r].map((l, c) => {
            const idx = r * g.cols + c;
            return revealedSet.has(idx) ? `[${l.toUpperCase()}]` : ` ${l.toUpperCase()} `;
        }).join(''));
    }
    console.log(`\nCenter: ${[...g.centerCells].map(i => {
        return g.grid[Math.floor(i/g.cols)][i%g.cols].toUpperCase();
    }).join('')}  |  Reveal queue: ${revQueue.length} cells\n`);

    // Fast active-word finder: just check if all cells in stored path are revealed
    function getActiveWords() {
        const active = new Map();
        for (const [word, cells] of allWords) {
            if (foundWords.has(word)) continue;
            if (cells.every(idx => revealedSet.has(idx))) {
                active.set(word, cells);
            }
        }
        return active;
    }

    let round = 0;
    let autoReveals = 0;

    while (true) {
        const active = getActiveWords();

        // Prefer unfound common words, then any word
        const unfoundCommon = [...active.entries()].filter(([w]) => commonSet.has(w));
        const pick = unfoundCommon[0] || [...active.entries()][0];

        if (!pick) {
            if (revQueue.length === 0) {
                console.log('⚠ No words and no cells left — stopping.');
                break;
            }
            const newCell = revQueue.shift();
            const r = Math.floor(newCell / g.cols), c = newCell % g.cols;
            revealedSet.add(newCell);
            autoReveals++;
            console.log(`  → No words yet, auto-revealing [${g.grid[r][c].toUpperCase()}] (cell ${newCell})`);
            if (autoReveals > g.rows * g.cols) { console.log('Safety: too many auto-reveals.'); break; }
            continue;
        }
        autoReveals = 0;

        const [word, cells] = pick;
        round++;
        foundWords.add(word);

        const isCommon = commonSet.has(word);
        const foundCommonCount = [...foundWords].filter(w => commonSet.has(w)).length;
        const tag = isCommon ? '✓ COMMON' : '  bonus ';

        let revealed = '';
        if (revQueue.length > 0) {
            const newCell = revQueue.shift();
            revealedSet.add(newCell);
            const r2 = Math.floor(newCell / g.cols), c2 = newCell % g.cols;
            revealed = ` → reveals [${g.grid[r2][c2].toUpperCase()}]`;
        }

        console.log(`R${String(round).padStart(3)} [${tag}] ${word.toUpperCase().padEnd(15)} (${foundCommonCount}/${commonSet.size})${revealed}`);

        if (foundCommonCount >= commonSet.size) break;
        if (round > 1000) { console.log('Safety stop.'); break; }
    }

    const foundCommonCount = [...foundWords].filter(w => commonSet.has(w)).length;
    const missed = [...commonSet].filter(w => !foundWords.has(w));

    console.log(`\n${'═'.repeat(55)}`);
    if (foundCommonCount >= commonSet.size) {
        console.log(`🌱 Garden Complete! All ${commonSet.size} common words found in ${round} rounds.`);
    } else {
        console.log(`Stopped: ${foundCommonCount}/${commonSet.size} common words in ${round} rounds.`);
        if (missed.length) {
            console.log(`Missed: ${missed.slice(0,10).join(', ')}${missed.length > 10 ? '...' : ''}`);
            // Check if missed words were reachable at end
            const endActive = new Map();
            for (const w of missed) {
                const cells = allWords.get(w);
                if (cells && cells.every(i => revealedSet.has(i))) endActive.set(w, cells);
            }
            if (endActive.size) console.log(`  (${endActive.size} were reachable but not picked)`);
        }
    }
    console.log(`Total words found: ${foundWords.size} | Cells revealed: ${revealedSet.size}/${g.rows*g.cols}`);
}

main().catch(console.error);
