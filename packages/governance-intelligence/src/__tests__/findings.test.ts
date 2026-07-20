import { describe, expect, it } from "vitest";
import { mergeFindings, summarizeFindings } from "../findings.js";
import type { GovernanceEvaluation, GovernanceFinding } from "../contracts.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function finding(overrides: Partial<GovernanceFinding> = {}): GovernanceFinding {
  return {
    id: overrides.id ?? "governance:finding:test:1",
    policy_id: overrides.policy_id ?? "governance:policy:test",
    rule_id: overrides.rule_id ?? "governance:rule:test:1",
    result: overrides.result ?? "fail",
    severity: overrides.severity ?? "advisory",
    statement: overrides.statement ?? "A finding.",
    affected_entity_ids: overrides.affected_entity_ids ?? ["entity-1"],
    human_review_required: overrides.human_review_required ?? true,
    excepted: overrides.excepted ?? false,
    evidence_refs: overrides.evidence_refs ?? [],
    ...overrides,
  };
}

function evaluation(policyId: string, findings: GovernanceFinding[]): GovernanceEvaluation {
  return {
    schema_version: 1,
    id: `governance:evaluation:${policyId}`,
    policy_id: policyId,
    source_snapshot_id: "source",
    target_snapshot_id: "target",
    findings,
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

describe("mergeFindings", () => {
  it("flattens findings from multiple evaluations", () => {
    const f1 = finding({ id: "f1", policy_id: "policy-a" });
    const f2 = finding({ id: "f2", policy_id: "policy-b" });
    const merged = mergeFindings([evaluation("policy-a", [f1]), evaluation("policy-b", [f2])]);
    expect(merged).toHaveLength(2);
    expect(merged.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("sorts by severity rank first (blocking, review_required, advisory, informational)", () => {
    const informational = finding({ id: "f-info", policy_id: "policy-a", severity: "informational" });
    const blocking = finding({ id: "f-blocking", policy_id: "policy-a", severity: "blocking" });
    const advisory = finding({ id: "f-advisory", policy_id: "policy-a", severity: "advisory" });
    const reviewRequired = finding({ id: "f-review", policy_id: "policy-a", severity: "review_required" });
    const merged = mergeFindings([evaluation("policy-a", [informational, blocking, advisory, reviewRequired])]);
    expect(merged.map((f) => f.severity)).toEqual(["blocking", "review_required", "advisory", "informational"]);
  });

  it("tie-breaks equal severity by policy_id", () => {
    const fB = finding({ id: "f-b", policy_id: "policy-b", severity: "advisory" });
    const fA = finding({ id: "f-a", policy_id: "policy-a", severity: "advisory" });
    const merged = mergeFindings([evaluation("policy-b", [fB]), evaluation("policy-a", [fA])]);
    expect(merged.map((f) => f.policy_id)).toEqual(["policy-a", "policy-b"]);
  });

  it("tie-breaks equal severity and policy_id by first affected_entity_id", () => {
    const fZ = finding({ id: "f-z", policy_id: "policy-a", severity: "advisory", affected_entity_ids: ["entity-z"] });
    const fA = finding({ id: "f-a", policy_id: "policy-a", severity: "advisory", affected_entity_ids: ["entity-a"] });
    const merged = mergeFindings([evaluation("policy-a", [fZ, fA])]);
    expect(merged.map((f) => f.affected_entity_ids[0])).toEqual(["entity-a", "entity-z"]);
  });

  it("tie-breaks equal severity, policy_id, and entity by finding id", () => {
    const fZ = finding({ id: "f-z", policy_id: "policy-a", severity: "advisory", affected_entity_ids: ["entity-1"] });
    const fA = finding({ id: "f-a", policy_id: "policy-a", severity: "advisory", affected_entity_ids: ["entity-1"] });
    const merged = mergeFindings([evaluation("policy-a", [fZ, fA])]);
    expect(merged.map((f) => f.id)).toEqual(["f-a", "f-z"]);
  });

  it("returns an empty array for no evaluations", () => {
    expect(mergeFindings([])).toEqual([]);
  });

  it("does not dedupe identical findings", () => {
    const f1 = finding({ id: "f1", policy_id: "policy-a" });
    const f1Duplicate = finding({ id: "f1", policy_id: "policy-a" });
    const merged = mergeFindings([evaluation("policy-a", [f1, f1Duplicate])]);
    expect(merged).toHaveLength(2);
  });
});

describe("summarizeFindings", () => {
  it("counts findings by severity and by result, zero-filling absent keys", () => {
    const findings = [
      finding({ id: "f1", severity: "blocking", result: "fail" }),
      finding({ id: "f2", severity: "blocking", result: "excepted" }),
      finding({ id: "f3", severity: "advisory", result: "pass" }),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.total).toBe(3);
    expect(summary.by_severity).toEqual({ blocking: 2, review_required: 0, advisory: 1, informational: 0 });
    expect(summary.by_result).toEqual({ pass: 1, fail: 1, not_applicable: 0, unverifiable: 0, excepted: 1 });
  });

  it("returns all-zero counts for an empty findings list", () => {
    const summary = summarizeFindings([]);
    expect(summary.total).toBe(0);
    expect(summary.by_severity).toEqual({ blocking: 0, review_required: 0, advisory: 0, informational: 0 });
    expect(summary.by_result).toEqual({ pass: 0, fail: 0, not_applicable: 0, unverifiable: 0, excepted: 0 });
  });

  it("has no side effects on the input array", () => {
    const findings = [finding({ id: "f1" })];
    const copy = [...findings];
    summarizeFindings(findings);
    expect(findings).toEqual(copy);
  });
});
