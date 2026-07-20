import { describe, expect, it } from "vitest";
import { buildDecisionConflicts } from "../conflicts.js";
import { buildConflictId } from "../ids.js";
import type { EvidenceRef } from "../contracts.js";
import { architectureDecision, decisionDependency, decisionLink, evidenceRef } from "./decision-fixtures.js";

function noEvidence(): Map<string, EvidenceRef[]> {
  return new Map();
}

describe("buildDecisionConflicts: accepted_depends_on_rejected (confirmed only)", () => {
  it("flags a confirmed conflict when an active decision depends_on a rejected decision", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "rejected" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "accepted_depends_on_rejected");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("confirmed");
    expect(conflict!.decision_ids).toEqual(["decision:a", "decision:b"]);
    expect(conflict!.id).toBe(buildConflictId(a.id, b.id, "accepted_depends_on_rejected"));
  });

  it("also fires for dependency_type 'requires'", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "implemented" });
    const b = architectureDecision({ id: "decision:b", decision_status: "withdrawn" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "requires" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    expect(conflicts.some((c) => c.kind === "accepted_depends_on_rejected" && c.status === "confirmed")).toBe(true);
  });

  it("fires for a withdrawn target as well as a rejected target", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "partially_implemented" });
    const b = architectureDecision({ id: "decision:b", decision_status: "withdrawn" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    expect(conflicts.some((c) => c.kind === "accepted_depends_on_rejected")).toBe(true);
  });

  it("does not fire for dependency types other than depends_on/requires", () => {
    for (const dependency_type of ["blocks", "is_required_by", "related_to"] as const) {
      const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
      const b = architectureDecision({ id: "decision:b", decision_status: "rejected" });
      const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type });
      const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
      expect(conflicts.some((c) => c.kind === "accepted_depends_on_rejected")).toBe(false);
    }
  });

  it("does not fire when the target is merely deprecated (not rejected or withdrawn)", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "deprecated" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    expect(conflicts.some((c) => c.kind === "accepted_depends_on_rejected")).toBe(false);
  });

  it("does not fire when the depending decision is itself not active (e.g. draft)", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "draft" });
    const b = architectureDecision({ id: "decision:b", decision_status: "rejected" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    expect(conflicts.some((c) => c.kind === "accepted_depends_on_rejected")).toBe(false);
  });

  it("skips dependencies whose endpoints are not among the supplied decisions", () => {
    const dep = decisionDependency({ from_decision_id: "decision:ghost-a", to_decision_id: "decision:ghost-b", dependency_type: "depends_on" });
    expect(() => buildDecisionConflicts([], [], [dep], noEvidence())).not.toThrow();
    expect(buildDecisionConflicts([], [], [dep], noEvidence())).toEqual([]);
  });
});

describe("buildDecisionConflicts: active_and_superseded_simultaneously (confirmed only)", () => {
  it("flags when an active decision is also superseded_by an active decision", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted", superseded_by: ["decision:b"] });
    const b = architectureDecision({ id: "decision:b", decision_status: "implemented" });
    const conflicts = buildDecisionConflicts([a, b], [], [], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "active_and_superseded_simultaneously");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("confirmed");
    expect(conflict!.decision_ids).toEqual(["decision:a", "decision:b"]);
  });

  it("does not fire when the superseder is not itself active", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted", superseded_by: ["decision:b"] });
    const b = architectureDecision({ id: "decision:b", decision_status: "draft" });
    const conflicts = buildDecisionConflicts([a, b], [], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "active_and_superseded_simultaneously")).toBe(false);
  });

  it("does not fire when the decision's own status is already 'superseded' (not in ACTIVE_STATUSES)", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "superseded", superseded_by: ["decision:b"] });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const conflicts = buildDecisionConflicts([a, b], [], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "active_and_superseded_simultaneously")).toBe(false);
  });
});

describe("buildDecisionConflicts: mutually_exclusive_requirements", () => {
  it("is confirmed when both decisions in an explicit conflicts_with dependency are currently active", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "implemented" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "conflicts_with" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "mutually_exclusive_requirements");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("confirmed");
  });

  it("is downgraded to possible when at least one side is not currently active", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "draft" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "conflicts_with" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "mutually_exclusive_requirements");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("possible");
    expect(conflict!.detail).toContain("not both currently active");
  });

  it("skips a conflicts_with dependency whose endpoints are not among the supplied decisions", () => {
    const dep = decisionDependency({ from_decision_id: "decision:ghost-a", to_decision_id: "decision:ghost-b", dependency_type: "conflicts_with" });
    expect(buildDecisionConflicts([], [], [dep], noEvidence())).toEqual([]);
  });
});

describe("buildDecisionConflicts: incompatible_required_states -- never 'confirmed'", () => {
  it("is 'probable', never 'confirmed', when both decisions are active and links contradict on a shared architecture target", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "implemented" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "removes", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "incompatible_required_states");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("probable");
    expect(conflict!.status).not.toBe("confirmed");
  });

  it("is 'possible' when not both decisions are currently active", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "draft" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "removes", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "incompatible_required_states");
    expect(conflict!.status).toBe("possible");
  });

  it("fires regardless of which of the contradictory pair appears first (order-independent)", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "removes", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(true);
  });

  it("fires for the permits/deprecates and requires/excepts and permits/removes contradictory pairs too", () => {
    const pairs: Array<[string, string]> = [
      ["permits", "deprecates"],
      ["requires", "excepts"],
      ["permits", "removes"],
    ];
    for (const [typeA, typeB] of pairs) {
      const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
      const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
      const linkA = decisionLink({ decision_id: a.id, link_type: typeA as never, target_domain: "capability", target_id: "cap:shared", resolution: "resolved" });
      const linkB = decisionLink({ decision_id: b.id, link_type: typeB as never, target_domain: "capability", target_id: "cap:shared", resolution: "resolved" });
      const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
      expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(true);
    }
  });

  it("does not fire for a link_type pair that is not in the contradictory list", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "constrains", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(false);
  });

  it("does not fire when the two contradictory links belong to the same decision", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: a.id, link_type: "removes", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a], [linkA, linkB], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(false);
  });

  it("does not fire when one of the links is unresolved", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: "architecture", target_id: "component:x", resolution: "unresolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "removes", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(false);
  });

  it("also detects contradictions for capability, product, and portfolio domains, never 'confirmed'", () => {
    for (const domain of ["capability", "product", "portfolio"] as const) {
      const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
      const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
      const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: domain, target_id: "shared-target", resolution: "resolved" });
      const linkB = decisionLink({ decision_id: b.id, link_type: "removes", target_domain: domain, target_id: "shared-target", resolution: "resolved" });
      const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
      const conflict = conflicts.find((c) => c.kind === "incompatible_required_states");
      expect(conflict).toBeDefined();
      expect(conflict!.status).not.toBe("confirmed");
    }
  });
});

describe("buildDecisionConflicts: incompatible_baseline_policy_linkage (governance domain)", () => {
  it("flags a probable conflict for contradictory resolved governance links to the same target", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "permits", target_domain: "governance", target_id: "policy:baseline", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "deprecates", target_domain: "governance", target_id: "policy:baseline", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "incompatible_baseline_policy_linkage");
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe("probable");
    expect(conflict!.status).not.toBe("confirmed");
  });

  it("does not cross-contaminate with the entity-domain incompatible_required_states kind for the same decisions", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const linkA = decisionLink({ decision_id: a.id, link_type: "permits", target_domain: "governance", target_id: "policy:baseline", resolution: "resolved" });
    const linkB = decisionLink({ decision_id: b.id, link_type: "deprecates", target_domain: "governance", target_id: "policy:baseline", resolution: "resolved" });
    const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
    expect(conflicts.some((c) => c.kind === "incompatible_required_states")).toBe(false);
  });
});

describe("buildDecisionConflicts: 'confirmed' is never produced from semantic similarity alone", () => {
  it("produces no conflicts at all for decisions whose titles/text merely read as contradictory prose, with no structural link/dependency data", () => {
    const a = architectureDecision({
      id: "decision:a",
      title: "Use PostgreSQL for all persistence",
      decision_text: "We will never use MySQL anywhere in this system.",
      decision_status: "accepted",
    });
    const b = architectureDecision({
      id: "decision:b",
      title: "Use MySQL for all persistence",
      decision_text: "We will never use PostgreSQL anywhere in this system.",
      decision_status: "accepted",
    });
    const conflicts = buildDecisionConflicts([a, b], [], [], noEvidence());
    expect(conflicts).toEqual([]);
  });

  it("never assigns status 'confirmed' to a link-domain conflict kind, even when both decisions are fully active", () => {
    const domains = ["architecture", "capability", "product", "portfolio", "governance"] as const;
    for (const domain of domains) {
      const a = architectureDecision({ id: "decision:a", decision_status: "implemented" });
      const b = architectureDecision({ id: "decision:b", decision_status: "implemented" });
      const linkA = decisionLink({ decision_id: a.id, link_type: "introduces", target_domain: domain, target_id: "shared", resolution: "resolved" });
      const linkB = decisionLink({ decision_id: b.id, link_type: "removes", target_domain: domain, target_id: "shared", resolution: "resolved" });
      const conflicts = buildDecisionConflicts([a, b], [linkA, linkB], [], noEvidence());
      for (const conflict of conflicts) {
        if (conflict.kind === "incompatible_required_states" || conflict.kind === "incompatible_baseline_policy_linkage") {
          expect(conflict.status).not.toBe("confirmed");
        }
      }
    }
  });
});

describe("buildDecisionConflicts: dedupe, sort, and evidence merging", () => {
  it("dedupes conflicts that share the same derived id", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const depOne = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "conflicts_with" });
    const depTwo = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "conflicts_with" });
    const conflicts = buildDecisionConflicts([a, b], [], [depOne, depTwo], noEvidence());
    const matching = conflicts.filter((c) => c.kind === "mutually_exclusive_requirements");
    expect(matching).toHaveLength(1);
  });

  it("returns conflicts sorted by id", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "rejected" });
    const c = architectureDecision({ id: "decision:c", decision_status: "accepted", superseded_by: ["decision:d"] });
    const d = architectureDecision({ id: "decision:d", decision_status: "implemented" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b, c, d], [], [dep], noEvidence());
    const ids = conflicts.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("merges evidence refs from both named decisions", () => {
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:b", decision_status: "rejected" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const refs = new Map([
      ["decision:a", [evidenceRef({ path: "docs/a.md" })]],
      ["decision:b", [evidenceRef({ path: "docs/b.md" })]],
    ]);
    const conflicts = buildDecisionConflicts([a, b], [], [dep], refs);
    const conflict = conflicts.find((c) => c.kind === "accepted_depends_on_rejected")!;
    expect(conflict.evidence_refs).toEqual([evidenceRef({ path: "docs/a.md" }), evidenceRef({ path: "docs/b.md" })]);
  });

  it("always sorts decision_ids on the conflict itself regardless of input order", () => {
    const a = architectureDecision({ id: "decision:z", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:m", decision_status: "rejected" });
    const dep = decisionDependency({ from_decision_id: a.id, to_decision_id: b.id, dependency_type: "depends_on" });
    const conflicts = buildDecisionConflicts([a, b], [], [dep], noEvidence());
    const conflict = conflicts.find((c) => c.kind === "accepted_depends_on_rejected")!;
    expect(conflict.decision_ids).toEqual(["decision:m", "decision:z"]);
  });
});
