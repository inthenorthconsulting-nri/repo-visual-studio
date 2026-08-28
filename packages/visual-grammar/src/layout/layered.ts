import { orthogonalRoute, type Rect } from "../geometry.js";
import { sizeNode } from "../sizing.js";
import type { GrammarLayout, LaidOutEdge, LaidOutGroup, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";

// The layered-DAG engine: dependency_graph, architecture, data_flow, tree.
//
// Hand-rolled rather than delegated to Dagre or ELK, for the same reason
// @rvs/workflow-svg hand-rolls its own: those libraries carry heuristics
// whose output can shift between versions, and a diagram that changes when a
// transitive dependency updates cannot be part of a determinism proof. What
// is given up is crossing-minimisation quality; what is bought is output that
// is a pure function of the model.

export interface LayeredOptions {
  direction: "vertical" | "horizontal";
  /** Space between two nodes in the same layer. */
  node_gap: number;
  /** Space between one layer and the next. */
  layer_gap: number;
  show_secondary: boolean;
  /**
   * The width available across a layer, in canonical units.
   *
   * A layer wider than this wraps onto further rows inside the same band
   * rather than running past the edge of the frame. The alternative -- which
   * is what this engine used to do -- was to hand the renderer a layout wider
   * than the scene and let `fitTransform` shrink the whole drawing to make it
   * fit, which shrinks the type with it: a five-box layer 1212 units wide in a
   * 1088-unit frame is drawn at 0.9, and the 14px legibility floor every
   * budget in @rvs/visual-intelligence is derived from becomes 12.6px on the
   * reader's screen. The budgets are computed from how many cells fit *across*
   * the content box (`geometricNodeCapacity`), so wrapping to that same width
   * is the engine finally honouring the geometry its own node count came from.
   *
   * `undefined` means "do not wrap", which is what a caller measuring a
   * layout's natural size wants.
   */
  frame_breadth?: number;
}

export const DEFAULT_LAYERED_OPTIONS: LayeredOptions = {
  direction: "vertical",
  node_gap: 28,
  layer_gap: 72,
  show_secondary: true,
};

/**
 * Splits one layer into rows that each fit the available breadth.
 *
 * Order is preserved exactly: rows are filled left to right in the order the
 * barycentre sweep produced, so wrapping never reorders a layer and never
 * changes which node sits next to which. A single node wider than the frame
 * still gets its own row -- there is nothing to gain by leaving it alone and
 * nothing this engine may do about its size.
 */
function wrapBand(
  ids: readonly string[],
  breadthOf: (id: string) => number,
  gap: number,
  limit: number | undefined,
): string[][] {
  if (limit === undefined || ids.length === 0) return ids.length === 0 ? [] : [[...ids]];
  const rows: string[][] = [];
  let row: string[] = [];
  let used = 0;
  for (const id of ids) {
    const breadth = breadthOf(id);
    const next = row.length === 0 ? breadth : used + gap + breadth;
    if (row.length > 0 && next > limit) {
      rows.push(row);
      row = [id];
      used = breadth;
      continue;
    }
    row.push(id);
    used = next;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Longest-path layering over Kahn's topological order.
 *
 * Cycles are the interesting case. Upstream marks them (`in_cycle`) but does
 * not break them, and a cyclic graph has no topological order, so the queue
 * drains early and leaves nodes unassigned. Those are appended one layer past
 * the deepest resolved layer, sorted by id -- an arbitrary but *stated* and
 * reproducible choice. The alternative, dropping a back-edge, would make the
 * diagram assert an acyclic structure that the evidence contradicts.
 */
function computeLayers(context: LayoutContext): Map<string, number> {
  const { model } = context;
  const ids = new Set(model.nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of model.nodes) {
    outgoing.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of model.edges) {
    if (!ids.has(edge.from_id) || !ids.has(edge.to_id) || edge.from_id === edge.to_id) continue;
    outgoing.get(edge.from_id)!.push(edge.to_id);
    inDegree.set(edge.to_id, (inDegree.get(edge.to_id) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  // Seeded and drained in id order so the traversal never depends on Map
  // insertion order, which would otherwise track the caller's array order.
  const queue = model.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id).sort();
  for (const id of queue) layer.set(id, 0);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const current = layer.get(id) ?? 0;
    for (const next of [...(outgoing.get(id) ?? [])].sort()) {
      layer.set(next, Math.max(layer.get(next) ?? 0, current + 1));
      const left = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  const deepest = layer.size === 0 ? -1 : Math.max(...layer.values());
  const stranded = model.nodes.filter((n) => !layer.has(n.id)).map((n) => n.id).sort();
  for (const id of stranded) layer.set(id, deepest + 1);
  return layer;
}

/**
 * Orders nodes within each layer by the mean position of their predecessors.
 *
 * A fixed four sweeps, not "until stable": iterating to convergence would let
 * the number of passes depend on the graph, and a graph that oscillates would
 * never terminate. Four is enough to untangle ordinary architecture graphs,
 * and ties always fall back to id, so the result is total either way.
 */
function orderWithinLayers(
  layers: Map<number, string[]>,
  context: LayoutContext,
): Map<number, string[]> {
  const predecessors = new Map<string, string[]>();
  for (const edge of context.model.edges) {
    if (edge.from_id === edge.to_id) continue;
    const list = predecessors.get(edge.to_id);
    if (list) list.push(edge.from_id);
    else predecessors.set(edge.to_id, [edge.from_id]);
  }

  const ordered = new Map(Array.from(layers, ([index, ids]) => [index, [...ids].sort()] as const));
  const indices = Array.from(ordered.keys()).sort((a, b) => a - b);
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const index of indices.slice(1)) {
      const previous = ordered.get(index - 1) ?? [];
      const position = new Map(previous.map((id, i) => [id, i] as const));
      const current = ordered.get(index) ?? [];
      const scored = current.map((id) => {
        const preds = (predecessors.get(id) ?? []).map((p) => position.get(p)).filter((p): p is number => p !== undefined);
        const barycenter = preds.length === 0 ? Number.POSITIVE_INFINITY : preds.reduce((a, b) => a + b, 0) / preds.length;
        return { id, barycenter };
      });
      scored.sort((a, b) => (a.barycenter !== b.barycenter ? a.barycenter - b.barycenter : a.id < b.id ? -1 : 1));
      ordered.set(index, scored.map((s) => s.id));
    }
  }
  return ordered;
}

export function layeredLayout(context: LayoutContext, options: Partial<LayeredOptions> = {}): GrammarLayout {
  const opts = { ...DEFAULT_LAYERED_OPTIONS, ...options };
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout(opts.direction);

  const layerOf = computeLayers(context);
  const byLayer = new Map<number, string[]>();
  for (const node of model.nodes) {
    const index = layerOf.get(node.id) ?? 0;
    const list = byLayer.get(index);
    if (list) list.push(node.id);
    else byLayer.set(index, [node.id]);
  }
  const ordered = orderWithinLayers(byLayer, context);

  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, opts.show_secondary)] as const));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));
  const vertical = opts.direction === "vertical";

  // Each layer becomes a band; nodes are centred within their band so a layer
  // of one node sits above the middle of a layer of five rather than at its
  // left edge.
  const indices = Array.from(ordered.keys()).sort((a, b) => a - b);
  const breadthOf = (id: string): number => (vertical ? sizes.get(id)!.width : sizes.get(id)!.height);
  const extentOf = (id: string): number => (vertical ? sizes.get(id)!.height : sizes.get(id)!.width);
  const rowBreadth = (ids: readonly string[]): number =>
    ids.reduce((sum, id) => sum + breadthOf(id), 0) + Math.max(0, ids.length - 1) * opts.node_gap;

  // A band is a layer, and a layer is one or more rows. Every layer used to be
  // exactly one row; a layer too wide for the frame now becomes several,
  // stacked inside the band, so the band still reads as one level of the graph
  // while the drawing stays inside the scene.
  const bands = indices.map((index) =>
    wrapBand(ordered.get(index) ?? [], breadthOf, opts.node_gap, opts.frame_breadth),
  );
  const rowExtents = bands.map((rows) => rows.map((row) => Math.max(...row.map(extentOf))));
  const bandExtent = rowExtents.map((extents) =>
    extents.reduce((sum, extent) => sum + extent, 0) + Math.max(0, extents.length - 1) * opts.node_gap,
  );
  const widest = Math.max(0, ...bands.flatMap((rows) => rows.map(rowBreadth)));

  const nodes: LaidOutNode[] = [];
  const rects = new Map<string, Rect>();
  let along = 0;
  bands.forEach((rows, position) => {
    let withinBand = 0;
    rows.forEach((row, rowIndex) => {
      const extent = rowExtents[position][rowIndex];
      let across = (widest - rowBreadth(row)) / 2;
      for (const id of row) {
        const size = sizes.get(id)!;
        const at = along + withinBand;
        const rect: Rect = vertical
          ? { x: across, y: at + (extent - size.height) / 2, width: size.width, height: size.height }
          : { x: at + (extent - size.width) / 2, y: across, width: size.width, height: size.height };
        rects.set(id, rect);
        nodes.push({ node: nodeById.get(id)!, rect, lines: size.lines, secondary: size.secondary });
        across += breadthOf(id) + opts.node_gap;
      }
      withinBand += extent + opts.node_gap;
    });
    along += bandExtent[position] + opts.layer_gap;
  });

  const edges: LaidOutEdge[] = [];
  for (const edge of model.edges) {
    const from = rects.get(edge.from_id);
    const to = rects.get(edge.to_id);
    if (from === undefined || to === undefined || edge.from_id === edge.to_id) continue;
    const points = orthogonalRoute(from, to, opts.direction);
    edges.push({
      edge,
      points,
      label_anchor: points.length > 0 ? points[Math.floor(points.length / 2)] : undefined,
    });
  }

  const groups = groupBoxes(context, rects, style.spacing.md);

  const width = vertical ? widest : along - opts.layer_gap;
  const height = vertical ? along - opts.layer_gap : widest;
  return {
    width: Math.max(width, 0),
    height: Math.max(height, 0),
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups,
    labels: [],
    edge_direction: opts.direction,
  };
}

/**
 * Draws a container around the members that survived adaptation.
 *
 * A group whose members were scattered across layers still gets one box, and
 * that box may overlap another. That is accepted deliberately: moving nodes
 * to make containers disjoint would reorder layers and misrepresent the
 * dependency structure, and the structure is the point of the diagram.
 */
export function groupBoxes(
  context: LayoutContext,
  rects: ReadonlyMap<string, Rect>,
  padding: number,
): LaidOutGroup[] {
  const groups: LaidOutGroup[] = [];
  for (const group of context.model.groups) {
    const members = group.member_ids.map((id) => rects.get(id)).filter((r): r is Rect => r !== undefined);
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((r) => r.x));
    const minY = Math.min(...members.map((r) => r.y));
    const maxX = Math.max(...members.map((r) => r.x + r.width));
    const maxY = Math.max(...members.map((r) => r.y + r.height));
    groups.push({
      id: group.id,
      label: group.label,
      synthetic: group.synthetic,
      rect: {
        x: minX - padding,
        y: minY - padding * 1.75,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2.75,
      },
    });
  }
  return groups.sort((a, b) => (a.id < b.id ? -1 : 1));
}
