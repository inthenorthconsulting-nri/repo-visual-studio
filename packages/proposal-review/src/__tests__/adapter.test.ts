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
import { BASE_SNAPSHOT_DIGEST, compatibleObservedBaseline, invalidEvaluation, mixedProvenanceEvaluation, validEvaluation } from "./fixtures.js";

describe("buildProposalReviewVisualInput: determinism", () => {
  it("the same evaluation/baseline/freshness produce a byte-identical result across repeated calls", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const first = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    const second = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("two structurally-identical-but-distinct evaluation objects (same content, different references) produce the same id", () => {
    const evaluationA = validEvaluation();
    const evaluationB = JSON.parse(JSON.stringify(validEvaluation())) as ChangeWorkbenchEvaluation;
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const resultA = buildProposalReviewVisualInput({ evaluation: evaluationA, observedBaseline, advisoryFreshness: "current" });
    const resultB = buildProposalReviewVisualInput({ evaluation: evaluationB, observedBaseline, advisoryFreshness: "current" });

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

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
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
    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });

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

    const builtResult = buildProposalReviewVisualInput({ evaluation: built, observedBaseline, advisoryFreshness: "current" });
    const notBuiltResult = buildProposalReviewVisualInput({ evaluation: notBuilt, observedBaseline, advisoryFreshness: "current" });

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

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH")).toBe(true);
  });

  it("rejects when observedBaseline.digest disagrees with evaluation.base_snapshot_digest", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline("a-completely-different-digest");

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.proposal_id disagrees with evaluation.proposal_id", () => {
    const evaluation: ChangeWorkbenchEvaluation = { ...validEvaluation() };
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, proposal_id: "a-different-proposal-id" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_PROPOSAL_ID_INCONSISTENT")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.repository_id disagrees with evaluation.repository_id", () => {
    const evaluation = validEvaluation();
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, repository_id: "a-different-repo-id" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_REPOSITORY_ID_INCONSISTENT")).toBe(true);
  });

  it("rejects a hand-tampered evaluation whose advisory.base_snapshot_digest disagrees with evaluation.base_snapshot_digest", () => {
    const evaluation = validEvaluation();
    const tampered: ChangeWorkbenchEvaluation = { ...evaluation, advisory: { ...evaluation.advisory, base_snapshot_digest: "a-different-base-snapshot-digest" } };
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const result = buildProposalReviewVisualInput({ evaluation: tampered, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.some((i) => i.code === "PROPOSAL_REVIEW_EVALUATION_BASE_SNAPSHOT_DIGEST_INCONSISTENT")).toBe(true);
  });

  it("each mismatch check fires independently -- a doubly-wrong input reports both issues", () => {
    const evaluation = validEvaluation();
    const observedBaseline = { ...compatibleObservedBaseline("wrong-digest"), repository_id: "wrong-repo" };

    const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.issues.length).toBe(2);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH");
    expect(codes).toContain("PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH");
  });
});

describe("buildProposalReviewVisualInput: forbidden-wording regression sweep", () => {
  it("the full serialized output never contains any FORBIDDEN_PROPOSAL_TRUTH_WORDING phrase, for every evaluation/freshness fixture", () => {
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const freshnessStates: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];
    const evaluations = [validEvaluation(), invalidEvaluation(), mixedProvenanceEvaluation()];

    for (const evaluation of evaluations) {
      for (const advisoryFreshness of freshnessStates) {
        const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness });
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
      const result = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.input.truth_disclosure.advisory_freshness).toBe(advisoryFreshness);
    }
  });

  it("changing only advisoryFreshness changes nothing else in the output (proposal_validation/projection/advisory are freshness-independent)", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const current = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    const staleEquivalent = buildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "stale_equivalent" });

    expect(current.status).toBe("ok");
    expect(staleEquivalent.status).toBe("ok");
    if (current.status !== "ok" || staleEquivalent.status !== "ok") return;

    expect(JSON.stringify(current.input.proposal_validation)).toBe(JSON.stringify(staleEquivalent.input.proposal_validation));
    expect(JSON.stringify(current.input.projection)).toBe(JSON.stringify(staleEquivalent.input.projection));
    expect(JSON.stringify(current.input.advisory)).toBe(JSON.stringify(staleEquivalent.input.advisory));
  });
});
