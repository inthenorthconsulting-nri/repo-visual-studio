import { describe, expect, it } from "vitest";
import type { PortfolioClaim, PortfolioGap, PortfolioOperatingModel } from "../contracts.js";
import { buildPortfolioNarrative } from "../narrative.js";
import { makePortfolioProduct } from "./fixtures.js";

const EMPTY_OPERATING_MODEL: PortfolioOperatingModel = { stages: [], transitions: [], unassignedProductIds: [] };

function claim(overrides: Partial<PortfolioClaim> & Pick<PortfolioClaim, "id" | "text" | "claimType" | "status">): PortfolioClaim {
  return { evidenceIds: [], qualifiers: [], rejectionReasons: overrides.status === "rejected" ? ["PORTFOLIO_CLAIM_UNSUPPORTED"] : [], ...overrides };
}

describe("buildPortfolioNarrative", () => {
  it("never lets a rejected claim's text appear anywhere in the narrative's sections — only approved/approved_with_qualification claims feed the sections", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" }, displayName: "Product A" });
    const approvedIdentity = claim({ id: "portfolio:claim:identity:portfolio", text: "Test Portfolio is a portfolio of 1 product.", claimType: "identity", status: "approved" });
    const rejectedCoverage = claim({ id: "portfolio:claim:coverage:x", text: "UNIQUE_REJECTED_MARKER_TEXT_9182", claimType: "coverage", status: "rejected" });

    const narrative = buildPortfolioNarrative("Test Portfolio", [productA], [], [], [], EMPTY_OPERATING_MODEL, [], [approvedIdentity, rejectedCoverage]);

    const sections = [
      narrative.mission,
      narrative.productsAndRoles,
      narrative.sharedOperatingModel,
      narrative.capabilityCoverage,
      narrative.productRelationships,
      narrative.proofAndMaturity,
      narrative.gapsAndDecisions,
      narrative.strategicDirection,
    ];
    for (const section of sections) expect(section).not.toContain("UNIQUE_REJECTED_MARKER_TEXT_9182");
    expect(narrative.rejectedClaims.map((c) => c.id)).toEqual([rejectedCoverage.id]);
  });

  it("gapsAndDecisions reports gap counts and types directly from the gaps array, even when there are zero approved claims", () => {
    const gapA: PortfolioGap = { id: "portfolio:gap:runtime_verification_gap:x", type: "runtime_verification_gap", statement: "X is confirmed by static evidence only.", affectedProductIds: [], capabilityId: "portfolio:capability:x", evidenceIds: [] };
    const gapB: PortfolioGap = { id: "portfolio:gap:unowned_capability:y", type: "unowned_capability", statement: "Ownership of Y is unresolved.", affectedProductIds: [], capabilityId: "portfolio:capability:y", evidenceIds: [] };

    // No claims at all — nothing is approved — yet gapsAndDecisions must still report the gaps, because
    // gaps.ts facts are already-validated structural facts cited directly, not gated through claims.ts.
    const narrative = buildPortfolioNarrative("Test Portfolio", [], [], [], [], EMPTY_OPERATING_MODEL, [gapA, gapB], []);

    expect(narrative.gapsAndDecisions).toBe("2 gaps detected: 1 runtime verification gap, 1 unowned capability.");
    expect(narrative.approvedClaims).toEqual([]);
  });

  it("reports the zero-gap fallback sentence when there are no gaps", () => {
    const narrative = buildPortfolioNarrative("Test Portfolio", [], [], [], [], EMPTY_OPERATING_MODEL, [], []);
    expect(narrative.gapsAndDecisions).toBe("No structural gaps were detected from the evidence currently available.");
  });

  it("mission quotes the approved portfolio identity claim verbatim when present", () => {
    const approvedIdentity = claim({ id: "portfolio:claim:identity:portfolio", text: "Test Portfolio is a portfolio of 2 products.", claimType: "identity", status: "approved" });
    const narrative = buildPortfolioNarrative("Test Portfolio", [], [], [], [], EMPTY_OPERATING_MODEL, [], [approvedIdentity]);
    expect(narrative.mission).toBe("Test Portfolio is a portfolio of 2 products.");
  });

  it("productsAndRoles prefixes a product's approved identity text only when that exact text was approved; otherwise it states only the inferred role", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" }, displayName: "Product A", descriptor: "Alpha platform.", primaryRole: "governance_system" });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" }, displayName: "Product B", descriptor: "Beta platform.", primaryRole: "operations_system" });
    const approvedIdentityA = claim({ id: "portfolio:claim:identity:a", text: "Product A: Alpha platform.", claimType: "identity", status: "approved" });

    const narrative = buildPortfolioNarrative("Test Portfolio", [productA, productB], [], [], [], EMPTY_OPERATING_MODEL, [], [approvedIdentityA]);

    expect(narrative.productsAndRoles).toContain("Product A: Alpha platform. Product A is classified as a governance system.");
    expect(narrative.productsAndRoles).toContain("Product B is classified as a operations system.");
    expect(narrative.productsAndRoles).not.toContain("Product B: Beta platform.");
  });

  it("splits claims into approvedClaims/rejectedClaims/runtimeVerificationClaims buckets, each sorted by id", () => {
    const approved = claim({ id: "portfolio:claim:identity:portfolio", text: "Test Portfolio is a portfolio of 1 product.", claimType: "identity", status: "approved" });
    const qualified = claim({ id: "portfolio:claim:coverage:a", text: "Coverage text.", claimType: "coverage", status: "approved_with_qualification", qualifiers: ["Partial evidence."] });
    const rejected = claim({ id: "portfolio:claim:ownership:x", text: "Rejected ownership text.", claimType: "ownership", status: "rejected" });
    const runtime = claim({ id: "portfolio:claim:adoption:x", text: "Adoption claim text.", claimType: "adoption", status: "runtime_verification_required" });

    const narrative = buildPortfolioNarrative("Test Portfolio", [], [], [], [], EMPTY_OPERATING_MODEL, [], [approved, qualified, rejected, runtime]);

    expect(narrative.approvedClaims.map((c) => c.id)).toEqual([approved.id, qualified.id].sort((a, b) => a.localeCompare(b)));
    expect(narrative.rejectedClaims.map((c) => c.id)).toEqual([rejected.id]);
    expect(narrative.runtimeVerificationClaims.map((c) => c.id)).toEqual([runtime.id]);
  });
});
