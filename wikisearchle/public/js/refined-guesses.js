/* Shared cached-row adaptation of Subtextle's GuessPanelSize and
   GuessEntranceEffects. Only live guesses are eligible; snapshots seed seen. */
(function (global) {
  'use strict';
  const CHANCE = 0.08, COOLDOWN = 10000, KINDS = ['glint', 'lift', 'pop'];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const rows = new Map();
  const controllers = new Set();
  const context = document.createElement('canvas').getContext('2d');
  function textWidth(el, text) {
    const style = getComputedStyle(el);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    return context.measureText(text || el.textContent || '').width;
  }
  function fit(card) {
    const panel = card.querySelector('.card-inner.base .who');
    const chip = card.querySelector('.card-inner.base .rank-word');
    const name = panel?.querySelector('.gname'), word = chip?.querySelector('.word-lbl');
    if (!name || !word || !card.isConnected || !card.clientWidth) return;
    word.style.fontSize = ''; word.style.letterSpacing = '';
    card.classList.remove('guess-panel-compact');
    const style = getComputedStyle(panel);
    const avatarWidth = panel.querySelector('.avatar-fb').offsetWidth;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const minimum = avatarWidth + padding;
    const preferred = Math.ceil(textWidth(name) + minimum + parseFloat(style.columnGap) + 2);
    const rankWidth = chip.querySelector('.rank').offsetWidth;
    const desiredWordWidth = textWidth(word) + rankWidth + 18;
    const available = card.clientWidth - 9;
    let width = Math.min(preferred, card.clientWidth / 2, Math.max(minimum, available - desiredWordWidth));
    if (width - minimum < 32) {
      width = minimum;
      card.classList.add('guess-panel-compact');
    }
    panel.style.setProperty('--guess-panel-width', `${width}px`);
    // Layout coordinates, not a transformed bounding rect: OBS scales the
    // scene and entrances animate children. This boundary stays anchored.
    card.style.setProperty('--guess-water-width', `${panel.offsetLeft}px`);
    let size = parseFloat(getComputedStyle(word).fontSize);
    while (word.scrollWidth > word.clientWidth + 1 && size > 10) {
      word.style.fontSize = `${--size}px`;
    }
  }
  function prepare(card, cos) {
    card.dataset.refinedGuess = 'true';
    // Both old text layers are white; the duplicate only existed for the
    // old capsule fill. One layer prevents double paint during flourishes.
    card.querySelector('.card-inner.overlay')?.remove();
    const panel = card.querySelector('.card-inner.base .who');
    if (!panel) return;
    if (!panel.querySelector('.guess-panel-glow')) {
      const glow = document.createElement('span');
      glow.className = 'guess-panel-glow'; glow.setAttribute('aria-hidden', 'true');
      glow.innerHTML = '<span class="guess-panel-frame"></span><span class="guess-panel-surface"></span>';
      panel.prepend(glow);
    }
    const painted = !!(cos?.hero_badge?.background || cos?.hero_badge?.render || cos?.word_color?.color
      || cos?.word_color?.backgroundImage || cos?.word_glow?.textShadow);
    card.classList.toggle('guess-panel-painted', painted);
    if (!rows.has(card)) {
      let frame = 0;
      const refresh = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(card); });
      };
      const observer = new ResizeObserver(refresh);
      observer.observe(card); observer.observe(panel);
      observer.observe(panel.querySelector('.gname'));
      observer.observe(card.querySelector('.word-lbl'));
      rows.set(card, {refresh, dispose() { observer.disconnect(); cancelAnimationFrame(frame); }});
    }
    rows.get(card).refresh();
  }
  function dispose(card) {
    rows.get(card)?.dispose(); rows.delete(card);
    for (const controller of controllers) controller.stopRow(card);
    card.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
  }
  function updateEquipment(data) {
    const id = String(data.platformUserId || '');
    const discordId = value => String(value || '').replace(/^discord[:_]/i, '');
    for (const card of rows.keys()) {
      const user = card._guessUser;
      if (!user) continue;
      const same = (user.platform === data.platform && String(user.platformUserId || user.id) === id)
        || (data.platform === 'discord' && (discordId(user.linkedDiscord) === id
          || (['web', 'discord'].includes(user.platform) && discordId(user.platformUserId || user.id) === id)));
      if (!same) continue;
      const apply = cos => {
        if (!card.isConnected || card._guessUser !== user) return;
        user.cosmetics = cos || {};
        prepare(card, user.cosmetics);
        global.WikiCosmetics?.apply({
          surfaceEl: card.querySelector('.guess-panel-surface'),
          wordFrameEl: card.querySelector('.guess-panel-frame'),
          wordGlowEl: card.querySelector('.guess-panel-glow'),
          avatarEl: card.querySelector('.avatar-fb'), nameEl: card.querySelector('.gname'),
          titleContainer: card.querySelector('.who-text'),
        }, user.cosmetics);
        fit(card);
      };
      if (Object.prototype.hasOwnProperty.call(data, 'equipped')) apply(data.equipped);
      else global.cosmeticsCache?.getPlayerCosmetics(data.platform, id).then(apply);
    }
  }
  document.fonts?.addEventListener('loadingdone', () => rows.forEach(r => r.refresh()));
  function create(list) {
    const pending = new Map(), seen = new Set(), active = new Set(), attached = new Map();
    let lastPlayed = -Infinity;
    function visible(card) {
      if (!card.isConnected || document.hidden || getComputedStyle(card).visibility === 'hidden') return false;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
      // IntersectionObserver supplies the clipped viewport intersection.
      return attached.get(card) === true;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) attached.set(entry.target, entry.isIntersecting);
      tick();
    });
    function stopRow(card) { for (const effect of active) if (effect.card === card) effect.stop(); }
    function tick() {
      for (const effect of active) if (motion.matches || !visible(effect.card)) effect.stop();
      for (const [word, kind] of pending) {
        const card = [...attached.keys()].find(c => c.dataset.word === word && visible(c));
        if (!card) continue;
        pending.delete(word); // Consume on first appearance, even in cooldown.
        if (motion.matches || performance.now() - lastPlayed < COOLDOWN || active.size) continue;
        const effect = play(card, kind, active);
        if (effect) { active.add(effect); lastPlayed = performance.now(); }
      }
    }
    const controller = {
      queue(word, random = Math.random) {
        if (!word || seen.has(word)) return;
        seen.add(word);
        if (motion.matches || document.hidden) return;
        const roll = random();
        if (roll < 0 || roll >= CHANCE) return;
        pending.set(word, KINDS[Math.floor(roll / CHANCE * KINDS.length)]);
        if (pending.size > 64) pending.delete(pending.keys().next().value);
      },
      snapshot(guesses) {
        pending.clear(); active.forEach(e => e.stop());
        for (const g of guesses || []) seen.add(g.word);
      },
      reset() { pending.clear(); seen.clear(); active.forEach(e => e.stop()); },
      sync() {
        const current = new Set(list.querySelectorAll('.card[data-word]'));
        for (const card of attached.keys()) if (!current.has(card)) {
          observer.unobserve(card); attached.delete(card); dispose(card);
        }
        for (const card of current) if (!attached.has(card)) { attached.set(card, false); observer.observe(card); }
        tick();
      },
      stopRow,
      stop() { pending.clear(); active.forEach(e => e.stop()); },
      destroy() {
        controller.stop(); observer.disconnect(); attached.forEach((_, c) => dispose(c));
        attached.clear(); controllers.delete(controller);
      },
    };
    controllers.add(controller);
    return controller;
  }
  function play(card, kind, active) {
    const animations = [], layers = [];
    const effect = {card, stop() {
      if (effect.stopped) return;
      effect.stopped = true;
      Promise.allSettled(animations.map(a => a.finished));
      animations.forEach(a => a.cancel()); layers.forEach(l => l.remove());
      delete card.dataset.guessEntrance; active.delete(effect);
    }};
    const animate = (target, frames, duration, delay = 0) => {
      if (target) animations.push(target.animate(frames, {duration, delay, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'none'}));
    };
    const chip = card.querySelector('.rank-word'), avatar = card.querySelector('.avatar-fb'), name = card.querySelector('.who-text');
    try {
      if (kind === 'glint') {
        const clip = document.createElement('span'); clip.className = 'guess-entrance-sheen'; clip.setAttribute('aria-hidden', 'true');
        clip.style.cssText = 'position:absolute;inset:1px;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:3;';
        const beam = document.createElement('span');
        beam.style.cssText = 'position:absolute;top:0;bottom:0;left:0;width:28%;background:linear-gradient(110deg,transparent,#d5efff1f,transparent);';
        clip.append(beam); card.append(clip); layers.push(clip);
        animate(beam, [{transform:'translateX(-110%)',opacity:0},{transform:'translateX(45%)',opacity:1,offset:.23},{transform:'translateX(380%)',opacity:0}], 950);
        animate(chip, [{scale:'.985'},{scale:'1.012',offset:.4},{scale:'1'}], 700);
      } else if (kind === 'lift') {
        animate(chip, [{translate:'0 5px',rotate:'-.7deg'},{translate:'0 -1px',rotate:'.25deg',offset:.55},{translate:'0 0',rotate:'0deg'}], 780);
        animate(avatar, [{translate:'0 4px',scale:'.94'},{translate:'0 -2px',scale:'1.03',offset:.52},{translate:'0 0',scale:'1'}], 760, 55);
        animate(name, [{translate:'0 3px'},{translate:'0 0'}], 640, 100);
      } else {
        animate(chip, [{scale:'.94 1.015'},{scale:'1.025 .985',offset:.46},{scale:'.995 1.005',offset:.74},{scale:'1'}], 780);
        animate(avatar, [{scale:'.82',rotate:'-3deg'},{scale:'1.055',rotate:'1deg',offset:.52},{scale:'1',rotate:'0deg'}], 740, 80);
        animate(name, [{translate:'3px 0'},{translate:'0 0'}], 620, 110);
      }
      if (!animations.length) return null;
      card.dataset.guessEntrance = kind;
      Promise.allSettled(animations.map(a => a.finished)).then(effect.stop);
      return effect;
    } catch { effect.stop(); return null; }
  }
  const stop = () => controllers.forEach(c => c.stop());
  motion.addEventListener('change', () => { if (motion.matches) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  global.addEventListener('scroll', () => controllers.forEach(c => c.sync()), {capture: true, passive: true});
  global.addEventListener('pagehide', event => {
    controllers.forEach(c => event.persisted ? c.stop() : c.destroy());
    if (!event.persisted) rows.forEach((_, c) => dispose(c));
  });
  global.WikiGuessCards = {prepare, fit, dispose, create, updateEquipment, CHANCE, COOLDOWN};
})(window);
