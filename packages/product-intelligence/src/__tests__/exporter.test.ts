import { describe, expect, it } from "vitest";
import type { ProductIdentityCandidate, ProductIdentityModel, ShowcasePlan } from "../contracts.js";
import { exportExecutiveNarrativeJson, exportProductIdentityCandidatesJson, exportProductIdentityJson, exportShowcaseClaimsJson, exportShowcasePlanJson, explainClaim } from "../exporter.js";
import { makeExecutiveNarrative, makeProductClaim, makeProductIdentity } from "./fixtures.js";

function makeIdentityModel(): ProductIdentityModel {
  return {
    schemaVersion: 1,
    identity: makeProductIdentity(),
    candidates: [],
    archetypeScores: [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [] }],
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: 1,
      source_capability_model_generated_at: "2026-07-01T00:00:00.000Z",
      assist_used: false,
      overrideApplied: false,
      candidateCount: 1,
    },
  };
}

describe("exporter round-trips", () => {
  it("exportProductIdentityJson produces valid, parseable JSON that deep-equals the input model", () => {
    const model = makeIdentityModel();
    const json = exportProductIdentityJson(model);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(model);
  });

  it("exportProductIdentityCandidatesJson produces valid, parseable JSON", () => {
    const candidates: ProductIdentityCandidate[] = [
      {
        id: "prodintel:candidate:governance_platform",
        displayName: "Widget Platform",
        archetype: "governance_platform",
        purpose: "Governance and compliance platform",
        primaryUsers: ["Compliance Officer"],
        valuePillars: [],
        differentiators: [],
        evidence: [],
        confidence: "confirmed",
        score: 2,
      },
    ];
    const json = exportProductIdentityCandidatesJson(candidates);
    expect(JSON.parse(json)).toEqual(candidates);
  });

  it("exportExecutiveNarrativeJson produces valid, parseable JSON", () => {
    const narrative = makeExecutiveNarrative();
    const json = exportExecutiveNarrativeJson(narrative);
    expect(JSON.parse(json)).toEqual(narrative);
  });

  it("exportShowcaseClaimsJson serializes rejected claims verbatim (never filters them out on export)", () => {
    const claims = [makeProductClaim({ status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_GENERIC_MARKETING"] }), makeProductClaim({ id: "prodintel:claim:identity:other", status: "approved" })];
    const json = exportShowcaseClaimsJson(claims);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe("rejected");
    expect(parsed[0].rejectionReasons).toEqual(["SHOWCASE_CLAIM_GENERIC_MARKETING"]);
  });

  it("exportShowcasePlanJson produces valid, parseable JSON matching the input plan", () => {
    // A structurally minimal ShowcasePlan is built directly in showcase-plan.test.ts;
    // here we only need a value shaped enough to prove round-trip fidelity, so we
    // reuse identity + a bare-bones plan shape.
    const plan: ShowcasePlan = {
      schemaVersion: 1,
      identity: makeProductIdentity(),
      narrative: makeExecutiveNarrative(),
      scenes: [],
      metrics: [],
      evidenceSummary: { totalEvidence: 0, confirmedCount: 0, derivedCount: 0, runtimeUnverifiedCount: 0, approvedClaimCount: 0, qualifiedClaimCount: 0, rejectedClaimCount: 0, runtimeVerificationClaimCount: 0 },
      generationMetadata: {
        generated_at: "2026-07-01T00:00:00.000Z",
        git_commit: "abc1234",
        schema_version: 1,
        source_product_identity_generated_at: "2026-07-01T00:00:00.000Z",
        assist_used: false,
        audience: "executive",
        theme: "default",
        evidenceMode: "visible",
        sceneCount: 0,
      },
    };
    const json = exportShowcasePlanJson(plan);
    expect(JSON.parse(json)).toEqual(plan);
  });
});

describe("explainClaim", () => {
  it("includes the claim id, status, and text for an approved claim with no qualifiers or rejection reasons", () => {
    const claim = makeProductClaim({ status: "approved", qualifiers: [], rejectionReasons: [] });
    const text = explainClaim(claim);
    expect(text).toContain(`Claim: ${claim.text}`);
    expect(text).toContain(`id: ${claim.id}`);
    expect(text).toContain(`status: approved`);
    expect(text).not.toContain("qualifiers:");
    expect(text).not.toContain("rejection reasons:");
  });

  it("includes each qualifier line for an approved_with_qualification claim", () => {
    const claim = makeProductClaim({ status: "approved_with_qualification", qualifiers: ["Evidence for this capability is partial; treat as qualified, not fully verified."] });
    const text = explainClaim(claim);
    expect(text).toContain("qualifiers:");
    expect(text).toContain("- Evidence for this capability is partial; treat as qualified, not fully verified.");
  });

  it("includes each rejection reason line for a rejected claim", () => {
    const claim = makeProductClaim({ status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_GENERIC_MARKETING", "SHOWCASE_CLAIM_DUPLICATE"] });
    const text = explainClaim(claim);
    expect(text).toContain("rejection reasons:");
    expect(text).toContain("- SHOWCASE_CLAIM_GENERIC_MARKETING");
    expect(text).toContain("- SHOWCASE_CLAIM_DUPLICATE");
  });

  it("lists every evidence id, or '(none recorded)' when there are none", () => {
    const withEvidence = makeProductClaim({ evidenceIds: ["prodintel:evidence:a:1", "prodintel:evidence:b:2"] });
    const withEvidenceText = explainClaim(withEvidence);
    expect(withEvidenceText).toContain("- prodintel:evidence:a:1");
    expect(withEvidenceText).toContain("- prodintel:evidence:b:2");

    const withoutEvidence = makeProductClaim({ evidenceIds: [] });
    const withoutEvidenceText = explainClaim(withoutEvidence);
    expect(withoutEvidenceText).toContain("(none recorded)");
  });
});
