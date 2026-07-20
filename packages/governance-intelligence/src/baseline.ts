import type { GovernanceBaseline, GovernanceCompatibilityResult, IntelligenceSnapshot } from "./contracts.js";
import { assessSnapshotCompatibility } from "./compatibility.js";
import type { GovernanceConfig } from "./governance-config.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { buildBaselineId } from "./ids.js";

// ---------------------------------------------------------------------------
// showBaseline / setBaseline / validateBaseline -- three pure functions
// covering the baseline lifecycle. None of them touches the filesystem
// directly: `showBaseline` takes a dependency-injected `readSnapshotFile`
// callback (matching this package's established pure-function style --
// I/O stays at the edge, in a later CLI-layer stage, per the milestone
// brief), and `setBaseline`/`validateBaseline` operate purely on already-
// in-memory data the caller supplies.
// ---------------------------------------------------------------------------

/**
 * Resolves the currently configured baseline, if any, by reading the path
 * `config.baseline.snapshot` names via the caller-supplied
 * `readSnapshotFile` callback. Returns `undefined` -- never throws -- when:
 *   - `config` itself is `undefined` (no `.rvs/governance.yml` at all), or
 *   - `config.baseline` is not set (governance.yml exists but names no
 *     baseline snapshot path), or
 *   - `readSnapshotFile` returns `undefined` (the caller's own "file not
 *     found" signal), or
 *   - `readSnapshotFile` throws (treated as "not found" here, matching the
 *     brief's "callback returns undefined/throws-not-found" clause).
 *
 * A genuine parse error -- `readSnapshotFile` succeeding but returning
 * something that isn't a well-formed `GovernanceBaseline` -- is NOT
 * swallowed: this function does no shape-validation of its own (that is
 * `validateBaseline`'s job) and simply returns whatever the callback
 * produced, cast to `GovernanceBaseline`. Callers that need genuine
 * malformed-content errors to propagate should have `readSnapshotFile`
 * itself throw for "found but unparsable" (distinct from "not found") and
 * rely on this function's blanket try/catch only covering the "not found"
 * case in practice -- see this module's test file for the exact contract
 * exercised.
 */
export function showBaseline(config: GovernanceConfig | undefined, readSnapshotFile: (path: string) => unknown): GovernanceBaseline | undefined {
  if (!config?.baseline) return undefined;

  let raw: unknown;
  try {
    raw = readSnapshotFile(config.baseline.snapshot);
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;

  return raw as GovernanceBaseline;
}

export interface SetBaselineInput {
  newSnapshot: IntelligenceSnapshot;
  priorBaseline?: GovernanceBaseline;
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  establishedAt: string;
}

export interface SetBaselineResult {
  baseline: GovernanceBaseline;
  compatibility: GovernanceCompatibilityResult;
}

/**
 * Promotes `newSnapshot` to a new `GovernanceBaseline`. When `priorBaseline`
 * is supplied, compatibility between the prior baseline's own snapshot and
 * `newSnapshot` is computed via `assessSnapshotCompatibility` (compatibility.ts)
 * so the caller can see exactly why/whether the new baseline is a safe
 * successor to the old one. When there is no prior baseline (the very first
 * baseline ever established for a repository), there is nothing to compare
 * against: this function returns an explicit `compatible` result whose
 * `reasons` names that this is a first-ever baseline, rather than
 * fabricating a comparison against nothing.
 *
 * Deliberately never throws or refuses on an "incompatible" result -- per
 * the brief, whether to proceed with an incompatible baseline swap is a
 * caller/CLI-layer decision, not this pure function's. `priorBaseline` is
 * never mutated (a fresh `GovernanceBaseline` object is always returned for
 * the new baseline; the prior baseline object, if any, is left untouched).
 */
export function setBaseline(input: SetBaselineInput): SetBaselineResult {
  const { newSnapshot, priorBaseline, establishedAt } = input;

  const compatibility: GovernanceCompatibilityResult = priorBaseline
    ? assessSnapshotCompatibility(priorBaseline.snapshot, newSnapshot)
    : { status: "compatible", reasons: ["No prior baseline exists for this repository; this is the first baseline established, so there is nothing to compare it against."] };

  const baseline: GovernanceBaseline = {
    schema_version: newSnapshot.schema_version,
    id: buildBaselineId(newSnapshot.id),
    snapshot: newSnapshot,
    repository_id: newSnapshot.repository_id,
    established_at: establishedAt,
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(newSnapshot.evidence_refs)),
  };

  return { baseline, compatibility };
}

/**
 * Checks a previously established `GovernanceBaseline` against the
 * currently running schema version, naming exactly which check failed (per
 * contracts.ts's `GovernanceCompatibilityResult` doc comment: "never a bare
 * boolean"). Two independent checks, both surfaced when both fail:
 *   - `baseline.schema_version` itself (the GovernanceBaseline envelope's
 *     own schema)
 *   - `baseline.snapshot.schema_version` (the IntelligenceSnapshot it wraps)
 */
export function validateBaseline(baseline: GovernanceBaseline, currentSchemaVersion: number): GovernanceCompatibilityResult {
  const reasons: string[] = [];

  if (baseline.schema_version !== currentSchemaVersion) {
    reasons.push(`baseline.schema_version is ${baseline.schema_version}, but the current governance-intelligence schema version is ${currentSchemaVersion}.`);
  }
  if (baseline.snapshot.schema_version !== currentSchemaVersion) {
    reasons.push(`baseline.snapshot.schema_version is ${baseline.snapshot.schema_version}, but the current governance-intelligence schema version is ${currentSchemaVersion}.`);
  }

  if (reasons.length > 0) {
    return { status: "incompatible", reasons };
  }
  return { status: "compatible", reasons: [] };
}
