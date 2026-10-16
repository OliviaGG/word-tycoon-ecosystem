// ticker.js - Conveyor-belt guess ticker for WiKirecTangled.
// Words travel right→left ONCE and despawn when they exit the left edge.
// Speed scales with rank: words near rank #1 crawl, words at rank 10000+
// blast through. Color matches the target-card gradient (green for rank 1,
// purple for very high rank).

(function () {
  const tickerTrack = document.getElementById('ticker-track');
  if (!tickerTrack) return;

  const tickerContainer = tickerTrack.parentElement;
  let items = []; // { el, x, width, speed }
  let raf = null;
  let lastFrameAt = null;
  let containerWidth = 0;
  const GAP = 14;
  const seen = new Set();

  // Speed range in pixels per second. The old implementation moved by a
  // fixed number of pixels per rendered frame, so the OBS/browser-source
  // ticker ran at half speed at 30 fps (then an OBS multiplier slowed it
  // again). Elapsed-time movement keeps every rendering surface consistent.
  const SLOW_PPS = 84;    // rank 1 (1.4 px/frame at 60 fps)
  const FAST_PPS = 330;   // rank 10000+ (5.5 px/frame at 60 fps)
  const MAX_FRAME_SECONDS = 0.1;
  function speedForRank(rank) {
    if (rank == null || rank <= 0) return (SLOW_PPS + FAST_PPS) / 2;
    const lr = Math.log10(Math.max(1, rank));     // 0..~5
    const t = Math.min(1, lr / 4);                // saturate at rank 10000
    return SLOW_PPS + t * (FAST_PPS - SLOW_PPS);
  }


  // HSL green→purple log gradient — same algorithm as Searchle, with green/purple
  // endpoints. Returns [r,g,b] integer triple so existing call sites that
  // destructure stay happy.
  function rankColorRgb(rank) {
    const GREEN_HUE = 120, PURPLE_HUE = 285;
    const total = window._totalRankedWords || 100000;
    let t;
    if (rank == null || rank <= 0 || total < 2) t = 0;
    else t = Math.min(1, Math.log(Math.max(1, rank)) / Math.log(total));
    const hue = GREEN_HUE + (PURPLE_HUE - GREEN_HUE) * t;
    // HSL → RGB (integer 0..255)
    const sat = 0.70, light = 0.55;
    const c = (1 - Math.abs(2*light - 1)) * sat;
    const hp = hue / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r=0,g=0,b=0;
    if (hp >= 0 && hp < 1) { r=c; g=x; }
    else if (hp < 2) { r=x; g=c; }
    else if (hp < 3) { g=c; b=x; }
    else if (hp < 4) { g=x; b=c; }
    else if (hp < 5) { r=x; b=c; }
    else { r=c; b=x; }
    const m = light - c/2;
    return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
  }

  function resize() {
    containerWidth = tickerContainer ? tickerContainer.offsetWidth :
                     (tickerTrack ? tickerTrack.offsetWidth : window.innerWidth);
  }
  window.addEventListener('resize', resize);
  resize();

  function tick(frameAt) {
    raf = null;
    if (items.length === 0) {
      lastFrameAt = null;
      return;
    }
    if (!containerWidth) resize();
    if (!containerWidth) {
      raf = requestAnimationFrame(tick);
      return;
    }

    if (lastFrameAt == null) lastFrameAt = frameAt;
    const elapsedSeconds = Math.min(
      MAX_FRAME_SECONDS,
      Math.max(0, (frameAt - lastFrameAt) / 1000)
    );
    lastFrameAt = frameAt;

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      item.x -= item.speed * elapsedSeconds;
      if (item.x + item.width < -20) {
        // Despawn after leaving the left edge — show each word once
        if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
        if (item.el && item.el.dataset.word) seen.delete(item.el.dataset.word);
        items.splice(i, 1);
        continue;
      }
      item.el.style.transform = `translate3d(${item.x}px, -50%, 0)`;
    }

    if (items.length > 0) raf = requestAnimationFrame(tick);
    else lastFrameAt = null;
  }

  function start() {
    if (raf == null) {
      lastFrameAt = null;
      raf = requestAnimationFrame(tick);
    }
  }

  window.pushTicker = function (word, result, rank, guessCount) {
    if (!tickerTrack || !word) return;
    if (!containerWidth) resize();
    if (!containerWidth) containerWidth = 640;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const el = document.createElement('div');
    el.className = 'ticker-item';
    el.dataset.word = key;

    let borderColor, textColor;
    if (rank != null && rank > 0) {
      const [r, g, b] = rankColorRgb(rank);
      borderColor = `rgba(${r},${g},${b},0.85)`;
      textColor = `rgb(${r},${g},${b})`;
    } else if (result === 'correct') {
      borderColor = 'rgba(158,234,58,0.55)'; textColor = 'var(--accent-green)';
    } else if (result === 'miss_in_article') {
      borderColor = 'rgba(212,183,65,0.55)'; textColor = 'var(--accent-yellow)';
    } else if (result === 'already_found' || result === 'incorrect' || result === 'miss') {
      borderColor = 'rgba(212,63,63,0.55)'; textColor = 'var(--accent-red)';
    } else {
      borderColor = 'var(--border)'; textColor = 'var(--text)';
    }

    el.style.borderColor = borderColor;
    el.style.color = textColor;
    // Stack by rank: closer to 1 = higher z-index = renders in front of
    // worse-ranked guesses when they overlap on the conveyor.
    let _zr = 20;
    if (rank != null && rank > 0) {
      _zr = Math.max(20, 220 - Math.floor(Math.log10(Math.max(1, rank)) * 26));
    }
    el.style.zIndex = String(_zr);

    let html = '';
    if (result === 'already_found' && guessCount) {
      html += `<span class="tw-rank">×${guessCount}</span>`;
    } else if (rank != null) {
      html += `<span class="tw-rank">#${rank}</span>`;
    }
    html += `<span class="tw-word">${(word || '').toUpperCase()}</span>`;
    el.innerHTML = html;

    // Keep the pill from painting at x=0 while it is measured. Positioning it
    // synchronously before restoring visibility removes the left-edge flash
    // that looked like the animation stopping and restarting.
    el.style.visibility = 'hidden';
    tickerTrack.appendChild(el);
    const width = el.offsetWidth || 100;

    let rightmost = 0;
    for (const it of items) rightmost = Math.max(rightmost, it.x + it.width);
    const startX = Math.max(containerWidth + 20, rightmost + GAP);

    const _speed = (result === 'already_found') ? FAST_PPS : speedForRank(rank);
    el.style.transform = `translate3d(${startX}px, -50%, 0)`;
    el.style.visibility = '';
    items.push({ el, x: startX, width, speed: _speed });
    start();
  };

  window.clearTicker = function () {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    lastFrameAt = null;
    if (tickerTrack) tickerTrack.innerHTML = '';
    items = [];
    seen.clear();
  };
})();
