// pwa-install.js intentionally does not render a custom install prompt.
// Browsers may still offer their native install UI from the manifest/service worker.
(function () {
  window.WordTycoonPwaInstall = {
    available: false,
    prompt: function () { return Promise.resolve({ outcome: 'native-browser-ui' }); }
  };
})();