import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, assertTrue, readPage } from "./harness.js";
import * as L from "../src/game/layout.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { TABLE_LENGTH, TABLE_WIDTH, MAX_TIP_OFFSET } from "../src/game/physics.js";

/** Every viewport the game is expected to work at. 1160x610 is the
 * CrazyGames desktop frame — Daily Five had two layout bugs that only
 * reproduced at that short, wide shape, and it was not in any test list
 * until the retro found them. */
/**
 * Every shape the game is expected to work at.
 *
 * 1160x610 is the CrazyGames desktop frame — Daily Five had two layout
 * bugs that only reproduced at that short, wide shape and it was in
 * nobody's test list until the retro found them. The phones are the
 * common ones rather than one convenient one, because the reachability
 * result below is a function of the aspect ratio and a single phone
 * would only prove that phone.
 */
const VIEWPORTS = [
  [1280, 760],
  [1160, 610], // the portal's own desktop frame
  [1440, 900],
  [1024, 768],
  [390, 780],
  [375, 667], // the smallest phone we ship to
  [430, 932],
  [360, 800],
  [820, 1180],
  // A PHONE ON ITS SIDE, which this list did not have until the layout
  // shipped a desktop header onto one: the compaction was keyed on
  // width, and 844px wide is not a phone by that measure. Height is the
  // axis that is short here, and it is the axis the table is fitted on.
  [844, 390],
  [780, 360],
];

/**
 * How much of the window the chrome above the canvas takes, measured in
 * the browser rather than assumed.
 *
 * It matters to the reachability test in two opposite ways and getting it
 * wrong flatters the result both times: the TABLE is laid out inside the
 * canvas, which is this much shorter than the window, while the DRAG is
 * bounded by the window, which includes this band. A test that passes the
 * window size to tableLayout() is measuring a game that does not exist.
 */
const CHROME_H = 105;
/** Short screens compact the header — one text line instead of three —
 *  so the band above the canvas is measured separately there. Modelling
 *  every viewport at 105 would tell this suite the landscape phone has
 *  40px less table than it does. */
const CHROME_SHORT_H = 64;
const chromeFor = (h) => (h <= 500 ? CHROME_SHORT_H : CHROME_H);
const canvasOf = (w, h) => [w, Math.max(120, h - chromeFor(h))];

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("the table's long axis follows the screen's long axis", () => {
  assertTrue(!L.tableLayout(1200, 800).rotated, "wide screen: horizontal table");
  assertTrue(L.tableLayout(390, 780).rotated, "phone: vertical table");
});

test("the table fills what the dial and the stroke room leave, and no more", () => {
  for (const [w, h] of [[1200, 800], [390, 780], [820, 1180], [1440, 700]]) {
    const lay = L.tableLayout(w, h);
    const dial = L.dialMetrics(w, h);
    const m = L.playMargin(w, h);
    // Asymmetric: no margin on the side the control strip already
    // covers — and which side that is follows where the CONTROLS stand,
    // which is not the same question as which way the table is turned.
    const availW = w - (lay.side ? dial.reserve + m : 2 * m);
    const availH = h - (lay.side ? 2 * m : dial.reserve + m);
    const drawnAlong = (TABLE_LENGTH + 2 * L.RAIL) * lay.scale;
    const drawnAcross = (TABLE_WIDTH + 2 * L.RAIL) * lay.scale;
    const usedW = lay.rotated ? drawnAcross : drawnAlong;
    const usedH = lay.rotated ? drawnAlong : drawnAcross;
    assertTrue(usedW <= availW + 1e-6 && usedH <= availH + 1e-6, `${w}x${h}: overflows`);
    assertTrue(
      usedW > availW - 1e-6 || usedH > availH - 1e-6,
      `${w}x${h}: leaves a whole axis unused`
    );
  }
});

test("the spin dial never sits on the cloth", () => {
  // The bug this replaces: a floating dial parked on the bottom-right
  // corner of the table, i.e. on top of the balls in the hardest position
  // on the table.
  for (const [w, h] of [[1200, 800], [390, 780], [820, 1180], [1440, 700]]) {
    const lay = L.tableLayout(w, h);
    const dial = L.spinDialLayout(lay);
    const a = L.toPx(lay, 0, 0);
    const b = L.toPx(lay, TABLE_LENGTH, TABLE_WIDTH);
    const left = Math.min(a.x, b.x) - lay.railPx;
    const right = Math.max(a.x, b.x) + lay.railPx;
    const top = Math.min(a.y, b.y) - lay.railPx;
    const bottom = Math.max(a.y, b.y) + lay.railPx;
    const clear =
      dial.cx - dial.r * 1.16 > right ||
      dial.cx + dial.r * 1.16 < left ||
      dial.cy - dial.r * 1.16 > bottom ||
      dial.cy + dial.r * 1.16 < top;
    assertTrue(clear, `${w}x${h}: the dial overlaps the table`);
  }
});

test("px and table coordinates round-trip in both orientations", () => {
  for (const [w, h] of [[1200, 800], [390, 780]]) {
    const lay = L.tableLayout(w, h);
    for (const [x, y] of [[0, 0], [TABLE_LENGTH, TABLE_WIDTH], [1.1, 0.4]]) {
      const p = L.toPx(lay, x, y);
      const back = L.toTable(lay, p.x, p.y);
      assertTrue(close(back.x, x, 1e-9) && close(back.y, y, 1e-9), `round trip ${x},${y}`);
    }
  }
});

test("the head of the table is at the bottom of a portrait screen", () => {
  const lay = L.tableLayout(390, 780);
  assertTrue(L.toPx(lay, 0, 0.71).y > L.toPx(lay, TABLE_LENGTH, 0.71).y, "x=0 is lower");
});

test("directions rotate without translating", () => {
  const lay = L.tableLayout(390, 780);
  const d = L.dirToScreen(lay, 1, 0);
  assertTrue(close(d.x, 0) && close(d.y, -1), "along the table is up the screen");
  const back = L.dirToTable(lay, d.x, d.y);
  assertTrue(close(back.x, 1) && close(back.y, 0), "round trip");
});

test("the lane runs from nothing to full power, and no further", () => {
  const lay = L.tableLayout(1200, 800);
  const lane = L.controlsLayout(lay).lane;
  const at = (px, py) => L.powerForPull(L.laneToPower(lane, px, py));
  // Zero is the end nearest the table: the bottom of a vertical lane, the
  // left of a horizontal one. "Further from the balls" is "harder".
  const [zero, one] = lane.vertical
    ? [[lane.x + lane.w / 2, lane.y + lane.h], [lane.x + lane.w / 2, lane.y]]
    : [[lane.x, lane.y + lane.h / 2], [lane.x + lane.w, lane.y + lane.h / 2]];
  assertTrue(close(at(...zero), 0, 1e-9), "the near end is no power at all");
  assertTrue(close(at(...one), 1, 1e-9), "the far end is full power");
  // And past either end it stays there rather than extrapolating: a
  // finger that slides off the lane holds the last value it had.
  const over = lane.vertical
    ? [lane.x + lane.w / 2, lane.y - 200]
    : [lane.x + lane.w + 200, lane.y + lane.h / 2];
  assertTrue(close(at(...over), 1, 1e-9), "power is capped, not extrapolated");
  const under = lane.vertical
    ? [lane.x + lane.w / 2, lane.y + lane.h + 200]
    : [lane.x - 200, lane.y + lane.h / 2];
  assertTrue(close(at(...under), 0, 1e-9), "and floored");
});

test("turning the hand around the ball turns the cue by the same angle", () => {
  // One to one, and that is the whole claim. A hand on the butt that
  // swings thirty degrees around the white swings the cue thirty
  // degrees — no gain, no damping, nothing to learn.
  const cue = { x: 1.0, y: 0.6 };
  const a0 = L.angleAround(cue.x, cue.y, cue.x + 0.4, cue.y);
  const a1 = L.angleAround(cue.x, cue.y, cue.x + 0.4 * Math.cos(0.5), cue.y + 0.4 * Math.sin(0.5));
  assertTrue(close(L.wrapAngle(a1 - a0), 0.5, 1e-9), "half a radian of hand is half a radian of cue");
  // Distance changes nothing about the angle, which is what makes the
  // far end of the stick the fine end: the same PIXEL of travel is a
  // smaller fraction of a circle out there.
  const far = L.angleAround(cue.x, cue.y, cue.x + 0.9 * Math.cos(0.5), cue.y + 0.9 * Math.sin(0.5));
  assertTrue(close(L.wrapAngle(far - a1), 0, 1e-9), "only the direction is read");
  // And the wrap is a real wrap: crossing the back of the ball is a
  // small step, not a lap.
  assertTrue(close(L.wrapAngle(Math.PI + 0.1 - (-Math.PI + 0.02)), 0.08, 1e-9), "no lap at the seam");
});

test("the cue is the thing you can grab, and the cloth is not", () => {
  const lay = L.tableLayout(...canvasOf(1160, 610));
  const ball = { x: 1.2, y: 0.6 };
  const p = L.toPx(lay, ball.x, ball.y);
  // Aim up-table: the cue lies DOWN-table, behind the white.
  const angle = 0;
  const d = L.dirToScreen(lay, -1, 0);
  const on = (dist, off = 0) =>
    L.withinCue(lay, ball, angle, 0, p.x + d.x * dist - d.y * off, p.y + d.y * dist + d.x * off);
  const len = L.CUE_LENGTH_M * lay.scale;
  assertTrue(on(len * 0.5), "the middle of the stick is the stick");
  assertTrue(on(len * 0.95), "and so is the butt");
  assertTrue(!on(-len * 0.2), "the cloth in FRONT of the ball is not the stick");
  assertTrue(!on(len * 1.6), "and neither is the floor past the end of it");
  // A finger's width either side, because a cue is 8px wide on a phone
  // and a finger is not.
  assertTrue(on(len * 0.5, L.CUE_GRAB_HALF_PX * 0.8), "a near miss across the stick still holds it");
  assertTrue(!on(len * 0.5, L.CUE_GRAB_HALF_PX * 2.4), "a press a hand's width off does not");
  // The tip backs away from the ball as the power goes on, and the grab
  // region follows it out: what you can hold is what you can see.
  assertTrue(
    L.cueTipGap(lay, 1) > L.cueTipGap(lay, 0) * 4,
    "a loaded cue is drawn well back"
  );
  assertTrue(on(L.cueTipGap(lay, 0) + len * 0.99), "the whole drawn length is grabbable");
});

test("the spin dial reads follow at the top and draw at the bottom", () => {
  const lay = L.tableLayout(1200, 800);
  const dial = L.spinDialLayout(lay);
  const up = L.dialToTip(dial, dial.cx, dial.cy - dial.r * 0.5, MAX_TIP_OFFSET);
  const down = L.dialToTip(dial, dial.cx, dial.cy + dial.r * 0.5, MAX_TIP_OFFSET);
  assertTrue(up.vertical > 0, "top of the dial is follow");
  assertTrue(down.vertical < 0, "bottom is draw");
  assertTrue(L.dialToTip(dial, 10, 10, MAX_TIP_OFFSET) === null, "a far pointer is not the dial");
});

test("the spin dial cannot be dragged past the ball", () => {
  const lay = L.tableLayout(1200, 800);
  const dial = L.spinDialLayout(lay);
  const tip = L.dialToTip(dial, dial.cx + dial.r * 1.4, dial.cy, MAX_TIP_OFFSET);
  assertTrue(Math.hypot(tip.side, tip.vertical) <= MAX_TIP_OFFSET + 1e-9, "clamped to the rim");
});


// --- aiming: resolution and reach -------------------------------------

/**
 * Degrees the aim turns per pixel of pointer movement, at a given
 * distance from the cue ball.
 *
 * This is THE number the campaign lives or dies by — the tightest stage
 * forgives 2.5 degrees — and with an absolute aim it is pure geometry:
 * atan(1/r). There is no gain, no damping and no second factor, which is
 * the point of the rework.
 */
function degreesPerPixel(px) {
  return (Math.atan(1 / Math.max(1, px)) * 180) / Math.PI;
}

/** How long the power lane is along its own axis, in px. */
function laneLength(layout) {
  const lane = L.controlsLayout(layout).lane;
  return lane.vertical ? lane.h : lane.w;
}

/** Pixels of lane travel between two powers. This is the number the thumb
 * has to hit, and it is the one the old single-exponent curve was quietly
 * starving. */
function bandPixels(layout, lo, hi) {
  return (L.pullForPower(hi) - L.pullForPower(lo)) * laneLength(layout);
}

test("the aim is coarse near the ball and fine far from it", () => {
  // The trade the absolute aim makes, pinned at both ends. Close in it is
  // a fast control and a blunt one; out at arm's length it is finer than
  // any release could be, which is what pays for the tightest stages.
  // Nothing in between needs a mode: it is one continuous curve, and the
  // player walks it by moving their hand.
  assertTrue(degreesPerPixel(L.AIM_PIVOT_MIN_PX) > 3, "close in it should be quick");
  assertTrue(degreesPerPixel(60) < 1.1, "a thumb's width out it has to be usable");
  assertTrue(degreesPerPixel(300) < L.NUDGE_DEGREES * 1.5, "far out it should rival the nudge");
  // And under the pivot the direction is not read at all — one pixel
  // across the ball's centre is half a circle of aim.
  assertTrue(L.AIM_PIVOT_MIN_PX >= 8, "a smaller pivot is a line that flails");
  assertTrue(L.AIM_PIVOT_MIN_PX <= 24, "a larger one is a dead zone you can feel");
});

test("the power a stage actually needs is more than a thumb-width of lane", () => {
  // The regression this pins is the one players reported as "I cannot
  // control the power". Under pull ** 3.8 the entire 22-45% band was 20
  // pixels of travel on a 375px phone. A thumb contact patch is wider
  // than that, so the control was, in the literal sense, not operable.
  //
  // 40px is the floor: about two thumb-widths of resolution on the worst
  // screen. On the lane the two-segment curve delivers 58px in the
  // portal's desktop frame and 137 on the smallest phone we ship to,
  // where the lane runs the whole width of the screen.
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(...canvasOf(w, h));
    const px = bandPixels(lay, 0.22, 0.45);
    assertTrue(px >= 40, `${w}x${h}: only ${px.toFixed(0)}px of lane covers 22-45% power`);
  }
});

test("the power curve is a bijection and never runs backwards", () => {
  let last = -1;
  for (let i = 0; i <= 200; i++) {
    const pull = i / 200;
    const power = L.powerForPull(pull);
    assertTrue(power > last - 1e-12, `power fell back at pull ${pull}`);
    last = power;
    assertTrue(
      Math.abs(L.pullForPower(power) - pull) < 1e-6,
      `pullForPower did not invert at pull ${pull}`
    );
  }
  assertTrue(close(L.powerForPull(0), 0), "no pull, no power");
  assertTrue(close(L.powerForPull(1), 1), "a full pull is full power");
  assertTrue(close(L.powerForPull(1.4), 1), "power is capped, not extrapolated");
});

test("the bar's number is the bar's own position", () => {
  // The power curve is not linear in the travel, so there are two numbers
  // that could be printed on the lane and only one of them can match what
  // the fill shows. It has to be the position: a gauge that reads 60% while
  // it is visibly 85% full is telling the player one of its own parts is
  // lying, and the fill is the part they cannot argue with.
  //
  // Pinned here rather than left to the renderer because it is the kind of
  // thing that gets "fixed" back the other way by someone who thinks the
  // label should say the speed.
  const render = readFileSync(path.join(root, "src/game/render.js"), "utf8");
  const label = /const label = `\$\{Math\.round\((\w+) \* 100\)\}%`;/.exec(render);
  assertTrue(label !== null, "the lane must print a percentage");
  assertTrue(
    label[1] === "t",
    `the lane prints ${label && label[1]}; t is the travel the fill is drawn from`
  );
  // And the two really do disagree, so the test is not guarding a tautology.
  const at = L.powerForPull(0.85);
  assertTrue(Math.abs(at - 0.85) > 0.15, "if these matched, none of this would matter");
});

test("backing the lane off is a way out of a shot", () => {
  // What the cancel ring used to be for, done by the control that loaded
  // the shot in the first place. Sliding the power back to nothing
  // unloads it: the cue goes home and the tap that would have played it
  // does nothing. It costs no aim, and unlike a ring it does not have to
  // be hit.
  assertTrue(L.LANE_MIN_POWER > 0, "there has to be a dead zone or there is no way out");
  // And it must not eat the shots the game is made of — softly is how
  // four-ball is played. LANE_MIN_POWER is a POWER, so it converts to a
  // speed directly and to pixels through pullForPower; this test used to
  // read it as a fraction of travel in both places, which flattered the
  // dead zone by a factor of three and is part of why a 5% pull was
  // being swallowed with the suite green.
  const swallowed = L.MIN_SHOT_SPEED + L.LANE_MIN_POWER * (6 - L.MIN_SHOT_SPEED);
  assertTrue(swallowed < 0.6, `the dead zone swallows up to ${swallowed.toFixed(2)} m/s`);
  // In pixels it is a deliberate movement rather than a slip: a thumb
  // resting at the bottom of the lane must not unload a shot by drifting.
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(...canvasOf(w, h));
    const len = laneLength(lay);
    const px = L.pullForPower(L.LANE_MIN_POWER) * len;
    assertTrue(px >= 3.5, `${w}x${h}: a ${px.toFixed(1)}px dead zone is a slip, not a choice`);
    assertTrue(px <= 0.09 * len, `${w}x${h}: a ${px.toFixed(0)}px dead zone is lost travel`);
  }
});

test("the power lane is the same control on every screen", () => {
  // The lane is a fader, and a fader is a movement the hand learns. If it
  // is 300px on one screen and 90 on another, it is two different
  // controls wearing the same paint — a stroke that was "halfway up"
  // yesterday is somewhere else today.
  //
  // Portrait and landscape are measured apart, because they genuinely
  // are two shapes: the lane runs the width of a phone and stands in the
  // column beside a desktop table. What has to hold is that neither one
  // is too short to operate.
  const lengths = VIEWPORTS.map((v) => {
    const lay = L.tableLayout(...canvasOf(...v));
    return [lay.rotated, laneLength(lay)];
  });
  for (const [rotated, px] of lengths) {
    assertTrue(px >= 120, `a ${px.toFixed(0)}px lane is a switch, not a fader`);
    if (!rotated) assertTrue(px <= 260, `a ${px.toFixed(0)}px column lane is taller than the table`);
  }
  const wide = lengths.filter(([r]) => !r).map(([, px]) => px);
  assertTrue(Math.max(...wide) / Math.min(...wide) < 1.6, "landscape lanes should be one control");
});

test("the nudge is finer than any stage's window", () => {
  assertTrue(L.NUDGE_DEGREES <= 0.25, "a step has to fit inside a 2.5 degree window");
  assertTrue(L.NUDGE_DEGREES > 0.05, "smaller than this is a chore, not a control");
});

test("there is always a piece of cue to take hold of", () => {
  // THE MODEL IS THE TEST, and this is the one the grab target has to
  // answer for. The stick is drawn BEHIND the ball, so a ball hard
  // against a rail has its cue hanging off the table — and if the whole
  // graspable length is off the canvas, or buried under the dial, that
  // position cannot be aimed at all.
  //
  // The turn is relative, so unlike an absolute aim there is no
  // direction the geometry can refuse outright: what has to hold is
  // simply that SOME part of the stick is reachable, in every direction,
  // from everywhere a ball can sit.
  const EDGE = 6;
  for (const [w, h] of VIEWPORTS) {
    const [cw, ch] = canvasOf(w, h);
    const lay = L.tableLayout(cw, ch);
    const len = L.CUE_LENGTH_M * lay.scale;
    let bad = 0;
    let total = 0;
    for (let bx = 0.15; bx < TABLE_LENGTH; bx += 0.3) {
      for (let by = 0.15; by < TABLE_WIDTH; by += 0.25) {
        const b = L.toPx(lay, bx, by);
        for (let a = 0; a < 24; a++) {
          const th = (a * Math.PI) / 12;
          const d = L.dirToScreen(lay, -Math.cos(th), -Math.sin(th));
          total++;
          let ok = false;
          for (let s = lay.ballPx * 1.2; s <= len && !ok; s += 8) {
            const px = b.x + d.x * s;
            const py = b.y + d.y * s;
            if (px < EDGE || px > cw - EDGE || py < EDGE || py > ch - EDGE) continue;
            // The dial and the arrows outrank the cue (see main.js), so
            // a length of stick under them is not a length you can hold.
            const on = L.controlAt(lay, px, py);
            if (on === "dial" || on === "left" || on === "right") continue;
            ok = true;
          }
          if (!ok) bad++;
        }
      }
    }
    const pct = (100 * bad) / total;
    assertTrue(pct === 0, `${w}x${h}: ${bad}/${total} (${pct.toFixed(1)}%) aims have no cue to hold`);
  }
});

test("the table never runs to the window edge", () => {
  // The margin is what the stroke happens in. It is measured rather than
  // eyeballed because it is the difference between a control that works
  // near a rail and one that does not.
  for (const [w, h] of VIEWPORTS) {
    const [cw, ch] = canvasOf(w, h);
    const lay = L.tableLayout(cw, ch);
    const m = L.playMargin(cw, ch);
    const a = L.toPx(lay, 0, 0);
    const b = L.toPx(lay, TABLE_LENGTH, TABLE_WIDTH);
    const left = Math.min(a.x, b.x) - lay.railPx;
    const top = Math.min(a.y, b.y) - lay.railPx;
    const right = cw - (Math.max(a.x, b.x) + lay.railPx);
    const bottom = ch - (Math.max(a.y, b.y) + lay.railPx);
    // Three sides get the margin. The fourth is the control strip, which
    // is drag surface already — see tableLayout().
    const sides = [left, top, right, bottom].filter((v) => v >= m - 0.5).length;
    assertTrue(sides >= 3, `${w}x${h}: only ${sides} sides clear a ${m.toFixed(0)}px margin`);
  }
});
test("the controls never overlap each other or the table", () => {
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(w, h);
    const c = L.controlsLayout(lay);
    const boxes = [
      { cx: c.dial.cx, cy: c.dial.cy, w: c.dial.r * 2.32, h: c.dial.r * 2.32, id: "dial" },
      { ...c.left, id: "left" },
      { ...c.right, id: "right" },
      {
        cx: c.lane.x + c.lane.w / 2,
        cy: c.lane.y + c.lane.h / 2,
        w: c.lane.w,
        h: c.lane.h,
        id: "lane",
      },
    ];
    for (const b of boxes) {
      assertTrue(
        b.cx - b.w / 2 >= -1 && b.cx + b.w / 2 <= w + 1 && b.cy - b.h / 2 >= -1 && b.cy + b.h / 2 <= h + 1,
        `${w}x${h}: ${b.id} is off-canvas`
      );
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;
        assertTrue(!overlap, `${w}x${h}: ${a.id} overlaps ${b.id}`);
      }
    }
    // And none of them may sit on the cloth.
    const p0 = L.toPx(lay, 0, 0);
    const p1 = L.toPx(lay, TABLE_LENGTH, TABLE_WIDTH);
    const t = {
      l: Math.min(p0.x, p1.x) - lay.railPx,
      r: Math.max(p0.x, p1.x) + lay.railPx,
      t: Math.min(p0.y, p1.y) - lay.railPx,
      b: Math.max(p0.y, p1.y) + lay.railPx,
    };
    for (const b of boxes) {
      const clear =
        b.cx - b.w / 2 > t.r || b.cx + b.w / 2 < t.l || b.cy - b.h / 2 > t.b || b.cy + b.h / 2 < t.t;
      assertTrue(clear, `${w}x${h}: ${b.id} sits on the table`);
    }
  }
});

test("every control is hit-testable at its own centre", () => {
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(w, h);
    const c = L.controlsLayout(lay);
    assertTrue(L.controlAt(lay, c.dial.cx, c.dial.cy) === "dial", `${w}x${h} dial`);
    assertTrue(L.controlAt(lay, c.left.cx, c.left.cy) === "left", `${w}x${h} left`);
    assertTrue(L.controlAt(lay, c.right.cx, c.right.cy) === "right", `${w}x${h} right`);
    const lm = { x: c.lane.x + c.lane.w / 2, y: c.lane.y + c.lane.h / 2 };
    assertTrue(L.controlAt(lay, lm.x, lm.y) === "lane", `${w}x${h} lane`);
    // Both ends of it too: a fader you cannot reach the ends of has no
    // full power and no way out of a shot.
    const ends = c.lane.vertical
      ? [[lm.x, c.lane.y + 2], [lm.x, c.lane.y + c.lane.h - 2]]
      : [[c.lane.x + 2, lm.y], [c.lane.x + c.lane.w - 2, lm.y]];
    for (const [ex, ey] of ends) {
      assertTrue(L.controlAt(lay, ex, ey) === "lane", `${w}x${h} lane end`);
    }
    // The middle of the table is not a control - that is where aiming happens.
    const mid = L.toPx(lay, TABLE_LENGTH / 2, TABLE_WIDTH / 2);
    assertTrue(L.controlAt(lay, mid.x, mid.y) === null, `${w}x${h} centre of table`);
  }
});

test("the grab target is a finger's size, not a cue's", () => {
  // A cue is about 8px across on the smallest phone and a fingertip is
  // about 44. If the target were the drawing, the control would refuse
  // most of the presses meant for it — so the target is the finger's
  // size and the drawing is the smaller, prettier thing inside it.
  assertTrue(2 * L.CUE_GRAB_HALF_PX >= 44, "smaller than a fingertip");
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(...canvasOf(w, h));
    assertTrue(
      L.cueGrabHalf(lay) > lay.ballPx,
      `${w}x${h}: the target should be wider than the ball it sits behind`
    );
    // An upper bound too, and it is not about crowding — nothing else on
    // the cloth is a target, so a wide band costs nothing there. It is
    // about the LANE, which the cue outranks: every pixel of width is a
    // pixel of fader the stick can cover when it happens to lie across
    // it. A thumb is about 25mm; past that the band is buying reach
    // nobody needed with travel somebody did.
    // The old bound here was 70 and the reason given was the LANE: every
    // pixel of cue band is a pixel of fader the stick can cover. That
    // reason was wrong — controlAt() tests the dial, the arrows and the
    // lane before it ever asks about the cue, so a wider band cannot
    // take a press from any of them. What the bound really guards is the
    // cloth: a band wide enough to swallow a tap meant for the table.
    const across = 2 * L.cueGrabHalf(lay);
    assertTrue(across <= 80, `${w}x${h}: a ${across.toFixed(0)}px band swallows taps meant for the cloth`);
  }
});

test("everything main.js hides has a CSS rule that can hide it", () => {
  // The UA sheet's [hidden] { display: none } is the weakest rule in the
  // cascade: any author rule that sets display on the same element wins,
  // and el.x.hidden = true then does nothing visible. The practice setup
  // screen shipped the opponent picker that way. This is the whole class,
  // not that one element, because the failure is silent in the DOM —
  // .hidden reads true while the thing is on screen.
  const html = readPage(root);
  const css = html.slice(html.indexOf("<style"), html.lastIndexOf("</style>"));
  const src = readFileSync(path.join(root, "src", "main.js"), "utf8");

  // id -> classes, from the markup.
  const classOf = new Map();
  for (const tag of html.match(/<[a-z][^>]*\bid="[^"]+"[^>]*>/g) || []) {
    const id = tag.match(/\bid="([^"]+)"/)[1];
    const cls = tag.match(/\bclass="([^"]+)"/);
    classOf.set(id, cls ? cls[1].trim().split(/\s+/) : []);
  }

  // Which ids main.js toggles: el.foo.hidden = ... , via the el map.
  const elMap = src.slice(src.indexOf("const el = {"), src.indexOf("};", src.indexOf("const el = {")));
  const idOf = new Map();
  for (const m of elMap.matchAll(/(\w+):\s*document\.getElementById\("([^"]+)"\)/g)) {
    idOf.set(m[1], m[2]);
  }
  const toggled = new Set();
  for (const m of src.matchAll(/\bel\.(\w+)\.hidden\s*=/g)) {
    if (idOf.has(m[1])) toggled.add(idOf.get(m[1]));
  }
  assertTrue(toggled.size > 5, "found no hidden toggles — the scan is broken");

  for (const id of toggled) {
    const selectors = ["#" + id, ...(classOf.get(id) || []).map((c) => "." + c)];
    // Does any author rule set display for this element?
    const sets = selectors.some((sel) => {
      const re = new RegExp(escapeRe(sel) + "(?![\\w-])[^{}]*\\{[^{}]*display\\s*:", "g");
      for (const m of css.matchAll(re)) {
        if (!/\[hidden\]/.test(m[0])) return true;
      }
      return false;
    });
    if (!sets) continue; // the UA rule is unopposed; nothing to guard
    const guarded = selectors.some(
      (sel) =>
        new RegExp(escapeRe(sel) + "\\[hidden\\][^{}]*\\{[^{}]*display\\s*:\\s*none", "g").test(css) ||
        new RegExp(escapeRe(sel) + ":not\\(\\[hidden\\]\\)", "g").test(css)
    );
    assertTrue(guarded, `#${id} has a display rule that outranks [hidden] and no guard for it`);
  }
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("on a phone the header escapes the table's padding", () => {
  // The header is padded to the TABLE's edges, which on a phone leaves
  // the title row a box narrower than the words in it. It has now been
  // found twice: "Stage 1" as "Stag." at 375x667, and "Play with AI" as
  // "Play with..." at 390x844 once the clock and Preview shared the row.
  // The first fix was gated on height, so the second phone was not
  // covered. This pins the escape as unconditional below 520px, which is
  // the only width where the padding is worth less than the words.
  const html = readPage(root);
  const at = html.indexOf("@media (max-width: 520px)", html.indexOf("<style"));
  assertTrue(at > 0, "the phone block is gone — this test is looking at nothing");
  const block = html.slice(at, at + 4000);
  const pad = block.indexOf("padding-left: 14px");
  assertTrue(pad > 0, "the phone header no longer escapes the table padding");
  assertTrue(
    !block.slice(0, pad).includes("@media (max-height"),
    "the escape is gated on height again — tall phones clip the title"
  );
  // And above the phone breakpoint the same padding is floored rather
  // than switched off: a portrait tablet's table is narrow enough that
  // aligning to it left a 360px box for a 370px row, which clipped the
  // title at 768x1024 with the phone rule not applying.
  const header = html.slice(html.indexOf("      header {"), html.indexOf("#stage-name { grid-area"));
  assertTrue(
    /padding-left:\s*min\(/.test(header) && /100vw - \d+px/.test(header),
    "the header padding is no longer floored — a narrow table can starve the title row"
  );
});

test("the soft end of the power bar is reachable", () => {
  // A four-ball table is played soft more often than hard, and the bar
  // prints a percentage — so every percentage it can print has to be
  // playable. Two thresholds decide that and they are both measured in
  // pixels of thumb travel: the pull, below which a release parks the
  // power instead of playing it, and the cancel, below which a release
  // is a change of mind. A soft shot has to clear both by a real margin
  // on the SHORTEST lane we ship, which is the landscape phone's.
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(...canvasOf(w, h));
    const lane = L.controlsLayout(lay).lane;
    const t = L.laneTravel(lane);
    const span = Math.abs(t.to - t.from);
    const pxFor = (power) => L.pullForPower(power) * span;
    // The softest shot the bar will play, and the softest it prints.
    assertTrue(
      pxFor(L.LANE_MIN_POWER) < pxFor(0.05),
      `${w}x${h}: 5% is below the cancel — a printed power that cannot be played`
    );
    assertTrue(
      pxFor(0.05) >= L.LANE_PULL_PX,
      `${w}x${h}: a pull to 5% travels ${pxFor(0.05).toFixed(1)}px, under the ${L.LANE_PULL_PX}px pull`
    );
    // And the cancel still has to be reachable: sliding to the end stop
    // must not need pixel-perfect placement.
    assertTrue(
      pxFor(L.LANE_MIN_POWER) >= 3,
      `${w}x${h}: the cancel zone is ${pxFor(L.LANE_MIN_POWER).toFixed(1)}px — too fine to hit`
    );
  }
});

test("no control starts inside a system swipe", () => {
  // iOS answers a drag that starts within about 20pt of the bottom (home
  // gesture) or of either side (Safari's back/forward) before the page
  // ever sees it. The portrait lane ran the full width along the bottom
  // edge — three of those strips at once — and pulling the bar threw the
  // player out of the game. No page can prevent those gestures; the only
  // fix is geometry, which is why this is pinned here.
  //
  // The TARGET is what matters, not the drawing: withinLane() is what
  // decides whether a press is the lane, so the check is on the hit box.
  for (const [w, h] of VIEWPORTS) {
    const lay = L.tableLayout(...canvasOf(w, h));
    const lane = L.controlsLayout(lay).lane;
    // Corners of the hit box, found by probing rather than by repeating
    // withinLane's own arithmetic.
    let minX = lane.x, maxX = lane.x + lane.w, maxY = lane.y + lane.h;
    for (let d = 0; d <= 60; d++) {
      if (L.withinLane(lane, lane.x - d, lane.y + lane.h / 2)) minX = lane.x - d;
      if (L.withinLane(lane, lane.x + lane.w + d, lane.y + lane.h / 2)) maxX = lane.x + lane.w + d;
      if (L.withinLane(lane, lane.x + lane.w / 2, lane.y + lane.h + d)) maxY = lane.y + lane.h + d;
    }
    const g = L.EDGE_GUARD_PX;
    // The dial is a drag as well, and in portrait it is the lowest thing
    // on the screen — so it needs the same clearance the lane does. 1.35
    // is the radius controlAt() answers to, not the drawn one.
    const c = L.controlsLayout(lay);
    assertTrue(
      lay.height - (c.dial.cy + c.dial.r * 1.35) >= g - 0.5,
      `${w}x${h}: the spin dial is grabbable ${(lay.height - (c.dial.cy + c.dial.r * 1.35)).toFixed(0)}px from the bottom`
    );
    // And the right edge, which is the forward swipe. In landscape the
    // dial ends the column there, and its target reached past the window.
    assertTrue(
      lay.width - (c.dial.cx + c.dial.r * 1.35) >= g - 0.5,
      `${w}x${h}: the spin dial is grabbable ${(lay.width - (c.dial.cx + c.dial.r * 1.35)).toFixed(0)}px from the right edge`
    );
    assertTrue(minX >= g - 0.5, `${w}x${h}: the lane is grabbable ${minX.toFixed(0)}px from the left edge`);
    assertTrue(
      lay.width - maxX >= g - 0.5,
      `${w}x${h}: the lane is grabbable ${(lay.width - maxX).toFixed(0)}px from the right edge`
    );
    assertTrue(
      lay.height - maxY >= 6,
      `${w}x${h}: the lane is grabbable ${(lay.height - maxY).toFixed(0)}px from the bottom edge`
    );
  }
});

test("a long press on the table cannot summon iOS's magnifier", () => {
  // The cue is HELD, not tapped, so every careful aim on an iPhone is a
  // long press — and a long press is what raises the selection loupe.
  // -webkit-touch-callout is the only property that suppresses it, and it
  // is the one that was missing while user-select and tap-highlight were
  // both already set, which is why the page looked like it had been
  // handled.
  const html = readPage(root);
  const css = html.slice(html.indexOf("<style"), html.lastIndexOf("</style>"));
  const rule = (sel) => {
    const at = css.indexOf(sel);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };
  assertTrue(
    /-webkit-touch-callout:\s*none/.test(rule("html,")) ||
      /-webkit-touch-callout:\s*none/.test(rule("body")),
    "the page still allows the long-press callout"
  );
  assertTrue(
    /-webkit-touch-callout:\s*none/.test(rule("canvas {")),
    "the canvas itself still allows it — inheritance has not been reliable here"
  );
  const input = readFileSync(path.join(root, "src", "core", "input.js"), "utf8");
  assertTrue(
    input.includes("webkitTouchCallout"),
    "input.js sets touchAction in code but not the callout; a stylesheet the host overrides would bring it back"
  );
});

test("in portrait the bar is above the dial", () => {
  // Asked for directly, and it is also the safer order: the bar is the
  // control with the longest drag, so it belongs furthest from the edges
  // the phone watches. It matches landscape too, where the lane has
  // always stood above the arrows.
  for (const [w, h] of VIEWPORTS.filter(([vw, vh]) => vh > vw)) {
    const lay = L.tableLayout(...canvasOf(w, h));
    // A portrait TABLET stands its controls in a column instead — the
    // table cannot use that width, so the band would be spending height
    // it does not have to spend. See sideControls().
    if (lay.side) continue;
    const c = L.controlsLayout(lay);
    assertTrue(!c.lane.vertical, `${w}x${h}: portrait should lay the lane across`);
    assertTrue(
      c.lane.y + c.lane.h <= c.dial.cy - c.dial.r,
      `${w}x${h}: the lane still sits below the dial`
    );
    assertTrue(
      c.lane.y + c.lane.h <= c.left.cy - c.left.h / 2,
      `${w}x${h}: the lane still sits below the aim buttons`
    );
  }
});
