import { describe, it, expect } from "vitest";
import {
  assessGraphCompatibility,
  assessSnapshotPairCompatibility,
  isBuildableStatus,
  isComparableStatus,
  uncomparableDomains,
  type LoadedArtifactInfo,
} from "../compatibility.js";
import type { GraphSnapshot, UpstreamArtifactDigest, UpstreamSourceArtifact } from "../contracts.js";

function artifact(overrides: Partial<LoadedArtifactInfo> & Pick<LoadedArtifactInfo, "source_artifact">): LoadedArtifactInfo {
  return { present: true, repository_id: "repo-1", schema_version: 1, source_generated_at: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("assessGraphCompatibility", () => {
  it("stage 1: returns incompatible when no artifact is present", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture", present: false }),
      artifact({ source_artifact: "capability", present: false }),
    ]);
    expect(result.status).toBe("incompatible");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("stage 2: returns incompatible when present artifacts disagree on repository identity", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture", repository_id: "repo-a" }),
      artifact({ source_artifact: "capability", repository_id: "repo-b" }),
    ]);
    expect(result.status).toBe("incompatible");
    expect(result.reasons[0]).toContain("repo-a");
    expect(result.reasons[0]).toContain("repo-b");
  });

  it("stage 3: returns incompatible when a present artifact's schema_version is unsupported", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture", schema_version: 99 }),
    ]);
    expect(result.status).toBe("incompatible");
    expect(result.reasons[0]).toContain("architecture");
    expect(result.reasons[0]).toContain("99");
  });

  it("stage 4: returns partial when one or more artifacts are absent (after passing earlier stages)", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture" }),
      artifact({ source_artifact: "capability", present: false }),
    ]);
    expect(result.status).toBe("partial");
    expect(result.reasons[0]).toContain("capability");
  });

  it("stage 5: returns compatible_with_warnings when all present but generated_at values disagree", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture", source_generated_at: "2026-01-01T00:00:00.000Z" }),
      artifact({ source_artifact: "capability", source_generated_at: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(result.status).toBe("compatible_with_warnings");
    expect(result.reasons.length).toBe(1);
  });

  it("stage 6: returns compatible when everything present, consistent, and time-aligned", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture" }),
      artifact({ source_artifact: "capability" }),
    ]);
    expect(result).toEqual({ status: "compatible", reasons: [] });
  });

  it("short-circuits: missing artifact takes precedence over a would-be repository disagreement among present ones being absent", () => {
    // Only one artifact present and it's internally consistent, but another is absent -> partial, not incompatible.
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture" }),
      artifact({ source_artifact: "capability", present: false }),
      artifact({ source_artifact: "product", present: false }),
    ]);
    expect(result.status).toBe("partial");
  });

  it("ignores repository_id/schema_version/source_generated_at on absent artifacts", () => {
    const result = assessGraphCompatibility([
      artifact({ source_artifact: "architecture" }),
      artifact({ source_artifact: "capability", present: false, repository_id: "totally-different-repo", schema_version: 999 }),
    ]);
    expect(result.status).toBe("partial");
  });
});

describe("isBuildableStatus", () => {
  it("returns false only for incompatible", () => {
    expect(isBuildableStatus("incompatible")).toBe(false);
    expect(isBuildableStatus("partial")).toBe(true);
    expect(isBuildableStatus("compatible_with_warnings")).toBe(true);
    expect(isBuildableStatus("compatible")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comparing two snapshots is a different question from building one graph, and
// the answer gates a whole command: `rvs graph review` refuses to draw a
// difference between two states that cannot be compared. So each stage of the
// staged short-circuit is pinned here, including the one that matters most in
// practice -- that a pair of snapshots RVS can actually produce is comparable.
// ---------------------------------------------------------------------------
describe("assessSnapshotPairCompatibility", () => {
  const snapshot = (over: Partial<GraphSnapshot> = {}): GraphSnapshot => ({
    id: "graph:snapshot:repo-1:x",
    schema_version: 1,
    repository_id: "repo-1",
    upstream_artifacts: [
      { source_artifact: "architecture", provenance: "partial" },
      { source_artifact: "capability", provenance: "partial" },
    ],
    node_count: 2,
    edge_count: 1,
    digest: "abc",
    ...over,
  });

  const domains = (
    entries: Array<[UpstreamSourceArtifact, "complete" | "partial" | "unavailable"]>,
  ): UpstreamArtifactDigest[] => entries.map(([source_artifact, provenance]) => ({ source_artifact, provenance }));

  it("stage 1: refuses two different repositories, which are not two states of one thing", () => {
    const result = assessSnapshotPairCompatibility(snapshot(), snapshot({ repository_id: "repo-2" }));
    expect(result.status).toBe("incompatible");
    expect(result.reasons.join(" ")).toContain("Repository identity mismatch");
  });

  it("stage 2: refuses a schema_version disagreement, whose differences are not architectural", () => {
    const result = assessSnapshotPairCompatibility(snapshot(), snapshot({ schema_version: 2 }));
    expect(result.status).toBe("incompatible");
    expect(result.reasons.join(" ")).toContain("schema_version mismatch");
  });

  it("stage 3: refuses a pair with no domain read on both sides", () => {
    const result = assessSnapshotPairCompatibility(
      snapshot({ upstream_artifacts: domains([["architecture", "complete"], ["capability", "unavailable"]]) }),
      snapshot({ upstream_artifacts: domains([["architecture", "unavailable"], ["capability", "complete"]]) }),
    );
    expect(result.status).toBe("incompatible");
    expect(result.reasons.join(" ")).toContain("nothing to compare");
  });

  it("stage 4: calls a one-sided domain partial, and names which side is silent", () => {
    const result = assessSnapshotPairCompatibility(
      snapshot({ upstream_artifacts: domains([["architecture", "partial"], ["governance", "complete"]]) }),
      snapshot({ upstream_artifacts: domains([["architecture", "partial"], ["governance", "unavailable"]]) }),
    );
    expect(result.status).toBe("partial");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("governance was read in the source snapshot but not in the target snapshot");
    expect(result.reasons[0]).toContain("either way");
  });

  it("stage 5: calls a pair with the same domains on both sides compatible", () => {
    expect(assessSnapshotPairCompatibility(snapshot(), snapshot()).status).toBe("compatible");
  });

  it("compares snapshots whose domains were read but not version-pinned", () => {
    // This is the case every snapshot `rvs graph build` writes falls into:
    // it records no upstream snapshot ids, so no domain is ever "complete".
    // Requiring complete provenance here would refuse every pair RVS can
    // produce, which is not a safety property -- it is an outage.
    const built = snapshot({
      upstream_artifacts: domains([
        ["architecture", "partial"],
        ["capability", "partial"],
        ["product", "partial"],
        ["decision", "unavailable"],
        ["governance", "unavailable"],
        ["portfolio", "unavailable"],
      ]),
    });
    const result = assessSnapshotPairCompatibility(built, built);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toEqual([]);
  });

  it("is symmetric in status, whichever snapshot is called the baseline", () => {
    const a = snapshot({ upstream_artifacts: domains([["architecture", "partial"], ["governance", "partial"]]) });
    const b = snapshot({ upstream_artifacts: domains([["architecture", "partial"], ["governance", "unavailable"]]) });
    expect(assessSnapshotPairCompatibility(a, b).status).toBe(assessSnapshotPairCompatibility(b, a).status);
  });
});

describe("uncomparableDomains", () => {
  const withDomains = (
    entries: Array<[UpstreamSourceArtifact, "complete" | "partial" | "unavailable"]>,
  ): GraphSnapshot => ({
    id: "graph:snapshot:repo-1:x",
    schema_version: 1,
    repository_id: "repo-1",
    upstream_artifacts: entries.map(([source_artifact, provenance]) => ({ source_artifact, provenance })),
    node_count: 0,
    edge_count: 0,
    digest: "abc",
  });

  it("names a domain nobody read on either side, because that is not 'no change'", () => {
    const both = withDomains([["architecture", "partial"], ["governance", "unavailable"]]);
    expect(uncomparableDomains(both, both)).toEqual(["governance"]);
  });

  it("names a domain read on one side only", () => {
    expect(
      uncomparableDomains(
        withDomains([["architecture", "partial"], ["decision", "partial"]]),
        withDomains([["architecture", "partial"], ["decision", "unavailable"]]),
      ),
    ).toEqual(["decision"]);
  });

  it("stays silent about a domain read on both sides, pinned or not", () => {
    expect(
      uncomparableDomains(
        withDomains([["architecture", "complete"], ["capability", "partial"]]),
        withDomains([["architecture", "partial"], ["capability", "complete"]]),
      ),
    ).toEqual([]);
  });

  it("returns a sorted list, so two runs read identically", () => {
    const source = withDomains([["portfolio", "unavailable"], ["architecture", "partial"], ["decision", "unavailable"]]);
    expect(uncomparableDomains(source, source)).toEqual(["decision", "portfolio"]);
  });
});

describe("isComparableStatus", () => {
  it("lets a partial comparison through and stops an incompatible one", () => {
    // Partial is allowed on purpose: the review's job is then to say which
    // domains it cannot speak about, not to refuse the whole comparison.
    expect(isComparableStatus("incompatible")).toBe(false);
    expect(isComparableStatus("partial")).toBe(true);
    expect(isComparableStatus("compatible_with_warnings")).toBe(true);
    expect(isComparableStatus("compatible")).toBe(true);
  });
});
