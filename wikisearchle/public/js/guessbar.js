// WikiWordGuessBar — shared guess bar component for WikiWord + WikiSearchle
// game pages. Fixed-bottom input + ENTER with optional custom QWERTY keyboard
// for touch devices. Same layout/interaction pattern as Searchle's play.html,
// restyled for the WikiWord palette.
//
// Usage:
//   WikiWordGuessBar.mount({
//     onSubmit: (word, nickname) => void,     // required
//     nicknameKey: 'wikiword_nickname',        // localStorage key
//     placeholder: 'Type a word to guess…',
//   });
//
// Exposes:
//   WikiWordGuessBar.setEnabled(bool)   — greys out input/button
//   WikiWordGuessBar.clear()            — clear input
//   WikiWordGuessBar.focus()            — focus the word input

(function (global) {
  'use strict';

  const KB_ROWS = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M'],
    ['BACK','SPACE','ENTER'],
  ];

  let opts = {};
  let nickInput, wordInput, btn, kbToggle, kbShell, kbRoot, bar;
  let customKbOn = false;
  let isTouch = false;
  let refocusOnEnable = false;
  let activeUser = null;
  let guestChipActive = false;

  function detectTouch() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return coarse || mobile;
  }

  // Resolve a profile-pic URL from a wt_user blob. Tries the normalized
  // profilePic/avatarUrl fields first, then falls back to constructing a
  // Discord CDN URL from (id, avatar hash).
  function getProfilePicUrl(user) {
    if (!user || typeof user !== 'object') return null;
    if (user.profilePic) return user.profilePic;
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (typeof user.avatar === 'string' && user.avatar.startsWith('http')) return user.avatar;
    if (typeof user.avatar === 'string' && user.id && /^[a-f0-9_]+$/i.test(user.avatar)) {
      return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    }
    return null;
  }

  function mount(userOpts) {
    opts = Object.assign({
      onSubmit: () => {},
      nicknameKey: 'wikiword_nickname',
      placeholder: 'Type a word to guess…',
      guestChipLabel: '',
      guestChipTitle: '',
      guestSubmitNickname: 'web guest',
      onGuestChipClick: null,
    }, userOpts || {});

    if (document.getElementById('wwgb-root')) return;

    isTouch = detectTouch();
    if (isTouch) document.body.classList.add('wwgb-touch');

    const root = document.createElement('div');
    root.id = 'wwgb-root';
    root.innerHTML = `
      <div id="wwgb-bar">
        <div id="wwgb-inner">
          <img id="wwgb-avatar" alt="" style="display:none;width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.25);flex-shrink:0;">
          <input id="wwgb-nick" type="text" maxlength="16" autocomplete="off" placeholder="NICK">
          <div id="wwgb-input-wrap">
            <input id="wwgb-input" type="search" inputmode="search" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" name="wwgb-guess-q" aria-autocomplete="none">
            <svg class="wwgb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <button id="wwgb-kb-toggle" type="button" title="Toggle on-screen keyboard" aria-label="Toggle keyboard">⌨</button>
          <button id="wwgb-btn" type="button">ENTER</button>
        </div>
      </div>
      <div id="wwgb-kb" aria-hidden="true"><div id="wwgb-kb-shell"></div></div>
    `;
    document.body.appendChild(root);
    document.body.classList.add('wwgb-mounted');

    bar = document.getElementById('wwgb-bar');
    nickInput = document.getElementById('wwgb-nick');
    wordInput = document.getElementById('wwgb-input');
    btn = document.getElementById('wwgb-btn');
    kbToggle = document.getElementById('wwgb-kb-toggle');
    kbShell = document.getElementById('wwgb-kb-shell');
    kbRoot = document.getElementById('wwgb-kb');

    wordInput.placeholder = opts.placeholder;

    // Logged-in avatar swap: when the cross-domain auth handoff cached a
    // wt_user in localStorage, replace the text nickname with the user's
    // profile picture. The nickname input stays in the DOM (hidden) so
    // submit() can still read its value — we pin it to the user's name.
    const wtUser = (() => {
      try { return JSON.parse(localStorage.getItem('wt_user') || 'null'); } catch (e) { return null; }
    })();
    activeUser = wtUser;
    const picUrl = getProfilePicUrl(wtUser);
    if (picUrl) {
      const avatarEl = document.getElementById('wwgb-avatar');
      avatarEl.src = picUrl;
      avatarEl.alt = wtUser.displayName || wtUser.username || 'you';
      avatarEl.title = wtUser.displayName || wtUser.username || '';
      avatarEl.style.display = 'block';
      nickInput.style.display = 'none';
      const pinnedNick = (wtUser.displayName || wtUser.global_name || wtUser.username || 'player').trim().slice(0, 16) || 'player';
      nickInput.value = pinnedNick;
      try { localStorage.setItem(opts.nicknameKey, pinnedNick); } catch (e) {}
      // Expose the resolved pic URL so the page's submit handler can include
      // it in the outgoing guess — the server echoes it back on chip events
      // so the ticker can render the guesser's avatar next to their word.
      window._wtUserPicUrl = picUrl;
    } else if (opts.guestChipLabel) {
      guestChipActive = true;
      nickInput.value = opts.guestChipLabel;
      nickInput.readOnly = true;
      nickInput.classList.add('guest-chip');
      nickInput.setAttribute('aria-label', opts.guestChipTitle || opts.guestChipLabel);
      nickInput.title = opts.guestChipTitle || opts.guestChipLabel;
      nickInput.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof opts.onGuestChipClick === 'function') opts.onGuestChipClick();
      });
      nickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (typeof opts.onGuestChipClick === 'function') opts.onGuestChipClick();
        }
      });
    } else {
      // Nickname persistence
      const savedNick = (() => {
        try { return localStorage.getItem(opts.nicknameKey); } catch (e) { return null; }
      })();
      nickInput.value = savedNick && savedNick.trim() ? savedNick : 'web';
      nickInput.addEventListener('blur', () => {
        const v = nickInput.value.trim().slice(0, 16) || 'web';
        nickInput.value = v;
        try { localStorage.setItem(opts.nicknameKey, v); } catch (e) {}
      });
    }

    btn.addEventListener('click', submit);
    wordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    kbToggle.addEventListener('click', () => setCustomKb(!customKbOn));

    renderCustomKb();
    installScrollLock();
  }

  // Searchle-style scroll lock: when the guess input gets focus on a touch
  // device, the mobile keyboard tries to scroll the page so the input sits
  // above the keyboard. Since the input is already fixed at the bottom of
  // the visual viewport, any such scroll just pushes the game off-screen.
  //
  // Fix: if the page uses a `.scroll-wrap` container (Searchle / WikiSearchle
  // pattern), toggle its overflow to hidden while the input is focused, and
  // listen to visualViewport.scroll to snap scrollTop back to 0 whenever the
  // keyboard shifts the visual viewport. No-op on pages without a scroll-wrap.
  function installScrollLock() {
    const scrollWrap = document.querySelector('.scroll-wrap');
    if (!scrollWrap || !wordInput) return;

    // Reset every possible scroll target. iOS Safari sometimes scrolls the
    // document element or body instead of the scroll-wrap, so hit all of them.
    function resetAllScroll() {
      scrollWrap.scrollTop = 0;
      try { window.scrollTo(0, 0); } catch (e) {}
      try { document.documentElement.scrollTop = 0; } catch (e) {}
      try { document.body.scrollTop = 0; } catch (e) {}
    }

    // iOS triggers its "scroll focused input into view" AFTER the focus event
    // fires, so a single reset in the focus handler loses the race. We reset
    // on the capture-phase focusin (fires before iOS's default scroll) and
    // again at staggered delays to catch iOS's late scroll-into-view.
    function handleFocus() {
      scrollWrap.classList.add('kb-open');
      resetAllScroll();
      setTimeout(resetAllScroll, 0);
      setTimeout(resetAllScroll, 50);
      setTimeout(resetAllScroll, 200);
      setTimeout(resetAllScroll, 500);
    }
    function handleBlur() {
      scrollWrap.classList.remove('kb-open');
    }

    // Capture phase on document — fires before the element-level focus and
    // before iOS applies its default scroll behavior.
    document.addEventListener('focusin', (e) => {
      if (e.target === wordInput) handleFocus();
    }, true);
    document.addEventListener('focusout', (e) => {
      if (e.target === wordInput) handleBlur();
    }, true);

    if (window.visualViewport) {
      // visualViewport scroll fires when the mobile keyboard shifts the view.
      window.visualViewport.addEventListener('scroll', () => {
        if (window.visualViewport.offsetTop > 0) resetAllScroll();
      });
      // visualViewport resize fires when the keyboard opens/closes — this is
      // when iOS does its scroll-into-view, so reset aggressively here too.
      window.visualViewport.addEventListener('resize', () => {
        if (document.activeElement === wordInput) resetAllScroll();
      });
    }
  }

  function submit() {
    const word = (wordInput.value || '').trim();
    if (!word) return;
    const fallbackNick = guestChipActive ? opts.guestSubmitNickname : 'web guest';
    const nickname = (nickInput.value || fallbackNick).trim() || fallbackNick;
    opts.onSubmit(word, nickname, {
      isAuthenticated: !!activeUser,
      guestChipActive,
    });
    wordInput.value = '';
    if (customKbOn) wordInput.focus({ preventScroll: true });
  }

  function setCustomKb(on) {
    customKbOn = on;
    kbRoot.classList.toggle('visible', on);
    kbToggle.classList.toggle('active', on);
    bar.classList.toggle('kb-mode', on);
    document.body.classList.toggle('wwgb-kb-open', on);
    if (on) {
      // Prevent the native keyboard from appearing.
      wordInput.setAttribute('readonly', 'readonly');
      wordInput.blur();
    } else {
      wordInput.removeAttribute('readonly');
    }
  }

  function renderCustomKb() {
    kbShell.innerHTML = '';
    KB_ROWS.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'wwgb-kb-row';
      row.forEach((key) => {
        const k = document.createElement('button');
        k.type = 'button';
        k.className = 'wwgb-kb-key';
        let label = key;
        if (key === 'ENTER') { k.classList.add('wide', 'enter'); label = 'GO'; }
        else if (key === 'BACK') { k.classList.add('wide', 'backspace'); label = '⌫'; }
        else if (key === 'SPACE') { k.classList.add('wide', 'space'); label = '␣'; }
        k.textContent = label;
        k.setAttribute('data-key', key);
        k.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') return;
          e.preventDefault();
          k._handled = Date.now();
          handleKey(key);
        });
        k.addEventListener('click', (e) => {
          if (k._handled && Date.now() - k._handled < 400) { e.preventDefault(); return; }
          handleKey(key);
        });
        rowEl.appendChild(k);
      });
      kbShell.appendChild(rowEl);
    });
  }

  function handleKey(key) {
    if (key === 'ENTER') { submit(); return; }
    if (key === 'BACK') { wordInput.value = wordInput.value.slice(0, -1); return; }
    if (key === 'SPACE') { wordInput.value += ' '; return; }
    wordInput.value += key.toLowerCase();
  }

  function setEnabled(enabled) {
    if (!wordInput) return;
    if (!enabled) {
      // Disabling a focused input drops focus for good — remember whether the
      // player was on the guess bar so re-enable can hand focus back and they
      // can keep typing without re-clicking the box.
      const ae = document.activeElement;
      refocusOnEnable = ae === wordInput || ae === btn;
    }
    wordInput.disabled = !enabled;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '' : '0.5';
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    if (enabled && refocusOnEnable) {
      refocusOnEnable = false;
      if (!customKbOn) wordInput.focus({ preventScroll: true });
    }
  }

  function clear() { if (wordInput) wordInput.value = ''; }
  function focus() { if (wordInput && !customKbOn) wordInput.focus({ preventScroll: true }); }

  global.WikiWordGuessBar = { mount, setEnabled, clear, focus };
})(typeof window !== 'undefined' ? window : this);
