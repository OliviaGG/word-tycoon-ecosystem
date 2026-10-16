// ===== DOM Renderer =====
// Direct DOM positioning — replaces CSS3DRenderer entirely.
// UI elements are absolutely positioned inside a scaled container.
//
// Coordinate system matches the Three.js world space used by the rest of the code:
//   - Origin (0,0): top-left of base content area
//   - +X: right, -Y: down (same as CSS3DRenderer convention)
//   - Camera looks at (baseWidth/2, -baseHeight/2) = (900, -1350), mapping to screen center
//
// Transform: cssX = x - CAMERA_CX,  cssY = -(y + CAMERA_CY)
//   (Y is flipped: 3D up = CSS negative Y)

const CAMERA_CY = 1350; // = CameraController.baseHeight / 2  (hardcoded 2700 / 2)

export class DOMRenderer {
  constructor(baseWidth) {
    this._cx = baseWidth / 2; // 900

    // Fixed container anchored to screen center (width:0 avoids layout impact)
    this.domElement = document.createElement('div');
    this.domElement.id = 'dom-ui-container';
    this.domElement.style.cssText =
      'position:fixed;top:50%;left:50%;width:0;height:0;overflow:visible;' +
      'pointer-events:none;z-index:1;';

    // Scale wrapper: maps base-unit coordinates to screen pixels
    this._scaleEl = document.createElement('div');
    this._scaleEl.style.transformOrigin = '0 0';
    this.domElement.appendChild(this._scaleEl);

    // Group container — bubble entries live here, scrolls via translateY.
    // Clipping is handled by GuessList's DOM-level cull system (detach/reattach),
    // NOT by CSS overflow:hidden, which is unreliable with translate3d compositing
    // layers in OBS's CEF browser.
    this._groupEl = document.createElement('div');
    this._groupEl.id = 'dom-bubble-group';
    this._scaleEl.appendChild(this._groupEl);
  }

  // Called on resize — viewport.scale maps base units to screen pixels
  resize(viewport) {
    this._scaleEl.style.transform = `scale(${viewport.scale})`;
  }

  // Add element to static layer (header, jackpot bar, pinned guess, win overlay).
  // Appended to _scaleEl AFTER _groupEl so they render on top of entries.
  add(el) {
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    this._scaleEl.appendChild(el);
  }

  // Add element to scrolling bubble group (GuessList entries)
  addToGroup(el) {
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    this._groupEl.appendChild(el);
  }

  // Remove element from wherever it lives
  remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // Update group scroll offset. groupY_3D = group.position.y in 3D (negative = down).
  // CSS translateY is the negative of that (flipping the coordinate).
  setGroupY(groupY_3D) {
    this._groupEl.style.transform = `translateY(${-groupY_3D}px)`;
  }

  // Compute CSS transform string for a 3D position + rotation
  transform(x, y, z = 0, rx = 0, ry = 0) {
    const cssX = x - this._cx;
    const cssY = -(y + CAMERA_CY);
    let t = `translate(-50%,-50%) translate3d(${cssX}px,${cssY}px,${z}px)`;
    if (Math.abs(rx) > 0.0005) t += ` rotateX(${-rx}rad)`;
    if (Math.abs(ry) > 0.0005) t += ` rotateY(${ry}rad)`;
    return t;
  }

  applyTransform(el, x, y, z = 0, rx = 0, ry = 0) {
    el.style.transform = this.transform(x, y, z, rx, ry);
  }

  // Create a position/rotation object whose .set() auto-applies the DOM transform.
  // Used by static UI elements (HeaderBar, JackpotBar, WinOverlay, PinnedGuess).
  makeObject(element) {
    const dr = this;
    const obj = {
      element,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1, set() {} }, // no-op, kept for API compat
      parent: null,
    };

    // visible setter controls display:none
    let _visible = true;
    Object.defineProperty(obj, 'visible', {
      get() { return _visible; },
      set(v) { _visible = v; element.style.display = v ? '' : 'none'; },
    });

    // position: any assignment (set(), .x=, .y=, .z=) auto-applies transform
    const pos = { _x: 0, _y: 0, _z: 0 };
    const applyPos = () => dr.applyTransform(element, pos._x, pos._y, pos._z, obj.rotation.x, obj.rotation.y);
    Object.defineProperties(pos, {
      x: { get() { return this._x; }, set(v) { this._x = v; applyPos(); }, enumerable: true },
      y: { get() { return this._y; }, set(v) { this._y = v; applyPos(); }, enumerable: true },
      z: { get() { return this._z; }, set(v) { this._z = v; applyPos(); }, enumerable: true },
    });
    pos.set = function(x, y, z) { this._x = x; this._y = y; this._z = z; applyPos(); };
    obj.position = pos;

    return obj;
  }
}
