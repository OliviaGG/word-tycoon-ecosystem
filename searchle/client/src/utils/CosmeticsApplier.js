// ===== Cosmetics Applier =====
// Apply WiPGaMe cosmetics to guess entry DOM elements.

import { isOBS } from './Mobile.js';
import { applyAvatarGradientBorder, resetAvatarGradientBorder } from './AvatarGradientBorder.js';

// ===== Viewer Visibility Filter =====
// When a logged-in user views the game page (SP mode), their cosmetic_visibility
// preferences apply globally to ALL entries. E.g., if the viewer has word_color OFF,
// no entries show word colors.
const DEFAULT_VIEWER_VISIBILITY = Object.freeze({ word_color: false, word_glow: false });
let _viewerVisibility = { ...DEFAULT_VIEWER_VISIBILITY };
// Default word suppression is for text readability. Panel frames are visible
// by default, while explicit viewer preferences still apply to them.
let _viewerPanelVisibility = {};
const COSMETIC_LAYER_SELECTOR = '.searchle-cosmetic-layer';

function markTitleLength(titleEl, title) {
  const length = Array.from(String(title || '').trim()).length;
  titleEl.dataset.titleLength = String(length);
  if (length >= 30) titleEl.classList.add('cosmetic-title--xxlong');
  else if (length >= 22) titleEl.classList.add('cosmetic-title--xlong');
  else if (length >= 16) titleEl.classList.add('cosmetic-title--long');
}

export function setViewerVisibility(vis) {
  _viewerPanelVisibility = vis && typeof vis === 'object' ? { ...vis } : {};
  _viewerVisibility = vis && typeof vis === 'object'
    ? { ...vis }
    : { ...DEFAULT_VIEWER_VISIBILITY };
}

function getHubAssetBase() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return 'https://wordtycoon.live';
}

function resolveCosmeticAsset(asset) {
  if (!asset) return '';
  if (/^https?:\/\//i.test(asset)) return asset;
  if (asset.startsWith('/portal/')) return getHubAssetBase() + asset;
  return asset;
}

function clearRenderLayers(host) {
  if (!host) return;
  host.querySelectorAll(COSMETIC_LAYER_SELECTOR).forEach((node) => node.remove());
}

function ensureRenderHost(host) {
  if (!host) return;
  const computed = window.getComputedStyle(host);
  if (computed.position === 'static') host.style.position = 'relative';
  if (!host.dataset.cosmeticOverflowPinned) {
    host.dataset.cosmeticOverflowPinned = '1';
    if (computed.overflow === 'hidden') host.style.overflow = 'visible';
  }
}

function buildRenderLayer(spec, layerKind) {
  if (!spec || !spec.render) return null;
  const render = spec.render;
  const el = document.createElement(render.type === 'image_overlay' ? 'img' : 'div');
  el.className = `searchle-cosmetic-layer searchle-cosmetic-layer--${layerKind} searchle-cosmetic-layer--${render.type}`;
  el.dataset.renderType = render.type;
  el.style.zIndex = String(render.zIndex || (layerKind === 'frame' ? 1 : 0));

  const assetUrl = resolveCosmeticAsset(render.asset);
  if (assetUrl) {
    if (el.tagName === 'IMG') {
      el.src = assetUrl;
      el.alt = '';
    } else {
      el.style.backgroundImage = `url("${assetUrl}")`;
    }
  }

  if (render.type === 'animated_gradient' && render.background) {
    el.style.background = render.background;
  }
  if (render.backgroundSize) el.style.backgroundSize = render.backgroundSize;
  if (render.backgroundPosition) el.style.backgroundPosition = render.backgroundPosition;
  if (render.backgroundRepeat) el.style.backgroundRepeat = render.backgroundRepeat;
  if (render.opacity != null) el.style.opacity = String(render.opacity);
  if (render.blend) el.style.mixBlendMode = render.blend;
  if (render.animation) el.style.animation = render.animation;
  if (render.inset != null) el.style.inset = render.inset;

  return el;
}

function applyRenderLayer(host, spec, layerKind) {
  if (!host || !spec || !spec.render) return;
  ensureRenderHost(host);
  const layer = buildRenderLayer(spec, layerKind);
  if (!layer) return;
  if (layerKind === 'surface') host.prepend(layer);
  else host.appendChild(layer);
}

// Scale px values in CSS strings proportionally to avatar size.
// Reference size: 80px — cosmetic values are authored for this baseline.
const COSMETIC_REF_SIZE = 80;
function scaleCosmeticPx(cssValue, avatarSize) {
  if (!cssValue || !avatarSize || avatarSize <= 0) return cssValue;
  const scale = avatarSize / COSMETIC_REF_SIZE;
  if (Math.abs(scale - 1) < 0.05) return cssValue; // skip if ~1x
  return cssValue.replace(/(\d+(?:\.\d+)?)px/g, (m, n) => {
    return Math.max(1, Math.round(parseFloat(n) * scale)) + 'px';
  });
}

// Dark outline via multi-directional text-shadow instead of webkit-text-stroke.
// text-stroke draws BETWEEN letter shapes causing ugly artifacts at ligatures/junctions.
// 8-direction shadow creates a clean outline around the outside only.
const OUTLINE_SHADOW = [
  '-7px -7px 3px #000', '7px -7px 3px #000',
  '-7px  7px 3px #000', '7px  7px 3px #000',
  '0 -7px 3px #000',    '0  7px 3px #000',
  '-7px  0 3px #000',    '7px  0 3px #000'
].join(', ');

// Outline disabled — return existing shadow as-is so base color/glow shows alone
function withOutline(existing) {
  return existing || '';
}

function ensureRoundFilter() {
  if (!document.getElementById('wc-round')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0';
    svg.innerHTML = '<filter id="wc-round" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="3" in="SourceGraphic" result="d"/><feMorphology operator="erode" radius="3" in="d"/></filter>';
    document.body.appendChild(svg);
  }
}

function resetWordStyles(wordEl) {
  if (!wordEl) return;
  cancelTemporaryWordCosmetics(wordEl);
  wordEl.style.color = '';
  wordEl.style.webkitTextStroke = '';
  wordEl.style.paintOrder = '';
  wordEl.style.letterSpacing = '';
  wordEl.style.textShadow = '';
  wordEl.style.animation = '';
}

function resetNameStyles(nameEl) {
  if (!nameEl) return;
  nameEl.style.color = '';
  nameEl.style.textShadow = '';
  nameEl.style.animation = '';
}

function resetAvatarStyles(avatarEl) {
  if (!avatarEl) return;
  resetAvatarGradientBorder(avatarEl);
  avatarEl.style.border = '';
  avatarEl.style.boxShadow = '';
  avatarEl.style.animation = '';
  delete avatarEl.dataset.borderShadow;
}

function resetSurfaceStyles(surfaceEl) {
  if (!surfaceEl) return;
  surfaceEl.style.background = '';
  surfaceEl.style.backgroundSize = '';
  surfaceEl.style.animation = '';
}

export function applyCosmetics(els, cos) {
  if (!cos) return;
  // Never mutate the shared equipped cosmetics object attached to guesses/users.
  // We only want to filter categories for this specific render target.
  cos = { ...cos };

  // Guess rows route word cosmetics to the slanted frame. Do this before
  // the OBS text suppression: the word itself stays white in every mode.
  if (els.wordFrameEl) {
    const wc = _viewerPanelVisibility.word_color === false ? null : cos.word_color;
    const wg = _viewerPanelVisibility.word_glow === false ? null : cos.word_glow;
    const frame = els.wordFrameEl;
    frame.style.backgroundColor = wc?.color || '';
    frame.style.backgroundImage = wc?.backgroundImage || '';
    frame.style.backgroundSize = wc?.backgroundSize || '';
    frame.style.animation = wc?.animation || '';
    if (els.wordGlowEl) {
      // text-shadow and drop-shadow share offset/blur/color syntax. Apply
      // each authored glow to the clipped silhouette, not its bounding box.
      const shadows = scaleCosmeticPx(wg?.textShadow || '', 153);
      els.wordGlowEl.style.filter = shadows
        ? shadows.split(/,(?![^()]*\))/).map(s => `drop-shadow(${s.trim()})`).join(' ')
        : '';
    }
    delete cos.word_color;
    delete cos.word_glow;
  }

  // Get avatar size for proportional border/glow scaling
  // Use explicit avatarSize if provided (element may not be in DOM yet)
  const avatarSize = els.avatarSize || (els.avatarEl ? (els.avatarEl.offsetWidth || els.avatarEl.clientWidth || 0) : 0);

  // OBS overlay: suppress word_color/word_glow for eyestrain reduction
  if (isOBS) {
    delete cos.word_color;
    delete cos.word_glow;
  }

  // Viewer visibility: suppress categories the logged-in viewer has turned OFF
  if (_viewerVisibility) {
    for (const cat of Object.keys(_viewerVisibility)) {
      if (_viewerVisibility[cat] === false) delete cos[cat];
    }
  }

  // Always clear prior inline cosmetic styles first so disabled categories
  // disappear on rerender instead of sticking from an earlier render pass.
  resetWordStyles(els.wordEl);
  resetNameStyles(els.nameEl);
  resetAvatarStyles(els.avatarEl);
  resetSurfaceStyles(els.surfaceEl);
  const avatarHost = els.avatarHostEl || (els.avatarEl ? els.avatarEl.parentElement : null);
  clearRenderLayers(avatarHost);
  clearRenderLayers(els.surfaceEl);

  if (els.titleContainer) {
    for (const node of els.titleContainer.querySelectorAll('.cosmetic-title')) {
      node.remove();
    }
  }

  if (cos.word_color && els.wordEl) {
    if (cos.word_color.color) {
      els.wordEl.style.color = cos.word_color.color;
    }
    els.wordEl.style.textShadow = withOutline(cos.word_color.textShadow || '');
    if (cos.word_color.animation) els.wordEl.style.animation = cos.word_color.animation;
  }
  if (cos.word_glow && els.wordEl) {
    if (cos.word_glow.textShadow) {
      // Merge glow with existing outline+color shadows
      const existing = els.wordEl.style.textShadow;
      els.wordEl.style.textShadow = existing ? existing + ', ' + cos.word_glow.textShadow : withOutline(cos.word_glow.textShadow);
    }
    if (cos.word_glow.animation && !els.wordEl.style.animation) els.wordEl.style.animation = cos.word_glow.animation;
  }
  if (cos.profile_border && els.avatarEl) {
    if (cos.profile_border.border) els.avatarEl.style.border = scaleCosmeticPx(cos.profile_border.border, avatarSize);
    if (cos.profile_border.boxShadow) els.avatarEl.dataset.borderShadow = scaleCosmeticPx(cos.profile_border.boxShadow, avatarSize);
    if (cos.profile_border.animation) els.avatarEl.style.animation = cos.profile_border.animation;
    applyAvatarGradientBorder(els.avatarEl, cos.profile_border);
    applyRenderLayer(avatarHost, cos.profile_border, 'frame');
  }
  if (cos.profile_glow && els.avatarEl) {
    const bs = els.avatarEl.dataset.borderShadow || '';
    const scaledGlow = scaleCosmeticPx(cos.profile_glow.boxShadow, avatarSize);
    const combined = [bs, scaledGlow].filter(Boolean).join(', ');
    els.avatarEl.style.boxShadow = combined;
    if (cos.profile_glow.animation && !els.avatarEl.style.animation) els.avatarEl.style.animation = cos.profile_glow.animation;
  } else if (cos.profile_border && els.avatarEl && els.avatarEl.dataset.borderShadow) {
    els.avatarEl.style.boxShadow = els.avatarEl.dataset.borderShadow;
  }
  if (cos.name_color && els.nameEl) {
    if (cos.name_color.color) els.nameEl.style.color = cos.name_color.color;
    els.nameEl.style.textShadow = withOutline(cos.name_color.textShadow || '');
    if (cos.name_color.animation) els.nameEl.style.animation = cos.name_color.animation;
  }
  if (cos.name_glow && els.nameEl) {
    if (cos.name_glow.textShadow) {
      const existing = els.nameEl.style.textShadow;
      els.nameEl.style.textShadow = existing ? existing + ', ' + cos.name_glow.textShadow : withOutline(cos.name_glow.textShadow);
    }
    if (cos.name_glow.animation && !els.nameEl.style.animation) els.nameEl.style.animation = cos.name_glow.animation;
  }
  // Hero badge — apply background gradient to a surface/container element
  if (cos.hero_badge && els.surfaceEl) {
    if (cos.hero_badge.background) {
      els.surfaceEl.style.background = cos.hero_badge.background;
      if (cos.hero_badge.backgroundSize) els.surfaceEl.style.backgroundSize = cos.hero_badge.backgroundSize;
      if (cos.hero_badge.animation) els.surfaceEl.style.animation = cos.hero_badge.animation;
    }
    applyRenderLayer(els.surfaceEl, cos.hero_badge, 'surface');
  }
  if (cos.title && cos.title.title && els.titleContainer) {
    const titleEl = document.createElement('span');
    titleEl.className = 'cosmetic-title';
    titleEl.textContent = cos.title.title;
    markTitleLength(titleEl, cos.title.title);
    if (cos.title.titleColor) titleEl.style.color = cos.title.titleColor;
    titleEl.style.textShadow = withOutline(cos.title.titleGlow || '');
    if (cos.title.animation) titleEl.style.animation = cos.title.animation;
    els.titleContainer.appendChild(titleEl);
  }
}

// ===== Temporary word cosmetic flash =====
// Apply word_color / word_glow for a short hold, then fade the word back
// to its default white text. Used on new guess chips in both regular and
// grid modes so cosmetics flash without permanently obscuring the word.
const WORD_COSMETIC_TIMERS = new WeakMap();

function cancelTemporaryWordCosmetics(wordEl) {
  const state = WORD_COSMETIC_TIMERS.get(wordEl);
  if (!state) return;
  clearTimeout(state.holdTimer);
  if (state.animation) state.animation.cancel();
  WORD_COSMETIC_TIMERS.delete(wordEl);
}

export function applyTemporaryWordCosmetics(wordEl, cosmetics, options = {}) {
  if (!wordEl) return;

  const holdMs = options.holdMs ?? 3500;
  const fadeMs = options.fadeMs ?? 800;

  // Cancel any previous fade sequence for this word element.
  cancelTemporaryWordCosmetics(wordEl);

  // Clear prior cosmetic styles first.
  wordEl.classList.remove('word-cosmetic-fade-out');
  wordEl.style.color = '';
  wordEl.style.textShadow = '';
  wordEl.style.animation = '';

  if (!cosmetics) return;

  const wc = cosmetics.word_color;
  const wg = cosmetics.word_glow;
  if (!wc && !wg) return;

  if (wc) {
    if (wc.color) wordEl.style.color = wc.color;
    if (wc.textShadow) wordEl.style.textShadow = wc.textShadow;
    if (wc.animation) wordEl.style.animation = wc.animation;
  }
  if (wg && wg.textShadow) {
    const existingShadow = wordEl.style.textShadow;
    wordEl.style.textShadow = existingShadow
      ? existingShadow + ', ' + wg.textShadow
      : wg.textShadow;
  }
  if (wg && wg.animation && !wordEl.style.animation) {
    wordEl.style.animation = wg.animation;
  }

  const state = { holdTimer: null, animation: null };
  state.holdTimer = setTimeout(() => {
    // Snapshot the actual animated frame BEFORE stopping the cosmetic.
    // Removing its CSS animation first snaps back to the inline color/glow.
    const visible = getComputedStyle(wordEl);
    const from = {
      color: visible.color,
      textShadow: visible.textShadow,
      opacity: visible.opacity,
      filter: visible.filter,
    };
    wordEl.style.color = '';
    wordEl.style.textShadow = '';
    wordEl.style.animation = '';
    // Use the real stylesheet defaults (including the neon readability
    // shadow), so finishing the animation doesn't introduce a second jump.
    const baseline = getComputedStyle(wordEl);
    const to = {
      color: baseline.color,
      textShadow: baseline.textShadow,
      opacity: baseline.opacity,
      filter: baseline.filter,
    };
    if (!wordEl.isConnected || fadeMs <= 0 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      WORD_COSMETIC_TIMERS.delete(wordEl);
      return;
    }
    // Both style updates and this animation start in the same task; the
    // intermediate cleared styles never paint. Only one finite fade runs.
    state.animation = wordEl.animate([from, to], {
      duration: fadeMs,
      easing: 'ease-out',
    });
    state.animation.onfinish = () => {
      if (WORD_COSMETIC_TIMERS.get(wordEl) === state) {
        WORD_COSMETIC_TIMERS.delete(wordEl);
      }
    };
  }, holdMs);

  WORD_COSMETIC_TIMERS.set(wordEl, state);
}
