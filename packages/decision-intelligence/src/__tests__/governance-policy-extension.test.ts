import { describe, expect, it } from "vitest";
import { buildDecisionGovernanceContext, type BuildDecisionGovernanceContextInput } from "../governance-policy-extension.js";
import { decisionAssumption, decisionConflict, decisionDrift, decisionLink, missingDecisionFinding } from "./decision-fixtures.js";

function emptyInput(overrides: Partial<BuildDecisionGovernanceContextInput> = {}): BuildDecisionGovernanceContextInput {
  return {
    missingDecisionFindings: [],
    assumptions: [],
    conflicts: [],
    governanceLinks: [],
    drift: [],
    ...overrides,
  };
}

describe("buildDecisionGovernanceContext: empty input", () => {
  it("produces a context with all six fields as empty arrays when every input list is empty", () => {
    const context = buildDecisionGovernanceContext(emptyInput());
    expect(context).toEqual({
      changes_missing_decision: [],
      decisions_with_contradicted_assumptions: [],
      decisions_active_and_superseded: [],
      exceptions_with_invalid_decision_ref: [],
      unresolved_conflict_decision_ids: [],
      decisions_requiring_review_for_drift: [],
    });
  });
});

describe("buildDecisionGovernanceContext: changes_missing_decision", () => {
  it("collects affected_entity_id from every missing-decision finding", () => {
    const findings = [missingDecisionFinding({ affected_entity_id: "entity:a" }), missingDecisionFinding({ affected_entity_id: "entity:b" })];
    const context = buildDecisionGovernanceContext(emptyInput({ missingDecisionFindings: findings }));
    expect(context.changes_missing_decision).toEqual(["entity:a", "entity:b"]);
  });

  it("sorts and deduplicates affected entity ids", () => {
    const findings = [
      missingDecisionFinding({ affected_entity_id: "entity:b" }),
      missingDecisionFinding({ affected_entity_id: "entity:a" }),
      missingDecisionFinding({ affected_entity_id: "entity:a" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ missingDecisionFindings: findings }));
    expect(context.changes_missing_decision).toEqual(["entity:a", "entity:b"]);
  });
});

describe("buildDecisionGovernanceContext: decisions_with_contradicted_assumptions", () => {
  it("includes only assumptions whose state is 'contradicted'", () => {
    const assumptions = [
      decisionAssumption({ decision_id: "decision:a", state: "contradicted" }),
      decisionAssumption({ decision_id: "decision:b", state: "confirmed" }),
      decisionAssumption({ decision_id: "decision:c", state: "supported" }),
      decisionAssumption({ decision_id: "decision:d", state: "weakened" }),
      decisionAssumption({ decision_id: "decision:e", state: "unverifiable" }),
      decisionAssumption({ decision_id: "decision:f", state: "retired" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ assumptions }));
    expect(context.decisions_with_contradicted_assumptions).toEqual(["decision:a"]);
  });

  it("sorts and deduplicates decision ids across multiple contradicted assumptions on the same decision", () => {
    const assumptions = [
      decisionAssumption({ decision_id: "decision:b", state: "contradicted" }),
      decisionAssumption({ decision_id: "decision:a", state: "contradicted" }),
      decisionAssumption({ decision_id: "decision:a", state: "contradicted" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ assumptions }));
    expect(context.decisions_with_contradicted_assumptions).toEqual(["decision:a", "decision:b"]);
  });
});

describe("buildDecisionGovernanceContext: decisions_active_and_superseded", () => {
  it("includes both decision_ids from a conflict of kind 'active_and_superseded_simultaneously'", () => {
    const conflicts = [decisionConflict({ decision_ids: ["decision:a", "decision:b"], kind: "active_and_superseded_simultaneously" })];
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.decisions_active_and_superseded).toEqual(["decision:a", "decision:b"]);
  });

  it("excludes conflicts of any other kind", () => {
    const conflicts = [
      decisionConflict({ decision_ids: ["decision:a", "decision:b"], kind: "incompatible_required_states" }),
      decisionConflict({ decision_ids: ["decision:c", "decision:d"], kind: "mutually_exclusive_requirements" }),
      decisionConflict({ decision_ids: ["decision:e", "decision:f"], kind: "accepted_depends_on_rejected" }),
      decisionConflict({ decision_ids: ["decision:g", "decision:h"], kind: "incompatible_baseline_policy_linkage" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.decisions_active_and_superseded).toEqual([]);
  });

  it("sorts and deduplicates across multiple qualifying conflicts", () => {
    const conflicts = [
      decisionConflict({ decision_ids: ["decision:b", "decision:c"], kind: "active_and_superseded_simultaneously" }),
      decisionConflict({ decision_ids: ["decision:a", "decision:b"], kind: "active_and_superseded_simultaneously" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.decisions_active_and_superseded).toEqual(["decision:a", "decision:b", "decision:c"]);
  });
});

describe("buildDecisionGovernanceContext: exceptions_with_invalid_decision_ref", () => {
  it("includes an 'excepts'/'governance' link whose resolution is not 'resolved'", () => {
    const links = [decisionLink({ decision_id: "decision:a", link_type: "excepts", target_domain: "governance", resolution: "unresolved" })];
    const context = buildDecisionGovernanceContext(emptyInput({ governanceLinks: links }));
    expect(context.exceptions_with_invalid_decision_ref).toEqual(["decision:a"]);
  });

  it("excludes an 'excepts'/'governance' link whose resolution is 'resolved'", () => {
    const links = [decisionLink({ decision_id: "decision:a", link_type: "excepts", target_domain: "governance", resolution: "resolved" })];
    const context = buildDecisionGovernanceContext(emptyInput({ governanceLinks: links }));
    expect(context.exceptions_with_invalid_decision_ref).toEqual([]);
  });

  it("excludes links whose link_type is not 'excepts', even when unresolved and targeting governance", () => {
    const links = [decisionLink({ decision_id: "decision:a", link_type: "governs", target_domain: "governance", resolution: "unresolved" })];
    const context = buildDecisionGovernanceContext(emptyInput({ governanceLinks: links }));
    expect(context.exceptions_with_invalid_decision_ref).toEqual([]);
  });

  it("excludes links whose target_domain is not 'governance', even when unresolved and of link_type 'excepts'", () => {
    const links = [decisionLink({ decision_id: "decision:a", link_type: "excepts", target_domain: "architecture", resolution: "unresolved" })];
    const context = buildDecisionGovernanceContext(emptyInput({ governanceLinks: links }));
    expect(context.exceptions_with_invalid_decision_ref).toEqual([]);
  });

  it("treats every non-'resolved' resolution value as invalid", () => {
    const links = (["partially_resolved", "unresolved", "ambiguous", "incompatible"] as const).map((resolution, index) =>
      decisionLink({ decision_id: `decision:${index}`, link_type: "excepts", target_domain: "governance", resolution }),
    );
    const context = buildDecisionGovernanceContext(emptyInput({ governanceLinks: links }));
    expect(context.exceptions_with_invalid_decision_ref).toEqual(["decision:0", "decision:1", "decision:2", "decision:3"]);
  });
});

describe("buildDecisionGovernanceContext: unresolved_conflict_decision_ids", () => {
  it("excludes conflicts whose status is 'resolved'", () => {
    const conflicts = [decisionConflict({ decision_ids: ["decision:a", "decision:b"], status: "resolved" })];
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.unresolved_conflict_decision_ids).toEqual([]);
  });

  it("treats confirmed/probable/possible/unverifiable statuses as still outstanding", () => {
    const conflicts = (["confirmed", "probable", "possible", "unverifiable"] as const).map((status, index) =>
      decisionConflict({ decision_ids: [`decision:${index}a`, `decision:${index}b`], status }),
    );
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.unresolved_conflict_decision_ids).toEqual(["decision:0a", "decision:0b", "decision:1a", "decision:1b", "decision:2a", "decision:2b", "decision:3a", "decision:3b"]);
  });

  it("sorts and deduplicates ids across multiple unresolved conflicts", () => {
    const conflicts = [decisionConflict({ decision_ids: ["decision:b", "decision:a"], status: "confirmed" }), decisionConflict({ decision_ids: ["decision:a", "decision:c"], status: "possible" })];
    const context = buildDecisionGovernanceContext(emptyInput({ conflicts }));
    expect(context.unresolved_conflict_decision_ids).toEqual(["decision:a", "decision:b", "decision:c"]);
  });
});

describe("buildDecisionGovernanceContext: decisions_requiring_review_for_drift", () => {
  it("includes drift entries with severity 'blocking' or 'review_required'", () => {
    const drift = [decisionDrift({ decision_id: "decision:a", severity: "blocking" }), decisionDrift({ decision_id: "decision:b", severity: "review_required" })];
    const context = buildDecisionGovernanceContext(emptyInput({ drift }));
    expect(context.decisions_requiring_review_for_drift).toEqual(["decision:a", "decision:b"]);
  });

  it("excludes advisory/informational drift on their own", () => {
    const drift = [decisionDrift({ decision_id: "decision:a", severity: "advisory" }), decisionDrift({ decision_id: "decision:b", severity: "informational" })];
    const context = buildDecisionGovernanceContext(emptyInput({ drift }));
    expect(context.decisions_requiring_review_for_drift).toEqual([]);
  });

  it("sorts and deduplicates decision ids across multiple qualifying drift entries", () => {
    const drift = [
      decisionDrift({ decision_id: "decision:b", severity: "blocking" }),
      decisionDrift({ decision_id: "decision:a", severity: "review_required" }),
      decisionDrift({ decision_id: "decision:a", severity: "blocking" }),
    ];
    const context = buildDecisionGovernanceContext(emptyInput({ drift }));
    expect(context.decisions_requiring_review_for_drift).toEqual(["decision:a", "decision:b"]);
  });
});

describe("buildDecisionGovernanceContext: field independence", () => {
  it("populating one field's source data never populates any of the other five fields", () => {
    const context = buildDecisionGovernanceContext(emptyInput({ missingDecisionFindings: [missingDecisionFinding({ affected_entity_id: "entity:a" })] }));
    expect(context.changes_missing_decision).toEqual(["entity:a"]);
    expect(context.decisions_with_contradicted_assumptions).toEqual([]);
    expect(context.decisions_active_and_superseded).toEqual([]);
    expect(context.exceptions_with_invalid_decision_ref).toEqual([]);
    expect(context.unresolved_conflict_decision_ids).toEqual([]);
    expect(context.decisions_requiring_review_for_drift).toEqual([]);
  });
});

describe("buildDecisionGovernanceContext: determinism", () => {
  it("is a pure function: calling it twice over identical input produces byte-identical output", () => {
    const input = emptyInput({
      missingDecisionFindings: [missingDecisionFinding({ affected_entity_id: "entity:a" })],
      assumptions: [decisionAssumption({ decision_id: "decision:a", state: "contradicted" })],
      conflicts: [decisionConflict({ decision_ids: ["decision:a", "decision:b"], kind: "active_and_superseded_simultaneously", status: "confirmed" })],
      governanceLinks: [decisionLink({ decision_id: "decision:c", link_type: "excepts", target_domain: "governance", resolution: "unresolved" })],
      drift: [decisionDrift({ decision_id: "decision:d", severity: "blocking" })],
    });
    const first = buildDecisionGovernanceContext(input);
    const second = buildDecisionGovernanceContext(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("buildDecisionGovernanceContext: opt-in construction never happens implicitly", () => {
  it("the context-builder never runs on its own -- it always requires an explicit call with explicit decision-intelligence artifacts, so a caller that never invokes it (no decision snapshot for this comparison) never produces a decisionContext value to hand to governance-intelligence's optional 5th domain in the first place", () => {
    expect(typeof buildDecisionGovernanceContext).toBe("function");
    const context = buildDecisionGovernanceContext(emptyInput());
    expect(Object.keys(context).sort()).toEqual(
      [
        "changes_missing_decision",
        "decisions_active_and_superseded",
        "decisions_requiring_review_for_drift",
        "decisions_with_contradicted_assumptions",
        "exceptions_with_invalid_decision_ref",
        "unresolved_conflict_decision_ids",
      ].sort(),
    );
  });
});
