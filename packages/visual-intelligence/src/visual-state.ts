// Milestone 10.5.3 -- one semantic state model, shared by every grammar and
// both interactive artifacts.
//
// The problem this solves is not "which colour is a removed node". It is that
// a node can be several things at once. A component that was removed and
// carries a blocking governance finding is *both*, and a reviewer who only
// learns one of them is being told a comforting half-truth. §21 says so
// directly: "removed + governance blocking must preserve both meanings. Do
// not simply let one state overwrite another."
//
// A single precedence chain cannot do that. Sort those two states into one
// list and one of them loses, whichever way the comparator points. So the
// states are sorted into LAYERS instead, and precedence runs only *within* a
// layer. Two states in different layers never compete, because they are never
// asking for the same pixel:
//
//   lifecycle    -> body fill + a change marker glyph
//   governance   -> a status badge and border weight
//   confidence   -> the stroke pattern
//   interaction  -> the focus ring, emphasis, and dimming
//   availability -> flattened presentation and an explicit label
//
// Each layer also carries at least one NON-COLOUR channel, which is what makes
// §8 ("do not make red/green the only distinction") a structural property of
// the model rather than a rule renderers are asked to remember.

import type { VisualColorRole } from "./design-tokens.js";

/** Every state a rendered entity can be in. §21's list, unabridged. */
export const VISUAL_STATES = [
  "normal",
  "focused",
  "selected",
  "dimmed",
  "hovered",
  "related",
  "route",
  "added",
  "removed",
  "changed",
  "rerouted",
  "blocking",
  "review_required",
  "qualified",
  "unresolved",
  "disabled",
] as const;

export type VisualState = (typeof VISUAL_STATES)[number];

/**
 * The five independent channels of meaning.
 *
 * A layer is not a category for tidiness. It is a claim that the states inside
 * it are mutually exclusive facts about one question -- "what happened to this
 * entity", "how much do we trust it" -- and that states in different layers
 * answer different questions and therefore both stay true.
 */
export type VisualStateLayer = "lifecycle" | "governance" | "confidence" | "interaction" | "availability";

export const VISUAL_STATE_LAYERS: readonly VisualStateLayer[] = [
  "lifecycle",
  "governance",
  "confidence",
  "interaction",
  "availability",
] as const;

/**
 * Which layer each state belongs to, and how strongly it argues within it.
 *
 * Rank is ordinal only: it decides which state wins a layer, never how
 * anything is drawn. Lower wins.
 */
interface StateRule {
  layer: VisualStateLayer;
  rank: number;
}

const STATE_RULES: Readonly<Record<VisualState, StateRule>> = {
  // Lifecycle. Removal outranks the rest because it is the only one whose
  // subject is no longer there to be inspected: everything else can be read
  // off the "after" side, and a removal cannot.
  removed: { layer: "lifecycle", rank: 0 },
  added: { layer: "lifecycle", rank: 1 },
  rerouted: { layer: "lifecycle", rank: 2 },
  changed: { layer: "lifecycle", rank: 3 },

  // Governance. Severity order, matching the existing governance vocabulary.
  blocking: { layer: "governance", rank: 0 },
  review_required: { layer: "governance", rank: 1 },

  // Confidence. "Unresolved" beats "qualified" because an unresolved claim is
  // one nobody has established, and a qualified one is established with
  // caveats; showing the weaker word for the weaker evidence would invert it.
  unresolved: { layer: "confidence", rank: 0 },
  qualified: { layer: "confidence", rank: 1 },

  // Interaction. What the reader is doing right now, most deliberate first:
  // selection is a decision, focus is a keyboard position, hover is a
  // wandering pointer. Route and related are consequences of one of those,
  // and dimming is the absence of all of them.
  selected: { layer: "interaction", rank: 0 },
  focused: { layer: "interaction", rank: 1 },
  hovered: { layer: "interaction", rank: 2 },
  route: { layer: "interaction", rank: 3 },
  related: { layer: "interaction", rank: 4 },
  dimmed: { layer: "interaction", rank: 5 },
  normal: { layer: "interaction", rank: 6 },

  disabled: { layer: "availability", rank: 0 },
};

export function layerOf(state: VisualState): VisualStateLayer {
  return STATE_RULES[state].layer;
}

/**
 * A non-colour channel carrying part of a state's meaning.
 *
 * These exist so that the same fact is legible with the colour removed. A
 * reviewer reading a greyscale print of a change review, or a reader who
 * cannot separate the palette's red from its green, still sees the marker
 * glyph, the badge text, and the stroke pattern.
 */
export interface StateChannels {
  /** Stroke pattern name; "solid" unless confidence says otherwise. */
  stroke_pattern: "solid" | "dashed" | "dotted";
  /** Relative stroke weight. 1 is the token's ordinary connector width. */
  stroke_scale: number;
  /** A glyph placed on the entity: "+", "−", "~", "↷". */
  marker?: string;
  /** Short text shown in a badge; always spelled out, never a colour name. */
  badge?: string;
  /** Whether a focus ring is drawn. */
  focus_ring: boolean;
  /** 0-1. Only ever lowered by dimming or unavailability. */
  opacity: number;
}

/** One layer's contribution to the final presentation. */
export interface ResolvedLayer {
  layer: VisualStateLayer;
  state: VisualState;
  /** The colour role this layer asks for, if it asks for one. */
  color_role?: VisualColorRole;
  /** The words a screen reader should hear for this layer. */
  accessible_term?: string;
}

/**
 * The complete presentation of an entity, with every layer that had something
 * to say still saying it.
 */
export interface ResolvedVisualState {
  /** Every input state that survived, sorted for determinism. */
  states: VisualState[];
  /** One entry per layer that had an active state, in layer order. */
  layers: ResolvedLayer[];
  /** The body fill role. */
  fill_role: VisualColorRole;
  /** The border / connector stroke role. */
  stroke_role: VisualColorRole;
  /** The label ink role. */
  text_role: VisualColorRole;
  channels: StateChannels;
  /** Layer terms joined for a screen reader, in the order they resolved. */
  accessible_terms: string[];
}

interface LayerPresentation {
  color_role?: VisualColorRole;
  term?: string;
  apply: (channels: StateChannels) => void;
}

const LIFECYCLE: Partial<Record<VisualState, LayerPresentation>> = {
  added: {
    color_role: "added",
    term: "added",
    apply: (c) => {
      c.marker = "+";
    },
  },
  removed: {
    color_role: "removed",
    term: "removed",
    apply: (c) => {
      c.marker = "−";
      // Removed entities are drawn open rather than filled: the thing is not
      // there any more, and a solid body says it is.
      c.stroke_pattern = "dashed";
    },
  },
  changed: {
    color_role: "changed",
    term: "changed",
    apply: (c) => {
      c.marker = "~";
    },
  },
  rerouted: {
    color_role: "rerouted",
    term: "rerouted",
    apply: (c) => {
      c.marker = "↷";
    },
  },
};

const GOVERNANCE: Partial<Record<VisualState, LayerPresentation>> = {
  blocking: {
    color_role: "governanceBlocking",
    term: "governance blocking",
    apply: (c) => {
      c.badge = "Blocking";
      c.stroke_scale = Math.max(c.stroke_scale, 2);
    },
  },
  review_required: {
    color_role: "governanceReviewRequired",
    term: "governance review required",
    apply: (c) => {
      c.badge = "Review";
      c.stroke_scale = Math.max(c.stroke_scale, 1.5);
    },
  },
};

const CONFIDENCE: Partial<Record<VisualState, LayerPresentation>> = {
  unresolved: {
    color_role: "unresolved",
    term: "unresolved",
    apply: (c) => {
      c.stroke_pattern = "dashed";
    },
  },
  qualified: {
    color_role: "qualified",
    term: "qualified",
    apply: (c) => {
      c.stroke_pattern = "dotted";
    },
  },
};

const INTERACTION: Partial<Record<VisualState, LayerPresentation>> = {
  selected: {
    color_role: "selected",
    term: "selected",
    apply: (c) => {
      c.focus_ring = true;
      c.stroke_scale = Math.max(c.stroke_scale, 2);
    },
  },
  focused: {
    color_role: "focus",
    term: "focused",
    apply: (c) => {
      c.focus_ring = true;
      c.stroke_scale = Math.max(c.stroke_scale, 2);
    },
  },
  hovered: {
    // Hover deliberately carries no accessible term. §30 forbids flooding
    // assistive technology as a pointer crosses a diagram, and hover is a
    // pointer-only state that no keyboard user can even reach.
    color_role: "accent",
    apply: (c) => {
      c.stroke_scale = Math.max(c.stroke_scale, 1.5);
    },
  },
  route: {
    color_role: "route",
    term: "on the traced route",
    apply: (c) => {
      c.stroke_scale = Math.max(c.stroke_scale, 2);
    },
  },
  related: {
    color_role: "related",
    term: "related",
    apply: (c) => {
      c.stroke_scale = Math.max(c.stroke_scale, 1.25);
    },
  },
  dimmed: {
    // Dimming lowers contrast on purpose, and nothing is removed from the
    // document -- a dimmed node keeps its name, its description, and its
    // place in the tab order.
    color_role: "dimmed",
    apply: (c) => {
      c.opacity = 0.35;
    },
  },
  normal: { apply: () => {} },
};

const AVAILABILITY: Partial<Record<VisualState, LayerPresentation>> = {
  disabled: {
    color_role: "disabled",
    term: "unavailable",
    apply: (c) => {
      c.opacity = Math.min(c.opacity, 0.6);
      c.badge = c.badge ?? "Unavailable";
    },
  },
};

const PRESENTATION: Record<VisualStateLayer, Partial<Record<VisualState, LayerPresentation>>> = {
  lifecycle: LIFECYCLE,
  governance: GOVERNANCE,
  confidence: CONFIDENCE,
  interaction: INTERACTION,
  availability: AVAILABILITY,
};

/**
 * Resolve a set of simultaneously-true states into one presentation.
 *
 * Determinism: the input is deduplicated and each layer's winner is chosen by
 * rank, so the order the caller happened to list its states in cannot change
 * the result. §62 shuffles this input and compares.
 *
 * @param states every state that is true of the entity, in any order.
 */
export function resolveVisualState(states: readonly VisualState[]): ResolvedVisualState {
  const active = [...new Set(states)];

  const winners = new Map<VisualStateLayer, VisualState>();
  for (const state of active) {
    const rule = STATE_RULES[state];
    if (!rule) continue;
    const held = winners.get(rule.layer);
    if (held === undefined || rule.rank < STATE_RULES[held].rank) winners.set(rule.layer, state);
  }
  // Interaction always resolves to something, so a caller that passes nothing
  // still gets a complete presentation rather than a partial one.
  if (!winners.has("interaction")) winners.set("interaction", "normal");

  const channels: StateChannels = {
    stroke_pattern: "solid",
    stroke_scale: 1,
    focus_ring: false,
    opacity: 1,
  };

  const layers: ResolvedLayer[] = [];
  const terms: string[] = [];
  for (const layer of VISUAL_STATE_LAYERS) {
    const state = winners.get(layer);
    if (state === undefined) continue;
    const presentation = PRESENTATION[layer][state];
    if (!presentation) continue;
    presentation.apply(channels);
    layers.push({ layer, state, color_role: presentation.color_role, accessible_term: presentation.term });
    if (presentation.term) terms.push(presentation.term);
  }

  // Which layer owns which surface. Lifecycle owns the body because "what
  // happened to this" is the reason a change review exists; confidence owns
  // the stroke because a dashed border reads as "not established" without
  // needing a legend; interaction owns nothing structural, so it can never
  // erase either of them by hovering.
  const lifecycle = layers.find((l) => l.layer === "lifecycle");
  const governance = layers.find((l) => l.layer === "governance");
  const confidence = layers.find((l) => l.layer === "confidence");
  const interaction = layers.find((l) => l.layer === "interaction");
  const availability = layers.find((l) => l.layer === "availability");

  const fill_role: VisualColorRole = availability ? "surfaceMuted" : (lifecycle?.color_role ?? "surface");

  const stroke_role: VisualColorRole =
    confidence?.color_role ?? governance?.color_role ?? lifecycle?.color_role ?? interaction?.color_role ?? "rule";

  const text_role: VisualColorRole = availability ? "disabled" : interaction?.state === "dimmed" ? "inkMuted" : "ink";

  return {
    states: active.slice().sort(),
    layers,
    fill_role,
    stroke_role,
    text_role,
    channels,
    accessible_terms: terms,
  };
}

/**
 * Whether two state sets present identically.
 *
 * Used by the cross-artifact tests: the explorer and the change review must
 * agree, and "agree" has to mean something comparable.
 */
export function samePresentation(a: ResolvedVisualState, b: ResolvedVisualState): boolean {
  return JSON.stringify({ ...a, states: undefined }) === JSON.stringify({ ...b, states: undefined });
}
