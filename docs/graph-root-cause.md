# Graph Root-Cause Grouping (Milestone 9)

This document is part of [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
broader pipeline; it covers only one source module of `@rvs/knowledge-graph`:
`root-cause.ts` (`rvs graph roots`'s `groupRootCauses()`).

```
governance_finding nodes (node_type === "governance_finding")
  -> group by "affects" edges to an anchor entity        (root-cause.ts)
  -> traceAncestors() upstream, causal-edges-only pass    (CAUSAL_EDGE_TYPES)
  -> traceAncestors() upstream, all-edge-types pass
  -> UnionFind over shared ancestor sets (causal pass first, then remainder)
  -> classify each resulting group: confirmed | probable | shared_dependency_only | unresolved
  -> rvs graph roots
```

Scope: **grouping already-computed governance findings by shared upstream
ancestor only.** This document does not cover impact analysis, decision
invalidation, or change planning — see
[docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-decision-impact.md](graph-decision-impact.md), and
[docs/graph-change-planning.md](graph-change-planning.md).

## Design mandate

> A shared ancestor establishes a *candidate* root cause only when it is
> reached through a relationship type that could plausibly cause the
> finding — never merely because two findings share a tag, a repository,
> or an unrelated referential edge.

Concretely, from `root-cause.ts`'s own header comment: this module
"[g]roups governance findings by shared upstream ancestor, using only each
finding's own already-computed anchor edge (`affects`: finding -> entity)
and the shared bounded-BFS traversal engine — never claims causality
merely because findings share a tag or repository. Strictly conservative:
a shared ancestor reached only via non-causal edge types (references,
evidenced_by, ...) is reported as `shared_dependency_only`, never promoted
to `probable`/`confirmed`."

## Core artifact model

`RootCauseGroup` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `buildRootCauseGroupId(rootKey)` — `rootKey` is the single shared-root node id when there's exactly one, else `` `multi:${digestOf(sortedRoots)}` ``. |
| `schema_version` | number | `1`. |
| `finding_node_ids` | string[] | Sorted governance-finding node ids in this group. |
| `candidate_root_node_ids` | string[] | Sorted node ids identified as candidate root(s). |
| `classification` | `RootCauseClassification` | One of 4 values, see below. |
| `detail` | string | Fixed, classification-specific explanation string (see "Classification" below). |
| `evidence_refs` | `EvidenceRef[]` | Deduplicated union of every member finding's own `evidence_refs`. |

`RootCauseClassification` (`contracts.ts`, 4 values): `confirmed`,
`probable`, `shared_dependency_only`, `unresolved`.

## Algorithm

`groupRootCauses(nodes, edges)`:

1. **Collect every `governance_finding` node**, sorted by id.
2. **Split by anchor resolvability.** For each finding, its anchor
   node ids are the `to_node_id`s of its outgoing `affects` edges. A
   finding with zero anchor edges, or whose every anchor resolved to an
   `unresolved_reference` node, goes to the `anchorUnresolved` bucket;
   everything else (`anchorResolved`) keeps its list of resolved anchor
   ids.
3. **Trace ancestors twice per resolved finding**, both times an upstream
   (`direction: "upstream"`) traversal from each of its anchor node ids,
   bounded to `DEFAULT_MAX_TRAVERSAL_DEPTH` (12):
   - a **causal-only pass** (`allowedEdgeTypes: CAUSAL_EDGE_TYPES` —
     `contains`, `depends_on`, `invokes`, `implements`, `produces`,
     `consumes`),
   - an **all-edge-types pass** (no `allowedEdgeTypes` filter).
   Each trace also records `allResolved`: whether every traversed edge's
   own `resolution_status === "resolved"`.
4. **Union-find over the causal-pass ancestor sets.** Any two resolved
   findings whose causal-only ancestor sets intersect are unioned.
   Components of size ≥ 2 become groups (see "Classification" below);
   their member indices are marked "grouped" and excluded from the next
   step.
5. **Union-find over the all-edge-types ancestor sets, for the
   remainder.** The same union-find process re-runs, this time over
   findings *not* already grouped in step 4, using the all-edge-types
   ancestor sets. Components of size ≥ 2 become `shared_dependency_only`
   groups.
6. **Every finding in `anchorUnresolved`** becomes its own singleton
   `unresolved` group.
7. Groups are returned sorted by `id`.

## Classification

| Classification | When it fires | Fixed `detail` text |
|---|---|---|
| `confirmed` | A causal-pass component whose members share exactly **one** common causal ancestor (`sharedRoots.size === 1`) *and* every member's causal trace is fully resolved. | "Every finding in this group traces to exactly one common upstream ancestor via resolved causal edges only." |
| `probable` | A causal-pass component that doesn't meet `confirmed`'s bar — either more than one shared causal ancestor, or at least one member's causal trace includes a partial/unresolved edge. | Either "Findings share more than one common causal ancestor candidate — which one is the root is ambiguous." or "Findings are causally linked, but at least one path includes a partial edge or the group has no single ancestor common to every member." (selected by whether `sharedRoots.size > 1`). |
| `shared_dependency_only` | An all-edge-types-pass component among findings not already grouped as `confirmed`/`probable` — the shared ancestor is only reachable via a non-causal edge type. | "Findings reach a common node only via non-causal edge types (e.g. references/evidenced_by) — connectivity does not establish causality here." |
| `unresolved` | A single finding whose own anchor entity never resolved (see step 2 above). | "This finding's own anchor entity is unresolved, so no upstream relationship to any other finding can be computed." |

Every classification's candidate-root list falls back to the pairwise
union of member ancestor sets when there is no single shared root
(`sharedRoots.size === 0`) — the group is never left with an empty root
list when the members are genuinely connected, only when there is truly
no overlap at all (in which case the members wouldn't have been unioned
together in the first place).

## CLI

```bash
rvs graph roots
  # Re-groups root causes from the currently cached nodes/edges
```

Log lines (`packages/cli/src/commands/graph-roots.ts`) — if zero groups:

```
No root-cause groups found among currently cached governance findings.
```

otherwise:

```
<N> root-cause group(s):
  [<classification>] <N> finding(s) -> <N> candidate root(s) — <detail>
```

one line per group.

## Known limitations

- **Only `governance_finding` nodes are grouped.** This module has no
  notion of grouping any other node type by shared ancestor.
- **Anchors come only from `affects` edges.** A finding's relationship to
  its entity is read exclusively through the `affects` edge type built by
  `edge-builder.ts`'s `buildGovernanceEdges()` — see
  [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
  disclosed note that `GovernanceFinding.result`'s exact enum values were
  never independently re-verified, so `violates` edges are never asserted.
- **Bounded to `DEFAULT_MAX_TRAVERSAL_DEPTH` (12) ancestor hops.** An
  ancestor reachable only beyond that depth is invisible to grouping —
  this is the same shared traversal bound documented in
  [docs/graph-impact-analysis.md](graph-impact-analysis.md), not a
  root-cause-specific limit.
- **`shared_dependency_only` is a deliberate ceiling, not a downgrade
  path back to `probable`/`confirmed`.** Once a component is only
  reachable via non-causal edges, no further evidence within this module
  promotes it.

## Package summary

| Module | Role |
|---|---|
| `root-cause.ts` | `groupRootCauses(nodes, edges)` — the sole export this document covers |

This module lives inside `@rvs/knowledge-graph` — see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
"Package summary" for the full package/decoupling statement.

See also: [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md),
[docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-decision-impact.md](graph-decision-impact.md),
[docs/graph-change-planning.md](graph-change-planning.md),
[docs/graph-showcase.md](graph-showcase.md).
