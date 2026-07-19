import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { PortfolioConfig, PortfolioDependencyEdge, PortfolioDependencyGraph, PortfolioDependencyNode, PortfolioEvidence, PortfolioProduct, PortfolioRelationshipConfidence } from "./contracts.js";
import { portfolioDependencyEdgeId, portfolioDependencyNodeId, portfolioEvidenceId } from "./ids.js";

// ---------------------------------------------------------------------------
// §11 Dependency graph
//
// Two evidence sources, same priority order as product-relationships.ts:
//   1. Each product's own capability evidence: every distinct external
//      system named by any of a product's capabilities becomes a
//      product -> external_system "depends_on" edge (one per product/system
//      pair, not one per capability, to avoid inflating the graph). This is
//      the only edge *kind* evidence at this level actually supports —
//      CapabilityEvidence does not distinguish produces/consumes/reads/
//      writes for an external system, so claiming a more specific kind here
//      would be a fabrication (§11 hard rule: never infer from a mention
//      alone). More specific kinds (produces/consumes/validates/governs/
//      deploys_to/reads_from/writes_to/publishes/enriches) are reserved for
//      a future pass that consumes architecture-intelligence.json — recorded
//      as unconsumed by intake.ts, same disclosed trim as product-relationships.ts.
//   2. `.rvs/portfolio.yml` approved_relationships: upstream/downstream
//      dependency declarations become direct product -> product depends_on
//      edges; shared_platform/shared_contract declarations mint a shared
//      node and an edge from each participant into it. All config-declared
//      edges are "confirmed" confidence.
//
// Low-confidence edges are not filtered out here — presentation planning
// (portfolio-plan.ts) is responsible for excluding them from default
// executive rendering per §11/§26; this module's job is to report evidence
// faithfully, not to pre-censor it.
// ---------------------------------------------------------------------------

function edgeConfidence(capabilityConfidence: string): PortfolioRelationshipConfidence {
  if (capabilityConfidence === "confirmed") return "confirmed";
  if (capabilityConfidence === "derived") return "derived";
  if (capabilityConfidence === "unresolved") return "unresolved";
  return "suggested";
}

function pairLabel(aId: string, bId: string): string {
  const [first, second] = [aId, bId].sort((x, y) => x.localeCompare(y));
  return `${first}|${second}`;
}

export interface DependencyGraphResult {
  graph: PortfolioDependencyGraph;
  evidence: PortfolioEvidence[];
}

export function buildDependencyGraph(products: PortfolioProduct[], capabilityModelsByProductId: Map<string, CapabilityModel>, config: PortfolioConfig | undefined): DependencyGraphResult {
  const nodes = new Map<string, PortfolioDependencyNode>();
  const edges: PortfolioDependencyEdge[] = [];
  const evidence: PortfolioEvidence[] = [];

  for (const product of products) {
    const nodeId = portfolioDependencyNodeId("product", product.id);
    nodes.set(nodeId, { id: nodeId, kind: "product", label: product.displayName });
  }

  for (const product of products) {
    const model = capabilityModelsByProductId.get(product.id);
    if (!model) continue;
    const allCapabilities = [...model.includedCapabilities, ...model.qualifiedCapabilities];
    const systemsSeen = new Set<string>();
    for (const capability of allCapabilities) {
      for (const system of capability.externalSystems) {
        if (systemsSeen.has(system)) continue;
        systemsSeen.add(system);

        const nodeId = portfolioDependencyNodeId("external_system", system);
        if (!nodes.has(nodeId)) nodes.set(nodeId, { id: nodeId, kind: "external_system", label: system });

        const evidenceId = portfolioEvidenceId("capability", product.id, evidence.length);
        evidence.push({
          id: evidenceId,
          sourceType: "capability",
          productId: product.id,
          sourceId: capability.id,
          text: `${capability.displayName} depends on external system "${system}".`,
          confidence: edgeConfidence(capability.confidence),
        });

        edges.push({
          id: portfolioDependencyEdgeId("depends_on", product.id, nodeId),
          kind: "depends_on",
          sourceProductId: product.id,
          targetId: nodeId,
          confidence: edgeConfidence(capability.confidence),
          qualifiers: [capability.displayName],
          evidenceIds: [evidenceId],
        });
      }
    }
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  function resolveProductId(configOrProductId: string): string | undefined {
    return [...productsById.values()].find((p) => p.source.configId === configOrProductId || p.id === configOrProductId)?.id;
  }

  for (const declared of config?.approved_relationships ?? []) {
    const aId = resolveProductId(declared.product_a);
    const bId = resolveProductId(declared.product_b);
    if (!aId || !bId) continue;

    const evidenceId = portfolioEvidenceId("config", aId, evidence.length);
    evidence.push({ id: evidenceId, sourceType: "config", productId: aId, text: declared.note ?? `Declared in .rvs/portfolio.yml: ${declared.relationship}.`, confidence: "confirmed" });

    if (declared.relationship === "upstream_dependency") {
      edges.push({ id: portfolioDependencyEdgeId("depends_on", bId, portfolioDependencyNodeId("product", aId)), kind: "depends_on", sourceProductId: bId, targetId: portfolioDependencyNodeId("product", aId), confidence: "confirmed", qualifiers: [], evidenceIds: [evidenceId] });
    } else if (declared.relationship === "downstream_dependency") {
      edges.push({ id: portfolioDependencyEdgeId("depends_on", aId, portfolioDependencyNodeId("product", bId)), kind: "depends_on", sourceProductId: aId, targetId: portfolioDependencyNodeId("product", bId), confidence: "confirmed", qualifiers: [], evidenceIds: [evidenceId] });
    } else if (declared.relationship === "shared_platform" || declared.relationship === "shared_contract") {
      const kind = declared.relationship === "shared_platform" ? "shared_platform" : "contract";
      const label = declared.note ?? `${declared.relationship === "shared_platform" ? "Shared platform" : "Shared contract"} (${productsById.get(aId)!.displayName} / ${productsById.get(bId)!.displayName})`;
      const nodeId = portfolioDependencyNodeId(kind, pairLabel(aId, bId));
      nodes.set(nodeId, { id: nodeId, kind, label });
      edges.push({ id: portfolioDependencyEdgeId("depends_on", aId, nodeId), kind: "depends_on", sourceProductId: aId, targetId: nodeId, confidence: "confirmed", qualifiers: [], evidenceIds: [evidenceId] });
      edges.push({ id: portfolioDependencyEdgeId("depends_on", bId, nodeId), kind: "depends_on", sourceProductId: bId, targetId: nodeId, confidence: "confirmed", qualifiers: [], evidenceIds: [evidenceId] });
    }
  }

  return {
    graph: {
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    },
    evidence,
  };
}
