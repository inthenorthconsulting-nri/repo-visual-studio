// The proposal-review visual adapter (Milestone 11.3.1).
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
// than blindly trust a caller-supplied `proposal`'s content (see the
// Milestone 11.3.3A remediation paragraph below).
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
// Milestone 11.3.3A remediation: string/count equality alone does not
// prove content correspondence -- a caller (hostile or merely buggy) can
// construct an object that is structurally a `ProposedChangeSet` at
// compile time (a plain TS interface, no runtime branding) while carrying
// an `id` that does not actually match its own `operations`. `id`/`digest`
// are only ever *correctly* derived from content by each owning package's
// own constructors (`composeProposedChangeSet()`/`decodeProposedChangeSet()`
// for `ProposedChangeSet.id`; `buildGraphSnapshot()` for `GraphSnapshot.digest`)
// -- nothing at the type level forces every value flowing through a plain
// interface to have gone through one. So both checks below recompute the
// expected identity from the supplied content and compare, using each
// package's own already-exported, already-a-dependency identity function
// (`buildProposedChangeSetId` from `@rvs/change-workbench`, `buildGraphSnapshot`
// from `@rvs/knowledge-graph`) -- never a canonicalization/hash algorithm
// reimplemented here, which would create a second, driftable identity
// authority. `forbidden-evaluator-call.test.ts` enforces, by static source
// audit, that these two functions are the ONLY value-imports this module
// takes from either package, and that neither is redefined locally.
//
// What this proves, precisely: IF `evaluation`'s own `changeSet` and the
// caller-resupplied `proposal` were each honestly constructed through one
// of `@rvs/change-workbench`'s own id-assigning constructors (the only two
// that exist in that package's public API), THEN `proposal.id ===
// evaluation.proposal_id` together with `proposal.id ===
// buildProposedChangeSetId(proposal.repository_id, proposal.operations)`
// is, up to SHA-256 preimage resistance, proof that `proposal.operations`
// are exactly the operations `evaluation` was computed from. It does NOT
// independently prove that `evaluateProposedChange()` itself was called
// honestly -- `evaluateProposedChange()` trusts its own `changeSet.id`
// verbatim (evaluation.ts) and this binder has no visibility into that
// call. Closing that residual gap would require a change-workbench-owned
// change, out of this task's authorized scope. Symmetrically for the
// baseline: `buildGraphSnapshot(...).digest === observedBaseline.digest`
// proves `observedBaselineGraph.nodes`/`.edges` are exactly the node/edge
// *identity* set (`KnowledgeNode.id`/`KnowledgeEdge.id`, sorted -- see
// @rvs/knowledge-graph's own snapshot.ts) the baseline digest represents.
// `GraphSnapshot.digest` itself does not cover node/edge attribute content
// (label, node_type, evidence_refs, etc.) -- proposal-review does not
// invent a stricter structural-identity notion than the one
// @rvs/knowledge-graph itself owns and exports.

import type { ChangeWorkbenchEvaluation, ProposedChangeSet } from "@rvs/change-workbench";
import { buildProposedChangeSetId } from "@rvs/change-workbench";
import type { GraphSnapshot } from "@rvs/knowledge-graph";
import { buildGraphSnapshot } from "@rvs/knowledge-graph";
import { buildProposalTruthDisclosure } from "@rvs/visual-intelligence";
import type { ProposalAdvisoryFreshness } from "@rvs/visual-intelligence";
import { PROPOSAL_REVIEW_SCHEMA_VERSION } from "./contracts.js";
import type { ProposalReviewInputIssue, ProposalReviewObservedBaselineGraph, ProposalReviewVisualInput, ProposalReviewVisualInputResult } from "./contracts.js";
import { buildProposalReviewVisualInputId } from "./ids.js";

export interface BuildProposalReviewVisualInputParams {
  /** The canonical Workbench evaluation envelope -- consumed verbatim, never recomputed. */
  evaluation: ChangeWorkbenchEvaluation;
  /** The observed baseline this evaluation was run against. Compatibility with `evaluation.repository_id`/`evaluation.base_snapshot_digest` is a hard failure on mismatch. */
  observedBaseline: GraphSnapshot;
  /** That same observed baseline's own node/edge content. Node/edge-count consistency with `observedBaseline` AND a recomputed-digest match (via `buildGraphSnapshot()`) against `observedBaseline.digest` are both hard failures on mismatch -- see this file's header comment for exactly what the digest check does and does not prove. */
  observedBaselineGraph: ProposalReviewObservedBaselineGraph;
  /** Caller-supplied, never computed here. Must be the result of the caller's own `assessChangeAdvisoryFreshness()` call against a current baseline, or `"unknown"` when no current baseline could be resolved at all. */
  advisoryFreshness: ProposalAdvisoryFreshness;
  /** The exact `ProposedChangeSet` `evaluation` was computed from. `proposal.id`/`proposal.repository_id` consistency with `evaluation.proposal_id`/`evaluation.repository_id`, AND a recomputed-id match (via `buildProposedChangeSetId()`) against `proposal.id` itself, are all hard failures on mismatch -- see this file's header comment for exactly what this proves. */
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
  // Cryptographic content binding: proves `proposal.operations` are exactly
  // the operations that hash to `proposal.id` (and, combined with the
  // check just above, to `evaluation.proposal_id`) -- string equality of
  // `id` alone proves nothing about `operations`, since `ProposedChangeSet`
  // is a plain structural interface with no runtime constructor
  // enforcement. Reuses @rvs/change-workbench's own canonicalization/hash
  // algorithm via its exported `buildProposedChangeSetId()` rather than
  // reimplementing it -- see this file's header comment for the exact
  // guarantee this does and does not provide.
  const expectedProposalId = buildProposedChangeSetId(proposal.repository_id, proposal.operations);
  if (proposal.id !== expectedProposalId) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_PROPOSAL_OPERATIONS_CONTENT_MISMATCH",
        `Supplied proposal.operations do not hash to the supplied proposal.id "${proposal.id}" (buildProposedChangeSetId(proposal.repository_id, proposal.operations) computed "${expectedProposalId}"). The supplied proposal is not a genuine, correctly-constructed ProposedChangeSet.`,
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
  // Cryptographic content binding for the baseline graph, symmetric to the
  // proposal check above: proves `observedBaselineGraph.nodes`/`.edges`
  // hash to exactly the node/edge identity set `observedBaseline.digest`
  // represents. Reuses @rvs/knowledge-graph's own exported
  // `buildGraphSnapshot()` -- the same function that produced
  // `observedBaseline.digest` in the first place -- rather than
  // reimplementing its digest algorithm. Node/edge array order does not
  // affect this comparison: `buildGraphSnapshot()` itself sorts node/edge
  // ids before digesting (snapshot.ts), so this check is inherently
  // order-independent.
  const candidateBaselineSnapshot = buildGraphSnapshot({
    repositoryId: observedBaseline.repository_id,
    upstreamArtifacts: [...observedBaseline.upstream_artifacts],
    nodes: [...observedBaselineGraph.nodes],
    edges: [...observedBaselineGraph.edges],
  });
  if (candidateBaselineSnapshot.digest !== observedBaseline.digest) {
    issues.push(
      issue(
        "PROPOSAL_REVIEW_BASELINE_GRAPH_DIGEST_MISMATCH",
        `Supplied observed baseline graph's recomputed digest "${candidateBaselineSnapshot.digest}" does not match observedBaseline.digest "${observedBaseline.digest}". The supplied nodes/edges are not the exact content observedBaseline.digest represents.`,
      ),
    );
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
    proposal_validation: evaluation.proposal_validation,
    projection: evaluation.projection,
    advisory: evaluation.advisory,
    truth_disclosure: truthDisclosure,
    proposal,
  };

  return { status: "ok", input };
}
