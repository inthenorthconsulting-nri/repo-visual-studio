import type { CapabilityDomain, CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityConfidence, ProductIdentityEvidence, ProductValuePillar } from "./contracts.js";
import { valuePillarId } from "./ids.js";

const MIN_PILLARS = 3;
const MAX_PILLARS = 5;
const MAX_QUALIFIED_ONLY_PILLARS = 2;

interface DomainBucket {
  title: string;
  domainIds: string[];
  includedCapabilityIds: string[];
  qualifiedCapabilityIds: string[];
  purposeFragments: string[];
}

function domainToBucket(domain: CapabilityDomain): DomainBucket {
  return {
    title: domain.displayName,
    domainIds: [domain.id],
    includedCapabilityIds: domain.capabilities.filter((c) => c.inclusion === "include").map((c) => c.id),
    qualifiedCapabilityIds: domain.capabilities.filter((c) => c.inclusion === "include_with_qualification").map((c) => c.id),
    purposeFragments: domain.purpose ? [domain.purpose] : [],
  };
}

function bucketSize(b: DomainBucket): number {
  return b.includedCapabilityIds.length + b.qualifiedCapabilityIds.length;
}

function mergeBuckets(a: DomainBucket, b: DomainBucket): DomainBucket {
  return {
    title: `${a.title} & ${b.title}`,
    domainIds: [...a.domainIds, ...b.domainIds],
    includedCapabilityIds: [...a.includedCapabilityIds, ...b.includedCapabilityIds],
    qualifiedCapabilityIds: [...a.qualifiedCapabilityIds, ...b.qualifiedCapabilityIds],
    purposeFragments: [...a.purposeFragments, ...b.purposeFragments],
  };
}

/**
 * §8: 3-5 value pillars, deliberately distinct from raw capability domains
 * (a mechanical rollup) — this pass merges the smallest domains together
 * deterministically until the pillar count is within the target band, and
 * caps qualified-only pillars at 2 by folding any excess into the largest
 * pillar rather than inventing a stronger claim for them.
 */
export function buildValuePillars(model: CapabilityModel, evidence: ProductIdentityEvidence[]): ProductValuePillar[] {
  let buckets = model.domains.filter((d) => d.capabilities.length > 0).map(domainToBucket);
  buckets.sort((a, b) => a.title.localeCompare(b.title));

  while (buckets.length > MAX_PILLARS) {
    buckets.sort((a, b) => bucketSize(a) - bucketSize(b) || a.title.localeCompare(b.title));
    const [smallest, secondSmallest, ...rest] = buckets;
    if (!secondSmallest) break;
    buckets = [mergeBuckets(smallest, secondSmallest), ...rest];
  }

  const qualifiedOnly = buckets.filter((b) => b.includedCapabilityIds.length === 0 && b.qualifiedCapabilityIds.length > 0);
  if (qualifiedOnly.length > MAX_QUALIFIED_ONLY_PILLARS) {
    qualifiedOnly.sort((a, b) => a.title.localeCompare(b.title));
    const excess = qualifiedOnly.slice(MAX_QUALIFIED_ONLY_PILLARS);
    for (const bucket of excess) {
      buckets = buckets.filter((b) => b !== bucket);
      const target = buckets.filter((b) => b.includedCapabilityIds.length > 0).sort((a, b) => bucketSize(b) - bucketSize(a))[0];
      if (target) {
        const merged = mergeBuckets(target, bucket);
        buckets = buckets.map((b) => (b === target ? merged : b));
      } else {
        buckets.push(bucket);
      }
    }
  }

  const evidenceByCapabilityId = new Map<string, string[]>();
  for (const e of evidence) {
    if (e.sourceType !== "capability" || !e.sourceId) continue;
    const list = evidenceByCapabilityId.get(e.sourceId) ?? [];
    list.push(e.id);
    evidenceByCapabilityId.set(e.sourceId, list);
  }

  const pillars: ProductValuePillar[] = buckets.map((bucket) => {
    const evidenceIds = [...bucket.includedCapabilityIds, ...bucket.qualifiedCapabilityIds].flatMap((id) => evidenceByCapabilityId.get(id) ?? []).sort((a, b) => a.localeCompare(b));
    const confidence: ProductIdentityConfidence =
      bucket.includedCapabilityIds.length > 0 && bucket.qualifiedCapabilityIds.length === 0
        ? "confirmed"
        : bucket.includedCapabilityIds.length > 0
          ? "derived"
          : "suggested";
    const qualification =
      bucket.qualifiedCapabilityIds.length > 0
        ? `${bucket.qualifiedCapabilityIds.length} of ${bucket.includedCapabilityIds.length + bucket.qualifiedCapabilityIds.length} capabilities in this pillar carry evidence qualifiers and are not fully verified.`
        : undefined;

    return {
      id: valuePillarId(bucket.title),
      title: bucket.title,
      explanation: bucket.purposeFragments[0] ?? bucket.title,
      includedCapabilityIds: [...bucket.includedCapabilityIds].sort((a, b) => a.localeCompare(b)),
      qualifiedCapabilityIds: [...bucket.qualifiedCapabilityIds].sort((a, b) => a.localeCompare(b)),
      evidenceIds,
      confidence,
      qualification,
    };
  });

  pillars.sort((a, b) => a.id.localeCompare(b.id));
  return pillars;
}

export const VALUE_PILLAR_BAND = { min: MIN_PILLARS, max: MAX_PILLARS };
