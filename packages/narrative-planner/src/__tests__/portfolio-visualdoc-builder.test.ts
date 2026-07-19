import type { PortfolioMaturitySummary, PortfolioModel, PortfolioNarrative, PortfolioPlan, PortfolioScenePlan, PortfolioSceneType } from "@rvs/portfolio-intelligence";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { buildPortfolioVisualDoc, buildPortfolioVisualDocScenes } from "../portfolio-visualdoc-builder.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built PortfolioPlan fixture — this builder only ever reads
// plan.model.{portfolioId,displayName}, plan.generationMetadata.{audience,
// theme}, and plan.scenes[].{id,headline}, so the rest of the shape is
// filled in with structurally-valid placeholders.
// ---------------------------------------------------------------------------

function makeMaturityDimension() {
  return { score: 1, numerator: 1, denominator: 1, label: "dimension" };
}

function makeMaturity(): PortfolioMaturitySummary {
  return {
    coverage: makeMaturityDimension(),
    operational: makeMaturityDimension(),
    verification: makeMaturityDimension(),
    integration: makeMaturityDimension(),
    ownership: makeMaturityDimension(),
    runtimeEvidence: makeMaturityDimension(),
    coherence: makeMaturityDimension(),
  };
}

function makeModel(overrides: Partial<PortfolioModel> = {}): PortfolioModel {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Platform Portfolio",
    products: [],
    domains: [],
    capabilities: [],
    relationships: [],
    unresolvedRelationships: [],
    dependencyGraph: { nodes: [], edges: [] },
    overlaps: [],
    gaps: [],
    operatingModel: { stages: [], transitions: [], unassignedProductIds: [] },
    maturity: makeMaturity(),
    evidence: [],
    evidenceSummary: {
      productCount: 0,
      uniqueCapabilityCount: 0,
      productCapabilityImplementationCount: 0,
      qualifiedOnlyCapabilityCount: 0,
      confirmedRelationshipCount: 0,
      materialOverlapCount: 0,
      gapCount: 0,
      productsWithRuntimeEvidenceCount: 0,
    },
    excludedProducts: [],
    generationMetadata: { generated_at: "2026-07-01T00:00:00.000Z", schema_version: 1, productCount: 0, incompatibleProductCount: 0, allowPartialPortfolio: false },
    ...overrides,
  };
}

function makeNarrative(overrides: Partial<PortfolioNarrative> = {}): PortfolioNarrative {
  return {
    mission: "Acme Platform Portfolio combines several products into one governed ecosystem.",
    productsAndRoles: "",
    sharedOperatingModel: "",
    capabilityCoverage: "",
    productRelationships: "",
    proofAndMaturity: "",
    gapsAndDecisions: "",
    strategicDirection: "",
    approvedClaims: [],
    rejectedClaims: [],
    runtimeVerificationClaims: [],
    ...overrides,
  };
}

function makeScenePlan(type: PortfolioSceneType, id: string, headline: string): PortfolioScenePlan {
  return {
    id,
    type,
    headline,
    subheadline: undefined,
    density: "low",
    productIds: [],
    capabilityIds: [],
    relationshipIds: [],
    gapIds: [],
    decisionIds: [],
    claimIds: [],
    evidenceIds: [],
    qualifiers: [],
  };
}

function makePlan(scenes: PortfolioScenePlan[], overrides: Partial<PortfolioPlan> = {}): PortfolioPlan {
  return {
    schemaVersion: 1,
    model: makeModel(),
    narrative: makeNarrative(),
    decisions: [],
    scenes,
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      schema_version: 1,
      audience: "portfolio",
      theme: "default",
      evidenceMode: "concise",
      includeRoadmap: false,
      sceneCount: scenes.length,
    },
    ...overrides,
  };
}

describe("buildPortfolioVisualDocScenes", () => {
  it("emits one portfolio-scene pointer per PortfolioScenePlan, in the plan's own (narrative-significant) order — never re-sorted", () => {
    const scenes = [
      makeScenePlan("portfolio-closing", "portfolio:scene:portfolio-closing:0", "Acme Platform Portfolio is proven, not promised"),
      makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "Acme Platform Portfolio governs the ecosystem"),
    ];
    const plan = makePlan(scenes);
    const result = buildPortfolioVisualDocScenes(plan);
    expect(result.map((s) => s.id)).toEqual(["portfolio:scene:portfolio-closing:0", "portfolio:scene:portfolio-hero:0"]);
  });

  it("builds each pointer scene with type='portfolio-scene', the PortfolioScenePlan's own id/headline, empty evidence, plan_id=model.portfolioId, and scene_id=scene.id", () => {
    const scenePlan = makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "Acme Platform Portfolio governs the ecosystem");
    const plan = makePlan([scenePlan], { model: makeModel({ portfolioId: "portfolio:acme" }) });
    const [scene] = buildPortfolioVisualDocScenes(plan);
    expect(scene).toEqual({
      id: "portfolio:scene:portfolio-hero:0",
      type: "portfolio-scene",
      headline: "Acme Platform Portfolio governs the ecosystem",
      evidence: [],
      plan_id: "portfolio:acme",
      scene_id: "portfolio:scene:portfolio-hero:0",
    });
  });

  it("uses model.portfolioId as plan_id — the portfolio-wide stable key, unlike showcase's displayName-derived key", () => {
    const scenePlan = makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "headline");
    const plan = makePlan([scenePlan], { model: makeModel({ portfolioId: "portfolio:widget-ecosystem" }) });
    const [scene] = buildPortfolioVisualDocScenes(plan);
    expect(scene.type === "portfolio-scene" ? scene.plan_id : undefined).toBe("portfolio:widget-ecosystem");
  });

  it("returns an empty array for a plan with no scenes", () => {
    const plan = makePlan([]);
    expect(buildPortfolioVisualDocScenes(plan)).toEqual([]);
  });
});

describe("buildPortfolioVisualDoc", () => {
  it("produces a schema-valid VisualDoc", () => {
    const scenes = [
      makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "Acme Platform Portfolio governs the ecosystem"),
      makeScenePlan("portfolio-closing", "portfolio:scene:portfolio-closing:0", "Acme Platform Portfolio is proven, not promised"),
    ];
    const plan = makePlan(scenes);
    const doc = buildPortfolioVisualDoc(plan);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
  });

  it("titles the document '<displayName> — Portfolio Overview' and sources audience/theme from generationMetadata", () => {
    const plan = makePlan([makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "headline")], {
      model: makeModel({ displayName: "Widget Ecosystem" }),
      generationMetadata: {
        generated_at: "2026-07-01T00:00:00.000Z",
        schema_version: 1,
        audience: "platform_leader",
        theme: "technical-grid",
        evidenceMode: "audit",
        includeRoadmap: false,
        sceneCount: 1,
      },
    });
    const doc = buildPortfolioVisualDoc(plan);
    expect(doc.document.title).toBe("Widget Ecosystem — Portfolio Overview");
    expect(doc.document.audience).toBe("platform_leader");
    expect(doc.document.theme).toBe("technical-grid");
    expect(doc.document.aspect_ratio).toBe("16:9");
    expect(doc.version).toBe(1);
  });

  it("is a complete, self-ordered presentation on its own — every scene is a portfolio-scene pointer, matching plan.scenes 1:1", () => {
    const scenes = [
      makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "hero"),
      makeScenePlan("portfolio-landscape", "portfolio:scene:portfolio-landscape:0", "landscape"),
      makeScenePlan("portfolio-closing", "portfolio:scene:portfolio-closing:0", "closing"),
    ];
    const plan = makePlan(scenes);
    const doc = buildPortfolioVisualDoc(plan);
    expect(doc.scenes).toHaveLength(3);
    expect(doc.scenes.every((s) => s.type === "portfolio-scene")).toBe(true);
  });

  it("is deterministic: two builds of the same plan produce identical output", () => {
    const scenes = [makeScenePlan("portfolio-hero", "portfolio:scene:portfolio-hero:0", "headline")];
    const plan = makePlan(scenes);
    const a = buildPortfolioVisualDoc(plan);
    const b = buildPortfolioVisualDoc(plan);
    expect(a).toEqual(b);
  });
});
