// Staged, sequential short-circuit compatibility assessment -- mirrors
// @rvs/governance-intelligence/src/compatibility.ts's shape (never a bare
// boolean, always {status, reasons[]}), adapted from a 2-snapshot
// source/target comparison to an N-artifact (up to six) coverage
// assessment, since a graph build draws from any non-empty subset of the
// six upstream intelligence artifacts rather than comparing exactly two
// snapshots.

import type { CompatibilityAssessment, CompatibilityStatus, UpstreamSourceArtifact } from "./contracts.js";

export interface LoadedArtifactInfo {
  source_artifact: UpstreamSourceArtifact;
  present: boolean;
  repository_id?: string;
  schema_version?: number;
  source_generated_at?: string;
}

const SUPPORTED_SCHEMA_VERSIONS: Record<UpstreamSourceArtifact, number[]> = {
  architecture: [1],
  capability: [1],
  product: [1],
  portfolio: [1],
  governance: [1],
  decision: [1],
};

/**
 * 6-stage staged assessment, each stage short-circuiting on the first
 * condition it finds:
 * 1. no artifact present at all -> incompatible
 * 2. present artifacts disagree on repository identity -> incompatible
 * 3. a present artifact's schema_version is unsupported -> incompatible
 * 4. one or more artifacts are absent -> partial
 * 5. present artifacts disagree on source_generated_at -> compatible_with_warnings
 * 6. everything present, consistent, and time-aligned -> compatible
 */
export function assessGraphCompatibility(artifacts: LoadedArtifactInfo[]): CompatibilityAssessment {
  const present = artifacts.filter((artifact) => artifact.present);

  if (present.length === 0) {
    return {
      status: "incompatible",
      reasons: ["No upstream intelligence artifacts are available to build a graph from."],
    };
  }

  const repositoryIds = new Set(
    present.map((artifact) => artifact.repository_id).filter((id): id is string => Boolean(id)),
  );
  if (repositoryIds.size > 1) {
    return {
      status: "incompatible",
      reasons: [
        `Present artifacts disagree on repository identity: ${Array.from(repositoryIds).sort().join(", ")}.`,
      ],
    };
  }

  for (const artifact of present) {
    const supported = SUPPORTED_SCHEMA_VERSIONS[artifact.source_artifact];
    if (artifact.schema_version !== undefined && !supported.includes(artifact.schema_version)) {
      return {
        status: "incompatible",
        reasons: [
          `${artifact.source_artifact} artifact schema_version ${artifact.schema_version} is not supported (expected one of ${supported.join(", ")}).`,
        ],
      };
    }
  }

  const reasons: string[] = [];
  const missing = artifacts.filter((artifact) => !artifact.present).map((artifact) => artifact.source_artifact);
  if (missing.length > 0) {
    reasons.push(
      `Missing artifacts: ${[...missing].sort().join(", ")}. Graph coverage for those domains will be absent.`,
    );
    return { status: "partial", reasons };
  }

  const generatedAtValues = new Set(
    present.map((artifact) => artifact.source_generated_at).filter((value): value is string => Boolean(value)),
  );
  if (generatedAtValues.size > 1) {
    reasons.push(
      `Present artifacts were generated at different times: ${Array.from(generatedAtValues).sort().join(", ")}.`,
    );
    return { status: "compatible_with_warnings", reasons };
  }

  return { status: "compatible", reasons: [] };
}

export function isBuildableStatus(status: CompatibilityStatus): boolean {
  return status !== "incompatible";
}
