import { describe, it, expect } from "vitest";
import { assessGraphCompatibility, isBuildableStatus, type LoadedArtifactInfo } from "../compatibility.js";

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
