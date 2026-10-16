/* === Color 500 — shared UI builders ======================================
   Used by BOTH the multiplayer page (app.js) and solo (solo.js) so the two
   boards can never drift apart visually. Pure DOM construction: no sockets,
   no fetches, no game rules.

   Everything here is a port of Word 5000's shell — the triangle geometry is
   copied wedge-for-wedge from its modules/render-row.js.                    */

window.C500UI = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // color-mix() is banned in this ecosystem (it renders inconsistently in the
  // streaming browser), so key gradients are computed here instead.
  function shade(hex, pct) {
    var h = String(hex || '#888888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function f(c) {
      var v = pct >= 0 ? c + (255 - c) * pct : c * (1 + pct);
      return Math.max(0, Math.min(255, Math.round(v)));
    }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  /* Feedback triangle. green = exact · yellow = right colour wrong slot ·
     red = not in the code. Never positional. */
  function buildTriangle(correct, present, absent) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'guess-triangle');
    svg.setAttribute('viewBox', '0 0 64 56');
    svg.setAttribute('aria-label',
      correct + ' exact, ' + present + ' right color wrong slot, ' + absent + ' not in code');

    [
      { cls: 'tri-wedge-correct', points: '32,2 17,28 32,37 47,28' },
      { cls: 'tri-wedge-present', points: '2,54 32,54 32,37 17,28' },
      { cls: 'tri-wedge-absent',  points: '62,54 47,28 32,37 32,54' }
    ].forEach(function (w) {
      var p = document.createElementNS(SVG_NS, 'polygon');
      p.setAttribute('class', w.cls);
      p.setAttribute('points', w.points);
      svg.appendChild(p);
    });

    var spokes = document.createElementNS(SVG_NS, 'path');
    spokes.setAttribute('class', 'tri-spokes');
    spokes.setAttribute('d', 'M32,37 L17,28 M32,37 L32,54 M32,37 L47,28');
    svg.appendChild(spokes);

    var outline = document.createElementNS(SVG_NS, 'polygon');
    outline.setAttribute('class', 'tri-outline');
    outline.setAttribute('points', '32,2 2,54 62,54');
    svg.appendChild(outline);

    [
      { x: 32, y: 22, value: correct },
      { x: 19, y: 42, value: present },
      { x: 45, y: 42, value: absent }
    ].forEach(function (l) {
      if (!l.value) return;
      var t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', l.x);
      t.setAttribute('y', l.y);
      t.textContent = l.value;
      svg.appendChild(t);
    });
    return svg;
  }

  function pillLayers(tiles) {
    var glass = document.createElement('div');
    glass.className = 'pill-glass';
    tiles.appendChild(glass);
    var spec = document.createElement('div');
    spec.className = 'pill-spec';
    tiles.appendChild(spec);
  }

  function fallbackAvatar(g) {
    var COLORS = {
      tiktok: '#fe2c55', youtube: '#ff0000', discord: '#5865F2',
      twitch: '#9146FF', unknown: '#888'
    };
    var fb = document.createElement('div');
    fb.className = 'player-pic-fb';
    fb.style.backgroundColor = COLORS[g.platform] || COLORS.unknown;
    fb.textContent = (g.displayName || '?')[0].toUpperCase();
    return fb;
  }

  function makeAvatar(g) {
    var wrap = document.createElement('div');
    wrap.className = 'guess-player';
    if (g.profilePic) {
      var img = document.createElement('img');
      img.src = g.profilePic;
      img.className = 'player-pic';
      img.alt = g.displayName || '';
      img.onerror = function () { this.replaceWith(fallbackAvatar(g)); };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(fallbackAvatar(g));
    }
    window.PerkBadges && window.PerkBadges.apply(wrap, g);
    return wrap;
  }

  /**
   * A scored guess row.
   * @param g        { code[], exact, misplaced, absent?, displayName?, profilePic?, platform? }
   * @param palette  the active palette (array of {hex,name,letter,square})
   * @param opts     { animate?: bool, showAvatar?: bool, index?: number }
   */
  function committedRow(g, palette, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'guess-row row-committed';

    var exact = g.exact || 0;
    var misplaced = g.misplaced || 0;
    var len = (g.code || []).length;
    var absent = (typeof g.absent === 'number') ? g.absent : (len - exact - misplaced);

    if (len && exact === len) row.classList.add('all-correct');
    if (opts.animate) row.classList.add('row-new');

    if (opts.showAvatar) row.appendChild(makeAvatar(g));
    else if (typeof opts.index === 'number') {
      // Solo has no avatars — a guess number takes that slot so the row keeps
      // the same left-hand rhythm as multiplayer.
      var n = document.createElement('div');
      n.className = 'guess-n';
      n.textContent = opts.index;
      row.appendChild(n);
    }

    var tiles = document.createElement('div');
    tiles.className = 'guess-tiles';
    pillLayers(tiles);
    (g.code || []).forEach(function (idx, i) {
      var tile = document.createElement('div');
      tile.className = 'colour-tile';
      var c = palette[idx];
      tile.style.setProperty('--tile', c ? c.hex : '#555');
      tile.style.setProperty('--i', i);
      tile.title = c ? c.name : '';
      tiles.appendChild(tile);
    });
    row.appendChild(tiles);

    var counts = document.createElement('div');
    counts.className = 'guess-counts';
    counts.appendChild(buildTriangle(exact, misplaced, absent));
    row.appendChild(counts);

    return row;
  }

  /** The row the player is currently filling in. */
  function activeRow(draft, codeLength, palette, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'guess-row row-active';

    if (typeof opts.index === 'number') {
      var n = document.createElement('div');
      n.className = 'guess-n';
      n.textContent = opts.index;
      row.appendChild(n);
    }

    var tiles = document.createElement('div');
    tiles.className = 'guess-tiles';
    pillLayers(tiles);
    for (var i = 0; i < codeLength; i++) {
      var tile = document.createElement('div');
      tile.className = 'colour-tile';
      if (i < draft.length) {
        var c = palette[draft[i]];
        tile.style.setProperty('--tile', c ? c.hex : '#555');
      } else {
        tile.classList.add('is-empty');
        if (i === draft.length) tile.classList.add('is-cursor');
      }
      tiles.appendChild(tile);
    }
    row.appendChild(tiles);
    return row;
  }

  /** One docked key, in word5000's base/glass/spec glass shell. */
  function key(label, cls, onTap, aria) {
    var k = document.createElement('button');
    k.type = 'button';
    k.className = 'kb-key' + (cls ? ' ' + cls : '');
    k.setAttribute('aria-label', aria || label);
    k.setAttribute('data-key', label);

    ['kb-base', 'kb-glass', 'kb-spec'].forEach(function (c) {
      var s = document.createElement('span');
      s.className = c;
      k.appendChild(s);
    });

    var t = document.createElement('span');
    t.className = 'kb-label';
    t.textContent = label;
    k.appendChild(t);

    k.addEventListener('click', onTap);
    return k;
  }

  /**
   * Build the docked palette: one row of colour keys, one row of DEL/ENTER.
   * Returns the ENTER button so the caller can enable/disable it.
   */
  function renderPalette(container, palette, handlers) {
    container.innerHTML = '';

    var colourRow = document.createElement('div');
    colourRow.className = 'kb-row';
    palette.forEach(function (c, i) {
      var k = key(c.letter, 'colour-key', function () { handlers.onPick(i); }, c.name);
      k.style.setProperty('--key-hi', shade(c.hex, 0.10));
      k.style.setProperty('--key-lo', shade(c.hex, -0.30));
      // Extrusion slab for the toon skin: the key's OWN colour darkened hard.
      // A shared near-black slab is invisible against this shell. Read by a
      // real box-shadow (not nested inside another custom property), so the
      // per-element value actually applies.
      k.style.setProperty('--key-sl', shade(c.hex, -0.62));
      colourRow.appendChild(k);
    });
    container.appendChild(colourRow);

    var actionRow = document.createElement('div');
    actionRow.className = 'kb-row';
    actionRow.appendChild(key('⌫ DEL', 'wide', handlers.onDelete, 'delete'));
    var enter = key('ENTER', 'wide', handlers.onSubmit, 'submit guess');
    actionRow.appendChild(enter);
    container.appendChild(actionRow);

    return enter;
  }

  /** Small colour swatch chip, used in the win/lose overlays. */
  function codeChip(idx, palette) {
    var chip = document.createElement('div');
    chip.className = 'code-chip';
    var c = palette[idx];
    chip.style.background = c ? c.hex : '#555';
    chip.title = c ? c.name : '';
    return chip;
  }

  return {
    shade: shade,
    buildTriangle: buildTriangle,
    committedRow: committedRow,
    activeRow: activeRow,
    key: key,
    renderPalette: renderPalette,
    codeChip: codeChip
  };
})();
