const CACHE_NAME = 'betwixt-pwa-v3';
const APP_SHELL = [
  '',
  'play',
  'index.html',
  'mp.html',
  'play.html',
  'manifest.webmanifest',
  'app-icon.png',
  'offline.html'
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
    await Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    );
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

  const destination = request.destination;
  if (['style', 'script', 'image', 'font'].includes(destination)) {
    event.respondWith(handleAsset(request));
  }
});

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const wantsSolo = /\/play(?:\.html)?$/.test(url.pathname);
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
      ? (await cache.match(new URL('play', self.registration.scope))) || (await cache.match(new URL('play.html', self.registration.scope)))
      : (await cache.match(new URL('', self.registration.scope))) || (await cache.match(new URL('index.html', self.registration.scope))) || (await cache.match(new URL('mp.html', self.registration.scope)));
    if (routeFallback) return routeFallback;

    return cache.match(new URL('offline.html', self.registration.scope));
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
    return cache.match(new URL('app-icon.png', self.registration.scope));
  }

  return Response.error();
}
