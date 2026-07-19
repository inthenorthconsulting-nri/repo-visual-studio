import type { CapabilityModel } from "@rvs/capability-intelligence";
import { describe, expect, it } from "vitest";
import { capabilityRefKey } from "../capability-normalization.js";
import type { PortfolioCapability, PortfolioOverlap, PortfolioProduct, PortfolioProductRelationship } from "../contracts.js";
import { buildMaturitySummary } from "../maturity.js";
import { makeCapability, makeCapabilityEvidence, makeCapabilityModel, makePortfolioProduct } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Fixture: 3 products (A, B, C), 3 normalized capabilities.
//
//  - cap-shared-unresolved: coverage "shared", confidence "confirmed",
//    participation [A(unqualified), B(unqualified)] -> ownership NOT
//    resolved (2 unqualified current participants). Backed, via product A's
//    real CapabilityModel, by a capability whose evidence includes "usage"
//    (runtime-flavored) -> runtime evidence TRUE for this capability.
//  - cap-single: coverage "single_product", confidence "confirmed",
//    participation [A(unqualified)]. Backed by a second real capability on
//    product A whose evidence is "implementation" only -> runtime evidence
//    FALSE for this capability.
//  - cap-overlap-resolved: coverage "overlapping", confidence "derived",
//    participation [A(unqualified), B(qualified)] -> ownership resolved
//    (exactly 1 unqualified current participant). Not confirmed, so it is
//    excluded from the coverage/verification numerators.
//
// Product C has no capabilities and does not participate in anything, so it
// only affects the "operational"/"runtimeEvidence"/"coherence" denominators.
// ---------------------------------------------------------------------------

function buildFixture() {
  const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" }, currentCapabilityCount: 2 });
  const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" }, currentCapabilityCount: 1 });
  const productC = makePortfolioProduct({ source: { configId: "product-c", artifactRoot: "./c", compatibility: "compatible" }, currentCapabilityCount: 0 });
  const products: PortfolioProduct[] = [productA, productB, productC];

  const sharedCapDraft = makeCapability({ sourceLabel: "Shared Cap", evidence: [makeCapabilityEvidence("usage")] });
  const soloCapDraft = makeCapability({ sourceLabel: "Solo Cap", evidence: [makeCapabilityEvidence("implementation")] });
  const modelA: CapabilityModel = makeCapabilityModel({ includedCapabilities: [sharedCapDraft, soloCapDraft] });
  const capabilityModelsByProductId = new Map([[productA.id, modelA]]);
  const productAWithRefs: PortfolioProduct = { ...productA, currentCapabilityIds: [sharedCapDraft.id, soloCapDraft.id] };

  const capShared: PortfolioCapability = {
    id: "portfolio:capability:shared-unresolved",
    displayName: "Shared Unresolved Cap",
    domain: "Widget Operations",
    coverage: "shared",
    participation: [
      { productId: productA.id, productCapabilityId: sharedCapDraft.id, productCapabilityDisplayName: sharedCapDraft.displayName, qualified: false },
      { productId: productB.id, productCapabilityId: "capB:shared", productCapabilityDisplayName: "Shared", qualified: false },
    ],
    evidenceIds: ["portfolio:evidence:capability:product-a:0"],
    confidence: "confirmed",
  };
  const capSingle: PortfolioCapability = {
    id: "portfolio:capability:solo",
    displayName: "Solo Cap",
    domain: "Widget Operations",
    coverage: "single_product",
    participation: [{ productId: productA.id, productCapabilityId: soloCapDraft.id, productCapabilityDisplayName: soloCapDraft.displayName, qualified: false }],
    evidenceIds: ["portfolio:evidence:capability:product-a:1"],
    confidence: "confirmed",
  };
  const capOverlapResolved: PortfolioCapability = {
    id: "portfolio:capability:overlap-resolved",
    displayName: "Overlap Resolved Cap",
    domain: "Widget Operations",
    coverage: "overlapping",
    participation: [
      { productId: productA.id, productCapabilityId: "capA:overlap", productCapabilityDisplayName: "Overlap", qualified: false },
      { productId: productB.id, productCapabilityId: "capB:overlap", productCapabilityDisplayName: "Overlap", qualified: true },
    ],
    evidenceIds: [],
    confidence: "derived",
  };
  const capabilities = [capShared, capSingle, capOverlapResolved];

  const refToCapabilityId = new Map([
    [capabilityRefKey({ productId: productA.id, configId: "product-a", capability: sharedCapDraft, qualified: false }), capShared.id],
    [capabilityRefKey({ productId: productA.id, configId: "product-a", capability: soloCapDraft, qualified: false }), capSingle.id],
  ]);

  const relationships: PortfolioProductRelationship[] = [
    { id: "portfolio:relationship:shared_capability:a:b", productAId: productA.id, productBId: productB.id, type: "shared_capability", confidence: "confirmed", statement: "A and B share a capability.", capabilityIds: [capShared.id], evidenceIds: [] },
  ];
  const unresolvedRelationships: PortfolioProductRelationship[] = [
    { id: "portfolio:relationship:unresolved:a:c", productAId: productA.id, productBId: productC.id, type: "unresolved", confidence: "unresolved", statement: "Relationship between A and C is unresolved.", capabilityIds: [], evidenceIds: [] },
  ];

  const overlaps: PortfolioOverlap[] = [
    { id: "portfolio:overlap:shared-unresolved", capabilityId: capShared.id, productIds: [productA.id], severity: "material", statement: "Material overlap.", ownershipResolved: false, evidenceIds: [] },
  ];

  return { products: [productAWithRefs, productB, productC], capabilityModelsByProductId, capabilities, relationships, unresolvedRelationships, overlaps, refToCapabilityId, productA, productB, productC };
}

describe("buildMaturitySummary", () => {
  it("computes the coverage dimension as confirmed capabilities out of all normalized capabilities", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    // confirmed: capShared, capSingle (2) out of 3 total capabilities.
    expect(summary.coverage.numerator).toBe(2);
    expect(summary.coverage.denominator).toBe(3);
    expect(summary.coverage.score).toBeCloseTo(2 / 3);
  });

  it("computes the operational dimension as products with currentCapabilityCount > 0", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    // A (count 2) and B (count 1) are operational; C (count 0) is not.
    expect(summary.operational.numerator).toBe(2);
    expect(summary.operational.denominator).toBe(3);
    expect(summary.operational.score).toBeCloseTo(2 / 3);
  });

  it("computes the verification dimension as confirmed capabilities with runtime/usage/deployment evidence, out of all confirmed capabilities", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    // Of the 2 confirmed capabilities, only capShared has runtime-flavored evidence (via product A's "usage" evidence).
    expect(summary.verification.numerator).toBe(1);
    expect(summary.verification.denominator).toBe(2);
    expect(summary.verification.score).toBeCloseTo(0.5);
  });

  it("computes the ownership dimension as resolved-ownership capabilities out of shared/overlapping capabilities", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    // sharedOrOverlapping: capShared (unresolved: 2 unqualified participants), capOverlapResolved (resolved: 1 unqualified participant).
    expect(summary.ownership.numerator).toBe(1);
    expect(summary.ownership.denominator).toBe(2);
    expect(summary.ownership.score).toBeCloseTo(0.5);
  });

  it("computes the integration dimension as resolved relationships out of all detected relationship evidence (resolved + unresolved)", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    expect(summary.integration.numerator).toBe(1);
    expect(summary.integration.denominator).toBe(2);
    expect(summary.integration.score).toBeCloseTo(0.5);
  });

  it("computes the coherence dimension as products with no material/strategic overlap, out of all products", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    // Only productA is in a material overlap; B and C are coherent, out of 3 products.
    expect(summary.coherence.numerator).toBe(2);
    expect(summary.coherence.denominator).toBe(3);
    expect(summary.coherence.score).toBeCloseTo(2 / 3);
  });

  it("every dimension's score equals numerator/denominator", () => {
    const f = buildFixture();
    const summary = buildMaturitySummary(f.products, f.capabilityModelsByProductId, f.capabilities, f.relationships, f.unresolvedRelationships, f.overlaps, f.refToCapabilityId);
    for (const dim of Object.values(summary)) {
      expect(dim.score).toBeCloseTo(dim.denominator === 0 ? 0 : dim.numerator / dim.denominator);
    }
  });

  it("a dimension's score is exactly 0 when its denominator is 0, never NaN or Infinity", () => {
    const summary = buildMaturitySummary([], new Map(), [], [], [], [], new Map());
    for (const dim of Object.values(summary)) {
      expect(dim.denominator).toBe(0);
      expect(dim.score).toBe(0);
    }
  });
});
