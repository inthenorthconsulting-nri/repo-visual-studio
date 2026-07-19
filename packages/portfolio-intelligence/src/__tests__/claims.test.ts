import { describe, expect, it } from "vitest";
import type { BuildPortfolioClaimsInput } from "../claims.js";
import { buildPortfolioClaims } from "../claims.js";
import type { PortfolioCapability, PortfolioConfig, PortfolioEvidence, PortfolioMaturitySummary, PortfolioOperatingModel, PortfolioProductRelationship } from "../contracts.js";
import { makePortfolioConfig, makePortfolioProduct } from "./fixtures.js";

function dim(numerator: number, denominator: number, label: string) {
  return { numerator, denominator, score: denominator === 0 ? 0 : numerator / denominator, label };
}

function buildInput(overrides: Partial<BuildPortfolioClaimsInput> = {}): BuildPortfolioClaimsInput {
  const productA = makePortfolioProduct({
    source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" },
    displayName: "Product A",
    descriptor: "Alpha platform for compliance teams.",
    currentCapabilityCount: 1,
  });
  const productB = makePortfolioProduct({
    source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" },
    displayName: "Product B",
    descriptor: "Beta platform for operations teams.",
    currentCapabilityCount: 1,
  });

  const sharedCap: PortfolioCapability = {
    id: "portfolio:capability:shared-x",
    displayName: "Shared X",
    domain: "Widget Operations",
    coverage: "shared",
    participation: [
      { productId: productA.id, productCapabilityId: "capA:x", productCapabilityDisplayName: "X", qualified: false },
      { productId: productB.id, productCapabilityId: "capB:x", productCapabilityDisplayName: "X", qualified: false },
    ],
    evidenceIds: ["portfolio:evidence:capability:product-a:0"],
    confidence: "confirmed",
  };

  const resolvedRelationship: PortfolioProductRelationship = {
    id: "portfolio:relationship:shared_capability:product-a:product-b",
    productAId: productA.id,
    productBId: productB.id,
    type: "shared_capability",
    confidence: "confirmed",
    statement: "Product A and Product B both implement Shared X.",
    capabilityIds: [sharedCap.id],
    evidenceIds: ["portfolio:evidence:capability:product-a:0"],
  };

  const unresolvedRelationship: PortfolioProductRelationship = {
    id: "portfolio:relationship:unresolved:product-a:product-b",
    productAId: productA.id,
    productBId: productB.id,
    type: "unresolved",
    confidence: "unresolved",
    statement: "The relationship between Product A and Product B could not be resolved from available evidence.",
    capabilityIds: [],
    evidenceIds: ["portfolio:evidence:capability:product-a:0"],
  };

  const maturity: PortfolioMaturitySummary = {
    coverage: dim(1, 1, "Normalized capabilities backed by confirmed evidence, out of all normalized capabilities."),
    operational: dim(2, 2, "Products with at least one fully current capability, out of all portfolio products."),
    verification: dim(1, 1, "Confirmed capabilities with runtime, usage, or deployment evidence, out of all confirmed capabilities."),
    integration: dim(1, 2, "Cross-product relationships resolved to a specific type, out of all detected cross-product relationship evidence."),
    ownership: dim(0, 1, "Multi-product capabilities with a clearly resolved lead, out of all multi-product capabilities."),
    runtimeEvidence: dim(2, 2, "Products with at least one capability verified by runtime, usage, or deployment evidence, out of all portfolio products."),
    coherence: dim(2, 2, "Products with no unresolved material or strategic capability overlap, out of all portfolio products."),
  };

  const operatingModel: PortfolioOperatingModel = {
    stages: [{ stage: "build", productIds: [productA.id, productB.id], capabilityIds: [sharedCap.id], inferred: true }],
    transitions: [],
    unassignedProductIds: [],
  };

  const evidence: PortfolioEvidence[] = [{ id: "portfolio:evidence:capability:product-a:0", sourceType: "capability", productId: productA.id, text: "Shared X: a shared capability.", confidence: "confirmed" }];

  const config: PortfolioConfig = makePortfolioConfig({ products: [{ id: "product-a", artifact_root: "./a" }, { id: "product-b", artifact_root: "./b" }] });

  return {
    portfolioId: "test-portfolio",
    displayName: "Test Portfolio",
    products: [productA, productB],
    capabilities: [sharedCap],
    relationships: [resolvedRelationship],
    unresolvedRelationships: [unresolvedRelationship],
    maturity,
    operatingModel,
    runtimeEvidenceByCapability: new Map([[sharedCap.id, true]]),
    evidence,
    config,
    ...overrides,
  };
}

describe("buildPortfolioClaims", () => {
  it("every rejected claim carries a non-empty rejectionReasons array, and every non-rejected claim carries an empty one — the core claims.ts invariant", () => {
    const { claims } = buildPortfolioClaims(buildInput());
    expect(claims.length).toBeGreaterThan(5);
    for (const claim of claims) {
      if (claim.status === "rejected") {
        expect(claim.rejectionReasons.length).toBeGreaterThan(0);
      } else {
        expect(claim.rejectionReasons).toEqual([]);
      }
    }
  });

  it("approves the portfolio identity claim when the portfolio has 2+ products", () => {
    const { claims } = buildPortfolioClaims(buildInput());
    const identityClaim = claims.find((c) => c.claimType === "identity" && c.text === "Test Portfolio is a portfolio of 2 products.");
    expect(identityClaim).toBeDefined();
    expect(identityClaim!.status).toBe("approved");
    expect(identityClaim!.rejectionReasons).toEqual([]);
  });

  it("approves a coverage claim for a capability genuinely shared (multiple unqualified participants) by more than one product", () => {
    const { claims } = buildPortfolioClaims(buildInput());
    const coverageClaim = claims.find((c) => c.claimType === "coverage" && c.text === '"Shared X" is implemented across 2 products in the portfolio.');
    expect(coverageClaim).toBeDefined();
    expect(coverageClaim!.status).toBe("approved");
    expect(coverageClaim!.rejectionReasons).toEqual([]);
  });

  it("rejects an unresolved cross-product relationship with PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP", () => {
    const { claims } = buildPortfolioClaims(buildInput());
    const unresolvedClaim = claims.find((c) => c.claimType === "relationship" && c.text.includes("could not be resolved"));
    expect(unresolvedClaim).toBeDefined();
    expect(unresolvedClaim!.status).toBe("rejected");
    expect(unresolvedClaim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP");
  });

  it("rejects a claim whose text contains a config.disallowed_claims term with PORTFOLIO_CLAIM_GENERIC_MARKETING", () => {
    const baseInput = buildInput();
    const configWithDisallowedTerm: PortfolioConfig = { ...baseInput.config!, disallowed_claims: ["compliance teams"] };
    const { claims } = buildPortfolioClaims({ ...baseInput, config: configWithDisallowedTerm });

    const disallowedClaim = claims.find((c) => c.claimType === "identity" && c.text === "Product A: Alpha platform for compliance teams.");
    expect(disallowedClaim).toBeDefined();
    expect(disallowedClaim!.status).toBe("rejected");
    expect(disallowedClaim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_GENERIC_MARKETING");

    // A claim whose text does not contain the disallowed term is unaffected.
    const unaffectedClaim = claims.find((c) => c.claimType === "identity" && c.text === "Product B: Beta platform for operations teams.");
    expect(unaffectedClaim!.status).toBe("approved");
  });

  it("rejects a coverage claim with no evidenceIds with PORTFOLIO_CLAIM_UNSUPPORTED", () => {
    const baseInput = buildInput();
    const unsupportedCap: PortfolioCapability = { ...baseInput.capabilities[0]!, id: "portfolio:capability:unsupported", displayName: "Unsupported Cap", evidenceIds: [] };
    const { claims } = buildPortfolioClaims({ ...baseInput, capabilities: [...baseInput.capabilities, unsupportedCap] });

    const unsupportedClaim = claims.find((c) => c.claimType === "coverage" && c.text.includes("Unsupported Cap"));
    expect(unsupportedClaim).toBeDefined();
    expect(unsupportedClaim!.status).toBe("rejected");
    expect(unsupportedClaim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_UNSUPPORTED");
  });

  it("is deterministic: two builds of the same input produce byte-identical output", () => {
    const input = buildInput();
    const a = buildPortfolioClaims(input);
    const b = buildPortfolioClaims(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns claims sorted deterministically by id", () => {
    const { claims } = buildPortfolioClaims(buildInput());
    const ids = claims.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
