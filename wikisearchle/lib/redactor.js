// WikiWord — article tokenizer, redactor, and reveal matcher.
//
// A round holds:
//   - paragraphs: [[token, ...], ...]  // each paragraph is an ordered token stream
//   - titleTokens: [token, ...]
//   - revealed: Set<string>            // normalized lowercase word forms that have been revealed
//   - targetNormalized: string         // the Searchle target word, lowercase
//
// A token is either:
//   { type: "word", text, norm, isStop, revealed }
//   { type: "space", text }            // whitespace/punctuation passthrough
//
// The "stop" flag pre-reveals a small list of structural words. Really minimal
// per product direction — just the words that keep sentence scaffolding visible.

// Fixed redaction-box width for the target word's body occurrences while it
// remains hidden. Decoupled from the word's real length so players can't
// infer the title by the letter count.
const TARGET_PLACEHOLDER_LEN = 8;

const STOPLIST = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'as', 'from',
  'is', 'are', 'was', 'were', 'be',
  'it', 'its', 'this', 'that',
  'all', 'both', 'each', 'every', 'some', 'any', 'no', 'not',
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
  'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'they', 'them', 'their', 'theirs',
]);

function normalize(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Deterministic PRNG seeded by an integer. Used to shuffle title/paragraph
// display order stably per round so the layout doesn't reshuffle on every
// re-render but still differs between rounds.
function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const out = arr.slice();
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

// Split a text block into alternating word / non-word chunks while preserving order.
// Returns an array of tokens.
function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;
  // Collapse thousands-separator commas so "600,000" / "1,000,000" tokenize
  // as a single number rather than "600" + "000" / three separate fragments.
  // Only commas flanked by digits are removed — ordinary sentence commas stay.
  text = text.replace(/(\d),(?=\d)/g, '$1');
  // \p{L}\p{N}\p{M} so diacritics/combining marks stay with their letter
  const re = /([\p{L}\p{N}\p{M}]+(?:'[\p{L}]+)?)|([^\p{L}\p{N}\p{M}]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      const word = m[1];
      const norm = normalize(word);
      const digitCount = (norm.match(/\d/g) || []).length;
      tokens.push({
        type: 'word',
        text: word,
        norm,
        isStop: STOPLIST.has(norm),
        // Flagged when the normalized form starts with a digit — covers
        // "1920", "1920s", "3rd", etc. The client paints the redaction
        // box in the orange accent color so numbers stand out. digitCount
        // drives the "N DIGIT(S)" label and the number-scoring tier.
        isNumber: /^\d/.test(norm),
        digitCount,
        revealed: false,
      });
    } else {
      tokens.push({ type: 'space', text: m[2] });
    }
  }
  return tokens;
}

// Assign a per-paragraph sentenceId to every token. A sentence break is a
// space token containing end-of-sentence punctuation (. ! ?) followed by
// whitespace, AND where the next word begins with an uppercase letter or an
// opening quote/paren. Space tokens keep the sentenceId of the sentence
// *ending* at them, so trailing punctuation travels with the sentence it
// belongs to when the client hides fully-revealed sentences.
function assignSentenceIds(tokens) {
  let sid = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    t.sentenceId = sid;
    if (t.type === 'space' && /[.!?]["')\u201D]?\s/.test(t.text)) {
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type !== 'word') continue;
        if (/^[A-Z\u201C"'(]/.test(tokens[j].text)) sid++;
        break;
      }
    }
  }
}

function tokenizeParagraphs(plaintext) {
  const paragraphs = plaintext
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const toks = tokenize(p);
      assignSentenceIds(toks);
      return toks;
    });
  return paragraphs;
}

function buildRound({ targetWord, articleTitle, leadPlaintext, targetNorms, skippedTitleNorms }) {
  const paragraphs = tokenizeParagraphs(leadPlaintext);
  const titleTokens = tokenize(articleTitle);
  const targetNormalized = normalize(targetWord);

  // Multi-word titles contribute multiple "target" norms — each gets the
  // fixed-width placeholder box treatment while unrevealed, so letter count
  // never leaks. targetNorms is the new preferred input; single-word callers
  // can omit it and we fall back to the single targetNormalized.
  const targetNormSet = new Set(
    Array.isArray(targetNorms) && targetNorms.length
      ? targetNorms.filter(Boolean)
      : [targetNormalized]
  );

  // skippedTitleNorms — title words excluded from the Searchle find-mechanic
  // entirely (typically polysemous/proper-noun words the picker couldn't
  // place in a findable tier). These tokens stay in titleTokens so the full
  // title is recoverable at round-end, but they're marked isSkipped:true so
  // the client can omit them during play and slide them in on the reveal.
  // Excluded from targetNormSet so body occurrences are treated as ordinary
  // body words (not title-protected slots).
  const skippedTitleSet = new Set(
    Array.isArray(skippedTitleNorms) ? skippedTitleNorms.filter(Boolean) : []
  );

  // Per-norm slot id (1, 2, 3 ...) so the client can identify which body
  // redaction boxes correspond to which found target without leaking the
  // norm itself. Order: title-token reading order, then any extras.
  const targetSlotIds = new Map();
  let nextSlotId = 1;
  for (const t of titleTokens) {
    if (t.type === 'word' && targetNormSet.has(t.norm) && !targetSlotIds.has(t.norm)) {
      targetSlotIds.set(t.norm, nextSlotId++);
    }
  }
  for (const n of targetNormSet) {
    if (!targetSlotIds.has(n)) targetSlotIds.set(n, nextSlotId++);
  }

  // Pre-reveal stoplist tokens.
  for (const p of paragraphs) for (const t of p) if (t.type === 'word' && t.isStop) t.revealed = true;
  for (const t of titleTokens) if (t.type === 'word' && t.isStop) t.revealed = true;

  // Tag tokens that correspond to a title-word (target) norm. Body tokens
  // get isHiddenTarget so their redaction box stays in place even after the
  // title word is found (article reveal is deferred until round end). Title
  // tokens only carry the slot id — they reveal normally as found.
  for (const p of paragraphs) {
    for (const t of p) {
      if (t.type === 'word' && targetNormSet.has(t.norm)) {
        t.isHiddenTarget = true;
        t.targetSlotId = targetSlotIds.get(t.norm);
      }
    }
  }
  for (const t of titleTokens) {
    if (t.type === 'word' && targetNormSet.has(t.norm)) {
      t.targetSlotId = targetSlotIds.get(t.norm);
    }
    // Mark skipped title tokens — client uses this to omit them from the
    // title display during play and reveal at round-end.
    if (t.type === 'word' && skippedTitleSet.has(t.norm)) {
      t.isSkipped = true;
    }
  }

  const revealed = new Set(STOPLIST);

  // Index: normalized word → list of token refs, for O(1) reveal.
  const wordIndex = new Map();
  const addToIndex = (t) => {
    if (t.type !== 'word') return;
    if (!wordIndex.has(t.norm)) wordIndex.set(t.norm, []);
    wordIndex.get(t.norm).push(t);
  };
  for (const p of paragraphs) for (const t of p) addToIndex(t);
  for (const t of titleTokens) addToIndex(t);

  return {
    targetWord,
    targetNormalized,
    targetNormSet,
    targetSlotIds,
    foundTitleNorms: new Set(),
    foundSlotIds: new Set(),
    articleTitle,
    paragraphs,
    titleTokens,
    revealed,
    wordIndex,
    startedAt: Date.now(),
    guessCount: 0,
    revealedCount: 0,
    won: false,
  };
}

// Attempt to reveal any tokens matching a chat message.
// Returns { newlyRevealed: string[], isTarget: bool, contains: bool }
function processGuess(round, chatText) {
  if (!round) return { newlyRevealed: [], isTarget: false, contains: false };

  const candidates = chatText
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length > 0);

  const newlyRevealed = [];
  let isTarget = false;
  let contains = false;

  for (const c of candidates) {
    if (c === round.targetNormalized) isTarget = true;
    if (round.revealed.has(c)) continue;
    const tokens = round.wordIndex.get(c);
    if (!tokens || tokens.length === 0) continue;
    round.revealed.add(c);
    newlyRevealed.push(c);
    contains = true;
    const isTitleNorm = round.targetNormSet && round.targetNormSet.has(c);
    if (isTitleNorm) {
      if (round.foundTitleNorms) round.foundTitleNorms.add(c);
      const sid = round.targetSlotIds && round.targetSlotIds.get(c);
      if (sid && round.foundSlotIds) round.foundSlotIds.add(sid);
    }
    for (const t of tokens) {
      // Body title-word slots stay redacted until round end. Title tokens
      // (top-of-page display) reveal normally — they do not carry the
      // isHiddenTarget flag.
      if (t.isHiddenTarget) continue;
      if (!t.revealed) {
        t.revealed = true;
        round.revealedCount++;
      }
    }
  }
  round.guessCount++;
  return { newlyRevealed, isTarget, contains };
}

// Same seed derivation used by serializeRound when shuffling title tokens.
// Exposed so server-side rank-target selection can iterate title norms in
// the SAME display order players see at the top of the page — otherwise
// the game would rank against the natural-article-order first title word
// while the visually-first slot points somewhere else.
function titleShuffleSeed(round) {
  return (((round && round.startedAt) || 1) ^ 0xA1B2C3D4) >>> 0;
}

// Returns the unique target-word norms in the order they're displayed in
// the (shuffled) title at the top. Stop-words and non-target tokens are
// filtered out; only norms in round.targetNormSet are returned, deduped.
function getTitleDisplayOrderNorms(round) {
  if (!round || !Array.isArray(round.titleTokens)) return [];
  const seed = titleShuffleSeed(round);
  const wordTokens = round.titleTokens.filter((t) => t.type === 'word');
  const shuffled = seededShuffle(wordTokens, seed);
  const targetSet = round.targetNormSet || new Set();
  const out = [];
  const seen = new Set();
  for (const t of shuffled) {
    if (t.isStop) continue;
    if (!targetSet.has(t.norm)) continue;
    if (seen.has(t.norm)) continue;
    seen.add(t.norm);
    out.push(t.norm);
  }
  return out;
}

// Re-group a single paragraph's tokens by sentenceId, keep sentence 0 in
// place, and shuffle sentences 1..N using the given seed. Returns a new
// flat token array. Used when an article has only one paragraph — keeps
// the lead sentence stable so the article still reads, while shuffling
// the rest to deny a contiguous reading flow.
function shuffleSentencesInParagraph(paraTokens, seed) {
  if (!paraTokens || paraTokens.length === 0) return paraTokens;
  const groups = new Map();
  const order = [];
  for (const t of paraTokens) {
    const sid = t.sentenceId || 0;
    if (!groups.has(sid)) { groups.set(sid, []); order.push(sid); }
    groups.get(sid).push(t);
  }
  if (order.length <= 1) return paraTokens;
  const head = order[0];
  const tail = order.slice(1);
  const tailShuffled = seededShuffle(tail, seed);
  const out = [];
  for (const t of groups.get(head)) out.push(t);
  for (const sid of tailShuffled) for (const t of groups.get(sid)) out.push(t);
  return out;
}

function firstVisibleChar(s) {
  const chars = Array.from(String(s || '').trim());
  return chars.length ? chars[0] : null;
}

// Serialize the round to a form the overlay client can render — strips
// the wordIndex (not JSON-serializable as-is with cross-refs) and returns
// only what the client needs to render redaction boxes.
function serializeRound(round) {
  if (!round) return null;
  const won = !!round.won;
  const seed = (round.startedAt || 1) >>> 0;
  const hintLettersByNorm = round.hintLettersByNorm && typeof round.hintLettersByNorm === 'object'
    ? round.hintLettersByNorm
    : {};

  // Title tokens: emit word-only entries (client uses flex gaps for spacing).
  // Shuffle display order during play; restore natural order at round end.
  const titleWordEntries = round.titleTokens
    .filter((t) => t.type === 'word')
    .map((t) => {
      const showHint = !won && !t.revealed;
      const hintCount = showHint
        ? Math.max(1, Math.floor(Number(hintLettersByNorm[t.norm]) || 1))
        : 0;
      const hintChars = showHint
        ? Array.from(String(t.text || '')).slice(0, hintCount).join('')
        : null;
      return {
        type: 'word',
        len: t.text.length,
        revealed: t.revealed,
        text: t.revealed ? t.text : null,
        // Norms are answer text. Hidden slots expose only their opaque ID.
        norm: t.revealed ? t.norm : null,
        hintLetter: showHint ? firstVisibleChar(t.text) : null,
        hintText: hintChars,
        isNumber: !!t.isNumber,
        isSkipped: !!t.isSkipped,
        targetSlotId: t.targetSlotId || null,
      };
    });
  const titleTokens = won
    ? titleWordEntries
    : seededShuffle(titleWordEntries, titleShuffleSeed(round));

  // Body paragraphs: title-word slots stay length-8 placeholders even after
  // the title word is found (article reveal is deferred until won === true).
  // Each hidden-target slot carries its targetSlotId so the client can paint
  // confirmed-found slots green without learning the underlying norm.
  const paragraphsRaw = round.paragraphs.map((p) =>
    p.map((t) => {
      if (t.type !== 'word') return { type: 'space', text: t.text, sentenceId: t.sentenceId || 0 };
      const isHiddenTitle = !t.revealed && t.isHiddenTarget;
      const out = {
        type: 'word',
        len: isHiddenTitle ? TARGET_PLACEHOLDER_LEN : t.text.length,
        revealed: t.revealed,
        text: t.revealed ? t.text : null,
        sentenceId: t.sentenceId || 0,
        isNumber: !!t.isNumber,
        digitCount: t.digitCount || 0,
      };
      if (isHiddenTitle && t.targetSlotId) out.targetSlotId = t.targetSlotId;
      return out;
    })
  );

  // Paragraph-order shuffle: keep paragraph 0 in place, shuffle 1..N during
  // play. If only one paragraph exists, shuffle its sentences 1..N instead.
  // Restore natural order at round end so the article reads cleanly.
  let paragraphs;
  if (won) {
    paragraphs = paragraphsRaw;
  } else if (paragraphsRaw.length === 1) {
    paragraphs = [shuffleSentencesInParagraph(paragraphsRaw[0], (seed ^ 0xC3D4E5F6) >>> 0)];
  } else if (paragraphsRaw.length > 1) {
    const head = paragraphsRaw[0];
    const tail = seededShuffle(paragraphsRaw.slice(1), (seed ^ 0xC3D4E5F6) >>> 0);
    paragraphs = [head, ...tail];
  } else {
    paragraphs = paragraphsRaw;
  }

  const foundSlotIds = round.foundSlotIds ? Array.from(round.foundSlotIds) : [];
  return {
    articleTitle: won ? round.articleTitle : null,
    targetLength: round.targetNormalized.length,
    titleRevealed: !!round.titleRevealed,
    titleTokens,
    paragraphs,
    foundSlotIds,
    foundConfirmed: foundSlotIds.length >= 2,
    hintPrompt: round.hintPrompt || null,
    startedAt: round.startedAt,
    guessCount: round.guessCount,
    revealedCount: round.revealedCount,
    won,
  };
}

// When Searchle ends a round, reveal everything for a brief grace period.
function revealAll(round) {
  if (!round) return;
  for (const p of round.paragraphs) for (const t of p) if (t.type === 'word') t.revealed = true;
  for (const t of round.titleTokens) if (t.type === 'word') t.revealed = true;
  round.won = true;
}

// Reveal every title token. Returns newly-revealed norms (excluding anything
// already revealed). Body tokens sharing the same norm stay redacted while
// the round is in play (deferred-reveal rule); only revealAll lifts that.
function revealTitle(round) {
  if (!round) return [];
  const newlyRevealed = [];
  for (const t of round.titleTokens) {
    if (t.type !== 'word') continue;
    if (round.revealed.has(t.norm)) {
      if (!t.revealed) { t.revealed = true; round.revealedCount++; }
      continue;
    }
    round.revealed.add(t.norm);
    newlyRevealed.push(t.norm);
    if (round.targetNormSet && round.targetNormSet.has(t.norm)) {
      if (round.foundTitleNorms) round.foundTitleNorms.add(t.norm);
      const sid = round.targetSlotIds && round.targetSlotIds.get(t.norm);
      if (sid && round.foundSlotIds) round.foundSlotIds.add(sid);
    }
    const tokens = round.wordIndex.get(t.norm);
    if (tokens) for (const tt of tokens) {
      if (tt.isHiddenTarget) continue;
      if (!tt.revealed) { tt.revealed = true; round.revealedCount++; }
    }
  }
  return newlyRevealed;
}

// True when every non-stop, non-hidden-target body word is revealed.
// Body title-word slots are excluded — they stay redacted by design until
// revealAll fires at round end, so they shouldn't gate the "fully revealed"
// signal mid-round.
function isFullyRevealed(round) {
  if (!round) return false;
  for (const para of round.paragraphs) {
    for (const t of para) {
      if (t.type !== 'word') continue;
      if (t.isStop) continue;
      if (t.isHiddenTarget) continue;
      if (!t.revealed) return false;
    }
  }
  return true;
}

// Iterator over unrevealed non-stop body-word norms in reading order.
// Skips anything in the optional excluded set, and skips title-word body
// slots (those never reveal mid-round, so they're not eligible rank
// targets). Returns an array; caller picks the first Searchle can rank.
function unrevealedBodyNorms(round, excluded) {
  const out = [];
  const seen = new Set();
  if (!round) return out;
  for (const para of round.paragraphs) {
    for (const t of para) {
      if (t.type !== 'word') continue;
      if (t.isStop) continue;
      if (t.revealed) continue;
      if (t.isHiddenTarget) continue;
      if (seen.has(t.norm)) continue;
      if (excluded && excluded.has(t.norm)) continue;
      seen.add(t.norm);
      out.push(t.norm);
    }
  }
  return out;
}

module.exports = { buildRound, processGuess, serializeRound, revealAll, revealTitle, isFullyRevealed, unrevealedBodyNorms, getTitleDisplayOrderNorms, STOPLIST, normalize };
