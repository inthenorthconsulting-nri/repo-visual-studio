// The proposal-review visual adapter (Milestone 11.3.1; Milestone
// 11.3.3A-P rewrote its proposal-operations and baseline-content binding --
// see the two dedicated sections below).
//
// Authority boundary -- mandatory reading before calling or modifying this
// function: `buildProposalReviewVisualInput()` is a *binder*, not an
// evaluator. It calls zero @rvs/change-workbench evaluators
// (`evaluateProposedChange`, `validateProposedChangeSet`,
// `buildChangeOverlay`, `buildChangeAdvisory`/
// `buildChangeAdvisoryFromEvaluationInputs`, `buildImpactAdvisory`,
// `buildGovernanceAdvisory`, `buildDecisionAdvisory`) -- it only reads
// fields off an already-computed `ChangeWorkbenchEvaluation` the caller
// supplies, exactly the way evaluation.ts's own header comment invites a
// "future proposal-review visual adapter" to. Every `@rvs/change-workbench`
// import in this module is `import type`, with exactly one narrow,
// deliberate exception: `buildProposedChangeSetId`, a pure identity/hash
// utility (not an evaluator -- it validates nothing and produces no
// domain content), imported as a value so this module can verify rather
// than blindly trust a caller-supplied `proposal`'s content. Symmetrically,
// every `@rvs/knowledge-graph` import is `import type`, with exactly one
// deliberate exception: `buildGraphContentDigest`, KG's own pure
// architecture-semantic content-digest primitive -- never
// `buildGraphSnapshot()` (which would mint a second, competing snapshot
// identity) and never `verifyGraphContentDigest()` (which would mint a
// second, competing attestation-status authority). See the Milestone
// 11.3.3A-P section below.
//
// It calls exactly one @rvs/visual-intelligence function that produces
// domain content: `buildProposalTruthDisclosure()`, reused rather than
// reimplemented, per that function's own Milestone 11.3.1 forward
// reference. Topology disclosure authority remains
// `evaluation.advisory.topology`, read and reduced only through that
// existing reducer -- never inferred from overlay issues, entity
// provenance, or entity/edge counts.
//
// Freshness is an explicit caller-supplied input (`advisoryFreshness`),
// never discovered, cached, or filesystem-probed by this module -- this
// package has no access to "what is the current baseline" the way
// @rvs/change-workbench's own `assessChangeAdvisoryFreshness()` does, and
// does not pretend otherwise.
//
// The observed baseline is an explicit caller-supplied `GraphSnapshot`
// (`@rvs/knowledge-graph`, never a new persisted architecture
// representation invented here). Baseline/evaluation `repository_id` and
// digest compatibility is a hard failure, not a warning: a caller cannot
// obtain a `ProposalReviewVisualInput` for an evaluation checked against a
// baseline this binding cannot independently confirm.
//
// Milestone 11.3.3A: two additional caller-supplied inputs, each bound by
// its own hard-failure consistency check rather than trusted blindly --
// `observedBaselineGraph` (the same observed baseline's own node/edge
// content) and `proposal` (the exact `ProposedChangeSet` `evaluation` was
// computed from). Neither addition calls a new @rvs/change-workbench
// evaluator or reopens its public contract -- both values are already in
// the caller's own hands before calling this function, exactly like
// `observedBaseline` already was.
//
// Milestone 11.3.3A-P -- proposal operations binding, re-anchored:
// string/count equality alone does not prove content correspondence -- a
// caller (hostile or merely buggy) can construct an object that is
// structurally a `ProposedChangeSet` at compile time (a plain TS
// interface, no runtime branding) while carrying an `id` that does not
// actually match its own `operations`. The prior (Milestone 11.3.3A)
// remediation recomputed the expected id via
// `buildProposedChangeSetId(proposal.repository_id, proposal.operations)`
// and compared it against the caller's OWN `proposal.id` -- a
// caller-vs-caller comparison that a fully self-consistent hostile object
// (one whose `operations` and `id` genuinely agree with EACH OTHER, just
// not with what Workbench actually evaluated) trivially satisfies. The
// canonical binding below instead recomputes
// `buildProposedChangeSetId(evaluation.repository_id, proposal.operations)`
// -- using `evaluation`'s OWN canonical `repository_id`, never the
// caller's `proposal.repository_id`, so a caller-repository mismatch
// cannot change the semantic basis of the comparison -- and compares the
// result against `evaluation.proposal_id`, Workbench's own canonical,
// advisory-derived identity (evaluation.ts reads `advisory.proposal_id`
// back onto the envelope, never `changeSet.id` directly). This recomputed
// value is used ONLY as a comparison primitive: it is never written into
// the output, never compared against `proposal.id`, and never treated as
// a second proposal-identity authority. What this proves, precisely: IF
// `evaluation` was honestly produced by `evaluateProposedChange()` (which
// canonicalizes `proposal_id` from `advisory.proposal_id`, itself built
// from `changeSet.repository_id`/`changeSet.operations` --
// change-advisory.ts), THEN `proposalOperationsCanonicalId ===
// evaluation.proposal_id` is, up to SHA-256 preimage resistance, proof
// that the caller-resupplied `proposal.operations` are exactly the
// operations `evaluation` was computed from -- independent of whatever
// `proposal.id`/`proposal.repository_id` the caller happened to attach.
// It does NOT independently prove `evaluateProposedChange()` itself was
// called honestly with genuine inputs -- that function has no visibility
// into how its own caller obtained `changeSet`; closing that residual gap
// would require a change-workbench-owned change, out of this task's
// authorized scope. `proposal.id === evaluation.proposal_id` and
// `proposal.repository_id === evaluation.repository_id` remain as
// diagnostic/defense-in-depth fast-fail checks, run before the canonical
// binding -- they are NOT the binding authority.
//
// Milestone 11.3.3A-P -- baseline content binding, replacing the
// membership-digest check: `buildGraphSnapshot(...).digest ===
// observedBaseline.digest` (Milestone 11.3.3A) proved only that
// `observedBaselineGraph.nodes`/`.edges` matched the node/edge *identity*
// set (`KnowledgeNode.id`/`KnowledgeEdge.id`) `observedBaseline.digest`
// represents -- it said nothing about node/edge label, type, or edge
// direction/detail content, and it necessarily re-minted a candidate
// `GraphSnapshot` to do so, a snapshot-identity authority this package
// does not own. Milestone 11.3.3A-K1's `buildGraphContentDigest()`
// supersedes it for structural-content purposes; this binder now computes
// `observedBaselineContentDigest = buildGraphContentDigest(observedBaselineGraph.nodes,
// observedBaselineGraph.edges)` exactly once and compares it against
// whichever authority is actually available, following the four-state
// transport-attestation contract `evaluation.baseline_content_attestation`
// carries (Milestone 11.3.3A-WB) -- key-absent ("undefined"), "missing",
// "attested", "mismatch" -- never defaulting one into another:
//
//   - key absent: no authoritative transported recomputation exists at
//     all. Only self-consistency against the caller's own
//     `observedBaseline.content_digest` is checked
//     (PROPOSAL_REVIEW_BASELINE_GRAPH_SELF_INCONSISTENT on mismatch); a
//     passing result publishes `binding_status: "unbound"` -- explicitly
//     NOT "bound", since nothing upstream verified this correspondence.
//   - `"missing"`: upstream verification ran but the persisted snapshot
//     carried no recorded digest; `attestation.actual` is still a genuine
//     transported recomputation, so a match against it publishes
//     `binding_status: "bound"`, `attestation_state: "missing"`.
//   - `"attested"`: upstream verification ran and matched; a match against
//     `attestation.actual` publishes `binding_status: "bound"`,
//     `attestation_state: "attested"`.
//   - `"mismatch"`: upstream verification already established persisted
//     baseline content does not match its recorded identity -- a hard
//     failure (PROPOSAL_REVIEW_BASELINE_CONTENT_ATTESTATION_MISMATCH); no
//     `ProposalReviewVisualInput` is ever produced for this state,
//     regardless of whether the caller's own graph happens to agree with
//     `attestation.actual`.
//
// This binder never calls `verifyGraphContentDigest()` (that would mint
// its own attestation-status judgment, duplicating @rvs/knowledge-graph's
// authority) and never calls `buildGraphSnapshot()` (that would mint a
// candidate snapshot identity this package does not own) --
// `forbidden-evaluator-call.test.ts` statically enforces both exclusions.
// `PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH`/
// `PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH` (baseline-vs-evaluation
// envelope consistency) and the node/edge-count sanity checks are all
// retained unchanged -- they are boundary-consistency/fast-fail checks,
// never reinterpreted as content attestation.

import type { ChangeWorkbenchEvaluation, ProposedChangeSet } from "@rvs/change-workbench";
import { buildProposedChangeSetId } from "@rvs/change-workbench";
import type { GraphSnapshot } from "@rvs/knowledge-graph";
import { buildGraphContentDigest } from "@rvs/knowledge-graph";
import { buildProposalTruthDisclosure } from "@rvs/visual-intelligence";
import type { ProposalAdvisoryFreshness } from "@rvs/visual-intelligence";
import { PROPOSAL_REVIEW_SCHEMA_VERSION } from "./contracts.js";
import type { ProposalReviewBaselineBinding, ProposalReviewInputIssue, ProposalReviewObservedBaselineGraph, ProposalReviewVisualInput, ProposalReviewVisualInputResult } from "./contracts.js";
import { buildProposalReviewVisualInputId } from "./ids.js";

export interface BuildProposalReviewVisualInputParams {
  /** The canonical Workbench evaluation envelope -- consumed verbatim, never recomputed. */
  evaluation: ChangeWorkbenchEvaluation;
  /** The observed baseline this evaluation was run against. Compatibility with `evaluation.repository_id`/`evaluation.base_snapshot_digest` is a hard failure on mismatch. */
  observedBaseline: GraphSnapshot;
  /** That same observed baseline's own node/edge content. Node/edge-count consistency with `observedBaseline` is a fast-fail hard failure on mismatch; the authoritative content binding (`buildGraphContentDigest()` against either `observedBaseline.content_digest` or `evaluation.baseline_content_attestation.actual`, per the four-state contract) is published as `ProposalReviewVisualInput.baseline_binding` on success, or a hard failure on mismatch -- see this file's header comment for exactly what each state does and does not prove. */
  observedBaselineGraph: ProposalReviewObservedBaselineGraph;
  /** Caller-supplied, never computed here. Must be the result of the caller's own `assessChangeAdvisoryFreshness()` call against a current baseline, or `"unknown"` when no current baseline could be resolved at all. */
  advisoryFreshness: ProposalAdvisoryFreshness;
  /** The exact `ProposedChangeSet` `evaluation` was computed from. `proposal.id`/`proposal.repository_id` consistency with `evaluation.proposal_id`/`evaluation.repository_id` are diagnostic fast-fail hard failures on mismatch; the authoritative content binding recomputes `buildProposedChangeSetId(evaluation.repository_id, proposal.operations)` and compares it against `evaluation.proposal_id` -- see this file's header comment for exactly what this proves and why it is anchored to `evaluation.repository_id`, not `proposal.repository_id`. */
  proposal: ProposedChangeSet;
}

function issue(code: string, detail: string): ProposalReviewInputIssue {
  return { code, detail };
}

/**
 * Binds one `ChangeWorkbenchEvaluation` to one observed baseline and one
 * caller-supplied freshness qualification. Never recomputes proposal
 * validation, overlay projection, impact/governance/decision advisory, or
 * topology disclosure -- every one of those stays exactly what
 * `evaluation` already carries. The only content this function
 * constructs is the deterministic `ProposalTruthDisclosure` (via the
 * existing Milestone 11.3.0 builder) and this binding's own identity.
 */
export function buildProposalReviewVisualInput(params: BuildProposalReviewVisualInputParams): ProposalReviewVisualInputResult {
  const { evaluation, observedBaseline, observedBaselineGraph, advisoryFreshness, proposal } = params;
  const issues: ProposalReviewInputIssue[] = [];

  if (proposal.id !== evaluation.proposal_id) {
    issues.push(issue("PROPOSAL_REVIEW_PROPOSAL_ID_MISMATCH", `Supplied proposal id "${proposal.id}" does not match evaluation.proposal_id "${evaluation.proposal_id}".`));
  }
  if (proposal.repository_id !== evaluation.repository_id) {
    issues.push(
      issue("PROPOSAL_REVIEW_PROPOSAL_REPOSITORY_MISMATCH", `Supplied proposal repository_id "${proposal.repository_id}" does not match evaluation.repository_id "${evaluation.repository_id}".`),
    );
  }
  // Canonical content binding (Milestone 11.3.3A-P): proves
  // `proposal.operations` are exactly the operations `evaluation` was
  // computed from -- anchored to `evaluation.repository_id` and
  // `evaluation.proposal_id`, Workbench's own canonical values, NEVER to
  // the caller's own `proposal.repository_id`/`proposal.id` (a
  // caller-vs-caller comparison a fully self-consistent hostile object
  // would trivially satisfy). Reuses @rvs/change-workbench's own
  // canonicalization/hash algorithm via its exported
  // `buildProposedChangeSetId()` rather than reimplementing it -- see this
  // file's header comment for the exact guarantee this does and does not
  // provide. This recomputed value is a comparison primitive only: never
  // written to the output, never compared against `proposal.id`.
  const proposalOperationsCanonicalId = buildProposedChangeSetId(evaluation.repository_id, proposal.operations);
  if (proposalOperationsCanonicalId !== evaluation.proposal_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_PROPOSAL_OPERATIONS_CONTENT_MISMATCH",
        `Supplied proposal.operations do not hash to evaluation.proposal_id "${evaluation.proposal_id}" (buildProposedChangeSetId(evaluation.repository_id, proposal.operations) computed "${proposalOperationsCanonicalId}"). The supplied proposal.operations are not the exact operations this evaluation was computed from.`,
      ),
    );
  }
  if (observedBaselineGraph.nodes.length !== observedBaseline.node_count) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH",
        `Supplied observed baseline graph has ${observedBaselineGraph.nodes.length} node(s), but observedBaseline.node_count is ${observedBaseline.node_count}.`,
      ),
    );
  }
  if (observedBaselineGraph.edges.length !== observedBaseline.edge_count) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_GRAPH_EDGE_COUNT_MISMATCH",
        `Supplied observed baseline graph has ${observedBaselineGraph.edges.length} edge(s), but observedBaseline.edge_count is ${observedBaseline.edge_count}.`,
      ),
    );
  }
  // Architecture-semantic content binding for the baseline graph (Milestone
  // 11.3.3A-P), replacing the retired membership-digest check: computed
  // exactly once via @rvs/knowledge-graph's own exported
  // `buildGraphContentDigest()` -- never `buildGraphSnapshot()` (which
  // would mint a competing snapshot identity) -- and compared against
  // whichever authority is actually available, per the four-state
  // transport-attestation contract on `evaluation.baseline_content_attestation`.
  // See this file's header comment for exactly what each state proves.
  const observedBaselineContentDigest = buildGraphContentDigest([...observedBaselineGraph.nodes], [...observedBaselineGraph.edges]);
  const attestation = evaluation.baseline_content_attestation;
  if (attestation === undefined) {
    // No authoritative transported recomputation exists -- only
    // self-consistency against the caller's own GraphSnapshot.content_digest
    // can be checked. A passing result is explicitly "unbound", never
    // "bound", since nothing upstream verified this correspondence.
    if (observedBaselineContentDigest !== observedBaseline.content_digest) {
      issues.push(
        issue(
          "PROPOSAL_REVIEW_BASELINE_GRAPH_SELF_INCONSISTENT",
          `Supplied observed baseline graph's recomputed content digest "${observedBaselineContentDigest}" does not match observedBaseline.content_digest "${observedBaseline.content_digest}", and no authoritative evaluation.baseline_content_attestation was supplied to check against instead.`,
        ),
      );
    }
  } else if (attestation.status === "mismatch") {
    // Upstream verification already established persisted baseline content
    // does not match its recorded identity -- decisive on its own; a known-
    // corrupt baseline must never become renderable, regardless of whether
    // the caller's own graph happens to agree with attestation.actual.
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_CONTENT_ATTESTATION_MISMATCH",
        `evaluation.baseline_content_attestation reports "mismatch": the persisted baseline's recorded content digest "${attestation.expected}" does not match its own recomputed content "${attestation.actual}". No ProposalReviewVisualInput can be bound to a baseline already known to be corrupt.`,
      ),
    );
  } else {
    // "missing" or "attested": attestation.actual is a genuine transported
    // recomputation either way -- a match against it is "bound" in both
    // cases, distinguished only by attestation_state.
    if (observedBaselineContentDigest !== attestation.actual) {
      issues.push(
        issue(
          "PROPOSAL_REVIEW_BASELINE_GRAPH_CONTENT_MISMATCH",
          `Supplied observed baseline graph's recomputed content digest "${observedBaselineContentDigest}" does not match the authoritative transported recomputation evaluation.baseline_content_attestation.actual "${attestation.actual}".`,
        ),
      );
    }
  }

  if (observedBaseline.repository_id !== evaluation.repository_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_REPOSITORY_MISMATCH",
        `Observed baseline repository_id "${observedBaseline.repository_id}" does not match evaluation repository_id "${evaluation.repository_id}".`,
      ),
    );
  }
  if (observedBaseline.digest !== evaluation.base_snapshot_digest) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH",
        `Observed baseline digest "${observedBaseline.digest}" does not match evaluation base_snapshot_digest "${evaluation.base_snapshot_digest}".`,
      ),
    );
  }
  // Defensive internal-consistency checks against a caller-supplied
  // `evaluation` that may not have actually come from
  // `evaluateProposedChange()` (e.g. a hand-constructed fixture or a value
  // that crossed a serialization boundary). `evaluateProposedChange()`
  // itself always derives `evaluation.advisory` from the same `changeSet`/
  // `baseSnapshotDigest` it stamps onto the envelope, so these three
  // fields are structurally guaranteed to agree for any genuine evaluation
  // -- a mismatch here means the envelope did not come from that function.
  if (evaluation.advisory.proposal_id !== evaluation.proposal_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_PROPOSAL_ID_INCONSISTENT",
        `evaluation.proposal_id "${evaluation.proposal_id}" does not match evaluation.advisory.proposal_id "${evaluation.advisory.proposal_id}".`,
      ),
    );
  }
  if (evaluation.advisory.repository_id !== evaluation.repository_id) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_REPOSITORY_ID_INCONSISTENT",
        `evaluation.repository_id "${evaluation.repository_id}" does not match evaluation.advisory.repository_id "${evaluation.advisory.repository_id}".`,
      ),
    );
  }
  if (evaluation.advisory.base_snapshot_digest !== evaluation.base_snapshot_digest) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_EVALUATION_BASE_SNAPSHOT_DIGEST_INCONSISTENT",
        `evaluation.base_snapshot_digest "${evaluation.base_snapshot_digest}" does not match evaluation.advisory.base_snapshot_digest "${evaluation.advisory.base_snapshot_digest}".`,
      ),
    );
  }

  if (issues.length > 0) return { status: "rejected", issues };

  // Every issue-free path above either pushed an issue or falls into
  // exactly one of these three cases -- so this is reachable only when
  // `attestation` is not "mismatch" and the applicable content check
  // passed.
  const baselineBinding: ProposalReviewBaselineBinding =
    attestation === undefined
      ? { binding_status: "unbound", attestation_state: "undefined", observed_baseline_content_digest: observedBaselineContentDigest }
      : { binding_status: "bound", attestation_state: attestation.status, observed_baseline_content_digest: observedBaselineContentDigest };

  const truthDisclosure = buildProposalTruthDisclosure({
    repository_id: evaluation.repository_id,
    base_snapshot_digest: evaluation.base_snapshot_digest,
    proposal_id: evaluation.proposal_id,
    advisory_id: evaluation.advisory.id,
    topology: evaluation.advisory.topology,
    advisory_freshness: advisoryFreshness,
  });

  const input: ProposalReviewVisualInput = {
    schema_version: PROPOSAL_REVIEW_SCHEMA_VERSION,
    id: buildProposalReviewVisualInputId(evaluation.repository_id, evaluation.proposal_id, evaluation.base_snapshot_digest, truthDisclosure.id),
    repository_id: evaluation.repository_id,
    proposal_id: evaluation.proposal_id,
    base_snapshot_digest: evaluation.base_snapshot_digest,
    observed_baseline_snapshot_id: observedBaseline.id,
    observed_baseline_graph: observedBaselineGraph,
    baseline_binding: baselineBinding,
    proposal_validation: evaluation.proposal_validation,
    projection: evaluation.projection,
    advisory: evaluation.advisory,
    truth_disclosure: truthDisclosure,
    proposal,
  };

  return { status: "ok", input };
}
