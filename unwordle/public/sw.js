const CACHE_NAME = 'unwordle-pwa-v3';
const APP_SHELL = [
  '',
  'index.html',
  'sp.html',
  'manifest.webmanifest',
  'app-icon.svg',
  'offline.html',
  'unwordle.css',
  'sp-engine.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      APP_SHELL.map((entry) => cache.add(new Request(new URL(entry, self.registration.scope), { cache: 'reload' })))
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
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.includes('/socket.io/')) return;
  if (url.pathname.includes('/auth/')) return;

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

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    const fallback = await cache.match(new URL('sp.html', self.registration.scope));
    if (fallback) return fallback;

    return cache.match(new URL('offline.html', self.registration.scope));
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
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
    return cache.match(new URL('app-icon.svg', self.registration.scope));
  }

  return Response.error();
}
