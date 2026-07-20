import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";
import { diffCapability } from "../capability-diff.js";
import { diffProduct } from "../product-diff.js";
import { diffPortfolio } from "../portfolio-diff.js";
import { assessBlastRadius } from "../blast-radius.js";
import { evaluatePolicy } from "../policy-evaluator.js";
import { buildPolicyId, buildRuleId } from "../ids.js";
import type { GovernancePolicy, GovernanceRule } from "../contracts.js";

// ---------------------------------------------------------------------------
// No-change/identity tests: two structurally identical snapshots (differing
// ONLY in generated_at, the one field this whole package deliberately
// excludes from content comparisons -- see contracts.ts's top-of-file note)
// must diff to all-"unchanged", and evaluating a representative policy
// against that no-op diff must never produce a blocking/review_required
// finding.
// ---------------------------------------------------------------------------

const SOURCE_GENERATED_AT = "2026-07-01T00:00:00.000Z";
const TARGET_GENERATED_AT = "2026-07-08T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [`${id}:main`] },
  };
}

function makeArchitecture(generatedAt: string) {
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: [component("component:api")],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: [{ id: "dependency:postgres", label: label("Postgres"), kind: "runtime", description: { value: "Primary datastore.", inference: "confirmed", evidence: [] }, evidence: [{ path: "infra/postgres.tf" }] }],
    questions: [],
    workflowFamilies: [],
    metadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: generatedAt, workflow_graph_count: 0, terraform_topology_count: 0, assist_used: false },
  };
}

function capability(id: string) {
  return {
    id,
    displayName: id,
    shortDescription: `${id} short description`,
    purpose: `${id} purpose`,
    domainId: "domain:core",
    status: "operational",
    confidence: "confirmed",
    inclusion: "include",
    readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
    actors: [],
    workflows: [],
    logicalComponents: ["component:api"],
    externalSystems: [],
    evidence: [{ id: `${id}:ev1`, type: "implementation", sourcePath: `src/${id}.ts`, description: "impl", strength: "strong", confidence: "confirmed" }],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: id, basis: "title-case" },
    granularity: "capability",
  };
}

function makeCapabilityModel(generatedAt: string) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [capability("capintel:capability:sync")],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: generatedAt, assist_used: false, candidateCount: 1 },
  };
}

function evidenceItem(id: string) {
  return { id, sourceType: "repository_evidence", sourcePath: `src/${id}.ts`, text: `Evidence for ${id}`, confidence: "confirmed", strength: 3 };
}

function makeProductModel(generatedAt: string) {
  return {
    schemaVersion: 1,
    identity: {
      displayName: "Acme Widget",
      archetype: "workflow-automation-platform",
      purpose: "Keeps widget inventories synchronized across warehouses.",
      descriptor: "A widget synchronization platform.",
      shortPromise: "Never lose track of a widget again.",
      primaryUsers: [],
      secondaryUsers: [],
      secondaryArchetypes: [],
      valuePillars: [{ id: "pillar:reliability", title: "Reliability", evidenceIds: ["ev1"] }],
      differentiators: [],
      evidence: [evidenceItem("ev1")],
    },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: generatedAt, assist_used: false, overrideApplied: false, candidateCount: 0 },
  };
}

function maturityDimension(score: number, dimLabel: string) {
  return { score, numerator: score, denominator: 100, label: dimLabel };
}

function makePortfolioModel(generatedAt: string) {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Portfolio",
    products: [{ id: "product:widget", displayName: "Widget", descriptor: "d1" }],
    domains: [],
    capabilities: [],
    relationships: [],
    unresolvedRelationships: [],
    dependencyGraph: { nodes: [], edges: [] },
    overlaps: [],
    gaps: [],
    operatingModel: {},
    maturity: {
      coverage: maturityDimension(80, "Coverage"),
      operational: maturityDimension(70, "Operational"),
      verification: maturityDimension(60, "Verification"),
      integration: maturityDimension(50, "Integration"),
      ownership: maturityDimension(90, "Ownership"),
      runtimeEvidence: maturityDimension(40, "Runtime Evidence"),
      coherence: maturityDimension(85, "Coherence"),
    },
    evidence: [],
    evidenceSummary: {},
    excludedProducts: [],
    generationMetadata: { generated_at: generatedAt, schema_version: 1, productCount: 1, incompatibleProductCount: 0, allowPartialPortfolio: false },
  };
}

function rule(kind: GovernanceRule["kind"], condition: GovernanceRule["condition"], overrides: Partial<GovernanceRule> = {}): GovernanceRule {
  const policyId = buildPolicyId("no-change-test-policy");
  return {
    id: buildRuleId(policyId, overrides.id ?? kind),
    title: overrides.title ?? kind,
    description: overrides.description ?? `Rule for ${kind}`,
    kind,
    condition,
    severity: overrides.severity ?? "blocking",
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

function policy(rules: GovernanceRule[]): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("no-change-test-policy"), name: "No-Change Test Policy", rules, exceptions: [], evidence_refs: [], generation: { generated_at: TARGET_GENERATED_AT } };
}

describe("no-change identity: structurally identical artifacts across all 4 domains, differing only in generated_at", () => {
  it("produces all-'unchanged' diffs and zero blocking/review_required findings end-to-end", () => {
    const architecture = { source: makeArchitecture(SOURCE_GENERATED_AT), target: makeArchitecture(TARGET_GENERATED_AT) };
    const capabilityModel = { source: makeCapabilityModel(SOURCE_GENERATED_AT), target: makeCapabilityModel(TARGET_GENERATED_AT) };
    const product = { source: makeProductModel(SOURCE_GENERATED_AT), target: makeProductModel(TARGET_GENERATED_AT) };
    const portfolio = { source: makePortfolioModel(SOURCE_GENERATED_AT), target: makePortfolioModel(TARGET_GENERATED_AT) };

    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: architecture.source, capability: capabilityModel.source, product: product.source, portfolio: portfolio.source, generatedAt: SOURCE_GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: architecture.target, capability: capabilityModel.target, product: product.target, portfolio: portfolio.target, generatedAt: TARGET_GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: architecture.source, targetArtifact: architecture.target });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: capabilityModel.source, targetArtifact: capabilityModel.target });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: product.source, targetArtifact: product.target });
    const portfolioChanges = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: portfolio.source, targetArtifact: portfolio.target });

    for (const changeSet of [architectureChanges, capabilityChanges, productChanges, portfolioChanges]) {
      expect(changeSet.changes.every((c) => c.type === "unchanged")).toBe(true);
      expect(changeSet.changes.every((c) => c.classification.governance_severity === "informational")).toBe(true);
      expect(changeSet.compatibility).toBe("compatible");
    }

    const blastRadius = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      portfolioChanges,
      sourceArchitectureArtifact: architecture.source,
      targetArchitectureArtifact: architecture.target,
      sourceCapabilityArtifact: capabilityModel.source,
      targetCapabilityArtifact: capabilityModel.target,
      sourcePortfolioArtifact: portfolio.source,
      targetPortfolioArtifact: portfolio.target,
    });
    // Every entry is "unchanged", and assessBlastRadius skips "unchanged"
    // entries entirely (see blast-radius.ts's assembly loop), so there is
    // nothing to widen from -- the assessment is empty, not a set of
    // falsely-computed "isolated" entries.
    expect(blastRadius.entries).toEqual([]);

    const rules = [
      rule("forbid_component_removal", { kind: "forbid_component_removal" }),
      rule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" }),
      rule("forbid_operational_to_planned_regression", { kind: "forbid_operational_to_planned_regression" }),
      rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" }),
      rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "compatible" }),
    ];
    const result = evaluatePolicy({
      policy: policy(rules),
      sourceSnapshotId: sourceSnapshot.id,
      targetSnapshotId: targetSnapshot.id,
      architectureChanges,
      capabilityChanges,
      productChanges,
      portfolioChanges,
      blastRadius,
      targetCompatibility: "compatible",
      generatedAt: TARGET_GENERATED_AT,
      now: TARGET_GENERATED_AT,
    });

    // NOTE: a finding's `severity` field is not itself a signal that
    // anything is wrong -- policy-evaluator.ts's aggregateFinding() floors
    // even "not_applicable"/"pass" findings at the rule's OWN configured
    // severity (e.g. a "blocking"-severity rule that finds nothing to flag
    // still reports a "blocking"-severity "pass"/"not_applicable" finding).
    // The real no-op signal is `result` and `human_review_required`: a
    // structurally-identical no-change diff must never produce a "fail" or
    // "unverifiable" result, and therefore must never require human review.
    expect(result.findings.every((f) => f.result === "pass" || f.result === "not_applicable")).toBe(true);
    expect(result.findings.every((f) => f.human_review_required === false)).toBe(true);
  });
});
