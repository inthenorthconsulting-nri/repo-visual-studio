import { contrastBetween, isLight, mixHex, parseColor } from "./color.js";
import { buildFinding, sortFindings, type VisualFinding } from "./findings.js";

// Milestone 10.5.1 -- one semantic design-token model.
//
// The problem this solves is not that the diagrams were ugly. It is that
// every renderer was inventing its own visual behaviour: @rvs/visual-explorer
// and @rvs/visual-change-review each declared their own `--rvs-ink`,
// `--rvs-accent` and change palette, chose different hexes for "added", and
// neither one ever read the design system the deck renderer had already
// loaded. Three independent sources of visual truth is two too many.
//
// Two rules shape the whole model.
//
// Roles are named for what they mean, never for what they look like. There is
// no `red` and no `gray100` below -- there is `critical` and `surfaceMuted`,
// because a theme that renders `critical` in deep amber is still rendering
// the same fact, and a downstream renderer that switches on `critical` keeps
// working when it does. §5.
//
// Colour is never the only carrier. Every state role below has a non-colour
// partner in the primitive layer -- a glyph, a stroke treatment, a spelled
// word -- so the token set is what makes a state *recognisable*, not what
// makes it *legible*. §8.

// ---------------------------------------------------------------------------
// The minimum legible size
// ---------------------------------------------------------------------------

/**
 * The smallest text this system will author, in canonical units.
 *
 * This is not a new floor. @rvs/validator has enforced 14 as its
 * `minFontSizePx` default since Milestone 3, and budgets.ts derives every
 * grammar's node capacity from it. §32 forbids a second minimum, so the
 * number moves here -- the zero-dependency package everything can import --
 * and @rvs/validator takes its default from this constant rather than
 * restating the literal.
 */
export const MINIMUM_TEXT_SIZE_PX = 14;

// ---------------------------------------------------------------------------
// Colour roles
// ---------------------------------------------------------------------------

export const VISUAL_COLOR_ROLES = [
  // Ground: what the view is drawn on.
  "paper",
  "surface",
  "surfaceMuted",
  "surfaceRaised",
  "surfaceInverse",
  // Ink: what is drawn on it.
  "ink",
  "inkMuted",
  "inkSubtle",
  "inkInverse",
  // Structure: rules, boundaries, and the lines that carry relationships.
  "rule",
  "ruleStrong",
  "connector",
  "connectorEmphasis",
  "connectorMuted",
  // Emphasis.
  "accent",
  "accentMuted",
  // Evaluative: how a fact was judged.
  "positive",
  "warning",
  "critical",
  "informational",
  // Epistemic: how well a fact is known.
  "qualified",
  "unresolved",
  "disabled",
  // Interaction: what the reader is doing.
  "focus",
  "selected",
  "related",
  "dimmed",
  "route",
  // Change.
  "added",
  "removed",
  "changed",
  "rerouted",
  // Governance severity.
  "governanceBlocking",
  "governanceReviewRequired",
  "governanceAdvisory",
  "governanceInformational",
] as const;

export type VisualColorRole = (typeof VISUAL_COLOR_ROLES)[number];

/**
 * How much contrast a role has to earn, and against what.
 *
 *  text        carries words; must meet the configured text threshold.
 *  structure   carries meaning without words -- a connector, a focus ring --
 *              and must meet the 3:1 non-text threshold WCAG 1.4.11 sets.
 *  decoration  carries no information on its own. A divider rule, the muted
 *              form of a connector, and the dimmed treatment are all in this
 *              tier: dimming is *supposed* to lower contrast, and the
 *              information a dimmed entity carries stays reachable because
 *              nothing is ever removed from the document, search still finds
 *              it, and one keypress restores it. See docs/visual-accessibility.md.
 */
export type ContrastTier = "text" | "structure" | "decoration";

export const COLOR_ROLE_CONTRAST_TIER: Readonly<Record<VisualColorRole, ContrastTier>> = {
  paper: "decoration",
  surface: "decoration",
  surfaceMuted: "decoration",
  surfaceRaised: "decoration",
  surfaceInverse: "decoration",
  ink: "text",
  inkMuted: "text",
  inkSubtle: "text",
  inkInverse: "decoration",
  rule: "decoration",
  ruleStrong: "structure",
  connector: "structure",
  connectorEmphasis: "structure",
  connectorMuted: "decoration",
  accent: "text",
  accentMuted: "decoration",
  positive: "text",
  warning: "text",
  critical: "text",
  informational: "text",
  qualified: "text",
  unresolved: "text",
  disabled: "text",
  focus: "structure",
  selected: "structure",
  related: "text",
  dimmed: "decoration",
  route: "structure",
  added: "text",
  removed: "text",
  changed: "text",
  rerouted: "text",
  governanceBlocking: "text",
  governanceReviewRequired: "text",
  governanceAdvisory: "text",
  governanceInformational: "text",
} as const;

// ---------------------------------------------------------------------------
// Typography roles
// ---------------------------------------------------------------------------

export const VISUAL_TYPE_ROLES = [
  "display",
  "headline",
  "sectionTitle",
  "nodeLabel",
  "nodeMeta",
  "technicalIdentifier",
  "annotation",
  "edgeLabel",
  "eyebrow",
  "metric",
  "caption",
  "evidence",
] as const;

export type VisualTypeRole = (typeof VISUAL_TYPE_ROLES)[number];

/**
 * Which family a role is set in. Resolved to a real stack by
 * `VisualDesignTokens.font_stack`. The four names match the four a design
 * system already declares (`typography.display`, `.heading`, `.body`,
 * `.code`) so a theme's type choices survive resolution intact instead of
 * being collapsed into a smaller set.
 */
export type VisualFontFamily = "display" | "heading" | "body" | "mono";

export interface VisualTypeToken {
  family: VisualFontFamily;
  size_px: number;
  weight: number;
  line_height: number;
  letter_spacing_em: number;
  uppercase: boolean;
}

/**
 * The type scale.
 *
 * `mono` appears exactly three times, and each time it is a string a reader
 * may need to retype or match character-for-character: an identifier, a
 * command or path, an evidence citation. §6 is explicit that monospace is not
 * the house "technical" aesthetic -- a component name is prose and is set in
 * prose type, because setting every label in a terminal font makes an
 * architecture diagram look like a log file and tells the reader nothing.
 *
 * No size is below MINIMUM_TEXT_SIZE_PX. `nodeLabel` is 16 because that is
 * the size budgets.ts already assumes when it derives each grammar's cell
 * from "a two-line label at >=16px" -- the previous 14 in NEUTRAL_STYLE was
 * a quiet disagreement with the budget it was being measured against.
 */
export const DEFAULT_TYPE_SCALE: Readonly<Record<VisualTypeRole, VisualTypeToken>> = {
  display: { family: "display", size_px: 34, weight: 700, line_height: 1.15, letter_spacing_em: -0.01, uppercase: false },
  headline: { family: "heading", size_px: 26, weight: 700, line_height: 1.2, letter_spacing_em: -0.005, uppercase: false },
  sectionTitle: { family: "heading", size_px: 20, weight: 600, line_height: 1.3, letter_spacing_em: 0, uppercase: false },
  nodeLabel: { family: "body", size_px: 16, weight: 600, line_height: 1.35, letter_spacing_em: 0, uppercase: false },
  nodeMeta: { family: "body", size_px: 14, weight: 400, line_height: 1.35, letter_spacing_em: 0, uppercase: false },
  technicalIdentifier: { family: "mono", size_px: 14, weight: 400, line_height: 1.4, letter_spacing_em: 0, uppercase: false },
  annotation: { family: "body", size_px: 14, weight: 400, line_height: 1.4, letter_spacing_em: 0, uppercase: false },
  edgeLabel: { family: "body", size_px: 14, weight: 500, line_height: 1.2, letter_spacing_em: 0, uppercase: false },
  eyebrow: { family: "body", size_px: 14, weight: 600, line_height: 1.2, letter_spacing_em: 0.08, uppercase: true },
  metric: { family: "display", size_px: 30, weight: 700, line_height: 1.1, letter_spacing_em: -0.01, uppercase: false },
  caption: { family: "body", size_px: 14, weight: 400, line_height: 1.4, letter_spacing_em: 0, uppercase: false },
  evidence: { family: "mono", size_px: 14, weight: 400, line_height: 1.4, letter_spacing_em: 0, uppercase: false },
} as const;

// ---------------------------------------------------------------------------
// Geometry roles
// ---------------------------------------------------------------------------

export interface VisualGeometryTokens {
  nodeRadius: number;
  groupRadius: number;
  boundaryRadius: number;
  ruleWidth: number;
  connectorWidth: number;
  connectorEmphasisWidth: number;
  focusRingWidth: number;
  nodePaddingX: number;
  nodePaddingY: number;
  minimumNodeGap: number;
  minimumEdgeClearance: number;
  minimumLabelClearance: number;
}

/**
 * Default geometry, in canonical units.
 *
 * §7 is explicit that these are not a straitjacket: a fishbone's ribs and a
 * matrix's cells cannot share one node dimension, and forcing them to would
 * make both worse. What they share is the *minimums* -- the gap below which
 * two nodes read as one, the clearance below which an edge label lands on a
 * line -- because those are readability facts, not house style.
 */
export const DEFAULT_GEOMETRY: VisualGeometryTokens = {
  nodeRadius: 6,
  groupRadius: 10,
  boundaryRadius: 14,
  ruleWidth: 1,
  connectorWidth: 1.5,
  connectorEmphasisWidth: 2.5,
  focusRingWidth: 3,
  nodePaddingX: 16,
  nodePaddingY: 12,
  minimumNodeGap: 24,
  minimumEdgeClearance: 16,
  minimumLabelClearance: 8,
};

// ---------------------------------------------------------------------------
// Motion durations
// ---------------------------------------------------------------------------

export interface VisualMotionTokens {
  short_ms: number;
  standard_ms: number;
  long_ms: number;
}

export const DEFAULT_MOTION: VisualMotionTokens = { short_ms: 140, standard_ms: 260, long_ms: 460 };

// ---------------------------------------------------------------------------
// Font stacks
// ---------------------------------------------------------------------------

export interface VisualFontStacks {
  display: string;
  heading: string;
  body: string;
  mono: string;
}

/**
 * The fallback chains every family ends in.
 *
 * A theme names a face; it never gets to be the only face. §61 forbids
 * shipping a remote font and forbids packaging a third-party binary without a
 * licensing review, so a named face is only ever used if the reader's machine
 * already has it -- which means the stack behind it is what most readers
 * actually see, and it has to be a real design rather than an afterthought.
 */
const SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

const SYSTEM_STACKS: VisualFontStacks = {
  display: SANS,
  heading: SANS,
  body: SANS,
  mono: MONO,
};

// ---------------------------------------------------------------------------
// The resolved token set
// ---------------------------------------------------------------------------

/** How a role's value was arrived at. Recorded per role so a reviewer can see which parts of a rendering the theme actually chose. */
export type TokenProvenance = "theme" | "derived" | "fallback";

export interface VisualDesignTokens {
  id: string;
  /** `light` or `dark`, decided from the resolved `paper` luminance -- never from the theme's name. */
  polarity: "light" | "dark";
  color: Readonly<Record<VisualColorRole, string>>;
  color_provenance: Readonly<Record<VisualColorRole, TokenProvenance>>;
  type: Readonly<Record<VisualTypeRole, VisualTypeToken>>;
  font_stack: VisualFontStacks;
  geometry: VisualGeometryTokens;
  motion: VisualMotionTokens;
}

// ---------------------------------------------------------------------------
// Neutral palettes
// ---------------------------------------------------------------------------

const NEUTRAL_LIGHT: Readonly<Record<VisualColorRole, string>> = {
  paper: "#ffffff",
  surface: "#ffffff",
  surfaceMuted: "#f2f4f6",
  surfaceRaised: "#ffffff",
  surfaceInverse: "#14171a",
  ink: "#14171a",
  inkMuted: "#4a5560",
  inkSubtle: "#6b7480",
  inkInverse: "#ffffff",
  rule: "#c8d0d8",
  ruleStrong: "#7e8b98",
  connector: "#5b6570",
  connectorEmphasis: "#14171a",
  connectorMuted: "#aab4be",
  accent: "#1d4ed8",
  accentMuted: "#dbe4fb",
  positive: "#216e4e",
  warning: "#7f5f01",
  critical: "#ae2e24",
  informational: "#44546f",
  qualified: "#2f6a6a",
  unresolved: "#5e4db2",
  disabled: "#656e79",
  focus: "#1d4ed8",
  selected: "#0b3fa8",
  related: "#3f6212",
  dimmed: "#98a2ac",
  route: "#0055cc",
  added: "#216e4e",
  removed: "#ae2e24",
  changed: "#0055cc",
  rerouted: "#7c4a00",
  governanceBlocking: "#ae2e24",
  governanceReviewRequired: "#a54800",
  governanceAdvisory: "#7f5f01",
  governanceInformational: "#44546f",
};

const NEUTRAL_DARK: Readonly<Record<VisualColorRole, string>> = {
  paper: "#0b0e14",
  surface: "#151a24",
  surfaceMuted: "#1d2430",
  surfaceRaised: "#222a38",
  surfaceInverse: "#f4f6fb",
  ink: "#f4f6fb",
  inkMuted: "#a8b3c6",
  inkSubtle: "#8590a3",
  inkInverse: "#0b0e14",
  rule: "#333c4d",
  ruleStrong: "#687489",
  connector: "#8590a3",
  connectorEmphasis: "#f4f6fb",
  connectorMuted: "#464f60",
  accent: "#7ea6ff",
  accentMuted: "#23324f",
  positive: "#4ec98e",
  warning: "#e0b054",
  critical: "#ff8a80",
  informational: "#9fb0c9",
  qualified: "#5fc8c8",
  unresolved: "#b6a6ff",
  disabled: "#7d8794",
  focus: "#7ea6ff",
  selected: "#a9c4ff",
  related: "#a3d16b",
  dimmed: "#5a6578",
  route: "#7ea6ff",
  added: "#4ec98e",
  removed: "#ff8a80",
  changed: "#7ea6ff",
  rerouted: "#e0b054",
  governanceBlocking: "#ff8a80",
  governanceReviewRequired: "#ffab70",
  governanceAdvisory: "#e0b054",
  governanceInformational: "#9fb0c9",
};

/** The unbranded token set. Used when no design system is selected, and used as the polarity-matched source of every fallback below. */
export const NEUTRAL_VISUAL_TOKENS: VisualDesignTokens = {
  id: "neutral",
  polarity: "light",
  color: NEUTRAL_LIGHT,
  color_provenance: Object.fromEntries(
    VISUAL_COLOR_ROLES.map((role) => [role, "fallback" as TokenProvenance]),
  ) as Record<VisualColorRole, TokenProvenance>,
  type: DEFAULT_TYPE_SCALE,
  font_stack: SYSTEM_STACKS,
  geometry: DEFAULT_GEOMETRY,
  motion: DEFAULT_MOTION,
};

export function neutralTokensFor(polarity: "light" | "dark"): Readonly<Record<VisualColorRole, string>> {
  return polarity === "dark" ? NEUTRAL_DARK : NEUTRAL_LIGHT;
}

// ---------------------------------------------------------------------------
// The adapter: an existing design system in, semantic tokens out
// ---------------------------------------------------------------------------

/**
 * A structural echo of the `DesignTokens` shape @rvs/renderer-html already
 * loads from `design-systems/<id>/tokens.json`.
 *
 * Echoed rather than imported for the same reason `VisualEvidenceRef` is:
 * @rvs/renderer-html sits on thirteen intelligence packages, and importing it
 * here would invert the layering and drag every one of them into the
 * zero-dependency package. Every field is optional because a profile written
 * against an older schema must degrade to a stated fallback rather than
 * throw. §9.
 */
export interface ExistingDesignSystem {
  name?: string;
  version?: string;
  colors?: {
    background?: string;
    surface?: string;
    text_primary?: string;
    text_secondary?: string;
    accent?: string;
    border?: string;
    success?: string;
    warning?: string;
  };
  typography?: { display?: string; heading?: string; body?: string; code?: string };
  spacing?: { unit?: number };
  motion?: { fast?: number; normal?: number; slow?: number };
}

export type VisualThemeCode = "VISUAL_THEME_TOKEN_FALLBACK" | "VISUAL_THEME_VALUE_INVALID";

export const VISUAL_THEME_CODES: readonly VisualThemeCode[] = [
  "VISUAL_THEME_TOKEN_FALLBACK",
  "VISUAL_THEME_VALUE_INVALID",
] as const;

export type VisualThemeFinding = VisualFinding<VisualThemeCode>;

export interface ResolvedVisualTheme {
  tokens: VisualDesignTokens;
  findings: VisualThemeFinding[];
}

/** Which source colour, if any, a role is taken from verbatim. */
const THEME_SOURCED: Readonly<Partial<Record<VisualColorRole, keyof NonNullable<ExistingDesignSystem["colors"]>>>> = {
  paper: "background",
  surface: "surface",
  ink: "text_primary",
  inkMuted: "text_secondary",
  rule: "border",
  accent: "accent",
  positive: "success",
  warning: "warning",
};

/**
 * One font family name, unquoted.
 *
 * A whitelist rather than a blacklist, and the difference is the whole point.
 * A blacklist of `url(`, `javascript:`, `expression(` and `</style>` is a list
 * of the injections somebody thought of; this pattern admits letters, digits,
 * spaces, hyphens and underscores and nothing else, so there is no quote to
 * close, no semicolon to end a declaration with, no parenthesis to open a
 * function with, and no angle bracket to leave the stylesheet through. §60.
 */
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

const MAX_STACK_ITEMS = 8;

/**
 * Parses a font stack into its family names, or returns undefined.
 *
 * A design system declares a whole stack -- `'Fraunces', Georgia, serif` --
 * not a single name, so validating a bare name would reject all three
 * checked-in profiles. The parse admits a comma-separated list of quoted or
 * unquoted plain names and nothing else.
 *
 * What makes this safe is not the parse but what happens after it: the
 * original string is *discarded*. `serializeFontStack` re-emits the value from
 * the parsed names, quoting each one itself. A sanitiser that forwards the
 * input it approved is one clever escape away from forwarding an injection;
 * a parser that rebuilds its output from a name list cannot forward anything
 * it did not itself construct.
 */
export function parseFontStack(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value.split(",").map((item) => item.trim());
  if (items.length === 0 || items.length > MAX_STACK_ITEMS) return undefined;
  const names: string[] = [];
  for (const item of items) {
    const unquoted =
      (item.startsWith("'") && item.endsWith("'")) || (item.startsWith('"') && item.endsWith('"'))
        ? item.slice(1, -1)
        : item;
    if (!FONT_NAME.test(unquoted.trim())) return undefined;
    names.push(unquoted.trim());
  }
  return names;
}

/** Re-emits a parsed stack. Multi-word names are quoted; nothing else is ever emitted. */
export function serializeFontStack(names: readonly string[]): string {
  return names.map((name) => (name.includes(" ") ? JSON.stringify(name) : name)).join(", ");
}

/**
 * Validates one theme colour.
 *
 * Structural, for the same reason: `parseColor` accepts `#rgb`, `#rrggbb`,
 * `#rrggbbaa` and `rgb()/rgba()` and rejects everything else, so a value that
 * survives is a colour and cannot also be a CSS declaration. A theme value is
 * never interpreted as raw CSS anywhere in this system.
 */
export function isSafeThemeColor(value: unknown): value is string {
  return typeof value === "string" && parseColor(value) !== undefined;
}

export function isSafeFontStack(value: unknown): value is string {
  return parseFontStack(value) !== undefined;
}

/** Whether a number is a usable duration: finite, non-negative, and short enough that a reader is not left waiting. */
export function isSafeDurationMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2000;
}

function themeFinding(code: VisualThemeCode, subject: string, message: string): VisualThemeFinding {
  // Neither theme code is blocking. A theme that cannot supply a `critical`
  // colour is a theme with a gap, not a build that must fail: the fallback is
  // stated, deterministic, and contrast-checked, and refusing to render would
  // punish the reader for the designer's omission.
  return buildFinding(code, subject, message, false);
}

export interface ResolveThemeInput {
  /** The profile id, used for token ids and CSS scoping. */
  id?: string;
  source?: ExistingDesignSystem;
  /** Overrides the polarity that would be read from `paper`. Only for callers that already know (a dark-mode block in a stylesheet, say). */
  polarity?: "light" | "dark";
  /**
   * The contrast the derivation backs off to. Defaults to AA's 4.5/3.0, which
   * is `quality.minimum_contrast`'s own default in @rvs/core -- passed in
   * rather than read, because this package has no dependencies and no business
   * loading a config file.
   */
  contrast_floor?: { text: number; non_text: number };
}

/**
 * Resolves an existing design system into the semantic token set.
 *
 * Three provenances, and the distinction is what a reviewer needs:
 *
 *   theme     the profile said so.
 *   derived   computed from what the profile said, by a rule stated in this
 *             file -- `connector` is the theme's own rule colour pulled 55%
 *             toward its own ink, so a theme that is warm stays warm.
 *   fallback  the profile has no opinion. The value comes from the neutral
 *             palette matching the theme's *polarity*, so a dark theme never
 *             receives a colour chosen to sit on white.
 *
 * §10's rule is that a missing token is filled deterministically and reported
 * -- never substituted with an unrelated semantic. That is why `added` does
 * not quietly become the theme's `success`: adding a component is not good
 * news, and a reviewer who saw green would read an approval into a fact.
 */
export function resolveVisualDesignTokens(input: ResolveThemeInput = {}): ResolvedVisualTheme {
  const id = input.id ?? "neutral";
  const source = input.source ?? {};
  const floor = input.contrast_floor ?? { text: 4.5, non_text: 3 };
  const findings: VisualThemeFinding[] = [];

  const accepted: Partial<Record<VisualColorRole, string>> = {};
  for (const role of VISUAL_COLOR_ROLES) {
    const key = THEME_SOURCED[role];
    if (key === undefined) continue;
    const raw = source.colors?.[key];
    if (raw === undefined) continue;
    if (!isSafeThemeColor(raw)) {
      findings.push(
        themeFinding(
          "VISUAL_THEME_VALUE_INVALID",
          `${id}.colors.${key}`,
          `Theme "${id}" declares colors.${key} as ${JSON.stringify(raw)}, which is not a colour this system will read. ` +
            `Accepted forms are #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(); the value was discarded and role "${role}" fell back.`,
        ),
      );
      continue;
    }
    accepted[role] = raw.trim();
  }

  const paper = accepted.paper ?? accepted.surface;
  const polarity: "light" | "dark" =
    input.polarity ?? (paper !== undefined && !isLight(parseColor(paper) ?? { r: 255, g: 255, b: 255 }) ? "dark" : "light");
  const neutral = neutralTokensFor(polarity);

  const color: Partial<Record<VisualColorRole, string>> = {};
  const provenance: Partial<Record<VisualColorRole, TokenProvenance>> = {};

  /**
   * Mixes `from` toward `toward`, backing off until the result still clears
   * the contrast its role owes the ground it will be drawn on.
   *
   * Without this, a derived role can fail a check its own theme would have
   * passed -- `inkSubtle` at a flat 30% toward the surface lands at 2.86:1 on
   * editorial-light, which is a defect this file introduced, not one the
   * profile has. Backing off in fixed 5% steps keeps the derivation
   * deterministic while making it impossible for a *derived* value to be the
   * thing that fails: after this, every contrast finding names either a colour
   * the theme chose or a gap the theme left, which is the only kind of finding
   * a theme author can act on.
   */
  const deriveWithFloor = (from: string, toward: string, t: number, role: VisualColorRole): string | undefined => {
    const tier = COLOR_ROLE_CONTRAST_TIER[role];
    if (tier === "decoration") return mixHex(from, toward, t);
    const required = tier === "text" ? floor.text : floor.non_text;
    const grounds = [accepted.surface ?? neutral.surface, accepted.paper ?? neutral.paper];
    let step = Math.round(t * 20);
    while (step >= 0) {
      const candidate = mixHex(from, toward, step / 20);
      if (candidate === undefined) return undefined;
      const worst = Math.min(...grounds.map((ground) => contrastBetween(candidate, ground) ?? 0));
      if (worst >= required) return candidate;
      step -= 1;
    }
    return from;
  };

  const put = (role: VisualColorRole, value: string | undefined, how: TokenProvenance): void => {
    if (value === undefined) {
      color[role] = neutral[role];
      provenance[role] = "fallback";
      return;
    }
    color[role] = value;
    provenance[role] = how;
  };

  // 1. Roles the profile states.
  for (const role of ["paper", "surface", "ink", "inkMuted", "rule", "accent", "positive", "warning"] as const) {
    put(role, accepted[role], "theme");
  }

  const ground = color.surface as string;
  const back = color.paper as string;
  const ink = color.ink as string;
  const inkMuted = color.inkMuted as string;
  const rule = color.rule as string;
  const accent = color.accent as string;

  // 2. Roles derived from those, so a theme's warmth or coolness carries into
  //    its structure rather than being replaced by a neutral grey.
  put("surfaceMuted", mixHex(ground, ink, 0.06), "derived");
  put("surfaceRaised", polarity === "dark" ? mixHex(ground, ink, 0.07) : ground, "derived");
  put("surfaceInverse", ink, "derived");
  put("inkSubtle", deriveWithFloor(inkMuted, ground, 0.3, "inkSubtle"), "derived");
  put("inkInverse", back, "derived");
  put("ruleStrong", deriveWithFloor(rule, ink, 0.45, "ruleStrong"), "derived");
  put("connector", deriveWithFloor(rule, ink, 0.55, "connector"), "derived");
  put("connectorEmphasis", ink, "derived");
  put("connectorMuted", mixHex(rule, ground, 0.45), "derived");
  put("accentMuted", mixHex(accent, ground, 0.78), "derived");
  put("focus", deriveWithFloor(accent, ink, 0, "focus"), "derived");
  put("selected", deriveWithFloor(accent, ink, 0.3, "selected"), "derived");
  put("route", deriveWithFloor(accent, ink, 0, "route"), "derived");
  put("dimmed", mixHex(ink, ground, 0.72), "derived");

  // 3. Everything else. A design system carries no opinion about what
  //    "governance review required" or "causally unresolved" looks like,
  //    because no design system was ever asked to have one.
  for (const role of VISUAL_COLOR_ROLES) {
    if (color[role] !== undefined) continue;
    color[role] = neutral[role];
    provenance[role] = "fallback";
    findings.push(
      themeFinding(
        "VISUAL_THEME_TOKEN_FALLBACK",
        `${id}.color.${role}`,
        `Theme "${id}" declares no value for semantic role "${role}". ` +
          `The ${polarity} neutral value ${neutral[role]} was used. This is a stated fallback, not a substitution: ` +
          `no other role's colour was reused for it.`,
      ),
    );
  }

  return {
    tokens: {
      id,
      polarity,
      color: color as Record<VisualColorRole, string>,
      color_provenance: provenance as Record<VisualColorRole, TokenProvenance>,
      type: resolveTypeScale(),
      font_stack: resolveFontStacks(id, source, findings),
      geometry: DEFAULT_GEOMETRY,
      motion: resolveMotion(id, source, findings),
    },
    findings: sortFindings(findings),
  };
}

/**
 * The type scale is the token system's, not the theme's.
 *
 * A design system says which *faces* to set type in; it does not get to say
 * how small type may be, because the floor is an accessibility contract and a
 * theme cannot opt out of one. Sizes therefore never come from the profile.
 */
function resolveTypeScale(): Readonly<Record<VisualTypeRole, VisualTypeToken>> {
  return DEFAULT_TYPE_SCALE;
}

function resolveFontStacks(
  id: string,
  source: ExistingDesignSystem,
  findings: VisualThemeFinding[],
): VisualFontStacks {
  const pick = (
    family: keyof VisualFontStacks,
    key: keyof NonNullable<ExistingDesignSystem["typography"]>,
    base: string,
  ): string => {
    const raw = source.typography?.[key];
    if (raw === undefined) return base;
    const names = parseFontStack(raw);
    if (names === undefined) {
      findings.push(
        themeFinding(
          "VISUAL_THEME_VALUE_INVALID",
          `${id}.typography.${key}`,
          `Theme "${id}" declares typography.${key} as ${JSON.stringify(raw)}, which is not a font stack. ` +
            `A stack is up to ${MAX_STACK_ITEMS} comma-separated family names, each made of letters, digits, spaces, ` +
            `hyphens and underscores; the value was discarded and the ${family} family fell back to the system stack.`,
        ),
      );
      return base;
    }
    // The theme's faces are offered first and the system stack always follows
    // them. Nothing fetches a face: if the reader's machine does not have it,
    // the stack behind it renders, which is why that stack is a real design.
    return `${serializeFontStack(names)}, ${base}`;
  };
  return {
    display: pick("display", "display", SANS),
    heading: pick("heading", "heading", SANS),
    body: pick("body", "body", SANS),
    mono: pick("mono", "code", MONO),
  };
}

function resolveMotion(
  id: string,
  source: ExistingDesignSystem,
  findings: VisualThemeFinding[],
): VisualMotionTokens {
  const pick = (key: "fast" | "normal" | "slow", base: number): number => {
    const raw = source.motion?.[key];
    if (raw === undefined) return base;
    if (!isSafeDurationMs(raw)) {
      findings.push(
        themeFinding(
          "VISUAL_THEME_VALUE_INVALID",
          `${id}.motion.${key}`,
          `Theme "${id}" declares motion.${key} as ${JSON.stringify(raw)}, which is not a duration between 0 and 2000 ms. ` +
            `The value was discarded and ${base}ms was used.`,
        ),
      );
      return base;
    }
    return raw;
  };
  return {
    short_ms: pick("fast", DEFAULT_MOTION.short_ms),
    standard_ms: pick("normal", DEFAULT_MOTION.standard_ms),
    long_ms: pick("slow", DEFAULT_MOTION.long_ms),
  };
}
