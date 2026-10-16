/* A browser-wide tutorial preference, separate from puzzle/account progress. */
(() => {
  const key = 'wikicontexto-solo-tutorial-v1';
  const dialog = document.getElementById('soloHelpDialog');
  const toggle = document.getElementById('soloHelpToggle');
  if (!dialog || !toggle) return;
  let seenThisPage = false;

  function hasSeen() {
    if (seenThisPage) return true;
    try { if (localStorage.getItem(key) === 'seen') return true; } catch (_) {}
    try { return sessionStorage.getItem(key) === 'seen'; } catch (_) { return false; }
  }
  function remember() {
    seenThisPage = true;
    try { localStorage.setItem(key, 'seen'); }
    catch (_) { try { sessionStorage.setItem(key, 'seen'); } catch (_) {} }
  }
  function open() {
    if (dialog.open) return;
    if (typeof dialog.showModal !== 'function') { location.href = '/about'; return; }
    dialog.showModal();
  }
  function close() {
    remember();
    dialog.close();
  }
  toggle.addEventListener('click', open);
  document.getElementById('soloHelpClose').addEventListener('click', close);
  document.getElementById('soloHelpStart').addEventListener('click', () => {
    close();
    if (window.WikiWordGuessBar) window.WikiWordGuessBar.focus();
  });
  document.getElementById('soloHelpGuide').addEventListener('click', close);
  dialog.addEventListener('close', remember); // Includes Escape / Android Back.

  window.WikiContextoHelp = {
    showFirstTime() { if (!hasSeen()) open(); },
    isOpen() { return dialog.open; },
  };
})();
