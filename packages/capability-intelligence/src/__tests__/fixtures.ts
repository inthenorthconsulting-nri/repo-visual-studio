import type {
  Actor,
  ArchitectureBoundary,
  ArchitectureDependency,
  ArchitectureFlow,
  ArchitectureIntelligence,
  ArchitectureIntelligenceMetadata,
  ArchitectureOutcome,
  ArchitectureQuestion,
  ArchitectureRisk,
  CapabilityDomain as ArchCapabilityDomain,
  ExternalSystem,
  InferenceClass,
  InferredStatement,
  LogicalComponent,
  LogicalComponentKind,
  LogicalComponentOrigin,
  NormalizedLabel,
  OperatingModel,
  PurposeModel,
  Responsibility,
  SystemIdentity,
  WorkflowFamily,
} from "@rvs/architecture-intelligence";
import { normalizeLabel } from "@rvs/architecture-intelligence";
import type { MarkdownSection, ParsedMarkdownDocument, RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { parseWorkflowText } from "@rvs/workflow-graph";
import type {
  Capability,
  CapabilityCandidate,
  CapabilityDomain,
  CapabilityEvidence,
  CapabilityEvidenceType,
  CapabilityGenerationMetadata,
  CapabilityModel,
  CapabilityReadiness,
} from "../contracts.js";
import { CAPABILITY_EVIDENCE_STRENGTH, CAPABILITY_INTELLIGENCE_SCHEMA_VERSION, DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "../contracts.js";
import { capabilityEvidenceId, capabilityId, capDomainId } from "../ids.js";

// ---------------------------------------------------------------------------
// Small shared primitives
// ---------------------------------------------------------------------------

export function stmt(value: string, inference: InferenceClass = "confirmed", evidencePaths: string[] = ["README.md"]): InferredStatement {
  return { value, inference, evidence: evidencePaths.map((path) => ({ path })) };
}

export function label(sourceLabel: string): NormalizedLabel {
  return normalizeLabel(sourceLabel);
}

// ---------------------------------------------------------------------------
// RepositoryModel / markdown / Terraform — mirrors
// packages/architecture-intelligence/src/__tests__/fixtures.ts's shape
// exactly (same real types), extended with markdown-section helpers since
// capability-intelligence's documentation-candidate source reads
// model.markdown_documents directly.
// ---------------------------------------------------------------------------

export function makeMarkdownSection(overrides: Partial<MarkdownSection> = {}): MarkdownSection {
  return {
    heading: "Current limitations",
    depth: 2,
    text: "No support for multi-region deployments yet.",
    startLine: 10,
    endLine: 12,
    ...overrides,
  };
}

export function makeMarkdownDocument(overrides: Partial<ParsedMarkdownDocument> = {}): ParsedMarkdownDocument {
  return {
    path: "README.md",
    title: "sample-platform",
    leadParagraph: "sample-platform automates release governance for internal services.",
    sections: [makeMarkdownSection()],
    ...overrides,
  };
}

export function makeRepositoryModel(overrides: Partial<RepositoryModel> = {}): RepositoryModel {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 3, commitsLast90Days: 12 },
    files: { total: 4, byExtension: { ".ts": 3, ".yml": 1 }, sampledPaths: ["packages/cli/src/bin.ts", "packages/core/src/index.ts", ".github/workflows/release.yml", "infra/main.tf"] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json" },
    workspace_packages: [],
    markdown_documents: [makeMarkdownDocument()],
    ci_workflows: [{ path: ".github/workflows/release.yml" }],
    ...overrides,
  };
}

export function makeTerraformTopology(overrides: Partial<TerraformTopology> = {}): TerraformTopology {
  return {
    id: "terraform:root:infra",
    name: "infra",
    rootModulePath: "infra",
    providers: [
      {
        id: "terraform:provider:infra.aws",
        name: "aws",
        cloudProvider: "aws",
        modulePath: "infra",
        evidence: [{ path: "infra/main.tf", lines: "1-3" }],
      },
    ],
    modules: [],
    nodes: [
      {
        id: "terraform:resource:infra.aws_cloudwatch_log_group.app",
        type: "resource",
        label: "aws_cloudwatch_log_group.app",
        evidence: [{ path: "infra/main.tf", lines: "5-8" }],
        metadata: { resourceCategory: "observability" },
      },
    ],
    edges: [],
    variables: [],
    outputs: [],
    warnings: [],
    evidence: [{ path: "infra/main.tf" }],
    metadata: { moduleCount: 1, resourceCount: 1, dataSourceCount: 0, providerCount: 1, variableCount: 0, outputCount: 0, hasDynamicExpressions: false, hasExternalModules: false },
    ...overrides,
  };
}

/** Real, parsed GitHub Actions workflow graph — same helper pattern as architecture-intelligence's workflow-family tests, so ids (workflow:<Sanitized-Name>) are genuine and deterministic. */
export function makeWorkflowGraph(name: string, sourcePath: string, yaml?: string): WorkflowGraph {
  const text = yaml ?? `name: ${name}\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  return parseWorkflowText(text, sourcePath).graph;
}

// ---------------------------------------------------------------------------
// ArchitectureIntelligence — hand-built (not run through
// synthesizeArchitectureIntelligence) so every test controls exactly which
// evidence a workflow family / component / capability domain carries,
// independent of that package's own heuristics.
// ---------------------------------------------------------------------------

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

export function makeArchCapabilityDomain(overrides: Partial<ArchCapabilityDomain> & { sourceLabel?: string } = {}): ArchCapabilityDomain {
  const { sourceLabel = "Widget Operations", ...rest } = overrides;
  return {
    id: `arch:domain:${sourceLabel}`,
    label: normalizeLabel(sourceLabel),
    summary: stmt(`Everything involved in synchronizing and operating widgets.`),
    responsibilityIds: [],
    componentIds: [],
    workflowFamilyIds: [],
    ...rest,
  };
}

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
    oneLineDescription: stmt("Widget Platform automates widget synchronization and reporting for internal teams."),
    repositoryKind: "monorepo",
    evidence: [{ path: "README.md" }],
  };
  const purpose: PurposeModel = {
    problemStatement: stmt("Widget Platform automates widget synchronization and reporting for internal teams."),
    targetUsers: [],
    scopeBoundaries: [],
  };
  const responsibilities: Responsibility[] = [];
  const capabilityDomains: ArchCapabilityDomain[] = [];
  const components: LogicalComponent[] = [];
  const actors: Actor[] = [];
  const externalSystems: ExternalSystem[] = [];
  const flows: ArchitectureFlow[] = [];
  const boundaries: ArchitectureBoundary[] = [];
  const outcomes: ArchitectureOutcome[] = [];
  const risks: ArchitectureRisk[] = [];
  const dependencies: ArchitectureDependency[] = [];
  const questions: ArchitectureQuestion[] = [];
  const workflowFamilies: WorkflowFamily[] = [];

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
    responsibilities,
    capabilityDomains,
    components,
    actors,
    externalSystems,
    flows,
    boundaries,
    operatingModel: DEFAULT_OPERATING_MODEL,
    outcomes,
    risks,
    dependencies,
    questions,
    workflowFamilies,
    metadata,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Capability-intelligence pipeline shapes — for unit tests on
// evidence.ts/maturity.ts/readiness.ts/inclusion-policy.ts/grouping.ts/
// outcomes.ts/validation.ts/exporter.ts that construct a stage's input
// directly rather than driving it through discoverCapabilityCandidates().
// ---------------------------------------------------------------------------

export function makeCapabilityEvidence(type: CapabilityEvidenceType, overrides: Partial<CapabilityEvidence> = {}): CapabilityEvidence {
  const sourceLabel = overrides.sourcePath ?? "widget-sync";
  return {
    id: capabilityEvidenceId("widget-sync", sourceLabel, 0),
    type,
    sourcePath: `packages/widget-sync/src/${type}.ts`,
    description: `${type} evidence for widget sync.`,
    strength: CAPABILITY_EVIDENCE_STRENGTH[type],
    confidence: "confirmed",
    ...overrides,
  };
}

export function makeCapabilityCandidate(overrides: Partial<CapabilityCandidate> & { sourceLabel?: string } = {}): CapabilityCandidate {
  const sourceLabel = overrides.sourceLabel ?? overrides.naming?.sourceLabel ?? "Widget Sync Service";
  return {
    id: capabilityId(sourceLabel),
    sourceLabel,
    naming: normalizeLabel(sourceLabel),
    granularity: "capability",
    domainHint: "General automation",
    purpose: stmt(`Synchronizes widgets across environments.`),
    actors: [],
    workflows: [],
    logicalComponents: [],
    externalSystems: [],
    evidence: [],
    matchedIncompleteSignals: [],
    isExternalRuntimeDependent: false,
    evidenceReferences: [{ path: "README.md" }],
    ...overrides,
  };
}

export function makeReadiness(overrides: Partial<CapabilityReadiness> = {}): CapabilityReadiness {
  return {
    score: 80,
    implementationScore: 80,
    executionScore: 80,
    verificationScore: 80,
    documentationScore: 80,
    adoptionScore: 80,
    blockers: [],
    qualifiers: [],
    ...overrides,
  };
}

export function makeCapability(overrides: Partial<Capability> & { sourceLabel?: string } = {}): Capability {
  const sourceLabel = overrides.sourceLabel ?? "Widget Sync Service";
  return {
    id: capabilityId(sourceLabel),
    displayName: normalizeLabel(sourceLabel).displayLabel,
    shortDescription: normalizeLabel(sourceLabel).shortLabel,
    purpose: "Synchronizes widgets across environments.",
    domainId: capDomainId("Widget Operations"),
    status: "implemented",
    confidence: "confirmed",
    inclusion: "include",
    readiness: makeReadiness(),
    actors: [],
    workflows: [`workflow:${sourceLabel.replace(/\s+/g, "-")}`],
    logicalComponents: [],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("workflow", { strength: CAPABILITY_EVIDENCE_STRENGTH.workflow })],
    matchedIncompleteSignals: [],
    naming: { sourceLabel, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

/** A structurally clean, self-consistent CapabilityModel — the baseline validateCapabilityModelStructure() should accept with zero warnings; individual validation tests mutate a narrow slice of this to trip exactly one check. */
export function makeCleanCapabilityModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  const domainId = capDomainId("Widget Operations");
  const included = makeCapability({ sourceLabel: "Widget Sync Service", domainId, status: "implemented", inclusion: "include", readiness: makeReadiness({ executionScore: 80, verificationScore: 0 }) });
  const qualified = makeCapability({
    sourceLabel: "Widget Report Export",
    domainId,
    status: "partial",
    inclusion: "include_with_qualification",
    readiness: makeReadiness({ score: 55, implementationScore: 70, executionScore: 40, verificationScore: 0 }),
  });

  const domain: CapabilityDomain = {
    id: domainId,
    displayName: "Widget Operations",
    purpose: "Everything involved in synchronizing and operating widgets.",
    // grouping.ts's buildCapabilityDomains sorts a domain's capabilities by
    // id ascending; "Widget-Report-Export" < "Widget-Sync-Service", so
    // `qualified` must come first here for this fixture to itself honor the
    // determinism invariant validateCapabilityModelStructure() checks for.
    capabilities: [qualified, included],
    evidenceCount: included.evidence.length + qualified.evidence.length,
    operationalCapabilityCount: 1,
    partialCapabilityCount: 1,
  };

  const generationMetadata: CapabilityGenerationMetadata = {
    generated_at: "2026-07-01T00:00:00.000Z",
    git_commit: "abc1234",
    schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    source_architecture_intelligence_generated_at: "2026-07-01T00:00:00.000Z",
    assist_used: false,
    readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
    readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
    candidateCount: 2,
  };

  return {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity: { displayName: "Widget Platform", purpose: "Automates widget synchronization and reporting." },
    domains: [domain],
    includedCapabilities: [included],
    qualifiedCapabilities: [qualified],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: 2,
      includedCount: 1,
      qualifiedCount: 1,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 2, workflow: 2 },
      confidence: { confirmed: 2, derived: 0, suggested: 0, unresolved: 0, total: 2 },
    },
    generationMetadata,
    ...overrides,
  };
}
