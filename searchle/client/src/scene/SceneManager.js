// ===== Scene Manager =====
// Dual renderer: CSS3DRenderer (UI) + WebGLRenderer (3D geometry/particles).
// Perspective camera with tilt for true 3D depth.
// Hybrid animation loop: RAF when visible, setTimeout when hidden,
// ensuring animations run even in OBS browser sources / background tabs.

import * as THREE from 'three';
import { CameraController } from './CameraController.js';
import { DOMRenderer } from '../ui/DOMRenderer.js';
import { isMobile, isOBS } from '../utils/Mobile.js';

// Fallback frame rate when tab is hidden (ms between frames)
const HIDDEN_FRAME_INTERVAL = 33; // ~30fps — enough for smooth spring physics
// OBS frame rate cap — 30fps is plenty for a stream overlay and halves GPU load
const OBS_FRAME_INTERVAL = 33;

export class SceneManager {
  constructor(config) {
    this.config = config;
    this.scene = new THREE.Scene();
    this._updateCallbacks = [];
    this._running = false;
    this._frameCount = 0;

    // Manual delta tracking (replaces THREE.Clock to avoid accumulated time issues)
    this._lastTime = 0;
    this._rafId = null;
    this._timeoutId = null;
    this._hidden = document.hidden;

    // Camera (perspective for 3D depth)
    this.cameraController = new CameraController(config.baseWidth);
    this.camera = this.cameraController.camera;

    // WebGL Renderer — 3D geometry, particles, background
    // Mobile: request low-power GPU, cap pixel ratio at 1.5 to save fill rate
    this.webglRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: isMobile ? 'low-power' : 'default',
    });
    this.webglRenderer.setClearColor(0x000000, 0);
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    this.webglRenderer.domElement.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    this.webglRenderer.domElement.id = 'webgl-canvas';
    document.body.appendChild(this.webglRenderer.domElement);

    // DOM Renderer — UI elements positioned via direct CSS transforms
    this.domRenderer = new DOMRenderer(config.baseWidth);
    document.body.appendChild(this.domRenderer.domElement);

    // Lighting for WebGL 3D objects
    const ambientLight = new THREE.AmbientLight(0x334455, 0.6);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x22d3ee, 1.5, 3600);
    pointLight.position.set(config.baseWidth / 2, -900, 1350);
    this.scene.add(pointLight);

    const accentLight = new THREE.PointLight(0xfbbf24, 0.8, 2700);
    accentLight.position.set(config.baseWidth * 0.8, -450, 900);
    this.scene.add(accentLight);

    // Viewport scaling
    this._applyViewportScale();
    window.addEventListener('resize', () => this._onResize());

    // Visibility change listener for hybrid loop
    document.addEventListener('visibilitychange', () => this._onVisibilityChange());
  }

  _applyViewportScale() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let scale = w / this.config.baseWidth;
    let baseH = Math.round(h / scale);

    // Landscape/desktop: prevent extreme zoom-in when viewport is wider than tall.
    // Cap so at least baseWidth vertical units are visible (1:1 aspect minimum).
    // Content (1800px) stays centered with margins on the sides.
    const minBaseH = this.config.baseWidth;
    let cameraW = this.config.baseWidth;
    if (baseH < minBaseH) {
      baseH = minBaseH;
      scale = h / baseH;
      cameraW = Math.round(w / scale);
    }

    // Desktop browser: cap scale so larger windows don't zoom in more.
    // Skip for OBS browser source and ?transparent overlay — they need full-scale rendering.
    if (!isMobile && !isOBS) {
      const maxScale = 0.25;
      if (scale > maxScale) {
        scale = maxScale;
        baseH = Math.round(h / scale);
        cameraW = Math.round(w / scale);
      }
    } else if (isOBS) {
      // OBS / ?obs=1 / ?transparent: previously uncapped so streamers
      // could use any OBS canvas size. But the grid.subtextle.com
      // preview (and any iframe-embedded view) widens with the parent
      // viewport, making the chrome (header / podium / pinned card)
      // and the chip grid below grow together. Cap at 1.0 so the scene
      // stops zooming in once the viewport hits baseWidth (1800px).
      // Below 1800px the scene still scales naturally; above, it locks
      // at OBS-default sizing.
      const obsMaxScale = 1.0;
      if (scale > obsMaxScale) {
        scale = obsMaxScale;
        baseH = Math.round(h / scale);
        cameraW = Math.round(w / scale);
      }
    }

    this.cameraController.resize(cameraW, baseH, this.config.baseWidth);
    this.webglRenderer.setSize(w, h);
    this.domRenderer.resize({ scale, width: this.config.baseWidth, height: baseH });

    // Store viewport info (content width, not camera width)
    this.viewport = { width: this.config.baseWidth, height: baseH, scale };

    // CSS variables
    document.documentElement.style.setProperty('--base-width', this.config.baseWidth + 'px');
    document.documentElement.style.setProperty('--base-height', baseH + 'px');
  }

  _onResize() {
    this._applyViewportScale();
  }

  onUpdate(callback) {
    this._updateCallbacks.push(callback);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._hidden = document.hidden;
    this._scheduleNext();
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  _onVisibilityChange() {
    if (!this._running) return;

    const nowHidden = document.hidden;
    if (nowHidden === this._hidden) return;
    this._hidden = nowHidden;

    // Reset timestamp to prevent a large delta spike on transition
    this._lastTime = performance.now();

    // Cancel whichever scheduler was active
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    // Start the appropriate loop
    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this._running) return;

    if (this._hidden || isOBS) {
      // Tab hidden or OBS: use setTimeout — 30fps is enough for overlay/background
      const interval = this._hidden ? HIDDEN_FRAME_INTERVAL : OBS_FRAME_INTERVAL;
      this._timeoutId = setTimeout(() => {
        this._timeoutId = null;
        this._tick();
        this._scheduleNext();
      }, interval);
    } else {
      // Tab visible: use RAF for vsync'd rendering
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._tick();
        this._scheduleNext();
      });
    }
  }

  _tick() {
    const now = performance.now();
    const delta = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Safety cap: clamp unreasonably large deltas (debugger pause, system sleep)
    const safeDelta = Math.min(delta, 0.05);

    for (const cb of this._updateCallbacks) {
      cb(safeDelta);
    }

    // Mobile: skip WebGL render every other frame — stars/decorations don't need 60fps
    // CSS3D always renders for smooth spring physics on UI bubbles
    this._frameCount++;
    if ((!isMobile && !isOBS) || (this._frameCount & 1) === 0) {
      this.webglRenderer.render(this.scene, this.camera);
    }
  }
}
