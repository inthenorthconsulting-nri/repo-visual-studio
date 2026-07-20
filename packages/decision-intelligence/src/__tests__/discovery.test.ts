import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverDecisionCandidates } from "../discovery.js";
import type { DecisionsConfig } from "../decisions-config.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "discovery-test-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function write(relPath: string, content = "content"): void {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function config(overrides: Partial<DecisionsConfig> = {}): DecisionsConfig {
  return { schema_version: 1, sources: [{ path: "docs/adr", type: "adr" }], ...overrides };
}

describe("discoverDecisionCandidates: basic discovery", () => {
  it("finds markdown files under a configured source path", async () => {
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result).toEqual([{ repo_relative_path: "docs/adr/0001-example.md", configured_type: "adr" }]);
  });

  it("recurses into subdirectories of the source path", async () => {
    write("docs/adr/nested/0002-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/nested/0002-example.md"]);
  });

  it("only matches .md files by default, not other extensions", async () => {
    write("docs/adr/0001-example.md");
    write("docs/adr/notes.txt");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md"]);
  });

  it("uses forward slashes in repo_relative_path", async () => {
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result[0].repo_relative_path).not.toContain("\\");
  });

  it("returns an empty array when a configured source path does not exist", async () => {
    const result = await discoverDecisionCandidates(repoRoot, config({ sources: [{ path: "docs/nonexistent", type: "adr" }] }));
    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no matching files", async () => {
    mkdirSync(join(repoRoot, "docs", "adr"), { recursive: true });
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result).toEqual([]);
  });

  it("excludes dotfiles from matches", async () => {
    write("docs/adr/.hidden.md");
    write("docs/adr/0001-visible.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-visible.md"]);
  });
});

describe("discoverDecisionCandidates: multiple sources and tie-breaking", () => {
  it("merges candidates from multiple configured sources", async () => {
    write("docs/adr/0001-example.md");
    write("rfcs/0002-example.md");
    const result = await discoverDecisionCandidates(
      repoRoot,
      config({ sources: [{ path: "docs/adr", type: "adr" }, { path: "rfcs", type: "rfc" }] }),
    );
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md", "rfcs/0002-example.md"]);
  });

  it("lets the first source entry claiming a path win over a later source with an overlapping root", async () => {
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(
      repoRoot,
      config({ sources: [{ path: "docs/adr", type: "adr" }, { path: "docs/adr", type: "rfc" }] }),
    );
    expect(result).toEqual([{ repo_relative_path: "docs/adr/0001-example.md", configured_type: "adr" }]);
  });
});

describe("discoverDecisionCandidates: denylist", () => {
  it("excludes a top-level node_modules directory directly under a source path", async () => {
    write("docs/adr/node_modules/vendor.md");
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md"]);
  });

  it("excludes top-level dist, build, .git, .rvs/cache, and .rvs/tmp directories under a source path", async () => {
    write("docs/adr/dist/a.md");
    write("docs/adr/build/b.md");
    write("docs/adr/.git/c.md");
    write("docs/adr/.rvs/cache/d.md");
    write("docs/adr/.rvs/tmp/e.md");
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md"]);
  });

  it("does not recursively exclude a denylisted directory name nested deeper than the source root (the ignore patterns are not '**'-prefixed)", async () => {
    write("docs/adr/nested/node_modules/vendor.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/nested/node_modules/vendor.md"]);
  });
});

describe("discoverDecisionCandidates: source.include overrides", () => {
  it("restricts matches to a custom include glob when provided", async () => {
    write("docs/adr/0001-example.md");
    write("docs/adr/readme.md");
    const result = await discoverDecisionCandidates(repoRoot, config({ sources: [{ path: "docs/adr", type: "adr", include: ["[0-9]*.md"] }] }));
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md"]);
  });

  it("falls back to the default **/*.md include when include is an empty array", async () => {
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config({ sources: [{ path: "docs/adr", type: "adr", include: [] }] }));
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-example.md"]);
  });

  it("dedupes a file matched by more than one include pattern within the same source", async () => {
    write("docs/adr/0001-example.md");
    const result = await discoverDecisionCandidates(repoRoot, config({ sources: [{ path: "docs/adr", type: "adr", include: ["**/*.md", "0001-*.md"] }] }));
    expect(result).toHaveLength(1);
  });
});

describe("discoverDecisionCandidates: determinism and sort order", () => {
  it("returns results sorted by repo_relative_path regardless of file creation order", async () => {
    write("docs/adr/0003-third.md");
    write("docs/adr/0001-first.md");
    write("docs/adr/0002-second.md");
    const result = await discoverDecisionCandidates(repoRoot, config());
    expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/0001-first.md", "docs/adr/0002-second.md", "docs/adr/0003-third.md"]);
  });

  it("is deterministic across repeated calls over the same filesystem state", async () => {
    write("docs/adr/0001-example.md");
    write("docs/adr/0002-example.md");
    const first = await discoverDecisionCandidates(repoRoot, config());
    const second = await discoverDecisionCandidates(repoRoot, config());
    expect(first).toEqual(second);
  });
});

describe("discoverDecisionCandidates: adversarial source paths (no guard exists -- documenting actual behavior)", () => {
  it("a source.path containing '..' escapes repoRoot rather than being rejected, since sourceRoot is a plain node:path join with no containment check", async () => {
    const outside = mkdtempSync(join(tmpdir(), "discovery-outside-"));
    writeFileSync(join(outside, "secret.md"), "content", "utf8");
    try {
      const escapePath = relative(repoRoot, outside);
      const result = await discoverDecisionCandidates(repoRoot, config({ sources: [{ path: escapePath, type: "adr" }] }));
      expect(result.map((r) => r.repo_relative_path)).toEqual([escapePath.split("\\").join("/") + "/secret.md"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("follows a symlink that escapes the configured source root, since fast-glob's default followSymbolicLinks is not overridden", async () => {
    const outside = mkdtempSync(join(tmpdir(), "discovery-symlink-outside-"));
    writeFileSync(join(outside, "secret.md"), "content", "utf8");
    try {
      mkdirSync(join(repoRoot, "docs", "adr"), { recursive: true });
      symlinkSync(outside, join(repoRoot, "docs", "adr", "escape"), "dir");
      const result = await discoverDecisionCandidates(repoRoot, config());
      expect(result.map((r) => r.repo_relative_path)).toEqual(["docs/adr/escape/secret.md"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
