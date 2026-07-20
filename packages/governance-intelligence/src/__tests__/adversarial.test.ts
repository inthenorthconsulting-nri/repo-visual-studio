import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";
import { diffCapability } from "../capability-diff.js";
import { diffProduct } from "../product-diff.js";
import { diffPortfolio } from "../portfolio-diff.js";
import { evaluatePolicy } from "../policy-evaluator.js";
import { buildPolicyId, buildRuleId } from "../ids.js";
import type {
  ArchitectureChangeSet,
  GovernanceChangeClassification,
  GovernanceChangeEntry,
  GovernanceCompatibilityStatus,
  GovernanceException,
  GovernancePolicy,
  GovernanceRule,
  GovernanceRuleCondition,
} from "../contracts.js";

// ---------------------------------------------------------------------------
// Adversarial tests: semantically-equivalent inputs (different array order,
// different object-key order, different rule-declaration order, an
// ambiguous rename candidate set, a path-only move) must produce IDENTICAL
// governance output. Each test below targets one specific place in this
// package where a naive implementation COULD leak input-ordering or
// guess-based behavior into the result, and pins down that it doesn't.
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] },
    ...overrides,
  };
}

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: [component("component:a"), component("component:b")],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: [],
    questions: [],
    workflowFamilies: [],
    metadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: GENERATED_AT, workflow_graph_count: 0, terraform_topology_count: 0, assist_used: false },
    ...overrides,
  };
}

function snapshotFor(architecture: unknown, generatedAt = GENERATED_AT) {
  return buildIntelligenceSnapshot({ architecture, generatedAt });
}

function capability(id: string, overrides: Record<string, unknown> = {}) {
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
    logicalComponents: ["component:sync-service"],
    externalSystems: [],
    evidence: [{ id: `${id}:ev1`, type: "implementation", sourcePath: `src/${id}.ts`, description: "impl", strength: "strong", confidence: "confirmed" }],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: id, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

function makeCapabilityModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: GENERATED_AT, assist_used: false, candidateCount: 0 },
    ...overrides,
  };
}

function capabilitySnapshotFor(capabilityModel: unknown) {
  return buildIntelligenceSnapshot({ capability: capabilityModel, generatedAt: GENERATED_AT });
}

function evidenceItem(id: string, overrides: Record<string, unknown> = {}) {
  return { id, sourceType: "repository_evidence", sourcePath: `src/${id}.ts`, text: `Evidence for ${id}`, confidence: "confirmed", strength: 3, ...overrides };
}

function makeProductModel(overrides: Record<string, unknown> = {}) {
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
      valuePillars: [
        { id: "pillar:reliability", title: "Reliability", evidenceIds: ["ev1"] },
        { id: "pillar:speed", title: "Speed", evidenceIds: ["ev2"] },
      ],
      differentiators: [],
      evidence: [evidenceItem("ev1"), evidenceItem("ev2")],
    },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 0 },
    ...overrides,
  };
}

function productSnapshotFor(product: unknown) {
  return buildIntelligenceSnapshot({ product, generatedAt: GENERATED_AT });
}

function maturityDimension(score: number, dimLabel: string) {
  return { score, numerator: score, denominator: 100, label: dimLabel };
}

function relationship(id: string, overrides: Record<string, unknown> = {}) {
  return { id, productAId: "product:widget", productBId: "product:gadget", type: "shared_contract", confidence: "confirmed", statement: `${id} statement`, capabilityIds: [], evidenceIds: ["ev1"], ...overrides };
}

function makePortfolioModel(overrides: Record<string, unknown> = {}) {
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
    generationMetadata: { generated_at: GENERATED_AT, schema_version: 1, productCount: 2, incompatibleProductCount: 0, allowPartialPortfolio: false },
    ...overrides,
  };
}

function portfolioSnapshotFor(portfolio: unknown, product: unknown) {
  return buildIntelligenceSnapshot({ product, portfolio, generatedAt: GENERATED_AT });
}

// ---------------------------------------------------------------------------
// Policy-evaluator local fixture helpers, mirroring policy-evaluator.test.ts's
// own local pattern exactly (these helpers are not shared via
// governance-fixtures.ts -- every diff/evaluator test file defines its own).
// ---------------------------------------------------------------------------

function classification(overrides: Partial<GovernanceChangeClassification> = {}): GovernanceChangeClassification {
  return {
    domain: "architecture",
    materiality: "material",
    confidence: "confirmed",
    governance_severity: "informational",
    compatibility_impact: "compatible",
    evidence_impact: "preserved",
    runtime_impact: "none",
    consumer_impact: "isolated",
    portfolio_impact: "none",
    ...overrides,
  };
}

let entrySeq = 0;
function entry(overrides: Partial<GovernanceChangeEntry> = {}): GovernanceChangeEntry {
  entrySeq += 1;
  return {
    id: overrides.id ?? `governance:change:test:${entrySeq}`,
    domain_path: overrides.domain_path ?? "components",
    entity_id: overrides.entity_id ?? `entity-${entrySeq}`,
    entity_label: overrides.entity_label ?? `entity-${entrySeq}`,
    type: overrides.type ?? "added",
    compatibility: overrides.compatibility ?? "compatible",
    lineage: overrides.lineage ?? "preserved",
    classification: overrides.classification ?? classification(),
    detail: overrides.detail ?? "Entry changed.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

function architectureChangeSet(changes: GovernanceChangeEntry[], compatibility: GovernanceCompatibilityStatus = "compatible"): ArchitectureChangeSet {
  return { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function rule(kind: GovernanceRuleCondition["kind"], condition: GovernanceRuleCondition, overrides: Partial<GovernanceRule> = {}): GovernanceRule {
  const policyId = buildPolicyId("adversarial-test-policy");
  return {
    id: buildRuleId(policyId, overrides.id ?? kind),
    title: overrides.title ?? kind,
    description: overrides.description ?? `Rule for ${kind}`,
    kind,
    condition,
    severity: overrides.severity ?? "review_required",
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

function policy(rules: GovernanceRule[], exceptions: GovernanceException[] = []): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("adversarial-test-policy"), name: "Adversarial Test Policy", rules, exceptions, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function runEval(p: GovernancePolicy, architectureChanges: ArchitectureChangeSet) {
  return evaluatePolicy({
    policy: p,
    sourceSnapshotId: "source",
    targetSnapshotId: "target",
    architectureChanges,
    capabilityChanges: { schema_version: 1, id: "changeset:capability", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
    productChanges: { schema_version: 1, id: "changeset:product", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
    blastRadius: { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
    targetCompatibility: "compatible",
    generatedAt: GENERATED_AT,
    now: GENERATED_AT,
  });
}

describe("adversarial: array-order independence", () => {
  it("architecture: reordering the target's components array produces an identical set of change entries (component ADDITION is id-keyed, never positional)", () => {
    // Reordering an artifact's arrays changes canonicalize()'s JSON.stringify
    // output (canonicalize sorts object keys but deliberately preserves array
    // order -- see snapshot.ts), which changes the artifact digest and
    // therefore the enclosing snapshot/changeset id. That id-level difference
    // is expected and orthogonal to this test: what must stay identical is
    // the CONTENT of `.changes` (the diff engines partition by id via a Map,
    // per diff-utils.ts's partitionById, so the partitioning itself cannot
    // see array order) -- hence comparing `.changes` only, not the full
        // changeset object.
    const source = makeArchitecture();
    const targetOrderA = makeArchitecture({ components: [...source.components, component("component:c")] });
    const targetOrderB = makeArchitecture({ components: [component("component:c"), ...[...source.components].reverse()] });

    const sourceSnapshot = snapshotFor(source);
    const resultA = diffArchitecture({ sourceSnapshot, targetSnapshot: snapshotFor(targetOrderA), sourceArtifact: source, targetArtifact: targetOrderA });
    const resultB = diffArchitecture({ sourceSnapshot, targetSnapshot: snapshotFor(targetOrderB), sourceArtifact: source, targetArtifact: targetOrderB });

    expect(JSON.stringify(resultA.changes)).toBe(JSON.stringify(resultB.changes));
  });

  it("capability: reordering includedCapabilities produces an identical set of change entries", () => {
    const source = makeCapabilityModel();
    const targetOrderA = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:widget-sync"), capability("capintel:capability:notifications")] });
    const targetOrderB = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:notifications"), capability("capintel:capability:widget-sync")] });

    const sourceSnapshot = capabilitySnapshotFor(source);
    const resultA = diffCapability({ sourceSnapshot, targetSnapshot: capabilitySnapshotFor(targetOrderA), sourceArtifact: source, targetArtifact: targetOrderA });
    const resultB = diffCapability({ sourceSnapshot, targetSnapshot: capabilitySnapshotFor(targetOrderB), sourceArtifact: source, targetArtifact: targetOrderB });

    expect(JSON.stringify(resultA.changes)).toBe(JSON.stringify(resultB.changes));
  });

  it("product: reordering identity.valuePillars produces an identical set of change entries", () => {
    const source = makeProductModel({ identity: { ...makeProductModel().identity, valuePillars: [] } });
    const pillars = makeProductModel().identity.valuePillars;
    const targetOrderA = makeProductModel({ identity: { ...source.identity, valuePillars: pillars } });
    const targetOrderB = makeProductModel({ identity: { ...source.identity, valuePillars: [...pillars].reverse() } });

    const sourceSnapshot = productSnapshotFor(source);
    const resultA = diffProduct({ sourceSnapshot, targetSnapshot: productSnapshotFor(targetOrderA), sourceArtifact: source, targetArtifact: targetOrderA });
    const resultB = diffProduct({ sourceSnapshot, targetSnapshot: productSnapshotFor(targetOrderB), sourceArtifact: source, targetArtifact: targetOrderB });

    expect(JSON.stringify(resultA.changes)).toBe(JSON.stringify(resultB.changes));
  });

  it("portfolio: reordering the relationships array produces an identical set of change entries", () => {
    const source = makePortfolioModel();
    const rels = [relationship("rel:a"), relationship("rel:b")];
    const targetOrderA = makePortfolioModel({ relationships: rels });
    const targetOrderB = makePortfolioModel({ relationships: [...rels].reverse() });
    const product = makeProductModel();

    const sourceSnapshot = portfolioSnapshotFor(source, product);
    const resultA = diffPortfolio({ sourceSnapshot, targetSnapshot: portfolioSnapshotFor(targetOrderA, product), sourceArtifact: source, targetArtifact: targetOrderA });
    const resultB = diffPortfolio({ sourceSnapshot, targetSnapshot: portfolioSnapshotFor(targetOrderB, product), sourceArtifact: source, targetArtifact: targetOrderB });

    expect(JSON.stringify(resultA.changes)).toBe(JSON.stringify(resultB.changes));
  });
});

describe("adversarial: snapshot id stability under input-order changes", () => {
  it("is unaffected by the key order of an artifact's own object fields", () => {
    const architectureKeyOrderA = { identity: { id: "repo:acme-widget" }, components: [] };
    const architectureKeyOrderB = { components: [], identity: { id: "repo:acme-widget" } };

    const snapA = buildIntelligenceSnapshot({ architecture: architectureKeyOrderA, generatedAt: GENERATED_AT });
    const snapB = buildIntelligenceSnapshot({ architecture: architectureKeyOrderB, generatedAt: GENERATED_AT });

    expect(snapA.id).toBe(snapB.id);
  });

  it("is unaffected by the order artifacts are supplied in BuildIntelligenceSnapshotInput", () => {
    const architecture = makeArchitecture();
    const capabilityModel = makeCapabilityModel();

    const snapC = buildIntelligenceSnapshot({ architecture, capability: capabilityModel, generatedAt: GENERATED_AT });
    const snapD = buildIntelligenceSnapshot({ capability: capabilityModel, architecture, generatedAt: GENERATED_AT });

    expect(snapC.id).toBe(snapD.id);
  });
});

describe("adversarial: file-moved-but-stable-identity", () => {
  it("classifies a component whose sourcePaths changed (but id is stable) as a single 'modified' entry, never a removed+added pair", () => {
    const source = makeArchitecture({ components: [component("component:api", { sourcePaths: ["src/old-location/api"] })] });
    const target = makeArchitecture({ components: [component("component:api", { sourcePaths: ["src/new-location/api"] })] });

    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entriesForId = result.changes.filter((c) => c.entity_id === "component:api");
    expect(entriesForId).toHaveLength(1);
    expect(entriesForId[0].type).toBe("modified");
    expect(entriesForId[0].detail).toContain("sourcePaths");
    expect(result.changes.some((c) => c.type === "removed")).toBe(false);
    expect(result.changes.some((c) => c.type === "added")).toBe(false);
  });
});

describe("adversarial: ambiguous rename -- never inferred without a unique signal", () => {
  it("leaves a removed component as a separate removal (never a rename) when TWO added candidates share its kind and byte-identical evidence", () => {
    // detectConservativeRenames (diff-utils.ts) requires EXACTLY ONE matching
    // added candidate (same kind + byte-identical evidence) to infer a
    // rename. Two equally-good candidates is exactly the ambiguity the
    // function documents as a required fallback to separate removed+added.
    const sharedEvidence = [{ path: "src/legacy-service/index.ts" }];
    const source = makeArchitecture({ components: [component("component:legacy-service", { kind: "service", evidence: sharedEvidence })] });
    const target = makeArchitecture({
      components: [component("component:candidate-a", { kind: "service", evidence: sharedEvidence }), component("component:candidate-b", { kind: "service", evidence: sharedEvidence })],
    });

    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const renamed = result.changes.filter((c) => c.type === "renamed");
    const removed = result.changes.filter((c) => c.type === "removed");
    const added = result.changes.filter((c) => c.type === "added");
    expect(renamed).toHaveLength(0);
    expect(removed.map((c) => c.entity_id)).toEqual(["component:legacy-service"]);
    expect(added.map((c) => c.entity_id).sort()).toEqual(["component:candidate-a", "component:candidate-b"]);
  });
});

describe("adversarial: contradictory/overlapping policy rules", () => {
  it("emits independent findings for two rules of different severity that both match the same change, never silently merging them", () => {
    const strictRule = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:.*" }, { id: "strict-rule", severity: "blocking" });
    const lenientRule = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:api" }, { id: "lenient-rule", severity: "advisory" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed" })]);

    const result = runEval(policy([strictRule, lenientRule]), changes);

    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.result === "fail")).toBe(true);
    expect(result.findings.map((f) => f.rule_id).sort()).toEqual([lenientRule.id, strictRule.id].sort());
    expect(result.findings.map((f) => f.severity).sort()).toEqual(["advisory", "blocking"]);
  });
});

describe("adversarial: policy rule-declaration-order invariance", () => {
  it("produces byte-identical findings regardless of the order rules are declared in the policy", () => {
    const r1 = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { id: "r1", severity: "blocking" });
    const r2 = rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "compatible" }, { id: "r2", severity: "advisory" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed" })]);

    const forward = runEval(policy([r1, r2]), changes);
    const reversed = runEval(policy([r2, r1]), changes);

    expect(JSON.stringify(forward.findings)).toBe(JSON.stringify(reversed.findings));
  });
});
