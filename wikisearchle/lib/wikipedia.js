// Fetches a Wikipedia article as plaintext paragraphs for the game.
// Starts from the full parsed article HTML (not just the lead), truncates
// at the first boilerplate section (References / See also / External links
// / etc), and strips every non-prose block (tables, images, infoboxes,
// math, code, footnote sups, editorial brackets, MediaWiki error stubs).

const https = require('https');

const UA = 'WikiWord/1.0 (jorry@wordtycoon.live)';
const REQUEST_TIMEOUT_MS = 8000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    let request, response, settled = false;
    const deadline = setTimeout(() => {
      const error = new Error(`Wikipedia request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      error.code = 'ETIMEDOUT';
      finish(error);
    }, REQUEST_TIMEOUT_MS);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        // Stop incomplete bodies as well as connections still awaiting headers.
        if (response) response.destroy();
        if (request) request.destroy();
        reject(error);
      } else resolve(value);
    }

    try {
      request = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
        response = res;
        let data = '', ended = false;
        res.once('error', (error) => finish(error));
        res.once('aborted', () => finish(new Error('Wikipedia response aborted')));
        res.once('close', () => {
          if (!ended) finish(new Error('Wikipedia response closed before completion'));
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          finish(new Error(`Wikipedia HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (c) => (data += c));
        res.once('end', () => {
          ended = true;
          try { finish(null, JSON.parse(data)); } catch (error) { finish(error); }
        });
      });
      request.once('error', (error) => finish(error));
      // Covers an immediate failure from a custom HTTP agent or test transport.
      if (settled) request.destroy();
    } catch (error) { finish(error); }
  });
}

// Headings that mark the tail-end of a Wikipedia article — everything from
// (and including) the first matching <h2> gets dropped. Comparison is
// lowercase + whitespace-trimmed; matches are whole-heading or "startsWith"
// so "References and notes" / "See also (English)" variants also hit.
const STOP_HEADINGS = [
  'references', 'reference', 'external links', 'external link',
  'see also', 'further reading', 'further readings',
  'notes', 'citations', 'footnotes', 'bibliography',
  'sources', 'works cited', 'selected works', 'publications',
  'discography', 'filmography', 'gallery',
  'awards', 'awards and honors', 'honors and awards', 'honours',
  'in popular culture', 'in media',
];

// Find the earliest offset in the HTML of an <h2> whose headline matches
// one of STOP_HEADINGS, and truncate the HTML there. Supports both the
// classic Wikipedia skin (<h2><span class="mw-headline">Title</span></h2>)
// and the current Minerva/Vector-2022 skin (<h2 id="Title">Title</h2>).
function truncateAtStopHeading(html) {
  if (!html) return html;
  const headingRe = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let earliest = -1;
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    const title = m[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    if (!title) continue;
    const isStop = STOP_HEADINGS.some((s) => title === s || title.startsWith(s + ' ') || title.startsWith(s + ','));
    if (isStop && (earliest === -1 || m.index < earliest)) earliest = m.index;
  }
  return earliest >= 0 ? html.substring(0, earliest) : html;
}

// Convert the parsed HTML fragment from MediaWiki into clean paragraphs.
// Strips every non-prose block so what's left is straight body text that
// tokenizes cleanly into word / space / punctuation runs.
function htmlToParagraphs(html, { maxBlocks = 4, maxChars = 1150 } = {}) {
  if (!html) return '';
  let cleaned = truncateAtStopHeading(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // All tables — infobox/sidebar/navbox/data tables/etc. Wikipedia rarely
    // embeds tables mid-prose in a way that aids reading the article.
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    // Images, figures, and their captions.
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    // Thumbs/galleries/hatnotes/disambiguation pointers/short-description.
    .replace(/<div[^>]*class="[^"]*hatnote[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*role="note"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*gallery[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<ul[^>]*class="[^"]*gallery[^"]*"[^>]*>[\s\S]*?<\/ul>/gi, '')
    .replace(/<div[^>]*class="[^"]*shortdescription[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    // Blockquote / pre / math / code examples — noise for a guess game.
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<math[\s\S]*?<\/math>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '')
    // Explicit Wikipedia references list wrappers.
    .replace(/<ol[^>]*class="[^"]*references[^"]*"[^>]*>[\s\S]*?<\/ol>/gi, '')
    .replace(/<div[^>]*class="[^"]*reflist[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    // Footnote superscripts + the [1][2]-style reference markers.
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '')
    // Inline editorial templates like [citation needed], [clarification needed],
    // [note N] — Wikipedia wraps these in <sup class="noprint ...">. Catches
    // the Inline-Template / Fix / Fact / Template-Fact family.
    .replace(/<sup[^>]*class="[^"]*noprint[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<span[^>]*class="[^"]*noprint[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');

  // Known editorial bracket markers that sometimes slip past the sup strip
  // (e.g. when they're wrapped in an unexpected element). Matches the literal
  // bracketed form after entity decoding.
  const EDITORIAL_MARKER = /\[(?:citation needed|clarification needed|better source needed|according to whom\??|who\??|when\??|where\??|which\??|by whom\??|why\??|vague|dubious[^\]]*|note \d+|[a-z])\]/gi;

  // Walk <p>, <h2>, and <h3> in document order so section headings appear
  // between paragraphs the way they do on Wikipedia. Capped at a small
  // number of blocks / chars so articles stay bite-sized — we never cut
  // mid-sentence, we just stop adding new blocks once the cap is hit.
  // Chosen so the full article reliably fits in the 1080x1920 OBS overlay
  // viewport; words past the cap aren't in the game and therefore can't
  // be guessed / scored.
  const paragraphs = [];
  let charSum = 0;
  const blockRe = /<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(cleaned)) !== null) {
    const inner = m[2]
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '') // drop remaining tags
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(EDITORIAL_MARKER, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (inner.length === 0) continue;
    // Drop MediaWiki error messages that render as regular paragraphs when
    // an article has unmatched <ref> groups or broken parser functions.
    if (/^Cite error:/i.test(inner)) continue;
    if (/^Parser function error/i.test(inner)) continue;
    if (paragraphs.length >= maxBlocks) break;
    // Stop BEFORE pushing a block that would exceed the char cap — that
    // way we always end cleanly on a paragraph boundary. Exception: always
    // include at least one block, even if it's long.
    if (charSum + inner.length > maxChars && paragraphs.length >= 1) break;
    paragraphs.push(inner);
    charSum += inner.length;
  }
  return paragraphs.join('\n\n');
}

async function fetchLeadSection(title, opts = {}) {
  // Drop section=0 — we want the whole article, then truncate at the first
  // boilerplate section (References / See also / External links / etc).
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&formatversion=2&format=json&redirects=1`;
  const json = await fetchJson(url);
  if (json.error) throw new Error(`Wikipedia API error: ${json.error.info || json.error.code}`);
  const html = json.parse && json.parse.text;
  const resolvedTitle = (json.parse && json.parse.title) || title;
  const plaintext = htmlToParagraphs(html, opts);
  return { title: resolvedTitle, plaintext };
}

module.exports = { fetchLeadSection };
