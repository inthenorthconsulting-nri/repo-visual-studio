import type { RepositoryModel, WorkspacePackage } from "@rvs/repository-model";
import { describe, expect, it } from "vitest";
import { buildComponentsFromRepository } from "../synthesize/components.js";

function makePackage(overrides: Partial<WorkspacePackage> & { path: string }): WorkspacePackage {
  return {
    manifestFile: "package.json",
    hasBinEntry: false,
    binPaths: [],
    dependencyNames: [],
    hasLibraryExport: false,
    ...overrides,
  };
}

function makeModel(overrides: Partial<RepositoryModel> = {}): RepositoryModel {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 1, commitsLast90Days: 1 },
    files: { total: 0, byExtension: {}, sampledPaths: [] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: [], manifestFile: "package.json" },
    workspace_packages: [],
    markdown_documents: [],
    ci_workflows: [],
    ...overrides,
  };
}

describe("buildComponentsFromRepository", () => {
  it("classifies a workspace package with a bin entry as a cli component", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "packages/cli-tool", hasBinEntry: true, binPaths: ["packages/cli-tool/bin.js"] })],
      files: { total: 1, byExtension: { ".js": 1 }, sampledPaths: ["packages/cli-tool/bin.js"] },
    });
    const components = buildComponentsFromRepository(model);
    const cli = components.find((c) => c.sourcePaths.includes("packages/cli-tool/bin.js"));
    expect(cli?.kind).toBe("cli");
    expect(cli?.implementation.entryPoints).toEqual(["packages/cli-tool/bin.js"]);
  });

  it("classifies a workspace package with a server-framework dependency as a service component", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "packages/api-server", dependencyNames: ["express"] })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["packages/api-server/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    const service = components.find((c) => c.sourcePaths.includes("packages/api-server/index.ts"));
    expect(service?.kind).toBe("service");
  });

  it("falls back to directory-name classification when no bin/dependency signal is present", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "packages/shared-lib" })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["packages/shared-lib/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    const lib = components.find((c) => c.sourcePaths.includes("packages/shared-lib/index.ts"));
    expect(lib?.kind).toBe("library");
  });

  it("falls back to hasLibraryExport when the directory name gives no signal", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "modules/widgets", hasLibraryExport: true })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["modules/widgets/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    const widgets = components.find((c) => c.sourcePaths.includes("modules/widgets/index.ts"));
    expect(widgets?.kind).toBe("library");
  });

  it("prefers manifest-declared hasLibraryExport over a misleading directory-name match", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "packages/terraform-graph", hasLibraryExport: true })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["packages/terraform-graph/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    const pkg = components.find((c) => c.sourcePaths.includes("packages/terraform-graph/index.ts"));
    expect(pkg?.kind).toBe("library");
  });

  it("classifies as unknown when no signal (bin, dependency, directory name, library export) is present", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "modules/widgets" })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["modules/widgets/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    const widgets = components.find((c) => c.sourcePaths.includes("modules/widgets/index.ts"));
    expect(widgets?.kind).toBe("unknown");
  });

  it("classifies a root-level workspace package (path \"\") with a bin entry as a cli component and attributes every sampled path to it", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "", name: "root-cli", hasBinEntry: true, binPaths: ["bin/cli.js"] })],
      files: { total: 2, byExtension: { ".ts": 1, ".js": 1 }, sampledPaths: ["src/index.ts", "bin/cli.js"] },
    });
    const components = buildComponentsFromRepository(model);
    expect(components).toHaveLength(1);
    expect(components[0]?.kind).toBe("cli");
    expect(components[0]?.label.sourceLabel).toBe("root-cli");
    expect(components[0]?.sourcePaths).toEqual(["bin/cli.js", "src/index.ts"]);
    expect(components[0]?.implementation.entryPoints).toEqual(["bin/cli.js"]);
  });

  it("groups every sampled path under the deepest owning workspace package, not a shallower ancestor", () => {
    const model = makeModel({
      workspace_packages: [
        makePackage({ path: "packages/api", dependencyNames: ["express"] }),
        makePackage({ path: "packages/api/plugins/auth" }),
      ],
      files: {
        total: 2,
        byExtension: { ".ts": 2 },
        sampledPaths: ["packages/api/index.ts", "packages/api/plugins/auth/index.ts"],
      },
    });
    const components = buildComponentsFromRepository(model);
    const auth = components.find((c) => c.sourcePaths.includes("packages/api/plugins/auth/index.ts"));
    const api = components.find((c) => c.sourcePaths.includes("packages/api/index.ts"));
    expect(auth?.sourcePaths).toEqual(["packages/api/plugins/auth/index.ts"]);
    expect(api?.sourcePaths).toEqual(["packages/api/index.ts"]);
  });

  it("falls back to top-level directory grouping for sampled paths not covered by any workspace package", () => {
    const model = makeModel({
      workspace_packages: [],
      files: { total: 2, byExtension: { ".ts": 2 }, sampledPaths: ["packages/foo/index.ts", "packages/bar/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    expect(components).toHaveLength(1);
    expect(components[0]?.label.sourceLabel).toBe("packages");
    expect(components[0]?.sourcePaths).toEqual(["packages/bar/index.ts", "packages/foo/index.ts"]);
  });

  it("omits a workspace package component entirely when no sampled path falls under it", () => {
    const model = makeModel({
      workspace_packages: [makePackage({ path: "packages/unsampled" }), makePackage({ path: "packages/api", dependencyNames: ["express"] })],
      files: { total: 1, byExtension: { ".ts": 1 }, sampledPaths: ["packages/api/index.ts"] },
    });
    const components = buildComponentsFromRepository(model);
    expect(components.some((c) => c.id.includes("unsampled"))).toBe(false);
  });

  it("is deterministic across two independent builds of the same model", () => {
    const model = makeModel({
      workspace_packages: [
        makePackage({ path: "packages/cli-tool", hasBinEntry: true, binPaths: ["packages/cli-tool/bin.js"] }),
        makePackage({ path: "packages/api-server", dependencyNames: ["express"] }),
      ],
      files: {
        total: 2,
        byExtension: { ".js": 1, ".ts": 1 },
        sampledPaths: ["packages/cli-tool/bin.js", "packages/api-server/index.ts"],
      },
    });
    expect(buildComponentsFromRepository(model)).toEqual(buildComponentsFromRepository(model));
  });
});
