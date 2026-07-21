import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { buildDecisionStateLookup } from "@rvs/knowledge-graph";
import type { DecisionAssumption } from "@rvs/decision-intelligence";
import type { ArchitectureDecision } from "@rvs/decision-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import { diffGraphs } from "@rvs/knowledge-graph";
import type { GraphSnapshot, GraphSnapshotState, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { writeGraphOutputs } from "../graph-cache.js";
import { runGraphBuild } from "./graph-build.js";

export interface GraphCompareOptions {
  from?: string;
  to?: string;
}

/**
 * Reads a previously-produced .rvs/cache/knowledge-graph/ directory (e.g. an
 * archived copy from a prior branch or commit) containing graph-snapshot.json,
 * nodes.json, and edges.json.
 */
function readSnapshotDir(repoRoot: string, dir: string): GraphSnapshotState {
  const absoluteDir = resolve(repoRoot, dir);
  const snapshotPath = resolve(absoluteDir, "graph-snapshot.json");
  const nodesPath = resolve(absoluteDir, "nodes.json");
  const edgesPath = resolve(absoluteDir, "edges.json");
  for (const path of [snapshotPath, nodesPath, edgesPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing "${path}". Expected a directory containing graph-snapshot.json, nodes.json, and edges.json.`);
    }
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as GraphSnapshot;
  const nodes = JSON.parse(readFileSync(nodesPath, "utf8")) as KnowledgeNode[];
  const edges = JSON.parse(readFileSync(edgesPath, "utf8")) as KnowledgeEdge[];
  return { snapshotId: snapshot.id, nodes, edges };
}

export async function runGraphCompareCommand(repoRoot: string, opts: GraphCompareOptions, logger: Logger): Promise<void> {
  if (!opts.from) {
    throw new Error("`rvs graph compare` requires --from <snapshot-dir>.");
  }

  const source = readSnapshotDir(repoRoot, opts.from);
  const target = opts.to
    ? readSnapshotDir(repoRoot, opts.to)
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
