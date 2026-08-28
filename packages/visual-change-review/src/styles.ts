// The change review's artifact-specific layout rules.
//
// Milestone 10.5 moved the palette, the type scale, the focus ring, the state
// channels, the single finite keyframe, and the reduced-motion block into the
// shared token-generated stylesheet in @rvs/visual-grammar. Before that, this
// file declared `--rvs-added: #0f7b46` while @rvs/visual-explorer declared no
// change palette at all and the SVG renderers drew added entities in
// `#216e4e` -- three files disagreeing about the colour of one fact.
//
// The rules that remain are the ones only a Before/Delta/After review needs,
// and the three principles they encode are unchanged:
//
// Nothing is conveyed by colour alone. Every change type carries a glyph and a
// spelled-out word next to its colour; every route kind carries a distinct
// line treatment (solid, dashed, dotted) and a legend entry naming it.
//
// Motion is finite, semantic, and reduced on request. The compare sweep now
// rides the shared one-shot keyframe, timed from the theme's motion token.
//
// And absence is drawn. A missing counterpart gets an explicit empty slot with
// the words "not present" in it, rather than a gap the reader has to notice.

import { resolveVisualDesignTokens, type VisualDesignTokens } from "@rvs/visual-intelligence";
import { visualStylesheet, visualStylesheetDualPolarity } from "@rvs/visual-grammar";

const LAYOUT = String.raw`
/* Compatibility aliases.
   These names predate the semantic token layer. They now resolve to tokens,
   which is what makes the change palette agree with the SVG renderers for the
   first time: this file used to declare --rvs-added: #0f7b46 while the
   grammar renderers drew added entities in #216e4e. */
:root {
  color-scheme: light dark;
  --rvs-ink: var(--rvs-color-ink);
  --rvs-ink-muted: var(--rvs-color-ink-muted);
  --rvs-surface: var(--rvs-color-paper);
  --rvs-panel: var(--rvs-color-surface-muted);
  --rvs-line: var(--rvs-color-rule);
  --rvs-accent: var(--rvs-color-accent);
  --rvs-added: var(--rvs-color-added);
  --rvs-removed: var(--rvs-color-removed);
  --rvs-changed: var(--rvs-color-changed);
  --rvs-unresolved: var(--rvs-color-unresolved);
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
  grid-template-columns: minmax(220px, 20rem) minmax(0, 1fr) minmax(220px, 24rem);
  gap: 1rem;
  padding: 1rem 1.25rem;
  align-items: start;
}
@media (max-width: 64rem) { .rvs-layout { grid-template-columns: 1fr; } }
.rvs-controls, .rvs-inspector, .rvs-fidelity, .rvs-help, .rvs-legend, .rvs-notice {
  background: var(--rvs-panel);
  border: 1px solid var(--rvs-line);
  border-radius: 8px;
  padding: 0.75rem 0.9rem;
}
.rvs-fidelity, .rvs-help, .rvs-notice { margin: 0 1.25rem 1.25rem; }
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
.rvs-results { list-style: none; margin: 0.4rem 0 0; padding: 0; max-height: 18rem; overflow-y: auto; }
.rvs-results li { margin: 0 0 0.25rem; }
.rvs-empty { color: var(--rvs-ink-muted); font-size: var(--rvs-size-caption); }
.rvs-status { margin: 0.75rem 0 0; font-size: var(--rvs-size-caption); color: var(--rvs-ink-muted); }
.rvs-stage { overflow-x: auto; }
.rvs-stage svg { max-width: none; display: block; }
.rvs-detail { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed var(--rvs-line); }
.rvs-inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; margin: 0.5rem 0 0; }
.rvs-inspector dt { font-size: var(--rvs-size-node-meta); color: var(--rvs-ink-muted); }
.rvs-inspector dd { margin: 0; font-size: var(--rvs-size-node-meta); word-break: break-word; }
.rvs-inspector ul, .rvs-legend ul { margin: 0.25rem 0 0; padding-left: 1.1rem; font-size: var(--rvs-size-node-meta); }
.rvs-fidelity table { border-collapse: collapse; width: 100%; font-size: var(--rvs-size-caption); }
.rvs-fidelity th, .rvs-fidelity td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--rvs-line); }
.rvs-help dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; }
.rvs-help dt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* Change types.
   Colour is the third signal, never the first. The glyph and the word both
   say the same thing, so the distinction survives greyscale and colour-vision
   differences without the reader having to consult a key. */
.rvs-change { display: inline-flex; align-items: baseline; gap: 0.35rem; font-size: var(--rvs-size-node-meta); }
.rvs-change-glyph { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; }
.rvs-change[data-change="added"] { color: var(--rvs-added); }
.rvs-change[data-change="removed"] { color: var(--rvs-removed); }
.rvs-change[data-change="modified"], .rvs-change[data-change="rerouted"],
.rvs-change[data-change="regressed"], .rvs-change[data-change="qualified"] { color: var(--rvs-changed); }
.rvs-change[data-change="resolved"] { color: var(--rvs-added); }
.rvs-change[data-change="unresolved"] { color: var(--rvs-unresolved); }

/* An absent counterpart is drawn, not omitted.
   A gap where a box would be is indistinguishable from a box the reader has
   not scrolled to; a slot reading "not present in the baseline" is not. */
.rvs-absent {
  border: 1px dashed var(--rvs-line);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  color: var(--rvs-ink-muted);
  font-size: var(--rvs-size-node-meta);
  font-style: italic;
}

/* Route kinds. Line treatment first, colour second, legend always.
   The difference between "upstream traced this route" and "these two things
   cite the same file" is the difference between a cause and a coincidence,
   and a reviewer acts on it. */
[data-rvs-route="confirmed"] { stroke-dasharray: none; stroke-width: 4; }
[data-rvs-route="related"] { stroke-dasharray: 8 4; stroke-width: 3; }
[data-rvs-route="unresolved"] { stroke-dasharray: 2 5; stroke-width: 3; }
.rvs-legend li { margin-bottom: 0.2rem; }

/* Interaction states.
   rvs-muted lowers opacity *and* desaturates, so the distinction survives
   greyscale printing and colour-vision differences alike. Nothing is set to
   display:none: a de-emphasised entity is still in the document, still found
   by search, and still read aloud. */
.rvs-muted { opacity: 0.28; filter: saturate(0.2); }
.rvs-focus rect { stroke-width: 4; }
.rvs-route { stroke-width: 4; }



/* The compare sweep.
   It used to declare its own 420ms keyframe here; it now rides the single
   single rvs-emphasis keyframe the shared stylesheet publishes, timed from the
   theme's standard motion token. One keyframe exists in RVS, it runs once,
   and the shared prefers-reduced-motion block removes it. */
`;

/** The change-review stylesheet for a resolved theme; neutral in both polarities when none is given. */
export function reviewStylesheet(tokens?: VisualDesignTokens): string {
  const base = tokens
    ? visualStylesheet(tokens)
    : visualStylesheetDualPolarity(
        resolveVisualDesignTokens({ id: "rvs-neutral-light", polarity: "light" }).tokens,
        resolveVisualDesignTokens({ id: "rvs-neutral-dark", polarity: "dark" }).tokens,
      );
  return `${base}\n${LAYOUT}`;
}

/** The default change-review stylesheet: neutral tokens, both polarities. */
export const REVIEW_STYLES = reviewStylesheet();
