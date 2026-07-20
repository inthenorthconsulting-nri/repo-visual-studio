import { describe, expect, it } from "vitest";
import { buildDecisionSupersession } from "../supersession.js";
import { buildSupersessionChainId, buildSupersessionIssueId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function noEvidence(): Map<string, ReturnType<typeof evidenceRef>[]> {
  return new Map();
}

describe("buildDecisionSupersession: reciprocal consistency", () => {
  it("flags reciprocal_inconsistency when A.supersedes names B but B.superseded_by omits A", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: [] });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    const issue = issues.find((i) => i.kind === "reciprocal_inconsistency");
    expect(issue).toBeDefined();
    expect(issue!.decision_ids).toEqual(["decision:a", "decision:b"]);
    expect(issue!.id).toBe(buildSupersessionIssueId("reciprocal_inconsistency", ["decision:a", "decision:b"]));
  });

  it("flags reciprocal_inconsistency when A.superseded_by names B but B.supersedes omits A", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: [], superseded_by: ["decision:b"] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: [] });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    const issue = issues.find((i) => i.kind === "reciprocal_inconsistency");
    expect(issue).toBeDefined();
    expect(issue!.decision_ids).toEqual(["decision:a", "decision:b"]);
  });

  it("does not flag reciprocal_inconsistency when both sides agree", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    expect(issues.some((i) => i.kind === "reciprocal_inconsistency")).toBe(false);
  });

  it("merges evidence refs from all named decisions on a reciprocal_inconsistency issue", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: [] });
    const refs = new Map([
      ["decision:a", [evidenceRef({ path: "docs/a.md" })]],
      ["decision:b", [evidenceRef({ path: "docs/b.md" })]],
    ]);
    const { issues } = buildDecisionSupersession([a, b], refs);
    const issue = issues.find((i) => i.kind === "reciprocal_inconsistency")!;
    expect(issue.evidence_refs).toEqual([evidenceRef({ path: "docs/a.md" }), evidenceRef({ path: "docs/b.md" })]);
  });
});

describe("buildDecisionSupersession: missing_target", () => {
  it("flags missing_target when supersedes names an unknown decision id", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:ghost"], superseded_by: [] });
    const { issues } = buildDecisionSupersession([a], noEvidence());
    const issue = issues.find((i) => i.kind === "missing_target");
    expect(issue).toBeDefined();
    expect(issue!.decision_ids).toEqual(["decision:a"]);
  });

  it("flags missing_target when superseded_by names an unknown decision id", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: [], superseded_by: ["decision:ghost"] });
    const { issues } = buildDecisionSupersession([a], noEvidence());
    const issue = issues.find((i) => i.kind === "missing_target");
    expect(issue).toBeDefined();
    expect(issue!.decision_ids).toEqual(["decision:a"]);
  });

  it("does not build a graph edge toward a missing supersedes target (no crash, no phantom chain)", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:ghost"], superseded_by: [] });
    const { chains } = buildDecisionSupersession([a], noEvidence());
    expect(chains).toEqual([]);
  });
});

describe("buildDecisionSupersession: multiple_active_superseders", () => {
  it("flags a decision superseded by more than one currently-active decision", () => {
    const d = architectureDecision({ id: "decision:d", supersedes: [], superseded_by: ["decision:a", "decision:b"] });
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted", supersedes: ["decision:d"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", decision_status: "accepted", supersedes: ["decision:d"], superseded_by: [] });
    const { issues } = buildDecisionSupersession([d, a, b], noEvidence());
    const issue = issues.find((i) => i.kind === "multiple_active_superseders");
    expect(issue).toBeDefined();
    expect(issue!.decision_ids).toEqual(["decision:a", "decision:b", "decision:d"]);
  });

  it("does not flag multiple_active_superseders when only one superseder is currently active (the other is itself superseded)", () => {
    const d = architectureDecision({ id: "decision:d", supersedes: [], superseded_by: ["decision:a", "decision:b"] });
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted", supersedes: ["decision:d"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", decision_status: "superseded", supersedes: ["decision:d"], superseded_by: [] });
    const { issues } = buildDecisionSupersession([d, a, b], noEvidence());
    expect(issues.some((i) => i.kind === "multiple_active_superseders")).toBe(false);
  });

  it("does not flag multiple_active_superseders when only a single decision supersedes the target", () => {
    const d = architectureDecision({ id: "decision:d", supersedes: [], superseded_by: ["decision:a"] });
    const a = architectureDecision({ id: "decision:a", decision_status: "accepted", supersedes: ["decision:d"], superseded_by: [] });
    const { issues } = buildDecisionSupersession([d, a], noEvidence());
    expect(issues.some((i) => i.kind === "multiple_active_superseders")).toBe(false);
  });
});

describe("buildDecisionSupersession: cycles are always invalid, regardless of date ordering", () => {
  it("flags a 2-decision supersession cycle as supersession_cycle even with reciprocal fields consistent", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: ["decision:b"], date: "2020-01-01" });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:a"], superseded_by: ["decision:a"], date: "2025-01-01" });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    const cycleIssue = issues.find((i) => i.kind === "supersession_cycle");
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue!.decision_ids).toEqual(["decision:a", "decision:b"]);
  });

  it("still flags the cycle as invalid when the dates are reversed (no newest-date-wins heuristic)", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: ["decision:b"], date: "2025-01-01" });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:a"], superseded_by: ["decision:a"], date: "2020-01-01" });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    const cycleIssue = issues.find((i) => i.kind === "supersession_cycle");
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue!.decision_ids).toEqual(["decision:a", "decision:b"]);
  });

  it("marks any chain that runs through cycle members as invalid, regardless of date ordering on either side", () => {
    const c = architectureDecision({ id: "decision:c", supersedes: ["decision:a"], superseded_by: [], date: "2030-01-01" });
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: ["decision:c", "decision:b"], date: "1999-01-01" });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:a"], superseded_by: ["decision:a"], date: "2015-01-01" });
    const { chains } = buildDecisionSupersession([c, a, b], noEvidence());
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain.is_valid).toBe(false);
    }
  });

  it("detects a 3-decision cycle", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: ["decision:c"] });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:c"], superseded_by: ["decision:a"] });
    const c = architectureDecision({ id: "decision:c", supersedes: ["decision:a"], superseded_by: ["decision:b"] });
    const { issues } = buildDecisionSupersession([a, b, c], noEvidence());
    const cycleIssue = issues.find((i) => i.kind === "supersession_cycle");
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue!.decision_ids).toEqual(["decision:a", "decision:b", "decision:c"]);
  });
});

describe("buildDecisionSupersession: chains", () => {
  it("builds no chain when there is no supersession relationship at all", () => {
    const a = architectureDecision({ id: "decision:a" });
    const { chains } = buildDecisionSupersession([a], noEvidence());
    expect(chains).toEqual([]);
  });

  it("builds a valid 2-decision chain ordered oldest-first", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const { chains, issues } = buildDecisionSupersession([a, b], noEvidence());
    expect(issues).toEqual([]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.decision_ids_in_order).toEqual(["decision:b", "decision:a"]);
    expect(chains[0]!.is_valid).toBe(true);
    expect(chains[0]!.id).toBe(buildSupersessionChainId(["decision:b", "decision:a"]));
  });

  it("builds a valid 3-decision chain ordered oldest-first", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:c"], superseded_by: ["decision:a"] });
    const c = architectureDecision({ id: "decision:c", supersedes: [], superseded_by: ["decision:b"] });
    const { chains } = buildDecisionSupersession([a, b, c], noEvidence());
    expect(chains).toHaveLength(1);
    expect(chains[0]!.decision_ids_in_order).toEqual(["decision:c", "decision:b", "decision:a"]);
    expect(chains[0]!.is_valid).toBe(true);
  });

  it("builds separate chains when one decision supersedes two independent targets", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b", "decision:c"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const c = architectureDecision({ id: "decision:c", supersedes: [], superseded_by: ["decision:a"] });
    const { chains } = buildDecisionSupersession([a, b, c], noEvidence());
    expect(chains).toHaveLength(2);
    const orders = chains.map((c) => c.decision_ids_in_order).sort();
    expect(orders).toEqual([
      ["decision:b", "decision:a"],
      ["decision:c", "decision:a"],
    ]);
  });

  it("returns chains sorted by id", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b", "decision:c"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const c = architectureDecision({ id: "decision:c", supersedes: [], superseded_by: ["decision:a"] });
    const { chains } = buildDecisionSupersession([a, b, c], noEvidence());
    const ids = chains.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("attaches merged evidence refs across the chain's decisions, oldest first", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const refs = new Map([
      ["decision:a", [evidenceRef({ path: "docs/a.md" })]],
      ["decision:b", [evidenceRef({ path: "docs/b.md" })]],
    ]);
    const { chains } = buildDecisionSupersession([a, b], refs);
    expect(chains[0]!.evidence_refs).toEqual([evidenceRef({ path: "docs/b.md" }), evidenceRef({ path: "docs/a.md" })]);
  });
});

describe("buildDecisionSupersession: issue sort order and determinism", () => {
  it("returns issues sorted by id", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:ghost-z"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: ["decision:ghost-a"], superseded_by: [] });
    const { issues } = buildDecisionSupersession([a, b], noEvidence());
    const ids = issues.map((i) => i.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("produces byte-identical output across repeated calls with the same input", () => {
    const a = architectureDecision({ id: "decision:a", supersedes: ["decision:b"], superseded_by: [] });
    const b = architectureDecision({ id: "decision:b", supersedes: [], superseded_by: ["decision:a"] });
    const first = buildDecisionSupersession([a, b], noEvidence());
    const second = buildDecisionSupersession([a, b], noEvidence());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
