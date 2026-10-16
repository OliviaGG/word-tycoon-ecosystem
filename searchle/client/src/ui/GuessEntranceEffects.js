// Occasional finite flourishes layered over the list's existing spring motion.
// Child animations leave row placement, secondary motion and equipped effects
// under their original owners. Pending choices survive DOM virtualization.
export const GUESS_ENTRANCE_CHANCE = 0.08;
const COOLDOWN_MS = 10000;
const MAX_PENDING = 64;
const KINDS = ['glint', 'lift', 'pop'];
const controllers = new WeakMap();
const motionPreference = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function queueGuessEntrance(list, word, random = Math.random) {
  if (motionPreference?.matches || document.hidden) return;
  const roll = random();
  if (roll < 0 || roll >= GUESS_ENTRANCE_CHANCE) return;
  let controller = controllers.get(list);
  if (!controller) {
    controller = {pending: new Map(), active: new Set(), lastPlayedAt: -Infinity};
    controllers.set(list, controller);
  }
  if (controller.pending.has(word)) return;
  controller.pending.set(word, KINDS[Math.floor(roll / GUESS_ENTRANCE_CHANCE * KINDS.length)]);
  if (controller.pending.size > MAX_PENDING) {
    controller.pending.delete(controller.pending.keys().next().value);
  }
}

export function tickGuessEntrances(list, now = performance.now()) {
  const controller = controllers.get(list);
  if (!controller) return;
  for (const effect of controller.active) {
    if (motionPreference?.matches || document.hidden || !effect.entry.element.isConnected
      || !list._springs.has(effect.word) || !list.isWordInView(effect.word)
      || effect.entry.element.style.visibility === 'hidden') effect.stop();
  }
  for (const [word, kind] of controller.pending) {
    if (!list.entries.has(word) && !list._virtualPool.has(word)) {
      controller.pending.delete(word);
      continue;
    }
    if (motionPreference?.matches) {
      controller.pending.delete(word);
      continue;
    }
    const entry = list.entries.get(word);
    if (!entry || !entry.element.isConnected || list._springs.get(word)?.detached
      || !list.isWordInView(word) || entry.element.style.visibility === 'hidden'
      || document.hidden) continue;
    // Consume on the first visible appearance, even during cooldown. Never
    // replay a scroll/reorder or launch a delayed flourish on a settled row.
    controller.pending.delete(word);
    if (now - controller.lastPlayedAt < COOLDOWN_MS || controller.active.size) continue;
    if (typeof entry.element.animate !== 'function') continue;
    const effect = playEntrance(entry, word, kind, controller);
    if (effect) {
      controller.lastPlayedAt = now;
      controller.active.add(effect);
    }
  }
}

function playEntrance(entry, word, kind, controller) {
  const row = entry.element;
  const animations = [], layers = [];
  const effect = {
    entry, word,
    stop() {
      if (effect.stopped) return;
      effect.stopped = true;
      // Also handle cancellation after a partially unsupported keyframe call.
      Promise.allSettled(animations.map(animation => animation.finished));
      animations.forEach(animation => animation.cancel());
      layers.forEach(layer => layer.remove());
      delete row.dataset.guessEntrance;
      controller.active.delete(effect);
    },
  };
  const animate = (target, frames, duration, delay = 0) => {
    if (!target) return;
    animations.push(target.animate(frames, {
      duration, delay, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'none',
    }));
  };
  const chip = row.querySelector('.guess-chip');
  const portrait = row.querySelector('.guess-pic-wrap');
  const name = row.querySelector('.name-title-col');
  try {
    if (kind === 'glint') {
      const clip = document.createElement('span');
      clip.className = 'guess-entrance-sheen';
      clip.setAttribute('aria-hidden', 'true');
      clip.style.cssText = 'position:absolute;inset:3px;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:2;';
      const beam = document.createElement('span');
      beam.style.cssText = 'position:absolute;top:0;bottom:0;left:0;width:28%;background:linear-gradient(110deg,transparent,#d5efff1f,transparent);pointer-events:none;';
      clip.append(beam);
      row.append(clip);
      layers.push(clip);
      animate(beam, [
        {transform:'translateX(-110%)',opacity:0},
        {transform:'translateX(45%)',opacity:1,offset:.23},
        {transform:'translateX(380%)',opacity:0},
      ], 950);
      animate(chip, [{scale:'0.985'}, {scale:'1.012',offset:.4}, {scale:'1'}], 700);
    } else if (kind === 'lift') {
      animate(chip, [
        {translate:'0 20px',rotate:'-.7deg'},
        {translate:'0 -5px',rotate:'.25deg',offset:.55},
        {translate:'0 0',rotate:'0deg'},
      ], 780);
      animate(portrait, [
        {translate:'0 18px',scale:'.94'},
        {translate:'0 -7px',scale:'1.03',offset:.52},
        {translate:'0 0',scale:'1'},
      ], 760, 55);
      animate(name, [{translate:'0 12px'}, {translate:'0 0'}], 640, 100);
    } else {
      animate(chip, [
        {scale:'.94 1.015'},
        {scale:'1.025 .985',offset:.46},
        {scale:'.995 1.005',offset:.74},
        {scale:'1'},
      ], 780);
      animate(portrait, [
        {scale:'.82',rotate:'-3deg'},
        {scale:'1.055',rotate:'1deg',offset:.52},
        {scale:'1',rotate:'0deg'},
      ], 740, 80);
      animate(name, [{translate:'14px 0'}, {translate:'0 0'}], 620, 110);
    }
    if (!animations.length) return null;
    row.dataset.guessEntrance = kind;
    Promise.allSettled(animations.map(animation => animation.finished)).then(effect.stop);
    return effect;
  } catch {
    // Older browser animation support must never interrupt a live guess.
    effect.stop();
    return null;
  }
}
