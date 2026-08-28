import type {
  DetailMode,
  GrammarSelection,
  GrammarSelectionSignals,
  SemanticIntent,
  VisualAudience,
  VisualFormat,
  VisualGrammar,
} from "./contracts.js";
import { budgetFor } from "./budgets.js";
import { normalizeVisualGraphModel, type VisualGraphModel } from "./data-model.js";
import { INTENT_GRAMMAR_COMPATIBILITY } from "./vocabulary.js";

// Deterministic grammar selection.
//
// Given a semantic intent and a feature vector describing the evidence, pick
// the visual grammar that expresses it most honestly -- with a stable reason
// code and the compatible alternatives, so a reviewer can ask "why a
// fishbone?" and get an answer without re-running anything.
//
// Three properties are non-negotiable:
//
//  * No external model, no LLM classification, no text-similarity heuristic.
//    Every signal below is a count or a boolean that upstream intelligence
//    already established.
//  * No repository-specific knowledge. There is no catalogue of "if the
//    component is called X, draw Y" anywhere in this file, and there must
//    never be one.
//  * Pure function of (intent, signals). Same inputs -> same grammar, same
//    reason code, same alternatives, byte for byte.

/** A single deterministic selection rule. `weight` is the rule's contribution to its grammar's score, and doubles as the reason-code precedence when one grammar matches several rules. */
interface SelectionRule {
  grammar: VisualGrammar;
  code: string;
  weight: number;
  when: (s: GrammarSelectionSignals, budget: { max_nodes: number; max_groups?: number }) => boolean;
}

/**
 * The rule table, in declaration order (which is the final tie-break after
 * score and compatibility order, so it is part of the contract).
 *
 * Weights are coarse bands rather than fine-grained numbers so the table
 * stays readable and so a new rule slots into an existing band rather than
 * requiring every other weight to be re-tuned:
 *
 *   100  the evidence is definitionally this grammar (change facts -> delta)
 *    80  a strong structural signal (lanes, timeline positions, containment)
 *    60  a general structural signal (directed edges, component topology)
 *    20  a weak preference
 */
const RULES: readonly SelectionRule[] = [
  // --- 100: definitional -------------------------------------------------
  {
    grammar: "delta",
    code: "VISUAL_GRAMMAR_CHANGE_FACTS_PRESENT",
    weight: 100,
    when: (s) => s.has_change_facts,
  },
  {
    grammar: "fishbone",
    code: "VISUAL_GRAMMAR_ROOT_CAUSE_GROUPED_CAUSES",
    weight: 100,
    // A fishbone is honest only for "many grouped causes converge on one
    // effect". Two or more groups, and no more groups than a readable spine
    // holds -- above that the same facts render as a dependency graph, which
    // degrades gracefully where a fishbone does not.
    when: (s, b) => s.cause_group_count >= 2 && s.cause_group_count <= (b.max_groups ?? 0),
  },
  // --- 80-90: strong structural signals ----------------------------------
  {
    grammar: "metric_row",
    code: "VISUAL_GRAMMAR_QUANTITATIVE_NO_RELATIONSHIPS",
    weight: 90,
    when: (s, b) => s.has_quantitative && s.edge_count === 0 && s.node_count <= b.max_nodes,
  },
  {
    grammar: "timeline",
    code: "VISUAL_GRAMMAR_TIMELINE_POSITIONS_PRESENT",
    weight: 90,
    when: (s) => s.has_timeline,
  },
  {
    grammar: "swimlane",
    code: "VISUAL_GRAMMAR_LANES_PRESENT",
    weight: 90,
    when: (s) => s.lane_count >= 2,
  },
  {
    grammar: "data_flow",
    code: "VISUAL_GRAMMAR_DATA_FLOW_EDGES",
    weight: 85,
    when: (s) => s.edge_kinds.some((k) => DATA_FLOW_EDGE_KINDS.has(k)),
  },
  {
    grammar: "nested",
    code: "VISUAL_GRAMMAR_CONTAINMENT_DEPTH",
    weight: 85,
    when: (s) => s.containment_depth >= 2,
  },
  {
    grammar: "tree",
    code: "VISUAL_GRAMMAR_SINGLE_PARENT_ACYCLIC",
    weight: 85,
    // Exactly n-1 edges over n acyclic nodes is a forest/tree by definition,
    // so a tree layout loses nothing -- unlike a general graph, where a tree
    // layout would have to drop or duplicate edges.
    when: (s) => s.acyclic && s.node_count > 1 && s.edge_count === s.node_count - 1,
  },
  {
    grammar: "sequence",
    code: "VISUAL_GRAMMAR_ORDERED_STAGES_NO_LANES",
    weight: 80,
    when: (s) => s.stage_count >= 2 && s.lane_count < 2,
  },
  {
    grammar: "matrix",
    code: "VISUAL_GRAMMAR_QUANTITATIVE_TWO_DIMENSIONS",
    weight: 80,
    when: (s) => s.has_quantitative && s.node_kinds.length >= 2 && s.edge_count === 0,
  },
  {
    grammar: "dependency_graph",
    code: "VISUAL_GRAMMAR_CYCLES_REQUIRE_GRAPH",
    weight: 80,
    // A cycle cannot be drawn in a tree, a layer stack, or a nested box
    // without either hiding an edge or duplicating a node. Both are
    // information loss the reader cannot see, so a cycle forces a graph.
    when: (s) => s.has_cycles,
  },
  // --- 60-70: general structural signals ---------------------------------
  {
    grammar: "process",
    code: "VISUAL_GRAMMAR_ORDERED_STAGES",
    weight: 70,
    when: (s) => s.stage_count >= 2,
  },
  {
    grammar: "state_machine",
    code: "VISUAL_GRAMMAR_CYCLIC_STATUS_TRANSITIONS",
    weight: 70,
    when: (s) => s.has_cycles && s.stage_count === 0,
  },
  {
    grammar: "architecture",
    code: "VISUAL_GRAMMAR_COMPONENT_TOPOLOGY",
    weight: 65,
    when: (s) => s.has_boundaries || s.node_kinds.some((k) => STRUCTURAL_NODE_KINDS.has(k)),
  },
  {
    grammar: "dependency_graph",
    code: "VISUAL_GRAMMAR_DIRECTED_RELATIONSHIPS",
    weight: 60,
    when: (s) => s.edge_count > 0,
  },
  {
    grammar: "layer_stack",
    code: "VISUAL_GRAMMAR_SPARSE_ORDERED_CONTAINMENT",
    weight: 60,
    when: (s) => s.containment_depth >= 1 && s.edge_count * 2 <= s.node_count,
  },
  {
    grammar: "matrix",
    code: "VISUAL_GRAMMAR_RELATIONLESS_MULTI_KIND",
    weight: 60,
    when: (s) => s.edge_count === 0 && s.node_kinds.length >= 2,
  },
];

/**
 * Edge kinds that mean "something moves from A to B" rather than "A refers to
 * B". Drawn from @rvs/knowledge-graph's own `KnowledgeEdgeType` union --
 * echoed here as strings so this package keeps zero upstream imports, and
 * deliberately narrow, since a data-flow drawing implies a runtime claim.
 */
const DATA_FLOW_EDGE_KINDS = new Set(["produces", "consumes", "invokes", "exposes"]);

/**
 * Node kinds that denote a deployable/structural unit, i.e. the things an
 * architecture diagram is *of*. Also echoed from `KnowledgeNodeType`; generic
 * architectural vocabulary, never a repository's own component names.
 */
const STRUCTURAL_NODE_KINDS = new Set([
  "component",
  "package",
  "repository",
  "runtime_entrypoint",
  "product",
]);

export interface GrammarSelectionInput {
  intent: SemanticIntent;
  model: VisualGraphModel;
  audience: VisualAudience;
  detail_mode: DetailMode;
  format: VisualFormat;
  /** Number of distinct cause groups converging on one effect, when an upstream root-cause analysis established them. Never inferred from the model. */
  cause_group_count?: number;
}

/**
 * Derives the deterministic feature vector from an already-normalized model.
 *
 * Every field is a count or a boolean over facts the model carries. Nothing
 * here reads a label, and nothing here decides a relationship exists that the
 * model does not already contain: `has_cycles` and `containment_depth` are
 * copied from the model (where an upstream traversal established them), not
 * recomputed from the edge list, so this layer cannot invent a cycle the
 * Knowledge Graph never found.
 */
export function deriveSelectionSignals(input: GrammarSelectionInput): GrammarSelectionSignals {
  const model = normalizeVisualGraphModel(input.model);
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const acyclic =
    !model.has_cycles &&
    model.edges.every((e) => nodeIds.has(e.from_id) && nodeIds.has(e.to_id) && !e.in_cycle);
  return {
    intent: input.intent,
    node_count: model.nodes.length,
    edge_count: model.edges.length,
    node_kinds: Array.from(new Set(model.nodes.map((n) => n.kind))).sort(),
    edge_kinds: Array.from(new Set(model.edges.map((e) => e.kind))).sort(),
    acyclic,
    has_cycles: model.has_cycles,
    lane_count: model.lanes.length,
    stage_count: model.stages.length,
    has_timeline: model.nodes.some((n) => n.order !== undefined) && model.stages.length === 0,
    has_quantitative: model.metrics.length > 0 || model.nodes.some((n) => n.measure !== undefined),
    has_change_facts: model.changes.length > 0,
    cause_group_count: input.cause_group_count ?? 0,
    containment_depth: model.containment_depth,
    has_boundaries: model.boundaries.length > 0,
    audience: input.audience,
    detail_mode: input.detail_mode,
    format: input.format,
  };
}

/**
 * Picks a grammar for an intent and its evidence.
 *
 * Scoring: every rule whose `when` holds contributes its weight to that
 * grammar's score, but only for grammars the intent's compatibility list
 * permits -- so `has_change_facts` cannot drag a `hierarchy` view into a
 * `delta`, because `delta` is not compatible with `hierarchy`. The winner is
 * the highest score, ties broken by the intent's compatibility order (the
 * documented preference), then by rule declaration order.
 *
 * When no rule matches, the first compatible grammar wins with
 * `VISUAL_GRAMMAR_INTENT_DEFAULT` -- an honest "the evidence carried no
 * distinguishing signal", not a silent guess.
 */
export function selectVisualGrammar(input: GrammarSelectionInput): GrammarSelection {
  return selectGrammarFromSignals(deriveSelectionSignals(input));
}

/**
 * The selector proper: a pure function of the recorded signal vector.
 *
 * Split out from `selectVisualGrammar` so the validator can replay a spec's
 * own recorded signals and confirm they still produce the grammar the spec
 * claims. Without a replayable entry point, `VISUAL_NONDETERMINISTIC_SELECTION`
 * would be a code nothing could ever raise.
 */
export function selectGrammarFromSignals(signals: GrammarSelectionSignals): GrammarSelection {
  const compatible = INTENT_GRAMMAR_COMPATIBILITY[signals.intent];

  const scores = new Map<VisualGrammar, { score: number; code: string; codeWeight: number }>();
  for (const grammar of compatible) {
    scores.set(grammar, { score: 0, code: "VISUAL_GRAMMAR_INTENT_DEFAULT", codeWeight: -1 });
  }

  for (const rule of RULES) {
    const current = scores.get(rule.grammar);
    if (!current) continue; // not compatible with this intent
    const budget = budgetFor(rule.grammar, signals.detail_mode);
    if (!rule.when(signals, budget)) continue;
    current.score += rule.weight;
    if (rule.weight > current.codeWeight) {
      current.code = rule.code;
      current.codeWeight = rule.weight;
    }
  }

  const ranked = compatible
    .map((grammar, preferenceIndex) => ({ grammar, preferenceIndex, ...scores.get(grammar)! }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.preferenceIndex - b.preferenceIndex));

  const winner = ranked[0];
  return {
    grammar: winner.grammar,
    reason_code: winner.code,
    alternatives: ranked.slice(1).map((r) => r.grammar),
    signals,
  };
}

/** Every reason code this selector can emit, so docs and tests can assert the set is closed and every published code is reachable. */
export function selectionReasonCodes(): string[] {
  return Array.from(new Set(["VISUAL_GRAMMAR_INTENT_DEFAULT", ...RULES.map((r) => r.code)])).sort();
}
