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
profile, — for multi-repository ecosystems — Portfolio and Ecosystem
Intelligence (`synthesize portfolio` and a `portfolio` slide profile,
summarized below; full reference in `docs/portfolio-intelligence.md` and
`docs/portfolio-showcase.md` at the repo root), and — for change detection
and CI gating — Architecture Governance and Continuous Intelligence
(`rvs snapshot create` / `rvs governance compare|check` and a `governance`
slide profile, summarized below; full reference in
`docs/architecture-governance.md`, `docs/continuous-intelligence.md`,
`docs/governance-policies.md`, and `docs/governance-baselines.md` at the
repo root). There is still no Canvas renderer, no animation/video export, no
plugin registry, and no non-generic language adapters beyond the generic
file-inventory, Markdown, git-history, GitHub Actions, and Terraform
adapters already implemented.

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

## Architecture Governance and Continuous Intelligence (change detection / CI gating)

Use this when the user wants to know "what changed architecturally between
two states" or "is this a CI-blocking regression" — e.g. "did this PR remove
a component the API depends on" or "block the merge if a capability
regressed from operational to planned." It never re-scans a repository and
never re-synthesizes an upstream artifact; it only diffs already-generated
architecture/capability/product(/portfolio) artifacts and evaluates a fixed
set of policy rules against the differences.

Prerequisite: the repository must already have run `synthesize architecture`
+ `synthesize capabilities` (+ `synthesize product-identity`, and
`synthesize portfolio` if a policy needs a portfolio-level check) for both
the state to compare from and the state to compare to, since `rvs snapshot
create` fingerprints whatever is currently cached — capture one snapshot per
state you want to compare.

```bash
rvs snapshot create [--include-portfolio]   # -> .rvs/cache/governance/snapshots/<id>.json
rvs governance baseline set <snapshot-id>   # pin the "from" side once
rvs governance compare                      # -> cached ContinuousIntelligenceReport (baseline vs. current cached artifacts)
rvs governance check --ci                   # same comparison, concise output; --ci fails the build on blocking findings
rvs governance explain <id>                 # prints one change/finding/claim's full reasoning + evidence
rvs export governance-report --output governance-report.json
rvs export governance-summary --output governance-summary.md   # PR-paste-ready Markdown
rvs create slides --profile governance
```

`--ci` exits non-zero only when an un-excepted finding's severity is in the
configured `.rvs/governance.yml` `comparison.fail_on` list (default:
`blocking`) — without `--ci`, `governance compare`/`check` never touch the
process exit code, so both are safe to run for inspection alone. Policy
rules are a fixed, finite set of 11 kinds, never a free-form expression
language — read `docs/governance-policies.md`'s kind reference before
telling a user why a policy can or can't express something they're asking
for, and `docs/governance-baselines.md` before explaining how baseline
promotion/`--from`/`--to` resolve a snapshot reference.

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
