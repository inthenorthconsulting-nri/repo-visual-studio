import type {
  ProposalAdvisoryFreshness,
  ProposalTopologyDisclosureStatus,
  ProposalTruthDisclosure,
  ProposalTruthQualificationCode,
} from "./contracts.js";
import { PROPOSAL_TRUTH_DISCLOSURE_SCHEMA_VERSION } from "./contracts.js";
import { buildProposalTruthDisclosureId, canonicalize, digestOf } from "./ids.js";

// Milestone 11.3.0 (semantic-closure remediation). See contracts.ts for the
// type's own documentation -- this file is the deterministic build/validate
// pair, mirroring fidelity.ts's `buildFidelityReceipt`/`validateFidelityReceipt`
// split exactly: the type is a pure data shape, this is what constructs and
// checks one.

// ---------------------------------------------------------------------------
// Entity-provenance -> future per-entity visual-provenance mapping
// (Milestone 11.3.0 investigation §12). Documentation, not logic: this
// package does not import `@rvs/change-workbench`'s `OverlayEntityProvenance`
// and this constant is not read by any function below or anywhere else in
// this package. It exists solely to freeze, at review time, how a future
// (still-unscheduled) adapter must interpret each `ChangeOverlay` provenance
// value for per-entity rendering -- so that decision does not get
// re-litigated, or litigated differently by different call sites, once
// adapter code is actually written. The string-literal keys echo
// `OverlayEntityProvenance`'s four values verbatim.
//
// DECISIVE: this mapping is NOT topology-disclosure authority and must never
// be read to derive `topology_disclosure_status`. It concerns a separate,
// still-deferred concern -- per-entity visual provenance (badges/markers on
// individual confirmed/proposed/modified/removed entities) -- not the
// artifact-level topology disclosure this package's `ProposalTruthDisclosure`
// actually carries. See `ProposalTopologyDisclosureStatus`'s own doc comment
// in contracts.ts for the full list of things `OverlayEntityProvenance`
// (and everything derived from it, including this mapping) must never be
// used to infer. Milestone 11.3.1 will introduce two independent future
// mappings, not one: (a) `ChangeAdvisory.topology.status ->
// topology_disclosure_status` (artifact-level, authoritative for this
// contract), and (b) `OverlayEntityProvenance -> per-entity visual
// provenance` (this mapping, a separate rendering concern).
// ---------------------------------------------------------------------------

export const OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING: Readonly<Record<"confirmed" | "proposed" | "modified" | "removed", string>> = {
  confirmed: "Observed identity, currently present. Carries the artifact's baseline_basis, not a proposal or projection basis -- nothing about this entity originates from the proposal.",
  proposed: "Caller-authored addition. Carries proposal_basis and projection_basis; has no observed baseline counterpart and must never be drawn as though it already exists.",
  modified: "Observed identity retained (the entity exists in the baseline); a caller-authored projected modification is layered on top of it. Both the observed and proposed facts must remain visible -- this is never collapsed into a single 'confirmed' or a single 'proposed' rendering.",
  removed: "Observed identity retained (the entity exists in the baseline); its absence is caller-proposed and projected, not observed. Must never be rendered identically to an entity that was actually deleted from observed architecture.",
} as const;

// ---------------------------------------------------------------------------
// Topology disclosure status reduction (investigation §14): translates
// @rvs/change-workbench's per-entity `ChangeAdvisory.topology[]` array into
// one artifact-level `ProposalTopologyDisclosureStatus` value, worst case
// wins. Ranked worst-to-best: "unresolved" (a reference was made and could
// not be resolved -- the most dangerous case, since something is claimed but
// unverifiable) beats "not_supplied" (topology simply was not described --
// an honest total absence) beats "partial" (some described, some not) beats
// "explicit" (fully disclosed by the caller -- NOT a claim that the
// disclosed topology is complete; see `ProposalTopologyDisclosureStatus` in
// contracts.ts). This reduction never invents a status
// `ChangeAdvisory.topology[]` did not already report, and it reads only
// `.status` off each entry -- never any other field an entry may carry.
// ---------------------------------------------------------------------------

const TOPOLOGY_DISCLOSURE_STATUS_SEVERITY: readonly ProposalTopologyDisclosureStatus[] = ["unresolved", "not_supplied", "partial", "explicit"];

export function reduceTopologyDisclosureStatus(statuses: readonly ProposalTopologyDisclosureStatus[]): ProposalTopologyDisclosureStatus {
  const present = new Set(statuses);
  for (const candidate of TOPOLOGY_DISCLOSURE_STATUS_SEVERITY) {
    if (present.has(candidate)) return candidate;
  }
  // No topology entries at all is, itself, topology that was not supplied.
  return "not_supplied";
}

// ---------------------------------------------------------------------------
// Deterministic qualification wording (investigation §9, §10, §22). Every
// sentence is a fixed template keyed only by the disclosure's own enum
// state -- never by caller-supplied text -- so `qualification_text` cannot
// carry an unsupported claim (§43) or an injected control sequence (§30):
// its only variable input is a repository-controlled digest string, already
// restricted to hex by `digestOf`/`shortDigest`.
//
// Qualification codes (Milestone 11.3.0 semantic-closure remediation): every
// disclosure carries exactly four codes, one per semantic axis --
// artifact/truth basis, projection basis, topology, freshness -- assembled
// in a FIXED canonical order (never `.sort()`, never Set/property-traversal
// order; see `ProposalTruthQualificationCode` in contracts.ts). The
// topology/freshness "best case" values (explicit / current) still emit a
// code with no accompanying prose, so the 4-codes invariant holds
// unconditionally and is mechanically checkable regardless of state.
// ---------------------------------------------------------------------------

interface QualificationLine {
  code: ProposalTruthQualificationCode;
  text?: string;
}

function topologyQualificationLine(status: ProposalTopologyDisclosureStatus): QualificationLine {
  switch (status) {
    case "explicit":
      return { code: "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT" };
    case "partial":
      return { code: "PROPOSAL_TRUTH_TOPOLOGY_PARTIAL", text: "Proposed topology disclosure is partial; some relationships were not evaluated." };
    case "not_supplied":
      return { code: "PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED", text: "Some proposed topology was not supplied." };
    case "unresolved":
      return { code: "PROPOSAL_TRUTH_TOPOLOGY_UNRESOLVED", text: "Proposed topology could not be fully resolved." };
  }
}

function freshnessQualificationLine(freshness: ProposalAdvisoryFreshness): QualificationLine {
  switch (freshness) {
    case "current":
      return { code: "PROPOSAL_TRUTH_ADVISORY_CURRENT" };
    case "stale_equivalent":
      return { code: "PROPOSAL_TRUTH_ADVISORY_STALE_EQUIVALENT", text: "Advisory was evaluated against a different but equivalent/stale baseline." };
    case "unknown":
      return { code: "PROPOSAL_TRUTH_ADVISORY_FRESHNESS_UNKNOWN", text: "Current advisory freshness could not be established." };
  }
}

function buildQualification(
  baseSnapshotDigest: string,
  topologyDisclosureStatus: ProposalTopologyDisclosureStatus,
  advisoryFreshness: ProposalAdvisoryFreshness,
): { text: string; codes: readonly ProposalTruthQualificationCode[] } {
  const notObserved: QualificationLine = {
    code: "PROPOSAL_TRUTH_NOT_OBSERVED",
    text: `PROPOSED -- NOT OBSERVED. Projected from caller-supplied proposal operations. Projection is based on the observed baseline identified by ${baseSnapshotDigest}.`,
  };
  const deterministicProjection: QualificationLine = { code: "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION" };
  // Fixed canonical order: artifact/truth -> projection -> topology ->
  // freshness. Never re-derived by sort or Set order (investigation §15).
  const lines = [notObserved, deterministicProjection, topologyQualificationLine(topologyDisclosureStatus), freshnessQualificationLine(advisoryFreshness)];
  const text = lines
    .map((line) => line.text)
    .filter((value): value is string => value !== undefined)
    .join(" ");
  const codes = lines.map((line) => line.code);
  return { text, codes };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Authoritative construction input. Every field here comes from the same
 * `ChangeAdvisory` at the call site (`repository_id`, `base_snapshot_digest`,
 * `proposal_id` <- `advisory.proposal_id`, `advisory_id` <- `advisory.id`,
 * `topology` <- `advisory.topology`) -- deliberately one coherent source
 * object, not two independently supplied ones, so there is no
 * proposal-vs-advisory pairing to defensively cross-check here: a
 * `ChangeAdvisory`'s own construction already guarantees those fields are
 * mutually consistent (investigation §54). `advisory_freshness` is the only
 * field that cannot come from the advisory itself -- it is the result of a
 * separate, live `assessChangeAdvisoryFreshness()` call the caller already
 * made against a *current* baseline, which this package has no way to
 * resolve on its own (investigation §15).
 */
export interface ProposalTruthDisclosureInput {
  repository_id: string;
  base_snapshot_digest: string;
  proposal_id: string;
  advisory_id: string;
  /** Structurally echoes `ChangeAdvisory.topology[]` -- only `.status` is read; no other field on an entry is ever consulted. */
  topology: readonly { status: ProposalTopologyDisclosureStatus }[];
  advisory_freshness: ProposalAdvisoryFreshness;
}

/**
 * Deterministic qualification builder (Milestone 11.3.0 semantic-closure
 * remediation).
 *
 * Authority boundary -- this is mandatory reading before calling this
 * function from new code: `buildProposalTruthDisclosure()` is a
 * deterministic *qualifier*. It is NOT a proposal evaluator, NOT a topology
 * evaluator, NOT a freshness evaluator, and NOT an authority authenticator.
 * It accepts `topology_disclosure_status` and `advisory_freshness` as
 * structurally supplied values -- by design, this package has zero
 * `@rvs/change-workbench` dependency, so it cannot itself call
 * `assessChangeAdvisoryFreshness()` or read a `ChangeAdvisory`. It can (and
 * does, via `validateProposalTruthDisclosure`) check that a value's *shape*
 * is well-formed and *internally consistent* with the rest of a disclosure.
 * It cannot, and does not, prove that the caller's supplied
 * `topology_disclosure_status`/`advisory_freshness` actually originated from
 * a genuine `ChangeAdvisory`/`assessChangeAdvisoryFreshness()` call rather
 * than, say, a hand-constructed test fixture or a compromised caller. Do not
 * pretend otherwise.
 *
 * Future (Milestone 11.3.1+, NOT implemented here) authority binding, for
 * reference only:
 *   - `ChangeAdvisory.topology.status -> topology_disclosure_status`
 *   - `assessChangeAdvisoryFreshness(...) -> "current" | "stale_equivalent"`
 *   - No resolvable current baseline -> visual/artifact communication value
 *     `"unknown"`
 *   - `ChangeAdvisory` + proposal + baseline -> repository/proposal/advisory/
 *     baseline identity
 * The exact field path on `ChangeAdvisory`/`ChangeOverlay` this eventually
 * reads must be confirmed against `@rvs/change-workbench`'s actual contract
 * at 11.3.1 implementation time -- it is intentionally not invented here.
 */
export function buildProposalTruthDisclosure(input: ProposalTruthDisclosureInput): ProposalTruthDisclosure {
  const topologyDisclosureStatus = reduceTopologyDisclosureStatus(input.topology.map((entry) => entry.status));
  const qualification = buildQualification(input.base_snapshot_digest, topologyDisclosureStatus, input.advisory_freshness);

  // `qualification_text`/`qualification_codes` are deliberately excluded
  // from this digest: both are pure deterministic derivations of the three
  // fields already hashed below, so including them could never change
  // whether two disclosures are semantically identical -- only these three
  // structured fields can (investigation §18).
  const qualificationDigest = digestOf(
    canonicalize({
      base_snapshot_digest: input.base_snapshot_digest,
      topology_disclosure_status: topologyDisclosureStatus,
      advisory_freshness: input.advisory_freshness,
    }),
  );

  return {
    schema_version: PROPOSAL_TRUTH_DISCLOSURE_SCHEMA_VERSION,
    id: buildProposalTruthDisclosureId(input.repository_id, input.proposal_id, input.advisory_id, qualificationDigest),
    artifact_kind: "proposal_review",
    repository_id: input.repository_id,
    base_snapshot_digest: input.base_snapshot_digest,
    proposal_id: input.proposal_id,
    advisory_id: input.advisory_id,
    baseline_basis: "observed",
    proposal_basis: "caller_supplied",
    projection_basis: "deterministically_projected",
    topology_disclosure_status: topologyDisclosureStatus,
    advisory_freshness: input.advisory_freshness,
    qualification_text: qualification.text,
    qualification_codes: qualification.codes,
  };
}

// ---------------------------------------------------------------------------
// Validate -- rejects a malformed runtime/decoded object. Mirrors
// `validateFidelityReceipt`'s shape (a violation list, never a throw) so
// callers can treat every visual-intelligence contract check the same way.
// ---------------------------------------------------------------------------

export interface ProposalTruthDisclosureViolation {
  code: string;
  message: string;
}

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TOPOLOGY_DISCLOSURE_STATUS_VALUES = new Set<string>(["explicit", "not_supplied", "partial", "unresolved"]);
const ADVISORY_FRESHNESS_VALUES = new Set<string>(["current", "stale_equivalent", "unknown"]);
const QUALIFICATION_CODE_VALUES = new Set<string>([
  "PROPOSAL_TRUTH_NOT_OBSERVED",
  "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION",
  "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT",
  "PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED",
  "PROPOSAL_TRUTH_TOPOLOGY_PARTIAL",
  "PROPOSAL_TRUTH_TOPOLOGY_UNRESOLVED",
  "PROPOSAL_TRUTH_ADVISORY_CURRENT",
  "PROPOSAL_TRUTH_ADVISORY_STALE_EQUIVALENT",
  "PROPOSAL_TRUTH_ADVISORY_FRESHNESS_UNKNOWN",
]);

function violation(code: string, message: string): ProposalTruthDisclosureViolation {
  return { code, message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validates an already-decoded `ProposalTruthDisclosure`-shaped value.
 * Accepts `unknown` because the primary use is checking a value that
 * crossed a serialization boundary (read back from an exported artifact),
 * not a value this package itself just built. Does not attempt general
 * JSON-Schema-style validation -- see decode.ts precedent in
 * `@rvs/change-workbench` if a full recursive decoder is ever warranted;
 * this type has no nested object/array-of-object fields, so a shallow check
 * is sufficient.
 *
 * `qualification_codes` and `qualification_text` are validated by
 * recomputation, not by presence/shape alone (Milestone 11.3.0
 * semantic-closure remediation, investigation §16-17): once
 * `topology_disclosure_status`, `advisory_freshness`, and
 * `base_snapshot_digest` each pass their own structural checks, this
 * function recomputes the single expected `{text, codes}` pair the real
 * builder would have produced for that exact state and rejects the
 * candidate unless both match exactly. This one recompute-and-compare step
 * is what catches every one of: an unknown code, a duplicate code, a
 * missing code, a code inconsistent with `topology_disclosure_status`, a
 * code inconsistent with `advisory_freshness`, and tampered qualification
 * text -- as a mechanical consequence of exact-equality-with-the-only-valid-
 * value, not as bespoke per-case logic. The lighter membership/duplicate
 * pre-checks below run first only to produce clearer, more specific
 * violation messages; they are not load-bearing for correctness.
 */
export function validateProposalTruthDisclosure(value: unknown): ProposalTruthDisclosureViolation[] {
  const violations: ProposalTruthDisclosureViolation[] = [];

  if (typeof value !== "object" || value === null) {
    return [violation("PROPOSAL_TRUTH_MALFORMED", "Value is not an object.")];
  }
  for (const key of Object.keys(value)) {
    if (POLLUTION_KEYS.has(key)) {
      violations.push(violation("PROPOSAL_TRUTH_MALFORMED", `Disclosure contains a disallowed key "${key}".`));
    }
  }

  const candidate = value as Partial<ProposalTruthDisclosure>;

  if (candidate.schema_version !== PROPOSAL_TRUTH_DISCLOSURE_SCHEMA_VERSION) {
    violations.push(violation("PROPOSAL_TRUTH_UNSUPPORTED_SCHEMA_VERSION", `schema_version "${String(candidate.schema_version)}" is not supported.`));
  }
  if (candidate.artifact_kind !== "proposal_review") {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_ARTIFACT_KIND", `artifact_kind "${String(candidate.artifact_kind)}" is not "proposal_review".`));
  }
  if (candidate.baseline_basis !== "observed") {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_BASELINE_BASIS", `baseline_basis "${String(candidate.baseline_basis)}" is not "observed".`));
  }
  if (candidate.proposal_basis !== "caller_supplied") {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_PROPOSAL_BASIS", `proposal_basis "${String(candidate.proposal_basis)}" is not "caller_supplied".`));
  }
  if (candidate.projection_basis !== "deterministically_projected") {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_PROJECTION_BASIS", `projection_basis "${String(candidate.projection_basis)}" is not "deterministically_projected".`));
  }
  if (typeof candidate.topology_disclosure_status !== "string" || !TOPOLOGY_DISCLOSURE_STATUS_VALUES.has(candidate.topology_disclosure_status)) {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_TOPOLOGY_DISCLOSURE_STATUS", `topology_disclosure_status "${String(candidate.topology_disclosure_status)}" is not a recognized value.`));
  }
  if (typeof candidate.advisory_freshness !== "string" || !ADVISORY_FRESHNESS_VALUES.has(candidate.advisory_freshness)) {
    violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_ADVISORY_FRESHNESS", `advisory_freshness "${String(candidate.advisory_freshness)}" is not a recognized value.`));
  }
  for (const field of ["repository_id", "base_snapshot_digest", "proposal_id", "advisory_id", "id"] as const) {
    if (!isNonEmptyString(candidate[field])) {
      violations.push(violation("PROPOSAL_TRUTH_MISSING_IDENTITY", `"${field}" is missing or empty.`));
    }
  }
  if (typeof candidate.qualification_text !== "string" || candidate.qualification_text.length === 0) {
    violations.push(violation("PROPOSAL_TRUTH_MISSING_QUALIFICATION_TEXT", "qualification_text is missing or empty."));
  }
  if (!Array.isArray(candidate.qualification_codes) || candidate.qualification_codes.length === 0) {
    violations.push(violation("PROPOSAL_TRUTH_MISSING_QUALIFICATION_CODES", "qualification_codes is missing or empty."));
  } else {
    const seen = new Set<string>();
    for (const code of candidate.qualification_codes) {
      if (typeof code !== "string" || !QUALIFICATION_CODE_VALUES.has(code)) {
        violations.push(violation("PROPOSAL_TRUTH_UNKNOWN_QUALIFICATION_CODE", `qualification_codes contains an unrecognized code "${String(code)}".`));
      } else if (seen.has(code)) {
        violations.push(violation("PROPOSAL_TRUTH_DUPLICATE_QUALIFICATION_CODE", `qualification_codes contains a duplicate code "${code}".`));
      } else {
        seen.add(code);
      }
    }
  }

  // Recomputes the expected id from the disclosure's own fields and rejects
  // a mismatch -- this is what makes `id` un-overridable rather than merely
  // undocumented: a caller (or a corrupted artifact) that hand-supplies an
  // `id` inconsistent with the rest of the disclosure is caught here
  // (investigation §21, §44). The same recomputation additionally yields the
  // one valid `{text, codes}` pair for this state, which is then compared
  // exactly against the candidate's own `qualification_text`/
  // `qualification_codes` -- catching unknown/duplicate/missing/
  // state-inconsistent codes and tampered text in a single step
  // (investigation §16-17).
  if (
    violations.length === 0 &&
    isNonEmptyString(candidate.repository_id) &&
    isNonEmptyString(candidate.base_snapshot_digest) &&
    isNonEmptyString(candidate.proposal_id) &&
    isNonEmptyString(candidate.advisory_id) &&
    isNonEmptyString(candidate.topology_disclosure_status) &&
    isNonEmptyString(candidate.advisory_freshness)
  ) {
    const topologyDisclosureStatus = candidate.topology_disclosure_status as ProposalTopologyDisclosureStatus;
    const advisoryFreshness = candidate.advisory_freshness as ProposalAdvisoryFreshness;

    const qualificationDigest = digestOf(
      canonicalize({
        base_snapshot_digest: candidate.base_snapshot_digest,
        topology_disclosure_status: topologyDisclosureStatus,
        advisory_freshness: advisoryFreshness,
      }),
    );
    const expectedId = buildProposalTruthDisclosureId(candidate.repository_id, candidate.proposal_id, candidate.advisory_id, qualificationDigest);
    if (candidate.id !== expectedId) {
      violations.push(violation("PROPOSAL_TRUTH_ID_MISMATCH", `id "${String(candidate.id)}" does not match the id its own fields imply ("${expectedId}").`));
    }

    const expected = buildQualification(candidate.base_snapshot_digest, topologyDisclosureStatus, advisoryFreshness);
    if (candidate.qualification_text !== expected.text) {
      violations.push(
        violation(
          "PROPOSAL_TRUTH_QUALIFICATION_TEXT_MISMATCH",
          `qualification_text does not match the text implied by topology_disclosure_status/advisory_freshness. Expected "${expected.text}".`,
        ),
      );
    }
    const actualCodes = Array.isArray(candidate.qualification_codes) ? candidate.qualification_codes : [];
    const codesMatch = actualCodes.length === expected.codes.length && actualCodes.every((code, index) => code === expected.codes[index]);
    if (!codesMatch) {
      violations.push(
        violation(
          "PROPOSAL_TRUTH_QUALIFICATION_CODES_MISMATCH",
          `qualification_codes does not match the codes (or their canonical order) implied by topology_disclosure_status/advisory_freshness. Expected [${expected.codes.join(", ")}].`,
        ),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Forbidden wording (investigation §10, §43). A regression list, not an
// enforcement mechanism this package runs automatically -- exactly like
// @rvs/visual-delivery's own `receipts.test.ts:250` precedent, which this
// list is a superset of. Tests assert `qualification_text` never contains
// any of these across the full topology x freshness state space.
// ---------------------------------------------------------------------------

export const FORBIDDEN_PROPOSAL_TRUTH_WORDING: readonly string[] = [
  "approved",
  "certified",
  "safe architecture",
  "safe",
  "no impact",
  "production ready",
  "deployable",
  "merge ready",
  "merge-ready",
  "sign-off",
  "compliant",
  "compliance passed",
  "validated design",
  "guaranteed",
  "final architecture",
  "target state achieved",
];
