# Quality policy

`rvs validate` runs five deterministic checks against every scene in
`deck.html`, using a headless Chromium instance in print mode (the same mode
used for PDF export, so what passes validation is what gets exported).

| Rule | What it checks | Failure condition |
|---|---|---|
| `overflow` | `.scene-inner` content height vs. its clipped box | Content taller than the 1280×720 canvas by more than 2px (a scene that declares no `.scene-inner` is not asked — a surface that scrolls on purpose has no fixed frame to overflow) |
| `node-overlap` | The painted rectangles of `[data-rvs-node]` entities, within one `<svg>` root | Two entity boxes overlapping by more than 2px in both axes. Compared per `<svg>`, because a multi-view composition stacks drawings on one page; zero-sized (hidden) elements are skipped |
| `min-font-size` | The *rendered* size of every visible text node (excluding citations) — the declared size multiplied by the element's screen CTM scale, so SVG text shrunk by a fit transform is measured as the reader sees it | Smaller than `minFontSizePx`, which defaults to `MINIMUM_TEXT_SIZE_PX` from `@rvs/visual-intelligence` (14px) rather than a second literal here |
| `contrast` | WCAG relative-luminance contrast ratio between text color and scene background | Below the threshold for `quality.minimum_contrast` in `.rvs/config.yml` (`AA`: 4.5:1 normal / 3.0:1 large text ≥24px; `AAA`: 7.0:1 / 4.5:1) |
| `missing-evidence` | Whether `headline`, `metric`, and `architecture` scenes carry a `.citations` footer | Warn (not fail) if such a scene has zero evidence citations |

## `.rvs/config.yml` gates (`quality:` block)

- `fail_on_overflow` (default `true`) — when `rvs validate --ci` runs, an
  `overflow` *or* `node-overlap` failure blocks (exit code 1) only if this
  is `true`. Both are layout rules answering the same question — did the
  drawing fit where it was put — so they answer to the same flag.
- `fail_on_missing_evidence` (default `true`) — a `missing-evidence` warning
  blocks under `--ci` only if this is `true`.
- `minimum_contrast` (default `AA`) — sets which WCAG threshold the
  `contrast` check enforces.

`contrast` and `min-font-size` failures always block under `--ci`,
independent of these flags — they are treated as unconditionally required for
a readable deck.

## The interactive artifacts

`rvs validate` also checks two files when they exist, at the default paths
`rvs graph open` and `rvs graph review` write to:
`.rvs/out/architecture-explorer.html` and
`artifacts/visuals/change-review.html`. A repository that has never run
either command sees no change in behaviour.

They face the same checks `deck.html` faces — the same validator, the same
`minimum_contrast`, the same minimum type size — and each is checked
**twice**, once under `prefers-color-scheme: light` and once under `dark`.
The dark palette is not a separate file; it sits behind a media query in the
same stylesheet, so a single run would measure half of what ships, and
contrast is exactly the property that differs between the halves. Reports
are written as `<name>-<light|dark>-validation-report.json`.

An artifact that declares no validatable scene is reported as a warning, not
a pass: a checker that found nothing to check has not cleared the file.

Without `--ci`, `rvs validate` always writes `validation-report.json` and
prints failures/warnings, but never sets a non-zero exit code — useful for
inspecting a report without breaking a local workflow.
