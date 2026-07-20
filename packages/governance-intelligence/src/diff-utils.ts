// Shared low-level helpers used by the four *ChangeSet diff engines
// (architecture-diff.ts, capability-diff.ts, product-diff.ts,
// portfolio-diff.ts) plus evidence-diff.ts and blast-radius.ts. Not part of
// this package's public surface (not re-exported from index.ts) -- purely an
// implementation-sharing seam so the same canonicalization/sorting/
// classification-adjacent logic isn't re-derived four times.
//
// Deliberately re-implements canonicalize()/digestOf()-shaped helpers rather
// than importing them from snapshot.ts: snapshot.ts's own helpers are
// private (unexported) and this milestone's brief is explicit that already
//-scaffolded files must not have their public shape changed. Duplicating a
// ~10-line pure function is cheaper than widening snapshot.ts's exports.

import type { EvidenceRef, GovernanceChangeEntry, GovernanceCompatibilityStatus, GovernanceEvidenceChangeEntry, GovernanceLineageState } from "./contracts.js";

// ---------------------------------------------------------------------------
// Structural helpers over raw `unknown` artifact JSON
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function arrayField(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

export function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  return asRecord(record?.[key]);
}

/** Reads a NormalizedLabel-shaped field (`{ displayLabel, sourceLabel, shortLabel }`), falling back through displayLabel -> sourceLabel -> the entity's own id -> a literal placeholder, so a label is always produced even from malformed input. */
export function normalizedLabelOf(record: Record<string, unknown> | undefined, key: string, fallbackId: string): string {
  const label = recordField(record, key);
  return stringField(label, "displayLabel") ?? stringField(label, "sourceLabel") ?? fallbackId ?? "(unlabeled)";
}

// ---------------------------------------------------------------------------
// Canonicalization / determinism
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

// ---------------------------------------------------------------------------
// Id-based partitioning (added / removed / common) -- the one pattern every
// diff engine repeats across every entity list it compares.
// ---------------------------------------------------------------------------

export interface EntityPartition<T> {
  added: T[];
  removed: T[];
  commonIds: string[];
  sourceById: Map<string, T>;
  targetById: Map<string, T>;
}

export function partitionById<T>(sourceList: T[], targetList: T[], idOf: (entity: T) => string): EntityPartition<T> {
  const sourceById = new Map(sourceList.map((e) => [idOf(e), e]));
  const targetById = new Map(targetList.map((e) => [idOf(e), e]));
  const added = [...targetById.entries()].filter(([id]) => !sourceById.has(id)).map(([, e]) => e);
  const removed = [...sourceById.entries()].filter(([id]) => !targetById.has(id)).map(([, e]) => e);
  const commonIds = [...sourceById.keys()].filter((id) => targetById.has(id));
  return { added, removed, commonIds, sourceById, targetById };
}

/**
 * Conservative rename detection, shared by every diff engine that opts into
 * it. An id-changed entity is classified "renamed" -- collapsing what would
 * otherwise be a separate removed+added pair into one entry -- ONLY when
 * there is deterministic evidence it is the same underlying entity: a
 * removed candidate and an added candidate that agree on `kind` AND whose
 * evidence arrays are non-empty and byte-identical (canonical-JSON equal).
 * Non-empty evidence is required specifically so two entities that both
 * happen to carry empty evidence arrays are never spuriously matched as a
 * "rename" merely by both being empty. Any ambiguity -- zero matches, or
 * more than one candidate satisfying the rule -- falls back to leaving both
 * sides in `removedRemaining`/`addedRemaining` (a separate removed + added
 * pair) rather than guessing. This package never infers a rename from label
 * similarity, fuzzy id matching, or array position.
 */
export function detectConservativeRenames<T>(
  removed: T[],
  added: T[],
  kindOf: (entity: T) => string | undefined,
  evidenceOf: (entity: T) => unknown[],
): { renamed: { from: T; to: T }[]; removedRemaining: T[]; addedRemaining: T[] } {
  const renamed: { from: T; to: T }[] = [];
  const removedRemaining = [...removed];
  const addedRemaining = [...added];

  for (const candidate of removed) {
    const candidateKind = kindOf(candidate);
    const candidateEvidence = evidenceOf(candidate);
    if (!candidateKind || candidateEvidence.length === 0) continue;
    const candidateEvidenceKey = stableStringify(candidateEvidence);
    const matches = addedRemaining.filter((a) => kindOf(a) === candidateKind && evidenceOf(a).length > 0 && stableStringify(evidenceOf(a)) === candidateEvidenceKey);
    if (matches.length === 1) {
      const to = matches[0];
      renamed.push({ from: candidate, to });
      removedRemaining.splice(removedRemaining.indexOf(candidate), 1);
      addedRemaining.splice(addedRemaining.indexOf(to), 1);
    }
  }

  return { renamed, removedRemaining, addedRemaining };
}

// ---------------------------------------------------------------------------
// Evidence lineage
// ---------------------------------------------------------------------------

/**
 * Deterministic, conservative lineage derivation shared by every diff
 * engine: identical evidence is "preserved"; a shrink to zero is "broken"; a
 * strict shrink (but not to zero) is "weakened"; a strict growth is
 * "strengthened"; and a same-count-but-different-content change is
 * "unverifiable" -- there is no way to tell, from count alone, whether
 * evidence got stronger or weaker, so this package refuses to guess.
 */
export function computeLineage(sourceEvidence: unknown[], targetEvidence: unknown[]): GovernanceLineageState {
  if (sameValue(sourceEvidence, targetEvidence)) return "preserved";
  if (targetEvidence.length === 0 && sourceEvidence.length > 0) return "broken";
  if (targetEvidence.length < sourceEvidence.length) return "weakened";
  if (targetEvidence.length > sourceEvidence.length) return "strengthened";
  return "unverifiable";
}

// ---------------------------------------------------------------------------
// Evidence ref helpers
// ---------------------------------------------------------------------------

/** Converts an upstream `EvidenceReference[]`-shaped array (`{ path, lines? }`) into governance-local `EvidenceRef[]`, tagging each with which upstream artifact it was carried forward from. Non-conforming entries are dropped rather than guessed. */
export function toEvidenceRefs(evidence: unknown[], sourceArtifact: EvidenceRef["source_artifact"]): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const item of evidence) {
    if (isRecord(item) && typeof item.path === "string") {
      refs.push({ path: item.path, lines: typeof item.lines === "string" ? item.lines : undefined, source_artifact: sourceArtifact });
    }
  }
  return sortEvidenceRefs(refs);
}

export function sortEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  return [...refs].sort((a, b) => {
    if (a.source_artifact !== b.source_artifact) return a.source_artifact < b.source_artifact ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const aLines = a.lines ?? "";
    const bLines = b.lines ?? "";
    return aLines < bLines ? -1 : aLines > bLines ? 1 : 0;
  });
}

export function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = stableStringify(ref);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Change-entry sorting (contracts.ts: "Sorted by (type, domain_path, entity_id)")
// ---------------------------------------------------------------------------

export function sortChangeEntries(changes: GovernanceChangeEntry[]): GovernanceChangeEntry[] {
  return [...changes].sort((a, b) => {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.domain_path !== b.domain_path) return a.domain_path < b.domain_path ? -1 : 1;
    return a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0;
  });
}

/** Sorted by (type, evidence_ref.source_artifact, evidence_ref.path, evidence_ref.lines ?? "") per contracts.ts's EvidenceChangeSet doc comment. */
export function sortEvidenceChangeEntries(changes: GovernanceEvidenceChangeEntry[]): GovernanceEvidenceChangeEntry[] {
  return [...changes].sort((a, b) => {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.evidence_ref.source_artifact !== b.evidence_ref.source_artifact) return a.evidence_ref.source_artifact < b.evidence_ref.source_artifact ? -1 : 1;
    if (a.evidence_ref.path !== b.evidence_ref.path) return a.evidence_ref.path < b.evidence_ref.path ? -1 : 1;
    const aLines = a.evidence_ref.lines ?? "";
    const bLines = b.evidence_ref.lines ?? "";
    return aLines < bLines ? -1 : aLines > bLines ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Compatibility rollup
// ---------------------------------------------------------------------------

const COMPATIBILITY_RANK: Record<GovernanceCompatibilityStatus, number> = {
  compatible: 0,
  compatible_with_warnings: 1,
  partial: 2,
  incompatible: 3,
};

export function worstCompatibility(statuses: GovernanceCompatibilityStatus[]): GovernanceCompatibilityStatus {
  let worst: GovernanceCompatibilityStatus = "compatible";
  for (const status of statuses) {
    if (COMPATIBILITY_RANK[status] > COMPATIBILITY_RANK[worst]) worst = status;
  }
  return worst;
}

/**
 * Domain-scoped compatibility check, deliberately narrower than
 * compatibility.ts's `assessSnapshotCompatibility` (which judges all four
 * domains at once for baseline-promotion purposes): a single *ChangeSet only
 * needs to know whether ITS OWN domain was comparable between the two
 * snapshots. "partial" when either side lacks complete provenance for this
 * domain; "incompatible" when both sides have complete provenance but
 * disagree on schema_version; "compatible" otherwise.
 */
export function domainCompatibility(
  domain: string,
  source: { artifacts: { artifact: string; provenance: string; schema_version?: number }[] },
  target: { artifacts: { artifact: string; provenance: string; schema_version?: number }[] },
): GovernanceCompatibilityStatus {
  const sourceDigest = source.artifacts.find((a) => a.artifact === domain);
  const targetDigest = target.artifacts.find((a) => a.artifact === domain);
  if (sourceDigest?.provenance !== "complete" || targetDigest?.provenance !== "complete") return "partial";
  if (sourceDigest.schema_version !== undefined && targetDigest.schema_version !== undefined && sourceDigest.schema_version !== targetDigest.schema_version) {
    return "incompatible";
  }
  return "compatible";
}
