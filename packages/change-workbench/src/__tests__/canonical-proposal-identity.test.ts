// Milestone 11.3.3A-W: proves ChangeAdvisory.proposal_id and
// ChangeWorkbenchEvaluation.proposal_id are always the canonical identity of
// repository_id + operations (buildProposedChangeSetId()), never a
// caller-supplied ProposedChangeSet.id trusted verbatim. Every legitimate
// caller (composeProposedChangeSet()/decodeProposedChangeSet()) already
// produces changeSet.id === buildProposedChangeSetId(...), so this closes a
// gap that is only reachable by a direct-library caller who bypasses both --
// e.g. a hand-built object literal or a post-mint mutation. See
// change-advisory.ts's buildChangeAdvisoryFromEvaluationInputs() and
// evaluation.ts's evaluateProposedChange() for the fix itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildChangeAdvisoryId, buildProposedChangeSetId } from "../ids.js";
import { buildChangeAdvisory, composeProposedChangeSet } from "../change-advisory.js";
import { evaluateProposedChange } from "../evaluation.js";
import { mutateExistingEntityRef } from "../refs.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, REPOSITORY_ID, rotate } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function operationsA(): ProposalOperation[] {
  return [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }];
}

function operationsB(): ProposalOperation[] {
  return [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)), attributes: { label: "Renamed C" } }];
}

function evaluate(changeSet: ProposedChangeSet) {
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
}

describe("canonical proposal identity: (A) canonical proposal unchanged", () => {
  it("a proposal built through composeProposedChangeSet() reports exactly its own canonical id everywhere", () => {
    const operations = operationsA();
    const changeSet = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
    const canonicalProposalId = buildProposedChangeSetId(REPOSITORY_ID, operations);

    expect(changeSet.id).toBe(canonicalProposalId);

    const evaluation = evaluate(changeSet);
    expect(evaluation.proposal_id).toBe(canonicalProposalId);
    expect(evaluation.advisory.proposal_id).toBe(canonicalProposalId);

    const advisory = buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.proposal_id).toBe(canonicalProposalId);
  });
});

describe("canonical proposal identity: (B, E) forged arbitrary id, via direct evaluateProposedChange() call", () => {
  it("a hand-forged id is never trusted -- evaluation.proposal_id and evaluation.advisory.proposal_id are both the recomputed canonical id", () => {
    const operations = operationsA();
    const canonicalProposalId = buildProposedChangeSetId(REPOSITORY_ID, operations);
    const forgedChangeSet: ProposedChangeSet = { schema_version: 1, id: "forged", repository_id: REPOSITORY_ID, operations };

    const evaluation = evaluate(forgedChangeSet);

    expect(evaluation.proposal_id).not.toBe("forged");
    expect(evaluation.proposal_id).toBe(canonicalProposalId);
    expect(evaluation.advisory.proposal_id).toBe(canonicalProposalId);
  });

  it("an invalid-proposal evaluation (advisory's invalid-branch return) is equally protected", () => {
    const operations: ProposalOperation[] = [
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
    ];
    const canonicalProposalId = buildProposedChangeSetId(REPOSITORY_ID, operations);
    const forgedChangeSet: ProposedChangeSet = { schema_version: 1, id: "forged", repository_id: REPOSITORY_ID, operations };

    const evaluation = evaluate(forgedChangeSet);
    expect(evaluation.proposal_validation.status).toBe("invalid");
    expect(evaluation.proposal_id).toBe(canonicalProposalId);
    expect(evaluation.advisory.proposal_id).toBe(canonicalProposalId);
  });
});

describe("canonical proposal identity: (C) another proposal's genuine id, stamped onto different operations", () => {
  it("proposal A's real id stamped onto proposal B's operations still identifies B, never A", () => {
    const proposalA = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations: operationsA() });
    const operationsForB = operationsB();
    const canonicalIdForB = buildProposedChangeSetId(REPOSITORY_ID, operationsForB);
    expect(proposalA.id).not.toBe(canonicalIdForB);

    const spoofedChangeSet: ProposedChangeSet = { schema_version: 1, id: proposalA.id, repository_id: REPOSITORY_ID, operations: operationsForB };
    const evaluation = evaluate(spoofedChangeSet);

    expect(evaluation.proposal_id).not.toBe(proposalA.id);
    expect(evaluation.proposal_id).toBe(canonicalIdForB);
    expect(evaluation.advisory.proposal_id).toBe(canonicalIdForB);
  });
});

describe("canonical proposal identity: (D) operation ordering", () => {
  it("equivalent operations in a different array order retain the same canonical proposal id, per buildProposedChangeSetId()'s own shuffle-invariance", () => {
    const base = [
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } },
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)), attributes: { label: "Renamed C" } },
    ] as ProposalOperation[];

    const evaluations = [0, 1].map((shift) => {
      const operations = rotate(base, shift);
      const changeSet: ProposedChangeSet = { schema_version: 1, id: "irrelevant-forged-id", repository_id: REPOSITORY_ID, operations };
      return evaluate(changeSet);
    });

    expect(evaluations[0].proposal_id).toBe(evaluations[1].proposal_id);
    expect(evaluations[0].proposal_id).toBe(buildProposedChangeSetId(REPOSITORY_ID, base));
  });
});

describe("canonical proposal identity: (F) buildChangeAdvisory() -- the second public entry path", () => {
  it("a forged id is never trusted by buildChangeAdvisory() either", () => {
    const operations = operationsA();
    const canonicalProposalId = buildProposedChangeSetId(REPOSITORY_ID, operations);
    const forgedChangeSet: ProposedChangeSet = { schema_version: 1, id: "forged", repository_id: REPOSITORY_ID, operations };

    const advisory = buildChangeAdvisory({ changeSet: forgedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.proposal_id).not.toBe("forged");
    expect(advisory.proposal_id).toBe(canonicalProposalId);
    expect(advisory.id).toBe(buildChangeAdvisoryId(canonicalProposalId, BASE_SNAPSHOT_DIGEST));
  });

  it("proposal A's genuine id stamped onto proposal B's operations still identifies B via buildChangeAdvisory()", () => {
    const proposalA = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations: operationsA() });
    const operationsForB = operationsB();
    const canonicalIdForB = buildProposedChangeSetId(REPOSITORY_ID, operationsForB);
    const spoofedChangeSet: ProposedChangeSet = { schema_version: 1, id: proposalA.id, repository_id: REPOSITORY_ID, operations: operationsForB };

    const advisory = buildChangeAdvisory({ changeSet: spoofedChangeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(advisory.proposal_id).not.toBe(proposalA.id);
    expect(advisory.proposal_id).toBe(canonicalIdForB);
  });
});

describe("canonical proposal identity: (G) envelope/advisory consistency invariant", () => {
  const cases: Array<{ name: string; changeSet: ProposedChangeSet }> = [
    { name: "canonical", changeSet: composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations: operationsA() }) },
    { name: "forged id", changeSet: { schema_version: 1, id: "forged", repository_id: REPOSITORY_ID, operations: operationsA() } },
    { name: "another proposal's genuine id", changeSet: { schema_version: 1, id: composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations: operationsB() }).id, repository_id: REPOSITORY_ID, operations: operationsA() } },
    {
      name: "invalid proposal, forged id",
      changeSet: {
        schema_version: 1,
        id: "forged",
        repository_id: REPOSITORY_ID,
        operations: [
          { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
          { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
        ],
      },
    },
  ];

  for (const { name, changeSet } of cases) {
    it(`evaluation.proposal_id === evaluation.advisory.proposal_id (${name})`, () => {
      const evaluation = evaluate(changeSet);
      expect(evaluation.proposal_id).toBe(evaluation.advisory.proposal_id);
      expect(evaluation.proposal_id).toBe(buildProposedChangeSetId(changeSet.repository_id, changeSet.operations));
    });
  }
});

// Static proof (Milestone 11.3.3A-W §14): this slice reuses
// buildProposedChangeSetId() rather than introducing a second proposal-ID
// hashing/canonicalization routine. Source-text scanning, not a type-aware
// call graph -- same convention as forbidden-evaluator-call.test.ts and
// package-dag.test.ts.
describe("canonical proposal identity: static proof of no second identity authority", () => {
  const SRC_DIR = join(__dirname, "..");

  it("change-advisory.ts's buildChangeAdvisoryFromEvaluationInputs() computes canonicalProposalId via buildProposedChangeSetId(), not a local hash routine", () => {
    const source = readFileSync(join(SRC_DIR, "change-advisory.ts"), "utf8");
    const start = source.indexOf("export function buildChangeAdvisoryFromEvaluationInputs");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    expect(/\bbuildProposedChangeSetId\s*\(/.test(body)).toBe(true);
    expect(/\bcreateHash\s*\(/.test(body)).toBe(false);
  });

  it("evaluation.ts never independently re-reads changeSet.id for proposal_id -- it reads back off advisory.proposal_id", () => {
    const source = readFileSync(join(SRC_DIR, "evaluation.ts"), "utf8");
    const returnStart = source.indexOf("return {", source.indexOf("export function evaluateProposedChange("));
    expect(returnStart).toBeGreaterThan(-1);
    const returnBody = source.slice(returnStart, source.indexOf("};", returnStart));
    expect(/proposal_id:\s*advisory\.proposal_id/.test(returnBody)).toBe(true);
    expect(/proposal_id:\s*changeSet\.id/.test(returnBody)).toBe(false);
  });

  it("neither file defines a local canonicalize/digestOf/createHash routine of its own", () => {
    for (const file of ["change-advisory.ts", "evaluation.ts"]) {
      const source = readFileSync(join(SRC_DIR, file), "utf8");
      expect(/\bcreateHash\s*\(/.test(source)).toBe(false);
      expect(/\bfunction\s+canonicalize\s*\(/.test(source)).toBe(false);
      expect(/\bfunction\s+digestOf\s*\(/.test(source)).toBe(false);
    }
  });
});
