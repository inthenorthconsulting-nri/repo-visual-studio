// Mirrors @rvs/knowledge-graph/src/ids.ts exactly: every id is a pure
// function of stable inputs only -- never a timestamp, never a wall-clock
// generation time, never an array or iteration index. Two visual-intelligence
// runs over identical evidence must produce byte-identical spec ids,
// fidelity-receipt ids, and digests, or Milestone 10's determinism proof is
// worthless.

import { createHash } from "node:crypto";

const SAFE = /[^a-zA-Z0-9_.-]/g;

export function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

/**
 * Recursively sorts object keys so JSON.stringify never depends on source key
 * insertion order. Array element order is preserved -- callers sort arrays
 * themselves before digesting when element order must not affect the digest.
 * (Identical contract to @rvs/knowledge-graph's `canonicalize`.)
 */
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
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/**
 * A short digest used inside composite ids. 16 hex characters (64 bits) is
 * the same width @rvs/knowledge-graph uses for its query digests -- long
 * enough that a collision is not a practical concern for a single
 * repository's view set, short enough that ids stay readable in a CLI.
 */
export function shortDigest(value: unknown): string {
  return digestOf(value).slice(0, 16);
}

/** Sorts and de-duplicates ids so every id set digested or stored is order-independent. */
export function normalizeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

export function buildSpecId(producer: string, subject: string, inputDigest: string): string {
  return `visual:spec:${sanitize(producer)}:${sanitize(subject)}:${sanitize(inputDigest.slice(0, 16))}`;
}

export function buildFidelityReceiptId(specId: string, sourceDigest: string, renderedDigest: string): string {
  return `visual:fidelity:${sanitize(specId)}:${sanitize(sourceDigest.slice(0, 16))}.${sanitize(renderedDigest.slice(0, 16))}`;
}

export function buildCollapsedGroupId(specId: string, reason: string, memberIdsSorted: readonly string[]): string {
  return `visual:group:${sanitize(specId)}:${sanitize(reason)}:${sanitize(shortDigest(memberIdsSorted))}`;
}

export function buildSplitViewId(specId: string, partIndexLabel: string): string {
  return `visual:split:${sanitize(specId)}:${sanitize(partIndexLabel)}`;
}

export function buildVisualNodeId(sourceEntityId: string): string {
  return `visual:node:${sanitize(sourceEntityId)}`;
}

export function buildVisualEdgeId(kind: string, fromId: string, toId: string): string {
  return `visual:edge:${sanitize(fromId)}:${sanitize(kind)}:${sanitize(toId)}`;
}

export function buildVisualPathId(nodeIdsInOrder: readonly string[]): string {
  return `visual:path:${nodeIdsInOrder.map(sanitize).join(".")}`;
}

export function buildValidationFindingId(code: string, subjectId: string): string {
  return `visual:validation:${sanitize(code)}:${sanitize(subjectId)}`;
}
