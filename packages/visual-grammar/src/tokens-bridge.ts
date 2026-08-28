// The one adapter from semantic design tokens to the style surface every
// grammar renderer already draws through.
//
// Milestone 10.5's §55 is explicit about ownership: a grammar owns layout
// semantics; the shared layer owns node styling, connectors, focus, states,
// accessibility hooks, token consumption, and motion hooks. `GrammarStyle`
// was written in 10.2 as an injected seam for exactly this moment, so 10.5
// fills the seam rather than widening it -- no renderer changes, and no
// renderer gains the ability to pick a colour.
//
// Two things this deliberately does NOT do.
//
// It does not pass the profile's type sizes through. §6's roles carry the
// sizes, and the smallest of them is an accessibility floor. `NEUTRAL_STYLE`
// currently declares `secondary: 12` and `annotation: 11`, both below the
// 14px minimum @rvs/validator enforces on rendered text -- a real defect that
// predates this milestone, and one this function fixes by construction
// because the token scale has no member below the floor.
//
// It does not invent state colours from the profile's `success`/`warning`.
// `resolveVisualDesignTokens` already decided what a theme is allowed to
// speak for, and re-deriving here would give a renderer a second opinion.

import type { VisualDesignTokens } from "@rvs/visual-intelligence";
import { NEUTRAL_VISUAL_TOKENS } from "@rvs/visual-intelligence";
import type { GrammarStyle } from "./style.js";

/**
 * Project semantic tokens onto the renderer style surface.
 *
 * Every field below is a token lookup. There is no arithmetic, no blending,
 * and no conditional: if a value looks wrong on screen the fix is in the
 * token resolver, where it applies to every grammar at once, rather than in
 * whichever renderer happened to expose it.
 */
export function grammarStyleFromTokens(tokens: VisualDesignTokens = NEUTRAL_VISUAL_TOKENS): GrammarStyle {
  const { color, type, geometry } = tokens;
  return {
    id: tokens.id,
    font_family: tokens.font_stack.body,
    font_size: {
      title: type.headline.size_px,
      label: type.nodeLabel.size_px,
      secondary: type.nodeMeta.size_px,
      annotation: type.annotation.size_px,
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
    radius: { node: geometry.nodeRadius, container: geometry.groupRadius },
    stroke: {
      hairline: geometry.ruleWidth,
      normal: geometry.connectorWidth,
      emphasis: geometry.connectorEmphasisWidth,
    },
    surface: {
      canvas: color.paper,
      node: color.surface,
      container: color.surfaceRaised,
      muted: color.surfaceMuted,
      inverse: color.surfaceInverse,
    },
    ink: {
      primary: color.ink,
      secondary: color.inkMuted,
      muted: color.inkSubtle,
      inverse: color.inkInverse,
    },
    line: {
      normal: color.connector,
      primary: color.connectorEmphasis,
      focal: color.accent,
      muted: color.connectorMuted,
      border: color.rule,
    },
    state: {
      blocking: color.governanceBlocking,
      review_required: color.governanceReviewRequired,
      advisory: color.governanceAdvisory,
      informational: color.governanceInformational,
      unresolved: color.unresolved,
      partial: color.qualified,
      added: color.added,
      removed: color.removed,
      changed: color.changed,
    },
  };
}
