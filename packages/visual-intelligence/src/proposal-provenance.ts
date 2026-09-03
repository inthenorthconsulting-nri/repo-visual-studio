import { OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING } from "./proposal-truth.js";
import type { VisualState } from "./visual-state.js";

// Milestone 11.3.2 -- the "(b)" mapping `proposal-truth.ts`'s header comment
// forward-referenced: `OverlayEntityProvenance -> per-entity visual
// provenance`. Generic and renderer-neutral, like the rest of this package:
// nothing here imports `@rvs/change-workbench` or knows that
// `OverlayEntityProvenance` exists. `@rvs/proposal-review` (the only package
// authorized to hold that Workbench-facing knowledge) maps
// `OverlayEntityProvenance` values onto `ProposalEntityProvenance` by value,
// one literal to the identically-spelled literal, and calls
// `resolveProposalEntityProvenance` on the result.
//
// This is a presentation *resolver*, not an evaluator: it is a pure lookup
// over four fixed literals, never proposal-, topology-, or freshness-aware,
// and it never decides whether a proposal is valid, current, or observed --
// that is `ProposalTruthDisclosure`'s job (see proposal-truth.ts), passed
// through unchanged by callers, never reconstructed here.

/** Mirrors `OverlayEntityProvenance`'s four values by spelling, not by import. */
export const PROPOSAL_ENTITY_PROVENANCE_VALUES = ["confirmed", "proposed", "modified", "removed"] as const;
export type ProposalEntityProvenance = (typeof PROPOSAL_ENTITY_PROVENANCE_VALUES)[number];

export interface ProposalEntityProvenancePresentation {
  provenance: ProposalEntityProvenance;
  /**
   * The lifecycle-layer `VisualState`(s) a future composition step should
   * combine in when it eventually resolves this entity's full
   * `ResolvedVisualState` via `resolveVisualState()`. Deliberately never
   * calls `resolveVisualState()` itself -- composing lifecycle state with an
   * entity's other independent layers (governance, confidence, interaction,
   * availability) is a downstream concern this milestone does not implement.
   * Empty for "confirmed": an entity this proposal leaves untouched needs no
   * lifecycle marker at all.
   */
  visual_state: readonly VisualState[];
  /**
   * The lifecycle layer only ever sets a `marker` (see visual-state.ts),
   * never a `badge` -- so this proposal-basis qualifier claims the `badge`
   * channel precisely because nothing else in the resolved state is using
   * it. Absent for "confirmed", which needs no qualifier.
   */
  badge?: string;
  /** Screen-reader-appropriate phrase; never colour, shape, or icon alone. */
  accessible_term: string;
  /** Reused verbatim from `OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING` -- never restated or paraphrased. */
  truth_basis: string;
  /**
   * Non-colour channels distinguishing this presentation, in the shape
   * `validateColorIndependence` (accessibility.ts) expects. Empty for
   * "confirmed", which is the unmarked/ordinary case and carries no state to
   * validate independence for.
   */
  non_color_channels: readonly string[];
}

const PROPOSED_BADGE = "Proposed addition — not observed";
const MODIFIED_BADGE = "Proposed change — not observed";
const REMOVED_BADGE = "Proposed removal — not observed";

const PROPOSAL_ENTITY_PROVENANCE_PRESENTATION: Readonly<Record<ProposalEntityProvenance, ProposalEntityProvenancePresentation>> = {
  confirmed: {
    provenance: "confirmed",
    visual_state: [],
    accessible_term: "unchanged in this proposal",
    truth_basis: OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.confirmed,
    non_color_channels: [],
  },
  proposed: {
    provenance: "proposed",
    visual_state: ["added"],
    badge: PROPOSED_BADGE,
    accessible_term: "proposed addition, not observed",
    truth_basis: OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.proposed,
    non_color_channels: [PROPOSED_BADGE],
  },
  modified: {
    provenance: "modified",
    visual_state: ["changed"],
    badge: MODIFIED_BADGE,
    accessible_term: "observed, with a proposed change not yet observed",
    truth_basis: OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.modified,
    non_color_channels: [MODIFIED_BADGE],
  },
  removed: {
    provenance: "removed",
    visual_state: ["removed"],
    badge: REMOVED_BADGE,
    accessible_term: "observed, with a proposed removal not yet observed",
    truth_basis: OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.removed,
    non_color_channels: [REMOVED_BADGE],
  },
} as const;

/** Pure lookup; the same input always yields the identical (by reference) presentation. */
export function resolveProposalEntityProvenance(provenance: ProposalEntityProvenance): ProposalEntityProvenancePresentation {
  return PROPOSAL_ENTITY_PROVENANCE_PRESENTATION[provenance];
}
