// daily-puzzle.js - Build (or fetch) the puzzle for today.
//
// Date is fixed in the timezone given by `DAILY_TIMEZONE` env (default
// America/Edmonton, matching Word Tycoon family). Once a puzzle is built for
// a date it's cached in the `daily_puzzles` DB table — server restarts get
// the same puzzle for the rest of the day, and a player who plays at 11:59pm
// finishes the same puzzle the next minute.
//
// Daily puzzles use the same article+grid pipeline as multiplayer rounds.
// They're "deterministic" only in that they're committed once per date — the
// article picker still uses Math.random when first-building. Players on the
// same day get the same puzzle.

const db = require('./database');
const wordlist = require('./wordlist');
const { buildArticleRound } = require('./article');
const { buildGrid, pickDims } = require('./grid');
const { buildSemanticTrie } = require('./semantic-trie');
const { rankTop } = require('./searchle-client');
const { rankBatch } = require('./searchle-client');

const TZ = process.env.DAILY_TIMEZONE || 'America/Edmonton';

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function getTodayDate() {
  return DATE_FMT.format(new Date()); // YYYY-MM-DD
}

let buildInflight = null;

async function buildPuzzleForDate(puzzleDate) {
  const trie = wordlist.getTrie();
  if (!trie || trie.wordCount < 1000) {
    throw new Error('daily-puzzle: trie not ready');
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const article = await buildArticleRound(trie, { count: 5 , maxTotalLetters: 45, maxAttempts: 600 });
      if (!article) throw new Error('no viable article');

      const targetSlugs = article.targets.map((t) => t.word);
      const titleAsTargets = article.titleWords.filter((w) => w.length >= 4 && w.length <= 9 && trie.has(w));
      const allToPlace = Array.from(new Set([...targetSlugs, ...titleAsTargets]));
      const totalLetters = allToPlace.reduce((s, w) => s + w.length, 0);
      const dims = pickDims(totalLetters);
      const _topic = await buildSemanticTrie({ titleWords: article.titleWords, baseTrie: trie, rankTop, frequencyMap: wordlist.getFrequencyMap() });
      if (_topic.fellBack) console.log(`[Daily] semantic trie undersized (${_topic.size} semantic words) for "${article.title}"`);
      const built = buildGrid(allToPlace, trie, {
        rows: dims.rows,
        cols: dims.cols,
        minWordLength: 3,
        scoringTrie: _topic.trie,
      });

      // Validate target against Searchle and fetch vocabulary size.
      let totalRankedWords = 0;
      let rankTarget = null;
      for (const t of article.targets) {
        if (!t || !t.word) continue;
        try {
          const probe = await rankBatch(t.word, []);
          rankTarget = t.word;
          totalRankedWords = probe.totalRankedWords || 0;
          break;
        } catch (e) {
          console.log(`[Daily] target word "${t.word}" not rankable by Searchle: ${e.message}`);
        }
      }
      if (!rankTarget || !totalRankedWords) {
        throw new Error('No target word is rankable by Searchle');
      }

      const payload = {
        puzzleDate,
        articleKey: article.key,
        articleTitle: article.title,
        rows: built.rows,
        cols: built.cols,
        grid: built.grid,
        targets: article.targets,
        titleWords: article.titleWords,
        articlePlaintext: article.plaintext,
        totalGridWords: built.allWords.size,
        totalRankedWords,
        rankTarget,
      };
      db.saveDailyPuzzle(payload);
      console.log(`[Daily] Built puzzle for ${puzzleDate}: "${article.title}" (${built.rows}x${built.cols}, ${built.allWords.size} words)`);
      return payload;
    } catch (e) {
      console.log(`[Daily] build attempt ${attempt + 1}/6 for ${puzzleDate} failed: ${e.message}`);
    }
  }
  throw new Error(`Could not build daily puzzle for ${puzzleDate}`);
}

// Returns the puzzle for `puzzleDate` (default: today). Builds + caches it on
// first call of the day. Concurrent calls share one in-flight build.
async function getOrBuildPuzzle(puzzleDate) {
  const date = puzzleDate || getTodayDate();
  const cached = db.getDailyPuzzle(date);
  if (cached) return normalizeCached(cached);

  if (buildInflight && buildInflight._date === date) return buildInflight;

  const promise = buildPuzzleForDate(date);
  promise._date = date;
  buildInflight = promise;
  try {
    const built = await promise;
    return built;
  } finally {
    if (buildInflight === promise) buildInflight = null;
  }
}

function normalizeCached(row) {
  return {
    puzzleDate: row.puzzle_date,
    articleKey: row.article_key,
    articleTitle: row.article_title,
    rows: row.rows,
    cols: row.cols,
    grid: row.grid,
    targets: row.targets,
    titleWords: row.titleWords,
    articlePlaintext: row.article_plaintext,
    totalGridWords: row.total_grid_words,
    totalRankedWords: row.total_ranked_words,
    rankTarget: row.rank_target,
  };
}

module.exports = { getOrBuildPuzzle, getTodayDate, TZ };
