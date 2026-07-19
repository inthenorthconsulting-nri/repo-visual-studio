import type { CapabilityModel } from "@rvs/capability-intelligence";
import { capabilityRefKey, collectCapabilityRefs } from "./capability-normalization.js";
import type { PortfolioCapability, PortfolioConfig, PortfolioDependencyGraph, PortfolioGap, PortfolioOverlap, PortfolioProduct } from "./contracts.js";
import { portfolioGapId } from "./ids.js";

// ---------------------------------------------------------------------------
// §15 Gap intelligence
//
// Every gap here traces to one of the evidence sources §15 allows: a known
// CapabilityModel limitation (qualified-only implementation), an unresolved
// ownership signal already computed by overlaps.ts, a runtime-verification
// shortfall visible in a capability's own evidence-type mix, or an
// undeclared shared dependency visible in the dependency graph. This
// module deliberately computes only 4 of the 8 PortfolioGapType values:
// qualified_only_coverage, unowned_capability, runtime_verification_gap,
// dependency_gap. The remaining four — no_product_coverage,
// fragmented_coverage, contract_gap, operational_gap — would each require
// either a repository-specific "expected capability" list (forbidden by
// §1) or consuming architecture-intelligence.json/repository-model.json,
// which intake.ts records as present/absent but no synthesis module
// consumes yet this milestone (the same disclosed scope trim as
// product-relationships.ts/dependencies.ts). Their PortfolioGapType values
// remain valid and typed for a future pass; this module simply never emits
// them, rather than fabricating unsupported instances.
// ---------------------------------------------------------------------------

/** Evidence types that indicate a capability has been observed operating, not just implemented or documented. */
const RUNTIME_EVIDENCE_TYPES = new Set(["runtime_entrypoint", "usage", "deployment"]);

function pairKey(a: string, b: string): string {
  const [first, second] = [a, b].sort((x, y) => x.localeCompare(y));
  return `${first}::${second}`;
}

/** Shared by gaps.ts (runtime_verification_gap) and maturity.ts (the verification dimension) so the two never drift on what counts as "observed in operation". */
export function computeRuntimeEvidenceByCapability(products: PortfolioProduct[], capabilityModelsByProductId: Map<string, CapabilityModel>, refToCapabilityId: Map<string, string>): Map<string, boolean> {
  const runtimeEvidenceByCapability = new Map<string, boolean>();
  for (const ref of collectCapabilityRefs(products, capabilityModelsByProductId)) {
    const capabilityId = refToCapabilityId.get(capabilityRefKey(ref));
    if (!capabilityId) continue;
    const hasRuntimeEvidence = ref.capability.evidence.some((e) => RUNTIME_EVIDENCE_TYPES.has(e.type));
    runtimeEvidenceByCapability.set(capabilityId, (runtimeEvidenceByCapability.get(capabilityId) ?? false) || hasRuntimeEvidence);
  }
  return runtimeEvidenceByCapability;
}

export function detectGaps(
  products: PortfolioProduct[],
  capabilityModelsByProductId: Map<string, CapabilityModel>,
  capabilities: PortfolioCapability[],
  overlaps: PortfolioOverlap[],
  dependencyGraph: PortfolioDependencyGraph,
  refToCapabilityId: Map<string, string>,
  config: PortfolioConfig | undefined,
): PortfolioGap[] {
  const gaps: PortfolioGap[] = [];

  for (const capability of capabilities) {
    if (capability.participation.length > 0 && capability.participation.every((p) => p.qualified)) {
      gaps.push({
        id: portfolioGapId("qualified_only_coverage", capability.id),
        type: "qualified_only_coverage",
        statement: `"${capability.displayName}" is qualified but not fully current across every product that has it (${capability.participation.length}).`,
        affectedProductIds: [...new Set(capability.participation.map((p) => p.productId))].sort((a, b) => a.localeCompare(b)),
        capabilityId: capability.id,
        evidenceIds: capability.evidenceIds,
      });
    }
  }

  for (const overlap of overlaps) {
    if (overlap.severity !== "material" && overlap.severity !== "strategic") continue;
    gaps.push({
      id: portfolioGapId("unowned_capability", overlap.capabilityId),
      type: "unowned_capability",
      statement: `Ownership of "${overlap.capabilityId}" is unresolved across ${overlap.productIds.length} products (${overlap.severity} overlap).`,
      affectedProductIds: overlap.productIds,
      capabilityId: overlap.capabilityId,
      evidenceIds: overlap.evidenceIds,
    });
  }

  const runtimeEvidenceByCapability = computeRuntimeEvidenceByCapability(products, capabilityModelsByProductId, refToCapabilityId);
  for (const capability of capabilities) {
    if (capability.confidence !== "confirmed") continue;
    if (runtimeEvidenceByCapability.get(capability.id)) continue;
    gaps.push({
      id: portfolioGapId("runtime_verification_gap", capability.id),
      type: "runtime_verification_gap",
      statement: `"${capability.displayName}" is confirmed by static evidence only; no runtime, usage, or deployment evidence verifies it in operation.`,
      affectedProductIds: [...new Set(capability.participation.map((p) => p.productId))].sort((a, b) => a.localeCompare(b)),
      capabilityId: capability.id,
      evidenceIds: capability.evidenceIds,
    });
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  function resolveProductId(configOrProductId: string): string | undefined {
    return [...productsById.values()].find((p) => p.source.configId === configOrProductId || p.id === configOrProductId)?.id;
  }
  const declaredSharedPairs = new Set<string>();
  for (const declared of config?.approved_relationships ?? []) {
    if (declared.relationship !== "shared_platform" && declared.relationship !== "shared_contract") continue;
    const aId = resolveProductId(declared.product_a);
    const bId = resolveProductId(declared.product_b);
    if (aId && bId) declaredSharedPairs.add(pairKey(aId, bId));
  }

  const productsByExternalSystemNode = new Map<string, Set<string>>();
  for (const edge of dependencyGraph.edges) {
    if (edge.kind !== "depends_on") continue;
    const node = dependencyGraph.nodes.find((n) => n.id === edge.targetId);
    if (!node || node.kind !== "external_system") continue;
    const set = productsByExternalSystemNode.get(node.id) ?? new Set<string>();
    set.add(edge.sourceProductId);
    productsByExternalSystemNode.set(node.id, set);
  }

  for (const [nodeId, productIdSet] of productsByExternalSystemNode) {
    const productIds = [...productIdSet].sort((a, b) => a.localeCompare(b));
    if (productIds.length < 2) continue;
    const alreadyDeclared = productIds.every((a, i) => productIds.slice(i + 1).every((b) => declaredSharedPairs.has(pairKey(a, b))));
    if (alreadyDeclared) continue;

    const node = dependencyGraph.nodes.find((n) => n.id === nodeId)!;
    gaps.push({
      id: portfolioGapId("dependency_gap", nodeId),
      type: "dependency_gap",
      statement: `${productIds.length} products depend on "${node.label}" but no shared-platform or shared-contract relationship has been declared between them.`,
      affectedProductIds: productIds,
      evidenceIds: dependencyGraph.edges.filter((e) => e.targetId === nodeId && productIds.includes(e.sourceProductId)).flatMap((e) => e.evidenceIds),
    });
  }

  return gaps.sort((a, b) => a.id.localeCompare(b.id));
}
