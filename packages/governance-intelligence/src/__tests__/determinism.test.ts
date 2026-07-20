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
// Determinism: mirrors packages/portfolio-intelligence/src/__tests__/
// index.test.ts's exact two-pronged pattern --
//   (1) five independent fresh runs over the SAME input must produce
//       byte-identical JSON.stringify output (a single pairwise A===B
//       comparison can miss nondeterminism that only shows up
//       probabilistically, e.g. Map/Set iteration order coinciding on two
//       runs but diverging on a third).
//   (2) shuffling the *order* of elements within input arrays must not
//       change the substantive output.
//
// (2) here goes further than adversarial.test.ts's per-domain "array-order
// independence" tests (which only compare each domain's raw `.changes`
// list): buildSnapshotId/buildChangeSetId/buildEvaluationId are themselves
// digest-derived from a canonicalized-but-array-order-PRESERVING JSON
// encoding (see snapshot.ts), so the container-level `id`/
// `source_snapshot_id`/`target_snapshot_id` fields on a changeset,
// blast-radius assessment, or evaluation legitimately differ across
// differently-ordered inputs -- that is correct, not a bug. What must stay
// order-invariant is the actual per-entity content: `buildChangeId`/
// `buildBlastRadiusEntryId`/`buildFindingId` (ids.ts) are pure functions of
// domain/changeType/entityStableId only, never of array position, so the
// `.changes`, `.entries`, and `.findings` arrays themselves must be
// byte-identical regardless of input array order.
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";
const TARGET_GENERATED_AT = "2026-07-08T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string, entryPoints: string[]) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints },
  };
}

function makeArchitecture(generatedAt: string, componentIds: string[], includeThirdComponent: boolean) {
  const components = componentIds.map((id) => component(id, [`${id}:main`]));
  if (includeThirdComponent) components.push(component("component:worker", ["component:worker:main"]));
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components,
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

function makeCapabilityModel(generatedAt: string, capabilityIds: string[]) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: capabilityIds.map(capability),
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: generatedAt, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: generatedAt, assist_used: false, candidateCount: capabilityIds.length },
  };
}

function evidenceItem(id: string) {
  return { id, sourceType: "repository_evidence", sourcePath: `src/${id}.ts`, text: `Evidence for ${id}`, confidence: "confirmed", strength: 3 };
}

function pillar(id: string) {
  return { id, title: id, evidenceIds: [`ev:${id}`] };
}

function makeProductModel(generatedAt: string, pillarIds: string[]) {
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
      valuePillars: pillarIds.map(pillar),
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

function relationship(id: string) {
  return { id, type: "shared_capability", productIds: ["product:widget", "product:gadget"] };
}

function makePortfolioModel(generatedAt: string, relationshipIds: string[]) {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Portfolio",
    products: [
      { id: "product:widget", displayName: "Widget", descriptor: "d1" },
      { id: "product:gadget", displayName: "Gadget", descriptor: "d2" },
    ],
    domains: [],
    capabilities: [],
    relationships: relationshipIds.map(relationship),
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
    generationMetadata: { generated_at: generatedAt, schema_version: 1, productCount: 2, incompatibleProductCount: 0, allowPartialPortfolio: false },
  };
}

function rule(kind: GovernanceRule["kind"], condition: GovernanceRule["condition"]): GovernanceRule {
  const policyId = buildPolicyId("determinism-test-policy");
  return { id: buildRuleId(policyId, kind), title: kind, description: `Rule for ${kind}`, kind, condition, severity: "review_required", enabled: true };
}

function policy(rules: GovernanceRule[]): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("determinism-test-policy"), name: "Determinism Test Policy", rules, exceptions: [], evidence_refs: [], generation: { generated_at: TARGET_GENERATED_AT } };
}

/** Runs the full pipeline (all 4 diff domains + blast radius + policy evaluation) for one specific component/capability/pillar/relationship id ordering and a fixed set of policy rules. `includeThirdComponent` on the target run models a real change (a component added on the target side) so the pipeline has non-trivial content to move around under reordering. */
function runFullPipeline(componentIds: string[], capabilityIds: string[], pillarIds: string[], relationshipIds: string[], includeThirdComponentOnTarget: boolean) {
  const sourceArchitecture = makeArchitecture(GENERATED_AT, componentIds, false);
  const targetArchitecture = makeArchitecture(TARGET_GENERATED_AT, componentIds, includeThirdComponentOnTarget);
  const sourceCapabilityModel = makeCapabilityModel(GENERATED_AT, capabilityIds);
  const targetCapabilityModel = makeCapabilityModel(TARGET_GENERATED_AT, capabilityIds);
  const sourceProductModel = makeProductModel(GENERATED_AT, pillarIds);
  const targetProductModel = makeProductModel(TARGET_GENERATED_AT, pillarIds);
  const sourcePortfolioModel = makePortfolioModel(GENERATED_AT, relationshipIds);
  const targetPortfolioModel = makePortfolioModel(TARGET_GENERATED_AT, relationshipIds);

  const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArchitecture, capability: sourceCapabilityModel, product: sourceProductModel, portfolio: sourcePortfolioModel, generatedAt: GENERATED_AT });
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

  const rules = [
    rule("forbid_component_removal", { kind: "forbid_component_removal" }),
    rule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" }),
    rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" }),
  ];
  const evaluation = evaluatePolicy({
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

  return { architectureChanges, capabilityChanges, productChanges, portfolioChanges, blastRadius, evaluation };
}

describe("determinism: 5 independent runs over identical input", () => {
  it("produces byte-identical diff/blast-radius/policy-evaluation output across 5 fresh runs of the same input", () => {
    const componentIds = ["component:api", "component:billing"];
    const capabilityIds = ["capintel:capability:sync", "capintel:capability:billing"];
    const pillarIds = ["pillar:reliability", "pillar:speed"];
    const relationshipIds = ["relationship:shared-sync"];

    const runs = Array.from({ length: 5 }, () => {
      const result = runFullPipeline(componentIds, capabilityIds, pillarIds, relationshipIds, true);
      return {
        architecture: JSON.stringify(result.architectureChanges),
        capability: JSON.stringify(result.capabilityChanges),
        product: JSON.stringify(result.productChanges),
        portfolio: JSON.stringify(result.portfolioChanges),
        blastRadius: JSON.stringify(result.blastRadius),
        evaluation: JSON.stringify(result.evaluation),
      };
    });

    for (const run of runs.slice(1)) {
      expect(run.architecture).toBe(runs[0]!.architecture);
      expect(run.capability).toBe(runs[0]!.capability);
      expect(run.product).toBe(runs[0]!.product);
      expect(run.portfolio).toBe(runs[0]!.portfolio);
      expect(run.blastRadius).toBe(runs[0]!.blastRadius);
      expect(run.evaluation).toBe(runs[0]!.evaluation);
    }
  });
});

describe("determinism: shuffled input array order does not change substantive output", () => {
  it("produces byte-identical changes/blast-radius-entries/findings when component/capability/pillar/relationship arrays are supplied in reversed order", () => {
    const forward = runFullPipeline(
      ["component:api", "component:billing"],
      ["capintel:capability:sync", "capintel:capability:billing"],
      ["pillar:reliability", "pillar:speed"],
      ["relationship:shared-sync"],
      true,
    );
    const reversed = runFullPipeline(
      ["component:billing", "component:api"],
      ["capintel:capability:billing", "capintel:capability:sync"],
      ["pillar:speed", "pillar:reliability"],
      ["relationship:shared-sync"],
      true,
    );

    // Per-entity content is order-invariant (buildChangeId/buildBlastRadiusEntryId/
    // buildFindingId are pure functions of domain/type/entityStableId only), so these
    // arrays -- already sorted by sortChangeEntries/assessBlastRadius/evaluatePolicy --
    // must be byte-identical even though the two runs' snapshot/changeset/evaluation
    // container-level ids legitimately differ (digest-derived from array-order-preserving
    // canonical JSON).
    expect(JSON.stringify(forward.architectureChanges.changes)).toBe(JSON.stringify(reversed.architectureChanges.changes));
    expect(JSON.stringify(forward.capabilityChanges.changes)).toBe(JSON.stringify(reversed.capabilityChanges.changes));
    expect(JSON.stringify(forward.productChanges.changes)).toBe(JSON.stringify(reversed.productChanges.changes));
    expect(JSON.stringify(forward.portfolioChanges.changes)).toBe(JSON.stringify(reversed.portfolioChanges.changes));
    expect(JSON.stringify(forward.blastRadius.entries)).toBe(JSON.stringify(reversed.blastRadius.entries));
    expect(JSON.stringify(forward.evaluation.findings)).toBe(JSON.stringify(reversed.evaluation.findings));
  });

  it("produces byte-identical findings when a policy's rules are declared in a different order", () => {
    const policyId = buildPolicyId("determinism-rule-order-policy");
    const r1 = rule("forbid_component_removal", { kind: "forbid_component_removal" });
    const r2 = rule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" });
    const r3 = rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" });

    const componentIds = ["component:api", "component:billing"];
    const capabilityIds = ["capintel:capability:sync"];
    const pillarIds = ["pillar:reliability"];
    const relationshipIds: string[] = [];

    const sourceArchitecture = makeArchitecture(GENERATED_AT, componentIds, false);
    const targetArchitecture = makeArchitecture(TARGET_GENERATED_AT, componentIds, true);
    const sourceCapabilityModel = makeCapabilityModel(GENERATED_AT, capabilityIds);
    const targetCapabilityModel = makeCapabilityModel(TARGET_GENERATED_AT, capabilityIds);
    const sourceProductModel = makeProductModel(GENERATED_AT, pillarIds);
    const targetProductModel = makeProductModel(TARGET_GENERATED_AT, pillarIds);
    const sourcePortfolioModel = makePortfolioModel(GENERATED_AT, relationshipIds);
    const targetPortfolioModel = makePortfolioModel(TARGET_GENERATED_AT, relationshipIds);

    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArchitecture, capability: sourceCapabilityModel, product: sourceProductModel, portfolio: sourcePortfolioModel, generatedAt: GENERATED_AT });
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

    const evalArgs = { sourceSnapshotId: sourceSnapshot.id, targetSnapshotId: targetSnapshot.id, architectureChanges, capabilityChanges, productChanges, portfolioChanges, blastRadius, targetCompatibility: "compatible" as const, generatedAt: TARGET_GENERATED_AT, now: TARGET_GENERATED_AT };

    const resultForward = evaluatePolicy({ policy: { schema_version: 1, id: policyId, name: "Rule Order Policy", rules: [r1, r2, r3], exceptions: [], evidence_refs: [], generation: { generated_at: TARGET_GENERATED_AT } }, ...evalArgs });
    const resultShuffled = evaluatePolicy({ policy: { schema_version: 1, id: policyId, name: "Rule Order Policy", rules: [r3, r1, r2], exceptions: [], evidence_refs: [], generation: { generated_at: TARGET_GENERATED_AT } }, ...evalArgs });

    expect(JSON.stringify(resultForward.findings)).toBe(JSON.stringify(resultShuffled.findings));
  });
});
