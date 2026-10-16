let textContext;

// Inline-size containment enables compact-panel queries, but hides intrinsic
// text width from flexbox. Supply the username's preferred width explicitly.
export function observeGuessPanelSize(entry, element) {
  if (entry._guessPanelSizer) {
    entry._guessPanelSizer.refresh();
    return;
  }
  const panel = element.querySelector('.guess-user');
  const name = panel?.querySelector('.user-name');
  if (!name) return;
  let frame = 0;
  const refresh = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!element.isConnected) return;
      const style = getComputedStyle(name);
      const panelStyle = getComputedStyle(panel);
      textContext ||= document.createElement('canvas').getContext('2d');
      textContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      textContext.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const textWidth = textContext.measureText(name.textContent || '').width;
      const avatar = panel.querySelector('.guess-pic-wrap');
      const icon = panel.querySelector('.platform-icon');
      const width = Math.ceil(textWidth + (avatar?.offsetWidth || 153)
        + (icon ? Number(icon.getAttribute('width')) || 63 : 0)
        + parseFloat(panelStyle.paddingLeft) + parseFloat(panelStyle.paddingRight)
        + parseFloat(panelStyle.columnGap) * (icon ? 2 : 1) + 2);
      const value = `${width}px`;
      if (panel.style.getPropertyValue('--guess-panel-width') !== value) {
        panel.style.setProperty('--guess-panel-width', value);
      }
      // Actual flex layout includes compact panels and long words. Keep the
      // rank fill outside the plain player artwork, including its soft rim.
      const waterWidth = `${Math.max(0, panel.offsetLeft)}px`;
      if (element.style.getPropertyValue('--guess-water-width') !== waterWidth) {
        element.style.setProperty('--guess-water-width', waterWidth);
      }
    });
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(panel);
  observer.observe(name);
  document.fonts.addEventListener('loadingdone', refresh);
  entry._guessPanelSizer = {
    refresh,
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.fonts.removeEventListener('loadingdone', refresh);
    },
  };
  refresh();
}
