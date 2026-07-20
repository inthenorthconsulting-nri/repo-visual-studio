# Architecture Decision Intelligence (reference)

Use when: the task asks what decisions explain the current architecture,
which accepted decisions still aren't implemented, whether a change
violates a documented decision, or wants a full decision-debt/drift report
(`MASTER_AGENT.md` §2 decisions row).

**Prerequisite**: `.rvs/decisions.yml` exists and names at least one
`sources` entry pointing at a directory of ADR/RFC/design-decision/
decision-log Markdown documents. Unlike every other intelligence layer,
this one does not require any other layer's cache artifact to exist — it
reads decision documents directly from the repository. See
`references/decision-discovery.md` for the config schema and recognized
document shapes.

**Command**:

```bash
rvs decisions analyze
```

**Output**: `.rvs/cache/decisions/*.json` — a `DecisionSnapshot`, resolved
links/dependencies/supersession issues, drift findings, debt findings,
conflicts, coverage, and implementation-state summaries, cached as
individual files (17 named keys — see `docs/architecture-decision-intelligence.md`
for the full list).

**Validation**: `rvs decisions validate [--ci]` runs structural validation
findings; `rvs decisions explain <id>` prints one decision's, link's, or
finding's full reasoning and evidence.

**Export**: `rvs export decision-report [--output decision-report.json]` /
`rvs export decision-summary [--output decision-summary.md]` (paste-ready
Markdown).

**Do not** offer to create, approve, or reject a decision document as part
of this workflow — there is no `rvs decisions new` command; see
`references/decision-discovery.md`.

Full technical reference: `docs/architecture-decision-intelligence.md`
(core artifact model, full pipeline, ids, CLI, known limitations — start
here, then follow its own "See also" links to the 6 companion documents:
`docs/decision-record-format.md`, `docs/decision-linking.md`,
`docs/decision-drift.md`, `docs/decision-debt.md`,
`docs/decision-governance.md`, `docs/decision-showcase.md`).
