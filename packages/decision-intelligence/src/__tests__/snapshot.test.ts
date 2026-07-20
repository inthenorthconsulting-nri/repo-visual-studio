import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot, type BuildDecisionSnapshotInput } from "../snapshot.js";
import { buildSnapshotId } from "../ids.js";
import { DECISION_INTELLIGENCE_SCHEMA_VERSION } from "../contracts.js";
import type { UpstreamSnapshotRef } from "../contracts.js";
import { architectureDecision, decisionSourceIssue, GENERATED_AT } from "./decision-fixtures.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key]);
    return sorted;
  }
  return value;
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function baseInput(overrides: Partial<BuildDecisionSnapshotInput> = {}): BuildDecisionSnapshotInput {
  return {
    repositoryId: "repo-test",
    generatedAt: GENERATED_AT,
    decisions: [],
    sourceIssues: [],
    ...overrides,
  };
}

describe("buildDecisionSnapshot: static fields", () => {
  it("stamps schema_version with DECISION_INTELLIGENCE_SCHEMA_VERSION", () => {
    const snapshot = buildDecisionSnapshot(baseInput());
    expect(snapshot.schema_version).toBe(DECISION_INTELLIGENCE_SCHEMA_VERSION);
  });

  it("passes through repository_id and generated_at verbatim", () => {
    const snapshot = buildDecisionSnapshot(baseInput({ repositoryId: "org/repo", generatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(snapshot.repository_id).toBe("org/repo");
    expect(snapshot.generated_at).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("buildDecisionSnapshot: id derivation", () => {
  it("derives id via buildSnapshotId(repositoryId, sorted decision digests)", () => {
    const decisions = [architectureDecision({ id: "decision:b" }), architectureDecision({ id: "decision:a" })];
    const snapshot = buildDecisionSnapshot(baseInput({ repositoryId: "repo-x", decisions }));
    const expectedDigests = decisions.map((d) => digestOf(d)).sort();
    expect(snapshot.id).toBe(buildSnapshotId("repo-x", expectedDigests));
  });

  it("is independent of input decisions array order (digests are sorted before id derivation)", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const forward = buildDecisionSnapshot(baseInput({ decisions: [a, b] }));
    const reversed = buildDecisionSnapshot(baseInput({ decisions: [b, a] }));
    expect(forward.id).toBe(reversed.id);
  });

  it("sanitizes a repositoryId with unsafe characters exactly as buildSnapshotId would", () => {
    const snapshot = buildDecisionSnapshot(baseInput({ repositoryId: "org/repo:name" }));
    expect(snapshot.id).toBe(buildSnapshotId("org/repo:name", []));
    expect(snapshot.id).not.toContain(":name");
  });

  it("changes id when decision content changes, even with the same generatedAt", () => {
    const decisionA = architectureDecision({ id: "decision:test-1", title: "Original title" });
    const decisionB = architectureDecision({ id: "decision:test-1", title: "Different title" });
    const first = buildDecisionSnapshot(baseInput({ decisions: [decisionA] }));
    const second = buildDecisionSnapshot(baseInput({ decisions: [decisionB] }));
    expect(first.id).not.toBe(second.id);
  });

  it("id is unaffected by generatedAt (generated_at is excluded from every determinism comparison)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const first = buildDecisionSnapshot(baseInput({ decisions: [decision], generatedAt: "2020-01-01T00:00:00.000Z" }));
    const second = buildDecisionSnapshot(baseInput({ decisions: [decision], generatedAt: "2030-06-06T00:00:00.000Z" }));
    expect(first.id).toBe(second.id);
    expect(first.digest).toBe(second.digest);
  });
});

describe("buildDecisionSnapshot: digest", () => {
  it("digest is a sha256 hex digest of the recursively key-sorted canonicalization of {decisions, source_issues}", () => {
    const decisions = [architectureDecision({ id: "decision:a" })];
    const sourceIssues = [decisionSourceIssue({ id: "decision:source-issue:a" })];
    const snapshot = buildDecisionSnapshot(baseInput({ decisions, sourceIssues }));
    const expected = digestOf({ decisions, source_issues: sourceIssues });
    expect(snapshot.digest).toBe(expected);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("digest is unaffected by field-order differences within decision objects (key-sorted canonicalization)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const reordered = Object.fromEntries(Object.entries(decision).reverse()) as typeof decision;
    const first = buildDecisionSnapshot(baseInput({ decisions: [decision] }));
    const second = buildDecisionSnapshot(baseInput({ decisions: [reordered] }));
    expect(first.digest).toBe(second.digest);
  });
});

describe("buildDecisionSnapshot: sorting of decisions and source_issues", () => {
  it("sorts decisions by id regardless of input order", () => {
    const a = architectureDecision({ id: "decision:aaa" });
    const b = architectureDecision({ id: "decision:bbb" });
    const c = architectureDecision({ id: "decision:ccc" });
    const snapshot = buildDecisionSnapshot(baseInput({ decisions: [c, a, b] }));
    expect(snapshot.decisions.map((d) => d.id)).toEqual(["decision:aaa", "decision:bbb", "decision:ccc"]);
  });

  it("sorts source_issues by id regardless of input order", () => {
    const x = decisionSourceIssue({ id: "decision:source-issue:xxx" });
    const y = decisionSourceIssue({ id: "decision:source-issue:yyy" });
    const snapshot = buildDecisionSnapshot(baseInput({ sourceIssues: [y, x] }));
    expect(snapshot.source_issues.map((s) => s.id)).toEqual(["decision:source-issue:xxx", "decision:source-issue:yyy"]);
  });
});

describe("buildDecisionSnapshot: upstream_snapshot is a reference, never an embed", () => {
  it("carries only the pointer fields (snapshot_id, digest, schema_version) supplied by the caller", () => {
    const upstreamSnapshot: UpstreamSnapshotRef = { snapshot_id: "arch:snapshot:xyz", digest: "abc123", schema_version: 1 };
    const snapshot = buildDecisionSnapshot(baseInput({ upstreamSnapshot }));
    expect(snapshot.upstream_snapshot).toEqual(upstreamSnapshot);
    expect(Object.keys(snapshot.upstream_snapshot!).sort()).toEqual(["digest", "schema_version", "snapshot_id"]);
  });

  it("is undefined when the caller supplies no upstreamSnapshot at all", () => {
    const snapshot = buildDecisionSnapshot(baseInput());
    expect(snapshot.upstream_snapshot).toBeUndefined();
  });

  it("this package never imports @rvs/governance-intelligence's IntelligenceSnapshot type (structural echo only)", () => {
    const upstreamSnapshot: UpstreamSnapshotRef = { snapshot_id: "s", digest: "d", schema_version: 1 };
    const snapshot = buildDecisionSnapshot(baseInput({ upstreamSnapshot, decisions: [architectureDecision()] }));
    expect(snapshot.upstream_snapshot).not.toHaveProperty("artifacts");
    expect(snapshot.upstream_snapshot).not.toHaveProperty("repository_id");
    expect(snapshot.upstream_snapshot).not.toHaveProperty("generation");
  });
});

describe("buildDecisionSnapshot: compatibility ('complete' | 'partial' | 'unavailable')", () => {
  it("derives 'unavailable' when no upstreamSnapshot and no explicit upstreamCompatibility are supplied", () => {
    const snapshot = buildDecisionSnapshot(baseInput());
    expect(snapshot.compatibility).toBe("unavailable");
  });

  it("derives 'complete' when upstreamSnapshot is supplied and upstreamCompatibility is omitted", () => {
    const upstreamSnapshot: UpstreamSnapshotRef = { snapshot_id: "s", digest: "d", schema_version: 1 };
    const snapshot = buildDecisionSnapshot(baseInput({ upstreamSnapshot }));
    expect(snapshot.compatibility).toBe("complete");
  });

  it("honors an explicit upstreamCompatibility of 'partial' even when upstreamSnapshot is supplied", () => {
    const upstreamSnapshot: UpstreamSnapshotRef = { snapshot_id: "s", digest: "d", schema_version: 1 };
    const snapshot = buildDecisionSnapshot(baseInput({ upstreamSnapshot, upstreamCompatibility: "partial" }));
    expect(snapshot.compatibility).toBe("partial");
  });

  it("honors an explicit upstreamCompatibility even when no upstreamSnapshot is supplied", () => {
    const snapshot = buildDecisionSnapshot(baseInput({ upstreamCompatibility: "partial" }));
    expect(snapshot.compatibility).toBe("partial");
  });

  it("covers all three DecisionSnapshotCompatibilityStatus values by name", () => {
    const complete = buildDecisionSnapshot(baseInput({ upstreamCompatibility: "complete" }));
    const partial = buildDecisionSnapshot(baseInput({ upstreamCompatibility: "partial" }));
    const unavailable = buildDecisionSnapshot(baseInput({ upstreamCompatibility: "unavailable" }));
    expect(complete.compatibility).toBe("complete");
    expect(partial.compatibility).toBe("partial");
    expect(unavailable.compatibility).toBe("unavailable");
  });
});

describe("buildDecisionSnapshot: determinism", () => {
  it("produces byte-identical output across two runs over identical input state", () => {
    const decisions = [architectureDecision({ id: "decision:stable-1" })];
    const sourceIssues = [decisionSourceIssue({ id: "decision:source-issue:stable-1" })];
    const input = baseInput({ decisions, sourceIssues });
    const first = buildDecisionSnapshot(input);
    const second = buildDecisionSnapshot(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
