/* === Color 500 — OBS overlay view =========================================
   Read-only board for a streamer's private round, embedded by the goals
   overlay's gameEmbed widget at /overlay/<handle>.

   Deliberately minimal: no input, no auth, no chrome. It renders committed
   rows through the same ui.js builders the player pages use, so the board a
   viewer sees and the board on stream can never diverge.                    */

(function () {
  'use strict';

  var UI = window.C500UI;
  var MAX_ROWS = 8;          // fits a vertical stream without crowding
  var WIN_HOLD_MS = 9000;    // roughly matches the goals overlay's win card

  // /overlay/<handle> — the handle is the last path segment.
  var handle = (location.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();

  var socket = io({ auth: { session: handle } });

  var state = { palette: [], codeLength: 4, guesses: [] };
  var winTimer = null;

  var el = {
    guesses: document.getElementById('guesses'),
    emptyNote: document.getElementById('empty-note'),
    paletteStrip: document.getElementById('palette-strip'),
    winStrip: document.getElementById('win-strip'),
    winName: document.getElementById('win-name'),
    winCode: document.getElementById('win-code'),
    winPot: document.getElementById('win-pot'),
  };

  /**
   * Scale the board to fill the frame's width.
   *
   * The embed runs at a 720-wide design viewport and is then scaled onto a
   * 1080×1920 canvas. A 4-slot row is only ~364px, so unscaled it would sit
   * marooned in the middle of the frame. Measuring the widest row and scaling
   * to fit keeps the board readable at ANY slot count (3-6) and any canvas —
   * no per-board-size constants to keep in sync.
   */
  function fitBoard() {
    el.guesses.style.transform = 'none';
    var rows = el.guesses.querySelectorAll('.guess-row');
    if (!rows.length) return;

    // Widest VISIBLE content — the row box itself spans the full container,
    // so measure the union of its children (avatar + pill + triangle).
    var widest = 0;
    for (var i = 0; i < rows.length; i++) {
      var kids = rows[i].children;
      var left = Infinity, right = -Infinity;
      for (var k = 0; k < kids.length; k++) {
        var r = kids[k].getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < left) left = r.left;
        if (r.right > right) right = r.right;
      }
      if (right > left) widest = Math.max(widest, right - left);
    }
    if (!widest) return;

    var availableW = document.documentElement.clientWidth - 24;
    var scale = Math.max(1, Math.min(2.2, availableW / widest));

    // Height fit. The widget can be any size the streamer drags it to, and
    // the stack is top-anchored with overflow hidden — so without this a
    // short widget would clip the NEWEST rows, which are the ones that
    // matter on a stream. Drop the oldest rows until the rest fit.
    var rowH = rows[0].getBoundingClientRect().height + 2; // + gap
    var availableH = el.guesses.clientHeight;
    if (rowH > 0 && availableH > 0) {
      var maxRows = Math.max(1, Math.floor(availableH / (rowH * scale)));
      for (var d = 0; d < rows.length - maxRows; d++) rows[d].remove();
    }

    // Top-anchored, so scale outward from the top — a bottom origin would
    // push the first rows up out of the frame.
    el.guesses.style.transformOrigin = 'top center';
    el.guesses.style.transform = 'scale(' + scale.toFixed(3) + ')';
  }

  /**
   * The colour key. Viewers never see the game's palette dock, so this is the
   * only thing telling them which colours are in play and what to type. Built
   * from the live palette, so a 4- or 8-colour board is always accurate.
   */
  function renderPaletteStrip() {
    var sig = state.palette.map(function (c) { return c.letter; }).join('');
    if (sig === el.paletteStrip._sig) return;   // avoid needless DOM churn on stream
    el.paletteStrip._sig = sig;
    el.paletteStrip.innerHTML = '';
    state.palette.forEach(function (c) {
      var chip = document.createElement('div');
      chip.className = 'pk';
      chip.style.setProperty('--pk-hi', UI.shade(c.hex, 0.10));
      chip.style.setProperty('--pk-lo', UI.shade(c.hex, -0.30));
      // toon extrusion slab — mirrors --key-sl on the player page's palette
      chip.style.setProperty('--pk-sl', UI.shade(c.hex, -0.62));
      var label = document.createElement('span');
      label.textContent = c.letter;
      chip.appendChild(label);
      el.paletteStrip.appendChild(chip);
    });
  }

  function render() {
    el.guesses.innerHTML = '';
    var list = state.guesses.slice(-MAX_ROWS);
    list.forEach(function (g, i) {
      el.guesses.appendChild(UI.committedRow(g, state.palette, {
        showAvatar: true,
        animate: i === list.length - 1,
      }));
    });
    el.emptyNote.style.display = list.length ? 'none' : '';
    fitBoard();
  }

  window.addEventListener('resize', fitBoard);

  function showWin(winner, code, pot) {
    el.winName.textContent = (winner && winner.displayName) || 'Winner';
    el.winCode.innerHTML = '';
    (code || []).forEach(function (i) {
      el.winCode.appendChild(UI.codeChip(i, state.palette));
    });
    el.winPot.textContent = pot ? '+' + Number(pot).toLocaleString() : '';
    el.winStrip.classList.add('is-shown');
    if (winTimer) clearTimeout(winTimer);
    winTimer = setTimeout(function () {
      el.winStrip.classList.remove('is-shown');
    }, WIN_HOLD_MS);
  }

  socket.on('game-state', function (s) {
    if (!s || s.error) return;
    state.palette = s.palette || [];
    state.codeLength = s.codeLength || 4;
    state.guesses = s.guesses || [];
    renderPaletteStrip();
    render();
    if (!s.gameOver) el.winStrip.classList.remove('is-shown');
  });

  socket.on('guess', function (g) {
    if (!g) return;
    state.guesses.push(g);
    render();
  });

  socket.on('game-over', function (d) {
    if (!d) return;
    showWin(d.winner, d.code, d.pot);
  });

  // The streamer switched games — blank the board rather than leaving a
  // stale round on screen. Overlays never navigate themselves.
  socket.on('session-redirect', function () {
    state.guesses = [];
    render();
  });
  socket.on('session-ended', function () {
    state.guesses = [];
    render();
  });
})();
