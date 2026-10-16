(function () {
  'use strict';
  const C = window.WordTrails;
  const $ = id => document.getElementById(id);
  const SAVE_KEY = `word-trails:${C.VERSION}`;
  const dialogs = [...document.querySelectorAll('dialog')];
  let store = { version: C.VERSION, current: 0, mode: 'trail', levels: {}, records: {}, dailies: {}, dailyRecords: {} };
  let puzzle, state, order = [], selection = [], focusWord = null, pointer = null, dragging = false, gesture = [], gestureStart = null;
  let completionTimer, feedbackTimer;
  let clockOffset = 0, clockPending = false;
  const currentTime = () => new Date(Date.now() + clockOffset);
  let today = C.getEdmontonDate(currentTime()), resetAt = C.nextDailyReset(currentTime());
  let saveAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && saved.version === C.VERSION && saved.levels && typeof saved.levels === 'object' && saved.records && typeof saved.records === 'object') {
      store.levels = saved.levels;
      for (const p of C.puzzles) {
        const record = saved.records[p.id];
        if (Number.isInteger(record) && record >= 1 && record <= 3) store.records[p.id] = record;
      }
      store.current = Number.isInteger(saved.current) ? Math.max(0, Math.min(C.puzzles.length - 1, saved.current)) : 0;
      store.mode = saved.mode === 'daily' ? 'daily' : 'trail';
      store.dailies = saved.dailies && typeof saved.dailies === 'object' ? saved.dailies : {};
      if (saved.dailyRecords && typeof saved.dailyRecords === 'object') for (const [date, score] of Object.entries(saved.dailyRecords)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isInteger(score) && score >= 1 && score <= 3) store.dailyRecords[date] = score;
      }
    }
  } catch (_) { saveAvailable = false; }

  function frontier() {
    const index = C.puzzles.findIndex(p => !store.records[p.id]);
    return index < 0 ? C.puzzles.length - 1 : index;
  }
  function save() {
    if (!puzzle) return;
    if (puzzle.mode === 'daily') {
      store.dailies[puzzle.date] = { ...state, hints: state.hints };
      const dates = Object.keys(store.dailies).sort();
      while (dates.length > 60) delete store.dailies[dates.shift()];
    } else store.levels[puzzle.id] = { ...state, hints: state.hints };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(store)); saveAvailable = true; }
    catch (_) { saveAvailable = false; }
    $('saveStatus').textContent = saveAvailable ? 'Progress saves in this browser' : 'Storage unavailable · progress lasts until you close this page';
  }
  function say(message, type) {
    clearTimeout(feedbackTimer);
    $('feedback').textContent = message;
    $('feedback').className = `feedback ${type || ''}`;
    feedbackTimer = setTimeout(() => {
      $('feedback').textContent = isComplete() ? 'All words found. Enjoy the view.' : 'Swipe, tap, or type a word.';
      $('feedback').className = 'feedback';
    }, 3500);
  }
  function isComplete() { return state.found.length === puzzle.targets.length; }
  function stars() { return state.hints === 0 ? 3 : state.hints <= 3 ? 2 : 1; }
  function closeDialogs() { dialogs.forEach(d => { if (d.open) d.close(); }); }
  function openDialog(id) { cancelGesture(); clearSelection(); closeDialogs(); $(id).showModal(); }
  function level(index, replay) {
    if (index > frontier()) return;
    clearTimeout(completionTimer);
    clearTimeout(feedbackTimer);
    cancelGesture(); closeDialogs();
    if (puzzle) save();
    store.current = index;
    store.mode = 'trail';
    loadPuzzle(C.puzzles[index], store.levels[C.puzzles[index].id], replay);
  }
  function daily() {
    if (puzzle) save();
    refreshDaily(false);
    store.mode = 'daily';
    loadPuzzle(C.getDaily(today), store.dailies[today]);
  }
  function loadPuzzle(next, raw, replay) {
    clearTimeout(completionTimer); clearTimeout(feedbackTimer);
    cancelGesture(); closeDialogs();
    puzzle = next;
    if (replay && C.progress(puzzle, raw).found.length === puzzle.targets.length) raw = { id: puzzle.id };
    state = C.progress(puzzle, raw);
    state.hints = raw && raw.id === puzzle.id && Number.isInteger(raw.hints) && raw.hints >= 0 && raw.hints <= puzzle.cells.length ? raw.hints : state.revealed.length;
    order = [...puzzle.rack].map((letter, index) => ({ letter, index }));
    selection = []; focusWord = null;
    const region = C.REGIONS[puzzle.region];
    document.body.dataset.theme = region.theme;
    document.body.dataset.mode = puzzle.mode;
    $('regionPlace').textContent = puzzle.mode === 'daily' ? 'ONE FRESH CROSSWORD, EVERY DAY' : region.place;
    $('regionName').replaceChildren(document.createTextNode(puzzle.mode === 'daily' ? 'Your daily escape' : region.name), Object.assign(document.createElement('span'), { textContent: '.' }));
    $('regionDescription').textContent = puzzle.mode === 'daily' ? `${formatDay(puzzle.date)} · The same crossword for everyone.` : region.description;
    $('levelLabel').textContent = puzzle.mode === 'daily' ? 'DAILY CROSSWORD' : `LEVEL ${String(puzzle.level).padStart(2, '0')}`;
    $('difficultyLabel').textContent = `${puzzle.difficulty} · ${puzzle.rack.length} letters`;
    $('difficultyLabel').dataset.difficulty = puzzle.difficulty.toLowerCase();
    $('chapterLabel').textContent = puzzle.mode === 'daily' ? 'A new puzzle at midnight in Edmonton' : `${['Mountain', 'Canyon', 'Ocean'][puzzle.region]} trail · ${puzzle.region + 1} of 3`;
    $('trailButton').classList.toggle('active', puzzle.mode === 'trail');
    $('trailButton').setAttribute('aria-pressed', String(puzzle.mode === 'trail'));
    $('dailyButton').classList.toggle('active', puzzle.mode === 'daily');
    $('dailyButton').setAttribute('aria-pressed', String(puzzle.mode === 'daily'));
    renderBoard(); renderWheel(); renderProgress(); resizeBoard(); save();
    say(isComplete() ? 'All words found. Enjoy the view.' : 'Swipe, tap, or type a word.');
  }
  function formatDay(date) {
    return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  }
  function refreshDaily(rollover = true) {
    const date = C.getEdmontonDate(currentTime());
    if (date !== today) {
      today = date; resetAt = C.nextDailyReset(currentTime());
      if (rollover && puzzle && puzzle.mode === 'daily') {
        save(); store.mode = 'daily'; loadPuzzle(C.getDaily(today), store.dailies[today]);
        say('A new day, a fresh crossword! Your previous daily is saved.', 'success');
        return true;
      }
    }
    $('dailyDate').textContent = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));
    const completed = store.dailyRecords[today];
    $('dailyBadge').textContent = completed ? '★'.repeat(completed) : 'NEW';
    $('dailyBadge').classList.toggle('done', Boolean(completed));
    const seconds = Math.max(0, Math.ceil((resetAt - currentTime().getTime()) / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60);
    $('dailyReset').textContent = `Next daily in ${h}h ${String(m).padStart(2, '0')}m`;
    const streak = C.dailyStreak(store.dailyRecords, today);
    $('dailyStreak').textContent = streak ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row` : 'A fresh challenge every day';
    return false;
  }
  async function syncDailyClock() {
    if (clockPending || document.hidden) return;
    clockPending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const started = Date.now();
    try {
      const response = await fetch('/api/word-trails/daily', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.ok || !Number.isFinite(data.serverNow) || !Number.isFinite(data.resetAt) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return;
      if (data.contentVersion !== C.VERSION || data.dailyVersion !== C.DAILY_VERSION) {
        say('A new Word Trails update is available. Refresh this page to play today’s crossword.');
        return;
      }
      clockOffset = data.serverNow - (started + Date.now()) / 2;
      resetAt = data.resetAt;
      refreshDaily();
    } catch (_) { /* Continue with the last known clock, or the offline clock. */ }
    finally { clearTimeout(timeout); clockPending = false; }
  }
  function resizeBoard() {
    if (!puzzle) return;
    const wrap = $('crossword').parentElement;
    const available = wrap.clientWidth - (window.innerWidth <= 730 ? 32 : 48);
    const gap = window.innerWidth <= 730 ? 5 : 6;
    const maxHeight = window.innerWidth <= 730 ? (window.innerHeight <= 900 ? 180 : 250) : 300;
    const tile = Math.floor(Math.min(54, (available - (puzzle.cols - 1) * gap) / puzzle.cols, (maxHeight - (puzzle.rows - 1) * gap) / puzzle.rows));
    $('crossword').style.setProperty('--tile', `${Math.max(20, tile)}px`);
  }
  function renderBoard(animate) {
    const grid = $('crossword');
    const visible = C.visibleCells(puzzle, state.found, state.revealed);
    const focused = new Set(focusWord ? C.wordCells(puzzle, focusWord) : []);
    grid.style.setProperty('--rows', puzzle.rows); grid.style.setProperty('--cols', puzzle.cols);
    grid.replaceChildren();
    for (const cell of puzzle.cells) {
      const k = C.key(cell.row, cell.col), button = document.createElement('button');
      button.type = 'button'; button.className = 'cell'; button.dataset.cell = k;
      button.style.gridRow = String(cell.row + 1); button.style.gridColumn = String(cell.col + 1);
      if (focused.has(k)) button.classList.add('focused');
      if (visible.has(k)) {
        button.textContent = cell.letter.toUpperCase(); button.classList.add('revealed');
        if (state.revealed.includes(k) && !state.found.some(w => C.wordCells(puzzle, w).includes(k))) button.classList.add('hinted');
      }
      if (animate && animate.has(k)) button.classList.add('just-found');
      button.setAttribute('aria-label', `Row ${cell.row + 1}, column ${cell.col + 1}: ${visible.has(k) ? cell.letter.toUpperCase() : 'hidden letter'}`);
      button.addEventListener('click', () => {
        const words = puzzle.words.filter(w => C.wordCells(puzzle, w.word).includes(k) && !state.found.includes(w.word));
        const next = words.find(w => w.word !== focusWord) || words[0];
        focusWord = next ? next.word : null;
        renderBoard();
        $('boardTip').textContent = next ? `${next.direction === 'across' ? 'Across' : 'Down'} · ${next.word.length} letters · ☼ reveals a letter` : 'Every word is a step forward.';
      });
      grid.append(button);
    }
  }
  function position(index) {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / order.length;
    return { x: 150 + Math.cos(angle) * 105, y: 150 + Math.sin(angle) * 105 };
  }
  function renderWheel() {
    $('wheel').querySelectorAll('.letter').forEach(b => b.remove());
    order.forEach((tile, index) => {
      const pos = position(index), button = document.createElement('button');
      button.type = 'button'; button.className = 'letter'; button.textContent = tile.letter;
      button.dataset.index = String(index); button.setAttribute('aria-label', `Letter ${tile.letter}, tile ${index + 1}`);
      button.style.left = `${pos.x / 3}%`; button.style.top = `${pos.y / 3}%`;
      button.addEventListener('click', event => {
        // Mouse/touch selection is handled by the pointer gesture. Keyboard and
        // assistive-technology activation generates a click without a pointer.
        if (event.detail === 0) choose(index);
      });
      $('wheel').append(button);
    });
    renderSelection();
  }
  function renderSelection(tail) {
    const word = selection.map(i => order[i].letter).join('');
    $('selection').replaceChildren();
    if (word) $('selection').textContent = word;
    else $('selection').append(Object.assign(document.createElement('span'), { textContent: 'Connect the letters' }));
    $('wheel').querySelectorAll('.letter').forEach(b => {
      const selected = selection.includes(Number(b.dataset.index));
      b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected));
    });
    const points = selection.map(i => { const p = position(i); return `${p.x},${p.y}`; });
    if (tail && selection.length) points.push(`${tail.x},${tail.y}`);
    $('selectionLine').setAttribute('points', points.join(' '));
  }
  function choose(index) {
    if (selection[selection.length - 1] === index) selection.pop();
    else if (selection.length > 1 && selection[selection.length - 2] === index) selection.pop();
    else if (!selection.includes(index)) selection.push(index);
    renderSelection();
  }
  function clearSelection() { selection = []; renderSelection(); }
  function cancelGesture() {
    if (pointer !== null && $('wheel').hasPointerCapture(pointer)) $('wheel').releasePointerCapture(pointer);
    pointer = null; dragging = false; gesture = []; gestureStart = null;
  }
  function submit() {
    if (refreshDaily()) return;
    const result = C.check(puzzle, selection.map(i => order[i].letter).join(''), state.found, state.bonus);
    if (result.type === 'target') {
      const before = C.visibleCells(puzzle, state.found, state.revealed);
      state.found.push(result.word);
      autoFind();
      const after = C.visibleCells(puzzle, state.found, state.revealed);
      const fresh = new Set([...after].filter(k => !before.has(k)));
      if (state.found.includes(focusWord)) focusWord = null;
      renderBoard(fresh); renderProgress(); save();
      say(`${result.word.toUpperCase()} · A step in the right direction.`, 'success');
      if (isComplete()) complete();
    } else if (result.type === 'bonus') {
      state.bonus.push(result.word); renderProgress(); save();
      say(`${result.word.toUpperCase()} · Extra discovery! ✦`, 'success');
    } else if (result.type === 'duplicate') say('You’ve already found that word. Try another.', '');
    else {
      say(result.message, 'invalid');
      $('selection').classList.remove('shake'); void $('selection').offsetWidth; $('selection').classList.add('shake');
    }
    clearSelection();
  }
  function autoFind() {
    const visible = C.visibleCells(puzzle, state.found, state.revealed);
    for (const word of puzzle.targets) if (!state.found.includes(word) && C.wordCells(puzzle, word).every(k => visible.has(k))) state.found.push(word);
  }
  function hint() {
    if (refreshDaily()) return;
    if (isComplete()) { say('Every crossword letter is already uncovered.'); return; }
    cancelGesture(); clearSelection();
    const visible = C.visibleCells(puzzle, state.found, state.revealed);
    const target = focusWord || puzzle.targets.find(w => !state.found.includes(w));
    const k = C.wordCells(puzzle, target).find(k => !visible.has(k));
    if (!k) return;
    state.revealed.push(k); state.hints++; autoFind();
    if (state.found.includes(focusWord)) focusWord = null;
    renderBoard(new Set([k])); renderProgress(); save();
    say(`A little sunshine. ${state.hints} ${state.hints === 1 ? 'hint' : 'hints'} used.`, 'success');
    if (isComplete()) complete();
  }
  function renderProgress() {
    $('wordCount').textContent = `${state.found.length} of ${puzzle.targets.length} words`;
    $('progressFill').style.width = `${100 * state.found.length / puzzle.targets.length}%`;
    $('bonusCount').textContent = String(state.bonus.length);
    $('bonusButton').hidden = puzzle.bonus.length === 0;
    $('trailCount').textContent = `${Object.keys(store.records).length} / ${C.puzzles.length}`;
    const done = isComplete();
    $('hintButton').disabled = done;
    $('submitButton').textContent = done ? (puzzle.mode === 'daily' ? 'Daily complete ★' : puzzle.level < C.puzzles.length ? 'Next level →' : 'Trail complete ✦') : 'Enter word ↵';
    const focused = focusWord && puzzle.words.find(w => w.word === focusWord);
    $('boardTip').textContent = done ? 'Crossword complete. Your next view awaits.' : focused ? `${focused.direction === 'across' ? 'Across' : 'Down'} · ${focused.word.length} letters · ☼ reveals a letter` : 'Every word is a step forward.';
    $('levelSteps').replaceChildren();
    $('trailEyebrow').textContent = puzzle.mode === 'daily' ? 'TODAY’S LITTLE ADVENTURE' : 'EASY STEPS. BIGGER DISCOVERIES.';
    if (puzzle.mode === 'daily') {
      const dailyInfo = document.createElement('div'); dailyInfo.className = 'daily-strip-info';
      dailyInfo.append(Object.assign(document.createElement('strong'), { textContent: store.dailyRecords[today] ? '★'.repeat(store.dailyRecords[today]) + ' Daily finished' : '✦ ' + formatDay(puzzle.date) }));
      dailyInfo.append(Object.assign(document.createElement('small'), { textContent: 'Daily progress stays separate from your trail' }));
      $('levelSteps').append(dailyInfo); refreshDaily(false); return;
    }
    for (let i = puzzle.region * C.LEVELS_PER_REGION; i < (puzzle.region + 1) * C.LEVELS_PER_REGION; i++) {
      const p = C.puzzles[i], button = document.createElement('button');
      button.type = 'button'; button.className = 'step'; button.textContent = store.records[p.id] ? '✓' : String(i + 1).padStart(2, '0');
      if (i === store.current) { button.classList.add('current'); button.setAttribute('aria-current', 'step'); }
      else if (store.records[p.id]) button.classList.add('finished');
      button.disabled = i > frontier();
      button.setAttribute('aria-label', `Level ${i + 1}${store.records[p.id] ? ', completed' : ''}${button.disabled ? ', locked' : ''}`);
      button.addEventListener('click', () => level(i, true)); $('levelSteps').append(button);
    }
    refreshDaily(false);
  }
  function complete() {
    if (puzzle.mode === 'daily') store.dailyRecords[puzzle.date] = Math.max(store.dailyRecords[puzzle.date] || 0, stars());
    else store.records[puzzle.id] = Math.max(store.records[puzzle.id] || 0, stars());
    save(); renderProgress();
    clearTimeout(completionTimer);
    completionTimer = setTimeout(showCompletion, 700);
  }
  function showCompletion() {
    clearTimeout(completionTimer);
    const isDaily = puzzle.mode === 'daily', last = !isDaily && puzzle.level === C.puzzles.length, score = stars();
    $('completeTitle').textContent = isDaily ? 'Daily adventure complete!' : last ? 'A trail well traveled.' : 'Beautifully done.';
    const extras = `${state.bonus.length} extra ${state.bonus.length === 1 ? 'word' : 'words'}`;
    const details = `${state.hints ? `${state.hints} ${state.hints === 1 ? 'hint' : 'hints'} used` : 'All on your own'} · ${extras} found.`;
    $('completeCopy').textContent = isDaily ? `${formatDay(puzzle.date)} · ${details} Come back for a fresh crossword tomorrow.` : last ? `You’ve explored all ${C.puzzles.length} puzzles. ${extras} on this last stop. More trails can grow from here.` : `Level ${puzzle.level} complete · ${details}`;
    $('completeStars').replaceChildren();
    for (let i = 0; i < 3; i++) $('completeStars').append(Object.assign(document.createElement('span'), { textContent: '★', className: i >= score ? 'dim' : '' }));
    $('completeStars').setAttribute('aria-label', `${score} of 3 stars`);
    fillPills($('completeWords'), puzzle.targets);
    $('nextButton').textContent = isDaily ? 'Continue your trail →' : last ? 'View your whole trail ↗' : puzzle.level % C.LEVELS_PER_REGION === 0 ? `Explore ${C.REGIONS[puzzle.region + 1].name.toLowerCase()} →` : 'Next little adventure →';
    $('replayButton').hidden = isDaily;
    openDialog('completeDialog');
  }
  function fillPills(element, words) {
    element.replaceChildren(); words.forEach(word => element.append(Object.assign(document.createElement('span'), { textContent: word })));
  }
  function showMap() {
    const map = $('trailMap'); map.replaceChildren();
    C.REGIONS.forEach((region, r) => {
      const section = document.createElement('section'); section.className = 'map-region';
      const heading = document.createElement('h3'); heading.textContent = region.name;
      const count = C.puzzles.filter(p => p.region === r && store.records[p.id]).length;
      heading.append(Object.assign(document.createElement('small'), { textContent: `${count} / ${C.LEVELS_PER_REGION} explored` })); section.append(heading);
      const levels = document.createElement('div'); levels.className = 'map-levels';
      for (let i = r * C.LEVELS_PER_REGION; i < (r + 1) * C.LEVELS_PER_REGION; i++) {
        const p = C.puzzles[i], button = document.createElement('button');
        button.type = 'button'; button.className = `map-level${i === store.current && puzzle.mode === 'trail' ? ' current' : ''}`;
        button.textContent = String(p.level).padStart(2, '0'); button.disabled = i > frontier();
        button.append(Object.assign(document.createElement('small'), { textContent: store.records[p.id] ? '★'.repeat(store.records[p.id]) : button.disabled ? 'locked' : 'explore' }));
        button.setAttribute('aria-label', `Level ${p.level}${button.disabled ? ', locked' : ''}${store.records[p.id] ? `, ${store.records[p.id]} stars` : ''}`);
        button.title = `${p.difficulty} · ${p.rack.length} letters · ${p.targets.length} words`;
        button.addEventListener('click', () => level(i, true)); levels.append(button);
      }
      section.append(levels); map.append(section);
    });
    openDialog('mapDialog');
  }
  $('wheel').addEventListener('pointerdown', event => {
    if (refreshDaily()) return;
    if (!event.isPrimary || event.button !== 0 || dialogs.some(d => d.open)) return;
    const target = event.target.closest('.letter'); if (!target) return;
    event.preventDefault();
    pointer = event.pointerId; dragging = false; gesture = [...selection];
    const index = Number(target.dataset.index);
    gestureStart = index;
    choose(index);
    $('wheel').setPointerCapture(pointer);
  });
  $('wheel').addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const rect = $('wheel').getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) * 300 / rect.width, y: (event.clientY - rect.top) * 300 / rect.height };
    const radius = $('wheel').querySelector('.letter').offsetWidth * 150 / rect.width;
    const index = order.findIndex((_, i) => { const p = position(i); return Math.hypot(point.x - p.x, point.y - p.y) < radius; });
    if (index >= 0 && index !== selection[selection.length - 1]) {
      if (!dragging) {
        // A swipe starts fresh, while a stationary tap appends to a word.
        selection = [gestureStart]; dragging = true;
      }
      if (!selection.includes(index)) selection.push(index);
      else if (selection.length > 1 && selection[selection.length - 2] === index) selection.pop();
    }
    renderSelection(point);
  });
  $('wheel').addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    const shouldSubmit = dragging && selection.length >= 2;
    cancelGesture(); renderSelection(); if (shouldSubmit) submit();
  });
  $('wheel').addEventListener('pointercancel', () => {
    const previous = gesture; cancelGesture(); selection = previous; renderSelection();
  });
  $('wheel').addEventListener('lostpointercapture', () => { pointer = null; dragging = false; });
  $('shuffleButton').addEventListener('click', () => {
    cancelGesture(); clearSelection();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    renderWheel(); say('A fresh perspective. Same letters.');
  });
  $('clearButton').addEventListener('click', () => { cancelGesture(); selection.pop(); renderSelection(); });
  $('submitButton').addEventListener('click', () => {
    if (refreshDaily()) return;
    cancelGesture();
    if (isComplete() && !selection.length) {
      if (puzzle.mode === 'daily') showCompletion();
      else if (puzzle.level < C.puzzles.length) level(store.current + 1); else showCompletion();
    } else submit();
  });
  $('hintButton').addEventListener('click', hint);
  $('helpButton').addEventListener('click', () => openDialog('helpDialog'));
  $('mapButton').addEventListener('click', showMap);
  $('trailButton').addEventListener('click', () => level(Math.min(store.current, frontier())));
  $('dailyButton').addEventListener('click', daily);
  $('bonusButton').addEventListener('click', () => {
    fillPills($('bonusWords'), state.bonus);
    if (!state.bonus.length) $('bonusWords').textContent = 'Your collection is waiting for its first discovery.';
    $('bonusMilestone').textContent = `${state.bonus.length} of ${puzzle.bonus.length} curated extra words discovered on this level.`;
    openDialog('bonusDialog');
  });
  $('reviewButton').addEventListener('click', closeDialogs);
  $('replayButton').addEventListener('click', () => { if (puzzle.mode === 'trail') level(store.current, true); });
  $('nextButton').addEventListener('click', () => {
    if (refreshDaily()) return;
    if (puzzle.mode === 'daily') level(Math.min(store.current, frontier()));
    else if (puzzle.level < C.puzzles.length) level(store.current + 1); else showMap();
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeDialogs));
  dialogs.forEach(dialog => {
    dialog.addEventListener('click', event => {
      const r = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || dialogs.some(d => d.open)) return;
    if (refreshDaily()) return;
    // Let focused controls keep their standard Enter/Space activation.
    if (!selection.length && event.target.closest('button,a,input,textarea,select') && ['Enter', ' '].includes(event.key)) return;
    if (/^[a-z]$/i.test(event.key)) {
      event.preventDefault();
      const index = order.findIndex((tile, i) => tile.letter === event.key.toUpperCase() && !selection.includes(i));
      if (index >= 0) { selection.push(index); renderSelection(); }
      else say('That letter isn’t available on the wheel.', 'invalid');
    } else if (event.key === 'Enter') { event.preventDefault(); $('submitButton').click(); }
    else if (event.key === 'Backspace') { event.preventDefault(); selection.pop(); renderSelection(); }
    else if (event.key === 'Escape') { event.preventDefault(); clearSelection(); }
    else if (event.key === ' ') { event.preventDefault(); $('shuffleButton').click(); }
  });
  window.addEventListener('resize', resizeBoard);
  window.addEventListener('blur', () => {
    if (pointer !== null) { const previous = gesture; cancelGesture(); selection = previous; renderSelection(); }
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('focus', () => { refreshDaily(); syncDailyClock(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshDaily(); syncDailyClock(); } });
  setInterval(() => { refreshDaily(); syncDailyClock(); }, 30000);
  const initialMode = new URLSearchParams(location.search).get('mode');
  if (initialMode === 'daily' || initialMode === 'trail') store.mode = initialMode;
  if (store.mode === 'daily') daily(); else level(Math.min(store.current, frontier()));
  syncDailyClock();
})();
