// core/grid.js
// Generic dot-grid geometry + rendering utilities.
// Game-agnostic: reused as-is by the next game in the series (Gomoku),
// which also renders a rows x cols grid of dots. Nothing here knows about
// edges, boxes, or turns.

/**
 * Compute pixel layout for a rows x cols grid of dots, centered and
 * scaled to fit inside (width, height) with the given padding.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {number} width - canvas CSS width in px
 * @param {number} height - canvas CSS height in px
 * @param {number} padding - min space (px) between grid and canvas edge
 * @returns {{rows:number, cols:number, cellSize:number, originX:number,
 *            originY:number, dotRadius:number, width:number, height:number}}
 */
export function computeLayout(rows, cols, width, height, padding = 40) {
  const availWidth = Math.max(width - padding * 2, 1);
  const availHeight = Math.max(height - padding * 2, 1);
  const cellSize = Math.min(availWidth / cols, availHeight / rows);

  const gridWidth = cellSize * cols;
  const gridHeight = cellSize * rows;
  const originX = (width - gridWidth) / 2;
  const originY = (height - gridHeight) / 2;
  const dotRadius = Math.min(Math.max(cellSize * 0.08, 3), 8);

  return { rows, cols, cellSize, originX, originY, dotRadius, width, height };
}

/**
 * Pixel position of the dot at grid coordinate (row, col).
 */
export function dotPosition(layout, row, col) {
  return {
    x: layout.originX + col * layout.cellSize,
    y: layout.originY + row * layout.cellSize,
  };
}

/**
 * Draw every dot in the grid.
 */
export function drawDots(ctx, layout, color = "#333") {
  ctx.save();
  ctx.fillStyle = color;
  for (let r = 0; r <= layout.rows; r++) {
    for (let c = 0; c <= layout.cols; c++) {
      const { x, y } = dotPosition(layout, r, c);
      ctx.beginPath();
      ctx.arc(x, y, layout.dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Convert a CSS-pixel canvas-local point to the nearest (row, col) dot,
 * along with the distance to it. Useful as a building block for
 * game-specific hit testing (edges here, intersections in Gomoku).
 */
export function nearestDot(layout, x, y) {
  const colF = (x - layout.originX) / layout.cellSize;
  const rowF = (y - layout.originY) / layout.cellSize;
  const row = Math.round(rowF);
  const col = Math.round(colF);
  const clampedRow = Math.min(Math.max(row, 0), layout.rows);
  const clampedCol = Math.min(Math.max(col, 0), layout.cols);
  const { x: dx, y: dy } = dotPosition(layout, clampedRow, clampedCol);
  const dist = Math.hypot(x - dx, y - dy);
  return { row: clampedRow, col: clampedCol, dist };
}
