import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config.js";
import { detectWorkspace, workspaceSourcePatterns } from "../workspace.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "rvs-workspace-detect-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("detectWorkspace", () => {
  it("reports single-package for a repo with no workspace manifest", () => {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "order-service" }));

    const detection = detectWorkspace(repoRoot);
    expect(detection).toEqual({ kind: "single-package", marker: null, packageGlobs: [] });
  });

  it("detects a pnpm workspace via pnpm-workspace.yaml", () => {
    writeFileSync(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n  - 'apps/*'\n");

    const detection = detectWorkspace(repoRoot);
    expect(detection.kind).toBe("pnpm");
    expect(detection.marker).toBe("pnpm-workspace.yaml");
    expect(detection.packageGlobs).toEqual(["packages/*", "apps/*"]);
  });

  it("falls back to a packages/* default when pnpm-workspace.yaml has no packages field", () => {
    writeFileSync(join(repoRoot, "pnpm-workspace.yaml"), "# empty\n");

    const detection = detectWorkspace(repoRoot);
    expect(detection.kind).toBe("pnpm");
    expect(detection.packageGlobs).toEqual(["packages/*"]);
  });

  it("detects an npm workspace via package.json workspaces array", () => {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    );

    const detection = detectWorkspace(repoRoot);
    expect(detection.kind).toBe("npm");
    expect(detection.marker).toBe("package.json (workspaces field)");
    expect(detection.packageGlobs).toEqual(["packages/*"]);
  });

  it("detects a Yarn workspace via package.json workspaces.packages plus yarn.lock", () => {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({ name: "root", workspaces: { packages: ["packages/*"] } }),
    );
    writeFileSync(join(repoRoot, "yarn.lock"), "");

    const detection = detectWorkspace(repoRoot);
    expect(detection.kind).toBe("yarn");
    expect(detection.packageGlobs).toEqual(["packages/*"]);
  });

  it("ignores negated workspace globs", () => {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*", "!packages/legacy-*"] }),
    );

    const detection = detectWorkspace(repoRoot);
    expect(detection.packageGlobs).toEqual(["packages/*"]);
  });

  it("treats a malformed package.json as single-package rather than throwing", () => {
    writeFileSync(join(repoRoot, "package.json"), "{not valid json");

    expect(() => detectWorkspace(repoRoot)).not.toThrow();
    expect(detectWorkspace(repoRoot).kind).toBe("single-package");
  });
});

describe("workspaceSourcePatterns", () => {
  it("returns no extra patterns for single-package", () => {
    expect(workspaceSourcePatterns({ kind: "single-package", marker: null, packageGlobs: [] })).toEqual({
      include: [],
      exclude: [],
    });
  });

  it("expands package globs into package.json + src/** include patterns", () => {
    const { include, exclude } = workspaceSourcePatterns({
      kind: "pnpm",
      marker: "pnpm-workspace.yaml",
      packageGlobs: ["packages/*", "apps/*"],
    });
    expect(include).toEqual([
      "packages/*/package.json",
      "packages/*/src/**",
      "apps/*/package.json",
      "apps/*/src/**",
    ]);
    expect(exclude).toEqual(["**/node_modules/**", "**/dist/**"]);
  });
});

describe("defaultConfig with workspace detection", () => {
  it("keeps the concise single-package list when no workspace is passed (backward compatible)", () => {
    const config = defaultConfig("order-service");
    expect(config.sources.include).not.toContain("packages/*/src/**");
    expect(config.sources.exclude).toEqual([
      "**/node_modules/**",
      "**/dist/**",
      ".git/**",
      "**/*.lock",
      "**/*.secret",
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      ".aws/credentials",
      ".rvs/cache/**",
      "artifacts/**",
    ]);
  });

  it("layers workspace patterns on top of the single-package defaults, without dropping them", () => {
    const config = defaultConfig("monorepo-root", {
      kind: "pnpm",
      marker: "pnpm-workspace.yaml",
      packageGlobs: ["packages/*"],
    });
    expect(config.sources.include).toContain("README.md");
    expect(config.sources.include).toContain("packages/*/package.json");
    expect(config.sources.include).toContain("packages/*/src/**");
    expect(config.sources.exclude).toContain("**/node_modules/**");
    expect(config.sources.exclude).toContain("**/dist/**");
  });
});
