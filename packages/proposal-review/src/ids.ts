// Mirrors @rvs/change-workbench/src/ids.ts and @rvs/visual-intelligence/src/ids.ts:
// small deterministic-id utilities are duplicated locally per repository
// convention rather than cross-imported, even though this package already
// has real runtime dependencies on both packages for other reasons.

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

/**
 * Identity for a `ProposalReviewVisualInput`: a pure function of the
 * evaluation's own repository/proposal/baseline identity plus the truth
 * disclosure id it binds in (itself already a pure function of topology
 * disclosure status and advisory freshness -- see
 * @rvs/visual-intelligence's `buildProposalTruthDisclosureId`). Two
 * bindings can only share an id when every one of those inputs is
 * byte-identical; never a timestamp, never wall-clock generation time.
 */
export function buildProposalReviewVisualInputId(repositoryId: string, proposalId: string, baseSnapshotDigest: string, truthDisclosureId: string): string {
  return `proposal-review:input:${sanitize(repositoryId)}:${sanitize(proposalId)}:${sanitize(baseSnapshotDigest.slice(0, 16))}:${sanitize(truthDisclosureId)}`;
}
