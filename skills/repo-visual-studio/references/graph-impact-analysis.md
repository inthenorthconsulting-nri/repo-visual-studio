# Graph Impact Analysis and Blast Radius (reference)

Use when: the task asks "what is affected if this component changes,"
"what's the blast radius of removing this," "what's the shortest path
between these two entities," or wants every path between two nodes.

**Prerequisite**: `rvs graph build` has run. Covers `traversal.ts` (shared
bounded-BFS engine), `path-finding.ts`, `impact-analysis.ts`, and
`blast-radius.ts`.

**Command**:

```bash
rvs graph impact <entity-id> [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
rvs graph path <from-id> <to-id> [--all] [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
rvs export impact-summary [--output impact-summary.md]
```

**Output**: appended to `.rvs/cache/knowledge-graph/impact-results.json`
(and `decision-impact.json`, recomputed for the same query).

**Key facts to get right when explaining a result to a user**:

- One shared bounded-BFS engine (`traverse()`) backs impact analysis,
  path-finding, root-cause grouping, and decision-impact/change-planning —
  never revisits a node (cycle-safe), and only reports `truncated: true`
  when a frontier node genuinely had a reachable neighbor the depth limit
  cut off, never merely because the frontier was non-empty at the
  boundary.
- `findShortestPath()` breaks ties deterministically: among equal-length
  paths it picks the one whose edge-id sequence sorts lexicographically
  smallest.
- `findAllPaths()` is bounded, not exhaustive — capped at depth 8
  (`DEFAULT_MAX_ALL_PATHS_DEPTH`) and 500 total paths
  (`DEFAULT_RESULT_LIMIT`); either limit sets `truncated: true`.
- `--direction` defaults to `"downstream"`; cross-repository traversal is
  not implemented (`repositoryBoundary` only declares `"single"` today).
- **Blast radius is a strict ordered gate list, not a weighted score** —
  first matching condition wins, in this order: target not found →
  `unresolved`; zero traversable edges → `unresolved`; every reached node
  is itself unresolved → `isolated`; any confirmed neighbor is a
  `product`/`portfolio_relationship` → `portfolio_wide`; neighbors span
  more than one upstream artifact → `cross_layer`; neighbors span more
  than one node type → `cross_component`; otherwise → `local`.
  `unresolved` ("no way to even ask") is never merged with `isolated`
  ("asked, found nothing"). `BlastRadiusLevel` has exactly 6 values total:
  `unresolved`, `isolated`, `local`, `cross_component`, `cross_layer`,
  `portfolio_wide`.
- `ImpactResult.evidence_refs` covers only directly-traversed (one-hop)
  edges, not the full transitive edge set.

**Do not** describe blast radius as a numeric severity score — it is
always one of 6 fixed levels from an ordered gate list, never blended.

Full technical reference: `docs/graph-impact-analysis.md` (exact gate
order, algorithm detail for all four modules, known limitations).
