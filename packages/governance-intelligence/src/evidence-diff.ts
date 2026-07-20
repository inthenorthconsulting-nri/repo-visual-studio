import type { ArchitectureChangeSet, CapabilityChangeSet, EvidenceChangeSet, EvidenceRef, GovernanceChangeEntry, GovernanceEvidenceChangeEntry, GovernanceEvidenceChangeType, IntelligenceSnapshot, PortfolioChangeSet, ProductChangeSet } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { dedupeEvidenceRefs, sortEvidenceChangeEntries, sortEvidenceRefs, worstCompatibility } from "./diff-utils.js";
import { buildChangeSetId, buildEvidenceChangeId } from "./ids.js";

// ---------------------------------------------------------------------------
// diffEvidence -- DIFFERENT input shape from the other four diff engines: it
// does not read raw artifact JSON at all. It rolls up the four *ChangeSet
// outputs that architecture-diff.ts/capability-diff.ts/product-diff.ts/
// portfolio-diff.ts already produced, scanning every GovernanceChangeEntry
// they emitted for a `lineage` of "weakened"/"broken" (and, for symmetry,
// "strengthened"). This is a deliberate design choice, not an oversight: each
// of those four engines has already done the work of computing per-entity
// evidence lineage (via diff-utils.ts's computeLineage) against upstream
// artifact shapes this module would otherwise have to know about all over
// again. Re-deriving lineage from raw architecture/capability/product/
// portfolio JSON a fifth time here would mean four more copies of
// domain-specific evidence-array extraction logic, all to reproduce a
// judgment the four engines already made. Rolling up their output instead
// keeps "what counts as weakened/broken evidence" defined in exactly one
// place per domain (the diff engine itself) while still giving evidence
// regressions their own dedicated, evidence_ref-grained changeset.
// ---------------------------------------------------------------------------

export interface EvidenceDiffInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  architectureChanges: ArchitectureChangeSet;
  capabilityChanges: CapabilityChangeSet;
  productChanges: ProductChangeSet;
  /** Optional: diffPortfolio may not have run (e.g. no portfolio artifact available for either snapshot) -- see ContinuousIntelligenceReport.portfolio_changes, which is itself optional for the same reason. */
  portfolioChanges?: PortfolioChangeSet;
}

function evidenceChangeTypeFor(entry: GovernanceChangeEntry): GovernanceEvidenceChangeType | undefined {
  if (entry.lineage === "broken" || entry.lineage === "weakened") return "removed";
  if (entry.lineage === "strengthened") return "added";
  if (entry.lineage === "unverifiable") return "unresolved";
  return undefined;
}

function detailFor(entry: GovernanceChangeEntry, changeType: GovernanceEvidenceChangeType): string {
  const base = `${entry.domain_path}/${entry.entity_id}: lineage ${entry.lineage}`;
  if (changeType === "removed") return `${base} -- evidence support for this entity was lost or reduced.`;
  if (changeType === "added") return `${base} -- evidence support for this entity increased.`;
  return `${base} -- evidence lineage could not be determined from count alone.`;
}

function collectFromChangeSet(changes: GovernanceChangeEntry[] | undefined): GovernanceEvidenceChangeEntry[] {
  const out: GovernanceEvidenceChangeEntry[] = [];
  if (!changes) return out;
  for (const entry of changes) {
    if (entry.type === "unchanged") continue;
    const changeType = evidenceChangeTypeFor(entry);
    if (!changeType) continue;
    // One GovernanceEvidenceChangeEntry per evidence_ref, not per entity, so
    // findings stay evidence_ref-grained per contracts.ts's EvidenceChangeSet
    // sort order (type, source_artifact, path, lines). An entity with no
    // evidence_refs at all (e.g. a removed entity whose evidence was already
    // empty) still surfaces once, keyed on a synthetic path, so a broken-
    // lineage finding is never silently dropped for lack of a concrete ref.
    if (entry.evidence_refs.length === 0) {
      const syntheticRef: EvidenceRef = { path: `${entry.domain_path}/${entry.entity_id}`, source_artifact: entry.classification.domain === "evidence" ? "repository" : entry.classification.domain };
      out.push({
        id: buildEvidenceChangeId(changeType, syntheticRef.source_artifact, syntheticRef.path),
        evidence_ref: syntheticRef,
        type: changeType,
        related_entity_id: entry.entity_id,
        detail: detailFor(entry, changeType),
      });
      continue;
    }
    for (const ref of entry.evidence_refs) {
      out.push({
        id: buildEvidenceChangeId(changeType, ref.source_artifact, ref.path),
        evidence_ref: ref,
        type: changeType,
        related_entity_id: entry.entity_id,
        detail: detailFor(entry, changeType),
      });
    }
  }
  return out;
}

function dedupeEvidenceChanges(entries: GovernanceEvidenceChangeEntry[]): GovernanceEvidenceChangeEntry[] {
  const seen = new Set<string>();
  const out: GovernanceEvidenceChangeEntry[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      out.push(entry);
    }
  }
  return out;
}

export function diffEvidence(input: EvidenceDiffInput): EvidenceChangeSet {
  const collected = [
    ...collectFromChangeSet(input.architectureChanges.changes),
    ...collectFromChangeSet(input.capabilityChanges.changes),
    ...collectFromChangeSet(input.productChanges.changes),
    ...collectFromChangeSet(input.portfolioChanges?.changes),
  ];

  const changes = sortEvidenceChangeEntries(dedupeEvidenceChanges(collected));

  const compatibility = worstCompatibility([
    input.architectureChanges.compatibility,
    input.capabilityChanges.compatibility,
    input.productChanges.compatibility,
    ...(input.portfolioChanges ? [input.portfolioChanges.compatibility] : []),
  ]);

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(changes.map((c) => c.evidence_ref)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId("evidence", input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    repository_id: input.targetSnapshot.repository_id ?? input.sourceSnapshot.repository_id,
    compatibility,
    changes,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
