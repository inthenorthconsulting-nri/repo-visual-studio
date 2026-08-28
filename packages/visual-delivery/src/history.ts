import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VerifiedHistory, VerifiedVisualArtifact } from "./contracts.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION } from "./contracts.js";
import { targetKey } from "./ids.js";
import { deliveryRoot } from "./security.js";

// The verified record.
//
// Metadata only, and bounded. Keeping the artifacts themselves would turn a
// cache directory into an unbounded pile of megabyte HTML files -- five
// regenerations of a large explorer is already more than the repository it
// describes -- and it would buy nothing, because the current artifact is at
// the target and the previous ones are reachable through Git like every other
// file in the working tree.
//
// What is kept is the fact nobody else records: which bytes passed which
// profile, and which ones passed before them.

/** Verified records retained behind the current one. */
export const HISTORY_LIMIT = 5;

const TARGETS_DIR = "targets";
const VERIFIED_FILE = "verified.json";

export function targetStateDirectory(repoRoot: string, targetPath: string): string {
  return join(deliveryRoot(repoRoot), TARGETS_DIR, targetKey(targetPath));
}

function historyPath(repoRoot: string, targetPath: string): string {
  return join(targetStateDirectory(repoRoot, targetPath), VERIFIED_FILE);
}

function emptyHistory(targetPath: string): VerifiedHistory {
  return { schema_version: VISUAL_DELIVERY_SCHEMA_VERSION, target_path: targetPath, current: null, previous: [] };
}

/**
 * Reads the verified record for a target.
 *
 * An unreadable or unparseable record reads as "nothing has ever been
 * verified here", which is the conservative answer: it can only cause an
 * extra verification, never a promotion that should not have happened.
 */
export function readVerifiedHistory(repoRoot: string, targetPath: string): VerifiedHistory {
  try {
    const parsed = JSON.parse(readFileSync(historyPath(repoRoot, targetPath), "utf8")) as VerifiedHistory;
    if (typeof parsed !== "object" || parsed === null) return emptyHistory(targetPath);
    return {
      schema_version: parsed.schema_version ?? VISUAL_DELIVERY_SCHEMA_VERSION,
      target_path: targetPath,
      current: parsed.current ?? null,
      previous: Array.isArray(parsed.previous) ? parsed.previous : [],
    };
  } catch {
    return emptyHistory(targetPath);
  }
}

/** Writes the record through a temporary file, so a crash mid-write cannot leave a truncated one. */
export function writeVerifiedHistory(repoRoot: string, history: VerifiedHistory): string {
  const path = historyPath(repoRoot, history.target_path);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(history, null, 2)}\n`);
  renameSync(partial, path);
  return path;
}

/** The new record after a promotion: the promoted artifact current, the previous one at the head of a capped list. */
export function withPromotion(history: VerifiedHistory, verified: VerifiedVisualArtifact): VerifiedHistory {
  const previous = history.current === null ? history.previous : [history.current, ...history.previous];
  return {
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    target_path: history.target_path,
    current: verified,
    previous: previous.slice(0, HISTORY_LIMIT),
  };
}

/**
 * Whether a verified record still describes the rules being applied.
 *
 * A record made under `visual-interactive-v1` with one config digest is not
 * evidence about `visual-interactive-v1` with another, and it is not evidence
 * about `visual-print-v1` at all. Neither case makes the artifact wrong, and
 * neither is re-labelled: the record says what it passed, and this function
 * says whether that is still the question being asked.
 */
export function verificationIsStale(
  verified: VerifiedVisualArtifact,
  profileId: string,
  profileVersion: string,
  expectedVerificationDigest: string,
): boolean {
  return (
    verified.profile_id !== profileId ||
    verified.profile_version !== profileVersion ||
    verified.verification_digest !== expectedVerificationDigest
  );
}
