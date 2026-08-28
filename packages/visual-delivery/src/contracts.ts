// The contracts of verified visual delivery.
//
// Milestone 10.6 adds no renderer and no validator. It adds one decision --
// may this candidate replace what is already there -- and the four records
// that decision is made from and leaves behind: what was generated, what was
// measured, what was promoted, and, when nothing was promoted, why.
//
// The vocabulary is deliberately narrow. "Verified" here means one thing and
// says so everywhere it appears: this exact byte sequence completed this exact
// named validation profile. It is not approval, not sign-off, and not a
// judgement that the architecture it draws is correct.

export const VISUAL_DELIVERY_SCHEMA_VERSION = 1;

/** Which artifact a candidate is. Both are self-contained HTML documents. */
export type VisualArtifactType = "architecture_explorer" | "change_review";

export const VISUAL_ARTIFACT_TYPES: readonly VisualArtifactType[] = [
  "architecture_explorer",
  "change_review",
] as const;

/**
 * What a verification run concluded.
 *
 * Four states, and the distinction between the last three is the whole point.
 * `failed` means the artifact was measured and found wrong. `incomplete` means
 * it was not measured -- the browser would not start, a check timed out --
 * which is an infrastructure fact and never a statement about the drawing.
 * `stale` means a previously passing artifact still exists unchanged, but the
 * profile or the configuration it passed under no longer matches the current
 * one, so its verification describes a rule set nobody is running any more.
 *
 * Only `passed` promotes.
 */
export type VerificationStatus = "passed" | "failed" | "incomplete" | "stale";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "passed",
  "failed",
  "incomplete",
  "stale",
] as const;

/** What happened to the target. */
export type PromotionStatus = "promoted" | "not_promoted" | "promotion_failed";

/**
 * Severity, taken from the validator that raised the finding and never
 * reinterpreted here.
 *
 * @rvs/visual-intelligence publishes `blocking: boolean`; @rvs/validator
 * publishes `pass | fail | warn`. Both map onto these two without a judgement
 * call: blocking and fail are blocking, everything else is a warning. The
 * delivery layer never promotes a warning to an error or demotes an error to
 * a warning -- a gate that re-grades its inputs is a second opinion wearing
 * the first one's name.
 */
export type DeliveryFindingSeverity = "blocking" | "warning";

/**
 * The validator families a profile can require.
 *
 * Each name maps to validators that already exist. Nothing in this package
 * decides what any of them mean.
 */
export type ValidatorFamily =
  | "schema"
  | "fidelity"
  | "reference"
  | "layout"
  | "typography"
  | "contrast"
  | "accessibility"
  | "interaction"
  | "motion";

export const VALIDATOR_FAMILIES: readonly ValidatorFamily[] = [
  "schema",
  "fidelity",
  "reference",
  "layout",
  "typography",
  "contrast",
  "accessibility",
  "interaction",
  "motion",
] as const;

/**
 * The kinds of correction that could satisfy a failed invariant.
 *
 * These are diagnostic categories, not instructions and not scripts. Nothing
 * in this package executes one, schedules one, or regenerates a candidate on
 * its own: a receipt tells a person what class of change would make the
 * candidate acceptable, and stops there. "Increase spacing" does not name a
 * file, a token, or a number, because the validator that raised the finding
 * knows the invariant and not the fix.
 */
export const VISUAL_REPAIR_ACTIONS = [
  "reroute",
  "move-label",
  "increase-spacing",
  "split-view",
  "reduce-detail",
  "restore-anchor",
  "fix-contrast",
  "increase-font-size",
  "add-accessible-name",
  "resolve-reference",
  "add-non-color-state-cue",
] as const;

/**
 * Actions that repair the machine rather than the drawing.
 *
 * Kept in their own list so the eleven visual repairs above stay exactly the
 * eleven visual repairs. A missing browser is not a visual defect and must
 * never be offered as one.
 */
export const INFRASTRUCTURE_REPAIR_ACTIONS = ["install-browser-runtime", "retry-verification"] as const;

export type VisualRepairAction = (typeof VISUAL_REPAIR_ACTIONS)[number];
export type InfrastructureRepairAction = (typeof INFRASTRUCTURE_REPAIR_ACTIONS)[number];
export type RepairAction = VisualRepairAction | InfrastructureRepairAction;

/**
 * One thing a validator found, in the one shape the receipt renders.
 *
 * `code`, `subject_id` and the finding's identity all come from the validator
 * that raised it. This package mints no parallel vocabulary: a finding here
 * carries `VISUAL_A11Y_CONTRAST_INSUFFICIENT` because that is what
 * @rvs/visual-intelligence called it, and a reader who greps for that string
 * finds both the receipt and the check.
 */
export interface VisualDeliveryFinding {
  /** Deterministic: derived from code and subject, never from position or time. */
  finding_id: string;
  code: string;
  severity: DeliveryFindingSeverity;
  /** The module that raised it, e.g. "@rvs/visual-intelligence:validateTokenContrast". */
  validator: string;
  family: ValidatorFamily;
  subject_id: string;
  /** What the subject is: "spec", "token", "entity", "element", "control", "scene", "document", "runtime". */
  subject_type: string;
  message: string;
  /** What was measured, when the validator reported a number. Never invented. */
  measured_value?: string;
  /** What the invariant required. Never invented. */
  required_value?: string;
  /** Repository-relative locations, exactly as upstream recorded them. */
  evidence_refs: string[];
  supported_repairs: RepairAction[];
}

/** Where a candidate came from, so a receipt can be traced back without embedding upstream artifacts. */
export interface CandidateGenerationMetadata {
  producer: string;
  /** `FidelityReceipt.id` and its rendered digest, referenced rather than copied. */
  fidelity_receipt_id?: string;
  fidelity_receipt_digest?: string;
  /** Graph snapshot ids the artifact was built from. */
  source_snapshot_ids: string[];
  /** `ChangeReviewModel.id`, for a review candidate. */
  change_review_model_id?: string;
  /** Upstream artifact ids the spec recorded. */
  upstream_artifact_ids: string[];
}

/**
 * A generated artifact asking to become the target.
 *
 * `candidate_id` is content identity: the same inputs produce the same id on
 * any machine, on any day. `generation` and `run_id` are run identity, and
 * they are separate on purpose -- promotion ordering is a question about runs,
 * and answering it with a content hash would make two identical regenerations
 * indistinguishable exactly where their order matters.
 */
export interface VisualDeliveryCandidate {
  candidate_id: string;
  schema_version: number;
  artifact_type: VisualArtifactType;
  /** Where the candidate is staged. Repository-relative. */
  source_path: string;
  /** Where it would go if it passes. Repository-relative. */
  target_path: string;
  visual_spec_id: string;
  /** The fidelity receipt's source digest: what the drawing was made from. */
  source_digest: string;
  /** SHA-256 over the candidate's bytes. */
  artifact_digest: string;
  validation_profile: string;
  /** Metadata only. Never part of any identity, never part of any digest. */
  created_at: string;
  /** Monotonic run ordering within one delivery root. */
  generation: number;
  run_id: string;
  metadata: CandidateGenerationMetadata;
}

export interface ValidatorFamilyResult {
  family: ValidatorFamily;
  validator: string;
  version: string;
  /** How many checks the family ran. A family that ran nothing says so rather than reporting a clean zero. */
  checks: number;
  blocking: number;
  warnings: number;
  status: "passed" | "failed" | "not_run";
}

export interface ValidatorSummary {
  families: ValidatorFamilyResult[];
  checks_run: number;
  findings_blocking: number;
  findings_warning: number;
}

export interface VerificationProfileIdentity {
  id: string;
  name: string;
  version: string;
  families: ValidatorFamily[];
  requires_browser: boolean;
  allow_warnings: boolean;
  /** SHA-256 over the effective thresholds -- minimum font size, contrast level, render scale. */
  config_digest: string;
}

export interface VisualVerificationResult {
  schema_version: number;
  status: VerificationStatus;
  candidate: VisualDeliveryCandidate;
  profile: VerificationProfileIdentity;
  /**
   * Deterministic over the artifact bytes, the spec, the profile and the
   * validator versions and configuration. No wall-clock component: two runs
   * over the same candidate under the same rules produce the same digest, and
   * a digest that changed means a rule changed.
   */
  verification_digest: string;
  findings: VisualDeliveryFinding[];
  validator_summary: ValidatorSummary;
  /** Set only for `incomplete`: what stopped the measurement. */
  incomplete_reason?: string;
}

/**
 * An artifact that completed a profile and was promoted.
 *
 * Identity is content-derived: `verified_artifact_id` comes from the
 * verification digest, so two machines that verified the same bytes under the
 * same rules agree on the name. `verified_at` is recorded and is never used as
 * identity.
 */
export interface VerifiedVisualArtifact {
  verified_artifact_id: string;
  schema_version: number;
  artifact_digest: string;
  visual_spec_id: string;
  source_digest: string;
  verification_digest: string;
  verified_at: string;
  candidate_id: string;
  generation: number;
  target_path: string;
  artifact_type: VisualArtifactType;
  profile_id: string;
  profile_version: string;
  validator_summary: ValidatorSummary;
}

/**
 * Why a candidate was not promoted, in a form a person can act on.
 *
 * Not a stack trace. A stack trace says where the code was; a receipt says
 * which invariant the artifact missed, on which subject, by how much, and what
 * class of change would satisfy it.
 */
export interface VisualRepairReceipt {
  receipt_id: string;
  schema_version: number;
  candidate_id: string;
  verification_status: VerificationStatus;
  findings: VisualDeliveryFinding[];
  /** True whenever the target was left exactly as it was found. */
  target_preserved: boolean;
  /** The verified artifact still occupying the target, if there is one. */
  last_known_good_id: string | null;
  candidate_digest: string;
  /** The target's digest, unchanged, or null when no target existed. */
  target_digest: string | null;
  generation_metadata: CandidateGenerationMetadata & { generation: number; run_id: string };
  /** Where the rejected candidate was left, so it can be opened and looked at. Repository-relative. */
  candidate_path: string;
  profile_id: string;
}

/** What the delivery layer knows about a target before it touches it. */
export interface TargetState {
  path: string;
  exists: boolean;
  digest: string | null;
  /** The verified record for this target, if one has ever been written. */
  verified: VerifiedVisualArtifact | null;
  /**
   * True when a file is sitting at the target that no verification record
   * accounts for -- either it predates verified delivery or it was written by
   * something else. Reported, never assumed verified and never destroyed.
   */
  unverified_target_present: boolean;
}

/** The bounded record kept per target. Metadata only: no artifact bytes are retained. */
export interface VerifiedHistory {
  schema_version: number;
  target_path: string;
  current: VerifiedVisualArtifact | null;
  /** Most recent first, capped. Metadata only. */
  previous: VerifiedVisualArtifact[];
}

export interface PreviewInfo {
  /**
   * One of the four states a reader is allowed to be told.
   *
   * "Verified" is the strongest word available here, and it means the profile
   * passed. There is no "safe", no "approved" and no "production ready":
   * verification is a measurement, not an organisational decision.
   */
  status: "verified" | "candidate-validating" | "candidate-rejected" | "last-known-good-retained";
  status_label: string;
  /** A file:// URL. There is no server: the artifact is self-contained and opens from disk. */
  url: string | null;
  path: string;
}

export interface VisualDeliveryOutcome {
  result: VisualVerificationResult;
  promotion: PromotionStatus;
  promotion_reason: string;
  /** Written only on promotion. */
  verified: VerifiedVisualArtifact | null;
  /** The verified artifact at the target, after this run. Null if none has ever passed. */
  last_known_good: VerifiedVisualArtifact | null;
  target_path: string;
  target_digest_before: string | null;
  target_digest_after: string | null;
  receipt: VisualRepairReceipt | null;
  /** Repository-relative paths of what was written. */
  receipt_path: string | null;
  receipt_markdown_path: string | null;
  report_path: string;
  preview: PreviewInfo;
}
