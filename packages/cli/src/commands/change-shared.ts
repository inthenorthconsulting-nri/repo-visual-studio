// Shared execution functions for the `rvs change` command family, per
// Milestone 11.2 §12 (mirroring runGraphBuild/runDecisionAnalysis's
// established precedent): all decode/baseline/evaluate logic lives here,
// reusable independently of Commander/CLI I/O (§8, §29) -- the actual
// command action functions (change-validate.ts/change-evaluate.ts) are
// thin wrappers that call these and handle terminal/--output/exit-code
// presentation only.

import { evaluateProposedChange, validateProposedChangeSet } from "@rvs/change-workbench";
import type { ChangeWorkbenchEvaluation, ProposalValidationIssue, ProposalValidationResult, ProposedChangeSet } from "@rvs/change-workbench";
import { decodeProposalFile } from "./change-decode.js";
import { resolveChangeWorkbenchBaseline } from "./change-baseline.js";
import { readGraphCachedJsonOptional } from "../graph-cache.js";
import type { ContentDigestVerification, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";

export type ChangeWorkbenchValidationOutcome =
  | { outcome: "rejected"; path: string; issues: ProposalValidationIssue[] }
  | { outcome: "validated"; path: string; changeSet: ProposedChangeSet; result: ProposalValidationResult };

/**
 * `rvs change validate`'s shared execution: decode + validate only. Uses
 * whatever confirmed-graph baseline is already cached (best-effort, via
 * readGraphCachedJsonOptional) so ref-existence checks can run when
 * available, but -- unlike `evaluate` -- never requires `rvs graph build`
 * to have been run first; a missing baseline simply degrades ref checks to
 * the validator's own non-blocking `unresolved_confirmation_context`.
 */
export function runChangeWorkbenchValidation(repoRoot: string, filePath: string): ChangeWorkbenchValidationOutcome {
  const decoded = decodeProposalFile(repoRoot, filePath);
  if (decoded.status === "rejected") {
    return { outcome: "rejected", path: decoded.path, issues: decoded.issues };
  }

  const confirmedNodes = readGraphCachedJsonOptional<KnowledgeNode[]>(repoRoot, "nodes.json");
  const confirmedEdges = readGraphCachedJsonOptional<KnowledgeEdge[]>(repoRoot, "edges.json");
  const result = validateProposedChangeSet(decoded.changeSet, { confirmedNodes, confirmedEdges });

  return { outcome: "validated", path: decoded.path, changeSet: decoded.changeSet, result };
}

/**
 * A canonical ChangeWorkbenchEvaluation whose transported baseline content
 * attestation is known to be present. At the library boundary the envelope
 * field is optional (a library caller may supply no attestation claim at
 * all); on the CLI's successful path it is always present, because
 * runChangeWorkbenchEvaluation() resolves the baseline -- and therefore
 * its authoritative attestation -- before evaluating, and passes that
 * attestation into the evaluation. This narrowing records that fact for
 * consumers so they never have to handle an absent-attestation case that
 * the CLI cannot produce.
 */
export type AttestedChangeWorkbenchEvaluation = ChangeWorkbenchEvaluation & { baseline_content_attestation: ContentDigestVerification };

function hasBaselineContentAttestation(evaluation: ChangeWorkbenchEvaluation): evaluation is AttestedChangeWorkbenchEvaluation {
  return evaluation.baseline_content_attestation !== undefined;
}

export type ChangeWorkbenchEvaluationOutcome =
  | { outcome: "rejected"; path: string; issues: ProposalValidationIssue[] }
  | { outcome: "blocked"; path: string; contentAttestation: ContentDigestVerification }
  | { outcome: "evaluated"; path: string; evaluation: AttestedChangeWorkbenchEvaluation };

/**
 * `rvs change evaluate`'s shared execution: decode, resolve the confirmed
 * baseline (§13 -- throws with `rvs graph build` guidance if missing, never
 * auto-built), and run the one canonical evaluateProposedChange(). No
 * governance policy input is wired in Milestone 11.2 -- buildGovernanceAdvisory
 * honestly reports `not_evaluated` rather than fabricating a policy result.
 *
 * Milestone 11.3.3A-K2/B: a `contentAttestation.status === "mismatch"`
 * baseline returns `"blocked"` here, before evaluateProposedChange() is ever
 * called -- the persisted graph content cannot be trusted to evaluate a
 * proposal against, so no evaluation is attempted at all. `"missing"` (a
 * legacy, pre-K1 baseline) is not blocked: it has a known, non-destructive
 * remedy (rebuild the graph) and evaluating against it is exactly today's
 * pre-K2/B behavior, so evaluation proceeds with the state disclosed
 * upstream by the caller.
 *
 * Milestone 11.3.3A-WB: the successful path goes through the canonical
 * ChangeWorkbenchEvaluation envelope, exactly once, rather than a direct
 * buildChangeAdvisory() call. The baseline's authoritative attestation is
 * handed to the evaluation and transported back verbatim, so for an
 * evaluated outcome the envelope is the ONLY source of both the advisory
 * (`evaluation.advisory`) and the attestation
 * (`evaluation.baseline_content_attestation`) -- there is deliberately no
 * sibling copy of either on the outcome.
 */
export function runChangeWorkbenchEvaluation(repoRoot: string, filePath: string): ChangeWorkbenchEvaluationOutcome {
  const decoded = decodeProposalFile(repoRoot, filePath);
  if (decoded.status === "rejected") {
    return { outcome: "rejected", path: decoded.path, issues: decoded.issues };
  }

  const baseline = resolveChangeWorkbenchBaseline(repoRoot);
  if (baseline.contentAttestation.status === "mismatch") {
    return { outcome: "blocked", path: decoded.path, contentAttestation: baseline.contentAttestation };
  }

  const evaluation = evaluateProposedChange({
    changeSet: decoded.changeSet,
    confirmedNodes: baseline.nodes,
    confirmedEdges: baseline.edges,
    baseSnapshotDigest: baseline.baseSnapshotDigest,
    decisionStateLookup: baseline.decisionStateLookup,
    baselineContentAttestation: baseline.contentAttestation,
  });

  // Structural check of the transport invariant (an attestation was supplied
  // above, so the canonical envelope must carry it) rather than an unchecked
  // type assertion. Unreachable in practice; if it ever fires, the Workbench
  // transport contract has regressed and the CLI must not proceed as though
  // it still held.
  if (!hasBaselineContentAttestation(evaluation)) {
    throw new Error("Workbench evaluation did not transport the supplied baseline content attestation; refusing to report an evaluation without it.");
  }

  return { outcome: "evaluated", path: decoded.path, evaluation };
}
