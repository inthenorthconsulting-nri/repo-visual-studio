// Core behavioral proof for buildProposalReviewVisualInput() (Milestone
// 11.3.1). Covers: determinism, provenance preservation, the
// not_built-vs-empty-built distinction, baseline/identity mismatch hard
// failures, a forbidden-wording regression sweep over the FULL serialized
// output (not just truth_disclosure.qualification_text), and
// freshness-isolation (the caller-supplied advisoryFreshness passes
// through unmodified across all three states).

import { describe, expect, it } from "vitest";
import type { ChangeWorkbenchEvaluation, OverlayBuildResult } from "@rvs/change-workbench";
import { FORBIDDEN_PROPOSAL_TRUTH_WORDING } from "@rvs/visual-intelligence";
import type { ProposalAdvisoryFreshness } from "@rvs/visual-intelligence";

import { buildProposalReviewVisualInput } from "../adapter.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, compatibleObservedBaseline, invalidEvaluation, invalidProposal, mixedProvenanceEvaluation, mixedProvenanceProposal, validEvaluation, validProposal } from "./fixtures.js";

describe("buildProposalReviewVisualInput: determinism", () => {
  it("the same evaluation/baseline/freshness produce a byte-identical result across repeated calls", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const first = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    const second = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("two structurally-identical-but-distinct evaluation objects (same content, different references) produce the same id", () => {
    const evaluationA = validEvaluation();
    const evaluationB = JSON.parse(JSON.stringify(validEvaluation())) as ChangeWorkbenchEvaluation;
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const resultA = buildProposalReviewVisualInput({ evaluation: evaluationA, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    const resultB = buildProposalReviewVisualInput({ evaluation: evaluationB, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });

    expect(resultA.status).toBe("ok");
    expect(resultB.status).toBe("ok");
    if (resultA.status === "ok" && resultB.status === "ok") {
      expect(resultA.input.id).toBe(resultB.input.id);
      expect(JSON.stringify(resultA.input)).toBe(JSON.stringify(resultB.input));
    }
  });
});

describe("buildProposalReviewVisualInput: provenance preservation", () => {
  it("all four OverlayEntityProvenance values survive verbatim through a mixed removal/modification/addition proposal", () => {
    const evaluation = mixedProvenanceEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: mixedProvenanceProposal() });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.input.projection.status).toBe("built");
    if (result.input.projection.status !== "built") return;
    const overlayResult: OverlayBuildResult = result.input.projection.result;
    expect(overlayResult.overlay).toBeDefined();
    const provenanceValues = new Set([...Object.values(overlayResult.overlay!.node_provenance), ...Object.values(overlayResult.overlay!.edge_provenance)]);
    expect(provenanceValues.has("confirmed")).toBe(true);
    expect(provenanceValues.has("removed")).toBe(true);
    expect(provenanceValues.has("modified")).toBe(true);
    expect(provenanceValues.has("proposed")).toBe(true);

    // Byte-identical to the source evaluation's own projection -- never
    // recomputed, re-derived, or re-inferred by this package.
    expect(JSON.stringify(result.input.projection)).toBe(JSON.stringify(evaluation.projection));
  });
});

describe("buildProposalReviewVisualInput: not_built vs empty-built distinctness", () => {
  it("an invalid (blocking) proposal yields projection.status === 'not_built', never a fabricated empty 'built' overlay", () => {
    const evaluation = invalidEvaluation();
    expect(evaluation.proposal_validation.status).toBe("invalid");
    expect(evaluation.projection.status).toBe("not_built");

    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: invalidProposal() });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.projection.status).toBe("not_built");
    expect(JSON.stringify(result.input.projection)).toBe(JSON.stringify(evaluation.projection));
    // Must never carry a "built" projection with an empty overlay standing in for the not_built outcome.
    expect((result.input.projection as { status: string }).status).not.toBe("built");
  });

  it("a valid proposal's 'built' projection is distinct in shape from a not_built one -- both pass through untouched", () => {
    const built = validEvaluation();
    const notBuilt = invalidEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const builtResult = buildProposalReviewVisualInput({ evaluation: built, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    const notBuiltResult = buildProposalReviewVisualInput({ evaluation: notBuilt, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: invalidProposal() });

    expect(builtResult.status).toBe("ok");
    expect(notBuiltResult.status).toBe("ok");
    if (builtResult.status === "ok" && notBuiltResult.status === "ok") {
      expect(builtResult.input.projection.status).toBe("built");
      expect(notBuiltResult.input.projection.status).toBe("not_built");
    }
  });
});

describe("buildProposalReviewVisualInput: baseline/identity mismatch hard failures", () => {
  it("rejects when observedBaseline.repository_id disagrees with evaluation.repository_id", () => {
    const evaluation = validEvaluation();
    const observedBaseline = { ...compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST), repository_id: "some-other-repo" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH")).toBe(true);
  });

  it("rejects when observedBaseline.digest disagrees with evaluation.base_snapshot_digest", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline("a-completely-different-digest");

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.proposal_id disagrees with evaluation.proposal_id", () => {
    const evaluation: ChangeWorkbenchEvaluation = { ...validEvaluation() };
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, proposal_id: "a-different-proposal-id" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_PROPOSAL_ID_INCONSISTENT")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.repository_id disagrees with evaluation.repository_id", () => {
    const evaluation = validEvaluation();
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, repository_id: "a-different-repo-id" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_REPOSITORY_ID_INCONSISTENT")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.base_snapshot_digest disagrees with evaluation.base_snapshot_digest", () => {
    const evaluation = validEvaluation();
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, base_snapshot_digest: "a-different-base-snapshot-digest" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_BASE_SNAPSHOT_DIGEST_INCONSISTENT")).toBe(true);
  });

  it("each mismatch check fires independently -- a doubly-wrong input reports both issues (plus the recomputed baseline-graph-digest check, which a fabricated 'wrong-digest' necessarily also fails)", () => {
    const evaluation = validEvaluation();
    const observedBaseline = { ...compatibleObservedBaseline("wrong-digest"), repository_id: "wrong-repo" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.length).toBe(3);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH");
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH");
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_GRAPH_DIGEST_MISMATCH");
  });

  it("rejects when the supplied proposal's id disagrees with evaluation.proposal_id", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const mismatchedProposal = { ...validProposal(), id: "a-different-proposal-id" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: mismatchedProposal });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_ID_MISMATCH")).toBe(true);
  });

  it("rejects when the supplied proposal's repository_id disagrees with evaluation.repository_id", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const mismatchedProposal = { ...validProposal(), repository_id: "a-different-repo-id" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: mismatchedProposal });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_REPOSITORY_MISMATCH")).toBe(true);
  });

  it("rejects when the supplied observed baseline graph's node count disagrees with observedBaseline.node_count", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const mismatchedGraph = { nodes: nodes.slice(1), edges };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: mismatchedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH")).toBe(true);
  });

  it("rejects when the supplied observed baseline graph's edge count disagrees with observedBaseline.edge_count", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const mismatchedGraph = { nodes, edges: edges.slice(1) };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: mismatchedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH")).toBe(true);
  });
});

describe("buildProposalReviewVisualInput: Milestone 11.3.3A cryptographic content-binding hard failures", () => {
  it("rejects a proposal whose claimed id is unchanged but whose operations payload has been altered (same-id/different-operations attack) -- string equality of proposal.id alone would have silently accepted this", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const genuine = validProposal();
    // Same claimed id, same repository_id -- only the operations payload
    // (an attribute a hostile or buggy caller controls freely, since
    // ProposedChangeSet is a plain, unbranded structural interface) is
    // tampered with after the fact.
    const tamperedOperations = { ...genuine, operations: [...genuine.operations, genuine.operations[0]] };
    expect(tamperedOperations.id).toBe(genuine.id);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: tamperedOperations });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_OPERATIONS_CONTENT_MISMATCH")).toBe(true);
    // The weaker, pre-existing id-string check does NOT fire -- proving
    // the new check is doing genuinely new work, not duplicating it.
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_ID_MISMATCH")).toBe(false);
  });

  it("accepts a proposal whose operations array has been reordered -- buildProposedChangeSetId() is order-independent by construction, so this is not a false-positive content mismatch", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const genuine = validProposal();
    expect(genuine.operations.length).toBeGreaterThan(1);
    const reordered = { ...genuine, operations: [...genuine.operations].reverse() };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: reordered });
    expect(result.status).toBe("ok");
  });

  it("rejects an observed baseline graph with the correct node/edge COUNTS but different node content (same-count/different-graph attack) -- count-only checks would have silently accepted this", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    // Same node COUNT (3) and same node ids (so edges, which reference
    // from/to node ids, remain structurally valid) -- only a non-id
    // attribute (label) differs, which is enough to change the digest
    // since buildGraphSnapshot's node_ids/edge_ids inputs are themselves
    // unaffected... so instead swap in a genuinely different node id to
    // actually change the id-set the digest covers, while preserving the
    // count.
    const swappedNodes = [...nodes.slice(0, 2), { ...nodes[2], id: "comp-c-imposter" }];
    const sameCountDifferentGraph = { nodes: swappedNodes, edges };
    expect(sameCountDifferentGraph.nodes.length).toBe(observedBaseline.node_count);
    expect(sameCountDifferentGraph.edges.length).toBe(observedBaseline.edge_count);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: sameCountDifferentGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_DIGEST_MISMATCH")).toBe(true);
    // The weaker, pre-existing count checks do NOT fire -- proving the new
    // digest check is doing genuinely new work, not duplicating it.
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH")).toBe(false);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH")).toBe(false);
  });

  it("rejects an observed baseline graph with the correct node/edge COUNTS but different edge content (same-count/different-graph attack, edge variant)", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    // Same edge COUNT (2) and endpoints that remain valid against the
    // unchanged node set -- only the edge id itself differs, changing the
    // edge_ids set the digest covers.
    const swappedEdges = [{ ...edges[0], id: "edge-a-b-imposter" }, edges[1]];
    const sameCountDifferentGraph = { nodes, edges: swappedEdges };
    expect(sameCountDifferentGraph.nodes.length).toBe(observedBaseline.node_count);
    expect(sameCountDifferentGraph.edges.length).toBe(observedBaseline.edge_count);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: sameCountDifferentGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_DIGEST_MISMATCH")).toBe(true);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH")).toBe(false);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH")).toBe(false);
  });

  it("accepts an observed baseline graph whose node/edge array order has been shuffled -- buildGraphSnapshot() sorts ids before digesting, so this is not a false-positive content mismatch", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const shuffledGraph = { nodes: [...nodes].reverse(), edges: [...edges].reverse() };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: shuffledGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("ok");
  });
});

describe("buildProposalReviewVisualInput: proposal/observed-baseline-graph passthrough", () => {
  it("passes the supplied proposal and observed baseline graph through byte-identical", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const graph = baseFixtureGraph();
    const proposal = validProposal();

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: graph, advisoryFreshness: "current", proposal });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.proposal).toEqual(proposal);
    expect(result.input.observed_baseline_graph).toEqual(graph);
  });
});

describe("buildProposalReviewVisualInput: forbidden-wording regression sweep", () => {
  it("the full serialized output never contains any FORBIDDEN_PROPOSAL_TRUTH_WORDING phrase, for every evaluation/freshness fixture", () => {
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const freshnessStates: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];
    const cases = [
      { evaluation: validEvaluation(), proposal: validProposal() },
      { evaluation: invalidEvaluation(), proposal: invalidProposal() },
      { evaluation: mixedProvenanceEvaluation(), proposal: mixedProvenanceProposal() },
    ];

    for (const { evaluation, proposal } of cases) {
      for (const advisoryFreshness of freshnessStates) {
        const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness, proposal });
        const serialized = JSON.stringify(result).toLowerCase();
        for (const phrase of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
          expect(serialized.includes(phrase.toLowerCase())).toBe(false);
        }
      }
    }
  });
});

describe("buildProposalReviewVisualInput: freshness isolation", () => {
  it("advisoryFreshness passes straight through to truth_disclosure.advisory_freshness, unchanged, for every state", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const freshnessStates: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];

    for (const advisoryFreshness of freshnessStates) {
      const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness, proposal: validProposal() });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.input.truth_disclosure.advisory_freshness).toBe(advisoryFreshness);
    }
  });

  it("changing only advisoryFreshness changes nothing else in the output (proposal_validation/projection/advisory are freshness-independent)", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const current = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    const staleEquivalent = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "stale_equivalent", proposal: validProposal() });

    expect(current.status).toBe("ok");
    expect(staleEquivalent.status).toBe("ok");
    if (current.status !== "ok" || staleEquivalent.status !== "ok") return;

    expect(JSON.stringify(current.input.proposal_validation)).toBe(JSON.stringify(staleEquivalent.input.proposal_validation));
    expect(JSON.stringify(current.input.projection)).toBe(JSON.stringify(staleEquivalent.input.projection));
    expect(JSON.stringify(current.input.advisory)).toBe(JSON.stringify(staleEquivalent.input.advisory));
  });
});
