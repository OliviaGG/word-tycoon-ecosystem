// enhanced-animations.js — Enhanced animations for Word500 2.0
// Letter tile 3D flip, spring-physics row entry, slot-machine jackpot, win entrance

(function () {
  'use strict';

  // ─── Inject CSS for 3D tile flip ───────────────────────
  var style = document.createElement('style');
  style.textContent = [
    // 3D flip container for letter tiles
    '.letter-tile-flip {',
    '  perspective: 400px;',
    '}',
    '.letter-tile.flip-animate {',
    '  animation: tileFlip3D 0.5s ease-out forwards;',
    '  transform-style: preserve-3d;',
    '}',
    '@keyframes tileFlip3D {',
    '  0% { transform: rotateY(30deg) scale(0.95); opacity: 0.6; }',
    '  60% { transform: rotateY(-3deg) scale(1.01); opacity: 1; }',
    '  100% { transform: rotateY(0deg) scale(1); opacity: 1; }',
    '}',

    // Spring physics row entrance
    '.guess-row.spring-enter {',
    '  animation: springRow 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards;',
    '}',
    '@keyframes springRow {',
    '  0% { transform: translateY(-10px); opacity: 0; }',
    '  70% { transform: translateY(1px); }',
    '  100% { transform: translateY(0); opacity: 1; }',
    '}',

    // Win overlay bounce entrance
    '.win-bubble.dramatic-enter {',
    '  animation: winDramaticEnter 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;',
    '}',
    '@keyframes winDramaticEnter {',
    '  0% { transform: scale(0) rotate(-5deg); opacity: 0; }',
    '  40% { transform: scale(1.15) rotate(2deg); opacity: 1; }',
    '  60% { transform: scale(0.95) rotate(-1deg); }',
    '  80% { transform: scale(1.03) rotate(0.5deg); }',
    '  100% { transform: scale(1) rotate(0deg); opacity: 1; }',
    '}',

    // Character-by-character text reveal
    '.char-reveal {',
    '  display: inline-block;',
    '  opacity: 0;',
    '  transform: translateY(10px);',
    '  animation: charReveal 0.3s ease-out forwards;',
    '}',
    '@keyframes charReveal {',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',

    // Jackpot digit slot roll
    '.jackpot-digit {',
    '  display: inline-block;',
    '  overflow: hidden;',
    '  height: 1em;',
    '  vertical-align: bottom;',
    '}',
    '.jackpot-digit-inner {',
    '  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // ─── Letter Tile 3D Flip ───────────────────────────────
  // Observe new guess rows and apply staggered flip to tiles
  var guessesEl = document.getElementById('guesses');
  if (guessesEl) {
    var observer = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var addedNodes = mutations[m].addedNodes;
        for (var n = 0; n < addedNodes.length; n++) {
          var node = addedNodes[n];
          if (node.classList && node.classList.contains('guess-row')) {
            animateRow(node);
          }
        }
      }
    });
    observer.observe(guessesEl, { childList: true });
  }

  function animateRow(row) {
    // Replace default animation with spring
    row.style.animation = 'none';
    row.classList.add('spring-enter');

    // Staggered tile flip
    var tiles = row.querySelectorAll('.letter-tile');
    for (var i = 0; i < tiles.length; i++) {
      (function (tile, delay) {
        tile.style.opacity = '0';
        setTimeout(function () {
          tile.style.opacity = '';
          tile.classList.add('flip-animate');
        }, delay);
      })(tiles[i], 80 + i * 80);
    }

    // (non-win sounds removed)
  }

  // ─── Win Overlay Enhancement ───────────────────────────
  // Observe win overlay visibility changes
  var winOverlay = document.getElementById('win-overlay');
  if (winOverlay) {
    var winObserver = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        if (mutations[m].attributeName === 'class') {
          if (!winOverlay.classList.contains('hidden')) {
            enhanceWinOverlay();
          }
        }
      }
    });
    winObserver.observe(winOverlay, { attributes: true });
  }

  function enhanceWinOverlay() {
    var bubble = winOverlay.querySelector('.win-bubble');
    if (bubble) {
      bubble.classList.remove('dramatic-enter');
      void bubble.offsetWidth; // force reflow
      bubble.classList.add('dramatic-enter');
    }

    // Character-by-character reveal for win name
    var nameEl = document.getElementById('win-name');
    if (nameEl && nameEl.textContent) {
      var text = nameEl.textContent;
      nameEl.innerHTML = '';
      for (var i = 0; i < text.length; i++) {
        var span = document.createElement('span');
        span.className = 'char-reveal';
        span.style.animationDelay = (i * 40) + 'ms';
        span.textContent = text[i] === ' ' ? '\u00A0' : text[i];
        nameEl.appendChild(span);
      }
    }

    // Play win sound
    if (window.AudioManager) {
      window.AudioManager.play('win');
    }
  }

  // ─── Jackpot Slot Roll ─────────────────────────────────
  var jackpotEl = document.getElementById('jackpot-amount');
  var lastJackpotValue = '';

  if (jackpotEl) {
    // Observe jackpot text changes
    var jpObserver = new MutationObserver(function () {
      var newValue = jackpotEl.textContent;
      if (newValue !== lastJackpotValue && lastJackpotValue !== '') {
        // Brief scale bump on change
        jackpotEl.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
        jackpotEl.style.transform = 'scale(1.15)';
        setTimeout(function () {
          jackpotEl.style.transform = 'scale(1)';
        }, 200);
      }
      lastJackpotValue = newValue;
    });
    jpObserver.observe(jackpotEl, { childList: true, characterData: true, subtree: true });
  }

  // ─── Socket Event Hooks for Audio ──────────────────────
  // Wait for socket to be available, then hook in
  var hookInterval = setInterval(function () {
    var socket = window.io && window.io.sockets;
    // Try to find the socket instance by checking for io()
    // The socket is created in game.js as a local variable
    // We'll hook via the ThreeManager game events instead
    clearInterval(hookInterval);
  }, 100);

  // Use ThreeManager game events for audio hooks
  if (window.ThreeManager) {
    window.ThreeManager.addGameEventListener(function (type, data) {
      if (!window.AudioManager) return;
      switch (type) {
        case 'new-game':
          // new-game sound removed
          break;
        case 'game-over':
          // Win fanfare is handled by enhanceWinOverlay
          break;
      }
    });
  }

  console.log('[EnhancedAnimations] 3D flips, spring physics, slot roll initialized');
})();
