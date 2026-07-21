// Deterministic prose synthesis over already-computed knowledge-graph
// artifacts, mirroring @rvs/decision-intelligence/src/narrative.ts's
// generation discipline: every sentence derived from a real count/id, a
// forbidden-phrase self-check runs over every section before returning.
// Fixed 13-section order, matching the plan's spec exactly.

import type {
  ChangePlanEntry,
  DecisionImpactEntry,
  GraphChangeSet,
  GraphSnapshot,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeGraphNarrative,
  KnowledgeNode,
  RootCauseGroup,
  ValidationFinding,
} from "./contracts.js";
import { buildNarrativeId } from "./ids.js";
import { buildGenericGraph, findOrphanNodes } from "./graph-core.js";

/**
 * Fixed, case-insensitive forbidden substrings. The knowledge graph must
 * never assert an unqualified "no impact"/"no risk" claim, invent a
 * severity/quality judgement, or claim completeness it cannot back with a
 * disclosed traversal/compatibility fact -- matching the package's own
 * "no subjective risk score is invented" / "never silently exhaustive"
 * disclosed-scope-trim conventions.
 */
const FORBIDDEN_PHRASES = ["no risk", "no impact", "guaranteed", "definitely safe", "completely resolved", "fully exhaustive"];

export function containsForbiddenPhrasing(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));
}

function countBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${count} ${key}`).join(", ");
}

function buildHeadline(snapshot: GraphSnapshot, changeSet: GraphChangeSet | undefined): string {
  const available = snapshot.upstream_artifacts.filter((artifact) => artifact.provenance !== "unavailable").length;
  const changeText = changeSet
    ? ` Comparing against snapshot "${changeSet.source_snapshot_id}" found ${changeSet.nodes_added.length} node(s) added, ${changeSet.nodes_removed.length} removed, ${changeSet.edges_added.length} edge(s) added, ${changeSet.edges_removed.length} removed.`
    : " No comparison target was provided for this narrative.";
  return `Snapshot "${snapshot.id}" for repository "${snapshot.repository_id}" unifies ${available}/${snapshot.upstream_artifacts.length} upstream intelligence artifacts into ${snapshot.node_count} node(s) and ${snapshot.edge_count} edge(s).${changeText}`;
}

function buildGraphInventory(nodes: KnowledgeNode[]): string {
  const byType = countBy(nodes, (node) => node.node_type);
  return `Node inventory by type: ${formatCounts(byType)}.`;
}

function buildRelationshipLandscape(edges: KnowledgeEdge[]): string {
  const byType = countBy(edges, (edge) => edge.edge_type);
  const byResolution = countBy(edges, (edge) => edge.resolution_status);
  return `Edge inventory by type: ${formatCounts(byType)}. Resolution status breakdown: ${formatCounts(byResolution)}.`;
}

function buildCriticalDependencyPaths(impactResults: ImpactResult[]): string {
  if (impactResults.length === 0) return "Impact queries have not been run yet, so no dependency paths are available to summarize.";
  const withPaths = impactResults.filter((result) => [...result.directly_affected, ...result.transitively_affected].some((finding) => finding.path_id));
  return `${impactResults.length} impact quer(y/ies) computed; ${withPaths.length} produced at least one traceable dependency path.`;
}

function buildComponentCapabilityImpact(impactResults: ImpactResult[]): string {
  if (impactResults.length === 0) return "Impact queries have not been run yet, so component/capability impact could not be assessed.";
  const totalCapabilities = new Set(impactResults.flatMap((result) => result.capabilities_affected)).size;
  const totalComponents = impactResults.reduce((sum, result) => sum + [...result.directly_affected, ...result.transitively_affected].filter((finding) => finding.node_type === "component").length, 0);
  return `Across all computed impact queries, ${totalComponents} component-node hit(s) and ${totalCapabilities} distinct capabilit(y/ies) were found affected.`;
}

function buildProductPortfolioReach(impactResults: ImpactResult[]): string {
  if (impactResults.length === 0) return "Impact queries have not been run yet, so product/portfolio reach could not be assessed.";
  const totalProducts = new Set(impactResults.flatMap((result) => result.products_affected)).size;
  const portfolioWide = impactResults.filter((result) => result.blast_radius_level === "portfolio_wide").length;
  return `${totalProducts} distinct product(s) found affected across computed impact queries; ${portfolioWide} quer(y/ies) reached a portfolio-wide blast radius.`;
}

function buildGovernanceRootCauses(rootCauseGroups: RootCauseGroup[]): string {
  if (rootCauseGroups.length === 0) return "No root-cause groups have been computed (run `rvs graph roots`, which requires cached governance findings).";
  const byClassification = countBy(rootCauseGroups, (group) => group.classification);
  return `Root-cause grouping breakdown: ${formatCounts(byClassification)}.`;
}

function buildDecisionDependencies(decisionImpacts: DecisionImpactEntry[]): string {
  if (decisionImpacts.length === 0) return "No decision-impact queries have been run yet, so decision dependencies could not be assessed.";
  const byState = countBy(decisionImpacts, (entry) => entry.state);
  return `Decision-impact state breakdown across computed queries: ${formatCounts(byState)}.`;
}

function buildInvalidatedAssumptions(decisionImpacts: DecisionImpactEntry[]): string {
  const weakened = decisionImpacts.filter((entry) => entry.state === "assumption_weakened");
  const contradicted = decisionImpacts.filter((entry) => entry.state === "assumption_contradicted");
  if (weakened.length === 0 && contradicted.length === 0) return "No decision-impact query has classified an assumption as weakened or contradicted.";
  return `${contradicted.length} decision(s) reached an assumption-contradicted classification, and ${weakened.length} reached assumption-weakened, across computed decision-impact queries.`;
}

function buildOrphansAndUnresolved(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): string {
  const unresolvedNodes = nodes.filter((node) => node.node_type === "unresolved_reference");
  const graph = buildGenericGraph(nodes.map((node) => node.id), edges.map((edge) => ({ from: edge.from_node_id, to: edge.to_node_id, kind: edge.edge_type })));
  const orphans = findOrphanNodes(graph);
  return `${unresolvedNodes.length} unresolved-reference node(s) and ${orphans.length} orphan node(s) (no incoming or outgoing edges) are present in this snapshot.`;
}

function buildGraphChanges(changeSet: GraphChangeSet | undefined): string {
  if (!changeSet) return "No comparison target was provided, so graph changes could not be assessed.";
  const parts = [
    `${changeSet.entity_types_changed.length} entity type change(s)`,
    `${changeSet.relationships_changed.length} relationship change(s)`,
    `${changeSet.new_orphans.length} new orphan(s)`,
    `${changeSet.new_cycles.length} new cycle(s)`,
    `${changeSet.root_causes_introduced.length} root-cause group(s) introduced`,
    `${changeSet.root_causes_resolved.length} root-cause group(s) resolved`,
    `${changeSet.decision_dependencies_changed.length} decision dependency change(s)`,
    `${changeSet.governance_reach_changed.length} governance reach change(s)`,
  ];
  return `${parts.join(", ")}.`;
}

function buildHumanReviewRequired(decisionImpacts: DecisionImpactEntry[], rootCauseGroups: RootCauseGroup[], changePlans: ChangePlanEntry[]): string {
  const reviewRequired = decisionImpacts.filter((entry) => entry.state === "review_required" || entry.state === "unverifiable").length;
  const unresolvedRootCauses = rootCauseGroups.filter((group) => group.classification === "unresolved").length;
  const unknownConsumers = changePlans.reduce((sum, plan) => sum + plan.unknown_consumers.length, 0);
  if (reviewRequired === 0 && unresolvedRootCauses === 0 && unknownConsumers === 0) {
    return "No decision-impact, root-cause, or change-plan query currently flags an item requiring human review.";
  }
  return `${reviewRequired} decision-impact entr(y/ies) require review or are unverifiable, ${unresolvedRootCauses} root-cause group(s) have unresolved anchors, and ${unknownConsumers} unknown consumer(s) were surfaced across computed change plans.`;
}

function buildValidationAndLimitations(snapshot: GraphSnapshot, validationFindings: ValidationFinding[]): string {
  const unavailable = snapshot.upstream_artifacts.filter((artifact) => artifact.provenance === "unavailable").map((artifact) => artifact.source_artifact);
  const provenanceText = unavailable.length > 0 ? ` Upstream artifacts not available for this build: ${unavailable.join(", ")}.` : " All six upstream artifacts were available for this build.";
  const blocking = validationFindings.filter((finding) => finding.blocking).length;
  const validationText = validationFindings.length === 0 ? "No validation findings were recorded." : `${validationFindings.length} validation finding(s) recorded, ${blocking} blocking.`;
  return `${validationText}${provenanceText}`;
}

export interface BuildKnowledgeGraphNarrativeInput {
  snapshot: GraphSnapshot;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  changeSet?: GraphChangeSet;
  impactResults?: ImpactResult[];
  rootCauseGroups?: RootCauseGroup[];
  decisionImpacts?: DecisionImpactEntry[];
  changePlans?: ChangePlanEntry[];
  validationFindings?: ValidationFinding[];
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  generatedAt: string;
}

export function buildKnowledgeGraphNarrative(input: BuildKnowledgeGraphNarrativeInput): KnowledgeGraphNarrative {
  const {
    snapshot,
    nodes,
    edges,
    changeSet,
    impactResults = [],
    rootCauseGroups = [],
    decisionImpacts = [],
    changePlans = [],
    validationFindings = [],
    generatedAt,
  } = input;

  const sections: [string, string][] = [
    ["Headline", buildHeadline(snapshot, changeSet)],
    ["Graph inventory", buildGraphInventory(nodes)],
    ["Relationship landscape", buildRelationshipLandscape(edges)],
    ["Critical dependency paths", buildCriticalDependencyPaths(impactResults)],
    ["Component/capability impact", buildComponentCapabilityImpact(impactResults)],
    ["Product and portfolio reach", buildProductPortfolioReach(impactResults)],
    ["Governance root causes", buildGovernanceRootCauses(rootCauseGroups)],
    ["Decision dependencies", buildDecisionDependencies(decisionImpacts)],
    ["Invalidated assumptions", buildInvalidatedAssumptions(decisionImpacts)],
    ["Orphans and unresolved references", buildOrphansAndUnresolved(nodes, edges)],
    ["Graph changes", buildGraphChanges(changeSet)],
    ["Human review required", buildHumanReviewRequired(decisionImpacts, rootCauseGroups, changePlans)],
    ["Validation and limitations", buildValidationAndLimitations(snapshot, validationFindings)],
  ];

  for (const [heading, body] of sections) {
    const hits = containsForbiddenPhrasing(body);
    if (hits.length > 0) {
      throw new Error(`Generated knowledge-graph narrative section "${heading}" contains forbidden phrasing (${hits.join(", ")}). This is a synthesis bug: narrative text must never assert an unsupported completeness/safety/no-impact claim.`);
    }
  }

  return {
    id: buildNarrativeId(snapshot.id),
    generated_at: generatedAt,
    source_snapshot_id: snapshot.id,
    target_snapshot_id: changeSet?.target_snapshot_id,
    sections: sections.map(([heading, body]) => ({ heading, body })),
  };
}
