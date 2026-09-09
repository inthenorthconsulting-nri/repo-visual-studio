// Pure composer for @rvs/proposal-architecture-review (Milestone 11.3.3.1).
//
// Authority boundary: this package consumes `ProposalReviewVisualInput`
// verbatim. It computes NO proposal validation, overlay projection,
// advisory, or truth disclosure of its own -- see contracts.ts's header
// comment for the full surface-by-surface provenance. It re-binds nothing
// @rvs/proposal-review has already bound: no `evaluateProposedChange`, no
// `buildChangeOverlay`, no `buildChangeAdvisory`, no `buildGraphSnapshot`,
// no `ChangeReviewModel`/`buildReviewAssembly`. See
// __tests__/forbidden-authority-calls.test.ts for the static proof.
//
// Purity: deterministic, fs-free, network-free, cache-free,
// environment-independent. The composed model depends only on `input`.

import type { ProposalReviewVisualInput } from "@rvs/proposal-review";
import { PROPOSAL_ARCHITECTURE_REVIEW_SCHEMA_VERSION, type ProposalArchitectureReviewModel } from "./contracts.js";
import { buildProposalArchitectureReviewModelId } from "./ids.js";

export function composeProposalArchitectureReviewModel(input: ProposalReviewVisualInput): ProposalArchitectureReviewModel {
  const id = buildProposalArchitectureReviewModelId(
    input.id,
    input.repository_id,
    input.proposal_id,
    input.base_snapshot_digest,
    input.observed_baseline_snapshot_id,
  );

  return {
    schema_version: PROPOSAL_ARCHITECTURE_REVIEW_SCHEMA_VERSION,
    id,
    repository_id: input.repository_id,
    proposal_id: input.proposal_id,
    source_proposal_review_visual_input_id: input.id,
    observed_baseline: input.observed_baseline_graph,
    proposed_delta: { operations: input.proposal.operations },
    projected_state: input.projection,
    truth_disclosure: input.truth_disclosure,
    baseline_binding: input.baseline_binding,
    advisory: input.advisory,
  };
}
