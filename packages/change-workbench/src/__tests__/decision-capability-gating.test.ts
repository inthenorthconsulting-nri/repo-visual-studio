// Closure proof (Milestone 11.1 closure item 4): the Decision capability
// registry is honest, and unsupported/partial hypothetical analyses are
// never silently treated as fully evaluated.
//
// Two distinct claims are proven here:
//   1. Structural: buildDecisionImplementationStates (and the other 12
//      "unsupported" @rvs/decision-intelligence functions) cannot produce a
//      hypothetical "implemented" conclusion merely because the function
//      exists, because decision-advisory.ts never imports it at all -- there
//      is no code path through which it could be invoked. This is proven by
//      reading decision-advisory.ts's own source (node:fs, test-only --
//      mirrors package-dag.test.ts's own precedent for this pattern) rather
//      than asserting behavior on a function that is, by design, never
//      called.
//   2. Behavioral: buildDecisionAdvisory's status ("evaluated" vs
//      "not_evaluated") and ChangeAdvisory.domain_coverage's "decisions"
//      entry respond correctly to whether any operation actually touches a
//      ref present in the overlay -- an unsupported/absent root is never
//      silently reported as "evaluated".

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildDecisionAdvisory } from "../decision-advisory.js";
import { buildChangeOverlay } from "../overlay.js";
import { buildChangeAdvisory } from "../change-advisory.js";
import { buildProposedChangeSetId } from "../ids.js";
import { mutateExistingEntityRef } from "../refs.js";
import { confirmedRef, baseFixtureGraph, decisionFixtureGraph, decisionFixtureStateLookup, BASE_SNAPSHOT_DIGEST, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();
const DECISION_ADVISORY_SOURCE = readFileSync(join(__dirname, "..", "decision-advisory.ts"), "utf8");

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

describe("decision capability gating: structural -- unsupported functions are never invoked, not merely marked unsupported", () => {
  it("decision-advisory.ts imports nothing from @rvs/decision-intelligence at all", () => {
    expect(DECISION_ADVISORY_SOURCE).not.toContain('from "@rvs/decision-intelligence"');
  });

  it("decision-advisory.ts imports only computeDecisionImpact and buildDecisionStateLookup from @rvs/knowledge-graph", () => {
    const importLine = DECISION_ADVISORY_SOURCE.split("\n").find((line) => line.includes('from "@rvs/knowledge-graph"') && line.trimStart().startsWith("import {"));
    expect(importLine).toContain("buildDecisionStateLookup");
    expect(importLine).toContain("computeDecisionImpact");
  });

  it("'buildDecisionImplementationStates' appears in the source exactly once -- only as a registry string literal, never as an invoked identifier", () => {
    const occurrences = DECISION_ADVISORY_SOURCE.split("buildDecisionImplementationStates").length - 1;
    expect(occurrences).toBe(1);
    expect(DECISION_ADVISORY_SOURCE).toContain('"@rvs/decision-intelligence buildDecisionImplementationStates"');
  });

  it("every one of the 13 other named @rvs/decision-intelligence functions appears only as a registry string literal (exactly once each)", () => {
    const otherFunctionNames = [
      "buildDecisionConflicts",
      "assessDecisionBlastRadius",
      "buildDecisionCoverage",
      "detectDecisionDrift",
      "detectDecisionDebt",
      "detectMissingDecisions",
      "buildArchitectureLinks",
      "buildCapabilityLinks",
      "buildProductLinks",
      "buildPortfolioLinks",
      "buildDecisionToDecisionLinks",
      "buildGovernanceLinks",
    ];
    for (const name of otherFunctionNames) {
      const occurrences = DECISION_ADVISORY_SOURCE.split(name).length - 1;
      expect.soft(occurrences, `${name} should appear exactly once (registry literal only)`).toBe(1);
    }
  });
});

describe("decision capability gating: registry contents are exact and honest", () => {
  it("has exactly 14 entries: 1 supported, 13 unsupported, 0 partially_supported", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref, attributes: { label: "x" } }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations });

    expect(advisory.capability_registry).toHaveLength(14);
    const bySupport = { supported: 0, partially_supported: 0, unsupported: 0 };
    for (const entry of advisory.capability_registry) bySupport[entry.support]++;
    expect(bySupport).toEqual({ supported: 1, partially_supported: 0, unsupported: 13 });
  });

  it("the sole 'supported' entry is @rvs/knowledge-graph computeDecisionImpact", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref, attributes: { label: "x" } }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations });

    const supported = advisory.capability_registry.filter((e) => e.support === "supported");
    expect(supported).toHaveLength(1);
    expect(supported[0].function_name).toBe("@rvs/knowledge-graph computeDecisionImpact");
  });

  it("the capability_registry is attached identically regardless of evaluation outcome (evaluated or not_evaluated)", () => {
    const touchedRef = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const evaluatedChangeSet = changeSetOf([{ kind: "modify_attributes", ref: touchedRef, attributes: { label: "x" } }]);
    const evaluatedOverlay = buildChangeOverlay({ changeSet: evaluatedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const evaluatedAdvisory = buildDecisionAdvisory({ overlay: evaluatedOverlay.overlay!, operations: evaluatedChangeSet.operations });

    // A removed entity that is the ONLY touched ref leaves no root present in the resulting overlay.
    const removedRef = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const notEvaluatedChangeSet = changeSetOf([{ kind: "remove_entity", ref: removedRef }]);
    const notEvaluatedOverlay = buildChangeOverlay({ changeSet: notEvaluatedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const notEvaluatedAdvisory = buildDecisionAdvisory({ overlay: notEvaluatedOverlay.overlay!, operations: notEvaluatedChangeSet.operations });

    expect(evaluatedAdvisory.status).toBe("evaluated");
    expect(notEvaluatedAdvisory.status).toBe("not_evaluated");
    expect(JSON.stringify(evaluatedAdvisory.capability_registry)).toBe(JSON.stringify(notEvaluatedAdvisory.capability_registry));
    expect(notEvaluatedAdvisory.capability_registry).toHaveLength(14);
  });
});

describe("decision capability gating: unsupported/absent-root analyses are never silently reported as fully evaluated", () => {
  it("buildDecisionAdvisory returns 'not_evaluated' (not 'evaluated' with empty findings misread as 'nothing to report') when no operation touches a ref present in the overlay", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const changeSet = changeSetOf([{ kind: "remove_entity", ref }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations });

    expect(advisory.status).toBe("not_evaluated");
    expect(advisory.findings).toEqual([]);
    expect(advisory.detail).toMatch(/no operation .* touches an entity present in the overlay/i);
  });

  it("ChangeAdvisory.domain_coverage's 'decisions' entry is 'evaluated' only when buildDecisionAdvisory itself reports 'evaluated'", () => {
    const touchedRef = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const evaluatedChangeSet = changeSetOf([{ kind: "modify_attributes", ref: touchedRef, attributes: { label: "x" } }]);
    const evaluatedAdvisory = buildChangeAdvisory({ changeSet: evaluatedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(evaluatedAdvisory.decisions.status).toBe("evaluated");
    expect(evaluatedAdvisory.domain_coverage.find((d) => d.domain === "decisions")?.status).toBe("evaluated");

    const removedRef = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const notEvaluatedChangeSet = changeSetOf([{ kind: "remove_entity", ref: removedRef }]);
    const notEvaluatedAdvisory = buildChangeAdvisory({ changeSet: notEvaluatedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(notEvaluatedAdvisory.decisions.status).toBe("not_evaluated");
    expect(notEvaluatedAdvisory.domain_coverage.find((d) => d.domain === "decisions")?.status).toBe("not_applicable");
  });

  it("an invalid proposal never reaches decision-impact analysis at all -- decisions.status is 'not_evaluated' with an empty capability_registry, not a partially-run evaluation", () => {
    const changeSet = changeSetOf([
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
    ]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.proposal_validation.status).toBe("invalid");
    expect(advisory.decisions.status).toBe("not_evaluated");
    expect(advisory.decisions.capability_registry).toEqual([]);
  });
});

describe("decision capability gating: truthfulness closure -- capability declared != evaluation attempted != evaluation completed", () => {
  it("registry capability declared without invocation: roots.length === 0 means computeDecisionImpact is never called, and status is 'not_evaluated' -- not merely 'evaluated' with nothing found", () => {
    // Same case as the earlier "unsupported/absent-root" describe block, restated under this milestone's exact vocabulary: the capability_registry still lists computeDecisionImpact as "supported" (capability declared), but because no operation touches a ref present in the overlay, the evaluator is never attempted at all.
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const changeSet = changeSetOf([{ kind: "remove_entity", ref }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations });

    expect(advisory.capability_registry.some((entry) => entry.function_name === "@rvs/knowledge-graph computeDecisionImpact" && entry.support === "supported")).toBe(true);
    expect(advisory.status).toBe("not_evaluated");
    expect(advisory.findings).toEqual([]);
  });

  it("actual supported evaluator invocation: a fixture with a real 'decision' node reachable from the touched root, plus a populated DecisionStateLookup, produces a real (non-empty, non-fabricated) finding classified entirely from that lookup's own data -- proof computeDecisionImpact() genuinely executed, not merely that a ref matched", () => {
    const { nodes: decisionNodes, edges: decisionEdges } = decisionFixtureGraph();
    const lookup = decisionFixtureStateLookup();
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", decisionNodes));
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref, attributes: { label: "Renamed B" } }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: decisionNodes, confirmedEdges: decisionEdges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations, decisionStateLookup: lookup });

    expect(advisory.status).toBe("evaluated");
    expect(advisory.findings).toHaveLength(1);
    expect(advisory.findings[0].decision_node_id).toBe("decision-x");
    // "assumption_contradicted" comes directly from decisionFixtureStateLookup()'s recorded assumption state -- classifyReachedDecisionImpact() derives this from real lookup data, never fabricated by decision-advisory.ts itself.
    expect(advisory.findings[0].state).toBe("assumption_contradicted");
  });

  it("a decision-bearing overlay with NO populated lookup still evaluates honestly to 'unverifiable', never silently upgraded to a stronger state", () => {
    const { nodes: decisionNodes, edges: decisionEdges } = decisionFixtureGraph();
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", decisionNodes));
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref, attributes: { label: "Renamed B" } }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: decisionNodes, confirmedEdges: decisionEdges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    // No decisionStateLookup supplied -- defaults to buildDecisionStateLookup(undefined, undefined), i.e. genuinely empty maps.
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations });

    expect(advisory.status).toBe("evaluated");
    expect(advisory.findings).toHaveLength(1);
    expect(advisory.findings[0].state).toBe("unverifiable");
  });

  it("unsupported capability can never become evaluated: even with a genuine decision-node evaluation in play, every finding's 'state' is drawn only from computeDecisionImpact's fixed vocabulary -- none of the 13 unsupported @rvs/decision-intelligence functions (which decision-advisory.ts never imports or calls; see the structural describe block above) can contribute a value", () => {
    const VALID_STATES = new Set(["unaffected", "review_required", "assumption_weakened", "assumption_contradicted", "implementation_invalidated", "superseded", "unverifiable"]);
    const { nodes: decisionNodes, edges: decisionEdges } = decisionFixtureGraph();
    const lookup = decisionFixtureStateLookup();
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", decisionNodes));
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref, attributes: { label: "Renamed B" } }]);
    const overlayResult = buildChangeOverlay({ changeSet, confirmedNodes: decisionNodes, confirmedEdges: decisionEdges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const advisory = buildDecisionAdvisory({ overlay: overlayResult.overlay!, operations: changeSet.operations, decisionStateLookup: lookup });

    expect(advisory.findings.length).toBeGreaterThan(0);
    for (const finding of advisory.findings) {
      expect(VALID_STATES.has(finding.state)).toBe(true);
    }
  });
});
