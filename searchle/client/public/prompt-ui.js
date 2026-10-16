// Dialogs use physical screen pixels even when the game uses a 980px viewport.
(function () {
  function resize() {
    var viewport = window.visualViewport;
    var scale = viewport && viewport.scale > 0 ? 1 / viewport.scale : 1;
    var mobile = window.__searchleTouchMobile ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!mobile || /OBS/i.test(navigator.userAgent)) scale = 1;
    document.documentElement.style.setProperty('--prompt-scale', Math.max(1, Math.min(4, scale)));
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
})();
