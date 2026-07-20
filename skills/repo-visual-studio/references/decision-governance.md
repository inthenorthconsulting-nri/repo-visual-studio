# Decision-Aware Governance (reference)

Use when: the task asks whether governance policy accounts for decisions
(e.g. "does our policy require a decision before removing a component") or
whether a policy exception has a supporting decision.

**Prerequisite**: this is a package-level extension to
`@rvs/governance-intelligence`, not a standalone command. It requires both
a decision snapshot (`rvs decisions analyze`) and a governance comparison
context to be meaningful — but **read the wiring-status warning below
before telling a user this is enforced by any CLI command today.**

**Command**: there is no dedicated CLI command for this extension. The 10
new `GovernanceRuleKind` values are evaluated only by
`@rvs/governance-intelligence`'s own `evaluatePolicy()` function and its
package-level test suite:

```bash
rvs decisions analyze          # produces the decision-side context
rvs governance compare|check   # does NOT read that context on this branch — see below
```

**Not wired into `rvs governance compare`/`rvs governance check` in this
codebase.** Confirmed via source inspection: neither CLI command reads a
cached decision snapshot or constructs a `DecisionGovernanceContext`. The
10 rule kinds (`require_decision_for_change`, `require_accepted_decision`,
`require_decision_implementation`, `forbid_contradicted_assumption`,
`forbid_active_superseded_decision`, `require_decision_evidence`,
`require_decision_for_policy_exception`,
`require_decision_for_baseline_replacement`,
`limit_unresolved_decision_conflicts`,
`require_decision_review_for_drift`) are fully implemented and
unit-tested at the package level, but not reachable end-to-end through
either CLI command. Do not tell a user a decisions-aware policy rule is
"enforced" by a `governance compare`/`check` run — it isn't, yet.

**Output**: none via the CLI on this branch. At the package level:
`DecisionGovernanceContext` (a flat, 6-field structural echo) and 10
`GovernanceFinding`-producing evaluator functions in `policy-evaluator.ts`.

**Validation**: `@rvs/governance-intelligence`'s own test suite
(`policy-evaluator.test.ts`, `policy-loader.test.ts`) exercises all 10
kinds directly against constructed fixtures — not through any CLI command.

Full technical reference: `docs/decision-governance.md` (the full rule
table, the conservative-floor evaluation pattern, the `decision_ref`
exception field, the wiring-status finding, and a documentation-only CI
example).
