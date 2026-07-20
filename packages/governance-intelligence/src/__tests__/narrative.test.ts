import { describe, expect, it } from "vitest";
import { buildGovernanceNarrative, containsForbiddenPhrasing } from "../narrative.js";
import { architectureChangeSet, changeEntry, classification, finding, report } from "./governance-fixtures.js";

const GENERATED_AT = "2026-07-05T00:00:00.000Z";

describe("containsForbiddenPhrasing", () => {
  it("catches each of the 5 forbidden phrases (case-insensitive)", () => {
    const sample = "The Architecture Is Improved, and separately Risk Is Reduced. Overall the Portfolio Is More Efficient. This Change Is Safe, with No Impact anywhere.";
    const hits = containsForbiddenPhrasing(sample);
    expect(hits).toEqual(["architecture is improved", "risk is reduced", "portfolio is more efficient", "change is safe", "no impact"]);
  });

  it("returns an empty array for clean, evidence-qualified text", () => {
    expect(containsForbiddenPhrasing("No blocking findings were identified in this comparison, based on the evidence available.")).toEqual([]);
  });
});

describe("buildGovernanceNarrative", () => {
  it("never emits forbidden phrasing in any of its 5 text fields for a clean report", () => {
    const r = report();
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    for (const field of [narrative.summary, narrative.whatChanged, narrative.whyItMatters, narrative.riskAssessment, narrative.recommendedActions]) {
      expect(containsForbiddenPhrasing(field)).toEqual([]);
    }
  });

  it("never emits forbidden phrasing even for a report with zero blocking findings but other activity", () => {
    const r = report({
      architecture_changes: architectureChangeSet([changeEntry({ type: "modified", classification: classification({ materiality: "material" }) })]),
      findings: [finding({ result: "pass", severity: "informational" })],
    });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    for (const field of [narrative.summary, narrative.whatChanged, narrative.whyItMatters, narrative.riskAssessment, narrative.recommendedActions]) {
      expect(containsForbiddenPhrasing(field)).toEqual([]);
    }
  });

  it("places qualified claims (not just approved ones) into approvedClaims, with their qualifiers visible", () => {
    const unverifiableFinding = finding({ result: "unverifiable", severity: "advisory" });
    const r = report({ findings: [unverifiableFinding] });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const qualified = narrative.approvedClaims.filter((claim) => claim.status === "qualified");
    expect(qualified.length).toBeGreaterThan(0);
    expect(qualified[0].qualifiers.length).toBeGreaterThan(0);
  });

  it("places rejected claims into rejectedClaims, never approvedClaims", () => {
    const r = report({ compatibility: "incompatible" });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    expect(narrative.approvedClaims).toEqual([]);
    expect(narrative.rejectedClaims.length).toBe(5);
    expect(narrative.rejectedClaims.every((claim) => claim.status === "rejected" && claim.rejection_reason === "incompatible_snapshot")).toBe(true);
  });

  it("is fully deterministic: building twice from the same input produces byte-identical output", () => {
    const r = report({
      findings: [finding({ result: "fail", severity: "blocking" })],
      architecture_changes: architectureChangeSet([changeEntry({ type: "removed" })]),
    });
    const first = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const second = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("derives id via buildNarrativeId(source_snapshot_id, target_snapshot_id)", () => {
    const r = report({ source_snapshot_id: "src-1", target_snapshot_id: "tgt-1" });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    expect(narrative.id).toBe("governance:narrative:src-1:tgt-1");
    expect(narrative.source_snapshot_id).toBe("src-1");
    expect(narrative.target_snapshot_id).toBe("tgt-1");
  });

  it("reflects real blocking-finding counts in riskAssessment and recommendedActions", () => {
    const r = report({ findings: [finding({ result: "fail", severity: "blocking" }), finding({ result: "fail", severity: "blocking" })] });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    expect(narrative.riskAssessment).toContain("2 blocking finding(s)");
    expect(narrative.recommendedActions).toContain("2 blocking finding(s)");
  });
});
