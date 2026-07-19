import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { Capability, CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductDifferentiator, ProductDifferentiatorBasis, ProductIdentityConfidence, ProductIdentityEvidence } from "./contracts.js";
import { differentiatorId } from "./ids.js";

const MULTI_CAPABILITY_THRESHOLD = 3;
const MAX_DIFFERENTIATORS = 6;

function componentLabel(componentId: string, arch: ArchitectureIntelligence): string {
  return arch.components.find((c) => c.id === componentId)?.label.displayLabel ?? componentId;
}

/**
 * §9: differentiators describe structural properties, never marketing
 * adjectives — each one must satisfy at least one of the four criteria
 * below, and every candidate must trace back to real capability/component
 * structure and evidence rather than an assertion.
 */
export function buildDifferentiators(model: CapabilityModel, arch: ArchitectureIntelligence, evidence: ProductIdentityEvidence[]): ProductDifferentiator[] {
  const included = model.includedCapabilities;
  const evidenceByCapabilityId = new Map<string, string[]>();
  for (const e of evidence) {
    if (e.sourceType !== "capability" || !e.sourceId) continue;
    const list = evidenceByCapabilityId.get(e.sourceId) ?? [];
    list.push(e.id);
    evidenceByCapabilityId.set(e.sourceId, list);
  }

  const candidates: ProductDifferentiator[] = [];

  // Criterion 1 + 2: shared logical components (multi-capability support / cross-cutting).
  const componentToCapabilities = new Map<string, Capability[]>();
  for (const cap of included) {
    for (const componentIdRef of cap.logicalComponents) {
      const list = componentToCapabilities.get(componentIdRef) ?? [];
      list.push(cap);
      componentToCapabilities.set(componentIdRef, list);
    }
  }
  for (const [componentIdRef, caps] of componentToCapabilities) {
    const distinctDomains = new Set(caps.map((c) => c.domainId));
    const basis: ProductDifferentiatorBasis[] = [];
    if (caps.length >= MULTI_CAPABILITY_THRESHOLD) basis.push("multi_capability_support");
    if (distinctDomains.size >= 2) basis.push("cross_cutting_property");
    if (basis.length === 0) continue;

    const label = componentLabel(componentIdRef, arch);
    candidates.push({
      id: differentiatorId(label),
      title: `Shared ${label.toLowerCase()} across the platform`,
      description: `${label} is used by ${caps.length} capabilities spanning ${distinctDomains.size} capability ${distinctDomains.size === 1 ? "domain" : "domains"}, rather than being duplicated per feature.`,
      basis,
      supportingCapabilityIds: caps.map((c) => c.id).sort((a, b) => a.localeCompare(b)),
      evidenceIds: caps.flatMap((c) => evidenceByCapabilityId.get(c.id) ?? []).sort((a, b) => a.localeCompare(b)),
      confidence: distinctDomains.size >= 2 ? "confirmed" : "derived",
    });
  }

  // Criteria 3 + 4: capability-level verification / operational distinction.
  for (const cap of included) {
    const evidenceTypes = new Set(cap.evidence.map((e) => e.type));
    const basis: ProductDifferentiatorBasis[] = [];
    if (evidenceTypes.has("test") && (evidenceTypes.has("deployment") || evidenceTypes.has("workflow"))) basis.push("test_or_deployment_verified");
    if (cap.status === "operational" && cap.readiness.score >= 85) basis.push("operational_distinction");
    if (basis.length === 0) continue;

    candidates.push({
      id: differentiatorId(cap.displayName),
      title: `${cap.displayName} is verified in operation`,
      description: `${cap.displayName} is backed by ${[...evidenceTypes].sort().join(", ")} evidence, not implementation alone.`,
      basis,
      supportingCapabilityIds: [cap.id],
      evidenceIds: evidenceByCapabilityId.get(cap.id) ?? [],
      confidence: cap.confidence,
    });
  }

  candidates.sort((a, b) => scoreDifferentiator(b) - scoreDifferentiator(a) || a.id.localeCompare(b.id));
  const deduped: ProductDifferentiator[] = [];
  const seenIds = new Set<string>();
  for (const c of candidates) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    deduped.push(c);
    if (deduped.length >= MAX_DIFFERENTIATORS) break;
  }
  deduped.sort((a, b) => a.id.localeCompare(b.id));
  return deduped;
}

function scoreDifferentiator(d: ProductDifferentiator): number {
  const confidenceWeight: Record<ProductIdentityConfidence, number> = { confirmed: 3, derived: 2, suggested: 1, unresolved: 0 };
  return d.basis.length * 10 + confidenceWeight[d.confidence] + d.supportingCapabilityIds.length;
}
