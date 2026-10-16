// three-background.js — 3D background environment for Word500 2.0
// Floating letters, dynamic lighting, camera drift, starfield

(function () {
  'use strict';

  if (typeof THREE === 'undefined' || !window.ThreeManager) return;

  var TM = window.ThreeManager;

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  TM.onReady(function (mgr) {
  var scene = mgr.bgScene;
  var camera = mgr.bgCamera;

  var w = window.innerWidth;
  var h = window.innerHeight;

  // ─── Starfield ─────────────────────────────────────────
  var STAR_COUNT = 500;
  var starPositions = new Float32Array(STAR_COUNT * 3);
  var starSizes = new Float32Array(STAR_COUNT);
  var starAlphas = new Float32Array(STAR_COUNT);

  for (var s = 0; s < STAR_COUNT; s++) {
    starPositions[s * 3] = rand(-150, 150);
    starPositions[s * 3 + 1] = rand(-100, 100);
    starPositions[s * 3 + 2] = rand(-200, -50);
    starSizes[s] = rand(0.5, 2.5);
    starAlphas[s] = rand(0.3, 0.8);
  }

  var starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));

  var starMat = new THREE.PointsMaterial({
    color: 0xb4bbff,
    size: 1.5,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
    depthWrite: false
  });

  var stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ─── Floating Letters ──────────────────────────────────
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var LETTER_COUNT = 25;
  var letterMeshes = [];
  var letterData = [];

  function createLetterTexture(letter) {
    var canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(180, 74, 255, 0.4)';
    ctx.font = 'bold 48px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 32, 32);
    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  for (var i = 0; i < LETTER_COUNT; i++) {
    var letter = LETTERS[i % LETTERS.length];
    var texture = createLetterTexture(letter);
    var geo = new THREE.PlaneGeometry(4, 4);
    var mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var mesh = new THREE.Mesh(geo, mat);

    var x = rand(-60, 60);
    var y = rand(-40, 40);
    var z = rand(-80, -10);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));

    scene.add(mesh);
    letterMeshes.push(mesh);
    letterData.push({
      letter: letter,
      baseX: x, baseY: y, baseZ: z,
      rotSpeedX: rand(-0.003, 0.003),
      rotSpeedY: rand(-0.005, 0.005),
      rotSpeedZ: rand(-0.002, 0.002),
      driftX: rand(-0.02, 0.02),
      driftY: rand(-0.01, 0.01),
      phase: rand(0, Math.PI * 2),
      scatterBoost: 0
    });
  }

  // ─── Dynamic Lighting ──────────────────────────────────
  var ambientLight = new THREE.AmbientLight(0x15202b, 0.3);
  scene.add(ambientLight);

  var pointLight1 = new THREE.PointLight(0xb44aff, 1, 100);
  pointLight1.position.set(20, 15, 20);
  scene.add(pointLight1);

  var pointLight2 = new THREE.PointLight(0x8b5cf6, 0.8, 80);
  pointLight2.position.set(-20, -10, 15);
  scene.add(pointLight2);

  // Target colors for event reactions
  var lightTargetColor1 = new THREE.Color(0xb44aff);
  var lightTargetColor2 = new THREE.Color(0x8b5cf6);
  var lightColorTransition = 0;

  // ─── Camera drift state ────────────────────────────────
  var cameraDrift = {
    baseX: 0, baseY: 0, baseZ: 50,
    angleX: 0, angleY: 0,
    speedX: 0.15, speedY: 0.1
  };

  // ─── Background Module API ─────────────────────────────
  mgr.backgroundModule = {
    update: function (elapsed, delta) {
      // Star rotation
      stars.rotation.y = elapsed * 0.01;
      stars.rotation.x = Math.sin(elapsed * 0.05) * 0.05;

      // Star twinkle via opacity modulation
      starMat.opacity = 0.4 + 0.2 * Math.sin(elapsed * 0.5);

      // Letter animation
      for (var i = 0; i < letterMeshes.length; i++) {
        var ld = letterData[i];
        var mesh = letterMeshes[i];

        // Gentle rotation
        mesh.rotation.x += ld.rotSpeedX;
        mesh.rotation.y += ld.rotSpeedY;
        mesh.rotation.z += ld.rotSpeedZ;

        // Gentle drift
        var scatterMult = 1 + ld.scatterBoost * 5;
        mesh.position.x = ld.baseX + Math.sin(elapsed * 0.2 + ld.phase) * 3 * scatterMult;
        mesh.position.y = ld.baseY + Math.cos(elapsed * 0.15 + ld.phase) * 2 * scatterMult;

        // Decay scatter
        if (ld.scatterBoost > 0) {
          ld.scatterBoost = Math.max(0, ld.scatterBoost - delta * 0.5);
        }
      }

      // Light orbiting
      pointLight1.position.x = Math.cos(elapsed * 0.3) * 30;
      pointLight1.position.y = Math.sin(elapsed * 0.2) * 20;
      pointLight2.position.x = Math.cos(elapsed * 0.25 + Math.PI) * 25;
      pointLight2.position.y = Math.sin(elapsed * 0.35 + Math.PI) * 15;

      // Light color transition (back to default)
      if (lightColorTransition > 0) {
        lightColorTransition = Math.max(0, lightColorTransition - delta * 0.5);
      }
      pointLight1.color.lerp(lightTargetColor1, 1 - lightColorTransition);
      pointLight2.color.lerp(lightTargetColor2, 1 - lightColorTransition);

      // Camera drift
      cameraDrift.angleX += cameraDrift.speedX * delta;
      cameraDrift.angleY += cameraDrift.speedY * delta;
      camera.position.x = cameraDrift.baseX + Math.sin(cameraDrift.angleX) * 2;
      camera.position.y = cameraDrift.baseY + Math.sin(cameraDrift.angleY) * 1.5;
      camera.lookAt(0, 0, 0);
    },

    resize: function (newW, newH) {
      w = newW;
      h = newH;
    },

    onGameEvent: function (type, data) {
      if (type === 'guess') {
        // Letters scatter briefly
        for (var i = 0; i < letterData.length; i++) {
          letterData[i].scatterBoost = 0.3;
        }
      } else if (type === 'game-over') {
        // Zoom-pulse camera and gold lighting
        cameraDrift.baseZ = 45; // brief zoom
        setTimeout(function () { cameraDrift.baseZ = 50; }, 500);

        // Gold light burst
        pointLight1.color.set(0xffd700);
        pointLight2.color.set(0xffa500);
        lightColorTransition = 1;

        // Letters scatter strongly
        for (var j = 0; j < letterData.length; j++) {
          letterData[j].scatterBoost = 1;
        }
      } else if (type === 'new-game') {
        // Reset to default
        lightTargetColor1.set(0xb44aff);
        lightTargetColor2.set(0x8b5cf6);
      }
    }
  };

  console.log('[ThreeBackground] 3D environment initialized');
  }); // end onReady
})();
