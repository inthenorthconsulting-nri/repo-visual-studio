// Public types for @rvs/visual-intelligence -- Milestone 10.0's
// renderer-neutral visual communication layer.
//
// Layering rule this package exists to enforce:
//
//   Intelligence owns truth.
//   Visual Intelligence owns communication semantics.
//   Layout engines own geometry.
//   Renderers own concrete output.
//
// Consequences, all of which are load-bearing for the rest of Milestone 10:
//
//  * Nothing here imports an upstream intelligence package
//    (@rvs/knowledge-graph, @rvs/governance-intelligence,
//    @rvs/decision-intelligence, @rvs/architecture-intelligence, ...).
//    Upstream artifacts reach this layer only after an adapter has already
//    reduced them to the presentation structures below, exactly as
//    @rvs/knowledge-graph consumes its own six upstream artifacts
//    structurally rather than by import.
//  * Nothing here imports @rvs/visualdoc-schema either. A VisualDoc scene
//    reaches scene-mapping.ts through the structural `MappableScene` shape,
//    so VisualDoc stays the document model and this stays the communication
//    model -- neither becomes a second source of truth for the other.
//  * Nothing here touches the DOM, a browser, Playwright, HTML, or SVG.
//    tsconfig.json drops "DOM" from `lib` so that is a compiler error rather
//    than a review convention.
//
// Everything below is a pure data contract plus the deterministic functions
// that build and check it. No wall-clock time, no randomness, no iteration
// order dependence.

export const VISUAL_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// SemanticIntent -- what the reader is being asked to understand
// ---------------------------------------------------------------------------

/**
 * The controlled vocabulary describing *what relationship or concept* a view
 * communicates. It never describes layout, never names a diagram type, and
 * never names a repository-specific subject.
 *
 * Each member below was selected by auditing content RVS already produces
 * (see docs/visual-intelligence.md "Vocabulary audit"); none is speculative:
 *
 *  architecture     system-context / logical-architecture / Terraform topology
 *  dependency       Knowledge Graph dependency paths, relationship landscape
 *  sequence         GitHub Actions workflow order, architecture-flow
 *  causality        governance chain: change -> regression -> contradiction
 *  hierarchy        capability domains, repository map
 *  containment      Terraform module nesting, package containment
 *  ownership        portfolio ownership, operating model
 *  lifecycle        decision status transitions, supersession
 *  comparison       portfolio product comparison, snapshot comparison
 *  distribution     entity landscape counts, metric scenes, evidence spread
 *  flow             data flow across a boundary, request path
 *  policy           governance policy evaluation, review-required routing
 *  trust_boundary   boundary-map, security/trust zone crossings
 *  impact           blast radius, component/capability impact
 *  change           graph change sets, governance changes
 *  root_cause       shared-ancestor root-cause grouping
 *  maturity         capability status, evidence confidence
 */
export type SemanticIntent =
  | "architecture"
  | "dependency"
  | "sequence"
  | "causality"
  | "hierarchy"
  | "containment"
  | "ownership"
  | "lifecycle"
  | "comparison"
  | "distribution"
  | "flow"
  | "policy"
  | "trust_boundary"
  | "impact"
  | "change"
  | "root_cause"
  | "maturity";

// ---------------------------------------------------------------------------
// VisualGrammar -- how the information is drawn, independent of renderer
// ---------------------------------------------------------------------------

/**
 * The controlled vocabulary of renderer-neutral diagram forms.
 *
 * Deliberately kept small. This is not a catalogue of every diagram type that
 * exists -- it is the set that maps onto evidence RVS actually holds. A
 * grammar is added when a real RVS evidence shape needs it, never because a
 * design reference happens to contain it.
 *
 * `metric_row` is the one member outside the "graph-ish diagram" family: RVS
 * has shipped labelled-value metric scenes since Milestone 1, and describing
 * them as a degenerate single-row `matrix` would have been a worse lie than
 * naming the form they actually are.
 */
export type VisualGrammar =
  | "architecture"
  | "dependency_graph"
  | "sequence"
  | "swimlane"
  | "data_flow"
  | "tree"
  | "nested"
  | "layer_stack"
  | "timeline"
  | "matrix"
  | "metric_row"
  | "fishbone"
  | "state_machine"
  | "process"
  | "delta";

// ---------------------------------------------------------------------------
// DetailMode -- how much is preserved, independent of who is reading
// ---------------------------------------------------------------------------

/**
 * How much of the source entity set survives into the rendered view.
 *
 *  faithful    every relevant entity, within the grammar's safety limits
 *  balanced    structural meaning preserved, low-value detail clustered
 *  simplified  only the semantic story needed for comprehension
 *
 * DetailMode is orthogonal to `VisualAudience`. There is deliberately no
 * `executive => simplified` or `engineer => faithful` rule anywhere in this
 * package: an executive reviewing an outage wants faithful detail, and an
 * engineer orienting on an unfamiliar system wants a simplified map.
 */
export type DetailMode = "faithful" | "balanced" | "simplified";

// ---------------------------------------------------------------------------
// VisualAudience -- who is reading, independent of how much is shown
// ---------------------------------------------------------------------------

/**
 * A small generic reader vocabulary. It controls terminology, annotation
 * depth, evidence visibility, explanatory labelling, and whether technical
 * identifiers are exposed -- never entity count, grouping, or edge density
 * (that is DetailMode's job).
 *
 * These are generic reader classes, not RVS profile ids: `resolveAudience()`
 * in audience.ts maps the existing `rvs create slides --audience`/`--profile`
 * vocabulary onto them so no repository-specific catalogue is hard-coded
 * into the contract itself.
 */
export type VisualAudience =
  | "executive"
  | "product"
  | "architecture-review"
  | "engineering"
  | "operations"
  | "mixed";

// ---------------------------------------------------------------------------
// MotionIntent -- what motion is for, never how it is implemented
// ---------------------------------------------------------------------------

/**
 * Semantic motion intent. Every member answers "what does the reader learn
 * from the movement?" -- never "what does the movement look like".
 *
 *  none     static output (the default for every format)
 *  reveal   disclose a view's parts in a meaning-bearing order
 *  trace    follow one evidence-backed route end to end
 *  step     advance through ordered stages (workflow, process)
 *  compare  before -> delta -> after
 *  impact   progressively disclose downstream reach by depth
 *
 * `fade`, `slide-left`, `bounce`, `spring`, and `rotate` are renderer
 * effects. They are not members here and must never become members.
 */
export type MotionIntent = "none" | "reveal" | "trace" | "step" | "compare" | "impact";

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Where the view is delivered. Format constrains *presentation affordances*
 * (can it animate, can it be focused with a keyboard, is it paginated) --
 * it never changes which facts are true, and never selects the detail mode.
 */
export type VisualFormat = "slide" | "interactive" | "document" | "export";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A structural echo of the EvidenceRef shape every upstream RVS package
 * already emits (`@rvs/knowledge-graph`'s is the closest ancestor). Echoed
 * rather than imported so this package keeps zero upstream dependencies;
 * `lines` stays a string (e.g. "12-34") verbatim, never renumbered.
 */
export interface VisualEvidenceRef {
  path?: string;
  lines?: string;
  source_artifact?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// FidelityReceipt -- the audit trail for every information reduction
// ---------------------------------------------------------------------------

/**
 * Why a set of source entities was reduced. Codes are a fixed enum, never
 * free prose, so a receipt can be asserted against in a test and diffed
 * between builds.
 */
export type FidelityReasonCode =
  | "FIDELITY_NO_REDUCTION"
  | "FIDELITY_NODE_BUDGET_EXCEEDED"
  | "FIDELITY_EDGE_BUDGET_EXCEEDED"
  | "FIDELITY_DEPTH_BUDGET_EXCEEDED"
  | "FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED"
  | "FIDELITY_LOW_VALUE_LEAF_COLLAPSED"
  | "FIDELITY_LOW_VALUE_LEAF_HIDDEN"
  | "FIDELITY_NON_FOCAL_HIDDEN"
  | "FIDELITY_SPLIT_INTO_VIEWS"
  | "FIDELITY_STAND_INS_MERGED"
  /**
   * The anchor floor was overruled to make a view fit.
   *
   * The one fidelity event Milestone 10.3 left unnamed. Every other reduction
   * already had a code; releasing a held-back anchor into a detail page was
   * disclosed only as the split it produced, so a receipt could say "entities
   * moved to a detail view" without saying that one of them was an entity the
   * floor had promised to keep. It is not a loss -- a released anchor is
   * still drawn, at full detail, in a view the primary one names -- but it is
   * a promise the budget overruled, and a receipt that does not say so is
   * quieter than it should be.
   */
  | "FIDELITY_ANCHOR_RELEASED"
  | "FIDELITY_TRUNCATED_AT_LIMIT";

/** Why a group's display representative was chosen, so the choice is auditable and reproducible rather than "whatever the sort happened to yield". */
export type CollapseSelectionPolicy =
  | "highest-priority-member"
  | "lowest-id-member"
  | "synthetic-group-label";

export interface CollapsedGroup {
  /** Deterministic id (see ids.ts `buildCollapsedGroupId`) -- never prose, never an array index. */
  id: string;
  /** Human-readable label shown in place of the collapsed members. */
  display_label: string;
  /** Every source entity id folded into this group, sorted. */
  source_entity_ids: string[];
  reason: FidelityReasonCode;
  selection_policy: CollapseSelectionPolicy;
}

/** One additional view produced because the content could not be made readable within a single view's budget. */
export interface SplitView {
  id: string;
  display_label: string;
  entity_ids: string[];
  reason: FidelityReasonCode;
}

export interface FidelityTruncation {
  truncated: boolean;
  /** Which budget forced truncation, when one did. Empty when `truncated` is false. */
  limits_hit: FidelityReasonCode[];
}

/**
 * The deterministic disclosure of everything a view's adaptation did to its
 * source entity set.
 *
 * Invariant enforced by `validateFidelityReceipt()`:
 *
 *     preserved  U  collapsed-members  U  hidden  ==  every source entity
 *
 * with the three sets pairwise disjoint. A simplifier that turns 27 source
 * nodes into 8 rendered nodes cannot do so silently -- the 19 that went away
 * are named, individually, with the reason each one went.
 */
export interface FidelityReceipt {
  id: string;
  schema_version: number;
  source_node_count: number;
  rendered_node_count: number;
  source_edge_count: number;
  rendered_edge_count: number;
  preserved_entity_ids: string[];
  collapsed_groups: CollapsedGroup[];
  hidden_entity_ids: string[];
  /** Path ids (see the graph model) whose every member survived adaptation. */
  preserved_paths: string[];
  /** Governance finding entity ids preserved because policy required it. */
  preserved_findings: string[];
  /** Decision entity ids preserved because policy required it. */
  preserved_decisions: string[];
  /** Entities whose resolution status is not `resolved` and which policy therefore never allows to vanish silently. */
  preserved_unresolved_entities: string[];
  truncation: FidelityTruncation;
  split_views: SplitView[];
  reason_codes: FidelityReasonCode[];
  /** SHA-256 over the canonical source entity/edge id sets. */
  source_digest: string;
  /** SHA-256 over the canonical rendered entity/edge id sets. */
  rendered_digest: string;
}

// ---------------------------------------------------------------------------
// VisualCommunicationSpec
// ---------------------------------------------------------------------------

/**
 * Where a grammar came from, kept alongside the choice so a reviewer can ask
 * "why this diagram?" and get an answer without re-running the selector.
 */
export interface GrammarSelection {
  grammar: VisualGrammar;
  /** Stable `VISUAL_GRAMMAR_*` code -- see grammar-selection.ts. */
  reason_code: string;
  /** Other grammars compatible with the intent and the evidence, in deterministic preference order. */
  alternatives: VisualGrammar[];
  /** The evidence signals that drove the choice, echoed back for auditability. */
  signals: GrammarSelectionSignals;
}

/**
 * The deterministic feature vector a grammar decision is a pure function of.
 * Every field is derived from evidence already established upstream -- none
 * is inferred from label text, and none comes from an external model.
 */
export interface GrammarSelectionSignals {
  intent: SemanticIntent;
  node_count: number;
  edge_count: number;
  /** Distinct node kinds present, sorted. */
  node_kinds: string[];
  /** Distinct edge kinds present, sorted. */
  edge_kinds: string[];
  /** True when every edge points the same way through the graph (a DAG with a single source layer). */
  acyclic: boolean;
  /** True when at least one cycle was established upstream. */
  has_cycles: boolean;
  /** Number of distinct lanes/actors, when the upstream model established lanes. */
  lane_count: number;
  /** Number of ordered stages, when the upstream model established stages. */
  stage_count: number;
  /** True when the upstream model carries ordered time positions. */
  has_timeline: boolean;
  /** True when the upstream model carries numeric measures. */
  has_quantitative: boolean;
  /** True when the upstream model carries before/after change facts. */
  has_change_facts: boolean;
  /** Number of distinct cause groups converging on a single effect. */
  cause_group_count: number;
  /** Maximum containment nesting depth established upstream. */
  containment_depth: number;
  /** True when the model declares explicit trust/security boundaries. */
  has_boundaries: boolean;
  audience: VisualAudience;
  detail_mode: DetailMode;
  format: VisualFormat;
}

/** Provenance for a spec. Deliberately excludes wall-clock time: two builds over identical evidence must produce byte-identical specs. */
export interface VisualGenerationMetadata {
  schema_version: number;
  /** Which RVS surface derived this spec (e.g. "scene-mapping", "graph-explorer"). */
  producer: string;
  /** The upstream artifact ids this spec was derived from, sorted. */
  source_artifact_ids: string[];
  /** Digest of the inputs the spec is a pure function of. */
  input_digest: string;
}

/**
 * The renderer-neutral contract every Milestone 10 visual is produced from.
 *
 * A spec says what is being communicated, to whom, at what detail, in which
 * grammar, with which motion, over which entities, within which budgets --
 * and (once adaptation has run) exactly what was lost getting there. It does
 * not contain geometry, colour, markup, or prose bodies. It is not a
 * document: `VisualDoc` remains the document model, and one VisualDoc scene
 * maps to at most one spec (see docs/visual-intelligence.md "Ownership").
 */
export interface VisualCommunicationSpec {
  id: string;
  schema_version: number;
  semantic_intent: SemanticIntent;
  visual_grammar: VisualGrammar;
  grammar_selection: GrammarSelection;
  detail_mode: DetailMode;
  motion_intent: MotionIntent;
  audience: VisualAudience;
  format: VisualFormat;
  /** Every upstream entity id in scope for this view, sorted. */
  source_entity_ids: string[];
  /** Entities the reader was explicitly directed to; never adapted away. */
  focal_entity_ids: string[];
  max_nodes: number;
  max_edges: number;
  max_depth: number;
  evidence_refs: VisualEvidenceRef[];
  /** Present once adaptation has run. Required whenever rendered != source. */
  fidelity_receipt?: FidelityReceipt;
  generation_metadata: VisualGenerationMetadata;
}
