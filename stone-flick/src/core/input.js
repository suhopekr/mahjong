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

  /**
   * The canvas rect, cached.
   *
   * getBoundingClientRect() forces the browser to flush pending layout
   * before it can answer, and this used to run on EVERY pointermove — up
   * to 120 forced layouts a second on a high-refresh trackpad, each one
   * landing between the move event and the frame that draws it. That is
   * the classic shape of a drag that feels slightly sticky, and it was
   * doing it to read a number that only changes when the window does.
   *
   * Refreshed on the events that can actually move the canvas, and again
   * at the start of every gesture, which is cheap and makes a stale rect
   * impossible to notice.
   */
  let rect = null;
  const invalidateRect = () => {
    rect = null;
  };
  function toLocalPos(evt) {
    if (rect === null) rect = canvas.getBoundingClientRect();
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
    invalidateRect(); // a gesture always starts from a fresh measurement
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

  /**
   * iOS: KILL THE LOUPE.
   *
   * Holding a finger still on the canvas pops Safari's text-selection
   * magnifier over the board — right on top of the stone being aimed,
   * during the one gesture in the game where the player needs to see
   * what is under their thumb. `user-select: none` and
   * `-webkit-touch-callout: none` are both set in the stylesheet and are
   * not enough on their own: the loupe and the long-press callout are
   * DEFAULT ACTIONS of the touch sequence, and only preventing that
   * default cancels them.
   *
   * Safe to do here because the game never wants a touch default on the
   * canvas: no scrolling, no zoom, no selection, no synthesized click.
   * Pointer events are unaffected — pointerdown has already been
   * dispatched by the time touchstart's default would be taken — which is
   * what the mobile drag case in test/browser-check.mjs proves.
   *
   * Canvas only, deliberately. The same call on the document would take
   * the taps away from every button in the game.
   */
  const swallow = (evt) => evt.preventDefault();
  canvas.addEventListener("touchstart", swallow, { passive: false });
  canvas.addEventListener("touchmove", swallow, { passive: false });
  // And the right-click / long-press menu, which is a separate event and
  // survives all of the above.
  canvas.addEventListener("contextmenu", swallow);

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("resize", invalidateRect);
  window.addEventListener("orientationchange", invalidateRect);
  // Capture phase: a scroll inside any ancestor moves the canvas too, and
  // scroll events from a scrolling element do not bubble.
  window.addEventListener("scroll", invalidateRect, true);

  return function detach() {
    canvas.removeEventListener("touchstart", swallow);
    canvas.removeEventListener("touchmove", swallow);
    canvas.removeEventListener("contextmenu", swallow);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("resize", invalidateRect);
    window.removeEventListener("orientationchange", invalidateRect);
    window.removeEventListener("scroll", invalidateRect, true);
  };
}
