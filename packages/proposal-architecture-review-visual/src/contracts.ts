// Public output types for @rvs/proposal-architecture-review-visual
// (Milestone 11.3.3.2B).
//
// North star: adapt one `ProposalArchitectureReviewModel`
// (@rvs/proposal-architecture-review) into three visually distinct
// surfaces without collapsing their semantic differences:
//
//   - Observed Baseline -- an ordinary `VisualGraphModel`, no per-entity
//     proposal markers. Confirmed current architecture, presented exactly
//     as any other architecture visualization would be.
//   - Proposed Delta    -- an ordered list of operation cards, one per
//     `ProposalOperation`, in the caller's exact original order. Never
//     graph-shaped (§4/§13 of this milestone's authorization).
//   - Projected State   -- a `VisualGraphModel` only when the upstream
//     projection outcome is `"built"`; every entity/edge in it carries an
//     explicit `confirmed`/`proposed`/`modified` provenance marker.
//     `"removed"` entities are absent from this graph by construction, not
//     hidden by a marker. When the outcome is `"not_built"`, this surface
//     is a `{ status: "not_built"; reason }` value, never a fabricated
//     empty graph.
//
// `truth_disclosure`, `baseline_binding`, and `advisory` pass through from
// `ProposalArchitectureReviewModel` unmodified -- this package computes no
// new truth-status, evidentiary, or advisory judgment of its own.

import type { ProjectedStateOutcome, ProposalArchitectureReviewAdvisory, ProposalArchitectureReviewBaselineBinding, ProposalArchitectureReviewTruthDisclosure } from "@rvs/proposal-architecture-review";
import type { VisualGraphModel } from "@rvs/visual-intelligence";

/**
 * `ProposalOperationKind`/`OverlayBuildResult` are real `@rvs/change-workbench`
 * types, but this package's dependency boundary (§8 of this milestone's
 * authorization) forbids depending on `@rvs/change-workbench` directly --
 * only `@rvs/proposal-architecture-review`, `@rvs/visual-intelligence`,
 * `@rvs/visual-grammar`, and `@rvs/visual-composition` are allowed. Both
 * are instead recovered by indexed access into the already-permitted
 * `ProjectedStateOutcome`/`ProposalArchitectureReviewModel["proposed_delta"]`
 * shapes, so the type authority stays singular (an upstream shape change
 * still flows through automatically) without widening the dependency DAG.
 */
type BuiltProjection = Extract<ProjectedStateOutcome, { status: "built" }>;
export type OverlayBuildResult = BuiltProjection["result"];
export type ProposalOperationKind = "add_entity" | "remove_entity" | "modify_attributes" | "add_relation" | "remove_relation" | "modify_relation";

export const PROPOSAL_ARCHITECTURE_REVIEW_VISUAL_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Projected State
// ---------------------------------------------------------------------------

/**
 * Mirrors `ChangeWorkbenchProjectionOutcome`'s `built`/`not_built`
 * discriminant exactly -- a `"built"` outcome whose graph happens to be
 * empty (e.g. every proposed entity was itself removed) remains
 * structurally distinct from `"not_built"` (projection was never
 * attempted). Never collapsed into one another; see adapt-projected.ts.
 */
export type ProjectedStateVisualPresentation = { status: "built"; model: VisualGraphModel } | { status: "not_built"; reason: string };

// ---------------------------------------------------------------------------
// Proposed Delta operation cards -- one discriminated variant per
// `ProposalOperationKind`, carrying exactly the presentation facts each
// kind can support without fabricating any (see delta.ts).
// ---------------------------------------------------------------------------

/**
 * Where an operation card's endpoint/subject label came from.
 * `resolved_baseline`  -- looked up from the confirmed Observed Baseline.
 * `resolved_proposed`  -- looked up from this same proposal's own
 *   `add_entity` operations (a `ProposedEntityRef` this proposal itself
 *   introduces).
 * `unresolved`         -- looked up and not found in either place; the
 *   card discloses this explicitly rather than guessing or omitting the
 *   field.
 */
export type EntityLookupSource = "resolved_baseline" | "resolved_proposed" | "unresolved";

export interface EntityBaselineLookup {
  ref: string;
  source: EntityLookupSource;
  /** Present only when `source !== "unresolved"`. */
  label?: string;
  node_type?: string;
}

/** A single before/after field comparison, restricted to the fields `@rvs/change-workbench`'s attribute-support model documents as recoverable (`label`/`evidence_refs` for nodes, `detail` for edges) -- see delta.ts. */
export interface AttributeValueComparison {
  key: string;
  status: "supported" | "unsupported" | "unresolved";
  before?: unknown;
  after?: unknown;
  detail: string;
}

export interface AddEntityDeltaCard {
  kind: "add_entity";
  id: string;
  operation_index: number;
  ref: string;
  node_type: string;
  label: string;
}

export interface RemoveEntityDeltaCard {
  kind: "remove_entity";
  id: string;
  operation_index: number;
  subject: EntityBaselineLookup;
  detail?: string;
}

export interface ModifyAttributesDeltaCard {
  kind: "modify_attributes";
  id: string;
  operation_index: number;
  subject: EntityBaselineLookup;
  changes: AttributeValueComparison[];
}

export interface AddRelationDeltaCard {
  kind: "add_relation";
  id: string;
  operation_index: number;
  from: EntityBaselineLookup;
  to: EntityBaselineLookup;
  edge_type: string;
  detail?: string;
}

export interface RemoveRelationDeltaCard {
  kind: "remove_relation";
  id: string;
  operation_index: number;
  from: EntityBaselineLookup;
  to: EntityBaselineLookup;
  edge_type: string;
  detail?: string;
}

export interface ModifyRelationDeltaCard {
  kind: "modify_relation";
  id: string;
  operation_index: number;
  from: EntityBaselineLookup;
  to: EntityBaselineLookup;
  edge_type: string;
  changes: AttributeValueComparison[];
}

export type DeltaOperationCard = AddEntityDeltaCard | RemoveEntityDeltaCard | ModifyAttributesDeltaCard | AddRelationDeltaCard | RemoveRelationDeltaCard | ModifyRelationDeltaCard;

// ---------------------------------------------------------------------------
// Top-level composed output
// ---------------------------------------------------------------------------

export interface ProposalArchitectureVisualReview {
  schema_version: number;
  id: string;
  repository_id: string;
  proposal_id: string;
  /** The exact `ProposalArchitectureReviewModel.id` this review was adapted from -- never re-derived. */
  source_proposal_architecture_review_model_id: string;
  observed_baseline: { model: VisualGraphModel };
  proposed_delta: { operations: DeltaOperationCard[] };
  projected_state: ProjectedStateVisualPresentation;
  truth_disclosure: ProposalArchitectureReviewTruthDisclosure;
  baseline_binding: ProposalArchitectureReviewBaselineBinding;
  advisory: ProposalArchitectureReviewAdvisory;
}
