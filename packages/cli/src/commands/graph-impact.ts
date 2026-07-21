import type { Logger } from "@rvs/core";
import {
  DEFAULT_MAX_TRAVERSAL_DEPTH,
  buildDecisionStateLookup,
  computeDecisionImpact,
  runImpactAnalysis,
  validateImpactQuery,
} from "@rvs/knowledge-graph";
import type { ArchitectureDecision, DecisionAssumption } from "@rvs/decision-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type {
  DecisionImpactEntry,
  ImpactQuery,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeEdgeType,
  KnowledgeNode,
  TraversalDirection,
} from "@rvs/knowledge-graph";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphCachedJson, readGraphCachedJsonOptional } from "../graph-cache.js";
import { writeGraphOutputs } from "../graph-cache.js";
import { resolveNode } from "./graph-inspect.js";

export interface GraphImpactOptions {
  maxDepth?: string;
  edgeType?: string[];
  direction?: string;
}

function parseDirection(value: string | undefined): TraversalDirection {
  if (value === "upstream" || value === "downstream" || value === "both") return value;
  if (value === undefined) return "downstream";
  throw new Error(`Invalid --direction "${value}". Expected one of: upstream, downstream, both.`);
}

export async function runGraphImpactCommand(repoRoot: string, entityId: string, opts: GraphImpactOptions, logger: Logger): Promise<void> {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");
  const node = resolveNode(entityId, nodes);

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);

  const query: ImpactQuery = {
    entity_node_id: node.id,
    max_depth: opts.maxDepth !== undefined ? Number(opts.maxDepth) : DEFAULT_MAX_TRAVERSAL_DEPTH,
    allowed_edge_types: opts.edgeType && opts.edgeType.length > 0 ? (opts.edgeType as KnowledgeEdgeType[]) : undefined,
    direction: parseDirection(opts.direction),
  };

  const queryFindings = validateImpactQuery(query);
  const blockingQueryFindings = queryFindings.filter((finding) => finding.blocking);
  if (blockingQueryFindings.length > 0) {
    throw new Error(`Invalid impact query: ${blockingQueryFindings.map((finding) => finding.message).join("; ")}`);
  }

  const result = runImpactAnalysis(nodes, edges, query, decisionStateLookup);

  logger.info(
    `Impact of ${node.id}: ${result.directly_affected.length} direct, ${result.transitively_affected.length} transitive, ` +
      `blast radius "${result.blast_radius_level}"${result.truncated ? " (truncated)" : ""}.`,
  );
  logger.info(
    `  products: ${result.products_affected.length}, capabilities: ${result.capabilities_affected.length}, ` +
      `decisions: ${result.decisions_affected.length}, governance findings: ${result.governance_findings_affected.length}, ` +
      `assumptions potentially invalidated: ${result.assumptions_potentially_invalidated.length}.`,
  );
  if (result.unresolved_downstream_impact) {
    logger.warn("  Impact analysis reached an unresolved reference — downstream impact may be incomplete.");
  }

  const existingImpactResults = readGraphCachedJsonOptional<ImpactResult[]>(repoRoot, "impact-results.json") ?? [];

  const decisionImpactEntries = computeDecisionImpact(nodes, edges, node.id, decisionStateLookup);
  const existingDecisionImpact = readGraphCachedJsonOptional<DecisionImpactEntry[]>(repoRoot, "decision-impact.json") ?? [];
  const decisionImpactById = new Map(existingDecisionImpact.map((entry) => [entry.id, entry]));
  for (const entry of decisionImpactEntries) decisionImpactById.set(entry.id, entry);

  writeGraphOutputs(repoRoot, {
    impactResults: [...existingImpactResults, result],
    decisionImpact: Array.from(decisionImpactById.values()).sort((a, b) => a.id.localeCompare(b.id)),
  });
}
