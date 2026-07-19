import type { CapabilityModel } from "@rvs/capability-intelligence";
import { computeRuntimeEvidenceByCapability } from "./gaps.js";
import { isOwnershipResolved } from "./ownership.js";
import type { PortfolioCapability, PortfolioMaturityDimension, PortfolioMaturitySummary, PortfolioOverlap, PortfolioProduct, PortfolioProductRelationship } from "./contracts.js";

// ---------------------------------------------------------------------------
// §17 Maturity
//
// Every dimension always exposes numerator/denominator alongside the score
// so a reader can see exactly what was counted (§17 hard rule) — never a
// bare percentage. Labels avoid unsupported grading language ("excellent",
// "poor"); they only state the ratio's meaning.
// ---------------------------------------------------------------------------

function dimension(numerator: number, denominator: number, label: string): PortfolioMaturityDimension {
  return { score: denominator === 0 ? 0 : numerator / denominator, numerator, denominator, label };
}

export function buildMaturitySummary(
  products: PortfolioProduct[],
  capabilityModelsByProductId: Map<string, CapabilityModel>,
  capabilities: PortfolioCapability[],
  relationships: PortfolioProductRelationship[],
  unresolvedRelationships: PortfolioProductRelationship[],
  overlaps: PortfolioOverlap[],
  refToCapabilityId: Map<string, string>,
): PortfolioMaturitySummary {
  const confirmedCapabilities = capabilities.filter((c) => c.confidence === "confirmed");

  const coverage = dimension(confirmedCapabilities.length, capabilities.length, "Normalized capabilities backed by confirmed evidence, out of all normalized capabilities.");

  const operationalProducts = products.filter((p) => p.currentCapabilityCount > 0);
  const operational = dimension(operationalProducts.length, products.length, "Products with at least one fully current capability, out of all portfolio products.");

  const runtimeEvidenceByCapability = computeRuntimeEvidenceByCapability(products, capabilityModelsByProductId, refToCapabilityId);
  const confirmedWithRuntimeEvidence = confirmedCapabilities.filter((c) => runtimeEvidenceByCapability.get(c.id));
  const verification = dimension(confirmedWithRuntimeEvidence.length, confirmedCapabilities.length, "Confirmed capabilities with runtime, usage, or deployment evidence, out of all confirmed capabilities.");

  const totalRelationshipEvidence = relationships.length + unresolvedRelationships.length;
  const integration = dimension(relationships.length, totalRelationshipEvidence, "Cross-product relationships resolved to a specific type, out of all detected cross-product relationship evidence.");

  const sharedOrOverlapping = capabilities.filter((c) => c.coverage === "shared" || c.coverage === "overlapping");
  const resolvedOwnership = sharedOrOverlapping.filter((c) => isOwnershipResolved(c));
  const ownership = dimension(resolvedOwnership.length, sharedOrOverlapping.length, "Multi-product capabilities with a clearly resolved lead, out of all multi-product capabilities.");

  const productsWithRuntimeEvidence = products.filter((product) => capabilities.some((c) => c.participation.some((p) => p.productId === product.id) && runtimeEvidenceByCapability.get(c.id)));
  const runtimeEvidence = dimension(productsWithRuntimeEvidence.length, products.length, "Products with at least one capability verified by runtime, usage, or deployment evidence, out of all portfolio products.");

  const productsWithMaterialOverlap = new Set(overlaps.filter((o) => o.severity === "material" || o.severity === "strategic").flatMap((o) => o.productIds));
  const coherentProducts = products.filter((p) => !productsWithMaterialOverlap.has(p.id));
  const coherence = dimension(coherentProducts.length, products.length, "Products with no unresolved material or strategic capability overlap, out of all portfolio products.");

  return { coverage, operational, verification, integration, ownership, runtimeEvidence, coherence };
}
