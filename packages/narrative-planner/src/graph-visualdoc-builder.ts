import type { KnowledgeGraphPlan } from "@rvs/knowledge-graph";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";

// A knowledge-graph scene never embeds a KnowledgeGraphSceneContent — it
// points at the cached KnowledgeGraphPlan by plan_id (plan.id, the stable
// graph:plan:<snapshot-id> key knowledge-graph mints for the whole
// snapshot) plus scene_id, mirroring
// decision-visualdoc-builder.ts's plan_id/scene_id contract exactly. The
// plan's own scene order (already sorted by the canonical
// KnowledgeGraphSceneKind sequence — see graph-plan.ts's SCENE_KIND_ORDER)
// is preserved verbatim — this builder never re-sorts it.
function planId(plan: KnowledgeGraphPlan): string {
  return plan.id;
}

export function buildKnowledgeGraphVisualDocScenes(plan: KnowledgeGraphPlan): Scene[] {
  return plan.scenes.map((scene) => ({
    id: scene.scene_id,
    type: "knowledge-graph-scene",
    headline: scene.title,
    // KnowledgeGraphSceneContent.evidence_refs reference EvidenceRef paths, a
    // separate shape from the EvidenceManifest claim ids this "evidence"
    // field expects — left empty here, matching
    // buildDecisionVisualDocScenes()'s identical precedent.
    evidence: [],
    plan_id: planId(plan),
    scene_id: scene.scene_id,
  }));
}

/**
 * Produces a full knowledge-graph VisualDoc — the deterministic default
 * sequence of `rvs create slides --profile knowledge-graph`. Kept separate
 * from the other profile builders because a KnowledgeGraphPlan is a
 * complete, self-ordered presentation on its own (not a scene fragment
 * appended to another profile's sequence), exactly as a DecisionPlan is.
 *
 * Deviation from the decision precedent: KnowledgeGraphPlan carries no
 * `report` field (and no notion of a comparison target — graph-plan.ts is
 * snapshot-scoped only, unlike GovernancePlan's source/target comparison),
 * so the title is sourced from `plan.source_snapshot_id` alone. Audience/
 * theme are fixed constants, matching buildDecisionVisualDoc()'s identical
 * precedent (KnowledgeGraphPlan carries no generationMetadata either).
 */
export function buildKnowledgeGraphVisualDoc(plan: KnowledgeGraphPlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `Architecture Knowledge Graph: ${plan.source_snapshot_id}`,
      aspect_ratio: "16:9",
      audience: "knowledge-graph",
      theme: "technical-grid",
    },
    scenes: buildKnowledgeGraphVisualDocScenes(plan),
  };
}
