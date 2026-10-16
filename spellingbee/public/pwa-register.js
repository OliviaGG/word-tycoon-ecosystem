(function () {
  if (!('serviceWorker' in navigator)) return;
  var isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) return;

  window.addEventListener('load', function () {
    var swUrl = new URL('sw.js', window.location.href);
    navigator.serviceWorker.register(swUrl.href).catch(function (error) {
      console.warn('[PWA] Service worker registration failed:', error);
    });
  });
})();
