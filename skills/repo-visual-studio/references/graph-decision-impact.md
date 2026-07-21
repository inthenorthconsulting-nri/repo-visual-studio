# Graph Decision Invalidation Analysis (reference)

Use when: the task asks "what decisions depend on this capability/
component," "which decisions would be invalidated by this change," or
"would this change contradict or weaken an assumption behind a decision."

**Prerequisite**: `rvs graph build` has run, and `rvs decisions analyze`
has been run at some point so `decisions.json`/`assumptions.json` are
cached — a decision reachable in the graph but with no cached state
classifies as `unverifiable` rather than throwing. Covers
`decision-impact.ts` only; no CLI command of its own — always composed
into `rvs graph impact` and `rvs graph plan-change`.

**Command**: consumed by, not invoked directly:

```bash
rvs graph impact <entity-id>
rvs graph plan-change --remove <entity-id>
```

**Output**: appended to `.rvs/cache/knowledge-graph/decision-impact.json`.

**Key facts to get right when explaining a result to a user**:

- **Reads, never re-derives, decision state.** This module looks up each
  reached decision's already-computed `decision_status`/
  `implementation_status`/assumption states from
  `@rvs/decision-intelligence`'s own cached output — it never reopens,
  re-runs, reverses, approves, rejects, or invalidates a decision itself;
  that authority stays with Architecture Decision Intelligence and the
  humans acting on its output.
- **Fixed 7-step decision table, first match wins**: no state record at
  all → `unverifiable`; `decision_status === "superseded"` →
  `superseded`; any assumption `contradicted` → `assumption_contradicted`;
  any assumption `weakened` → `assumption_weakened`;
  `implementation_status` `invalidated`/`broken` →
  `implementation_invalidated`; any assumption `unverifiable` →
  `unverifiable`; otherwise → `review_required`. A superseded decision
  always reports as superseded even if an assumption is also
  contradicted — the table returns the single most severe supported
  signal, never a blended one.
- `"unaffected"` is a caller-assigned label (a decision known about but
  never reached by the traversal) — the classifier itself never returns
  it.
- One bidirectional traversal per query, bounded to
  `DEFAULT_MAX_TRAVERSAL_DEPTH` (12).

**Do not** phrase a `review_required`/`assumption_weakened`/etc. result as
this layer's own verdict on the decision — always attribute the state to
decision-intelligence's own already-recorded facts, and note that stale
upstream state (if `rvs decisions analyze` hasn't rerun recently) isn't
detected here.

Full technical reference: `docs/graph-decision-impact.md` (the exact
7-value `DecisionImpactState` list, `DecisionStateLookup` structure, full
algorithm detail).
