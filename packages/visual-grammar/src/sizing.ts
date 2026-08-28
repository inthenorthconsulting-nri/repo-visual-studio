import type { VisualNode } from "@rvs/visual-intelligence";
import type { GrammarStyle } from "./style.js";
import { measureText, truncateToWidth, wrapToLines } from "./text.js";

// Node box sizing.
//
// Boxes are sized from their content, then clamped. The clamp matters more
// than it looks: without a maximum, one pathologically long label -- a deeply
// nested file path, say -- would set the column width for an entire diagram
// and squeeze everything else. Without a minimum, a diagram of short names
// would render as a row of tiny chips that read as decoration rather than as
// architecture.

export const MIN_NODE_WIDTH = 120;
export const MAX_NODE_WIDTH = 220;
export const MAX_LABEL_LINES = 2;

export interface SizedLabel {
  width: number;
  height: number;
  lines: string[];
  secondary?: string;
}

export function lineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.35 * 100) / 100;
}

/**
 * Sizes a node's box from its label and optional secondary line.
 *
 * The returned `lines` are what will actually be drawn -- already wrapped and
 * truncated -- so the renderer never re-measures and cannot disagree with the
 * box the layout reserved.
 */
export function sizeNode(node: VisualNode, style: GrammarStyle, showSecondary: boolean): SizedLabel {
  const secondary = showSecondary ? secondaryLine(node) : undefined;
  const natural = Math.max(
    measureText(node.label, style.font_size.label),
    secondary === undefined ? 0 : measureText(secondary, style.font_size.secondary),
  );
  const width = clamp(natural + style.spacing.md * 2, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
  const inner = width - style.spacing.md * 2;
  const lines = wrapToLines(node.label, inner, style.font_size.label, MAX_LABEL_LINES);
  const secondaryFitted =
    secondary === undefined ? undefined : truncateToWidth(secondary, inner, style.font_size.secondary);
  const textHeight =
    lines.length * lineHeight(style.font_size.label) +
    (secondaryFitted === undefined ? 0 : lineHeight(style.font_size.secondary));
  return {
    width,
    height: Math.max(48, Math.round(textHeight + style.spacing.md * 2)),
    lines,
    secondary: secondaryFitted,
  };
}

/**
 * The secondary line: a fact upstream already established, restated so the
 * reader does not have to hover to learn what kind of thing a box is.
 *
 * Order is fixed rather than "most interesting first", because a
 * content-dependent choice would make two runs over slightly different
 * evidence produce differently-shaped boxes for the same entity.
 */
function secondaryLine(node: VisualNode): string | undefined {
  // A stand-in's count comes first and outranks everything else: how many
  // things are behind this box is the only question the box exists to answer.
  if (node.placeholder_for !== undefined) {
    const count = node.placeholder_for.entity_count;
    return `${count} ${count === 1 ? "entity" : "entities"}`;
  }
  if (node.measure !== undefined) return node.measure.display;
  if (node.decision_status !== undefined) return node.decision_status;
  if (node.severity !== undefined) return node.severity;
  if (node.resolution !== "resolved") return node.resolution;
  return node.kind;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
