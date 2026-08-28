// Staged, sequential short-circuit compatibility assessment -- mirrors
// @rvs/governance-intelligence/src/compatibility.ts's shape (never a bare
// boolean, always {status, reasons[]}), adapted from a 2-snapshot
// source/target comparison to an N-artifact (up to six) coverage
// assessment, since a graph build draws from any non-empty subset of the
// six upstream intelligence artifacts rather than comparing exactly two
// snapshots.

import type { CompatibilityAssessment, CompatibilityStatus, GraphSnapshot, UpstreamSourceArtifact } from "./contracts.js";

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

/**
 * Whether two graph snapshots can be compared at all.
 *
 * `assessGraphCompatibility` above answers a different question -- "can a
 * graph be built from the artifacts on hand" -- and answering "can these two
 * graphs be compared" by reaching for it would conflate coverage with
 * comparability. So this is the same staged short-circuit shape applied to a
 * source/target pair, mirroring
 * @rvs/governance-intelligence/src/compatibility.ts's
 * `assessSnapshotCompatibility`.
 *
 * The distinction that matters to a reviewer is between `partial` and
 * `compatible`. A partial comparison is one where a domain is present in one
 * snapshot and not the other: every difference this produces is real, and
 * every silence in the missing domain is uninformative. Anything reading this
 * result has to carry that difference through to the reader rather than
 * presenting a partial answer as a complete one.
 *
 * Comparability turns on *availability*, not on `complete` provenance. A
 * domain is "complete" only when the snapshot recorded which upstream version
 * fed it, which is a statement about traceability; a domain that was read but
 * not version-pinned still supports a real difference, because the same
 * domain was read on both sides. Demanding `complete` here would refuse every
 * pair the rest of RVS can actually produce -- `rvs graph build` records no
 * upstream snapshot ids today -- and a check that no real input can pass is
 * not a safety property, it is an outage.
 *
 * Stages, each short-circuiting:
 *   1. repository identity disagreement            -> incompatible
 *   2. snapshot schema_version disagreement        -> incompatible
 *   3. no domain available in both snapshots       -> incompatible
 *   4. a domain available in one but not the other -> partial
 *   5. every domain available in both              -> compatible
 */
export function assessSnapshotPairCompatibility(
  source: GraphSnapshot,
  target: GraphSnapshot,
): CompatibilityAssessment {
  if (source.repository_id !== target.repository_id) {
    return {
      status: "incompatible",
      reasons: [
        `Repository identity mismatch: the source snapshot is "${source.repository_id}" and the target snapshot is "${target.repository_id}". These are two different repositories, not two states of one.`,
      ],
    };
  }

  if (source.schema_version !== target.schema_version) {
    return {
      status: "incompatible",
      reasons: [
        `Graph schema_version mismatch: the source snapshot is ${source.schema_version} and the target snapshot is ${target.schema_version}. Field-level differences between schema versions are not differences in the architecture.`,
      ],
    };
  }

  const sourceAvailable = availableIn(source);
  const targetAvailable = availableIn(target);
  const both = [...sourceAvailable].filter((domain) => targetAvailable.has(domain)).sort();

  if (both.length === 0) {
    return {
      status: "incompatible",
      reasons: [
        "No upstream domain was read in both snapshots; there is nothing to compare.",
      ],
    };
  }

  const oneSided = [...new Set([...sourceAvailable, ...targetAvailable])]
    .filter((domain) => !(sourceAvailable.has(domain) && targetAvailable.has(domain)))
    .sort();
  if (oneSided.length > 0) {
    return {
      status: "partial",
      reasons: oneSided.map((domain) =>
        sourceAvailable.has(domain)
          ? `${domain} was read in the source snapshot but not in the target snapshot, so no ${domain} difference can be established either way.`
          : `${domain} was read in the target snapshot but not in the source snapshot, so no ${domain} difference can be established either way.`,
      ),
    };
  }

  return { status: "compatible", reasons: [] };
}

/**
 * The domains a comparison of these two snapshots cannot speak about.
 *
 * Returned separately from the status so a caller can say which domains are
 * silent rather than only that some are. A domain missing from both snapshots
 * is included: nobody looked, which is not the same as nothing changed.
 */
export function uncomparableDomains(source: GraphSnapshot, target: GraphSnapshot): UpstreamSourceArtifact[] {
  const sourceAvailable = availableIn(source);
  const targetAvailable = availableIn(target);
  const domains = new Set<UpstreamSourceArtifact>([
    ...source.upstream_artifacts.map((a) => a.source_artifact),
    ...target.upstream_artifacts.map((a) => a.source_artifact),
  ]);
  return [...domains]
    .filter((domain) => !(sourceAvailable.has(domain) && targetAvailable.has(domain)))
    .sort();
}

/**
 * The domains a snapshot actually read.
 *
 * `unavailable` is the one provenance value that means nobody looked;
 * `partial` means the artifact was read without its version being recorded.
 * Comparability asks which domains were read, so both `complete` and
 * `partial` count here.
 */
function availableIn(snapshot: GraphSnapshot): Set<UpstreamSourceArtifact> {
  return new Set(
    snapshot.upstream_artifacts
      .filter((artifact) => artifact.provenance !== "unavailable")
      .map((artifact) => artifact.source_artifact),
  );
}

/** Whether a review may proceed. An incompatible pair fails by default: a difference between two things that are not comparable is not a change. */
export function isComparableStatus(status: CompatibilityStatus): boolean {
  return status !== "incompatible";
}
