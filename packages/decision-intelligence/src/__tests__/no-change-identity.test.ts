import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../snapshot.js";
import { diffDecisions } from "../diff.js";
import { buildDecisionSupersession } from "../supersession.js";
import { buildDecisionConflicts } from "../conflicts.js";
import { detectDecisionDrift, type DecisionDriftInputs } from "../decision-drift.js";
import { detectDecisionDebt, type DecisionDebtInputs } from "../decision-debt.js";
import { classifyDecisionCriticality } from "../criticality.js";
import type { ArchitectureDecision, DecisionAssumption, DecisionConsequence, DecisionLink, EvidenceRef } from "../contracts.js";
import { architectureDecision, decisionAssumption, decisionConsequence, decisionLink, GENERATED_AT } from "./decision-fixtures.js";

const TARGET_GENERATED_AT = "2026-07-15T00:00:00.000Z";

function buildFixtureDecisions(): ArchitectureDecision[] {
  const base = architectureDecision({
    id: "decision:nc-base",
    title: "Adopt event-driven integration for order processing",
    decision_status: "accepted",
    implementation_status: "implemented",
    scope: "cross_cutting",
    authors: ["alice", "bob"],
    date: "2026-01-01",
  });
  const superseder = architectureDecision({
    id: "decision:nc-superseder",
    title: "Refine event-driven integration with schema registry",
    decision_status: "accepted",
    implementation_status: "partial",
    scope: "cross_cutting",
    authors: ["carol"],
    supersedes: ["decision:nc-superseded"],
  });
  const superseded = architectureDecision({
    id: "decision:nc-superseded",
    title: "Original point-to-point integration",
    decision_status: "superseded",
    implementation_status: "superseded",
    scope: "component",
    superseded_by: ["decision:nc-superseder"],
  });
  const rejected = architectureDecision({
    id: "decision:nc-rejected",
    title: "Shared mutable global config store",
    decision_status: "rejected",
    implementation_status: "not_applicable",
    scope: "unresolved",
  });
  return [base, superseder, superseded, rejected];
}

function buildFixtureLinks(decisions: ArchitectureDecision[]): DecisionLink[] {
  return [
    decisionLink({ decision_id: decisions[0]!.id, link_type: "governs", target_domain: "architecture", target_id: "component:order-service", resolution: "resolved" }),
    decisionLink({ decision_id: decisions[1]!.id, link_type: "implements", target_domain: "architecture", target_id: "component:schema-registry", resolution: "resolved" }),
    decisionLink({ decision_id: decisions[2]!.id, link_type: "deprecates", target_domain: "architecture", target_id: "component:legacy-bus", resolution: "resolved" }),
  ];
}

function buildFixtureAssumptions(decisions: ArchitectureDecision[]): DecisionAssumption[] {
  return [
    decisionAssumption({ decision_id: decisions[0]!.id, state: "confirmed" }),
    decisionAssumption({ decision_id: decisions[1]!.id, state: "supported" }),
  ];
}

function buildFixtureConsequences(decisions: ArchitectureDecision[]): DecisionConsequence[] {
  return [
    decisionConsequence({ decision_id: decisions[0]!.id, classification: "positive" }),
    decisionConsequence({ decision_id: decisions[1]!.id, classification: "tradeoff" }),
  ];
}

function evidenceMapFor(decisions: ArchitectureDecision[]): Map<string, EvidenceRef[]> {
  const map = new Map<string, EvidenceRef[]>();
  for (const decision of decisions) {
    map.set(decision.id, decision.evidence_refs);
  }
  return map;
}

describe("no-change identity: diffing a non-trivial snapshot against itself", () => {
  it("classifies every decision as unchanged", () => {
    const decisions = buildFixtureDecisions();
    const source = buildDecisionSnapshot({ repositoryId: "repo-noop", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-noop", generatedAt: TARGET_GENERATED_AT, decisions, sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: TARGET_GENERATED_AT });

    expect(changeSet.changes).toHaveLength(decisions.length);
    expect(changeSet.changes.every((c) => c.change_type === "unchanged")).toBe(true);
    expect(changeSet.compatibility.status).toBe("compatible");
  });

  it("classifies every decision as unchanged against an independently-cloned but structurally identical snapshot", () => {
    const decisions = buildFixtureDecisions();
    const clonedDecisions = JSON.parse(JSON.stringify(decisions)) as ArchitectureDecision[];
    const source = buildDecisionSnapshot({ repositoryId: "repo-noop-clone", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-noop-clone", generatedAt: TARGET_GENERATED_AT, decisions: clonedDecisions, sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: TARGET_GENERATED_AT });

    expect(changeSet.changes.every((c) => c.change_type === "unchanged")).toBe(true);
    expect(source.digest).toBe(target.digest);
    expect(source.id).toBe(target.id);
  });
});

describe("no-change identity: analyzing the same snapshot twice produces zero new findings", () => {
  it("buildDecisionSupersession is identical across two independent runs over the same decisions", () => {
    const decisions = buildFixtureDecisions();
    const evidenceMap = evidenceMapFor(decisions);

    const first = buildDecisionSupersession(decisions, evidenceMap);
    const second = buildDecisionSupersession(decisions, evidenceMap);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("buildDecisionConflicts finds no conflicts in a clean fixture, and stays empty across two runs", () => {
    const decisions = buildFixtureDecisions();
    const links = buildFixtureLinks(decisions);
    const evidenceMap = evidenceMapFor(decisions);

    const first = buildDecisionConflicts(decisions, links, [], evidenceMap);
    const second = buildDecisionConflicts(decisions, links, [], evidenceMap);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it("detectDecisionDrift with no `previous` state produces the same drift set across two runs, and nothing new the second time", () => {
    const decisions = buildFixtureDecisions();
    const links = buildFixtureLinks(decisions);
    const assumptions = buildFixtureAssumptions(decisions);
    const criticalityByDecisionId = new Map(decisions.map((d) => [d.id, "standard" as const]));
    const implementationStatusByDecisionId = new Map(decisions.map((d) => [d.id, "not_started" as const]));
    const governanceStatusByDecisionId = new Map<string, ArchitectureDecision["governance_status"]>(decisions.map((d) => [d.id, undefined]));

    const inputs: DecisionDriftInputs = {
      decisions,
      links,
      assumptions,
      conflicts: [],
      supersessionIssues: [],
      sourceIssues: [],
      criticalityByDecisionId,
      implementationStatusByDecisionId,
      governanceStatusByDecisionId,
    };

    const first = detectDecisionDrift(inputs);
    const second = detectDecisionDrift(inputs);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("detectDecisionDebt produces the same finding set across two runs over the same inputs, with no accumulation", () => {
    const decisions = buildFixtureDecisions();
    const assumptions = buildFixtureAssumptions(decisions);
    const links = buildFixtureLinks(decisions);
    const criticalityByDecisionId = new Map(decisions.map((d) => [d.id, "standard" as const]));
    const governanceStatusByDecisionId = new Map<string, ArchitectureDecision["governance_status"]>(decisions.map((d) => [d.id, undefined]));

    const inputs: DecisionDebtInputs = {
      decisions,
      implementationStates: [],
      drift: [],
      assumptions,
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      sourceIssues: [],
      links,
      dependencies: [],
      governanceStatusByDecisionId,
      criticalityByDecisionId,
      now: TARGET_GENERATED_AT,
    };

    const first = detectDecisionDebt(inputs);
    const second = detectDecisionDebt(inputs);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.length).toBe(second.length);
  });

  it("classifyDecisionCriticality is stable across two runs over the same decisions", () => {
    const decisions = buildFixtureDecisions();

    const first = classifyDecisionCriticality(decisions, { signalsAvailable: true });
    const second = classifyDecisionCriticality(decisions, { signalsAvailable: true });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("no-change identity: consequences do not affect decision-level equality", () => {
  it("buildFixtureConsequences is only used to confirm the fixture builders compose without altering decision digests", () => {
    const decisions = buildFixtureDecisions();
    const consequences = buildFixtureConsequences(decisions);
    const source = buildDecisionSnapshot({ repositoryId: "repo-noop-consequences", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-noop-consequences", generatedAt: TARGET_GENERATED_AT, decisions, sourceIssues: [] });

    expect(consequences.length).toBeGreaterThan(0);
    expect(source.digest).toBe(target.digest);
  });
});
