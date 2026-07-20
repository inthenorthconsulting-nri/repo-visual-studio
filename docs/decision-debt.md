# Decision Debt (Milestone 8)

This document describes `decision-debt.ts`, the detector that surfaces
"architecture-decision debt" — accepted decisions without implementation,
broken supersession chains, unaddressed contradicted assumptions, and 11
other categories — as a stateless, per-run finding list. It is part of
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)'s
broader pipeline.

```
ArchitectureDecision[] + DecisionImplementationState[] + DecisionDrift[]
  + DecisionConflict[] + DecisionSupersessionIssue[] + MissingDecisionFinding[]
  + DecisionAssumption[] + DecisionSourceIssue[] + DecisionLink[]
  + DecisionDependency[] + governance-status-by-decision-id
  + criticality-by-decision-id + now
  -> detectDecisionDebt() (decision-debt.ts)
  -> DecisionDebtFinding[]
  -> feeds narrative.ts, decision-plan.ts's decision-debt scene
```

## Design mandate

From `decision-debt.ts`'s own header comment:

> The 14 debt categories... no cost or effort estimation anywhere in this
> module (explicitly forbidden by spec §30).

Concretely:

- **Every finding's `resolution_state` is always `"open"` at detection
  time.** This detector is stateless — it has no memory of a
  previously-acknowledged or previously-resolved finding across runs.
  Tracking acknowledgement/resolution over time, if ever added, would be a
  separate caller-side concern layered on top of this module's output, not
  a change to the module itself.
- **No cost, effort, or time-to-resolve estimation anywhere.** A
  `DecisionDebtFinding` carries a category, a severity, an optional
  `blast_radius_id`, a `requires_human_review` flag, and a detail string —
  never a numeric estimate of remediation cost.
- **Age alone never creates debt beyond `stale_proposed_decision`'s own,
  explicit threshold.** `DEFAULT_STALE_PROPOSED_THRESHOLD_DAYS = 90` is the
  one place elapsed time enters this module's logic at all.

## The 14 debt categories

`DecisionDebtCategory` (`contracts.ts`), all 14 confirmed present in
`decision-debt.ts`:

| Category | Meaning |
|---|---|
| `accepted_without_implementation` | `decision_status` is `accepted` but `implementation_status` is `not_started`. |
| `implementation_regressed_from_decision` | `implementation_status` is `regressed`. |
| `stale_proposed_decision` | `decision_status` is `proposed` and older than `DEFAULT_STALE_PROPOSED_THRESHOLD_DAYS` (90 days). |
| `unresolved_conflict` | A `DecisionConflict` involving this decision has `status !== "resolved"`. |
| `broken_supersession_chain` | A `DecisionSupersessionIssue` names this decision. |
| `missing_required_decision` | A `MissingDecisionFinding` names this decision's scope. |
| `contradicted_assumption_unaddressed` | An assumption in state `contradicted` with no follow-up evidence. |
| `expired_policy_exception` | A governance-exception link this decision backs has expired. |
| `unverifiable_governance_status` | `governance_status` is `"unverifiable"`. |
| `orphaned_decision` | The decision has no resolved links to any upstream domain at all. |
| `duplicate_decision_identity` | A `DecisionSourceIssue` of kind `duplicate_id_exact`/`duplicate_id_case_only`/`multiple_files_claim_one_id` names this decision. |
| `unparseable_decision_document` | A `DecisionSourceIssue` of kind `unparseable_structure`/`unsupported_source_type` names this decision. |
| `incompatible_upstream_linkage` | A resolved link's target snapshot is `incompatible`. |
| `criticality_unreviewed` | `criticality` is `critical`/`elevated` with no accompanying governance review signal. |

Every `DecisionDebtFinding` carries a `DecisionDriftSeverity` (the same
4-value scale drift uses: `blocking`/`review_required`/`advisory`/
`informational`) and a `requires_human_review: boolean` flag.

## CLI

```bash
rvs decisions analyze
  # -> .rvs/cache/decisions/decision-debt.json
  #    { findings: DecisionDebtFinding[], missing_decision_findings: MissingDecisionFinding[] }

rvs decisions explain <debt-finding-id>
```

Missing-decision findings have no dedicated output file of their own — they
are folded into `decision-debt.json` alongside debt findings, per
`decisions-analyze.ts`'s own comment (see
[docs/architecture-decision-intelligence.md#known-limitations](architecture-decision-intelligence.md#known-limitations)).

`rvs decisions analyze`'s findings log line reports the debt count
directly:

```
Findings: <N> drift, <N> debt, <N> conflict(s), <N> supersession issue(s).
```

Full CLI reference: [docs/architecture-decision-intelligence.md#cli](architecture-decision-intelligence.md#cli).

## Known limitations

- **No cost or effort estimation** — an explicit, disclosed scope trim
  (spec §30), quoted above. If a consuming workflow wants to prioritize
  debt findings by estimated remediation effort, that is a caller-side
  concern layered on top of this module's severity/category output, not
  something this module computes.
- **`missing_required_decision` depends on `missing-decisions.ts`, which
  the CLI currently always calls with an empty rules array.** In practice,
  this debt category is never populated from the `rvs decisions analyze`
  CLI path today — see
  [docs/architecture-decision-intelligence.md#known-limitations](architecture-decision-intelligence.md#known-limitations).
- **Stateless across runs.** `resolution_state` is always `"open"` at
  detection time; there is no acknowledged/resolved tracking built into
  this module.
- **No model-assisted synthesis.** Every category check is deterministic,
  rule-based, offline computation over already-computed artifacts.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `DecisionDebtFinding`/`DecisionDebtCategory` types; `decision-debt.ts` |
| `@rvs/cli` | `rvs decisions analyze` (produces `decision-debt.json`); `rvs decisions explain <id>` |

See [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
for the package-level type-decoupling statement.

See also: [docs/decision-drift.md](decision-drift.md),
[docs/decision-linking.md](decision-linking.md),
[docs/decision-governance.md](decision-governance.md).
