import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { buildTopologyScenes } from "@rvs/narrative-planner";
import {
  buildTerraformSceneSubgraphs,
  buildTerraformTopology,
  classifyRootModules,
  discoverTerraformFiles,
  groupIntoDirectories,
  validateTerraformTopologyStructure,
  type TerraformDirectory,
  type TerraformTopology,
  type TerraformTopologyWarning,
} from "@rvs/terraform-graph";
import { renderTerraformMermaid } from "@rvs/terraform-mermaid";
import { renderTerraformSvg } from "@rvs/terraform-svg";
import {
  checkTerraformLayoutOverlap,
  checkTerraformLayoutTextOverflow,
  checkTerraformMissingEvidence,
  checkTerraformRendererDivergence,
} from "@rvs/validator";
import { cacheDir, readCachedJsonOptional } from "../cache.js";

export interface CreateTopologyOptions {
  source?: string;
  renderer?: "mermaid" | "svg" | "both";
  output?: string;
  all?: boolean;
  format?: "visualdoc";
}

const TERRAFORM_TOPOLOGIES_CACHE_FILE = "terraform-topologies.json";
const TOPOLOGY_DETAIL_LEVEL = "modules-and-key-resources" as const;

function normalizeSourceDir(source: string): string {
  const trimmed = source.replace(/^\.\/?/, "").replace(/\/+$/, "");
  return trimmed === "." ? "" : trimmed;
}

function rootName(repoRoot: string, relDir: string): string {
  return relDir === "" ? basename(repoRoot) : basename(relDir);
}

function logWarnings(logger: Logger, sourcePath: string, warnings: TerraformTopologyWarning[]): { errorCount: number; warningCount: number } {
  let errorCount = 0;
  let warningCount = 0;
  for (const warning of warnings) {
    if (warning.severity === "error") {
      logger.error(`[${sourcePath}] ${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else if (warning.severity === "warning") {
      logger.warn(`[${sourcePath}] ${warning.code}: ${warning.message}`);
      warningCount += 1;
    } else {
      logger.info(`[${sourcePath}] ${warning.code}: ${warning.message}`);
    }
  }
  return { errorCount, warningCount };
}

// `rvs create topology` mirrors `rvs create workflow`'s shape exactly:
// discover/parse -> structural validation -> Mermaid render -> SVG render ->
// layout/evidence/divergence checks, all in one command since it's the only
// step with every artifact in hand at once.
export async function runCreateTopology(
  repoRoot: string,
  opts: CreateTopologyOptions,
  logger: Logger,
): Promise<void> {
  const config = loadConfig(repoRoot);

  if (!opts.source && !opts.all) {
    throw new Error("Specify --source <path> (a single root module directory) or --all (every root module in the repository).");
  }

  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  if (directories.length === 0) {
    logger.warn("No Terraform (.tf) files found in the repository.");
    return;
  }

  let roots: TerraformDirectory[];
  if (opts.all) {
    ({ roots } = await classifyRootModules(repoRoot, directories));
  } else {
    const relDir = normalizeSourceDir(opts.source as string);
    const match = directories.find((d) => d.relDir === relDir);
    if (!match) {
      throw new Error(`No Terraform files found under root module directory: ${opts.source}`);
    }
    roots = [match];
  }
  if (roots.length === 0) {
    logger.warn("No root Terraform modules found (every candidate module directory is referenced as a child module).");
    return;
  }

  const renderer = opts.renderer ?? "both";
  const outputDir = resolve(repoRoot, opts.output ?? `${config.defaults.output_dir}/topologies`);
  mkdirSync(outputDir, { recursive: true });

  const topologies: TerraformTopology[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const root of roots) {
    const topology = await buildTerraformTopology(repoRoot, root.relDir, rootName(repoRoot, root.relDir), directories);

    const structuralIssues = validateTerraformTopologyStructure(topology);
    const structuralCounts = logWarnings(logger, root.relDir || ".", structuralIssues);
    errorCount += structuralCounts.errorCount;
    warningCount += structuralCounts.warningCount;
    const buildCounts = logWarnings(logger, root.relDir || ".", topology.warnings);
    errorCount += buildCounts.errorCount;
    warningCount += buildCounts.warningCount;

    const evidenceIssues = checkTerraformMissingEvidence(topology);
    const evidenceCounts = logWarnings(logger, root.relDir || ".", evidenceIssues);
    errorCount += evidenceCounts.errorCount;
    warningCount += evidenceCounts.warningCount;

    const splitWarnings: TerraformTopologyWarning[] = [];
    const parts = buildTerraformSceneSubgraphs(topology, TOPOLOGY_DETAIL_LEVEL, splitWarnings);
    const splitCounts = logWarnings(logger, root.relDir || ".", splitWarnings);
    warningCount += splitCounts.warningCount;

    const base = rootName(repoRoot, root.relDir);
    for (const part of parts) {
      const suffix = part.partCount > 1 ? `-part${part.partIndex + 1}-of-${part.partCount}` : "";

      let mermaid: string | undefined;
      let svgResult: ReturnType<typeof renderTerraformSvg> | undefined;

      if (renderer === "mermaid" || renderer === "both") {
        mermaid = renderTerraformMermaid(topology, part);
        writeFileSync(resolve(outputDir, `${base}${suffix}.mmd`), mermaid);
      }
      if (renderer === "svg" || renderer === "both") {
        svgResult = renderTerraformSvg(topology, part);
        writeFileSync(resolve(outputDir, `${base}${suffix}.svg`), svgResult.svg);
      }

      if (svgResult !== undefined) {
        const renderCheckWarnings: TerraformTopologyWarning[] = [
          ...checkTerraformLayoutOverlap(svgResult.layout, root.relDir || "."),
          ...checkTerraformLayoutTextOverflow(part.nodes, svgResult.layout),
        ];
        if (mermaid !== undefined) {
          renderCheckWarnings.push(...checkTerraformRendererDivergence(mermaid, svgResult.svg, root.relDir || "."));
        }
        const renderCounts = logWarnings(logger, root.relDir || ".", renderCheckWarnings);
        errorCount += renderCounts.errorCount;
        warningCount += renderCounts.warningCount;
      }
    }

    if (opts.format === "visualdoc") {
      let sceneCounter = 0;
      const nextId = () => `scene-${(sceneCounter += 1)}`;
      const doc = {
        version: 1 as const,
        document: {
          type: "presentation" as const,
          title: `${topology.name} Terraform topology`,
          aspect_ratio: "16:9" as const,
          audience: "architecture-review",
          theme: config.defaults.design_system,
        },
        scenes: buildTopologyScenes(topology, nextId),
      };
      writeFileSync(resolve(outputDir, `${base}.visualdoc.json`), JSON.stringify(doc, null, 2));
    }

    topologies.push(topology);
  }

  // `--all` re-discovers the full set each run, so the cache is fully
  // replaced (a deleted root module should disappear from it too). A single
  // `--source` run instead upserts by rootModulePath, leaving other
  // previously-cached topologies untouched.
  let cachedTopologies: TerraformTopology[];
  if (opts.all) {
    cachedTopologies = topologies;
  } else {
    const existing = readCachedJsonOptional<TerraformTopology[]>(repoRoot, TERRAFORM_TOPOLOGIES_CACHE_FILE) ?? [];
    const byRootModulePath = new Map(existing.map((t) => [t.rootModulePath, t]));
    for (const t of topologies) byRootModulePath.set(t.rootModulePath, t);
    cachedTopologies = [...byRootModulePath.values()].sort((a, b) => a.rootModulePath.localeCompare(b.rootModulePath));
  }
  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), TERRAFORM_TOPOLOGIES_CACHE_FILE), JSON.stringify(cachedTopologies, null, 2));

  logger.info(
    `Parsed ${topologies.length} root Terraform module(s) (${errorCount} error(s), ${warningCount} warning(s)); wrote "${renderer}" output to ${opts.output ?? `${config.defaults.output_dir}/topologies`}.`,
  );
  logger.info(`Cached ${cachedTopologies.length} Terraform topolog${cachedTopologies.length === 1 ? "y" : "ies"} to .rvs/cache/${TERRAFORM_TOPOLOGIES_CACHE_FILE}`);
}
