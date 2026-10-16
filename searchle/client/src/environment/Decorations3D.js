// ===== 3D Decorations =====
// Wireframe shapes, glow orbs, and grid that give the scene 3D depth.

import * as THREE from 'three';
import { isMobile } from '../utils/Mobile.js';

export class Decorations3D {
  constructor(scene, viewport) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.viewport = viewport;
    this._items = [];

    this._createWireframes();
    if (!isMobile) {
      // Mobile: skip glow orbs (6 extra spheres) and grid (1800+ line segments)
      this._createGlowOrbs();
      this._createGrid();
    }
  }

  _createWireframes() {
    const w = this.viewport.width;
    const h = this.viewport.height;

    const shapes = [
      { geo: new THREE.IcosahedronGeometry(25, 0), pos: [-30, -80, -80], color: 0x22d3ee, speed: 0.3 },
      { geo: new THREE.OctahedronGeometry(18, 0), pos: [w + 20, -250, -120], color: 0xa855f7, speed: 0.4 },
      { geo: new THREE.TorusKnotGeometry(12, 3, isMobile ? 32 : 64, isMobile ? 4 : 8), pos: [-20, -h + 80, -100], color: 0xfbbf24, speed: 0.2 },
      { geo: new THREE.TetrahedronGeometry(20, 0), pos: [w + 10, -h + 120, -60], color: 0x22d3ee, speed: 0.35 },
    ];

    for (const { geo, pos, color, speed } of shapes) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      this.group.add(mesh);

      const axis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();

      this._items.push({ mesh, speed, axis, type: 'wireframe' });
    }
  }

  _createGlowOrbs() {
    const w = this.viewport.width;
    const h = this.viewport.height;

    const orbConfigs = [
      { pos: [w * 0.1, -150, -50], color: 0x22d3ee },
      { pos: [w * 0.9, -h * 0.5, -70], color: 0xa855f7 },
      { pos: [w * 0.5, -h + 60, -40], color: 0xfbbf24 },
    ];

    for (const { pos, color } of orbConfigs) {
      // Core sphere
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(3, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 })
      );
      core.position.set(pos[0], pos[1], pos[2]);
      this.group.add(core);

      // Outer glow shell
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(8, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 })
      );
      glow.position.set(pos[0], pos[1], pos[2]);
      this.group.add(glow);

      this._items.push({ mesh: core, glow, baseY: pos[1], type: 'orb' });
    }
  }

  _createGrid() {
    const w = this.viewport.width;
    const h = this.viewport.height;
    const gridSize = Math.max(w, h) * 2;

    const grid = new THREE.GridHelper(gridSize, 30, 0x22d3ee, 0x1a1a2e);
    grid.material.transparent = true;
    grid.material.opacity = 0.1;
    // Rotate to XY plane (facing camera) and position behind content
    grid.rotation.x = Math.PI / 2;
    grid.position.set(w / 2, -h / 2, -200);
    this.group.add(grid);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(delta) {
    const time = performance.now() * 0.001;

    for (const item of this._items) {
      if (item.type === 'wireframe') {
        item.mesh.rotateOnAxis(item.axis, delta * item.speed);
      } else if (item.type === 'orb') {
        const bobY = Math.sin(time * 0.5 + item.baseY * 0.01) * 5;
        item.mesh.position.y = item.baseY + bobY;
        if (item.glow) item.glow.position.y = item.baseY + bobY;
      }
    }
  }
}
