import type { DetailMode, VisualGrammar } from "./contracts.js";
import { sceneContentBox } from "./coordinate-system.js";
import { VISUAL_GRAMMARS } from "./vocabulary.js";

// Per-grammar complexity budgets.
//
// These are *derived*, not asserted. Hard-coding "architecture: 12 nodes"
// would be a number nobody could defend six months later; instead every
// budget below falls out of three things that can each be checked
// independently:
//
//   1. the canonical content box (coordinate-system.ts) -- 1088 x 576 units,
//      i.e. the 16:9 stage minus the scene padding @rvs/renderer-html
//      already applies;
//   2. a minimum legible cell per grammar -- the smallest box a node of that
//      grammar can occupy and still carry a label at the 14px floor
//      @rvs/validator enforces (`minFontSizePx` default), plus its gutter;
//   3. a routing reserve -- the fraction of the box that connectors, edge
//      labels, and the legend need and that therefore cannot hold nodes.
//
// So a budget changes only when the stage geometry, the legibility floor, or
// the routing model changes -- and `budgets.test.ts` re-derives all of them
// to prove the published numbers still match the geometry.

/** What a grammar's *secondary* budget counts, when it has one. A dependency graph is bounded by nodes; a swimlane is bounded by lanes first and nodes second. */
export type GrammarGroupUnit =
  | "cause_group"
  | "lane"
  | "participant"
  | "stage"
  | "layer"
  | "column"
  | "panel"
  | "metric";

export interface GrammarLayoutProfile {
  /** Minimum legible node box including its gutter, in canonical units. */
  cell: { width: number; height: number };
  /** Fraction of the content box reserved for connectors, edge labels, and legend. */
  routing_reserve: number;
  /** Edges per node this grammar stays readable at. A tree is ~1 (n-1 edges); a dependency graph tolerates ~2. */
  edge_factor: number;
  /** Maximum traversal/nesting depth this grammar can show before the reader loses the thread. */
  max_depth: number;
  /** The secondary unit and the pitch (in canonical units) one costs along its axis. */
  group?: { unit: GrammarGroupUnit; pitch: number; axis: "x" | "y" };
}

export interface GrammarBudget {
  grammar: VisualGrammar;
  max_nodes: number;
  max_edges: number;
  max_depth: number;
  group_unit?: GrammarGroupUnit;
  max_groups?: number;
}

const LAYOUT_PROFILES: Readonly<Record<VisualGrammar, GrammarLayoutProfile>> = {
  // A boxed component with a two-line label at >=16px, plus a 40x48 gutter.
  architecture: { cell: { width: 240, height: 112 }, routing_reserve: 0.35, edge_factor: 1.5, max_depth: 4 },
  dependency_graph: { cell: { width: 224, height: 104 }, routing_reserve: 0.3, edge_factor: 2, max_depth: 4 },
  // Participants are columns; messages are rows down the page.
  sequence: { cell: { width: 130, height: 56 }, routing_reserve: 0.2, edge_factor: 1.2, max_depth: 3, group: { unit: "participant", pitch: 130, axis: "x" } },
  swimlane: { cell: { width: 180, height: 72 }, routing_reserve: 0.25, edge_factor: 1.4, max_depth: 3, group: { unit: "lane", pitch: 72, axis: "y" } },
  data_flow: { cell: { width: 224, height: 104 }, routing_reserve: 0.35, edge_factor: 1.6, max_depth: 4 },
  tree: { cell: { width: 200, height: 88 }, routing_reserve: 0.2, edge_factor: 1, max_depth: 5 },
  nested: { cell: { width: 220, height: 96 }, routing_reserve: 0.25, edge_factor: 0.5, max_depth: 4 },
  layer_stack: { cell: { width: 260, height: 96 }, routing_reserve: 0.15, edge_factor: 0.5, max_depth: 3, group: { unit: "layer", pitch: 96, axis: "y" } },
  timeline: { cell: { width: 150, height: 96 }, routing_reserve: 0.2, edge_factor: 1, max_depth: 2, group: { unit: "stage", pitch: 130, axis: "x" } },
  matrix: { cell: { width: 160, height: 64 }, routing_reserve: 0.15, edge_factor: 0, max_depth: 2, group: { unit: "column", pitch: 160, axis: "x" } },
  metric_row: { cell: { width: 220, height: 140 }, routing_reserve: 0.1, edge_factor: 0, max_depth: 1, group: { unit: "metric", pitch: 220, axis: "x" } },
  // Ribs alternate above and below the spine; the pitch is along the spine.
  fishbone: { cell: { width: 170, height: 60 }, routing_reserve: 0.3, edge_factor: 1, max_depth: 3, group: { unit: "cause_group", pitch: 150, axis: "x" } },
  state_machine: { cell: { width: 200, height: 88 }, routing_reserve: 0.35, edge_factor: 2, max_depth: 3 },
  process: { cell: { width: 200, height: 88 }, routing_reserve: 0.25, edge_factor: 1.2, max_depth: 3, group: { unit: "stage", pitch: 200, axis: "x" } },
  // Three panels share the width, so a delta's per-panel cell is a third-width box.
  delta: { cell: { width: 160, height: 88 }, routing_reserve: 0.2, edge_factor: 1, max_depth: 3, group: { unit: "panel", pitch: 360, axis: "x" } },
};

/**
 * The multiplier each detail mode applies to the geometric capacity.
 *
 * `faithful` uses the full legible capacity -- it is a readability ceiling,
 * not a preference. `balanced` and `simplified` sit below it deliberately:
 * their job is to leave whitespace for the emphasis and annotation that make
 * a reduced view worth reducing. Note this is the *only* place detail mode
 * touches a budget -- audience never does (see audience.ts).
 */
const DETAIL_MODE_CAPACITY: Readonly<Record<DetailMode, number>> = {
  faithful: 1,
  balanced: 0.7,
  simplified: 0.45,
};

function usableBox(reserve: number): { width: number; height: number } {
  const box = sceneContentBox();
  // The reserve is an *area* fraction, applied uniformly to both axes so an
  // aspect-ratio-preserving reserve does not distort the grid.
  const linear = Math.sqrt(1 - reserve);
  return { width: box.width * linear, height: box.height * linear };
}

/**
 * The across-axis extent one view's nodes actually get.
 *
 * For nearly every grammar that is the usable box: lanes, stages and columns
 * *partition* the content, so a node placed in one is not placed in the
 * others, and the whole width is available to the node set. `panel` is the
 * exception, and the difference is not cosmetic -- a delta's before, delta and
 * after panels draw the *same* entities three times over, side by side, so the
 * width a node has is one panel's, not the scene's. Measuring the delta grid
 * across the whole box counted the same capacity three times: it published a
 * budget of 21 nodes at balanced detail for a grammar that fits seven, so
 * degradation saw nothing to reduce and the renderer resolved the overflow the
 * one way the policy forbids -- by fitting the drawing, and its type, down to a
 * quarter of its size.
 */
function nodeBreadth(profile: GrammarLayoutProfile, box: { width: number; height: number }): number {
  if (profile.group?.unit !== "panel") return box.width;
  return Math.min(box.width, profile.group.pitch);
}

/** The geometric node capacity of a grammar at full (faithful) detail. Exported so tests and docs can re-derive the published budgets rather than trusting them. */
export function geometricNodeCapacity(grammar: VisualGrammar): number {
  const profile = LAYOUT_PROFILES[grammar];
  const box = usableBox(profile.routing_reserve);
  const cols = Math.floor(nodeBreadth(profile, box) / profile.cell.width);
  const rows = Math.floor(box.height / profile.cell.height);
  return Math.max(1, cols * rows);
}

function geometricGroupCapacity(grammar: VisualGrammar): number | undefined {
  const profile = LAYOUT_PROFILES[grammar];
  if (!profile.group) return undefined;
  const box = usableBox(profile.routing_reserve);
  const extent = profile.group.axis === "x" ? box.width : box.height;
  return Math.max(1, Math.floor(extent / profile.group.pitch));
}

/**
 * The readable budget for one view in one grammar at one detail mode.
 *
 * Exceeding a budget is never resolved by shrinking type. `degradation.ts`
 * adapts (cluster -> collapse -> split -> hide-with-receipt) instead; see
 * Milestone 10.28's split-before-shrink rule.
 */
export function budgetFor(grammar: VisualGrammar, detailMode: DetailMode): GrammarBudget {
  const profile = LAYOUT_PROFILES[grammar];
  const scale = DETAIL_MODE_CAPACITY[detailMode];
  const maxNodes = Math.max(1, Math.floor(geometricNodeCapacity(grammar) * scale));
  const groupCapacity = geometricGroupCapacity(grammar);
  return {
    grammar,
    max_nodes: maxNodes,
    max_edges: Math.max(0, Math.round(maxNodes * profile.edge_factor)),
    max_depth: profile.max_depth,
    ...(profile.group
      ? {
          group_unit: profile.group.unit,
          max_groups: Math.max(1, Math.floor((groupCapacity ?? 1) * scale)),
        }
      : {}),
  };
}

/** Every grammar's budget at one detail mode, in canonical grammar order -- the table docs/visual-grammar.md publishes. */
export function allBudgets(detailMode: DetailMode): GrammarBudget[] {
  return VISUAL_GRAMMARS.map((grammar) => budgetFor(grammar, detailMode));
}

export function layoutProfileFor(grammar: VisualGrammar): GrammarLayoutProfile {
  return LAYOUT_PROFILES[grammar];
}
