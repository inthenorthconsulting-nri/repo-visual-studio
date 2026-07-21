// Named end-to-end regression scenarios: one per classification/state
// enumerated across the package's decision tables (compatibility status,
// blast-radius level, root-cause classification, decision-impact state),
// plus a genuine full-pipeline scenario that exercises buildKnowledgeGraph
// together with every downstream query/report module on one graph, the way
// a real `rvs graph *` CLI invocation sequence would. Per-branch algorithmic
// coverage of each individual function already lives in its own
// `<module>.test.ts` file -- this file's job is to pin the outward-facing
// behavior so a future refactor can't silently break a named scenario.

import { describe, it, expect } from "vitest";
import { assessGraphCompatibility, isBuildableStatus } from "../compatibility.js";
import { traverse } from "../traversal.js";
import { deriveBlastRadiusLevel } from "../blast-radius.js";
import { groupRootCauses } from "../root-cause.js";
import { classifyReachedDecisionImpact, computeDecisionImpact } from "../decision-impact.js";
import { buildKnowledgeGraph } from "../graph-builder.js";
import { runImpactAnalysis } from "../impact-analysis.js";
import { planChange } from "../change-planning.js";
import { diffGraphs, type GraphSnapshotState } from "../diff.js";
import { validateGraph } from "../validation.js";
import { explainGraphId } from "../explain.js";
import { buildKnowledgeGraphNarrative } from "../narrative.js";
import { buildKnowledgeGraphPlan } from "../graph-plan.js";
import {
  GENERATED_AT,
  decisionReachableFixture,
  emptyDecisionStateLookup,
  evidencePathFixture,
  linearChainFixture,
  makeDecisionStateLookup,
  rootCauseFixtureSet,
  unresolvedReferenceFixture,
} from "./graph-fixtures.js";
import type { TraversalOptions } from "../contracts.js";

const OPTS: TraversalOptions = { maxDepth: 10, direction: "downstream", repositoryBoundary: "single", resultLimit: 500 };

describe("regression: compatibility status decision table", () => {
  it("compatible -- every present artifact agrees on repository id, schema version, and generated_at", () => {
    const assessment = assessGraphCompatibility([
      { source_artifact: "architecture", present: true, repository_id: "repo-x", schema_version: 1, source_generated_at: GENERATED_AT },
      { source_artifact: "governance", present: true, repository_id: "repo-x", schema_version: 1, source_generated_at: GENERATED_AT },
    ]);
    expect(assessment.status).toBe("compatible");
    expect(isBuildableStatus(assessment.status)).toBe(true);
  });

  it("compatible_with_warnings -- present artifacts agree on repository id but disagree on generated_at", () => {
    const assessment = assessGraphCompatibility([
      { source_artifact: "architecture", present: true, repository_id: "repo-x", schema_version: 1, source_generated_at: "2026-01-01T00:00:00.000Z" },
      { source_artifact: "governance", present: true, repository_id: "repo-x", schema_version: 1, source_generated_at: "2026-02-01T00:00:00.000Z" },
    ]);
    expect(assessment.status).toBe("compatible_with_warnings");
    expect(isBuildableStatus(assessment.status)).toBe(true);
  });

  it("partial -- a known artifact is simply absent", () => {
    const assessment = assessGraphCompatibility([
      { source_artifact: "architecture", present: true, repository_id: "repo-x", schema_version: 1 },
      { source_artifact: "governance", present: false },
    ]);
    expect(assessment.status).toBe("partial");
    expect(isBuildableStatus(assessment.status)).toBe(true);
  });

  it("incompatible -- two present artifacts disagree on repository id", () => {
    const assessment = assessGraphCompatibility([
      { source_artifact: "architecture", present: true, repository_id: "repo-x", schema_version: 1 },
      { source_artifact: "governance", present: true, repository_id: "repo-different", schema_version: 1 },
    ]);
    expect(assessment.status).toBe("incompatible");
    expect(isBuildableStatus(assessment.status)).toBe(false);
  });
});

describe("regression: blast-radius classification table", () => {
  it("unresolved -- target entity id does not exist in the graph at all", () => {
    const { nodes, edges } = linearChainFixture();
    const result = traverse(nodes, edges, "graph:node:does-not-exist", OPTS);
    expect(deriveBlastRadiusLevel(nodes, "graph:node:does-not-exist", result)).toBe("unresolved");
  });

  it("isolated -- target has edges, but everything reached is an unresolved_reference node", () => {
    const { nodes, edges, a } = unresolvedReferenceFixture();
    const result = traverse(nodes, edges, a.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, a.id, result)).toBe("isolated");
  });

  it("local -- everything reached shares node_type and source_artifact with the target", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, a.id, result)).toBe("local");
  });

  it("cross_component -- reached nodes share source_artifact but not node_type with the target", () => {
    const { nodes, edges, repo } = linearChainFixture();
    const result = traverse(nodes, edges, repo.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, repo.id, result)).toBe("cross_component");
  });

  it("cross_layer -- reached nodes span more than one source_artifact", () => {
    const { nodes, edges, root } = evidencePathFixture();
    const result = traverse(nodes, edges, root.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, root.id, result)).toBe("cross_layer");
  });
});

describe("regression: root-cause classification table", () => {
  const fixture = rootCauseFixtureSet();
  const groups = groupRootCauses(fixture.nodes, fixture.edges);

  it("confirmed -- two findings' anchors share exactly one resolved causal ancestor", () => {
    const group = groups.find((g) => g.candidate_root_node_ids.includes(fixture.confirmedConsumer.id));
    expect(group?.classification).toBe("confirmed");
  });

  it("probable (ambiguous) -- two findings' anchors share more than one causal ancestor candidate", () => {
    const group = groups.find(
      (g) => g.candidate_root_node_ids.includes(fixture.probableConsumer1.id) || g.candidate_root_node_ids.includes(fixture.probableConsumer2.id),
    );
    expect(group?.classification).toBe("probable");
    expect(group?.detail).toContain("ambiguous");
  });

  it("probable (partial edge) -- single shared ancestor, but reached via a partially-resolved causal edge", () => {
    const group = groups.find((g) => g.candidate_root_node_ids.includes(fixture.partialConsumer.id));
    expect(group?.classification).toBe("probable");
    expect(group?.detail).toContain("partial edge");
  });

  it("shared_dependency_only -- anchors share an ancestor reachable only via a non-causal edge", () => {
    const group = groups.find((g) => g.candidate_root_node_ids.includes(fixture.sharedDepReferencer.id));
    expect(group?.classification).toBe("shared_dependency_only");
  });

  it("unresolved -- the finding's own anchor entity is itself an unresolved_reference node", () => {
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingUnresolved1.id));
    expect(group?.classification).toBe("unresolved");
    expect(group?.candidate_root_node_ids).toEqual([]);
  });
});

describe("regression: decision-impact state precedence table", () => {
  const lookup = (overrides: Parameters<typeof makeDecisionStateLookup>[0]) => makeDecisionStateLookup(overrides);

  it("superseded -- decision_status is 'superseded', taking precedence over everything else", () => {
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: "d1",
      lookup: lookup({ decisions: [{ id: "d1", decision_status: "superseded" }], assumptions: [{ id: "a1", decision_id: "d1", state: "contradicted" }] }),
      reachedViaEdgeTypes: [],
    });
    expect(state).toBe("superseded");
  });

  it("assumption_contradicted", () => {
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: "d1",
      lookup: lookup({ assumptions: [{ id: "a1", decision_id: "d1", state: "contradicted" }] }),
      reachedViaEdgeTypes: [],
    });
    expect(state).toBe("assumption_contradicted");
  });

  it("assumption_weakened -- takes precedence over implementation_invalidated", () => {
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: "d1",
      lookup: lookup({
        decisions: [{ id: "d1", implementation_status: "broken" }],
        assumptions: [{ id: "a1", decision_id: "d1", state: "weakened" }],
      }),
      reachedViaEdgeTypes: [],
    });
    expect(state).toBe("assumption_weakened");
  });

  it("implementation_invalidated -- for both 'invalidated' and 'broken' implementation_status", () => {
    expect(
      classifyReachedDecisionImpact({ decisionSourceEntityId: "d1", lookup: lookup({ decisions: [{ id: "d1", implementation_status: "invalidated" }] }), reachedViaEdgeTypes: [] }),
    ).toBe("implementation_invalidated");
    expect(
      classifyReachedDecisionImpact({ decisionSourceEntityId: "d1", lookup: lookup({ decisions: [{ id: "d1", implementation_status: "broken" }] }), reachedViaEdgeTypes: [] }),
    ).toBe("implementation_invalidated");
  });

  it("unverifiable -- an assumption's own state is 'unverifiable'", () => {
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: "d1",
      lookup: lookup({ assumptions: [{ id: "a1", decision_id: "d1", state: "unverifiable" }] }),
      reachedViaEdgeTypes: [],
    });
    expect(state).toBe("unverifiable");
  });

  it("unverifiable -- base case when no decision state and no assumptions exist at all", () => {
    const state = classifyReachedDecisionImpact({ decisionSourceEntityId: "d1", lookup: emptyDecisionStateLookup(), reachedViaEdgeTypes: [] });
    expect(state).toBe("unverifiable");
  });

  it("review_required -- fallback when nothing else in the table matches", () => {
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: "d1",
      lookup: lookup({ decisions: [{ id: "d1", decision_status: "affirmed" }] }),
      reachedViaEdgeTypes: [],
    });
    expect(state).toBe("review_required");
  });
});

describe("regression: full pipeline scenario", () => {
  it("buildKnowledgeGraph output flows correctly through impact analysis, change planning, diff, validation, explain, narrative, and plan generation", () => {
    const input = {
      architecture: {
        identity: { id: "regression-repo" },
        components: [{ id: "svc-api" }, { id: "svc-worker" }],
      },
      capability: {
        domains: [{ id: "dom-core" }],
        includedCapabilities: [{ id: "cap-processing", domainId: "dom-core", logicalComponents: ["svc-api", "svc-worker"] }],
      },
      governance: {
        policies: [{ id: "pol-security" }],
        findings: [{ id: "find-1", policy_id: "pol-security", affected_entity_ids: ["svc-api"] }],
      },
      decision: { decisions: [{ id: "dec-adopt-worker", title: "Adopt background worker" }] },
      decisionLinks: { links: [{ id: "link-1", decision_id: "dec-adopt-worker", target_id: "svc-worker", link_type: "affects" }] },
    };

    const buildResult = buildKnowledgeGraph(input);
    expect(buildResult.compatibility.status).not.toBe("incompatible");
    expect(buildResult.nodes.length).toBeGreaterThan(0);

    const apiNodeId = buildResult.nodes.find((n) => n.source_entity_id === "svc-api")!.id;
    const decisionStateLookup = emptyDecisionStateLookup();

    const impact = runImpactAnalysis(buildResult.nodes, buildResult.edges, { entity_node_id: apiNodeId, max_depth: 10, direction: "both" }, decisionStateLookup);
    expect(impact.blast_radius_level).not.toBe("unresolved");

    const changePlan = planChange(buildResult.nodes, buildResult.edges, apiNodeId, decisionStateLookup);
    expect(changePlan.removed_entity_node_id).toBe(apiNodeId);

    const source: GraphSnapshotState = { snapshotId: "before", nodes: buildResult.nodes, edges: buildResult.edges };
    const target: GraphSnapshotState = { snapshotId: "after", nodes: buildResult.nodes.filter((n) => n.id !== apiNodeId), edges: buildResult.edges.filter((e) => e.from_node_id !== apiNodeId && e.to_node_id !== apiNodeId) };
    const changeSet = diffGraphs(source, target, { decisionStateLookup });
    expect(changeSet.nodes_removed).toEqual([apiNodeId]);

    const findings = validateGraph(buildResult);
    expect(Array.isArray(findings)).toBe(true);

    const explanation = explainGraphId(apiNodeId, { nodes: buildResult.nodes, edges: buildResult.edges });
    expect(explanation.resolved).toBe(buildResult.nodes.find((n) => n.id === apiNodeId));

    const narrative = buildKnowledgeGraphNarrative({
      snapshot: buildResult.snapshot,
      nodes: buildResult.nodes,
      edges: buildResult.edges,
      generatedAt: GENERATED_AT,
    });
    expect(narrative.sections.length).toBe(13);

    const plan = buildKnowledgeGraphPlan({
      snapshot: buildResult.snapshot,
      narrative,
      nodes: buildResult.nodes,
      edges: buildResult.edges,
      generatedAt: GENERATED_AT,
    });
    expect(plan.scenes.length).toBeGreaterThan(0);
  });

  it("decisionReachableFixture's decision is reachable end-to-end and correctly classified by computeDecisionImpact", () => {
    const { nodes, edges, entity, decision } = decisionReachableFixture();
    const lookup = makeDecisionStateLookup({ decisions: [{ id: decision.source_entity_id, decision_status: "superseded" }] });
    const impact = runImpactAnalysis(nodes, edges, { entity_node_id: entity.id, max_depth: 10, direction: "both" }, lookup);
    // decisions_affected on ImpactResult carries decision node ids only; the classified state comes from
    // computeDecisionImpact directly (impact-analysis.ts's own internal source of truth for that id list).
    expect(impact.decisions_affected).toContain(decision.id);
    const decisionImpactEntries = computeDecisionImpact(nodes, edges, entity.id, lookup);
    const entry = decisionImpactEntries.find((e) => e.decision_node_id === decision.id);
    expect(entry?.state).toBe("superseded");
  });
});
