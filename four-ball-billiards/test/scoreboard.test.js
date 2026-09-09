// test/scoreboard.test.js
// The rack, checked without a browser.
//
// Node has no DOM, and the alternative to the stub below is what this
// module had before: three trips through a headless browser, each one
// finding a rack that was right in the last shape and wrong in this one.
// The stub implements only what scoreboard.js touches, so it cannot drift
// far — anything else the module starts using throws here immediately.
import { test, assertEqual, assertTrue } from "./harness.js";

function stubDom() {
  const make = (tag) => {
    const el = {
      tag,
      children: [],
      attrs: {},
      dataset: {},
      textContent: "",
      _classes: new Set(),
      get className() {
        return [...el._classes].join(" ");
      },
      set className(v) {
        el._classes = new Set(String(v).split(/\s+/).filter(Boolean));
      },
      classList: {
        toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
        contains: (c) => el._classes.has(c),
      },
      append: (...kids) => el.children.push(...kids),
      appendChild: (kid) => el.children.push(kid),
      replaceChildren: (...kids) => (el.children = kids),
      setAttribute: (k, v) => (el.attrs[k] = v),
      remove: () => {},
    };
    return el;
  };
  globalThis.document = { createElement: make };
  return make("div");
}

const host = stubDom();
const SB = await import("../src/game/scoreboard.js");

/** [beads waiting, beads pushed across, the printed count]. */
function read(row) {
  const track = row.children[0];
  const [left, right] = track.children.filter((c) => c.className.includes("scoreboard-side"));
  return [left.children.length, right.children.length, row.children[1].textContent];
}

test("the rack starts full and empties to the right", () => {
  const row = SB.createRow(host, { target: 10, label: "You" });
  assertEqual(read(row.row), [10, 0, "10"], "a fresh rack");
  SB.setRemaining(row, 7);
  assertEqual(read(row.row), [7, 3, "7"], "three made");
  SB.setRemaining(row, 0);
  assertEqual(read(row.row), [0, 10, "0"], "cleared");
});

test("a foul cannot make the rack bigger than it started", () => {
  // The rule this pins is a design decision, not an implementation
  // detail: an unbounded rack means a bad run leaves the player further
  // from the target than when they began, and a target that recedes
  // while you play is not a target.
  const row = SB.createRow(host, { target: 15 });
  SB.setRemaining(row, 18);
  assertEqual(read(row.row), [15, 0, "15"], "clamped to the handicap");
  SB.setRemaining(row, -3);
  assertEqual(read(row.row), [0, 15, "0"], "and an over-cleared rack is simply empty");
  assertTrue(row.beads.length === 15, "no spare beads were ever made");
});

test("the beads are banded in tens", () => {
  // 15 beads read as "a band of ten and five", which is a glance. Fifteen
  // identical beads is arithmetic, and the player is meant to be looking
  // at the table.
  const row = SB.createRow(host, { target: 25 });
  const band = row.beads.map((b) => (b.classList.contains("ten") ? 1 : 0));
  assertEqual(band.slice(0, 10), Array(10).fill(0), "the first ten are bone");
  assertEqual(band.slice(10, 20), Array(10).fill(1), "the second ten are brass");
  assertEqual(band.slice(20), Array(5).fill(0), "and it alternates again");
});
