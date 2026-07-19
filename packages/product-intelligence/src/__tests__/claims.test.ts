import { describe, expect, it } from "vitest";
import { buildProductClaims } from "../claims.js";
import { makeCapability, makeEmptyCapabilityModel, makeProductIdentity, makeValuePillar } from "./fixtures.js";

describe("buildProductClaims", () => {
  it("every rejected claim carries a non-empty rejectionReasons array — the core claims.ts invariant", () => {
    const identity = makeProductIdentity({ purpose: "This is a next-generation, ai-powered platform." });
    const model = makeEmptyCapabilityModel();
    const claims = buildProductClaims(identity, model);
    for (const claim of claims) {
      if (claim.status === "rejected") {
        expect(claim.rejectionReasons.length).toBeGreaterThan(0);
      } else {
        expect(claim.rejectionReasons).toEqual([]);
      }
    }
  });

  it("rejects generic marketing language (GENERIC_MARKETING_TERMS) with SHOWCASE_CLAIM_GENERIC_MARKETING", () => {
    const identity = makeProductIdentity({ purpose: "This is an ai-powered platform for compliance officers." });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel());
    const purposeClaim = claims.find((c) => c.id === "prodintel:claim:purpose:purpose");
    expect(purposeClaim!.status).toBe("rejected");
    expect(purposeClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_GENERIC_MARKETING");
  });

  it("rejects absolute-superiority language (ABSOLUTE_SUPERIORITY_TERMS) with SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE", () => {
    const identity = makeProductIdentity({ purpose: "This is the only platform better than every competitor for compliance officers." });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel());
    const purposeClaim = claims.find((c) => c.id === "prodintel:claim:purpose:purpose");
    expect(purposeClaim!.status).toBe("rejected");
    expect(purposeClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE");
  });

  it("never promotes a capability that only exists in roadmapCapabilities: the capability claim is rejected with SHOWCASE_CLAIM_ROADMAP_PROMOTED", () => {
    const roadmapCap = makeCapability({ sourceLabel: "Widget Auto Remediation", inclusion: "roadmap_only", status: "planned" });
    const pillar = makeValuePillar({ includedCapabilityIds: [roadmapCap.id], qualifiedCapabilityIds: [] });
    const identity = makeProductIdentity({ valuePillars: [pillar] });
    // Forced in artificially: the model's includedCapabilities is made to contain the
    // roadmap-only capability object so claims.ts's capability-draft lookup finds it,
    // exactly like an implementation bug that promoted a roadmap item would look.
    const model = makeEmptyCapabilityModel({ includedCapabilities: [roadmapCap], roadmapCapabilities: [roadmapCap] });

    const claims = buildProductClaims(identity, model);
    const capabilityClaim = claims.find((c) => c.claimType === "capability");
    expect(capabilityClaim).toBeDefined();
    expect(capabilityClaim!.status).toBe("rejected");
    expect(capabilityClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_ROADMAP_PROMOTED");
  });

  it("never promotes a capability that only exists in excludedCandidates: the capability claim is rejected with SHOWCASE_CLAIM_EXCLUDED_CAPABILITY", () => {
    const excludedAsIncluded = makeCapability({ sourceLabel: "Widget Scratch Cli", status: "scaffolded" });
    const pillar = makeValuePillar({ includedCapabilityIds: [excludedAsIncluded.id], qualifiedCapabilityIds: [] });
    const identity = makeProductIdentity({ valuePillars: [pillar] });
    const model = makeEmptyCapabilityModel({
      includedCapabilities: [excludedAsIncluded],
      excludedCandidates: [{ id: excludedAsIncluded.id, displayName: excludedAsIncluded.displayName, sourceLabel: excludedAsIncluded.naming.sourceLabel, granularity: "capability", status: "scaffolded", confidence: "unresolved", readiness: excludedAsIncluded.readiness, reasonCodes: ["SCAFFOLD_ONLY"], reasonSummary: "scaffold only", evidence: [] }],
    });

    const claims = buildProductClaims(identity, model);
    const capabilityClaim = claims.find((c) => c.claimType === "capability");
    expect(capabilityClaim!.status).toBe("rejected");
    expect(capabilityClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_EXCLUDED_CAPABILITY");
  });

  it("marks a capability claim for a qualified capability as approved_with_qualification, with a qualifier explaining the partial evidence", () => {
    const qualifiedCap = makeCapability({ sourceLabel: "Widget Report Export", inclusion: "include_with_qualification", status: "partial" });
    const pillar = makeValuePillar({ includedCapabilityIds: [], qualifiedCapabilityIds: [qualifiedCap.id] });
    const identity = makeProductIdentity({ valuePillars: [pillar] });
    const model = makeEmptyCapabilityModel({ qualifiedCapabilities: [qualifiedCap] });

    const claims = buildProductClaims(identity, model);
    const capabilityClaim = claims.find((c) => c.claimType === "capability");
    expect(capabilityClaim!.status).toBe("approved_with_qualification");
    expect(capabilityClaim!.qualifiers.length).toBeGreaterThan(0);
    expect(capabilityClaim!.rejectionReasons).toEqual([]);
  });

  it("rejects scale/adoption-shaped drafts unless sourced from an override runtime claim", () => {
    // The only source of scale/adoption claimType drafts inside claims.ts itself
    // is override.runtime_claims — verify one is approved-or-held (never silently
    // "approved" outright) when supplied, and never appears at all otherwise.
    const identity = makeProductIdentity();
    const model = makeEmptyCapabilityModel();
    const claimsWithoutOverride = buildProductClaims(identity, model);
    expect(claimsWithoutOverride.some((c) => c.claimType === "scale" || c.claimType === "adoption")).toBe(false);

    const claimsWithOverride = buildProductClaims(identity, model, { schema_version: 1, runtime_claims: ["Adopted by 40 internal teams."] });
    const runtimeClaim = claimsWithOverride.find((c) => c.claimType === "adoption");
    expect(runtimeClaim).toBeDefined();
    expect(runtimeClaim!.status).toBe("runtime_verification_required");
    expect(runtimeClaim!.qualifiers.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate claim text (second occurrence) with SHOWCASE_CLAIM_DUPLICATE", () => {
    const pillarA = makeValuePillar({ id: "prodintel:pillar:a", title: "Widget Operations", explanation: "Same explanation text.", includedCapabilityIds: [], qualifiedCapabilityIds: [] });
    const pillarB = makeValuePillar({ id: "prodintel:pillar:b", title: "Widget Operations", explanation: "Same explanation text.", includedCapabilityIds: [], qualifiedCapabilityIds: [] });
    const identity = makeProductIdentity({ valuePillars: [pillarA, pillarB] });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel());
    const outcomeClaims = claims.filter((c) => c.claimType === "outcome");
    expect(outcomeClaims).toHaveLength(2);
    const rejected = outcomeClaims.find((c) => c.status === "rejected");
    expect(rejected).toBeDefined();
    expect(rejected!.rejectionReasons).toContain("SHOWCASE_CLAIM_DUPLICATE");
  });

  it("rejects a claim whose text contains a raw technical token (path-like or camelCase identifier) with SHOWCASE_CLAIM_TOO_TECHNICAL", () => {
    const identity = makeProductIdentity({ purpose: "Runs packages/widget-sync/src/index.ts for compliance officers." });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel());
    const purposeClaim = claims.find((c) => c.id === "prodintel:claim:purpose:purpose");
    expect(purposeClaim!.status).toBe("rejected");
    expect(purposeClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_TOO_TECHNICAL");
  });

  it("rejects a non-maturity claim with no evidence ids with SHOWCASE_CLAIM_UNSUPPORTED", () => {
    const differentiator = { id: "prodintel:differentiator:x", title: "Something distinctive", description: "A structural distinction.", basis: ["cross_cutting_property" as const], supportingCapabilityIds: [], evidenceIds: [], confidence: "confirmed" as const };
    const identity = makeProductIdentity({ differentiators: [differentiator] });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel());
    const diffClaim = claims.find((c) => c.claimType === "differentiator");
    expect(diffClaim!.status).toBe("rejected");
    expect(diffClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_UNSUPPORTED");
  });

  it("always includes exactly one maturity claim, approved even with zero evidenceIds (maturity is exempt from the unsupported-evidence check)", () => {
    const model = makeEmptyCapabilityModel({ evidenceSummary: { totalCandidates: 5, includedCount: 3, qualifiedCount: 2, excludedCount: 0, roadmapCount: 0, gapCount: 0, unresolvedCount: 0, evidenceTypeCounts: {}, confidence: { confirmed: 5, derived: 0, suggested: 0, unresolved: 0, total: 5 } } });
    const claims = buildProductClaims(makeProductIdentity(), model);
    const maturityClaims = claims.filter((c) => c.claimType === "maturity");
    expect(maturityClaims).toHaveLength(1);
    expect(maturityClaims[0]!.status).toBe("approved");
    expect(maturityClaims[0]!.text).toContain("3 of 5");
  });

  it("returns claims sorted deterministically by id", () => {
    const claims = buildProductClaims(makeProductIdentity(), makeEmptyCapabilityModel());
    const ids = claims.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("is deterministic: two builds of the same input produce byte-identical output", () => {
    const identity = makeProductIdentity();
    const model = makeEmptyCapabilityModel();
    const a = buildProductClaims(identity, model);
    const b = buildProductClaims(identity, model);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("approved_terms lifts SHOWCASE_CLAIM_GENERIC_MARKETING/ABSOLUTE_LANGUAGE for the identity/purpose claims only", () => {
    const identity = makeProductIdentity({ descriptor: "the only next-generation platform", purpose: "This is the only next-generation platform for compliance officers." });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel(), { schema_version: 1, approved_terms: ["next-generation", "the only"] });
    const identityClaim = claims.find((c) => c.claimType === "identity");
    const purposeClaim = claims.find((c) => c.claimType === "purpose");
    expect(identityClaim!.status).toBe("approved");
    expect(identityClaim!.rejectionReasons).toEqual([]);
    expect(purposeClaim!.status).toBe("approved");
    expect(purposeClaim!.rejectionReasons).toEqual([]);
  });

  it("approved_terms never lifts the check for evidence-derived claim types (outcome/capability/differentiator)", () => {
    const pillar = makeValuePillar({ title: "Widget Operations", explanation: "This is the only next-generation capability.", includedCapabilityIds: [], qualifiedCapabilityIds: [] });
    const identity = makeProductIdentity({ valuePillars: [pillar] });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel(), { schema_version: 1, approved_terms: ["next-generation", "the only"] });
    const outcomeClaim = claims.find((c) => c.claimType === "outcome");
    expect(outcomeClaim!.status).toBe("rejected");
    expect(outcomeClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_GENERIC_MARKETING");
    expect(outcomeClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE");
  });

  it("approved_terms does not suppress an unapproved marketing term in the same identity claim", () => {
    const identity = makeProductIdentity({ descriptor: "a cutting-edge platform" });
    const claims = buildProductClaims(identity, makeEmptyCapabilityModel(), { schema_version: 1, approved_terms: ["ai-powered"] });
    const identityClaim = claims.find((c) => c.claimType === "identity");
    expect(identityClaim!.status).toBe("rejected");
    expect(identityClaim!.rejectionReasons).toContain("SHOWCASE_CLAIM_GENERIC_MARKETING");
  });
});
