import { basename } from "node:path";
import type { RvsConfig } from "@rvs/core";
import { readGitSnapshot, type GitSnapshot } from "./git-adapter.js";
import { parseMarkdown, type ParsedMarkdownDocument } from "./markdown-adapter.js";
import { readTextFile, scanFiles, type FileInventory, type ScannedFile } from "./scan.js";
import { detectTechStack, type TechStack } from "./tech-stack.js";
import { detectWorkspacePackages, type WorkspacePackage } from "./workspace-packages.js";

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
  /** Every nested directory with its own package manifest (excludes the repo root itself). Empty for a single-package repository. */
  workspace_packages: WorkspacePackage[];
  markdown_documents: ParsedMarkdownDocument[];
  ci_workflows: CiWorkflow[];
}

// Sampled paths feed every downstream consumer that needs "real file paths"
// but not the full inventory (architecture component synthesis, monorepo
// detection). A flat alphabetical prefix silently starves every directory
// that doesn't sort first — for a repo with many sibling packages, one
// early-alphabetical package can consume the entire budget. Round-robin by
// grouping key instead, so every workspace package (and every other
// top-level directory) gets proportional representation regardless of name.
// Raised from 200 to 400: cheap for typical repos (most fit entirely under
// 400 and this is a no-op), and gives monorepos with many packages a
// meaningfully larger per-package sample before the round-robin has to
// start truncating any single group.
const SAMPLED_PATHS_CAP = 400;

function groupKeyFor(path: string, packageRoots: string[]): string {
  let best: string | undefined;
  for (const root of packageRoots) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (best === undefined || root.length > best.length) best = root;
    }
  }
  if (best !== undefined) return best;
  return path.includes("/") ? path.slice(0, path.indexOf("/")) : path;
}

function sampleFilePaths(files: ScannedFile[], packageRoots: string[], cap: number): string[] {
  if (files.length <= cap) return files.map((f) => f.path);

  const groups = new Map<string, ScannedFile[]>();
  for (const file of files) {
    const key = groupKeyFor(file.path, packageRoots);
    const bucket = groups.get(key) ?? [];
    bucket.push(file);
    groups.set(key, bucket);
  }
  const groupArrays = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);

  const sampled: string[] = [];
  let round = 0;
  while (sampled.length < cap && groupArrays.some((g) => round < g.length)) {
    for (const group of groupArrays) {
      if (sampled.length >= cap) break;
      if (round < group.length) sampled.push(group[round].path);
    }
    round += 1;
  }
  return sampled.sort();
}

export async function buildRepositoryModel(
  repoRoot: string,
  config: RvsConfig,
): Promise<RepositoryModel> {
  const inventory = await scanFiles(repoRoot, config.sources.include, config.sources.exclude);
  const git = await readGitSnapshot(repoRoot);
  const techStack = detectTechStack(repoRoot, inventory);
  const workspacePackages = detectWorkspacePackages(repoRoot, inventory);

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
      sampledPaths: sampleFilePaths(
        inventory.files,
        workspacePackages.map((p) => p.path),
        SAMPLED_PATHS_CAP,
      ),
    },
    tech_stack: techStack,
    workspace_packages: workspacePackages,
    markdown_documents: markdownDocuments,
    ci_workflows: ciWorkflows,
  };
}
