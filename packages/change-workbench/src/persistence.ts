// Non-default persistence: path computation and staleness semantics only.
// This package deliberately never performs fs I/O itself -- exactly like
// every sibling domain package (`@rvs/knowledge-graph`,
// `@rvs/decision-intelligence`, `@rvs/governance-intelligence`), which only
// define cache-directory *constants* in their own `constants.ts` and leave
// actual `readFileSync`/`writeFileSync` calls to the CLI layer's
// `packages/cli/src/*-cache.ts` modules. Milestone 11.1 explicitly forbids
// CLI wiring, so there is no `packages/cli/src/change-workbench-cache.ts`
// yet; this module is what a future CLI layer would call to know *where* to
// read/write and *whether* a previously stored advisory is still current --
// it never reads or writes a file on its own, and never auto-recomputes or
// mutates a previously stored advisory.

import { canonicalize, digestOf } from "./ids.js";
import { CHANGE_WORKBENCH_ADVISORIES_DIR } from "./constants.js";
import type { ChangeAdvisory, ChangeAdvisoryFreshness, StoredChangeAdvisory } from "./contracts.js";

/** Relative path (from repo root) a caller would read/write a stored advisory at. Pure string computation -- never touches the filesystem. */
export function buildChangeAdvisoryCachePath(repositoryId: string, advisoryId: string): string {
  return `${CHANGE_WORKBENCH_ADVISORIES_DIR}/${sanitizePathSegment(repositoryId)}/${sanitizePathSegment(advisoryId)}.json`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

/** Wraps a freshly computed `ChangeAdvisory` for storage. The stored record's own digest is recorded at store time; it is never touched again by this package after that. */
export function toStoredChangeAdvisory(advisory: ChangeAdvisory): StoredChangeAdvisory {
  return { advisory, base_snapshot_digest_at_store_time: advisory.base_snapshot_digest };
}

/**
 * Compares a previously stored advisory's baseline against a freshly
 * observed `currentBaseSnapshotDigest`. `"current"` only when the two
 * digests are byte-identical; any mismatch -- however small -- degrades to
 * `"stale_equivalent"`, since this package has no way to know how much the
 * underlying graph moved without a fresh evaluation. This function never
 * recomputes, mutates, or discards the stored advisory itself; it only
 * classifies it. The caller decides what to do with a `"stale_equivalent"`
 * result (typically: re-run `buildChangeAdvisory()` and store the new
 * result under a new digest-qualified path).
 */
export function assessChangeAdvisoryFreshness(stored: StoredChangeAdvisory, currentBaseSnapshotDigest: string): ChangeAdvisoryFreshness {
  return stored.base_snapshot_digest_at_store_time === currentBaseSnapshotDigest ? "current" : "stale_equivalent";
}

/** Deterministic digest of a `ProposedChangeSet`'s already-produced `ChangeAdvisory` output shape, useful for a caller that wants to detect "did re-evaluating this exact proposal against this exact baseline produce a byte-identical advisory" without diffing the whole object by hand. Excludes nothing -- a `ChangeAdvisory` carries no timestamp fields, so this digest is itself deterministic across repeated runs. */
export function digestChangeAdvisory(advisory: ChangeAdvisory): string {
  return digestOf(canonicalize(advisory));
}
