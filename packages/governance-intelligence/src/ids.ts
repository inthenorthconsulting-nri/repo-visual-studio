// Mirrors @rvs/portfolio-intelligence/src/ids.ts: every id below is a pure
// function of stable inputs only -- content already present in the artifacts
// being snapshotted, diffed, or governed. Never a timestamp, never a
// wall-clock generation time, never an array/iteration index. Two governance
// runs over the identical input state must produce byte-identical ids so
// that snapshot/change-set/finding/plan comparisons are themselves
// deterministic.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function buildSnapshotId(repositoryId: string, artifactDigestsSorted: string[]): string {
  return `governance:snapshot:${sanitize(repositoryId)}:${artifactDigestsSorted.map(sanitize).join(".")}`;
}

export function buildBaselineId(snapshotId: string): string {
  return `governance:baseline:${sanitize(snapshotId)}`;
}

export function buildChangeSetId(domain: string, sourceSnapshotId: string, targetSnapshotId: string): string {
  return `governance:changeset:${sanitize(domain)}:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildChangeId(domain: string, changeType: string, entityStableId: string): string {
  return `governance:change:${sanitize(domain)}:${sanitize(changeType)}:${sanitize(entityStableId)}`;
}

export function buildEvidenceChangeId(changeType: string, sourceArtifact: string, evidencePath: string): string {
  return `governance:evidence-change:${sanitize(changeType)}:${sanitize(sourceArtifact)}:${sanitize(evidencePath)}`;
}

export function buildPolicyId(policyKey: string): string {
  return `governance:policy:${sanitize(policyKey)}`;
}

export function buildRuleId(policyId: string, ruleKey: string): string {
  return `governance:rule:${sanitize(policyId)}:${sanitize(ruleKey)}`;
}

export function buildEvaluationId(policyId: string, sourceSnapshotId: string, targetSnapshotId: string): string {
  return `governance:evaluation:${sanitize(policyId)}:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildFindingId(policyId: string, changeId: string): string {
  return `governance:finding:${sanitize(policyId)}:${sanitize(changeId)}`;
}

export function buildBlastRadiusEntryId(changeId: string): string {
  return `governance:blast-radius-entry:${sanitize(changeId)}`;
}

export function buildBlastRadiusAssessmentId(sourceSnapshotId: string, targetSnapshotId: string): string {
  return `governance:blast-radius:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildReportId(sourceSnapshotId: string, targetSnapshotId: string): string {
  return `governance:report:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildClaimId(claimType: string, subjectId: string): string {
  return `governance:claim:${sanitize(claimType)}:${sanitize(subjectId)}`;
}

export function buildNarrativeId(sourceSnapshotId: string, targetSnapshotId: string): string {
  return `governance:narrative:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildPlanId(reportId: string): string {
  return `governance:plan:${sanitize(reportId)}`;
}
