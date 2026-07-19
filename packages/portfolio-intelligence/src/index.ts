import type { AudienceType } from "@rvs/product-intelligence";
import { buildPortfolioClaims } from "./claims.js";
import { PORTFOLIO_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import type {
  PortfolioClaim,
  PortfolioConfig,
  PortfolioDomain,
  PortfolioEvidence,
  PortfolioEvidenceMode,
  PortfolioEvidenceSummary,
  PortfolioGenerationMetadata,
  PortfolioModel,
  PortfolioNarrative,
  PortfolioPlan,
  PortfolioProductIntake,
} from "./contracts.js";
import { buildDependencyGraph } from "./dependencies.js";
import { computeRuntimeEvidenceByCapability, detectGaps } from "./gaps.js";
import { buildPortfolioProducts } from "./identity-reconciliation.js";
import { portfolioDomainId } from "./ids.js";
import { intakePortfolioProducts, isCompatible } from "./intake.js";
import { buildMaturitySummary } from "./maturity.js";
import { buildPortfolioNarrative } from "./narrative.js";
import { buildOperatingModel } from "./operating-model.js";
import { detectOverlaps } from "./overlaps.js";
import { buildPortfolioPlan } from "./portfolio-plan.js";
import { normalizePortfolioCapabilities } from "./capability-normalization.js";
import { buildProductRelationships } from "./product-relationships.js";

export * from "./capability-normalization.js";
export * from "./capability-relationships.js";
export * from "./claims.js";
export * from "./compatibility.js";
export * from "./contracts.js";
export * from "./dependencies.js";
export * from "./exporter.js";
export * from "./gaps.js";
export * from "./identity-reconciliation.js";
export * from "./ids.js";
export * from "./intake.js";
export * from "./maturity.js";
export * from "./narrative.js";
export * from "./operating-model.js";
export * from "./overlaps.js";
export * from "./ownership.js";
export * from "./portfolio-plan.js";
export * from "./product-registry.js";
export * from "./product-relationships.js";
export * from "./validation.js";

/** Derived only from the domain label already carried by each normalized capability — never a repository-specific taxonomy (§8/§9). */
export function buildPortfolioDomains(capabilities: PortfolioModel["capabilities"]): PortfolioDomain[] {
  const byDomain = new Map<string, { displayName: string; capabilityIds: Set<string> }>();
  for (const capability of capabilities) {
    const id = portfolioDomainId(capability.domain);
    const entry = byDomain.get(id) ?? { displayName: capability.domain, capabilityIds: new Set<string>() };
    entry.capabilityIds.add(capability.id);
    byDomain.set(id, entry);
  }
  return [...byDomain.entries()]
    .map(([id, { displayName, capabilityIds }]) => ({ id, displayName, capabilityIds: [...capabilityIds].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface SynthesizePortfolioInput {
  repoRoot: string;
  config: PortfolioConfig;
  generatedAt: string;
  allowPartialPortfolio?: boolean;
}

export interface SynthesizePortfolioResult {
  model: PortfolioModel;
  claims: PortfolioClaim[];
}

/**
 * The single pipeline entrypoint for Portfolio and Ecosystem Intelligence
 * (§1): intake -> compatibility filtering -> identity reconciliation ->
 * capability normalization -> capability/product relationships -> dependency
 * graph -> overlaps -> gaps -> operating model -> maturity -> claim control.
 * Pure over already-generated Milestone 3-5 artifacts read from each
 * product's artifact root — never re-scans a repository and never calls an
 * external model (§1 hard constraint). Every incompatible product is
 * excluded (recorded on `excludedProducts`) unless `allowPartialPortfolio`
 * is set, mirroring §6's "never continue silently with an incompatible
 * product" rule.
 */
export function synthesizePortfolio(input: SynthesizePortfolioInput): SynthesizePortfolioResult {
  const { repoRoot, config, generatedAt, allowPartialPortfolio = false } = input;

  const intakes = intakePortfolioProducts(repoRoot, config.products);
  const compatibleIntakes = intakes.filter(isCompatible);
  const incompatibleIntakes: PortfolioProductIntake[] = intakes.filter((intake) => !isCompatible(intake));

  if (compatibleIntakes.length === 0) {
    throw new Error("Portfolio synthesis found no compatible products; check each product's artifact_root in .rvs/portfolio.yml.");
  }
  if (incompatibleIntakes.length > 0 && !allowPartialPortfolio) {
    throw new Error(
      `${incompatibleIntakes.length} product(s) are incompatible: ${incompatibleIntakes.map((i) => `${i.configId} (${i.compatibility})`).join(", ")}. Pass allowPartialPortfolio to continue with the remaining products.`,
    );
  }

  const products = buildPortfolioProducts(compatibleIntakes);

  const intakeByConfigId = new Map(compatibleIntakes.map((intake) => [intake.configId, intake]));
  const capabilityModelsByProductId = new Map(products.map((product) => [product.id, intakeByConfigId.get(product.source.configId)!.artifacts.capabilityModel!]));

  const normalization = normalizePortfolioCapabilities(products, capabilityModelsByProductId);
  const relationshipsResult = buildProductRelationships(products, capabilityModelsByProductId, normalization.capabilities, normalization.refToCapabilityId, config);
  const dependencyResult = buildDependencyGraph(products, capabilityModelsByProductId, config);
  const overlapResult = detectOverlaps(normalization.capabilities);
  const gaps = detectGaps(products, capabilityModelsByProductId, overlapResult.capabilities, overlapResult.overlaps, dependencyResult.graph, normalization.refToCapabilityId, config);
  const operatingModel = buildOperatingModel(products, capabilityModelsByProductId, normalization.refToCapabilityId);
  const runtimeEvidenceByCapability = computeRuntimeEvidenceByCapability(products, capabilityModelsByProductId, normalization.refToCapabilityId);
  const maturity = buildMaturitySummary(
    products,
    capabilityModelsByProductId,
    overlapResult.capabilities,
    relationshipsResult.relationships,
    relationshipsResult.unresolvedRelationships,
    overlapResult.overlaps,
    normalization.refToCapabilityId,
  );
  const domains = buildPortfolioDomains(overlapResult.capabilities);

  const preliminaryEvidence: PortfolioEvidence[] = [...normalization.evidence, ...relationshipsResult.evidence, ...dependencyResult.evidence];

  const claimsResult = buildPortfolioClaims({
    portfolioId: config.portfolio.id,
    displayName: config.portfolio.display_name,
    products,
    capabilities: overlapResult.capabilities,
    relationships: relationshipsResult.relationships,
    unresolvedRelationships: relationshipsResult.unresolvedRelationships,
    maturity,
    operatingModel,
    runtimeEvidenceByCapability,
    evidence: preliminaryEvidence,
    config,
  });

  const evidence = [...preliminaryEvidence, ...claimsResult.evidence].sort((a, b) => a.id.localeCompare(b.id));

  const evidenceSummary: PortfolioEvidenceSummary = {
    productCount: products.length,
    uniqueCapabilityCount: overlapResult.capabilities.length,
    productCapabilityImplementationCount: overlapResult.capabilities.reduce((sum, c) => sum + c.participation.length, 0),
    qualifiedOnlyCapabilityCount: gaps.filter((g) => g.type === "qualified_only_coverage").length,
    confirmedRelationshipCount: relationshipsResult.relationships.filter((r) => r.confidence === "confirmed").length,
    materialOverlapCount: overlapResult.overlaps.filter((o) => o.severity === "material" || o.severity === "strategic").length,
    gapCount: gaps.length,
    productsWithRuntimeEvidenceCount: products.filter((product) => overlapResult.capabilities.some((c) => c.participation.some((p) => p.productId === product.id) && runtimeEvidenceByCapability.get(c.id)))
      .length,
  };

  const generationMetadata: PortfolioGenerationMetadata = {
    generated_at: generatedAt,
    schema_version: PORTFOLIO_INTELLIGENCE_SCHEMA_VERSION,
    productCount: products.length,
    incompatibleProductCount: incompatibleIntakes.length,
    allowPartialPortfolio,
  };

  const model: PortfolioModel = {
    schemaVersion: PORTFOLIO_INTELLIGENCE_SCHEMA_VERSION,
    portfolioId: config.portfolio.id,
    displayName: config.portfolio.display_name,
    products,
    domains,
    capabilities: overlapResult.capabilities,
    relationships: relationshipsResult.relationships,
    unresolvedRelationships: relationshipsResult.unresolvedRelationships,
    dependencyGraph: dependencyResult.graph,
    overlaps: overlapResult.overlaps,
    gaps,
    operatingModel,
    maturity,
    evidence,
    evidenceSummary,
    excludedProducts: incompatibleIntakes,
    generationMetadata,
  };

  return { model, claims: claimsResult.claims };
}

/** §19: claim control always runs before narrative synthesis — the narrative is composed only from claims.ts's output, never from raw model facts directly (gaps excepted, per narrative.ts's own header comment). */
export function synthesizePortfolioNarrative(model: PortfolioModel, claims: PortfolioClaim[]): PortfolioNarrative {
  return buildPortfolioNarrative(model.displayName, model.products, model.capabilities, model.relationships, model.unresolvedRelationships, model.operatingModel, model.gaps, claims);
}

export interface SynthesizePortfolioPlanInput {
  model: PortfolioModel;
  narrative: PortfolioNarrative;
  claims: PortfolioClaim[];
  audience: AudienceType;
  theme: string;
  evidenceMode?: PortfolioEvidenceMode;
  generatedAt: string;
}

export function synthesizePortfolioPlan(input: SynthesizePortfolioPlanInput): PortfolioPlan {
  return buildPortfolioPlan(input.model, input.narrative, input.claims, {
    audience: input.audience,
    theme: input.theme,
    evidenceMode: input.evidenceMode ?? "concise",
    generatedAt: input.generatedAt,
  });
}
