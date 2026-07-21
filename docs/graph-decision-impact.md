# Graph Decision Invalidation Analysis (Milestone 9)

This document is part of [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
broader pipeline; it covers only one source module of `@rvs/knowledge-graph`:
`decision-impact.ts` (consumed by `rvs graph impact`, `rvs graph
plan-change`, and `rvs graph compare`).

```
decisions.json / assumptions.json (already-computed decision-intelligence output)
  -> buildDecisionStateLookup()                (decision-impact.ts)
  -> traverse(target, direction: "both")       (traversal.ts, shared engine)
  -> classifyReachedDecisionImpact() per reached "decision" node
       -> fixed decision table over decision_status / implementation_status / assumption states
  -> computeDecisionImpact() -> DecisionImpactEntry[]
  -> consumed by runImpactAnalysis() (impact-analysis.ts) and planChange() (change-planning.ts)
```

Scope: **classifying which already-computed decisions are reachable from
a target entity, and what their already-recorded state implies — never
re-deriving or re-scoring a decision's own status.** This document does
not cover impact analysis's traversal/blast-radius machinery or change
planning's evidence-path composition — see
[docs/graph-impact-analysis.md](graph-impact-analysis.md) and
[docs/graph-change-planning.md](graph-change-planning.md).

## Design mandate

> The knowledge graph may report that a decision is reachable from a
> changed entity and surface that decision's own already-recorded state,
> but it must never reverse, approve, reject, or invalidate a decision on
> its own authority — that judgment belongs to Architecture Decision
> Intelligence and to the humans who act on its output.

Concretely, from `decision-impact.ts`'s own header comment: this module
determines "[w]hich decisions/assumptions become invalid if an entity
changes or is removed. Looks up each decision's already-computed state
from decision-intelligence's own cached decisions.json/assumptions.json
(consumed as JSON, never re-derived) and classifies via a fixed decision
table. RVS never reverses, approves, or rejects the decision itself — this
module only reports connectivity + existing classification."

## Core artifact model

`DecisionImpactEntry` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `buildDecisionImpactId(decisionNodeId, rootEntityId)`. |
| `schema_version` | number | `1`. |
| `decision_node_id` | string | The reached decision's own graph node id. |
| `target_entity_node_id` | string | The entity the traversal originated from. |
| `state` | `DecisionImpactState` | One of 7 values, see below. |
| `detail` | string | Fixed, state-specific explanation string, naming the edge type(s) the decision was reached via. |
| `evidence_refs` | `EvidenceRef[]` | The decision node's own `evidence_refs` (not re-collected from traversal edges). |

`DecisionImpactState` (`contracts.ts`, 7 values): `unaffected`,
`review_required`, `assumption_weakened`, `assumption_contradicted`,
`implementation_invalidated`, `superseded`, `unverifiable`.

`DecisionStateLookup` (`decision-impact.ts`, built once per build/query via
`buildDecisionStateLookup(decisions, assumptions)`): two maps —
`decisionByDecisionId: Map<string, { decision_status?, implementation_status? }>`
and `assumptionsByDecisionId: Map<string, Array<{ id, state? }>>` — read
directly from `RawDecisionStateArtifact`/`RawDecisionAssumptionStateArtifact`,
themselves narrow structural echoes of decision-intelligence's own cached
`decisions.json`/`assumptions.json`, never imported as `@rvs/decision-intelligence`
types.

## The fixed decision table

`classifyReachedDecisionImpact({ decisionSourceEntityId, lookup,
reachedViaEdgeTypes })` is invoked only for decisions traversal has
already confirmed are reachable — `"unaffected"` is never returned by this
function; it is the caller's own label (used by `impact-analysis.ts`'s
consumers) for a decision known about but never reached at all. The
classifier evaluates in this exact order, first match wins:

1. **No decision-state record and no assumption records at all** →
   `"unverifiable"`.
2. **`decision_status === "superseded"`** → `"superseded"`.
3. **Any assumption's `state === "contradicted"`** →
   `"assumption_contradicted"`.
4. **Any assumption's `state === "weakened"`** → `"assumption_weakened"`.
5. **`implementation_status === "invalidated"` or `"broken"`** →
   `"implementation_invalidated"`.
6. **Any assumption's `state === "unverifiable"`** → `"unverifiable"`.
7. Otherwise → `"review_required"`.

This ordering is deliberate: a superseded decision is reported as
superseded even if one of its assumptions also happens to be
contradicted, and a contradicted assumption takes priority over a merely
weakened one — the table always returns the single most severe signal it
can support from already-recorded state, never a combined or averaged
judgment.

`computeDecisionImpact(nodes, edges, targetEntityNodeId, lookup)` runs one
bidirectional (`direction: "both"`) traversal, bounded to
`DEFAULT_MAX_TRAVERSAL_DEPTH` (12), then classifies every reached
`node_type === "decision"` node, sorted by `decision_node_id`.

`assumptionNodeIdsPotentiallyInvalidated(decisionSourceEntityId, lookup,
nodeIds)` returns every `decision_assumption` node id — filtered to ones
actually present in the current graph's node-id set — whose upstream
`state` is `"weakened"` or `"contradicted"`, sorted. `impact-analysis.ts`
calls this per reached, classified decision to populate
`ImpactResult.assumptions_potentially_invalidated`.

## CLI

`decision-impact.ts` has no CLI command of its own — its output is always
composed into `rvs graph impact` (appended to
`.rvs/cache/knowledge-graph/decision-impact.json`, merge-by-id) and `rvs
graph plan-change` (via `change-planning.ts`, see
[docs/graph-change-planning.md](graph-change-planning.md)). See
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md#cli)
for those commands' exact log-line formats.

## Known limitations

- **State is read, never re-derived.** If decision-intelligence's own
  cached `decisions.json`/`assumptions.json` is stale relative to the
  actual decision documents, this module has no way to detect or correct
  that — re-running `rvs decisions analyze` is the caller's
  responsibility, exactly as every other consumer of decision-intelligence
  output in this repository already requires.
- **`"unaffected"` is never produced by the classifier itself** — see "The
  fixed decision table" above. A caller wanting to distinguish "not
  reached" from "reached but unverifiable" must do so itself by comparing
  against the full decision node set.
- **The classifier returns exactly one state per decision**, even when
  multiple signals could apply (e.g. a decision that is both superseded
  and has a contradicted assumption) — see the fixed priority order above.
- **Bounded to `DEFAULT_MAX_TRAVERSAL_DEPTH` (12) hops**, the same shared
  traversal bound documented in
  [docs/graph-impact-analysis.md](graph-impact-analysis.md).

## Package summary

| Module | Role |
|---|---|
| `decision-impact.ts` | `buildDecisionStateLookup`, `classifyReachedDecisionImpact`, `assumptionNodeIdsPotentiallyInvalidated`, `computeDecisionImpact` — every export this document covers |

This module lives inside `@rvs/knowledge-graph` and reads
`@rvs/decision-intelligence`'s cached output as untyped JSON only — see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
"Package summary" for the full package/decoupling statement, and
[docs/decision-linking.md](decision-linking.md) for how decision state
itself is originally computed (a separate, upstream pipeline this module
never re-runs).

See also: [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md),
[docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-change-planning.md](graph-change-planning.md),
[docs/graph-showcase.md](graph-showcase.md).
