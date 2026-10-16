// three-shaders.js — Procedural shader backgrounds for Word500 2.0
// Nebula, Energy Grid, and Void Ripple effects rendered as fullscreen quads

(function () {
  'use strict';

  if (typeof THREE === 'undefined' || !window.ThreeManager) return;

  var TM = window.ThreeManager;
  var scene = null; // set in onReady

  // ─── Simplex noise GLSL (compact) ──────────────────────
  var simplexNoise = [
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    '  const vec2 C=vec2(1.0/6.0,1.0/3.0);',
    '  const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    '  vec3 i=floor(v+dot(v,C.yyy));',
    '  vec3 x0=v-i+dot(i,C.xxx);',
    '  vec3 g=step(x0.yzx,x0.xyz);',
    '  vec3 l=1.0-g;',
    '  vec3 i1=min(g.xyz,l.zxy);',
    '  vec3 i2=max(g.xyz,l.zxy);',
    '  vec3 x1=x0-i1+C.xxx;',
    '  vec3 x2=x0-i2+C.yyy;',
    '  vec3 x3=x0-D.yyy;',
    '  i=mod289(i);',
    '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    '  float n_=0.142857142857;',
    '  vec3 ns=n_*D.wyz-D.xzx;',
    '  vec4 j=p-49.0*floor(p*ns.z*ns.z);',
    '  vec4 x_=floor(j*ns.z);',
    '  vec4 y_=floor(j-7.0*x_);',
    '  vec4 x=x_*ns.x+ns.yyyy;',
    '  vec4 y=y_*ns.x+ns.yyyy;',
    '  vec4 h=1.0-abs(x)-abs(y);',
    '  vec4 b0=vec4(x.xy,y.xy);',
    '  vec4 b1=vec4(x.zw,y.zw);',
    '  vec4 s0=floor(b0)*2.0+1.0;',
    '  vec4 s1=floor(b1)*2.0+1.0;',
    '  vec4 sh=-step(h,vec4(0.0));',
    '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;',
    '  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    '  vec3 p0=vec3(a0.xy,h.x);',
    '  vec3 p1=vec3(a0.zw,h.y);',
    '  vec3 p2=vec3(a1.xy,h.z);',
    '  vec3 p3=vec3(a1.zw,h.w);',
    '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
    '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);',
    '  m=m*m;',
    '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}'
  ].join('\n');

  // ─── Nebula Shader ─────────────────────────────────────
  var nebulaVertexShader = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var nebulaFragmentShader = [
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform vec3 uColor1;',
    'uniform vec3 uColor2;',
    'uniform vec3 uColor3;',
    'uniform float uIntensity;',
    'varying vec2 vUv;',
    simplexNoise,
    'void main() {',
    '  vec2 uv = vUv;',
    '  float t = uTime * 0.1;',
    '',
    '  // Layered noise for nebula clouds',
    '  float n1 = snoise(vec3(uv * 2.0, t)) * 0.5 + 0.5;',
    '  float n2 = snoise(vec3(uv * 4.0 + 10.0, t * 1.3)) * 0.5 + 0.5;',
    '  float n3 = snoise(vec3(uv * 8.0 + 20.0, t * 0.7)) * 0.5 + 0.5;',
    '',
    '  float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;',
    '',
    '  // Color mapping',
    '  vec3 col = mix(uColor1, uColor2, nebula);',
    '  col = mix(col, uColor3, n3 * 0.5);',
    '',
    '  // Vignette',
    '  float vig = 1.0 - length(uv - 0.5) * 1.2;',
    '  vig = clamp(vig, 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(col * nebula * vig * uIntensity, nebula * 0.3 * vig);',
    '}'
  ].join('\n');

  // ─── Energy Grid Shader ────────────────────────────────
  var gridFragmentShader = [
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform vec3 uColor1;',
    'uniform float uIntensity;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float t = uTime * 0.3;',
    '',
    '  // Scrolling grid',
    '  float gridX = abs(sin((uv.x * 20.0 + t) * 3.14159));',
    '  float gridY = abs(sin((uv.y * 20.0 + t * 0.7) * 3.14159));',
    '',
    '  // Sharp lines',
    '  float lineX = pow(gridX, 20.0);',
    '  float lineY = pow(gridY, 20.0);',
    '  float grid = max(lineX, lineY);',
    '',
    '  // Glow around lines',
    '  float glowX = pow(gridX, 4.0) * 0.3;',
    '  float glowY = pow(gridY, 4.0) * 0.3;',
    '  float glow = max(glowX, glowY);',
    '',
    '  // Pulse',
    '  float pulse = 0.7 + 0.3 * sin(uTime * 0.5);',
    '',
    '  // Distance fade from center',
    '  float dist = length(uv - 0.5);',
    '  float fade = 1.0 - smoothstep(0.2, 0.7, dist);',
    '',
    '  float val = (grid + glow) * pulse * fade * uIntensity;',
    '  gl_FragColor = vec4(uColor1 * val, val * 0.2);',
    '}'
  ].join('\n');

  // ─── Void Ripple Shader ────────────────────────────────
  var rippleFragmentShader = [
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform vec3 uColor1;',
    'uniform vec3 uColor2;',
    'uniform float uIntensity;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 uv = vUv - 0.5;',
    '  float dist = length(uv);',
    '  float t = uTime * 0.5;',
    '',
    '  // Radial ripples',
    '  float ripple1 = sin(dist * 30.0 - t * 3.0) * 0.5 + 0.5;',
    '  float ripple2 = sin(dist * 20.0 - t * 2.0 + 1.0) * 0.5 + 0.5;',
    '',
    '  // Combine with distance fade',
    '  float val = (ripple1 * 0.6 + ripple2 * 0.4) * exp(-dist * 3.0);',
    '',
    '  // Distortion',
    '  float distort = sin(atan(uv.y, uv.x) * 3.0 + t) * 0.1;',
    '  val += distort * exp(-dist * 5.0);',
    '',
    '  vec3 col = mix(uColor1, uColor2, ripple1);',
    '  gl_FragColor = vec4(col * val * uIntensity, val * 0.25);',
    '}'
  ].join('\n');

  // ─── Create shader background ─────────────────────────
  // Current active shader type
  var currentShader = 'nebula';
  var shaderMesh = null;

  // Theme-aware colors (will be updated by theme-manager)
  var shaderColors = {
    color1: new THREE.Vector3(0.71, 0.29, 1.0),   // #b44aff
    color2: new THREE.Vector3(0.27, 0.1, 0.53),    // #441588
    color3: new THREE.Vector3(0.55, 0.36, 0.96)    // #8b5cf6
  };

  function createShaderMesh(type) {
    if (shaderMesh) {
      scene.remove(shaderMesh);
      shaderMesh.geometry.dispose();
      shaderMesh.material.dispose();
    }

    var fragShader;
    switch (type) {
      case 'grid': fragShader = gridFragmentShader; break;
      case 'ripple': fragShader = rippleFragmentShader; break;
      default: fragShader = nebulaFragmentShader; break;
    }

    var geo = new THREE.PlaneGeometry(200, 200);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uColor1: { value: shaderColors.color1.clone() },
        uColor2: { value: shaderColors.color2.clone() },
        uColor3: { value: shaderColors.color3.clone() },
        uIntensity: { value: 0.6 }
      },
      vertexShader: nebulaVertexShader,
      fragmentShader: fragShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    shaderMesh = new THREE.Mesh(geo, mat);
    shaderMesh.position.z = -150;
    scene.add(shaderMesh);
    currentShader = type;
  }

  // Defer scene-dependent init
  TM.onReady(function (mgr) {
    scene = mgr.bgScene;
    createShaderMesh('nebula');
  });

  // ─── Shader Module API ─────────────────────────────────
  TM.shaderModule = {
    update: function (elapsed, delta) {
      if (shaderMesh && shaderMesh.material.uniforms) {
        shaderMesh.material.uniforms.uTime.value = elapsed;
      }
    },

    resize: function (w, h) {
      if (shaderMesh && shaderMesh.material.uniforms) {
        shaderMesh.material.uniforms.uResolution.value.set(w, h);
      }
    },

    onGameEvent: function (type, data) {
      if (type === 'game-over' && shaderMesh && shaderMesh.material.uniforms) {
        // Intensity pulse on win
        shaderMesh.material.uniforms.uIntensity.value = 1.0;
        setTimeout(function () {
          if (shaderMesh && shaderMesh.material.uniforms) {
            shaderMesh.material.uniforms.uIntensity.value = 0.6;
          }
        }, 2000);
      }
    },

    // Switch shader type
    setShader: function (type) {
      createShaderMesh(type);
    },

    // Update colors (called by theme-manager)
    setColors: function (c1, c2, c3) {
      shaderColors.color1.set(c1.x, c1.y, c1.z);
      shaderColors.color2.set(c2.x, c2.y, c2.z);
      shaderColors.color3.set(c3.x, c3.y, c3.z);
      if (shaderMesh && shaderMesh.material.uniforms) {
        shaderMesh.material.uniforms.uColor1.value.copy(shaderColors.color1);
        shaderMesh.material.uniforms.uColor2.value.copy(shaderColors.color2);
        shaderMesh.material.uniforms.uColor3.value.copy(shaderColors.color3);
      }
    },

    getShaderType: function () { return currentShader; }
  };

  console.log('[ThreeShaders] Procedural backgrounds initialized');
})();
