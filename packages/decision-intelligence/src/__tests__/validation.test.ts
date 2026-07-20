import { describe, expect, it } from "vitest";
import { validateDecisionArtifacts, validateDecisionClaims, validateDecisionLinks, validateDecisionNarrative, validateDecisionPlan, validateDecisionSnapshot } from "../validation.js";
import { architectureDecision, decisionClaim, decisionLink, decisionNarrative, decisionPlan, decisionSceneContent, decisionSnapshot } from "./decision-fixtures.js";

function codesOf(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("validateDecisionSnapshot", () => {
  it("DECISION_DUPLICATE_ID: fires when two decisions share an id", () => {
    const decisions = [architectureDecision({ id: "decision:dup" }), architectureDecision({ id: "decision:dup" })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).toContain("DECISION_DUPLICATE_ID");
  });

  it("DECISION_UNSORTED_DECISIONS: fires when decisions are not sorted by id", () => {
    const decisions = [architectureDecision({ id: "decision:b" }), architectureDecision({ id: "decision:a" })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).toContain("DECISION_UNSORTED_DECISIONS");
  });

  it("does not fire DECISION_UNSORTED_DECISIONS when decisions are sorted", () => {
    const decisions = [architectureDecision({ id: "decision:a" }), architectureDecision({ id: "decision:b" })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).not.toContain("DECISION_UNSORTED_DECISIONS");
  });

  it("DECISION_INVALID_STATUS: fires for an invalid decision_status", () => {
    const decisions = [architectureDecision({ decision_status: "not_a_real_status" as never })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).toContain("DECISION_INVALID_STATUS");
  });

  it("DECISION_INVALID_STATUS: fires for an invalid implementation_status", () => {
    const decisions = [architectureDecision({ implementation_status: "not_a_real_status" as never })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).toContain("DECISION_INVALID_STATUS");
  });

  it("DECISION_BROKEN_SUPERSESSION_REFERENCE: fires when supersedes/superseded_by names a decision absent from the snapshot", () => {
    const decisions = [architectureDecision({ id: "decision:a", supersedes: ["decision:missing"] })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).toContain("DECISION_BROKEN_SUPERSESSION_REFERENCE");
  });

  it("does not fire DECISION_BROKEN_SUPERSESSION_REFERENCE when the target is present in the snapshot", () => {
    const decisions = [architectureDecision({ id: "decision:a", supersedes: ["decision:b"] }), architectureDecision({ id: "decision:b" })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    expect(codesOf(issues)).not.toContain("DECISION_BROKEN_SUPERSESSION_REFERENCE");
  });
});

describe("validateDecisionLinks", () => {
  it("DECISION_LINK_UNKNOWN_DECISION: fires when a link names a decision_id absent from the snapshot", () => {
    const snapshot = decisionSnapshot({ decisions: [architectureDecision({ id: "decision:a" })] });
    const link = decisionLink({ decision_id: "decision:unknown" });
    const issues = validateDecisionLinks([link], snapshot);
    expect(codesOf(issues)).toContain("DECISION_LINK_UNKNOWN_DECISION");
  });

  it("does not fire when the link's decision_id is present in the snapshot", () => {
    const snapshot = decisionSnapshot({ decisions: [architectureDecision({ id: "decision:a" })] });
    const link = decisionLink({ decision_id: "decision:a" });
    const issues = validateDecisionLinks([link], snapshot);
    expect(issues).toEqual([]);
  });
});

describe("validateDecisionClaims", () => {
  it("DECISION_CLAIM_MISSING_REJECTION_CODES: fires when status is rejected but rejection_codes is empty", () => {
    const claim = decisionClaim({ status: "rejected", rejection_codes: [] });
    const issues = validateDecisionClaims([claim]);
    expect(codesOf(issues)).toContain("DECISION_CLAIM_MISSING_REJECTION_CODES");
  });

  it("DECISION_CLAIM_UNEXPECTED_REJECTION_CODES: fires when status is not rejected but rejection_codes is non-empty", () => {
    const claim = decisionClaim({ status: "approved", rejection_codes: ["missing_decision_evidence"] });
    const issues = validateDecisionClaims([claim]);
    expect(codesOf(issues)).toContain("DECISION_CLAIM_UNEXPECTED_REJECTION_CODES");
  });

  it("DECISION_CLAIM_DUPLICATE_ID: fires when two claims share an id", () => {
    const a = decisionClaim({ id: "decision:claim:dup" });
    const b = decisionClaim({ id: "decision:claim:dup" });
    const issues = validateDecisionClaims([a, b]);
    expect(codesOf(issues)).toContain("DECISION_CLAIM_DUPLICATE_ID");
  });

  it("DECISION_UNSORTED_CLAIMS: fires when claims are not sorted by id", () => {
    const a = decisionClaim({ id: "decision:claim:b" });
    const b = decisionClaim({ id: "decision:claim:a" });
    const issues = validateDecisionClaims([a, b]);
    expect(codesOf(issues)).toContain("DECISION_UNSORTED_CLAIMS");
  });

  it("emits no issues for a well-formed, sorted claim list", () => {
    const a = decisionClaim({ id: "decision:claim:a", status: "approved", rejection_codes: [] });
    const b = decisionClaim({ id: "decision:claim:b", status: "rejected", rejection_codes: ["missing_decision_evidence"] });
    const issues = validateDecisionClaims([a, b]);
    expect(issues).toEqual([]);
  });
});

describe("validateDecisionNarrative", () => {
  it("DECISION_NARRATIVE_ID_MISMATCH: fires when narrative.source_snapshot_id does not match snapshot.id", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:a" });
    const narrative = decisionNarrative({ source_snapshot_id: "decision:snapshot:b" });
    const issues = validateDecisionNarrative(narrative, snapshot);
    expect(codesOf(issues)).toContain("DECISION_NARRATIVE_ID_MISMATCH");
  });

  it("does not fire DECISION_NARRATIVE_ID_MISMATCH when ids match", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:a" });
    const narrative = decisionNarrative({ source_snapshot_id: "decision:snapshot:a" });
    const issues = validateDecisionNarrative(narrative, snapshot);
    expect(codesOf(issues)).not.toContain("DECISION_NARRATIVE_ID_MISMATCH");
  });

  it("DECISION_NARRATIVE_FORBIDDEN_PHRASING: fires when a section body contains forbidden phrasing", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:a" });
    const narrative = decisionNarrative({ source_snapshot_id: "decision:snapshot:a", sections: [{ heading: "Headline", body: "There is no risk here." }] });
    const issues = validateDecisionNarrative(narrative, snapshot);
    expect(codesOf(issues)).toContain("DECISION_NARRATIVE_FORBIDDEN_PHRASING");
  });

  it("does not fire DECISION_NARRATIVE_FORBIDDEN_PHRASING for clean section text", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:a" });
    const narrative = decisionNarrative({ source_snapshot_id: "decision:snapshot:a", sections: [{ heading: "Headline", body: "Clean text." }] });
    const issues = validateDecisionNarrative(narrative, snapshot);
    expect(codesOf(issues)).not.toContain("DECISION_NARRATIVE_FORBIDDEN_PHRASING");
  });
});

describe("validateDecisionPlan", () => {
  it("DECISION_SCENE_DUPLICATE_ID: fires when two scenes share a scene_id", () => {
    const a = decisionSceneContent({ scene_id: "decision:scene:dup", kind: "decision-hero" });
    const b = decisionSceneContent({ scene_id: "decision:scene:dup", kind: "decision-landscape" });
    const issues = validateDecisionPlan(decisionPlan({ scenes: [a, b] }));
    expect(codesOf(issues)).toContain("DECISION_SCENE_DUPLICATE_ID");
  });

  it("DECISION_SCENE_UNSORTED: fires when scenes are out of canonical kind order", () => {
    const later = decisionSceneContent({ scene_id: "decision:scene:1", kind: "decision-landscape" });
    const earlier = decisionSceneContent({ scene_id: "decision:scene:2", kind: "decision-hero" });
    const issues = validateDecisionPlan(decisionPlan({ scenes: [later, earlier] }));
    expect(codesOf(issues)).toContain("DECISION_SCENE_UNSORTED");
  });

  it("DECISION_SCENE_UNSORTED: fires when same-kind scenes are out of scene_id order", () => {
    const b = decisionSceneContent({ scene_id: "decision:scene:b", kind: "decision-hero" });
    const a = decisionSceneContent({ scene_id: "decision:scene:a", kind: "decision-hero" });
    const issues = validateDecisionPlan(decisionPlan({ scenes: [b, a] }));
    expect(codesOf(issues)).toContain("DECISION_SCENE_UNSORTED");
  });

  it("does not fire DECISION_SCENE_UNSORTED for a properly ordered plan", () => {
    const hero = decisionSceneContent({ scene_id: "decision:scene:1", kind: "decision-hero" });
    const landscape = decisionSceneContent({ scene_id: "decision:scene:2", kind: "decision-landscape" });
    const issues = validateDecisionPlan(decisionPlan({ scenes: [hero, landscape] }));
    expect(codesOf(issues)).not.toContain("DECISION_SCENE_UNSORTED");
  });

  it("DECISION_PLAN_TOO_FEW_SCENES: fires (as a warning) when scenes is empty", () => {
    const issues = validateDecisionPlan(decisionPlan({ scenes: [] }));
    expect(codesOf(issues)).toContain("DECISION_PLAN_TOO_FEW_SCENES");
    const found = issues.find((issue) => issue.code === "DECISION_PLAN_TOO_FEW_SCENES")!;
    expect(found.severity).toBe("warning");
  });

  it("does not fire DECISION_PLAN_TOO_FEW_SCENES when at least one scene is present", () => {
    const issues = validateDecisionPlan(decisionPlan({ scenes: [decisionSceneContent()] }));
    expect(codesOf(issues)).not.toContain("DECISION_PLAN_TOO_FEW_SCENES");
  });
});

describe("severity classification", () => {
  const TIER1_CODES = [
    "DECISION_DUPLICATE_ID",
    "DECISION_UNSORTED_DECISIONS",
    "DECISION_INVALID_STATUS",
    "DECISION_BROKEN_SUPERSESSION_REFERENCE",
    "DECISION_LINK_UNKNOWN_DECISION",
    "DECISION_CLAIM_MISSING_REJECTION_CODES",
    "DECISION_CLAIM_UNEXPECTED_REJECTION_CODES",
    "DECISION_CLAIM_DUPLICATE_ID",
    "DECISION_UNSORTED_CLAIMS",
    "DECISION_SCENE_DUPLICATE_ID",
    "DECISION_SCENE_UNSORTED",
    "DECISION_NARRATIVE_ID_MISMATCH",
    "DECISION_NARRATIVE_FORBIDDEN_PHRASING",
  ];

  it("every Tier1 code is severity 'error'", () => {
    const decisions = [architectureDecision({ id: "decision:dup" }), architectureDecision({ id: "decision:dup" })];
    const issues = validateDecisionSnapshot(decisionSnapshot({ decisions }));
    const dupIssue = issues.find((issue) => issue.code === "DECISION_DUPLICATE_ID")!;
    expect(dupIssue.severity).toBe("error");
    expect(TIER1_CODES).toContain("DECISION_DUPLICATE_ID");
  });

  it("DECISION_PLAN_TOO_FEW_SCENES is the sole Tier2 'warning' code", () => {
    const issues = validateDecisionPlan(decisionPlan({ scenes: [] }));
    const warning = issues.find((issue) => issue.code === "DECISION_PLAN_TOO_FEW_SCENES")!;
    expect(warning.severity).toBe("warning");
    expect(TIER1_CODES).not.toContain("DECISION_PLAN_TOO_FEW_SCENES");
  });
});

describe("validateDecisionArtifacts", () => {
  it("runs only the sub-validators whose input is present", () => {
    const snapshot = decisionSnapshot({ decisions: [architectureDecision({ id: "decision:dup" }), architectureDecision({ id: "decision:dup" })] });
    const issues = validateDecisionArtifacts({ snapshot });
    expect(codesOf(issues)).toEqual(["DECISION_DUPLICATE_ID"]);
  });

  it("aggregates issues across all supplied artifacts", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:a" });
    const claim = decisionClaim({ status: "rejected", rejection_codes: [] });
    const narrative = decisionNarrative({ source_snapshot_id: "decision:snapshot:mismatch" });
    const plan = decisionPlan({ scenes: [] });
    const issues = validateDecisionArtifacts({ snapshot, claims: [claim], narrative, plan });
    const codes = codesOf(issues);
    expect(codes).toContain("DECISION_CLAIM_MISSING_REJECTION_CODES");
    expect(codes).toContain("DECISION_NARRATIVE_ID_MISMATCH");
    expect(codes).toContain("DECISION_PLAN_TOO_FEW_SCENES");
  });
});
