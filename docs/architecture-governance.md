# Architecture Governance and Continuous Intelligence (Milestone 7)

This document describes Architecture Governance: a comparison layer above
the full Repository Evidence -> Architecture Intelligence -> Capability
Intelligence -> Product Identity Intelligence -> Portfolio Intelligence
stack. It never re-scans a repository and never calls an external model —
it reasons purely over two already-synthesized `IntelligenceSnapshot`s, each
a deterministic fingerprint of the cached JSON artifacts those upstream
milestones already produced. Given a baseline snapshot and a target
snapshot, it classifies what changed, assesses how far each change could
reach, evaluates deterministic typed policies against it, and produces
findings, a report, a narrative, and a presentation plan. See
[docs/continuous-intelligence.md](continuous-intelligence.md) for the
policy engine, CI gate, and reporting layer built on top of what this
document describes.

```
architecture-intelligence.json + capability-model.json
  + product-identity-model.json [+ portfolio-model.json, opt-in]
  -> rvs snapshot create                     (this package + packages/cli)
  -> IntelligenceSnapshot                     (a fingerprint, not a copy)
  -> rvs governance baseline set              (promote a snapshot to the baseline)
  -> rvs governance compare / check           (baseline vs. current -> ContinuousIntelligenceReport)
  -> input to Continuous Intelligence          (docs/continuous-intelligence.md)
  -> input to Governance Showcase              (docs/governance-showcase.md)
```

Scope: **comparison over two already-built `IntelligenceSnapshot`s.** No new
repository scanning, no external model call, no re-deriving anything an
upstream milestone already computed — this package only diffs, classifies,
and evaluates policy over what those milestones already produced.

## Design mandate

> Governance may raise the level of abstraction across two points in time,
> but it must never guess how far a change reaches, never assert an outcome
> the underlying comparison doesn't support, and never silently drop a
> finding.

Concretely:

- **Blast radius is `"unresolved"`, never `"isolated"`, whenever the
  underlying artifact structurally lacks the linkage field needed to answer
  the question.** `"isolated"` is reserved for a positive, data-backed
  confirmation of zero neighbors. This is the single most important
  correctness rule in the package — see "Blast radius assessment" below.
- A changeset's own `compatibility` field reflects only whether the two
  snapshots' copies of *that domain* were comparable at all
  (`domainCompatibility()`), never something folded up from an individual
  entity's `compatibility_impact` — one regressed entity must never poison
  an entire changeset to `"incompatible"` and mask itself from policy
  evaluation.
- Rename detection is conservative: an id-changed entity is only classified
  `"renamed"` when a removed candidate and an added candidate agree on kind
  **and** carry non-empty, byte-identical evidence. Any ambiguity falls back
  to a separate removed + added pair rather than guessing.
- Evidence lineage is conservative: a same-count-but-different-content
  evidence change is `"unverifiable"`, never guessed as strengthened or
  weakened from count alone.
- Every generation timestamp (`generated_at`, `established_at`) is
  caller-supplied wall-clock time and excluded from every determinism/
  equality comparison; this package never calls `Date.now()`/`new Date()`
  internally. Every id is a pure function of stable content.
- Synthesis is pure: `buildIntelligenceSnapshot()`, the diff engines, and
  policy evaluation are all pure functions over already-cached JSON — the
  same two snapshots always produce a byte-identical comparison.

## `IntelligenceSnapshot` and `rvs snapshot create`

An `IntelligenceSnapshot` is a deterministic fingerprint of up to 4 upstream
artifacts at one point in time — `architecture-intelligence.json`,
`capability-model.json`, `product-identity-model.json`, and, opt-in only,
`portfolio-model.json`. It never embeds the artifacts themselves: each
artifact is reduced to a `GovernanceArtifactDigest` (a SHA-256 digest of the
artifact's canonicalized, key-sorted JSON), so two snapshots can be compared
cheaply and byte-for-byte without re-reading the original files.

```bash
rvs snapshot create [--name <id>] [--output <path>] [--include-portfolio] [--allow-partial]
```

- `--name <id>` — snapshot filename/id to write under
  `.rvs/cache/governance/snapshots/` (default: the snapshot's own derived id).
- `--output <path>` — additionally write a copy of the snapshot to this path.
- `--include-portfolio` — also fingerprint the cached `portfolio-model.json`.
  This is the *only* portfolio-layer input governance reads; portfolio
  fingerprinting is opt-in specifically because a snapshot's portfolio
  digest is meaningless outside a multi-product portfolio repository. See
  [docs/portfolio-intelligence.md](portfolio-intelligence.md#self-hosting-proof)
  for where this hook is described from the portfolio side.
- `--allow-partial` — proceed even when architecture/capability/product
  artifacts are missing (portfolio is always optional regardless of this
  flag).

Each of the (up to) 4 domains gets its own `GovernanceProvenance`,
classified independently:

| Provenance | Meaning |
|---|---|
| `complete` | The artifact was present and shaped as a record; digest, schema_version, and source_generated_at are all recorded. |
| `partial` | The artifact was present but not a well-formed record. |
| `unavailable` | The artifact was missing entirely (`undefined`/`null`). |

Without `--allow-partial`, `rvs snapshot create` refuses to build a snapshot
that would have `unavailable` provenance for architecture, capability, or
product (portfolio is exempt, since it is opt-in). The snapshot's own id
(`buildSnapshotId`) is derived from the repository id plus every complete
artifact's `artifact:digest` token, sorted — so the same underlying content
always produces the same snapshot id regardless of build order.

## Baselines

A `GovernanceBaseline` wraps one `IntelligenceSnapshot` plus an
`established_at` timestamp; it is the "before" side every `rvs governance
compare`/`check` measures against by default. See
[docs/governance-baselines.md](governance-baselines.md) for the full
baseline lifecycle (establishing, rotating, CI pinning). In brief:

```bash
rvs governance baseline show
rvs governance baseline set <snapshot> [--force]
rvs governance baseline validate
```

`rvs governance baseline set` writes `.rvs/cache/governance/baseline-snapshot.json`
but **never** writes `.rvs/governance.yml` itself — that file is human-owned.
After a successful `set`, the CLI only prints a hint naming the path to add
under `baseline.snapshot` if `.rvs/governance.yml` doesn't already point at it.

## `.rvs/governance.yml`

Optional, schema-versioned, loaded by `loadGovernanceConfig(repoRoot)`
(`packages/governance-intelligence/src/governance-config.ts`) — returns
`undefined` when the file doesn't exist. A malformed file throws:
`` Invalid .rvs/governance.yml: not valid YAML (<err>). `` or
`` Invalid .rvs/governance.yml: <details>. ``

```yaml
schema_version: 1
baseline:
  snapshot: .rvs/cache/governance/baseline-snapshot.json
comparison:
  fail_on: [blocking]
  warn_on: [review_required]
policies:
  - .rvs/policies/architecture-protection.yml
  - .rvs/policies/capability-regression.yml
```

| Field | Shape | Note |
|---|---|---|
| `schema_version` | `1` (literal) | Only value currently accepted. |
| `baseline.snapshot` | string, optional | Path (relative to repo root) to a written `IntelligenceSnapshot` envelope. `rvs governance compare`/`check` require this (or `--from`) to resolve a source snapshot. |
| `comparison.fail_on` | `GovernanceSeverity[]`, optional | Severities that make `rvs governance check --ci` exit non-zero. Default `["blocking"]`. |
| `comparison.warn_on` | `GovernanceSeverity[]`, optional | Severities logged as warnings rather than errors. Default `["review_required"]`. |
| `policies` | string[], optional | Paths (relative to repo root) to `.rvs/policies/*.yml` files. Resolved and loaded by every `rvs governance compare`/`check` run. See [docs/governance-policies.md](governance-policies.md). |

## The five change-set diff engines

`rvs governance compare` runs 5 diff engines, all sharing one
`classifyChange()` rule set (`change-classification.ts`) except the 5th,
which works differently. Every entry they produce is a `GovernanceChangeEntry`:

| Field | Shape | Note |
|---|---|---|
| `id` | string | `governance:change:<domain>:<type>:<entityId>` |
| `domain_path` | string | Which structural location in the upstream artifact this entry is about (e.g. `components`, `dependencies`, `identity.valuePillars`, `relationships`) — see per-domain tables below for the real values each diff engine emits. |
| `entity_id` / `entity_label` | string | The changed entity's id and a human-readable label. |
| `type` | `GovernanceChangeType` | `added`\|`removed`\|`modified`\|`renamed`\|`reclassified`\|`unchanged`\|`unresolved` |
| `compatibility` | `GovernanceCompatibilityStatus` | Per-entity compatibility impact (floor of the classification, see below). |
| `lineage` | `GovernanceLineageState` | `preserved`\|`strengthened`\|`weakened`\|`broken`\|`unverifiable` — from `computeLineage()` in `diff-utils.ts`. |
| `classification` | `GovernanceChangeClassification` | materiality, confidence, governance_severity, compatibility_impact, evidence_impact, runtime_impact, consumer_impact, portfolio_impact — see `change-classification.ts`. |
| `detail` | string | Human-readable one-line description of exactly what changed. |
| `evidence_refs` | `EvidenceRef[]` | Sorted, deduped. |

A `GovernanceChangeType` of `"unresolved"` means the diff engine could not
classify a change at all from the data available — it is never silently
dropped.

### Architecture (`architecture-diff.ts`)

Reads `architecture-intelligence.json`. `domain_path` values: `components`,
`components.<componentId>.implementation.entryPoints`, `workflowFamilies`,
`flows`, `dependencies`, `actors`, `externalSystems`, `boundaries`.
Component `entryPoints` (plain strings, no id of their own) are diffed
per-component, scoped under the owning component's id.

### Capability (`capability-diff.ts`)

Reads `capability-model.json`. A capability's own bucket
(`includedCapabilities`/`qualifiedCapabilities`/`roadmapCapabilities`/
`gapCapabilities`/`excludedCandidates`/`unresolvedCapabilities`) is tracked
alongside its `status`: the same capability id moving from
`includedCapabilities` to `excludedCandidates` is a `"reclassified"`
regression exactly like a `status` field regressing from `operational` to
`planned`. A change is only `"reclassified"` (not merely `"modified"`) when
status rank or bucket rank actually *regresses*; wording-only description
changes with unchanged status/bucket/evidence classify as `"unchanged"`.

### Product (`product-diff.ts`)

Reads `product-identity-model.json`. `domain_path` values:
`identity.archetype`, `identity.purpose`, `identity.descriptor`,
`identity.shortPromise`, `identity.primaryUsers`, `identity.secondaryUsers`,
`identity.secondaryArchetypes`, `identity.valuePillars`,
`identity.differentiators`.

### Portfolio (`portfolio-diff.ts`, optional)

Reads `portfolio-model.json`, only run when either snapshot fingerprinted
portfolio with `complete` provenance (i.e. `--include-portfolio` was used
when building at least one side). `domain_path` values: `maturity`,
`products`, `relationships`, `unresolvedRelationships`,
`dependencyGraph.edges`, `overlaps`, `gaps`. `PortfolioChangeSet` carries
`portfolio_id?` in place of the other three's `repository_id?`.

### Evidence (`evidence-diff.ts`) — the 5th engine, a rollup, not a fresh diff

`diffEvidence()` does not read any raw artifact JSON. It scans the
`lineage` field every `GovernanceChangeEntry` the other 4 engines already
produced — `"weakened"`/`"broken"` becomes an evidence-change `"removed"`,
`"strengthened"` becomes `"added"`, `"unverifiable"` becomes `"unresolved"`
— and re-emits one `GovernanceEvidenceChangeEntry` per `evidence_ref` (not
per entity), so evidence findings stay ref-grained. An entity whose own
`evidence_refs` array is already empty still surfaces once, keyed on a
synthetic `<domain_path>/<entity_id>` path, so a broken-lineage finding is
never silently dropped for lack of a concrete ref.

## Compatibility assessment

`assessSnapshotCompatibility(source, target)` (`compatibility.ts`) judges
whether two whole snapshots are comparable at all, in 6 stages, over
`DOMAIN_ORDER = ["architecture", "capability", "product", "portfolio"]`:

1. **No common complete domain** — if no domain has `complete` provenance on
   both sides, `incompatible`: "there is nothing governance can compare."
2. **Schema mismatch** — any commonly-complete domain whose `schema_version`
   differs between the two snapshots -> `incompatible`.
3. **Identity mismatch** — `repository_id`/`portfolio_id` differ when both
   are known -> `incompatible`.
4. **Reduced coverage** — fewer than all 4 domains commonly complete ->
   `partial`, naming which domain is missing on which side.
5. **Staleness** — the target's `source_generated_at` for a common domain is
   earlier than the source's -> `compatible_with_warnings` (never fatal on
   its own).
6. Otherwise -> `compatible`.

`rvs governance compare` aborts entirely — "Governance compare aborted:
snapshots are incompatible (see reasons above)." — only on `incompatible`;
`partial`/`compatible_with_warnings` proceed with a warning logged.

Each individual changeset also carries its own narrower
`domainCompatibility(domain, source, target)` (`diff-utils.ts`): `partial`
if either side lacks `complete` provenance for that one domain,
`incompatible` if both are complete but disagree on `schema_version`,
`compatible` otherwise. This is what a changeset's top-level
`compatibility` field is built from — never from folding up entity-level
`compatibility_impact`.

## Blast radius assessment

`assessBlastRadius()` (`blast-radius.ts`) walks every non-`"unchanged"`
change entry across all 4 domain changesets and assigns a
`BlastRadiusLevel`:

```
isolated < local < cross_component < product_wide < cross_product < portfolio_wide < unresolved
```

**The conservative rule, stated explicitly:** blast radius is
`"unresolved"` whenever the upstream artifact structurally lacks a linkage
field to answer "what does this touch?" — `"isolated"` is reserved
exclusively for a positive, data-backed confirmation of zero neighbors, not
for "the data doesn't say." Concretely, per domain:

- **Architecture**: an architecture graph is built once, from `flows[]`
  only (the sole `fromId`/`toId`-bearing list in `ArchitectureIntelligence`).
  If `flows` itself isn't a present array on the artifact at all,
  *every* architecture entity is `unresolved`, regardless of `domain_path`.
  `domain_path === "dependencies"` is **always** `unresolved`, even when the
  flow graph is available: `ArchitectureDependency` carries no `fromId`/
  `toId` or any other consumer-linkage field, so its reach can never be
  determined. `components`/`actors`/`externalSystems` use the flow-derived
  neighbor map (`isolated` only if truly zero neighbors, else
  `cross_component`); `.implementation.entryPoints` and `workflowFamilies`
  resolve to `local`/`product_wide`; `boundaries` uses
  `containedComponentIds` (`isolated` if empty, `local` if exactly 1, else
  `cross_component`).
- **Capability**: if the entity's own record can't be found, or the record
  has no `logicalComponents` field at all, the level is `unresolved` —
  `ExcludedCapabilityCandidate` has no such field, so an excluded candidate
  can never be resolved past `unresolved`. Otherwise `isolated` if
  `logicalComponents` is empty, else `product_wide` (a live bucket:
  `includedCapabilities`/`qualifiedCapabilities`) or `cross_component`.
- **Product**: **always** `unresolved`, unconditionally —
  `ProductIdentityModel` carries no linkage into architecture/capability/
  portfolio entities at all, so the reach of any product-domain change can
  never be determined from the product artifact alone.
- **Portfolio**: `maturity` is always `portfolio_wide` (a portfolio-wide
  aggregate score is inherently whole-portfolio by definition, not a lookup
  failure). `relationships`/`unresolvedRelationships`/
  `dependencyGraph.edges` resolve via `productAId`/`productBId`/
  `sourceProductId`/`targetId` lookups (`unresolved` if missing, else
  `cross_product`). `overlaps`/`gaps` use their `productIds`/
  `affectedProductIds` arrays. `products` checks whether the touched
  product appears in any relationship/edge — a genuine positive check, so
  `isolated` here is a real, evidenced "zero neighbors," not a guess.

Any `domain_path` this package doesn't have a rule for also resolves to
`unresolved`, never a guessed level.

## Ids

Every id (`ids.ts`) is a pure function of stable content — never scan
order, never a timestamp: `buildSnapshotId`, `buildBaselineId`,
`buildChangeSetId`, `buildChangeId`, `buildEvidenceChangeId`,
`buildPolicyId`, `buildRuleId`, `buildEvaluationId`, `buildFindingId`,
`buildBlastRadiusEntryId`, `buildBlastRadiusAssessmentId`, `buildReportId`,
`buildClaimId`, `buildNarrativeId`, `buildPlanId`. See
[docs/continuous-intelligence.md](continuous-intelligence.md) for how
`buildFindingId` is used (and why it is namespaced by `rule.id`, not
`policy.id`, for entity-scoped findings).

## CLI

```bash
rvs snapshot create [--name <id>] [--output <path>] [--include-portfolio] [--allow-partial]
  # Build an IntelligenceSnapshot fingerprint from cached architecture/capability/product(/portfolio) artifacts
  # -> .rvs/cache/governance/snapshots/<name-or-id>.json

rvs governance baseline show
rvs governance baseline set <snapshot> [--force]
rvs governance baseline validate

rvs governance compare [--from <snapshot>] [--to <snapshot>]
  # Diff the configured baseline (or --from) against the current repository state (or --to),
  # evaluate policy, and cache a governance report
```

`rvs snapshot create`'s log lines
(`packages/cli/src/commands/snapshot-create.ts`):

```
Built snapshot "<id>" (architecture=complete, capability=complete, product=complete, portfolio=unavailable).
Wrote .rvs/cache/governance/snapshots/<name>.json[, <output-path>].
```

`rvs governance compare`'s log lines
(`packages/cli/src/commands/governance-compare.ts`):

```
Compared "<sourceSnapshotId>" -> "<targetSnapshotId>" (compatibility: "<status>").
<changes-by-domain line>
Findings: <N> total (<N> blocking, <N> review-required, <N> advisory, <N> informational).
<blast-radius-by-level line>
Cached governance outputs to .rvs/cache/governance/.
```

Without a `--from` and no configured baseline, `rvs governance compare`
throws: "No governance baseline is configured and no --from snapshot was
given. Run `rvs governance baseline set <snapshot>` first, or pass --from
<snapshot>."

`rvs governance compare`/`check` write all 11 named output files under
`.rvs/cache/governance/` (`constants.ts`'s `GOVERNANCE_OUTPUT_FILES`):
`current-snapshot.json`, `architecture-changes.json`,
`capability-changes.json`, `product-changes.json`,
`portfolio-changes.json`, `evidence-changes.json`, `blast-radius.json`,
`governance-findings.json`, `governance-report.json`,
`governance-narrative.json`, `governance-plan.json`. See
[docs/continuous-intelligence.md](continuous-intelligence.md) for
`rvs governance check --ci`, `rvs governance explain`, and the two
`rvs export governance-*` commands built on top of these cached files.

## Known limitations

- **`ArchitectureDependency` carries no `fromId`/`toId` (or any other
  consumer-linkage field).** Its blast radius is always `unresolved`, even
  when the architecture flow graph is otherwise available for every other
  domain_path.
- **`ExcludedCapabilityCandidate` carries no `logicalComponents` field.**
  Its blast radius (and any excluded candidate lacking that field) is
  always `unresolved`, never guessed as `isolated`.
- **`ProductIdentityModel` carries no cross-domain consumer-linkage
  fields at all.** Every product-domain change's blast radius is
  unconditionally `unresolved`.
- **`PortfolioModel` has no `decisions` field and no shared-contracts
  list.** Policy rules that would need either (see
  [docs/governance-policies.md](governance-policies.md)'s
  `require_shared_contract_for_dependency` entry) fall back to a proxy
  signal (whether the flagged architecture dependency's own evidence
  includes a portfolio-sourced ref) rather than a real cross-artifact join.
- **`PortfolioMaturitySummary`'s 7 dimensions carry no per-entity
  linkage.** A `maturity` domain_path change's blast radius is always
  `portfolio_wide` by definition, never resolved to a narrower level.
- **Portfolio fingerprinting is opt-in** (`rvs snapshot create
  --include-portfolio`) and is the *only* portfolio-layer artifact
  governance reads; it never reads `portfolio-claims.json` or
  `portfolio-decisions.json`.
- **No model-assisted synthesis.** Every stage — snapshotting, diffing,
  compatibility assessment, blast-radius assessment, policy evaluation — is
  deterministic, rule-based, offline computation. No network access, no LLM
  dependency.

## Package summary

| Package | Role |
|---|---|
| `@rvs/governance-intelligence` | `IntelligenceSnapshot`/`GovernanceBaseline`/`*ChangeSet`/`BlastRadiusAssessment`/`ContinuousIntelligenceReport`/`GovernanceNarrative`/`GovernancePlan` types; snapshotting, the 5 diff engines, compatibility assessment, blast-radius assessment, the policy engine, narrative/plan synthesis, validation, id builders |
| `@rvs/cli` | `rvs snapshot create`; `rvs governance baseline show\|set\|validate`; `rvs governance compare`/`check`; `rvs governance explain <id>`; `rvs export governance-report`/`governance-summary`; `rvs create slides --profile governance` |

`packages/governance-intelligence` (`@rvs/governance-intelligence`) imports
nothing from any upstream intelligence package — it defines its own
structural echoes (e.g. `EvidenceRef`) and reads every upstream artifact as
`unknown` JSON, narrowed defensively via `diff-utils.ts`'s `isRecord`/
`asRecord`/`stringField`/`arrayField` helpers. This is a deliberate
type-level decoupling: governance's own contract surface never needs to
change when an upstream package's internal types change shape, only when
the upstream package's *JSON output* shape changes.

See also: [docs/continuous-intelligence.md](continuous-intelligence.md),
[docs/governance-policies.md](governance-policies.md),
[docs/governance-baselines.md](governance-baselines.md),
[docs/governance-showcase.md](governance-showcase.md).
