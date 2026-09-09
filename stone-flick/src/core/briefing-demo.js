// core/briefing-demo.js
// Plays one game/briefings.js demo scene on its own small canvas, on a
// loop, using the real physics and the real renderer.
//
// This is the whole reason the briefing screen is worth having: the
// player is not reading a description of a bumper, they are watching one
// work, drawn exactly as it will be drawn on the board they are about to
// play. Nothing here is simulated for show — createWorld/stepWorld and
// drawScene are the same functions the match runs on, at the same fixed
// substep, so a demo cannot drift from the game it is describing.
//
// DOM-touching, therefore deliberately NOT a unit-test target, in line
// with the rest of core/. What is testable — that each scene actually
// demonstrates its own caption — lives in test/briefings.test.js and runs
// against game/briefings.js directly, with no canvas involved.

import { createWorld, stepWorld, flick, isAtRest, SUB_DT } from "../game/physics.js";
import { boardLayout, shotToDrag } from "../game/layout.js";
import { fitCanvasToDisplaySize, drawScene, DEFAULT_THEME } from "../game/render.js";

/** Seconds the finished scene is held before it replays. Long enough to
 * read the final position as the RESULT rather than as a stutter, short
 * enough that a player who looked away for a second gets another go
 * without feeling they are waiting. */
const HOLD_SECONDS = 1.1;
/** Seconds spent fading a sunk or fallen stone out, matching the board's
 * own removal animation so the pit demo reads the same as the real thing. */
const FADE_SECONDS = 0.45;

export function createBriefingDemo(canvas) {
  let ctx = null;
  let layout = boardLayout(160, 160);
  let scene = null;
  let theme = DEFAULT_THEME;
  let world = null;
  let fading = [];
  let elapsed = 0;
  let holdFor = 0;
  /** Seconds still owed to the aim pose before the scene's shots fire.
   * Only the aim-line card uses it: that card is ABOUT the indicator, so
   * a demo that opened with the stone already moving would show
   * everything except the thing being explained. */
  let aimFor = 0;
  let phase = 0;
  let rafId = null;
  let lastTime = 0;
  /** Simulated time owed but not yet stepped — see frame(). */
  let carry = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const side = Math.max(120, Math.min(rect.width, rect.height) || rect.width);
    ctx = fitCanvasToDisplaySize(canvas, side, side);
    layout = boardLayout(side, side);
  }

  function reset() {
    world = createWorld({
      stones: scene.stones.map((s, i) => ({ id: i, ...s })),
      obstacles: scene.obstacles,
    });
    // The bumper budget is normally handed out by arena.js's shoot() ->
    // beginShot(). This module flicks stones directly (a scene can start
    // two of them at once, which beginShot has no shape for), so it owns
    // the same reset — without it every stone arrives with an undefined
    // budget and the bumper demo silently does nothing.
    for (const s of world.stones) s.bumperBoosts = 0;
    aimFor = scene.aim?.seconds ?? 0;
    if (aimFor <= 0) fire();
    fading = [];
    elapsed = 0;
    holdFor = 0;
  }

  function fire() {
    for (const shot of scene.shots) {
      const stone = world.stones[shot.stone];
      if (stone) flick(stone, shot.dx, shot.dy, shot.power);
    }
  }

  /** The aim indicator as drawScene wants it, reconstructed from the
   * scene's own shot so the pose and the shot cannot disagree. */
  function aimPose() {
    const shot = scene.shots[0];
    const stone = world?.stones[shot?.stone ?? 0];
    if (!stone) return null;
    const len = Math.hypot(shot.dx, shot.dy) || 1;
    const dirX = shot.dx / len;
    const dirY = shot.dy / len;
    // The drag that WOULD produce this power, so the pull-back band is
    // the length a player's own hand would have made. Through
    // game/layout.js's own inverse rather than a copy of the formula:
    // the mapping gained a floor and every hand-rolled copy of it started
    // drawing a band that did not match its label.
    const pull = shotToDrag(shot.power);
    return {
      stone,
      shot: { dirX, dirY, power: shot.power, dragLength: pull },
      pointerBoard: { x: stone.x - dirX * pull, y: stone.y - dirY * pull },
      cancelling: false,
      guide: true,
    };
  }

  function step(dt) {
    phase += dt;
    if (aimFor > 0) {
      aimFor -= dt;
      if (aimFor <= 0) fire();
      return;
    }
    for (const f of fading) f.progress += dt / FADE_SECONDS;
    fading = fading.filter((f) => f.progress < 1);

    if (holdFor > 0) {
      holdFor -= dt;
      if (holdFor <= 0) reset();
      return;
    }
    const events = stepWorld(world, dt);
    for (const e of events) {
      if (e.type !== "fellOff" && e.type !== "sank") continue;
      const stone = world.stones.find((s) => s.id === e.stone);
      if (stone) fading.push({ ...stone, progress: 0 });
    }
    elapsed += dt;
    // `seconds` is a CAP, not the loop length: every scene is measured to
    // come to rest well inside it (test/briefings.test.js asserts that),
    // and the cap exists only so a scene that somehow keeps moving — a
    // future physics change, a stone caught between two bumpers — cannot
    // leave the briefing spinning forever instead of playing.
    if (isAtRest(world) || elapsed >= scene.seconds) holdFor = HOLD_SECONDS;
  }

  function draw() {
    if (!ctx || !world) return;
    // drawScene wants a match; it reads exactly one field off it. Passing
    // the shape it needs beats inventing a second renderer that would
    // then have to be kept looking identical to this one by hand.
    drawScene(ctx, layout, { world }, { theme, fading, phase, aim: aimFor > 0 ? aimPose() : null });
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    // Same fixed-substep integration as the board, with the same carry.
    // Slicing the frame into SUB_DT chunks and stepping each one looked
    // equivalent and was not: the final chunk is shorter than a substep,
    // physics.js integrates nothing for it, and that fraction was thrown
    // away on every frame — the demo ran slow and unevenly for exactly
    // the reason the board did.
    carry += dt;
    const steps = Math.floor(carry / SUB_DT + 1e-9);
    carry -= steps * SUB_DT;
    for (let i = 0; i < steps; i++) step(SUB_DT);
    draw();
  }

  return {
    /** Start (or switch to) a scene. Safe to call while already running. */
    show(briefing, activeTheme = DEFAULT_THEME) {
      scene = briefing.demo;
      theme = activeTheme;
      resize();
      reset();
      phase = 0;
      draw();
      if (rafId === null) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    resize() {
      if (!scene) return;
      resize();
      draw();
    },
  };
}
