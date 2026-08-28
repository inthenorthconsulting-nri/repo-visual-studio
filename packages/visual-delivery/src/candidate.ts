import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CandidateGenerationMetadata, VisualArtifactType, VisualDeliveryCandidate } from "./contracts.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION } from "./contracts.js";
import { buildCandidateId, digestOfBytes } from "./ids.js";
import { deliveryRoot, repoRelative, resolveContained, resolveTarget } from "./security.js";

// Staging.
//
// A candidate is written somewhere that is not the target, and it is written
// completely before anything looks at it. Both halves matter. Generating into
// the target and validating afterwards means a failed validation has already
// destroyed the artifact it was supposed to protect; validating a file that is
// still being written means measuring a document that does not exist yet, and
// half an HTML file parses -- it just parses into something nobody generated.

const RUNS_DIR = "runs";

/** How many finished run directories are kept. Older ones are removed when a new run starts. */
export const RUN_RETENTION = 8;

/** A run's own directory, and the number that orders it against every other run. */
export interface DeliveryRun {
  generation: number;
  run_id: string;
  /** Absolute path of the staging directory this run owns. */
  directory: string;
}

function runsDirectory(repoRoot: string): string {
  return join(deliveryRoot(repoRoot), RUNS_DIR);
}

function generationOf(name: string): number | undefined {
  const match = /^run-(\d{6,})$/.exec(name);
  if (match === null) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function runIdFor(generation: number): string {
  return `run-${String(generation).padStart(6, "0")}`;
}

/**
 * Claims the next generation.
 *
 * `mkdir` is the whole mechanism, and it is chosen because it is atomic:
 * exactly one of two processes racing for the same number gets the directory
 * and the other gets EEXIST and moves on. A counter file read-then-written
 * would hand both of them the same number, which is precisely the case this
 * exists to make impossible.
 */
export function allocateRun(repoRoot: string): DeliveryRun {
  const runs = runsDirectory(repoRoot);
  mkdirSync(runs, { recursive: true });

  let next = 1;
  for (const entry of readdirSync(runs)) {
    const generation = generationOf(entry);
    if (generation !== undefined && generation >= next) next = generation + 1;
  }

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const generation = next + attempt;
    const runId = runIdFor(generation);
    const directory = join(runs, runId);
    try {
      mkdirSync(directory);
      return { generation, run_id: runId, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not claim a delivery generation beneath ${runs} after 1000 attempts.`);
}

/** Removes finished run directories beyond the retention window, oldest first. */
export function pruneRuns(repoRoot: string, keep: number = RUN_RETENTION, exclude: readonly string[] = []): string[] {
  const runs = runsDirectory(repoRoot);
  let entries: string[];
  try {
    entries = readdirSync(runs);
  } catch {
    return [];
  }
  const protectedRuns = new Set(exclude);
  const ordered = entries
    .map((name) => ({ name, generation: generationOf(name) }))
    .filter((entry): entry is { name: string; generation: number } => entry.generation !== undefined)
    .filter((entry) => !protectedRuns.has(entry.name))
    .sort((a, b) => a.generation - b.generation);

  const removable = ordered.slice(0, Math.max(0, ordered.length - keep));
  const removed: string[] = [];
  for (const entry of removable) {
    rmSync(join(runs, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

export interface StageCandidateInput {
  repoRoot: string;
  run: DeliveryRun;
  artifact_type: VisualArtifactType;
  /** Where the artifact would go if it passes. */
  target_path: string;
  html: string;
  visual_spec_id: string;
  /** The fidelity receipt's source digest. */
  source_digest: string;
  validation_profile: string;
  metadata: CandidateGenerationMetadata;
  /** Recorded on the candidate; never part of any identity or digest. */
  created_at: string;
}

/**
 * Writes a candidate into its run directory and describes it.
 *
 * The write is two steps -- a `.partial` file, then a rename -- so no reader
 * ever sees a partly written candidate under the name a validator is about to
 * open. The rename is within one directory, so it is atomic.
 *
 * Nothing here touches the target. The target's own path is recorded because
 * candidate identity includes where the artifact was meant to go: the same
 * bytes destined for two different files are two different candidates.
 */
export function stageCandidate(input: StageCandidateInput): VisualDeliveryCandidate {
  const targetAbsolute = resolveTarget(input.repoRoot, input.target_path);
  const targetRelative = repoRelative(input.repoRoot, targetAbsolute);

  const name = basename(targetAbsolute);
  const partial = resolveContained(input.run.directory, `${name}.partial`, "Candidate staging path");
  const staged = resolveContained(input.run.directory, name, "Candidate staging path");

  const bytes = Buffer.from(input.html, "utf8");
  writeFileSync(partial, bytes);
  renameSync(partial, staged);

  // Digested from what is on disk, not from the string that was passed in.
  // Those are the same bytes; reading them back is what proves it, and the
  // digest that gates promotion must describe the file, not the intention.
  const written = statSync(staged);
  if (written.size !== bytes.byteLength) {
    throw new Error(
      `Staged candidate ${staged} is ${written.size} bytes; ${bytes.byteLength} were written. Staging did not complete.`,
    );
  }
  const artifactDigest = digestOfBytes(bytes);

  const candidateId = buildCandidateId({
    artifact_type: input.artifact_type,
    target_path: targetRelative,
    visual_spec_id: input.visual_spec_id,
    source_digest: input.source_digest,
    artifact_digest: artifactDigest,
    validation_profile: input.validation_profile,
  });

  return {
    candidate_id: candidateId,
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    artifact_type: input.artifact_type,
    source_path: repoRelative(input.repoRoot, staged),
    target_path: targetRelative,
    visual_spec_id: input.visual_spec_id,
    source_digest: input.source_digest,
    artifact_digest: artifactDigest,
    validation_profile: input.validation_profile,
    created_at: input.created_at,
    generation: input.run.generation,
    run_id: input.run.run_id,
    metadata: input.metadata,
  };
}

/** The absolute path of a staged candidate, from the record that describes it. */
export function candidateAbsolutePath(repoRoot: string, candidate: VisualDeliveryCandidate): string {
  return join(repoRoot, candidate.source_path);
}
