// The explorer's artifact-specific layout rules.
//
// Milestone 10.5 moved everything that is not layout out of this file. The
// palette, the type scale, the focus ring, the state channels, the single
// finite keyframe, the reduced-motion block, and the print rules now come
// from `visualStylesheetDualPolarity` in @rvs/visual-grammar, generated from
// resolved semantic design tokens.
//
// This mattered because the two hand-written stylesheets had drifted. The
// explorer declared `--rvs-accent: #1d4ed8` and no change palette at all;
// @rvs/visual-change-review declared `--rvs-added: #0f7b46` while the SVG
// renderers drew added entities in `#216e4e`. Three files, three answers to
// "what colour is an added component", and nothing that could tell a reviewer
// which one the theme meant. §1 calls that visual behaviour being
// independently invented by renderers, and deleting it is most of the point
// of this milestone.
//
// What is left here is genuinely the explorer's own: a three-column grid, the
// results list, the inspector's definition lists, and the fidelity table.

import { resolveVisualDesignTokens, type VisualDesignTokens } from "@rvs/visual-intelligence";
import { visualStylesheet, visualStylesheetDualPolarity } from "@rvs/visual-grammar";

const LAYOUT = String.raw`
/* Compatibility aliases.
   These names predate the semantic token layer and are used throughout the
   layout rules below. They now resolve to tokens rather than to hexes of
   their own, which is the whole point: there is one palette, and this file
   no longer holds a second opinion about it. */
:root {
  color-scheme: light dark;
  --rvs-ink: var(--rvs-color-ink);
  --rvs-ink-muted: var(--rvs-color-ink-muted);
  --rvs-surface: var(--rvs-color-paper);
  --rvs-panel: var(--rvs-color-surface-muted);
  --rvs-line: var(--rvs-color-rule);
  --rvs-accent: var(--rvs-color-accent);
}


/* Type sizes come from the token scale, never from a literal here.

   Every rule below used to name its own rem value, and the smallest of them
   -- 0.8rem for a control label, 0.875rem for the status line -- rendered at
   12.8px and 14px against a 14px floor @rvs/validator enforces on every
   rendered surface. The page therefore shipped text the project's own checker
   would have failed, and nothing caught it because the checker had never been
   pointed at this artifact. §6 gives the roles their sizes and §32 keeps one
   source of truth for the minimum; using the role variables makes both true
   by construction rather than by remembering. */
h3 { font-size: var(--rvs-size-node-label); margin: 0 0 0.25rem; }
h4 { font-size: var(--rvs-size-node-meta); margin: 0.75rem 0 0.25rem; }
.rvs-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--rvs-line); }
.rvs-caption, .rvs-counts { margin: 0.15rem 0; color: var(--rvs-ink-muted); font-size: var(--rvs-size-caption); }
.rvs-layout {
  display: grid;
  grid-template-columns: minmax(220px, 20rem) minmax(0, 1fr) minmax(220px, 22rem);
  gap: 1rem;
  padding: 1rem 1.25rem;
  align-items: start;
}
@media (max-width: 60rem) { .rvs-layout { grid-template-columns: 1fr; } }
.rvs-controls, .rvs-inspector, .rvs-fidelity, .rvs-help {
  background: var(--rvs-panel);
  border: 1px solid var(--rvs-line);
  border-radius: 8px;
  padding: 0.75rem 0.9rem;
}
.rvs-fidelity, .rvs-help { margin: 0 1.25rem 1.25rem; }
label { display: block; font-size: var(--rvs-size-node-meta); font-weight: 600; margin: 0.6rem 0 0.2rem; }
input, select, button {
  font: inherit;
  color: inherit;
  background: var(--rvs-surface);
  border: 1px solid var(--rvs-line);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  width: 100%;
}
button { cursor: pointer; text-align: left; }
.rvs-results { list-style: none; margin: 0.4rem 0 0; padding: 0; max-height: 16rem; overflow-y: auto; }
.rvs-results li { margin: 0 0 0.25rem; }
.rvs-empty { color: var(--rvs-ink-muted); font-size: var(--rvs-size-caption); }
.rvs-status { margin: 0.75rem 0 0; font-size: var(--rvs-size-caption); color: var(--rvs-ink-muted); }
.rvs-stage { overflow-x: auto; }
.rvs-stage svg { max-width: none; display: block; }
.rvs-detail { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed var(--rvs-line); }
.rvs-inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; margin: 0.5rem 0 0; }
.rvs-inspector dt { font-size: var(--rvs-size-node-meta); color: var(--rvs-ink-muted); }
.rvs-inspector dd { margin: 0; font-size: var(--rvs-size-node-meta); word-break: break-word; }
.rvs-inspector ul { margin: 0.25rem 0 0; padding-left: 1.1rem; font-size: var(--rvs-size-node-meta); }
.rvs-fidelity table { border-collapse: collapse; width: 100%; font-size: var(--rvs-size-caption); }
.rvs-fidelity th, .rvs-fidelity td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--rvs-line); }
.rvs-help dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; }
.rvs-help dt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* Interaction states.
   rvs-muted lowers opacity *and* desaturates, so the distinction survives
   greyscale printing and colour-vision differences alike. Nothing is set to
   display:none: a de-emphasised entity is still in the document, still
   found by search, and still read aloud. */
.rvs-muted { opacity: 0.28; filter: saturate(0.2); }
.rvs-reached { opacity: 1; }
.rvs-focus rect { stroke-width: 4; }
.rvs-route { stroke-width: 4; stroke-dasharray: none; }
`;

/**
 * The explorer stylesheet for a resolved theme.
 *
 * Passing a single token set produces a stylesheet fixed to that theme --
 * which is what a caller applying an executive brand profile wants. Passing
 * nothing produces the neutral palette in both polarities, following the
 * reader's system preference.
 */
export function explorerStylesheet(tokens?: VisualDesignTokens): string {
  const base = tokens
    ? visualStylesheet(tokens)
    : visualStylesheetDualPolarity(
        resolveVisualDesignTokens({ id: "rvs-neutral-light", polarity: "light" }).tokens,
        resolveVisualDesignTokens({ id: "rvs-neutral-dark", polarity: "dark" }).tokens,
      );
  return `${base}\n${LAYOUT}`;
}

/** The default explorer stylesheet: neutral tokens, both polarities. */
export const EXPLORER_STYLES = explorerStylesheet();
