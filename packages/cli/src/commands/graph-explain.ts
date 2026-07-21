import type { Logger } from "@rvs/core";
import { explainGraphId } from "@rvs/knowledge-graph";
import type { ChangePlanEntry, DecisionImpactEntry, ImpactResult, KnowledgeEdge, KnowledgeNode, RootCauseGroup } from "@rvs/knowledge-graph";
import { readGraphCachedJsonOptional } from "../graph-cache.js";

export async function runGraphExplainCommand(repoRoot: string, id: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  const nodes = readGraphCachedJsonOptional<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJsonOptional<KnowledgeEdge[]>(repoRoot, "edges.json");
  const impactResults = readGraphCachedJsonOptional<ImpactResult[]>(repoRoot, "impact-results.json");
  const rootCauseGroups = readGraphCachedJsonOptional<RootCauseGroup[]>(repoRoot, "root-cause-groups.json");
  const decisionImpacts = readGraphCachedJsonOptional<DecisionImpactEntry[]>(repoRoot, "decision-impact.json");
  const changePlan = readGraphCachedJsonOptional<ChangePlanEntry>(repoRoot, "change-plan.json");

  try {
    const { explanation } = explainGraphId(id, {
      nodes,
      edges,
      impactResults,
      rootCauseGroups,
      decisionImpacts,
      changePlans: changePlan ? [changePlan] : undefined,
    });
    logger.info(explanation);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
