# Graph Traversal, Path-Finding, and Impact Analysis (Milestone 9)

This document is part of [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
broader pipeline; it covers only four source modules of `@rvs/knowledge-graph`:
`traversal.ts` (the shared bounded-BFS engine), `path-finding.ts`
(shortest-path and bounded all-paths enumeration), `impact-analysis.ts`
(`rvs graph impact`'s query classifier), and `blast-radius.ts` (the
6-level blast-radius derivation both `impact-analysis.ts` and the
narrative/plan modules consume).

```
KnowledgeNode[], KnowledgeEdge[]
  -> buildEdgeIndex()                         (traversal.ts)
  -> traverse(root, TraversalOptions)         (traversal.ts, bounded BFS, shared engine)
       used by -> findShortestPath() / findAllPaths()   (path-finding.ts)
       used by -> runImpactAnalysis()                   (impact-analysis.ts)
                    -> deriveBlastRadiusLevel()          (blast-radius.ts)
                    -> computeDecisionImpact()            (decision-impact.ts, not duplicated here)
  -> rvs graph path <from> <to> [--all]
  -> rvs graph impact <entity-id>
  -> rvs export impact-summary
```

Scope: **traversal, reachability, path-finding, and impact/blast-radius
classification only.** This document does not cover root-cause grouping,
decision-invalidation classification, or change planning — see
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-decision-impact.md](graph-decision-impact.md), and
[docs/graph-change-planning.md](graph-change-planning.md).

## Design mandate

> Every traversal is bounded, deterministic regardless of input order, and
> honest about when a limit was hit — a truncated result must always say so,
> never look complete by omission.

Concretely, from `traversal.ts`'s own header comment: this is "a single
shared bounded-BFS traversal engine (O(V+E)) used by impact-analysis.ts,
blast-radius.ts, root-cause.ts, decision-impact.ts, and change-planning.ts.
Never all-simple-paths — that combinatorial mode is reserved for
path-finding.ts's explicit bounded `--all`." Concretely:

- **Edge indexing is precomputed once per call** (`buildEdgeIndex()`) into
  sorted `outgoing`/`incoming` adjacency maps (sorted by edge `id`, so
  iteration order never depends on input array order).
- **A single visited-set gives O(1) cycle protection** — `traverse()` never
  revisits a node, so a cyclic graph cannot loop indefinitely.
- **Truncation is derived, not assumed, at the depth boundary.** A
  non-empty frontier when `depth` hits `maxDepth` does not by itself mean
  something was cut off — `traverse()`'s own comment explains why: "the
  frontier's own nodes may simply have no further unvisited/unfiltered
  neighbors... Only report truncated when at least one frontier node
  actually has a reachable, not-yet-visited neighbor that maxDepth
  prevented us from recording."
- **`repositoryBoundary: "single"`** is always passed — a neighbor whose
  `repository_id` differs from the root's is never traversed into. (The
  type only declares one value, `"single"`, today — cross-repository
  traversal is not implemented.)
- **`findShortestPath()` is deterministic among ties**: a layered BFS that,
  "among all shortest paths, deterministically selects the one whose
  ordered edge-id sequence sorts lexicographically smallest — independent
  of input/traversal order."
- **`findAllPaths()` is bounded simple-path enumeration, never exhaustive
  on a densely connected graph** — capped at `DEFAULT_MAX_ALL_PATHS_DEPTH`
  (8) and `DEFAULT_RESULT_LIMIT` (500) total paths, each a documented,
  disclosed limit.

## Core artifact model

This section covers `TraversalOptions`/`TraversalResult`/`TraversedNode`
(traversal.ts's inputs/outputs), `KnowledgePath` (path-finding.ts's
output), and `ImpactQuery`/`ImpactResult`/`ImpactFinding` (impact-analysis.ts's
inputs/outputs) — all declared in `contracts.ts`:

| Type | Field | Note |
|---|---|---|
| `TraversalOptions` | `maxDepth`, `allowedEdgeTypes?`, `allowedNodeTypes?`, `direction`, `repositoryBoundary`, `resultLimit` | `direction` is `"upstream"` \| `"downstream"` \| `"both"`. |
| `TraversalResult` | `root_node_id`, `nodes: TraversedNode[]`, `edges_traversed: string[]`, `truncated` | `nodes` sorted by `node_id`; `edges_traversed` sorted. |
| `TraversedNode` | `node_id`, `depth`, `via_edge_id?` | `via_edge_id` absent only for the root node itself (depth 0). |
| `KnowledgePath` | `id`, `from_node_id`, `to_node_id`, `node_ids: string[]`, `edge_ids: string[]`, `length` | `length === edge_ids.length`. |
| `ImpactQuery` | `entity_node_id`, `max_depth`, `allowed_edge_types?`, `direction` | The exact object `digestOf()`'d to form `buildImpactResultId()`'s second argument. |
| `ImpactFinding` | `node_id`, `node_type`, `depth`, `path_id?` | One per node reached by the traversal (excluding the root). |
| `ImpactResult` | `id`, `schema_version`, `query`, `directly_affected: ImpactFinding[]`, `transitively_affected: ImpactFinding[]`, `blast_radius_level`, `edge_types_traversed`, `products_affected`, `capabilities_affected`, `decisions_affected`, `governance_findings_affected`, `assumptions_potentially_invalidated`, `unresolved_downstream_impact`, `truncated`, `evidence_refs` | See "Impact analysis" below for how each field is computed. |

## Traversal engine

`traversal.ts` exports `buildEdgeIndex(edges)`, `collectCandidateEdges(nodeId,
direction, index)`, and `traverse(nodes, edges, rootNodeId, options)`. If
`rootNodeId` doesn't resolve to a node, `traverse()` returns an empty,
non-truncated result rather than throwing — callers (impact-analysis.ts,
root-cause.ts, decision-impact.ts, change-planning.ts) each decide for
themselves whether a missing root is an error.

## Path-finding

`path-finding.ts`'s `findShortestPath(nodes, edges, fromNodeId, toNodeId,
options)` runs a layered BFS: at each depth it collects every candidate
edge extending the current frontier, keeps only the lexicographically
smallest edge-id-sequence candidate per neighbor, and stops as soon as
`toNodeId` is reached. If `fromNodeId === toNodeId` it returns a
zero-length path immediately (`node_ids: [fromNodeId], edge_ids: []`). It
returns `undefined` if either endpoint is missing from the graph or no
path exists within `options.maxDepth`.

`findAllPaths(nodes, edges, fromNodeId, toNodeId, options)` performs a
bounded simple-path DFS (`onPath` set prevents revisiting a node within
one path). It defaults `maxDepth` to `DEFAULT_MAX_ALL_PATHS_DEPTH` (8) and
`direction` to `"downstream"` when not supplied, and caps total collected
paths at `DEFAULT_RESULT_LIMIT` (500) — either limit being hit sets
`truncated: true`. Results are sorted by `(length, then lexicographic
edge_ids)`.

## Impact analysis

`impact-analysis.ts`'s `runImpactAnalysis(nodes, edges, query,
decisionStateLookup)`:

1. Runs `traverse()` from `query.entity_node_id` with
   `repositoryBoundary: "single"` and `resultLimit: DEFAULT_RESULT_LIMIT`
   (500).
2. For every reached node (excluding the root), re-runs
   `findShortestPath()` from the root to that node to attach a `path_id` —
   nodes at `depth === 1` go to `directly_affected`, everything else to
   `transitively_affected`.
3. Tallies `products_affected`, `capabilities_affected`, and
   `governance_findings_affected` by `node_type`, and separately notes
   whether any reached node is `node_type === "unresolved_reference"`.
4. Delegates decision classification to `computeDecisionImpact()`
   (`decision-impact.ts`, see [docs/graph-decision-impact.md](graph-decision-impact.md))
   filtered down to only the decisions traversal actually reached, and
   further derives `assumptions_potentially_invalidated` via
   `assumptionNodeIdsPotentiallyInvalidated()` — a decision this query
   didn't reach never contributes an assumption here.
5. `unresolved_downstream_impact` is `result.truncated ||
   reachedUnresolvedReference` — either the traversal itself was cut off,
   or it concretely reached a promoted `unresolved_reference` node.
6. `evidence_refs` is the deduplicated union of every directly-traversed
   edge's own `evidence_refs` (not the transitive edges' — only the edges
   one hop from the root).

## Blast radius

`blast-radius.ts`'s `deriveBlastRadiusLevel(nodes, targetNodeId,
traversalResult)` classifies a `BlastRadiusLevel` from an
already-computed `TraversalResult`, without re-traversing. The exact gate
order:

1. **`targetNodeId` not found in `nodes`** → `"unresolved"`.
2. **`traversalResult.edges_traversed.length === 0`** (no edge was ever
   traversable from the target at all — "no way to even ask") →
   `"unresolved"`.
3. Otherwise, reached nodes are filtered to those whose `node_type !==
   "unresolved_reference"` ("confirmed" neighbors). **If none remain**
   (every reached node was itself an unresolved reference) → `"isolated"`.
4. **Any confirmed neighbor is `node_type === "product"` or
   `"portfolio_relationship"`** → `"portfolio_wide"`.
5. **Confirmed neighbors span more than one `source_artifact`, or don't
   include the target's own `source_artifact`** → `"cross_layer"`.
6. **Confirmed neighbors span more than one `node_type`, or don't include
   the target's own `node_type`** → `"cross_component"`.
7. Otherwise → `"local"`.

This is a strictly ordered gate list, not a scored/weighted heuristic —
the first matching condition wins.

## CLI

Exact command surface and log-line formats (`rvs graph impact`, `rvs graph
path`, `rvs export impact-summary`) are documented once, in
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md#cli),
to avoid duplicating the same text across documents. In summary:

```bash
rvs graph impact <entity-id> [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
rvs graph path <from-id> <to-id> [--all] [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
rvs export impact-summary [--output impact-summary.md]
```

`--direction` defaults to `"downstream"` for both commands; an invalid
value throws `` `Invalid --direction "${value}". Expected one of: upstream, downstream, both.` ``.
Both commands run their query through `validation.ts`'s request-shape
guards (`validateImpactQuery`/`validatePathQuery`) before executing —
an out-of-range or non-positive-integer `--max-depth` is rejected before
any traversal runs, never silently clamped.

## Known limitations

- **`findAllPaths()` is bounded, not exhaustive.** On a densely connected
  graph, `--all` can hit `DEFAULT_RESULT_LIMIT` (500 paths) or
  `DEFAULT_MAX_ALL_PATHS_DEPTH` (8) before enumerating every simple path;
  the result is marked `truncated: true` rather than silently returned as
  if complete.
- **Cross-repository traversal is not implemented.** `RepositoryBoundary`
  only declares `"single"` today; every traversal call in this package
  passes it, so a neighbor node from a different `repository_id` is never
  reached, even conceptually (this package has no multi-repository
  federation of its own — that scope belongs to
  `@rvs/portfolio-intelligence`, consumed here only as already-computed
  portfolio nodes/edges).
- **`ImpactResult.evidence_refs` covers only directly-traversed edges**,
  not the full transitive edge set — see step 6 above.
- **Blast radius is a strict ordered gate list, not a weighted score.**
  It never blends multiple signals into a severity number; see the
  narrative module's forbidden-phrase list
  (`docs/architecture-knowledge-graph.md`'s "Narrative and presentation"
  section), which explicitly forbids inventing a severity judgement.

## Package summary

| Module | Role |
|---|---|
| `traversal.ts` | Shared bounded-BFS engine (`buildEdgeIndex`, `collectCandidateEdges`, `traverse`) |
| `path-finding.ts` | `findShortestPath`, `findAllPaths` |
| `impact-analysis.ts` | `runImpactAnalysis` — impact query classification, composing traversal + blast-radius + decision-impact |
| `blast-radius.ts` | `deriveBlastRadiusLevel` |

These four modules live inside `@rvs/knowledge-graph` — see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
"Package summary" for the full package/decoupling statement.

See also: [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md),
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-decision-impact.md](graph-decision-impact.md),
[docs/graph-change-planning.md](graph-change-planning.md),
[docs/graph-showcase.md](graph-showcase.md).
