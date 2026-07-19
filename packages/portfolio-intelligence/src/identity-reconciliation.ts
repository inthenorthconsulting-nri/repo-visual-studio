import type { ProductArchetype } from "@rvs/product-intelligence";
import type { PortfolioConfigProduct, PortfolioProduct, PortfolioProductIntake, PortfolioProductRole } from "./contracts.js";
import { portfolioProductId } from "./ids.js";

// ---------------------------------------------------------------------------
// §7 Product identity reconciliation
// ---------------------------------------------------------------------------

/**
 * Resolves every declared config product id (including `alias_of` entries)
 * to its canonical portfolio product id. Default: one artifact set = one
 * portfolio product — only an explicit `alias_of` in `.rvs/portfolio.yml`
 * collapses two config ids onto the same product. Reconciliation never
 * merges products based on similar display names alone (§7 hard rule); that
 * similarity is only ever surfaced as an informational signal via
 * detectReconciliationSignals(), never acted on automatically.
 */
export function resolveCanonicalProductIds(products: PortfolioConfigProduct[]): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const product of products) {
    canonical.set(product.id, product.alias_of ?? product.id);
  }
  // Resolve alias chains (alias_of pointing at another alias) to their root.
  for (const id of canonical.keys()) {
    let target = canonical.get(id)!;
    const seen = new Set([id]);
    while (canonical.has(target) && canonical.get(target) !== target && !seen.has(target)) {
      seen.add(target);
      target = canonical.get(target)!;
    }
    canonical.set(id, target);
  }
  return canonical;
}

// ---------------------------------------------------------------------------
// §12 Product roles — derived only from already evidence-derived signals
// (archetype, secondary archetypes, capability domains) already produced by
// upstream product-intelligence/capability-intelligence synthesis; never
// assigned because a repository or README uses a particular phrase.
// ---------------------------------------------------------------------------

const ARCHETYPE_ROLE: Record<ProductArchetype, PortfolioProductRole> = {
  governance_platform: "governance_system",
  operations_platform: "operations_system",
  reliability_platform: "reliability_system",
  developer_tool: "developer_tool",
  automation_platform: "operations_system",
  migration_platform: "migration_system",
  observability_platform: "reliability_system",
  control_plane: "control_plane",
  integration_platform: "integration_layer",
  data_product: "domain_product",
  library: "shared_library",
  framework: "shared_library",
  unknown: "unknown",
};

/** Generic, product-agnostic keyword signal for the one role (presentation_system) with no direct archetype analog — mirrors capability-normalization's generic-synonym-table approach, never a repository-specific term. */
const PRESENTATION_DOMAIN_KEYWORDS = ["presentation", "visualization", "narrative", "showcase", "storytelling"];

function domainSuggestsPresentation(capabilityDomainIds: string[]): boolean {
  return capabilityDomainIds.some((id) => PRESENTATION_DOMAIN_KEYWORDS.some((kw) => id.toLowerCase().includes(kw)));
}

export function classifyPrimaryRole(archetype: ProductArchetype, capabilityDomainIds: string[]): PortfolioProductRole {
  if (archetype === "unknown" && domainSuggestsPresentation(capabilityDomainIds)) return "presentation_system";
  return ARCHETYPE_ROLE[archetype];
}

export function classifySecondaryRoles(primary: PortfolioProductRole, secondaryArchetypes: ProductArchetype[], capabilityDomainIds: string[]): PortfolioProductRole[] {
  const roles = new Set<PortfolioProductRole>();
  if (domainSuggestsPresentation(capabilityDomainIds) && primary !== "presentation_system") roles.add("presentation_system");
  for (const archetype of secondaryArchetypes) {
    const role = ARCHETYPE_ROLE[archetype];
    if (role !== primary && role !== "unknown") roles.add(role);
    if (roles.size >= 2) break;
  }
  return [...roles].slice(0, 2).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Product construction
// ---------------------------------------------------------------------------

export function buildPortfolioProduct(intake: PortfolioProductIntake): PortfolioProduct {
  const identity = intake.artifacts.productIdentity!.identity;
  const capabilityModel = intake.artifacts.capabilityModel!;
  const capabilityDomainIds = capabilityModel.domains.map((d) => d.id);

  const primaryRole = classifyPrimaryRole(identity.archetype, capabilityDomainIds);
  const secondaryRoles = classifySecondaryRoles(primaryRole, identity.secondaryArchetypes, capabilityDomainIds);

  return {
    id: portfolioProductId(intake.configId),
    displayName: identity.displayName,
    descriptor: identity.descriptor,
    primaryArchetype: identity.archetype,
    secondaryArchetypes: identity.secondaryArchetypes,
    primaryRole,
    secondaryRoles,
    currentCapabilityIds: identity.currentCapabilities,
    qualifiedCapabilityIds: identity.qualifiedCapabilities,
    currentCapabilityCount: identity.currentCapabilities.length,
    qualifiedCapabilityCount: identity.qualifiedCapabilities.length,
    source: {
      configId: intake.configId,
      artifactRoot: intake.artifactRoot,
      compatibility: intake.compatibility,
      sourceProductIdentityGeneratedAt: intake.artifacts.productIdentity!.generationMetadata.generated_at,
      sourceCapabilityModelGeneratedAt: capabilityModel.generationMetadata.generated_at,
    },
  };
}

export function buildPortfolioProducts(compatibleIntakes: PortfolioProductIntake[]): PortfolioProduct[] {
  return compatibleIntakes.map(buildPortfolioProduct).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Reconciliation signals (informational only — §7 forbids acting on these
// automatically; they exist so validation.ts/decisions can surface them).
// ---------------------------------------------------------------------------

export interface PortfolioReconciliationSignal {
  kind: "duplicate_display_name" | "identical_primary_archetype" | "conflicting_declared_role";
  productIds: string[];
  message: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function detectReconciliationSignals(products: PortfolioProduct[]): PortfolioReconciliationSignal[] {
  const signals: PortfolioReconciliationSignal[] = [];

  const byName = new Map<string, string[]>();
  for (const p of products) {
    const key = normalizeName(p.displayName);
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      signals.push({ kind: "duplicate_display_name", productIds: ids.sort((a, b) => a.localeCompare(b)), message: `${ids.length} products share the display name "${name}" but were not declared as aliases.` });
    }
  }

  const byArchetype = new Map<string, string[]>();
  for (const p of products) {
    if (p.primaryArchetype === "unknown") continue;
    byArchetype.set(p.primaryArchetype, [...(byArchetype.get(p.primaryArchetype) ?? []), p.id]);
  }
  for (const [archetype, ids] of byArchetype) {
    if (ids.length > 1) {
      signals.push({
        kind: "identical_primary_archetype",
        productIds: ids.sort((a, b) => a.localeCompare(b)),
        message: `${ids.length} products share the primary archetype "${archetype}"; their product-boundary distinction should be reviewed.`,
      });
    }
  }

  return signals.sort((a, b) => a.kind.localeCompare(b.kind) || a.productIds.join(",").localeCompare(b.productIds.join(",")));
}
