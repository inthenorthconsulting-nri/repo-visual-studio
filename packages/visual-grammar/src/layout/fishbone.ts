import type { Point, Rect } from "../geometry.js";
import { sizeNode } from "../sizing.js";
import type { GrammarLayout, LaidOutEdge, LaidOutLabel, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";

// The `fishbone` engine: root-cause views.
//
// A fishbone asserts that a set of contributing causes, organised into
// categories, led to one effect. Every part of that claim has to come from
// upstream: the effect is the node upstream marked focal, the categories are
// the containers upstream established, and the causes are the members it put
// in them. This engine arranges them; it never decides that something caused
// something else.

const SPINE_MARGIN = 40;
const RIB_ANGLE_RUN = 60;

/**
 * Picks the effect node.
 *
 * Focal first, because that is the reader's stated question. Failing that,
 * the terminal node -- no outgoing edges, most incoming -- which in a
 * causal graph is where the chains end. The final fallback to lowest id is
 * arbitrary but total: a diagram of a graph with no clear terminus still
 * renders, and renders the same way every time.
 */
function pickEffect(context: LayoutContext) {
  const { model } = context;
  const focal = model.nodes.find((n) => n.emphasis === "focal");
  if (focal !== undefined) return focal;
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const edge of model.edges) {
    outDegree.set(edge.from_id, (outDegree.get(edge.from_id) ?? 0) + 1);
    inDegree.set(edge.to_id, (inDegree.get(edge.to_id) ?? 0) + 1);
  }
  const terminals = model.nodes.filter((n) => (outDegree.get(n.id) ?? 0) === 0);
  const pool = terminals.length > 0 ? terminals : model.nodes;
  return [...pool].sort((a, b) => {
    const ain = inDegree.get(a.id) ?? 0;
    const bin = inDegree.get(b.id) ?? 0;
    return ain !== bin ? bin - ain : a.id < b.id ? -1 : 1;
  })[0];
}

export function fishboneLayout(context: LayoutContext): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("horizontal");

  const effect = pickEffect(context);
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, false)] as const));

  // Categories are upstream containers; without containers, node kind is the
  // category -- still an upstream fact, just a coarser one.
  const causes = model.nodes.filter((n) => n.id !== effect.id);
  const buckets = new Map<string, { label: string; ids: string[] }>();
  for (const node of causes) {
    const key = node.group_id ?? `kind:${node.kind}`;
    const label = model.groups.find((g) => g.id === node.group_id)?.label ?? node.kind;
    const bucket = buckets.get(key);
    if (bucket) bucket.ids.push(node.id);
    else buckets.set(key, { label, ids: [node.id] });
  }
  const categories = Array.from(buckets.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  // Categories alternate above and below the spine, longest first, so a
  // fishbone with one heavy category does not end up lopsided.
  const above = categories.filter((_, index) => index % 2 === 0);
  const below = categories.filter((_, index) => index % 2 === 1);
  const deepest = Math.max(1, ...categories.map((c) => c.ids.length));
  const rowHeight = Math.max(...Array.from(sizes.values(), (s) => s.height)) + style.spacing.sm;
  const halfHeight = SPINE_MARGIN + deepest * rowHeight;

  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  const labels: LaidOutLabel[] = [];
  const rects = new Map<string, Rect>();
  const causeWidth = Math.max(...Array.from(sizes.values(), (s) => s.width));
  const columnStride = causeWidth + RIB_ANGLE_RUN + style.spacing.lg;
  const columns = Math.max(above.length, below.length);
  const spineY = halfHeight;
  const spineLength = columns * columnStride + SPINE_MARGIN;

  const place = (group: typeof categories, direction: -1 | 1) => {
    group.forEach((category, index) => {
      const ribX = SPINE_MARGIN + index * columnStride + columnStride / 2;
      labels.push({
        id: `rib-${category.key}`,
        text: category.label,
        at: { x: ribX + RIB_ANGLE_RUN, y: spineY + direction * (halfHeight - style.spacing.md) },
        role: "rib",
        anchor: "middle",
        rotate: 0,
      });
      category.ids.forEach((id, depth) => {
        const size = sizes.get(id)!;
        const y = spineY + direction * (SPINE_MARGIN + depth * rowHeight) - (direction === -1 ? size.height : 0);
        const rect: Rect = { x: ribX - size.width / 2, y, width: size.width, height: size.height };
        rects.set(id, rect);
        nodes.push({
          node: model.nodes.find((n) => n.id === id)!,
          rect,
          lines: size.lines,
          secondary: size.secondary,
        });
        // Each cause connects to the spine, not to the next cause: a fishbone
        // claims "these contributed", never "this one caused that one".
        const attach: Point = { x: ribX + RIB_ANGLE_RUN * (depth + 1) * 0.15, y: spineY };
        edges.push({
          edge: {
            id: `rib:${category.key}:${id}`,
            from_id: id,
            to_id: effect.id,
            kind: "contributes_to",
            emphasis: "supporting",
            resolution: "resolved",
            in_cycle: false,
            evidence_refs: [],
          },
          points: [{ x: rect.x + rect.width / 2, y: direction === -1 ? rect.y + rect.height : rect.y }, attach],
        });
      });
    });
  };
  place(above, -1);
  place(below, 1);

  const effectSize = sizes.get(effect.id)!;
  const effectRect: Rect = {
    x: spineLength,
    y: spineY - effectSize.height / 2,
    width: effectSize.width,
    height: effectSize.height,
  };
  rects.set(effect.id, effectRect);
  nodes.push({ node: effect, rect: effectRect, lines: effectSize.lines, secondary: effectSize.secondary });

  labels.push({
    id: "fishbone-spine",
    text: "",
    at: { x: 0, y: spineY },
    role: "axis",
    anchor: "start",
    rotate: 0,
  });

  return {
    width: effectRect.x + effectRect.width,
    height: halfHeight * 2,
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups: [],
    labels,
    edge_direction: "horizontal",
  };
}
