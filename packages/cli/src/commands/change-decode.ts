// I/O boundary for `rvs change validate`/`evaluate`: reads a caller-supplied
// `--file` path and hands its parsed content to @rvs/change-workbench's own
// canonical decodeProposedChangeSet() boundary. This module owns only I/O
// concerns (file existence, byte-size precheck, JSON syntax) -- per
// Milestone 11.2 §3, semantic proposal validation (schema_version,
// operation kind, structural/resource bounds, prototype-pollution shape)
// belongs solely to @rvs/change-workbench and is never reimplemented here.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { decodeProposedChangeSet, MAX_SERIALIZED_BYTES } from "@rvs/change-workbench";
import type { ProposalValidationIssue, ProposedChangeSet } from "@rvs/change-workbench";

export type ChangeProposalFileDecodeResult =
  | { status: "ok"; path: string; changeSet: ProposedChangeSet }
  | { status: "rejected"; path: string; issues: ProposalValidationIssue[] };

function rejected(path: string, code: string, detail: string): ChangeProposalFileDecodeResult {
  return { status: "rejected", path, issues: [{ code, operation_index: -1, detail, blocking: true }] };
}

/**
 * Resolves `filePath` against `repoRoot` and decodes it into a
 * ProposedChangeSet. The file's byte size is checked via `statSync` before
 * ever reading its content, so an oversized document is rejected without
 * being loaded into memory. No path-containment restriction is applied
 * (matching this repo's existing `--file`/`--from` precedent in
 * decisions-compare.ts/export-graph-report.ts -- simple `resolve()` +
 * `existsSync`, arbitrary caller-supplied input reads are not confined to
 * the repository root).
 */
export function decodeProposalFile(repoRoot: string, filePath: string): ChangeProposalFileDecodeResult {
  const path = resolve(repoRoot, filePath);

  if (!existsSync(path)) {
    return rejected(path, "file_not_found", `No proposal file found at ${path}.`);
  }

  const byteLength = statSync(path).size;
  if (byteLength > MAX_SERIALIZED_BYTES) {
    return rejected(path, "input_too_large", `Proposal file at ${path} is ${byteLength} byte(s), exceeding the ${MAX_SERIALIZED_BYTES}-byte limit for a proposal document.`);
  }

  const raw = readFileSync(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return rejected(path, "malformed_json", `Proposal file at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const decoded = decodeProposedChangeSet(parsed, Buffer.byteLength(raw, "utf8"));
  if (decoded.status === "rejected") {
    return { status: "rejected", path, issues: decoded.issues };
  }
  return { status: "ok", path, changeSet: decoded.changeSet };
}
