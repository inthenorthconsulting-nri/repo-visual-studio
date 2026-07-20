import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffProduct } from "../product-diff.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function evidenceItem(id: string, overrides: Record<string, unknown> = {}) {
  return { id, sourceType: "repository_evidence", sourcePath: `src/${id}.ts`, text: `Evidence for ${id}`, confidence: "confirmed", strength: 3, ...overrides };
}

function makeProductModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    identity: {
      displayName: "Acme Widget",
      archetype: "workflow-automation-platform",
      purpose: "Keeps widget inventories synchronized across warehouses.",
      descriptor: "A widget synchronization platform.",
      shortPromise: "Never lose track of a widget again.",
      primaryUsers: ["Warehouse Operators"],
      secondaryUsers: ["Finance Analysts"],
      secondaryArchetypes: [],
      valuePillars: [{ id: "pillar:reliability", title: "Reliability", evidenceIds: ["ev1"] }],
      differentiators: [{ id: "diff:realtime", title: "Real-time sync", evidenceIds: ["ev1"] }],
      evidence: [evidenceItem("ev1")],
    },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 1 },
    ...overrides,
  };
}

function snapshotFor(product: unknown) {
  return buildIntelligenceSnapshot({ product, generatedAt: GENERATED_AT });
}

describe("diffProduct", () => {
  it("classifies a wording-only purpose text change with unchanged evidence as editorial, never material (critical adversarial case)", () => {
    const source = makeProductModel();
    const target = makeProductModel({ identity: { ...source.identity, purpose: "Keeps widget stock levels synchronized across every warehouse we operate." } });

    const result = diffProduct({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "identity:purpose");
    expect(entry?.type).toBe("modified");
    expect(entry?.classification.materiality).toBe("editorial");
    expect(entry?.detail).toContain("wording-only");
  });

  it("classifies a purpose text change accompanied by a changed evidence array as material or qualified, never editorial", () => {
    const source = makeProductModel();
    const target = makeProductModel({
      identity: { ...source.identity, purpose: "New purpose statement.", evidence: [evidenceItem("ev1"), evidenceItem("ev2")] },
    });

    const result = diffProduct({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "identity:purpose");
    expect(entry?.type).toBe("modified");
    expect(["material", "qualified"]).toContain(entry?.classification.materiality);
    expect(entry?.classification.materiality).not.toBe("editorial");
  });

  it("classifies an archetype (categorical) change as never-editorial even when evidence is unchanged", () => {
    const source = makeProductModel();
    const target = makeProductModel({ identity: { ...source.identity, archetype: "data-platform" } });

    const result = diffProduct({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "identity:archetype");
    expect(entry?.type).toBe("modified");
    expect(entry?.classification.materiality).not.toBe("editorial");
  });

  it("detects primaryUsers string-set additions and removals", () => {
    const source = makeProductModel();
    const target = makeProductModel({ identity: { ...source.identity, primaryUsers: ["Finance Analysts"] } });

    const result = diffProduct({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    expect(result.changes.find((c) => c.domain_path === "identity.primaryUsers" && c.type === "added")?.entity_label).toBe("Finance Analysts");
    expect(result.changes.find((c) => c.domain_path === "identity.primaryUsers" && c.type === "removed")?.entity_label).toBe("Warehouse Operators");
  });

  it("detects a valuePillar added and removed by stable id", () => {
    const source = makeProductModel();
    const target = makeProductModel({
      identity: { ...source.identity, valuePillars: [{ id: "pillar:speed", title: "Speed", evidenceIds: ["ev1"] }] },
    });

    const result = diffProduct({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    expect(result.changes.find((c) => c.entity_id === "pillar:speed")?.type).toBe("added");
    expect(result.changes.find((c) => c.entity_id === "pillar:reliability")?.type).toBe("removed");
  });

  it("is fully deterministic across repeated runs", () => {
    const source = makeProductModel();
    const target = makeProductModel({ identity: { ...source.identity, purpose: "New purpose statement." } });
    const sourceSnapshot = snapshotFor(source);
    const targetSnapshot = snapshotFor(target);

    const first = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const second = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
