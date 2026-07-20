import type { ArchitectureChangeSet, BlastRadiusAssessment, BlastRadiusEntry, BlastRadiusLevel, CapabilityChangeSet, EvidenceRef, GovernanceChangeEntry, IntelligenceSnapshot, PortfolioChangeSet, ProductChangeSet } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { arrayField, asArray, asRecord, dedupeEvidenceRefs, recordField, sortEvidenceRefs, stringField } from "./diff-utils.js";
import { buildBlastRadiusAssessmentId, buildBlastRadiusEntryId } from "./ids.js";

// ---------------------------------------------------------------------------
// assessBlastRadius -- conservative reach assessment for every non-"unchanged"
// GovernanceChangeEntry across the four *ChangeSets. This is intentionally a
// SEPARATE stage from classifyChange (change-classification.ts): classifying
// a single entity's own change has no access to the surrounding
// dependency/consumer graph, so classifyChange.consumer_impact is always
// "unresolved" except for "unchanged" entries (see change-classification.ts's
// deriveConsumerImpact doc comment). This module is where that graph lookup
// actually happens, using the raw target/source artifact JSON (the
// *ChangeSet entries themselves don't carry the full dependency graph, only
// per-entity classification).
//
// §-critical rule (tested explicitly, and checked FIRST for every entity
// before any other reasoning): "if NO consumer/dependency edge data exists
// for an entity, level MUST be unresolved, NEVER isolated." A confirmed,
// data-backed absence of connections ("this entity has zero neighbors, and I
// positively know that because the edge list exists and simply doesn't
// mention it") is "isolated". A structural absence of any way to even ask the
// question ("this entity's type carries no linkage field at all") is
// "unresolved" -- this package never treats "I don't know" as "no impact".
// ---------------------------------------------------------------------------

export interface BlastRadiusInput {
  sourceSnapshot: IntelligenceSnapshot;
  targetSnapshot: IntelligenceSnapshot;
  architectureChanges: ArchitectureChangeSet;
  capabilityChanges: CapabilityChangeSet;
  productChanges: ProductChangeSet;
  portfolioChanges?: PortfolioChangeSet;
  /** Already-parsed JSON of the source/target `.rvs/cache/architecture-intelligence.json`, used to look up `flows[].fromId/toId` -- the only edge-shaped linkage architecture-intelligence carries (see architecture-intelligence/src/types.ts: ArchitectureDependency has no fromId/toId at all). */
  sourceArchitectureArtifact: unknown;
  targetArchitectureArtifact: unknown;
  /** Already-parsed JSON of the source/target `.rvs/cache/capability-model.json`, used to look up each capability's `logicalComponents: string[]` linkage (see capability-intelligence/src/contracts.ts: only `Capability` carries this field -- `ExcludedCapabilityCandidate` does not). */
  sourceCapabilityArtifact: unknown;
  targetCapabilityArtifact: unknown;
  /** Already-parsed JSON of the source/target `.rvs/cache/portfolio-model.json`, used to look up `relationships[].productAId/productBId` and `dependencyGraph.edges[].sourceProductId/targetId`. */
  sourcePortfolioArtifact: unknown;
  targetPortfolioArtifact: unknown;
}

interface LevelResult {
  level: BlastRadiusLevel;
  affected: string[];
  rationale: string;
}

function unresolved(rationale: string): LevelResult {
  return { level: "unresolved", affected: [], rationale };
}

function isolated(rationale: string, self: string): LevelResult {
  return { level: "isolated", affected: [self], rationale };
}

// ---------------------------------------------------------------------------
// Architecture graph (flows[] is the only fromId/toId-bearing list)
// ---------------------------------------------------------------------------

interface ArchitectureGraph {
  /** True only when the artifact's `flows` field is itself a present array (even if empty) -- i.e. the upstream engine positively computed "these are all the flow edges", as opposed to the artifact being unavailable/malformed. */
  flowsAvailable: boolean;
  neighbors: Map<string, Set<string>>;
}

function buildArchitectureGraph(artifact: unknown): ArchitectureGraph {
  const root = asRecord(artifact);
  const rawFlows = root?.flows;
  const flowsAvailable = Array.isArray(rawFlows);
  const neighbors = new Map<string, Set<string>>();
  for (const flow of asArray(rawFlows)) {
    const from = stringField(flow, "fromId");
    const to = stringField(flow, "toId");
    if (!from || !to) continue;
    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(to)) neighbors.set(to, new Set());
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  }
  return { flowsAvailable, neighbors };
}

function findArchEntity(sourceRoot: Record<string, unknown> | undefined, targetRoot: Record<string, unknown> | undefined, listKey: string, id: string): Record<string, unknown> | undefined {
  return asArray(targetRoot?.[listKey]).find((e) => stringField(e, "id") === id) ?? asArray(sourceRoot?.[listKey]).find((e) => stringField(e, "id") === id);
}

function architectureLevel(entry: GovernanceChangeEntry, graph: ArchitectureGraph, sourceRoot: Record<string, unknown> | undefined, targetRoot: Record<string, unknown> | undefined): LevelResult {
  // Critical rule, checked first: no flow-edge data at all in the artifact ->
  // unresolved, regardless of which group this entity belongs to.
  if (!graph.flowsAvailable) {
    return unresolved(`No flow-edge data is available in the architecture artifact to determine consumers of "${entry.entity_id}".`);
  }

  if (entry.domain_path === "dependencies") {
    // ArchitectureDependency (architecture-intelligence/src/types.ts) has no
    // fromId/toId or any other linkage field -- there is structurally no way
    // to know what depends on it, even though `flows` itself is available.
    return unresolved(`ArchitectureDependency "${entry.entity_id}" carries no fromId/toId or other consumer-linkage field, so its reach cannot be determined.`);
  }

  if (entry.domain_path.endsWith(".implementation.entryPoints")) {
    const componentId = entry.entity_id.split(":entrypoint:")[0] ?? "";
    const neighbors = graph.neighbors.get(componentId);
    if (!neighbors || neighbors.size === 0) {
      return { level: "local", affected: [componentId], rationale: `Runtime entry point belongs to component "${componentId}", which has no flow edges connecting it to other components/actors/systems.` };
    }
    return { level: "product_wide", affected: [componentId, ...neighbors].sort(), rationale: `Runtime entry point belongs to component "${componentId}", which has ${neighbors.size} flow-connected entit${neighbors.size === 1 ? "y" : "ies"} that may depend on it.` };
  }

  if (entry.domain_path === "workflowFamilies") {
    const record = findArchEntity(sourceRoot, targetRoot, "workflowFamilies", entry.entity_id);
    const workflowGraphIds = arrayField(record, "workflowGraphIds").filter((v): v is string => typeof v === "string");
    if (workflowGraphIds.length === 0) {
      return isolated(`Workflow family "${entry.entity_id}" has no linked workflow graphs.`, entry.entity_id);
    }
    return { level: "product_wide", affected: [entry.entity_id, ...workflowGraphIds].sort(), rationale: `Workflow family "${entry.entity_id}" maps to ${workflowGraphIds.length} runtime workflow graph(s), making it a product-facing surface.` };
  }

  if (entry.domain_path === "components") {
    const neighbors = graph.neighbors.get(entry.entity_id);
    if (!neighbors || neighbors.size === 0) return isolated(`Component "${entry.entity_id}" has no flow edges connecting it to other components/actors/systems.`, entry.entity_id);
    return { level: "cross_component", affected: [entry.entity_id, ...neighbors].sort(), rationale: `Component "${entry.entity_id}" has ${neighbors.size} flow-connected entit${neighbors.size === 1 ? "y" : "ies"}.` };
  }

  if (entry.domain_path === "flows") {
    const record = findArchEntity(sourceRoot, targetRoot, "flows", entry.entity_id);
    const from = stringField(record, "fromId");
    const to = stringField(record, "toId");
    if (!from || !to) return unresolved(`Flow "${entry.entity_id}" no longer resolves to a fromId/toId pair in either snapshot's artifact.`);
    return { level: "cross_component", affected: [from, to].sort(), rationale: `Flow "${entry.entity_id}" directly connects "${from}" and "${to}".` };
  }

  if (entry.domain_path === "actors" || entry.domain_path === "externalSystems") {
    const neighbors = graph.neighbors.get(entry.entity_id);
    if (!neighbors || neighbors.size === 0) return isolated(`"${entry.entity_id}" has no flow edges connecting it into the architecture graph.`, entry.entity_id);
    return { level: "cross_component", affected: [entry.entity_id, ...neighbors].sort(), rationale: `"${entry.entity_id}" has ${neighbors.size} flow-connected component(s).` };
  }

  if (entry.domain_path === "boundaries") {
    const record = findArchEntity(sourceRoot, targetRoot, "boundaries", entry.entity_id);
    const containedComponentIds = arrayField(record, "containedComponentIds").filter((v): v is string => typeof v === "string");
    if (containedComponentIds.length === 0) return isolated(`Boundary "${entry.entity_id}" contains no components.`, entry.entity_id);
    if (containedComponentIds.length === 1) return { level: "local", affected: containedComponentIds, rationale: `Boundary "${entry.entity_id}" contains exactly one component.` };
    return { level: "cross_component", affected: containedComponentIds.sort(), rationale: `Boundary "${entry.entity_id}" contains ${containedComponentIds.length} components.` };
  }

  return unresolved(`No blast-radius rule is defined for architecture domain_path "${entry.domain_path}".`);
}

// ---------------------------------------------------------------------------
// Capability: Capability carries `logicalComponents: string[]` (real linkage
// into architecture); ExcludedCapabilityCandidate carries no such field at
// all (see capability-intelligence/src/contracts.ts) -- so entries that
// landed in `excludedCandidates` have no consumer data structurally,
// regardless of what the other buckets look like.
// ---------------------------------------------------------------------------

const LIVE_CAPABILITY_BUCKETS = new Set(["includedCapabilities", "qualifiedCapabilities"]);

function capabilityLevel(entry: GovernanceChangeEntry, sourceRoot: Record<string, unknown> | undefined, targetRoot: Record<string, unknown> | undefined): LevelResult {
  const bucket = entry.domain_path;
  const record = findArchEntity(sourceRoot, targetRoot, bucket, entry.entity_id);
  if (!record || !("logicalComponents" in record)) {
    // Critical rule: ExcludedCapabilityCandidate (or a bucket move we can no
    // longer resolve a record for) has no linkage field -- unresolved, never
    // isolated.
    return unresolved(`No "logicalComponents" linkage field is present for capability "${entry.entity_id}" in bucket "${bucket}" (excludedCandidates entries carry no such field).`);
  }
  const logicalComponents = arrayField(record, "logicalComponents").filter((v): v is string => typeof v === "string");
  if (logicalComponents.length === 0) {
    return isolated(`Capability "${entry.entity_id}" lists no logical components.`, entry.entity_id);
  }
  const level: BlastRadiusLevel = LIVE_CAPABILITY_BUCKETS.has(bucket) ? "product_wide" : "cross_component";
  return { level, affected: [entry.entity_id, ...logicalComponents].sort(), rationale: `Capability "${entry.entity_id}" (bucket: ${bucket}) maps to ${logicalComponents.length} logical component(s).` };
}

// ---------------------------------------------------------------------------
// Product: ProductIdentityModel carries no linkage into architecture/
// capability/portfolio at all (no componentIds, no capabilityIds) -- every
// product-domain change is structurally unresolved for blast-radius purposes.
// ---------------------------------------------------------------------------

function productLevel(entry: GovernanceChangeEntry): LevelResult {
  return unresolved(`ProductIdentityModel carries no linkage into architecture/capability/portfolio entities, so the reach of "${entry.entity_id}" cannot be determined from the product artifact alone.`);
}

// ---------------------------------------------------------------------------
// Portfolio: relationships/dependencyGraph.edges/overlaps/gaps carry real
// productId linkage; maturity dimensions are portfolio-global scores by
// definition (their "reach" is the whole portfolio, not a lookup failure).
// ---------------------------------------------------------------------------

function portfolioLevel(entry: GovernanceChangeEntry, sourceRoot: Record<string, unknown> | undefined, targetRoot: Record<string, unknown> | undefined): LevelResult {
  if (entry.domain_path === "maturity") {
    return { level: "portfolio_wide", affected: [entry.entity_id], rationale: `"${entry.entity_id}" is a portfolio-aggregate maturity score, which by definition describes the whole portfolio.` };
  }

  if (entry.domain_path === "relationships" || entry.domain_path === "unresolvedRelationships") {
    const record = findArchEntity(sourceRoot, targetRoot, entry.domain_path, entry.entity_id);
    const a = stringField(record, "productAId");
    const b = stringField(record, "productBId");
    if (!a || !b) return unresolved(`Relationship "${entry.entity_id}" no longer resolves to a productAId/productBId pair in either snapshot's artifact.`);
    return { level: "cross_product", affected: [a, b].sort(), rationale: `Relationship "${entry.entity_id}" directly connects products "${a}" and "${b}".` };
  }

  if (entry.domain_path === "dependencyGraph.edges") {
    const record = findArchEntity(sourceRoot, targetRoot, "dependencyGraph", entry.entity_id) ?? asArray(recordField(targetRoot, "dependencyGraph")?.edges).find((e) => stringField(e, "id") === entry.entity_id) ?? asArray(recordField(sourceRoot, "dependencyGraph")?.edges).find((e) => stringField(e, "id") === entry.entity_id);
    const source = stringField(record, "sourceProductId");
    const target = stringField(record, "targetId");
    if (!source || !target) return unresolved(`Dependency edge "${entry.entity_id}" no longer resolves to a sourceProductId/targetId pair in either snapshot's artifact.`);
    return { level: "cross_product", affected: [source, target].sort(), rationale: `Dependency edge "${entry.entity_id}" directly connects "${source}" and "${target}".` };
  }

  if (entry.domain_path === "overlaps") {
    const record = findArchEntity(sourceRoot, targetRoot, "overlaps", entry.entity_id);
    const productIds = arrayField(record, "productIds").filter((v): v is string => typeof v === "string");
    if (productIds.length === 0) return unresolved(`Overlap "${entry.entity_id}" no longer resolves to any productIds in either snapshot's artifact.`);
    if (productIds.length === 1) return { level: "product_wide", affected: productIds, rationale: `Overlap "${entry.entity_id}" names exactly one product.` };
    return { level: "cross_product", affected: [...productIds].sort(), rationale: `Overlap "${entry.entity_id}" spans ${productIds.length} products.` };
  }

  if (entry.domain_path === "gaps") {
    const record = findArchEntity(sourceRoot, targetRoot, "gaps", entry.entity_id);
    const affectedProductIds = arrayField(record, "affectedProductIds").filter((v): v is string => typeof v === "string");
    if (affectedProductIds.length === 0) return unresolved(`Gap "${entry.entity_id}" no longer resolves to any affectedProductIds in either snapshot's artifact.`);
    if (affectedProductIds.length === 1) return { level: "product_wide", affected: affectedProductIds, rationale: `Gap "${entry.entity_id}" names exactly one affected product.` };
    return { level: "cross_product", affected: [...affectedProductIds].sort(), rationale: `Gap "${entry.entity_id}" affects ${affectedProductIds.length} products.` };
  }

  if (entry.domain_path === "products") {
    const relationships = asArray(targetRoot?.relationships).length > 0 || asArray(sourceRoot?.relationships).length > 0 || Array.isArray(targetRoot?.relationships) || Array.isArray(sourceRoot?.relationships);
    if (!relationships) return unresolved(`No relationship/dependency data is available in the portfolio artifact to determine what depends on product "${entry.entity_id}".`);
    const touchesProduct = (rec: Record<string, unknown>, aKey: string, bKey: string) => stringField(rec, aKey) === entry.entity_id || stringField(rec, bKey) === entry.entity_id;
    const relTouches = [...asArray(targetRoot?.relationships), ...asArray(sourceRoot?.relationships)].some((r) => touchesProduct(r, "productAId", "productBId"));
    const depTouches = [...asArray(recordField(targetRoot, "dependencyGraph")?.edges), ...asArray(recordField(sourceRoot, "dependencyGraph")?.edges)].some((e) => touchesProduct(e, "sourceProductId", "targetId"));
    if (!relTouches && !depTouches) return isolated(`Product "${entry.entity_id}" is not referenced by any relationship or dependency edge in either snapshot's artifact.`, entry.entity_id);
    return { level: "portfolio_wide", affected: [entry.entity_id], rationale: `Product "${entry.entity_id}" is referenced by at least one portfolio-level relationship or dependency edge.` };
  }

  return unresolved(`No blast-radius rule is defined for portfolio domain_path "${entry.domain_path}".`);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function toBlastRadiusEntry(entry: GovernanceChangeEntry, result: LevelResult): BlastRadiusEntry {
  const affected = [...new Set(result.affected)].sort();
  const evidenceRefs: EvidenceRef[] = sortEvidenceRefs(dedupeEvidenceRefs(entry.evidence_refs));
  return {
    id: buildBlastRadiusEntryId(entry.id),
    change_id: entry.id,
    level: result.level,
    affected_entity_ids: affected,
    rationale: result.rationale,
    evidence_refs: evidenceRefs,
  };
}

const LEVEL_RANK: Record<BlastRadiusLevel, number> = {
  isolated: 0,
  local: 1,
  cross_component: 2,
  product_wide: 3,
  cross_product: 4,
  portfolio_wide: 5,
  unresolved: 6,
};

function sortEntries(entries: BlastRadiusEntry[]): BlastRadiusEntry[] {
  return [...entries].sort((a, b) => {
    if (LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]) return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    return a.change_id < b.change_id ? -1 : a.change_id > b.change_id ? 1 : 0;
  });
}

export function assessBlastRadius(input: BlastRadiusInput): BlastRadiusAssessment {
  const sourceArchRoot = asRecord(input.sourceArchitectureArtifact);
  const targetArchRoot = asRecord(input.targetArchitectureArtifact);
  const sourceCapabilityRoot = asRecord(input.sourceCapabilityArtifact);
  const targetCapabilityRoot = asRecord(input.targetCapabilityArtifact);
  const sourcePortfolioRoot = asRecord(input.sourcePortfolioArtifact);
  const targetPortfolioRoot = asRecord(input.targetPortfolioArtifact);

  const archGraph = buildArchitectureGraph(input.targetArchitectureArtifact ?? input.sourceArchitectureArtifact);

  const entries: BlastRadiusEntry[] = [];

  for (const entry of input.architectureChanges.changes) {
    if (entry.type === "unchanged") continue;
    entries.push(toBlastRadiusEntry(entry, architectureLevel(entry, archGraph, sourceArchRoot, targetArchRoot)));
  }

  for (const entry of input.capabilityChanges.changes) {
    if (entry.type === "unchanged") continue;
    entries.push(toBlastRadiusEntry(entry, capabilityLevel(entry, sourceCapabilityRoot, targetCapabilityRoot)));
  }

  for (const entry of input.productChanges.changes) {
    if (entry.type === "unchanged") continue;
    entries.push(toBlastRadiusEntry(entry, productLevel(entry)));
  }

  if (input.portfolioChanges) {
    for (const entry of input.portfolioChanges.changes) {
      if (entry.type === "unchanged") continue;
      entries.push(toBlastRadiusEntry(entry, portfolioLevel(entry, sourcePortfolioRoot, targetPortfolioRoot)));
    }
  }

  const sorted = sortEntries(entries);
  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(sorted.flatMap((e) => e.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildBlastRadiusAssessmentId(input.sourceSnapshot.id, input.targetSnapshot.id),
    source_snapshot_id: input.sourceSnapshot.id,
    target_snapshot_id: input.targetSnapshot.id,
    repository_id: input.targetSnapshot.repository_id ?? input.sourceSnapshot.repository_id,
    entries: sorted,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.targetSnapshot.generation.generated_at },
  };
}
