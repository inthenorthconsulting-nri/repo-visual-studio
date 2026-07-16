---
name: repo-visual-studio
version: 1.0.0
description: Turn a Git repository into an evidence-traceable HTML slide deck and PDF export using the `rvs` CLI. Use when the user wants a presentation, architecture deck, or executive summary generated from a real codebase rather than hand-written.
---

# Repo Visual Studio (Milestone 1: HTML Slide MVP)

This skill wraps the `rvs` CLI, which inspects a Git repository and produces a
standalone HTML slide deck (and PDF export) built entirely from evidence
gathered from the repo itself — README content, package manifests, git
history, and CI workflow files. It does not invent facts: every scene that
makes a claim carries a visible citation back to a source file and line
range.

**Scope note**: this is Milestone 1 of a larger blueprint. Only what is
described below is implemented. There is no Canvas renderer, no
animation/video export, no plugin registry, and no non-generic language
adapters (OpenAPI, Terraform, Kubernetes, etc.) yet — only a generic
file-inventory scanner, a Markdown adapter, and a git-history adapter.

## When to use this skill

Use it when the user asks for:
- An executive/status presentation generated from a repository
- An architecture-review deck for technical stakeholders
- A PDF export of either of the above
- A quick "what does this repo look like" visual summary

Do not use it to hand-author a presentation from scratch — its entire value
is that content is derived from evidence, not written freeform. If the user
wants creative narrative writing beyond the deterministic template (see
`references/audience-profiles.md`), that is a manual editing step on the
generated `narrative-brief.yml`, not something this skill's CLI does.

## Workflow

Run these commands in order from the root of the target repository (the repo
being visualized, not the repo-visual-studio tool itself unless you are
self-hosting):

```bash
rvs init                                          # writes .rvs/config.yml (once)
rvs inspect                                        # scans the repo -> .rvs/cache/{repository-model,evidence-manifest}.json
rvs brief --audience executive                     # or: architecture-review
rvs create slides --design-system executive-dark   # or: editorial-light | technical-grid
rvs validate --ci                                  # deterministic overflow/contrast/evidence checks
rvs export pdf                                      # paginated PDF, one page per scene
```

Each step reads the previous step's cached output from `.rvs/cache/` — they
must run in order the first time. Re-running `rvs brief` or
`rvs create slides` with different flags (audience, design system) does not
require re-running `rvs inspect` first, since the repository scan is cached.

Outputs land in `<output_dir>` from `.rvs/config.yml` (default
`artifacts/visuals/`): `deck.html`, `validation-report.json`, `deck.pdf`.

Pick the audience and design system using `references/audience-profiles.md`
and `design-systems/index.json` — don't guess; match the profile's stated
purpose (`decision` vs `review`) and the design system's `best_for` tags to
what the user actually asked for.

## Quality gate

Always run `rvs validate --ci` before treating a deck as done, and read
`references/quality-policy.md` to know what `fail_on_overflow`,
`fail_on_missing_evidence`, and `minimum_contrast` in `.rvs/config.yml`
actually gate. If validation fails, fix it by adjusting content inputs
(shorter brief text, fewer bullets) — never by hand-editing the rendered
`deck.html`, since it will be regenerated and the fix would be lost.

## Troubleshooting

Run `rvs doctor` first if any command fails unexpectedly — it checks Node
version, `.rvs/config.yml` presence, and whether Playwright's Chromium
browser is installed (`npx playwright install chromium` if not).

## Schema reference

`schemas/visualdoc.schema.json` is the generated JSON Schema for the
VisualDoc intermediate representation (the CLI's internal `create slides`
output before HTML rendering) — useful if building a new renderer or
validating a hand-edited `.rvs/cache/visualdoc.json`.
