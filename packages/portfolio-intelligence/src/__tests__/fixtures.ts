import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_EVIDENCE_STRENGTH, CAPABILITY_INTELLIGENCE_SCHEMA_VERSION, DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "@rvs/capability-intelligence";
import type { Capability, CapabilityDomain, CapabilityEvidence, CapabilityEvidenceType, CapabilityGenerationMetadata, CapabilityModel, CapabilityReadiness } from "@rvs/capability-intelligence";
import { PRODUCT_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/product-intelligence";
import type { ProductIdentity, ProductIdentityGenerationMetadata, ProductIdentityModel } from "@rvs/product-intelligence";
import type {
  PortfolioCapability,
  PortfolioCapabilityParticipation,
  PortfolioClaim,
  PortfolioConfig,
  PortfolioConfigProduct,
  PortfolioDecision,
  PortfolioDependencyEdge,
  PortfolioDependencyNode,
  PortfolioEvidence,
  PortfolioGap,
  PortfolioMaturityDimension,
  PortfolioMaturitySummary,
  PortfolioModel,
  PortfolioNarrative,
  PortfolioOperatingModel,
  PortfolioOverlap,
  PortfolioPlan,
  PortfolioProduct,
  PortfolioProductIntake,
  PortfolioProductRelationship,
  PortfolioScenePlan,
  PortfolioSceneType,
  PortfolioSourceMetadata,
} from "../contracts.js";
import {
  portfolioClaimId,
  portfolioDecisionId,
  portfolioDependencyEdgeId,
  portfolioDependencyNodeId,
  portfolioGapId,
  portfolioOverlapId,
  portfolioProductId,
  portfolioRelationshipId,
  portfolioSceneId,
} from "../ids.js";

// ---------------------------------------------------------------------------
// Small hand-built fixtures over the real capability-intelligence and
// product-intelligence types (same convention as
// packages/product-intelligence/src/__tests__/fixtures.ts) so each portfolio
// test controls exactly which evidence a capability/product carries, without
// routing through full architecture/repository-model discovery.
// ---------------------------------------------------------------------------

export const GENERATED_AT = "2026-07-01T00:00:00.000Z";
export const GIT_COMMIT = "abc1234";

export function makeCapabilityEvidence(type: CapabilityEvidenceType, overrides: Partial<CapabilityEvidence> = {}): CapabilityEvidence {
  return {
    id: `capintel:evidence:${overrides.sourcePath ?? "widget"}:${type}:0`,
    type,
    sourcePath: `packages/widget/src/${type}.ts`,
    description: `${type} evidence.`,
    strength: CAPABILITY_EVIDENCE_STRENGTH[type],
    confidence: "confirmed",
    ...overrides,
  };
}

export function makeReadiness(overrides: Partial<CapabilityReadiness> = {}): CapabilityReadiness {
  return { score: 80, implementationScore: 80, executionScore: 80, verificationScore: 80, documentationScore: 80, adoptionScore: 80, blockers: [], qualifiers: [], ...overrides };
}

export function makeCapability(overrides: Partial<Capability> & { sourceLabel?: string } = {}): Capability {
  const sourceLabel = overrides.sourceLabel ?? "Widget Sync";
  const id = overrides.id ?? `capintel:capability:${sourceLabel.replace(/\s+/g, "-").toLowerCase()}`;
  return {
    id,
    displayName: sourceLabel,
    shortDescription: sourceLabel,
    purpose: `Handles ${sourceLabel.toLowerCase()} for the platform.`,
    domainId: "capintel:domain:widget-operations",
    status: "implemented",
    confidence: "confirmed",
    inclusion: "include",
    readiness: makeReadiness(),
    actors: ["Operator"],
    workflows: ["widget-lifecycle"],
    logicalComponents: [],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("implementation")],
    matchedIncompleteSignals: [],
    naming: { sourceLabel, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

export function makeCapabilityDomain(overrides: Partial<CapabilityDomain> & { sourceLabel?: string } = {}): CapabilityDomain {
  const sourceLabel = overrides.sourceLabel ?? "Widget Operations";
  return {
    id: "capintel:domain:widget-operations",
    displayName: sourceLabel,
    purpose: `Everything involved in ${sourceLabel.toLowerCase()}.`,
    capabilities: [],
    evidenceCount: 0,
    operationalCapabilityCount: 0,
    partialCapabilityCount: 0,
    ...overrides,
  };
}

/** A structurally minimal, otherwise-empty CapabilityModel — the baseline most tests mutate a narrow slice of. */
export function makeCapabilityModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  const generationMetadata: CapabilityGenerationMetadata = {
    generated_at: GENERATED_AT,
    git_commit: GIT_COMMIT,
    schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    source_architecture_intelligence_generated_at: GENERATED_AT,
    assist_used: false,
    readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
    readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
    candidateCount: 0,
  };
  return {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity: { displayName: "Widget Platform", purpose: "Automates widget operations." },
    domains: [makeCapabilityDomain()],
    includedCapabilities: [makeCapability()],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: {},
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
    generationMetadata,
    ...overrides,
  };
}

export function makeProductIdentity(overrides: Partial<ProductIdentity> = {}): ProductIdentity {
  return {
    displayName: "Widget Platform",
    descriptor: "Governance and compliance platform",
    shortPromise: "Widget Platform governs widget operations for compliance teams.",
    archetype: "governance_platform",
    secondaryArchetypes: [],
    purpose: "Provides governed oversight of widget operations for compliance officers.",
    primaryUsers: ["Compliance Officer"],
    secondaryUsers: [],
    valuePillars: [],
    differentiators: [],
    currentCapabilities: ["capintel:capability:widget-sync"],
    qualifiedCapabilities: [],
    limitations: [],
    evidence: [],
    confidence: "confirmed",
    overrideApplied: false,
    ...overrides,
  };
}

export function makeProductIdentityModel(overrides: Partial<ProductIdentityModel> = {}, identityOverrides: Partial<ProductIdentity> = {}): ProductIdentityModel {
  const generationMetadata: ProductIdentityGenerationMetadata = {
    generated_at: GENERATED_AT,
    git_commit: GIT_COMMIT,
    schema_version: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    source_capability_model_generated_at: GENERATED_AT,
    assist_used: false,
    overrideApplied: false,
    candidateCount: 1,
    ...overrides.generationMetadata,
  };
  return {
    schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    identity: makeProductIdentity(identityOverrides),
    candidates: [],
    archetypeScores: [],
    ...overrides,
    generationMetadata,
  };
}

// ---------------------------------------------------------------------------
// Portfolio-level fixtures — a directly-constructed PortfolioProduct, used by
// every module downstream of identity reconciliation (capability
// normalization, relationships, dependencies, overlaps, gaps, maturity,
// operating model, claims, portfolio-plan, validation) without needing a
// full intake/compatibility round trip.
// ---------------------------------------------------------------------------

export function makeSourceMetadata(overrides: Partial<PortfolioSourceMetadata> = {}): PortfolioSourceMetadata {
  return {
    configId: "governance-cli",
    artifactRoot: "./artifacts/governance-cli",
    compatibility: "compatible",
    sourceProductIdentityGeneratedAt: GENERATED_AT,
    sourceCapabilityModelGeneratedAt: GENERATED_AT,
    ...overrides,
  };
}

export function makePortfolioProduct(overrides: Partial<PortfolioProduct> = {}): PortfolioProduct {
  const configId = overrides.source?.configId ?? "governance-cli";
  return {
    id: portfolioProductId(configId),
    displayName: "Governance CLI",
    descriptor: "Governance and compliance platform",
    primaryArchetype: "governance_platform",
    secondaryArchetypes: [],
    primaryRole: "governance_system",
    secondaryRoles: [],
    currentCapabilityIds: ["capintel:capability:widget-sync"],
    qualifiedCapabilityIds: [],
    currentCapabilityCount: 1,
    qualifiedCapabilityCount: 0,
    source: makeSourceMetadata({ configId }),
    ...overrides,
  };
}

export function makePortfolioConfigProduct(overrides: Partial<PortfolioConfigProduct> = {}): PortfolioConfigProduct {
  return { id: "governance-cli", artifact_root: "./artifacts/governance-cli", ...overrides };
}

export function makePortfolioConfig(overrides: Partial<PortfolioConfig> = {}): PortfolioConfig {
  return {
    schema_version: 1,
    portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
    products: [makePortfolioConfigProduct()],
    ...overrides,
  };
}

/** A directly-constructed normalized PortfolioCapability (§8 output shape) for modules downstream of capability normalization (overlaps.ts, product-relationships.ts) that consume the normalized capability list without needing to run normalizePortfolioCapabilities() itself. */
export function makePortfolioCapability(overrides: Partial<PortfolioCapability> = {}): PortfolioCapability {
  return {
    id: "portfolio:capability:widget-sync",
    displayName: "Widget Sync",
    domain: "Widget Operations",
    coverage: "single_product",
    participation: [],
    evidenceIds: [],
    confidence: "confirmed",
    ...overrides,
  };
}

export function makePortfolioCapabilityParticipation(overrides: Partial<PortfolioCapabilityParticipation> = {}): PortfolioCapabilityParticipation {
  return {
    productId: "portfolio:product:governance-cli",
    productCapabilityId: "capintel:capability:widget-sync",
    productCapabilityDisplayName: "Widget Sync",
    qualified: false,
    ...overrides,
  };
}

/** A directly-constructed PortfolioProductIntake (the post-intake, pre-reconciliation bundle) for identity-reconciliation.ts's buildPortfolioProduct/buildPortfolioProducts, which consume this shape directly rather than a PortfolioProduct. */
export function makePortfolioProductIntake(overrides: Partial<PortfolioProductIntake> = {}): PortfolioProductIntake {
  const configId = overrides.configId ?? "governance-cli";
  return {
    configId,
    artifactRoot: `./artifacts/${configId}`,
    artifacts: { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() },
    compatibility: "compatible",
    issues: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Disk fixtures — writes a real product-identity.json/capability-model.json
// pair (or a subset, or neither) into `<repoRoot>/artifacts/<configId>/` so
// intake.ts/index.ts tests can exercise the real node:fs-backed intake path
// without any repository scan. Returns the artifact_root string (relative to
// repoRoot, `.rvs/portfolio.yml`-style) to plug directly into a
// PortfolioConfigProduct.
// ---------------------------------------------------------------------------

export function writeArtifactRoot(
  repoRoot: string,
  configId: string,
  artifacts: { productIdentity?: ProductIdentityModel; capabilityModel?: CapabilityModel } = {},
): string {
  const artifactRoot = join(repoRoot, "artifacts", configId);
  mkdirSync(artifactRoot, { recursive: true });
  if (artifacts.productIdentity) {
    writeFileSync(join(artifactRoot, "product-identity.json"), JSON.stringify(artifacts.productIdentity, null, 2), "utf8");
  }
  if (artifacts.capabilityModel) {
    writeFileSync(join(artifactRoot, "capability-model.json"), JSON.stringify(artifacts.capabilityModel, null, 2), "utf8");
  }
  return `./artifacts/${configId}`;
}

// ---------------------------------------------------------------------------
// Full PortfolioModel/PortfolioPlan-graph fixtures — used by exporter.test.ts,
// validation.test.ts, and portfolio-plan.test.ts, which each need a
// structurally complete (and, by default, internally consistent /
// zero-validation-warning) PortfolioModel or PortfolioPlan rather than the
// bare PortfolioProduct/PortfolioCapability fragments above.
// ---------------------------------------------------------------------------

/** The evidence id every other default fixture below (capability, relationship, edge, overlap, gap, claim, decision) cites by default, so a freshly-built makePortfolioModel() is internally consistent out of the box. */
export const DEFAULT_PORTFOLIO_EVIDENCE_ID = "portfolio:evidence:capability:portfolio-product-governance-cli:0";

export function makePortfolioEvidence(overrides: Partial<PortfolioEvidence> = {}): PortfolioEvidence {
  return {
    id: DEFAULT_PORTFOLIO_EVIDENCE_ID,
    sourceType: "capability",
    productId: "portfolio:product:governance-cli",
    text: "Widget sync capability evidence.",
    confidence: "confirmed",
    ...overrides,
  };
}

export function makePortfolioRelationship(overrides: Partial<PortfolioProductRelationship> = {}): PortfolioProductRelationship {
  const productAId = overrides.productAId ?? "portfolio:product:alpha-cli";
  const productBId = overrides.productBId ?? "portfolio:product:beta-cli";
  const type = overrides.type ?? "shared_capability";
  return {
    id: portfolioRelationshipId(productAId, productBId, type),
    productAId,
    productBId,
    type,
    confidence: "confirmed",
    statement: "Alpha CLI and Beta CLI share the widget-sync capability.",
    capabilityIds: ["portfolio:capability:widget-sync"],
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    ...overrides,
  };
}

export function makePortfolioDependencyNode(overrides: Partial<PortfolioDependencyNode> = {}): PortfolioDependencyNode {
  const kind = overrides.kind ?? "product";
  const label = overrides.label ?? "Alpha CLI";
  return { id: portfolioDependencyNodeId(kind, label), kind, label, ...overrides };
}

export function makePortfolioDependencyEdge(overrides: Partial<PortfolioDependencyEdge> = {}): PortfolioDependencyEdge {
  const kind = overrides.kind ?? "produces";
  const sourceProductId = overrides.sourceProductId ?? "portfolio:product:alpha-cli";
  const targetId = overrides.targetId ?? "portfolio:node:product:beta-cli";
  return {
    id: portfolioDependencyEdgeId(kind, sourceProductId, targetId),
    kind,
    sourceProductId,
    targetId,
    confidence: "confirmed",
    qualifiers: [],
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    ...overrides,
  };
}

export function makePortfolioOverlap(overrides: Partial<PortfolioOverlap> = {}): PortfolioOverlap {
  const capabilityId = overrides.capabilityId ?? "portfolio:capability:widget-sync";
  return {
    id: portfolioOverlapId(capabilityId),
    capabilityId,
    productIds: ["portfolio:product:alpha-cli", "portfolio:product:beta-cli"],
    severity: "material",
    statement: "Two products implement overlapping widget-sync coverage.",
    ownershipResolved: false,
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    ...overrides,
  };
}

export function makePortfolioGap(overrides: Partial<PortfolioGap> = {}): PortfolioGap {
  const type = overrides.type ?? "unowned_capability";
  const key = overrides.capabilityId ?? "portfolio:capability:widget-sync";
  return {
    id: portfolioGapId(type, key),
    type,
    statement: "The widget-sync capability has no clearly resolved owner.",
    affectedProductIds: ["portfolio:product:alpha-cli"],
    capabilityId: "portfolio:capability:widget-sync",
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    ...overrides,
  };
}

export function makePortfolioMaturityDimension(overrides: Partial<PortfolioMaturityDimension> = {}): PortfolioMaturityDimension {
  return { score: 0, numerator: 0, denominator: 0, label: "Dimension", ...overrides };
}

export function makePortfolioMaturitySummary(overrides: Partial<PortfolioMaturitySummary> = {}): PortfolioMaturitySummary {
  return {
    coverage: makePortfolioMaturityDimension({ label: "Coverage" }),
    operational: makePortfolioMaturityDimension({ label: "Operational" }),
    verification: makePortfolioMaturityDimension({ label: "Verification" }),
    integration: makePortfolioMaturityDimension({ label: "Integration" }),
    ownership: makePortfolioMaturityDimension({ label: "Ownership" }),
    runtimeEvidence: makePortfolioMaturityDimension({ label: "Runtime Evidence" }),
    coherence: makePortfolioMaturityDimension({ label: "Coherence" }),
    ...overrides,
  };
}

export function makePortfolioOperatingModel(overrides: Partial<PortfolioOperatingModel> = {}): PortfolioOperatingModel {
  return { stages: [], transitions: [], unassignedProductIds: [], ...overrides };
}

export function makePortfolioClaim(overrides: Partial<PortfolioClaim> = {}): PortfolioClaim {
  const claimType = overrides.claimType ?? "identity";
  const subjectId = "portfolio:product:governance-cli";
  return {
    id: portfolioClaimId(claimType, subjectId),
    text: "Governance CLI provides governed oversight of widget operations.",
    claimType,
    status: "approved",
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    qualifiers: [],
    rejectionReasons: [],
    ...overrides,
  };
}

export function makePortfolioDecision(overrides: Partial<PortfolioDecision> = {}): PortfolioDecision {
  const type = overrides.type ?? "ownership";
  const key = "widget-sync";
  return {
    id: portfolioDecisionId(type, key),
    type,
    statement: "Determine an explicit owner for the widget-sync capability.",
    whyItMatters: "Capabilities without a clear owner risk divergent evolution and duplicated maintenance effort.",
    affectedProductIds: ["portfolio:product:alpha-cli"],
    evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    currentAmbiguity: "No single product fully owns widget-sync.",
    recommendedOwnerType: "platform_leadership",
    urgency: "medium",
    confidence: "derived",
    ...overrides,
  };
}

export function makePortfolioScenePlan(overrides: Partial<PortfolioScenePlan> = {}): PortfolioScenePlan {
  const type: PortfolioSceneType = overrides.type ?? "portfolio-hero";
  return {
    id: portfolioSceneId(type, 0),
    type,
    headline: "Portfolio unifies governance and operations tooling",
    subheadline: undefined,
    density: "low",
    productIds: [],
    capabilityIds: [],
    relationshipIds: [],
    gapIds: [],
    decisionIds: [],
    claimIds: [],
    evidenceIds: [],
    qualifiers: [],
    ...overrides,
  };
}

export function makePortfolioNarrative(overrides: Partial<PortfolioNarrative> = {}): PortfolioNarrative {
  return {
    mission: "The portfolio governs widget operations end to end.",
    productsAndRoles: "Governance CLI leads policy; Operations Hub runs day-to-day operations.",
    sharedOperatingModel: "Products progress from plan through operate across a shared pipeline.",
    capabilityCoverage: "Widget sync is fully covered by a single product.",
    productRelationships: "No confirmed cross-product relationships yet.",
    proofAndMaturity: "Coverage maturity is fully evidenced.",
    gapsAndDecisions: "No structural gaps are currently open.",
    strategicDirection: "Continue consolidating shared capabilities under a single owner.",
    approvedClaims: [],
    rejectedClaims: [],
    runtimeVerificationClaims: [],
    ...overrides,
  };
}

/**
 * A structurally complete, internally-consistent PortfolioModel: one product,
 * one single-product capability it participates in, one supporting evidence
 * record, and otherwise-empty relationship/dependency/overlap/gap/operating-
 * model/maturity sections. Passes validatePortfolioModel with zero warnings
 * by default — tests clone and break exactly one invariant at a time.
 */
export function makePortfolioModel(overrides: Partial<PortfolioModel> = {}): PortfolioModel {
  const product = makePortfolioProduct();
  return {
    schemaVersion: 1,
    portfolioId: "test-portfolio",
    displayName: "Test Portfolio",
    products: [product],
    domains: [],
    capabilities: [makePortfolioCapability({ participation: [makePortfolioCapabilityParticipation({ productId: product.id })], evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })],
    relationships: [],
    unresolvedRelationships: [],
    dependencyGraph: { nodes: [], edges: [] },
    overlaps: [],
    gaps: [],
    operatingModel: makePortfolioOperatingModel(),
    maturity: makePortfolioMaturitySummary(),
    evidence: [makePortfolioEvidence()],
    evidenceSummary: {
      productCount: 1,
      uniqueCapabilityCount: 1,
      productCapabilityImplementationCount: 1,
      qualifiedOnlyCapabilityCount: 0,
      confirmedRelationshipCount: 0,
      materialOverlapCount: 0,
      gapCount: 0,
      productsWithRuntimeEvidenceCount: 0,
    },
    excludedProducts: [],
    generationMetadata: {
      generated_at: GENERATED_AT,
      schema_version: 1,
      productCount: 1,
      incompatibleProductCount: 0,
      allowPartialPortfolio: false,
    },
    ...overrides,
  };
}

/**
 * A structurally complete PortfolioPlan wrapping makePortfolioModel() by
 * default: six evidence-empty scenes (at PORTFOLIO_PLAN_MIN_SCENES) and zero
 * decisions, sorted by id so it also passes validatePortfolioPlan with zero
 * warnings out of the box.
 */
export function makePortfolioPlan(overrides: Partial<PortfolioPlan> = {}): PortfolioPlan {
  const model = overrides.model ?? makePortfolioModel();
  const narrative = overrides.narrative ?? makePortfolioNarrative();
  const decisions = overrides.decisions ?? [];
  const scenes =
    overrides.scenes ??
    (["portfolio-hero", "portfolio-mission", "portfolio-capability-coverage", "portfolio-gaps", "portfolio-maturity", "portfolio-closing"] as PortfolioSceneType[]).map((type, i) =>
      makePortfolioScenePlan({ id: portfolioSceneId(type, i), type, headline: `Scene headline number ${i} about the portfolio` }),
    );
  const sortedScenes = [...scenes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedDecisions = [...decisions].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    model,
    narrative,
    decisions: sortedDecisions,
    scenes: sortedScenes,
    generationMetadata: {
      generated_at: GENERATED_AT,
      schema_version: 1,
      audience: "executive",
      theme: "default",
      evidenceMode: "concise",
      includeRoadmap: false,
      sceneCount: sortedScenes.length,
    },
    ...overrides,
  };
}
