import { describe, it, expect } from "vitest";
import {
  buildGraphCapabilityImpactScene,
  buildGraphChangesScene,
  buildGraphComponentImpactScene,
  buildGraphDecisionDependenciesScene,
  buildGraphDependencyPathsScene,
  buildGraphEntityLandscapeScene,
  buildGraphInvalidatedAssumptionsScene,
  buildGraphLayersConnectedScene,
  buildGraphOrphansUnresolvedScene,
  buildGraphOverviewScene,
  buildGraphProductPortfolioReachScene,
  buildGraphRelationshipLandscapeScene,
  buildGraphReviewRequiredScene,
  buildGraphRootCausesScene,
  buildGraphValidationScene,
  buildKnowledgeGraphPlan,
} from "../graph-plan.js";
import { buildKnowledgeGraphNarrative } from "../narrative.js";
import { buildGraphSnapshot } from "../snapshot.js";
import { buildPlanId, buildSceneId } from "../ids.js";
import type { KnowledgeGraphSceneKind } from "../contracts.js";
import { GENERATED_AT, allPresentUpstreamArtifacts, isolatedNodeFixture, linearChainFixture, REPOSITORY_ID } from "./graph-fixtures.js";

function baseSnapshotAndNarrative() {
  const { nodes, edges } = linearChainFixture();
  const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
  const narrative = buildKnowledgeGraphNarrative({ snapshot, nodes, edges, generatedAt: GENERATED_AT });
  return { nodes, edges, snapshot, narrative };
}

describe("unconditional scenes", () => {
  it("buildGraphOverviewScene is always emitted", () => {
    const { snapshot, narrative } = baseSnapshotAndNarrative();
    const scene = buildGraphOverviewScene("graph:plan:x", snapshot, narrative);
    expect(scene.scene_id).toBe(buildSceneId("graph:plan:x", "graph-overview"));
    expect(scene.kind).toBe("graph-overview");
    // scene.body is typed `unknown` in contracts.ts (each scene kind has its own body shape,
    // not modeled in the shared contract) -- narrow locally for this one known-shape assertion.
    expect((scene.body as { node_count: number }).node_count).toBe(snapshot.node_count);
  });

  it("buildGraphLayersConnectedScene is always emitted, even with zero upstream artifacts", () => {
    const emptySnapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: [], nodes: [], edges: [] });
    const scene = buildGraphLayersConnectedScene("graph:plan:x", emptySnapshot);
    expect(scene.kind).toBe("graph-layers-connected");
    expect((scene.body as { upstream_artifacts: unknown[] }).upstream_artifacts).toEqual([]);
  });
});

describe("evidence-gated scenes return undefined when their source data is empty", () => {
  it("buildGraphEntityLandscapeScene", () => {
    expect(buildGraphEntityLandscapeScene("graph:plan:x", [])).toBeUndefined();
    const { nodes } = linearChainFixture();
    expect(buildGraphEntityLandscapeScene("graph:plan:x", nodes)).toBeDefined();
  });

  it("buildGraphRelationshipLandscapeScene", () => {
    expect(buildGraphRelationshipLandscapeScene("graph:plan:x", [])).toBeUndefined();
    const { edges } = linearChainFixture();
    expect(buildGraphRelationshipLandscapeScene("graph:plan:x", edges)).toBeDefined();
  });

  it("buildGraphDependencyPathsScene requires at least one finding with a path_id", () => {
    expect(buildGraphDependencyPathsScene("graph:plan:x", [])).toBeUndefined();
    const withoutPaths = [{ id: "i1", schema_version: 1, query: { entity_node_id: "n1", max_depth: 1, direction: "downstream" as const }, directly_affected: [{ node_id: "n2", node_type: "component" as const, depth: 1 }], transitively_affected: [], blast_radius_level: "local" as const, edge_types_traversed: [], products_affected: [], capabilities_affected: [], decisions_affected: [], governance_findings_affected: [], assumptions_potentially_invalidated: [], unresolved_downstream_impact: false, truncated: false, evidence_refs: [] }];
    expect(buildGraphDependencyPathsScene("graph:plan:x", withoutPaths)).toBeUndefined();
    const withPaths = [{ ...withoutPaths[0]!, directly_affected: [{ ...withoutPaths[0]!.directly_affected[0]!, path_id: "graph:path:n1:n2:n1.n2" }] }];
    expect(buildGraphDependencyPathsScene("graph:plan:x", withPaths)).toBeDefined();
  });

  it("buildGraphComponentImpactScene requires at least one component-type finding", () => {
    expect(buildGraphComponentImpactScene("graph:plan:x", [])).toBeUndefined();
    const impact = { id: "i1", schema_version: 1, query: { entity_node_id: "n1", max_depth: 1, direction: "downstream" as const }, directly_affected: [{ node_id: "n2", node_type: "component" as const, depth: 1 }], transitively_affected: [], blast_radius_level: "local" as const, edge_types_traversed: [], products_affected: [], capabilities_affected: [], decisions_affected: [], governance_findings_affected: [], assumptions_potentially_invalidated: [], unresolved_downstream_impact: false, truncated: false, evidence_refs: [] };
    expect(buildGraphComponentImpactScene("graph:plan:x", [impact])).toBeDefined();
  });

  it("buildGraphCapabilityImpactScene requires at least one affected capability id", () => {
    expect(buildGraphCapabilityImpactScene("graph:plan:x", [])).toBeUndefined();
  });

  it("buildGraphProductPortfolioReachScene requires an affected product id or a portfolio_wide result", () => {
    expect(buildGraphProductPortfolioReachScene("graph:plan:x", [])).toBeUndefined();
  });

  it("buildGraphRootCausesScene", () => {
    expect(buildGraphRootCausesScene("graph:plan:x", [])).toBeUndefined();
    const group = { id: "g1", schema_version: 1, finding_node_ids: ["f1"], candidate_root_node_ids: ["r1"], classification: "confirmed" as const, detail: "d", evidence_refs: [] };
    expect(buildGraphRootCausesScene("graph:plan:x", [group])).toBeDefined();
  });

  it("buildGraphDecisionDependenciesScene", () => {
    expect(buildGraphDecisionDependenciesScene("graph:plan:x", [])).toBeUndefined();
  });

  it("buildGraphInvalidatedAssumptionsScene requires a weakened/contradicted entry", () => {
    const reviewOnly = [{ id: "d1", schema_version: 1, decision_node_id: "dn", target_entity_node_id: "tn", state: "review_required" as const, detail: "d", evidence_refs: [] }];
    expect(buildGraphInvalidatedAssumptionsScene("graph:plan:x", reviewOnly)).toBeUndefined();
    const weakened = [{ ...reviewOnly[0]!, state: "assumption_weakened" as const }];
    expect(buildGraphInvalidatedAssumptionsScene("graph:plan:x", weakened)).toBeDefined();
  });

  it("buildGraphOrphansUnresolvedScene requires an unresolved-reference node or an orphan node", () => {
    const { nodes, edges } = linearChainFixture();
    expect(buildGraphOrphansUnresolvedScene("graph:plan:x", nodes, edges)).toBeUndefined();
    const { nodes: isoNodes } = isolatedNodeFixture();
    expect(buildGraphOrphansUnresolvedScene("graph:plan:x", isoNodes, [])).toBeDefined();
  });

  it("buildGraphChangesScene requires a changeSet", () => {
    expect(buildGraphChangesScene("graph:plan:x", undefined)).toBeUndefined();
  });

  it("buildGraphReviewRequiredScene requires a review-needing decision, unresolved root cause, or unknown consumer", () => {
    expect(buildGraphReviewRequiredScene("graph:plan:x", [], [], [])).toBeUndefined();
    const decisionEntry = [{ id: "d1", schema_version: 1, decision_node_id: "dn", target_entity_node_id: "tn", state: "unverifiable" as const, detail: "d", evidence_refs: [] }];
    expect(buildGraphReviewRequiredScene("graph:plan:x", decisionEntry, [], [])).toBeDefined();
  });

  it("buildGraphValidationScene requires findings or a non-'complete' upstream artifact", () => {
    const completeSnapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes: [], edges: [] });
    expect(buildGraphValidationScene("graph:plan:x", completeSnapshot, [])).toBeUndefined();
    const partialSnapshot = buildGraphSnapshot({
      repositoryId: REPOSITORY_ID,
      upstreamArtifacts: [{ source_artifact: "architecture", provenance: "unavailable" }],
      nodes: [],
      edges: [],
    });
    expect(buildGraphValidationScene("graph:plan:x", partialSnapshot, [])).toBeDefined();
  });
});

describe("buildKnowledgeGraphPlan", () => {
  it("assembles id/generated_at/source_snapshot_id and only includes defined scenes, in fixed kind order", () => {
    const { nodes, edges, snapshot, narrative } = baseSnapshotAndNarrative();
    const plan = buildKnowledgeGraphPlan({ snapshot, narrative, nodes, edges, generatedAt: GENERATED_AT });

    expect(plan.id).toBe(buildPlanId(snapshot.id));
    expect(plan.generated_at).toBe(GENERATED_AT);
    expect(plan.source_snapshot_id).toBe(snapshot.id);

    // graph-overview and graph-layers-connected are unconditional; graph-entity-landscape
    // and graph-relationship-landscape are present because nodes/edges are non-empty.
    const kinds = plan.scenes.map((scene) => scene.kind);
    expect(kinds).toContain("graph-overview");
    expect(kinds).toContain("graph-layers-connected");
    expect(kinds).toContain("graph-entity-landscape");
    expect(kinds).toContain("graph-relationship-landscape");
    // No impact/root-cause/decision/change/validation data supplied -> those scenes are absent.
    expect(kinds).not.toContain("graph-dependency-paths");
    expect(kinds).not.toContain("graph-root-causes");
    expect(kinds).not.toContain("graph-changes");
  });

  it("produces scenes ordered by the fixed SCENE_KIND_ORDER regardless of internal construction order", () => {
    const { nodes, edges, snapshot, narrative } = baseSnapshotAndNarrative();
    const plan = buildKnowledgeGraphPlan({ snapshot, narrative, nodes, edges, generatedAt: GENERATED_AT });
    const kinds = plan.scenes.map((scene) => scene.kind);
    const fixedOrder: KnowledgeGraphSceneKind[] = [
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
    const expectedFiltered = fixedOrder.filter((kind) => kinds.includes(kind));
    expect(kinds).toEqual(expectedFiltered);
  });

  it("is deterministic across repeated calls with identical input", () => {
    const { nodes, edges, snapshot, narrative } = baseSnapshotAndNarrative();
    const input = { snapshot, narrative, nodes, edges, generatedAt: GENERATED_AT };
    const first = buildKnowledgeGraphPlan(input);
    const second = buildKnowledgeGraphPlan(input);
    expect(first).toEqual(second);
  });
});
