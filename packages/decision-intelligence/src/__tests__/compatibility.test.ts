import { describe, expect, it } from "vitest";
import { assessDecisionSnapshotCompatibility } from "../compatibility.js";
import { decisionSnapshot, GENERATED_AT } from "./decision-fixtures.js";

describe("assessDecisionSnapshotCompatibility: never a bare boolean", () => {
  it("always returns an object with a status string and a reasons string array", () => {
    const result = assessDecisionSnapshotCompatibility(decisionSnapshot(), decisionSnapshot());
    expect(typeof result).toBe("object");
    expect(typeof result.status).toBe("string");
    expect(Array.isArray(result.reasons)).toBe(true);
  });
});

describe("assessDecisionSnapshotCompatibility: stage 1 - schema_version mismatch", () => {
  it("returns 'incompatible' when schema_version disagrees", () => {
    const source = decisionSnapshot({ schema_version: 1 });
    const target = decisionSnapshot({ schema_version: 1 });
    (target as { schema_version: number }).schema_version = 2;
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("schema_version mismatch");
  });

  it("short-circuits before checking repository identity: a schema_version mismatch reason is reported even when repository_id also mismatches", () => {
    const source = decisionSnapshot({ repository_id: "repo-a" });
    const target = decisionSnapshot({ repository_id: "repo-b" });
    (target as { schema_version: number }).schema_version = 2;
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons[0]).toContain("schema_version mismatch");
    expect(result.reasons.join(" ")).not.toContain("repository identity mismatch");
  });
});

describe("assessDecisionSnapshotCompatibility: stage 2 - repository identity mismatch", () => {
  it("returns 'incompatible' when repository_id disagrees and schema_version matches", () => {
    const source = decisionSnapshot({ repository_id: "repo-a" });
    const target = decisionSnapshot({ repository_id: "repo-b" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("repository identity mismatch");
    expect(result.reasons[0]).toContain("repo-a");
    expect(result.reasons[0]).toContain("repo-b");
  });
});

describe("assessDecisionSnapshotCompatibility: upstream artifact context reasons", () => {
  it("reports 'unavailable' for the source snapshot only", () => {
    const source = decisionSnapshot({ compatibility: "unavailable" });
    const target = decisionSnapshot({ compatibility: "complete" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('"unavailable"');
    expect(result.reasons[0]).toContain("the source snapshot");
  });

  it("reports 'unavailable' for the target snapshot only", () => {
    const source = decisionSnapshot({ compatibility: "complete" });
    const target = decisionSnapshot({ compatibility: "unavailable" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons[0]).toContain("the target snapshot");
  });

  it("reports 'unavailable' for both snapshots when both are unavailable", () => {
    const source = decisionSnapshot({ compatibility: "unavailable" });
    const target = decisionSnapshot({ compatibility: "unavailable" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons[0]).toContain("both snapshots");
  });

  it("reports 'partial' for whichever snapshot is partial when neither is unavailable", () => {
    const source = decisionSnapshot({ compatibility: "partial" });
    const target = decisionSnapshot({ compatibility: "complete" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('"partial"');
    expect(result.reasons[0]).toContain("the source snapshot");
  });

  it("does not also report a 'partial' reason when one snapshot is 'unavailable' and the other is 'partial' (mutually exclusive branches)", () => {
    const source = decisionSnapshot({ compatibility: "unavailable" });
    const target = decisionSnapshot({ compatibility: "partial" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('"unavailable"');
    expect(result.reasons.join(" ")).not.toContain('"partial"');
  });

  it("reports no upstream-context reason when both snapshots are 'complete'", () => {
    const source = decisionSnapshot({ compatibility: "complete" });
    const target = decisionSnapshot({ compatibility: "complete" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons).toEqual([]);
  });
});

describe("assessDecisionSnapshotCompatibility: staleness", () => {
  it("reports a staleness reason when target.generated_at precedes source.generated_at", () => {
    const source = decisionSnapshot({ generated_at: "2026-06-01T00:00:00.000Z" });
    const target = decisionSnapshot({ generated_at: "2026-01-01T00:00:00.000Z" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons.some((r) => r.includes("precedes"))).toBe(true);
  });

  it("does not report staleness when target.generated_at equals source.generated_at", () => {
    const source = decisionSnapshot({ generated_at: GENERATED_AT });
    const target = decisionSnapshot({ generated_at: GENERATED_AT });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons).toEqual([]);
  });

  it("does not report staleness when target.generated_at is after source.generated_at", () => {
    const source = decisionSnapshot({ generated_at: "2026-01-01T00:00:00.000Z" });
    const target = decisionSnapshot({ generated_at: "2026-06-01T00:00:00.000Z" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.reasons).toEqual([]);
  });

  it("accumulates both a partial-coverage reason and a staleness reason together (not mutually exclusive with staleness)", () => {
    const source = decisionSnapshot({ compatibility: "partial", generated_at: "2026-06-01T00:00:00.000Z" });
    const target = decisionSnapshot({ compatibility: "complete", generated_at: "2026-01-01T00:00:00.000Z" });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toHaveLength(2);
  });
});

describe("assessDecisionSnapshotCompatibility: fully clean comparison", () => {
  it("returns 'compatible' with an empty reasons array when everything matches", () => {
    const source = decisionSnapshot({ repository_id: "repo-x", compatibility: "complete", generated_at: GENERATED_AT });
    const target = decisionSnapshot({ repository_id: "repo-x", compatibility: "complete", generated_at: GENERATED_AT });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons).toEqual([]);
  });

  it("covers both DecisionSnapshotCompatibility.status values by name across the suite: 'incompatible' and 'compatible'", () => {
    const incompatible = assessDecisionSnapshotCompatibility(decisionSnapshot({ repository_id: "a" }), decisionSnapshot({ repository_id: "b" }));
    const compatible = assessDecisionSnapshotCompatibility(decisionSnapshot(), decisionSnapshot());
    expect(incompatible.status).toBe("incompatible");
    expect(compatible.status).toBe("compatible");
  });
});
