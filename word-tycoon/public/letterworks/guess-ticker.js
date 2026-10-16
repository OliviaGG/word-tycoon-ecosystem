(function () {
  'use strict';
  window.LetterworksGuessTicker = { create(container) {
    let key = null, sequence = 0, previousTime = 0, frame = null;
    let queue = [], moving = [];
    const counts = new Map();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.classList.toggle('guess-ticker-still', reduced);
    function reset(nextKey) {
      if (key === nextKey) return;
      key = nextKey; sequence = 0; queue = []; moving = []; counts.clear(); container.replaceChildren();
    }
    function chip(guess) {
      const element = document.createElement('span');
      element.className = 'guess-chip guess-' + guess.status;
      element.textContent = (guess.status === 'correct' ? '✓ ' : guess.status === 'incorrect' ? '✕ ' : '↻ ') + guess.word.toUpperCase()
        + (guess.status === 'duplicate' ? ' ×' + guess.count : '');
      element.title = guess.word.toUpperCase() + ' · ' + (guess.status === 'duplicate' ? 'Already guessed, ' + guess.count + ' total guesses' : guess.status);
      return element;
    }
    function animate(time) {
      frame = null;
      const delta = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0; previousTime = time;
      if (!document.hidden) {
        const width = container.clientWidth, speed = Math.min(480, 65 + queue.length * 8);
        moving.forEach(item => { item.x -= delta * speed; item.element.style.transform = 'translateX(' + item.x + 'px)'; });
        moving = moving.filter(item => { if (item.x + item.width < 0) { item.element.remove(); return false; } return true; });
        const last = moving[moving.length - 1];
        if (width && queue.length && (!last || last.x + last.width + 14 <= width)) {
          const element = chip(queue.shift()); container.append(element);
          element.style.transform = 'translateX(' + width + 'px)';
          moving.push({ element, x: width, width: element.offsetWidth });
        }
      }
      if (queue.length || moving.length) frame = requestAnimationFrame(animate);
    }
    function add(guess) {
      if (!/^[a-z]{1,6}$/i.test(guess.word) || !['correct', 'incorrect', 'duplicate'].includes(guess.status)) return;
      const safe = { word: guess.word, status: guess.status, count: Math.max(1, Math.floor(Number(guess.count) || 1)) };
      if (reduced) {
        container.append(chip(safe));
        while (container.children.length > 12) container.firstElementChild.remove();
        container.scrollLeft = container.scrollWidth;
      } else {
        queue.push(safe); if (queue.length > 200) queue.shift();
        if (!frame) { previousTime = 0; frame = requestAnimationFrame(animate); }
      }
    }
    return { reset, add,
      push(word, status, shift) {
        const clean = String(word || '').trim().toLowerCase(), countKey = shift + ':' + clean;
        const count = (counts.get(countKey) || (status === 'duplicate' ? 1 : 0)) + 1; counts.set(countKey, count);
        if (counts.size > 1000) counts.delete(counts.keys().next().value);
        add({ word: clean, status, count });
      },
      sync(guesses, runId) {
        const fresh = key !== runId; reset(runId);
        const list = Array.isArray(guesses) ? guesses : [];
        (fresh ? list.slice(-12) : list).forEach(guess => { if (guess.id > sequence) { add(guess); sequence = guess.id; } });
      }
    };
  } };
})();
