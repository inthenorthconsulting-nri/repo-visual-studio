import { describe, expect, it } from "vitest";
import { classifyGovernanceClaim, draftStandardGovernanceClaims, type GovernanceClaimDraft } from "../claims.js";
import { architectureChangeSet, blastRadiusAssessment, blastRadiusEntry, changeEntry, classification, evaluation, evidenceChangeEntry, evidenceChangeSet, finding, report } from "./governance-fixtures.js";

function baseDraft(overrides: Partial<GovernanceClaimDraft> = {}): GovernanceClaimDraft {
  return {
    subjectId: "subject-1",
    claimType: "no_regression",
    text: "Test claim text.",
    evidenceRefs: [],
    ...overrides,
  };
}

describe("classifyGovernanceClaim: rejection reasons", () => {
  it("incompatible_snapshot: rejects any claim when report.compatibility is 'incompatible'", () => {
    const r = report({ compatibility: "incompatible" });
    const result = classifyGovernanceClaim(baseDraft(), { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("incompatible_snapshot");
  });

  it("partial_snapshot: rejects any claim when report.compatibility is 'partial'", () => {
    const r = report({ compatibility: "partial" });
    const result = classifyGovernanceClaim(baseDraft(), { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("partial_snapshot");
  });

  it("missing_lineage: rejects when a referenced change entry's lineage is broken", () => {
    const brokenEntry = changeEntry({ lineage: "broken" });
    const r = report({ architecture_changes: architectureChangeSet([brokenEntry]) });
    const draft = baseDraft({ claimType: "lineage_integrity", subjectChangeIds: [brokenEntry.id] });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("missing_lineage");
  });

  it("missing_lineage: also rejects for 'weakened' and 'unverifiable' lineage states", () => {
    for (const lineage of ["weakened", "unverifiable"] as const) {
      const entry = changeEntry({ lineage });
      const r = report({ architecture_changes: architectureChangeSet([entry]) });
      const draft = baseDraft({ claimType: "lineage_integrity", subjectChangeIds: [entry.id] });
      const result = classifyGovernanceClaim(draft, { report: r });
      expect(result.rejection_reason).toBe("missing_lineage");
    }
  });

  it("unresolved_blast_radius: rejects when a referenced change has an unresolved blast-radius entry", () => {
    const entry = changeEntry({ lineage: "preserved" });
    const bre = blastRadiusEntry({ change_id: entry.id, level: "unresolved" });
    const r = report({ architecture_changes: architectureChangeSet([entry]), blast_radius: blastRadiusAssessment([bre]) });
    const draft = baseDraft({ claimType: "blast_radius_bound", subjectChangeIds: [entry.id] });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unresolved_blast_radius");
  });

  it("policy_result_mismatch: rejects a policy_compliance claim when the referenced policy has an un-excepted failing finding", () => {
    const failFinding = finding({ policy_id: "governance:policy:p1", result: "fail" });
    const r = report({ evaluations: [evaluation({ policy_id: "governance:policy:p1", findings: [failFinding] })] });
    const draft = baseDraft({ claimType: "policy_compliance", policyId: "governance:policy:p1" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("policy_result_mismatch");
  });

  it("unsupported_no_impact_claim: rejects when a blocking/review-required finding failed", () => {
    const failFinding = finding({ result: "fail", severity: "blocking" });
    const r = report({ findings: [failFinding] });
    const draft = baseDraft({ assertedOutcome: "no_impact" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unsupported_no_impact_claim");
  });

  it("unsupported_safety_claim: rejects when a blocking finding failed", () => {
    const failFinding = finding({ result: "fail", severity: "blocking" });
    const r = report({ findings: [failFinding] });
    const draft = baseDraft({ assertedOutcome: "safety" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unsupported_safety_claim");
  });

  it("unsupported_improvement_claim: rejects when no change entry shows strengthened evidence impact", () => {
    const r = report({ architecture_changes: architectureChangeSet([changeEntry({ classification: classification({ evidence_impact: "preserved" }) })]) });
    const draft = baseDraft({ assertedOutcome: "improvement" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unsupported_improvement_claim");
  });

  it("unsupported_risk_reduction: rejects when a review-required finding failed", () => {
    const failFinding = finding({ result: "fail", severity: "review_required" });
    const r = report({ findings: [failFinding] });
    const draft = baseDraft({ assertedOutcome: "risk_reduction" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unsupported_risk_reduction");
  });

  it("unsupported_completeness_claim: rejects when an evidence change is unresolved", () => {
    const r = report({ evidence_changes: evidenceChangeSet([evidenceChangeEntry({ type: "unresolved" })]) });
    const draft = baseDraft({ assertedOutcome: "completeness" });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("unsupported_completeness_claim");
  });
});

describe("classifyGovernanceClaim: approved / qualified", () => {
  it("approves a claim when the report has no supporting issues at all", () => {
    const r = report();
    const draft = baseDraft();
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("approved");
    expect(result.rejection_reason).toBeUndefined();
    expect(result.qualifiers).toEqual([]);
  });

  it("qualifies a claim (with real qualifier text) when a related finding is unverifiable but nothing fails", () => {
    const unverifiableFinding = finding({ result: "unverifiable", severity: "advisory" });
    const r = report({ findings: [unverifiableFinding] });
    const draft = baseDraft();
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("qualified");
    expect(result.rejection_reason).toBeUndefined();
    expect(result.qualifiers.length).toBeGreaterThan(0);
    expect(result.qualifiers[0]).toContain("unverifiable");
  });

  it("qualifies a claim when a related finding was only permitted via exception", () => {
    const exceptedFinding = finding({ result: "excepted", excepted: true });
    const r = report({ findings: [exceptedFinding] });
    const draft = baseDraft();
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("qualified");
    expect(result.qualifiers.some((q) => q.includes("exception"))).toBe(true);
  });

  it("never invents qualifiers beyond real report content plus an explicitly caller-verified qualifierText", () => {
    const r = report();
    const draft = baseDraft({ qualifierText: "Caller-verified caveat." });
    const result = classifyGovernanceClaim(draft, { report: r });
    expect(result.status).toBe("qualified");
    expect(result.qualifiers).toEqual(["Caller-verified caveat."]);
  });
});

describe("draftStandardGovernanceClaims", () => {
  it("generates exactly 5 drafts, one of each GovernanceClaimType", () => {
    const r = report();
    const drafts = draftStandardGovernanceClaims(r);
    expect(drafts).toHaveLength(5);
    expect(new Set(drafts.map((d) => d.claimType))).toEqual(new Set(["no_regression", "policy_compliance", "lineage_integrity", "blast_radius_bound", "evidence_strength"]));
  });

  it("is deterministic: calling it twice over the same report produces identical drafts", () => {
    const r = report();
    const first = draftStandardGovernanceClaims(r);
    const second = draftStandardGovernanceClaims(r);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("classifies to a mix of approved/qualified claims for a clean report with no policy evaluations", () => {
    const r = report();
    const claims = draftStandardGovernanceClaims(r).map((draft) => classifyGovernanceClaim(draft, { report: r }));
    expect(claims.every((claim) => claim.status !== "rejected")).toBe(true);
  });
});
