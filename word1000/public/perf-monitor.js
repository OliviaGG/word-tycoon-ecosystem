// perf-monitor.js — Performance monitoring for Word500 2.0
// Togglable FPS counter, Three.js stats, Socket.IO ping

(function () {
  'use strict';

  var PerfMonitor = {
    visible: false,
    el: null,
    fpsFrames: 0,
    fpsTime: 0,
    currentFps: 0,
    _rafId: null,

    init: function () {
      // Create overlay element
      this.el = document.createElement('div');
      this.el.id = 'perf-monitor';
      this.el.style.cssText = [
        'position:fixed;top:4px;right:4px;z-index:100001;',
        'background:rgba(0,0,0,0.75);color:#4ade80;',
        'font:11px/1.4 monospace;padding:4px 8px;border-radius:4px;',
        'pointer-events:none;display:none;',
        'border:1px solid rgba(74,222,128,0.3);'
      ].join('');
      document.body.appendChild(this.el);

      // Toggle with F2 or Ctrl+Shift+P
      var self = this;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'F2' || (e.ctrlKey && e.shiftKey && e.key === 'P')) {
          e.preventDefault();
          self.toggle();
        }
      });

      // Start measurement loop
      this.fpsTime = performance.now();
      this._tick();
    },

    toggle: function () {
      this.visible = !this.visible;
      this.el.style.display = this.visible ? 'block' : 'none';
    },

    _tick: function () {
      var self = this;
      this._rafId = requestAnimationFrame(function () { self._tick(); });

      this.fpsFrames++;
      var now = performance.now();
      var elapsed = now - this.fpsTime;

      if (elapsed >= 1000) {
        this.currentFps = Math.round(this.fpsFrames * 1000 / elapsed);
        this.fpsFrames = 0;
        this.fpsTime = now;

        if (this.visible) {
          this._updateDisplay();
        }
      }
    },

    _updateDisplay: function () {
      var lines = [];

      // FPS
      var fpsColor = this.currentFps >= 55 ? '#4ade80' : this.currentFps >= 30 ? '#f1c40f' : '#e74c3c';
      lines.push('<span style="color:' + fpsColor + '">' + this.currentFps + ' FPS</span>');

      // Three.js tier
      if (window.ThreeManager) {
        var tier = window.ThreeManager.getTier();
        var tierColor = tier === 'high' ? '#4ade80' : tier === 'medium' ? '#f1c40f' : '#e74c3c';
        lines.push('Tier: <span style="color:' + tierColor + '">' + tier + '</span>');

        // Renderer info
        var renderer = window.ThreeManager.getRenderer();
        if (renderer && renderer.info) {
          var info = renderer.info;
          lines.push('Draw: ' + info.render.calls + ' | Tri: ' + info.render.triangles);
          lines.push('Tex: ' + info.memory.textures + ' | Geo: ' + info.memory.geometries);
        }
      }

      // Memory (if available)
      if (performance.memory) {
        var mem = Math.round(performance.memory.usedJSHeapSize / 1048576);
        lines.push('Mem: ' + mem + 'MB');
      }

      // Audio state
      if (window.AudioManager) {
        lines.push('Audio: ' + (window.AudioManager.muted ? 'MUTED' : 'ON'));
      }

      this.el.innerHTML = lines.join('<br>');
    }
  };

  PerfMonitor.init();
  window.PerfMonitor = PerfMonitor;
})();
