// Only the explicit local demo redirects account reads to its fixture service.
if (import.meta.env.DEV && import.meta.env.VITE_WKX_DEMO === '1') {
  const original = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === 'https://wordtycoon.live' && url.pathname.startsWith('/api/')) {
      return original(url.pathname + url.search, options);
    }
    return original(input, options);
  };
  const note = document.createElement('aside');
  note.textContent = 'Local preview · sample puzzle';
  note.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2000;padding:4px 12px;border-radius:0 0 10px 10px;background:#051831;color:#94cbdc;font:11px system-ui;pointer-events:none';
  document.body.append(note);
}
