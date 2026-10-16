(function attachRackDisplay(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LetterworksRackDisplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRackDisplay() {
  'use strict';

  const letter = item => typeof item === 'string' ? item : item.letter;
  const text = items => items.map(letter).join('').toUpperCase();
  const shiftNames = ['Opening Shift', 'Forge Floor', 'Rush Orders', 'Final Stretch', 'Boss Workshop'];

  function arrange(items, puzzle, random = Math.random) {
    const source = [...items];
    const original = text(source);
    const answers = new Set([puzzle.rack, ...puzzle.masterWords].map(word => word.toUpperCase()));
    const safe = order => text(order) !== original && !answers.has(text(order));

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const order = [...source];
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
      }
      if (safe(order)) return order;
    }

    // A fixed or unusually unlucky random source must still never show an answer.
    function search(remaining, order) {
      if (!remaining.length) return safe(order) ? order : null;
      for (let index = 0; index < remaining.length; index += 1) {
        const found = search([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...order, remaining[index]]);
        if (found) return found;
      }
      return null;
    }
    const fallback = search(source, []);
    if (!fallback) throw new Error('No concealed tile order is available for this rack.');
    return fallback;
  }

  return { arrange, shiftName: index => shiftNames[index] || 'Workshop Shift' };
});
