import type { Logger } from "@rvs/core";
import { groupRootCauses } from "@rvs/knowledge-graph";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { readGraphCachedJson, writeGraphOutputs } from "../graph-cache.js";

export async function runGraphRootsCommand(repoRoot: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");

  const rootCauseGroups = groupRootCauses(nodes, edges);
  writeGraphOutputs(repoRoot, { rootCauseGroups });

  if (rootCauseGroups.length === 0) {
    logger.info("No root-cause groups found among currently cached governance findings.");
    return;
  }

  logger.info(`${rootCauseGroups.length} root-cause group(s):`);
  for (const group of rootCauseGroups) {
    logger.info(
      `  [${group.classification}] ${group.finding_node_ids.length} finding(s) -> ${group.candidate_root_node_ids.length} candidate root(s) — ${group.detail}`,
    );
  }
}
