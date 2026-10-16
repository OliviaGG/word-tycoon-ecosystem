// Premium gate: public multiplayer guessing requires Donor Class (the daily
// solo stays free). Server rejects the guess and emits premium-required;
// the wall is dismissible so spectating stays open. Streamer-session play
// never receives this event.
(function () {
  function attach() {
    var s = window._wsSocket;
    if (!s) { setTimeout(attach, 500); return; }
    s.on('premium-required', function (info) {
      showPremiumWall(!!(info && info.loggedIn));
    });
  }
  attach();
  function showPremiumWall(loggedIn) {
    var existing = document.getElementById('premium-wall');
    if (existing) { existing.style.display = 'flex'; return; }
    var el = document.createElement('div');
    el.id = 'premium-wall';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(8,4,14,0.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;';
    var signinBtn = loggedIn ? '' :
      '<button id="premium-wall-signin" style="display:block;width:100%;padding:13px 16px;border-radius:11px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(160,140,190,0.35);color:#eee8f4;font-weight:900;cursor:pointer;font-size:1rem;">Sign in</button>';
    el.innerHTML =
      '<div style="max-width:460px;width:100%;text-align:center;padding:36px 28px;background:linear-gradient(160deg,rgba(20,14,30,0.98),rgba(30,22,46,0.98));border:1px solid rgba(160,140,190,0.2);border-radius:18px;position:relative;color:#eee8f4;">' +
        '<button id="premium-wall-close" aria-label="Close" style="position:absolute;top:10px;right:12px;background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:30px;height:30px;color:#c4b4d8;font-size:16px;cursor:pointer;">&times;</button>' +
        '<div style="font-size:11px;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;color:rgba(138,92,247,0.85);margin-bottom:8px;">Word Tycoon Premium</div>' +
        '<h2 style="margin:0 0 10px;font-size:1.35rem;font-weight:900;">Multiplayer is Donor-only</h2>' +
        '<p style="margin:0 0 22px;font-size:0.9rem;line-height:1.55;color:rgba(196,180,216,0.78);">The daily and weekly puzzles are free for everyone, forever. Online multiplayer needs <strong style="color:#eee8f4;">Donor Class</strong> &mdash; $2/month. TikTok Super Fans get it free.</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<a href="/daily" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(138,92,247,0.12);border:1.5px solid rgba(138,92,247,0.45);color:#b79aff;font-weight:900;text-decoration:none;">Play the free daily</a>' +
          '<a href="https://wordtycoon.live/me?tab=pass" style="display:block;padding:13px 16px;border-radius:11px;background:rgba(196,102,255,0.1);border:1.5px solid rgba(196,102,255,0.4);color:#c98aff;font-weight:900;text-decoration:none;">Become a Donor &mdash; $2/mo</a>' +
          signinBtn +
        '</div>' +
        '<p style="margin:18px 0 0;font-size:0.72rem;color:rgba(196,180,216,0.55);">You can keep watching the game behind this message.</p>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('premium-wall-close').onclick = function () { el.style.display = 'none'; };
    var sb = document.getElementById('premium-wall-signin');
    if (sb) sb.onclick = function () {
      el.style.display = 'none';
      var auth = window.WikiSearchleAuth;
      if (auth && typeof auth.showPrompt === 'function') auth.showPrompt();
      else window.location.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent(location.href);
    };
  }
})();
