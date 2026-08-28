// Milestone 10.5.2 -- the accessible visual primitives every grammar draws
// with.
//
// The defect this closes is the one §1 names: visual behaviour being
// independently invented by scene renderers. Before this file, a node's
// border weight was decided in the layered renderer, the change-review
// stylesheet, and the explorer stylesheet -- three places, three answers, and
// three separate opportunities for "removed" to mean a different thing.
//
// A primitive here is a SPEC, not markup. It is the resolved answer to "how
// should this thing look and behave", computed once from tokens plus semantic
// state, and handed to whichever renderer is drawing. That is what makes §25's
// promise true: the same semantic state looks and behaves the same whether
// the dependency grammar, the explorer, or the change review is rendering it.
//
// No React, no framework, no runtime. §14 asks for none and none is needed:
// these are plain objects, and the renderers that consume them already emit
// strings.

import type {
  ResolvedVisualState,
  VisualAccessibilitySpec,
  VisualColorRole,
  VisualDesignTokens,
  VisualState,
  VisualTypeRole,
} from "@rvs/visual-intelligence";
import { MINIMUM_TEXT_SIZE_PX, resolveVisualState } from "@rvs/visual-intelligence";

/** Every primitive kind §13-§20 asks for. */
export type VisualPrimitiveKind =
  | "node"
  | "group"
  | "boundary"
  | "connector"
  | "edge_label"
  | "status_badge"
  | "annotation"
  | "callout"
  | "legend"
  | "focus_ring"
  | "evidence_marker"
  | "change_marker"
  | "route_marker"
  | "stand_in"
  | "split_view_link";

/**
 * What a connector is asserting.
 *
 * §17's list. The kind is upstream truth -- a governance relationship does not
 * become a dependency because it was easier to draw as one -- so this is
 * carried, never inferred.
 */
export type ConnectorKind =
  | "dependency"
  | "flow"
  | "invocation"
  | "governance"
  | "decision"
  | "impact"
  | "route"
  | "change"
  | "unresolved";

export type ConnectorDirection = "forward" | "backward" | "bidirectional" | "undirected";

/** Resolved paint for one primitive. Colour ROLES, never literals: the renderer looks them up. */
export interface PrimitivePaint {
  fill_role: VisualColorRole;
  stroke_role: VisualColorRole;
  text_role: VisualColorRole;
  fill: string;
  stroke: string;
  text: string;
  stroke_width: number;
  stroke_dasharray?: string;
  opacity: number;
}

/** The shared shape behind every primitive. */
export interface VisualPrimitiveBase {
  kind: VisualPrimitiveKind;
  id: string;
  state: ResolvedVisualState;
  paint: PrimitivePaint;
  accessibility: VisualAccessibilitySpec;
}

export interface VisualNodeSpec extends VisualPrimitiveBase {
  kind: "node";
  label: string;
  meta?: string;
  type_role: VisualTypeRole;
  corner_radius: number;
  padding_x: number;
  padding_y: number;
  /** Glyph carrying the lifecycle meaning without colour. §8. */
  marker?: string;
  badge?: string;
}

export interface VisualGroupSpec extends VisualPrimitiveBase {
  kind: "group";
  label: string;
  corner_radius: number;
  member_ids: string[];
}

export interface VisualBoundarySpec extends VisualPrimitiveBase {
  kind: "boundary";
  label: string;
  corner_radius: number;
  /** A trust boundary is drawn as a rule, not a fill: it encloses, it is not a thing. */
  dashed: true;
}

export interface VisualConnectorSpec extends VisualPrimitiveBase {
  kind: "connector";
  connector_kind: ConnectorKind;
  direction: ConnectorDirection;
  from_id: string;
  to_id: string;
  emphasis: boolean;
  on_route: boolean;
  marker_end?: string;
  marker_start?: string;
}

export interface VisualEdgeLabelSpec extends VisualPrimitiveBase {
  kind: "edge_label";
  text: string;
  connector_id: string;
}

export interface VisualStatusBadgeSpec extends VisualPrimitiveBase {
  kind: "status_badge";
  text: string;
  subject_id: string;
}

export interface VisualAnnotationSpec extends VisualPrimitiveBase {
  kind: "annotation";
  text: string;
}

export interface VisualCalloutSpec extends VisualPrimitiveBase {
  kind: "callout";
  text: string;
  subject_id: string;
}

export interface VisualLegendEntry {
  swatch_role: VisualColorRole;
  /** The non-colour channel this entry also carries, so the legend is legible in greyscale. */
  marker?: string;
  stroke_pattern?: "solid" | "dashed" | "dotted";
  label: string;
}

export interface VisualLegendSpec extends VisualPrimitiveBase {
  kind: "legend";
  entries: VisualLegendEntry[];
}

export interface VisualFocusRingSpec extends VisualPrimitiveBase {
  kind: "focus_ring";
  subject_id: string;
  width: number;
  offset: number;
}

export interface VisualEvidenceMarkerSpec extends VisualPrimitiveBase {
  kind: "evidence_marker";
  subject_id: string;
  evidence_count: number;
}

export interface VisualChangeMarkerSpec extends VisualPrimitiveBase {
  kind: "change_marker";
  subject_id: string;
  change_state: Extract<VisualState, "added" | "removed" | "changed" | "rerouted">;
  glyph: string;
}

export interface VisualRouteMarkerSpec extends VisualPrimitiveBase {
  kind: "route_marker";
  subject_id: string;
  position: number;
  total: number;
}

/**
 * A collapsed group standing in for entities that did not fit.
 *
 * §19 is emphatic and this type enforces it: a stand-in "must never visually
 * resemble a real entity without indicating that it is a collapsed
 * representation". So `entity_count`, `fidelity_reason`, and `navigable_to`
 * are all required, and `collapsed` is the literal `true` -- there is no way
 * to construct one that forgets to say what it is.
 */
export interface VisualStandInSpec extends VisualPrimitiveBase {
  kind: "stand_in";
  collapsed: true;
  group_label: string;
  entity_count: number;
  fidelity_reason: string;
  /** Where the reader goes to see what was collapsed. Never absent: §20 forbids hiding the only route to detail. */
  navigable_to: string;
  has_split_view: boolean;
}

export interface VisualSplitViewLinkSpec extends VisualPrimitiveBase {
  kind: "split_view_link";
  target_view_id: string;
  label: string;
  entity_count: number;
}

export type VisualPrimitive =
  | VisualNodeSpec
  | VisualGroupSpec
  | VisualBoundarySpec
  | VisualConnectorSpec
  | VisualEdgeLabelSpec
  | VisualStatusBadgeSpec
  | VisualAnnotationSpec
  | VisualCalloutSpec
  | VisualLegendSpec
  | VisualFocusRingSpec
  | VisualEvidenceMarkerSpec
  | VisualChangeMarkerSpec
  | VisualRouteMarkerSpec
  | VisualStandInSpec
  | VisualSplitViewLinkSpec;

const DASH: Readonly<Record<"solid" | "dashed" | "dotted", string | undefined>> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "1.5 3",
};

/**
 * Turn resolved semantic state into paint.
 *
 * This is the single function that decides what a state looks like. Every
 * primitive below calls it; no renderer calls anything else. That is the
 * whole mechanism behind "the same semantic state must look and behave
 * consistently regardless of which grammar renders it".
 */
export function paintFor(
  tokens: VisualDesignTokens,
  state: ResolvedVisualState,
  overrides: { stroke_role?: VisualColorRole; base_stroke_width?: number } = {},
): PrimitivePaint {
  const strokeRole = overrides.stroke_role ?? state.stroke_role;
  const base = overrides.base_stroke_width ?? tokens.geometry.connectorWidth;
  return {
    fill_role: state.fill_role,
    stroke_role: strokeRole,
    text_role: state.text_role,
    fill: tokens.color[state.fill_role],
    stroke: tokens.color[strokeRole],
    text: tokens.color[state.text_role],
    stroke_width: round(base * state.channels.stroke_scale),
    ...(DASH[state.channels.stroke_pattern] ? { stroke_dasharray: DASH[state.channels.stroke_pattern] } : {}),
    opacity: state.channels.opacity,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Compose an accessible name from a label and the state terms already resolved. §28. */
export function nameFromState(kindWord: string, label: string, state: ResolvedVisualState): string {
  return [`${kindWord} ${label}`, ...state.accessible_terms].join(", ");
}

function baseAccessibility(
  name: string,
  role: VisualAccessibilitySpec["role"],
  focusable: boolean,
  tabOrder: number,
  tokens: VisualDesignTokens,
  description?: string,
): VisualAccessibilitySpec {
  return {
    accessible_name: name,
    ...(description ? { accessible_description: description } : {}),
    role,
    focusable,
    tab_order: tabOrder,
    announcements: focusable ? [{ trigger: "focus", politeness: "polite", text: name }] : [],
    reduced_motion_behavior: "instant_state_change",
    minimum_contrast: "AA",
    minimum_font_size_px: Math.max(MINIMUM_TEXT_SIZE_PX, tokens.type.nodeMeta.size_px),
  };
}

export interface NodeInput {
  id: string;
  label: string;
  meta?: string;
  kind_word?: string;
  states?: readonly VisualState[];
  tab_order?: number;
  description?: string;
}

export function visualNode(tokens: VisualDesignTokens, input: NodeInput): VisualNodeSpec {
  const state = resolveVisualState(input.states ?? []);
  const name = nameFromState(input.kind_word ?? "Component", input.label, state);
  return {
    kind: "node",
    id: input.id,
    label: input.label,
    ...(input.meta ? { meta: input.meta } : {}),
    type_role: "nodeLabel",
    state,
    paint: paintFor(tokens, state, { base_stroke_width: tokens.geometry.ruleWidth }),
    corner_radius: tokens.geometry.nodeRadius,
    padding_x: tokens.geometry.nodePaddingX,
    padding_y: tokens.geometry.nodePaddingY,
    ...(state.channels.marker ? { marker: state.channels.marker } : {}),
    ...(state.channels.badge ? { badge: state.channels.badge } : {}),
    accessibility: baseAccessibility(name, "group", true, input.tab_order ?? 0, tokens, input.description),
  };
}

export interface ConnectorInput {
  id: string;
  from_id: string;
  to_id: string;
  connector_kind: ConnectorKind;
  direction?: ConnectorDirection;
  from_label: string;
  to_label: string;
  states?: readonly VisualState[];
  emphasis?: boolean;
  on_route?: boolean;
  tab_order?: number;
}

/**
 * A connector's accessible name says what the relationship IS, not that a line
 * exists. "packages/cli depends on packages/core" is navigable; "edge-42" is
 * a coordinate.
 */
const CONNECTOR_VERB: Readonly<Record<ConnectorKind, string>> = {
  dependency: "depends on",
  flow: "flows to",
  invocation: "calls",
  governance: "is governed by",
  decision: "is decided by",
  impact: "impacts",
  route: "routes to",
  change: "changed relative to",
  unresolved: "may relate to",
};

export function visualConnector(tokens: VisualDesignTokens, input: ConnectorInput): VisualConnectorSpec {
  const states = [...(input.states ?? [])];
  if (input.connector_kind === "unresolved" && !states.includes("unresolved")) states.push("unresolved");
  if (input.on_route && !states.includes("route")) states.push("route");
  const state = resolveVisualState(states);
  const name = [
    `${input.from_label} ${CONNECTOR_VERB[input.connector_kind]} ${input.to_label}`,
    ...state.accessible_terms,
  ].join(", ");
  const emphasis = input.emphasis === true || input.on_route === true;
  return {
    kind: "connector",
    id: input.id,
    connector_kind: input.connector_kind,
    direction: input.direction ?? "forward",
    from_id: input.from_id,
    to_id: input.to_id,
    emphasis,
    on_route: input.on_route === true,
    state,
    paint: paintFor(tokens, state, {
      stroke_role: state.layers.find((l) => l.layer !== "interaction")?.color_role ?? state.stroke_role,
      base_stroke_width: emphasis ? tokens.geometry.connectorEmphasisWidth : tokens.geometry.connectorWidth,
    }),
    accessibility: baseAccessibility(name, "listitem", false, input.tab_order ?? 0, tokens),
  };
}

export interface StandInInput {
  id: string;
  group_label: string;
  entity_count: number;
  fidelity_reason: string;
  navigable_to: string;
  has_split_view?: boolean;
  tab_order?: number;
}

/**
 * Build a stand-in.
 *
 * The label always leads with the count, and the accessible name always says
 * "collapsed". A reader must be able to tell -- by sight, by keyboard, and by
 * screen reader -- that they are looking at a summary and where the detail
 * went.
 */
export function visualStandIn(tokens: VisualDesignTokens, input: StandInInput): VisualStandInSpec {
  const state = resolveVisualState(["qualified"]);
  const name = `${input.entity_count} collapsed ${input.entity_count === 1 ? "entity" : "entities"} in ${input.group_label}`;
  const description = `${input.fidelity_reason} Open ${input.navigable_to} to see ${input.entity_count === 1 ? "it" : "them"}.`;
  return {
    kind: "stand_in",
    id: input.id,
    collapsed: true,
    group_label: input.group_label,
    entity_count: input.entity_count,
    fidelity_reason: input.fidelity_reason,
    navigable_to: input.navigable_to,
    has_split_view: input.has_split_view === true,
    state,
    paint: paintFor(tokens, state, { base_stroke_width: tokens.geometry.ruleWidth }),
    accessibility: baseAccessibility(name, "button", true, input.tab_order ?? 0, tokens, description),
  };
}

export interface FocusRingInput {
  subject_id: string;
  tab_order?: number;
  subject_name: string;
}

/**
 * The focus ring.
 *
 * Drawn outside the subject with an offset so it is never clipped by the
 * shape it surrounds, and always at `focusRingWidth` -- §24 requires a
 * visible ring that meets contrast and is not colour-only, and an outline
 * that appears where none was before is a shape change as well as a colour
 * change.
 */
export function visualFocusRing(tokens: VisualDesignTokens, input: FocusRingInput): VisualFocusRingSpec {
  const state = resolveVisualState(["focused"]);
  return {
    kind: "focus_ring",
    id: `${input.subject_id}:focus`,
    subject_id: input.subject_id,
    width: tokens.geometry.focusRingWidth,
    offset: 2,
    state,
    paint: paintFor(tokens, state, { stroke_role: "focus", base_stroke_width: tokens.geometry.focusRingWidth }),
    accessibility: baseAccessibility(input.subject_name, "note", false, input.tab_order ?? 0, tokens),
  };
}

/**
 * The legend.
 *
 * Every entry carries its non-colour channel alongside its swatch, so the
 * legend itself demonstrates that the diagram is readable without colour
 * rather than asserting it.
 */
export function visualLegend(
  tokens: VisualDesignTokens,
  id: string,
  states: readonly VisualState[],
): VisualLegendSpec {
  const entries: VisualLegendEntry[] = states.map((raw) => {
    const resolved = resolveVisualState([raw]);
    const layer = resolved.layers.find((l) => l.state === raw);
    return {
      swatch_role: layer?.color_role ?? "ink",
      ...(resolved.channels.marker ? { marker: resolved.channels.marker } : {}),
      stroke_pattern: resolved.channels.stroke_pattern,
      label: layer?.accessible_term ?? raw,
    };
  });
  const state = resolveVisualState([]);
  return {
    kind: "legend",
    id,
    entries,
    state,
    paint: paintFor(tokens, state),
    accessibility: baseAccessibility(
      `Legend, ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
      "region",
      false,
      0,
      tokens,
      entries.map((entry) => entry.label).join(", "),
    ),
  };
}
