# Decision Drift (Milestone 8)

This document describes `decision-drift.ts`, the detector that flags when a
decision's surrounding evidence has moved out of alignment with what the
decision itself declares — a linked entity removed, an assumption
contradicted, implementation regressed, governance status downgraded, and
10 other causes. It is part of
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)'s
broader pipeline.

```
ArchitectureDecision[] + DecisionAssumption[] + DecisionLink[] + DecisionConflict[]
  + DecisionSupersessionIssue[] + DecisionSourceIssue[]
  + criticality-by-decision-id + implementation-status-by-decision-id
  + governance-status-by-decision-id [+ previous snapshot's equivalents, optional]
  -> detectDecisionDrift() (decision-drift.ts)
  -> DecisionDrift[]
  -> feeds decision-debt.ts, narrative.ts, decision-plan.ts's decision-drift scene
```

## Design mandate

From `decision-drift.ts`'s own header comment:

> Severity always derives from an explicit policy/criticality/evidence-state
> signal; a decision is never marked "blocking" purely from staleness or
> age.

Concretely:

- **13 fixed causes, each independently detected.** No cause is inferred
  from a combination of other causes at detection time — each has its own
  dedicated check against the current (and, for 4 of the 13, the previous)
  snapshot's evidence.
- **`coverage_regressed` is declared but never emitted here.** It exists in
  `DecisionDriftCause` for shape completeness, but this module never
  produces it — doing so would double-count what `linked_entity_removed`
  already reports for the same underlying change.
- **Severity is a function of criticality and signal weight, not
  vibes.** `severityFor()` combines a decision's own `DecisionCriticality`
  rank with a per-cause "hard"/"soft" weight to land on one of 4
  `DecisionDriftSeverity` values — the same decision-level input always
  produces the same severity for the same cause.

## The 13 drift causes

`DecisionDriftCause` (`contracts.ts`), all 13 confirmed present in
`decision-drift.ts`:

| Cause | Needs `previous` snapshot? | Meaning |
|---|---|---|
| `linked_entity_removed` | No | A resolved link's target entity no longer appears in the relevant upstream snapshot. |
| `linked_entity_materially_changed` | No | A resolved link's target entity changed in a way the upstream artifact itself reports as material. |
| `assumption_contradicted` | No | One of the decision's own assumptions is in state `contradicted`. |
| `implementation_regressed` | **Yes** | `implementation_status` moved backward between the previous and current snapshot. |
| `governance_status_downgraded` | **Yes** | `governance_status` moved backward (via `GOVERNANCE_RANK`). |
| `conflict_introduced` | **Yes** | A `DecisionConflict` involving this decision appeared that wasn't present previously. |
| `criticality_upgraded_without_review` | **Yes** | Criticality moved up (via `CRITICALITY_RANK`) without an accompanying review signal. |
| `upstream_artifact_incompatible` | No | A resolved link's upstream snapshot is itself `incompatible`/`partial`. |
| `supersession_target_removed` | No | A `supersedes`/`superseded_by` target no longer resolves. |
| `evidence_lineage_broken` | No | A link's evidence chain is broken (mirrors governance's own `"broken"` lineage state). |
| `decision_document_unparseable` | No | The decision's own source has an unresolved `DecisionSourceIssue`. |
| `policy_exception_expired` | No | A governance-exception link this decision backs has expired. |
| `coverage_regressed` | — | **Declared, never emitted by this module** (see "Design mandate" above). |

## Severity model

`DecisionDriftSeverity` — 4 values: `blocking`, `review_required`,
`advisory`, `informational`.

`CRITICALITY_RANK`: `{ standard: 0, elevated: 1, critical: 2, unresolved:
-1 }` — `"unresolved"` deliberately ranks *below* `"standard"`, so an
unresolved-criticality decision never outranks a confirmed-standard one on
severity grounds alone.

`GOVERNANCE_RANK`: `{ aligned: 0, review_required: 1, unverifiable: 1,
conflicting: 2 }` — `review_required` and `unverifiable` share a rank,
since neither is a confirmed pass.

`severityFor()` combines a cause's fixed "hard" (structural, e.g. a removed
link target) or "soft" (evidentiary, e.g. an assumption weakening) weight
with the decision's criticality rank to land on one of the 4 severities —
never derived from how long a decision has sat in a given status.

## CLI

```bash
rvs decisions analyze
  # -> .rvs/cache/decisions/drift.json

rvs decisions explain <drift-id>
```

`rvs decisions analyze`'s findings log line reports the drift count
directly:

```
Findings: <N> drift, <N> debt, <N> conflict(s), <N> supersession issue(s).
```

Full CLI reference (all commands, exact log-line formats):
[docs/architecture-decision-intelligence.md#cli](architecture-decision-intelligence.md#cli).

## Known limitations

- **The 4 previous-snapshot-dependent causes require a caller-supplied
  `previous` argument.** `decisions-analyze.ts` runs a single-snapshot
  analysis pass — it does not itself supply a `previous` decision snapshot,
  so `implementation_regressed`, `governance_status_downgraded`,
  `conflict_introduced`, and `criticality_upgraded_without_review` are
  effectively inert from this CLI path today (the detector logic exists and
  is exported; a caller that supplies two snapshots' worth of context, e.g.
  via `rvs decisions compare`, would need its own wiring to also compute
  drift across them, which `decisions-compare.ts` does not currently do —
  it produces a `DecisionChangeSet`, not a `DecisionDrift[]`).
- **No model-assisted synthesis.** Every cause check is deterministic,
  rule-based, offline computation over already-computed artifacts.
- **Never blocking from staleness/age alone.** There is no
  "stale decision" drift cause — `decision-debt.ts`'s
  `stale_proposed_decision` category is the mechanism for age-based
  findings, kept deliberately separate from drift's evidence-state model.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `DecisionDrift`/`DecisionDriftCause`/`DecisionDriftSeverity` types; `decision-drift.ts` |
| `@rvs/cli` | `rvs decisions analyze` (produces `drift.json`); `rvs decisions explain <id>` |

See [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
for the package-level type-decoupling statement.

See also: [docs/decision-debt.md](decision-debt.md),
[docs/decision-linking.md](decision-linking.md),
[docs/decision-governance.md](decision-governance.md).
