// Deterministic identity for this package's own two new id kinds: the
// review itself and its Proposed Delta operation cards. Both reuse
// @rvs/visual-intelligence's existing `sanitize()` -- there is no second id
// algorithm here, matching every other adapter in the repository
// (Milestone 11.3.3.2B, §42/§4.1).
//
// Operation-card identity is a pure function of the proposal's own id, the
// operation's position in `ProposedChangeSet.operations`, and its kind --
// never `Date.now`/`Math.random`/`randomUUID`, and never a claim that the
// operation index is architecture entity identity (see delta.ts).

import { sanitize } from "@rvs/visual-intelligence";

export function buildProposalArchitectureVisualReviewId(sourceModelId: string): string {
  return `proposal-architecture-review-visual:review:${sanitize(sourceModelId)}`;
}

export function buildDeltaOperationCardId(proposalId: string, operationIndex: number, kind: string): string {
  return `proposal-architecture-review-visual:operation:${sanitize(proposalId)}:${operationIndex}:${sanitize(kind)}`;
}
