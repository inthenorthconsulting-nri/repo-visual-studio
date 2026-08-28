import type { Rect } from "../geometry.js";
import { sizeNode } from "../sizing.js";
import type { GrammarLayout, LaidOutEdge, LaidOutGroup, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";
import { orthogonalRoute } from "../geometry.js";

// Containment engines: `nested` and `layer_stack`.
//
// These two grammars answer "what is inside what", not "what depends on
// what", so neither routes edges as its primary structure. Containment is
// carried by the boxes themselves; edges are drawn only when they cross a
// container, because a crossing is the one relationship a containment diagram
// genuinely needs to show.

const HEADER_HEIGHT = 30;

/**
 * Packs member nodes into rows inside their container, then packs containers
 * into rows on the canvas.
 *
 * Row packing rather than a fixed grid: a fixed column count would leave a
 * container of two nodes as wide as one of nine, and the relative size of
 * containers is information a containment diagram is expected to convey.
 */
export function nestedLayout(context: LayoutContext, targetWidth = 1088): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("vertical");

  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, false)] as const));
  const gap = style.spacing.sm;
  const pad = style.spacing.md;

  // Nodes upstream placed in no container are collected into a trailing
  // pseudo-container so they are drawn, never dropped for lacking a parent.
  const assigned = new Set<string>();
  const containers = model.groups.map((group) => {
    const members = group.member_ids.filter((id) => sizes.has(id));
    for (const id of members) assigned.add(id);
    return { id: group.id, label: group.label, synthetic: group.synthetic, members };
  });
  const loose = model.nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
  if (loose.length > 0) {
    containers.push({ id: "__ungrouped", label: "Ungrouped", synthetic: true, members: loose });
  }

  const nodes: LaidOutNode[] = [];
  const groups: LaidOutGroup[] = [];
  const rects = new Map<string, Rect>();
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));

  const innerWidth = Math.max(240, targetWidth / Math.min(3, Math.max(1, containers.length))) - pad * 2;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const container of containers.filter((c) => c.members.length > 0)) {
    // Lay the members out relative to the container's origin first, so the
    // container's size follows from its content instead of being guessed.
    let localX = 0;
    let localY = 0;
    let localRow = 0;
    let widest = 0;
    const placed: Array<{ id: string; rect: Rect }> = [];
    for (const id of container.members) {
      const size = sizes.get(id)!;
      if (localX > 0 && localX + size.width > innerWidth) {
        localX = 0;
        localY += localRow + gap;
        localRow = 0;
      }
      placed.push({ id, rect: { x: localX, y: localY, width: size.width, height: size.height } });
      localX += size.width + gap;
      localRow = Math.max(localRow, size.height);
      widest = Math.max(widest, localX - gap);
    }
    const contentHeight = localY + localRow;
    const boxWidth = widest + pad * 2;
    const boxHeight = contentHeight + pad * 2 + HEADER_HEIGHT;

    if (cursorX > 0 && cursorX + boxWidth > targetWidth) {
      cursorX = 0;
      cursorY += rowHeight + style.spacing.lg;
      rowHeight = 0;
    }

    groups.push({
      id: container.id,
      label: container.label,
      synthetic: container.synthetic,
      rect: { x: cursorX, y: cursorY, width: boxWidth, height: boxHeight },
    });
    for (const item of placed) {
      const rect: Rect = {
        x: cursorX + pad + item.rect.x,
        y: cursorY + pad + HEADER_HEIGHT + item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
      };
      rects.set(item.id, rect);
      const size = sizes.get(item.id)!;
      nodes.push({ node: nodeById.get(item.id)!, rect, lines: size.lines, secondary: size.secondary });
    }

    cursorX += boxWidth + style.spacing.lg;
    rowHeight = Math.max(rowHeight, boxHeight);
  }

  const edges = crossingEdges(context, rects);
  const width = Math.max(...groups.map((g) => g.rect.x + g.rect.width), 0);
  const height = Math.max(...groups.map((g) => g.rect.y + g.rect.height), 0);
  return {
    width,
    height,
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges,
    groups: groups.sort((a, b) => (a.id < b.id ? -1 : 1)),
    labels: [],
    edge_direction: "horizontal",
  };
}

/**
 * Stacks containers as full-width bands, ordered by their upstream position.
 *
 * `layer_stack` says "these tiers sit above those tiers". Band order is
 * therefore load-bearing, and it is taken from the model's stage ordering
 * where one exists, falling back to group id -- never from how many members a
 * band happens to have, which would let a refactor silently reorder the
 * architecture the diagram asserts.
 */
export function layerStackLayout(context: LayoutContext, targetWidth = 1088): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("vertical");

  const sizes = new Map(model.nodes.map((n) => [n.id, sizeNode(n, style, false)] as const));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));
  const gap = style.spacing.sm;
  const pad = style.spacing.md;

  const stageOrder = new Map(model.stages.map((s) => [s.id, s.order] as const));
  const assigned = new Set<string>();
  const bands = model.groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      synthetic: group.synthetic,
      members: group.member_ids.filter((id) => sizes.has(id)),
      order: stageOrder.get(group.id) ?? Number.POSITIVE_INFINITY,
    }))
    .filter((b) => b.members.length > 0)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
  for (const band of bands) for (const id of band.members) assigned.add(id);
  const loose = model.nodes.filter((n) => !assigned.has(n.id)).map((n) => n.id);
  if (loose.length > 0) {
    bands.push({ id: "__ungrouped", label: "Ungrouped", synthetic: true, members: loose, order: Number.POSITIVE_INFINITY });
  }

  const nodes: LaidOutNode[] = [];
  const groups: LaidOutGroup[] = [];
  const rects = new Map<string, Rect>();
  let y = 0;
  for (const band of bands) {
    let x = pad;
    let rowTop = y + pad + HEADER_HEIGHT;
    let rowHeight = 0;
    let bandHeight = 0;
    for (const id of band.members) {
      const size = sizes.get(id)!;
      if (x > pad && x + size.width > targetWidth - pad) {
        x = pad;
        rowTop += rowHeight + gap;
        rowHeight = 0;
      }
      const rect: Rect = { x, y: rowTop, width: size.width, height: size.height };
      rects.set(id, rect);
      nodes.push({ node: nodeById.get(id)!, rect, lines: size.lines, secondary: size.secondary });
      x += size.width + gap;
      rowHeight = Math.max(rowHeight, size.height);
      bandHeight = rowTop + rowHeight - y + pad;
    }
    groups.push({
      id: band.id,
      label: band.label,
      synthetic: band.synthetic,
      rect: { x: 0, y, width: targetWidth, height: bandHeight },
    });
    y += bandHeight + style.spacing.md;
  }

  return {
    width: targetWidth,
    height: Math.max(0, y - style.spacing.md),
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    edges: crossingEdges(context, rects),
    groups,
    labels: [],
    edge_direction: "vertical",
  };
}

/**
 * Keeps only edges whose endpoints are in different containers.
 *
 * Inside a container, adjacency is already shown by the box. Drawing every
 * intra-container edge as well would bury the crossings, which are the
 * relationships a containment view exists to make visible.
 */
function crossingEdges(context: LayoutContext, rects: ReadonlyMap<string, Rect>): LaidOutEdge[] {
  const groupOf = new Map<string, string>();
  for (const group of context.model.groups) for (const id of group.member_ids) groupOf.set(id, group.id);
  const edges: LaidOutEdge[] = [];
  for (const edge of context.model.edges) {
    const from = rects.get(edge.from_id);
    const to = rects.get(edge.to_id);
    if (from === undefined || to === undefined) continue;
    if (groupOf.get(edge.from_id) === groupOf.get(edge.to_id)) continue;
    const points = orthogonalRoute(from, to, "horizontal");
    edges.push({ edge, points, label_anchor: points[Math.floor(points.length / 2)] });
  }
  return edges;
}
