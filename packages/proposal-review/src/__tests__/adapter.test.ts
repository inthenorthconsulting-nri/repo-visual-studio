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
import {
  attestedBaselineContentAttestation,
  BASE_SNAPSHOT_DIGEST,
  baseFixtureGraph,
  compatibleObservedBaseline,
  invalidEvaluation,
  invalidProposal,
  mismatchBaselineContentAttestation,
  missingBaselineContentAttestation,
  mixedProvenanceEvaluation,
  mixedProvenanceProposal,
  validEvaluation,
  validEvaluationWithAttestation,
  validProposal,
} from "./fixtures.js";

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

  it("each mismatch check fires independently -- a doubly-wrong input reports both issues (the observed-baseline-graph content digest itself is untouched by either override, so it stays self-consistent and does not additionally fire)", () => {
    const evaluation = validEvaluation();
    const observedBaseline = { ...compatibleObservedBaseline("wrong-digest"), repository_id: "wrong-repo" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.length).toBe(2);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH");
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH");
    expect(codes).not.toContain("PROPOSAL_REVIEW_BASELINE_GRAPH_SELF_INCONSISTENT");
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

  it("rejects when a completely different, internally self-consistent proposal B is supplied against evaluation A's own envelope (canonical-A-vs-self-consistent-B attack) -- proves the operations binding is anchored to evaluation.repository_id/evaluation.proposal_id, never to a caller-vs-caller comparison that any internally-consistent object could trivially satisfy", () => {
    const evaluationA = validEvaluation();
    const proposalB = mixedProvenanceProposal();
    // proposalB is independently, genuinely self-consistent: composeProposedChangeSet()
    // computed its own id from its own operations. It is simply a different
    // proposal from the one evaluationA was computed from.
    expect(proposalB.id).not.toBe(evaluationA.proposal_id);

    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const result = buildProposalReviewVisualInput({ evaluation: evaluationA, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: proposalB });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_OPERATIONS_CONTENT_MISMATCH")).toBe(true);
  });

  it("rejects when the caller forges proposal.id to equal evaluation.proposal_id but supplies different operations -- proves the diagnostic-only proposal.id fast-fail cannot be used to launder tampered operations past the canonical binding", () => {
    const evaluation = validEvaluation();
    const forged = { ...mixedProvenanceProposal(), id: evaluation.proposal_id, repository_id: evaluation.repository_id };
    expect(forged.id).toBe(evaluation.proposal_id);

    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: forged });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_OPERATIONS_CONTENT_MISMATCH")).toBe(true);
    // The diagnostic-only fast-fail does NOT fire -- the id was forged to
    // match, which is exactly why it is diagnostic-only and never the
    // binding authority.
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_PROPOSAL_ID_MISMATCH")).toBe(false);
  });
});

describe("buildProposalReviewVisualInput: Milestone 11.3.3A-P baseline content-digest binding", () => {
  it("undefined attestation + self-consistent graph -- succeeds unbound, attestation_state 'undefined'", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.baseline_binding.binding_status).toBe("unbound");
    expect(result.input.baseline_binding.attestation_state).toBe("undefined");
    expect(result.input.baseline_binding.observed_baseline_content_digest).toBe(observedBaseline.content_digest);
  });

  it("undefined attestation + self-inconsistent graph -- PROPOSAL_REVIEW_BASELINE_GRAPH_SELF_INCONSISTENT, no successful input", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const tamperedGraph = { nodes: nodes.map((n) => (n.id === "comp-b" ? { ...n, label: "Tampered B" } : n)), edges };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: tamperedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_SELF_INCONSISTENT")).toBe(true);
  });

  it("'missing' attestation + matching graph -- succeeds bound, attestation_state 'missing'", () => {
    const attestation = missingBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.baseline_binding).toEqual({ binding_status: "bound", attestation_state: "missing", observed_baseline_content_digest: attestation.actual });
  });

  it("'missing' attestation + mismatched graph -- PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH", () => {
    const attestation = missingBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const tamperedGraph = { nodes: nodes.map((n) => (n.id === "comp-b" ? { ...n, label: "Tampered B" } : n)), edges };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: tamperedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(true);
  });

  it("'attested' attestation + matching graph -- succeeds bound, attestation_state 'attested'", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.baseline_binding).toEqual({ binding_status: "bound", attestation_state: "attested", observed_baseline_content_digest: attestation.actual });
  });

  it("'attested' attestation + mismatched graph -- PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const tamperedGraph = { nodes, edges: edges.map((e) => (e.id === "edge-a-b" ? { ...e, detail: "unauthorized change" } : e)) };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: tamperedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(true);
  });

  it("'mismatch' attestation is a hard failure regardless of whether the caller-supplied graph happens to agree with attestation.actual -- no successful ProposalReviewVisualInput may ever be produced", () => {
    const attestation = mismatchBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    // The supplied graph is the genuine fixture graph, which DOES agree with
    // attestation.actual -- proving the mismatch is decisive on its own and
    // is never overridden by caller-graph agreement.
    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: baseFixtureGraph(), advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_CONTENT_ATTESTATION_MISMATCH")).toBe(true);
    // Option A: the mismatch is reported on its own -- the content-mismatch
    // check is never even attempted once attestation.status is "mismatch".
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(false);
  });

  it("rejects when a node's label is mutated while its id, counts, and edges stay unchanged, under an attested transported baseline (same-IDs-changed-content attack) -- proves the content-digest binding catches attribute mutation the retired membership-only digest could not", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const mutatedNodes = nodes.map((n) => (n.id === "comp-b" ? { ...n, label: "Renamed Without Authorization" } : n));
    const tamperedGraph = { nodes: mutatedNodes, edges };
    expect(tamperedGraph.nodes.length).toBe(observedBaseline.node_count);
    expect(tamperedGraph.edges.length).toBe(observedBaseline.edge_count);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: tamperedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(true);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH")).toBe(false);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH")).toBe(false);
  });

  it("rejects when an edge's semantic detail is mutated while ids/counts stay unchanged, under an attested transported baseline (edge-semantic-mutation attack)", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const mutatedEdges = edges.map((e) => (e.id === "edge-b-c" ? { ...e, detail: "unauthorized detail change" } : e));
    const tamperedGraph = { nodes, edges: mutatedEdges };
    expect(tamperedGraph.nodes.length).toBe(observedBaseline.node_count);
    expect(tamperedGraph.edges.length).toBe(observedBaseline.edge_count);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: tamperedGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(true);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH")).toBe(false);
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH")).toBe(false);
  });

  it("rejects an entirely substituted, same-shaped baseline graph B against a valid attestation computed from baseline graph A (valid-attestation-wrong-graph attack)", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    // Same node count, same edge count, same node/edge ids -- only one
    // architecture-semantic field (an edge's edge_type) differs from the
    // graph the attestation was actually computed from.
    const graphB = { nodes, edges: edges.map((e) => (e.id === "edge-a-b" ? { ...e, edge_type: "invokes" as const } : e)) };
    expect(graphB.nodes.length).toBe(observedBaseline.node_count);
    expect(graphB.edges.length).toBe(observedBaseline.edge_count);

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: graphB, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH")).toBe(true);
  });

  it("accepts an observed baseline graph whose node/edge array order has been shuffled -- buildGraphContentDigest() sorts ids before digesting, so this is not a false-positive content mismatch", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();
    const shuffledGraph = { nodes: [...nodes].reverse(), edges: [...edges].reverse() };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: shuffledGraph, advisoryFreshness: "current", proposal: validProposal() });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.input.baseline_binding.attestation_state).toBe("undefined");
  });

  it("observed_baseline_content_digest is deterministic across repeated calls and independent of node/edge array order", () => {
    const attestation = attestedBaselineContentAttestation();
    const evaluation = validEvaluationWithAttestation(attestation);
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const { nodes, edges } = baseFixtureGraph();

    const inOrder = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: { nodes, edges }, advisoryFreshness: "current", proposal: validProposal() });
    const shuffled = buildProposalReviewVisualInput({ evaluation, observedBaseline, observedBaselineGraph: { nodes: [...nodes].reverse(), edges: [...edges].reverse() }, advisoryFreshness: "current", proposal: validProposal() });

    expect(inOrder.status).toBe("ok");
    expect(shuffled.status).toBe("ok");
    if (inOrder.status !== "ok" || shuffled.status !== "ok") return;
    expect(inOrder.input.baseline_binding.observed_baseline_content_digest).toBe(shuffled.input.baseline_binding.observed_baseline_content_digest);
    expect(inOrder.input.baseline_binding.observed_baseline_content_digest).toBe(attestation.actual);
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
