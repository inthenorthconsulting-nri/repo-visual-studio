import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverWorkflowFiles, resolveWorkflowPath } from "../discover.js";

describe("discoverWorkflowFiles", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-workflow-discover-"));
    mkdirSync(join(repoRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "name: CI\non: push\njobs: {}\n");
    writeFileSync(join(repoRoot, ".github", "workflows", "release.yaml"), "name: Release\non: push\njobs: {}\n");
    writeFileSync(join(repoRoot, ".github", "workflows", "README.md"), "# not a workflow\n");
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "src", "index.ts"), "export {};\n");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("discovers both .yml and .yaml workflow files, sorted", async () => {
    const files = await discoverWorkflowFiles(repoRoot);
    expect(files).toEqual([".github/workflows/ci.yml", ".github/workflows/release.yaml"]);
  });

  it("does not pick up non-workflow files or files outside .github/workflows", async () => {
    const files = await discoverWorkflowFiles(repoRoot);
    expect(files.every((f) => f.startsWith(".github/workflows/"))).toBe(true);
    expect(files.some((f) => f.endsWith(".md"))).toBe(false);
  });

  it("returns an empty array when no workflows directory exists", async () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), "rvs-workflow-discover-empty-"));
    try {
      const files = await discoverWorkflowFiles(emptyRepo);
      expect(files).toEqual([]);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });

  it("resolveWorkflowPath joins repo root and relative path", () => {
    const resolved = resolveWorkflowPath(repoRoot, ".github/workflows/ci.yml");
    expect(resolved).toBe(join(repoRoot, ".github/workflows/ci.yml"));
  });
});
