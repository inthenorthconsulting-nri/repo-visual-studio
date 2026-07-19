# Presentation and export (reference)

Use when: any intelligence layer's output needs to become a rendered deck,
a validation report, or a PDF/Markdown export.

**Turning a model into a deck**:

```bash
rvs create slides --design-system executive-dark   # base profile (Milestone 1)
rvs create slides --profile showcase --audience executive     # Product Intelligence
rvs create slides --profile portfolio --audience portfolio    # Portfolio Intelligence
```

`--design-system` picks from `design-systems/index.json`
(`executive-dark` / `editorial-light` / `technical-grid`); `--audience`
picks from `references/audience-profiles.md`. Match both to what the user
actually asked for — don't guess a design system for its aesthetics alone,
match its `best_for` tags.

**Validation** (always run before treating a deck as done):

```bash
rvs validate --ci
```

This checks the rendered `deck.html` for overflow, minimum font size, and
contrast, checks every scene's citations resolve, and — whenever the
relevant cache file is present — also structurally validates
`capability-model.json`, `product-identity-model.json`/`showcase-plan.json`,
and `portfolio-model.json`/portfolio claims/`portfolio-plan.json`. `--ci`
exits non-zero on any blocking failure across all of the above; see
`references/quality-policy.md` for exactly what each `.rvs/config.yml`
`quality.*` flag gates.

If validation fails, fix it by adjusting the content input (shorter brief
text, fewer bullets, a stronger evidence citation) — never by hand-editing
`deck.html`, which is regenerated on the next `create slides` run and would
silently lose the fix.

**Export**:

```bash
rvs export pdf                     # paginated PDF, one page per scene
rvs export capabilities            # CAPABILITIES.md
rvs export product-identity        # product-identity.json
rvs export showcase-plan           # showcase-plan.json
rvs export portfolio-model|portfolio-claims|portfolio-decisions
```

**Troubleshooting**: `rvs doctor` checks Node version, `.rvs/config.yml`
presence, and Playwright's Chromium install — run it first if any command
in this file fails unexpectedly.
