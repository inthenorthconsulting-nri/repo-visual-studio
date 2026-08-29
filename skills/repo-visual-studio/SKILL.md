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
`docs/portfolio-showcase.md` at the repo root), — for change detection
and CI gating — Architecture Governance and Continuous Intelligence
(`rvs snapshot create` / `rvs governance compare|check` and a `governance`
slide profile, summarized below; full reference in
`docs/architecture-governance.md`, `docs/continuous-intelligence.md`,
`docs/governance-policies.md`, and `docs/governance-baselines.md` at the
repo root), and — for decision-record analysis — Architecture Decision
Intelligence (`rvs decisions analyze|validate|compare|explain` and a
`decisions` slide profile, summarized below; full reference in
`docs/architecture-decision-intelligence.md` and its 6 companion documents
at the repo root). There is still no Canvas renderer, no animation/video
export, no plugin registry, and no non-generic language adapters beyond the
generic file-inventory, Markdown, git-history, GitHub Actions, and Terraform
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

## Architecture Decision Intelligence (decision-record analysis)

Use this when the user wants to know "what decisions explain this
architecture," "which accepted decisions aren't implemented yet," or "did
this change violate a documented decision" — e.g. "why does this component
exist" or "list every decision debt finding." It never re-scans a
repository outside the paths configured in `.rvs/decisions.yml`, never
writes or edits a decision document, and never approves, rejects, or
creates a decision on the user's behalf — this layer only discovers,
parses, links, and reports on decision documents that already exist in the
repository.

Prerequisite: `.rvs/decisions.yml` must name at least one `sources` entry
pointing at a directory of ADR/RFC/design-decision/decision-log Markdown
documents (see `docs/decision-record-format.md` for the schema and the 3
recognized document shapes). Resolving links to upstream artifacts also
benefits from `synthesize architecture`/`capabilities`/`product-identity`/
`portfolio` having already run, the same prerequisite pattern as Governance
above — an unresolved link is kept and reported, never dropped, when the
corresponding upstream artifact isn't available.

```bash
rvs decisions analyze                        # -> .rvs/cache/decisions/*.json
rvs decisions validate [--ci]                 # structural validation findings
rvs decisions compare [--from] [--to]         # diff two decision snapshots
rvs decisions explain <id>                    # prints one decision/link/finding's full reasoning
rvs export decision-report --output decision-report.json
rvs export decision-summary --output decision-summary.md   # paste-ready Markdown
rvs create slides --profile decisions
```

**Do not offer to create, approve, or reject a decision document as part of
this workflow** — there is no `rvs decisions new` command, and none of
`packages/decision-intelligence`'s modules write a Markdown file. If the
user wants to record a new decision (e.g. "create an ADR for this change"),
that is a separate, ordinary file-authoring task — write the Markdown
yourself using the template in `docs/decision-record-format.md`, or ask the
user to, and let the next `rvs decisions analyze` run discover it; it is
never something this skill's commands do automatically.

The 10 decision-aware governance rule kinds this layer adds to
`@rvs/governance-intelligence` (see `docs/decision-governance.md`) are
**not wired into `rvs governance compare`/`check`** on this branch — don't
tell a user that a decisions-related policy rule is enforced by those
commands today; it is evaluated only by `@rvs/governance-intelligence`'s
own package-level test suite until that CLI wiring is added.

## Architecture Knowledge Graph (impact analysis, root-cause grouping, decision invalidation, change planning)

Use this when the user wants to know "what breaks if I change/remove this
component," "why did these governance findings show up together," "what
decisions depend on this capability," or "what's the blast radius of
removing this." It never re-scans a repository and never re-synthesizes any
upstream artifact — it only reads whichever of the six upstream artifacts
(architecture, capability, product, portfolio, governance, decision) are
already cached, unifies them into one graph, and answers traversal/impact/
root-cause/decision-invalidation/change-planning queries against it. It
never re-derives, reverses, approves, or rejects a decision's own
governance or compatibility verdict — those stay owned by Architecture
Governance and Architecture Decision Intelligence; this layer only reads
them.

Prerequisite: run `rvs graph build` before any other `rvs graph *` command
— it reads whichever of `synthesize architecture`/`capabilities`/
`product-identity`/`portfolio`, `rvs snapshot create`/`governance compare`,
and `rvs decisions analyze` have already been run, and treats any missing
upstream artifact as `unresolved` (kept and reported, never dropped or
assumed) rather than failing outright. More upstream artifacts present
means a more complete graph, but none is strictly required for `graph
build` to succeed.

```bash
rvs graph build                              # -> .rvs/cache/knowledge-graph/*.json
rvs graph validate [--ci]                    # 18 fixed validation codes
rvs graph inspect <node-or-edge-id>
rvs graph impact <node-id>                   # bounded-BFS impact + blast radius
rvs graph path <from-id> <to-id>              # shortest/all paths
rvs graph roots <finding-id...>              # shared-ancestor root-cause grouping
rvs graph compare [--from] [--to]             # diff two graph snapshots
rvs graph plan-change --remove <node-id>      # removal-only change planning
rvs graph explain <id>                        # prints one node/edge/result's full reasoning
rvs export graph-report --output graph-report.json
rvs export impact-summary --output impact-summary.json
rvs create slides --profile knowledge-graph
```

**Do not offer to auto-apply a change plan or auto-remove the node it was
run against** — `rvs graph plan-change` only analyzes and reports; it never
edits, deletes, or refactors any file, and there is no `--add`/`--modify`/
`--rename` verb on this branch, only `--remove`. If the user wants to
actually make the change, that is a separate, ordinary implementation task
that comes after reading the plan's output, not something this command does
for them.

`rvs create slides --profile knowledge-graph` is cache-read-only: it fails
with an explicit error if `rvs graph build` hasn't been run yet rather than
triggering a build itself. The knowledge-graph CLI surface is covered by
`packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` (as is
`rvs graph review`, below), but none of `@rvs/visualdoc-schema`,
`@rvs/narrative-planner`, or `@rvs/renderer-html` has a dedicated unit test
for the knowledge-graph presentation surfaces — don't tell a user that
coverage is equivalent to the other five intelligence layers' presentation
paths until that gap is closed.

## Semantic visualization (Milestone 10)

Two commands write self-contained HTML that opens from disk: no server, no
watcher, no network, no CDN, no external JavaScript. Both read caches and
write one file.

```bash
rvs graph open [--output <path>] [--audience <a>] [--detail <mode>] [--focus <id>]...     [--verified] [--profile <id>]
rvs graph review --from <snapshot-dir> --to <snapshot-dir>     [--output <path>] [--audience <a>] [--detail <mode>]     [--lens architecture|capabilities|governance|decisions|impact|unresolved]     [--motion none|compare] [--verified] [--profile <id>]
rvs export change-review-summary --from <snapshot-dir> --to <snapshot-dir> [--output <path>]
```

`rvs graph open` is an explorer over one architecture: search, focus, lenses,
an evidence drawer, and shareable view state
([`docs/interactive-architecture.md`](../../docs/interactive-architecture.md)).

`rvs graph review` is a Before / Delta / After review over **two** snapshots
([`docs/architecture-change-review.md`](../../docs/architecture-change-review.md)).
A snapshot directory is one holding `graph-snapshot.json`, `nodes.json`, and
`edges.json` — the same shape `rvs graph compare --from` reads. The review runs
the same comparison engine `rvs graph compare` runs; it does not compute its
own diff and does not re-derive governance findings, decision state, impact
paths, or blast radius.

**Three things not to say about a review.** Its governance lens showing nothing
means no finding was *recorded*, not that the change is safe to deploy. Its
decision lens reports state, not correctness — RVS approves and rejects
nothing. And an absent downstream route means no evidence-backed path was found
within the traversal boundary, which is not "no consumers" and not "no
impact"; the artifact's own wording is the wording to reuse.

**Change Review is read-only.** It never comments on a pull request, never
approves or blocks one, and changes no merge behaviour. `rvs export
change-review-summary` writes Markdown to a local file for a *person* to paste
somewhere if they choose — offering to post it is a separate, explicitly
authorized action, not part of running the command.

An incompatible snapshot pair fails the review and writes nothing; a partial
one produces a review that says on its own face which domains it cannot speak
about. "Not comparable" is never reported as "no change".

### Verified delivery (`--verified`)

Add `--verified` to either command to put its output behind a delivery
gate. The rendered file becomes a *candidate* staged under `.rvs/cache/`;
a named verification profile runs the contract, fidelity, graph, layout,
accessibility, interaction and motion validators over it; and the path
named by `--output` is replaced only if the candidate passed. On failure
the existing file is left byte-for-byte as it was, a repair receipt is
written next to the run, and the command exits non-zero.
`--profile <id>` picks the profile — `visual-standard-v1` (no browser),
`visual-interactive-v2` (the `graph open` default),
`visual-change-review-v2` (the `graph review` default), `visual-print-v1`.
There is no flag for an individual threshold, rule or validator.
([`docs/verified-preview.md`](../../docs/verified-preview.md).)

**Say what the words mean.** *Verified* means the named profile's required
checks passed on that exact candidate. It does not mean approved design,
certified architecture, safe architecture, or merge-ready. *Promoted* means
the file was replaced; *last known good* means it was not.

**The gate reports; it does not repair.** A repair receipt names the
validator that refused the candidate and the categories of change that
could address it. Acting on it is an ordinary implementation task the user
authorizes, taken through PR Governance like any other — RVS never edits
source, commits, pushes, or publishes to fix its own rejection.

**Preview is a file, not a server.** A verified run reports a `file://`
path and one of four statuses (Verified / Candidate validating / Candidate
rejected / Last known good retained). Nothing is hosted, no port is bound,
no process survives the command, and nothing is re-verified afterwards.

## Architecture Change Workbench (proposal advisory, Milestone 11.2)

Use this when the user wants to know "what would happen if I made this
change" *before* actually making it — a hypothetical, multi-operation
proposal, not a real edit. It is strictly advisory: nothing it produces is
ever written back into the repository, the Knowledge Graph cache, or any
other observed-architecture artifact, and a `ChangeAdvisory` is never
treated as an actual scan result.

```bash
rvs change validate --file <proposal.json>            [--output <path>]
rvs change evaluate --file <proposal.json>             [--output <path>] [--cache]
rvs change explain <advisory-id>
```

A proposal file is a JSON `ProposedChangeSet` built from six operation
kinds only: `add_entity`, `remove_entity`, `modify_attributes`,
`add_relation`, `remove_relation`, `modify_relation`. Every caller — this
CLI, a script, CI, or an agent calling `@rvs/change-workbench` directly —
goes through the same runtime decode/validation boundary and gets the same
evidence-qualified advisory back; the CLI adds no parallel semantic model
of its own.

`rvs change validate` decodes and semantically validates a proposal only —
no Knowledge Graph baseline is required. A missing baseline only degrades
ref-confirmation to the validator's own non-blocking "unresolved" state,
never a hard failure.

`rvs change evaluate` additionally resolves a baseline from the already-
built Knowledge Graph cache (`.rvs/cache/knowledge-graph/`) and produces a
full `ChangeAdvisory`, echoing the exact `base_snapshot_digest` it was
evaluated against. **It never runs `rvs graph build` itself** — a missing
baseline fails with guidance to run that command first. By default nothing
is persisted; pass `--cache` to explicitly store the advisory for later
`rvs change explain <advisory-id>` lookup. The proposal file itself is
never copied, saved, or promoted into `.rvs/cache` — RVS reads it, decides,
and discards it.

`rvs change explain` narrates only evidence already present on a
previously cached advisory (governance/decision findings, coverage,
impact) — it never re-validates, re-evaluates, or manufactures a causal
claim the advisory itself doesn't carry.

**Watch the wording.** A proposal is `VALID PROPOSAL` / `INVALID
PROPOSAL`; an advisory's coverage is `ADVISORY COMPLETE` / `ADVISORY
PARTIAL` / `ADVISORY UNRESOLVED`; a finding is a `PROPOSED GOVERNANCE
CONCERN` or `PROPOSED DECISION CONCERN` — never "safe", "no impact",
"approved", "compliant", "no risk", or "ready to deploy". These commands
answer "what would this proposal mean if applied", never "is this
approved" or "is this deployed".

**Distinct from `rvs graph plan-change`.** `plan-change` reports what
review an *actual* entity removal already in the graph would require,
composed from already-computed impact/decision-impact results (see
[docs/graph-change-planning.md](../../docs/graph-change-planning.md)). The
Change Workbench instead validates and assesses a *hypothetical*,
not-yet-applied, multi-operation proposal. Do not conflate the two or
extend `graph plan-change` to cover proposal evaluation — they are
separate command families with separate contracts.

There is no `--emit-overlay`, projected-graph export, visualization,
`FidelityReceipt`, or `visual-delivery` profile support in this command
family; a proposal advisory is text/JSON only (terminal output, or
deterministic JSON via `--output <path>` — there is no global `--json`
flag and no HTML/SVG/Markdown output from `rvs change *`).

## Quality gate

Always run `rvs validate --ci` before treating a deck as done, and read
`references/quality-policy.md` to know what `fail_on_overflow`,
`fail_on_missing_evidence`, and `minimum_contrast` in `.rvs/config.yml`
actually gate. It checks five rules per scene, and it also checks the
interactive explorer and the change review when those files exist — each
under both `prefers-color-scheme: light` and `dark`, because the dark
palette ships in the same stylesheet behind a media query and contrast is
what differs between the halves. If validation fails, fix it by adjusting content inputs
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
- `references/architecture-decision-intelligence.md`,
  `references/decision-discovery.md`, `references/decision-linking.md`,
  `references/decision-governance.md`, `references/decision-drift.md`,
  `references/decision-showcase.md` — one reference per decision-intelligence
  concern, same shape as the layer references above.
- `references/architecture-knowledge-graph.md`,
  `references/graph-construction.md`, `references/graph-impact-analysis.md`,
  `references/graph-root-cause.md`, `references/graph-decision-impact.md`,
  `references/graph-change-planning.md`, `references/graph-showcase.md` —
  one reference per knowledge-graph concern, same shape as the layer
  references above; this is the seventh and outermost layer, reading all six
  of the others rather than optionally linking against them.
- `references/presentation-and-export.md` — turning a synthesized model
  into a deck (`create slides`), validating it, and exporting it.
- `references/audience-profiles.md`, `references/quality-policy.md` — the
  pre-existing Milestone 1 references, unchanged.
