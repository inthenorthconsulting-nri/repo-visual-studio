import { describe, expect, it } from "vitest";
import { assessSnapshotCompatibility } from "../compatibility.js";
import { buildIntelligenceSnapshot } from "../snapshot.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";
const LATER_GENERATED_AT = "2026-07-08T00:00:00.000Z";

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: { displayLabel: "Acme Widget", sourceLabel: "acme-widget", shortLabel: "Widget" } },
    components: [{ id: "component:sync-service", name: "Sync Service" }],
    metadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: GENERATED_AT, workflow_graph_count: 1, terraform_topology_count: 0, assist_used: false },
    ...overrides,
  };
}

function makeCapability(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [{ id: "capintel:capability:widget-sync", displayName: "Widget Sync" }],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: GENERATED_AT, assist_used: false, candidateCount: 1 },
    ...overrides,
  };
}

function makePortfolio(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Portfolio",
    generationMetadata: { generated_at: GENERATED_AT, schema_version: 1, productCount: 1, incompatibleProductCount: 0, allowPartialPortfolio: false },
    ...overrides,
  };
}

describe("assessSnapshotCompatibility", () => {
  it("returns compatible when both snapshots agree on every domain's schema version and identity", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), capability: makeCapability(), portfolio: makePortfolio(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({
      architecture: makeArchitecture({ components: [{ id: "component:sync-service", name: "Sync Service v2" }], metadata: { ...makeArchitecture().metadata, generated_at: LATER_GENERATED_AT } }),
      capability: makeCapability({ generationMetadata: { ...makeCapability().generationMetadata, generated_at: LATER_GENERATED_AT } }),
      portfolio: makePortfolio({ generationMetadata: { ...makePortfolio().generationMetadata, generated_at: LATER_GENERATED_AT } }),
      generatedAt: LATER_GENERATED_AT,
    });

    const result = assessSnapshotCompatibility(source, target);
    expect(result).toEqual({ status: "compatible", reasons: [] });
  });

  it("returns incompatible when a shared domain's schema_version disagrees between snapshots", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), capability: makeCapability(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({
      architecture: makeArchitecture(),
      capability: makeCapability({ schemaVersion: 2, generationMetadata: { ...makeCapability().generationMetadata, schema_version: 2 } }),
      generatedAt: GENERATED_AT,
    });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.some((r) => r.includes("capability schema_version mismatch"))).toBe(true);
  });

  it("returns incompatible when repository identity disagrees between snapshots", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({ architecture: makeArchitecture({ identity: { ...makeArchitecture().identity, id: "repo:other-widget" } }), generatedAt: GENERATED_AT });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.some((r) => r.includes("repository identity mismatch"))).toBe(true);
  });

  it("returns incompatible when portfolio identity disagrees between snapshots", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), portfolio: makePortfolio(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({ architecture: makeArchitecture(), portfolio: makePortfolio({ portfolioId: "portfolio:other" }), generatedAt: GENERATED_AT });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.some((r) => r.includes("portfolio identity mismatch"))).toBe(true);
  });

  it("returns incompatible when no domain has complete provenance in both snapshots", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({ capability: makeCapability(), generatedAt: GENERATED_AT });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons[0]).toContain("nothing governance can compare");
  });

  it("returns partial when some but not all domains are present with complete provenance in both snapshots", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture(), capability: makeCapability(), generatedAt: GENERATED_AT });
    const target = buildIntelligenceSnapshot({ architecture: makeArchitecture(), generatedAt: GENERATED_AT });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("partial");
    expect(result.reasons.some((r) => r.includes("capability is present in the source snapshot but not in the target snapshot"))).toBe(true);
  });

  it("returns compatible_with_warnings when the target snapshot's domain generated_at precedes the source snapshot's", () => {
    const source = buildIntelligenceSnapshot({ architecture: makeArchitecture({ metadata: { ...makeArchitecture().metadata, generated_at: LATER_GENERATED_AT } }), generatedAt: LATER_GENERATED_AT });
    const target = buildIntelligenceSnapshot({ architecture: makeArchitecture({ metadata: { ...makeArchitecture().metadata, generated_at: GENERATED_AT } }), generatedAt: GENERATED_AT });

    const result = assessSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible_with_warnings");
    expect(result.reasons.some((r) => r.includes("comparison direction may be reversed"))).toBe(true);
  });
});
