// rvs graph plan-change --remove <entity-id>. Composes impact-analysis.ts
// and decision-impact.ts (via runImpactAnalysis) rather than duplicating
// their logic, and adds two narrowly-scoped derivations of its own:
// evidence-path-pattern classification (tests/docs/presentation) and a
// fixed, static validation-command lookup table. Never writes to disk,
// never calls another CLI command, never touches git -- output only.
// Scope for this milestone: only the `--remove` verb.

import type { ChangePlanEntry, EvidenceRef, ImpactQuery, KnowledgeEdge, KnowledgeNode, KnowledgeNodeType } from "./contracts.js";
import { buildChangePlanId } from "./ids.js";
import { runImpactAnalysis } from "./impact-analysis.js";
import type { DecisionStateLookup } from "./decision-impact.js";
import { DEFAULT_MAX_TRAVERSAL_DEPTH } from "./constants.js";

function classifyEvidencePath(path: string | undefined): "test" | "docs" | "presentation" | undefined {
  if (!path) return undefined;
  if (/(^|\/)(__tests__|tests?)\//.test(path) || /\.(test|spec)\.[tj]sx?$/.test(path)) return "test";
  if (/(^|\/)docs\//.test(path)) return "docs";
  if (/(^|\/)(renderer-html|narrative-planner|visualdoc-schema)\//.test(path) || /\.html$/.test(path) || path.includes("presentation")) {
    return "presentation";
  }
  return undefined;
}

const VALIDATION_COMMANDS_BY_NODE_TYPE: Partial<Record<KnowledgeNodeType, string>> = {
  capability: "rvs synthesize capabilities",
  capability_domain: "rvs synthesize capabilities",
  product: "rvs synthesize product-identity",
  portfolio_relationship: "rvs synthesize portfolio",
  policy: "rvs governance check --ci",
  governance_finding: "rvs governance check --ci",
  decision: "rvs decisions validate --ci",
  decision_assumption: "rvs decisions validate --ci",
  decision_consequence: "rvs decisions validate --ci",
  component: "rvs synthesize architecture",
  workflow: "rvs synthesize architecture",
  runtime_entrypoint: "rvs synthesize architecture",
  repository: "rvs synthesize architecture",
};

function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function planChange(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  removedEntityNodeId: string,
  decisionStateLookup: DecisionStateLookup,
): ChangePlanEntry {
  const query: ImpactQuery = {
    entity_node_id: removedEntityNodeId,
    max_depth: DEFAULT_MAX_TRAVERSAL_DEPTH,
    direction: "downstream",
  };
  const impact = runImpactAnalysis(nodes, edges, query, decisionStateLookup);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgesFrom = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges) {
    const bucket = edgesFrom.get(edge.from_node_id) ?? [];
    bucket.push(edge);
    edgesFrom.set(edge.from_node_id, bucket);
  }

  const affectedFindings = [...impact.directly_affected, ...impact.transitively_affected];
  const affectedNodeIds = affectedFindings.map((finding) => finding.node_id).sort();
  const allConsideredNodeIds = [removedEntityNodeId, ...affectedNodeIds];

  const affectedNodeTypes = new Set<KnowledgeNodeType>();
  const targetNode = nodeById.get(removedEntityNodeId);
  if (targetNode) affectedNodeTypes.add(targetNode.node_type);
  for (const finding of affectedFindings) affectedNodeTypes.add(finding.node_type);

  const testsLikelyAffected: EvidenceRef[] = [];
  const docsLikelyAffected: EvidenceRef[] = [];
  const presentationLikelyAffected: EvidenceRef[] = [];
  const baselinesRequiringReview = new Set<string>();
  const unknownConsumers = new Set<string>();

  for (const nodeId of allConsideredNodeIds) {
    for (const edge of edgesFrom.get(nodeId) ?? []) {
      if (edge.edge_type === "evidenced_by") {
        const evidenceNode = nodeById.get(edge.to_node_id);
        if (!evidenceNode) continue;
        for (const ref of evidenceNode.evidence_refs) {
          const kind = classifyEvidencePath(ref.path);
          if (kind === "test") testsLikelyAffected.push(ref);
          else if (kind === "docs") docsLikelyAffected.push(ref);
          else if (kind === "presentation") presentationLikelyAffected.push(ref);
        }
      }
      if (edge.edge_type === "governs" || edge.edge_type === "evidenced_by") {
        const targetOfEdge = nodeById.get(edge.to_node_id);
        if (targetOfEdge?.node_type === "baseline") baselinesRequiringReview.add(targetOfEdge.id);
      }
    }
  }

  for (const finding of affectedFindings) {
    if (finding.node_type === "unresolved_reference") unknownConsumers.add(finding.node_id);
  }

  const suggestedValidationCommands = Array.from(
    new Set(
      Array.from(affectedNodeTypes)
        .map((nodeType) => VALIDATION_COMMANDS_BY_NODE_TYPE[nodeType])
        .filter((command): command is string => Boolean(command)),
    ),
  ).sort();

  return {
    id: buildChangePlanId(removedEntityNodeId),
    schema_version: 1,
    removed_entity_node_id: removedEntityNodeId,
    affected_node_ids: affectedNodeIds,
    decisions_requiring_review: impact.decisions_affected,
    governance_requiring_review: impact.governance_findings_affected,
    tests_likely_affected: dedupeEvidence(testsLikelyAffected),
    docs_likely_affected: dedupeEvidence(docsLikelyAffected),
    presentation_likely_affected: dedupeEvidence(presentationLikelyAffected),
    suggested_validation_commands: suggestedValidationCommands,
    baselines_requiring_review: Array.from(baselinesRequiringReview).sort(),
    unknown_consumers: Array.from(unknownConsumers).sort(),
    evidence_refs: impact.evidence_refs,
  };
}
