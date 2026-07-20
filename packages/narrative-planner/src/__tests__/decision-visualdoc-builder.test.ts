import type { DecisionPlan, DecisionSceneContent, DecisionSceneKind } from "@rvs/decision-intelligence";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { buildDecisionVisualDoc, buildDecisionVisualDocScenes } from "../decision-visualdoc-builder.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built DecisionPlan fixture — this builder only ever reads
// plan.id, plan.source_snapshot_id, and plan.scenes[].{scene_id,title}, so
// the rest of the shape is filled in with structurally-valid placeholders,
// mirroring governance-visualdoc-builder.test.ts's own fixture-minimalism
// precedent. Kept local rather than imported from
// @rvs/decision-intelligence/src/__tests__/decision-fixtures.ts since
// renderer-html/narrative-planner cannot import another package's __tests__
// dir (see renderer-html's portfolio-scene.test.ts for the identical
// precedent comment).
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function makeSceneContent(kind: DecisionSceneKind, sceneId: string, title: string): DecisionSceneContent {
  return { scene_id: sceneId, kind, title, body: {}, evidence_refs: [] };
}

function makePlan(scenes: DecisionSceneContent[], overrides: Partial<DecisionPlan> = {}): DecisionPlan {
  return {
    id: "decision:plan:decision:snapshot:demo",
    generated_at: GENERATED_AT,
    source_snapshot_id: "decision:snapshot:demo",
    scenes,
    ...overrides,
  };
}

describe("buildDecisionVisualDocScenes", () => {
  it("emits one decision-scene pointer per DecisionSceneContent, in the plan's own (canonical-kind-sorted) order — never re-sorted", () => {
    const scenes = [
      makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "Decision snapshot: decision:snapshot:demo"),
      makeSceneContent("decision-landscape", "decision:scene:demo:decision-landscape", "Decision landscape"),
    ];
    const plan = makePlan(scenes);
    const result = buildDecisionVisualDocScenes(plan);
    expect(result.map((s) => s.id)).toEqual(["decision:scene:demo:decision-hero", "decision:scene:demo:decision-landscape"]);
  });

  it("builds each pointer scene with type='decision-scene', the scene's own scene_id/title, empty evidence, plan_id=plan.id, and scene_id=scene.scene_id", () => {
    const sceneContent = makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "Decision snapshot: decision:snapshot:demo");
    const plan = makePlan([sceneContent], { id: "decision:plan:demo" });
    const [scene] = buildDecisionVisualDocScenes(plan);
    expect(scene).toEqual({
      id: "decision:scene:demo:decision-hero",
      type: "decision-scene",
      headline: "Decision snapshot: decision:snapshot:demo",
      evidence: [],
      plan_id: "decision:plan:demo",
      scene_id: "decision:scene:demo:decision-hero",
    });
  });

  it("uses plan.id as plan_id — the whole-snapshot stable key", () => {
    const sceneContent = makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "headline");
    const plan = makePlan([sceneContent], { id: "decision:plan:decision:snapshot:widget-a" });
    const [scene] = buildDecisionVisualDocScenes(plan);
    expect(scene.type === "decision-scene" ? scene.plan_id : undefined).toBe("decision:plan:decision:snapshot:widget-a");
  });

  it("returns an empty array for a plan with no scenes", () => {
    const plan = makePlan([]);
    expect(buildDecisionVisualDocScenes(plan)).toEqual([]);
  });
});

describe("buildDecisionVisualDoc", () => {
  it("produces a schema-valid VisualDoc", () => {
    const scenes = [
      makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "Decision snapshot: decision:snapshot:demo"),
      makeSceneContent("decision-landscape", "decision:scene:demo:decision-landscape", "Decision landscape"),
    ];
    const plan = makePlan(scenes);
    const doc = buildDecisionVisualDoc(plan);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
  });

  it("titles the document from source_snapshot_id alone, with a fixed audience/theme (DecisionPlan carries no report/generationMetadata)", () => {
    const plan = makePlan([makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "headline")], {
      source_snapshot_id: "decision:snapshot:widget:v1",
    });
    const doc = buildDecisionVisualDoc(plan);
    expect(doc.document.title).toBe("Architecture Decisions: decision:snapshot:widget:v1");
    expect(doc.document.audience).toBe("decisions");
    expect(doc.document.theme).toBe("technical-grid");
    expect(doc.document.aspect_ratio).toBe("16:9");
    expect(doc.version).toBe(1);
  });

  it("is a complete, self-ordered presentation on its own — every scene is a decision-scene pointer, matching plan.scenes 1:1", () => {
    const scenes = [
      makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "hero"),
      makeSceneContent("decision-landscape", "decision:scene:demo:decision-landscape", "landscape"),
      makeSceneContent("decision-coverage", "decision:scene:demo:decision-coverage", "coverage"),
    ];
    const plan = makePlan(scenes);
    const doc = buildDecisionVisualDoc(plan);
    expect(doc.scenes).toHaveLength(3);
    expect(doc.scenes.every((s) => s.type === "decision-scene")).toBe(true);
  });

  it("is deterministic: two builds of the same plan produce identical output", () => {
    const scenes = [makeSceneContent("decision-hero", "decision:scene:demo:decision-hero", "headline")];
    const plan = makePlan(scenes);
    const a = buildDecisionVisualDoc(plan);
    const b = buildDecisionVisualDoc(plan);
    expect(a).toEqual(b);
  });
});
