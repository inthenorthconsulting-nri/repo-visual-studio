import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@rvs/core";
import { afterEach, describe, expect, it } from "vitest";
import { scanFiles } from "../scan.js";
import { detectWorkspacePackages } from "../workspace-packages.js";

let repoRoot: string;

afterEach(() => {
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("detectWorkspacePackages", () => {
  it("finds no packages in a single-manifest repo (the repo root's own manifest is not a sub-package)", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-wsp-"));
    writeJson(join(repoRoot, "package.json"), { name: "sample" });
    writeFileSync(join(repoRoot, "index.ts"), "export {};\n");

    const config = defaultConfig("sample");
    const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
    expect(detectWorkspacePackages(repoRoot, inventory)).toEqual([]);
  });

  it("detects a nested package.json as a distinct workspace package, classifying bin/dependency/export signals", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-wsp-"));
    writeJson(join(repoRoot, "package.json"), { name: "monorepo-root", private: true });
    mkdirSync(join(repoRoot, "packages/cli-tool"), { recursive: true });
    writeJson(join(repoRoot, "packages/cli-tool/package.json"), {
      name: "@sample/cli-tool",
      description: "The command-line entry point.",
      bin: { "sample-cli": "./bin.js" },
      dependencies: { commander: "^12.0.0" },
    });
    writeFileSync(join(repoRoot, "packages/cli-tool/bin.js"), "#!/usr/bin/env node\n");

    mkdirSync(join(repoRoot, "packages/api-server"), { recursive: true });
    writeJson(join(repoRoot, "packages/api-server/package.json"), {
      name: "@sample/api-server",
      dependencies: { express: "^4.0.0" },
      main: "./index.js",
    });
    writeFileSync(join(repoRoot, "packages/api-server/index.js"), "module.exports = {};\n");

    const config = defaultConfig("monorepo-root");
    const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
    const packages = detectWorkspacePackages(repoRoot, inventory);

    expect(packages.map((p) => p.path)).toEqual(["packages/api-server", "packages/cli-tool"]);

    const cliTool = packages.find((p) => p.path === "packages/cli-tool")!;
    expect(cliTool.name).toBe("@sample/cli-tool");
    expect(cliTool.description).toBe("The command-line entry point.");
    expect(cliTool.hasBinEntry).toBe(true);
    expect(cliTool.binPaths).toEqual(["packages/cli-tool/bin.js"]);
    expect(cliTool.dependencyNames).toContain("commander");

    const apiServer = packages.find((p) => p.path === "packages/api-server")!;
    expect(apiServer.hasBinEntry).toBe(false);
    expect(apiServer.dependencyNames).toContain("express");
    expect(apiServer.hasLibraryExport).toBe(true);
  });

  it("extracts a best-effort name from non-JSON manifests without a full parser", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-wsp-"));
    writeJson(join(repoRoot, "package.json"), { name: "polyglot-root" });
    mkdirSync(join(repoRoot, "services/worker"), { recursive: true });
    writeFileSync(join(repoRoot, "services/worker/go.mod"), "module github.com/example/worker\n\ngo 1.22\n");
    writeFileSync(join(repoRoot, "services/worker/main.go"), "package main\n\nfunc main() {}\n");

    const config = defaultConfig("polyglot-root");
    const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
    const packages = detectWorkspacePackages(repoRoot, inventory);

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ path: "services/worker", manifestFile: "go.mod", name: "worker" });
  });

  it("tolerates a malformed package.json instead of throwing", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-wsp-"));
    writeJson(join(repoRoot, "package.json"), { name: "root" });
    mkdirSync(join(repoRoot, "packages/broken"), { recursive: true });
    writeFileSync(join(repoRoot, "packages/broken/package.json"), "{ not valid json");
    writeFileSync(join(repoRoot, "packages/broken/index.ts"), "export {};\n");

    const config = defaultConfig("root");
    const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
    const packages = detectWorkspacePackages(repoRoot, inventory);

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ path: "packages/broken", hasBinEntry: false, dependencyNames: [] });
  });
});
