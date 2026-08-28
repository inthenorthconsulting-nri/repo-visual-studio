import type { FidelityReceipt } from "@rvs/visual-intelligence";
import type {
  ChangeReviewFinding,
  ChangeReviewModel,
  ChangeReviewSeverity,
  ChangeReviewValidationCode,
  ReviewChange,
} from "./contracts.js";
import { REVIEW_CHANGE_TYPES } from "./contracts.js";
import { buildReviewFindingId } from "./ids.js";

// Validation for the change review.
//
// Twelve codes, and the rule they were written under: every one of them is
// reachable from an input a caller can actually produce, and every one is
// covered by a test that produces it. A predeclared code that no input can
// reach is a promise of a check that does not exist -- worse than no check,
// because a reviewer counts on it.
//
// What validation does *not* do: it never repairs. A dangling change stays in
// the model and gets a finding; a missing counterpart stays missing and gets a
// finding. Silently mending an input would mean the page shows something the
// upstream artifacts do not say.

/** Change types that only make sense if the entity existed in the baseline. */
const NEEDS_BEFORE = new Set<string>(["removed", "modified", "rerouted", "regressed", "qualified"]);

/** Change types that only make sense if the entity exists in the target. */
const NEEDS_AFTER = new Set<string>(["added", "modified", "rerouted", "regressed", "qualified", "resolved"]);

export interface ChangeReviewValidationInput {
  model: ChangeReviewModel;
  /** Everything the baseline snapshot contained: entity ids and relationship ids. */
  before_ids: readonly string[];
  /** Everything the target snapshot contained: entity ids and relationship ids. */
  after_ids: readonly string[];
  /**
   * Entity ids actually drawn in the composed document, placeholders excluded.
   * Supplied after composition; omitted when validating a model on its own.
   */
  rendered_entity_ids?: readonly string[];
  /** Change entries whose upstream type this package has no member for. */
  unsupported_change_types?: readonly { id: string; type: string }[];
  /** Change ids that arrived more than once. */
  duplicate_change_ids?: readonly string[];
}

function finding(
  code: ChangeReviewValidationCode,
  severity: ChangeReviewSeverity,
  subjectId: string,
  message: string,
): ChangeReviewFinding {
  return { id: buildReviewFindingId(code, subjectId), code, severity, subject_id: subjectId, message };
}

function lostFidelity(receipt: FidelityReceipt): boolean {
  return (
    receipt.collapsed_groups.length > 0 ||
    receipt.hidden_entity_ids.length > 0 ||
    receipt.truncation.truncated
  );
}

/** True when a change stands for a real entity rather than for a route or a group. */
function isRealChange(change: ReviewChange, known: ReadonlySet<string>): boolean {
  return known.has(change.entity_id);
}

function isSorted(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i += 1) if (ids[i - 1] >= ids[i]) return false;
  return true;
}

/**
 * Validates one assembled review.
 *
 * Deterministic: findings sort by id, and every id is a digest of its code and
 * subject rather than of its position in this function.
 */
export function validateChangeReview(input: ChangeReviewValidationInput): ChangeReviewFinding[] {
  const { model } = input;
  const findings: ChangeReviewFinding[] = [];

  const beforeIds = new Set(input.before_ids);
  const afterIds = new Set(input.after_ids);
  const known = new Set([...beforeIds, ...afterIds]);

  // ---- the two snapshots ------------------------------------------------
  if (model.before_entity_ids.length === 0) {
    findings.push(
      finding(
        "CHANGE_REVIEW_BASELINE_MISSING",
        "error",
        model.from_snapshot_id,
        `Baseline snapshot ${model.from_snapshot_id} contains no entities. Nothing can be compared against it, so this review cannot state what existed before.`,
      ),
    );
  }
  if (model.after_entity_ids.length === 0) {
    findings.push(
      finding(
        "CHANGE_REVIEW_TARGET_MISSING",
        "error",
        model.to_snapshot_id,
        `Target snapshot ${model.to_snapshot_id} contains no entities. Nothing can be compared to it, so this review cannot state what exists after.`,
      ),
    );
  }
  if (model.compatibility.status === "incompatible") {
    findings.push(
      finding(
        "CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS",
        "error",
        `${model.from_snapshot_id}..${model.to_snapshot_id}`,
        `Upstream assessed these snapshots as incompatible${
          model.compatibility.reasons.length === 0 ? "" : `: ${model.compatibility.reasons.join("; ")}`
        }. A change review over incompatible snapshots would attribute differences to changes that are really differences in how the two snapshots were built.`,
      ),
    );
  }

  // ---- each change ------------------------------------------------------
  const findingIds = new Set(model.governance_findings.map((f) => f.id));
  const decisionIds = new Set(model.decision_impacts.map((d) => d.decision_entity_id));

  for (const change of model.changes) {
    if (!(REVIEW_CHANGE_TYPES as readonly string[]).includes(change.change_type)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE",
          "error",
          change.id,
          `Change ${change.id} carries change type "${change.change_type}", which is not one of the eight reviewable change types. It is shown as-is rather than mapped onto a neighbouring type.`,
        ),
      );
    }

    if (!known.has(change.entity_id)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_DANGLING_CHANGE",
          "error",
          change.id,
          `Change ${change.id} names entity ${change.entity_id}, which is present in neither snapshot. It cannot be placed on either panel.`,
        ),
      );
      continue;
    }

    if (change.before_entity_id !== undefined && !beforeIds.has(change.before_entity_id)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_BEFORE_ENTITY_MISSING",
          "error",
          change.id,
          `Change ${change.id} declares before counterpart ${change.before_entity_id}, which the baseline snapshot does not contain.`,
        ),
      );
    } else if (NEEDS_BEFORE.has(change.change_type) && !beforeIds.has(change.entity_id)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_BEFORE_ENTITY_MISSING",
          "warning",
          change.id,
          `Change ${change.id} is a "${change.change_type}" change, which describes something that existed in the baseline, but ${change.entity_id} is absent from the baseline snapshot.`,
        ),
      );
    }

    if (change.after_entity_id !== undefined && !afterIds.has(change.after_entity_id)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_AFTER_ENTITY_MISSING",
          "error",
          change.id,
          `Change ${change.id} declares after counterpart ${change.after_entity_id}, which the target snapshot does not contain.`,
        ),
      );
    } else if (NEEDS_AFTER.has(change.change_type) && !afterIds.has(change.entity_id)) {
      findings.push(
        finding(
          "CHANGE_REVIEW_AFTER_ENTITY_MISSING",
          "warning",
          change.id,
          `Change ${change.id} is a "${change.change_type}" change, which describes something that survives into the target, but ${change.entity_id} is absent from the target snapshot.`,
        ),
      );
    }

    for (const id of change.governance_finding_ids) {
      if (findingIds.has(id)) continue;
      findings.push(
        finding(
          "CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING",
          "error",
          `${change.id}:${id}`,
          `Change ${change.id} references governance finding ${id}, which this review was not given. Its severity is unknown here and is not guessed.`,
        ),
      );
    }
    for (const id of change.decision_ids) {
      if (decisionIds.has(id)) continue;
      findings.push(
        finding(
          "CHANGE_REVIEW_DECISION_REFERENCE_MISSING",
          "error",
          `${change.id}:${id}`,
          `Change ${change.id} references decision ${id}, which this review was not given. Its state is unknown here and is not guessed.`,
        ),
      );
    }
  }

  // ---- determinism ------------------------------------------------------
  for (const id of input.duplicate_change_ids ?? []) {
    findings.push(
      finding(
        "CHANGE_REVIEW_NONDETERMINISTIC_ORDER",
        "error",
        id,
        `More than one change claims id ${id}. Which one survives would depend on input order, so the review is not reproducible.`,
      ),
    );
  }
  const changeIds = model.changes.map((c) => c.id);
  if (!isSorted(changeIds)) {
    findings.push(
      finding(
        "CHANGE_REVIEW_NONDETERMINISTIC_ORDER",
        "error",
        model.id,
        "Changes are not in ascending id order, so the rendered review depends on the order its inputs arrived in.",
      ),
    );
  }
  for (const [label, ids] of [
    ["before_entity_ids", model.before_entity_ids],
    ["after_entity_ids", model.after_entity_ids],
    ["review_required_ids", model.review_required_ids],
  ] as const) {
    if (isSorted(ids)) continue;
    findings.push(
      finding(
        "CHANGE_REVIEW_NONDETERMINISTIC_ORDER",
        "error",
        `${model.id}:${label}`,
        `${label} is not in ascending order, so the rendered review depends on the order its inputs arrived in.`,
      ),
    );
  }

  for (const entry of input.unsupported_change_types ?? []) {
    findings.push(
      finding(
        "CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE",
        "warning",
        entry.id,
        `Upstream change ${entry.id} has type "${entry.type}", which has no member in the review vocabulary. It is reported rather than mapped onto a neighbouring type, because the nearest member would say something upstream did not.`,
      ),
    );
  }

  // ---- what adaptation cost --------------------------------------------
  if (lostFidelity(model.fidelity_receipt)) {
    findings.push(
      finding(
        "CHANGE_REVIEW_FIDELITY_LOSS",
        "info",
        model.fidelity_receipt.id,
        `Adaptation reduced this review: ${model.fidelity_receipt.rendered_node_count} of ${model.fidelity_receipt.source_node_count} entities are drawn. The fidelity receipt records what was collapsed, split, or hidden.`,
      ),
    );
  }

  // ---- the anchor floor, checked against what was actually drawn --------
  //
  // The failure this exists for: a simplified review that renders eight
  // collapsed stand-ins and not one real changed entity. It is technically a
  // faithful summary and it is useless -- a reviewer cannot see a single thing
  // that changed. Counting stand-ins as coverage is exactly how that ships
  // unnoticed, so this counts only real entities.
  if (input.rendered_entity_ids !== undefined) {
    const rendered = new Set(input.rendered_entity_ids);
    const realChanges = model.changes.filter((c) => isRealChange(c, known));
    const renderedReal = realChanges.filter((c) => rendered.has(c.entity_id));
    if (realChanges.length > 0 && renderedReal.length === 0) {
      findings.push(
        finding(
          "CHANGE_REVIEW_REAL_ANCHOR_LOST",
          "error",
          model.id,
          `The rendered review contains no real changed entity, while the source contains ${realChanges.length}. A reader cannot see anything that changed.`,
        ),
      );
    }
  }

  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
