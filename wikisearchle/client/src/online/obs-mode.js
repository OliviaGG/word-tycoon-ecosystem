// OBS / stream-widget hint for fx-engine.js and xp-flyout.js. CEF in OBS is
  // software-rendered (disable-gpu-compositing + swiftshader), so heavy effects
  // tank the stream frame rate. Set the flag before those scripts load.
  (function () {
    const h = document.documentElement;
    if (h.classList.contains('obs-overlay-mode') || h.classList.contains('obs-mode')) {
      window.__WS_OBS_MODE = true;
      return;
    }
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('obs') === '1' || q.get('stream_widget') === '1') {
        window.__WS_OBS_MODE = true;
      }
    } catch (_) {}
  })();
