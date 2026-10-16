import sys

# Fix CameraController to support content centering separate from viewport
cam_path = '/opt/searchle/client/src/scene/CameraController.js'
with open(cam_path, 'r') as f:
    content = f.read()

new_cam = '''// ===== Camera Controller =====
// Perspective camera with slight tilt for 3D depth feel.
// Coordinate system: (0,0,0) = top-left of UI plane, +X right, -Y down.

import * as THREE from 'three';

export class CameraController {
  constructor(baseWidth = 1800) {
    this.baseWidth = baseWidth;
    this.baseHeight = 2700;
    this.contentWidth = baseWidth; // content to center on (may differ from camera viewport)

    // Perspective camera — gives natural depth
    this.camera = new THREE.PerspectiveCamera(45, baseWidth / 2700, 1, 25000);

    // Position camera to frame the UI plane
    this._updatePosition();
  }

  _updatePosition() {
    // Center camera on content, not on camera viewport width
    const cx = this.contentWidth / 2;
    const cy = -this.baseHeight / 2;

    // Distance calculated to frame the baseHeight at the UI plane (z=0)
    // For FOV=45, distance = (height/2) / tan(FOV/2)
    const vFov = (45 * Math.PI) / 180;
    const dist = (this.baseHeight / 2) / Math.tan(vFov / 2);

    // Slight tilt: camera positioned above and back, looking down at ~8 degrees
    const tiltAngle = 0.14; // ~8 degrees in radians
    this.camera.position.set(
      cx,
      cy + Math.sin(tiltAngle) * dist * 0.3,
      dist
    );
    this.camera.lookAt(cx, cy, 0);
  }

  resize(baseWidth, baseHeight, contentWidth) {
    this.baseWidth = baseWidth;
    this.baseHeight = baseHeight;
    this.contentWidth = contentWidth || baseWidth;
    this.camera.aspect = baseWidth / baseHeight;
    this.camera.updateProjectionMatrix();
    this._updatePosition();
  }
}
'''

with open(cam_path, 'w') as f:
    f.write(new_cam)
print('CameraController updated')

# Fix SceneManager to cap zoom in desktop landscape
sm_path = '/opt/searchle/client/src/scene/SceneManager.js'
with open(sm_path, 'r') as f:
    sm = f.read()

old = '''  _applyViewportScale() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = w / this.config.baseWidth;
    const baseH = Math.round(h / scale);

    this.cameraController.resize(this.config.baseWidth, baseH);
    this.webglRenderer.setSize(w, h);
    this.css3dRenderer.setSize(w, h);

    // Store viewport info
    this.viewport = { width: this.config.baseWidth, height: baseH, scale };

    // CSS variables
    document.documentElement.style.setProperty('--base-width', this.config.baseWidth + 'px');
    document.documentElement.style.setProperty('--base-height', baseH + 'px');
  }'''

new = '''  _applyViewportScale() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let scale = w / this.config.baseWidth;
    let baseH = Math.round(h / scale);

    // Desktop landscape: prevent extreme zoom-in when viewport is wider than tall.
    // Cap so at least baseWidth vertical units are visible (1:1 aspect minimum).
    // Content (1800px) stays centered with margins on the sides.
    // Mobile is excluded — handled by viewport meta tag in index.html.
    const minBaseH = this.config.baseWidth;
    let cameraW = this.config.baseWidth;
    if (!isMobile && baseH < minBaseH) {
      baseH = minBaseH;
      scale = h / baseH;
      cameraW = Math.round(w / scale);
    }

    this.cameraController.resize(cameraW, baseH, this.config.baseWidth);
    this.webglRenderer.setSize(w, h);
    this.css3dRenderer.setSize(w, h);

    // Store viewport info (content width, not camera width)
    this.viewport = { width: this.config.baseWidth, height: baseH, scale };

    // CSS variables
    document.documentElement.style.setProperty('--base-width', this.config.baseWidth + 'px');
    document.documentElement.style.setProperty('--base-height', baseH + 'px');
  }'''

if old not in sm:
    print('ERROR: Could not find old _applyViewportScale in SceneManager.js')
    sys.exit(1)

sm = sm.replace(old, new)

with open(sm_path, 'w') as f:
    f.write(sm)
print('SceneManager updated')
