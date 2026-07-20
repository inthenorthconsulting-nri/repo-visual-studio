# Decision-Aware Governance (Milestone 8, wired end-to-end in Milestone 8.1)

This document describes the cross-package extension `@rvs/governance-intelligence`
gained for decision awareness: an additive, opt-in `decisionChanges` domain
on the policy evaluator, 10 new decision-aware `GovernanceRuleKind` values,
and a `decision_ref` field on governance exceptions. It complements
[docs/architecture-governance.md](architecture-governance.md) and
[docs/continuous-intelligence.md](continuous-intelligence.md), which
describe the pre-existing 11-rule-kind engine this extension sits beside,
and [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md),
which describes the decision-intelligence side that produces the facts this
extension consumes.

**Milestone 8.1 closed the CLI wiring gap Milestone 8 disclosed.**
`packages/cli/src/commands/governance-compare.ts` now reads a cached
`decision-governance-context.json` (when `rvs decisions analyze` has been
run) and passes it into `evaluatePolicy()` as the opt-in `decisionChanges`
domain — see "Wiring status" below for the exact mechanism and its opt-in
guarantee.

```
@rvs/decision-intelligence's own decision snapshot/links/assumptions/conflicts/drift
  -> buildDecisionGovernanceContext()          (governance-policy-extension.ts, decision-intelligence)
  -> DecisionGovernanceContextEcho              (decision-intelligence's own structural echo)
      |
      | (never imported directly -- governance defines its own independent echo)
      v
  DecisionGovernanceContext                     (governance-intelligence's own structural echo, contracts.ts)
  -> cached as .rvs/cache/decisions/decision-governance-context.json (rvs decisions analyze)
  -> read by governance-compare.ts (readDecisionCachedJsonOptional, best-effort/opt-in)
  -> EvaluatePolicyInput.decisionChanges?        (opt-in 5th domain, policy-evaluator.ts)
  -> evaluatePolicy() -> 10 new evaluate<Kind> functions
  -> GovernanceFinding[] (unchanged shape, unchanged sort order)
  -> ContinuousIntelligenceReport.decision_changes (report.decision_changes === the context object)
```

## Design mandate

> Decision-aware governance rules may raise the level of abstraction by
> reasoning over decision-intelligence's own facts, but they must never
> assume a stronger claim than that context can actually support, and the
> extension itself must be invisible to any repository that hasn't opted
> into decision intelligence.

Concretely:

- **Absent, evaluation is byte-identical to pre-Milestone-8 behavior.**
  `ContinuousIntelligenceReport.decision_changes?` and
  `EvaluatePolicyInput.decisionChanges?` are both optional. A repository
  that never builds a decision snapshot, or whose caller never supplies
  `decisionChanges`, sees zero change in governance's evaluation output —
  this is the load-bearing scope trim that keeps the one cross-package
  edit safe.
- **Zero type coupling, even between these two related extensions.**
  `governance-intelligence`'s `DecisionGovernanceContext`
  (`packages/governance-intelligence/src/contracts.ts`) is its own
  independently-declared structural echo of decision-intelligence's
  `DecisionGovernanceContextEcho` — never imported from
  `@rvs/decision-intelligence`. Governance must not depend "up" on
  decision-intelligence, exactly as decision-intelligence must not depend
  "up" on governance's own change-sets.
- **A conservative floor, never an assumed pass.** `DecisionGovernanceContext`
  only carries flat id arrays (no per-decision status/implementation/
  evidence detail) — an entity with **no** linked decision at all is a
  confirmed, logically-entailed `fail`; an entity **with** some linked
  decision can only be `unverifiable` (never assumed to pass), since the
  stronger condition (accepted/implemented/evidenced) can't be confirmed
  from this flat context alone. `policy-evaluator.ts`'s
  `evaluateDecisionEntailedCoverageRule()` states this explicitly as "a
  disclosed scope trim, not silently guessed."
- **Governance never itself validates a `decision_ref`.** It trusts
  decision-intelligence's own `governance-links.ts` resolution
  (`resolved`/`incompatible`/`unresolved`) surfaced through
  `exceptions_with_invalid_decision_ref` — governance-intelligence does not
  re-check existence, status compatibility, scope, or expiry itself.

## `DecisionGovernanceContext` — the opt-in 5th domain

Both sides of the extension declare the identical 6-field shape
independently:

| Field | Shape | Populated from (decision-intelligence side) |
|---|---|---|
| `changes_missing_decision` | string[] | `MissingDecisionFinding.affected_entity_id` |
| `decisions_with_contradicted_assumptions` | string[] | `DecisionAssumption` where `state === "contradicted"` |
| `decisions_active_and_superseded` | string[] | `DecisionConflict` where `kind === "active_and_superseded_simultaneously"` |
| `exceptions_with_invalid_decision_ref` | string[] | `DecisionLink` (`excepts`/`governance`) where `resolution !== "resolved"` |
| `unresolved_conflict_decision_ids` | string[] | `DecisionConflict` where `status !== "resolved"` |
| `decisions_requiring_review_for_drift` | string[] | `DecisionDrift` where `severity` is `"blocking"` or `"review_required"` |

All 6 fields are sorted-unique string arrays — no nested objects, no
per-decision status detail. `EvaluatePolicyInput.decisionChanges?:
DecisionGovernanceContext` is passed straight through into
`evaluatePolicy()`'s internal evaluation context; `ContinuousIntelligenceReport.
decision_changes?: DecisionGovernanceContext` is the matching opt-in 5th
report field.

## The 10 new rule kinds

Dispatched in `policy-evaluator.ts`'s `evaluateRule()` switch alongside the
pre-existing 11 (numbered 12-21 to continue that switch's own sequence):

| # | Kind | Condition fields | Evaluator | Worked behavior |
|---|---|---|---|---|
| 12 | `require_decision_for_change` | `entity_id_pattern?` | `evaluateRequireDecisionForChange` | The one decision-aware rule that can reach a clean `pass`: absence from `changes_missing_decision` confirms a decision link exists. Scans architecture/capability/product/portfolio changes via `scanDomainsForDecisionCoverage()`. |
| 13 | `require_accepted_decision` | `entity_id_pattern?` | `evaluateRequireAcceptedDecision` | Via `evaluateDecisionEntailedCoverageRule()`: no linked decision -> `fail`; some linked decision -> `unverifiable` (can't confirm it's specifically "accepted" from this context alone). |
| 14 | `require_decision_implementation` | `entity_id_pattern?` | `evaluateRequireDecisionImplementation` | Same conservative-floor pattern as #13, for implementation status. |
| 15 | `require_decision_evidence` | `entity_id_pattern?` | `evaluateRequireDecisionEvidence` | Same conservative-floor pattern as #13, for decision-sourced evidence — kept distinct from the pre-existing `require_evidence_type` rule since decision-sourced evidence isn't populated on a change entry's own `evidence_refs`. |
| 16 | `forbid_contradicted_assumption` | `decision_id_pattern?` | `evaluateForbidContradictedAssumption` | Via `evaluateDecisionIdListRule()`: membership in `decisions_with_contradicted_assumptions` is always `fail` (decision-intelligence already computed it deterministically); empty post-pattern-filter scope is a genuine `pass`. |
| 17 | `forbid_active_superseded_decision` | `decision_id_pattern?` | `evaluateForbidActiveSupersededDecision` | Same pattern as #16, against `decisions_active_and_superseded`. |
| 18 | `require_decision_for_policy_exception` | `rule_id_pattern?` | `evaluateRequireDecisionForPolicyException` | Scoped by exception `rule_id` + `scope` (exceptions have no own id field). A missing `decision_ref` is itself a violation; a `decision_ref` present in `exceptions_with_invalid_decision_ref` is also a violation. |
| 19 | `require_decision_for_baseline_replacement` | (none beyond `kind`) | `evaluateRequireDecisionForBaselineReplacement` | **Always returns a single `unverifiable` finding.** Disclosed scope trim: "baseline replacement" events aren't observable from a fixed source/target change-set comparison — nothing in the available context signals "a baseline was just replaced." |
| 20 | `limit_unresolved_decision_conflicts` | `max_unresolved: number` (required) | `evaluateLimitUnresolvedDecisionConflicts` | Count-based whole-rule aggregate: `fail` if `unresolved_conflict_decision_ids.length` (post-pattern-filter) exceeds `max_unresolved`. |
| 21 | `require_decision_review_for_drift` | `decision_id_pattern?` | `evaluateRequireDecisionReviewForDrift` | Same pattern as #16, against `decisions_requiring_review_for_drift`. |

Every condition interface, Zod schema, and `GOVERNANCE_RULE_KINDS` entry for
all 10 kinds is added to `contracts.ts`/`policy-loader.ts` exactly mirroring
the pre-existing 11's own shape — a policy file author references a
decision-aware rule kind in `.rvs/policies/*.yml` the same way as any other
kind (see [docs/governance-policies.md](governance-policies.md) for the
file format itself).

## `decision_ref` on governance exceptions

`GovernanceException.decision_ref?: string` (`contracts.ts`) — an optional
field naming the decision that supports a given policy exception. Carried
through unmodified by `policy-loader.ts`'s `PolicyFileExceptionSchema` and
`loadPolicyFile()`. Governance-intelligence never resolves, validates, or
expires it itself — it trusts decision-intelligence's own
`governance-links.ts` resolution, surfaced back through
`exceptions_with_invalid_decision_ref` (see above). A linked decision
**supports** the exception; it never replaces or auto-generates the
exception record.

## Wiring status: connected end-to-end (Milestone 8.1)

`packages/cli/src/commands/governance-compare.ts`'s `runGovernanceComparison()`
calls `readDecisionCachedJsonOptional<DecisionGovernanceContext>(repoRoot,
DECISION_OUTPUT_FILES.decisionGovernanceContext)` immediately before
evaluating policies, and passes the result straight through as
`evaluatePolicy({ ..., decisionChanges })` for every loaded policy. The same
value is also attached verbatim to the assembled report as
`ContinuousIntelligenceReport.decision_changes`, so `report.decision_changes`
and the cached `decision-governance-context.json` are the identical object
by construction.

`governance-check.ts` gains no separate wiring of its own — it calls
`runGovernanceComparison()` (the function above) and layers `--ci`
exit-code gating on top, so decision-aware evaluation is automatically
present in `rvs governance check` as well.

**The opt-in guarantee is mechanical, not just documented:**
`readDecisionCachedJsonOptional()` returns `undefined` when
`.rvs/cache/decisions/decision-governance-context.json` doesn't exist (i.e.
`rvs decisions analyze` was never run for this repository), and
`decisionChanges: undefined` is exactly what `EvaluatePolicyInput` already
treated as "domain absent" — this is the same `readCachedJsonOptional`-style
best-effort load every other opt-in domain (`portfolioChanges`) uses, so a
repository that never adopts decision intelligence sees zero change in
governance's evaluation output, as the design mandate above requires.

Practical consequence: a repository that has run `rvs decisions analyze`
and configured a policy file referencing one of the 10 new rule kinds above
will now see those rules actually evaluated — with real findings, real
`GovernanceFinding[]` entries, and real `--ci` exit-code effects — when it
runs `rvs governance compare`/`check`. This is proven end-to-end (not just
unit-tested at the package level) by
`packages/cli/src/__tests__/decisions-governance-e2e.test.ts`, which drives
the real `runDecisionAnalysis()` → `runGovernanceCheck()` pipeline in-process
for two named workflows (see "End-to-end test coverage" below), and by the
source/package equivalence suite, which proves the packaged `npx rvs` CLI
produces identical governance findings and `--ci` exit codes for the same
two workflows.

## End-to-end test coverage (Milestone 8.1)

Two named workflows are proven end-to-end, not just at the individual
evaluator/unit level, in
`packages/cli/src/__tests__/decisions-governance-e2e.test.ts`:

- **Workflow A — architecture-change-missing-decision → governance check
  exit code.** A component that changes between two snapshots with zero
  covering decision link, combined with a configured `missing_decision_rules`
  entry naming that component, fails `require_decision_for_change` and
  exits `rvs governance check --ci` with `process.exitCode === 1`. A sibling
  test proves the same component covered by an accepted decision's link
  produces a `"pass"` finding and leaves the exit code untouched.
- **Workflow B — accepted-decision-with-contradicted-assumption → drift →
  governance finding → CI result.** An accepted decision whose assumption is
  marked `[contradicted]` in its frontmatter surfaces drift, populates
  `decisions_with_contradicted_assumptions`, fails
  `forbid_contradicted_assumption`, and exits `--ci` with `1` — with **no
  architecture change at all** (identical before/after snapshots), since
  this rule reads decision-derived context directly rather than scanning a
  domain diff. A sibling test proves an assumption marked `[confirmed]`
  instead produces a `"pass"` finding.

Both workflows are additionally proven structurally equivalent between the
tsx source CLI and an installed `npx rvs` tarball in
`packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` (gated
behind `RVS_TEST_PACKAGE=1`, since it builds and installs a real npm
tarball) — both engines independently produce byte-identical
`decision-governance-context.json` and equivalent `governance-findings.json`
field subsets, and both exit `--ci` with status `1`.

## Example CI workflow (illustrative only, documentation-only)

The following mirrors `docs/continuous-intelligence.md`'s own governance CI
example, extended with a `rvs decisions analyze` + `rvs decisions validate
--ci` step ahead of the governance check. It is **not** exercised by this
repository's own CI, contains no secrets, no pushes, and no PR
auto-commenting or auto-approval, and should be adapted rather than
copy-pasted verbatim. Because `rvs decisions analyze` runs before
`rvs governance check` here, the governance check picks up the cached
`decision-governance-context.json` automatically and evaluates any
decision-aware rule kinds configured in the referenced policy files.

```yaml
name: decision-governance
on: [pull_request]
jobs:
  decisions-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx rvs decisions analyze
      - run: npx rvs decisions validate --ci
      - run: npx rvs governance check --ci
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: decision-cache
          path: .rvs/cache/decisions/
```

`rvs decisions validate --ci` fails the build only when a validation
finding's severity is `error` (see
[docs/architecture-decision-intelligence.md#cli](architecture-decision-intelligence.md#cli)
for the exact log-line format). `rvs governance check --ci` fails the build
only when an un-excepted finding's severity is in the configured `fail_on`
list (default: `blocking`) — see "Wiring status" above for how decision
context now factors into that evaluation. This workflow never comments on,
pushes to, approves, or merges a pull request — it only writes local files
and sets `process.exitCode`.

## Known limitations

- **`require_decision_for_baseline_replacement` always resolves
  `unverifiable`.** No available context signals a baseline replacement
  event; this is unconditional, not scope-dependent.
- **Conservative floor means many rules can only ever reach `fail` or
  `unverifiable`, never a data-backed `pass`, once a decision is
  linked.** Rules #13-15 in particular cannot confirm the *stronger* claim
  (accepted/implemented/evidenced) from `DecisionGovernanceContext`'s flat
  id arrays alone — only rule #12 (`require_decision_for_change`) can reach
  a genuine `pass`.
- **Governance never validates `decision_ref` itself** — existence, status
  compatibility, scope match, and expiry are entirely decision-intelligence's
  responsibility, surfaced only as a flat id membership check.
- **No model-assisted synthesis.** Every one of the 10 evaluators is
  deterministic, rule-based, offline computation over already-computed
  change entries.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `DecisionGovernanceContextEcho` type; `governance-policy-extension.ts`'s `buildDecisionGovernanceContext()`; cached to `.rvs/cache/decisions/decision-governance-context.json` by `decisions-analyze.ts` |
| `@rvs/governance-intelligence` | `DecisionGovernanceContext` type (its own independent echo); 10 new `GovernanceRuleKind` values, condition interfaces, Zod schemas; `DomainChangeSets.decisionChanges?`/`EvaluatePolicyInput.decisionChanges?`/`ContinuousIntelligenceReport.decision_changes?`; 10 new `evaluate<Kind>` functions plus `scanDomainsForDecisionCoverage()`/`evaluateDecisionEntailedCoverageRule()`/`evaluateDecisionIdListRule()` shared helpers; `GovernanceException.decision_ref?` |
| `@rvs/cli` | `governance-compare.ts` reads the cached decision-governance-context (opt-in, best-effort) and passes it into `evaluatePolicy()`; `governance-check.ts` inherits this via `runGovernanceComparison()`; end-to-end coverage in `decisions-governance-e2e.test.ts` and `source-vs-package-equivalence.test.ts` — see "Wiring status" and "End-to-end test coverage" above |

Both `@rvs/decision-intelligence` and `@rvs/governance-intelligence` remain
mutually type-decoupled: neither package imports the other's types at
either the runtime or the type level, even for this shared
`DecisionGovernanceContext`/`DecisionGovernanceContextEcho` shape — each
package declares its own independent structural echo. See
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
and [docs/architecture-governance.md](architecture-governance.md) for each
package's own full type-decoupling statement.

See also: [docs/architecture-governance.md](architecture-governance.md),
[docs/continuous-intelligence.md](continuous-intelligence.md),
[docs/governance-policies.md](governance-policies.md),
[docs/decision-linking.md](decision-linking.md).
