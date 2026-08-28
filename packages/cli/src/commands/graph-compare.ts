import type { Logger } from "@rvs/core";
import { buildDecisionStateLookup } from "@rvs/knowledge-graph";
import type { DecisionAssumption } from "@rvs/decision-intelligence";
import type { ArchitectureDecision } from "@rvs/decision-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import { diffGraphs } from "@rvs/knowledge-graph";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphSnapshotDir } from "../snapshot-dir.js";
import { writeGraphOutputs } from "../graph-cache.js";
import { runGraphBuild } from "./graph-build.js";

export interface GraphCompareOptions {
  from?: string;
  to?: string;
}

export async function runGraphCompareCommand(repoRoot: string, opts: GraphCompareOptions, logger: Logger): Promise<void> {
  if (!opts.from) {
    throw new Error("`rvs graph compare` requires --from <snapshot-dir>.");
  }

  const source = readGraphSnapshotDir(repoRoot, opts.from);
  const target = opts.to
    ? readGraphSnapshotDir(repoRoot, opts.to)
    : await (async () => {
        const built = await runGraphBuild(repoRoot, logger);
        return { snapshotId: built.buildResult.snapshot.id, nodes: built.buildResult.nodes, edges: built.buildResult.edges };
      })();

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);

  const changeSet = diffGraphs(source, target, { decisionStateLookup });

  logger.info(`Graph diff ${changeSet.source_snapshot_id} -> ${changeSet.target_snapshot_id}:`);
  logger.info(`  nodes: +${changeSet.nodes_added.length} / -${changeSet.nodes_removed.length}`);
  logger.info(`  edges: +${changeSet.edges_added.length} / -${changeSet.edges_removed.length}`);
  logger.info(
    `  entity types changed: ${changeSet.entity_types_changed.length}, relationships changed: ${changeSet.relationships_changed.length}, ` +
      `new orphans: ${changeSet.new_orphans.length}, new cycles: ${changeSet.new_cycles.length}`,
  );
  logger.info(
    `  root causes introduced: ${changeSet.root_causes_introduced.length}, resolved: ${changeSet.root_causes_resolved.length}, ` +
      `decision dependencies changed: ${changeSet.decision_dependencies_changed.length}, governance reach changed: ${changeSet.governance_reach_changed.length}`,
  );

  writeGraphOutputs(repoRoot, { graphChanges: changeSet });
}
