import {
  MINIMUM_TEXT_SIZE_PX,
  semanticMarkerTagText,
  type VisualNode,
} from "@rvs/visual-intelligence";
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
 * The type size of the visible marker row.
 *
 * Floored at the legible minimum for the same reason the state badge is: a
 * qualification rendered at four pixels is a qualification only the DOM can
 * read. Exported so sizing and rendering read one value.
 */
export function markerTagFontSize(style: GrammarStyle): number {
  return Math.max(style.font_size.annotation, MINIMUM_TEXT_SIZE_PX);
}

/**
 * Sizes a node's box from its label and optional secondary line.
 *
 * The returned `lines` are what will actually be drawn -- already wrapped and
 * truncated -- so the renderer never re-measures and cannot disagree with the
 * box the layout reserved.
 *
 * A marker row is reserved rather than returned. Two grammars (`matrix` and
 * `metric_row`) size their cards geometrically instead of calling this
 * function, so a fitted string handed down from here would simply be absent
 * for them; the renderer fits the row to the rect it is actually drawing,
 * which is the same inner width this function clamped to for every grammar
 * that does call it.
 */
export function sizeNode(node: VisualNode, style: GrammarStyle, showSecondary: boolean): SizedLabel {
  const secondary = showSecondary ? secondaryLine(node) : undefined;
  // The marker row is NOT gated on `showSecondary`. The secondary line is a
  // restatement of a fact the box already carries, so a terse detail mode can
  // drop it without losing anything; a marker is qualification that exists
  // nowhere else in the drawing, and a mode that dropped it would let detail
  // reduction erase meaning rather than repetition.
  const markerTag = semanticMarkerTagText(node.semantic_markers);
  const markerSize = markerTagFontSize(style);
  const natural = Math.max(
    measureText(node.label, style.font_size.label),
    secondary === undefined ? 0 : measureText(secondary, style.font_size.secondary),
    markerTag === undefined ? 0 : measureText(markerTag, markerSize),
  );
  const width = clamp(natural + style.spacing.md * 2, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
  const inner = width - style.spacing.md * 2;
  const lines = wrapToLines(node.label, inner, style.font_size.label, MAX_LABEL_LINES);
  const secondaryFitted =
    secondary === undefined ? undefined : truncateToWidth(secondary, inner, style.font_size.secondary);
  const textHeight =
    lines.length * lineHeight(style.font_size.label) +
    (secondaryFitted === undefined ? 0 : lineHeight(style.font_size.secondary)) +
    (markerTag === undefined ? 0 : lineHeight(markerSize));
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
