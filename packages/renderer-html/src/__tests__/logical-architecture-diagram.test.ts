import { synthesizeArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { renderLogicalArchitecture } from "../scenes/architecture-intelligence/diagrams.js";

const RELEASE_WORKFLOW = `
name: Release Governance
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: npm run release
`;

function buildRepositoryModel(): RepositoryModel {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 3, commitsLast90Days: 12 },
    files: { total: 4, byExtension: { ".ts": 3, ".yml": 1 }, sampledPaths: ["packages/cli/src/bin.ts", "packages/core/src/index.ts", ".github/workflows/release.yml", "infra/main.tf"] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json" },
    markdown_documents: [
      { path: "README.md", title: "sample-platform", leadParagraph: "sample-platform automates release governance for internal services.", sections: [] },
    ],
    ci_workflows: [{ path: ".github/workflows/release.yml" }],
  };
}

function buildTerraformTopology(): TerraformTopology {
  return {
    id: "terraform:root:infra",
    name: "infra",
    rootModulePath: "infra",
    providers: [],
    modules: [],
    nodes: [],
    edges: [],
    variables: [],
    outputs: [],
    warnings: [],
    evidence: [{ path: "infra/main.tf" }],
    metadata: { moduleCount: 1, resourceCount: 1, dataSourceCount: 0, providerCount: 1, variableCount: 0, outputCount: 0, hasDynamicExpressions: false, hasExternalModules: false },
  };
}

const SCENE: ArchitectureIntelligenceScene = {
  id: "scene-logical-architecture",
  type: "architecture-intelligence",
  headline: "Test headline",
  evidence: [],
  artifact_id: "arch:identity:sample-platform",
  kind: "logical-architecture",
  focus_ids: [],
};

describe("renderLogicalArchitecture", () => {
  it("excludes repository-directory-origin components when architectural components exist", () => {
    const model = buildRepositoryModel();
    const { graph } = parseWorkflowText(RELEASE_WORKFLOW, ".github/workflows/release.yml");
    const artifact = synthesizeArchitectureIntelligence({
      model,
      workflowGraphs: [graph],
      terraformTopologies: [buildTerraformTopology()],
      gitCommit: model.git.commit,
      generatedAt: "2026-07-01T00:00:00.000Z",
    });

    // Sanity: the fixture actually produces a repository-directory component
    // (from the top-level "packages/" grouping) so this test would be
    // vacuous if it didn't.
    expect(artifact.components.some((c) => c.origin === "repository-directory" && c.label.sourceLabel === "packages")).toBe(true);

    const html = renderLogicalArchitecture(SCENE, artifact);
    expect(html).not.toContain("Packages");
    expect((html.match(/class="architecture-node"/g) ?? []).length).toBe(
      artifact.components.filter((c) => c.origin !== "repository-directory").length,
    );
  });

  it("falls back to showing repository-directory components when no other origin exists", () => {
    const model = buildRepositoryModel();
    const artifact = synthesizeArchitectureIntelligence({
      model,
      workflowGraphs: [],
      terraformTopologies: [],
      gitCommit: model.git.commit,
      generatedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(artifact.components.every((c) => c.origin === "repository-directory")).toBe(true);
    const html = renderLogicalArchitecture(SCENE, artifact);
    expect(html).toContain("Packages");
  });
});
