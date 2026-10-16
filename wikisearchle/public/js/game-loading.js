/* Loading stays visible until the game client confirms its content is ready. */
(() => {
  const screen = document.getElementById('gameLoadingScreen');
  if (!screen) return;
  const content = document.querySelector('.scroll-wrap');
  const title = document.getElementById('gameLoadingTitle');
  const message = document.getElementById('gameLoadingMessage');
  const spinner = document.getElementById('gameLoadingSpinner');
  const actions = document.getElementById('gameLoadingActions');
  let pending = true, generation = 0, slowTimer;

  function start(text) {
    generation++;
    pending = true;
    clearTimeout(slowTimer);
    screen.hidden = false;
    document.body.classList.add('game-loading');
    if (content) { content.inert = true; content.setAttribute('aria-busy', 'true'); }
    title.textContent = 'Loading…';
    message.textContent = text || screen.dataset.message;
    spinner.hidden = false;
    actions.hidden = true;
    slowTimer = setTimeout(() => {
      message.textContent = 'This is taking a little longer. You can retry or return home.';
      actions.hidden = false;
    }, 15000);
  }
  function ready(onReady) {
    const current = generation;
    requestAnimationFrame(() => {
      if (current !== generation) return;
      clearTimeout(slowTimer);
      pending = false;
      screen.hidden = true;
      document.body.classList.remove('game-loading');
      if (content) { content.inert = false; content.setAttribute('aria-busy', 'false'); }
      if (typeof onReady === 'function') onReady();
    });
  }
  function fail(text) {
    if (!pending) start();
    generation++;
    clearTimeout(slowTimer);
    title.textContent = 'Couldn’t load the game';
    message.textContent = text || 'Check your connection, then try again.';
    spinner.hidden = true;
    actions.hidden = false;
  }
  document.getElementById('gameLoadingRetry').addEventListener('click', () => location.reload());
  window.WikiContextoLoading = { start, ready, fail, isPending: () => pending };
  start();
})();
