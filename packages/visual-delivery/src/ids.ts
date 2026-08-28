import { createHash } from "node:crypto";

// Identity for the delivery layer.
//
// Two kinds of identity live here and they are never mixed. *Content*
// identity -- candidate ids, verification digests, verified artifact ids --
// is derived from what the thing is, so the same inputs name the same thing
// on any machine at any time. *Run* identity -- generations, run ids -- is
// derived from when the run happened relative to other runs, and exists only
// to order promotions. A system that used one for the other would either
// promote a stale artifact because it looked identical, or fail to recognise
// a regeneration because its clock moved.
//
// Nothing here hashes a timestamp.

/** Canonical JSON: object keys sorted at every depth, so key order can never change a digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** SHA-256 over the exact bytes. The candidate's artifact digest is this and nothing else. */
export function digestOfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface CandidateIdentityInput {
  artifact_type: string;
  target_path: string;
  visual_spec_id: string;
  source_digest: string;
  artifact_digest: string;
  validation_profile: string;
}

/**
 * Content identity for a candidate.
 *
 * Stable whenever the inputs are stable: regenerating the same explorer from
 * the same graph under the same profile produces the same id, which is what
 * makes "this is the artifact we already verified" answerable. The staging
 * location is not an input -- where a candidate was written says nothing about
 * what it is.
 */
export function buildCandidateId(input: CandidateIdentityInput): string {
  return `vdc_${digestOf(input).slice(0, 24)}`;
}

/** Content identity for a verified artifact: the verification it completed. */
export function buildVerifiedArtifactId(verificationDigest: string): string {
  return `vva_${verificationDigest.slice(0, 24)}`;
}

/** Identity for a receipt: the candidate it rejected and the findings it rejected it for. */
export function buildReceiptId(candidateId: string, findingIds: readonly string[]): string {
  return `vrr_${digestOf({ candidate_id: candidateId, findings: [...findingIds].sort() }).slice(0, 24)}`;
}

/**
 * Identity for one finding.
 *
 * Same scheme @rvs/visual-intelligence uses for its own: a digest of the code
 * and the subject, so the same defect on the same subject carries the same id
 * across runs, and a receipt diff shows a changed defect rather than a
 * reordering.
 */
export function buildDeliveryFindingId(code: string, subjectId: string): string {
  return `vdf_${digestOf({ code, subject_id: subjectId }).slice(0, 16)}`;
}

/** A filesystem-safe key for a target path, so per-target state has somewhere to live. */
export function targetKey(targetPath: string): string {
  return digestOf({ target: targetPath.split("\\").join("/") }).slice(0, 24);
}
