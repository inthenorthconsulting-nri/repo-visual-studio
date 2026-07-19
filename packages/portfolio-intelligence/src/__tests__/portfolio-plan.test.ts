import { describe, expect, it } from "vitest";
import type { PortfolioGapType, PortfolioProduct, PortfolioProductRelationship } from "../contracts.js";
import { portfolioDecisionId, portfolioProductId } from "../ids.js";
import { buildPortfolioDecisions, buildPortfolioPlan, PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES, type BuildPortfolioPlanOptions } from "../portfolio-plan.js";
import {
  GENERATED_AT,
  makePortfolioCapability,
  makePortfolioDependencyEdge,
  makePortfolioGap,
  makePortfolioModel,
  makePortfolioNarrative,
  makePortfolioOperatingModel,
  makePortfolioOverlap,
  makePortfolioProduct,
  makePortfolioRelationship,
  makeSourceMetadata,
} from "./fixtures.js";

/** N distinct portfolio products (p0..p{n-1}), each with a unique configId/id so relationship/capability fixtures below have real product ids to reference. */
function makeProducts(n: number): PortfolioProduct[] {
  return Array.from({ length: n }, (_, i) =>
    makePortfolioProduct({
      displayName: `Product ${i}`,
      source: makeSourceMetadata({ configId: `product-${i}`, artifactRoot: `./artifacts/product-${i}` }),
    }),
  );
}

/** The first `count` distinct (i < j) pairs among `products`, each as a "shared_capability" relationship -- enough unique pairs exist up to C(products.length, 2). */
function makeRelationshipsAmong(products: PortfolioProduct[], count: number): PortfolioProductRelationship[] {
  const relationships: PortfolioProductRelationship[] = [];
  outer: for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      if (relationships.length >= count) break outer;
      relationships.push(makePortfolioRelationship({ productAId: products[i]!.id, productBId: products[j]!.id }));
    }
  }
  return relationships;
}

function makeSecondProduct() {
  return makePortfolioProduct({
    displayName: "Beta CLI",
    primaryArchetype: "operations_platform",
    primaryRole: "operations_system",
    source: makeSourceMetadata({ configId: "beta-cli", artifactRoot: "./artifacts/beta-cli" }),
  });
}

describe("buildPortfolioDecisions - gap-to-decision mapping (GAP_TYPE_TO_DECISION_TYPE)", () => {
  it("maps an unowned_capability gap to an ownership decision with high urgency, tracing owner/confidence to the gap's product and capability", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.id).toBe(portfolioDecisionId("ownership", gap.id));
    expect(decision.type).toBe("ownership");
    expect(decision.urgency).toBe("high");
    expect(decision.statement).toBe(gap.statement);
    expect(decision.affectedProductIds).toEqual([product.id]);
    // The model's default capability ("portfolio:capability:widget-sync") is confidence: "confirmed".
    expect(decision.confidence).toBe("confirmed");
    // A single affected product with role governance_system resolves to platform_leadership (ownership.ts's ROLE_OWNER_TYPE).
    expect(decision.recommendedOwnerType).toBe("platform_leadership");
  });

  it("maps a qualified_only_coverage gap to a qualified_capability_investment decision with low urgency", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "qualified_only_coverage", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.id).toBe(portfolioDecisionId("qualified_capability_investment", gap.id));
    expect(decisions[0]!.type).toBe("qualified_capability_investment");
    expect(decisions[0]!.urgency).toBe("low");
  });

  it("maps a runtime_verification_gap gap to a runtime_verification decision with medium urgency", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "runtime_verification_gap", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.id).toBe(portfolioDecisionId("runtime_verification", gap.id));
    expect(decisions[0]!.type).toBe("runtime_verification");
    expect(decisions[0]!.urgency).toBe("medium");
  });

  it("maps a dependency_gap gap to a shared_contract decision with medium urgency", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "dependency_gap", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.id).toBe(portfolioDecisionId("shared_contract", gap.id));
    expect(decisions[0]!.type).toBe("shared_contract");
    expect(decisions[0]!.urgency).toBe("medium");
  });

  it("emits no decision for gap types absent from GAP_TYPE_TO_DECISION_TYPE (e.g. contract_gap)", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "contract_gap", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    expect(buildPortfolioDecisions(model)).toEqual([]);
  });
});

describe("buildPortfolioDecisions - overlap, reconciliation, and unresolved-relationship signals", () => {
  it("emits an overlap_resolution decision only for strategic-severity overlaps, never material ones", () => {
    const strategicOverlap = makePortfolioOverlap({ severity: "strategic" });
    const materialOverlap = makePortfolioOverlap({ capabilityId: "portfolio:capability:other-thing", severity: "material" });
    const model = makePortfolioModel({ overlaps: [strategicOverlap, materialOverlap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.id).toBe(portfolioDecisionId("overlap_resolution", strategicOverlap.id));
    expect(decision.type).toBe("overlap_resolution");
    expect(decision.urgency).toBe("high");
    expect(decision.confidence).toBe("derived");
    expect(decision.affectedProductIds).toEqual(strategicOverlap.productIds);
  });

  it("emits a product_boundary decision for a duplicate_display_name reconciliation signal", () => {
    const product1 = makePortfolioProduct();
    const product2 = makePortfolioProduct({
      displayName: product1.displayName,
      primaryArchetype: "operations_platform",
      primaryRole: "operations_system",
      source: makeSourceMetadata({ configId: "governance-cli-2", artifactRoot: "./artifacts/governance-cli-2" }),
    });
    const model = makePortfolioModel({ products: [product1, product2] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.type).toBe("product_boundary");
    expect(decision.confidence).toBe("suggested");
    expect(decision.urgency).toBe("low");
    expect(decision.evidenceIds).toEqual([]);
    expect([...decision.affectedProductIds].sort()).toEqual([product1.id, product2.id].sort());
  });

  it("emits an integration_priority decision for each unresolved relationship", () => {
    const product1 = makePortfolioProduct();
    const product2 = makeSecondProduct();
    const rel = makePortfolioRelationship({ productAId: product1.id, productBId: product2.id });
    const model = makePortfolioModel({ products: [product1, product2], unresolvedRelationships: [rel] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.id).toBe(portfolioDecisionId("integration_priority", rel.id));
    expect(decision.type).toBe("integration_priority");
    expect(decision.confidence).toBe("unresolved");
    expect(decision.urgency).toBe("low");
    expect(decision.affectedProductIds).toEqual([rel.productAId, rel.productBId]);
    expect(decision.statement).toBe(rel.statement);
  });

  it("sorts the combined decision register by id, and never emits a 'deprecation' decision from any structural signal", () => {
    const product1 = makePortfolioProduct();
    const product2 = makeSecondProduct();
    const allGapTypes: PortfolioGapType[] = [
      "no_product_coverage",
      "qualified_only_coverage",
      "fragmented_coverage",
      "unowned_capability",
      "dependency_gap",
      "contract_gap",
      "operational_gap",
      "runtime_verification_gap",
    ];
    const gaps = allGapTypes.map((type) => makePortfolioGap({ type, affectedProductIds: [product1.id], capabilityId: "portfolio:capability:widget-sync" }));
    const overlap = makePortfolioOverlap({ severity: "strategic" });
    const unresolvedRel = makePortfolioRelationship({ productAId: product1.id, productBId: product2.id });
    const model = makePortfolioModel({ products: [product1, product2], gaps, overlaps: [overlap], unresolvedRelationships: [unresolvedRel] });

    const decisions = buildPortfolioDecisions(model);
    // 4 mapped gap types + 1 strategic overlap + 1 unresolved relationship = 6 (the two products differ in
    // displayName and archetype, so no reconciliation signal is added on top).
    expect(decisions).toHaveLength(6);
    expect(decisions.every((d) => d.type !== "deprecation")).toBe(true);
    expect(decisions.map((d) => d.id)).toEqual(
      [...decisions.map((d) => d.id)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("buildPortfolioDecisions - owner-type resolution never invents a named individual or an arbitrary role (ownership.ts + decisionOwnerType)", () => {
  it("falls back to the generic architecture_council owner (never picking one product's role arbitrarily) when a decision's affected products span two different roles", () => {
    const product1 = makePortfolioProduct(); // default primaryRole: governance_system
    const product2 = makeSecondProduct(); // primaryRole: operations_system
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product1.id, product2.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product1, product2], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.recommendedOwnerType).toBe("architecture_council");
  });

  it("falls back to the generic architecture_council owner (never a fabricated role) when affectedProductIds don't resolve to any product in the model at all", () => {
    const strategicOverlap = makePortfolioOverlap({ severity: "strategic", productIds: ["portfolio:product:unknown-a", "portfolio:product:unknown-b"] });
    const model = makePortfolioModel({ overlaps: [strategicOverlap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.recommendedOwnerType).toBe("architecture_council");
  });

  it("a single affected product with a known role still resolves to that role's owner type, not the mixed-role fallback (control case, so the fallback tests above are proven meaningful)", () => {
    const product = makeSecondProduct(); // primaryRole: operations_system -> operations_owner
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions[0]!.recommendedOwnerType).toBe("operations_owner");
  });
});

describe("buildPortfolioDecisions - confidence is only ever read from an already-resolved capability, never fabricated", () => {
  it("falls back to confidence: 'derived' when the gap has no capabilityId at all", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: undefined });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.confidence).toBe("derived");
  });

  it("falls back to confidence: 'derived' when the gap's capabilityId points to a capability absent from model.capabilities (dangling reference), rather than crashing or inventing a confidence level", () => {
    const product = makePortfolioProduct();
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: "portfolio:capability:does-not-exist" });
    const model = makePortfolioModel({ products: [product], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.confidence).toBe("derived");
  });

  it("reads confidence directly off the resolved capability's own confidence field (not a fixed default) when capabilityId does resolve", () => {
    const product = makePortfolioProduct();
    const capability = makePortfolioCapability({ id: "portfolio:capability:widget-sync", confidence: "suggested" });
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: capability.id });
    const model = makePortfolioModel({ products: [product], capabilities: [capability], gaps: [gap] });

    const decisions = buildPortfolioDecisions(model);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.confidence).toBe("suggested");
  });
});

describe("buildPortfolioPlan / selectSceneTypes (evidence-gated optional scenes)", () => {
  const narrative = makePortfolioNarrative();
  const options: BuildPortfolioPlanOptions = { audience: "executive", theme: "default", evidenceMode: "concise", generatedAt: GENERATED_AT };

  it("omits the evidence-gated portfolio-landscape scene, staying at PORTFOLIO_PLAN_MIN_SCENES, when the model has fewer than 2 products", () => {
    const model = makePortfolioModel();
    expect(model.products).toHaveLength(1);

    const plan = buildPortfolioPlan(model, narrative, [], options);
    expect(plan.scenes.some((s) => s.type === "portfolio-landscape")).toBe(false);
    expect(plan.scenes).toHaveLength(PORTFOLIO_PLAN_MIN_SCENES);
    expect(plan.generationMetadata.sceneCount).toBe(PORTFOLIO_PLAN_MIN_SCENES);
  });

  it("includes portfolio-landscape once the model has 2 or more products, staying within scene bounds", () => {
    const model = makePortfolioModel({ products: [makePortfolioProduct(), makeSecondProduct()] });

    const plan = buildPortfolioPlan(model, narrative, [], options);
    expect(plan.scenes.some((s) => s.type === "portfolio-landscape")).toBe(true);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(PORTFOLIO_PLAN_MIN_SCENES);
    expect(plan.scenes.length).toBeLessThanOrEqual(PORTFOLIO_PLAN_MAX_SCENES);
  });

  it("includes every optional scene, capped at PORTFOLIO_PLAN_MAX_SCENES, once every evidence gate is satisfied", () => {
    const product1 = makePortfolioProduct();
    const product2 = makeSecondProduct();
    const relationship = makePortfolioRelationship({ productAId: product1.id, productBId: product2.id, type: "shared_platform" });
    const dependencyEdge = makePortfolioDependencyEdge({ sourceProductId: product1.id });
    const gap = makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product1.id], capabilityId: "portfolio:capability:widget-sync" });
    const model = makePortfolioModel({
      products: [product1, product2],
      relationships: [relationship],
      dependencyGraph: { nodes: [], edges: [dependencyEdge] },
      operatingModel: makePortfolioOperatingModel({
        stages: [{ stage: "operate", productIds: [product1.id, product2.id], capabilityIds: ["portfolio:capability:widget-sync"], inferred: true }],
      }),
      gaps: [gap],
    });

    const plan = buildPortfolioPlan(model, narrative, [], options);
    const sceneTypes = plan.scenes.map((s) => s.type);
    for (const requiredType of [
      "portfolio-landscape",
      "portfolio-operating-model",
      "portfolio-relationship-map",
      "portfolio-dependency-map",
      "portfolio-shared-contracts",
      "portfolio-gaps",
      "portfolio-decisions",
    ] as const) {
      expect(sceneTypes).toContain(requiredType);
    }
    expect(plan.scenes).toHaveLength(PORTFOLIO_PLAN_MAX_SCENES);
    expect(new Set(sceneTypes).size).toBe(PORTFOLIO_PLAN_MAX_SCENES);
    expect(plan.generationMetadata.sceneCount).toBe(PORTFOLIO_PLAN_MAX_SCENES);
    // Decisions are computed once (via buildPortfolioDecisions) and reused for both the plan's decisions
    // register and the portfolio-decisions scene gate.
    expect(plan.decisions.length).toBeGreaterThan(0);
  });
});

describe("buildPortfolioPlan / large-portfolio scale (12 products, 30 capabilities, 25 relationships)", () => {
  const narrative = makePortfolioNarrative();
  const options: BuildPortfolioPlanOptions = { audience: "executive", theme: "default", evidenceMode: "audit", generatedAt: GENERATED_AT };

  it("stays within PORTFOLIO_PLAN_MIN_SCENES..PORTFOLIO_PLAN_MAX_SCENES, includes every capability (30 < CAPABILITY_COVERAGE_MAX), and truncates the relationship map (25 > RELATIONSHIP_MAP_DENSE_THRESHOLD) with a disclosed qualifier rather than silently dropping edges", () => {
    const products = makeProducts(12);
    const capabilities = Array.from({ length: 30 }, (_, i) => makePortfolioCapability({ id: `portfolio:capability:cap-${String(i).padStart(2, "0")}`, displayName: `Capability ${i}` }));
    const relationships = makeRelationshipsAmong(products, 25);
    const model = makePortfolioModel({ products, capabilities, relationships });

    const plan = buildPortfolioPlan(model, narrative, [], options);

    expect(plan.scenes.length).toBeGreaterThanOrEqual(PORTFOLIO_PLAN_MIN_SCENES);
    expect(plan.scenes.length).toBeLessThanOrEqual(PORTFOLIO_PLAN_MAX_SCENES);

    const coverageScene = plan.scenes.find((s) => s.type === "portfolio-capability-coverage")!;
    expect(coverageScene.capabilityIds).toHaveLength(30);
    expect(coverageScene.qualifiers).toEqual([]);

    const relationshipScene = plan.scenes.find((s) => s.type === "portfolio-relationship-map")!;
    expect(relationshipScene.relationshipIds).toHaveLength(12);
    expect(relationshipScene.density).toBe("low");
    expect(relationshipScene.qualifiers).toEqual([`Showing the 12 highest-priority relationships of 25; the full set is available in the evidence export.`]);
    // Truncation picks the 12 lowest-sorted-by-id relationships deterministically, not an arbitrary subset.
    const expectedIncludedIds = [...relationships].map((r) => r.id).sort((a, b) => a.localeCompare(b)).slice(0, 12);
    expect(relationshipScene.relationshipIds).toEqual(expectedIncludedIds);
  });
});

describe("buildPortfolioPlan / portfolio-relationship-map density fallback (RELATIONSHIP_MAP_DENSE_THRESHOLD boundary)", () => {
  const narrative = makePortfolioNarrative();
  const options: BuildPortfolioPlanOptions = { audience: "executive", theme: "default", evidenceMode: "audit", generatedAt: GENERATED_AT };

  it("0 relationships: portfolio-relationship-map is omitted entirely (evidence-gated, never an empty scene)", () => {
    const model = makePortfolioModel({ products: makeProducts(2), relationships: [] });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    expect(plan.scenes.some((s) => s.type === "portfolio-relationship-map")).toBe(false);
  });

  it("1 relationship: included in full, density medium, no truncation qualifier", () => {
    const products = makeProducts(2);
    const relationships = makeRelationshipsAmong(products, 1);
    const model = makePortfolioModel({ products, relationships });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-relationship-map")!;
    expect(scene.relationshipIds).toHaveLength(1);
    expect(scene.density).toBe("medium");
    expect(scene.qualifiers).toEqual([]);
  });

  it("exactly 12 relationships (at, not over, the threshold): included in full, density medium, no truncation -- '> 12' is a strict inequality", () => {
    const products = makeProducts(12);
    const relationships = makeRelationshipsAmong(products, 12);
    const model = makePortfolioModel({ products, relationships });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-relationship-map")!;
    expect(scene.relationshipIds).toHaveLength(12);
    expect(scene.density).toBe("medium");
    expect(scene.qualifiers).toEqual([]);
  });

  it("13 relationships (one over the threshold): truncated to 12, density low, qualifier discloses the truncation and the true total", () => {
    const products = makeProducts(12);
    const relationships = makeRelationshipsAmong(products, 13);
    const model = makePortfolioModel({ products, relationships });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-relationship-map")!;
    expect(scene.relationshipIds).toHaveLength(12);
    expect(scene.density).toBe("low");
    expect(scene.qualifiers).toEqual([`Showing the 12 highest-priority relationships of 13; the full set is available in the evidence export.`]);
  });

  it("all-to-all (6 products, C(6,2)=15 relationships): still just a count crossing the threshold -- truncates the same as any other 15-relationship set", () => {
    const products = makeProducts(6);
    const relationships = makeRelationshipsAmong(products, 15);
    expect(relationships).toHaveLength(15);
    const model = makePortfolioModel({ products, relationships });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-relationship-map")!;
    expect(scene.relationshipIds).toHaveLength(12);
    expect(scene.density).toBe("low");
    expect(scene.qualifiers).toEqual([`Showing the 12 highest-priority relationships of 15; the full set is available in the evidence export.`]);
  });
});

describe("buildPortfolioPlan / portfolio-capability-coverage truncation (CAPABILITY_COVERAGE_MAX boundary)", () => {
  const narrative = makePortfolioNarrative();
  const options: BuildPortfolioPlanOptions = { audience: "executive", theme: "default", evidenceMode: "audit", generatedAt: GENERATED_AT };

  it("exactly 40 capabilities (at, not over, the threshold): included in full, no truncation qualifier", () => {
    const capabilities = Array.from({ length: 40 }, (_, i) => makePortfolioCapability({ id: `portfolio:capability:cap-${String(i).padStart(2, "0")}`, displayName: `Capability ${i}` }));
    const model = makePortfolioModel({ capabilities });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-capability-coverage")!;
    expect(scene.capabilityIds).toHaveLength(40);
    expect(scene.qualifiers).toEqual([]);
  });

  it("41 capabilities (one over the threshold): truncated to the 40 lowest-sorted ids, qualifier discloses the true total", () => {
    const capabilities = Array.from({ length: 41 }, (_, i) => makePortfolioCapability({ id: `portfolio:capability:cap-${String(i).padStart(2, "0")}`, displayName: `Capability ${i}` }));
    const model = makePortfolioModel({ capabilities });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-capability-coverage")!;
    expect(scene.capabilityIds).toHaveLength(40);
    expect(scene.qualifiers).toEqual([`Showing 40 of 41 capabilities; remaining capabilities are available in the full export.`]);
    const expectedIncludedIds = capabilities.map((c) => c.id).sort((a, b) => a.localeCompare(b)).slice(0, 40);
    expect(scene.capabilityIds).toEqual(expectedIncludedIds);
  });
});

describe("buildPortfolioPlan / portfolio-decisions truncation (DECISIONS_MAX boundary)", () => {
  const narrative = makePortfolioNarrative();
  const options: BuildPortfolioPlanOptions = { audience: "executive", theme: "default", evidenceMode: "audit", generatedAt: GENERATED_AT };

  it("exactly 40 decisions (at, not over, the threshold): included in full, no truncation qualifier", () => {
    const product = makePortfolioProduct();
    const gaps = Array.from({ length: 40 }, (_, i) =>
      makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: `portfolio:capability:cap-${String(i).padStart(2, "0")}` }),
    );
    const model = makePortfolioModel({ products: [product], gaps });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-decisions")!;
    expect(scene.decisionIds).toHaveLength(40);
    expect(scene.qualifiers).toEqual([]);
  });

  it("41 decisions (one over the threshold): truncated to the 40 lowest-sorted ids, qualifier discloses the true total", () => {
    const product = makePortfolioProduct();
    const gaps = Array.from({ length: 41 }, (_, i) =>
      makePortfolioGap({ type: "unowned_capability", affectedProductIds: [product.id], capabilityId: `portfolio:capability:cap-${String(i).padStart(2, "0")}` }),
    );
    const model = makePortfolioModel({ products: [product], gaps });
    const plan = buildPortfolioPlan(model, narrative, [], options);
    const scene = plan.scenes.find((s) => s.type === "portfolio-decisions")!;
    expect(scene.decisionIds).toHaveLength(40);
    expect(scene.qualifiers).toEqual([`Showing 40 of 41 decisions; remaining decisions are available in the full export.`]);
    const expectedIncludedIds = buildPortfolioDecisions(model).map((d) => d.id).slice(0, 40);
    expect(scene.decisionIds).toEqual(expectedIncludedIds);
  });
});
