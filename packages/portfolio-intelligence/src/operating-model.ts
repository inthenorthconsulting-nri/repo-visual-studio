import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { PortfolioOperatingModel, PortfolioOperatingStage, PortfolioOperatingStageAssignment, PortfolioOperatingTransition, PortfolioProduct, PortfolioProductRole } from "./contracts.js";

// ---------------------------------------------------------------------------
// §16 Operating model
//
// Stage assignment is a role-to-stage overlay, not a directly observed
// pipeline order — there is no CI/deployment evidence available at this
// layer to confirm sequencing. Every stage assignment and every transition
// is therefore always marked inferred: true (§16's "every transition
// evidence-backed or visibly marked inferred" is satisfied by the latter
// half; nothing here is asserted as confirmed fact). A portfolio with
// products in only two or three roles simply gets two or three stages —
// this module never fabricates a full eight-stage lifecycle to make a
// small portfolio look more mature than its evidence supports (§16 hard
// rule against forcing one universal lifecycle).
// ---------------------------------------------------------------------------

const STAGE_ORDER: PortfolioOperatingStage[] = ["plan", "build", "validate", "govern", "promote", "operate", "observe", "improve"];

const ROLE_STAGE: Partial<Record<PortfolioProductRole, PortfolioOperatingStage>> = {
  control_plane: "govern",
  governance_system: "govern",
  operations_system: "operate",
  developer_tool: "build",
  migration_system: "promote",
  metadata_system: "observe",
  presentation_system: "plan",
  integration_layer: "build",
  shared_library: "build",
  domain_product: "operate",
};

/** Generic keyword signal (not product-specific) distinguishing observability-flavored reliability products from testing/validation-flavored ones. */
const OBSERVABILITY_KEYWORDS = ["observ", "monitor", "telemetry", "metric", "alert"];

function domainSuggestsObservability(capabilityDomainIds: string[]): boolean {
  return capabilityDomainIds.some((id) => OBSERVABILITY_KEYWORDS.some((kw) => id.toLowerCase().includes(kw)));
}

function classifyStage(product: PortfolioProduct, capabilityDomainIds: string[]): PortfolioOperatingStage | undefined {
  if (product.primaryRole === "reliability_system") {
    return domainSuggestsObservability(capabilityDomainIds) ? "observe" : "validate";
  }
  return ROLE_STAGE[product.primaryRole];
}

export function buildOperatingModel(
  products: PortfolioProduct[],
  capabilityModelsByProductId: Map<string, CapabilityModel>,
  refToCapabilityId: Map<string, string>,
): PortfolioOperatingModel {
  const stageProductIds = new Map<PortfolioOperatingStage, Set<string>>();
  const stageCapabilityIds = new Map<PortfolioOperatingStage, Set<string>>();
  const unassignedProductIds: string[] = [];

  for (const product of products) {
    const model = capabilityModelsByProductId.get(product.id);
    const domainIds = model?.domains.map((d) => d.id) ?? [];
    const stage = classifyStage(product, domainIds);
    if (!stage) {
      unassignedProductIds.push(product.id);
      continue;
    }

    const productIds = stageProductIds.get(stage) ?? new Set<string>();
    productIds.add(product.id);
    stageProductIds.set(stage, productIds);

    const capabilityIds = stageCapabilityIds.get(stage) ?? new Set<string>();
    for (const id of [...product.currentCapabilityIds, ...product.qualifiedCapabilityIds]) {
      const normalizedId = refToCapabilityId.get(`${product.id}::${id}`);
      if (normalizedId) capabilityIds.add(normalizedId);
    }
    stageCapabilityIds.set(stage, capabilityIds);
  }

  const stages: PortfolioOperatingStageAssignment[] = STAGE_ORDER.filter((stage) => stageProductIds.has(stage)).map((stage) => ({
    stage,
    productIds: [...(stageProductIds.get(stage) ?? [])].sort((a, b) => a.localeCompare(b)),
    capabilityIds: [...(stageCapabilityIds.get(stage) ?? [])].sort((a, b) => a.localeCompare(b)),
    inferred: true,
  }));

  const transitions: PortfolioOperatingTransition[] = [];
  for (let i = 0; i < STAGE_ORDER.length - 1; i += 1) {
    const fromStage = STAGE_ORDER[i];
    const toStage = STAGE_ORDER[i + 1];
    if (!stageProductIds.has(fromStage) || !stageProductIds.has(toStage)) continue;
    transitions.push({
      fromStage,
      toStage,
      statement: `Products assigned to "${fromStage}" precede products assigned to "${toStage}" in the portfolio's inferred operating sequence.`,
      inferred: true,
      evidenceIds: [],
    });
  }

  return { stages, transitions, unassignedProductIds: unassignedProductIds.sort((a, b) => a.localeCompare(b)) };
}
