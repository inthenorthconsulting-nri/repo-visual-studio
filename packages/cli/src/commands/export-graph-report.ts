import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { KNOWLEDGE_GRAPH_OUTPUT_FILES } from "@rvs/knowledge-graph";
import { readGraphCachedJson } from "../graph-cache.js";
import type { GraphReport } from "./graph-build.js";

export interface ExportGraphReportOptions {
  output?: string;
}

export async function runExportGraphReport(repoRoot: string, opts: ExportGraphReportOptions, logger: Logger): Promise<void> {
  const report = readGraphCachedJson<GraphReport>(repoRoot, KNOWLEDGE_GRAPH_OUTPUT_FILES.graphReport);
  const outputPath = resolve(repoRoot, opts.output ?? "graph-report.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  logger.info(`Wrote ${outputPath} (${report.node_count} node(s), ${report.edge_count} edge(s), compatibility "${report.compatibility_status}").`);
}
