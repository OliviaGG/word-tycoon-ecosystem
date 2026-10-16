(function startLetterworks() {
  'use strict';
  const core = window.LetterworksCore;
  if (!core) throw new Error('Letterworks core failed to load.');
  const rackDisplay = window.LetterworksRackDisplay;
  if (!rackDisplay) throw new Error('Letterworks tile display failed to load.');
  const ids = [
    'mainContent', 'startScreen', 'gameScreen', 'startButton', 'dailyButton', 'dailyDate', 'practiceButton', 'continueButton', 'personalStats', 'saveNote',
    'roundKicker', 'puzzleName', 'modeLabel', 'runScore', 'timer', 'timerStat', 'pauseButton', 'bossBanner', 'requiredLetter', 'letterRack', 'wordDisplay',
    'clearButton', 'submitButton', 'shuffleButton', 'feedback', 'roundScore', 'targetScore', 'scoreProgress', 'quotaProgress', 'masterGoal', 'bankButton',
    'wordCount', 'foundWords', 'hintCount', 'hintButton', 'hintText', 'activeUpgrades', 'modal', 'modalEyebrow', 'modalTitle', 'modalCopy', 'upgradeChoices',
    'resultSummary', 'answerReview', 'restartButton', 'resumeButton', 'shareButton', 'reviewButton', 'homeButton', 'endButton', 'confirmEndButton', 'modalFeedback'
  ];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const ticker = window.LetterworksGuessTicker.create(document.getElementById('guessTicker'));
  const SAVE_KEY = 'letterworks.run.v1';
  const STATS_KEY = 'letterworks.stats.v1';
  const RECENT_RACKS_KEY = 'letterworks.recent-racks.v1';
  let state = null;
  let rounds = [];
  let timerId = null;
  let deadline = 0;
  let savedRun = null;
  let modalKind = '';
  let returnFocus = null;
  let pendingMode = null;
  let wonRun = false;
  let storageAvailable = true;
  let stats = loadStats();
  let accountInfo = null;
  let remoteSaved = null;
  let remote = false;
  let remoteBusy = false;
  let remotePoll = null;
  let accountReady = false;
  const accountStatus = document.getElementById('accountStatus');
  const dailyLeaders = document.getElementById('dailyLeaders');
  async function api(path, body) {
    const response = await fetch('/api/letterworks' + path, { credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || 'Workshop connection failed.'); error.status = response.status; throw error; }
    return result;
  }
  async function loadLeaders() {
    try {
      const data = await api('/leaderboard');
      dailyLeaders.replaceChildren();
      if (!data.top.length) { const item = document.createElement('li'); item.textContent = 'Be the first to clear today’s workshop.'; dailyLeaders.append(item); }
      data.top.forEach(row => { const item = document.createElement('li'); const name = document.createElement('span'); name.textContent = row.name;
        const score = document.createElement('b'); score.textContent = row.score.toLocaleString() + ' pts'; item.append(name, score); dailyLeaders.append(item); });
    } catch { dailyLeaders.textContent = 'Daily standings are unavailable right now.'; }
  }
  async function initAccount() {
    if (!accountReady) { el.startButton.disabled = true; el.dailyButton.disabled = true; }
    try {
      const data = await api('/me'); accountInfo = data.player; remoteSaved = data.state?.status !== 'finished' ? data.state : null;
      stats = { ...stats, ...data.stats, dailyDate: data.stats.dailyDate || '', dailyBest: data.stats.dailyBest || 0 };
      accountStatus.textContent = accountInfo.displayName + ' · Account saves, XP and word library connected.';
      const link = document.createElement('a'); link.href = '/profile'; link.textContent = 'Your Suite →'; accountStatus.append(' ', link);
      el.saveNote.textContent = 'Daily and fresh runs save to your Word Tycoon account. Practice stays in this browser.';
      if (!state) renderHome();
    } catch (err) {
      accountStatus.textContent = err.status === 401 ? 'Playing as a guest. ' : 'Account connection unavailable. Guest play is available. ';
      const link = document.createElement('a'); link.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent('https://wordtycoon.live/letterworks/');
      link.textContent = 'Sign in for XP, saved progress and daily standings →'; accountStatus.append(link);
    } finally { accountReady = true; el.startButton.disabled = false; el.dailyButton.disabled = false; }
  }
  function applyRemote(snapshot, feedback) {
    const prior = state && { id: state.id, roundIndex: state.roundIndex, status: state.status, tiles: state.tiles, selectedTileIds: state.selectedTileIds };
    remote = true; remoteSaved = snapshot.status === 'finished' ? null : snapshot;
    state = { ...snapshot, foundWords: new Set(snapshot.foundWords), tiles: [], selectedTileIds: [] };
    rounds = core.createRun(state.seed);
    if (prior?.id === state.id && prior.roundIndex === state.roundIndex) { state.tiles = prior.tiles; state.selectedTileIds = prior.selectedTileIds; }
    else makeTiles();
    el.startScreen.hidden = true; el.gameScreen.hidden = false;
    clearInterval(timerId); renderAll();
    if (state.status === 'finished') { finishRun(state.won, false, true); loadLeaders(); }
    else if (state.status === 'choosing') { if (prior?.status !== 'choosing' || el.modal.hidden) showContracts(); }
    else if (state.status === 'paused') { if (prior?.status !== 'paused' || el.modal.hidden) showPause(); }
    else { if (!el.modal.hidden) closeModal(); beginTimer(); }
    if (feedback) showFeedback(feedback, 'success');
    if (state.status !== 'finished') {
      clearInterval(remotePoll);
      remotePoll = setInterval(() => { if (remote && state?.status === 'playing' && !document.hidden && !remoteBusy) remoteAction('sync'); }, 5000);
    } else { clearInterval(remotePoll); remotePoll = null; }
  }
  async function remoteAction(type, extra = {}) {
    if (remoteBusy || !state) return;
    remoteBusy = true;
    try {
      const result = await api('/run/action', { type, runId: state.id, roundIndex: state.roundIndex, ...extra });
      if (type === 'word') ticker.push(extra.word, result.ok ? 'correct' : result.code === 'duplicate' ? 'duplicate' : 'incorrect', state.roundIndex);
      if (result.word) state.selectedTileIds = [];
      applyRemote(result.state, result.word ? '+' + result.points + ' · ' + result.word.toUpperCase() + ' forged' : null);
      if (!result.ok) showFeedback(result.error, 'error');
    } catch (err) { showFeedback(err.message + ' Reconnect to refresh your account workshop.', 'error'); el.modalFeedback.textContent = err.message; }
    finally { remoteBusy = false; }
  }

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { storageAvailable = false; }
  }
  function removeSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { storageAvailable = false; }
    savedRun = null;
  }
  function loadStats() {
    const stored = readStorage(STATS_KEY) || {};
    const valid = value => Number.isInteger(value) && value >= 0 && value <= 100000000;
    return {
      runs: valid(stored.runs) ? stored.runs : 0, wins: valid(stored.wins) ? stored.wins : 0,
      best: valid(stored.best) ? stored.best : 0, practiceBest: valid(stored.practiceBest) ? stored.practiceBest : 0,
      dailyDate: /^\d{4}-\d{2}-\d{2}$/.test(stored.dailyDate || '') ? stored.dailyDate : '',
      dailyBest: valid(stored.dailyBest) ? stored.dailyBest : 0
    };
  }
  function puzzle() { return rounds[state.roundIndex]; }
  function modeName() { return state.mode === 'daily' ? 'Daily workshop · ' + state.date : state.mode === 'practice' ? 'Practice · no timer' : 'Fresh run'; }
  function secondsLeft() { return state.mode === 'practice' ? 0 : core.remainingSeconds(state.millisecondsRemaining, 0); }
  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    return Math.floor(safe / 60) + ':' + String(safe % 60).padStart(2, '0');
  }
  function selectedWord() { return state.selectedTileIds.map(id => state.tiles.find(tile => tile.id === id).letter).join('').toLowerCase(); }
  function saveRun() {
    if (remote) { if (state && state.status !== 'finished') remoteSaved = { ...state, foundWords: [...state.foundWords] }; return; }
    if (!state || state.status === 'finished') return;
    const snapshot = { ...state, foundWords: [...state.foundWords], tiles: undefined, selectedTileIds: undefined };
    savedRun = core.restoreRun(snapshot);
    writeStorage(SAVE_KEY, snapshot);
    if (!storageAvailable) el.saveNote.textContent = 'Browser storage is unavailable. Keep this tab open to keep your progress.';
  }
  function loadSave() {
    if (accountInfo && remoteSaved) { el.continueButton.hidden = false; el.continueButton.textContent = 'Continue account ' + remoteSaved.mode + ' · shift ' + (remoteSaved.roundIndex + 1); return; }
    savedRun = savedRun || core.restoreRun(readStorage(SAVE_KEY));
    el.continueButton.hidden = !savedRun;
    if (savedRun) el.continueButton.textContent = 'Continue ' + (savedRun.mode === 'daily' ? savedRun.date + ' daily' : savedRun.mode) + ' · shift ' + (savedRun.roundIndex + 1);
  }
  function renderHome() {
    const today = core.getEdmontonDate();
    el.dailyDate.textContent = today;
    el.personalStats.innerHTML = '<span><b>' + stats.best.toLocaleString() + '</b> BEST RUN</span><span><b>' + stats.wins + '</b> RUNS WON</span><span><b>' + (stats.dailyDate === today ? stats.dailyBest.toLocaleString() : '—') + '</b> TODAY’S BEST</span>';
    loadSave();
    if (!storageAvailable) el.saveNote.textContent = 'Browser storage is unavailable. Keep this tab open to keep your progress.';
  }
  function closeModal() {
    el.modal.hidden = true;
    el.mainContent.inert = false;
    document.body.classList.remove('modal-open');
    modalKind = '';
    if (returnFocus && returnFocus.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
  }
  function showModal(kind, eyebrow, title, copy) {
    if (el.modal.hidden) returnFocus = document.activeElement;
    modalKind = kind;
    el.modalEyebrow.textContent = eyebrow;
    el.modalTitle.textContent = title;
    el.modalCopy.textContent = copy;
    ['upgradeChoices', 'resultSummary', 'answerReview', 'restartButton', 'resumeButton', 'shareButton', 'reviewButton', 'homeButton', 'endButton', 'confirmEndButton'].forEach(id => { el[id].hidden = true; });
    el.modalFeedback.textContent = '';
    el.modal.hidden = false;
    el.mainContent.inert = true;
    document.body.classList.add('modal-open');
  }
  function focusModal() {
    const first = [...el.modal.querySelectorAll('button')].find(button => !button.hidden && !button.disabled && button.getClientRects().length);
    (first || el.modal.querySelector('.modal-card')).focus({ preventScroll: true });
  }
  function requestRun(mode) {
    if (!accountReady && mode !== 'practice') { el.saveNote.textContent = 'Checking your Word Tycoon account. Please wait a moment.'; return; }
    loadSave();
    if (savedRun || (accountInfo && remoteSaved && mode !== 'practice')) {
      pendingMode = mode;
      showModal('replace', 'A RUN IS SAVED', 'Start a new workshop?', 'Starting a new run replaces your saved progress.');
      el.restartButton.textContent = 'Start new run';
      el.restartButton.hidden = false;
      el.homeButton.textContent = 'Keep saved run';
      el.homeButton.hidden = false;
      focusModal();
    } else startRun(mode);
  }
  async function startRun(mode) {
    if (accountInfo && mode !== 'practice') {
      if (remoteBusy) return;
      remoteBusy = true;
      try { const data = await api('/run/start', { mode, replace: true }); pendingMode = null; applyRemote(data.state); el.pauseButton.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
      catch (err) { el.saveNote.textContent = err.message; el.modalFeedback.textContent = err.message; }
      finally { remoteBusy = false; }
      return;
    }
    ticker.reset(null);
    remote = false; clearInterval(remotePoll);
    clearInterval(timerId);
    pendingMode = null;
    const date = core.getEdmontonDate();
    const recentRacks = core.rememberRacks(readStorage(RECENT_RACKS_KEY), rounds.map(round => round.rack));
    const seed = mode === 'daily' ? core.dailySeed(date) : core.chooseFreshSeed('v2:' + mode, recentRacks,
      () => window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now() + ':' + Math.random());
    state = {
      version: core.DATA_VERSION, mode, date, seed, roundIndex: 0, runScore: 0, roundScore: 0, totalWords: 0,
      foundWords: new Set(), masterFound: false, upgrades: [], tiles: [], selectedTileIds: [],
      millisecondsRemaining: null, hintsRemaining: 1, hintText: '', hintedWords: [], history: [], status: 'playing'
    };
    rounds = core.createRun(seed);
    writeStorage(RECENT_RACKS_KEY, core.rememberRacks(recentRacks, rounds.map(round => round.rack)));
    el.startScreen.hidden = true;
    el.gameScreen.hidden = false;
    closeModal();
    startRound();
    el.pauseButton.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function makeTiles() {
    state.tiles = rackDisplay.arrange([...puzzle().rack].map((letter, index) => ({ id: state.roundIndex + '-' + index, letter })), puzzle());
    state.selectedTileIds = [];
  }
  function startRound() {
    state.roundScore = 0;
    state.foundWords = new Set();
    state.masterFound = false;
    state.hintsRemaining = core.getHintsPerRound(state.upgrades);
    state.hintText = '';
    state.hintedWords = [];
    state.millisecondsRemaining = state.mode === 'practice' ? null : core.getRoundSeconds(puzzle(), state.upgrades) * 1000;
    state.status = 'playing';
    makeTiles();
    el.feedback.textContent = '';
    el.feedback.className = 'feedback';
    closeModal();
    renderAll();
    beginTimer();
    saveRun();
  }
  function beginTimer() {
    clearInterval(timerId);
    if (state.mode === 'practice') return;
    deadline = performance.now() + state.millisecondsRemaining;
    let lastSavedSecond = secondsLeft();
    timerId = setInterval(() => {
      if (syncTimer() && secondsLeft() !== lastSavedSecond) {
        lastSavedSecond = secondsLeft();
        saveRun();
      }
    }, 250);
  }
  function syncTimer() {
    if (!state || state.status !== 'playing') return false;
    if (state.mode === 'practice') return true;
    state.millisecondsRemaining = Math.max(0, deadline - performance.now());
    renderTimer();
    if (state.millisecondsRemaining > 0) return !remoteBusy;
    if (remote) { clearInterval(timerId); if (!remoteBusy) remoteAction('sync'); return false; }
    clearInterval(timerId);
    if (core.roundComplete(state.roundScore, state.masterFound, puzzle())
      || core.canBankWithoutBlueprint(state.roundScore, state.masterFound, state.foundWords.size, puzzle())) finishRound();
    else finishRun(false);
    return false;
  }
  function pauseRun() {
    if (remote) { remoteAction('pause'); return; }
    if (!state || state.status !== 'playing' || !syncTimer()) return;
    clearInterval(timerId);
    state.status = 'paused';
    saveRun();
    showPause();
  }
  function showPause() {
    showModal('pause', modeName(), 'Workshop paused.', storageAvailable
      ? 'Your letters, contracts, and remaining time are saved. Take a breath.'
      : 'Your progress is held in this tab. Browser storage is unavailable, so keep this tab open.');
    el.resumeButton.hidden = false;
    el.homeButton.textContent = 'Save & go home';
    el.homeButton.hidden = false;
    el.endButton.hidden = false;
    focusModal();
  }
  function resumeRun() {
    if (remote) { remoteAction('resume'); return; }
    if (!state || state.status !== 'paused') return;
    state.status = 'playing';
    closeModal();
    beginTimer();
    renderAll();
    saveRun();
    el.pauseButton.focus({ preventScroll: true });
  }
  async function continueRun() {
    if (accountInfo && remoteSaved) {
      try { const data = await api('/me'); if (data.state) { applyRemote(data.state); if (state.status === 'playing') await remoteAction('pause'); } }
      catch (err) { el.saveNote.textContent = err.message; }
      return;
    }
    remote = false;
    loadSave();
    if (!savedRun) return;
    state = savedRun;
    rounds = core.createRun(state.seed);
    makeTiles();
    el.startScreen.hidden = true;
    el.gameScreen.hidden = false;
    renderAll();
    if (state.status === 'choosing') showContracts();
    else showPause();
  }
  function goHome() {
    if (modalKind === 'replace') {
      pendingMode = null;
      closeModal();
      return;
    }
    clearInterval(timerId);
    clearInterval(remotePoll);
    saveRun();
    closeModal();
    el.gameScreen.hidden = true;
    el.startScreen.hidden = false;
    renderHome();
    state = null;
    el.dailyButton.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function renderAll() {
    const current = puzzle();
    el.roundKicker.textContent = current.boss ? 'FINAL SHIFT · BOSS' : 'SHIFT ' + (state.roundIndex + 1) + ' OF ' + rounds.length;
    el.puzzleName.textContent = rackDisplay.shiftName(state.roundIndex);
    el.modeLabel.textContent = modeName();
    el.bossBanner.hidden = !current.boss;
    el.requiredLetter.textContent = current.requiredLetter || '';
    el.targetScore.textContent = current.targetScore;
    renderTimer(); renderScores(); renderRack(); renderWord(); renderFoundWords(); renderUpgrades(); renderHintState();
  }
  function renderTimer() {
    el.timer.textContent = state.mode === 'practice' ? '∞' : formatTime(secondsLeft());
    el.timerStat.classList.toggle('danger', state.mode !== 'practice' && secondsLeft() <= 15);
  }
  function renderScores() {
    const current = puzzle();
    el.runScore.textContent = state.runScore.toLocaleString();
    el.roundScore.textContent = state.roundScore.toLocaleString();
    el.scoreProgress.style.width = Math.min(100, state.roundScore / current.targetScore * 100) + '%';
    el.quotaProgress.setAttribute('aria-valuemax', current.targetScore);
    el.quotaProgress.setAttribute('aria-valuenow', Math.min(current.targetScore, state.roundScore));
    const fallback = core.canBankWithoutBlueprint(state.roundScore, state.masterFound, state.foundWords.size, current);
    el.masterGoal.classList.toggle('complete', state.masterFound || fallback);
    el.masterGoal.innerHTML = state.masterFound ? '<span>◆</span> Six-letter blueprint complete'
      : fallback ? '<span>◆</span> Ledger nearly complete · bank without the last blueprint'
        : '<span>◇</span> Find a six-letter blueprint';
    const complete = core.roundComplete(state.roundScore, state.masterFound, current) || fallback;
    el.bankButton.disabled = !complete || state.status !== 'playing';
    el.bankButton.firstElementChild.textContent = complete ? (current.boss ? 'Finish the run' : 'Bank this shift')
      : !state.masterFound ? 'Blueprint still missing' : Math.max(0, current.targetScore - state.roundScore) + ' points to quota';
  }
  function renderRack() {
    const focusedLetter = document.activeElement && document.activeElement.dataset.tile;
    el.letterRack.innerHTML = '';
    state.tiles.forEach(tile => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'letter-tile';
      button.dataset.tile = tile.id;
      if (state.upgrades.includes('golden_letter') && tile.letter === puzzle().bonusLetter) button.classList.add('gold');
      if (tile.letter === puzzle().requiredLetter) button.classList.add('locked');
      button.textContent = tile.letter;
      button.disabled = state.selectedTileIds.includes(tile.id);
      button.setAttribute('aria-label', 'Letter ' + tile.letter + (tile.letter === puzzle().requiredLetter ? ', boss letter' : ''));
      button.addEventListener('click', () => selectTile(tile.id));
      el.letterRack.appendChild(button);
    });
    if (focusedLetter) {
      const target = [...el.letterRack.children].find(button => button.dataset.tile === focusedLetter && !button.disabled)
        || [...el.letterRack.children].find(button => !button.disabled) || el.submitButton;
      target.focus({ preventScroll: true });
    }
  }
  function renderWord() {
    const word = selectedWord();
    el.wordDisplay.innerHTML = word ? '<span>' + word + '</span>' : '<span class="word-placeholder">Type or tap letters to build a word</span>';
  }
  function renderFoundWords() {
    ticker.reset(state.id || state.seed);
    const signature = state.seed + ':' + state.roundIndex + ':' + [...state.foundWords].join(',');
    const scrollTop = el.foundWords.dataset.signature === signature ? el.foundWords.scrollTop : 0;
    const accepted = [...puzzle().words].sort((a, b) => a.length - b.length
      || Number(state.foundWords.has(a)) - Number(state.foundWords.has(b)) || a.localeCompare(b));
    el.wordCount.textContent = state.foundWords.size + ' / ' + accepted.length + ' found';
    el.foundWords.innerHTML = [3, 4, 5, 6].map(length => {
      const words = accepted.filter(word => word.length === length);
      if (!words.length) return '';
      const count = words.filter(word => state.foundWords.has(word)).length;
      return '<section class="word-group"><div class="word-group-heading"><span>' + length + ' LETTERS</span><b>' + count + '/' + words.length + '</b></div><div class="word-grid">'
        + words.map(word => state.foundWords.has(word) ? '<span class="word-slot found">' + word + '</span>'
          : '<span class="word-slot unfound" aria-label="Unfound ' + length + '-letter word"><span aria-hidden="true">' + '<i></i>'.repeat(length) + '</span></span>').join('')
        + '</div></section>';
    }).join('');
    el.foundWords.dataset.signature = signature;
    el.foundWords.scrollTop = scrollTop;
  }
  function renderUpgrades() {
    const owned = state.upgrades.map(id => core.UPGRADES.find(upgrade => upgrade.id === id));
    el.activeUpgrades.innerHTML = owned.length ? owned.map(upgrade => '<div class="active-contract"><i aria-hidden="true">' + upgrade.icon + '</i><span><b>' + upgrade.name + '</b><small>' + upgrade.description + '</small></span></div>').join('')
      : '<p>Bank this shift to choose your first contract.</p>';
  }
  function renderHintState() {
    el.hintCount.textContent = state.hintsRemaining + ' hint' + (state.hintsRemaining === 1 ? '' : 's') + ' available';
    el.hintButton.disabled = state.hintsRemaining <= 0 || state.foundWords.size === puzzle().words.length;
    el.hintText.textContent = state.hintText;
  }
  function selectTile(id) {
    if (!syncTimer() || state.selectedTileIds.includes(id)) return;
    state.selectedTileIds.push(id);
    renderRack(); renderWord();
  }
  function selectLetter(letter) {
    const tile = state.tiles.find(candidate => candidate.letter.toLowerCase() === letter && !state.selectedTileIds.includes(candidate.id));
    if (tile) selectTile(tile.id);
    else showFeedback('No unused ' + letter.toUpperCase() + ' tile.', 'error');
  }
  function removeLastLetter() { state.selectedTileIds.pop(); renderRack(); renderWord(); }
  function clearWord() { state.selectedTileIds = []; renderRack(); renderWord(); }
  function showFeedback(message, type) { el.feedback.textContent = message; el.feedback.className = 'feedback ' + (type || ''); }
  function submitWord() {
    if (remote) { if (state?.status === 'playing') remoteAction('word', { word: selectedWord() }); return; }
    if (!syncTimer()) return;
    const validation = core.validateSubmission(selectedWord(), puzzle(), state.foundWords);
    ticker.push(selectedWord(), validation.ok ? 'correct' : validation.code === 'duplicate' ? 'duplicate' : 'incorrect', state.roundIndex);
    if (!validation.ok) { showFeedback(validation.message, 'error'); return; }
    const scoring = core.scoreWord(validation.word, state.upgrades, { acceptedCount: state.foundWords.size, bonusLetter: puzzle().bonusLetter });
    state.foundWords.add(validation.word);
    state.totalWords += 1;
    state.roundScore += scoring.score;
    state.runScore += scoring.score;
    if (core.isMasterWord(validation.word, puzzle())) state.masterFound = true;
    if (state.mode !== 'practice' && state.upgrades.includes('overtime') && validation.word.length >= 5) {
      deadline += 2000;
      state.millisecondsRemaining += 2000;
    }
    const bonusText = scoring.bonuses.length ? ' · +' + scoring.bonuses.reduce((sum, bonus) => sum + bonus.amount, 0) + ' from contracts' : '';
    showFeedback('+' + scoring.score + ' · ' + validation.word.toUpperCase() + ' forged' + bonusText, 'success');
    clearWord(); renderFoundWords(); renderScores(); renderTimer(); renderHintState(); saveRun();
  }
  function shuffleRack() {
    if (!syncTimer()) return;
    state.selectedTileIds = [];
    state.tiles = rackDisplay.arrange(state.tiles, puzzle());
    renderRack(); renderWord();
    showFeedback('Rack shuffled.');
  }
  function revealHint() {
    if (remote) { remoteAction('hint'); return; }
    if (!syncTimer() || state.hintsRemaining <= 0) return;
    const options = puzzle().words.filter(word => !state.foundWords.has(word) && !state.hintedWords.includes(word)).sort((a, b) => {
      const masterPriority = word => !state.masterFound && word.length === 6 ? 1 : 0;
      return masterPriority(b) - masterPriority(a) || b.length - a.length || a.localeCompare(b);
    });
    if (!options.length) return;
    const word = options[0];
    state.hintedWords.push(word);
    state.hintText = word[0].toUpperCase() + ' ' + '_ '.repeat(word.length - 1).trim() + ' · ' + word.length + ' letters';
    state.hintsRemaining -= 1;
    renderHintState(); saveRun();
  }
  function finishRound() {
    if (remote) { remoteAction('bank'); return; }
    if (!state || state.status !== 'playing' || !(core.roundComplete(state.roundScore, state.masterFound, puzzle())
      || core.canBankWithoutBlueprint(state.roundScore, state.masterFound, state.foundWords.size, puzzle()))) return;
    state.status = 'choosing';
    clearInterval(timerId);
    const bonus = state.mode === 'practice' ? 0 : core.getBankBonus(Math.floor(state.millisecondsRemaining / 1000), state.upgrades);
    state.runScore += bonus;
    state.history.push({ index: state.roundIndex, found: [...state.foundWords] });
    if (puzzle().boss) { finishRun(true); return; }
    saveRun();
    showContracts(bonus);
  }
  function showContracts(bonus) {
    showModal('contracts', bonus ? 'SHIFT COMPLETE · +' + bonus + ' INTEREST' : 'SHIFT COMPLETE', 'Choose your next contract.', 'It applies for the rest of this run.');
    el.upgradeChoices.hidden = false;
    el.upgradeChoices.innerHTML = '';
    const choices = core.getUpgradeChoices(state.seed, state.roundIndex, state.upgrades, state.mode);
    choices.forEach(upgrade => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'upgrade-card';
      button.innerHTML = '<span class="upgrade-icon">' + upgrade.icon + '</span><strong>' + upgrade.name + '</strong><p>' + upgrade.description + '</p><small>SELECT CONTRACT →</small>';
      button.addEventListener('click', () => chooseUpgrade(upgrade.id));
      el.upgradeChoices.appendChild(button);
    });
    el.homeButton.textContent = 'Save & go home';
    el.homeButton.hidden = false;
    focusModal();
  }
  function chooseUpgrade(id) {
    if (remote) { remoteAction('contract', { contract: id }); return; }
    if (state.status !== 'choosing' || !core.getUpgradeChoices(state.seed, state.roundIndex, state.upgrades, state.mode).some(upgrade => upgrade.id === id)) return;
    state.upgrades.push(id); state.roundIndex += 1;
    startRound();
    el.pauseButton.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function finishRun(won, endedEarly, fromServer) {
    if (remote && !fromServer) { remoteAction('end'); return; }
    if (!state || (state.status === 'finished' && !fromServer)) return;
    clearInterval(timerId);
    if (!state.history.some(item => item.index === state.roundIndex)) state.history.push({ index: state.roundIndex, found: [...state.foundWords] });
    state.status = 'finished'; wonRun = won;
    if (!fromServer) removeSave();
    if (state.mode === 'practice') stats.practiceBest = Math.max(stats.practiceBest, state.runScore);
    else if (!fromServer) {
      stats.runs += 1; if (won) stats.wins += 1;
      stats.best = Math.max(stats.best, state.runScore);
      if (state.mode === 'daily') {
        stats.dailyBest = stats.dailyDate === state.date ? Math.max(stats.dailyBest, state.runScore) : state.runScore;
        stats.dailyDate = state.date;
      }
    }
    if (!fromServer) writeStorage(STATS_KEY, stats);
    const missing = Math.max(0, puzzle().targetScore - state.roundScore);
    showModal('result', won ? 'PATENT APPROVED' : 'WORKSHOP CLOSED', won ? 'The machine works.' : 'The quota got away.',
      won ? 'Five shifts, four contracts, one workshop saved. How high can your next run go?'
        : endedEarly ? 'You ended the run at shift ' + (state.roundIndex + 1) + '. Your forged words are ready to review.'
          : (missing ? 'You needed ' + missing + ' more points' + (state.masterFound ? '.' : ' and a six-letter blueprint.') : 'You still needed a six-letter blueprint.'));
    el.resultSummary.hidden = false;
    el.resultSummary.innerHTML = '<div><span>FINAL SCORE</span><strong>' + state.runScore.toLocaleString() + '</strong></div><div><span>WORDS FORGED</span><strong>' + state.totalWords + '</strong></div><div><span>SHIFTS BANKED</span><strong>' + (won ? rounds.length : state.roundIndex) + '/' + rounds.length + '</strong></div>';
    el.restartButton.textContent = 'Fresh run ↻'; el.restartButton.hidden = false;
    el.shareButton.hidden = false; el.reviewButton.textContent = 'Review words'; el.reviewButton.hidden = false;
    el.homeButton.textContent = 'Back to workshop'; el.homeButton.hidden = false;
    if (fromServer) el.modalFeedback.textContent = state.reward?.message || 'Verified result saved to Word Tycoon.';
    if (fromServer) initAccount();
    focusModal();
  }
  function showAnswers() {
    el.answerReview.hidden = !el.answerReview.hidden;
    el.reviewButton.textContent = el.answerReview.hidden ? 'Review words' : 'Hide word review';
    if (el.answerReview.hidden) return;
    el.answerReview.innerHTML = state.history.map(record => {
      const round = rounds[record.index];
      if (!round) return '';
      const found = new Set(record.found);
      return '<section><h3>Shift ' + (record.index + 1) + ' · ' + round.name + '</h3><p>' + round.words.map(word => '<span class="' + (found.has(word) ? 'review-found' : 'review-missed') + '">' + word.toUpperCase() + '</span>').join(' ') + '</p></section>';
    }).join('');
  }
  async function copyResult() {
    const text = 'Letterworks · ' + modeName() + '\n' + (wonRun ? 'Workshop saved' : 'Shift ' + (state.roundIndex + 1) + ' reached') + ' · ' + state.runScore.toLocaleString() + ' points\n' + state.totalWords + ' words forged · ' + state.upgrades.length + ' contracts\nhttps://wordtycoon.live/letterworks/';
    try { await navigator.clipboard.writeText(text); el.modalFeedback.textContent = 'Result copied. Share it with your workshop crew.'; }
    catch { el.modalFeedback.textContent = text; }
  }
  function restartAction() { if (pendingMode) startRun(pendingMode); else requestRun('run'); }
  function endRunPrompt() {
    showModal('end', 'END THIS RUN?', 'Close the workshop?', 'This ends your current run. You can review the words afterward.');
    el.resumeButton.hidden = false;
    el.confirmEndButton.hidden = false;
    focusModal();
  }

  el.startButton.addEventListener('click', () => requestRun('run'));
  el.dailyButton.addEventListener('click', () => requestRun('daily'));
  el.practiceButton.addEventListener('click', () => requestRun('practice'));
  el.continueButton.addEventListener('click', continueRun);
  el.restartButton.addEventListener('click', restartAction);
  el.resumeButton.addEventListener('click', resumeRun);
  el.homeButton.addEventListener('click', goHome);
  el.endButton.addEventListener('click', endRunPrompt);
  el.confirmEndButton.addEventListener('click', () => finishRun(false, true));
  el.shareButton.addEventListener('click', copyResult);
  el.reviewButton.addEventListener('click', showAnswers);
  el.pauseButton.addEventListener('click', pauseRun);
  el.submitButton.addEventListener('click', submitWord);
  el.clearButton.addEventListener('click', () => { if (syncTimer()) clearWord(); });
  el.shuffleButton.addEventListener('click', shuffleRack);
  el.hintButton.addEventListener('click', revealHint);
  el.bankButton.addEventListener('click', () => { if (syncTimer()) finishRound(); });

  document.addEventListener('keydown', event => {
    if (!el.modal.hidden) {
      if (event.key === 'Tab') {
        const buttons = [...el.modal.querySelectorAll('button')].filter(button => !button.disabled && button.getClientRects().length);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      } else if (event.key === 'Escape' && state && state.status === 'paused') { event.preventDefault(); resumeRun(); }
      return;
    }
    if (!state || state.status !== 'playing' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing
      || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (/^[a-z]$/i.test(event.key)) { event.preventDefault(); selectLetter(event.key.toLowerCase()); }
    else if (event.key === 'Backspace') { event.preventDefault(); if (syncTimer()) removeLastLetter(); }
    else if (event.key === 'Enter') {
      // Preserve Enter on controls; a selected word still submits from a tile or the pause button.
      if (selectedWord() || event.target === document.body || event.target === el.submitButton) { event.preventDefault(); submitWord(); }
    } else if (event.key === 'Escape') { event.preventDefault(); if (syncTimer()) clearWord(); }
    else if (event.key === ' ' && (event.target === document.body || el.letterRack.contains(event.target))) { event.preventDefault(); shuffleRack(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state && state.status === 'playing') pauseRun();
    else if (!document.hidden && !state) renderHome();
  });
  window.addEventListener('pagehide', () => {
    if (remote && state?.status === 'playing') {
      fetch('/api/letterworks/run/action', { method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'pause', runId: state.id, roundIndex: state.roundIndex }) }).catch(() => {});
      return;
    }
    if (state && state.status === 'playing') { syncTimer(); if (state.status === 'playing') state.status = 'paused'; }
    saveRun();
  });
  renderHome();
  initAccount(); loadLeaders();
})();
