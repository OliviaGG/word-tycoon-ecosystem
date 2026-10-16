(function startWordfall() {
  'use strict';
  const C = window.WordfallCore;
  const $ = id => document.getElementById(id);
  const boardEl = $('board');
  const traceLines = $('traceLines');
  const traceLine = $('traceLine');
  const overlay = $('resultOverlay');
  const API = '/api/wordfall';
  const params = new URLSearchParams(location.search);
  let mode = ['practice', 'solo', 'daily', 'multi'].includes(params.get('mode')) ? params.get('mode')
    : location.pathname.endsWith('/stream.html') ? 'multi' : 'practice';
  let roomScope = params.get('session') || 'global';
  const obsStreamer = params.get('obs') === '1' && params.has('session');
  let remote = null, player = null, cosmetics = null, viewerVisibility = {}, pollBusy = false;
  let modeToken = 0;
  let resultRevealTimer = null;
  let tickerRoundId = null, lastAttemptId = 0, tickerNextAt = [0, 0];
  let tickerReplayAt = { wrong: 0, duplicate: 0 };
  let podiumSignature = '', latestSignature = '', lastAnimatedClaimKey = '';
  const avatarCosmetics = new Map();
  const state = {
    board: [], path: [], hintPath: [], score: 0, moves: C.MOVES,
    cleared: 0, words: 0, combo: 0, bestCombo: 0, comboUntil: 0,
    busy: false, ended: false, token: 0, pointer: null
  };

  async function request(path, options = {}) {
    const response = await fetch(API + path, { credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || 'Wordfall is unavailable.');
      error.data = data; error.status = response.status; throw error;
    }
    return data;
  }
  function personalScore(game) {
    return game.players?.find(p => p.platform === player?.platform && String(p.userId) === String(player?.userId))?.score || 0;
  }
  function dressAvatar(avatar, identity) {
    if (!identity?.platform || !identity?.userId || !window.PfpCosmetics?.apply) return;
    const key = `${identity.platform}:${identity.userId}`;
    if (!avatarCosmetics.has(key)) {
      const lookup = fetch('/api/cosmetics/' + encodeURIComponent(identity.platform) + '/'
        + encodeURIComponent(identity.userId), { credentials: 'include' })
        .then(response => response.ok ? response.json() : null)
        .then(data => data?.equipped || null).catch(() => null);
      avatarCosmetics.set(key, lookup);
      if (avatarCosmetics.size > 100) avatarCosmetics.delete(avatarCosmetics.keys().next().value);
    }
    avatarCosmetics.get(key).then(items => {
      if (!items || !avatar.isConnected) return;
      const visible = { ...items };
      for (const [category, allowed] of Object.entries(viewerVisibility))
        if (allowed === false) delete visible[category];
      window.PfpCosmetics.apply(avatar.querySelector('img') || avatar, avatar, visible,
        { size: avatar.offsetWidth, observe: false });
    });
  }
  function avatarElement(url, name, className = 'player-avatar', identity = null) {
    const avatar = document.createElement('span');
    avatar.className = className;
    const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    avatar.textContent = initial;
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('error', () => { avatar.textContent = initial; dressAvatar(avatar, identity); });
      image.src = url;
      avatar.replaceChildren(image);
    }
    dressAvatar(avatar, identity);
    return avatar;
  }
  function setBalance(value) {
    const formatted = Number.isFinite(value) ? Math.max(0, value).toLocaleString() + ' XP' : '—';
    $('xpBalance').textContent = formatted;
    $('xpBalance').title = formatted === '—' ? 'Balance unavailable for this word' : formatted;
  }
  function queueTicker(entry, roundId) {
    // Green finds and red/yellow guesses have their own lanes, so a run of
    // successful words cannot hide a wrong or repeated one.
    const lane = entry.type === 'found' ? 0 : 1;
    const now = Date.now();
    const delay = Math.max(0, tickerNextAt[lane] - now);
    tickerNextAt[lane] = now + delay + 3100;
    setTimeout(() => {
      if (mode !== 'multi' || tickerRoundId !== roundId) return;
      const bubble = document.createElement('span');
      bubble.className = `ticker-bubble ${entry.type} lane-${lane}`;
      const word = document.createElement('strong'); word.className = 'ticker-word';
      word.textContent = entry.word;
      const finder = document.createElement('span'); finder.className = 'ticker-finder';
      finder.textContent = entry.finder;
      const count = document.createElement('span'); count.className = 'ticker-count';
      count.textContent = entry.type === 'duplicate' ? `×${entry.count || 2}${entry.bonusXp ? ' · BONUS XP' : ''}`
        : entry.type === 'wrong' ? 'NO WORD'
          : `+${Number(entry.points || 0).toLocaleString()}${entry.bonusXp ? ' · BONUS XP' : ''}`;
      bubble.append(word, finder, count);
      const lanes = $('tickerLanes');
      lanes.append(bubble);
      bubble.style.setProperty('--travel', `${lanes.clientWidth + bubble.offsetWidth + 12}px`);
      setTimeout(() => bubble.remove(), 11300);
    }, delay);
  }
  function updateTicker(game) {
    if (mode !== 'multi') return;
    if (tickerRoundId !== game.id) {
      tickerRoundId = game.id; lastAttemptId = 0; tickerNextAt = [0, 0];
      tickerReplayAt = { wrong: 0, duplicate: 0 };
      $('tickerLanes').replaceChildren();
    }
    const attempts = game.recentAttempts || [];
    for (const entry of attempts.filter(item => item.id > lastAttemptId)) {
      lastAttemptId = Math.max(lastAttemptId, entry.id);
      queueTicker(entry, game.id);
      if (entry.type !== 'found') tickerReplayAt[entry.type] = tickerNextAt[1] + 14000;
    }
    for (const type of ['wrong', 'duplicate']) {
      const latest = game.lastAttempts?.[type] || attempts.findLast(entry => entry.type === type);
      if (latest && Date.now() >= tickerReplayAt[type]) {
        queueTicker(latest, game.id);
        tickerReplayAt[type] = tickerNextAt[1] + 14000;
      }
    }
  }
  function updatePodium(game) {
    const shared = mode === 'multi';
    $('podiumCard').hidden = mode !== 'daily';
    $('multiHud').hidden = !shared;
    $('wordTicker').hidden = !shared;
    if (mode === 'daily') $('podiumCard').querySelector('.eyebrow').textContent = 'TODAY’S DAILY';
    if (!shared) return;
    const nextPodiumSignature = JSON.stringify((game.players || []).slice(0, 3)
      .map(p => [p.playerKey, p.displayName, p.avatar, p.score]));
    if (nextPodiumSignature !== podiumSignature) {
      podiumSignature = nextPodiumSignature;
      const list = $('multiPodium');
      list.replaceChildren(...[0, 1, 2].map(index => {
      const p = game.players?.[index];
      const row = document.createElement('li');
      const person = document.createElement('div'); person.className = 'podium-person';
      const rank = document.createElement('span'); rank.className = 'podium-rank'; rank.textContent = `${index + 1}`;
      person.append(rank, avatarElement(p?.avatar, p?.displayName || '?', 'player-avatar', p));
      const name = document.createElement('span'); name.className = 'podium-name';
      name.textContent = p?.displayName || 'Open spot'; name.title = p?.displayName || 'Open spot';
      const score = document.createElement('strong'); score.className = 'podium-score';
      score.textContent = p ? p.score.toLocaleString() : '—';
      row.append(person, name, score); return row;
      }));
    }
    const latest = game.lastWord;
    const nextLatestSignature = JSON.stringify(latest && [latest.at, latest.word, latest.finder,
      latest.xpAwarded, latest.bonusXpAwarded, latest.newBalance]);
    if (nextLatestSignature !== latestSignature) {
      latestSignature = nextLatestSignature;
      const avatar = avatarElement(latest?.avatar, latest?.finder || '✦', 'player-avatar latest-avatar', latest);
      avatar.id = 'latestAvatar'; $('latestAvatar').replaceWith(avatar);
      $('latestWord').textContent = latest?.word || 'Ready to fall';
      $('latestFinder').textContent = latest?.finder || 'Trace a word to start the round';
      $('latestFinder').title = latest?.finder || '';
      $('latestXp').textContent = latest ? `+${Number(latest.xpAwarded || 0).toLocaleString()} XP` : '+0 XP';
      const xpLabel = document.querySelector('.latest-xp small');
      xpLabel.textContent = latest?.bonusXpAwarded ? 'WORD XP · BONUS XP' : 'WORD XP';
      xpLabel.classList.toggle('bonus', !!latest?.bonusXpAwarded);
      setBalance(latest?.newBalance);
    }
    $('latestStatus').textContent = game.finishedAt ? 'ROUND COMPLETE'
      : game.heldUntil > Date.now() ? 'LETTERS HELD' : 'LIVE';
    updateTicker(game);
  }
  async function refreshDailyLeaderboard() {
    if (mode !== 'daily') return;
    try {
      const data = await request('/leaderboard');
      if (mode !== 'daily') return;
      const list = $('podium');
      list.replaceChildren(...data.top.slice(0, 8).map((p, index) => {
        const row = document.createElement('li');
        const name = document.createElement('span'), score = document.createElement('strong');
        name.textContent = `${index + 1}. ${p.name}`;
        score.textContent = p.score.toLocaleString();
        row.append(name, score); return row;
      }));
      $('roomNote').textContent = 'One verified attempt per day. The board resets at Edmonton midnight.';
    } catch {}
  }
  function applyRemote(game, animate = false) {
    const changed = !remote || remote.id !== game.id || remote.version !== game.version;
    const newRound = !remote || remote.id !== game.id;
    remote = game;
    if (mode === 'daily' && game.finishedAt && game.cleared >= C.GOAL)
      try { localStorage.setItem('wordfall_sp_daily_date', game.date); } catch {}
    state.board = game.board;
    state.score = game.moves === null ? personalScore(game) : game.score;
    state.moves = game.moves;
    state.cleared = game.cleared;
    state.words = game.moves === null
      ? (game.players?.find(p => p.platform === player?.platform && String(p.userId) === String(player?.userId))?.words || 0)
      : game.words;
    state.ended = !!game.finishedAt;
    if (changed) {
      state.path = []; state.hintPath = [];
      renderBoard(animate && !newRound);
      if (!newRound && game.lastWord && mode === 'multi') {
        const bonus = game.lastWord.bonusXpAwarded
          ? ` · BONUS XP +${game.lastWord.bonusXpAwarded.toLocaleString()}` : '';
        feedback(`${game.lastWord.finder} found ${game.lastWord.word.toUpperCase()} · +${game.lastWord.points.toLocaleString()}${bonus}`, 'good');
      }
    } else renderSelection();
    showHeldClaims(game);
    renderStats(); updatePodium(game);
    if (mode === 'multi') animateLatestWordXp(game);
    if (mode === 'daily' && game.finishedAt) refreshDailyLeaderboard();
    clearTimeout(resultRevealTimer);
    if (state.ended && overlay.hidden) {
      const wait = mode === 'multi' ? Math.max(0, (game.heldUntil || 0) - Date.now()) : 0;
      if (wait) {
        const roundId = game.id;
        resultRevealTimer = setTimeout(() => {
          if (mode === 'multi' && remote?.id === roundId && remote.finishedAt && overlay.hidden) showResult();
        }, wait);
      } else showResult();
    }
    if (!state.ended && !overlay.hidden) {
      overlay.hidden = true; document.querySelector('.page-shell').inert = false;
    }
  }
  function showBurst(word) {
    const burst = $('wordBurst');
    burst.textContent = word.toUpperCase();
    burst.classList.remove('visible'); void burst.offsetWidth; burst.classList.add('visible');
    if (cosmetics && window.PfpCosmetics?.spawnWord) window.PfpCosmetics.spawnWord(burst, cosmetics);
  }
  function markFinder(path, finder) {
    for (const index of path || []) {
      const tile = boardEl.querySelector(`[data-index="${index}"]`);
      if (!tile) continue;
      tile.classList.add('claimed');
      tile.querySelector('.tile-finder-avatar')?.remove();
      tile.append(avatarElement(finder?.avatar, finder?.finder, 'tile-finder-avatar', finder));
      tile.dataset.claimId = String(finder?.id || finder?.claimId || '');
    }
  }
  function updateHeldTimers() {
    if (mode !== 'multi') return;
    const now = Date.now();
    boardEl.querySelectorAll('.tile.claimed').forEach(tile => {
      const badge = tile.querySelector('.tile-hold-timer');
      if (!badge) return;
      const seconds = Math.max(0, Number(tile.dataset.expiresAt) - now) / 1000;
      badge.textContent = `${seconds.toFixed(1)}s`;
      badge.style.setProperty('--timer-hue', String(Math.round(120 * Math.min(1, seconds / 6))));
    });
  }
  function showHeldClaims(game) {
    if (mode !== 'multi') return;
    const byTile = new Map();
    for (const claim of game.pendingClaims || [])
      for (const index of claim.path || []) byTile.set(index, claim);
    boardEl.querySelectorAll('.tile').forEach(tile => {
      const claim = byTile.get(Number(tile.dataset.index));
      if (!claim) {
        tile.classList.remove('claimed');
        tile.querySelector('.tile-finder-avatar')?.remove();
        tile.querySelector('.tile-hold-timer')?.remove();
        tile.querySelector('.timer-extension-pop')?.remove();
        delete tile.dataset.claimId;
        delete tile.dataset.expiresAt;
      } else {
        if (tile.dataset.claimId !== String(claim.id)) markFinder([Number(tile.dataset.index)], claim);
        const previousExpiry = Number(tile.dataset.expiresAt);
        const nextExpiry = Number(claim.expiresAt || game.heldUntil);
        tile.dataset.expiresAt = String(nextExpiry);
        if (!tile.querySelector('.tile-hold-timer')) {
          const badge = document.createElement('span');
          badge.className = 'tile-hold-timer';
          badge.setAttribute('aria-hidden', 'true');
          tile.append(badge);
        }
        if (Number.isFinite(previousExpiry) && nextExpiry >= previousExpiry + 900) {
          const badge = tile.querySelector('.tile-hold-timer');
          badge.classList.remove('extended'); void badge.offsetWidth; badge.classList.add('extended');
          tile.querySelector('.timer-extension-pop')?.remove();
          const extension = document.createElement('span');
          extension.className = 'timer-extension-pop'; extension.textContent = '+1s';
          tile.append(extension);
          setTimeout(() => extension.remove(), 1300);
        }
      }
    });
    updateHeldTimers();
  }
  async function revealAndApply(game, animate = false) {
    const falling = mode === 'multi' && remote?.id === game.id
      && game.version > remote.version && remote.pendingClaims?.length;
    if (falling) {
      const token = modeToken;
      state.busy = true;
      const nextIds = new Set(game.board.map(tile => tile.id));
      const removed = new Set(remote.board.flatMap((tile, index) => nextIds.has(tile.id) ? [] : [index]));
      removed.forEach(index => boardEl.querySelector(`[data-index="${index}"]`)?.classList.add('clearing'));
      await new Promise(resolve => setTimeout(resolve, 190));
      if (token !== modeToken) { state.busy = false; return; }
    }
    applyRemote(game, animate);
    if (falling) { state.busy = false; renderSelection(); }
  }
  function flyLetterXp(index, awarded, delay, onArrive) {
    if (!awarded) return;
    const source = boardEl.querySelector(`[data-index="${index}"]`);
    if (!source) { onArrive?.(awarded); return; }
    const target = $('xpBalance');
    const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
    const particle = document.createElement('span');
    particle.className = 'xp-flight';
    particle.textContent = `+${Number(awarded).toLocaleString()} XP`;
    particle.style.left = `${a.left + a.width / 2}px`;
    particle.style.top = `${a.top + a.height / 2}px`;
    document.body.append(particle);
    let arrived = false;
    const arrive = () => {
      if (arrived) return;
      arrived = true;
      particle.remove();
      onArrive?.(awarded);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !particle.animate) {
      setTimeout(arrive, 700 + delay); return;
    }
    const dx = b.left + b.width / 2 - a.left - a.width / 2;
    const dy = b.top + b.height / 2 - a.top - a.height / 2;
    const animation = particle.animate([
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%,-100%) scale(1.15)', opacity: 1, offset: .22 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.5)`, opacity: 0 }
    ], { duration: 1900, delay, easing: 'cubic-bezier(.22,.72,.28,1)', fill: 'forwards' });
    animation.onfinish = arrive;
    setTimeout(() => { if (particle.isConnected) arrive(); }, 2150 + delay);
  }
  function flyBonusXp(path, awarded, delay, onArrive) {
    if (!awarded) return;
    const tiles = (path || []).map(index => boardEl.querySelector(`[data-index="${index}"]`)).filter(Boolean);
    const source = tiles[Math.floor(tiles.length / 2)] || boardEl;
    const target = $('xpBalance');
    const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
    const particle = document.createElement('span');
    particle.className = 'xp-flight bonus-xp-flight';
    particle.textContent = `BONUS XP +${Number(awarded).toLocaleString()}`;
    particle.style.left = `${a.left + a.width / 2}px`;
    particle.style.top = `${a.top + a.height / 2}px`;
    document.body.append(particle);
    let arrived = false;
    const arrive = () => {
      if (arrived) return;
      arrived = true; particle.remove(); onArrive?.(awarded);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !particle.animate) {
      setTimeout(arrive, 800 + delay); return;
    }
    const dx = b.left + b.width / 2 - a.left - a.width / 2;
    const dy = b.top + b.height / 2 - a.top - a.height / 2;
    const animation = particle.animate([
      { transform: 'translate(-50%,-50%) scale(.45)', opacity: 0 },
      { transform: 'translate(-50%,-125%) scale(1.12)', opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-125%) scale(1)', opacity: 1, offset: .48 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.55)`, opacity: 0 }
    ], { duration: 2200, delay, easing: 'cubic-bezier(.22,.72,.28,1)', fill: 'forwards' });
    animation.onfinish = arrive;
    setTimeout(() => { if (particle.isConnected) arrive(); }, 2450 + delay);
  }
  function animateLatestWordXp(game) {
    const latest = game.lastWord;
    if (!latest?.claimId || !Array.isArray(latest.path)) return;
    const key = `${game.id}:${latest.claimId}`;
    if (key === lastAnimatedClaimKey) return;
    const claim = game.pendingClaims?.find(entry => entry.id === latest.claimId);
    if (!latest.xpAwarded || !Array.isArray(latest.letterXp)
      || !claim || claim.path.length !== latest.letterXp.length
      || Number(claim.expiresAt) <= Date.now()) return;
    lastAnimatedClaimKey = key;
    const hasBalance = Number.isFinite(latest.newBalance);
    let arrivingBalance = hasBalance ? latest.newBalance - latest.xpAwarded : null;
    if (hasBalance) setBalance(arrivingBalance);
    const addToBalance = xp => {
      if (hasBalance && remote?.id === game.id && remote.lastWord?.claimId === latest.claimId) {
        arrivingBalance += xp;
        setBalance(arrivingBalance);
      }
    };
    claim.path.forEach((index, position) => flyLetterXp(index, latest.letterXp[position], position * 120, addToBalance));
    if (latest.bonusXpAwarded)
      flyBonusXp(claim.path, latest.bonusXpAwarded, claim.path.length * 120 + 240, addToBalance);
  }
  async function loadCosmetics() {
    try {
      const [equipped, prefs] = await Promise.all([
        fetch('/api/me/equipped-cosmetics', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/me/visibility', { credentials: 'include' }).then(r => r.json())
      ]);
      cosmetics = { ...(equipped.equipped || {}) };
      viewerVisibility = prefs.visibility || {};
      for (const [key, visible] of Object.entries(viewerVisibility)) if (visible === false) delete cosmetics[key];
    } catch { cosmetics = null; }
  }
  function setAccountNote(message, signIn = false) {
    const note = $('accountNote'); note.textContent = message;
    if (signIn) {
      const link = document.createElement('a');
      link.href = '/auth/discord?returnTo=' + encodeURIComponent(location.href);
      link.textContent = ' Sign in →'; note.append(link);
    }
  }

  function feedback(message, tone = '') {
    $('feedback').textContent = message;
    $('feedback').className = `feedback ${tone}`;
  }
  function drawTrace() {
    const boardBox = boardEl.getBoundingClientRect();
    traceLines.setAttribute('viewBox', `0 0 ${boardBox.width} ${boardBox.height}`);
    traceLine.setAttribute('points', state.path.map(index => {
      const tile = boardEl.querySelector(`[data-index="${index}"]`);
      if (!tile) return '';
      const box = tile.getBoundingClientRect();
      return `${box.left + box.width / 2 - boardBox.left},${box.top + box.height / 2 - boardBox.top}`;
    }).join(' '));
  }
  function renderSelection() {
    const chosen = new Map(state.path.map((index, order) => [index, order + 1]));
    boardEl.querySelectorAll('.tile').forEach(tile => {
      const index = Number(tile.dataset.index);
      tile.classList.toggle('selected', chosen.has(index));
      tile.classList.toggle('hint', state.hintPath.includes(index));
      const number = tile.querySelector('.order');
      number.textContent = chosen.get(index) || '';
    });
    const word = state.path.length ? C.wordAt(state.board, state.path) : '';
    $('selectedWord').textContent = word ? word.toUpperCase() : 'Trace the letters';
    $('selectedWord').classList.toggle('empty', !word);
    const badge = $('wordBadge');
    badge.className = 'word-badge';
    if (word.length < 3) badge.textContent = word ? 'KEEP GOING' : 'READY';
    else if (C.WORDS.has(word)) {
      const tier = C.wordTier(word);
      badge.textContent = tier === 'rare' ? 'RARE WORD'
        : tier === 'hidden' ? 'HIDDEN WORD' : 'WORD FOUND';
      badge.classList.add('valid');
    }
    else { badge.textContent = mode === 'multi' ? 'NO WORD' : 'KEEP TRACING';
      if (mode === 'multi') badge.classList.add('invalid'); }
    $('submit').disabled = state.busy || state.ended || state.path.length < 3;
    $('undo').disabled = state.busy || state.ended || state.path.length === 0;
    drawTrace();
  }
  function renderBoard(animate = false) {
    const tiles = state.board.map((tile, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tile';
      button.dataset.index = String(index);
      button.dataset.tone = ['peach', 'lavender', 'blue', 'mint', 'gold'][(tile.letter.charCodeAt(0) - 65) % 5];
      button.setAttribute('aria-label', `Row ${Math.floor(index / C.SIZE) + 1}, column ${index % C.SIZE + 1}: ${tile.letter}`);
      button.innerHTML = `<span class="order" aria-hidden="true"></span><span>${tile.letter}</span>`;
      return button;
    });
    boardEl.replaceChildren(traceLines, ...tiles);
    renderSelection();
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const rowStep = tiles[C.SIZE].getBoundingClientRect().top - tiles[0].getBoundingClientRect().top;
      tiles.forEach((button, index) => {
        const from = state.board[index].fromRow;
        if (from === undefined) return;
        const row = Math.floor(index / C.SIZE);
        const distance = (from - row) * rowStep;
        if (!distance) return;
        button.animate([
          { transform: `translateY(${distance}px)`, opacity: from < 0 ? 0 : 1 },
          { transform: 'translateY(0)', opacity: 1 }
        ], { duration: from < 0 ? 520 : 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }
  }
  function renderStats() {
    $('score').textContent = state.score.toLocaleString();
    const winScore = remote?.winScore || 25000;
    const leadingScore = remote?.players?.[0]?.score || 0;
    $('moves').textContent = mode === 'multi' ? `${leadingScore.toLocaleString()} / ${winScore.toLocaleString()}` : state.moves;
    $('multiClock').textContent = `${Math.min(leadingScore, winScore).toLocaleString()} / ${winScore.toLocaleString()}`;
    $('cleared').textContent = state.cleared;
    $('goalFill').style.width = `${mode === 'multi' && remote
      ? Math.min(100, 100 * leadingScore / winScore)
      : Math.min(100, state.cleared / C.GOAL * 100)}%`;
    $('goalTrack').setAttribute('aria-valuenow', String(mode === 'multi'
      ? Math.min(winScore, leadingScore) : Math.min(C.GOAL, state.cleared)));
    $('shuffle').disabled = state.busy || state.ended || mode === 'multi' || state.moves <= 0;
    $('hint').disabled = state.busy || state.ended;
  }
  function renderCombo() {
    const remaining = Math.max(0, state.comboUntil - Date.now());
    if (!remaining && !state.busy) {
      state.combo = 0;
      state.comboUntil = 0;
    }
    $('comboValue').textContent = `${Math.max(1, state.combo)}`;
    $('comboLabel').textContent = remaining ? 'Find the next word!' : 'Ready to roll';
    $('comboFill').style.width = `${remaining / C.COMBO_WINDOW_MS * 100}%`;
  }
  function clearSelection() {
    state.path = [];
    renderSelection();
  }
  function chooseTile(index) {
    if (state.busy || state.ended) return;
    state.hintPath = [];
    const path = state.path;
    if (path.length >= 2 && index === path[path.length - 2]) path.pop();
    else if (path.includes(index)) return;
    else if (!path.length || !C.neighbor(path[path.length - 1], index)) state.path = [index];
    else path.push(index);
    renderSelection();
  }
  function showResult() {
    state.ended = true;
    renderStats();
    renderSelection();
    const shared = mode === 'multi';
    const won = shared ? !!player && remote?.winner?.userId === player.userId : state.cleared >= C.GOAL;
    const winScore = (remote?.winScore || 25000).toLocaleString();
    $('resultEyebrow').textContent = shared ? `${winScore}-POINT WIN` : won ? 'CHALLENGE CLEARED' : 'OUT OF MOVES';
    $('resultTitle').textContent = shared
      ? won ? 'You won the board!' : `${remote?.winner?.displayName || 'Nobody'} wins!`
      : won ? 'What a fall!' : 'One more round?';
    $('resultCopy').textContent = shared
      ? player
        ? `You earned ${state.score.toLocaleString()} points on the shared board. First to ${winScore} wins; the next round starts shortly.`
        : `First to ${winScore} wins. The next round starts shortly.`
      : won
        ? `You cleared ${state.cleared} tiles with ${state.moves} moves to spare.${remote?.reward?.message ? ' ' + remote.reward.message : ''}`
        : `You cleared ${state.cleared} of ${C.GOAL} tiles. Give it another tumble.`;
    $('resultScoreLabel').textContent = shared ? 'TOP SCORE' : 'SCORE';
    $('resultWordsLabel').textContent = shared ? 'BOARD WORDS' : 'WORDS FOUND';
    $('resultThirdLabel').textContent = shared ? 'PLAYERS' : 'BEST COMBO';
    $('resultScore').textContent = (shared ? remote?.winner?.score || 0 : state.score).toLocaleString();
    $('resultWords').textContent = shared ? remote?.words || 0 : state.words;
    $('resultCombo').textContent = shared ? remote?.players?.length || 0 : `${Math.max(1, state.bestCombo)}`;
    $('playAgain').innerHTML = mode === 'daily' ? 'Practice another board <span>↗</span>'
      : mode === 'multi' ? 'Watch next board <span>↗</span>' : 'Play again <span>↗</span>';
    overlay.hidden = false;
    document.querySelector('.page-shell').inert = true;
    $('playAgain').focus();
  }
  function submit() {
    if (state.busy || state.ended) return;
    const result = C.validatePath(state.board, state.path);
    if (!result.ok && !(mode === 'multi' && result.reason === 'word')) {
      const messages = { short: 'Keep going—words need at least three letters.', word: 'That word is not in the Word Bank. Try another path.', path: 'Trace neighboring letters without reusing a tile.' };
      feedback(messages[result.reason] || 'Try another word.', 'bad');
      state.busy = true;
      state.path.forEach(index => boardEl.querySelector(`[data-index="${index}"]`)?.classList.add('invalid'));
      const token = state.token;
      setTimeout(() => { if (token !== state.token) return; state.busy = false; clearSelection(); }, 480);
      return;
    }
    if (mode !== 'practice') {
      if (mode === 'multi' && !player) {
        feedback('Sign in to trace on the shared board, or play through stream chat.', 'bad');
        setAccountNote('Sign in to claim words on this board.', true);
        return;
      }
      state.busy = true;
      const path = [...state.path], version = remote?.version, roundId = remote?.id;
      request(mode === 'multi' ? '/room/' + encodeURIComponent(roomScope) + '/play' : '/run/play', {
        method: 'POST', body: JSON.stringify({ mode, roundId, version, path })
      }).then(async data => {
        showBurst(data.word);
        const combo = Date.now() < state.comboUntil ? Math.min(5, state.combo + 1) : 1;
        state.combo = combo; state.bestCombo = Math.max(state.bestCombo, combo);
        state.comboUntil = Date.now() + C.COMBO_WINDOW_MS; renderCombo();
        if (mode === 'multi') {
          clearSelection();
          await revealAndApply(data.state, true);
          const bonus = data.bonusXpAwarded ? ` · BONUS XP +${data.bonusXpAwarded.toLocaleString()}` : '';
          feedback(`${data.word.toUpperCase()}! +${data.points.toLocaleString()} points${bonus} · ${data.rewardMessage || 'XP pending'}`, 'good');
        } else {
          path.forEach(index => boardEl.querySelector(`[data-index="${index}"]`)?.classList.add('clearing'));
          await new Promise(resolve => setTimeout(resolve, 220));
          applyRemote(data.state, true);
          feedback(`${data.word.toUpperCase()}! +${data.points.toLocaleString()} Word Tycoon points`, 'good');
        }
      }).catch(error => {
        if (error.data?.state) applyRemote(error.data.state);
        feedback(error.message, 'bad');
        clearSelection();
      }).finally(() => { state.busy = false; renderSelection(); renderStats(); });
      return;
    }
    state.busy = true;
    const combo = Date.now() < state.comboUntil ? Math.min(5, state.combo + 1) : 1;
    const points = C.scoreWord(result.word);
    state.combo = combo;
    state.bestCombo = Math.max(state.bestCombo, combo);
    state.comboUntil = Date.now() + C.COMBO_WINDOW_MS;
    state.score += points;
    state.cleared += state.path.length;
    state.words++;
    state.moves--;
    renderStats();
    renderCombo();
    feedback(`${result.word.toUpperCase()}! +${points.toLocaleString()} Word Tycoon points`, 'good');
    showBurst(result.word);
    const path = [...state.path];
    path.forEach(index => boardEl.querySelector(`[data-index="${index}"]`)?.classList.add('clearing'));
    const token = state.token;
    setTimeout(() => {
      if (token !== state.token) return;
      state.board = C.dropTiles(state.board, path);
      let reshuffled = false;
      if (C.countVowels(state.board) < C.MIN_VOWELS || !C.findWords(state.board, 1).length) {
        state.board = C.createBoard();
        reshuffled = true;
      }
      state.path = [];
      renderBoard(!reshuffled);
      if (reshuffled) feedback('Fresh letters dropped in—find the next word!', 'good');
      setTimeout(() => {
        if (token !== state.token) return;
        state.busy = false;
        renderSelection();
        renderStats();
        if (state.cleared >= C.GOAL || state.moves <= 0) showResult();
      }, 510);
    }, 215);
  }
  function showHint() {
    if (state.busy || state.ended) return;
    const options = C.findWords(state.board, 100).sort((a, b) => b.word.length - a.word.length);
    if (!options.length) { feedback('No words left—shuffle the board.'); return; }
    state.hintPath = options[0].path;
    renderSelection();
    feedback(`Look for a ${options[0].word.length}-letter word in the glowing tiles.`);
    const token = state.token;
    setTimeout(() => { if (token === state.token) { state.hintPath = []; renderSelection(); } }, 2800);
  }
  function shuffleBoard() {
    if (state.busy || state.ended) return;
    if (mode !== 'practice') {
      if (mode === 'multi') return;
      state.busy = true;
      request('/run/shuffle', { method: 'POST',
        body: JSON.stringify({ mode, roundId: remote?.id, version: remote?.version }) })
        .then(data => { applyRemote(data.state); feedback('A fresh fall of letters. Shuffle costs one move.'); })
        .catch(error => { if (error.data?.state) applyRemote(error.data.state); feedback(error.message, 'bad'); })
        .finally(() => { state.busy = false; renderSelection(); renderStats(); });
      return;
    }
    state.moves--;
    state.board = C.createBoard();
    state.path = [];
    state.hintPath = [];
    state.combo = 0;
    state.comboUntil = 0;
    renderBoard();
    renderStats();
    renderCombo();
    feedback('A fresh fall of letters. Shuffle costs one move.');
    if (state.moves <= 0) showResult();
  }
  function newPracticeGame() {
    const returningFromResult = !overlay.hidden;
    state.token++;
    state.board = C.createBoard();
    state.path = [];
    state.hintPath = [];
    state.score = 0;
    state.moves = C.MOVES;
    state.cleared = 0;
    state.words = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.comboUntil = 0;
    state.busy = false;
    state.ended = false;
    state.pointer = null;
    overlay.hidden = true;
    document.querySelector('.page-shell').inert = false;
    renderBoard();
    renderStats();
    renderCombo();
    feedback('Drag through adjacent letters, or tap them one by one.');
    if (returningFromResult) boardEl.querySelector('.tile')?.focus();
  }
  async function activateMode(nextMode, replace = false) {
    const token = ++modeToken;
    clearTimeout(resultRevealTimer);
    mode = nextMode; remote = null; state.ended = false; state.busy = true;
    podiumSignature = ''; latestSignature = ''; lastAnimatedClaimKey = '';
    document.body.classList.toggle('mode-multi', mode === 'multi');
    $('multiHud').hidden = mode !== 'multi';
    $('wordTicker').hidden = mode !== 'multi';
    overlay.hidden = true; document.querySelector('.page-shell').inert = false;
    document.querySelectorAll('.mode-tabs button').forEach(button =>
      button.classList.toggle('active', button.dataset.mode === mode));
    $('modeLabel').textContent = mode.toUpperCase();
    $('scoreLabel').textContent = mode === 'multi' ? 'YOUR POINTS' : 'SCORE';
    $('movesLabel').textContent = mode === 'multi' ? 'LEADER / GOAL' : 'MOVES LEFT';
    $('newGame').textContent = mode === 'multi' ? '↻ Refresh room' : mode === 'daily' ? '↻ Today’s board' : '↻ New round';
    $('shuffle').hidden = mode === 'multi';
    $('podiumCard').hidden = mode !== 'daily';
    const nextUrl = new URL(location.href);
    if (mode === 'practice') nextUrl.searchParams.delete('mode');
    else nextUrl.searchParams.set('mode', mode);
    history.replaceState(null, '', nextUrl);
    if (mode === 'practice') {
      remote = null; newPracticeGame();
      setAccountNote('Practice is local. Sign in for saved solo, daily, multiplayer, Word Bank, cosmetics, and Word Tycoon XP.');
      return;
    }
    feedback('Connecting to Word Tycoon…');
    try {
      const config = await request('/config');
      if (!C.configureWords(config.words, config.tierCodes)) throw new Error('Wordfall scoring data is unavailable.');
      let me;
      try { me = await request('/me?mode=' + (mode === 'solo' ? 'solo' : 'daily')); }
      catch (error) { if (mode !== 'multi' || error.status !== 401) throw error; }
      if (token !== modeToken) return;
      player = me?.player || null;
      const data = mode === 'multi'
        ? await request('/room/' + encodeURIComponent(roomScope))
        : await request('/run/start', { method: 'POST', body: JSON.stringify({ mode, replace: mode === 'solo' && replace }) });
      if (token !== modeToken) return;
      state.busy = false;
      applyRemote(data.state);
      refreshDailyLeaderboard();
      if (obsStreamer && mode === 'multi') {
        setAccountNote('Live streamer board. Chat a visible word to play.');
      } else if (player) {
        setAccountNote(`Playing as ${player.displayName}. Words enter your Word Bank; multiplayer words award their full score as Word Tycoon XP.`);
      } else {
        setAccountNote('Watch the shared board and chat a word to play; sign in to trace on it.', true);
      }
      if (!data.state.finishedAt) feedback(mode === 'multi'
        ? 'One shared board. Trace before someone else changes it!'
        : mode === 'daily' ? 'Today’s Edmonton-time board is saved to your account.' : 'Your solo run is saved to your account.');
    } catch (error) {
      if (token !== modeToken) return;
      const message = error.message;
      mode = 'practice'; remote = null; newPracticeGame();
      document.body.classList.remove('mode-multi');
      $('multiHud').hidden = true; $('wordTicker').hidden = true;
      document.querySelectorAll('.mode-tabs button').forEach(button =>
        button.classList.toggle('active', button.dataset.mode === 'practice'));
      $('modeLabel').textContent = 'PRACTICE';
      $('shuffle').hidden = false; $('podiumCard').hidden = true;
      feedback(message, 'bad');
      setAccountNote(message, error.status === 401);
    }
  }
  function newGame() {
    if (mode === 'practice') newPracticeGame();
    else if (mode === 'daily' && remote?.finishedAt) activateMode('practice');
    else activateMode(mode, true);
  }
  async function pollRoom() {
    if (mode !== 'multi' || pollBusy || state.busy) return;
    pollBusy = true;
    try {
      const data = await request('/room/' + encodeURIComponent(roomScope));
      if (mode === 'multi') await revealAndApply(data.state, true);
    } catch (error) { if (mode === 'multi') feedback(error.message, 'bad'); }
    finally { pollBusy = false; }
  }

  boardEl.addEventListener('pointerdown', event => {
    const tile = event.target.closest('.tile');
    if (!tile || state.busy || state.ended) return;
    event.preventDefault();
    state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    chooseTile(Number(tile.dataset.index));
  });
  window.addEventListener('pointermove', event => {
    const pointer = state.pointer;
    if (!pointer || event.pointerId !== pointer.id) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 9) pointer.moved = true;
    if (!pointer.moved) return;
    const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tile');
    if (tile && boardEl.contains(tile)) chooseTile(Number(tile.dataset.index));
  });
  window.addEventListener('pointerup', event => {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    const dragged = state.pointer.moved;
    state.pointer = null;
    if (dragged && state.path.length >= 3) submit();
  });
  window.addEventListener('pointercancel', () => { state.pointer = null; });
  boardEl.addEventListener('click', event => {
    if (event.detail !== 0) return; // Native keyboard activation; pointerdown handles mouse and touch.
    const tile = event.target.closest('.tile');
    if (tile) chooseTile(Number(tile.dataset.index));
  });
  window.addEventListener('keydown', event => {
    if (state.ended || event.target.closest('button')) return;
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    else if (event.key === 'Escape') clearSelection();
    else if (event.key === 'Backspace') { event.preventDefault(); state.path.pop(); renderSelection(); }
  });
  window.addEventListener('resize', drawTrace);
  $('newGame').addEventListener('click', newGame);
  $('playAgain').addEventListener('click', newGame);
  $('submit').addEventListener('click', submit);
  $('undo').addEventListener('click', () => { if (!state.busy) { state.path.pop(); renderSelection(); } });
  $('hint').addEventListener('click', showHint);
  $('shuffle').addEventListener('click', shuffleBoard);
  document.querySelectorAll('.mode-tabs button').forEach(button =>
    button.addEventListener('click', () => activateMode(button.dataset.mode)));
  setInterval(renderCombo, 80);
  setInterval(updateHeldTimers, 100);
  setInterval(() => { if (mode === 'multi') { renderStats(); pollRoom(); } }, 1200);
  loadCosmetics();
  activateMode(mode);
})();
