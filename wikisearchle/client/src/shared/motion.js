// A bounded animation layer shared by Solo and Online. Renderers explicitly
// distinguish live reveals from snapshots; no DOM observer infers guesses.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const active = new Set();
const byElement = new WeakMap();
const seenIds = new Set(), seenWords = new Set(), seenTitles = new Set();
const events = new AbortController();
let suspended = false, pendingArticle = false, frame = 0;
const obs = () => document.documentElement.classList.contains('obs-overlay-mode') ||
  new URLSearchParams(location.search).has('obs') || window.__WS_OBS_MODE;
const allowed = () => !suspended && !document.hidden && !reduced.matches && !obs();
function visible(el) {
  if (!el?.isConnected) return false;
  const r = el.getBoundingClientRect();
  const clip = el.closest('#body')?.getBoundingClientRect();
  if (clip && (r.bottom <= clip.top || r.top >= clip.bottom)) return false;
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}
function animate(el, frames, options = {}) {
  if (!allowed() || !visible(el) || !el.animate || active.size >= 32) return;
  byElement.get(el)?.cancel();
  const animation = el.animate(frames, { duration: 320, easing: 'cubic-bezier(.2,.75,.25,1)', ...options });
  active.add(animation);
  byElement.set(el, animation);
  animation.finished.catch(() => {}).finally(() => active.delete(animation));
}
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const animation of active) animation.cancel();
  active.clear();
}
function ready() {
  if (!pendingArticle || document.body.classList.contains('game-loading')) return;
  pendingArticle = false;
  if (!allowed()) return;
  const panels = document.querySelectorAll('.title-block, .solo-stats, .scoreboard, #cards, .article-body-panel');
  panels.forEach((panel, i) => animate(panel, [
    { opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 400, delay: Math.min(i * 35, 140) }));
}
function article() {
  stop();
  seenIds.clear(); seenWords.clear(); seenTitles.clear();
  document.querySelectorAll('#body .word.revealed').forEach(el => {
    if (el.dataset.id) seenIds.add(el.dataset.id);
    if (el.dataset.norm) seenWords.add(el.dataset.norm);
  });
  document.querySelectorAll('#titleText .t-word.revealed .w-text').forEach(el => seenTitles.add(el.textContent));
  pendingArticle = true;
  frame = requestAnimationFrame(() => { frame = requestAnimationFrame(ready); });
}
function reveal(ids, { title = false } = {}) {
  if (!allowed()) return;
  let index = 0;
  for (const id of new Set(ids || [])) {
    if (seenIds.has(String(id))) continue;
    seenIds.add(String(id));
    const el = document.querySelector(`#body .word.revealed[data-id="${CSS.escape(String(id))}"]`);
    if (!visible(el)) continue;
    animate(el, [
      { opacity: .3, transform: 'translateY(3px) scale(.96)', backgroundColor: '#55e8ab70' },
      { opacity: 1, transform: 'translateY(0) scale(1)', backgroundColor: 'transparent' },
    ], { delay: Math.min(index++ * 18, 144), duration: 460 });
    if (index === 24) break;
  }
  if (title) {
    document.querySelectorAll('#titleText .t-word.revealed .w-text').forEach(el => {
      if (seenTitles.has(el.textContent)) return;
      seenTitles.add(el.textContent);
      animate(el, [
      { transform: 'scale(.94)', filter: 'brightness(1.3)' },
      { transform: 'scale(1.035)', filter: 'brightness(1.1)', offset: .6 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
      ], { duration: 380 });
    });
  }
}
function revealWords(words) {
  const fresh = new Set((words || []).map(word => String(word).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(word => word && !seenWords.has(word)));
  fresh.forEach(word => seenWords.add(word));
  let index = 0;
  document.querySelectorAll('#body .word.revealed').forEach(el => {
    if (!fresh.has(el.dataset.norm) || !visible(el) || index >= 24) return;
    animate(el, [
      { opacity: .3, transform: 'translateY(3px) scale(.96)', backgroundColor: '#55e8ab70' },
      { opacity: 1, transform: 'translateY(0) scale(1)', backgroundColor: 'transparent' },
    ], { delay: Math.min(index++ * 18, 144), duration: 460 });
  });
}
function rankUpdate(render, restored = false) {
  const old = new Map();
  const play = allowed() && !restored && !pendingArticle && !document.body.classList.contains('game-loading');
  if (play) document.querySelectorAll('#cards .card:not(.placeholder)').forEach(el => old.set(el, el.getBoundingClientRect()));
  const result = render();
  if (play) old.forEach((before, el) => {
    if (!visible(el)) return;
    const after = el.getBoundingClientRect(), zoom = after.height / el.offsetHeight || 1;
    const delta = (before.top - after.top) / zoom;
    if (Math.abs(delta) > 1 && Math.abs(delta) < 500) animate(el, [
      { transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' },
    ], { duration: 260 });
  });
  return result;
}
window.WikiMotion = { article, reveal, revealWords, rankUpdate, stop };
// Only loading-state changes are observed, keeping multiplayer bursts cheap.
const observer = new MutationObserver(() => {
  if (document.body.classList.contains('game-loading')) stop(); else ready();
});
observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pendingArticle = false; stop(); } }, { signal: events.signal });
reduced.addEventListener('change', () => { if (reduced.matches) { pendingArticle = false; stop(); } }, { signal: events.signal });
window.addEventListener('pagehide', () => { suspended = true; pendingArticle = false; stop(); }, { signal: events.signal });
window.addEventListener('pageshow', () => { suspended = false; }, { signal: events.signal });
if (import.meta.hot) import.meta.hot.dispose(() => { events.abort(); observer.disconnect(); stop(); });
