import { describe, expect, it } from "vitest";
import { buildDecisionNarrative, containsForbiddenPhrasing, type BuildDecisionNarrativeInput } from "../narrative.js";
import { buildNarrativeId } from "../ids.js";
import {
  architectureDecision,
  decisionAssumption,
  decisionChange,
  decisionChangeSet,
  decisionConflict,
  decisionCoverageMetric,
  decisionDebtFinding,
  decisionDrift,
  decisionGovernanceContextEcho,
  decisionImplementationState,
  decisionSnapshot,
  decisionSupersessionIssue,
  GENERATED_AT,
} from "./decision-fixtures.js";

const EXPECTED_HEADINGS = [
  "Headline",
  "Decision landscape",
  "Accepted/active decisions",
  "Implementation alignment",
  "Material decision changes",
  "Assumption changes",
  "Conflicts and supersession",
  "Decision coverage",
  "Decision debt",
  "Governance impact",
  "Human review required",
  "Evidence limitations",
];

function minimalInput(overrides: Partial<BuildDecisionNarrativeInput> = {}): BuildDecisionNarrativeInput {
  return {
    snapshot: decisionSnapshot(),
    implementationStates: [],
    assumptions: [],
    conflicts: [],
    supersessionIssues: [],
    coverage: [],
    debtFindings: [],
    drift: [],
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

describe("containsForbiddenPhrasing", () => {
  it("returns an empty array for clean text", () => {
    expect(containsForbiddenPhrasing("This decision was accepted and is implemented.")).toEqual([]);
  });

  it("catches each of the 6 forbidden phrases, case-insensitively", () => {
    const phrases = ["decision is correct", "decision is safe", "no risk", "no impact", "architecture is improved", "guaranteed to work"];
    for (const phrase of phrases) {
      expect(containsForbiddenPhrasing(`Some text. The ${phrase.toUpperCase()}. More text.`)).toContain(phrase);
    }
  });

  it("can return multiple hits in a single string", () => {
    const hits = containsForbiddenPhrasing("There is no risk and no impact here.");
    expect(hits).toEqual(["no risk", "no impact"]);
  });
});

describe("buildDecisionNarrative", () => {
  it("emits exactly the 12 fixed sections, in the fixed order", () => {
    const narrative = buildDecisionNarrative(minimalInput());
    expect(narrative.sections.map((s) => s.heading)).toEqual(EXPECTED_HEADINGS);
  });

  it("derives id via buildNarrativeId(source, undefined) when no changeSet is provided", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:abc" });
    const narrative = buildDecisionNarrative(minimalInput({ snapshot }));
    expect(narrative.id).toBe(buildNarrativeId(snapshot.id));
    expect(narrative.source_snapshot_id).toBe(snapshot.id);
    expect(narrative.target_snapshot_id).toBeUndefined();
  });

  it("derives id via buildNarrativeId(source, target) when a changeSet is provided", () => {
    const snapshot = decisionSnapshot({ id: "decision:snapshot:abc" });
    const changeSet = decisionChangeSet({ source_snapshot_id: snapshot.id, target_snapshot_id: "decision:snapshot:def" });
    const narrative = buildDecisionNarrative(minimalInput({ snapshot, changeSet }));
    expect(narrative.id).toBe(buildNarrativeId(snapshot.id, "decision:snapshot:def"));
    expect(narrative.target_snapshot_id).toBe("decision:snapshot:def");
  });

  it("passes through the caller-supplied generatedAt verbatim, never computing its own timestamp", () => {
    const narrative = buildDecisionNarrative(minimalInput({ generatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(narrative.generated_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("reflects real decision counts in the Headline and Decision landscape sections", () => {
    const decisions = [architectureDecision({ decision_status: "accepted" }), architectureDecision({ decision_status: "draft" })];
    const snapshot = decisionSnapshot({ decisions });
    const narrative = buildDecisionNarrative(minimalInput({ snapshot }));
    const headline = narrative.sections.find((s) => s.heading === "Headline")!.body;
    expect(headline).toContain(`${decisions.length} decision record(s)`);
    const landscape = narrative.sections.find((s) => s.heading === "Decision landscape")!.body;
    expect(landscape).toContain("1 accepted");
    expect(landscape).toContain("1 draft");
  });

  it("reports comparison details in Headline and Material decision changes only when a changeSet is supplied", () => {
    const withoutChangeSet = buildDecisionNarrative(minimalInput());
    expect(withoutChangeSet.sections.find((s) => s.heading === "Headline")!.body).toContain("No comparison target was provided");
    expect(withoutChangeSet.sections.find((s) => s.heading === "Material decision changes")!.body).toContain("No comparison target was provided");

    const change = decisionChange({ classification: "material" });
    const changeSet = decisionChangeSet({ changes: [change] });
    const withChangeSet = buildDecisionNarrative(minimalInput({ changeSet }));
    expect(withChangeSet.sections.find((s) => s.heading === "Headline")!.body).toContain(`${changeSet.changes.length} change entr`);
    expect(withChangeSet.sections.find((s) => s.heading === "Material decision changes")!.body).toContain("1 material decision change(s)");
  });

  it("surfaces contradicted assumptions by decision id in Assumption changes", () => {
    const assumption = decisionAssumption({ decision_id: "decision:test-1", state: "contradicted" });
    const narrative = buildDecisionNarrative(minimalInput({ assumptions: [assumption] }));
    const body = narrative.sections.find((s) => s.heading === "Assumption changes")!.body;
    expect(body).toContain("1 assumption(s) are contradicted");
    expect(body).toContain("decision:test-1");
  });

  it("reports unresolved conflict and supersession issue counts in Conflicts and supersession", () => {
    const conflict = decisionConflict({ status: "confirmed" });
    const issue = decisionSupersessionIssue();
    const narrative = buildDecisionNarrative(minimalInput({ conflicts: [conflict], supersessionIssues: [issue] }));
    const body = narrative.sections.find((s) => s.heading === "Conflicts and supersession")!.body;
    expect(body).toContain("1 conflict(s) detected (1 not resolved)");
    expect(body).toContain("1 supersession issue(s) detected");
  });

  it("reflects decision coverage metrics in Decision coverage", () => {
    const coverage = decisionCoverageMetric({ dimension: "architecture_entities", numerator: 3, denominator: 5 });
    const narrative = buildDecisionNarrative(minimalInput({ coverage: [coverage] }));
    const body = narrative.sections.find((s) => s.heading === "Decision coverage")!.body;
    expect(body).toContain("architecture_entities: 3/5");
  });

  it("reflects decision debt findings in Decision debt", () => {
    const finding = decisionDebtFinding({ category: "orphaned_decision" });
    const narrative = buildDecisionNarrative(minimalInput({ debtFindings: [finding] }));
    const body = narrative.sections.find((s) => s.heading === "Decision debt")!.body;
    expect(body).toContain("1 decision debt finding(s) identified");
    expect(body).toContain("orphaned_decision");
  });

  it("reports all 6 governanceContext counts in Governance impact, or an unavailable message when absent", () => {
    const withoutContext = buildDecisionNarrative(minimalInput());
    expect(withoutContext.sections.find((s) => s.heading === "Governance impact")!.body).toContain("No governance context was supplied");

    const context = decisionGovernanceContextEcho({
      changes_missing_decision: ["a"],
      decisions_with_contradicted_assumptions: ["b"],
    });
    const withContext = buildDecisionNarrative(minimalInput({ governanceContext: context }));
    const body = withContext.sections.find((s) => s.heading === "Governance impact")!.body;
    expect(body).toContain("1 change(s) missing a linked decision");
    expect(body).toContain("1 decision(s) with contradicted assumptions");
  });

  it("counts debt findings requiring human review and blocking/review_required drift in Human review required", () => {
    const finding = decisionDebtFinding({ requires_human_review: true });
    const driftEntry = decisionDrift({ severity: "blocking" });
    const narrative = buildDecisionNarrative(minimalInput({ debtFindings: [finding], drift: [driftEntry] }));
    const body = narrative.sections.find((s) => s.heading === "Human review required")!.body;
    expect(body).toContain("1 decision debt finding(s)");
    expect(body).toContain("1 drift entr");
  });

  it("reflects snapshot compatibility and source issue counts in Evidence limitations", () => {
    const snapshot = decisionSnapshot({ compatibility: "partial", source_issues: [{ id: "x", kind: "duplicate_id_exact", affected_paths: [], detail: "d", evidence_refs: [] }] });
    const narrative = buildDecisionNarrative(minimalInput({ snapshot }));
    const body = narrative.sections.find((s) => s.heading === "Evidence limitations")!.body;
    expect(body).toContain('"partial"');
    expect(body).toContain("1 source issue(s)");
  });

  it("is fully deterministic: identical input produces byte-identical output", () => {
    const input = minimalInput({
      snapshot: decisionSnapshot({ id: "decision:snapshot:stable", decisions: [architectureDecision({ id: "decision:stable-1" })] }),
    });
    const first = buildDecisionNarrative(input);
    const second = buildDecisionNarrative(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("never emits forbidden phrasing in any section across a data-rich narrative", () => {
    const narrative = buildDecisionNarrative(
      minimalInput({
        snapshot: decisionSnapshot({ decisions: [architectureDecision({ decision_status: "accepted" }), architectureDecision({ decision_status: "rejected" })] }),
        implementationStates: [decisionImplementationState()],
        assumptions: [decisionAssumption({ state: "contradicted" })],
        conflicts: [decisionConflict({ status: "confirmed" })],
        supersessionIssues: [decisionSupersessionIssue()],
        coverage: [decisionCoverageMetric()],
        debtFindings: [decisionDebtFinding({ requires_human_review: true })],
        drift: [decisionDrift({ severity: "blocking" })],
        governanceContext: decisionGovernanceContextEcho(),
      }),
    );
    for (const section of narrative.sections) {
      expect(containsForbiddenPhrasing(section.body)).toEqual([]);
    }
  });
});
