import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, detectWorkspace } from "@rvs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepositoryModel } from "../repository-model.js";

// Exercises the workspace-detection -> defaultConfig -> buildRepositoryModel
// pipeline end to end against a real directory tree, specifically covering
// the two scan-correctness scenarios that motivated broadening the default
// excludes: nested per-package node_modules, and nested per-package dist
// output. Both must be invisible to the scan even though they sit under
// packages/*/, which is otherwise included.
let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "rvs-workspace-scan-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const path = join(repoRoot, relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("workspace-aware scanning", () => {
  it("includes workspace package sources while excluding nested node_modules and dist", async () => {
    writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
    writeFile("package.json", JSON.stringify({ name: "demo-monorepo" }));
    writeFile("README.md", "# Demo Monorepo\n");

    writeFile("packages/widgets/package.json", JSON.stringify({ name: "@demo/widgets" }));
    writeFile("packages/widgets/src/index.ts", "export const widget = 1;\n");
    writeFile("packages/widgets/dist/index.js", "// compiled output — must not be scanned\n");
    writeFile(
      "packages/widgets/node_modules/some-dep/package.json",
      JSON.stringify({ name: "some-dep" }),
    );
    writeFile("packages/widgets/node_modules/some-dep/index.js", "// third-party — must not be scanned\n");

    const workspace = detectWorkspace(repoRoot);
    expect(workspace.kind).toBe("pnpm");

    const config = defaultConfig("demo-monorepo", workspace);
    const model = await buildRepositoryModel(repoRoot, config);
    const paths = model.files.sampledPaths;

    expect(paths).toContain("packages/widgets/package.json");
    expect(paths).toContain("packages/widgets/src/index.ts");
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes("/dist/"))).toBe(false);
  });

  it("scans a single-package repo without picking up an unrelated top-level dist/ directory", async () => {
    writeFile("package.json", JSON.stringify({ name: "order-service" }));
    writeFile("README.md", "# Order Service\n");
    writeFile("src/index.ts", "export {};\n");
    writeFile("dist/index.js", "// compiled output\n");

    const workspace = detectWorkspace(repoRoot);
    expect(workspace.kind).toBe("single-package");

    const config = defaultConfig("order-service", workspace);
    const model = await buildRepositoryModel(repoRoot, config);
    const paths = model.files.sampledPaths;

    expect(paths).toContain("src/index.ts");
    expect(paths.some((p) => p.startsWith("dist/"))).toBe(false);
  });
});
