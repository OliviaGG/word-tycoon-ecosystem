/**
 * Host-aware SEO middleware for WikiSearchle.
 *
 * The same Express app serves two domains:
 *   - wikisearchle.com  (canonical, primary brand)
 *   - wikicontexto.com  (alt brand, declares wikisearchle.com canonical)
 *
 * For each HTML file in PUBLIC_PAGES we read it from disk on first request,
 * cache the result, and on every subsequent request decide which variant to
 * serve based on the Host header. The wikicontexto variant has its <title>,
 * Open Graph, Twitter Card, and JSON-LD `name` fields swapped to "WikiContexto"
 * branding while the <link rel="canonical"> stays pointed at wikisearchle.com
 * (Option B: dedupe via canonical, both domains resolve, only one accumulates
 * link equity).
 *
 * sitemap.xml and robots.txt are also Host-aware — wikicontexto.com lists its
 * own URLs in its sitemap so Google discovers them and follows the canonical.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Pages that should be served via this middleware. Each entry maps a request
// path to the file on disk (so /about returns about.html, etc.).
//
// Home opens the game menu. Solo/random, today's daily, and multiplayer have
// separate entrypoints. Existing session/OBS root links still open multiplayer.
const PUBLIC_PAGES = [
  { route: '/',          file: 'home.html' },
  { route: '/solo',      file: 'solo/index.html' },
  { route: '/solo/',     file: 'solo/index.html' },
  { route: '/daily',     file: 'solo/index.html' },
  { route: '/daily/',    file: 'solo/index.html' },
  { route: '/previous-dailies', file: 'previous-dailies.html' },
  { route: '/previous-dailies/', file: 'previous-dailies.html' },
  { route: '/online',    file: 'index.html' },
  { route: '/online/',   file: 'index.html' },
  { route: '/about',     file: 'about.html' },
  { route: '/about/',    file: 'about.html' },
];


// Streamers' OBS browser sources and private player links are already pointed
// at `/?session=<handle>` (and `&obs=1`), and re-pointing a live source
// disturbs the stream. So the root keeps serving the MULTIPLAYER page whenever
// either marker is present; ordinary root navigation opens the home menu.
function wantsMultiplayerRoot(req) {
  const q = req.query || {};
  return !!(q.session || q.obs);
}

// In-memory cache of read files. Cleared on a SIGHUP / dev mode could disable
// it entirely; for production these files only change on deploy.
const fileCache = new Map();

function readPublic(relPath) {
  if (fileCache.has(relPath)) return fileCache.get(relPath);
  const built = path.join(__dirname, '..', 'dist', relPath === 'index.html' ? 'online/index.html' : relPath);
  const full = process.env.WIKICONTEXTO_LEGACY_UI !== '1' && fs.existsSync(built)
    ? built : path.join(PUBLIC_DIR, relPath);
  const buf = fs.readFileSync(full, 'utf8');
  fileCache.set(relPath, buf);
  return buf;
}

function isWikiContextoHost(req) {
  const h = String(req.headers.host || '').toLowerCase();
  return /(?:^|\.)wikicontexto\.com(?::\d+)?$/i.test(h);
}

/**
 * Swap WikiSearchle → WikiContexto in <title>, OG, Twitter, and JSON-LD `name`
 * fields. Also rewrite all wikisearchle.com URLs to wikicontexto.com so the
 * domain is fully self-contained (canonical, OG, JSON-LD, etc.).
 */
function rewriteForWikiContexto(html) {
  let out = html;

  // <title>WikiSearchle ...</title>  →  <title>WikiContexto ...</title>
  out = out.replace(/<title>([^<]*)<\/title>/i, (_m, t) =>
    `<title>${t.replace(/WikiSearchle/g, 'WikiContexto')}</title>`);

  // og:title and twitter:title content attributes — preserve attribute order.
  out = out.replace(
    /<meta\s+(property|name)="(og:title|twitter:title)"\s+content="([^"]*)"\s*\/?>/gi,
    (_m, key, prop, content) =>
      `<meta ${key}="${prop}" content="${content.replace(/WikiSearchle/g, 'WikiContexto')}">`
  );

  // og:description and twitter:description — same brand swap.
  out = out.replace(
    /<meta\s+(property|name)="(og:description|twitter:description|description)"\s+content="([^"]*)"\s*\/?>/gi,
    (_m, key, prop, content) =>
      `<meta ${key}="${prop}" content="${content.replace(/WikiSearchle/g, 'WikiContexto')}">`
  );

  // og:site_name → "WikiContexto"
  out = out.replace(
    /<meta\s+property="og:site_name"\s+content="WikiSearchle"\s*\/?>/i,
    '<meta property="og:site_name" content="WikiContexto">'
  );

  // JSON-LD name field
  out = out.replace(/"name":\s*"WikiSearchle([^"]*)"/g,
    (_m, suffix) => `"name": "WikiContexto${suffix}"`);

  // Rewrite all wikisearchle.com URLs to wikicontexto.com (canonical, OG, JSON-LD, etc.)
  out = out.replace(/https:\/\/wikisearchle\.com/g, 'https://wikicontexto.com');

  return out;
}

function maybeRewrite(html, req) {
  if (!isWikiContextoHost(req)) return html;
  return rewriteForWikiContexto(html);
}

function serveHtml(req, res, relPath) {
  let html;
  try {
    html = readPublic(relPath);
  } catch (e) {
    return res.status(500).send('SEO middleware: failed to read ' + relPath);
  }
  const out = maybeRewrite(html, req);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(out);
}

function buildSitemap(host) {
  const urls = [
    { loc: '/',          priority: '1.0', changefreq: 'daily' },
    { loc: '/daily',      priority: '0.9', changefreq: 'daily' },
    { loc: '/solo',       priority: '0.8', changefreq: 'monthly' },
    { loc: '/previous-dailies', priority: '0.8', changefreq: 'daily' },
    { loc: '/online',    priority: '0.9', changefreq: 'always' },
    { loc: '/about',     priority: '0.8', changefreq: 'monthly' },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const u of urls) {
    xml.push(
      '  <url>',
      `    <loc>https://${host}${u.loc}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
      '  </url>'
    );
  }
  xml.push('</urlset>');
  return xml.join('\n');
}

function buildRobots(host) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin.html',
    'Disallow: /api/',
    '',
    `Sitemap: https://${host}/sitemap.xml`,
    '',
  ].join('\n');
}

function attach(app) {
  // Pre-empts express.static so we can rewrite the head per Host.
  for (const page of PUBLIC_PAGES) {
    app.get(page.route, (req, res, next) => {
      // GET and HEAD serve the same entrypoint; other methods proceed.
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      // A streamer session or OBS source asking for the root still wants the
      // multiplayer page — see wantsMultiplayerRoot.
      const file = (page.route === '/' && wantsMultiplayerRoot(req))
        ? 'index.html'
        : page.file;
      try { serveHtml(req, res, file); }
      catch (e) { next(e); }
    });
  }

  app.get('/sitemap.xml', (req, res) => {
    const host = isWikiContextoHost(req) ? 'wikicontexto.com' : 'wikisearchle.com';
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buildSitemap(host));
  });

  app.get('/robots.txt', (req, res) => {
    const host = isWikiContextoHost(req) ? 'wikicontexto.com' : 'wikisearchle.com';
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buildRobots(host));
  });
}

module.exports = { attach, _internal: { rewriteForWikiContexto, isWikiContextoHost } };
