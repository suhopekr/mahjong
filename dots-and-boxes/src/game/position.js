// game/position.js
// Text <-> board-state (de)serializer, built for test fixtures: setting
// up a chain, a loop, or a double-cross scenario by hand instead of
// clicking through 20 moves before every AI unit test.
//
// Format: "{rows}x{cols}|h:{i,i,...}|v:{i,i,...}"
//   - rows, cols: box-grid dimensions, same meaning as createGameState().
//   - h: flat indices of DRAWN horizontal edges, row-major over hEdges.
//   - v: flat indices of DRAWN vertical edges, row-major over vEdges.
//   Both h: and v: segments are optional (absent = no edges of that
//   type drawn) and may appear in either order after the dimension
//   segment, which must come first. Example: "3x3|h:0,2,4|v:1,3,7"
//
// The flat index is `r * width + c` where `width` is read off the
// actual array shape at parse/serialize time — it is NOT a hardcoded
// "rows+1 / cols+1" formula duplicated from rules.js. hEdges/vEdges
// themselves come from createGameState(), the same constructor every
// real game state uses. There is exactly one place edge-grid shape is
// decided (rules.js), and this file only ever reads that shape back —
// it cannot drift out of sync with it.
//
// Deliberately out of scope: box ownership, score, current player, move
// history. The string format only carries which edges are drawn. A box
// that happens to be complete in a loaded position stays unowned
// (boxes[r][c] === null) — that's safe forever, because a fully-drawn
// box has no undrawn edges left, so applyMove() can never touch it
// again to reconsider ownership. If a test needs a specific box already
// owned, set state.boxes[r][c] explicitly after loading.

import { createGameState } from "./rules.js";

const FORMAT_HINT = 'expected "{rows}x{cols}|h:i,i,...|v:i,i,..." e.g. "3x3|h:0,2,4|v:1,3,7"';

/**
 * Parse a position string into { rows, cols, hEdges, vEdges }.
 * Throws a descriptive Error on any malformed input — this is a test
 * fixture format, so a silent partial parse would just relocate a typo
 * from "loud failure now" to "confusing test failure later."
 *
 * @param {string} input
 * @returns {{rows:number, cols:number, hEdges:boolean[][], vEdges:boolean[][]}}
 */
export function parsePosition(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(`parsePosition: empty or non-string input. ${FORMAT_HINT}`);
  }

  const segments = input.split("|").map((s) => s.trim());
  const [dimSegment, ...rest] = segments;

  const dimMatch = /^(\d+)x(\d+)$/.exec(dimSegment);
  if (!dimMatch) {
    throw new Error(
      `parsePosition: first segment "${dimSegment}" is not a valid "ROWSxCOLS" dimension. ${FORMAT_HINT}`
    );
  }
  const rows = Number(dimMatch[1]);
  const cols = Number(dimMatch[2]);
  if (rows < 1 || cols < 1) {
    throw new Error(`parsePosition: rows and cols must be >= 1, got ${rows}x${cols}.`);
  }

  // Same constructor every real game uses — this is what guarantees the
  // shape here can never disagree with rules.js.
  const { hEdges, vEdges } = createGameState(rows, cols);

  const seenKinds = new Set();
  for (const segment of rest) {
    if (segment === "") continue; // tolerate a trailing "|" but nothing sloppier
    const kindMatch = /^([hv]):(.*)$/.exec(segment);
    if (!kindMatch) {
      throw new Error(`parsePosition: segment "${segment}" is not "h:..." or "v:...". ${FORMAT_HINT}`);
    }
    const [, kind, listStr] = kindMatch;
    if (seenKinds.has(kind)) {
      throw new Error(`parsePosition: "${kind}:" segment appears more than once.`);
    }
    seenKinds.add(kind);

    applyIndexList(kind === "h" ? hEdges : vEdges, kind, listStr, segment);
  }

  return { rows, cols, hEdges, vEdges };
}

function applyIndexList(grid, kind, listStr, segment) {
  if (listStr === "") return; // "h:" with nothing after = no edges of that type

  const width = grid[0].length;
  const count = grid.length * width;
  const seenIndices = new Set();

  for (const token of listStr.split(",")) {
    const trimmed = token.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`parsePosition: "${kind}:" contains non-integer index "${token}" (from "${segment}").`);
    }
    const idx = Number(trimmed);
    if (idx >= count) {
      throw new Error(
        `parsePosition: "${kind}:" index ${idx} out of range — valid range is 0..${count - 1}.`
      );
    }
    if (seenIndices.has(idx)) {
      throw new Error(`parsePosition: "${kind}:" index ${idx} repeated.`);
    }
    seenIndices.add(idx);

    const r = Math.floor(idx / width);
    const c = idx % width;
    grid[r][c] = true;
  }
}

/**
 * Inverse of parsePosition(): produces the canonical string for a
 * position. Canonical = ascending, deduplicated indices, both h: and v:
 * segments always present (even when empty) so output is unambiguous
 * and diff-friendly in test fixtures.
 *
 * Accepts either a parsePosition() result or a full rules.js game-state
 * object (createGameState() / mid-game state) — only rows/cols/hEdges/
 * vEdges are read, everything else (score, boxes, turn...) is ignored.
 *
 * @param {{rows:number, cols:number, hEdges:boolean[][], vEdges:boolean[][]}} position
 * @returns {string}
 */
export function serializePosition({ rows, cols, hEdges, vEdges }) {
  return `${rows}x${cols}|h:${flatDrawnIndices(hEdges).join(",")}|v:${flatDrawnIndices(vEdges).join(",")}`;
}

function flatDrawnIndices(grid) {
  const width = grid[0].length;
  const indices = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c]) indices.push(r * width + c);
    }
  }
  return indices; // r ascending, then c ascending within each row -> already sorted
}
