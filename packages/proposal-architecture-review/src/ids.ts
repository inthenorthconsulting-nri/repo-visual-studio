// Deterministic identity for @rvs/proposal-architecture-review (Milestone
// 11.3.3.1). Mirrors @rvs/proposal-review's ids.ts convention: small
// deterministic-id utilities are duplicated locally per repository
// convention rather than cross-imported, and identity is a composite of
// canonical source identifiers -- never a hash of the entire serialized
// model, which would make identity depend on downstream presentation
// choices this package does not make.
//
// Identity basis (per Milestone 11.3.3.1's task authorization): the source
// `ProposalReviewVisualInput.id`, `repository_id`, `proposal_id`,
// `base_snapshot_digest`, and `observed_baseline_snapshot_id`. All five are
// already-bound upstream identifiers -- this composer re-derives none of
// them, only concatenates them deterministically. No clock, no random
// UUID, no filesystem state, no rendering/layout/audience parameter, no
// environment-dependent value.

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function buildProposalArchitectureReviewModelId(
  sourceProposalReviewVisualInputId: string,
  repositoryId: string,
  proposalId: string,
  baseSnapshotDigest: string,
  observedBaselineSnapshotId: string,
): string {
  return `proposal-architecture-review:model:${sanitize(sourceProposalReviewVisualInputId)}:${sanitize(repositoryId)}:${sanitize(proposalId)}:${sanitize(baseSnapshotDigest.slice(0, 16))}:${sanitize(observedBaselineSnapshotId)}`;
}
