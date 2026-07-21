import type { Logger } from "@rvs/core";
import { buildDecisionStateLookup, planChange } from "@rvs/knowledge-graph";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { ArchitectureDecision, DecisionAssumption } from "@rvs/decision-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphCachedJson, writeGraphOutputs } from "../graph-cache.js";
import { resolveNode } from "./graph-inspect.js";

export interface GraphPlanChangeOptions {
  remove?: string;
}

export async function runGraphPlanChangeCommand(repoRoot: string, opts: GraphPlanChangeOptions, logger: Logger): Promise<void> {
  if (!opts.remove) {
    throw new Error("`rvs graph plan-change` requires --remove <entity-id>.");
  }

  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");
  const node = resolveNode(opts.remove, nodes);

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);

  const plan = planChange(nodes, edges, node.id, decisionStateLookup);

  logger.info(`Change plan for removing ${node.id}:`);
  logger.info(`  ${plan.affected_node_ids.length} node(s) affected.`);
  logger.info(`  ${plan.decisions_requiring_review.length} decision(s) requiring review, ${plan.governance_requiring_review.length} governance item(s) requiring review.`);
  logger.info(
    `  tests likely affected: ${plan.tests_likely_affected.length}, docs likely affected: ${plan.docs_likely_affected.length}, ` +
      `presentation likely affected: ${plan.presentation_likely_affected.length}.`,
  );
  logger.info(`  baselines requiring review: ${plan.baselines_requiring_review.length}, unknown consumers: ${plan.unknown_consumers.length}.`);
  if (plan.suggested_validation_commands.length > 0) {
    logger.info(`  suggested validation commands: ${plan.suggested_validation_commands.join(", ")}`);
  }

  writeGraphOutputs(repoRoot, { changePlan: plan });
}
