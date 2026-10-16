/**
 * Puzzle Generator
 *
 * 1. Call OpenRouter LLM to generate a theme + spangram + themed words (total 55 letters)
 * 2. Pack words into the triangle grid using backtracking
 * 3. Validate the result
 */

const fs = require('fs');
const path = require('path');
const { TriangleGrid, TOTAL_CELLS } = require('./grid');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const IMAGE_MODEL = 'google/gemini-2.5-flash-image';
const PUZZLES_DIR = path.join(__dirname, '..', 'data', 'puzzles');

// ── Filler Word Pool (for auto-adjusting LLM word lists) ────────────
// Curated for low substring-conflict risk and neutral theme compatibility.
const FILLER_WORDS = {
  3: ['ace', 'arc', 'ash', 'axe', 'bay', 'bow', 'bud', 'cob', 'cot', 'dew',
       'dip', 'elm', 'fig', 'fog', 'gum', 'hay', 'hem', 'hub', 'hue', 'ivy',
       'jab', 'jar', 'jig', 'jot', 'jug', 'keg', 'kit', 'lob', 'mop', 'mud',
       'nub', 'oar', 'orb', 'owl', 'paw', 'pod', 'rig', 'rut', 'sap', 'tab',
       'tug', 'urn', 'vow', 'wax', 'yew', 'zip'],
  4: ['balm', 'bolt', 'cape', 'coil', 'dusk', 'fawn', 'gilt', 'haze', 'jolt',
       'kelp', 'kiln', 'loft', 'malt', 'myth', 'nook', 'opal', 'pulp', 'raft',
       'rind', 'sage', 'slab', 'tarp', 'tuft', 'vale', 'weld', 'yoke', 'zinc'],
  5: ['anvil', 'birch', 'bluff', 'cairn', 'cedar', 'clamp', 'dwarf', 'ember',
       'fjord', 'glyph', 'gulch', 'ivory', 'knoll', 'latch', 'ledge', 'marsh',
       'notch', 'plumb', 'prism', 'qualm', 'scalp', 'thorn', 'umbra', 'vigor',
       'wedge'],
  6: ['adrift', 'cobalt', 'damask', 'fossil', 'jetsam', 'locket', 'myriad',
       'nimble', 'plaque', 'quartz', 'velvet', 'zenith'],
  7: ['alchemy', 'bramble', 'crevice', 'dappled', 'eclipse', 'flicker',
       'granule', 'impulse', 'juniper', 'lantern', 'mineral', 'orchard',
       'shelter', 'thimble', 'varnish'],
  8: ['amethyst', 'bracelet', 'crescent', 'daffodil', 'filament', 'gargoyle',
       'ironwork', 'keepsake', 'lavender', 'overhang', 'seashell', 'windmill']
};

// ── LLM Theme Generation ──────────────────────────────────────────────

const BASE_THEME_PROMPT = `You are a word puzzle designer. Generate a themed word puzzle.

Rules:
- Pick a fun, specific theme (e.g., "Kitchen Tools", "Ocean Creatures", "Campfire Night")
- Create ONE spangram: a word of 7-10 letters that embodies the theme
- Create themed words (3-8 letters each) that all relate to the theme
- Aim for approximately 55 total letters across spangram + all words (close is fine, we auto-adjust)
- All words must be common English words (no proper nouns)
- No duplicate words, no word is a substring of another

EXAMPLE:
{"theme":"Breakfast Time","themeHint":"Morning meal favorites","spangram":"breakfast","words":["pancake","waffle","toast","eggs","juice","bacon","syrup","cereal","jam"]}

Return ONLY valid JSON:
{
  "theme": "Theme Name",
  "themeHint": "Short clue (max 8 words)",
  "spangram": "spangramword",
  "words": ["word1", "word2", ...]
}

The "words" array should NOT include the spangram. All words lowercase.`;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function parseTargetDate(targetDate) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return null;
  }

  const [year, month, day] = targetDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    year,
    month,
    day,
    date,
    weekdayIndex: date.getUTCDay(),
    weekdayName: WEEKDAY_NAMES[date.getUTCDay()],
    monthName: MONTH_NAMES[month - 1]
  };
}

function getSeason(month) {
  if ([12, 1, 2].includes(month)) return 'winter';
  if ([3, 4, 5].includes(month)) return 'spring';
  if ([6, 7, 8].includes(month)) return 'summer';
  return 'autumn';
}

function getNthWeekdayOfMonth(year, month, weekday, ordinal) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const dayOffset = (weekday - firstWeekday + 7) % 7;
  return 1 + dayOffset + (ordinal - 1) * 7;
}

function getLastWeekdayOfMonth(year, month, weekday) {
  const lastOfMonth = new Date(Date.UTC(year, month, 0));
  const lastWeekday = lastOfMonth.getUTCDay();
  const dayOffset = (lastWeekday - weekday + 7) % 7;
  return lastOfMonth.getUTCDate() - dayOffset;
}

function getOccasionHints(targetDate) {
  const parts = parseTargetDate(targetDate);
  if (!parts) return [];

  const fixedOccasions = {
    '01-01': ['New Year\'s Day'],
    '02-14': ['Valentine\'s Day'],
    '03-17': ['St. Patrick\'s Day'],
    '04-01': ['April Fools\' Day'],
    '04-22': ['Earth Day'],
    '05-04': ['Star Wars Day'],
    '05-05': ['Cinco de Mayo'],
    '06-19': ['Juneteenth'],
    '07-01': ['Canada Day'],
    '07-04': ['Independence Day'],
    '10-31': ['Halloween'],
    '11-11': ['Veterans Day', 'Remembrance Day'],
    '12-24': ['Christmas Eve'],
    '12-25': ['Christmas Day'],
    '12-31': ['New Year\'s Eve']
  };

  const key = `${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const occasions = fixedOccasions[key] ? [...fixedOccasions[key]] : [];

  if (parts.month === 5 && parts.day === getNthWeekdayOfMonth(parts.year, 5, 0, 2)) {
    occasions.push('Mother\'s Day');
  }
  if (parts.month === 6 && parts.day === getNthWeekdayOfMonth(parts.year, 6, 0, 3)) {
    occasions.push('Father\'s Day');
  }
  if (parts.month === 5 && parts.day === getLastWeekdayOfMonth(parts.year, 5, 1)) {
    occasions.push('Memorial Day');
  }
  if (parts.month === 9 && parts.day === getNthWeekdayOfMonth(parts.year, 9, 1, 1)) {
    occasions.push('Labor Day');
  }
  if (parts.month === 11 && parts.day === getNthWeekdayOfMonth(parts.year, 11, 4, 4)) {
    occasions.push('Thanksgiving');
  }

  return occasions;
}

function buildDateContext(targetDate) {
  const parts = parseTargetDate(targetDate);
  if (!parts) return null;

  const season = getSeason(parts.month);
  const occasions = getOccasionHints(targetDate);
  const isWeekend = parts.weekdayIndex === 0 || parts.weekdayIndex === 6;

  return {
    label: `${parts.weekdayName}, ${parts.monthName} ${parts.day}, ${parts.year}`,
    monthName: parts.monthName,
    weekdayName: parts.weekdayName,
    season,
    occasions,
    puzzleGuidance: occasions.length > 0
      ? `Base the puzzle on one of these timely occasions: ${occasions.join(', ')}.`
      : `There is no major fixed holiday on this date, so make the theme feel specific to ${parts.monthName}, ${season}, and the vibe of a ${isWeekend ? 'weekend' : 'weekday'}.`,
    imageGuidance: occasions.length > 0
      ? `Let the image subtly evoke ${occasions.join(' or ')} without using text or greeting-card cliches.`
      : `Let the image feel anchored to ${parts.monthName} and ${season}, with a mood that suits a ${parts.weekdayName}.`
  };
}

function buildThemePrompt(targetDate, excludeThemes = []) {
  const context = buildDateContext(targetDate);
  const exclusion = excludeThemes.length > 0
    ? `\n\nDO NOT use any of these themes (already used): ${excludeThemes.join(', ')}.
Pick something COMPLETELY DIFFERENT — a new topic, not a rephrasing of the above.`
    : '';

  if (!context) return BASE_THEME_PROMPT + exclusion;

  return `${BASE_THEME_PROMPT}

DATE-SPECIFIC DIRECTION:
- This puzzle is for ${context.label}.
- ${context.puzzleGuidance}
- If a holiday or occasion is listed, the puzzle theme should clearly connect to it.
- If there is no major holiday, avoid generic filler themes and choose something that feels timely for that exact date, month, season, or day-of-week energy.` + exclusion;
}

async function generateThemeFromLLM(apiKey, model, options = {}) {
  model = model || DEFAULT_MODEL;
  const { targetDate = null, excludeThemes = [] } = options;
  const dateContext = buildDateContext(targetDate);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wordtycoon.live',
      'X-Title': 'Triangled'
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildThemePrompt(targetDate, excludeThemes) },
        {
          role: 'user',
          content: dateContext
            ? `Generate a puzzle for ${dateContext.label}. ${dateContext.puzzleGuidance}`
            : 'Generate a puzzle.'
        }
      ]
    })
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = content.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Could not parse LLM response as JSON');
  }

  return parsed;
}

// ── Theme Validation ──────────────────────────────────────────────────

function validateTheme(theme, dictionaryCheck) {
  const errors = [];

  if (!theme.theme || typeof theme.theme !== 'string') {
    errors.push('Missing or invalid theme name');
  }
  if (!theme.spangram || typeof theme.spangram !== 'string') {
    errors.push('Missing or invalid spangram');
  }
  if (!Array.isArray(theme.words) || theme.words.length < 4) {
    errors.push('Need at least 4 themed words');
  }

  if (errors.length) return { valid: false, errors };

  const spangram = theme.spangram.toLowerCase();
  const words = theme.words.map(w => w.toLowerCase());

  // Check spangram length
  if (spangram.length < 7 || spangram.length > 12) {
    errors.push(`Spangram "${spangram}" length ${spangram.length} not in 7-12 range`);
  }

  // Check word lengths
  for (const w of words) {
    if (w.length < 3 || w.length > 8) {
      errors.push(`Word "${w}" length ${w.length} not in 3-8 range`);
    }
  }

  // Check total letter count
  const totalLetters = spangram.length + words.reduce((sum, w) => sum + w.length, 0);
  if (totalLetters !== TOTAL_CELLS) {
    errors.push(`Total letters ${totalLetters}, need exactly ${TOTAL_CELLS}`);
  }

  // Check duplicates
  const allWords = [spangram, ...words];
  const unique = new Set(allWords);
  if (unique.size !== allWords.length) {
    errors.push('Duplicate words found');
  }

  // Check substrings
  for (let i = 0; i < allWords.length; i++) {
    for (let j = 0; j < allWords.length; j++) {
      if (i !== j && allWords[j].includes(allWords[i])) {
        errors.push(`"${allWords[i]}" is substring of "${allWords[j]}"`);
      }
    }
  }

  // Dictionary check (optional callback)
  if (dictionaryCheck) {
    for (const w of allWords) {
      if (!dictionaryCheck(w)) {
        errors.push(`"${w}" not found in dictionary`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Grid Packing Algorithm ────────────────────────────────────────────

/**
 * Find a connected path of length `len` through empty cells,
 * starting from any of `startCells`.
 * Uses randomized DFS with backtracking.
 */
function findPath(grid, startCells, len, mustSpan) {
  // Shuffle start cells for variety
  const shuffled = [...startCells].sort(() => Math.random() - 0.5);

  for (const [sr, sc] of shuffled) {
    if (!grid.isEmpty(sr, sc)) continue;

    const path = [[sr, sc]];
    const visited = new Set([`${sr},${sc}`]);

    if (dfs(grid, path, visited, len, mustSpan)) {
      return path;
    }
  }
  return null;
}

function dfs(grid, path, visited, targetLen, mustSpan) {
  if (path.length === targetLen) {
    if (mustSpan) {
      return grid.spansOppositeEdges(path);
    }
    return true;
  }

  const [cr, cc] = path[path.length - 1];
  const neighbors = grid.getNeighbors(cr, cc);
  // Shuffle for randomness
  neighbors.sort(() => Math.random() - 0.5);

  for (const [nr, nc] of neighbors) {
    const key = `${nr},${nc}`;
    if (visited.has(key)) continue;
    if (!grid.isEmpty(nr, nc)) continue;

    path.push([nr, nc]);
    visited.add(key);

    if (dfs(grid, path, visited, targetLen, mustSpan)) {
      return true;
    }

    path.pop();
    visited.delete(key);
  }
  return false;
}

/**
 * Pack all words into the grid.
 * Place spangram first (must span edges), then themed words.
 * Returns { success, grid, wordPaths } or { success: false, reason }
 */
function packGrid(spangram, words, maxAttempts = 150) {
  const allWords = [spangram, ...words];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const grid = new TriangleGrid();
    const wordPaths = {};
    let success = true;

    // Sort themed words by length descending (longer words are harder to place)
    const sortedWords = [...words].sort((a, b) => b.length - a.length);
    const orderedWords = [spangram, ...sortedWords];

    for (let i = 0; i < orderedWords.length; i++) {
      const word = orderedWords[i];
      const isSpangram = i === 0;

      let startCells;
      if (isSpangram) {
        // Spangram must start on an edge
        startCells = grid.allCells().filter(([r, c]) => grid.isEdgeCell(r, c));
      } else {
        // Other words can start anywhere empty
        startCells = grid.emptyCells();
      }

      const path = findPath(grid, startCells, word.length, isSpangram);

      if (!path) {
        success = false;
        break;
      }

      // Place the word
      for (let j = 0; j < word.length; j++) {
        grid.set(path[j][0], path[j][1], word[j].toUpperCase());
      }
      wordPaths[word] = path;
    }

    if (success) {
      // Verify all cells filled
      const empty = grid.emptyCells();
      if (empty.length > 0) {
        continue; // shouldn't happen if letter count is 55
      }
      return { success: true, grid, wordPaths };
    }
  }

  return { success: false, reason: 'Could not pack words into grid after max attempts' };
}

// ── Word Uniqueness Validation ────────────────────────────────────────

/**
 * Check that every word in the puzzle has exactly one valid path.
 * Returns { unique: true } or { unique: false, duplicateWords: [...] }
 */
function validateUniqueness(grid, allWords) {
  const duplicates = [];
  for (const word of allWords) {
    const count = grid.countWordPaths(word, 2);
    if (count !== 1) {
      duplicates.push({ word, paths: count });
    }
  }
  return { unique: duplicates.length === 0, duplicateWords: duplicates };
}

// ── Word List Auto-Adjustment ─────────────────────────────────────────

/**
 * Check if any word in `allWords` is a substring of another.
 */
function hasSubstringConflict(word, allWords) {
  for (const existing of allWords) {
    if (word === existing) continue;
    if (existing.includes(word) || word.includes(existing)) return true;
  }
  return false;
}

/**
 * Find a filler word of exactly `len` letters that doesn't conflict with `allWords`.
 */
function findFiller(len, allWords) {
  const pool = FILLER_WORDS[len];
  if (!pool) return null;
  // Shuffle for variety
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const w of shuffled) {
    if (allWords.includes(w)) continue;
    if (hasSubstringConflict(w, allWords)) continue;
    return w;
  }
  return null;
}

/**
 * Mutate theme.words so total letters == TOTAL_CELLS.
 * Keeps the spangram untouched; only adjusts the word list.
 * Returns { adjusted: boolean, changes: string[] }.
 */
function adjustWordList(theme) {
  const changes = [];
  const spangram = theme.spangram;
  let words = theme.words;

  // Phase 1: Remove invalid words (wrong length, dupes, substring conflicts)
  const clean = [];
  const seen = new Set([spangram]);
  for (const w of words) {
    if (w.length < 3 || w.length > 8) {
      changes.push(`removed "${w}" (length ${w.length})`);
      continue;
    }
    if (seen.has(w)) {
      changes.push(`removed duplicate "${w}"`);
      continue;
    }
    if (hasSubstringConflict(w, [spangram, ...clean])) {
      changes.push(`removed "${w}" (substring conflict)`);
      continue;
    }
    seen.add(w);
    clean.push(w);
  }
  words = clean;

  const totalLetters = () => spangram.length + words.reduce((s, w) => s + w.length, 0);

  // Phase 2: If over target, remove shortest words
  while (totalLetters() > TOTAL_CELLS && words.length > 4) {
    // Sort ascending by length, remove shortest
    words.sort((a, b) => a.length - b.length);
    const removed = words.shift();
    changes.push(`removed "${removed}" (over target)`);
  }

  // Phase 3: If under target, add fillers
  let deficit = TOTAL_CELLS - totalLetters();
  let fillersAdded = 0;
  const MAX_FILLERS = 5;

  while (deficit > 0 && fillersAdded < MAX_FILLERS) {
    const allWords = [spangram, ...words];

    if (deficit >= 3) {
      // Try to find a filler of exactly `deficit` length first (perfect fit)
      // Then work down to 3
      let added = false;
      for (let len = Math.min(deficit, 8); len >= 3; len--) {
        const filler = findFiller(len, allWords);
        if (filler) {
          words.push(filler);
          changes.push(`added "${filler}" (+${filler.length})`);
          fillersAdded++;
          added = true;
          break;
        }
      }
      if (!added) break; // no valid fillers available
    } else {
      // deficit is 1 or 2 — can't add a word that short.
      // Swap: remove one existing word of length N, add filler of length N + deficit.
      let swapped = false;
      // Try swapping shortest words first
      const sorted = [...words].sort((a, b) => a.length - b.length);
      for (const candidate of sorted) {
        const targetLen = candidate.length + deficit;
        if (targetLen > 8) continue;
        const remaining = allWords.filter(w => w !== candidate);
        const filler = findFiller(targetLen, remaining);
        if (filler) {
          words = words.filter(w => w !== candidate);
          words.push(filler);
          changes.push(`swapped "${candidate}" (${candidate.length}) → "${filler}" (${filler.length})`);
          swapped = true;
          break;
        }
      }
      if (!swapped) break; // can't fix this deficit
    }

    deficit = TOTAL_CELLS - totalLetters();
  }

  theme.words = words;
  const final = totalLetters();
  const adjusted = changes.length > 0;

  if (final !== TOTAL_CELLS) {
    // Couldn't fix it — let validation reject and retry
    if (adjusted) changes.push(`still ${final} letters after adjustment`);
    return { adjusted, changes };
  }

  return { adjusted, changes };
}

// ── Full Puzzle Generation ────────────────────────────────────────────

async function generatePuzzle(apiKey, options = {}) {
  const {
    model = DEFAULT_MODEL,
    maxLLMRetries = 4,
    maxPackRetries = 5,
    dictionaryCheck = null,
    targetDate = null,
    excludeThemes = []
  } = options;

  // Normalize exclusion list for case-insensitive comparison
  const excludeSet = new Set(excludeThemes.map(t => t.toLowerCase()));

  for (let llmAttempt = 0; llmAttempt < maxLLMRetries; llmAttempt++) {
    let theme;
    try {
      theme = await generateThemeFromLLM(apiKey, model, { targetDate, excludeThemes });
    } catch (err) {
      console.error(`LLM attempt ${llmAttempt + 1} failed:`, err.message);
      if (llmAttempt < maxLLMRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }

    // Normalize
    theme.spangram = theme.spangram.toLowerCase().replace(/[^a-z]/g, '');
    theme.words = theme.words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));

    // Reject duplicate themes
    if (theme.theme && excludeSet.has(theme.theme.toLowerCase())) {
      console.warn(`Theme "${theme.theme}" already used, retrying...`);
      continue;
    }

    // Auto-adjust word list to hit exactly 55 letters
    const adjustment = adjustWordList(theme);
    if (adjustment.adjusted) {
      console.log(`Word list adjusted: ${adjustment.changes.join(', ')}`);
    }

    // Validate
    const validation = validateTheme(theme, dictionaryCheck);
    if (!validation.valid) {
      console.warn(`Theme validation failed (attempt ${llmAttempt + 1}):`, validation.errors);
      continue;
    }

    // Try packing into grid
    for (let packAttempt = 0; packAttempt < maxPackRetries; packAttempt++) {
      const result = packGrid(theme.spangram, theme.words);
      if (result.success) {
        return {
          theme: theme.theme,
          themeHint: theme.themeHint || theme.theme,
          spangram: theme.spangram,
          words: theme.words,
          grid: result.grid,
          wordPaths: result.wordPaths,
          gridString: result.grid.toFlatString(),
          ascii: result.grid.toAscii()
        };
      }
      console.warn(`Pack attempt ${packAttempt + 1} failed: ${result.reason}`);
    }

    console.warn(`Could not pack theme "${theme.theme}" after ${maxPackRetries} tries, retrying LLM...`);
  }

  throw new Error('Failed to generate valid puzzle after all retries');
}

/**
 * Generate multiple distinct puzzles for admin to choose from.
 * Each has a different theme/words/grid. Returns array of puzzle objects.
 */
async function generateMultiplePuzzles(apiKey, count = 3, options = {}) {
  const puzzles = [];

  for (let i = 0; i < count; i++) {
    try {
      console.log(`Generating puzzle option ${i + 1}/${count}...`);
      const puzzle = await generatePuzzle(apiKey, options);
      puzzles.push(puzzle);
    } catch (err) {
      console.warn(`Puzzle option ${i + 1} failed: ${err.message}`);
    }
    // Brief pause between LLM calls
    if (i < count - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // Fallback: fill remaining slots from static themes if LLM didn't produce enough
  if (puzzles.length < count) {
    const themes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'themes.json'), 'utf-8'));
    const validThemes = themes.filter(t => {
      const total = t.spangram.length + t.words.reduce((s, w) => s + w.length, 0);
      return total === TOTAL_CELLS && validateTheme(t).valid;
    });
    // Shuffle and pick unused themes (also check batch-level exclusions)
    const shuffled = validThemes.sort(() => Math.random() - 0.5);
    const batchExcludes = new Set((options.excludeThemes || []).map(t => t.toLowerCase()));
    const usedThemes = new Set(puzzles.map(p => p.theme.toLowerCase()));
    for (const t of shuffled) {
      if (puzzles.length >= count) break;
      if (usedThemes.has(t.theme.toLowerCase())) continue;
      if (batchExcludes.has(t.theme.toLowerCase())) continue;
      try {
        puzzles.push(generateFromStaticTheme(t));
      } catch {}
    }
  }

  console.log(`Generated ${puzzles.length}/${count} puzzle options`);
  return puzzles;
}

// ── Fallback: Generate from static themes ─────────────────────────────

function generateFromStaticTheme(themeData) {
  const { theme, themeHint, spangram, words } = themeData;

  const validation = validateTheme(themeData);
  if (!validation.valid) {
    throw new Error(`Static theme invalid: ${validation.errors.join(', ')}`);
  }

  const result = packGrid(spangram, words, 200);
  if (!result.success) {
    throw new Error(`Could not pack static theme "${theme}": ${result.reason}`);
  }

  return {
    theme,
    themeHint: themeHint || theme,
    spangram,
    words,
    grid: result.grid,
    wordPaths: result.wordPaths,
    gridString: result.grid.toFlatString(),
    ascii: result.grid.toAscii()
  };
}

// ── Serialize puzzle for storage (without grid object) ────────────────

function serializePuzzle(puzzle) {
  const pathsObj = {};
  for (const [word, path] of Object.entries(puzzle.wordPaths)) {
    pathsObj[word] = path;
  }
  return {
    theme: puzzle.theme,
    themeHint: puzzle.themeHint,
    spangram: puzzle.spangram,
    words: puzzle.words,
    gridString: puzzle.gridString,
    wordPaths: pathsObj,
    ascii: puzzle.ascii
  };
}

function deserializePuzzle(data) {
  const grid = TriangleGrid.fromFlatString(data.gridString);
  return {
    ...data,
    grid
  };
}

// ── AI Image Generation ───────────────────────────────────────────────

function buildThemeImagePrompt(theme, options = {}) {
  const {
    targetDate = null,
    themeHint = ''
  } = options;
  const dateContext = buildDateContext(targetDate);
  const clueText = themeHint ? `Puzzle clue: "${themeHint}". ` : '';
  const dateText = dateContext
    ? `This artwork is for ${dateContext.label}. ${dateContext.imageGuidance} `
    : '';

  return `Create one striking image for the word-puzzle theme "${theme}". ` +
    clueText +
    dateText +
    `Style: abstract realism, realistic textures and lighting, surreal composition, ` +
    `cinematic atmosphere, layered symbolism, refined color palette, tactile materials, ` +
    `dreamlike but believable details. Avoid cartoon style, mascots, flat vector art, ` +
    `or childish illustration. No text, letters, numbers, logos, or watermarks in the image.`;
}

/**
 * Generate a single theme image. Returns filename or null.
 */
async function _generateSingleImage(apiKey, promptOrTheme, filename) {
  const prompt = promptOrTheme.length > 100
    ? promptOrTheme
    : buildThemeImagePrompt(promptOrTheme);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wordtycoon.live',
        'X-Title': 'Triangled'
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text']
      })
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Image generation API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    let base64Data = null;

    if (message?.images?.length > 0) {
      const url = message.images[0]?.image_url?.url;
      if (url && url.startsWith('data:image/')) {
        base64Data = url.split(',')[1];
      }
    }

    if (!base64Data && Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith('data:image/')) {
            base64Data = url.split(',')[1];
            break;
          }
        }
      }
    }

    if (!base64Data) {
      console.warn('No image data in API response');
      return null;
    }

    const imgPath = path.join(PUZZLES_DIR, filename);
    fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
    console.log(`Theme image saved: ${imgPath}`);
    return filename;

  } catch (err) {
    console.error('Image generation failed:', err.message);
    return null;
  }
}

/**
 * Generate one or more theme images.
 * Returns array of filenames. Final chosen image will be renamed to dateStr.jpg.
 */
async function generateThemeImages(apiKey, theme, dateStr, count = 1, options = {}) {
  if (!apiKey) return [];

  console.log(`Generating ${count} abstract-realist theme image(s) for "${theme}"...`);
  const results = [];
  const prompt = buildThemeImagePrompt(theme, {
    targetDate: dateStr,
    ...options
  });
  for (let i = 0; i < count; i++) {
    const filename = `${dateStr}_option${i + 1}.jpg`;
    console.log(`  Option ${i + 1}: abstract realism`);
    const generated = await _generateSingleImage(apiKey, prompt, filename);
    if (generated) {
      results.push(generated);
    }
    if (i < count - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`Generated ${results.length}/${count} images`);
  return results;
}

/**
 * Select one of the generated image options as the final image for the day.
 */
function selectImage(dateStr, optionNumber) {
  const destFile = `${dateStr}.jpg`;
  const destPath = path.join(PUZZLES_DIR, destFile);
  const optionFiles = fs.existsSync(PUZZLES_DIR)
    ? fs.readdirSync(PUZZLES_DIR)
      .filter(file => file.startsWith(`${dateStr}_option`) && file.endsWith('.jpg'))
      .sort()
    : [];

  // Try the requested option first
  let srcFile = `${dateStr}_option${optionNumber}.jpg`;
  let srcPath = path.join(PUZZLES_DIR, srcFile);

  // If the requested option doesn't exist, fall back to ANY available option
  if (!fs.existsSync(srcPath)) {
    console.warn(`[selectImage] Requested option ${optionNumber} for ${dateStr} not found, searching for any available option...`);
    const fallbackFile = optionFiles[0];
    const fallback = fallbackFile
      ? {
          file: fallbackFile,
          path: path.join(PUZZLES_DIR, fallbackFile),
          num: parseInt((fallbackFile.match(/_option(\d+)\.jpg$/) || [])[1], 10) || 1
        }
      : null;
    if (!fallback) {
      console.error(`[selectImage] No image options exist for ${dateStr} — cannot select`);
      return false;
    }
    console.warn(`[selectImage] Using fallback option ${fallback.num} (${fallback.file}) instead`);
    srcFile = fallback.file;
    srcPath = fallback.path;
  }

  try {
    fs.copyFileSync(srcPath, destPath);
    console.log(`[selectImage] OK — copied ${srcFile} -> ${destFile}`);
  } catch (err) {
    console.error(`[selectImage] FAIL — could not copy ${srcFile}: ${err.message}`);
    return false;
  }

  // Clean up other options
  for (const optionFile of optionFiles) {
    const opt = path.join(PUZZLES_DIR, optionFile);
    if (fs.existsSync(opt)) {
      try { fs.unlinkSync(opt); } catch {}
    }
  }

  return true;
}

// Legacy single-image wrapper
async function generateThemeImage(apiKey, theme, dateStr, options = {}) {
  const results = await generateThemeImages(apiKey, theme, dateStr, 1, options);
  if (results.length === 0) return null;
  return results[0];
}

module.exports = {
  generatePuzzle,
  generateMultiplePuzzles,
  generateFromStaticTheme,
  generateSingleImage: _generateSingleImage,
  buildThemeImagePrompt,
  generateThemeImage,
  generateThemeImages,
  selectImage,
  validateTheme,
  adjustWordList,
  packGrid,
  serializePuzzle,
  deserializePuzzle
};
