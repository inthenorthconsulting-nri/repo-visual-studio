import type {
  DetailMode,
  MotionIntent,
  SemanticIntent,
  VisualAudience,
  VisualFormat,
  VisualGrammar,
} from "./contracts.js";

// The canonical ordering of every controlled vocabulary. Order is part of the
// contract: `alternatives` lists, validator messages, and documentation
// tables all derive from these arrays, so a reordering would change output
// bytes and is therefore a deliberate, reviewable act.

export const SEMANTIC_INTENTS: readonly SemanticIntent[] = [
  "architecture",
  "dependency",
  "sequence",
  "causality",
  "hierarchy",
  "containment",
  "ownership",
  "lifecycle",
  "comparison",
  "distribution",
  "flow",
  "policy",
  "trust_boundary",
  "impact",
  "change",
  "root_cause",
  "maturity",
] as const;

export const VISUAL_GRAMMARS: readonly VisualGrammar[] = [
  "architecture",
  "dependency_graph",
  "sequence",
  "swimlane",
  "data_flow",
  "tree",
  "nested",
  "layer_stack",
  "timeline",
  "matrix",
  "metric_row",
  "fishbone",
  "state_machine",
  "process",
  "delta",
] as const;

export const DETAIL_MODES: readonly DetailMode[] = ["faithful", "balanced", "simplified"] as const;

export const MOTION_INTENTS: readonly MotionIntent[] = [
  "none",
  "reveal",
  "trace",
  "step",
  "compare",
  "impact",
] as const;

export const VISUAL_AUDIENCES: readonly VisualAudience[] = [
  "executive",
  "product",
  "architecture-review",
  "engineering",
  "operations",
  "mixed",
] as const;

export const VISUAL_FORMATS: readonly VisualFormat[] = ["slide", "interactive", "document", "export"] as const;

/**
 * Which grammars can honestly express which intent.
 *
 * This is deliberately a *many-to-many* relation, not a lookup table. The
 * whole point of separating SemanticIntent from VisualGrammar is that
 * `policy` may legitimately render as a `process`, a `layer_stack`, or a
 * `matrix` depending on what the evidence actually looks like -- so this
 * matrix bounds the choice, and grammar-selection.ts makes it from evidence.
 *
 * Order within each list is the tie-break preference used when two grammars
 * score identically; it is never used on its own to pick a grammar.
 */
export const INTENT_GRAMMAR_COMPATIBILITY: Readonly<Record<SemanticIntent, readonly VisualGrammar[]>> = {
  architecture: ["architecture", "layer_stack", "nested", "dependency_graph"],
  dependency: ["dependency_graph", "architecture", "tree"],
  sequence: ["sequence", "swimlane", "process"],
  causality: ["process", "dependency_graph", "fishbone"],
  hierarchy: ["tree", "nested", "layer_stack"],
  containment: ["nested", "tree", "architecture"],
  ownership: ["matrix", "tree", "nested"],
  lifecycle: ["state_machine", "timeline", "process"],
  comparison: ["matrix", "delta", "metric_row"],
  distribution: ["metric_row", "matrix"],
  flow: ["data_flow", "sequence", "process"],
  policy: ["process", "layer_stack", "matrix"],
  trust_boundary: ["nested", "architecture", "layer_stack"],
  impact: ["dependency_graph", "tree", "architecture"],
  change: ["delta", "timeline", "matrix"],
  root_cause: ["fishbone", "dependency_graph", "tree"],
  maturity: ["matrix", "metric_row", "state_machine"],
} as const;

/**
 * Which motion intents can honestly express which semantic intent.
 *
 * `none` is universally allowed (and is always the default). Every other
 * pairing has to be justifiable as "the movement teaches the reader
 * something the static view does not" -- `trace` over a `dependency`
 * intent follows a real route; `trace` over a `distribution` intent would be
 * decoration, so it is not permitted.
 */
export const INTENT_MOTION_COMPATIBILITY: Readonly<Record<SemanticIntent, readonly MotionIntent[]>> = {
  architecture: ["none", "reveal"],
  dependency: ["none", "reveal", "trace", "impact"],
  sequence: ["none", "reveal", "step", "trace"],
  causality: ["none", "reveal", "step", "trace"],
  hierarchy: ["none", "reveal"],
  containment: ["none", "reveal"],
  ownership: ["none", "reveal"],
  lifecycle: ["none", "reveal", "step", "compare"],
  comparison: ["none", "reveal", "compare"],
  distribution: ["none", "reveal"],
  flow: ["none", "reveal", "step", "trace"],
  policy: ["none", "reveal", "step"],
  trust_boundary: ["none", "reveal"],
  impact: ["none", "reveal", "impact", "trace"],
  change: ["none", "reveal", "compare"],
  root_cause: ["none", "reveal", "trace"],
  maturity: ["none", "reveal"],
} as const;

/**
 * Which motion intents a format can carry at all.
 *
 * A `document` or `export` (PDF) target cannot animate, so anything other
 * than `none` there is a contract error rather than a silently-ignored
 * field. `slide` supports finite, one-shot motion; `interactive` supports
 * the full set because the reader drives it.
 */
export const FORMAT_MOTION_COMPATIBILITY: Readonly<Record<VisualFormat, readonly MotionIntent[]>> = {
  slide: ["none", "reveal", "step", "compare", "trace"],
  interactive: ["none", "reveal", "trace", "step", "compare", "impact"],
  document: ["none"],
  export: ["none"],
} as const;

export function isSemanticIntent(value: unknown): value is SemanticIntent {
  return typeof value === "string" && (SEMANTIC_INTENTS as readonly string[]).includes(value);
}

export function isVisualGrammar(value: unknown): value is VisualGrammar {
  return typeof value === "string" && (VISUAL_GRAMMARS as readonly string[]).includes(value);
}

export function isDetailMode(value: unknown): value is DetailMode {
  return typeof value === "string" && (DETAIL_MODES as readonly string[]).includes(value);
}

export function isMotionIntent(value: unknown): value is MotionIntent {
  return typeof value === "string" && (MOTION_INTENTS as readonly string[]).includes(value);
}

export function isVisualAudience(value: unknown): value is VisualAudience {
  return typeof value === "string" && (VISUAL_AUDIENCES as readonly string[]).includes(value);
}

export function isVisualFormat(value: unknown): value is VisualFormat {
  return typeof value === "string" && (VISUAL_FORMATS as readonly string[]).includes(value);
}

export function grammarSupportsIntent(intent: SemanticIntent, grammar: VisualGrammar): boolean {
  return INTENT_GRAMMAR_COMPATIBILITY[intent].includes(grammar);
}

export function motionSupportsIntent(intent: SemanticIntent, motion: MotionIntent): boolean {
  return INTENT_MOTION_COMPATIBILITY[intent].includes(motion);
}

export function motionSupportsFormat(format: VisualFormat, motion: MotionIntent): boolean {
  return FORMAT_MOTION_COMPATIBILITY[format].includes(motion);
}
