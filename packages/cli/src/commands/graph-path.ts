import type { Logger } from "@rvs/core";
import {
  DEFAULT_MAX_ALL_PATHS_DEPTH,
  DEFAULT_MAX_TRAVERSAL_DEPTH,
  findAllPaths,
  findShortestPath,
  validatePathQuery,
} from "@rvs/knowledge-graph";
import type { KnowledgeEdge, KnowledgeEdgeType, KnowledgeNode, TraversalDirection } from "@rvs/knowledge-graph";
import { readGraphCachedJson } from "../graph-cache.js";
import { resolveNode } from "./graph-inspect.js";

export interface GraphPathOptions {
  all?: boolean;
  maxDepth?: string;
  edgeType?: string[];
  direction?: string;
}

function parseDirection(value: string | undefined): TraversalDirection {
  if (value === "upstream" || value === "downstream" || value === "both") return value;
  if (value === undefined) return "downstream";
  throw new Error(`Invalid --direction "${value}". Expected one of: upstream, downstream, both.`);
}

export async function runGraphPathCommand(
  repoRoot: string,
  fromEntityId: string,
  toEntityId: string,
  opts: GraphPathOptions,
  logger: Logger,
): Promise<void> {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");
  const fromNode = resolveNode(fromEntityId, nodes);
  const toNode = resolveNode(toEntityId, nodes);

  const allPaths = Boolean(opts.all);
  const options = {
    maxDepth: opts.maxDepth !== undefined ? Number(opts.maxDepth) : allPaths ? DEFAULT_MAX_ALL_PATHS_DEPTH : DEFAULT_MAX_TRAVERSAL_DEPTH,
    allowedEdgeTypes: opts.edgeType && opts.edgeType.length > 0 ? (opts.edgeType as KnowledgeEdgeType[]) : undefined,
    direction: parseDirection(opts.direction),
  };

  const queryFindings = validatePathQuery(fromNode.id, toNode.id, options, allPaths);
  const blockingQueryFindings = queryFindings.filter((finding) => finding.blocking);
  if (blockingQueryFindings.length > 0) {
    throw new Error(`Invalid path query: ${blockingQueryFindings.map((finding) => finding.message).join("; ")}`);
  }

  if (allPaths) {
    const result = findAllPaths(nodes, edges, fromNode.id, toNode.id, options);
    logger.info(`${result.paths.length} path(s) from ${fromNode.id} to ${toNode.id}${result.truncated ? " (truncated)" : ""}:`);
    for (const path of result.paths) {
      logger.info(`  [${path.length}] ${path.node_ids.join(" -> ")}`);
    }
    return;
  }

  const path = findShortestPath(nodes, edges, fromNode.id, toNode.id, options);
  if (!path) {
    logger.info(`No path found from ${fromNode.id} to ${toNode.id} within max depth ${options.maxDepth}.`);
    return;
  }
  logger.info(`Shortest path (length ${path.length}) from ${fromNode.id} to ${toNode.id}:`);
  logger.info(`  ${path.node_ids.join(" -> ")}`);
}
