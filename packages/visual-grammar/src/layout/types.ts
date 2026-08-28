import type { VisualEdge, VisualGraphModel, VisualNode } from "@rvs/visual-intelligence";
import type { Point, Rect } from "../geometry.js";
import type { GrammarStyle } from "../style.js";

// The contract every layout engine satisfies.
//
// A layout engine decides *geometry only*. It never decides what is drawn --
// that was settled by the degradation policy in @rvs/visual-intelligence
// before this package saw the model -- and it never decides how something
// looks, which is the renderer's job with the injected style. Keeping the
// three separate is what makes "the box did not fit so the finding was
// dropped" impossible to write here: a layout has no way to drop anything.

export interface LaidOutNode {
  node: VisualNode;
  rect: Rect;
  /** The label as it will be drawn, already wrapped and truncated to the box. */
  lines: string[];
  /** A secondary line (kind, measure, status) when the grammar shows one. */
  secondary?: string;
  /**
   * A disambiguating suffix when a grammar draws the same entity more than
   * once -- `delta`'s before/after panels are the only current case. Element
   * ids incorporate it so the markup stays unique, while the entity's own id
   * stays on the shape unchanged, which is what lets the explorer highlight
   * both drawings of one entity together.
   */
  instance?: string;
}

export interface LaidOutEdge {
  edge: VisualEdge;
  points: Point[];
  /** Position for the edge label, when the grammar draws one. */
  label_anchor?: Point;
}

export interface LaidOutGroup {
  id: string;
  label: string;
  rect: Rect;
  /** True when the group was produced by adaptation rather than established upstream. */
  synthetic: boolean;
}

/** A free-standing label the grammar itself introduces (a lane header, an axis, a fishbone rib). */
export interface LaidOutLabel {
  id: string;
  text: string;
  at: Point;
  role: "lane" | "stage" | "axis" | "caption" | "rib";
  anchor: "start" | "middle" | "end";
  /** Rotation in degrees about `at`; only ever 0 or -90, so text is read horizontally or bottom-up, never upside down. */
  rotate?: 0 | -90;
}

export interface GrammarLayout {
  /** The layout's natural size in canonical units, before any fit-to-frame transform. */
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  groups: LaidOutGroup[];
  labels: LaidOutLabel[];
  /** How edges leave and enter nodes, used by the renderer to orient arrowheads. */
  edge_direction: "vertical" | "horizontal";
}

export interface LayoutContext {
  model: VisualGraphModel;
  style: GrammarStyle;
}

export type LayoutEngine = (context: LayoutContext) => GrammarLayout;

export function emptyLayout(direction: "vertical" | "horizontal" = "vertical"): GrammarLayout {
  return { width: 0, height: 0, nodes: [], edges: [], groups: [], labels: [], edge_direction: direction };
}
