# repo-visual-studio

`rvs` inspects a Git repository and turns what it finds — README content,
package manifests, git history, CI workflows — into a standalone HTML slide
deck and PDF export. Every claim a slide makes is backed by a visible
citation to a real file and line range. Nothing is invented: if the repo
doesn't say it, the deck doesn't say it either.

This started as **Milestone 1** of a larger blueprint (see
`skills/repo-visual-studio/SKILL.md` for the scope note): a generic
file/markdown/git scanner, a deterministic narrative-brief builder, 5
slide-scene types, 3 design systems, a standalone HTML renderer,
deterministic Playwright-based visual validation, and PDF export.

**Milestone 2** adds the vertical architecture-graph engine. Slice 1 covers
GitHub Actions workflows (`.github/workflows/*.yml`), parsed into a
renderer-neutral `WorkflowGraph`. Slice 2 covers Terraform (`.tf` files),
parsed into a renderer-neutral `TerraformTopology`. Both are rendered as a
Mermaid diagram and a native SVG diagram, embedded as slide-scene types, and
checked by deterministic layout/evidence/divergence validators. See
[`docs/workflow-engine.md`](docs/workflow-engine.md) and
[`docs/terraform-topology.md`](docs/terraform-topology.md) for the full
design of each. Generic source-code architecture extraction and repository
dependency mapping are still out of scope. No Canvas renderer, animation,
plugin registry, or other specialized language adapters (Kubernetes, OpenAPI,
etc.) yet.

**Milestone 3** adds the Architecture Intelligence Engine: it synthesizes the
`RepositoryModel`/`WorkflowGraph[]`/`TerraformTopology[]` evidence Milestones
1-2 already produce into a coherent, audience-aware, four-level architecture
narrative — system identity, responsibilities, capability domains, logical
components, flows, boundaries, operating model, outcomes, risks — without
ever lowering the level of evidence: every synthesized statement is tagged
`confirmed`/`derived`/`suggested`/`unresolved`, and `suggested`/`unresolved`
claims are never silently presented as fact. Deterministic and offline, like
everything else here — no model-assisted synthesis is built yet. The
pre-Milestone-3 deck remains available unchanged via `rvs create slides`'s
default `repository-inventory` profile. See
[`docs/architecture-intelligence.md`](docs/architecture-intelligence.md) for
the full design, the six narrative profiles, and the new validator checks.

**Milestone 3.1** remediates presentation quality on top of Milestone 3's
contract, without changing it: sharper system-identity/purpose fallback
chains, a coarser capability-domain rollup (fine-grained workflow families
group into a handful of business-capability domains), ranked
representative-workflow selection, conclusion-oriented scene headlines
driven by real structural counts, a logical-architecture diagram that
excludes raw directory groupings once real architectural components exist,
three new Tier 1 validator codes, and a fix for a `min-font-size` validator
failure. No new source adapters, no new CLI commands, same evidence and
inference-class guarantees. See
[`docs/milestones.md`](docs/milestones.md#milestone-31--architecture-presentation-quality-remediation)
for the full closure record.

**Milestone 4** adds the Capability Intelligence Engine: a conservative,
evidence-gated synthesis stage on top of Architecture Intelligence that
decides which capabilities are real enough to appear in a generated
`CAPABILITIES.md` or an executive slide — a candidate found is never treated
as a capability implemented. Every candidate passes through evidence
aggregation, five-dimension maturity scoring, a weighted 0-100 readiness
score, and hard gates that apply independent of that score, before a
conservative-bias inclusion policy sorts it into `include` /
`include_with_qualification` / `roadmap_only` / `gap_only` / `exclude` — weak
and excluded candidates are kept, not deleted, for auditability. No external
model, no repository-specific hard-coded capability list. See
[`docs/capability-intelligence.md`](docs/capability-intelligence.md) for the
full design, the 13 exclusion reason codes, and the self-hosting result
against this repository itself.

**Milestone 5** adds Product Identity and Executive Showcase Intelligence: a
synthesis stage on top of an accepted `CapabilityModel` that derives a
durable product identity (archetype, purpose, users, value pillars,
differentiators) and, from it, an audience-aware executive narrative and a
premium "showcase" slide profile — governed throughout by the same rule as
every prior milestone: storytelling may compress evidence, but it must never
inflate maturity, invent adoption, or promote unfinished capabilities. A new
claim-control engine classifies every candidate showcase statement as
approved, approved with qualification, rejected, or requiring runtime
verification before it can appear in a slide, and every rejection stays
inspectable via `rvs showcase explain`. No external model, no
repository-specific hard-coded product identity. See
[`docs/product-identity-intelligence.md`](docs/product-identity-intelligence.md)
and
[`docs/executive-showcase-intelligence.md`](docs/executive-showcase-intelligence.md)
for the full design and the self-hosting result against this repository
itself.

**Milestone 6** adds Portfolio and Ecosystem Intelligence: a synthesis stage
above the per-product pipeline that combines multiple products' own
already-generated `ProductIdentityModel`/`CapabilityModel` artifacts — one
per product, each product its own repository — into a single evidence-backed
`PortfolioModel`: normalized cross-product capabilities, product
relationships, a dependency graph, overlaps, gaps, an inferred operating
model, and a maturity summary, feeding a "portfolio" slide profile —
governed by the same rule raised one level of abstraction: portfolio
synthesis may raise the level of abstraction across products, but it must
never invent a relationship, inflate a capability's maturity, or fabricate
ownership the underlying evidence does not support. Products are named in a
new `.rvs/portfolio.yml`; a 4-step compatibility gate decides, per product,
whether its artifacts are usable before any synthesis runs. No external
model, no re-scanning of any product repository, no repository-specific
hard-coded product list, relationship, or capability name. See
[`docs/portfolio-intelligence.md`](docs/portfolio-intelligence.md) and
[`docs/portfolio-showcase.md`](docs/portfolio-showcase.md) for the full
design and both self-hosting proofs (a 3-fixture portfolio, and this
repository's own artifacts added as a 4th product).

**Milestone 7** adds Architecture Governance and Continuous Intelligence: a
read-only comparison and policy layer above the entire stack, from
Repository Evidence through Portfolio Intelligence. It fingerprints the
already-synthesized architecture/capability/product/portfolio artifacts into
an `IntelligenceSnapshot`, diffs any two snapshots — typically a promoted
baseline against the current repository state — into per-domain change
sets, assesses how far each change's effects reach, evaluates a finite,
typed policy engine (11 rule kinds, never a general-purpose expression
language) against the changes, and composes the result into a
`ContinuousIntelligenceReport`, a claim-controlled narrative, and a
`"governance"` slide profile — feeding a new `rvs governance check --ci`
gate a CI pipeline can block a merge on. It never re-scans a repository,
never re-synthesizes an upstream artifact, and never calls an external
model. See [`docs/architecture-governance.md`](docs/architecture-governance.md)
and [`docs/continuous-intelligence.md`](docs/continuous-intelligence.md) for
the full design, [`docs/governance-policies.md`](docs/governance-policies.md)
for the policy-authoring reference, and
[`docs/governance-baselines.md`](docs/governance-baselines.md) and
[`docs/governance-showcase.md`](docs/governance-showcase.md) for baseline
management and the presentation layer.

## Supported Node version

Node **20 or later** (`engines.node: ">=20"` on the published `@rvs/cli`
package). The compiled CLI targets `node20` and is not tested against
older runtimes.

## Local workspace development

```bash
corepack enable
pnpm install
npx playwright install chromium   # one-time; rvs doctor checks this
```

Run from the root of the repository you want to visualize:

```bash
pnpm rvs init                                        # writes .rvs/config.yml
pnpm rvs inspect                                      # scans the repo
pnpm rvs brief --audience executive                   # or: architecture-review
pnpm rvs create workflow --all --renderer both         # optional: GitHub Actions -> WorkflowGraph
pnpm rvs create topology --all --renderer both         # optional: Terraform -> TerraformTopology
pnpm rvs synthesize architecture                        # optional: synthesize ArchitectureIntelligence
pnpm rvs synthesize capabilities                        # optional: synthesize CapabilityModel (requires synthesize architecture)
pnpm rvs export capabilities --output CAPABILITIES.md   # optional: render the evidence-gated capability model
pnpm rvs synthesize product-identity                     # optional: synthesize ProductIdentityModel (requires synthesize capabilities)
pnpm rvs export product-identity --output product-identity.json  # optional
pnpm rvs create slides --design-system executive-dark # or: editorial-light | technical-grid
pnpm rvs create slides --profile architecture-review   # requires `synthesize architecture` first; see below
pnpm rvs create slides --profile showcase --audience executive  # requires `synthesize product-identity` first; see below
pnpm rvs export showcase-plan --output showcase-plan.json  # optional
pnpm rvs synthesize portfolio                            # optional: requires .rvs/portfolio.yml naming each product's artifact_root
pnpm rvs export portfolio-model --output portfolio-model.json  # optional
pnpm rvs create slides --profile portfolio --audience portfolio  # requires `synthesize portfolio` first; see below
pnpm rvs snapshot create                              # optional: fingerprint cached architecture/capability/product(/portfolio) artifacts
pnpm rvs governance baseline set <snapshot-id>        # optional: promote a snapshot to the governance baseline
pnpm rvs governance check --ci                        # optional: diff baseline vs. current state, evaluate policy; --ci fails the build on blocking findings
pnpm rvs create slides --profile governance           # requires `governance compare`/`check` first; see below
pnpm rvs validate --ci                                # overflow/contrast/evidence checks
pnpm rvs export pdf
```

(`pnpm rvs` runs `tsx packages/cli/src/bin.ts` directly against source — see
the `rvs` script in the root `package.json`. No build step is required for
workspace development.)

## Standalone installation (npm tarball)

`@rvs/cli` also installs and runs as a normal npm package, outside this
pnpm workspace — no `tsx`, no TypeScript compiler, and no `workspace:*`
dependency required at runtime. See [`docs/packaging.md`](docs/packaging.md)
for how the distribution is built and what ships in it.

```bash
pnpm --filter @rvs/cli pack        # produces rvs-cli-<version>.tgz

# From a separate, clean repository:
npm install /path/to/rvs-cli-<version>.tgz
npx playwright install chromium    # one-time, same as workspace dev
npx rvs doctor
npx rvs init && npx rvs inspect && npx rvs brief --audience architecture-review \
  && npx rvs create workflow --all --renderer both --format visualdoc \
  && npx rvs create topology --all --renderer both --format visualdoc \
  && npx rvs create slides && npx rvs validate --ci && npx rvs export pdf
```

This works from a project-local install, from an install path containing
spaces, and outside the source monorepo entirely — asset resolution never
depends on the current working directory or a fixed monorepo layout. See
[`docs/milestones.md`](docs/milestones.md) for verified installation
scenarios and exact results.

`rvs create workflow` and `rvs create topology` are both optional but, when
run before `rvs create slides`, their cached graphs
(`.rvs/cache/workflow-graphs.json`, `.rvs/cache/terraform-topologies.json`)
are picked up automatically and turned into workflow/topology scenes in the
deck. See [`docs/workflow-engine.md`](docs/workflow-engine.md) and
[`docs/terraform-topology.md`](docs/terraform-topology.md) for each
command's full option set (`--source`, `--all`,
`--renderer mermaid|svg|both`, `--output`, `--format visualdoc`).

Outputs land in `.rvs/config.yml`'s `defaults.output_dir` (default
`artifacts/visuals/`): `deck.html`, `validation-report.json`, `deck.pdf`, and
(if run) `workflows/*.mmd` / `*.svg` / `*.visualdoc.json` and
`topologies/*.mmd` / `*.svg` / `*.visualdoc.json`. Intermediate state is
cached in `.rvs/cache/`.

### Terraform topology

`rvs create topology` parses `.tf` files (via `@cdktf/hcl2json`) into a
renderer-neutral `TerraformTopology` — the Terraform analogue of the
workflow engine's `WorkflowGraph`. See
[`docs/terraform-topology.md`](docs/terraform-topology.md) for the full
design, warning-code reference, and known limitations. In short:

**Supported constructs**: `terraform`/`required_providers` blocks,
`provider` blocks (including aliases), `resource` blocks, `data` blocks,
local `module` calls (fully resolved), remote/registry `module` calls
(represented as opaque nodes), `variable` and `output` blocks, static
cross-references (`aws_subnet.app.vpc_id`-style), explicit `depends_on`, and
dynamic expressions (`count`, `for_each`, and any other Terraform
interpolation) — preserved as unresolved rather than guessed at.

**Explicit limitations**: `rvs` never runs `terraform init`, `plan`, `apply`,
or any other Terraform CLI command; never inspects `.tfstate` or `.tfplan`
files (both are excluded from discovery, since they aren't `.tf` files);
never calls a cloud provider API or performs cloud inventory discovery;
never downloads a remote/registry module's source; and never evaluates or
guesses the value of a dynamic expression. Every node and edge in a
`TerraformTopology` traces back to literal HCL the parser confirmed exists —
nothing is inferred without evidence.

**Security behavior**: sensitive variable/output values are redacted before
they ever leave the parser (see `TERRAFORM_SENSITIVE_VALUE_REDACTED`);
resource attributes whose key name matches a sensitive pattern (password,
secret, token, private_key, access_key, client_secret, connection_string)
are redacted; `terraform.tfstate`, `terraform.tfstate.backup`, `*.tfplan`,
and `.terraform/**` are never scanned; backend configuration attributes are
redacted the same way as any other resource attributes; and the whole
pipeline runs offline after `@cdktf/hcl2json` is installed (its `main.wasm.gz`
runtime asset needs no network access to execute).

**Outputs**: `<root>.mmd` (Mermaid), `<root>.svg` (native SVG), and, with
`--format visualdoc`, `<root>.visualdoc.json` — written under
`<output_dir>/topologies/`. A cache of every parsed topology is written to
`.rvs/cache/terraform-topologies.json`.

**Packaging note**: `@cdktf/hcl2json` stays an installed runtime dependency
of `@rvs/cli` rather than being bundled into the single-file CLI binary —
its WASM parser asset (`main.wasm.gz`) is loaded via a `path.join(__dirname,
...)`-relative lookup that only works when the package is installed
normally, so esbuild treats it as `external` (see
[`docs/packaging.md`](docs/packaging.md)).

### Architecture Intelligence

`rvs synthesize architecture` reads the three cached artifacts above
(`repository-model.json` required; `workflow-graphs.json`/
`terraform-topologies.json` optional — synthesis degrades gracefully without
them) and combines them into a single `ArchitectureIntelligence` artifact,
cached to `.rvs/cache/architecture-intelligence.json`. See
[`docs/architecture-intelligence.md`](docs/architecture-intelligence.md) for
the full design. In short:

**What it does**: identifies the system, its purpose, responsibilities, and
capability domains; extracts logical components, actors, external systems,
flows, and boundaries; summarizes the operating model, outcomes, risks, and
dependencies; groups workflows into named families. Every statement carries
an explicit inference class (`confirmed`/`derived`/`suggested`/`unresolved`)
and its own evidence reference — nothing is asserted without one.

**`rvs create slides --profile <id>`** then builds a deck from that artifact
instead of the legacy narrative brief. Six profiles are available:
`repository-inventory` (default, unchanged pre-Milestone-3 behavior, no
synthesis required), `executive-overview`, `architecture-review`,
`engineering-onboarding`, `operating-review`, `repository-audit` — each a
different fixed sequence of scenes over the same underlying artifact, from an
8-scene executive narrative up to a full 60-scene audit.

**Explicit limitations**: no model-assisted synthesis (`--assist`) — every
statement is deterministic, rule-based synthesis over already-parsed
evidence; no new repository adapters (Kubernetes, LookML, dbt, OpenAPI,
Databricks, Python/TypeScript AST) — only the existing three cached inputs
are consumed. See
[`docs/architecture-intelligence.md#known-limitations`](docs/architecture-intelligence.md#known-limitations)
for the complete list.

### Capability Intelligence

`rvs synthesize capabilities` reads the cached `architecture-intelligence.json`
(required — run `rvs synthesize architecture` first) plus
`repository-model.json`/`workflow-graphs.json`/`terraform-topologies.json`,
and produces a conservative, evidence-gated `CapabilityModel`, cached to
`.rvs/cache/capability-model.json`. See
[`docs/capability-intelligence.md`](docs/capability-intelligence.md) for the
full design. In short:

**What it does**: discovers capability candidates from workflow families,
CLI/service runtime components, Terraform modules, and README claims;
aggregates evidence per candidate; scores five maturity dimensions
(implementation, execution, verification, documentation, adoption) into a
weighted 0-100 readiness score; applies hard gates independent of that score;
and sorts every candidate into `include` / `include_with_qualification` /
`roadmap_only` / `gap_only` / `exclude` — never promoting a capability past
what its evidence actually supports.

**`rvs export capabilities`** renders the resulting model to
`CAPABILITIES.md` (`--include-partial`/`--include-gaps` on by default,
`--include-roadmap`/`--include-excluded` opt-in). **`rvs capabilities explain
<id>`** prints the full evidence/readiness/inclusion trail for one capability
or excluded candidate.

**Explicit limitations**: no external model; no repository-specific
hard-coded capability list — every statement above is derived purely from
the same cached evidence any repository produces. See
[`docs/capability-intelligence.md#known-limitations`](docs/capability-intelligence.md#known-limitations)
for the complete list, including this repository's own low-yield self-hosting
result and its root cause.

### Product Identity and Executive Showcase Intelligence

`rvs synthesize product-identity` reads the cached `capability-model.json`
(required — run `rvs synthesize capabilities` first) plus
`architecture-intelligence.json`, and produces a `ProductIdentityModel`,
cached to `.rvs/cache/product-identity-model.json`. See
[`docs/product-identity-intelligence.md`](docs/product-identity-intelligence.md)
and
[`docs/executive-showcase-intelligence.md`](docs/executive-showcase-intelligence.md)
for the full design. In short:

**What it does**: classifies a product archetype (13 possible, or `unknown`
when evidence is too thin), derives users/purpose/3-5 value pillars/up to 6
structurally-justified differentiators, then runs every candidate showcase
statement through a claim-control engine (`approved` /
`approved_with_qualification` / `rejected` / `runtime_verification_required`,
with 11 rejection reason codes) before composing an audience-aware executive
narrative and a 7-10 scene "showcase" presentation.

**`rvs create slides --profile showcase [--audience executive|...] [--theme
executive-dark|...]`** builds the showcase deck.
**`rvs export product-identity`** / **`rvs export showcase-plan`** dump the
underlying JSON. **`rvs showcase explain <claim-id>`** prints one claim's
full text, status, evidence, and (if rejected) every rejection reason.

**Explicit limitations**: no external model; scenes are only ever inserted
when the underlying evidence justifies them (e.g. the differentiators scene
is omitted entirely when no differentiator clears its structural bar) —
never padded to hit the 7-10 scene band. See
[`docs/product-identity-intelligence.md#known-limitations`](docs/product-identity-intelligence.md#known-limitations)
and
[`docs/executive-showcase-intelligence.md#known-limitations`](docs/executive-showcase-intelligence.md#known-limitations)
for the complete list, including this repository's own conservative
`archetype: unknown` self-hosting result.

Run `pnpm rvs doctor` (or `npx rvs doctor` for a standalone install) if
anything fails unexpectedly. It reports the CLI version, Node
version/OS/architecture, installation type (packaged vs. workspace
source), the CLI executable path, the resolved package/design-system/
schema/skill paths (with found/not-found status for each), VisualDoc and
WorkflowGraph schema versions, the current working directory, the
repository root (if inside one), `.rvs/config.yml` presence, and whether
Playwright's Chromium is installed — without ever printing secrets or a
full environment-variable dump. `rvs skill path` prints just the resolved
agent-skill directory, for scripts or agents that want to locate it
programmatically.

### Portfolio and Ecosystem Intelligence

`rvs synthesize portfolio` reads `.rvs/portfolio.yml` — a small file naming
each product's id and `artifact_root` (a path to that product's own already-
generated Milestone 3-5 artifacts) — combines every compatible product's
`product-identity.json`/`capability-model.json` (plus, optionally,
`architecture-intelligence.json`/`repository-model.json`/
`showcase-plan.json`/`showcase-claims.json`) into a `PortfolioModel`, cached
to `.rvs/cache/portfolio-model.json`. See
[`docs/portfolio-intelligence.md`](docs/portfolio-intelligence.md) and
[`docs/portfolio-showcase.md`](docs/portfolio-showcase.md) for the full
design. In short:

**What it does**: gates each product's artifacts through a 4-step
compatibility check before combining them; normalizes capabilities across
products by structural similarity (never lexical overlap alone); derives
product relationships, a dependency graph, overlaps, gaps, an inferred
operating model, and a 7-dimension maturity summary; then runs every
candidate portfolio statement through a claim-control engine (`approved` /
`approved_with_qualification` / `rejected` / `runtime_verification_required`,
with 12 rejection reason codes) before composing decisions and a 6-13 scene
"portfolio" presentation.

**`rvs synthesize portfolio [--allow-partial]`** builds the model (pass
`--allow-partial` to continue with only the compatible products instead of
failing when any product is incompatible). **`rvs create slides --profile
portfolio [--audience portfolio|...] [--theme ...]`** builds the portfolio
deck. **`rvs export portfolio-model`** / **`rvs export portfolio-claims`** /
**`rvs export portfolio-decisions`** dump the underlying JSON. **`rvs
portfolio explain <id>`** prints one claim's or decision's full text,
status, evidence, and (if rejected/applicable) every rejection reason,
urgency, and recommended owner.

**Explicit limitations**: no external model, no re-scanning of any product
repository; several declared gap/relationship/decision type values are
intentionally not yet computed (documented in place rather than silently
absent). See
[`docs/portfolio-intelligence.md#known-limitations`](docs/portfolio-intelligence.md#known-limitations)
and
[`docs/portfolio-showcase.md#known-limitations`](docs/portfolio-showcase.md#known-limitations)
for the complete list, including both self-hosting proofs (a 3-fixture
portfolio, and this repository's own artifacts added as a 4th product).

### Architecture Governance and Continuous Intelligence

`rvs snapshot create` reads the cached `architecture-intelligence.json`/
`capability-model.json`/`product-identity-model.json` (plus, optionally,
`portfolio-model.json`) and fingerprints them into an `IntelligenceSnapshot`,
written under `.rvs/cache/governance/snapshots/`. `rvs governance compare`
(or `rvs governance check`, its CI-oriented sibling) then diffs two
snapshots — by default the configured baseline against a freshly built
snapshot of the current cached artifacts — into per-domain change sets,
assesses blast radius, evaluates every enabled policy rule, and caches a
`ContinuousIntelligenceReport`, a `GovernanceNarrative`, and a
`GovernancePlan`. See
[`docs/architecture-governance.md`](docs/architecture-governance.md) and
[`docs/continuous-intelligence.md`](docs/continuous-intelligence.md) for the
full design. In short:

**What it does**: fingerprints the four upstream intelligence artifacts
without re-scanning or re-synthesizing any of them; diffs two snapshots into
architecture/capability/product/portfolio/evidence change sets, each entry
carrying an explicit change type (`added`/`removed`/`modified`/`renamed`/
`reclassified`/`unchanged`/`unresolved`); assesses how far each change's
effects reach (`isolated` through `portfolio_wide`, or `unresolved` when the
upstream artifacts don't carry enough linkage data to say — never guessed as
`isolated`); evaluates a finite, 11-rule-kind policy engine defined in
`.rvs/governance.yml`-referenced policy files; and runs every candidate
governance claim through its own claim-control engine (`approved` /
`qualified` / `rejected`, with a governance-specific 10-code rejection
vocabulary) before composing a narrative and a 6-13 scene `"governance"`
presentation.

**`rvs snapshot create [--include-portfolio] [--allow-partial]`** builds a
snapshot. **`rvs governance baseline show|set <snapshot>|validate`** manages
which snapshot later comparisons diff against. **`rvs governance compare
[--from] [--to]`** / **`rvs governance check [--from] [--to] [--ci]`** run
the comparison — `--ci` exits non-zero when an un-excepted finding's
severity is in the configured `fail_on` list (default: `blocking`), as a
standalone gate that never changes `rvs validate --ci`'s own behavior.
**`rvs create slides --profile governance`** builds the governance deck
(never audience-scoped — a governance comparison reports one deterministic
comparison result, not a narrative that varies by audience). **`rvs export
governance-report`** / **`rvs export governance-summary`** dump the
underlying JSON / a PR-paste-ready Markdown summary. **`rvs governance
explain <id>`** prints one change's, finding's, or claim's full reasoning and
evidence.

**Explicit limitations**: no external model, no re-scanning of any
repository, no git-worktree two-commit convenience helper (comparing two
historical states requires each state's artifacts to already have been
produced independently, e.g. via `rvs snapshot create` run at each commit);
the sample CI workflow is documented only, not exercised by an actual
GitHub Actions run in this repository. See
[`docs/architecture-governance.md#known-limitations`](docs/architecture-governance.md#known-limitations)
for the complete list.

## Self-hosting

This repository can visualize itself:

```bash
pnpm rvs init && pnpm rvs inspect && pnpm rvs brief --audience architecture-review \
  && pnpm rvs create workflow --all --renderer both \
  && pnpm rvs create topology --source examples/terraform/self-hosting --renderer both \
  && pnpm rvs create slides && pnpm rvs validate --ci && pnpm rvs export pdf
```

`examples/terraform/self-hosting/` is a small, synthetic Terraform module
tree (never real infrastructure, never deployable) used to exercise the
Terraform topology engine end to end — see its own
[README](examples/terraform/self-hosting/README.md). `rvs inspect`'s
ordinary evidence scan never reads it (it isn't in `.rvs/config.yml`'s
`sources.include` globs, and the generic scanner has no Terraform adapter);
it's only ever included when a `create topology` invocation names or
discovers it directly.

## Repository layout

```
packages/
  core/               shared config schema, secret redaction, logger, types
  visualdoc-schema/    Zod schema for the VisualDoc intermediate representation (incl. workflow scenes)
  repository-model/   file/git/markdown scanners -> repository model + evidence manifest
  workflow-graph/      GitHub Actions YAML -> renderer-neutral WorkflowGraph (parser, validator, ids)
  workflow-mermaid/    WorkflowGraph -> Mermaid flowchart text
  workflow-svg/        WorkflowGraph -> native SVG diagram (own deterministic layout engine)
  architecture-graph/  shared node/edge/evidence primitives used by both WorkflowGraph and TerraformTopology
  terraform-graph/     Terraform HCL -> renderer-neutral TerraformTopology (parser, validator, ids)
  terraform-mermaid/   TerraformTopology -> Mermaid flowchart text
  terraform-svg/       TerraformTopology -> native SVG diagram (shared layout engine)
  architecture-intelligence/  RepositoryModel + WorkflowGraph[] + TerraformTopology[] -> synthesized ArchitectureIntelligence, narrative profiles
  capability-intelligence/  ArchitectureIntelligence -> evidence-gated CapabilityModel, CAPABILITIES.md/JSON exporters
  product-intelligence/  CapabilityModel -> ProductIdentityModel, claim-controlled ExecutiveNarrative, ShowcasePlan
  portfolio-intelligence/  multiple products' ProductIdentityModel/CapabilityModel artifacts -> claim-controlled PortfolioModel, PortfolioPlan
  governance-intelligence/  architecture/capability/product(/portfolio) artifacts -> IntelligenceSnapshot diffing, policy evaluation, blast-radius assessment, claim-controlled ContinuousIntelligenceReport/GovernancePlan
  narrative-planner/  audience profiles + deterministic narrative brief + VisualDoc builder (incl. architecture-intelligence + showcase + portfolio + governance scenes)
  renderer-html/      VisualDoc + design tokens -> standalone HTML deck (incl. showcase/portfolio/governance scene templates + premium theme layer)
  validator/          Playwright-based overflow/contrast/evidence checks + workflow/terraform layout/evidence/divergence checks + architecture-intelligence label/budget/staleness checks + product-identity/showcase/portfolio checks
  exporter/            Playwright-based PDF export
  cli/                the `rvs` command (Commander)
design-systems/        token packs: executive-dark, editorial-light, technical-grid
examples/fixture-repo/ tiny sample repo used by repository-model's unit tests
examples/terraform/self-hosting/  synthetic Terraform module tree used to exercise the topology engine
skills/repo-visual-studio/  agent skill wrapping the CLI workflow
```

## Packaged asset behavior

Design systems, the agent skill, and the generated VisualDoc JSON Schema
are resolved relative to the running CLI module's own file location, not
the current working directory or a fixed monorepo path — so the same
compiled binary works correctly whether it's running from source, from a
`node_modules/@rvs/cli` install, or via `npx` from a cache directory,
including paths containing spaces. See
[Runtime asset resolution in docs/packaging.md](docs/packaging.md#asset-resolution)
for the full design.

## Offline behavior

The default pipeline (`init` → `inspect` → `brief` → `create slides` →
`validate` → `export pdf`, and `create workflow`) makes no runtime network
requests: no CDN-hosted fonts/scripts, no remote stylesheets or images in
generated output, no automatic update check, no telemetry. The only
network-touching step in the whole system is the one-time, user-initiated
`npx playwright install chromium` setup command.

## Current limitations

- No generic source-code architecture extraction, repository dependency
  graphs, Kubernetes topology, or GitHub API integration yet — architecture
  diagramming (Milestone 2) currently covers GitHub Actions workflows and
  Terraform only.
- Terraform support specifically: no execution of any Terraform CLI command,
  no state/plan inspection, no cloud provider API calls, no remote-module
  downloads, and no evaluation of dynamic expressions — see
  [`docs/terraform-topology.md`](docs/terraform-topology.md#known-limitations)
  for the complete, tested list. Lerna/Nx-only repos without a standard
  workspace declaration aren't auto-detected by `--all`'s root-module
  discovery.
- Architecture Intelligence (Milestone 3) synthesizes only from
  `RepositoryModel`/`WorkflowGraph[]`/`TerraformTopology[]` — no Kubernetes,
  LookML, dbt, OpenAPI, Databricks, Python AST, or TypeScript AST evidence
  feeds it. No model-assisted synthesis (`--assist`) is built — every
  narrated statement is deterministic, rule-based synthesis, never an LLM
  call. See
  [`docs/architecture-intelligence.md#known-limitations`](docs/architecture-intelligence.md#known-limitations)
  for the complete list. Milestone 3.1 fixed the specific `min-font-size`
  failure self-hosting had surfaced (a static CSS rule, not diagram
  density), but the shared `renderBoxDiagram` layout engine is still not
  density-aware in general — a sufficiently dense repository could still
  trip the same check on the true SVG-diagram scenes.
- Capability Intelligence (Milestone 4) only discovers candidates from
  workflow families, `cli`/`service`-kind runtime components, Terraform
  modules, and README/markdown claims — a `library`/`data-store`/
  `integration`/`unknown`-kind component never produces a candidate on its
  own. This repository's own self-scan previously resolved to a thin result
  (1 qualified capability of 21 candidates) because Architecture
  Intelligence rolled the entire `packages/` tree into one coarse
  `library`-kind, directory-origin component, denying most real candidates a
  `cli`/`service` classification to begin with — that component-granularity
  defect (plus a related default-scan-glob defect that silently skipped
  nested manifests outside JS/TS workspace detection) has since been found
  and fixed. Against the corrected pipeline, this repository's own self-scan
  now resolves 22 real per-package components (up from one coarse bucket)
  and 2 evidence-backed qualified capabilities. See
  [`docs/capability-intelligence.md#closure-condition-remediation`](docs/capability-intelligence.md#closure-condition-remediation)
  for the full traced explanation. No external model.
- Product Identity and Executive Showcase Intelligence (Milestone 5) only
  synthesizes from an already-accepted `CapabilityModel` — a repository whose
  capability model has few included/qualified capabilities will correctly
  resolve to `archetype: unknown` / `confidence: unresolved` rather than
  guess (observed directly on this repository's own thin self-scan). The
  claim-control engine's technical-token detection is a generic regex, not a
  repository-specific denylist, so a legitimate product term that happens to
  look like a package path or camelCase identifier will also be rejected —
  every rejection stays inspectable via `rvs showcase explain` rather than
  silently disappearing. No external model. See
  [`docs/product-identity-intelligence.md#known-limitations`](docs/product-identity-intelligence.md#known-limitations)
  and
  [`docs/executive-showcase-intelligence.md#known-limitations`](docs/executive-showcase-intelligence.md#known-limitations)
  for the complete list.
- Portfolio and Ecosystem Intelligence (Milestone 6) only combines products
  named in `.rvs/portfolio.yml`, using each one's own already-generated
  Milestone 3-5 artifacts — it never re-scans a product repository. Only 4 of
  8 declared `PortfolioGapType` values, 1 of 10 `PortfolioDependencyEdgeKind`
  values beyond `depends_on`, and the `deprecation` decision type are
  currently computed; `upstream_dependency`/`downstream_dependency`/
  `shared_platform`/`shared_contract` relationships are only ever populated
  from `.rvs/portfolio.yml`'s `approved_relationships`, never inferred
  automatically. A capability normalized across two products requires both
  lexical overlap and structural agreement (shared domain/actor/workflow/
  external-system) — lexical overlap alone never merges two capabilities.
  No external model. See
  [`docs/portfolio-intelligence.md#known-limitations`](docs/portfolio-intelligence.md#known-limitations)
  and
  [`docs/portfolio-showcase.md#known-limitations`](docs/portfolio-showcase.md#known-limitations)
  for the complete list.
- Architecture Governance and Continuous Intelligence (Milestone 7) is a
  read-only comparison/policy layer over already-synthesized artifacts —
  it never re-scans a repository and never re-synthesizes an upstream
  artifact. No git-worktree two-commit convenience helper is built (each
  historical state's artifacts must already exist, e.g. via `rvs snapshot
  create` run at each commit); the documented sample GitHub Actions
  workflow step is not itself exercised by a CI run in this repository. The
  11 `GovernanceRuleKind` values are a finite, typed set — never a
  general-purpose expression language — so a `.rvs/governance.yml` policy
  can only express what the evaluator already knows how to check
  deterministically. No external model. See
  [`docs/architecture-governance.md#known-limitations`](docs/architecture-governance.md#known-limitations)
  for the complete list.
- No video export, PowerPoint export, or Canvas/animation renderer.
- Not yet published to the npm registry — see
  [`docs/packaging.md`](docs/packaging.md#current-limitations-before-npm-publication)
  for exactly what's proven versus what remains before publication.
- No plugin marketplace or automated agent-tool-directory installation
  (`rvs agent install`); `rvs skill path` only reports where the packaged
  skill lives.

## Development

```bash
pnpm -r exec tsc --noEmit   # typecheck every package
pnpm test                   # unit tests (vitest)
```
