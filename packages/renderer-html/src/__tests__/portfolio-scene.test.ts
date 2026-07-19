import type {
  PortfolioDecision,
  PortfolioGap,
  PortfolioMaturitySummary,
  PortfolioModel,
  PortfolioPlan,
  PortfolioProduct,
  PortfolioProductRelationship,
  PortfolioScenePlan,
  PortfolioSceneType,
} from "@rvs/portfolio-intelligence";
import type { PortfolioScene } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { renderPortfolioScene } from "../scenes/portfolio/index.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built fixtures — mirror packages/portfolio-intelligence's own
// contracts.ts shapes, kept local since renderer-html cannot import another
// package's __tests__ dir.
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<PortfolioProduct> = {}): PortfolioProduct {
  return {
    id: "portfolio:product:widget-cli",
    displayName: "Widget CLI",
    descriptor: "Governs widget rollout across environments",
    primaryArchetype: "governance_platform",
    secondaryArchetypes: [],
    primaryRole: "governance_system",
    secondaryRoles: [],
    currentCapabilityIds: [],
    qualifiedCapabilityIds: [],
    currentCapabilityCount: 0,
    qualifiedCapabilityCount: 0,
    source: { configId: "widget-cli", artifactRoot: "../widget-cli", compatibility: "compatible" },
    ...overrides,
  };
}

function makeMaturityDimension(overrides: Partial<PortfolioMaturitySummary["coverage"]> = {}) {
  return { score: 0.75, numerator: 3, denominator: 4, label: "Coverage", ...overrides };
}

function makeMaturity(): PortfolioMaturitySummary {
  return {
    coverage: makeMaturityDimension({ label: "Coverage" }),
    operational: makeMaturityDimension({ label: "Operational" }),
    verification: makeMaturityDimension({ label: "Verification" }),
    integration: makeMaturityDimension({ label: "Integration" }),
    ownership: makeMaturityDimension({ label: "Ownership" }),
    runtimeEvidence: makeMaturityDimension({ label: "Runtime evidence" }),
    coherence: makeMaturityDimension({ label: "Coherence" }),
  };
}

function makeRelationship(overrides: Partial<PortfolioProductRelationship> = {}): PortfolioProductRelationship {
  return {
    id: "portfolio:relationship:widget-cli:widget-operator:shared_capability",
    productAId: "portfolio:product:widget-cli",
    productBId: "portfolio:product:widget-operator",
    type: "shared_capability",
    confidence: "confirmed",
    statement: "Widget CLI and Widget Operator both implement widget synchronization.",
    capabilityIds: [],
    evidenceIds: [],
    ...overrides,
  };
}

function makeGap(overrides: Partial<PortfolioGap> = {}): PortfolioGap {
  return {
    id: "portfolio:gap:widget-audit-trail:no_product_coverage",
    type: "no_product_coverage",
    statement: "No product in the portfolio currently owns audit-trail export.",
    affectedProductIds: [],
    evidenceIds: [],
    ...overrides,
  };
}

function makeDecision(overrides: Partial<PortfolioDecision> = {}): PortfolioDecision {
  return {
    id: "portfolio:decision:overlap_resolution:widget-sync",
    type: "overlap_resolution",
    statement: "Decide which product owns widget synchronization going forward.",
    whyItMatters: "Two products currently implement overlapping widget-sync logic.",
    affectedProductIds: ["portfolio:product:widget-cli", "portfolio:product:widget-operator"],
    evidenceIds: [],
    currentAmbiguity: "Ownership has not been formally assigned.",
    recommendedOwnerType: "architecture_council",
    urgency: "high",
    confidence: "derived",
    ...overrides,
  };
}

function makeModel(overrides: Partial<PortfolioModel> = {}): PortfolioModel {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Platform Portfolio",
    products: [makeProduct()],
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
      productCount: 1,
      uniqueCapabilityCount: 0,
      productCapabilityImplementationCount: 0,
      qualifiedOnlyCapabilityCount: 0,
      confirmedRelationshipCount: 0,
      materialOverlapCount: 0,
      gapCount: 0,
      productsWithRuntimeEvidenceCount: 0,
    },
    excludedProducts: [],
    generationMetadata: { generated_at: "2026-07-01T00:00:00.000Z", schema_version: 1, productCount: 1, incompatibleProductCount: 0, allowPartialPortfolio: false },
    ...overrides,
  };
}

function makeScenePlan(type: PortfolioSceneType, overrides: Partial<PortfolioScenePlan> = {}): PortfolioScenePlan {
  return {
    id: `portfolio:scene:${type}:0`,
    type,
    headline: "Acme Platform Portfolio governs the ecosystem",
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
    ...overrides,
  };
}

function makePlan(scenes: PortfolioScenePlan[], overrides: Partial<PortfolioPlan> = {}): PortfolioPlan {
  return {
    schemaVersion: 1,
    model: makeModel(),
    narrative: {
      mission: "",
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
    },
    decisions: [],
    scenes,
    generationMetadata: { generated_at: "2026-07-01T00:00:00.000Z", schema_version: 1, audience: "portfolio", theme: "default", evidenceMode: "concise", includeRoadmap: false, sceneCount: scenes.length },
    ...overrides,
  };
}

function pointerScene(scenePlanId: string, planId: string): PortfolioScene {
  return { id: `visualdoc:scene:${scenePlanId}`, type: "portfolio-scene", headline: "unused-pointer-headline", evidence: [], plan_id: planId, scene_id: scenePlanId };
}

const ALL_SCENE_TYPES: PortfolioSceneType[] = [
  "portfolio-hero",
  "portfolio-mission",
  "portfolio-landscape",
  "portfolio-product-roles",
  "portfolio-operating-model",
  "portfolio-capability-coverage",
  "portfolio-relationship-map",
  "portfolio-dependency-map",
  "portfolio-shared-contracts",
  "portfolio-maturity",
  "portfolio-gaps",
  "portfolio-decisions",
  "portfolio-closing",
];

describe("renderPortfolioScene", () => {
  it("throws when the plan is undefined (unresolved plan_id)", () => {
    const scenePlan = makeScenePlan("portfolio-hero");
    const scene = pointerScene(scenePlan.id, "portfolio:acme");
    expect(() => renderPortfolioScene(scene, undefined)).toThrow(/unresolved plan_id/);
  });

  it("throws when the plan is resolved but the scene_id has no matching PortfolioScenePlan", () => {
    const scenePlan = makeScenePlan("portfolio-hero");
    const plan = makePlan([scenePlan]);
    const scene = pointerScene("portfolio:scene:does-not-exist:0", "portfolio:acme");
    expect(() => renderPortfolioScene(scene, plan)).toThrow(/unresolved scene_id/);
  });

  it.each(ALL_SCENE_TYPES)("renders scene type %s without throwing, wrapping it with the correct density data attribute", (type) => {
    const scenePlan = makeScenePlan(type, { density: "medium" });
    const plan = makePlan([scenePlan]);
    const scene = pointerScene(scenePlan.id, "portfolio:acme");

    const html = renderPortfolioScene(scene, plan);
    expect(html).toContain(`data-scene-density="medium"`);
    expect(html).toContain("class=\"scene-portfolio\"");
  });

  it("renders the portfolio-landscape scene with one card per scene.productIds entry, resolved from model.products", () => {
    const scenePlan = makeScenePlan("portfolio-landscape", { productIds: ["portfolio:product:widget-cli"] });
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("Widget CLI");
    expect(html).toContain("Governs widget rollout across environments");
    expect(html).toContain("governance_system");
  });

  it("renders 'No products are available yet.' on portfolio-landscape when productIds is empty", () => {
    const scenePlan = makeScenePlan("portfolio-landscape", { productIds: [] });
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("No products are available yet.");
  });

  it("renders the portfolio-product-roles scene grouped by primaryRole", () => {
    const secondProduct = makeProduct({ id: "portfolio:product:widget-operator", displayName: "Widget Operator", primaryRole: "operations_system" });
    const scenePlan = makeScenePlan("portfolio-product-roles", { productIds: ["portfolio:product:widget-cli", "portfolio:product:widget-operator"] });
    const plan = makePlan([scenePlan], { model: makeModel({ products: [makeProduct(), secondProduct] }) });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("governance_system");
    expect(html).toContain("operations_system");
    expect(html).toContain("Widget CLI");
    expect(html).toContain("Widget Operator");
  });

  it("renders the portfolio-relationship-map scene from scene.relationshipIds resolved against model.relationships", () => {
    const relationship = makeRelationship();
    const secondProduct = makeProduct({ id: "portfolio:product:widget-operator", displayName: "Widget Operator" });
    const scenePlan = makeScenePlan("portfolio-relationship-map", { relationshipIds: [relationship.id] });
    const plan = makePlan([scenePlan], { model: makeModel({ products: [makeProduct(), secondProduct], relationships: [relationship] }) });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("shared_capability");
    expect(html).toContain("Widget CLI");
    expect(html).toContain("Widget Operator");
    expect(html).toContain("confirmed");
  });

  it("resolves relationshipIds against unresolvedRelationships too on portfolio-relationship-map", () => {
    const relationship = makeRelationship({ id: "portfolio:relationship:unresolved:0", type: "unresolved", confidence: "unresolved" });
    const scenePlan = makeScenePlan("portfolio-relationship-map", { relationshipIds: [relationship.id] });
    const plan = makePlan([scenePlan], { model: makeModel({ unresolvedRelationships: [relationship] }) });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("unresolved");
  });

  it("renders the portfolio-maturity scene with one row per maturity dimension, showing numerator/denominator", () => {
    const scenePlan = makeScenePlan("portfolio-maturity");
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("Coverage");
    expect(html).toContain("Operational");
    expect(html).toContain("3/4");
  });

  it("renders the portfolio-gaps scene from scene.gapIds resolved against model.gaps, with the gap type shown", () => {
    const gap = makeGap();
    const scenePlan = makeScenePlan("portfolio-gaps", { gapIds: [gap.id] });
    const plan = makePlan([scenePlan], { model: makeModel({ gaps: [gap] }) });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("no_product_coverage");
    expect(html).toContain("No product in the portfolio currently owns audit-trail export.");
  });

  it("renders 'No gaps were identified.' on portfolio-gaps when gapIds is empty", () => {
    const scenePlan = makeScenePlan("portfolio-gaps", { gapIds: [] });
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("No gaps were identified.");
  });

  it("renders the portfolio-decisions scene from scene.decisionIds resolved against plan.decisions, including urgency", () => {
    const decision = makeDecision();
    const scenePlan = makeScenePlan("portfolio-decisions", { decisionIds: [decision.id] });
    const plan = makePlan([scenePlan], { decisions: [decision] });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("Decide which product owns widget synchronization going forward.");
    expect(html).toContain("high urgency");
    expect(html).toContain("architecture_council");
  });

  it("renders 'No decisions are available yet.' on portfolio-decisions when decisionIds is empty", () => {
    const scenePlan = makeScenePlan("portfolio-decisions", { decisionIds: [] });
    const plan = makePlan([scenePlan], { decisions: [] });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("No decisions are available yet.");
  });

  it("omits a decision from portfolio-decisions when it is present in plan.decisions but not in scene.decisionIds", () => {
    const decision = makeDecision();
    const scenePlan = makeScenePlan("portfolio-decisions", { decisionIds: [] });
    const plan = makePlan([scenePlan], { decisions: [decision] });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).not.toContain("Decide which product owns widget synchronization going forward.");
    expect(html).toContain("No decisions are available yet.");
  });

  it("HTML-escapes a headline containing markup-significant characters on every scene type", () => {
    const scenePlan = makeScenePlan("portfolio-hero", { headline: `<script>alert("x")</script> & 'friends'` });
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;");
  });

  it("HTML-escapes qualifier text rendered as a note (portfolio-operating-model scene qualifiersBlock)", () => {
    const scenePlan = makeScenePlan("portfolio-operating-model", { qualifiers: [`Contains <b>unverified</b> claims & "caveats"`] });
    const plan = makePlan([scenePlan]);
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("Contains &lt;b&gt;unverified&lt;/b&gt; claims &amp; &quot;caveats&quot;");
    expect(html).not.toContain("<b>unverified</b>");
  });

  it("HTML-escapes decision statements on portfolio-decisions", () => {
    const decision = makeDecision({ statement: `Widget CLI vs <Widget Operator> & "ownership"` });
    const scenePlan = makeScenePlan("portfolio-decisions", { decisionIds: [decision.id] });
    const plan = makePlan([scenePlan], { decisions: [decision] });
    const html = renderPortfolioScene(pointerScene(scenePlan.id, "portfolio:acme"), plan);
    expect(html).toContain("Widget CLI vs &lt;Widget Operator&gt; &amp; &quot;ownership&quot;");
    expect(html).not.toContain("<Widget Operator>");
  });
});
