// Mirrors @rvs/decision-intelligence/src/ids.ts: every id below is a pure
// function of stable inputs only -- never a timestamp, never a wall-clock
// generation time, never an array/iteration index. Two knowledge-graph
// builds over identical upstream artifact content must produce
// byte-identical ids so that snapshot/change-set/path/impact/root-cause
// comparisons are themselves deterministic.

import { createHash } from "node:crypto";

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

/** Recursively sorts object keys so JSON.stringify never depends on source key insertion order. Array element order is preserved -- callers are responsible for sorting arrays before digesting when order must not affect the digest. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

/** SHA-256 hex digest of a value's canonical (key-sorted) JSON string form. */
export function digestOf(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildNodeId(sourceEntityId: string): string {
  return `graph:node:${sanitize(sourceEntityId)}`;
}

export function buildEdgeId(edgeType: string, fromNodeId: string, toNodeId: string): string {
  return `graph:edge:${sanitize(fromNodeId)}:${sanitize(edgeType)}:${sanitize(toNodeId)}`;
}

export function buildPathId(fromNodeId: string, toNodeId: string, nodeIdsInOrder: string[]): string {
  return `graph:path:${sanitize(fromNodeId)}:${sanitize(toNodeId)}:${nodeIdsInOrder.map(sanitize).join(".")}`;
}

export function buildImpactResultId(rootEntityId: string, queryDigest: string): string {
  return `graph:impact:${sanitize(rootEntityId)}:${sanitize(queryDigest)}`;
}

export function buildRootCauseGroupId(rootNodeId: string): string {
  return `graph:root-cause:${sanitize(rootNodeId)}`;
}

export function buildDecisionImpactId(decisionNodeId: string, rootEntityId: string): string {
  return `graph:decision-impact:${sanitize(rootEntityId)}:${sanitize(decisionNodeId)}`;
}

export function buildChangePlanId(removedEntityId: string): string {
  return `graph:change-plan:${sanitize(removedEntityId)}`;
}

export function buildSnapshotId(repositoryId: string, sortedUpstreamDigestTokens: string[]): string {
  return `graph:snapshot:${sanitize(repositoryId)}:${sortedUpstreamDigestTokens.map(sanitize).join(".")}`;
}

export function buildChangeSetId(sourceSnapshotId: string, targetSnapshotId: string): string {
  return `graph:changeset:${sanitize(sourceSnapshotId)}:${sanitize(targetSnapshotId)}`;
}

export function buildNarrativeId(snapshotId: string): string {
  return `graph:narrative:${sanitize(snapshotId)}`;
}

export function buildPlanId(snapshotId: string): string {
  return `graph:plan:${sanitize(snapshotId)}`;
}

export function buildSceneId(planId: string, kind: string): string {
  return `graph:scene:${sanitize(planId)}:${sanitize(kind)}`;
}

export function buildReportId(snapshotId: string): string {
  return `graph:report:${sanitize(snapshotId)}`;
}

export function buildValidationFindingId(code: string, subjectId: string): string {
  return `graph:validation:${sanitize(code)}:${sanitize(subjectId)}`;
}

export { sanitize };
