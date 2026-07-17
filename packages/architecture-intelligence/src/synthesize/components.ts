import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed, derived } from "../inference.js";
import { componentId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { LogicalComponent, LogicalComponentKind, WorkflowFamily } from "../types.js";

const IGNORED_TOP_LEVEL = new Set(["node_modules", ".git", "dist", "build", ".rvs", "coverage", ".next", ".turbo"]);
const MAX_CODE_COMPONENTS = 12;

function classifyDirectory(name: string): LogicalComponentKind {
  if (/^(cli|bin)$/i.test(name)) return "cli";
  if (/service|server|api|backend/i.test(name)) return "service";
  if (/infra|terraform|deploy/i.test(name)) return "infrastructure-module";
  if (/lib|packages|pkg|shared|common/i.test(name)) return "library";
  return "unknown";
}

/** Groups sampled file paths by top-level directory to derive one component per structural grouping — never a synthetic dependency edge, only a grouping backed by real file paths. */
export function buildComponentsFromRepository(model: RepositoryModel): LogicalComponent[] {
  const byTopLevel = new Map<string, string[]>();
  for (const path of model.files.sampledPaths) {
    const top = path.split("/")[0];
    if (!top || IGNORED_TOP_LEVEL.has(top) || top.startsWith(".")) continue;
    const bucket = byTopLevel.get(top) ?? [];
    bucket.push(path);
    byTopLevel.set(top, bucket);
  }

  const ranked = [...byTopLevel.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const selected = ranked.slice(0, MAX_CODE_COMPONENTS);

  return selected.map(([name, paths]) => {
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
  });
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
