// End-to-end composition tests for buildChangeAdvisory(): topology
// disclosure logic (never implying zero impact from missing data),
// domain-coverage assembly, and the invalid-proposal short-circuit.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildChangeAdvisory, composeProposedChangeSet } from "../change-advisory.js";
import { proposeEntityRef, mutateExistingEntityRef } from "../refs.js";
import { buildProposedChangeSetId } from "../ids.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

describe("change-advisory: topology disclosure never implies zero impact from missing data", () => {
  it("a newly proposed entity with no declared relations is 'not_supplied', never read as 'has no relations'", () => {
    const ref = proposeEntityRef("topology-fixture", "isolated-new");
    const changeSet = changeSetOf([{ kind: "add_entity", ref, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "isolated-new", label: "Isolated New", repository_id: REPOSITORY_ID }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const disclosure = advisory.topology.find((d) => d.entity_refs.includes(ref));
    expect(disclosure?.status).toBe("not_supplied");
  });

  it("a newly proposed entity WITH a declared relation is 'partial', not 'explicit'", () => {
    const ref = proposeEntityRef("topology-fixture", "connected-new");
    const changeSet = changeSetOf([
      { kind: "add_entity", ref, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "connected-new", label: "Connected New", repository_id: REPOSITORY_ID },
      { kind: "add_relation", from_ref: ref, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    ]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const disclosure = advisory.topology.find((d) => d.entity_refs.length === 1 && d.entity_refs[0] === ref);
    expect(disclosure?.status).toBe("partial");
  });

  it("an untouched entity's topology is 'explicit' -- inherited unchanged, not missing", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const disclosure = advisory.topology.find((d) => d.entity_refs.includes("comp-b"));
    expect(disclosure?.status).toBe("explicit");
  });

  it("a removed entity's cascading edge removal is 'explicit' -- a known deterministic consequence", () => {
    const changeSet = changeSetOf([{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const disclosure = advisory.topology.find((d) => d.entity_refs.includes("comp-b"));
    expect(disclosure?.status).toBe("explicit");
  });
});

describe("change-advisory: invalid proposal short-circuit", () => {
  it("never builds an overlay or runs impact/decision analysis for an invalid proposal", () => {
    const changeSet = changeSetOf([
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
    ]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.proposal_validation.status).toBe("invalid");
    expect(advisory.impact.status).toBe("not_evaluated");
    expect(advisory.decisions.status).toBe("not_evaluated");
    expect(advisory.domain_coverage.find((d) => d.domain === "impact")?.status).toBe("not_applicable");
    expect(advisory.domain_coverage.find((d) => d.domain === "decisions")?.status).toBe("not_applicable");
  });
});

describe("change-advisory: domain coverage assembly reflects each sub-result's own status", () => {
  it("marks impact/decisions 'evaluated' when the overlay has roots to analyze from", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.domain_coverage.find((d) => d.domain === "impact")?.status).toBe("evaluated");
    expect(advisory.domain_coverage.find((d) => d.domain === "decisions")?.status).toBe("evaluated");
    expect(advisory.domain_coverage.find((d) => d.domain === "governance")?.status).toBe("not_applicable");
  });

  it("a removed entity that was the ONLY touched ref leaves no root present in the resulting overlay, so impact is not_evaluated", () => {
    const changeSet = changeSetOf([{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.impact.status).toBe("not_evaluated");
  });

  it("impact analysis runs downstream from a modified node and finds the directly downstream dependent (one hop: comp-b -> comp-c)", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);
    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.impact.directly_affected_refs).toContain("comp-c");
  });
});

describe("change-advisory: composeProposedChangeSet", () => {
  it("produces the same id as calling buildProposedChangeSetId directly", () => {
    const operations: ProposalOperation[] = [{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) }];
    const changeSet = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
    expect(changeSet.id).toBe(buildProposedChangeSetId(REPOSITORY_ID, operations));
    expect(changeSet.repository_id).toBe(REPOSITORY_ID);
    expect(changeSet.operations).toBe(operations);
  });
});
