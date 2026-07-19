import { describe, expect, it } from "vitest";
import { exportPortfolioClaimsJson, exportPortfolioDecisionsJson, exportPortfolioModelJson, exportPortfolioNarrativeJson, exportPortfolioPlanJson, explainPortfolioClaim, explainPortfolioDecision } from "../exporter.js";
import { makePortfolioClaim, makePortfolioDecision, makePortfolioModel, makePortfolioNarrative, makePortfolioPlan } from "./fixtures.js";

describe("exporter round-trips", () => {
  it("exportPortfolioModelJson produces valid, parseable JSON that deep-equals the input model", () => {
    const model = makePortfolioModel();
    const json = exportPortfolioModelJson(model);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(model);
  });

  it("exportPortfolioClaimsJson serializes rejected claims verbatim (never filters them out on export)", () => {
    const claims = [
      makePortfolioClaim({ id: "portfolio:claim:identity:rejected", status: "rejected", rejectionReasons: ["PORTFOLIO_CLAIM_UNSUPPORTED"], evidenceIds: [] }),
      makePortfolioClaim({ id: "portfolio:claim:identity:approved", status: "approved" }),
    ];
    const json = exportPortfolioClaimsJson(claims);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe("rejected");
    expect(parsed[0].rejectionReasons).toEqual(["PORTFOLIO_CLAIM_UNSUPPORTED"]);
    expect(parsed).toEqual(claims);
  });

  it("exportPortfolioDecisionsJson produces valid, parseable JSON that deep-equals the input decisions", () => {
    const decisions = [makePortfolioDecision(), makePortfolioDecision({ id: "portfolio:decision:overlap_resolution:other", type: "overlap_resolution" })];
    const json = exportPortfolioDecisionsJson(decisions);
    expect(JSON.parse(json)).toEqual(decisions);
  });

  it("exportPortfolioNarrativeJson produces valid, parseable JSON that deep-equals the input narrative", () => {
    const narrative = makePortfolioNarrative({ approvedClaims: [makePortfolioClaim()] });
    const json = exportPortfolioNarrativeJson(narrative);
    expect(JSON.parse(json)).toEqual(narrative);
  });

  it("exportPortfolioPlanJson produces valid, parseable JSON that deep-equals the input plan", () => {
    const plan = makePortfolioPlan();
    const json = exportPortfolioPlanJson(plan);
    expect(JSON.parse(json)).toEqual(plan);
  });
});

describe("explainPortfolioClaim", () => {
  it("includes the claim id, text, and status", () => {
    const claim = makePortfolioClaim({ id: "portfolio:claim:identity:x", text: "Governance CLI governs widget operations.", status: "approved" });
    const text = explainPortfolioClaim(claim);
    expect(text).toContain("Claim: Governance CLI governs widget operations.");
    expect(text).toContain("id: portfolio:claim:identity:x");
    expect(text).toContain("status: approved");
  });

  it("includes each qualifier line for an approved_with_qualification claim", () => {
    const claim = makePortfolioClaim({ status: "approved_with_qualification", qualifiers: ["Coverage is qualified, not fully current."] });
    const text = explainPortfolioClaim(claim);
    expect(text).toContain("qualifiers:");
    expect(text).toContain("- Coverage is qualified, not fully current.");
  });

  it("includes each rejection reason line for a rejected claim", () => {
    const claim = makePortfolioClaim({ status: "rejected", rejectionReasons: ["PORTFOLIO_CLAIM_UNSUPPORTED", "PORTFOLIO_CLAIM_GENERIC_MARKETING"] });
    const text = explainPortfolioClaim(claim);
    expect(text).toContain("rejection reasons:");
    expect(text).toContain("- PORTFOLIO_CLAIM_UNSUPPORTED");
    expect(text).toContain("- PORTFOLIO_CLAIM_GENERIC_MARKETING");
  });

  it("lists every evidence id", () => {
    const claim = makePortfolioClaim({ evidenceIds: ["portfolio:evidence:a:1", "portfolio:evidence:b:2"] });
    const text = explainPortfolioClaim(claim);
    expect(text).toContain("- portfolio:evidence:a:1");
    expect(text).toContain("- portfolio:evidence:b:2");
  });

  it("shows '(none recorded)' when evidenceIds is empty", () => {
    const claim = makePortfolioClaim({ evidenceIds: [] });
    const text = explainPortfolioClaim(claim);
    expect(text).toContain("(none recorded)");
  });

  it("renders every one of the 12 rejection-reason codes verbatim when a claim carries all of them at once — nothing is truncated, deduped, or dropped by the renderer", () => {
    const allCodes = [
      "PORTFOLIO_CLAIM_UNSUPPORTED",
      "PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY",
      "PORTFOLIO_CLAIM_ROADMAP_PROMOTED",
      "PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED",
      "PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED",
      "PORTFOLIO_CLAIM_UNSUPPORTED_SCALE",
      "PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION",
      "PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION",
      "PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION",
      "PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP",
      "PORTFOLIO_CLAIM_GENERIC_MARKETING",
      "PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP",
    ] as const;
    const claim = makePortfolioClaim({ status: "rejected", rejectionReasons: [...allCodes] });
    const text = explainPortfolioClaim(claim);
    for (const code of allCodes) expect(text).toContain(`- ${code}`);
  });
});

describe("explainPortfolioDecision", () => {
  it("includes the decision id, statement, type, urgency, confidence, and owner", () => {
    const decision = makePortfolioDecision({
      id: "portfolio:decision:ownership:x",
      statement: "Determine an explicit owner for widget-sync.",
      type: "ownership",
      urgency: "high",
      confidence: "derived",
      recommendedOwnerType: "platform_leadership",
    });
    const text = explainPortfolioDecision(decision);
    expect(text).toContain("Decision: Determine an explicit owner for widget-sync.");
    expect(text).toContain("id: portfolio:decision:ownership:x");
    expect(text).toContain("type: ownership");
    expect(text).toContain("urgency: high");
    expect(text).toContain("confidence: derived");
    expect(text).toContain("recommended owner: platform_leadership");
  });

  it("lists every affected product id, or '(none recorded)' when there are none", () => {
    const withProducts = makePortfolioDecision({ affectedProductIds: ["portfolio:product:alpha-cli", "portfolio:product:beta-cli"] });
    const withProductsText = explainPortfolioDecision(withProducts);
    expect(withProductsText).toContain("- portfolio:product:alpha-cli");
    expect(withProductsText).toContain("- portfolio:product:beta-cli");

    const withoutProducts = makePortfolioDecision({ affectedProductIds: [] });
    const withoutProductsText = explainPortfolioDecision(withoutProducts);
    expect(withoutProductsText).toContain("(none recorded)");
  });

  it("lists every evidence id, or '(none recorded)' when there are none", () => {
    const withEvidence = makePortfolioDecision({ evidenceIds: ["portfolio:evidence:a:1", "portfolio:evidence:b:2"] });
    const withEvidenceText = explainPortfolioDecision(withEvidence);
    expect(withEvidenceText).toContain("- portfolio:evidence:a:1");
    expect(withEvidenceText).toContain("- portfolio:evidence:b:2");

    const withoutEvidence = makePortfolioDecision({ evidenceIds: [] });
    const withoutEvidenceText = explainPortfolioDecision(withoutEvidence);
    expect(withoutEvidenceText).toContain("(none recorded)");
  });
});
