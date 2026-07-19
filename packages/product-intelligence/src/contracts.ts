import type { InferenceClass } from "@rvs/architecture-intelligence";

export const PRODUCT_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/** Reuses the architecture-intelligence four-class inference vocabulary verbatim, exactly as @rvs/capability-intelligence's CapabilityConfidence does — this layer never invents a third confidence scale. */
export type ProductIdentityConfidence = InferenceClass;

export type ProductArchetype =
  | "governance_platform"
  | "operations_platform"
  | "reliability_platform"
  | "developer_tool"
  | "automation_platform"
  | "migration_platform"
  | "observability_platform"
  | "control_plane"
  | "integration_platform"
  | "data_product"
  | "library"
  | "framework"
  | "unknown";

export type AudienceType =
  | "executive"
  | "product_leader"
  | "platform_leader"
  | "architect"
  | "engineering_leader"
  | "developer"
  | "operator"
  | "portfolio"
  | "conference";

export type ClaimStatus = "approved" | "approved_with_qualification" | "rejected" | "runtime_verification_required";

export type ClaimType = "identity" | "purpose" | "outcome" | "capability" | "differentiator" | "maturity" | "scale" | "adoption" | "comparison";

/**
 * Reasons a ProductClaim was rejected or held. Mirrors
 * @rvs/capability-intelligence's CapabilityExclusionReasonCode precedent: a
 * closed enum, checked deterministically, never a free-text explanation
 * alone.
 */
export type ShowcaseClaimRejectionReasonCode =
  | "SHOWCASE_CLAIM_UNSUPPORTED"
  | "SHOWCASE_CLAIM_ROADMAP_PROMOTED"
  | "SHOWCASE_CLAIM_EXCLUDED_CAPABILITY"
  | "SHOWCASE_CLAIM_UNQUALIFIED_PARTIAL"
  | "SHOWCASE_CLAIM_RUNTIME_UNVERIFIED"
  | "SHOWCASE_CLAIM_UNSUPPORTED_SCALE"
  | "SHOWCASE_CLAIM_UNSUPPORTED_ROI"
  | "SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE"
  | "SHOWCASE_CLAIM_DUPLICATE"
  | "SHOWCASE_CLAIM_TOO_TECHNICAL"
  | "SHOWCASE_CLAIM_GENERIC_MARKETING";

/**
 * Terms that read as unsupported marketing language when used without
 * qualifying evidence. Generic — never a repository-specific phrase list.
 * Shared between claims.ts (rejection) and archetypes.ts/purpose.ts
 * (descriptor generation avoids them at the source).
 */
export const GENERIC_MARKETING_TERMS: readonly string[] = [
  "ai-powered",
  "ai powered",
  "next-generation",
  "next generation",
  "revolutionary",
  "seamless experience",
  "powerful insights",
  "cutting-edge",
  "cutting edge",
  "industry-leading",
  "industry leading",
  "best in class",
  "world-class",
  "unmatched",
  "unrivaled",
  "game-changing",
  "game changing",
  "state-of-the-art",
  "state of the art",
];

/** Superiority/absolute language that requires comparative evidence this engine never has access to (§9/§28 SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE). */
export const ABSOLUTE_SUPERIORITY_TERMS: readonly string[] = ["more powerful", "better than", "best-in-class", "unique", "industry leading", "unmatched", "unrivaled", "the only"];

/** Qualified terms that require specific evidence classes before they may appear in a descriptor/purpose/claim (§5). */
export const QUALIFIED_MATURITY_TERMS: Record<string, readonly ("deployment" | "release" | "usage")[]> = {
  "production-grade": ["deployment", "release", "usage"],
  "production grade": ["deployment", "release", "usage"],
};

/** Scale/criticality terms that require specific evidence classes before they may appear in a descriptor/purpose (§5, PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM) — generic, never a repository-specific phrase list. */
export const ENTERPRISE_SCALE_TERMS: Record<string, readonly ("deployment" | "release" | "usage")[]> = {
  "enterprise-grade": ["deployment", "release", "usage"],
  "enterprise grade": ["deployment", "release", "usage"],
  "enterprise-ready": ["deployment", "release", "usage"],
  "enterprise ready": ["deployment", "release", "usage"],
  "mission-critical": ["deployment", "usage"],
  "mission critical": ["deployment", "usage"],
};

// ---------------------------------------------------------------------------
// Identity evidence and candidates
// ---------------------------------------------------------------------------

export type ProductIdentityEvidenceSourceType =
  | "capability"
  | "capability_domain"
  | "workflow_family"
  | "logical_component"
  | "package_metadata"
  | "repository_metadata"
  | "documentation"
  | "release"
  | "deployment"
  | "usage";

export interface ProductIdentityEvidence {
  id: string;
  sourceType: ProductIdentityEvidenceSourceType;
  sourceId?: string;
  sourcePath?: string;
  text: string;
  confidence: ProductIdentityConfidence;
  strength: number;
}

export interface ProductIdentityCandidate {
  id: string;
  displayName: string;
  archetype: ProductArchetype;
  purpose: string;
  primaryUsers: string[];
  valuePillars: string[];
  differentiators: string[];
  evidence: ProductIdentityEvidence[];
  confidence: ProductIdentityConfidence;
  score: number;
}

// ---------------------------------------------------------------------------
// Value pillars, differentiators, proof points
// ---------------------------------------------------------------------------

export interface ProductValuePillar {
  id: string;
  title: string;
  explanation: string;
  includedCapabilityIds: string[];
  qualifiedCapabilityIds: string[];
  evidenceIds: string[];
  confidence: ProductIdentityConfidence;
  qualification?: string;
}

export type ProductDifferentiatorBasis = "multi_capability_support" | "cross_cutting_property" | "test_or_deployment_verified" | "operational_distinction";

export interface ProductDifferentiator {
  id: string;
  title: string;
  description: string;
  basis: ProductDifferentiatorBasis[];
  supportingCapabilityIds: string[];
  evidenceIds: string[];
  confidence: ProductIdentityConfidence;
}

export type ShowcaseMetricStatus = "confirmed" | "derived" | "runtime_unverified" | "rejected";

export interface ProductProofPoint {
  id: string;
  label: string;
  value: string;
  status: ShowcaseMetricStatus;
  evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Product identity
// ---------------------------------------------------------------------------

export interface ProductIdentity {
  displayName: string;
  descriptor: string;
  shortPromise: string;
  archetype: ProductArchetype;
  secondaryArchetypes: ProductArchetype[];
  purpose: string;
  primaryUsers: string[];
  secondaryUsers: string[];
  valuePillars: ProductValuePillar[];
  differentiators: ProductDifferentiator[];
  currentCapabilities: string[];
  qualifiedCapabilities: string[];
  limitations: string[];
  evidence: ProductIdentityEvidence[];
  confidence: ProductIdentityConfidence;
  /** Present only when a `.rvs/product.yml` override contributed to this identity (§27); generation metadata surfaces this same flag. */
  overrideApplied: boolean;
}

export interface ProductArchetypeScore {
  archetype: ProductArchetype;
  score: number;
  includedSignalCount: number;
  qualifiedSignalCount: number;
  matchedCapabilityIds: string[];
}

export interface ProductIdentityGenerationMetadata {
  generated_at: string;
  git_commit: string;
  schema_version: number;
  source_capability_model_generated_at: string;
  assist_used: boolean;
  overrideApplied: boolean;
  overridePath?: string;
  candidateCount: number;
}

export interface ProductIdentityModel {
  schemaVersion: number;
  identity: ProductIdentity;
  candidates: ProductIdentityCandidate[];
  archetypeScores: ProductArchetypeScore[];
  generationMetadata: ProductIdentityGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface ProductClaim {
  id: string;
  text: string;
  claimType: ClaimType;
  status: ClaimStatus;
  evidenceIds: string[];
  qualifiers: string[];
  rejectionReasons: ShowcaseClaimRejectionReasonCode[];
}

// ---------------------------------------------------------------------------
// Executive narrative
// ---------------------------------------------------------------------------

export interface ExecutiveNarrative {
  audience: AudienceType;
  objective: string;
  centralMessage: string;
  problemStatement: string;
  productPromise: string;
  valuePillars: ProductValuePillar[];
  proofPoints: ProductProofPoint[];
  differentiators: ProductDifferentiator[];
  limitations: string[];
  closingMessage: string;
  approvedClaims: ProductClaim[];
  rejectedClaims: ProductClaim[];
  runtimeVerificationClaims: ProductClaim[];
}

// ---------------------------------------------------------------------------
// Showcase profile, scenes, plan
// ---------------------------------------------------------------------------

export type ShowcaseSceneType =
  | "showcase-hero"
  | "showcase-problem"
  | "showcase-identity"
  | "showcase-operating-model"
  | "showcase-value-pillars"
  | "showcase-capabilities"
  | "showcase-differentiators"
  | "showcase-proof"
  | "showcase-limitations"
  | "showcase-closing"
  | "portfolio-overview";

export type ShowcaseVisualMetaphor = "hero" | "pillar-grid" | "layered-architecture" | "causal-flow" | "capability-map" | "proof-cards" | "comparison-matrix" | "constellation" | "journey" | "north-star";

export type ShowcaseDensity = "low" | "medium";

export interface ShowcaseScenePlan {
  id: string;
  type: ShowcaseSceneType;
  headline: string;
  subheadline?: string;
  narrativeRole: string;
  density: ShowcaseDensity;
  visualMetaphor: ShowcaseVisualMetaphor;
  capabilityIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  qualifiers: string[];
}

export type ShowcaseEvidenceMode = "concise" | "visible" | "appendix";

export interface ShowcaseMetric {
  id: string;
  label: string;
  value: string;
  status: ShowcaseMetricStatus;
  evidenceIds: string[];
  audiencePriority: number;
}

export interface ShowcaseEvidenceSummary {
  totalEvidence: number;
  confirmedCount: number;
  derivedCount: number;
  runtimeUnverifiedCount: number;
  approvedClaimCount: number;
  qualifiedClaimCount: number;
  rejectedClaimCount: number;
  runtimeVerificationClaimCount: number;
}

export interface ShowcaseGenerationMetadata {
  generated_at: string;
  git_commit: string;
  schema_version: number;
  source_product_identity_generated_at: string;
  assist_used: boolean;
  audience: AudienceType;
  theme: string;
  evidenceMode: ShowcaseEvidenceMode;
  sceneCount: number;
}

export interface ShowcasePlan {
  schemaVersion: number;
  identity: ProductIdentity;
  narrative: ExecutiveNarrative;
  scenes: ShowcaseScenePlan[];
  metrics: ShowcaseMetric[];
  evidenceSummary: ShowcaseEvidenceSummary;
  generationMetadata: ShowcaseGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Warnings (Tier 1 = error, Tier 2 = warning; mirrors CapIntelWarning)
// ---------------------------------------------------------------------------

export type ProductIntelWarningSeverity = "informational" | "warning" | "error";

export type ProductIntelWarningCode =
  | "PRODUCT_IDENTITY_MISSING"
  | "PRODUCT_IDENTITY_WEAK_EVIDENCE"
  | "PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES"
  | "PRODUCT_IDENTITY_UNSUPPORTED_DESCRIPTOR"
  | "PRODUCT_IDENTITY_GENERIC_MARKETING"
  | "PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM"
  | "PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM"
  | "PRODUCT_IDENTITY_OVERRIDE_CONFLICT"
  | "SHOWCASE_MISSING_CENTRAL_MESSAGE"
  | "SHOWCASE_GENERIC_HEADLINE"
  | "SHOWCASE_HEADLINE_TOO_LONG"
  | "SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED"
  | "SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM"
  | "SHOWCASE_HEADLINE_ROADMAP_PROMOTED"
  | "SHOWCASE_ROADMAP_PROMOTED"
  | "SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED"
  | "SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED"
  | "SHOWCASE_RUNTIME_CLAIM_UNVERIFIED"
  | "SHOWCASE_UNSUPPORTED_METRIC"
  | "SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY"
  | "SHOWCASE_SCENE_TOO_DENSE"
  | "SHOWCASE_SCENE_WORD_BUDGET_EXCEEDED"
  | "SHOWCASE_FONT_BELOW_MINIMUM"
  | "SHOWCASE_LOW_CONTRAST"
  | "SHOWCASE_EVIDENCE_MISSING"
  | "SHOWCASE_DUPLICATE_SCENE_PURPOSE"
  | "SHOWCASE_TOO_MANY_SCENES"
  | "SHOWCASE_TOO_FEW_SCENES"
  | "SHOWCASE_NONDETERMINISTIC_ORDER"
  | "SHOWCASE_UNSUPPORTED_DIFFERENTIATOR";

export interface ProductIntelWarning {
  code: ProductIntelWarningCode;
  severity: ProductIntelWarningSeverity;
  message: string;
  relatedId?: string;
  remediation?: string;
}

// ---------------------------------------------------------------------------
// Product identity override (.rvs/product.yml, §27)
// ---------------------------------------------------------------------------

export interface ProductIdentityOverride {
  schema_version: 1;
  display_name?: string;
  descriptor_override?: string;
  purpose_override?: string;
  primary_users?: string[];
  approved_terms?: string[];
  disallowed_terms?: string[];
  runtime_claims?: string[];
}
