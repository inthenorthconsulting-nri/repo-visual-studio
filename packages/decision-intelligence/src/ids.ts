// Mirrors @rvs/governance-intelligence/src/ids.ts: every id below is a pure
// function of stable inputs only -- content already present in the decision
// documents/artifacts being discovered, linked, or compared. Never a
// timestamp, never a wall-clock generation time, never an array/iteration
// index. Two decision-intelligence runs over the identical input state must
// produce byte-identical ids so that snapshot/change-set/link/finding/plan
// comparisons are themselves deterministic.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function buildDecisionId(preferredIdentity: string): string {
  return `decision:${sanitize(preferredIdentity)}`;
}

export function buildDecisionSourceId(repoRelativePath: string): string {
  return `decision:source:${sanitize(repoRelativePath)}`;
}

export function buildDecisionSourceIssueId(kind: string, affectedPathsSorted: string[]): string {
  return `decision:source-issue:${sanitize(kind)}:${affectedPathsSorted.map(sanitize).join(".")}`;
}

export function buildAssumptionId(decisionId: string, assumptionKey: string): string {
  return `decision:assumption:${sanitize(decisionId)}:${sanitize(assumptionKey)}`;
}

export function buildConsequenceId(decisionId: string, consequenceKey: string): string {
  return `decision:consequence:${sanitize(decisionId)}:${sanitize(consequenceKey)}`;
}

export function buildAlternativeId(decisionId: string, alternativeKey: string): string {
  return `decision:alternative:${sanitize(decisionId)}:${sanitize(alternativeKey)}`;
}

export function buildLinkId(decisionId: string, linkType: string, targetIdOrKey: string): string {
  return `decision:link:${sanitize(decisionId)}:${sanitize(linkType)}:${sanitize(targetIdOrKey)}`;
}

export function buildDependencyId(fromDecisionId: string, dependencyType: string, toDecisionId: string): string {
  return `decision:dependency:${sanitize(fromDecisionId)}:${sanitize(dependencyType)}:${sanitize(toDecisionId)}`;
}

export function buildDependencyCycleId(decisionIdsSorted: string[]): string {
  return `decision:dependency-cycle:${decisionIdsSorted.map(sanitize).join(".")}`;
}

export function buildSupersessionIssueId(kind: string, decisionIdsSorted: string[]): string {
  return `decision:supersession-issue:${sanitize(kind)}:${decisionIdsSorted.map(sanitize).join(".")}`;
}

export function buildSupersessionChainId(decisionIdsInOrder: string[]): string {
  return `decision:supersession-chain:${decisionIdsInOrder.map(sanitize).join(".")}`;
}

export function buildConflictId(decisionAId: string, decisionBId: string, kind: string): string {
  const [first, second] = [decisionAId, decisionBId].sort();
  return `decision:conflict:${sanitize(kind)}:${sanitize(first)}:${sanitize(second)}`;
}

export function buildCoverageMetricId(dimension: string): string {
  return `decision:coverage:${sanitize(dimension)}`;
}

export function buildImplementationStateId(decisionId: string): string {
  return `decision:implementation-state:${sanitize(decisionId)}`;
}

export function buildMissingDecisionFindingId(ruleKind: string, affectedEntityId: string): string {
  return `decision:missing-decision:${sanitize(ruleKind)}:${sanitize(affectedEntityId)}`;
}

export function buildMissingImplementationFindingId(decisionId: string): string {
  return `decision:missing-implementation:${sanitize(decisionId)}`;
}

export function buildDriftId(decisionId: string, cause: string): string {
  return `decision:drift:${sanitize(decisionId)}:${sanitize(cause)}`;
}

export function buildDebtFindingId(category: string, decisionId: string): string {
  return `decision:debt:${sanitize(category)}:${sanitize(decisionId)}`;
}

export function buildBlastRadiusAssessmentId(decisionId: string): string {
  return `decision:blast-radius:${sanitize(decisionId)}`;
}

export function buildSnapshotId(repositoryId: string, decisionDigestsSorted: string[]): string {
  return `decision:snapshot:${sanitize(repositoryId)}:${decisionDigestsSorted.map(sanitize).join(".")}`;
}

export function buildChangeSetId(sourceSnapshotId: string, targetSnapshotId: string): string {
  return `decision:changeset:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildChangeId(decisionId: string, changeType: string): string {
  return `decision:change:${sanitize(changeType)}:${sanitize(decisionId)}`;
}

export function buildClaimId(claimType: string, subjectDecisionId: string): string {
  return `decision:claim:${sanitize(claimType)}:${sanitize(subjectDecisionId)}`;
}

export function buildNarrativeId(sourceSnapshotId: string, targetSnapshotId?: string): string {
  return `decision:narrative:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId ?? "none")}`;
}

export function buildPlanId(snapshotId: string): string {
  return `decision:plan:${sanitize(snapshotId)}`;
}

export function buildSceneId(planId: string, kind: string): string {
  return `decision:scene:${sanitize(planId)}:${sanitize(kind)}`;
}

export function buildReportId(snapshotId: string): string {
  return `decision:report:${sanitize(snapshotId)}`;
}

export { sanitize };
