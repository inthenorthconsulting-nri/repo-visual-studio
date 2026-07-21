import type { Logger } from "@rvs/core";
import { buildEdgeIndex, buildNodeId, collectCandidateEdges } from "@rvs/knowledge-graph";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { readGraphCachedJson } from "../graph-cache.js";

export function resolveNode(entityId: string, nodes: KnowledgeNode[]): KnowledgeNode {
  const byId = nodes.find((node) => node.id === entityId);
  if (byId) return byId;

  const candidateNodeId = buildNodeId(entityId);
  const byBuiltId = nodes.find((node) => node.id === candidateNodeId);
  if (byBuiltId) return byBuiltId;

  const bySourceEntityId = nodes.find((node) => node.source_entity_id === entityId);
  if (bySourceEntityId) return bySourceEntityId;

  throw new Error(`No knowledge graph node found for "${entityId}". Run \`rvs graph build\` first, or check the id with \`rvs graph explain <id>\`.`);
}

function describeEdge(edge: KnowledgeEdge, node: KnowledgeNode): string {
  const isOutgoing = edge.from_node_id === node.id;
  const other = isOutgoing ? edge.to_node_id : edge.from_node_id;
  const arrow = isOutgoing ? "->" : "<-";
  return `  ${arrow} [${edge.edge_type}] ${other} (${edge.resolution_status}) — ${edge.detail}`;
}

export async function runGraphInspectCommand(repoRoot: string, entityId: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");

  const node = resolveNode(entityId, nodes);
  const index = buildEdgeIndex(edges);
  const neighborEdges = collectCandidateEdges(node.id, "both", index);

  logger.info(`${node.id} (${node.node_type}, ${node.confidence}, ${node.resolution_status})`);
  logger.info(`  label: ${node.label}`);
  logger.info(`  source: ${node.source_artifact}:${node.source_entity_id}`);
  logger.info(`  repository: ${node.repository_id}`);
  logger.info(`  ${neighborEdges.length} adjacent edge(s):`);
  for (const edge of neighborEdges.sort((a, b) => a.id.localeCompare(b.id))) {
    logger.info(describeEdge(edge, node));
  }
}
