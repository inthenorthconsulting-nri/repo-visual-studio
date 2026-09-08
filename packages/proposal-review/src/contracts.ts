// Public types for @rvs/proposal-review (Milestone 11.3.1).
//
// North star: bind Milestone 11.3.1A's canonical `ChangeWorkbenchEvaluation`
// envelope together with an explicit observed baseline (`GraphSnapshot`, a
// caller-supplied `@rvs/knowledge-graph` snapshot -- never re-derived here)
// and an explicit caller-supplied freshness qualification into one
// proposal-review visual input. This package computes no proposal
// validation, overlay projection, impact/governance/decision advisory, or
// topology disclosure of its own -- see adapter.ts's header comment for the
// full authority boundary. It sits between @rvs/change-workbench and
// @rvs/visual-intelligence in the package DAG; neither of those two
// packages depends on this one or on each other.
//
// Naming: `ProposalReviewVisualInput`, not `...Artifact` or
// `...FidelityReceipt`. No rendering, adaptation, or fidelity-accounting
// stage has run over this binding -- `@rvs/visual-intelligence`'s
// `FidelityReceipt` (fidelity.ts) answers "did adaptation preserve the
// entity set", a question that presupposes a renderer already ran. Nothing
// here has rendered anything, so no `FidelityReceipt` is fabricated or
// implied; `ProposalReviewVisualInput` is data that a future renderer
// consumes, not a claim that rendering already happened.

import type { ChangeAdvisory, ChangeWorkbenchProjectionOutcome, ProposalValidationResult, ProposedChangeSet } from "@rvs/change-workbench";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { ProposalTruthDisclosure } from "@rvs/visual-intelligence";

/**
 * The observed baseline's own structural content -- the `GraphSnapshot`
 * (`observed_baseline_snapshot_id`/`base_snapshot_digest` above) already
 * carries that snapshot's identity and compatibility digest; this type adds
 * no second identity, only the node/edge content a composition stage needs
 * for the "before" state of a modified/removed entity or relation, which
 * `proposal_validation`, `projection`, and `advisory` do not carry (a
 * `ChangeOverlay`'s `nodes`/`edges` reflect only the post-proposal state; a
 * `"removed"` id is structurally absent from them; a `"modified"` id's
 * pre-proposal value is unrecoverable from them). See adapter.ts for the
 * node/edge-count AND recomputed-digest (via `buildGraphSnapshot()`) hard-
 * failure checks against this same `GraphSnapshot` -- the digest check is
 * the authoritative content binding; node/edge-count is a cheap additional
 * sanity check, not the sole one. The digest check proves node/edge
 * *identity* correspondence (`KnowledgeNode.id`/`KnowledgeEdge.id`), not
 * full attribute-content correspondence -- `GraphSnapshot.digest` itself
 * does not cover node/edge attributes, and this type does not invent a
 * stricter notion than the one `@rvs/knowledge-graph` owns.
 */
export interface ProposalReviewObservedBaselineGraph {
  nodes: readonly KnowledgeNode[];
  edges: readonly KnowledgeEdge[];
}

export const PROPOSAL_REVIEW_SCHEMA_VERSION = 1;

/** A structural or cross-source problem that prevents binding a `ProposalReviewVisualInput` -- never a stand-in for a Workbench-domain validation/overlay issue, which stay on `proposal_validation`/`projection` respectively. */
export interface ProposalReviewInputIssue {
  code: string;
  detail: string;
}

/**
 * The proposal-review visual input: one `ChangeWorkbenchEvaluation`,
 * consumed verbatim, plus the observed-baseline identity it was checked
 * against and the deterministic `ProposalTruthDisclosure` this package
 * built from it.
 *
 * `proposal_validation`, `projection`, and `advisory` are the evaluation's
 * own fields, carried through unmodified -- never recomputed, never
 * flattened, never merged with each other. In particular `projection`
 * retains its own `OverlayBuildResult.issues` exactly as
 * `evaluateProposedChange()` produced them, kept structurally distinct from
 * `proposal_validation.issues`; and a `projection.status === "not_built"`
 * evaluation is never presented here as an empty `"built"` overlay.
 * `advisory` (including `advisory.topology`, `advisory.impact`,
 * `advisory.governance`, `advisory.decisions`) remains the sole authority
 * for every domain it covers -- this type adds no competing judgment.
 */
export interface ProposalReviewVisualInput {
  schema_version: number;
  id: string;
  repository_id: string;
  proposal_id: string;
  base_snapshot_digest: string;
  /** The `GraphSnapshot.id` of the observed baseline this binding was checked against -- see adapter.ts's hard-failure compatibility check. */
  observed_baseline_snapshot_id: string;
  /** The observed baseline's own node/edge content. See `ProposalReviewObservedBaselineGraph`'s own doc comment for why this carries no separate identity. */
  observed_baseline_graph: ProposalReviewObservedBaselineGraph;
  proposal_validation: ProposalValidationResult;
  projection: ChangeWorkbenchProjectionOutcome;
  advisory: ChangeAdvisory;
  /** Built by `@rvs/visual-intelligence`'s `buildProposalTruthDisclosure()` -- reused, never reimplemented. */
  truth_disclosure: ProposalTruthDisclosure;
  /**
   * The exact caller-authored proposal this evaluation was computed from,
   * consumed verbatim -- never recomputed, never re-derived from
   * `proposal_validation`/`projection`/`advisory`. Bound to
   * `evaluation.proposal_id`/`evaluation.repository_id` by a hard-failure
   * consistency check AND, cryptographically, to its own `operations` by a
   * recomputed-id check via `buildProposedChangeSetId()` (see adapter.ts's
   * header comment for exactly what this proves and does not prove). A
   * future composition stage reads `proposal.operations` for exact
   * operation-level facts (kind, per-operation `evidence_refs`, `detail`
   * text) that provenance alone cannot reconstruct -- e.g.
   * `proposal_validation`/`projection`/`advisory` can say an entity is
   * `"modified"` but not which attributes the caller explicitly changed;
   * `ModifyAttributesOperation.attributes` can.
   */
  proposal: ProposedChangeSet;
}

/**
 * Mirrors `@rvs/change-workbench`'s `ProposedChangeSetDecodeResult` shape
 * (decode.ts): a structured "ok"/"rejected" result, never a thrown
 * exception, so a caller can inspect every reason a binding was refused.
 */
export type ProposalReviewVisualInputResult = { status: "ok"; input: ProposalReviewVisualInput } | { status: "rejected"; issues: ProposalReviewInputIssue[] };
