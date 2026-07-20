---
name: repo-visual-studio
version: 1.0.0
description: Turn a Git repository into an evidence-traceable HTML slide deck and PDF export using the `rvs` CLI. Use when the user wants a presentation, architecture deck, or executive summary generated from a real codebase rather than hand-written.
---

# Repo Visual Studio

This skill wraps the `rvs` CLI, which inspects a Git repository and produces a
standalone HTML slide deck (and PDF export) built entirely from evidence
gathered from the repo itself — README content, package manifests, git
history, and CI workflow files. It does not invent facts: every scene that
makes a claim carries a visible citation back to a source file and line
range.

**Scope note**: the base workflow below (Milestone 1) covers the single-repo
HTML/PDF deck pipeline. Later milestones added `synthesize architecture`,
`synthesize capabilities`, `synthesize product-identity`, a `showcase` slide
profile, and — for multi-repository ecosystems — Portfolio and Ecosystem
Intelligence (`synthesize portfolio` and a `portfolio` slide profile,
summarized below; full reference in `docs/portfolio-intelligence.md` and
`docs/portfolio-showcase.md` at the repo root). There is still no Canvas
renderer, no animation/video export, no plugin registry, and no non-generic
language adapters beyond the generic file-inventory, Markdown, git-history,
GitHub Actions, and Terraform adapters already implemented.

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

## Portfolio and Ecosystem Intelligence (multi-repository)

Use this instead of (after) the single-repo workflow above when the user
wants a combined view across **multiple** already-analyzed product
repositories — e.g. "show how these three CLIs relate" or "build an
ecosystem overview deck." It never re-scans a repository and never invents a
relationship or capability that the underlying per-product evidence doesn't
support; a relationship or capability that doesn't clear that bar is left
`unresolved` / omitted rather than guessed.

Prerequisite: each product repository must already have run
`synthesize capabilities` and `synthesize product-identity` (see the base
workflow above), producing `capability-model.json` and
`product-identity.json`. From a directory that can see all of those
products' artifacts:

```bash
# .rvs/portfolio.yml lists each product's id + artifact_root (see
# docs/portfolio-intelligence.md for the full schema)
rvs synthesize portfolio [--allow-partial]   # -> .rvs/cache/portfolio-model.json
rvs export portfolio-model --output portfolio-model.json
rvs export portfolio-claims --output portfolio-claims.json
rvs export portfolio-decisions --output portfolio-decisions.json
rvs portfolio explain <claim-or-decision-id> # prints the full reasoning + evidence for one id
rvs create slides --profile portfolio --audience portfolio
```

`--allow-partial` continues with only the compatible products, excluding and
recording the rest, instead of failing outright — but synthesis still throws
if **zero** products are compatible; the flag only helps when at least one
product qualifies. A product is excluded when it's missing a required
artifact, was generated by an unsupported schema version, its identity and
capability files disagree, or the two files are stale relative to each
other — see `docs/portfolio-intelligence.md`'s "Intake and compatibility
gate" section for the exact rules before telling a user why their product
was dropped.

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

## Agent operating model

Routing into this skill, branch/PR governance, and repository maintenance
are no longer decided ad hoc — they're governed by `MASTER_AGENT.md` at the
repository root. Read it first. It decides which intelligence layer(s) a
task actually needs (don't run the whole stack for a one-line fix) and
whether a task needs its own branch and PR (`skills/pr-governance/SKILL.md`)
before this skill's workflow even starts.

Once `MASTER_AGENT.md` has routed here, use these references instead of
re-deriving the routing decision:

- `references/intelligence-routing.md` — which layer(s) a given request
  needs, and the freshness/reuse rule for already-generated artifacts.
- `references/architecture-intelligence.md`,
  `references/capability-intelligence.md`,
  `references/product-intelligence.md`,
  `references/portfolio-intelligence.md` — one reference per intelligence
  layer: prerequisites, commands, outputs, and a pointer to the full
  technical doc at the repo root (`docs/*.md`).
- `references/presentation-and-export.md` — turning a synthesized model
  into a deck (`create slides`), validating it, and exporting it.
- `references/audience-profiles.md`, `references/quality-policy.md` — the
  pre-existing Milestone 1 references, unchanged.
