import { classifyChange } from "./change-classification.js";
import type { EvidenceRef, GovernanceChangeEntry, GovernanceChangeType, GovernanceCompatibilityStatus, GovernanceLineageState, IntelligenceSnapshot, PortfolioChangeSet } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { arrayField, asArray, asRecord, dedupeEvidenceRefs, domainCompatibility, recordField, sameValue, sortChangeEntries, sortEvidenceRefs, stringField } from "./diff-utils.js";
import { buildChangeId, buildChangeSetId } from "./ids.js";

// ---------------------------------------------------------------------------
// diffPortfolio -- compares two raw PortfolioModel JSON objects (see
// packages/portfolio-intelligence/src/contracts.ts).
//
// Deviation worth flagging: the brief's field list includes "decisions", but
// PortfolioDecision[] lives on PortfolioPlan (portfolio-plan.json), not on
// PortfolioModel (portfolio-model.json) -- the only artifact governance's
// IntelligenceSnapshot fingerprints for the "portfolio" domain (see
// snapshot.ts's parsePortfolioForSnapshot, which reads `portfolioId`/
// `displayName`/`generationMetadata` directly off the root object, matching
// PortfolioModel, not PortfolioPlan). Decisions diffing is out of scope here
// for the same reason product claims are out of scope in product-diff.ts.
// Likewise, "shared contracts" is not a separate top-level list -- it is the
// `relationships` entries whose `type` is "shared_contract" (see
// PortfolioRelationshipType) plus `dependencyGraph` nodes/edges of kind
// "contract" -- both are covered by this engine's `relationships` and
// `dependencyGraph.edges` diffing, not as a separate group.
// ---------------------------------------------------------------------------

export interface PortfolioDiffInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  /** Already-parsed JSON of the source `.rvs/cache/portfolio-model.json` (PortfolioModel), if available. */
  sourceArtifact: unknown;
  /** Already-parsed JSON of the target `.rvs/cache/portfolio-model.json` (PortfolioModel), if available. */
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
  isRuntimeEntity: boolean;
}

function makeEntry(args: EntryArgs): GovernanceChangeEntry {
  const classification = classifyChange({
    domain: "portfolio",
    changeType: args.type,
    isRuntimeEntity: args.isRuntimeEntity,
    lineage: args.lineage,
    evidenceChanged: args.evidenceChanged,
  });
  return {
    id: buildChangeId("portfolio", args.type, args.entityId),
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

/**
 * §-critical rule: a disappeared relationship/dependency/shared-contract
 * entry must never be reported as a bare "removed" -- callers need to know
 * WHY, to the extent the two snapshots' own evidence can actually say so.
 * Conservative, staged, and never phrased as an assumed negative outcome
 * (never "X was killed" / "X broke") -- matching this package's
 * conservative-bias requirement:
 *
 *  1. If the "product" domain's snapshot provenance went from complete (in
 *     the source snapshot) to anything else (in the target snapshot), the
 *     most likely cause observable from the two snapshots themselves is that
 *     a product's own evidence became unavailable, not that the
 *     relationship was deliberately removed.
 *  2. Else, if product provenance stayed complete on both sides but the
 *     entity itself had no evidence backing it (`evidenceIds` was already
 *     empty on the source-side entity, the last point it can be observed),
 *     the most likely cause is evidence loss rather than a source-of-truth
 *     removal.
 *  3. Otherwise there is no deterministic basis in the two snapshots to
 *     assign a cause -- "unresolved", not a guess.
 */
function attributeRemovalCause(sourceEvidenceIds: unknown[], source: IntelligenceSnapshot, target: IntelligenceSnapshot): string {
  const sourceProductDigest = source.artifacts.find((a) => a.artifact === "product");
  const targetProductDigest = target.artifacts.find((a) => a.artifact === "product");
  if (sourceProductDigest?.provenance === "complete" && targetProductDigest?.provenance !== "complete") {
    return "product removed / evidence unavailable";
  }
  if (sourceProductDigest?.provenance === "complete" && targetProductDigest?.provenance === "complete" && sourceEvidenceIds.length === 0) {
    return "evidence loss";
  }
  return "unresolved -- insufficient evidence to determine cause";
}

interface GroupSpec {
  domainPath: string;
  sourceList: Record<string, unknown>[];
  targetList: Record<string, unknown>[];
  labelOf: (entity: Record<string, unknown>) => string;
  evidenceIdsOf: (entity: Record<string, unknown>) => unknown[];
  isRuntimeEntity: boolean;
  /** True for relationships/dependencies/shared-contract-bearing groups: a removed entry gets a cause-attributed detail instead of a bare "removed" message. */
  attributeRemovalCauses: boolean;
}

function idOf(entity: Record<string, unknown>): string {
  return stringField(entity, "id") ?? "";
}

function diffGroup(spec: GroupSpec, source: IntelligenceSnapshot, target: IntelligenceSnapshot): GovernanceChangeEntry[] {
  const sourceById = new Map(spec.sourceList.map((e) => [idOf(e), e]));
  const targetById = new Map(spec.targetList.map((e) => [idOf(e), e]));
  const entries: GovernanceChangeEntry[] = [];

  for (const [id, entity] of targetById) {
    if (sourceById.has(id)) continue;
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: id,
        label: spec.labelOf(entity),
        type: "added",
        lineage: "preserved",
        evidenceRefs: [],
        detail: `Added to ${spec.domainPath}.`,
        evidenceChanged: true,
        isRuntimeEntity: spec.isRuntimeEntity,
      }),
    );
  }

  for (const [id, entity] of sourceById) {
    if (targetById.has(id)) continue;
    const evidenceIds = spec.evidenceIdsOf(entity);
    const detail = spec.attributeRemovalCauses
      ? `Removed from ${spec.domainPath}. Likely cause: ${attributeRemovalCause(evidenceIds, source, target)}.`
      : `Removed from ${spec.domainPath}.`;
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: id,
        label: spec.labelOf(entity),
        type: "removed",
        lineage: evidenceIds.length === 0 ? "broken" : "weakened",
        evidenceRefs: [],
        detail,
        evidenceChanged: true,
        isRuntimeEntity: spec.isRuntimeEntity,
      }),
    );
  }

  for (const id of [...sourceById.keys()].filter((k) => targetById.has(k))) {
    const sourceEntity = sourceById.get(id)!;
    const targetEntity = targetById.get(id)!;
    const identical = sameValue(sourceEntity, targetEntity);
    const sourceEvidenceIds = spec.evidenceIdsOf(sourceEntity);
    const targetEvidenceIds = spec.evidenceIdsOf(targetEntity);
    const evidenceChanged = !sameValue(sourceEvidenceIds, targetEvidenceIds);
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: id,
        label: spec.labelOf(targetEntity),
        type: identical ? "unchanged" : "modified",
        lineage: identical ? "preserved" : targetEvidenceIds.length === 0 && sourceEvidenceIds.length > 0 ? "broken" : targetEvidenceIds.length < sourceEvidenceIds.length ? "weakened" : targetEvidenceIds.length > sourceEvidenceIds.length ? "strengthened" : "preserved",
        evidenceRefs: [],
        detail: identical ? "No change detected." : "Entry changed.",
        evidenceChanged,
        isRuntimeEntity: spec.isRuntimeEntity,
      }),
    );
  }

  return entries;
}

const MATURITY_DIMENSIONS = ["coverage", "operational", "verification", "integration", "ownership", "runtimeEvidence", "coherence"] as const;

function diffMaturity(sourceRoot: Record<string, unknown> | undefined, targetRoot: Record<string, unknown> | undefined): GovernanceChangeEntry[] {
  const sourceMaturity = recordField(sourceRoot, "maturity");
  const targetMaturity = recordField(targetRoot, "maturity");
  if (!sourceMaturity && !targetMaturity) return [];

  const entries: GovernanceChangeEntry[] = [];
  for (const dimension of MATURITY_DIMENSIONS) {
    const sourceDim = recordField(sourceMaturity, dimension);
    const targetDim = recordField(targetMaturity, dimension);
    if (!sourceDim && !targetDim) continue;
    const sourceScore = typeof sourceDim?.score === "number" ? sourceDim.score : undefined;
    const targetScore = typeof targetDim?.score === "number" ? targetDim.score : undefined;
    const identical = sameValue(sourceDim, targetDim);
    const lineage: GovernanceLineageState = identical
      ? "preserved"
      : sourceScore === undefined || targetScore === undefined
        ? "unverifiable"
        : targetScore < sourceScore
          ? "weakened"
          : targetScore > sourceScore
            ? "strengthened"
            : "unverifiable";
    entries.push(
      makeEntry({
        domainPath: "maturity",
        entityId: `maturity:${dimension}`,
        label: stringField(targetDim ?? sourceDim, "label") ?? dimension,
        type: identical ? "unchanged" : "modified",
        lineage,
        evidenceRefs: [],
        detail: identical ? "No change detected." : `${dimension} maturity score changed from ${sourceScore ?? "unknown"} to ${targetScore ?? "unknown"}.`,
        evidenceChanged: !identical,
        isRuntimeEntity: false,
      }),
    );
  }
  return entries;
}

export function diffPortfolio(input: PortfolioDiffInput): PortfolioChangeSet {
  const sourceRoot = asRecord(input.sourceArtifact);
  const targetRoot = asRecord(input.targetArtifact);

  const groups: GroupSpec[] = [
    {
      domainPath: "products",
      sourceList: asArray(sourceRoot?.products),
      targetList: asArray(targetRoot?.products),
      labelOf: (e) => stringField(e, "displayName") ?? idOf(e),
      evidenceIdsOf: () => [],
      isRuntimeEntity: true,
      attributeRemovalCauses: false,
    },
    {
      domainPath: "relationships",
      sourceList: asArray(sourceRoot?.relationships),
      targetList: asArray(targetRoot?.relationships),
      labelOf: (e) => stringField(e, "statement") ?? idOf(e),
      evidenceIdsOf: (e) => arrayField(e, "evidenceIds"),
      isRuntimeEntity: false,
      attributeRemovalCauses: true,
    },
    {
      domainPath: "unresolvedRelationships",
      sourceList: asArray(sourceRoot?.unresolvedRelationships),
      targetList: asArray(targetRoot?.unresolvedRelationships),
      labelOf: (e) => stringField(e, "statement") ?? idOf(e),
      evidenceIdsOf: (e) => arrayField(e, "evidenceIds"),
      isRuntimeEntity: false,
      attributeRemovalCauses: true,
    },
    {
      domainPath: "dependencyGraph.edges",
      sourceList: asArray(recordField(sourceRoot, "dependencyGraph")?.edges),
      targetList: asArray(recordField(targetRoot, "dependencyGraph")?.edges),
      labelOf: (e) => `${stringField(e, "sourceProductId") ?? "?"} -> ${stringField(e, "targetId") ?? "?"}`,
      evidenceIdsOf: (e) => arrayField(e, "evidenceIds"),
      isRuntimeEntity: true,
      attributeRemovalCauses: true,
    },
    {
      domainPath: "overlaps",
      sourceList: asArray(sourceRoot?.overlaps),
      targetList: asArray(targetRoot?.overlaps),
      labelOf: (e) => stringField(e, "statement") ?? idOf(e),
      evidenceIdsOf: (e) => arrayField(e, "evidenceIds"),
      isRuntimeEntity: false,
      attributeRemovalCauses: false,
    },
    {
      domainPath: "gaps",
      sourceList: asArray(sourceRoot?.gaps),
      targetList: asArray(targetRoot?.gaps),
      labelOf: (e) => stringField(e, "statement") ?? idOf(e),
      evidenceIdsOf: (e) => arrayField(e, "evidenceIds"),
      isRuntimeEntity: false,
      attributeRemovalCauses: false,
    },
  ];

  let changes: GovernanceChangeEntry[] = [];
  for (const group of groups) changes.push(...diffGroup(group, input.sourceSnapshot, input.targetSnapshot));
  changes.push(...diffMaturity(sourceRoot, targetRoot));

  changes = sortChangeEntries(changes);

  // BUG FIX: see architecture-diff.ts's identical fix for the full
  // rationale -- this changeset-level field must reflect only snapshot
  // comparability, not any individual relationship/maturity entity's
  // compatibility_impact, or a single removed relationship would poison the
  // whole changeset to "incompatible" and mask itself behind
  // policy-evaluator.ts's compatibility-gated "unverifiable".
  const compatibility: GovernanceCompatibilityStatus = domainCompatibility("portfolio", input.sourceSnapshot, input.targetSnapshot);

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(changes.flatMap((c) => c.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId("portfolio", input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    portfolio_id: input.targetSnapshot.portfolio_id ?? input.sourceSnapshot.portfolio_id,
    compatibility,
    changes,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
