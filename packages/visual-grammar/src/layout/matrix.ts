import type { Rect } from "../geometry.js";
import { truncateToWidth } from "../text.js";
import type { GrammarLayout, LaidOutLabel, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";

// The `matrix` engine: ownership, comparison, and maturity views.
//
// A matrix is the one grammar where a cell's *position* carries the meaning,
// so the axes have to come from real upstream facts. Rows are containers
// (domains, owners, capabilities) and columns are node kinds -- both
// vocabulary upstream already established. Neither axis is derived from the
// data's shape, because axes that reorder themselves as evidence changes make
// two runs incomparable, which defeats the point of a comparison view.

const CELL_WIDTH = 132;
const CELL_HEIGHT = 56;
const ROW_HEADER_WIDTH = 168;
const COLUMN_HEADER_HEIGHT = 40;

export function matrixLayout(context: LayoutContext): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("horizontal");

  const groupLabel = new Map(model.groups.map((g) => [g.id, g.label] as const));
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  for (const node of model.nodes) {
    const row = node.group_id ?? "__ungrouped";
    if (!rowKeys.includes(row)) rowKeys.push(row);
    if (!columnKeys.includes(node.kind)) columnKeys.push(node.kind);
  }
  rowKeys.sort();
  columnKeys.sort();

  const rowIndex = new Map(rowKeys.map((k, i) => [k, i] as const));
  const columnIndex = new Map(columnKeys.map((k, i) => [k, i] as const));

  // Several nodes can share a cell. They stack inside it rather than
  // overlapping, and the cell grows -- collapsing them into a count would be
  // a reduction, and reductions are the degradation policy's decision to
  // make, not a layout's.
  const occupants = new Map<string, string[]>();
  for (const node of model.nodes) {
    const key = `${node.group_id ?? "__ungrouped"}|${node.kind}`;
    const list = occupants.get(key);
    if (list) list.push(node.id);
    else occupants.set(key, [node.id]);
  }
  const deepest = Math.max(1, ...Array.from(occupants.values(), (v) => v.length));
  const cellHeight = CELL_HEIGHT * deepest;

  const nodes: LaidOutNode[] = [];
  const labels: LaidOutLabel[] = [];
  const inner = CELL_WIDTH - style.spacing.sm * 2;

  for (const node of model.nodes) {
    const key = `${node.group_id ?? "__ungrouped"}|${node.kind}`;
    const slot = (occupants.get(key) ?? []).indexOf(node.id);
    const row = rowIndex.get(node.group_id ?? "__ungrouped") ?? 0;
    const column = columnIndex.get(node.kind) ?? 0;
    const rect: Rect = {
      x: ROW_HEADER_WIDTH + column * CELL_WIDTH + style.spacing.xs,
      y: COLUMN_HEADER_HEIGHT + row * cellHeight + slot * CELL_HEIGHT + style.spacing.xs,
      width: CELL_WIDTH - style.spacing.xs * 2,
      height: CELL_HEIGHT - style.spacing.xs * 2,
    };
    nodes.push({
      node,
      rect,
      lines: [truncateToWidth(node.label, inner, style.font_size.label)],
      secondary: node.measure?.display,
    });
  }

  rowKeys.forEach((key, index) => {
    labels.push({
      id: `matrix-row-${key}`,
      text: truncateToWidth(groupLabel.get(key) ?? key, ROW_HEADER_WIDTH - style.spacing.md, style.font_size.secondary),
      at: { x: ROW_HEADER_WIDTH - style.spacing.sm, y: COLUMN_HEADER_HEIGHT + index * cellHeight + cellHeight / 2 },
      role: "axis",
      anchor: "end",
      rotate: 0,
    });
  });
  columnKeys.forEach((key, index) => {
    labels.push({
      id: `matrix-column-${key}`,
      text: truncateToWidth(key, CELL_WIDTH - style.spacing.sm, style.font_size.secondary),
      at: { x: ROW_HEADER_WIDTH + index * CELL_WIDTH + CELL_WIDTH / 2, y: COLUMN_HEADER_HEIGHT - style.spacing.sm },
      role: "axis",
      anchor: "middle",
      rotate: 0,
    });
  });

  return {
    width: ROW_HEADER_WIDTH + columnKeys.length * CELL_WIDTH,
    height: COLUMN_HEADER_HEIGHT + rowKeys.length * cellHeight,
    nodes: nodes.sort((a, b) => (a.node.id < b.node.id ? -1 : 1)),
    // A matrix expresses relationships by position, so drawing edges over it
    // would assert a second, competing structure on the same picture.
    edges: [],
    groups: [],
    labels,
    edge_direction: "horizontal",
  };
}

/**
 * The `metric_row` engine: a row of standalone measures.
 *
 * Distribution and summary views. Cards wrap onto further rows rather than
 * shrinking, which is the split-before-shrink rule applied at the geometry
 * level: more rows is a readable answer, smaller type is not.
 */
export function metricRowLayout(context: LayoutContext, targetWidth = 1088): GrammarLayout {
  const { model, style } = context;
  const cards = model.nodes;
  if (cards.length === 0) return emptyLayout("horizontal");

  const perRow = Math.max(1, Math.min(4, Math.floor(targetWidth / 240)));
  const cardWidth = Math.floor((targetWidth - style.spacing.md * (perRow - 1)) / perRow);
  const cardHeight = 132;

  const nodes: LaidOutNode[] = cards.map((node, index) => {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    return {
      node,
      rect: {
        x: column * (cardWidth + style.spacing.md),
        y: row * (cardHeight + style.spacing.md),
        width: cardWidth,
        height: cardHeight,
      },
      lines: [truncateToWidth(node.label, cardWidth - style.spacing.lg, style.font_size.label)],
      secondary: node.measure?.display,
    };
  });

  const rows = Math.ceil(cards.length / perRow);
  return {
    width: targetWidth,
    height: rows * cardHeight + (rows - 1) * style.spacing.md,
    nodes,
    edges: [],
    groups: [],
    labels: [],
    edge_direction: "horizontal",
  };
}
