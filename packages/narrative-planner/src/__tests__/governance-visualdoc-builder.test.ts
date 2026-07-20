import type {
  ArchitectureChangeSet,
  BlastRadiusAssessment,
  CapabilityChangeSet,
  ContinuousIntelligenceReport,
  EvidenceChangeSet,
  GovernanceNarrative,
  GovernancePlan,
  GovernanceSceneContent,
  GovernanceSceneKind,
  ProductChangeSet,
} from "@rvs/governance-intelligence";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { buildGovernanceVisualDoc, buildGovernanceVisualDocScenes } from "../governance-visualdoc-builder.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built GovernancePlan fixture — this builder only ever reads
// plan.id, plan.report.{source_snapshot_id,target_snapshot_id}, and
// plan.scenes[].{scene_id,title}, so the rest of the shape is filled in with
// structurally-valid placeholders, mirroring
// portfolio-visualdoc-builder.test.ts's own fixture-minimalism precedent.
// Kept local rather than imported from
// @rvs/governance-intelligence/src/__tests__/governance-fixtures.ts since
// renderer-html/narrative-planner cannot import another package's __tests__
// dir (see renderer-html's portfolio-scene.test.ts for the identical
// precedent comment).
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function makeChangeSet(id: string): ArchitectureChangeSet & CapabilityChangeSet & ProductChangeSet {
  return {
    schema_version: 1,
    id,
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    compatibility: "compatible",
    changes: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

function makeEvidenceChangeSet(): EvidenceChangeSet {
  return {
    schema_version: 1,
    id: "changeset:evidence",
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    compatibility: "compatible",
    changes: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

function makeBlastRadius(): BlastRadiusAssessment {
  return {
    schema_version: 1,
    id: "blast-radius:demo",
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    entries: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

function makeReport(overrides: Partial<ContinuousIntelligenceReport> = {}): ContinuousIntelligenceReport {
  return {
    schema_version: 1,
    id: "governance:report:demo:source:demo:target",
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    compatibility: "compatible",
    architecture_changes: makeChangeSet("changeset:architecture"),
    capability_changes: makeChangeSet("changeset:capability"),
    product_changes: makeChangeSet("changeset:product"),
    evidence_changes: makeEvidenceChangeSet(),
    blast_radius: makeBlastRadius(),
    evaluations: [],
    findings: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
    ...overrides,
  };
}

function makeNarrative(overrides: Partial<GovernanceNarrative> = {}): GovernanceNarrative {
  return {
    schema_version: 1,
    id: "governance:narrative:demo:source:demo:target",
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    summary: "No blocking changes were detected between the two snapshots.",
    whatChanged: "",
    whyItMatters: "",
    riskAssessment: "",
    recommendedActions: "",
    approvedClaims: [],
    rejectedClaims: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
    ...overrides,
  };
}

function makeSceneContent(kind: GovernanceSceneKind, sceneId: string, title: string): GovernanceSceneContent {
  return { scene_id: sceneId, kind, title, data: {}, evidence_refs: [] };
}

function makePlan(scenes: GovernanceSceneContent[], overrides: Partial<GovernancePlan> = {}): GovernancePlan {
  return {
    schema_version: 1,
    id: "governance:plan:governance:report:demo:source:demo:target",
    report: makeReport(),
    narrative: makeNarrative(),
    scenes,
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
    ...overrides,
  };
}

describe("buildGovernanceVisualDocScenes", () => {
  it("emits one governance-scene pointer per GovernanceSceneContent, in the plan's own (canonical-kind-sorted) order — never re-sorted", () => {
    const scenes = [
      makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "Governance comparison: source -> target"),
      makeSceneContent("change-summary", "governance:scene:demo:change-summary", "Change summary"),
    ];
    const plan = makePlan(scenes);
    const result = buildGovernanceVisualDocScenes(plan);
    expect(result.map((s) => s.id)).toEqual(["governance:scene:demo:governance-hero", "governance:scene:demo:change-summary"]);
  });

  it("builds each pointer scene with type='governance-scene', the scene's own scene_id/title, empty evidence, plan_id=plan.id, and scene_id=scene.scene_id", () => {
    const sceneContent = makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "Governance comparison: source -> target");
    const plan = makePlan([sceneContent], { id: "governance:plan:demo" });
    const [scene] = buildGovernanceVisualDocScenes(plan);
    expect(scene).toEqual({
      id: "governance:scene:demo:governance-hero",
      type: "governance-scene",
      headline: "Governance comparison: source -> target",
      evidence: [],
      plan_id: "governance:plan:demo",
      scene_id: "governance:scene:demo:governance-hero",
    });
  });

  it("uses plan.id as plan_id — the whole-comparison stable key", () => {
    const sceneContent = makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "headline");
    const plan = makePlan([sceneContent], { id: "governance:plan:governance:report:widget-a:widget-b" });
    const [scene] = buildGovernanceVisualDocScenes(plan);
    expect(scene.type === "governance-scene" ? scene.plan_id : undefined).toBe("governance:plan:governance:report:widget-a:widget-b");
  });

  it("returns an empty array for a plan with no scenes", () => {
    const plan = makePlan([]);
    expect(buildGovernanceVisualDocScenes(plan)).toEqual([]);
  });
});

describe("buildGovernanceVisualDoc", () => {
  it("produces a schema-valid VisualDoc", () => {
    const scenes = [
      makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "Governance comparison: source -> target"),
      makeSceneContent("change-summary", "governance:scene:demo:change-summary", "Change summary"),
    ];
    const plan = makePlan(scenes);
    const doc = buildGovernanceVisualDoc(plan);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
  });

  it("titles the document from the report's source/target snapshot ids, with a fixed audience/theme (GovernancePlan carries no generationMetadata.audience/theme)", () => {
    const plan = makePlan([makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "headline")], {
      report: makeReport({ source_snapshot_id: "governance:snapshot:widget:v1", target_snapshot_id: "governance:snapshot:widget:v2" }),
    });
    const doc = buildGovernanceVisualDoc(plan);
    expect(doc.document.title).toBe("Architecture Governance: governance:snapshot:widget:v1 -> governance:snapshot:widget:v2");
    expect(doc.document.audience).toBe("governance");
    expect(doc.document.theme).toBe("technical-grid");
    expect(doc.document.aspect_ratio).toBe("16:9");
    expect(doc.version).toBe(1);
  });

  it("is a complete, self-ordered presentation on its own — every scene is a governance-scene pointer, matching plan.scenes 1:1", () => {
    const scenes = [
      makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "hero"),
      makeSceneContent("change-summary", "governance:scene:demo:change-summary", "change summary"),
      makeSceneContent("policy-findings", "governance:scene:demo:policy-findings", "policy findings"),
    ];
    const plan = makePlan(scenes);
    const doc = buildGovernanceVisualDoc(plan);
    expect(doc.scenes).toHaveLength(3);
    expect(doc.scenes.every((s) => s.type === "governance-scene")).toBe(true);
  });

  it("is deterministic: two builds of the same plan produce identical output", () => {
    const scenes = [makeSceneContent("governance-hero", "governance:scene:demo:governance-hero", "headline")];
    const plan = makePlan(scenes);
    const a = buildGovernanceVisualDoc(plan);
    const b = buildGovernanceVisualDoc(plan);
    expect(a).toEqual(b);
  });
});
