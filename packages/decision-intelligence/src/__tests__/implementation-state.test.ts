import { describe, expect, it } from "vitest";
import { buildDecisionImplementationStates } from "../implementation-state.js";
import { buildImplementationStateId } from "../ids.js";
import type { DecisionStatus } from "../contracts.js";
import { architectureDecision, decisionLink } from "./decision-fixtures.js";

const NOT_APPLICABLE_STATUSES: DecisionStatus[] = ["draft", "proposed", "under_review", "rejected", "withdrawn", "deprecated"];

describe("buildDecisionImplementationStates: superseded takes priority over everything else", () => {
  it("returns 'superseded' for a superseded decision even when it has resolved implements evidence", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "superseded" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("superseded");
  });
});

describe("buildDecisionImplementationStates: not_applicable statuses", () => {
  for (const decision_status of NOT_APPLICABLE_STATUSES) {
    it(`returns 'not_applicable' for decision_status "${decision_status}"`, () => {
      const decision = architectureDecision({ id: "decision:a", decision_status });
      const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
      expect(state.status).toBe("not_applicable");
    });
  }

  it("treats not_applicable status even with resolved implements evidence present", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "draft" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("not_applicable");
  });
});

describe("buildDecisionImplementationStates: implemented vs. partial", () => {
  it("returns 'implemented' when self-declared implemented and at least one resolved implements link exists", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "implemented" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("implemented");
  });

  it("returns 'partial' when there is resolved implements evidence but decision_status is accepted (not self-declared implemented)", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("partial");
  });

  it("returns 'partial' when decision_status is 'partially_implemented' with resolved evidence, never 'implemented'", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "partially_implemented" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "partially_resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("partial");
  });

  it("counts a partially_resolved implements link toward evidence, same as resolved", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "partially_resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).toBe("partial");
  });

  it("does not count an unresolved/ambiguous/incompatible implements link as evidence", () => {
    for (const resolution of ["unresolved", "ambiguous", "incompatible"] as const) {
      const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
      const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution });
      const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
      expect(state.status).not.toBe("partial");
    }
  });

  it("does not count an implements link belonging to a different decision", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const other = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const link = decisionLink({ decision_id: other.id, link_type: "implements", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).not.toBe("partial");
  });

  it("does not count a resolved link of a different link_type as implementation evidence", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "validates", resolution: "resolved" });
    const [state] = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(state.status).not.toBe("partial");
  });
});

describe("buildDecisionImplementationStates: 'no way to even ask' resolves to unverifiable, never an assumed not_started", () => {
  it("returns 'unverifiable', not 'not_started', for an accepted decision with no implements evidence when no upstream snapshot was available at all", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: false });
    expect(state.status).toBe("unverifiable");
    expect(state.status).not.toBe("not_started");
  });

  it("does not label the lack of upstream evidence as a defect: the detail explains the absence of a snapshot, not a failure of the decision", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: false });
    expect(state.detail).toContain("no upstream");
    expect(state.detail).not.toMatch(/fail|defect|broken/i);
  });

  it("returns 'unverifiable' regardless of decision_status (as long as it is not superseded/not_applicable) when no upstream evidence exists", () => {
    for (const decision_status of ["accepted", "implemented", "partially_implemented", "unknown"] as const) {
      const decision = architectureDecision({ id: "decision:a", decision_status });
      const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: false });
      expect(state.status).toBe("unverifiable");
    }
  });
});

describe("buildDecisionImplementationStates: self-declared implemented but no supporting evidence found -- unverifiable, never 'regressed'", () => {
  it("returns 'unverifiable' when decision_status is 'implemented' but zero resolved implements links are found and upstream evidence was available", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "implemented" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.status).toBe("unverifiable");
    expect(state.status).not.toBe("regressed");
  });

  it("returns 'unverifiable' when decision_status is 'partially_implemented' but zero resolved implements links are found and upstream evidence was available", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "partially_implemented" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.status).toBe("unverifiable");
  });
});

describe("buildDecisionImplementationStates: not_started", () => {
  it("returns 'not_started' for an accepted decision with no implements evidence when upstream evidence was available to check", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.status).toBe("not_started");
  });

  it("does not read as a defect: not_started explicitly cites 'no resolved implementation link found', not a claim that the decision is wrong or broken", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.detail).toContain("no resolved implementation link found");
  });

  it("returns 'not_started' for decision_status 'unknown' with no evidence and upstream evidence available (not in the not_applicable set)", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "unknown" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.status).toBe("not_started");
  });

  it("distinguishes accepted-not-started from accepted-unverifiable purely by whether upstream evidence existed to check", () => {
    const decisionA = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const decisionB = architectureDecision({ id: "decision:b", decision_status: "accepted" });
    const [stateA] = buildDecisionImplementationStates([decisionA], [], { hasUpstreamEvidence: true });
    const [stateB] = buildDecisionImplementationStates([decisionB], [], { hasUpstreamEvidence: false });
    expect(stateA.status).toBe("not_started");
    expect(stateB.status).toBe("unverifiable");
  });
});

describe("buildDecisionImplementationStates: 'regressed' is never assigned by this module", () => {
  it("never returns 'regressed' across the full documented state-transition surface", () => {
    const statuses: DecisionStatus[] = [
      "draft",
      "proposed",
      "under_review",
      "accepted",
      "rejected",
      "superseded",
      "deprecated",
      "withdrawn",
      "implemented",
      "partially_implemented",
      "unknown",
    ];
    const allStates = [];
    for (const decision_status of statuses) {
      for (const hasUpstreamEvidence of [true, false]) {
        for (const withEvidence of [true, false]) {
          const decision = architectureDecision({ id: `decision:${decision_status}-${hasUpstreamEvidence}-${withEvidence}`, decision_status });
          const links = withEvidence ? [decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" })] : [];
          const [state] = buildDecisionImplementationStates([decision], links, { hasUpstreamEvidence });
          allStates.push(state);
        }
      }
    }
    expect(allStates.every((s) => s.status !== "regressed")).toBe(true);
  });
});

describe("buildDecisionImplementationStates: id derivation, evidence, and ordering", () => {
  it("derives id via buildImplementationStateId(decision.id)", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.id).toBe(buildImplementationStateId(decision.id));
    expect(state.decision_id).toBe(decision.id);
  });

  it("passes through the decision's own evidence_refs verbatim", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const [state] = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(state.evidence_refs).toEqual(decision.evidence_refs);
  });

  it("returns states sorted by id", () => {
    const decisionZ = architectureDecision({ id: "decision:z", decision_status: "accepted" });
    const decisionA = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const states = buildDecisionImplementationStates([decisionZ, decisionA], [], { hasUpstreamEvidence: true });
    expect(states.map((s) => s.id)).toEqual([buildImplementationStateId("decision:a"), buildImplementationStateId("decision:z")]);
  });

  it("is deterministic: identical input produces byte-identical output", () => {
    const decision = architectureDecision({ id: "decision:a", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", resolution: "resolved" });
    const first = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    const second = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
