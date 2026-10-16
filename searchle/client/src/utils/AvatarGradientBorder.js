// Gradient borders must preserve background-painted Word Tycoon logo avatars.
// A content-clipped image/color sits above the border-clipped cosmetic gradient.
const avatarBorderBackgrounds = new WeakMap();
const avatarBackgroundProperties = ['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundOrigin', 'backgroundClip'];

export function resetAvatarGradientBorder(avatar) {
  if (!avatar) return;
  const saved = avatarBorderBackgrounds.get(avatar);
  if (!saved) return;
  for (const property of avatarBackgroundProperties) avatar.style[property] = saved[property];
  avatarBorderBackgrounds.delete(avatar);
}

export function applyAvatarGradientBorder(avatar, border) {
  if (!avatar || !border?.backgroundImage) return;
  const saved = Object.fromEntries(avatarBackgroundProperties.map(property => [property, avatar.style[property]]));
  avatarBorderBackgrounds.set(avatar, saved);
  const fill = avatar.style.backgroundColor || '#15202b';
  const image = saved.backgroundImage && saved.backgroundImage !== 'none' ? saved.backgroundImage : `linear-gradient(${fill}, ${fill})`;
  avatar.style.backgroundImage = `${image}, ${border.backgroundImage}`;
  avatar.style.backgroundSize = `${saved.backgroundSize || 'auto'}, ${border.backgroundSize || '100% 100%'}`;
  avatar.style.backgroundPosition = `${saved.backgroundPosition || 'center'}, center`;
  avatar.style.backgroundRepeat = `${saved.backgroundRepeat || 'no-repeat'}, no-repeat`;
  avatar.style.backgroundOrigin = 'content-box, border-box';
  avatar.style.backgroundClip = 'content-box, border-box';

  if (border.animation?.includes('cfx-spin')) {
    if (!document.getElementById('searchle-avatar-gradient-animation')) {
      const style = document.createElement('style');
      style.id = 'searchle-avatar-gradient-animation';
      style.textContent = '@property --cfx-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; } @keyframes searchle-profile-border-spin { from { --cfx-a: 0deg; } to { --cfx-a: 360deg; } }';
      document.head.appendChild(style);
    }
    avatar.style.animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'none'
      : border.animation.replace(/\bcfx-spin\b/g, 'searchle-profile-border-spin');
  }
}
