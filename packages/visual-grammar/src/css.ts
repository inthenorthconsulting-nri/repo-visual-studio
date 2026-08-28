// Milestone 10.5.2 -- the one stylesheet.
//
// Before this file there were two hand-written stylesheets, one in
// @rvs/visual-explorer and one in @rvs/visual-change-review, and they
// disagreed. The explorer had no change palette at all; the review declared
// `--rvs-added: #0f7b46`, while the grammar renderers drew added things in
// `#216e4e`. Three renderings of the same fact, three greens, and no way for
// a reviewer to know which one the theme intended -- exactly the independently
// invented visual behaviour §1 is written against.
//
// So the stylesheet is GENERATED from resolved tokens. There is one palette,
// one focus treatment, one dimming rule, one set of state channels, and it is
// the same object the SVG renderers paint from.
//
// Security, §59-§60. Every value emitted here has been through
// `resolveVisualDesignTokens`, which parses colours structurally and rebuilds
// font stacks from a parsed name list rather than forwarding the string it
// approved. `cssValue` below is a second, independent gate: a token value that
// somehow still contains a character that could close a declaration is dropped
// rather than escaped, because a value that needs escaping to be safe in CSS
// is not a colour. Nothing here interpolates user text into a selector, and
// nothing interprets a token value as raw CSS.

import type { VisualDesignTokens } from "@rvs/visual-intelligence";
import { VISUAL_COLOR_ROLES, VISUAL_TYPE_ROLES } from "@rvs/visual-intelligence";

/**
 * Characters that can end a declaration, open a block, start a comment, or
 * begin a URL or function call. A legitimate colour, length, or font stack
 * needs none of them beyond the comma and quote a stack already survived.
 */
const UNSAFE_CSS = /[;{}()<>\\@]|\/\*|:\s*url/i;

/** Emit a token value, or nothing. Never escapes: a value needing escapes is rejected outright. */
function cssValue(value: string): string | undefined {
  return UNSAFE_CSS.test(value) ? undefined : value;
}

function customProperties(tokens: VisualDesignTokens): string {
  const lines: string[] = [];
  for (const role of VISUAL_COLOR_ROLES) {
    const value = cssValue(tokens.color[role]);
    if (value) lines.push(`  --rvs-color-${kebab(role)}: ${value};`);
  }
  for (const role of VISUAL_TYPE_ROLES) {
    const token = tokens.type[role];
    lines.push(`  --rvs-size-${kebab(role)}: ${token.size_px}px;`);
    lines.push(`  --rvs-weight-${kebab(role)}: ${token.weight};`);
  }
  for (const [name, stack] of Object.entries(tokens.font_stack)) {
    const value = cssValue(stack);
    if (value) lines.push(`  --rvs-font-${name}: ${value};`);
  }
  for (const [name, size] of Object.entries(tokens.geometry)) {
    lines.push(`  --rvs-geo-${kebab(name)}: ${size}px;`);
  }
  for (const [name, ms] of Object.entries(tokens.motion)) {
    lines.push(`  --rvs-motion-${kebab(name.replace(/_ms$/, ""))}: ${ms}ms;`);
  }
  return lines.join("\n");
}

function kebab(value: string): string {
  return value.replace(/_/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * The rules every RVS interactive artifact shares.
 *
 * Written once, in terms of the custom properties above. Nothing below names
 * a colour, a size, or a duration literally -- if it did, it would be a fourth
 * palette.
 *
 * Two rules here carry accessibility contracts rather than taste:
 *
 * `:focus-visible` draws an outline with an offset, so the ring is never
 * clipped by the shape it surrounds (§24), and it changes the outline's
 * existence rather than only its colour, so it survives greyscale.
 *
 * The `prefers-reduced-motion` block sets `animation: none` and
 * `transition: none` on everything rather than shortening durations. §49 asks
 * for a fallback that delivers the same information at once, and a 20ms
 * animation is still an animation.
 */
const STRUCTURE = String.raw`
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--rvs-color-paper);
  color: var(--rvs-color-ink);
  font-family: var(--rvs-font-body);
  font-size: var(--rvs-size-body-text, 16px);
  line-height: 1.5;
}

h1 { font-family: var(--rvs-font-display); font-size: var(--rvs-size-headline); font-weight: var(--rvs-weight-headline); }
h2 { font-family: var(--rvs-font-heading); font-size: var(--rvs-size-section-title); font-weight: var(--rvs-weight-section-title); }

.rvs-eyebrow { font-size: var(--rvs-size-eyebrow); font-weight: var(--rvs-weight-eyebrow); color: var(--rvs-color-ink-muted); letter-spacing: .06em; text-transform: uppercase; }
.rvs-meta { font-size: var(--rvs-size-node-meta); color: var(--rvs-color-ink-muted); }
.rvs-annotation { font-size: var(--rvs-size-annotation); color: var(--rvs-color-ink-muted); }
.rvs-evidence { font-family: var(--rvs-font-mono); font-size: var(--rvs-size-evidence); }
.rvs-identifier { font-family: var(--rvs-font-mono); font-size: var(--rvs-size-technical-identifier); }

.rvs-panel { background: var(--rvs-color-surface); border: var(--rvs-geo-rule-width) solid var(--rvs-color-rule); border-radius: var(--rvs-geo-group-radius); }

:focus-visible {
  outline: var(--rvs-geo-focus-ring-width) solid var(--rvs-color-focus);
  outline-offset: 2px;
}

[data-rvs-state~="dimmed"] { opacity: .35; }
[data-rvs-state~="disabled"] { opacity: .6; }
[data-rvs-state~="selected"], [data-rvs-state~="focused"] { stroke-width: var(--rvs-geo-connector-emphasis-width); }
[data-rvs-state~="route"] { stroke: var(--rvs-color-route); stroke-width: var(--rvs-geo-connector-emphasis-width); }
[data-rvs-state~="related"] { stroke: var(--rvs-color-related); }
[data-rvs-state~="unresolved"] { stroke-dasharray: 6 4; }
[data-rvs-state~="qualified"] { stroke-dasharray: 1.5 3; }
[data-rvs-state~="removed"] { stroke-dasharray: 6 4; }

.rvs-badge {
  font-size: var(--rvs-size-eyebrow);
  font-weight: var(--rvs-weight-eyebrow);
  border-radius: var(--rvs-geo-node-radius);
  padding: 2px 8px;
  border: var(--rvs-geo-rule-width) solid currentColor;
}
.rvs-badge[data-rvs-severity="blocking"] { color: var(--rvs-color-governance-blocking); }
.rvs-badge[data-rvs-severity="review_required"] { color: var(--rvs-color-governance-review-required); }
.rvs-badge[data-rvs-severity="advisory"] { color: var(--rvs-color-governance-advisory); }
.rvs-badge[data-rvs-severity="informational"] { color: var(--rvs-color-governance-informational); }

.rvs-stand-in {
  border: var(--rvs-geo-connector-width) dashed var(--rvs-color-rule-strong);
  background: var(--rvs-color-surface-muted);
  border-radius: var(--rvs-geo-node-radius);
}

[data-rvs-node], [data-rvs-edge] { transition: opacity var(--rvs-motion-short) ease-out; }

/* The only keyframe in RVS. One iteration, no alternation, no glow. */
@keyframes rvs-emphasis {
  from { opacity: .35; }
  to { opacity: 1; }
}
[data-rvs-motion="emphasis"] { animation: rvs-emphasis var(--rvs-motion-standard) ease-out 1 both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}

@media print {
  [data-rvs-state~="dimmed"] { opacity: 1; }
  .rvs-panel { border-color: var(--rvs-color-ink); }
}
`;

/**
 * The complete stylesheet for a resolved theme.
 *
 * `:root` carries the palette, so a renderer that wants a dark artifact
 * resolves dark tokens and calls this again -- it does not write a second
 * media query with a second set of hexes, which is how the two existing
 * stylesheets came to disagree in the first place.
 */
export function visualStylesheet(tokens: VisualDesignTokens): string {
  return `:root {\n${customProperties(tokens)}\n}\n${STRUCTURE}`;
}

/**
 * Both polarities in one sheet, the dark palette behind a media query.
 *
 * Used for offline single-file artifacts, which have no way to ask the reader
 * afterwards which they wanted.
 */
export function visualStylesheetDualPolarity(light: VisualDesignTokens, dark: VisualDesignTokens): string {
  return [
    `:root {\n${customProperties(light)}\n}`,
    `@media (prefers-color-scheme: dark) {\n:root {\n${customProperties(dark)}\n}\n}`,
    STRUCTURE,
  ].join("\n");
}
