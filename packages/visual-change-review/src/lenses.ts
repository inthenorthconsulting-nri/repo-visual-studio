import type { VisualGraphModel } from "@rvs/visual-intelligence";
import type { ChangeReviewModel, ReviewChange, ReviewLens, ReviewLensDefinition } from "./contracts.js";
import { normalizeIds } from "./ids.js";

// The six review lenses.
//
// Every one of them is a *selection* over facts that already exist. A lens
// never changes a GraphChangeSet, a governance severity, a decision state, an
// impact calculation, or one number in the fidelity receipt -- which is why
// this file holds no branch that writes to a change, and why `applyReviewLens`
// returns muted ids rather than a filtered set.
//
// Two of the lenses carry a caveat that is drawn on the page whenever they are
// active, because both are one reading away from being taken as a verdict:
//
//  * The governance lens shows which findings exist. An empty governance lens
//    means no finding was recorded, not that the change is safe to deploy --
//    those are different claims and only one of them is in evidence.
//  * The decisions lens shows which decisions a change touches and what state
//    upstream already recorded them in. It is not a correctness judgement, and
//    nothing in RVS approves or rejects a decision.

export const REVIEW_LENSES: readonly ReviewLensDefinition[] = [
  {
    id: "architecture",
    label: "Architecture",
    description: "Brings forward entities whose structure or relationships changed.",
    caveat: "Structural changes only. A component that kept its shape but changed behaviour is not visible here.",
  },
  {
    id: "capabilities",
    label: "Capabilities",
    description: "Brings forward changes an upstream layer linked to a capability.",
    caveat: "Capability links are read from upstream artifacts; a capability nobody linked is not shown as unaffected.",
  },
  {
    id: "governance",
    label: "Governance",
    description: "Brings forward changes carrying a governance finding.",
    caveat: "This lens shows which findings were recorded. An empty result means no finding was recorded, not that the change is safe to deploy.",
  },
  {
    id: "decisions",
    label: "Decisions",
    description: "Brings forward changes linked to an architecture decision.",
    caveat: "Decision state is reported as recorded upstream. RVS does not judge a decision's correctness and never approves or rejects one.",
  },
  {
    id: "impact",
    label: "Impact",
    description: "Brings forward changes with an upstream-computed impact path or blast radius.",
    caveat: "Reach is whatever upstream traversal established within its own boundary; absence of a path is not absence of reach.",
  },
  {
    id: "unresolved",
    label: "Unresolved",
    description: "Brings forward changes whose consequences upstream could not determine.",
    caveat: "These are open questions, not findings. Each one is something the analysis could not answer.",
  },
];

export const REVIEW_LENS_IDS: readonly ReviewLens[] = REVIEW_LENSES.map((l) => l.id);

export function isReviewLens(value: string): value is ReviewLens {
  return (REVIEW_LENS_IDS as readonly string[]).includes(value);
}

/**
 * Whether a change is what a lens is about.
 *
 * Reads only fields upstream already populated. Note what is *not* here:
 * no lens asks "is this change important", because importance is not a fact
 * any upstream layer recorded and inventing one would be this package making
 * an architectural claim under cover of a filter.
 */
export function changeMatchesLens(change: ReviewChange, lens: ReviewLens): boolean {
  switch (lens) {
    case "architecture":
      return true;
    case "capabilities":
      return change.capability_ids.length > 0 || change.product_ids.length > 0;
    case "governance":
      return change.governance_finding_ids.length > 0;
    case "decisions":
      return change.decision_ids.length > 0;
    case "impact":
      return change.impact_path_ids.length > 0 || change.blast_radius !== "isolated";
    case "unresolved":
      return (
        change.change_type === "unresolved" ||
        change.resolution_status !== "resolved" ||
        change.blast_radius === "unresolved"
      );
  }
}

/**
 * The entity ids a lens brings forward.
 *
 * Includes every entity named by a matching change on either side, so a
 * reader who selects the governance lens sees both ends of the change that
 * carries the finding rather than one end and a dangling arrow.
 */
export function lensEntityIds(model: ChangeReviewModel, lens: ReviewLens): string[] {
  const ids: string[] = [];
  for (const change of model.changes) {
    if (!changeMatchesLens(change, lens)) continue;
    ids.push(change.entity_id);
    if (change.before_entity_id !== undefined) ids.push(change.before_entity_id);
    if (change.after_entity_id !== undefined) ids.push(change.after_entity_id);
  }
  return normalizeIds(ids);
}

/**
 * Applies a lens as emphasis over the drawn model.
 *
 * Nothing is removed and nothing is hidden. An entity outside the lens is
 * muted -- still drawn, still in the document, still found by search, still
 * announced by a screen reader -- because a reader who cannot see that
 * something was excluded cannot tell an empty answer from an unasked
 * question. Focal entities are never muted; the reader named them.
 */
export function applyReviewLens(
  visual: VisualGraphModel,
  model: ChangeReviewModel,
  lens: ReviewLens,
): VisualGraphModel {
  const brought = new Set(lensEntityIds(model, lens));
  return {
    ...visual,
    nodes: visual.nodes.map((node) => {
      if (node.emphasis === "focal") return node;
      if (brought.has(node.source_entity_id)) return node;
      return { ...node, emphasis: "muted" as const };
    }),
  };
}
