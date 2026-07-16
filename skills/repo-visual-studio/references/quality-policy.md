# Quality policy

`rvs validate` runs four deterministic checks against every scene in
`deck.html`, using a headless Chromium instance in print mode (the same mode
used for PDF export, so what passes validation is what gets exported).

| Rule | What it checks | Failure condition |
|---|---|---|
| `overflow` | `.scene-inner` content height vs. its clipped box | Content taller than the 1280×720 canvas by more than 2px |
| `min-font-size` | Computed font size of every visible text node (excluding citations) | Smaller than `minFontSizePx` (default 14px) |
| `contrast` | WCAG relative-luminance contrast ratio between text color and scene background | Below the threshold for `quality.minimum_contrast` in `.rvs/config.yml` (`AA`: 4.5:1 normal / 3.0:1 large text ≥24px; `AAA`: 7.0:1 / 4.5:1) |
| `missing-evidence` | Whether `headline`, `metric`, and `architecture` scenes carry a `.citations` footer | Warn (not fail) if such a scene has zero evidence citations |

## `.rvs/config.yml` gates (`quality:` block)

- `fail_on_overflow` (default `true`) — when `rvs validate --ci` runs, an
  `overflow` failure blocks (exit code 1) only if this is `true`.
- `fail_on_missing_evidence` (default `true`) — a `missing-evidence` warning
  blocks under `--ci` only if this is `true`.
- `minimum_contrast` (default `AA`) — sets which WCAG threshold the
  `contrast` check enforces.

`contrast` and `min-font-size` failures always block under `--ci`,
independent of these flags — they are treated as unconditionally required for
a readable deck.

Without `--ci`, `rvs validate` always writes `validation-report.json` and
prints failures/warnings, but never sets a non-zero exit code — useful for
inspecting a report without breaking a local workflow.
