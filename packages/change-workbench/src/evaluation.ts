// The canonical Workbench evaluation entry point (Milestone 11.3.1A). See
// contracts.ts's ChangeWorkbenchEvaluation header comment for the envelope
// shape and why it is a sibling to ChangeAdvisory rather than an extension
// of it. This module owns no domain logic of its own -- it orchestrates
// validateProposedChangeSet() (validation.ts), buildChangeOverlay()
// (overlay.ts) and buildChangeAdvisoryFromEvaluationInputs()
// (change-advisory.ts), calling validation and overlay construction exactly
// once each and reusing those results for both the projection outcome and
// the advisory. Downstream integrations -- including a future
// proposal-review visual adapter -- should consume evaluateProposedChange()
// rather than separately invoking proposal validation, overlay construction
// and advisory generation to reconstruct the same result; this package
// remains visual-agnostic and imports nothing from any visual-* package to
// say so.

import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { DecisionStateLookup } from "@rvs/knowledge-graph";
import type { EvaluatePolicyInput } from "@rvs/governance-intelligence";
import type { ChangeWorkbenchEvaluation, ChangeWorkbenchProjectionOutcome, ProposedChangeSet } from "./contracts.js";
import { CHANGE_WORKBENCH_SCHEMA_VERSION } from "./constants.js";
import { validateProposedChangeSet } from "./validation.js";
import { buildChangeOverlay } from "./overlay.js";
import { buildChangeAdvisoryFromEvaluationInputs } from "./change-advisory.js";

export interface EvaluateProposedChangeParams {
  changeSet: ProposedChangeSet;
  confirmedNodes: readonly KnowledgeNode[];
  confirmedEdges: readonly KnowledgeEdge[];
  baseSnapshotDigest: string;
  maxImpactDepth?: number;
  decisionStateLookup?: DecisionStateLookup;
  governanceEvaluationInput?: EvaluatePolicyInput;
}

/**
 * Evaluates a proposal exactly once: validateProposedChangeSet() is called
 * exactly once, buildChangeOverlay() is called at most once (never for an
 * invalid proposal), and both results are reused -- never replayed -- to
 * build the projection outcome (with overlay-build issues preserved
 * verbatim) and the ChangeAdvisory it returns alongside them.
 */
export function evaluateProposedChange(params: EvaluateProposedChangeParams): ChangeWorkbenchEvaluation {
  const { changeSet, confirmedNodes, confirmedEdges, baseSnapshotDigest, maxImpactDepth, decisionStateLookup, governanceEvaluationInput } = params;

  const proposalValidation = validateProposedChangeSet(changeSet, { confirmedNodes, confirmedEdges });

  const projection: ChangeWorkbenchProjectionOutcome =
    proposalValidation.status === "invalid"
      ? {
          status: "not_built",
          reason: "Proposal validation failed with a blocking issue; overlay construction was never attempted against an invalid proposal.",
        }
      : { status: "built", result: buildChangeOverlay({ changeSet, confirmedNodes, confirmedEdges, baseSnapshotDigest }) };

  const advisory = buildChangeAdvisoryFromEvaluationInputs({
    changeSet,
    baseSnapshotDigest,
    proposalValidation,
    overlayResult: projection.status === "built" ? projection.result : undefined,
    maxImpactDepth,
    decisionStateLookup,
    governanceEvaluationInput,
  });

  return {
    schema_version: CHANGE_WORKBENCH_SCHEMA_VERSION,
    repository_id: changeSet.repository_id,
    proposal_id: changeSet.id,
    base_snapshot_digest: baseSnapshotDigest,
    proposal_validation: proposalValidation,
    projection,
    advisory,
  };
}
