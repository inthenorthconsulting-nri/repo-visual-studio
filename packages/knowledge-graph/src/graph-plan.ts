// One build<Kind>Scene function per KnowledgeGraphSceneKind (15, exactly as
// contracts.ts's union declares and the plan's presentation profile
// suggests 1:1), mirroring @rvs/decision-intelligence/src/decision-plan.ts's
// "full content per scene, evidence-gated absence" pattern: a scene that
// would have nothing real to show returns `undefined` rather than being
// emitted empty. buildSceneId is reused directly from ids.ts.

import type {
  ChangePlanEntry,
  DecisionImpactEntry,
  GraphChangeSet,
  GraphSnapshot,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeGraphNarrative,
  KnowledgeGraphPlan,
  KnowledgeGraphSceneContent,
  KnowledgeGraphSceneKind,
  KnowledgeNode,
  RootCauseGroup,
  ValidationFinding,
} from "./contracts.js";
import { buildPlanId, buildSceneId } from "./ids.js";
import { buildGenericGraph, findOrphanNodes } from "./graph-core.js";

const SCENE_KIND_ORDER: KnowledgeGraphSceneKind[] = [
  "graph-overview",
  "graph-layers-connected",
  "graph-entity-landscape",
  "graph-relationship-landscape",
  "graph-dependency-paths",
  "graph-component-impact",
  "graph-capability-impact",
  "graph-product-portfolio-reach",
  "graph-root-causes",
  "graph-decision-dependencies",
  "graph-invalidated-assumptions",
  "graph-orphans-unresolved",
  "graph-changes",
  "graph-review-required",
  "graph-validation",
];
const SCENE_KIND_RANK: Record<KnowledgeGraphSceneKind, number> = Object.fromEntries(
  SCENE_KIND_ORDER.map((kind, index) => [kind, index]),
) as Record<KnowledgeGraphSceneKind, number>;

function countBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted = {} as Record<K, number>;
  for (const key of Object.keys(counts).sort() as K[]) {
    sorted[key] = counts[key];
  }
  return sorted;
}

function findSection(narrative: KnowledgeGraphNarrative, heading: string): string {
  return narrative.sections.find((section) => section.heading === heading)?.body ?? "";
}

// ---------------------------------------------------------------------------
// Per-kind scene builders
// ---------------------------------------------------------------------------

export function buildGraphOverviewScene(planId: string, snapshot: GraphSnapshot, narrative: KnowledgeGraphNarrative): KnowledgeGraphSceneContent {
  return {
    scene_id: buildSceneId(planId, "graph-overview"),
    kind: "graph-overview",
    title: `Knowledge graph snapshot: ${snapshot.id}`,
    body: { summary: findSection(narrative, "Headline"), node_count: snapshot.node_count, edge_count: snapshot.edge_count, repository_id: snapshot.repository_id },
    evidence_refs: [],
  };
}

export function buildGraphLayersConnectedScene(planId: string, snapshot: GraphSnapshot): KnowledgeGraphSceneContent {
  return {
    scene_id: buildSceneId(planId, "graph-layers-connected"),
    kind: "graph-layers-connected",
    title: "Intelligence layers connected",
    body: { upstream_artifacts: snapshot.upstream_artifacts },
    evidence_refs: [],
  };
}

export function buildGraphEntityLandscapeScene(planId: string, nodes: KnowledgeNode[]): KnowledgeGraphSceneContent | undefined {
  if (nodes.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-entity-landscape"),
    kind: "graph-entity-landscape",
    title: "Entity landscape",
    body: { total: nodes.length, by_type: countBy(nodes, (node) => node.node_type), by_confidence: countBy(nodes, (node) => node.confidence) },
    evidence_refs: [],
  };
}

export function buildGraphRelationshipLandscapeScene(planId: string, edges: KnowledgeEdge[]): KnowledgeGraphSceneContent | undefined {
  if (edges.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-relationship-landscape"),
    kind: "graph-relationship-landscape",
    title: "Relationship landscape",
    body: { total: edges.length, by_type: countBy(edges, (edge) => edge.edge_type), by_resolution: countBy(edges, (edge) => edge.resolution_status) },
    evidence_refs: [],
  };
}

export function buildGraphDependencyPathsScene(planId: string, impactResults: ImpactResult[]): KnowledgeGraphSceneContent | undefined {
  const pathIds = [...new Set(impactResults.flatMap((result) => [...result.directly_affected, ...result.transitively_affected].map((finding) => finding.path_id).filter((id): id is string => Boolean(id))))].sort();
  if (pathIds.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-dependency-paths"),
    kind: "graph-dependency-paths",
    title: "Critical dependency paths",
    body: { path_count: pathIds.length, path_ids: pathIds },
    evidence_refs: impactResults.flatMap((result) => result.evidence_refs),
  };
}

export function buildGraphComponentImpactScene(planId: string, impactResults: ImpactResult[]): KnowledgeGraphSceneContent | undefined {
  const componentFindings = impactResults.flatMap((result) => [...result.directly_affected, ...result.transitively_affected]).filter((finding) => finding.node_type === "component");
  if (componentFindings.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-component-impact"),
    kind: "graph-component-impact",
    title: "Component impact map",
    body: { affected_component_hits: componentFindings.length, by_depth: countBy(componentFindings, (finding) => String(finding.depth)) },
    evidence_refs: [],
  };
}

export function buildGraphCapabilityImpactScene(planId: string, impactResults: ImpactResult[]): KnowledgeGraphSceneContent | undefined {
  const capabilityIds = [...new Set(impactResults.flatMap((result) => result.capabilities_affected))].sort();
  if (capabilityIds.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-capability-impact"),
    kind: "graph-capability-impact",
    title: "Capability impact map",
    body: { total: capabilityIds.length, capability_node_ids: capabilityIds },
    evidence_refs: [],
  };
}

export function buildGraphProductPortfolioReachScene(planId: string, impactResults: ImpactResult[]): KnowledgeGraphSceneContent | undefined {
  const productIds = [...new Set(impactResults.flatMap((result) => result.products_affected))].sort();
  const portfolioWide = impactResults.filter((result) => result.blast_radius_level === "portfolio_wide").length;
  if (productIds.length === 0 && portfolioWide === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-product-portfolio-reach"),
    kind: "graph-product-portfolio-reach",
    title: "Product and portfolio reach",
    body: { total_products: productIds.length, product_node_ids: productIds, portfolio_wide_query_count: portfolioWide },
    evidence_refs: [],
  };
}

export function buildGraphRootCausesScene(planId: string, rootCauseGroups: RootCauseGroup[]): KnowledgeGraphSceneContent | undefined {
  if (rootCauseGroups.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-root-causes"),
    kind: "graph-root-causes",
    title: "Governance root causes",
    body: { total: rootCauseGroups.length, by_classification: countBy(rootCauseGroups, (group) => group.classification), group_ids: rootCauseGroups.map((group) => group.id).sort() },
    evidence_refs: rootCauseGroups.flatMap((group) => group.evidence_refs),
  };
}

export function buildGraphDecisionDependenciesScene(planId: string, decisionImpacts: DecisionImpactEntry[]): KnowledgeGraphSceneContent | undefined {
  if (decisionImpacts.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-decision-dependencies"),
    kind: "graph-decision-dependencies",
    title: "Decision dependencies",
    body: { total: decisionImpacts.length, by_state: countBy(decisionImpacts, (entry) => entry.state) },
    evidence_refs: decisionImpacts.flatMap((entry) => entry.evidence_refs),
  };
}

export function buildGraphInvalidatedAssumptionsScene(planId: string, decisionImpacts: DecisionImpactEntry[]): KnowledgeGraphSceneContent | undefined {
  const affected = decisionImpacts.filter((entry) => entry.state === "assumption_weakened" || entry.state === "assumption_contradicted");
  if (affected.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-invalidated-assumptions"),
    kind: "graph-invalidated-assumptions",
    title: "Invalidated assumptions",
    body: { total: affected.length, by_state: countBy(affected, (entry) => entry.state), decision_node_ids: [...new Set(affected.map((entry) => entry.decision_node_id))].sort() },
    evidence_refs: affected.flatMap((entry) => entry.evidence_refs),
  };
}

export function buildGraphOrphansUnresolvedScene(planId: string, nodes: KnowledgeNode[], edges: KnowledgeEdge[]): KnowledgeGraphSceneContent | undefined {
  const unresolvedNodes = nodes.filter((node) => node.node_type === "unresolved_reference");
  const graph = buildGenericGraph(nodes.map((node) => node.id), edges.map((edge) => ({ from: edge.from_node_id, to: edge.to_node_id, kind: edge.edge_type })));
  const orphanIds = findOrphanNodes(graph);
  if (unresolvedNodes.length === 0 && orphanIds.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-orphans-unresolved"),
    kind: "graph-orphans-unresolved",
    title: "Orphans and unresolved references",
    body: { unresolved_reference_count: unresolvedNodes.length, orphan_count: orphanIds.length, orphan_node_ids: orphanIds },
    evidence_refs: [],
  };
}

export function buildGraphChangesScene(planId: string, changeSet: GraphChangeSet | undefined): KnowledgeGraphSceneContent | undefined {
  if (!changeSet) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-changes"),
    kind: "graph-changes",
    title: "Graph changes",
    body: changeSet,
    evidence_refs: [],
  };
}

export function buildGraphReviewRequiredScene(
  planId: string,
  decisionImpacts: DecisionImpactEntry[],
  rootCauseGroups: RootCauseGroup[],
  changePlans: ChangePlanEntry[],
): KnowledgeGraphSceneContent | undefined {
  const decisionsNeedingReview = decisionImpacts.filter((entry) => entry.state === "review_required" || entry.state === "unverifiable");
  const unresolvedRootCauses = rootCauseGroups.filter((group) => group.classification === "unresolved");
  const unknownConsumers = changePlans.flatMap((plan) => plan.unknown_consumers);
  if (decisionsNeedingReview.length === 0 && unresolvedRootCauses.length === 0 && unknownConsumers.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-review-required"),
    kind: "graph-review-required",
    title: "Human review required",
    body: {
      decision_impact_ids: decisionsNeedingReview.map((entry) => entry.id).sort(),
      unresolved_root_cause_group_ids: unresolvedRootCauses.map((group) => group.id).sort(),
      unknown_consumer_node_ids: [...new Set(unknownConsumers)].sort(),
    },
    evidence_refs: [...decisionsNeedingReview.flatMap((entry) => entry.evidence_refs), ...unresolvedRootCauses.flatMap((group) => group.evidence_refs)],
  };
}

export function buildGraphValidationScene(planId: string, snapshot: GraphSnapshot, validationFindings: ValidationFinding[]): KnowledgeGraphSceneContent | undefined {
  const nonComplete = snapshot.upstream_artifacts.filter((artifact) => artifact.provenance !== "complete");
  if (validationFindings.length === 0 && nonComplete.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "graph-validation"),
    kind: "graph-validation",
    title: "Validation and limitations",
    body: {
      finding_total: validationFindings.length,
      blocking_count: validationFindings.filter((finding) => finding.blocking).length,
      by_code: countBy(validationFindings, (finding) => finding.code),
      non_complete_upstream_artifacts: nonComplete,
    },
    evidence_refs: [],
  };
}

// ---------------------------------------------------------------------------
// buildKnowledgeGraphPlan
// ---------------------------------------------------------------------------

export interface BuildKnowledgeGraphPlanInput {
  snapshot: GraphSnapshot;
  narrative: KnowledgeGraphNarrative;
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

export function buildKnowledgeGraphPlan(input: BuildKnowledgeGraphPlanInput): KnowledgeGraphPlan {
  const {
    snapshot,
    narrative,
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
  const planId = buildPlanId(snapshot.id);

  const candidates: (KnowledgeGraphSceneContent | undefined)[] = [
    buildGraphOverviewScene(planId, snapshot, narrative),
    buildGraphLayersConnectedScene(planId, snapshot),
    buildGraphEntityLandscapeScene(planId, nodes),
    buildGraphRelationshipLandscapeScene(planId, edges),
    buildGraphDependencyPathsScene(planId, impactResults),
    buildGraphComponentImpactScene(planId, impactResults),
    buildGraphCapabilityImpactScene(planId, impactResults),
    buildGraphProductPortfolioReachScene(planId, impactResults),
    buildGraphRootCausesScene(planId, rootCauseGroups),
    buildGraphDecisionDependenciesScene(planId, decisionImpacts),
    buildGraphInvalidatedAssumptionsScene(planId, decisionImpacts),
    buildGraphOrphansUnresolvedScene(planId, nodes, edges),
    buildGraphChangesScene(planId, changeSet),
    buildGraphReviewRequiredScene(planId, decisionImpacts, rootCauseGroups, changePlans),
    buildGraphValidationScene(planId, snapshot, validationFindings),
  ];

  const scenes = candidates
    .filter((scene): scene is KnowledgeGraphSceneContent => scene !== undefined)
    .sort((a, b) => (SCENE_KIND_RANK[a.kind] !== SCENE_KIND_RANK[b.kind] ? SCENE_KIND_RANK[a.kind] - SCENE_KIND_RANK[b.kind] : a.scene_id.localeCompare(b.scene_id)));

  return {
    id: planId,
    generated_at: generatedAt,
    source_snapshot_id: snapshot.id,
    scenes,
  };
}
