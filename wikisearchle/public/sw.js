/* WikiContexto PWA service worker.
 *
 * Strategy:
 *   - Pre-cache the reconnect screen and public CSS/JS/images on install.
 *   - On `fetch`:
 *       /api/* and /socket.io/*    → network-only (never cache live game state).
 *       navigation                  → network, falling back to the reconnect screen.
 *       public static assets        → stale-while-revalidate.
 *       cross-origin                → bypass (let the browser handle).
 *   - On activate → drop old WikiContexto shell caches, claim clients.
 *
 * Bump CACHE_VERSION on any deploy that ships changed shell files. The
 * activate step deletes older versions of this shell only.
 */
const CACHE_VERSION = 'wkx-shell-v19-vite';
const SHELL = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/wt-logo.png',
  '/wt-logo-live-cropped.webp',
  '/css/guessbar.css',
  '/css/wikicontexto-toon.css?v=25',
  '/css/wikicontexto-neon.css?v=20261004-loading',
  '/css/wikicontexto-solo-neon.css?v=20261002d',
  '/solo/solo.js?v=20261004-loading',
  '/js/game-loading.js?v=20261004-loading',
  '/css/how-to-play.css?v=20261004-help',
  '/js/solo-help.js?v=20261004-help',
  '/css/refined-guesses.css?v=20261004-word-fit',
  '/js/refined-guesses.js?v=20261004',
  '/js/cosmetics-applier.js?v=20261004',
  '/js/app-shell.js?v=20261004',
  '/js/guessbar.js?v=20260710',
  '/css/home.css?v=20261004',
  '/js/home.js?v=20261004',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Require a usable reconnect screen before activating this worker.
    await cache.add(new Request('/offline.html', { cache: 'reload' }));
    await Promise.all(SHELL.filter(u => u !== '/offline.html').map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); }
      catch (e) { /* shell entry missing — skip, don't fail install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wkx-shell-') && k !== CACHE_VERSION)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Keep puzzle state, sockets, sign-in, and admin traffic on the network.
  if (/^\/(?:api|socket\.io|auth|review-access)(?:\/|$)/.test(url.pathname)) return;
  if (url.pathname.includes('admin')) return;
  // Only version parameters are safe to retain on static asset URLs.
  if ([...url.searchParams.keys()].some(k => k !== 'v') && req.mode !== 'navigate') return;

  // Fresh HTML prevents restoring a stale puzzle or another account's page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      return (await cache.match('/offline.html')) || new Response('Reconnect to WikiContexto.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }));
    return;
  }

  if (!/\.(?:css|js|png|svg|webp|jpg|jpeg|woff2?)$/.test(url.pathname)) return;
  const network = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic' && !res.redirected &&
        !/no-store|private/i.test(res.headers.get('Cache-Control') || '')) {
      try {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(req, res.clone());
      } catch (_) { /* A full cache must not discard a usable network response. */ }
    }
    return res;
  }).catch(() => null);
  // Keep background revalidation alive after returning a cached asset.
  event.waitUntil(network.then(() => {}));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    return (await cache.match(req)) || (await network) || new Response('', { status: 503 });
  })());
});
