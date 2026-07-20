import { describe, expect, it } from "vitest";
import { detectDecisionIdentityIssues, resolveDecisionIdentity, type DecisionIdentityInput, type ResolvedDecisionSourceRecord } from "../identity.js";
import { buildDecisionId } from "../ids.js";
import { evidenceRef } from "./decision-fixtures.js";

function input(overrides: Partial<DecisionIdentityInput> = {}): DecisionIdentityInput {
  return {
    repo_relative_path: "docs/adr/notes.md",
    frontmatter: undefined,
    title: "Notes",
    content_digest: "digest-abc",
    ...overrides,
  };
}

describe("resolveDecisionIdentity: default preference order", () => {
  it("prefers frontmatter.id when present", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "adr-0001" } }), undefined);
    expect(result).toEqual({ id: buildDecisionId("adr-0001"), basis: "frontmatter_id" });
  });

  it("falls through to filename/title pattern when frontmatter.id is absent", () => {
    const result = resolveDecisionIdentity(input({ title: "ADR-7: Use Postgres" }), undefined);
    expect(result).toEqual({ id: buildDecisionId("ADR-7"), basis: "title_or_filename_pattern" });
  });

  it("treats a whitespace-only frontmatter.id as absent", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "   " }, title: "ADR-7" }), undefined);
    expect(result.basis).toBe("title_or_filename_pattern");
  });

  it("falls through to repo_relative_path when no id/filename pattern is found", () => {
    const result = resolveDecisionIdentity(input({ repo_relative_path: "docs/random-notes.md", title: "Random Notes" }), undefined);
    expect(result).toEqual({ id: buildDecisionId("docs/random-notes.md"), basis: "path" });
  });

  it("falls through to content_digest when the configured preference order excludes every strategy that would otherwise resolve (path always resolves unconditionally, so it must be excluded to reach this fallback)", () => {
    const result = resolveDecisionIdentity(input({ title: "Random Notes", repo_relative_path: "docs/random-notes.md", content_digest: "digest-zzz" }), ["frontmatter.id", "filename"]);
    expect(result).toEqual({ id: buildDecisionId("digest-zzz"), basis: "content_digest" });
  });
});

describe("resolveDecisionIdentity: filename/title ADR-RFC pattern matching", () => {
  it("matches the title before the repo_relative_path", () => {
    const result = resolveDecisionIdentity(input({ title: "ADR-7: Use Postgres", repo_relative_path: "docs/0099-other.md" }), undefined);
    expect(result.id).toBe(buildDecisionId("ADR-7"));
  });

  it("falls back to matching the repo_relative_path when the title has no identifier", () => {
    const result = resolveDecisionIdentity(input({ title: "Use Postgres", repo_relative_path: "docs/adr/0099-example.md" }), undefined);
    expect(result.basis).toBe("path");
    expect(result.id).toBe(buildDecisionId("docs/adr/0099-example.md"));
  });

  it("recognizes RFC identifiers", () => {
    const result = resolveDecisionIdentity(input({ title: "RFC-42: Streaming API" }), undefined);
    expect(result.id).toBe(buildDecisionId("RFC-42"));
  });

  it("is case-insensitive and normalizes separator/casing to 'PREFIX-NUMBER'", () => {
    const result = resolveDecisionIdentity(input({ title: "adr_7 lowercase with underscore" }), undefined);
    expect(result.id).toBe(buildDecisionId("ADR-7"));
  });

  it("matches an identifier with no separator at all", () => {
    const result = resolveDecisionIdentity(input({ title: "ADR7 no separator" }), undefined);
    expect(result.id).toBe(buildDecisionId("ADR-7"));
  });
});

describe("resolveDecisionIdentity: configured preference order", () => {
  it("configured_id never resolves (reserved strategy) and falls through the rest of the order", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "adr-1" } }), ["configured_id", "frontmatter.id"]);
    expect(result.basis).toBe("frontmatter_id");
  });

  it("resolves via content_digest when the only configured strategy is configured_id", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "adr-1" }, content_digest: "digest-only" }), ["configured_id"]);
    expect(result).toEqual({ id: buildDecisionId("digest-only"), basis: "content_digest" });
  });

  it("honors a custom preference order that puts path ahead of frontmatter.id", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "adr-1" }, repo_relative_path: "docs/x.md" }), ["path", "frontmatter.id"]);
    expect(result).toEqual({ id: buildDecisionId("docs/x.md"), basis: "path" });
  });

  it("filters out unrecognized strategy names and uses the remaining known ones", () => {
    const result = resolveDecisionIdentity(input({ repo_relative_path: "docs/x.md" }), ["bogus_strategy", "path"]);
    expect(result.basis).toBe("path");
  });

  it("treats an empty preference array the same as no preference (uses the default order)", () => {
    const withEmpty = resolveDecisionIdentity(input({ frontmatter: { id: "adr-1" } }), []);
    const withUndefined = resolveDecisionIdentity(input({ frontmatter: { id: "adr-1" } }), undefined);
    expect(withEmpty).toEqual(withUndefined);
  });
});

describe("resolveDecisionIdentity: unsafe identity strings are sanitized", () => {
  it("sanitizes path separators out of a frontmatter.id used as identity (dots are left intact, only slashes are unsafe here)", () => {
    const result = resolveDecisionIdentity(input({ frontmatter: { id: "../../etc/passwd" } }), undefined);
    expect(result.id).not.toMatch(/[/\\]/);
    expect(result.id).toBe(buildDecisionId("../../etc/passwd"));
    expect(result.id).toBe("decision:..-..-etc-passwd");
  });

  it("sanitizes path separators out of a path-derived identity", () => {
    const result = resolveDecisionIdentity(input({ repo_relative_path: "docs/adr/0001-x.md", title: "no pattern here" }), undefined);
    expect(result.id).toBe("decision:docs-adr-0001-x.md");
  });
});

function record(overrides: Partial<ResolvedDecisionSourceRecord> = {}): ResolvedDecisionSourceRecord {
  return {
    id: "decision:a",
    repo_relative_path: "docs/a.md",
    content_digest: "digest-a",
    evidence_refs: [evidenceRef({ path: overrides.repo_relative_path ?? "docs/a.md" })],
    ...overrides,
  };
}

describe("detectDecisionIdentityIssues: no issues", () => {
  it("returns no issues for a set of records with distinct ids and paths", () => {
    const records = [record({ id: "decision:a", repo_relative_path: "docs/a.md" }), record({ id: "decision:b", repo_relative_path: "docs/b.md" })];
    expect(detectDecisionIdentityIssues(records)).toEqual([]);
  });

  it("returns no issues for an empty record set", () => {
    expect(detectDecisionIdentityIssues([])).toEqual([]);
  });
});

describe("detectDecisionIdentityIssues: exact id collision", () => {
  it("reports multiple_files_claim_one_id when two records share an exact id", () => {
    const records = [record({ id: "decision:dup", repo_relative_path: "docs/b.md" }), record({ id: "decision:dup", repo_relative_path: "docs/a.md" })];
    const issues = detectDecisionIdentityIssues(records);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("multiple_files_claim_one_id");
    expect(issues[0].affected_paths).toEqual(["docs/a.md", "docs/b.md"]);
    expect(issues[0].detail).toContain("decision:dup");
    expect(issues[0].detail).toContain("2 decision documents");
  });

  it("combines evidence_refs from every record in the colliding group", () => {
    const a = record({ id: "decision:dup", repo_relative_path: "docs/a.md", evidence_refs: [evidenceRef({ path: "docs/a.md" })] });
    const b = record({ id: "decision:dup", repo_relative_path: "docs/b.md", evidence_refs: [evidenceRef({ path: "docs/b.md" })] });
    const issues = detectDecisionIdentityIssues([a, b]);
    expect(issues[0].evidence_refs).toEqual([...a.evidence_refs, ...b.evidence_refs]);
  });

  it("reports a distinct issue per distinct colliding id", () => {
    const records = [
      record({ id: "decision:dup1", repo_relative_path: "docs/a.md" }),
      record({ id: "decision:dup1", repo_relative_path: "docs/b.md" }),
      record({ id: "decision:dup2", repo_relative_path: "docs/c.md" }),
      record({ id: "decision:dup2", repo_relative_path: "docs/d.md" }),
    ];
    const issues = detectDecisionIdentityIssues(records);
    expect(issues.filter((i) => i.kind === "multiple_files_claim_one_id")).toHaveLength(2);
  });
});

describe("detectDecisionIdentityIssues: case-only collision", () => {
  it("reports duplicate_id_case_only when ids differ only by case", () => {
    const records = [record({ id: "decision:ADR-1", repo_relative_path: "docs/a.md" }), record({ id: "decision:adr-1", repo_relative_path: "docs/b.md" })];
    const issues = detectDecisionIdentityIssues(records);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate_id_case_only");
    expect(issues[0].affected_paths).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("does not report a case-only collision when the ids are exactly identical (that is an exact-id collision instead)", () => {
    const records = [record({ id: "decision:same", repo_relative_path: "docs/a.md" }), record({ id: "decision:same", repo_relative_path: "docs/b.md" })];
    const issues = detectDecisionIdentityIssues(records);
    expect(issues.map((i) => i.kind)).toEqual(["multiple_files_claim_one_id"]);
  });

  it("reports both an exact-id collision and a case-only collision when a third record's id differs only by case from an exact-duplicate pair", () => {
    const records = [
      record({ id: "decision:ID", repo_relative_path: "docs/a.md" }),
      record({ id: "decision:ID", repo_relative_path: "docs/b.md" }),
      record({ id: "decision:id", repo_relative_path: "docs/c.md" }),
    ];
    const issues = detectDecisionIdentityIssues(records);
    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(["duplicate_id_case_only", "multiple_files_claim_one_id"]);
    const caseOnly = issues.find((i) => i.kind === "duplicate_id_case_only")!;
    expect(caseOnly.affected_paths).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);
    const exact = issues.find((i) => i.kind === "multiple_files_claim_one_id")!;
    expect(exact.affected_paths).toEqual(["docs/a.md", "docs/b.md"]);
  });
});

describe("detectDecisionIdentityIssues: id_reused_with_changed_content", () => {
  it("reports the issue when the same path resolves to a different id and the content also changed", () => {
    const current = [record({ id: "decision:new-id", repo_relative_path: "docs/a.md", content_digest: "digest-2" })];
    const prior = [record({ id: "decision:old-id", repo_relative_path: "docs/a.md", content_digest: "digest-1" })];
    const issues = detectDecisionIdentityIssues(current, prior);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("id_reused_with_changed_content");
    expect(issues[0].affected_paths).toEqual(["docs/a.md"]);
    expect(issues[0].evidence_refs).toEqual(current[0].evidence_refs);
  });

  it("does not report the issue when the id is unchanged across scans, even if content_digest changed", () => {
    const current = [record({ id: "decision:same-id", repo_relative_path: "docs/a.md", content_digest: "digest-2" })];
    const prior = [record({ id: "decision:same-id", repo_relative_path: "docs/a.md", content_digest: "digest-1" })];
    expect(detectDecisionIdentityIssues(current, prior)).toEqual([]);
  });

  it("does not report the issue when content_digest is unchanged, even if the id differs", () => {
    const current = [record({ id: "decision:new-id", repo_relative_path: "docs/a.md", content_digest: "digest-same" })];
    const prior = [record({ id: "decision:old-id", repo_relative_path: "docs/a.md", content_digest: "digest-same" })];
    expect(detectDecisionIdentityIssues(current, prior)).toEqual([]);
  });

  it("never reports the issue when priorRecords is omitted, matching a first-ever scan", () => {
    const current = [record({ id: "decision:new-id", repo_relative_path: "docs/a.md", content_digest: "digest-2" })];
    expect(detectDecisionIdentityIssues(current)).toEqual([]);
  });

  it("does not report the issue for a path present only in priorRecords and absent from the current scan", () => {
    const prior = [record({ id: "decision:old-id", repo_relative_path: "docs/removed.md", content_digest: "digest-1" })];
    expect(detectDecisionIdentityIssues([], prior)).toEqual([]);
  });
});

describe("detectDecisionIdentityIssues: id determinism", () => {
  it("builds the same issue id for the same colliding-path set regardless of input record order", () => {
    const a = record({ id: "decision:dup", repo_relative_path: "docs/a.md" });
    const b = record({ id: "decision:dup", repo_relative_path: "docs/b.md" });
    const forward = detectDecisionIdentityIssues([a, b]);
    const reversed = detectDecisionIdentityIssues([b, a]);
    expect(forward[0].id).toBe(reversed[0].id);
  });

  it("is deterministic: identical input produces byte-identical output", () => {
    const records = [record({ id: "decision:dup", repo_relative_path: "docs/a.md" }), record({ id: "decision:dup", repo_relative_path: "docs/b.md" })];
    const first = detectDecisionIdentityIssues(records);
    const second = detectDecisionIdentityIssues(records);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
