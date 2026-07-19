import { describe, expect, it } from "vitest";
import type { PortfolioGapType } from "../contracts.js";
import { portfolioDecisionId } from "../ids.js";
import { buildPortfolioDecisions, buildPortfolioPlan, PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES, type BuildPortfolioPlanOptions } from "../portfolio-plan.js";
import {
  GENERATED_AT,
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
