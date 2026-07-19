import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { AudienceType, ProductArchetype, ProductIdentityModel } from "@rvs/product-intelligence";

export const PORTFOLIO_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Core enums (§4)
// ---------------------------------------------------------------------------

/**
 * Every cross-product capability pair and every product-to-product edge
 * resolves to exactly one of these (§9/§10). "unresolved" is not a defect
 * state — insufficient or contradictory evidence must render as unresolved
 * rather than as a guessed relationship (core principle, repeated from every
 * prior milestone's conservative-bias requirement).
 */
export type PortfolioRelationshipType =
  | "shared_capability"
  | "complementary_capability"
  | "overlapping_capability"
  | "upstream_dependency"
  | "downstream_dependency"
  | "shared_platform"
  | "shared_contract"
  | "shared_actor"
  | "shared_workflow"
  | "alternative_implementation"
  | "unresolved";

export type PortfolioRelationshipConfidence = "confirmed" | "derived" | "suggested" | "unresolved";

/** How a single normalized capability is realized across the portfolio (§8/§13). */
export type PortfolioCapabilityCoverage = "single_product" | "shared" | "complementary" | "overlapping" | "fragmented" | "missing" | "roadmap_only";

/**
 * Derived only from evidence already present in each product's own
 * ArchitectureIntelligence/CapabilityModel/ProductIdentityModel (archetype,
 * included capabilities, value pillars, workflow families, relationships to
 * other products) — never assigned because a repository or its README uses
 * a particular phrase (§12).
 */
export type PortfolioProductRole =
  | "control_plane"
  | "governance_system"
  | "operations_system"
  | "developer_tool"
  | "reliability_system"
  | "migration_system"
  | "metadata_system"
  | "presentation_system"
  | "integration_layer"
  | "shared_library"
  | "domain_product"
  | "unknown";

/** Mirrors @rvs/product-intelligence's ClaimStatus verbatim — the portfolio layer never invents a second claim-status vocabulary (§18). */
export type PortfolioClaimStatus = "approved" | "approved_with_qualification" | "rejected" | "runtime_verification_required";

export type PortfolioClaimType = "identity" | "coverage" | "relationship" | "integration" | "unification" | "maturity" | "scale" | "adoption" | "ownership" | "operating_model";

export type PortfolioClaimRejectionReasonCode =
  | "PORTFOLIO_CLAIM_UNSUPPORTED"
  | "PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY"
  | "PORTFOLIO_CLAIM_ROADMAP_PROMOTED"
  | "PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED"
  | "PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED"
  | "PORTFOLIO_CLAIM_UNSUPPORTED_SCALE"
  | "PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION"
  | "PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION"
  | "PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION"
  | "PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP"
  | "PORTFOLIO_CLAIM_GENERIC_MARKETING"
  | "PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP";

export type PortfolioOverlapSeverity = "informational" | "minor" | "material" | "strategic";

export type PortfolioGapType =
  | "no_product_coverage"
  | "qualified_only_coverage"
  | "fragmented_coverage"
  | "unowned_capability"
  | "dependency_gap"
  | "contract_gap"
  | "operational_gap"
  | "runtime_verification_gap";

export type PortfolioDependencyEdgeKind = "produces" | "consumes" | "validates" | "governs" | "deploys_to" | "reads_from" | "writes_to" | "depends_on" | "publishes" | "enriches";

export type PortfolioDependencyNodeKind = "product" | "shared_platform" | "contract" | "external_system" | "artifact_type" | "shared_service";

export type PortfolioOperatingStage = "plan" | "build" | "validate" | "govern" | "promote" | "operate" | "observe" | "improve";

export type PortfolioDecisionType =
  | "ownership"
  | "overlap_resolution"
  | "shared_contract"
  | "product_boundary"
  | "runtime_verification"
  | "qualified_capability_investment"
  | "gap_closure"
  | "deprecation"
  | "integration_priority";

/** Generic decision-owner categories only — never a named individual (§25). */
export type PortfolioDecisionOwnerType = "platform_leadership" | "product_owner" | "architecture_council" | "security_owner" | "operations_owner";

export type PortfolioDecisionUrgency = "low" | "medium" | "high";

/**
 * Extends product-intelligence's 3-mode ShowcaseEvidenceMode with a 4th,
 * portfolio-only "audit" mode (§27) — kept as a separate type (not a shared
 * union edit to product-intelligence) so the two packages' evidence-mode
 * vocabularies can evolve independently, exactly as CapabilityConfidence and
 * ProductIdentityConfidence stay separate aliases of the same underlying
 * four-class scale rather than one shared exported type.
 */
export type PortfolioEvidenceMode = "concise" | "visible" | "appendix" | "audit";

export type PortfolioSceneType =
  | "portfolio-hero"
  | "portfolio-mission"
  | "portfolio-landscape"
  | "portfolio-product-roles"
  | "portfolio-operating-model"
  | "portfolio-capability-coverage"
  | "portfolio-relationship-map"
  | "portfolio-dependency-map"
  | "portfolio-shared-contracts"
  | "portfolio-maturity"
  | "portfolio-gaps"
  | "portfolio-decisions"
  | "portfolio-closing";

// ---------------------------------------------------------------------------
// Intake and compatibility (§2, §6)
// ---------------------------------------------------------------------------

export type PortfolioRequiredArtifact = "product-identity.json" | "capability-model.json";
export type PortfolioOptionalArtifact = "architecture-intelligence.json" | "repository-model.json" | "showcase-plan.json" | "showcase-claims.json";

export type PortfolioProductInputIssueCode =
  | "required-input-missing"
  | "optional-input-unavailable"
  | "input-invalid"
  | "input-incompatible"
  | "input-stale"
  | "input-generated-by-unsupported-schema-version";

export interface PortfolioProductInputIssue {
  code: PortfolioProductInputIssueCode;
  artifact: PortfolioRequiredArtifact | PortfolioOptionalArtifact;
  message: string;
}

export type PortfolioCompatibilityStatus = "compatible" | "compatible_with_warnings" | "incompatible" | "missing_required_artifact" | "unsupported_schema" | "identity_mismatch" | "stale_artifact_set";

/** Raw per-product artifact bundle loaded from an artifact root, prior to any reconciliation. Never rescans a repository — always reads already-generated Milestone 3-5 output (§2 hard constraint). */
export interface PortfolioProductArtifacts {
  productIdentity?: ProductIdentityModel;
  capabilityModel?: CapabilityModel;
}

export interface PortfolioProductIntake {
  configId: string;
  artifactRoot: string;
  artifacts: PortfolioProductArtifacts;
  compatibility: PortfolioCompatibilityStatus;
  issues: PortfolioProductInputIssue[];
}

// ---------------------------------------------------------------------------
// Portfolio config (.rvs/portfolio.yml, §5)
// ---------------------------------------------------------------------------

export interface PortfolioConfigProduct {
  id: string;
  artifact_root: string;
  alias_of?: string;
}

export interface PortfolioConfigApprovedRelationship {
  product_a: string;
  product_b: string;
  relationship: PortfolioRelationshipType;
  note?: string;
}

export interface PortfolioConfig {
  schema_version: 1;
  portfolio: { id: string; display_name: string };
  products: PortfolioConfigProduct[];
  audiences?: AudienceType[];
  approved_relationships?: PortfolioConfigApprovedRelationship[];
  disallowed_claims?: string[];
  runtime_claims?: string[];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type PortfolioEvidenceSourceType = "product_identity" | "capability" | "capability_domain" | "architecture" | "config";

export interface PortfolioEvidence {
  id: string;
  sourceType: PortfolioEvidenceSourceType;
  productId: string;
  sourceId?: string;
  text: string;
  confidence: PortfolioRelationshipConfidence;
}

// ---------------------------------------------------------------------------
// Products and capabilities
// ---------------------------------------------------------------------------

export interface PortfolioSourceMetadata {
  configId: string;
  artifactRoot: string;
  compatibility: PortfolioCompatibilityStatus;
  sourceProductIdentityGeneratedAt?: string;
  sourceCapabilityModelGeneratedAt?: string;
}

export interface PortfolioProduct {
  id: string;
  displayName: string;
  descriptor: string;
  primaryArchetype: ProductArchetype;
  secondaryArchetypes: ProductArchetype[];
  primaryRole: PortfolioProductRole;
  secondaryRoles: PortfolioProductRole[];
  currentCapabilityIds: string[];
  qualifiedCapabilityIds: string[];
  currentCapabilityCount: number;
  qualifiedCapabilityCount: number;
  source: PortfolioSourceMetadata;
}

/** One participating product's realization of a normalized portfolio capability — never the capability itself (§13: participation, not duplication). */
export interface PortfolioCapabilityParticipation {
  productId: string;
  productCapabilityId: string;
  productCapabilityDisplayName: string;
  qualified: boolean;
}

export interface PortfolioCapability {
  id: string;
  displayName: string;
  domain: string;
  coverage: PortfolioCapabilityCoverage;
  participation: PortfolioCapabilityParticipation[];
  evidenceIds: string[];
  confidence: PortfolioRelationshipConfidence;
}

// ---------------------------------------------------------------------------
// Relationships and dependencies
// ---------------------------------------------------------------------------

export interface PortfolioProductRelationship {
  id: string;
  productAId: string;
  productBId: string;
  type: PortfolioRelationshipType;
  confidence: PortfolioRelationshipConfidence;
  statement: string;
  capabilityIds: string[];
  evidenceIds: string[];
}

export interface PortfolioDependencyNode {
  id: string;
  kind: PortfolioDependencyNodeKind;
  label: string;
}

export interface PortfolioDependencyEdge {
  id: string;
  kind: PortfolioDependencyEdgeKind;
  sourceProductId: string;
  targetId: string;
  confidence: PortfolioRelationshipConfidence;
  qualifiers: string[];
  evidenceIds: string[];
}

export interface PortfolioDependencyGraph {
  nodes: PortfolioDependencyNode[];
  edges: PortfolioDependencyEdge[];
}

// ---------------------------------------------------------------------------
// Overlaps and gaps
// ---------------------------------------------------------------------------

export interface PortfolioOverlap {
  id: string;
  capabilityId: string;
  productIds: string[];
  severity: PortfolioOverlapSeverity;
  statement: string;
  ownershipResolved: boolean;
  evidenceIds: string[];
}

export interface PortfolioGap {
  id: string;
  type: PortfolioGapType;
  statement: string;
  affectedProductIds: string[];
  capabilityId?: string;
  evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Operating model
// ---------------------------------------------------------------------------

export interface PortfolioOperatingStageAssignment {
  stage: PortfolioOperatingStage;
  productIds: string[];
  capabilityIds: string[];
  inferred: boolean;
}

export interface PortfolioOperatingTransition {
  fromStage: PortfolioOperatingStage;
  toStage: PortfolioOperatingStage;
  statement: string;
  inferred: boolean;
  evidenceIds: string[];
}

export interface PortfolioOperatingModel {
  stages: PortfolioOperatingStageAssignment[];
  transitions: PortfolioOperatingTransition[];
  unassignedProductIds: string[];
}

// ---------------------------------------------------------------------------
// Maturity
// ---------------------------------------------------------------------------

export interface PortfolioMaturityDimension {
  score: number;
  numerator: number;
  denominator: number;
  label: string;
}

export interface PortfolioMaturitySummary {
  coverage: PortfolioMaturityDimension;
  operational: PortfolioMaturityDimension;
  verification: PortfolioMaturityDimension;
  integration: PortfolioMaturityDimension;
  ownership: PortfolioMaturityDimension;
  runtimeEvidence: PortfolioMaturityDimension;
  coherence: PortfolioMaturityDimension;
}

// ---------------------------------------------------------------------------
// Claims and decisions
// ---------------------------------------------------------------------------

export interface PortfolioClaim {
  id: string;
  text: string;
  claimType: PortfolioClaimType;
  status: PortfolioClaimStatus;
  evidenceIds: string[];
  qualifiers: string[];
  rejectionReasons: PortfolioClaimRejectionReasonCode[];
}

export interface PortfolioDecision {
  id: string;
  type: PortfolioDecisionType;
  statement: string;
  whyItMatters: string;
  affectedProductIds: string[];
  evidenceIds: string[];
  currentAmbiguity: string;
  recommendedOwnerType: PortfolioDecisionOwnerType;
  urgency: PortfolioDecisionUrgency;
  confidence: PortfolioRelationshipConfidence;
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface PortfolioNarrative {
  mission: string;
  productsAndRoles: string;
  sharedOperatingModel: string;
  capabilityCoverage: string;
  productRelationships: string;
  proofAndMaturity: string;
  gapsAndDecisions: string;
  strategicDirection: string;
  approvedClaims: PortfolioClaim[];
  rejectedClaims: PortfolioClaim[];
  runtimeVerificationClaims: PortfolioClaim[];
}

// ---------------------------------------------------------------------------
// Domains and portfolio-wide evidence summary
// ---------------------------------------------------------------------------

export interface PortfolioDomain {
  id: string;
  displayName: string;
  capabilityIds: string[];
}

export interface PortfolioEvidenceSummary {
  productCount: number;
  uniqueCapabilityCount: number;
  productCapabilityImplementationCount: number;
  qualifiedOnlyCapabilityCount: number;
  confirmedRelationshipCount: number;
  materialOverlapCount: number;
  gapCount: number;
  productsWithRuntimeEvidenceCount: number;
}

export interface PortfolioWarning {
  code: string;
  severity: "informational" | "warning" | "error";
  message: string;
  relatedId?: string;
  remediation?: string;
}

export interface PortfolioGenerationMetadata {
  generated_at: string;
  schema_version: number;
  productCount: number;
  incompatibleProductCount: number;
  allowPartialPortfolio: boolean;
}

// ---------------------------------------------------------------------------
// Portfolio model — the pipeline's terminal artifact
// ---------------------------------------------------------------------------

export interface PortfolioModel {
  schemaVersion: number;
  portfolioId: string;
  displayName: string;
  products: PortfolioProduct[];
  domains: PortfolioDomain[];
  capabilities: PortfolioCapability[];
  relationships: PortfolioProductRelationship[];
  unresolvedRelationships: PortfolioProductRelationship[];
  dependencyGraph: PortfolioDependencyGraph;
  overlaps: PortfolioOverlap[];
  gaps: PortfolioGap[];
  operatingModel: PortfolioOperatingModel;
  maturity: PortfolioMaturitySummary;
  evidence: PortfolioEvidence[];
  evidenceSummary: PortfolioEvidenceSummary;
  excludedProducts: PortfolioProductIntake[];
  generationMetadata: PortfolioGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Presentation planning (§20-27)
// ---------------------------------------------------------------------------

export type PortfolioSceneDensity = "low" | "medium";

export interface PortfolioScenePlan {
  id: string;
  type: PortfolioSceneType;
  headline: string;
  subheadline?: string;
  density: PortfolioSceneDensity;
  productIds: string[];
  capabilityIds: string[];
  relationshipIds: string[];
  gapIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  qualifiers: string[];
}

export interface PortfolioPlanGenerationMetadata {
  generated_at: string;
  schema_version: number;
  audience: AudienceType;
  theme: string;
  evidenceMode: PortfolioEvidenceMode;
  includeRoadmap: boolean;
  sceneCount: number;
}

export interface PortfolioPlan {
  schemaVersion: number;
  model: PortfolioModel;
  narrative: PortfolioNarrative;
  decisions: PortfolioDecision[];
  scenes: PortfolioScenePlan[];
  generationMetadata: PortfolioPlanGenerationMetadata;
}
