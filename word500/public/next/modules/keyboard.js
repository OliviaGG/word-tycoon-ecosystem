// Mini-glass keyboard. Each key mirrors the pill's base+glass+spec shell.
// Behavior is intentionally identical to the legacy keyboards: per-letter state
// classes ('correct' / 'present' / 'absent'), tap callback receives the key
// ('A'..'Z', 'ENTER', 'BACKSPACE').

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function renderKeyboard(container, onKey) {
  container.innerHTML = '';
  ROWS.forEach((row, rowIdx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';

    if (rowIdx === 2) {
      rowEl.appendChild(makeKey('BACKSPACE', 'wide backspace', onKey, '⌫'));
    }
    for (const letter of row) {
      rowEl.appendChild(makeKey(letter, '', onKey));
    }
    if (rowIdx === 2) {
      rowEl.appendChild(makeKey('ENTER', 'wide enter', onKey));
    }

    container.appendChild(rowEl);
  });
}

function makeKey(value, extraCls, onKey, label) {
  const key = document.createElement('button');
  key.type = 'button';
  key.className = 'kb-key' + (extraCls ? ' ' + extraCls : '');
  key.dataset.key = value;
  key.setAttribute('aria-label', value.toLowerCase());

  // Glass layers — same liquid-glass treatment as the guess pill, sized small.
  const base = document.createElement('span');
  base.className = 'kb-base';
  key.appendChild(base);

  const glass = document.createElement('span');
  glass.className = 'kb-glass';
  key.appendChild(glass);

  const spec = document.createElement('span');
  spec.className = 'kb-spec';
  key.appendChild(spec);

  const text = document.createElement('span');
  text.className = 'kb-label';
  text.textContent = label || value;
  key.appendChild(text);

  key.addEventListener('click', () => onKey && onKey(value));
  return key;
}

/**
 * Mark keys as used. A "used" key is one the player has typed in any committed
 * guess. The keyboard never reveals letter status (correct/present/absent) —
 * doing so would leak the answer. Only "have you tried this letter yet" shows.
 *
 *   usedLetters: a Set of uppercase letters
 */
export function applyKeyStates(container, usedLetters) {
  const keys = container.querySelectorAll('.kb-key[data-key]');
  keys.forEach(k => {
    const v = k.dataset.key;
    if (v === 'ENTER' || v === 'BACKSPACE') return;
    k.classList.toggle('used', !!(usedLetters && usedLetters.has(v)));
  });
}

/**
 * Bind a physical keyboard listener that funnels into the same onKey callback.
 * Returns a teardown function.
 */
export function bindPhysicalKeys(onKey) {
  function handler(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); onKey('ENTER'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); onKey('BACKSPACE'); return; }
    if (/^[a-zA-Z]$/.test(e.key)) { onKey(e.key.toUpperCase()); }
  }
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
