// ===== Avatar Logo Detection =====
// Mirrors the portal's resolveAvatar / isLogoUrl / markAvatarFallback logic
// at /opt/chat-relay/public/portal/js/portal.js so Searchle renders the WT
// logo at the right size when it's used as someone's pfp.
//
// The WT logo image isn't a perfect circle — there's a small Scrabble tile
// at the top that sticks out past the boundary. Regular img sizing inside a
// circular crop ends up showing the visible part smaller than other pfps.
// The fix is two-fold:
//   • scale the img up 1.35x with object-fit:contain so it doesn't crop
//   • set the wrap to overflow:visible + transparent background so the
//     overflowing tile doesn't get clipped by the circle border
//
// Apply via markAvatarLogo(imgEl, wrapEl) anywhere a player pfp is rendered.

export function isLogoUrl(url) {
  if (!url) return false;
  return url.indexOf('logo.png') !== -1 || url.indexOf('/profile-logos/') !== -1;
}

// 1×1 transparent gif used as the img src placeholder — keeps the element's
// layout box (and its inline-style border from cosmetic profile_border)
// while the actual logo art renders via background-image at a larger
// background-size so the transparent padding around the logo art gets
// cropped out. Without this, the cosmetic border sits at the slot edge
// and the visible logo content (which has natural transparent padding in
// the source PNG) leaves a visible gap inside the ring.
const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

// Toggles 'is-logo' on the img and 'has-logo' on the wrap so CSS can apply
// the layout rules. For logo URLs also moves the image to background-image
// at a 130% size — that zooms past the natural transparent padding around
// the logo art so it visually fills the slot, leaving no gap between the
// logo edge and any cosmetic profile_border ring.
//
// Safe to call repeatedly: tracks original src in dataset.origSrc and
// restores when the URL stops matching the logo pattern.
export function markAvatarLogo(imgEl, wrapEl) {
  if (!imgEl) return;
  const currentSrc = imgEl.dataset.origSrc || imgEl.src;
  const isLogo = !!(currentSrc && isLogoUrl(currentSrc));
  imgEl.classList.toggle('is-logo', isLogo);
  if (wrapEl) wrapEl.classList.toggle('has-logo', isLogo);

  if (isLogo && imgEl.tagName === 'IMG') {
    if (!imgEl.dataset.origSrc) {
      imgEl.dataset.origSrc = imgEl.src;
      imgEl.style.backgroundImage = `url("${imgEl.src}")`;
      // 115% zoom: crops just enough natural transparent padding to
      // tighten the cosmetic-border gap noticeably without visibly
      // clipping the logo art itself. 130% was the sweet spot for
      // profile-logo cosmetics with heavy padding but cropped the
      // WT logo edges. 115% is a compromise that works for both.
      imgEl.style.backgroundSize = '115%';
      imgEl.style.backgroundPosition = 'center';
      imgEl.style.backgroundRepeat = 'no-repeat';
      imgEl.src = TRANSPARENT_GIF;
    }
  } else if (imgEl.tagName === 'IMG' && imgEl.dataset.origSrc) {
    // No longer a logo — restore the original src and clear background.
    imgEl.src = imgEl.dataset.origSrc;
    delete imgEl.dataset.origSrc;
    imgEl.style.backgroundImage = '';
    imgEl.style.backgroundSize = '';
    imgEl.style.backgroundPosition = '';
    imgEl.style.backgroundRepeat = '';
  }
}
