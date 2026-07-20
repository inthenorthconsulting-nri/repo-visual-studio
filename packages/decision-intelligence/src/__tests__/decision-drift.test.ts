import { describe, expect, it } from "vitest";
import { detectDecisionDrift, type DecisionDriftInputs, type DecisionDriftPreviousState } from "../decision-drift.js";
import { buildDriftId } from "../ids.js";
import type { DecisionCriticality, DecisionDriftCause } from "../contracts.js";
import { architectureDecision, decisionAssumption, decisionConflict, decisionLink, decisionSource, decisionSourceIssue, decisionSupersessionIssue } from "./decision-fixtures.js";

function baseInputs(overrides: Partial<DecisionDriftInputs> = {}): DecisionDriftInputs {
  return {
    decisions: [],
    assumptions: [],
    links: [],
    conflicts: [],
    supersessionIssues: [],
    sourceIssues: [],
    criticalityByDecisionId: new Map(),
    implementationStatusByDecisionId: new Map(),
    governanceStatusByDecisionId: new Map(),
    ...overrides,
  };
}

function emptyPrevious(overrides: Partial<DecisionDriftPreviousState> = {}): DecisionDriftPreviousState {
  return {
    linkResolutionById: new Map(),
    implementationStatusByDecisionId: new Map(),
    governanceStatusByDecisionId: new Map(),
    conflictIds: new Set(),
    criticalityByDecisionId: new Map(),
    ...overrides,
  };
}

function causesOf(drift: { cause: DecisionDriftCause }[]): DecisionDriftCause[] {
  return drift.map((d) => d.cause);
}

describe("detectDecisionDrift: linked_entity_removed", () => {
  it("fires when a link was resolved in the previous snapshot but is unresolved now", () => {
    const link = decisionLink({ id: "decision:link:1", decision_id: "decision:a", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous }));
    expect(causesOf(drift)).toContain("linked_entity_removed");
    const entry = drift.find((d) => d.cause === "linked_entity_removed")!;
    expect(entry.id).toBe(buildDriftId("decision:a", "linked_entity_removed"));
    expect(entry.severity).toBe("review_required");
  });

  it("also fires when the previous resolution was partially_resolved", () => {
    const link = decisionLink({ id: "decision:link:2", decision_id: "decision:b", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "partially_resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous }));
    expect(causesOf(drift)).toContain("linked_entity_removed");
  });

  it("does not fire without a previous snapshot, even for an unresolved link", () => {
    const link = decisionLink({ id: "decision:link:3", decision_id: "decision:c", resolution: "unresolved" });
    const drift = detectDecisionDrift(baseInputs({ links: [link] }));
    expect(causesOf(drift)).not.toContain("linked_entity_removed");
  });

  it("blocking only when the decision is explicitly criticality 'critical'", () => {
    const link = decisionLink({ id: "decision:link:4", decision_id: "decision:d", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous, criticalityByDecisionId: new Map([["decision:d", "critical"]]) }));
    expect(drift.find((d) => d.cause === "linked_entity_removed")!.severity).toBe("blocking");
  });
});

describe("detectDecisionDrift: linked_entity_materially_changed", () => {
  it("fires only when materiallyChangedEntityIds is supplied and names the link's target", () => {
    const link = decisionLink({ decision_id: "decision:e", resolution: "resolved", target_id: "entity-x" });
    const drift = detectDecisionDrift(baseInputs({ links: [link], materiallyChangedEntityIds: new Set(["entity-x"]) }));
    expect(causesOf(drift)).toContain("linked_entity_materially_changed");
  });

  it("never fires when materiallyChangedEntityIds is not supplied at all", () => {
    const link = decisionLink({ decision_id: "decision:e", resolution: "resolved", target_id: "entity-x" });
    const drift = detectDecisionDrift(baseInputs({ links: [link] }));
    expect(causesOf(drift)).not.toContain("linked_entity_materially_changed");
  });

  it("is a soft-weight cause: advisory by default, review_required only when criticality is elevated or critical", () => {
    const link = decisionLink({ decision_id: "decision:f", resolution: "resolved", target_id: "entity-y" });
    const advisory = detectDecisionDrift(baseInputs({ links: [link], materiallyChangedEntityIds: new Set(["entity-y"]) }));
    expect(advisory.find((d) => d.cause === "linked_entity_materially_changed")!.severity).toBe("advisory");

    const elevated = detectDecisionDrift(baseInputs({ links: [link], materiallyChangedEntityIds: new Set(["entity-y"]), criticalityByDecisionId: new Map([["decision:f", "elevated"]]) }));
    expect(elevated.find((d) => d.cause === "linked_entity_materially_changed")!.severity).toBe("review_required");
  });

  it("never escalates to blocking, even when criticality is 'critical' (soft-weight causes cap at review_required)", () => {
    const link = decisionLink({ decision_id: "decision:g", resolution: "resolved", target_id: "entity-z" });
    const drift = detectDecisionDrift(baseInputs({ links: [link], materiallyChangedEntityIds: new Set(["entity-z"]), criticalityByDecisionId: new Map([["decision:g", "critical"]]) }));
    expect(drift.find((d) => d.cause === "linked_entity_materially_changed")!.severity).toBe("review_required");
  });
});

describe("detectDecisionDrift: assumption_contradicted", () => {
  it("fires when an assumption's state is contradicted", () => {
    const assumption = decisionAssumption({ decision_id: "decision:h", state: "contradicted" });
    const drift = detectDecisionDrift(baseInputs({ assumptions: [assumption] }));
    expect(causesOf(drift)).toContain("assumption_contradicted");
    expect(drift.find((d) => d.cause === "assumption_contradicted")!.severity).toBe("review_required");
  });

  it("does not fire for any other assumption state", () => {
    for (const state of ["confirmed", "supported", "weakened", "unverifiable", "retired"] as const) {
      const assumption = decisionAssumption({ decision_id: "decision:h", state });
      const drift = detectDecisionDrift(baseInputs({ assumptions: [assumption] }));
      expect(causesOf(drift)).not.toContain("assumption_contradicted");
    }
  });
});

describe("detectDecisionDrift: implementation_regressed", () => {
  it("fires when status regresses from implemented/partial to not_started/unverifiable", () => {
    const previous = emptyPrevious({ implementationStatusByDecisionId: new Map([["decision:i", "implemented"]]) });
    const drift = detectDecisionDrift(baseInputs({ implementationStatusByDecisionId: new Map([["decision:i", "not_started"]]), previous }));
    expect(causesOf(drift)).toContain("implementation_regressed");
  });

  it("fires from partial to unverifiable", () => {
    const previous = emptyPrevious({ implementationStatusByDecisionId: new Map([["decision:j", "partial"]]) });
    const drift = detectDecisionDrift(baseInputs({ implementationStatusByDecisionId: new Map([["decision:j", "unverifiable"]]), previous }));
    expect(causesOf(drift)).toContain("implementation_regressed");
  });

  it("does not fire without a previous snapshot, even given a 'broken-looking' current status", () => {
    const drift = detectDecisionDrift(baseInputs({ implementationStatusByDecisionId: new Map([["decision:k", "not_started"]]) }));
    expect(causesOf(drift)).not.toContain("implementation_regressed");
  });

  it("does not fire when the previous status was already broken (not a regression)", () => {
    const previous = emptyPrevious({ implementationStatusByDecisionId: new Map([["decision:l", "not_started"]]) });
    const drift = detectDecisionDrift(baseInputs({ implementationStatusByDecisionId: new Map([["decision:l", "unverifiable"]]), previous }));
    expect(causesOf(drift)).not.toContain("implementation_regressed");
  });
});

describe("detectDecisionDrift: governance_status_downgraded", () => {
  it("fires and is hard-weight when the new status is 'conflicting'", () => {
    const previous = emptyPrevious({ governanceStatusByDecisionId: new Map([["decision:m", "aligned"]]) });
    const drift = detectDecisionDrift(baseInputs({ governanceStatusByDecisionId: new Map([["decision:m", "conflicting"]]), previous }));
    const entry = drift.find((d) => d.cause === "governance_status_downgraded")!;
    expect(entry.severity).toBe("review_required");
  });

  it("is advisory when downgraded to review_required or unverifiable (not 'conflicting')", () => {
    for (const to of ["review_required", "unverifiable"] as const) {
      const previous = emptyPrevious({ governanceStatusByDecisionId: new Map([["decision:n", "aligned"]]) });
      const drift = detectDecisionDrift(baseInputs({ governanceStatusByDecisionId: new Map([["decision:n", to]]), previous }));
      expect(drift.find((d) => d.cause === "governance_status_downgraded")!.severity).toBe("advisory");
    }
  });

  it("does not fire without a previous snapshot", () => {
    const drift = detectDecisionDrift(baseInputs({ governanceStatusByDecisionId: new Map([["decision:o", "conflicting"]]) }));
    expect(causesOf(drift)).not.toContain("governance_status_downgraded");
  });

  it("does not fire when the status is unchanged or improves", () => {
    const previous = emptyPrevious({ governanceStatusByDecisionId: new Map([["decision:p", "conflicting"]]) });
    const drift = detectDecisionDrift(baseInputs({ governanceStatusByDecisionId: new Map([["decision:p", "aligned"]]), previous }));
    expect(causesOf(drift)).not.toContain("governance_status_downgraded");
  });

  it("can reach blocking only when the decision is explicitly criticality 'critical' AND the downgrade is to conflicting", () => {
    const previous = emptyPrevious({ governanceStatusByDecisionId: new Map([["decision:q", "aligned"]]) });
    const drift = detectDecisionDrift(baseInputs({ governanceStatusByDecisionId: new Map([["decision:q", "conflicting"]]), previous, criticalityByDecisionId: new Map([["decision:q", "critical"]]) }));
    expect(drift.find((d) => d.cause === "governance_status_downgraded")!.severity).toBe("blocking");
  });
});

describe("detectDecisionDrift: upstream_artifact_incompatible", () => {
  it("fires only when incompatibleUpstreamDomains is supplied and matches the link's domain, and is always informational", () => {
    const link = decisionLink({ decision_id: "decision:r", target_domain: "portfolio" });
    const drift = detectDecisionDrift(baseInputs({ links: [link], incompatibleUpstreamDomains: new Set(["portfolio"]), criticalityByDecisionId: new Map([["decision:r", "critical"]]) }));
    const entry = drift.find((d) => d.cause === "upstream_artifact_incompatible")!;
    expect(entry.severity).toBe("informational");
  });

  it("never fires when incompatibleUpstreamDomains is not supplied", () => {
    const link = decisionLink({ decision_id: "decision:r", target_domain: "portfolio" });
    const drift = detectDecisionDrift(baseInputs({ links: [link] }));
    expect(causesOf(drift)).not.toContain("upstream_artifact_incompatible");
  });
});

describe("detectDecisionDrift: supersession_target_removed", () => {
  it("fires for a missing_target supersession issue", () => {
    const issue = decisionSupersessionIssue({ kind: "missing_target", decision_ids: ["decision:s"] });
    const drift = detectDecisionDrift(baseInputs({ supersessionIssues: [issue] }));
    expect(causesOf(drift)).toContain("supersession_target_removed");
    expect(drift.find((d) => d.cause === "supersession_target_removed")!.severity).toBe("review_required");
  });

  it("does not fire for other supersession issue kinds", () => {
    for (const kind of ["reciprocal_inconsistency", "multiple_active_superseders", "supersession_cycle"] as const) {
      const issue = decisionSupersessionIssue({ kind, decision_ids: ["decision:t"] });
      const drift = detectDecisionDrift(baseInputs({ supersessionIssues: [issue] }));
      expect(causesOf(drift)).not.toContain("supersession_target_removed");
    }
  });

  it("does not crash and does not fire when decision_ids is empty", () => {
    const issue = decisionSupersessionIssue({ kind: "missing_target", decision_ids: [] });
    const drift = detectDecisionDrift(baseInputs({ supersessionIssues: [issue] }));
    expect(causesOf(drift)).not.toContain("supersession_target_removed");
  });
});

describe("detectDecisionDrift: conflict_introduced", () => {
  it("fires for a confirmed conflict not present in the previous snapshot, hard-weight", () => {
    const conflict = decisionConflict({ id: "decision:conflict:new", decision_ids: ["decision:u", "decision:v"], status: "confirmed" });
    const previous = emptyPrevious();
    const drift = detectDecisionDrift(baseInputs({ conflicts: [conflict], previous }));
    const entries = drift.filter((d) => d.cause === "conflict_introduced");
    expect(entries.map((e) => e.decision_id).sort()).toEqual(["decision:u", "decision:v"]);
    expect(entries.every((e) => e.severity === "review_required")).toBe(true);
  });

  it("is advisory for a 'probable' (not confirmed) conflict", () => {
    const conflict = decisionConflict({ id: "decision:conflict:probable", decision_ids: ["decision:w", "decision:x"], status: "probable" });
    const previous = emptyPrevious();
    const drift = detectDecisionDrift(baseInputs({ conflicts: [conflict], previous }));
    expect(drift.filter((d) => d.cause === "conflict_introduced").every((e) => e.severity === "advisory")).toBe(true);
  });

  it("does not fire when the conflict id was already present in the previous snapshot", () => {
    const conflict = decisionConflict({ id: "decision:conflict:known", decision_ids: ["decision:y", "decision:z"], status: "confirmed" });
    const previous = emptyPrevious({ conflictIds: new Set([conflict.id]) });
    const drift = detectDecisionDrift(baseInputs({ conflicts: [conflict], previous }));
    expect(causesOf(drift)).not.toContain("conflict_introduced");
  });

  it("does not fire without a previous snapshot", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:aa", "decision:bb"], status: "confirmed" });
    const drift = detectDecisionDrift(baseInputs({ conflicts: [conflict] }));
    expect(causesOf(drift)).not.toContain("conflict_introduced");
  });

  it("derives severity from the first decision id's criticality for both pushed entries, not per-decision criticality", () => {
    const conflict = decisionConflict({ id: "decision:conflict:asymmetric", decision_ids: ["decision:cc", "decision:dd"], status: "confirmed" });
    const previous = emptyPrevious();
    const drift = detectDecisionDrift(baseInputs({ conflicts: [conflict], previous, criticalityByDecisionId: new Map([["decision:cc", "critical"]]) }));
    const entries = drift.filter((d) => d.cause === "conflict_introduced");
    expect(entries.find((e) => e.decision_id === "decision:cc")!.severity).toBe("blocking");
    expect(entries.find((e) => e.decision_id === "decision:dd")!.severity).toBe("blocking");
  });
});

describe("detectDecisionDrift: coverage_regressed is never emitted", () => {
  it("does not appear in output even when many other causes fire simultaneously", () => {
    const link = decisionLink({ id: "decision:link:cov", decision_id: "decision:ee", resolution: "unresolved" });
    const previous = emptyPrevious({
      linkResolutionById: new Map([[link.id, "resolved"]]),
      implementationStatusByDecisionId: new Map([["decision:ee", "implemented"]]),
      governanceStatusByDecisionId: new Map([["decision:ee", "aligned"]]),
      criticalityByDecisionId: new Map([["decision:ee", "standard"]]),
    });
    const drift = detectDecisionDrift(
      baseInputs({
        links: [link],
        implementationStatusByDecisionId: new Map([["decision:ee", "not_started"]]),
        governanceStatusByDecisionId: new Map([["decision:ee", "conflicting"]]),
        criticalityByDecisionId: new Map([["decision:ee", "critical"]]),
        previous,
      }),
    );
    expect(drift.length).toBeGreaterThan(0);
    expect(causesOf(drift)).not.toContain("coverage_regressed");
  });

  it("the underlying link-flip fact is instead reported once as linked_entity_removed, not duplicated as coverage_regressed", () => {
    const link = decisionLink({ id: "decision:link:ff", decision_id: "decision:ff", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous }));
    expect(causesOf(drift)).toContain("linked_entity_removed");
    expect(causesOf(drift)).not.toContain("coverage_regressed");
  });
});

describe("detectDecisionDrift: criticality_upgraded_without_review", () => {
  it("fires blocking when upgraded to critical", () => {
    const previous = emptyPrevious({ criticalityByDecisionId: new Map([["decision:gg", "standard"]]) });
    const drift = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:gg", "critical"]]), previous }));
    expect(drift.find((d) => d.cause === "criticality_upgraded_without_review")!.severity).toBe("blocking");
  });

  it("fires review_required when upgraded to elevated (not critical)", () => {
    const previous = emptyPrevious({ criticalityByDecisionId: new Map([["decision:hh", "standard"]]) });
    const drift = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:hh", "elevated"]]), previous }));
    expect(drift.find((d) => d.cause === "criticality_upgraded_without_review")!.severity).toBe("review_required");
  });

  it("does not fire without a previous snapshot", () => {
    const drift = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:ii", "critical"]]) }));
    expect(causesOf(drift)).not.toContain("criticality_upgraded_without_review");
  });

  it("does not fire when criticality is unchanged or downgraded", () => {
    const previous = emptyPrevious({ criticalityByDecisionId: new Map([["decision:jj", "critical"]]) });
    const drift = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:jj", "standard"]]), previous }));
    expect(causesOf(drift)).not.toContain("criticality_upgraded_without_review");
  });

  it("skips when either side is 'unresolved' -- an unresolved criticality is never treated as an upgrade", () => {
    const previousUnresolved = emptyPrevious({ criticalityByDecisionId: new Map([["decision:kk", "unresolved"]]) });
    const driftA = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:kk", "critical"]]), previous: previousUnresolved }));
    expect(causesOf(driftA)).not.toContain("criticality_upgraded_without_review");

    const previousCritical = emptyPrevious({ criticalityByDecisionId: new Map([["decision:ll", "critical"]]) });
    const driftB = detectDecisionDrift(baseInputs({ criticalityByDecisionId: new Map([["decision:ll", "unresolved"]]), previous: previousCritical }));
    expect(causesOf(driftB)).not.toContain("criticality_upgraded_without_review");
  });
});

describe("detectDecisionDrift: evidence_lineage_broken -- a stale-looking decision never automatically becomes blocking", () => {
  it("fires, always at advisory, for an active decision with zero evidence refs", () => {
    const decision = architectureDecision({ id: "decision:mm", decision_status: "accepted", evidence_refs: [] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision] }));
    expect(drift.find((d) => d.cause === "evidence_lineage_broken")!.severity).toBe("advisory");
  });

  it("stays advisory even when the decision is explicitly criticality 'critical' -- severity is hardcoded, not derived from criticality", () => {
    const decision = architectureDecision({ id: "decision:nn", decision_status: "implemented", evidence_refs: [] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision], criticalityByDecisionId: new Map([["decision:nn", "critical"]]) }));
    expect(drift.find((d) => d.cause === "evidence_lineage_broken")!.severity).toBe("advisory");
  });

  it("does not fire for a decision outside the active statuses, even with zero evidence", () => {
    const decision = architectureDecision({ id: "decision:oo", decision_status: "draft", evidence_refs: [] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision] }));
    expect(causesOf(drift)).not.toContain("evidence_lineage_broken");
  });

  it("does not fire when evidence_refs is non-empty", () => {
    const decision = architectureDecision({ id: "decision:pp", decision_status: "accepted" });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision] }));
    expect(causesOf(drift)).not.toContain("evidence_lineage_broken");
  });
});

describe("detectDecisionDrift: decision_document_unparseable", () => {
  it("fires at a fixed review_required severity, matched by source path", () => {
    const decision = architectureDecision({ id: "decision:qq", source: decisionSource({ repo_relative_path: "docs/adr/000q-example.md" }) });
    const issue = decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/000q-example.md"] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision], sourceIssues: [issue] }));
    expect(drift.find((d) => d.cause === "decision_document_unparseable")!.severity).toBe("review_required");
  });

  it("stays review_required even when criticality is 'critical' -- never escalates to blocking from a stale/broken document alone", () => {
    const decision = architectureDecision({ id: "decision:rr", source: decisionSource({ repo_relative_path: "docs/adr/000r-example.md" }) });
    const issue = decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/000r-example.md"] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision], sourceIssues: [issue], criticalityByDecisionId: new Map([["decision:rr", "critical"]]) }));
    expect(drift.find((d) => d.cause === "decision_document_unparseable")!.severity).toBe("review_required");
  });

  it("does not fire for other source issue kinds", () => {
    const decision = architectureDecision({ id: "decision:ss", source: decisionSource({ repo_relative_path: "docs/adr/000s-example.md" }) });
    const issue = decisionSourceIssue({ kind: "duplicate_id_exact", affected_paths: ["docs/adr/000s-example.md"] });
    const drift = detectDecisionDrift(baseInputs({ decisions: [decision], sourceIssues: [issue] }));
    expect(causesOf(drift)).not.toContain("decision_document_unparseable");
  });

  it("does not fire, and does not crash, when no decision matches the affected path", () => {
    const issue = decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/no-match.md"] });
    const drift = detectDecisionDrift(baseInputs({ sourceIssues: [issue] }));
    expect(causesOf(drift)).not.toContain("decision_document_unparseable");
  });
});

describe("detectDecisionDrift: policy_exception_expired", () => {
  it("fires only when policyExceptionExpiredDecisionIds is supplied, hard-weight", () => {
    const drift = detectDecisionDrift(baseInputs({ policyExceptionExpiredDecisionIds: new Set(["decision:tt"]) }));
    expect(drift.find((d) => d.cause === "policy_exception_expired")!.severity).toBe("review_required");
  });

  it("never fires when policyExceptionExpiredDecisionIds is not supplied", () => {
    const drift = detectDecisionDrift(baseInputs());
    expect(causesOf(drift)).not.toContain("policy_exception_expired");
  });

  it("reaches blocking only when the decision is explicitly criticality 'critical'", () => {
    const drift = detectDecisionDrift(baseInputs({ policyExceptionExpiredDecisionIds: new Set(["decision:uu"]), criticalityByDecisionId: new Map([["decision:uu", "critical"]]) }));
    expect(drift.find((d) => d.cause === "policy_exception_expired")!.severity).toBe("blocking");
  });
});

describe("detectDecisionDrift: severity never escalates without an explicit signal", () => {
  it("a hard-weight cause with criticality 'elevated' (not 'critical') still caps at review_required", () => {
    const link = decisionLink({ id: "decision:link:vv", decision_id: "decision:vv", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous, criticalityByDecisionId: new Map([["decision:vv", "elevated"]]) }));
    expect(drift.find((d) => d.cause === "linked_entity_removed")!.severity).toBe("review_required");
  });

  it("a soft-weight cause with no criticality signal at all stays advisory, never review_required or blocking", () => {
    const link = decisionLink({ decision_id: "decision:ww", resolution: "resolved", target_id: "entity-ww" });
    const drift = detectDecisionDrift(baseInputs({ links: [link], materiallyChangedEntityIds: new Set(["entity-ww"]) }));
    expect(drift.find((d) => d.cause === "linked_entity_materially_changed")!.severity).toBe("advisory");
  });

  it("an unresolved criticality value never counts as 'critical' for severity purposes", () => {
    const link = decisionLink({ id: "decision:link:xx", decision_id: "decision:xx", resolution: "unresolved" });
    const previous = emptyPrevious({ linkResolutionById: new Map([[link.id, "resolved"]]) });
    const drift = detectDecisionDrift(baseInputs({ links: [link], previous, criticalityByDecisionId: new Map([["decision:xx", "unresolved" as DecisionCriticality]]) }));
    expect(drift.find((d) => d.cause === "linked_entity_removed")!.severity).toBe("review_required");
  });
});

describe("detectDecisionDrift: dedupe and sorting", () => {
  it("collapses multiple triggers that resolve to the same (decision_id, cause) drift id", () => {
    const linkA = decisionLink({ id: "decision:link:dup-a", decision_id: "decision:yy", resolution: "unresolved" });
    const linkB = decisionLink({ id: "decision:link:dup-b", decision_id: "decision:yy", resolution: "unresolved" });
    const previous = emptyPrevious({
      linkResolutionById: new Map([
        [linkA.id, "resolved"],
        [linkB.id, "resolved"],
      ]),
    });
    const drift = detectDecisionDrift(baseInputs({ links: [linkA, linkB], previous }));
    expect(drift.filter((d) => d.cause === "linked_entity_removed" && d.decision_id === "decision:yy")).toHaveLength(1);
  });

  it("sorts the returned drift entries by id", () => {
    const assumptionA = decisionAssumption({ decision_id: "decision:zzzz", state: "contradicted" });
    const assumptionB = decisionAssumption({ decision_id: "decision:aaaa", state: "contradicted" });
    const drift = detectDecisionDrift(baseInputs({ assumptions: [assumptionA, assumptionB] }));
    const ids = drift.map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty array for entirely empty inputs", () => {
    expect(detectDecisionDrift(baseInputs())).toEqual([]);
  });
});
