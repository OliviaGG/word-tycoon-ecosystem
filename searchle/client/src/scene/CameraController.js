// ===== Camera Controller =====
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
