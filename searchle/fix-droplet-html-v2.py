import sys

path = '/opt/searchle/client/index.html'
with open(path, 'r') as f:
    content = f.read()

# Replace desktop-only @media block with universal rules
old_css = '''    /* Desktop: hide Previous Guesses, disable scroll-wrap (3D game handles scrolling) */
    @media (pointer: fine) {
      #scroll-wrap{overflow:hidden;}
      #guesses-section{display:none;}
    }'''

new_css = '''    /* Hide Previous Guesses section — 3D game handles all scrolling */
    #scroll-wrap{overflow:hidden !important;}
    #guesses-section{display:none;}'''

if old_css not in content:
    print('ERROR: Could not find @media (pointer: fine) block')
    sys.exit(1)
content = content.replace(old_css, new_css)
print('Replaced desktop-only CSS with universal rules')

with open(path, 'w') as f:
    f.write(content)
print('Done')
