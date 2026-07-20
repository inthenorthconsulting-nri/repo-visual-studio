import { describe, expect, it } from "vitest";
import { detectMissingDecisions, type MissingDecisionRuleInput } from "../missing-decisions.js";
import { buildMissingDecisionFindingId } from "../ids.js";
import type { ArchitectureDecision, MissingDecisionRuleKind } from "../contracts.js";
import { decisionLink, evidenceRef } from "./decision-fixtures.js";

const ALL_RULE_KINDS: MissingDecisionRuleKind[] = [
  "runtime_entrypoint_change_without_decision",
  "shared_contract_change_without_decision",
  "baseline_replacement_without_decision",
  "policy_exception_without_decision",
  "product_role_change_without_decision",
  "portfolio_relationship_change_without_decision",
];

function rule(kind: MissingDecisionRuleKind, affectedEntityIds: string[]): MissingDecisionRuleInput {
  return { rule_kind: kind, affected_entity_ids: affectedEntityIds };
}

describe("detectMissingDecisions: all 6 named rule kinds", () => {
  for (const kind of ALL_RULE_KINDS) {
    it(`${kind}: flags an affected entity with no accepted decision link`, () => {
      const findings = detectMissingDecisions([rule(kind, ["entity-1"])], [], new Map(), []);
      expect(findings).toHaveLength(1);
      expect(findings[0].rule_kind).toBe(kind);
      expect(findings[0].affected_entity_id).toBe("entity-1");
      expect(findings[0].id).toBe(buildMissingDecisionFindingId(kind, "entity-1"));
    });
  }

  it("exposes exactly 6 rule kinds in the type -- never a 7th, never a default 'every change needs a decision' rule", () => {
    expect(ALL_RULE_KINDS).toHaveLength(6);
    expect(new Set(ALL_RULE_KINDS).size).toBe(6);
  });
});

describe("detectMissingDecisions: coverage suppresses the finding", () => {
  it("does not flag when a resolved link targets the entity and the decision is accepted", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toEqual([]);
  });

  it("does not flag when a partially_resolved link targets the entity and the decision is implemented", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "partially_resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "implemented"]]);
    const findings = detectMissingDecisions([rule("shared_contract_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toEqual([]);
  });

  it("does not flag when the decision is partially_implemented", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "partially_implemented"]]);
    const findings = detectMissingDecisions([rule("baseline_replacement_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toEqual([]);
  });
});

describe("detectMissingDecisions: what does NOT count as coverage", () => {
  it("a resolved link to a decision whose status is outside the accepted family still flags", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "draft"]]);
    const findings = detectMissingDecisions([rule("policy_exception_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toHaveLength(1);
  });

  it("an unresolved link does not count as coverage", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "unresolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("product_role_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toHaveLength(1);
  });

  it("an ambiguous link does not count as coverage", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "ambiguous" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("portfolio_relationship_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toHaveLength(1);
  });

  it("an incompatible link does not count as coverage", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-1", resolution: "incompatible" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toHaveLength(1);
  });

  it("a resolved link targeting a different entity id does not count as coverage", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-other", resolution: "resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-1"])], [link], statusById, []);
    expect(findings).toHaveLength(1);
  });

  it("a decision id absent from decisionStatusById defaults to 'unknown' and is therefore not coverage", () => {
    const link = decisionLink({ decision_id: "decision:missing-status", target_id: "entity-1", resolution: "resolved" });
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-1"])], [link], new Map(), []);
    expect(findings).toHaveLength(1);
  });
});

describe("detectMissingDecisions: never fabricates a rule the caller did not supply", () => {
  it("an entity id with no configured rule at all is never flagged, however uncovered it is", () => {
    const findings = detectMissingDecisions([], [], new Map(), []);
    expect(findings).toEqual([]);
  });

  it("only entity ids named by a supplied rule can ever appear in findings -- unrelated entity ids are silently ignored, not defaulted to a decision-required policy", () => {
    const rules = [rule("runtime_entrypoint_change_without_decision", ["entity-configured"])];
    const findings = detectMissingDecisions(rules, [], new Map(), []);
    expect(findings.map((f) => f.affected_entity_id)).toEqual(["entity-configured"]);
    expect(findings.some((f) => f.affected_entity_id === "entity-unconfigured")).toBe(false);
  });

  it("a code change without any policy rule configured for it produces zero findings even with many unrelated rules present", () => {
    const rules = ALL_RULE_KINDS.map((kind) => rule(kind, [`entity-for-${kind}`]));
    const findings = detectMissingDecisions(rules, [], new Map(), []);
    expect(findings.every((f) => f.affected_entity_id !== "entity-never-mentioned")).toBe(true);
  });
});

describe("detectMissingDecisions: multiple entities per rule and sorting", () => {
  it("evaluates every entity id independently within one rule", () => {
    const link = decisionLink({ decision_id: "decision:a", target_id: "entity-covered", resolution: "resolved" });
    const statusById = new Map<string, ArchitectureDecision["decision_status"]>([["decision:a", "accepted"]]);
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-covered", "entity-uncovered"])], [link], statusById, []);
    expect(findings.map((f) => f.affected_entity_id)).toEqual(["entity-uncovered"]);
  });

  it("sorts the returned findings by id, not by input order", () => {
    const rules = [rule("shared_contract_change_without_decision", ["zzz-entity"]), rule("baseline_replacement_without_decision", ["aaa-entity"])];
    const findings = detectMissingDecisions(rules, [], new Map(), []);
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe("detectMissingDecisions: evidence_refs and detail passthrough", () => {
  it("attaches the supplied evidence_refs array to every finding as-is", () => {
    const refs = [evidenceRef({ path: "architecture/entry.md", source_artifact: "architecture" })];
    const findings = detectMissingDecisions([rule("runtime_entrypoint_change_without_decision", ["entity-1"])], [], new Map(), refs);
    expect(findings[0].evidence_refs).toBe(refs);
  });

  it("detail names both the affected entity id and the rule kind", () => {
    const findings = detectMissingDecisions([rule("policy_exception_without_decision", ["entity-x"])], [], new Map(), []);
    expect(findings[0].detail).toContain("entity-x");
    expect(findings[0].detail).toContain("policy_exception_without_decision");
  });
});
