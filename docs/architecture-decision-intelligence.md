# Architecture Decision Intelligence (Milestone 8, hardened in Milestone 8.1)

This document describes Architecture Decision Intelligence: a discovery and
linking layer that sits alongside, not inside, the Repository Evidence →
Architecture Intelligence → Capability Intelligence → Product Identity
Intelligence → Portfolio Intelligence → Architecture Governance stack. It
finds a repository's own decision documents (ADRs, RFCs, design decisions,
decision logs), normalizes them into a single typed record shape, links each
one to the four upstream intelligence artifacts and to governance policy
exceptions, and reasons about their dependencies, supersession, conflicts,
implementation state, coverage, drift, and debt. Like every layer above it,
it never re-scans repository source directly for anything other than the
decision documents themselves, and never calls an external model — every
stage is deterministic, rule-based, offline computation over already-parsed
Markdown and already-cached upstream JSON.

```
.rvs/decisions.yml (source locations)
  + repository's own ADR/RFC/design-decision Markdown files
  + architecture-intelligence.json / capability-model.json /
    product-identity-model.json / portfolio-model.json [best-effort, opt-in]
  + .rvs/governance.yml -> loaded policy files [best-effort, opt-in]
  -> discover -> classify -> resolve identity -> normalize   (this package + packages/cli)
  -> ArchitectureDecision[] + DecisionSourceIssue[]
  -> links (architecture/capability/product/portfolio/governance)
  -> assumptions / consequences / alternatives
  -> dependencies + cycles / supersession / conflicts
  -> implementation state / coverage / criticality
  -> drift / debt
  -> DecisionSnapshot
  -> DecisionGovernanceContextEcho            (opt-in extension point, see docs/decision-governance.md)
  -> claims -> narrative -> DecisionPlan -> DecisionIntelligenceReport
  -> rvs decisions analyze / validate / compare / explain
  -> rvs export decision-report / decision-summary
  -> rvs create slides --profile decisions     (docs/decision-showcase.md)
```

Scope: **discovery, normalization, and cross-layer linking of decision
documents already committed to the repository.** No decision authoring, no
automatic decision creation, no cost/effort estimation, no re-derivation of
anything an upstream milestone already computed.

## Design mandate

> Decision Intelligence may connect a decision to the evidence around it, but
> it must never assert a decision is correct or safe, never invent a decision
> that wasn't written down, and never silently drop a link, finding, or
> unresolved state because the answer wasn't obvious.

Concretely:

- **Three status axes, always independent.** `decision_status` (the author's
  own declared status), `implementation_status` (computed from `implements`
  links and upstream evidence), and `governance_status` (computed from
  governance-exception links) are never derived from one another. An
  `accepted` decision can be `not_started`; an `implemented` decision can
  still be `review_required`.
- **Conservative-bias link resolution.** A link a document declares but this
  package cannot confirm against the relevant upstream artifact is kept as
  `unresolved` (or `ambiguous`/`incompatible`), never silently dropped and
  never assumed resolved. A textual mention of an entity's name in
  `context`/`decision_text` is never sufficient to create a link — every link
  comes from structured `links:` frontmatter only.
- **"No way to even ask" is a first-class, honest answer.** Criticality,
  implementation state, and blast radius all reserve a dedicated
  `"unresolved"` value for when the required signal source simply isn't
  wired up in a given pipeline run — never collapsed into a false negative
  (`"standard"`, `"not_started"`, `"isolated"`) or a false positive.
- **Structural-only classification everywhere.** Assumption states,
  consequence classes, alternative states, and conflict detection all come
  only from explicit labels or explicit declared fields — never from
  sentiment/prose inference or semantic similarity.
- **Zero type coupling to any other package.** `packages/decision-intelligence`
  imports nothing from `@rvs/architecture-intelligence`,
  `@rvs/capability-intelligence`, `@rvs/product-intelligence`,
  `@rvs/portfolio-intelligence`, or `@rvs/governance-intelligence` — see
  "Package summary" below.
- **Every id is a pure function of stable content** (`ids.ts`) — never a
  timestamp, wall-clock time, or array/iteration index. `generated_at` is the
  one caller-supplied, non-content-derived field on every artifact, and is
  excluded from every determinism comparison.

## Core artifact model

`ArchitectureDecision` (`contracts.ts`) is the central record:

| Field | Shape | Note |
|---|---|---|
| `id` | string | `decision:<sanitized-identity>` — see "Ids" below. |
| `source` | `DecisionSource` | `repo_relative_path`, `source_type`, `content_digest`, `classification_basis`. |
| `title` | string | From frontmatter `title`, parsed heading, or filename fallback. |
| `decision_status` | `DecisionStatus` (11 values) | `draft`\|`proposed`\|`under_review`\|`accepted`\|`rejected`\|`superseded`\|`deprecated`\|`withdrawn`\|`implemented`\|`partially_implemented`\|`unknown`. Author-declared, mapped via `status.ts`. |
| `implementation_status` | `DecisionImplementationStatus` (7 values) | `not_started`\|`partial`\|`implemented`\|`regressed`\|`superseded`\|`unverifiable`\|`not_applicable`. Computed by `implementation-state.ts`. |
| `governance_status?` | `DecisionGovernanceStatus` (4 values) | `aligned`\|`review_required`\|`conflicting`\|`unverifiable`. Populated only once governance-links.ts has resolved the decision against configured policy/exceptions; `undefined` when no governance link exists at all — never a false `"aligned"`. |
| `scope` | `DecisionScope` (6 values) | `component`\|`capability`\|`product`\|`portfolio`\|`cross_cutting`\|`unresolved`. |
| `context?` / `decision_text?` | string | Free-form prose, only ever read for display and narrative composition — never for link inference. |
| `authors` / `date?` | string[] / string | |
| `supersedes` / `superseded_by` | string[] | Declared cross-references, cross-checked by `supersession.ts`. |
| `evidence_refs` | `EvidenceRef[]` | This package's own structural echo of the evidence-reference shape (`EvidenceRef.source_artifact` includes `"decision"` alongside `"architecture"`\|`"capability"`\|`"product"`\|`"portfolio"`\|`"governance"`\|`"repository"`). |

See `docs/decision-record-format.md` for exactly which Markdown forms
discovery/parsing/normalization recognizes, and `docs/decision-linking.md`
for the full link/dependency/supersession model.

## Discovery, classification, and identity pipeline

1. **Discovery** (`discovery.ts`) — scans only the directories named in
   `.rvs/decisions.yml`'s `sources[]`, never the whole repository, via
   `fast-glob` scoped per source (default include `**/*.md`, denylist
   `node_modules`/`dist`/`build`/`.git`/`.rvs/cache`/`.rvs/tmp`). The first
   `sources[]` entry to claim a path wins — a deterministic, config-order
   tie-break, not glob-iteration order.
2. **Classification** (`source-classification.ts`) — fixed precedence order:
   configured path's own `type` → explicit `type:` frontmatter field →
   recognized frontmatter shape (`id`+`status`, or an `adr` key) → recognized
   heading pattern (`# ADR-<n>` or `## Decision:`) → filename convention
   (`\d{4}-*.md`) → `unsupported` (never guessed).
3. **Identity resolution** (`identity.ts`) — configurable preference order via
   `.rvs/decisions.yml`'s `identity.prefer` (default: `frontmatter.id` →
   `filename` [ADR/RFC pattern in title or path] → `path` →
   `content_digest`, the unconditional last resort). `configured_id` is a
   reserved-but-currently-inert preference value — decisions.yml has no
   per-file id override field today.
4. **Duplicate/alias detection** (`identity.ts`'s
   `detectDecisionIdentityIssues`) — same-scan exact-id collisions,
   case-only collisions, and (only when a prior scan's records are supplied)
   `id_reused_with_changed_content`.
5. **Normalization** (`normalization.ts`) — frontmatter > heading sections >
   leading key/value table > fallback precedence for every field. See
   `docs/decision-record-format.md`.

## Assumptions, consequences, alternatives

All three are extracted only from structured syntax — frontmatter arrays or
a labeled list under a matching heading — via `markdown-parser.ts`'s shared
`parseLabeledListItem`, never from sentiment/prose inference:

| Artifact | States/classes | Default | Note |
|---|---|---|---|
| `DecisionAssumption` (`assumptions.ts`) | `confirmed`\|`supported`\|`weakened`\|`contradicted`\|`unverifiable`\|`retired` (6) | `unverifiable` | |
| `DecisionConsequence` (`consequences.ts`) | `positive`\|`negative`\|`neutral`\|`tradeoff`\|`risk`\|`obligation`\|`constraint`\|`unclassified` (8) | `unclassified` | Classification comes only from an explicit label. |
| `DecisionAlternative` (`alternatives.ts`) | `considered`\|`rejected`\|`deferred`\|`selected`\|`unknown` (5) | `unknown` | Never ranked — document order carries no meaning here. |

## Links, dependencies, supersession, conflicts

Full detail in `docs/decision-linking.md`. Summary:

- **Links** (`links.ts` + per-domain `architecture-links.ts`/
  `capability-links.ts`/`product-links.ts`/`portfolio-links.ts`/
  `governance-links.ts`/`decision-links.ts`): 16 `DecisionLinkType` values
  against a `DecisionLinkTargetDomain` of 6 declarable values
  (`architecture`, `capability`, `product`, `portfolio`, `governance`,
  `decision`), resolved to one of 5 `DecisionLinkResolution` states.
  Unresolved links are always kept, never dropped. `decision-links.ts`
  resolves `target_domain: "decision"` links against the set of decision
  ids known within the same analysis run (no upstream artifact needed,
  since every parsed decision's id is already in hand) — a decision linking
  to itself always resolves `"unresolved"` with a self-link-specific detail
  message, never silently dropped or silently treated as valid.
- **Dependencies** (`dependencies.ts`): 6 `DecisionDependencyType` values,
  rotation-invariant cycle detection shared with supersession via
  `decision-graph.ts`, classified `informational_allowed` or
  `blocking_flagged`.
- **Supersession** (`supersession.ts`): declared purely via `supersedes`;
  `superseded_by` is a reciprocal cross-check only. 4 issue kinds, chains
  built from graph "heads."
- **Conflicts** (`conflicts.ts`): structural-only detection, 5 conflict
  kinds, confidence levels `confirmed`/`probable`/`possible`.

## Implementation state, coverage, criticality

- **Implementation state** (`implementation-state.ts`) — classifies each
  decision's `implementation_status` from `implements`-link evidence and
  upstream-artifact availability. `"regressed"` is never assigned here — that
  requires two snapshots and is diff.ts's/change-classification.ts's job.
- **Coverage** (`coverage.ts`) — always a numerator/denominator pair, never a
  bare adjective claim. 5 dimensions: `architecture_entities`,
  `capabilities`, `products`, `portfolio_relationships`,
  `governance_exceptions`. A dimension whose upstream snapshot was never
  supplied is omitted entirely rather than reported as `0/0`.
- **Criticality** (`criticality.ts`) — classified only from explicit
  metadata/config or a resolved link to an explicitly-known-critical signal
  source, never word frequency or document length. 4 values: `critical`,
  `elevated`, `standard`, `unresolved` (the honest "no way to even ask"
  result when `signalsAvailable: false`). `decisions-analyze.ts` resolves
  real signals from (at least) 4 independent sources, combined into one
  `criticalityInputs` object: (1) explicit metadata — `.rvs/decisions.yml`'s
  `criticality.critical_decision_ids`; (2) decision frontmatter's own
  `criticality: critical|elevated|standard` field; (3) linked
  governance-policy severity — any decision with a resolved/partially-resolved
  governance link (i.e. a policy exception's `decision_ref` names it) counts
  as linked to a critical policy; (4) linked capability/architecture/portfolio
  criticality — `.rvs/decisions.yml`'s configured
  `shared_contract_entity_ids`/`runtime_entrypoint_entity_ids`/
  `portfolio_dependency_entity_ids`/`critical_capability_entity_ids`, matched
  against each decision's own architecture/portfolio/capability links.
  `signalsAvailable` is `true` if *any* of these sources has data —
  `"unresolved"` is now the genuine "no config, no frontmatter, no linked
  signal at all" case, not an unconditional placeholder.
- **Blast radius** (`blast-radius.ts`) — a structural echo of
  governance-intelligence's own BFS blast-radius pattern, with its own
  6-level scale (`isolated < local < cross_component < cross_layer <
  portfolio_wide < unresolved`). Computed every `rvs decisions analyze` run
  via `assessDecisionBlastRadius()`, cached to
  `decision-blast-radius.json`, and folded into the decision report's
  `blast_radius_by_level` summary, `decisions-explain.ts`'s per-id
  explanation, decision debt findings (`blastRadiusIdByDecisionId`), drift
  findings (`blast_radius_id` on each entry), the narrative, and the
  presentation plan.

## Drift, debt, missing findings

- **Drift** (`decision-drift.ts`) — full detail in `docs/decision-drift.md`.
  13 causes, 4 severities, never marked "blocking" from staleness/age alone.
- **Debt** (`decision-debt.ts`) — full detail in `docs/decision-debt.md`. 14
  categories, no cost/effort estimation anywhere.
- **Missing decisions** (`missing-decisions.ts`) — policy-driven, never
  automatic; `decisions-analyze.ts` now loads real rules from
  `.rvs/decisions.yml`'s `missing_decision_rules[]` (each entry:
  `rule_kind` + `affected_entity_ids`) and passes them straight through to
  `detectMissingDecisions()`. A repository with no configured rules still
  gets an empty rules array (same as before), so this remains an opt-in,
  never-automatic detector — but a configured rule now actually fires.
- **Missing implementation** (`missing-implementation.ts`) — reclassifies
  `implementation-state.ts` output into a 4-value finding vocabulary.

## Snapshot, compatibility, diff, claims

- **Snapshot** (`snapshot.ts`) — deterministic, canonicalized SHA-256
  digest. `compatibility` defaults to `"complete"`/`"unavailable"` depending
  on whether an upstream `IntelligenceSnapshot` was supplied.
- **Compatibility** (`compatibility.ts`) — a 2-status model
  (`"compatible"`\|`"incompatible"`), collapsed from governance's richer
  6-stage/4-status model, checked via schema-version and repository-id
  short-circuits.
- **Diff** (`diff.ts`) — pure `Map<id,entity>`-based diff; every decision id
  in either snapshot gets exactly one `DecisionChange` entry, including
  `"unchanged"`. No `"renamed"` change type exists (unlike governance) — an
  optional, conservative `detectRenames` flag (default `false`, requires
  `content_digest` + `source_type` + `authors` match) collapses a rename
  into modified/unchanged instead.
- **Change classification** (`change-classification.ts`) — `editorial`/
  `metadata`/`material`/`governance_relevant`/`unresolved`, a single shared
  rule set; wording-only changes are never `"material"`.
- **Claims** (`claims.ts`) — 10 recognized claim types, 14 rejection codes,
  a fixed gate order (compatibility → zero evidence → supersession →
  contradicted assumption → unresolved conflict → claim-type-specific
  check). `decision_quality`/`decision_safety` claims **always** reject —
  RVS never computes a subjective decision-quality judgement.
  `draftStandardDecisionClaims()` drafts exactly 5 fixed claims per decision.

## Narrative and presentation plan

`buildDecisionNarrative()` (`narrative.ts`) composes exactly 12 sections in
fixed order (Headline, Decision landscape, Accepted/active decisions,
Implementation alignment, Material decision changes, Assumption changes,
Conflicts and supersession, Decision coverage, Decision debt, Governance
impact, Human review required, Evidence limitations). Before returning,
every section is scanned against 6 forbidden phrases (`"decision is
correct"`, `"decision is safe"`, `"no risk"`, `"no impact"`, `"architecture
is improved"`, `"guaranteed to work"`) — a thrown `Error`, not just a test
assertion, if any hit.

`buildDecisionPlan()` (`decision-plan.ts`) assembles a `DecisionPlan` of
`DecisionSceneContent[]`, one candidate per `DecisionSceneKind`, filtering
out any scene builder that returned `undefined` (evidence-gated absence —
nothing real to show). Full presentation detail, including the exact scene
count, is in `docs/decision-showcase.md`.

## Ids

Every id (`ids.ts`) is a pure function of stable content — never scan order,
never a timestamp: `buildDecisionId`, `buildDecisionSourceId`,
`buildDecisionSourceIssueId`, `buildAssumptionId`, `buildConsequenceId`,
`buildAlternativeId`, `buildLinkId`, `buildDependencyId`,
`buildDependencyCycleId`, `buildSupersessionIssueId`,
`buildSupersessionChainId`, `buildConflictId`, `buildCoverageMetricId`,
`buildImplementationStateId`, `buildMissingDecisionFindingId`,
`buildMissingImplementationFindingId`, `buildDriftId`, `buildDebtFindingId`,
`buildBlastRadiusAssessmentId`, `buildSnapshotId`, `buildChangeSetId`,
`buildChangeId`, `buildClaimId`, `buildNarrativeId`, `buildPlanId`,
`buildSceneId`, `buildReportId`.

## CLI

```bash
rvs decisions analyze
  # Discover, parse, link, and analyze every configured decision document
  # -> .rvs/cache/decisions/*.json (19 named output files, DECISION_OUTPUT_FILES)

rvs decisions validate [--ci]
  # Re-runs the same pipeline as analyze, then validates every artifact
  # --ci sets process.exitCode = 1 only if any finding severity is "error"

rvs decisions compare --from <snapshot-path> [--to <snapshot-path>]
  # --from is REQUIRED (no configured baseline/snapshot-history directory, unlike governance)
  # --to defaults to a fresh `rvs decisions analyze` run

rvs decisions explain <id>
  # Fallback-across-id-spaces lookup: decision -> assumption -> consequence -> link
  # -> conflict -> drift -> debt -> coverage -> implementation-state -> change
  # -> supersession-chain

rvs export decision-report [--output decision-report.json]
rvs export decision-summary [--output decision-summary.md]

rvs create slides --profile decisions
  # See docs/decision-showcase.md
```

Exact log-line format (`packages/cli/src/commands/decisions-analyze.ts`):

```
Discovered <N> decision candidate(s); parsed <N> decision(s), <N> source issue(s).
Analyzed <N> decision(s) (compatibility: "<status>").
Findings: <N> drift, <N> debt, <N> conflict(s), <N> supersession issue(s).
Cached decision outputs to .rvs/cache/decisions/.
```

`rvs decisions validate`'s log lines (`decisions-validate.ts`) — per-finding
`[<code>] <message>` (error or warn), then:

```
Validated decision artifacts: <N> finding(s) (<N> error(s)).
Decision validation failed under --ci: <N> error-severity finding(s).   # only when --ci and errorCount > 0
```

`rvs decisions compare`'s log lines (`decisions-compare.ts`):

```
Compared "<source.id>" -> "<target.id>" (compatibility: "<status>"): <N> changed decision(s) of <N>.
Wrote .rvs/cache/decisions/decision-changes.json.
```

`rvs export decision-report`'s log line: `` Wrote <path> (<N> decision(s),
<N> unresolved). ``. `rvs export decision-summary`'s log line: `` Wrote
<path>. `` (this command only ever writes a local Markdown file — it never
posts, comments, or otherwise publishes anywhere).

## Known limitations

These are the CLI-level judgment calls documented directly in
`packages/cli/src/commands/decisions-analyze.ts`'s own comments, plus other
disclosed pipeline gaps confirmed against the current source. Milestone 8.1
closed the governance-wiring, blast-radius, criticality-signal,
missing-decision-rules, and `target_domain: "decision"` gaps Milestone 8
originally disclosed here — see below for what remains:

- **`governance_status` is derived locally in the CLI, not by a package
  builder.** Unlike `implementation_status` (`implementation-state.ts`),
  `@rvs/decision-intelligence` has no `buildDecisionGovernanceStatus()`
  function — `decisions-analyze.ts`'s own `deriveGovernanceStatus()` helper
  derives it from a decision's `"excepts"`/`"governance"` links.
- **`repositoryId` resolution falls back to `basename(repoRoot)` only as a
  last resort.** `resolveRepositoryId()` prefers, in order: explicit
  `.rvs/decisions.yml` config → normalized `git remote get-url origin` →
  `git rev-parse --show-toplevel`'s own basename → the repo root's raw
  basename. Different checkout folder names for the same repo+commit
  resolve to the same id wherever git metadata is available; only a
  non-git working tree with no configured id falls through to the plain
  basename.
- **Alternatives, missing-implementation, and missing-decision findings have
  no dedicated output files.** `DECISION_OUTPUT_FILES` has no
  `alternatives`/`missingImplementation`/`missingDecision` entry —
  alternatives are folded into `decisions.json` (keyed by decision id);
  missing-implementation findings are folded into
  `implementation-state.json`; missing-decision findings are folded into
  `decision-debt.json`.
- **Criticality's "linked to a critical policy" signal is a coarse
  membership check, not a severity read.** Source (3) above (governance-linked
  criticality) only checks whether a decision has *any*
  resolved/partially-resolved governance link — `governance-links.ts`'s
  link model carries no policy-severity reference to inspect further, so a
  decision linked to a low-severity policy exception counts the same as one
  linked to a blocking one. This is a disclosed scope trim, not a bug.
- **No model-assisted synthesis.** Every stage is deterministic, rule-based,
  offline computation. No network access, no LLM dependency.
- **No `rvs decisions new` command; no automatic decision creation.** See
  `docs/decision-record-format.md`.

Governance pipeline wiring, blast-radius computation, 4-source criticality
resolution, config-driven missing-decision rules, `target_domain: "decision"`
link resolution, and true end-to-end + source/package equivalence test
coverage for two named decision-governance workflows are documented in full
in [docs/decision-governance.md](decision-governance.md) — nothing in that
area remains a documented-but-unimplemented gap as of Milestone 8.1.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `ArchitectureDecision`/`DecisionLink`/`DecisionDependency`/`DecisionSupersessionChain`/`DecisionConflict`/`DecisionDrift`/`DecisionDebtFinding`/`DecisionSnapshot`/`DecisionChangeSet`/`DecisionClaim`/`DecisionNarrative`/`DecisionPlan`/`DecisionIntelligenceReport` types; discovery, classification, identity resolution, normalization, 6 link resolvers (architecture/capability/product/portfolio/governance/decision), dependency/cycle detection, supersession, conflicts, coverage, implementation state, criticality (4-source resolution), blast radius, drift, debt, missing-decision/missing-implementation detection (policy-driven, config-loaded rules), snapshot/compatibility/diff, the governance policy extension, claims, narrative/plan synthesis, validation, id builders |
| `@rvs/cli` | `rvs decisions analyze`/`validate`/`compare`/`explain`; `rvs export decision-report`/`decision-summary`; `"decisions"` added to `rvs create slides --profile <id>`'s accepted profile list; `governance-compare.ts`/`governance-check.ts` read cached decision-governance-context and pass it into `evaluatePolicy()` — see `docs/decision-governance.md` |

`packages/decision-intelligence` (`@rvs/decision-intelligence`) imports
nothing from `@rvs/architecture-intelligence`, `@rvs/capability-intelligence`,
`@rvs/product-intelligence`, `@rvs/portfolio-intelligence`, or
`@rvs/governance-intelligence` at either the runtime or the type level — it
defines its own structural echoes (`EvidenceRef`, `UpstreamSnapshotRef`,
`DecisionGovernanceContextEcho`) and reads every upstream artifact as
`unknown` JSON, narrowed defensively (`links.ts`'s
`collectKnownEntityIds()` walks any upstream shape structurally rather than
importing a specific one). This mirrors `@rvs/governance-intelligence`'s own
decoupling: decision-intelligence's own contract surface never needs to
change when an upstream package's internal types change shape, only when the
upstream package's *JSON output* shape changes — and `@rvs/governance-intelligence`
carries decision-intelligence's own facts through the same way, via its own
independently-declared `DecisionGovernanceContext` echo (see
`docs/decision-governance.md`), never by importing this package's types.

See also: [docs/decision-record-format.md](decision-record-format.md),
[docs/decision-linking.md](decision-linking.md),
[docs/decision-drift.md](decision-drift.md),
[docs/decision-debt.md](decision-debt.md),
[docs/decision-governance.md](decision-governance.md),
[docs/decision-showcase.md](decision-showcase.md).
