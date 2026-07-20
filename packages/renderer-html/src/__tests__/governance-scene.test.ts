import type { ArchitectureChangeSet, BlastRadiusAssessment, CapabilityChangeSet, ContinuousIntelligenceReport, EvidenceChangeSet, GovernanceNarrative, GovernancePlan, GovernanceSceneContent, GovernanceSceneKind, ProductChangeSet } from "@rvs/governance-intelligence";
import type { GovernanceScene } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { renderGovernanceScene } from "../scenes/governance/index.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built fixtures — mirror packages/governance-intelligence's
// own contracts.ts shapes, kept local since renderer-html cannot import
// another package's __tests__ dir (mirroring portfolio-scene.test.ts's
// identical precedent comment). renderGovernanceScene only ever reads
// plan.scenes (to resolve scene_id) and the resolved scene's own
// {kind,title,data}, so plan.report/plan.narrative are filled with
// structurally-valid placeholders that are never actually read.
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

function makeBlastRadiusAssessment(): BlastRadiusAssessment {
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

function makeReport(): ContinuousIntelligenceReport {
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
    blast_radius: makeBlastRadiusAssessment(),
    evaluations: [],
    findings: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

function makeNarrative(): GovernanceNarrative {
  return {
    schema_version: 1,
    id: "governance:narrative:demo:source:demo:target",
    source_snapshot_id: "governance:snapshot:demo:source",
    target_snapshot_id: "governance:snapshot:demo:target",
    summary: "",
    whatChanged: "",
    whyItMatters: "",
    riskAssessment: "",
    recommendedActions: "",
    approvedClaims: [],
    rejectedClaims: [],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
  };
}

function makeSceneContent(kind: GovernanceSceneKind, data: Record<string, unknown> = {}, overrides: Partial<GovernanceSceneContent> = {}): GovernanceSceneContent {
  return { scene_id: `governance:scene:demo:${kind}`, kind, title: `Title for ${kind}`, data, evidence_refs: [], ...overrides };
}

function makePlan(scenes: GovernanceSceneContent[], overrides: Partial<GovernancePlan> = {}): GovernancePlan {
  return {
    schema_version: 1,
    id: "governance:plan:demo",
    report: makeReport(),
    narrative: makeNarrative(),
    scenes,
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
    ...overrides,
  };
}

function pointerScene(sceneId: string, planId: string): GovernanceScene {
  return { id: `visualdoc:scene:${sceneId}`, type: "governance-scene", headline: "unused-pointer-headline", evidence: [], plan_id: planId, scene_id: sceneId };
}

const ALL_SCENE_KINDS: GovernanceSceneKind[] = [
  "governance-hero",
  "snapshot-comparison",
  "change-summary",
  "architecture-change-map",
  "capability-regression",
  "product-change",
  "portfolio-change",
  "evidence-regression",
  "blast-radius",
  "policy-findings",
  "exceptions",
  "decision-required",
  "governance-validation",
];

describe("renderGovernanceScene", () => {
  it("throws when the plan is undefined (unresolved plan_id)", () => {
    const sceneContent = makeSceneContent("governance-hero");
    const scene = pointerScene(sceneContent.scene_id, "governance:plan:demo");
    expect(() => renderGovernanceScene(scene, undefined)).toThrow(/unresolved plan_id/);
  });

  it("throws when the plan is resolved but the scene_id has no matching GovernanceSceneContent", () => {
    const sceneContent = makeSceneContent("governance-hero");
    const plan = makePlan([sceneContent]);
    const scene = pointerScene("governance:scene:does-not-exist", "governance:plan:demo");
    expect(() => renderGovernanceScene(scene, plan)).toThrow(/unresolved scene_id/);
  });

  it.each(ALL_SCENE_KINDS)("renders scene kind %s without throwing, wrapping it with the correct data-scene-kind attribute", (kind) => {
    const sceneContent = makeSceneContent(kind);
    const plan = makePlan([sceneContent]);
    const scene = pointerScene(sceneContent.scene_id, "governance:plan:demo");

    const html = renderGovernanceScene(scene, plan);
    expect(html).toContain(`data-scene-kind="${kind}"`);
    expect(html).toContain('class="scene-governance"');
  });

  it("renders the governance-hero scene with summary, compatibility badge, and findings count", () => {
    const sceneContent = makeSceneContent("governance-hero", { summary: "No blocking changes were detected.", compatibility: "compatible", findings_total: 3 });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("No blocking changes were detected.");
    expect(html).toContain("governance-compat-compatible");
    expect(html).toContain("3 findings");
  });

  it("renders the snapshot-comparison scene with source/target snapshot ids and the repository id when present", () => {
    const sceneContent = makeSceneContent("snapshot-comparison", {
      source_snapshot_id: "governance:snapshot:widget:v1",
      target_snapshot_id: "governance:snapshot:widget:v2",
      compatibility: "compatible_with_warnings",
      repository_id: "repo:widget-cli",
    });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("governance:snapshot:widget:v1");
    expect(html).toContain("governance:snapshot:widget:v2");
    expect(html).toContain("repo:widget-cli");
    expect(html).toContain("governance-compat-compatible_with_warnings");
  });

  it("renders the change-summary scene's by_domain counts", () => {
    const sceneContent = makeSceneContent("change-summary", { by_domain: { architecture: 2, capability: 1 }, total: 3 });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("architecture");
    expect(html).toContain("capability");
    expect(html).toContain("3 changes");
  });

  it("renders the architecture-change-map scene's by_type counts and change_ids", () => {
    const sceneContent = makeSceneContent("architecture-change-map", { total: 2, by_type: { added: 1, removed: 1 }, change_ids: ["governance:change:architecture:added:comp-a", "governance:change:architecture:removed:comp-b"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("added");
    expect(html).toContain("removed");
    expect(html).toContain("governance:change:architecture:added:comp-a");
    expect(html).toContain("governance:change:architecture:removed:comp-b");
  });

  it("renders 'No architecture changes were detected.' when architecture-change-map's by_type is empty", () => {
    const sceneContent = makeSceneContent("architecture-change-map", { total: 0, by_type: {}, change_ids: [] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("No architecture changes were detected.");
    expect(html).toContain("No architecture change ids are available.");
  });

  it("renders the capability-regression scene's change_ids without a by_type breakdown", () => {
    const sceneContent = makeSceneContent("capability-regression", { total: 1, change_ids: ["governance:change:capability:reclassified:cap-a"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("governance:change:capability:reclassified:cap-a");
    expect(html).toContain("1 item");
  });

  it("renders 'No capability regressions were detected.' when capability-regression's change_ids is empty", () => {
    const sceneContent = makeSceneContent("capability-regression", { total: 0, change_ids: [] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("No capability regressions were detected.");
  });

  it("renders the product-change and portfolio-change scenes' by_type counts and change_ids", () => {
    for (const kind of ["product-change", "portfolio-change"] as const) {
      const sceneContent = makeSceneContent(kind, { total: 1, by_type: { modified: 1 }, change_ids: [`governance:change:${kind}:modified:x`] });
      const plan = makePlan([sceneContent]);
      const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
      expect(html).toContain("modified");
      expect(html).toContain(`governance:change:${kind}:modified:x`);
    }
  });

  it("renders the evidence-regression scene's by_type counts and change_ids", () => {
    const sceneContent = makeSceneContent("evidence-regression", { total: 1, by_type: { removed: 1 }, change_ids: ["governance:evidence-change:removed:architecture:src/foo.ts"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("removed");
    expect(html).toContain("governance:evidence-change:removed:architecture:src/foo.ts");
  });

  it("renders the blast-radius scene's by_level counts", () => {
    const sceneContent = makeSceneContent("blast-radius", { total: 2, by_level: { isolated: 1, portfolio_wide: 1 } });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("isolated");
    expect(html).toContain("portfolio wide");
    expect(html).toContain("2 assessed changes");
  });

  it("renders the policy-findings scene's severity badges and by_result counts", () => {
    const sceneContent = makeSceneContent("policy-findings", {
      total: 4,
      by_severity: { blocking: 1, review_required: 1, advisory: 1, informational: 1 },
      by_result: { pass: 2, fail: 2, not_applicable: 0, unverifiable: 0, excepted: 0 },
    });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("arch-severity-blocking");
    expect(html).toContain("arch-severity-review_required");
    expect(html).toContain("arch-severity-advisory");
    expect(html).toContain("arch-severity-informational");
    expect(html).toContain("pass");
    expect(html).toContain("fail");
  });

  it("renders the exceptions scene's finding_ids", () => {
    const sceneContent = makeSceneContent("exceptions", { total: 1, finding_ids: ["governance:finding:policy-a:change-1"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("governance:finding:policy-a:change-1");
  });

  it("renders 'No active governance exceptions.' when exceptions' finding_ids is empty", () => {
    const sceneContent = makeSceneContent("exceptions", { total: 0, finding_ids: [] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("No active governance exceptions.");
  });

  it("renders the decision-required scene's finding_ids", () => {
    const sceneContent = makeSceneContent("decision-required", { total: 1, finding_ids: ["governance:finding:policy-b:change-2"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("governance:finding:policy-b:change-2");
  });

  it("renders 'No decisions are required.' when decision-required's finding_ids is empty", () => {
    const sceneContent = makeSceneContent("decision-required", { total: 0, finding_ids: [] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("No decisions are required.");
  });

  it("renders the governance-validation scene's compatibility and unverifiable finding count/ids", () => {
    const sceneContent = makeSceneContent("governance-validation", { compatibility: "partial", unverifiable_finding_count: 2, unverifiable_finding_ids: ["governance:finding:policy-c:change-3"] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).toContain("governance-compat-partial");
    expect(html).toContain("2 unverifiable findings");
    expect(html).toContain("governance:finding:policy-c:change-3");
  });

  it("HTML-escapes the scene title containing markup-significant characters on every scene kind", () => {
    const sceneContent = makeSceneContent("governance-hero", {}, { title: `<script>alert("x")</script> & 'friends'` });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;");
  });

  it("HTML-escapes change_ids rendered in a governance-change-list scene", () => {
    const sceneContent = makeSceneContent("architecture-change-map", { total: 1, by_type: { modified: 1 }, change_ids: [`<script>alert("x")</script>`] });
    const plan = makePlan([sceneContent]);
    const html = renderGovernanceScene(pointerScene(sceneContent.scene_id, "governance:plan:demo"), plan);
    expect(html).not.toContain("<script>alert(\"x\")</script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});
