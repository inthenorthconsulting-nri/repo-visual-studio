# Continuous Intelligence: Policy, Findings, and CI Gating (Milestone 7)

This document describes the policy engine, CI gate, and reporting layer
built on top of [Architecture Governance](architecture-governance.md)'s
`IntelligenceSnapshot` comparison. Given the 5 change-sets and blast-radius
assessment `rvs governance compare` already produced, it evaluates a finite
set of deterministic, typed governance policies against them, assembles a
`ContinuousIntelligenceReport`, derives a claim-controlled narrative and a
presentation plan, and gates CI on the result. Like every other stage in
this package, policy evaluation never re-scans a repository and never calls
an external model — every rule is one dedicated pure function over already-
computed change entries.

```
architecture/capability/product/portfolio/evidence ChangeSets + BlastRadiusAssessment
  -> .rvs/policies/*.yml                      (policy-loader.ts)
  -> evaluatePolicy() per policy               (policy-evaluator.ts, one function per rule kind)
  -> GovernanceEvaluation[] -> mergeFindings()  (findings.ts)
  -> ContinuousIntelligenceReport               (hand-assembled in governance-compare.ts)
  -> buildGovernanceNarrative() + buildGovernancePlan()
  -> rvs governance check --ci                  (CI gate)
  -> rvs export governance-report / governance-summary
```

## Policy file format (`.rvs/policies/*.yml`)

Each file is Zod-validated by `policy-loader.ts`'s `PolicyFileSchema`
(`.strict()`, so unknown fields are rejected). Only `id`/`name` at the file
level, `rules[]`, and optional `exceptions[]`/`evidence_refs[]`:

```yaml
schema_version: 1
name: architecture-protection
rules:
  - id: no-removing-components
    title: "Components must not be removed without review"
    description: "Blocks silent removal of any architecture component."
    kind: forbid_component_removal
    condition:
      kind: forbid_component_removal
      component_id_pattern: "^payments-.*"
    severity: blocking
    enabled: true

  - id: capabilities-stay-included
    title: "Included capabilities must not regress below qualified"
    description: "Fails if a capability drops out of includedCapabilities/qualifiedCapabilities."
    kind: require_capability_status_at_least
    condition:
      kind: require_capability_status_at_least
      minimum_status: qualifiedCapabilities
    severity: review_required
    enabled: true

  - id: dependencies-need-portfolio-contract
    title: "Cross-product dependencies need a shared contract on record"
    description: "Flags architecture dependencies with no portfolio-sourced evidence."
    kind: require_shared_contract_for_dependency
    condition:
      kind: require_shared_contract_for_dependency
    severity: advisory
    enabled: true

exceptions:
  - rule_id: no-removing-components
    scope: "payments-legacy-adapter"
    reason: "Component is being decommissioned per RFC-114; removal is intentional."
    approval_reference: "RFC-114, approved by @platform-lead"
    expiry: "2026-12-31T00:00:00.000Z"
```

`id` (file-level) is optional — when omitted, `name` is used as the policy
key. A rule's `id` field is a short, file-local key (not the full namespaced
id): the loader builds the real `policy_id`/`rule_id` via `buildPolicyId`/
`buildRuleId` (`ids.ts`), and this is the **only** place a short key becomes
a full id. An exception's `rule_id` references that same short rule key,
resolved to the full rule id by the loader — a policy file whose exception
names a rule id that doesn't exist in `rules[]` fails validation.

A malformed policy file throws `` Invalid policy file <path>: not valid
YAML (<err>). `` or `` Invalid policy file <path>: <issue details>. ``.
`loadPolicyFiles()` collects failures across **every** file passed, not
just the first, and throws once: `` Failed to load <N> governance policy
file(s):\n<joined errors> ``.

## The 11 rule kinds

`GovernanceRuleKind` is a finite, closed set of 11 literal values —
never a general expression language. Each is dispatched to exactly one
pure evaluator function via a switch in `evaluateRule()`
(`policy-evaluator.ts`). A disabled rule (`enabled: false`) produces **zero**
findings — not even `not_applicable` — it is simply skipped.

Every entity-scoped rule (kinds 1, 2, 3, 4, 6, and the adapted 7/9) runs
under a shared **compatibility gate FIRST**: if the relevant changeset's own
`.compatibility` is `partial` or `incompatible`, the whole rule short-
circuits to a single `unverifiable` aggregate finding before scope is even
computed — a rule can never silently "pass" over data it couldn't actually
compare.

| # | Kind | Condition fields | One worked example |
|---|---|---|---|
| 1 | `forbid_component_removal` | `component_id_pattern?`, `component_type?` (accepted by schema but **ignored** by the evaluator — `GovernanceChangeEntry` carries no component-kind field) | Scope = architecture changes with `domain_path === "components"` matching the pattern; `fail` if `type === "removed"`, `unverifiable` if `type === "unresolved"`. |
| 2 | `require_runtime_entrypoint` | `entrypoint_id_pattern?` | Scope = architecture changes whose `domain_path` ends with `.implementation.entryPoints`, matching the pattern; `fail` if removed. |
| 3 | `require_capability_status_at_least` | `capability_id_pattern?`, `minimum_status` (required — one of the 6 capability *bucket* names: `includedCapabilities`/`qualifiedCapabilities`/`roadmapCapabilities`/`gapCapabilities`/`excludedCandidates`/`unresolvedCapabilities`, not a raw `CapabilityStatus`) | `unverifiable` for every entity if `minimum_status` isn't a recognized bucket name; `fail` if removed; else compares the entity's own bucket rank (`domain_path`) against the configured minimum's rank. |
| 4 | `forbid_operational_to_planned_regression` | `capability_id_pattern?` | Any capability change of `type === "reclassified"` matching the pattern is treated as a violation — the change type can't be narrowed to specifically "operational -> planned" without parsing free-text detail, so every regression counts. |
| 5 | `require_evidence_type` | `entity_id_pattern?`, `required_evidence_source` (required — one of `architecture`\|`capability`\|`product`\|`portfolio`\|`repository`) | The one cross-domain rule: scans architecture + capability + product + portfolio changes together; `fail` if a non-`unchanged` matching entry carries no `evidence_ref` with that `source_artifact`. |
| 6 | `forbid_dependency_removal` | `dependency_id_pattern?` | Scope = architecture changes with `domain_path === "dependencies"` matching the pattern; `fail` if removed. |
| 7 | `require_shared_contract_for_dependency` | `dependency_id_pattern?` | Proxy check (no id linkage exists between architecture dependencies and portfolio relationships): `fail` if the flagged dependency's own `evidence_refs` include no `source_artifact === "portfolio"` ref. `not_applicable` if there is no portfolio changeset at all and scope is empty; `unverifiable` if scope is non-empty with no portfolio changeset. |
| 8 | `forbid_approved_claim_without_lineage` | `claim_id_pattern?` | Product changes never diff "claims" as such (those live on `ExecutiveNarrative`/`ShowcasePlan`, out of snapshot scope); scope is instead `CLAIM_BEARING_DOMAIN_PATHS = {"identity.valuePillars", "identity.differentiators"}`; `fail` if `lineage === "broken"`, `unverifiable` if `"unverifiable"`. |
| 9 | `require_product_role` | `product_id_pattern?`, `required_role` (required string) | Can only verify **presence** of the product, not the specific role value — `portfolio-diff.ts` diffs each product entry as an opaque `sameValue` comparison with generic detail text. `fail` only if `type === "removed"`; `not_applicable` if there's no portfolio changeset at all. |
| 10 | `limit_unresolved_relationships` | `max_unresolved` (required, nonnegative integer) | Count-based whole-rule aggregate (not per-entity): counts portfolio changes with `domain_path === "unresolvedRelationships"` and `type !== "removed"`; `fail` if the count exceeds `max_unresolved`. |
| 11 | `require_compatible_snapshot` | `minimum_status` (required — one of `compatible`\|`compatible_with_warnings`\|`partial`\|`incompatible`) | Checks the top-level target-vs-source `compatibility` directly — never scans a change set at all. |

## 10 decision-aware rule kinds (Milestone 8, additive — not wired into this CLI)

Milestone 8's Architecture Decision Intelligence layer extends
`GovernanceRuleKind` with 10 more literal values (kinds 12-21, continuing
the switch in `evaluateRule()` above), evaluated against a new, optional
5th domain: `EvaluatePolicyInput.decisionChanges?: DecisionGovernanceContext`
— a flat, 6-field structural echo of decision-intelligence's own governance
context (`changes_missing_decision`, `decisions_with_contradicted_assumptions`,
`decisions_active_and_superseded`, `exceptions_with_invalid_decision_ref`,
`unresolved_conflict_decision_ids`, `decisions_requiring_review_for_drift`
— all sorted-unique string arrays, no per-decision detail). Absent, these
10 rules never fire and every pre-existing rule's evaluation is
byte-identical to before this extension existed.

| # | Kind | Condition fields | One worked example |
|---|---|---|---|
| 12 | `require_decision_for_change` | `entity_id_pattern?` | The one rule that can reach a genuine `pass`: absence from `changes_missing_decision` confirms a decision link exists. |
| 13 | `require_accepted_decision` | `entity_id_pattern?` | Conservative floor: no linked decision -> `fail`; some linked decision -> `unverifiable` (can't confirm "accepted" specifically from this flat context). |
| 14 | `require_decision_implementation` | `entity_id_pattern?` | Same conservative-floor pattern as #13, for implementation status. |
| 15 | `require_decision_evidence` | `entity_id_pattern?` | Same conservative-floor pattern as #13, for decision-sourced evidence. |
| 16 | `forbid_contradicted_assumption` | `decision_id_pattern?` | `fail` for every decision id in `decisions_with_contradicted_assumptions` (post-pattern-filter); empty scope is a genuine `pass`. |
| 17 | `forbid_active_superseded_decision` | `decision_id_pattern?` | Same pattern as #16, against `decisions_active_and_superseded`. |
| 18 | `require_decision_for_policy_exception` | `rule_id_pattern?` | A missing `decision_ref` on a matching exception is itself a violation; a present `decision_ref` found in `exceptions_with_invalid_decision_ref` is also a violation. |
| 19 | `require_decision_for_baseline_replacement` | (none beyond `kind`) | **Always returns a single `unverifiable` finding** — "baseline replacement" isn't observable from a fixed source/target change-set comparison. |
| 20 | `limit_unresolved_decision_conflicts` | `max_unresolved` (required, nonnegative integer) | Count-based whole-rule aggregate over `unresolved_conflict_decision_ids` (post-pattern-filter), mirroring rule #10's own shape. |
| 21 | `require_decision_review_for_drift` | `decision_id_pattern?` | Same pattern as #16, against `decisions_requiring_review_for_drift`. |

**Not wired into `rvs governance compare`/`rvs governance check` on this
branch.** Confirmed via `git diff --stat` against this branch's base commit:
neither `packages/cli/src/commands/governance-compare.ts` nor
`packages/cli/src/commands/governance-check.ts` was modified to read a
cached decision snapshot or construct a `DecisionGovernanceContext`. The
10 evaluators above are fully implemented and unit-tested at the
`@rvs/governance-intelligence` package level, but no CLI command on this
branch supplies `decisionChanges` to `evaluatePolicy()` — a policy file
referencing one of these 10 kinds evaluates against an absent domain when
run through this CLI today. Full detail, including the `decision_ref`
exception field and a documentation-only CI example:
[docs/decision-governance.md](decision-governance.md).

## Exceptions

Exceptions are **never implicit**. A `GovernanceException`
(`{ policy_id, rule_id, scope?, reason, approval_reference, expiry?,
evidence_refs }`) must always name a real `reason` and `approval_reference`
— `GOVERNANCE_EXCEPTION_WITHOUT_APPROVAL_REFERENCE` is a hard validation
error, not a warning, when either is blank. `scope`, when present, is a
regex pattern (falling back to exact-string match if it fails to compile)
tested against a finding's `affected_entity_ids`; omitted `scope` matches
every entity the rule touches. `expiry` is checked against a caller-
supplied `now` (`isExceptionExpired`, NaN-safe, never fatal) — an expired
exception simply stops applying, it does not error. A matched exception
rewrites the finding to `{ result: "excepted", excepted: true, exception:
<the matched exception> }`; `GOVERNANCE_FINDING_EXCEPTED_RESULT_MISMATCH`
is a validation error if `excepted` and `result === "excepted"` ever
disagree.

## `GovernanceFinding` and sort order

| Field | Shape |
|---|---|
| `id` | `governance:finding:<ruleId>:<changeId>` for entity-scoped findings (namespaced by the full **rule** id, not the policy id — see below), or `governance:finding:<policyId>:<ruleId>:<suffix>` for whole-rule aggregate findings. |
| `policy_id` / `rule_id` | Full namespaced ids. |
| `change_id?` | The `GovernanceChangeEntry.id` this finding is about, when entity-scoped. |
| `result` | `GovernancePolicyResult`: `pass`\|`fail`\|`not_applicable`\|`unverifiable`\|`excepted` |
| `severity` | `GovernanceSeverity`, the max of the rule's own configured severity and the underlying change's `classification.governance_severity`. |
| `statement` | Human-readable finding text. |
| `affected_entity_ids` | Entities this finding concerns. |
| `blast_radius?` | The matching `BlastRadiusLevel`, when resolvable. |
| `human_review_required` | `true` when `result` is `"fail"` or `"unverifiable"`. |
| `excepted` / `exception?` | Set together by exception matching. |
| `evidence_refs` | Sorted, deduped. |

**A documented bug-fix pattern**: `entityFinding()`'s id is built via
`buildFindingId(rule.id, entry.id)` — namespaced by the *rule's* full id,
not the *policy's* — so two different rules matching the same change entry
never collide on the same finding id (`buildRuleId` already embeds the
policy id, so this loses no information). `aggregateFinding()` uses
`buildFindingId(policy.id, \`${rule.id}:${suffix}\`)` for whole-rule
findings (kinds 10/11 and the "no changesets ran at all" cases).

Sort order is two-tier:

- **Within one `GovernanceEvaluation`** (`evaluatePolicy()`'s
  `sortFindings()`): by severity rank (`blocking` first) then finding `id`.
- **Across all evaluations, in `ContinuousIntelligenceReport.findings`**
  (`mergeFindings()`, `findings.ts`): by severity rank, then `policy_id`,
  then the first `affected_entity_ids` entry, then finding `id`. Nothing is
  deduplicated here — two genuinely distinct findings that happen to be
  identical except for `id` are both kept, since a report must never
  silently drop a real finding.

## `rvs governance check --ci`'s exact fail condition

A finding counts toward the fail count only when **all three** hold
(`printFindingsSummary()`, `governance-compare.ts`):

1. `!finding.excepted`
2. `finding.result === "fail" || finding.result === "unverifiable"`
3. `finding.severity` is in `comparison.fail_on` (default `["blocking"]`)

Severity alone is **not** the gate — a `blocking`-severity finding with
`result: "pass"` never fails the build; an `unverifiable` finding at a
`fail_on` severity does. `--ci` is otherwise inert: without it,
`rvs governance check` never touches `process.exitCode`, no matter what the
findings say. With it, on any fail count > 0:

```
Governance check "<source>" -> "<target>": compatibility "<status>", <N> finding(s) (<N> blocking, <N> review-required).
Governance check failed under --ci: <N> un-excepted finding(s) at or above the configured fail_on severity.
```

and `process.exitCode = 1`.

## `ContinuousIntelligenceReport`

Hand-assembled (there is no dedicated builder function) by
`runGovernanceComparison()` in `governance-compare.ts`:

| Field | Shape |
|---|---|
| `id` | `governance:report:<source>:<target>` |
| `source_snapshot_id` / `target_snapshot_id` | The two compared snapshot ids. |
| `compatibility` | The whole-snapshot `GovernanceCompatibilityStatus` from `assessSnapshotCompatibility`. |
| `architecture_changes` / `capability_changes` / `product_changes` | The corresponding `*ChangeSet`, always present. |
| `portfolio_changes?` | Present only when either snapshot fingerprinted portfolio with `complete` provenance. |
| `evidence_changes` | The `EvidenceChangeSet` rollup. |
| `blast_radius` | The `BlastRadiusAssessment`. |
| `evaluations` | `GovernanceEvaluation[]`, one per loaded policy, sorted by `policy_id`. |
| `findings` | Flattened + sorted per `mergeFindings()`, above. |
| `evidence_refs` | Sorted, deduped union of everything above. |

## Narrative and its forbidden-phrasing self-enforcement

`buildGovernanceNarrative()` (`narrative.ts`) composes 5 fields — `summary`,
`whatChanged`, `whyItMatters`, `riskAssessment`, `recommendedActions` — each
purely a function of real report counts/ids. Before returning, every one of
the 5 fields is scanned by `containsForbiddenPhrasing()` against a fixed,
case-insensitive substring list:

```
"architecture is improved", "risk is reduced", "portfolio is more efficient", "change is safe", "no impact"
```

This is a **thrown `Error`**, not just a test assertion — a self-enforcing
invariant. If any generated field ever contains one of these substrings,
`buildGovernanceNarrative()` itself throws: "Generated governance narrative
field \"<field>\" contains forbidden phrasing (<hits>). This is a synthesis
bug...". `"no impact"` is unconditionally forbidden (never distinguished as
"bare" vs. "qualified" via substring scanning); the narrative uses
evidence-qualified phrasing instead, e.g. "no blocking findings were
identified, based on the evidence available."

## `GovernanceClaim` and its 10 rejection codes

`draftStandardGovernanceClaims()` drafts exactly 5 claims per comparison —
one of each `GovernanceClaimType` (`no_regression`, `policy_compliance`,
`lineage_integrity`, `blast_radius_bound`, `evidence_strength`) —
`classifyGovernanceClaim()` then checks each against the real report, in
this fixed order: compatibility gates first, then lineage, then blast
radius, then (for `policy_compliance`) policy-result agreement, then the
claim's own asserted-outcome check. Approved-with-caveats claims count as
`"qualified"`, not `"approved"` or `"rejected"`.

| Rejection reason | Checked when |
|---|---|
| `incompatible_snapshot` | Report-level `compatibility === "incompatible"`. |
| `partial_snapshot` | Report-level `compatibility === "partial"`. |
| `missing_lineage` | Any in-scope change entry has `lineage` of `weakened`/`broken`/`unverifiable`. |
| `unresolved_blast_radius` | Any in-scope blast-radius entry has `level === "unresolved"`. |
| `policy_result_mismatch` | (`policy_compliance` claims only) any in-scope evaluation contains a `"fail"` finding. |
| `unsupported_no_impact_claim` | Asserted outcome `no_impact`, but a `fail` finding exists at `blocking`/`review_required` severity. |
| `unsupported_safety_claim` | Asserted outcome `safety`, but a `blocking`-severity `fail` finding exists. |
| `unsupported_improvement_claim` | Asserted outcome `improvement`, but no change entry has `classification.evidence_impact === "strengthened"`. |
| `unsupported_risk_reduction` | Asserted outcome `risk_reduction`, but a `blocking`/`review_required` `fail` finding exists, or any blast-radius entry is `unresolved`. |
| `unsupported_completeness_claim` | Asserted outcome `completeness`, but any evidence change is `type === "unresolved"`. |

A claim otherwise clean but touching `unverifiable`/`excepted` findings is
`"qualified"` (not `"approved"`), with an auto-generated qualifier text
naming the count of each.

## `rvs governance explain <id>`

```bash
rvs governance explain <id>
```

Fallback-across-id-spaces lookup (`explainGovernanceId()`,
`explain.ts`), searched in this order: change id (across all 4 domain
change sets plus the evidence change set) -> finding id -> policy-
evaluation id -> blast-radius entry id -> snapshot id (source or target) ->
report id -> baseline snapshot/baseline id -> plan id -> narrative id ->
scene id. Not found:

```
No governance change, finding, policy evaluation, blast-radius entry, snapshot, baseline, narrative, plan, or scene found matching id "<id>". Run `rvs governance compare` first to produce a continuous intelligence report, then re-check the id against the cached report/plan.
```

## `rvs export governance-report` / `rvs export governance-summary`

```bash
rvs export governance-report [--output governance-report.json]
  # Write the cached continuous intelligence report to governance-report.json
  # -> "Wrote <path> (<N> finding(s), compatibility \"<status>\")."

rvs export governance-summary [--output governance-summary.md]
  # Write a PR-paste-ready Markdown governance summary to governance-summary.md
```

`governance-summary.md`'s exact section headers (`export-governance-
summary.ts`): `# Architecture Governance Summary`, `## Change counts by
domain`, `## Blocking and review-required findings`, `## Capability
regressions`, `## Evidence regressions`, `## Blast radius`, `## Exceptions
applied`, `## Narrative summary`. **This command only ever writes a local
file** — it never posts, comments, or otherwise publishes anywhere; a
caller's own CI pipeline is responsible for attaching/pasting it to a PR.

## Example CI workflow (illustrative only, not verified by this repository's own CI)

The following is a hand-written example of wiring `rvs governance check
--ci` into GitHub Actions after intelligence generation, comparing against
a versioned baseline committed to the repository. It is **not** exercised
by this repository's own CI and should be adapted, not copy-pasted
verbatim — it deliberately contains no secrets, no pushes, and no PR
auto-commenting (per `export-governance-summary.ts`'s own "never publishes"
contract, above).

```yaml
name: architecture-governance
on: [pull_request]
jobs:
  governance-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx rvs synthesize architecture
      - run: npx rvs synthesize capabilities
      - run: npx rvs synthesize product-identity
      # baseline-snapshot.json is committed to the repository and versioned
      # like any other file; .rvs/governance.yml's baseline.snapshot points at it.
      - run: npx rvs governance check --ci
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: governance-cache
          path: .rvs/cache/governance/
```

See [docs/governance-baselines.md](governance-baselines.md) for how the
committed `baseline-snapshot.json` should be established and rotated.

See also: [docs/architecture-governance.md](architecture-governance.md),
[docs/governance-policies.md](governance-policies.md),
[docs/governance-baselines.md](governance-baselines.md),
[docs/governance-showcase.md](governance-showcase.md).
