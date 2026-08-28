import type { Point, Rect } from "../geometry.js";
import { sizeNode } from "../sizing.js";
import type { GrammarLayout, LaidOutEdge, LaidOutLabel, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";
import { orthogonalRoute } from "../geometry.js";

// Lane engines: `swimlane` and `sequence`.
//
// Both put responsibility on one axis and time on the other; they differ in
// which axis is which. A swimlane reads left-to-right as a process with rows
// of ownership; a sequence reads top-to-bottom as messages between columns of
// actors. Sharing this file keeps the lane-ordering rule in one place, since
// getting it wrong misattributes work to the wrong owner in both.

const LANE_HEADER_WIDTH = 150;
const LANE_HEADER_HEIGHT = 34;

/** Lanes in upstream order; ties by id so a model that ordered nothing still renders stably. */
function orderedLanes(context: LayoutContext) {
  const known = new Set(context.model.nodes.map((n) => n.id));
  const lanes = context.model.lanes
    .map((lane) => ({ ...lane, member_ids: lane.member_ids.filter((id) => known.has(id)) }))
    .filter((lane) => lane.member_ids.length > 0)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
  const assigned = new Set(lanes.flatMap((l) => l.member_ids));
  const loose = context.model.nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
  if (loose.length > 0) {
    // Never dropped for lacking a lane: an unassigned step is a gap in the
    // upstream model, and hiding it would hide the gap too.
    lanes.push({ id: "__unassigned", label: "Unassigned", member_ids: loose, order: Number.POSITIVE_INFINITY });
  }
  return lanes;
}

/**
 * Horizontal lanes of ownership, steps advancing left to right.
 *
 * A step's column is its upstream `order` when it has one. Without an order,
 * columns follow the lane's own member sequence -- which is a weaker claim,
 * but a claim the model actually made, unlike inventing a topological order
 * over edges that may not describe time at all.
 */
export function swimlaneLayout(context: LayoutContext): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("horizontal");

  const lanes = orderedLanes(context);
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, true)] as const));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));
  const gap = style.spacing.md;

  // One shared column grid across all lanes, so two steps with the same
  // upstream order line up vertically and read as concurrent.
  const columnOf = new Map<string, number>();
  for (const lane of lanes) {
    lane.member_ids.forEach((id, index) => {
      columnOf.set(id, nodeById.get(id)?.order ?? index);
    });
  }
  const columns = Array.from(new Set(columnOf.values())).sort((a, b) => a - b);
  const columnIndex = new Map(columns.map((c, i) => [c, i] as const));
  const columnWidth = Math.max(...Array.from(sizes.values(), (s) => s.width));

  const nodes: LaidOutNode[] = [];
  const labels: LaidOutLabel[] = [];
  const rects = new Map<string, Rect>();
  let y = 0;
  for (const lane of lanes) {
    const laneHeight = Math.max(...lane.member_ids.map((id) => sizes.get(id)!.height)) + gap * 2;
    labels.push({
      id: `lane-${lane.id}`,
      text: lane.label,
      at: { x: LANE_HEADER_WIDTH - style.spacing.md, y: y + laneHeight / 2 },
      role: "lane",
      anchor: "end",
      rotate: 0,
    });
    for (const id of lane.member_ids) {
      const size = sizes.get(id)!;
      const index = columnIndex.get(columnOf.get(id) ?? 0) ?? 0;
      const rect: Rect = {
        x: LANE_HEADER_WIDTH + index * (columnWidth + gap) + (columnWidth - size.width) / 2,
        y: y + (laneHeight - size.height) / 2,
        width: size.width,
        height: size.height,
      };
      rects.set(id, rect);
      nodes.push({ node: nodeById.get(id)!, rect, lines: size.lines, secondary: size.secondary });
    }
    y += laneHeight;
  }

  const edges: LaidOutEdge[] = [];
  for (const edge of model.edges) {
    const from = rects.get(edge.from_id);
    const to = rects.get(edge.to_id);
    if (from === undefined || to === undefined) continue;
    const points = orthogonalRoute(from, to, "horizontal");
    edges.push({ edge, points, label_anchor: points[Math.floor(points.length / 2)] });
  }

  return {
    width: LANE_HEADER_WIDTH + columns.length * (columnWidth + gap),
    height: y,
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups: [],
    labels,
    edge_direction: "horizontal",
  };
}

/**
 * Actor columns with a lifeline each; messages are edges drawn in order down
 * the page.
 *
 * Message order comes from the edge's endpoints' upstream `order`, then from
 * the canonical edge sort. Sequence is the one grammar where getting the
 * order wrong changes the meaning outright -- "A calls B then B calls C" is a
 * different system from the reverse -- so the ordering is derived only from
 * what upstream stated, never from geometry.
 */
export function sequenceLayout(context: LayoutContext): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("vertical");

  const lanes = orderedLanes(context);
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, false)] as const));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));
  const gap = style.spacing.xl;

  // Every actor gets a column. An actor is a lane when lanes exist, and
  // otherwise each node is its own column.
  const actors = lanes.length > 0 ? lanes : model.nodes.map((n) => ({ id: n.id, label: n.label, member_ids: [n.id], order: 0 }));
  const columnWidth = Math.max(...Array.from(sizes.values(), (s) => s.width));
  const columnX = new Map<string, number>();
  actors.forEach((actor, index) => {
    const x = index * (columnWidth + gap);
    for (const id of actor.member_ids) columnX.set(id, x);
  });

  const nodes: LaidOutNode[] = [];
  const labels: LaidOutLabel[] = [];
  const rects = new Map<string, Rect>();
  const headerHeight = LANE_HEADER_HEIGHT + style.spacing.md;

  actors.forEach((actor, index) => {
    labels.push({
      id: `actor-${actor.id}`,
      text: actor.label,
      at: { x: index * (columnWidth + gap) + columnWidth / 2, y: LANE_HEADER_HEIGHT / 2 },
      role: "lane",
      anchor: "middle",
      rotate: 0,
    });
  });

  // Steps run down each column in upstream order.
  const ordered = [...model.nodes].sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    return ao !== bo ? ao - bo : a.id < b.id ? -1 : 1;
  });
  const rowY = new Map<string, number>();
  let y = headerHeight;
  for (const node of ordered) {
    const size = sizes.get(node.id)!;
    const rect: Rect = {
      x: (columnX.get(node.id) ?? 0) + (columnWidth - size.width) / 2,
      y,
      width: size.width,
      height: size.height,
    };
    rects.set(node.id, rect);
    rowY.set(node.id, y);
    nodes.push({ node: nodeById.get(node.id)!, rect, lines: size.lines, secondary: size.secondary });
    y += size.height + style.spacing.md;
  }

  const edges: LaidOutEdge[] = [];
  for (const edge of model.edges) {
    const from = rects.get(edge.from_id);
    const to = rects.get(edge.to_id);
    if (from === undefined || to === undefined) continue;
    // A message is drawn horizontally at the sender's row: that is what makes
    // the vertical axis read as time rather than as another ranking.
    const yAt = from.y + from.height / 2;
    const goingRight = from.x < to.x;
    const start: Point = { x: goingRight ? from.x + from.width : from.x, y: yAt };
    const end: Point = { x: goingRight ? to.x : to.x + to.width, y: yAt };
    edges.push({ edge, points: [start, end], label_anchor: { x: (start.x + end.x) / 2, y: yAt - style.spacing.xs } });
  }

  return {
    width: actors.length * (columnWidth + gap) - gap,
    height: Math.max(0, y - style.spacing.md),
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups: [],
    labels,
    edge_direction: "horizontal",
  };
}
