(function () {
  'use strict';

  var api = {};
  var elements = {};
  var initialized = false;
  var currentSummary = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeLetters(letters, centerLetter) {
    var seen = {};
    var result = [];
    var center = String(centerLetter || '').toLowerCase();
    if (center) {
      seen[center] = true;
      result.push(center);
    }
    var outer = [];
    for (var i = 0; i < (letters || []).length; i++) {
      var letter = String(letters[i] || '').toLowerCase();
      if (!letter || seen[letter]) continue;
      seen[letter] = true;
      outer.push(letter);
    }
    outer.sort();
    for (var j = 0; j < outer.length; j++) result.push(outer[j]);
    return result;
  }

  function buildSummary(options) {
    options = options || {};
    var words = options.words || [];
    var center = String(options.centerLetter || '').toLowerCase();
    var rowLetters = normalizeLetters(options.letters || [], center);
    var rowMap = {};
    var rows = [];
    var lengthSeen = {};
    var lengths = [];
    var totals = {};
    var prefixes = {};
    var totalPoints = Number(options.totalPoints || 0);
    var pointsProvided = options.totalPoints !== undefined && options.totalPoints !== null;

    function ensureRow(letter) {
      if (!rowMap[letter]) {
        rowMap[letter] = { letter: letter, isCenter: letter === center, counts: {}, total: 0 };
        rows.push(rowMap[letter]);
      }
      return rowMap[letter];
    }

    for (var r = 0; r < rowLetters.length; r++) ensureRow(rowLetters[r]);

    for (var i = 0; i < words.length; i++) {
      var entry = words[i];
      var word = String(typeof entry === 'string' ? entry : entry.word || '').toLowerCase();
      if (!word) continue;
      var length = word.length;
      if (!lengthSeen[length]) {
        lengthSeen[length] = true;
        lengths.push(length);
      }
      totals[length] = (totals[length] || 0) + 1;
      var row = ensureRow(word[0]);
      row.counts[length] = (row.counts[length] || 0) + 1;
      row.total += 1;
      if (word.length >= 2) prefixes[word.slice(0, 2)] = (prefixes[word.slice(0, 2)] || 0) + 1;
      if (!pointsProvided && entry && typeof entry === 'object') totalPoints += Number(entry.score || 0);
    }

    lengths.sort(function (a, b) { return a - b; });
    var prefixList = Object.keys(prefixes).sort().map(function (prefix) {
      return { prefix: prefix, count: prefixes[prefix] };
    });

    return {
      letters: rowLetters,
      centerLetter: center,
      totalWords: words.length,
      totalPoints: totalPoints,
      lengths: lengths,
      rows: rows,
      totals: totals,
      prefixes: prefixList
    };
  }

  function normalizeSummary(summary) {
    if (!summary) return null;
    if (summary.words) return buildSummary(summary);
    var center = String(summary.centerLetter || '').toLowerCase();
    var letters = normalizeLetters(summary.letters || [], center);
    return {
      letters: letters,
      centerLetter: center,
      totalWords: Number(summary.totalWords || 0),
      totalPoints: Number(summary.totalPoints || 0),
      lengths: (summary.lengths || []).map(Number).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; }),
      rows: summary.rows || [],
      totals: summary.totals || {},
      prefixes: summary.prefixes || []
    };
  }

  function cellValue(count) {
    return count ? String(count) : '-';
  }

  function render(summary) {
    if (!elements.body) return;
    summary = normalizeSummary(summary);
    currentSummary = summary;
    if (!summary || !summary.rows || !summary.rows.length) {
      elements.body.innerHTML = '<div class="cheat-empty">Cheat sheet loads when the puzzle is ready.</div>';
      return;
    }

    var lengths = summary.lengths || [];
    var html = '<div class="cheat-letter-row">';
    for (var i = 0; i < summary.letters.length; i++) {
      var letter = summary.letters[i];
      html += '<span class="cheat-letter' + (letter === summary.centerLetter ? ' center' : '') + '">' + escapeHtml(letter.toUpperCase()) + '</span>';
    }
    html += '</div>';
    html += '<div class="cheat-meta">' + escapeHtml(summary.totalWords) + ' words | ' + escapeHtml(summary.totalPoints) + ' points</div>';

    html += '<div class="cheat-table-wrap"><table class="cheat-table"><thead><tr><th></th>';
    for (var h = 0; h < lengths.length; h++) html += '<th>' + escapeHtml(lengths[h]) + '</th>';
    html += '<th>&Sigma;</th></tr></thead><tbody>';

    for (var r = 0; r < summary.rows.length; r++) {
      var row = summary.rows[r];
      var rowLetter = String(row.letter || '').toLowerCase();
      html += '<tr><th class="' + (rowLetter === summary.centerLetter || row.isCenter ? 'center' : '') + '">' + escapeHtml(rowLetter.toUpperCase()) + '</th>';
      for (var c = 0; c < lengths.length; c++) {
        html += '<td>' + escapeHtml(cellValue(row.counts && row.counts[lengths[c]])) + '</td>';
      }
      html += '<td class="cheat-total">' + escapeHtml(cellValue(row.total)) + '</td></tr>';
    }

    html += '<tr class="cheat-sum-row"><th>&Sigma;</th>';
    for (var t = 0; t < lengths.length; t++) {
      html += '<td>' + escapeHtml(cellValue(summary.totals && summary.totals[lengths[t]])) + '</td>';
    }
    html += '<td class="cheat-total">' + escapeHtml(cellValue(summary.totalWords)) + '</td></tr>';
    html += '</tbody></table></div>';

    html += '<div class="cheat-two-title">Two letter list:</div>';
    html += '<div class="cheat-prefix-grid">';
    var prefixes = summary.prefixes || [];
    for (var p = 0; p < prefixes.length; p++) {
      html += '<div class="cheat-prefix-item"><span>' + escapeHtml(String(prefixes[p].prefix || '').toUpperCase()) + '</span> - <strong>' + escapeHtml(prefixes[p].count || 0) + '</strong></div>';
    }
    html += '</div>';

    elements.body.innerHTML = html;
  }

  function openSheet() {
    if (!elements.sheet) return;
    render(currentSummary);
    elements.sheet.classList.remove('hidden');
    document.body.classList.add('cheat-sheet-open');
  }

  function closeSheet() {
    if (!elements.sheet) return;
    elements.sheet.classList.add('hidden');
    document.body.classList.remove('cheat-sheet-open');
  }

  function init(options) {
    options = options || {};
    elements.sheet = document.getElementById(options.sheetId || 'cheat-sheet');
    elements.body = document.getElementById(options.bodyId || 'cheat-sheet-body');
    elements.toggle = document.getElementById(options.toggleId || 'cheat-toggle');
    elements.close = document.getElementById(options.closeId || 'cheat-close');
    if (!elements.sheet || !elements.body || !elements.toggle || initialized) {
      render(currentSummary);
      return;
    }
    initialized = true;
    elements.toggle.addEventListener('click', openSheet);
    if (elements.close) elements.close.addEventListener('click', closeSheet);
    elements.sheet.addEventListener('click', function (event) {
      if (event.target === elements.sheet) closeSheet();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !elements.sheet.classList.contains('hidden')) closeSheet();
    });
    render(currentSummary);
  }

  api.init = init;
  api.setSummary = render;
  api.buildSummary = buildSummary;
  api.open = openSheet;
  api.close = closeSheet;
  window.SpellingBeeCheatSheet = api;
})();
