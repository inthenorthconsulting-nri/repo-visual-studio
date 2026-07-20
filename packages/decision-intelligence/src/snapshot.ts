// Assembles a deterministic DecisionSnapshot from already-parsed decision
// records. Never re-scans a repository and never calls an external model --
// every field is derived solely from the caller-supplied decisions/
// source-issues plus the caller-supplied `generatedAt` timestamp (the one
// non-content-derived field, excluded from all determinism comparisons per
// contracts.ts's top-of-file note).
//
// References, never embeds, the upstream IntelligenceSnapshot this decision
// snapshot was built alongside -- `upstream_snapshot` is a `{ snapshot_id,
// digest, schema_version }` pointer only (contracts.ts's UpstreamSnapshotRef),
// never the full upstream artifact. This package never imports
// @rvs/governance-intelligence's IntelligenceSnapshot type; the caller
// supplies the pointer fields directly.

import { createHash } from "node:crypto";
import type { ArchitectureDecision, DecisionSnapshot, DecisionSnapshotCompatibilityStatus, DecisionSourceIssue, UpstreamSnapshotRef } from "./contracts.js";
import { DECISION_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildSnapshotId } from "./ids.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key]);
    return sorted;
  }
  return value;
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export interface BuildDecisionSnapshotInput {
  repositoryId: string;
  /** Caller-supplied wall-clock timestamp; this package never calls Date/Math.random itself. */
  generatedAt: string;
  decisions: ArchitectureDecision[];
  sourceIssues: DecisionSourceIssue[];
  upstreamSnapshot?: UpstreamSnapshotRef;
  /**
   * How much upstream context was available when this decision snapshot was
   * built. Omit to derive it structurally from `upstreamSnapshot`'s presence
   * ("complete" when supplied, "unavailable" when not) -- pass explicitly
   * when the caller knows the upstream snapshot itself was only partially
   * loaded, since this package cannot infer that from a pointer alone.
   */
  upstreamCompatibility?: DecisionSnapshotCompatibilityStatus;
}

export function buildDecisionSnapshot(input: BuildDecisionSnapshotInput): DecisionSnapshot {
  const decisions = [...input.decisions].sort((a, b) => a.id.localeCompare(b.id));
  const sourceIssues = [...input.sourceIssues].sort((a, b) => a.id.localeCompare(b.id));

  const decisionDigests = decisions.map((d) => digestOf(d)).sort();
  const compatibility = input.upstreamCompatibility ?? (input.upstreamSnapshot ? "complete" : "unavailable");

  return {
    schema_version: DECISION_INTELLIGENCE_SCHEMA_VERSION,
    id: buildSnapshotId(input.repositoryId, decisionDigests),
    generated_at: input.generatedAt,
    repository_id: input.repositoryId,
    digest: digestOf({ decisions, source_issues: sourceIssues }),
    upstream_snapshot: input.upstreamSnapshot,
    decisions,
    source_issues: sourceIssues,
    compatibility,
  };
}
