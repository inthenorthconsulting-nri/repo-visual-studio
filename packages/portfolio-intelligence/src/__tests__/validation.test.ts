import { describe, expect, it } from "vitest";
import { portfolioSceneId } from "../ids.js";
import { PORTFOLIO_HEADLINE_HARD_MAX_WORDS, PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES } from "../portfolio-plan.js";
import { validatePortfolioClaims, validatePortfolioModel, validatePortfolioPlan } from "../validation.js";
import {
  DEFAULT_PORTFOLIO_EVIDENCE_ID,
  makePortfolioClaim,
  makePortfolioDecision,
  makePortfolioDependencyEdge,
  makePortfolioEvidence,
  makePortfolioMaturityDimension,
  makePortfolioMaturitySummary,
  makePortfolioModel,
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
});
