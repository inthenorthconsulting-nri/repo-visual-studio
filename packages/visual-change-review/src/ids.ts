import { sanitize, shortDigest } from "@rvs/visual-intelligence";

// Mirrors @rvs/visual-intelligence/src/ids.ts exactly: every id is a pure
// function of stable inputs only -- never a timestamp, never a wall-clock
// generation time, never an array index, never a render order, never a
// filesystem order. Five builds over identical evidence must produce
// byte-identical model ids, path ids, and finding ids, or §37's determinism
// proof is worthless.
//
// `sanitize`, `shortDigest`, `digestOf`, `canonicalize` and `normalizeIds`
// are re-exported from @rvs/visual-intelligence rather than re-implemented,
// so an id built here and an id built there cannot drift apart.

export { canonicalize, digestOf, normalizeIds, sanitize, shortDigest } from "@rvs/visual-intelligence";

export function buildChangeReviewId(fromSnapshotId: string, toSnapshotId: string, inputDigest: string): string {
  return `review:change:${sanitize(fromSnapshotId)}:${sanitize(toSnapshotId)}:${sanitize(inputDigest.slice(0, 16))}`;
}

/**
 * A change id for a change upstream did not name.
 *
 * Used only when upstream had no id of its own -- an entity that appears in
 * one snapshot's node set and not the other's is a change nobody wrote down,
 * and it still needs a stable handle. Built from the change type and the
 * entity, never from position, so the same difference gets the same id on
 * every run and in every ordering.
 */
export function buildDerivedChangeId(changeType: string, entityId: string): string {
  return `review:change-entry:${sanitize(changeType)}:${sanitize(entityId)}`;
}

export function buildReviewPathId(kind: string, entityIdsInOrder: readonly string[]): string {
  return `review:path:${sanitize(kind)}:${sanitize(shortDigest(entityIdsInOrder))}`;
}

export function buildUnresolvedImpactId(changeId: string, statement: string): string {
  return `review:unresolved:${sanitize(changeId)}:${sanitize(shortDigest(statement))}`;
}

export function buildReviewFindingId(code: string, subjectId: string): string {
  return `review:validation:${sanitize(code)}:${sanitize(subjectId)}`;
}
