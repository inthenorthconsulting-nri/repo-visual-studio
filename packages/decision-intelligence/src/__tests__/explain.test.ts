import { describe, expect, it } from "vitest";
import { explainDecisionId, type DecisionExplainContext } from "../explain.js";
import {
  architectureDecision,
  decisionAssumption,
  decisionChange,
  decisionChangeSet,
  decisionConflict,
  decisionConsequence,
  decisionCoverageMetric,
  decisionDebtFinding,
  decisionDrift,
  decisionImplementationState,
  decisionLink,
  decisionSnapshot,
  decisionSupersessionChain,
} from "./decision-fixtures.js";

describe("explainDecisionId", () => {
  it("resolves a decision id from snapshot.decisions", () => {
    const decision = architectureDecision({ id: "decision:test-1", title: "Use Postgres" });
    const context: DecisionExplainContext = { snapshot: decisionSnapshot({ decisions: [decision] }) };
    const result = explainDecisionId("decision:test-1", context);
    expect(result.resolved).toBe(decision);
    expect(result.explanation).toContain("decision:test-1");
    expect(result.explanation).toContain("Use Postgres");
  });

  it("resolves an assumption id", () => {
    const assumption = decisionAssumption({ id: "decision:assumption:1" });
    const context: DecisionExplainContext = { assumptions: [assumption] };
    const result = explainDecisionId("decision:assumption:1", context);
    expect(result.resolved).toBe(assumption);
    expect(result.explanation).toContain(assumption.decision_id);
  });

  it("resolves a consequence id", () => {
    const consequence = decisionConsequence({ id: "decision:consequence:1" });
    const context: DecisionExplainContext = { consequences: [consequence] };
    const result = explainDecisionId("decision:consequence:1", context);
    expect(result.resolved).toBe(consequence);
    expect(result.explanation).toContain(consequence.classification);
  });

  it("resolves a link id", () => {
    const link = decisionLink({ id: "decision:link:1" });
    const context: DecisionExplainContext = { links: [link] };
    const result = explainDecisionId("decision:link:1", context);
    expect(result.resolved).toBe(link);
    expect(result.explanation).toContain(link.resolution);
  });

  it("resolves a conflict id", () => {
    const conflict = decisionConflict({ id: "decision:conflict:1" });
    const context: DecisionExplainContext = { conflicts: [conflict] };
    const result = explainDecisionId("decision:conflict:1", context);
    expect(result.resolved).toBe(conflict);
    expect(result.explanation).toContain(conflict.decision_ids[0]);
  });

  it("resolves a drift id", () => {
    const drift = decisionDrift({ id: "decision:drift:1" });
    const context: DecisionExplainContext = { drift: [drift] };
    const result = explainDecisionId("decision:drift:1", context);
    expect(result.resolved).toBe(drift);
    expect(result.explanation).toContain(drift.severity);
  });

  it("resolves a decision-debt id", () => {
    const debt = decisionDebtFinding({ id: "decision:debt:1" });
    const context: DecisionExplainContext = { debtFindings: [debt] };
    const result = explainDecisionId("decision:debt:1", context);
    expect(result.resolved).toBe(debt);
    expect(result.explanation).toContain(debt.category);
  });

  it("resolves a coverage id", () => {
    const coverage = decisionCoverageMetric({ id: "decision:coverage:1" });
    const context: DecisionExplainContext = { coverage: [coverage] };
    const result = explainDecisionId("decision:coverage:1", context);
    expect(result.resolved).toBe(coverage);
    expect(result.explanation).toContain(coverage.dimension);
  });

  it("resolves an implementation-state id", () => {
    const state = decisionImplementationState({ id: "decision:implementation-state:1" });
    const context: DecisionExplainContext = { implementationStates: [state] };
    const result = explainDecisionId("decision:implementation-state:1", context);
    expect(result.resolved).toBe(state);
    expect(result.explanation).toContain(state.status);
  });

  it("resolves a change id from changeSet.changes", () => {
    const change = decisionChange({ id: "decision:change:1" });
    const context: DecisionExplainContext = { changeSet: decisionChangeSet({ changes: [change] }) };
    const result = explainDecisionId("decision:change:1", context);
    expect(result.resolved).toBe(change);
    expect(result.explanation).toContain(change.change_type);
  });

  it("resolves a supersession-chain id", () => {
    const chain = decisionSupersessionChain({ id: "decision:supersession-chain:1", is_valid: false });
    const context: DecisionExplainContext = { supersessionChains: [chain] };
    const result = explainDecisionId("decision:supersession-chain:1", context);
    expect(result.resolved).toBe(chain);
    expect(result.explanation).toContain("invalid");
  });

  it("tries every id space in order and falls through to the next when earlier spaces don't match", () => {
    const link = decisionLink({ id: "decision:link:only-here" });
    const context: DecisionExplainContext = {
      snapshot: decisionSnapshot({ decisions: [architectureDecision({ id: "decision:unrelated" })] }),
      assumptions: [decisionAssumption({ id: "decision:assumption:unrelated" })],
      links: [link],
    };
    const result = explainDecisionId("decision:link:only-here", context);
    expect(result.resolved).toBe(link);
  });

  it("throws naming every space tried, plus the analyze hint, when no id matches", () => {
    const context: DecisionExplainContext = { snapshot: decisionSnapshot() };
    expect(() => explainDecisionId("decision:totally-unknown", context)).toThrow(/rvs decisions analyze/);
    expect(() => explainDecisionId("decision:totally-unknown", context)).toThrow(/decision, assumption, consequence, link, conflict, drift, decision-debt, coverage, implementation-state, change, or supersession-chain/);
  });

  it("throws for an unresolvable id against a fully empty context", () => {
    expect(() => explainDecisionId("anything", {})).toThrow();
  });
});
