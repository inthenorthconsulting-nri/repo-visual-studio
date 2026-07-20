import { describe, expect, it } from "vitest";
import { detectDecisionDebt, type DecisionDebtInputs } from "../decision-debt.js";
import { buildDebtFindingId } from "../ids.js";
import type { DecisionDebtCategory } from "../contracts.js";
import {
  architectureDecision,
  decisionAssumption,
  decisionConflict,
  decisionDependency,
  decisionDrift,
  decisionImplementationState,
  decisionLink,
  decisionSource,
  decisionSourceIssue,
  missingDecisionFinding,
} from "./decision-fixtures.js";

const NOW = "2026-07-16T00:00:00.000Z";

function baseInputs(overrides: Partial<DecisionDebtInputs> = {}): DecisionDebtInputs {
  return {
    decisions: [],
    implementationStates: [],
    drift: [],
    conflicts: [],
    supersessionIssues: [],
    missingDecisionFindings: [],
    assumptions: [],
    sourceIssues: [],
    links: [],
    dependencies: [],
    governanceStatusByDecisionId: new Map(),
    criticalityByDecisionId: new Map(),
    now: NOW,
    ...overrides,
  };
}

function categoriesOf(findings: { category: DecisionDebtCategory }[]): DecisionDebtCategory[] {
  return findings.map((f) => f.category);
}

describe("detectDecisionDebt: accepted_without_implementation", () => {
  it("fires when an accepted decision has status not_started implementation", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:a", status: "not_started" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    const finding = findings.find((f) => f.category === "accepted_without_implementation")!;
    expect(finding.id).toBe(buildDebtFindingId("accepted_without_implementation", "decision:a"));
    expect(finding.severity).toBe("review_required");
    expect(finding.requires_human_review).toBe(true);
  });

  it("is blocking only when the decision is explicitly criticality 'critical'", () => {
    const decision = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:b", status: "not_started" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state], criticalityByDecisionId: new Map([["decision:b", "critical"]]) }));
    expect(findings.find((f) => f.category === "accepted_without_implementation")!.severity).toBe("blocking");
  });

  it("does not fire when decision_status is not accepted", () => {
    const decision = architectureDecision({ id: "decision:c", decision_status: "proposed" });
    const state = decisionImplementationState({ decision_id: "decision:c", status: "not_started" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    expect(categoriesOf(findings)).not.toContain("accepted_without_implementation");
  });

  it("does not fire when implementation status is not not_started", () => {
    const decision = architectureDecision({ id: "decision:d", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:d", status: "partial" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    expect(categoriesOf(findings)).not.toContain("accepted_without_implementation");
  });
});

describe("detectDecisionDebt: implementation_regressed_from_decision", () => {
  it("passes the drift entry's severity through unchanged", () => {
    const drift = decisionDrift({ decision_id: "decision:e", cause: "implementation_regressed", severity: "blocking" });
    const findings = detectDecisionDebt(baseInputs({ drift: [drift] }));
    const finding = findings.find((f) => f.category === "implementation_regressed_from_decision")!;
    expect(finding.severity).toBe("blocking");
    expect(finding.requires_human_review).toBe(true);
  });

  it("does not fire for other drift causes", () => {
    const drift = decisionDrift({ decision_id: "decision:f", cause: "assumption_contradicted", severity: "review_required" });
    const findings = detectDecisionDebt(baseInputs({ drift: [drift] }));
    expect(categoriesOf(findings)).not.toContain("implementation_regressed_from_decision");
  });
});

describe("detectDecisionDebt: stale_proposed_decision", () => {
  it("fires at fixed advisory severity when a proposed decision exceeds the default 90-day threshold", () => {
    const decision = architectureDecision({ id: "decision:g", decision_status: "proposed", date: "2020-01-01T00:00:00.000Z" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    const finding = findings.find((f) => f.category === "stale_proposed_decision")!;
    expect(finding.severity).toBe("advisory");
    expect(finding.requires_human_review).toBe(true);
  });

  it("fires for draft and under_review too", () => {
    for (const status of ["draft", "under_review"] as const) {
      const decision = architectureDecision({ id: `decision:g-${status}`, decision_status: status, date: "2020-01-01T00:00:00.000Z" });
      const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
      expect(categoriesOf(findings)).toContain("stale_proposed_decision");
    }
  });

  it("does not fire when no date is present", () => {
    const decision = architectureDecision({ id: "decision:h", decision_status: "proposed", date: undefined });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    expect(categoriesOf(findings)).not.toContain("stale_proposed_decision");
  });

  it("does not fire when under the threshold", () => {
    const decision = architectureDecision({ id: "decision:i", decision_status: "proposed", date: "2026-07-10T00:00:00.000Z" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    expect(categoriesOf(findings)).not.toContain("stale_proposed_decision");
  });

  it("does not fire when the date is in the future relative to now", () => {
    const decision = architectureDecision({ id: "decision:j", decision_status: "proposed", date: "2030-01-01T00:00:00.000Z" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    expect(categoriesOf(findings)).not.toContain("stale_proposed_decision");
  });

  it("respects a caller-supplied staleProposedThresholdDays override", () => {
    const decision = architectureDecision({ id: "decision:k", decision_status: "proposed", date: "2026-07-10T00:00:00.000Z" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], staleProposedThresholdDays: 3 }));
    expect(categoriesOf(findings)).toContain("stale_proposed_decision");
  });

  it("does not fire for decision_status outside the stale-proposal set, however old", () => {
    const decision = architectureDecision({ id: "decision:l", decision_status: "accepted", date: "2020-01-01T00:00:00.000Z" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    expect(categoriesOf(findings)).not.toContain("stale_proposed_decision");
  });
});

describe("detectDecisionDebt: unresolved_conflict", () => {
  it("is blocking-capable for a confirmed conflict on a critical decision", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:m", "decision:n"], status: "confirmed" });
    const findings = detectDecisionDebt(baseInputs({ conflicts: [conflict], criticalityByDecisionId: new Map([["decision:m", "critical"]]) }));
    const finding = findings.find((f) => f.category === "unresolved_conflict" && f.decision_id === "decision:m")!;
    expect(finding.severity).toBe("blocking");
  });

  it("is review_required for a confirmed conflict on a non-critical decision", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:o", "decision:p"], status: "confirmed" });
    const findings = detectDecisionDebt(baseInputs({ conflicts: [conflict] }));
    expect(findings.find((f) => f.category === "unresolved_conflict" && f.decision_id === "decision:o")!.severity).toBe("review_required");
  });

  it("is advisory for a probable conflict", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:q", "decision:r"], status: "probable" });
    const findings = detectDecisionDebt(baseInputs({ conflicts: [conflict] }));
    expect(findings.every((f) => f.category !== "unresolved_conflict" || f.severity === "advisory")).toBe(true);
  });

  it("does not fire for resolved or unverifiable conflicts", () => {
    for (const status of ["resolved", "unverifiable"] as const) {
      const conflict = decisionConflict({ decision_ids: ["decision:s", "decision:t"], status });
      const findings = detectDecisionDebt(baseInputs({ conflicts: [conflict] }));
      expect(categoriesOf(findings)).not.toContain("unresolved_conflict");
    }
  });
});

describe("detectDecisionDebt: broken_supersession_chain", () => {
  it("fires for any supersession issue kind, not filtered by kind (unlike drift's supersession_target_removed)", () => {
    const issue = { id: "decision:supersession-issue:test-x", kind: "reciprocal_inconsistency" as const, decision_ids: ["decision:u"], detail: "detail", evidence_refs: [] };
    const findings = detectDecisionDebt(baseInputs({ supersessionIssues: [issue] }));
    expect(categoriesOf(findings)).toContain("broken_supersession_chain");
  });

  it("is blocking when any named decision is critical, else review_required", () => {
    const issue = { id: "decision:supersession-issue:test-y", kind: "missing_target" as const, decision_ids: ["decision:v"], detail: "detail", evidence_refs: [] };
    const findings = detectDecisionDebt(baseInputs({ supersessionIssues: [issue], criticalityByDecisionId: new Map([["decision:v", "critical"]]) }));
    expect(findings.find((f) => f.category === "broken_supersession_chain")!.severity).toBe("blocking");
  });
});

describe("detectDecisionDebt: missing_required_decision", () => {
  it("fires at fixed review_required, keyed by the finding's affected_entity_id", () => {
    const finding = missingDecisionFinding({ affected_entity_id: "entity-w" });
    const findings = detectDecisionDebt(baseInputs({ missingDecisionFindings: [finding] }));
    const debt = findings.find((f) => f.category === "missing_required_decision")!;
    expect(debt.severity).toBe("review_required");
    expect(debt.decision_id).toBe("entity-w");
    expect(debt.requires_human_review).toBe(true);
  });
});

describe("detectDecisionDebt: contradicted_assumption_unaddressed", () => {
  it("groups contradicted assumptions by decision and reports the count in detail", () => {
    const a1 = decisionAssumption({ decision_id: "decision:x", state: "contradicted" });
    const a2 = decisionAssumption({ decision_id: "decision:x", state: "contradicted" });
    const findings = detectDecisionDebt(baseInputs({ assumptions: [a1, a2] }));
    const finding = findings.find((f) => f.category === "contradicted_assumption_unaddressed")!;
    expect(finding.detail).toContain("2");
    expect(finding.requires_human_review).toBe(true);
  });

  it("is blocking only when the decision is explicitly criticality 'critical'", () => {
    const assumption = decisionAssumption({ decision_id: "decision:y", state: "contradicted" });
    const findings = detectDecisionDebt(baseInputs({ assumptions: [assumption], criticalityByDecisionId: new Map([["decision:y", "critical"]]) }));
    expect(findings.find((f) => f.category === "contradicted_assumption_unaddressed")!.severity).toBe("blocking");
  });

  it("does not fire for non-contradicted assumption states", () => {
    const assumption = decisionAssumption({ decision_id: "decision:z", state: "weakened" });
    const findings = detectDecisionDebt(baseInputs({ assumptions: [assumption] }));
    expect(categoriesOf(findings)).not.toContain("contradicted_assumption_unaddressed");
  });
});

describe("detectDecisionDebt: expired_policy_exception", () => {
  it("fires only when policyExceptionExpiredDecisionIds is supplied", () => {
    const findings = detectDecisionDebt(baseInputs({ policyExceptionExpiredDecisionIds: new Set(["decision:aa"]) }));
    const finding = findings.find((f) => f.category === "expired_policy_exception")!;
    expect(finding.severity).toBe("review_required");
    expect(finding.requires_human_review).toBe(true);
  });

  it("never fires when the set is not supplied", () => {
    const findings = detectDecisionDebt(baseInputs());
    expect(categoriesOf(findings)).not.toContain("expired_policy_exception");
  });
});

describe("detectDecisionDebt: unverifiable_governance_status", () => {
  it("is always advisory severity", () => {
    const findings = detectDecisionDebt(baseInputs({ governanceStatusByDecisionId: new Map([["decision:bb", "unverifiable"]]) }));
    expect(findings.find((f) => f.category === "unverifiable_governance_status")!.severity).toBe("advisory");
  });

  it("requires human review when criticality is critical or elevated", () => {
    for (const criticality of ["critical", "elevated"] as const) {
      const findings = detectDecisionDebt(
        baseInputs({ governanceStatusByDecisionId: new Map([["decision:cc", "unverifiable"]]), criticalityByDecisionId: new Map([["decision:cc", criticality]]) }),
      );
      expect(findings.find((f) => f.category === "unverifiable_governance_status")!.requires_human_review).toBe(true);
    }
  });

  it("does not require human review when criticality is standard or unresolved (\"no way to ask\" stays conservative but not auto-escalated to review)", () => {
    for (const criticality of ["standard", "unresolved", undefined] as const) {
      const findings = detectDecisionDebt(
        baseInputs({
          governanceStatusByDecisionId: new Map([["decision:dd", "unverifiable"]]),
          criticalityByDecisionId: criticality ? new Map([["decision:dd", criticality]]) : new Map(),
        }),
      );
      expect(findings.find((f) => f.category === "unverifiable_governance_status")!.requires_human_review).toBe(false);
    }
  });

  it("does not fire for other governance statuses", () => {
    for (const status of ["aligned", "review_required", "conflicting"] as const) {
      const findings = detectDecisionDebt(baseInputs({ governanceStatusByDecisionId: new Map([["decision:ee", status]]) }));
      expect(categoriesOf(findings)).not.toContain("unverifiable_governance_status");
    }
  });
});

describe("detectDecisionDebt: orphaned_decision -- never escalates to blocking", () => {
  it("fires review_required (never blocking) for a critical decision with no links or dependencies", () => {
    const decision = architectureDecision({ id: "decision:ff", decision_status: "accepted" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], criticalityByDecisionId: new Map([["decision:ff", "critical"]]) }));
    const finding = findings.find((f) => f.category === "orphaned_decision")!;
    expect(finding.severity).toBe("review_required");
    expect(finding.severity).not.toBe("blocking");
    expect(finding.requires_human_review).toBe(true);
  });

  it("fires advisory for a non-critical orphaned decision", () => {
    const decision = architectureDecision({ id: "decision:gg", decision_status: "implemented" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    const finding = findings.find((f) => f.category === "orphaned_decision")!;
    expect(finding.severity).toBe("advisory");
    expect(finding.requires_human_review).toBe(false);
  });

  it("does not fire when a resolved/partially_resolved link exists", () => {
    const decision = architectureDecision({ id: "decision:hh", decision_status: "accepted" });
    const link = decisionLink({ decision_id: "decision:hh", resolution: "resolved" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], links: [link] }));
    expect(categoriesOf(findings)).not.toContain("orphaned_decision");
  });

  it("does not fire when a dependency exists", () => {
    const decision = architectureDecision({ id: "decision:ii", decision_status: "accepted" });
    const dependency = decisionDependency({ from_decision_id: "decision:ii", to_decision_id: "decision:jj" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], dependencies: [dependency] }));
    expect(categoriesOf(findings)).not.toContain("orphaned_decision");
  });

  it("does not fire for decisions outside the active statuses", () => {
    const decision = architectureDecision({ id: "decision:kk", decision_status: "rejected" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision] }));
    expect(categoriesOf(findings)).not.toContain("orphaned_decision");
  });
});

describe("detectDecisionDebt: duplicate_decision_identity", () => {
  for (const kind of ["duplicate_id_exact", "duplicate_id_case_only", "multiple_files_claim_one_id", "id_reused_with_changed_content"] as const) {
    it(`${kind}: maps to duplicate_decision_identity at fixed review_required`, () => {
      const decision = architectureDecision({ id: "decision:ll", source: decisionSource({ repo_relative_path: "docs/adr/000l-example.md" }) });
      const issue = decisionSourceIssue({ kind, affected_paths: ["docs/adr/000l-example.md"] });
      const findings = detectDecisionDebt(baseInputs({ decisions: [decision], sourceIssues: [issue] }));
      const finding = findings.find((f) => f.category === "duplicate_decision_identity")!;
      expect(finding.severity).toBe("review_required");
      expect(finding.requires_human_review).toBe(true);
    });
  }
});

describe("detectDecisionDebt: unparseable_decision_document", () => {
  it("maps unparseable_structure issues to unparseable_decision_document at fixed review_required", () => {
    const decision = architectureDecision({ id: "decision:mm", source: decisionSource({ repo_relative_path: "docs/adr/000m-example.md" }) });
    const issue = decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/000m-example.md"] });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], sourceIssues: [issue] }));
    const finding = findings.find((f) => f.category === "unparseable_decision_document")!;
    expect(finding.severity).toBe("review_required");
    expect(finding.requires_human_review).toBe(true);
  });

  it("does not fire, and does not crash, for unsupported_source_type (no category mapping) or unmatched paths", () => {
    const issue = decisionSourceIssue({ kind: "unsupported_source_type", affected_paths: ["docs/adr/unmatched.md"] });
    const findings = detectDecisionDebt(baseInputs({ sourceIssues: [issue] }));
    expect(categoriesOf(findings)).not.toContain("unparseable_decision_document");
    expect(categoriesOf(findings)).not.toContain("duplicate_decision_identity");
  });
});

describe("detectDecisionDebt: incompatible_upstream_linkage -- the sole always-false requires_human_review category", () => {
  it("fires at fixed informational severity with requires_human_review always false", () => {
    const drift = decisionDrift({ decision_id: "decision:nn", cause: "upstream_artifact_incompatible", severity: "informational" });
    const findings = detectDecisionDebt(baseInputs({ drift: [drift], criticalityByDecisionId: new Map([["decision:nn", "critical"]]) }));
    const finding = findings.find((f) => f.category === "incompatible_upstream_linkage")!;
    expect(finding.severity).toBe("informational");
    expect(finding.requires_human_review).toBe(false);
  });
});

describe("detectDecisionDebt: criticality_unreviewed", () => {
  it("passes the drift entry's severity through unchanged, always requiring human review", () => {
    const drift = decisionDrift({ decision_id: "decision:oo", cause: "criticality_upgraded_without_review", severity: "blocking" });
    const findings = detectDecisionDebt(baseInputs({ drift: [drift] }));
    const finding = findings.find((f) => f.category === "criticality_unreviewed")!;
    expect(finding.severity).toBe("blocking");
    expect(finding.requires_human_review).toBe(true);
  });

  it("does not fire for other drift causes", () => {
    const drift = decisionDrift({ decision_id: "decision:pp", cause: "evidence_lineage_broken", severity: "advisory" });
    const findings = detectDecisionDebt(baseInputs({ drift: [drift] }));
    expect(categoriesOf(findings)).not.toContain("criticality_unreviewed");
  });
});

describe("detectDecisionDebt: exactly 14 named categories in the contract", () => {
  const ALL_CATEGORIES: DecisionDebtCategory[] = [
    "accepted_without_implementation",
    "implementation_regressed_from_decision",
    "stale_proposed_decision",
    "unresolved_conflict",
    "broken_supersession_chain",
    "missing_required_decision",
    "contradicted_assumption_unaddressed",
    "expired_policy_exception",
    "unverifiable_governance_status",
    "orphaned_decision",
    "duplicate_decision_identity",
    "unparseable_decision_document",
    "incompatible_upstream_linkage",
    "criticality_unreviewed",
  ];

  it("has 14 distinct category names", () => {
    expect(ALL_CATEGORIES).toHaveLength(14);
    expect(new Set(ALL_CATEGORIES).size).toBe(14);
  });
});

describe("detectDecisionDebt: no cost or effort estimation anywhere", () => {
  it("a debt finding exposes only the documented fields -- no cost, effort, hours, points, or estimate field of any kind", () => {
    const decision = architectureDecision({ id: "decision:qq", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:qq", status: "not_started" });
    const [finding] = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    const keys = Object.keys(finding).sort();
    expect(keys).toEqual(["blast_radius_id", "category", "decision_id", "detail", "evidence_refs", "id", "requires_human_review", "resolution_state", "severity"]);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/cost|effort|hour|point|estimate|budget|price/);
    }
  });

  it("every finding's resolution_state is always 'open' at detection time, regardless of input", () => {
    const decision = architectureDecision({ id: "decision:rr", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:rr", status: "not_started" });
    const findings = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    expect(findings.every((f) => f.resolution_state === "open")).toBe(true);
  });

  it("blast_radius_id is populated only from the optional blastRadiusIdByDecisionId map, undefined otherwise", () => {
    const decision = architectureDecision({ id: "decision:ss", decision_status: "accepted" });
    const state = decisionImplementationState({ decision_id: "decision:ss", status: "not_started" });
    const withoutMap = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state] }));
    expect(withoutMap[0].blast_radius_id).toBeUndefined();

    const withMap = detectDecisionDebt(baseInputs({ decisions: [decision], implementationStates: [state], blastRadiusIdByDecisionId: new Map([["decision:ss", "decision:blast-radius:decision:ss"]]) }));
    expect(withMap[0].blast_radius_id).toBe("decision:blast-radius:decision:ss");
  });
});

describe("detectDecisionDebt: dedupe and sorting", () => {
  it("sorts findings by id, not input order", () => {
    const decisions = [architectureDecision({ id: "decision:zz", decision_status: "accepted" }), architectureDecision({ id: "decision:aa2", decision_status: "accepted" })];
    const states = [decisionImplementationState({ decision_id: "decision:zz", status: "not_started" }), decisionImplementationState({ decision_id: "decision:aa2", status: "not_started" })];
    const findings = detectDecisionDebt(baseInputs({ decisions, implementationStates: states }));
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty array for entirely empty inputs", () => {
    expect(detectDecisionDebt(baseInputs())).toEqual([]);
  });
});
