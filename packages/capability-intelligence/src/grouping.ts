import type { Capability, CapabilityDomain, CapIntelWarning } from "./contracts.js";

/** §12 guidance: 5-8 durable domains is the expected band, not a hard rule; this only flags a model that has drifted well past it. */
const OVER_GRANULAR_DOMAIN_COUNT_THRESHOLD = 8;

export interface GroupingResult {
  domains: CapabilityDomain[];
  warnings: CapIntelWarning[];
}

/**
 * Domains are assembled only from capabilities that actually reached
 * `include`/`include_with_qualification` (§12: "must not include a domain if
 * all its candidates were excluded"). roadmap_only/gap_only/exclude
 * capabilities keep the same domainId their sibling candidates would have
 * had, for a later validator-level cross-reference (a "domain with only
 * roadmap items" check needs the full model, not just this function's
 * input), but they never populate CapabilityDomain.capabilities themselves —
 * a domain's existence and shape is judged only by what actually shipped.
 *
 * `domainLabels` maps domainId -> human display label (the same domainHint
 * text every candidate sharing that domainId was assigned at discovery
 * time), so this function never has to re-derive a name from an id.
 */
export function buildCapabilityDomains(capabilities: Capability[], domainLabels: Map<string, string>): GroupingResult {
  const warnings: CapIntelWarning[] = [];
  const visible = capabilities.filter((c) => c.inclusion === "include" || c.inclusion === "include_with_qualification");

  const byDomain = new Map<string, Capability[]>();
  for (const cap of visible) {
    const bucket = byDomain.get(cap.domainId) ?? [];
    bucket.push(cap);
    byDomain.set(cap.domainId, bucket);
  }

  const orderedDomainIds = [...byDomain.keys()].sort((a, b) => a.localeCompare(b));

  const domains: CapabilityDomain[] = orderedDomainIds.map((domainId, index) => {
    const caps = [...byDomain.get(domainId)!].sort((a, b) => a.id.localeCompare(b.id));
    const operationalCapabilityCount = caps.filter((c) => c.status === "operational" || c.status === "implemented").length;
    const partialCapabilityCount = caps.filter((c) => c.inclusion === "include_with_qualification").length;
    const displayName = domainLabels.get(domainId) ?? caps[0]?.displayName ?? domainId;

    if (caps.length === 1 && operationalCapabilityCount === 0) {
      warnings.push({
        code: "CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN",
        severity: "informational",
        message: `Domain "${displayName}" would contain exactly one capability that never reached operational/implemented status; consider surfacing it as a standalone capability rather than a domain.`,
        relatedId: domainId,
        remediation: "Fold this domain's single capability into a neighboring domain, or leave it ungrouped until more evidence accumulates.",
      });
    }

    if (index >= OVER_GRANULAR_DOMAIN_COUNT_THRESHOLD) {
      warnings.push({
        code: "CAP_INTEL_OVER_GRANULAR_DOMAIN",
        severity: "informational",
        message: `Domain "${displayName}" is the ${index + 1}th domain in the model, beyond the ${OVER_GRANULAR_DOMAIN_COUNT_THRESHOLD}-domain guidance band; the capability model may be more fragmented than necessary.`,
        relatedId: domainId,
        remediation: "Consider merging closely related domains before publishing an executive-facing capability document.",
      });
    }

    return {
      id: domainId,
      displayName,
      purpose: caps[0]?.purpose ?? "",
      capabilities: caps,
      evidenceCount: caps.reduce((sum, c) => sum + c.evidence.length, 0),
      operationalCapabilityCount,
      partialCapabilityCount,
    };
  });

  return { domains, warnings };
}
