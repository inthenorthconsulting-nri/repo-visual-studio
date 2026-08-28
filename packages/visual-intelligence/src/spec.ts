import type {
  DetailMode,
  MotionIntent,
  SemanticIntent,
  VisualAudience,
  VisualCommunicationSpec,
  VisualEvidenceRef,
  VisualFormat,
} from "./contracts.js";
import { VISUAL_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { budgetFor } from "./budgets.js";
import { resolveAudience } from "./audience.js";
import { adaptVisualModel, type AdaptedView } from "./degradation.js";
import { normalizeVisualGraphModel, type VisualGraphModel } from "./data-model.js";
import { selectVisualGrammar } from "./grammar-selection.js";
import { buildSpecId, digestOf, normalizeIds } from "./ids.js";
import { INTENT_MOTION_COMPATIBILITY, motionSupportsFormat } from "./vocabulary.js";

// Spec construction: the single doorway from an upstream-derived
// VisualGraphModel to a renderable VisualCommunicationSpec.
//
// The order of operations is fixed and matters:
//
//   resolve audience -> select grammar -> derive budget -> adapt -> receipt
//
// Grammar is chosen before adaptation because a grammar's budget is what
// adaptation adapts *to*; adapting first and choosing a grammar afterwards
// would mean the reduction was decided by a diagram type nobody had picked
// yet.

export interface BuildSpecInput {
  /** Which RVS surface is producing this spec, e.g. "scene-mapping". */
  producer: string;
  /** A stable subject id for the view (a scene id, a node id, a plan id). Never an array index. */
  subject: string;
  semantic_intent: SemanticIntent;
  model: VisualGraphModel;
  /** An RVS audience/profile id, or a `VisualAudience` directly; mapped by `resolveAudience`. */
  audience: string | VisualAudience;
  detail_mode: DetailMode;
  format: VisualFormat;
  /** Omit to get the intent's default motion for the format. Never inferred from audience. */
  motion_intent?: MotionIntent;
  focal_entity_ids?: readonly string[];
  source_artifact_ids?: readonly string[];
  evidence_refs?: readonly VisualEvidenceRef[];
  /** Cause groups established by an upstream root-cause analysis. Never inferred here. */
  cause_group_count?: number;
  allow_split?: boolean;
}

export interface BuildSpecResult {
  spec: VisualCommunicationSpec;
  /** The adapted primary model a grammar renderer draws. */
  model: VisualGraphModel;
  /** Detail views produced by the split-before-shrink rule. */
  splits: AdaptedView[];
}

/**
 * The default motion for an intent in a format.
 *
 * Static is the default everywhere. Motion is only ever *offered* by an
 * interactive format, and even then only the first motion the intent's
 * compatibility list names -- because a view that animates by default is a
 * view whose meaning depends on the reader having watched it.
 */
export function defaultMotionIntent(intent: SemanticIntent, format: VisualFormat): MotionIntent {
  if (format !== "interactive") return "none";
  const compatible = INTENT_MOTION_COMPATIBILITY[intent].filter(
    (motion) => motion !== "none" && motionSupportsFormat(format, motion),
  );
  return compatible[0] ?? "none";
}

/**
 * Builds a spec, adapts the model to the selected grammar's budget, and
 * attaches the fidelity receipt.
 *
 * A receipt is attached unconditionally, including when nothing was reduced
 * (`FIDELITY_NO_REDUCTION`). Making the receipt present only on the
 * interesting path would mean "no receipt" is ambiguous between "nothing was
 * lost" and "nobody checked", and only one of those is safe to render.
 */
export function buildVisualCommunicationSpec(input: BuildSpecInput): BuildSpecResult {
  const model = normalizeVisualGraphModel(input.model);
  const audience = resolveAudience(typeof input.audience === "string" ? input.audience : undefined);
  const focal = normalizeIds(input.focal_entity_ids ?? []);
  const sourceEntityIds = normalizeIds(model.nodes.map((n) => n.source_entity_id));

  const selection = selectVisualGrammar({
    intent: input.semantic_intent,
    model,
    audience,
    detail_mode: input.detail_mode,
    format: input.format,
    cause_group_count: input.cause_group_count,
  });
  const budget = budgetFor(selection.grammar, input.detail_mode);
  const motion = input.motion_intent ?? defaultMotionIntent(input.semantic_intent, input.format);

  // The digest covers everything the spec is a pure function of, and nothing
  // else -- no clock, no producer version, no host path. Two runs over the
  // same evidence therefore produce the same spec id.
  const inputDigest = digestOf({
    intent: input.semantic_intent,
    grammar: selection.grammar,
    detail_mode: input.detail_mode,
    audience,
    format: input.format,
    motion,
    source_entity_ids: sourceEntityIds,
    focal_entity_ids: focal,
    signals: selection.signals,
  });
  const specId = buildSpecId(input.producer, input.subject, inputDigest);

  const adapted = adaptVisualModel({
    spec_id: specId,
    model,
    grammar: selection.grammar,
    detail_mode: input.detail_mode,
    focal_entity_ids: focal,
    allow_split: input.allow_split,
  });

  const spec: VisualCommunicationSpec = {
    id: specId,
    schema_version: VISUAL_INTELLIGENCE_SCHEMA_VERSION,
    semantic_intent: input.semantic_intent,
    visual_grammar: selection.grammar,
    grammar_selection: selection,
    detail_mode: input.detail_mode,
    motion_intent: motion,
    audience,
    format: input.format,
    source_entity_ids: sourceEntityIds,
    focal_entity_ids: focal,
    max_nodes: budget.max_nodes,
    max_edges: budget.max_edges,
    max_depth: budget.max_depth,
    evidence_refs: [...(input.evidence_refs ?? [])],
    fidelity_receipt: adapted.receipt,
    generation_metadata: {
      schema_version: VISUAL_INTELLIGENCE_SCHEMA_VERSION,
      producer: input.producer,
      source_artifact_ids: normalizeIds(input.source_artifact_ids ?? []),
      input_digest: inputDigest,
    },
  };

  return { spec, model: adapted.model, splits: adapted.splits };
}
