// Top-level assembly (Milestone 11.3.3.2B, §6/§40).
//
// Two responsibilities, deliberately kept separate:
//
//   - `buildProposalArchitectureVisualReview()` -- pure data adaptation.
//     Turns one `ProposalArchitectureReviewModel` into the three-surface
//     `ProposalArchitectureVisualReview` output contract. No rendering, no
//     audience policy, no grammar selection.
//   - `composeProposalArchitectureReviewDocument()` -- the presentation
//     seam. Wraps the Observed Baseline and (when built) Projected State
//     graph surfaces through `@rvs/visual-composition`'s
//     `composeVisualDocument()`, exactly as any other graph-shaped visual
//     document is composed. The Proposed Delta surface is deliberately NOT
//     passed through `composeVisualDocument()` -- it is operation-shaped,
//     never graph-shaped, and has no grammar/audience-reduction pipeline of
//     its own in this milestone's scope (§4/§13).
//
// Both surfaces use `semantic_intent: "architecture"` -- never `"change"`.
// `"change"` would imply M10.4 observed-change semantics (`ChangeReviewModel`,
// before/after snapshots), which this milestone forbids Projected State from
// carrying even by implication (§38/§39).

import type { DetailMode, MotionIntent, VisualAudience, VisualFormat } from "@rvs/visual-intelligence";
import type { GrammarStyle } from "@rvs/visual-grammar";
import { composeVisualDocument, type ComposedDocument } from "@rvs/visual-composition";
import type { ProposalArchitectureReviewModel } from "@rvs/proposal-architecture-review";
import { buildProposalArchitectureVisualReviewId } from "./ids.js";
import { adaptObservedBaseline } from "./adapt-baseline.js";
import { adaptProjectedState } from "./adapt-projected.js";
import { buildDeltaOperationCards } from "./delta.js";
import type { ProposalArchitectureVisualReview } from "./contracts.js";

export function buildProposalArchitectureVisualReview(model: ProposalArchitectureReviewModel): ProposalArchitectureVisualReview {
  return {
    schema_version: 1,
    id: buildProposalArchitectureVisualReviewId(model.id),
    repository_id: model.repository_id,
    proposal_id: model.proposal_id,
    source_proposal_architecture_review_model_id: model.id,
    observed_baseline: { model: adaptObservedBaseline(model.observed_baseline) },
    proposed_delta: { operations: buildDeltaOperationCards(model.proposal_id, model.observed_baseline, model.proposed_delta.operations) },
    projected_state: adaptProjectedState(model.projected_state),
    truth_disclosure: model.truth_disclosure,
    baseline_binding: model.baseline_binding,
    advisory: model.advisory,
  };
}

export interface ProposalArchitectureReviewDocumentOptions {
  producer: string;
  audience: string | VisualAudience;
  detail_mode: DetailMode;
  format: VisualFormat;
  motion_intent?: MotionIntent;
  style?: GrammarStyle;
  interactive?: boolean;
}

export type ProjectedStateComposedDocument = { status: "built"; document: ComposedDocument } | { status: "not_built"; reason: string };

export interface ProposalArchitectureReviewComposedDocuments {
  observed_baseline: ComposedDocument;
  projected_state: ProjectedStateComposedDocument;
}

/**
 * Renders the two graph-shaped surfaces of an already-built
 * `ProposalArchitectureVisualReview` into composed documents, sharing the
 * caller-supplied presentation options (audience/detail mode/format/style)
 * across both -- this package makes no independent presentation-policy
 * decision that upstream review composition (`buildProposalArchitectureVisualReview`)
 * did not already establish.
 */
export function composeProposalArchitectureReviewDocument(review: ProposalArchitectureVisualReview, options: ProposalArchitectureReviewDocumentOptions): ProposalArchitectureReviewComposedDocuments {
  const observedBaseline = composeVisualDocument({
    producer: options.producer,
    subject: `${review.id}:observed-baseline`,
    semantic_intent: "architecture",
    model: review.observed_baseline.model,
    audience: options.audience,
    detail_mode: options.detail_mode,
    format: options.format,
    motion_intent: options.motion_intent,
    style: options.style,
    interactive: options.interactive,
  });

  if (review.projected_state.status === "not_built") {
    return { observed_baseline: observedBaseline, projected_state: { status: "not_built", reason: review.projected_state.reason } };
  }

  const projectedState = composeVisualDocument({
    producer: options.producer,
    subject: `${review.id}:projected-state`,
    semantic_intent: "architecture",
    model: review.projected_state.model,
    audience: options.audience,
    detail_mode: options.detail_mode,
    format: options.format,
    motion_intent: options.motion_intent,
    style: options.style,
    interactive: options.interactive,
  });

  return { observed_baseline: observedBaseline, projected_state: { status: "built", document: projectedState } };
}
