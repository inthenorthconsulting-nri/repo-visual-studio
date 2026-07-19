import type { PortfolioPlan } from "@rvs/portfolio-intelligence";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";

// A portfolio scene never embeds a PortfolioScenePlan — it points at the
// cached PortfolioPlan by plan_id (model.portfolioId, the stable identifier
// portfolio-intelligence mints for the whole portfolio) plus scene_id,
// mirroring showcase-visualdoc-builder.ts's plan_id/scene_id contract
// exactly. The plan's own scene order (narrative-significant, not
// alphabetical — see portfolio-plan.ts's DEFAULT_SEQUENCE) is preserved
// verbatim — this builder never re-sorts it.
function planId(plan: PortfolioPlan): string {
  return plan.model.portfolioId;
}

export function buildPortfolioVisualDocScenes(plan: PortfolioPlan): Scene[] {
  return plan.scenes.map((scene) => ({
    id: scene.id,
    type: "portfolio-scene",
    headline: scene.headline,
    // PortfolioScenePlan.evidenceIds reference PortfolioEvidence ids, a
    // separate id space from the EvidenceManifest claim ids this "evidence"
    // field expects — left empty here, matching
    // buildShowcaseVisualDocScenes()'s identical precedent.
    evidence: [],
    plan_id: planId(plan),
    scene_id: scene.id,
  }));
}

/**
 * Produces a full portfolio VisualDoc — the deterministic default sequence
 * of `rvs create slides --profile portfolio`. Kept separate from
 * buildShowcaseVisualDoc()/buildArchitectureVisualDoc() because a
 * PortfolioPlan is a complete, self-ordered presentation on its own (not a
 * scene fragment appended to another profile's sequence), exactly as a
 * ShowcasePlan is.
 */
export function buildPortfolioVisualDoc(plan: PortfolioPlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `${plan.model.displayName} — Portfolio Overview`,
      aspect_ratio: "16:9",
      audience: plan.generationMetadata.audience,
      theme: plan.generationMetadata.theme,
    },
    scenes: buildPortfolioVisualDocScenes(plan),
  };
}
