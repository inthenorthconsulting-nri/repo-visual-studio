import {
  CANONICAL_COORDINATE_SYSTEM,
  MINIMUM_TEXT_SIZE_PX,
  normalizeVisualGraphModel,
  resolveVisualState,
  sceneContentBox,
  type ResolvedVisualState,
  type VisualChangeKind,
  type VisualColorRole,
  type VisualCommunicationSpec,
  type VisualGrammar,
  type VisualGraphModel,
  type VisualNode,
  type VisualState,
} from "@rvs/visual-intelligence";
import { nameFromState } from "./primitives.js";
import { fitTransform, type Rect } from "./geometry.js";
import { desc, element, escapeText, formatNumber, polylinePath, title } from "./svg.js";
import { lineHeight } from "./sizing.js";
import { type GrammarStyle } from "./style.js";
import { grammarStyleFromTokens } from "./tokens-bridge.js";
import { deltaLayout } from "./layout/delta.js";
import { fishboneLayout } from "./layout/fishbone.js";
import { layeredLayout } from "./layout/layered.js";
import { sequenceLayout, swimlaneLayout } from "./layout/lanes.js";
import { layerStackLayout, nestedLayout } from "./layout/nested.js";
import { matrixLayout, metricRowLayout } from "./layout/matrix.js";
import { stageLayout } from "./layout/stages.js";
import type { GrammarLayout, LaidOutEdge, LaidOutLabel, LaidOutNode, LayoutContext } from "./layout/types.js";

// Grammar rendering: layout in, SVG string out.
//
// The renderer draws exactly what the layout placed and exactly what the
// model contains. It has no capacity to omit an entity, and that is
// structural rather than a rule it follows: it iterates the layout's arrays,
// and everything upstream decided not to draw was already removed -- with a
// fidelity receipt -- before this package was called.

export interface RenderInput {
  spec: VisualCommunicationSpec;
  model: VisualGraphModel;
  style?: GrammarStyle;
  /**
   * Whether the drawing lands on a surface a reader can operate.
   *
   * Off by default, and deliberately so. A focusable node is a tab stop, and a
   * sixty-node diagram embedded in a document would put sixty tab stops
   * between a reader and the paragraph after it -- an accessibility cost, not
   * a benefit, on a surface where there is nothing to activate. When the
   * surface *is* interactive the opposite holds: an entity a mouse can click
   * and a keyboard cannot reach is not reachable at all.
   */
  interactive?: boolean;
  /**
   * What makes this render's element ids unique within its page.
   *
   * Defaults to the spec id, which is correct when a spec produces one
   * drawing. It is wrong when a spec produces several: the explorer renders
   * one spec as an overview plus a detail view per split, and all of them
   * landed in a single HTML document carrying the same marker ids and --
   * worse -- the same `<title>` and `<desc>` ids. `aria-labelledby` resolves
   * to the first matching id in the document, so every detail view was
   * announced with the overview's name and description while its own were
   * unreachable. A caller that draws a spec more than once passes the id of
   * the view being drawn.
   */
  id_scope?: string;
}

/** A node's box in canonical units, republished so the explorer hit-tests the geometry that was actually drawn. */
export interface RenderedBox {
  node_id: string;
  source_entity_id: string;
  rect: Rect;
  instance?: string;
}

export interface RenderResult {
  grammar: VisualGrammar;
  /** The complete `<svg>` element as a string. */
  svg: string;
  view_box: string;
  /** Natural layout size before the fit transform, in canonical units. */
  content: { width: number; height: number };
  /** Uniform scale applied to fit the content box. Never greater than 1. */
  scale: number;
  boxes: RenderedBox[];
}

/** Which engine draws which grammar. Published so a caller can ask before rendering. */
export const GRAMMAR_ENGINES: Readonly<Record<VisualGrammar, string>> = {
  architecture: "layered",
  dependency_graph: "layered",
  data_flow: "layered",
  tree: "layered",
  state_machine: "layered",
  nested: "nested",
  layer_stack: "layer-stack",
  swimlane: "swimlane",
  sequence: "sequence",
  process: "stages",
  timeline: "timeline",
  matrix: "matrix",
  metric_row: "metric-row",
  fishbone: "fishbone",
  delta: "delta",
};

function layoutFor(
  grammar: VisualGrammar,
  context: LayoutContext,
  frame: { width: number; height: number },
): GrammarLayout {
  const frameWidth = frame.width;
  switch (grammar) {
    // The frame is handed to the layered engines so a layer wider than the
    // scene wraps rather than forcing the whole drawing to be scaled down to
    // fit -- see `LayeredOptions.frame_breadth`. A horizontal layering stacks
    // across the *height*, so that is its breadth.
    case "architecture":
    case "dependency_graph":
    case "data_flow":
      return layeredLayout(context, { direction: "vertical", frame_breadth: frame.width });
    case "tree":
      return layeredLayout(context, { direction: "vertical", show_secondary: false, frame_breadth: frame.width });
    case "state_machine":
      return layeredLayout(context, { direction: "horizontal", frame_breadth: frame.height });
    case "nested":
      return nestedLayout(context, frameWidth);
    case "layer_stack":
      return layerStackLayout(context, frameWidth);
    case "swimlane":
      return swimlaneLayout(context);
    case "sequence":
      return sequenceLayout(context);
    case "process":
      return stageLayout(context, false);
    case "timeline":
      return stageLayout(context, true);
    case "matrix":
      return matrixLayout(context);
    case "metric_row":
      return metricRowLayout(context, frameWidth);
    case "fishbone":
      return fishboneLayout(context);
    case "delta":
      return deltaLayout(context, frame);
  }
}

/**
 * A document-unique prefix for element and marker ids.
 *
 * Two diagrams embedded in one HTML page would otherwise both define
 * `#arrow-normal`, and the second definition would silently win for both --
 * a class of bug that only appears once a deck has more than one diagram on a
 * slide. Derived from the render's id scope, which defaults to the spec id,
 * so it is stable across runs.
 *
 * Keying it on the spec alone was not enough. One spec can be drawn several
 * times into one document -- the explorer draws an overview and a detail view
 * per split -- and every one of those drawings then shared a prefix, which is
 * the same collision one level down.
 */
function idPrefix(input: RenderInput): string {
  return (input.id_scope ?? input.spec.id).replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * The style an unstyled render draws through.
 *
 * Resolved from the neutral *token* set rather than from `NEUTRAL_STYLE`
 * directly. The two agree on almost everything, and disagree on the one thing
 * that matters here: the hand-written 10.2 style declares `secondary` at 12px
 * and `annotation` at 11px, both under the 14px floor @rvs/validator enforces
 * on rendered text. Every caller that renders without naming a theme -- the
 * explorer and the change-review viewer among them -- therefore emitted
 * sub-floor SVG text. Defaulting at the seam fixes all of them at once, which
 * is the ownership §55 describes: token consumption belongs to the shared
 * layer, not to whichever caller remembered to pass a style.
 *
 * Computed once. `grammarStyleFromTokens` is pure, so a per-render call would
 * only re-derive an identical object.
 */
const DEFAULT_STYLE: GrammarStyle = grammarStyleFromTokens();

export function renderGrammar(input: RenderInput): RenderResult {
  const style = input.style ?? DEFAULT_STYLE;
  const scene = sceneContentBox();
  // Normalised here rather than trusted from the caller. Node *positions*
  // were already order-independent, but serialisation order was not: without
  // this, two callers holding the same model with its edges in a different
  // order produced different bytes, and every downstream digest, cached
  // artifact, and screen-reader reading order differed with them.
  const model = normalizeVisualGraphModel(input.model);
  const context: LayoutContext = { model, style };
  const layout = layoutFor(input.spec.visual_grammar, context, scene);

  // The scene is a floor, not a ceiling.
  //
  // A layout is laid out to fit the scene and almost always does; the budgets
  // in @rvs/visual-intelligence exist to make sure of it. When one still comes
  // out larger -- a delta drawing the same entities in three panels is the
  // case that survives every budget -- the frame grows to hold it rather than
  // the drawing being scaled down to fit, because `fitTransform` scales the
  // type along with the geometry and no amount of it is allowed to put a
  // 14-unit label below the 14px floor. The `@rvs/visual-intelligence`
  // degradation policy states this as "reduce content, never shrink type";
  // this is the renderer's half of it. A frame wider than its pane scrolls,
  // which the stage CSS in the explorer and the review viewer already allows.
  const frame = {
    width: Math.max(scene.width, layout.width),
    height: Math.max(scene.height, layout.height),
  };
  const fit = fitTransform(layout, frame);
  const prefix = idPrefix(input);

  const changeOf = new Map<string, VisualChangeKind>();
  for (const change of model.changes) {
    if (change.subject_type === "node") changeOf.set(change.subject_id, change.kind);
  }

  const body = [
    renderDefs(prefix, style),
    renderGroups(layout, style, prefix),
    renderLabels(layout, style, prefix),
    renderEdges(layout, style, prefix),
    renderNodes(layout, style, prefix, changeOf, input.interactive === true),
  ].join("");

  const stage = element(
    "g",
    [
      ["transform", `translate(${formatNumber(fit.translateX)} ${formatNumber(fit.translateY)}) scale(${formatNumber(fit.scale)})`],
      ["data-rvs-stage", "1"],
    ],
    body,
  );

  const titleId = `${prefix}-title`;
  const descId = `${prefix}-desc`;
  const svg = element(
    "svg",
    [
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["viewBox", `0 0 ${formatNumber(frame.width)} ${formatNumber(frame.height)}`],
      // An intrinsic size, in the canonical units the viewBox is expressed in,
      // so one unit is one CSS pixel exactly as
      // `CANONICAL_COORDINATE_SYSTEM.browser_scaling_baseline` declares.
      // Without it an SVG carrying only a viewBox is sized by its container,
      // and a diagram in a 530px-wide pane was drawn at half scale -- 14-unit
      // type at 6.9 CSS pixels -- while every check that measured the declared
      // font size reported 14px and passed. A pane too narrow now scrolls
      // (`.rvs-stage { overflow-x: auto }`), which is the trade the degradation
      // policy asks for: never resolve a space problem by shrinking type.
      ["width", formatNumber(frame.width)],
      ["height", formatNumber(frame.height)],
      ["role", "img"],
      ["aria-labelledby", `${titleId} ${descId}`],
      ["data-rvs-grammar", input.spec.visual_grammar],
      ["data-rvs-intent", input.spec.semantic_intent],
      ["data-rvs-detail-mode", input.spec.detail_mode],
      ["data-rvs-audience", input.spec.audience],
      ["data-rvs-spec", input.spec.id],
      ["data-rvs-coordinate-system", CANONICAL_COORDINATE_SYSTEM.id],
    ],
    `<title id="${titleId}">${escapeText(accessibleTitle(input))}</title><desc id="${descId}">${escapeText(accessibleDescription(input, layout))}</desc>${stage}`,
  );

  return {
    grammar: input.spec.visual_grammar,
    svg,
    view_box: `0 0 ${formatNumber(frame.width)} ${formatNumber(frame.height)}`,
    content: { width: layout.width, height: layout.height },
    scale: fit.scale,
    boxes: layout.nodes.map((n) => ({
      node_id: n.node.id,
      source_entity_id: n.node.source_entity_id,
      rect: n.rect,
      instance: n.instance,
    })),
  };
}

/**
 * The diagram's accessible name.
 *
 * Built from the spec's own vocabulary rather than from a caption a deck
 * happens to carry, so a diagram is described the same way wherever it is
 * embedded and so the description cannot drift from what was drawn.
 */
function accessibleTitle(input: RenderInput): string {
  return `${input.spec.visual_grammar.replace(/_/g, " ")} diagram showing ${input.spec.semantic_intent.replace(/_/g, " ")}`;
}

function accessibleDescription(input: RenderInput, layout: GrammarLayout): string {
  const parts = [`${layout.nodes.length} element(s)`, `${layout.edges.length} relationship(s)`];
  const receipt = input.spec.fidelity_receipt;
  if (receipt !== undefined && receipt.rendered_node_count !== receipt.source_node_count) {
    // The reduction is stated in the accessible description too. A reader
    // using a screen reader has the same right to know the picture is partial
    // as a reader who can see the "12 of 40 shown" caption.
    parts.push(
      `${receipt.rendered_node_count} of ${receipt.source_node_count} entities shown; the remainder are collapsed, hidden, or in detail views`,
    );
  }
  return `${parts.join(", ")}.`;
}

/**
 * Arrowhead markers, one per line role.
 *
 * Defined per document rather than shared globally: a marker inherits no
 * colour from the path that uses it, so each role needs its own, and each
 * needs the document-unique prefix to survive being embedded alongside
 * another diagram.
 */
function renderDefs(prefix: string, style: GrammarStyle): string {
  const roles: Array<[string, string]> = [
    ["normal", style.line.normal],
    ["primary", style.line.primary],
    ["focal", style.line.focal],
    ["muted", style.line.muted],
    ["added", style.state.added],
    ["removed", style.state.removed],
    ["changed", style.state.changed],
  ];
  const markers = roles
    .map(([role, colour]) =>
      element(
        "marker",
        [
          ["id", `${prefix}-arrow-${role}`],
          ["viewBox", "0 0 10 10"],
          ["refX", 9],
          ["refY", 5],
          ["markerWidth", 6],
          ["markerHeight", 6],
          ["orient", "auto-start-reverse"],
        ],
        element("path", [["d", "M 0 0 L 10 5 L 0 10 z"], ["fill", colour]]),
      ),
    )
    .join("");
  return element("defs", [], markers);
}

function renderGroups(layout: GrammarLayout, style: GrammarStyle, prefix: string): string {
  if (layout.groups.length === 0) return "";
  const children = layout.groups
    .map((group) => {
      const box = element("rect", [
        ["x", group.rect.x],
        ["y", group.rect.y],
        ["width", group.rect.width],
        ["height", group.rect.height],
        ["rx", style.radius.container],
        ["fill", style.surface.container],
        ["stroke", style.line.border],
        ["stroke-width", style.stroke.hairline],
        // A dashed border marks a container adaptation created rather than
        // one the architecture has, so a synthetic cluster is never mistaken
        // for a real module.
        ["stroke-dasharray", group.synthetic ? "4 3" : undefined],
      ]);
      const label = element(
        "text",
        [
          ["x", group.rect.x + style.spacing.md],
          ["y", group.rect.y + style.spacing.md + style.font_size.secondary],
          ["font-family", style.font_family],
          ["font-size", style.font_size.secondary],
          ["font-weight", "600"],
          ["fill", style.ink.secondary],
        ],
        escapeText(group.label),
      );
      return element(
        "g",
        [
          ["data-rvs-group", group.id],
          ["data-rvs-synthetic", group.synthetic ? "1" : "0"],
        ],
        `${box}${label}`,
      );
    })
    .join("");
  return element("g", [["data-rvs-layer", "groups"], ["data-rvs-prefix", prefix]], children);
}

function renderLabels(layout: GrammarLayout, style: GrammarStyle, prefix: string): string {
  const drawable = layout.labels.filter((l) => l.text !== "");
  if (drawable.length === 0) return "";
  const children = drawable.map((label) => renderLabel(label, style)).join("");
  return element("g", [["data-rvs-layer", "labels"], ["data-rvs-prefix", prefix]], children);
}

function renderLabel(label: LaidOutLabel, style: GrammarStyle): string {
  return element(
    "text",
    [
      ["x", label.at.x],
      ["y", label.at.y],
      ["text-anchor", label.anchor],
      ["dominant-baseline", "middle"],
      ["font-family", style.font_family],
      ["font-size", label.role === "caption" ? style.font_size.label : style.font_size.secondary],
      ["font-weight", label.role === "caption" || label.role === "lane" ? "600" : "400"],
      ["fill", style.ink.secondary],
      ["data-rvs-label-role", label.role],
      [
        "transform",
        label.rotate === -90 ? `rotate(-90 ${formatNumber(label.at.x)} ${formatNumber(label.at.y)})` : undefined,
      ],
    ],
    escapeText(label.text),
  );
}

function renderEdges(layout: GrammarLayout, style: GrammarStyle, prefix: string): string {
  if (layout.edges.length === 0) return "";
  const children = layout.edges.map((edge) => renderEdge(edge, style, prefix)).join("");
  return element("g", [["data-rvs-layer", "edges"]], children);
}

function renderEdge(laid: LaidOutEdge, style: GrammarStyle, prefix: string): string {
  const { edge } = laid;
  const role =
    edge.emphasis === "focal" ? "focal" : edge.emphasis === "primary" ? "primary" : edge.emphasis === "muted" ? "muted" : "normal";
  const colour =
    role === "focal" ? style.line.focal : role === "primary" ? style.line.primary : role === "muted" ? style.line.muted : style.line.normal;
  const path = element("path", [
    ["d", polylinePath(laid.points)],
    ["fill", "none"],
    ["stroke", colour],
    ["stroke-width", edge.emphasis === "focal" ? style.stroke.emphasis : style.stroke.normal],
    // A dashed line marks a relationship upstream could not fully resolve.
    // The reader sees uncertainty as uncertainty rather than as fact.
    ["stroke-dasharray", edge.resolution === "resolved" ? undefined : "6 4"],
    ["marker-end", `url(#${prefix}-arrow-${role})`],
  ]);
  const label =
    edge.label === undefined || laid.label_anchor === undefined
      ? ""
      : element(
          "text",
          [
            ["x", laid.label_anchor.x],
            ["y", laid.label_anchor.y],
            ["text-anchor", "middle"],
            ["font-family", style.font_family],
            ["font-size", style.font_size.annotation],
            ["fill", style.ink.muted],
          ],
          escapeText(edge.label),
        );
  return element(
    "g",
    [
      ["data-rvs-edge", edge.id],
      ["data-rvs-from", edge.from_id],
      ["data-rvs-to", edge.to_id],
      ["data-rvs-edge-kind", edge.kind],
      ["data-rvs-resolution", edge.resolution],
      ["data-rvs-in-cycle", edge.in_cycle ? "1" : "0"],
    ],
    `${title(`${edge.from_id} ${edge.kind.replace(/_/g, " ")} ${edge.to_id}`)}${path}${label}`,
  );
}

/**
 * The node's facts, restated in the shared state vocabulary.
 *
 * The mapping is the whole point of Milestone 10.5: severity, resolution,
 * confidence and change kind are decided upstream and this renderer only
 * translates them, so a component that is `blocking` here resolves to the same
 * presentation that the explorer and the change-review viewer resolve it to.
 * Nothing is invented -- every branch below reads a field the model carries.
 *
 * Note what is *not* mapped. `emphasis: "focal"` does not become the `focused`
 * state: editorial prominence and keyboard focus are different claims, and
 * minting a focus ring for a statically-prominent node would tell a keyboard
 * user their cursor is somewhere it is not.
 */
function nodeStates(node: VisualNode, change: VisualChangeKind | undefined): VisualState[] {
  const states: VisualState[] = [];
  // Lifecycle. Kinds without a state of their own ("moved", "regressed",
  // "resolved", "qualified") land on `changed`, which is what they are: the
  // entity is still there and it is not what it was.
  if (change === "added") states.push("added");
  else if (change === "removed") states.push("removed");
  else if (change === "rerouted") states.push("rerouted");
  else if (change !== undefined) states.push("changed");

  if (node.severity === "blocking") states.push("blocking");
  else if (node.severity === "review_required") states.push("review_required");

  // Both of these are confidence-layer states, so the layer decides which one
  // presents rather than this function guessing an order.
  if (node.resolution === "unresolved") states.push("unresolved");
  else if (node.resolution === "partial") states.push("qualified");
  if (node.confidence !== "confirmed") states.push("qualified");

  if (node.emphasis === "muted") states.push("dimmed");
  return states;
}

/** The word a screen reader hears before the label. A stand-in says so first; see §28. */
function kindWord(node: VisualNode): string {
  if (node.placeholder_for !== undefined) return "Stand-in";
  const words = node.kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The change marker: a glyph, not a hue.
 *
 * Colour alone cannot carry "added" versus "removed" -- §8, and the reason a
 * colour-blind reviewer can read a delta diagram at all. The glyph comes from
 * the resolved state rather than from a local table so that the SVG, the
 * explorer and the change-review viewer all draw the same character for the
 * same fact.
 *
 * It sits in the box's top-right gutter (`spacing.md` wide, label text stops
 * short of it), above the first label baseline, so it cannot collide with the
 * text it annotates.
 */
function changeMarker(resolved: ResolvedVisualState, rect: Rect, style: GrammarStyle, fill: string): string {
  if (resolved.channels.marker === undefined) return "";
  return element(
    "text",
    [
      ["x", rect.x + rect.width - style.spacing.xs - 1],
      ["y", rect.y + style.font_size.annotation + 2],
      ["text-anchor", "end"],
      ["font-family", style.font_family],
      ["font-size", style.font_size.annotation],
      ["fill", fill],
      // Decorative to assistive technology: the same fact is already in the
      // accessible name, and announcing "plus" after "added" is noise.
      ["aria-hidden", "true"],
    ],
    escapeText(resolved.channels.marker),
  );
}

/**
 * Map a resolved colour role onto the injected style surface.
 *
 * `GrammarStyle` names its slots after the states this renderer actually
 * produces (see `nodeStates`), not after the full `VisualColorRole`
 * vocabulary `resolveVisualState` supports -- interaction roles that only
 * ever arrive from an interactive runtime (`focus`, `route`, `related`, ...)
 * fall back to the nearest existing line role rather than each earning a
 * dedicated token. This is the one place a role becomes a colour; every
 * caller below looks it up here rather than choosing one itself.
 */
function roleColor(role: VisualColorRole, style: GrammarStyle): string {
  switch (role) {
    case "removed":
      return style.state.removed;
    case "added":
      return style.state.added;
    case "changed":
    case "rerouted":
      return style.state.changed;
    case "governanceBlocking":
      return style.state.blocking;
    case "governanceReviewRequired":
      return style.state.review_required;
    case "unresolved":
      return style.state.unresolved;
    case "qualified":
      return style.state.partial;
    case "dimmed":
    case "related":
      return style.line.muted;
    case "focus":
    case "selected":
    case "accent":
      return style.line.focal;
    case "route":
      return style.line.primary;
    default:
      return style.line.border;
  }
}

/**
 * Border colour: the resolved state's own precedence, not a second one.
 *
 * `resolved.stroke_role` already answers "which fact wins the stroke" --
 * confidence, then governance, then lifecycle, then interaction -- so a node
 * that is both `removed` and `blocking` reads as blocking here, exactly as
 * `resolveVisualState` decided, while the lifecycle fact stays visible
 * through the change marker and the availability of a badge rather than being
 * silently dropped. Only when no layer claims the stroke (`"rule"`, the
 * fallback `resolveVisualState` returns for a node with no active state) does
 * editorial emphasis get a say, because emphasis was never part of the state
 * vocabulary `resolveVisualState` resolves.
 */
function nodeAccent(node: VisualNode, resolved: ResolvedVisualState, style: GrammarStyle): string {
  if (resolved.stroke_role !== "rule") return roleColor(resolved.stroke_role, style);
  if (node.emphasis === "focal") return style.line.focal;
  if (node.emphasis === "primary") return style.line.primary;
  return style.line.border;
}

const STROKE_DASH_ARRAY: Readonly<Record<"solid" | "dashed" | "dotted", string | undefined>> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "2 2",
};

/**
 * The badge: short governance/availability text, not a hue.
 *
 * Shares the marker's top gutter but sits at the opposite (leading) edge, so
 * a node that is both removed and blocking draws both non-colour signals at
 * once instead of one displacing the other. Coloured by whichever layer
 * actually asked for the badge -- not by `accent`, which may belong to a
 * different, higher-precedence layer for the same node. Decorative to
 * assistive technology, like the marker: the term is already in the
 * accessible name (`resolved.accessible_terms`), and announcing it twice
 * would be noise, not information.
 */
function renderStateBadge(resolved: ResolvedVisualState, rect: Rect, style: GrammarStyle, fallback: string): string {
  if (resolved.channels.badge === undefined) return "";
  const owner = resolved.layers.find((l) => l.layer === "governance" || l.layer === "availability");
  const fill = owner?.color_role !== undefined ? roleColor(owner.color_role, style) : fallback;
  const fontSize = Math.max(style.font_size.annotation, MINIMUM_TEXT_SIZE_PX);
  return element(
    "text",
    [
      ["x", rect.x + style.spacing.xs + 1],
      ["y", rect.y + fontSize + 2],
      ["text-anchor", "start"],
      ["font-family", style.font_family],
      ["font-size", fontSize],
      ["font-weight", "600"],
      ["fill", fill],
      ["aria-hidden", "true"],
    ],
    escapeText(resolved.channels.badge),
  );
}

function renderNodes(
  layout: GrammarLayout,
  style: GrammarStyle,
  prefix: string,
  changeOf: ReadonlyMap<string, VisualChangeKind>,
  interactive: boolean,
): string {
  if (layout.nodes.length === 0) return "";
  const children = layout.nodes
    .map((laid) => renderNode(laid, style, prefix, changeOf.get(laid.node.id), interactive))
    .join("");
  return element("g", [["data-rvs-layer", "nodes"]], children);
}

function renderNode(
  laid: LaidOutNode,
  style: GrammarStyle,
  prefix: string,
  change: VisualChangeKind | undefined,
  interactive: boolean,
): string {
  const { node, rect } = laid;
  const states = nodeStates(node, change);
  const resolved = resolveVisualState(states);
  const accent = nodeAccent(node, resolved, style);
  const baseStrokeWidth = node.emphasis === "focal" ? style.stroke.emphasis : style.stroke.normal;
  const box = element("rect", [
    ["x", rect.x],
    ["y", rect.y],
    ["width", rect.width],
    ["height", rect.height],
    ["rx", style.radius.node],
    ["fill", node.emphasis === "muted" ? style.surface.muted : style.surface.node],
    ["stroke", accent],
    ["stroke-width", baseStrokeWidth * resolved.channels.stroke_scale],
    // A stand-in is drawn open rather than solid regardless of what the state
    // model says: it is not an entity, and a box that looked like every other
    // box would read as one more component rather than as "twelve of them
    // live over here". Everything else takes its pattern from the resolved
    // state -- confidence's dashed/dotted or lifecycle's dashed "removed" --
    // rather than re-deriving one from `node.resolution` directly.
    ["stroke-dasharray", node.placeholder_for !== undefined ? "5 3" : STROKE_DASH_ARRAY[resolved.channels.stroke_pattern]],
  ]);

  const labelHeight = laid.lines.length * lineHeight(style.font_size.label);
  const secondaryHeight = laid.secondary === undefined ? 0 : lineHeight(style.font_size.secondary);
  let cursor = rect.y + (rect.height - labelHeight - secondaryHeight) / 2 + style.font_size.label;
  const lines = laid.lines
    .map((line) => {
      const text = element(
        "text",
        [
          ["x", rect.x + rect.width / 2],
          ["y", cursor],
          ["text-anchor", "middle"],
          ["font-family", style.font_family],
          ["font-size", style.font_size.label],
          ["fill", node.emphasis === "muted" ? style.ink.muted : style.ink.primary],
        ],
        escapeText(line),
      );
      cursor += lineHeight(style.font_size.label);
      return text;
    })
    .join("");
  const secondary =
    laid.secondary === undefined
      ? ""
      : element(
          "text",
          [
            ["x", rect.x + rect.width / 2],
            ["y", cursor],
            ["text-anchor", "middle"],
            ["font-family", style.font_family],
            ["font-size", style.font_size.secondary],
            ["fill", style.ink.muted],
          ],
          escapeText(laid.secondary),
        );

  // The full label always ships inside `<title>`, so a box whose text had to
  // be abbreviated still tells a reader -- and a screen reader -- the whole
  // name. §28 wants that name to carry the state too: "Component packages/cli,
  // changed, governance review required", not a bare label and certainly not
  // an id. The terms come from the resolved state, so they are the same terms
  // the explorer announces for the same entity.
  const accessible = `${title(nameFromState(kindWord(node), node.label, resolved))}${desc(describeNode(node, change))}`;
  const elementId = laid.instance === undefined ? `${prefix}-n-${node.id}` : `${prefix}-n-${node.id}@${laid.instance}`;

  return element(
    "g",
    [
      ["id", elementId],
      // On an operable surface the box is a control: it takes focus from the
      // keyboard, it announces itself as a button, and the shared stylesheet's
      // `:focus-visible` rule draws the ring. Without these three a reader
      // using a keyboard can see every entity and reach none of them.
      ["tabindex", interactive ? 0 : undefined],
      ["role", interactive ? "button" : "img"],
      ["data-rvs-node", node.id],
      ["data-rvs-entity", node.source_entity_id],
      ["data-rvs-kind", node.kind],
      ["data-rvs-emphasis", node.emphasis],
      ["data-rvs-resolution", node.resolution],
      ["data-rvs-confidence", node.confidence],
      ["data-rvs-severity", node.severity],
      ["data-rvs-decision-status", node.decision_status],
      ["data-rvs-change", change],
      // The resolved states, space-separated, because that is the form the
      // shared stylesheet selects on (`[data-rvs-state~="blocking"]`). Every
      // state that is true is listed: a removed entity under a blocking
      // finding carries both, and neither overwrites the other.
      ["data-rvs-state", states.length === 0 ? undefined : states.join(" ")],
      ["data-rvs-marker", resolved.channels.marker],
      // Exposes the same resolved value `renderStateBadge` draws as a glyph,
      // structurally, alongside `data-rvs-marker` -- so a rendered-artifact
      // validator can confirm the badge channel survived without scraping
      // `<text>` content or guessing at `text-anchor`.
      ["data-rvs-badge", resolved.channels.badge],
      ["data-rvs-instance", laid.instance],
      ["data-rvs-evidence-count", node.evidence_refs.length],
      // The destination travels with the drawing, so an interactive surface
      // can offer "open that detail view" without re-deriving where the
      // entities went from a receipt it may not have been handed.
      ["data-rvs-placeholder", node.placeholder_for === undefined ? undefined : "1"],
      ["data-rvs-placeholder-count", node.placeholder_for?.entity_count],
      ["data-rvs-collapsed-group", node.placeholder_for?.collapsed_group_id],
      ["data-rvs-split-view", node.placeholder_for?.split_view_id],
    ],
    `${accessible}${box}${lines}${secondary}${changeMarker(resolved, rect, style, accent)}${renderStateBadge(resolved, rect, style, accent)}`,
  );
}

/**
 * The per-node accessible description.
 *
 * States only facts the model carries. In particular it never says a node is
 * "important" or "problematic" -- it says the severity upstream assigned,
 * leaving the interpretation where it belongs.
 */
function describeNode(node: VisualNode, change: VisualChangeKind | undefined): string {
  if (node.placeholder_for !== undefined) {
    const count = node.placeholder_for.entity_count;
    // Stated as a stand-in first, so a screen reader never presents it as a
    // component -- the one misreading that would make the count meaningless.
    return `stands in for ${count} ${count === 1 ? "entity" : "entities"} shown elsewhere`;
  }
  const parts = [node.kind.replace(/_/g, " ")];
  if (node.severity !== undefined) parts.push(`severity ${node.severity.replace(/_/g, " ")}`);
  if (node.decision_status !== undefined) parts.push(`decision ${node.decision_status}`);
  if (node.resolution !== "resolved") parts.push(`${node.resolution} reference`);
  if (node.confidence !== "confirmed") parts.push(node.confidence);
  if (change !== undefined) parts.push(change);
  if (node.evidence_refs.length > 0) parts.push(`${node.evidence_refs.length} evidence reference(s)`);
  return parts.join(", ");
}
