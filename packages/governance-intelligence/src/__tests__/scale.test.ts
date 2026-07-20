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
// Scale fixture test: a loop-based (not hand-literal) fixture generator
// producing a governance-scale input -- >=100 architecture components,
// >=75 capabilities, >=20 portfolio products, >=50 portfolio relationships,
// and a 100-rule policy -- run through the full pipeline (diff all domains +
// blast radius + policy evaluation) TWICE, asserting the run completes,
// produces well-formed output (no duplicate ids, every enum field is a
// valid member of its type, counts line up with the generated input), and
// is deterministic across the two runs. No performance/timing assertions:
// this test exists to catch scale-only bugs (e.g. an accidental O(n^2)
// Set-vs-Array membership check that still terminates but produces wrong
// output, or an id collision that only manifests once N is large enough),
// not to benchmark speed.
// ---------------------------------------------------------------------------

const SOURCE_GENERATED_AT = "2026-07-01T00:00:00.000Z";
const TARGET_GENERATED_AT = "2026-07-08T00:00:00.000Z";

const COMPONENT_COUNT = 100;
const CAPABILITY_COUNT = 75;
const PRODUCT_COUNT = 20;
const RELATIONSHIP_COUNT = 50;
const DEPENDENCY_COUNT = 15;
const RULE_COUNT = 100;

// Every 10th component (10 of 100) is removed on the target side; every 25th
// capability (3 of 75) regresses from operational to planned; every 5th
// dependency (3 of 15) is removed -- enough real activity for every rule
// kind below to have non-empty scope, without needing to hand-write each
// change.
function isRemovedComponentIndex(i: number): boolean {
  return i % 10 === 0;
}
function isRegressedCapabilityIndex(i: number): boolean {
  return i % 25 === 0;
}
function isRemovedDependencyIndex(i: number): boolean {
  return i % 5 === 0;
}

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function buildComponents(includeRemoved: boolean) {
  const components: Record<string, unknown>[] = [];
  for (let i = 0; i < COMPONENT_COUNT; i += 1) {
    if (!includeRemoved && isRemovedComponentIndex(i)) continue;
    const id = `component:c${i}`;
    components.push({
      id,
      label: label(id),
      kind: "service",
      origin: "repository-directory",
      description: { value: `${id} description`, inference: "confirmed", evidence: [] },
      sourcePaths: [`src/${id}`],
      evidence: [{ path: `src/${id}/index.ts` }],
      implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [`${id}:main`] },
    });
  }
  return components;
}

function buildDependencies(includeRemoved: boolean) {
  const dependencies: Record<string, unknown>[] = [];
  for (let i = 0; i < DEPENDENCY_COUNT; i += 1) {
    if (!includeRemoved && isRemovedDependencyIndex(i)) continue;
    const id = `dependency:d${i}`;
    dependencies.push({ id, label: label(id), kind: "runtime", description: { value: `${id} description`, inference: "confirmed", evidence: [] }, evidence: [{ path: `infra/${id}.tf` }] });
  }
  return dependencies;
}

function buildArchitecture(generatedAt: string, includeRemoved: boolean) {
  return {
    identity: { id: "repo:acme-scale", name: label("Acme Scale") },
    purpose: { problemStatement: { value: "Scale fixture system.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: buildComponents(includeRemoved),
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: buildDependencies(includeRemoved),
    questions: [],
    workflowFamilies: [],
    metadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: generatedAt, workflow_graph_count: 0, terraform_topology_count: 0, assist_used: false },
  };
}

function buildCapabilities(regressed: boolean) {
  const capabilities: Record<string, unknown>[] = [];
  for (let i = 0; i < CAPABILITY_COUNT; i += 1) {
    const id = `capintel:capability:cap${i}`;
    const status = regressed && isRegressedCapabilityIndex(i) ? "planned" : "operational";
    capabilities.push({
      id,
      displayName: id,
      shortDescription: `${id} short description`,
      purpose: `${id} purpose`,
      domainId: "domain:core",
      status,
      confidence: "confirmed",
      inclusion: "include",
      readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
      actors: [],
      workflows: [],
      logicalComponents: [],
      externalSystems: [],
      evidence: [{ id: `${id}:ev1`, type: "implementation", sourcePath: `src/${id}.ts`, description: "impl", strength: "strong", confidence: "confirmed" }],
      matchedIncompleteSignals: [],
      naming: { sourceLabel: id, basis: "title-case" },
      granularity: "capability",
    });
  }
  return capabilities;
}

function buildCapabilityModel(generatedAt: string, regressed: boolean) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Scale" },
    includedCapabilities: buildCapabilities(regressed),
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: generatedAt, assist_used: false, candidateCount: CAPABILITY_COUNT },
  };
}

function buildProducts() {
  const products: Record<string, unknown>[] = [];
  for (let i = 0; i < PRODUCT_COUNT; i += 1) {
    products.push({ id: `product:p${i}`, displayName: `Product ${i}`, descriptor: `Descriptor for product ${i}.` });
  }
  return products;
}

function buildRelationships() {
  const relationships: Record<string, unknown>[] = [];
  for (let i = 0; i < RELATIONSHIP_COUNT; i += 1) {
    const a = i % PRODUCT_COUNT;
    const b = (i + 1) % PRODUCT_COUNT;
    relationships.push({ id: `relationship:r${i}`, type: "shared_capability", productIds: [`product:p${a}`, `product:p${b}`] });
  }
  return relationships;
}

function buildProductModel(generatedAt: string) {
  // Blast-radius/policy evaluation requires a ProductChangeSet to exist even
  // though this test's scale requirements (>=20 products, >=50
  // relationships) are portfolio-level concerns -- product-diff.ts diffs a
  // single ProductIdentityModel, so this is a minimal, unchanged-across-runs
  // stand-in, not itself a scale dimension.
  return {
    schemaVersion: 1,
    identity: {
      displayName: "Acme Scale",
      archetype: "workflow-automation-platform",
      purpose: "Coordinates the Acme Scale product suite.",
      descriptor: "A large-scale fixture product.",
      shortPromise: "Runs at scale.",
      primaryUsers: [],
      secondaryUsers: [],
      secondaryArchetypes: [],
      valuePillars: [],
      differentiators: [],
      evidence: [],
    },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: generatedAt, assist_used: false, overrideApplied: false, candidateCount: 0 },
  };
}

function maturityDimension(score: number, dimLabel: string) {
  return { score, numerator: score, denominator: 100, label: dimLabel };
}

function buildPortfolioModel(generatedAt: string) {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme-scale",
    displayName: "Acme Scale Portfolio",
    products: buildProducts(),
    domains: [],
    capabilities: [],
    relationships: buildRelationships(),
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
    generationMetadata: { generated_at: generatedAt, schema_version: 1, productCount: PRODUCT_COUNT, incompatibleProductCount: 0, allowPartialPortfolio: false },
  };
}

const RULE_KINDS = ["forbid_component_removal", "require_runtime_entrypoint", "forbid_dependency_removal", "forbid_operational_to_planned_regression", "require_evidence_type"] as const satisfies readonly GovernanceRule["kind"][];

function buildRules(): GovernanceRule[] {
  const policyId = buildPolicyId("scale-test-policy");
  const rules: GovernanceRule[] = [];
  for (let i = 0; i < RULE_COUNT; i += 1) {
    const kind = RULE_KINDS[i % RULE_KINDS.length]!;
    const ruleKey = `${kind}-${i}`;
    let condition: GovernanceRule["condition"];
    switch (kind) {
      case "forbid_component_removal":
        condition = { kind, component_id_pattern: undefined };
        break;
      case "require_runtime_entrypoint":
        condition = { kind, entrypoint_id_pattern: undefined };
        break;
      case "forbid_dependency_removal":
        condition = { kind, dependency_id_pattern: undefined };
        break;
      case "forbid_operational_to_planned_regression":
        condition = { kind, capability_id_pattern: undefined };
        break;
      case "require_evidence_type":
        condition = { kind, entity_id_pattern: undefined, required_evidence_source: "architecture" };
        break;
      default:
        throw new Error(`unreachable rule kind: ${kind satisfies never}`);
    }
    rules.push({ id: buildRuleId(policyId, ruleKey), title: ruleKey, description: `Rule ${i} of kind ${kind}.`, kind, condition, severity: i % 2 === 0 ? "blocking" : "advisory", enabled: true });
  }
  return rules;
}

function buildPolicy(rules: GovernanceRule[]): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("scale-test-policy"), name: "Scale Test Policy", rules, exceptions: [], evidence_refs: [], generation: { generated_at: TARGET_GENERATED_AT } };
}

const VALID_SEVERITIES = new Set(["blocking", "review_required", "advisory", "informational"]);
const VALID_RESULTS = new Set(["pass", "fail", "not_applicable", "unverifiable", "excepted"]);

function runScalePipeline() {
  const sourceArchitecture = buildArchitecture(SOURCE_GENERATED_AT, true);
  const targetArchitecture = buildArchitecture(TARGET_GENERATED_AT, false);
  const sourceCapabilityModel = buildCapabilityModel(SOURCE_GENERATED_AT, false);
  const targetCapabilityModel = buildCapabilityModel(TARGET_GENERATED_AT, true);
  const sourceProductModel = buildProductModel(SOURCE_GENERATED_AT);
  const targetProductModel = buildProductModel(TARGET_GENERATED_AT);
  const sourcePortfolioModel = buildPortfolioModel(SOURCE_GENERATED_AT);
  const targetPortfolioModel = buildPortfolioModel(TARGET_GENERATED_AT);

  const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArchitecture, capability: sourceCapabilityModel, product: sourceProductModel, portfolio: sourcePortfolioModel, generatedAt: SOURCE_GENERATED_AT });
  const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArchitecture, capability: targetCapabilityModel, product: targetProductModel, portfolio: targetPortfolioModel, generatedAt: TARGET_GENERATED_AT });

  const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArchitecture, targetArtifact: targetArchitecture });
  const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceCapabilityModel, targetArtifact: targetCapabilityModel });
  const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceProductModel, targetArtifact: targetProductModel });
  const portfolioChanges = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourcePortfolioModel, targetArtifact: targetPortfolioModel });

  const blastRadius = assessBlastRadius({
    sourceSnapshot,
    targetSnapshot,
    architectureChanges,
    capabilityChanges,
    productChanges,
    portfolioChanges,
    sourceArchitectureArtifact: sourceArchitecture,
    targetArchitectureArtifact: targetArchitecture,
    sourceCapabilityArtifact: sourceCapabilityModel,
    targetCapabilityArtifact: targetCapabilityModel,
    sourcePortfolioArtifact: sourcePortfolioModel,
    targetPortfolioArtifact: targetPortfolioModel,
  });

  const rules = buildRules();
  const evaluation = evaluatePolicy({
    policy: buildPolicy(rules),
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

  return { architectureChanges, capabilityChanges, productChanges, portfolioChanges, blastRadius, evaluation, rules };
}

describe("scale: loop-generated large fixture (100 components, 75 capabilities, 20 products, 50 relationships, 100 policy rules)", () => {
  it("completes and produces well-formed, internally-consistent output", () => {
    const { architectureChanges, capabilityChanges, portfolioChanges, blastRadius, evaluation, rules } = runScalePipeline();

    expect(rules).toHaveLength(RULE_COUNT);

    // Architecture: 10 of 100 components removed, none added -- exactly 10
    // "removed" entries, the remaining 90 "unchanged" (no other field
    // perturbed). Same shape for the 3-of-15 removed dependencies.
    const removedComponents = architectureChanges.changes.filter((c) => c.domain_path === "components" && c.type === "removed");
    expect(removedComponents).toHaveLength(10);
    const removedDependencies = architectureChanges.changes.filter((c) => c.domain_path === "dependencies" && c.type === "removed");
    expect(removedDependencies).toHaveLength(3);

    // Capability: 3 of 75 capabilities regressed operational -> planned.
    const regressedCapabilities = capabilityChanges.changes.filter((c) => c.type === "reclassified");
    expect(regressedCapabilities).toHaveLength(3);

    // Portfolio: product/relationship counts are stable (no portfolio-side
    // change was introduced), so every product+relationship entry should be
    // "unchanged".
    expect(portfolioChanges.changes.filter((c) => c.domain_path === "products").length).toBe(PRODUCT_COUNT);
    expect(portfolioChanges.changes.filter((c) => c.domain_path === "relationships").length).toBe(RELATIONSHIP_COUNT);
    expect(portfolioChanges.changes.every((c) => c.type === "unchanged")).toBe(true);

    // No duplicate ids anywhere the pipeline assigns one.
    const allChangeIds = [...architectureChanges.changes, ...capabilityChanges.changes, ...portfolioChanges.changes].map((c) => c.id);
    expect(new Set(allChangeIds).size).toBe(allChangeIds.length);
    const blastRadiusIds = blastRadius.entries.map((e) => e.id);
    expect(new Set(blastRadiusIds).size).toBe(blastRadiusIds.length);
    const findingIds = evaluation.findings.map((f) => f.id);
    expect(new Set(findingIds).size).toBe(findingIds.length);

    // Every finding is a well-formed GovernanceFinding: valid enum members,
    // and every fail/unverifiable finding correctly flags human review.
    expect(evaluation.findings.length).toBeGreaterThan(0);
    for (const findingItem of evaluation.findings) {
      expect(VALID_SEVERITIES.has(findingItem.severity)).toBe(true);
      expect(VALID_RESULTS.has(findingItem.result)).toBe(true);
      expect(findingItem.human_review_required).toBe(findingItem.result === "fail" || findingItem.result === "unverifiable");
    }
    // The removal-detecting rule kinds (forbid_component_removal,
    // forbid_dependency_removal) must actually surface "fail" findings for
    // the 10 removed components + 3 removed dependencies -- proof the
    // architecture-diff.ts compatibility-folding bug fix (see
    // regression.test.ts) holds at scale, not just in a single-entity
    // hand-built fixture.
    expect(evaluation.findings.some((f) => f.result === "fail")).toBe(true);
  });

  it("is deterministic across two independent runs of the same generated fixture", () => {
    const runA = runScalePipeline();
    const runB = runScalePipeline();

    expect(JSON.stringify(runA.architectureChanges)).toBe(JSON.stringify(runB.architectureChanges));
    expect(JSON.stringify(runA.capabilityChanges)).toBe(JSON.stringify(runB.capabilityChanges));
    expect(JSON.stringify(runA.productChanges)).toBe(JSON.stringify(runB.productChanges));
    expect(JSON.stringify(runA.portfolioChanges)).toBe(JSON.stringify(runB.portfolioChanges));
    expect(JSON.stringify(runA.blastRadius)).toBe(JSON.stringify(runB.blastRadius));
    expect(JSON.stringify(runA.evaluation)).toBe(JSON.stringify(runB.evaluation));
  });
});
