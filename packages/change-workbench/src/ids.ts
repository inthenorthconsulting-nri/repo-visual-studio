// Mirrors @rvs/knowledge-graph/src/ids.ts (which itself mirrors
// @rvs/decision-intelligence/src/ids.ts) -- small deterministic-id/
// canonicalization utilities are duplicated locally per repository
// convention rather than cross-imported, even though this package already
// has a real runtime dependency on @rvs/knowledge-graph for other reasons.

import { createHash } from "node:crypto";

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

/** Recursive key-sorting for deterministic JSON. Preserves array order -- only object key order is normalized. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) result[key] = canonicalize((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

export function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/**
 * Shuffle-invariant: `operations` is canonicalized element-by-element and
 * then the resulting list is itself sorted before digesting, so two
 * `ProposedChangeSet`s carrying the exact same operations in different
 * array order produce byte-identical ids. (`canonicalize()` alone only
 * normalizes object key order within each element -- it deliberately
 * preserves array order, so the outer sort here is what makes the
 * proposal's own identity independent of operation order.)
 */
export function buildProposedChangeSetId(repositoryId: string, operations: unknown[]): string {
  const sortedCanonicalOperations = operations.map((operation) => canonicalize(operation)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return `change-workbench:proposal:${sanitize(repositoryId)}:${digestOf(sortedCanonicalOperations).slice(0, 16)}`;
}

export function buildChangeAdvisoryId(proposalId: string, baseSnapshotDigest: string): string {
  return `change-workbench:advisory:${sanitize(proposalId)}:${baseSnapshotDigest.slice(0, 16)}`;
}

export function buildProposedEntityRefId(proposalScope: string, localId: string): string {
  return `change-workbench:proposed-entity:${sanitize(proposalScope)}:${sanitize(localId)}`;
}

export function buildSyntheticEdgeId(fromNodeId: string, toNodeId: string, edgeType: string): string {
  return `change-workbench:proposed-edge:${sanitize(fromNodeId)}:${sanitize(edgeType)}:${sanitize(toNodeId)}`;
}
