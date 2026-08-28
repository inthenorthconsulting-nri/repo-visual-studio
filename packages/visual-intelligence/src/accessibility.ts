import { contrastBetween } from "./color.js";
import { buildFinding, sortFindings, type VisualFinding } from "./findings.js";
import {
  COLOR_ROLE_CONTRAST_TIER,
  MINIMUM_TEXT_SIZE_PX,
  VISUAL_COLOR_ROLES,
  VISUAL_TYPE_ROLES,
  type VisualColorRole,
  type VisualDesignTokens,
} from "./design-tokens.js";

// Milestone 10.5.4 -- the accessibility contract, expressed renderer-neutrally.
//
// Nothing in this module knows what SVG or HTML is. It produces the *facts* a
// renderer needs -- what this shape is called, what a reader is told when they
// reach it, what order things are reached in -- and each renderer turns those
// into whatever its output format calls them. That separation is the point:
// an accessible name computed here is identical in the deck, in the explorer,
// and in the change review, so a reader who learns what a component is called
// in one surface hears the same thing in the next.

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

/**
 * The semantic roles this system's primitives can take.
 *
 * Deliberately smaller than the ARIA role vocabulary. Every member here maps
 * onto exactly one ARIA role in each renderer, and a member is only added when
 * a primitive genuinely needs it -- an invented role that no primitive uses is
 * a promise to assistive technology that nothing keeps.
 */
export type VisualA11yRole = "image" | "group" | "region" | "button" | "link" | "listitem" | "note" | "status";

/**
 * What a reader is told, and when.
 *
 * There is deliberately no `hover` trigger. §30 forbids flooding assistive
 * technology during rapid pointer movement, and the only reliable way to
 * honour that is to make hover incapable of producing an announcement at all
 * -- a debounce is a promise that a slow enough mouse still breaks. Hover
 * remains a purely visual affordance; everything it reveals is also reachable
 * by focus, which does announce.
 */
export type AnnouncementTrigger = "focus" | "selection" | "route" | "change" | "filter" | "motion_complete";

export interface VisualAnnouncement {
  trigger: AnnouncementTrigger;
  /**
   * `assertive` is reserved for a state the reader must not miss and cannot
   * discover by continuing to read -- a blocking governance finding on the
   * thing they just selected. Everything else is polite.
   */
  politeness: "polite" | "assertive";
  text: string;
}

/**
 * What a primitive does when the reader has asked for reduced motion.
 *
 *  static                 the primitive never moved; nothing changes.
 *  instant_state_change   the end state is applied with no transition. The
 *                         information the motion carried is still delivered,
 *                         it just arrives at once.
 *  unchanged              the motion was already below the threshold that
 *                         triggers vestibular discomfort (a colour fade with
 *                         no translation), so it is left alone.
 */
export type ReducedMotionBehavior = "static" | "instant_state_change" | "unchanged";

export interface VisualAccessibilitySpec {
  accessible_name: string;
  accessible_description?: string;
  role: VisualA11yRole;
  focusable: boolean;
  /** Position in the reading order. Renderer-neutral: a renderer maps it to `tabindex`, to DOM order, or to both. */
  tab_order: number;
  announcements: VisualAnnouncement[];
  reduced_motion_behavior: ReducedMotionBehavior;
  minimum_contrast: "AA" | "AAA";
  minimum_font_size_px: number;
}

// ---------------------------------------------------------------------------
// Accessible names
// ---------------------------------------------------------------------------

/**
 * The facts that go into an entity's accessible name, in the order they are
 * spoken. Every field is something an intelligence layer already established;
 * nothing here infers.
 */
export interface AccessibleNameParts {
  /** "Component", "Capability", "Decision" -- the kind, spoken as a word. */
  kind: string;
  /** The entity's own label. */
  label: string;
  /** "changed", "removed", "added" -- present only when this view is about change. */
  change?: string;
  /** "governance review required", "governance blocking" -- present only when a finding is attached. */
  governance?: string;
  /** "causally unresolved", "qualified" -- present only when the fact is not fully established. */
  qualification?: string;
  /** "collapsed group of 12 entities" -- present only for a stand-in. */
  standIn?: string;
}

/**
 * Builds one accessible name.
 *
 * §28's rule is that a name says what the thing is, not what the renderer
 * called it: "Component packages/cli, changed, governance review required",
 * never "node-42". The order is fixed rather than importance-ranked, because a
 * reader tabbing through forty nodes learns the shape of the sentence once and
 * then only listens to the parts that differ -- a name whose fields move
 * around defeats that.
 */
export function accessibleName(parts: AccessibleNameParts): string {
  const segments = [
    `${parts.kind} ${parts.label}`.trim(),
    parts.standIn,
    parts.change,
    parts.governance,
    parts.qualification,
  ].filter((segment): segment is string => segment !== undefined && segment.trim() !== "");
  return segments.join(", ");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type VisualA11yCode =
  | "VISUAL_A11Y_CONTRAST_INSUFFICIENT"
  | "VISUAL_A11Y_TEXT_TOO_SMALL"
  | "VISUAL_A11Y_NAME_MISSING"
  | "VISUAL_A11Y_COLOR_ONLY_STATE"
  | "VISUAL_A11Y_FOCUS_NOT_VISIBLE"
  | "VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC";

export const VISUAL_A11Y_CODES: readonly VisualA11yCode[] = [
  "VISUAL_A11Y_CONTRAST_INSUFFICIENT",
  "VISUAL_A11Y_TEXT_TOO_SMALL",
  "VISUAL_A11Y_NAME_MISSING",
  "VISUAL_A11Y_COLOR_ONLY_STATE",
  "VISUAL_A11Y_FOCUS_NOT_VISIBLE",
  "VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC",
] as const;

export type VisualA11yFinding = VisualFinding<VisualA11yCode>;

/**
 * Every one of these stops a build.
 *
 * They are not style opinions. Text below the legible floor, a state only a
 * sighted reader can distinguish, an unnamed focusable shape, and a focus ring
 * that cannot be seen each mean a specific reader cannot use the artifact at
 * all -- and an artifact that excludes a reader is not a smaller artifact, it
 * is a wrong one.
 */
const A11Y_BLOCKING: ReadonlySet<VisualA11yCode> = new Set<VisualA11yCode>(VISUAL_A11Y_CODES);

function a11y(code: VisualA11yCode, subject: string, message: string): VisualA11yFinding {
  return buildFinding(code, subject, message, A11Y_BLOCKING.has(code));
}

export interface ContrastThresholds {
  /** Body text. AA is 4.5, AAA is 7.0 -- taken from @rvs/validator, never restated. */
  text: number;
  /** Meaningful non-text: connectors, focus rings, boundaries. 3.0 at both levels. */
  non_text: number;
}

export const AA_THRESHOLDS: ContrastThresholds = { text: 4.5, non_text: 3 };
export const AAA_THRESHOLDS: ContrastThresholds = { text: 7, non_text: 3 };

export function thresholdsFor(level: "AA" | "AAA"): ContrastThresholds {
  return level === "AAA" ? AAA_THRESHOLDS : AA_THRESHOLDS;
}

/**
 * Checks every semantic colour role against both grounds it can be drawn on.
 *
 * Both, not one: a node sits on `surface` and a caption sits on `paper`, and a
 * palette that reads on one and not the other produces a view that is legible
 * in its middle and not at its edges. `decoration`-tier roles are exempt by
 * construction -- see COLOR_ROLE_CONTRAST_TIER for why dimming is allowed to
 * be low contrast.
 */
export function validateTokenContrast(
  tokens: VisualDesignTokens,
  thresholds: ContrastThresholds = AA_THRESHOLDS,
): VisualA11yFinding[] {
  const findings: VisualA11yFinding[] = [];
  const grounds: Array<[string, string]> = [
    ["surface", tokens.color.surface],
    ["paper", tokens.color.paper],
  ];

  for (const role of VISUAL_COLOR_ROLES) {
    const tier = COLOR_ROLE_CONTRAST_TIER[role];
    if (tier === "decoration") continue;
    const required = tier === "text" ? thresholds.text : thresholds.non_text;
    const value = tokens.color[role];
    for (const [groundName, ground] of grounds) {
      const ratio = contrastBetween(value, ground);
      if (ratio === undefined) {
        findings.push(
          a11y(
            "VISUAL_A11Y_CONTRAST_INSUFFICIENT",
            `${tokens.id}.color.${role}`,
            `Role "${role}" resolves to ${JSON.stringify(value)}, which cannot be read as a colour, so its contrast against ${groundName} cannot be established.`,
          ),
        );
        continue;
      }
      if (ratio < required) {
        findings.push(
          a11y(
            "VISUAL_A11Y_CONTRAST_INSUFFICIENT",
            `${tokens.id}.color.${role}`,
            `Role "${role}" (${value}, ${tier}) reaches only ${ratio.toFixed(2)}:1 against ${groundName} (${ground}); ${required}:1 is required.`,
          ),
        );
      }
    }
  }
  return sortFindings(findings);
}

/**
 * Checks the type scale against the legible floor, at a stated render scale.
 *
 * The scale argument is the part that matters and the part nothing checked
 * before. `fitTransform` in @rvs/visual-grammar clamps to `Math.min(1, ...)`,
 * so a layout whose natural size exceeds its frame is drawn *smaller* -- and a
 * 14-unit label in a diagram fitted at 0.8 renders at 11.2 CSS pixels. The
 * declared size passing the floor therefore proves nothing on its own; the
 * effective size is what a reader has to read.
 */
export function validateTypeScale(
  tokens: VisualDesignTokens,
  renderScale = 1,
  minimumPx: number = MINIMUM_TEXT_SIZE_PX,
): VisualA11yFinding[] {
  const findings: VisualA11yFinding[] = [];
  for (const role of VISUAL_TYPE_ROLES) {
    const token = tokens.type[role];
    const effective = Math.round(token.size_px * renderScale * 100) / 100;
    if (effective < minimumPx) {
      findings.push(
        a11y(
          "VISUAL_A11Y_TEXT_TOO_SMALL",
          `${tokens.id}.type.${role}`,
          renderScale === 1
            ? `Type role "${role}" is ${token.size_px}px; the minimum legible size is ${minimumPx}px.`
            : `Type role "${role}" is ${token.size_px}px but renders at ${effective}px once the view is fitted at scale ${renderScale}; the minimum legible size is ${minimumPx}px. Reduce content rather than type -- see the degradation policy.`,
        ),
      );
    }
  }
  return sortFindings(findings);
}

/** The smallest scale at which every type role still clears the floor. Below this a view must shed content, never shrink. */
export function minimumLegibleScale(tokens: VisualDesignTokens, minimumPx: number = MINIMUM_TEXT_SIZE_PX): number {
  const smallest = Math.min(...VISUAL_TYPE_ROLES.map((role) => tokens.type[role].size_px));
  return Math.round((minimumPx / smallest) * 1000) / 1000;
}

/**
 * A state as a renderer is about to draw it, for the colour-independence check.
 *
 * `non_color_channels` is the list of things other than hue that distinguish
 * this state: a glyph, a spelled word, a stroke pattern, a border weight, a
 * marker shape. §35 forbids simulating colour-vision conditions -- there is no
 * such test implementation here -- so the check asks the only question that
 * can be answered objectively: is there anything but colour?
 */
export interface StatePresentation {
  state: string;
  color_role: VisualColorRole;
  non_color_channels: readonly string[];
}

export function validateColorIndependence(
  subjectId: string,
  presentations: readonly StatePresentation[],
): VisualA11yFinding[] {
  const findings: VisualA11yFinding[] = [];
  for (const presentation of presentations) {
    if (presentation.non_color_channels.length === 0) {
      findings.push(
        a11y(
          "VISUAL_A11Y_COLOR_ONLY_STATE",
          `${subjectId}.${presentation.state}`,
          `State "${presentation.state}" is carried by colour role "${presentation.color_role}" alone. ` +
            `A state needs at least one non-colour channel -- a glyph, a spelled word, a stroke treatment, or a marker.`,
        ),
      );
    }
  }
  return sortFindings(findings);
}

/**
 * Checks a set of accessibility specs for the three defects a renderer can
 * introduce without noticing: an unnamed focusable thing, a focus ring that
 * cannot be seen, and a reading order two runs would disagree about.
 */
export function validateAccessibilitySpecs(
  subjectId: string,
  specs: readonly VisualAccessibilitySpec[],
  tokens?: VisualDesignTokens,
  thresholds: ContrastThresholds = AA_THRESHOLDS,
): VisualA11yFinding[] {
  const findings: VisualA11yFinding[] = [];

  for (const spec of specs) {
    if (spec.accessible_name.trim() === "") {
      findings.push(
        a11y(
          "VISUAL_A11Y_NAME_MISSING",
          `${subjectId}.${spec.role}.${spec.tab_order}`,
          `A ${spec.focusable ? "focusable" : "non-focusable"} ${spec.role} carries no accessible name. ` +
            `A shape a reader can reach and cannot identify is a shape they cannot use.`,
        ),
      );
    }
  }

  const focusable = specs.filter((spec) => spec.focusable);
  const orders = focusable.map((spec) => spec.tab_order);
  const duplicates = orders.filter((value, index) => orders.indexOf(value) !== index);
  if (duplicates.length > 0) {
    findings.push(
      a11y(
        "VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC",
        subjectId,
        `Tab order value(s) ${[...new Set(duplicates)].sort((a, b) => a - b).join(", ")} are assigned to more than one focusable element. ` +
          `Two runs would then disagree about which comes first, and a reader tabbing twice would take two different paths.`,
      ),
    );
  }

  if (tokens !== undefined) {
    if (tokens.geometry.focusRingWidth <= 0) {
      findings.push(
        a11y(
          "VISUAL_A11Y_FOCUS_NOT_VISIBLE",
          `${subjectId}.focus`,
          `The focus ring has width ${tokens.geometry.focusRingWidth}. Keyboard navigation that cannot be seen is keyboard navigation that does not work.`,
        ),
      );
    }
    for (const [groundName, ground] of [
      ["surface", tokens.color.surface],
      ["paper", tokens.color.paper],
    ] as const) {
      const ratio = contrastBetween(tokens.color.focus, ground);
      if (ratio !== undefined && ratio < thresholds.non_text) {
        findings.push(
          a11y(
            "VISUAL_A11Y_FOCUS_NOT_VISIBLE",
            `${subjectId}.focus`,
            `The focus ring (${tokens.color.focus}) reaches only ${ratio.toFixed(2)}:1 against ${groundName} (${ground}); ${thresholds.non_text}:1 is required for it to be seen.`,
          ),
        );
      }
    }
  }

  return sortFindings(findings);
}
