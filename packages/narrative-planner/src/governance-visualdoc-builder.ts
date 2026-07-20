import type { GovernancePlan } from "@rvs/governance-intelligence";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";

// A governance scene never embeds a GovernanceSceneContent — it points at
// the cached GovernancePlan by plan_id (plan.id, the stable
// governance:plan:<report-id> key governance-intelligence mints for the
// whole comparison) plus scene_id, mirroring
// portfolio-visualdoc-builder.ts's plan_id/scene_id contract exactly. The
// plan's own scene order (already sorted by the canonical
// GovernanceSceneKind sequence — see governance-plan.ts's SCENE_KIND_ORDER)
// is preserved verbatim — this builder never re-sorts it.
function planId(plan: GovernancePlan): string {
  return plan.id;
}

export function buildGovernanceVisualDocScenes(plan: GovernancePlan): Scene[] {
  return plan.scenes.map((scene) => ({
    id: scene.scene_id,
    type: "governance-scene",
    headline: scene.title,
    // GovernanceSceneContent.evidence_refs reference EvidenceRef paths, a
    // separate shape from the EvidenceManifest claim ids this "evidence"
    // field expects — left empty here, matching
    // buildPortfolioVisualDocScenes()'s identical precedent.
    evidence: [],
    plan_id: planId(plan),
    scene_id: scene.scene_id,
  }));
}

/**
 * Produces a full governance VisualDoc — the deterministic default sequence
 * of `rvs create slides --profile governance`. Kept separate from
 * buildPortfolioVisualDoc()/buildShowcaseVisualDoc() because a
 * GovernancePlan is a complete, self-ordered presentation on its own (not a
 * scene fragment appended to another profile's sequence), exactly as a
 * PortfolioPlan is.
 *
 * Deviation from the portfolio precedent: GovernancePlan carries no
 * generationMetadata.audience/theme fields (unlike PortfolioPlan's
 * generationMetadata) — governance-intelligence's GovernanceGenerationMetadata
 * is deliberately minimal (just generated_at). Audience/theme are therefore
 * fixed constants here rather than sourced from the plan.
 */
export function buildGovernanceVisualDoc(plan: GovernancePlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `Architecture Governance: ${plan.report.source_snapshot_id} -> ${plan.report.target_snapshot_id}`,
      aspect_ratio: "16:9",
      audience: "governance",
      theme: "technical-grid",
    },
    scenes: buildGovernanceVisualDocScenes(plan),
  };
}
