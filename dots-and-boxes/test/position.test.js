import { parsePosition, serializePosition } from "../src/game/position.js";
import { createGameState } from "../src/game/rules.js";
import { test, assertEqual, assertTrue, assertThrows } from "./harness.js";

test("parses dimensions and defaults every edge to undrawn", () => {
  const pos = parsePosition("3x3");
  assertEqual(pos.rows, 3);
  assertEqual(pos.cols, 3);
  assertEqual(pos.hEdges.length, 4); // rows+1
  assertEqual(pos.hEdges[0].length, 3); // cols
  assertEqual(pos.vEdges.length, 3); // rows
  assertEqual(pos.vEdges[0].length, 4); // cols+1
  assertTrue(pos.hEdges.every((row) => row.every((v) => v === false)), "all h edges undrawn");
  assertTrue(pos.vEdges.every((row) => row.every((v) => v === false)), "all v edges undrawn");
});

test("h/v indices land on the same (r,c) rules.js uses", () => {
  // hEdges shape for 3x3 is 4x3, row-major: index 0 -> (0,0), index 3 -> (1,0).
  const pos = parsePosition("3x3|h:0,3");
  assertTrue(pos.hEdges[0][0] === true, "index 0 -> hEdges[0][0]");
  assertTrue(pos.hEdges[1][0] === true, "index 3 -> hEdges[1][0]");

  // vEdges shape for 3x3 is 3x4, row-major: index 4 -> row 1, col 0.
  const pos2 = parsePosition("3x3|v:4");
  assertTrue(pos2.vEdges[1][0] === true, "index 4 -> vEdges[1][0]");
});

test("parsePosition's grid shape matches createGameState's exactly", () => {
  const state = createGameState(4, 5);
  const pos = parsePosition("4x5");
  assertEqual(pos.hEdges.length, state.hEdges.length);
  assertEqual(pos.hEdges[0].length, state.hEdges[0].length);
  assertEqual(pos.vEdges.length, state.vEdges.length);
  assertEqual(pos.vEdges[0].length, state.vEdges[0].length);
});

test("round-trips through serializePosition -> parsePosition", () => {
  const original = parsePosition("3x3|h:0,2,4|v:1,3,7");
  const reparsed = parsePosition(serializePosition(original));
  assertEqual(reparsed.rows, original.rows);
  assertEqual(reparsed.cols, original.cols);
  assertEqual(reparsed.hEdges, original.hEdges);
  assertEqual(reparsed.vEdges, original.vEdges);
});

test("round-trips a full board (every edge drawn)", () => {
  const state = createGameState(3, 3);
  for (const row of state.hEdges) row.fill(true);
  for (const row of state.vEdges) row.fill(true);
  const str = serializePosition(state);
  const reparsed = parsePosition(str);
  assertEqual(reparsed.hEdges, state.hEdges);
  assertEqual(reparsed.vEdges, state.vEdges);
});

test("serialize output is canonical: sorted, deduplicated order", () => {
  const pos = parsePosition("2x2|h:3,0|v:2");
  assertEqual(serializePosition(pos), "2x2|h:0,3|v:2");
});

test("serializing an all-undrawn position still emits empty h:/v: segments", () => {
  const pos = parsePosition("2x2");
  assertEqual(serializePosition(pos), "2x2|h:|v:");
});

test("serializePosition accepts a live rules.js game state directly", () => {
  const state = createGameState(2, 2);
  state.hEdges[0][0] = true;
  assertEqual(serializePosition(state), "2x2|h:0|v:");
});

test("h: and v: segments may appear in either order", () => {
  const a = parsePosition("2x2|h:0|v:1");
  const b = parsePosition("2x2|v:1|h:0");
  assertEqual(a.hEdges, b.hEdges);
  assertEqual(a.vEdges, b.vEdges);
});

// --- invalid input ---

test("rejects empty string", () => {
  assertThrows(() => parsePosition(""), /empty/);
});

test("rejects non-string input", () => {
  assertThrows(() => parsePosition(null), /empty or non-string/);
  assertThrows(() => parsePosition(undefined), /empty or non-string/);
  assertThrows(() => parsePosition(42), /empty or non-string/);
});

test("rejects a malformed dimension segment", () => {
  assertThrows(() => parsePosition("3x|h:0"), /dimension/);
  assertThrows(() => parsePosition("axb"), /dimension/);
  assertThrows(() => parsePosition("3-3"), /dimension/);
});

test("rejects zero or negative dimensions", () => {
  assertThrows(() => parsePosition("0x3"), />= 1/);
  assertThrows(() => parsePosition("3x0"), />= 1/);
});

test("rejects an unknown segment kind", () => {
  assertThrows(() => parsePosition("3x3|z:0"), /not "h:\.\.\." or "v:\.\.\."/);
});

test("rejects a repeated h/v segment", () => {
  assertThrows(() => parsePosition("3x3|h:0|h:1"), /more than once/);
  assertThrows(() => parsePosition("3x3|v:0|v:1"), /more than once/);
});

test("rejects a non-integer index", () => {
  assertThrows(() => parsePosition("3x3|h:0,abc"), /non-integer/);
  assertThrows(() => parsePosition("3x3|h:1.5"), /non-integer/);
  assertThrows(() => parsePosition("3x3|h:-1"), /non-integer/);
});

test("rejects an out-of-range index", () => {
  // 3x3 hEdges is 4x3 = 12 edges -> valid indices 0..11
  assertThrows(() => parsePosition("3x3|h:12"), /out of range/);
  assertThrows(() => parsePosition("3x3|v:100"), /out of range/);
});

test("rejects a repeated index within the same segment", () => {
  assertThrows(() => parsePosition("3x3|h:0,0"), /repeated/);
});

test("tolerates a trailing empty segment from a stray trailing |", () => {
  const pos = parsePosition("2x2|h:0|");
  assertTrue(pos.hEdges[0][0] === true);
});
