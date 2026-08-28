import type { FidelityReceipt, VisualCommunicationSpec } from "./contracts.js";
import { budgetFor } from "./budgets.js";
import { criticalPathViolations, receiptIsMandatory, validateFidelityReceipt } from "./fidelity.js";
import { buildValidationFindingId, digestOf, normalizeIds } from "./ids.js";
import { selectGrammarFromSignals } from "./grammar-selection.js";
import {
  isDetailMode,
  isMotionIntent,
  isSemanticIntent,
  isVisualGrammar,
  grammarSupportsIntent,
  motionSupportsFormat,
  motionSupportsIntent,
} from "./vocabulary.js";

// The VISUAL_* validator family.
//
// One rule governed which codes exist: every code below is raised by a
// concrete branch in `validateVisualCommunicationSpec`, and
// `VISUAL_VALIDATION_CODES` is asserted against the codes the tests can
// actually provoke. A published code that nothing can emit is a promise the
// system does not keep, so there are none here.

export type VisualValidationCode =
  | "VISUAL_INTENT_UNSUPPORTED"
  | "VISUAL_GRAMMAR_UNSUPPORTED"
  | "VISUAL_GRAMMAR_INTENT_MISMATCH"
  | "VISUAL_DETAIL_MODE_INVALID"
  | "VISUAL_MOTION_INTENT_INVALID"
  | "VISUAL_FIDELITY_RECEIPT_INVALID"
  | "VISUAL_FIDELITY_ENTITY_LOST"
  | "VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST"
  | "VISUAL_FIDELITY_CRITICAL_PATH_LOST"
  | "VISUAL_NONDETERMINISTIC_SELECTION";

export const VISUAL_VALIDATION_CODES: readonly VisualValidationCode[] = [
  "VISUAL_INTENT_UNSUPPORTED",
  "VISUAL_GRAMMAR_UNSUPPORTED",
  "VISUAL_GRAMMAR_INTENT_MISMATCH",
  "VISUAL_DETAIL_MODE_INVALID",
  "VISUAL_MOTION_INTENT_INVALID",
  "VISUAL_FIDELITY_RECEIPT_INVALID",
  "VISUAL_FIDELITY_ENTITY_LOST",
  "VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST",
  "VISUAL_FIDELITY_CRITICAL_PATH_LOST",
  "VISUAL_NONDETERMINISTIC_SELECTION",
] as const;

/** Structurally identical to `@rvs/knowledge-graph`'s `ValidationFinding`, echoed rather than imported so this package keeps zero upstream dependencies. */
export interface VisualValidationFinding {
  id: string;
  code: VisualValidationCode;
  message: string;
  subject_id: string;
  blocking: boolean;
}

/**
 * Which codes stop a build.
 *
 * Everything that means "the drawing lost information the reader needed" is
 * blocking. A vocabulary or budget mismatch is blocking too: it means the
 * spec was assembled by something that does not agree with this contract, and
 * rendering it would produce a view nobody can reason about.
 */
const BLOCKING: ReadonlySet<VisualValidationCode> = new Set<VisualValidationCode>([
  "VISUAL_INTENT_UNSUPPORTED",
  "VISUAL_GRAMMAR_UNSUPPORTED",
  "VISUAL_GRAMMAR_INTENT_MISMATCH",
  "VISUAL_DETAIL_MODE_INVALID",
  "VISUAL_MOTION_INTENT_INVALID",
  "VISUAL_FIDELITY_RECEIPT_INVALID",
  "VISUAL_FIDELITY_ENTITY_LOST",
  "VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST",
  "VISUAL_FIDELITY_CRITICAL_PATH_LOST",
  "VISUAL_NONDETERMINISTIC_SELECTION",
]);

function finding(code: VisualValidationCode, subjectId: string, message: string): VisualValidationFinding {
  return {
    id: buildValidationFindingId(code, subjectId),
    code,
    message,
    subject_id: subjectId,
    blocking: BLOCKING.has(code),
  };
}

export interface VisualValidationOptions {
  /**
   * Paths upstream marked critical, checked against the receipt. Passed in
   * rather than read off the spec because a spec carries entity ids, not the
   * graph model -- the caller that held the model is the one that knows which
   * routes mattered.
   */
  critical_paths?: ReadonlyArray<{ id: string; node_ids: readonly string[] }>;
}

/**
 * Validates one `VisualCommunicationSpec`.
 *
 * Findings are returned sorted by code then subject so two runs over the same
 * spec produce byte-identical output; nothing here throws, because a
 * validator that throws on the first problem hides the rest of them.
 */
export function validateVisualCommunicationSpec(
  spec: VisualCommunicationSpec,
  options: VisualValidationOptions = {},
): VisualValidationFinding[] {
  const findings: VisualValidationFinding[] = [];

  const intentOk = isSemanticIntent(spec.semantic_intent);
  if (!intentOk) {
    findings.push(
      finding(
        "VISUAL_INTENT_UNSUPPORTED",
        spec.id,
        `Semantic intent "${String(spec.semantic_intent)}" is not in the supported vocabulary.`,
      ),
    );
  }

  const grammarOk = isVisualGrammar(spec.visual_grammar);
  if (!grammarOk) {
    findings.push(
      finding(
        "VISUAL_GRAMMAR_UNSUPPORTED",
        spec.id,
        `Visual grammar "${String(spec.visual_grammar)}" is not in the supported vocabulary.`,
      ),
    );
  }

  if (intentOk && grammarOk && !grammarSupportsIntent(spec.semantic_intent, spec.visual_grammar)) {
    findings.push(
      finding(
        "VISUAL_GRAMMAR_INTENT_MISMATCH",
        spec.id,
        `Grammar "${spec.visual_grammar}" cannot express intent "${spec.semantic_intent}".`,
      ),
    );
  }

  if (grammarOk && spec.grammar_selection.grammar !== spec.visual_grammar) {
    // The spec's headline grammar and the grammar its own selection record
    // arrived at disagree. Whichever is right, a reviewer asking "why this
    // diagram?" would be given an answer about a different diagram.
    findings.push(
      finding(
        "VISUAL_GRAMMAR_INTENT_MISMATCH",
        spec.grammar_selection.grammar,
        `Spec declares grammar "${spec.visual_grammar}" but its selection record chose "${spec.grammar_selection.grammar}".`,
      ),
    );
  }

  const detailOk = isDetailMode(spec.detail_mode);
  if (!detailOk) {
    findings.push(
      finding(
        "VISUAL_DETAIL_MODE_INVALID",
        spec.id,
        `Detail mode "${String(spec.detail_mode)}" is not one of faithful | balanced | simplified.`,
      ),
    );
  } else if (grammarOk) {
    const budget = budgetFor(spec.visual_grammar, spec.detail_mode);
    if (
      spec.max_nodes !== budget.max_nodes ||
      spec.max_edges !== budget.max_edges ||
      spec.max_depth !== budget.max_depth
    ) {
      // A spec carrying budgets its own detail mode does not authorise is how
      // "simplified" quietly becomes "faithful, but with a smaller font".
      findings.push(
        finding(
          "VISUAL_DETAIL_MODE_INVALID",
          spec.id,
          `Detail mode "${spec.detail_mode}" for grammar "${spec.visual_grammar}" authorises ` +
            `${budget.max_nodes}/${budget.max_edges}/${budget.max_depth} (nodes/edges/depth) ` +
            `but the spec declares ${spec.max_nodes}/${spec.max_edges}/${spec.max_depth}.`,
        ),
      );
    }
  }

  if (!isMotionIntent(spec.motion_intent)) {
    findings.push(
      finding(
        "VISUAL_MOTION_INTENT_INVALID",
        spec.id,
        `Motion intent "${String(spec.motion_intent)}" is not a semantic motion intent. ` +
          `Renderer effects (fade, slide, bounce, spring, rotate) are never motion intents.`,
      ),
    );
  } else {
    if (intentOk && !motionSupportsIntent(spec.semantic_intent, spec.motion_intent)) {
      findings.push(
        finding(
          "VISUAL_MOTION_INTENT_INVALID",
          spec.id,
          `Motion intent "${spec.motion_intent}" carries no meaning for intent "${spec.semantic_intent}".`,
        ),
      );
    }
    if (!motionSupportsFormat(spec.format, spec.motion_intent)) {
      findings.push(
        finding(
          "VISUAL_MOTION_INTENT_INVALID",
          spec.format,
          `Format "${spec.format}" cannot carry motion intent "${spec.motion_intent}".`,
        ),
      );
    }
  }

  // Selection replay: the recorded signals must still produce the recorded
  // choice. This is what makes "deterministic selection" a checked property
  // rather than an assertion in a document.
  if (intentOk && grammarOk) {
    const replay = selectGrammarFromSignals(spec.grammar_selection.signals);
    if (
      replay.grammar !== spec.grammar_selection.grammar ||
      replay.reason_code !== spec.grammar_selection.reason_code ||
      digestOf(replay.alternatives) !== digestOf(spec.grammar_selection.alternatives)
    ) {
      findings.push(
        finding(
          "VISUAL_NONDETERMINISTIC_SELECTION",
          spec.id,
          `Replaying the recorded selection signals yields ${replay.grammar} (${replay.reason_code}) ` +
            `but the spec records ${spec.grammar_selection.grammar} (${spec.grammar_selection.reason_code}).`,
        ),
      );
    }
  }

  findings.push(...validateSpecFidelity(spec, options));

  return findings.sort((a, b) =>
    a.code !== b.code ? (a.code < b.code ? -1 : 1) : a.subject_id < b.subject_id ? -1 : a.subject_id > b.subject_id ? 1 : 0,
  );
}

function validateSpecFidelity(
  spec: VisualCommunicationSpec,
  options: VisualValidationOptions,
): VisualValidationFinding[] {
  const findings: VisualValidationFinding[] = [];
  const receipt: FidelityReceipt | undefined = spec.fidelity_receipt;
  const sourceIds = normalizeIds(spec.source_entity_ids);

  if (!receipt) {
    // No receipt is only acceptable when nothing was reduced -- and with no
    // receipt there is no rendered count to compare, so the only honest
    // reading of a missing receipt on a spec that has entities in scope is
    // "unproven". Specs that genuinely reduce nothing still carry a
    // FIDELITY_NO_REDUCTION receipt (see spec.ts).
    if (sourceIds.length > 0) {
      findings.push(
        finding(
          "VISUAL_FIDELITY_RECEIPT_INVALID",
          spec.id,
          `Spec covers ${sourceIds.length} source entities but carries no fidelity receipt, ` +
            `so whether anything was dropped cannot be established.`,
        ),
      );
    }
    return findings;
  }

  if (receipt.source_node_count !== sourceIds.length) {
    findings.push(
      finding(
        "VISUAL_FIDELITY_RECEIPT_INVALID",
        receipt.id,
        `Receipt covers ${receipt.source_node_count} source entities but the spec declares ${sourceIds.length}.`,
      ),
    );
  }

  for (const violation of validateFidelityReceipt(receipt, sourceIds)) {
    const code = VISUAL_VALIDATION_CODES.includes(violation.code as VisualValidationCode)
      ? (violation.code as VisualValidationCode)
      : "VISUAL_FIDELITY_RECEIPT_INVALID";
    findings.push(finding(code, violation.subject_id, violation.message));
  }

  // Focal entities are rank 1 in the degradation policy: reaching this branch
  // means something adapted away the very thing the reader asked about.
  const preserved = new Set(receipt.preserved_entity_ids);
  for (const focal of normalizeIds(spec.focal_entity_ids)) {
    if (!preserved.has(focal)) {
      findings.push(
        finding(
          "VISUAL_FIDELITY_ENTITY_LOST",
          focal,
          `Focal entity "${focal}" was not preserved; focal entities are never collapsed, split away, or hidden.`,
        ),
      );
    }
  }

  for (const violation of criticalPathViolations(receipt, options.critical_paths ?? [])) {
    findings.push(finding("VISUAL_FIDELITY_CRITICAL_PATH_LOST", violation.subject_id, violation.message));
  }

  if (
    receiptIsMandatory(
      receipt.source_node_count,
      receipt.rendered_node_count,
      receipt.source_edge_count,
      receipt.rendered_edge_count,
    ) &&
    receipt.reason_codes.length === 1 &&
    receipt.reason_codes[0] === "FIDELITY_NO_REDUCTION"
  ) {
    findings.push(
      finding(
        "VISUAL_FIDELITY_RECEIPT_INVALID",
        receipt.id,
        `Receipt claims no reduction but renders ${receipt.rendered_node_count}/${receipt.rendered_edge_count} ` +
          `of ${receipt.source_node_count}/${receipt.source_edge_count} entities/edges.`,
      ),
    );
  }

  return findings;
}

/** True when any finding blocks. Callers decide the consequence; this package never exits a process. */
export function hasBlockingVisualFindings(findings: readonly VisualValidationFinding[]): boolean {
  return findings.some((f) => f.blocking);
}
