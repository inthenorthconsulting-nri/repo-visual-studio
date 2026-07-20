import { describe, expect, it } from "vitest";
import { explainGovernanceId } from "../explain.js";
import { buildGovernancePlan } from "../governance-plan.js";
import { buildGovernanceNarrative } from "../narrative.js";
import { architectureChangeSet, blastRadiusAssessment, blastRadiusEntry, changeEntry, evaluation, evidenceChangeEntry, evidenceChangeSet, finding, report } from "./governance-fixtures.js";
import type { GovernanceBaseline } from "../contracts.js";

const GENERATED_AT = "2026-07-14T00:00:00.000Z";

describe("explainGovernanceId: change id space (4+1 change sets)", () => {
  it("resolves an architecture change id", () => {
    const entry = changeEntry({ entity_id: "component:api", type: "removed" });
    const r = report({ architecture_changes: architectureChangeSet([entry]) });
    const result = explainGovernanceId(entry.id, { report: r });
    expect(result.explanation).toContain("component:api");
    expect(result.resolved).toEqual(entry);
  });

  it("resolves an evidence change id", () => {
    const ec = evidenceChangeEntry({ type: "removed" });
    const r = report({ evidence_changes: evidenceChangeSet([ec]) });
    const result = explainGovernanceId(ec.id, { report: r });
    expect(result.explanation).toContain(ec.id);
    expect(result.resolved).toEqual(ec);
  });
});

describe("explainGovernanceId: finding id space", () => {
  it("resolves a finding id", () => {
    const f = finding({ result: "fail", severity: "blocking", statement: "Component removed without exception." });
    const r = report({ findings: [f] });
    const result = explainGovernanceId(f.id, { report: r });
    expect(result.explanation).toContain("Component removed without exception.");
    expect(result.resolved).toEqual(f);
  });
});

describe("explainGovernanceId: policy-evaluation id space", () => {
  it("resolves an evaluation id", () => {
    const evalArtifact = evaluation({ id: "governance:evaluation:test-policy:source:target", findings: [] });
    const r = report({ evaluations: [evalArtifact] });
    const result = explainGovernanceId(evalArtifact.id, { report: r });
    expect(result.explanation).toContain(evalArtifact.policy_id);
    expect(result.resolved).toEqual(evalArtifact);
  });
});

describe("explainGovernanceId: blast-radius entry id space", () => {
  it("resolves a blast-radius entry id", () => {
    const bre = blastRadiusEntry({ level: "cross_component", rationale: "Touches two services." });
    const r = report({ blast_radius: blastRadiusAssessment([bre]) });
    const result = explainGovernanceId(bre.id, { report: r });
    expect(result.explanation).toContain("cross_component");
    expect(result.explanation).toContain("Touches two services.");
    expect(result.resolved).toEqual(bre);
  });
});

describe("explainGovernanceId: snapshot id space", () => {
  it("resolves the source snapshot id", () => {
    const r = report({ source_snapshot_id: "snap-source", target_snapshot_id: "snap-target" });
    const result = explainGovernanceId("snap-source", { report: r });
    expect(result.explanation).toContain("source");
    expect(result.explanation).toContain("snap-source");
  });

  it("resolves the target snapshot id", () => {
    const r = report({ source_snapshot_id: "snap-source", target_snapshot_id: "snap-target" });
    const result = explainGovernanceId("snap-target", { report: r });
    expect(result.explanation).toContain("target");
  });

  it("resolves a baseline's snapshot id via context.baseline", () => {
    const baseline: GovernanceBaseline = {
      schema_version: 1,
      id: "governance:baseline:snap-1",
      snapshot: { schema_version: 1, id: "snap-1", artifacts: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      established_at: GENERATED_AT,
      evidence_refs: [],
    };
    const result = explainGovernanceId("snap-1", { baseline });
    expect(result.explanation).toContain("baseline");
    expect(result.resolved).toEqual(baseline);
  });
});

describe("explainGovernanceId: narrative/plan id space", () => {
  it("resolves a narrative id via context.plan", () => {
    const r = report();
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const plan = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    const result = explainGovernanceId(narrative.id, { plan });
    expect(result.explanation).toContain(narrative.summary);
    expect(result.resolved).toEqual(narrative);
  });

  it("resolves a plan id via context.plan", () => {
    const r = report();
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const plan = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    const result = explainGovernanceId(plan.id, { plan });
    expect(result.resolved).toEqual(plan);
  });

  it("resolves a scene id via context.plan", () => {
    const r = report();
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const plan = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    const heroScene = plan.scenes.find((scene) => scene.kind === "governance-hero")!;
    const result = explainGovernanceId(heroScene.scene_id, { plan });
    expect(result.explanation).toContain("governance-hero");
    expect(result.resolved).toEqual(heroScene);
  });
});

describe("explainGovernanceId: unresolvable id", () => {
  it("throws a plain Error with an actionable message when nothing matches", () => {
    const r = report();
    expect(() => explainGovernanceId("totally-unknown-id", { report: r })).toThrow(/rvs governance compare/);
  });

  it("throws when context is entirely empty", () => {
    expect(() => explainGovernanceId("anything", {})).toThrow(Error);
  });
});
