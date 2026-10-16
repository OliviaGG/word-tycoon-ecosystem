// ===== Background =====
// Multi-layer star field with parallax depth. Always visible for 3D ambiance.

import * as THREE from 'three';
import { isMobile } from '../utils/Mobile.js';

export class Background {
  constructor(scene, viewport) {
    this.group = new THREE.Group();
    this.group.visible = true; // Always on for 3D
    scene.add(this.group);
    this.viewport = viewport;
    this._layers = [];
    this._frameCounter = 0;
    this._createStarLayers();
  }

  _createStarLayers() {
    // Mobile: ~150 stars instead of 420, slightly larger so it doesn't look empty
    const m = isMobile ? 0.35 : 1;
    const configs = [
      { count: Math.round(100 * m), z: -100, speed: 1.5, size: isMobile ? 5 : 4, opacity: 0.7 },
      { count: Math.round(140 * m), z: -300, speed: 0.8, size: isMobile ? 3.5 : 2.5, opacity: 0.45 },
      { count: Math.round(180 * m), z: -500, speed: 0.4, size: isMobile ? 2.5 : 1.5, opacity: 0.25 },
    ];

    for (const cfg of configs) {
      this._createLayer(cfg);
    }
  }

  _createLayer({ count, z, speed, size, opacity }) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const w = this.viewport.width * 1.5;
    const h = this.viewport.height * 1.5;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.25) * w;
      positions[i * 3 + 1] = -((Math.random() - 0.25) * h);
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 80;

      const brightness = 0.3 + Math.random() * 0.5;
      const hue = Math.random();
      if (hue < 0.4) {
        // Cyan
        colors[i * 3] = brightness * 0.13;
        colors[i * 3 + 1] = brightness * 0.83;
        colors[i * 3 + 2] = brightness * 0.93;
      } else if (hue < 0.7) {
        // White
        colors[i * 3] = brightness;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness;
      } else {
        // Purple
        colors[i * 3] = brightness * 0.6;
        colors[i * 3 + 1] = brightness * 0.3;
        colors[i * 3 + 2] = brightness * 0.9;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      size,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.group.add(points);
    this._layers.push({ points, speed, posAttr: geometry.getAttribute('position') });
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(delta) {
    if (!this.group.visible) return;

    // Desktop: update every 2nd frame. Mobile: every 4th frame — saves CPU cycles
    const skipMask = isMobile ? 3 : 1;
    if (++this._frameCounter & skipMask) return;

    // Accumulate skipped frames worth of delta
    const dt = delta * (skipMask + 1);
    const w = this.viewport.width * 1.5;
    const h = this.viewport.height * 1.5;

    for (const layer of this._layers) {
      const arr = layer.posAttr.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += dt * layer.speed * 0.5;
        arr[i + 1] -= dt * layer.speed * 0.3;
        // Wrap around
        if (arr[i] > w * 0.75) arr[i] = -w * 0.25;
        if (arr[i + 1] < -h * 0.75) arr[i + 1] = h * 0.25;
      }
      layer.posAttr.needsUpdate = true;
    }
  }
}
