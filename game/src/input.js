// Keyboard and mouse: WASD + arrows, Shift, Space, E, F, G, H, L, M, R, V,
// Esc, and a drag-to-orbit camera with click-to-shoot. The game reads plain
// booleans from here each frame; edge-triggered keys (E, F, Esc) are consumed
// once.
//
// v3 keys: V cycles the weather, L toggles the headlights, G repairs the car
// at Mara's garage. Space is the handbrake while driving, jump on foot.
//
// v4 keys: C cycles the chase-camera distance (close / medium / far) while
// driving, and Q toggles the police roster panel on and off.
//
// v5 keys: P toggles the stats screen — missions done, stashes found, cars
// stolen, best wanted level and play time — from play or from pause.
//
// v6: X triggers the dodge roll (the player reads pressedX as an edge), and
// holding the RIGHT mouse button enters aim mode — the crosshair tightens
// and movement slows. Left-drag still orbits the camera, and a left click
// (a quick press without dragging) still fires. Right-drag no longer spins
// the camera, so aiming never fights the orbit. The context menu is
// suppressed on the canvas so the right button is usable at all.
export class Input {
  constructor(canvas) {
    this.forward = false;
    this.back = false;
    this.left = false;
    this.right = false;
    this.sprint = false;
    this.jump = false;
    this.handbrake = false;
    this.shoot = false;
    // v6: aim mode — held while the right mouse button is down.
    this.aim = false;
    this.pressedE = false;
    this.pressedF = false;
    this.pressedG = false;
    this.pressedH = false;
    this.pressedL = false;
    this.pressedM = false;
    this.pressedR = false;
    this.pressedN = false;
    this.pressedV = false;
    this.pressedC = false;
    this.pressedQ = false;
    // v5: P toggles the stats screen (pause-menu stats, also in play).
    this.pressedP = false;
    // v6: X triggers the dodge roll.
    this.pressedX = false;
    this.pressedWeapon = 0;
    this.pressedEsc = false;
    this.camDeltaX = 0;
    this.camDeltaY = 0;
    this.dragging = false;
    this._keys = new Set();
    // The click that fires a shot is only a click if the pointer barely
    // moved between down and up — a drag is an orbit, not a shot.
    this._downX = 0;
    this._downY = 0;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      this._syncKeys();
      if (e.code === 'KeyE') this.pressedE = true;
      if (e.code === 'KeyF') this.pressedF = true;
      if (e.code === 'KeyG') this.pressedG = true;
      if (e.code === 'KeyH') this.pressedH = true;
      if (e.code === 'KeyL') this.pressedL = true;
      if (e.code === 'KeyM') this.pressedM = true;
      if (e.code === 'KeyR') this.pressedR = true;
      if (e.code === 'KeyN') this.pressedN = true;
      if (e.code === 'KeyV') this.pressedV = true;
      if (e.code === 'KeyC') this.pressedC = true;
      if (e.code === 'KeyQ') this.pressedQ = true;
      if (e.code === 'KeyP') this.pressedP = true;
      if (e.code === 'KeyX') this.pressedX = true;
      if (e.code === 'Digit1') this.pressedWeapon = 1;
      if (e.code === 'Digit2') this.pressedWeapon = 2;
      if (e.code === 'Digit3') this.pressedWeapon = 3;
      if (e.code === 'Digit4') this.pressedWeapon = 4;
      if (e.code === 'Escape') this.pressedEsc = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      this._syncKeys();
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._syncKeys();
      this.aim = false;
      this.dragging = false;
    });

    // Right-button aim: the browser's context menu is suppressed on the
    // canvas so the right button belongs to the game.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.aim = true;
        return;
      }
      if (e.button !== 0) return;
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._downX = e.clientX;
      this._downY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.camDeltaX += e.clientX - this._lastX;
      this.camDeltaY += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    const endDrag = (e) => {
      if (e && e.button === 2) {
        this.aim = false;
        return;
      }
      // A left-button release that barely moved is a click: fire.
      if (this.dragging && e && Math.hypot(e.clientX - this._downX, e.clientY - this._downY) < 6) {
        this.shoot = true;
      }
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    // The aim button can be released outside the canvas — watch the window.
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.aim = false;
    });
    window.addEventListener('pointercancel', () => { this.aim = false; });
  }

  _syncKeys() {
    const k = this._keys;
    this.forward = k.has('KeyW') || k.has('ArrowUp');
    this.back = k.has('KeyS') || k.has('ArrowDown');
    this.left = k.has('KeyA') || k.has('ArrowLeft');
    this.right = k.has('KeyD') || k.has('ArrowRight');
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    this.jump = k.has('Space');
    this.handbrake = k.has('Space');
  }

  /** Read and clear the edge-triggered keys after each frame's logic. */
  consumeEdges() {
    const edges = {
      e: this.pressedE, f: this.pressedF, g: this.pressedG,
      h: this.pressedH, l: this.pressedL, m: this.pressedM,
      esc: this.pressedEsc, r: this.pressedR, n: this.pressedN,
      v: this.pressedV, c: this.pressedC, q: this.pressedQ,
      p: this.pressedP, x: this.pressedX,
      weapon: this.pressedWeapon,
    };
    this.pressedE = false;
    this.pressedF = false;
    this.pressedG = false;
    this.pressedH = false;
    this.pressedL = false;
    this.pressedM = false;
    this.pressedR = false;
    this.pressedN = false;
    this.pressedV = false;
    this.pressedC = false;
    this.pressedQ = false;
    this.pressedP = false;
    this.pressedX = false;
    this.pressedWeapon = 0;
    this.pressedEsc = false;
    return edges;
  }

  consumeCamera() {
    const d = { x: this.camDeltaX, y: this.camDeltaY };
    this.camDeltaX = 0;
    this.camDeltaY = 0;
    return d;
  }

  consumeShoot() {
    const s = this.shoot;
    this.shoot = false;
    return s;
  }

  /** Test and demo scripts drive the game through this, not real keys. */
  setVirtual(state) {
    Object.assign(this, state);
  }
}
