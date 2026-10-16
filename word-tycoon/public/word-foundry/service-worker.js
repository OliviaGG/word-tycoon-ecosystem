'use strict';

const CACHE = 'word-foundry-v9';
const ASSETS = [
  './', './index.html', './styles.css?v=9', './cloud.js?v=9', './core.js?v=9', './game.js?v=9',
  './icon.svg', './manifest.webmanifest', '../wordfall/words.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('word-foundry-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const allowed = ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href);
  if (url.origin !== self.location.origin || !allowed) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type !== 'opaque') {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
