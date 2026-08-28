// Milestone 10.5.2 -- editorial hierarchy and focal discipline.
//
// §12 states the rule this file exists to enforce: "If everything is focal:
// nothing is focal." A diagram where every node is emphasised has spent its
// entire emphasis budget and has none left for the thing the reader was
// brought here to see.
//
// The other half of §12 matters just as much. Rank comes from the spec, the
// focal ids, the preservation rank, the anchor priority, governance status,
// decision linkage, the primary path, and adaptation metadata -- all of which
// are upstream facts. It does not come from "arbitrary renderer preference".
// So `rankEntities` takes those facts as input and computes; it never looks
// at what would be convenient to draw.

/** How much visual weight an entity gets. Four bands, not a continuum: a continuum is a way to give everything a little emphasis. */
export type HierarchyRank = "primary" | "secondary" | "supporting" | "context";

export const HIERARCHY_RANKS: readonly HierarchyRank[] = ["primary", "secondary", "supporting", "context"] as const;

/**
 * The most entities that may be `primary` in one view.
 *
 * §11 says one or two. Two is the ceiling because a before/after comparison
 * and a cause/effect pair are each genuinely two-subject stories; three is
 * where "the focal entity" stops being a phrase that means anything.
 */
export const MAX_PRIMARY_ENTITIES = 2;

/** Everything upstream knows that bears on how prominent an entity should be. */
export interface HierarchyInput {
  id: string;
  /** Named focal by the VisualCommunicationSpec. */
  focal?: boolean;
  /** Degradation preservation rank; lower is more protected. */
  preservation_rank?: number;
  /** Anchor priority from adaptive detail; lower is a stronger anchor. */
  anchor_priority?: number;
  /** Carries a governance finding at or above review-required. */
  governance_significant?: boolean;
  /** Linked to an architecture decision. */
  decision_linked?: boolean;
  /** On the primary path the view is about. */
  on_primary_path?: boolean;
  /** Changed in the reviewed delta. */
  changed?: boolean;
}

interface Scored {
  id: string;
  score: number;
}

/**
 * Score an entity's claim on the reader's attention.
 *
 * Weights are ordinal and deliberately coarse. The point is not to compute a
 * precise importance; it is to produce a stable total order from facts that
 * already exist, so that two renderers given the same scene agree on what the
 * subject is.
 */
function scoreOf(entity: HierarchyInput): number {
  let score = 0;
  if (entity.focal) score += 100;
  if (entity.on_primary_path) score += 40;
  if (entity.governance_significant) score += 30;
  if (entity.changed) score += 20;
  if (entity.decision_linked) score += 10;
  if (entity.preservation_rank !== undefined) score += Math.max(0, 14 - entity.preservation_rank);
  if (entity.anchor_priority !== undefined) score += Math.max(0, 10 - entity.anchor_priority);
  return score;
}

/**
 * Assign a hierarchy rank to every entity in a view.
 *
 * `primary` is capped at `MAX_PRIMARY_ENTITIES` regardless of how many
 * entities were flagged focal upstream. An over-flagged scene degrades to
 * "the two strongest are primary, the rest are secondary" rather than to
 * "everything is primary", because the second outcome silently disables the
 * hierarchy while looking like it worked.
 *
 * Ties break on id, so the result does not depend on input order. §62 shuffles
 * this input and compares.
 */
export function rankEntities(entities: readonly HierarchyInput[]): Map<string, HierarchyRank> {
  const scored: Scored[] = entities
    .map((entity) => ({ id: entity.id, score: scoreOf(entity) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const ranks = new Map<string, HierarchyRank>();
  scored.forEach((entry, index) => {
    if (index < MAX_PRIMARY_ENTITIES && entry.score >= 100) ranks.set(entry.id, "primary");
    else if (entry.score >= 30) ranks.set(entry.id, "secondary");
    else if (entry.score > 0) ranks.set(entry.id, "supporting");
    else ranks.set(entry.id, "context");
  });
  return ranks;
}

/**
 * Which type role and stroke emphasis a rank draws with.
 *
 * Emphasis is spent on type weight and stroke, not on colour. A palette has
 * one accent and §52 forbids putting it on every important entity; type has a
 * whole scale, and using it is what makes a diagram read as edited rather
 * than as highlighted.
 */
export const RANK_PRESENTATION: Readonly<
  Record<HierarchyRank, { type_role: "sectionTitle" | "nodeLabel" | "nodeMeta"; stroke_scale: number; accent: boolean }>
> = {
  primary: { type_role: "sectionTitle", stroke_scale: 2, accent: true },
  secondary: { type_role: "nodeLabel", stroke_scale: 1.5, accent: false },
  supporting: { type_role: "nodeLabel", stroke_scale: 1, accent: false },
  context: { type_role: "nodeMeta", stroke_scale: 1, accent: false },
};

/** Whether a set of ranks respects the focal budget. Used as a regression assertion, not as a repair. */
export function focalBudgetRespected(ranks: ReadonlyMap<string, HierarchyRank>): boolean {
  let primary = 0;
  for (const rank of ranks.values()) if (rank === "primary") primary += 1;
  return primary <= MAX_PRIMARY_ENTITIES;
}
