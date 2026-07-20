import { classifyChange } from "./change-classification.js";
import type { CapabilityChangeSet, EvidenceRef, GovernanceChangeEntry, GovernanceChangeType, GovernanceCompatibilityStatus, GovernanceLineageState, IntelligenceSnapshot } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { arrayField, asArray, asRecord, computeLineage, dedupeEvidenceRefs, domainCompatibility, isRecord, sameValue, sortChangeEntries, sortEvidenceRefs, stringField } from "./diff-utils.js";
import { buildChangeId, buildChangeSetId } from "./ids.js";

// ---------------------------------------------------------------------------
// diffCapability -- compares two raw CapabilityModel JSON objects (see
// packages/capability-intelligence/src/contracts.ts). A capability's "bucket"
// (which top-level CapabilityModel list it appears in) is itself part of
// what governance tracks: the exact same capability id can move from
// includedCapabilities to excludedCandidates between snapshots, which is as
// significant a regression as its `status` field changing.
// ---------------------------------------------------------------------------

export interface CapabilityDiffInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  /** Already-parsed JSON of the source `.rvs/cache/capability-model.json` (CapabilityModel), if available. */
  sourceArtifact: unknown;
  /** Already-parsed JSON of the target `.rvs/cache/capability-model.json` (CapabilityModel), if available. */
  targetArtifact: unknown;
}

type CapabilityBucket = "includedCapabilities" | "qualifiedCapabilities" | "roadmapCapabilities" | "gapCapabilities" | "excludedCandidates" | "unresolvedCapabilities";

/**
 * Spec's "current -> qualified -> roadmap" conservative order, mapped onto
 * the REAL CapabilityModel bucket names (packages/capability-intelligence/
 * src/contracts.ts's CapabilityModel): includedCapabilities is "current",
 * qualifiedCapabilities is "qualified", roadmapCapabilities is "roadmap".
 * gapCapabilities/excludedCandidates/unresolvedCapabilities extend the same
 * descending order since they represent progressively weaker inclusion
 * outcomes than "roadmap" (an operationally-meaningful gap, an explicitly
 * excluded candidate, and an unresolved/contradictory-evidence candidate,
 * respectively -- see CapabilityModel's own doc comments).
 */
const BUCKET_RANK: Record<CapabilityBucket, number> = {
  includedCapabilities: 5,
  qualifiedCapabilities: 4,
  roadmapCapabilities: 3,
  gapCapabilities: 2,
  excludedCandidates: 1,
  unresolvedCapabilities: 0,
};

const BUCKET_ORDER: CapabilityBucket[] = ["includedCapabilities", "qualifiedCapabilities", "roadmapCapabilities", "gapCapabilities", "excludedCandidates", "unresolvedCapabilities"];

/**
 * Spec's "operational -> implemented -> partial -> planned" order, mapped
 * onto the REAL CapabilityStatus enum (capability-intelligence/src/
 * contracts.ts): operational/implemented/partial/planned are literal values
 * of that enum, used verbatim. experimental/scaffolded are real enum values
 * the spec's abbreviated example skipped over; they are ranked between
 * partial and planned per capability-intelligence's own readiness-threshold
 * ordering (maturity.ts / DEFAULT_CAPABILITY_READINESS_THRESHOLDS: partial
 * >= 45, experimental >= 25, scaffolded >= 10, else planned/unsupported).
 * deprecated/abandoned rank below planned (an intentional shutdown, not a
 * maturity level); unknown ranks lowest (no signal at all).
 */
const STATUS_RANK: Record<string, number> = {
  operational: 8,
  implemented: 7,
  partial: 6,
  experimental: 5,
  scaffolded: 4,
  planned: 3,
  deprecated: 2,
  abandoned: 1,
  unknown: 0,
};

interface BucketedCapability {
  bucket: CapabilityBucket;
  record: Record<string, unknown>;
}

function collectBuckets(root: Record<string, unknown> | undefined): Map<string, BucketedCapability> {
  const map = new Map<string, BucketedCapability>();
  if (!root) return map;
  for (const bucket of BUCKET_ORDER) {
    for (const entity of asArray(root[bucket])) {
      const id = stringField(entity, "id");
      if (!id) continue;
      map.set(id, { bucket, record: entity });
    }
  }
  return map;
}

/** CapabilityEvidence (capability-intelligence/src/contracts.ts) is `{ id, type, sourcePath, symbol?, description, strength, confidence }` -- NOT the `{ path, lines? }` EvidenceReference shape architecture-intelligence uses. `sourcePath` is the field that carries the file path here. */
function capabilityEvidenceRefs(evidence: unknown[]): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const item of evidence) {
    if (isRecord(item) && typeof item.sourcePath === "string") {
      refs.push({ path: item.sourcePath, source_artifact: "capability" });
    }
  }
  return sortEvidenceRefs(refs);
}

function capabilityEvidenceOf(entity: Record<string, unknown>): unknown[] {
  return arrayField(entity, "evidence");
}

interface EntryArgs {
  domainPath: string;
  entityId: string;
  label: string;
  type: GovernanceChangeType;
  lineage: GovernanceLineageState;
  evidenceRefs: EvidenceRef[];
  detail: string;
  evidenceChanged: boolean;
  isRuntimeEntity: boolean;
}

function makeEntry(args: EntryArgs): GovernanceChangeEntry {
  const classification = classifyChange({
    domain: "capability",
    changeType: args.type,
    isRuntimeEntity: args.isRuntimeEntity,
    lineage: args.lineage,
    evidenceChanged: args.evidenceChanged,
  });
  return {
    id: buildChangeId("capability", args.type, args.entityId),
    domain_path: args.domainPath,
    entity_id: args.entityId,
    entity_label: args.label,
    type: args.type,
    compatibility: classification.compatibility_impact,
    lineage: args.lineage,
    classification,
    detail: args.detail,
    evidence_refs: args.evidenceRefs,
  };
}

function isCurrentBucket(bucket: CapabilityBucket): boolean {
  return bucket === "includedCapabilities" || bucket === "qualifiedCapabilities";
}

export function diffCapability(input: CapabilityDiffInput): CapabilityChangeSet {
  const sourceRoot = asRecord(input.sourceArtifact);
  const targetRoot = asRecord(input.targetArtifact);

  const sourceById = collectBuckets(sourceRoot);
  const targetById = collectBuckets(targetRoot);

  const allIds = new Set<string>([...sourceById.keys(), ...targetById.keys()]);
  const changes: GovernanceChangeEntry[] = [];

  for (const id of allIds) {
    const source = sourceById.get(id);
    const target = targetById.get(id);

    if (!source && target) {
      const evidence = capabilityEvidenceOf(target.record);
      changes.push(
        makeEntry({
          domainPath: target.bucket,
          entityId: id,
          label: stringField(target.record, "displayName") ?? id,
          type: "added",
          lineage: "preserved",
          evidenceRefs: capabilityEvidenceRefs(evidence),
          detail: `Added to ${target.bucket}.`,
          evidenceChanged: true,
          isRuntimeEntity: isCurrentBucket(target.bucket),
        }),
      );
      continue;
    }

    if (source && !target) {
      const evidence = capabilityEvidenceOf(source.record);
      changes.push(
        makeEntry({
          domainPath: source.bucket,
          entityId: id,
          label: stringField(source.record, "displayName") ?? id,
          type: "removed",
          lineage: "broken",
          evidenceRefs: capabilityEvidenceRefs(evidence),
          detail: `Removed from ${source.bucket}.`,
          evidenceChanged: true,
          isRuntimeEntity: isCurrentBucket(source.bucket),
        }),
      );
      continue;
    }

    if (!source || !target) continue; // unreachable, satisfies narrowing

    const sourceStatus = stringField(source.record, "status") ?? "unknown";
    const targetStatus = stringField(target.record, "status") ?? "unknown";
    const sourceEvidence = capabilityEvidenceOf(source.record);
    const targetEvidence = capabilityEvidenceOf(target.record);

    const statusRegressed = (STATUS_RANK[targetStatus] ?? 0) < (STATUS_RANK[sourceStatus] ?? 0);
    const bucketRegressed = BUCKET_RANK[target.bucket] < BUCKET_RANK[source.bucket];
    const statusChanged = sourceStatus !== targetStatus;
    const bucketChanged = source.bucket !== target.bucket;
    const evidenceChanged = !sameValue(sourceEvidence, targetEvidence);
    const lineage = evidenceChanged ? computeLineage(sourceEvidence, targetEvidence) : "preserved";

    let type: GovernanceChangeType;
    let detail: string;
    if (statusRegressed || bucketRegressed) {
      type = "reclassified";
      const parts: string[] = [];
      if (statusRegressed) parts.push(`status regressed from "${sourceStatus}" to "${targetStatus}"`);
      if (bucketRegressed) parts.push(`inclusion regressed from ${source.bucket} to ${target.bucket}`);
      detail = parts.join("; ") + ".";
    } else if (statusChanged || bucketChanged || evidenceChanged) {
      // Not a regression (status/bucket held steady or improved), but
      // something real changed -- most commonly evidence gain/loss with
      // status/bucket unchanged, surfaced as its own "modified" entry
      // distinct from a "reclassified" regression.
      type = "modified";
      const parts: string[] = [];
      if (statusChanged) parts.push(`status changed from "${sourceStatus}" to "${targetStatus}"`);
      if (bucketChanged) parts.push(`inclusion changed from ${source.bucket} to ${target.bucket}`);
      if (evidenceChanged) parts.push(`evidence ${targetEvidence.length < sourceEvidence.length ? "decreased" : targetEvidence.length > sourceEvidence.length ? "increased" : "changed"} from ${sourceEvidence.length} to ${targetEvidence.length} item(s)`);
      detail = parts.join("; ") + ".";
    } else {
      // Status, bucket, and evidence are all unchanged -- any remaining
      // difference (description/label wording, purpose text, etc.) is
      // cosmetic only. This is the critical adversarial case: a wording-only
      // description change must classify as "unchanged", never as a
      // regression or even as "modified".
      type = "unchanged";
      detail = "No status, inclusion, or evidence change detected.";
    }

    changes.push(
      makeEntry({
        domainPath: target.bucket,
        entityId: id,
        label: stringField(target.record, "displayName") ?? id,
        type,
        lineage: type === "unchanged" ? "preserved" : lineage,
        evidenceRefs: capabilityEvidenceRefs(targetEvidence),
        detail,
        evidenceChanged,
        isRuntimeEntity: isCurrentBucket(target.bucket) || isCurrentBucket(source.bucket),
      }),
    );
  }

  const sortedChanges = sortChangeEntries(changes);

  // BUG FIX: see architecture-diff.ts's identical fix for the full
  // rationale -- this changeset-level field must reflect only snapshot
  // comparability (contracts.ts's GovernanceCompatibilityStatus doc
  // comment), not any individual capability's compatibility_impact, or a
  // single removed/regressed capability would poison the whole changeset to
  // "incompatible" and mask itself from require_evidence_type/
  // forbid_operational_to_planned_regression/require_capability_status_at_
  // least behind policy-evaluator.ts's compatibility-gated "unverifiable".
  const compatibility: GovernanceCompatibilityStatus = domainCompatibility("capability", input.sourceSnapshot, input.targetSnapshot);

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(sortedChanges.flatMap((c) => c.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId("capability", input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    repository_id: input.targetSnapshot.repository_id ?? input.sourceSnapshot.repository_id,
    compatibility,
    changes: sortedChanges,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
