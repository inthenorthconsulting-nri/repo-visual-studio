import { describe, expect, it } from "vitest";
import { portfolioSceneId } from "../ids.js";
import { PORTFOLIO_HEADLINE_HARD_MAX_WORDS, PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES } from "../portfolio-plan.js";
import { validatePortfolioClaims, validatePortfolioModel, validatePortfolioPlan } from "../validation.js";
import {
  DEFAULT_PORTFOLIO_EVIDENCE_ID,
  makePortfolioCapability,
  makePortfolioCapabilityParticipation,
  makePortfolioClaim,
  makePortfolioDecision,
  makePortfolioDependencyEdge,
  makePortfolioDependencyNode,
  makePortfolioEvidence,
  makePortfolioGap,
  makePortfolioMaturityDimension,
  makePortfolioMaturitySummary,
  makePortfolioModel,
  makePortfolioOperatingModel,
  makePortfolioOverlap,
  makePortfolioPlan,
  makePortfolioProduct,
  makePortfolioRelationship,
  makePortfolioScenePlan,
  makeSourceMetadata,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// validatePortfolioModel
// ---------------------------------------------------------------------------

describe("validatePortfolioModel", () => {
  it("returns no warnings for a clean, internally-consistent model", () => {
    expect(validatePortfolioModel(makePortfolioModel())).toEqual([]);
  });

  it("PORTFOLIO_MODEL_DUPLICATE_PRODUCT_ID (Tier 1, severity error) fires when two products share an id", () => {
    const model = makePortfolioModel();
    model.products = [model.products[0], { ...model.products[0], displayName: "Duplicate Governance CLI" }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_DUPLICATE_PRODUCT_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_DUPLICATE_CAPABILITY_ID (Tier 1, severity error) fires when two capabilities share an id", () => {
    const model = makePortfolioModel();
    model.capabilities = [model.capabilities[0], { ...model.capabilities[0] }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_DUPLICATE_CAPABILITY_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH (Tier 1, severity error) fires when a non-'missing' capability has zero participants", () => {
    const model = makePortfolioModel();
    model.capabilities = [{ ...model.capabilities[0], coverage: "single_product", participation: [] }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH also fires when a 'missing'-coverage capability has participants", () => {
    const model = makePortfolioModel();
    model.capabilities = [{ ...model.capabilities[0], coverage: "missing" }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_RELATIONSHIP_UNKNOWN_PRODUCT (Tier 1, severity error) fires when a relationship references a product id not present in model.products", () => {
    const model = makePortfolioModel();
    model.relationships = [makePortfolioRelationship({ productAId: model.products[0].id, productBId: "portfolio:product:unknown", evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_RELATIONSHIP_UNKNOWN_PRODUCT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_RELATIONSHIP_SELF_REFERENCE (Tier 1, severity error) fires when productAId equals productBId", () => {
    const model = makePortfolioModel();
    model.relationships = [makePortfolioRelationship({ productAId: model.products[0].id, productBId: model.products[0].id, evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_RELATIONSHIP_SELF_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_DEPENDENCY_EDGE_UNKNOWN_ENDPOINT (Tier 1, severity error) fires when an edge's target node id is not in dependencyGraph.nodes", () => {
    const model = makePortfolioModel();
    model.dependencyGraph = { nodes: [], edges: [makePortfolioDependencyEdge({ sourceProductId: model.products[0].id, evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })] };
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_DEPENDENCY_EDGE_UNKNOWN_ENDPOINT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_OVERLAP_UNKNOWN_CAPABILITY (Tier 1, severity error) fires when an overlap references a capability id not present in model.capabilities", () => {
    const model = makePortfolioModel();
    model.overlaps = [makePortfolioOverlap({ capabilityId: "portfolio:capability:unknown", productIds: [model.products[0].id], evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_OVERLAP_UNKNOWN_CAPABILITY");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE (Tier 1, severity error) fires when a capability cites an evidence id absent from model.evidence", () => {
    const model = makePortfolioModel();
    model.capabilities = [{ ...model.capabilities[0], evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID, "portfolio:evidence:bogus:0"] }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.message).toContain("portfolio:evidence:bogus:0");
  });

  it("PORTFOLIO_MODEL_CAPABILITY_EVIDENCE_MISSING (Tier 1, severity error) fires when a capability has zero evidenceIds", () => {
    const model = makePortfolioModel();
    model.capabilities = [{ ...model.capabilities[0], evidenceIds: [] }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_CAPABILITY_EVIDENCE_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_EVIDENCE_DUPLICATE_ID (Tier 1, severity error) fires when two evidence records share an id", () => {
    const model = makePortfolioModel();
    model.evidence = [makePortfolioEvidence(), makePortfolioEvidence()];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_EVIDENCE_DUPLICATE_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED (Tier 1, severity error) fires when a resolved-type relationship is placed in unresolvedRelationships", () => {
    const model = makePortfolioModel();
    const productB = makePortfolioProduct({ source: makeSourceMetadata({ configId: "beta-cli" }) });
    model.products = [model.products[0], productB];
    model.unresolvedRelationships = [makePortfolioRelationship({ productAId: model.products[0].id, productBId: productB.id, type: "shared_capability", evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_MATURITY_INCONSISTENT_SCORE (Tier 2, severity warning) fires when a maturity dimension's score does not equal numerator/denominator", () => {
    const model = makePortfolioModel();
    model.maturity = makePortfolioMaturitySummary({ coverage: makePortfolioMaturityDimension({ label: "Coverage", score: 1, numerator: 1, denominator: 2 }) });
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_MATURITY_INCONSISTENT_SCORE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("PORTFOLIO_MODEL_MISSING_DISPLAY_NAME (Tier 1, severity error) fires when displayName is blank", () => {
    const model = makePortfolioModel({ displayName: "   " });
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_MISSING_DISPLAY_NAME");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_NO_PRODUCTS (Tier 1, severity error) fires when products is empty", () => {
    const model = makePortfolioModel({ products: [], capabilities: [] });
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_NO_PRODUCTS");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_CAPABILITY_UNKNOWN_PARTICIPANT (Tier 1, severity error) fires when a capability's participation references a product id not present in model.products", () => {
    const model = makePortfolioModel();
    model.capabilities = [{ ...model.capabilities[0], participation: [makePortfolioCapabilityParticipation({ productId: "portfolio:product:unknown" })] }];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_CAPABILITY_UNKNOWN_PARTICIPANT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_RELATIONSHIP_EVIDENCE_MISSING (Tier 1, severity error) fires when a relationship has zero evidenceIds", () => {
    const model = makePortfolioModel();
    const productB = makePortfolioProduct({ source: makeSourceMetadata({ configId: "beta-cli" }) });
    model.products = [model.products[0], productB];
    model.relationships = [makePortfolioRelationship({ productAId: model.products[0].id, productBId: productB.id, evidenceIds: [] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_RELATIONSHIP_EVIDENCE_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_DEPENDENCY_NODE_DUPLICATE_ID (Tier 1, severity error) fires when two dependency-graph nodes share an id", () => {
    const model = makePortfolioModel();
    const node = makePortfolioDependencyNode();
    model.dependencyGraph = { nodes: [node, { ...node, label: "Alpha CLI (duplicate)" }], edges: [] };
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_DEPENDENCY_NODE_DUPLICATE_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_OVERLAP_EVIDENCE_MISSING (Tier 1, severity error) fires when an overlap has zero evidenceIds", () => {
    const model = makePortfolioModel();
    model.overlaps = [makePortfolioOverlap({ capabilityId: model.capabilities[0].id, evidenceIds: [] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_OVERLAP_EVIDENCE_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_GAP_UNKNOWN_CAPABILITY (Tier 1, severity error) fires when a gap references a capability id not present in model.capabilities", () => {
    const model = makePortfolioModel();
    model.gaps = [makePortfolioGap({ capabilityId: "portfolio:capability:unknown", evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_GAP_UNKNOWN_CAPABILITY");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_GAP_EVIDENCE_MISSING (Tier 1, severity error) fires when a gap has zero evidenceIds", () => {
    const model = makePortfolioModel();
    model.gaps = [makePortfolioGap({ capabilityId: model.capabilities[0].id, evidenceIds: [] })];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_GAP_EVIDENCE_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT (Tier 1, severity error) fires when an operating-model stage references a product id not present in model.products", () => {
    const model = makePortfolioModel();
    model.operatingModel = makePortfolioOperatingModel({ stages: [{ stage: "operate", productIds: ["portfolio:product:unknown"], capabilityIds: [], inferred: true }] });
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_OPERATING_MODEL_CONTRADICTION (Tier 1, severity error) fires when a product is both assigned to a stage and listed as unassigned", () => {
    const model = makePortfolioModel();
    model.operatingModel = makePortfolioOperatingModel({
      stages: [{ stage: "operate", productIds: [model.products[0].id], capabilityIds: [], inferred: true }],
      unassignedProductIds: [model.products[0].id],
    });
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_OPERATING_MODEL_CONTRADICTION");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER (Tier 1, severity error) fires when model.capabilities is not sorted by id", () => {
    const model = makePortfolioModel();
    const capB = makePortfolioCapability({
      id: "portfolio:capability:zzz-widget",
      participation: [makePortfolioCapabilityParticipation({ productId: model.products[0].id })],
      evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    });
    model.capabilities = [capB, model.capabilities[0]];
    const warnings = validatePortfolioModel(model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// validatePortfolioClaims
// ---------------------------------------------------------------------------

describe("validatePortfolioClaims", () => {
  it("returns no warnings for clean claims resolving against a clean model", () => {
    const model = makePortfolioModel();
    expect(validatePortfolioClaims([makePortfolioClaim()], model)).toEqual([]);
  });

  it("PORTFOLIO_CLAIM_DUPLICATE_ID (Tier 1, severity error) fires when two claims share an id", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim(), makePortfolioClaim()];
    const warnings = validatePortfolioClaims(claims, model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_DUPLICATE_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS (Tier 1, severity error) fires for a rejected claim with empty rejectionReasons", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim({ id: "portfolio:claim:identity:rejected", status: "rejected", rejectionReasons: [] })];
    const warnings = validatePortfolioClaims(claims, model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("does not fire PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS for a rejected claim that does carry rejection reasons", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim({ id: "portfolio:claim:identity:rejected", status: "rejected", rejectionReasons: ["PORTFOLIO_CLAIM_UNSUPPORTED"] })];
    const warnings = validatePortfolioClaims(claims, model);
    expect(warnings.some((x) => x.code === "PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS")).toBe(false);
  });

  it("PORTFOLIO_CLAIM_UNEXPECTED_REJECTION_REASONS (Tier 1, severity error) fires for a non-rejected claim that carries rejection reason codes", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim({ status: "approved", rejectionReasons: ["PORTFOLIO_CLAIM_UNSUPPORTED"] })];
    const warnings = validatePortfolioClaims(claims, model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_UNEXPECTED_REJECTION_REASONS");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_CLAIM_QUALIFICATION_MISSING_QUALIFIER (Tier 1, severity error) fires for an approved_with_qualification claim with no qualifier text", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim({ status: "approved_with_qualification", qualifiers: [] })];
    const warnings = validatePortfolioClaims(claims, model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_QUALIFICATION_MISSING_QUALIFIER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE (Tier 1, severity error) fires when a claim cites an evidence id absent from model.evidence", () => {
    const model = makePortfolioModel();
    const claims = [makePortfolioClaim({ evidenceIds: ["portfolio:evidence:bogus:0"] })];
    const warnings = validatePortfolioClaims(claims, model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_CLAIM_NONDETERMINISTIC_ORDER (Tier 1, severity error) fires when the claims array is not sorted by id", () => {
    const model = makePortfolioModel();
    const claimA = makePortfolioClaim({ id: "portfolio:claim:identity:aaa" });
    const claimB = makePortfolioClaim({ id: "portfolio:claim:identity:zzz" });
    const warnings = validatePortfolioClaims([claimB, claimA], model);
    const w = warnings.find((x) => x.code === "PORTFOLIO_CLAIM_NONDETERMINISTIC_ORDER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// validatePortfolioPlan
// ---------------------------------------------------------------------------

describe("validatePortfolioPlan", () => {
  it("returns no warnings for a clean plan", () => {
    expect(validatePortfolioPlan(makePortfolioPlan())).toEqual([]);
  });

  it("PORTFOLIO_PLAN_TOO_FEW_SCENES (Tier 2, severity warning) fires when scenes.length is below PORTFOLIO_PLAN_MIN_SCENES", () => {
    const plan = makePortfolioPlan({ scenes: [makePortfolioScenePlan()] });
    expect(plan.scenes.length).toBeLessThan(PORTFOLIO_PLAN_MIN_SCENES);
    const warnings = validatePortfolioPlan(plan);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_TOO_FEW_SCENES");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("PORTFOLIO_PLAN_TOO_MANY_SCENES (Tier 2, severity warning) fires when scenes.length is above PORTFOLIO_PLAN_MAX_SCENES", () => {
    const scenes = Array.from({ length: PORTFOLIO_PLAN_MAX_SCENES + 1 }, (_, i) =>
      makePortfolioScenePlan({ id: portfolioSceneId("portfolio-hero", i), headline: `Distinct headline number ${i}` }),
    );
    const plan = makePortfolioPlan({ scenes });
    expect(plan.scenes.length).toBeGreaterThan(PORTFOLIO_PLAN_MAX_SCENES);
    const warnings = validatePortfolioPlan(plan);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_TOO_MANY_SCENES");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("PORTFOLIO_PLAN_HEADLINE_TOO_LONG (Tier 1, severity error) fires when a scene headline exceeds PORTFOLIO_HEADLINE_HARD_MAX_WORDS", () => {
    const plan = makePortfolioPlan();
    const longHeadline = Array.from({ length: PORTFOLIO_HEADLINE_HARD_MAX_WORDS + 2 }, (_, i) => `word${i}`).join(" ");
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], headline: longHeadline }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_HEADLINE_TOO_LONG");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_GENERIC_HEADLINE (Tier 1, severity error) fires when a scene headline is a generic slide label", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], headline: "Overview" }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_GENERIC_HEADLINE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE (Tier 1, severity error) fires when a scene references an unknown product id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], productIds: ["portfolio:product:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.message).toContain("portfolio:product:unknown");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown capability id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], capabilityIds: ["portfolio:capability:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.message).toContain("portfolio:capability:unknown");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown claim id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], claimIds: ["portfolio:claim:identity:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.message).toContain("portfolio:claim:identity:unknown");
  });

  it("PORTFOLIO_PLAN_DECISION_MISSING_STATEMENT (Tier 1, severity error) fires when a decision's statement is blank", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, decisions: [makePortfolioDecision({ statement: "   ", affectedProductIds: [plan.model.products[0].id] })] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_DECISION_MISSING_STATEMENT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_DECISION_UNKNOWN_PRODUCT (Tier 1, severity error) fires when a decision references a product id not present in plan.model.products", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, decisions: [makePortfolioDecision({ affectedProductIds: ["portfolio:product:unknown"] })] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_DECISION_UNKNOWN_PRODUCT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_DECISION_DUPLICATE_ID (Tier 1, severity error) fires when two decisions share an id", () => {
    const plan = makePortfolioPlan();
    const decision = makePortfolioDecision({ affectedProductIds: [plan.model.products[0].id] });
    const broken = { ...plan, decisions: [decision, { ...decision }] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_DECISION_DUPLICATE_ID");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER (Tier 1, severity error) fires when plan.decisions is not sorted by id", () => {
    const plan = makePortfolioPlan();
    const decisionA = makePortfolioDecision({ affectedProductIds: [plan.model.products[0].id], id: "portfolio:decision:ownership:aaa" });
    const decisionB = makePortfolioDecision({ affectedProductIds: [plan.model.products[0].id], id: "portfolio:decision:ownership:zzz" });
    const broken = { ...plan, decisions: [decisionB, decisionA] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown relationship id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], relationshipIds: ["portfolio:relationship:shared_capability:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.message).toContain("portfolio:relationship:shared_capability:unknown");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown gap id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], gapIds: ["portfolio:gap:unowned_capability:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.message).toContain("portfolio:gap:unowned_capability:unknown");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown decision id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], decisionIds: ["portfolio:decision:ownership:unknown"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.message).toContain("portfolio:decision:ownership:unknown");
  });

  it("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE also fires when a scene references an unknown evidence id", () => {
    const plan = makePortfolioPlan();
    const broken = { ...plan, scenes: [{ ...plan.scenes[0], evidenceIds: ["portfolio:evidence:bogus:0"] }, ...plan.scenes.slice(1)] };
    const warnings = validatePortfolioPlan(broken);
    const w = warnings.find((x) => x.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(w).toBeDefined();
    expect(w!.message).toContain("portfolio:evidence:bogus:0");
  });
});

// ---------------------------------------------------------------------------
// Evidence-lineage audit: a single evidence record can be cited from up to
// seven distinct places in the synthesized graph (capability, relationship,
// overlap, gap, dependency edge, claim, scene) -- these tests deliberately
// delete ONE evidence record that every one of those structures cites, then
// confirm each citing structure's own dangling-reference check fires
// independently. This is the actual thing "traceable to evidence" (§2.1/§15)
// depends on: if any single structure's check were missing or miswired, a
// deleted evidence record could silently vanish from that structure's
// lineage while every *other* structure still (correctly) complains --
// asserting on every citing structure at once is what would catch that.
// ---------------------------------------------------------------------------

describe("evidence-lineage audit -- deliberately removing an evidence record that multiple structures cite", () => {
  function buildFullyLinkedPlan() {
    const productA = makePortfolioProduct();
    const productB = makePortfolioProduct({
      displayName: "Beta CLI",
      source: makeSourceMetadata({ configId: "beta-cli", artifactRoot: "./artifacts/beta-cli" }),
    });
    const capability = makePortfolioCapability({
      participation: [makePortfolioCapabilityParticipation({ productId: productA.id }), makePortfolioCapabilityParticipation({ productId: productB.id, qualified: false })],
      coverage: "shared",
      evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID],
    });
    const relationship = makePortfolioRelationship({ productAId: productA.id, productBId: productB.id, evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });
    const overlap = makePortfolioOverlap({ productIds: [productA.id, productB.id], evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });
    const gap = makePortfolioGap({ affectedProductIds: [productA.id], evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });
    const targetNode = makePortfolioDependencyNode();
    const edge = makePortfolioDependencyEdge({ sourceProductId: productA.id, targetId: targetNode.id, evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });
    const claim = makePortfolioClaim({ evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });

    const model = makePortfolioModel({
      products: [productA, productB],
      capabilities: [capability],
      relationships: [relationship],
      overlaps: [overlap],
      gaps: [gap],
      dependencyGraph: { nodes: [targetNode], edges: [edge] },
      evidence: [makePortfolioEvidence()],
    });

    const scene = makePortfolioScenePlan({ evidenceIds: [DEFAULT_PORTFOLIO_EVIDENCE_ID] });
    const plan = makePortfolioPlan({ model, scenes: [scene, ...makePortfolioPlan().scenes.slice(1)], decisions: [] });

    return { model, claims: [claim], plan, relationship, overlap, gap, edge, capability };
  }

  it("with the evidence record intact, every structure that cites it resolves cleanly (zero dangling-reference warnings anywhere in the lineage)", () => {
    const { model, claims, plan } = buildFullyLinkedPlan();
    expect(validatePortfolioModel(model).filter((w) => w.code === "PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE")).toEqual([]);
    expect(validatePortfolioClaims(claims, model).filter((w) => w.code === "PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE")).toEqual([]);
    expect(validatePortfolioPlan(plan).filter((w) => w.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE")).toEqual([]);
  });

  it("once the shared evidence record is deleted from model.evidence, EVERY citing structure (capability, relationship, overlap, gap, dependency edge, claim, scene) reports its own independent dangling-reference warning -- none of the six lineage paths silently swallows the loss", () => {
    const { model, claims, plan, relationship, overlap, gap, edge, capability } = buildFullyLinkedPlan();
    const withoutEvidence = { ...model, evidence: [] };
    const planWithoutEvidence = { ...plan, model: withoutEvidence };

    const modelWarnings = validatePortfolioModel(withoutEvidence).filter((w) => w.code === "PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE");
    const flaggedIds = new Set(modelWarnings.map((w) => w.relatedId));
    expect(flaggedIds.has(capability.id)).toBe(true);
    expect(flaggedIds.has(relationship.id)).toBe(true);
    expect(flaggedIds.has(overlap.id)).toBe(true);
    expect(flaggedIds.has(gap.id)).toBe(true);
    expect(flaggedIds.has(edge.id)).toBe(true);
    // 5 distinct model-level structures each cite the one deleted evidence id exactly once.
    expect(modelWarnings).toHaveLength(5);

    const claimWarning = validatePortfolioClaims(claims, withoutEvidence).find((w) => w.code === "PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE");
    expect(claimWarning).toBeDefined();
    expect(claimWarning!.relatedId).toBe(claims[0]!.id);

    const sceneWarning = validatePortfolioPlan(planWithoutEvidence).find((w) => w.code === "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE");
    expect(sceneWarning).toBeDefined();
    expect(sceneWarning!.message).toContain(DEFAULT_PORTFOLIO_EVIDENCE_ID);
  });

  it("removing evidence cited ONLY by the gap (leaving every other structure's evidence intact) flags exactly the gap -- the check is precise per-reference, not a blanket 'something is missing' signal", () => {
    const { model, capability, relationship, overlap, edge } = buildFullyLinkedPlan();
    const gapOnlyEvidenceId = "portfolio:evidence:gap-only:0";
    const isolatedGap = makePortfolioGap({ affectedProductIds: [model.products[0]!.id], evidenceIds: [gapOnlyEvidenceId] });
    const modelWithIsolatedGap = { ...model, gaps: [isolatedGap], evidence: [makePortfolioEvidence()] };

    const warnings = validatePortfolioModel(modelWithIsolatedGap).filter((w) => w.code === "PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.relatedId).toBe(isolatedGap.id);
    expect(warnings[0]!.message).toContain(gapOnlyEvidenceId);
    // Confirms the other four evidence-citing structures (still pointing at the evidence record that
    // DOES exist) were genuinely re-checked and found clean, not merely skipped.
    expect(warnings.some((w) => w.relatedId === capability.id || w.relatedId === relationship.id || w.relatedId === overlap.id || w.relatedId === edge.id)).toBe(false);
  });
});
