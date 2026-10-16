const CACHE_NAME = 'word5000-pwa-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/mp.html',
  '/style.css?v=10',
  '/game.js?v=7',
  '/manifest.webmanifest',
  '/app-icon.png',
  '/offline.html',
  '/solo',
  '/solo/',
  '/solo/play.html',
  '/solo/play.css?v=16',
  '/solo/play.js?v=4'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  if (url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(handleAsset(request));
  }
});

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const wantsSolo = url.pathname === '/solo' || url.pathname.startsWith('/solo/');
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    const routeFallback = wantsSolo
      ? (await cache.match('/solo')) || (await cache.match('/solo/')) || (await cache.match('/solo/play.html'))
      : (await cache.match('/')) || (await cache.match('/mp.html')) || (await cache.match('/index.html'));
    if (routeFallback) return routeFallback;

    return cache.match('/offline.html');
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request, { ignoreSearch: false });
  const networkFetch = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) return cachedResponse;

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  if (request.destination === 'image') {
    return cache.match('/app-icon.png');
  }

  return Response.error();
}
