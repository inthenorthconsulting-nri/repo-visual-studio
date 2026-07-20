import type { DecisionPlan, DecisionSceneContent, DecisionSceneKind } from "@rvs/decision-intelligence";
import type { DecisionScene } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { renderDecisionScene } from "../scenes/decision/index.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built fixtures — mirror packages/decision-intelligence's own
// contracts.ts shapes, kept local since renderer-html cannot import another
// package's __tests__ dir (mirroring governance-scene.test.ts's identical
// precedent comment). renderDecisionScene only ever reads plan.scenes (to
// resolve scene_id) and the resolved scene's own {kind,title,body}, so
// DecisionPlan's other fields are filled with structurally-valid
// placeholders that are never actually read.
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function makeSceneContent(kind: DecisionSceneKind, body: unknown = {}, overrides: Partial<DecisionSceneContent> = {}): DecisionSceneContent {
  return { scene_id: `decision:scene:demo:${kind}`, kind, title: `Title for ${kind}`, body, evidence_refs: [], ...overrides };
}

function makePlan(scenes: DecisionSceneContent[], overrides: Partial<DecisionPlan> = {}): DecisionPlan {
  return {
    id: "decision:plan:demo",
    generated_at: GENERATED_AT,
    source_snapshot_id: "decision:snapshot:demo",
    scenes,
    ...overrides,
  };
}

function pointerScene(sceneId: string, planId: string): DecisionScene {
  return { id: `visualdoc:scene:${sceneId}`, type: "decision-scene", headline: "unused-pointer-headline", evidence: [], plan_id: planId, scene_id: sceneId };
}

const ALL_SCENE_KINDS: DecisionSceneKind[] = [
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

describe("renderDecisionScene", () => {
  it("throws when the plan is undefined (unresolved plan_id)", () => {
    const sceneContent = makeSceneContent("decision-hero");
    const scene = pointerScene(sceneContent.scene_id, "decision:plan:demo");
    expect(() => renderDecisionScene(scene, undefined)).toThrow(/unresolved plan_id/);
  });

  it("throws when the plan is resolved but the scene_id has no matching DecisionSceneContent", () => {
    const sceneContent = makeSceneContent("decision-hero");
    const plan = makePlan([sceneContent]);
    const scene = pointerScene("decision:scene:does-not-exist", "decision:plan:demo");
    expect(() => renderDecisionScene(scene, plan)).toThrow(/unresolved scene_id/);
  });

  it.each(ALL_SCENE_KINDS)("renders scene kind %s without throwing, wrapping it with the correct data-scene-kind attribute", (kind) => {
    const sceneContent = makeSceneContent(kind);
    const plan = makePlan([sceneContent]);
    const scene = pointerScene(sceneContent.scene_id, "decision:plan:demo");

    const html = renderDecisionScene(scene, plan);
    expect(html).toContain(`data-scene-kind="${kind}"`);
    expect(html).toContain('class="scene-decision"');
  });

  it("renders the decision-hero scene with summary, compatibility badge, and decision count", () => {
    const sceneContent = makeSceneContent("decision-hero", { summary: "3 decisions were recorded.", compatibility: "complete", decision_count: 3 });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("3 decisions were recorded.");
    expect(html).toContain("governance-compat-complete");
    expect(html).toContain("3 decisions");
  });

  it("renders the decision-landscape scene's by_status counts", () => {
    const sceneContent = makeSceneContent("decision-landscape", { total: 3, by_status: { accepted: 2, proposed: 1 } });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("accepted");
    expect(html).toContain("proposed");
    expect(html).toContain("3 decisions");
  });

  it("renders 'No decisions were found.' when decision-landscape's by_status is empty", () => {
    const sceneContent = makeSceneContent("decision-landscape", { total: 0, by_status: {} });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("No decisions were found.");
  });

  it("renders the decision-status scene's rows", () => {
    const sceneContent = makeSceneContent("decision-status", {
      rows: [{ id: "decision:use-postgres", decision_status: "accepted", implementation_status: "implemented", governance_status: "aligned" }],
    });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("decision:use-postgres");
    expect(html).toContain("accepted");
    expect(html).toContain("implemented");
    expect(html).toContain("aligned");
  });

  it("renders 'No decisions were found.' when decision-status's rows is empty", () => {
    const sceneContent = makeSceneContent("decision-status", { rows: [] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("No decisions were found.");
  });

  it("renders the four domain-map scenes' by_resolution counts and decision_ids", () => {
    for (const kind of ["decision-architecture-map", "decision-capability-map", "decision-product-map", "decision-portfolio-map"] as const) {
      const sceneContent = makeSceneContent(kind, { total: 1, by_resolution: { resolved: 1 }, decision_ids: [`decision:${kind}:x`] });
      const plan = makePlan([sceneContent]);
      const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
      expect(html).toContain("resolved");
      expect(html).toContain(`decision:${kind}:x`);
    }
  });

  it("renders the decision-implementation scene's by_status counts", () => {
    const sceneContent = makeSceneContent("decision-implementation", { total: 2, by_status: { implemented: 1, not_started: 1 } });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("implemented");
    expect(html).toContain("not started");
  });

  it("renders the decision-assumptions scene's by_state counts and contradicted_ids", () => {
    const sceneContent = makeSceneContent("decision-assumptions", { total: 2, by_state: { confirmed: 1, contradicted: 1 }, contradicted_ids: ["decision:assumption:x:scale"] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("confirmed");
    expect(html).toContain("decision:assumption:x:scale");
  });

  it("renders the decision-supersession scene's issue/chain totals and by_issue_kind counts", () => {
    const sceneContent = makeSceneContent("decision-supersession", { issue_total: 1, by_issue_kind: { missing_target: 1 }, chain_total: 2, invalid_chain_count: 1 });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("1 issue");
    expect(html).toContain("2 chains");
    expect(html).toContain("1 invalid chain");
    expect(html).toContain("missing target");
  });

  it("renders the decision-conflicts scene's by_kind counts and unresolved_count", () => {
    const sceneContent = makeSceneContent("decision-conflicts", { total: 2, by_kind: { incompatible_required_states: 2 }, unresolved_count: 1 });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("2 conflicts, 1 unresolved.");
    expect(html).toContain("incompatible required states");
  });

  it("renders the decision-coverage scene's metrics", () => {
    const sceneContent = makeSceneContent("decision-coverage", { metrics: [{ dimension: "architecture_components", numerator: 4, denominator: 10 }] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("architecture_components");
    expect(html).toContain("4 / 10");
  });

  it("renders 'No coverage metrics were recorded.' when decision-coverage's metrics is empty", () => {
    const sceneContent = makeSceneContent("decision-coverage", { metrics: [] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("No coverage metrics were recorded.");
  });

  it("renders the decision-drift scene's severity badges and by_cause counts", () => {
    const sceneContent = makeSceneContent("decision-drift", { total: 2, by_severity: { blocking: 1, advisory: 1 }, by_cause: { stale_evidence: 1 } });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("arch-severity-blocking");
    expect(html).toContain("arch-severity-advisory");
    expect(html).toContain("stale evidence");
  });

  it("renders the decision-debt scene's by_category counts and open_count", () => {
    const sceneContent = makeSceneContent("decision-debt", { total: 2, by_category: { missing_evidence: 2 }, open_count: 1 });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("2 debt findings, 1 open.");
    expect(html).toContain("missing evidence");
  });

  it("renders the decision-governance-impact scene's six id lists", () => {
    const sceneContent = makeSceneContent("decision-governance-impact", {
      changes_missing_decision: ["change:a"],
      decisions_with_contradicted_assumptions: ["decision:b"],
      decisions_active_and_superseded: [],
      exceptions_with_invalid_decision_ref: [],
      unresolved_conflict_decision_ids: [],
      decisions_requiring_review_for_drift: [],
    });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("change:a");
    expect(html).toContain("decision:b");
    expect(html).toContain("Changes missing a decision");
  });

  it("renders the decision-review-required scene's debt_finding_ids and drift_ids", () => {
    const sceneContent = makeSceneContent("decision-review-required", { debt_finding_ids: ["decision:debt:x"], drift_ids: ["decision:drift:y"] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("decision:debt:x");
    expect(html).toContain("decision:drift:y");
  });

  it("renders the decision-validation scene's compatibility and source-issue/unverifiable counts", () => {
    const sceneContent = makeSceneContent("decision-validation", { compatibility: "partial", source_issue_count: 2, unverifiable_implementation_count: 1 });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).toContain("governance-compat-partial");
    expect(html).toContain("2 source issues");
    expect(html).toContain("1 unverifiable implementation state");
  });

  it("HTML-escapes the scene title containing markup-significant characters on every scene kind", () => {
    const sceneContent = makeSceneContent("decision-hero", {}, { title: `<script>alert("x")</script> & 'friends'` });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;");
  });

  it("HTML-escapes decision_ids rendered in a domain-map scene", () => {
    const sceneContent = makeSceneContent("decision-architecture-map", { total: 1, by_resolution: { resolved: 1 }, decision_ids: [`<script>alert("x")</script>`] });
    const plan = makePlan([sceneContent]);
    const html = renderDecisionScene(pointerScene(sceneContent.scene_id, "decision:plan:demo"), plan);
    expect(html).not.toContain("<script>alert(\"x\")</script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});
