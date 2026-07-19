import type { RepositoryModel } from "@rvs/repository-model";
import type { WorkspacePackage } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed, derived } from "../inference.js";
import { componentId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { LogicalComponent, LogicalComponentKind, WorkflowFamily } from "../types.js";

const IGNORED_TOP_LEVEL = new Set(["node_modules", ".git", "dist", "build", ".rvs", "coverage", ".next", ".turbo"]);
// Raised from 12 alongside per-package (rather than per-top-level-directory)
// component synthesis: a monorepo can legitimately have more real,
// independently-evidenced components than a single-package repo ever could.
const MAX_CODE_COMPONENTS = 24;

// Generic, ecosystem-standard server-framework package names (not specific
// to any one repository) — a dependency on one of these is real evidence a
// package runs as a service, the same class of signal detectTechStack
// already uses dependency names for (framework detection).
const SERVICE_FRAMEWORK_DEPENDENCIES = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@nestjs/core",
  "restify",
  "django",
  "flask",
  "fastapi",
  "gin",
  "echo",
  "actix-web",
  "spring-boot",
];

function classifyDirectory(name: string): LogicalComponentKind {
  if (/^(cli|bin)$/i.test(name)) return "cli";
  if (/service|server|api|backend/i.test(name)) return "service";
  if (/infra|terraform|deploy/i.test(name)) return "infrastructure-module";
  if (/lib|packages|pkg|shared|common/i.test(name)) return "library";
  return "unknown";
}

function lastSegment(path: string): string {
  return path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
}

function classifyWorkspacePackage(pkg: WorkspacePackage): LogicalComponentKind {
  if (pkg.hasBinEntry) return "cli";
  if (pkg.dependencyNames.some((dep) => SERVICE_FRAMEWORK_DEPENDENCIES.includes(dep))) return "service";
  // Manifest-declared exports are stronger, direct evidence than a
  // name-substring match, so they take priority over the directory-name
  // heuristic below — e.g. a "terraform-graph" library package should not
  // be misclassified as infrastructure just because its name contains
  // "terraform".
  if (pkg.hasLibraryExport) return "library";
  const byDirectoryName = classifyDirectory(lastSegment(pkg.path));
  if (byDirectoryName !== "unknown") return byDirectoryName;
  return "unknown";
}

function buildWorkspacePackageComponent(pkg: WorkspacePackage, samplePaths: string[]): LogicalComponent {
  const displayName = pkg.name ?? (pkg.path ? lastSegment(pkg.path) : "root");
  const manifestPath = pkg.path ? `${pkg.path}/${pkg.manifestFile}` : pkg.manifestFile;
  const sortedPaths = [...samplePaths].sort();
  return {
    id: componentId(pkg.path || "root"),
    label: normalizeLabel(displayName),
    kind: classifyWorkspacePackage(pkg),
    origin: "repository-directory" as const,
    description: confirmed(
      pkg.description ?? `Workspace package "${displayName}" (${pkg.manifestFile}) with ${samplePaths.length} scanned file${samplePaths.length === 1 ? "" : "s"}.`,
      [{ path: manifestPath }],
    ),
    sourcePaths: sortedPaths,
    evidence: [{ path: manifestPath }],
    implementation: {
      filePaths: sortedPaths,
      workflowGraphIds: [],
      terraformTopologyIds: [],
      entryPoints: pkg.binPaths,
    },
  };
}

function buildTopLevelDirectoryComponent(name: string, paths: string[]): LogicalComponent {
  const sortedPaths = [...paths].sort();
  return {
    id: componentId(name),
    label: normalizeLabel(name),
    kind: classifyDirectory(name),
    origin: "repository-directory" as const,
    description: confirmed(`${paths.length} scanned file${paths.length === 1 ? "" : "s"} under ${name}/.`, [{ path: sortedPaths[0] }]),
    sourcePaths: sortedPaths,
    evidence: [{ path: sortedPaths[0] }],
    implementation: {
      filePaths: sortedPaths,
      workflowGraphIds: [],
      terraformTopologyIds: [],
      entryPoints: [],
    },
  };
}

/**
 * Derives one component per real structural grouping backed by scanned file
 * paths — never a synthetic dependency edge. Every directory that declares
 * its own package manifest (workspace_packages, detected at scan time from
 * the full, untruncated file list) becomes its own component instead of
 * collapsing into its parent top-level directory; any sampled path not
 * covered by a workspace package still falls back to the previous top-level
 * directory grouping, so a single-package repository behaves exactly as
 * before.
 */
export function buildComponentsFromRepository(model: RepositoryModel): LogicalComponent[] {
  const packages = model.workspace_packages ?? [];
  const pathsByPackage = new Map<string, string[]>();
  for (const pkg of packages) pathsByPackage.set(pkg.path, []);

  const uncovered: string[] = [];
  for (const path of model.files.sampledPaths) {
    // A root package (path "") only ever appears when detectWorkspacePackages
    // found no nested package to prefer over it (see that function's own
    // guard), so treating it as owning every otherwise-unmatched path here
    // can never dilute a real monorepo's per-package granularity — there is
    // never a nested package present alongside a root entry to compete with.
    const owningPackage = packages
      .filter((pkg) => pkg.path === "" || path === pkg.path || path.startsWith(`${pkg.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (owningPackage) {
      pathsByPackage.get(owningPackage.path)!.push(path);
    } else {
      uncovered.push(path);
    }
  }

  const packageComponents = packages
    .filter((pkg) => (pathsByPackage.get(pkg.path)?.length ?? 0) > 0)
    .map((pkg) => buildWorkspacePackageComponent(pkg, pathsByPackage.get(pkg.path)!));

  const byTopLevel = new Map<string, string[]>();
  for (const path of uncovered) {
    const top = path.split("/")[0];
    if (!top || IGNORED_TOP_LEVEL.has(top) || top.startsWith(".")) continue;
    const bucket = byTopLevel.get(top) ?? [];
    bucket.push(path);
    byTopLevel.set(top, bucket);
  }
  const topLevelComponents = [...byTopLevel.entries()].map(([name, paths]) => buildTopLevelDirectoryComponent(name, paths));

  const ranked = [...packageComponents, ...topLevelComponents].sort(
    (a, b) => b.sourcePaths.length - a.sourcePaths.length || a.id.localeCompare(b.id),
  );
  return ranked.slice(0, MAX_CODE_COMPONENTS);
}

export function buildComponentsFromTerraform(topologies: TerraformTopology[]): LogicalComponent[] {
  return [...topologies]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((topology) => ({
      id: componentId(`terraform:${topology.rootModulePath}`),
      label: normalizeLabel(topology.name),
      kind: "infrastructure-module" as const,
      origin: "terraform-module" as const,
      description: confirmed(
        `Terraform module with ${topology.metadata.resourceCount} resource${topology.metadata.resourceCount === 1 ? "" : "s"} across ${topology.metadata.moduleCount} module${topology.metadata.moduleCount === 1 ? "" : "s"}.`,
        [{ path: topology.rootModulePath }],
      ),
      sourcePaths: [topology.rootModulePath],
      evidence: topology.evidence,
      implementation: {
        filePaths: [topology.rootModulePath],
        workflowGraphIds: [],
        terraformTopologyIds: [topology.id],
        entryPoints: [],
      },
    }));
}

export function buildComponentsFromWorkflowFamilies(families: WorkflowFamily[]): LogicalComponent[] {
  return families.map((family) => ({
    id: componentId(`workflow-family:${family.label.sourceLabel}`),
    label: family.label,
    kind: "workflow-automation" as const,
    origin: "workflow-family" as const,
    description: derived(
      `Automation covering ${family.label.displayLabel.toLowerCase()}, spanning ${family.workflowGraphIds.length} workflow${family.workflowGraphIds.length === 1 ? "" : "s"}.`,
      [],
      "Derived by grouping WorkflowGraphs classified into this family.",
    ),
    sourcePaths: [],
    evidence: [],
    implementation: {
      filePaths: [],
      workflowGraphIds: family.workflowGraphIds,
      terraformTopologyIds: [],
      entryPoints: [],
    },
  }));
}
