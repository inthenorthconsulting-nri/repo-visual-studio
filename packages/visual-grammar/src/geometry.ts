// Shared geometry.
//
// Everything here is expressed in canonical units from
// @rvs/visual-intelligence's coordinate system, so a box computed by a layout
// is the same box the interactive explorer hit-tests and the same box the
// validator screenshots. No layout may invent its own coordinate space.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The point on `rect`'s border where a line aimed at `toward` leaves it.
 *
 * Computed analytically rather than by stepping along the line, so the answer
 * is exact and independent of any tolerance constant. A line from the centre
 * is clipped to whichever pair of edges it crosses first.
 */
export function borderPoint(rect: Rect, toward: Point): Point {
  const c = centerOf(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  // Scale the direction vector until it touches the nearer of the vertical
  // and horizontal edge pairs.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/**
 * An orthogonal route from one rect to another, leaving and entering on the
 * axis given by `direction`.
 *
 * Orthogonal rather than straight because these diagrams are read as
 * structure, and a bundle of diagonals at slightly different angles reads as
 * noise where a set of right angles reads as a hierarchy. The mid-point turn
 * is deterministic: it depends only on the two rects, never on how many other
 * edges happen to be nearby.
 */
export function orthogonalRoute(from: Rect, to: Rect, direction: "vertical" | "horizontal"): Point[] {
  const a = centerOf(from);
  const b = centerOf(to);
  if (direction === "vertical") {
    const start = { x: a.x, y: a.y < b.y ? from.y + from.height : from.y };
    const end = { x: b.x, y: a.y < b.y ? to.y : to.y + to.height };
    if (Math.abs(start.x - end.x) < 0.5) return [start, { x: end.x, y: end.y }];
    const mid = (start.y + end.y) / 2;
    return [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
  }
  const start = { x: a.x < b.x ? from.x + from.width : from.x, y: a.y };
  const end = { x: a.x < b.x ? to.x : to.x + to.width, y: b.y };
  if (Math.abs(start.y - end.y) < 0.5) return [start, { x: end.x, y: end.y }];
  const mid = (start.x + end.x) / 2;
  return [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
}

/**
 * Scales and centres `content` inside `frame` without distorting it.
 *
 * A layout computes its natural size first and is fitted afterwards. The
 * scale is uniform by contract: a non-uniform fit would make text in a wide
 * diagram a different size from text in a tall one, which is exactly the
 * "make it smaller until it fits" behaviour Milestone 10 forbids -- so this
 * never scales *up* past 1 either, leaving a small diagram at its natural
 * size in the middle of the frame rather than blowing it up to fill.
 */
export function fitTransform(content: { width: number; height: number }, frame: { width: number; height: number }): {
  scale: number;
  translateX: number;
  translateY: number;
} {
  if (content.width <= 0 || content.height <= 0) return { scale: 1, translateX: 0, translateY: 0 };
  const scale = Math.min(1, frame.width / content.width, frame.height / content.height);
  return {
    scale,
    translateX: (frame.width - content.width * scale) / 2,
    translateY: (frame.height - content.height * scale) / 2,
  };
}

/** The bounding box of a set of rects, or a zero rect when there are none. */
export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
