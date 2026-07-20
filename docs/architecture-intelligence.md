# Architecture Intelligence Engine (Milestone 3, amended by Milestone 3.1; consumed by Milestone 4)

This document describes the Architecture Intelligence Engine: turning the
evidence already produced by earlier milestones — `RepositoryModel`,
`WorkflowGraph[]`, `TerraformTopology[]` — into a coherent, audience-aware,
four-level architecture narrative, without lowering the level of evidence
that made those artifacts trustworthy in the first place.

**Milestone 3.1 amendment.** Milestone 3.1 — "Architecture Presentation
Quality Remediation" — improved presentation quality on top of Milestone 3's
contract without changing it: sharper system-identity/purpose fallback
chains, a coarser capability-domain rollup, ranked representative-workflow
selection, conclusion-oriented headlines with a real word budget, a
logical-architecture scene that excludes raw directory groupings when real
architectural components exist, three new Tier 1 validator codes, and a fix
for the `min-font-size` failure this document's Self-hosting proof and Known
limitations sections previously described as an open, out-of-scope issue
(see both sections below, updated in place). See
[`docs/milestones.md`](milestones.md#milestone-31--architecture-presentation-quality-remediation)
for the full closure record. Everything else in this document describes
Milestone 3's original, unchanged contract.

**Milestone 4 note.** Milestone 4 — "Evidence-Gated Capability Intelligence"
— added a new synthesis stage that consumes this document's
`ArchitectureIntelligence` artifact as its primary input, without changing
anything described here. It also surfaced a pre-existing characteristic of
this engine's own component classifier worth noting alongside "Known
limitations" below: for a large pnpm-style monorepo, `RUNTIME_COMPONENT`
extraction currently resolves an entire multi-package directory tree (e.g.
this repository's own `packages/`) into a single coarse `kind: "library"`,
`origin: "repository-directory"` component with no `entryPoints`, rather
than resolving each individual package as its own component — see
[`docs/capability-intelligence.md#self-hosting-proof`](capability-intelligence.md#self-hosting-proof)
for the downstream effect this has on Capability Intelligence's self-hosting
result. This was not changed by Milestone 4; it is documented here as an
open characteristic of Milestone 3's own component model.

**Milestone 6 note.** Milestone 6 — "Portfolio and Ecosystem Intelligence"
— added a further downstream consumer: `architecture-intelligence.json` is
one of the four **optional** per-product artifacts `@rvs/portfolio-intelligence`
reads when combining multiple products into a `PortfolioModel` (its absence
only downgrades a product's intake to `compatible_with_warnings`, never
blocks it). Nothing described in this document changed. See
[`docs/portfolio-intelligence.md#intake-and-compatibility-gate`](portfolio-intelligence.md#intake-and-compatibility-gate)
for the intake contract this artifact participates in.

```
RepositoryModel + WorkflowGraph[] + TerraformTopology[]  (all already cached)
  -> ArchitectureIntelligence          (packages/architecture-intelligence)
  -> architecture-intelligence scenes  (packages/visualdoc-schema, packages/narrative-planner)
  -> HTML rendering                     (packages/renderer-html)
  -> label/budget/staleness validation  (packages/validator)
```

Scope: **synthesis over evidence already produced by Milestones 1-2.** No new
repository adapters (Kubernetes, LookML, dbt, OpenAPI, Databricks, Python
AST, TypeScript AST) were started for this milestone — the engine consumes
exactly the same three inputs the CLI already caches (`repository-model.json`,
`workflow-graphs.json`, `terraform-topologies.json`) and combines them, it
does not scan anything new. Model-assisted synthesis (`--assist`) is
explicitly deferred — everything described below is deterministic, offline,
rule-based synthesis; no network access, no LLM dependency.

## Design mandate

> The engine may raise the level of abstraction, but it may never lower the
> level of evidence.

Concretely:

- Every synthesized fact is an `InferredStatement`
  (`packages/architecture-intelligence/src/types.ts`) — a `value` plus one of
  four **inference classes**, plus its `evidence: EvidenceReference[]`:

  | Class | Meaning |
  |---|---|
  | `confirmed` | directly stated or structurally explicit in evidence |
  | `derived` | computed deterministically from multiple confirmed facts |
  | `suggested` | a plausible interpretation that requires human review |
  | `unresolved` | insufficient or contradictory evidence to say anything |

- `suggested`/`unresolved` statements are never silently presented as fact:
  `qualifierFor(inference)` (`packages/architecture-intelligence/src/inference.ts`)
  prefixes rendered text with `"Likely: "` / `"Unconfirmed: "` respectively,
  and this is independently re-checked against the *rendered HTML* by two
  validator checks (see below), not just trusted at the point of rendering.
- No quantitative benefit or outcome is ever fabricated: `ArchitectureOutcome.quantified`
  is optional, and a quantified outcome with no `EvidenceReference` behind its
  number is a structural **error** (`ARCH_INTEL_QUANTIFIED_OUTCOME_MISSING_EVIDENCE`),
  not a warning.
- Synthesis is a pure function over already-cached artifacts
  (`synthesizeArchitectureIntelligence`, see below) — it never re-scans the
  repository and never calls a model, so the same three cached inputs always
  produce a byte-identical `ArchitectureIntelligence` artifact.

## The `ArchitectureIntelligence` contract

Defined in `packages/architecture-intelligence/src/types.ts`. A single
artifact, cached to `.rvs/cache/architecture-intelligence.json`, holding:

| Field | Shape | Note |
|---|---|---|
| `identity` | `SystemIdentity` | one-line description, `repositoryKind` (`single-service`\|`monorepo`\|`library`\|`unknown`) |
| `purpose` | `PurposeModel` | problem statement, target users, scope boundaries |
| `responsibilities` | `Responsibility[]` | kind (`automation`\|`governance`\|`infrastructure`\|`data`\|`integration`\|`operations`\|`security`\|`unknown`) |
| `capabilityDomains` | `CapabilityDomain[]` | groups responsibilities + components + workflow families under one label |
| `components` | `LogicalComponent[]` | carries an `ImplementationView` (file paths, graph/topology ids, entry points) — Level 3/4 detail that never leaks into Level 1/2 narration |
| `actors` | `Actor[]` | `human-role`\|`external-service`\|`automation` |
| `externalSystems` | `ExternalSystem[]` | from Terraform providers |
| `flows` | `ArchitectureFlow[]` | `trigger`\|`data`\|`deployment`\|`approval`\|`integration`, `fromId`/`toId` into the entity graph |
| `boundaries` | `ArchitectureBoundary[]` | `trust`\|`network`\|`deployment-environment`\|`organizational` |
| `operatingModel` | `OperatingModel` | deployment environments, release process, observability, approval gates |
| `outcomes` | `ArchitectureOutcome[]` | qualitative by default; `quantified` only with real evidence |
| `risks` | `ArchitectureRisk[]` | severity `low`\|`medium`\|`high` |
| `dependencies` | `ArchitectureDependency[]` | `runtime`\|`build`\|`external-service`\|`infrastructure` |
| `questions` | `ArchitectureQuestion[]` | one per suggested/unresolved/conflicting/missing-evidence gap — the engine's explicit "here's what I couldn't confirm" list |
| `workflowFamilies` | `WorkflowFamily[]` | named groupings of `WorkflowGraph[]`, with a `representativeWorkflowGraphId` |
| `metadata` | `ArchitectureIntelligenceMetadata` | `generated_at`, `git_commit`, `source_repository_model_generated_at`, graph/topology counts, `assist_used` (always `false` today), and a `ConfidenceSummary` rollup |

Every named entity (`Responsibility`, `CapabilityDomain`, `LogicalComponent`,
`Actor`, ...) carries a `NormalizedLabel` (`sourceLabel`/`displayLabel`/`shortLabel`)
rather than a bare string — canonical ids are derived from the raw source
label and never altered by display normalization, so the same input always
produces the same id.

## Synthesis pipeline

`synthesizeArchitectureIntelligence(input)`
(`packages/architecture-intelligence/src/synthesize/index.ts`) takes a
`RepositoryModel` plus `WorkflowGraph[]`/`TerraformTopology[]` (both may be
empty — the engine degrades gracefully to repository-only evidence) and runs
a fixed pipeline of pure builder functions, each in its own module:

| Module | Produces |
|---|---|
| `identity-purpose.ts` | `SystemIdentity`, `PurposeModel` — from README lead paragraph + package manifests |
| `workflow-families.ts` | `WorkflowFamily[]` — groups `WorkflowGraph[]` by directory/naming heuristic |
| `components.ts` | `LogicalComponent[]` — from repository structure, Terraform root modules, and workflow families |
| `actors-external-systems.ts` | `Actor[]`, `ExternalSystem[]` — actors from workflow triggers, external systems from Terraform providers |
| `flows-boundaries.ts` | `ArchitectureFlow[]`, `ArchitectureBoundary[]` — from workflow triggers/jobs/environments and Terraform deployment environments |
| `responsibilities-capabilities.ts` | `Responsibility[]`, `CapabilityDomain[]` — from workflow families and Terraform topologies |
| `operating-model.ts` | `OperatingModel` — deployment environments, release process, observability, approval gates |
| `outcomes-risks-dependencies.ts` | `ArchitectureOutcome[]`, `ArchitectureRisk[]`, `ArchitectureDependency[]` |
| `questions.ts` | `ArchitectureQuestion[]` — walks the assembled model for suggested/unresolved statements and dangling gaps |

`collectStatements(model)` (`packages/architecture-intelligence/src/inference.ts`)
then walks the whole assembled tree to flatten every `InferredStatement` it
contains, and `summarizeConfidence(statements)` rolls that flat list up into
the `ConfidenceSummary` stored in `metadata.confidence`. This same
`collectStatements` helper is reused (not reimplemented) by the validator's
word-budget/leak/label checks described below, so the synthesizer and the
validator can never silently disagree about what "every statement in the
model" means.

## Narrative profiles and the four levels

`packages/architecture-intelligence/src/profiles.ts` defines six
`NarrativeProfile`s, each a fixed `sceneSequence` of `ArchitectureSceneKind`s
plus which abstraction levels (`1`-`4`) it includes:

| Profile | Levels | Scenes | Sequence |
|---|---|---|---|
| `repository-inventory` (default) | none | 1-200 | **legacy path — zero architecture-intelligence scenes**, preserves pre-Milestone-3 `rvs create slides` output byte-for-byte |
| `executive-overview` | 1 | 8-12 | title, summary, problem-and-response, responsibilities, capability-map, outcomes, risk-and-dependency-summary, decision |
| `architecture-review` | 1-2 | 12-20 | title, system-context, logical-architecture, capability-map, flow, boundary-map, operating-model, workflow-family-map, outcomes, risk-summary, evidence-confidence |
| `engineering-onboarding` | 1-3 | 12-24 | adds `repository-map` (Level 3 implementation detail) into the architecture-review sequence |
| `operating-review` | 1-2 | 8-16 | focused on operating model, boundaries, risks, dependencies |
| `repository-audit` | 1-4 | 16-60 | full detail: every component, flow, risk, dependency, evidence-confidence rollup |

`getNarrativeProfile(id)` throws on an unknown id. The four abstraction
levels this milestone's spec defines map onto scene kinds, not separate
artifacts — Level 1 ("Executive") is exactly `executive-overview`'s
`sceneSequence`; Level 4 ("Evidence") is the `evidence-confidence` scene plus
every entity's own `EvidenceReference[]`, always present regardless of
profile.

## The `architecture-intelligence` VisualDoc scene

Defined in `packages/visualdoc-schema/src/schema.ts` as
`ArchitectureIntelligenceSceneSchema`, joining the `SceneSchema` discriminated
union alongside `workflow`/`topology` scenes. A scene never embeds narrated
text or synthesized content — it references a single `ArchitectureIntelligence`
artifact by `artifact_id`, plus:

- `kind: ArchitectureSceneKind` — which of the 17 declared views (see
  `profiles.ts`'s `sceneSequence`s above) this scene renders over that
  artifact
- `focus_ids: string[]` (default `[]`) — narrows a diagram/list view to a
  named subset of entity ids; empty means "all". The current
  `buildArchitectureVisualDoc` (`packages/narrative-planner/src/architecture-visualdoc-builder.ts`)
  always emits `focus_ids: []` — per-scene splitting of an oversized view by
  focus id is mechanically supported by the schema and the renderer's
  `applyFocus()` helper, but no profile currently triggers it (see "Known
  limitations")

`buildArchitectureVisualDoc(artifact, profileId, themeId, workflowGraphs, terraformTopologies)`
builds one scene per `sceneSequence` entry (`buildArchitectureIntelligenceScenes`),
then appends the profile's representative `workflow`/`topology` scenes
(`buildSupplementaryScenes`) — capped by the profile's `workflowDetailDefault`
(`"none"` / `"representative"` / `"critical"` / `"all"`) rather than dumping
every cached graph, which is the single biggest structural difference from
the legacy `repository-inventory` path (see "Self-hosting proof" below).
`document.audience` is set to the profile id.

## Rendering

`packages/renderer-html/src/scenes/architecture-intelligence/`:

- `maps.ts` — the per-`kind` field mapping: which artifact fields feed which
  scene kind (e.g. `capability-map` → `capabilityDomains`, `risk-summary` →
  `risks`). This mapping is mirrored exactly by the validator's
  `statementsForKind()` (see below) so the two can never silently diverge on
  "what content is this scene kind responsible for."
- `text.ts` — per-kind HTML template functions consuming that mapped data.
- `helpers.ts` — shared rendering primitives:
  - `statementText(statement)` — prefixes `qualifierFor(statement.inference)`
    (`"Likely: "` / `"Unconfirmed: "`) onto the raw value; this is the single
    chokepoint every narrated statement passes through.
  - `evidenceNote(refs)` — renders a `<cite class="arch-evidence">` citation
    directly from the entity's own `EvidenceReference[]` (architecture
    intelligence evidence is `{path, lines?}`, the same shape
    `@rvs/workflow-graph`/`@rvs/terraform-graph` attach to nodes — not a
    `claim_id` into the Milestone-1 evidence manifest).
  - `statementList()` / `statementListItem()` — list rendering combining the
    two above.
  - `renderBoxDiagram(nodes, edges, ariaLabel)` — the shared SVG box-diagram
    renderer used by the four diagram-kind scenes (`system-context`,
    `logical-architecture`, `architecture-flow`, `boundary-map`); a simple
    row/column grid layout, not the workflow/terraform engines' layered
    layout — sized for the entity counts these scenes typically carry.
  - `applyFocus(items, focusIds)` — narrows a list to `scene.focus_ids` when
    non-empty.
- `diagrams.ts` — assembles the `DiagramNode`/`DiagramEdge` sets per diagram
  kind from the artifact.

## Validation

Two tiers, mirroring the workflow/Terraform engines exactly.

### Tier 1 — structural (`packages/architecture-intelligence/src/validate-structure.ts`)

Pure checks over an already-synthesized `ArchitectureIntelligence`, no
rendering:

| Code | Severity | Meaning |
|---|---|---|
| `ARCH_INTEL_DUPLICATE_ID` | error | two entities share an id |
| `ARCH_INTEL_DANGLING_FLOW` | error | a flow's `fromId`/`toId` doesn't resolve to a known entity |
| `ARCH_INTEL_QUANTIFIED_OUTCOME_MISSING_EVIDENCE` | error | a quantified outcome has no evidence behind its number |
| `ARCH_INTEL_NO_COMPONENTS` | warning | zero logical components were synthesized |
| `ARCH_INTEL_NO_PURPOSE_EVIDENCE` | warning | no README lead paragraph to synthesize a purpose statement from |
| `ARCH_INTEL_COMPONENT_MISSING_EVIDENCE` | warning | a non-workflow-automation component has zero evidence |
| `ARCH_INTEL_EMPTY_CAPABILITY_DOMAIN` | warning | a capability domain has no responsibilities/components/families attached |
| `ARCH_INTEL_WORKFLOW_FAMILY_EMPTY` | warning | a workflow family contains no workflows |
| `ARCH_INTEL_LOW_OVERALL_CONFIDENCE` | warning | over half of all synthesized statements are `unresolved` |
| `ARCH_INTEL_GENERIC_SYSTEM_NAME` | informational | the system's display name fell back to the raw repository slug — no distinctive README title or other product-name evidence was found (Milestone 3.1) |
| `ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR` | warning | more than 8 capability domains were synthesized — the rollup isn't coarsening the workflow-family list (Milestone 3.1) |
| `ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE` | warning | a non-empty workflow family has no representative workflow selected for supplementary detail scenes (Milestone 3.1) |

Run automatically by `rvs synthesize architecture` against every artifact it
produces, before caching.

### Tier 2 — rendered-output checks (`packages/validator/src/architecture-intelligence-checks.ts`)

Pure, deterministic checks over the already-rendered `VisualDoc` + HTML
string, no Playwright/DOM — sibling to `workflow-checks.ts`/`terraform-checks.ts`:

| Code | Severity | Meaning |
|---|---|---|
| `ARCH_INTEL_UNRESOLVED_CLAIM_IN_LEVEL1` | error | an `unresolved` statement appears in a Level 1 scene without its `"Unconfirmed:"` qualifier visible in the rendered HTML |
| `ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED` | error | a `suggested` statement appears in any narrated scene without its `"Likely:"` qualifier visible in the rendered HTML |
| `ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED` | warning | a scene's rendered word count exceeds its per-kind budget |
| `ARCH_INTEL_LEVEL1_LEAKS_IMPLEMENTATION_DETAIL` | warning | a Level 1 statement's narrated value contains a raw file-path-like substring |
| `ARCH_INTEL_STALE_INPUT` | warning | the cached artifact's `source_repository_model_generated_at` no longer matches the current repository-model snapshot |

The two label-integrity checks are deliberately **regression safety nets, not
re-derivations**: rather than trusting that `statementText()`/`qualifierFor()`
was applied correctly at render time, they re-derive the expected qualified
text from the artifact and then search the *actual rendered HTML string* for
it — the same principle `checks.ts`'s Playwright checks apply by auditing the
real DOM instead of trusting renderer code. `ARCH_INTEL_UNRESOLVED_CLAIM_IN_LEVEL1`
is scoped strictly to the `executive-overview` profile's scene-kind set
(minus `decision-or-next-step`, whose open questions are unresolved by
design); `ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED` scans every narrated
architecture-intelligence scene kind, since the spec's labeling requirement
applies more broadly than the stricter Level-1-only unresolved-claim check.

**Scope limitation, by design:** the three genuinely SVG-diagram scene kinds
(`system-context`, `logical-architecture`, `architecture-flow`) are excluded
from the per-kind statement checks above — their content is a rendered SVG
box diagram, not synthesized prose, and is already covered by `checks.ts`'s
Playwright-based overflow/min-font-size checks at the DOM tier (run via
`rvs validate`). **`boundary-map` is not excluded** despite its
diagram-shaped name: it renders as an `.arch-card` grid of boundary
descriptions, the same prose mechanism `capability-map`/`workflow-family-map`
use (see `renderer-html/scenes/architecture-intelligence/maps.ts`), so its
statements are covered by the label-integrity and word-budget checks like
any other narrated scene (Milestone 3.1 — Milestone 3 originally grouped it
with the true diagram kinds, which was a mischaracterization; fixed in
`packages/validator/src/architecture-intelligence-checks.ts`).

`rvs create slides` runs the full Tier 2 set inline against every synthesized
profile's output (the `repository-inventory` profile emits zero
architecture-intelligence scenes, so these checks are a no-op there,
preserving that path's byte-identical legacy behavior). `rvs validate`
continues to run the existing Tier 2 Playwright checks (overflow, contrast,
`min-font-size`) against the deck as a whole, architecture-intelligence
scenes included.

## CLI

```bash
rvs synthesize architecture
  # reads .rvs/cache/{repository-model,workflow-graphs,terraform-topologies}.json
  # (the latter two optional — synthesis degrades gracefully without them)
  # -> .rvs/cache/architecture-intelligence.json, running Tier 1 checks inline

rvs create slides
  # default: unchanged, "repository-inventory" profile, no synthesis required

rvs create slides --profile architecture-review
  # requires a cached architecture-intelligence.json (run `rvs synthesize architecture` first)
  # -> architecture-intelligence VisualDoc, Tier 2 checks run inline
  # valid --profile values: repository-inventory (default) | executive-overview |
  #   architecture-review | engineering-onboarding | operating-review | repository-audit
```

## Self-hosting proof

Run against a real, complex external repository (an internal Looker
administration platform with 65 checked-in GitHub Actions workflows, no
Terraform) to validate the engine end-to-end, not just against fixtures. The
table below reflects the current (Milestone 3.1) run of the same repository:

| | `repository-inventory` (legacy) | `architecture-review` (new) |
|---|---|---|
| Total scenes | 74 | 22 |
| Workflow diagram scenes | 65 (one per workflow, undifferentiated) | 11 (representative, one per workflow family) |
| Narrative scenes | title/headline/metric/section-divider only | 11 architecture-intelligence scenes (executive title, system-context, logical-architecture, capability map, key flows, boundary map, operating model, workflow-family map, outcomes, risks, evidence-confidence) |
| Logical components | n/a (raw directory listing) | 15 total, 11 architectural (workflow-family- or Terraform-module-derived); the 4 raw top-level-directory components are excluded from the diagram since architectural components exist |
| Capability domains | n/a | 7, rolled up from 11 workflow families |
| Evidence confidence | n/a | 128 synthesized statements: 59 confirmed, 67 derived, 0 suggested, 2 unresolved |

The 65 near-identical raw workflow diagrams collapse into 11 workflow
families (Credentials, Diagnostics, Governance, Identity and Access,
Migration, Observability, Onboarding, Other Automation, Query and PDT
Management, Release and Maintenance, Review and Approval), which the
Milestone 3.1 capability-domain rollup further coarsens into 7 domains
(General Automation, Governance and Approval, Identity and Access
Governance, Migration and Enablement, Operational Diagnostics, Query and
Data Reliability, Release and Maintenance) — this is the concrete shape of
"raising the level of abstraction without lowering the level of evidence"
the design mandate describes: fewer, denser scenes, but every claim still
cites the workflow file and line range it came from, and every headline
(e.g. "Capabilities group into 7 domains", "11 components make up the
architecture") states a real, traceable count rather than a static label.

The one honest gap this run surfaces: `ARCH_INTEL_GENERIC_SYSTEM_NAME`
fires, because this repository's README H1 ("Looker Admin Ops") is
identical to its normalized repository slug — there is no more distinctive
product name to prefer, so the system name correctly falls back rather than
inventing one.

`rvs validate`'s Playwright checks pass cleanly against both decks (0
failures). Milestone 3's original self-hosting proof (above, before this
amendment) had reported a `min-font-size` failure (13.0px against a 14px
floor) on the `boundary-map` and `evidence-confidence` scenes, attributing
it to diagram density; re-reading the actual renderer source during this
milestone found that attribution was wrong on one count — `boundary-map` is
not an SVG diagram at all, it renders the same `.arch-card`/`.arch-card-meta`
card grid `capability-map` and `workflow-family-map` use (see
[`maps.ts`](../packages/renderer-html/src/scenes/architecture-intelligence/diagrams.ts)).
The real cause was a static, density-independent CSS rule —
`.arch-card-kind`/`.arch-card-meta { font-size: 13px; }` in
[`styles.ts`](../packages/renderer-html/src/styles.ts) — that violated the
14px floor on every repository, not just dense ones. Fixed this milestone by
raising both to 14px; see "Known limitations" below, which no longer lists
this as open.

Extending Tier 2's word-budget/label-integrity checks to `boundary-map`
(see "Validation" above) also surfaced its first real finding on this
repository: `ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED` on `boundary-map` (235
words against a 150-word budget, driven by 14 evidenced deployment
boundaries each rendering a full sentence). This is exactly the kind of
warning the check exists to catch, previously silently missed because
`boundary-map` was incorrectly grouped with the true diagram kinds; it is
a real, non-spurious finding, not a regression introduced by this
milestone.

`architecture-intelligence.json` is also consumed by Milestone 7's
Architecture Governance and Continuous Intelligence layer:
`@rvs/governance-intelligence`'s `architecture-diff.ts` diffs two snapshots'
copies of this artifact to detect component/flow/boundary/dependency changes
between a baseline and the current repository state, feeding blast-radius
assessment and policy evaluation — it never re-synthesizes or mutates
`ArchitectureIntelligence` itself. See
[`docs/architecture-governance.md`](architecture-governance.md).

## Known limitations

- **No model-assisted synthesis (`--assist`).** Every statement above is
  produced by deterministic, rule-based synthesis over already-parsed
  evidence. The spec's opt-in, model-assisted synthesis path is deferred,
  not built.
- **No new repository adapters.** Kubernetes, LookML, dbt, OpenAPI,
  Databricks, Python AST, and TypeScript AST evidence sources were
  explicitly out of scope and were not started. The engine only consumes
  `RepositoryModel`/`WorkflowGraph[]`/`TerraformTopology[]`.
- **`focus_ids`-based scene splitting is mechanically supported but never
  triggered.** `buildArchitectureVisualDoc` always emits `focus_ids: []`;
  no profile currently splits an oversized view (e.g. a capability map with
  dozens of domains) across multiple scenes the way the workflow/Terraform
  engines split oversized graphs. A repository with many capability domains
  instead produces one denser scene, which is what surfaced the word-budget
  and min-font-size findings in the self-hosting proof above.
- **`renderBoxDiagram`'s grid layout is still not density-aware.** Unlike
  `@rvs/workflow-svg`/`@rvs/terraform-svg`'s layered layout engine, the
  three genuinely SVG-diagram scene kinds (`system-context`,
  `logical-architecture`, `architecture-flow`) use a simple row/column grid
  with no crossing-minimization or label-width-driven sizing; a diagram
  scene with many entities could still fail the Playwright `min-font-size`
  check on a sufficiently dense repository, even though the specific
  `min-font-size` failure observed in Milestone 3's self-hosting proof
  (which turned out to be a static CSS floor, not diagram density — see
  "Self-hosting proof" above) has been fixed as of Milestone 3.1.
- **Word budgets and the implementation-detail-leak check only cover
  prose-bearing scene kinds.** The four diagram kinds are exempt from both
  (see "Validation" above) — their content is audited separately by
  `checks.ts`'s DOM-level checks, not by these two.
- **`ARCH_INTEL_LEVEL1_LEAKS_IMPLEMENTATION_DETAIL`'s pattern is a heuristic,
  not exhaustive.** It matches a `path/segment.ext`-shaped substring for a
  fixed extension list; a leaked implementation detail with no file
  extension (a class name, an env var, a table name) would not be caught.

## Package summary

| Package | Role |
|---|---|
| `@rvs/architecture-intelligence` | `ArchitectureIntelligence` types, inference-class helpers, the synthesis pipeline, Tier 1 structural validation, narrative profiles |
| `@rvs/visualdoc-schema` | adds `ArchitectureIntelligenceSceneSchema` / `ArchitectureSceneKindSchema` |
| `@rvs/narrative-planner` | `buildArchitectureVisualDoc` — artifact + profile → scene sequence, appending representative workflow/topology scenes |
| `@rvs/renderer-html` | `scenes/architecture-intelligence/` — per-kind field mapping, statement/qualifier/evidence rendering, shared box-diagram SVG |
| `@rvs/validator` | `architecture-intelligence-checks.ts` — label-integrity, word-budget, implementation-detail-leak, staleness checks |
| `@rvs/cli` | `rvs synthesize architecture`; `rvs create slides --profile <id>` |
