import { describe, expect, it } from "vitest";
import { classifyDecisionCriticality, type CriticalityInputs } from "../criticality.js";
import { architectureDecision } from "./decision-fixtures.js";

function baseInputs(overrides: Partial<CriticalityInputs> = {}): CriticalityInputs {
  return { signalsAvailable: true, ...overrides };
}

describe("classifyDecisionCriticality: each named signal source in isolation", () => {
  it("configured_critical (explicit config) -> critical", () => {
    const decision = architectureDecision({ id: "decision:a" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ configuredCriticalDecisionIds: new Set(["decision:a"]) }));
    expect(result.criticality).toBe("critical");
    expect(result.basis).toContain("configured_critical");
  });

  for (const level of ["standard", "elevated", "critical"] as const) {
    it(`frontmatter_criticality:${level} -> ${level}`, () => {
      const decision = architectureDecision({ id: "decision:b" });
      const [result] = classifyDecisionCriticality([decision], baseInputs({ frontmatterCriticalityByDecisionId: new Map([["decision:b", level]]) }));
      expect(result.criticality).toBe(level);
      expect(result.basis).toContain(`frontmatter_criticality:${level}`);
    });
  }

  it("linked_critical_policy -> critical", () => {
    const decision = architectureDecision({ id: "decision:c" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ linkedCriticalPolicyDecisionIds: new Set(["decision:c"]) }));
    expect(result.criticality).toBe("critical");
    expect(result.basis).toContain("linked_critical_policy");
  });

  it("linked_shared_contract -> elevated", () => {
    const decision = architectureDecision({ id: "decision:d" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ linkedSharedContractDecisionIds: new Set(["decision:d"]) }));
    expect(result.criticality).toBe("elevated");
    expect(result.basis).toContain("linked_shared_contract");
  });

  it("linked_runtime_entrypoint -> elevated", () => {
    const decision = architectureDecision({ id: "decision:e" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ linkedRuntimeEntrypointDecisionIds: new Set(["decision:e"]) }));
    expect(result.criticality).toBe("elevated");
    expect(result.basis).toContain("linked_runtime_entrypoint");
  });

  it("linked_portfolio_dependency -> elevated", () => {
    const decision = architectureDecision({ id: "decision:f" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ linkedPortfolioDependencyDecisionIds: new Set(["decision:f"]) }));
    expect(result.criticality).toBe("elevated");
    expect(result.basis).toContain("linked_portfolio_dependency");
  });
});

describe("classifyDecisionCriticality: no signal matched", () => {
  it("resolves to 'standard' when signals were available to check but none matched", () => {
    const decision = architectureDecision({ id: "decision:g" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ signalsAvailable: true }));
    expect(result.criticality).toBe("standard");
    expect(result.basis).toEqual(["no_signal_matched"]);
  });

  it("resolves to 'unresolved' (never 'standard') when no signal sources were even available to check -- 'no way to even ask' never collapses to a pass", () => {
    const decision = architectureDecision({ id: "decision:h" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ signalsAvailable: false }));
    expect(result.criticality).toBe("unresolved");
    expect(result.basis).toEqual(["no_signal_sources_available"]);
  });

  it("signalsAvailable: false still yields 'unresolved' even when other optional signal maps/sets are present but simply empty", () => {
    const decision = architectureDecision({ id: "decision:i" });
    const [result] = classifyDecisionCriticality(
      [decision],
      baseInputs({ signalsAvailable: false, configuredCriticalDecisionIds: new Set(), linkedSharedContractDecisionIds: new Set() }),
    );
    expect(result.criticality).toBe("unresolved");
  });
});

describe("classifyDecisionCriticality: never derived from word frequency or document length", () => {
  it("a very long, verbose decision document with no explicit criticality signal is classified 'standard', not 'critical' or 'elevated'", () => {
    const verboseText = Array.from({ length: 500 }, (_, i) => `This is critical urgent essential paragraph number ${i} about the critical critical system.`).join(" ");
    const decision = architectureDecision({ id: "decision:j", context: verboseText, decision_text: verboseText, title: "Critical critical critical decision" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ signalsAvailable: true }));
    expect(result.criticality).toBe("standard");
    expect(result.basis).toEqual(["no_signal_matched"]);
  });

  it("the same verbose document with signalsAvailable false resolves to 'unresolved', not 'critical'", () => {
    const verboseText = Array.from({ length: 500 }, (_, i) => `critical critical critical paragraph ${i}`).join(" ");
    const decision = architectureDecision({ id: "decision:k", context: verboseText, decision_text: verboseText });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ signalsAvailable: false }));
    expect(result.criticality).toBe("unresolved");
  });

  it("a short, terse document with an explicit configured signal is still classified critical -- length has no bearing either direction", () => {
    const decision = architectureDecision({ id: "decision:l", context: "ok", decision_text: "ok" });
    const [result] = classifyDecisionCriticality([decision], baseInputs({ configuredCriticalDecisionIds: new Set(["decision:l"]) }));
    expect(result.criticality).toBe("critical");
  });
});

describe("classifyDecisionCriticality: multiple signals combine via max rank", () => {
  it("an elevated signal plus a critical signal on the same decision resolves to critical, with both bases recorded", () => {
    const decision = architectureDecision({ id: "decision:m" });
    const [result] = classifyDecisionCriticality(
      [decision],
      baseInputs({ linkedSharedContractDecisionIds: new Set(["decision:m"]), linkedCriticalPolicyDecisionIds: new Set(["decision:m"]) }),
    );
    expect(result.criticality).toBe("critical");
    expect(result.basis).toContain("linked_shared_contract");
    expect(result.basis).toContain("linked_critical_policy");
  });

  it("two independent elevated signals still resolve to elevated, not critical", () => {
    const decision = architectureDecision({ id: "decision:n" });
    const [result] = classifyDecisionCriticality(
      [decision],
      baseInputs({ linkedRuntimeEntrypointDecisionIds: new Set(["decision:n"]), linkedPortfolioDependencyDecisionIds: new Set(["decision:n"]) }),
    );
    expect(result.criticality).toBe("elevated");
  });

  it("frontmatter 'standard' does not downgrade a separately-signaled critical classification", () => {
    const decision = architectureDecision({ id: "decision:o" });
    const [result] = classifyDecisionCriticality(
      [decision],
      baseInputs({ frontmatterCriticalityByDecisionId: new Map([["decision:o", "standard"]]), configuredCriticalDecisionIds: new Set(["decision:o"]) }),
    );
    expect(result.criticality).toBe("critical");
  });
});

describe("classifyDecisionCriticality: passthrough and sorting", () => {
  it("carries the decision's evidence_refs through unchanged", () => {
    const refs = [{ path: "docs/adr/0009.md", source_artifact: "decision" as const }];
    const decision = architectureDecision({ id: "decision:p", evidence_refs: refs });
    const [result] = classifyDecisionCriticality([decision], baseInputs());
    expect(result.evidence_refs).toBe(refs);
  });

  it("sorts assessments by decision_id, not input order", () => {
    const decisions = [architectureDecision({ id: "decision:zzz" }), architectureDecision({ id: "decision:aaa" })];
    const results = classifyDecisionCriticality(decisions, baseInputs());
    const ids = results.map((r) => r.decision_id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty array for an empty decision list", () => {
    expect(classifyDecisionCriticality([], baseInputs())).toEqual([]);
  });
});
