// The proposal-review visual adapter (Milestone 11.3.1).
//
// Authority boundary -- mandatory reading before calling or modifying this
// function: `buildProposalReviewVisualInput()` is a *binder*, not an
// evaluator. It calls zero @rvs/change-workbench evaluators
// (`evaluateProposedChange`, `validateProposedChangeSet`,
// `buildChangeOverlay`, `buildChangeAdvisory`/
// `buildChangeAdvisoryFromEvaluationInputs`, `buildImpactAdvisory`,
// `buildGovernanceAdvisory`, `buildDecisionAdvisory`) -- it only reads
// fields off an already-computed `ChangeWorkbenchEvaluation` the caller
// supplies, exactly the way evaluation.ts's own header comment invites a
// "future proposal-review visual adapter" to. Every `@rvs/change-workbench`
// import in this module is `import type` for that reason: there is
// structurally nothing here for a value import to call.
//
// It calls exactly one @rvs/visual-intelligence function that produces
// domain content: `buildProposalTruthDisclosure()`, reused rather than
// reimplemented, per that function's own Milestone 11.3.1 forward
// reference. Topology disclosure authority remains
// `evaluation.advisory.topology`, read and reduced only through that
// existing reducer -- never inferred from overlay issues, entity
// provenance, or entity/edge counts.
//
// Freshness is an explicit caller-supplied input (`advisoryFreshness`),
// never discovered, cached, or filesystem-probed by this module -- this
// package has no access to "what is the current baseline" the way
// @rvs/change-workbench's own `assessChangeAdvisoryFreshness()` does, and
// does not pretend otherwise.
//
// The observed baseline is an explicit caller-supplied `GraphSnapshot`
// (`@rvs/knowledge-graph`, never a new persisted architecture
// representation invented here). Baseline/evaluation `repository_id` and
// digest compatibility is a hard failure, not a warning: a caller cannot
// obtain a `ProposalReviewVisualInput` for an evaluation checked against a
// baseline this binding cannot independently confirm.

import type { ChangeWorkbenchEvaluation } from "@rvs/change-workbench";
import type { GraphSnapshot } from "@rvs/knowledge-graph";
import { buildProposalTruthDisclosure } from "@rvs/visual-intelligence";
import type { ProposalAdvisoryFreshness } from "@rvs/visual-intelligence";
import { PROPOSAL_REVIEW_SCHEMA_VERSION } from "./contracts.js";
import type { ProposalReviewInputIssue, ProposalReviewVisualInput, ProposalReviewVisualInputResult } from "./contracts.js";
import { buildProposalReviewVisualInputId } from "./ids.js";

export interface BuildProposalReviewVisualInputParams {
  /** The canonical Workbench evaluation envelope -- consumed verbatim, never recomputed. */
  evaluation: ChangeWorkbenchEvaluation;
  /** The observed baseline this evaluation was run against. Compatibility with `evaluation.repository_id`/`evaluation.base_snapshot_digest` is a hard failure on mismatch. */
  observedBaseline: GraphSnapshot;
  /** Caller-supplied, never computed here. Must be the result of the caller's own `assessChangeAdvisoryFreshness()` call against a current baseline, or `"unknown"` when no current baseline could be resolved at all. */
  advisoryFreshness: ProposalAdvisoryFreshness;
}

function issue(code: string, detail: string): ProposalReviewInputIssue {
  return { code, detail };
}

/**
 * Binds one `ChangeWorkbenchEvaluation` to one observed baseline and one
 * caller-supplied freshness qualification. Never recomputes proposal
 * validation, overlay projection, impact/governance/decision advisory, or
 * topology disclosure -- every one of those stays exactly what
 * `evaluation` already carries. The only content this function
 * constructs is the deterministic `ProposalTruthDisclosure` (via the
 * existing Milestone 11.3.0 builder) and this binding's own identity.
 */
export function buildProposalReviewVisualInput(params: BuildProposalReviewVisualInputParams): ProposalReviewVisualInputResult {
  const { evaluation, observedBaseline, advisoryFreshness } = params;
  const issues: ProposalReviewInputIssue[] = [];

  if (observedBaseline.repository_id !== evaluation.repository_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH",
        `Observed baseline repository_id "${observedBaseline.repository_id}" does not match evaluation repository_id "${evaluation.repository_id}".`,
      ),
    );
  }
  if (observedBaseline.digest !== evaluation.base_snapshot_digest) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH",
        `Observed baseline digest "${observedBaseline.digest}" does not match evaluation base_snapshot_digest "${evaluation.base_snapshot_digest}".`,
      ),
    );
  }
  // Defensive internal-consistency checks against a caller-supplied
  // `evaluation` that may not have actually come from
  // `evaluateProposedChange()` (e.g. a hand-constructed fixture or a value
  // that crossed a serialization boundary). `evaluateProposedChange()`
  // itself always derives `evaluation.advisory` from the same `changeSet`/
  // `baseSnapshotDigest` it stamps onto the envelope, so these three
  // fields are structurally guaranteed to agree for any genuine evaluation
  // -- a mismatch here means the envelope did not come from that function.
  if (evaluation.advisory.proposal_id !== evaluation.proposal_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_PROPOSAL_ID_INCONSISTENT",
        `evaluation.proposal_id "${evaluation.proposal_id}" does not match evaluation.advisory.proposal_id "${evaluation.advisory.proposal_id}".`,
      ),
    );
  }
  if (evaluation.advisory.repository_id !== evaluation.repository_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_REPOSITORY_ID_INCONSISTENT",
        `evaluation.repository_id "${evaluation.repository_id}" does not match evaluation.advisory.repository_id "${evaluation.advisory.repository_id}".`,
      ),
    );
  }
  if (evaluation.advisory.base_snapshot_digest !== evaluation.base_snapshot_digest) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_BASE_SNAPSHOT_DIGEST_INCONSISTENT",
        `evaluation.base_snapshot_digest "${evaluation.base_snapshot_digest}" does not match evaluation.advisory.base_snapshot_digest "${evaluation.advisory.base_snapshot_digest}".`,
      ),
    );
  }

  if (issues.length > 0) return { status: "rejected", issues };

  const truthDisclosure = buildProposalTruthDisclosure({
    repository_id: evaluation.repository_id,
    base_snapshot_digest: evaluation.base_snapshot_digest,
    proposal_id: evaluation.proposal_id,
    advisory_id: evaluation.advisory.id,
    topology: evaluation.advisory.topology,
    advisory_freshness: advisoryFreshness,
  });

  const input: ProposalReviewVisualInput = {
    schema_version: PROPOSAL_REVIEW_SCHEMA_VERSION,
    id: buildProposalReviewVisualInputId(evaluation.repository_id, evaluation.proposal_id, evaluation.base_snapshot_digest, truthDisclosure.id),
    repository_id: evaluation.repository_id,
    proposal_id: evaluation.proposal_id,
    base_snapshot_digest: evaluation.base_snapshot_digest,
    observed_baseline_snapshot_id: observedBaseline.id,
    proposal_validation: evaluation.proposal_validation,
    projection: evaluation.projection,
    advisory: evaluation.advisory,
    truth_disclosure: truthDisclosure,
  };

  return { status: "ok", input };
}
