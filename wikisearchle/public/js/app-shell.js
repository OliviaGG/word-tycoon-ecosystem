// Share the install/offline shell between solo and multiplayer.
(function () {
  'use strict';
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  // OBS sources keep their existing browser-source lifecycle.
  if (new URLSearchParams(window.location.search).has('obs')) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js?v=20261004-vite', { scope: '/', updateViaCache: 'none' })
      .catch(function () { /* The online game still works if registration fails. */ });
  });
})();
