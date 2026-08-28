import type {
  FidelityReceipt,
  VisualCommunicationSpec,
  VisualEvidenceRef,
} from "@rvs/visual-intelligence";

// Public types for @rvs/visual-change-review -- Milestone 10.4's
// before / delta / after architecture change review.
//
// The layering rule this package exists to keep:
//
//   @rvs/knowledge-graph owns what changed.
//   @rvs/governance-intelligence owns whether a change is a finding.
//   @rvs/decision-intelligence owns whether a decision still holds.
//   This package owns how a reader is shown all three at once.
//
// Consequences, every one of them load-bearing:
//
//  * Nothing here computes a diff. `ReviewChange` is a projection of an
//    upstream change fact, and every field on it either comes from upstream
//    verbatim or is a link between two upstream facts that upstream itself
//    already established.
//  * Nothing here imports an upstream intelligence package. Intake is
//    *structural* -- plain object shapes whose field names match the cached
//    artifacts -- exactly as @rvs/visual-explorer consumes the graph.
//  * Nothing here re-derives capability regression, governance severity,
//    decision state, impact paths, or blast radius. Each of those has an
//    owner, and a second implementation would be a second answer.
//  * Nothing here touches the DOM. tsconfig.json drops "DOM" from `lib`, so
//    that is a compiler error rather than a review convention.

export const CHANGE_REVIEW_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Change semantics
// ---------------------------------------------------------------------------

/**
 * The change vocabulary, fixed.
 *
 * Every member means exactly what the upstream comparison layer means by it,
 * and this package introduces no visual-only synonym. `removed` is never
 * softened to "deprecated": deprecation is a lifecycle status somebody
 * decided, removal is a fact about two snapshots, and a review that blurred
 * them would be telling the reader a decision had been taken that nobody
 * took.
 *
 *  added        present in the target snapshot, absent from the baseline
 *  removed      present in the baseline, absent from the target
 *  modified     present in both, with at least one upstream-recorded difference
 *  rerouted     the relationship still exists but now runs somewhere else
 *  regressed    an upstream layer recorded a downgrade (capability, status)
 *  resolved     an upstream finding or unresolved reference is no longer open
 *  qualified    still present, but upstream lowered its confidence
 *  unresolved   upstream could not determine what happened to this entity
 */
export type ReviewChangeType =
  | "added"
  | "removed"
  | "modified"
  | "rerouted"
  | "regressed"
  | "resolved"
  | "qualified"
  | "unresolved";

export const REVIEW_CHANGE_TYPES: readonly ReviewChangeType[] = [
  "added",
  "removed",
  "modified",
  "rerouted",
  "regressed",
  "resolved",
  "qualified",
  "unresolved",
];

/**
 * Blast radius, echoing upstream verbatim.
 *
 * Two upstream layers record reach with overlapping but not identical
 * vocabularies: @rvs/knowledge-graph's `BlastRadiusLevel` has `cross_layer`,
 * @rvs/governance-intelligence's has `product_wide` and `cross_product`. This
 * union is both of them, so whichever layer recorded a reach, its own word
 * survives. Mapping one vocabulary onto the other would mean this package
 * assigning a reach nobody measured.
 *
 * `unresolved` is a real member and not a stand-in for zero. "We found no
 * downstream consumer" and "we could not determine the downstream consumers"
 * are different answers, and only one of them is safe to act on.
 */
export type ReviewBlastRadius =
  | "isolated"
  | "local"
  | "cross_component"
  | "cross_layer"
  | "product_wide"
  | "cross_product"
  | "portfolio_wide"
  | "unresolved";

/** Echoes @rvs/knowledge-graph's ResolutionStatus. A change whose own resolution is not `resolved` is never presented as settled. */
export type ReviewResolutionStatus = "resolved" | "partial" | "unresolved";

/** Echoes @rvs/knowledge-graph's CompatibilityStatus verbatim. */
export type ReviewCompatibilityStatus =
  | "compatible"
  | "compatible_with_warnings"
  | "partial"
  | "incompatible";

export interface ReviewCompatibility {
  status: ReviewCompatibilityStatus;
  /** Why upstream assessed it that way, copied verbatim. Never re-worded here. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// The change entity
// ---------------------------------------------------------------------------

/**
 * One reviewable change.
 *
 * `id` is the upstream change id whenever upstream had one. Manufacturing an
 * alternate identity for the viewer would mean a reviewer reading
 * `graph-changes.json` and a reviewer reading this page could not tell they
 * were looking at the same change.
 *
 * `before_entity_id` / `after_entity_id` are present only when a stable
 * identity genuinely exists on that side. An `added` change has no before,
 * and the absence is represented as absence -- never as a synthetic
 * counterpart invented so the two panels look symmetrical.
 */
export interface ReviewChange {
  id: string;
  change_type: ReviewChangeType;
  /** The entity this change is about, by its upstream entity id. */
  entity_id: string;
  /** Upstream entity kind, verbatim ("component", "capability", "edge", ...). */
  entity_type: string;
  before_entity_id?: string;
  after_entity_id?: string;
  /** Upstream's own description. Never generated prose about what the change "means". */
  summary: string;
  evidence_refs: VisualEvidenceRef[];
  /** Capabilities upstream linked to this change, sorted. */
  capability_ids: string[];
  /** Products upstream linked to this change, sorted. */
  product_ids: string[];
  /** Decisions upstream linked to this change, sorted. */
  decision_ids: string[];
  /** Governance findings upstream linked to this change, sorted. */
  governance_finding_ids: string[];
  /** Impact paths, already computed upstream, that this change sits on. */
  impact_path_ids: string[];
  blast_radius: ReviewBlastRadius;
  resolution_status: ReviewResolutionStatus;
  /** True when an upstream governance finding or decision impact demands review. Never inferred from change type alone. */
  review_required: boolean;
}

// ---------------------------------------------------------------------------
// Overlays, carried verbatim
// ---------------------------------------------------------------------------

export type ReviewSeverity = "blocking" | "review_required" | "advisory" | "informational";

/** A governance finding as the review shows it. Severity, status and rationale are owned by @rvs/governance-intelligence. */
export interface ReviewGovernanceFinding {
  id: string;
  severity: ReviewSeverity;
  /** Upstream's own summary. */
  summary: string;
  /** Entities the finding names, sorted. */
  affected_entity_ids: string[];
  /** True when upstream recorded the finding as no longer open in the target snapshot. */
  resolved: boolean;
  evidence_refs: VisualEvidenceRef[];
}

/** Echoes @rvs/knowledge-graph's `DecisionImpactState` verbatim. Nothing here approves, rejects, or re-decides. */
export type ReviewDecisionState =
  | "unaffected"
  | "review_required"
  | "assumption_weakened"
  | "assumption_contradicted"
  | "implementation_invalidated"
  | "superseded"
  | "unverifiable";

export interface ReviewDecisionImpact {
  id: string;
  decision_entity_id: string;
  state: ReviewDecisionState;
  /** Upstream's own detail line. */
  detail: string;
  /** The changed entities this impact was recorded against, sorted. */
  subject_entity_ids: string[];
  evidence_refs: VisualEvidenceRef[];
}

// ---------------------------------------------------------------------------
// Causal review
// ---------------------------------------------------------------------------

/**
 * How firmly a route between a change and a consequence is established.
 *
 * The distinction is the whole of §9 and the most important thing this
 * package gets right or wrong. Adjacency is not causality: two entities being
 * neighbours in a graph says they are related, not that one caused the other.
 *
 *  confirmed  upstream emitted this exact route as an impact path or a
 *             decision-impact traversal. RVS is repeating a claim, not making
 *             one.
 *  related    both ends carry evidence that names the same artifact, but no
 *             upstream route connects them. Shown as evidence, labelled as
 *             evidence.
 *  unresolved a relation exists in the graph whose far end upstream could not
 *             resolve. Named so the reader knows the question was asked.
 */
export type ReviewPathKind = "confirmed" | "related" | "unresolved";

export interface ReviewPath {
  id: string;
  kind: ReviewPathKind;
  /** Entity ids in route order. */
  entity_ids: string[];
  /** The change this route starts from. */
  from_change_id: string;
  /** What the route reaches: a capability, a governance finding, a decision, a product. */
  to_entity_id: string;
  /** Upstream's own id for the artifact this route was read from. Empty for `related`, which is assembled from evidence rather than from a route. */
  upstream_artifact_id?: string;
  /** Stated for the reader rather than left to a line style. */
  description: string;
  evidence_refs: VisualEvidenceRef[];
}

/**
 * A question the review asked and upstream could not answer.
 *
 * Kept as a first-class record rather than an absence, because "no downstream
 * consumers were found" and "downstream reach was not determined" look
 * identical on a diagram and mean opposite things to somebody deciding
 * whether to merge.
 */
export interface UnresolvedImpact {
  id: string;
  change_id: string;
  /** What could not be determined, in the fixed wording of `UNRESOLVED_IMPACT_STATEMENTS`. */
  statement: string;
  /** The traversal boundary in force, when upstream disclosed one. */
  boundary?: string;
}

/**
 * The only wordings this package uses for unknown impact.
 *
 * Fixed strings, and deliberately not a template: every rejected phrasing in
 * §21 ("No downstream impact", "Safe change", "No consumers") reads as a
 * finding when it is really an absence of evidence, and the difference
 * between the two is the difference between a review and a rubber stamp.
 */
export const UNRESOLVED_IMPACT_STATEMENTS = {
  no_confirmed_consumers: "No confirmed downstream consumers were found in the analyzed evidence.",
  reach_unresolved: "Downstream consumer reach is unresolved.",
  outside_boundary: "No evidence-backed path was found within the configured traversal boundary.",
} as const;

export type UnresolvedImpactStatement =
  (typeof UNRESOLVED_IMPACT_STATEMENTS)[keyof typeof UNRESOLVED_IMPACT_STATEMENTS];

// ---------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------

/**
 * The six review lenses.
 *
 * A lens controls visibility and emphasis and nothing else. It cannot change
 * a change type, a governance severity, a decision state, an impact
 * calculation, or one number in the fidelity receipt. Two readers on two
 * lenses are looking at one review.
 */
export type ReviewLens =
  | "architecture"
  | "capabilities"
  | "governance"
  | "decisions"
  | "impact"
  | "unresolved";

export interface ReviewLensDefinition {
  id: ReviewLens;
  label: string;
  /** What the lens brings forward, stated for the reader rather than left to a colour. */
  description: string;
  /** The caveat that stops the lens from being read as a verdict. Drawn on the page whenever the lens is active. */
  caveat: string;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface ReviewGenerationMetadata {
  schema_version: number;
  producer: string;
  /** Upstream artifact ids this review was assembled from, sorted. */
  source_artifact_ids: string[];
  /** Digest of the inputs the model is a pure function of. Never a clock. */
  input_digest: string;
  /** Domains that could not be compared at all, so the page can say "not comparable" instead of "no change". */
  unavailable_domains: string[];
}

/**
 * Everything one architecture change review is.
 *
 * `visual_spec` and `fidelity_receipt` are the same structures every other
 * Milestone 10 surface produces -- a review that carried its own private
 * notion of what was drawn would be a second fidelity story, and the point of
 * a receipt is that there is exactly one.
 */
export interface ChangeReviewModel {
  id: string;
  schema_version: number;
  from_snapshot_id: string;
  to_snapshot_id: string;
  compatibility: ReviewCompatibility;
  /** Entities present in the baseline snapshot, sorted. */
  before_entity_ids: string[];
  /** Entities present in the target snapshot, sorted. */
  after_entity_ids: string[];
  changes: ReviewChange[];
  governance_findings: ReviewGovernanceFinding[];
  decision_impacts: ReviewDecisionImpact[];
  /** Every route the review can show, confirmed and otherwise. */
  confirmed_paths: ReviewPath[];
  unresolved_impacts: UnresolvedImpact[];
  /** Changes an upstream layer marked as requiring review, sorted. */
  review_required_ids: string[];
  visual_spec: VisualCommunicationSpec;
  fidelity_receipt: FidelityReceipt;
  generation_metadata: ReviewGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The review's validation vocabulary.
 *
 * Every code below is either reachable from a real input and covered by a
 * test, or -- and this holds for none of them today -- documented as
 * structural with an explicit rationale. A code that can never fire is a
 * promise of a check that does not exist, which is worse than no check at
 * all because a reviewer would count on it.
 */
export type ChangeReviewValidationCode =
  /** A baseline snapshot was named but its entity set is empty or missing. */
  | "CHANGE_REVIEW_BASELINE_MISSING"
  /** A target snapshot was named but its entity set is empty or missing. */
  | "CHANGE_REVIEW_TARGET_MISSING"
  /** Upstream assessed the two snapshots as incompatible. */
  | "CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS"
  /** A change names an entity present in neither snapshot. */
  | "CHANGE_REVIEW_DANGLING_CHANGE"
  /** A change declares a before counterpart the baseline does not contain. */
  | "CHANGE_REVIEW_BEFORE_ENTITY_MISSING"
  /** A change declares an after counterpart the target does not contain. */
  | "CHANGE_REVIEW_AFTER_ENTITY_MISSING"
  /** A change arrived with a change type outside `REVIEW_CHANGE_TYPES`. */
  | "CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE"
  /** Adaptation reduced the review; the receipt says what went. */
  | "CHANGE_REVIEW_FIDELITY_LOSS"
  /** The rendered review contains no real changed entity while the source had one. */
  | "CHANGE_REVIEW_REAL_ANCHOR_LOST"
  /** A change references a governance finding the review was not given. */
  | "CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING"
  /** A change references a decision impact the review was not given. */
  | "CHANGE_REVIEW_DECISION_REFERENCE_MISSING"
  /** Two changes claim the same id, so the model's order depends on input order. */
  | "CHANGE_REVIEW_NONDETERMINISTIC_ORDER";

export type ChangeReviewSeverity = "error" | "warning" | "info";

export interface ChangeReviewFinding {
  id: string;
  code: ChangeReviewValidationCode;
  severity: ChangeReviewSeverity;
  /** The change, entity, or snapshot the finding is about. */
  subject_id: string;
  message: string;
}
