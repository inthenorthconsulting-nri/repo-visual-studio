// The style surface a grammar renderer draws through.
//
// Deliberately an *injected* contract rather than hard-coded values. Every
// colour, size, and stroke a renderer uses arrives through this interface, so
// there is exactly one place a theme can be substituted and no place a
// renderer can invent a colour of its own.
//
// Milestone 10.5 introduces the semantic design-token system and will supply
// a `GrammarStyle` derived from it. Until then `NEUTRAL_STYLE` below is the
// default: an unbranded, high-contrast palette. Keeping the seam here from
// the start is what stops 10.5 from becoming a rewrite of every renderer.
//
// The role names are semantic, never literal. There is no `blue` or `red`
// field, because a renderer choosing "red" is a renderer deciding what is
// alarming -- a judgement that belongs to upstream severity, not to drawing.

export interface GrammarStyle {
  id: string;
  font_family: string;
  font_size: { title: number; label: number; secondary: number; annotation: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { node: number; container: number };
  stroke: { hairline: number; normal: number; emphasis: number };
  /** Fills. */
  surface: { canvas: string; node: string; container: string; muted: string; inverse: string };
  /** Text colours. */
  ink: { primary: string; secondary: string; muted: string; inverse: string };
  /** Edge and border colours, by the emphasis the model assigned. */
  line: { normal: string; primary: string; focal: string; muted: string; border: string };
  /**
   * Colours for states upstream established. A renderer maps a state to a
   * role here; it never decides that a state *has* a colour meaning.
   */
  state: {
    blocking: string;
    review_required: string;
    advisory: string;
    informational: string;
    unresolved: string;
    partial: string;
    added: string;
    removed: string;
    changed: string;
  };
}

/**
 * The default unbranded palette.
 *
 * Chosen so every text/background pairing a renderer can produce clears
 * WCAG AA (4.5:1) against the surface it sits on -- Milestone 10.5's
 * `VISUAL_A11Y_*` checks assert this rather than trusting the comment.
 * Greys carry structure and the state hues carry meaning, so a diagram
 * printed in greyscale still reads as a diagram.
 */
export const NEUTRAL_STYLE: GrammarStyle = {
  id: "rvs-neutral-v1",
  font_family: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  font_size: { title: 28, label: 14, secondary: 12, annotation: 11 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
  radius: { node: 6, container: 10 },
  stroke: { hairline: 1, normal: 1.5, emphasis: 2.5 },
  surface: {
    canvas: "#ffffff",
    node: "#f4f5f7",
    container: "#fbfbfc",
    muted: "#eeeff2",
    inverse: "#1d2125",
  },
  ink: {
    primary: "#1d2125",
    secondary: "#44546f",
    muted: "#626f86",
    inverse: "#ffffff",
  },
  line: {
    normal: "#8590a2",
    primary: "#1d2125",
    focal: "#0055cc",
    muted: "#c1c7d0",
    border: "#b3b9c4",
  },
  state: {
    blocking: "#ae2e24",
    review_required: "#a54800",
    advisory: "#7f5f01",
    informational: "#44546f",
    unresolved: "#5e4db2",
    partial: "#7f5f01",
    added: "#216e4e",
    removed: "#ae2e24",
    changed: "#0055cc",
  },
};
