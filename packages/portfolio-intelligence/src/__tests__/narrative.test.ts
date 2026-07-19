import { describe, expect, it } from "vitest";
import type { PortfolioClaim, PortfolioGap, PortfolioOperatingModel, PortfolioProductRelationship } from "../contracts.js";
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

describe("buildPortfolioNarrative — zero-relationship portfolio (conservative fallback across every section)", () => {
  it("productRelationships states '0 ... resolved ... 0 remain unresolved' plainly, never inventing a relationship type or an integration story out of an empty relationships array", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" }, displayName: "Product A" });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" }, displayName: "Product B" });

    const narrative = buildPortfolioNarrative("Test Portfolio", [productA, productB], [], [], [], EMPTY_OPERATING_MODEL, [], []);

    expect(narrative.productRelationships).toBe("0 cross-product relationships resolved to a specific type; 0 remain unresolved and are not asserted as any specific relationship.");
  });

  it("with 2 products, zero capabilities, zero relationships (resolved or unresolved), zero gaps, and zero claims, every one of the 8 narrative sections is exactly its documented no-evidence fallback sentence -- nothing is invented to fill the gap", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" }, displayName: "Product A" });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" }, displayName: "Product B" });

    const narrative = buildPortfolioNarrative("Test Portfolio", [productA, productB], [], [], [], EMPTY_OPERATING_MODEL, [], []);

    // mission: falls back to a plain, computed product-count sentence (no invented claim text) since no identity claim was approved.
    expect(narrative.mission).toBe("Test Portfolio is a portfolio of 2 products.");
    // productsAndRoles: no identity claims approved for either product, so each sentence is role-only, never a fabricated descriptor.
    expect(narrative.productsAndRoles).toBe(`Product A is classified as a ${productA.primaryRole.replace(/_/g, " ")}. Product B is classified as a ${productB.primaryRole.replace(/_/g, " ")}.`);
    expect(narrative.sharedOperatingModel).toBe("No products are currently assigned to an inferred operating-model stage.");
    // capabilityCoverage: no approved coverage claim exists, but the section always states the computed
    // distinct/shared counts plainly (here 0 and 0) rather than falling back to a vaguer sentence -- the
    // "No capability coverage..." fallback is only reachable when even the computed sentence is empty,
    // which never happens since it is unconditionally generated from capabilities.length.
    expect(narrative.capabilityCoverage).toBe("The portfolio's normalized capability set contains 0 distinct capabilities, of which 0 are implemented by more than one product.");
    expect(narrative.productRelationships).toBe("0 cross-product relationships resolved to a specific type; 0 remain unresolved and are not asserted as any specific relationship.");
    expect(narrative.proofAndMaturity).toBe("0 confirmed capabilities are backed by runtime, usage, or deployment evidence.");
    expect(narrative.gapsAndDecisions).toBe("No structural gaps were detected from the evidence currently available.");
    // strategicDirection: with zero gaps, only the fixed conservative-framing sentence is emitted -- no
    // second sentence inventing a gap/ownership count that doesn't exist.
    expect(narrative.strategicDirection).toBe(
      "This portfolio is presented strictly by what current evidence supports; unresolved relationships, unverified runtime claims, and unresolved ownership remain visibly marked rather than folded into the current-state story.",
    );
    expect(narrative.approvedClaims).toEqual([]);
    expect(narrative.rejectedClaims).toEqual([]);
    expect(narrative.runtimeVerificationClaims).toEqual([]);
  });

  it("productRelationships reports the true resolved/unresolved split (1 resolved, 2 unresolved) without rounding, merging, or dropping either count", () => {
    const relationship: PortfolioProductRelationship = {
      id: "portfolio:relationship:shared_capability:a:b",
      productAId: "portfolio:product:a",
      productBId: "portfolio:product:b",
      type: "shared_capability",
      confidence: "confirmed",
      statement: "A and B share a capability.",
      capabilityIds: [],
      evidenceIds: [],
    };
    const unresolvedX: PortfolioProductRelationship = { ...relationship, id: "portfolio:relationship:unresolved:a:c", productBId: "portfolio:product:c", statement: "A and C behavior overlaps ambiguously." };
    const unresolvedY: PortfolioProductRelationship = { ...relationship, id: "portfolio:relationship:unresolved:b:c", productAId: "portfolio:product:b", productBId: "portfolio:product:c", statement: "B and C behavior overlaps ambiguously." };

    const narrative = buildPortfolioNarrative("Test Portfolio", [], [], [relationship], [unresolvedX, unresolvedY], EMPTY_OPERATING_MODEL, [], []);

    expect(narrative.productRelationships).toBe("1 cross-product relationship resolved to a specific type; 2 remain unresolved and are not asserted as any specific relationship.");
  });
});
