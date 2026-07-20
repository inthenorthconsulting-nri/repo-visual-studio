import { describe, expect, it } from "vitest";
import { buildDecisionPlan, type BuildDecisionPlanInput } from "../decision-plan.js";
import { buildPlanId, buildSceneId } from "../ids.js";
import {
  architectureDecision,
  decisionAssumption,
  decisionConflict,
  decisionCoverageMetric,
  decisionDebtFinding,
  decisionDrift,
  decisionGovernanceContextEcho,
  decisionImplementationState,
  decisionLink,
  decisionNarrative,
  decisionSnapshot,
  decisionSourceIssue,
  decisionSupersessionChain,
  decisionSupersessionIssue,
  GENERATED_AT,
} from "./decision-fixtures.js";

const CANONICAL_ORDER = [
  "decision-hero",
  "decision-landscape",
  "decision-status",
  "decision-architecture-map",
  "decision-capability-map",
  "decision-product-map",
  "decision-portfolio-map",
  "decision-implementation",
  "decision-assumptions",
  "decision-supersession",
  "decision-conflicts",
  "decision-coverage",
  "decision-drift",
  "decision-debt",
  "decision-governance-impact",
  "decision-review-required",
  "decision-validation",
];

function minimalInput(overrides: Partial<BuildDecisionPlanInput> = {}): BuildDecisionPlanInput {
  return {
    snapshot: decisionSnapshot(),
    narrative: decisionNarrative(),
    links: [],
    implementationStates: [],
    assumptions: [],
    supersessionIssues: [],
    supersessionChains: [],
    conflicts: [],
    coverage: [],
    drift: [],
    debtFindings: [],
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

describe("buildDecisionPlan: hero scene", () => {
  it("always includes the decision-hero scene, even for a fully empty snapshot", () => {
    const plan = buildDecisionPlan(minimalInput());
    expect(plan.scenes.map((s) => s.kind)).toEqual(["decision-hero"]);
  });

  it("derives id via buildPlanId(snapshot.id)", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:xyz" });
    const plan = buildDecisionPlan(minimalInput({ snapshot }));
    expect(plan.id).toBe(buildPlanId(snapshot.id));
    expect(plan.source_snapshot_id).toBe(snapshot.id);
  });

  it("passes through the caller-supplied generatedAt verbatim", () => {
    const plan = buildDecisionPlan(minimalInput({ generatedAt: "2020-05-05T00:00:00.000Z" }));
    expect(plan.generated_at).toBe("2020-05-05T00:00:00.000Z");
  });
});

describe("buildDecisionPlan: evidence gating per scene", () => {
  it("decision-landscape and decision-status appear only when there is at least one decision", () => {
    const withoutDecisions = buildDecisionPlan(minimalInput());
    expect(withoutDecisions.scenes.some((s) => s.kind === "decision-landscape")).toBe(false);
    expect(withoutDecisions.scenes.some((s) => s.kind === "decision-status")).toBe(false);

    const snapshot = decisionSnapshot({ decisions: [architectureDecision()] });
    const withDecisions = buildDecisionPlan(minimalInput({ snapshot }));
    expect(withDecisions.scenes.some((s) => s.kind === "decision-landscape")).toBe(true);
    expect(withDecisions.scenes.some((s) => s.kind === "decision-status")).toBe(true);
  });

  for (const [kind, domain] of [
    ["decision-architecture-map", "architecture"],
    ["decision-capability-map", "capability"],
    ["decision-product-map", "product"],
    ["decision-portfolio-map", "portfolio"],
  ] as const) {
    it(`${kind} appears only when a link targets domain "${domain}"`, () => {
      const withoutLinks = buildDecisionPlan(minimalInput());
      expect(withoutLinks.scenes.some((s) => s.kind === kind)).toBe(false);

      const link = decisionLink({ target_domain: domain });
      const withLinks = buildDecisionPlan(minimalInput({ links: [link] }));
      expect(withLinks.scenes.some((s) => s.kind === kind)).toBe(true);
    });

    it(`${kind} does not appear when links exist only for other domains`, () => {
      const otherDomain = domain === "architecture" ? "capability" : "architecture";
      const link = decisionLink({ target_domain: otherDomain });
      const plan = buildDecisionPlan(minimalInput({ links: [link] }));
      expect(plan.scenes.some((s) => s.kind === kind)).toBe(false);
    });
  }

  it("decision-implementation appears only when implementationStates is non-empty", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-implementation")).toBe(false);
    const withState = buildDecisionPlan(minimalInput({ implementationStates: [decisionImplementationState()] }));
    expect(withState.scenes.some((s) => s.kind === "decision-implementation")).toBe(true);
  });

  it("decision-assumptions appears only when assumptions is non-empty, and reports sorted contradicted_ids", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-assumptions")).toBe(false);
    const contradicted = decisionAssumption({ id: "decision:assumption:z", state: "contradicted" });
    const contradicted2 = decisionAssumption({ id: "decision:assumption:a", state: "contradicted" });
    const plan = buildDecisionPlan(minimalInput({ assumptions: [contradicted, contradicted2] }));
    const scene = plan.scenes.find((s) => s.kind === "decision-assumptions")!;
    expect((scene.body as { contradicted_ids: string[] }).contradicted_ids).toEqual(["decision:assumption:a", "decision:assumption:z"]);
  });

  it("decision-supersession appears when either issues or chains is non-empty, but not when both are empty", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-supersession")).toBe(false);
    const withIssueOnly = buildDecisionPlan(minimalInput({ supersessionIssues: [decisionSupersessionIssue()] }));
    expect(withIssueOnly.scenes.some((s) => s.kind === "decision-supersession")).toBe(true);
    const withChainOnly = buildDecisionPlan(minimalInput({ supersessionChains: [decisionSupersessionChain()] }));
    expect(withChainOnly.scenes.some((s) => s.kind === "decision-supersession")).toBe(true);
  });

  it("decision-conflicts appears only when conflicts is non-empty, and reports unresolved_count", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-conflicts")).toBe(false);
    const resolved = decisionConflict({ status: "resolved" });
    const confirmed = decisionConflict({ status: "confirmed" });
    const plan = buildDecisionPlan(minimalInput({ conflicts: [resolved, confirmed] }));
    const scene = plan.scenes.find((s) => s.kind === "decision-conflicts")!;
    expect((scene.body as { unresolved_count: number }).unresolved_count).toBe(1);
  });

  it("decision-coverage appears only when coverage is non-empty", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-coverage")).toBe(false);
    const withCoverage = buildDecisionPlan(minimalInput({ coverage: [decisionCoverageMetric()] }));
    expect(withCoverage.scenes.some((s) => s.kind === "decision-coverage")).toBe(true);
  });

  it("decision-drift appears only when drift is non-empty", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-drift")).toBe(false);
    const withDrift = buildDecisionPlan(minimalInput({ drift: [decisionDrift()] }));
    expect(withDrift.scenes.some((s) => s.kind === "decision-drift")).toBe(true);
  });

  it("decision-debt appears only when debtFindings is non-empty, and reports open_count", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-debt")).toBe(false);
    const open = decisionDebtFinding({ resolution_state: "open" });
    const closed = decisionDebtFinding({ resolution_state: "resolved" });
    const plan = buildDecisionPlan(minimalInput({ debtFindings: [open, closed] }));
    const scene = plan.scenes.find((s) => s.kind === "decision-debt")!;
    expect((scene.body as { open_count: number }).open_count).toBe(1);
  });

  it("decision-governance-impact is absent when governanceContext is undefined", () => {
    const plan = buildDecisionPlan(minimalInput());
    expect(plan.scenes.some((s) => s.kind === "decision-governance-impact")).toBe(false);
  });

  it("decision-governance-impact is absent when governanceContext is present but all 6 arrays are empty", () => {
    const plan = buildDecisionPlan(minimalInput({ governanceContext: decisionGovernanceContextEcho() }));
    expect(plan.scenes.some((s) => s.kind === "decision-governance-impact")).toBe(false);
  });

  it("decision-governance-impact appears when governanceContext has at least one non-empty array", () => {
    const context = decisionGovernanceContextEcho({ changes_missing_decision: ["decision:test-1"] });
    const plan = buildDecisionPlan(minimalInput({ governanceContext: context }));
    expect(plan.scenes.some((s) => s.kind === "decision-governance-impact")).toBe(true);
  });

  it("decision-review-required appears only when debt requiring review or blocking/review_required drift exists", () => {
    const without = buildDecisionPlan(minimalInput());
    expect(without.scenes.some((s) => s.kind === "decision-review-required")).toBe(false);

    const advisoryDrift = decisionDrift({ severity: "advisory" });
    const stillWithout = buildDecisionPlan(minimalInput({ drift: [advisoryDrift] }));
    expect(stillWithout.scenes.some((s) => s.kind === "decision-review-required")).toBe(false);

    const reviewDebt = decisionDebtFinding({ requires_human_review: true });
    const withDebt = buildDecisionPlan(minimalInput({ debtFindings: [reviewDebt] }));
    expect(withDebt.scenes.some((s) => s.kind === "decision-review-required")).toBe(true);

    const blockingDrift = decisionDrift({ severity: "blocking" });
    const withDrift = buildDecisionPlan(minimalInput({ drift: [blockingDrift] }));
    expect(withDrift.scenes.some((s) => s.kind === "decision-review-required")).toBe(true);

    const reviewRequiredDrift = decisionDrift({ severity: "review_required" });
    const withReviewRequiredDrift = buildDecisionPlan(minimalInput({ drift: [reviewRequiredDrift] }));
    expect(withReviewRequiredDrift.scenes.some((s) => s.kind === "decision-review-required")).toBe(true);
  });

  it("decision-validation is absent when compatibility is complete, no source issues, and no unverifiable implementation states", () => {
    const plan = buildDecisionPlan(minimalInput());
    expect(plan.scenes.some((s) => s.kind === "decision-validation")).toBe(false);
  });

  it("decision-validation appears when compatibility is not complete", () => {
    const snapshot = decisionSnapshot({ compatibility: "partial" });
    const plan = buildDecisionPlan(minimalInput({ snapshot }));
    expect(plan.scenes.some((s) => s.kind === "decision-validation")).toBe(true);
  });

  it("decision-validation appears when source_issues is non-empty", () => {
    const snapshot = decisionSnapshot({ source_issues: [decisionSourceIssue()] });
    const plan = buildDecisionPlan(minimalInput({ snapshot }));
    expect(plan.scenes.some((s) => s.kind === "decision-validation")).toBe(true);
  });

  it("decision-validation appears when at least one implementation state is unverifiable", () => {
    const state = decisionImplementationState({ status: "unverifiable" });
    const plan = buildDecisionPlan(minimalInput({ implementationStates: [state] }));
    expect(plan.scenes.some((s) => s.kind === "decision-validation")).toBe(true);
  });
});

describe("buildDecisionPlan: canonical ordering", () => {
  it("sorts a fully populated plan's scenes by canonical kind order", () => {
    const decision = architectureDecision();
    const snapshot = decisionSnapshot({ decisions: [decision] });
    const plan = buildDecisionPlan(
      minimalInput({
        snapshot,
        links: [decisionLink({ target_domain: "architecture" }), decisionLink({ target_domain: "capability" }), decisionLink({ target_domain: "product" }), decisionLink({ target_domain: "portfolio" })],
        implementationStates: [decisionImplementationState({ status: "unverifiable" })],
        assumptions: [decisionAssumption()],
        supersessionIssues: [decisionSupersessionIssue()],
        conflicts: [decisionConflict()],
        coverage: [decisionCoverageMetric()],
        drift: [decisionDrift({ severity: "blocking" })],
        debtFindings: [decisionDebtFinding({ requires_human_review: true })],
        governanceContext: decisionGovernanceContextEcho({ changes_missing_decision: ["x"] }),
      }),
    );
    expect(plan.scenes.map((s) => s.kind)).toEqual(CANONICAL_ORDER);
    for (let i = 1; i < plan.scenes.length; i += 1) {
      expect(CANONICAL_ORDER.indexOf(plan.scenes[i - 1].kind)).toBeLessThan(CANONICAL_ORDER.indexOf(plan.scenes[i].kind));
    }
  });

  it("every emitted scene_id is derived via buildSceneId(planId, kind)", () => {
    const snapshot = decisionSnapshot({ decisions: [architectureDecision()] });
    const plan = buildDecisionPlan(minimalInput({ snapshot }));
    for (const scene of plan.scenes) {
      expect(scene.scene_id).toBe(buildSceneId(plan.id, scene.kind));
    }
  });
});

describe("buildDecisionPlan: determinism", () => {
  it("is fully deterministic: identical input produces byte-identical output", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:stable", decisions: [architectureDecision({ id: "decision:stable-1" })] });
    const input = minimalInput({ snapshot, links: [decisionLink({ target_domain: "architecture" })] });
    const first = buildDecisionPlan(input);
    const second = buildDecisionPlan(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
