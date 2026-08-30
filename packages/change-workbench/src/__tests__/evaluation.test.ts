// Tests for evaluateProposedChange() (Milestone 11.3.1A): the canonical
// Workbench evaluation entry point that fixes the information-loss gap
// where buildChangeAdvisory() computed OverlayBuildResult.issues but never
// preserved them past its own local scope. See evaluation.ts and
// contracts.ts's ChangeWorkbenchEvaluation header comment for the envelope
// shape this proves.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildProposedChangeSetId } from "../ids.js";
import { buildChangeAdvisory } from "../change-advisory.js";
import { buildChangeOverlay } from "../overlay.js";
import { evaluateProposedChange } from "../evaluation.js";
import { proposeEntityRef, mutateExistingEntityRef } from "../refs.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, REPOSITORY_ID, rotate } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

describe("evaluateProposedChange: valid proposal, clean projection", () => {
  it("produces a 'built' projection and an advisory byte-identical to buildChangeAdvisory()'s own output", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);

    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const directAdvisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(evaluation.projection.status).toBe("built");
    expect(JSON.stringify(evaluation.advisory)).toBe(JSON.stringify(directAdvisory));
    expect(evaluation.advisory.id).toBe(directAdvisory.id);
  });

  it("projection.result is semantically equivalent to calling buildChangeOverlay() directly", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);

    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const directOverlay = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(evaluation.projection.status).toBe("built");
    if (evaluation.projection.status !== "built") throw new Error("unreachable");
    expect(JSON.stringify(evaluation.projection.result)).toBe(JSON.stringify(directOverlay));
  });
});

describe("evaluateProposedChange: unresolved overlay reference survives into the projection outcome (M11.3.1A's primary fixture)", () => {
  it("an add_relation whose endpoint resolves to nothing produces a projection issue that never reaches ChangeAdvisory today, but does reach ChangeWorkbenchEvaluation.projection", () => {
    const danglingRef = proposeEntityRef("evaluation-fixture", "never-added");
    const changeSet = changeSetOf([{ kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: danglingRef, edge_type: "depends_on" }]);

    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    // The proposal itself is not invalid -- add_relation endpoints are only
    // resolved at overlay-construction time, not at validation time (see
    // validation.ts: add_relation never calls confirmedRefIssue on its
    // refs). This is exactly the case where a proposal "validates" but the
    // resulting overlay still carries a real, non-blocking issue.
    expect(evaluation.proposal_validation.status).not.toBe("invalid");
    expect(evaluation.projection.status).toBe("built");
    if (evaluation.projection.status !== "built") throw new Error("unreachable");

    expect(evaluation.projection.result.issues.length).toBeGreaterThan(0);
    const issue = evaluation.projection.result.issues.find((i) => i.code === "unresolved_add_relation_endpoint");
    expect(issue).toBeDefined();
    expect(issue?.blocking).toBe(false);

    // The advisory this same evaluation carries still exists -- an
    // unresolved projection reference does not prevent advisory
    // construction, and does not get merged into proposal_validation.issues.
    expect(evaluation.advisory).toBeDefined();
    expect(evaluation.advisory.proposal_validation.issues.some((i) => i.code === "unresolved_add_relation_endpoint")).toBe(false);

    // The overlay-build issue does not change topology disclosure -- it is
    // not topology authority. comp-a's relation is still disclosed as
    // "explicit" purely from the add_relation operation itself.
    const topologyForA = evaluation.advisory.topology.find((d) => d.entity_refs.includes("comp-a"));
    expect(topologyForA?.status).toBe("explicit");
  });
});

describe("evaluateProposedChange: invalid proposal", () => {
  it("produces a 'not_built' projection, never an empty-array stand-in, while the advisory still preserves its existing invalid-path semantics", () => {
    const changeSet = changeSetOf([
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
    ]);

    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const directAdvisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(evaluation.proposal_validation.status).toBe("invalid");
    expect(evaluation.projection.status).toBe("not_built");
    if (evaluation.projection.status !== "not_built") throw new Error("unreachable");
    expect(typeof evaluation.projection.reason).toBe("string");
    expect(evaluation.projection.reason.length).toBeGreaterThan(0);

    expect(JSON.stringify(evaluation.advisory)).toBe(JSON.stringify(directAdvisory));
    expect(evaluation.advisory.impact.status).toBe("not_evaluated");
    expect(evaluation.advisory.decisions.status).toBe("not_evaluated");
  });
});

describe("evaluateProposedChange: identity contract", () => {
  it("repository_id/proposal_id/base_snapshot_digest independently match the advisory's own identity fields", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);
    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(evaluation.repository_id).toBe(evaluation.advisory.repository_id);
    expect(evaluation.proposal_id).toBe(evaluation.advisory.proposal_id);
    expect(evaluation.base_snapshot_digest).toBe(evaluation.advisory.base_snapshot_digest);
    expect(evaluation.repository_id).toBe(REPOSITORY_ID);
    expect(evaluation.proposal_id).toBe(changeSet.id);
    expect(evaluation.base_snapshot_digest).toBe(BASE_SNAPSHOT_DIGEST);
  });

  it("for a built projection, the overlay's own repository_id/base_snapshot_digest also match -- and the overlay deliberately carries no proposal_id of its own", () => {
    const changeSet = changeSetOf([{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }]);
    const evaluation = evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(evaluation.projection.status).toBe("built");
    if (evaluation.projection.status !== "built") throw new Error("unreachable");
    const overlay = evaluation.projection.result.overlay;
    expect(overlay?.repository_id).toBe(evaluation.repository_id);
    expect(overlay?.base_snapshot_digest).toBe(evaluation.base_snapshot_digest);
    expect(overlay && "proposal_id" in overlay).toBe(false);
  });
});

describe("evaluateProposedChange: determinism", () => {
  const newEntity = proposeEntityRef("evaluation-determinism-fixture", "new-1");

  function buildOperations(): ProposalOperation[] {
    return [
      { kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
      { kind: "add_relation", from_ref: newEntity, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)), attributes: { label: "Renamed C" } },
      { kind: "remove_relation", from_ref: confirmedRef("comp-b", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "depends_on" },
    ];
  }

  it("produces a byte-identical evaluation across 5 shuffled operation orderings", () => {
    const base = buildOperations();
    const evaluations = [0, 1, 2, 3, 4].map((shift) => {
      const operations = rotate(base, shift);
      const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
      return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    });

    const serialized = evaluations.map((e) => JSON.stringify(e));
    for (let i = 1; i < serialized.length; i++) expect(serialized[i]).toBe(serialized[0]);
    expect(new Set(evaluations.map((e) => e.advisory.id)).size).toBe(1);
  });

  it("produces a byte-identical evaluation across 5 repeated runs of the identical (unshuffled) proposal", () => {
    const operations = buildOperations();
    const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
    const evaluations = [0, 1, 2, 3, 4].map(() => evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST }));
    const serialized = evaluations.map((e) => JSON.stringify(e));
    for (let i = 1; i < serialized.length; i++) expect(serialized[i]).toBe(serialized[0]);
  });
});

// Static call-graph proof (Milestone 11.3.1A §3/§33's "evaluate once"
// invariant): reads this package's own source text and counts call sites,
// rather than mocking, per this suite's no-brittle-mocks convention
// (see package-dag.test.ts for the same fs-based static-analysis style).
describe("evaluateProposedChange: static call-graph proof of 'evaluate once'", () => {
  const SRC_DIR = join(__dirname, "..");

  function callCount(source: string, fnName: string): number {
    const matches = source.match(new RegExp(`(?<!function )\\b${fnName}\\(`, "g"));
    return matches ? matches.length : 0;
  }

  it("evaluation.ts's evaluateProposedChange() function body calls validateProposedChangeSet() and buildChangeOverlay() exactly once each", () => {
    const source = readFileSync(join(SRC_DIR, "evaluation.ts"), "utf8");
    const start = source.indexOf("export function evaluateProposedChange(");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    expect(callCount(body, "validateProposedChangeSet")).toBe(1);
    expect(callCount(body, "buildChangeOverlay")).toBe(1);
  });

  it("buildChangeAdvisoryFromEvaluationInputs() in change-advisory.ts never calls validateProposedChangeSet() or buildChangeOverlay() -- it has no access to confirmedNodes/confirmedEdges to do so", () => {
    const source = readFileSync(join(SRC_DIR, "change-advisory.ts"), "utf8");
    const start = source.indexOf("export function buildChangeAdvisoryFromEvaluationInputs");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    expect(callCount(body, "validateProposedChangeSet")).toBe(0);
    expect(callCount(body, "buildChangeOverlay")).toBe(0);
  });

  it("buildChangeAdvisory() itself still calls validateProposedChangeSet() and buildChangeOverlay() exactly once each, preserving its existing public-API behavior", () => {
    const source = readFileSync(join(SRC_DIR, "change-advisory.ts"), "utf8");
    const start = source.indexOf("export function buildChangeAdvisory(");
    const end = source.indexOf("export interface BuildChangeAdvisoryFromEvaluationInputsParams");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(callCount(body, "validateProposedChangeSet")).toBe(1);
    expect(callCount(body, "buildChangeOverlay")).toBe(1);
  });
});
