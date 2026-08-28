import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { PreviewInfo, VerificationStatus } from "./contracts.js";

// Preview.
//
// There is no server here, and that is a decision rather than an omission.
//
// The artifacts this layer delivers are single self-contained HTML files:
// every style, every script and every glyph is inside them, they declare a
// content security policy that forbids loading anything, and they open from
// `file://` with the network unplugged. A local HTTP server would add a bound
// port, a lifetime to manage, a process that can outlive the command that
// started it, and a second way for repository content to leave the machine --
// in exchange for showing the same bytes the filesystem already shows.
//
// So preview is a path, a URL, and one honest sentence about what the reader
// is looking at. Nothing is watched, nothing is served, nothing keeps running
// after the command returns.

/** The four things a reader may be told. Deliberately not five. */
export const PREVIEW_STATUS_LABELS: Readonly<Record<PreviewInfo["status"], string>> = {
  // "Verified" is the strongest word available, and it means one thing: these
  // exact bytes completed this named profile. Not approved, not signed off,
  // not safe to merge -- none of which a validator can measure.
  verified: "Verified",
  "candidate-validating": "Candidate validating",
  "candidate-rejected": "Candidate rejected",
  "last-known-good-retained": "Last known good retained",
};

export function previewValidating(targetPath: string): PreviewInfo {
  return {
    status: "candidate-validating",
    status_label: PREVIEW_STATUS_LABELS["candidate-validating"],
    url: null,
    path: targetPath,
  };
}

/**
 * What the reader can open now, and what it is.
 *
 * `verified` only when this run promoted. A target that still holds an earlier
 * verified artifact reports `last-known-good-retained`, because the reader is
 * looking at something real and good but not at what they just generated --
 * and telling them "verified" would let them believe their edit is on screen.
 */
export function previewFor(
  repoRoot: string,
  targetPath: string,
  status: VerificationStatus,
  promoted: boolean,
  targetExists: boolean,
): PreviewInfo {
  const absolute = join(repoRoot, targetPath);
  const url = targetExists && existsSync(absolute) ? pathToFileURL(absolute).toString() : null;

  const state: PreviewInfo["status"] = promoted
    ? "verified"
    : url !== null
      ? "last-known-good-retained"
      : status === "passed"
        ? "candidate-validating"
        : "candidate-rejected";

  return { status: state, status_label: PREVIEW_STATUS_LABELS[state], url, path: targetPath };
}
