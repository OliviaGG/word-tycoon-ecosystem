// theme-manager.js — Theme switching system for Word500 2.0
// Switches CSS custom properties and updates Three.js colors

(function () {
  'use strict';

  var THEMES = {
    default: {
      name: 'Neon Purple',
      vars: {
        '--bg-tile': '#252540',
        '--border': '#3a3a55',
        '--text': '#e8e8f0',
        '--text-dim': '#6a6a88',
        '--red': '#e74c3c',
        '--red-glow': 'rgba(231, 76, 60, 0.3)',
        '--red-bg': 'rgba(231, 76, 60, 0.15)',
        '--green': '#4ade80',
        '--green-glow': 'rgba(74, 222, 128, 0.3)',
        '--yellow': '#f1c40f',
        '--yellow-glow': 'rgba(241, 196, 15, 0.3)',
        '--accent': '#8b5cf6',
        '--accent-glow': 'rgba(139, 92, 246, 0.4)',
        '--neon-purple': '#b44aff',
        '--neon-purple-glow': 'rgba(180, 74, 255, 0.6)',
        '--neon-purple-glow-soft': 'rgba(180, 74, 255, 0.3)',
        '--game-bg': '#15202b',
        '--row-bg': 'rgba(17, 27, 36, 0.9)'
      },
      threeBg: 0x15202b,
      shaderColors: [
        { x: 0.71, y: 0.29, z: 1.0 },
        { x: 0.27, y: 0.1, z: 0.53 },
        { x: 0.55, y: 0.36, z: 0.96 }
      ]
    },
    ocean: {
      name: 'Ocean',
      vars: {
        '--bg-tile': '#1a2f3f',
        '--border': '#2a4a5f',
        '--text': '#e0f2f1',
        '--text-dim': '#5f8a8a',
        '--red': '#ef5350',
        '--red-glow': 'rgba(239, 83, 80, 0.3)',
        '--red-bg': 'rgba(239, 83, 80, 0.15)',
        '--green': '#26a69a',
        '--green-glow': 'rgba(38, 166, 154, 0.3)',
        '--yellow': '#ffca28',
        '--yellow-glow': 'rgba(255, 202, 40, 0.3)',
        '--accent': '#00b4d8',
        '--accent-glow': 'rgba(0, 180, 216, 0.4)',
        '--neon-purple': '#00b4d8',
        '--neon-purple-glow': 'rgba(0, 180, 216, 0.6)',
        '--neon-purple-glow-soft': 'rgba(0, 180, 216, 0.3)',
        '--game-bg': '#0a1628',
        '--row-bg': 'rgba(10, 22, 40, 0.9)'
      },
      threeBg: 0x0a1628,
      shaderColors: [
        { x: 0.0, y: 0.71, z: 0.85 },
        { x: 0.0, y: 0.3, z: 0.5 },
        { x: 0.15, y: 0.56, z: 0.6 }
      ]
    },
    crimson: {
      name: 'Crimson',
      vars: {
        '--bg-tile': '#2d1a1a',
        '--border': '#4a2a2a',
        '--text': '#f0e0e0',
        '--text-dim': '#8a5f5f',
        '--red': '#ff4444',
        '--red-glow': 'rgba(255, 68, 68, 0.3)',
        '--red-bg': 'rgba(255, 68, 68, 0.15)',
        '--green': '#66bb6a',
        '--green-glow': 'rgba(102, 187, 106, 0.3)',
        '--yellow': '#ffa726',
        '--yellow-glow': 'rgba(255, 167, 38, 0.3)',
        '--accent': '#e53935',
        '--accent-glow': 'rgba(229, 57, 53, 0.4)',
        '--neon-purple': '#ff1744',
        '--neon-purple-glow': 'rgba(255, 23, 68, 0.6)',
        '--neon-purple-glow-soft': 'rgba(255, 23, 68, 0.3)',
        '--game-bg': '#1a0a0a',
        '--row-bg': 'rgba(26, 10, 10, 0.9)'
      },
      threeBg: 0x1a0a0a,
      shaderColors: [
        { x: 1.0, y: 0.09, z: 0.27 },
        { x: 0.5, y: 0.05, z: 0.1 },
        { x: 0.9, y: 0.22, z: 0.21 }
      ]
    },
    forest: {
      name: 'Forest',
      vars: {
        '--bg-tile': '#1a2d1a',
        '--border': '#2a4a2a',
        '--text': '#e0f0e0',
        '--text-dim': '#5f8a5f',
        '--red': '#ef5350',
        '--red-glow': 'rgba(239, 83, 80, 0.3)',
        '--red-bg': 'rgba(239, 83, 80, 0.15)',
        '--green': '#69f0ae',
        '--green-glow': 'rgba(105, 240, 174, 0.3)',
        '--yellow': '#fdd835',
        '--yellow-glow': 'rgba(253, 216, 53, 0.3)',
        '--accent': '#2e7d32',
        '--accent-glow': 'rgba(46, 125, 50, 0.4)',
        '--neon-purple': '#00e676',
        '--neon-purple-glow': 'rgba(0, 230, 118, 0.6)',
        '--neon-purple-glow-soft': 'rgba(0, 230, 118, 0.3)',
        '--game-bg': '#0a1a0a',
        '--row-bg': 'rgba(10, 26, 10, 0.9)'
      },
      threeBg: 0x0a1a0a,
      shaderColors: [
        { x: 0.0, y: 0.9, z: 0.46 },
        { x: 0.0, y: 0.35, z: 0.15 },
        { x: 0.18, y: 0.49, z: 0.2 }
      ]
    },
    gold: {
      name: 'Gold Premium',
      vars: {
        '--bg-tile': '#2d2510',
        '--border': '#4a3e1a',
        '--text': '#f5e6c8',
        '--text-dim': '#8a7a50',
        '--red': '#ef5350',
        '--red-glow': 'rgba(239, 83, 80, 0.3)',
        '--red-bg': 'rgba(239, 83, 80, 0.15)',
        '--green': '#66bb6a',
        '--green-glow': 'rgba(102, 187, 106, 0.3)',
        '--yellow': '#ffd700',
        '--yellow-glow': 'rgba(255, 215, 0, 0.3)',
        '--accent': '#ffc107',
        '--accent-glow': 'rgba(255, 193, 7, 0.4)',
        '--neon-purple': '#ffd700',
        '--neon-purple-glow': 'rgba(255, 215, 0, 0.6)',
        '--neon-purple-glow-soft': 'rgba(255, 215, 0, 0.3)',
        '--game-bg': '#1a1408',
        '--row-bg': 'rgba(26, 20, 8, 0.9)'
      },
      threeBg: 0x1a1408,
      shaderColors: [
        { x: 1.0, y: 0.84, z: 0.0 },
        { x: 0.5, y: 0.4, z: 0.0 },
        { x: 1.0, y: 0.76, z: 0.03 }
      ]
    },
    minimal: {
      name: 'Minimal Light',
      vars: {
        '--bg-tile': '#e8e8e8',
        '--border': '#d0d0d0',
        '--text': '#1a1a1a',
        '--text-dim': '#888888',
        '--red': '#d32f2f',
        '--red-glow': 'rgba(211, 47, 47, 0.2)',
        '--red-bg': 'rgba(211, 47, 47, 0.1)',
        '--green': '#2e7d32',
        '--green-glow': 'rgba(46, 125, 50, 0.2)',
        '--yellow': '#f9a825',
        '--yellow-glow': 'rgba(249, 168, 37, 0.2)',
        '--accent': '#5c6bc0',
        '--accent-glow': 'rgba(92, 107, 192, 0.3)',
        '--neon-purple': '#5c6bc0',
        '--neon-purple-glow': 'rgba(92, 107, 192, 0.4)',
        '--neon-purple-glow-soft': 'rgba(92, 107, 192, 0.2)',
        '--game-bg': '#f5f5f5',
        '--row-bg': 'rgba(245, 245, 245, 0.95)'
      },
      threeBg: 0xf5f5f5,
      shaderColors: [
        { x: 0.36, y: 0.42, z: 0.75 },
        { x: 0.8, y: 0.82, z: 0.9 },
        { x: 0.5, y: 0.55, z: 0.8 }
      ]
    }
  };

  var ThemeManager = {
    current: 'default',

    init: function () {
      var viaUrl = null;
      try {
        viaUrl = new URLSearchParams(window.location.search).get('theme');
      } catch (e) {}
      if (viaUrl === 'light' || viaUrl === 'dark') {
        try { localStorage.setItem('wordtycoon_theme', viaUrl); } catch (e) {}
      }
      var saved = viaUrl || localStorage.getItem('wordtycoon_theme');
      if (saved === 'light') saved = 'minimal';
      else if (saved === 'dark') saved = null;
      if (!saved) saved = localStorage.getItem('word500_theme');
      if (saved && THEMES[saved]) {
        this.apply(saved);
      }
    },

    apply: function (themeId) {
      var theme = THEMES[themeId];
      if (!theme) return;

      this.current = themeId;
      localStorage.setItem('word500_theme', themeId);

      // Apply CSS variables
      var root = document.documentElement;
      var vars = theme.vars;
      for (var key in vars) {
        root.style.setProperty(key, vars[key]);
      }

      // Update Three.js background color
      if (window.ThreeManager && window.ThreeManager.renderer) {
        window.ThreeManager.renderer.setClearColor(theme.threeBg, 1);
      }

      // Update shader colors
      if (window.ThreeManager && window.ThreeManager.shaderModule && window.ThreeManager.shaderModule.setColors) {
        var sc = theme.shaderColors;
        window.ThreeManager.shaderModule.setColors(sc[0], sc[1], sc[2]);
      }

      // Update background point lights
      if (window.ThreeManager && window.ThreeManager.bgScene) {
        var lights = window.ThreeManager.bgScene.children.filter(function (c) {
          return c.isPointLight;
        });
        if (lights.length >= 2) {
          var c1 = parseInt(vars['--neon-purple'].slice(1), 16) || 0xb44aff;
          var c2 = parseInt(vars['--accent'].slice(1), 16) || 0x8b5cf6;
          lights[0].color.set(c1);
          lights[1].color.set(c2);
        }
      }
    },

    getThemes: function () {
      var list = [];
      for (var id in THEMES) {
        list.push({ id: id, name: THEMES[id].name });
      }
      return list;
    },

    next: function () {
      var ids = Object.keys(THEMES);
      var idx = ids.indexOf(this.current);
      var nextIdx = (idx + 1) % ids.length;
      this.apply(ids[nextIdx]);
      return ids[nextIdx];
    }
  };

  // Initialize
  ThemeManager.init();

  // Keyboard shortcut: Ctrl+Shift+T to cycle themes
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      var newTheme = ThemeManager.next();
      console.log('[ThemeManager] Switched to: ' + THEMES[newTheme].name);
    }
  });

  window.ThemeManager = ThemeManager;
  console.log('[ThemeManager] Theme system initialized');
})();
