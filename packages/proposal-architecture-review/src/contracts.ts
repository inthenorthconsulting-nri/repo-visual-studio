// Public types for @rvs/proposal-architecture-review (Milestone 11.3.3.1).
//
// North star: compose one deterministic, pure proposal-architecture review
// model from a single canonical input, `ProposalReviewVisualInput`
// (@rvs/proposal-review), preserving three semantically distinct surfaces:
//
//   - Observed Baseline  -- confirmed current architecture, verbatim from
//     `input.observed_baseline_graph`.
//   - Proposed Delta     -- caller-authored intent, verbatim from
//     `input.proposal.operations`. Operation-shaped, never forced into a
//     graph model, never a snapshot.
//   - Projected State    -- deterministic proposal-derived simulation,
//     verbatim from `input.projection`. Never a `GraphSnapshot`. Never
//     acquires observed-snapshot semantics merely by being composed here.
//
// This package computes nothing new about proposal truth, baseline
// binding, advisory findings, or validation -- it consumes those verbatim
// from `ProposalReviewVisualInput` and republishes them under this
// composition's own identity. See compose.ts's header comment for the
// full authority boundary and ids.ts for this composition's deterministic
// identity basis.
//
// Dependency boundary: this package's only production dependency is
// @rvs/proposal-review. Every type below that originates upstream
// (`ObservedBaselineGraph`, `ProposalOperations`, `ProjectedStateOutcome`,
// `ProposalArchitectureReviewTruthDisclosure`, `ProposalArchitectureReviewBaselineBinding`,
// `ProposalArchitectureReviewAdvisory`) is declared as an indexed-access
// alias into `ProposalReviewVisualInput` itself, not re-declared from
// @rvs/change-workbench/@rvs/knowledge-graph/@rvs/visual-intelligence --
// this keeps the type authority singular (upstream shape changes flow
// through automatically) without widening this package's dependency DAG.

import type { ProposalReviewVisualInput } from "@rvs/proposal-review";

/** Observed Baseline's own structural content -- verbatim `input.observed_baseline_graph`. See adapter.ts (@rvs/proposal-review) for why this carries no separate identity from `observed_baseline_snapshot_id`/`base_snapshot_digest`. */
export type ObservedBaselineGraph = ProposalReviewVisualInput["observed_baseline_graph"];

/** The six frozen `ProposalOperation` primitives, verbatim `input.proposal.operations` -- never re-shaped into a graph, never reordered (operation index is load-bearing: `ProposalValidationIssue.operation_index` / `OverlayBuildIssue.operation_index` reference positions in this exact array). */
export type ProposalOperations = ProposalReviewVisualInput["proposal"]["operations"];

/** Preserves the upstream `built`/`not_built` discriminant verbatim -- see `ProposalReviewVisualInput.projection`'s own doc comment. A `"built"` outcome with an empty overlay remains structurally distinct from `"not_built"` by this outer discriminant alone; this package fabricates neither state. */
export type ProjectedStateOutcome = ProposalReviewVisualInput["projection"];

export type ProposalArchitectureReviewTruthDisclosure = ProposalReviewVisualInput["truth_disclosure"];
export type ProposalArchitectureReviewBaselineBinding = ProposalReviewVisualInput["baseline_binding"];
export type ProposalArchitectureReviewAdvisory = ProposalReviewVisualInput["advisory"];

export const PROPOSAL_ARCHITECTURE_REVIEW_SCHEMA_VERSION = 1;

/**
 * Proposed Delta surface: operation-shaped, never a `VisualGraphModel`.
 * `operations` is the exact `input.proposal.operations` array reference --
 * this first slice performs no enrichment, no grouping, no re-labeling.
 * A later visual-composition slice may add a purely-joined presentation
 * projection on top of this without changing what this type means.
 */
export interface ProposedDeltaSurface {
  operations: ProposalOperations;
}

/**
 * The composed proposal-architecture review model: one
 * `ProposalReviewVisualInput`, republished as three semantically distinct
 * surfaces plus its truth/binding/advisory context, all carried through
 * unmodified. `advisory`, `truth_disclosure`, and `baseline_binding` are
 * NOT merged into one generalized "trust"/"confidence" field -- each
 * remains its own axis, exactly as `ProposalReviewVisualInput` documents.
 *
 * `observed_baseline` and `projected_state` may later be adapted into
 * visual graph models by a downstream composition slice; `proposed_delta`
 * remains operation-shaped by design (see this file's header comment) --
 * the visual layer adapts to this truth model, this model does not distort
 * itself to simplify rendering.
 */
export interface ProposalArchitectureReviewModel {
  schema_version: number;
  id: string;
  repository_id: string;
  proposal_id: string;
  /** The exact `ProposalReviewVisualInput.id` this model was composed from -- the authoritative reference back to its source, never re-derived. */
  source_proposal_review_visual_input_id: string;
  observed_baseline: ObservedBaselineGraph;
  proposed_delta: ProposedDeltaSurface;
  projected_state: ProjectedStateOutcome;
  truth_disclosure: ProposalArchitectureReviewTruthDisclosure;
  baseline_binding: ProposalArchitectureReviewBaselineBinding;
  advisory: ProposalArchitectureReviewAdvisory;
}
