/**
 * UI Helpers — toasts, found word chips, completion win card
 */

function showToast(message, type = 'error', duration = 1800) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function addFoundWordChip(word, type) {
  const container = document.getElementById('found-words');
  const chip = document.createElement('span');
  chip.className = `found-word ${type}`;
  chip.textContent = word;
  container.appendChild(chip);

  // Remove a placeholder if one exists
  const placeholder = container.querySelector('.found-word.placeholder');
  if (placeholder) placeholder.remove();
}

function updateWordCount(found, total) {
  document.getElementById('found-count').textContent = found;
  document.getElementById('total-count').textContent = total;
}

function updateHintButton(progress, canUse) {
  const btn = document.getElementById('hint-btn');
  const span = document.getElementById('hint-progress');
  span.textContent = `(${progress}/3)`;
  btn.disabled = !canUse;
}

function showCompletion(hintsUsed, coinsAwarded) {
  let stars = '';
  if (hintsUsed === 0) stars = 'Perfect — no hints used!';
  else if (hintsUsed <= 2) stars = `Solved with ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}.`;
  else stars = `Solved with ${hintsUsed} hints.`;

  updateShareText(hintsUsed);
  // WinCard has no subtitle line — keep the hint-stars note as a toast.
  showToast(stars, 'hint', 4000);

  if (window.WinCard) {
    WinCard.showSolo({
      game: 'triangled',
      gameName: 'Triangled',
      jackpot: coinsAwarded,
      winner: buildWinnerIdentity(),
      actions: [{ label: 'Share', primary: true, onClick: shareDailyResult }],
      autoHideMs: 5000
    });
  }
}

// Winner identity from the local session (app.js `player` + cached WT user).
function buildWinnerIdentity() {
  const p = (typeof player !== 'undefined' && player) || {};
  const u = window._wtUser || {};
  const winner = {
    displayName: p.username || 'Guest',
    username: p.username || 'Guest',
    platform: p.platform || 'web',
    platformUserId: p.userId || undefined
  };
  if (u.avatar) winner.profilePic = u.avatar;
  if (u.linkedDiscord) winner.linkedDiscord = u.linkedDiscord;
  else if ((u.provider || u.platform) === 'discord' && u.id) winner.discordId = u.id;
  return winner;
}

// ── Daily share ─────────────────────────────────────────────────────
let shareText = '';

function updateShareText(hintsUsed) {
  const date = (typeof puzzle !== 'undefined' && puzzle && puzzle.date) ? ' ' + puzzle.date : '';
  const hintPart = hintsUsed === 0 ? 'no hints' : hintsUsed + ' hint' + (hintsUsed === 1 ? '' : 's');
  shareText = '🔺 Triangled Daily' + date + ' — solved with ' + hintPart + '\nhttps://triangled.io';
}

function shareDailyResult() {
  if (!shareText) return;
  if (navigator.share) {
    navigator.share({ text: shareText }).catch(() => {});
    return;
  }
  const done = () => showToast('Copied to clipboard!', 'hint');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareText).then(done, () => {
      try { window.prompt('Copy your result:', shareText); } catch (e) {}
    });
  } else {
    try { window.prompt('Copy your result:', shareText); } catch (e) {}
  }
}

function initPlaceholders(totalWords, spangramLength) {
  const container = document.getElementById('found-words');
  container.innerHTML = '';
  for (let i = 0; i < totalWords; i++) {
    const chip = document.createElement('span');
    chip.className = 'found-word placeholder';
    chip.textContent = i === 0 ? '★'.repeat(Math.min(spangramLength, 8)) : '?????';
    container.appendChild(chip);
  }
}
