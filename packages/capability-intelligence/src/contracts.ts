import type { ConfidenceSummary, EvidenceReference, InferenceClass, InferredStatement, NormalizedLabel } from "@rvs/architecture-intelligence";

export const CAPABILITY_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/**
 * A capability is not real merely because it is named — it must have
 * sufficient implementation, execution, and evidence to justify inclusion.
 * "Candidate found" is never the same thing as "capability implemented".
 */
export type CapabilityStatus = "operational" | "implemented" | "partial" | "experimental" | "planned" | "scaffolded" | "deprecated" | "abandoned" | "unknown";

/** Reuses the architecture-intelligence four-class inference vocabulary verbatim — this layer never invents a second confidence scale. */
export type CapabilityConfidence = InferenceClass;

/**
 * The final capability model must be conservative: when evidence is
 * incomplete, prefer exclude/include_with_qualification/gap_only/
 * roadmap_only over incorrectly promoting a candidate into the current
 * platform narrative.
 */
export type CapabilityInclusion = "include" | "include_with_qualification" | "exclude" | "roadmap_only" | "gap_only";

export type CapabilityEvidenceType =
  | "runtime_entrypoint"
  | "workflow"
  | "implementation"
  | "configuration"
  | "test"
  | "documentation"
  | "example"
  | "schema"
  | "deployment"
  | "release"
  | "usage"
  | "deprecated_marker"
  | "todo_marker";

/**
 * Only capability-grain candidates may become primary CAPABILITIES.md
 * entries. "domain" is a rollup above a capability; "feature"/
 * "implementation_step"/"artifact" are below it (e.g. "Load QueryGuard
 * YAML" is an implementation_step of the "Query and workload governance"
 * capability, not a capability of its own).
 */
export type CapabilityGranularity = "domain" | "capability" | "feature" | "implementation_step" | "artifact";

/**
 * TOO_GRANULAR, DUPLICATE_CAPABILITY, NOT_USER_MEANINGFUL, and
 * NO_SUPPORTED_OUTCOME were deliberately removed from this contract (rather
 * than wired up) because each concern is already handled correctly at a
 * later pipeline stage that has information decideCapabilityInclusion()
 * does not: granularity/naming and duplicate-name detection need the final
 * rendered displayName (CAP_INTEL_CAPABILITY_TOO_GRANULAR /
 * CAP_INTEL_DUPLICATE_CAPABILITY in validation.ts; near-duplicate candidates
 * are also merged pre-decision by candidates.ts's mergeDuplicateCandidates),
 * unsupported-outcome detection needs the finalized outcome claim
 * (CAP_INTEL_UNSUPPORTED_OUTCOME in validation.ts, since outcomes.ts runs
 * after the inclusion decision), and "user meaningful" cannot be formalized
 * generically without either an LLM judgment call (forbidden by this
 * package's no-external-model constraint) or repository-specific
 * hardcoding (forbidden by its no-hardcoded-capability-list constraint).
 * Adding inclusion-policy branches for any of these would have been
 * redundant with, or strictly worse than, the existing check.
 */
export type CapabilityExclusionReasonCode =
  | "INSUFFICIENT_IMPLEMENTATION_EVIDENCE"
  | "NO_EXECUTION_PATH"
  | "DOCUMENTATION_ONLY"
  | "TEST_ONLY"
  | "EXAMPLE_ONLY"
  | "PLACEHOLDER_IMPLEMENTATION"
  | "SCAFFOLD_ONLY"
  | "PLANNED_NOT_IMPLEMENTED"
  | "DISABLED_CAPABILITY"
  | "DEPRECATED_CAPABILITY"
  | "ABANDONED_CAPABILITY"
  | "UNRESOLVED_CONTRADICTORY_EVIDENCE"
  | "EXTERNAL_RUNTIME_REQUIRED";

/**
 * Keywords used only *together with* structural evidence (never a lone
 * string match) as one signal among several that a candidate may be
 * incomplete/speculative. See maturity.ts classifyIncompleteSignals().
 */
export const INCOMPLETE_CAPABILITY_SIGNAL_KEYWORDS = [
  "todo",
  "fixme",
  "planned",
  "future",
  "placeholder",
  "stub",
  "scaffold",
  "not implemented",
  "not yet supported",
  "coming soon",
  "experimental only",
  "example only",
  "deprecated",
  "archived",
  "disabled",
  "mock",
  "prototype",
  "draft",
] as const;

/**
 * The subset of INCOMPLETE_CAPABILITY_SIGNAL_KEYWORDS that specifically
 * indicate a stubbed/fake implementation rather than a genuine one (as
 * opposed to e.g. "todo"/"planned", which speak to timing, or
 * "deprecated"/"disabled", which speak to a capability being turned off).
 * Shared between inclusion-policy.ts (to assign PLACEHOLDER_IMPLEMENTATION)
 * and validation.ts (to catch one that was promoted anyway, via
 * CAP_INTEL_PLACEHOLDER_PROMOTED).
 */
export const PLACEHOLDER_STYLE_SIGNAL_KEYWORDS: readonly string[] = ["placeholder", "stub", "mock", "prototype", "draft"];

// ---------------------------------------------------------------------------
// Evidence strength model (§4 — a guide, not the sole determinant; the
// literal strength on each CapabilityEvidence instance is what maturity.ts
// and readiness.ts actually consume, since strength for a given type varies
// by context, e.g. a unit test vs. an end-to-end test).
// ---------------------------------------------------------------------------

export const CAPABILITY_EVIDENCE_STRENGTH: Record<CapabilityEvidenceType, number> = {
  workflow: 5,
  runtime_entrypoint: 5,
  deployment: 5,
  release: 5,
  implementation: 4,
  configuration: 4,
  test: 4,
  schema: 4,
  usage: 3,
  documentation: 1,
  example: 1,
  todo_marker: 0,
  deprecated_marker: -3,
};

// ---------------------------------------------------------------------------
// Evidence, readiness, capability
// ---------------------------------------------------------------------------

export interface CapabilityEvidence {
  id: string;
  type: CapabilityEvidenceType;
  sourcePath: string;
  symbol?: string;
  description: string;
  strength: number;
  confidence: CapabilityConfidence;
}

export interface CapabilityReadiness {
  score: number;
  implementationScore: number;
  executionScore: number;
  verificationScore: number;
  documentationScore: number;
  adoptionScore: number;
  blockers: string[];
  qualifiers: string[];
}

export interface Capability {
  id: string;
  displayName: string;
  shortDescription: string;
  purpose: string;
  outcome?: string;
  domainId: string;
  status: CapabilityStatus;
  confidence: CapabilityConfidence;
  inclusion: CapabilityInclusion;
  readiness: CapabilityReadiness;
  actors: string[];
  workflows: string[];
  logicalComponents: string[];
  externalSystems: string[];
  evidence: CapabilityEvidence[];
  exclusions?: string[];
  /**
   * Carried through unchanged from CapabilityCandidate.matchedIncompleteSignals
   * so validation.ts can catch a candidate that was promoted to include/
   * include_with_qualification despite still carrying placeholder-style
   * evidence descriptions (CAP_INTEL_PLACEHOLDER_PROMOTED) — a check that is
   * only possible post-decision if this traceability survives onto the
   * final Capability.
   */
  matchedIncompleteSignals: string[];
  /** Traceability back to raw discovery, per §11 naming-rule requirement to retain original source labels + naming basis. */
  naming: { sourceLabel: string; basis: string };
  granularity: CapabilityGranularity;
  /** Set only when inclusion is "roadmap_only"; the repository's own stated timeline/intent, never invented. */
  roadmapStatement?: InferredStatement;
  /** Set only when inclusion is "gap_only"; why the absence itself is operationally meaningful. */
  gapStatement?: InferredStatement;
}

export interface CapabilityDomain {
  id: string;
  displayName: string;
  purpose: string;
  capabilities: Capability[];
  evidenceCount: number;
  operationalCapabilityCount: number;
  partialCapabilityCount: number;
}

export interface ExcludedCapabilityCandidate {
  id: string;
  displayName: string;
  domainId?: string;
  sourceLabel: string;
  granularity: CapabilityGranularity;
  status: CapabilityStatus;
  confidence: CapabilityConfidence;
  readiness: CapabilityReadiness;
  reasonCodes: CapabilityExclusionReasonCode[];
  reasonSummary: string;
  evidence: CapabilityEvidence[];
}

export interface CapabilityEvidenceSummary {
  totalCandidates: number;
  includedCount: number;
  qualifiedCount: number;
  excludedCount: number;
  roadmapCount: number;
  gapCount: number;
  unresolvedCount: number;
  evidenceTypeCounts: Partial<Record<CapabilityEvidenceType, number>>;
  confidence: ConfidenceSummary;
}

export interface CapabilityReadinessWeights {
  implementation: number;
  execution: number;
  verification: number;
  documentation: number;
  adoption: number;
}

export const DEFAULT_CAPABILITY_READINESS_WEIGHTS: CapabilityReadinessWeights = {
  implementation: 35,
  execution: 25,
  verification: 20,
  documentation: 10,
  adoption: 10,
};

export interface CapabilityReadinessThresholds {
  /** score >= this => "operational" */
  operational: number;
  /** score >= this => "implemented" */
  implemented: number;
  /** score >= this => "partial" */
  partial: number;
  /** score >= this => "experimental" */
  experimental: number;
  /** score >= this => "scaffolded"; below => "planned"/unsupported */
  scaffolded: number;
}

export const DEFAULT_CAPABILITY_READINESS_THRESHOLDS: CapabilityReadinessThresholds = {
  operational: 85,
  implemented: 70,
  partial: 45,
  experimental: 25,
  scaffolded: 10,
};

export interface CapabilityGenerationMetadata {
  generated_at: string;
  git_commit: string;
  schema_version: number;
  source_architecture_intelligence_generated_at: string;
  assist_used: boolean;
  readinessThresholds: CapabilityReadinessThresholds;
  readinessWeights: CapabilityReadinessWeights;
  candidateCount: number;
}

export interface CapabilityModel {
  schemaVersion: number;
  systemIdentity: { displayName: string; purpose?: string };
  domains: CapabilityDomain[];
  includedCapabilities: Capability[];
  qualifiedCapabilities: Capability[];
  excludedCandidates: ExcludedCapabilityCandidate[];
  roadmapCapabilities: Capability[];
  /** inclusion === "gap_only": known, operationally meaningful absences. Per §9, these must render only under "Known limitations"/"Evidence gaps"/"Architecture risks" — never as capabilities. */
  gapCapabilities: Capability[];
  /** Reserved for a future case where a Capability (not an ExcludedCapabilityCandidate) carries confidence "unresolved"; empty under the current inclusion policy since contradictory-evidence candidates are always routed to excludedCandidates instead. */
  unresolvedCapabilities: Capability[];
  evidenceSummary: CapabilityEvidenceSummary;
  generationMetadata: CapabilityGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Pipeline-internal candidate (pre-inclusion-decision) shape
// ---------------------------------------------------------------------------

/**
 * A discovered candidate before evidence aggregation/maturity/readiness/
 * inclusion decisions are applied. Candidate discovery must never equal
 * capability confirmation — every CapabilityCandidate still has to pass the
 * evidence-and-maturity gate before it can appear as a Capability.
 */
export interface CapabilityCandidate {
  id: string;
  sourceLabel: string;
  naming: NormalizedLabel;
  granularity: CapabilityGranularity;
  domainHint: string;
  purpose: InferredStatement;
  outcome?: InferredStatement;
  actors: string[];
  workflows: string[];
  logicalComponents: string[];
  externalSystems: string[];
  evidence: CapabilityEvidence[];
  matchedIncompleteSignals: string[];
  isExternalRuntimeDependent: boolean;
  /** Present only when the repository itself states this is planned/future work, distinct from a generic incomplete-signal keyword hit. */
  roadmapStatement?: InferredStatement;
  /** Present only when this candidate represents a known-absent capability whose absence is itself operationally notable (a gap), not a thing to build toward. */
  gapStatement?: InferredStatement;
  evidenceReferences: EvidenceReference[];
}

// ---------------------------------------------------------------------------
// Warnings (Tier 1 = error, Tier 2 = warning; mirrors ArchIntelWarning)
// ---------------------------------------------------------------------------

export type CapIntelWarningSeverity = "informational" | "warning" | "error";

export type CapIntelWarningCode =
  | "CAP_INTEL_DOCUMENTATION_ONLY_CAPABILITY"
  | "CAP_INTEL_NO_EXECUTION_PATH"
  | "CAP_INTEL_PLACEHOLDER_PROMOTED"
  | "CAP_INTEL_SCAFFOLD_PROMOTED"
  | "CAP_INTEL_PLANNED_CAPABILITY_PROMOTED"
  | "CAP_INTEL_DEPRECATED_CAPABILITY_PROMOTED"
  | "CAP_INTEL_PARTIAL_CAPABILITY_UNQUALIFIED"
  | "CAP_INTEL_UNSUPPORTED_OUTCOME"
  | "CAP_INTEL_RAW_PATH_AS_CAPABILITY_NAME"
  | "CAP_INTEL_CAPABILITY_TOO_GRANULAR"
  | "CAP_INTEL_DUPLICATE_CAPABILITY"
  | "CAP_INTEL_EMPTY_DOMAIN"
  | "CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS"
  | "CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN"
  | "CAP_INTEL_OVER_GRANULAR_DOMAIN"
  | "CAP_INTEL_MISSING_EVIDENCE"
  | "CAP_INTEL_CONTRADICTORY_EVIDENCE"
  | "CAP_INTEL_UNKNOWN_STATUS_IN_EXECUTIVE_OUTPUT"
  | "CAP_INTEL_EXCLUDED_CAPABILITY_COUNTED_AS_CURRENT"
  | "CAP_INTEL_ROADMAP_ITEM_COUNTED_AS_CURRENT"
  | "CAP_INTEL_NONDETERMINISTIC_ORDER";

export interface CapIntelWarning {
  code: CapIntelWarningCode;
  severity: CapIntelWarningSeverity;
  message: string;
  relatedId?: string;
  remediation?: string;
}
