/* Theme toggle — persist choice to localStorage, flip class on <html>. */
  (function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isLight = document.documentElement.classList.toggle('theme-light');
      try { localStorage.setItem('wikisearchle-theme', isLight ? 'light' : 'dark'); } catch (e) {}
    });
  })();
  /* FX mute toggle — persist to localStorage, sync with FX engine. */
  (function () {
    var btn = document.getElementById("fxMuteToggle");
    if (!btn) return;
    var muted = false;
    try { muted = localStorage.getItem("wikisearchle-fx-muted") === "1"; } catch (e) {}
    if (muted) { btn.classList.add("muted"); if (window.FX) window.FX.setMuted(true); }
    btn.addEventListener("click", function () {
      muted = !muted;
      btn.classList.toggle("muted", muted);
      if (window.FX) window.FX.setMuted(muted);
      try { localStorage.setItem("wikisearchle-fx-muted", muted ? "1" : "0"); } catch (e) {}
    });
  })();
