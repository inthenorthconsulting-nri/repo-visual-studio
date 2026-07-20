import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";
import { diffCapability } from "../capability-diff.js";
import { diffProduct } from "../product-diff.js";
import { diffPortfolio } from "../portfolio-diff.js";
import { assessBlastRadius } from "../blast-radius.js";

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
    flows: [{ id: "flow:a-b", label: label("A to B"), kind: "data", fromId: "component:a", toId: "component:b", description: { value: "A pushes to B.", inference: "confirmed", evidence: [] }, evidence: [{ path: "src/a-to-b.ts" }] }],
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

function capability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: id,
    shortDescription: "desc",
    purpose: "purpose",
    domainId: "domain:core",
    status: "operational",
    confidence: "confirmed",
    inclusion: "include",
    readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
    actors: [],
    workflows: [],
    logicalComponents: ["component:a"],
    externalSystems: [],
    evidence: [],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: id, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

function excludedCandidate(id: string) {
  return {
    id,
    displayName: id,
    sourceLabel: id,
    granularity: "capability",
    status: "unknown",
    confidence: "unresolved",
    readiness: { score: 0, implementationScore: 0, executionScore: 0, verificationScore: 0, documentationScore: 0, adoptionScore: 0, blockers: [], qualifiers: [] },
    reasonCodes: ["insufficient_evidence"],
    reasonSummary: "Not enough evidence.",
    evidence: [],
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

function makeProductModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    identity: { displayName: "Acme Widget", archetype: "workflow-automation-platform", purpose: "p", descriptor: "d", shortPromise: "s", primaryUsers: [], secondaryUsers: [], secondaryArchetypes: [], valuePillars: [], differentiators: [], evidence: [] },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 0 },
    ...overrides,
  };
}

function maturityDimension(score: number, label: string) {
  return { score, numerator: score, denominator: 100, label };
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

describe("assessBlastRadius", () => {
  it("marks an architecture dependency change as 'unresolved', NEVER 'isolated', because ArchitectureDependency carries no fromId/toId consumer-linkage field", () => {
    const sourceArch = makeArchitecture({ dependencies: [] });
    const targetArch = makeArchitecture({ dependencies: [{ id: "dependency:postgres", label: label("Postgres"), kind: "runtime", description: { value: "Datastore.", inference: "confirmed", evidence: [] }, evidence: [{ path: "infra/postgres.tf" }] }] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: sourceArch,
      targetArchitectureArtifact: targetArch,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const depEntry = assessment.entries.find((e) => e.change_id.includes("dependency-postgres"));
    expect(depEntry?.level).toBe("unresolved");
    expect(depEntry?.level).not.toBe("isolated");
  });

  it("marks a newly-added, flow-disconnected component as 'isolated' -- a confirmed absence of connections, not a lack of data", () => {
    const sourceArch = makeArchitecture();
    const targetArch = makeArchitecture({ components: [...sourceArch.components, component("component:c")] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: sourceArch,
      targetArchitectureArtifact: targetArch,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const componentEntry = assessment.entries.find((e) => e.change_id.includes("component-c"));
    expect(componentEntry?.level).toBe("isolated");
  });

  it("marks a component connected via a flow edge to another component as 'cross_component'", () => {
    const sourceArch = makeArchitecture({ components: [component("component:a")] });
    const targetArch = makeArchitecture();
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: sourceArch,
      targetArchitectureArtifact: targetArch,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const componentEntry = assessment.entries.find((e) => e.change_id.includes("component-b"));
    expect(componentEntry?.level).toBe("cross_component");
    expect(componentEntry?.affected_entity_ids).toContain("component:a");
  });

  it("marks a capability in excludedCandidates as 'unresolved' (no logicalComponents linkage field exists structurally), and a live included capability with logicalComponents as 'product_wide'", () => {
    const sourceCap = makeCapabilityModel();
    const targetCap = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:live")], excludedCandidates: [excludedCandidate("capintel:capability:excluded")] });
    const sourceSnapshot = buildIntelligenceSnapshot({ capability: sourceCap, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ capability: targetCap, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: undefined, targetArtifact: undefined });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceCap, targetArtifact: targetCap });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: undefined,
      targetArchitectureArtifact: undefined,
      sourceCapabilityArtifact: sourceCap,
      targetCapabilityArtifact: targetCap,
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const liveEntry = assessment.entries.find((e) => e.change_id.includes("live"));
    const excludedEntry = assessment.entries.find((e) => e.change_id.includes("excluded"));
    expect(liveEntry?.level).toBe("product_wide");
    expect(excludedEntry?.level).toBe("unresolved");
  });

  it("marks every product-domain change as 'unresolved' (ProductIdentityModel carries no linkage into other domains)", () => {
    const sourceProduct = makeProductModel();
    const targetProduct = makeProductModel({ identity: { ...sourceProduct.identity, purpose: "A new purpose statement entirely." } });
    const sourceSnapshot = buildIntelligenceSnapshot({ product: sourceProduct, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ product: targetProduct, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: undefined, targetArtifact: undefined });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceProduct, targetArtifact: targetProduct });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: undefined,
      targetArchitectureArtifact: undefined,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const purposeEntry = assessment.entries.find((e) => e.change_id.includes("identity-purpose"));
    expect(purposeEntry?.level).toBe("unresolved");
  });

  it("marks a portfolio relationship change as 'cross_product' with both endpoint products as affected entities, and a maturity dimension change as 'portfolio_wide'", () => {
    const sourcePortfolio = makePortfolioModel();
    const targetPortfolio = makePortfolioModel({
      relationships: [{ id: "rel:widget-gadget", productAId: "product:widget", productBId: "product:gadget", type: "shared_contract", confidence: "confirmed", statement: "Shared contract.", capabilityIds: [], evidenceIds: ["ev1"] }],
      maturity: { ...sourcePortfolio.maturity, coverage: maturityDimension(95, "Coverage") },
    });
    const sourceProduct = makeProductModel();
    const sourceSnapshot = buildIntelligenceSnapshot({ product: sourceProduct, portfolio: sourcePortfolio, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ product: sourceProduct, portfolio: targetPortfolio, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: undefined, targetArtifact: undefined });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceProduct, targetArtifact: sourceProduct });
    const portfolioChanges = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourcePortfolio, targetArtifact: targetPortfolio });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      portfolioChanges,
      sourceArchitectureArtifact: undefined,
      targetArchitectureArtifact: undefined,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: sourcePortfolio,
      targetPortfolioArtifact: targetPortfolio,
    });

    const relEntry = assessment.entries.find((e) => e.change_id.includes("rel-widget-gadget"));
    expect(relEntry?.level).toBe("cross_product");
    expect(relEntry?.affected_entity_ids.sort()).toEqual(["product:gadget", "product:widget"]);

    const maturityEntry = assessment.entries.find((e) => e.change_id.includes("maturity-coverage"));
    expect(maturityEntry?.level).toBe("portfolio_wide");
  });

  it("sorts entries by level rank (isolated..unresolved) then change_id", () => {
    const sourceArch = makeArchitecture({ dependencies: [] });
    const targetArch = makeArchitecture({
      components: [...makeArchitecture().components, component("component:c")],
      dependencies: [{ id: "dependency:postgres", label: label("Postgres"), kind: "runtime", description: { value: "Datastore.", inference: "confirmed", evidence: [] }, evidence: [] }],
    });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const assessment = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: sourceArch,
      targetArchitectureArtifact: targetArch,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const levelRank: Record<string, number> = { isolated: 0, local: 1, cross_component: 2, product_wide: 3, cross_product: 4, portfolio_wide: 5, unresolved: 6 };
    const ranks = assessment.entries.map((e) => levelRank[e.level]);
    const sortedRanks = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sortedRanks);
  });

  it("is fully deterministic across repeated runs", () => {
    const sourceArch = makeArchitecture();
    const targetArch = makeArchitecture({ components: [...makeArchitecture().components, component("component:c")] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const buildInput = () => ({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges,
      productChanges,
      sourceArchitectureArtifact: sourceArch,
      targetArchitectureArtifact: targetArch,
      sourceCapabilityArtifact: makeCapabilityModel(),
      targetCapabilityArtifact: makeCapabilityModel(),
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });

    const first = assessBlastRadius(buildInput());
    const second = assessBlastRadius(buildInput());
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
