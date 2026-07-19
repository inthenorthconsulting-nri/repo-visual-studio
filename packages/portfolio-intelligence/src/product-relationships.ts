import type { CapabilityModel } from "@rvs/capability-intelligence";
import { type CapabilityPairRelationship, classifyAllCapabilityPairs } from "./capability-relationships.js";
import { collectCapabilityRefs } from "./capability-normalization.js";
import type { PortfolioCapability, PortfolioConfig, PortfolioEvidence, PortfolioProduct, PortfolioProductRelationship, PortfolioRelationshipConfidence, PortfolioRelationshipType } from "./contracts.js";
import { portfolioEvidenceId, portfolioRelationshipId } from "./ids.js";

// ---------------------------------------------------------------------------
// §10 Product-to-product relationships
//
// Derived from three evidence sources, in priority order:
//   1. `.rvs/portfolio.yml` approved_relationships — an explicit human
//      declaration always wins and is always "confirmed" confidence. This is
//      also the ONLY source for upstream_dependency/downstream_dependency/
//      shared_platform/shared_contract, since deriving those from evidence
//      would require consuming architecture-intelligence.json/
//      repository-model.json — recorded as present/absent by intake.ts but
//      not yet consumed by any synthesis module this milestone (a disclosed
//      scope trim, not a silent gap).
//   2. Cross-product capability relationships from capability-relationships.ts
//      (shared/complementary/overlapping/alternative_implementation/
//      unresolved), aggregated up from the capability pair level to one
//      relationship per (productA, productB, type).
//   3. A conservative actor/workflow-overlap fallback, emitted ONLY for
//      product pairs with zero capability-level relationship of any kind —
//      so shared-actor/shared-workflow evidence never buries or duplicates a
//      stronger, more specific capability-level relationship.
//
// Hard rule (§10): relationships are never inferred from shared-vendor or
// shared-platform *mentions* alone — every entry here traces to either an
// explicit config declaration or a concrete capability/actor/workflow
// overlap computed from the two products' own CapabilityModel evidence.
// ---------------------------------------------------------------------------

const SHARED_ACTOR_THRESHOLD = 0.34;
const SHARED_WORKFLOW_THRESHOLD = 0.34;

function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = a instanceof Set ? a : new Set(a);
  const sb = b instanceof Set ? b : new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection += 1;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function pairKey(productAId: string, productBId: string): string {
  return productAId.localeCompare(productBId) <= 0 ? `${productAId}::${productBId}` : `${productBId}::${productAId}`;
}

function orderPair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

const CAPABILITY_RELATIONSHIP_TYPE: Record<Exclude<CapabilityPairRelationship, "shared" | "distinct">, PortfolioRelationshipType> = {
  complementary: "complementary_capability",
  overlapping: "overlapping_capability",
  alternative_implementation: "alternative_implementation",
  unresolved: "unresolved",
};

interface Accumulator {
  productAId: string;
  productBId: string;
  type: PortfolioRelationshipType;
  capabilityIds: Set<string>;
  evidenceIds: Set<string>;
  scores: number[];
  configDeclared: boolean;
  note?: string;
}

function accumulatorKey(productAId: string, productBId: string, type: PortfolioRelationshipType): string {
  return `${pairKey(productAId, productBId)}::${type}`;
}

function confidenceForAccumulator(acc: Accumulator): PortfolioRelationshipConfidence {
  if (acc.configDeclared) return "confirmed";
  if (acc.type === "unresolved") return "unresolved";
  const avgScore = acc.scores.length > 0 ? acc.scores.reduce((sum, s) => sum + s, 0) / acc.scores.length : 0;
  if (acc.capabilityIds.size >= 2 || avgScore >= 0.45) return "derived";
  return "suggested";
}

function statementForAccumulator(acc: Accumulator, products: Map<string, PortfolioProduct>): string {
  const a = products.get(acc.productAId)?.displayName ?? acc.productAId;
  const b = products.get(acc.productBId)?.displayName ?? acc.productBId;
  if (acc.configDeclared && acc.note) return acc.note;
  switch (acc.type) {
    case "shared_capability":
      return `${a} and ${b} both implement the same normalized capabilit${acc.capabilityIds.size === 1 ? "y" : "ies"} (${acc.capabilityIds.size}).`;
    case "complementary_capability":
      return `${a} and ${b} implement distinct but related capabilities that appear to work together.`;
    case "overlapping_capability":
      return `${a} and ${b} implement capabilities with overlapping actors and outcomes; ownership of this responsibility is not yet clearly separated.`;
    case "alternative_implementation":
      return `${a} and ${b} appear to implement the same responsibility for different external systems.`;
    case "shared_actor":
      return `${a} and ${b} are used by an overlapping set of actors, based on their capability evidence.`;
    case "shared_workflow":
      return `${a} and ${b} participate in an overlapping set of workflows, based on their capability evidence.`;
    case "unresolved":
      return `${a} and ${b} show ambiguous or contradictory capability evidence; their relationship could not be confidently classified.`;
    case "upstream_dependency":
      return `${a} is declared as an upstream dependency of ${b}.`;
    case "downstream_dependency":
      return `${a} is declared as a downstream dependency of ${b}.`;
    case "shared_platform":
      return `${a} and ${b} are declared to share a platform.`;
    case "shared_contract":
      return `${a} and ${b} are declared to share a contract.`;
    default:
      return `${a} and ${b} have a declared relationship.`;
  }
}

export interface ProductRelationshipsResult {
  relationships: PortfolioProductRelationship[];
  unresolvedRelationships: PortfolioProductRelationship[];
  evidence: PortfolioEvidence[];
}

export function buildProductRelationships(
  products: PortfolioProduct[],
  capabilityModelsByProductId: Map<string, CapabilityModel>,
  normalizedCapabilities: PortfolioCapability[],
  refToCapabilityId: Map<string, string>,
  config: PortfolioConfig | undefined,
): ProductRelationshipsResult {
  const productsById = new Map(products.map((p) => [p.id, p]));
  const capabilitiesById = new Map(normalizedCapabilities.map((c) => [c.id, c]));
  const accumulators = new Map<string, Accumulator>();
  const evidence: PortfolioEvidence[] = [];

  function addToAccumulator(
    productAId: string,
    productBId: string,
    type: PortfolioRelationshipType,
    opts: { capabilityId?: string; score?: number; evidenceId?: string; evidenceIds?: string[]; configDeclared?: boolean; note?: string },
  ) {
    const [a, b] = orderPair(productAId, productBId);
    const key = accumulatorKey(a, b, type);
    const existing = accumulators.get(key);
    const acc: Accumulator = existing ?? { productAId: a, productBId: b, type, capabilityIds: new Set(), evidenceIds: new Set(), scores: [], configDeclared: false };
    if (opts.capabilityId) acc.capabilityIds.add(opts.capabilityId);
    if (opts.evidenceId) acc.evidenceIds.add(opts.evidenceId);
    if (opts.evidenceIds) for (const id of opts.evidenceIds) acc.evidenceIds.add(id);
    if (opts.score !== undefined) acc.scores.push(opts.score);
    if (opts.configDeclared) {
      acc.configDeclared = true;
      if (opts.note) acc.note = opts.note;
    }
    accumulators.set(key, acc);
  }

  // 1. Shared capabilities: every pair of participants within a "shared"-coverage normalized capability.
  for (const capability of normalizedCapabilities) {
    if (capability.coverage !== "shared") continue;
    const participantProductIds = [...new Set(capability.participation.map((p) => p.productId))].sort((x, y) => x.localeCompare(y));
    for (let i = 0; i < participantProductIds.length; i += 1) {
      for (let j = i + 1; j < participantProductIds.length; j += 1) {
        addToAccumulator(participantProductIds[i], participantProductIds[j], "shared_capability", { capabilityId: capability.id, evidenceIds: capability.evidenceIds });
      }
    }
  }

  // 2. Weaker capability-pair relationships (complementary/overlapping/alternative_implementation/unresolved).
  const pairClassifications = classifyAllCapabilityPairs(products, capabilityModelsByProductId, refToCapabilityId);
  for (const pair of pairClassifications) {
    const type = CAPABILITY_RELATIONSHIP_TYPE[pair.relationship as Exclude<CapabilityPairRelationship, "shared" | "distinct">];
    if (!type) continue;
    const normalizedA = refToCapabilityId.get(`${pair.productAId}::${pair.capabilityAId}`);
    const normalizedB = refToCapabilityId.get(`${pair.productBId}::${pair.capabilityBId}`);
    addToAccumulator(pair.productAId, pair.productBId, type, { capabilityId: normalizedA, score: pair.score, evidenceIds: normalizedA ? capabilitiesById.get(normalizedA)?.evidenceIds : undefined });
    if (normalizedB) addToAccumulator(pair.productAId, pair.productBId, type, { capabilityId: normalizedB, score: pair.score, evidenceIds: capabilitiesById.get(normalizedB)?.evidenceIds });
  }

  // 3. Conservative actor/workflow fallback for pairs with no capability-level relationship at all.
  const refs = collectCapabilityRefs(products, capabilityModelsByProductId);
  const actorsByProduct = new Map<string, Set<string>>();
  const workflowsByProduct = new Map<string, Set<string>>();
  for (const ref of refs) {
    const actors = actorsByProduct.get(ref.productId) ?? new Set<string>();
    for (const actor of ref.capability.actors) actors.add(actor);
    actorsByProduct.set(ref.productId, actors);
    const workflows = workflowsByProduct.get(ref.productId) ?? new Set<string>();
    for (const workflow of ref.capability.workflows) workflows.add(workflow);
    workflowsByProduct.set(ref.productId, workflows);
  }

  const pairsWithRelationship = new Set([...accumulators.values()].map((acc) => pairKey(acc.productAId, acc.productBId)));
  for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      const [a, b] = orderPair(products[i].id, products[j].id);
      if (pairsWithRelationship.has(pairKey(a, b))) continue;

      const actorOverlap = jaccard(actorsByProduct.get(a) ?? new Set(), actorsByProduct.get(b) ?? new Set());
      if (actorOverlap >= SHARED_ACTOR_THRESHOLD) {
        const evidenceId = portfolioEvidenceId("product_identity", a, evidence.length);
        evidence.push({ id: evidenceId, sourceType: "product_identity", productId: a, text: `Actor overlap with ${b} across capability evidence: ${(actorOverlap * 100).toFixed(0)}%.`, confidence: "derived" });
        addToAccumulator(a, b, "shared_actor", { score: actorOverlap, evidenceId });
        continue;
      }

      const workflowOverlap = jaccard(workflowsByProduct.get(a) ?? new Set(), workflowsByProduct.get(b) ?? new Set());
      if (workflowOverlap >= SHARED_WORKFLOW_THRESHOLD) {
        const evidenceId = portfolioEvidenceId("product_identity", a, evidence.length);
        evidence.push({ id: evidenceId, sourceType: "product_identity", productId: a, text: `Workflow overlap with ${b} across capability evidence: ${(workflowOverlap * 100).toFixed(0)}%.`, confidence: "derived" });
        addToAccumulator(a, b, "shared_workflow", { score: workflowOverlap, evidenceId });
      }
    }
  }

  // 4. Explicit config declarations always win and can express types (dependency/platform/contract) evidence alone cannot support.
  for (const declared of config?.approved_relationships ?? []) {
    const productAId = [...productsById.values()].find((p) => p.source.configId === declared.product_a || p.id === declared.product_a)?.id;
    const productBId = [...productsById.values()].find((p) => p.source.configId === declared.product_b || p.id === declared.product_b)?.id;
    if (!productAId || !productBId) continue;
    const evidenceId = portfolioEvidenceId("config", productAId, evidence.length);
    evidence.push({ id: evidenceId, sourceType: "config", productId: productAId, text: declared.note ?? `Declared in .rvs/portfolio.yml: ${declared.relationship}.`, confidence: "confirmed" });
    addToAccumulator(productAId, productBId, declared.relationship, { evidenceId, configDeclared: true, note: declared.note });
  }

  const relationships: PortfolioProductRelationship[] = [];
  const unresolvedRelationships: PortfolioProductRelationship[] = [];

  for (const acc of accumulators.values()) {
    const relationship: PortfolioProductRelationship = {
      id: portfolioRelationshipId(acc.productAId, acc.productBId, acc.type),
      productAId: acc.productAId,
      productBId: acc.productBId,
      type: acc.type,
      confidence: confidenceForAccumulator(acc),
      statement: statementForAccumulator(acc, productsById),
      capabilityIds: [...acc.capabilityIds].sort((x, y) => x.localeCompare(y)),
      evidenceIds: [...acc.evidenceIds].sort((x, y) => x.localeCompare(y)),
    };
    if (acc.type === "unresolved") unresolvedRelationships.push(relationship);
    else relationships.push(relationship);
  }

  return {
    relationships: relationships.sort((x, y) => x.id.localeCompare(y.id)),
    unresolvedRelationships: unresolvedRelationships.sort((x, y) => x.id.localeCompare(y.id)),
    evidence,
  };
}
