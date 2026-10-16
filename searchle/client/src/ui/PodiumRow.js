// ===== Podium Row =====
// Horizontal row of 7 player slots, sorted by accumulated game XP (desc).
// Slots 1-3 show pfp + username + XP with medal-colored rings.
// Slots 4-7 show pfp + XP only with plain rings.
// Cosmetics (hero_badge, profile_border, profile_glow, name_color,
// name_glow, title) apply to every slot via the shared CosmeticsApplier.

import config from '../config.js';
import { applyCosmetics } from '../utils/CosmeticsApplier.js';
import { markAvatarLogo } from '../utils/AvatarLogo.js';

const SLOT_COUNT = 7;
const DETAILED_SLOTS = 3; // first N slots show name + xp, rest just xp

const MEDAL_COLORS = {
  1: '#ffd700',   // gold
  2: '#c0c0c0',   // silver
  3: '#cd7f32',   // bronze
};

function fmtXp(xp) {
  if (!Number.isFinite(xp) || xp <= 0) return '0';
  if (xp >= 1000) return (xp / 1000).toFixed(xp >= 10000 ? 0 : 1) + 'k';
  return String(xp);
}

export class PodiumRow {
  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this.yPosition = 0;
    this._drawerOffset = 0;
    this._drawerTarget = 0;

    this.element = this._buildRoot();
    this.object3D = domRenderer.makeObject(this.element);
    this.object3D.position.set(config.baseWidth / 2, -200, 30);
    domRenderer.add(this.element);

    // Cache slot refs in order
    this.slots = [];
    for (let i = 1; i <= SLOT_COUNT; i++) {
      this.slots.push(this._buildSlot(i));
    }
    for (const slot of this.slots) {
      this.element.appendChild(slot.root);
    }

    // Track current podium so re-renders can short-circuit when nothing changed
    this._lastSig = '';
  }

  // Height in base units, used by main.js to position downstream UI.
  // Sized for slot-1's max content (pfp 144 + name + 52px XP + padding).
  get height() { return this.element.offsetHeight || 280; }

  setDrawerOffset(target) {
    this._drawerTarget = target;
  }

  setPosition(y) {
    this.yPosition = y;
    this._applyPosition();
  }

  _applyPosition() {
    const px = config.baseWidth / 2;
    const py = -(this.yPosition + this._drawerOffset + this.height / 2);
    this.object3D.position.set(px, py, 30);
  }

  // Per-frame drawer-offset lerp (same shape as PinnedGuess.animate).
  // Called from main.js animation loop so the podium slides down/up with
  // the stats drawer instead of being painted over by it.
  animate(dt) {
    const diff = this._drawerTarget - this._drawerOffset;
    if (Math.abs(diff) > 0.5) {
      this._drawerOffset += diff * Math.min(1, 10 * dt);
      this._applyPosition();
    } else if (diff !== 0) {
      this._drawerOffset = this._drawerTarget;
      this._applyPosition();
    }
  }

  _buildRoot() {
    const el = document.createElement('div');
    el.className = 'podium-row';
    el.style.width = config.baseWidth + 'px';

    // "LIVE · Current Game" label, top-right of the podium row. Tells
    // viewers this is the live podium (vs the previous-round cards in
    // the header above).
    const label = document.createElement('div');
    label.className = 'podium-current-label';
    label.innerHTML =
      '<span class="podium-current-dot"></span>' +
      '<span class="podium-current-live">Live</span>' +
      '<span class="podium-current-sep"></span>' +
      '<span class="podium-current-text">Current Game</span>';
    el.appendChild(label);

    return el;
  }

  _buildSlot(rank) {
    const root = document.createElement('div');
    root.className = 'podium-slot podium-slot-' + rank;
    if (rank <= DETAILED_SLOTS) root.classList.add('podium-slot-detailed');
    else root.classList.add('podium-slot-compact');
    root.dataset.rank = String(rank);

    const surface = document.createElement('div');
    surface.className = 'podium-surface';

    const rankBadge = document.createElement('div');
    rankBadge.className = 'podium-rank-badge';
    rankBadge.textContent = '#' + rank;
    if (MEDAL_COLORS[rank]) rankBadge.style.color = MEDAL_COLORS[rank];

    const avatarHost = document.createElement('div');
    avatarHost.className = 'podium-avatar-wrap';

    const avatar = document.createElement('div');
    avatar.className = 'podium-avatar';
    if (MEDAL_COLORS[rank]) {
      avatar.style.borderColor = MEDAL_COLORS[rank];
      avatar.style.boxShadow = `0 0 14px ${MEDAL_COLORS[rank]}55`;
    }

    const avatarImg = document.createElement('img');
    avatarImg.className = 'podium-avatar-img';
    avatarImg.alt = '';
    avatarImg.style.display = 'none';
    avatar.appendChild(avatarImg);

    const avatarPlaceholder = document.createElement('div');
    avatarPlaceholder.className = 'podium-avatar-placeholder';
    avatarPlaceholder.textContent = '#';
    avatar.appendChild(avatarPlaceholder);

    avatarHost.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'podium-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'podium-name-row';

    const name = document.createElement('span');
    name.className = 'podium-name';
    name.textContent = '';
    nameRow.appendChild(name);

    // Title cosmetic appends a span here next to the name.
    const titleContainer = nameRow;

    const xp = document.createElement('div');
    xp.className = 'podium-xp';
    xp.textContent = '';

    info.appendChild(nameRow);
    info.appendChild(xp);

    surface.appendChild(rankBadge);
    surface.appendChild(avatarHost);
    surface.appendChild(info);
    root.appendChild(surface);

    return {
      root,
      surface,
      avatar,
      avatarImg,
      avatarPlaceholder,
      avatarHost,
      name,
      nameRow,
      titleContainer,
      xp,
      rank,
    };
  }

  // Re-render slots from the latest podium array (server-sent, already
  // sorted by xp desc). Players can drop off if they're displaced from the
  // top 7. Empty slots show the placeholder.
  update(podium) {
    const list = Array.isArray(podium) ? podium : [];

    // Cheap signature short-circuit — re-render only when content changes.
    const sig = list.map(p => `${p.identityKey}:${p.xp}`).join('|') + '/' + list.length;
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this.slots[i];
      const player = list[i] || null;
      this._renderSlot(slot, player);
    }
  }

  _renderSlot(slot, player) {
    if (!player) {
      // Empty slot: placeholder + reset cosmetics
      slot.root.classList.add('podium-slot-empty');
      slot.root.classList.remove('podium-slot-filled');
      slot.avatarHost.classList.remove('has-fan-club-badge');
      slot.avatarImg.style.display = 'none';
      slot.avatarImg.removeAttribute('src');
      slot.avatarImg.classList.remove('is-logo');
      slot.avatar.classList.remove('has-logo');
      slot.avatarPlaceholder.style.display = '';
      slot.name.textContent = '';
      slot.xp.textContent = '';
      // Clear any prior inline cosmetic styles by re-applying with empty cos
      applyCosmetics({
        nameEl: slot.name,
        avatarEl: slot.avatar,
        avatarHostEl: slot.avatarHost,
        surfaceEl: slot.surface,
        titleContainer: slot.titleContainer,
        avatarSize: 96,
      }, {});
      return;
    }

    slot.root.classList.add('podium-slot-filled');
    slot.root.classList.remove('podium-slot-empty');

    // TikTok fan club badge overlay on top-right of the avatar
    slot.avatarHost.classList.toggle('has-fan-club-badge', !!player.isFanClub);

    if (player.profilePic) {
      slot.avatarImg.src = player.profilePic;
      slot.avatarImg.style.display = '';
      slot.avatarPlaceholder.style.display = 'none';
      markAvatarLogo(slot.avatarImg, slot.avatar);
    } else {
      slot.avatarImg.style.display = 'none';
      slot.avatarPlaceholder.textContent = (player.displayName || '?').slice(0, 1).toUpperCase();
      slot.avatarPlaceholder.style.display = '';
    }

    // Detailed slots show name; compact slots leave it blank and just show XP.
    if (slot.rank <= DETAILED_SLOTS) {
      slot.name.textContent = player.displayName || '';
    } else {
      slot.name.textContent = '';
    }
    slot.xp.textContent = fmtXp(player.xp);

    // Filter cosmetics for this slot:
    //   • Titles are never shown on the podium (too noisy in the compact row).
    //   • Slots 4-7 ("compact") drop hero_badge so their surface stays plain
    //     — only the top-3 medal slots get the full card-background treatment.
    let cos = player.cosmetics ? { ...player.cosmetics } : {};
    delete cos.title;
    if (slot.rank > DETAILED_SLOTS) delete cos.hero_badge;

    applyCosmetics({
      nameEl: slot.name,
      avatarEl: slot.avatar,
      avatarHostEl: slot.avatarHost,
      surfaceEl: slot.surface,
      titleContainer: slot.titleContainer,
      avatarSize: 96,
    }, cos);
  }
}
