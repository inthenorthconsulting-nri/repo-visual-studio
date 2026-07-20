import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GOVERNANCE_CACHE_DIR, GOVERNANCE_OUTPUT_FILES, GOVERNANCE_SNAPSHOTS_DIR } from "@rvs/governance-intelligence";
import type { GovernanceBaseline, IntelligenceSnapshot } from "@rvs/governance-intelligence";
import { readCachedJsonOptional } from "./cache.js";

// ---------------------------------------------------------------------------
// Governance output is namespaced under .rvs/cache/governance/ rather than
// the flat .rvs/cache/ root the rest of the CLI's cache helpers (cache.ts)
// use, since governance accumulates a history of snapshots over time (see
// GOVERNANCE_SNAPSHOTS_DIR) rather than a single "latest" artifact per kind.
//
// This module also defines and implements the on-disk "snapshot envelope"
// format this CLI layer introduces:
//
//   SnapshotEnvelope = { snapshot: IntelligenceSnapshot, rawArtifacts: RawArtifacts }
//
// @rvs/governance-intelligence's own IntelligenceSnapshot (contracts.ts)
// deliberately never embeds the raw architecture/capability/product/
// portfolio JSON it was fingerprinted from -- only a digest per domain. But
// `rvs governance compare` needs the RAW artifact JSON for both the
// "source"/baseline and "target"/current sides to actually run the diff
// engines (diffArchitecture/diffCapability/diffProduct/diffPortfolio and
// assessBlastRadius all take `...Artifact: unknown`, not a digest). Rather
// than accept a documented limitation where only the current repo's live
// `.rvs/cache/*.json` can ever be diffed against, `rvs snapshot create`
// saves every snapshot file as this envelope -- purely an addition to this
// CLI's own on-disk format; nothing in @rvs/governance-intelligence reads or
// requires it.
//
// A promoted baseline (`rvs governance baseline set`) carries the same
// `rawArtifacts` alongside the `GovernanceBaseline` shape it writes
// (`GovernanceBaselineFile`), for the identical reason: `showBaseline()` in
// @rvs/governance-intelligence only ever reads/returns a typed
// `GovernanceBaseline` (it does `raw as GovernanceBaseline`, ignoring extra
// keys), but the JSON actually on disk at `baseline-snapshot.json` carries
// one extra `rawArtifacts` field this CLI's own baseline-reading code reads
// back out directly, alongside calling `showBaseline()` for the typed view.
// ---------------------------------------------------------------------------

export interface RawArtifacts {
  architecture?: unknown;
  capability?: unknown;
  product?: unknown;
  portfolio?: unknown;
}

export interface SnapshotEnvelope {
  snapshot: IntelligenceSnapshot;
  rawArtifacts: RawArtifacts;
}

export interface GovernanceBaselineFile extends GovernanceBaseline {
  rawArtifacts?: RawArtifacts;
}

export const BASELINE_SNAPSHOT_FILE = "baseline-snapshot.json";

export function governanceCacheDir(repoRoot: string): string {
  return resolve(repoRoot, GOVERNANCE_CACHE_DIR);
}

export function governanceSnapshotsDir(repoRoot: string): string {
  return resolve(repoRoot, GOVERNANCE_SNAPSHOTS_DIR);
}

export function governanceOutputPath(repoRoot: string, file: string): string {
  return resolve(governanceCacheDir(repoRoot), file);
}

export function readGovernanceCachedJson<T>(repoRoot: string, file: string): T {
  const path = governanceOutputPath(repoRoot, file);
  if (!existsSync(path)) {
    throw new Error(`Missing .rvs/cache/governance/${file}. Run \`rvs governance compare\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readGovernanceCachedJsonOptional<T>(repoRoot: string, file: string): T | undefined {
  const path = governanceOutputPath(repoRoot, file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes every present (non-undefined) key of `outputs` to its corresponding GOVERNANCE_OUTPUT_FILES filename under .rvs/cache/governance/. */
export function writeGovernanceOutputs(repoRoot: string, outputs: Partial<Record<keyof typeof GOVERNANCE_OUTPUT_FILES, unknown>>): void {
  mkdirSync(governanceCacheDir(repoRoot), { recursive: true });
  for (const [key, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    const file = GOVERNANCE_OUTPUT_FILES[key as keyof typeof GOVERNANCE_OUTPUT_FILES];
    writeFileSync(governanceOutputPath(repoRoot, file), JSON.stringify(value, null, 2));
  }
}

/**
 * Resolves a snapshot reference the same way `rvs governance baseline set`
 * and `rvs governance compare --from/--to` both accept it: an absolute/
 * relative filesystem path (resolved against repoRoot), or a bare snapshot
 * id/filename looked up under GOVERNANCE_SNAPSHOTS_DIR (with or without a
 * trailing ".json").
 */
export function resolveSnapshotRefPath(repoRoot: string, ref: string): string {
  const asGivenPath = resolve(repoRoot, ref);
  if (existsSync(asGivenPath)) return asGivenPath;

  const snapshotsDir = governanceSnapshotsDir(repoRoot);
  const direct = resolve(snapshotsDir, ref);
  if (existsSync(direct)) return direct;

  const withExtension = resolve(snapshotsDir, `${ref}.json`);
  if (existsSync(withExtension)) return withExtension;

  throw new Error(
    `No snapshot found for "${ref}" (checked as a path relative to the repo root, and as a snapshot id/filename under .rvs/cache/governance/snapshots/). Run \`rvs snapshot create\` first.`,
  );
}

export function readSnapshotEnvelope(repoRoot: string, ref: string): SnapshotEnvelope {
  const path = resolveSnapshotRefPath(repoRoot, ref);
  return JSON.parse(readFileSync(path, "utf8")) as SnapshotEnvelope;
}

/** Best-effort snapshot-file reader for showBaseline()'s injected `readSnapshotFile` callback: resolves a path/id the same way resolveSnapshotRefPath does, but returns undefined (never throws) when nothing resolves, matching showBaseline()'s "not found" contract. */
export function readSnapshotFileForBaseline(repoRoot: string): (path: string) => unknown {
  return (path: string) => {
    let resolvedPath: string;
    try {
      resolvedPath = resolveSnapshotRefPath(repoRoot, path);
    } catch {
      return undefined;
    }
    return JSON.parse(readFileSync(resolvedPath, "utf8"));
  };
}

export function sanitizeGovernanceFilename(part: string): string {
  return part.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

/** Reads the four cached intelligence artifacts (architecture/capability/product, and portfolio when requested) from the flat .rvs/cache/ root -- the ~10-line "current artifacts" read shared by `rvs snapshot create` and `rvs governance compare`'s default "to" side. */
export function readCurrentRawArtifacts(repoRoot: string, includePortfolio: boolean): RawArtifacts {
  return {
    architecture: readCachedJsonOptional<unknown>(repoRoot, "architecture-intelligence.json"),
    capability: readCachedJsonOptional<unknown>(repoRoot, "capability-model.json"),
    product: readCachedJsonOptional<unknown>(repoRoot, "product-identity-model.json"),
    portfolio: includePortfolio ? readCachedJsonOptional<unknown>(repoRoot, "portfolio-model.json") : undefined,
  };
}
