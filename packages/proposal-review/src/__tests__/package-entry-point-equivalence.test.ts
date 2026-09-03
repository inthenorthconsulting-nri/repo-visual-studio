// Public-entry-point (barrel) equivalence proof for @rvs/proposal-review.
// Mirrors @rvs/change-workbench's package-entry-point-equivalence.test.ts
// exactly in spirit and in its explicit disclaimer: this proves
// src/index.ts's barrel re-exports faithfully (no silent drop, no rename,
// no divergent binding), never that "@rvs/proposal-review" resolves
// through node_modules as an installed package. This package is
// `"private": true`, declares `"main": "src/index.ts"` with no
// `"exports"` field and no build script -- there is no compiled artifact
// and no npm tarball surface to certify here. See adapter.ts / contracts.ts
// for the domain-level claims; this file's scope is strictly barrel
// fidelity.

import { describe, expect, it } from "vitest";

import {
  buildProposalReviewVisualInput as pkgBuildProposalReviewVisualInput,
  buildProposalReviewVisualInputId as pkgBuildProposalReviewVisualInputId,
  buildProposalVisualGrammar as pkgBuildProposalVisualGrammar,
} from "../index.js";

import { buildProposalReviewVisualInput as srcBuildProposalReviewVisualInput } from "../adapter.js";
import { buildProposalReviewVisualInputId as srcBuildProposalReviewVisualInputId } from "../ids.js";
import { buildProposalVisualGrammar as srcBuildProposalVisualGrammar } from "../grammar.js";

import { BASE_SNAPSHOT_DIGEST, compatibleObservedBaseline, mixedProvenanceEvaluation, validEvaluation } from "./fixtures.js";

describe("public-entry-point equivalence: src/index.ts barrel vs direct submodule imports", () => {
  it("buildProposalReviewVisualInput produces a byte-identical result via the barrel and via adapter.ts directly", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);

    const viaBarrel = pkgBuildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    const viaSubmodule = srcBuildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
    expect(viaBarrel.status).toBe("ok");
    if (viaBarrel.status === "ok" && viaSubmodule.status === "ok") {
      expect(viaBarrel.input.id).toBe(viaSubmodule.input.id);
    }
  });

  it("buildProposalReviewVisualInputId agrees via the barrel and via ids.ts directly", () => {
    const evaluation = validEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const result = pkgBuildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const viaBarrel = pkgBuildProposalReviewVisualInputId(evaluation.repository_id, evaluation.proposal_id, evaluation.base_snapshot_digest, result.input.truth_disclosure.id);
    const viaSubmodule = srcBuildProposalReviewVisualInputId(evaluation.repository_id, evaluation.proposal_id, evaluation.base_snapshot_digest, result.input.truth_disclosure.id);

    expect(viaBarrel).toBe(viaSubmodule);
    expect(viaBarrel).toBe(result.input.id);
  });

  it("a rejected result (baseline mismatch) is byte-identical via the barrel and via adapter.ts directly", () => {
    const evaluation = validEvaluation();
    const mismatchedBaseline = compatibleObservedBaseline("a-different-digest-entirely");

    const viaBarrel = pkgBuildProposalReviewVisualInput({ evaluation, observedBaseline: mismatchedBaseline, advisoryFreshness: "current" });
    const viaSubmodule = srcBuildProposalReviewVisualInput({ evaluation, observedBaseline: mismatchedBaseline, advisoryFreshness: "current" });

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
    expect(viaBarrel.status).toBe("rejected");
  });

  it("buildProposalVisualGrammar produces a byte-identical result via the barrel and via grammar.ts directly", () => {
    const evaluation = mixedProvenanceEvaluation();
    const observedBaseline = compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST);
    const bound = pkgBuildProposalReviewVisualInput({ evaluation, observedBaseline, advisoryFreshness: "current" });
    expect(bound.status).toBe("ok");
    if (bound.status !== "ok") return;

    const viaBarrel = pkgBuildProposalVisualGrammar(bound.input);
    const viaSubmodule = srcBuildProposalVisualGrammar(bound.input);

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
  });
});
