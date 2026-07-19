import type { ShowcasePlan } from "@rvs/product-intelligence";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";

// A showcase scene never embeds a ShowcaseScenePlan — it points at the
// cached ShowcasePlan by plan_id (systemIdentity.displayName, the same
// stable key convention capability-intelligence-visualdoc-builder.ts uses
// for model_id) plus scene_id, mirroring every other pointer-scene builder
// in this package. The plan's own scene order (narrative-significant, not
// alphabetical) is preserved verbatim — this builder never re-sorts it.
function planId(plan: ShowcasePlan): string {
  return plan.identity.displayName;
}

export function buildShowcaseVisualDocScenes(plan: ShowcasePlan): Scene[] {
  return plan.scenes.map((scene) => ({
    id: scene.id,
    type: "showcase-scene",
    headline: scene.headline,
    // ShowcaseScenePlan.evidenceIds reference ProductIdentityEvidence ids, a
    // separate id space from the EvidenceManifest claim ids this "evidence"
    // field expects — left empty here, matching
    // buildCapabilityIntelligenceScenes()'s identical precedent.
    evidence: [],
    plan_id: planId(plan),
    scene_id: scene.id,
  }));
}

/**
 * Produces a full showcase VisualDoc — the deterministic default sequence
 * of `rvs create slides --profile showcase`. Kept separate from
 * buildArchitectureVisualDoc()/buildVisualDoc() because a ShowcasePlan is a
 * complete, self-ordered presentation on its own (not a scene fragment
 * appended to another profile's sequence), exactly as
 * capability-intelligence's overview scene is additive while this one is not.
 */
export function buildShowcaseVisualDoc(plan: ShowcasePlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `${plan.identity.displayName} — Executive Showcase`,
      aspect_ratio: "16:9",
      audience: plan.generationMetadata.audience,
      theme: plan.generationMetadata.theme,
    },
    scenes: buildShowcaseVisualDocScenes(plan),
  };
}
