// Minimal toast — slides in from the top, auto-dismisses.

let _container = null;

function ensureContainer() {
  if (_container) return _container;
  _container = document.createElement('div');
  _container.id = 'toast-stack';
  _container.setAttribute('aria-live', 'polite');
  document.body.appendChild(_container);
  return _container;
}

export function toast(message, opts = {}) {
  const cont = ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast' + (opts.kind ? ' toast-' + opts.kind : '');
  el.textContent = message;
  cont.appendChild(el);

  // Force reflow so the transition runs from the initial state
  void el.offsetWidth;
  el.classList.add('toast-in');

  const ttl = typeof opts.ttl === 'number' ? opts.ttl : 1600;
  setTimeout(() => {
    el.classList.remove('toast-in');
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 200);
  }, ttl);
}
