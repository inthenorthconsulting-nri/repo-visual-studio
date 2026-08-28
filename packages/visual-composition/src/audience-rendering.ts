import type {
  AudiencePolicy,
  VisualAnnotation,
  VisualGraphModel,
  VisualNode,
} from "@rvs/visual-intelligence";
import { TERMINOLOGY_INVARIANTS, normalizeVisualGraphModel } from "@rvs/visual-intelligence";

// Applying an audience policy to an already-adapted model.
//
// The rule that shapes this whole file: **an audience never changes which
// entities survive**. Detail mode decides how much content there is; audience
// decides how that content is described. So every function here is
// label-and-annotation work, and `composeAudienceModel` is proved to return
// the identical node set, edge set, group set, and geometry-relevant fields
// for all six audiences over one model.
//
// It runs *after* adaptation for the same reason. If it ran before, a longer
// label under `label-and-id` could in principle influence a downstream
// decision, and "who is reading this" would have quietly become an input to
// "what is true enough to show".

/** What an audience policy changed, so a composed document can say so rather than merely look different. */
export interface AudienceAdjustment {
  code:
    | "AUDIENCE_ID_DRAWN_WITH_LABEL"
    | "AUDIENCE_ANNOTATIONS_REDUCED"
    | "AUDIENCE_EVIDENCE_SUMMARISED"
    | "AUDIENCE_EVIDENCE_NOT_DRAWN";
  detail: string;
  /** Entities affected, sorted. Empty when the adjustment is view-wide. */
  subject_ids: string[];
}

export interface AudienceComposition {
  model: VisualGraphModel;
  policy: AudiencePolicy;
  adjustments: AudienceAdjustment[];
  /** A caption the renderer may draw, or undefined when the policy draws no evidence line. */
  evidence_caption?: string;
}

/**
 * A node's label as this audience should read it.
 *
 * Only `label-and-id` changes anything. The other two exposures already have
 * what they need: the stable id is on every rendered node as a data
 * attribute, so tooling and the interactive inspector can reach it without
 * it being drawn on top of the diagram for a reader who will never type it.
 */
function labelFor(node: VisualNode, policy: AudiencePolicy): string {
  if (policy.identifier_exposure !== "label-and-id") return node.label;
  if (node.label === node.source_entity_id) return node.label;
  return `${node.label} (${node.source_entity_id})`;
}

/**
 * Which annotations this audience sees.
 *
 * An annotation is explanatory text, not an entity, so reducing them is not
 * a fidelity reduction and produces no receipt entry -- but it is still
 * disclosed, as an `AudienceAdjustment`, because a reader comparing two
 * exports of the same view deserves to know why one has more words on it.
 *
 * `minimal` keeps annotations on focal entities only: an executive summary
 * that dropped the note explaining the thing the summary is *about* would be
 * shorter and worse. `moderate` additionally keeps annotations that carry
 * evidence, since those are the ones a reader is most likely to follow up.
 */
function annotationsFor(
  model: VisualGraphModel,
  policy: AudiencePolicy,
  focalIds: ReadonlySet<string>,
): VisualAnnotation[] {
  if (policy.annotation_depth === "full") return [...model.annotations];
  return model.annotations.filter((a) => {
    if (a.target_id !== undefined && focalIds.has(a.target_id)) return true;
    if (policy.annotation_depth === "moderate") return a.evidence_refs.length > 0;
    return false;
  });
}

/**
 * The evidence line, if the policy draws one.
 *
 * `cited` draws nothing here: per-entity citations are already the existing
 * deck footer's job, and duplicating them into the diagram would be noise.
 * `summarised` draws a count. `carried-not-drawn` draws nothing, and the refs
 * stay in the model, reachable by the inspector -- carried, as the name says,
 * not discarded.
 */
function evidenceCaption(model: VisualGraphModel, policy: AudiencePolicy): string | undefined {
  if (policy.evidence_visibility !== "summarised") return undefined;
  const entities = model.nodes.filter((n) => n.evidence_refs.length > 0).length;
  const refs = model.nodes.reduce((sum, n) => sum + n.evidence_refs.length, 0);
  if (refs === 0) return undefined;
  return `${refs} evidence reference${refs === 1 ? "" : "s"} across ${entities} element${entities === 1 ? "" : "s"}`;
}

/**
 * Rewrites an adapted model for one audience.
 *
 * `TERMINOLOGY_INVARIANTS` names the fields this function must not touch:
 * governance severity, decision status, resolution, and confidence are owned
 * upstream. A view written for executives may describe a component in
 * business terms; it may not describe a `blocking` finding as "a note". Those
 * fields are carried through by spread and never rewritten, and a test reads
 * the invariant list to assert it.
 */
export function composeAudienceModel(
  model: VisualGraphModel,
  policy: AudiencePolicy,
  focalEntityIds: readonly string[] = [],
): AudienceComposition {
  const focal = new Set(focalEntityIds);
  const adjustments: AudienceAdjustment[] = [];

  const nodes = model.nodes.map((node) => ({ ...node, label: labelFor(node, policy) }));
  const relabelled = nodes.filter((n, i) => n.label !== model.nodes[i].label).map((n) => n.id);
  if (relabelled.length > 0) {
    adjustments.push({
      code: "AUDIENCE_ID_DRAWN_WITH_LABEL",
      detail: `Stable ids are drawn alongside labels for the ${policy.audience} audience.`,
      subject_ids: [...relabelled].sort(),
    });
  }

  const annotations = annotationsFor(model, policy, focal);
  if (annotations.length !== model.annotations.length) {
    const kept = new Set(annotations.map((a) => a.id));
    adjustments.push({
      code: "AUDIENCE_ANNOTATIONS_REDUCED",
      detail: `${model.annotations.length - annotations.length} explanatory annotation(s) not drawn at "${policy.annotation_depth}" depth. No entity was removed.`,
      subject_ids: model.annotations.filter((a) => !kept.has(a.id)).map((a) => a.id).sort(),
    });
  }

  const caption = evidenceCaption(model, policy);
  if (caption !== undefined) {
    adjustments.push({
      code: "AUDIENCE_EVIDENCE_SUMMARISED",
      detail: caption,
      subject_ids: [],
    });
  } else if (policy.evidence_visibility === "carried-not-drawn") {
    adjustments.push({
      code: "AUDIENCE_EVIDENCE_NOT_DRAWN",
      detail: "Evidence references are carried in the spec and reachable by the inspector, but not drawn.",
      subject_ids: [],
    });
  }

  return {
    // Re-normalised so a composed model is canonically ordered whatever this
    // function did to it, and so composition can never be the thing that
    // makes two identical views serialise differently.
    model: normalizeVisualGraphModel({ ...model, nodes, annotations }),
    policy,
    adjustments: adjustments.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    evidence_caption: caption,
  };
}

/** The upstream-owned fields an audience policy may never restate. Re-exported so a caller can assert against the same list. */
export { TERMINOLOGY_INVARIANTS };
