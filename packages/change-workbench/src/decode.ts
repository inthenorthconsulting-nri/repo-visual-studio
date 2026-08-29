// Runtime decode boundary for untrusted, unknown-typed JSON. The one place a
// caller's `unknown` input becomes a `ProposedChangeSet`-shaped candidate for
// validateProposedChangeSet() to give a semantic verdict on:
//
//   unknown -> decodeProposedChangeSet() -> candidate ProposedChangeSet
//           -> validateProposedChangeSet() -> Workbench evaluation
//
// This module owns purely structural/resource-bound/security concerns --
// is the input even shaped enough to attempt semantic validation, and is it
// small enough to safely walk -- never semantic ones. Unsupported
// schema_version and unrecognized operation `kind` are semantic judgments
// about an otherwise well-shaped document, and stay owned by
// validateProposedChangeSet() (validation.ts), per this package's single-
// canonical-validator contract: this module deliberately does not read or
// reject on `schema_version`, and only checks that each operation's `kind`
// is *a string*, never that it is a *recognized* one.
//
// TypeScript's discriminated union for ProposalOperation describes
// compile-time shape only. Untrusted JSON has no types at runtime, so every
// check below is a real runtime check against `unknown` -- never a type
// assertion trusted on its own. A caller that already holds a genuine
// ProposedChangeSet (e.g. composeProposedChangeSet()'s own output) has no
// need for this module and can call validateProposedChangeSet() directly;
// decodeProposedChangeSet() exists only for the unknown-typed entry point.

import type { ProposalValidationIssue, ProposedChangeSet } from "./contracts.js";
import { buildProposedChangeSetId } from "./ids.js";

/** Upper bound on a proposal document's serialized size. High enough for a legitimate proposal (hundreds of operations with attributes and evidence refs) while bounding the cost of parsing/walking a hostile document. */
export const MAX_SERIALIZED_BYTES = 2_000_000;
/** Upper bound on operation count per proposal. */
export const MAX_OPERATION_COUNT = 500;
/** Upper bound on JSON nesting depth anywhere in the document (attribute bags included). */
export const MAX_JSON_DEPTH = 12;
/** Upper bound on the number of own keys any single JSON object in the document may have. */
export const MAX_OBJECT_KEYS = 200;
/** Upper bound on the length of any JSON array in the document. Deliberately larger than MAX_OPERATION_COUNT, so a too-many-operations document is diagnosed by the more specific "too_many_operations" check rather than this generic structural one. */
export const MAX_ARRAY_LENGTH = 1000;

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ProposedChangeSetDecodeResult = { status: "ok"; changeSet: ProposedChangeSet } | { status: "rejected"; issues: ProposalValidationIssue[] };

function issue(index: number, code: string, detail: string): ProposalValidationIssue {
  return { code, operation_index: index, detail, blocking: true };
}

function rejected(index: number, code: string, detail: string): ProposedChangeSetDecodeResult {
  return { status: "rejected", issues: [issue(index, code, detail)] };
}

type StructuralProblem = "prototype_pollution_shaped_key" | "resource_bound_exceeded";

/**
 * Recursively walks `value`, returning the first structural problem found
 * (a pollution key, or a depth/key-count/array-length bound exceeded) or
 * undefined if none. Aborts on the first bound exceeded at any depth, so a
 * hostile document cannot force unbounded traversal.
 */
function findStructuralProblem(value: unknown, depth: number): StructuralProblem | undefined {
  if (depth > MAX_JSON_DEPTH) return "resource_bound_exceeded";
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) return "resource_bound_exceeded";
    for (const entry of value) {
      const problem = findStructuralProblem(entry, depth + 1);
      if (problem) return problem;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > MAX_OBJECT_KEYS) return "resource_bound_exceeded";
    for (const key of keys) {
      if (POLLUTION_KEYS.has(key)) return "prototype_pollution_shaped_key";
      const problem = findStructuralProblem((value as Record<string, unknown>)[key], depth + 1);
      if (problem) return problem;
    }
  }
  return undefined;
}

/**
 * Decodes `raw` -- the result of `JSON.parse()`ing untrusted input, or any
 * other unknown-typed value a future programmatic caller (script, CI
 * process, agent) hands in directly -- into a candidate `ProposedChangeSet`,
 * or a set of blocking `ProposalValidationIssue`s explaining why it could
 * not be. `rawByteLength`, when supplied, is checked against
 * MAX_SERIALIZED_BYTES before anything else is inspected (a caller reading
 * from a file can pass the byte length of the raw text it read, avoiding a
 * parse-then-reject round trip on an oversized document; a caller that
 * already has an in-memory `unknown` value with no known byte length may
 * omit it).
 *
 * schema_version and operation `kind` recognition are NOT checked here --
 * see the module comment. A caller must still pass the returned `changeSet`
 * through validateProposedChangeSet() to get a definitive semantic verdict.
 */
export function decodeProposedChangeSet(raw: unknown, rawByteLength?: number): ProposedChangeSetDecodeResult {
  if (rawByteLength !== undefined && rawByteLength > MAX_SERIALIZED_BYTES) {
    return rejected(-1, "input_too_large", `Proposal input is ${rawByteLength} byte(s), exceeding the ${MAX_SERIALIZED_BYTES}-byte limit for a proposal document.`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return rejected(-1, "malformed_envelope", "Proposal input must be a single JSON object, not an array, primitive, or null.");
  }

  const structuralProblem = findStructuralProblem(raw, 0);
  if (structuralProblem === "prototype_pollution_shaped_key") {
    return rejected(-1, "prototype_pollution_shaped_key", "Proposal input contains a __proto__/constructor/prototype key somewhere in its structure -- rejected outright.");
  }
  if (structuralProblem === "resource_bound_exceeded") {
    return rejected(
      -1,
      "resource_bound_exceeded",
      `Proposal input exceeds a structural bound (max nesting depth ${MAX_JSON_DEPTH}, max object keys per object ${MAX_OBJECT_KEYS}, or max array length ${MAX_ARRAY_LENGTH}).`,
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.repository_id !== "string" || candidate.repository_id.length === 0) {
    return rejected(-1, "malformed_envelope", "Proposal is missing a non-empty string repository_id.");
  }

  if (candidate.title !== undefined && typeof candidate.title !== "string") {
    return rejected(-1, "malformed_envelope", "Proposal's title, if present, must be a string.");
  }

  if (candidate.evidence_refs !== undefined && !Array.isArray(candidate.evidence_refs)) {
    return rejected(-1, "malformed_envelope", "Proposal's evidence_refs, if present, must be an array.");
  }

  if (!Array.isArray(candidate.operations)) {
    return rejected(-1, "malformed_envelope", "Proposal is missing an operations array.");
  }

  if (candidate.operations.length > MAX_OPERATION_COUNT) {
    return rejected(-1, "too_many_operations", `Proposal declares ${candidate.operations.length} operation(s), exceeding the ${MAX_OPERATION_COUNT}-operation limit.`);
  }

  for (const [index, operation] of candidate.operations.entries()) {
    if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
      return rejected(index, "malformed_operation", `Operation at index ${index} must be a JSON object.`);
    }
    if (typeof (operation as Record<string, unknown>).kind !== "string") {
      return rejected(index, "malformed_operation", `Operation at index ${index} is missing a string "kind" field.`);
    }
  }

  // `id` is never read from caller input -- it is always this package's own
  // deterministic, content-derived digest of (repository_id, operations),
  // exactly like composeProposedChangeSet() computes it for a first-party-
  // constructed proposal (change-advisory.ts). This is the one place an
  // untrusted document's `id` claim (if it made one) is discarded rather
  // than trusted, so a caller can never spoof a proposal's identity.
  //
  // `schema_version`, in contrast, IS read verbatim from the caller's input
  // -- including a wrong type, an unsupported number, or a missing value --
  // and passed through unchanged. Coercing or defaulting it here would
  // hide exactly the failure validateProposedChangeSet() (validation.ts) is
  // responsible for catching.
  const changeSet: ProposedChangeSet = {
    schema_version: candidate.schema_version as ProposedChangeSet["schema_version"],
    id: buildProposedChangeSetId(candidate.repository_id, candidate.operations),
    repository_id: candidate.repository_id,
    title: candidate.title as string | undefined,
    operations: candidate.operations as ProposedChangeSet["operations"],
    evidence_refs: candidate.evidence_refs as ProposedChangeSet["evidence_refs"],
  };

  return { status: "ok", changeSet };
}
