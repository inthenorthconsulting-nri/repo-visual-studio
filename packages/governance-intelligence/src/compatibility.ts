import type { GovernanceArtifactDigest, GovernanceArtifactKind, GovernanceCompatibilityResult, IntelligenceSnapshot } from "./contracts.js";

const DOMAIN_ORDER: GovernanceArtifactKind[] = ["architecture", "capability", "product", "portfolio"];

function digestByDomain(snapshot: IntelligenceSnapshot): Map<GovernanceArtifactKind, GovernanceArtifactDigest> {
  return new Map(snapshot.artifacts.map((artifact) => [artifact.artifact, artifact]));
}

/**
 * The same staged short-circuit pattern as
 * @rvs/portfolio-intelligence/src/compatibility.ts's assessCompatibility():
 * sequential checks, each short-circuiting to a specific status, only
 * falling through to "compatible" if every check passes. Never returns a
 * bare boolean -- `reasons` always names exactly which check(s) failed and
 * why.
 *
 * Stages, in order:
 *   1. missing artifact       -- no domain has complete provenance in both
 *                                 snapshots at all               -> incompatible
 *   2. schema version mismatch -- a domain present in both disagrees on
 *                                 schema_version                 -> incompatible
 *   3. identity mismatch       -- repository_id or portfolio_id disagree
 *                                 when both are known             -> incompatible
 *   4. reduced coverage        -- some, but not all four, domains are
 *                                 present with complete provenance in both
 *                                                                 -> partial
 *   5. staleness                -- a domain's source_generated_at in the
 *                                 target snapshot precedes the source
 *                                 snapshot's                      -> compatible_with_warnings
 *   6. everything passes                                          -> compatible
 */
export function assessSnapshotCompatibility(source: IntelligenceSnapshot, target: IntelligenceSnapshot): GovernanceCompatibilityResult {
  const sourceByDomain = digestByDomain(source);
  const targetByDomain = digestByDomain(target);

  // Stage 1: missing artifact (no overlap at all).
  const commonComplete = DOMAIN_ORDER.filter((domain) => sourceByDomain.get(domain)?.provenance === "complete" && targetByDomain.get(domain)?.provenance === "complete");
  if (commonComplete.length === 0) {
    return {
      status: "incompatible",
      reasons: ["No domain (architecture/capability/product/portfolio) is present with complete provenance in both snapshots; there is nothing governance can compare."],
    };
  }

  // Stage 2: schema version mismatch among the overlapping domains.
  const schemaMismatchReasons: string[] = [];
  for (const domain of commonComplete) {
    const sourceVersion = sourceByDomain.get(domain)!.schema_version;
    const targetVersion = targetByDomain.get(domain)!.schema_version;
    if (sourceVersion !== undefined && targetVersion !== undefined && sourceVersion !== targetVersion) {
      schemaMismatchReasons.push(`${domain} schema_version mismatch: source snapshot is ${sourceVersion}, target snapshot is ${targetVersion}.`);
    }
  }
  if (schemaMismatchReasons.length > 0) {
    return { status: "incompatible", reasons: schemaMismatchReasons };
  }

  // Stage 3: repository/portfolio identity mismatch.
  const identityMismatchReasons: string[] = [];
  if (source.repository_id && target.repository_id && source.repository_id !== target.repository_id) {
    identityMismatchReasons.push(`repository identity mismatch: source snapshot is "${source.repository_id}", target snapshot is "${target.repository_id}".`);
  }
  if (source.portfolio_id && target.portfolio_id && source.portfolio_id !== target.portfolio_id) {
    identityMismatchReasons.push(`portfolio identity mismatch: source snapshot is "${source.portfolio_id}", target snapshot is "${target.portfolio_id}".`);
  }
  if (identityMismatchReasons.length > 0) {
    return { status: "incompatible", reasons: identityMismatchReasons };
  }

  // Stage 4: reduced coverage -- not every domain is present in both, but at
  // least one is (stage 1 already ruled out zero overlap).
  const coverageReasons: string[] = [];
  if (commonComplete.length < DOMAIN_ORDER.length) {
    for (const domain of DOMAIN_ORDER) {
      const sourceDigest = sourceByDomain.get(domain);
      const targetDigest = targetByDomain.get(domain);
      if (sourceDigest?.provenance === "complete" && targetDigest?.provenance !== "complete") {
        coverageReasons.push(`${domain} is present in the source snapshot but not in the target snapshot (target provenance: ${targetDigest?.provenance ?? "unavailable"}).`);
      } else if (targetDigest?.provenance === "complete" && sourceDigest?.provenance !== "complete") {
        coverageReasons.push(`${domain} is present in the target snapshot but not in the source snapshot (source provenance: ${sourceDigest?.provenance ?? "unavailable"}).`);
      }
    }
  }
  if (coverageReasons.length > 0) {
    return { status: "partial", reasons: coverageReasons };
  }

  // Stage 5: staleness -- the target snapshot's view of a domain is older
  // than the source snapshot's, suggesting the comparison direction may be
  // reversed. Never fatal: content differences between snapshots are exactly
  // what governance exists to detect.
  const stalenessReasons: string[] = [];
  for (const domain of commonComplete) {
    const sourceGeneratedAt = sourceByDomain.get(domain)!.source_generated_at;
    const targetGeneratedAt = targetByDomain.get(domain)!.source_generated_at;
    if (sourceGeneratedAt && targetGeneratedAt && targetGeneratedAt < sourceGeneratedAt) {
      stalenessReasons.push(`${domain}: target snapshot's source generated_at (${targetGeneratedAt}) is earlier than the source snapshot's (${sourceGeneratedAt}); the comparison direction may be reversed.`);
    }
  }
  if (stalenessReasons.length > 0) {
    return { status: "compatible_with_warnings", reasons: stalenessReasons };
  }

  return { status: "compatible", reasons: [] };
}
