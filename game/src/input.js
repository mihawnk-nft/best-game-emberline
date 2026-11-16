// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain
// browser APIs only: the game asks the canvas for pointer lock and reads movementX/Y
// while it holds it. Keys are a live set; pressed() catches the edge of a key so a
// buy-menu toggle or a grenade throw fires once per press.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressedKeys = new Set();
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) pressedKeys.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => { keys.clear(); pressedKeys.clear(); });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      try {
        const result = canvas.requestPointerLock();
        if (result && result.catch) result.catch(() => {});
      } catch {
        // Pointer lock is best-effort: the match still runs without it.
      }
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // True once per physical press, consumed by the caller each frame.
    pressed(code) {
      if (!pressedKeys.has(code)) return false;
      pressedKeys.delete(code);
      return true;
    },
    clearPressed() {
      pressedKeys.clear();
    },
  };
}
