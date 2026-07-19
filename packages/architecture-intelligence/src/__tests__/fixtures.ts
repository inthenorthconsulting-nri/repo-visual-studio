import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";

export function makeRepositoryModel(overrides: Partial<RepositoryModel> = {}): RepositoryModel {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 3, commitsLast90Days: 12 },
    files: { total: 4, byExtension: { ".ts": 3, ".yml": 1 }, sampledPaths: ["packages/cli/src/bin.ts", "packages/core/src/index.ts", ".github/workflows/release.yml", "infra/main.tf"] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json" },
    workspace_packages: [],
    markdown_documents: [
      {
        path: "README.md",
        title: "sample-platform",
        leadParagraph: "sample-platform automates release governance for internal services.",
        sections: [
          { heading: "Current limitations", depth: 2, text: "No support for multi-region deployments yet.", startLine: 10, endLine: 12 },
        ],
      },
    ],
    ci_workflows: [{ path: ".github/workflows/release.yml" }],
    ...overrides,
  };
}

export function makeTerraformTopology(overrides: Partial<TerraformTopology> = {}): TerraformTopology {
  return {
    id: "terraform:root:infra",
    name: "infra",
    rootModulePath: "infra",
    providers: [
      {
        id: "terraform:provider:infra.aws",
        name: "aws",
        cloudProvider: "aws",
        modulePath: "infra",
        evidence: [{ path: "infra/main.tf", lines: "1-3" }],
      },
    ],
    modules: [],
    nodes: [
      {
        id: "terraform:resource:infra.aws_cloudwatch_log_group.app",
        type: "resource",
        label: "aws_cloudwatch_log_group.app",
        evidence: [{ path: "infra/main.tf", lines: "5-8" }],
        metadata: { resourceCategory: "observability" },
      },
    ],
    edges: [],
    variables: [],
    outputs: [],
    warnings: [],
    evidence: [{ path: "infra/main.tf" }],
    metadata: { moduleCount: 1, resourceCount: 1, dataSourceCount: 0, providerCount: 1, variableCount: 0, outputCount: 0, hasDynamicExpressions: false, hasExternalModules: false },
    ...overrides,
  };
}
