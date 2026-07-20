import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";
import { diffCapability } from "../capability-diff.js";
import { diffProduct } from "../product-diff.js";
import { diffEvidence } from "../evidence-diff.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] },
    ...overrides,
  };
}

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: [component("component:sync-service")],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: [],
    questions: [],
    workflowFamilies: [],
    metadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: GENERATED_AT, workflow_graph_count: 0, terraform_topology_count: 0, assist_used: false },
    ...overrides,
  };
}

function makeCapabilityModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: GENERATED_AT, assist_used: false, candidateCount: 0 },
    ...overrides,
  };
}

function makeProductModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    identity: { displayName: "Acme Widget", archetype: "workflow-automation-platform", purpose: "p", descriptor: "d", shortPromise: "s", primaryUsers: [], secondaryUsers: [], secondaryArchetypes: [], valuePillars: [], differentiators: [], evidence: [] },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 0 },
    ...overrides,
  };
}

describe("diffEvidence", () => {
  it("surfaces a broken-lineage architecture entry (component removed) as a 'removed' evidence change", () => {
    const sourceArch = makeArchitecture();
    const targetArch = makeArchitecture({ components: [] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const removedComponentChange = architectureChanges.changes.find((c) => c.entity_id === "component:sync-service");
    expect(removedComponentChange?.lineage).toBe("broken");

    const evidenceChanges = diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges });

    const removedEvidence = evidenceChanges.changes.find((c) => c.related_entity_id === "component:sync-service");
    expect(removedEvidence?.type).toBe("removed");
    expect(removedEvidence?.detail).toContain("lineage broken");
  });

  it("does not surface any evidence change for entities with no change at all", () => {
    const arch = makeArchitecture();
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: arch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: arch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: arch, targetArtifact: arch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const evidenceChanges = diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges });
    expect(evidenceChanges.changes).toEqual([]);
  });

  it("works without portfolioChanges supplied (optional input)", () => {
    const sourceArch = makeArchitecture();
    const targetArch = makeArchitecture({ components: [] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    expect(() => diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges })).not.toThrow();
  });

  it("is fully deterministic across repeated runs", () => {
    const sourceArch = makeArchitecture();
    const targetArch = makeArchitecture({ components: [] });
    const sourceSnapshot = buildIntelligenceSnapshot({ architecture: sourceArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ architecture: targetArch, capability: makeCapabilityModel(), product: makeProductModel(), generatedAt: GENERATED_AT });

    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArch, targetArtifact: targetArch });
    const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: makeCapabilityModel(), targetArtifact: makeCapabilityModel() });
    const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: makeProductModel(), targetArtifact: makeProductModel() });

    const first = diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges });
    const second = diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges });
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
