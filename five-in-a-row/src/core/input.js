// core/input.js
// Unified pointer input for a canvas: ONE Pointer Events code path
// covers mouse, touch, and pen. Deliberately not mouse*/touch* — those
// double-fire on touch devices that also synthesize mouse events, and
// diverge in exactly the ways that cause missed/duplicated moves.
// Game-agnostic — reusable as-is for Gomoku.
//
// Callback shape:
//   onMove(pos, meta) - mouse: fires continuously (real hover).
//                        touch: only fires between onDown and onUp (drag);
//                        touch has no hover, so there is nothing to fire
//                        before a finger is down.
//   onDown(pos, meta) - pointer pressed (mouse button down / finger touch).
//   onUp(pos, meta)   - pointer released. This is the "commit" moment for
//                        both input types — the game layer decides what
//                        that means (click confirms for mouse, drag-release
//                        confirms for touch), the input layer just reports it.
//   onCancel()        - pointer left the canvas without pressing (mouse),
//                        or the OS interrupted the gesture (pointercancel,
//                        e.g. a system gesture took over mid-touch).
//
// meta = { pointerType: 'mouse'|'touch'|'pen', pressed: boolean }
export function attachPointerHandlers(canvas, { onMove, onDown, onUp, onCancel } = {}) {
  let activePointerId = null;

  function toLocalPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function meta(evt) {
    return { pointerType: evt.pointerType, pressed: activePointerId !== null };
  }

  function handlePointerMove(evt) {
    if (activePointerId !== null && evt.pointerId !== activePointerId) return;
    onMove && onMove(toLocalPos(evt), meta(evt));
  }

  function handlePointerDown(evt) {
    if (activePointerId !== null) return; // ignore a second finger mid-gesture
    activePointerId = evt.pointerId;
    canvas.setPointerCapture(evt.pointerId);
    onDown && onDown(toLocalPos(evt), meta(evt));
  }

  function handlePointerUp(evt) {
    if (evt.pointerId !== activePointerId) return;
    const pos = toLocalPos(evt);
    const m = meta(evt);
    activePointerId = null;
    onUp && onUp(pos, m);
  }

  function handlePointerCancel(evt) {
    if (evt.pointerId !== activePointerId) return;
    activePointerId = null;
    onCancel && onCancel();
  }

  function handlePointerLeave() {
    // A pressed pointer is captured by the canvas, so real presses don't
    // fire "leave" until release — this only fires for hover (mouse with
    // no button down) actually exiting the board.
    if (activePointerId === null) onCancel && onCancel();
  }

  // Belt-and-suspenders alongside the CSS `touch-action: none` on the
  // canvas — without one of these, a touch-drag scrolls/zooms the page
  // instead of drawing an edge, which reads as "the game is broken" on
  // mobile with zero error to debug from.
  canvas.style.touchAction = "none";

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("pointerleave", handlePointerLeave);

  return function detach() {
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
  };
}
