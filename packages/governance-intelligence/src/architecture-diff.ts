import { classifyChange } from "./change-classification.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import type { EvidenceRef, GovernanceChangeEntry, GovernanceChangeType, GovernanceCompatibilityStatus, GovernanceLineageState, IntelligenceSnapshot } from "./contracts.js";
import {
  arrayField,
  asArray,
  asRecord,
  computeLineage,
  dedupeEvidenceRefs,
  detectConservativeRenames,
  domainCompatibility,
  normalizedLabelOf,
  recordField,
  sameValue,
  sortChangeEntries,
  sortEvidenceRefs,
  stringField,
  toEvidenceRefs,
} from "./diff-utils.js";
import { buildChangeId, buildChangeSetId } from "./ids.js";
import type { ArchitectureChangeSet } from "./contracts.js";

// ---------------------------------------------------------------------------
// diffArchitecture -- compares two raw ArchitectureIntelligence JSON objects
// (see packages/architecture-intelligence/src/types.ts) alongside the two
// IntelligenceSnapshots that fingerprinted them. The snapshot itself only
// carries a digest, never the raw artifact (see contracts.ts's
// IntelligenceSnapshot doc comment) -- hence the separate sourceArtifact/
// targetArtifact inputs, mirroring how buildIntelligenceSnapshot itself
// receives raw JSON.
// ---------------------------------------------------------------------------

export interface ArchitectureDiffInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  /** Already-parsed JSON of the source `.rvs/cache/architecture-intelligence.json` (ArchitectureIntelligence), if available. */
  sourceArtifact: unknown;
  /** Already-parsed JSON of the target `.rvs/cache/architecture-intelligence.json` (ArchitectureIntelligence), if available. */
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
    domain: "architecture",
    changeType: args.type,
    isRuntimeEntity: args.isRuntimeEntity,
    lineage: args.lineage,
    evidenceChanged: args.evidenceChanged,
  });
  return {
    id: buildChangeId("architecture", args.type, args.entityId),
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

function diffTopLevelKeys(source: Record<string, unknown>, target: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(source), ...Object.keys(target)]);
  const diffs: string[] = [];
  for (const key of keys) {
    if (!sameValue(source[key], target[key])) diffs.push(key);
  }
  return diffs.sort();
}

interface GroupSpec {
  domainPath: string;
  sourceList: Record<string, unknown>[];
  targetList: Record<string, unknown>[];
  kindOf: (entity: Record<string, unknown>) => string | undefined;
  labelOf: (entity: Record<string, unknown>) => string;
  evidenceOf: (entity: Record<string, unknown>) => unknown[];
  isRuntimeEntity: (entity: Record<string, unknown>) => boolean;
  allowRename: boolean;
}

function idOf(entity: Record<string, unknown>): string {
  return stringField(entity, "id") ?? "";
}

function diffGroup(spec: GroupSpec): GovernanceChangeEntry[] {
  const sourceById = new Map(spec.sourceList.map((e) => [idOf(e), e]));
  const targetById = new Map(spec.targetList.map((e) => [idOf(e), e]));

  let removed = [...sourceById.entries()].filter(([id]) => !targetById.has(id)).map(([, e]) => e);
  let added = [...targetById.entries()].filter(([id]) => !sourceById.has(id)).map(([, e]) => e);
  const commonIds = [...sourceById.keys()].filter((id) => targetById.has(id));

  let renamedPairs: { from: Record<string, unknown>; to: Record<string, unknown> }[] = [];
  if (spec.allowRename) {
    const result = detectConservativeRenames(removed, added, spec.kindOf, spec.evidenceOf);
    renamedPairs = result.renamed;
    removed = result.removedRemaining;
    added = result.addedRemaining;
  }

  const entries: GovernanceChangeEntry[] = [];

  for (const entity of added) {
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: idOf(entity),
        label: spec.labelOf(entity),
        type: "added",
        lineage: "preserved",
        evidenceRefs: toEvidenceRefs(spec.evidenceOf(entity), "architecture"),
        detail: `Added to ${spec.domainPath}.`,
        evidenceChanged: true,
        isRuntimeEntity: spec.isRuntimeEntity(entity),
      }),
    );
  }

  for (const entity of removed) {
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: idOf(entity),
        label: spec.labelOf(entity),
        type: "removed",
        lineage: "broken",
        evidenceRefs: toEvidenceRefs(spec.evidenceOf(entity), "architecture"),
        detail: `Removed from ${spec.domainPath}.`,
        evidenceChanged: true,
        isRuntimeEntity: spec.isRuntimeEntity(entity),
      }),
    );
  }

  for (const { from, to } of renamedPairs) {
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: idOf(to),
        label: spec.labelOf(to),
        type: "renamed",
        lineage: "preserved",
        evidenceRefs: toEvidenceRefs(spec.evidenceOf(to), "architecture"),
        detail: `Renamed from id "${idOf(from)}" to "${idOf(to)}" (matched by identical kind + byte-identical evidence).`,
        evidenceChanged: false,
        isRuntimeEntity: spec.isRuntimeEntity(to),
      }),
    );
  }

  for (const id of commonIds) {
    const source = sourceById.get(id)!;
    const target = targetById.get(id)!;
    const identical = sameValue(source, target);
    const sourceEvidence = spec.evidenceOf(source);
    const targetEvidence = spec.evidenceOf(target);
    const evidenceChanged = !sameValue(sourceEvidence, targetEvidence);
    const lineage = computeLineage(sourceEvidence, targetEvidence);
    const diffs = diffTopLevelKeys(source, target);
    entries.push(
      makeEntry({
        domainPath: spec.domainPath,
        entityId: id,
        label: spec.labelOf(target),
        type: identical ? "unchanged" : "modified",
        lineage: identical ? "preserved" : lineage,
        evidenceRefs: toEvidenceRefs(targetEvidence, "architecture"),
        detail: identical ? "No change detected." : `Changed fields: ${diffs.join(", ")}.`,
        evidenceChanged,
        isRuntimeEntity: spec.isRuntimeEntity(target),
      }),
    );
  }

  return entries;
}

/** Diffs the plain-string `implementation.entryPoints` list of a component present in both snapshots -- entryPoints have no id of their own (see LogicalComponent/ImplementationView in architecture-intelligence's types.ts), so each entry point is diffed by its literal string value, scoped under the owning component's id. Only run for components present in both snapshots: an entirely added/removed component already reports its whole entryPoints set via that component's own added/removed entry. */
function diffEntryPoints(componentId: string, source: Record<string, unknown>, target: Record<string, unknown>): GovernanceChangeEntry[] {
  const sourceEntryPoints = new Set(arrayField(recordField(source, "implementation"), "entryPoints").filter((v): v is string => typeof v === "string"));
  const targetEntryPoints = new Set(arrayField(recordField(target, "implementation"), "entryPoints").filter((v): v is string => typeof v === "string"));
  const domainPath = `components.${componentId}.implementation.entryPoints`;
  const entries: GovernanceChangeEntry[] = [];

  for (const entryPoint of targetEntryPoints) {
    if (sourceEntryPoints.has(entryPoint)) continue;
    entries.push(
      makeEntry({
        domainPath,
        entityId: `${componentId}:entrypoint:${entryPoint}`,
        label: entryPoint,
        type: "added",
        lineage: "preserved",
        evidenceRefs: [],
        detail: `Runtime entry point "${entryPoint}" added to component "${componentId}".`,
        evidenceChanged: true,
        isRuntimeEntity: true,
      }),
    );
  }
  for (const entryPoint of sourceEntryPoints) {
    if (targetEntryPoints.has(entryPoint)) continue;
    entries.push(
      makeEntry({
        domainPath,
        entityId: `${componentId}:entrypoint:${entryPoint}`,
        label: entryPoint,
        type: "removed",
        lineage: "broken",
        evidenceRefs: [],
        detail: `Runtime entry point "${entryPoint}" removed from component "${componentId}".`,
        evidenceChanged: true,
        isRuntimeEntity: true,
      }),
    );
  }
  return entries;
}

function workflowFamilyEvidence(entity: Record<string, unknown>): unknown[] {
  return arrayField(recordField(entity, "description"), "evidence");
}

export function diffArchitecture(input: ArchitectureDiffInput): ArchitectureChangeSet {
  const sourceRoot = asRecord(input.sourceArtifact);
  const targetRoot = asRecord(input.targetArtifact);

  const sourceComponents = asArray(sourceRoot?.components);
  const targetComponents = asArray(targetRoot?.components);

  const groups: GroupSpec[] = [
    {
      domainPath: "components",
      sourceList: sourceComponents,
      targetList: targetComponents,
      kindOf: (e) => stringField(e, "kind"),
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      isRuntimeEntity: () => true,
      allowRename: true,
    },
    {
      domainPath: "workflowFamilies",
      sourceList: asArray(sourceRoot?.workflowFamilies),
      targetList: asArray(targetRoot?.workflowFamilies),
      // WorkflowFamily has no `kind` field, so the conservative rename
      // heuristic (which requires a matching kind) can never fire for this
      // group -- every workflow-family id change is a removed+added pair.
      kindOf: () => undefined,
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: workflowFamilyEvidence,
      isRuntimeEntity: () => true,
      allowRename: true,
    },
    {
      domainPath: "flows",
      sourceList: asArray(sourceRoot?.flows),
      targetList: asArray(targetRoot?.flows),
      kindOf: (e) => stringField(e, "kind"),
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      isRuntimeEntity: () => true,
      allowRename: true,
    },
    {
      domainPath: "dependencies",
      sourceList: asArray(sourceRoot?.dependencies),
      targetList: asArray(targetRoot?.dependencies),
      kindOf: (e) => stringField(e, "kind"),
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      // "build"-kind dependencies don't affect what's actually running.
      isRuntimeEntity: (e) => stringField(e, "kind") !== "build",
      allowRename: true,
    },
    {
      domainPath: "actors",
      sourceList: asArray(sourceRoot?.actors),
      targetList: asArray(targetRoot?.actors),
      kindOf: (e) => stringField(e, "kind"),
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      isRuntimeEntity: () => false,
      allowRename: true,
    },
    {
      domainPath: "externalSystems",
      sourceList: asArray(sourceRoot?.externalSystems),
      targetList: asArray(targetRoot?.externalSystems),
      kindOf: () => undefined,
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      isRuntimeEntity: () => false,
      allowRename: false,
    },
    {
      domainPath: "boundaries",
      sourceList: asArray(sourceRoot?.boundaries),
      targetList: asArray(targetRoot?.boundaries),
      kindOf: (e) => stringField(e, "kind"),
      labelOf: (e) => normalizedLabelOf(e, "label", idOf(e)),
      evidenceOf: (e) => arrayField(e, "evidence"),
      isRuntimeEntity: () => false,
      allowRename: false,
    },
  ];

  let changes: GovernanceChangeEntry[] = [];
  for (const group of groups) changes.push(...diffGroup(group));

  const sourceComponentById = new Map(sourceComponents.map((c) => [idOf(c), c]));
  const targetComponentById = new Map(targetComponents.map((c) => [idOf(c), c]));
  for (const [id, targetComponent] of targetComponentById) {
    const sourceComponent = sourceComponentById.get(id);
    if (sourceComponent) changes.push(...diffEntryPoints(id, sourceComponent, targetComponent));
  }

  changes = sortChangeEntries(changes);

  // BUG FIX: this changeset-level field must reflect ONLY whether the two
  // snapshots are comparable at all (contracts.ts's own doc comment on
  // GovernanceCompatibilityStatus: "Whether two snapshots... can be
  // meaningfully compared/evaluated at all"), never an individual entity's
  // content-level compatibility_impact. Folding `changes.map(c =>
  // c.classification.compatibility_impact)` in here meant ANY single
  // removed runtime entity (always compatibility_impact "incompatible" via
  // its broken lineage) poisoned this WHOLE changeset to "incompatible" --
  // which then made policy-evaluator.ts's evaluateEntityScopedRule gate
  // (which treats a "partial"/"incompatible" changeset as untrustworthy and
  // short-circuits to "unverifiable") permanently mask the exact removal
  // that rules like require_runtime_entrypoint/forbid_component_removal/
  // forbid_dependency_removal exist to catch: a real removal could never
  // actually surface as "fail" end-to-end, only ever "unverifiable".
  const compatibility: GovernanceCompatibilityStatus = domainCompatibility("architecture", input.sourceSnapshot, input.targetSnapshot);

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(changes.flatMap((c) => c.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId("architecture", input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    repository_id: input.targetSnapshot.repository_id ?? input.sourceSnapshot.repository_id,
    compatibility,
    changes,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
