import type { Rect } from "../geometry.js";
import { orthogonalRoute } from "../geometry.js";
import { sizeNode } from "../sizing.js";
import type { GrammarLayout, LaidOutEdge, LaidOutLabel, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";

// Ordered-band engines: `process` and `timeline`.
//
// Both draw an ordered sequence of stages. They differ in what the ordering
// asserts: a process says "this step follows that step", a timeline says
// "this happened after that". Neither invents the ordering -- both read
// `model.stages`, and where a model has no stages they fall back to the
// nodes' own `order`, which upstream set from a real sequence (a decision
// supersession chain, a workflow's job order).

function stageBuckets(context: LayoutContext) {
  const known = new Set(context.model.nodes.map((n) => n.id));
  const stages = context.model.stages
    .map((stage) => ({ ...stage, member_ids: stage.member_ids.filter((id) => known.has(id)) }))
    .filter((stage) => stage.member_ids.length > 0)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
  if (stages.length > 0) {
    const assigned = new Set(stages.flatMap((s) => s.member_ids));
    const loose = context.model.nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
    if (loose.length > 0) {
      stages.push({ id: "__unstaged", label: "Unstaged", member_ids: loose, order: Number.POSITIVE_INFINITY });
    }
    return stages;
  }
  // No declared stages: each node becomes its own stage, in the order
  // upstream gave it.
  return [...context.model.nodes]
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      return ao !== bo ? ao - bo : a.id < b.id ? -1 : 1;
    })
    .map((node, index) => ({ id: `stage-${node.id}`, label: node.label, member_ids: [node.id], order: index }));
}

/**
 * Stages left to right, members stacked within each stage.
 *
 * Used for `process` and, with `withAxis`, for `timeline`, where a baseline
 * and stage captions are drawn so the horizontal axis reads as elapsed time
 * rather than as an arbitrary ordering.
 */
export function stageLayout(context: LayoutContext, withAxis: boolean): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("horizontal");

  const stages = stageBuckets(context);
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, true)] as const));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));
  const gap = style.spacing.lg;
  const captionHeight = withAxis ? style.spacing.lg : 0;

  const columnWidth = Math.max(...Array.from(sizes.values(), (s) => s.width));
  const tallest = Math.max(
    ...stages.map((stage) =>
      stage.member_ids.reduce((sum, id) => sum + sizes.get(id)!.height + style.spacing.sm, 0) - style.spacing.sm,
    ),
  );

  const nodes: LaidOutNode[] = [];
  const labels: LaidOutLabel[] = [];
  const rects = new Map<string, Rect>();

  stages.forEach((stage, index) => {
    const x = index * (columnWidth + gap);
    const stackHeight =
      stage.member_ids.reduce((sum, id) => sum + sizes.get(id)!.height + style.spacing.sm, 0) - style.spacing.sm;
    let y = captionHeight + (tallest - stackHeight) / 2;
    for (const id of stage.member_ids) {
      const size = sizes.get(id)!;
      const rect: Rect = { x: x + (columnWidth - size.width) / 2, y, width: size.width, height: size.height };
      rects.set(id, rect);
      nodes.push({ node: nodeById.get(id)!, rect, lines: size.lines, secondary: size.secondary });
      y += size.height + style.spacing.sm;
    }
    if (withAxis) {
      labels.push({
        id: `stage-${stage.id}`,
        text: stage.label,
        at: { x: x + columnWidth / 2, y: style.spacing.md },
        role: "stage",
        anchor: "middle",
        rotate: 0,
      });
    }
  });

  const edges: LaidOutEdge[] = [];
  for (const edge of model.edges) {
    const from = rects.get(edge.from_id);
    const to = rects.get(edge.to_id);
    if (from === undefined || to === undefined) continue;
    const points = orthogonalRoute(from, to, "horizontal");
    edges.push({ edge, points, label_anchor: points[Math.floor(points.length / 2)] });
  }

  const width = stages.length * (columnWidth + gap) - gap;
  const height = captionHeight + tallest;
  if (withAxis) {
    labels.push({
      id: "timeline-axis",
      text: "",
      at: { x: 0, y: captionHeight + tallest + style.spacing.md },
      role: "axis",
      anchor: "start",
      rotate: 0,
    });
  }

  return {
    width,
    height: height + (withAxis ? style.spacing.lg : 0),
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups: [],
    labels,
    edge_direction: "horizontal",
  };
}
