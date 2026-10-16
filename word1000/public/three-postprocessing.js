// three-postprocessing.js — Post-processing effects for Word500 2.0
// Bloom glow + chromatic aberration on wins
// Uses custom implementation to avoid needing Three.js addon imports

(function () {
  'use strict';

  if (typeof THREE === 'undefined' || !window.ThreeManager) return;

  var TM = window.ThreeManager;

  TM.onReady(function (mgr) {
  var renderer = mgr.getRenderer();
  if (!renderer) return;

  // ─── Simple bloom via selective rendering ──────────────
  // Instead of full EffectComposer pipeline (which needs addons),
  // we use a lightweight approach: render bright areas to a small
  // render target, blur it, and composite back.

  var w = window.innerWidth;
  var h = window.innerHeight;

  // Bloom render target (quarter resolution for performance)
  var bloomTarget = new THREE.WebGLRenderTarget(
    Math.floor(w / 4), Math.floor(h / 4),
    { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
  );

  // Full-screen quad for compositing
  var bloomQuadGeo = new THREE.PlaneGeometry(2, 2);
  var bloomQuadMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uBloomStrength: { value: 0.4 },
      uChromaticAberration: { value: 0.0 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float uBloomStrength;',
      'uniform float uChromaticAberration;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 uv = vUv;',
      '',
      '  // Chromatic aberration',
      '  vec2 dir = uv - 0.5;',
      '  float dist = length(dir);',
      '  vec2 offset = dir * dist * uChromaticAberration;',
      '',
      '  float r = texture2D(tDiffuse, uv + offset).r;',
      '  float g = texture2D(tDiffuse, uv).g;',
      '  float b = texture2D(tDiffuse, uv - offset).b;',
      '  float a = texture2D(tDiffuse, uv).a;',
      '',
      '  gl_FragColor = vec4(r, g, b, a * uBloomStrength);',
      '}'
    ].join('\n'),
    transparent: true,
    depthTest: false,
    depthWrite: false
  });

  var bloomQuad = new THREE.Mesh(bloomQuadGeo, bloomQuadMat);
  var bloomScene = new THREE.Scene();
  var bloomCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bloomScene.add(bloomQuad);

  // Chromatic aberration state
  var chromaticTarget = 0;
  var chromaticCurrent = 0;

  // ─── Post-processing composite ─────────────────────────
  // We override the ThreeManager animate to add post-processing

  var originalAnimate = TM.animate.bind(TM);

  TM.composer = {
    render: function () {
      // The main render already happened in TM.animate
      // We add a bloom pass on top

      if (TM.getTier() !== 'high') return;

      // Render bg scene to bloom target at low res
      renderer.setRenderTarget(bloomTarget);
      renderer.clear();
      renderer.render(TM.bgScene, TM.bgCamera);
      renderer.render(TM.fxScene, TM.fxCamera);
      renderer.setRenderTarget(null);

      // Composite bloom
      bloomQuadMat.uniforms.tDiffuse.value = bloomTarget.texture;

      // Smooth chromatic aberration
      chromaticCurrent += (chromaticTarget - chromaticCurrent) * 0.05;
      if (Math.abs(chromaticCurrent) < 0.001) chromaticCurrent = 0;
      bloomQuadMat.uniforms.uChromaticAberration.value = chromaticCurrent;

      // Render bloom overlay
      renderer.render(bloomScene, bloomCamera);
    },

    setSize: function (newW, newH) {
      w = newW; h = newH;
      bloomTarget.setSize(Math.floor(w / 4), Math.floor(h / 4));
    },

    // Trigger chromatic aberration
    triggerChromaticAberration: function () {
      chromaticTarget = 0.02;
      setTimeout(function () { chromaticTarget = 0; }, 1500);
    }
  };

  // Listen for game events to trigger chromatic aberration on win
  TM.addGameEventListener(function (type) {
    if (type === 'game-over' && TM.getTier() === 'high') {
      TM.composer.triggerChromaticAberration();
    }
  });

  // Patch the animate loop to include post-processing
  var _origAnimateRef = TM.animate;
  TM.animate = function () {
    if (!TM._running) return;
    var self = TM;
    requestAnimationFrame(function () { self.animate(); });

    var delta = TM.clock.getDelta();
    var elapsed = TM.clock.getElapsedTime();

    // Performance monitoring
    if (TM.performanceTier === 'auto' && TM._frameCount < 120) {
      TM._frameTimes.push(delta);
      TM._frameCount++;
      if (TM._frameCount === 120) TM._autoDetectTier();
    }

    // Update modules
    if (TM._currentTier !== 'low' && TM._currentTier !== 'fallback') {
      if (TM.shaderModule && TM.shaderModule.update) TM.shaderModule.update(elapsed, delta);
      if (TM.backgroundModule && TM.backgroundModule.update) TM.backgroundModule.update(elapsed, delta);
    }
    if (TM.ambientParticles && TM.ambientParticles.update) TM.ambientParticles.update(elapsed, delta);

    // Update active win effect
    if (TM.activeEffect) {
      var effectElapsed = Date.now() - TM.effectStartTime;
      if (effectElapsed < TM.effectDuration) {
        TM.activeEffect.update(delta, effectElapsed, TM.effectDuration);
      } else {
        TM._cleanupEffect();
      }
    }

    // Render
    renderer.clear();

    if (TM._currentTier !== 'low' && TM._currentTier !== 'fallback') {
      renderer.render(TM.bgScene, TM.bgCamera);
    }

    renderer.clearDepth();
    renderer.render(TM.fxScene, TM.fxCamera);

    // Post-processing pass
    if (TM._currentTier === 'high' && TM.composer && TM.composer.render) {
      TM.composer.render();
    }
  };

  console.log('[ThreePostProcessing] Bloom + chromatic aberration initialized');
  }); // end onReady
})();
