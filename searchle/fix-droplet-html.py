import sys

path = '/opt/searchle/client/index.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Replace dynamic viewport script with simple static one
old_viewport = '''  <script>
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !/OBS/i.test(navigator.userAgent)) {
    // Mobile viewport: force desktop-like width to avoid CSS3D downscaling.
    // Landscape: scale viewport width proportionally so elements stay the same
    // physical size as portrait (like Contexto). Content stays centered, you just
    // see less vertical area — natural for landscape.
    function updateViewport() {
      var shorter = Math.min(screen.width, screen.height);
      var longer = Math.max(screen.width, screen.height);
      var isLandscape = window.matchMedia('(orientation: landscape)').matches;
      var vpWidth = isLandscape ? Math.round(980 * longer / shorter) : 980;
      document.querySelector('meta[name=viewport]').content =
        'width=' + vpWidth + ', interactive-widget=overlays-content';
    }
    updateViewport();
    window.matchMedia('(orientation: landscape)').addEventListener('change', function() {
      setTimeout(updateViewport, 100);
    });
    if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;
  }
  </script>'''

new_viewport = '''  <script>
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !/OBS/i.test(navigator.userAgent)) {
    // width=980: force desktop-like viewport to avoid extreme CSS3D downscaling
    // interactive-widget=overlays-content: keyboard overlays page instead of scrolling it
    document.querySelector('meta[name="viewport"]').content = 'width=980, interactive-widget=overlays-content';
    // VirtualKeyboard API (Chrome 94+): belt-and-suspenders approach
    if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;
  }
  </script>'''

if old_viewport not in content:
    print('ERROR: Could not find old viewport script')
    sys.exit(1)
content = content.replace(old_viewport, new_viewport)
print('Viewport script reverted to static 980')

# 2. Add desktop CSS to hide Previous Guesses and disable scroll-wrap scrolling
old_spacer = '    /* ─── Spacer: transparent area over the fixed 3D game ─── */\n    #game-spacer{height:100vh;}'
new_spacer = '''    /* ─── Spacer: transparent area over the fixed 3D game ─── */
    #game-spacer{height:100vh;}

    /* Desktop: hide Previous Guesses, disable scroll-wrap (3D game handles scrolling) */
    @media (pointer: fine) {
      #scroll-wrap{overflow:hidden;}
      #guesses-section{display:none;}
    }'''

if old_spacer not in content:
    print('ERROR: Could not find game-spacer CSS')
    sys.exit(1)
content = content.replace(old_spacer, new_spacer)
print('Desktop CSS added')

with open(path, 'w') as f:
    f.write(content)
print('Done')
