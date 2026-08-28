import type {
  CollapsedGroup,
  FidelityReasonCode,
  FidelityReceipt,
  SplitView,
} from "./contracts.js";
import { VISUAL_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildFidelityReceiptId, digestOf, normalizeIds } from "./ids.js";

// The fidelity receipt: the audit trail that makes visual simplification
// reviewable instead of merely convenient.
//
// The rule Milestone 10 is built around is that a simplifier must never turn
// 27 source nodes into 8 displayed nodes without saying, entity by entity,
// where the other 19 went. `buildFidelityReceipt` constructs that statement
// and `validateFidelityReceipt` proves it adds up -- so a receipt is not a
// narrative a renderer writes about itself, it is a checkable claim.

export interface FidelityReceiptInput {
  spec_id: string;
  /** Every source entity id in scope before adaptation. */
  source_entity_ids: readonly string[];
  /** Every source edge id in scope before adaptation. */
  source_edge_ids: readonly string[];
  /** Entity ids drawn in the primary view after adaptation. */
  rendered_entity_ids: readonly string[];
  /** Edge ids drawn in the primary view after adaptation. */
  rendered_edge_ids: readonly string[];
  collapsed_groups: readonly CollapsedGroup[];
  hidden_entity_ids: readonly string[];
  preserved_paths: readonly string[];
  preserved_findings: readonly string[];
  preserved_decisions: readonly string[];
  preserved_unresolved_entities: readonly string[];
  split_views: readonly SplitView[];
  truncated: boolean;
  limits_hit: readonly FidelityReasonCode[];
  reason_codes: readonly FidelityReasonCode[];
}

export function buildFidelityReceipt(input: FidelityReceiptInput): FidelityReceipt {
  const sourceEntityIds = normalizeIds(input.source_entity_ids);
  const sourceEdgeIds = normalizeIds(input.source_edge_ids);
  const renderedEntityIds = normalizeIds(input.rendered_entity_ids);
  const renderedEdgeIds = normalizeIds(input.rendered_edge_ids);

  // Digests cover the id *sets*, not the arrays, so a caller shuffling its
  // input cannot change a digest -- the determinism proof depends on this.
  const sourceDigest = digestOf({ entities: sourceEntityIds, edges: sourceEdgeIds });
  const renderedDigest = digestOf({ entities: renderedEntityIds, edges: renderedEdgeIds });

  const reasonCodes = normalizeIds(input.reason_codes) as FidelityReasonCode[];
  return {
    id: buildFidelityReceiptId(input.spec_id, sourceDigest, renderedDigest),
    schema_version: VISUAL_INTELLIGENCE_SCHEMA_VERSION,
    source_node_count: sourceEntityIds.length,
    rendered_node_count: renderedEntityIds.length,
    source_edge_count: sourceEdgeIds.length,
    rendered_edge_count: renderedEdgeIds.length,
    preserved_entity_ids: renderedEntityIds,
    collapsed_groups: [...input.collapsed_groups]
      .map((group) => ({ ...group, source_entity_ids: normalizeIds(group.source_entity_ids) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    hidden_entity_ids: normalizeIds(input.hidden_entity_ids),
    preserved_paths: normalizeIds(input.preserved_paths),
    preserved_findings: normalizeIds(input.preserved_findings),
    preserved_decisions: normalizeIds(input.preserved_decisions),
    preserved_unresolved_entities: normalizeIds(input.preserved_unresolved_entities),
    truncation: {
      truncated: input.truncated,
      limits_hit: normalizeIds(input.limits_hit) as FidelityReasonCode[],
    },
    split_views: [...input.split_views]
      .map((view) => ({ ...view, entity_ids: normalizeIds(view.entity_ids) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    reason_codes: reasonCodes.length > 0 ? reasonCodes : ["FIDELITY_NO_REDUCTION"],
    source_digest: sourceDigest,
    rendered_digest: renderedDigest,
  };
}

/** A structural problem with a receipt. `code` values are the `VISUAL_FIDELITY_*` validator family; see validation.ts. */
export interface FidelityViolation {
  code: string;
  message: string;
  subject_id: string;
}

/**
 * Proves a receipt accounts for every source entity exactly once.
 *
 * The three destinations -- preserved, collapsed-into-a-group, hidden -- must
 * partition the source set: their union is every source entity, and they are
 * pairwise disjoint. An entity in none of them vanished silently (the exact
 * failure this contract exists to prevent); an entity in two of them means
 * the receipt is telling two different stories about the same entity.
 *
 * An entity that appears only in a split view is, correctly, `collapsed` in
 * the primary view's receipt: the primary view genuinely does not draw it,
 * and the split view discloses where it went.
 */
export function validateFidelityReceipt(
  receipt: FidelityReceipt,
  sourceEntityIds: readonly string[],
): FidelityViolation[] {
  const violations: FidelityViolation[] = [];
  const source = new Set(normalizeIds(sourceEntityIds));

  const collapsedMembers: string[] = [];
  for (const group of receipt.collapsed_groups) collapsedMembers.push(...group.source_entity_ids);

  const buckets: Array<[string, readonly string[]]> = [
    ["preserved", receipt.preserved_entity_ids],
    ["collapsed", collapsedMembers],
    ["hidden", receipt.hidden_entity_ids],
  ];

  const seen = new Map<string, string>();
  for (const [bucket, ids] of buckets) {
    for (const id of ids) {
      const previous = seen.get(id);
      if (previous !== undefined) {
        violations.push({
          code: "VISUAL_FIDELITY_RECEIPT_INVALID",
          message: `Entity "${id}" is reported as both ${previous} and ${bucket}; a receipt must account for each entity exactly once.`,
          subject_id: id,
        });
        continue;
      }
      seen.set(id, bucket);
      if (!source.has(id)) {
        violations.push({
          code: "VISUAL_FIDELITY_RECEIPT_INVALID",
          message: `Entity "${id}" is reported as ${bucket} but is not in the source entity set.`,
          subject_id: id,
        });
      }
    }
  }

  for (const id of source) {
    if (!seen.has(id)) {
      violations.push({
        code: "VISUAL_FIDELITY_ENTITY_LOST",
        message: `Source entity "${id}" is neither preserved, collapsed, nor hidden — it left the view without disclosure.`,
        subject_id: id,
      });
    }
  }

  if (receipt.source_node_count !== source.size) {
    violations.push({
      code: "VISUAL_FIDELITY_RECEIPT_INVALID",
      message: `Receipt reports ${receipt.source_node_count} source nodes but ${source.size} were supplied.`,
      subject_id: receipt.id,
    });
  }
  if (receipt.rendered_node_count !== receipt.preserved_entity_ids.length) {
    violations.push({
      code: "VISUAL_FIDELITY_RECEIPT_INVALID",
      message: `Receipt reports ${receipt.rendered_node_count} rendered nodes but lists ${receipt.preserved_entity_ids.length} preserved entities.`,
      subject_id: receipt.id,
    });
  }

  // An unresolved entity is never allowed to be *hidden*: the reader must be
  // able to see that the picture is incomplete. Collapsing one into a
  // disclosed group is permitted; deleting it from the story is not.
  const hidden = new Set(receipt.hidden_entity_ids);
  for (const id of receipt.preserved_unresolved_entities) {
    if (hidden.has(id)) {
      violations.push({
        code: "VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST",
        message: `Unresolved entity "${id}" is listed as preserved-unresolved but also as hidden.`,
        subject_id: id,
      });
    }
  }

  return violations;
}

/**
 * Confirms every node of every critical path survived into the primary view.
 *
 * Used by adaptation and by the validator's `VISUAL_FIDELITY_CRITICAL_PATH_LOST`
 * check: a path that upstream marked critical (the primary request route, the
 * route a change-review is about) must be intact end to end, or the drawing
 * is telling the reader a route exists that it cannot show them.
 */
export function criticalPathViolations(
  receipt: FidelityReceipt,
  criticalPaths: ReadonlyArray<{ id: string; node_ids: readonly string[] }>,
): FidelityViolation[] {
  const preserved = new Set(receipt.preserved_entity_ids);
  const violations: FidelityViolation[] = [];
  for (const path of criticalPaths) {
    const lost = path.node_ids.filter((id) => !preserved.has(id)).sort();
    if (lost.length > 0) {
      violations.push({
        code: "VISUAL_FIDELITY_CRITICAL_PATH_LOST",
        message: `Critical path "${path.id}" lost ${lost.length} node(s) during adaptation: ${lost.join(", ")}.`,
        subject_id: path.id,
      });
    }
  }
  return violations;
}

/** True when the view drew fewer entities or edges than it was given -- the condition that makes a receipt mandatory (Milestone 10.27). */
export function receiptIsMandatory(
  sourceEntityCount: number,
  renderedEntityCount: number,
  sourceEdgeCount: number,
  renderedEdgeCount: number,
): boolean {
  return renderedEntityCount !== sourceEntityCount || renderedEdgeCount !== sourceEdgeCount;
}
