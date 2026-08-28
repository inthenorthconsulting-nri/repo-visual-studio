import type { Logger } from "@rvs/core";
import type { MotionPlan, VisualCommunicationSpec } from "@rvs/visual-intelligence";
import type { ComposedDocument } from "@rvs/visual-composition";
import {
  DEFAULT_PROFILE_IDS,
  deliverVisualArtifact,
  deliveryConsoleLines,
  profileIds,
  requireProfile,
} from "@rvs/visual-delivery";
import type {
  CandidateGenerationMetadata,
  UpstreamFinding,
  VerificationProfile,
  VisualArtifactType,
  VisualDeliveryOutcome,
} from "@rvs/visual-delivery";

// The one verified-delivery path both visual commands use.
//
// `rvs graph open` and `rvs graph review` draw different things, but "may this
// replace what is already there" is the same question for both and gets one
// implementation. Per-command preview code would drift -- one of them would
// grow a check the other lacked -- and "verified" would quietly come to mean
// two different things depending on which command produced the file.
//
// Without `--verified` neither command comes near this module. They write
// their output exactly as they always did.

export interface VerifiedDeliveryOptions {
  verified?: boolean;
  profile?: string;
}

/**
 * The profile a run verifies against.
 *
 * Named profiles only. There is no way to pass in a threshold, a rule or a
 * validator: the artifact being gated does not get to choose how strictly it
 * is gated.
 */
export function resolveDeliveryProfile(
  artifactType: VisualArtifactType,
  requested: string | undefined,
): VerificationProfile {
  if (requested === undefined || requested.trim() === "") {
    return requireProfile(DEFAULT_PROFILE_IDS[artifactType]);
  }
  const profile = requested.trim();
  try {
    return requireProfile(profile);
  } catch {
    throw new Error(`Unknown verification profile "${profile}". Expected one of: ${profileIds().join(", ")}.`);
  }
}

export interface VerifiedDeliveryInput {
  repoRoot: string;
  logger: Logger;
  artifact_type: VisualArtifactType;
  profile: VerificationProfile;
  /** Where the verified artifact goes: the same path `--output` names. */
  target_path: string;
  /** The artifact exactly as its renderer produced it. Never regenerated here. */
  html: string;
  document: ComposedDocument;
  producer: string;
  /** Paths the source model marked critical, passed to the spec validator unchanged. */
  critical_paths?: ReadonlyArray<{ id: string; node_ids: readonly string[] }>;
  source_snapshot_ids?: readonly string[];
  change_review_model_id?: string;
  /** Findings from a validator whose input this layer does not hold, carried through unchanged. */
  upstream_findings?: readonly UpstreamFinding[];
  /** The plan the page will really run, where the surface has one at build time. */
  motion?: { plan: MotionPlan; known_target_ids: readonly string[] };
  /** The clock, read once by the caller. */
  now: string;
}

/**
 * Verifies a candidate and promotes it only if every required check passed.
 *
 * Returns the outcome and sets a non-zero exit code when nothing was
 * promoted. A gate that exits zero on rejection is a gate nobody notices.
 */
export async function deliverVerifiedArtifact(input: VerifiedDeliveryInput): Promise<VisualDeliveryOutcome> {
  const spec: VisualCommunicationSpec = input.document.spec;
  const receipt = input.document.receipt;

  // What this candidate was made from, by reference. The upstream artifacts
  // are not copied in: a receipt that restated the fidelity receipt would be a
  // second copy that can disagree with the first.
  const metadata: CandidateGenerationMetadata = {
    producer: input.producer,
    fidelity_receipt_id: receipt.id,
    fidelity_receipt_digest: receipt.rendered_digest,
    source_snapshot_ids: [...(input.source_snapshot_ids ?? [])].sort(),
    upstream_artifact_ids: [...spec.generation_metadata.source_artifact_ids].sort(),
    ...(input.change_review_model_id === undefined
      ? {}
      : { change_review_model_id: input.change_review_model_id }),
  };

  const outcome = await deliverVisualArtifact({
    repoRoot: input.repoRoot,
    artifact_type: input.artifact_type,
    target_path: input.target_path,
    html: input.html,
    profile: input.profile,
    spec,
    coverage: input.document.coverage,
    // The fit scale the primary view was actually drawn at, so the legible
    // floor is measured against what a reader sees rather than what the type
    // scale declared before layout shrank it. Defaulting it to 1 would let a
    // drawing that had been fitted down to two thirds of its size pass a 14px
    // floor while showing the reader 9px.
    render_scale: input.document.primary.render.scale,
    source_digest: receipt.source_digest,
    metadata,
    now: input.now,
    ...(input.critical_paths === undefined ? {} : { critical_paths: input.critical_paths }),
    ...(input.motion === undefined ? {} : { motion: input.motion }),
    ...(input.upstream_findings === undefined ? {} : { upstream_findings: input.upstream_findings }),
  });

  for (const line of deliveryConsoleLines(outcome)) input.logger.info(`  ${line}`);

  if (outcome.promotion !== "promoted") process.exitCode = 1;
  return outcome;
}
