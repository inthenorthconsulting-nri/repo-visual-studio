import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../snapshot.js";
import { diffDecisions } from "../diff.js";
import { buildDecisionSupersession } from "../supersession.js";
import { buildDecisionConflicts } from "../conflicts.js";
import { detectDecisionDrift, type DecisionDriftInputs } from "../decision-drift.js";
import { detectDecisionDebt, type DecisionDebtInputs } from "../decision-debt.js";
import { classifyDecisionCriticality } from "../criticality.js";
import { buildGovernanceLinks } from "../governance-links.js";
import { buildDecisionCoverage, type CoverageInputs } from "../coverage.js";
import { assessDecisionBlastRadius, type BlastRadiusInputs } from "../blast-radius.js";
import { buildDecisionDependencies, type DeclaredDependency } from "../dependencies.js";
import { buildDecisionGovernanceContext } from "../governance-policy-extension.js";
import { buildDecisionPlan, type BuildDecisionPlanInput } from "../decision-plan.js";
import { buildDecisionNarrative, type BuildDecisionNarrativeInput } from "../narrative.js";
import type { ArchitectureDecision, DecisionAssumption, DecisionConflict, DecisionLink, DecisionSupersessionIssue, EvidenceRef } from "../contracts.js";
import { architectureDecision, decisionAssumption, decisionConflict, decisionLink, decisionSupersessionIssue, GENERATED_AT } from "./decision-fixtures.js";

function rotate<T>(items: T[], shift: number): T[] {
  const n = items.length;
  if (n === 0) return items;
  const s = shift % n;
  return items.slice(s).concat(items.slice(0, s));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key]);
    return sorted;
  }
  return value;
}

function buildDecisions(): ArchitectureDecision[] {
  const superseded = architectureDecision({
    id: "decision:det-superseded",
    decision_status: "superseded",
    implementation_status: "superseded",
    superseded_by: ["decision:det-superseder"],
  });
  const superseder = architectureDecision({
    id: "decision:det-superseder",
    decision_status: "accepted",
    implementation_status: "implemented",
    supersedes: ["decision:det-superseded"],
  });
  const rejected = architectureDecision({
    id: "decision:det-rejected",
    decision_status: "rejected",
    implementation_status: "not_applicable",
  });
  const proposed = architectureDecision({
    id: "decision:det-proposed",
    decision_status: "proposed",
    implementation_status: "not_started",
  });
  const accepted = architectureDecision({
    id: "decision:det-accepted",
    decision_status: "accepted",
    implementation_status: "not_started",
  });
  return [superseded, superseder, rejected, proposed, accepted];
}

function buildLinks(decisions: ArchitectureDecision[]): DecisionLink[] {
  return [
    decisionLink({ decision_id: decisions[0]!.id, link_type: "governs", target_domain: "architecture", target_id: "component:a", resolution: "resolved" }),
    decisionLink({ decision_id: decisions[1]!.id, link_type: "implements", target_domain: "architecture", target_id: "component:b", resolution: "resolved" }),
    decisionLink({ decision_id: decisions[2]!.id, link_type: "constrains", target_domain: "capability", target_id: "capability:c", resolution: "unresolved" }),
    decisionLink({ decision_id: decisions[3]!.id, link_type: "requires", target_domain: "product", target_id: "product:d", resolution: "resolved" }),
    decisionLink({ decision_id: decisions[4]!.id, link_type: "affects", target_domain: "portfolio", target_id: "portfolio:e", resolution: "partially_resolved" }),
  ];
}

function buildAssumptions(decisions: ArchitectureDecision[]): DecisionAssumption[] {
  return [
    decisionAssumption({ decision_id: decisions[0]!.id, state: "confirmed" }),
    decisionAssumption({ decision_id: decisions[1]!.id, state: "weakened" }),
    decisionAssumption({ decision_id: decisions[4]!.id, state: "contradicted" }),
  ];
}

function buildConflicts(decisions: ArchitectureDecision[]): DecisionConflict[] {
  return [
    decisionConflict({ decision_ids: [decisions[0]!.id, decisions[1]!.id], kind: "active_and_superseded_simultaneously", status: "confirmed" }),
  ];
}

function buildSupersessionIssues(decisions: ArchitectureDecision[]): DecisionSupersessionIssue[] {
  return [
    decisionSupersessionIssue({ kind: "missing_target", decision_ids: [decisions[3]!.id] }),
  ];
}

function evidenceMapFor(decisions: ArchitectureDecision[]): Map<string, EvidenceRef[]> {
  const map = new Map<string, EvidenceRef[]>();
  for (const decision of decisions) {
    map.set(decision.id, decision.evidence_refs);
  }
  return map;
}

const RUNS = 5;

describe("determinism: byte-identical output across 5 runs with shuffled input ordering", () => {
  it("buildDecisionSnapshot", () => {
    const decisions = buildDecisions();
    const outputs = Array.from({ length: RUNS }, (_, i) =>
      JSON.stringify(buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions: rotate(decisions, i), sourceIssues: [] })),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it("diffDecisions", () => {
    const decisions = buildDecisions();
    const target = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const source = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions: rotate(decisions, i), sourceIssues: [] });
      return JSON.stringify(diffDecisions({ source, target, generatedAt: GENERATED_AT }));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionSupersession", () => {
    const decisions = buildDecisions();
    const evidenceMap = evidenceMapFor(decisions);
    const outputs = Array.from({ length: RUNS }, (_, i) => JSON.stringify(buildDecisionSupersession(rotate(decisions, i), evidenceMap)));
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionConflicts", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const evidenceMap = evidenceMapFor(decisions);
    const outputs = Array.from({ length: RUNS }, (_, i) =>
      JSON.stringify(buildDecisionConflicts(rotate(decisions, i), rotate(links, i), [], evidenceMap)),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it("classifyDecisionCriticality", () => {
    const decisions = buildDecisions();
    const outputs = Array.from({ length: RUNS }, (_, i) =>
      JSON.stringify(classifyDecisionCriticality(rotate(decisions, i), { signalsAvailable: true })),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it("detectDecisionDrift", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const assumptions = buildAssumptions(decisions);
    const conflicts = buildConflicts(decisions);
    const supersessionIssues = buildSupersessionIssues(decisions);
    const criticalityByDecisionId = new Map(decisions.map((d) => [d.id, "standard" as const]));
    const implementationStatusByDecisionId = new Map(decisions.map((d) => [d.id, "not_started" as const]));
    const governanceStatusByDecisionId = new Map<string, ArchitectureDecision["governance_status"]>(decisions.map((d) => [d.id, undefined]));
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const inputs: DecisionDriftInputs = {
        decisions: rotate(decisions, i),
        links: rotate(links, i),
        assumptions: rotate(assumptions, i),
        conflicts: rotate(conflicts, i),
        supersessionIssues: rotate(supersessionIssues, i),
        sourceIssues: [],
        criticalityByDecisionId,
        implementationStatusByDecisionId,
        governanceStatusByDecisionId,
      };
      return JSON.stringify(detectDecisionDrift(inputs));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("detectDecisionDebt", () => {
    const decisions = buildDecisions();
    const assumptions = buildAssumptions(decisions);
    const conflicts = buildConflicts(decisions);
    const supersessionIssues = buildSupersessionIssues(decisions);
    const links = buildLinks(decisions);
    const criticalityByDecisionId = new Map(decisions.map((d) => [d.id, "standard" as const]));
    const governanceStatusByDecisionId = new Map<string, ArchitectureDecision["governance_status"]>(decisions.map((d) => [d.id, undefined]));
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const inputs: DecisionDebtInputs = {
        decisions: rotate(decisions, i),
        implementationStates: [],
        drift: [],
        assumptions: rotate(assumptions, i),
        conflicts: rotate(conflicts, i),
        supersessionIssues: rotate(supersessionIssues, i),
        missingDecisionFindings: [],
        sourceIssues: [],
        links: rotate(links, i),
        dependencies: [],
        governanceStatusByDecisionId,
        criticalityByDecisionId,
        now: GENERATED_AT,
      };
      return JSON.stringify(detectDecisionDebt(inputs));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildGovernanceLinks", () => {
    const decisions = buildDecisions();
    const governancePolicy = {
      exceptions: [
        { decision_ref: decisions[4]!.id, scope: "portfolio", expiry: "2027-01-01T00:00:00.000Z" },
        { decision_ref: decisions[0]!.id, scope: "portfolio", expiry: "2020-01-01T00:00:00.000Z" },
      ],
    };
    const outputs = Array.from({ length: RUNS }, (_, i) => JSON.stringify(buildGovernanceLinks(rotate(decisions, i), governancePolicy, GENERATED_AT)));
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionCoverage", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const coverageInputs: CoverageInputs = {
      architectureSnapshot: { id: "architecture:snap-1" },
      capabilitySnapshot: undefined,
      productSnapshot: { id: "product:snap-1" },
      portfolioSnapshot: { id: "portfolio:snap-1" },
      governancePolicy: undefined,
    };
    const evidenceRefs = decisions[0]!.evidence_refs;
    const outputs = Array.from({ length: RUNS }, (_, i) => JSON.stringify(buildDecisionCoverage(rotate(links, i), coverageInputs, evidenceRefs)));
    expect(new Set(outputs).size).toBe(1);
  });

  it("assessDecisionBlastRadius", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const inputs: BlastRadiusInputs = {
        decisions: rotate(decisions, i),
        links: rotate(links, i),
        dependencies: [],
        sourceIssues: [],
        linksAvailable: true,
        dependenciesAvailable: true,
      };
      return JSON.stringify(assessDecisionBlastRadius(inputs));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionDependencies", () => {
    const decisions = buildDecisions();
    const declaredByDecisionId = new Map<string, DeclaredDependency[]>([
      [decisions[3]!.id, [{ type: "depends_on", target: decisions[4]!.id }]],
      [decisions[4]!.id, [{ type: "related_to", target: decisions[2]!.id }]],
    ]);
    const evidenceMap = evidenceMapFor(decisions);
    const outputs = Array.from({ length: RUNS }, (_, i) => JSON.stringify(buildDecisionDependencies(rotate(decisions, i), declaredByDecisionId, evidenceMap)));
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionGovernanceContext", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const assumptions = buildAssumptions(decisions);
    const conflicts = buildConflicts(decisions);
    const outputs = Array.from({ length: RUNS }, (_, i) =>
      JSON.stringify(
        buildDecisionGovernanceContext({
          missingDecisionFindings: [],
          assumptions: rotate(assumptions, i),
          conflicts: rotate(conflicts, i),
          governanceLinks: rotate(links, i),
          drift: [],
        }),
      ),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionPlan", () => {
    const decisions = buildDecisions();
    const links = buildLinks(decisions);
    const assumptions = buildAssumptions(decisions);
    const conflicts = buildConflicts(decisions);
    const supersessionIssues = buildSupersessionIssues(decisions);
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const narrative = buildDecisionNarrative({
      snapshot,
      implementationStates: [],
      assumptions,
      conflicts,
      supersessionIssues,
      coverage: [],
      debtFindings: [],
      drift: [],
      generatedAt: GENERATED_AT,
    });
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const input: BuildDecisionPlanInput = {
        snapshot,
        narrative,
        links: rotate(links, i),
        implementationStates: [],
        assumptions: rotate(assumptions, i),
        supersessionIssues: rotate(supersessionIssues, i),
        supersessionChains: [],
        conflicts: rotate(conflicts, i),
        coverage: [],
        drift: [],
        debtFindings: [],
        generatedAt: GENERATED_AT,
      };
      const generatedPlan = buildDecisionPlan(input);
      return JSON.stringify(canonicalize(generatedPlan.scenes.map(({ evidence_refs: _evidenceRefs, ...rest }) => rest)));
    });
    expect(new Set(outputs).size).toBe(1);
  });

  it("buildDecisionPlan scene body 'by_*' count breakdowns are byte-identical regardless of input declaration order, since decision-plan.ts's local countBy helper sorts its Record keys before embedding them in body -- matching narrative.ts's use of the same helper, which always routes through formatCounts' alphabetical Object.entries().sort() before producing prose", () => {
    const decisions = buildDecisions();
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const narrative = buildDecisionNarrative({ snapshot, implementationStates: [], assumptions: [], conflicts: [], supersessionIssues: [], coverage: [], debtFindings: [], drift: [], generatedAt: GENERATED_AT });
    const assumptions = buildAssumptions(decisions);

    const forward = buildDecisionPlan({ snapshot, narrative, links: [], implementationStates: [], assumptions, supersessionIssues: [], supersessionChains: [], conflicts: [], coverage: [], drift: [], debtFindings: [], generatedAt: GENERATED_AT });
    const reversed = buildDecisionPlan({ snapshot, narrative, links: [], implementationStates: [], assumptions: [...assumptions].reverse(), supersessionIssues: [], supersessionChains: [], conflicts: [], coverage: [], drift: [], debtFindings: [], generatedAt: GENERATED_AT });

    const forwardScene = forward.scenes.find((s) => s.kind === "decision-assumptions")!;
    const reversedScene = reversed.scenes.find((s) => s.kind === "decision-assumptions")!;

    expect(reversedScene.body).toEqual(forwardScene.body);
    expect(JSON.stringify(reversedScene.body)).toBe(JSON.stringify(forwardScene.body));
    expect(JSON.stringify(canonicalize(reversedScene.body))).toBe(JSON.stringify(canonicalize(forwardScene.body)));
  });

  it("buildDecisionPlan scene evidence_refs mirror input declaration order rather than being independently sorted -- documenting the one field this package's builders do not sort", () => {
    const decisions = buildDecisions();
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const narrative = buildDecisionNarrative({ snapshot, implementationStates: [], assumptions: [], conflicts: [], supersessionIssues: [], coverage: [], debtFindings: [], drift: [], generatedAt: GENERATED_AT });
    const architectureLinks = [
      decisionLink({ decision_id: decisions[0]!.id, link_type: "governs", target_domain: "architecture", target_id: "component:a1", resolution: "resolved", evidence_refs: [{ path: "docs/adr/a1.md", source_artifact: "decision" }] }),
      decisionLink({ decision_id: decisions[1]!.id, link_type: "governs", target_domain: "architecture", target_id: "component:a2", resolution: "resolved", evidence_refs: [{ path: "docs/adr/a2.md", source_artifact: "decision" }] }),
    ];

    const forward = buildDecisionPlan({ snapshot, narrative, links: architectureLinks, implementationStates: [], assumptions: [], supersessionIssues: [], supersessionChains: [], conflicts: [], coverage: [], drift: [], debtFindings: [], generatedAt: GENERATED_AT });
    const reversed = buildDecisionPlan({ snapshot, narrative, links: [...architectureLinks].reverse(), implementationStates: [], assumptions: [], supersessionIssues: [], supersessionChains: [], conflicts: [], coverage: [], drift: [], debtFindings: [], generatedAt: GENERATED_AT });

    const forwardMapScene = forward.scenes.find((s) => s.kind === "decision-architecture-map")!;
    const reversedMapScene = reversed.scenes.find((s) => s.kind === "decision-architecture-map")!;
    expect(reversedMapScene.body).toEqual(forwardMapScene.body);
    expect(reversedMapScene.evidence_refs).not.toEqual(forwardMapScene.evidence_refs);
    expect([...reversedMapScene.evidence_refs].reverse()).toEqual(forwardMapScene.evidence_refs);
  });

  it("buildDecisionNarrative", () => {
    const decisions = buildDecisions();
    const assumptions = buildAssumptions(decisions);
    const conflicts = buildConflicts(decisions);
    const supersessionIssues = buildSupersessionIssues(decisions);
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const outputs = Array.from({ length: RUNS }, (_, i) => {
      const input: BuildDecisionNarrativeInput = {
        snapshot,
        implementationStates: [],
        assumptions: rotate(assumptions, i),
        conflicts: rotate(conflicts, i),
        supersessionIssues: rotate(supersessionIssues, i),
        coverage: [],
        debtFindings: [],
        drift: [],
        generatedAt: GENERATED_AT,
      };
      return JSON.stringify(buildDecisionNarrative(input));
    });
    expect(new Set(outputs).size).toBe(1);
  });
});
