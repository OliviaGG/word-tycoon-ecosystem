/* ════════════════════════════════════════════════════════════════════
   TOON TOWER — concierge script
   Elevator · doors · ticker · day/night · walkers · butlers · slots ·
   trading · rooftop sky · secrets (there are at least eight)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return reducedMq.matches; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  // Defer non-critical API work until the browser is idle (or at least past first paint).
  function defer(fn) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 3000 });
    else setTimeout(fn, 50);
  }
  function icon(name) { return '<svg class="icon" aria-hidden="true"><use href="/portal/img/icons.svg?v=1#icon-' + name + '"/></svg>'; }
  var EMOJI_MAP = {
    '🌙': 'moon', '☀️': 'sun', '🪙': 'coin', '✨': 'sparkle', '💥': 'boom', '✦': 'sparkle',
    '🛩️': 'plane', '🕹️': 'joystick', '🏆': 'trophy', '💰': 'moneybag', '📅': 'calendar',
    '🔥': 'fire', '🏢': 'building', '📈': 'chart-line', '💎': 'gem', '🎁': 'gift',
    '🎮': 'gamepad', '🌠': 'shooting-star', '🎩': 'tophat', '🐐': 'goat', '🛎️': 'bell',
    '👋': 'wave', '⚡': 'lightning', '👀': 'eyes', '🏙': 'city'
  };
  function iconify(str) {
    return str.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+/gu, function (ch) { return EMOJI_MAP[ch] ? icon(EMOJI_MAP[ch]) : ch; });
  }
  var body = document.body;
  var lobby = $('#lobby');

  /* ── toast system ─────────────────────────────────────────────────── */
  var toastBox = $('#toasts');
  function toast(msg) {
    if (!toastBox) return;
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = iconify(msg);
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.removeChild(toastBox.firstChild);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 400);
    }, 2800);
  }

  /* ── WebAudio concierge bell (armed by first user gesture only) ───── */
  var AC = null, audioArmed = false;
  function armAudio() { audioArmed = true; }
  window.addEventListener('pointerdown', armAudio, { once: true });
  window.addEventListener('keydown', armAudio, { once: true });
  function ctx() {
    if (!audioArmed) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, t0, dur, gainPeak, type) {
    var ac = ctx(); if (!ac) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ac.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(gainPeak, ac.currentTime + t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.05);
  }
  function ding() { tone(1318.5, 0, 0.5, 0.08); tone(1046.5, 0.13, 0.7, 0.07); }       // E6 → C6, hotel bell
  function knockSound() { tone(180, 0, 0.09, 0.12, 'triangle'); }
  function jackpotFanfare() { [659, 784, 988, 1319].forEach(function (f, i) { tone(f, i * 0.09, 0.35, 0.07); }); }
  function coinTink() { tone(1975, 0, 0.18, 0.05); }

  /* ── keep --cw in sync so walkers + clouds span the real width ────── */
  function sizeVars() {
    if (!lobby) return;
    lobby.style.setProperty('--cw', lobby.clientWidth + 'px');
  }
  sizeVars();
  window.addEventListener('resize', sizeVars);

  /* ── stars: lobby sky + rooftop sky ───────────────────────────────── */
  function makeStars(wrap, n, maxTop) {
    if (!wrap) return;
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'star';
      s.style.left = rand(1, 99) + '%';
      s.style.top = rand(2, maxTop) + '%';
      s.style.setProperty('--sd', rand(0, 3).toFixed(2) + 's');
      if (Math.random() < .3) { s.style.width = '2px'; s.style.height = '2px'; }
      wrap.appendChild(s);
    }
  }
  makeStars($('#lobbyStars'), 30, 80);
  makeStars($('#roofStars'), 42, 92);

  /* ── neighbor-tower windows (random flicker + dim-at-night) ───────── */
  $$('.win-grid').forEach(function (grid) {
    var n = parseInt(grid.getAttribute('data-wins') || '6', 10);
    for (var i = 0; i < n; i++) {
      var w = document.createElement('span');
      w.className = 'win';
      if (Math.random() < .22) w.classList.add('dim');           // stays dark at night
      else if (Math.random() < .3) {                              // occasionally flickers
        w.classList.add('flick');
        w.style.setProperty('--fd', rand(0, 6).toFixed(2) + 's');
      }
      grid.appendChild(w);
    }
  });

  /* ── day / night: two synced toggles (lobby sky + rooftop) ──────────
     The class itself is restored by the inline snippet at the top of
     <body>; WTToon persists it so every floor opens at the same time of
     day. `silent` skips the toast when we're only syncing UI to a state
     the visitor chose on another page. */
  var skyToggles = [$('#skyToggleHero'), $('#skyToggleRoof')].filter(Boolean);
  function setNight(night, silent) {
    if (window.WTToon) window.WTToon.setNight(night);
    else body.classList.toggle('night', night);   // toon.js failed to load
    skyToggles.forEach(function (b) { b.setAttribute('aria-pressed', night ? 'true' : 'false'); });
    if (!silent) toast(iconify(night ? '🌙 The tower glows. The walkers went home.' : '☀️ Rise and grind, tycoon.'));
    if (!night && meteorTimer) { clearInterval(meteorTimer); meteorTimer = null; }
  }
  skyToggles.forEach(function (b) {
    b.addEventListener('click', function () { setNight(!body.classList.contains('night')); });
  });
  // Sync the toggles' pressed state to whatever the snippet restored.
  setNight(body.classList.contains('night'), true);

  /* ── coin bursts (walkers, jackpots, celebrations) ────────────────── */
  function coinBurst(hostEl, x, y, n) {
    if (!hostEl) return;
    n = n || 8;
    for (var i = 0; i < n; i++) {
      var c = document.createElement('span');
      c.className = 'burst-coin';
      c.innerHTML = iconify(Math.random() < .82 ? '🪙' : '✨');
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      c.style.setProperty('--dx', rand(-90, 90).toFixed(0) + 'px');
      c.style.setProperty('--dy', rand(-130, -46).toFixed(0) + 'px');
      c.style.setProperty('--bd', rand(.55, 1.05).toFixed(2) + 's');
      hostEl.appendChild(c);
      c.addEventListener('animationend', function (ev) { ev.currentTarget.remove(); });
    }
  }

  /* ── walkers: click → jump + coins ────────────────────────────────── */
  $$('.walker').forEach(function (w) {
    w.addEventListener('click', function (e) {
      var j = w.querySelector('.w-jump');
      if (j) {
        j.classList.remove('jumping');
        void j.offsetWidth;                 // restart animation
        j.classList.add('jumping');
      }
      coinTink();
      if (lobby) {
        var r = lobby.getBoundingClientRect();
        coinBurst(lobby, e.clientX - r.left, e.clientY - r.top, 7);
      }
    });
  });

  /* ── EASTER EGG: blimp — 3 clicks = comedy crash, then respawn ────── */
  var blimp = $('#blimp');
  var blimpHits = 0, blimpBusy = false;
  if (blimp) {
    blimp.addEventListener('click', function () {
      if (blimpBusy) return;
      blimpHits++;
      if (blimpHits === 1) {
        blimp.classList.add('wobble');
        setTimeout(function () { blimp.classList.remove('wobble'); }, 550);
        toast('The blimp wobbles ominously…');
        return;
      }
      if (blimpHits === 2) {
        blimp.classList.add('wobble');
        setTimeout(function () { blimp.classList.remove('wobble'); }, 550);
        toast('The pilot is begging you to stop.');
        return;
      }
      blimpBusy = true;
      blimp.style.animationPlayState = 'paused';
      blimp.classList.add('crashed');
      toast(iconify('💥 Blimp down! Insurance premiums up!'));
      setTimeout(function () {
        blimp.classList.remove('crashed');
        blimp.style.animation = 'none';
        void blimp.offsetWidth;
        blimp.style.animation = '';
        blimp.style.animationPlayState = '';
        blimpHits = 0;
        blimpBusy = false;
        toast(iconify('🛩️ A suspiciously identical blimp appears.'));
      }, 4400);
    });
  }

  /* ── Floors + elevator scroll-spy ─────────────────────────────────── */
  var FLOORS = [
    { id: 'lobby', label: 'L', name: 'Lobby' },
    { id: 'games', label: '1', name: 'The Game Floor' },
    { id: 'empire', label: '2', name: 'The Empire' },
    { id: 'vault', label: 'V', name: 'Store' },
    { id: 'penthouse', label: 'P', name: 'The Penthouse' },
    { id: 'rooftop', label: 'R', name: 'The Rooftop' }
  ];
  var needle = $('#elevNeedle');
  var floorNameEl = $('#elevFloorname');
  var elevBtns = $$('.elev-btn');
  var currentFloor = 'lobby';
  function setNeedle(idx) {
    if (!needle) return;
    var angle = -62 + idx * (124 / (FLOORS.length - 1));
    needle.style.transform = 'rotate(' + angle + 'deg)';
  }
  function updateSpy() {
    var y = window.scrollY + window.innerHeight * 0.38;
    var idx = 0;
    for (var i = 0; i < FLOORS.length; i++) {
      var el = document.getElementById(FLOORS[i].id);
      if (el && el.offsetTop <= y) idx = i;
    }
    if (FLOORS[idx].id !== currentFloor) {
      currentFloor = FLOORS[idx].id;
      setNeedle(idx);
      if (floorNameEl) floorNameEl.textContent = FLOORS[idx].name;
      elevBtns.forEach(function (b) { b.classList.toggle('lit', b.dataset.floor === currentFloor); });
    }
  }
  var spyTick = false;
  window.addEventListener('scroll', function () {
    if (spyTick) return; spyTick = true;
    requestAnimationFrame(function () { updateSpy(); spyTick = false; });
  }, { passive: true });
  updateSpy();

  /* ── Elevator doors ride ──────────────────────────────────────────── */
  var doors = $('#doors'), floorcard = $('#doorsFloorcard');
  var riding = false;
  function rideTo(targetId, cardText) {
    var target = document.getElementById(targetId);
    if (!target) return;
    ding();
    if (reduced() || riding) { target.scrollIntoView(); return; }
    riding = true;
    if (floorcard) floorcard.textContent = cardText;
    doors.classList.add('shut');
    setTimeout(function () {
      var top = target.getBoundingClientRect().top + window.scrollY - 10;
      window.scrollTo({ top: top, behavior: 'auto' });
    }, 540);
    setTimeout(function () { doors.classList.remove('shut'); ding(); }, 900);
    setTimeout(function () { riding = false; }, 1450);
  }
  elevBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var f = FLOORS.filter(function (fl) { return fl.id === b.dataset.floor; })[0];
      rideTo(b.dataset.floor, f ? f.name : '');
    });
  });

  /* ── SECRET #1: the unlabeled 13th-floor button ───────────────────── */
  var btn13 = $('#btn13'), backroom = $('#backroom'), backRoom = $('#backRoom'), backDoor = $('#backDoor');
  if (btn13) btn13.addEventListener('click', function () {
    backroom.classList.add('revealed');
    rideTo('backroom', 'Floor 13 · ???');
    console.log('%c🕹️ Floor 13. This floor does not exist. You did not see it.', 'color:#8b5cf6;font-weight:bold;');
  });
  function knockRoutine() {
    if (!backRoom || backRoom.classList.contains('open') || backRoom.classList.contains('knocking')) return;
    backRoom.classList.add('knocking');
    knockSound(); setTimeout(knockSound, 180); setTimeout(knockSound, 360);
    setTimeout(function () {
      backRoom.classList.remove('knocking');
      backRoom.classList.add('open');
      jackpotFanfare();
      toast(iconify('🕹️ Password accepted. Welcome to the backroom.'));
    }, 620);
  }
  if (backDoor) {
    backDoor.addEventListener('click', knockRoutine);
    backDoor.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); knockRoutine(); } });
  }

  /* ── Toon Tape ticker — all 16 games + playful headlines ──────────── */
  var TICKS = [
    { sym: 'SRCHL', c: '#4a9eff', t: 'fr-searchle' },
    { sym: 'RECT', c: '#22d3ee', t: 'fr-rect' },
    { sym: 'ERECT', c: '#44bb88', t: 'fr-erect' },
    { sym: 'WRD5K', c: '#4fc34f', t: 'fr-word5k' },
    { sym: 'CLR500', c: '#4ade80', t: 'fr-color500' },
    { sym: 'WRDL', c: '#6aaa64', t: 'fr-wordle' },
    { sym: 'BTWX', c: '#7b68ee', t: 'fr-betwixt' },
    { sym: 'PIXL', c: '#ff6b9d', t: 'fr-pixel' },
    { sym: 'BEE', c: '#ffab00', t: 'fr-bee' },
    { sym: 'FIGR', c: '#00d5ee', t: 'fr-figural' },
    { sym: 'UNWRD', c: '#ff6b6b', t: 'fr-unwordle' },
    { sym: 'TRI', c: '#3a3a4a', t: 'fr-triangled' },
    { sym: 'WIKI', c: '#8a5cf7', t: 'fr-wiki' },
    { sym: 'WKRCT', c: '#ee7a2c', t: 'fr-wikirect' },
    { sym: 'JUNK', c: '#f5a623', t: 'fr-junk' },
    { sym: 'SYN', c: '#8b5cf6', t: 'fr-synapse' }
  ];
  var HEADLINES = [
    'BREAKING: chat solves daily in 41s',
    'MARKET WATCH: vowels up on heavy volume',
    'RUMOR: someone actually beat MadameMogul at Synapse',
    'FILING: Pizza Palace declares record cheese reserves',
    'ALERT: the Q tile remains illiquid',
    'EXCLUSIVE: butler seen practicing his bow'
  ];
  var tickerEl = $('#ticker');
  if (tickerEl) {
    // Real events from the social feed become tape headlines; the playful
    // fake ones stay as filler when the feed is quiet.
    var realHeadlines = [];
    var feedTopId = null;

    function feedHeadline(e) {
      var name = (e.user && (e.user.displayName || e.user.username)) || 'Someone';
      var g = e.gameName || e.game || '';
      var d = e.detail || {};
      var val = (typeof e.value === 'number') ? Math.round(e.value).toLocaleString() : null;
      switch (e.eventType) {
        case 'win': return { icon: 'trophy', text: name + ' won ' + g + (d.guessCount ? ' in ' + d.guessCount + (d.guessCount === 1 ? ' guess' : ' guesses') : '') };
        case 'jackpot': return { icon: 'moneybag', text: name + ' hit the ' + g + ' JACKPOT' + (val ? ' +' + val + ' XP' : '!') };
        case 'daily': return { icon: 'calendar', text: name + ' completed the ' + g + ' daily' };
        case 'streak': return { icon: 'fire', text: name + ' is on a ' + (val || '') + '-win streak in ' + g };
        case 'buy': return { icon: 'building', text: name + ' bought the ' + (d.businessName || 'a business') };
        case 'levelup': return { icon: 'chart-line', text: name + ' leveled ' + (d.businessName || 'a business') + ' to Lv.' + (d.level || val || '?') };
        case 'cosmetic': return { icon: 'gem', text: name + ' bought ' + (d.cosmeticName || 'a cosmetic') };
        case 'lootbox': return { icon: 'gift', text: name + ' unboxed a ' + (d.rarity ? d.rarity + ' ' : '') + (d.cosmeticName || 'cosmetic') };
        default: return null;
      }
    }

    function buildItems() {
      var news = realHeadlines.concat(HEADLINES);
      var items = [];
      var n = 0;
      TICKS.forEach(function (tk, i) {
        var up = Math.random() > 0.32;
        var pct = (Math.random() * 5.4 + 0.2).toFixed(1);
        items.push({ sym: tk.sym, c: tk.c, up: up, pct: pct, t: tk.t });
        if (i % 2 === 1) items.push({ news: news[n++ % news.length] });
      });
      return items;
    }

    function buildHalf(items) {
      var frag = document.createDocumentFragment();
      items.forEach(function (it) {
        var s = document.createElement('span');
        if (it.news) {
          s.className = 'tk tk-news';
          if (typeof it.news === 'object' && it.news.icon) {
            var ic = document.createElement('span');
            ic.className = 'tk-icon';
            ic.innerHTML = icon(it.news.icon);
            s.appendChild(ic);
            var tx = document.createElement('span');
            tx.textContent = ' ' + it.news.text;
            s.appendChild(tx);
          } else {
            s.textContent = it.news;
          }
        }
        else {
          s.className = 'tk';
          var sym = document.createElement('span');
          sym.className = 'sym';
          sym.style.setProperty('--tc', it.c);
          sym.style.background = it.c;
          sym.textContent = it.sym;
          var delta = document.createElement('span');
          delta.className = 'delta ' + (it.up ? 'up' : 'down');
          delta.textContent = (it.up ? '▲ ' : '▼ ') + it.pct + '%';
          s.appendChild(sym); s.appendChild(delta);
          s.addEventListener('click', function () {
            var fr = document.getElementById(it.t);
            if (!fr) return;
            fr.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
            fr.classList.remove('flashing'); void fr.offsetWidth; fr.classList.add('flashing');
            setTimeout(function () { fr.classList.remove('flashing'); }, 1700);
          });
        }
        frag.appendChild(s);
      });
      return frag;
    }

    function rebuildTape() {
      var items = buildItems();
      tickerEl.textContent = '';
      tickerEl.appendChild(buildHalf(items));
      tickerEl.appendChild(buildHalf(items));
    }

    function updateFeedTeaser(events) {
      var teaser = document.getElementById('feedTeaser');
      if (!teaser || !events || !events.length) return;
      var ICONS = { win: icon('trophy'), jackpot: icon('moneybag'), daily: icon('calendar'), streak: icon('fire'), buy: icon('building'), levelup: icon('chart-line'), cosmetic: icon('gem'), lootbox: icon('gift') };
      var picks = events.slice(0, 3);
      var cards = teaser.querySelectorAll('.feed-tease-card');
      picks.forEach(function (evt, i) {
        var card = cards[i];
        if (!card) return;
        var u = evt.user || {};
        var name = u.displayName || u.username || 'Player';
        var game = evt.gameName || evt.game || 'Word Tycoon';
        var icon = ICONS[evt.eventType] || '⭐';
        var text = '';
        var d = evt.detail || {};
        if (evt.eventType === 'win') text = name + ' won ' + game;
        else if (evt.eventType === 'jackpot') text = name + ' hit the ' + game + ' jackpot';
        else if (evt.eventType === 'daily') text = name + ' completed the ' + game + ' daily';
        else if (evt.eventType === 'streak') text = name + ' is on a ' + (evt.value || '') + '-win streak';
        else if (evt.eventType === 'buy') text = name + ' bought ' + (d.businessName || 'a business');
        else if (evt.eventType === 'levelup') text = name + ' leveled ' + (d.businessName || 'a business') + ' to Lv.' + (d.level || evt.value || '?');
        else if (evt.eventType === 'cosmetic') text = name + ' unlocked ' + (d.cosmeticName || 'a cosmetic');
        else if (evt.eventType === 'lootbox') text = name + ' unboxed ' + (d.cosmeticName || 'a cosmetic');
        else text = name + ' did something legendary';
        card.querySelector('.ft-icon').innerHTML = icon;
        card.querySelector('.ft-text').textContent = text;
        card.querySelector('.ft-game').textContent = game;
      });
    }

    function refreshFeedHeadlines() {
      fetch('/api/feed?limit=12').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.events || !j.events.length) return;
        if (j.events[0].id === feedTopId) return; // nothing new — leave the tape alone
        feedTopId = j.events[0].id;
        realHeadlines = j.events.map(feedHeadline).filter(Boolean).slice(0, 10);
        updateFeedTeaser(j.events);
        rebuildTape();
      }).catch(function () { /* fake headlines carry the tape */ });
    }

    rebuildTape();
    defer(refreshFeedHeadlines);
    setInterval(refreshFeedHeadlines, 90000);

    // pause the tape when it scrolls out of view
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        tickerEl.classList.toggle('paused', !entries[0].isIntersecting);
      }, { threshold: 0 }).observe(tickerEl.parentElement);
    }
  }

  /* ── Butlers: bow + cloche reveal; cats occasionally tag along ────── */
  var LETTER_BAG = 'AEIOULNRSTBCDGHKMPWY';
  $$('.butler').forEach(function (bt) {
    bt.addEventListener('click', function () {
      if (bt.classList.contains('bowing')) return;
      var tile = $('.tile-reveal', bt);
      if (tile) tile.textContent = LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)];
      bt.classList.add('bowing', 'serving');
      coinTink();
      setTimeout(function () { bt.classList.remove('bowing', 'serving'); }, 1700);
    });
  });
  if (!reduced()) {
    setInterval(function () {
      $$('.cat').forEach(function (c) {
        if (Math.random() < 0.3) c.classList.toggle('tagging');
      });
    }, 9000);
    var firstCat = $('.landing-2 .cat'); if (firstCat) firstCat.classList.add('tagging');
  }
  // pause landing traffic while a landing is off-screen
  if ('IntersectionObserver' in window) {
    var landIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('offscreen', !en.isIntersecting); });
    }, { threshold: 0 });
    $$('.landing').forEach(function (l) { landIO.observe(l); });
  }

  /* ── Game art fallback: PNG fails → the game's emoji steps in ──── */
  $$('.frame .art img').forEach(function (img) {
    function fallback() {
      if (img.dataset.swapped) return;
      img.dataset.swapped = '1';
      var plaqueName = img.closest('.frame').querySelector('.p-name');
      var m = plaqueName ? plaqueName.textContent.trim().match(/^\S+/) : null;
      var span = document.createElement('span');
      span.className = 'emoji-art';
      span.innerHTML = icon('gamepad');
      img.replaceWith(span);
    }
    if (img.complete && img.naturalWidth === 0) fallback();
    else img.addEventListener('error', fallback);
  });

  /* ── Game frames: 3D tilt toward cursor ──────────────────────────── */
  if (!reduced() && window.matchMedia('(hover: hover)').matches) {
    $$('.frame').forEach(function (fr) {
      fr.addEventListener('mousemove', function (e) {
        var r = fr.getBoundingClientRect();
        var dx = (e.clientX - r.left) / r.width - 0.5;
        var dy = (e.clientY - r.top) / r.height - 0.5;
        fr.style.transform = 'translateY(-4px) rotateY(' + (dx * 10).toFixed(2) + 'deg) rotateX(' + (-dy * 8).toFixed(2) + 'deg)';
      });
      fr.addEventListener('mouseleave', function () { fr.style.transform = ''; });
    });
  }

  /* ── MINIGAME 1: The Store Slots ─────────────────────────────────── */
  var SLOT_WORDS = ['CAT', 'WIN', 'FUN', 'TOP', 'ACE', 'BET', 'GEM', 'HAT', 'JOY', 'KEY', 'LUX', 'OWN', 'PIP', 'POP', 'SPA', 'TUX', 'VIP', 'WOW', 'ZIP', 'BAR', 'FIG', 'YAY', 'INK', 'JET', 'OAK'];
  var SLOT_LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWXYZ';
  var slotsEl = $('#slots'), lever = $('#lever'), slotsMsg = $('#slotsMsg'), slotsStats = $('#slotsStats');
  var reels = [$('#reel0'), $('#reel1'), $('#reel2')];
  var spinning = false;
  var slotState = store.get('wt_home_slots', { spins: 0, jackpots: 0, best: '' });
  function renderSlotStats() {
    if (!slotsStats) return;
    slotsStats.textContent = 'Spins ' + slotState.spins + ' · Jackpots ' + slotState.jackpots + (slotState.best ? ' · Best word ' + slotState.best : '');
  }
  function fillReel(reel, finalLetter, cells) {
    reel.innerHTML = '';
    for (var i = 0; i < cells; i++) {
      var d = document.createElement('div');
      d.className = 'reel-cell';
      d.textContent = (i === cells - 1) ? finalLetter : SLOT_LETTERS[Math.floor(Math.random() * SLOT_LETTERS.length)];
      reel.appendChild(d);
    }
  }
  function initReels() {
    reels.forEach(function (r, i) { if (r) { fillReel(r, 'WTD'[i], 1); r.style.transform = 'translateY(0)'; } });
  }
  initReels();
  renderSlotStats();
  function spinSlots() {
    if (spinning || !reels[0]) return;
    spinning = true;
    slotsEl.classList.add('pulling');
    setTimeout(function () { slotsEl.classList.remove('pulling'); }, 380);
    coinTink();
    // choose outcome: ~22% chance we rig a word (the house is generous)
    var final3;
    if (Math.random() < 0.22) {
      final3 = SLOT_WORDS[Math.floor(Math.random() * SLOT_WORDS.length)].split('');
    } else {
      final3 = [0, 1, 2].map(function () { return SLOT_LETTERS[Math.floor(Math.random() * SLOT_LETTERS.length)]; });
    }
    var CELLS = 26;
    var done = 0;
    reels.forEach(function (reel, i) {
      fillReel(reel, final3[i], CELLS);
      var cellH = reel.firstChild ? reel.firstChild.getBoundingClientRect().height : 96;
      reel.style.transition = 'none';
      reel.style.transform = 'translateY(0)';
      void reel.offsetWidth;
      var dur = reduced() ? 0.01 : (1.15 + i * 0.5);
      reel.style.transition = 'transform ' + dur + 's cubic-bezier(.15,.85,.25,1.02)';
      reel.style.transform = 'translateY(' + (-(CELLS - 1) * cellH) + 'px)';
      setTimeout(function () {
        coinTink();
        if (++done === 3) settleSlots(final3.join(''));
      }, dur * 1000 + 40);
    });
  }
  function settleSlots(word) {
    spinning = false;
    slotState.spins++;
    var hit = SLOT_WORDS.indexOf(word) !== -1;
    if (hit) {
      slotState.jackpots++;
      slotState.best = word;
      slotsMsg.innerHTML = '<span class="win">' + icon('moneybag') + ' ' + word + '! ' + (window.__wtPlayer
        ? 'Jackpot! 500 ' + icon('coin') + ' of pure bragging rights.'
        : 'You\'d have won 500 ' + icon('coin') + ' — sign in to keep your prizes.') + '</span>';
      jackpotFanfare();
      coinFountain();
    } else {
      slotsMsg.textContent = word + ' — not a word the house recognizes. Pull again ▸';
    }
    store.set('wt_home_slots', slotState);
    renderSlotStats();
  }
  function coinFountain() {
    if (reduced() || !slotsEl) return;
    for (var i = 0; i < 26; i++) {
      var c = document.createElement('span');
      c.className = 'coin-burst';
      c.innerHTML = iconify(Math.random() > 0.3 ? '🪙' : '✨');
      c.style.left = (30 + Math.random() * 40) + '%';
      c.style.top = '55%';
      c.style.setProperty('--dx', ((Math.random() - 0.5) * 260).toFixed(0) + 'px');
      c.style.setProperty('--dy', (-(80 + Math.random() * 220)).toFixed(0) + 'px');
      c.style.setProperty('--rr', ((Math.random() - 0.5) * 360).toFixed(0) + 'deg');
      c.style.animationDelay = (Math.random() * 0.25) + 's';
      slotsEl.appendChild(c);
      setTimeout(function (el) { return function () { el.remove(); }; }(c), 1600);
    }
  }
  if (lever) lever.addEventListener('click', spinSlots);

  /* ── MINIGAME 2: Insider Trading ($LEXICON) ───────────────────────── */
  var canvas = $('#tradeCanvas');
  if (canvas) (function () {
    var g = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var price = 100, candles = [], MAXC = 42;
    var balance = 1000, qty = 0, entry = 0, roundTicks = -1;
    var bBuy = $('#tBuy'), bSell = $('#tSell');
    var eBal = $('#tBalance'), ePrice = $('#tPrice'), ePos = $('#tPos');
    var pnlCard = $('#pnlCard'), pnlNum = $('#pnlNum'), pnlSub = $('#pnlSub');
    var timer = null;
    var UP = '#2fae62', DOWN = '#e05252';
    function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
    function tick() {
      var drift = (Math.random() - 0.485) * 3.4;
      var o = price, c = Math.max(24, price + drift);
      candles.push({ o: o, c: c, h: Math.max(o, c) + Math.random() * 1.4, l: Math.min(o, c) - Math.random() * 1.4 });
      if (candles.length > MAXC) candles.shift();
      price = c;
      if (ePrice) ePrice.innerHTML = price.toFixed(1) + ' ' + icon('coin');
      if (roundTicks >= 0) {
        roundTicks++;
        if (roundTicks >= 30) endRound(true);
      }
      draw();
    }
    function draw() {
      g.clearRect(0, 0, W, H);
      // toon graph paper
      g.strokeStyle = 'rgba(27,20,48,.10)'; g.lineWidth = 1;
      for (var yy = 20; yy < H; yy += 34) { g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
      if (!candles.length) return;
      var lo = Infinity, hi = -Infinity;
      candles.forEach(function (cd) { lo = Math.min(lo, cd.l); hi = Math.max(hi, cd.h); });
      var pad = (hi - lo) * 0.14 + 1; lo -= pad; hi += pad;
      var cw = W / MAXC, y = function (v) { return H - ((v - lo) / (hi - lo)) * H; };
      candles.forEach(function (cd, i) {
        var x = i * cw + cw / 2, up = cd.c >= cd.o;
        g.strokeStyle = up ? UP : DOWN;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y(cd.h)); g.lineTo(x, y(cd.l)); g.stroke();
        g.fillStyle = up ? UP : DOWN;
        var top = y(Math.max(cd.o, cd.c)), bot = y(Math.min(cd.o, cd.c));
        g.fillRect(x - cw * 0.32, top, cw * 0.64, Math.max(2, bot - top));
        g.strokeStyle = 'rgba(27,20,48,.55)';
        g.lineWidth = 1;
        g.strokeRect(x - cw * 0.32, top, cw * 0.64, Math.max(2, bot - top));
      });
      if (qty > 0) { // entry line
        g.strokeStyle = 'rgba(255,171,0,.9)'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(0, y(entry)); g.lineTo(W, y(entry)); g.stroke(); g.setLineDash([]);
        g.fillStyle = 'rgba(168,110,0,1)'; g.font = 'bold 10px sans-serif';
        g.fillText('IN @ ' + entry.toFixed(1), 6, y(entry) - 4);
      }
    }
    function refreshHud() {
      if (eBal) eBal.innerHTML = fmt(qty > 0 ? qty * price : balance) + ' ' + icon('coin');
      if (ePos) ePos.textContent = qty > 0 ? 'LONG @ ' + entry.toFixed(1) : 'flat';
      if (bBuy) bBuy.disabled = qty > 0;
      if (bSell) bSell.disabled = qty === 0;
    }
    function endRound(forced) {
      var proceeds = qty * price;
      var pnl = proceeds - qty * entry;
      balance = proceeds; qty = 0; roundTicks = -1;
      if (pnlCard) {
        pnlCard.classList.add('show');
        pnlNum.innerHTML = (pnl >= 0 ? '+' : '') + fmt(pnl) + ' ' + icon('coin');
        pnlNum.className = 'pnl-num ' + (pnl >= 0 ? 'win' : 'loss');
        pnlSub.textContent = pnl >= 0
          ? (forced
              ? (window.__wtPlayer
                  ? 'Closing bell — the desk cashed you out. The real StockMogul is up on your Empire floor.'
                  : 'Closing bell — the desk cashed you out. Sign in and the real StockMogul keeps your winnings.')
              : 'Textbook. The SEC of word games has no comment.')
          : 'The market can stay irrational longer than a demo can stay solvent.';
      }
      if (pnl >= 0) jackpotFanfare(); else tone(196, 0, 0.5, 0.08, 'triangle');
      refreshHud();
    }
    if (bBuy) bBuy.addEventListener('click', function () {
      if (qty > 0) return;
      if (pnlCard) pnlCard.classList.remove('show');
      if (balance < 10) balance = 1000; // the house comps you
      entry = price; qty = balance / price; roundTicks = 0;
      coinTink(); refreshHud();
    });
    if (bSell) bSell.addEventListener('click', function () { if (qty > 0) endRound(false); });
    // pre-roll some history so the chart opens alive
    for (var i = 0; i < MAXC; i++) tick();
    refreshHud();
    function setTimer(on) {
      if (on && !timer) timer = setInterval(tick, reduced() ? 1500 : 620);
      if (!on && timer) { clearInterval(timer); timer = null; }
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        setTimer(entries[0].isIntersecting);
      }, { threshold: 0.05 }).observe(canvas);
    } else setTimer(true);
  })();

  /* ── Penthouse coin bubbles (paused off-screen) ───────────────────── */
  var bubbles = $('#bubbles');
  if (bubbles && !reduced()) {
    for (var bi = 0; bi < 16; bi++) {
      var b = document.createElement('span');
      b.className = 'bubble';
      b.innerHTML = iconify(Math.random() > 0.45 ? '🪙' : '✦');
      b.style.left = (3 + Math.random() * 94) + '%';
      b.style.fontSize = (0.6 + Math.random() * 0.8) + 'rem';
      b.style.animationDuration = (7 + Math.random() * 8) + 's';
      b.style.animationDelay = (-Math.random() * 12) + 's';
      b.style.setProperty('--sway', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
      bubbles.appendChild(b);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        bubbles.classList.toggle('paused', !entries[0].isIntersecting);
      }, { threshold: 0 }).observe(bubbles.parentElement);
    }
  }

  /* ── SECRET #2: click the moon (night only) → meteor shower ───────── */
  var roofSky = $('#roofSky');
  var roofMoon = $('#roofMoon'), meteorTimer = null;
  function spawnMeteor() {
    if (!roofSky) return;
    var m = document.createElement('span');
    m.className = 'meteor';
    m.style.left = (30 + Math.random() * 65) + '%';
    m.style.top = (Math.random() * 30) + '%';
    roofSky.appendChild(m);
    setTimeout(function () { m.remove(); }, 1200);
  }
  function toggleShower() {
    if (reduced()) return;
    if (!body.classList.contains('night')) {
      toast(iconify('🌙 The moon only takes calls after dark — try the sun switch.'));
      return;
    }
    if (meteorTimer) { clearInterval(meteorTimer); meteorTimer = null; return; }
    coinTink();
    meteorTimer = setInterval(spawnMeteor, 420);
    spawnMeteor();
    toast(iconify('🌠 Meteor shower engaged. Wishes are non-refundable.'));
    console.log('%c🌠 Meteor shower engaged. Wishes are non-refundable.', 'color:#ffd84d;');
  }
  if (roofMoon) roofMoon.addEventListener('click', toggleShower);

  /* ── SECRET #3: triple-click the brand → a top hat drops on it ────── */
  var brandMark = $('#brandMark');
  var mClicks = 0, mTimer = null;
  if (brandMark) brandMark.parentElement.addEventListener('click', function (e) {
    mClicks++;
    clearTimeout(mTimer);
    mTimer = setTimeout(function () { mClicks = 0; }, 700);
    if (mClicks >= 3) {
      e.preventDefault();
      mClicks = 0;
      brandMark.classList.add('spun', 'hatted');
      jackpotFanfare();
      toast(iconify('🎩 A gentleman always spins his monogram.'));
      setTimeout(function () { brandMark.classList.remove('spun'); }, 1500);
      console.log('%c🎩 A gentleman always spins his monogram.', 'color:#ffab00;font-weight:bold;');
    }
  });

  /* ── SECRET #4: Konami code → gold letter-tile rain ───────────────── */
  var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  var kIdx = 0;
  function goldRain() {
    var LETTERS = 'TYCOONWORD';
    var n = reduced() ? 0 : 44;
    for (var i = 0; i < n; i++) {
      var gd = document.createElement('span');
      gd.className = 'gold-drop';
      gd.textContent = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      gd.style.left = rand(0, 96) + 'vw';
      gd.style.setProperty('--gd', rand(2.2, 4.6).toFixed(2) + 's');
      gd.style.animationDelay = rand(0, 1.4).toFixed(2) + 's';
      document.body.appendChild(gd);
      gd.addEventListener('animationend', function (ev) { ev.currentTarget.remove(); });
    }
    jackpotFanfare();
    toast(iconify('🪙 GOLD RAIN! The zoning board is furious.'));
    console.log('%c🪙 The old handshake still works.', 'color:#f5a623;font-weight:bold;background:#1b1430;padding:2px 8px;border-radius:4px;');
  }
  /* ── SECRET #5: type GOAT → an actual goat struts the podium ──────── */
  var goatBuf = '', goatWalker = $('#goatWalker');
  /* ── SECRET #6: type TYCOON → top hats for every walker ───────────── */
  var typedBuf = '';
  window.addEventListener('keydown', function (e) {
    // konami
    var key = (e.key && e.key.length === 1) ? e.key.toLowerCase() : e.key;
    kIdx = (key === KONAMI[kIdx]) ? kIdx + 1 : (key === KONAMI[0] ? 1 : 0);
    if (kIdx === KONAMI.length) { kIdx = 0; goldRain(); }
    if (e.key && /^[a-zA-Z]$/.test(e.key)) {
      // goat
      goatBuf = (goatBuf + e.key.toUpperCase()).slice(-4);
      if (goatBuf === 'GOAT' && goatWalker && !reduced() && !goatWalker.classList.contains('strut')) {
        goatWalker.classList.add('strut');
        tone(392, 0, 0.2, 0.08, 'sawtooth'); tone(370, 0.22, 0.3, 0.08, 'sawtooth'); // a respectful bleat
        setTimeout(function () { goatWalker.classList.remove('strut'); }, 5200);
        toast(iconify('🐐 The GOAT acknowledges you.'));
        console.log('%c🐐 The GOAT acknowledges you.', 'color:#4ade80;font-weight:bold;');
      }
      // tycoon dress code
      typedBuf = (typedBuf + e.key.toUpperCase()).slice(-6);
      if (typedBuf === 'TYCOON' && !body.classList.contains('tophat')) {
        body.classList.add('tophat');
        toast(iconify('🎩 TOP HATS FOR EVERYONE.'));
        console.log('%c🎩 Dress code enforced.', 'font-weight:900');
      }
    }
  });

  /* ── Game cards: whole card is clickable, but mode chips stay real links ─ */
  $$('.frame[data-href]').forEach(function (fr) {
    fr.addEventListener('click', function (e) {
      // Let real links/buttons inside the card handle themselves.
      if (e.target.closest('a, button')) return;
      var href = fr.getAttribute('data-href');
      if (!href) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) window.open(href, '_blank');
      else window.location.href = href;
    });
    fr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.href = fr.getAttribute('data-href');
      }
    });
  });

  /* ── Session-aware header: greet returning tycoons (deferred) ─────── */
  function initSession() {
    try {
      fetch('/api/me/session', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.ok || !data.user) return;
          var u = data.user;
          window.__wtPlayer = true;
          document.documentElement.classList.add('wt-player');
          var pnlSubEl = document.getElementById('pnlSub');
          if (pnlSubEl) pnlSubEl.textContent = 'The real StockMogul is up on your Empire floor.';
          var name = u.globalName || u.displayName || u.username || 'tycoon';
          var hdrBtn = $('#hdrCta');
          if (hdrBtn) { hdrBtn.innerHTML = iconify('🛎️ Profile ▸'); hdrBtn.setAttribute('href', '/profile'); }
          var keycards = $('.keycards');
          if (keycards && keycards.parentNode) {
            var banner = document.createElement('div');
            banner.className = 'welcome-back';
            var txt = document.createElement('span');
            txt.innerHTML = iconify('👋 Welcome back, ') + name + ' — ';
            var link = document.createElement('a');
            link.href = '/profile';
            link.textContent = 'view your profile ▸';
            banner.appendChild(txt);
            banner.appendChild(link);
            keycards.parentNode.insertBefore(banner, keycards);
          }
          activatePlayerMode();
          loadDailyLoginRibbon();
        })
        .catch(function () { /* guest — leave the lobby as-is */ });
    } catch (e) { /* guest */ }
  }
  defer(initSession);

  /* ── Daily login ribbon (top of home page) ─────────────────────────── */
  function loadDailyLoginRibbon() {
    var ribbon = document.getElementById('daily-login-ribbon');
    var text = document.getElementById('daily-login-ribbon-text');
    var btn = document.getElementById('daily-login-ribbon-btn');
    if (!ribbon || !text || !btn) return;
    fetch('/api/me/daily-claim/status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) { ribbon.hidden = true; return; }
        ribbon.hidden = false;
        var streak = d.currentStreak || 0;
        if (d.canClaim) {
          ribbon.classList.remove('claimed');
          text.textContent = 'Day ' + (streak + 1) + ' daily login ready — +1 hint & XP';
          btn.disabled = false;
          btn.textContent = 'Claim';
          btn.onclick = claimDailyLoginRibbon;
        } else {
          ribbon.classList.add('claimed');
          text.textContent = 'Day ' + streak + ' claimed — +1 hint earned';
          btn.disabled = true;
          btn.textContent = 'Claimed';
          btn.onclick = null;
        }
      })
      .catch(function () { ribbon.hidden = true; });
  }

  function claimDailyLoginRibbon() {
    var btn = document.getElementById('daily-login-ribbon-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Claiming...'; }
    fetch('/api/me/daily-claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result || !result.ok) { loadDailyLoginRibbon(); return; }
        var ribbon = document.getElementById('daily-login-ribbon');
        var text = document.getElementById('daily-login-ribbon-text');
        var btn2 = document.getElementById('daily-login-ribbon-btn');
        if (ribbon) ribbon.classList.add('claimed');
        if (text) text.textContent = 'Day ' + (result.streakDay || 0) + ' claimed — +' + (result.xp || 0) + ' XP & +1 hint';
        if (btn2) { btn2.disabled = true; btn2.textContent = 'Claimed'; btn2.onclick = null; }
        toast(iconify('🎁 Daily login claimed! +' + (result.xp || 0) + ' XP & +1 hint'));
      })
      .catch(function () { loadDailyLoginRibbon(); });
  }

  /* ── Player mode: mount the live Empire into Floor Two ────────────── */
  var homeProfile = null;
  function fetchHomeProfile() {
    return fetch('/api/me/profile', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function activatePlayerMode() {
    // Client mirrors of the server business tables (portal.js carries the
    // same copies) — empire.js needs them for locked-card costs, income
    // lines, and the space upgrade button.
    window.BUSINESS_CONFIG = {
      library:   { baseCost: 0, baseUpgradeCost: 0, baseIncome: 10, cycleSeconds: 1, costMultiplier: 1, wordUpgrade: true, maxLevel: 100 },
      newspaper: { baseCost: 5000, baseUpgradeCost: 5000, baseIncome: 5, cycleSeconds: 3, costMultiplier: 1.15, maxLevel: 100 },
      carwash:   { baseCost: 100000, baseUpgradeCost: 100000, baseIncome: 25, cycleSeconds: 6, costMultiplier: 1.15, maxLevel: 100 },
      stockmogul:{ baseCost: 0, baseUpgradeCost: 0, baseIncome: 200, cycleSeconds: 8, costMultiplier: 1.15, maxLevel: 100, cleanCashCost: 5000, cleanCashUpgradeCost: 2500, cleanCashBusiness: true },
      pizza:     { baseCost: 2000000, baseUpgradeCost: 2000000, baseIncome: 50, cycleSeconds: 5, costMultiplier: 1.15, maxLevel: 100 },
      arcade:    { baseCost: 1000, baseUpgradeCost: 0, baseIncome: 0, cycleSeconds: 8, costMultiplier: 1.15, maxLevel: 1 },
      gym:       { baseCost: 250000000, baseUpgradeCost: 250000000, baseIncome: 1000, cycleSeconds: 10, costMultiplier: 1.15, maxLevel: 75 },
      cinema:    { baseCost: 1000000000, baseUpgradeCost: 1000000000, baseIncome: 5000, cycleSeconds: 12, costMultiplier: 1.15, maxLevel: 50 },
      startup:   { baseCost: 3000000000, baseUpgradeCost: 3000000000, baseIncome: 25000, cycleSeconds: 15, costMultiplier: 1.15, maxLevel: 50 },
      bank:      { baseCost: 6000000000, baseUpgradeCost: 6000000000, baseIncome: 150000, cycleSeconds: 20, costMultiplier: 1.15, maxLevel: 50 },
      space:     { baseCost: 10000000000, baseUpgradeCost: 10000000000, baseIncome: 1000000, cycleSeconds: 25, costMultiplier: 1.15, maxLevel: 25 }
    };
    window.BUSINESS_PROGRESSION = {
      library: { multiplier: 1 }, newspaper: { multiplier: 2 }, carwash: { multiplier: 4 },
      stockmogul: { multiplier: 6 }, pizza: { multiplier: 8 }, arcade: { multiplier: 15 },
      gym: { multiplier: 30 }, cinema: { multiplier: 60 }, startup: { multiplier: 100 },
      bank: { multiplier: 150 }, space: { multiplier: 250 }
    };
    window.getBizProgressionMult = function (type, level) {
      var prog = window.BUSINESS_PROGRESSION[type];
      var cfg = window.BUSINESS_CONFIG[type];
      if (!prog || !cfg) return 1;
      var maxLevel = cfg.maxLevel || 100;
      if (maxLevel <= 1) return prog.multiplier;
      return prog.multiplier * (1 + 0.5 * ((level - 1) / (maxLevel - 1)));
    };
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/portal/css/empire.css?v=5';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = '/portal/js/empire.js?v=6';
    js.onload = bootEmpireLive;
    document.body.appendChild(js);
  }
  function bootEmpireLive() {
    var host = document.getElementById('empire-live');
    if (!host || !window.Empire) return;
    fetchHomeProfile().then(function (p) {
      if (!p) return; // profile unavailable — keep the guest showcase
      homeProfile = p;
      var showcase = document.querySelector('#empire .empire-grid');
      if (showcase) showcase.style.display = 'none';
      host.hidden = false;
      window.Empire.mount(host, {
        getProfile: function () { return homeProfile; },
        refreshProfile: function () {
          fetchHomeProfile().then(function (np) {
            if (np) { homeProfile = np; window.Empire.render(np); }
          });
        },
        buyBusiness: function (type, btn) {
          if (btn) btn.disabled = true;
          fetch('/api/me/business/buy', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ businessType: type })
          })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (btn) btn.disabled = false;
              if (res && res.ok) {
                toast(iconify('🏢 Purchased!'));
                fetchHomeProfile().then(function (np) {
                  if (np) { homeProfile = np; window.Empire.render(np); }
                });
              } else {
                toast((res && (res.message || res.error)) || 'Could not buy that yet.');
              }
            })
            .catch(function () {
              if (btn) btn.disabled = false;
              toast('Network hiccup — try again.');
            });
        },
        notify: null,
        onCoinsChange: function (n) {
          var el = document.getElementById('hq-coins');
          if (el) el.textContent = Number(n || 0).toLocaleString();
        }
      });
      window.Empire.render(p);
      var banner = document.querySelector('.welcome-back');
      if (banner && p.profile) {
        var chip = document.createElement('span');
        chip.innerHTML = ' · <b id="hq-coins">' + (Number(p.profile.coins) || 0).toLocaleString() + '</b> ' + icon('lightning') + ' XP · ';
        var manage = document.createElement('a');
        manage.href = '#empire';
        manage.textContent = 'manage your empire ▸';
        banner.appendChild(chip);
        banner.appendChild(manage);
      }
    });
  }
  // Smoke-test hook: forces the player-mode asset pipeline without a
  // session (profile 404s -> showcase stays). Harmless in production.
  if (/[?&]empireLive=1(&|$)/.test(window.location.search)) activatePlayerMode();

  /* ── Audience rooms: live streamers + donor-created rooms ────────── */
  var LIVE_FRAME_MAP = {
    subtextle: 'fr-searchle', searchle: 'fr-searchle',
    rectangled: 'fr-rect', erectangled: 'fr-erect', sproutle: 'fr-erect',
    word500: 'fr-word5k', word5000: 'fr-word5k',
    colour500: 'fr-color500', color500: 'fr-color500',
    wordle: 'fr-wordle',
    betwixt: 'fr-betwixt', betweenly: 'fr-betwixt',
    pixeletters: 'fr-pixel', spellingbee: 'fr-bee', 'spelling-bee': 'fr-bee',
    figural: 'fr-figural', unwordle: 'fr-unwordle', triangled: 'fr-triangled',
    wikicontexto: 'fr-wiki', wikisearchle: 'fr-wiki',
    wikirectangled: 'fr-wikirect',
    junkdrawer: 'fr-junk', synapse: 'fr-synapse', letterworks: 'fr-letterworks', wordfall: 'fr-wordfall'
  };
  function escLive(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function renderAudienceRooms(list) {
    document.querySelectorAll('.live-pill').forEach(function (el) { el.remove(); });
    var strip = document.getElementById('live-strip');
    var body = document.getElementById('ls-body');
    if (strip) strip.hidden = false;
    var byGame = {};
    list.forEach(function (s) { (byGame[s.currentGame] = byGame[s.currentGame] || []).push(s); });
    Object.keys(byGame).forEach(function (gid) {
      var fr = document.getElementById(LIVE_FRAME_MAP[gid] || '');
      if (!fr) return;
      var s = byGame[gid][0];
      var extra = byGame[gid].length - 1;
      var pill = document.createElement('span');
      pill.className = 'live-pill' + (s.type === 'user' ? ' user-room' : '');
      pill.setAttribute('role', 'link');
      pill.tabIndex = 0;
      pill.title = 'Join ' + (s.displayName || s.slug) + "'s " + s.gameName + ' room';
      pill.innerHTML = '<span class="dot"></span>' + (s.live ? 'LIVE' : 'ROOM') + ' · @' + escLive(s.slug) +
        ((s.memberCount || s.viewerCount) ? ' · ' + Number((s.memberCount || 0) + (s.viewerCount || 0)).toLocaleString() + ' ' + icon('eyes') : '') +
        (extra > 0 ? ' +' + extra : '');
      var go = function (e) { e.preventDefault(); e.stopPropagation(); window.location.href = '/' + encodeURIComponent(s.slug); };
      pill.addEventListener('click', go);
      pill.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
      fr.appendChild(pill);
    });
    if (strip && body) {
      body.innerHTML = list.length ? list.map(function (s) {
        var people = Number(s.memberCount || 0) + Number(s.viewerCount || 0);
        return '<a class="ls-item" href="/' + encodeURIComponent(s.slug) + '">@' + escLive(s.slug) +
          (s.live ? ' is live playing ' : ' has a room for ') + '<b>' + escLive(s.gameName) + '</b>' +
          (people ? ' · ' + people.toLocaleString() + ' here' : '') + ' — join ▸</a>';
      }).join('') : '<span class="ls-empty">No rooms are open yet. Donor Class members can open the first one.</span>';
    }
  }
  function pollAudienceRooms() {
    if (document.hidden) return;
    fetch('/api/rooms', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) renderAudienceRooms(d.rooms || []); })
      .catch(function () { /* endpoint unreachable — keep last state */ });
  }
  defer(pollAudienceRooms);
  setInterval(pollAudienceRooms, 10000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pollAudienceRooms(); });
  var roomCreate = document.getElementById('room-create');
  if (roomCreate) roomCreate.addEventListener('click', function () {
    roomCreate.disabled = true;
    fetch('/api/me/room', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (status) {
        if (!status || status.error === 'Login required') {
          window.location.href = '/auth/discord?returnTo=' + encodeURIComponent('/#games');
          return null;
        }
        if (status.room) {
          if (status.room.open === false) {
            return fetch('/api/me/room', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
              .then(function (r) { return r.json(); });
          }
          return status;
        }
        if (!status.eligible) {
          window.location.href = '/membership';
          return null;
        }
        return fetch('/api/me/room', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); });
      })
      .then(function (result) {
        if (result && result.room && result.room.slug) window.location.href = '/' + encodeURIComponent(result.room.slug);
      })
      .catch(function () { toast('Could not open your room yet.'); })
      .finally(function () { roomCreate.disabled = false; });
  });
  // Smoke hook: ?liveDemo=1 renders fixture pills without the API.
  if (/[?&]liveDemo=1(&|$)/.test(window.location.search)) {
    renderAudienceRooms([
      { slug: 'jorry', displayName: 'Jorry', type: 'streamer', currentGame: 'searchle', gameName: 'Subtextle', live: true, viewerCount: 128, memberCount: 14 },
      { slug: 'wordfriend', displayName: 'Word Friend', type: 'user', currentGame: 'rectangled', gameName: 'recTangled', live: false, viewerCount: 0, memberCount: 8 }
    ]);
  }

  /* ── Styled console welcome (SECRET #7: reading the fine print) ───── */
  try {
    console.log(
      '%c🏙️ WORD TYCOON %c— Toon Tower',
      'font-size:26px;font-weight:900;color:#ffab00;text-shadow:2px 2px 0 #1b1430;',
      'font-size:16px;font-weight:800;color:#4a9eff;'
    );
    console.log(
      '%cBuilding regulations:\n' +
      '  The elevator          — has a button nobody labeled\n' +
      '  The moon              — takes calls after dark\n' +
      '  The brand mark        — rewards persistence (×3)\n' +
      '  ↑↑↓↓←→←→ B A          — makes it rain\n' +
      '  Type "GOAT"           — summons management\n' +
      '  Type "TYCOON"         — enforces the dress code\n' +
      '  The blimp             — has three lives',
      'font-size:12px;font-weight:700;color:#6f6486;'
    );
  } catch (e) { /* consoles are optional */ }
})();
