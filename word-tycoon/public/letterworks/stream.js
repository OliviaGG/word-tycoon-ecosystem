(function () {
  'use strict';
  const core = window.LetterworksCore;
  const rackDisplay = window.LetterworksRackDisplay;
  const params = new URLSearchParams(location.search);
  const id = params.get('session') || params.get('streamer');
  const $ = key => document.getElementById(key);
  const base = '/api/letterworks/stream/' + encodeURIComponent(id || '');
  let current = null, busy = false, rendered = '', polling = false;
  const ticker = window.LetterworksGuessTicker.create($('guessTicker'));
  if (params.has('obs')) { document.body.classList.add('obs-mode'); document.documentElement.classList.add('obs-document'); }
  const escape = value => String(value).replace(/[&<>"']/g, letter => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[letter]));
  function render(data) {
    const s = data.state, round = core.createRun(s.seed)[s.roundIndex]; current = s;
    ticker.sync(s.guesses, s.id);
    $('liveWorkshop').hidden = false; $('streamerName').textContent = data.streamer + '’s workshop';
    $('liveShift').textContent = 'SHIFT ' + (s.roundIndex + 1) + ' OF 5'; $('liveName').textContent = rackDisplay.shiftName(s.roundIndex);
    $('liveScore').textContent = s.runScore.toLocaleString();
    const seconds = Math.ceil(s.millisecondsRemaining / 1000);
    $('liveTimer').textContent = s.status === 'choosing' ? 'VOTE' : s.status === 'finished' ? 'DONE' : s.timed === false ? '∞' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    $('liveTimer').closest('.stat').querySelector('span').textContent = s.timed === false ? 'NO TIMER' : 'TIME';
    const nextRunSeconds = Math.max(0, Math.ceil((s.nextRunAt - Date.now()) / 1000));
    $('streamStatus').textContent = s.status === 'finished' ? (s.won ? 'Workshop saved! Great work, crew.' : 'The quota got away.') + ' Next workshop starts in ' + nextRunSeconds + 's.'
      : s.status === 'choosing' ? 'Shift banked! Vote for our next contract.'
      : core.canBankWithoutBlueprint(s.roundScore, s.masterFound, s.foundWords.length, round) ? 'One blueprint remains. The streamer can bank this nearly complete shift.'
      : s.timed === false && core.roundComplete(s.roundScore, s.masterFound, round) ? 'Quota met! Finish the ledger to advance, or ask the streamer to bank this shift.'
      : 'Forge words together. Meet the quota and find a six-letter blueprint.';
    $('liveBoss').hidden = !round.boss; $('liveBoss').textContent = 'BOSS RULE · Every word must contain ' + round.requiredLetter;
    $('liveCount').textContent = s.foundWords.length + ' / ' + round.words.length + ' found';
    const signature = s.id + ':' + s.roundIndex + ':' + s.foundWords.join(',');
    if (signature !== rendered) {
      $('liveLedger').innerHTML = [3, 4, 5, 6].map(length => {
        const words = round.words.filter(word => word.length === length).sort((a, b) =>
          Number(s.foundWords.includes(a)) - Number(s.foundWords.includes(b)) || a.localeCompare(b)); if (!words.length) return '';
        return '<section class="word-group"><div class="word-group-heading"><span>' + length + ' LETTERS</span><b>' + words.filter(word => s.foundWords.includes(word)).length + '/' + words.length + '</b></div><div class="word-grid">'
          + words.map(word => s.foundWords.includes(word) ? '<span class="word-slot found">' + word + '</span>' : '<span class="word-slot unfound" aria-label="Unfound ' + length + '-letter word"><span aria-hidden="true">' + '<i></i>'.repeat(length) + '</span></span>').join('') + '</div></section>';
      }).join(''); $('liveLedger').scrollTop = 0;
      const displayLetters = rackDisplay.arrange([...round.rack], round,
        core.seededRandom(core.DATA_VERSION + ':' + s.seed + ':display:' + s.roundIndex));
      $('liveRack').innerHTML = displayLetters.map(letter => '<span class="letter-tile' + (letter === round.requiredLetter ? ' locked' : '') + '">' + letter + '</span>').join('');
      rendered = signature;
    }
    $('liveGoal').textContent = s.roundScore + ' / ' + round.targetScore + ' quota · ' + (s.masterFound ? '◆ Blueprint found' : '◇ Find a six-letter blueprint');
    $('liveProgress').setAttribute('aria-valuemax', round.targetScore); $('liveProgress').setAttribute('aria-valuenow', Math.min(s.roundScore, round.targetScore));
    $('liveProgress').firstElementChild.style.width = Math.min(100, s.roundScore / round.targetScore * 100) + '%';
    $('lastForge').textContent = s.lastWord ? s.lastWord.name + ' forged ' + s.lastWord.word.toUpperCase() + ' · +' + s.lastWord.points : 'The ledger is waiting for our first word.';
    $('contractVote').hidden = s.status !== 'choosing';
    $('voteTimer').textContent = Math.max(0, Math.ceil((s.voteEndsAt - Date.now()) / 1000)) + 's';
    const choiceSignature = s.choices.map(c => c.id).join(':') + s.votes.join(':');
    if ($('liveChoices').dataset.signature !== choiceSignature) {
      $('liveChoices').dataset.signature = choiceSignature;
      $('liveChoices').innerHTML = s.choices.map((c, index) => '<button type="button" class="upgrade-card" data-vote="' + (index + 1) + '"><span class="upgrade-icon">' + (index + 1) + '</span><strong>' + c.name + '</strong><p>' + c.description + '</p><small>' + s.votes[index] + ' VOTES · VOTE ' + (index + 1) + '</small></button>').join('');
      $('liveChoices').querySelectorAll('button').forEach(button => button.addEventListener('click', () => submit(button.dataset.vote)));
    }
    $('crewBoard').innerHTML = s.contributors.length ? s.contributors.map(p => '<li><span>' + escape(p.displayName) + '</span><b>' + p.score.toLocaleString() + ' pts</b></li>').join('') : '<li>Our first word starts the crew board.</li>';
    $('liveInput').placeholder = s.status === 'choosing' ? 'Vote 1, 2 or 3…' : 'Forge a word…';
    $('liveInput').disabled = s.status === 'finished';
  }
  async function poll() {
    if (!id || polling || document.hidden) return;
    polling = true;
    try { const response = await fetch(base, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); render(data);
    } catch (err) { $('streamStatus').textContent = err.message || 'Reconnecting to the workshop…'; }
    finally { polling = false; }
  }
  async function submit(word) {
    if (busy || !current) return; busy = true;
    try { const response = await fetch(base + '/word', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word, runId: current.id, roundIndex: current.roundIndex }), signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (data.state) render({ state: data.state, streamer: $('streamerName').textContent.replace('’s workshop', '') });
      if (!data.ok) throw new Error(data.error);
      $('webStatus').textContent = data.word ? '+' + data.points + ' · ' + data.word.toUpperCase() + ' forged' : 'Contract vote counted.'; $('liveInput').value = '';
    } catch (err) { $('webStatus').textContent = err.message;
      if (err.message?.includes('Sign in')) { const link = document.createElement('a'); link.href = '/auth/discord?returnTo=' + encodeURIComponent(location.href); link.textContent = ' Sign in →'; $('webStatus').append(link); } }
    finally { busy = false; }
  }
  $('webForge').addEventListener('submit', event => { event.preventDefault(); submit($('liveInput').value.trim()); });
  if (!id) $('streamStatus').textContent = 'Open the live workshop link from a streamer’s dashboard or Word Tycoon room.';
  else { poll(); setInterval(poll, 2000); document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); }
})();
