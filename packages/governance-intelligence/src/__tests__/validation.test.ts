import { describe, expect, it } from "vitest";
import { buildGovernancePlan } from "../governance-plan.js";
import { buildGovernanceNarrative } from "../narrative.js";
import { validateGovernancePlan } from "../validation.js";
import { report } from "./governance-fixtures.js";
import type { GovernancePlan, GovernanceSceneContent } from "../contracts.js";

const GENERATED_AT = "2026-07-12T00:00:00.000Z";

function validPlan(): GovernancePlan {
  const r = report();
  const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
  return buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
}

function clone(plan: GovernancePlan): GovernancePlan {
  return JSON.parse(JSON.stringify(plan)) as GovernancePlan;
}

function codesOf(plan: GovernancePlan): string[] {
  return validateGovernancePlan(plan).map((issue) => issue.code);
}

describe("validateGovernancePlan: a fully valid plan produces zero issues", () => {
  it("returns an empty array for a plan built by buildGovernancePlan over a clean report", () => {
    expect(validateGovernancePlan(validPlan())).toEqual([]);
  });
});

describe("validateGovernancePlan: every GOVERNANCE_* code is reachable", () => {
  it("GOVERNANCE_MISSING_SCHEMA_VERSION: fires when plan.schema_version is 0", () => {
    const p = clone(validPlan());
    (p as unknown as { schema_version: number }).schema_version = 0;
    expect(codesOf(p)).toContain("GOVERNANCE_MISSING_SCHEMA_VERSION");
  });

  it("GOVERNANCE_DUPLICATE_FINDING_ID: fires when two findings share an id", () => {
    const p = clone(validPlan());
    p.report.findings = [
      { id: "dup-1", policy_id: "p", rule_id: "r", result: "pass", severity: "informational", statement: "s", affected_entity_ids: [], human_review_required: false, excepted: false, evidence_refs: [] },
      { id: "dup-1", policy_id: "p", rule_id: "r", result: "pass", severity: "informational", statement: "s", affected_entity_ids: [], human_review_required: false, excepted: false, evidence_refs: [] },
    ];
    expect(codesOf(p)).toContain("GOVERNANCE_DUPLICATE_FINDING_ID");
  });

  it("GOVERNANCE_UNSORTED_FINDINGS: fires when findings are not sorted by severity rank", () => {
    const p = clone(validPlan());
    p.report.findings = [
      { id: "a", policy_id: "p", rule_id: "r", result: "pass", severity: "informational", statement: "s", affected_entity_ids: [], human_review_required: false, excepted: false, evidence_refs: [] },
      { id: "b", policy_id: "p", rule_id: "r", result: "fail", severity: "blocking", statement: "s", affected_entity_ids: [], human_review_required: false, excepted: false, evidence_refs: [] },
    ];
    expect(codesOf(p)).toContain("GOVERNANCE_UNSORTED_FINDINGS");
  });

  it("GOVERNANCE_UNSORTED_EVALUATIONS: fires when evaluations are not sorted by policy_id", () => {
    const p = clone(validPlan());
    p.report.evaluations = [
      { schema_version: 1, id: "e1", policy_id: "z-policy", source_snapshot_id: "source", target_snapshot_id: "target", findings: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      { schema_version: 1, id: "e2", policy_id: "a-policy", source_snapshot_id: "source", target_snapshot_id: "target", findings: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
    ];
    expect(codesOf(p)).toContain("GOVERNANCE_UNSORTED_EVALUATIONS");
  });

  it("GOVERNANCE_INVALID_SEVERITY: fires when a finding's severity isn't one of the 4 valid values", () => {
    const p = clone(validPlan());
    p.report.findings = [{ id: "a", policy_id: "p", rule_id: "r", result: "pass", severity: "critical" as never, statement: "s", affected_entity_ids: [], human_review_required: false, excepted: false, evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_INVALID_SEVERITY");
  });

  it("GOVERNANCE_EXCEPTION_WITHOUT_APPROVAL_REFERENCE: fires when an excepted finding names no approval_reference", () => {
    const p = clone(validPlan());
    p.report.findings = [{ id: "a", policy_id: "p", rule_id: "r", result: "excepted", severity: "blocking", statement: "s", affected_entity_ids: [], human_review_required: false, excepted: true, evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_EXCEPTION_WITHOUT_APPROVAL_REFERENCE");
  });

  it("GOVERNANCE_FINDING_EXCEPTED_RESULT_MISMATCH: fires when excepted=true but result isn't 'excepted'", () => {
    const p = clone(validPlan());
    p.report.findings = [
      {
        id: "a",
        policy_id: "p",
        rule_id: "r",
        result: "fail",
        severity: "blocking",
        statement: "s",
        affected_entity_ids: [],
        human_review_required: false,
        excepted: true,
        exception: { policy_id: "p", rule_id: "r", reason: "r", approval_reference: "APPROVAL-1", evidence_refs: [] },
        evidence_refs: [],
      },
    ];
    expect(codesOf(p)).toContain("GOVERNANCE_FINDING_EXCEPTED_RESULT_MISMATCH");
  });

  it("GOVERNANCE_CLAIM_MISSING_REJECTION_REASON: fires when a rejected claim in rejectedClaims sets no rejection_reason", () => {
    const p = clone(validPlan());
    p.narrative.rejectedClaims = [{ id: "claim:1", text: "t", claim_type: "no_regression", status: "rejected", qualifiers: [], evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_CLAIM_MISSING_REJECTION_REASON");
  });

  it("GOVERNANCE_CLAIM_UNEXPECTED_REJECTION_REASON: fires when an approved claim sets a rejection_reason", () => {
    const p = clone(validPlan());
    p.narrative.approvedClaims = [{ id: "claim:1", text: "t", claim_type: "no_regression", status: "approved", rejection_reason: "incompatible_snapshot", qualifiers: [], evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_CLAIM_UNEXPECTED_REJECTION_REASON");
  });

  it("GOVERNANCE_CLAIM_QUALIFIED_WITHOUT_QUALIFIERS: fires when a qualified claim has no qualifiers", () => {
    const p = clone(validPlan());
    p.narrative.approvedClaims = [{ id: "claim:1", text: "t", claim_type: "no_regression", status: "qualified", qualifiers: [], evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_CLAIM_QUALIFIED_WITHOUT_QUALIFIERS");
  });

  it("GOVERNANCE_CLAIM_MISPLACED: fires when a well-formed rejected claim is filed under approvedClaims", () => {
    const p = clone(validPlan());
    p.narrative.rejectedClaims = [];
    p.narrative.approvedClaims = [{ id: "claim:1", text: "t", claim_type: "no_regression", status: "rejected", rejection_reason: "incompatible_snapshot", qualifiers: [], evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_CLAIM_MISPLACED");
  });

  it("GOVERNANCE_CLAIM_DUPLICATE_ID: fires when the same claim id appears in both approvedClaims and rejectedClaims", () => {
    const p = clone(validPlan());
    p.narrative.approvedClaims = [{ id: "claim:dup", text: "t", claim_type: "no_regression", status: "approved", qualifiers: [], evidence_refs: [] }];
    p.narrative.rejectedClaims = [{ id: "claim:dup", text: "t", claim_type: "no_regression", status: "rejected", rejection_reason: "incompatible_snapshot", qualifiers: [], evidence_refs: [] }];
    expect(codesOf(p)).toContain("GOVERNANCE_CLAIM_DUPLICATE_ID");
  });

  it("GOVERNANCE_UNSORTED_CLAIMS: fires when approvedClaims is not sorted by id", () => {
    const p = clone(validPlan());
    p.narrative.approvedClaims = [
      { id: "claim:z", text: "t", claim_type: "no_regression", status: "approved", qualifiers: [], evidence_refs: [] },
      { id: "claim:a", text: "t", claim_type: "no_regression", status: "approved", qualifiers: [], evidence_refs: [] },
    ];
    expect(codesOf(p)).toContain("GOVERNANCE_UNSORTED_CLAIMS");
  });

  it("GOVERNANCE_SCENE_MISSING_EVIDENCE: fires when a portfolio-change scene is present but report.portfolio_changes is absent", () => {
    const p = clone(validPlan());
    const scene: GovernanceSceneContent = { scene_id: "governance:scene:test:portfolio-change", kind: "portfolio-change", title: "Portfolio changes", data: {}, evidence_refs: [] };
    p.scenes = [...p.scenes, scene];
    expect(codesOf(p)).toContain("GOVERNANCE_SCENE_MISSING_EVIDENCE");
  });

  it("GOVERNANCE_SCENE_DUPLICATE_ID: fires when two scenes share a scene_id", () => {
    const p = clone(validPlan());
    p.scenes = [...p.scenes, { ...p.scenes[0] }];
    expect(codesOf(p)).toContain("GOVERNANCE_SCENE_DUPLICATE_ID");
  });

  it("GOVERNANCE_SCENE_UNSORTED: fires when scenes are out of canonical kind order", () => {
    const p = clone(validPlan());
    p.scenes = [...p.scenes].reverse();
    expect(codesOf(p)).toContain("GOVERNANCE_SCENE_UNSORTED");
  });

  it("GOVERNANCE_NARRATIVE_ID_MISMATCH: fires when narrative snapshot ids don't match the report's", () => {
    const p = clone(validPlan());
    p.narrative.source_snapshot_id = "some-other-snapshot";
    expect(codesOf(p)).toContain("GOVERNANCE_NARRATIVE_ID_MISMATCH");
  });

  it("GOVERNANCE_NARRATIVE_FORBIDDEN_PHRASING: fires when a narrative field contains forbidden phrasing", () => {
    const p = clone(validPlan());
    p.narrative.summary = "This change is safe and ready to ship.";
    expect(codesOf(p)).toContain("GOVERNANCE_NARRATIVE_FORBIDDEN_PHRASING");
  });

  it("GOVERNANCE_PLAN_TOO_FEW_SCENES: fires (as a warning) when a plan has fewer than 3 scenes", () => {
    const p = clone(validPlan());
    p.scenes = [];
    const issues = validateGovernancePlan(p);
    const found = issues.find((issue) => issue.code === "GOVERNANCE_PLAN_TOO_FEW_SCENES");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("warning");
  });
});

describe("validateGovernancePlan: severity classification", () => {
  it("classifies structural issues as errors and GOVERNANCE_PLAN_TOO_FEW_SCENES as a warning", () => {
    const p = clone(validPlan());
    (p as unknown as { schema_version: number }).schema_version = 0;
    p.scenes = [];
    const issues = validateGovernancePlan(p);
    const missingSchema = issues.find((issue) => issue.code === "GOVERNANCE_MISSING_SCHEMA_VERSION");
    const tooFew = issues.find((issue) => issue.code === "GOVERNANCE_PLAN_TOO_FEW_SCENES");
    expect(missingSchema?.severity).toBe("error");
    expect(tooFew?.severity).toBe("warning");
  });
});
