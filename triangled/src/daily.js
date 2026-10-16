/**
 * Daily Puzzle Lifecycle
 *
 * - Generate puzzle for a given date
 * - Store pending/approved/rejected puzzles as JSON files
 * - Serve the current approved puzzle
 */

const fs = require('fs');
const path = require('path');
const {
  generateMultiplePuzzles,
  generateFromStaticTheme,
  generateSingleImage,
  buildThemeImagePrompt,
  selectImage,
  serializePuzzle
} = require('./puzzle-generator');

const PUZZLES_DIR = path.join(__dirname, '..', 'data', 'puzzles');
const THEMES_FILE = path.join(__dirname, '..', 'data', 'themes.json');
const DEFAULT_BATCH_DAYS = 30;
const DEFAULT_PUZZLE_OPTIONS = 1;

// Ensure puzzles directory exists
if (!fs.existsSync(PUZZLES_DIR)) {
  fs.mkdirSync(PUZZLES_DIR, { recursive: true });
}

function dateKey(date) {
  if (!date) date = new Date();
  if (typeof date === 'string') {
    // Sanitize: only allow YYYY-MM-DD format
    const clean = date.replace(/[^0-9-]/g, '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return edmontonDate();
    return clean;
  }
  return edmontonDate(date);
}

// Use Edmonton timezone for daily puzzle rotation (matches other games)
function edmontonDate(d) {
  const dt = d || new Date();
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });
}

function puzzlePath(date) {
  return path.join(PUZZLES_DIR, `${dateKey(date)}.json`);
}

function addDays(date, daysToAdd) {
  const key = dateKey(date);
  const [year, month, day] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + daysToAdd);
  return dt.toISOString().slice(0, 10);
}

// ── Storage ───────────────────────────────────────────────────────────

function savePuzzle(date, puzzleData, status = 'pending') {
  const serialized = typeof puzzleData.grid === 'object' && puzzleData.grid.cells
    ? serializePuzzle(puzzleData)
    : puzzleData;

  const record = {
    date: dateKey(date),
    status, // 'pending', 'approved', 'rejected'
    createdAt: new Date().toISOString(),
    puzzle: serialized
  };

  fs.writeFileSync(puzzlePath(date), JSON.stringify(record, null, 2));
  return record;
}

function loadPuzzle(date) {
  const p = puzzlePath(date);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function approvePuzzle(date) {
  const record = loadPuzzle(date);
  if (!record) return null;
  record.status = 'approved';
  record.approvedAt = new Date().toISOString();
  fs.writeFileSync(puzzlePath(date), JSON.stringify(record, null, 2));
  return record;
}

function rejectPuzzle(date) {
  const record = loadPuzzle(date);
  if (!record) return null;
  record.status = 'rejected';
  record.rejectedAt = new Date().toISOString();
  fs.writeFileSync(puzzlePath(date), JSON.stringify(record, null, 2));
  return record;
}

// ── Generation ────────────────────────────────────────────────────────

/**
 * Generate daily puzzle options for admin review.
 * Creates one or more puzzle options, each with a matching image.
 */
async function generateDailyPuzzle(date, apiKey, options = {}) {
  const key = dateKey(date);
  const {
    puzzleCount = DEFAULT_PUZZLE_OPTIONS,
    overwriteExisting = false,
    excludeThemes = []
  } = options;
  const optionCount = Math.max(1, parseInt(puzzleCount, 10) || DEFAULT_PUZZLE_OPTIONS);

  const existing = loadPuzzle(key);
  if (existing && !overwriteExisting) {
    console.log(`Puzzle record for ${key} already exists with status "${existing.status}"`);
    return existing;
  }

  // Generate puzzle options (different themes/words)
  let puzzleOptions = [];
  if (apiKey) {
    console.log(`Generating ${optionCount} puzzle option(s) for ${key} via LLM...`);
    puzzleOptions = await generateMultiplePuzzles(apiKey, optionCount, {
      ...options,
      targetDate: key,
      excludeThemes
    });
  }

  // Fallback: fill remaining slots from static themes to always get the requested count
  if (puzzleOptions.length < optionCount) {
    console.log(`Filling ${optionCount - puzzleOptions.length} slot(s) from static themes...`);
    const themes = JSON.parse(fs.readFileSync(THEMES_FILE, 'utf-8'));
    const valid = themes.filter(t => {
      const total = t.spangram.length + t.words.reduce((s, w) => s + w.length, 0);
      return total === 55;
    });
    const usedThemes = new Set([
      ...puzzleOptions.map(p => p.theme.toLowerCase()),
      ...excludeThemes.map(t => t.toLowerCase())
    ]);
    const shuffled = valid.sort(() => Math.random() - 0.5);
    for (const t of shuffled) {
      if (puzzleOptions.length >= optionCount) break;
      if (usedThemes.has(t.theme.toLowerCase())) continue;
      try {
        puzzleOptions.push(generateFromStaticTheme(t));
        usedThemes.add(t.theme);
      } catch {}
    }
  }

  // Generate one image per puzzle theme (each puzzle gets its own image)
  const imageOptions = [];
  if (apiKey) {
    for (let i = 0; i < puzzleOptions.length; i++) {
      const puzzle = puzzleOptions[i];
      const filename = `${key}_option${i + 1}.jpg`;
      const prompt = buildThemeImagePrompt(puzzle.theme, {
        targetDate: key,
        themeHint: puzzle.themeHint
      });
      try {
        console.log(`Generating image ${i + 1} for theme "${puzzle.theme}"...`);
        const result = await generateSingleImage(apiKey, prompt, filename);
        imageOptions.push(result || null);
      } catch (err) {
        console.warn(`Image ${i + 1} failed:`, err.message);
        imageOptions.push(null);
      }
      if (i < puzzleOptions.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Serialize all puzzle options
  const serializedOptions = puzzleOptions.map((p, i) => {
    const s = typeof p.grid === 'object' && p.grid.cells ? serializePuzzle(p) : p;
    return { index: i + 1, ...s };
  });

  // Save as a multi-option record
  const record = {
    date: key,
    status: 'pending',
    createdAt: new Date().toISOString(),
    puzzleOptions: serializedOptions,
    imageOptions,
    selectedPuzzle: null,
    selectedImage: null,
    puzzle: serializedOptions[0] || null
  };

  fs.writeFileSync(puzzlePath(key), JSON.stringify(record, null, 2));
  console.log(`${serializedOptions.length} puzzle options + ${imageOptions.filter(Boolean).length} images for ${key} (pending)`);
  return record;
}

async function generatePuzzleBatch(startDate, apiKey, options = {}) {
  const startKey = dateKey(startDate || new Date());
  const {
    days = DEFAULT_BATCH_DAYS,
    overwriteExisting = false,
    pauseMs = 1500,
    puzzleCount = DEFAULT_PUZZLE_OPTIONS
  } = options;

  const totalDays = Math.max(1, parseInt(days, 10) || DEFAULT_BATCH_DAYS);
  const results = [];
  const usedThemes = []; // Track themes across the batch to prevent duplicates

  for (let offset = 0; offset < totalDays; offset++) {
    const targetDate = addDays(startKey, offset);
    const existing = loadPuzzle(targetDate);

    if (existing && !overwriteExisting) {
      // Track existing themes too so new days don't duplicate them
      const existingTheme = existing.puzzle?.theme || existing.puzzleOptions?.[0]?.theme;
      if (existingTheme) usedThemes.push(existingTheme);
      results.push({
        date: targetDate,
        status: 'skipped',
        reason: `already_${existing.status || 'present'}`,
        theme: existingTheme || null
      });
      continue;
    }

    try {
      const record = await generateDailyPuzzle(targetDate, apiKey, {
        ...options,
        overwriteExisting,
        puzzleCount,
        excludeThemes: [...usedThemes]
      });
      const theme = record.puzzle?.theme || record.puzzleOptions?.[0]?.theme || null;
      if (theme) usedThemes.push(theme);
      results.push({
        date: targetDate,
        status: 'generated',
        theme,
        imageCount: Array.isArray(record.imageOptions) ? record.imageOptions.filter(Boolean).length : 0
      });
    } catch (err) {
      console.error(`[generatePuzzleBatch] Failed for ${targetDate}:`, err.message);
      results.push({
        date: targetDate,
        status: 'failed',
        error: err.message
      });
    }

    if (offset < totalDays - 1 && pauseMs > 0) {
      await new Promise(r => setTimeout(r, pauseMs));
    }
  }

  return {
    startDate: startKey,
    days: totalDays,
    results
  };
}

/**
 * Admin selects which puzzle option and which image to use. Approves the puzzle.
 */
function selectPuzzleAndImage(date, puzzleIndex, imageIndex) {
  const record = loadPuzzle(date);
  if (!record || !record.puzzleOptions) {
    console.warn(`[selectPuzzleAndImage] No puzzle options found for ${date}`);
    return null;
  }

  const key = dateKey(date);
  const chosen = record.puzzleOptions[puzzleIndex - 1];
  if (!chosen) {
    console.warn(`[selectPuzzleAndImage] Puzzle option ${puzzleIndex} not found for ${date}`);
    return null;
  }

  record.puzzle = chosen;
  record.selectedPuzzle = puzzleIndex;

  // Image selection: try requested index, fall back to any available image
  const hasImageOptions = record.imageOptions && record.imageOptions.length > 0;
  if (hasImageOptions) {
    const imgOk = selectImage(key, imageIndex || 1);
    if (imgOk) {
      record.puzzle.imageFile = `${key}.jpg`;
      record.selectedImage = imageIndex || 1;
      console.log(`[selectPuzzleAndImage] Image set on puzzle for ${key}`);
    } else {
      console.error(`[selectPuzzleAndImage] WARNING: image selection FAILED for ${key} — puzzle approved without image`);
      // Don't set imageFile — getTodayPuzzle will return imageUrl:null and the client will use fallback
    }
  } else {
    console.warn(`[selectPuzzleAndImage] No imageOptions for ${key} — puzzle approved without image`);
  }

  record.status = 'approved';
  record.approvedAt = new Date().toISOString();
  fs.writeFileSync(puzzlePath(key), JSON.stringify(record, null, 2));
  console.log(`[selectPuzzleAndImage] APPROVED puzzle=${puzzleIndex} image=${imageIndex} for ${key} imageFile=${record.puzzle.imageFile || 'none'}`);
  return record;
}

// ── Serving ───────────────────────────────────────────────────────────

function getTodayPuzzle() {
  const today = dateKey(new Date());
  const record = loadPuzzle(today);

  if (!record || record.status !== 'approved') {
    return null;
  }

  // Return client-safe puzzle data (no word paths — that's the answer!)
  const p = record.puzzle;

  // Check if image file exists
  let imageUrl = null;
  if (p.imageFile) {
    const imgPath = path.join(PUZZLES_DIR, p.imageFile);
    if (fs.existsSync(imgPath)) {
      imageUrl = `/api/daily/images/${p.imageFile}`;
    }
  }

  return {
    date: today,
    theme: p.theme,
    themeHint: p.themeHint,
    gridString: p.gridString,
    wordCount: p.words.length + 1, // including spangram
    spangramLength: p.spangram.length,
    imageUrl
  };
}

// Get full puzzle data (for admin/verification)
function getTodayPuzzleFull() {
  const today = dateKey(new Date());
  return loadPuzzle(today);
}

// Get puzzle for any date (admin)
function getPuzzleForDate(date) {
  return loadPuzzle(date);
}

// List all puzzles
function listPuzzles() {
  if (!fs.existsSync(PUZZLES_DIR)) return [];
  return fs.readdirSync(PUZZLES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const record = JSON.parse(fs.readFileSync(path.join(PUZZLES_DIR, f), 'utf-8'));
      return {
        date: record.date,
        status: record.status,
        theme: record.puzzle?.theme
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

module.exports = {
  generateDailyPuzzle,
  generatePuzzleBatch,
  selectPuzzleAndImage,
  getTodayPuzzle,
  getTodayPuzzleFull,
  getPuzzleForDate,
  approvePuzzle,
  rejectPuzzle,
  savePuzzle,
  loadPuzzle,
  listPuzzles,
  dateKey,
  addDays
};
