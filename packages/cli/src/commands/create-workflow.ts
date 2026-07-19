import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { buildWorkflowScenes } from "@rvs/narrative-planner";
import { runWorkflowChecks } from "@rvs/validator";
import {
  discoverWorkflowFiles,
  parseWorkflowText,
  selectSceneSubgraph,
  validateGraphStructure,
  type WorkflowGraph,
} from "@rvs/workflow-graph";
import { renderWorkflowMermaid } from "@rvs/workflow-mermaid";
import { renderWorkflowSvg } from "@rvs/workflow-svg";
import { cacheDir, readCachedJsonOptional } from "../cache.js";

export interface CreateWorkflowOptions {
  source?: string;
  renderer?: "mermaid" | "svg" | "both";
  output?: string;
  all?: boolean;
  format?: "visualdoc";
}

const WORKFLOW_GRAPHS_CACHE_FILE = "workflow-graphs.json";

function sceneBaseName(sourcePath: string): string {
  return basename(sourcePath).replace(/\.ya?ml$/, "");
}

// `rvs create workflow` is the one place all of graph-parse -> structural
// validation -> Mermaid render -> SVG render -> layout/evidence/divergence
// checks happen together, since it's the only step with every artifact
// (graph, computed layout, both renderers' output text) in hand at once.
// `rvs validate` stays deck.html/Playwright-focused; this command reports
// workflow-specific findings inline instead of duplicating that DOM pass.
export async function runCreateWorkflow(
  repoRoot: string,
  opts: CreateWorkflowOptions,
  logger: Logger,
): Promise<void> {
  const config = loadConfig(repoRoot);

  if (!opts.source && !opts.all) {
    throw new Error("Specify --source <path> (a single workflow file) or --all (every .github/workflows/* file).");
  }

  const relPaths = opts.all ? await discoverWorkflowFiles(repoRoot) : [opts.source as string];
  if (relPaths.length === 0) {
    logger.warn("No GitHub Actions workflow files found under .github/workflows/.");
    return;
  }

  const renderer = opts.renderer ?? "both";
  const outputDir = resolve(repoRoot, opts.output ?? `${config.defaults.output_dir}/workflows`);
  mkdirSync(outputDir, { recursive: true });

  const graphs: WorkflowGraph[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const relPath of relPaths) {
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) {
      throw new Error(`Workflow source not found: ${relPath}`);
    }

    let graph: WorkflowGraph;
    try {
      const text = readFileSync(absPath, "utf8");
      ({ graph } = parseWorkflowText(text, relPath));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.all) {
        logger.error(`Skipping ${relPath}: ${message}`);
        errorCount += 1;
        continue;
      }
      throw err;
    }

    for (const issue of validateGraphStructure(graph)) {
      if (issue.severity === "error") {
        logger.error(`[${relPath}] ${issue.code}: ${issue.message}`);
        errorCount += 1;
      } else {
        logger.warn(`[${relPath}] ${issue.code}: ${issue.message}`);
        warningCount += 1;
      }
    }

    const base = sceneBaseName(relPath);
    let mermaid: string | undefined;
    let svgResult: ReturnType<typeof renderWorkflowSvg> | undefined;

    if (renderer === "mermaid" || renderer === "both") {
      mermaid = renderWorkflowMermaid(graph);
      writeFileSync(resolve(outputDir, `${base}.mmd`), mermaid);
    }
    if (renderer === "svg" || renderer === "both") {
      svgResult = renderWorkflowSvg(graph);
      writeFileSync(resolve(outputDir, `${base}.svg`), svgResult.svg);
    }

    if (mermaid !== undefined && svgResult !== undefined) {
      const detailLevel = "jobs" as const;
      const { nodes: selectedNodes } = selectSceneSubgraph(graph, detailLevel);
      const checkWarnings = runWorkflowChecks({
        graph,
        detailLevel,
        selectedNodes,
        layout: svgResult.layout,
        mermaid,
        svg: svgResult.svg,
      });
      for (const warning of checkWarnings) {
        if (warning.severity === "error") {
          logger.error(`[${relPath}] ${warning.code}: ${warning.message}`);
          errorCount += 1;
        } else {
          logger.warn(`[${relPath}] ${warning.code}: ${warning.message}`);
          warningCount += 1;
        }
      }
    }

    if (opts.format === "visualdoc") {
      let sceneCounter = 0;
      const nextId = () => `scene-${(sceneCounter += 1)}`;
      const doc = {
        version: 1 as const,
        document: {
          type: "presentation" as const,
          title: `${graph.name} workflow`,
          aspect_ratio: "16:9" as const,
          audience: "architecture-review",
          theme: config.defaults.design_system,
        },
        scenes: buildWorkflowScenes(graph, nextId),
      };
      writeFileSync(resolve(outputDir, `${base}.visualdoc.json`), JSON.stringify(doc, null, 2));
    }

    graphs.push(graph);
  }

  // `--all` re-discovers the full set each run, so the cache is fully
  // replaced (a deleted workflow file should disappear from it too).
  // A single `--source` run instead upserts by sourcePath, leaving other
  // previously-cached graphs untouched.
  let cachedGraphs: WorkflowGraph[];
  if (opts.all) {
    // Sorted explicitly rather than relying on discoverWorkflowFiles()'s
    // internal path sort to keep the cache alphabetical (matching the
    // `--source` branch below, and create-topology.ts's equivalent branch).
    cachedGraphs = [...graphs].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  } else {
    const existing = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, WORKFLOW_GRAPHS_CACHE_FILE) ?? [];
    const bySourcePath = new Map(existing.map((g) => [g.sourcePath, g]));
    for (const g of graphs) bySourcePath.set(g.sourcePath, g);
    cachedGraphs = [...bySourcePath.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  }
  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), WORKFLOW_GRAPHS_CACHE_FILE), JSON.stringify(cachedGraphs, null, 2));

  logger.info(
    `Parsed ${graphs.length} workflow(s) (${errorCount} error(s), ${warningCount} warning(s)); wrote "${renderer}" output to ${opts.output ?? `${config.defaults.output_dir}/workflows`}.`,
  );
  logger.info(`Cached ${cachedGraphs.length} workflow graph(s) to .rvs/cache/${WORKFLOW_GRAPHS_CACHE_FILE}`);
}
