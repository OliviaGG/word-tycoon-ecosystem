// three-manager.js — Core Three.js orchestrator for Word500 2.0
// Creates a single WebGL canvas behind the DOM game board.
// Coordinates background scene, particle effects, and post-processing.

(function () {
  'use strict';

  // Bail gracefully if Three.js didn't load
  if (typeof THREE === 'undefined') {
    console.warn('[ThreeManager] Three.js not loaded, falling back to Canvas 2D');
    return;
  }

  var ThreeManager = {
    renderer: null,
    bgScene: null,
    fxScene: null,
    bgCamera: null,
    fxCamera: null,
    clock: null,
    canvas: null,
    composer: null,       // post-processing (set by three-postprocessing.js)
    activeEffect: null,
    effectStartTime: 0,
    effectDuration: 0,
    ambientParticles: null,
    backgroundModule: null, // set by three-background.js
    shaderModule: null,     // set by three-shaders.js
    performanceTier: 'auto',
    _currentTier: 'high',
    _frameTimes: [],
    _frameCount: 0,
    _running: false,
    _effectCleanupTimeout: null,
    _registeredEffects: {},
    _gameEventListeners: [],

    init: function () {
      try {
        // Create renderer
        // The game uses a viewport scaling system that transforms <html> with scale().
        // position:fixed inside a transformed parent is relative to that parent, not the viewport.
        // We counteract by applying inverse scale and setting explicit pixel dimensions.
        var gameScale = window.__gameScale || 1;
        var invScale = 1 / gameScale;
        var actualW = window.innerWidth;
        var actualH = window.innerHeight;

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'three-canvas';
        this.canvas.style.cssText =
          'position:fixed;top:0;left:0;z-index:-1;pointer-events:none;' +
          'width:' + actualW + 'px;height:' + actualH + 'px;' +
          'transform-origin:0 0;transform:scale(' + invScale + ');';
        document.body.insertBefore(this.canvas, document.body.firstChild);

        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: false,
          powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(actualW, actualH);
        this.renderer.autoClear = false;
        this.renderer.setClearColor(0x000000, 0);

        // Background scene (3D environment)
        this.bgScene = new THREE.Scene();
        this.bgCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.bgCamera.position.set(0, 0, 50);

        // Effects scene (particles, overlaid on top)
        this.fxScene = new THREE.Scene();
        this.fxCamera = new THREE.OrthographicCamera(
          -window.innerWidth / 2, window.innerWidth / 2,
          window.innerHeight / 2, -window.innerHeight / 2,
          0.1, 100
        );
        this.fxCamera.position.z = 10;

        this.clock = new THREE.Clock();

        // Resize handler
        var self = this;
        window.addEventListener('resize', function () { self.resize(); });

        this._running = true;
        this.animate();

        console.log('[ThreeManager] Initialized successfully');
      } catch (e) {
        console.warn('[ThreeManager] WebGL init failed, falling back to Canvas 2D:', e.message);
        this._running = false;
        if (this.canvas && this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      }
    },

    resize: function () {
      var w = window.innerWidth;
      var h = window.innerHeight;
      var gameScale = window.__gameScale || 1;
      var invScale = 1 / gameScale;

      this.renderer.setSize(w, h);

      // Counteract viewport scaling transform on canvas
      if (this.canvas) {
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.style.transform = 'scale(' + invScale + ')';
      }

      // Background camera
      this.bgCamera.aspect = w / h;
      this.bgCamera.updateProjectionMatrix();

      // Effects camera (orthographic, pixel-aligned)
      this.fxCamera.left = -w / 2;
      this.fxCamera.right = w / 2;
      this.fxCamera.top = h / 2;
      this.fxCamera.bottom = -h / 2;
      this.fxCamera.updateProjectionMatrix();

      // Notify modules
      if (this.backgroundModule && this.backgroundModule.resize) {
        this.backgroundModule.resize(w, h);
      }
      if (this.shaderModule && this.shaderModule.resize) {
        this.shaderModule.resize(w, h);
      }
      if (this.composer && this.composer.setSize) {
        this.composer.setSize(w, h);
      }
    },

    animate: function () {
      if (!this._running) return;
      var self = this;
      requestAnimationFrame(function () { self.animate(); });

      var delta = this.clock.getDelta();
      var elapsed = this.clock.getElapsedTime();

      // Performance monitoring (first 120 frames for auto-tier)
      if (this.performanceTier === 'auto' && this._frameCount < 120) {
        this._frameTimes.push(delta);
        this._frameCount++;
        if (this._frameCount === 120) {
          this._autoDetectTier();
        }
      }

      // Background modules disabled (transparent background)

      // Update ambient particles
      if (this.ambientParticles && this.ambientParticles.update) {
        this.ambientParticles.update(elapsed, delta);
      }

      // Update active win effect
      if (this.activeEffect) {
        var effectElapsed = (Date.now() - this.effectStartTime);
        if (effectElapsed < this.effectDuration) {
          this.activeEffect.update(delta, effectElapsed, this.effectDuration);
        } else {
          this._cleanupEffect();
        }
      }

      // Render
      this.renderer.clear();

      // Pass 1: Background (disabled — transparent background)
      // bgScene not rendered; canvas is fully transparent

      // Pass 2: Effects overlay (no depth clear)
      this.renderer.clearDepth();
      this.renderer.render(this.fxScene, this.fxCamera);

      // Pass 3: Post-processing (if available and tier is high)
      if (this._currentTier === 'high' && this.composer && this.composer.render) {
        // Post-processing replaces the standard render
        // It reads from the renderer's output
      }
    },

    // Win effect API — matches existing win-effects.js config format
    playWinEffect: function (config) {
      if (!config || !config.effect) return;
      if (this._currentTier === 'fallback') return; // let Canvas 2D handle it

      var effectType = config.effect;
      var EffectClass = this._registeredEffects[effectType];
      if (!EffectClass) return; // unknown effect, fallback to Canvas 2D

      // Cleanup any existing effect
      this._cleanupEffect();

      var w = window.innerWidth;
      var h = window.innerHeight;

      this.activeEffect = new EffectClass(this.fxScene, this.fxCamera, w, h, config);
      this.effectStartTime = Date.now();
      this.effectDuration = config.duration || 3000;

      // Safety cleanup timeout
      var self = this;
      this._effectCleanupTimeout = setTimeout(function () {
        self._cleanupEffect();
      }, this.effectDuration + 1000);
    },

    _cleanupEffect: function () {
      if (this._effectCleanupTimeout) {
        clearTimeout(this._effectCleanupTimeout);
        this._effectCleanupTimeout = null;
      }
      if (this.activeEffect) {
        if (this.activeEffect.dispose) this.activeEffect.dispose();
        this.activeEffect = null;
      }
    },

    // Register a Three.js effect class by name
    registerEffect: function (name, EffectClass) {
      this._registeredEffects[name] = EffectClass;
    },

    // Game event hook — called from game.js
    onGameEvent: function (type, data) {
      // Notify ambient particles
      if (this.ambientParticles && this.ambientParticles.onGameEvent) {
        this.ambientParticles.onGameEvent(type, data);
      }
      // Notify background
      if (this.backgroundModule && this.backgroundModule.onGameEvent) {
        this.backgroundModule.onGameEvent(type, data);
      }
      // Notify shader
      if (this.shaderModule && this.shaderModule.onGameEvent) {
        this.shaderModule.onGameEvent(type, data);
      }
      // Notify registered listeners
      for (var i = 0; i < this._gameEventListeners.length; i++) {
        this._gameEventListeners[i](type, data);
      }
    },

    // Register a game event listener
    addGameEventListener: function (fn) {
      this._gameEventListeners.push(fn);
    },

    // Auto-detect performance tier based on frame times
    _autoDetectTier: function () {
      var sum = 0;
      for (var i = 0; i < this._frameTimes.length; i++) {
        sum += this._frameTimes[i];
      }
      var avgFrameTime = (sum / this._frameTimes.length) * 1000; // ms

      if (avgFrameTime <= 16) {
        this._currentTier = 'high';
      } else if (avgFrameTime <= 24) {
        this._currentTier = 'medium';
      } else if (avgFrameTime <= 33) {
        this._currentTier = 'low';
      } else {
        this._currentTier = 'fallback';
        console.warn('[ThreeManager] Performance too low, disabling Three.js rendering');
      }
      console.log('[ThreeManager] Performance tier: ' + this._currentTier + ' (avg frame: ' + avgFrameTime.toFixed(1) + 'ms)');
    },

    // Get current tier for other modules to check
    getTier: function () {
      return this._currentTier;
    },

    // Set tier manually
    setTier: function (tier) {
      this.performanceTier = tier;
      if (tier !== 'auto') {
        this._currentTier = tier;
      }
    },

    // Get renderer for post-processing setup
    getRenderer: function () {
      return this.renderer;
    },

    // Dispose everything
    dispose: function () {
      this._running = false;
      this._cleanupEffect();
      if (this.renderer) {
        this.renderer.dispose();
      }
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
    }
  };

  // Module registration queue (for scripts that load before init completes)
  ThreeManager._moduleQueue = [];
  ThreeManager.onReady = function (fn) {
    if (this._running) {
      fn(this);
    } else {
      this._moduleQueue.push(fn);
    }
  };

  var _origInit = ThreeManager.init;
  ThreeManager.init = function () {
    _origInit.call(this);
    // Flush module queue
    for (var i = 0; i < this._moduleQueue.length; i++) {
      try { this._moduleQueue[i](this); } catch (e) {
        console.warn('[ThreeManager] Module init error:', e.message);
      }
    }
    this._moduleQueue = [];
  };

  // Expose globally BEFORE init, so module scripts can register
  window.ThreeManager = ThreeManager;

  // Initialize synchronously — scripts are at bottom of <body> so DOM is available
  ThreeManager.init();
})();
