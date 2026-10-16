// three-effects.js — GPU-accelerated particle effects for Word500 2.0
// Reimplements all 13 Canvas 2D win effects using Three.js Points/Shaders
// Also provides ambient idle particles during gameplay.

(function () {
  'use strict';

  if (typeof THREE === 'undefined' || !window.ThreeManager) return;

  var TM = window.ThreeManager;

  // ─── Helpers ────────────────────────────────────────────
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function colorToVec3(hex) {
    if (hex.charAt(0) === '#') hex = hex.slice(1);
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    return new THREE.Vector3(r, g, b);
  }
  function cssColorToHex(str) {
    if (!str) return 0xffffff;
    if (str.charAt(0) === '#') return parseInt(str.slice(1), 16);
    return 0xffffff;
  }

  // ─── Base Particle Effect ──────────────────────────────
  function BaseEffect(scene, camera, w, h, config) {
    this.scene = scene;
    this.w = w;
    this.h = h;
    this.config = config;
    this.meshes = [];
    this.colors = config.colors || ['#ffffff'];
  }
  BaseEffect.prototype.addToScene = function (obj) {
    this.scene.add(obj);
    this.meshes.push(obj);
  };
  BaseEffect.prototype.dispose = function () {
    for (var i = 0; i < this.meshes.length; i++) {
      this.scene.remove(this.meshes[i]);
      if (this.meshes[i].geometry) this.meshes[i].geometry.dispose();
      if (this.meshes[i].material) this.meshes[i].material.dispose();
    }
    this.meshes = [];
  };

  // ─── Shared vertex shader for point sprites ────────────
  var pointVertexShader = [
    'attribute float size;',
    'attribute vec3 customColor;',
    'attribute float alpha;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vColor = customColor;',
    '  vAlpha = alpha;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = size * (300.0 / -mvPosition.z);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  // Circle fragment shader
  var circleFragShader = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  float d = length(uv);',
    '  if (d > 0.5) discard;',
    '  float edge = smoothstep(0.5, 0.35, d);',
    '  gl_FragColor = vec4(vColor, vAlpha * edge);',
    '}'
  ].join('\n');

  // Glow fragment shader
  var glowFragShader = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  float d = length(uv);',
    '  if (d > 0.5) discard;',
    '  float glow = exp(-d * 6.0);',
    '  gl_FragColor = vec4(vColor, vAlpha * glow);',
    '}'
  ].join('\n');

  // Heart SDF fragment shader
  var heartFragShader = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  uv.y = -uv.y;',
    '  uv.y -= 0.1;',
    '  float a = atan(uv.x, uv.y) / 3.14159;',
    '  float r = length(uv);',
    '  float h = abs(a);',
    '  float d = r - (0.25 + 0.15 * sqrt(1.0 - h * h));',
    '  if (d > 0.05) discard;',
    '  float edge = smoothstep(0.05, -0.02, d);',
    '  gl_FragColor = vec4(vColor, vAlpha * edge);',
    '}'
  ].join('\n');

  // Star fragment shader
  var starFragShader = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  float d = length(uv);',
    '  if (d > 0.5) discard;',
    '  float a = atan(uv.y, uv.x);',
    '  float star = 0.15 + 0.35 * pow(abs(cos(a * 2.0)), 0.5);',
    '  float shape = smoothstep(star + 0.02, star - 0.02, d);',
    '  float glow = exp(-d * 4.0) * 0.5;',
    '  gl_FragColor = vec4(vColor, vAlpha * (shape + glow));',
    '}'
  ].join('\n');

  // Petal fragment shader
  var petalFragShader = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  float d = (uv.x * uv.x) / 0.04 + (uv.y * uv.y) / 0.16;',
    '  if (d > 1.0) discard;',
    '  float edge = smoothstep(1.0, 0.6, d);',
    '  gl_FragColor = vec4(vColor, vAlpha * edge);',
    '}'
  ].join('\n');

  // ─── Helper: create points system ──────────────────────
  function createPointSystem(count, fragShader, blending) {
    var geometry = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    var colors = new Float32Array(count * 3);
    var sizes = new Float32Array(count);
    var alphas = new Float32Array(count);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

    var material = new THREE.ShaderMaterial({
      vertexShader: pointVertexShader,
      fragmentShader: fragShader || circleFragShader,
      transparent: true,
      depthWrite: false,
      blending: blending || THREE.NormalBlending
    });

    return { geometry: geometry, material: material, points: new THREE.Points(geometry, material) };
  }

  // ─── CONFETTI EFFECT ───────────────────────────────────
  function ConfettiEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = Math.min((config.particleCount || 80) * 4, 500);
    this._maxCount = count;

    var sys = createPointSystem(count, circleFragShader);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);

    // Initialize particles
    for (var i = 0; i < Math.min(config.particleCount || 80, count); i++) {
      this._spawnParticle();
    }
  }
  ConfettiEffect.prototype = Object.create(BaseEffect.prototype);
  ConfettiEffect.prototype._spawnParticle = function () {
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: rand(0, this.w) - this.w / 2,
      y: rand(this.h * 0.3, this.h * 0.6) + this.h / 2,
      z: rand(-5, 5),
      vx: rand(-3, 3), vy: rand(-6, -2),
      size: rand(8, 16),
      r: col.x, g: col.y, b: col.z,
      gravity: 0.08, drag: 0.99,
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.06),
      opacity: 1
    });
  };
  ConfettiEffect.prototype.update = function (delta, elapsed, duration) {
    // Spawn new particles during first 70%
    if (elapsed < duration * 0.7 && this._particles.length < this._maxCount) {
      for (var s = 0; s < 3; s++) this._spawnParticle();
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.wobble += p.wobbleSpeed;
      p.vx += Math.sin(p.wobble) * 0.1;
      p.vy -= p.gravity;
      p.vx *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      if (elapsed > duration * 0.7) p.opacity = Math.max(0, p.opacity - 0.015);
      if (p.y < -this.h / 2 - 30 || p.opacity <= 0) {
        this._particles.splice(i, 1);
      }
    }

    // Write to buffers
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.opacity;
      } else {
        alp[j] = 0;
      }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── SPARKLES EFFECT ───────────────────────────────────
  function SparklesEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 300;
    this._maxCount = count;
    var sys = createPointSystem(count, starFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 40); i++) this._spawnParticle();
  }
  SparklesEffect.prototype = Object.create(BaseEffect.prototype);
  SparklesEffect.prototype._spawnParticle = function () {
    var cx = 0, cy = 0;
    var angle = rand(0, Math.PI * 2);
    var speed = rand(2, 8);
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: cx + rand(-100, 100) * (this.w / 380),
      y: cy + rand(-100, 100) * (this.h / 800),
      z: rand(-3, 3),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(4, 10),
      r: col.x, g: col.y, b: col.z,
      life: 1, decay: rand(0.008, 0.02),
      twinkle: rand(0, Math.PI * 2), gravity: 0.02
    });
  };
  SparklesEffect.prototype.update = function (delta, elapsed, duration) {
    if (elapsed < duration * 0.75 && this._particles.length < this._maxCount - 5) {
      for (var s = 0; s < 2; s++) this._spawnParticle();
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.vy -= p.gravity;
      p.x += p.vx; p.y += p.vy;
      p.twinkle += 0.15;
      p.life -= p.decay;
      if (p.life <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.life * (0.5 + 0.5 * Math.sin(pp.twinkle));
      } else {
        alp[j] = 0;
      }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── HEARTS EFFECT ─────────────────────────────────────
  function HeartsEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 200;
    this._maxCount = count;
    var sys = createPointSystem(count, heartFragShader);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 30); i++) this._spawnParticle();
  }
  HeartsEffect.prototype = Object.create(BaseEffect.prototype);
  HeartsEffect.prototype._spawnParticle = function () {
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: rand(-this.w / 2, this.w / 2),
      y: -this.h / 2 - rand(10, 60),
      z: rand(-3, 3),
      vx: rand(-1, 1), vy: rand(2, 4),
      size: rand(16, 36),
      r: col.x, g: col.y, b: col.z,
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05),
      opacity: 1, fadeStart: 0.7
    });
  };
  HeartsEffect.prototype.update = function (delta, elapsed, duration) {
    if (elapsed < duration * 0.65 && this._particles.length < this._maxCount - 5) {
      this._spawnParticle();
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;
    var progress = elapsed / duration;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.5;
      p.y += p.vy;
      if (progress > p.fadeStart) {
        p.opacity = Math.max(0, 1 - (progress - p.fadeStart) / (1 - p.fadeStart));
      }
      if (p.y > this.h / 2 + 40 || p.opacity <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.opacity;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── FIREWORKS EFFECT ──────────────────────────────────
  function FireworksEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 600;
    this._maxCount = count;
    var sys = createPointSystem(count, glowFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._shells = [];
    this._sparks = [];
    this._lastShellTime = 0;
    this.addToScene(sys.points);

    var shellCount = Math.min(config.particleCount || 60, 8);
    for (var i = 0; i < shellCount; i++) {
      this._spawnShell(i * 400);
    }
    this._lastShellTime = Date.now();
  }
  FireworksEffect.prototype = Object.create(BaseEffect.prototype);
  FireworksEffect.prototype._spawnShell = function (delay) {
    var col = colorToVec3(pick(this.colors));
    var tx = rand(-this.w * 0.3, this.w * 0.3);
    var ty = rand(this.h * 0.1, this.h * 0.4);
    this._shells.push({
      x: tx, y: -this.h / 2 - 10, targetY: ty,
      vy: rand(8, 12), color: col,
      delay: delay || 0, born: Date.now()
    });
  };
  FireworksEffect.prototype.update = function (delta, elapsed, duration) {
    var now = Date.now();
    if (elapsed < duration * 0.7 && now - this._lastShellTime > 600) {
      this._spawnShell(0);
      this._lastShellTime = now;
    }

    // Update shells
    for (var i = this._shells.length - 1; i >= 0; i--) {
      var s = this._shells[i];
      if (now - s.born < s.delay) continue;
      s.y += s.vy * delta * 60;
      s.vy -= 0.15;
      if (s.y >= s.targetY || s.vy <= 0) {
        // Explode into sparks
        for (var j = 0; j < 35; j++) {
          var angle = rand(0, Math.PI * 2);
          var speed = rand(1, 7);
          this._sparks.push({
            x: s.x, y: s.y, z: rand(-2, 2),
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            r: s.color.x, g: s.color.y, b: s.color.z,
            size: rand(4, 8), life: 1, decay: rand(0.015, 0.03), gravity: 0.06
          });
        }
        this._shells.splice(i, 1);
      }
    }

    // Update sparks
    for (var k = this._sparks.length - 1; k >= 0; k--) {
      var sp = this._sparks[k];
      sp.vy -= sp.gravity;
      sp.x += sp.vx; sp.y += sp.vy;
      sp.vx *= 0.98;
      sp.life -= sp.decay;
      if (sp.life <= 0) this._sparks.splice(k, 1);
    }

    // Keep sparks under limit
    while (this._sparks.length > this._maxCount - 10) {
      this._sparks.shift();
    }

    // Write to buffers
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;
    var all = this._sparks;

    // Add shell positions too
    for (var si = 0; si < this._shells.length && all.length < this._maxCount; si++) {
      var sh = this._shells[si];
      if (now - sh.born >= sh.delay) {
        all = all.concat([{ x: sh.x, y: sh.y, z: 0, r: 1, g: 1, b: 1, size: 6, life: 1 }]);
      }
    }

    for (var m = 0; m < this._maxCount; m++) {
      if (m < all.length) {
        var pp = all[m];
        pos[m * 3] = pp.x; pos[m * 3 + 1] = pp.y; pos[m * 3 + 2] = pp.z || 0;
        col[m * 3] = pp.r; col[m * 3 + 1] = pp.g; col[m * 3 + 2] = pp.b;
        siz[m] = pp.size || 4;
        alp[m] = pp.life;
      } else { alp[m] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── LIGHTNING EFFECT ──────────────────────────────────
  function LightningEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    this._bolts = [];
    this._boltMeshes = [];
    this._flashPlane = null;
    var boltCount = config.particleCount || 8;
    for (var i = 0; i < boltCount; i++) {
      this._spawnBolt(rand(0, 1500));
    }

    // Flash plane
    var flashGeo = new THREE.PlaneGeometry(w * 2, h * 2);
    var flashMat = new THREE.MeshBasicMaterial({ color: 0xa5f3fc, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this._flashPlane = new THREE.Mesh(flashGeo, flashMat);
    this._flashPlane.position.z = 5;
    this.addToScene(this._flashPlane);
  }
  LightningEffect.prototype = Object.create(BaseEffect.prototype);
  LightningEffect.prototype._spawnBolt = function (delay) {
    var x = rand(-this.w * 0.4, this.w * 0.4);
    var points = [];
    var y = this.h / 2;
    points.push(new THREE.Vector3(x, y, 0));
    while (y > -this.h / 2) {
      y -= rand(20, 60);
      x += rand(-40, 40);
      points.push(new THREE.Vector3(x, Math.max(y, -this.h / 2), 0));
    }

    var lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    var lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      linewidth: 1
    });
    var line = new THREE.Line(lineGeo, lineMat);

    // Glow line
    var glowMat = new THREE.LineBasicMaterial({
      color: 0xa5f3fc, transparent: true, opacity: 0,
      linewidth: 1
    });
    var glowLine = new THREE.Line(lineGeo.clone(), glowMat);

    this.addToScene(line);
    this.addToScene(glowLine);

    this._bolts.push({
      line: line, glowLine: glowLine,
      delay: delay || 0, born: Date.now(),
      opacity: 0, maxOpacity: rand(0.7, 1)
    });
  };
  LightningEffect.prototype.update = function (delta, elapsed, duration) {
    var now = Date.now();

    // Spawn new bolts
    if (elapsed < duration * 0.8 && this._bolts.length < 4) {
      this._spawnBolt(0);
    }

    for (var i = this._bolts.length - 1; i >= 0; i--) {
      var b = this._bolts[i];
      var age = now - b.born;
      if (age < b.delay) continue;
      var liveAge = age - b.delay;

      if (liveAge < 100) b.opacity = b.maxOpacity;
      else if (liveAge < 200) b.opacity = 0.3;
      else if (liveAge < 300) b.opacity = 0.8;
      else b.opacity = Math.max(0, b.maxOpacity * (1 - (liveAge - 300) / 400));

      b.line.material.opacity = b.opacity;
      b.glowLine.material.opacity = b.opacity * 0.6;

      // Flash on initial strike
      if (liveAge < 100 && this._flashPlane) {
        this._flashPlane.material.opacity = Math.max(this._flashPlane.material.opacity, 0.15);
      }

      if (b.opacity <= 0) {
        this.scene.remove(b.line);
        this.scene.remove(b.glowLine);
        this._bolts.splice(i, 1);
      }
    }

    // Fade flash
    if (this._flashPlane && this._flashPlane.material.opacity > 0) {
      this._flashPlane.material.opacity *= 0.9;
      if (this._flashPlane.material.opacity < 0.01) this._flashPlane.material.opacity = 0;
    }
  };

  // ─── SNOWFALL EFFECT ───────────────────────────────────
  function SnowfallEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 400;
    this._maxCount = count;
    var sys = createPointSystem(count, starFragShader);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 60); i++) this._spawnParticle(true);
  }
  SnowfallEffect.prototype = Object.create(BaseEffect.prototype);
  SnowfallEffect.prototype._spawnParticle = function (stagger) {
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: rand(-this.w / 2 - 20, this.w / 2 + 20),
      y: stagger ? rand(-this.h / 2, this.h / 2) : this.h / 2 + rand(10, 40),
      z: rand(-3, 3),
      vx: rand(-0.5, 0.5), vy: rand(-1, -3),
      size: rand(4, 12),
      r: col.x, g: col.y, b: col.z,
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.01, 0.04), wobbleAmp: rand(0.3, 1),
      opacity: rand(0.5, 1), rotSpeed: rand(-2, 2)
    });
  };
  SnowfallEffect.prototype.update = function (delta, elapsed, duration) {
    if (elapsed < duration * 0.7 && this._particles.length < this._maxCount - 5) {
      this._spawnParticle(false);
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
      p.y += p.vy;
      if (elapsed > duration * 0.75) p.opacity = Math.max(0, p.opacity - 0.01);
      if (p.y < -this.h / 2 - 20 || p.opacity <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.opacity;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── METEORS EFFECT ────────────────────────────────────
  function MeteorsEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 500;
    this._maxCount = count;
    var sys = createPointSystem(count, glowFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._particles = [];
    this._lastMeteor = Date.now();
    this.addToScene(sys.points);

    for (var i = 0; i < (config.particleCount || 12); i++) {
      this._spawnMeteor(i * 200);
    }
  }
  MeteorsEffect.prototype = Object.create(BaseEffect.prototype);
  MeteorsEffect.prototype._spawnMeteor = function (delay) {
    var col = colorToVec3(pick(this.colors));
    var angle = rand(0.3, 0.8);
    var speed = rand(6, 14);
    this._particles.push({
      x: rand(-this.w / 2 - 50, this.w / 2 + 50),
      y: this.h / 2 + 20,
      z: rand(-3, 3),
      vx: Math.cos(angle) * speed, vy: -Math.sin(angle) * speed,
      size: rand(6, 12),
      r: col.x, g: col.y, b: col.z,
      trail: [], tailLen: rand(8, 15),
      life: 1, decay: rand(0.005, 0.012),
      delay: delay || 0, born: Date.now(),
      isHead: true
    });
  };
  MeteorsEffect.prototype.update = function (delta, elapsed, duration) {
    var now = Date.now();
    if (elapsed < duration * 0.7 && now - this._lastMeteor > 300) {
      this._spawnMeteor(0);
      this._lastMeteor = now;
    }

    // Update meteor heads and their trails
    var allPoints = [];
    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      if (now - p.born < p.delay) continue;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > p.tailLen) p.trail.shift();
      p.x += p.vx * delta * 60;
      p.y += p.vy * delta * 60;
      p.life -= p.decay;
      if (p.life <= 0 || p.y < -this.h / 2 - 30 || Math.abs(p.x) > this.w / 2 + 50) {
        this._particles.splice(i, 1);
        continue;
      }
      // Head
      allPoints.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 1, b: 1, size: p.size, alpha: p.life });
      // Trail
      for (var t = 0; t < p.trail.length; t++) {
        var tAlpha = (t / p.trail.length) * p.life * 0.6;
        var tSize = p.size * 0.6 * (t / p.trail.length);
        allPoints.push({ x: p.trail[t].x, y: p.trail[t].y, z: p.z, r: p.r, g: p.g, b: p.b, size: tSize, alpha: tAlpha });
      }
    }

    var pos = this._sys.geometry.attributes.position.array;
    var colArr = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var j = 0; j < this._maxCount; j++) {
      if (j < allPoints.length) {
        var pp = allPoints[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        colArr[j * 3] = pp.r; colArr[j * 3 + 1] = pp.g; colArr[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.alpha;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── CHERRY BLOSSOM EFFECT ─────────────────────────────
  function CherryBlossomEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 300;
    this._maxCount = count;
    var sys = createPointSystem(count, petalFragShader);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 50); i++) this._spawnParticle(true);
  }
  CherryBlossomEffect.prototype = Object.create(BaseEffect.prototype);
  CherryBlossomEffect.prototype._spawnParticle = function (stagger) {
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: rand(-this.w / 2 - 20, this.w / 2 + 20),
      y: stagger ? rand(0, this.h / 2 + 40) : this.h / 2 + rand(10, 40),
      z: rand(-3, 3),
      vx: rand(-1.5, 1.5), vy: rand(-1, -2.5),
      size: rand(10, 22),
      r: col.x, g: col.y, b: col.z,
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05), wobbleAmp: rand(0.5, 1.5),
      opacity: rand(0.6, 1)
    });
  };
  CherryBlossomEffect.prototype.update = function (delta, elapsed, duration) {
    if (elapsed < duration * 0.65 && this._particles.length < this._maxCount - 5) {
      this._spawnParticle(false);
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
      p.y += p.vy;
      if (elapsed > duration * 0.7) p.opacity = Math.max(0, p.opacity - 0.01);
      if (p.y < -this.h / 2 - 30 || p.opacity <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.opacity;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── AURORA EFFECT ─────────────────────────────────────
  function AuroraEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    this._waves = [];
    var waveCount = config.particleCount || 6;

    for (var i = 0; i < waveCount; i++) {
      var col = colorToVec3(pick(this.colors));
      var waveY = rand(-h * 0.1, h * 0.35);
      var waveH = rand(60, 140) * (h / 800);
      var geo = new THREE.PlaneGeometry(w * 1.2, waveH, 64, 1);
      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Vector3(col.x, col.y, col.z) },
          uAmplitude: { value: rand(30, 80) * (h / 800) },
          uFrequency: { value: rand(0.003, 0.008) * (380 / w) },
          uSpeed: { value: rand(0.5, 1.5) },
          uPhase: { value: i * 1.2 },
          uOpacity: { value: rand(0.15, 0.35) }
        },
        vertexShader: [
          'uniform float uTime;',
          'uniform float uAmplitude;',
          'uniform float uFrequency;',
          'uniform float uSpeed;',
          'uniform float uPhase;',
          'void main() {',
          '  vec3 pos = position;',
          '  pos.y += sin(pos.x * uFrequency + uTime * uSpeed + uPhase) * uAmplitude;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor;',
          'uniform float uOpacity;',
          'void main() {',
          '  gl_FragColor = vec4(uColor, uOpacity);',
          '}'
        ].join('\n'),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, waveY, -1);
      this.addToScene(mesh);
      this._waves.push({ mesh: mesh, mat: mat, initOpacity: mat.uniforms.uOpacity.value });
    }
  }
  AuroraEffect.prototype = Object.create(BaseEffect.prototype);
  AuroraEffect.prototype.update = function (delta, elapsed, duration) {
    for (var i = 0; i < this._waves.length; i++) {
      var w = this._waves[i];
      w.mat.uniforms.uTime.value = elapsed / 1000;
      if (elapsed > duration * 0.6) {
        w.mat.uniforms.uOpacity.value = Math.max(0, w.initOpacity * (1 - (elapsed - duration * 0.6) / (duration * 0.4)));
      }
    }
  };

  // ─── GALAXY BURST EFFECT ───────────────────────────────
  function GalaxyBurstEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 500;
    this._maxCount = count;
    var sys = createPointSystem(count, glowFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 100); i++) this._spawnParticle();
  }
  GalaxyBurstEffect.prototype = Object.create(BaseEffect.prototype);
  GalaxyBurstEffect.prototype._spawnParticle = function () {
    var col = colorToVec3(pick(this.colors));
    var angle = rand(0, Math.PI * 2);
    var dist = rand(5, 200) * (this.w / 380);
    this._particles.push({
      x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, z: rand(-3, 3),
      angle: angle, dist: dist, speed: rand(0.01, 0.04),
      size: rand(3, 8), r: col.x, g: col.y, b: col.z,
      vr: rand(0.5, 2), life: 1, decay: rand(0.002, 0.008)
    });
  };
  GalaxyBurstEffect.prototype.update = function (delta, elapsed, duration) {
    if (elapsed < duration * 0.6 && this._particles.length < this._maxCount - 10) {
      for (var s = 0; s < 3; s++) this._spawnParticle();
    }
    var pos = this._sys.geometry.attributes.position.array;
    var col = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      p.angle += p.speed;
      p.dist += p.vr;
      p.x = Math.cos(p.angle) * p.dist;
      p.y = Math.sin(p.angle) * p.dist;
      p.life -= p.decay;
      if (p.life <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        col[j * 3] = pp.r; col[j * 3 + 1] = pp.g; col[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.life;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── PHOENIX EFFECT ────────────────────────────────────
  function PhoenixEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);
    var count = 500;
    this._maxCount = count;
    var sys = createPointSystem(count, glowFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);
    for (var i = 0; i < (config.particleCount || 80); i++) this._spawnParticle(rand(0, 1500));
  }
  PhoenixEffect.prototype = Object.create(BaseEffect.prototype);
  PhoenixEffect.prototype._spawnParticle = function (delay) {
    var col = colorToVec3(pick(this.colors));
    this._particles.push({
      x: rand(-30, 30) * (this.w / 380),
      y: -this.h / 2 - rand(0, 20),
      z: rand(-3, 3),
      vx: rand(-2, 2), vy: rand(3, 8),
      size: rand(4, 12),
      r: col.x, g: col.y, b: col.z,
      life: 1, decay: rand(0.008, 0.02), gravity: 0.05,
      trail: [],
      delay: delay || 0, born: Date.now()
    });
  };
  PhoenixEffect.prototype.update = function (delta, elapsed, duration) {
    var now = Date.now();
    if (elapsed < duration * 0.7 && this._particles.length < this._maxCount / 3) {
      this._spawnParticle(0);
    }

    var allPoints = [];
    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      if (now - p.born < p.delay) continue;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 10) p.trail.shift();
      p.vy += p.gravity;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.99;
      p.life -= p.decay;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }

      // Head
      allPoints.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 1, b: 1, size: p.size * 0.7, alpha: p.life });
      // Trail
      for (var t = 0; t < p.trail.length; t++) {
        allPoints.push({
          x: p.trail[t].x, y: p.trail[t].y, z: p.z,
          r: p.r, g: p.g, b: p.b,
          size: p.size * (t / p.trail.length), alpha: (t / p.trail.length) * p.life * 0.5
        });
      }
    }

    var pos = this._sys.geometry.attributes.position.array;
    var colArr = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var j = 0; j < this._maxCount; j++) {
      if (j < allPoints.length) {
        var pp = allPoints[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        colArr[j * 3] = pp.r; colArr[j * 3 + 1] = pp.g; colArr[j * 3 + 2] = pp.b;
        siz[j] = pp.size;
        alp[j] = pp.alpha;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── NUCLEAR EFFECT ────────────────────────────────────
  function NuclearEffect(scene, camera, w, h, config) {
    BaseEffect.call(this, scene, camera, w, h, config);

    // Shockwave rings
    this._rings = [];
    for (var r = 0; r < 2; r++) {
      var ringGeo = new THREE.RingGeometry(1, 10, 64);
      var ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: r === 0 ? 1 : 0.7,
        side: THREE.DoubleSide
      });
      var ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.z = 2;
      this.addToScene(ringMesh);
      this._rings.push({
        mesh: ringMesh, radius: 0, maxRadius: Math.max(w, h),
        speed: r === 0 ? 14 : 10, opacity: r === 0 ? 1 : 0.7,
        delay: r * 200, born: Date.now()
      });
    }

    // Flash plane
    var flashGeo = new THREE.PlaneGeometry(w * 2, h * 2);
    var flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    this._flash = new THREE.Mesh(flashGeo, flashMat);
    this._flash.position.z = 3;
    this.addToScene(this._flash);

    // Particles
    var count = 600;
    this._maxCount = count;
    var sys = createPointSystem(count, glowFragShader, THREE.AdditiveBlending);
    this._sys = sys;
    this._particles = [];
    this.addToScene(sys.points);

    for (var i = 0; i < (config.particleCount || 150); i++) {
      var col = colorToVec3(pick(this.colors));
      var angle = rand(0, Math.PI * 2);
      var speed = rand(3, 15);
      this._particles.push({
        x: 0, y: 0, z: rand(-3, 3),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: rand(4, 10), r: col.x, g: col.y, b: col.z,
        life: 1, decay: rand(0.005, 0.015), gravity: 0.04,
        delay: rand(0, 500), born: Date.now()
      });
    }
  }
  NuclearEffect.prototype = Object.create(BaseEffect.prototype);
  NuclearEffect.prototype.update = function (delta, elapsed, duration) {
    var now = Date.now();

    // Flash fade
    if (this._flash) {
      this._flash.material.opacity = Math.max(0, 0.7 * (1 - elapsed / 600));
    }

    // Ring expansion
    for (var r = 0; r < this._rings.length; r++) {
      var ring = this._rings[r];
      if (now - ring.born < ring.delay) continue;
      ring.radius += ring.speed * delta * 60;
      ring.mesh.scale.set(ring.radius, ring.radius, 1);
      ring.mesh.material.opacity = Math.max(0, ring.opacity * (1 - ring.radius / ring.maxRadius));
    }

    // Particles
    var pos = this._sys.geometry.attributes.position.array;
    var colArr = this._sys.geometry.attributes.customColor.array;
    var siz = this._sys.geometry.attributes.size.array;
    var alp = this._sys.geometry.attributes.alpha.array;

    for (var i = this._particles.length - 1; i >= 0; i--) {
      var p = this._particles[i];
      if (now - p.born < p.delay) continue;
      p.vy -= p.gravity;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.98;
      p.life -= p.decay;
      if (p.life <= 0) this._particles.splice(i, 1);
    }
    for (var j = 0; j < this._maxCount; j++) {
      if (j < this._particles.length) {
        var pp = this._particles[j];
        pos[j * 3] = pp.x; pos[j * 3 + 1] = pp.y; pos[j * 3 + 2] = pp.z;
        colArr[j * 3] = pp.r; colArr[j * 3 + 1] = pp.g; colArr[j * 3 + 2] = pp.b;
        siz[j] = pp.size * pp.life;
        alp[j] = pp.life;
      } else { alp[j] = 0; }
    }
    this._sys.geometry.attributes.position.needsUpdate = true;
    this._sys.geometry.attributes.customColor.needsUpdate = true;
    this._sys.geometry.attributes.size.needsUpdate = true;
    this._sys.geometry.attributes.alpha.needsUpdate = true;
  };

  // ─── Register all effects ─────────────────────────────
  TM.registerEffect('confetti', ConfettiEffect);
  TM.registerEffect('sparkles', SparklesEffect);
  TM.registerEffect('hearts', HeartsEffect);
  TM.registerEffect('fireworks', FireworksEffect);
  TM.registerEffect('lightning', LightningEffect);
  TM.registerEffect('snowfall', SnowfallEffect);
  TM.registerEffect('meteors', MeteorsEffect);
  TM.registerEffect('cherry_blossom', CherryBlossomEffect);
  TM.registerEffect('aurora', AuroraEffect);
  TM.registerEffect('galaxy_burst', GalaxyBurstEffect);
  TM.registerEffect('phoenix', PhoenixEffect);
  TM.registerEffect('nuclear', NuclearEffect);

  // ─── AMBIENT IDLE PARTICLES (disabled) ─────────────────
  // Uncomment to re-enable ambient particle orbs
  if (false) TM.onReady(function (mgr) {
    var AMBIENT_COUNT = 50;
    var sys = createPointSystem(AMBIENT_COUNT, glowFragShader, THREE.AdditiveBlending);
    mgr.fxScene.add(sys.points);

    var particles = [];
    var w = window.innerWidth;
    var h = window.innerHeight;

    // Theme colors
    var themeColors = [
      colorToVec3('#b44aff'),
      colorToVec3('#8b5cf6'),
      colorToVec3('#6d28d9'),
      colorToVec3('#4ade80')
    ];

    function spawnAmbient() {
      var col = pick(themeColors);
      return {
        x: rand(-w / 2, w / 2),
        y: rand(-h / 2, h / 2),
        z: rand(-8, -3),
        vx: rand(-0.2, 0.2), vy: rand(-0.1, 0.1),
        size: rand(3, 8),
        r: col.x, g: col.y, b: col.z,
        opacity: rand(0.1, 0.3),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.3, 0.8),
        // Boost state for game event reactions
        boost: 0
      };
    }

    for (var i = 0; i < AMBIENT_COUNT; i++) {
      particles.push(spawnAmbient());
    }

    mgr.ambientParticles = {
      update: function (elapsed, delta) {
        w = window.innerWidth;
        h = window.innerHeight;
        var pos = sys.geometry.attributes.position.array;
        var col = sys.geometry.attributes.customColor.array;
        var siz = sys.geometry.attributes.size.array;
        var alp = sys.geometry.attributes.alpha.array;

        for (var j = 0; j < AMBIENT_COUNT; j++) {
          var p = particles[j];
          // Gentle drift
          p.x += (p.vx + Math.sin(elapsed * p.speed + p.phase) * 0.3) * (1 + p.boost * 3);
          p.y += (p.vy + Math.cos(elapsed * p.speed * 0.7 + p.phase) * 0.2) * (1 + p.boost * 3);

          // Wrap around
          if (p.x > w / 2 + 20) p.x = -w / 2 - 20;
          if (p.x < -w / 2 - 20) p.x = w / 2 + 20;
          if (p.y > h / 2 + 20) p.y = -h / 2 - 20;
          if (p.y < -h / 2 - 20) p.y = h / 2 + 20;

          // Decay boost
          if (p.boost > 0) p.boost = Math.max(0, p.boost - delta * 2);

          var twinkle = 0.5 + 0.5 * Math.sin(elapsed * 2 + p.phase);

          pos[j * 3] = p.x; pos[j * 3 + 1] = p.y; pos[j * 3 + 2] = p.z;
          col[j * 3] = p.r; col[j * 3 + 1] = p.g; col[j * 3 + 2] = p.b;
          siz[j] = p.size * (1 + p.boost * 2);
          alp[j] = p.opacity * twinkle * (1 + p.boost * 3);
        }
        sys.geometry.attributes.position.needsUpdate = true;
        sys.geometry.attributes.customColor.needsUpdate = true;
        sys.geometry.attributes.size.needsUpdate = true;
        sys.geometry.attributes.alpha.needsUpdate = true;
      },

      onGameEvent: function (type) {
        if (type === 'guess') {
          // Brief acceleration on guess
          for (var i = 0; i < particles.length; i++) {
            particles[i].boost = 0.5;
          }
        } else if (type === 'game-over') {
          // Burst outward on win
          for (var j = 0; j < particles.length; j++) {
            particles[j].boost = 1;
            var angle = Math.atan2(particles[j].y, particles[j].x);
            particles[j].vx += Math.cos(angle) * 2;
            particles[j].vy += Math.sin(angle) * 2;
          }
        }
      }
    };
  });

  console.log('[ThreeEffects] All 13 effects + ambient particles registered');
})();
