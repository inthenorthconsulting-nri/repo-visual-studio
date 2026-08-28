import type {
  DetailMode,
  FidelityReceipt,
  MotionIntent,
  SemanticIntent,
  VisualAudience,
  VisualCommunicationSpec,
  VisualEvidenceRef,
  VisualFormat,
  VisualGraphModel,
  VisualFinding,
  VisualValidationFinding,
} from "@rvs/visual-intelligence";
import {
  audiencePolicyFor,
  buildVisualCommunicationSpec,
  normalizeIds,
  receiptIsMandatory,
  resolveAudience,
  buildFinding,
  sortFindings,
  validateVisualCommunicationSpec,
} from "@rvs/visual-intelligence";
import type { GrammarStyle, RenderResult } from "@rvs/visual-grammar";
import { renderGrammar } from "@rvs/visual-grammar";
import type { AudienceAdjustment, AudienceComposition } from "./audience-rendering.js";
import { composeAudienceModel } from "./audience-rendering.js";

// Composition: the one place a spec, an audience policy, an adapted model,
// its detail views, and a fidelity receipt are assembled into a document.
//
// Nothing here decides what may be dropped -- `@rvs/visual-intelligence` did
// that before this module was called -- and nothing here draws -- that is
// `@rvs/visual-grammar`. What this module owns is the *contract between the
// two*: that a reduction always carries a receipt, that the receipt adds up,
// that every source entity is reachable from the document that claims to
// depict it, and that a detail view is a real destination rather than a
// promise in a label.

export interface ComposeInput {
  producer: string;
  subject: string;
  semantic_intent: SemanticIntent;
  model: VisualGraphModel;
  audience: string | VisualAudience;
  detail_mode: DetailMode;
  format: VisualFormat;
  motion_intent?: MotionIntent;
  focal_entity_ids?: readonly string[];
  source_artifact_ids?: readonly string[];
  evidence_refs?: readonly VisualEvidenceRef[];
  cause_group_count?: number;
  allow_split?: boolean;
  style?: GrammarStyle;
  /**
   * Whether drawn entities become keyboard-reachable controls.
   *
   * Defaults to `format === "interactive"`, because that is what the format
   * already means. Stated explicitly only by a caller whose surface disagrees
   * with its format -- a static preview of an interactive document, say.
   * See `RenderInput.interactive`.
   */
  interactive?: boolean;
}

export interface ComposedView {
  id: string;
  role: "primary" | "detail";
  display_label: string;
  render: RenderResult;
  audience: AudienceComposition;
}

/** Where every source entity ended up. Computed from the composed document, not restated from the receipt. */
export interface EntityCoverage {
  source_entity_ids: string[];
  /** Drawn in the primary view. */
  primary_entity_ids: string[];
  /** Drawn in a detail view rather than the primary one. */
  detail_entity_ids: string[];
  /** Represented by a disclosed collapsed group. */
  collapsed_entity_ids: string[];
  /** Not drawn anywhere, and named in the receipt as such. */
  hidden_entity_ids: string[];
  /** Entities the document cannot account for. Always empty in a valid document. */
  unaccounted_entity_ids: string[];
}

export interface ComposedDocument {
  spec: VisualCommunicationSpec;
  receipt: FidelityReceipt;
  /** True when the source and rendered counts differ, i.e. when the receipt is load-bearing rather than a formality. */
  receipt_required: boolean;
  primary: ComposedView;
  details: ComposedView[];
  coverage: EntityCoverage;
  audience_adjustments: AudienceAdjustment[];
  validation: VisualValidationFinding[];
}

/**
 * Builds and renders a complete visual document: overview plus detail views.
 *
 * The detail views are rendered with the same grammar and the same style as
 * the primary one, and at full detail -- they exist because content was
 * *relocated*, not because it was demoted. A detail view drawn in a smaller
 * type or a coarser grammar would turn splitting back into shrinking, which
 * is the move this milestone forbids.
 */
export function composeVisualDocument(input: ComposeInput): ComposedDocument {
  const built = buildVisualCommunicationSpec({
    producer: input.producer,
    subject: input.subject,
    semantic_intent: input.semantic_intent,
    model: input.model,
    audience: input.audience,
    detail_mode: input.detail_mode,
    format: input.format,
    motion_intent: input.motion_intent,
    focal_entity_ids: input.focal_entity_ids,
    source_artifact_ids: input.source_artifact_ids,
    evidence_refs: input.evidence_refs,
    cause_group_count: input.cause_group_count,
    allow_split: input.allow_split,
  });

  const audience = resolveAudience(input.audience);
  const policy = audiencePolicyFor(audience);
  const focal = input.focal_entity_ids ?? [];

  const view = (
    id: string,
    role: "primary" | "detail",
    label: string,
    model: VisualGraphModel,
  ): ComposedView => {
    const composed = composeAudienceModel(model, policy, focal);
    return {
      id,
      role,
      display_label: label,
      // `id_scope: id` rather than the spec id: this function is called once
      // per view and every view lands in the same HTML document, so the
      // element ids each render mints have to be unique per view or the
      // later ones are unreachable -- including their own accessible name
      // and description.
      render: renderGrammar({
        spec: built.spec,
        model: composed.model,
        style: input.style,
        interactive: input.interactive ?? input.format === "interactive",
        id_scope: id,
      }),
      audience: composed,
    };
  };

  const primary = view(built.spec.id, "primary", "Overview", built.model);
  const details = built.splits.map((split) => view(split.id, "detail", split.label, split.model));

  // The receipt is optional on the *contract* -- a spec can be constructed by
  // hand, and the type should not pretend otherwise -- but it is mandatory on
  // any path that draws. Composition is where that becomes true: a document
  // with a reduction and no receipt is not degraded output, it is output
  // whose omissions nobody can review, so it is refused rather than rendered.
  const receipt = built.spec.fidelity_receipt;
  if (receipt === undefined) {
    throw new Error(
      `Spec "${built.spec.id}" carries no fidelity receipt; a composed document must be able to say what it did not draw.`,
    );
  }

  const criticalPaths = input.model.paths
    .filter((p) => p.critical)
    .map((p) => ({ id: p.id, node_ids: p.node_ids }));

  return {
    spec: built.spec,
    receipt,
    receipt_required: receiptIsMandatory(
      receipt.source_node_count,
      receipt.rendered_node_count,
      receipt.source_edge_count,
      receipt.rendered_edge_count,
    ),
    primary,
    details,
    coverage: computeCoverage(built.spec, receipt, primary, details),
    audience_adjustments: mergeAdjustments([primary, ...details]),
    validation: validateVisualCommunicationSpec(built.spec, { critical_paths: criticalPaths }),
  };
}

/**
 * Where each source entity actually ended up, read off the rendered
 * documents rather than trusted from the receipt.
 *
 * Checking the receipt against itself would prove nothing. This walks the
 * geometry that was really produced -- `RenderResult.boxes` -- so an entity
 * the receipt calls preserved but that no engine drew shows up as
 * unaccounted, which is exactly the discrepancy worth catching.
 */
function computeCoverage(
  spec: VisualCommunicationSpec,
  receipt: FidelityReceipt,
  primary: ComposedView,
  details: readonly ComposedView[],
): EntityCoverage {
  const source = normalizeIds(spec.source_entity_ids);
  const drawnPrimary = new Set(entitiesDrawnIn(primary));
  const drawnDetail = new Set<string>();
  for (const detail of details) {
    for (const id of entitiesDrawnIn(detail)) {
      if (!drawnPrimary.has(id)) drawnDetail.add(id);
    }
  }
  const collapsed = new Set<string>();
  for (const group of receipt.collapsed_groups) {
    for (const id of group.source_entity_ids) {
      if (!drawnPrimary.has(id) && !drawnDetail.has(id)) collapsed.add(id);
    }
  }
  const hidden = new Set(receipt.hidden_entity_ids);

  return {
    source_entity_ids: source,
    primary_entity_ids: normalizeIds([...drawnPrimary]),
    detail_entity_ids: normalizeIds([...drawnDetail]),
    collapsed_entity_ids: normalizeIds([...collapsed]),
    hidden_entity_ids: normalizeIds([...hidden]),
    unaccounted_entity_ids: source.filter(
      (id) => !drawnPrimary.has(id) && !drawnDetail.has(id) && !collapsed.has(id) && !hidden.has(id),
    ),
  };
}

/**
 * The source entities a view actually drew.
 *
 * Stand-ins are excluded. A view that replaced twelve boxes with one saying
 * "Payments (12 in a detail view)" has drawn a signpost, not the twelve, and
 * counting the signpost as coverage would let a document report a domain as
 * depicted when the reader can see only its name.
 */
function entitiesDrawnIn(view: ComposedView): string[] {
  const placeholders = new Set(
    view.audience.model.nodes.filter((n) => n.placeholder_for !== undefined).map((n) => n.id),
  );
  return view.render.boxes.filter((b) => !placeholders.has(b.node_id)).map((b) => b.source_entity_id);
}

/** One adjustment per code, with subjects merged, so a document states each policy effect once rather than once per view. */
function mergeAdjustments(views: readonly ComposedView[]): AudienceAdjustment[] {
  const byCode = new Map<string, AudienceAdjustment>();
  for (const v of views) {
    for (const adjustment of v.audience.adjustments) {
      const existing = byCode.get(adjustment.code);
      if (existing === undefined) {
        byCode.set(adjustment.code, { ...adjustment, subject_ids: [...adjustment.subject_ids] });
        continue;
      }
      existing.subject_ids = normalizeIds([...existing.subject_ids, ...adjustment.subject_ids]);
    }
  }
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Coverage validation
// ---------------------------------------------------------------------------

/**
 * The one code this package raises.
 *
 * `unaccounted_entity_ids` has been computed since composition existed, and
 * every test asserted it was empty -- but nothing turned it into a finding a
 * caller could collect alongside the rest, so a document that lost track of an
 * entity outside a test run said nothing at all. Milestone 10.6 needed to gate
 * on it, and the rule is that a gate orchestrates validators rather than
 * inventing checks, so the check moved here, where the number is produced.
 */
export type VisualCoverageCode = "VISUAL_COVERAGE_ENTITY_UNACCOUNTED";

export const VISUAL_COVERAGE_CODES: readonly VisualCoverageCode[] = ["VISUAL_COVERAGE_ENTITY_UNACCOUNTED"] as const;

export type VisualCoverageFinding = VisualFinding<VisualCoverageCode>;

/**
 * Checks that every source entity ended up somewhere nameable.
 *
 * Drawn, split into a detail view, disclosed inside a collapsed group, or
 * named in the receipt as hidden -- those are the four honest outcomes. An
 * entity in none of them was neither shown nor declared missing, which is the
 * one outcome a fidelity receipt exists to make impossible.
 */
export function validateEntityCoverage(coverage: EntityCoverage): VisualCoverageFinding[] {
  return sortFindings(
    coverage.unaccounted_entity_ids.map((entityId) =>
      buildFinding(
        "VISUAL_COVERAGE_ENTITY_UNACCOUNTED",
        entityId,
        `Entity "${entityId}" is in the spec's source set but is neither drawn, collapsed, split into a detail view, ` +
          `nor named as hidden in the fidelity receipt. The document cannot account for it.`,
        true,
      ),
    ),
  );
}
