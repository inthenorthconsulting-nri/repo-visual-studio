import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffCapability } from "../capability-diff.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function capability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: id,
    shortDescription: `${id} short description`,
    purpose: `${id} purpose`,
    domainId: "domain:core",
    status: "operational",
    confidence: "confirmed",
    inclusion: "include",
    readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
    actors: [],
    workflows: [],
    logicalComponents: ["component:sync-service"],
    externalSystems: [],
    evidence: [{ id: `${id}:ev1`, type: "implementation", sourcePath: `src/${id}.ts`, description: "impl", strength: "strong", confidence: "confirmed" }],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: id, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

function makeCapabilityModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [capability("capintel:capability:widget-sync")],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: GENERATED_AT, assist_used: false, candidateCount: 1 },
    ...overrides,
  };
}

function snapshotFor(capabilityModel: unknown) {
  return buildIntelligenceSnapshot({ capability: capabilityModel, generatedAt: GENERATED_AT });
}

describe("diffCapability", () => {
  it("classifies operational -> partial as a status regression with review-worthy severity", () => {
    const source = makeCapabilityModel();
    const target = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:widget-sync", { status: "partial" })] });

    const result = diffCapability({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "capintel:capability:widget-sync");
    expect(entry?.type).toBe("reclassified");
    expect(entry?.detail).toContain("status regressed from \"operational\" to \"partial\"");
    expect(entry?.classification.governance_severity).not.toBe("informational");
  });

  it("classifies a wording-only shortDescription/displayName change with unchanged status and unchanged evidence as 'unchanged', never a regression (critical adversarial case)", () => {
    const source = makeCapabilityModel();
    const target = makeCapabilityModel({
      includedCapabilities: [capability("capintel:capability:widget-sync", { displayName: "Widget Sync (renamed)", shortDescription: "A totally reworded short description." })],
    });

    const result = diffCapability({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "capintel:capability:widget-sync");
    expect(entry?.type).toBe("unchanged");
    expect(entry?.classification.materiality).toBe("editorial");
  });

  it("classifies a bucket regression (includedCapabilities -> excludedCandidates) as reclassified", () => {
    const source = makeCapabilityModel();
    const excludedVersion = {
      id: "capintel:capability:widget-sync",
      displayName: "Widget Sync",
      sourceLabel: "widget-sync",
      granularity: "capability",
      status: "operational",
      confidence: "confirmed",
      readiness: capability("x").readiness,
      reasonCodes: ["insufficient_evidence"],
      reasonSummary: "Evidence was retracted.",
      evidence: [],
    };
    const target = makeCapabilityModel({ includedCapabilities: [], excludedCandidates: [excludedVersion] });

    const result = diffCapability({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "capintel:capability:widget-sync");
    expect(entry?.type).toBe("reclassified");
    expect(entry?.detail).toContain("inclusion regressed");
  });

  it("detects evidence gain/loss as its own 'modified' change type when status/bucket are unchanged", () => {
    const source = makeCapabilityModel();
    const target = makeCapabilityModel({
      includedCapabilities: [
        capability("capintel:capability:widget-sync", { evidence: [{ id: "ev1", type: "implementation", sourcePath: "src/widget-sync.ts", description: "impl", strength: "strong", confidence: "confirmed" }, { id: "ev2", type: "test", sourcePath: "test/widget-sync.test.ts", description: "test", strength: "strong", confidence: "confirmed" }] }),
      ],
    });

    const result = diffCapability({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const entry = result.changes.find((c) => c.entity_id === "capintel:capability:widget-sync");
    expect(entry?.type).toBe("modified");
    expect(entry?.detail).toContain("evidence increased");
  });

  it("detects a capability added and a capability removed", () => {
    const source = makeCapabilityModel();
    const target = makeCapabilityModel({ includedCapabilities: [...source.includedCapabilities, capability("capintel:capability:notifications")] });

    const result = diffCapability({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });
    expect(result.changes.find((c) => c.entity_id === "capintel:capability:notifications")?.type).toBe("added");

    const removedResult = diffCapability({ sourceSnapshot: snapshotFor(target), targetSnapshot: snapshotFor(source), sourceArtifact: target, targetArtifact: source });
    expect(removedResult.changes.find((c) => c.entity_id === "capintel:capability:notifications")?.type).toBe("removed");
  });

  it("is fully deterministic across repeated runs", () => {
    const source = makeCapabilityModel();
    const target = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:widget-sync", { status: "partial" })] });
    const sourceSnapshot = snapshotFor(source);
    const targetSnapshot = snapshotFor(target);

    const first = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const second = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
