import { describe, expect, it } from "vitest";
import type { BuildPortfolioClaimsInput, ClaimDraft } from "../claims.js";
import { buildPortfolioClaims, classifyDraft } from "../claims.js";
import type { PortfolioCapability, PortfolioConfig, PortfolioEvidence, PortfolioMaturitySummary, PortfolioOperatingModel, PortfolioProductRelationship } from "../contracts.js";
import { makePortfolioConfig, makePortfolioProduct } from "./fixtures.js";

function baseDraft(overrides: Partial<ClaimDraft> = {}): ClaimDraft {
  return { subjectId: "test-subject", claimType: "coverage", text: "A plain, unremarkable claim about coverage.", evidenceIds: ["portfolio:evidence:x:0"], ...overrides };
}

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

// ---------------------------------------------------------------------------
// classifyDraft — one isolated test per rejection-reason trigger, covering all
// 12 codes contracts.ts's PortfolioClaimRejectionReasonCode union defines.
// 4 of the 12 (the claim-type-specific PORTFOLIO_CLAIM_UNSUPPORTED_{SCALE,
// ADOPTION,INTEGRATION,UNIFICATION} codes) are only ever produced by
// buildPortfolioClaims's augmentRejectionReasons step, which re-maps the
// generic UNSUPPORTED classifyDraft emits — those four are covered separately
// below at the buildPortfolioClaims level, where that remapping actually runs.
// PORTFOLIO_CLAIM_ROADMAP_PROMOTED has no current draft-builder that ever
// sets isRoadmapOnly (no draft* function in claims.ts wires it up) — it is
// reserved, not fabricated, the same disclosed-scope-trim pattern documented
// for the "deprecation" PortfolioDecisionType — so classifyDraft is the ONLY
// place this code is reachable from at all, unit-level or otherwise.
// ---------------------------------------------------------------------------

describe("classifyDraft — unit coverage of every rejection-reason trigger", () => {
  it("PORTFOLIO_CLAIM_UNSUPPORTED fires when a draft has zero evidence ids", () => {
    const result = classifyDraft(baseDraft({ evidenceIds: [] }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED fires when a draft's normalized text was already seen (duplicate claim), even with evidence attached", () => {
    const seen = new Set(["a plain, unremarkable claim about coverage."]);
    const result = classifyDraft(baseDraft(), seen, []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED"]);
  });

  it("PORTFOLIO_CLAIM_GENERIC_MARKETING fires when the text contains a config-supplied disallowed term", () => {
    const result = classifyDraft(baseDraft({ text: "Widget-sync serves enterprise customers at scale." }), new Set(), ["enterprise customers"]);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toContain("PORTFOLIO_CLAIM_GENERIC_MARKETING");
  });

  it("PORTFOLIO_CLAIM_GENERIC_MARKETING fires when the text contains a built-in generic marketing term (e.g. 'revolutionary')", () => {
    const result = classifyDraft(baseDraft({ text: "This is a revolutionary approach to widget sync." }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toContain("PORTFOLIO_CLAIM_GENERIC_MARKETING");
  });

  it("PORTFOLIO_CLAIM_GENERIC_MARKETING fires when the text contains a built-in absolute-superiority term (e.g. 'best-in-class')", () => {
    const result = classifyDraft(baseDraft({ text: "Widget-sync is best-in-class among portfolio capabilities." }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toContain("PORTFOLIO_CLAIM_GENERIC_MARKETING");
  });

  it("PORTFOLIO_CLAIM_ROADMAP_PROMOTED fires when a draft is marked roadmap-only (reserved code — no current draft-builder sets this flag, so this is the only place it is reachable from)", () => {
    const result = classifyDraft(baseDraft({ isRoadmapOnly: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_ROADMAP_PROMOTED"]);
  });

  it("PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP fires when a draft requires a resolved relationship it doesn't have", () => {
    const result = classifyDraft(baseDraft({ requiresResolvedRelationship: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP fires when a draft requires resolved ownership it doesn't have", () => {
    const result = classifyDraft(baseDraft({ requiresResolvedOwnership: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP"]);
  });

  it("PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY fires when a draft implies double-counting a shared capability", () => {
    const result = classifyDraft(baseDraft({ impliesDoubleCounting: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY"]);
  });

  it("PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED fires when a draft asserts full implementation of a capability that is only qualified", () => {
    const result = classifyDraft(baseDraft({ assertsUnqualifiedButIsQualified: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED"]);
  });

  it("PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED fires when a draft requires runtime evidence it doesn't have", () => {
    const result = classifyDraft(baseDraft({ requiresRuntimeEvidence: true }), new Set(), []);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED"]);
  });

  it("collects every triggered reason at once when multiple flags fire simultaneously — none is dropped in favor of another", () => {
    const result = classifyDraft(
      baseDraft({ evidenceIds: [], isRoadmapOnly: true, requiresResolvedRelationship: true, requiresResolvedOwnership: true, impliesDoubleCounting: true, assertsUnqualifiedButIsQualified: true, requiresRuntimeEvidence: true }),
      new Set(),
      [],
    );
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons).toEqual([
      "PORTFOLIO_CLAIM_UNSUPPORTED",
      "PORTFOLIO_CLAIM_ROADMAP_PROMOTED",
      "PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP",
      "PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP",
      "PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY",
      "PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED",
      "PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED",
    ]);
  });

  it("rejection always wins over runtime-verification-required, even when both a rejection flag and isOverrideRuntimeClaim are set", () => {
    const result = classifyDraft(baseDraft({ evidenceIds: [], isOverrideRuntimeClaim: true }), new Set(), []);
    expect(result.status).toBe("rejected");
  });

  it("with no rejection flags and isOverrideRuntimeClaim set, status is runtime_verification_required, not approved", () => {
    const result = classifyDraft(baseDraft({ isOverrideRuntimeClaim: true }), new Set(), []);
    expect(result.status).toBe("runtime_verification_required");
    expect(result.rejectionReasons).toEqual([]);
  });

  it("with no rejection flags and a qualifierText, status is approved_with_qualification and the qualifier text is carried through verbatim", () => {
    const result = classifyDraft(baseDraft({ qualifierText: "Partial evidence only." }), new Set(), []);
    expect(result.status).toBe("approved_with_qualification");
    expect(result.qualifiers).toEqual(["Partial evidence only."]);
  });

  it("with no flags at all, status is plainly approved", () => {
    const result = classifyDraft(baseDraft(), new Set(), []);
    expect(result.status).toBe("approved");
    expect(result.rejectionReasons).toEqual([]);
    expect(result.qualifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildPortfolioClaims — the 4 claim-type-specific UNSUPPORTED_* codes, and
// the codes above re-verified through a real draft-building path (not just
// classifyDraft's boolean-flag handling) to confirm the wiring from model
// data to rejection code is itself correct, not only the classifier.
// ---------------------------------------------------------------------------

describe("buildPortfolioClaims — claim-type-specific UNSUPPORTED_* remapping (augmentRejectionReasons)", () => {
  it("PORTFOLIO_CLAIM_UNSUPPORTED_SCALE: a duplicate scale-type runtime claim (no 'adopt' in its text) is rejected with the scale-specific code, not the generic one", () => {
    const config = makePortfolioConfig({ runtime_claims: ["Widget-sync now serves 500 workspaces.", "Widget-sync now serves 500 workspaces."] });
    const { claims } = buildPortfolioClaims({ ...buildInput(), config });
    const first = claims.find((c) => c.text === "Widget-sync now serves 500 workspaces." && c.id.endsWith("runtime-claim-0"));
    const second = claims.find((c) => c.text === "Widget-sync now serves 500 workspaces." && c.id.endsWith("runtime-claim-1"));
    expect(first!.claimType).toBe("scale");
    expect(first!.status).toBe("runtime_verification_required");
    expect(second!.status).toBe("rejected");
    expect(second!.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_SCALE"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION: a duplicate adoption-type runtime claim (text containing 'adopt') is rejected with the adoption-specific code", () => {
    const config = makePortfolioConfig({ runtime_claims: ["Adoption grew across all teams.", "Adoption grew across all teams."] });
    const { claims } = buildPortfolioClaims({ ...buildInput(), config });
    const second = claims.find((c) => c.text === "Adoption grew across all teams." && c.id.endsWith("runtime-claim-1"));
    expect(second!.claimType).toBe("adoption");
    expect(second!.status).toBe("rejected");
    expect(second!.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION: a duplicate adoption-type runtime claim (text containing 'user' but not 'adopt') is rejected with the adoption-specific code", () => {
    const config = makePortfolioConfig({ runtime_claims: ["Over 500 users rely on widget-sync daily.", "Over 500 users rely on widget-sync daily."] });
    const { claims } = buildPortfolioClaims({ ...buildInput(), config });
    const second = claims.find((c) => c.text === "Over 500 users rely on widget-sync daily." && c.id.endsWith("runtime-claim-1"));
    expect(second!.claimType).toBe("adoption");
    expect(second!.status).toBe("rejected");
    expect(second!.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION: an unevidenced shared_platform relationship (claimType 'integration') is rejected with the integration-specific code", () => {
    const baseInput = buildInput();
    const productA = baseInput.products[0]!;
    const productB = baseInput.products[1]!;
    const unevidencedIntegration: PortfolioProductRelationship = {
      id: "portfolio:relationship:shared_platform:product-a:product-b",
      productAId: productA.id,
      productBId: productB.id,
      type: "shared_platform",
      confidence: "confirmed",
      statement: "Product A and Product B share a common platform.",
      capabilityIds: [],
      evidenceIds: [],
    };
    const { claims } = buildPortfolioClaims({ ...baseInput, relationships: [...baseInput.relationships, unevidencedIntegration] });
    const claim = claims.find((c) => c.text === unevidencedIntegration.statement);
    expect(claim!.claimType).toBe("integration");
    expect(claim!.status).toBe("rejected");
    expect(claim!.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION"]);
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION: an unevidenced shared_capability relationship (claimType 'unification') is rejected with the unification-specific code", () => {
    const baseInput = buildInput();
    const productA = baseInput.products[0]!;
    const productB = baseInput.products[1]!;
    const unevidencedUnification: PortfolioProductRelationship = {
      id: "portfolio:relationship:shared_capability:product-a:product-b:2",
      productAId: productA.id,
      productBId: productB.id,
      type: "shared_capability",
      confidence: "confirmed",
      statement: "Product A and Product B both implement a second shared capability.",
      capabilityIds: [],
      evidenceIds: [],
    };
    const { claims } = buildPortfolioClaims({ ...baseInput, relationships: [...baseInput.relationships, unevidencedUnification] });
    const claim = claims.find((c) => c.text === unevidencedUnification.statement);
    expect(claim!.claimType).toBe("unification");
    expect(claim!.status).toBe("rejected");
    expect(claim!.rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION"]);
  });
});

describe("buildPortfolioClaims — the remaining structural rejection codes, exercised through real draft-building logic", () => {
  it("PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY: the portfolio-capability-total claim is rejected when summed per-product counts overcount the deduplicated capability total", () => {
    // buildInput()'s default fixture already has productA/productB each claiming currentCapabilityCount: 1
    // against a single shared capability (summed 2 != capabilities.length 1) -- this is the real, common
    // "naive sum double-counts a shared capability" scenario this code exists to catch.
    const { claims } = buildPortfolioClaims(buildInput());
    const totalClaim = claims.find((c) => c.claimType === "coverage" && c.text.startsWith("The portfolio provides"));
    expect(totalClaim!.status).toBe("rejected");
    expect(totalClaim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY");
  });

  it("the portfolio-capability-total claim is approved when summed per-product counts exactly match the deduplicated capability total (no double-counting)", () => {
    const baseInput = buildInput();
    const productA = { ...baseInput.products[0]!, currentCapabilityCount: baseInput.capabilities.length };
    const otherProducts = baseInput.products.slice(1).map((p) => ({ ...p, currentCapabilityCount: 0 }));
    const { claims } = buildPortfolioClaims({ ...baseInput, products: [productA, ...otherProducts] });
    const totalClaim = claims.find((c) => c.claimType === "coverage" && c.text.startsWith("The portfolio provides"));
    expect(totalClaim!.status).toBe("approved");
    expect(totalClaim!.rejectionReasons).toEqual([]);
  });

  it("PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED: a per-product capability claim is rejected when the participant only qualifies for (doesn't fully implement) the capability", () => {
    const baseInput = buildInput();
    const productA = baseInput.products[0]!;
    const qualifiedOnlyCap: PortfolioCapability = { ...baseInput.capabilities[0]!, id: "portfolio:capability:qualified-only", displayName: "Qualified Only Cap", participation: [{ productId: productA.id, productCapabilityId: "capA:q", productCapabilityDisplayName: "Q", qualified: true }] };
    const { claims } = buildPortfolioClaims({ ...baseInput, capabilities: [...baseInput.capabilities, qualifiedOnlyCap] });

    const claim = claims.find((c) => c.text.includes('currently implements "Qualified Only Cap"'));
    expect(claim!.status).toBe("rejected");
    expect(claim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED");
  });

  it("PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED: a runtime-verification claim for a confirmed capability is rejected when no runtime/usage/deployment evidence backs it", () => {
    const baseInput = buildInput();
    const { claims } = buildPortfolioClaims({ ...baseInput, runtimeEvidenceByCapability: new Map() });

    const claim = claims.find((c) => c.text.includes("is verified in operation by runtime"));
    expect(claim!.status).toBe("rejected");
    expect(claim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED");
  });

  it("PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP: an ownership claim is rejected when a shared capability has zero or 2+ fully-current (non-qualified) participants", () => {
    // buildInput()'s default sharedCap has 2 non-qualified participants -- ownership.ts's own rule is that
    // 2+ (as much as 0) fully-current participants makes ownership genuinely ambiguous, not resolved.
    const { claims } = buildPortfolioClaims(buildInput());
    const ownershipClaim = claims.find((c) => c.claimType === "ownership" && c.text.includes("Shared X"));
    expect(ownershipClaim!.status).toBe("rejected");
    expect(ownershipClaim!.rejectionReasons).toContain("PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP");
  });

  it("an ownership claim is approved when exactly one participant is fully current (qualified: false) and the rest are qualified-only", () => {
    const baseInput = buildInput();
    const productA = baseInput.products[0]!;
    const productB = baseInput.products[1]!;
    const resolvedCap: PortfolioCapability = { ...baseInput.capabilities[0]!, id: "portfolio:capability:resolved-owner", displayName: "Resolved Owner Cap", participation: [{ productId: productA.id, productCapabilityId: "capA:r", productCapabilityDisplayName: "R", qualified: false }, { productId: productB.id, productCapabilityId: "capB:r", productCapabilityDisplayName: "R", qualified: true }] };
    const { claims } = buildPortfolioClaims({ ...baseInput, capabilities: [...baseInput.capabilities, resolvedCap] });

    const ownershipClaim = claims.find((c) => c.claimType === "ownership" && c.text.includes("Resolved Owner Cap"));
    expect(ownershipClaim!.status).toBe("approved");
    expect(ownershipClaim!.text).toBe('Ownership of "Resolved Owner Cap" is resolved to a single current-implementing product.');
  });
});
