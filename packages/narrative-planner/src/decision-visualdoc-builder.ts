import type { DecisionPlan } from "@rvs/decision-intelligence";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";

// A decision scene never embeds a DecisionSceneContent — it points at the
// cached DecisionPlan by plan_id (plan.id, the stable
// decision:plan:<snapshot-id> key decision-intelligence mints for the whole
// snapshot) plus scene_id, mirroring
// governance-visualdoc-builder.ts's plan_id/scene_id contract exactly. The
// plan's own scene order (already sorted by the canonical
// DecisionSceneKind sequence — see decision-plan.ts's SCENE_KIND_ORDER) is
// preserved verbatim — this builder never re-sorts it.
function planId(plan: DecisionPlan): string {
  return plan.id;
}

export function buildDecisionVisualDocScenes(plan: DecisionPlan): Scene[] {
  return plan.scenes.map((scene) => ({
    id: scene.scene_id,
    type: "decision-scene",
    headline: scene.title,
    // DecisionSceneContent.evidence_refs reference EvidenceRef paths, a
    // separate shape from the EvidenceManifest claim ids this "evidence"
    // field expects — left empty here, matching
    // buildGovernanceVisualDocScenes()'s identical precedent.
    evidence: [],
    plan_id: planId(plan),
    scene_id: scene.scene_id,
  }));
}

/**
 * Produces a full decision VisualDoc — the deterministic default sequence
 * of `rvs create slides --profile decisions`. Kept separate from the other
 * profile builders because a DecisionPlan is a complete, self-ordered
 * presentation on its own (not a scene fragment appended to another
 * profile's sequence), exactly as a GovernancePlan is.
 *
 * Deviation from the governance precedent: DecisionPlan carries no `report`
 * field (and no notion of a comparison target — decision-plan.ts is
 * snapshot-scoped only, unlike GovernancePlan's source/target comparison),
 * so the title is sourced from `plan.source_snapshot_id` alone. Audience/
 * theme are fixed constants, matching buildGovernanceVisualDoc()'s
 * identical precedent (DecisionPlan carries no generationMetadata either).
 */
export function buildDecisionVisualDoc(plan: DecisionPlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `Architecture Decisions: ${plan.source_snapshot_id}`,
      aspect_ratio: "16:9",
      audience: "decisions",
      theme: "technical-grid",
    },
    scenes: buildDecisionVisualDocScenes(plan),
  };
}
