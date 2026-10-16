// Validates LLM-generated WikiSearchle articles against the v3 prompt
// rules. Pure functions, no I/O, no SDK. Used by:
//   - the batch generator (decides whether to retry/cache/fall back)
//   - the runtime server (sanity-check cached articles on load)

// Hard rules: any failure means the output is unusable as-is.
// Soft warnings: keep the article but flag it for human review.
//
// Returns { ok: bool, hard: string[], soft: string[] } so the caller
// can decide. ok = (hard.length === 0).

const STOPLIST = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','for','with',
  'by','as','from','is','are','was','were','be','it','its','this','that',
]);

function normalizeNorm(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function tokenizeForBigram(text) {
  return String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function splitParagraphs(text) {
  if (!text) return [];
  return String(text).split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

function countWords(text) {
  const tokens = String(text || '').match(/[\p{L}\p{N}]+/gu);
  return tokens ? tokens.length : 0;
}

function hasWord(haystack, norm) {
  if (!norm) return false;
  // \b doesn't quite work for Unicode, so we match boundaries manually.
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(norm)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  return re.test(haystack);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sliding-window check for any N-token verbatim phrase shared between
// the article and the source reference. Tokens are lowercased
// alphanumeric runs; punctuation differences don't count.
function findLongestSharedPhrase(article, source, minLen = 6) {
  const a = tokenizeForBigram(article);
  const s = tokenizeForBigram(source);
  if (a.length < minLen || s.length < minLen) return null;
  const sourceSet = new Set();
  for (let i = 0; i + minLen <= s.length; i++) {
    sourceSet.add(s.slice(i, i + minLen).join(' '));
  }
  for (let i = 0; i + minLen <= a.length; i++) {
    const phrase = a.slice(i, i + minLen).join(' ');
    if (sourceSet.has(phrase)) return phrase;
  }
  return null;
}

// Build the consecutive-bigram set from titleNorms in their natural
// reading order. For ["civil","rights","movement"] returns the bigrams
// "civil rights" and "rights movement" (those would be partial-title
// reconstruction). Single-norm titles return [] since rule 3 doesn't
// apply to them.
function consecutiveTitleBigrams(titleNormsInOrder) {
  const out = [];
  // Dedupe while preserving order — keep first occurrence per norm.
  const seen = new Set();
  const ordered = [];
  for (const n of titleNormsInOrder) {
    if (n && !seen.has(n)) { seen.add(n); ordered.push(n); }
  }
  if (ordered.length < 2) return out;
  for (let i = 0; i + 1 < ordered.length; i++) {
    out.push(`${ordered[i]} ${ordered[i + 1]}`);
  }
  return out;
}

/**
 * Validate a generated article.
 * @param {string} text - the model's raw output
 * @param {object} ctx
 *   - title: article title as displayed
 *   - titleWordNorms: array of normalized target words IN TITLE ORDER
 *                     (may contain duplicates; we dedupe internally)
 *   - sourceText: the Wikipedia reference text that was given to the model
 *   - wordCountTarget: { min, max, hardMin, hardMax }
 */
function validate(text, ctx) {
  const hard = [];
  const soft = [];

  if (!text || typeof text !== 'string') {
    hard.push('empty output');
    return { ok: false, hard, soft };
  }

  const trimmed = text.trim();

  // UNSAFE sentinel — model declined.
  if (trimmed === 'UNSAFE') {
    hard.push('UNSAFE sentinel');
    return { ok: false, hard, soft };
  }

  // Paragraph count.
  const paragraphs = splitParagraphs(trimmed);
  if (paragraphs.length !== 4) {
    hard.push(`paragraph count is ${paragraphs.length}, expected 4`);
  }

  // Word count. Haiku tends to write 180-220 words for our 4-paragraph
  // ask; soft range matches that band so only truly-out-of-bounds outputs
  // get flagged. Hard cap stays at 220 (longer breaks the OBS overlay).
  const wc = countWords(trimmed);
  const cfg = ctx.wordCountTarget || { min: 130, max: 220, hardMin: 100, hardMax: 220 };
  if (wc < cfg.hardMin) hard.push(`word count ${wc} below hard min ${cfg.hardMin}`);
  if (wc > cfg.hardMax) hard.push(`word count ${wc} above hard max ${cfg.hardMax}`);
  if (wc >= cfg.hardMin && wc <= cfg.hardMax && (wc < cfg.min || wc > cfg.max)) {
    soft.push(`word count ${wc} outside soft range [${cfg.min}, ${cfg.max}]`);
  }

  // Title-word presence in body (any of paragraphs 2-4).
  const norms = (ctx.titleWordNorms || []).map(normalizeNorm).filter(Boolean);
  const seenNorms = new Set();
  const titleNormsOrdered = norms.filter((n) => {
    if (seenNorms.has(n)) return false;
    seenNorms.add(n);
    return true;
  });

  const para1 = paragraphs[0] || '';
  const parasBody = paragraphs.slice(1).join('\n\n');

  for (const n of titleNormsOrdered) {
    if (!hasWord(parasBody, n)) {
      hard.push(`title norm "${n}" missing from paragraphs 2-4`);
    }
    if (hasWord(para1, n)) {
      hard.push(`title norm "${n}" appears in paragraph 1`);
    }
  }

  // Multi-word title checks — full title verbatim + adjacent bigrams.
  if (titleNormsOrdered.length >= 2) {
    // Full title as a normalized phrase.
    const fullTitlePhrase = titleNormsOrdered.join(' ');
    const bodyNormPhrase = tokenizeForBigram(trimmed).join(' ');
    if (bodyNormPhrase.includes(fullTitlePhrase)) {
      hard.push(`full title appears as adjacent words: "${fullTitlePhrase}"`);
    }
    // Consecutive bigrams (e.g., "civil rights", "rights movement").
    const bigrams = consecutiveTitleBigrams(titleNormsOrdered);
    for (const bg of bigrams) {
      if (bodyNormPhrase.includes(bg)) {
        // Only fail if it's not already covered by the full-title check.
        if (bg !== fullTitlePhrase) {
          hard.push(`adjacent title bigram "${bg}" appears in body`);
        }
      }
    }
  }

  // Soft: 6+ word verbatim phrase from source.
  if (ctx.sourceText) {
    const phrase = findLongestSharedPhrase(trimmed, ctx.sourceText, 6);
    if (phrase) soft.push(`6+ word phrase shared with source: "${phrase}"`);
  }

  return { ok: hard.length === 0, hard, soft };
}

module.exports = {
  validate,
  splitParagraphs,
  countWords,
  hasWord,
  consecutiveTitleBigrams,
  findLongestSharedPhrase,
};
