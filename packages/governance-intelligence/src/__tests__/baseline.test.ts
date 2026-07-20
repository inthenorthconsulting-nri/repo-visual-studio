import { describe, expect, it } from "vitest";
import { setBaseline, showBaseline, validateBaseline } from "../baseline.js";
import type { GovernanceBaseline, IntelligenceSnapshot } from "../contracts.js";
import type { GovernanceConfig } from "../governance-config.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";
const ESTABLISHED_AT = "2026-07-02T00:00:00.000Z";

function snapshot(overrides: Partial<IntelligenceSnapshot> = {}): IntelligenceSnapshot {
  return {
    schema_version: 1,
    id: overrides.id ?? "governance:snapshot:repo:digest1",
    repository_id: "repo:acme",
    artifacts: [
      { artifact: "architecture", provenance: "complete", schema_version: 1, digest: "abc123", source_generated_at: GENERATED_AT },
      { artifact: "capability", provenance: "complete", schema_version: 1, digest: "def456", source_generated_at: GENERATED_AT },
      { artifact: "product", provenance: "complete", schema_version: 1, digest: "ghi789", source_generated_at: GENERATED_AT },
      { artifact: "portfolio", provenance: "complete", schema_version: 1, digest: "jkl012", source_generated_at: GENERATED_AT },
    ],
    evidence_refs: [],
    generation: { generated_at: GENERATED_AT },
    ...overrides,
  };
}

function baseline(overrides: Partial<GovernanceBaseline> = {}): GovernanceBaseline {
  return {
    schema_version: 1,
    id: "governance:baseline:governance:snapshot:repo:digest1",
    snapshot: snapshot(),
    repository_id: "repo:acme",
    established_at: ESTABLISHED_AT,
    evidence_refs: [],
    ...overrides,
  };
}

describe("showBaseline", () => {
  it("returns undefined when config is undefined", () => {
    expect(showBaseline(undefined, () => ({}))).toBeUndefined();
  });

  it("returns undefined when config has no baseline configured", () => {
    const config: GovernanceConfig = { schema_version: 1 };
    expect(showBaseline(config, () => ({}))).toBeUndefined();
  });

  it("returns undefined when the read callback returns undefined (not found)", () => {
    const config: GovernanceConfig = { schema_version: 1, baseline: { snapshot: ".rvs/cache/governance/baseline-snapshot.json" } };
    expect(showBaseline(config, () => undefined)).toBeUndefined();
  });

  it("returns undefined when the read callback throws (treated as not found)", () => {
    const config: GovernanceConfig = { schema_version: 1, baseline: { snapshot: ".rvs/cache/governance/baseline-snapshot.json" } };
    expect(
      showBaseline(config, () => {
        throw new Error("ENOENT: no such file");
      }),
    ).toBeUndefined();
  });

  it("returns the baseline the callback resolves, reading the exact configured path", () => {
    const configuredPath = ".rvs/cache/governance/baseline-snapshot.json";
    const config: GovernanceConfig = { schema_version: 1, baseline: { snapshot: configuredPath } };
    const b = baseline();
    let receivedPath: string | undefined;
    const result = showBaseline(config, (path) => {
      receivedPath = path;
      return b;
    });
    expect(receivedPath).toBe(configuredPath);
    expect(result).toEqual(b);
  });
});

describe("setBaseline", () => {
  it("establishes a first-ever baseline (no priorBaseline) with an explicit compatible/no-comparison result", () => {
    const newSnapshot = snapshot();
    const { baseline: newBaseline, compatibility } = setBaseline({ newSnapshot, establishedAt: ESTABLISHED_AT });

    expect(newBaseline.snapshot).toEqual(newSnapshot);
    expect(newBaseline.established_at).toBe(ESTABLISHED_AT);
    expect(newBaseline.schema_version).toBe(newSnapshot.schema_version);
    expect(compatibility.status).toBe("compatible");
    expect(compatibility.reasons.join(" ")).toMatch(/first baseline/i);
  });

  it("computes compatibility against the prior baseline's snapshot when one exists", () => {
    const priorBaseline = baseline();
    const newSnapshot = snapshot({ id: "governance:snapshot:repo:digest2" });
    const { compatibility } = setBaseline({ newSnapshot, priorBaseline, establishedAt: ESTABLISHED_AT });
    expect(compatibility.status).toBe("compatible");
    expect(compatibility.reasons).toEqual([]);
  });

  it("still returns (never throws) when the prior baseline is incompatible with the new snapshot", () => {
    const priorBaseline = baseline({ snapshot: snapshot({ repository_id: "repo:other" }) });
    const newSnapshot = snapshot({ repository_id: "repo:acme" });
    expect(() => setBaseline({ newSnapshot, priorBaseline, establishedAt: ESTABLISHED_AT })).not.toThrow();
    const { compatibility, baseline: newBaseline } = setBaseline({ newSnapshot, priorBaseline, establishedAt: ESTABLISHED_AT });
    expect(compatibility.status).toBe("incompatible");
    expect(compatibility.reasons.length).toBeGreaterThan(0);
    expect(newBaseline.snapshot).toEqual(newSnapshot);
  });

  it("never mutates priorBaseline", () => {
    const priorBaseline = baseline();
    const priorSnapshotBefore = JSON.stringify(priorBaseline);
    const newSnapshot = snapshot({ id: "governance:snapshot:repo:digest2" });
    setBaseline({ newSnapshot, priorBaseline, establishedAt: ESTABLISHED_AT });
    expect(JSON.stringify(priorBaseline)).toBe(priorSnapshotBefore);
  });
});

describe("validateBaseline", () => {
  it("returns compatible when both schema versions match the current version", () => {
    const result = validateBaseline(baseline(), 1);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toEqual([]);
  });

  it("names baseline.schema_version specifically when it mismatches", () => {
    const b = baseline({ schema_version: 2 });
    const result = validateBaseline(b, 1);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.some((r) => r.includes("baseline.schema_version"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("baseline.snapshot.schema_version"))).toBe(false);
  });

  it("names baseline.snapshot.schema_version specifically when it mismatches", () => {
    const b = baseline({ snapshot: snapshot({ schema_version: 2 }) });
    const result = validateBaseline(b, 1);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.some((r) => r.includes("baseline.snapshot.schema_version"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("baseline.schema_version") && !r.includes("baseline.snapshot.schema_version"))).toBe(false);
  });

  it("names both fields when both mismatch", () => {
    const b = baseline({ schema_version: 2, snapshot: snapshot({ schema_version: 3 }) });
    const result = validateBaseline(b, 1);
    expect(result.status).toBe("incompatible");
    expect(result.reasons).toHaveLength(2);
  });
});
