(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordTrails = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'trail-2';
  const DAILY_VERSION = 'daily-1';
  const LEVELS_PER_REGION = 8;
  const REGIONS = [
    { name: 'Alpine morning', place: 'THE MOUNTAIN TRAIL', description: 'A little fresh air. A few new words.', theme: 'alpine' },
    { name: 'Desert bloom', place: 'THE CANYON TRAIL', description: 'Follow the words beyond the horizon.', theme: 'desert' },
    { name: 'Coastal light', place: 'THE OCEAN TRAIL', description: 'Find your rhythm, one word at a time.', theme: 'coast' }
  ];
  // Original, curated racks and word choices; layouts are generated below.
  const RACKS = [
    ['CATS', ['cats', 'cat', 'act', 'sat', 'at'], ['acts', 'cast', 'scat', 'sac', 'as', 'ta']],
    ['STONE', ['stone', 'tone', 'nest', 'sent', 'one', 'ten'], ['tones', 'notes', 'note', 'ones', 'nose', 'toes', 'nets', 'set', 'son', 'not', 'net', 'toe', 'ton', 'eon']],
    ['PLANT', ['plant', 'plan', 'pant', 'ant', 'tap', 'lap'], ['apt', 'nap', 'pan', 'pat', 'tan', 'pal', 'plat']],
    ['STREAM', ['stream', 'master', 'team', 'star', 'same', 'arm', 'met'], ['steam', 'teams', 'smart', 'tamer', 'stare', 'tears', 'rates', 'meat', 'mate', 'seam', 'rest', 'stem', 'art', 'are', 'ear', 'eat', 'era', 'mat', 'ram', 'rat', 'sat', 'sea', 'set', 'tar', 'tea']],
    ['GARDEN', ['garden', 'range', 'read', 'dear', 'gear', 'den', 'rag'], ['danger', 'ranged', 'anger', 'grade', 'grand', 'aged', 'dare', 'dean', 'drag', 'earn', 'near', 'rage', 'rang', 'and', 'age', 'are', 'ear', 'end', 'era', 'nag', 'ran', 'red']],
    ['PLANET', ['planet', 'plate', 'plane', 'late', 'neat', 'pet', 'ant'], ['plant', 'panel', 'petal', 'pleat', 'leapt', 'penal', 'leap', 'lean', 'lent', 'lane', 'pale', 'pane', 'pant', 'peal', 'peat', 'plan', 'tale', 'tape', 'teal', 'ante', 'apt', 'ape', 'ale', 'eat', 'lap', 'let', 'nap', 'net', 'pan', 'pal', 'pat', 'pen', 'tan', 'tap', 'tea', 'ten']],
    ['SILENT', ['silent', 'listen', 'line', 'nest', 'tile', 'sit', 'let'], ['enlist', 'tinsel', 'inlets', 'inlet', 'islet', 'stile', 'tiles', 'lines', 'liens', 'lent', 'lens', 'list', 'lite', 'net', 'nit', 'set', 'sin', 'ten', 'tie', 'tin']],
    ['BRIGHT', ['bright', 'birth', 'right', 'grit', 'big', 'hit', 'rib'], ['girth', 'girt', 'brig', 'bit', 'git', 'rig']],
    ['ORANGE', ['orange', 'range', 'anger', 'gear', 'near', 'age', 'nor'], ['organ', 'groan', 'argon', 'gone', 'ogre', 'rage', 'earn', 'rang', 'are', 'ago', 'ear', 'ego', 'eon', 'era', 'nag', 'one', 'ore', 'oar', 'rag', 'ran', 'roe']],
    ['FLOWER', ['flower', 'lower', 'flow', 'wolf', 'row', 'owe', 'for'], ['fowl', 'fore', 'floe', 'role', 'lore', 'wore', 'low', 'few', 'ore', 'owl', 'roe', 'foe', 'woe', 'ref']],
    ['SPRING', ['spring', 'rings', 'grin', 'spin', 'rip', 'pig', 'sin'], ['grips', 'grins', 'prigs', 'ring', 'grip', 'ping', 'pins', 'rips', 'rigs', 'sign', 'sing', 'snip', 'gin', 'nip', 'pin', 'rig', 'sip', 'sir']],
    ['EARTHS', ['earths', 'heart', 'share', 'rest', 'heat', 'sea', 'art', 'her'], ['earth', 'hearts', 'haters', 'hater', 'heats', 'hares', 'hears', 'rates', 'stare', 'shear', 'tears', 'aster', 'hate', 'hare', 'hear', 'seat', 'east', 'eats', 'star', 'arts', 'rats', 'rash', 'rate', 'tear', 'sate', 'hers', 'are', 'ash', 'ate', 'ear', 'eat', 'era', 'has', 'hat', 'rat', 'sat', 'set', 'she', 'tar', 'tea', 'the']],
    ['CAT', ['cat', 'act', 'at'], []],
    ['DOG', ['dog', 'god', 'do'], ['go']],
    ['STAR', ['star', 'sat', 'art', 'at'], ['arts', 'rats', 'rat', 'tar', 'as']],
    ['TEAM', ['team', 'meat', 'mate', 'eat', 'tea'], ['tame', 'ate', 'mat', 'met', 'at', 'am', 'me']],
    ['LAMP', ['lamp', 'palm', 'lap', 'map', 'amp'], ['pal', 'am']],
    ['TRAIN', ['train', 'rain', 'rant', 'anti', 'ant', 'tin'], ['art', 'air', 'nit', 'ran', 'rat', 'tan', 'tar']],
    ['HEART', ['heart', 'earth', 'heat', 'hate', 'hare', 'art'], ['hear', 'tear', 'rate', 'hart', 'are', 'ate', 'ear', 'eat', 'era', 'hat', 'her', 'rat', 'tar', 'tea', 'the']],
    ['PAINTER', ['painter', 'paint', 'train', 'print', 'pair', 'rain', 'tape', 'pen', 'ant'], ['pertain', 'repaint', 'terrain', 'retain', 'retina', 'parent', 'pinter', 'inert', 'inter', 'irate', 'prate', 'taper', 'ripen', 'pain', 'pane', 'pant', 'part', 'pear', 'peat', 'pine', 'pint', 'pita', 'near', 'neat', 'trap', 'trip', 'tier', 'tire', 'rate', 'tear', 'ripe', 'rent', 'ape', 'apt', 'are', 'air', 'art', 'ear', 'eat', 'era', 'nap', 'net', 'nip', 'pan', 'pat', 'pet', 'pin', 'pit', 'ran', 'rap', 'rat', 'rip', 'tan', 'tap', 'tar', 'tea', 'ten', 'tie', 'tin']],
    ['READING', ['reading', 'garden', 'danger', 'range', 'grain', 'dear', 'rain', 'ring', 'den'], ['dearing', 'earned', 'gained', 'rained', 'graded', 'reign', 'grind', 'drain', 'anger', 'grade', 'grand', 'aged', 'dare', 'dean', 'drag', 'earn', 'gear', 'near', 'rage', 'rang', 'read', 'ride', 'arid', 'dine', 'ding', 'dire', 'gain', 'gird', 'grad', 'grid', 'grin', 'idea', 'rend', 'and', 'age', 'aid', 'air', 'are', 'dig', 'die', 'din', 'ear', 'end', 'era', 'gin', 'nag', 'rag', 'ran', 'red', 'rid', 'rig']],
    ['COASTER', ['coaster', 'actors', 'sector', 'crate', 'coast', 'store', 'race', 'seat', 'cat', 'ore'], ['coaters', 'orates', 'traces', 'reacts', 'caster', 'castor', 'escort', 'crates', 'actor', 'cater', 'crest', 'react', 'score', 'stare', 'trace', 'rates', 'tears', 'cores', 'coats', 'roast', 'cast', 'care', 'cart', 'case', 'coat', 'core', 'cost', 'ears', 'east', 'eats', 'oars', 'oats', 'orca', 'rate', 'rest', 'rose', 'scar', 'soar', 'sort', 'star', 'taco', 'tear', 'tore', 'act', 'are', 'art', 'ate', 'car', 'ear', 'eat', 'era', 'oar', 'oat', 'rat', 'roe', 'rot', 'sat', 'sea', 'set', 'tar', 'tea', 'toe']],
    ['FLOWERS', ['flowers', 'flower', 'lower', 'slower', 'fowls', 'roles', 'wolf', 'flow', 'row', 'for'], ['lowers', 'fowler', 'flows', 'froes', 'owls', 'lows', 'rows', 'foes', 'woes', 'fowl', 'fore', 'floe', 'role', 'lore', 'wore', 'sore', 'rose', 'self', 'flew', 'low', 'few', 'ore', 'owl', 'roe', 'foe', 'woe', 'ref']],
    ['TEACHER', ['teacher', 'cheater', 'create', 'heater', 'teach', 'reach', 'trace', 'cheer', 'earth', 'heart'], ['cheat', 'chart', 'cater', 'crate', 'react', 'there', 'three', 'ether', 'acre', 'ache', 'arch', 'care', 'cart', 'chat', 'each', 'etch', 'hate', 'hare', 'hear', 'heat', 'here', 'race', 'rate', 'tear', 'tree', 'thee', 'act', 'are', 'art', 'ate', 'car', 'cat', 'ear', 'eat', 'era', 'hat', 'her', 'rat', 'tar', 'tea', 'the']],
    ['STREAMS', ['streams', 'masters', 'tamers', 'stream', 'master', 'steam', 'smart', 'teams', 'stare', 'tears', 'rest', 'arm'], ['stares', 'steams', 'smears', 'asters', 'stems', 'tames', 'meats', 'mates', 'rates', 'seams', 'stars', 'tamer', 'smear', 'team', 'same', 'seam', 'star', 'stem', 'tame', 'meat', 'mate', 'mass', 'mess', 'mast', 'arms', 'arts', 'ears', 'eats', 'east', 'rats', 'seat', 'sets', 'tear', 'are', 'art', 'ate', 'ear', 'eat', 'era', 'mat', 'met', 'ram', 'rat', 'sat', 'sea', 'set', 'tar', 'tea']]
  ];
  const CAMPAIGN = [
    ['CAT'], ['DOG'], ['CATS', ['cats', 'cat', 'sat', 'at']], ['STAR'], ['TEAM'], ['LAMP'], ['PLANT'], ['STONE'],
    ['TRAIN'], ['HEART'], ['STREAM'], ['GARDEN'],
    ['PLANET', ['planet', 'plate', 'plane', 'plant', 'late', 'neat', 'pet', 'ant']],
    ['SILENT', ['silent', 'listen', 'inlet', 'line', 'nest', 'tile', 'sit', 'let']],
    ['FLOWER', ['flower', 'lower', 'fowl', 'flow', 'wolf', 'row', 'owe', 'for']],
    ['ORANGE', ['orange', 'range', 'anger', 'organ', 'gear', 'near', 'age', 'nor']],
    ['SPRING', ['spring', 'rings', 'grips', 'grin', 'spin', 'sign', 'rip', 'pig', 'sin']],
    ['BRIGHT', ['bright', 'birth', 'right', 'girth', 'grit', 'brig', 'big', 'hit', 'rib']],
    ['PAINTER'], ['READING'], ['COASTER'], ['FLOWERS'], ['TEACHER'], ['STREAMS']
  ];

  const key = (r, c) => `${r},${c}`;
  const normalize = value => String(value || '').trim().toLowerCase();
  function canBuild(word, rack) {
    const letters = [...rack.toLowerCase()];
    return [...normalize(word)].every(letter => {
      const index = letters.indexOf(letter);
      if (index < 0) return false;
      letters.splice(index, 1);
      return true;
    });
  }
  function random(seed) {
    let n = seed + 1;
    return () => { n = Math.imul(n ^ n >>> 15, 1 | n); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  }
  function bounds(cells) {
    const positions = [...cells.keys()].map(k => k.split(',').map(Number));
    const rows = positions.map(p => p[0]), cols = positions.map(p => p[1]);
    return { minR: Math.min(...rows), maxR: Math.max(...rows), minC: Math.min(...cols), maxC: Math.max(...cols) };
  }
  function place(cells, word, row, col, direction) {
    const dr = direction === 'down' ? 1 : 0, dc = 1 - dr;
    if (cells.has(key(row - dr, col - dc)) || cells.has(key(row + dr * word.length, col + dc * word.length))) return null;
    let crosses = 0;
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i, c = col + dc * i, cell = cells.get(key(r, c));
      if (cell) {
        if (cell.letter !== word[i] || cell.directions.includes(direction)) return null;
        crosses++;
      } else if (cells.has(key(r + dc, c + dr)) || cells.has(key(r - dc, c - dr))) return null;
    }
    if (cells.size && !crosses) return null;
    const next = new Map(cells);
    for (let i = 0; i < word.length; i++) {
      const k = key(row + dr * i, col + dc * i), cell = next.get(k);
      next.set(k, { letter: word[i], directions: [...(cell ? cell.directions : []), direction] });
    }
    const box = bounds(next), height = box.maxR - box.minR + 1, width = box.maxC - box.minC + 1;
    if (height > 11 || width > 11) return null;
    return { cells: next, word, row, col, direction, cost: height * width + Math.abs(height - width) * 2 - crosses * 8 };
  }
  function layout(words, seed) {
    let best;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rng = random(seed * 101 + attempt * 977);
      const ordered = [...words].sort((a, b) => b.length - a.length);
      const first = ordered.shift();
      let cells = new Map(), placed = [{ word: first, row: 0, col: 0, direction: 'across' }];
      [...first].forEach((letter, c) => cells.set(key(0, c), { letter, directions: ['across'] }));
      while (ordered.length) {
        const candidates = [];
        for (const word of ordered) for (const [k, cell] of cells) {
          const [r, c] = k.split(',').map(Number);
          for (let i = 0; i < word.length; i++) if (word[i] === cell.letter) {
            for (const direction of ['across', 'down']) {
              const result = place(cells, word, r - (direction === 'down' ? i : 0), c - (direction === 'across' ? i : 0), direction);
              if (result) candidates.push({ ...result, rank: result.cost + rng() * (attempt ? 32 : 0) - word.length * 2 });
            }
          }
        }
        if (!candidates.length) break;
        candidates.sort((a, b) => a.rank - b.rank);
        const choice = candidates[0];
        cells = choice.cells;
        placed.push({ word: choice.word, row: choice.row, col: choice.col, direction: choice.direction });
        ordered.splice(ordered.indexOf(choice.word), 1);
      }
      const box = bounds(cells), cost = (box.maxR - box.minR + 1) * (box.maxC - box.minC + 1);
      if (!best || placed.length > best.placed.length || (placed.length === best.placed.length && cost < best.cost)) best = { cells, placed, box, cost };
      if (placed.length === words.length && attempt > 15) break;
    }
    if (best.placed.length !== words.length) throw new Error(`Could not connect all words: ${words.join(', ')}`);
    const { box } = best;
    return {
      rows: box.maxR - box.minR + 1, cols: box.maxC - box.minC + 1,
      words: best.placed.map(w => ({ ...w, row: w.row - box.minR, col: w.col - box.minC })),
      cells: [...best.cells].map(([k, cell]) => { const [r, c] = k.split(',').map(Number); return { row: r - box.minR, col: c - box.minC, letter: cell.letter }; })
    };
  }
  const difficulty = level => level <= 4 ? 'Easy' : level <= 10 ? 'Growing' : level <= 18 ? 'Challenging' : 'Expert';
  const puzzles = CAMPAIGN.map(([rack, selected], index) => {
    const source = RACKS.find(r => r[0] === rack), targets = selected || source[1];
    const bonus = [...new Set([...source[1], ...source[2]])].filter(w => !targets.includes(w) && canBuild(w, rack));
    return { id: `${VERSION}-${index + 1}`, mode: 'trail', level: index + 1, region: Math.floor(index / LEVELS_PER_REGION), rack,
      difficulty: difficulty(index + 1), targets, bonus, ...layout(targets, index + 71) };
  });
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' });
  function getEdmontonDate(value) {
    const parts = dateFormat.formatToParts(value === undefined ? new Date() : new Date(value));
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  }
  function dateNumber(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid daily date');
    const number = Date.parse(`${date}T00:00:00Z`) / 86400000;
    if (!Number.isInteger(number) || new Date(number * 86400000).toISOString().slice(0, 10) !== date) throw new Error('Invalid daily date');
    return number;
  }
  function nextDailyReset(value) {
    const instant = value === undefined ? Date.now() : new Date(value).getTime();
    const desired = (dateNumber(getEdmontonDate(instant)) + 1) * 86400000;
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let guess = desired;
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(new Date(guess)), n = type => Number(parts.find(p => p.type === type).value);
      const actual = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
      guess += desired - actual;
    }
    return guess;
  }
  function shuffled(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  const dailyCache = new Map();
  function getDaily(date) {
    const day = date || getEdmontonDate();
    const ordinal = dateNumber(day);
    if (dailyCache.has(day)) return dailyCache.get(day);
    // Each date has a different rack from its neighbors, then selects a seeded
    // set of common words and an original layout. No UTC daily rollover.
    const pool = puzzles.filter(p => p.rack.length >= 6 && p.level <= 22);
    const base = pool[((ordinal % pool.length) + pool.length) % pool.length];
    const words = [...base.targets, ...base.bonus].filter(w => w.length >= 4 && !['pinter', 'dearing', 'froes'].includes(w));
    const anchor = base.rack.toLowerCase();
    let targets, grid;
    for (let attempt = 0; attempt < 8; attempt++) {
      const rng = random(ordinal * 997 + attempt * 193);
      targets = [anchor, ...shuffled(words.filter(w => w !== anchor), rng).slice(0, base.rack.length >= 7 ? 7 : 6)];
      try { grid = layout(targets, ordinal + attempt * 7919); break; } catch (_) { /* Try another connected selection. */ }
    }
    if (!grid) { targets = base.targets; grid = { rows: base.rows, cols: base.cols, words: base.words, cells: base.cells }; }
    const result = { id: `${DAILY_VERSION}-${day}`, puzzleGenerationId: `${DAILY_VERSION}-${day}`, mode: 'daily', date: day,
      rack: base.rack, region: ((ordinal % REGIONS.length) + REGIONS.length) % REGIONS.length, difficulty: base.rack.length >= 7 ? 'Challenging' : 'Growing',
      targets, bonus: [...new Set([...base.targets, ...base.bonus])].filter(w => !targets.includes(w)), ...grid };
    dailyCache.set(day, result);
    if (dailyCache.size > 8) dailyCache.delete(dailyCache.keys().next().value);
    return result;
  }
  function dailyStreak(records, date) {
    let day = dateNumber(date || getEdmontonDate()), streak = 0;
    const keyFor = n => new Date(n * 86400000).toISOString().slice(0, 10);
    if (!records[keyFor(day)]) day--;
    while (records[keyFor(day)]) { streak++; day--; }
    return streak;
  }
  function wordCells(puzzle, word) {
    const placement = puzzle.words.find(w => w.word === word);
    if (!placement) return [];
    return [...word].map((_, i) => key(placement.row + (placement.direction === 'down' ? i : 0), placement.col + (placement.direction === 'across' ? i : 0)));
  }
  function visibleCells(puzzle, found, revealed) {
    const result = new Set(revealed || []);
    for (const word of found || []) for (const k of wordCells(puzzle, word)) result.add(k);
    return result;
  }
  function check(puzzle, input, found, bonus) {
    const word = normalize(input);
    if (word.length < 2) return { type: 'invalid', message: 'Connect at least two letters.' };
    if (!canBuild(word, puzzle.rack)) return { type: 'invalid', message: 'Use each wheel letter only once.' };
    if (puzzle.targets.includes(word)) return { type: (found || []).includes(word) ? 'duplicate' : 'target', word };
    if (puzzle.bonus.includes(word)) return { type: (bonus || []).includes(word) ? 'duplicate' : 'bonus', word };
    return { type: 'invalid', message: 'That word is outside this puzzle’s curated list.' };
  }
  function progress(puzzle, value) {
    const saved = value && value.id === puzzle.id ? value : {};
    const valid = (items, allowed) => [...new Set(Array.isArray(items) ? items.filter(v => allowed.includes(v)) : [])];
    const found = valid(saved.found, puzzle.targets), bonus = valid(saved.bonus, puzzle.bonus);
    const revealed = valid(saved.revealed, puzzle.cells.map(c => key(c.row, c.col)));
    const visible = visibleCells(puzzle, found, revealed);
    for (const word of puzzle.targets) if (!found.includes(word) && wordCells(puzzle, word).every(k => visible.has(k))) found.push(word);
    return { id: puzzle.id, found, bonus, revealed };
  }
  return { VERSION, DAILY_VERSION, LEVELS_PER_REGION, REGIONS, puzzles, key, canBuild, check, progress, wordCells, visibleCells, getEdmontonDate, getDaily, nextDailyReset, dailyStreak };
});
