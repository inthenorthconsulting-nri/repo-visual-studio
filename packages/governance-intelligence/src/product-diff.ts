import { classifyChange } from "./change-classification.js";
import type { EvidenceRef, GovernanceChangeEntry, GovernanceChangeType, GovernanceCompatibilityStatus, GovernanceLineageState, IntelligenceSnapshot, ProductChangeSet } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { arrayField, asArray, asRecord, computeLineage, dedupeEvidenceRefs, domainCompatibility, recordField, sameValue, sortChangeEntries, sortEvidenceRefs, stringField } from "./diff-utils.js";
import { buildChangeId, buildChangeSetId } from "./ids.js";

// ---------------------------------------------------------------------------
// diffProduct -- compares two raw ProductIdentityModel JSON objects (see
// packages/product-intelligence/src/contracts.ts).
//
// Deviation from a naive reading of the milestone brief, worth flagging
// explicitly: the brief asks this engine to diff "claims (approved/
// rejected/runtime)". Product claims (ProductClaim[]) are real, but they
// live on ExecutiveNarrative inside ShowcasePlan (showcase-plan.json) --
// NOT on ProductIdentityModel (product-identity-model.json), which is the
// only artifact governance's IntelligenceSnapshot actually fingerprints for
// the "product" domain (see snapshot.ts's parseProductForSnapshot, which
// reads `identity.displayName` / `generationMetadata`, confirming the raw
// artifact this engine receives is ProductIdentityModel). Governance has no
// raw claims data to diff without adding a fifth artifact kind the rest of
// this package's snapshot/compatibility/id machinery doesn't know about, so
// claims diffing is intentionally out of scope here rather than guessed at.
// ---------------------------------------------------------------------------

export interface ProductDiffInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  /** Already-parsed JSON of the source `.rvs/cache/product-identity-model.json` (ProductIdentityModel), if available. */
  sourceArtifact: unknown;
  /** Already-parsed JSON of the target `.rvs/cache/product-identity-model.json` (ProductIdentityModel), if available. */
  targetArtifact: unknown;
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
  evidenceStrengthDelta?: "stronger" | "weaker" | "same" | "unknown";
}

function makeEntry(args: EntryArgs): GovernanceChangeEntry {
  const classification = classifyChange({
    domain: "product",
    changeType: args.type,
    isRuntimeEntity: false, // product identity fields are positioning/narrative, never runtime execution surfaces
    lineage: args.lineage,
    evidenceChanged: args.evidenceChanged,
    evidenceStrengthDelta: args.evidenceStrengthDelta,
  });
  return {
    id: buildChangeId("product", args.type, args.entityId),
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

/** ProductIdentityEvidence (product-intelligence/src/contracts.ts) is `{ id, sourceType, sourceId?, sourcePath?, text, confidence, strength }` -- `sourcePath` is optional (not every evidence item cites a file path), unlike architecture/capability's evidence shapes. */
function productEvidenceRefsById(ids: string[], evidenceById: Map<string, Record<string, unknown>>): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const id of ids) {
    const record = evidenceById.get(id);
    const sourcePath = stringField(record, "sourcePath");
    if (sourcePath) refs.push({ path: sourcePath, source_artifact: "product" });
  }
  return sortEvidenceRefs(refs);
}

function evidenceById(evidence: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of evidence) {
    const id = stringField(item, "id");
    if (id) map.set(id, item);
  }
  return map;
}

function strengthSum(ids: string[], byId: Map<string, Record<string, unknown>>): number {
  let total = 0;
  for (const id of ids) {
    const record = byId.get(id);
    const value = record?.["strength"];
    if (typeof value === "number") total += value;
  }
  return total;
}

/**
 * Implements the brief's "editorial vs qualified vs material" rule for a
 * single field's evidence backing: identical evidence-id sets are editorial
 * (wording-only, per the adversarial test this package must pass); a
 * changed evidence-id set that resolves to a lower total strength is
 * "weaker" (materiality: qualified); anything else that actually changed
 * evidence is "stronger"/differently-scoped (materiality: material).
 */
function compareEvidenceIds(
  sourceIds: string[],
  targetIds: string[],
  sourceEvidenceById: Map<string, Record<string, unknown>>,
  targetEvidenceById: Map<string, Record<string, unknown>>,
): { evidenceChanged: boolean; lineage: GovernanceLineageState; evidenceStrengthDelta: "stronger" | "weaker" | "same" | "unknown" } {
  const evidenceChanged = !sameValue([...sourceIds].sort(), [...targetIds].sort());
  if (!evidenceChanged) return { evidenceChanged: false, lineage: "preserved", evidenceStrengthDelta: "same" };
  const lineage = computeLineage(sourceIds, targetIds);
  const sourceStrength = strengthSum(sourceIds, sourceEvidenceById);
  const targetStrength = strengthSum(targetIds, targetEvidenceById);
  const evidenceStrengthDelta = targetStrength < sourceStrength ? "weaker" : targetStrength > sourceStrength ? "stronger" : "unknown";
  return { evidenceChanged, lineage, evidenceStrengthDelta };
}

export function diffProduct(input: ProductDiffInput): ProductChangeSet {
  const sourceRoot = asRecord(input.sourceArtifact);
  const targetRoot = asRecord(input.targetArtifact);
  const sourceIdentity = recordField(sourceRoot, "identity");
  const targetIdentity = recordField(targetRoot, "identity");

  const sourceEvidence = asArray(sourceIdentity?.evidence);
  const targetEvidence = asArray(targetIdentity?.evidence);
  const sourceEvidenceById = evidenceById(sourceEvidence);
  const targetEvidenceById = evidenceById(targetEvidence);

  const changes: GovernanceChangeEntry[] = [];

  // -- Scalar identity fields: archetype (categorical, never "wording-only") --
  const sourceArchetype = stringField(sourceIdentity, "archetype");
  const targetArchetype = stringField(targetIdentity, "archetype");
  if (sourceArchetype !== undefined || targetArchetype !== undefined) {
    const changed = sourceArchetype !== targetArchetype;
    const lineage = changed ? computeLineage(sourceEvidence, targetEvidence) : "preserved";
    changes.push(
      makeEntry({
        domainPath: "identity.archetype",
        entityId: "identity:archetype",
        label: targetArchetype ?? sourceArchetype ?? "archetype",
        type: changed ? "modified" : "unchanged",
        lineage,
        evidenceRefs: productEvidenceRefsById(targetEvidence.map((e) => stringField(e, "id")).filter((v): v is string => !!v), targetEvidenceById),
        detail: changed ? `Archetype changed from "${sourceArchetype}" to "${targetArchetype}".` : "No change detected.",
        // A categorical archetype swap is a real classification change even
        // when the surrounding evidence set is stable -- never "editorial".
        evidenceChanged: changed,
      }),
    );
  }

  // -- Scalar identity fields that ARE wording-sensitive: purpose, descriptor, shortPromise --
  const scalarTextFields: { key: string; domainPath: string }[] = [
    { key: "purpose", domainPath: "identity.purpose" },
    { key: "descriptor", domainPath: "identity.descriptor" },
    { key: "shortPromise", domainPath: "identity.shortPromise" },
  ];
  for (const field of scalarTextFields) {
    const sourceText = stringField(sourceIdentity, field.key);
    const targetText = stringField(targetIdentity, field.key);
    if (sourceText === undefined && targetText === undefined) continue;
    const textChanged = sourceText !== targetText;
    if (!textChanged) {
      changes.push(
        makeEntry({
          domainPath: field.domainPath,
          entityId: `identity:${field.key}`,
          label: targetText ?? sourceText ?? field.key,
          type: "unchanged",
          lineage: "preserved",
          evidenceRefs: [],
          detail: "No change detected.",
          evidenceChanged: false,
        }),
      );
      continue;
    }
    // Text changed -- classify editorial vs material/qualified by whether
    // the whole-identity evidence array backing this field also changed
    // (per the brief: same underlying evidence => editorial; wording-only
    // claim-text changes with unchanged evidence must never read as
    // material).
    const evidenceArrayChanged = !sameValue(sourceEvidence, targetEvidence);
    const lineage = evidenceArrayChanged ? computeLineage(sourceEvidence, targetEvidence) : "preserved";
    const strengthDelta: "stronger" | "weaker" | "same" | "unknown" = evidenceArrayChanged
      ? targetEvidence.length < sourceEvidence.length
        ? "weaker"
        : targetEvidence.length > sourceEvidence.length
          ? "stronger"
          : "unknown"
      : "same";
    changes.push(
      makeEntry({
        domainPath: field.domainPath,
        entityId: `identity:${field.key}`,
        label: targetText ?? field.key,
        type: "modified",
        lineage,
        evidenceRefs: productEvidenceRefsById(targetEvidence.map((e) => stringField(e, "id")).filter((v): v is string => !!v), targetEvidenceById),
        detail: evidenceArrayChanged ? `${field.key} text changed and its supporting evidence changed.` : `${field.key} text changed with no change to supporting evidence (wording-only).`,
        evidenceChanged: evidenceArrayChanged,
        evidenceStrengthDelta: strengthDelta,
      }),
    );
  }

  // -- String-set fields: primaryUsers, secondaryUsers, secondaryArchetypes --
  const stringSetFields: { key: string; domainPath: string }[] = [
    { key: "primaryUsers", domainPath: "identity.primaryUsers" },
    { key: "secondaryUsers", domainPath: "identity.secondaryUsers" },
    { key: "secondaryArchetypes", domainPath: "identity.secondaryArchetypes" },
  ];
  for (const field of stringSetFields) {
    const sourceSet = new Set(arrayField(sourceIdentity, field.key).filter((v): v is string => typeof v === "string"));
    const targetSet = new Set(arrayField(targetIdentity, field.key).filter((v): v is string => typeof v === "string"));
    for (const value of targetSet) {
      if (sourceSet.has(value)) continue;
      changes.push(
        makeEntry({
          domainPath: field.domainPath,
          entityId: `${field.key}:${value}`,
          label: value,
          type: "added",
          lineage: "preserved",
          evidenceRefs: [],
          detail: `"${value}" added to ${field.key}.`,
          evidenceChanged: true,
        }),
      );
    }
    for (const value of sourceSet) {
      if (targetSet.has(value)) continue;
      changes.push(
        makeEntry({
          domainPath: field.domainPath,
          entityId: `${field.key}:${value}`,
          label: value,
          type: "removed",
          lineage: "broken",
          evidenceRefs: [],
          detail: `"${value}" removed from ${field.key}.`,
          evidenceChanged: true,
        }),
      );
    }
  }

  // -- Id-bearing entity lists: valuePillars, differentiators --
  const idBearingLists: { key: string; domainPath: string }[] = [
    { key: "valuePillars", domainPath: "identity.valuePillars" },
    { key: "differentiators", domainPath: "identity.differentiators" },
  ];
  for (const field of idBearingLists) {
    const sourceList = asArray(sourceIdentity?.[field.key]);
    const targetList = asArray(targetIdentity?.[field.key]);
    const sourceById = new Map(sourceList.map((e) => [stringField(e, "id") ?? "", e]));
    const targetById = new Map(targetList.map((e) => [stringField(e, "id") ?? "", e]));
    const allIds = new Set([...sourceById.keys(), ...targetById.keys()]);

    for (const id of allIds) {
      const source = sourceById.get(id);
      const target = targetById.get(id);
      const label = stringField(target ?? source, "title") ?? id;

      if (!source && target) {
        const evidenceIds = arrayField(target, "evidenceIds").filter((v): v is string => typeof v === "string");
        changes.push(
          makeEntry({
            domainPath: field.domainPath,
            entityId: id,
            label,
            type: "added",
            lineage: "preserved",
            evidenceRefs: productEvidenceRefsById(evidenceIds, targetEvidenceById),
            detail: `Added to ${field.key}.`,
            evidenceChanged: true,
          }),
        );
        continue;
      }
      if (source && !target) {
        const evidenceIds = arrayField(source, "evidenceIds").filter((v): v is string => typeof v === "string");
        changes.push(
          makeEntry({
            domainPath: field.domainPath,
            entityId: id,
            label,
            type: "removed",
            lineage: "broken",
            evidenceRefs: productEvidenceRefsById(evidenceIds, sourceEvidenceById),
            detail: `Removed from ${field.key}.`,
            evidenceChanged: true,
          }),
        );
        continue;
      }
      if (!source || !target) continue;

      const sourceEvidenceIds = arrayField(source, "evidenceIds").filter((v): v is string => typeof v === "string");
      const targetEvidenceIds = arrayField(target, "evidenceIds").filter((v): v is string => typeof v === "string");
      const evidenceComparison = compareEvidenceIds(sourceEvidenceIds, targetEvidenceIds, sourceEvidenceById, targetEvidenceById);
      const identical = sameValue(source, target);

      changes.push(
        makeEntry({
          domainPath: field.domainPath,
          entityId: id,
          label,
          type: identical ? "unchanged" : "modified",
          lineage: identical ? "preserved" : evidenceComparison.lineage,
          evidenceRefs: productEvidenceRefsById(targetEvidenceIds, targetEvidenceById),
          detail: identical ? "No change detected." : evidenceComparison.evidenceChanged ? `${field.key} entry changed and its supporting evidence changed.` : `${field.key} entry changed with no change to supporting evidence (wording-only).`,
          evidenceChanged: identical ? false : evidenceComparison.evidenceChanged,
          evidenceStrengthDelta: evidenceComparison.evidenceStrengthDelta,
        }),
      );
    }
  }

  const sortedChanges = sortChangeEntries(changes);

  // BUG FIX: see architecture-diff.ts's identical fix for the full
  // rationale -- this changeset-level field must reflect only snapshot
  // comparability, not any individual product-identity entity's
  // compatibility_impact, or a single removed/weakened entity would poison
  // the whole changeset to "incompatible" and mask itself behind
  // policy-evaluator.ts's compatibility-gated "unverifiable".
  const compatibility: GovernanceCompatibilityStatus = domainCompatibility("product", input.sourceSnapshot, input.targetSnapshot);

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(sortedChanges.flatMap((c) => c.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId("product", input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    repository_id: input.targetSnapshot.repository_id ?? input.sourceSnapshot.repository_id,
    compatibility,
    changes: sortedChanges,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
