export const ARCHITECTURE_INTELLIGENCE_SCHEMA_VERSION = 1;

/**
 * Evidence vocabulary matches @rvs/architecture-graph and @rvs/workflow-graph
 * (intentional, documented duplication — see @rvs/architecture-graph/src/types.ts).
 * Architecture Intelligence sits above those graphs and speaks the same shape
 * so evidence can be threaded through without translation.
 */
export interface EvidenceReference {
  path: string;
  lines?: string;
}

/**
 * The four inference classes. An engine that raises the level of abstraction
 * must never lower the level of evidence: every synthesized statement carries
 * one of these, and "suggested"/"unresolved" statements must never be
 * presented as fact by default in Level 1/2 output.
 *
 * - confirmed:  directly stated or structurally explicit in evidence
 * - derived:    computed deterministically from multiple confirmed facts
 * - suggested:  a plausible interpretation that requires human review
 * - unresolved: insufficient or contradictory evidence to say anything
 */
export type InferenceClass = "confirmed" | "derived" | "suggested" | "unresolved";

export interface InferredStatement<T = string> {
  value: T;
  inference: InferenceClass;
  evidence: EvidenceReference[];
  rationale?: string;
}

/** Every named entity keeps its raw source form alongside human-facing labels. Canonical ids are never altered by normalization. */
export interface NormalizedLabel {
  sourceLabel: string;
  displayLabel: string;
  shortLabel: string;
  /** How displayLabel/shortLabel were derived (e.g. "trigger-dictionary", "environment-heuristic", "dynamic-expression", "title-case") — presentation traceability, not evidence. Omitted for plain title-cased labels with no special-cased rule applied. */
  basis?: string;
}

export interface ConfidenceSummary {
  confirmed: number;
  derived: number;
  suggested: number;
  unresolved: number;
  total: number;
}

// ---------------------------------------------------------------------------
// System identity, purpose, responsibilities
// ---------------------------------------------------------------------------

export interface SystemIdentity {
  id: string;
  name: NormalizedLabel;
  oneLineDescription: InferredStatement;
  primaryLanguage?: string;
  repositoryKind: "single-service" | "monorepo" | "library" | "unknown";
  evidence: EvidenceReference[];
}

export interface PurposeModel {
  problemStatement: InferredStatement;
  targetUsers: InferredStatement[];
  scopeBoundaries: InferredStatement[];
}

export type ResponsibilityKind =
  | "automation"
  | "governance"
  | "infrastructure"
  | "data"
  | "integration"
  | "operations"
  | "security"
  | "unknown";

export interface Responsibility {
  id: string;
  label: NormalizedLabel;
  kind: ResponsibilityKind;
  description: InferredStatement;
  supportingComponentIds: string[];
}

export interface CapabilityDomain {
  id: string;
  label: NormalizedLabel;
  summary: InferredStatement;
  responsibilityIds: string[];
  componentIds: string[];
  workflowFamilyIds: string[];
}

// ---------------------------------------------------------------------------
// Logical components, actors, external systems
// ---------------------------------------------------------------------------

export type LogicalComponentKind =
  | "cli"
  | "service"
  | "workflow-automation"
  | "infrastructure-module"
  | "data-store"
  | "library"
  | "integration"
  | "unknown";

/**
 * Where a component's grouping came from. logical-architecture/system-context
 * scenes (Level 1/2 narrative) show only "terraform-module"/"workflow-family"
 * components — components derived from real automation/infrastructure
 * evidence, not from an arbitrary top-level source directory. "repository-
 * directory" components remain fully available in the repository-map scene
 * (Level 3/4, engineering-detail views).
 */
export type LogicalComponentOrigin = "repository-directory" | "terraform-module" | "workflow-family";

export interface LogicalComponent {
  id: string;
  label: NormalizedLabel;
  kind: LogicalComponentKind;
  origin: LogicalComponentOrigin;
  description: InferredStatement;
  sourcePaths: string[];
  evidence: EvidenceReference[];
  implementation: ImplementationView;
}

/** Level 3/4 detail retained on every logical component without leaking into Level 1/2 narration. */
export interface ImplementationView {
  filePaths: string[];
  workflowGraphIds: string[];
  terraformTopologyIds: string[];
  entryPoints: string[];
}

export type ActorKind = "human-role" | "external-service" | "automation";

export interface Actor {
  id: string;
  label: NormalizedLabel;
  kind: ActorKind;
  description: InferredStatement;
  evidence: EvidenceReference[];
}

export interface ExternalSystem {
  id: string;
  label: NormalizedLabel;
  provider?: string;
  description: InferredStatement;
  evidence: EvidenceReference[];
}

// ---------------------------------------------------------------------------
// Flows, boundaries, operating model
// ---------------------------------------------------------------------------

export type ArchitectureFlowKind = "trigger" | "data" | "deployment" | "approval" | "integration";

export interface ArchitectureFlow {
  id: string;
  label: NormalizedLabel;
  kind: ArchitectureFlowKind;
  fromId: string;
  toId: string;
  description: InferredStatement;
  evidence: EvidenceReference[];
}

export type ArchitectureBoundaryKind = "trust" | "network" | "deployment-environment" | "organizational";

export interface ArchitectureBoundary {
  id: string;
  label: NormalizedLabel;
  kind: ArchitectureBoundaryKind;
  containedComponentIds: string[];
  description: InferredStatement;
  evidence: EvidenceReference[];
}

export interface OperatingModel {
  deploymentEnvironments: InferredStatement[];
  releaseProcess: InferredStatement[];
  observability: InferredStatement[];
  approvalGates: InferredStatement[];
}

// ---------------------------------------------------------------------------
// Outcomes, risks, dependencies, questions
// ---------------------------------------------------------------------------

/** Qualitative only — never a fabricated metric. A quantified outcome requires a real EvidenceReference to the number's source. */
export interface ArchitectureOutcome {
  id: string;
  statement: InferredStatement;
  quantified?: { metric: string; value: string; evidence: EvidenceReference[] };
}

export type ArchitectureRiskSeverity = "low" | "medium" | "high";

export interface ArchitectureRisk {
  id: string;
  label: NormalizedLabel;
  severity: ArchitectureRiskSeverity;
  description: InferredStatement;
  relatedComponentIds: string[];
}

export type ArchitectureDependencyKind = "runtime" | "build" | "external-service" | "infrastructure";

export interface ArchitectureDependency {
  id: string;
  label: NormalizedLabel;
  kind: ArchitectureDependencyKind;
  description: InferredStatement;
  evidence: EvidenceReference[];
}

export interface ArchitectureQuestion {
  id: string;
  question: string;
  relatedEntityIds: string[];
  reason: "suggested-claim" | "unresolved-claim" | "conflicting-evidence" | "missing-evidence";
}

// ---------------------------------------------------------------------------
// Workflow-family synthesis (groups WorkflowGraph[] into named families)
// ---------------------------------------------------------------------------

export interface WorkflowFamily {
  id: string;
  label: NormalizedLabel;
  description: InferredStatement;
  workflowGraphIds: string[];
  representativeWorkflowGraphId?: string;
}

// ---------------------------------------------------------------------------
// Metadata + top-level container
// ---------------------------------------------------------------------------

export interface ArchitectureIntelligenceMetadata {
  generated_at: string;
  git_commit: string;
  schema_version: number;
  source_repository_model_generated_at: string;
  workflow_graph_count: number;
  terraform_topology_count: number;
  assist_used: boolean;
  confidence: ConfidenceSummary;
}

export interface ArchitectureIntelligence {
  version: 1;
  identity: SystemIdentity;
  purpose: PurposeModel;
  responsibilities: Responsibility[];
  capabilityDomains: CapabilityDomain[];
  components: LogicalComponent[];
  actors: Actor[];
  externalSystems: ExternalSystem[];
  flows: ArchitectureFlow[];
  boundaries: ArchitectureBoundary[];
  operatingModel: OperatingModel;
  outcomes: ArchitectureOutcome[];
  risks: ArchitectureRisk[];
  dependencies: ArchitectureDependency[];
  questions: ArchitectureQuestion[];
  workflowFamilies: WorkflowFamily[];
  metadata: ArchitectureIntelligenceMetadata;
}

// ---------------------------------------------------------------------------
// Warnings (structural, mirrors WorkflowWarning / TerraformTopologyWarning)
// ---------------------------------------------------------------------------

export type ArchIntelWarningSeverity = "informational" | "warning" | "error";

export type ArchIntelWarningCode =
  | "ARCH_INTEL_NO_PURPOSE_EVIDENCE"
  | "ARCH_INTEL_NO_COMPONENTS"
  | "ARCH_INTEL_COMPONENT_MISSING_EVIDENCE"
  | "ARCH_INTEL_UNRESOLVED_CLAIM_IN_LEVEL1"
  | "ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED"
  | "ARCH_INTEL_DANGLING_FLOW"
  | "ARCH_INTEL_DUPLICATE_ID"
  | "ARCH_INTEL_EMPTY_CAPABILITY_DOMAIN"
  | "ARCH_INTEL_WORKFLOW_FAMILY_EMPTY"
  | "ARCH_INTEL_QUANTIFIED_OUTCOME_MISSING_EVIDENCE"
  | "ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED"
  | "ARCH_INTEL_LEVEL1_LEAKS_IMPLEMENTATION_DETAIL"
  | "ARCH_INTEL_STALE_INPUT"
  | "ARCH_INTEL_LOW_OVERALL_CONFIDENCE"
  | "ARCH_INTEL_GENERIC_SYSTEM_NAME"
  | "ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR"
  | "ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE";

export interface ArchIntelWarning {
  code: ArchIntelWarningCode;
  severity: ArchIntelWarningSeverity;
  message: string;
  relatedId?: string;
  remediation?: string;
}
