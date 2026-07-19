import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { CapabilityIntelligenceOverviewScene, Scene } from "@rvs/visualdoc-schema";

// A capability-intelligence-overview scene never embeds a CapabilityModel —
// it points at one by id, mirroring buildArchitectureIntelligenceScenes()'s
// artifact_id contract exactly. This builder is deliberately separate from
// architecture-visualdoc-builder.ts's "capability-map" scene kind: that kind
// renders ArchitectureIntelligence.capabilityDomains (a coarser, Milestone-3
// rollup with no evidence-and-maturity gate), while this builder produces
// scenes over the Milestone-4 evidence-gated CapabilityModel — the two must
// never be conflated.
//
// CapabilityModel carries no dedicated "id" field on its identity (unlike
// ArchitectureIntelligence.identity.id) — systemIdentity is only
// { displayName, purpose? } — so systemIdentity.displayName is used as the
// stable key here, matching exactly what @rvs/renderer-html's
// renderVisualDocToHtml() keys its capabilityModels map by.
function pluralize(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

// Deterministic, template-only headline built solely from counts already
// present on the model — no LLM in the default path, matching
// architecture-visualdoc-builder.ts's headlineFor() convention.
function capabilityOverviewHeadline(model: CapabilityModel): string {
  const { includedCount, qualifiedCount, gapCount } = model.evidenceSummary;
  const currentCount = includedCount + qualifiedCount;
  if (currentCount === 0) {
    return gapCount > 0 ? `No capabilities have yet cleared the evidence gate; ${gapCount} known ${pluralize(gapCount, "gap remains", "gaps remain")}` : "No capabilities have yet cleared the evidence gate";
  }
  const domainCount = model.domains.length;
  return domainCount > 0
    ? `${currentCount} evidence-gated ${pluralize(currentCount, "capability spans", "capabilities span")} ${domainCount} ${pluralize(domainCount, "domain", "domains")}`
    : `${currentCount} evidence-gated ${pluralize(currentCount, "capability", "capabilities")} confirmed`;
}

/**
 * Produces the (single, for now) capability-intelligence-overview scene for
 * a CapabilityModel. Kept as a function returning Scene[] — not a single
 * Scene — so a future split (e.g. one scene per domain once domain counts
 * grow large) can be added without changing this function's contract.
 */
export function buildCapabilityIntelligenceScenes(model: CapabilityModel): Scene[] {
  const scene: CapabilityIntelligenceOverviewScene = {
    id: "capability-intelligence-overview",
    type: "capability-intelligence-overview",
    headline: capabilityOverviewHeadline(model),
    evidence: [],
    model_id: model.systemIdentity.displayName,
  };
  return [scene];
}
