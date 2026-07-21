// rvs graph explain <id>. Pure fallback-across-id-spaces lookup, mirroring
// @rvs/decision-intelligence/src/explain.ts and
// @rvs/governance-intelligence/src/explain.ts's shape exactly: a pure
// function (no filesystem/logger access), a caller-supplied context carrying
// whatever already-loaded artifacts are available, and a plain thrown Error
// naming every space tried when nothing resolves. The CLI wrapper
// (packages/cli/src/commands/graph-explain.ts) is the only try/catch site.
//
// Search order, exactly as specified: node id -> edge id -> path id ->
// impact-result id -> root-cause-group id -> decision-impact id ->
// change-plan id.

import type {
  ChangePlanEntry,
  DecisionImpactEntry,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgePath,
  RootCauseGroup,
} from "./contracts.js";

export interface GraphExplainContext {
  nodes?: KnowledgeNode[];
  edges?: KnowledgeEdge[];
  paths?: KnowledgePath[];
  impactResults?: ImpactResult[];
  rootCauseGroups?: RootCauseGroup[];
  decisionImpacts?: DecisionImpactEntry[];
  changePlans?: ChangePlanEntry[];
}

export interface GraphExplanation {
  /** Human-readable, multi-sentence explanation of what the id refers to. */
  explanation: string;
  /** The resolved object itself, for callers that want to inspect it further (e.g. an `rvs graph explain --json` CLI layer, out of this package's scope). */
  resolved: unknown;
}

export function explainGraphId(id: string, context: GraphExplainContext): GraphExplanation {
  const node = context.nodes?.find((candidate) => candidate.id === id);
  if (node) {
    return {
      explanation: `Node "${node.id}" ("${node.label}"): type "${node.node_type}" from "${node.source_artifact}" (source entity "${node.source_entity_id}"), resolution "${node.resolution_status}", confidence "${node.confidence}".`,
      resolved: node,
    };
  }

  const edge = context.edges?.find((candidate) => candidate.id === id);
  if (edge) {
    return {
      explanation: `Edge "${edge.id}" (${edge.edge_type}) from "${edge.from_node_id}" to "${edge.to_node_id}", resolution "${edge.resolution_status}": ${edge.detail}`,
      resolved: edge,
    };
  }

  const path = context.paths?.find((candidate) => candidate.id === id);
  if (path) {
    return {
      explanation: `Path "${path.id}" from "${path.from_node_id}" to "${path.to_node_id}" spans ${path.length} edge(s): ${path.node_ids.join(" -> ")}.`,
      resolved: path,
    };
  }

  const impactResult = context.impactResults?.find((candidate) => candidate.id === id);
  if (impactResult) {
    return {
      explanation: `Impact result "${impactResult.id}" for entity "${impactResult.query.entity_node_id}" (direction "${impactResult.query.direction}", max depth ${impactResult.query.max_depth}): ${impactResult.directly_affected.length} directly affected, ${impactResult.transitively_affected.length} transitively affected, blast radius "${impactResult.blast_radius_level}"${impactResult.truncated ? " (truncated)" : ""}.`,
      resolved: impactResult,
    };
  }

  const rootCauseGroup = context.rootCauseGroups?.find((candidate) => candidate.id === id);
  if (rootCauseGroup) {
    return {
      explanation: `Root-cause group "${rootCauseGroup.id}" (${rootCauseGroup.classification}) covers ${rootCauseGroup.finding_node_ids.length} finding(s): ${rootCauseGroup.detail}`,
      resolved: rootCauseGroup,
    };
  }

  const decisionImpact = context.decisionImpacts?.find((candidate) => candidate.id === id);
  if (decisionImpact) {
    return {
      explanation: `Decision impact "${decisionImpact.id}": decision "${decisionImpact.decision_node_id}" reached from target "${decisionImpact.target_entity_node_id}" is classified "${decisionImpact.state}": ${decisionImpact.detail}`,
      resolved: decisionImpact,
    };
  }

  const changePlan = context.changePlans?.find((candidate) => candidate.id === id);
  if (changePlan) {
    return {
      explanation: `Change plan "${changePlan.id}" for removing "${changePlan.removed_entity_node_id}": ${changePlan.affected_node_ids.length} affected node(s), ${changePlan.decisions_requiring_review.length} decision(s) requiring review, ${changePlan.governance_requiring_review.length} governance item(s) requiring review, ${changePlan.unknown_consumers.length} unknown consumer(s).`,
      resolved: changePlan,
    };
  }

  throw new Error(
    `No node, edge, path, impact-result, root-cause-group, decision-impact, or change-plan found matching id "${id}". Run \`rvs graph build\` first, then re-check the id against the cached knowledge-graph artifacts.`,
  );
}
