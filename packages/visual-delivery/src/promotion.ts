import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  PromotionStatus,
  TargetState,
  VerifiedVisualArtifact,
  VisualDeliveryCandidate,
  VisualVerificationResult,
} from "./contracts.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION } from "./contracts.js";
import { buildVerifiedArtifactId, digestOfBytes } from "./ids.js";
import { readVerifiedHistory } from "./history.js";
import { candidateAbsolutePath } from "./candidate.js";
import { repoRelative, resolveTarget } from "./security.js";

// Promotion.
//
// One file replaces another, and the only interesting thing about it is what
// must never be observable: a moment where the target is neither the old
// artifact nor the new one. Opening the target and streaming the candidate
// into it produces exactly that moment, and a crash inside it leaves a reader
// with half a document and no way to tell. So the candidate is copied beside
// the target under a temporary name and then renamed onto it, which the
// filesystem performs atomically within a directory: every reader sees the
// old bytes or the new bytes and never anything between.
//
// Nothing here decides whether to promote. `verifyCandidate` answered that,
// and this module refuses anything that is not `passed`.

/** Reads what is at the target now, and what -- if anything -- verified it. */
export function readTargetState(repoRoot: string, targetPath: string): TargetState {
  const absolute = resolveTarget(repoRoot, targetPath);
  const relative = repoRelative(repoRoot, absolute);
  const history = readVerifiedHistory(repoRoot, relative);

  if (!existsSync(absolute)) {
    return { path: relative, exists: false, digest: null, verified: history.current, unverified_target_present: false };
  }

  const digest = digestOfBytes(readFileSync(absolute));
  const verified = history.current !== null && history.current.artifact_digest === digest ? history.current : null;
  return {
    path: relative,
    exists: true,
    digest,
    verified,
    // A file is here and no verified record accounts for these exact bytes.
    // Reported, never assumed verified, and never removed on that basis: it
    // may predate verified delivery, or have been written by `rvs graph open`
    // without `--verified`, and either way it is somebody's output.
    unverified_target_present: verified === null,
  };
}

export interface PromotionInput {
  repoRoot: string;
  candidate: VisualDeliveryCandidate;
  result: VisualVerificationResult;
  /** ISO timestamp recorded on the verified record. Metadata; never part of any identity. */
  verified_at: string;
}

export interface PromotionOutcome {
  status: PromotionStatus;
  reason: string;
  verified: VerifiedVisualArtifact | null;
  digest_before: string | null;
  digest_after: string | null;
  /** True when the bytes at the target are exactly what they were before this run. */
  target_preserved: boolean;
}

function refuse(reason: string, before: string | null): PromotionOutcome {
  return {
    status: "not_promoted",
    reason,
    verified: null,
    digest_before: before,
    digest_after: before,
    target_preserved: true,
  };
}

/**
 * Replaces the target with the candidate, or explains why it did not.
 *
 * Four refusals come before any byte is touched: a status other than `passed`,
 * a candidate whose staged bytes no longer match the digest that was verified,
 * a generation no newer than the one already promoted, and a target path that
 * does not resolve inside the repository. Each of them leaves the target
 * exactly as it was found.
 */
export function promoteCandidate(input: PromotionInput): PromotionOutcome {
  const { repoRoot, candidate, result } = input;
  const targetAbsolute = resolveTarget(repoRoot, candidate.target_path);
  const state = readTargetState(repoRoot, candidate.target_path);
  const before = state.digest;

  if (result.status !== "passed") {
    return refuse(
      result.status === "incomplete"
        ? `Verification is incomplete, so nothing is known about this candidate. ${result.incomplete_reason ?? ""}`.trim()
        : `Verification status is "${result.status}". Only a passed verification promotes.`,
      before,
    );
  }

  // The bytes that were verified are the bytes that get promoted. Re-reading
  // and re-digesting closes the window between validation and replacement:
  // anything that touched the staged file in between -- another process, a
  // watch run, an editor -- makes this refuse rather than promote something
  // nobody measured.
  const stagedPath = candidateAbsolutePath(repoRoot, candidate);
  let staged: Buffer;
  try {
    staged = readFileSync(stagedPath);
  } catch (error) {
    return refuse(
      `The staged candidate at ${candidate.source_path} could not be read back (${(error as Error).message}). Nothing was replaced.`,
      before,
    );
  }
  const stagedDigest = digestOfBytes(staged);
  if (stagedDigest !== candidate.artifact_digest) {
    return refuse(
      `The staged candidate changed after it was verified (${candidate.artifact_digest.slice(0, 12)} verified, ${stagedDigest.slice(0, 12)} on disk). Nothing was replaced.`,
      before,
    );
  }

  // Generation ordering. Two runs against one target can overlap -- two
  // terminals, or a regeneration started before the first finished -- and the
  // one that finishes second is not necessarily the one that started second.
  // A candidate from an older run therefore cannot replace a newer verified
  // artifact, however clean its own verification was.
  const history = readVerifiedHistory(repoRoot, state.path);
  if (history.current !== null && candidate.generation <= history.current.generation) {
    return refuse(
      `Candidate is from generation ${candidate.generation}; generation ${history.current.generation} is already promoted to ${state.path}. ` +
        `An older run does not replace a newer verified artifact.`,
      before,
    );
  }

  const verified: VerifiedVisualArtifact = {
    verified_artifact_id: buildVerifiedArtifactId(result.verification_digest),
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    artifact_digest: candidate.artifact_digest,
    visual_spec_id: candidate.visual_spec_id,
    source_digest: candidate.source_digest,
    verification_digest: result.verification_digest,
    verified_at: input.verified_at,
    candidate_id: candidate.candidate_id,
    generation: candidate.generation,
    target_path: state.path,
    artifact_type: candidate.artifact_type,
    profile_id: result.profile.id,
    profile_version: result.profile.version,
    validator_summary: result.validator_summary,
  };

  const directory = dirname(targetAbsolute);
  mkdirSync(directory, { recursive: true });
  // Beside the target rather than in the staging root, because rename is only
  // atomic within a filesystem and the cache may be on another one.
  const temporary = join(directory, `.${candidate.run_id}.${candidate.candidate_id}.rvs-promote`);
  try {
    copyFileSync(stagedPath, temporary);
    const copied = statSync(temporary);
    if (copied.size !== staged.byteLength) {
      throw new Error(`copy is ${copied.size} bytes; the candidate is ${staged.byteLength}`);
    }
    renameSync(temporary, targetAbsolute);
  } catch (error) {
    rmSync(temporary, { force: true });
    const after = existsSync(targetAbsolute) ? digestOfBytes(readFileSync(targetAbsolute)) : null;
    return {
      status: "promotion_failed",
      reason: `The verified candidate could not be written to ${state.path}: ${(error as Error).message}. The existing artifact was not removed.`,
      verified: null,
      digest_before: before,
      digest_after: after,
      target_preserved: after === before,
    };
  }

  // Rechecked from disk. The promotion is only complete when the target's own
  // bytes hash to what was verified -- anything else and the file at the
  // target is not the file that passed, whatever the rename returned.
  const after = digestOfBytes(readFileSync(targetAbsolute));
  if (after !== candidate.artifact_digest) {
    return {
      status: "promotion_failed",
      reason: `${state.path} hashes to ${after.slice(0, 12)} after replacement; the verified candidate is ${candidate.artifact_digest.slice(0, 12)}.`,
      verified: null,
      digest_before: before,
      digest_after: after,
      target_preserved: after === before,
    };
  }

  return {
    status: "promoted",
    reason: `Verified under ${result.profile.id} and promoted to ${state.path}.`,
    verified,
    digest_before: before,
    digest_after: after,
    target_preserved: before === after,
  };
}
