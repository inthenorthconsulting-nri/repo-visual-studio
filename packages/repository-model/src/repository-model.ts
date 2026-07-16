import { basename } from "node:path";
import type { RvsConfig } from "@rvs/core";
import { readGitSnapshot, type GitSnapshot } from "./git-adapter.js";
import { parseMarkdown, type ParsedMarkdownDocument } from "./markdown-adapter.js";
import { readTextFile, scanFiles, type FileInventory } from "./scan.js";
import { detectTechStack, type TechStack } from "./tech-stack.js";

export interface CiWorkflow {
  path: string;
}

export interface RepositoryModel {
  generated_at: string;
  repo_root: string;
  project_name: string;
  git: GitSnapshot;
  files: Omit<FileInventory, "files"> & { sampledPaths: string[] };
  tech_stack: TechStack;
  markdown_documents: ParsedMarkdownDocument[];
  ci_workflows: CiWorkflow[];
}

export async function buildRepositoryModel(
  repoRoot: string,
  config: RvsConfig,
): Promise<RepositoryModel> {
  const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
  const git = await readGitSnapshot(repoRoot);
  const techStack = detectTechStack(repoRoot, inventory);

  const markdownDocuments = inventory.files
    .filter((f) => f.extension === ".md")
    .map((f) => parseMarkdown(f.path, readTextFile(repoRoot, f.path)));

  const ciWorkflows = inventory.files
    .filter((f) => f.path.startsWith(".github/workflows/") && (f.extension === ".yml" || f.extension === ".yaml"))
    .map((f) => ({ path: f.path }));

  return {
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    project_name: config.project.name || basename(repoRoot),
    git,
    files: {
      total: inventory.total,
      byExtension: inventory.byExtension,
      sampledPaths: inventory.files.slice(0, 200).map((f) => f.path),
    },
    tech_stack: techStack,
    markdown_documents: markdownDocuments,
    ci_workflows: ciWorkflows,
  };
}
