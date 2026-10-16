// Presentation-only enhancement, shared by current and rebuilt clients.
// No socket events, account changes, or game state writes.
(() => {
  'use strict';
  document.documentElement.classList.add('subtextle-neon');

  let layoutFrame = 0;
  function refreshLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('subtextle-header-layout-change'));
    });
  }

  function button(className, label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    return el;
  }

  function disclosure(trigger, panel) {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panel.id);
    panel.hidden = true;
    trigger.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
    });
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    });
  }

  function compactHeader(root) {
    const header = root.querySelector('.header-bar');
    if (!header || header.classList.contains('neon-header-compact')) return null;
    const oldRow = header.querySelector('.header-bar-row');
    const slots = header.querySelector('.header-slots');
    const stats = header.querySelector('.header-stats');
    const toolbar = header.querySelector('.header-url-row');
    const drawer = header.querySelector('.stats-drawer');
    const statsToggle = header.querySelector('.stats-toggle');
    const url = header.querySelector('.header-url-band');
    const promo = header.querySelector('.header-ad-slot');
    if (!oldRow || !slots || !stats || !toolbar || !drawer || !url || !promo) return null;

    // Let the existing component clear its saved minimized state. The new
    // compact header keeps the essential controls visible all the time.
    if (header.classList.contains('is-minimised')) header.querySelector('.header-minimize-toggle')?.click();
    header.classList.add('neon-header-compact');
    header.classList.toggle('mode-sp', !!window.__SP_MODE);

    const room = document.createElement('div');
    room.className = 'neon-room-controls';
    const streamers = header.querySelector('.header-streamers');
    if (streamers) room.appendChild(streamers);
    const join = button('neon-room-name', 'Join link');
    join.setAttribute('aria-label', 'Show the room join link');
    room.appendChild(join);
    toolbar.prepend(room);

    const joinPanel = document.createElement('div');
    joinPanel.id = 'neon-join-panel';
    joinPanel.className = 'neon-join-panel';
    const link = document.createElement('input');
    link.className = 'neon-join-link';
    link.type = 'text';
    link.readOnly = true;
    link.setAttribute('aria-label', 'Room join link');
    const copy = button('neon-copy-link', 'Copy link');
    const status = document.createElement('span');
    status.className = 'neon-copy-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    joinPanel.append(link, copy, status);
    header.appendChild(joinPanel);
    disclosure(join, joinPanel);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link.value);
        status.textContent = 'Link copied';
      } catch (_) {
        link.focus();
        link.select();
        status.textContent = 'Select and copy this link';
      }
    });

    const round = document.createElement('div');
    round.className = 'neon-round-row';
    round.appendChild(stats);
    header.insertBefore(round, oldRow);
    header.insertBefore(toolbar, round);

    const footer = document.createElement('div');
    footer.className = 'neon-header-footer';
    const last = document.createElement('span');
    last.className = 'neon-last-result';
    const details = button('neon-details-toggle', 'Details & stats ▾');
    details.setAttribute('aria-expanded', 'false');
    drawer.id = 'neon-results-drawer';
    drawer.tabIndex = 0;
    drawer.setAttribute('role', 'region');
    drawer.setAttribute('aria-label', 'Previous round and game statistics');
    // The game handles wheel/touch gestures at document level. Keep those
    // handlers from swallowing native scrolling inside the results drawer.
    for (const type of ['wheel', 'touchstart', 'touchmove', 'touchend']) {
      drawer.addEventListener(type, event => event.stopPropagation(), { passive: true });
    }
    details.setAttribute('aria-controls', drawer.id);
    details.addEventListener('click', () => statsToggle?.click());
    drawer.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drawer.classList.contains('open')) {
        details.click();
        details.focus();
      }
    });
    const beta = button('neon-beta-toggle', 'Android beta ▸');
    promo.id = 'neon-beta-panel';
    promo.setAttribute('role', 'region');
    promo.setAttribute('aria-label', 'Android app beta testing');
    promo.tabIndex = 0;
    disclosure(beta, promo);
    beta.addEventListener('click', refreshLayout);
    promo.addEventListener('keydown', event => {
      if (event.key === 'Escape') refreshLayout();
    });
    footer.append(last, details, beta);
    header.insertBefore(footer, oldRow);
    // Reserve header space instead of floating beneath other scene objects.
    header.insertBefore(promo, oldRow);

    const resultsHeading = document.createElement('div');
    resultsHeading.className = 'neon-results-heading';
    resultsHeading.textContent = 'Previous round';
    slots.prepend(resultsHeading);
    drawer.prepend(slots);

    const drawerBounds = () => {
      const rect = header.getBoundingClientRect();
      const scale = rect.width / header.offsetWidth || 1;
      const height = Math.max(300, Math.min(2400, (window.innerHeight - rect.bottom - 24) / scale));
      header.style.setProperty('--neon-drawer-height', height + 'px');
    };
    window.addEventListener('resize', drawerBounds);
    window.addEventListener('subtextle-header-layout-change', drawerBounds);
    drawerBounds();

    const sync = () => {
      const raw = url.textContent.trim();
      const match = /^www\.subtextle\.com(?:\/([a-z0-9_-]{1,32}))?$/i.exec(raw);
      const handle = match && match[1];
      join.textContent = handle || 'Join link';
      join.setAttribute('aria-label', handle ? 'Show join link for ' + handle : 'Show the room join link');
      join.title = handle ? 'Join ' + handle : 'Show the room join link';
      link.value = match ? 'https://subtextle.com' + (handle ? '/' + handle : '/') : 'https://subtextle.com/';
      const combined = slots.querySelector('.header-combined-card:not(.hidden)');
      const target = slots.querySelector('.header-slot[data-slot-index="0"]');
      const name = combined ? combined.querySelector('.header-combined-name') : target?.querySelector('.header-slot-name');
      const word = combined ? combined.querySelector('.header-combined-pill.target') : target?.querySelector('.header-slot-label');
      const text = name?.textContent.trim();
      const hasWinner = combined || (target && !target.classList.contains('is-empty'));
      const summary = hasWinner && text ? 'Last round · ' + text + ' · ' + (word?.textContent.trim() || '') : 'Last round · Waiting for results';
      if (last.textContent !== summary) last.textContent = summary;
      last.title = summary;
      const open = drawer.classList.contains('open');
      details.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      drawer.inert = !open;
      const theme = document.querySelector('.drawer-theme-btn');
      if (open && theme) theme.style.top = (header.getBoundingClientRect().bottom + 8) + 'px';
    };
    const drawerObserver = new MutationObserver(sync);
    drawerObserver.observe(drawer, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pagehide', () => drawerObserver.disconnect(), { once: true });
    sync();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(refreshLayout);
      observer.observe(header);
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    refreshLayout();
    return { header, sync };
  }

  function compactPodium(root) {
    const podium = root.querySelector('.podium-row');
    if (!podium || podium.classList.contains('neon-podium-compact')) return;
    podium.classList.add('neon-podium-compact');
    const label = podium.querySelector('.podium-current-label');
    const text = label?.querySelector('.podium-current-text');
    if (text) text.textContent = 'Current leaders';
    const extra = document.createElement('div');
    extra.className = 'neon-podium-extra';
    extra.id = 'neon-all-players';
    podium.querySelectorAll('.podium-slot-compact').forEach(slot => extra.appendChild(slot));
    podium.appendChild(extra);
    const toggle = button('neon-players-toggle', 'All players ▾');
    podium.appendChild(toggle);
    disclosure(toggle, extra);
    toggle.addEventListener('click', refreshLayout);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(refreshLayout);
      observer.observe(podium);
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    refreshLayout();
  }

  function replacePromo(root) {
    const slot = root.querySelector('.header-ad-slot');
    if (!slot || slot.querySelector('.android-beta-card')) return;
    const card = document.createElement('div');
    card.className = 'android-beta-card';
    card.innerHTML = `
      <svg class="android-beta-icon" viewBox="0 0 64 48" aria-hidden="true">
        <path d="M13 9 8 1M51 9l5-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <path d="M5 35a27 27 0 0 1 54 0v7H5Z" fill="currentColor"/>
        <circle cx="20" cy="26" r="2.5" fill="#05242b"/><circle cx="44" cy="26" r="2.5" fill="#05242b"/>
      </svg>
      <p class="android-beta-copy"><span>Become a </span><strong>Beta Tester</strong><span> for the Android App</span></p>`;
    slot.replaceChildren(card);
  }

  // Heat is decorative. Derive it from the displayed rank so rank changes,
  // virtualized rows, and the pinned guess all receive the same treatment.
  function decorateEntry(entry) {
    const label = entry.querySelector('.guess-rank');
    if (!label) return;
    const text = label.textContent.trim();
    if (entry.dataset.neonRank === text) return;
    entry.dataset.neonRank = text;
    const rank = Number(text.replace(/[, +]/g, ''));
    const valid = Number.isFinite(rank) && rank > 0;
    const hue = valid ? (rank <= 1000 ? 120 - rank / 50 : Math.max(0, 120 * (1 - Math.log10(rank) / 5))) : 0;
    entry.style.setProperty('--ui-heat', `hsl(${hue.toFixed(1)} 95% 55%)`);
    entry.classList.toggle('neon-close', valid && rank <= 1000);
  }

  function watchGame(root) {
    replacePromo(root);
    const compact = compactHeader(root);
    compactPodium(root);
    root.querySelectorAll('.guess-entry').forEach(decorateEntry);
    const observer = new MutationObserver(records => {
      const entries = new Set();
      let headerChanged = false;
      for (const record of records) {
        const parent = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (parent && parent.closest('.header-slots, .header-url-band')) headerChanged = true;
        const entry = parent && parent.closest('.guess-entry');
        if (entry) entries.add(entry);
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches('.guess-entry')) entries.add(node);
          node.querySelectorAll('.guess-entry').forEach(el => entries.add(el));
        }
      }
      entries.forEach(decorateEntry);
      if (headerChanged && compact) compact.sync();
      if (!root.querySelector('.neon-podium-compact') && root.querySelector('.podium-row')) compactPodium(root);
    });
    // Observe structural/text updates only, never animation style updates.
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  function start() {
    const root = document.getElementById('dom-ui-container');
    if (root && root.querySelector('.header-ad-slot')) {
      watchGame(root);
      return true;
    }
    return false;
  }
  if (!start()) {
    const boot = new MutationObserver(() => {
      if (start()) boot.disconnect();
    });
    boot.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => boot.disconnect(), { once: true });
  }
})();
