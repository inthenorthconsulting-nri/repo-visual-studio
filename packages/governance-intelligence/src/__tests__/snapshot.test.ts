import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: { displayLabel: "Acme Widget", sourceLabel: "acme-widget", shortLabel: "Widget" } },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] } },
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

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    identity: { displayName: "Acme Widget", descriptor: "A widget synchronization platform." },
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 1 },
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

/** Deep-clones a JSON-safe value while rebuilding every plain object with its keys inserted in reverse order, so any key-order sensitivity in the code under test would surface as a digest mismatch. */
function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const reversedKeys = Object.keys(record).reverse();
    const shuffled: Record<string, unknown> = {};
    for (const key of reversedKeys) {
      shuffled[key] = shuffleKeys(record[key]);
    }
    return shuffled;
  }
  return value;
}

describe("buildIntelligenceSnapshot", () => {
  it("produces an identical id and artifact digests across two syntheses of the same input, even with different generatedAt timestamps", () => {
    const input = { architecture: makeArchitecture(), capability: makeCapability(), product: makeProduct(), portfolio: makePortfolio() };
    const first = buildIntelligenceSnapshot({ ...input, generatedAt: GENERATED_AT });
    const second = buildIntelligenceSnapshot({ ...input, generatedAt: "2026-08-15T12:30:00.000Z" });

    expect(first.id).toBe(second.id);
    expect(JSON.stringify(first.artifacts)).toBe(JSON.stringify(second.artifacts));
    expect(first.generation.generated_at).not.toBe(second.generation.generated_at);
  });

  it("produces an identical digest when an input artifact's object keys are shuffled (key-order independence)", () => {
    const architecture = makeArchitecture();
    const capability = makeCapability();
    const shuffledArchitecture = shuffleKeys(architecture);
    const shuffledCapability = shuffleKeys(capability);

    const original = buildIntelligenceSnapshot({ architecture, capability, generatedAt: GENERATED_AT });
    const shuffled = buildIntelligenceSnapshot({ architecture: shuffledArchitecture, capability: shuffledCapability, generatedAt: GENERATED_AT });

    expect(shuffled.id).toBe(original.id);
    expect(JSON.stringify(shuffled.artifacts)).toBe(JSON.stringify(original.artifacts));
  });

  it("marks an omitted artifact as unavailable and still produces a deterministic snapshot from the artifacts that are present", () => {
    const snapshot = buildIntelligenceSnapshot({ architecture: makeArchitecture(), capability: makeCapability(), generatedAt: GENERATED_AT });

    const byDomain = new Map(snapshot.artifacts.map((a) => [a.artifact, a]));
    expect(byDomain.get("architecture")?.provenance).toBe("complete");
    expect(byDomain.get("capability")?.provenance).toBe("complete");
    expect(byDomain.get("product")?.provenance).toBe("unavailable");
    expect(byDomain.get("portfolio")?.provenance).toBe("unavailable");
    expect(byDomain.get("product")?.digest).toBeUndefined();
    expect(byDomain.get("portfolio")?.digest).toBeUndefined();
  });

  it("marks a present-but-malformed artifact as partial rather than complete", () => {
    const snapshot = buildIntelligenceSnapshot({ architecture: makeArchitecture(), capability: "not-an-object" as unknown, generatedAt: GENERATED_AT });

    const byDomain = new Map(snapshot.artifacts.map((a) => [a.artifact, a]));
    expect(byDomain.get("capability")?.provenance).toBe("partial");
    expect(byDomain.get("capability")?.digest).toBeUndefined();
  });

  it("derives repository_id/repository_name from the architecture artifact's identity, and portfolio_id/portfolio_name from the portfolio artifact", () => {
    const snapshot = buildIntelligenceSnapshot({ architecture: makeArchitecture(), portfolio: makePortfolio(), generatedAt: GENERATED_AT });

    expect(snapshot.repository_id).toBe("repo:acme-widget");
    expect(snapshot.repository_name).toBe("Acme Widget");
    expect(snapshot.portfolio_id).toBe("portfolio:acme");
    expect(snapshot.portfolio_name).toBe("Acme Portfolio");
  });

  it("produces different digests when artifact content actually differs", () => {
    const first = buildIntelligenceSnapshot({ architecture: makeArchitecture(), generatedAt: GENERATED_AT });
    const second = buildIntelligenceSnapshot({ architecture: makeArchitecture({ components: [{ id: "component:sync-service", name: "Renamed Sync Service" }] }), generatedAt: GENERATED_AT });

    expect(first.id).not.toBe(second.id);
    const firstDigest = first.artifacts.find((a) => a.artifact === "architecture")?.digest;
    const secondDigest = second.artifacts.find((a) => a.artifact === "architecture")?.digest;
    expect(firstDigest).not.toBe(secondDigest);
  });
});
