// Baseline resolution for `rvs change evaluate`: the confirmed-graph
// snapshot a proposal is evaluated against, drawn entirely from the
// existing Knowledge Graph cache -- never auto-built. A missing snapshot
// fails via readGraphCachedJson's own error ("Run `rvs graph build`
// first."), satisfying Milestone 11.2 §13 with no additional guidance code.

import { buildDecisionStateLookup } from "@rvs/knowledge-graph";
import type { DecisionStateLookup, GraphSnapshot, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { ArchitectureDecision, DecisionAssumption } from "@rvs/decision-intelligence";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphCachedJson } from "../graph-cache.js";

export interface ChangeWorkbenchBaseline {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  baseSnapshotDigest: string;
  decisionStateLookup: DecisionStateLookup;
}

/** Mirrors graph-build.ts's/graph-plan-change.ts's own established construction of a decision-state lookup from best-effort optional decision cache artifacts. */
export function resolveChangeWorkbenchBaseline(repoRoot: string): ChangeWorkbenchBaseline {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");
  const snapshot = readGraphCachedJson<GraphSnapshot>(repoRoot, "graph-snapshot.json");

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);

  return { nodes, edges, baseSnapshotDigest: snapshot.digest, decisionStateLookup };
}
