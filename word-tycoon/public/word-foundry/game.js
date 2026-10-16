(function startWordFoundry() {
  'use strict';
  const core = window.WordFoundryCore;
  if (!core) throw new Error('Word Foundry core failed to load.');
  const cloud = window.WordFoundryCloud;
  if (!cloud) throw new Error('Word Foundry cloud client failed to load.');

  const SAVE_KEY = 'word-foundry.save.v1';
  const TAB_KEY = 'word-foundry.tab.v1';
  const $ = id => document.getElementById(id);
  const el = {
    appScroll: $('appScroll'), cash: $('cash'), income: $('income'), editionLabel: $('editionLabel'), fameLabel: $('fameLabel'),
    accountStatus: $('accountStatus'),
    tutorial: $('tutorial'), tutorialCount: $('tutorialCount'), lineCapacity: $('lineCapacity'), totalOutput: $('totalOutput'),
    clientBrief: $('clientBrief'), briefName: $('briefName'), briefDescription: $('briefDescription'), briefReward: $('briefReward'),
    portfolioMultiplier: $('portfolioMultiplier'), portfolioHint: $('portfolioHint'),
    composition: $('composition'), clearSelection: $('clearSelection'), wordPreview: $('wordPreview'), buildButton: $('buildButton'),
    inventory: $('inventory'), availableCount: $('availableCount'), wordLines: $('wordLines'), market: $('market'),
    refreshMarket: $('refreshMarket'), refreshCost: $('refreshCost'), lettersOwned: $('lettersOwned'),
    alphabetInventory: $('alphabetInventory'), upgradeList: $('upgradeList'), researchSpent: $('researchSpent'),
    managerLevel: $('managerLevel'), managerName: $('managerName'), managerDescription: $('managerDescription'),
    managerRecord: $('managerRecord'), hireManager: $('hireManager'),
    dailyDate: $('dailyDate'), dailyCount: $('dailyCount'), dailyOrders: $('dailyOrders'), nextEdition: $('nextEdition'),
    editionProgress: $('editionProgress'), editionEarnings: $('editionEarnings'), editionTarget: $('editionTarget'),
    currentMultiplier: $('currentMultiplier'), nextMultiplier: $('nextMultiplier'), publishButton: $('publishButton'), fameGain: $('fameGain'),
    fameAvailable: $('fameAvailable'), legacyTree: $('legacyTree'),
    discoveryCount: $('discoveryCount'), discoveries: $('discoveries'), achievementCount: $('achievementCount'),
    archiveMultiplier: $('archiveMultiplier'), archiveFill: $('archiveFill'), archiveCount: $('archiveCount'), archiveNext: $('archiveNext'),
    achievements: $('achievements'), statsLedger: $('statsLedger'), resetGame: $('resetGame'), marketBadge: $('marketBadge'),
    goalsBadge: $('goalsBadge'), toast: $('toast'), toastIcon: $('toastIcon'), toastTitle: $('toastTitle'),
    toastMessage: $('toastMessage'), offlineSheet: $('offlineSheet'), offlineAmount: $('offlineAmount'),
    offlineTime: $('offlineTime'), dismissOffline: $('dismissOffline'), publishSheet: $('publishSheet'),
    publishReward: $('publishReward'), confirmPublish: $('confirmPublish'), cancelPublish: $('cancelPublish')
  };
  let selectedIds = [];
  let activeTab = new URLSearchParams(location.search).get('tab') || sessionStorage.getItem(TAB_KEY) || 'foundry';
  let resetArmed = false;
  let lastSaveAt = 0;
  let lastSlowRender = 0;
  let toastTimer = null;
  let marketAffordance = '';
  let researchAffordance = '';
  let managerAffordance = '';
  let lineAffordance = '';
  let serverAuthoritative = false;
  let serverBusy = false;
  let accountCheckPending = true;
  let actionCounter = 0;
  const cloudClient = cloud.createClient(window.fetch.bind(window));

  function money(value) {
    const amount = Number(value) || 0;
    if (amount >= 1e12) return '$' + (amount / 1e12).toFixed(2) + 't';
    if (amount >= 1e9) return '$' + (amount / 1e9).toFixed(2) + 'b';
    if (amount >= 1e6) return '$' + (amount / 1e6).toFixed(2) + 'm';
    if (amount >= 10000) return '$' + Math.floor(amount).toLocaleString();
    return '$' + amount.toFixed(2);
  }
  function number(value) { return Math.floor(Number(value) || 0).toLocaleString(); }
  function duration(milliseconds) {
    const minutes = Math.max(1, Math.floor(milliseconds / 60000));
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
  }
  function setSaveStatus(mode, text) {
    el.accountStatus.className = `save-status ${mode}`;
    el.accountStatus.querySelector('span').textContent = text;
    if (mode === 'synced' || mode === 'syncing') el.accountStatus.removeAttribute('href');
    else el.accountStatus.href = 'https://wordtycoon.live/auth/discord?returnTo=' + encodeURIComponent('https://wordtycoon.live/word-foundry/');
  }
  function save(force) {
    if (serverAuthoritative) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < 1500) return;
    state.savedAt = now;
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    lastSaveAt = now;
  }
  const initialLocalSave = readSave();
  let restored = core.restoreGame(initialLocalSave, Date.now());
  let state = restored ? restored.state : core.createGame();

  function showToast(title, message, icon = '✓') {
    clearTimeout(toastTimer);
    el.toastIcon.textContent = icon;
    el.toastTitle.textContent = title;
    el.toastMessage.textContent = message;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3400);
  }
  function unlockedText(result) {
    const unlocked = (result.unlocked || []).map(core.achievementById).filter(Boolean);
    if (!unlocked.length) return '';
    return ` Achievement: ${unlocked.map(item => item.name).join(', ')}.`;
  }
  function apply(result, successTitle, successMessage, icon) {
    if (!result) return false;
    state = result.state;
    if (!result.ok) showToast('Not yet', result.message, '!');
    else showToast(successTitle || 'Done', (successMessage || '') + unlockedText(result), icon || '✓');
    render();
    save(true);
    return result.ok;
  }

  function nextActionId() {
    if (window.crypto?.randomUUID) return `wf2:${Date.now()}:${window.crypto.randomUUID()}`;
    actionCounter += 1;
    return `wf2:${Date.now()}:${actionCounter}-${Math.random().toString(36).slice(2)}`;
  }

  async function performAction(type, payload, localAction) {
    if (accountCheckPending) {
      showToast('Opening your foundry', 'Account mode is still being checked.', '…');
      return null;
    }
    if (!serverAuthoritative) return localAction();
    if (serverBusy) {
      showToast('Presses are syncing', 'Wait for the current account action to finish.', '…');
      return null;
    }
    serverBusy = true;
    setSaveStatus('syncing', 'SERVER CHECKING FOUNDRY ACTION…');
    try {
      const recovered = await cloudClient.recover();
      if (recovered) {
        state = recovered.state; selectedIds = []; render();
        setSaveStatus('synced', 'SERVER-VALIDATED · WORD TYCOON ACCOUNT');
        showToast('Previous action recovered', 'Your current foundry is restored. Choose your next action.', '✓');
        return null;
      }
      const result = await cloudClient.act(type, payload, nextActionId());
      setSaveStatus('synced', 'SERVER-VALIDATED · WORD TYCOON ACCOUNT');
      return result;
    } catch (error) {
      setSaveStatus('error', 'SERVER UNAVAILABLE · ACCOUNT PROGRESS PAUSED');
      if (['action-expired', 'action-conflict', 'action-history-full'].includes(error.code)) showToast('Action unavailable', error.message, '!');
      else showToast('Action awaiting confirmation', 'Your action may have reached the server. Reconnect to recover it safely.', '!');
      return null;
    } finally {
      serverBusy = false;
    }
  }
  function showOfflineEarnings(snapshot) {
    if (!snapshot || snapshot.earned < 0.01 || snapshot.elapsed < 10000) return;
    el.offlineAmount.textContent = '+' + money(snapshot.earned);
    const managed = Number(snapshot.autoUpgrades) || 0;
    el.offlineTime.textContent = `Your presses worked for ${duration(snapshot.elapsed)}.${managed ? ` Your manager completed ${managed} line upgrade${managed === 1 ? '' : 's'}.` : ''}`;
    el.offlineSheet.hidden = false;
    el.dismissOffline.focus();
  }
  async function syncAuthoritative(showOffline) {
    if (serverBusy) return;
    serverBusy = true;
    try {
      const remote = await cloudClient.load();
      if (!remote.authenticated || !remote.state) {
        serverAuthoritative = false;
        state = core.createGame(); selectedIds = []; render();
        setSaveStatus('local', 'SIGNED OUT · LOCAL MODE');
        return;
      }
      const recovered = await cloudClient.recover();
      if (recovered) remote.state = recovered.state;
      serverAuthoritative = true;
      state = remote.state;
      render();
      save(true);
      setSaveStatus('synced', 'SERVER-VALIDATED · WORD TYCOON ACCOUNT');
      if (showOffline && remote.offline) showOfflineEarnings({ ...remote.offline, state });
    } catch {
      setSaveStatus('error', 'SERVER UNAVAILABLE · ACCOUNT PROGRESS PAUSED');
    } finally {
      serverBusy = false;
    }
  }

  async function initCloudSave() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      accountCheckPending = false;
      setSaveStatus('local', 'LOCAL PREVIEW · SERVER MODE ON WORDTYCOON.LIVE');
      return;
    }
    setSaveStatus('syncing', 'OPENING YOUR SERVER FOUNDRY…');
    try {
      const remote = await cloudClient.load();
      if (!remote.authenticated) {
        setSaveStatus('local', 'LOCAL MODE · SIGN IN FOR SERVER PROGRESS');
        return;
      }
      if (!remote.state) throw new Error('Missing authoritative state.');
      serverAuthoritative = true;
      const recovered = await cloudClient.recover();
      if (recovered) remote.state = recovered.state;
      serverAuthoritative = true;
      state = remote.state;
      restored = remote.offline ? { ...remote.offline, state } : null;
      selectedIds = [];
      render();
      save(true);
      setSaveStatus('synced', 'SERVER-VALIDATED · WORD TYCOON ACCOUNT');
      showOfflineEarnings(restored);
      showToast('Account foundry loaded', 'Purchases and earnings are now server validated.', '☁');
    } catch {
      setSaveStatus('error', 'SERVER UNAVAILABLE · LOCAL MODE ONLY');
    } finally {
      accountCheckPending = false;
    }
  }
  function navigate(tab) {
    if (!['foundry', 'market', 'research', 'goals'].includes(tab)) tab = 'foundry';
    activeTab = tab;
    sessionStorage.setItem(TAB_KEY, tab);
    for (const screen of document.querySelectorAll('.screen')) {
      const active = screen.dataset.screen === tab;
      screen.hidden = !active;
      screen.classList.toggle('active', active);
    }
    for (const button of document.querySelectorAll('[data-tab]')) {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    }
    el.appScroll.scrollTo({ top: 0, behavior: 'instant' });
    render();
  }
  function selectedTiles() {
    const byId = new Map(state.inventory.map(tile => [tile.id, tile]));
    return selectedIds.map(id => byId.get(id)).filter(Boolean);
  }
  function selectedWord() { return selectedTiles().map(tile => tile.letter).join('').toLowerCase(); }
  function renderHeader() {
    el.cash.textContent = money(state.cash);
    el.income.textContent = money(core.incomePerSecond(state)) + '/s';
    el.editionLabel.textContent = `EDITION ${state.edition}`;
    el.fameLabel.textContent = `${state.fame} FAME`;
  }
  function renderTutorial() {
    const steps = {
      build: state.stats.wordsBuilt > 0,
      earn: state.lifetimeEarnings >= 1,
      buy: state.stats.lettersBought > 0
    };
    let completed = 0;
    for (const item of el.tutorial.querySelectorAll('[data-step]')) {
      const done = Boolean(steps[item.dataset.step]);
      item.classList.toggle('complete', done);
      if (done) completed += 1;
    }
    el.tutorialCount.textContent = `${completed}/3`;
    el.tutorial.classList.toggle('all-complete', completed === 3);
  }
  function renderBrief() {
    const brief = core.getClientBrief(state);
    el.briefName.textContent = brief.name;
    el.briefDescription.textContent = brief.claimed ? `${brief.word.toUpperCase()} delivered. A new brief arrives tomorrow.` : brief.description;
    el.briefReward.textContent = brief.claimed ? 'COMPLETE' : `+${money(brief.reward)}`;
    el.clientBrief.classList.toggle('complete', brief.claimed);
  }
  function renderComposition() {
    const tiles = selectedTiles();
    if (!tiles.length) el.composition.innerHTML = '<p>Tap letters from your type case</p>';
    else el.composition.innerHTML = tiles.map((tile, index) => `<button type="button" data-selected="${index}" aria-label="Remove ${tile.letter}">${tile.letter}<small>×</small></button>`).join('');
    const word = selectedWord();
    const validation = core.validateWord(state, selectedIds);
    el.wordPreview.innerHTML = `<span>${word ? word.toUpperCase() : '—'}</span><small>${money(core.wordIncome(word, state))} / sec</small>`;
    el.buildButton.disabled = !validation.ok;
    el.clearSelection.disabled = !selectedIds.length;
  }
  function renderInventory() {
    const available = core.availableTiles(state);
    const selected = new Set(selectedIds);
    el.availableCount.textContent = `${available.length} tile${available.length === 1 ? '' : 's'}`;
    if (!available.length) {
      el.inventory.innerHTML = '<p class="empty-state">All owned tiles are working. Dismantle a line or buy more.</p>';
      return;
    }
    el.inventory.innerHTML = available.map(tile => `<button type="button" class="letter-tile${selected.has(tile.id) ? ' selected' : ''}" data-tile="${tile.id}" aria-pressed="${selected.has(tile.id)}">${tile.letter}<small>${core.SCRABBLE_VALUE[tile.letter]}</small></button>`).join('');
  }
  function renderLines() {
    const limit = core.lineLimit(state);
    const total = core.incomePerSecond(state);
    const portfolio = core.portfolioBonus(state);
    lineAffordance = state.words.map(line => `${line.id}:${line.level}:${Number(state.cash >= core.lineUpgradeCost(line, state))}`).join('|');
    el.lineCapacity.textContent = `${state.words.length} / ${limit}`;
    el.totalOutput.textContent = money(total) + '/s';
    el.portfolioMultiplier.textContent = `×${portfolio.multiplier.toFixed(2)}`;
    if (!state.words.length) el.portfolioHint.textContent = 'Run different word lengths together to boost every line.';
    else if (portfolio.distinctLengths >= 5) el.portfolioHint.textContent = 'Maximum mix: five word lengths are working together.';
    else el.portfolioHint.textContent = `${portfolio.distinctLengths} word length${portfolio.distinctLengths === 1 ? '' : 's'} active · add a new length for +5%.`;
    if (!state.words.length) {
      el.wordLines.innerHTML = '<div class="empty-floor"><span aria-hidden="true">Aa</span><div><b>The presses are quiet</b><p>Set a word in type and it will earn cash every second.</p></div></div>';
      return;
    }
    el.wordLines.innerHTML = state.words.map(line => {
      const cost = core.lineUpgradeCost(line, state);
      return `<article class="word-line">
      <div class="set-word">${[...line.word.toUpperCase()].map(letter => `<i>${letter}</i>`).join('')}</div>
      <div class="line-meta"><small>LV ${line.level} · OUTPUT</small><strong>${money(core.lineIncome(line, state))}/s</strong>
        <div class="line-actions"><button type="button" class="line-upgrade" data-upgrade-line="${line.id}"${state.cash < cost ? ' disabled' : ''}>UPGRADE ${money(cost)}</button><button type="button" data-dismantle="${line.id}">Dismantle</button></div>
      </div>
    </article>`;
    }).join('');
  }
  function renderMarket() {
    marketAffordance = state.market.map(offer => Number(state.cash >= offer.price)).join('')
      + ':' + Number(state.cash >= core.refreshCost(state)) + ':' + state.market.map(offer => offer.id).join(',');
    el.market.innerHTML = state.market.map(offer => `<button type="button" class="market-card${state.cash < offer.price ? ' unaffordable' : ''}" data-offer="${offer.id}">
      <span class="market-tile">${offer.letter}<small>${core.SCRABBLE_VALUE[offer.letter]}</small></span>
      <b>${money(offer.price)}</b><small>BUY TILE</small>
    </button>`).join('');
    const cost = core.refreshCost(state);
    el.refreshCost.textContent = money(cost);
    el.refreshMarket.disabled = state.cash < cost;
    el.lettersOwned.textContent = state.inventory.length;
    const counts = {};
    for (const tile of state.inventory) counts[tile.letter] = (counts[tile.letter] || 0) + 1;
    el.alphabetInventory.innerHTML = Object.keys(counts).length
      ? Object.entries(counts).sort().map(([letter, count]) => `<span>${letter}<b>×${count}</b></span>`).join('')
      : '<p class="empty-state">No letters owned yet.</p>';
    el.marketBadge.textContent = state.market.length;
  }
  function upgradeValue(upgrade, source = state) {
    const level = source[upgrade.property];
    if (upgrade.id === 'press') return `+${level * 25}% all output`;
    if (upgrade.id === 'rack') return `${core.lineLimit(source)} production lines`;
    if (upgrade.id === 'longform') return `+${level * 18}% long words`;
    if (upgrade.id === 'market') return `${level * 5}% market discount`;
    return `${Math.round(core.offlineCap(source) / 3600000)}h offline cap`;
  }
  function renderResearch() {
    researchAffordance = core.UPGRADES.map(upgrade => Number(state.cash >= core.getUpgradeCost(state, upgrade.id))).join('')
      + ':' + core.UPGRADES.map(upgrade => state[upgrade.property]).join(',');
    const totalLevel = core.UPGRADES.reduce((sum, upgrade) => sum + state[upgrade.property], 0);
    el.researchSpent.textContent = `LEVEL ${totalLevel}`;
    el.upgradeList.innerHTML = core.UPGRADES.map(upgrade => {
      const cost = core.getUpgradeCost(state, upgrade.id);
      return `<button type="button" class="upgrade-card" data-upgrade="${upgrade.id}"${state.cash < cost ? ' disabled' : ''}>
        <span class="upgrade-symbol">${upgrade.icon}</span>
        <span class="upgrade-copy"><b>${upgrade.name}</b><small>${upgrade.description}</small><i>${upgradeValue(upgrade)}</i></span>
        <span class="upgrade-price"><strong>${money(cost)}</strong><small>LV ${state[upgrade.property]}</small></span>
      </button>`;
    }).join('');
  }
  function renderManager() {
    const status = core.pressManagerStatus(state);
    managerAffordance = `${status.level}:${core.availableFame(state)}:${state.stats.managerUpgrades}`;
    el.managerLevel.textContent = status.level ? `LEVEL ${status.level}/${status.maxLevel}` : 'NOT HIRED';
    el.managerName.textContent = status.current ? status.current.name : 'Owner-operated';
    el.managerDescription.textContent = status.current
      ? status.current.description
      : 'Invest Fame to hire a manager who upgrades your cheapest active line—even while you are away.';
    el.managerRecord.textContent = `${number(state.stats.managerUpgrades)} automatic upgrade${state.stats.managerUpgrades === 1 ? '' : 's'} completed`;
    el.hireManager.closest('.manager-card').classList.toggle('maxed', status.maxed);
    el.hireManager.disabled = status.maxed || !status.affordable;
    el.hireManager.innerHTML = status.maxed
      ? '<span>FULLY TRAINED</span><b>MASTERED</b>'
      : `<span>${status.level ? 'TRAIN NEXT TIER' : 'HIRE PERMANENTLY'}</span><b>${status.cost} FAME</b>`;
  }
  function orderIcon(id) { return id === 'letters' ? 'A' : id === 'words' ? 'W' : '$'; }
  function renderOrders() {
    const orders = core.getDailyOrders(state);
    const claimed = orders.filter(order => order.claimed).length;
    el.dailyCount.textContent = `${claimed}/3`;
    el.dailyDate.textContent = `${state.daily.date} · Edmonton`;
    el.dailyOrders.innerHTML = orders.map(order => {
      const percentage = Math.min(100, order.progress / order.target * 100);
      const progress = order.id === 'earnings' ? money(order.progress) : number(order.progress);
      const target = order.id === 'earnings' ? money(order.target) : number(order.target);
      return `<article class="order">
        <div class="order-title"><span>${orderIcon(order.id)}</span><p><b>${order.name}</b><small>${order.description}</small></p></div>
        <div class="order-progress"><span style="width:${percentage}%"></span></div>
        <div class="order-numbers"><span>${progress} / ${target}</span><b>+${money(order.reward)}</b></div>
        <button type="button" data-order="${order.id}"${!order.complete || order.claimed ? ' disabled' : ''}>${order.claimed ? 'CLAIMED' : order.complete ? 'CLAIM' : 'IN PROGRESS'}</button>
      </article>`;
    }).join('');
  }
  function renderPrestige() {
    const preview = core.prestigePreview(state);
    el.nextEdition.textContent = state.edition + 1;
    el.editionProgress.style.width = `${preview.progress * 100}%`;
    el.editionEarnings.textContent = `${money(state.editionEarnings)} earned`;
    el.editionTarget.textContent = preview.ready ? `READY · ${preview.gain} FAME` : `${money(preview.baseTarget)} needed`;
    el.currentMultiplier.textContent = `×${preview.currentMultiplier.toFixed(2)}`;
    el.nextMultiplier.textContent = `×${preview.nextMultiplier.toFixed(2)}`;
    el.fameGain.textContent = `+${Math.max(1, preview.gain)} FAME`;
    el.publishReward.textContent = `+${Math.max(1, preview.gain)} FAME`;
    el.publishButton.disabled = !preview.ready;
  }
  function legacyValue(upgrade, level) {
    if (upgrade.id === 'heritage') return `+${level * 5}% all output`;
    if (upgrade.id === 'typesetters') return `${level * 8}% cheaper line upgrades`;
    if (upgrade.id === 'trade') return `${level * 3}% permanent market discount`;
    if (upgrade.id === 'archive') return `+${level * 2}% per Archive milestone`;
    if (upgrade.id === 'night') return `+${level}h offline capacity`;
    return `+${level} permanent production line${level === 1 ? '' : 's'}`;
  }
  function renderLegacyTree() {
    const available = core.availableFame(state);
    el.fameAvailable.textContent = `${available} AVAILABLE`;
    el.legacyTree.innerHTML = core.LEGACY_UPGRADES.map(upgrade => {
      const status = core.legacyUpgradeStatus(state, upgrade.id);
      const requirement = status.missing.map(item => `${item.name} LV ${item.level}`).join(' + ');
      const classes = `${status.locked ? ' locked' : ''}${status.maxed ? ' maxed' : ''}`;
      const buttonText = status.maxed ? 'MASTERED' : status.locked ? `REQUIRES ${requirement}` : `INVEST ${status.cost} FAME`;
      return `<article class="legacy-node${classes}" data-legacy="${upgrade.id}">
        <span class="legacy-symbol">${upgrade.icon}</span>
        <span class="legacy-copy"><b>${upgrade.name}</b><small>${upgrade.description}</small><i>${legacyValue(upgrade, status.level)}</i></span>
        <button type="button" data-legacy-upgrade="${upgrade.id}"${status.locked || status.maxed || !status.affordable ? ' disabled' : ''}><span>LV ${status.level}/${status.maxLevel}</span><b>${buttonText}</b></button>
      </article>`;
    }).join('');
  }
  function renderCollection() {
    const words = [...state.discoveries].sort((a, b) => b.length - a.length || a.localeCompare(b));
    el.discoveryCount.textContent = number(words.length);
    el.discoveries.innerHTML = words.length ? words.map(word => `<span>${word.toUpperCase()}</span>`).join('')
      : '<p class="empty-state">Your discovered words will appear here.</p>';
  }
  function renderArchive() {
    const progress = core.collectionProgress(state);
    el.archiveMultiplier.textContent = `×${progress.multiplier.toFixed(2)}`;
    el.archiveFill.style.width = `${progress.progress * 100}%`;
    el.archiveCount.textContent = `${number(progress.count)} discover${progress.count === 1 ? 'y' : 'ies'}`;
    el.archiveNext.textContent = progress.nextCount ? `${progress.nextCount} for +5%` : 'MAXIMUM ARCHIVE POWER';
  }
  function renderAchievements() {
    const owned = new Set(state.achievements);
    el.achievementCount.textContent = `${owned.size}/${core.ACHIEVEMENTS.length}`;
    el.achievements.innerHTML = core.ACHIEVEMENTS.map(item => `<article class="achievement${owned.has(item.id) ? ' unlocked' : ''}">
      <span>${owned.has(item.id) ? '★' : '?'}</span><div><b>${item.name}</b><small>${item.description}</small></div><strong>${owned.has(item.id) ? 'DONE' : '+' + money(item.reward)}</strong>
    </article>`).join('');
  }
  function renderStats() {
    const rows = [
      ['Lifetime passive income', money(state.lifetimeEarnings)],
      ['Words built', number(state.stats.wordsBuilt)],
      ['Unique discoveries', number(state.discoveries.length)],
      ['Letters bought', number(state.stats.lettersBought)],
      ['Production-line upgrades', number(state.stats.lineUpgrades)],
      ['Automatic line upgrades', number(state.stats.managerUpgrades)],
      ['Client briefs completed', number(state.stats.briefsCompleted)],
      ['Fame invested', `${number(state.fameSpent)} / ${number(state.fame)}`],
      ['Fame upgrades purchased', number(state.stats.fameUpgradesBought)],
      ['Daily orders claimed', number(state.stats.ordersClaimed)],
      ['Editions published', number(state.stats.editionsPublished)],
      ['Best single word', money(state.stats.bestWordIncome) + '/s'],
      ['Offline capacity', Math.round(core.offlineCap(state) / 3600000) + ' hours']
    ];
    el.statsLedger.innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  }
  function renderBadges() {
    const readyOrder = core.getDailyOrders(state).some(order => order.complete && !order.claimed);
    const readyEdition = core.prestigePreview(state).ready;
    el.goalsBadge.hidden = !readyOrder && !readyEdition;
    el.goalsBadge.textContent = readyOrder && readyEdition ? '2' : '!';
  }
  function render() {
    const availableIds = new Set(core.availableTiles(state).map(tile => tile.id));
    selectedIds = selectedIds.filter(id => availableIds.has(id)).slice(0, core.MAX_WORD_LENGTH);
    renderHeader(); renderTutorial(); renderBrief(); renderComposition(); renderInventory(); renderLines();
    renderMarket(); renderResearch(); renderManager(); renderOrders(); renderPrestige(); renderLegacyTree(); renderCollection(); renderArchive(); renderAchievements(); renderStats(); renderBadges();
  }

  document.querySelector('.bottom-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (button) navigate(button.dataset.tab);
  });
  el.market.addEventListener('click', async event => {
    const button = event.target.closest('[data-offer]');
    if (!button) return;
    const offer = state.market.find(item => item.id === button.dataset.offer);
    if (!offer) return;
    const result = await performAction('buy-letter', { offerId: offer.id }, () => core.buyLetter(state, offer.id));
    if (!result) return;
    if (apply(result, `${offer.letter} purchased`, 'Added to your available type.', offer.letter)) {
      const tile = state.inventory.at(-1);
      if (tile && selectedIds.length < core.MAX_WORD_LENGTH) selectedIds.push(tile.id);
      renderComposition(); renderInventory();
    }
  });
  el.inventory.addEventListener('click', event => {
    const button = event.target.closest('[data-tile]');
    if (!button) return;
    const id = button.dataset.tile;
    const index = selectedIds.indexOf(id);
    if (index >= 0) selectedIds.splice(index, 1);
    else if (selectedIds.length < core.MAX_WORD_LENGTH) selectedIds.push(id);
    else showToast('Typesetter full', 'Words can use at most seven letters.', '!');
    renderComposition(); renderInventory();
  });
  el.composition.addEventListener('click', event => {
    const button = event.target.closest('[data-selected]');
    if (!button) return;
    selectedIds.splice(Number(button.dataset.selected), 1);
    renderComposition(); renderInventory();
  });
  el.clearSelection.addEventListener('click', () => { selectedIds = []; renderComposition(); renderInventory(); });
  el.buildButton.addEventListener('click', async () => {
    const word = selectedWord().toUpperCase();
    const tileIds = [...selectedIds];
    const result = await performAction('build-word', { tileIds }, () => core.buildWord(state, tileIds));
    if (!result) return;
    const bonus = result.discoveryBonus ? ` New discovery bonus: +${money(result.discoveryBonus)}.` : '';
    const brief = result.briefBonus ? ` Client brief: +${money(result.briefBonus)}.` : '';
    const archive = result.milestone ? ` Archive Power is now ×${result.milestone.multiplier.toFixed(2)}.` : '';
    if (apply(result, `${word} is working`, `${money(result.ok ? core.lineIncome(result.line, result.state) : 0)}/s added.${bonus}${brief}${archive}`, 'W')) selectedIds = [];
    render();
  });
  el.wordLines.addEventListener('click', async event => {
    const upgradeButton = event.target.closest('[data-upgrade-line]');
    if (upgradeButton) {
      const line = state.words.find(item => item.id === upgradeButton.dataset.upgradeLine);
      if (!line) return;
      const result = await performAction('upgrade-line', { lineId: line.id }, () => core.upgradeLine(state, line.id));
      if (!result) return;
      apply(result, `${line.word.toUpperCase()} upgraded`, result.ok ? `Level ${result.line.level} now earns ${money(core.lineIncome(result.line, result.state))}/s.` : '', '↗');
      return;
    }
    const button = event.target.closest('[data-dismantle]');
    if (!button) return;
    const line = state.words.find(item => item.id === button.dataset.dismantle);
    if (!line) return;
    const result = await performAction('dismantle-word', { lineId: line.id }, () => core.dismantleWord(state, line.id));
    if (result && apply(result, `${line.word.toUpperCase()} dismantled`, 'Its tiles are available again.', '↩')) selectedIds = [];
  });
  el.refreshMarket.addEventListener('click', async () => {
    const result = await performAction('refresh-market', {}, () => core.refreshMarket(state));
    if (result) apply(result, 'Fresh crate opened', 'Six new offers are ready.', 'A');
  });
  el.upgradeList.addEventListener('click', async event => {
    const button = event.target.closest('[data-upgrade]');
    if (!button) return;
    const upgrade = core.UPGRADES.find(item => item.id === button.dataset.upgrade);
    if (upgrade) {
      const result = await performAction('buy-research', { upgradeId: upgrade.id }, () => core.buyUpgrade(state, upgrade.id));
      if (!result) return;
      apply(result, `${upgrade.name} upgraded`, result.ok ? upgradeValue(upgrade, result.state) : '', upgrade.icon);
    }
  });
  el.hireManager.addEventListener('click', async () => {
    const result = await performAction('hire-manager', {}, () => core.hirePressManager(state));
    if (!result) return;
    apply(result, result.ok ? `${result.manager.name} hired` : '', result.ok ? `${result.manager.description} ${core.availableFame(result.state)} Fame remains available.` : '', 'M');
  });
  el.dailyOrders.addEventListener('click', async event => {
    const button = event.target.closest('[data-order]');
    if (!button) return;
    const orderId = button.dataset.order;
    const result = await performAction('claim-order', { orderId }, () => core.claimDailyOrder(state, orderId));
    if (!result) return;
    apply(result, 'Order delivered', result.ok ? `Collected ${money(result.reward)}.` : '', '$');
  });
  el.legacyTree.addEventListener('click', async event => {
    const button = event.target.closest('[data-legacy-upgrade]');
    if (!button) return;
    const upgrade = core.LEGACY_UPGRADES.find(item => item.id === button.dataset.legacyUpgrade);
    if (!upgrade) return;
    const result = await performAction('buy-legacy', { upgradeId: upgrade.id }, () => core.buyLegacyUpgrade(state, upgrade.id));
    if (!result) return;
    apply(result, `${upgrade.name} advanced`, result.ok ? `${legacyValue(upgrade, result.level)} · ${core.availableFame(result.state)} Fame available.` : '', upgrade.icon);
  });
  el.publishButton.addEventListener('click', () => { el.publishSheet.hidden = false; el.confirmPublish.focus(); });
  el.cancelPublish.addEventListener('click', () => { el.publishSheet.hidden = true; el.publishButton.focus(); });
  el.confirmPublish.addEventListener('click', async () => {
    const result = await performAction('publish-edition', {}, () => core.publishEdition(state));
    if (!result) return;
    if (result.ok) {
      el.publishSheet.hidden = true;
      selectedIds = [];
      apply(result, `Edition ${result.state.edition} begins`, `Permanent Fame increased by ${result.gain}.`, '★');
      navigate('foundry');
    } else apply(result);
  });
  el.dismissOffline.addEventListener('click', () => { el.offlineSheet.hidden = true; });
  el.resetGame.addEventListener('click', async () => {
    if (!resetArmed) {
      resetArmed = true;
      el.resetGame.textContent = 'Tap again to erase all progress';
      setTimeout(() => { resetArmed = false; el.resetGame.textContent = 'Reset prototype'; }, 4000);
      return;
    }
    const result = await performAction('reset', {}, () => ({ ok: true, state: core.createGame(), unlocked: [] }));
    if (!result) return;
    if (!serverAuthoritative) localStorage.removeItem(SAVE_KEY);
    state = result.state;
    selectedIds = [];
    resetArmed = false;
    el.resetGame.textContent = 'Reset prototype';
    showToast('New foundry started', 'All prototype progress was cleared.', '↻');
    navigate('foundry'); save(true);
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (/^[a-z]$/i.test(event.key) && activeTab === 'foundry') {
      const letter = event.key.toUpperCase();
      const selected = new Set(selectedIds);
      const tile = core.availableTiles(state).find(candidate => candidate.letter === letter && !selected.has(candidate.id));
      if (tile && selectedIds.length < core.MAX_WORD_LENGTH) { event.preventDefault(); selectedIds.push(tile.id); renderComposition(); renderInventory(); }
    } else if (event.key === 'Backspace' && selectedIds.length) {
      event.preventDefault(); selectedIds.pop(); renderComposition(); renderInventory();
    } else if (event.key === 'Enter' && activeTab === 'foundry' && !el.buildButton.disabled) { event.preventDefault(); el.buildButton.click(); }
    else if (event.key === 'Escape') {
      if (!el.publishSheet.hidden) el.cancelPublish.click();
      else if (!el.offlineSheet.hidden) el.dismissOffline.click();
      else if (selectedIds.length) { selectedIds = []; renderComposition(); renderInventory(); }
    }
  });

  setInterval(() => {
    const before = Math.floor(state.cash * 100);
    state = core.accrue(state, Date.now()).state;
    if (Math.floor(state.cash * 100) !== before) renderHeader();
    const now = Date.now();
    if (now - lastSlowRender > 1000) {
      renderTutorial();
      const nextMarketAffordance = state.market.map(offer => Number(state.cash >= offer.price)).join('')
        + ':' + Number(state.cash >= core.refreshCost(state)) + ':' + state.market.map(offer => offer.id).join(',');
      const nextResearchAffordance = core.UPGRADES.map(upgrade => Number(state.cash >= core.getUpgradeCost(state, upgrade.id))).join('')
        + ':' + core.UPGRADES.map(upgrade => state[upgrade.property]).join(',');
      const manager = core.pressManagerStatus(state);
      const nextManagerAffordance = `${manager.level}:${core.availableFame(state)}:${state.stats.managerUpgrades}`;
      const nextLineAffordance = state.words.map(line => `${line.id}:${line.level}:${Number(state.cash >= core.lineUpgradeCost(line, state))}`).join('|');
      if (nextMarketAffordance !== marketAffordance) renderMarket();
      if (nextResearchAffordance !== researchAffordance) renderResearch();
      if (nextManagerAffordance !== managerAffordance) renderManager();
      if (nextLineAffordance !== lineAffordance) renderLines();
      if (activeTab === 'goals') { renderOrders(); renderPrestige(); renderStats(); }
      renderBadges();
      lastSlowRender = now;
    }
    save(false);
  }, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && serverAuthoritative) {
      syncAuthoritative(true);
      return;
    }
    state = core.accrue(state, Date.now()).state;
    save(true); render();
  });
  window.addEventListener('pagehide', () => {
    state = core.accrue(state, Date.now()).state;
    save(true);
  });

  setInterval(() => { if (serverAuthoritative) syncAuthoritative(false); }, 15000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('service-worker.js?v=9').catch(() => {});
  }
  render();
  navigate(activeTab);
  save(true);
  showOfflineEarnings(restored);
  initCloudSave();
})();
