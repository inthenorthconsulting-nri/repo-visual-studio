# Graph Change Planning (Milestone 9)

This document is part of [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
broader pipeline; it covers only one source module of `@rvs/knowledge-graph`:
`change-planning.ts` (`rvs graph plan-change --remove <entity-id>`'s
`planChange()`).

```
--remove <entity-id>
  -> runImpactAnalysis(query: { direction: "downstream" })   (impact-analysis.ts, not duplicated here)
  -> classifyEvidencePath() over every "evidenced_by" edge reached from
     the removed entity or any affected node                (change-planning.ts, regex pattern match)
  -> VALIDATION_COMMANDS_BY_NODE_TYPE lookup                  (change-planning.ts, static table)
  -> ChangePlanEntry
  -> rvs graph plan-change --remove <entity-id>
```

Scope: **composing already-computed impact analysis and decision impact
into a single "if I remove this entity, what needs review" report — never
duplicating impact/decision-impact's own traversal logic, and never
touching disk, git, or another CLI command.** This document does not
cover the impact-analysis or decision-impact algorithms themselves — see
[docs/graph-impact-analysis.md](graph-impact-analysis.md) and
[docs/graph-decision-impact.md](graph-decision-impact.md).

## Design mandate

> Change planning composes what impact analysis and decision impact
> already know; it must never re-derive their logic, and it must never
> take an action beyond producing a report.

Concretely, from `change-planning.ts`'s own header comment: this module
"[c]omposes impact-analysis.ts and decision-impact.ts (via
runImpactAnalysis) rather than duplicating their logic, and adds two
narrowly-scoped derivations of its own: evidence-path-pattern
classification (tests/docs/presentation) and a fixed, static
validation-command lookup table. Never writes to disk, never calls
another CLI command, never touches git — output only. Scope for this
milestone: only the `--remove` verb."

Only the removal verb is implemented — there is no `--add`, `--modify`,
or `--rename` verb in this milestone; `rvs graph plan-change` throws if
`--remove` is not supplied.

## Core artifact model

`ChangePlanEntry` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `buildChangePlanId(removedEntityId)`. |
| `schema_version` | number | `1`. |
| `removed_entity_node_id` | string | |
| `affected_node_ids` | string[] | Union of `impact.directly_affected` + `impact.transitively_affected`, sorted. |
| `decisions_requiring_review` | string[] | Copied directly from `impact.decisions_affected`. |
| `governance_requiring_review` | string[] | Copied directly from `impact.governance_findings_affected`. |
| `tests_likely_affected` | `EvidenceRef[]` | See "Evidence-path classification" below. |
| `docs_likely_affected` | `EvidenceRef[]` | See "Evidence-path classification" below. |
| `presentation_likely_affected` | `EvidenceRef[]` | See "Evidence-path classification" below. |
| `suggested_validation_commands` | string[] | See "Suggested validation commands" below. |
| `baselines_requiring_review` | string[] | Sorted, see below. |
| `unknown_consumers` | string[] | Node ids among the affected set whose `node_type === "unresolved_reference"`. |
| `evidence_refs` | `EvidenceRef[]` | Copied directly from `impact.evidence_refs`. |

## Algorithm

`planChange(nodes, edges, removedEntityNodeId, decisionStateLookup)`:

1. Runs `runImpactAnalysis()` with a query fixed to `direction:
   "downstream"` and `max_depth: DEFAULT_MAX_TRAVERSAL_DEPTH` (12) —
   change planning always asks "what's downstream of removing this,"
   never upstream or bidirectional.
2. Builds the full considered-node-id list: the removed entity itself plus
   every affected node id.
3. **Evidence-path classification.** For every considered node, every
   outgoing `evidenced_by` edge is followed to its evidence node, and each
   of that evidence node's own `evidence_refs` is classified by
   `classifyEvidencePath(ref.path)` — a regex match, not a semantic
   lookup:
   - `test`: path matches `` /(^|\/)(__tests__|tests?)\// `` or
     `` /\.(test|spec)\.[tj]sx?$/ ``.
   - `docs`: path matches `` /(^|\/)docs\// ``.
   - `presentation`: path matches
     `` /(^|\/)(renderer-html|narrative-planner|visualdoc-schema)\// ``, or
     `` /\.html$/ ``, or the path string contains the substring
     `"presentation"`.
   - Otherwise: unclassified (contributes to none of the three lists).
4. **Baseline detection.** For every considered node's `governs` or
   `evidenced_by` outgoing edges, if the edge's target node is
   `node_type === "baseline"`, that baseline's id is added to
   `baselines_requiring_review`.
5. **Unknown consumers.** Any affected finding whose `node_type ===
   "unresolved_reference"` is added to `unknown_consumers` — this is the
   change-plan's own signal for "something references this entity but the
   graph could not resolve what."
6. **Suggested validation commands** are derived purely from the *set of
   distinct node types* among the removed entity and all affected nodes,
   looked up in the fixed `VALIDATION_COMMANDS_BY_NODE_TYPE` table (below),
   deduplicated and sorted — never from any dynamic package/test
   discovery.

## Suggested validation commands table

`VALIDATION_COMMANDS_BY_NODE_TYPE` (`change-planning.ts`, a `Partial<Record<KnowledgeNodeType, string>>` —
node types not listed contribute no suggested command):

| Node type | Suggested command |
|---|---|
| `capability`, `capability_domain` | `rvs synthesize capabilities` |
| `product` | `rvs synthesize product-identity` |
| `portfolio_relationship` | `rvs synthesize portfolio` |
| `policy`, `governance_finding` | `rvs governance check --ci` |
| `decision`, `decision_assumption`, `decision_consequence` | `rvs decisions validate --ci` |
| `component`, `workflow`, `runtime_entrypoint`, `repository` | `rvs synthesize architecture` |

`package`, `command`, `presentation`, `baseline`, `evidence`, and
`unresolved_reference` node types have no entry and therefore never
contribute a suggested command on their own.

## CLI

```bash
rvs graph plan-change --remove <entity-id>
```

Throws if `--remove` is omitted: `` `\`rvs graph plan-change\` requires --remove <entity-id>.` ``.
Log lines (`packages/cli/src/commands/graph-plan-change.ts`):

```
Change plan for removing <node.id>:
  <N> node(s) affected.
  <N> decision(s) requiring review, <N> governance item(s) requiring review.
  tests likely affected: <N>, docs likely affected: <N>, presentation likely affected: <N>.
  baselines requiring review: <N>, unknown consumers: <N>.
```

plus, only when `suggested_validation_commands` is non-empty:
`` `  suggested validation commands: <comma-joined list>` ``.

## Known limitations

- **`--remove` only.** No `--add`/`--modify`/`--rename` verb exists this
  milestone — see "Design mandate" above.
- **Evidence-path classification is a regex pattern match over
  `evidenced_by` evidence paths, not a build-graph or test-runner
  analysis.** A test file that doesn't match the `test`/`spec` naming
  convention, or a doc outside `docs/`, will not be classified, even if it
  genuinely references the removed entity.
- **`package`, `command`, and `presentation` node types remain
  unpopulated** (see
  [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
  "Known, disclosed scope trims" section) — `presentation_likely_affected`
  is therefore covered only narrowly, through evidence-path pattern
  matching, never through a dedicated `presentation` node's own edges.
- **This module never executes any suggested validation command** — the
  list is advisory output only, for a human or a follow-on tool to run.
- **`planChange()` never writes to disk, calls another CLI command, or
  touches git** — the CLI wrapper (`graph-plan-change.ts`) is solely
  responsible for logging and cache writes.

## Package summary

| Module | Role |
|---|---|
| `change-planning.ts` | `planChange(nodes, edges, removedEntityNodeId, decisionStateLookup)` — the sole export this document covers |

This module lives inside `@rvs/knowledge-graph` — see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
"Package summary" for the full package/decoupling statement.

See also: [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md),
[docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-decision-impact.md](graph-decision-impact.md),
[docs/graph-showcase.md](graph-showcase.md).
