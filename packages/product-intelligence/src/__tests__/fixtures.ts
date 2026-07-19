import { normalizeLabel } from "@rvs/architecture-intelligence";
import type {
  Actor,
  ActorKind,
  ArchitectureIntelligence,
  ArchitectureIntelligenceMetadata,
  InferenceClass,
  InferredStatement,
  LogicalComponent,
  LogicalComponentKind,
  LogicalComponentOrigin,
  NormalizedLabel,
  OperatingModel,
  PurposeModel,
  Responsibility,
  ResponsibilityKind,
  SystemIdentity,
  WorkflowFamily,
} from "@rvs/architecture-intelligence";
import type {
  Capability,
  CapabilityDomain,
  CapabilityEvidence,
  CapabilityEvidenceType,
  CapabilityGenerationMetadata,
  CapabilityModel,
  CapabilityReadiness,
  ExcludedCapabilityCandidate,
} from "@rvs/capability-intelligence";
import { CAPABILITY_EVIDENCE_STRENGTH, CAPABILITY_INTELLIGENCE_SCHEMA_VERSION, DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "@rvs/capability-intelligence";
import type { ExecutiveNarrative, ProductClaim, ProductIdentity, ProductIdentityEvidence, ProductValuePillar } from "../contracts.js";

// ---------------------------------------------------------------------------
// Small shared primitives — mirrors packages/architecture-intelligence and
// packages/capability-intelligence's own __tests__/fixtures.ts conventions
// (same real types, hand-built rather than routed through discovery) so
// every product-intelligence test controls exactly which evidence a
// capability/component/responsibility carries.
// ---------------------------------------------------------------------------

export function stmt(value: string, inference: InferenceClass = "confirmed", evidencePaths: string[] = ["README.md"]): InferredStatement {
  return { value, inference, evidence: evidencePaths.map((path) => ({ path })) };
}

export function label(sourceLabel: string): NormalizedLabel {
  return normalizeLabel(sourceLabel);
}

// ---------------------------------------------------------------------------
// ArchitectureIntelligence
// ---------------------------------------------------------------------------

const DEFAULT_OPERATING_MODEL: OperatingModel = {
  deploymentEnvironments: [],
  releaseProcess: [],
  observability: [],
  approvalGates: [],
};

export function makeArchitectureFixture(overrides: Partial<ArchitectureIntelligence> = {}): ArchitectureIntelligence {
  const identity: SystemIdentity = {
    id: "arch:identity:widget-platform",
    name: normalizeLabel("Widget Platform"),
    oneLineDescription: stmt("Widget Platform governs and audits widget synchronization across internal environments."),
    repositoryKind: "monorepo",
    evidence: [{ path: "README.md" }],
  };
  const purpose: PurposeModel = {
    problemStatement: stmt("Teams lack a governed, auditable way to synchronize and report on widget state across environments"),
    targetUsers: [],
    scopeBoundaries: [],
  };

  const metadata: ArchitectureIntelligenceMetadata = {
    generated_at: "2026-07-01T00:00:00.000Z",
    git_commit: "abc1234",
    schema_version: 1,
    source_repository_model_generated_at: "2026-07-01T00:00:00.000Z",
    workflow_graph_count: 0,
    terraform_topology_count: 0,
    assist_used: false,
    confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
  };

  return {
    version: 1,
    identity,
    purpose,
    responsibilities: [],
    capabilityDomains: [],
    components: [],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: DEFAULT_OPERATING_MODEL,
    outcomes: [],
    risks: [],
    dependencies: [],
    questions: [],
    workflowFamilies: [],
    metadata,
    ...overrides,
  };
}

export function makeActor(sourceLabel: string, kind: ActorKind = "human-role", overrides: Partial<Actor> = {}): Actor {
  return {
    id: `arch:actor:${sourceLabel}`,
    label: normalizeLabel(sourceLabel),
    kind,
    description: stmt(`${sourceLabel} interacts with the platform.`),
    evidence: [{ path: "README.md" }],
    ...overrides,
  };
}

export function makeResponsibility(kind: ResponsibilityKind, overrides: Partial<Responsibility> = {}): Responsibility {
  return {
    id: `arch:responsibility:${kind}`,
    label: normalizeLabel(kind),
    kind,
    description: stmt(`Handles ${kind} concerns.`),
    supportingComponentIds: [],
    ...overrides,
  };
}

export function makeLogicalComponent(
  overrides: Partial<Omit<LogicalComponent, "kind" | "origin">> & { sourceLabel?: string; kind?: LogicalComponentKind; origin?: LogicalComponentOrigin } = {},
): LogicalComponent {
  const { sourceLabel = "widget-sync-service", kind = "service", origin = "repository-directory", ...rest } = overrides;
  return {
    id: `arch:component:${sourceLabel}`,
    label: normalizeLabel(sourceLabel),
    kind,
    origin,
    description: stmt(`Runs the ${sourceLabel} runtime.`),
    sourcePaths: [`packages/${sourceLabel}/src/index.ts`],
    evidence: [{ path: `packages/${sourceLabel}/src/index.ts` }],
    implementation: { filePaths: [], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] },
    ...rest,
  };
}

export function makeWorkflowFamily(overrides: Partial<WorkflowFamily> & { sourceLabel?: string } = {}): WorkflowFamily {
  const { sourceLabel = "Widget Sync", ...rest } = overrides;
  return {
    id: `arch:workflow-family:${sourceLabel}`,
    label: normalizeLabel(sourceLabel),
    description: stmt(`Synchronizes widgets across environments on a schedule and on demand.`),
    workflowGraphIds: [],
    representativeWorkflowGraphId: undefined,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// CapabilityModel
// ---------------------------------------------------------------------------

export function makeCapabilityEvidence(type: CapabilityEvidenceType, overrides: Partial<CapabilityEvidence> = {}): CapabilityEvidence {
  return {
    id: `capintel:evidence:widget-sync:${type}:0`,
    type,
    sourcePath: `packages/widget-sync/src/${type}.ts`,
    description: `${type} evidence for widget sync.`,
    strength: CAPABILITY_EVIDENCE_STRENGTH[type],
    confidence: "confirmed",
    ...overrides,
  };
}

export function makeReadiness(overrides: Partial<CapabilityReadiness> = {}): CapabilityReadiness {
  return { score: 80, implementationScore: 80, executionScore: 80, verificationScore: 80, documentationScore: 80, adoptionScore: 80, blockers: [], qualifiers: [], ...overrides };
}

export function capId(sourceLabel: string): string {
  return `capintel:capability:${sourceLabel.replace(/\s+/g, "-")}`;
}

export function domId(sourceLabel: string): string {
  return `capintel:domain:${sourceLabel.replace(/\s+/g, "-")}`;
}

export function makeCapability(overrides: Partial<Capability> & { sourceLabel?: string } = {}): Capability {
  const sourceLabel = overrides.sourceLabel ?? "Widget Sync Service";
  const nl = normalizeLabel(sourceLabel);
  return {
    id: capId(sourceLabel),
    displayName: nl.displayLabel,
    shortDescription: nl.shortLabel,
    purpose: "Synchronizes widgets across environments.",
    domainId: domId("Widget Operations"),
    status: "implemented",
    confidence: "confirmed",
    inclusion: "include",
    readiness: makeReadiness(),
    actors: [],
    workflows: [],
    logicalComponents: [],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("workflow", { strength: CAPABILITY_EVIDENCE_STRENGTH.workflow })],
    matchedIncompleteSignals: [],
    naming: { sourceLabel, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

export function makeExcludedCandidate(overrides: Partial<ExcludedCapabilityCandidate> & { sourceLabel?: string } = {}): ExcludedCapabilityCandidate {
  const sourceLabel = overrides.sourceLabel ?? "Widget Scratch Cli";
  const nl = normalizeLabel(sourceLabel);
  return {
    id: `capintel:excluded:${sourceLabel.replace(/\s+/g, "-")}`,
    displayName: nl.displayLabel,
    sourceLabel,
    granularity: "capability",
    status: "scaffolded",
    confidence: "unresolved",
    readiness: makeReadiness({ score: 10 }),
    reasonCodes: ["SCAFFOLD_ONLY"],
    reasonSummary: "Only a bare entrypoint exists; no implementation, tests, or workflow evidence.",
    evidence: [],
    ...overrides,
  };
}

export function makeCapabilityDomain(overrides: Partial<CapabilityDomain> & { sourceLabel?: string } = {}): CapabilityDomain {
  const sourceLabel = overrides.sourceLabel ?? "Widget Operations";
  return {
    id: domId(sourceLabel),
    displayName: sourceLabel,
    purpose: `Everything involved in ${sourceLabel.toLowerCase()}.`,
    capabilities: [],
    evidenceCount: 0,
    operationalCapabilityCount: 0,
    partialCapabilityCount: 0,
    ...overrides,
  };
}

/** A structurally minimal, otherwise-empty CapabilityModel — the baseline most unit tests mutate a narrow slice of. */
export function makeEmptyCapabilityModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  const generationMetadata: CapabilityGenerationMetadata = {
    generated_at: "2026-07-01T00:00:00.000Z",
    git_commit: "abc1234",
    schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    source_architecture_intelligence_generated_at: "2026-07-01T00:00:00.000Z",
    assist_used: false,
    readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
    readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
    candidateCount: 0,
  };
  return {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity: { displayName: "Widget Platform", purpose: "Automates widget synchronization and reporting." },
    domains: [],
    includedCapabilities: [],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: 0,
      includedCount: 0,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: {},
      confidence: { confirmed: 0, derived: 0, suggested: 0, unresolved: 0, total: 0 },
    },
    generationMetadata,
    ...overrides,
  };
}

/**
 * A rich, self-consistent "clean" scenario used by end-to-end pipeline tests
 * (index.test.ts, showcase-plan.test.ts, validation.test.ts): three capability
 * domains (governance, widget operations, and a qualified-only reporting
 * domain), a shared logical component spanning three included capabilities
 * across two domains (differentiator criteria 1+2), one capability with
 * test+deployment evidence at operational status (differentiator criteria
 * 3+4), plus a roadmap capability, an excluded candidate, and a gap capability
 * so claim-control tests have real roadmap/excluded material to probe.
 */
export function makeGovernancePlatformFixture(): { architecture: ArchitectureIntelligence; capabilityModel: CapabilityModel } {
  const sharedComponent = makeLogicalComponent({ sourceLabel: "shared-platform-core", kind: "service", origin: "workflow-family" });
  const cliComponent = makeLogicalComponent({ sourceLabel: "widget-cli", kind: "cli", origin: "repository-directory" });

  const govCap1 = makeCapability({
    sourceLabel: "Policy Governance Console",
    domainId: domId("Governance And Compliance"),
    purpose: "Enforces governance policy and compliance audit controls for release approvals.",
    status: "operational",
    inclusion: "include",
    readiness: makeReadiness({ score: 92 }),
    logicalComponents: [sharedComponent.id],
    evidence: [makeCapabilityEvidence("test"), makeCapabilityEvidence("deployment")],
  });
  const govCap2 = makeCapability({
    sourceLabel: "Access Approval Workflow",
    domainId: domId("Governance And Compliance"),
    purpose: "Manages governance approval and permission guardrails across teams.",
    status: "implemented",
    inclusion: "include",
    logicalComponents: [sharedComponent.id],
  });
  const syncCap = makeCapability({
    sourceLabel: "Widget Sync Service",
    domainId: domId("Widget Operations"),
    purpose: "Synchronizes widgets across environments on a recurring schedule.",
    status: "implemented",
    inclusion: "include",
    logicalComponents: [sharedComponent.id],
  });
  const reportCap = makeCapability({
    sourceLabel: "Widget Report Export",
    domainId: domId("Widget Operations"),
    purpose: "Exports widget state reports for downstream review.",
    status: "partial",
    inclusion: "include_with_qualification",
    readiness: makeReadiness({ score: 55 }),
  });
  const legacyReportCap = makeCapability({
    sourceLabel: "Legacy Report Viewer",
    domainId: domId("Legacy Reporting"),
    purpose: "Displays legacy widget reports for historical review.",
    status: "partial",
    inclusion: "include_with_qualification",
    readiness: makeReadiness({ score: 50 }),
  });

  const roadmapCap = makeCapability({
    sourceLabel: "Widget Auto Remediation",
    domainId: domId("Widget Operations"),
    purpose: "Automatically remediates widget drift once implemented.",
    status: "planned",
    inclusion: "roadmap_only",
    roadmapStatement: stmt("Planned for a future release; not yet implemented.", "confirmed"),
  });
  const gapCap = makeCapability({
    sourceLabel: "Widget Multi Region Support",
    domainId: domId("Widget Operations"),
    purpose: "Multi-region widget replication is not currently supported.",
    status: "unknown",
    inclusion: "gap_only",
    gapStatement: stmt("No multi-region replication capability exists yet.", "confirmed"),
  });

  const excludedCandidate = makeExcludedCandidate({ sourceLabel: "Widget Scratch Cli" });

  const governanceDomain = makeCapabilityDomain({ sourceLabel: "Governance And Compliance", capabilities: [govCap1, govCap2].sort((a, b) => a.id.localeCompare(b.id)) });
  const operationsDomain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [syncCap, reportCap].sort((a, b) => a.id.localeCompare(b.id)) });
  const legacyDomain = makeCapabilityDomain({ sourceLabel: "Legacy Reporting", capabilities: [legacyReportCap] });

  const includedCapabilities = [govCap1, govCap2, syncCap];
  const qualifiedCapabilities = [reportCap, legacyReportCap];

  const capabilityModel: CapabilityModel = {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity: { displayName: "Widget Platform", purpose: "Automates governed widget synchronization and reporting." },
    domains: [governanceDomain, operationsDomain, legacyDomain],
    includedCapabilities,
    qualifiedCapabilities,
    excludedCandidates: [excludedCandidate],
    roadmapCapabilities: [roadmapCap],
    gapCapabilities: [gapCap],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: includedCapabilities.length + qualifiedCapabilities.length + 1 + 1 + 1,
      includedCount: includedCapabilities.length,
      qualifiedCount: qualifiedCapabilities.length,
      excludedCount: 1,
      roadmapCount: 1,
      gapCount: 1,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 5, workflow: 3, test: 1, deployment: 1 },
      confidence: { confirmed: 8, derived: 0, suggested: 0, unresolved: 0, total: 8 },
    },
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
      source_architecture_intelligence_generated_at: "2026-07-01T00:00:00.000Z",
      assist_used: false,
      readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
      readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
      candidateCount: includedCapabilities.length + qualifiedCapabilities.length + 1 + 1 + 1,
    },
  };

  const architecture = makeArchitectureFixture({
    responsibilities: [makeResponsibility("governance")],
    components: [sharedComponent, cliComponent],
    actors: [makeActor("Compliance Officer"), makeActor("Platform Operator"), makeActor("External Auditing Service", "external-service")],
    workflowFamilies: [makeWorkflowFamily({ sourceLabel: "Widget Sync" })],
  });

  return { architecture, capabilityModel };
}

// ---------------------------------------------------------------------------
// product-intelligence-native fixtures — for narrative.ts/showcase-plan.ts/
// validation.ts/exporter.ts unit tests that construct a stage's input
// directly rather than driving it through synthesizeProductIdentity().
// ---------------------------------------------------------------------------

export function makeProductIdentityEvidence(overrides: Partial<ProductIdentityEvidence> = {}): ProductIdentityEvidence {
  return {
    id: "prodintel:evidence:capability:capintel-capability-widget-sync-service:0",
    sourceType: "capability",
    sourceId: capId("Widget Sync Service"),
    text: "Synchronizes widgets across environments.",
    confidence: "confirmed",
    strength: 4,
    ...overrides,
  };
}

export function makeValuePillar(overrides: Partial<ProductValuePillar> = {}): ProductValuePillar {
  return {
    id: "prodintel:pillar:widget-operations",
    title: "Widget Operations",
    explanation: "Synchronizes and reports on widget state across environments.",
    includedCapabilityIds: [capId("Widget Sync Service")],
    qualifiedCapabilityIds: [],
    evidenceIds: ["prodintel:evidence:capability:capintel-capability-widget-sync-service:0"],
    confidence: "confirmed",
    ...overrides,
  };
}

export function makeProductIdentity(overrides: Partial<ProductIdentity> = {}): ProductIdentity {
  return {
    displayName: "Widget Platform",
    descriptor: "Governance and compliance platform",
    shortPromise: "Widget Platform governs and reports on widget operations for compliance teams",
    archetype: "governance_platform",
    secondaryArchetypes: [],
    purpose: "Teams lack a governed way to operate widgets by providing governance oversight for compliance officers.",
    primaryUsers: ["Compliance Officer"],
    secondaryUsers: [],
    valuePillars: [makeValuePillar()],
    differentiators: [],
    currentCapabilities: [capId("Widget Sync Service")],
    qualifiedCapabilities: [],
    limitations: [],
    evidence: [makeProductIdentityEvidence()],
    confidence: "confirmed",
    overrideApplied: false,
    ...overrides,
  };
}

export function makeProductClaim(overrides: Partial<ProductClaim> = {}): ProductClaim {
  return {
    id: "prodintel:claim:identity:identity",
    text: "Widget Platform is a Governance and compliance platform.",
    claimType: "identity",
    status: "approved",
    evidenceIds: ["prodintel:evidence:capability:capintel-capability-widget-sync-service:0"],
    qualifiers: [],
    rejectionReasons: [],
    ...overrides,
  };
}

export function makeExecutiveNarrative(overrides: Partial<ExecutiveNarrative> = {}): ExecutiveNarrative {
  return {
    audience: "executive",
    objective: "Give executive stakeholders a concise, evidence-backed view of Widget Platform.",
    centralMessage: "Widget Platform governs and reports on widget operations for compliance teams",
    problemStatement: "Teams lack a governed way to operate widgets",
    productPromise: "Widget Platform governs and reports on widget operations for compliance teams",
    valuePillars: [makeValuePillar()],
    proofPoints: [],
    differentiators: [],
    limitations: [],
    closingMessage: "Widget Platform is presented here strictly by what is currently proven.",
    approvedClaims: [makeProductClaim()],
    rejectedClaims: [],
    runtimeVerificationClaims: [],
    ...overrides,
  };
}
