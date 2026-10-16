// Disabled-session frontend gate. Hides the guess input + shows a pill.
(function(){
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('disabled') !== '1') return;
    // Streamer-self bypass — match the shared gate behavior so View-as-me
    // shows the real game UI even when disable-player-page is on.
    if (q.get('streamer_self') === '1') return;
    try {
      var _h = (q.get('session') || (location.pathname.match(/^\/([a-z0-9_-]{1,32})\/?$/) || [])[1] || '').toLowerCase();
      if (_h && localStorage.getItem('wt_streamer_self_' + _h) === '1') return;
    } catch (_) {}
    document.documentElement.classList.add('session-disabled');
    document.body && document.body.classList.add('stream-disabled');
    // Defer until DOM ready so body class lands; class on documentElement is enough for CSS.
    function addPill() {
      if (document.body.querySelector('.stream-disabled-pill')) return;
      var pill = document.createElement('div');
      pill.className = 'stream-disabled-pill';
      pill.textContent = 'Watch on stream — playing disabled';
      document.body.appendChild(pill);
      document.body.classList.add('stream-disabled');
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addPill);
    } else {
      addPill();
    }
    // Marker that emit-gates can check before sending guess events.
    window.__STREAM_DISABLED = true;
  } catch (_) {}
})();
