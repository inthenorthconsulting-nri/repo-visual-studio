# Decision Drift and Debt (reference)

Use when: the task asks which decisions have gone stale relative to their
own evidence (drift), or wants a prioritized list of decision-related
technical debt (accepted-but-unimplemented, broken supersession, unresolved
conflicts, and 11 other categories).

**Prerequisite**: `rvs decisions analyze` has run. Drift and debt are both
produced as part of that single pass — there is no standalone "drift only"
or "debt only" subcommand.

**Command**:

```bash
rvs decisions analyze
```

**Output**: `.rvs/cache/decisions/drift.json` (13 possible causes, 4-value
severity scale: `blocking`/`review_required`/`advisory`/`informational`)
and `decision-debt.json` (14 categories, plus missing-decision findings
folded in alongside debt findings).

**Key facts to get right when explaining a result to a user**:

- Severity always derives from an explicit criticality/governance-status
  signal — never from staleness or age alone. The one age-based exception
  is debt's `stale_proposed_decision` category, using a fixed 90-day
  threshold, kept deliberately separate from drift's evidence-state model.
- 4 of drift's 13 causes (`implementation_regressed`,
  `governance_status_downgraded`, `conflict_introduced`,
  `criticality_upgraded_without_review`) require a previous snapshot to
  compare against. `rvs decisions analyze` runs a single-snapshot pass and
  never supplies one — those 4 causes are effectively inert from this CLI
  path today, even though the detector logic itself is implemented and
  tested.
- Debt findings never carry a cost or effort estimate — an explicit,
  disclosed scope trim. If a user wants prioritization by remediation
  effort, that's a caller-side judgment layered on top of severity/category,
  not something this module computes.
- `missing_required_decision` (a debt category) is never populated from the
  `rvs decisions analyze` CLI path today — the underlying detector is
  called with an empty rules array.

**Validation**: `rvs decisions explain <drift-id | debt-finding-id>` prints
the full reasoning for one finding.

Full technical reference: `docs/decision-drift.md` (all 13 causes, the
exact severity-rank tables) and `docs/decision-debt.md` (all 14
categories).
