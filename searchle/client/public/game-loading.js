// Ready is emitted by the renderer, after the game state and guesses are applied.
(function () {
  function placeSoloLogin() {
    if (!window.__SP_MODE) return;
    var button = document.querySelector('.login-overlay-btn');
    var footer = document.querySelector('.mode-sp .neon-header-footer');
    if (button && footer && button.parentNode !== footer) {
      footer.prepend(button);
      window.dispatchEvent(new CustomEvent('subtextle-header-layout-change'));
    }
  }
  placeSoloLogin();
  // The legacy guest link is appended directly to body after the auth check.
  if (window.__SP_MODE) {
    new MutationObserver(placeSoloLogin).observe(document.body, { childList: true });
    window.addEventListener('subtextle-header-layout-change', placeSoloLogin);
  }
  var help = document.getElementById('game-help-overlay');
  if (help) {
    // Let the instructions scroll normally without moving the game behind them.
    ['wheel', 'touchstart', 'touchmove', 'touchend'].forEach(function (name) {
      help.addEventListener(name, function (event) { event.stopPropagation(); }, { passive: true });
    });
    help.addEventListener('click', function (event) {
      if (event.target.closest('.game-help-nav, .game-help-dot, #gh-help-btn')) {
        var steps = help.querySelector('.game-help-steps');
        if (steps) steps.scrollTop = 0;
      }
    });
  }
  var loader = document.getElementById('subtextle-game-loading');
  if (!loader) return;
  var overlay = /OBS/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('obs');
  var revision = 0;
  function ready() {
    placeSoloLogin();
    var current = ++revision;
    requestAnimationFrame(function () {
      if (current === revision) loader.hidden = true;
    });
  }
  document.addEventListener('subtextle-game-ready', ready);
  document.addEventListener('sp-weekly-completed', ready);
  document.addEventListener('sp-loading', function (event) {
    if (event.detail && event.detail.loading && !overlay) {
      revision++;
      loader.hidden = false;
    }
  });
  if (overlay || window.__subtextleGameReady) loader.hidden = true;
})();
