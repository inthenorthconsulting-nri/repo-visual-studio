# Capability Intelligence Engine (Milestone 4)

This document describes the Capability Intelligence Engine: a new pipeline
stage downstream of Architecture Intelligence that turns architectural
structure into an evidence-gated, conservative model of what the repository
actually *does* — suitable for a generated `CAPABILITIES.md` and, optionally,
executive presentation scenes — without ever inflating the confidence of what
it found.

```
RepositoryModel + WorkflowGraph[] + TerraformTopology[]
  -> ArchitectureIntelligence           (packages/architecture-intelligence, Milestone 3)
  -> CapabilityModel                     (packages/capability-intelligence, this milestone)
  -> CAPABILITIES.md / *.json exports    (packages/capability-intelligence/src/exporter.ts)
  -> capability-intelligence scenes      (packages/visualdoc-schema, packages/narrative-planner, packages/renderer-html)
```

Scope: **synthesis over the `ArchitectureIntelligence` artifact Milestone 3
already produces**, plus a second look at `RepositoryModel`'s markdown
sections for documentation-only/roadmap claims. No new repository adapters,
no external model call, no repository-specific hard-coded capability list —
the engine is handed exactly the same evidence any other repository would
produce and must derive its output purely from that.

**Milestone 6 note.** Milestone 6 — "Portfolio and Ecosystem Intelligence"
— added a further downstream consumer: `capability-model.json` is one of
the two **required** per-product artifacts `@rvs/portfolio-intelligence`
reads when combining multiple products into a `PortfolioModel` (its absence
blocks that product's intake outright, `missing_required_artifact`).
Nothing described in this document changed. See
[`docs/portfolio-intelligence.md#intake-and-compatibility-gate`](portfolio-intelligence.md#intake-and-compatibility-gate)
for the intake contract this artifact participates in.

## Design mandate

> The engine may raise the level of abstraction, but it may never lower the
> level of evidence.

Specific to this milestone:

> A capability is not real merely because it is named. It must have
> sufficient implementation, execution, and evidence to justify inclusion.
> Candidate found ≠ capability implemented.

And the conservative-bias rule that governs every close call in the
pipeline:

> When evidence is incomplete, prefer `exclude` / `include_with_qualification`
> / `gap_only` / `roadmap_only` over incorrectly promoting a capability into
> the current platform narrative.

Concretely:

- Candidate discovery (`candidates.ts`) is deliberately separated from
  inclusion decision (`inclusion-policy.ts`) by three intermediate stages
  (`evidence.ts` → `maturity.ts` → `readiness.ts`) — a candidate can only
  reach `CapabilityModel.includedCapabilities` by passing through all of
  them and clearing every hard gate along the way, not just by scoring
  above a threshold.
- `CapabilityStatus`/`CapabilityInclusion`/`CapabilityConfidence` reuse the
  same shape of vocabulary Architecture Intelligence already uses for its
  own `InferenceClass` (`confirmed`/`derived`/`suggested`/`unresolved`) —
  this layer never invents a second, competing confidence scale.
- Readiness hard gates apply **independent of the numeric score** — a
  candidate with zero implementation evidence cannot reach `include` no
  matter how high its execution/documentation scores are (see
  "Readiness scoring" below).
- Every `Capability` retains its raw `naming.sourceLabel` and `naming.basis`
  even after display-name humanization, and every `ExcludedCapabilityCandidate`
  is kept (not deleted) for auditability — RVS shows its work, including the
  candidates it declined to promote.
- Synthesis is a pure function over the already-cached `ArchitectureIntelligence`
  + `RepositoryModel` (+ optional `WorkflowGraph[]`/`TerraformTopology[]`) —
  it never re-scans the repository and never calls a model, so the same
  cached inputs always produce a byte-identical `CapabilityModel`.

## The `CapabilityModel` contract

Defined in `packages/capability-intelligence/src/contracts.ts`. Cached to
`.rvs/cache/capability-model.json`.

| Field | Shape | Note |
|---|---|---|
| `domains` | `CapabilityDomain[]` | 5-8 durable, repository-agnostic groupings, built only from `include`/`include_with_qualification` capabilities |
| `includedCapabilities` | `Capability[]` | `inclusion === "include"` |
| `qualifiedCapabilities` | `Capability[]` | `inclusion === "include_with_qualification"` — real but with caveats |
| `excludedCandidates` | `ExcludedCapabilityCandidate[]` | kept for auditability, never rendered as a capability |
| `roadmapCapabilities` | `Capability[]` | `inclusion === "roadmap_only"` — the repository's own stated future intent |
| `gapCapabilities` | `Capability[]` | `inclusion === "gap_only"` — operationally meaningful absences; render only under "known limitations", never as a capability |
| `unresolvedCapabilities` | `Capability[]` | reserved for a `Capability` (not a candidate) carrying `confidence: "unresolved"`; empty under the current policy since contradictory evidence always routes to `excludedCandidates` instead |
| `evidenceSummary` | `CapabilityEvidenceSummary` | disaggregated counts per bucket, plus a `ConfidenceSummary` rollup — never a single blended "N capabilities" metric |
| `generationMetadata` | `CapabilityGenerationMetadata` | `generated_at`, `git_commit`, `schema_version`, the source architecture-intelligence timestamp, the actual readiness weights/thresholds used |

`CapabilityStatus` (9 values): `operational` | `implemented` | `partial` |
`experimental` | `planned` | `scaffolded` | `deprecated` | `abandoned` |
`unknown`.

`CapabilityInclusion` (5 states, the conservative-bias vocabulary above):
`include` | `include_with_qualification` | `exclude` | `roadmap_only` |
`gap_only`.

`CapabilityGranularity` (5 values, only `capability`-grain candidates may
become a primary `CAPABILITIES.md` entry): `domain` | `capability` |
`feature` | `implementation_step` | `artifact`.

## Pipeline

`synthesizeCapabilities(input)` (`packages/capability-intelligence/src/index.ts`)
runs a fixed pipeline of pure functions:

| Module | Responsibility |
|---|---|
| `candidates.ts` | `discoverCapabilityCandidates()` — four sources: workflow families (strongest — real, parsed, executable GitHub Actions workflows), CLI/service runtime components, Terraform-provisioned infrastructure modules, and README/markdown sections that read as a behavioral claim. Never treats a raw directory name as a final capability name; documentation-derived candidates are deliberately the weakest source (§6: "documentation alone must never prove implementation"). `mergeDuplicateCandidates()` folds two candidates into one when they share both a workflow id and a logical-component id, so the same real capability discovered from two evidence angles doesn't become two rows later. |
| `evidence.ts` | `aggregateCandidateEvidence()` — rolls a candidate's raw `CapabilityEvidence[]` into flags (`hasWorkflow`, `hasImplementation`, `isDocumentationOnly`, `isContradictory`, `meetsStrongConfirmation`, …) the later stages reason over. |
| `maturity.ts` | `assessCapabilityMaturity()` — five independent scoring functions (implementation, execution, verification, documentation, adoption) plus blocker/qualifier derivation. Documentation alone can score the documentation axis but never the implementation axis. |
| `readiness.ts` | `computeCapabilityReadiness()` / `classifyCapabilityStatus()` — the weighted 0-100 score, then hard gates applied **on top of**, not instead of, the threshold classification. |
| `inclusion-policy.ts` | `decideCapabilityInclusion()` — the conservative-bias decision: `include` is reachable only through `implemented`/`operational` status with zero blocking evidence problems; everything else routes to qualification, exclusion, roadmap, or gap per the specific reason. |
| `grouping.ts` | `buildCapabilityDomains()` — groups only `include`/`include_with_qualification` capabilities into 5-8 domains; emits `CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN` and `CAP_INTEL_OVER_GRANULAR_DOMAIN` (>8 domains) warnings. |
| `outcomes.ts` | `deriveCapabilityOutcome()` — evidence-supported outcome statements only; no invented quantified savings, no production-use claims without production evidence, kept under 24 words where possible. |
| `label.ts` | `humanizeCapabilityName()` — strips a leading implementation-verb word (parse/load/write/run/exec/…) from a candidate's display label while preserving the original in `naming.basis` for traceability. |
| `validation.ts` | `validateCapabilityModelStructure()` — pure, no-DOM structural checks over the assembled `CapabilityModel` (see "Validation" below). |
| `exporter.ts` | `exportCapabilitiesMarkdown()` / `exportCapabilityModelJson()` / `exportCapabilityCandidatesJson()` / `exportCapabilityExclusionsJson()`. |

This mirrors, deliberately, how `@rvs/architecture-intelligence` structures
its own synthesis pipeline (`packages/architecture-intelligence/src/synthesize/`)
— a sequence of small, pure, single-responsibility modules composed by one
entrypoint, no shared mutable state between stages.

### Evidence strength

`CAPABILITY_EVIDENCE_STRENGTH` (`contracts.ts`) is the base weight per
evidence type — the literal `strength` stamped on each `CapabilityEvidence`
instance is what `maturity.ts`/`readiness.ts` actually consume (a given type
can be stronger or weaker in context, e.g. an end-to-end test vs. a unit
test), but this table is the default:

| Evidence type | Strength |
|---|---|
| `workflow`, `runtime_entrypoint`, `deployment`, `release` | 5 |
| `implementation`, `configuration`, `test`, `schema` | 4 |
| `usage` | 3 |
| `documentation`, `example` | 1 |
| `todo_marker` | 0 |
| `deprecated_marker` | -3 |

### Incomplete-signal keywords

18 keywords (`INCOMPLETE_CAPABILITY_SIGNAL_KEYWORDS`) — `todo`, `fixme`,
`planned`, `future`, `placeholder`, `stub`, `scaffold`, `not implemented`,
`not yet supported`, `coming soon`, `experimental only`, `example only`,
`deprecated`, `archived`, `disabled`, `mock`, `prototype`, `draft` — used
only *together with* structural evidence as one signal among several, never
as a lone string match that alone excludes a candidate.

### Readiness scoring

Weighted 0-100 (`DEFAULT_CAPABILITY_READINESS_WEIGHTS`): Implementation 35,
Execution 25, Verification 20, Documentation 10, Adoption 10.

Thresholds (`DEFAULT_CAPABILITY_READINESS_THRESHOLDS`): score ≥85 →
`operational`, ≥70 → `implemented`, ≥45 → `partial`, ≥25 → `experimental`,
≥10 → `scaffolded`, below 10 → `planned`/unsupported.

Both are configurable per `synthesizeCapabilities()` call (not hard-coded
constants baked into the pipeline functions), but the CLI always uses the
defaults above.

Hard gates apply **independent of the numeric score** — e.g. zero
implementation evidence caps a candidate at `SCAFFOLD_ONLY`/exclusion
regardless of how high its execution score is; a workflow that runs but has
zero verification/documentation/adoption evidence is capped at
`INSUFFICIENT_IMPLEMENTATION_EVIDENCE` regardless of its execution score
alone. See "Self-hosting proof" below for two real, concrete examples of
this from RVS's own repository.

### Exclusion reason codes (13)

`CapabilityExclusionReasonCode`: `INSUFFICIENT_IMPLEMENTATION_EVIDENCE`,
`NO_EXECUTION_PATH`, `DOCUMENTATION_ONLY`, `TEST_ONLY`, `EXAMPLE_ONLY`,
`PLACEHOLDER_IMPLEMENTATION`, `SCAFFOLD_ONLY`, `PLANNED_NOT_IMPLEMENTED`,
`DISABLED_CAPABILITY`, `DEPRECATED_CAPABILITY`, `ABANDONED_CAPABILITY`,
`UNRESOLVED_CONTRADICTORY_EVIDENCE`, `EXTERNAL_RUNTIME_REQUIRED`.

Every `ExcludedCapabilityCandidate` carries at least one of these plus a
human-readable `reasonSummary` — never a bare "excluded" with no reason.

Four codes originally in this contract — `TOO_GRANULAR`,
`DUPLICATE_CAPABILITY`, `NOT_USER_MEANINGFUL`, `NO_SUPPORTED_OUTCOME` — were
removed rather than wired up, during the closure-condition pass below (see
"Closure-condition remediation"): each is already handled correctly at a
later pipeline stage that has information `decideCapabilityInclusion()` does
not (granularity/duplicate-name detection needs the final rendered display
name — `CAP_INTEL_CAPABILITY_TOO_GRANULAR` / `CAP_INTEL_DUPLICATE_CAPABILITY`
in `validation.ts`; unsupported-outcome detection needs the finalized
outcome claim, which is only computed after the inclusion decision —
`CAP_INTEL_UNSUPPORTED_OUTCOME`), and "user meaningful" cannot be formalized
generically without either an LLM judgment call or repository-specific
hardcoding, both forbidden by this package's constraints. Adding inclusion-
policy branches for any of these would have been redundant with, or worse
than, the existing checks.

## Validation

One tier, pure structural — no rendered DOM exists for capability scenes to
audit yet (see "Presentation integration" below), so this mirrors how
`@rvs/architecture-intelligence`'s own Tier 1 structural validator
(`validate-structure.ts`) lives directly inside the producing package rather
than being duplicated into `@rvs/validator` — `@rvs/validator` is reserved
for checks that need a rendered `VisualDoc` + HTML string, which
`architecture-intelligence-checks.ts` demonstrates is a real, distinct
concern (label-integrity, word-budget, staleness) from structural
model validation.

`validateCapabilityModelStructure(model)` (`packages/capability-intelligence/src/validation.ts`),
run automatically by `rvs synthesize capabilities` before caching:

| Code | Meaning |
|---|---|
| `CAP_INTEL_DOCUMENTATION_ONLY_CAPABILITY` | an included/qualified capability has only documentation-type evidence |
| `CAP_INTEL_NO_EXECUTION_PATH` | an `operational`/`implemented` capability has zero execution-axis evidence |
| `CAP_INTEL_PLACEHOLDER_PROMOTED` | a candidate flagged placeholder reached `include`/`include_with_qualification` |
| `CAP_INTEL_SCAFFOLD_PROMOTED` | a `scaffolded`-status capability was promoted to current-capability inclusion |
| `CAP_INTEL_PLANNED_CAPABILITY_PROMOTED` | a `planned`-status capability was promoted to current-capability inclusion |
| `CAP_INTEL_DEPRECATED_CAPABILITY_PROMOTED` | a `deprecated`-status capability was promoted to current-capability inclusion |
| `CAP_INTEL_PARTIAL_CAPABILITY_UNQUALIFIED` | a `partial`-status capability was included without qualification |
| `CAP_INTEL_UNSUPPORTED_OUTCOME` | an outcome statement isn't traceable to evidence |
| `CAP_INTEL_RAW_PATH_AS_CAPABILITY_NAME` | a display name looks like a raw source path rather than a humanized name |
| `CAP_INTEL_CAPABILITY_TOO_GRANULAR` | a non-`capability`-granularity item reached a primary bucket |
| `CAP_INTEL_DUPLICATE_CAPABILITY` | two capabilities share a display name |
| `CAP_INTEL_EMPTY_DOMAIN` | a domain has zero capabilities |
| `CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS` | a domain id is referenced only by roadmap capabilities, no visible current capability |
| `CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN` | a domain has exactly one non-operational capability |
| `CAP_INTEL_OVER_GRANULAR_DOMAIN` | more than 8 domains were synthesized |
| `CAP_INTEL_MISSING_EVIDENCE` | a capability has zero evidence entries |
| `CAP_INTEL_CONTRADICTORY_EVIDENCE` | a capability's evidence set contains a direct contradiction |
| `CAP_INTEL_UNKNOWN_STATUS_IN_EXECUTIVE_OUTPUT` | a capability with `status: "unknown"` reached a current-capability bucket |
| `CAP_INTEL_EXCLUDED_CAPABILITY_COUNTED_AS_CURRENT` | an excluded candidate's id also appears counted in a current-capability metric |
| `CAP_INTEL_ROADMAP_ITEM_COUNTED_AS_CURRENT` | a roadmap capability's id also appears counted in a current-capability metric |
| `CAP_INTEL_NONDETERMINISTIC_ORDER` | array ordering isn't stably sorted by id |

## CLI

```bash
rvs synthesize capabilities
  # reads .rvs/cache/architecture-intelligence.json (required — run `rvs synthesize architecture` first)
  # + .rvs/cache/repository-model.json, .rvs/cache/{workflow-graphs,terraform-topologies}.json (optional)
  # -> .rvs/cache/capability-model.json, .rvs/cache/capability-candidates.json (diagnostic dump), running structural validation inline

rvs export capabilities --output CAPABILITIES.md
  # default: includes "Available with limitations" + "Known capability gaps", excludes roadmap + excluded-candidate diagnostics

rvs export capabilities --include-partial --include-gaps --output CAPABILITIES.md
  # explicit form of the default above

rvs export capabilities --include-roadmap --include-excluded --output CAPABILITIES-full.md
  # full diagnostic export, also writes capability-exclusions.json

rvs capabilities explain <capability-id>
  # full evidence/readiness/inclusion detail for one capability or excluded candidate, by id or display name
```

`rvs validate --ci` runs the existing Playwright deterministic checks against
the rendered deck, and — as of the closure-condition pass below — also runs
`validateCapabilityModelStructure()` against `.rvs/cache/capability-model.json`
when that cache file is present (`validateCachedCapabilityModel()` in
`packages/cli/src/commands/validate.ts`), writing
`artifacts/visuals/capability-validation-report.json`. Any structural
`CAP_INTEL_*` warning of severity `"error"` fails `--ci` unconditionally, the
same way a contrast/overflow failure does; a repository that has never run
`rvs synthesize capabilities` sees no change in behavior at all — the check
is skipped entirely rather than failing closed.

## Presentation integration

A new VisualDoc scene type, `capability-intelligence-overview`
(`packages/visualdoc-schema/src/schema.ts`), keyed by `model_id` and
resolved against a `CapabilityModel[]` array threaded through
`renderVisualDocToHtml()` — the same pattern `architecture-intelligence`
scenes use to resolve against `ArchitectureIntelligence[]` by `identity.id`,
except `CapabilityModel`'s identity has no dedicated id field, so
`systemIdentity.displayName` is the resolution key instead.

This is a deliberately distinct scene type from the pre-existing
`capability-map` kind that already renders `ArchitectureIntelligence.capabilityDomains`
(Milestone 3's coarser rollup, with no per-capability evidence-and-maturity
gate) — the two are never conflated in either the schema or the renderer.

`packages/renderer-html/src/scenes/capability-intelligence/render.ts`
renders one scene: a disaggregated summary line, one card grid per domain
(included + qualified capabilities only — the same conservative default
`exportCapabilitiesMarkdown()` uses), a "Known gaps" section, and a static
limitations note. Every capability card and gap list item stamps
`data-capability-status`, `data-capability-inclusion`, and
`data-capability-confidence` attributes with the capability's real enum
values — never roadmap-only or excluded candidates, matching the exporter's
conservative default.

`packages/narrative-planner/src/capability-intelligence-visualdoc-builder.ts`'s
`buildCapabilityIntelligenceScenes()` builds the one scene from a
`CapabilityModel`. `rvs create slides` (`packages/cli/src/commands/create-slides.ts`)
optionally reads `.rvs/cache/capability-model.json` — if `rvs synthesize
capabilities` hasn't been run, the deck renders exactly as it did before
this milestone, with no capability scene at all.

## `CAPABILITIES.md` structure

`exportCapabilitiesMarkdown()` (`packages/capability-intelligence/src/exporter.ts`):
generation-provenance header, platform purpose, a capability summary table
(disaggregated counts — included/qualified/gap/roadmap/excluded, never one
blended number), one section per capability domain (each capability rendered
with its purpose, evidence-supported outcome if any, and qualifiers),
"Available with limitations" (qualified capabilities), "Known capability
gaps" (`gapCapabilities`), an opt-in "Roadmap" section, an opt-in "Excluded
candidates" diagnostics table, and an evidence/generation-metadata footer.

## Self-hosting proof

Run against `repo-visual-studio` itself: `rvs inspect` (282 files, 44
evidence claims) → `rvs create workflow --all` (1 workflow, 5 warnings, 0
errors) → `rvs synthesize architecture` (22 components, 2 flows, 1 warning —
after the closure-condition component-granularity fixes below; 6 components
before them) → `rvs synthesize capabilities` → `rvs export capabilities`
(both the default and `--include-roadmap --include-excluded` forms) → `rvs
validate --ci` (44 deck checks passed, 0 failed; capability model: 0 errors,
0 warnings).

**Current result (after all fixes on this page, including the
closure-condition pass): 0 included, 2 qualified, 0 gaps, 11 roadmap-only, 2
excluded (of 15 candidates), 0 errors, 0 warnings.** The two qualified
capabilities are `@rvs/cli` itself (readiness 64 — `runtime_entrypoint` +
`implementation` + `test` evidence, now correctly resolved as its own
`kind: "cli"` component instead of being folded into a single
`packages/`-wide `library` bucket) and the CI workflow's "Other Automation"
family (readiness 62 — `workflow` + `implementation` + `test` +
`runtime_entrypoint` evidence). See "Closure-condition remediation" below
for exactly what changed between the intermediate result documented further
down this section and this current one.

**First run result: 0 included, 0 qualified, 0 gaps, 10 roadmap-only, 4
excluded (of 14 candidates), 0 errors, 1 warning.** This number was
investigated rather than accepted at face value, and the investigation found
a real, in-scope engine defect (see "Defect found and fixed" below), not a
defensible conservative outcome. It was fixed, and the corrected pipeline was
re-run: **0 included, 1 qualified, 0 gaps, 14 roadmap-only, 6 excluded (of 21
candidates), 0 errors, 1 warning** (candidate count rose because this
document's own drafts, cached in the repository while this section was being
written, were themselves picked up as weak documentation-only candidates —
correctly excluded at readiness 4, a harmless meta-artifact of self-hosting
against a repository that contains its own design docs).

### Defect found and fixed

Independent code tracing (`candidates.ts` → `evidence.ts` → `maturity.ts` →
`readiness.ts` → `inclusion-policy.ts`), corroborated by three independently
generated cross-repository fixtures (see "§22 cross-repository fixtures"
below) that *also* produced 0 included / 0 qualified despite one being built
specifically with a real CLI, tests, and a scheduled workflow, established
that `include` / `include_with_qualification` were **structurally
unreachable for any repository**, not just RVS's own self-scan. Root cause:
`packages/capability-intelligence/src/candidates.ts` never emitted
`implementation`, `configuration`, or `test`-type `CapabilityEvidence` for
any candidate, because its one nominal source —
`component.implementation.entryPoints` — is unconditionally hardcoded to
`[]` throughout `architecture-intelligence/src/synthesize/components.ts`.
Every candidate's weighted readiness score was capped below the 45-point
"partial" threshold regardless of how strong its underlying repository
evidence actually was (workflow-family candidates topped out around 34;
CLI/service components around 23; Terraform modules around 10;
documentation-only around 4).

The fix adds evidence emission grounded only in data the pipeline already
had confirmed access to — nothing fabricated, no new scanning:

- `candidatesFromWorkflowFamilies()`: each real workflow YAML file is now
  also `implementation`-type evidence (distinct from the existing
  `workflow`-type evidence, which attests executability, not authorship);
  and a workflow step whose label matches a test-invocation pattern
  (`test`, `spec`, `vitest`, `jest`, `pytest`, `mocha`, word-bounded) becomes
  real `test`-type evidence.
- `candidatesFromRuntimeComponents()`: `component.sourcePaths` beyond the
  one already used for `runtime_entrypoint` become `implementation`-type
  evidence, split from `test`-type evidence by filename convention
  (`.test.`/`.spec.`/`__tests__/`/`tests?/`).
- `candidatesFromTerraform()`: the Terraform root module path is now also
  `configuration`-type evidence, distinct from the existing
  `deployment`-type evidence (which attests provisioning, not authorship).

Hand-verified this does not over-promote weak candidates: RVS's own
`examples/terraform/self-hosting` fixture module still lands at readiness 15
("scaffolded", excluded `SCAFFOLD_ONLY`) even with `configuration` evidence
added, because it still has no workflow/runtime-entrypoint/implementation
evidence beyond the module declaration itself. RVS's own real, executing CI
workflow family, by contrast, now correctly reaches readiness 62
("partial" → `include_with_qualification`), backed by `workflow` +
`implementation` + `test` (from the CI workflow's own `test` job) +
`runtime_entrypoint` evidence — a materially different, evidence-backed
outcome from the same conservative gate, not a loosened one.

This surfaced a second, smaller pre-existing bug while writing the test that
exercises this exact interaction: `maturity.ts`'s `scoreAdoption()` granted
+20 for `hasDeployment`, double-counting it against `scoreExecution()`'s own
+30 for the same evidence, and — as a consequence — making the
"external-runtime-dependent, zero adoption evidence" qualifier at
`assessCapabilityMaturity()` unreachable for exactly the Terraform-only
candidates it exists to flag (deployment evidence alone always pushed
adoption to 20, never 0). Fixed by removing the `hasDeployment` contribution
from `scoreAdoption()`; deployment evidence continues to score execution
only. A third small bug was found and fixed in the same pass: the
`CAP_INTEL_UNSUPPORTED_OUTCOME` validator's regex (`saves? \$?\d`) matched
only a single digit before requiring a word boundary, so it silently missed
multi-digit claims like "saves $50,000" (no `\b` between adjacent digits);
widened to `saves? \$?[\d,]+`.

### Remaining limitation at the time this section was first written (since fixed)

RVS's own real, working capabilities (`rvs inspect`, `rvs create workflow`,
`rvs synthesize capabilities`, etc.) did not appear as candidates in this
repository's self-scan, for a separate, pre-existing reason this milestone
did not originally change: Architecture Intelligence's own component
classifier, scanning this specific repository (a 15-plus-package pnpm
monorepo), rolled the entire `packages/` tree into one coarse
`kind: "library"`, `origin: "repository-directory"` component rather than
resolving the individual `@rvs/cli` package (which has a real `bin`
entrypoint) as its own `kind: "cli"` component.
`candidatesFromRuntimeComponents()` only looks for `kind === "cli" |
"service"`, so this directory-bucket component produced no candidate. At the
time, this was left as an out-of-scope Architecture Intelligence
characteristic rather than fixed. It has since been fixed as part of the
closure-condition pass — see "Closure-condition remediation" immediately
below for the root cause and the fix.

## Closure-condition remediation

A subsequent pass addressed seven outstanding closure conditions raised
against this milestone. Two were architecturally significant enough to
require direct changes to already-shipped Architecture Intelligence logic;
the other five were delegated to independent, file-disjoint background
agents and then independently re-verified (diffs read, full test suites
re-run) rather than accepted on their own reports.

1. **Component granularity for monorepos (fixed).** Two compounding defects
   were root-caused via this repository's own self-hosting re-run:
   - `DEFAULT_INCLUDE`/`DEFAULT_EXCLUDE` in `packages/core/src/config.ts`
     used bare manifest filenames (`"package.json"`, `"pyproject.toml"`,
     etc.), which fast-glob matches only at the repository root — every
     nested workspace/module manifest was silently unscanned for any
     repository not covered by JS/TS-specific `workspaceSourcePatterns()`
     detection, and even then only for JS/TS ecosystems. Fixed by
     broadening every non-root-only pattern to a `**/`-prefixed glob
     (`**/package.json`, `**/pyproject.toml`, `**/go.mod`, `**/Cargo.toml`,
     `**/pom.xml`, `**/build.gradle`, `**/Gemfile`, `**/src/**`) — `**/`
     also matches a zero-segment prefix, so root-level manifests are still
     covered. `pnpm-workspace.yaml` was deliberately left root-only, since
     pnpm itself only ever honors it there.
   - `classifyWorkspacePackage()` in
     `packages/architecture-intelligence/src/synthesize/components.ts`
     checked its directory-name regex fallback (`/infra|terraform|deploy/i`
     etc.) before checking the manifest-declared `hasLibraryExport` signal,
     so a real library package whose directory name happened to match a
     different kind's regex — e.g. `packages/terraform-graph`, a genuine
     library with `"main": "src/index.ts"` — was misclassified by name
     instead of by evidence. Fixed by reordering the checks so
     manifest-declared evidence (stronger, direct) takes priority over the
     name-substring heuristic (weaker, indirect); covered by a new
     regression test using this exact real-world case
     (`packages/architecture-intelligence/src/__tests__/components.test.ts`).

   Together these took this repository's own self-scan from one coarse,
   directory-bucket `library` component covering the entire `packages/`
   tree to 22 real per-package components, each independently classified
   from its own manifest.

2. **Self-hosting yield (fixed, as a consequence of #1).** With component
   granularity fixed, this repository's own capability model went from a
   single generic qualified capability to two evidence-backed qualified
   capabilities (`@rvs/cli` and the CI workflow's automation family) — see
   the updated "Self-hosting proof" numbers above. The `Api`-registered
   readiness of both remains `partial`/qualified rather than fully
   `include`d, consistent with the conservative-bias mandate: neither
   candidate's evidence clears the `operational`/`implemented` execution +
   verification hard gates on its own.

3. **Packaged-tarball smoke coverage (fixed).**
   `packages/cli/src/__tests__/package-smoke.test.ts` now includes a test
   that runs `synthesize architecture` → `synthesize capabilities` →
   `export capabilities` → `capabilities explain` against a packed npm
   tarball installed outside the workspace, gated behind
   `RVS_TEST_PACKAGE=1` alongside the package's other packaging tests.

4. **Source-vs-package equivalence coverage (fixed).**
   `packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` was
   extended to diff the capability-model cache and `CAPABILITIES.md` output
   produced from source against the same commands run from the packed
   tarball, confirming byte-for-byte (or structurally identical, where
   generation timestamps differ) output.

5. **CI validation wiring (fixed).** `.github/workflows/ci.yml`'s
   `build-deck` job now runs `rvs synthesize architecture` and
   `rvs synthesize capabilities` before `rvs validate --ci`, and
   `rvs validate` itself now runs `validateCapabilityModelStructure()`
   against the cached capability model whenever one exists (see "CLI"
   above) — capability validation is on the standard CI path, not only
   reachable by directly invoking `synthesize capabilities`.

   Verifying this end-to-end surfaced one real, previously-undetected
   defect: the `capability-intelligence-overview` scene's CSS
   (`packages/renderer-html/src/styles.ts`) failed `rvs validate --ci`'s
   `min-font-size` (`.cap-badge`/`.cap-card-meta` set below the 14px
   minimum) and `contrast` (`.cap-badge-status` set its text color to
   `var(--rvs-color-background)` — the same variable the validator compares
   text color against, since it reads the outer `.scene` element's
   background rather than a badge's own local background, guaranteeing an
   exact 1.00:1 ratio) checks. This reproduced identically against RVS
   itself and all three cross-repository fixtures. The background agent
   that wired up CI validation did not catch this because its own
   verification exercised `validateCachedCapabilityModel()` directly against
   synthetic fixtures with no deck rendering involved, never the full
   `runValidate()` → Playwright → `deck.html` path. Both CSS rules were
   fixed (font sizes raised to 14px; the badge's text color changed to
   `var(--rvs-color-text-primary)`); no test asserted on the old values, so
   no test changes were needed.

6. **Reason and warning codes (fixed).** Of the original
   `CapabilityExclusionReasonCode` set, four codes that could not be
   reached without either an external model or repository-specific
   hardcoding were removed rather than left dead (see "Exclusion reason
   codes" above). Both previously-unreachable `CapIntelWarningCode` values —
   `CAP_INTEL_PLACEHOLDER_PROMOTED` and `CAP_INTEL_NONDETERMINISTIC_ORDER` —
   were wired up in `validation.ts` instead of removed, since both describe
   real, checkable conditions. A new `Capability.matchedIncompleteSignals:
   string[]` field, threaded from `CapabilityCandidate` through
   `buildCapability()`, is what makes `CAP_INTEL_PLACEHOLDER_PROMOTED`
   possible to check post-decision.

7. **Self-referential documentation filtering (fixed).**
   `packages/capability-intelligence/src/candidates.ts` gained a generic,
   structural filter (`REPORT_NARRATIVE_HEADING_PATTERN`,
   `NUMBERED_OUTLINE_HEADING_PATTERN`, `isReportNarrativeSection()`) that
   suppresses markdown sections whose own heading, or nearest enclosing
   heading, reads as changelog/milestone/status-report/postmortem narrative
   (e.g. "Milestone 4", "Defects found and fixed", "Self-hosting proof") —
   or, only when the containing document as a whole already reads as such a
   report, a bare numbered-outline heading like "2. Defects found and
   fixed". This is keyed to generic documentation conventions (changelogs,
   sprint retros, postmortems), never to this repository's own filenames or
   vocabulary — a plain product-documentation heading like "##
   Authentication" matches none of it. Ancestry is reconstructed from the
   existing `depth` + document-order fields the markdown adapter already
   produces; no schema change was needed.

Every fix above was verified against a fresh, from-scratch pipeline re-run
(not assumed from the responsible agent's own report where a background
agent did the work), and the full workspace test suite (`pnpm -r exec tsc
--noEmit` and `pnpm exec vitest run`) was re-run clean after each one. No
commit was made — all changes remain in the working tree, per the standing
"do not commit" constraint.

`capability-model.json` is also consumed by Milestone 7's Architecture
Governance and Continuous Intelligence layer: `@rvs/governance-intelligence`'s
`capability-diff.ts` diffs two snapshots' copies of this artifact to detect
capability status regressions (e.g. `operational` regressing to `planned`)
between a baseline and the current state, feeding the governance policy
engine's `forbid_operational_to_planned_regression` rule kind. See
[`docs/architecture-governance.md`](architecture-governance.md).

`capability-model.json` is also consumed by Milestone 8's Architecture
Decision Intelligence layer: `@rvs/decision-intelligence`'s
`capability-links.ts` resolves a decision's declared `domain: capability`
links against this artifact's own entity ids, using the same bounded
structural-walk pattern `architecture-links.ts` uses (decision-intelligence
never imports this package's types). See
[`docs/architecture-decision-intelligence.md`](architecture-decision-intelligence.md)
and [`docs/decision-linking.md`](decision-linking.md).

## Known limitations

- **`candidatesFromRuntimeComponents()` only considers `kind: "cli"` and
  `kind: "service"` components.** `library`, `data-store`, `integration`,
  and `unknown`-kind components never produce a candidate directly, even
  when they carry real implementation evidence, unless that evidence is
  also reachable through a workflow-family or Terraform-module candidate.
  This remains deliberately unwidened: a `library`-kind component carries no
  entry-point-level evidence to distinguish "a well-tested working library"
  from "a pile of files," and widening the filter without that distinction
  would risk exactly the kind of evidence-inflation the conservative-bias
  mandate forbids.
- **No model-assisted synthesis.** Every stage is deterministic, rule-based,
  offline synthesis — no network access, no LLM dependency, matching
  Architecture Intelligence's own `assist_used: false` contract.

## Package summary

| Package | Role |
|---|---|
| `@rvs/capability-intelligence` | `CapabilityModel` types, the full candidate → evidence → maturity → readiness → inclusion pipeline, structural validation, Markdown/JSON exporters |
| `@rvs/cli` | `rvs synthesize capabilities`; `rvs export capabilities`; `rvs capabilities explain <id>` |
